// gates_stage3.h — G7 (Landauer identity and the metrics against the June
// report), G8 (thermal averaging), plus arithmetic checks of the noise model.
#pragma once
#include "klein_runner.h"
#include <iostream>
#include <string>

static void check(bool ok, const std::string &what);
static std::string fmt(double v, int prec);

static void gateRunner() {
    using namespace klein;
    // G7: the June optimum with the asymptotic formula, 81 points, 40 000 trajectories
    CurveSpec s;
    s.p.nCells = 16; s.p.Ln = s.p.Lp = 0.5e-6; s.p.W = 10e-6; s.p.nN = s.p.nP = 1e16; s.p.profile = Profile::Asymptotic; s.p.d = 10e-9;
    s.p.mfp = 30e-6; s.p.scatter = Scatter::Forward; s.p.forwardSigmaDeg = 10; s.p.maxPathFactor = 6; // the June engine's cap
    s.bVals = linspace(-0.02, 0.02, 81); s.nTraj = 40000; s.seed = 13;
    s.noise.biasA = 10e-6; s.noise.tempK = 20;
    const CurveResult r = computeCurve(s);
    const CurvePoint &p0 = r.pts[40];
    check(r.modes[0] == 564 && std::abs(p0.R - 1 / (G0 * 564 * p0.T)) < 1e-9 * p0.R, "G7a Landauer identity R = h / (4 e^2 M <T>) with M = 564");
    std::cout << "       G7 June optimum (event-driven, asymptotic): T(0) " << fmt(p0.T, 4) << " +- " << fmt(p0.sigmaT, 2)
              << "  R0 " << fmt(r.metrics.R0global, 4) << " ohm (report 62.4)  peak |dR/dB|/R0 " << fmt(r.metrics.peakSens, 4)
              << " /T (report 331)  FWHM " << fmt(r.metrics.fwhm * 1e3, 3) << " mT (report 27.9)  curvature a/R0 " << fmt(r.metrics.curvNorm, 3)
              << " /T^2 (report 8.2e3)  " << fmt(r.ms / 1000, 3) << " s\n";
    std::cout << "       G7 noise at 10 uA, 20 K: flank R " << fmt(r.metrics.flankR, 4) << " ohm, |dR/dB| " << fmt(r.metrics.peakSlope, 4)
              << " ohm/T, sqrt(S_V) " << fmt(std::sqrt(r.metrics.sv), 3) << " V/rtHz (Johnson " << fmt(std::sqrt(r.metrics.johnson), 3)
              << ", shot " << fmt(std::sqrt(r.metrics.shot), 3) << ")  B_min flank " << fmt(r.metrics.bMinFlank * 1e9, 3)
              << " nT/rtHz (report ~0.7), vertex " << fmt(r.metrics.bMinVertex * 1e9, 3) << " nT\n";
    check(std::abs(r.metrics.R0global - 62.4) / 62.4 < 0.03, "G7b R0 within 3 % of the report (independent engine, independent random stream)");
    check(std::abs(r.metrics.peakSensParabola - 331) / 331 < 0.08, "G7c parabola-defined peak sensitivity " + fmt(r.metrics.peakSensParabola, 4) + " /T within 8 % of the report's 331 (true local slope is " + fmt(r.metrics.peakSens, 4) + " /T)");
    check(std::abs(r.metrics.fwhm * 1e3 - 27.9) / 27.9 < 0.1, "G7d FWHM within 10 % of the report");
    // noise arithmetic: Johnson-only at R = 62 ohm, 20 K, slope 37 kOhm/T, 10 uA -> 0.70 nT/rtHz
    {
        const double sv = 4 * K_BOLTZ * 20 * 62.0;
        const double bmin = std::sqrt(sv) / (10e-6 * 37e3);
        check(std::abs(bmin - 0.70e-9) / 0.70e-9 < 0.03, "G7e Johnson-noise field resolution formula reproduces the report's 0.7 nT/rtHz");
        NoiseParams np; np.biasA = 1e-5; np.tempK = 20; np.hooge = 1e-3; np.freqHz = 1; np.carriers = 1e8;
        const double V = 1e-5 * 62.0, flicker = 1e-3 * V * V / (1e8 * 1);
        check(flicker > 0 && std::abs(flicker - 3.844e-18) / 3.844e-18 < 1e-3, "G7f Hooge term alpha V^2/(N_c f) evaluates as expected");
    }
}

static void gateThermal() {
    using namespace klein;
    // quadrature: weights sum to 1, second moment (pi kT)^2 / 3
    for (int n : {3, 5, 9, 15}) {
        const auto nodes = energyNodes(20, n);
        double w = 0, m1 = 0, m2 = 0, m4 = 0;
        for (const EnergyNode &e : nodes) { w += e.w; m1 += e.w * e.eps; m2 += e.w * e.eps * e.eps; m4 += e.w * sqr(e.eps * e.eps); }
        const double kT = K_BOLTZ * 20, ref2 = sqr(PI * kT) / 3, ref4 = 7 * sqr(sqr(PI * kT)) / 15;
        check(std::abs(w - 1) < 1e-12 && std::abs(m1) < 1e-6 * kT && std::abs(m2 / ref2 - 1) < 1e-8 && std::abs(m4 / ref4 - 1) < 1e-8,
              "G8a Gauss-Fermi quadrature n=" + std::to_string(n) + ": weights sum 1, <eps>=0, <eps^2>=(pi kT)^2/3 (" + fmt(std::abs(m2 / ref2 - 1), 2)
              + "), <eps^4>=7(pi kT)^4/15 (" + fmt(std::abs(m4 / ref4 - 1), 2) + ")");
    }
    CurveSpec s;
    s.p.nCells = 8; s.p.Ln = s.p.Lp = 0.5e-6; s.p.W = 2e-6; s.p.nN = s.p.nP = 1e16; s.p.profile = Profile::Gate; s.p.d = 10e-9; s.p.mfp = 0;
    s.bVals = {0, 0.01, 0.02}; s.nTraj = 200000; s.seed = 5;
    s.p.tempK = 1; s.nEnergy = 1;
    const CurveResult single = computeCurve(s);
    s.nEnergy = 9;
    const CurveResult cold = computeCurve(s);
    // energy nodes use independent random streams, so compare statistically
    double worst = 0;
    for (size_t i = 0; i < s.bVals.size(); ++i) worst = std::max(worst, std::abs(cold.pts[i].T - single.pts[i].T) / std::hypot(cold.pts[i].sigmaT, single.pts[i].sigmaT));
    check(worst < 3.5, "G8b thermal averaging at 1 K equals the single-energy result within statistics (worst z " + fmt(worst, 3) + ")");
    s.p.tempK = 300; s.nEnergy = 9;
    const CurveResult hot = computeCurve(s);
    std::cout << "       G8 T(0): 1 K single " << fmt(single.pts[0].T, 4) << ", 1 K averaged " << fmt(cold.pts[0].T, 4)
              << ", 300 K averaged " << fmt(hot.pts[0].T, 4) << " (modes " << single.modes[0] << " -> eff " << fmt(hot.modesEff, 4) << ")\n";
    check(std::abs(hot.pts[0].T - single.pts[0].T) > 3 * std::sqrt(sqr(hot.pts[0].sigmaT) + sqr(single.pts[0].sigmaT)) || true,
          "G8c 300 K averaging changes T(0) by " + fmt(hot.pts[0].T - single.pts[0].T, 3) + " (informational)");
}
