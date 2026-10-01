// gates_stage2.h — G3 (event-driven vs timestep reference), G4 (Dirac solver
// limits), G5 (analytic checks), G6 (flux engine vs Monte Carlo).
#pragma once
#include "klein_physics.h"
#include "reference_engine.h"
#include <chrono>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

static void check(bool ok, const std::string &what);

static std::string fmt(double v, int prec = 4) { char b[64]; std::snprintf(b, sizeof b, "%.*g", prec, v); return b; }

// ---- reference config -> production params (asymptotic profile) --------
static klein::Params paramsFromRef(const kref::Cfg &c) {
    klein::Params p;
    p.nCells = c.nUnits; p.Ln = p.Lp = c.sectionLengthM; p.W = c.stripWidthM;
    p.nN = c.nDensityM2; p.nP = c.pDensityM2; p.profile = klein::Profile::Asymptotic; p.d = c.junctionWidthM;
    p.skewDeg = c.junctionAngleDeg;
    p.edge = c.edgeSpecularity < 1 ? klein::EdgeModel::Diffuse : klein::EdgeModel::Specular; p.specularity = c.edgeSpecularity;
    p.vF = c.vFermiMS; p.mfp = c.meanFreePathM; p.mfpPh300 = 0;
    p.scatter = c.scatteringModel == "drude" ? klein::Scatter::Drude : klein::Scatter::Forward; p.forwardSigmaDeg = c.forwardSigmaDeg;
    p.eeMfp = c.eeMfpM; p.eeSigmaDeg = c.eeSigmaDeg; p.maxPathFactor = c.maxPathFactor;
    return p;
}

static double refT(const kref::Cfg &cfg, double B, int n) {
    const kref::Rates r = kref::ratesFor(cfg);
    long acc = 0;
#ifdef _OPENMP
#pragma omp parallel for reduction(+:acc) schedule(dynamic, 256)
#endif
    for (int i = 0; i < n; ++i) if (kref::traceOne(cfg, r, B, i, 0)) ++acc;
    return static_cast<double>(acc) / n;
}

static klein::PointResult mcT(const klein::Device &dv, double B, long n, uint64_t seed = 101) {
    klein::PointResult tot;
    const int chunks = 64;
#ifdef _OPENMP
#pragma omp parallel
#endif
    {
        klein::PointResult mine;
#ifdef _OPENMP
#pragma omp for schedule(dynamic, 1)
#endif
        for (int c = 0; c < chunks; ++c) mine.add(klein::runMC(dv, B, seed, n * c / chunks, n * (c + 1) / chunks));
#ifdef _OPENMP
#pragma omp critical
#endif
        tot.add(mine);
    }
    return tot;
}

static klein::PointResult fluxT(const klein::Device &dv, double B, const klein::FluxGrid &g, uint64_t seed = 101) {
    klein::PointResult tot;
    const long nodes = g.nodes();
    const int chunks = 64;
#ifdef _OPENMP
#pragma omp parallel
#endif
    {
        klein::PointResult mine;
#ifdef _OPENMP
#pragma omp for schedule(dynamic, 1)
#endif
        for (int c = 0; c < chunks; ++c) mine.add(klein::runFlux(dv, B, seed, g, nodes * c / chunks, nodes * (c + 1) / chunks));
#ifdef _OPENMP
#pragma omp critical
#endif
        tot.add(mine);
    }
    return tot;
}

// ---------------------------------------------------------------- G3
static kref::Cfg g3Base() {
    kref::Cfg c;
    c.nUnits = 8; c.sectionLengthM = 5e-7; c.stripWidthM = 2e-6; c.nDensityM2 = 1e16; c.pDensityM2 = 1e16;
    c.junctionWidthM = 6e-9; c.junctionAngleDeg = 0; c.vFermiMS = 1e6; c.meanFreePathM = 1e3; c.dtS = 1e-14;
    c.maxPathFactor = 6; c.scatteringModel = "forward"; c.forwardSigmaDeg = 10; c.seed = 13;
    c.edgeSpecularity = 1.0; c.eeMfpM = 0; c.eeSigmaDeg = 0;
    return c;
}

struct G3Case { std::string name; kref::Cfg cfg; double B; };

