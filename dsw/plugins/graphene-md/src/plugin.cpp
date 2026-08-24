// Graphene molecular dynamics — a DSW experiment.
//
// A bilayer-graphene sandbox: the top sheet is a live MD model (Morse C–C
// bonds that break and re-form, sp² angle stiffness, an out-of-plane bending
// umbrella) resting on a rigid graphene substrate through Lennard-Jones
// forces. Mesas, Gaussian bumps and Hencky gas blisters push up through it.
//
// Ported from the browser tool tools/graphene-md/index.html; the model is the
// same one its "Physics" panel documents. Internal units are Å, eV, amu, fs.
//
// What the native core changes, beyond running the same physics far faster:
//
//   * Structure-of-arrays storage and gather-formulated force kernels, so
//     every loop is a race-free `#pragma omp parallel for` over atoms that
//     the compiler can also auto-vectorize (AVX2/AVX-512 where available).
//   * Verlet neighbour lists with a skin for the sheet–substrate LJ sum —
//     the dominant cost — rebuilt only when an atom has actually moved far
//     enough to invalidate them, instead of re-hashing every atom every step.
//   * One force evaluation per MD step (textbook velocity Verlet reusing the
//     stored force) rather than the two the JS version did.
//   * Bond re-formation only scans under-coordinated atoms, and refuses to
//     duplicate a bond that already exists — the JS version could add a
//     second copy of an existing bond whenever an atom had valence < 3,
//     double-counting that bond's force.

#include "../../../include/dex_plugin.h"
#include "../../../include/dex_msg.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <string>
#include <vector>

#ifndef M_PI // MSVC's <cmath> only defines it under _USE_MATH_DEFINES
#define M_PI 3.14159265358979323846
#endif

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

// ---------------------------------------------------------------- constants

constexpr double A_LATT = 2.46;  // graphene lattice constant, Å
constexpr double NM = 10.0;      // Å per nm
constexpr double C_MASS = 12.0;  // amu

// F [eV/Å] -> a [Å/fs²] for carbon; 1/0.0096485 = 103.642 eV per amu·Å²/fs².
constexpr double ACC_K = 0.0096485 / C_MASS;
constexpr double AMU_A2_FS2_IN_EV = 103.642;
constexpr double KB_EV = 8.617333262e-5;  // eV/K

// Area per carbon atom, √3a²/4 ≈ 2.62 Å²; Pa -> eV/Å³ is 6.2415e-12.
constexpr double A_ATOM = 2.62;
constexpr double PA_TO_EV_A3 = 6.2415e-12;

constexpr double REG_SMIN = -1.5, REG_SMAX = 3.0;
constexpr double REG_LAMBDA = 1.5;  // Å, height-damping width

struct Params {
    // geometry (rebuild)
    double Nnm = 12, Nsubnm = 12, z0 = 3.35, twistDeg = 0;
    // physics
    double dtFs = 1, gamma = 0.00001, maxV = 5, maxDX = 0.3;
    double De = 1.67, alpha = 3.0, re = 1.42, breakMul = 1.2, reformMul = 1.1;
    double ktheta = 8.0, theta0 = 120, kbend = 1.0;
    double sigma = 3.42, eps0 = 2.387e-3, escale = 1;
    double edgeK = 0;  // resolved from edgeMode by the UI
    // protrusion
    std::string profile = "gauss";   // gauss | mesa | bubble
    std::string protLoc = "subUp";   // subUp | between
    std::string elevMode = "rhrd";   // rhrd (ramp-hold-return) | const
    double Mxnm = 6, Mynm = 6, Cxnm = 0, Cynm = 0;
    double bubbleRnm = 4, bubbleP = 1000, betweenBoost = 25;
    double liftRate = 0.01, targetDz = 10;
    int holdSteps = 500;
    // run
    int stepsPerFrame = 4;
    // display
    bool registry = false, regHeightDamp = true;
    double regGamma = 1;
};

