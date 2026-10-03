// klein_runner.h — a resumable R(B) curve computation with thermal averaging.
//
// CurveJob::step(budget) does a bounded amount of work (one chunk of
// trajectories or quadrature nodes, parallelised with OpenMP) and returns
// whether work remains, so a DSW advance() call can keep frames flowing and
// Stop responsive. finish() assembles G(B) = sum_e w_e G0 M_e <T>_e(B), R = 1/G
// with propagated statistical errors, and the metrics.
#pragma once
#include "klein_physics.h"
#include "klein_metrics.h"
#include <chrono>
#include <string>
#include <vector>

namespace klein {

enum class Engine { MC, Flux };

struct CurveSpec {
    Params p;
    Engine engine = Engine::MC;
    std::vector<double> bVals;
    long nTraj = 20000;           // MC trajectories per (energy, B)
    FluxGrid grid;                // flux nodes per (energy, B)
    int nEnergy = 1;              // thermal nodes (1 = single energy)
    uint64_t seed = 7;
    double fitWindow = 0;         // 0 -> a third of the window
    double mrField = 0.01;        // field (T) for the fixed-field MR metric
    int sgHalf = 2;
    NoiseParams noise;
    int pathsAt = -1;             // B index at which to record sample paths (-1: none)
    int pathEvery = 0;            // record every n-th trajectory (0: none)
};

struct CurvePoint {
    double B = 0, T = 0, sigmaT = 0, G = 0, R = INF, sigmaR = 0;
    double reflected = 0, lost = 0, capped = 0, rouletted = 0, meanPath = 0, edgeFrac = 0, meanCross = 0;
};

struct CurveResult {
    std::vector<CurvePoint> pts;
    std::vector<EnergyNode> nodes;
    std::vector<int> modes;       // per energy node
    double modesEff = 0;          // sum w_e M_e
    double carriers = 0;          // N_c for the Hooge term
    CurveMetrics metrics;
    double ms = 0;
    PathSink paths;
    double worstUnitarity = 0, worstMismatch = 0, mfpEff = 0;
};

class CurveJob {
public:
    explicit CurveJob(const CurveSpec &spec) : spec_(spec) {
        nodes_ = energyNodes(spec_.p.tempK, spec_.nEnergy);
        for (const EnergyNode &e : nodes_) devices_.push_back(buildDevice(spec_.p, e.eps));
        acc_.assign(nodes_.size(), std::vector<PointResult>(spec_.bVals.size()));
        totalUnits_ = static_cast<double>(nodes_.size()) * spec_.bVals.size() * unitsPerPoint();
        start_ = std::chrono::steady_clock::now();
    }

    long unitsPerPoint() const { return spec_.engine == Engine::MC ? spec_.nTraj : spec_.grid.nodes(); }
    bool done() const { return ei_ >= nodes_.size(); }
    double fraction() const { return totalUnits_ > 0 ? std::min(1.0, doneUnits_ / totalUnits_) : 1; }
    size_t energyIndex() const { return ei_; }
    size_t fieldIndex() const { return bi_; }
    const Device &device(size_t e = 0) const { return devices_[std::min(e, devices_.size() - 1)]; }
    const std::vector<EnergyNode> &nodes() const { return nodes_; }

    // One chunk of at most `budget` trajectories / nodes. Returns true while
    // work remains.
    bool step(long budget) {
        if (done()) return false;
        const long per = unitsPerPoint();
        const long n0 = cursor_, n1 = std::min(per, cursor_ + std::max(1L, budget));
        const Device &dv = devices_[ei_];
        const double B = spec_.bVals[bi_];
        PointResult tot;
        const int chunks = 64;
        PathSink *sink = (spec_.engine == Engine::MC && static_cast<int>(bi_) == spec_.pathsAt && ei_ == 0 && spec_.pathEvery > 0) ? &paths_ : nullptr;
#ifdef _OPENMP
#pragma omp parallel
#endif
        {
            PointResult mine;
#ifdef _OPENMP
#pragma omp for schedule(dynamic, 1)
#endif
            for (int c = 0; c < chunks; ++c) {
                const long a = n0 + (n1 - n0) * c / chunks, b = n0 + (n1 - n0) * (c + 1) / chunks;
                if (a >= b) continue;
                if (spec_.engine == Engine::MC) {
                    PathSink local;
                    mine.add(runMC(dv, B, nodeSeed(), a, b, sink ? &local : nullptr, spec_.pathEvery));
                    if (sink && !local.xy.empty()) {
#ifdef _OPENMP
#pragma omp critical
#endif
                        { for (float v : local.xy) if (static_cast<int>(paths_.xy.size()) < 2 * paths_.maxPoints + 2) paths_.xy.push_back(v); }
                    }
                } else mine.add(runFlux(dv, B, nodeSeed(), spec_.grid, a, b));
            }
#ifdef _OPENMP
#pragma omp critical
#endif
            tot.add(mine);
        }
        acc_[ei_][bi_].add(tot);
        doneUnits_ += static_cast<double>(n1 - n0);
        cursor_ = n1;
        if (cursor_ >= per) { cursor_ = 0; if (++bi_ >= spec_.bVals.size()) { bi_ = 0; ++ei_; } }
        return !done();
    }

