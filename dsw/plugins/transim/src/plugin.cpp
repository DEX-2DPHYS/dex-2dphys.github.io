// TranSim — native DSW port of the Graphene Hybrid FEM / Ballistic Transport Explorer.
// Heavy numerical work lives here; the browser owns controls, labels and plots.

#include "dex_plugin.h"
#include "dex_msg.h"

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
    double femTol = 1e-7, maxPathUm = 240;
    int threads = 0;

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
    bool converged = false, valid = false;
    std::string error;
    std::vector<double> u, qx, qy, nfield;
    std::vector<std::pair<std::string, double>> probes;
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
    std::array<uint64_t, 5> statuses{};
    std::vector<uint64_t> density;
    std::vector<uint64_t> reached; // source contact index x terminal contact index
    std::vector<uint64_t> launchedBy;
    std::vector<Path> paths;
};

struct SweepPoint { double x = 0, y = 0, ncm2 = 0, B = 0, mucm = 0, mfpum = 0; };
struct SweepSpec {
    std::string type = "vg", measure = "2t", quantity = "G", balMode = "crossover", quality = "fast";
    bool wantFem = true, wantBal = false, snapshots = false;
    double vgFrom = -40, vgTo = 40, bFrom = -1, bTo = 1, lFromNm = 1, lToNm = 10000;
    int vgN = 41, bN = 41, lN = 41;
    double toxNm = 300, epsr = 3.9, vdirac = 0;
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
    std::vector<double> sweepFem, sweepBal;
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
    const double n0 = p.n(), mu0 = p.mu();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const double xf = (i + 0.5) / g.nx, yf = (j + 0.5) / g.ny;
        const size_t k = static_cast<size_t>(j) * g.nx + i;
        g.n[k] = s.densityMap.sample(xf, yf, n0 * 1e-4) * 1e4;
        const bool mapCond = p.mobScope == "cond" || p.mobScope == "both";
        g.mu[k] = mapCond ? s.mobilityMap.sample(xf, yf, mu0 * 1e4) * 1e-4 : mu0;
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

