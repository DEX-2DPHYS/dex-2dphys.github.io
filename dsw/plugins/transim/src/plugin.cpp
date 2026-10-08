// TranSim — native DSW port of the Graphene Hybrid FEM / Ballistic Transport Explorer.
// Heavy numerical work lives here; the browser owns controls, labels and plots.

#include "dex_plugin.h"
#include "dex_msg.h"
#include "scatter.h"
#include "hydro.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <deque>
#include <limits>
#include <map>
#include <numeric>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace {

constexpr double E_CHARGE = 1.602176634e-19;
constexpr double PLANCK = 6.62607015e-34;
constexpr double HBAR = PLANCK / (2.0 * M_PI);
constexpr double FERMI_V = 1.0e6;
constexpr int FRAME_W = 960;
constexpr int FRAME_H = 540;

double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
double sqr(double v) { return v * v; }

std::vector<std::string> split(const std::string &s, char sep) {
    std::vector<std::string> out;
    size_t a = 0;
    while (a <= s.size()) {
        const size_t b = s.find(sep, a);
        out.push_back(s.substr(a, b == std::string::npos ? std::string::npos : b - a));
        if (b == std::string::npos) break;
        a = b + 1;
    }
    return out;
}

std::string jsonEscape(const std::string &s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        if (c == '\\' || c == '"') { out.push_back('\\'); out.push_back(c); }
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (static_cast<unsigned char>(c) >= 32) out.push_back(c);
    }
    return out;
}

struct Contact {
    std::string id, role;
    double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
};

std::vector<Contact> presetContacts(const std::string &name) {
    if (name == "two_terminal") return {
        {"source", "source", 0.00, 0.05, 0.04, 0.95},
        {"drain", "drain", 0.96, 0.05, 1.00, 0.95},
    };
    if (name == "four_probe") return {
        {"source", "source", 0.00, 0.05, 0.04, 0.95},
        {"drain", "drain", 0.96, 0.05, 1.00, 0.95},
        {"probe_1", "probe", 0.28, 0.93, 0.40, 1.00},
        {"probe_2", "probe", 0.60, 0.93, 0.72, 1.00},
    };
    if (name == "hall_cross") return {
        {"source", "source", 0.00, 0.35, 0.04, 0.65},
        {"drain", "drain", 0.96, 0.35, 1.00, 0.65},
        {"probe_top", "probe", 0.35, 0.96, 0.65, 1.00},
        {"probe_bottom", "probe", 0.35, 0.00, 0.65, 0.04},
    };
    return { // Hall bar
        {"source", "source", 0.00, 0.10, 0.04, 0.90},
        {"drain", "drain", 0.96, 0.10, 1.00, 0.90},
        {"probe_top", "probe", 0.40, 0.94, 0.60, 1.00},
        {"probe_bottom", "probe", 0.40, 0.00, 0.60, 0.06},
    };
}

bool inContact(double xf, double yf, const Contact &c) {
    return xf >= c.x0 && xf <= c.x1 && yf >= c.y0 && yf <= c.y1;
}

// Hard obstacles: a "reflector" is the ellipse inscribed in its rectangle, a "wall" is the
// rectangle itself. Trajectories reflect off them, the fluid and the FEM treat them as solid.
bool isObstacle(const Contact &c) { return c.role == "reflector" || c.role == "wall"; }
bool inObstacle(const Contact &c, double xf, double yf) {
    if (c.role == "wall") return inContact(xf, yf, c);
    if (c.role != "reflector") return false;
    const double ax = 0.5 * (c.x1 - c.x0), ay = 0.5 * (c.y1 - c.y0);
    if (ax <= 0 || ay <= 0) return false;
    const double u = (xf - 0.5 * (c.x0 + c.x1)) / ax, v = (yf - 0.5 * (c.y0 + c.y1)) / ay;
    return u * u + v * v <= 1;
}

struct FieldMap {
    int w = 0, h = 0;
    std::vector<float> v; // row zero is the top of the uploaded image
    bool valid() const { return w > 0 && h > 0 && v.size() == static_cast<size_t>(w * h); }
    double sample(double xf, double yf, double fallback) const {
        if (!valid()) return fallback;
        const double x = clampd(xf, 0, 1) * (w - 1);
        const double y = (1.0 - clampd(yf, 0, 1)) * (h - 1);
        const int i0 = static_cast<int>(std::floor(x)), j0 = static_cast<int>(std::floor(y));
        const int i1 = std::min(i0 + 1, w - 1), j1 = std::min(j0 + 1, h - 1);
        const double fx = x - i0, fy = y - j0;
        const double a = v[static_cast<size_t>(j0) * w + i0] * (1 - fx) + v[static_cast<size_t>(j0) * w + i1] * fx;
        const double b = v[static_cast<size_t>(j1) * w + i0] * (1 - fx) + v[static_cast<size_t>(j1) * w + i1] * fx;
        return a * (1 - fy) + b * fy;
    }
};

struct Params {
    double Wum = 4.0, Hum = 2.0;
    double ncm2 = 1e12, mucm = 50000, B = 0;
    bool mfpFromMobility = true;
    double mfpum = 0.5;
    double Vsource = 1e-3, Vdrain = 0;
    std::string scattering = "isotropic", edge = "specular", mobScope = "cond";
    int res = 100, nTraj = 2000, seed = 7, femIter = 3000, maxSteps = 8000;
    int trajRes = 160;            // cells along x in the trajectory density map (160 = the original)
    double femTol = 1e-9, maxPathUm = 240;
    // Test hooks (not on the panel): 0 restores the old seed mixing / the fixed
    // path budget, so the identity gate can still compare against the old engine.
    int seedMix = 1, pathAuto = 1;
    int threads = 0;
    // Scattering physics ported from the Klein magnetometer core (src/scatter.h).
    // Every default reproduces the original engine bit for bit.
    double fwdSigmaDeg = 10;      // gaussian impurity kick
    double phMfp300um = 0;        // acoustic-phonon mfp at 300 K (0 = off)
    double tempK = 300;
    double eeMfpum = 0, eeSigmaDeg = 15;   // one-body e-e kicks (0 = off)
    double specularity = 1;       // edge "partial"
    std::string tracer = "step";  // "step" (any density map) | "arc" (exact arcs, uniform n)
    bool refract = false;         // stepped tracer: bend rays in density gradients
    // What a carrier does where the density map changes sign (a p-n junction):
    // "klein" = Klein tunnelling with negative refraction, "pass" = the old
    // behaviour (straight through, transmission 1).  Maps that never change
    // sign are untouched by either.
    std::string pnMode = "klein";
    // Length d of a smooth p-n junction, Cayssol, Huard & Goldhaber-Gordon,
    // PRB 79, 075428 (2009): kF(x) = k1 + (k2 - k1)/(exp(-x/d) + 1).  0 = abrupt.
    double pnWidthNm = 0;
    // Field model for the FEM-type solve: "ohmic" (local Ohm's law + Hall tensor, the
    // original) or "hydro" (viscous electron fluid, src/hydro.h).  Default ohmic.
    std::string fieldModel = "ohmic";
    double hydroLeeUm = 0;      // electron-electron length; 0 = from T: tau_ee = C hbar E_F / (k_B T)^2
    double hydroCee = 1;        // that C
    double hydroSlipUm = 0;     // Navier slip length at the walls; 0 = no-slip, < 0 = free slip
    bool hydroHallVisc = true;  // B-dependent shear viscosity and Hall viscosity (Alekseev 2016)

    // phonon length at the run temperature (m), 0 = off
    // Phonon length at the run temperature and density n (m^-2), 0 = off.
    // phMfp300um is the length at 300 K and n = 1e12 cm^-2.  In graphene the
    // acoustic-phonon resistivity does not depend on n (Hwang & Das Sarma, PRB 77,
    // 115449 (2008)); with sigma = (2e^2/h) kF l that needs l proportional to 1/kF.
    // Above the Bloch-Gruneisen temperature T_BG = 2 hbar v_s kF / kB rho grows as T,
    // below it as T^4 (Efetov & Kim, PRL 105, 256805 (2010)).
    static double phTempFactor(double T, double TBG) {
        // rho(T) / rho(300 K) up to the common prefactor: T^4 / (T^3 + T_BG^3)
        const double f = [](double t, double tb) { return t * t * t * t / (t * t * t + tb * tb * tb); }(T, TBG);
        const double f300 = 300.0 * 300.0 * 300.0 * 300.0 / (300.0 * 300.0 * 300.0 + TBG * TBG * TBG);
        return f / f300;
    }
    double phLenAt(double nAbs) const {
        if (phMfp300um <= 0 || tempK <= 0) return 0;
        const double nref = 1e16, nn = std::max(1e12, std::abs(nAbs));
        const double kf = std::sqrt(M_PI * nn);
        const double TBG = 2 * HBAR * 2.1e4 * kf / 1.380649e-23;
        return phMfp300um * 1e-6 * std::sqrt(nref / nn) / phTempFactor(tempK, TBG);
    }
    double phLen() const { return phLenAt(n()); }
    scat::Model scatModel() const {
        scat::Model m;
        m.imp = scat::impFromName(scattering);
        m.sigma = fwdSigmaDeg * M_PI / 180;
        m.phLen = phLen();
        m.eeLen = eeMfpum > 0 ? eeMfpum * 1e-6 : 0;
        m.eeSigma = eeSigmaDeg * M_PI / 180;
        return m;
    }

    double W() const { return std::max(0.2, Wum) * 1e-6; }
    double H() const { return std::max(0.2, Hum) * 1e-6; }
    double n() const { return ncm2 * 1e4; }
    double mu() const { return mucm * 1e-4; }
    double mfp() const {
        if (!mfpFromMobility) return std::max(0.0, mfpum) * 1e-6;
        return HBAR * mu() * std::sqrt(M_PI * std::abs(n())) / E_CHARGE;
    }
};

struct GridFields {
    int nx = 0, ny = 0;
    double dx = 0, dy = 0;
    std::vector<double> n, mu;
};

struct FEMResult {
    int nx = 0, ny = 0, iters = 0;
    double dx = 0, dy = 0, residual = 0, current = 0;
    double resistance = std::numeric_limits<double>::infinity();
    double ms = 0;
    bool converged = false, valid = false, direct = false;   // direct: solved by sparse LU after BiCGSTAB failed
    std::string error;
    std::vector<double> u, qx, qy, nfield;
    std::vector<double> w;          // vorticity of the current, d(jy)/dx - d(jx)/dy (A/m^2)
    std::vector<std::pair<std::string, double>> probes;
    std::string model = "ohmic", note;
    double leeUm = 0, lmrUm = 0, DnuUm = 0, nu0 = 0, nuxx = 0, nuH = 0, sHall = 0;
};

struct Point { float x = 0, y = 0; };
struct Path {
    std::vector<Point> points;
    int status = 4, source = -1, terminal = -1;
};

enum TrajStatus { TRANSMITTED = 0, REFLECTED = 1, ABSORBED = 2, LOST = 3, MAXSTEPS = 4 };

struct TrajResult {
    int gx = 160, gy = 80, launched = 0;
    double ms = 0, pathSum = 0, scatterSum = 0;
    bool ballistic = false, valid = false, multi = false;
    uint64_t arcFlights = 0, signCross = 0, pnTrans = 0, pnRefl = 0;
    std::array<uint64_t, 5> statuses{};
    std::vector<uint64_t> density;
    std::vector<uint64_t> reached; // source contact index x terminal contact index
    std::vector<uint64_t> launchedBy;
    std::vector<uint64_t> reachedB, launchedB;   // per jackknife batch, as in LocalAgg
    std::vector<Path> paths;
};

struct SweepPoint { double x = 0, y = 0, ncm2 = 0, B = 0, mucm = 0, mfpum = 0;
                    double tempK = -1; bool mfpSet = false, muSet = false; };
struct SweepSpec {
    std::string type = "vg", measure = "2t", quantity = "G", balMode = "crossover", quality = "fast";
    bool wantFem = true, wantBal = false, snapshots = false;
    double vgFrom = -40, vgTo = 40, bFrom = -1, bTo = 1, lFromNm = 1, lToNm = 10000;
    int vgN = 41, bN = 41, lN = 41;
    double toxNm = 300, epsr = 3.9, vdirac = 0;
    // "T" line sweep, and the general two-axis map ("map2"): each axis is one of
    // vg, n, b, T, mfp (nm, log spaced) or mu (cm^2/Vs, log spaced)
    double tFrom = 4, tTo = 300; int tN = 41;
    std::string xParam = "vg", yParam = "b";
    double xFrom = -40, xTo = 40, yFrom = -1, yTo = 1; int xN = 21, yN = 21;
};

struct SweepSnapshot {
    FEMResult fem;
    TrajResult traj;
    bool hasFem = false, hasTraj = false;
};

enum class Job { Idle, Fem, Traj, HybridFem, HybridTraj, Sweep };

struct Instance {
    Params p;
    std::vector<Contact> contacts = presetContacts("hall_bar");
    FieldMap densityMap, mobilityMap;
    FEMResult fem;
    TrajResult traj;
    SweepSpec sweep;
    std::vector<SweepPoint> sweepPoints;
    std::vector<double> sweepFem, sweepBal, sweepBalErr;
    std::vector<SweepSnapshot> sweepSnapshots;
    size_t sweepIndex = 0;
    Job job = Job::Idle;
    int trajNext = 0, trajTotal = 0;
    bool trajMulti = false;
    Params trajParams;
    std::chrono::steady_clock::time_point trajStart;
    std::string view = "device";
    // The panel can be light or dark and the core paints its own background,
    // so the theme has to reach here as well; otherwise a white page shows a
    // near-black device rectangle in the middle of it.
    bool light = true;
    // How the heat-map views are coloured. Display only: changing it never re-runs anything.
    struct Display {
        std::string seq = "viridis", div = "rdbu", scale = "auto";
        double clip = 100;          // top of the colour range at this percentile of the data
        int smooth = 0;             // 1-2-1 passes over the data grid before colouring
        bool interp = false, paths = true, invert = false, bar = true;
        double pathAlpha = .72;
    } disp;
    std::string lastScale;      // the last colour-range message sent, so it is sent only on change
    std::vector<uint8_t> frame = std::vector<uint8_t>(static_cast<size_t>(FRAME_W) * FRAME_H * 4, 255);
    std::deque<std::string> outbox;
    std::string handout;
};

GridFields buildFields(const Instance &s, const Params &p) {
    GridFields g;
    const double longest = std::max(p.Wum, p.Hum);
    g.nx = std::max(8, static_cast<int>(std::lround(clampi(p.res, 16, 300) * p.Wum / longest)));
    g.ny = std::max(8, static_cast<int>(std::lround(clampi(p.res, 16, 300) * p.Hum / longest)));
    g.dx = p.W() / g.nx;
    g.dy = p.H() / g.ny;
    g.n.resize(static_cast<size_t>(g.nx) * g.ny);
    g.mu.resize(g.n.size());
    const double n0 = p.n(), mu0 = p.mu(), phLen = p.phLen();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const double xf = (i + 0.5) / g.nx, yf = (j + 0.5) / g.ny;
        const size_t k = static_cast<size_t>(j) * g.nx + i;
        g.n[k] = s.densityMap.sample(xf, yf, n0 * 1e-4) * 1e4;
        const bool mapCond = p.mobScope == "cond" || p.mobScope == "both";
        g.mu[k] = mapCond ? s.mobilityMap.sample(xf, yf, mu0 * 1e4) * 1e-4 : mu0;
        // Phonons limit the mobility the same way they limit the trajectories
        // (Matthiessen): mu_ph = e l_ph / (hbar kF).  Off by default.
        if (phLen > 0 && g.n[k] != 0) {
            const double muPh = E_CHARGE * p.phLenAt(g.n[k]) / (HBAR * std::sqrt(M_PI * std::abs(g.n[k])));
            g.mu[k] = g.mu[k] > 0 ? 1.0 / (1.0 / g.mu[k] + 1.0 / muPh) : muPh;
        }
    }
    return g;
}

struct CSR {
    int N = 0;
    std::vector<int> row, col, freeId;
    std::vector<double> a, b;
};

void spmv(const CSR &A, const std::vector<double> &x, std::vector<double> &y) {
#ifdef _OPENMP
#pragma omp parallel for schedule(static) if(A.N > 12000)
#endif
    for (int r = 0; r < A.N; ++r) {
        double z = 0;
        for (int p = A.row[r]; p < A.row[r + 1]; ++p) z += A.a[p] * x[A.col[p]];
        y[r] = z;
    }
}

double dotv(const std::vector<double> &a, const std::vector<double> &b) {
    double s = 0;
#ifdef _OPENMP
#pragma omp parallel for reduction(+:s) schedule(static) if(a.size() > 20000)
#endif
    for (long long i = 0; i < static_cast<long long>(a.size()); ++i) s += a[static_cast<size_t>(i)] * b[static_cast<size_t>(i)];
    return s;
}