inline double clampd(double v, double lo, double hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// ---------------------------------------------------------------- instance

struct Instance {
    Params P;

    // Sheet (dynamic), structure-of-arrays.
    std::vector<double> tx, ty, tz, vx, vy, vz, fx, fy, fz;
    std::vector<double> tx0, ty0, tz0;  // as-built reference positions
    std::vector<uint8_t> isEdge;        // inside the edge-spring collar

    // Substrate (rigid; moves only when a protrusion lifts it).
    std::vector<double> sx, sy, sz, sx0, sy0, sz0;

    // Bond list plus its per-atom CSR adjacency.
    std::vector<int32_t> bondI, bondJ;
    std::vector<int32_t> nbOff, nbIdx;
    // Angle triplets (centre, leg a, leg b) plus per-atom incidence CSR.
    std::vector<int32_t> angC, angA, angB;
    std::vector<int32_t> aiOff, aiIdx;  // aiIdx = angle*4 + role(0=c,1=a,2=b)

    // Sheet->substrate LJ Verlet lists, rebuilt on displacement.
    std::vector<int32_t> ljOff, ljIdx;
    std::vector<double> ljRefX, ljRefY, ljRefZ;  // sheet positions at build
    double ljSkin = 2.0;
    bool ljValid = false;

    // Substrate cell list (2D, xy).
    std::vector<int32_t> cellOff, cellIdx;
    double cellSize = 0;
    int cellNx = 0, cellNy = 0;
    double cellX0 = 0, cellY0 = 0;
    bool subDirty = true;

    // Run state.
    bool running = false;
    bool haveForces = false;
    long long frame = 0;
    uint32_t topoVersion = 1, sentTopoVersion = 0;
    uint32_t subVersion = 1, sentSubVersion = 0;
    int pendingSteps = 0;  // single-step requests

    // Elevation state machine.
    bool elevActive = false;
    std::string elevPhase = "idle";
    double elevz = 0;
    int holdCount = 0;

    // Diagnostics.
    double ePot = 0, eKin = 0, temperature = 0;
    double stepMs = 0;
    long long stepsDone = 0;
    double statsClock = 0;
    double stepsWindow = 0;

    // Registry colouring scratch.
    std::vector<float> regT, regW;

    std::vector<uint8_t> frameBuf;
    std::deque<std::string> outbox;
    std::string handout;

    Instance() { build(); }

    size_t nTop() const { return tx.size(); }
    size_t nSub() const { return sx.size(); }

    void say(const std::string &m) { outbox.push_back(m); }

    // ------------------------------------------------------------ lattice

    // Square graphene patch, |x|,|y| <= halfA, at height z.
    static void genLattice(double halfA, double z, std::vector<double> &X,
                           std::vector<double> &Y, std::vector<double> &Z) {
        X.clear(); Y.clear(); Z.clear();
        const double a = A_LATT;
        const double a1x = a, a1y = 0;
        const double a2x = a / 2, a2y = std::sqrt(3.0) * a / 2;
        const double bx[2] = {0, a / 2};
        const double by[2] = {0, std::sqrt(3.0) * a / 6};
        int nx = (int)std::ceil(2 * halfA / a) + 2;
        int ny = (int)std::ceil(2 * halfA / (std::sqrt(3.0) * a / 2)) + 2;
        for (int i = -nx; i <= nx; i++)
            for (int j = -ny; j <= ny; j++) {
                double px = i * a1x + j * a2x, py = i * a1y + j * a2y;
                for (int b = 0; b < 2; b++) {
                    double x = px + bx[b], y = py + by[b];
                    if (std::fabs(x) <= halfA && std::fabs(y) <= halfA) {
                        X.push_back(x); Y.push_back(y); Z.push_back(z);
                    }
                }
            }
    }

    void build() {
        const double halfSub = P.Nsubnm * NM / 2, halfTop = P.Nnm * NM / 2;
        genLattice(halfSub, 0, sx, sy, sz);
        sx0 = sx; sy0 = sy; sz0 = sz;

        // Top sheet: generate with margin, rotate by the twist, crop square.
        std::vector<double> rx, ry, rz;
        genLattice(halfTop * std::sqrt(2.0) + 3, P.z0, rx, ry, rz);
        const double th = P.twistDeg * M_PI / 180, ct = std::cos(th), st = std::sin(th);
        tx.clear(); ty.clear(); tz.clear();
        for (size_t i = 0; i < rx.size(); i++) {
            double x = ct * rx[i] - st * ry[i], y = st * rx[i] + ct * ry[i];
            if (std::fabs(x) <= halfTop && std::fabs(y) <= halfTop) {
                tx.push_back(x); ty.push_back(y); tz.push_back(rz[i]);
            }
        }
        tx0 = tx; ty0 = ty; tz0 = tz;

        const size_t n = nTop();
        vx.assign(n, 0); vy.assign(n, 0); vz.assign(n, 0);
        fx.assign(n, 0); fy.assign(n, 0); fz.assign(n, 0);
        regT.assign(n, 0); regW.assign(n, 1);

        markEdges();
        buildSubCells();
        rebuildConnectivity();
        ljValid = false;
        haveForces = false;
        frame = 0; stepsDone = 0;
        elevz = 0; elevActive = false; elevPhase = "idle"; holdCount = 0;
        topoVersion++; subVersion++;
    }

    // Outer 2 nm collar carries the edge springs.
    void markEdges() {
        const double N = P.Nnm * NM, edge = 2 * NM, lim = N / 2 - edge;
        isEdge.assign(nTop(), 0);
        for (size_t i = 0; i < nTop(); i++)
            isEdge[i] = (std::fabs(tx0[i]) > lim || std::fabs(ty0[i]) > lim) ? 1 : 0;
    }

    void resetPositions() {
        tx = tx0; ty = ty0; tz = tz0;
        std::fill(vx.begin(), vx.end(), 0.0);
        std::fill(vy.begin(), vy.end(), 0.0);
        std::fill(vz.begin(), vz.end(), 0.0);
        sx = sx0; sy = sy0; sz = sz0;
        subDirty = true; subVersion++;
        elevz = 0; elevActive = false; elevPhase = "idle"; holdCount = 0;
        rebuildConnectivity();
        ljValid = false;
        haveForces = false;
        frame = 0;
    }

    // -------------------------------------------------- substrate cell list

    void buildSubCells() {
        const double cut = 3 * P.sigma;
        cellSize = std::max(cut, 3.0);
        double minx = 1e30, miny = 1e30, maxx = -1e30, maxy = -1e30;
        for (size_t i = 0; i < nSub(); i++) {
            minx = std::min(minx, sx[i]); maxx = std::max(maxx, sx[i]);
            miny = std::min(miny, sy[i]); maxy = std::max(maxy, sy[i]);
        }
        if (nSub() == 0) { cellNx = cellNy = 0; return; }
        cellX0 = minx - cellSize; cellY0 = miny - cellSize;
        cellNx = (int)((maxx - cellX0) / cellSize) + 2;
        cellNy = (int)((maxy - cellY0) / cellSize) + 2;
        const size_t nCells = (size_t)cellNx * cellNy;
        std::vector<int32_t> count(nCells + 1, 0);
        std::vector<int32_t> cellOfAtom(nSub());
        for (size_t i = 0; i < nSub(); i++) {
            int cx = (int)((sx[i] - cellX0) / cellSize);
            int cy = (int)((sy[i] - cellY0) / cellSize);
            cx = std::min(std::max(cx, 0), cellNx - 1);
            cy = std::min(std::max(cy, 0), cellNy - 1);
            int c = cy * cellNx + cx;
            cellOfAtom[i] = c;
            count[c + 1]++;
        }
        for (size_t c = 0; c < nCells; c++) count[c + 1] += count[c];
        cellOff = count;
        cellIdx.resize(nSub());
        std::vector<int32_t> cursor(cellOff.begin(), cellOff.end() - 1);
        for (size_t i = 0; i < nSub(); i++) cellIdx[cursor[cellOfAtom[i]]++] = (int32_t)i;
        subDirty = false;
    }

    // ------------------------------------------------------- connectivity

    // Rebuild the per-atom adjacency and the angle list from the bond list.
    void rebuildDerivedTopology() {
        const size_t n = nTop();
        std::vector<int32_t> deg(n + 1, 0);
        for (size_t b = 0; b < bondI.size(); b++) {
            deg[bondI[b] + 1]++;
            deg[bondJ[b] + 1]++;
        }
        for (size_t i = 0; i < n; i++) deg[i + 1] += deg[i];
        nbOff = deg;
        nbIdx.resize(2 * bondI.size());
        std::vector<int32_t> cursor(nbOff.begin(), nbOff.end() - 1);
        for (size_t b = 0; b < bondI.size(); b++) {
            nbIdx[cursor[bondI[b]]++] = bondJ[b];
            nbIdx[cursor[bondJ[b]]++] = bondI[b];
        }

        angC.clear(); angA.clear(); angB.clear();
        for (size_t i = 0; i < n; i++) {
            int s = nbOff[i], e = nbOff[i + 1];
            for (int a = s; a < e; a++)
                for (int b = a + 1; b < e; b++) {
                    angC.push_back((int32_t)i);
                    angA.push_back(nbIdx[a]);
                    angB.push_back(nbIdx[b]);
                }
        }

        // Per-atom angle incidence, so every atom can gather its own force.
        std::vector<int32_t> acount(n + 1, 0);
        for (size_t a = 0; a < angC.size(); a++) {
            acount[angC[a] + 1]++; acount[angA[a] + 1]++; acount[angB[a] + 1]++;
        }
        for (size_t i = 0; i < n; i++) acount[i + 1] += acount[i];
        aiOff = acount;
        aiIdx.resize(3 * angC.size());
        std::vector<int32_t> acur(aiOff.begin(), aiOff.end() - 1);
        for (size_t a = 0; a < angC.size(); a++) {
            aiIdx[acur[angC[a]]++] = (int32_t)(a * 4 + 0);
            aiIdx[acur[angA[a]]++] = (int32_t)(a * 4 + 1);
            aiIdx[acur[angB[a]]++] = (int32_t)(a * 4 + 2);
        }
        topoVersion++;
    }

    // Initial bonds: everything within 1.3 rₑ, via a sheet cell list.
    void rebuildConnectivity() {
        const double cutoff = 1.3 * P.re, cut2 = cutoff * cutoff;
        bondI.clear(); bondJ.clear();
        const size_t n = nTop();
        if (n) {
            const double cs = std::max(cutoff, 2.5);
            double minx = 1e30, miny = 1e30, maxx = -1e30, maxy = -1e30;
            for (size_t i = 0; i < n; i++) {
                minx = std::min(minx, tx[i]); maxx = std::max(maxx, tx[i]);
                miny = std::min(miny, ty[i]); maxy = std::max(maxy, ty[i]);
            }
            int nx = (int)((maxx - minx) / cs) + 3, ny = (int)((maxy - miny) / cs) + 3;
            double x0 = minx - cs, y0 = miny - cs;
            std::vector<std::vector<int32_t>> cells((size_t)nx * ny);
            for (size_t i = 0; i < n; i++) {
                int cx = std::min(std::max((int)((tx[i] - x0) / cs), 0), nx - 1);
                int cy = std::min(std::max((int)((ty[i] - y0) / cs), 0), ny - 1);
                cells[(size_t)cy * nx + cx].push_back((int32_t)i);
            }
            for (int cy = 0; cy < ny; cy++)
                for (int cx = 0; cx < nx; cx++) {
                    auto &A = cells[(size_t)cy * nx + cx];
                    if (A.empty()) continue;
                    for (int oy = -1; oy <= 1; oy++)
                        for (int ox = -1; ox <= 1; ox++) {
                            int gx = cx + ox, gy = cy + oy;
                            if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) continue;
                            auto &B = cells[(size_t)gy * nx + gx];
                            for (int32_t i : A)
                                for (int32_t j : B) {
                                    if (j <= i) continue;
                                    double dx = tx[j] - tx[i], dy = ty[j] - ty[i], dz = tz[j] - tz[i];
                                    if (dx * dx + dy * dy + dz * dz < cut2) {
                                        bondI.push_back(i); bondJ.push_back(j);
                                    }
                                }
                        }
                }
        }
        rebuildDerivedTopology();
    }

    // Break over-stretched bonds; re-form close pairs, capped at valence 3.
    // Only under-coordinated atoms can gain a bond, so the re-form scan
    // touches the sheet edge and any damage, not the pristine interior.
    void updateTopology() {
        const double breakR2 = P.breakMul * P.re * P.breakMul * P.re;
        const size_t nb = bondI.size();
        bool changed = false;

        size_t keep = 0;
        for (size_t b = 0; b < nb; b++) {
            const int i = bondI[b], j = bondJ[b];
            const double dx = tx[j] - tx[i], dy = ty[j] - ty[i], dz = tz[j] - tz[i];
            if (dx * dx + dy * dy + dz * dz > breakR2) { changed = true; continue; }
            bondI[keep] = (int32_t)i; bondJ[keep] = (int32_t)j; keep++;
        }
        if (changed) { bondI.resize(keep); bondJ.resize(keep); }

        // Valence from the (possibly shortened) bond list.
        const size_t n = nTop();
        std::vector<uint8_t> val(n, 0);
        for (size_t b = 0; b < bondI.size(); b++) { val[bondI[b]]++; val[bondJ[b]]++; }

        std::vector<int32_t> cand;
        for (size_t i = 0; i < n; i++)
            if (val[i] < 3) cand.push_back((int32_t)i);

        if (!cand.empty()) {
            const double cut = P.reformMul * P.re, cut2 = cut * cut;
            // Current partners, three slots per atom (valence is capped at 3),
            // so "are these already bonded?" is a constant-time check instead
            // of a scan over every bond. The JS version had no check at all
            // and could add a second copy of an existing bond.
            std::vector<int32_t> partner(3 * n, -1);
            for (size_t k = 0; k < bondI.size(); k++) {
                const int a = bondI[k], b2 = bondJ[k];
                for (int q = 0; q < 3; q++)
                    if (partner[3 * a + q] < 0) { partner[3 * a + q] = b2; break; }
                for (int q = 0; q < 3; q++)
                    if (partner[3 * b2 + q] < 0) { partner[3 * b2 + q] = a; break; }
            }
            auto alreadyBonded = [&](int a, int b2) {
                return partner[3 * a] == b2 || partner[3 * a + 1] == b2 ||
                       partner[3 * a + 2] == b2;
            };
            auto addPartner = [&](int a, int b2) {
                for (int q = 0; q < 3; q++)
                    if (partner[3 * a + q] < 0) { partner[3 * a + q] = b2; return; }
            };
            const double cs = std::max(cut, 2.5);
            double minx = 1e30, miny = 1e30, maxx = -1e30, maxy = -1e30;
            for (int32_t i : cand) {
                minx = std::min(minx, tx[i]); maxx = std::max(maxx, tx[i]);
                miny = std::min(miny, ty[i]); maxy = std::max(maxy, ty[i]);
            }
            int nx = (int)((maxx - minx) / cs) + 3, ny = (int)((maxy - miny) / cs) + 3;
            double x0 = minx - cs, y0 = miny - cs;
            std::vector<std::vector<int32_t>> cells((size_t)nx * ny);
            for (int32_t i : cand) {
                int cx = std::min(std::max((int)((tx[i] - x0) / cs), 0), nx - 1);
                int cy = std::min(std::max((int)((ty[i] - y0) / cs), 0), ny - 1);
                cells[(size_t)cy * nx + cx].push_back(i);
            }
            for (int cy = 0; cy < ny; cy++)
                for (int cx = 0; cx < nx; cx++) {
                    auto &A = cells[(size_t)cy * nx + cx];
                    if (A.empty()) continue;
                    for (int oy = -1; oy <= 1; oy++)
                        for (int ox = -1; ox <= 1; ox++) {
                            int gx = cx + ox, gy = cy + oy;
                            if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) continue;
                            for (int32_t i : A)
                                for (int32_t j : cells[(size_t)gy * nx + gx]) {
                                    if (j <= i) continue;
                                    if (val[i] >= 3 || val[j] >= 3) continue;
                                    double dx = tx[j] - tx[i], dy = ty[j] - ty[i], dz = tz[j] - tz[i];
                                    if (dx * dx + dy * dy + dz * dz >= cut2) continue;
                                    if (alreadyBonded(i, j)) continue;
                                    bondI.push_back(i); bondJ.push_back(j);
                                    addPartner(i, j); addPartner(j, i);
                                    val[i]++; val[j]++;
                                    changed = true;
                                }
                        }
                }
        }
        if (changed) rebuildDerivedTopology();
    }

    // ------------------------------------------------------- neighbour list

    bool ljNeedsRebuild() const {
        if (!ljValid) return true;
        const double half = 0.5 * ljSkin, half2 = half * half;
        for (size_t i = 0; i < nTop(); i++) {
            const double dx = tx[i] - ljRefX[i], dy = ty[i] - ljRefY[i], dz = tz[i] - ljRefZ[i];
            if (dx * dx + dy * dy + dz * dz > half2) return true;
        }
        return false;
    }

    // Sheet atom -> substrate atoms within the LJ cutoff plus a skin.
    void buildLJLists() {
        if (subDirty) buildSubCells();
        const double cut = 3 * P.sigma + ljSkin, cut2 = cut * cut;
        const size_t n = nTop();
        ljOff.assign(n + 1, 0);
        if (!nSub() || !n) {
            ljIdx.clear(); ljValid = true;
            ljRefX = tx; ljRefY = ty; ljRefZ = tz;
            return;
        }
        const int reach = (int)std::ceil(cut / cellSize);

        // Count, prefix-sum, fill: both scans parallel, the CSR exact.
        std::vector<int32_t> cnt(n, 0);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            const int cx = (int)((tx[i] - cellX0) / cellSize);
            const int cy = (int)((ty[i] - cellY0) / cellSize);
            int c = 0;
            for (int oy = -reach; oy <= reach; oy++)
                for (int ox = -reach; ox <= reach; ox++) {
                    const int gx = cx + ox, gy = cy + oy;
                    if (gx < 0 || gy < 0 || gx >= cellNx || gy >= cellNy) continue;
                    const int cell = gy * cellNx + gx;
                    for (int k = cellOff[cell]; k < cellOff[cell + 1]; k++) {
                        const int j = cellIdx[k];
                        const double dx = sx[j] - tx[i], dy = sy[j] - ty[i], dz = sz[j] - tz[i];
                        if (dx * dx + dy * dy + dz * dz < cut2) c++;
                    }
                }
            cnt[i] = c;
        }
        for (size_t i = 0; i < n; i++) ljOff[i + 1] = ljOff[i] + cnt[i];
        ljIdx.resize((size_t)ljOff[n]);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            const int cx = (int)((tx[i] - cellX0) / cellSize);
            const int cy = (int)((ty[i] - cellY0) / cellSize);
            int w = ljOff[i];
            for (int oy = -reach; oy <= reach; oy++)
                for (int ox = -reach; ox <= reach; ox++) {
                    const int gx = cx + ox, gy = cy + oy;
                    if (gx < 0 || gy < 0 || gx >= cellNx || gy >= cellNy) continue;
                    const int cell = gy * cellNx + gx;
                    for (int k = cellOff[cell]; k < cellOff[cell + 1]; k++) {
                        const int j = cellIdx[k];
                        const double dx = sx[j] - tx[i], dy = sy[j] - ty[i], dz = sz[j] - tz[i];
                        if (dx * dx + dy * dy + dz * dz < cut2) ljIdx[w++] = j;
                    }
                }
        }
        ljRefX = tx; ljRefY = ty; ljRefZ = tz;
        ljValid = true;
    }

    // Hencky blister height h₀ = 0.709 R (pR/E2D)^(1/3), E2D = 340 N/m.
    double henckyH0() const {
        const double R_m = P.bubbleRnm * 1e-9, p_Pa = P.bubbleP * 1e6;
        if (!(R_m > 0) || !(p_Pa > 0)) return 0;
        return 0.709 * R_m * std::cbrt(p_Pa * R_m / 340.0) * 1e10;  // Å
    }

    // ------------------------------------------------------------- forces

    // Every term is written as a gather: atom i sums only what lands on atom
    // i, so the whole loop is race-free, parallel and vectorizable.
    void computeForces() {
        const size_t n = nTop();
        if (!n) return;
        if (ljNeedsRebuild()) buildLJLists();

        const double De = P.De, alpha = P.alpha, re = P.re;
        const double kth = P.ktheta, th0 = P.theta0 * M_PI / 180;
        const double kb = P.kbend;
        const double sigma = P.sigma, eps = P.eps0 * P.escale;
        const double ljCut2 = 9 * P.sigma * P.sigma, sig2 = sigma * sigma;
        const double edgeK = P.edgeK;

        // Bending needs every atom's height offset before any force is summed.
        std::vector<double> bendDz(n, 0.0), bendShare(n, 0.0);
        if (kb > 0) {
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
            for (int ii = 0; ii < (int)n; ii++) {
                const size_t i = (size_t)ii;
                const int s = nbOff[i], e = nbOff[i + 1], deg = e - s;
                if (deg <= 0) continue;
                double za = 0;
                for (int k = s; k < e; k++) za += tz[nbIdx[k]];
                bendDz[i] = tz[i] - za / deg;
                bendShare[i] = kb * bendDz[i] / deg;
            }
        }

        // Gas-pocket pressure (protLoc == "between"): F = p·A_atom, ramped.
        double gasF = 0;
        const double gcx = P.Cxnm * NM, gcy = P.Cynm * NM;
        const double halfX = P.Mxnm * NM / 2, halfY = P.Mynm * NM / 2;
        const double sigx = P.Mxnm * NM / 3, sigy = P.Mynm * NM / 3;
        const double bubR2 = P.bubbleRnm * NM * P.bubbleRnm * NM;
        const bool gaussProfile = (P.profile != "bubble" && P.profile != "mesa");
        const bool bubbleProfile = (P.profile == "bubble");
        if (P.protLoc == "between") {
            const double target = bubbleProfile ? henckyH0() : P.targetDz;
            const double frac = target > 0 ? clampd(elevz / target, 0, 1) : 0;
            if (frac > 0) {
                const double boost = P.betweenBoost > 0 ? P.betweenBoost : 1;
                gasF = (P.bubbleP * 1e6 * frac) * PA_TO_EV_A3 * A_ATOM * boost;
            }
        }

        double pe = 0;
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : pe)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            const double xi = tx[i], yi = ty[i], zi = tz[i];
            double Fx = 0, Fy = 0, Fz = 0, e = 0;

            // --- Morse bonds: V = De(1 - e^{-α(r-rₑ)})², half the pair energy each.
            const int bs = nbOff[i], be = nbOff[i + 1];
            for (int k = bs; k < be; k++) {
                const int j = nbIdx[k];
                const double dx = tx[j] - xi, dy = ty[j] - yi, dz = tz[j] - zi;
                const double r2 = dx * dx + dy * dy + dz * dz;
                const double r = std::sqrt(r2);
                if (r < 1e-8) continue;
                const double ex = std::exp(-alpha * (r - re));
                const double mag = 2 * De * alpha * ex * (1 - ex);  // dV/dr
                const double inv = 1.0 / r;
                Fx += mag * dx * inv; Fy += mag * dy * inv; Fz += mag * dz * inv;
                const double om = 1 - ex;
                e += 0.5 * De * om * om;
            }

            // --- sp² angle term, V = ½k(θ-θ₀)², gathered by role in each angle.
            if (kth != 0) {
                const int as = aiOff[i], ae = aiOff[i + 1];
                for (int k = as; k < ae; k++) {
                    const int packed = aiIdx[k];
                    const int a = packed >> 2, role = packed & 3;
                    const int ci = angC[a], ja = angA[a], ka = angB[a];
                    const double v1x = tx[ja] - tx[ci], v1y = ty[ja] - ty[ci], v1z = tz[ja] - tz[ci];
                    const double v2x = tx[ka] - tx[ci], v2y = ty[ka] - ty[ci], v2z = tz[ka] - tz[ci];
                    const double L1 = std::sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
                    const double L2 = std::sqrt(v2x * v2x + v2y * v2y + v2z * v2z);
                    if (L1 < 1e-6 || L2 < 1e-6) continue;
                    const double u1x = v1x / L1, u1y = v1y / L1, u1z = v1z / L1;
                    const double u2x = v2x / L2, u2y = v2y / L2, u2z = v2z / L2;
                    double c = clampd(u1x * u2x + u1y * u2y + u1z * u2z, -1.0, 1.0);
                    const double theta = std::acos(c);
                    const double dth = theta - th0;
                    // fac = -(dV/dθ)/sinθ, as in the reference implementation.
                    const double fac = (-kth * dth) / std::max(std::sqrt(1 - c * c), 1e-4);
                    const double nx = u2x - c * u1x, ny = u2y - c * u1y, nz = u2z - c * u1z;
                    const double mx = u1x - c * u2x, my = u1y - c * u2y, mz = u1z - c * u2z;
                    const double fJx = -fac * nx / L1, fJy = -fac * ny / L1, fJz = -fac * nz / L1;
                    const double fKx = -fac * mx / L2, fKy = -fac * my / L2, fKz = -fac * mz / L2;
                    if (role == 1) { Fx += fJx; Fy += fJy; Fz += fJz; }
                    else if (role == 2) { Fx += fKx; Fy += fKy; Fz += fKz; }
                    else {
                        Fx -= (fJx + fKx); Fy -= (fJy + fKy); Fz -= (fJz + fKz);
                        e += 0.5 * kth * dth * dth;  // whole angle once, at its centre
                    }
                }
            }

            // --- bending umbrella: own restoring term plus neighbours' shares.
            if (kb > 0) {
                Fz += -kb * bendDz[i];
                for (int k = bs; k < be; k++) Fz += bendShare[nbIdx[k]];
                e += 0.5 * kb * bendDz[i] * bendDz[i];
            }

            // --- Lennard-Jones 12-6 against the rigid substrate.
            {
                const int ls = ljOff[i], le = ljOff[i + 1];
                for (int k = ls; k < le; k++) {
                    const int j = ljIdx[k];
                    const double dx = sx[j] - xi, dy = sy[j] - yi, dz = sz[j] - zi;
                    const double r2 = dx * dx + dy * dy + dz * dz;
                    if (r2 > ljCut2 || r2 < 1e-6) continue;
                    const double inv2 = 1.0 / r2;
                    const double sr2 = sig2 * inv2, sr6 = sr2 * sr2 * sr2, sr12 = sr6 * sr6;
                    // (dV/dr)/r for V = 4ε(σ¹²/r¹² − σ⁶/r⁶); force on i is +(dV/dr)r̂.
                    const double mag = -24 * eps * (2 * sr12 - sr6) * inv2;
                    Fx += mag * dx; Fy += mag * dy; Fz += mag * dz;
                    e += 4 * eps * (sr12 - sr6);
                }
            }

            // --- edge collar springs.
            if (edgeK > 0 && isEdge[i]) {
                const double dx = xi - tx0[i], dy = yi - ty0[i], dz = zi - tz0[i];
                Fx += -edgeK * dx; Fy += -edgeK * dy; Fz += -edgeK * dz;
                e += 0.5 * edgeK * (dx * dx + dy * dy + dz * dz);
            }

            // --- uniform upward gas pressure inside the blister footprint.
            if (gasF > 0) {
                const double dx = xi - gcx, dy = yi - gcy;
                double w;
                if (bubbleProfile) w = (dx * dx + dy * dy) < bubR2 ? 1 : 0;
                else if (!gaussProfile) w = (std::fabs(dx) <= halfX && std::fabs(dy) <= halfY) ? 1 : 0;
                else w = std::exp(-((dx * dx) / (2 * sigx * sigx) + (dy * dy) / (2 * sigy * sigy)));
                Fz += gasF * w;
            }

            fx[i] = Fx; fy[i] = Fy; fz[i] = Fz;
            pe += e;
        }
        ePot = pe;
        haveForces = true;
    }

    // --------------------------------------------------------- protrusion

    // Ramp the drive and, in "substrate up" mode, displace substrate atoms
    // kinematically. Returns true if the substrate actually moved.
    bool applyProtrusion() {
        if (!elevActive) return false;
        const double target = (P.profile == "bubble") ? henckyH0() : P.targetDz;
        if (P.elevMode == "const") {
            elevz = clampd(elevz + P.liftRate, 0, target);
        } else {
            if (elevPhase == "up") {
                elevz += P.liftRate;
                if (elevz >= target) { elevz = target; elevPhase = "hold"; holdCount = P.holdSteps; }
            } else if (elevPhase == "hold") {
                if (--holdCount <= 0) elevPhase = "down";
            } else if (elevPhase == "down") {
                elevz -= P.liftRate;
                if (elevz <= 0) { elevz = 0; elevPhase = "idle"; elevActive = false; }
            }
        }

        // "Between layers": the substrate stays flat; elevz only ramps the
        // gas pressure that computeForces() applies to the sheet.
        if (P.protLoc == "between") {
            if (subDirty) { sx = sx0; sy = sy0; sz = sz0; buildSubCells(); subVersion++; return true; }
            return false;
        }

        const double cx = P.Cxnm * NM, cy = P.Cynm * NM;
        const double halfX = P.Mxnm * NM / 2, halfY = P.Mynm * NM / 2;
        const double sigx = P.Mxnm * NM / 3, sigy = P.Mynm * NM / 3;
        const double R = P.bubbleRnm * NM, R2 = R * R;
        const bool bubbleProfile = (P.profile == "bubble");
        const bool mesaProfile = (P.profile == "mesa");
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)nSub(); ii++) {
            const size_t i = (size_t)ii;
            const double dx = sx0[i] - cx, dy = sy0[i] - cy;
            double lift;
            if (mesaProfile) {
                lift = (std::fabs(dx) <= halfX && std::fabs(dy) <= halfY) ? elevz : 0;
            } else if (bubbleProfile) {
                // Hencky membrane profile w(ρ) = h₀(1 − ρ²)^(2/3), clamped at ρ = 1.
                const double r2 = (dx * dx + dy * dy) / R2;
                lift = r2 < 1 ? elevz * std::pow(1 - r2, 2.0 / 3.0) : 0;
            } else {
                lift = elevz * std::exp(-((dx * dx) / (2 * sigx * sigx) + (dy * dy) / (2 * sigy * sigy)));
            }
            sx[i] = sx0[i]; sy[i] = sy0[i]; sz[i] = sz0[i] + lift;
        }
        subDirty = true;
        subVersion++;
        return true;
    }

    // -------------------------------------------------------- integration

    // Damped velocity Verlet — a Langevin thermostat at T = 0, i.e. friction
    // without noise — with the reference model's velocity and displacement
    // caps to keep bond-snapping events stable.
    void step() {
        const size_t n = nTop();
        if (!n) return;
        const double dt = P.dtFs;
        const double damp = std::exp(-(P.gamma * 1000) * dt / 2000);
        const double maxV = P.maxV, maxDX = P.maxDX * (dt / 0.5);
        const bool fixEdges = (P.edgeK >= 200);

        const bool subMoved = applyProtrusion();
        // Forces are carried between steps; only a moved substrate (or a
        // fresh build) makes the stored values stale.
        if (!haveForces || subMoved) {
            if (subMoved) ljValid = false;
            computeForces();
        }

        // Half kick.
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            double ux = damp * vx[i] + fx[i] * ACC_K * dt * 0.5;
            double uy = damp * vy[i] + fy[i] * ACC_K * dt * 0.5;
            double uz = damp * vz[i] + fz[i] * ACC_K * dt * 0.5;
            const double vm = std::sqrt(ux * ux + uy * uy + uz * uz);
            if (vm > maxV) { const double s = maxV / vm; ux *= s; uy *= s; uz *= s; }
            vx[i] = ux; vy[i] = uy; vz[i] = uz;
        }
        // Drift.
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            double dx = vx[i] * dt, dy = vy[i] * dt, dz = vz[i] * dt;
            const double dm = std::sqrt(dx * dx + dy * dy + dz * dz);
            if (dm > maxDX) { const double s = maxDX / dm; dx *= s; dy *= s; dz *= s; }
            tx[i] += dx; ty[i] += dy; tz[i] += dz;
        }
        // Clamped edges are pinned hard, as in the reference model.
        if (fixEdges) {
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
            for (int ii = 0; ii < (int)n; ii++) {
                const size_t i = (size_t)ii;
                if (!isEdge[i]) continue;
                tx[i] = tx0[i]; ty[i] = ty0[i]; tz[i] = tz0[i];
                vx[i] = vy[i] = vz[i] = 0;
            }
        }

        updateTopology();
        computeForces();

        // Second half kick.
        double ke = 0;
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : ke)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            double ux = damp * vx[i] + fx[i] * ACC_K * dt * 0.5;
            double uy = damp * vy[i] + fy[i] * ACC_K * dt * 0.5;
            double uz = damp * vz[i] + fz[i] * ACC_K * dt * 0.5;
            const double vm2 = ux * ux + uy * uy + uz * uz;
            if (vm2 > maxV * maxV) {
                const double s = maxV / std::sqrt(vm2);
                ux *= s; uy *= s; uz *= s;
            }
            vx[i] = ux; vy[i] = uy; vz[i] = uz;
            ke += ux * ux + uy * uy + uz * uz;
        }
        // ½mv² with m = 12 amu; 1 amu·Å²/fs² = 103.642 eV.
        eKin = 0.5 * C_MASS * AMU_A2_FS2_IN_EV * ke;
        temperature = n ? (2.0 * eKin) / (3.0 * (double)n * KB_EV) : 0;
        frame++;
        stepsDone++;
        stepsWindow++;
    }

    // ---------------------------------------------------------- registry

    // s(r) = Σᵢ cos(Gᵢ·r) over the three first-shell reciprocal vectors of the
    // untwisted substrate; t = 1 − (s − s_min)/(s_max − s_min). Maxima sit on
    // AA sites, and their slow beat across a twisted sheet is the moiré.
    void computeRegistry() {
        const size_t n = nTop();
        regT.assign(n, 0.0f);
        regW.assign(n, 1.0f);
        const double g = 4 * M_PI / (std::sqrt(3.0) * A_LATT);
        double Gx[3], Gy[3];
        for (int k = 0; k < 3; k++) {
            const double ang = M_PI / 2 + k * 2 * M_PI / 3;
            Gx[k] = g * std::cos(ang); Gy[k] = g * std::sin(ang);
        }
        const double gam = P.regGamma > 0 ? P.regGamma : 1;
        const bool damp = P.regHeightDamp;
        const double z0 = P.z0;
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            double s = 0;
            for (int k = 0; k < 3; k++) s += std::cos(Gx[k] * tx[i] + Gy[k] * ty[i]);
            double t = 1.0 - (s - REG_SMIN) / (REG_SMAX - REG_SMIN);
            t = clampd(t, 0.0, 1.0);
            if (gam != 1) t = std::pow(t, gam);
            regT[i] = (float)t;
            if (damp) {
                // Local interlayer distance from the nearest substrate atom.
                double best = 1e30;
                const int ls = ljOff.empty() ? 0 : ljOff[i];
                const int le = ljOff.empty() ? 0 : ljOff[i + 1];
                for (int k = ls; k < le; k++) {
                    const int j = ljIdx[k];
                    const double dx = sx[j] - tx[i], dy = sy[j] - ty[i];
                    const double d2 = dx * dx + dy * dy;
                    if (d2 < best) { best = d2; regW[i] = (float)(tz[i] - sz[j]); }
                }
                const double d = regW[i];
                regW[i] = (float)std::exp(-((d - z0) * (d - z0)) / (2 * REG_LAMBDA * REG_LAMBDA));
            }
        }
    }

    // ------------------------------------------------------- wire protocol

    // One binary frame carries the sheet, and — only when they changed —
    // the bond topology and the substrate. Everything is float32/int32, so
    // the browser maps it with typed-array views and no parsing at all.
    //   magic 'GMD1', flags, nTop, nSub, nBonds, frame, ePot, eKin
    //   float  top[3n]
    //   float  reg[2n]      if flags & 4   (registry t, height weight w)
    //   float  sub[3m]      if flags & 2
    //   int32  bonds[2b]    if flags & 1
    static const uint32_t F_BONDS = 1, F_SUB = 2, F_REG = 4;

    void packFrame() {
        const uint32_t n = (uint32_t)nTop(), m = (uint32_t)nSub();
        uint32_t flags = 0;
        if (topoVersion != sentTopoVersion) flags |= F_BONDS;
        if (subVersion != sentSubVersion) flags |= F_SUB;
        if (P.registry) { computeRegistry(); flags |= F_REG; }
        const uint32_t b = (flags & F_BONDS) ? (uint32_t)bondI.size() : 0;

        size_t words = 8;                       // header
        words += (size_t)3 * n;                 // sheet positions
        if (flags & F_REG) words += (size_t)2 * n;
        if (flags & F_SUB) words += (size_t)3 * m;
        if (flags & F_BONDS) words += (size_t)2 * b;

        frameBuf.resize(words * 4);
        uint8_t *p = frameBuf.data();
        auto putU32 = [&](uint32_t v) { memcpy(p, &v, 4); p += 4; };
        auto putF32 = [&](float v) { memcpy(p, &v, 4); p += 4; };

        putU32(0x31444D47u);  // 'GMD1' little-endian
        putU32(flags);
        putU32(n);
        putU32(m);
        putU32(b);
        putU32((uint32_t)frame);
        putF32((float)ePot);
        putF32((float)eKin);

        for (uint32_t i = 0; i < n; i++) {
            putF32((float)tx[i]); putF32((float)ty[i]); putF32((float)tz[i]);
        }
        if (flags & F_REG)
            for (uint32_t i = 0; i < n; i++) { putF32(regT[i]); putF32(regW[i]); }
        if (flags & F_SUB)
            for (uint32_t i = 0; i < m; i++) {
                putF32((float)sx[i]); putF32((float)sy[i]); putF32((float)sz[i]);
            }
        if (flags & F_BONDS)
            for (uint32_t k = 0; k < b; k++) {
                putU32((uint32_t)bondI[k]); putU32((uint32_t)bondJ[k]);
            }

        if (flags & F_BONDS) sentTopoVersion = topoVersion;
        if (flags & F_SUB) sentSubVersion = subVersion;
    }

    void sayState(long q) {
        char buf[420];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"state\",\"q\":%ld,\"n\":%d,\"nsub\":%d,\"nbonds\":%d,"
                 "\"frame\":%lld,\"epot\":%.6g,\"ekin\":%.6g,\"etot\":%.6g,"
                 "\"temp\":%.4g,\"sps\":%.0f,\"ms\":%.3f,\"running\":%d,"
                 "\"elev\":%d,\"elevz\":%.3f,\"phase\":\"%s\",\"threads\":%d}",
                 q, (int)nTop(), (int)nSub(), (int)bondI.size(), frame, ePot, eKin,
                 ePot + eKin, temperature,
                 statsClock > 0 ? stepsWindow / statsClock : 0.0, stepMs,
                 running ? 1 : 0, elevActive ? 1 : 0, elevz, elevPhase.c_str(),
#ifdef _OPENMP
                 omp_get_max_threads()
#else
                 1
#endif
        );
        say(buf);
    }

    // ------------------------------------------------------------ messages

    // Live physics/display parameters. Geometry lives in "build" instead,
    // because changing it re-generates the lattice.
    void readParams(const std::string &m) {
        auto num = [&](const char *k, double d) { return dexmsg::get_num(m, k, d); };
        auto str = [&](const char *k, const std::string &d) {
            std::string v = dexmsg::get_str(m, k);
            return v.empty() ? d : v;
        };
        P.dtFs = num("dtFs", P.dtFs);
        P.gamma = num("gamma", P.gamma);
        P.maxV = num("maxV", P.maxV);
        P.maxDX = num("maxDX", P.maxDX);
        P.De = num("De", P.De);
        P.alpha = num("alpha", P.alpha);
        P.re = num("re", P.re);
        P.breakMul = num("breakMul", P.breakMul);
        P.reformMul = num("reformMul", P.reformMul);
        P.ktheta = num("ktheta", P.ktheta);
        P.theta0 = num("theta0", P.theta0);
        P.kbend = num("kbend", P.kbend);
        const double oldSigma = P.sigma;
        P.sigma = num("sigma", P.sigma);
        P.escale = num("escale", P.escale);
        P.edgeK = num("edgeK", P.edgeK);
        P.profile = str("profile", P.profile);
        P.protLoc = str("protLoc", P.protLoc);
        P.elevMode = str("elevMode", P.elevMode);
        P.Mxnm = num("Mxnm", P.Mxnm);
        P.Mynm = num("Mynm", P.Mynm);
        P.Cxnm = num("Cxnm", P.Cxnm);
        P.Cynm = num("Cynm", P.Cynm);
        P.bubbleRnm = num("bubbleRnm", P.bubbleRnm);
        P.bubbleP = num("bubbleP", P.bubbleP);
        P.betweenBoost = num("betweenBoost", P.betweenBoost);
        P.liftRate = num("liftRate", P.liftRate);
        P.targetDz = num("targetDz", P.targetDz);
        P.holdSteps = (int)num("holdSteps", P.holdSteps);
        P.stepsPerFrame = std::max(1, (int)num("stepsPerFrame", P.stepsPerFrame));
        P.registry = num("registry", P.registry ? 1 : 0) != 0;
        P.regHeightDamp = num("regHeightDamp", P.regHeightDamp ? 1 : 0) != 0;
        P.regGamma = num("regGamma", P.regGamma);
        // A wider LJ cutoff invalidates the neighbour lists and cell size.
        if (P.sigma != oldSigma) { subDirty = true; ljValid = false; }
        haveForces = false;  // parameters changed the potential
    }

    void handle(const std::string &m) {
        const std::string t = dexmsg::type_of(m);
        const long q = (long)dexmsg::get_num(m, "q", -1);

        if (t == "build") {
            readParams(m);
            P.Nnm = dexmsg::get_num(m, "Nnm", P.Nnm);
            P.Nsubnm = dexmsg::get_num(m, "Nsubnm", P.Nsubnm);
            P.z0 = dexmsg::get_num(m, "z0", P.z0);
            P.twistDeg = dexmsg::get_num(m, "twistDeg", P.twistDeg);
            build();
            computeForces();
            sayState(q);
        } else if (t == "params") {
            readParams(m);
            sayState(q);
        } else if (t == "run") {
            running = dexmsg::get_num(m, "on", 0) != 0;
            sayState(q);
        } else if (t == "step") {
            pendingSteps += std::max(1, (int)dexmsg::get_num(m, "n", 1));
            sayState(q);
        } else if (t == "reset") {
            resetPositions();
            computeForces();
            sayState(q);
        } else if (t == "elev") {
            const bool on = dexmsg::get_num(m, "on", 0) != 0;
            if (on) {
                // Match the reference GUI: a fresh ramp never inherits stale
                // velocities from a previous partial run.
                std::fill(vx.begin(), vx.end(), 0.0);
                std::fill(vy.begin(), vy.end(), 0.0);
                std::fill(vz.begin(), vz.end(), 0.0);
                elevz = 0;
                elevActive = true;
                elevPhase = "up";
                holdCount = P.holdSteps;
                running = true;  // elevating without running looked like a no-op
            } else {
                elevActive = false;
                elevPhase = "idle";
            }
            sayState(q);
        } else if (t == "state") {
            sayState(q);
        }
    }
};

