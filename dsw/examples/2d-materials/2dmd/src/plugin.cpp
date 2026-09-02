// 2dmd — one plugin, a stack of layers.
//
// PHASE 1 of DSW/2DMD-DESIGN.md: the layer stack and the Morse CPU engine.
// LAMMPS, the GPU engine and the other materials arrive in later phases; this
// file deliberately contains only what moire-bubble and graphene-md's classic
// engine already did, restructured.
//
// The change that matters is that geometry is a LIST:
//
//     layers[0]        rigid substrate            mobile = false
//     layers[1..N]     live sheets, bottom to top mobile = true
//
// A monolayer on a substrate is two entries. A twisted bilayer is three. "Gas
// below the bilayer" stops being a special case and becomes "gas in gap 0",
// where gap g sits between layers[g] and layers[g+1]. Layer count is a
// parameter rather than an architecture, which is the whole point: every other
// item on the plan is cheap once this holds and expensive while it does not.
//
// The physics is carried over unchanged from moire-bubble on purpose — Morse
// nearest neighbours, harmonic second neighbours, a bending umbrella, 12-6
// between adjacent layers, fixed-N gas with a free peel front. Phase 1 is a
// restructuring, not a new model, and it is accepted by reproducing that
// plugin's measured numbers.
//
// One honest caveat on rounding: moire-bubble summed the interlayer energy
// before the substrate term, and this iterates gaps bottom-up, so the last bits
// of ePot differ. Everything measured is far above that.

#include "dex_plugin.h"
#include "dex_msg.h"
#include "dmexport.h"

#include <fstream>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

#ifdef DMD_LAMMPS
#include "library.h"
#endif

namespace {

#ifdef DMD_LAMMPS
#ifdef _WIN32
#include <windows.h>
static std::string bundleDir() {
    char buf[MAX_PATH];
    HMODULE h = nullptr;
    GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                       GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       (LPCSTR)&bundleDir, &h);
    const DWORD n = GetModuleFileNameA(h, buf, MAX_PATH);
    std::string p(buf, n);
    const size_t cut = p.find_last_of("/\\");
    return cut == std::string::npos ? std::string(".") : p.substr(0, cut);
}
#else
static std::string bundleDir() { return "."; }
#endif
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

constexpr double NM = 10.0;                 // Å per nm
constexpr double PA_TO_EV_A3 = 6.2415e-12;  // Pa -> eV/Å³
constexpr double KB = 1.380649e-23;
constexpr double REG_SMIN = -1.5, REG_SMAX = 3.0;
constexpr double A_LATT = 2.46;             // graphene, Å
constexpr double AREA_ATOM = 2.62;          // Å² per atom
constexpr double C_MASS = 12.011;
constexpr double AMU_A2_FS2_IN_EV = 103.642;

constexpr int MAX_MOBILE = 4;               // sheets above the substrate

struct Params {
    int nLayers = 2;                // MOBILE sheets; the substrate is extra
    double Nnm = 30, Nsubnm = 36;
    double twistDeg = 2.0;          // cumulative: sheet i is twisted i*twistDeg
    double zSub = 3.35;             // substrate -> sheet 1
    double z0 = 3.35;               // sheet -> sheet
    // in-plane
    double De = 4.5, alpha = 1.8, re = 1.42;
    double k2 = 6.0;
    double kbend = 0.9;
    // van der Waals
    double sigma = 3.42, epsInter = 2.387e-3, epsSub = 2.387e-3;
    bool substrateOn = true;
    bool subTab = true;             // tabulate the rigid substrate field
    int subGrid = 48;               // cells per lattice vector; the accuracy knob
    // gas
    int gasGapIdx = 1;              // gap g is between layers[g] and layers[g+1]
    // "bubbleFree" (default) | "bubbleN" | "bubble"; see gasState()
    std::string profile = "bubbleFree";
    double betweenBoost = 1.0;      // the open-loop model's fudge, off by default
    double bubbleRnm = 4, bubbleP = 600, gasT = 300, gasGap = 1.2;
    double Cxnm = 0, Cynm = 0;
    double fillRate = 0.0015;
    // dynamics
    double dt = 0.5, gamma = 1.0, maxDX = 0.25;
    double edgeK = 0.0;
    // registry
    bool registry = false, regHeightDamp = true;
    bool strain = false;            // per-atom bond dilatation
    double regGamma = 1.0;
    int stepsPerFrame = 20;
    // "classic" = the Morse toy model in this file; "lammps" = real potentials.
    std::string engine = "classic";
    std::string material = "graphene";
};

inline double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

struct Layer {
    std::vector<double> x, y, z, vx, vy, vz, fx, fy, fz;
    std::vector<double> x0, y0, z0r;                 // as-built reference
    std::vector<int32_t> bi, bj;                     // nearest neighbours
    std::vector<int32_t> ai, aj;                     // second neighbours
    std::vector<int32_t> nbOff, nbIdx;               // CSR of NN, for bending
    std::vector<uint8_t> isEdge;                     // undercoordinated rim
    std::vector<float> reg;                          // registry against the layer below
    std::vector<float> strain;                       // mean bond dilatation
    std::vector<double> b0;                          // as-built bond lengths
    double twistRad = 0;
    double zRest = 0;                                // where this layer sits when flat
    bool mobile = true;
    size_t n() const { return x.size(); }
};

// One direction of a pair list: atoms of layer `from` looking at layer `to`.
// Both directions are built for a mobile/mobile gap so each side can accumulate
// its own force without scattering into its neighbour's array.
struct LJList {
    int from = 0, to = 0;
    bool countEnergy = false;
    double eps = 0;                 // which pair this is: substrate or interlayer
    std::vector<int32_t> off, idx;
};

struct Instance {
    Params P;
    std::vector<Layer> layers;      // [0] is the substrate
    std::vector<LJList> ljs;
    std::vector<std::vector<double>> ljRefX, ljRefY, ljRefZ;   // per layer
    bool ljValid = false;
    double ljSkin = 1.5;

    bool gasOn = false;
    double gasFill = 0;
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
    uint32_t geomVersion = 1, sentGeomVersion = 0;

#ifdef DMD_LAMMPS
    void *lmp = nullptr;
    std::string lmpError;
    int64_t lmpLastTs = -1;
    // global LAMMPS atom index -> (layer, index within layer)
    std::vector<int32_t> gLayer, gLocal;
    std::vector<int32_t> layerBase;          // first global index of each layer
#endif

