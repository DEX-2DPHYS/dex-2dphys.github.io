// moire-bubble — twisted bubbles in a genuine bilayer.
//
// Why a separate plugin rather than another engine in graphene-md: that plugin
// has ONE mobile sheet on a rigid substrate, so its "bilayer" is live sheet plus
// frozen sheet. A bubble *beneath a bilayer* has no meaning there, because the
// lower layer cannot deform. Here both layers are live.
//
// Layout, bottom to top:
//     substrate   rigid honeycomb at z = 0, Lennard-Jones only
//     layer 1     mobile, sits at zSub above the substrate
//     layer 2     mobile, sits at z0 above layer 1, rotated by twistDeg
//
// The gas pocket is fixed-N with a FREE PEEL FRONT (see graphene-md's
// "bubbleFree"): it pressurises wherever the driven layer stands off by more
// than gasGap, plus a seed disc for nucleation, and p = N k T / V is recomputed
// each step from the volume the layer actually encloses. It can sit either
//     "between"  layer 1 / layer 2   -- lifts layer 2, presses layer 1 down
//     "below"    substrate / layer 1 -- lifts the whole bilayer
// which is the distinction this plugin exists for.
//
// In-plane physics per layer is the same toy model used elsewhere in DSW: Morse
// nearest-neighbour bonds, harmonic second-neighbour springs for shear rigidity,
// and an out-of-plane bending umbrella. Registry and strain are deliberately NOT
// computed here -- they are functions of position, so the analysis scripts apply
// the identical routine to this plugin's frames and to LAMMPS output.

#include "dex_plugin.h"
#include "dex_msg.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

// MSVC and some MinGW headers do not define M_PI without _USE_MATH_DEFINES,
// and this bundle is built with a bare g++ line rather than through CMake.
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

constexpr double NM = 10.0;                 // Å per nm
constexpr double PA_TO_EV_A3 = 6.2415e-12;  // Pa -> eV/Å³
constexpr double KB = 1.380649e-23;
// Registry order parameter: s = sum of three cosines, maximal on AA sites.
constexpr double REG_SMIN = -1.5, REG_SMAX = 3.0;
constexpr double A_LATT = 2.46;             // graphene, Å
constexpr double AREA_ATOM = 2.62;          // Å² per atom
constexpr double C_MASS = 12.011;
constexpr double AMU_A2_FS2_IN_EV = 103.642;

struct Params {
    double Nnm = 30, Nsubnm = 36;   // layer extent, substrate extent (nm)
    double twistDeg = 2.0;          // layer 2 relative to layer 1
    double zSub = 3.35;             // substrate -> layer 1
    double z0 = 3.35;               // layer 1 -> layer 2
    // in-plane
    double De = 4.5, alpha = 1.8, re = 1.42;
    double k2 = 6.0;                // second-neighbour spring
    double kbend = 0.9;
    // van der Waals
    double sigma = 3.42, epsInter = 2.387e-3, epsSub = 2.387e-3;
    bool substrateOn = true;
    // gas
    std::string gasWhere = "between";   // "between" | "below"
    double bubbleRnm = 4, bubbleP = 600, gasT = 300, gasGap = 1.2;
    double Cxnm = 0, Cynm = 0;
    double fillRate = 0.0015;       // fraction of N per step while filling
    // dynamics
    double dt = 0.5, gamma = 1.0, maxDX = 0.25;
    double edgeK = 0.0;             // rim spring, eV/A^2 per atom
    // registry (CSL) colouring
    bool registry = false, regHeightDamp = true;
    double regGamma = 1.0;
    int stepsPerFrame = 20;
};

inline double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

struct Layer {
    std::vector<double> x, y, z, vx, vy, vz, fx, fy, fz;
    std::vector<double> x0, y0, z0r;                 // as-built reference
    std::vector<int32_t> bi, bj;                     // nearest neighbours
    std::vector<int32_t> ai, aj;                     // second neighbours
    std::vector<int32_t> nbOff, nbIdx;               // CSR of NN, for bending
    std::vector<uint8_t> isEdge;                     // undercoordinated rim
    size_t n() const { return x.size(); }
};

struct Instance {
    Params P;
    Layer L1, L2;
    std::vector<double> sx, sy, sz;                  // rigid substrate

    // interlayer / substrate neighbour lists (CSR, rebuilt on displacement)
    std::vector<int32_t> ljOff12, ljIdx12;           // layer2 atom -> layer1 atoms
    std::vector<int32_t> ljOff21, ljIdx21;           // layer1 atom -> layer2 atoms
    std::vector<int32_t> ljOffS, ljIdxS;             // layer1 atom -> substrate
    std::vector<float> reg1, reg2;                   // registry, per atom
    std::vector<double> refX2, refY2, refZ2, refX1, refY1, refZ1;
    bool ljValid = false;
    double ljSkin = 1.5;

