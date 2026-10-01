// gates_stage5.h — regression gates for the defects found in the independent
// review of 2026-10-01. Each gate is built so that the OLD code fails it.
//   G11 reciprocity of a single asymmetric junction (Landauer mode count)
//   G12 cell label = geometry at every event (skew x wide strip, tilt disorder)
//   G13 skewed wide strip agrees with the timestep reference (which locates
//       cells from position)
//   G14 scatter "none" is exactly ballistic
//   G15 equal-density unipolar control has no junctions: T(0) = 1, and the
//       field response equals a single homogeneous cell
//   G16 coherent and incoherent agree for a single junction at every energy
//   G17 fixed-field MR works on an even-point field grid
#pragma once
#include "klein_runner.h"
#include "klein_coherent.h"
#include "reference_engine.h"
#include <iostream>
#include <string>

static void check(bool ok, const std::string &what);
static std::string fmt(double v, int prec);

static klein::PointResult mcT5(const klein::Device &dv, double B, long n, uint64_t seed = 77) {
    klein::PointResult tot;
#ifdef _OPENMP
#pragma omp parallel
#endif
    {
        klein::PointResult mine;
#ifdef _OPENMP
#pragma omp for schedule(dynamic, 1)
#endif
        for (int c = 0; c < 64; ++c) mine.add(klein::runMC(dv, B, seed, n * c / 64, n * (c + 1) / 64));
#ifdef _OPENMP
#pragma omp critical
#endif
        tot.add(mine);
    }
    return tot;
}