std::pair<int, double> bicgstab(const CSR &A, std::vector<double> &x, double tol, int maxIter) {
    const int N = A.N;
    x.assign(N, 0);
    std::vector<double> r = A.b, r0 = r, v(N), pp(N), ss(N), tt(N), ph(N), sh(N), tmp(N), diag(N, 1);
    for (int i = 0; i < N; ++i)
        for (int q = A.row[i]; q < A.row[i + 1]; ++q)
            if (A.col[q] == i && A.a[q] != 0) { diag[i] = A.a[q]; break; }
    const double bnorm = std::max(1e-300, std::sqrt(dotv(A.b, A.b)));
    double initial = std::sqrt(dotv(r, r)) / bnorm;
    if (initial < tol) return {0, initial};
    double rho = 1, alpha = 1, omega = 1, residual = initial;
    int done = 0;
    for (int it = 0; it < maxIter; ++it) {
        done = it + 1;
        double rhoNew = dotv(r0, r);
        if (std::abs(rhoNew) < 1e-30) {
            r0 = r;
            std::fill(pp.begin(), pp.end(), 0);
            std::fill(v.begin(), v.end(), 0);
            rho = alpha = omega = 1;
            rhoNew = dotv(r0, r);
            if (std::abs(rhoNew) < 1e-300) break;
        }
        const double beta = (rhoNew / rho) * (alpha / omega);
#ifdef _OPENMP
#pragma omp parallel for schedule(static) if(N > 20000)
#endif
        for (int i = 0; i < N; ++i) { pp[i] = r[i] + beta * (pp[i] - omega * v[i]); ph[i] = pp[i] / diag[i]; }
        spmv(A, ph, v);
        alpha = rhoNew / (dotv(r0, v) + 1e-300);
#ifdef _OPENMP
#pragma omp parallel for schedule(static) if(N > 20000)
#endif
        for (int i = 0; i < N; ++i) ss[i] = r[i] - alpha * v[i];
        const double snorm = std::sqrt(dotv(ss, ss)) / bnorm;
        if (snorm < tol) {
            for (int i = 0; i < N; ++i) x[i] += alpha * ph[i];
            residual = snorm;
            break;
        }
        for (int i = 0; i < N; ++i) sh[i] = ss[i] / diag[i];
        spmv(A, sh, tt);
        omega = dotv(tt, ss) / (dotv(tt, tt) + 1e-300);
#ifdef _OPENMP
#pragma omp parallel for schedule(static) if(N > 20000)
#endif
        for (int i = 0; i < N; ++i) { x[i] += alpha * ph[i] + omega * sh[i]; r[i] = ss[i] - omega * tt[i]; }
        residual = std::sqrt(dotv(r, r)) / bnorm;
        if (residual < tol || !std::isfinite(residual)) break;
        rho = rhoNew;
    }
    return {done, residual};
}

// Vorticity of the current density at cell centres, d(qy)/dx - d(qx)/dy (A/m^2).
void computeVorticity(FEMResult &o) {
    const int nx = o.nx, ny = o.ny;
    o.w.assign(static_cast<size_t>(nx) * ny, 0);
    if (o.qx.size() != o.w.size()) return;
    for (int j = 0; j < ny; ++j) for (int i = 0; i < nx; ++i) {
        const int ip = std::min(i + 1, nx - 1), im = std::max(i - 1, 0), jp = std::min(j + 1, ny - 1), jm = std::max(j - 1, 0);
        const double dqy = (o.qy[j * nx + ip] - o.qy[j * nx + im]) / (std::max(1, ip - im) * o.dx);
        const double dqx = (o.qx[jp * nx + i] - o.qx[jm * nx + i]) / (std::max(1, jp - jm) * o.dy);
        o.w[j * nx + i] = dqy - dqx;
    }
}

static bool g_faceCurrentForTests = false;   // true = always measure at the source faces (tests only): at large Hall angle that converges slowly with the grid (corner current crowding), while the mid-column flux reproduces B/ne exactly
static bool g_probeAverageForTests = false;  // true = the old probe reading: average over its cells (tests only)

// A voltage probe that sits on a sample edge reads the potential AT that edge: a linear
// extrapolation outward from the cell row along the edge and the row inside it. The
// edge is the one the probe is thinnest against (a full-height end probe is on its end,
// not on the top and bottom). A probe inside the sample is the plain cell average.
static double probeReading(const Contact &c, const std::vector<int> &cells, const std::vector<double> &u, int nx, int ny, double W, double H) {
    double v = 0; int n = 0;
    if (!g_probeAverageForTests) {
        const double e = 1e-9;
        const bool top = c.y1 >= 1 - e, bot = c.y0 <= e, right = c.x1 >= 1 - e, left = c.x0 <= e;
        const double ey = (c.y1 - c.y0) * H, ex = (c.x1 - c.x0) * W;
        int edge = -1;                              // 0 top, 1 bottom, 2 right, 3 left
        double best = 1e300;
        if (top && ey < best) { best = ey; edge = 0; }
        if (bot && ey < best) { best = ey; edge = 1; }
        if (right && ex < best) { best = ex; edge = 2; }
        if (left && ex < best) { best = ex; edge = 3; }
        if (edge >= 0) {
            for (int k : cells) {
                const int i = k % nx, j = k / nx;
                int k1 = -1;
                if (edge == 0 && j == ny - 1 && ny > 1) k1 = k - nx;
                else if (edge == 1 && j == 0 && ny > 1) k1 = k + nx;
                else if (edge == 2 && i == nx - 1 && nx > 1) k1 = k - 1;
                else if (edge == 3 && i == 0 && nx > 1) k1 = k + 1;
                if (k1 < 0 || !std::isfinite(u[k]) || !std::isfinite(u[k1])) continue;
                v += u[k] + 0.5 * (u[k] - u[k1]); ++n;
            }
            if (n) return v / n;
        }
    }
    for (int k : cells) if (std::isfinite(u[k])) { v += u[k]; ++n; }
    return n ? v / n : std::numeric_limits<double>::quiet_NaN();
}
FEMResult solveFEM(const Instance &s, const Params &p) {
    const auto t0 = std::chrono::steady_clock::now();
    FEMResult out;
    const GridFields g = buildFields(s, p);
    out.nx = g.nx; out.ny = g.ny; out.dx = g.dx; out.dy = g.dy; out.nfield = g.n;
    const int NN = g.nx * g.ny;
    std::vector<double> Kxx(NN), Kxy(NN), Kyx(NN), Kyy(NN);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int k = 0; k < NN; ++k) {
        const double muB = g.mu[k] * p.B;
        const double sigma0 = E_CHARGE * std::abs(g.n[k]) * g.mu[k];
        const double sig = sigma0 / (1 + muB * muB);
        const double sign = g.n[k] >= 0 ? 1.0 : -1.0;
        Kxx[k] = Kyy[k] = sig;
        Kxy[k] = -sign * sig * muB;
        Kyx[k] = sign * sig * muB;
    }

    // hard obstacles carry (almost) no current: insulating cells
    for (const Contact &c : s.contacts) if (isObstacle(c))
        for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i)
            if (inObstacle(c, (i + 0.5) / g.nx, (j + 0.5) / g.ny)) { const int k = j * g.nx + i; Kxx[k] *= 1e-9; Kyy[k] *= 1e-9; Kxy[k] = 0; Kyx[k] = 0; }
    std::vector<uint8_t> mask(NN, 0);
    std::vector<uint8_t> isSrc(NN, 0);      // which fixed cells are source (for the current)
    std::vector<double> fixed(NN, 0);
    std::vector<std::vector<int>> probeCells(s.contacts.size());
    std::vector<int> contactHits(s.contacts.size(), 0);
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const double xf = (i + 0.5) / g.nx, yf = (j + 0.5) / g.ny;
        for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (inContact(xf, yf, s.contacts[ci])) {
            const int k = j * g.nx + i;
            ++contactHits[ci];
            if (s.contacts[ci].role == "source" || s.contacts[ci].role == "drain") {
                mask[k] = 1; isSrc[k] = s.contacts[ci].role == "source";
                fixed[k] = s.contacts[ci].role == "source" ? p.Vsource : p.Vdrain;
            } else if (s.contacts[ci].role == "probe") probeCells[ci].push_back(k);
            break;
        }
    }
    // Very thin drawn contacts still get one cell, instead of silently disappearing.
    for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (!contactHits[ci]) {
        const Contact &c = s.contacts[ci];
        const int i = clampi(static_cast<int>(0.5 * (c.x0 + c.x1) * g.nx), 0, g.nx - 1);
        const int j = clampi(static_cast<int>(0.5 * (c.y0 + c.y1) * g.ny), 0, g.ny - 1);
        const int k = j * g.nx + i;
        if (c.role == "source" || c.role == "drain") { mask[k] = 1; isSrc[k] = c.role == "source"; fixed[k] = c.role == "source" ? p.Vsource : p.Vdrain; }
        else if (c.role == "probe") probeCells[ci].push_back(k);
    }
    bool hasSource = false, hasDrain = false;
    for (const Contact &c : s.contacts) { hasSource |= c.role == "source"; hasDrain |= c.role == "drain"; }
    if (!hasSource || !hasDrain) { out.error = "Add at least one source and one drain contact."; return out; }

    CSR A;
    A.freeId.assign(NN, -1);
    for (int k = 0; k < NN; ++k) if (!mask[k]) A.freeId[k] = A.N++;
    A.row.resize(A.N + 1); A.b.assign(A.N, 0);
    std::vector<std::vector<std::pair<int, double>>> rows(A.N);
    auto idx = [&](int i, int j) { return j * g.nx + i; };
    auto cidx = [&](int i, int j) { return idx(clampi(i, 0, g.nx - 1), clampi(j, 0, g.ny - 1)); };
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const int k = idx(i, j);
        if (mask[k]) continue;
        const int r = A.freeId[k];
        std::vector<std::pair<int, double>> acc;
        auto add = [&](int m, double z) {
            if (z == 0) return;
            for (auto &e : acc) if (e.first == m) { e.second += z; return; }
            acc.push_back({m, z});
        };
        if (i + 1 < g.nx) {
            const int q = idx(i + 1, j); const double xx = .5 * (Kxx[k] + Kxx[q]), xy = .5 * (Kxy[k] + Kxy[q]);
            const double gl = xx * g.dy / g.dx, h = xy / 4; add(k, gl); add(q, -gl);
            add(cidx(i, j + 1), -h); add(cidx(i + 1, j + 1), -h); add(cidx(i, j - 1), h); add(cidx(i + 1, j - 1), h);
        }
        if (i - 1 >= 0) {
            const int q = idx(i - 1, j); const double xx = .5 * (Kxx[k] + Kxx[q]), xy = .5 * (Kxy[k] + Kxy[q]);
            const double gl = xx * g.dy / g.dx, h = xy / 4; add(k, gl); add(q, -gl);
            add(cidx(i, j + 1), h); add(cidx(i - 1, j + 1), h); add(cidx(i, j - 1), -h); add(cidx(i - 1, j - 1), -h);
        }
        if (j + 1 < g.ny) {
            const int q = idx(i, j + 1); const double yy = .5 * (Kyy[k] + Kyy[q]), yx = .5 * (Kyx[k] + Kyx[q]);
            const double gl = yy * g.dx / g.dy, h = yx / 4; add(k, gl); add(q, -gl);
            add(cidx(i + 1, j), -h); add(cidx(i + 1, j + 1), -h); add(cidx(i - 1, j), h); add(cidx(i - 1, j + 1), h);
        }
        if (j - 1 >= 0) {
            const int q = idx(i, j - 1); const double yy = .5 * (Kyy[k] + Kyy[q]), yx = .5 * (Kyx[k] + Kyx[q]);
            const double gl = yy * g.dx / g.dy, h = yx / 4; add(k, gl); add(q, -gl);
            add(cidx(i + 1, j), h); add(cidx(i + 1, j - 1), h); add(cidx(i - 1, j), -h); add(cidx(i - 1, j - 1), -h);
        }
        for (const auto &e : acc) {
            if (A.freeId[e.first] >= 0) rows[r].push_back({A.freeId[e.first], e.second});
            else A.b[r] -= e.second * fixed[e.first];
        }
    }
    for (int r = 0; r < A.N; ++r) {
        std::sort(rows[r].begin(), rows[r].end(), [](auto a, auto b) { return a.first < b.first; });
        std::vector<std::pair<int, double>> merged;
        for (const auto &e : rows[r]) {
            if (!merged.empty() && merged.back().first == e.first) merged.back().second += e.second;
            else merged.push_back(e);
        }
        double diag = 0;
        for (const auto &e : merged) if (e.first == r) diag = std::abs(e.second);
        if (!(diag > 0)) diag = 1;
        A.row[r] = static_cast<int>(A.a.size());
        for (const auto &e : merged) { A.col.push_back(e.first); A.a.push_back(e.second / diag); }
        A.b[r] /= diag;
    }
    A.row[A.N] = static_cast<int>(A.a.size());
    std::vector<double> reduced;
    auto solved = bicgstab(A, reduced, clampd(p.femTol, 1e-12, 1e-3), clampi(p.femIter, 50, 50000));
    out.iters = solved.first; out.residual = solved.second; out.converged = std::isfinite(out.residual) && out.residual <= clampd(p.femTol, 1e-12, 1e-3);
    // BiCGSTAB can stall or blow up at large Hall angles with strong conductivity contrast
    // (a metal shunt in a high-mobility sheet: the EMR regime). Then solve the same system
    // directly. A converged iterative solve is left exactly as it was.
    if (!out.converged && A.N > 0) {
        std::vector<Eigen::Triplet<double>> trip; trip.reserve(A.a.size());
        for (int r = 0; r < A.N; ++r) for (int q = A.row[r]; q < A.row[r + 1]; ++q) trip.emplace_back(r, A.col[q], A.a[q]);
        Eigen::SparseMatrix<double> M(A.N, A.N); M.setFromTriplets(trip.begin(), trip.end()); M.makeCompressed();
        Eigen::SparseLU<Eigen::SparseMatrix<double>, Eigen::COLAMDOrdering<int>> lu; lu.compute(M);
        if (lu.info() == Eigen::Success) {
            Eigen::Map<const Eigen::VectorXd> bb(A.b.data(), A.N);
            Eigen::VectorXd x = lu.solve(bb);
            const double rn = (bb - M * x).norm(), bn = std::max(1e-300, bb.norm());
            if (x.allFinite() && rn / bn < 1e-8) {
                reduced.assign(x.data(), x.data() + A.N);
                out.residual = rn / bn; out.converged = true; out.direct = true;
            }
        }
    }
    out.u.resize(NN);
    for (int k = 0; k < NN; ++k) out.u[k] = A.freeId[k] >= 0 ? reduced[A.freeId[k]] : fixed[k];
    out.qx.resize(NN); out.qy.resize(NN);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const int k = idx(i, j), ip = std::min(i + 1, g.nx - 1), im = std::max(i - 1, 0), jp = std::min(j + 1, g.ny - 1), jm = std::max(j - 1, 0);
        const double dudx = (out.u[idx(ip, j)] - out.u[idx(im, j)]) / (std::max(1, ip - im) * g.dx);
        const double dudy = (out.u[idx(i, jp)] - out.u[idx(i, jm)]) / (std::max(1, jp - jm) * g.dy);
        out.qx[k] = -(Kxx[k] * dudx + Kxy[k] * dudy);
        out.qy[k] = -(Kyx[k] * dudx + Kyy[k] * dudy);
    }
    const int col = g.nx / 2;
    // The flux through the middle column is the current only when every source cell lies on
    // one side of it and every drain cell on the other (the usual left-to-right device; those
    // results are unchanged). Otherwise - source and drain on the same side, contacts along
    // one edge - take the current leaving the source cells, with the solver's own stencil.
    bool split = true; int sSide = 0, dSide = 0;
    for (int k = 0; k < NN && split; ++k) if (mask[k]) {
        const int i = k % g.nx, side = i < col ? -1 : i > col ? 1 : 0;
        int &ref = isSrc[k] ? sSide : dSide;
        if (side == 0 || (ref != 0 && ref != side)) split = false; else ref = side;
    }
    if (split && sSide != 0 && sSide == -dSide && !g_faceCurrentForTests) {
        for (int j = 0; j < g.ny; ++j) out.current += out.qx[idx(col, j)] * g.dy;
        if (sSide > 0) out.current = -out.current;
    } else {
        auto U = [&](int i, int j) { return out.u[cidx(i, j)]; };
        double I = 0;
        for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
            const int k = idx(i, j);
            if (!isSrc[k]) continue;
            if (i + 1 < g.nx && !isSrc[idx(i + 1, j)]) { const int q = idx(i + 1, j);
                I += .5 * (Kxx[k] + Kxx[q]) * g.dy / g.dx * (U(i, j) - U(i + 1, j)) + .5 * (Kxy[k] + Kxy[q]) / 4 * (U(i, j - 1) + U(i + 1, j - 1) - U(i, j + 1) - U(i + 1, j + 1)); }
            if (i - 1 >= 0 && !isSrc[idx(i - 1, j)]) { const int q = idx(i - 1, j);
                I += .5 * (Kxx[k] + Kxx[q]) * g.dy / g.dx * (U(i, j) - U(i - 1, j)) + .5 * (Kxy[k] + Kxy[q]) / 4 * (U(i, j + 1) + U(i - 1, j + 1) - U(i, j - 1) - U(i - 1, j - 1)); }
            if (j + 1 < g.ny && !isSrc[idx(i, j + 1)]) { const int q = idx(i, j + 1);
                I += .5 * (Kyy[k] + Kyy[q]) * g.dx / g.dy * (U(i, j) - U(i, j + 1)) + .5 * (Kyx[k] + Kyx[q]) / 4 * (U(i - 1, j) + U(i - 1, j + 1) - U(i + 1, j) - U(i + 1, j + 1)); }
            if (j - 1 >= 0 && !isSrc[idx(i, j - 1)]) { const int q = idx(i, j - 1);
                I += .5 * (Kyy[k] + Kyy[q]) * g.dx / g.dy * (U(i, j) - U(i, j - 1)) + .5 * (Kyx[k] + Kyx[q]) / 4 * (U(i + 1, j) + U(i + 1, j - 1) - U(i - 1, j) - U(i - 1, j - 1)); }
        }
        out.current = I;
    }
    if (std::abs(out.current) > 1e-300) out.resistance = (p.Vsource - p.Vdrain) / out.current;
    for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (s.contacts[ci].role == "probe" && !probeCells[ci].empty())
        out.probes.push_back({s.contacts[ci].id, probeReading(s.contacts[ci], probeCells[ci], out.u, g.nx, g.ny, p.Wum, p.Hum)});
    computeVorticity(out);
    out.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    out.valid = true;
    return out;
}

// ---------------------------------------------------------------- hydrodynamic field model

constexpr double KB_SI = 1.380649e-23;