    std::vector<uint8_t> mask(NN, 0);
    std::vector<double> fixed(NN, 0);
    std::vector<std::vector<int>> probeCells(s.contacts.size());
    std::vector<int> contactHits(s.contacts.size(), 0);
    for (int j = 0; j < g.ny; ++j) for (int i = 0; i < g.nx; ++i) {
        const double xf = (i + 0.5) / g.nx, yf = (j + 0.5) / g.ny;
        for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (inContact(xf, yf, s.contacts[ci])) {
            const int k = j * g.nx + i;
            ++contactHits[ci];
            if (s.contacts[ci].role == "source" || s.contacts[ci].role == "drain") {
                mask[k] = 1;
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
        if (c.role == "source" || c.role == "drain") { mask[k] = 1; fixed[k] = c.role == "source" ? p.Vsource : p.Vdrain; }
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
    out.iters = solved.first; out.residual = solved.second; out.converged = std::isfinite(out.residual) && out.residual < p.femTol * 50;
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
    for (int j = 0; j < g.ny; ++j) out.current += out.qx[idx(col, j)] * g.dy;
    if (std::abs(out.current) > 1e-300) out.resistance = (p.Vsource - p.Vdrain) / out.current;
    for (size_t ci = 0; ci < s.contacts.size(); ++ci) if (s.contacts[ci].role == "probe" && !probeCells[ci].empty()) {
        double v = 0; for (int k : probeCells[ci]) v += out.u[k];
        out.probes.push_back({s.contacts[ci].id, v / probeCells[ci].size()});
    }
    out.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    out.valid = true;
    return out;
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
        if (inContact(xf, yf, s.contacts[i])) return static_cast<int>(i);
    }
    return -1;
}

double scatterAngle(const std::string &model, double theta, RNG &rng) {
    if (model == "smallangle") return theta + (rng.next() - .5) * .6;
    if (model == "forward") return theta + (rng.next() - .5) * M_PI * .5;
    if (model == "none") return theta;
    return rng.next() * 2 * M_PI;
}

double reflectAngle(const std::string &model, double theta, double nx, double ny, RNG &rng) {
    bool spec = model == "specular" || (model == "mixed" && rng.next() < .5);
    if (!spec) {
        const double inward = std::atan2(-ny, -nx);
        return inward + (rng.next() - .5) * M_PI;
    }
    const double vx = std::cos(theta), vy = std::sin(theta), dot = vx * nx + vy * ny;
    return std::atan2(vy - 2 * dot * ny, vx - 2 * dot * nx);
}

struct LocalAgg {
    std::array<uint64_t, 5> statuses{};
    std::vector<uint64_t> density, reached, launched;
    double pathSum = 0, scatterSum = 0;
    LocalAgg(int pixels, int nc) : density(pixels), reached(static_cast<size_t>(nc) * nc), launched(nc) {}
};

void simulateOne(const Instance &s, const Params &p, int ti, bool multi,
                 LocalAgg &agg, Path *saved) {
    const int nc = static_cast<int>(s.contacts.size());
    std::vector<int> sources;
    for (int i = 0; i < nc; ++i)
        if (multi || s.contacts[i].role == "source") sources.push_back(i);
    if (sources.empty()) return;
    const int source = sources[ti % sources.size()];
    RNG rng(mixedSeed(static_cast<uint32_t>(p.seed), static_cast<uint32_t>(ti)));
    const Contact &src = s.contacts[source];
    const EdgeInfo se = edgeInfo(src, p);
    double x = (src.x0 + rng.next() * (src.x1 - src.x0)) * p.W();
    double y = (src.y0 + rng.next() * (src.y1 - src.y0)) * p.H();
    double theta = se.angle + std::asin(2 * rng.next() - 1);
    x = clampd(x, 1e-12, p.W() - 1e-12); y = clampd(y, 1e-12, p.H() - 1e-12);
    ++agg.launched[source];

    const double base = std::min(p.W(), p.H()) / 180.0;
    const double maxPath = std::max(std::min(p.W(), p.H()), p.maxPathUm * 1e-6);
    const double nominalMfp = std::max(1e-12, p.mfp());
    const int maxSteps = std::min(2000000, std::max(p.maxSteps,
        static_cast<int>(std::ceil(maxPath / std::max(base * .01, std::min(base, nominalMfp)))) + 100));
    const std::string scattering = p.scattering;
    double sinceScatter = 0;
    double mfp = std::max(base * 1e-6, localMfp(s, p, x, y));
    double nextScatter = scattering == "none" ? std::numeric_limits<double>::infinity() : -mfp * std::log(std::max(1e-12, rng.next()));
    double pathLen = 0;
    int nScatter = 0, status = MAXSTEPS, terminal = -1;
    bool leftSource = false;
    if (saved) { saved->points.clear(); saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())}); }

    for (int step = 0; step < maxSteps && pathLen < maxPath; ++step) {
        double rem = nextScatter - sinceScatter;
        if (rem <= base * 1e-8) {
            theta = scatterAngle(scattering, theta, rng);
            ++nScatter; sinceScatter = 0;
            mfp = std::max(base * 1e-6, localMfp(s, p, x, y));
            nextScatter = -mfp * std::log(std::max(1e-12, rng.next()));
            continue;
        }
        const double nloc = localN(s, p, x, y);
        double rc = std::numeric_limits<double>::infinity(), turnSign = 0;
        if (p.B != 0 && std::abs(nloc) > 0) {
            rc = HBAR * std::sqrt(M_PI * std::abs(nloc)) / (E_CHARGE * std::abs(p.B));
            turnSign = (p.B >= 0 ? 1.0 : -1.0) * (nloc >= 0 ? 1.0 : -1.0);
        }
        double h = std::min(base, rem);
        if (std::isfinite(rc)) h = std::min(h, std::max(base * .01, .075 * rc));
        h = std::min(h, maxPath - pathLen);
        const double dtheta = std::isfinite(rc) ? turnSign * h / rc : 0;
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
                terminal = ci;
                if (ci == source) status = REFLECTED;
                else if (s.contacts[ci].role == "absorber" || s.contacts[ci].role == "floating") status = ABSORBED;
                else status = TRANSMITTED;
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
            theta = reflectAngle(p.edge, theta, onx, ony, rng);
            x = clampd(hx, 1e-12, p.W() - 1e-12); y = clampd(hy, 1e-12, p.H() - 1e-12);
            if (saved && saved->points.size() < 900) saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())});
            continue;
        }

        x = nxp; y = nyp; theta += dtheta; pathLen += h; sinceScatter += h;
        const int ix = clampi(static_cast<int>(x / p.W() * s.traj.gx), 0, s.traj.gx - 1);
        const int iy = clampi(static_cast<int>(y / p.H() * s.traj.gy), 0, s.traj.gy - 1);
        ++agg.density[static_cast<size_t>(iy) * s.traj.gx + ix];
        const int ci = contactAt(s, p, x, y, multi);
        if (ci != source) leftSource = true;
        if (ci >= 0 && (ci != source || leftSource)) {
            terminal = ci;
            if (ci == source) status = REFLECTED;
            else if (s.contacts[ci].role == "absorber" || s.contacts[ci].role == "floating") status = ABSORBED;
            else status = TRANSMITTED;
            if (saved) saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())});
            break;
        }
        if (sinceScatter + base * 1e-8 >= nextScatter) {
            theta = scatterAngle(scattering, theta, rng); ++nScatter; sinceScatter = 0;
            mfp = std::max(base * 1e-6, localMfp(s, p, x, y));
            nextScatter = scattering == "none" ? std::numeric_limits<double>::infinity() : -mfp * std::log(std::max(1e-12, rng.next()));
        }
        if (saved && (step & 3) == 0 && saved->points.size() < 900)
            saved->points.push_back({static_cast<float>(x / p.W()), static_cast<float>(y / p.H())});
    }
    ++agg.statuses[status];
    if (terminal >= 0) ++agg.reached[static_cast<size_t>(source) * nc + terminal];
    agg.pathSum += pathLen; agg.scatterSum += nScatter;
    if (saved) { saved->status = status; saved->source = source; saved->terminal = terminal; }
}