    CurveResult finish() const {
        CurveResult r;
        r.nodes = nodes_;
        const size_t nb = spec_.bVals.size();
        r.pts.resize(nb);
        double carriers = 0;
        for (size_t e = 0; e < nodes_.size(); ++e) {
            r.modes.push_back(devices_[e].modes);
            r.modesEff += nodes_[e].w * devices_[e].modes;
            r.worstUnitarity = std::max(r.worstUnitarity, devices_[e].worstUnitarity);
            r.worstMismatch = std::max(r.worstMismatch, devices_[e].worstMismatch);
        }
        {
            size_t e0 = 0; for (size_t e = 1; e < nodes_.size(); ++e) if (std::abs(nodes_[e].eps) < std::abs(nodes_[e0].eps)) e0 = e;
            const Device &d0 = devices_[e0];        // the device at (or nearest) E_F
            for (const Cell &c : d0.cells) carriers += (c.k * c.k / PI) * (c.x1 - c.x0) * d0.W;  // n = k^2/pi per cell
            r.carriers = carriers;
            r.mfpEff = d0.mfp;
        }
        for (size_t b = 0; b < nb; ++b) {
            CurvePoint &pt = r.pts[b];
            pt.B = spec_.bVals[b];
            double G = 0, varG = 0, wsum = 0;
            for (size_t e = 0; e < nodes_.size(); ++e) {
                const PointResult &pr = acc_[e][b];
                const double w = nodes_[e].w, M = devices_[e].modes;
                const double t = pr.T(), st = pr.sigmaT();
                G += w * G0 * M * t;
                varG += sqr(w * G0 * M * st);
                pt.T += w * t; pt.sigmaT += sqr(w * st);
                pt.reflected += w * (pr.wSum > 0 ? pr.wR / pr.wSum : 0);
                pt.lost += w * (pr.wSum > 0 ? pr.wLost / pr.wSum : 0);
                pt.capped += w * (pr.wSum > 0 ? pr.wCapped / pr.wSum : 0);
                pt.rouletted += w * (pr.n > 0 ? static_cast<double>(pr.rouletted) / pr.n : 0);
                pt.meanPath += w * (pr.n > 0 ? pr.sumPath / pr.n : 0);
                pt.edgeFrac += w * (pr.n > 0 ? static_cast<double>(pr.edgeTouched) / pr.n : 0);
                pt.meanCross += w * (pr.n > 0 ? pr.sumCross / pr.n : 0);
                wsum += w;
            }
            pt.sigmaT = std::sqrt(pt.sigmaT);
            pt.G = G;
            pt.R = G > 0 ? 1 / G : INF;
            pt.sigmaR = G > 0 ? std::sqrt(varG) / (G * G) : 0;
        }
        std::vector<double> B, R, sR, T, cap;
        for (const CurvePoint &pt : r.pts) { B.push_back(pt.B); R.push_back(pt.R); sR.push_back(pt.sigmaR); T.push_back(pt.T); cap.push_back(pt.capped); }
        double bmax = 0; for (double b : B) bmax = std::max(bmax, std::abs(b));
        NoiseParams noise = spec_.noise; noise.carriers = carriers;
        if (noise.tempK <= 0) noise.tempK = spec_.p.tempK;   // 0 = follow the device temperature
        r.metrics = analyseCurve(B, R, sR, T, spec_.fitWindow > 0 ? spec_.fitWindow : bmax / 3, spec_.sgHalf, noise, spec_.mrField, &cap);
        r.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start_).count();
        r.paths = paths_;
        return r;
    }

private:
    // Energy node e uses its own stream (node 0 keeps the user's seed, so single-energy
    // runs are unchanged). Shared streams made the nodes positively correlated while
    // their variances were summed as independent (review 2026-10-01: errors 16 % low).
    uint64_t nodeSeed() const { return ei_ == 0 ? spec_.seed : Rng::mix(spec_.seed ^ (0x9e3779b97f4a7c15ull * (ei_ + 1))); }
    CurveSpec spec_;
    std::vector<EnergyNode> nodes_;
    std::vector<Device> devices_;
    std::vector<std::vector<PointResult>> acc_;
    size_t ei_ = 0, bi_ = 0;
    long cursor_ = 0;
    double doneUnits_ = 0, totalUnits_ = 0;
    PathSink paths_;
    std::chrono::steady_clock::time_point start_;
};

// Convenience: run a whole curve synchronously.
inline CurveResult computeCurve(const CurveSpec &spec, long budget = 50000) {
    CurveJob job(spec);
    while (job.step(budget)) {}
    return job.finish();
}

inline std::vector<double> linspace(double a, double b, int n) {
    std::vector<double> v;
    if (n <= 1) { v.push_back(a); return v; }
    for (int i = 0; i < n; ++i) v.push_back(a + (b - a) * i / (n - 1.0));
    return v;
}

} // namespace klein