// Everything the viscous model derives from the panel's parameters, in SI.
struct HydroPhys {
    bool ok = false; std::string why;
    double kf = 0, EF = 0, mstar = 0, lmr = 0, taumr = 0, lee = 0, tauee = 0;
    double nu0 = 0, nuxx = 0, nuH = 0, omega = 0, s = 0, D2 = 0, Dh2 = 0, rho = 0;
};
HydroPhys hydroPhys(const Params &p) {
    HydroPhys h;
    const double n = p.n();
    if (n == 0) { h.why = "n = 0: the hydrodynamic model needs carriers"; return h; }
    h.kf = std::sqrt(M_PI * std::abs(n)); h.EF = HBAR * FERMI_V * h.kf; h.mstar = HBAR * h.kf / FERMI_V;
    const double imp = p.mfp(), ph = p.phLen();
    h.lmr = (ph > 0 && imp > 0) ? 1.0 / (1.0 / imp + 1.0 / ph) : (ph > 0 ? ph : imp);
    if (!(h.lmr > 0)) { h.why = "the momentum-relaxing mean free path is 0"; return h; }
    h.taumr = h.lmr / FERMI_V;
    if (p.hydroLeeUm > 0) h.lee = p.hydroLeeUm * 1e-6;
    else {
        if (p.tempK <= 0) { h.why = "T = 0 gives no electron-electron scattering: set l_ee directly"; return h; }
        const double kT = KB_SI * p.tempK;
        h.lee = FERMI_V * std::max(1e-3, p.hydroCee) * HBAR * h.EF / (kT * kT);
    }
    h.tauee = h.lee / FERMI_V;
    h.nu0 = FERMI_V * h.lee / 4;
    const double q = n > 0 ? -E_CHARGE : E_CHARGE;
    h.omega = q * p.B / h.mstar;
    const double x = 2 * h.omega * h.tauee;
    if (p.hydroHallVisc) { h.nuxx = h.nu0 / (1 + x * x); h.nuH = h.nu0 * x / (1 + x * x); }
    else { h.nuxx = h.nu0; h.nuH = 0; }
    h.s = h.omega * h.taumr; h.D2 = h.nuxx * h.taumr; h.Dh2 = h.nuH * h.taumr;
    h.rho = h.mstar / (std::abs(n) * E_CHARGE * E_CHARGE * h.taumr);
    h.ok = true;
    return h;
}

FEMResult solveHydro(const Instance &s, const Params &p) {
    const auto t0 = std::chrono::steady_clock::now();
    FEMResult out; out.model = "hydro";
    const GridFields g = buildFields(s, p);
    out.nx = g.nx; out.ny = g.ny; out.dx = g.dx; out.dy = g.dy; out.nfield = g.n;
    const HydroPhys h = hydroPhys(p);
    if (!h.ok) { out.error = h.why; return out; }
    bool hasSource = false, hasDrain = false;
    for (const Contact &c : s.contacts) { hasSource |= c.role == "source"; hasDrain |= c.role == "drain"; }
    if (!hasSource || !hasDrain) { out.error = "Add at least one source and one drain contact."; return out; }
    const int NN = g.nx * g.ny;
    hydro::Problem P;
    P.nx = g.nx; P.ny = g.ny; P.dx = g.dx * 1e6; P.dy = g.dy * 1e6;
    P.cell.assign(NN, hydro::FLUID); P.resV.assign(NN, 0);
    std::vector<int8_t> role(NN, 0);   // +1 source cell, -1 drain cell
    std::vector<std::vector<int>> probeCells(s.contacts.size());
    std::vector<int> contactHits(s.contacts.size(), 0);
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const double xf = (i + 0.5) / g.nx, yf = (j + 0.5) / g.ny;
        const int k = j * g.nx + i;
        for (size_t ci = 0; ci < s.contacts.size(); ++ci) {
            const Contact &c = s.contacts[ci];
            if (isObstacle(c)) {             // a hard wall: a solid obstacle in the fluid
                if (inObstacle(c, xf, yf)) { P.cell[k] = hydro::SOLID; ++contactHits[ci]; break; }
                continue;
            }
            if (!inContact(xf, yf, c)) continue;
            ++contactHits[ci];
            if (c.role == "source" || c.role == "drain") {
                P.cell[k] = hydro::RES; P.resV[k] = c.role == "source" ? p.Vsource : p.Vdrain; role[k] = c.role == "source" ? 1 : -1;
            } else if (c.role == "probe") probeCells[ci].push_back(k);
            break;
        }
    }
    for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (!contactHits[ci]) {   // very thin contacts still get one cell
        const Contact &c = s.contacts[ci];
        const int i = clampi(static_cast<int>(0.5 * (c.x0 + c.x1) * g.nx), 0, g.nx - 1);
        const int j = clampi(static_cast<int>(0.5 * (c.y0 + c.y1) * g.ny), 0, g.ny - 1);
        const int k = j * g.nx + i;
        if (c.role == "source" || c.role == "drain") { P.cell[k] = hydro::RES; P.resV[k] = c.role == "source" ? p.Vsource : p.Vdrain; role[k] = c.role == "source" ? 1 : -1; }
        else if (c.role == "probe") probeCells[ci].push_back(k);
    }
    P.D2 = h.D2 * 1e12; P.Dh2 = h.Dh2 * 1e12; P.s = h.s; P.slip = p.hydroSlipUm;
    const hydro::Solution S = hydro::solve(P);
    if (!S.ok) { out.error = "hydrodynamic solve: " + S.error; return out; }
    std::string note;
    if (s.densityMap.valid() || s.mobilityMap.valid()) note += "The hydrodynamic model uses the uniform n and mobility; the spatial maps are ignored. ";
    const double Dum = std::sqrt(std::max(0.0, P.D2)), cellUm = std::max(P.dx, P.dy);
    if (Dum > 0 && Dum < 2 * cellUm) note += "The Gurzhi length (" + std::to_string(Dum).substr(0, 6) + " um) is under two cells: the wall boundary layer is not resolved; raise the resolution. ";
    if (S.isolated) note += std::to_string(S.isolated) + " fluid cells are cut off from every contact and were left out. ";
    out.note = note;
    const double scale = 1e6 / h.rho;               // jt (V/um) -> current density (A/m)
    const int nx = g.nx, ny = g.ny;
    out.u = S.phi;
    out.qx.assign(NN, 0); out.qy.assign(NN, 0);
    for (int j = 0; j < ny; ++j) for (int i = 0; i < nx; ++i) {
        const int k = j * nx + i;
        if (P.cell[k] != hydro::FLUID) continue;
        out.qx[k] = 0.5 * (S.jx[j * (nx + 1) + i] + S.jx[j * (nx + 1) + i + 1]) * scale;
        out.qy[k] = 0.5 * (S.jy[j * nx + i] + S.jy[(j + 1) * nx + i]) * scale;
    }
    // current: what leaves the source reservoirs into the fluid
    double I = 0;
    for (int j = 0; j < ny; ++j) for (int i = 1; i < nx; ++i) {
        const int kL = j * nx + i - 1, kR = j * nx + i;
        if (role[kL] == 1 && P.cell[kR] == hydro::FLUID) I += S.jx[j * (nx + 1) + i] * scale * g.dy;
        if (role[kR] == 1 && P.cell[kL] == hydro::FLUID) I -= S.jx[j * (nx + 1) + i] * scale * g.dy;
    }
    for (int j = 1; j < ny; ++j) for (int i = 0; i < nx; ++i) {
        const int kD = (j - 1) * nx + i, kU = j * nx + i;
        if (role[kD] == 1 && P.cell[kU] == hydro::FLUID) I += S.jy[j * nx + i] * scale * g.dx;
        if (role[kU] == 1 && P.cell[kD] == hydro::FLUID) I -= S.jy[j * nx + i] * scale * g.dx;
    }
    out.current = I;
    if (std::abs(I) > 1e-300) out.resistance = (p.Vsource - p.Vdrain) / I;
    for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (s.contacts[ci].role == "probe" && !probeCells[ci].empty()) {
        const double v = probeReading(s.contacts[ci], probeCells[ci], out.u, nx, ny, p.Wum, p.Hum);
        if (std::isfinite(v)) out.probes.push_back({s.contacts[ci].id, v});
    }
    out.residual = S.residual; out.iters = 0; out.converged = S.residual < 1e-6;
    out.leeUm = h.lee * 1e6; out.lmrUm = h.lmr * 1e6; out.DnuUm = std::sqrt(h.D2) * 1e6;
    out.nu0 = h.nu0; out.nuxx = h.nuxx; out.nuH = h.nuH; out.sHall = h.s;
    computeVorticity(out);
    out.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    out.valid = true;
    return out;
}

FEMResult solveField(const Instance &s, const Params &p) {
    return p.fieldModel == "hydro" ? solveHydro(s, p) : solveFEM(s, p);
}

// ---------------------------------------------------------------- trajectories

struct RNG {
    uint32_t a;
    explicit RNG(uint32_t seed) : a(seed ? seed : 1u) {}
    double next() {
        uint32_t z = (a += 0x6D2B79F5u);
        z = (z ^ (z >> 15)) * (z | 1u);
        z ^= z + ((z ^ (z >> 7)) * (z | 61u));
        return static_cast<double>(z ^ (z >> 14)) / 4294967296.0;
    }
};

inline uint32_t hash32(uint32_t x) {
    x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
    return x;
}
// The seed is hashed BEFORE it meets the trajectory index: combining them
// directly made seed s and s+1 run nearly the same trajectories shifted by a few
// indices (seeds 7 and 8 shared 1935 of 2000), so two seeds were not two runs.
uint32_t mixedSeedHashed(uint32_t seed, uint32_t i) {
    const uint32_t h = hash32(seed * 0x9E3779B1u + 0x85EBCA6Bu);
    const uint32_t x = hash32(h + i * 0x9E3779B9u + 0x632BE5ABu);
    return x ? x : 1u;
}
uint32_t mixedSeed(uint32_t seed, uint32_t i) {
    uint32_t x = seed ^ (i + 0x9e3779b9u + (seed << 6) + (seed >> 2));
    x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
    return x ? x : 1u;
}

struct EdgeInfo { int side = 0; double angle = 0, width = 0, cx = 0, cy = 0; };

EdgeInfo edgeInfo(const Contact &c, const Params &p) {
    const double gaps[4] = {c.x0, 1 - c.x1, c.y0, 1 - c.y1};
    int e = 0; for (int i = 1; i < 4; ++i) if (gaps[i] < gaps[e]) e = i;
    static const double ang[4] = {0, M_PI, M_PI / 2, -M_PI / 2};
    EdgeInfo out; out.side = e; out.angle = ang[e];
    out.width = (e < 2 ? c.y1 - c.y0 : c.x1 - c.x0) * (e < 2 ? p.H() : p.W());
    out.cx = .5 * (c.x0 + c.x1) * p.W(); out.cy = .5 * (c.y0 + c.y1) * p.H();
    return out;
}

double localN(const Instance &s, const Params &p, double x, double y) {
    return s.densityMap.sample(x / p.W(), y / p.H(), p.ncm2) * 1e4;
}

double localMfp(const Instance &s, const Params &p, double x, double y) {
    if (!p.mfpFromMobility && !(s.mobilityMap.valid() && (p.mobScope == "mfp" || p.mobScope == "both"))) return std::max(0.0, p.mfpum) * 1e-6;
    const double n = std::abs(localN(s, p, x, y));
    const bool mapped = s.mobilityMap.valid() && (p.mobScope == "mfp" || p.mobScope == "both");
    const double mu = (mapped ? s.mobilityMap.sample(x / p.W(), y / p.H(), p.mucm) : p.mucm) * 1e-4;
    return HBAR * mu * std::sqrt(M_PI * n) / E_CHARGE;
}

int contactAt(const Instance &s, const Params &p, double x, double y, bool includeProbes) {
    const double xf = x / p.W(), yf = y / p.H();
    for (size_t i = 0; i < s.contacts.size(); ++i) {
        if (!includeProbes && s.contacts[i].role == "probe") continue;
        if (isObstacle(s.contacts[i])) continue;
        if (inContact(xf, yf, s.contacts[i])) return static_cast<int>(i);
    }
    return -1;
}

constexpr int TRAJ_BATCHES = 10;   // jackknife batches for error bars

struct LocalAgg {
    std::array<uint64_t, 5> statuses{};
    std::vector<uint64_t> density, reached, launched;
    std::vector<uint64_t> reachedB, launchedB;   // per batch: [b*nc*nc + i*nc + j], [b*nc + i]
    double pathSum = 0, scatterSum = 0;
    uint64_t arcFlights = 0, signCross = 0, pnTrans = 0, pnRefl = 0;
    LocalAgg(int pixels, int nc) : density(pixels), reached(static_cast<size_t>(nc) * nc), launched(nc),
        reachedB(static_cast<size_t>(TRAJ_BATCHES) * nc * nc), launchedB(static_cast<size_t>(TRAJ_BATCHES) * nc) {}
};

// One flight segment of an exact circular arc (or straight line when kappa == 0).
// Stable form: the chord is 2/kappa sin(kappa s / 2) along the mid direction.
inline void arcAdvance(double s, double kappa, double &x, double &y, double &th) {
    if (kappa == 0) { x += s * std::cos(th); y += s * std::sin(th); return; }
    const double h = 0.5 * kappa * s, chord = 2.0 * std::sin(h) / kappa, mid = th + h;
    x += chord * std::cos(mid); y += chord * std::sin(mid); th += 2 * h;
}

// First s > eps at which the path from (x, y, th) with curvature kappa meets the
// line x = X (vertical) or y = Y (horizontal), with the other coordinate inside
// [lo, hi].  Returns +inf when it never does.
double arcHitLine(double x, double y, double th, double kappa, bool vertical, double C,
                  double lo, double hi, double eps, double tol) {
    const double INF = std::numeric_limits<double>::infinity();
    auto inSeg = [&](double s) {
        double xx = x, yy = y, t = th; arcAdvance(s, kappa, xx, yy, t);
        const double o = vertical ? yy : xx;
        return o >= lo - tol && o <= hi + tol;
    };
    if (kappa == 0) {
        const double v = vertical ? std::cos(th) : std::sin(th);
        if (std::abs(v) < 1e-15) return INF;
        const double s = (C - (vertical ? x : y)) / v;
        return (s > eps && inSeg(s)) ? s : INF;
    }
    const double cx = x - std::sin(th) / kappa, cy = y + std::cos(th) / kappa;
    double phi[2]; int n = 0;
    if (vertical) {            // x(s) = cx + sin(phi)/kappa
        const double a = kappa * (C - cx);
        if (a < -1 || a > 1) return INF;
        const double b = std::asin(a); phi[n++] = b; phi[n++] = M_PI - b;
    } else {                   // y(s) = cy - cos(phi)/kappa
        const double a = kappa * (cy - C);
        if (a < -1 || a > 1) return INF;
        const double b = std::acos(a); phi[n++] = b; phi[n++] = -b;
    }
    const double P = 2 * M_PI / std::abs(kappa);
    double best = INF;
    for (int i = 0; i < n; ++i) {
        double s = (phi[i] - th) / kappa;
        s -= P * std::floor((s - eps) / P);          // into (eps, eps + P]
        if (s > eps && s < best && inSeg(s)) best = s;
    }
    return best;
}

struct Seg { bool vertical; double c, lo, hi; };

// A diffusive carrier needs about L^2 / l of path to cross a sample of size L
// (a random walk of step l); the fixed 240 um budget cut exactly those long
// transmitting paths off when l is short (T came out 30-50 % low at l = 20 nm).
// The budget is 20 L^2 / l_tr, capped by the step limit in simulateOne.
double diffusivePathBudget(const Params &p) {
    const double imp = p.scattering == "none" ? 0 : p.mfp(), ph = p.phLen();
    const double l = (imp > 0 && ph > 0) ? 1.0 / (1.0 / imp + 1.0 / ph) : (imp > 0 ? imp : ph);
    if (!(l > 0)) return 0;
    const double L = std::max(p.W(), p.H());
    return std::min(0.05, 20.0 * L * L / l);
}

