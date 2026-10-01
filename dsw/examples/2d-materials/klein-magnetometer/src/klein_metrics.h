// klein_metrics.h — figures of merit of a magnetoresistance curve R(B) and
// the readout-noise model that turns them into a field resolution.
//
//   * R0, curvature: even parabola R = R0 + a B^2, (i) global fit over the
//     whole window (the June-report method, kept for continuity) and (ii) a
//     local fit over |B| <= fitWindow;
//   * dR/dB by local weighted quadratic least squares (Savitzky–Golay on a
//     possibly non-uniform grid), peak slope and its field;
//   * FWHM of the dip, MR depth, T(0);
//   * noise: S_V = 4 k T R (Johnson) + 2 e I R^2 (shot) + alpha_H (I R)^2 / (N_c f)
//     (Hooge 1/f, optional); flank resolution sqrt(S_V) / (I |dR/dB|) in
//     T/sqrt(Hz); vertex (parabolic) resolution sqrt(deltaR / a) with
//     deltaR = sqrt(S_V) / I in a 1 Hz bandwidth.
#pragma once
#include "klein_physics.h"
#include <cmath>
#include <limits>
#include <vector>

namespace klein {

struct NoiseParams {
    double biasA = 10e-6;     // bias current
    double tempK = 20;        // electron temperature for Johnson noise
    double hooge = 0;         // Hooge parameter alpha_H (0 = no 1/f term)
    double freqHz = 1;        // frequency at which the 1/f term is evaluated
    double carriers = 1;      // N_c for the Hooge term (set by the runner)
};

struct CurveMetrics {
    double R0global = NAN, aGlobal = NAN;   // even parabola over the whole window
    double R0local = NAN, aLocal = NAN;     // over |B| <= fitWindow
    double R0 = NAN;                         // the R0 used for normalisation (local if available)
    double curvNorm = NAN;                   // a / R0  (1/T^2)
    double T0 = NAN, Rmin = NAN, Rmax = NAN, mrDepth = NAN, fwhm = NAN;
    double peakSlope = NAN, peakSlopeB = NAN, peakSens = NAN; // Ohm/T, T, 1/T  (true local slope)
    double peakSensParabola = NAN;           // 2 |a_global| B_max / R0: the June-report definition, kept for continuity
    double flankR = NAN;                     // R at the peak-slope point
    bool peakAtEdge = false;
    double mrField = NAN, mrAt = NAN;        // MR(B*) = <R(+-B*)>/R(B~0) - 1 at the chosen field
    double mrEdge = NAN;                     // the same at the edge of the field window
    double cappedOverT = NAN;                // worst capped fraction / T over the curve (cap convergence)                 // the steepest interior point is the last one: the slope is still rising at the window edge
    double sv = NAN;                         // V^2/Hz at the flank
    double bMinFlank = NAN;                  // T/sqrt(Hz)
    double bMinVertex = NAN;                 // T (1 Hz bandwidth)
    double johnson = NAN, shot = NAN, flicker = NAN; // S_V contributions at the flank
    std::vector<double> dRdB;                // per point
    int nPoints = 0, nFinite = 0;
};

// Even-parabola least squares R = c + a B^2 (weights optional). Returns false
// if fewer than 2 finite points.
inline bool fitEven(const std::vector<double> &B, const std::vector<double> &R, const std::vector<double> *w, double maxAbsB, double &a, double &c) {
    double s0 = 0, s2 = 0, s4 = 0, t0 = 0, t2 = 0; int n = 0;
    for (size_t i = 0; i < B.size(); ++i) {
        if (!std::isfinite(B[i]) || !std::isfinite(R[i]) || std::abs(B[i]) > maxAbsB) continue;
        const double wi = w && std::isfinite((*w)[i]) && (*w)[i] > 0 ? (*w)[i] : 1;
        const double x2 = B[i] * B[i];
        s0 += wi; s2 += wi * x2; s4 += wi * x2 * x2; t0 += wi * R[i]; t2 += wi * x2 * R[i]; ++n;
    }
    if (n < 2) return false;
    const double det = s4 * s0 - s2 * s2;
    if (std::abs(det) < 1e-300) return false;
    a = (t2 * s0 - t0 * s2) / det;
    c = (s4 * t0 - s2 * t2) / det;
    return true;
}

// Local quadratic least squares around point i over +-half neighbours; the
// derivative is the linear coefficient at B_i.
inline double localDerivative(const std::vector<double> &B, const std::vector<double> &R, const std::vector<double> *w, size_t i, int half) {
    double S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0; int n = 0;
    const int lo = std::max(0, static_cast<int>(i) - half), hi = std::min(static_cast<int>(B.size()) - 1, static_cast<int>(i) + half);
    for (int k = lo; k <= hi; ++k) {
        if (!std::isfinite(B[k]) || !std::isfinite(R[k])) continue;
        const double wi = w && std::isfinite((*w)[k]) && (*w)[k] > 0 ? (*w)[k] : 1;
        const double x = B[k] - B[i], y = R[k];
        S0 += wi; S1 += wi * x; S2 += wi * x * x; S3 += wi * x * x * x; S4 += wi * x * x * x * x;
        T0 += wi * y; T1 += wi * x * y; T2 += wi * x * x * y; ++n;
    }
    if (n < 3) {
        // fall back to a two-point slope
        if (i + 1 < B.size() && i > 0 && std::isfinite(R[i + 1]) && std::isfinite(R[i - 1])) return (R[i + 1] - R[i - 1]) / (B[i + 1] - B[i - 1]);
        return NAN;
    }
    // solve the 3x3 normal equations by Cramer
    const double a11 = S0, a12 = S1, a13 = S2, a22 = S2, a23 = S3, a33 = S4;
    const double det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    if (std::abs(det) < 1e-300) return NAN;
    const double det1 = a11 * (T1 * a33 - a23 * T2) - T0 * (a12 * a33 - a23 * a13) + a13 * (a12 * T2 - T1 * a13);
    return det1 / det;
}

inline double interpLinear(const std::vector<double> &x, const std::vector<double> &y, double xq) {
    // x ascending; NaN outside the range or across a non-finite sample
    for (size_t i = 0; i + 1 < x.size(); ++i) if (xq >= x[i] && xq <= x[i + 1]) {
        if (!std::isfinite(y[i]) || !std::isfinite(y[i + 1])) return NAN;
        const double f = x[i + 1] > x[i] ? (xq - x[i]) / (x[i + 1] - x[i]) : 0;
        return y[i] + f * (y[i + 1] - y[i]);
    }
    return NAN;
}

inline CurveMetrics analyseCurve(const std::vector<double> &B, const std::vector<double> &R, const std::vector<double> &sigmaR,
                                 const std::vector<double> &T, double fitWindow, int sgHalf, const NoiseParams &noise,
                                 double mrField = 0.01, const std::vector<double> *capped = nullptr) {
    CurveMetrics m;
    m.nPoints = static_cast<int>(B.size());
    std::vector<double> w(B.size(), 1.0);
    for (size_t i = 0; i < B.size(); ++i) {
        if (std::isfinite(R[i])) ++m.nFinite;
        if (i < sigmaR.size() && std::isfinite(sigmaR[i]) && sigmaR[i] > 0) w[i] = 1 / (sigmaR[i] * sigmaR[i]);
    }
    double a, c;
    if (fitEven(B, R, &w, INF, a, c)) { m.aGlobal = a; m.R0global = c; }
    if (fitWindow > 0 && fitEven(B, R, &w, fitWindow, a, c)) { m.aLocal = a; m.R0local = c; }
    m.R0 = std::isfinite(m.R0local) ? m.R0local : m.R0global;
    const double aUse = std::isfinite(m.aLocal) ? m.aLocal : m.aGlobal;
    if (std::isfinite(m.R0) && m.R0 > 0) m.curvNorm = aUse / m.R0;
    // nearest-to-zero point
    size_t i0 = 0; double best = INF;
    for (size_t i = 0; i < B.size(); ++i) if (std::isfinite(B[i]) && std::abs(B[i]) < best) { best = std::abs(B[i]); i0 = i; }
    if (!B.empty() && i0 < T.size()) m.T0 = T[i0];
    // extremes and FWHM (the June definition: half way between min and max)
    m.Rmin = INF; m.Rmax = -INF; size_t imin = 0;
    for (size_t i = 0; i < R.size(); ++i) if (std::isfinite(R[i])) { if (R[i] < m.Rmin) { m.Rmin = R[i]; imin = i; } m.Rmax = std::max(m.Rmax, R[i]); }
    if (std::isfinite(m.Rmin) && m.Rmin > 0 && std::isfinite(m.Rmax)) m.mrDepth = (m.Rmax - m.Rmin) / m.Rmin;
    {   // MR at fixed fields, symmetrised, relative to the raw point nearest B = 0
        const double Rz = interpLinear(B, R, 0.0);   // works for even point counts (no B = 0 sample)
        auto mrAtField = [&](double b) { const double a = interpLinear(B, R, b), c = interpLinear(B, R, -b);
            return std::isfinite(a) && std::isfinite(c) && Rz > 0 ? 0.5 * (a + c) / Rz - 1 : NAN; };
        const double bmax = B.empty() ? 0 : std::min(std::abs(B.front()), std::abs(B.back()));   // symmetric part of the window
        m.mrField = mrField; m.mrAt = mrField > 0 ? mrAtField(mrField) : NAN; m.mrEdge = bmax > 0 ? mrAtField(bmax) : NAN;
        if (capped) { m.cappedOverT = 0; for (size_t i = 0; i < capped->size() && i < T.size(); ++i) if (T[i] > 0) m.cappedOverT = std::max(m.cappedOverT, (*capped)[i] / T[i]); }
    }
    if (m.nFinite > 2) {
        const double half = m.Rmin + 0.5 * (m.Rmax - m.Rmin);
        auto cross = [&](int dir) -> double {
            for (int i = static_cast<int>(imin); i >= 0 && i < static_cast<int>(R.size()); i += dir) {
                const int j = i + dir;
                if (j < 0 || j >= static_cast<int>(R.size())) return NAN;
                if (!std::isfinite(R[i]) || !std::isfinite(R[j])) continue;
                if ((R[i] - half) * (R[j] - half) <= 0 && R[i] != R[j]) return B[i] + (half - R[i]) / (R[j] - R[i]) * (B[j] - B[i]);
            }
            return NAN;
        };
        const double bl = cross(-1), br = cross(1);
        if (std::isfinite(bl) && std::isfinite(br)) m.fwhm = std::abs(br - bl);
    }
    // derivative and peak slope
    m.dRdB.assign(B.size(), NAN);
    m.peakSlope = 0;
    size_t iPeak = 0;
    for (size_t i = 0; i < B.size(); ++i) {
        m.dRdB[i] = localDerivative(B, R, &w, i, sgHalf);
        // the peak is searched only where the full window fits, so that a
        // 41-point and an 81-point curve agree on what "the flank slope" is
        const bool interior = static_cast<int>(i) >= sgHalf && i + sgHalf < B.size();
        if (interior && std::isfinite(m.dRdB[i]) && std::abs(m.dRdB[i]) > m.peakSlope) { m.peakSlope = std::abs(m.dRdB[i]); m.peakSlopeB = B[i]; m.flankR = R[i]; iPeak = i; }
    }
    m.peakAtEdge = B.size() > 2 * static_cast<size_t>(sgHalf) + 1 && (static_cast<int>(iPeak) == sgHalf || iPeak + sgHalf + 1 == B.size());
    if (std::isfinite(m.R0) && m.R0 > 0) m.peakSens = m.peakSlope / m.R0;
    {
        double bmax = 0; for (double b : B) if (std::isfinite(b)) bmax = std::max(bmax, std::abs(b));
        if (std::isfinite(m.aGlobal) && std::isfinite(m.R0global) && m.R0global > 0) m.peakSensParabola = 2 * std::abs(m.aGlobal) * bmax / m.R0global;
    }
    // noise at the flank
    if (std::isfinite(m.flankR) && m.flankR > 0 && noise.biasA > 0) {
        const double I = noise.biasA, Rf = m.flankR, V = I * Rf;
        m.johnson = 4 * K_BOLTZ * std::max(noise.tempK, 0.0) * Rf;
        m.shot = 2 * E_CHARGE * I * Rf * Rf;
        m.flicker = noise.hooge > 0 && noise.carriers > 0 && noise.freqHz > 0 ? noise.hooge * V * V / (noise.carriers * noise.freqHz) : 0;
        m.sv = m.johnson + m.shot + m.flicker;
        if (m.peakSlope > 0) m.bMinFlank = std::sqrt(m.sv) / (I * m.peakSlope);
        if (std::isfinite(aUse) && aUse > 0) {
            // same noise sources evaluated at R0 for the vertex readout
            const double svv = 4 * K_BOLTZ * std::max(noise.tempK, 0.0) * m.R0 + 2 * E_CHARGE * I * m.R0 * m.R0
                             + (noise.hooge > 0 && noise.carriers > 0 && noise.freqHz > 0 ? noise.hooge * sqr(I * m.R0) / (noise.carriers * noise.freqHz) : 0);
            m.bMinVertex = std::sqrt(std::sqrt(svv) / I / aUse);
        }
    }
    return m;
}

} // namespace klein