    int nMobile() const { return (int)layers.size() - 1; }
    // gap g lies between layers[g] and layers[g+1]
    int nGaps() const { return (int)layers.size() - 1; }
    double epsForGap(int g) const { return g == 0 ? P.epsSub : P.epsInter; }

    // --------------------------------------------- tabulated substrate
    //
    // U(x,y,z) of a rigid periodic sheet, sampled over one unit cell. Lookup is
    // ~8 reads and a trilinear blend instead of ~180 pair evaluations, and the
    // field is identical for every atom and every step, so building it once is
    // strictly better than rediscovering it.
    struct SubTable {
        int nu = 0, nv = 0, nz = 0;
        double z0 = 0, z1 = 0, dz = 0;
        std::vector<float> U, Fx, Fy, Fz;
        bool ready() const { return nz > 0; }
        size_t at(int iu, int iv, int iz) const {
            return ((size_t)iz * nv + iv) * nu + iu;
        }
    } subTab;

    // Fractional coordinates in the lattice basis a1=(a,0), a2=(a/2, a*sqrt3/2),
    // measured against the SUBSTRATE'S OWN ORIGIN. buildSheet centres a sheet on
    // (i-half, j-half), so with an even cell count there is no lattice site at
    // (0,0) and a table built about the origin sits half a lattice vector out of
    // registry with the real substrate. That error does not shrink with grid
    // resolution, which is how it was caught.
    double subHalf = 0;              // the substrate's centring offset
    void fracOf(double x, double y, double &u, double &v) const {
        const double s3 = std::sqrt(3.0);
        v = 2.0 * y / (s3 * A_LATT) + subHalf;
        u = (x - y / s3) / A_LATT + subHalf;
        u -= std::floor(u);
        v -= std::floor(v);
    }