void simulateOne(const Instance &s, const Params &p, int ti, bool multi,
                 LocalAgg &agg, Path *saved) {
    const int nc = static_cast<int>(s.contacts.size());
    std::vector<int> sources;
    for (int i = 0; i < nc; ++i)
        if ((multi && !isObstacle(s.contacts[i])) || s.contacts[i].role == "source") sources.push_back(i);
    if (sources.empty()) return;
    const int source = sources[ti % sources.size()];
    RNG rng(p.seedMix ? mixedSeedHashed(static_cast<uint32_t>(p.seed), static_cast<uint32_t>(ti))
                      : mixedSeed(static_cast<uint32_t>(p.seed), static_cast<uint32_t>(ti)));
    const int batch = (ti / static_cast<int>(sources.size())) % TRAJ_BATCHES;
    const Contact &src = s.contacts[source];
    const EdgeInfo se = edgeInfo(src, p);
    double x = (src.x0 + rng.next() * (src.x1 - src.x0)) * p.W();
    double y = (src.y0 + rng.next() * (src.y1 - src.y0)) * p.H();
    double theta = se.angle + std::asin(2 * rng.next() - 1);
    x = clampd(x, 1e-12, p.W() - 1e-12); y = clampd(y, 1e-12, p.H() - 1e-12);
    ++agg.launched[source];
    ++agg.launchedB[static_cast<size_t>(batch) * nc + source];

    const double INF = std::numeric_limits<double>::infinity();
    const double base = std::min(p.W(), p.H()) / 180.0;
    const scat::Model sm = p.scatModel();
    double maxPath = std::max(std::min(p.W(), p.H()), p.maxPathUm * 1e-6);
    if (p.pathAuto) maxPath = std::max(maxPath, diffusivePathBudget(p));
    const bool onlyImp = sm.phLen <= 0 && sm.eeLen <= 0;
    // Shortest event length at the nominal density sets how many steps a flight may need.
    double nominal = std::max(1e-12, p.mfp());
    if (!onlyImp || sm.imp != scat::Imp::Isotropic) {
        const scat::Rates r0 = scat::rates(sm, sm.impEventLen(std::max(1e-12, p.mfp())));
        nominal = r0.total() > 0 ? std::max(1e-12, 1.0 / r0.total()) : 1.0;
    }
    const int maxSteps = std::min(2000000, std::max(p.maxSteps,
        static_cast<int>(std::ceil(maxPath / std::max(base * .01, std::min(base, nominal)))) + 100));

    scat::Rates rates;
    // Distance to the next bulk event.  With only the impurity channel this is the
    // original engine's draw, arithmetic and RNG use included.
    auto drawNext = [&](double xx, double yy) -> double {
        const double ev = sm.impEventLen(std::max(base * 1e-6, localMfp(s, p, xx, yy)));
        rates = scat::rates(sm, ev);
        if (rates.total() <= 0) return INF;
        const double len = onlyImp ? ev : 1.0 / rates.total();
        return -len * std::log(std::max(1e-12, rng.next()));
    };

    double sinceScatter = 0;
    double nextScatter = drawNext(x, y);
    double pathLen = 0;
    int nScatter = 0, status = MAXSTEPS, terminal = -1;
    bool leftSource = false;
    if (saved) { saved->points.clear(); saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())}); }
    auto savePt = [&](double xx, double yy) {
        if (saved && saved->points.size() < 900) saved->points.push_back({static_cast<float>(xx / p.W()), static_cast<float>(yy / p.H())});
    };
    auto deposit = [&](double xx, double yy) {
        const int ix = clampi(static_cast<int>(xx / p.W() * s.traj.gx), 0, s.traj.gx - 1);
        const int iy = clampi(static_cast<int>(yy / p.H() * s.traj.gy), 0, s.traj.gy - 1);
        ++agg.density[static_cast<size_t>(iy) * s.traj.gx + ix];
    };
    auto land = [&](int ci) {
        terminal = ci;
        if (ci == source) status = REFLECTED;
        else if (s.contacts[ci].role == "absorber" || s.contacts[ci].role == "floating") status = ABSORBED;
        else status = TRANSMITTED;
    };

    // ------------------------------------------------ exact arcs (uniform density)
    // Reflecting targets: hard-wall ellipses inscribed in their contact rectangle
    // (a circle when the rectangle is square in micrometres).
    // (walls are the rectangles themselves; both reflect specularly)
    struct Refl { double cx, cy, ax, ay; bool rect; };
    std::vector<Refl> refl;
    for (const Contact &c : s.contacts) if (isObstacle(c) && c.x1 > c.x0 && c.y1 > c.y0)
        refl.push_back({0.5 * (c.x0 + c.x1) * p.W(), 0.5 * (c.y0 + c.y1) * p.H(), 0.5 * (c.x1 - c.x0) * p.W(), 0.5 * (c.y1 - c.y0) * p.H(), c.role == "wall"});
    auto insideRefl = [](const Refl &E, double xx, double yy) {
        if (E.rect) return std::abs(xx - E.cx) < E.ax && std::abs(yy - E.cy) < E.ay;
        const double u = (xx - E.cx) / E.ax, v = (yy - E.cy) / E.ay;
        return u * u + v * v < 1;
    };
    auto inRefl = [&](double xx, double yy) -> int {
        for (size_t k = 0; k < refl.size(); ++k) if (insideRefl(refl[k], xx, yy)) return static_cast<int>(k);
        return -1;
    };
    const bool useArc = p.tracer == "arc" && !s.densityMap.valid() && refl.empty();
    if (useArc) {
        ++agg.arcFlights;
        const double n0 = p.n();
        double kappa = 0;
        if (p.B != 0 && n0 != 0) {
            const double rc = HBAR * std::sqrt(M_PI * std::abs(n0)) / (E_CHARGE * std::abs(p.B));
            const double turnSign = (p.B >= 0 ? 1.0 : -1.0) * (n0 >= 0 ? 1.0 : -1.0);
            kappa = turnSign / rc;
            // A field near zero must take the straight path: an arc of radius
            // 1e6 m deviates by < 1e-10 m over any device, and solving for the
            // rotation angle at that radius loses all precision (Klein gate G19).
            if (std::abs(kappa) < 1e-6) kappa = 0;
        }
        const double W = p.W(), H = p.H(), size = std::max(W, H);
        const double eps = 1e-12 * size, tol = 1e-12 * size;
        std::vector<Seg> segs;
        segs.push_back({true, 0, 0, H}); segs.push_back({true, W, 0, H});
        segs.push_back({false, 0, 0, W}); segs.push_back({false, H, 0, W});
        // Contact edges that lie on the device boundary are handled by the wall
        // event (the hit point is tested for a contact), so only interior edges
        // become events of their own.
        const size_t firstContactSeg = segs.size();
        for (const Contact &c : s.contacts) {
            const double x0 = c.x0 * W, x1 = c.x1 * W, y0 = c.y0 * H, y1 = c.y1 * H;
            if (c.x0 > 1e-9) segs.push_back({true, x0, y0, y1});
            if (c.x1 < 1 - 1e-9) segs.push_back({true, x1, y0, y1});
            if (c.y0 > 1e-9) segs.push_back({false, y0, x0, x1});
            if (c.y1 < 1 - 1e-9) segs.push_back({false, y1, x0, x1});
        }
        const double drawStep = kappa != 0 ? std::min(2 * base, 0.25 / std::abs(kappa)) : 2 * base;
        double depAcc = 0, drawAcc = 0;
        for (int ev = 0; ev < maxSteps && pathLen < maxPath; ++ev) {
            double sNext = std::min(nextScatter - sinceScatter, maxPath - pathLen);
            int hit = -1; // -1 scatter / cap, otherwise index into segs
            for (size_t k = 0; k < segs.size(); ++k) {
                const Seg &g = segs[k];
                const double sh = arcHitLine(x, y, theta, kappa, g.vertical, g.c, g.lo, g.hi, eps, tol);
                if (sh < sNext) { sNext = sh; hit = static_cast<int>(k); }
            }
            if (!(sNext >= 0)) sNext = 0;
            // path-length density and the drawn path, sampled along the flight
            {
                double sd = base - depAcc;
                for (; sd <= sNext; sd += base) { double xx = x, yy = y, t = theta; arcAdvance(sd, kappa, xx, yy, t); deposit(xx, yy); }
                depAcc = std::fmod(depAcc + sNext, base);
                if (saved) {
                    double sv = drawStep - drawAcc;
                    for (; sv <= sNext && saved->points.size() < 900; sv += drawStep) { double xx = x, yy = y, t = theta; arcAdvance(sv, kappa, xx, yy, t); savePt(xx, yy); }
                    drawAcc = std::fmod(drawAcc + sNext, drawStep);
                }
            }
            arcAdvance(sNext, kappa, x, y, theta);
            pathLen += sNext; sinceScatter += sNext;
            if (hit < 0) {
                if (sinceScatter + base * 1e-8 >= nextScatter && nextScatter < INF) {
                    if (scat::applyEvent(sm, rates, theta, rng)) ++nScatter;
                    sinceScatter = 0;
                    nextScatter = drawNext(x, y);
                    savePt(x, y);
                    continue;
                }
                break; // path cap
            }
            if (static_cast<size_t>(hit) < firstContactSeg) {
                const int side = hit; // 0 x=0, 1 x=W, 2 y=0, 3 y=H
                const double hx = clampd(x, 0, W), hy = clampd(y, 0, H);
                const int ci = contactAt(s, p, clampd(hx, 1e-12, W - 1e-12), clampd(hy, 1e-12, H - 1e-12), multi);
                if (ci >= 0 && (ci != source || leftSource)) { land(ci); savePt(hx, hy); break; }
                if (p.edge == "absorbing") { status = LOST; savePt(hx, hy); break; }
                const double onx = side == 0 ? -1 : side == 1 ? 1 : 0;
                const double ony = side == 2 ? -1 : side == 3 ? 1 : 0;
                theta = scat::reflect(p.edge, p.specularity, theta, onx, ony, rng);
                x = clampd(hx, 1e-12, W - 1e-12); y = clampd(hy, 1e-12, H - 1e-12);
                savePt(x, y);
                continue;
            }
            // crossed an interior contact edge: look just past it
            const double d = 1e-9 * size;
            const int ci = contactAt(s, p, clampd(x + d * std::cos(theta), 1e-12, W - 1e-12),
                                     clampd(y + d * std::sin(theta), 1e-12, H - 1e-12), multi);
            if (ci != source) leftSource = true;
            if (ci >= 0 && (ci != source || leftSource)) { land(ci); savePt(x, y); break; }
        }
    } else {
    // ------------------------------------------------ stepped integration (any density map)
    const bool refract = p.refract && s.densityMap.valid();
    const double gradD = refract ? 0.5 * std::min(p.W() / std::max(1, s.densityMap.w - 1), p.H() / std::max(1, s.densityMap.h - 1)) : 0;
    const double nFloor = 1e14; // m^-2 (1e10 cm^-2): keeps ln|n| finite at a neutrality point
    // p-n junctions.  The map is bilinear, so a sharp junction is a ramp one map
    // pixel wide; pixD is that pixel.
    const bool klein = p.pnMode != "pass" && s.densityMap.valid();
    const double pixD = s.densityMap.valid() ? std::max(p.W() / std::max(1, s.densityMap.w - 1), p.H() / std::max(1, s.densityMap.h - 1)) : 0;
    // The density a carrier sees on one side of a junction: walk away from the
    // crossing until |n| stops growing (the plateau beyond the ramp).
    auto plateau = [&](double cx, double cy, double ux, double uy) {
        double best = std::abs(localN(s, p, cx + 0.5 * pixD * ux, cy + 0.5 * pixD * uy));
        for (int k = 2; k <= 80; ++k) {
            const double v = std::abs(localN(s, p, cx + 0.5 * k * pixD * ux, cy + 0.5 * k * pixD * uy));
            if (v <= best * 1.002) break;
            best = v;
        }
        return best;
    };
    for (int step = 0; step < maxSteps && pathLen < maxPath; ++step) {
        double rem = nextScatter - sinceScatter;
        if (rem <= base * 1e-8) {
            if (scat::applyEvent(sm, rates, theta, rng)) ++nScatter;
            sinceScatter = 0;
            nextScatter = drawNext(x, y);
            continue;
        }
        const double nloc = localN(s, p, x, y);
        double rc = INF, turnSign = 0;
        if (p.B != 0 && std::abs(nloc) > 0) {
            rc = HBAR * std::sqrt(M_PI * std::abs(nloc)) / (E_CHARGE * std::abs(p.B));
            turnSign = (p.B >= 0 ? 1.0 : -1.0) * (nloc >= 0 ? 1.0 : -1.0);
        }
        double h = std::min(base, rem);
        if (std::isfinite(rc)) h = std::min(h, std::max(base * .01, .075 * rc));
        // Refraction: the path bends toward higher |n| at a rate set by the gradient of
        // ln kF = ln|n|/2, perpendicular to the motion (Snell's law in the continuum
        // limit, the same for electrons and holes).
        double gx = 0, gy = 0;
        if (refract) {
            const double nxp1 = localN(s, p, x + gradD, y), nxm1 = localN(s, p, x - gradD, y);
            const double nyp1 = localN(s, p, x, y + gradD), nym1 = localN(s, p, x, y - gradD);
            const double sg = nloc >= 0 ? 1.0 : -1.0, den = std::max(std::abs(nloc), nFloor);
            // Inside a p-n junction the crossing is handled whole (below); a gradient
            // of ln|n| there would only bend rays away from n = 0 before they reach it.
            const double L2 = 2 * pixD;
            const bool nearJ = klein && ((localN(s, p, x + L2, y) >= 0) != (nloc >= 0) || (localN(s, p, x - L2, y) >= 0) != (nloc >= 0) ||
                                         (localN(s, p, x, y + L2) >= 0) != (nloc >= 0) || (localN(s, p, x, y - L2) >= 0) != (nloc >= 0));
            if (!nearJ) {
            gx = 0.5 * sg * (nxp1 - nxm1) / (2 * gradD) / den;
            gy = 0.5 * sg * (nyp1 - nym1) / (2 * gradD) / den;
            const double gm = std::hypot(gx, gy);
            if (gm > 0) h = std::min(h, std::max(base * .01, .05 / gm));
            } else { gx = gy = 0; }
        }
        h = std::min(h, maxPath - pathLen);
        double dtheta = std::isfinite(rc) ? turnSign * h / rc : 0;
        if (refract) dtheta += h * (std::cos(theta) * gy - std::sin(theta) * gx);
        const double mid = theta + .5 * dtheta;
        const double nxp = x + h * std::cos(mid), nyp = y + h * std::sin(mid);

        // Segment/box intersection gives an accurate hit point even when h grows.
        bool hit = nxp <= 0 || nxp >= p.W() || nyp <= 0 || nyp >= p.H();
        if (hit) {
            double f = 1.0; int side = -1;
            auto candidate = [&](double q, int e) { if (q >= 0 && q < f) { f = q; side = e; } };
            if (nxp < 0) candidate((0 - x) / (nxp - x), 0);
            if (nxp > p.W()) candidate((p.W() - x) / (nxp - x), 1);
            if (nyp < 0) candidate((0 - y) / (nyp - y), 2);
            if (nyp > p.H()) candidate((p.H() - y) / (nyp - y), 3);
            const double hx = clampd(x + f * (nxp - x), 0, p.W());
            const double hy = clampd(y + f * (nyp - y), 0, p.H());
            pathLen += f * h; sinceScatter += f * h; theta += f * dtheta;
            const int ci = contactAt(s, p, clampd(hx, 1e-12, p.W() - 1e-12), clampd(hy, 1e-12, p.H() - 1e-12), multi);
            if (ci >= 0 && (ci != source || leftSource)) {
                land(ci);
                if (saved) saved->points.push_back({static_cast<float>(hx / p.W()), static_cast<float>(hy / p.H())});
                break;
            }
            if (p.edge == "absorbing") {
                status = LOST;
                if (saved) saved->points.push_back({static_cast<float>(hx / p.W()), static_cast<float>(hy / p.H())});
                break;
            }
            const double onx = side == 0 ? -1 : side == 1 ? 1 : 0;
            const double ony = side == 2 ? -1 : side == 3 ? 1 : 0;
            theta = scat::reflect(p.edge, p.specularity, theta, onx, ony, rng);
            x = clampd(hx, 1e-12, p.W() - 1e-12); y = clampd(hy, 1e-12, p.H() - 1e-12);
            if (saved && saved->points.size() < 900) saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())});
            continue;
        }

        if (!refl.empty()) {
            const int rk = inRefl(nxp, nyp);
            if (rk >= 0) {
                // ---- a reflecting target: find its surface along the step, reflect specularly
                const Refl &E = refl[rk];
                double lo = 0, hi = 1;
                for (int it = 0; it < 40; ++it) {
                    const double mm = 0.5 * (lo + hi);
                    if (insideRefl(E, x + mm * (nxp - x), y + mm * (nyp - y))) hi = mm; else lo = mm;
                }
                const double bx = x + lo * (nxp - x), by = y + lo * (nyp - y), th = theta + lo * dtheta;
                double nx = (bx - E.cx) / (E.ax * E.ax), ny = (by - E.cy) / (E.ay * E.ay);
                if (E.rect) {   // the face it hit: the one the boundary point lies closest to
                    const double fx = (E.ax - std::abs(bx - E.cx)) / E.ax, fy = (E.ay - std::abs(by - E.cy)) / E.ay;
                    if (fx < fy) { nx = bx > E.cx ? 1 : -1; ny = 0; } else { nx = 0; ny = by > E.cy ? 1 : -1; }
                }
                const double nm = std::hypot(nx, ny); nx /= nm; ny /= nm;
                const double dx = std::cos(th), dy = std::sin(th), dn = dx * nx + dy * ny;
                theta = std::atan2(dy - 2 * dn * ny, dx - 2 * dn * nx);
                const double eps = 1e-6 * std::min(E.ax, E.ay);
                x = clampd(bx + eps * nx, 1e-12, p.W() - 1e-12); y = clampd(by + eps * ny, 1e-12, p.H() - 1e-12);
                pathLen += lo * h; sinceScatter += lo * h;
                deposit(x, y); savePt(x, y);
                continue;
            }
        }
        if (!klein) {
            if (refract && nloc != 0 && (localN(s, p, nxp, nyp) >= 0) != (nloc >= 0)) ++agg.signCross;
        } else if (nloc != 0 && (localN(s, p, nxp, nyp) >= 0) != (nloc >= 0)) {
            // ---- a p-n junction: find where n = 0 along the step
            double lo = 0, hi = 1;
            for (int it = 0; it < 40; ++it) {
                const double mm = 0.5 * (lo + hi);
                if ((localN(s, p, x + mm * (nxp - x), y + mm * (nyp - y)) >= 0) == (nloc >= 0)) lo = mm; else hi = mm;
            }
            const double cx = x + lo * (nxp - x), cy = y + lo * (nyp - y);
            const double th = theta + lo * dtheta;
            // junction normal, pointing from this side into the other
            const double gd = 0.5 * pixD;
            double ux = localN(s, p, cx + gd, cy) - localN(s, p, cx - gd, cy);
            double uy = localN(s, p, cx, cy + gd) - localN(s, p, cx, cy - gd);
            if (nloc > 0) { ux = -ux; uy = -uy; }
            double um = std::hypot(ux, uy);
            if (!(um > 0)) { ux = std::cos(th); uy = std::sin(th); um = 1; }
            ux /= um; uy /= um;
            const double dx = std::cos(th), dy = std::sin(th);
            const double c1 = std::max(1e-9, dx * ux + dy * uy), s1 = ux * dy - uy * dx;
            const double th1 = std::atan2(s1, c1);
            // Fermi wavevectors on the two plateaus (the pi cancels in the ratio)
            const double k1 = std::sqrt(plateau(cx, cy, -ux, -uy)), k2 = std::sqrt(plateau(cx, cy, ux, uy));
            const double sr = k2 > 0 ? k1 / k2 * std::sin(th1) : 2.0;
            double T = 0, th2 = 0;
            if (std::abs(sr) < 1 && p.pnWidthNm > 0) {
                // Smooth junction: Cayssol et al. Eq. (10), signed Fermi wavevectors
                //   R = sinh(pi d k+-) sinh(pi d k-+) / (sinh(pi d k++) sinh(pi d k--)),
                //   k^{rs} = kF2 - kF1 + r kx2 + s kx1,  kx = sign(kF) sqrt(kF^2 - ky^2).
                // Its d -> 0 limit is the abrupt law below.
                th2 = -std::asin(sr);
                const double sp = std::sqrt(M_PI), d = p.pnWidthNm * 1e-9;
                const double K1 = (nloc >= 0 ? 1.0 : -1.0) * sp * k1, K2 = (nloc >= 0 ? -1.0 : 1.0) * sp * k2;
                const double ky = sp * k1 * std::sin(th1);
                const double X1 = (K1 >= 0 ? 1.0 : -1.0) * std::sqrt(std::max(0.0, K1 * K1 - ky * ky));
                const double X2 = (K2 >= 0 ? 1.0 : -1.0) * std::sqrt(std::max(0.0, K2 * K2 - ky * ky));
                auto lsh = [](double a) { a = std::abs(a); return a + std::log1p(-std::exp(-2 * a)) - std::log(2.0); };
                const double kpm = K2 - K1 + X2 - X1, kmp = K2 - K1 - X2 + X1, kpp = K2 - K1 + X2 + X1, kmm = K2 - K1 - X2 - X1;
                const double a = M_PI * d;
                double Rr = 0;
                if (std::abs(a * kpm) > 1e-12 && std::abs(a * kmp) > 1e-12)
                    Rr = std::exp(lsh(a * kpm) + lsh(a * kmp) - lsh(a * kpp) - lsh(a * kmm));
                T = clampd(1 - Rr, 0, 1);
            } else if (std::abs(sr) < 1) {
                // Electron and hole sides: the momentum along the junction is kept
                // but the group velocity of a hole is opposite to its momentum, so
                // the ray leaves on the SAME side of the normal it came from --
                // negative refraction.  Abrupt-step Dirac transmission:
                //   T = cos(th1) cos(th2) / cos^2((th1 + th2)/2), th2 = -asin(k1/k2 sin th1)
                // (cos^2 th for a symmetric junction; Cheianov & Fal'ko 2006).
                th2 = -std::asin(sr);
                const double ch = std::cos(0.5 * (th1 + th2));
                T = ch > 1e-12 ? std::cos(th1) * std::cos(th2) / (ch * ch) : 0;
            }
            pathLen += lo * h; sinceScatter += lo * h;
            deposit(cx, cy);
            const double eps = 1e-3 * pixD;
            if (rng.next() < T) {
                theta = std::atan2(uy, ux) + th2;
                x = cx + eps * ux; y = cy + eps * uy;
                ++agg.pnTrans; ++agg.signCross;
            } else {
                const double dn = dx * ux + dy * uy;
                theta = std::atan2(dy - 2 * dn * uy, dx - 2 * dn * ux);
                x = cx - eps * ux; y = cy - eps * uy;
                ++agg.pnRefl;
            }
            x = clampd(x, 1e-12, p.W() - 1e-12); y = clampd(y, 1e-12, p.H() - 1e-12);
            savePt(x, y);
            continue;
        }
        x = nxp; y = nyp; theta += dtheta; pathLen += h; sinceScatter += h;
        deposit(x, y);
        const int ci = contactAt(s, p, x, y, multi);
        if (ci != source) leftSource = true;
        if (ci >= 0 && (ci != source || leftSource)) {
            land(ci);
            if (saved) saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())});
            break;
        }
        if (sinceScatter + base * 1e-8 >= nextScatter) {
            if (scat::applyEvent(sm, rates, theta, rng)) ++nScatter;
            sinceScatter = 0;
            nextScatter = drawNext(x, y);
        }
        if (saved && (step & 3) == 0 && saved->points.size() < 900)
            saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())});
    }
    }
    ++agg.statuses[status];
    if (terminal >= 0) {
        ++agg.reached[static_cast<size_t>(source) * nc + terminal];
        ++agg.reachedB[static_cast<size_t>(batch) * nc * nc + static_cast<size_t>(source) * nc + terminal];
    }
    agg.pathSum += pathLen; agg.scatterSum += nScatter;
    if (saved) { saved->status = status; saved->source = source; saved->terminal = terminal; }
}

