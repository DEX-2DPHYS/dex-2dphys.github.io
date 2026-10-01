// probe.cpp — offline validation gates for the Klein-magnetometer plugin.
// Stage 1: G1 (RNG stream), G2b (exact-count equivalence with engine.js),
// G2 (the June optimum curve, 81 points x 40 000 trajectories, 3 sigma).
//
//   probe.exe <analysis dir>            runs everything
//   probe.exe <analysis dir> --quick    skips the 40 000-trajectory gate
//
// Reference numbers were produced by $TEMP/klein-ref.js running engine.js
// under node on 2026-10-01 (see DESIGN.md, gate G1/G2b).
#include "reference_engine.h"
#include "dex_msg.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#ifdef _OPENMP
#include <omp.h>
#endif

static int failures = 0;
static void check(bool ok, const std::string &what) {
    std::cout << (ok ? "[ OK ] " : "[FAIL] ") << what << '\n';
    if (!ok) ++failures;
}
#include "gates_stage2.h"
#include "gates_stage3.h"
#include "gates_stage4.h"
#include "gates_stage5.h"

static std::string readFile(const std::string &path) {
    std::ifstream f(path, std::ios::binary);
    std::stringstream ss; ss << f.rdbuf();
    return ss.str();
}


// dexmsg::get_array parses float32; the field values must be exact doubles or
// a 1e-9 perturbation of B flips a few trajectories out of 40 000.
static std::vector<double> getArrayD(const std::string &json, const std::string &key) {
    std::vector<double> out;
    size_t p = dexmsg::value_pos(json, key);
    if (p == std::string::npos || p >= json.size() || json[p] != '[') return out;
    ++p;
    while (p < json.size()) {
        while (p < json.size() && (json[p] == ' ' || json[p] == ',' || json[p] == '\r' || json[p] == '\n')) ++p;
        if (p >= json.size() || json[p] == ']') break;
        char *end = nullptr;
        const double v = std::strtod(json.c_str() + p, &end);
        if (!end || end == json.c_str() + p) break;
        out.push_back(v);
        p = static_cast<size_t>(end - json.c_str());
    }
    return out;
}

// ---------------------------------------------------------------- G1
static void gateRng() {
    const double draws[32] = {0.5663226493634284,0.36011716164648533,0.0705908453091979,0.04816685197874904,0.03677086811512709,0.006773725617676973,0.09120745095424354,0.35417386959306896,0.558275539195165,0.8705981557723135,0.6555668637156487,0.7593450902495533,0.2912685133051127,0.16639575641602278,0.5607174669858068,0.3652596150059253,0.5773118082433939,0.615498737199232,0.12267140857875347,0.6464760373346508,0.43443665909580886,0.6558141396380961,0.33913280349224806,0.10328627657145262,0.745841713855043,0.4034345359541476,0.08954038145020604,0.3148026748094708,0.04029536549933255,0.06138220033608377,0.2895074477419257,0.9146442539058626};
    kref::Mulberry32 m(13);
    bool ok = true;
    for (int i = 0; i < 32; ++i) if (m.next() != draws[i]) ok = false;
    check(ok, "G1a mulberry32(13): first 32 draws bit-identical to JS");

    const double normals[8] = {-0.6803457549290108,0.821165194334238,2.1978995479370087,0.6862559308615656,2.5679056971854517,0.10935757675798054,-1.33231194902703,1.7361400412519996};
    kref::Rng r(13);
    double maxErr = 0;
    for (int i = 0; i < 8; ++i) maxErr = std::max(maxErr, std::abs(r.normal(0, 1) - normals[i]));
    check(maxErr < 4e-16, "G1b Box-Muller normal() stream matches JS (max |diff| " + std::to_string(maxErr) + ")");

    const uint32_t seeds[5] = {2654443693u, 1013912158u, 2654451612u, 291983752u, 1544557036u};
    const int ti[5] = {0, 1, 0, 1999, 39999}, bi[5] = {0, 0, 1, 4, 80};
    ok = true;
    for (int i = 0; i < 5; ++i) if (kref::trajectorySeed(13, ti[i], bi[i]) != seeds[i]) ok = false;
    check(ok, "G1c per-trajectory seed mixing matches (seed + 2654435761*(i+1) + 7919*(b+1)) >>> 0");
}

