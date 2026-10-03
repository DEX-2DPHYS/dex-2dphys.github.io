// reference_engine.h — VERBATIM C++ port of the June-2026 KMclaude engine
// (00 VSCODE/Klein magnetometer/analysis/engine.js, itself a verbatim port of
// KMclaude_parabola_sensitivity.html plus the three documented mechanisms:
// sidewall specularity, e-e beam dispersion, Matthiessen e-p mean free path).
//
// This file exists for ONE purpose: validation. It is the fixed-timestep,
// accept/reject Monte-Carlo tracer whose numbers are in the June report, and
// gate G2 requires this port to reproduce those numbers with the same seeds.
// The production engines live in klein_physics.h and are gated against this.
//
// Porting rules, so that the random stream and the branch decisions match
// the JavaScript bit for bit where the C library allows:
//   * every rng draw happens in the same place and order as in engine.js,
//     including draws whose result is discarded;
//   * double arithmetic is written in the same order as the JS expressions;
//   * compile WITHOUT -ffast-math and WITH -ffp-contract=off.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace kref {

constexpr double E_CHARGE = 1.602176634e-19;
constexpr double H_PLANCK = 6.62607015e-34;
constexpr double HBAR = 1.054571817e-34;
constexpr double PI = 3.141592653589793;
constexpr double JS_EPSILON = 2.220446049250313e-16;

// ---- RNG (mulberry32, verbatim) ------------------------------------
struct Mulberry32 {
    uint32_t state;
    explicit Mulberry32(uint32_t seed) : state(seed) {}
    double next() {
        state += 0x6d2b79f5u;
        uint32_t t = state;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + (t ^ (t >> 7)) * (t | 61u);
        return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
    }
};

struct Rng {
    Mulberry32 u;
    bool hasSpare = false;
    double spare = 0;
    explicit Rng(uint32_t seed) : u(seed) {}
    double uniform(double lo = 0, double hi = 1) { return lo + (hi - lo) * u.next(); }
    double normal(double mean = 0, double sigma = 1) {
        if (hasSpare) {
            hasSpare = false;
            return mean + sigma * spare;
        }
        double u1 = 0;
        while (u1 <= JS_EPSILON) u1 = u.next();
        const double u2 = u.next();
        const double mag = std::sqrt(-2 * std::log(u1));
        const double z0 = mag * std::cos(2 * PI * u2);
        const double z1 = mag * std::sin(2 * PI * u2);
        spare = z1;
        hasSpare = true;
        return mean + sigma * z0;
    }
};

// seed = (cfg.seed + 2654435761 * (trajIndex + 1) + 7919 * (bIndex + 1)) >>> 0
inline uint32_t trajectorySeed(uint32_t seed, int trajIndex, int bIndex) {
    const uint64_t v = static_cast<uint64_t>(seed)
                     + 2654435761ull * static_cast<uint64_t>(trajIndex + 1)
                     + 7919ull * static_cast<uint64_t>(bIndex + 1);
    return static_cast<uint32_t>(v & 0xffffffffull);
}

// ---- config (mirrors finalizeConfig) --------------------------------
struct Cfg {
    int nUnits = 40;
    double sectionLengthM = 5e-7;
    double stripWidthM = 2e-6;
    double nDensityM2 = 1e16;
    double pDensityM2 = 1e16;
    double junctionWidthM = 10e-9;
    double junctionAngleDeg = 0;
    double vFermiMS = 1e6;
    double meanFreePathM = 2e-6;
    double dtS = 1e-14;
    double maxPathFactor = 6;
    std::string scatteringModel = "forward";
    double forwardSigmaDeg = 10;
    uint32_t seed = 13;
    double edgeSpecularity = 1.0;
    double eeMfpM = 0;
    double eeSigmaDeg = 0;
    // derived
    double totalLengthM = 0, maxTimeS = 0;
    int maxSteps = 0;
    double junctionAngleRad = 0, junctionSkewSlope = 0;
    double junctionNormalX = 1, junctionNormalY = 0, junctionTangentX = 0, junctionTangentY = 1;