void initTrajectories(Instance &s, const Params &p, bool ballistic, bool multi, int total, int keepPaths) {
    s.trajParams = p;
    if (ballistic) s.trajParams.scattering = "none";
    s.traj = TrajResult{};
    s.traj.gx = 160;
    s.traj.gy = std::max(30, static_cast<int>(std::lround(160 * p.Hum / p.Wum)));
    s.traj.gy = std::min(160, s.traj.gy);
    s.traj.density.assign(static_cast<size_t>(s.traj.gx) * s.traj.gy, 0);
    s.traj.reached.assign(s.contacts.size() * s.contacts.size(), 0);
    s.traj.launchedBy.assign(s.contacts.size(), 0);
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
        s.traj.pathSum += a.pathSum; s.traj.scatterSum += a.scatterSum;
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

TrajResult runTrajectoriesSync(const Instance &src, const Params &p, bool ballistic,
                               bool multi, int total) {
    Instance temp;
    temp.p = p; temp.contacts = src.contacts; temp.densityMap = src.densityMap; temp.mobilityMap = src.mobilityMap;
    Params pp = p; if (ballistic) pp.scattering = "none";
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
    const double mfp = s.p.mfp(), rc = cyclotronRadius(s.p);
    char b[512];
    std::snprintf(b, sizeof b,
        "{\"t\":\"derived\",\"mfp_um\":%.9g,\"rc_um\":%.9g,\"kf\":%.9g,\"modes\":%.9g,\"threads\":%d}",
        mfp * 1e6, std::isfinite(rc) ? rc * 1e6 : -1.0,
        std::sqrt(M_PI * std::abs(s.p.n())),
        s.p.H() * std::sqrt(M_PI * std::abs(s.p.n())) / M_PI, maxThreads());
    s.outbox.push_back(b);
}

std::string femMessage(const FEMResult &r) {
    if (!r.valid) return "{\"t\":\"error\",\"where\":\"fem\",\"message\":\"" + jsonEscape(r.error) + "\"}";
    std::ostringstream o;
    o.precision(10);
    o << "{\"t\":\"fem\",\"nx\":" << r.nx << ",\"ny\":" << r.ny
      << ",\"iters\":" << r.iters << ",\"residual\":" << r.residual
      << ",\"converged\":" << (r.converged ? 1 : 0) << ",\"I\":" << r.current
      << ",\"R\":" << (std::isfinite(r.resistance) ? std::to_string(r.resistance) : "null")
      << ",\"G\":" << (std::isfinite(r.resistance) && r.resistance != 0 ? 1.0 / r.resistance : 0)
      << ",\"ms\":" << r.ms << ",\"probes\":[";
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
      << ",\"statuses\":{\"transmitted\":" << r.statuses[TRANSMITTED]
      << ",\"reflected\":" << r.statuses[REFLECTED] << ",\"absorbed\":" << r.statuses[ABSORBED]
      << ",\"lost\":" << r.statuses[LOST] << ",\"max_steps\":" << r.statuses[MAXSTEPS] << "},\"transmission\":[";
    bool first = true;
    const int nc = static_cast<int>(s.contacts.size());
    for (int i = 0; i < nc; ++i) if (r.launchedBy[i]) for (int j = 0; j < nc; ++j) if (i != j) {
        if (!first) o << ','; first = false;
        const double T = static_cast<double>(r.reached[static_cast<size_t>(i) * nc + j]) / r.launchedBy[i];
        const double modes = std::max(1.0, edgeInfo(s.contacts[i], s.p).width * std::sqrt(M_PI * std::abs(s.p.n())) / M_PI);
        o << "{\"source\":\"" << jsonEscape(s.contacts[i].id) << "\",\"target\":\"" << jsonEscape(s.contacts[j].id)
          << "\",\"T\":" << T << ",\"G\":" << (4 * E_CHARGE * E_CHARGE / PLANCK) * modes * T << '}';
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
            s.sweepPoints.push_back({lnm, 0, s.p.ncm2, s.p.B, muSI * 1e4, lnm * 1e-3});
        }
    } else {
        const auto vg = lin(s.sweep.vgFrom, s.sweep.vgTo, clampi(s.sweep.vgN, 2, 101));
        const auto bb = lin(s.sweep.bFrom, s.sweep.bTo, clampi(s.sweep.bN, 2, 101));
        for (double b : bb) for (double v : vg) s.sweepPoints.push_back({v, b, nFromVg(v), b, s.p.mucm, s.p.mfpum});
    }
    s.sweepFem.assign(s.sweepPoints.size(), std::numeric_limits<double>::quiet_NaN());
    s.sweepBal.assign(s.sweepPoints.size(), std::numeric_limits<double>::quiet_NaN());
    if (s.sweep.snapshots && !s.sweepPoints.empty()) {
        const long long approxCells = static_cast<long long>(s.p.res) * s.p.res * s.sweepPoints.size();
        if (approxCells <= 3000000) s.sweepSnapshots.resize(s.sweepPoints.size());
        else s.outbox.push_back("{\"t\":\"notice\",\"message\":\"Snapshots disabled for this sweep size (memory guard). Reduce points or resolution.\"}");
    }
    std::ostringstream o; o << "{\"t\":\"sweep_start\",\"total\":" << s.sweepPoints.size()
      << ",\"type\":\"" << s.sweep.type << "\",\"nx\":" << (s.sweep.type == "vgb" ? clampi(s.sweep.vgN, 2, 101) : static_cast<int>(s.sweepPoints.size()))
      << ",\"ny\":" << (s.sweep.type == "vgb" ? clampi(s.sweep.bN, 2, 101) : 1)
      << ",\"snapshots\":" << (!s.sweepSnapshots.empty() ? 1 : 0)
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
    if (s.sweep.type == "mfp") { q.mfpFromMobility = false; q.mfpum = pt.mfpum; }
    FEMResult fr;
    const bool needFem = s.sweep.wantFem || (s.sweep.wantBal && s.sweep.balMode == "crossover");
    double fval = std::numeric_limits<double>::quiet_NaN(), bval = std::numeric_limits<double>::quiet_NaN();
    if (std::abs(q.ncm2) < 1e5) {
        if (s.sweep.wantFem) fval = s.sweep.measure == "2t" ? 0 : std::numeric_limits<double>::quiet_NaN();
        if (s.sweep.wantBal) bval = s.sweep.measure == "2t" ? 0 : std::numeric_limits<double>::quiet_NaN();
    } else {
        if (needFem) fr = solveFEM(s, q);
        const double gD = fr.valid && std::isfinite(fr.resistance) && fr.resistance != 0 ? 1.0 / fr.resistance : 0;
        if (s.sweep.wantFem) fval = s.sweep.measure == "2t" ? sweepOutput(s.sweep, gD) : femProbeResistance(s, fr, s.sweep.measure);
        TrajResult tr;
        if (s.sweep.wantBal) {
            const int nt = sweepTrajCount(s.sweep, q);
            if (s.sweep.measure == "2t") {
                if (s.sweep.balMode == "mc") {
                    tr = runTrajectoriesSync(s, q, false, false, nt);
                    bval = sourceDrainG(s, q, tr);
                } else {
                    tr = runTrajectoriesSync(s, q, true, false, nt);
                    const double gB = sourceDrainG(s, q, tr);
                    bval = gB > 0 && gD > 0 ? 1.0 / (1.0 / gB + 1.0 / gD) : (gB > 0 ? gB : gD);
                }
                bval = sweepOutput(s.sweep, bval);
            } else {
                tr = runTrajectoriesSync(s, q, q.scattering == "none", true, nt);
                bval = buttikerResistance(s, q, tr, s.sweep.measure);
            }
        }
        if (!s.sweepSnapshots.empty()) {
            SweepSnapshot &snap = s.sweepSnapshots[ix];
            if (fr.valid) { snap.fem = fr; snap.hasFem = true; }
            if (tr.valid) { snap.traj = std::move(tr); snap.hasTraj = true; }
        }
    }
    s.sweepFem[ix] = fval; s.sweepBal[ix] = bval;
    std::ostringstream o; o.precision(10);
    o << "{\"t\":\"sweep_point\",\"i\":" << ix << ",\"total\":" << s.sweepPoints.size()
      << ",\"x\":" << pt.x << ",\"y\":" << pt.y << ",\"fem\":" << (std::isfinite(fval) ? std::to_string(fval) : "null")
      << ",\"bal\":" << (std::isfinite(bval) ? std::to_string(bval) : "null") << '}';
    s.outbox.push_back(o.str());
    ++s.sweepIndex;
    if (s.sweepIndex == s.sweepPoints.size()) s.outbox.push_back("{\"t\":\"sweep_done\"}");
}