    // gas
    bool gasOn = false;
    double gasFill = 0;                              // 0..1, ramps in
    double gasN = 0, gasV = 0, gasP = 0, gasR = 0;

    double ePot = 0, eKin = 0, temperature = 0;
    long long frame = 0;
    bool running = false;
    int pendingSteps = 0;
    double stepMs = 0, statsClock = 0;
    int stepsWindow = 0;

    std::vector<uint8_t> frameBuf;
    std::string outbox;
    bool haveOut = false;
    uint32_t subVersion = 1, sentSubVersion = 0;

    // ------------------------------------------------------------- build

    static void buildSheet(Layer &L, int ncell, double twistRad, double zval) {
        const double a = A_LATT;
        const double a1x = a, a1y = 0.0;
        const double a2x = a * 0.5, a2y = a * std::sqrt(3.0) / 2;
        const double bx = a * 0.5, by = a / (2 * std::sqrt(3.0));
        const int n = ncell;
        const size_t N = (size_t)n * n * 2;
        L.x.assign(N, 0.0); L.y.assign(N, 0.0); L.z.assign(N, zval);
        L.vx.assign(N, 0.0); L.vy.assign(N, 0.0); L.vz.assign(N, 0.0);
        L.fx.assign(N, 0.0); L.fy.assign(N, 0.0); L.fz.assign(N, 0.0);
        const double c = std::cos(twistRad), s = std::sin(twistRad);
        const double half = 0.5 * (n - 1);
        auto id = [n](int i, int j, int k) { return ((j * n + i) * 2 + k); };
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++) {
                const double Rx = a1x * (i - half) + a2x * (j - half);
                const double Ry = a1y * (i - half) + a2y * (j - half);
                const double px[2] = {Rx, Rx + bx};
                const double py[2] = {Ry, Ry + by};
                for (int k = 0; k < 2; k++) {
                    const size_t q = (size_t)id(i, j, k);
                    L.x[q] = c * px[k] - s * py[k];
                    L.y[q] = s * px[k] + c * py[k];
                }
            }
        // topology from the untwisted indices (rotation does not change it)
        L.bi.clear(); L.bj.clear();
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++) {
                const int A = id(i, j, 0), B = id(i, j, 1);
                L.bi.push_back(A); L.bj.push_back(B);
                if (i - 1 >= 0) { L.bi.push_back(A); L.bj.push_back(id(i - 1, j, 1)); }
                if (j - 1 >= 0) { L.bi.push_back(A); L.bj.push_back(id(i, j - 1, 1)); }
            }
        const int off[6][2] = {{1,0},{0,1},{1,-1},{-1,0},{0,-1},{-1,1}};
        L.ai.clear(); L.aj.clear();
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
                for (auto &o : off) {
                    const int I = i + o[0], J = j + o[1];
                    if (I < 0 || I >= n || J < 0 || J >= n) continue;
                    for (int k = 0; k < 2; k++) {
                        const int p = id(i, j, k), q = id(I, J, k);
                        if (q > p) { L.ai.push_back(p); L.aj.push_back(q); }
                    }
                }
        // CSR of nearest neighbours, for the bending umbrella
        std::vector<int32_t> cnt(N + 1, 0);
        for (size_t b = 0; b < L.bi.size(); b++) { cnt[L.bi[b] + 1]++; cnt[L.bj[b] + 1]++; }
        for (size_t q = 0; q < N; q++) cnt[q + 1] += cnt[q];
        L.nbOff = cnt;
        L.nbIdx.assign(L.nbOff[N], 0);
        std::vector<int32_t> cur(L.nbOff.begin(), L.nbOff.end() - 1);
        for (size_t b = 0; b < L.bi.size(); b++) {
            L.nbIdx[cur[L.bi[b]]++] = L.bj[b];
            L.nbIdx[cur[L.bj[b]]++] = L.bi[b];
        }
        // The rim is whatever the lattice left undercoordinated. Interior
        // atoms of a honeycomb have three nearest neighbours; anything with
        // fewer is an edge, whatever shape the flake was cut to.
        L.isEdge.assign(N, 0);
        for (size_t q = 0; q < N; q++)
            if (L.nbOff[q + 1] - L.nbOff[q] < 3) L.isEdge[q] = 1;
        L.x0 = L.x; L.y0 = L.y; L.z0r = L.z;
    }

    void build() {
        const int nc = std::max(4, (int)std::lround(P.Nnm * NM / A_LATT));
        const int ns = std::max(4, (int)std::lround(P.Nsubnm * NM / A_LATT));
        buildSheet(L1, nc, 0.0, P.zSub);
        buildSheet(L2, nc, P.twistDeg * M_PI / 180.0, P.zSub + P.z0);
        // rigid substrate: same lattice, untwisted, at z = 0
        Layer S;
        buildSheet(S, ns, 0.0, 0.0);
        sx = S.x; sy = S.y; sz = S.z;
        subVersion++;
        gasOn = false; gasFill = 0; gasN = gasV = gasP = gasR = 0;
        frame = 0;
        ljValid = false;
        computeForces();
    }

    // -------------------------------------------------- neighbour lists

    // Uniform-grid pair list from `from` (mobile) into `to`, within cut.
    static void pairList(const std::vector<double> &fx_, const std::vector<double> &fy_,
                         const std::vector<double> &tx_, const std::vector<double> &ty_,
                         double cut, std::vector<int32_t> &off, std::vector<int32_t> &idx) {
        const size_t n = fx_.size(), m = tx_.size();
        off.assign(n + 1, 0); idx.clear();
        if (!n || !m) return;
        double lo_x = tx_[0], hi_x = tx_[0], lo_y = ty_[0], hi_y = ty_[0];
        for (size_t i = 1; i < m; i++) {
            lo_x = std::min(lo_x, tx_[i]); hi_x = std::max(hi_x, tx_[i]);
            lo_y = std::min(lo_y, ty_[i]); hi_y = std::max(hi_y, ty_[i]);
        }
        const double cell = std::max(cut, 2.0);
        const int nx = (int)((hi_x - lo_x) / cell) + 3, ny = (int)((hi_y - lo_y) / cell) + 3;
        std::vector<int32_t> cnt((size_t)nx * ny + 1, 0), cellOf(m);
        auto cix = [&](double X) { return std::min(std::max((int)((X - lo_x) / cell) + 1, 0), nx - 1); };
        auto ciy = [&](double Y) { return std::min(std::max((int)((Y - lo_y) / cell) + 1, 0), ny - 1); };
        for (size_t i = 0; i < m; i++) {
            const int c = ciy(ty_[i]) * nx + cix(tx_[i]);
            cellOf[i] = c; cnt[c + 1]++;
        }
        for (size_t c = 0; c < (size_t)nx * ny; c++) cnt[c + 1] += cnt[c];
        std::vector<int32_t> bucket(m), cur(cnt.begin(), cnt.end() - 1);
        for (size_t i = 0; i < m; i++) bucket[cur[cellOf[i]]++] = (int32_t)i;

        const double c2 = cut * cut;
        std::vector<std::vector<int32_t>> per(n);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int ii = 0; ii < (int)n; ii++) {
            const size_t i = (size_t)ii;
            const int gx = cix(fx_[i]), gy = ciy(fy_[i]);
            auto &out = per[i];
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++) {
                    const int X = gx + dx, Y = gy + dy;
                    if (X < 0 || X >= nx || Y < 0 || Y >= ny) continue;
                    const int c = Y * nx + X;
                    for (int q = cnt[c]; q < cnt[c + 1]; q++) {
                        const int j = bucket[q];
                        const double ddx = tx_[j] - fx_[i], ddy = ty_[j] - fy_[i];
                        if (ddx * ddx + ddy * ddy <= c2) out.push_back(j);
                    }
                }
        }
        for (size_t i = 0; i < n; i++) off[i + 1] = off[i] + (int32_t)per[i].size();
        idx.resize(off[n]);
        for (size_t i = 0; i < n; i++)
            std::copy(per[i].begin(), per[i].end(), idx.begin() + off[i]);
    }

    bool ljNeedsRebuild() const {
        if (!ljValid) return true;
        const double half = 0.5 * ljSkin, h2 = half * half;
        for (size_t i = 0; i < L2.n(); i++) {
            const double dx = L2.x[i] - refX2[i], dy = L2.y[i] - refY2[i], dz = L2.z[i] - refZ2[i];
            if (dx * dx + dy * dy + dz * dz > h2) return true;
        }
        for (size_t i = 0; i < L1.n(); i++) {
            const double dx = L1.x[i] - refX1[i], dy = L1.y[i] - refY1[i], dz = L1.z[i] - refZ1[i];
            if (dx * dx + dy * dy + dz * dz > h2) return true;
        }
        return false;
    }

    void buildLJ() {
        const double cut = 3 * P.sigma + ljSkin;
        pairList(L2.x, L2.y, L1.x, L1.y, cut, ljOff12, ljIdx12);
        pairList(L1.x, L1.y, L2.x, L2.y, cut, ljOff21, ljIdx21);
        if (P.substrateOn) pairList(L1.x, L1.y, sx, sy, cut, ljOffS, ljIdxS);
        else { ljOffS.assign(L1.n() + 1, 0); ljIdxS.clear(); }
        refX2 = L2.x; refY2 = L2.y; refZ2 = L2.z;
        refX1 = L1.x; refY1 = L1.y; refZ1 = L1.z;
        ljValid = true;
    }

    // ------------------------------------------------------------ forces

    static double inPlane(Layer &L, const Params &P) {
        const size_t n = L.n();
        double pe = 0;
        for (size_t b = 0; b < L.bi.size(); b++) {
            const int i = L.bi[b], j = L.bj[b];
            const double dx = L.x[j] - L.x[i], dy = L.y[j] - L.y[i], dz = L.z[j] - L.z[i];
            double d = std::sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-9) d = 1e-9;
            const double ex = std::exp(-P.alpha * (d - P.re));
            const double fm = 2 * P.De * P.alpha * ex * (1 - ex);
            pe += P.De * ((1 - ex) * (1 - ex) - 1);
            const double ux = dx / d, uy = dy / d, uz = dz / d;
            L.fx[i] += fm * ux; L.fy[i] += fm * uy; L.fz[i] += fm * uz;
            L.fx[j] -= fm * ux; L.fy[j] -= fm * uy; L.fz[j] -= fm * uz;
        }
        const double r2nd = std::sqrt(3.0) * P.re;
        for (size_t b = 0; b < L.ai.size(); b++) {
            const int i = L.ai[b], j = L.aj[b];
            const double dx = L.x[j] - L.x[i], dy = L.y[j] - L.y[i], dz = L.z[j] - L.z[i];
            double d = std::sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-9) d = 1e-9;
            const double xx = d - r2nd, f = P.k2 * xx;
            pe += 0.5 * P.k2 * xx * xx;
            const double ux = dx / d, uy = dy / d, uz = dz / d;
            L.fx[i] += f * ux; L.fy[i] += f * uy; L.fz[i] += f * uz;
            L.fx[j] -= f * ux; L.fy[j] -= f * uy; L.fz[j] -= f * uz;
        }
        // bending: penalise an atom's height against the mean of its neighbours
        if (P.kbend > 0) {
            const double kb = P.kbend;
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : pe)
#endif
            for (int ii = 0; ii < (int)n; ii++) {
                const size_t i = (size_t)ii;
                const int s = L.nbOff[i], e = L.nbOff[i + 1];
                if (e <= s) continue;
                double za = 0;
                for (int q = s; q < e; q++) za += L.z[L.nbIdx[q]];
                const double dzb = L.z[i] - za / (e - s);
                L.fz[i] += -kb * dzb;
                pe += 0.5 * kb * dzb * dzb;
            }
        }
        return pe;
    }

    // 12-6 from a mobile layer onto a target set, accumulating force ONLY on the
    // mobile side. Nothing is scattered to the target, so the loop parallelises
    // cleanly; the reaction is obtained by running the transposed list in the
    // other direction. That doubles the pair work and divides it by the thread
    // count, which is a large net win. `wantPe` counts the energy once.
    static double ljPairs(const std::vector<double> &ax, const std::vector<double> &ay,
                          const std::vector<double> &az,
                          std::vector<double> &afx, std::vector<double> &afy,
                          std::vector<double> &afz,
                          const std::vector<double> &bx, const std::vector<double> &by,
                          const std::vector<double> &bz,
                          const std::vector<int32_t> &off, const std::vector<int32_t> &idx,
                          double sigma, double eps, bool wantPe) {
        const double cut2 = 9 * sigma * sigma, sig2 = sigma * sigma;
        double pe = 0;
        const int n = (int)ax.size();
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : pe)
#endif
        for (int i = 0; i < n; i++) {
            double Fx = 0, Fy = 0, Fz = 0, e = 0;
            for (int q = off[i]; q < off[i + 1]; q++) {
                const int j = idx[q];
                const double dx = bx[j] - ax[i], dy = by[j] - ay[i], dz = bz[j] - az[i];
                const double r2 = dx * dx + dy * dy + dz * dz;
                if (r2 > cut2 || r2 < 1e-8) continue;
                const double s2 = sig2 / r2, s6 = s2 * s2 * s2, s12 = s6 * s6;
                if (wantPe) e += 4 * eps * (s12 - s6);
                const double fm = 24 * eps * (2 * s12 - s6) / r2;
                Fx -= fm * dx; Fy -= fm * dy; Fz -= fm * dz;
            }
            afx[i] += Fx; afy[i] += Fy; afz[i] += Fz;
            pe += e;
        }
        return pe;
    }

    // Which layer the gas drives, and the reference plane it is measured from.
    Layer &drivenLayer() { return P.gasWhere == "below" ? L1 : L2; }
    Layer *pressedLayer() { return P.gasWhere == "below" ? nullptr : &L1; }
    double gasRefZ() const { return P.gasWhere == "below" ? P.zSub : P.zSub + P.z0; }

    bool gasWets(const Layer &L, size_t i, double R2, double cx, double cy, double href) const {
        const double dx = L.x[i] - cx, dy = L.y[i] - cy;
        if (dx * dx + dy * dy < R2) return true;
        return (L.z[i] - href) > P.gasGap;
    }

    void gasState() {
        Layer &D = drivenLayer();
        const double R2 = P.bubbleRnm * NM * P.bubbleRnm * NM;
        const double cx = P.Cxnm * NM, cy = P.Cynm * NM;
        const double href = gasRefZ();
        double V = 0, r2max = 0;
        const int n = (int)D.n();
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : V) reduction(max : r2max)
#endif
        for (int ii = 0; ii < n; ii++) {
            const size_t i = (size_t)ii;
            if (!gasWets(D, i, R2, cx, cy, href)) continue;
            const double h = D.z[i] - href;
            if (h > 0) V += h * AREA_ATOM;
            const double dx = D.x[i] - cx, dy = D.y[i] - cy;
            const double d2 = dx * dx + dy * dy;
            if (d2 > r2max) r2max = d2;
        }
        const double Vmin = M_PI * R2 * 0.5;
        gasV = V > Vmin ? V : Vmin;
        gasR = std::sqrt(r2max);
        // N fixed from the requested pressure at the Hencky volume of the seed
        const double R = P.bubbleRnm * NM;
        const double h0 = 0.709 * R * std::cbrt(P.bubbleP * 1e6 * (R * 1e-10) / 340.0);
        const double Vh = 0.6 * M_PI * h0 * R * R * 1e-30;
        const double kT = KB * (P.gasT > 0 ? P.gasT : 300.0);
        const double Ntot = Vh > 0 ? (P.bubbleP * 1e6) * Vh / kT : 0;
        gasN = Ntot * gasFill;
        gasP = gasN > 0 ? gasN * kT / (gasV * 1e-30) : 0.0;
    }

    void computeForces() {
        if (ljNeedsRebuild()) buildLJ();
        for (Layer *L : {&L1, &L2}) {
            std::fill(L->fx.begin(), L->fx.end(), 0.0);
            std::fill(L->fy.begin(), L->fy.end(), 0.0);
            std::fill(L->fz.begin(), L->fz.end(), 0.0);
        }
        double pe = 0;
        pe += inPlane(L1, P);
        pe += inPlane(L2, P);
        // interlayer, both directions; energy counted once
        pe += ljPairs(L2.x, L2.y, L2.z, L2.fx, L2.fy, L2.fz,
                      L1.x, L1.y, L1.z, ljOff12, ljIdx12, P.sigma, P.epsInter, true);
        ljPairs(L1.x, L1.y, L1.z, L1.fx, L1.fy, L1.fz,
                L2.x, L2.y, L2.z, ljOff21, ljIdx21, P.sigma, P.epsInter, false);
        // substrate is rigid, so only layer 1 feels it
        if (P.substrateOn)
            pe += ljPairs(L1.x, L1.y, L1.z, L1.fx, L1.fy, L1.fz,
                          sx, sy, sz, ljOffS, ljIdxS, P.sigma, P.epsSub, true);

        if (gasOn) {
            gasState();
            const double f = gasP * PA_TO_EV_A3 * AREA_ATOM;
            Layer &D = drivenLayer();
            Layer *Pl = pressedLayer();
            const double R2 = P.bubbleRnm * NM * P.bubbleRnm * NM;
            const double cx = P.Cxnm * NM, cy = P.Cynm * NM, href = gasRefZ();
            const int n = (int)D.n();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
            for (int ii = 0; ii < n; ii++) {
                const size_t i = (size_t)ii;
                if (gasWets(D, i, R2, cx, cy, href)) D.fz[i] += f;
            }
            // Newton's third law: the gas presses the layer below down just as
            // hard. Omitting it would let a bubble between the layers lift the
            // top sheet without pushing the bottom one onto the substrate.
            if (Pl) {
                const int m = (int)Pl->n();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
                for (int ii = 0; ii < m; ii++) {
                    const size_t i = (size_t)ii;
                    const double dx = Pl->x[i] - cx, dy = Pl->y[i] - cy;
                    if (dx * dx + dy * dy < gasR * gasR) Pl->fz[i] -= f;
                }
            }
        }
        ePot = pe;
    }

    // Hold the rim to where it was built. Without this a blister feeds
    // itself by dragging the whole flake inward, and the radius you measure
    // is partly the sheet walking rather than the blister growing.
    double edgeClamp(Layer &L) {
        const double k = P.edgeK;
        if (k <= 0 || L.isEdge.empty()) return 0.0;   // exactly the old path
        const int n = (int)L.n();
        double pe = 0;
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : pe)
#endif
        for (int ii = 0; ii < n; ii++) {
            const size_t i = (size_t)ii;
            if (!L.isEdge[i]) continue;
            const double dx = L.x[i] - L.x0[i];
            const double dy = L.y[i] - L.y0[i];
            const double dz = L.z[i] - L.z0r[i];
            L.fx[i] -= k * dx; L.fy[i] -= k * dy; L.fz[i] -= k * dz;
            pe += 0.5 * k * (dx * dx + dy * dy + dz * dz);
        }
        return pe;
    }

    void integrate(Layer &L) {
        const double g = P.gamma, dt = P.dt, m = C_MASS;
        const int n = (int)L.n();
        double ke = 0;
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : ke)
#endif
        for (int ii = 0; ii < n; ii++) {
            const size_t i = (size_t)ii;
            L.vx[i] += ((L.fx[i] - g * L.vx[i]) / m) * dt;
            L.vy[i] += ((L.fy[i] - g * L.vy[i]) / m) * dt;
            L.vz[i] += ((L.fz[i] - g * L.vz[i]) / m) * dt;
            double dx = L.vx[i] * dt, dy = L.vy[i] * dt, dz = L.vz[i] * dt;
            const double s = std::sqrt(dx * dx + dy * dy + dz * dz);
            if (s > P.maxDX) { const double k = P.maxDX / s; dx *= k; dy *= k; dz *= k; }
            L.x[i] += dx; L.y[i] += dy; L.z[i] += dz;
            ke += L.vx[i] * L.vx[i] + L.vy[i] * L.vy[i] + L.vz[i] * L.vz[i];
        }
        eKin += 0.5 * C_MASS * AMU_A2_FS2_IN_EV * ke;
    }

    void step() {
        if (gasOn && gasFill < 1.0) gasFill = clampd(gasFill + P.fillRate, 0, 1);
        computeForces();
        ePot += edgeClamp(L1) + edgeClamp(L2);
        eKin = 0;
        integrate(L1);
        integrate(L2);
        const size_t nt = L1.n() + L2.n();
        temperature = nt ? (2.0 * eKin) / (3.0 * (double)nt * 8.617333262e-5) : 0;
        frame++; stepsWindow++;
    }

    // ------------------------------------------------- registry

    // s(r) = sum_k cos(G_k . r) over the three first-shell reciprocal vectors
    // of the UNROTATED lattice; t = 1 - (s - s_min)/(s_max - s_min), so t = 0
    // on an AA coincidence site and 1 in the hollow. The slow beat of those
    // maxima across the twisted layer is the moire.
    //
    // Layer 2 is measured against layer 1, layer 1 against the substrate. Only
    // layer 2 carries the twist, so one set of G vectors serves both.
    void computeRegistry() {
        const size_t n1 = L1.n(), n2 = L2.n();
        reg1.assign(n1, 0.0f);
        reg2.assign(n2, 0.0f);
        const double g = 4 * M_PI / (std::sqrt(3.0) * A_LATT);
        double Gx[3], Gy[3];
        for (int k = 0; k < 3; k++) {
            const double ang = M_PI / 2 + k * 2 * M_PI / 3;
            Gx[k] = g * std::cos(ang); Gy[k] = g * std::sin(ang);
        }
        const double gam = P.regGamma > 0 ? P.regGamma : 1;
        const bool damp = P.regHeightDamp;

        // One layer's worth. `oz` is the spacing this pair sits at when flat,
        // and the pair list gives the partner atoms to measure it against;
        // where the local gap has opened (a blister) the colour fades out,
        // because registry is meaningless once the layers are apart.
        auto pass = [&](const Layer &L, std::vector<float> &out,
                        const std::vector<double> &pz,
                        const std::vector<double> &px,
                        const std::vector<double> &py,
                        const std::vector<int32_t> &off,
                        const std::vector<int32_t> &idx,
                        double oz, bool haveList) {
            const int n = (int)L.n();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
            for (int ii = 0; ii < n; ii++) {
                const size_t i = (size_t)ii;
                double s = 0;
                for (int k = 0; k < 3; k++)
                    s += std::cos(Gx[k] * L.x[i] + Gy[k] * L.y[i]);
                double t = 1.0 - (s - REG_SMIN) / (REG_SMAX - REG_SMIN);
                t = clampd(t, 0.0, 1.0);
                if (gam != 1) t = std::pow(t, gam);
                if (damp && haveList && !off.empty()) {
                    // nearest partner in plane, then how far off `oz` it sits
                    double best = 1e30, bz = 0;
                    for (int k = off[i]; k < off[i + 1]; k++) {
                        const int j = idx[k];
                        const double dx = px[j] - L.x[i], dy = py[j] - L.y[i];
                        const double d2 = dx * dx + dy * dy;
                        if (d2 < best) { best = d2; bz = std::fabs(pz[j] - L.z[i]); }
                    }
                    if (best < 1e29) {
                        const double dev = std::fabs(bz - oz);
                        // fully faded once the gap is 1 A off the flat value
                        const double w = clampd(1.0 - dev, 0.0, 1.0);
                        t = 1.0 - (1.0 - t) * w;
                    }
                }
                out[i] = (float)t;
            }
        };

        pass(L2, reg2, L1.z, L1.x, L1.y, ljOff12, ljIdx12, P.z0, true);
        pass(L1, reg1, sz, sx, sy, ljOffS, ljIdxS, P.zSub, P.substrateOn);
    }

    // ------------------------------------------------- wire protocol
    //   magic 'MBL1', flags, n1, n2, nsub, frame, ePot, eKin
    //   float l1[3n1], l2[3n2], [sub[3nsub] if flags & 2]
    static const uint32_t MAGIC = 0x314C424Du;   // 'MBL1'

    void packFrame() {
        const uint32_t n1 = (uint32_t)L1.n(), n2 = (uint32_t)L2.n(), ns = (uint32_t)sx.size();
        uint32_t flags = 0;
        if (subVersion != sentSubVersion) flags |= 2;
        if (P.registry) { computeRegistry(); flags |= 4; }
        size_t words = 8 + 3ull * n1 + 3ull * n2 + ((flags & 2) ? 3ull * ns : 0)
                     + ((flags & 4) ? (size_t)n1 + n2 : 0);
        frameBuf.resize(words * 4);
        uint8_t *p = frameBuf.data();
        auto u32 = [&](uint32_t v) { memcpy(p, &v, 4); p += 4; };
        auto f32 = [&](float v) { memcpy(p, &v, 4); p += 4; };
        u32(MAGIC); u32(flags); u32(n1); u32(n2); u32(ns); u32((uint32_t)frame);
        f32((float)ePot); f32((float)eKin);
        for (uint32_t i = 0; i < n1; i++) { f32((float)L1.x[i]); f32((float)L1.y[i]); f32((float)L1.z[i]); }
        for (uint32_t i = 0; i < n2; i++) { f32((float)L2.x[i]); f32((float)L2.y[i]); f32((float)L2.z[i]); }
        if (flags & 2) {
            for (uint32_t i = 0; i < ns; i++) { f32((float)sx[i]); f32((float)sy[i]); f32((float)sz[i]); }
            sentSubVersion = subVersion;
        }
        // Registry rides at the END, so a reader that did not ask for it sees
        // exactly the frame it always saw.
        if (flags & 4) {
            for (uint32_t i = 0; i < n1; i++) f32(reg1[i]);
            for (uint32_t i = 0; i < n2; i++) f32(reg2[i]);
        }
    }

    void say(const std::string &s) { outbox = s; haveOut = true; }

    void sayState(long q) {
        char buf[720];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"state\",\"q\":%ld,\"n1\":%d,\"n2\":%d,\"nsub\":%d,"
                 "\"frame\":%lld,\"epot\":%.6g,\"ekin\":%.6g,\"temp\":%.4g,"
                 "\"gas\":%d,\"gasWhere\":\"%s\",\"fill\":%.3f,"
                 "\"gasN\":%.6g,\"gasV\":%.6g,\"gasP\":%.6g,\"gasR\":%.4g,"
                 "\"twist\":%.4g,\"running\":%d,\"ms\":%.3f,\"sps\":%.0f,\"threads\":%d}",
                 q, (int)L1.n(), (int)L2.n(), (int)sx.size(), frame, ePot, eKin, temperature,
                 gasOn ? 1 : 0, P.gasWhere.c_str(), gasFill,
                 gasN, gasV, gasP, gasR, P.twistDeg,
                 running ? 1 : 0, stepMs,
                 statsClock > 0 ? stepsWindow / statsClock : 0.0,
#ifdef _OPENMP
                 omp_get_max_threads()
#else
                 1
#endif
        );
        say(buf);
    }

    void readParams(const std::string &m) {
        auto num = [&](const char *k, double d) { return dexmsg::get_num(m, k, d); };
        P.De = num("De", P.De); P.alpha = num("alpha", P.alpha); P.re = num("re", P.re);
        P.k2 = num("k2", P.k2); P.kbend = num("kbend", P.kbend);
        P.sigma = num("sigma", P.sigma);
        P.epsInter = num("epsInter", P.epsInter); P.epsSub = num("epsSub", P.epsSub);
        P.substrateOn = num("substrateOn", P.substrateOn ? 1 : 0) != 0;
        P.bubbleRnm = num("bubbleRnm", P.bubbleRnm);
        P.bubbleP = num("bubbleP", P.bubbleP);
        P.gasT = num("gasT", P.gasT); P.gasGap = num("gasGap", P.gasGap);
        P.Cxnm = num("Cxnm", P.Cxnm); P.Cynm = num("Cynm", P.Cynm);
        P.fillRate = num("fillRate", P.fillRate);
        P.dt = num("dt", P.dt); P.gamma = num("gamma", P.gamma);
        P.maxDX = num("maxDX", P.maxDX);
        P.edgeK = num("edgeK", P.edgeK);
        P.stepsPerFrame = std::max(1, (int)num("stepsPerFrame", P.stepsPerFrame));
        P.registry = num("registry", P.registry ? 1 : 0) != 0;
        P.regGamma = num("regGamma", P.regGamma);
        P.regHeightDamp = num("regHeightDamp", P.regHeightDamp ? 1 : 0) != 0;
        const std::string w = dexmsg::get_str(m, "gasWhere");
        if (w == "below" || w == "between") P.gasWhere = w;
    }

    void handle(const std::string &m) {
        const std::string t = dexmsg::type_of(m);
        const long q = (long)dexmsg::get_num(m, "q", -1);
        if (t == "build") {
            readParams(m);
            P.Nnm = dexmsg::get_num(m, "Nnm", P.Nnm);
            P.Nsubnm = dexmsg::get_num(m, "Nsubnm", P.Nsubnm);
            P.twistDeg = dexmsg::get_num(m, "twistDeg", P.twistDeg);
            P.zSub = dexmsg::get_num(m, "zSub", P.zSub);
            P.z0 = dexmsg::get_num(m, "z0", P.z0);
            build();
            sayState(q);
        } else if (t == "params") {
            readParams(m); ljValid = false; computeForces(); sayState(q);
        } else if (t == "gas") {
            gasOn = dexmsg::get_num(m, "on", 0) != 0;
            if (!gasOn) gasFill = 0;
            running = running || gasOn;
            sayState(q);
        } else if (t == "run") {
            running = dexmsg::get_num(m, "on", 0) != 0; sayState(q);
        } else if (t == "step") {
            pendingSteps += std::max(1, (int)dexmsg::get_num(m, "n", 1)); sayState(q);
        } else if (t == "reset") {
            L1.x = L1.x0; L1.y = L1.y0; L1.z = L1.z0r;
            L2.x = L2.x0; L2.y = L2.y0; L2.z = L2.z0r;
            for (Layer *L : {&L1, &L2}) {
                std::fill(L->vx.begin(), L->vx.end(), 0.0);
                std::fill(L->vy.begin(), L->vy.end(), 0.0);
                std::fill(L->vz.begin(), L->vz.end(), 0.0);
            }
            gasOn = false; gasFill = 0; frame = 0; ljValid = false;
            computeForces(); sayState(q);
        } else if (t == "state") {
            sayState(q);
        }
    }
};

}  // namespace

