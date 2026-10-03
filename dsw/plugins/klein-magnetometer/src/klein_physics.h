// klein_physics.h — production physics for the Klein-collimation magnetometer.
//
// Contents
//   1. Junction profiles k(x) and the exact 1-D Dirac transmission T(k_y)
//      (tabulated per junction), with the Cheianov–Fal'ko asymptotic formula
//      as a selectable alternative.
//   2. Device = piecewise-constant cells separated by zero-thickness junction
//      lines (optionally skewed, with per-junction disorder), inside a strip
//      of width W with a chosen edge model.
//   3. Event-driven tracer on EXACT cyclotron arcs: no timestep. Events are
//      junction crossings, contact exits, edge hits, bulk scattering, e–e
//      kicks and the flight-length cap, all found by closed-form circle–line
//      intersection.
//   4. Two transport engines over the same tracer:
//        mc   — accept/reject Monte Carlo, common random numbers;
//        flux — deterministic ray splitting (weights T and 1-T), with the
//               dropped weight reported.
//   5. Thermal (Fermi-window) energy nodes and the Landauer conductance.
//
// Everything is SI. Densities in m^-2, lengths in m, fields in tesla.
// See DESIGN.md for the gates each piece has to pass.
#pragma once

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <functional>
#include <limits>
#include <string>
#include <vector>