void initTrajectories(Instance &s, const Params &p, bool ballistic, bool multi, int total, int keepPaths) {
    s.trajParams = p;
    if (ballistic) { s.trajParams.scattering = "none"; s.trajParams.phMfp300um = 0; s.trajParams.eeMfpum = 0; }
    s.traj = TrajResult{};
    s.traj.gx = clampi(p.trajRes, 40, 960);
    s.traj.gy = std::max(30 * s.traj.gx / 160, static_cast<int>(std::lround(s.traj.gx * p.Hum / p.Wum)));
    s.traj.gy = std::min(s.traj.gx, s.traj.gy);
    s.traj.density.assign(static_cast<size_t>(s.traj.gx) * s.traj.gy, 0);
    s.traj.reached.assign(s.contacts.size() * s.contacts.size(), 0);
    s.traj.launchedBy.assign(s.contacts.size(), 0);
    s.traj.reachedB.assign(static_cast<size_t>(TRAJ_BATCHES) * s.contacts.size() * s.contacts.size(), 0);
    s.traj.launchedB.assign(static_cast<size_t>(TRAJ_BATCHES) * s.contacts.size(), 0);
    s.traj.paths.resize(std::min(total, keepPaths));
    s.traj.ballistic = ballistic; s.traj.multi = multi;
    s.trajNext = 0; s.trajTotal = std::max(1, total); s.trajMulti = multi;
    s.trajStart = std::chrono::steady_clock::now();
}

void simulateRange(Instance &s, const Params &p, int begin, int end) {
    const int pixels = s.traj.gx * s.traj.gy, nc = static_cast<int>(s.contacts.size());
    int nt = 1;
#ifdef _OPENMP
    nt = std::max(1, omp_get_max_threads());
#endif
    std::vector<LocalAgg> local;
    local.reserve(nt); for (int t = 0; t < nt; ++t) local.emplace_back(pixels, nc);
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 8)
#endif
    for (int ti = begin; ti < end; ++ti) {
        int tid = 0;
#ifdef _OPENMP
        tid = omp_get_thread_num();
#endif
        Path *saved = ti < static_cast<int>(s.traj.paths.size()) ? &s.traj.paths[ti] : nullptr;
        simulateOne(s, p, ti, s.trajMulti, local[tid], saved);
    }
    for (const LocalAgg &a : local) {
        for (int k = 0; k < 5; ++k) s.traj.statuses[k] += a.statuses[k];
        for (int k = 0; k < pixels; ++k) s.traj.density[k] += a.density[k];
        for (size_t k = 0; k < s.traj.reached.size(); ++k) s.traj.reached[k] += a.reached[k];
        for (size_t k = 0; k < s.traj.launchedBy.size(); ++k) s.traj.launchedBy[k] += a.launched[k];
        for (size_t k = 0; k < s.traj.reachedB.size(); ++k) s.traj.reachedB[k] += a.reachedB[k];
        for (size_t k = 0; k < s.traj.launchedB.size(); ++k) s.traj.launchedB[k] += a.launchedB[k];
        s.traj.pathSum += a.pathSum; s.traj.scatterSum += a.scatterSum;
        s.traj.arcFlights += a.arcFlights; s.traj.signCross += a.signCross;
        s.traj.pnTrans += a.pnTrans; s.traj.pnRefl += a.pnRefl;
    }
    s.traj.launched += end - begin;
}

void finishTrajectories(Instance &s) {
    s.traj.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - s.trajStart).count();
    s.traj.valid = true;
}

double sourceDrainG(const Instance &s, const Params &p, const TrajResult &tr) {
    int src = -1;
    std::vector<int> drains;
    for (size_t i = 0; i < s.contacts.size(); ++i) {
        if (src < 0 && s.contacts[i].role == "source") src = static_cast<int>(i);
        if (s.contacts[i].role == "drain") drains.push_back(static_cast<int>(i));
    }
    if (src < 0 || tr.launchedBy[src] == 0) return 0;
    uint64_t hit = 0; for (int d : drains) hit += tr.reached[static_cast<size_t>(src) * s.contacts.size() + d];
    const double T = static_cast<double>(hit) / tr.launchedBy[src];
    const double modes = std::max(1.0, edgeInfo(s.contacts[src], p).width * std::sqrt(M_PI * std::abs(p.n())) / M_PI);
    return (4 * E_CHARGE * E_CHARGE / PLANCK) * modes * T;
}

// Jackknife error of any quantity computed from the contact counts: leave each
// batch out in turn, sigma^2 = (K-1)/K * sum (f_k - mean)^2.  NaN when it cannot
// be formed (fewer than two usable batches).
template <class F> double jackknifeSigma(const TrajResult &tr, F f) {
    const size_t nc2 = tr.reached.size(), nc = tr.launchedBy.size();
    if (nc == 0 || tr.reachedB.size() != static_cast<size_t>(TRAJ_BATCHES) * nc2) return std::numeric_limits<double>::quiet_NaN();
    std::vector<double> v;
    TrajResult t;
    for (int b = 0; b < TRAJ_BATCHES; ++b) {
        t.reached = tr.reached; t.launchedBy = tr.launchedBy;
        uint64_t nb = 0;
        for (size_t k = 0; k < nc2; ++k) t.reached[k] -= tr.reachedB[b * nc2 + k];
        for (size_t k = 0; k < nc; ++k) { t.launchedBy[k] -= tr.launchedB[b * nc + k]; nb += tr.launchedB[b * nc + k]; }
        if (nb == 0) continue;
        const double x = f(t);
        if (std::isfinite(x)) v.push_back(x);
    }
    const size_t K = v.size();
    if (K < 2) return std::numeric_limits<double>::quiet_NaN();
    double m = 0; for (double x : v) m += x; m /= K;
    double ss = 0; for (double x : v) ss += (x - m) * (x - m);
    return std::sqrt((K - 1.0) / K * ss);
}

TrajResult runTrajectoriesSync(const Instance &src, const Params &p, bool ballistic,
                               bool multi, int total) {
    Instance temp;
    temp.p = p; temp.contacts = src.contacts; temp.densityMap = src.densityMap; temp.mobilityMap = src.mobilityMap;
    Params pp = p; if (ballistic) { pp.scattering = "none"; pp.phMfp300um = 0; pp.eeMfpum = 0; }
    initTrajectories(temp, pp, ballistic, multi, total, 0);
    simulateRange(temp, pp, 0, total);
    finishTrajectories(temp);
    return std::move(temp.traj);
}

std::vector<double> solveDense(std::vector<std::vector<double>> A, std::vector<double> b) {
    const int n = static_cast<int>(b.size());
    for (int c = 0; c < n; ++c) {
        int piv = c; for (int r = c + 1; r < n; ++r) if (std::abs(A[r][c]) > std::abs(A[piv][c])) piv = r;
        std::swap(A[c], A[piv]); std::swap(b[c], b[piv]);
        if (std::abs(A[c][c]) < 1e-300) continue;
        for (int r = 0; r < n; ++r) if (r != c) {
            const double f = A[r][c] / A[c][c];
            for (int k = c; k < n; ++k) A[r][k] -= f * A[c][k];
            b[r] -= f * b[c];
        }
    }
    for (int i = 0; i < n; ++i) b[i] /= std::abs(A[i][i]) > 1e-300 ? A[i][i] : 1;
    return b;
}

// The source-to-drain axis, as a unit vector in the normalised device frame.
// A longitudinal probe pair has to be ordered along the CURRENT, not along +x:
// ordering by x alone yields (downstream - upstream), which is negative for
// every passive device, and was why Rxx came out negative in both models.
struct FlowAxis { double ux = 1, uy = 0, s0 = 0; bool ok = false; };

inline FlowAxis flowAxis(const std::vector<Contact> &contacts) {
    FlowAxis f;
    double sx = 0, sy = 0, dx = 0, dy = 0; bool hs = false, hd = false;
    for (const Contact &c : contacts) {
        if (!hs && c.role == "source") { sx = .5 * (c.x0 + c.x1); sy = .5 * (c.y0 + c.y1); hs = true; }
        if (!hd && c.role == "drain")  { dx = .5 * (c.x0 + c.x1); dy = .5 * (c.y0 + c.y1); hd = true; }
    }
    if (!hs || !hd) return f;
    const double vx = dx - sx, vy = dy - sy, L = std::sqrt(vx * vx + vy * vy);
    if (L < 1e-12) return f;
    f.ux = vx / L; f.uy = vy / L; f.s0 = sx * f.ux + sy * f.uy; f.ok = true;
    return f;
}
// how far along the current a contact sits; smaller = nearer the source
inline double alongFlow(const FlowAxis &f, const Contact &c) {
    return .5 * (c.x0 + c.x1) * f.ux + .5 * (c.y0 + c.y1) * f.uy - f.s0;
}

double buttikerResistance(const Instance &s, const Params &p, const TrajResult &tr,
                          const std::string &kind) {
    const int N = static_cast<int>(s.contacts.size());
    if (N < 4) return std::numeric_limits<double>::quiet_NaN();
    int src = -1, drain = -1;
    std::vector<int> probes;
    for (int i = 0; i < N; ++i) {
        if (src < 0 && s.contacts[i].role == "source") src = i;
        if (drain < 0 && s.contacts[i].role == "drain") drain = i;
        if (s.contacts[i].role == "probe") probes.push_back(i);
    }
    if (src < 0 || drain < 0 || probes.size() < 2) return std::numeric_limits<double>::quiet_NaN();
    std::vector<double> modes(N);
    const double kf = std::sqrt(M_PI * std::abs(p.n())), Gq = 4 * E_CHARGE * E_CHARGE / PLANCK;
    for (int i = 0; i < N; ++i) modes[i] = std::max(1.0, edgeInfo(s.contacts[i], p).width * kf / M_PI);
    auto T = [&](int i, int j) {
        return tr.launchedBy[i] ? static_cast<double>(tr.reached[static_cast<size_t>(i) * N + j]) / tr.launchedBy[i] : 0.0;
    };
    std::vector<std::vector<double>> C(N, std::vector<double>(N));
    for (int i = 0; i < N; ++i) for (int j = 0; j < N; ++j) if (i != j) {
        C[i][i] += Gq * modes[i] * T(i, j);
        C[i][j] -= Gq * modes[j] * T(j, i);
    }
    std::vector<int> unk; for (int i = 0; i < N; ++i) if (i != src && i != drain) unk.push_back(i);
    std::vector<std::vector<double>> A(unk.size(), std::vector<double>(unk.size()));
    std::vector<double> b(unk.size());
    for (size_t r = 0; r < unk.size(); ++r) {
        for (size_t c = 0; c < unk.size(); ++c) A[r][c] = C[unk[r]][unk[c]];
        b[r] = -C[unk[r]][src]; // Vsource=1, Vdrain=0
    }
    std::vector<double> uv = solveDense(A, b), V(N, 0); V[src] = 1;
    for (size_t i = 0; i < unk.size(); ++i) V[unk[i]] = uv[i];
    int pa = probes.front(), pb = probes.back();
    if (kind == "hall") {
        pa = *std::max_element(probes.begin(), probes.end(), [&](int a, int b0) { return .5 * (s.contacts[a].y0 + s.contacts[a].y1) < .5 * (s.contacts[b0].y0 + s.contacts[b0].y1); });
        pb = *std::min_element(probes.begin(), probes.end(), [&](int a, int b0) { return .5 * (s.contacts[a].y0 + s.contacts[a].y1) < .5 * (s.contacts[b0].y0 + s.contacts[b0].y1); });
    } else {
        // Along the current, source end first -- see flowAxis(). Ordering by x
        // put the downstream probe first and made Rxx negative.
        const FlowAxis f = flowAxis(s.contacts);
        pa = *std::min_element(probes.begin(), probes.end(), [&](int a, int b0) {
            return alongFlow(f, s.contacts[a]) < alongFlow(f, s.contacts[b0]); });
        pb = *std::max_element(probes.begin(), probes.end(), [&](int a, int b0) {
            return alongFlow(f, s.contacts[a]) < alongFlow(f, s.contacts[b0]); });
    }
    double current = 0; for (int j = 0; j < N; ++j) current += C[src][j] * V[j];
    // "2tb": two-terminal resistance source->drain with every probe as a floating
    // (invasive, current-free) Buttiker voltage probe. With the Hall pair as
    // source/drain this is the output resistance that sets the Hall Johnson noise.
    if (kind == "2tb") return std::abs(current) > 1e-300 ? 1.0 / current : std::numeric_limits<double>::quiet_NaN();
    return std::abs(current) > 1e-300 ? (V[pa] - V[pb]) / current : std::numeric_limits<double>::quiet_NaN();
}

// ---------------------------------------------------------------- reporting and sweeps

int maxThreads() {
#ifdef _OPENMP
    return std::max(1, omp_get_max_threads());
#else
    return 1;
#endif
}

double cyclotronRadius(const Params &p) {
    if (p.B == 0 || p.n() == 0) return std::numeric_limits<double>::infinity();
    return HBAR * std::sqrt(M_PI * std::abs(p.n())) / (E_CHARGE * std::abs(p.B));
}

void queueDerived(Instance &s) {
    // mfp_um is the TOTAL transport length (impurity + phonon, Matthiessen); with
    // phonons off it is the impurity length exactly as before.  e-e is excluded:
    // it is a one-body kick model of a momentum-conserving process.
    const double mfpImp = s.p.mfp(), rc = cyclotronRadius(s.p);
    const double ph = s.p.phLen();
    const double mfp = (ph > 0 && mfpImp > 0) ? 1.0 / (1.0 / mfpImp + 1.0 / ph) : (ph > 0 ? ph : mfpImp);
    const scat::Model sm = s.p.scatModel();
    const double kf = std::sqrt(M_PI * std::abs(s.p.n()));
    const double impEv = sm.impEventLen(mfpImp);
    const double muEff = kf > 0 ? mfp * E_CHARGE / (HBAR * kf) * 1e4 : 0;
    const HydroPhys hp = hydroPhys(s.p);
    char b[1200];
    std::snprintf(b, sizeof b,
        "{\"t\":\"derived\",\"hOk\":%d,\"hLee_um\":%.6g,\"hLmr_um\":%.6g,\"hDnu_um\":%.6g,\"hNu_cm2s\":%.6g,\"hWhy\":\"%s\",\"mfp_um\":%.9g,\"mfpImp_um\":%.9g,\"mfpImpEvent_um\":%.9g,\"mfpPh_um\":%.9g,"
        "\"eeMfp_um\":%.9g,\"muEff_cm\":%.9g,\"rc_um\":%.9g,\"kf\":%.9g,\"modes\":%.9g,\"threads\":%d}",
        hp.ok ? 1 : 0, hp.lee * 1e6, hp.lmr * 1e6, std::sqrt(std::max(0.0, hp.D2)) * 1e6, hp.nuxx * 1e4, jsonEscape(hp.why).c_str(),
        mfp * 1e6, mfpImp * 1e6, impEv * 1e6, ph * 1e6, sm.eeLen * 1e6, muEff,
        std::isfinite(rc) ? rc * 1e6 : -1.0, kf,
        s.p.H() * kf / M_PI, maxThreads());
    s.outbox.push_back(b);
}