// ---------------------------------------------------------------- ABI

void *create() { return new Instance(); }
void destroy(void *p) { delete (Instance *)p; }

int advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    int budget = 0;
    if (s->running) budget = s->P.stepsPerFrame;
    else if (s->pendingSteps > 0) { budget = s->pendingSteps; s->pendingSteps = 0; }
    if (budget <= 0) return 0;

    // Run the requested steps, but never hold the worker thread for more than
    // ~10 ms so control messages and frame requests stay responsive.
    const auto t0 = std::chrono::steady_clock::now();
    int done = 0;
    for (int i = 0; i < budget; i++) {
        s->step();
        done++;
        if (std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() > 0.010)
            break;
    }
    s->stepMs = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t0).count() / std::max(done, 1);

    s->statsClock += dt;
    if (s->statsClock >= 0.5) {
        s->sayState(-1);
        s->statsClock = 0;
        s->stepsWindow = 0;
    }
    return 1;
}

void on_message(void *p, const char *json, size_t len) {
    ((Instance *)p)->handle(std::string(json, len));
}

const char *poll_message(void *p) {
    Instance *s = (Instance *)p;
    if (s->outbox.empty()) return nullptr;
    s->handout = std::move(s->outbox.front());
    s->outbox.pop_front();
    return s->handout.c_str();
}

// The "frame" is packed simulation state, not pixels: the browser keeps the
// WebGL rendering and this channel just feeds it geometry, one frame in
// flight, paced by the display's requestAnimationFrame.
int render(void *p, dex_frame *out) {
    Instance *s = (Instance *)p;
    s->packFrame();
    out->width = (uint32_t)(s->frameBuf.size() / 4);
    out->height = 1;
    out->rgba = s->frameBuf.data();
    return 1;
}

const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "graphene-md",
    "Graphene Molecular Dynamics",
    "1.0",
    create, destroy, advance, on_message, poll_message, render,
};

}  // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) {
    return &API;
}