namespace klein {

constexpr double E_CHARGE = 1.602176634e-19;
constexpr double H_PLANCK = 6.62607015e-34;
constexpr double HBAR = 1.054571817e-34;
constexpr double K_BOLTZ = 1.380649e-23;
constexpr double PI = 3.141592653589793;
constexpr double INF = std::numeric_limits<double>::infinity();
constexpr double G0 = 4 * E_CHARGE * E_CHARGE / H_PLANCK; // spin+valley conductance quantum

inline double sqr(double v) { return v * v; }
inline int sgn(double v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

// ============================================================ RNG
// Counter-hashed splitmix64: every trajectory owns an independent stream
// derived from (seed, trajectory index), so results do not depend on thread
// count or chunking, and the same trajectory index sees the same randomness
// at every field (common random numbers).
struct Rng {
    uint64_t s;
    explicit Rng(uint64_t seed) : s(seed) {}
    static uint64_t mix(uint64_t z) {
        z += 0x9e3779b97f4a7c15ull;
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
        return z ^ (z >> 31);
    }
    static uint64_t streamSeed(uint64_t seed, uint64_t index, uint64_t salt = 0) {
        return mix(mix(seed ^ 0x5851f42d4c957f2dull) + index * 0x9e3779b97f4a7c15ull + salt * 0xc2b2ae3d27d4eb4full);
    }
    double next() {
        s += 0x9e3779b97f4a7c15ull;
        uint64_t z = s;
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
        z ^= z >> 31;
        return static_cast<double>(z >> 11) * (1.0 / 9007199254740992.0); // [0,1)
    }
    double normal() {
        double u1 = next();
        while (u1 <= 1e-300) u1 = next();
        return std::sqrt(-2 * std::log(u1)) * std::cos(2 * PI * next());
    }
};

// ============================================================ 1. junctions
enum class Profile { Gate, Linear, Tanh, Erf, Asymptotic };

inline std::string profileName(Profile p) {
    switch (p) {
        case Profile::Gate: return "gate";
        case Profile::Linear: return "linear";
        case Profile::Tanh: return "tanh";
        case Profile::Erf: return "erf";
        default: return "asymptotic";
    }
}
inline Profile profileFromName(const std::string &s) {
    if (s == "linear") return Profile::Linear;
    if (s == "tanh") return Profile::Tanh;
    if (s == "erf") return Profile::Erf;
    if (s == "asymptotic") return Profile::Asymptotic;
    return Profile::Gate;
}

// Signed Fermi wavevector across a junction from kL (x -> -inf) to kR
// (x -> +inf). Every profile is parameterised by d such that the MAXIMUM
// gradient equals |kR - kL| / d, so all of them share the asymptotic
// exponent exp(-pi k_y^2 / |dk/dx|) and d means the same thing everywhere.
inline double profileK(Profile p, double kL, double kR, double d, double x) {
    const double kbar = 0.5 * (kL + kR), dk = kR - kL;
    switch (p) {
        case Profile::Linear:
            if (x <= -0.5 * d) return kL;
            if (x >= 0.5 * d) return kR;
            return kbar + dk * x / d;
        case Profile::Tanh: return kbar + 0.5 * dk * std::tanh(2 * x / d);
        case Profile::Erf: return kbar + 0.5 * dk * std::erf(std::sqrt(PI) * x / d);
        case Profile::Gate: { const double h = d / PI; return kbar + 0.5 * dk * (2 / PI) * std::atan(x / h); }
        default: return x < 0 ? kL : kR;
    }
}

// Half-width of the window on which the profile is integrated. Outside it the
// profile is taken as constant; `mismatch` reports how far (relative to
// |dk|/2) the profile still is from its asymptote at the window edge. The
// gate profile approaches its asymptote only as 1/x, so the window is capped
// by the cell half-length and the residual is reported, not hidden.
inline double profileWindow(Profile p, double d, double maxHalf, double *mismatch) {
    double X;
    switch (p) {
        case Profile::Linear: X = 0.5 * d; break;
        case Profile::Tanh: X = 0.5 * d * std::atanh(1 - 1e-9); break;      // 5.3 d
        case Profile::Erf: X = d / std::sqrt(PI) * 4.3; break;               // erf(4.3) = 1 - 1e-9
        case Profile::Gate: X = (d / PI) * std::tan(0.5 * PI * (1 - 2e-3)); break; // 1e-3 residual
        default: X = 0; break;
    }
    X = std::min(X, maxHalf);
    double miss = 0;
    switch (p) {
        case Profile::Linear: miss = X < 0.5 * d ? 1 - 2 * X / d : 0; break;
        case Profile::Tanh: miss = 1 - std::tanh(2 * X / d); break;
        case Profile::Erf: miss = 1 - std::erf(std::sqrt(PI) * X / d); break;
        case Profile::Gate: miss = 1 - (2 / PI) * std::atan(X / (d / PI)); break;
        default: break;
    }
    if (mismatch) *mismatch = miss;
    return X;
}

// Exact transmission of a 2-component Dirac plane wave with conserved k_y
// through the 1-D profile, at fixed energy (k(x) already includes E).
//   H = hbar vF (sigma_x p_x + sigma_y k_y) + U(x);   k(x) = (E - U)/(hbar vF)
//   a' =  k_y a + i k(x) b,   b' = -k_y b + i k(x) a
// Integrated with RK4 from the right (pure transmitted wave) to the left,
// where the solution is decomposed into incident + reflected plane waves.
// Returns T and R from the conserved current; |T + R - 1| is the solver's
// own error estimate.
struct DiracResult { double T = 0, R = 1, unitarity = 0; bool ok = false; };

inline DiracResult diracTransmission(Profile p, double kL, double kR, double d, double ky, double window) {
    using C = std::complex<double>;
    DiracResult out;
    const double aL = std::abs(kL), aR = std::abs(kR);
    if (aL < 1e3 || aR < 1e3) return out;
    if (ky >= aL || ky >= aR) { out.T = 0; out.R = 1; out.ok = true; return out; } // evanescent on one side
    // Overflow guard: the evanescent growth cannot exceed what the asymptotic
    // exponent predicts by many orders; beyond e^600 the answer is zero anyway.
    const double grad = std::abs(kR - kL) / d;
    if (PI * ky * ky / grad > 600) { out.T = 0; out.R = 1; out.ok = true; return out; }

    const double kmax = std::max(aL, aR);
    const double lambda = 2 * PI / kmax;
    double dx = std::min(lambda / 48, d / 48);
    dx = std::min(dx, window / 64);
    const int n = std::max(64, static_cast<int>(std::ceil(2 * window / dx)));
    dx = 2 * window / n;

    const C I(0, 1);
    auto rhs = [&](double x, const C &a, const C &b, C &da, C &db) {
        const double k = profileK(p, kL, kR, d, x);
        da = ky * a + I * k * b;
        db = -ky * b + I * k * a;
    };
    // Right side: transmitted wave moving +x. Velocity = s vF k_hat, so an
    // electron (s=+1) needs kx>0 and a hole (s=-1) needs kx<0.
    const int sR = sgn(kR), sL = sgn(kL);
    const double kxR = std::sqrt(aR * aR - ky * ky) * sR;
    const double kxL = std::sqrt(aL * aL - ky * ky) * sL;
    const double phR = std::atan2(ky, kxR);
    C a(1 / std::sqrt(2.0), 0), b = C(sR / std::sqrt(2.0), 0) * std::exp(I * phR);
    double x = window;
    const double h = -dx;
    for (int i = 0; i < n; ++i) {
        C k1a, k1b, k2a, k2b, k3a, k3b, k4a, k4b;
        rhs(x, a, b, k1a, k1b);
        rhs(x + 0.5 * h, a + 0.5 * h * k1a, b + 0.5 * h * k1b, k2a, k2b);
        rhs(x + 0.5 * h, a + 0.5 * h * k2a, b + 0.5 * h * k2b, k3a, k3b);
        rhs(x + h, a + h * k3a, b + h * k3b, k4a, k4b);
        a += (h / 6) * (k1a + 2.0 * k2a + 2.0 * k3a + k4a);
        b += (h / 6) * (k1b + 2.0 * k2b + 2.0 * k3b + k4b);
        x += h;
        if (!std::isfinite(a.real()) || !std::isfinite(b.real())) return out;
    }
    // Left side: psi = A phi_inc + B phi_ref, incident moving +x, reflected -x.
    const double phInc = std::atan2(ky, kxL), phRef = std::atan2(ky, -kxL);
    const C i1(1 / std::sqrt(2.0), 0), i2 = C(sL / std::sqrt(2.0), 0) * std::exp(I * phInc);
    const C r1(1 / std::sqrt(2.0), 0), r2 = C(sL / std::sqrt(2.0), 0) * std::exp(I * phRef);
    const C det = i1 * r2 - i2 * r1;
    if (std::abs(det) < 1e-300) return out;
    const C A = (a * r2 - b * r1) / det;
    const C B = (i1 * b - i2 * a) / det;
    // x-current of a normalised spinor (1, s e^{i ph})/sqrt2 is cos(ph) * s = |kx|/|k|
    const double jT = std::abs(kxR) / aR, jI = std::abs(kxL) / aL;
    const double PA = std::norm(A), PB = std::norm(B);
    if (PA <= 0) return out;
    out.T = jT / (PA * jI);
    out.R = PB / PA;
    out.unitarity = out.T + out.R - 1;
    out.ok = std::isfinite(out.T);
    out.T = std::max(0.0, std::min(1.0, out.T));
    return out;
}

inline double asymptoticTransmission(double kL, double kR, double d, double ky) {
    const double grad = std::abs(kR - kL) / d;
    if (grad <= 0) return 0;
    const double e = -PI * ky * ky / grad;
    return e < -700 ? 0 : std::exp(e);
}

// T(|k_y|) sampled on [0, kMax], linear interpolation; zero beyond kMax
// (there the transmitted state is evanescent).
struct JunctionTable {
    double kMax = 0, kL = 0, kR = 0, d = 0, cellHalf = 0, window = 0, mismatch = 0, worstUnitarity = 0;
    std::vector<double> T;
    double at(double ky) const {
        ky = std::abs(ky);
        if (T.empty() || ky >= kMax) return 0;
        const double f = ky / kMax * (T.size() - 1);
        const size_t i = static_cast<size_t>(f);
        if (i + 1 >= T.size()) return T.back();
        const double w = f - i;
        return T[i] * (1 - w) + T[i + 1] * w;
    }
};

inline JunctionTable buildTable(Profile p, double kL, double kR, double d, double cellHalf, int m = 512) {
    JunctionTable t;
    t.kL = kL; t.kR = kR; t.d = d;
    t.kMax = std::min(std::abs(kL), std::abs(kR));
    t.T.assign(m, 0.0);
    if (t.kMax < 1e3) return t;
    if (kL == kR) { std::fill(t.T.begin(), t.T.end(), 1.0); return t; } // no junction at all: T = 1 up to k_max
    if (p == Profile::Asymptotic && sgn(kL) != sgn(kR)) {
        for (int i = 0; i < m; ++i) t.T[i] = asymptoticTransmission(kL, kR, d, t.kMax * i / (m - 1.0));
        t.T[m - 1] = 0;
        return t;
    }
    // The Cheianov-Fal'ko exponent needs a Dirac-point crossing; a same-sign
    // (n-n') junction under the "asymptotic" option is solved exactly instead.
    if (p == Profile::Asymptotic) p = Profile::Linear;
    t.window = profileWindow(p, d, cellHalf, &t.mismatch);
    std::vector<double> unit(m, 0.0);
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 8)
#endif
    for (int i = 0; i < m - 1; ++i) {
        const double ky = t.kMax * i / (m - 1.0);
        const DiracResult r = diracTransmission(p, kL, kR, d, ky, t.window);
        t.T[i] = r.ok ? r.T : 0;
        unit[i] = std::abs(r.unitarity);
    }
    t.T[m - 1] = 0;
    t.worstUnitarity = *std::max_element(unit.begin(), unit.end());
    return t;
}

// ============================================================ 2. device
enum class EdgeModel { Specular, Diffuse, Absorbing };
enum class Injection { Cosine, Aperture, Collimated };
enum class Scatter { None, Drude, Forward };
enum class Fate { Transmitted = 0, Reflected = 1, Lost = 2, Capped = 3 };

struct Params {
    int nCells = 16;                  // regions; junctions = nCells - 1
    double Ln = 0.5e-6, Lp = 0.5e-6;  // n-cell and p-cell lengths
    double W = 10e-6;
    double nN = 1e16, nP = 1e16;      // |densities| of n and p cells
    bool unipolar = false;            // "p" cells are electron-like (control device)
    Profile profile = Profile::Gate;
    double d = 10e-9;                 // max-gradient width (gate: h = d / pi)
    double skewDeg = 0;
    // per-junction disorder (relative rms unless stated)
    double sigmaPos = 0;              // absolute, m
    double sigmaWidth = 0, sigmaDensity = 0;
    double sigmaTiltDeg = 0;          // local tilt drawn at every crossing
    uint32_t disorderSeed = 1;
    EdgeModel edge = EdgeModel::Specular;
    double specularity = 1;
    Injection injection = Injection::Cosine;
    double apertureFrac = 1, collimSigmaDeg = 10;
    // End contacts: centred fraction of W covered by the source (x = 0) and drain (x = L_tot).
    // Outside it the end of the strip is a specular wall. 1 = full-width contacts (default).
    // A partial source also sets the injection width (cos-theta through that opening).
    double leftFrac = 1, rightFrac = 1;
    double vF = 1e6;
    double mfp = 30e-6;               // impurity mean free path (<= 0: infinite)
    double mfpPh300 = 0;              // acoustic-phonon mfp at 300 K (<= 0: off)
    double tempK = 20;
    Scatter scatter = Scatter::Forward;
    double forwardSigmaDeg = 10;
    double eeMfp = 0, eeSigmaDeg = 15;
    // Flight-length cap in units of L_tot. Capped carriers count as NOT transmitted,
    // which biases T low and the MR high unless the cap is converged; 2026-10-01
    // measurement on the first-simulation device: cap 6 -> MR(20 mT) 761 %, cap 16 ->
    // 327 %, cap >= 100 -> 209 % (converged). Default is therefore 200.
    double maxPathFactor = 200;
    int maxEvents = 2000000;          // per trajectory; hitting it counts as capped
    // flux engine
    double fluxThreshold = 1e-4;
    int fluxMaxDepth = 400;