// ---------------------------------------------------------------- G2b
static kref::Cfg baseCfg() {
    kref::Cfg c;
    c.nUnits = 8; c.sectionLengthM = 5e-7; c.stripWidthM = 2e-6; c.nDensityM2 = 1e16; c.pDensityM2 = 1e16;
    c.junctionWidthM = 6e-9; c.junctionAngleDeg = 0; c.vFermiMS = 1e6; c.meanFreePathM = 30e-6; c.dtS = 1e-14;
    c.maxPathFactor = 6; c.scatteringModel = "forward"; c.forwardSigmaDeg = 10; c.seed = 13;
    c.edgeSpecularity = 1.0; c.eeMfpM = 0; c.eeSigmaDeg = 0;
    return c;
}

static void gateExactCounts() {
    const double bVals[5] = {-0.02, -0.01, 0, 0.01, 0.02};
    struct Case { const char *name; kref::Cfg cfg; long expect[5]; };
    kref::Cfg c1 = baseCfg();
    kref::Cfg c2 = baseCfg(); c2.pDensityM2 = 0.7e16; c2.junctionAngleDeg = 10; c2.meanFreePathM = 3e-6; c2.scatteringModel = "drude"; c2.edgeSpecularity = 0.5; c2.eeMfpM = 2e-6; c2.eeSigmaDeg = 15;
    kref::Cfg c3 = baseCfg(); c3.meanFreePathM = 3e-6;
    std::vector<Case> cases = {
        {"ballistic, specular, symmetric, straight", c1, {555, 613, 657, 675, 537}},
        {"asymmetric n/p, 10 deg skew, drude 3um, p=0.5 edges, e-e on", c2, {398, 393, 389, 386, 386}},
        {"forward scattering 3um", c3, {551, 632, 644, 675, 547}},
    };
    check(kref::numberModes(c1) == 112, "G2b mode count M = floor(kF W / pi) = 112");
    for (auto &cs : cases) {
        cs.cfg.finalize();
        long worst = 0;
        std::string detail;
        for (int b = 0; b < 5; ++b) {
            const long got = kref::simulateEnsemble(cs.cfg, bVals[b], 0, 2000, b);
            worst = std::max(worst, std::labs(got - cs.expect[b]));
            detail += std::to_string(got) + "/" + std::to_string(cs.expect[b]) + " ";
        }
        // Identical streams; a difference can only come from a last-ulp libm
        // difference flipping a comparison, which must be rare.
        check(worst <= 2, std::string("G2b exact transmitted counts (C++/JS): ") + cs.name + " -> " + detail);
    }
}