// ---------------------------------------------------------------- raster renderer

struct RGB { double r, g, b; };
const std::array<RGB, 5> VIRIDIS{{{68,1,84},{59,82,139},{33,145,140},{94,201,98},{253,231,37}}};
const std::array<RGB, 5> RDBU{{{178,24,43},{239,138,98},{247,247,247},{103,169,207},{33,102,172}}};

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

template <class V>
void heat(Instance &s, const V &v, int nx, int ny, DeviceRect d,
          const std::array<RGB,5> &map, bool logScale = false, bool symmetric = false) {
    if (v.empty() || nx*ny != static_cast<int>(v.size())) return;
    double lo = std::numeric_limits<double>::infinity(), hi = -lo;
    for (auto q0 : v) { double q = static_cast<double>(q0); if (logScale) q=std::log1p(std::max(0.0,q)); lo=std::min(lo,q); hi=std::max(hi,q); }
    if (symmetric) { const double m=std::max(std::abs(lo),std::abs(hi)); lo=-m;hi=m; }
    const double range = hi - lo;
    const bool flat = !std::isfinite(range) || range <= 1e-12 * std::max({1.0, std::abs(lo), std::abs(hi)});
    std::fprintf(stderr,"heat start nx=%d ny=%d d=%d,%d,%d,%d lo=%g hi=%g range=%g flat=%d\n",nx,ny,d.x,d.y,d.w,d.h,lo,hi,range,flat?1:0);
    for (int py=0;py<d.h;++py) for(int px=0;px<d.w;++px){
        const int i=clampi(px*nx/d.w,0,nx-1), j=clampi((d.h-1-py)*ny/d.h,0,ny-1);
        double q=static_cast<double>(v[static_cast<size_t>(j)*nx+i]); if(logScale)q=std::log1p(std::max(0.0,q));
        const RGB c=colorMap(map,flat?.5:(q-lo)/range); uint8_t *p0=&s.frame[(static_cast<size_t>(d.y+py)*FRAME_W+d.x+px)*4];
        p0[0]=(uint8_t)c.r;p0[1]=(uint8_t)c.g;p0[2]=(uint8_t)c.b;p0[3]=255;
        if(py==0&&px==0)std::fprintf(stderr,"heat first ok i=%d j=%d q=%g color=%g\n",i,j,q,c.r);
    }
    std::fprintf(stderr,"heat done\n");
}