    void finalize() {
        totalLengthM = nUnits * sectionLengthM;
        maxTimeS = (maxPathFactor * totalLengthM) / vFermiMS;
        maxSteps = std::max(16, static_cast<int>(std::ceil(maxTimeS / dtS)));
        junctionAngleRad = junctionAngleDeg * PI / 180;
        junctionSkewSlope = std::tan(junctionAngleRad);
        junctionNormalX = std::cos(junctionAngleRad);
        junctionNormalY = -std::sin(junctionAngleRad);
        junctionTangentX = std::sin(junctionAngleRad);
        junctionTangentY = std::cos(junctionAngleRad);
    }
};

// ---- region / band bookkeeping (verbatim) ---------------------------
inline double densityForRegion(int index, const Cfg &cfg) { return index % 2 == 0 ? cfg.nDensityM2 : cfg.pDensityM2; }
inline bool regionIsN(int index) { return index % 2 == 0; }
inline double kfFromDensity(double densityM2) { return std::sqrt(PI * std::max(densityM2, 0.0)); }
inline double signedKfForRegion(int index, const Cfg &cfg) {
    const double kf = kfFromDensity(densityForRegion(index, cfg));
    return regionIsN(index) ? kf : -kf;
}
inline int chargeSignForRegion(int index) { return regionIsN(index) ? -1 : 1; }
inline int bandSignForRegion(int index) { return regionIsN(index) ? 1 : -1; }
inline int clampRegionIndex(int index, int nUnits) { return std::max(0, std::min(nUnits - 1, index)); }
inline double sectionCoordinateU(double x, double y, const Cfg &cfg) { return x - cfg.junctionSkewSlope * (y - 0.5 * cfg.stripWidthM); }
inline double sectionVelocityU(double vx, double vy, const Cfg &cfg) { return vx - cfg.junctionSkewSlope * vy; }
inline int regionIndexAtPosition(double x, double y, const Cfg &cfg) {
    const double u = sectionCoordinateU(x, y, cfg);
    return clampRegionIndex(static_cast<int>(std::floor(u / cfg.sectionLengthM)), cfg.nUnits);
}
inline double boundaryXAtY(double boundaryU, double y, const Cfg &cfg) { return boundaryU + cfg.junctionSkewSlope * (y - 0.5 * cfg.stripWidthM); }
inline double junctionNormalVelocity(double vx, double vy, const Cfg &cfg) { return vx * cfg.junctionNormalX + vy * cfg.junctionNormalY; }
inline double junctionTangentVelocity(double vx, double vy, const Cfg &cfg) { return vx * cfg.junctionTangentX + vy * cfg.junctionTangentY; }
inline void reflectAcrossJunction(double &vx, double &vy, const Cfg &cfg) {
    const double vNormal = junctionNormalVelocity(vx, vy, cfg);
    const double nvx = vx - 2 * vNormal * cfg.junctionNormalX;
    const double nvy = vy - 2 * vNormal * cfg.junctionNormalY;
    vx = nvx; vy = nvy;
}

// ---- Klein transmission (verbatim asymptotic formula) ---------------
inline double kleinTransmission(double theta, double kfIncident, double gradKf) {
    if (gradKf <= 0 || kfIncident <= 0) return std::abs(theta) < 1e-9 ? 1.0 : 0.0;
    const double s = std::sin(theta);
    const double sin2 = s * s;
    const double exponent = -PI * (kfIncident * kfIncident) * sin2 / gradKf;
    if (exponent < -700) return 0;
    return std::max(0.0, std::min(1.0, std::exp(exponent)));
}

inline double sampleThetaCosWeighted(Rng &rng) {
    const double u = rng.uniform();
    return std::asin(2 * u - 1);
}

