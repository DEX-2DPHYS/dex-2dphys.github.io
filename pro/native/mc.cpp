// Monte Carlo transport — a line-by-line port of EBL Workbench src/core/mc/transport.js runBatch()
// with its helpers (rng.js, physics.js sampling). The physics TABLES are not ported: the page
// builds them with the JS code (buildTables) and sends them, so the physics exists once.
// What runs here is the per-electron loop, on every core, batch by batch.
//
// A batch is seeded by (seed, batch index) exactly as in JS (xoshiro128** via splitmix32), so a
// run does not depend on the number of threads. Results are statistically, not bitwise, equal to
// the JS run: libm's log/exp may differ from V8's in the last bit, and a trajectory diverges once
// one does.

#include "mc.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include "ompcompat.h"

namespace mc {

static const double MC2 = 510.99895;
static const double TWO_PI = 6.283185307179586;
static const double INF = std::numeric_limits<double>::infinity();

// ---------------------------------------------------------------- rng.js
struct Rng {
    uint32_t s0, s1, s2, s3;
    Rng(uint32_t seed, uint32_t stream) {
        uint32_t a = seed ^ (uint32_t)((stream + 1u) * 0x85ebca6bu);
        auto sm = [&a]() {
            a = a + 0x9e3779b9u;
            uint32_t t = a ^ (a >> 16);
            t = t * 0x21f0aaadu;
            t ^= t >> 15;
            t = t * 0x735a2d97u;
            return t ^ (t >> 15);
        };
        s0 = sm(); s1 = sm(); s2 = sm(); s3 = sm();
        if (!(s0 | s1 | s2 | s3)) s0 = 1;
    }
    inline double operator()() {
        const uint32_t m5 = s1 * 5u;
        const uint32_t r = ((m5 << 7) | (m5 >> 25)) * 9u;
        const uint32_t t = s1 << 9;
        s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
        s2 ^= t;
        s3 = (s3 << 11) | (s3 >> 21);
        return (r + 0.5) * 2.3283064365386963e-10;
    }
};

// ---------------------------------------------------------------- physics.js sampling
static double sampleSin2Half(double a, bool mottOn, double kappa0, double E, Rng &rng) {
    if (!mottOn) { const double r1 = rng(); return (a * r1) / (1 + a - r1); }
    const double g = 1 + E / MC2, b2 = 1 - 1 / (g * g), kap = kappa0 * std::sqrt(b2), mx = 1 + 0.25 * kap;
    for (;;) {
        const double r1 = rng();
        const double s2 = (a * r1) / (1 + a - r1);
        if (rng() * mx <= 1 - b2 * s2 + kap * (std::sqrt(s2) - s2)) return s2;
    }
}
static void rotateDir(double *d, double ct, double st, double cp, double sp) {
    const double u = d[0], v = d[1], w = d[2];
    double nu, nv, nw;
    if (std::fabs(w) < 0.99999) {
        const double sq = std::sqrt(1 - w * w), inv = 1 / sq;
        nu = st * (u * w * cp - v * sp) * inv + u * ct;
        nv = st * (v * w * cp + u * sp) * inv + v * ct;
        nw = -st * cp * sq + w * ct;
    } else { const double sg = w > 0 ? 1 : -1; nu = st * cp; nv = sg * st * sp; nw = sg * ct; }
    const double nrm = 1 / std::sqrt(nu * nu + nv * nv + nw * nw);
    d[0] = nu * nrm; d[1] = nv * nrm; d[2] = nw * nrm;
}
static void scatterDirection(double *d, double ct, double st, Rng &rng) {
    double pa, pb, ps;
    do { pa = 2 * rng() - 1; pb = 2 * rng() - 1; ps = pa * pa + pb * pb; } while (ps >= 1 || ps < 1e-12);
    rotateDir(d, ct, st, (pa * pa - pb * pb) / ps, (2 * pa * pb) / ps);
}
static double sampleMoller(double E, double Wc, Rng &rng) {
    const double tau = E / MC2, g = tau + 1, c = (tau / g) * (tau / g), d = (2 * tau + 1) / (g * g), ec = Wc / E;
    auto gf = [&](double e) { const double x = e / (1 - e); return 1 + x * x + c * e * e - d * x; };
    const double gmax = std::max(gf(ec), gf(0.5)) * 1.0001;
    for (;;) {
        const double e = 1 / (1 / ec - rng() * (1 / ec - 2));
        if (rng() * gmax <= gf(e)) return e * E;
    }
}
static inline double cosKnockOn(double E, double W) { return std::sqrt(std::min(1.0, (W * (E + 2 * MC2)) / (E * (W + 2 * MC2)))); }

// ---------------------------------------------------------------- setup (createTransport)
static std::vector<double> arr(const json &j) {
    std::vector<double> v;
    v.reserve(j.size());
    for (const auto &x : j) v.push_back(x.is_null() ? INF : x.get<double>());
    return v;
}

void Transport::init(const json &cfg, const json &tables) {
    E0 = cfg.at("E0").get<double>();
    Ecut = cfg.value("Ecut", 0.5);
    beamA = cfg.value("beamA", 0.0);
    tallyL = cfg.value("tallyLayer", 0);
    const bool rangeRejection = cfg.value("rangeRejection", true);
    r0 = cfg.value("r0", 0.25);
    perLn = cfg.value("perDecade", 25.0) / std::log(10.0);
    const double rMax = cfg.contains("rMax") && !cfg["rMax"].is_null() && cfg["rMax"].get<double>() > 0 ? cfg["rMax"].get<double>() : 2e5;
    nz = std::max(1, cfg.value("nz", 1));

    lnLo = tables.at("lnLo").get<double>();
    dln = tables.at("dln").get<double>();
    NE = tables.at("NE").get<int>();
    mats.clear();
    for (const auto &m : tables.at("mats")) {
        Mat M;
        M.nEl = m.at("nEl").get<int>();
        M.Z = arr(m.at("Z")); M.kappa0 = arr(m.at("kappa0"));
        for (const auto &x : m.at("mottOn")) M.mottOn.push_back((uint8_t)x.get<int>());
        M.relScreen = m.at("relScreen").get<bool>();
        M.invLam = arr(m.at("invLam")); M.elCum = arr(m.at("elCum")); M.S = arr(m.at("S"));
        M.lnR = arr(m.at("lnR")); M.invLnE = arr(m.at("invLnE")); M.invE = arr(m.at("invE"));
        M.invLamM = arr(m.at("invLamM"));
        M.r0 = m.at("r0").get<double>(); M.dr = m.at("dr").get<double>(); M.NI = m.at("NI").get<int>();
        M.hybrid = m.at("hybrid").get<bool>(); M.wcut = m.at("wcut").get<double>();
        mats.push_back(std::move(M));
    }
    // layers: keys in order of first appearance, as in JS
    std::vector<std::string> keys;
    const auto &layers = cfg.at("layers");
    nL = (int)layers.size();
    zTop.assign(nL, 0); zBot.assign(nL, 0); matOf.assign(nL, 0);
    double z = 0;
    for (int i = 0; i < nL; i++) {
        const std::string k = layers[i].at("mat").get<std::string>();
        auto it = std::find(keys.begin(), keys.end(), k);
        if (it == keys.end()) { keys.push_back(k); it = keys.end() - 1; }
        const auto &th = layers[i]["thickness"];
        const double t = th.is_number() ? th.get<double>() : -1;
        zTop[i] = z; z += t > 0 ? t : INF; zBot[i] = z; matOf[i] = (int)(it - keys.begin());
    }
    if ((int)mats.size() != (int)keys.size()) throw std::runtime_error("tables do not match the layer materials");
    tz0 = zTop[tallyL]; tz1 = zBot[tallyL]; tThick = tz1 - tz0;

    Rcut.clear(); Zpow.clear();
    for (const auto &m : mats) {
        const double u = (std::log(Ecut) - lnLo) / dln; const int i = (int)std::floor(u); const double f = u - i;
        Rcut.push_back(std::exp(m.lnR[i] + f * (m.lnR[i + 1] - m.lnR[i])));
        std::vector<double> zp;
        for (double Zv : m.Z) zp.push_back(3.4e-3 * std::pow(Zv, 0.67));
        Zpow.push_back(zp);
    }
    std::vector<int> below;
    for (int i = tallyL + 1; i < nL; i++) if (std::find(below.begin(), below.end(), matOf[i]) == below.end()) below.push_back(matOf[i]);
    envR.clear();
    if (!below.empty() && rangeRejection) {
        envR.assign(NE, 0);
        auto Smin = [&](int i) { double s = INF; for (int k : below) s = std::min(s, mats[k].S[i]); return s; };
        double R = std::exp(lnLo) / Smin(0);
        envR[0] = R;
        for (int i = 1; i < NE; i++) {
            const double Ea = std::exp(lnLo + (i - 1) * dln), Eb = std::exp(lnLo + i * dln);
            R += 0.5 * (Ea / Smin(i - 1) + Eb / Smin(i)) * dln;
            envR[i] = R;
        }
    }
    nR = 2 + (int)std::ceil(std::log(rMax / r0) * perLn);
    lnr0 = std::log(r0);
    ready = true;
}

// ---------------------------------------------------------------- runBatch
struct Batch {
    std::vector<double> tally, depLayer;
    double bsEnergy = 0, trEnergy = 0, depFwd = 0, depBack = 0;
    long long bsCount = 0, trCount = 0, killed = 0, steps = 0;
};

struct Pending { double x, y, z, u, v, w, E; int L; bool back; };

static void runBatch(const Transport &T, int n, uint32_t seed, uint32_t batch, Batch &B) {
    Rng rng(seed, batch);
    const int nR = T.nR, nz = T.nz, nL = T.nL, tallyL = T.tallyL, NE = T.NE;
    B.tally.assign((size_t)nR * nz, 0.0);
    B.depLayer.assign(nL, 0.0);
    const double r0 = T.r0, lnr0 = T.lnr0, perLn = T.perLn, tz0 = T.tz0, tz1 = T.tz1, tThick = T.tThick;
    const double lnLo = T.lnLo, dln = T.dln, Ecut = T.Ecut;
    const bool haveEnv = !T.envR.empty();
    std::vector<Pending> stack;

    auto deposit = [&](double x1, double y1, double z1, double x2, double y2, double z2, double dE) {
        const double dx = x2 - x1, dy = y2 - y1;
        const double L = std::sqrt(dx * dx + dy * dy);
        int k = 1;
        if (L > 0) {
            const double rm = std::min(std::sqrt(x1 * x1 + y1 * y1), std::sqrt(x2 * x2 + y2 * y2));
            k = (int)std::min(64.0, 1 + std::floor(L / (0.25 * rm + 0.05)));
        }
        const double q = dE / k;
        for (int j = 0; j < k; j++) {
            const double t = (j + 0.5) / k;
            const double x = x1 + dx * t, y = y1 + dy * t, zz = z1 + (z2 - z1) * t;
            const double r = std::sqrt(x * x + y * y);
            int b = r < r0 ? 0 : 1 + (int)std::floor((std::log(r) - lnr0) * perLn);
            if (b >= nR) b = nR - 1;
            int iz = nz > 1 ? (int)std::floor(((zz - tz0) / tThick) * nz) : 0;
            if (iz < 0) iz = 0; else if (iz >= nz) iz = nz - 1;
            B.tally[(size_t)iz * nR + b] += q;
        }
    };

    double dir[3], dirS[3];
    auto track = [&](double x, double y, double zz, double u, double v, double w, double E, int L, bool back, bool primary) {
        int mi = T.matOf[L];
        const Mat *m = &T.mats[mi];
        double lnE = std::log(E);
        double ui = (lnE - lnLo) / dln; int ii = (int)std::floor(ui); double fi = ui - ii;
        double lnR = m->lnR[ii] + fi * (m->lnR[ii + 1] - m->lnR[ii]), R = std::exp(lnR);
        for (;;) {
            B.steps++;
            const double invLamE = m->invLam[ii] + fi * (m->invLam[ii + 1] - m->invLam[ii]);
            const double invLamM = m->hybrid ? m->invLamM[ii] + fi * (m->invLamM[ii + 1] - m->invLamM[ii]) : 0;
            const double invLam = invLamE + invLamM;
            const double sEl = -std::log(rng()) / invLam;
            const double sB = w > 0 ? (T.zBot[L] - zz) / w : w < 0 ? (T.zTop[L] - zz) / w : INF;
            const double sStop = R - T.Rcut[mi];
            double s = sEl; int kind = 0;
            if (sB < s) { s = sB; kind = 1; }
            const double cap = 0.08 * R;
            if (cap < s) { s = cap; kind = 2; }
            if (sStop <= s) { s = sStop > 0 ? sStop : 0; kind = 3; }

            const double x1 = x, y1 = y, z1 = zz;
            x += u * s; y += v * s; zz += w * s;
            double Enew;
            if (kind == 3) Enew = Ecut;
            else {
                R -= s;
                lnR = std::log(R);
                const double uq = (lnR - m->r0) / m->dr;
                const int iq = uq <= 0 ? 0 : uq >= m->NI - 1 ? m->NI - 2 : (int)std::floor(uq);
                const double fq = uq - iq;
                lnE = m->invLnE[iq] + fq * (m->invLnE[iq + 1] - m->invLnE[iq]);
                Enew = m->invE[iq] + fq * (m->invE[iq + 1] - m->invE[iq]);
            }
            const double dE = E - Enew;
            B.depLayer[L] += dE;
            if (L == tallyL && dE > 0) { deposit(x1, y1, z1, x, y, zz, dE); if (back) B.depBack += dE; else B.depFwd += dE; }
            E = Enew;

            if (kind == 3) {
                B.depLayer[L] += E;
                if (L == tallyL) { deposit(x, y, zz, x, y, zz, E); if (back) B.depBack += E; else B.depFwd += E; }
                break;
            }
            if (kind == 1) {
                if (w > 0) { zz = T.zBot[L]; L++; } else { zz = T.zTop[L]; L--; }
                if (L < 0) { if (primary) B.bsCount++; B.bsEnergy += E; break; }
                if (L >= nL) { B.trCount++; B.trEnergy += E; break; }
                if (L > tallyL) back = true;
                mi = T.matOf[L]; m = &T.mats[mi];
                ui = (lnE - lnLo) / dln; ii = (int)std::floor(ui); fi = ui - ii;
                lnR = m->lnR[ii] + fi * (m->lnR[ii + 1] - m->lnR[ii]); R = std::exp(lnR);
                continue;
            }
            ui = (lnE - lnLo) / dln; ii = (int)std::floor(ui); fi = ui - ii;
            if (kind == 0 && invLamM > 0 && rng() * invLam < invLamM) {
                const double W = sampleMoller(E, m->wcut, rng), E1 = E - W;
                const double cs = cosKnockOn(E, W), cpr = cosKnockOn(E, E1);
                double pa, pb, ps;
                do { pa = 2 * rng() - 1; pb = 2 * rng() - 1; ps = pa * pa + pb * pb; } while (ps >= 1 || ps < 1e-12);
                const double cph = (pa * pa - pb * pb) / ps, sph = (2 * pa * pb) / ps;
                dirS[0] = u; dirS[1] = v; dirS[2] = w;
                rotateDir(dirS, cs, std::sqrt(1 - cs * cs), -cph, -sph);
                stack.push_back({x, y, zz, dirS[0], dirS[1], dirS[2], W, L, back});
                dir[0] = u; dir[1] = v; dir[2] = w;
                rotateDir(dir, cpr, std::sqrt(1 - cpr * cpr), cph, sph);
                u = dir[0]; v = dir[1]; w = dir[2];
                E = E1; lnE = std::log(E);
                ui = (lnE - lnLo) / dln; ii = (int)std::floor(ui); fi = ui - ii;
                lnR = m->lnR[ii] + fi * (m->lnR[ii + 1] - m->lnR[ii]); R = std::exp(lnR);
                if (R <= T.Rcut[mi]) { B.depLayer[L] += E; if (L == tallyL) { deposit(x, y, zz, x, y, zz, E); if (back) B.depBack += E; else B.depFwd += E; } break; }
            } else if (kind == 0) {
                const int nEl = m->nEl;
                int j = 0;
                if (nEl > 1) { const double ru = rng(); const int base = ii * nEl; while (j < nEl - 1 && ru > m->elCum[base + j]) j++; }
                const double a = T.Zpow[mi][j] / (m->relScreen ? E * (1 + E / 1021.9979) : E);
                const double s2 = sampleSin2Half(a, m->mottOn[j] != 0, m->kappa0[j], E, rng);
                dir[0] = u; dir[1] = v; dir[2] = w;
                scatterDirection(dir, 1 - 2 * s2, 2 * std::sqrt(s2 * (1 - s2)), rng);
                u = dir[0]; v = dir[1]; w = dir[2];
            }
            if (haveEnv && L > tallyL && ii + 1 < NE && zz - tz1 > T.envR[ii + 1]) { if (primary) B.killed++; B.depLayer[L] += E; break; }
        }
    };

    for (int e = 0; e < n; e++) {
        double x = 0, y = 0;
        if (T.beamA > 0) { const double rb = T.beamA * std::sqrt(-std::log(rng())), ph = TWO_PI * rng(); x = rb * std::cos(ph); y = rb * std::sin(ph); }
        track(x, y, 0, 0, 0, 1, T.E0, 0, false, true);
        while (!stack.empty()) { const Pending s = stack.back(); stack.pop_back(); track(s.x, s.y, s.z, s.u, s.v, s.w, s.E, s.L, s.back, false); }
    }
}

// ---------------------------------------------------------------- batches, merged as result.js addBatch does
json Transport::runBatches(int perBatch, uint32_t seed, int from, int count, int threads) const {
    if (!ready) throw std::runtime_error("mc not initialised");
    std::vector<Batch> out(count);
    if (threads <= 0) threads = std::max(1, omp_get_num_procs() - 1);
    const double t0 = omp_get_wtime();
#pragma omp parallel for schedule(dynamic, 1) num_threads(threads)
    for (int k = 0; k < count; k++) runBatch(*this, perBatch, seed, (uint32_t)(from + k), out[k]);
    // merge: sums, plus Σ (per-electron radial value)² · n per batch (between-batch variance)
    std::vector<double> sum((size_t)nR * nz, 0.0), sum2(nR, 0.0), dep(nL, 0.0);
    double bsE = 0, trE = 0, fwd = 0, bk = 0;
    long long bsC = 0, trC = 0, kil = 0, st = 0;
    for (const Batch &b : out) {
        for (size_t q = 0; q < b.tally.size(); q++) sum[q] += b.tally[q];
        for (int i = 0; i < nR; i++) {
            double t = 0;
            for (int z = 0; z < nz; z++) t += b.tally[(size_t)z * nR + i];
            const double perE = t / perBatch;
            sum2[i] += perE * perE * perBatch;
        }
        for (int q = 0; q < nL; q++) dep[q] += b.depLayer[q];
        bsC += b.bsCount; bsE += b.bsEnergy; trC += b.trCount; trE += b.trEnergy; kil += b.killed; st += b.steps;
        fwd += b.depFwd; bk += b.depBack;
    }
    return {{"n", (long long)perBatch * count}, {"batches", count}, {"sum", sum}, {"sum2", sum2}, {"depLayer", dep},
            {"bsCount", bsC}, {"bsEnergy", bsE}, {"trCount", trC}, {"trEnergy", trE}, {"killed", kil}, {"steps", st},
            {"depFwd", fwd}, {"depBack", bk}, {"threads", threads}, {"seconds", omp_get_wtime() - t0}};
}

} // namespace mc