    double effectiveMfp() const {
        double inv = 0;
        if (mfp > 0) inv += 1 / mfp;
        if (mfpPh300 > 0 && tempK > 0) inv += 1 / (mfpPh300 * 300.0 / tempK);
        return inv > 0 ? 1 / inv : INF;
    }
};

struct Cell { double x0 = 0, x1 = 0, k = 0; };          // k signed
struct Junction { double u = 0, d = 0; int left = 0, right = 0; };

struct Device {
    int nCells = 0;
    double W = 0, Ltot = 0;
    double skew = 0, nX = 1, nY = 0, tX = 0, tY = 1;  // junction normal / tangent
    std::vector<Cell> cells;
    std::vector<Junction> junctions;
    std::vector<JunctionTable> tables;
    EdgeModel edge = EdgeModel::Specular;
    double specularity = 1;
    Injection injection = Injection::Cosine;
    double aperture = 0, collimSigma = 0;
    double leftLo = 0, leftHi = 0, rightLo = 0, rightHi = 0;   // contact spans on the end walls
    double vF = 1e6, mfp = INF, eeMfp = INF, forwardSigma = 0, eeSigma = 0, tiltSigma = 0;
    Scatter scatter = Scatter::None;
    double maxPath = 0;
    int maxEvents = 0;
    double fluxThreshold = 1e-4;
    int fluxMaxDepth = 400;
    int modes = 0, modesBottleneck = 0;
    bool validate = false;            // gates: check the cell label against the geometry at every event
    double worstUnitarity = 0, worstMismatch = 0;
    double sectionU(double x, double y) const { return x - skew * (y - 0.5 * W); }
};

inline double kfFromDensity(double n) { return std::sqrt(PI * std::max(n, 0.0)); }

// energyOffset shifts E_F: every signed k moves by +eps/(hbar vF).
inline Device buildDevice(const Params &p, double energyOffset = 0) {
    Device dv;
    dv.nCells = std::max(1, p.nCells);
    dv.W = p.W;
    dv.skew = std::tan(p.skewDeg * PI / 180);
    dv.nX = std::cos(p.skewDeg * PI / 180); dv.nY = -std::sin(p.skewDeg * PI / 180);
    dv.tX = std::sin(p.skewDeg * PI / 180); dv.tY = std::cos(p.skewDeg * PI / 180);
    Rng dis(Rng::streamSeed(p.disorderSeed, 0xd15));
    const double dk = energyOffset / (HBAR * p.vF);
    double x = 0;
    for (int c = 0; c < dv.nCells; ++c) {
        const bool isN = c % 2 == 0;
        double n = isN ? p.nN : p.nP;
        if (p.sigmaDensity > 0) n *= std::max(0.05, 1 + p.sigmaDensity * dis.normal());
        const double kmag = kfFromDensity(n);
        const int s = (isN || p.unipolar) ? 1 : -1;
        Cell cell;
        cell.x0 = x;
        cell.x1 = x + (isN ? p.Ln : p.Lp);
        cell.k = s * kmag + dk;
        dv.cells.push_back(cell);
        x = cell.x1;
    }
    dv.Ltot = x;
    for (int j = 1; j < dv.nCells; ++j) {
        Junction jn;
        jn.u = dv.cells[j].x0;
        if (p.sigmaPos > 0) jn.u += p.sigmaPos * dis.normal();
        jn.d = p.d;
        if (p.sigmaWidth > 0) jn.d *= std::max(0.05, 1 + p.sigmaWidth * dis.normal());
        jn.left = j - 1; jn.right = j;
        dv.junctions.push_back(jn);
    }
    // jittered positions must stay ordered; cells follow the junctions
    for (size_t j = 1; j < dv.junctions.size(); ++j)
        dv.junctions[j].u = std::max(dv.junctions[j].u, dv.junctions[j - 1].u + 1e-9);
    {   // and inside (0, L_tot), keeping the order
        const size_t nJ = dv.junctions.size();
        for (size_t j = 0; j < nJ; ++j)
            dv.junctions[j].u = std::min(std::max(dv.junctions[j].u, 1e-9 * (j + 1)), dv.Ltot - 1e-9 * (nJ - j));
    }
    for (size_t j = 0; j < dv.junctions.size(); ++j) {
        dv.cells[j].x1 = dv.junctions[j].u;
        dv.cells[j + 1].x0 = dv.junctions[j].u;
    }
    for (size_t j = 0; j < dv.junctions.size(); ++j) {
        const Cell &a = dv.cells[dv.junctions[j].left], &b = dv.cells[dv.junctions[j].right];
        const double cellHalf = 0.5 * std::min(a.x1 - a.x0, b.x1 - b.x0);
        bool reused = false;
        for (size_t q = 0; q < j && !reused; ++q) {
            const JunctionTable &prev = dv.tables[q];
            if (prev.kL == a.k && prev.kR == b.k && prev.d == dv.junctions[j].d && prev.cellHalf == cellHalf) { dv.tables.push_back(prev); reused = true; }
        }
        if (!reused) { dv.tables.push_back(buildTable(p.profile, a.k, b.k, dv.junctions[j].d, cellHalf)); dv.tables.back().cellHalf = cellHalf; }
        dv.worstUnitarity = std::max(dv.worstUnitarity, dv.tables.back().worstUnitarity);
        dv.worstMismatch = std::max(dv.worstMismatch, dv.tables.back().mismatch);
    }
    dv.edge = p.edge; dv.specularity = p.specularity;
    dv.injection = p.injection;
    dv.aperture = p.injection == Injection::Aperture ? std::max(0.0, std::min(1.0, p.apertureFrac)) * p.W : p.W;
    {
        const double lf = std::max(1e-4, std::min(1.0, p.leftFrac)), rf = std::max(1e-4, std::min(1.0, p.rightFrac));
        dv.leftLo = 0.5 * p.W * (1 - lf); dv.leftHi = 0.5 * p.W * (1 + lf);
        dv.rightLo = 0.5 * p.W * (1 - rf); dv.rightHi = 0.5 * p.W * (1 + rf);
        if (lf < 1) dv.aperture = std::min(dv.aperture, lf * p.W);   // carriers enter only through the source
    }
    dv.collimSigma = p.collimSigmaDeg * PI / 180;
    dv.vF = p.vF;
    dv.mfp = p.effectiveMfp();
    dv.scatter = p.scatter;
    if (p.scatter == Scatter::None) dv.mfp = INF;          // "none" means no bulk events at all
    if (!(dv.mfp < INF)) dv.scatter = Scatter::None;
    dv.forwardSigma = p.forwardSigmaDeg * PI / 180;
    dv.eeMfp = p.eeMfp > 0 ? p.eeMfp : INF;
    dv.eeSigma = p.eeSigmaDeg * PI / 180;
    dv.tiltSigma = p.sigmaTiltDeg * PI / 180;
    dv.maxPath = p.maxPathFactor * dv.Ltot;
    dv.maxEvents = p.maxEvents;
    dv.fluxThreshold = p.fluxThreshold;
    dv.fluxMaxDepth = p.fluxMaxDepth;
    // Landauer: G = G0 (W/pi) * integral_0^{k_lead} T(k_y) dk_y = G0 M_lead <T>_lead, with
    // <T> averaged uniformly in k_y (= cos-theta flux) over the INJECTING cell's modes.
    // Modes that are evanescent further down the device already carry T = 0, so using
    // the bottleneck count here would count the bottleneck twice (review 2026-10-01).
    dv.modes = std::max(0, static_cast<int>(std::floor(std::abs(dv.cells[0].k) * dv.aperture / PI)));
    double kmin = INF;
    for (const Cell &c : dv.cells) kmin = std::min(kmin, std::abs(c.k));
    dv.modesBottleneck = std::max(0, static_cast<int>(std::floor(kmin * dv.aperture / PI)));
    return dv;
}

// ============================================================ 3. tracer
struct Line { double a, b, c; };   // a x + b y = c

// Exact position/angle update along the arc (sinc form: no cancellation as
// omega -> 0).
inline void arcMove(double &x, double &y, double &phi, double v, double omega, double t) {
    const double half = 0.5 * omega * t;
    const double s = std::abs(half) < 1e-8 ? 1.0 - half * half / 6 : std::sin(half) / half;
    x += v * t * std::cos(phi + half) * s;
    y += v * t * std::sin(phi + half) * s;
    phi += omega * t;
}

// First time t > 0 at which the arc from (x0,y0,phi0) reaches the line while
// APPROACHING it from the current side. The side is taken from the signed
// distance, or from the velocity when the point sits on the line (right after
// an event there), which is what rejects the spurious t ~ 0 root.
// `side` is the side of the line the ray MUST be on (+1: a x + b y > c), known from
// the cell label, not inferred from a distance threshold. A ray that rounding has
// put just past the line is handled explicitly: moving further across -> hit now;
// moving back -> no hit on this line.
inline double arcLineHit(double x0, double y0, double phi0, double v, double omega, const Line &L, int side) {
    double f0 = L.a * x0 + L.b * y0 - L.c;
    const double rho = std::hypot(L.a, L.b);
    const double vx0 = v * std::cos(phi0), vy0 = v * std::sin(phi0);
    if (sgn(f0) == -side) {
        // Past the line. Moving further across: the crossing is now.
        if (sgn(L.a * vx0 + L.b * vy0) == -side) return 1e-30;
        // Moving back: a rounding-level offset (a ray sitting on the line after an
        // event there) is treated as ON the line, so a curved path that comes back
        // across later in this arc is still found. A real offset cannot occur.
        if (std::abs(f0) > 1e-9 * rho) return INF;
        f0 = 0;
    }
    if (omega == 0) {
        const double den = L.a * vx0 + L.b * vy0;
        if (sgn(den) != -side) return INF;
        const double t = -f0 / den;
        return t > 0 ? t : INF;
    }
    // a sin(phi) - b cos(phi) = K, K = (omega/v)(c - a x0 - b y0) + a sin(phi0) - b cos(phi0)
    const double K = -(omega / v) * f0 + L.a * std::sin(phi0) - L.b * std::cos(phi0);
    const double sv = K / rho;
    if (std::abs(sv) > 1) return INF;
    const double alpha = std::atan2(L.b, L.a), psi = std::asin(sv);
    const double twoPi = 2 * PI, aw = std::abs(omega);
    double best = INF;
    const double cands[2] = {alpha + psi, alpha + PI - psi};
    for (double ph : cands) {
        double dphi = (ph - phi0) * (omega > 0 ? 1 : -1);
        dphi = std::fmod(dphi, twoPi);
        if (dphi < 0) dphi += twoPi;
        for (int lap = 0; lap < 2; ++lap) {
            const double t = (dphi + lap * twoPi) / aw;
            if (t <= 0) continue;
            const double phT = phi0 + omega * t;
            const double approach = L.a * std::cos(phT) + L.b * std::sin(phT);
            if (sgn(approach) == -side && t > 1e-30) { best = std::min(best, t); break; }
        }
    }
    return best;
}

struct PathSink {
    std::vector<float> xy;   // pairs
    int maxPoints = 4000;
    void add(double x, double y) { if (static_cast<int>(xy.size()) < 2 * maxPoints) { xy.push_back(static_cast<float>(x)); xy.push_back(static_cast<float>(y)); } }
};

struct TraceStats { double path = 0; int crossings = 0, edgeHits = 0, scatters = 0, labelErrors = 0; };

// The cell a point is in, from geometry alone (junctions are ordered in u).
inline int cellAt(const Device &dv, double x, double y) {
    const double u = dv.sectionU(x, y);
    int c = 0;
    while (c < static_cast<int>(dv.junctions.size()) && u >= dv.junctions[c].u) ++c;
    return c;
}

struct RayState {
    double x = 0, y = 0, phi = 0;
    int cell = 0;
    double path = 0, scatB = INF, eeB = INF;
};

inline double omegaFor(const Device &dv, int cell, double B) {
    const double k = dv.cells[cell].k;
    if (B == 0 || std::abs(k) < 1e3) return 0;
    // Physical convention, B > 0 along +z (x along the current, y across the strip):
    // hbar dk/dt = -e v x B with v = s vF k_hat gives d(phi)/dt = s e vF B / (hbar |k|),
    // i.e. electrons (s = +1) orbit counter-clockwise, holes clockwise. The June /
    // reference engine used the opposite sign, which is the same physics at -B; the
    // gates compare against it at -B. Only the sign of odd-in-B responses depends on it.
    return sgn(k) * E_CHARGE * dv.vF * B / (HBAR * std::abs(k));
}

// Junction crossing geometry shared by both engines: returns the transmission
// probability for the incident state and fills the refracted / reflected
// angles. `tilt` is a local normal rotation (rad).
struct Crossing { double T = 0, phiT = 0, phiR = 0; bool tir = false; int cellT = 0; };

inline Crossing junctionCrossing(const Device &dv, const RayState &r, int j, double tilt) {
    Crossing c;
    const Junction &jn = dv.junctions[j];
    const double ct = std::cos(tilt), st = std::sin(tilt);
    const double nX = dv.nX * ct - dv.nY * st, nY = dv.nX * st + dv.nY * ct;
    const double tX = dv.tX * ct - dv.tY * st, tY = dv.tX * st + dv.tY * ct;
    const double vx = std::cos(r.phi), vy = std::sin(r.phi);
    const double vn = vx * nX + vy * nY, vt = vx * tX + vy * tY;
    const bool forward = r.cell == jn.left;              // which cell the ray is in decides the direction
    const int from = r.cell, to = forward ? jn.right : jn.left;
    c.phiR = std::atan2(vy - 2 * vn * nY, vx - 2 * vn * nX);
    // a local tilt can make the facet face away from a grazing ray: reflect (about
    // the real line if the tilted mirror would send it across)
    if ((forward ? vn : -vn) <= 0) {
        const double ux = std::cos(c.phiR), uy = std::sin(c.phiR), un = ux * dv.nX + uy * dv.nY;
        if (sgn(un) != (forward ? -1 : 1)) c.phiR = std::atan2(uy - 2 * un * dv.nY, ux - 2 * un * dv.nX);
        c.T = 0; c.tir = true; c.phiT = c.phiR; c.cellT = from; return c;
    }
    const double kIn = dv.cells[from].k, kOut = dv.cells[to].k;
    const int sIn = sgn(kIn), sOut = sgn(kOut);
    const double kt = sIn * std::abs(kIn) * vt;              // conserved tangential k (v is unit here)
    c.T = dv.tables[j].at(kt);
    c.cellT = to;
    if (std::abs(kt) >= std::abs(kOut)) { c.tir = true; c.T = 0; c.phiT = c.phiR; c.cellT = from; return c; }
    const double kn = std::sqrt(std::max(0.0, kOut * kOut - kt * kt));
    const double vnOut = (forward ? 1 : -1) * kn / std::abs(kOut);
    const double vtOut = sOut * kt / std::abs(kOut);
    c.phiT = std::atan2(vnOut * nY + vtOut * tY, vnOut * nX + vtOut * tX);
    if (tilt != 0) {
        // The facet is tilted but the junction LINE is not: a direction built on the
        // tilted normal can point back across the real line (grazing rays), which
        // would leave the ray in a cell it is not in. Mirror such a direction about
        // the real line so the reflected ray stays in `from` and the transmitted ray
        // enters `to`. T is unchanged, so the transmission statistics are not biased.
        auto keep = [&](double phi, int want) {
            const double ux = std::cos(phi), uy = std::sin(phi), un = ux * dv.nX + uy * dv.nY;
            if (sgn(un) == want) return phi;
            return std::atan2(uy - 2 * un * dv.nY, ux - 2 * un * dv.nX);
        };
        c.phiR = keep(c.phiR, forward ? -1 : 1);
        c.phiT = keep(c.phiT, forward ? 1 : -1);
    }
    return c;
}

enum class EventKind { None, JunctionL, JunctionR, ExitL, ExitR, EdgeB, EdgeT, Scatter, EE, Cap };

struct NextEvent { EventKind kind = EventKind::None; double t = INF; };

inline NextEvent nextEvent(const Device &dv, const RayState &r, double B, double omega) {
    NextEvent ev;
    const double v = dv.vF;
    auto consider = [&](EventKind k, double t) { if (t < ev.t) { ev.t = t; ev.kind = k; } };
    const double cu = dv.skew, c0 = -cu * (-0.5 * dv.W); // u = x - skew*(y - W/2) = x - skew*y + skew*W/2
    if (r.cell > 0) { const Line L{1, -cu, dv.junctions[r.cell - 1].u - c0}; consider(EventKind::JunctionL, arcLineHit(r.x, r.y, r.phi, v, omega, L, +1)); }
    if (r.cell < dv.nCells - 1) { const Line L{1, -cu, dv.junctions[r.cell].u - c0}; consider(EventKind::JunctionR, arcLineHit(r.x, r.y, r.phi, v, omega, L, -1)); }
    consider(EventKind::ExitL, arcLineHit(r.x, r.y, r.phi, v, omega, Line{1, 0, 0}, +1));
    consider(EventKind::ExitR, arcLineHit(r.x, r.y, r.phi, v, omega, Line{1, 0, dv.Ltot}, -1));
    consider(EventKind::EdgeB, arcLineHit(r.x, r.y, r.phi, v, omega, Line{0, 1, 0}, +1));
    consider(EventKind::EdgeT, arcLineHit(r.x, r.y, r.phi, v, omega, Line{0, 1, dv.W}, -1));
    if (r.scatB < INF) consider(EventKind::Scatter, r.scatB / v);
    if (r.eeB < INF) consider(EventKind::EE, r.eeB / v);
    consider(EventKind::Cap, (dv.maxPath - r.path) / v);
    (void)B;
    return ev;
}

inline double drawFreePath(double mfp, Rng &rng) {
    if (!(mfp < INF)) return INF;
    double u = rng.next();
    while (u <= 0) u = rng.next();
    return -mfp * std::log(u);
}

inline void scatterAngle(const Device &dv, double &phi, Rng &rng) {
    if (dv.scatter == Scatter::Drude) phi = 2 * PI * rng.next();
    else phi += dv.forwardSigma * rng.normal();
}

// Edge handler; returns false if the ray is absorbed.
inline bool edgeHit(const Device &dv, RayState &r, bool bottom, Rng &rng, TraceStats *st) {
    if (st) ++st->edgeHits;
    if (dv.edge == EdgeModel::Absorbing) return false;
    double vx = std::cos(r.phi), vy = -std::sin(r.phi);   // specular
    if (dv.edge == EdgeModel::Diffuse && rng.next() >= dv.specularity) {
        const double beta = std::asin(2 * rng.next() - 1);  // p(beta) ~ cos(beta) about the inward normal
        vy = (bottom ? 1 : -1) * std::cos(beta);
        vx = std::sin(beta);
    }
    r.phi = std::atan2(vy, vx);
    r.y = bottom ? 0 : dv.W;
    return true;
}

// Injection sample for trajectory `index`: (y0, theta0, weight). Weight is 1
// for cosine/aperture sampling; for a collimated source the Gaussian is
// sampled directly as well.
inline void injectSample(const Device &dv, Rng &rng, double &y0, double &theta0) {
    const double y0lo = 0.5 * (dv.W - dv.aperture);
    y0 = y0lo + dv.aperture * rng.next();
    if (dv.injection == Injection::Collimated) {
        do { theta0 = dv.collimSigma * rng.normal(); } while (std::abs(theta0) >= 0.5 * PI);
    } else {
        theta0 = std::asin(2 * rng.next() - 1);
    }
}

// Path-length density on a gx x gy grid over the device (x in [0, L_tot], y in [0, W]).
// firstFlight: deposit only until the first reflection at an edge or end wall
// (the classic ray picture); otherwise the full multiply-reflected dynamics.
struct DensityGrid {
    int gx = 200, gy = 100; bool firstFlight = false;
    double Lx = 1, Ly = 1;
    std::vector<double> w;
    void init(const Device &dv, int nx, int ny, bool first) { gx = nx; gy = ny; firstFlight = first; Lx = dv.Ltot; Ly = dv.W; w.assign(static_cast<size_t>(gx) * gy, 0.0); }
    void deposit(double x, double y, double len) {
        const int i = static_cast<int>(x / Lx * gx), j = static_cast<int>(y / Ly * gy);
        if (i < 0 || j < 0 || i >= gx || j >= gy) return;
        w[static_cast<size_t>(j) * gx + i] += len;
    }
    void add(const DensityGrid &o) { for (size_t k = 0; k < w.size() && k < o.w.size(); ++k) w[k] += o.w[k]; }
};

// End wall at x = 0 or x = L_tot: inside the contact span the carrier leaves;
// outside it is specularly reflected (phi -> pi - phi). Returns true if it left.
inline bool endWall(const Device &dv, RayState &r, bool right) {
    const double lo = right ? dv.rightLo : dv.leftLo, hi = right ? dv.rightHi : dv.leftHi;
    if (r.y >= lo && r.y <= hi) return true;
    r.phi = PI - r.phi;
    r.x = right ? dv.Ltot : 0;
    return false;
}

// ---- Monte-Carlo trajectory ------------------------------------------
inline Fate traceMC(const Device &dv, double B, RayState r, Rng &rng, TraceStats *st = nullptr, PathSink *sink = nullptr, RayState *final = nullptr, DensityGrid *dens = nullptr) {
    bool depositing = dens != nullptr;
    r.scatB = drawFreePath(dv.mfp, rng);
    r.eeB = drawFreePath(dv.eeMfp, rng);
    if (sink) sink->add(r.x, r.y);
    for (int ev = 0; ev < dv.maxEvents; ++ev) {
        const double omega = omegaFor(dv, r.cell, B);
        const NextEvent ne = nextEvent(dv, r, B, omega);
        if (!(ne.t < INF)) return Fate::Capped;
        const double t = ne.t;
        if (sink && omega != 0) {
            const int segs = std::min(64, 1 + static_cast<int>(std::abs(omega * t) / 0.05));
            double x = r.x, y = r.y, ph = r.phi;
            for (int s = 1; s < segs; ++s) { arcMove(x, y, ph, dv.vF, omega, t / segs); sink->add(x, y); }
        }
        if (depositing) {
            const double len0 = dv.vF * t, ds = std::min(dens->Lx / dens->gx, dens->Ly / dens->gy) * 0.5;
            const int segs = std::max(1, std::min(200000, static_cast<int>(std::ceil(len0 / ds))));
            double x = r.x, y = r.y, ph = r.phi;
            for (int s = 0; s < segs; ++s) {
                double xm = x, ym = y, pm = ph; arcMove(xm, ym, pm, dv.vF, omega, 0.5 * t / segs);
                dens->deposit(xm, ym, len0 / segs);
                arcMove(x, y, ph, dv.vF, omega, t / segs);
            }
        }
        arcMove(r.x, r.y, r.phi, dv.vF, omega, t);
        const double len = dv.vF * t;
        r.path += len; r.scatB -= len; r.eeB -= len;
        if (sink) sink->add(r.x, r.y);
        if (st) st->path = r.path;
        if (final) *final = r;
        if (dv.validate && st) {
            // the label must match the geometry except within 1 pm of a junction line
            const int g = cellAt(dv, r.x, r.y);
            if (g != r.cell) {
                const double u = dv.sectionU(r.x, r.y);
                bool nearLine = false;
                for (const Junction &jn : dv.junctions) if (std::abs(u - jn.u) < 1e-12) nearLine = true;
                if (!nearLine) ++st->labelErrors;
            }
        }
        switch (ne.kind) {
            case EventKind::ExitL: if (endWall(dv, r, false)) { r.x = 0; if (final) *final = r; return Fate::Reflected; } if (st) ++st->edgeHits; depositing = depositing && !dens->firstFlight; break;
            case EventKind::ExitR: if (endWall(dv, r, true)) { r.x = dv.Ltot; if (final) *final = r; return Fate::Transmitted; } if (st) ++st->edgeHits; depositing = depositing && !dens->firstFlight; break;
            case EventKind::Cap: return Fate::Capped;
            case EventKind::EdgeB: if (!edgeHit(dv, r, true, rng, st)) return Fate::Lost; depositing = depositing && !dens->firstFlight; break;
            case EventKind::EdgeT: if (!edgeHit(dv, r, false, rng, st)) return Fate::Lost; depositing = depositing && !dens->firstFlight; break;
            case EventKind::Scatter: scatterAngle(dv, r.phi, rng); r.scatB = drawFreePath(dv.mfp, rng); if (st) ++st->scatters; break;
            case EventKind::EE: r.phi += dv.eeSigma * rng.normal(); r.eeB = drawFreePath(dv.eeMfp, rng); break;
            case EventKind::JunctionL:
            case EventKind::JunctionR: {
                const int j = ne.kind == EventKind::JunctionL ? r.cell - 1 : r.cell;
                const double tilt = dv.tiltSigma > 0 ? dv.tiltSigma * rng.normal() : 0;
                const Crossing c = junctionCrossing(dv, r, j, tilt);
                if (st) ++st->crossings;
                const double u = rng.next();                 // always drawn: common random numbers
                if (!c.tir && u < c.T) { r.phi = c.phiT; r.cell = c.cellT; }
                else r.phi = c.phiR;
                break;
            }
            default: return Fate::Capped;
        }
    }
    return Fate::Capped;
}

// ---- deterministic flux (ray splitting) -------------------------------
struct FluxTally { double T = 0, R = 0, lost = 0, capped = 0, dropped = 0; long rays = 0, rouletted = 0; };

struct FluxRay { RayState r; double w; int depth; uint64_t seed; };

inline void traceFlux(const Device &dv, double B, RayState r0, uint64_t seed, FluxTally &tally) {
    std::vector<FluxRay> stack;
    {
        Rng rng(seed);
        r0.scatB = drawFreePath(dv.mfp, rng);
        r0.eeB = drawFreePath(dv.eeMfp, rng);
        stack.push_back({r0, 1.0, 0, seed});
    }
    uint64_t children = 0;
    while (!stack.empty()) {
        FluxRay fr = stack.back(); stack.pop_back();
        RayState r = fr.r;
        double w = fr.w;
        Rng rng(Rng::mix(fr.seed + 0x51ed));
        ++tally.rays;
        bool done = false;
        for (int ev = 0; ev < dv.maxEvents && !done; ++ev) {
            const double omega = omegaFor(dv, r.cell, B);
            const NextEvent ne = nextEvent(dv, r, B, omega);
            if (!(ne.t < INF)) { tally.capped += w; done = true; break; }
            arcMove(r.x, r.y, r.phi, dv.vF, omega, ne.t);
            const double len = dv.vF * ne.t;
            r.path += len; r.scatB -= len; r.eeB -= len;
            switch (ne.kind) {
                case EventKind::ExitL: if (endWall(dv, r, false)) { tally.R += w; done = true; } break;
                case EventKind::ExitR: if (endWall(dv, r, true)) { tally.T += w; done = true; } break;
                case EventKind::Cap: tally.capped += w; done = true; break;
                case EventKind::EdgeB: if (!edgeHit(dv, r, true, rng, nullptr)) { tally.lost += w; done = true; } break;
                case EventKind::EdgeT: if (!edgeHit(dv, r, false, rng, nullptr)) { tally.lost += w; done = true; } break;
                case EventKind::Scatter: scatterAngle(dv, r.phi, rng); r.scatB = drawFreePath(dv.mfp, rng); break;
                case EventKind::EE: r.phi += dv.eeSigma * rng.normal(); r.eeB = drawFreePath(dv.eeMfp, rng); break;
                case EventKind::JunctionL:
                case EventKind::JunctionR: {
                    const int j = ne.kind == EventKind::JunctionL ? r.cell - 1 : r.cell;
                    const double tilt = dv.tiltSigma > 0 ? dv.tiltSigma * rng.normal() : 0;
                    const Crossing c = junctionCrossing(dv, r, j, tilt);
                    if (c.tir) { r.phi = c.phiR; break; }
                    const double wT = w * c.T, wR = w * (1 - c.T);
                    if (fr.depth >= dv.fluxMaxDepth) {
                        // depth limit: plain Monte-Carlo choice keeps the estimate unbiased
                        if (rng.next() < c.T) { r.phi = c.phiT; r.cell = c.cellT; } else r.phi = c.phiR;
                        break;
                    }
                    // continue with the heavier branch, push the lighter one;
                    // a light branch plays Russian roulette against the
                    // threshold (survives with probability w/thr at weight thr),
                    // so no weight is ever discarded.
                    const bool goT = wT >= wR;
                    double wPush = goT ? wR : wT;
                    if (wPush > 0 && wPush < dv.fluxThreshold) {
                        if (rng.next() < wPush / dv.fluxThreshold) wPush = dv.fluxThreshold; else wPush = 0;
                        tally.rouletted += 1;
                    }
                    if (wPush > 0) {
                        RayState child = r;
                        if (goT) child.phi = c.phiR; else { child.phi = c.phiT; child.cell = c.cellT; }
                        stack.push_back({child, wPush, fr.depth + 1, Rng::mix(fr.seed ^ (++children * 0x9e37ull))});
                    }
                    w = goT ? wT : wR;
                    if (goT) { r.phi = c.phiT; r.cell = c.cellT; } else r.phi = c.phiR;
                    ++fr.depth;
                    break;
                }
                default: tally.capped += w; done = true; break;
            }
        }
        if (!done) tally.capped += w;
    }
}

// ============================================================ 4. ensembles
struct PointResult {
    long n = 0;                       // samples (trajectories or quadrature nodes)
    double wT = 0, wR = 0, wLost = 0, wCapped = 0, wDropped = 0, wSum = 0;
    double s1 = 0, s2 = 0, s3 = 0;    // sum (w T)^2, sum w^2 T, sum w^2 : ratio-estimator variance
    double sumPath = 0, sumCross = 0; long edgeTouched = 0, rays = 0, rouletted = 0, labelErrors = 0;
    long directT = 0;                 // transmitted without touching any edge or end wall (first flight)
    double T() const { return wSum > 0 ? wT / wSum : 0; }
    // Standard error of T from the sample-to-sample scatter. For Monte Carlo
    // this is exactly the binomial sqrt(T(1-T)/n); for the flux engine it is
    // the (conservative, unstratified) node variance, which includes roulette
    // and scattering randomness.
    double sigmaT() const {
        if (wSum <= 0 || n < 2) return 0;
        const double t = T();
        const double var = (s1 - 2 * t * s2 + t * t * s3) / (wSum * wSum);
        return std::sqrt(std::max(0.0, var));
    }
    void add(const PointResult &o) {
        n += o.n; wT += o.wT; wR += o.wR; wLost += o.wLost; wCapped += o.wCapped; wDropped += o.wDropped; wSum += o.wSum;
        s1 += o.s1; s2 += o.s2; s3 += o.s3;
        sumPath += o.sumPath; sumCross += o.sumCross; edgeTouched += o.edgeTouched; rays += o.rays; rouletted += o.rouletted; labelErrors += o.labelErrors; directT += o.directT;
    }
};

inline RayState initialRay(const Device &dv, double y0, double theta0) {
    // With skewed junctions the first junction line can reach the contact at x = 0
    // (tan(skew) W/2 > L_1): the injection point is then in a later cell.
    RayState r; r.x = 0; r.y = y0; r.phi = theta0; r.cell = cellAt(dv, 0, y0); r.path = 0;
    return r;
}

// trajectories [i0, i1) — order-independent, so callers may split across threads
inline PointResult runMC(const Device &dv, double B, uint64_t seed, long i0, long i1, PathSink *sink = nullptr, int sinkEvery = 0) {
    PointResult pr;
    for (long i = i0; i < i1; ++i) {
        Rng rng(Rng::streamSeed(seed, static_cast<uint64_t>(i)));
        double y0, th0; injectSample(dv, rng, y0, th0);
        TraceStats st;
        PathSink *ps = (sink && sinkEvery > 0 && i % sinkEvery == 0) ? sink : nullptr;
        const Fate f = traceMC(dv, B, initialRay(dv, y0, th0), rng, &st, ps);
        if (ps) { ps->xy.push_back(std::numeric_limits<float>::quiet_NaN()); ps->xy.push_back(static_cast<float>(static_cast<int>(f))); }
        ++pr.n; pr.wSum += 1; pr.s3 += 1;
        switch (f) { case Fate::Transmitted: pr.wT += 1; pr.s1 += 1; pr.s2 += 1; break; case Fate::Reflected: pr.wR += 1; break; case Fate::Lost: pr.wLost += 1; break; default: pr.wCapped += 1; }
        pr.sumPath += st.path; pr.sumCross += st.crossings; if (st.edgeHits) ++pr.edgeTouched; pr.labelErrors += st.labelErrors;
        if (f == Fate::Transmitted && st.edgeHits == 0) ++pr.directT;
    }
    return pr;
}

// Density map + fates for trajectories [i0, i1) (same streams as runMC).
inline PointResult runDensity(const Device &dv, double B, uint64_t seed, long i0, long i1, DensityGrid &grid) {
    PointResult pr;
    for (long i = i0; i < i1; ++i) {
        Rng rng(Rng::streamSeed(seed, static_cast<uint64_t>(i)));
        double y0, th0; injectSample(dv, rng, y0, th0);
        TraceStats st;
        const Fate f = traceMC(dv, B, initialRay(dv, y0, th0), rng, &st, nullptr, nullptr, &grid);
        ++pr.n; pr.wSum += 1; pr.s3 += 1;
        switch (f) { case Fate::Transmitted: pr.wT += 1; pr.s1 += 1; pr.s2 += 1; break; case Fate::Reflected: pr.wR += 1; break; case Fate::Lost: pr.wLost += 1; break; default: pr.wCapped += 1; }
        pr.sumPath += st.path; pr.sumCross += st.crossings; if (st.edgeHits) ++pr.edgeTouched;
        if (f == Fate::Transmitted && st.edgeHits == 0) ++pr.directT;
    }
    return pr;
}

// Quadrature nodes for the flux engine: a tensor grid uniform in y and in
// s = sin(theta) (so that the cos-theta flux weighting is built in), midpoint
// rule, optionally jittered within each cell with the node's own stream.
struct FluxGrid { int nY = 32, nS = 129; bool jitter = false; long nodes() const { return static_cast<long>(nY) * nS; } };

inline PointResult runFlux(const Device &dv, double B, uint64_t seed, const FluxGrid &g, long n0, long n1) {
    PointResult pr;
    for (long idx = n0; idx < n1; ++idx) {
        const int iy = static_cast<int>(idx / g.nS), is = static_cast<int>(idx % g.nS);
        Rng rng(Rng::streamSeed(seed, static_cast<uint64_t>(idx), 7));
        const double fy = (iy + (g.jitter ? rng.next() : 0.5)) / g.nY;
        const double fs = (is + (g.jitter ? rng.next() : 0.5)) / g.nS;
        const double y0 = 0.5 * (dv.W - dv.aperture) + dv.aperture * fy;
        double th0, wNode = 1;
        if (dv.injection == Injection::Collimated) {
            // Gaussian in theta on [-4 sigma, 4 sigma], weights normalised below
            const double th = (-4 + 8 * fs) * dv.collimSigma;
            if (std::abs(th) >= 0.5 * PI) { ++pr.n; continue; }   // outside the half plane: no carrier (zero weight)
            th0 = th;
            wNode = std::exp(-0.5 * sqr(th / dv.collimSigma));
        } else th0 = std::asin(-1 + 2 * fs);
        FluxTally t;
        traceFlux(dv, B, initialRay(dv, y0, th0), Rng::streamSeed(seed, static_cast<uint64_t>(idx), 11), t);
        ++pr.n; pr.wSum += wNode; pr.rays += t.rays; pr.rouletted += t.rouletted;
        pr.s1 += sqr(wNode * t.T); pr.s2 += wNode * wNode * t.T; pr.s3 += wNode * wNode;
        pr.wT += wNode * t.T; pr.wR += wNode * t.R; pr.wLost += wNode * t.lost; pr.wCapped += wNode * t.capped; pr.wDropped += wNode * t.dropped;
    }
    return pr;
}

// ============================================================ 5. thermal + Landauer
struct EnergyNode { double eps, w; };

// Gauss quadrature for the thermal weight -df/dE = sech^2(eps/2kT)/(4kT):
// recurrence coefficients by the discretised Stieltjes procedure on a fine
// grid, nodes/weights from the Jacobi matrix (implicit QL). Exact for any
// polynomial T(eps) of degree <= 2n-1, so n = 5 already captures the Fermi
// window to its 9th moment. Gate G8a checks the 2nd and 4th moments.
inline void tqli(std::vector<double> &d, std::vector<double> &e, std::vector<double> &z0) {
    // symmetric tridiagonal eigenproblem; z0 receives the first components of the eigenvectors
    const int n = static_cast<int>(d.size());
    std::vector<std::vector<double>> z(n, std::vector<double>(n, 0.0));
    for (int i = 0; i < n; ++i) z[i][i] = 1;
    e.push_back(0);
    for (int l = 0; l < n; ++l) {
        int iter = 0, m;
        do {
            for (m = l; m < n - 1; ++m) { const double dd = std::abs(d[m]) + std::abs(d[m + 1]); if (std::abs(e[m]) <= 1e-15 * dd) break; }
            if (m != l) {
                if (iter++ == 60) break;
                double g = (d[l + 1] - d[l]) / (2 * e[l]);
                double r = std::hypot(g, 1.0);
                g = d[m] - d[l] + e[l] / (g + (g >= 0 ? std::abs(r) : -std::abs(r)));
                double sn = 1, c = 1, pp = 0;
                int i;
                for (i = m - 1; i >= l; --i) {
                    double f = sn * e[i], bb = c * e[i];
                    e[i + 1] = (r = std::hypot(f, g));
                    if (r == 0) { d[i + 1] -= pp; e[m] = 0; break; }
                    sn = f / r; c = g / r;
                    g = d[i + 1] - pp;
                    r = (d[i] - g) * sn + 2 * c * bb;
                    d[i + 1] = g + (pp = sn * r);
                    g = c * r - bb;
                    for (int k = 0; k < n; ++k) { f = z[k][i + 1]; z[k][i + 1] = sn * z[k][i] + c * f; z[k][i] = c * z[k][i] - sn * f; }
                }
                if (r == 0 && i >= l) continue;
                d[l] -= pp; e[l] = g; e[m] = 0;
            }
        } while (m != l);
    }
    z0.assign(n, 0.0);
    for (int i = 0; i < n; ++i) z0[i] = z[0][i];
}

inline std::vector<EnergyNode> energyNodes(double tempK, int n) {
    std::vector<EnergyNode> out;
    const double kT = K_BOLTZ * std::max(tempK, 0.0);
    if (n <= 1 || kT <= 0) { out.push_back({0, 1}); return out; }
    n = std::min(n, 40);
    // fine grid of the weight (in units of kT; the result is scaled back)
    const int M = 8001; const double L = 40;
    std::vector<double> x(M), w(M);
    for (int i = 0; i < M; ++i) { x[i] = -L + 2 * L * i / (M - 1.0); const double c = std::cosh(0.5 * x[i]); w[i] = 0.25 / (c * c); }
    double wsum = 0; for (double v : w) wsum += v; for (double &v : w) v /= wsum;
    // Stieltjes
    std::vector<double> alpha(n), beta(n), p0(M, 0.0), p1(M, 1.0);
    double norm1 = 1, norm0 = 1;
    for (int k = 0; k < n; ++k) {
        double num = 0; norm1 = 0;
        for (int i = 0; i < M; ++i) { num += w[i] * x[i] * p1[i] * p1[i]; norm1 += w[i] * p1[i] * p1[i]; }
        alpha[k] = num / norm1;
        beta[k] = k == 0 ? 1 : norm1 / norm0;
        for (int i = 0; i < M; ++i) { const double p2 = (x[i] - alpha[k]) * p1[i] - (k == 0 ? 0 : beta[k] * p0[i]); p0[i] = p1[i]; p1[i] = p2; }
        norm0 = norm1;
    }
    std::vector<double> d(alpha), e(n - 1), z0;
    for (int k = 1; k < n; ++k) e[k - 1] = std::sqrt(beta[k]);
    tqli(d, e, z0);
    for (int i = 0; i < n; ++i) out.push_back({kT * d[i], z0[i] * z0[i]});
    double sum = 0; for (auto &q : out) sum += q.w; for (auto &q : out) q.w /= sum;
    std::sort(out.begin(), out.end(), [](const EnergyNode &a, const EnergyNode &b) { return a.eps < b.eps; });
    return out;
}

inline double conductance(int modes, double T) { return G0 * modes * T; }

} // namespace klein