// ---- rough sidewall (Lambertian with specularity p) -----------------
struct EdgeStats { bool edge = false; int bounces = 0; };

inline void reflectYRough(double &y, double &vx, double &vy, const Cfg &cfg, Rng *rng, EdgeStats *stats) {
    const double width = cfg.stripWidthM;
    bool bounced = false;
    int inwardSign = 1;
    while (y < 0 || y > width) {
        if (y < 0) { y = -y; vy = -vy; bounced = true; inwardSign = 1; }
        else { y = 2 * width - y; vy = -vy; bounced = true; inwardSign = -1; }
    }
    if (bounced && stats) { stats->edge = true; stats->bounces += 1; }
    if (bounced && rng && cfg.edgeSpecularity < 1 && rng->uniform() >= cfg.edgeSpecularity) {
        const double beta = std::asin(2 * rng->uniform() - 1);
        vy = inwardSign * cfg.vFermiMS * std::cos(beta);
        vx = cfg.vFermiMS * std::sin(beta);
    }
}

// ---- bulk momentum-relaxing scattering ------------------------------
inline void maybeScatter(double &vx, double &vy, const Cfg &cfg, Rng &rng, double pScatter, double sigmaForward) {
    if (rng.uniform() >= pScatter) return;
    double angle;
    if (cfg.scatteringModel == "drude") angle = rng.uniform(0, 2 * PI);
    else angle = std::atan2(vy, vx) + rng.normal(0, sigmaForward);
    vx = cfg.vFermiMS * std::cos(angle);
    vy = cfg.vFermiMS * std::sin(angle);
}

// ---- e-e beam dispersion (non-momentum-relaxing) --------------------
inline void maybeDisperseEE(double &vx, double &vy, const Cfg &cfg, Rng &rng, double pEE, double sigmaEE) {
    if (pEE <= 0 || rng.uniform() >= pEE) return;
    const double angle = std::atan2(vy, vx) + rng.normal(0, sigmaEE);
    vx = cfg.vFermiMS * std::cos(angle);
    vy = cfg.vFermiMS * std::sin(angle);
}

// ---- magnetic rotation ----------------------------------------------
struct Rotated { double vx, vy, cHalf, sHalf; bool rotated; };

inline Rotated applyMagneticRotation(double vx, double vy, int regionIndex, double bT, double dtLocalS, const Cfg &cfg) {
    const double density = densityForRegion(regionIndex, cfg);
    const double kf = kfFromDensity(density);
    if (std::abs(bT) < 1e-18 || kf <= 1e4) return {vx, vy, 1, 0, false};
    const int qSign = chargeSignForRegion(regionIndex);
    const double omega = qSign * E_CHARGE * cfg.vFermiMS * bT / (HBAR * kf);
    const double dPhi = omega * dtLocalS;
    const double c = std::cos(dPhi);
    const double s = std::sin(dPhi);
    return {vx * c - vy * s, vx * s + vy * c, std::cos(0.5 * dPhi), std::sin(0.5 * dPhi), true};
}

// ---- Veselago refraction --------------------------------------------
// returns false on total internal reflection (velocity untouched)
inline bool refractGraphene(double &vx, double &vy, int sIn, double kIn, int sOut, double kOut, double vF, int desiredNormalSign, const Cfg &cfg) {
    const double vTangential = junctionTangentVelocity(vx, vy, cfg);
    const double kTangential = (kIn / vF) * (vTangential / sIn);
    if (std::abs(kTangential) > kOut) return false;
    double kNormal = std::sqrt(std::max(0.0, kOut * kOut - kTangential * kTangential));
    const int sgnDesired = desiredNormalSign == 0 ? 1 : (desiredNormalSign > 0 ? 1 : -1);
    const int sgnOut = sOut == 0 ? 1 : (sOut > 0 ? 1 : -1);
    kNormal *= sgnDesired * sgnOut;
    const double vNormalOut = sOut * vF * (kNormal / kOut);
    const double vTangentialOut = sOut * vF * (kTangential / kOut);
    vx = vNormalOut * cfg.junctionNormalX + vTangentialOut * cfg.junctionTangentX;
    vy = vNormalOut * cfg.junctionNormalY + vTangentialOut * cfg.junctionTangentY;
    return true;
}