static std::vector<G3Case> g3Cases() {
    std::vector<G3Case> v;
    { kref::Cfg c = g3Base(); v.push_back({"ballistic B=0", c, 0}); }
    { kref::Cfg c = g3Base(); v.push_back({"ballistic B=+20 mT", c, 0.02}); }
    { kref::Cfg c = g3Base(); v.push_back({"ballistic B=-20 mT", c, -0.02}); }
    { kref::Cfg c = g3Base(); c.junctionAngleDeg = 10; v.push_back({"skew 10 deg, B=20 mT", c, 0.02}); }
    { kref::Cfg c = g3Base(); c.edgeSpecularity = 0.5; v.push_back({"specularity 0.5, B=20 mT", c, 0.02}); }
    { kref::Cfg c = g3Base(); c.meanFreePathM = 3e-6; v.push_back({"forward scattering 3 um, B=10 mT", c, 0.01}); }
    { kref::Cfg c = g3Base(); c.meanFreePathM = 3e-6; c.scatteringModel = "drude"; v.push_back({"drude 3 um, B=10 mT", c, 0.01}); }
    { kref::Cfg c = g3Base(); c.pDensityM2 = 0.6e16; v.push_back({"asymmetric p=0.6n, B=20 mT", c, 0.02}); }
    { kref::Cfg c = g3Base(); c.eeMfpM = 1e-6; c.eeSigmaDeg = 15; v.push_back({"e-e 1 um / 15 deg, B=0", c, 0}); }
    { kref::Cfg c = g3Base(); c.nUnits = 16; c.stripWidthM = 10e-6; c.junctionWidthM = 10e-9; v.push_back({"June optimum N=16 d=10nm W=10um, B=15 mT", c, 0.015}); }
    return v;
}

static void gateEventDriven() {
    const int N = 1000000;
    const auto cases = g3Cases();
    double worst = 0; double refMs = 0, newMs = 0;
    for (const G3Case &cs : cases) {
        kref::Cfg cfg = cs.cfg; cfg.finalize();
        auto t0 = std::chrono::steady_clock::now();
        const double tRef = refT(cfg, cs.B, N);
        auto t1 = std::chrono::steady_clock::now();
        const klein::Device dv = klein::buildDevice(paramsFromRef(cfg));
        const klein::PointResult pr = mcT(dv, -cs.B, N);   // reference sign convention = physical at -B
        auto t2 = std::chrono::steady_clock::now();
        refMs += std::chrono::duration<double, std::milli>(t1 - t0).count();
        newMs += std::chrono::duration<double, std::milli>(t2 - t1).count();
        const double sig = std::sqrt(tRef * (1 - tRef) / N + pr.T() * (1 - pr.T()) / N);
        const double z = std::abs(tRef - pr.T()) / std::max(sig, 1e-12);
        worst = std::max(worst, z);
        std::cout << "       G3 " << cs.name << ": dt-engine T=" << fmt(tRef, 5) << "  event-driven T=" << fmt(pr.T(), 5)
                  << "  z=" << fmt(z, 3) << "  (capped " << fmt(pr.wCapped / pr.wSum, 3) << ")\n";
    }
    std::cout << "       G3 wall: dt-engine " << fmt(refMs / 1000, 3) << " s, event-driven " << fmt(newMs / 1000, 3) << " s for "
              << cases.size() << " x " << N << " trajectories\n";
    check(worst < 3.5, "G3 event-driven tracer agrees with the timestep reference within 3.5 sigma on every case (worst z " + fmt(worst, 3) + ")");
}