    void buildSubTable() {
        subTab = SubTable();
        if (!P.substrateOn || !P.subTab) return;
        const int N = std::max(8, std::min(256, P.subGrid));
        const double cut = 3 * P.sigma;
        subTab.nu = N; subTab.nv = N;
        subTab.z0 = 1.6; subTab.z1 = cut + 0.2;
        // z must refine with the knob too. It did not, and the accuracy test
        // correctly refused to improve however fine the in-plane grid got:
        // the z direction was pinned at 0.12 A and was the dominant error.
        // Match the in-plane cell size so subGrid means one thing.
        const double dzWant = A_LATT / N;
        subTab.nz = std::max(16, (int)std::lround((subTab.z1 - subTab.z0) / dzWant) + 1);
        subTab.dz = (subTab.z1 - subTab.z0) / (subTab.nz - 1);
        const size_t n = (size_t)subTab.nu * subTab.nv * subTab.nz;
        subTab.U.assign(n, 0.f); subTab.Fx.assign(n, 0.f);
        subTab.Fy.assign(n, 0.f); subTab.Fz.assign(n, 0.f);

        // Lattice points of the periodic substrate within the cutoff. Built
        // from the lattice rather than from the finite substrate array so the
        // table does not inherit that array's edges.
        const double a = A_LATT, s3 = std::sqrt(3.0);
        const double bx = a * 0.5, by = a / (2 * s3);
        std::vector<double> px, py;
        const int R = (int)std::ceil(cut / a) + 2;
        for (int j = -R; j <= R; j++)
            for (int i = -R; i <= R; i++) {
                const double Rx = a * i + bx * j * 0 + a * 0.5 * j;
                const double Ry = a * s3 / 2 * j;
                px.push_back(Rx);      py.push_back(Ry);
                px.push_back(Rx + bx); py.push_back(Ry + by);
            }

        const double sig2 = P.sigma * P.sigma, cut2 = cut * cut;
        const double eps = P.epsSub;
        const int nu = subTab.nu, nv = subTab.nv, nz = subTab.nz;
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int iz = 0; iz < nz; iz++) {
            const double z = subTab.z0 + iz * subTab.dz;
            for (int iv = 0; iv < nv; iv++)
                for (int iu = 0; iu < nu; iu++) {
                    // the sample point, in real space
                    const double fu = (double)iu / nu, fv = (double)iv / nv;
                    const double X = a * fu + a * 0.5 * fv;
                    const double Y = a * s3 / 2 * fv;
                    double U = 0, Fx = 0, Fy = 0, Fz = 0;
                    for (size_t k = 0; k < px.size(); k++) {
                        const double dx = px[k] - X, dy = py[k] - Y, dz = -z;
                        const double r2 = dx * dx + dy * dy + dz * dz;
                        if (r2 > cut2 || r2 < 1e-8) continue;
                        const double t2 = sig2 / r2, t6 = t2 * t2 * t2, t12 = t6 * t6;
                        U += 4 * eps * (t12 - t6);
                        const double fm = 24 * eps * (2 * t12 - t6) / r2;
                        Fx -= fm * dx; Fy -= fm * dy; Fz -= fm * dz;
                    }
                    const size_t q = subTab.at(iu, iv, iz);
                    subTab.U[q] = (float)U;  subTab.Fx[q] = (float)Fx;
                    subTab.Fy[q] = (float)Fy; subTab.Fz[q] = (float)Fz;
                }
        }
    }

    // Trilinear lookup, periodic in the plane. Returns energy; adds the force.
    double subLookup(double x, double y, double z,
                     double &fx, double &fy, double &fz) const {
        if (!subTab.ready()) return 0.0;
        if (z >= subTab.z1) return 0.0;
        const double zc = z < subTab.z0 ? subTab.z0 : z;
        double u, v; fracOf(x, y, u, v);
        const double gu = u * subTab.nu, gv = v * subTab.nv;
        const double gz = (zc - subTab.z0) / subTab.dz;
        int iu = (int)gu, iv = (int)gv, iz = (int)gz;
        if (iz > subTab.nz - 2) iz = subTab.nz - 2;
        const double tu = gu - iu, tv = gv - iv, tz = gz - iz;
        const int iu1 = (iu + 1) % subTab.nu, iv1 = (iv + 1) % subTab.nv;
        iu %= subTab.nu; iv %= subTab.nv;
        const int ix[8][3] = {{iu,iv,iz},{iu1,iv,iz},{iu,iv1,iz},{iu1,iv1,iz},
                              {iu,iv,iz+1},{iu1,iv,iz+1},{iu,iv1,iz+1},{iu1,iv1,iz+1}};
        const double w[8] = {
            (1-tu)*(1-tv)*(1-tz), tu*(1-tv)*(1-tz), (1-tu)*tv*(1-tz), tu*tv*(1-tz),
            (1-tu)*(1-tv)*tz,     tu*(1-tv)*tz,     (1-tu)*tv*tz,     tu*tv*tz };
        double U = 0, Fx = 0, Fy = 0, Fz = 0;
        for (int k = 0; k < 8; k++) {
            const size_t q = subTab.at(ix[k][0], ix[k][1], ix[k][2]);
            U  += w[k] * subTab.U[q];  Fx += w[k] * subTab.Fx[q];
            Fy += w[k] * subTab.Fy[q]; Fz += w[k] * subTab.Fz[q];
        }
        fx += Fx; fy += Fy; fz += Fz;
        return U;
    }

    // Whole-layer version, replacing that layer's substrate pair sum.
    double subTabLayer(Layer &L) {
        double pe = 0;
        const int n = (int)L.n();
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : pe)
#endif
        for (int ii = 0; ii < n; ii++) {
            const size_t i = (size_t)ii;
            double fx = 0, fy = 0, fz = 0;
            pe += subLookup(L.x[i], L.y[i], L.z[i] - layers[0].zRest, fx, fy, fz);
            L.fx[i] += fx; L.fy[i] += fy; L.fz[i] += fz;
        }
        return pe;
    }

    bool subTabActive() const { return P.substrateOn && P.subTab && subTab.ready(); }

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
        L.isEdge.assign(N, 0);
        for (size_t q = 0; q < N; q++)
            if (L.nbOff[q + 1] - L.nbOff[q] < 3) L.isEdge[q] = 1;
        L.x0 = L.x; L.y0 = L.y; L.z0r = L.z;
        // Reference bond lengths, measured rather than assumed: the lattice is
        // built at A_LATT, not at P.re, so a bond is not re long at t = 0 and a
        // strain taken against re would report a uniform offset everywhere.
        L.b0.assign(L.bi.size(), 0.0);
        for (size_t b = 0; b < L.bi.size(); b++) {
            const int i = L.bi[b], j = L.bj[b];
            const double dx = L.x[j] - L.x[i], dy = L.y[j] - L.y[i], dz = L.z[j] - L.z[i];
            L.b0[b] = std::sqrt(dx * dx + dy * dy + dz * dz);
        }
        L.twistRad = twistRad;
        L.zRest = zval;
    }

    void build() {
        const int nm = std::max(1, std::min(MAX_MOBILE, P.nLayers));
        const int nc = std::max(4, (int)std::lround(P.Nnm * NM / A_LATT));
        const int ns = std::max(4, (int)std::lround(P.Nsubnm * NM / A_LATT));

        layers.assign((size_t)nm + 1, Layer());
        // [0] rigid substrate at z = 0, untwisted
        buildSheet(layers[0], ns, 0.0, 0.0);
        subHalf = 0.5 * (ns - 1);          // how far its lattice is off the origin
        layers[0].mobile = false;
        // the live sheets, bottom to top; twist accumulates so a three-sheet
        // stack is a genuine twist series rather than two coincident angles
        for (int k = 1; k <= nm; k++) {
            const double z = P.zSub + P.z0 * (k - 1);
            buildSheet(layers[(size_t)k], nc, (k - 1) * P.twistDeg * M_PI / 180.0, z);
            layers[(size_t)k].mobile = true;
        }
        clampGasGap();
        buildSubTable();
        geomVersion++;
        gasOn = false; gasFill = 0; gasN = gasV = gasP = gasR = 0;
        frame = 0;
        ljValid = false;
        computeForces();
#ifdef DMD_LAMMPS
        lmpStop();
        if (P.engine == "lammps" && !lmpStart()) {
            // Say so and fall back rather than pretending to run: a silent
            // downgrade to the toy model is the worst possible outcome here.
            lmpStop();
            P.engine = "classic";
        }
#endif
    }

    void clampGasGap() {
        P.gasGapIdx = std::max(0, std::min(nGaps() - 1, P.gasGapIdx));
    }

    // -------------------------------------------------- neighbour lists

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
        for (size_t k = 1; k < layers.size(); k++) {
            const Layer &L = layers[k];
            if (ljRefX[k].size() != L.n()) return true;
            for (size_t i = 0; i < L.n(); i++) {
                const double dx = L.x[i] - ljRefX[k][i];
                const double dy = L.y[i] - ljRefY[k][i];
                const double dz = L.z[i] - ljRefZ[k][i];
                if (dx * dx + dy * dy + dz * dz > h2) return true;
            }
        }
        return false;
    }

    void buildLJ() {
        const double cut = 3 * P.sigma + ljSkin;
        ljs.clear();
        // The substrate is rigid and reaches 3 sigma, so EVERY mobile layer
        // within that range feels it -- not just the first. Dropping the second
        // layer's share (9.4 % of the substrate adhesion, measured) made a
        // bilayer peel too easily, which is exactly the case this plugin is for.
        // Only the mobile side needs a list; nothing accumulates on the substrate.
        if (P.substrateOn && !subTabActive()) {
            const double zsub = layers[0].zRest;
            for (size_t k = 1; k < layers.size(); k++) {
                if (!layers[k].mobile) continue;
                if (layers[k].zRest - zsub > cut) continue;   // out of reach when flat
                LJList L; L.from = (int)k; L.to = 0; L.countEnergy = true; L.eps = P.epsSub;
                pairList(layers[k].x, layers[k].y, layers[0].x, layers[0].y,
                         cut, L.off, L.idx);
                ljs.push_back(std::move(L));
            }
        }
        // layer-to-layer, both directions so each side accumulates its own force
        for (int g = 1; g < nGaps(); g++) {
            const int a = g, b = g + 1;
            bool first = true;
            if (layers[(size_t)b].mobile) {
                LJList L; L.from = b; L.to = a; L.countEnergy = first; first = false;
                L.eps = P.epsInter;
                pairList(layers[(size_t)b].x, layers[(size_t)b].y,
                         layers[(size_t)a].x, layers[(size_t)a].y, cut, L.off, L.idx);
                ljs.push_back(std::move(L));
            }
            if (layers[(size_t)a].mobile) {
                LJList L; L.from = a; L.to = b; L.countEnergy = first; first = false;
                L.eps = P.epsInter;
                pairList(layers[(size_t)a].x, layers[(size_t)a].y,
                         layers[(size_t)b].x, layers[(size_t)b].y, cut, L.off, L.idx);
                ljs.push_back(std::move(L));
            }
        }
        ljRefX.assign(layers.size(), {});
        ljRefY.assign(layers.size(), {});
        ljRefZ.assign(layers.size(), {});
        for (size_t k = 0; k < layers.size(); k++) {
            ljRefX[k] = layers[k].x; ljRefY[k] = layers[k].y; ljRefZ[k] = layers[k].z;
        }
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
        if (off.empty()) return 0.0;
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

    // The gas sits in gap g: it lifts layers[g+1] and presses layers[g] down.
    // With g = 0 the lower side is the rigid substrate, which absorbs the
    // reaction, and the whole stack above is lifted -- that is "below the
    // bilayer". With g = 1 it is "between the layers".
    Layer &drivenLayer() { return layers[(size_t)P.gasGapIdx + 1]; }
    Layer *pressedLayer() {
        Layer &L = layers[(size_t)P.gasGapIdx];
        return L.mobile ? &L : nullptr;
    }
    double gasRefZ() const { return layers[(size_t)P.gasGapIdx + 1].zRest; }

    // Which atoms the gas presses on. The seed disc always counts -- something
    // has to nucleate the pocket -- and under bubbleFree anything that has
    // PEELED counts too, which is what lets the footprint grow and makes the
    // blister radius an output rather than an input.
    bool gasWets(const Layer &L, size_t i, double R2, double cx, double cy, double href) const {
        const double dx = L.x[i] - cx, dy = L.y[i] - cy;
        if (dx * dx + dy * dy < R2) return true;
        if (P.profile != "bubbleFree") return false;
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
        const double R = P.bubbleRnm * NM;
        const double h0 = 0.709 * R * std::cbrt(P.bubbleP * 1e6 * (R * 1e-10) / 340.0);
        const double Vh = 0.6 * M_PI * h0 * R * R * 1e-30;
        const double kT = KB * (P.gasT > 0 ? P.gasT : 300.0);
        const double Ntot = Vh > 0 ? (P.bubbleP * 1e6) * Vh / kT : 0;
        gasN = Ntot * gasFill;
        if (P.profile == "bubble") {
            // Open loop: the pressure is simply asserted, so inflating the
            // blister does not relieve it. No feedback, and it carries the
            // betweenBoost fudge. Kept only so older results reproduce.
            gasN = 0;
            gasP = P.bubbleP * 1e6 * gasFill *
                   (P.betweenBoost > 0 ? P.betweenBoost : 1.0);
        } else {
            gasP = gasN > 0 ? gasN * kT / (gasV * 1e-30) : 0.0;
        }
    }

    void computeForces() {
        if (ljNeedsRebuild()) buildLJ();
        for (Layer &L : layers) {
            if (!L.mobile) continue;
            std::fill(L.fx.begin(), L.fx.end(), 0.0);
            std::fill(L.fy.begin(), L.fy.end(), 0.0);
            std::fill(L.fz.begin(), L.fz.end(), 0.0);
        }
        double pe = 0;
        for (Layer &L : layers)
            if (L.mobile) pe += inPlane(L, P);

        // the rigid support, from the table when it is built
        if (subTabActive())
            for (Layer &L : layers)
                if (L.mobile) pe += subTabLayer(L);

        for (const LJList &J : ljs) {
            Layer &A = layers[(size_t)J.from];
            const Layer &B = layers[(size_t)J.to];
            pe += ljPairs(A.x, A.y, A.z, A.fx, A.fy, A.fz, B.x, B.y, B.z,
                          J.off, J.idx, P.sigma, J.eps, J.countEnergy);
        }

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
            // Newton's third law, unless the lower side is the rigid substrate,
            // which absorbs the reaction.
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

    double edgeClamp(Layer &L) {
        const double k = P.edgeK;
        if (k <= 0 || L.isEdge.empty()) return 0.0;
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
#ifdef DMD_LAMMPS
        if (lmpOn()) { lmpStep(1); return; }
#endif
        if (gasOn && gasFill < 1.0) gasFill = clampd(gasFill + P.fillRate, 0, 1);
        computeForces();
        for (Layer &L : layers) if (L.mobile) ePot += edgeClamp(L);
        eKin = 0;
        size_t nt = 0;
        for (Layer &L : layers) if (L.mobile) { integrate(L); nt += L.n(); }
        temperature = nt ? (2.0 * eKin) / (3.0 * (double)nt * 8.617333262e-5) : 0;
        frame++; stepsWindow++;
    }

    // ------------------------------------------------- LAMMPS engine
#ifdef DMD_LAMMPS

    bool lmpOn() const { return P.engine == "lammps" && lmp != nullptr; }

    bool lmpCmd(const char *fmt, ...) {
        char buf[1024];
        va_list ap; va_start(ap, fmt);
        vsnprintf(buf, sizeof buf, fmt, ap);
        va_end(ap);
        lammps_command(lmp, buf);
        if (lammps_has_error(lmp)) {
            char msg[512];
            lammps_get_last_error_message(lmp, msg, sizeof msg);
            lmpError = std::string(buf) + " -> " + msg;
            return false;
        }
        return true;
    }

    // Every mobile layer's atoms, concatenated bottom to top. The mapping is
    // what lets one flat LAMMPS atom list carry a stack of layers.
    void lmpBuildMap() {
        gLayer.clear(); gLocal.clear();
        layerBase.assign(layers.size(), 0);
        for (size_t k = 0; k < layers.size(); k++) {
            layerBase[k] = (int32_t)gLayer.size();
            if (!layers[k].mobile) continue;
            for (size_t i = 0; i < layers[k].n(); i++) {
                gLayer.push_back((int32_t)k);
                gLocal.push_back((int32_t)i);
            }
        }
    }

    void lmpStop() {
        if (lmp) { lammps_close(lmp); lmp = nullptr; }
        lmpLastTs = -1;
    }

    // Forces LAMMPS cannot know about: the rigid substrate, the gas, the rim.
    // NOT the interlayer vdW -- AIREBO already carries it.
    double lmpExtForces(int nlocal, int32_t *ids, double **x, double **fext) {
        // Mirror LAMMPS' positions into the layer arrays so the existing
        // machinery (pair lists, gas volume, edge reference) sees the truth.
        for (int li = 0; li < nlocal; li++) {
            const int g = ids[li] - 1;
            if (g < 0 || g >= (int)gLayer.size()) continue;
            Layer &L = layers[(size_t)gLayer[g]];
            const int i = gLocal[g];
            L.x[i] = x[li][0]; L.y[i] = x[li][1]; L.z[i] = x[li][2];
        }
        if (ljNeedsRebuild()) buildLJ();
        if (gasOn) gasState();

        const double sig2 = P.sigma * P.sigma, cut2 = 9 * sig2;
        const double gasF = gasOn ? gasP * PA_TO_EV_A3 * AREA_ATOM : 0.0;
        const int drivenIdx = P.gasGapIdx + 1;
        const int pressedIdx = P.gasGapIdx;
        const double R2 = P.bubbleRnm * NM * P.bubbleRnm * NM;
        const double cx = P.Cxnm * NM, cy = P.Cynm * NM;
        const double href = gasRefZ();

        // every mobile layer's list to the substrate, indexed by layer
        std::vector<const LJList *> sub(layers.size(), nullptr);
        if (P.substrateOn)
            for (const LJList &c : ljs)
                if (c.to == 0 && c.from >= 0 && c.from < (int)layers.size())
                    sub[(size_t)c.from] = &c;

        double pe = 0;
        for (int li = 0; li < nlocal; li++) {
            const int g = ids[li] - 1;
            if (g < 0 || g >= (int)gLayer.size()) continue;
            const int k = gLayer[g], i = gLocal[g];
            Layer &L = layers[(size_t)k];
            double Fx = 0, Fy = 0, Fz = 0, e = 0;
            const double xi = x[li][0], yi = x[li][1], zi = x[li][2];

            if (subTabActive()) {
                e += subLookup(xi, yi, zi - layers[0].zRest, Fx, Fy, Fz);
            }
            const LJList *SL = subTabActive() ? nullptr : sub[(size_t)k];
            if (SL && !SL->off.empty()) {
                const double eps = SL->eps;
                for (int q = SL->off[i]; q < SL->off[i + 1]; q++) {
                    const int j = SL->idx[q];
                    const double dx = layers[0].x[j] - xi;
                    const double dy = layers[0].y[j] - yi;
                    const double dz = layers[0].z[j] - zi;
                    const double r2 = dx * dx + dy * dy + dz * dz;
                    if (r2 > cut2 || r2 < 1e-8) continue;
                    const double s2 = sig2 / r2, s6 = s2 * s2 * s2, s12 = s6 * s6;
                    e += 4 * eps * (s12 - s6);
                    const double fm = 24 * eps * (2 * s12 - s6) / r2;
                    Fx -= fm * dx; Fy -= fm * dy; Fz -= fm * dz;
                }
            }

            if (gasOn) {
                if (k == drivenIdx && gasWets(L, (size_t)i, R2, cx, cy, href)) Fz += gasF;
                else if (k == pressedIdx && layers[(size_t)pressedIdx].mobile) {
                    const double dx = xi - cx, dy = yi - cy;
                    if (dx * dx + dy * dy < gasR * gasR) Fz -= gasF;
                }
            }

            if (P.edgeK > 0 && !L.isEdge.empty() && L.isEdge[i]) {
                const double dx = xi - L.x0[i], dy = yi - L.y0[i], dz = zi - L.z0r[i];
                Fx -= P.edgeK * dx; Fy -= P.edgeK * dy; Fz -= P.edgeK * dz;
                e += 0.5 * P.edgeK * (dx * dx + dy * dy + dz * dz);
            }

            fext[li][0] = Fx; fext[li][1] = Fy; fext[li][2] = Fz;
            pe += e;
        }
        return pe;
    }

    static void extCallback(void *ptr, int64_t ts, int nlocal, int32_t *ids,
                            double **x, double **fext) {
        Instance *s = (Instance *)ptr;
        if (ts != s->lmpLastTs) {
            s->lmpLastTs = ts;
            if (s->gasOn && s->gasFill < 1.0)
                s->gasFill = clampd(s->gasFill + s->P.fillRate, 0, 1);
        }
        const double e = s->lmpExtForces(nlocal, ids, x, fext);
        lammps_fix_external_set_energy_global(s->lmp, "ext", e);
    }

    bool lmpStart() {
        lmpStop();
        lmpError.clear();
        lmpBuildMap();
        const size_t n = gLayer.size();
        if (!n) { lmpError = "no mobile atoms"; return false; }

        const char *argv[] = {"2dmd", "-screen", "none", "-log", "none", "-nocite"};
        lmp = lammps_open_no_mpi(6, (char **)argv, nullptr);
        if (!lmp) { lmpError = "lammps_open_no_mpi failed"; return false; }

        double lo[3] = {1e30, 1e30, 1e30}, hi[3] = {-1e30, -1e30, -1e30};
        for (const Layer &L : layers) {
            if (!L.mobile) continue;
            for (size_t i = 0; i < L.n(); i++) {
                lo[0] = std::min(lo[0], L.x[i]); hi[0] = std::max(hi[0], L.x[i]);
                lo[1] = std::min(lo[1], L.y[i]); hi[1] = std::max(hi[1], L.y[i]);
                lo[2] = std::min(lo[2], L.z[i]); hi[2] = std::max(hi[2], L.z[i]);
            }
        }
        // Headroom above and below: a blister rises, and `boundary m m m` wants
        // room. Shrink-wrapping a FLAT sheet to zero thickness is what breaks
        // the neighbour binning, so the z span is padded generously.
        const double pad = 60.0;

        if (!lmpCmd("units metal")) return false;
        if (!lmpCmd("dimension 3")) return false;
        if (!lmpCmd("boundary m m m")) return false;
        if (!lmpCmd("atom_style atomic")) return false;
        if (!lmpCmd("atom_modify map array sort 0 0.0")) return false;
        if (!lmpCmd("region simbox block %.6g %.6g %.6g %.6g %.6g %.6g units box",
                    lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad,
                    lo[2] - pad, hi[2] + pad)) return false;
        if (!lmpCmd("create_box 1 simbox")) return false;
        if (!lmpCmd("mass 1 12.011")) return false;

        std::vector<int32_t> id(n);
        std::vector<int> type(n, 1);
        std::vector<double> xyz(3 * n);
        for (size_t g = 0; g < n; g++) {
            const Layer &L = layers[(size_t)gLayer[g]];
            const int i = gLocal[g];
            id[g] = (int32_t)g + 1;
            xyz[3 * g] = L.x[i]; xyz[3 * g + 1] = L.y[i]; xyz[3 * g + 2] = L.z[i];
        }
        lammps_create_atoms(lmp, (int)n, id.data(), type.data(), xyz.data(),
                            nullptr, nullptr, 1);
        if (lammps_has_error(lmp) || (long)lammps_get_natoms(lmp) != (long)n) {
            lmpError = "create_atoms failed"; return false;
        }

        // AIREBO carries REBO bonds, the interlayer LJ and torsion in one
        // style, so a stack of graphene sheets needs nothing else between them.
        const std::string pot = bundleDir() + "/potentials/CH.airebo";
        if (!lmpCmd("pair_style airebo 3.0")) return false;
        if (!lmpCmd("pair_coeff * * \"%s\" C", pot.c_str())) return false;

        if (!lmpCmd("neighbor 2.0 bin")) return false;
        if (!lmpCmd("neigh_modify every 1 delay 0 check yes")) return false;
        if (!lmpCmd("timestep %.10g", P.dt * 1e-3)) return false;
        if (!lmpCmd("fix mdint all nve")) return false;
        if (P.gamma > 0 && !lmpCmd("fix visc all viscous %.10g", P.gamma)) return false;

        if (!lmpCmd("fix ext all external pf/callback 1 1")) return false;
        lammps_set_fix_external_callback(lmp, "ext",
                                         (FixExternalFnPtr)&Instance::extCallback, this);
        if (!lmpCmd("fix_modify ext energy yes")) return false;

        // A cropped flake's undercoordinated rim carries real bond-order strain;
        // released as kinetic energy it reads as thousands of kelvin. Settle it,
        // then start cold. Capped, because the point is the rim and not full
        // convergence -- an uncapped minimize holds the worker thread for tens
        // of seconds at any useful size.
        if (!lmpCmd("min_style cg")) return false;
        if (!lmpCmd("minimize 0.0 1.0e-4 200 1000")) return false;
        if (!lmpCmd("velocity all set 0.0 0.0 0.0")) return false;
        if (!lmpCmd("reset_timestep 0")) return false;
        lmpLastTs = -1;
        if (!lmpCmd("run 0 post no")) return false;
        ePot = lammps_get_thermo(lmp, "pe");
        lmpPull();
        return true;
    }

    // Read LAMMPS' coordinates back into the layer stack.
    void lmpPull() {
        const size_t n = gLayer.size();
        if (!n) return;
        std::vector<double> xyz(3 * n);
        lammps_gather_atoms(lmp, (char *)"x", 1, 3, xyz.data());
        for (size_t g = 0; g < n; g++) {
            Layer &L = layers[(size_t)gLayer[g]];
            const int i = gLocal[g];
            L.x[i] = xyz[3 * g]; L.y[i] = xyz[3 * g + 1]; L.z[i] = xyz[3 * g + 2];
        }
    }

    void lmpStep(int nsteps) {
        if (!lmp) return;
        lmpCmd("run %d pre no post no", nsteps);
        lmpPull();
        ePot = lammps_get_thermo(lmp, "pe");
        eKin = lammps_get_thermo(lmp, "ke");
        temperature = lammps_get_thermo(lmp, "temp");
        frame += nsteps; stepsWindow += nsteps;
    }
#endif  // DMD_LAMMPS

    // ------------------------------------------------- registry

    // Each mobile layer is measured against the one below it. Only the sheets
    // carry twist and the reference lattice is unrotated, so one set of
    // reciprocal vectors serves every layer.
    void computeRegistry() {
        const double g = 4 * M_PI / (std::sqrt(3.0) * A_LATT);
        double Gx[3], Gy[3];
        for (int k = 0; k < 3; k++) {
            const double ang = M_PI / 2 + k * 2 * M_PI / 3;
            Gx[k] = g * std::cos(ang); Gy[k] = g * std::sin(ang);
        }
        const double gam = P.regGamma > 0 ? P.regGamma : 1;
        const bool damp = P.regHeightDamp;

        for (size_t k = 1; k < layers.size(); k++) {
            Layer &L = layers[k];
            const Layer &B = layers[k - 1];
            L.reg.assign(L.n(), 0.0f);
            // the (k -> k-1) list, if it was built
            const LJList *J = nullptr;
            for (const LJList &c : ljs)
                if (c.from == (int)k && c.to == (int)k - 1) { J = &c; break; }
            const double oz = L.zRest - B.zRest;
            const int n = (int)L.n();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
            for (int ii = 0; ii < n; ii++) {
                const size_t i = (size_t)ii;
                double s = 0;
                for (int q = 0; q < 3; q++)
                    s += std::cos(Gx[q] * L.x[i] + Gy[q] * L.y[i]);
                double t = 1.0 - (s - REG_SMIN) / (REG_SMAX - REG_SMIN);
                t = clampd(t, 0.0, 1.0);
                if (gam != 1) t = std::pow(t, gam);
                if (damp && J && !J->off.empty()) {
                    double best = 1e30, bz = 0;
                    for (int q = J->off[i]; q < J->off[i + 1]; q++) {
                        const int j = J->idx[q];
                        const double dx = B.x[j] - L.x[i], dy = B.y[j] - L.y[i];
                        const double d2 = dx * dx + dy * dy;
                        if (d2 < best) { best = d2; bz = std::fabs(B.z[j] - L.z[i]); }
                    }
                    if (best < 1e29) {
                        const double dev = std::fabs(bz - oz);
                        const double w = clampd(1.0 - dev, 0.0, 1.0);
                        t = 1.0 - (1.0 - t) * w;
                    }
                }
                L.reg[i] = (float)t;
            }
        }
    }

    // Mean bond dilatation per atom: (|r| - |r0|)/|r0| averaged over the bonds
    // an atom takes part in. This is the scalar the stress-distribution work
    // wants, and computing it in the core rather than the page means the
    // analysis scripts and the panel read the same numbers.
    void computeStrain() {
        for (size_t k = 1; k < layers.size(); k++) {
            Layer &L = layers[k];
            const size_t n = L.n();
            L.strain.assign(n, 0.0f);
            std::vector<float> acc(n, 0.0f);
            std::vector<uint32_t> cnt(n, 0);
            for (size_t b = 0; b < L.bi.size(); b++) {
                const int i = L.bi[b], j = L.bj[b];
                const double r0 = L.b0.empty() ? 0.0 : L.b0[b];
                if (r0 <= 1e-9) continue;
                const double dx = L.x[j] - L.x[i], dy = L.y[j] - L.y[i], dz = L.z[j] - L.z[i];
                const double e = (std::sqrt(dx * dx + dy * dy + dz * dz) - r0) / r0;
                acc[i] += (float)e; cnt[i]++;
                acc[j] += (float)e; cnt[j]++;
            }
            for (size_t i = 0; i < n; i++) L.strain[i] = cnt[i] ? acc[i] / cnt[i] : 0.0f;
        }
    }

    // ------------------------------------------------- LAMMPS export
    //
    // The point is not convenience. It is that a result produced inside this
    // plugin can be checked OUTSIDE it, by stock LAMMPS, with no plugin in the
    // loop -- which twisted bubbles have never had.
    //
    // Atom ORDER matters: sheets first, bottom to top, then the substrate, so
    // every layer is a contiguous id range and its group is one `a:b` argument.
    // A group written as a list of ids makes LAMMPS rescan every atom per
    // argument and hangs setup for minutes at any useful size.
    std::string exportTo(const std::string &dir) {
        dmexport::Deck D;
        const size_t nMob = [&]{ size_t t = 0;
            for (const Layer &L : layers) if (L.mobile) t += L.n(); return t; }();
        const size_t nTot = nMob + layers[0].n();
        D.x.reserve(nTot); D.y.reserve(nTot); D.z.reserve(nTot); D.type.reserve(nTot);
        D.layers.assign(layers.size(), dmexport::LayerSpec());

        int id = 1;
        for (size_t k = 1; k < layers.size(); k++) {
            const Layer &L = layers[k];
            D.layers[k].first = id;
            for (size_t i = 0; i < L.n(); i++, id++) {
                D.x.push_back(L.x[i]); D.y.push_back(L.y[i]); D.z.push_back(L.z[i]);
                D.type.push_back(1);
                if (P.edgeK > 0 && !L.isEdge.empty() && L.isEdge[i]) D.edgeIds.push_back(id);
            }
            D.layers[k].last = id - 1;
            D.layers[k].zRest = L.zRest;
            D.layers[k].mobile = true;
        }
        D.layers[0].first = id;
        for (size_t i = 0; i < layers[0].n(); i++, id++) {
            D.x.push_back(layers[0].x[i]); D.y.push_back(layers[0].y[i]);
            D.z.push_back(layers[0].z[i]); D.type.push_back(2);
        }
        D.layers[0].last = id - 1;
        D.layers[0].zRest = layers[0].zRest;
        D.layers[0].mobile = false;

        D.sigma = P.sigma; D.epsSub = P.epsSub;
        D.dtFs = P.dt; D.gamma = P.gamma; D.edgeK = P.edgeK;
        D.gasOn = gasOn; D.profile = P.profile; D.gasGapIdx = P.gasGapIdx;
        D.bubbleRnm = P.bubbleRnm; D.bubbleP = P.bubbleP;
        D.gasT = P.gasT; D.gasGapA = P.gasGap;
        D.Cxnm = P.Cxnm; D.Cynm = P.Cynm; D.areaAtom = AREA_ATOM;
        D.runSteps = exportSteps; D.dumpEvery = exportDump;
        // absolute, with forward slashes: LAMMPS takes them on Windows and the
        // deck then runs from any working directory
        // Ship the potential table WITH the deck and reference it by bare
        // name. An absolute path works here and nowhere else; a folder that
        // carries its own table can be zipped and handed to someone.
        {
            std::string src = bundleDir() + "/potentials/CH.airebo";
            for (char &c : src) if (c == 92) c = 47;
            std::ifstream in(src, std::ios::binary);
            std::ofstream cp(dir + "/CH.airebo", std::ios::binary);
            if (in && cp) { cp << in.rdbuf(); D.potentialPath = "CH.airebo"; }
            else D.potentialPath = src;      // fall back rather than write a lie
        }

        const auto files = dmexport::exportDeck(D);
        for (const auto &f : files) {
            std::ofstream o(dir + "/" + f.name, std::ios::binary);
            if (!o) return std::string("cannot write ") + dir + "/" + f.name;
            o << f.text;
        }
        char buf[512];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"exported\",\"dir\":\"%s\",\"atoms\":%zu,"
                 "\"sheets\":%zu,\"substrate\":%zu,\"files\":\"system.data in.2dmd\"}",
                 dir.c_str(), nTot, nMob, layers[0].n());
        return buf;
    }
    int exportSteps = 2000, exportDump = 500;

    // ------------------------------------------------- wire protocol
    //
    // Format 2DM1 version 2. The spec is DSW/2DMD-FRAME-FORMAT.md and the ONE
    // reader that implements it is 2dmd/ui/dmframe.js, used by both the page
    // and the analysis scripts.
    //
    // The property worth having is that a reader can skip what it does not
    // understand: every scalar block carries its own length, so adding velocity
    // or coordination later breaks nothing already written.
    static const uint32_t MAGIC = 0x314D4432u;   // '2DM1'
    static const uint32_t FMT_VERSION = 2;
    static const uint32_t BLOCK_REGISTRY = 1;
    static const uint32_t BLOCK_STRAIN   = 2;

    void packFrame() {
        const bool sendStatic = (geomVersion != sentGeomVersion);
        if (P.registry) computeRegistry();
        if (P.strain) computeStrain();

        const uint32_t nL = (uint32_t)layers.size();
        uint32_t mobileMask = 0;
        uint32_t nMobileAtoms = 0;
        for (uint32_t k = 0; k < nL; k++)
            if (layers[k].mobile) { mobileMask |= (1u << k); nMobileAtoms += (uint32_t)layers[k].n(); }

        uint32_t nBlocks = 0;
        if (P.registry) nBlocks++;
        if (P.strain) nBlocks++;

        size_t words = 8 + 2ull * nL;
        for (const Layer &L : layers)
            if (L.mobile || sendStatic) words += 3ull * L.n();
        words += (size_t)nBlocks * (4ull + nMobileAtoms);

        frameBuf.resize(words * 4);
        uint8_t *p = frameBuf.data();
        auto u32 = [&](uint32_t v) { memcpy(p, &v, 4); p += 4; };
        auto f32 = [&](float v) { memcpy(p, &v, 4); p += 4; };

        // header
        u32(MAGIC); u32(FMT_VERSION); u32(sendStatic ? 1u : 0u); u32(nL);
        u32((uint32_t)frame); f32((float)ePot); f32((float)eKin); u32(nBlocks);
        // layer table
        for (const Layer &L : layers) {
            uint32_t lf = 0;
            if (L.mobile) lf |= 1;
            if (L.mobile || sendStatic) lf |= 2;
            u32((uint32_t)L.n()); u32(lf);
        }
        // positions of the layers present in this frame
        for (const Layer &L : layers) {
            if (!(L.mobile || sendStatic)) continue;
            for (size_t i = 0; i < L.n(); i++) {
                f32((float)L.x[i]); f32((float)L.y[i]); f32((float)L.z[i]);
            }
        }
        // scalar blocks, each self-describing so an old reader can skip it
        auto block = [&](uint32_t kind, std::vector<float> Layer::*field) {
            u32(kind); u32(mobileMask); u32(nMobileAtoms); u32(0);
            for (const Layer &L : layers) {
                if (!L.mobile) continue;
                const std::vector<float> &v = L.*field;
                for (size_t i = 0; i < L.n(); i++) f32(i < v.size() ? v[i] : 0.0f);
            }
        };
        if (P.registry) block(BLOCK_REGISTRY, &Layer::reg);
        if (P.strain) block(BLOCK_STRAIN, &Layer::strain);

        if (sendStatic) sentGeomVersion = geomVersion;
    }

    void say(const std::string &s) { outbox = s; haveOut = true; }

    void sayState(long q) {
        char buf[1100];
        // n1/n2/nsub are kept so the existing probes and the moire-bubble panel
        // keep working while phase 6 consolidates the UI.
        const int n1 = layers.size() > 1 ? (int)layers[1].n() : 0;
        const int n2 = layers.size() > 2 ? (int)layers[2].n() : 0;
        int nAtoms = 0;
        for (const Layer &L : layers) if (L.mobile) nAtoms += (int)L.n();
        snprintf(buf, sizeof buf,
                 "{\"t\":\"state\",\"q\":%ld,\"nLayers\":%d,\"n\":%d,"
                 "\"n1\":%d,\"n2\":%d,\"nsub\":%d,"
                 "\"frame\":%lld,\"epot\":%.6g,\"ekin\":%.6g,\"temp\":%.4g,"
                 "\"gas\":%d,\"gasGapIdx\":%d,\"gasWhere\":\"%s\",\"fill\":%.3f,"
                 "\"profile\":\"%s\","
                 "\"gasN\":%.6g,\"gasV\":%.6g,\"gasP\":%.6g,\"gasR\":%.4g,"
                 "\"twist\":%.4g,\"running\":%d,\"ms\":%.3f,\"sps\":%.0f,\"threads\":%d,"
                 "\"engine\":\"%s\",\"lmpError\":\"%s\"}",
                 q, nMobile(), nAtoms, n1, n2, (int)layers[0].n(),
                 frame, ePot, eKin, temperature,
                 gasOn ? 1 : 0, P.gasGapIdx,
                 P.gasGapIdx == 0 ? "below" : "between", gasFill, P.profile.c_str(),
                 gasN, gasV, gasP, gasR, P.twistDeg,
                 running ? 1 : 0, stepMs,
                 statsClock > 0 ? stepsWindow / statsClock : 0.0,
#ifdef _OPENMP
                 omp_get_max_threads(),
#else
                 1,
#endif
#ifdef DMD_LAMMPS
                 P.engine.c_str(), lmpError.c_str()
#else
                 P.engine.c_str(), "built without LAMMPS"
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
        P.subTab = num("subTab", P.subTab ? 1 : 0) != 0;
        P.subGrid = (int)num("subGrid", P.subGrid);
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
        P.strain = num("strain", P.strain ? 1 : 0) != 0;
        P.regGamma = num("regGamma", P.regGamma);
        P.regHeightDamp = num("regHeightDamp", P.regHeightDamp ? 1 : 0) != 0;
        // gap by index, or by moire-bubble's two names
        P.gasGapIdx = (int)num("gasGapIdx", P.gasGapIdx);
        P.betweenBoost = num("betweenBoost", P.betweenBoost);
        const std::string pr = dexmsg::get_str(m, "profile");
        if (pr == "bubble" || pr == "bubbleN" || pr == "bubbleFree") P.profile = pr;
        const std::string en = dexmsg::get_str(m, "engine");
        if (en == "classic" || en == "lammps") P.engine = en;
        const std::string w = dexmsg::get_str(m, "gasWhere");
        if (w == "below") P.gasGapIdx = 0;
        else if (w == "between") P.gasGapIdx = nGaps() > 1 ? 1 : 0;
        clampGasGap();
    }

    void handle(const std::string &m) {
        const std::string t = dexmsg::type_of(m);
        const long q = (long)dexmsg::get_num(m, "q", -1);
        if (t == "build") {
            readParams(m);
            P.nLayers = (int)dexmsg::get_num(m, "nLayers", P.nLayers);
            P.Nnm = dexmsg::get_num(m, "Nnm", P.Nnm);
            P.Nsubnm = dexmsg::get_num(m, "Nsubnm", P.Nsubnm);
            P.twistDeg = dexmsg::get_num(m, "twistDeg", P.twistDeg);
            P.zSub = dexmsg::get_num(m, "zSub", P.zSub);
            P.z0 = dexmsg::get_num(m, "z0", P.z0);
            build();
            sayState(q);
        } else if (t == "params") {
            readParams(m); buildSubTable(); ljValid = false;
            computeForces(); sayState(q);
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
            for (Layer &L : layers) {
                L.x = L.x0; L.y = L.y0; L.z = L.z0r;
                std::fill(L.vx.begin(), L.vx.end(), 0.0);
                std::fill(L.vy.begin(), L.vy.end(), 0.0);
                std::fill(L.vz.begin(), L.vz.end(), 0.0);
            }
            gasOn = false; gasFill = 0; frame = 0; ljValid = false;
            computeForces(); sayState(q);
        } else if (t == "export") {
            std::string dir = dexmsg::get_str(m, "dir");
            if (dir.empty()) dir = ".";
            exportSteps = std::max(0, (int)dexmsg::get_num(m, "steps", exportSteps));
            exportDump = std::max(1, (int)dexmsg::get_num(m, "dumpEvery", exportDump));
            say(exportTo(dir));
        } else if (t == "state") {
            sayState(q);
        }
    }
};

}  // namespace

extern "C" {
void *md_create() { Instance *s = new Instance(); s->build(); return s; }
void md_destroy(void *p) { delete (Instance *)p; }

int md_advance(void *p, double dt) {
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
    if (cutShort && !s->running) s->pendingSteps += budget - done;
    s->stepMs = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t0).count() / std::max(done, 1);
    s->statsClock += dt;
    if (s->statsClock >= 0.5) { s->sayState(-1); s->statsClock = 0; s->stepsWindow = 0; }
    return 1;
}

void md_on_message(void *p, const char *json, size_t len) {
    ((Instance *)p)->handle(std::string(json, len));
}
const char *md_poll(void *p) {
    Instance *s = (Instance *)p;
    if (!s->haveOut) return nullptr;
    s->haveOut = false;
    return s->outbox.c_str();
}
int md_render(void *p, dex_frame *out) {
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
    "2dmd",
    "2DMD - layered molecular dynamics",
    "0.1",
    md_create, md_destroy, md_advance, md_on_message, md_poll, md_render,
};

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) { return &API; }