// ---- single integration step (verbatim) -----------------------------
struct State { double x, y, vx, vy; };
struct StepResult { bool done; bool transmitted; };

inline StepResult performOneStep(State &st, const Cfg &cfg, Rng &rng, double bT, double pScatter, double sigmaForward,
                                 double pEE, double sigmaEE, EdgeStats *stats = nullptr) {
    double x = st.x, y = st.y, vx = st.vx, vy = st.vy;

    maybeScatter(vx, vy, cfg, rng, pScatter, sigmaForward);
    if (pEE > 0) maybeDisperseEE(vx, vy, cfg, rng, pEE, sigmaEE);

    double dtRemain = cfg.dtS;
    for (int sub = 0; sub < 6 && dtRemain > 0; ++sub) {
        const int currentRegion = regionIndexAtPosition(x, y, cfg);
        const double uNow = sectionCoordinateU(x, y, cfg);
        const double duDt = sectionVelocityU(vx, vy, cfg);
        const bool movingForward = duDt > 0;
        const double boundaryU = movingForward ? (currentRegion + 1) * cfg.sectionLengthM : currentRegion * cfg.sectionLengthM;

        const bool validBoundary = boundaryU > 0 && boundaryU < cfg.totalLengthM;
        double tBoundary = std::numeric_limits<double>::infinity();
        if (validBoundary && std::abs(duDt) > 1e-18) {
            const double candidate = (boundaryU - uNow) / duDt;
            if (std::isfinite(candidate) && candidate > 1e-18) tBoundary = candidate;
        }

        const bool hitBoundary = tBoundary <= dtRemain;
        const double dtLocalS = hitBoundary ? tBoundary : dtRemain;
        if (!std::isfinite(dtLocalS) || dtLocalS <= 0) break;

        const Rotated rot = applyMagneticRotation(vx, vy, currentRegion, bT, dtLocalS, cfg);
        double vxMid = vx, vyMid = vy;
        if (rot.rotated) {
            vxMid = vx * rot.cHalf - vy * rot.sHalf;
            vyMid = vx * rot.sHalf + vy * rot.cHalf;
        }
        vx = rot.vx;
        vy = rot.vy;

        const double xAttempt = x + vxMid * dtLocalS;
        double yAttempt = y + vyMid * dtLocalS;

        reflectYRough(yAttempt, vx, vy, cfg, &rng, stats);

        if (xAttempt >= cfg.totalLengthM) { st = {cfg.totalLengthM, yAttempt, vx, vy}; return {true, true}; }
        if (xAttempt <= 0) { st = {0, yAttempt, vx, vy}; return {true, false}; }

        if (!hitBoundary) {
            x = xAttempt;
            y = yAttempt;
            dtRemain = 0;
            break;
        }

        x = boundaryXAtY(boundaryU, yAttempt, cfg);
        y = yAttempt;

        const int leftRegion = clampRegionIndex(currentRegion, cfg.nUnits);
        const int rightRegion = clampRegionIndex(currentRegion + (movingForward ? 1 : -1), cfg.nUnits);
        const int sIn = bandSignForRegion(leftRegion);
        const int sOut = bandSignForRegion(rightRegion);
        const double kIn = kfFromDensity(densityForRegion(leftRegion, cfg));
        const double kOut = kfFromDensity(densityForRegion(rightRegion, cfg));
        const double kfInSigned = signedKfForRegion(leftRegion, cfg);
        const double kfOutSigned = signedKfForRegion(rightRegion, cfg);
        const double kfIn = std::abs(kfInSigned);
        const double gradKf = std::abs(kfOutSigned - kfInSigned) / cfg.junctionWidthM;

        const double vNormalIn = junctionNormalVelocity(vx, vy, cfg);
        const double vTangentialIn = junctionTangentVelocity(vx, vy, cfg);
        const double theta = std::atan2(std::abs(vTangentialIn), std::abs(vNormalIn));
        const double Tnp = kleinTransmission(theta, kfIn, gradKf);

        if (rng.uniform() > Tnp) {
            reflectAcrossJunction(vx, vy, cfg);
        } else {
            if (!refractGraphene(vx, vy, sIn, kIn, sOut, kOut, cfg.vFermiMS, movingForward ? 1 : -1, cfg))
                reflectAcrossJunction(vx, vy, cfg);
        }

        const int nudgeSign = junctionNormalVelocity(vx, vy, cfg) >= 0 ? 1 : -1;
        x += nudgeSign * 1e-13 * cfg.junctionNormalX;
        y += nudgeSign * 1e-13 * cfg.junctionNormalY;
        reflectYRough(y, vx, vy, cfg, &rng, stats);
        dtRemain -= dtLocalS;
    }

    st = {x, y, vx, vy};
    return {false, false};
}