void drawContacts(Instance &s, DeviceRect d) {
    for (const Contact &c : s.contacts) {
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
    if (s.view=="potential" && s.fem.valid) heat(s,s.fem.u,s.fem.nx,s.fem.ny,d,RDBU,false,true);
    else if (s.view=="current" && s.fem.valid) {
        std::vector<double> mag(s.fem.qx.size()); for(size_t k=0;k<mag.size();++k)mag[k]=std::hypot(s.fem.qx[k],s.fem.qy[k]);
        heat(s,mag,s.fem.nx,s.fem.ny,d,VIRIDIS,true,false);
        const int sx=std::max(1,s.fem.nx/18),sy=std::max(1,s.fem.ny/10);
        double mx=0;for(double q:mag)mx=std::max(mx,q);
        if(mx>0)for(int j=sy/2;j<s.fem.ny;j+=sy)for(int i=sx/2;i<s.fem.nx;i+=sx){size_t k=(size_t)j*s.fem.nx+i;double q=mag[k];if(q<=0)continue;double ux=s.fem.qx[k]/q,uy=s.fem.qy[k]/q,L=5+12*std::sqrt(q/mx);int x=d.x+(int)((i+.5)*d.w/s.fem.nx),y=d.y+d.h-(int)((j+.5)*d.h/s.fem.ny);line(s,x-(int)(ux*L*.5),y+(int)(uy*L*.5),x+(int)(ux*L*.5),y-(int)(uy*L*.5),{240,248,255},.72,1);}
    } else if ((s.view=="trajectories" || s.view=="transmission") && s.traj.valid) {
        heat(s,s.traj.density,s.traj.gx,s.traj.gy,d,VIRIDIS,true,false);
        for(const Path &p:s.traj.paths){RGB c=p.status==TRANSMITTED?RGB{65,225,160}:p.status==REFLECTED?RGB{255,190,75}:p.status==LOST?RGB{245,95,105}:RGB{165,180,205};for(size_t i=1;i<p.points.size();++i)line(s,d.x+(int)(p.points[i-1].x*d.w),d.y+d.h-(int)(p.points[i-1].y*d.h),d.x+(int)(p.points[i].x*d.w),d.y+d.h-(int)(p.points[i].y*d.h),c,.72,1);}
    } else {
        GridFields g=buildFields(s,s.p); heat(s,g.n,g.nx,g.ny,d,VIRIDIS,false,false);
        std::fprintf(stderr,"paint grids\n");
        for(int i=1;i<10;++i){int x=d.x+i*d.w/10;line(s,x,d.y,x,d.y+d.h,grid,.22);}
        for(int j=1;j<6;++j){int y=d.y+j*d.h/6;line(s,d.x,y,d.x+d.w,y,grid,.22);}
    }
    std::fprintf(stderr,"paint contacts\n");
    drawContacts(s,d);
    std::fprintf(stderr,"paint borders\n");
    line(s,d.x,d.y,d.x+d.w,d.y,edge,.8);line(s,d.x,d.y+d.h,d.x+d.w,d.y+d.h,edge,.8);
    line(s,d.x,d.y,d.x,d.y+d.h,edge,.8);line(s,d.x+d.w,d.y,d.x+d.w,d.y+d.h,edge,.8);
    std::fprintf(stderr,"paint exit\n");
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
    p.res=clampi((int)dexmsg::get_num(m,"res",p.res),16,300);p.nTraj=clampi((int)dexmsg::get_num(m,"nTraj",p.nTraj),100,1000000);
    p.seed=(int)dexmsg::get_num(m,"seed",p.seed);p.femIter=clampi((int)dexmsg::get_num(m,"femIter",p.femIter),50,50000);
    p.femTol=clampd(dexmsg::get_num(m,"femTol",p.femTol),1e-12,1e-3);p.maxSteps=clampi((int)dexmsg::get_num(m,"maxSteps",p.maxSteps),100,2000000);
    p.maxPathUm=clampd(dexmsg::get_num(m,"maxPath_um",p.maxPathUm),.1,1e7);p.threads=clampi((int)dexmsg::get_num(m,"threads",p.threads),0,256);
    p.scattering=dexmsg::get_str(m,"scattering",p.scattering);p.edge=dexmsg::get_str(m,"edge",p.edge);p.mobScope=dexmsg::get_str(m,"mobScope",p.mobScope);
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
        Params q=s.p; const bool ballistic=mode=="ballistic"; if(ballistic)q.scattering="none";
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
        buildSweep(s);s.job=Job::Sweep;
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
        const bool hybrid=s.job==Job::HybridFem;s.fem=solveFEM(s,s.p);s.outbox.push_back(femMessage(s.fem));
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
int render(void *p,dex_frame *out){Instance &s=*static_cast<Instance*>(p);std::fprintf(stderr,"render pre %p %zu/%zu out=%p\n",(void*)s.frame.data(),s.frame.size(),s.frame.capacity(),(void*)out);paintFrame(s);std::fprintf(stderr,"render post %p %zu/%zu\n",(void*)s.frame.data(),s.frame.size(),s.frame.capacity());out->width=FRAME_W;out->height=FRAME_H;out->rgba=s.frame.data();std::fprintf(stderr,"render assigned %p\n",(void*)out->rgba);return 1;}

const dex_plugin_api API={DEX_ABI_VERSION,"transim","Graphene Transport Explorer","1.0",create,destroy,advance,onMessage,pollMessage,render};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void){return &API;}
