// Monte Carlo transport, native (see mc.cpp).
#pragma once
#include "json.hpp"
#include <cstdint>
#include <string>
#include <vector>

namespace mc {
using json = nlohmann_lmp::json;

struct Mat {
    int nEl = 0, NI = 0;
    std::vector<double> Z, kappa0, invLam, elCum, S, lnR, invLnE, invE, invLamM;
    std::vector<uint8_t> mottOn;
    bool relScreen = true, hybrid = false;
    double r0 = 0, dr = 0, wcut = 1;
};

struct Transport {
    bool ready = false;
    double E0 = 0, Ecut = 0.5, beamA = 0, r0 = 0.25, perLn = 0, lnr0 = 0, lnLo = 0, dln = 0;
    double tz0 = 0, tz1 = 0, tThick = 0;
    int tallyL = 0, nL = 0, nR = 0, nz = 1, NE = 0;
    std::vector<Mat> mats;
    std::vector<double> zTop, zBot, Rcut, envR;
    std::vector<int> matOf;
    std::vector<std::vector<double>> Zpow;

    // cfg: the transport's merged config (createTransport(cfg).cfg); tables: buildTables output
    void init(const json &cfg, const json &tables);
    // batches [from, from+count) of perBatch electrons, merged like result.js addBatch
    json runBatches(int perBatch, uint32_t seed, int from, int count, int threads) const;
};
} // namespace mc