static void gateReview() {
    using namespace klein;
    // ---- G11 reciprocity
    {
        Params a; a.nCells = 2; a.Ln = a.Lp = 1e-6; a.W = 2e-6; a.mfp = 0; a.scatter = Scatter::None; a.profile = Profile::Gate; a.d = 10e-9;
        a.nN = 2e16; a.nP = 1e16;
        Params b = a; b.nN = 1e16; b.nP = 2e16;
        const Device da = buildDevice(a), db = buildDevice(b);
        const PointResult ra = mcT5(da, 0, 400000), rb = mcT5(db, 0, 400000);
        const double Ga = G0 * da.modes * ra.T(), Gb = G0 * db.modes * rb.T();
        const double sa = G0 * da.modes * ra.sigmaT(), sb = G0 * db.modes * rb.sigmaT();
        // exact: G = G0 (W/pi) * integral_0^kmin T(ky) dky, from the junction table
        const JunctionTable &t = da.tables[0];
        double integ = 0; const int M = 20000;
        for (int i = 0; i < M; ++i) integ += t.at(t.kMax * (i + 0.5) / M) * t.kMax / M;
        const double Gex = G0 * a.W / PI * integ;
        std::cout << "       G11 G(2e12|1e12) = " << fmt(Ga * 1e3, 5) << " mS, G(1e12|2e12) = " << fmt(Gb * 1e3, 5) << " mS, exact " << fmt(Gex * 1e3, 5) << " mS\n";
        check(std::abs(Ga - Gb) < 3.5 * std::hypot(sa, sb), "G11a reciprocity: G is the same from either side of an asymmetric junction");
        check(std::abs(Ga - Gex) < 3.5 * sa + 0.002 * Gex && std::abs(Gb - Gex) < 3.5 * sb + 0.002 * Gex, "G11b both equal G0 (W/pi) * integral T dk_y (Landauer, lead mode count)");
    }
    // ---- G12 label = geometry
    {
        Params p; p.nCells = 16; p.Ln = p.Lp = 0.5e-6; p.W = 10e-6; p.skewDeg = 10; p.sigmaTiltDeg = 10; p.mfp = 3e-6; p.scatter = Scatter::Forward;
        Device dv = buildDevice(p); dv.validate = true;
        long errs = 0; double Tsum = 0;
        for (double B : {0.0, 0.02, -0.02}) { const PointResult r = mcT5(dv, B, 100000); errs += r.labelErrors; Tsum += r.T(); }
        Params q = p; q.sigmaTiltDeg = 3; q.skewDeg = 0; q.W = 2e-6; q.mfp = 0; q.scatter = Scatter::None;
        Device dq = buildDevice(q); dq.validate = true;
        const PointResult rq = mcT5(dq, 0, 100000); errs += rq.labelErrors;
        check(errs == 0, "G12 cell label matches the geometry at every event (skew 10 deg x W 10 um, tilt 10 and 3 deg, scattering): " + std::to_string(errs) + " mismatches in 400 000 trajectories");
    }
    // ---- G13 skewed wide strip vs the reference (which locates cells by position)
    {
        kref::Cfg c; c.nUnits = 16; c.sectionLengthM = 5e-7; c.stripWidthM = 10e-6; c.nDensityM2 = c.pDensityM2 = 1e16; c.junctionWidthM = 10e-9;
        c.junctionAngleDeg = 10; c.vFermiMS = 1e6; c.meanFreePathM = 1e3; c.dtS = 1e-14; c.maxPathFactor = 6; c.scatteringModel = "forward"; c.seed = 13; c.edgeSpecularity = 1;
        c.finalize();
        Params p; p.nCells = 16; p.Ln = p.Lp = 0.5e-6; p.W = 10e-6; p.skewDeg = 10; p.profile = Profile::Asymptotic; p.d = 10e-9; p.mfp = 0; p.scatter = Scatter::None; p.maxPathFactor = 6;
        const Device dv = buildDevice(p);
        double worst = 0;
        for (double B : {0.0, 0.015}) {
            const kref::Rates rt = kref::ratesFor(c);
            const int N = 200000; long acc = 0;
#ifdef _OPENMP
#pragma omp parallel for reduction(+:acc) schedule(dynamic, 256)
#endif
            for (int i = 0; i < N; ++i) if (kref::traceOne(c, rt, B, i, 0)) ++acc;
            const double tr = static_cast<double>(acc) / N;
            const PointResult r = mcT5(dv, -B, N);     // reference sign convention = physical at -B
            const double z = std::abs(tr - r.T()) / std::hypot(std::sqrt(tr * (1 - tr) / N), r.sigmaT());
            worst = std::max(worst, z);
            std::cout << "       G13 skew 10 deg, W 10 um, B " << B * 1e3 << " mT: reference T " << fmt(tr, 5) << ", event-driven " << fmt(r.T(), 5) << ", z " << fmt(z, 3) << '\n';
        }
        check(worst < 3.5, "G13 skewed wide strip agrees with the position-based reference (worst z " + fmt(worst, 3) + ")");
    }
    // ---- G14 none == ballistic
    {
        Params a; a.nCells = 16; a.W = 4e-6; a.mfp = 30e-6; a.scatter = Scatter::None;
        Params b = a; b.mfp = 0;
        const PointResult ra = mcT5(buildDevice(a), 0.01, 100000), rb = mcT5(buildDevice(b), 0.01, 100000);
        check(ra.wT == rb.wT, "G14 scatter 'none' with a finite length is exactly ballistic (" + fmt(ra.T(), 6) + " vs " + fmt(rb.T(), 6) + ")");
    }
    // ---- G15 equal-density unipolar control
    {
        Params u; u.nCells = 16; u.Ln = u.Lp = 0.5e-6; u.W = 2e-6; u.unipolar = true; u.nN = u.nP = 1e16; u.mfp = 0; u.scatter = Scatter::None;
        Params h = u; h.nCells = 1; h.Ln = 8e-6;
        const Device du = buildDevice(u), dh = buildDevice(h);
        const PointResult u0 = mcT5(du, 0, 100000);
        // nothing may be reflected or lost; a grazing ray (sin theta -> 1) can still reach the path cap
        check(u0.wR == 0 && u0.wLost == 0 && u0.wCapped / u0.wSum < 1e-4, "G15a equal-density unipolar control reflects nothing at B = 0 (T = " + fmt(u0.T(), 8) + ", capped " + fmt(u0.wCapped / u0.wSum, 2) + ")");
        double worst = 0;
        for (double B : {0.005, 0.02, 0.05}) { const PointResult a = mcT5(du, B, 200000), b = mcT5(dh, B, 200000); worst = std::max(worst, std::abs(a.T() - b.T()) / std::hypot(a.sigmaT(), b.sigmaT()) ); }
        check(worst < 3.5, "G15b its field response equals one homogeneous 8 um cell (worst z " + fmt(worst, 3) + ")");
    }
    // ---- G16 coherent vs incoherent for one junction (no interference possible)
    {
        CoherentSpec cs; cs.p.nCells = 2; cs.p.Ln = cs.p.Lp = 0.5e-6; cs.p.W = 1; cs.p.mfp = 0; cs.p.profile = Profile::Gate; cs.p.d = 10e-9;
        cs.eRange = 25e-3 * E_CHARGE; cs.eN = 11; cs.kyN = 400; cs.temps = {20}; cs.incoherentEvery = 1; cs.grid = FluxGrid{1, 2049, false};
        CoherentJob job(cs); while (job.step()) {}
        const CoherentResult r = job.result();
        double worst = 0; for (size_t i = 0; i < r.eps.size(); ++i) worst = std::max(worst, std::abs(r.Tcoh[i] / r.Tinc[i] - 1));
        check(worst < 5e-3, "G16 single junction: coherent = incoherent at every energy in +-25 meV (worst rel. " + fmt(worst, 2) + ")");
    }
    // ---- G18 density map conserves path length; point contacts keep the label invariant
    {
        Params p; p.nCells = 2; p.Ln = p.Lp = 2e-6; p.W = 2e-6; p.leftFrac = p.rightFrac = 0.2; p.mfp = 0; p.scatter = Scatter::None; p.maxPathFactor = 5000;
        Device dv = buildDevice(p); dv.validate = true;
        DensityGrid g; g.init(dv, 120, 60, false);
        const PointResult r = runDensity(dv, 0.005, 3, 0, 20000, g);
        double sum = 0; for (double v : g.w) sum += v;
        check(std::abs(sum / r.sumPath - 1) < 1e-6, "G18a density map integrates to the total path length (" + fmt(sum / r.sumPath - 1, 2) + ")");
        const PointResult rv = mcT5(dv, 0.005, 50000);
        check(rv.labelErrors == 0 && rv.wLost == 0, "G18b point contacts + end walls: label = geometry, nothing lost (" + std::to_string(rv.labelErrors) + " mismatches)");
        Params q = p; q.leftFrac = q.rightFrac = 1;
        Params r1 = q; r1.leftFrac = 1; const Device d1 = buildDevice(r1), d0 = buildDevice([]{ Params z; z.nCells = 2; z.Ln = z.Lp = 2e-6; z.W = 2e-6; z.mfp = 0; z.scatter = Scatter::None; z.maxPathFactor = 5000; return z; }());
        const PointResult a = mcT5(d1, 0.005, 20000), b = mcT5(d0, 0.005, 20000);
        check(a.wT == b.wT && a.wR == b.wR, "G18c full-width contacts reproduce the default device exactly");
    }
    // ---- G17 MR on an even grid
    {
        CurveSpec s; s.p.nCells = 8; s.p.W = 2e-6; s.p.mfp = 0; s.p.scatter = Scatter::None; s.bVals = linspace(-0.03, 0.03, 40); s.nTraj = 20000; s.mrField = 0.01;
        const CurveResult r = computeCurve(s);
        check(std::isfinite(r.metrics.mrAt) && std::isfinite(r.metrics.mrEdge) && r.metrics.mrAt > 0, "G17 fixed-field MR defined on an even 40-point grid (MR10 = " + fmt(100 * r.metrics.mrAt, 3) + " %)");
    }
}
