// plugin.cpp — DSW core of the Klein-collimation magnetometer workbench.
// Heavy numerics live in the headers; this file owns the message protocol,
// the resumable job state machine inside advance(), and the device frame.
//
// Messages in (all JSON, "t" selects):
//   hello                      -> ready + derived
//   configure {…}              -> any subset of the parameters below; replies derived
//   run {mode:"curve"}         -> R(B) over the configured field grid
//   run {mode:"sweep",param,from,to,n,log}            -> family of curves + metrics per point
//   run {mode:"grid",param,from,to,n,log,param2,from2,to2,n2,log2}
//   run {mode:"coherent",eRange_meV,eN,kyN}            -> coherent sidebar
//   run {mode:"paths",B_mT,n}  -> sample trajectories for the device view
//   stop | reset | theme {light} | view {name}
// Messages out: ready, derived, progress, curve, sweep_start/sweep_point/
//   sweep_done, grid_start/grid_point/grid_done, coherent, paths, job, error.
#include "dex_plugin.h"
#include "dex_msg.h"
#include "klein_physics.h"
#include "klein_metrics.h"
#include "klein_runner.h"
#include "klein_coherent.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <deque>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#ifdef _OPENMP
#include <omp.h>
#endif

namespace {
using namespace klein;

constexpr int FRAME_W = 960, FRAME_H = 540;
constexpr const char *VERSION = "0.5.0";

double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

std::string jsonEscape(const std::string &s) {
    std::string o; o.reserve(s.size() + 8);
    for (char c : s) { if (c == '\\' || c == '"') { o.push_back('\\'); o.push_back(c); } else if (c == '\n') o += "\\n"; else if (static_cast<unsigned char>(c) >= 32) o.push_back(c); }
    return o;
}
std::string num(double v) { if (!std::isfinite(v)) return "null"; char b[32]; std::snprintf(b, sizeof b, "%.10g", v); return b; }
template <class V> std::string arr(const V &v, double scale = 1) { std::string o = "["; for (size_t i = 0; i < v.size(); ++i) { if (i) o += ','; o += num(v[i] * scale); } return o + "]"; }

int maxThreads() {
#ifdef _OPENMP
    return std::max(1, omp_get_max_threads());
#else
    return 1;
#endif
}

// ------------------------------------------------------------ settings
struct Settings {
    Params p;
    Engine engine = Engine::MC;
    long nTraj = 20000;
    FluxGrid grid{24, 257, true};
    int nEnergy = 1;
    uint64_t seed = 7;
    double bMin = -0.02, bMax = 0.02; int bN = 81;
    double fitWindow = 0; int sgHalf = 2; double mrField = 0.01;
    NoiseParams noise;
    int pathEvery = 0;
    int threads = 0;
    // coherent
    double eRangeMeV = 25; int eN = 251, kyN = 49;
};

CurveSpec specFrom(const Settings &s) {
    CurveSpec c; c.p = s.p; c.engine = s.engine; c.bVals = linspace(s.bMin, s.bMax, std::max(2, s.bN)); c.nTraj = s.nTraj; c.grid = s.grid;
    c.nEnergy = s.nEnergy; c.seed = s.seed; c.fitWindow = s.fitWindow; c.sgHalf = s.sgHalf; c.mrField = s.mrField; c.noise = s.noise; c.pathEvery = 0; c.pathsAt = -1;
    return c;
}

// sweepable parameters by name (SI inside; the names carry the unit)
bool setParam(Params &p, const std::string &name, double v) {
    if (name == "nCells") p.nCells = clampi(static_cast<int>(std::lround(v)), 1, 1000);
    else if (name == "L_um") p.Ln = p.Lp = v * 1e-6;
    else if (name == "Ln_um") p.Ln = v * 1e-6;
    else if (name == "Lp_um") p.Lp = v * 1e-6;
    else if (name == "W_um") p.W = v * 1e-6;
    else if (name == "n_cm2") p.nN = p.nP = v * 1e4;
    else if (name == "nN_cm2") p.nN = v * 1e4;
    else if (name == "nP_cm2") p.nP = v * 1e4;
    else if (name == "d_nm") p.d = v * 1e-9;
    else if (name == "skewDeg") p.skewDeg = v;
    else if (name == "sigmaPos_nm") p.sigmaPos = v * 1e-9;
    else if (name == "sigmaWidth") p.sigmaWidth = v;
    else if (name == "sigmaDensity") p.sigmaDensity = v;
    else if (name == "sigmaTiltDeg") p.sigmaTiltDeg = v;
    else if (name == "specularity") p.specularity = clampd(v, 0, 1);
    else if (name == "apertureFrac") p.apertureFrac = clampd(v, 0.01, 1);
    else if (name == "collimSigmaDeg") p.collimSigmaDeg = v;
    else if (name == "mfp_um") p.mfp = v * 1e-6;
    else if (name == "mfpPh300_um") p.mfpPh300 = v * 1e-6;
    else if (name == "tempK") p.tempK = v;
    else if (name == "forwardSigmaDeg") p.forwardSigmaDeg = v;
    else if (name == "eeMfp_um") p.eeMfp = v * 1e-6;
    else if (name == "eeSigmaDeg") p.eeSigmaDeg = v;
    else if (name == "maxPathFactor") p.maxPathFactor = std::max(1.0, v);
    else if (name == "vF") p.vF = v;
    else if (name == "disorderSeed") p.disorderSeed = static_cast<uint32_t>(std::max(0.0, v));
    else if (name == "leftContactFrac") p.leftFrac = clampd(v, 1e-3, 1);
    else if (name == "rightContactFrac") p.rightFrac = clampd(v, 1e-3, 1);
    else return false;
    return true;
}

void configure(Settings &s, const std::string &m) {
    Params &p = s.p;
    auto g = [&](const char *k, double fb) { return dexmsg::get_num(m, k, fb); };
    for (const char *k : {"nCells", "L_um", "Ln_um", "Lp_um", "W_um", "n_cm2", "nN_cm2", "nP_cm2", "d_nm", "skewDeg", "sigmaPos_nm", "sigmaWidth",
                          "sigmaDensity", "sigmaTiltDeg", "specularity", "apertureFrac", "collimSigmaDeg", "mfp_um", "mfpPh300_um", "tempK",
                          "forwardSigmaDeg", "eeMfp_um", "eeSigmaDeg", "maxPathFactor", "vF", "leftContactFrac", "rightContactFrac"}) {
        const double v = g(k, NAN);
        if (std::isfinite(v)) setParam(p, k, v);
    }
    p.unipolar = g("unipolar", p.unipolar ? 1 : 0) != 0;
    p.disorderSeed = static_cast<uint32_t>(g("disorderSeed", p.disorderSeed));
    p.fluxThreshold = clampd(g("fluxThreshold", p.fluxThreshold), 1e-9, 0.5);
    const std::string prof = dexmsg::get_str(m, "profile", ""); if (!prof.empty()) p.profile = profileFromName(prof);
    const std::string edge = dexmsg::get_str(m, "edge", "");
    if (edge == "specular") p.edge = EdgeModel::Specular; else if (edge == "diffuse") p.edge = EdgeModel::Diffuse; else if (edge == "absorbing") p.edge = EdgeModel::Absorbing;
    const std::string inj = dexmsg::get_str(m, "injection", "");
    if (inj == "cosine") p.injection = Injection::Cosine; else if (inj == "aperture") p.injection = Injection::Aperture; else if (inj == "collimated") p.injection = Injection::Collimated;
    const std::string sc = dexmsg::get_str(m, "scatter", "");
    if (sc == "none") p.scatter = Scatter::None; else if (sc == "drude") p.scatter = Scatter::Drude; else if (sc == "forward") p.scatter = Scatter::Forward;
    const std::string eng = dexmsg::get_str(m, "engine", "");
    if (eng == "mc") s.engine = Engine::MC; else if (eng == "flux") s.engine = Engine::Flux;
    s.nTraj = static_cast<long>(clampd(g("nTraj", static_cast<double>(s.nTraj)), 100, 5e7));
    s.grid.nY = clampi(static_cast<int>(g("fluxNY", s.grid.nY)), 1, 512); s.grid.nS = clampi(static_cast<int>(g("fluxNS", s.grid.nS)), 3, 8193);
    s.grid.jitter = g("fluxJitter", s.grid.jitter ? 1 : 0) != 0;
    s.nEnergy = clampi(static_cast<int>(g("nEnergy", s.nEnergy)), 1, 40);
    s.seed = static_cast<uint64_t>(g("seed", static_cast<double>(s.seed)));
    s.bMin = g("bMin_mT", s.bMin * 1e3) * 1e-3; s.bMax = g("bMax_mT", s.bMax * 1e3) * 1e-3;
    if (s.bMin > s.bMax) std::swap(s.bMin, s.bMax); s.bN = clampi(static_cast<int>(g("bN", s.bN)), 2, 2001);
    s.mrField = std::max(0.0, g("mrField_mT", s.mrField * 1e3)) * 1e-3;
    s.fitWindow = g("fitWindow_mT", s.fitWindow * 1e3) * 1e-3; s.sgHalf = clampi(static_cast<int>(g("sgHalf", s.sgHalf)), 1, 10);
    s.noise.biasA = g("biasA_uA", s.noise.biasA * 1e6) * 1e-6; s.noise.tempK = g("noiseTempK", s.noise.tempK);
    s.noise.hooge = std::max(0.0, g("hooge", s.noise.hooge)); s.noise.freqHz = std::max(1e-6, g("freqHz", s.noise.freqHz));
    s.pathEvery = clampi(static_cast<int>(g("pathEvery", s.pathEvery)), 0, 100000);
    s.threads = clampi(static_cast<int>(g("threads", s.threads)), 0, 256);
    s.eRangeMeV = clampd(g("eRange_meV", s.eRangeMeV), 0.1, 200); s.eN = clampi(static_cast<int>(g("eN", s.eN)), 3, 4001); s.kyN = clampi(static_cast<int>(g("kyN", s.kyN)), 4, 1024);
#ifdef _OPENMP
    omp_set_num_threads(s.threads > 0 ? s.threads : std::max(1, omp_get_num_procs()));
#endif
}

std::string paramsJson(const Settings &s) {
    const Params &p = s.p;
    std::ostringstream o; o.precision(10);
    o << "{\"nCells\":" << p.nCells << ",\"Ln_um\":" << p.Ln * 1e6 << ",\"Lp_um\":" << p.Lp * 1e6 << ",\"W_um\":" << p.W * 1e6
      << ",\"nN_cm2\":" << p.nN * 1e-4 << ",\"nP_cm2\":" << p.nP * 1e-4 << ",\"unipolar\":" << (p.unipolar ? 1 : 0)
      << ",\"profile\":\"" << profileName(p.profile) << "\",\"d_nm\":" << p.d * 1e9 << ",\"skewDeg\":" << p.skewDeg
      << ",\"sigmaPos_nm\":" << p.sigmaPos * 1e9 << ",\"sigmaWidth\":" << p.sigmaWidth << ",\"sigmaDensity\":" << p.sigmaDensity
      << ",\"sigmaTiltDeg\":" << p.sigmaTiltDeg << ",\"disorderSeed\":" << p.disorderSeed
      << ",\"edge\":\"" << (p.edge == EdgeModel::Specular ? "specular" : p.edge == EdgeModel::Diffuse ? "diffuse" : "absorbing") << "\",\"specularity\":" << p.specularity
      << ",\"injection\":\"" << (p.injection == Injection::Cosine ? "cosine" : p.injection == Injection::Aperture ? "aperture" : "collimated") << "\",\"apertureFrac\":" << p.apertureFrac
      << ",\"collimSigmaDeg\":" << p.collimSigmaDeg << ",\"leftContactFrac\":" << p.leftFrac << ",\"rightContactFrac\":" << p.rightFrac << ",\"vF\":" << p.vF << ",\"mfp_um\":" << p.mfp * 1e6 << ",\"mfpPh300_um\":" << p.mfpPh300 * 1e6
      << ",\"tempK\":" << p.tempK << ",\"scatter\":\"" << (p.scatter == Scatter::None ? "none" : p.scatter == Scatter::Drude ? "drude" : "forward") << "\""
      << ",\"forwardSigmaDeg\":" << p.forwardSigmaDeg << ",\"eeMfp_um\":" << p.eeMfp * 1e6 << ",\"eeSigmaDeg\":" << p.eeSigmaDeg
      << ",\"maxPathFactor\":" << p.maxPathFactor << ",\"fluxThreshold\":" << p.fluxThreshold
      << ",\"engine\":\"" << (s.engine == Engine::MC ? "mc" : "flux") << "\",\"nTraj\":" << s.nTraj << ",\"fluxNY\":" << s.grid.nY << ",\"fluxNS\":" << s.grid.nS
      << ",\"fluxJitter\":" << (s.grid.jitter ? 1 : 0) << ",\"nEnergy\":" << s.nEnergy << ",\"seed\":" << s.seed
      << ",\"bMin_mT\":" << s.bMin * 1e3 << ",\"bMax_mT\":" << s.bMax * 1e3 << ",\"bN\":" << s.bN << ",\"fitWindow_mT\":" << s.fitWindow * 1e3 << ",\"sgHalf\":" << s.sgHalf << ",\"mrField_mT\":" << s.mrField * 1e3
      << ",\"biasA_uA\":" << s.noise.biasA * 1e6 << ",\"noiseTempK\":" << s.noise.tempK << ",\"hooge\":" << s.noise.hooge << ",\"freqHz\":" << s.noise.freqHz
      << ",\"threads\":" << s.threads << ",\"eRange_meV\":" << s.eRangeMeV << ",\"eN\":" << s.eN << ",\"kyN\":" << s.kyN << ",\"version\":\"" << VERSION << "\"}";
    return o.str();
}

std::string metricsJson(const CurveMetrics &m) {
    std::ostringstream o;
    o << "{\"R0\":" << num(m.R0) << ",\"R0global\":" << num(m.R0global) << ",\"R0local\":" << num(m.R0local)
      << ",\"aGlobal\":" << num(m.aGlobal) << ",\"aLocal\":" << num(m.aLocal) << ",\"curvNorm\":" << num(m.curvNorm)
      << ",\"T0\":" << num(m.T0) << ",\"Rmin\":" << num(m.Rmin) << ",\"Rmax\":" << num(m.Rmax) << ",\"mrDepth\":" << num(m.mrDepth)
      << ",\"fwhm_mT\":" << num(m.fwhm * 1e3) << ",\"peakSlope\":" << num(m.peakSlope) << ",\"peakSlopeB_mT\":" << num(m.peakSlopeB * 1e3)
      << ",\"peakSens\":" << num(m.peakSens) << ",\"peakSensParabola\":" << num(m.peakSensParabola) << ",\"flankR\":" << num(m.flankR)
      << ",\"sv\":" << num(m.sv) << ",\"johnson\":" << num(m.johnson) << ",\"shot\":" << num(m.shot) << ",\"flicker\":" << num(m.flicker)
      << ",\"bMinFlank_nT\":" << num(m.bMinFlank * 1e9) << ",\"bMinVertex_nT\":" << num(m.bMinVertex * 1e9) << ",\"peakAtEdge\":" << (m.peakAtEdge ? 1 : 0) << ",\"mrField_mT\":" << num(m.mrField * 1e3) << ",\"mrAt\":" << num(m.mrAt)
      << ",\"mrEdge\":" << num(m.mrEdge) << ",\"cappedOverT\":" << num(m.cappedOverT) << "}";
    return o.str();
}

std::string curveJson(const CurveResult &r, const Settings &s, const std::string &tag = "curve", bool full = true) {
    std::vector<double> B, T, sT, R, sR, G, refl, lost, capped, path, edge, cross;
    for (const CurvePoint &p : r.pts) { B.push_back(p.B * 1e3); T.push_back(p.T); sT.push_back(p.sigmaT); R.push_back(p.R); sR.push_back(p.sigmaR); G.push_back(p.G);
        refl.push_back(p.reflected); lost.push_back(p.lost); capped.push_back(p.capped); path.push_back(p.meanPath * 1e6); edge.push_back(p.edgeFrac); cross.push_back(p.meanCross); }
    std::ostringstream o;
    o << "{\"t\":\"" << tag << "\",\"B_mT\":" << arr(B) << ",\"T\":" << arr(T) << ",\"sigmaT\":" << arr(sT) << ",\"R\":" << arr(R) << ",\"sigmaR\":" << arr(sR)
      << ",\"G\":" << arr(G) << ",\"metrics\":" << metricsJson(r.metrics) << ",\"modes\":" << (r.modes.empty() ? 0 : r.modes[0]) << ",\"modesEff\":" << num(r.modesEff)
      << ",\"ms\":" << num(r.ms) << ",\"carriers\":" << num(r.carriers) << ",\"mfpEff_um\":" << num(r.mfpEff * 1e6)
      << ",\"worstUnitarity\":" << num(r.worstUnitarity) << ",\"mismatch\":" << num(r.worstMismatch);
    if (full) {
        o << ",\"reflected\":" << arr(refl) << ",\"lost\":" << arr(lost) << ",\"capped\":" << arr(capped) << ",\"meanPath_um\":" << arr(path)
          << ",\"edgeFrac\":" << arr(edge) << ",\"meanCross\":" << arr(cross) << ",\"dRdB\":" << arr(r.metrics.dRdB) << ",\"nodes\":[";
        for (size_t i = 0; i < r.nodes.size(); ++i) { if (i) o << ','; o << "{\"eps_meV\":" << num(r.nodes[i].eps / E_CHARGE * 1e3) << ",\"w\":" << num(r.nodes[i].w) << '}'; }
        o << "],\"params\":" << paramsJson(s);
    }
    o << '}';
    return o.str();
}

// ------------------------------------------------------------ instance
enum class Job { Idle, Curve, Sweep, Grid, Coherent, Paths };

struct SweepAxis { std::string param; double from = 0, to = 1; int n = 2; bool log = false; std::vector<double> xs; };

struct Instance {
    Settings s;
    Job job = Job::Idle;
    std::unique_ptr<CurveJob> curve;
    std::unique_ptr<CoherentJob> coh;
    SweepAxis ax1, ax2;
    size_t sweepIndex = 0;
    std::vector<CurveResult> sweepResults;
    CurveResult last;                 // last curve (for the frame overlay)
    bool haveLast = false;
    PathSink paths; double pathsB = 0; int pathsN = 0; bool havePaths = false;
    DensityGrid dens; bool haveDens = false;
    long budget = 20000;              // adaptive work per advance()
    std::string view = "device";
    bool light = true;
    std::unique_ptr<Device> frameDev;  // built once per configure, not per frame
    bool frameDirty = true;
    std::vector<uint8_t> frame = std::vector<uint8_t>(static_cast<size_t>(FRAME_W) * FRAME_H * 4, 255);
    std::deque<std::string> outbox;
    std::string handout;
    std::chrono::steady_clock::time_point lastProgress;
};

void queueDerived(Instance &I, const std::string &tag = "") {
    const Settings &s = I.s;
    const Params &p = s.p;
    I.frameDev = std::make_unique<Device>(buildDevice(p));
    I.frameDirty = true;
    const Device &dv = *I.frameDev;
    const double kN = kfFromDensity(p.nN), kP = kfFromDensity(p.nP), kmin = std::min(kN, kP);
    const double EF = HBAR * p.vF * kN;
    const double bmax = std::max(std::abs(s.bMin), std::abs(s.bMax));
    const double rc = bmax > 0 ? HBAR * kmin / (E_CHARGE * bmax) : INF;
    const double t30 = dv.tables.empty() ? NAN : dv.tables[0].at(kN * std::sin(30 * PI / 180));
    const double a30 = asymptoticTransmission(kN, -kP, p.d, kN * std::sin(30 * PI / 180));
    std::ostringstream o;
    o << "{\"t\":\"derived\",\"kF\":" << num(kN) << ",\"EF_meV\":" << num(EF / E_CHARGE * 1e3) << ",\"lambdaF_nm\":" << num(2 * PI / kN * 1e9)
      << ",\"kFd\":" << num(kN * p.d) << ",\"h_nm\":" << num(p.d / PI * 1e9) << ",\"Rc_um\":" << num(rc * 1e6) << ",\"deltaPerCell_deg\":" << num(std::isfinite(rc) ? p.Ln / rc * 180 / PI : 0)
      << ",\"modes\":" << dv.modes << ",\"modesBottleneck\":" << dv.modesBottleneck << ",\"Ltot_um\":" << num(dv.Ltot * 1e6) << ",\"mfpEff_um\":" << num(dv.mfp * 1e6)
      << ",\"ballisticRatio\":" << num(dv.mfp < INF ? dv.Ltot / dv.mfp : 0) << ",\"junctions\":" << dv.junctions.size()
      // Transport (momentum-relaxation) length: a forward event with Gaussian kick sigma
      // relaxes momentum by 1 - <cos> = 1 - exp(-sigma^2/2), so l_tr = l_event / (1 - <cos>).
      // This, not l_event, is what a Hall-bar mobility measures: mu = e l_tr / (hbar k_F).
      << ",\"mfpTr_um\":" << num(dv.mfp < INF ? (p.scatter == Scatter::Forward ? dv.mfp / (1 - std::exp(-0.5 * sqr(p.forwardSigmaDeg * PI / 180))) : dv.mfp) * 1e6 : INF)
      << ",\"mobility_cm2Vs\":" << num(dv.mfp < INF ? (p.scatter == Scatter::Forward ? dv.mfp / (1 - std::exp(-0.5 * sqr(p.forwardSigmaDeg * PI / 180))) : dv.mfp) * E_CHARGE / (HBAR * kN) * 1e4 : INF)
      << ",\"T30\":" << num(t30) << ",\"T30asym\":" << num(a30) << ",\"worstUnitarity\":" << num(dv.worstUnitarity) << ",\"mismatch\":" << num(dv.worstMismatch)
      << ",\"window_nm\":" << num(dv.tables.empty() ? 0 : dv.tables[0].window * 1e9) << ",\"threads\":" << maxThreads()
      << ",\"kT_meV\":" << num(K_BOLTZ * p.tempK / E_CHARGE * 1e3) << ",\"tag\":\"" << jsonEscape(tag) << "\",\"params\":" << paramsJson(s) << "}";
    I.outbox.push_back(o.str());
}

void progress(Instance &I, const char *mode, double frac, size_t i, size_t total, bool force = false) {
    const auto now = std::chrono::steady_clock::now();
    if (!force && std::chrono::duration<double, std::milli>(now - I.lastProgress).count() < 120) return;
    I.lastProgress = now;
    std::ostringstream o; o << "{\"t\":\"progress\",\"mode\":\"" << mode << "\",\"frac\":" << num(frac) << ",\"i\":" << i << ",\"total\":" << total << '}';
    I.outbox.push_back(o.str());
}

void jobDone(Instance &I, const char *state = "done") { I.job = Job::Idle; I.curve.reset(); I.coh.reset(); I.outbox.push_back(std::string("{\"t\":\"job\",\"state\":\"") + state + "\"}"); }

std::vector<double> axisValues(const SweepAxis &a) {
    std::vector<double> v;
    const int n = std::max(2, a.n);
    for (int i = 0; i < n; ++i) {
        const double f = i / (n - 1.0);
        v.push_back(a.log && a.from > 0 && a.to > 0 ? std::exp(std::log(a.from) + (std::log(a.to) - std::log(a.from)) * f) : a.from + (a.to - a.from) * f);
    }
    return v;
}

void startCurveAt(Instance &I, size_t index) {
    Settings s = I.s;
    if (I.job == Job::Sweep) setParam(s.p, I.ax1.param, I.ax1.xs[index]);
    else if (I.job == Job::Grid) { setParam(s.p, I.ax1.param, I.ax1.xs[index % I.ax1.xs.size()]); setParam(s.p, I.ax2.param, I.ax2.xs[index / I.ax1.xs.size()]); }
    CurveSpec spec = specFrom(s);
    I.curve = std::make_unique<CurveJob>(spec);
}

void startRun(Instance &I, const std::string &m) {
    const std::string mode = dexmsg::get_str(m, "mode", "curve");
    I.job = Job::Idle; I.curve.reset(); I.coh.reset();
    if (mode == "curve") {
        CurveSpec spec = specFrom(I.s);
        spec.pathEvery = I.s.pathEvery;
        I.curve = std::make_unique<CurveJob>(spec);
        I.job = Job::Curve;
    } else if (mode == "sweep" || mode == "grid") {
        I.ax1.param = dexmsg::get_str(m, "param", "nCells"); I.ax1.from = dexmsg::get_num(m, "from", 2); I.ax1.to = dexmsg::get_num(m, "to", 32);
        I.ax1.n = clampi(static_cast<int>(dexmsg::get_num(m, "n", 6)), 2, 400); I.ax1.log = dexmsg::get_num(m, "log", 0) != 0; I.ax1.xs = axisValues(I.ax1);
        Params probe; if (!setParam(probe, I.ax1.param, 1)) { I.outbox.push_back("{\"t\":\"error\",\"message\":\"unknown sweep parameter " + jsonEscape(I.ax1.param) + "\"}"); return; }
        if (I.ax1.param == "nCells") for (double &x : I.ax1.xs) x = std::lround(x);
        if (mode == "grid") {
            I.ax2.param = dexmsg::get_str(m, "param2", "d_nm"); I.ax2.from = dexmsg::get_num(m, "from2", 5); I.ax2.to = dexmsg::get_num(m, "to2", 50);
            I.ax2.n = clampi(static_cast<int>(dexmsg::get_num(m, "n2", 4)), 2, 200); I.ax2.log = dexmsg::get_num(m, "log2", 0) != 0; I.ax2.xs = axisValues(I.ax2);
            if (!setParam(probe, I.ax2.param, 1)) { I.outbox.push_back("{\"t\":\"error\",\"message\":\"unknown grid parameter " + jsonEscape(I.ax2.param) + "\"}"); return; }
            if (I.ax2.param == "nCells") for (double &x : I.ax2.xs) x = std::lround(x);
        }
        I.sweepIndex = 0; I.sweepResults.clear();
        I.job = mode == "sweep" ? Job::Sweep : Job::Grid;
        std::ostringstream o;
        if (I.job == Job::Sweep) o << "{\"t\":\"sweep_start\",\"param\":\"" << jsonEscape(I.ax1.param) << "\",\"n\":" << I.ax1.xs.size() << ",\"xs\":" << arr(I.ax1.xs) << '}';
        else o << "{\"t\":\"grid_start\",\"param\":\"" << jsonEscape(I.ax1.param) << "\",\"param2\":\"" << jsonEscape(I.ax2.param) << "\",\"n\":" << I.ax1.xs.size() << ",\"n2\":" << I.ax2.xs.size()
               << ",\"xs\":" << arr(I.ax1.xs) << ",\"ys\":" << arr(I.ax2.xs) << '}';
        I.outbox.push_back(o.str());
        startCurveAt(I, 0);
    } else if (mode == "coherent") {
        CoherentSpec cs; cs.p = I.s.p; cs.eRange = I.s.eRangeMeV * 1e-3 * E_CHARGE; cs.eN = I.s.eN; cs.kyN = I.s.kyN;
        cs.eRange = clampd(dexmsg::get_num(m, "eRange_meV", I.s.eRangeMeV), 0.1, 200) * 1e-3 * E_CHARGE;
        cs.eN = clampi(static_cast<int>(dexmsg::get_num(m, "eN", I.s.eN)), 3, 4001); cs.kyN = clampi(static_cast<int>(dexmsg::get_num(m, "kyN", I.s.kyN)), 4, 1024);
        I.coh = std::make_unique<CoherentJob>(cs);
        I.job = Job::Coherent;
    } else if (mode == "angular") {
        const Params &p = I.s.p;
        const double kN = kfFromDensity(p.nN), kP = kfFromDensity(p.nP);
        const double kL = kN, kR = p.unipolar ? kP : -kP;
        const double cellHalf = 0.5 * std::min(p.Ln, p.Lp);
        const int nJ = std::max(0, p.nCells - 1);
        std::vector<double> th;
        for (int i = 0; i <= 178; ++i) th.push_back(i * 0.5);
        std::ostringstream o;
        o << "{\"t\":\"angular\",\"theta_deg\":" << arr(th) << ",\"kFd\":" << num(kN * p.d) << ",\"junctions\":" << nJ
          << ",\"selected\":\"" << profileName(p.profile) << "\",\"profiles\":{";
        const Profile profs[5] = {Profile::Gate, Profile::Linear, Profile::Tanh, Profile::Erf, Profile::Asymptotic};
        for (int k = 0; k < 5; ++k) {
            const JunctionTable t = buildTable(profs[k], kL, kR, p.d, cellHalf, 1024);
            std::vector<double> T;
            for (double d : th) T.push_back(t.at(kN * std::sin(d * PI / 180)));
            if (k) o << ',';
            o << '"' << profileName(profs[k]) << "\":{\"T\":" << arr(T) << ",\"unitarity\":" << num(t.worstUnitarity) << ",\"mismatch\":" << num(t.mismatch)
              << ",\"window_nm\":" << num(t.window * 1e9) << '}';
        }
        o << "},\"params\":" << paramsJson(I.s) << '}';
        I.outbox.push_back(o.str());
        I.outbox.push_back("{\"t\":\"job\",\"state\":\"done\"}");
        return;
    } else if (mode == "density") {
        const double B = dexmsg::get_num(m, "B_mT", 0) * 1e-3;
        const long n = static_cast<long>(clampd(dexmsg::get_num(m, "n", 200000), 100, 2e7));
        const int gx = clampi(static_cast<int>(dexmsg::get_num(m, "gx", 240)), 8, 800), gy = clampi(static_cast<int>(dexmsg::get_num(m, "gy", 120)), 8, 800);
        const bool first = dexmsg::get_num(m, "first", 1) != 0;
        if (!I.frameDev) I.frameDev = std::make_unique<Device>(buildDevice(I.s.p));
        const Device &dv = *I.frameDev;
        I.dens.init(dv, gx, gy, first);
        PointResult tot;
        const auto t0 = std::chrono::steady_clock::now();
#ifdef _OPENMP
#pragma omp parallel
#endif
        {
            DensityGrid g; g.init(dv, gx, gy, first);
            PointResult mine;
#ifdef _OPENMP
#pragma omp for schedule(dynamic, 1)
#endif
            for (int c = 0; c < 128; ++c) mine.add(runDensity(dv, B, I.s.seed, n * c / 128, n * (c + 1) / 128, g));
#ifdef _OPENMP
#pragma omp critical
#endif
            { tot.add(mine); I.dens.add(g); }
        }
        I.haveDens = true; I.havePaths = false; I.frameDirty = true;
        std::vector<double> w(I.dens.w.size());
        for (size_t k = 0; k < w.size(); ++k) w[k] = I.dens.w[k] / n * 1e6;   // um of path per trajectory per cell
        std::ostringstream o;
        o << "{\"t\":\"density\",\"B_mT\":" << num(B * 1e3) << ",\"n\":" << n << ",\"gx\":" << gx << ",\"gy\":" << gy << ",\"first\":" << (first ? 1 : 0)
          << ",\"L_um\":" << num(dv.Ltot * 1e6) << ",\"W_um\":" << num(dv.W * 1e6)
          << ",\"T\":" << num(tot.T()) << ",\"sigmaT\":" << num(tot.sigmaT()) << ",\"R\":" << num(tot.wR / tot.wSum) << ",\"Tdirect\":" << num(static_cast<double>(tot.directT) / tot.n) << ",\"lost\":" << num(tot.wLost / tot.wSum)
          << ",\"capped\":" << num(tot.wCapped / tot.wSum) << ",\"modes\":" << dv.modes
          << ",\"ms\":" << num(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count())
          << ",\"grid\":" << arr(w) << ",\"params\":" << paramsJson(I.s) << '}';
        I.outbox.push_back(o.str());
        I.outbox.push_back("{\"t\":\"job\",\"state\":\"done\"}");
        return;
    } else if (mode == "paths") {
        const double B = dexmsg::get_num(m, "B_mT", 0) * 1e-3;
        const int n = clampi(static_cast<int>(dexmsg::get_num(m, "n", 160)), 1, 5000);
        if (!I.frameDev) I.frameDev = std::make_unique<Device>(buildDevice(I.s.p));
        const Device &dv = *I.frameDev;
        I.paths = PathSink{}; I.paths.maxPoints = 200000;
        runMC(dv, B, I.s.seed, 0, n, &I.paths, 1);
        I.pathsB = B; I.pathsN = n; I.havePaths = true; I.haveDens = false; I.frameDirty = true;
        std::ostringstream o; o << "{\"t\":\"paths\",\"B_mT\":" << num(B * 1e3) << ",\"n\":" << n << ",\"points\":" << I.paths.xy.size() / 2 << '}';
        I.outbox.push_back(o.str());
        I.outbox.push_back("{\"t\":\"job\",\"state\":\"done\"}");
        return;
    } else { I.outbox.push_back("{\"t\":\"error\",\"message\":\"unknown run mode\"}"); return; }
    I.outbox.push_back("{\"t\":\"job\",\"state\":\"running\",\"mode\":\"" + jsonEscape(mode) + "\"}");
}

// one advance() tick of work; returns 1 if anything happened
int work(Instance &I) {
    if (I.job == Job::Idle) return 0;
    if (I.job == Job::Coherent) {
        const bool more = I.coh->step();
        progress(I, "coherent", I.coh->fraction(), 0, 0);
        if (!more) {
            const CoherentResult r = I.coh->result();
            std::ostringstream o;
            o << "{\"t\":\"coherent\",\"eps_meV\":" << arr(r.eps, 1e3 / E_CHARGE) << ",\"Tcoh\":" << arr(r.Tcoh) << ",\"worstUnit\":" << arr(r.worstUnit)
              << ",\"temps\":" << arr(r.temps) << ",\"visibility\":" << arr(r.visibility) << ",\"thermalCoh\":" << arr(r.thermalCoh) << ",\"thermalInc\":" << arr(r.thermalInc)
              << ",\"kyEff\":" << r.kyEff << ",\"TcohEF\":" << num(r.TcohEF) << ",\"TincEF\":" << num(r.TincEF) << ",\"Tinc\":" << arr(r.Tinc) << ",\"epsInc_meV\":" << arr(r.epsInc, 1e3 / E_CHARGE)
              << ",\"TincCoarse\":" << arr(r.TincCoarse) << ",\"ms\":" << num(r.ms) << ",\"smoothed\":[";
            for (size_t i = 0; i < r.smoothed.size(); ++i) { if (i) o << ','; o << arr(r.smoothed[i]); }
            o << "],\"params\":" << paramsJson(I.s) << '}';
            I.outbox.push_back(o.str());
            jobDone(I);
        }
        return 1;
    }
    if (!I.curve) { jobDone(I, "done"); return 1; }
    const auto t0 = std::chrono::steady_clock::now();
    const bool more = I.curve->step(I.budget);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    // aim for ~25 ms per tick so frames keep flowing
    if (ms > 1e-3) I.budget = static_cast<long>(clampd(I.budget * 25.0 / ms, 200, 2000000));
    const size_t total = I.job == Job::Curve ? 1 : (I.job == Job::Sweep ? I.ax1.xs.size() : I.ax1.xs.size() * I.ax2.xs.size());
    const double frac = (I.sweepIndex + I.curve->fraction()) / total;
    progress(I, I.job == Job::Curve ? "curve" : (I.job == Job::Sweep ? "sweep" : "grid"), frac, I.sweepIndex, total);
    if (more) return 1;
    CurveResult r = I.curve->finish();
    if (I.job == Job::Curve) {
        I.last = r; I.haveLast = true;
        I.outbox.push_back(curveJson(r, I.s));
        jobDone(I);
        return 1;
    }
    // sweep / grid point
    {
        Settings s = I.s;
        if (I.job == Job::Sweep) setParam(s.p, I.ax1.param, I.ax1.xs[I.sweepIndex]);
        else { setParam(s.p, I.ax1.param, I.ax1.xs[I.sweepIndex % I.ax1.xs.size()]); setParam(s.p, I.ax2.param, I.ax2.xs[I.sweepIndex / I.ax1.xs.size()]); }
        std::ostringstream o;
        if (I.job == Job::Sweep) o << "{\"t\":\"sweep_point\",\"i\":" << I.sweepIndex << ",\"x\":" << num(I.ax1.xs[I.sweepIndex]);
        else o << "{\"t\":\"grid_point\",\"i\":" << (I.sweepIndex % I.ax1.xs.size()) << ",\"j\":" << (I.sweepIndex / I.ax1.xs.size())
               << ",\"x\":" << num(I.ax1.xs[I.sweepIndex % I.ax1.xs.size()]) << ",\"y\":" << num(I.ax2.xs[I.sweepIndex / I.ax1.xs.size()]);
        o << ",\"curve\":" << curveJson(r, s, "curve", false) << '}';
        I.outbox.push_back(o.str());
        I.last = r; I.haveLast = true;
    }
    ++I.sweepIndex;
    if (I.sweepIndex >= total) { I.outbox.push_back(I.job == Job::Sweep ? "{\"t\":\"sweep_done\"}" : "{\"t\":\"grid_done\"}"); jobDone(I); return 1; }
    startCurveAt(I, I.sweepIndex);
    return 1;
}

// ------------------------------------------------------------ frame
struct RGB { double r, g, b; };
void pixel(Instance &I, int x, int y, RGB c, double a = 1) {
    if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return;
    uint8_t *p = &I.frame[(static_cast<size_t>(y) * FRAME_W + x) * 4];
    p[0] = static_cast<uint8_t>(clampd(p[0] * (1 - a) + c.r * a, 0, 255));
    p[1] = static_cast<uint8_t>(clampd(p[1] * (1 - a) + c.g * a, 0, 255));
    p[2] = static_cast<uint8_t>(clampd(p[2] * (1 - a) + c.b * a, 0, 255)); p[3] = 255;
}
void rect(Instance &I, int x0, int y0, int x1, int y1, RGB c, double a = 1) {
    x0 = clampi(x0, 0, FRAME_W); x1 = clampi(x1, 0, FRAME_W); y0 = clampi(y0, 0, FRAME_H); y1 = clampi(y1, 0, FRAME_H);
    for (int y = y0; y < y1; ++y) for (int x = x0; x < x1; ++x) pixel(I, x, y, c, a);
}
void line(Instance &I, int x0, int y0, int x1, int y1, RGB c, double a = 1, int thick = 1) {
    const int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1; int err = dx + dy;
    for (int guard = 0; guard < 100000; ++guard) {
        for (int oy = -thick / 2; oy <= thick / 2; ++oy) for (int ox = -thick / 2; ox <= thick / 2; ++ox) pixel(I, x0 + ox, y0 + oy, c, a);
        if (x0 == x1 && y0 == y1) break;
        const int e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

void paintFrame(Instance &I) {
    if (!I.frameDirty && I.frameDev) return;
    if (!I.frameDev) I.frameDev = std::make_unique<Device>(buildDevice(I.s.p));
    I.frameDirty = false;
    const bool L = I.light;
    const RGB bg = L ? RGB{247, 249, 252} : RGB{10, 15, 23};
    const RGB nCol = L ? RGB{221, 233, 252} : RGB{22, 42, 72};
    const RGB pCol = L ? RGB{253, 230, 216} : RGB{74, 38, 26};
    const RGB jCol = L ? RGB{70, 90, 120} : RGB{150, 170, 200};
    const RGB edge = L ? RGB{90, 110, 140} : RGB{104, 128, 160};
    for (size_t k = 0; k < I.frame.size(); k += 4) { I.frame[k] = static_cast<uint8_t>(bg.r); I.frame[k + 1] = static_cast<uint8_t>(bg.g); I.frame[k + 2] = static_cast<uint8_t>(bg.b); I.frame[k + 3] = 255; }
    const Device &dv = *I.frameDev;
    // fit the strip: x -> frame width, y -> height; keep the aspect ratio unless the strip is very long
    const int padX = 40, padY = 36, aw = FRAME_W - 2 * padX, ah = FRAME_H - 2 * padY;
    double asp = dv.Ltot / dv.W;
    int w, h;
    if (asp > aw / static_cast<double>(ah)) { w = aw; h = std::max(24, static_cast<int>(aw / asp)); }
    else { h = ah; w = std::max(24, static_cast<int>(ah * asp)); }
    const int x0 = (FRAME_W - w) / 2, y0 = (FRAME_H - h) / 2;
    auto px = [&](double x) { return x0 + static_cast<int>(x / dv.Ltot * w); };
    auto py = [&](double y) { return y0 + h - static_cast<int>(y / dv.W * h); };
    for (size_t c = 0; c < dv.cells.size(); ++c) {
        const Cell &cell = dv.cells[c];
        const bool isN = cell.k > 0;
        rect(I, px(cell.x0), y0, std::max(px(cell.x0) + 1, px(cell.x1)), y0 + h, isN ? nCol : pCol);
    }
    if (I.haveDens && !I.dens.w.empty()) {
        // sqrt scale so the faint caustics stay visible next to the bright source
        double mx = 0; for (double v : I.dens.w) mx = std::max(mx, v);
        const RGB lo = L ? RGB{255, 255, 255} : RGB{10, 15, 23}, hi = L ? RGB{13, 54, 107} : RGB{205, 226, 251};
        for (int yy = 0; yy < h; ++yy) for (int xx = 0; xx < w; ++xx) {
            const int i = std::min(I.dens.gx - 1, xx * I.dens.gx / w), j = std::min(I.dens.gy - 1, (h - 1 - yy) * I.dens.gy / h);
            const double v = mx > 0 ? std::sqrt(I.dens.w[static_cast<size_t>(j) * I.dens.gx + i] / mx) : 0;
            pixel(I, x0 + xx, y0 + yy, RGB{lo.r + (hi.r - lo.r) * v, lo.g + (hi.g - lo.g) * v, lo.b + (hi.b - lo.b) * v});
        }
    }
    {   // end-wall contacts (green), drawn when they do not span the full width
        const RGB cc{40, 170, 110};
        if (dv.leftHi - dv.leftLo < dv.W * 0.999) rect(I, x0 - 4, py(dv.leftHi), x0, py(dv.leftLo), cc);
        if (dv.rightHi - dv.rightLo < dv.W * 0.999) rect(I, x0 + w, py(dv.rightHi), x0 + w + 4, py(dv.rightLo), cc);
    }
    for (const Junction &j : dv.junctions) {
        const double xb = j.u + dv.skew * (0 - 0.5 * dv.W), xt = j.u + dv.skew * (dv.W - 0.5 * dv.W);
        line(I, px(xb), py(0), px(xt), py(dv.W), jCol, 0.7, 1);
    }
    if (I.havePaths) {
        const std::vector<float> &xy = I.paths.xy;
        float lx = NAN, ly = NAN;
        // colour by fate: the sink appends NaN + fate after each trajectory, so paint each trajectory once its fate is known
        size_t start = 0;
        for (size_t i = 0; i + 1 < xy.size(); i += 2) {
            if (std::isnan(xy[i])) {
                const int fate = static_cast<int>(xy[i + 1]);
                const RGB c = fate == 0 ? RGB{40, 170, 110} : fate == 1 ? RGB{235, 150, 50} : fate == 2 ? RGB{220, 80, 90} : RGB{150, 160, 180};
                for (size_t k = start + 2; k + 1 < i; k += 2) line(I, px(xy[k - 2]), py(xy[k - 1]), px(xy[k]), py(xy[k + 1]), c, 0.55, 1);
                start = i + 2;
            }
        }
        (void)lx; (void)ly;
    }
    line(I, x0, y0, x0 + w, y0, edge, 0.9); line(I, x0, y0 + h, x0 + w, y0 + h, edge, 0.9);
    line(I, x0, y0, x0, y0 + h, edge, 0.9); line(I, x0 + w, y0, x0 + w, y0 + h, edge, 0.9);
    // scale bar: 1 um
    const int bar = static_cast<int>(1e-6 / dv.Ltot * w);
    if (bar > 4 && bar < w) line(I, x0, y0 + h + 14, x0 + bar, y0 + h + 14, edge, 0.9, 3);
}

// ------------------------------------------------------------ protocol
void handleMessage(Instance &I, const std::string &m) {
    const std::string t = dexmsg::type_of(m);
    if (t == "configure") { configure(I.s, m); queueDerived(I, dexmsg::get_str(m, "tag", "")); }
    else if (t == "hello") { I.outbox.push_back(std::string("{\"t\":\"ready\",\"backend\":\"CPU / OpenMP\",\"threads\":") + std::to_string(maxThreads()) + ",\"version\":\"" + VERSION + "\"}"); queueDerived(I); }
    else if (t == "run") startRun(I, m);
    else if (t == "stop") jobDone(I, "stopped");
    else if (t == "theme") { I.light = dexmsg::get_num(m, "light", 1.0) != 0.0; I.frameDirty = true; }
    else if (t == "clear_paths") { I.havePaths = false; I.haveDens = false; I.frameDirty = true; }
    else if (t == "view") I.view = dexmsg::get_str(m, "name", I.view);
    else if (t == "reset") { I.s = Settings{}; I.havePaths = false; I.haveLast = false; jobDone(I, "stopped"); queueDerived(I); I.outbox.push_back("{\"t\":\"reset_done\"}"); }
}

void *create() {
    Instance *I = new Instance();
#ifdef _OPENMP
    omp_set_num_threads(std::max(1, omp_get_num_procs()));
#endif
    I->lastProgress = std::chrono::steady_clock::now();
    I->outbox.push_back(std::string("{\"t\":\"ready\",\"backend\":\"CPU / OpenMP\",\"threads\":") + std::to_string(maxThreads()) + ",\"version\":\"" + VERSION + "\"}");
    queueDerived(*I);
    return I;
}
void destroy(void *p) { delete static_cast<Instance *>(p); }
int advance(void *p, double) { return work(*static_cast<Instance *>(p)); }
void onMessage(void *p, const char *json, size_t len) { handleMessage(*static_cast<Instance *>(p), std::string(json, len)); }
const char *pollMessage(void *p) { Instance &I = *static_cast<Instance *>(p); if (I.outbox.empty()) return nullptr; I.handout = std::move(I.outbox.front()); I.outbox.pop_front(); return I.handout.c_str(); }
int render(void *p, dex_frame *out) { Instance &I = *static_cast<Instance *>(p); paintFrame(I); out->width = FRAME_W; out->height = FRAME_H; out->rgba = I.frame.data(); return 1; }

const dex_plugin_api API = {DEX_ABI_VERSION, "klein-magnetometer", "Klein Magnetometer Workbench", VERSION, create, destroy, advance, onMessage, pollMessage, render};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) { return &API; }