// ---- rates (mirrors simulateEnsemble's preamble) --------------------
struct Rates { double pScatter, sigmaForward, pEE, sigmaEE; };
inline Rates ratesFor(const Cfg &cfg) {
    const double tauS = cfg.meanFreePathM / cfg.vFermiMS;
    Rates r;
    r.pScatter = 1 - std::exp(-cfg.dtS / tauS);
    r.sigmaForward = cfg.forwardSigmaDeg * PI / 180;
    r.pEE = (cfg.eeMfpM > 0 && std::isfinite(cfg.eeMfpM)) ? 1 - std::exp(-cfg.dtS / (cfg.eeMfpM / cfg.vFermiMS)) : 0;
    r.sigmaEE = cfg.eeSigmaDeg * PI / 180;
    return r;
}

// one trajectory; returns true if transmitted
inline bool traceOne(const Cfg &cfg, const Rates &r, double bT, int trajIndex, int bIndex, std::vector<State> *path = nullptr) {
    Rng rng(trajectorySeed(cfg.seed, trajIndex, bIndex));
    const double theta0 = sampleThetaCosWeighted(rng);
    State st{1e-13, rng.uniform(0, cfg.stripWidthM), cfg.vFermiMS * std::cos(theta0), cfg.vFermiMS * std::sin(theta0)};
    if (path) path->push_back(st);
    for (int step = 0; step < cfg.maxSteps; ++step) {
        const StepResult res = performOneStep(st, cfg, rng, bT, r.pScatter, r.sigmaForward, r.pEE, r.sigmaEE);
        if (path) path->push_back(st);
        if (res.done) return res.transmitted;
    }
    return false;
}

// ensemble: serial, verbatim order (count = number of trajectories)
inline long simulateEnsemble(const Cfg &cfg, double bT, int startIndex, int count, int bIndex) {
    const Rates r = ratesFor(cfg);
    long transmitted = 0;
    for (int i = 0; i < count; ++i) if (traceOne(cfg, r, bT, startIndex + i, bIndex)) ++transmitted;
    return transmitted;
}

// ---- Landauer / stats (verbatim) ------------------------------------
inline int numberModes(const Cfg &cfg) {
    const double kfN = kfFromDensity(cfg.nDensityM2);
    const double kfP = kfFromDensity(cfg.pDensityM2);
    const double kfLimiting = std::min(kfN, kfP);
    const int modes = static_cast<int>(std::floor((kfLimiting * cfg.stripWidthM) / PI));
    return std::max(modes, 0);
}
inline double conductanceFromTransmission(double transmission, int nModes) {
    return (4 * E_CHARGE * E_CHARGE / H_PLANCK) * transmission * nModes;
}
struct PointStats { double G, R, sigmaT, sigmaR; };
inline PointStats statsForPoint(double transmission, int nModes, int nTraj) {
    const double G = conductanceFromTransmission(transmission, nModes);
    const double R = G > 0 ? 1 / G : std::numeric_limits<double>::infinity();
    const double sigmaT = std::sqrt(std::max(0.0, transmission * (1 - transmission)) / std::max(1, nTraj));
    double sigmaR = 0;
    if (transmission > 0 && std::isfinite(R)) sigmaR = R * sigmaT / transmission;
    return {G, R, sigmaT, sigmaR};
}