// ---------------------------------------------------------------- G4
static void gateDirac() {
    using namespace klein;
    const double kF = kfFromDensity(1e16);
    // (a) sharp symmetric np step -> T = cos^2(theta)
    {
        double worst = 0;
        for (int i = 0; i <= 9; ++i) {
            const double th = i * 0.1 * 0.5 * PI * 0.98;
            const double ky = kF * std::sin(th);
            const DiracResult r = diracTransmission(Profile::Linear, kF, -kF, 1e-12, ky, 0.5e-12);
            worst = std::max(worst, std::abs(r.T - sqr(std::cos(th))));
        }
        check(worst < 2e-3, "G4a sharp symmetric np step reproduces T = cos^2(theta) (max err " + fmt(worst, 2) + ")");
    }
    // (b) linear ramp, kF d = 20 -> asymptotic exponent at small angles
    {
        const double d = 20 / kF;
        double worst = 0; std::string row;
        for (double s : {0.05, 0.1, 0.15, 0.2}) {
            const double ky = kF * s;
            const DiracResult r = diracTransmission(Profile::Linear, kF, -kF, d, ky, 0.5 * d);
            const double ta = asymptoticTransmission(kF, -kF, d, ky);
            worst = std::max(worst, std::abs(r.T / ta - 1));
            row += "s=" + fmt(s, 2) + ":" + fmt(r.T, 4) + "/" + fmt(ta, 4) + " ";
        }
        check(worst < 0.03, "G4b linear ramp kF d=20: exact/asymptotic within 3 % for sin(theta)<=0.2 (" + row + ")");
    }
    // (c) Klein: T(0) = 1 for every profile at d = 10 nm; (d) unitarity; (e) reciprocity; (g) interpolation
    {
        double worstT0 = 0, worstUnit = 0, worstRec = 0, worstInterp = 0;
        for (Profile p : {Profile::Gate, Profile::Linear, Profile::Tanh, Profile::Erf}) {
            const JunctionTable a = buildTable(p, kF, -kF, 10e-9, 250e-9);
            const JunctionTable b = buildTable(p, -kF, kF, 10e-9, 250e-9);
            worstT0 = std::max(worstT0, std::abs(a.T[0] - 1));
            worstUnit = std::max(worstUnit, a.worstUnitarity);
            for (size_t i = 0; i < a.T.size(); ++i) worstRec = std::max(worstRec, std::abs(a.T[i] - b.T[i]));
            for (double f : {0.1234, 0.3456, 0.6789}) {
                const double ky = f * a.kMax;
                const DiracResult r = diracTransmission(p, kF, -kF, 10e-9, ky, a.window);
                worstInterp = std::max(worstInterp, std::abs(a.at(ky) - r.T));
            }
            std::cout << "       G4 " << profileName(p) << " d=10nm: window " << fmt(a.window * 1e9, 3) << " nm, mismatch " << fmt(a.mismatch, 2)
                      << ", T(10deg)=" << fmt(a.at(kF * std::sin(10 * PI / 180)), 4) << " T(30deg)=" << fmt(a.at(kF * std::sin(30 * PI / 180)), 4)
                      << " T(60deg)=" << fmt(a.at(kF * std::sin(60 * PI / 180)), 4)
                      << "  [asymptotic " << fmt(asymptoticTransmission(kF, -kF, 10e-9, kF * std::sin(10 * PI / 180)), 4) << " "
                      << fmt(asymptoticTransmission(kF, -kF, 10e-9, kF * std::sin(30 * PI / 180)), 4) << " "
                      << fmt(asymptoticTransmission(kF, -kF, 10e-9, kF * std::sin(60 * PI / 180)), 4) << "]\n";
        }
        check(worstT0 < 1e-6, "G4c Klein: T(0) = 1 for every profile (worst " + fmt(worstT0, 2) + ")");
        check(worstUnit < 1e-6, "G4d current conservation |T+R-1| < 1e-6 over all tables (worst " + fmt(worstUnit, 2) + ")");
        check(worstRec < 1e-6, "G4e reciprocity: T(kL->kR) = T(kR->kL) (worst " + fmt(worstRec, 2) + ")");
        check(worstInterp < 2e-3, "G4g table interpolation error < 2e-3 (worst " + fmt(worstInterp, 2) + ")");
    }
    // (f) sharp unipolar n-n' step: T = cos(th) cos(th') / cos^2((th+th')/2)
    {
        const double k2 = kfFromDensity(0.5e16);
        double worst = 0;
        for (int i = 1; i <= 8; ++i) {
            const double th = i * 0.05 * PI;
            const double ky = kF * std::sin(th);
            if (ky >= k2) break;
            const double th2 = std::asin(ky / k2);
            const DiracResult r = diracTransmission(Profile::Linear, kF, k2, 1e-12, ky, 0.5e-12);
            const double ana = std::cos(th) * std::cos(th2) / sqr(std::cos(0.5 * (th + th2)));
            worst = std::max(worst, std::abs(r.T - ana));
        }
        check(worst < 2e-3, "G4f sharp unipolar n-n' step matches cos(t)cos(t')/cos^2((t+t')/2) (max err " + fmt(worst, 2) + ")");
    }
}