std::string femMessage(const FEMResult &r) {
    if (!r.valid) return "{\"t\":\"error\",\"where\":\"fem\",\"message\":\"" + jsonEscape(r.error) + "\"}";
    std::ostringstream o;
    o.precision(10);
    o << "{\"t\":\"fem\",\"nx\":" << r.nx << ",\"ny\":" << r.ny
      << ",\"iters\":" << r.iters << ",\"residual\":" << r.residual
      << ",\"converged\":" << (r.converged ? 1 : 0) << ",\"direct\":" << (r.direct ? 1 : 0) << ",\"I\":" << r.current
      << ",\"R\":" << (std::isfinite(r.resistance) ? std::to_string(r.resistance) : "null")
      << ",\"G\":" << (std::isfinite(r.resistance) && r.resistance != 0 ? 1.0 / r.resistance : 0)
      << ",\"ms\":" << r.ms << ",\"model\":\"" << r.model << "\"";
    if (r.model == "hydro")
        o << ",\"lee_um\":" << r.leeUm << ",\"lmr_um\":" << r.lmrUm << ",\"Dnu_um\":" << r.DnuUm << ",\"nu0\":" << r.nu0
          << ",\"nuxx\":" << r.nuxx << ",\"nuH\":" << r.nuH << ",\"s\":" << r.sHall << ",\"note\":\"" << jsonEscape(r.note) << "\"";
    o << ",\"probes\":[";
    for (size_t i = 0; i < r.probes.size(); ++i) {
        if (i) o << ',';
        o << "{\"id\":\"" << jsonEscape(r.probes[i].first) << "\",\"V\":" << r.probes[i].second << '}';
    }
    o << "]}";
    return o.str();
}

std::string trajMessage(const Instance &s) {
    const TrajResult &r = s.traj;
    std::ostringstream o; o.precision(10);
    o << "{\"t\":\"traj\",\"n\":" << r.launched << ",\"ms\":" << r.ms
      << ",\"ballistic\":" << (r.ballistic ? 1 : 0)
      << ",\"backend\":\"CPU / OpenMP\",\"threads\":" << maxThreads()
      << ",\"meanPath_um\":" << (r.launched ? r.pathSum / r.launched * 1e6 : 0)
      << ",\"meanScatters\":" << (r.launched ? r.scatterSum / r.launched : 0)
      << ",\"tracer\":\"" << (r.arcFlights > 0 ? "arc" : "step") << "\",\"signCrossings\":" << r.signCross
      << ",\"pnMode\":\"" << (s.trajParams.pnMode == "pass" ? "pass" : "klein") << "\",\"pnTransmitted\":" << r.pnTrans << ",\"pnReflected\":" << r.pnRefl
      << ",\"statuses\":{\"transmitted\":" << r.statuses[TRANSMITTED]
      << ",\"reflected\":" << r.statuses[REFLECTED] << ",\"absorbed\":" << r.statuses[ABSORBED]
      << ",\"lost\":" << r.statuses[LOST] << ",\"max_steps\":" << r.statuses[MAXSTEPS] << "},\"transmission\":[";
    bool first = true;
    const int nc = static_cast<int>(s.contacts.size());
    for (int i = 0; i < nc; ++i) if (r.launchedBy[i]) for (int j = 0; j < nc; ++j) if (i != j) {
        // In a single (two-terminal) run the probes are transparent and walls/reflectors
        // are never absorbing targets: a row for them would be zero by construction.
        if (isObstacle(s.contacts[j]) || (!r.multi && s.contacts[j].role == "probe")) continue;
        if (!first) o << ','; first = false;
        const double T = static_cast<double>(r.reached[static_cast<size_t>(i) * nc + j]) / r.launchedBy[i];
        const double modes = std::max(1.0, edgeInfo(s.contacts[i], s.p).width * std::sqrt(M_PI * std::abs(s.p.n())) / M_PI);
        o << "{\"source\":\"" << jsonEscape(s.contacts[i].id) << "\",\"target\":\"" << jsonEscape(s.contacts[j].id)
          << "\",\"T\":" << T << ",\"G\":" << (4 * E_CHARGE * E_CHARGE / PLANCK) * modes * T
          // counting statistics: how many carriers this number rests on, and its binomial error
          << ",\"hits\":" << r.reached[static_cast<size_t>(i) * nc + j] << ",\"N\":" << r.launchedBy[i]
          << ",\"dT\":" << std::sqrt(std::max(0.0, T * (1 - T)) / static_cast<double>(std::max<uint64_t>(1, r.launchedBy[i]))) << '}';
    }
    o << "]}";
    return o.str();
}

double femProbeResistance(const Instance &s, const FEMResult &r, const std::string &kind) {
    if (!r.valid || std::abs(r.current) < 1e-300 || r.probes.size() < 2) return std::numeric_limits<double>::quiet_NaN();
    struct PV { double x, y, v, s; };
    const FlowAxis f = flowAxis(s.contacts);
    std::vector<PV> p;
    for (const auto &q : r.probes) for (const Contact &c : s.contacts) if (c.id == q.first) {
        p.push_back({.5 * (c.x0 + c.x1), .5 * (c.y0 + c.y1), q.second, alongFlow(f, c)}); break;
    }
    if (p.size() < 2) return std::numeric_limits<double>::quiet_NaN();
    if (kind == "hall") {
        // Transverse pair. The sign here is physical -- it follows the field
        // direction and the carrier type -- so it is left as it was.
        std::sort(p.begin(), p.end(), [](PV a, PV b) { return a.y > b.y; });
        return (p.front().v - p.back().v) / r.current;
    }
    // Longitudinal: order along the current and divide by the current taken
    // positive in that same direction, so a local four-probe reads positive
    // however the device is laid out.
    std::sort(p.begin(), p.end(), [](PV a, PV b) { return a.s < b.s; });
    const double I = (f.ok && f.ux < 0 ? -1.0 : 1.0) * r.current;
    if (std::abs(I) < 1e-300) return std::numeric_limits<double>::quiet_NaN();
    return (p.front().v - p.back().v) / I;
}

double sweepOutput(const SweepSpec &sp, double v) {
    if (sp.measure != "2t") return v;
    if (sp.quantity == "R") return v > 0 && std::isfinite(v) ? 1.0 / v : std::numeric_limits<double>::infinity();
    return v;
}

// How many trajectories a sweep point really gets. "Fast preview" caps it
// hard, and a four-probe reading is a small DIFFERENCE between two probe
// potentials: the cap that merely coarsens a two-terminal curve leaves Rxy
// and Rxx as noise. Stated here once, so the panel can report the same
// number the sweep actually spends.
inline int sweepTrajCount(const SweepSpec &q, const Params &p) {
    const int nt = q.quality == "accurate" ? p.nTraj
                 : std::min(p.nTraj, q.measure == "2t" ? 768 : 1280);
    return q.measure == "2t" ? nt : std::max(1024, nt);
}

void buildSweep(Instance &s) {
    s.sweepPoints.clear(); s.sweepFem.clear(); s.sweepBal.clear(); s.sweepSnapshots.clear(); s.sweepIndex = 0;
    auto lin = [](double a, double b, int n) { std::vector<double> x(std::max(2, n)); for (int i = 0; i < static_cast<int>(x.size()); ++i) x[i] = a + (b - a) * i / (x.size() - 1); return x; };
    auto nFromVg = [&](double vg) {
        const double eps0 = 8.8541878128e-12, cox = s.sweep.epsr * eps0 / (s.sweep.toxNm * 1e-9);
        return (cox * (vg - s.sweep.vdirac) / E_CHARGE) / 1e4;
    };
    if (s.sweep.type == "vg") {
        for (double vg : lin(s.sweep.vgFrom, s.sweep.vgTo, clampi(s.sweep.vgN, 2, 201)))
            s.sweepPoints.push_back({vg, 0, nFromVg(vg), s.p.B, s.p.mucm, s.p.mfpum});
    } else if (s.sweep.type == "b") {
        for (double b : lin(s.sweep.bFrom, s.sweep.bTo, clampi(s.sweep.bN, 2, 201)))
            s.sweepPoints.push_back({b, 0, s.p.ncm2, b, s.p.mucm, s.p.mfpum});
    } else if (s.sweep.type == "mfp") {
        const int n = clampi(s.sweep.lN, 2, 201); const double a = std::log(std::max(.001, s.sweep.lFromNm)), b = std::log(std::max(s.sweep.lFromNm, s.sweep.lToNm));
        const double kf = std::sqrt(M_PI * std::abs(s.p.n()));
        for (int i = 0; i < n; ++i) {
            const double lnm = std::exp(a + (b - a) * i / (n - 1));
            const double muSI = kf > 0 ? lnm * 1e-9 * E_CHARGE / (HBAR * kf) : 0;
            SweepPoint pt{lnm, 0, s.p.ncm2, s.p.B, muSI * 1e4, lnm * 1e-3}; pt.mfpSet = true; s.sweepPoints.push_back(pt);
        }
    } else if (s.sweep.type == "T") {
        for (double t : lin(std::max(1.0, s.sweep.tFrom), std::max(1.0, s.sweep.tTo), clampi(s.sweep.tN, 2, 201))) {
            SweepPoint pt{t, 0, s.p.ncm2, s.p.B, s.p.mucm, s.p.mfpum}; pt.tempK = t; s.sweepPoints.push_back(pt);
        }
    } else if (s.sweep.type == "map2") {
        SweepSpec &q = s.sweep;
        auto isLog = [](const std::string &a) { return a == "mfp" || a == "mu"; };
        auto group = [](const std::string &a) { return a == "vg" || a == "n" ? 1 : a == "mfp" || a == "mu" ? 2 : a == "b" ? 3 : a == "T" ? 4 : 0; };
        if (!group(q.xParam) || !group(q.yParam) || group(q.xParam) == group(q.yParam)) {
            s.outbox.push_back("{\"t\":\"error\",\"where\":\"sweep\",\"message\":\"The two map axes must be different kinds of parameter (Vg and n both set the density; mean free path and mobility both set the scattering).\"}");
            return;
        }
        auto axis = [&](const std::string &a, double f, double t, int n) {
            n = clampi(n, 2, 101);
            if (isLog(a)) { f = std::max(1e-3, std::abs(f)); t = std::max(1e-3, std::abs(t)); std::vector<double> v(n); for (int i = 0; i < n; ++i) v[i] = f * std::pow(t / f, double(i) / (n - 1)); return v; }
            if (a == "T") { f = std::max(1.0, f); t = std::max(1.0, t); }
            return lin(f, t, n);
        };
        const auto xs = axis(q.xParam, q.xFrom, q.xTo, q.xN), ys = axis(q.yParam, q.yFrom, q.yTo, q.yN);
        auto set = [&](SweepPoint &pt, const std::string &a, double v) {
            if (a == "vg") pt.ncm2 = nFromVg(v); else if (a == "n") pt.ncm2 = v; else if (a == "b") pt.B = v;
            else if (a == "T") pt.tempK = v; else if (a == "mu") { pt.mucm = v; pt.muSet = true; }
        };
        auto setMfp = [&](SweepPoint &pt, double lnm) {          // after the density is known
            const double kf = std::sqrt(M_PI * std::abs(pt.ncm2 * 1e4));
            const double muSI = kf > 0 ? lnm * 1e-9 * E_CHARGE / (HBAR * kf) : 0;
            pt.mucm = muSI * 1e4; pt.mfpum = lnm * 1e-3; pt.mfpSet = true;
        };
        for (double yv : ys) for (double xv : xs) {
            SweepPoint pt{xv, yv, s.p.ncm2, s.p.B, s.p.mucm, s.p.mfpum};
            if (q.xParam != "mfp") set(pt, q.xParam, xv);
            if (q.yParam != "mfp") set(pt, q.yParam, yv);
            if (q.xParam == "mfp") setMfp(pt, xv);
            if (q.yParam == "mfp") setMfp(pt, yv);
            s.sweepPoints.push_back(pt);
        }
    } else {
        const auto vg = lin(s.sweep.vgFrom, s.sweep.vgTo, clampi(s.sweep.vgN, 2, 101));
        const auto bb = lin(s.sweep.bFrom, s.sweep.bTo, clampi(s.sweep.bN, 2, 101));
        for (double b : bb) for (double v : vg) s.sweepPoints.push_back({v, b, nFromVg(v), b, s.p.mucm, s.p.mfpum});
    }
    s.sweepFem.assign(s.sweepPoints.size(), std::numeric_limits<double>::quiet_NaN());
    s.sweepBal.assign(s.sweepPoints.size(), std::numeric_limits<double>::quiet_NaN());
    s.sweepBalErr.assign(s.sweepPoints.size(), std::numeric_limits<double>::quiet_NaN());
    if (s.sweep.snapshots && !s.sweepPoints.empty()) {
        const long long approxCells = static_cast<long long>(s.p.res) * s.p.res * s.sweepPoints.size();
        if (approxCells <= 3000000) s.sweepSnapshots.resize(s.sweepPoints.size());
        else s.outbox.push_back("{\"t\":\"notice\",\"message\":\"Snapshots disabled for this sweep size (memory guard). Reduce points or resolution.\"}");
    }
    std::ostringstream o; o << "{\"t\":\"sweep_start\",\"total\":" << s.sweepPoints.size()
      << ",\"type\":\"" << s.sweep.type << "\",\"nx\":" << (s.sweep.type == "vgb" ? clampi(s.sweep.vgN, 2, 101) : s.sweep.type == "map2" ? clampi(s.sweep.xN, 2, 101) : static_cast<int>(s.sweepPoints.size()))
      << ",\"ny\":" << (s.sweep.type == "vgb" ? clampi(s.sweep.bN, 2, 101) : s.sweep.type == "map2" ? clampi(s.sweep.yN, 2, 101) : 1)
      << ",\"snapshots\":" << (!s.sweepSnapshots.empty() ? 1 : 0)
      // axis ranges for the 2D map, from the gate model here so the panel never repeats it
      << ",\"xFrom\":" << (s.sweep.type == "map2" ? s.sweepPoints.front().x : s.sweep.vgFrom)
      << ",\"xTo\":" << (s.sweep.type == "map2" ? s.sweepPoints.back().x : s.sweep.vgTo)
      << ",\"nFrom\":" << nFromVg(s.sweep.vgFrom) << ",\"nTo\":" << nFromVg(s.sweep.vgTo)
      << ",\"yFrom\":" << (s.sweep.type == "map2" ? s.sweepPoints.front().y : s.sweep.bFrom)
      << ",\"yTo\":" << (s.sweep.type == "map2" ? s.sweepPoints.back().y : s.sweep.bTo)
      << ",\"xParam\":\"" << (s.sweep.type == "map2" ? s.sweep.xParam : s.sweep.type == "vgb" ? std::string("vg") : s.sweep.type) << "\""
      << ",\"yParam\":\"" << (s.sweep.type == "map2" ? s.sweep.yParam : std::string("b")) << "\""
      << ",\"traj\":" << sweepTrajCount(s.sweep, s.p)
      << ",\"trajPerTerminal\":" << (s.sweep.measure == "2t" ? sweepTrajCount(s.sweep, s.p)
            : sweepTrajCount(s.sweep, s.p) / std::max(1, static_cast<int>(s.contacts.size())))
      << ",\"trajCapped\":" << (sweepTrajCount(s.sweep, s.p) < s.p.nTraj ? 1 : 0) << '}';
    s.outbox.push_back(o.str());
}