// ---- even-parabola fit + sensitivity (verbatim) ---------------------
struct Fit { double a = 0, b = 0, c = 0; bool ok = false; };
inline Fit fitEvenParabola(const std::vector<double> &xs, const std::vector<double> &ys) {
    Fit f;
    if (xs.size() < 2) return f;
    double s0 = 0, s2 = 0, s4 = 0, t0 = 0, t2 = 0;
    for (size_t i = 0; i < xs.size(); ++i) {
        const double x = xs[i], y = ys[i];
        if (!std::isfinite(x) || !std::isfinite(y)) continue;
        const double x2 = x * x;
        s0 += 1; s2 += x2; s4 += x2 * x2; t0 += y; t2 += x2 * y;
    }
    if (s0 < 2) return f;
    const double det = s4 * s0 - s2 * s2;
    if (std::abs(det) < 1e-30) return f;
    f.a = (t2 * s0 - t0 * s2) / det;
    f.c = (s4 * t0 - s2 * t2) / det;
    f.ok = true;
    return f;
}
inline double evalQuad(const Fit &f, double x) { return f.ok ? f.a * x * x + f.b * x + f.c : std::numeric_limits<double>::quiet_NaN(); }

struct Parabolic {
    Fit negativeFit, positiveFit, globalFit;
    double commonR0 = std::numeric_limits<double>::quiet_NaN();
    std::vector<double> sensitivity;
    double maxAbsSensitivity = std::numeric_limits<double>::quiet_NaN();
    double maxAbsSensitivityB = std::numeric_limits<double>::quiet_NaN();
};
inline Parabolic computeParabolicSensitivity(const std::vector<double> &bVals, const std::vector<double> &rVals) {
    Parabolic out;
    std::vector<double> xn, yn, xp, yp, xa, ya;
    for (size_t i = 0; i < bVals.size(); ++i) {
        if (!std::isfinite(bVals[i]) || !std::isfinite(rVals[i])) continue;
        xa.push_back(bVals[i]); ya.push_back(rVals[i]);
        if (bVals[i] <= 0) { xn.push_back(bVals[i]); yn.push_back(rVals[i]); }
        if (bVals[i] >= 0) { xp.push_back(bVals[i]); yp.push_back(rVals[i]); }
    }
    out.negativeFit = fitEvenParabola(xn, yn);
    out.positiveFit = fitEvenParabola(xp, yp);
    const double negativeR0 = evalQuad(out.negativeFit, 0);
    const double positiveR0 = evalQuad(out.positiveFit, 0);
    out.globalFit = fitEvenParabola(xa, ya);
    double commonR0 = evalQuad(out.globalFit, 0);
    if (!std::isfinite(commonR0) || commonR0 == 0) {
        double sum = 0; int n = 0;
        for (double v : {negativeR0, positiveR0}) if (std::isfinite(v) && v != 0) { sum += v; ++n; }
        commonR0 = n ? sum / n : std::numeric_limits<double>::quiet_NaN();
    }
    out.commonR0 = commonR0;
    out.sensitivity.assign(bVals.size(), std::numeric_limits<double>::quiet_NaN());
    const bool canNormalize = std::isfinite(commonR0) && commonR0 != 0;
    for (size_t i = 0; i < bVals.size(); ++i) {
        const double b = bVals[i];
        if (!std::isfinite(b)) continue;
        if (b <= 0 && out.negativeFit.ok && canNormalize) out.sensitivity[i] = (2 * out.negativeFit.a * b) / commonR0;
        if (b >= 0 && out.positiveFit.ok && canNormalize) out.sensitivity[i] = (2 * out.positiveFit.a * b) / commonR0;
        if (b == 0 && std::isfinite(out.sensitivity[i])) out.sensitivity[i] = 0;
        const double v = out.sensitivity[i];
        if (std::isfinite(v) && (!std::isfinite(out.maxAbsSensitivity) || std::abs(v) > std::abs(out.maxAbsSensitivity))) {
            out.maxAbsSensitivity = v; out.maxAbsSensitivityB = b;
        }
    }
    return out;
}