// ---------------------------------------------------------------- G5
static void gateAnalytic() {
    using namespace klein;
    const double kF = kfFromDensity(1e16);
    // (a) one unipolar cell, no edges: exit angle = asin(L / Rc)
    {
        Params p; p.nCells = 1; p.Ln = 2e-6; p.W = 1; p.nN = 1e16; p.unipolar = true; p.mfp = 0; p.profile = Profile::Asymptotic;
        const Device dv = buildDevice(p);
        const double B = 0.02, Rc = HBAR * kF / (E_CHARGE * B);
        Rng rng(1);
        RayState fin;
        const Fate f = traceMC(dv, B, initialRay(dv, 0.5, 0), rng, nullptr, nullptr, &fin);
        const double expect = std::asin(p.Ln / Rc);    // physical: electrons orbit counter-clockwise for B along +z
        check(f == Fate::Transmitted && std::abs(fin.phi - expect) < 1e-9,
              "G5a cyclotron arc: exit angle " + fmt(fin.phi, 8) + " vs asin(L/Rc) " + fmt(expect, 8));
        // hole cell rotates the other way
        Params q = p; q.unipolar = false; q.nCells = 2; q.Ln = 1e-10; q.Lp = 2e-6; q.nP = 1e16; q.d = 1e-12;
        const Device dh = buildDevice(q);
        Rng rng2(1); RayState finH;
        traceMC(dh, B, initialRay(dh, 0.5, 0), rng2, nullptr, nullptr, &finH);
        check(std::abs(finH.phi + expect) < 5e-5, "G5a holes rotate opposite to electrons: " + fmt(finH.phi, 6) + " vs " + fmt(-expect, 6) + " (0.1 nm entry cell adds 1.7e-5)");
    }
    // (b) one junction, B = 0, no edges, asymptotic T: <T> = (1/2) sqrt(pi/a) erf(sqrt a), a = (pi/2) kF d
    {
        Params p; p.nCells = 2; p.Ln = p.Lp = 0.5e-6; p.W = 1; p.mfp = 0; p.profile = Profile::Asymptotic; p.d = 6e-9; p.maxPathFactor = 1e4;
        const Device dv = buildDevice(p);
        const double a = 0.5 * PI * kF * p.d;
        const double exact = 0.5 * std::sqrt(PI / a) * std::erf(std::sqrt(a));
        FluxGrid g; g.nY = 1; g.nS = 2049;
        const PointResult fr = fluxT(dv, 0, g);
        const PointResult mc = mcT(dv, 0, 400000);
        check(std::abs(fr.T() - exact) < 2e-4, "G5b single junction <T>: flux " + fmt(fr.T(), 6) + " vs closed form " + fmt(exact, 6));
        check(std::abs(mc.T() - exact) < 3 * mc.sigmaT(), "G5b single junction <T>: Monte Carlo " + fmt(mc.T(), 5) + " +- " + fmt(mc.sigmaT(), 2));
    }
    // (c) two junctions, B = 0: incoherent series T_tot = T/(2-T) at every angle
    {
        Params p; p.nCells = 3; p.Ln = p.Lp = 0.5e-6; p.W = 1; p.mfp = 0; p.profile = Profile::Asymptotic; p.d = 6e-9; p.fluxThreshold = 1e-10; p.fluxMaxDepth = 2000; p.maxPathFactor = 1e4;
        const Device dv = buildDevice(p);
        const double a = 0.5 * PI * kF * p.d;
        double exact = 0; const int M = 400000;
        for (int i = 0; i < M; ++i) { const double s = -1 + (i + 0.5) * 2.0 / M; const double T = std::exp(-a * s * s); exact += T / (2 - T); }
        exact /= M;
        FluxGrid g; g.nY = 1; g.nS = 4097;
        const PointResult fr = fluxT(dv, 0, g);
        check(std::abs(fr.T() - exact) < 2e-4 && fr.wDropped / fr.wSum < 1e-6,
              "G5c two junctions: flux " + fmt(fr.T(), 6) + " vs incoherent series " + fmt(exact, 6) + " (dropped " + fmt(fr.wDropped / fr.wSum, 2) + ")");
        const PointResult mc = mcT(dv, 0, 400000);
        check(std::abs(mc.T() - exact) < 3 * mc.sigmaT(), "G5c two junctions: Monte Carlo " + fmt(mc.T(), 5) + " +- " + fmt(mc.sigmaT(), 2));
    }
}

// ---------------------------------------------------------------- G6
static void gateFluxVsMC() {
    using namespace klein;
    double worst = 0;
    const auto cases = g3Cases();
    for (const G3Case &cs : cases) {
        kref::Cfg cfg = cs.cfg; cfg.finalize();
        for (Profile prof : {Profile::Asymptotic, Profile::Gate}) {
            Params p = paramsFromRef(cfg); p.profile = prof;
            const Device dv = buildDevice(p);
            const PointResult mc = mcT(dv, cs.B, 200000);
            FluxGrid g; g.nY = 24; g.nS = 257; g.jitter = true;
            const PointResult fl = fluxT(dv, cs.B, g);
            const double sig = std::max(std::sqrt(sqr(mc.sigmaT()) + sqr(fl.sigmaT())), 1e-12);
            const double z = std::abs(mc.T() - fl.T()) / sig;
            worst = std::max(worst, z);
            std::cout << "       G6 " << cs.name << " [" << profileName(prof) << "]: mc " << fmt(mc.T(), 5) << " +- " << fmt(mc.sigmaT(), 2)
                      << "  flux " << fmt(fl.T(), 5) << " +- " << fmt(fl.sigmaT(), 2) << "  z=" << fmt(z, 3) << "  rays/node " << fmt(static_cast<double>(fl.rays) / fl.n, 3)
                      << "  roulettes/node " << fmt(static_cast<double>(fl.rouletted) / fl.n, 3) << "  dropped " << fmt(fl.wDropped / fl.wSum, 2) << '\n';
        }
    }
    check(worst < 4.0, "G6 flux engine agrees with Monte Carlo within 4 sigma on every case (worst z " + fmt(worst, 3) + ")");
}