// ---------------------------------------------------------------- G2
static void gateOptimum(const std::string &dir) {
    const std::string js = readFile(dir + "/data/optimized.json");
    check(!js.empty(), "G2 optimized.json readable");
    if (js.empty()) return;
    std::vector<double> bVals = getArrayD(js, "bVals");
    std::vector<double> T = getArrayD(js, "T");
    const int NTRAJ = static_cast<int>(dexmsg::get_num(js, "NTRAJ", 40000));
    check(bVals.size() == 81 && T.size() == 81, "G2 reference curve has 81 points");
    kref::Cfg cfg = baseCfg();
    cfg.nUnits = 16; cfg.stripWidthM = 10e-6; cfg.junctionWidthM = 10e-9; cfg.meanFreePathM = 30e-6;
    cfg.finalize();
    check(kref::numberModes(cfg) == 564, "G2 optimum mode count 564");
    const kref::Rates rates = kref::ratesFor(cfg);
    const auto t0 = std::chrono::steady_clock::now();
    std::vector<long> counts(bVals.size(), 0);
    double worstSigma = 0; int exact = 0;
    for (size_t b = 0; b < bVals.size(); ++b) {
        long acc = 0;
#ifdef _OPENMP
#pragma omp parallel for reduction(+:acc) schedule(dynamic, 256)
#endif
        for (int i = 0; i < NTRAJ; ++i) if (kref::traceOne(cfg, rates, bVals[b], i, static_cast<int>(b))) ++acc;
        counts[b] = acc;
        const double t = static_cast<double>(acc) / NTRAJ;
        const double sig = std::sqrt(std::max(1e-12, t * (1 - t) / NTRAJ));
        const double z = std::abs(t - T[b]) / sig;
        worstSigma = std::max(worstSigma, z);
        if (std::labs(acc - std::lround(T[b] * NTRAJ)) == 0) ++exact;
    }
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    std::cout << "       G2: " << NTRAJ << " trajectories x " << bVals.size() << " fields in " << ms / 1000 << " s; "
              << exact << "/" << bVals.size() << " points reproduce the JS count exactly; worst |z| = " << worstSigma << '\n';
    check(worstSigma < 3.0, "G2 June optimum curve reproduced within 3 sigma at every field");
    check(exact == 81, "G2 every point reproduces the JS transmitted count exactly (libm-equivalent on this machine)");
    // the derived numbers in the report
    const int modes = kref::numberModes(cfg);
    std::vector<double> bv(bVals.begin(), bVals.end()), R, Rerr;
    for (size_t b = 0; b < bVals.size(); ++b) {
        const kref::PointStats s = kref::statsForPoint(static_cast<double>(counts[b]) / NTRAJ, modes, NTRAJ);
        R.push_back(s.R); Rerr.push_back(s.sigmaR);
    }
    const kref::Parabolic para = kref::computeParabolicSensitivity(bv, R);
    const kref::Diagnostics diag = kref::computeDiagnostics(bv, R, Rerr);
    const double refR0 = dexmsg::get_num(js, "commonR0", 0), refSens = dexmsg::get_num(js, "maxAbsSens_perT", 0);
    std::cout << "       R0 " << para.commonR0 << " (ref " << refR0 << ")  peak |dR/dB|/R0 " << std::abs(para.maxAbsSensitivity)
              << " /T (ref " << refSens << ")  FWHM " << diag.fwhm * 1e3 << " mT  T(0) " << static_cast<double>(counts[40]) / NTRAJ << '\n';
    check(std::abs(para.commonR0 - refR0) / refR0 < 0.02, "G2 R0 within 2 % of the report");
    check(std::abs(std::abs(para.maxAbsSensitivity) - refSens) / refSens < 0.05, "G2 peak normalised sensitivity within 5 % of the report");
}

int main(int argc, char **argv) {
    const std::string dir = argc > 1 ? argv[1] : ".";
    bool quick = false;
    for (int i = 2; i < argc; ++i) if (std::string(argv[i]) == "--quick") quick = true;
#ifdef _OPENMP
    std::cout << "OpenMP threads: " << omp_get_max_threads() << '\n';
#endif
    std::string only;
    for (int i = 2; i < argc; ++i) { const std::string a = argv[i]; if (a.rfind("--stage", 0) == 0) only = a; }
    if (only.empty() || only == "--stage1") {
        gateRng();
        gateExactCounts();
        if (!quick) gateOptimum(dir);
    }
    if (only.empty() || only == "--stage2") {
        gateDirac();
        gateAnalytic();
        gateEventDriven();
        gateFluxVsMC();
    }
    if (only.empty() || only == "--stage3") {
        gateRunner();
        gateThermal();
    }
    if (only.empty() || only == "--stage4") gateCoherent();
    if (only.empty() || only == "--stage5") gateReview();
    std::cout << (failures ? "FAILED" : "ALL CLEAR") << " (" << failures << " failures)\n";
    return failures ? 2 : 0;
}