struct Diagnostics {
    double maxSlope = 0, maxSlopeB = std::numeric_limits<double>::quiet_NaN();
    double deltaBmin = std::numeric_limits<double>::infinity();
    double fwhm = std::numeric_limits<double>::quiet_NaN();
};
inline Diagnostics computeDiagnostics(const std::vector<double> &bVals, const std::vector<double> &rVals, const std::vector<double> &rErr) {
    Diagnostics out;
    const int n = static_cast<int>(bVals.size());
    for (int i = 1; i < n - 1; ++i) {
        const double r0 = rVals[i - 1], r2 = rVals[i + 1], db = bVals[i + 1] - bVals[i - 1];
        if (!std::isfinite(r0) || !std::isfinite(r2) || db == 0) continue;
        const double slope = std::abs((r2 - r0) / db);
        if (slope > out.maxSlope) {
            out.maxSlope = slope; out.maxSlopeB = bVals[i];
            const double err = (i < static_cast<int>(rErr.size()) && std::isfinite(rErr[i])) ? rErr[i] : 0;
            out.deltaBmin = slope > 0 ? err / slope : std::numeric_limits<double>::infinity();
        }
    }
    std::vector<double> finite;
    for (double v : rVals) if (std::isfinite(v)) finite.push_back(v);
    if (finite.size() > 2) {
        const double rmin = *std::min_element(finite.begin(), finite.end());
        const double rmax = *std::max_element(finite.begin(), finite.end());
        int imin = 0; double vmin = std::numeric_limits<double>::infinity();
        for (int i = 0; i < n; ++i) if (std::isfinite(rVals[i]) && rVals[i] < vmin) { vmin = rVals[i]; imin = i; }
        const double half = rmin + 0.5 * (rmax - rmin);
        auto crossB = [&](int iCenter, int dir) -> double {
            for (int i = iCenter; i >= 0 && i < n; i += dir) {
                const int iNext = i + dir;
                if (iNext < 0 || iNext >= n) return std::numeric_limits<double>::quiet_NaN();
                const double ra = rVals[i], rb = rVals[iNext];
                if (!std::isfinite(ra) || !std::isfinite(rb)) continue;
                if ((ra - half) * (rb - half) <= 0 && ra != rb) {
                    const double frac = (half - ra) / (rb - ra);
                    return bVals[i] + frac * (bVals[iNext] - bVals[i]);
                }
            }
            return std::numeric_limits<double>::quiet_NaN();
        };
        const double bLeft = crossB(imin, -1), bRight = crossB(imin, 1);
        if (std::isfinite(bLeft) && std::isfinite(bRight)) out.fwhm = std::abs(bRight - bLeft);
    }
    return out;
}

// mobility (m^2/Vs) <-> mean free path (m): mu = e*mfp/(hbar*kF)
inline double mfpFromMobility(double muM2Vs, double densityM2) { return muM2Vs * HBAR * kfFromDensity(densityM2) / E_CHARGE; }
inline double mobilityFromMfp(double mfpM, double densityM2) { return mfpM * E_CHARGE / (HBAR * kfFromDensity(densityM2)); }

} // namespace kref