extern "C" {
void *mb_create() { Instance *s = new Instance(); s->build(); return s; }
void mb_destroy(void *p) { delete (Instance *)p; }

int mb_advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    int budget = 0;
    if (s->running) budget = s->P.stepsPerFrame;
    else if (s->pendingSteps > 0) { budget = s->pendingSteps; s->pendingSteps = 0; }
    if (budget <= 0) return 0;
    const auto t0 = std::chrono::steady_clock::now();
    int done = 0; bool cutShort = false;
    for (int i = 0; i < budget; i++) {
        s->step(); done++;
        if (std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() > 0.010) {
            cutShort = true; break;
        }
    }
    // Give back what the responsiveness cap cut short, or an explicit "step n"
    // is silently truncated (the bug graphene-md shipped with).
    if (cutShort && !s->running) s->pendingSteps += budget - done;
    s->stepMs = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t0).count() / std::max(done, 1);
    s->statsClock += dt;
    if (s->statsClock >= 0.5) { s->sayState(-1); s->statsClock = 0; s->stepsWindow = 0; }
    return 1;
}

void mb_on_message(void *p, const char *json, size_t len) {
    ((Instance *)p)->handle(std::string(json, len));
}
const char *mb_poll(void *p) {
    Instance *s = (Instance *)p;
    if (!s->haveOut) return nullptr;
    s->haveOut = false;
    return s->outbox.c_str();
}
int mb_render(void *p, dex_frame *out) {
    Instance *s = (Instance *)p;
    s->packFrame();
    out->width = (uint32_t)(s->frameBuf.size() / 4);
    out->height = 1;
    out->rgba = s->frameBuf.data();
    return 1;
}
}

static const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "moire-bubble",
    "Moire Bubbles in Bilayers",
    "1.0",
    mb_create, mb_destroy, mb_advance, mb_on_message, mb_poll, mb_render,
};

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) { return &API; }