void computeSweepPoint(Instance &s) {
    if (s.sweepIndex >= s.sweepPoints.size()) return;
    const size_t ix = s.sweepIndex;
    const SweepPoint &pt = s.sweepPoints[ix];
    Params q = s.p; q.ncm2 = pt.ncm2; q.B = pt.B; q.mucm = pt.mucm;
    if (pt.mfpSet) { q.mfpFromMobility = false; q.mfpum = pt.mfpum; }
    if (pt.muSet) q.mfpFromMobility = true;
    if (pt.tempK > 0) q.tempK = pt.tempK;
    FEMResult fr;
    const bool needFem = s.sweep.wantFem || (s.sweep.wantBal && s.sweep.balMode == "crossover");
    double fval = std::numeric_limits<double>::quiet_NaN(), bval = std::numeric_limits<double>::quiet_NaN();
    double berr = std::numeric_limits<double>::quiet_NaN();
    uint64_t trunc = 0, launchedAll = 0;
    if (std::abs(q.ncm2) < 1e5) {
        // G = 0 at the neutrality point; R = 1/G has no finite value there (sweepOutput
        // gives +inf, written as null) -- it used to be reported as R = 0.
        if (s.sweep.wantFem) fval = s.sweep.measure == "2t" ? sweepOutput(s.sweep, 0.0) : std::numeric_limits<double>::quiet_NaN();
        if (s.sweep.wantBal) bval = s.sweep.measure == "2t" ? sweepOutput(s.sweep, 0.0) : std::numeric_limits<double>::quiet_NaN();
    } else {
        if (needFem) fr = solveField(s, q);
        const double gD = fr.valid && std::isfinite(fr.resistance) && fr.resistance != 0 ? 1.0 / fr.resistance : 0;
        if (s.sweep.wantFem) fval = s.sweep.measure == "2t" ? sweepOutput(s.sweep, gD) : femProbeResistance(s, fr, s.sweep.measure);
        TrajResult tr;
        if (s.sweep.wantBal) {
            const int nt = sweepTrajCount(s.sweep, q);
            if (s.sweep.measure == "2t") {
                if (s.sweep.balMode == "mc") {
                    tr = runTrajectoriesSync(s, q, false, false, nt);
                    bval = sourceDrainG(s, q, tr);
                    berr = jackknifeSigma(tr, [&](const TrajResult &t) { return sourceDrainG(s, q, t); });
                } else {
                    tr = runTrajectoriesSync(s, q, true, false, nt);
                    const double gB = sourceDrainG(s, q, tr);
                    bval = gB > 0 && gD > 0 ? 1.0 / (1.0 / gB + 1.0 / gD) : (gB > 0 ? gB : gD);
                    berr = jackknifeSigma(tr, [&](const TrajResult &t) {
                        const double g = sourceDrainG(s, q, t);
                        return g > 0 && gD > 0 ? 1.0 / (1.0 / g + 1.0 / gD) : (g > 0 ? g : gD); });
                }
                // the error bar follows the plotted quantity: for R = 1/G it is sigma_G / G^2
                if (s.sweep.quantity == "R" && bval > 0 && std::isfinite(berr)) berr = berr / (bval * bval);
                bval = sweepOutput(s.sweep, bval);
            } else {
                tr = runTrajectoriesSync(s, q, q.scattering == "none", true, nt);
                bval = buttikerResistance(s, q, tr, s.sweep.measure);
                berr = jackknifeSigma(tr, [&](const TrajResult &t) { return buttikerResistance(s, q, t, s.sweep.measure); });
            }
            trunc = tr.statuses[MAXSTEPS]; launchedAll = static_cast<uint64_t>(tr.launched);
        }
        if (!s.sweepSnapshots.empty()) {
            SweepSnapshot &snap = s.sweepSnapshots[ix];
            if (fr.valid) { snap.fem = fr; snap.hasFem = true; }
            if (tr.valid) { snap.traj = std::move(tr); snap.hasTraj = true; }
        }
    }
    s.sweepFem[ix] = fval; s.sweepBal[ix] = bval;
    if (s.sweepBalErr.size() == s.sweepBal.size()) s.sweepBalErr[ix] = berr;
    std::ostringstream o; o.precision(10);
    o << "{\"t\":\"sweep_point\",\"i\":" << ix << ",\"total\":" << s.sweepPoints.size()
      << ",\"x\":" << pt.x << ",\"y\":" << pt.y << ",\"n\":" << pt.ncm2;
    // Full precision: std::to_string is fixed-point with six decimals, which wrote a
    // 2e-6 S conductance as "0.000002" -- one significant figure.
    if (std::isfinite(fval)) o << ",\"fem\":" << fval; else o << ",\"fem\":null";
    if (std::isfinite(bval)) o << ",\"bal\":" << bval; else o << ",\"bal\":null";
    // the trajectory value's jackknife error and how many carriers ran out of path
    if (std::isfinite(berr)) o << ",\"balErr\":" << berr;
    if (launchedAll) o << ",\"trunc\":" << trunc << ",\"launched\":" << launchedAll;
    o << '}';
    s.outbox.push_back(o.str());
    ++s.sweepIndex;
    if (s.sweepIndex == s.sweepPoints.size()) s.outbox.push_back("{\"t\":\"sweep_done\"}");
}

// ---------------------------------------------------------------- raster renderer

struct RGB { double r, g, b; };
const std::array<RGB, 5> VIRIDIS{{{68,1,84},{59,82,139},{33,145,140},{94,201,98},{253,231,37}}};
const std::array<RGB, 5> RDBU{{{178,24,43},{239,138,98},{247,247,247},{103,169,207},{33,102,172}}};

std::vector<RGB> cmapStops(const std::string &n) {
    if (n == "magma")   return {{0,0,4},{28,16,68},{79,18,123},{129,37,129},{181,54,122},{229,80,100},{251,135,97},{254,194,135},{252,253,191}};
    if (n == "inferno") return {{0,0,4},{31,12,72},{85,15,109},{136,34,106},{186,54,85},{227,89,51},{249,140,10},{249,201,50},{252,255,164}};
    if (n == "plasma")  return {{13,8,135},{84,2,163},{139,10,165},{185,50,137},{219,92,104},{244,136,73},{254,188,43},{240,249,33}};
    if (n == "cividis") return {{0,34,78},{18,53,112},{59,73,108},{87,93,109},{112,113,115},{138,134,120},{165,156,116},{195,179,105},{225,204,85},{254,232,56}};
    if (n == "turbo")   return {{48,18,59},{70,107,227},{41,187,236},{49,242,153},{162,252,60},{237,208,58},{251,128,34},{208,47,4},{122,4,3}};
    if (n == "hot")     return {{0,0,0},{230,0,0},{255,210,0},{255,255,255}};
    if (n == "gray")    return {{0,0,0},{255,255,255}};
    if (n == "grayinv") return {{255,255,255},{0,0,0}};
    if (n == "blues")   return {{247,251,255},{198,219,239},{107,174,214},{33,113,181},{8,48,107}};
    if (n == "coolwarm") return {{59,76,192},{141,176,254},{221,221,221},{244,154,123},{180,4,38}};
    if (n == "puor")    return {{179,88,6},{241,163,64},{247,247,247},{153,142,195},{84,39,136}};
    if (n == "bwr")     return {{0,0,255},{255,255,255},{255,0,0}};
    if (n == "rdbu")    return {{178,24,43},{239,138,98},{247,247,247},{103,169,207},{33,102,172}};
    return {{68,1,84},{71,44,122},{59,81,139},{44,113,142},{33,144,141},{39,173,129},{92,200,99},{170,220,50},{253,231,37}};   // viridis
}

RGB colorStops(const std::vector<RGB> &m, double t) {
    if (!std::isfinite(t)) t = .5;
    t = clampd(t, 0, 1); const double x = t * (m.size() - 1); const int i = std::min(static_cast<int>(m.size()) - 2, static_cast<int>(x)); const double f = x - i;
    return {m[i].r + (m[i+1].r-m[i].r)*f, m[i].g + (m[i+1].g-m[i].g)*f, m[i].b + (m[i+1].b-m[i].b)*f};
}

RGB colorMap(const std::array<RGB, 5> &m, double t) {
    if (!std::isfinite(t)) t = .5;
    t = clampd(t, 0, 1); const double x = t * 4; const int i = std::min(3, static_cast<int>(x)); const double f = x - i;
    return {m[i].r + (m[i+1].r-m[i].r)*f, m[i].g + (m[i+1].g-m[i].g)*f, m[i].b + (m[i+1].b-m[i].b)*f};
}

void pixel(Instance &s, int x, int y, RGB c, double a = 1) {
    if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return;
    uint8_t *p = &s.frame[(static_cast<size_t>(y) * FRAME_W + x) * 4];
    p[0] = static_cast<uint8_t>(clampd(p[0] * (1-a) + c.r * a, 0, 255));
    p[1] = static_cast<uint8_t>(clampd(p[1] * (1-a) + c.g * a, 0, 255));
    p[2] = static_cast<uint8_t>(clampd(p[2] * (1-a) + c.b * a, 0, 255)); p[3] = 255;
}

void rect(Instance &s, int x0, int y0, int x1, int y1, RGB c, double a = 1) {
    x0 = clampi(x0, 0, FRAME_W); x1 = clampi(x1, 0, FRAME_W); y0 = clampi(y0, 0, FRAME_H); y1 = clampi(y1, 0, FRAME_H);
    for (int y = y0; y < y1; ++y) for (int x = x0; x < x1; ++x) pixel(s, x, y, c, a);
}

void line(Instance &s, int x0, int y0, int x1, int y1, RGB c, double a = 1, int thick = 1) {
    const int dx = std::abs(x1-x0), sx = x0<x1?1:-1, dy = -std::abs(y1-y0), sy = y0<y1?1:-1; int err=dx+dy;
    for (;;) { for(int oy=-thick/2;oy<=thick/2;++oy) for(int ox=-thick/2;ox<=thick/2;++ox) pixel(s,x0+ox,y0+oy,c,a); if(x0==x1&&y0==y1) break; const int e2=2*err; if(e2>=dy){err+=dy;x0+=sx;} if(e2<=dx){err+=dx;y0+=sy;} }
}

struct DeviceRect { int x, y, w, h; };
DeviceRect deviceRect(const Params &p) {
    const int padX = 36, padY = 30, aw = FRAME_W - 2*padX, ah = FRAME_H - 2*padY;
    const double asp = p.Wum / p.Hum;
    DeviceRect d;
    if (aw / static_cast<double>(ah) > asp) { d.h = ah; d.w = static_cast<int>(ah * asp); }
    else { d.w = aw; d.h = static_cast<int>(aw / asp); }
    d.x = (FRAME_W-d.w)/2; d.y=(FRAME_H-d.h)/2; return d;
}

// A heat map of a grid, coloured as the Display settings say. symmetric = a signed field
// (the potential) on a diverging map centred on zero; logDefault = what "auto" scale means
// for this field. The colour range is reported to the panel as {t:"scale"} when it changes.
template <class V>
void heat(Instance &s, const V &v0, int nx, int ny, DeviceRect d,
          bool symmetric, bool logDefault, const char *what, const char *unit, double clipCap = 100) {
    if (v0.empty() || nx*ny != static_cast<int>(v0.size())) return;
    const Instance::Display &D = s.disp;
    std::vector<double> v(v0.size());
    for (size_t k = 0; k < v.size(); ++k) v[k] = static_cast<double>(v0[k]);
    for (int pass = 0; pass < D.smooth; ++pass) {           // separable 1-2-1, edges clamped
        std::vector<double> t(v.size());
        for (int j=0;j<ny;++j) for (int i=0;i<nx;++i) { const size_t k=(size_t)j*nx; t[k+i]=.25*v[k+std::max(0,i-1)]+.5*v[k+i]+.25*v[k+std::min(nx-1,i+1)]; }
        for (int j=0;j<ny;++j) for (int i=0;i<nx;++i) v[(size_t)j*nx+i]=.25*t[(size_t)std::max(0,j-1)*nx+i]+.5*t[(size_t)j*nx+i]+.25*t[(size_t)std::min(ny-1,j+1)*nx+i];
    }
    const bool lg = !symmetric && (D.scale == "log" || (D.scale == "auto" && logDefault));
    const bool sq = !symmetric && D.scale == "sqrt";
    auto tf = [&](double q) { return lg ? std::log1p(std::max(0.0, q)) : sq ? std::sqrt(std::max(0.0, q)) : q; };
    auto inv = [&](double q) { return lg ? std::expm1(q) : sq ? q * q : q; };
    std::vector<double> t; t.reserve(v.size());
    double lo = std::numeric_limits<double>::infinity(), hi = -lo;
    for (double q : v) { const double u = tf(q); if (!std::isfinite(u)) continue; t.push_back(symmetric ? std::abs(u) : u); lo = std::min(lo, u); hi = std::max(hi, u); }
    if (t.empty()) return;
    const double clipUse = std::min(D.clip, clipCap);
    if (clipUse < 100) {                                    // top of the range at a percentile
        const size_t k = std::min(t.size() - 1, static_cast<size_t>(std::floor(clipUse / 100.0 * (t.size() - 1))));
        std::nth_element(t.begin(), t.begin() + k, t.end());
        if (symmetric) hi = t[k]; else hi = std::max(lo, t[k]);
    }
    if (symmetric) { const double m = clipUse < 100 ? hi : std::max(std::abs(lo), std::abs(hi)); lo = -m; hi = m; }
    const double range = hi - lo;
    const bool flat = !std::isfinite(range) || range <= 1e-12 * std::max({1.0, std::abs(lo), std::abs(hi)});
    const std::vector<RGB> map = cmapStops(symmetric ? D.div : D.seq);
    auto colourAt = [&](double u) { double x = flat ? .5 : (u - lo) / range; if (D.invert) x = 1 - x; return colorStops(map, x); };
    for (int py=0;py<d.h;++py) for(int px=0;px<d.w;++px){
        double q;
        if (D.interp) {                                     // bilinear between cell centres
            const double gx = clampd((px + .5) * nx / d.w - .5, 0, nx - 1), gy = clampd((d.h - py - .5) * ny / d.h - .5, 0, ny - 1);
            const int i0 = std::min(nx - 2 < 0 ? 0 : nx - 2, static_cast<int>(gx)), j0 = std::min(ny - 2 < 0 ? 0 : ny - 2, static_cast<int>(gy));
            const int i1 = std::min(nx - 1, i0 + 1), j1 = std::min(ny - 1, j0 + 1); const double fx = gx - i0, fy = gy - j0;
            auto at = [&](int i, int j) { return v[(size_t)j * nx + i]; };
            q = (at(i0,j0)*(1-fx) + at(i1,j0)*fx)*(1-fy) + (at(i0,j1)*(1-fx) + at(i1,j1)*fx)*fy;
        } else {
            const int i=clampi(px*nx/d.w,0,nx-1), j=clampi((d.h-1-py)*ny/d.h,0,ny-1); q = v[static_cast<size_t>(j)*nx+i];
        }
        const RGB c = colourAt(tf(q)); uint8_t *p0=&s.frame[(static_cast<size_t>(d.y+py)*FRAME_W+d.x+px)*4];
        p0[0]=(uint8_t)c.r;p0[1]=(uint8_t)c.g;p0[2]=(uint8_t)c.b;p0[3]=255;
    }
    if (D.bar && d.x + d.w + 22 < FRAME_W) {               // colour bar beside the device, top = high
        const int x0 = d.x + d.w + 10;
        for (int py = 0; py < d.h; ++py) { const RGB c = colourAt(hi - (hi - lo) * py / std::max(1, d.h - 1)); for (int x = x0; x < x0 + 10; ++x) { uint8_t *p0 = &s.frame[(static_cast<size_t>(d.y + py) * FRAME_W + x) * 4]; p0[0]=(uint8_t)c.r;p0[1]=(uint8_t)c.g;p0[2]=(uint8_t)c.b;p0[3]=255; } }
    }
    char buf[400];
    std::snprintf(buf, sizeof buf, "{\"t\":\"scale\",\"what\":\"%s\",\"unit\":\"%s\",\"lo\":%.6g,\"hi\":%.6g,\"scale\":\"%s\",\"clip\":%g,\"map\":\"%s\",\"invert\":%d,\"bar\":%d}",
                  what, unit, inv(lo), inv(hi), lg ? "log" : sq ? "sqrt" : "linear", clipUse, (symmetric ? D.div : D.seq).c_str(), D.invert ? 1 : 0, (D.bar && d.x + d.w + 22 < FRAME_W) ? 1 : 0);
    if (s.lastScale != buf) { s.lastScale = buf; s.outbox.push_back(buf); }
}

void drawContacts(Instance &s, DeviceRect d) {
    for (const Contact &c : s.contacts) {
        if (c.role == "wall") {
            const int x0 = d.x + static_cast<int>(c.x0 * d.w), x1 = d.x + static_cast<int>(c.x1 * d.w);
            const int y0 = d.y + static_cast<int>((1 - c.y1) * d.h), y1 = d.y + static_cast<int>((1 - c.y0) * d.h);
            rect(s, x0, y0, std::max(x0 + 1, x1), std::max(y0 + 1, y1), RGB{93, 107, 122}, .95);
            continue;
        }
        if (c.role == "reflector") {
            const double cx = d.x + 0.5 * (c.x0 + c.x1) * d.w, cy = d.y + (1 - 0.5 * (c.y0 + c.y1)) * d.h;
            const double ax = std::max(1.0, 0.5 * (c.x1 - c.x0) * d.w), ay = std::max(1.0, 0.5 * (c.y1 - c.y0) * d.h);
            for (int yy = static_cast<int>(cy - ay); yy <= static_cast<int>(cy + ay) + 1; ++yy)
                for (int xx = static_cast<int>(cx - ax); xx <= static_cast<int>(cx + ax) + 1; ++xx) {
                    const double u = (xx + 0.5 - cx) / ax, v = (yy + 0.5 - cy) / ay;
                    if (u * u + v * v <= 1) pixel(s, xx, yy, RGB{150, 160, 172}, .95);
                }
            continue;
        }
        RGB col = c.role=="source" ? RGB{35,185,120} : c.role=="drain" ? RGB{246,91,92} : c.role=="probe" ? RGB{64,150,255} : RGB{245,176,65};
        const int x0=d.x+static_cast<int>(c.x0*d.w),x1=d.x+static_cast<int>(c.x1*d.w);
        const int y0=d.y+static_cast<int>((1-c.y1)*d.h),y1=d.y+static_cast<int>((1-c.y0)*d.h);
        rect(s,x0,y0,std::max(x0+2,x1),std::max(y0+2,y1),col,.82);
    }
}

void paintFrame(Instance &s) {
    const bool L = s.light;
    const RGB bg     = L ? RGB{247,249,252} : RGB{10,15,23};
    const RGB device = L ? RGB{255,255,255} : RGB{19,29,44};
    const RGB grid   = L ? RGB{176,190,210} : RGB{42,56,76};
    const RGB edge   = L ? RGB{90,110,140}  : RGB{104,128,160};
    for (size_t k=0;k<s.frame.size();k+=4){s.frame[k]=bg.r;s.frame[k+1]=bg.g;s.frame[k+2]=bg.b;s.frame[k+3]=255;}
    const DeviceRect d=deviceRect(s.p); rect(s,d.x,d.y,d.x+d.w,d.y+d.h,device);
    if (s.view=="potential" && s.fem.valid) heat(s,s.fem.u,s.fem.nx,s.fem.ny,d,true,false,"potential","V");
    else if (s.view=="current" && s.fem.valid) {
        std::vector<double> mag(s.fem.qx.size()); for(size_t k=0;k<mag.size();++k)mag[k]=std::hypot(s.fem.qx[k],s.fem.qy[k]);
        heat(s,mag,s.fem.nx,s.fem.ny,d,false,true,"current density","A/m");
        const int sx=std::max(1,s.fem.nx/18),sy=std::max(1,s.fem.ny/10);
        double mx=0;for(double q:mag)mx=std::max(mx,q);
        if(mx>0)for(int j=sy/2;j<s.fem.ny;j+=sy)for(int i=sx/2;i<s.fem.nx;i+=sx){size_t k=(size_t)j*s.fem.nx+i;double q=mag[k];if(q<=0)continue;double ux=s.fem.qx[k]/q,uy=s.fem.qy[k]/q,L=5+12*std::sqrt(q/mx);int x=d.x+(int)((i+.5)*d.w/s.fem.nx),y=d.y+d.h-(int)((j+.5)*d.h/s.fem.ny);line(s,x-(int)(ux*L*.5),y+(int)(uy*L*.5),x+(int)(ux*L*.5),y-(int)(uy*L*.5),{240,248,255},.72,1);}
    } else if (s.view=="vorticity" && s.fem.valid && s.fem.w.size()==s.fem.u.size()) {
        // An Ohmic sheet is irrotational: what is left is solver round-off, and a
        // colour map stretched over it draws noise as turbulence. Below 1e-6 of the
        // current density per cell it is shown as zero.
        double jm=0; for(size_t k=0;k<s.fem.qx.size();++k) jm=std::max(jm,std::hypot(s.fem.qx[k],s.fem.qy[k]));
        double wm=0; for(double v:s.fem.w) wm=std::max(wm,std::abs(v));
        const double cell=std::min(s.fem.dx,s.fem.dy);
        if(cell>0 && wm < 1e-6*jm/cell){ std::vector<double> z(s.fem.w.size(),0.0); heat(s,z,s.fem.nx,s.fem.ny,d,true,false,"vorticity (none above round-off)","A/m^2",99.5); }
        else heat(s,s.fem.w,s.fem.nx,s.fem.ny,d,true,false,"vorticity","A/m^2",99.5);
    } else if ((s.view=="trajectories" || s.view=="transmission") && s.traj.valid) {
        heat(s,s.traj.density,s.traj.gx,s.traj.gy,d,false,true,"trajectory density","path length per cell");
        if(s.disp.paths)for(const Path &p:s.traj.paths){RGB c=p.status==TRANSMITTED?RGB{65,225,160}:p.status==REFLECTED?RGB{255,190,75}:p.status==LOST?RGB{245,95,105}:RGB{165,180,205};for(size_t i=1;i<p.points.size();++i)line(s,d.x+(int)(p.points[i-1].x*d.w),d.y+d.h-(int)(p.points[i-1].y*d.h),d.x+(int)(p.points[i].x*d.w),d.y+d.h-(int)(p.points[i].y*d.h),c,s.disp.pathAlpha,1);}
    } else {
        GridFields g=buildFields(s,s.p); for(double &v:g.n) v*=1e-4;   // m^-2 -> cm^-2, as labelled
        // a density that changes sign (a p-n map) is drawn with the diverging map, centred on n = 0
        bool sgn=false;{double lo=0,hi=0;for(double v:g.n){lo=std::min(lo,v);hi=std::max(hi,v);}sgn=lo<0&&hi>0;}
        heat(s,g.n,g.nx,g.ny,d,sgn,false,"carrier density","cm^-2");
        for(int i=1;i<10;++i){int x=d.x+i*d.w/10;line(s,x,d.y,x,d.y+d.h,grid,.22);}
        for(int j=1;j<6;++j){int y=d.y+j*d.h/6;line(s,d.x,y,d.x+d.w,y,grid,.22);}
    }
    drawContacts(s,d);
    line(s,d.x,d.y,d.x+d.w,d.y,edge,.8);line(s,d.x,d.y+d.h,d.x+d.w,d.y+d.h,edge,.8);
    line(s,d.x,d.y,d.x,d.y+d.h,edge,.8);line(s,d.x+d.w,d.y,d.x+d.w,d.y+d.h,edge,.8);
}

// ---------------------------------------------------------------- control protocol and ABI

std::vector<Contact> parseContacts(const std::string &encoded) {
    std::vector<Contact> out;
    for (const std::string &row : split(encoded, ';')) {
        const auto f = split(row, '|');
        if (f.size() != 6 || f[0].empty()) continue;
        Contact c; c.id=f[0]; c.role=f[1];
        try { c.x0=clampd(std::stod(f[2]),0,1); c.y0=clampd(std::stod(f[3]),0,1); c.x1=clampd(std::stod(f[4]),0,1); c.y1=clampd(std::stod(f[5]),0,1); }
        catch (...) { continue; }
        if (c.x1<c.x0) std::swap(c.x0,c.x1); if(c.y1<c.y0)std::swap(c.y0,c.y1);
        out.push_back(std::move(c));
        if (out.size() == 16) break;
    }
    return out;
}

void configure(Instance &s, const std::string &m) {
    Params &p=s.p;
    p.Wum=clampd(dexmsg::get_num(m,"W_um",p.Wum),.2,1000); p.Hum=clampd(dexmsg::get_num(m,"H_um",p.Hum),.2,1000);
    p.ncm2=dexmsg::get_num(m,"n_cm2",p.ncm2); p.mucm=std::max(0.0,dexmsg::get_num(m,"mu_cm",p.mucm)); p.B=dexmsg::get_num(m,"B",p.B);
    p.mfpFromMobility=dexmsg::get_num(m,"mfpFromMobility",p.mfpFromMobility?1:0)!=0; p.mfpum=std::max(0.0,dexmsg::get_num(m,"mfp_um",p.mfpum));
    p.Vsource=dexmsg::get_num(m,"Vsource",p.Vsource);p.Vdrain=dexmsg::get_num(m,"Vdrain",p.Vdrain);
    p.res=clampi((int)dexmsg::get_num(m,"res",p.res),16,300);p.trajRes=clampi((int)dexmsg::get_num(m,"trajRes",p.trajRes),40,960);p.nTraj=clampi((int)dexmsg::get_num(m,"nTraj",p.nTraj),100,1000000);
    p.seed=(int)dexmsg::get_num(m,"seed",p.seed);p.femIter=clampi((int)dexmsg::get_num(m,"femIter",p.femIter),50,50000);
    p.femTol=clampd(dexmsg::get_num(m,"femTol",p.femTol),1e-12,1e-3);p.maxSteps=clampi((int)dexmsg::get_num(m,"maxSteps",p.maxSteps),100,2000000);
    p.maxPathUm=clampd(dexmsg::get_num(m,"maxPath_um",p.maxPathUm),.1,1e7);p.seedMix=(int)dexmsg::get_num(m,"seedMix",p.seedMix);p.pathAuto=(int)dexmsg::get_num(m,"pathAuto",p.pathAuto);p.threads=clampi((int)dexmsg::get_num(m,"threads",p.threads),0,256);
    p.scattering=dexmsg::get_str(m,"scattering",p.scattering);p.edge=dexmsg::get_str(m,"edge",p.edge);p.mobScope=dexmsg::get_str(m,"mobScope",p.mobScope);
    p.fwdSigmaDeg=clampd(dexmsg::get_num(m,"fwdSigmaDeg",p.fwdSigmaDeg),.1,180);p.phMfp300um=std::max(0.0,dexmsg::get_num(m,"phMfp300_um",p.phMfp300um));
    p.tempK=clampd(dexmsg::get_num(m,"tempK",p.tempK),0,2000);p.eeMfpum=std::max(0.0,dexmsg::get_num(m,"eeMfp_um",p.eeMfpum));
    p.eeSigmaDeg=clampd(dexmsg::get_num(m,"eeSigmaDeg",p.eeSigmaDeg),.1,180);p.specularity=clampd(dexmsg::get_num(m,"specularity",p.specularity),0,1);
    p.tracer=dexmsg::get_str(m,"tracer",p.tracer);p.refract=dexmsg::get_num(m,"refract",p.refract?1:0)!=0;
    p.pnMode=dexmsg::get_str(m,"pnMode",p.pnMode)=="pass"?"pass":"klein";
    p.pnWidthNm=clampd(dexmsg::get_num(m,"pnWidth_nm",p.pnWidthNm),0,1000);
    p.fieldModel=dexmsg::get_str(m,"fieldModel",p.fieldModel)=="hydro"?"hydro":"ohmic";
    p.hydroLeeUm=clampd(dexmsg::get_num(m,"hydroLee_um",p.hydroLeeUm),0,1e4);p.hydroCee=clampd(dexmsg::get_num(m,"hydroCee",p.hydroCee),1e-3,100);
    p.hydroSlipUm=clampd(dexmsg::get_num(m,"hydroSlip_um",p.hydroSlipUm),-1,1e4);if(p.hydroSlipUm<0)p.hydroSlipUm=-1;
    p.hydroHallVisc=dexmsg::get_num(m,"hydroHallVisc",p.hydroHallVisc?1:0)!=0;
#ifdef _OPENMP
    omp_set_num_threads(p.threads > 0 ? p.threads : std::max(1,omp_get_num_procs()));
#endif
    queueDerived(s);
}

void startRun(Instance &s, const std::string &mode) {
    s.job=Job::Idle;
    if(mode=="fem")s.job=Job::Fem;
    else if(mode=="hybrid")s.job=Job::HybridFem;
    else {
        Params q=s.p; const bool ballistic=mode=="ballistic"; if(ballistic){q.scattering="none";q.phMfp300um=0;q.eeMfpum=0;}
        initTrajectories(s,q,ballistic,false,q.nTraj,100);s.job=Job::Traj;
    }
    s.outbox.push_back("{\"t\":\"job\",\"state\":\"running\",\"mode\":\""+jsonEscape(mode)+"\"}");
}

void handleMessage(Instance &s, const std::string &m) {
    const std::string t=dexmsg::type_of(m);
    if(t=="configure") configure(s,m);
    else if(t=="contacts") { auto c=parseContacts(dexmsg::get_str(m,"data")); if(!c.empty())s.contacts=std::move(c); }
    else if(t=="preset") s.contacts=presetContacts(dexmsg::get_str(m,"name","hall_bar"));
    else if(t=="map") {
        FieldMap *f=dexmsg::get_str(m,"kind")=="mobility"?&s.mobilityMap:&s.densityMap;
        f->w=clampi((int)dexmsg::get_num(m,"w"),1,256);f->h=clampi((int)dexmsg::get_num(m,"h"),1,256);f->v=dexmsg::get_array(m,"data");
        if(!f->valid()){*f=FieldMap{};s.outbox.push_back("{\"t\":\"error\",\"where\":\"map\",\"message\":\"Map payload size did not match its dimensions.\"}");}
        else s.outbox.push_back("{\"t\":\"notice\",\"message\":\"Spatial map loaded into the native core.\"}");
    } else if(t=="clear_map") {
        if(dexmsg::get_str(m,"kind")=="mobility")s.mobilityMap=FieldMap{};else s.densityMap=FieldMap{};
    } else if(t=="theme") s.light = dexmsg::get_num(m,"light",1.0) != 0.0;
    else if(t=="display") {
        auto &D=s.disp; D.seq=dexmsg::get_str(m,"seq",D.seq); D.div=dexmsg::get_str(m,"div",D.div); D.scale=dexmsg::get_str(m,"scale",D.scale);
        D.clip=clampd(dexmsg::get_num(m,"clip",D.clip),50,100); D.smooth=clampi((int)dexmsg::get_num(m,"smooth",D.smooth),0,8);
        D.interp=dexmsg::get_num(m,"interp",D.interp)!=0; D.paths=dexmsg::get_num(m,"paths",D.paths)!=0; D.invert=dexmsg::get_num(m,"invert",D.invert)!=0;
        D.bar=dexmsg::get_num(m,"bar",D.bar)!=0; D.pathAlpha=clampd(dexmsg::get_num(m,"pathAlpha",D.pathAlpha),0,1);
    }
    else if(t=="view") s.view=dexmsg::get_str(m,"name",s.view);
    else if(t=="run") startRun(s,dexmsg::get_str(m,"mode","hybrid"));
    else if(t=="stop") {s.job=Job::Idle;s.outbox.push_back("{\"t\":\"job\",\"state\":\"stopped\"}");}
    else if(t=="reset") {s.p=Params{};s.contacts=presetContacts("hall_bar");s.densityMap=FieldMap{};s.mobilityMap=FieldMap{};s.fem=FEMResult{};s.traj=TrajResult{};s.job=Job::Idle;queueDerived(s);s.outbox.push_back("{\"t\":\"reset_done\"}");}
    else if(t=="sweep") {
        SweepSpec &q=s.sweep;q.type=dexmsg::get_str(m,"sweepType",q.type);q.measure=dexmsg::get_str(m,"measure",q.measure);q.quantity=dexmsg::get_str(m,"quantity",q.quantity);
        q.balMode=dexmsg::get_str(m,"balMode",q.balMode);q.quality=dexmsg::get_str(m,"quality",q.quality);
        q.wantFem=dexmsg::get_num(m,"wantFem",q.wantFem?1:0)!=0;q.wantBal=dexmsg::get_num(m,"wantBal",q.wantBal?1:0)!=0;q.snapshots=dexmsg::get_num(m,"snapshots",q.snapshots?1:0)!=0;
        q.vgFrom=dexmsg::get_num(m,"vgFrom",q.vgFrom);q.vgTo=dexmsg::get_num(m,"vgTo",q.vgTo);q.vgN=(int)dexmsg::get_num(m,"vgN",q.vgN);
        q.bFrom=dexmsg::get_num(m,"bFrom",q.bFrom);q.bTo=dexmsg::get_num(m,"bTo",q.bTo);q.bN=(int)dexmsg::get_num(m,"bN",q.bN);
        q.lFromNm=dexmsg::get_num(m,"lFrom",q.lFromNm);q.lToNm=dexmsg::get_num(m,"lTo",q.lToNm);q.lN=(int)dexmsg::get_num(m,"lN",q.lN);
        q.toxNm=dexmsg::get_num(m,"tox",q.toxNm);q.epsr=dexmsg::get_num(m,"epsr",q.epsr);q.vdirac=dexmsg::get_num(m,"vdirac",q.vdirac);
        q.tFrom=dexmsg::get_num(m,"tFrom",q.tFrom);q.tTo=dexmsg::get_num(m,"tTo",q.tTo);q.tN=(int)dexmsg::get_num(m,"tN",q.tN);
        q.xParam=dexmsg::get_str(m,"mapXParam",q.xParam);q.yParam=dexmsg::get_str(m,"mapYParam",q.yParam);
        q.xFrom=dexmsg::get_num(m,"mxFrom",q.xFrom);q.xTo=dexmsg::get_num(m,"mxTo",q.xTo);q.xN=(int)dexmsg::get_num(m,"mxN",q.xN);
        q.yFrom=dexmsg::get_num(m,"myFrom",q.yFrom);q.yTo=dexmsg::get_num(m,"myTo",q.yTo);q.yN=(int)dexmsg::get_num(m,"myN",q.yN);
        buildSweep(s);s.job=s.sweepPoints.empty()?Job::Idle:Job::Sweep;
    } else if(t=="sweep_snapshot") {
        const int i=(int)dexmsg::get_num(m,"i",-1);
        if(i>=0&&i<(int)s.sweepSnapshots.size()){
            const SweepSnapshot &q=s.sweepSnapshots[i];if(q.hasFem)s.fem=q.fem;if(q.hasTraj)s.traj=q.traj;
            s.outbox.push_back("{\"t\":\"snapshot_shown\",\"i\":"+std::to_string(i)+"}");
        }
    } else if(t=="hello") {
        s.outbox.push_back("{\"t\":\"ready\",\"backend\":\"CPU / OpenMP\",\"threads\":"+std::to_string(maxThreads())+",\"adaptive\":1}");queueDerived(s);
    }
}

void *create() {
    Instance *s=new Instance();
#ifdef _OPENMP
    omp_set_num_threads(std::max(1,omp_get_num_procs()));
#endif
    s->outbox.push_back("{\"t\":\"ready\",\"backend\":\"CPU / OpenMP\",\"threads\":"+std::to_string(maxThreads())+",\"adaptive\":1}");
    queueDerived(*s);return s;
}
void destroy(void *p){delete static_cast<Instance*>(p);}

int advance(void *ptr,double) {
    Instance &s=*static_cast<Instance*>(ptr);
    if(s.job==Job::Idle)return 0;
    if(s.job==Job::Fem||s.job==Job::HybridFem){
        const bool hybrid=s.job==Job::HybridFem;s.fem=solveField(s,s.p);s.outbox.push_back(femMessage(s.fem));
        if(hybrid){Params q=s.p;initTrajectories(s,q,false,false,q.nTraj,100);s.job=Job::HybridTraj;}
        else {s.job=Job::Idle;s.outbox.push_back("{\"t\":\"job\",\"state\":\"done\"}");}
        return 1;
    }
    if(s.job==Job::Traj||s.job==Job::HybridTraj){
        const int end=std::min(s.trajTotal,s.trajNext+512);simulateRange(s,s.trajParams,s.trajNext,end);s.trajNext=end;
        s.outbox.push_back("{\"t\":\"progress\",\"done\":"+std::to_string(end)+",\"total\":"+std::to_string(s.trajTotal)+"}");
        if(end>=s.trajTotal){finishTrajectories(s);s.outbox.push_back(trajMessage(s));s.outbox.push_back("{\"t\":\"job\",\"state\":\"done\"}");s.job=Job::Idle;}
        return 1;
    }
    if(s.job==Job::Sweep){
        computeSweepPoint(s);
        if(s.sweepIndex>=s.sweepPoints.size()){s.job=Job::Idle;s.outbox.push_back("{\"t\":\"job\",\"state\":\"done\"}");}
        return 1;
    }
    return 0;
}

void onMessage(void *p,const char *json,size_t len){handleMessage(*static_cast<Instance*>(p),std::string(json,len));}
const char *pollMessage(void *p){Instance &s=*static_cast<Instance*>(p);if(s.outbox.empty())return nullptr;s.handout=std::move(s.outbox.front());s.outbox.pop_front();return s.handout.c_str();}
int render(void *p,dex_frame *out){Instance &s=*static_cast<Instance*>(p);paintFrame(s);out->width=FRAME_W;out->height=FRAME_H;out->rgba=s.frame.data();return 1;}

const dex_plugin_api API={DEX_ABI_VERSION,"transim","Graphene Transport Explorer","1.0",create,destroy,advance,onMessage,pollMessage,render};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void){return &API;}
