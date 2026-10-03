// pecSolve's JSON → pec::Problem / pec::LR (shared by plugin.cpp and test/pectest.cpp).
#pragma once
#include "json.hpp"
#include "pec.h"
#include <stdexcept>

template <class T> inline std::vector<T> vecOr(const nlohmann_lmp::json &j, const char *key) {
    if (!j.contains(key) || j.at(key).is_null()) return {};
    return j.at(key).get<std::vector<T>>();
}

inline pec::Problem parseProblem(const nlohmann_lmp::json &m) {
    const auto &pj = m.at("prob");
    pec::Problem P;
    P.nF = pj.at("nF").get<int>(); P.nP = pj.at("nP").get<int>();
    P.contour = pj.at("contour").get<bool>(); P.longOnly = pj.at("longOnly").get<bool>();
    P.srSelf = pj.value("srSelf", 0.0);
    P.ptWant = vecOr<double>(pj, "ptWant"); P.ptW = vecOr<double>(pj, "ptW"); P.ptBand = vecOr<uint8_t>(pj, "ptBand");
    P.d0 = vecOr<double>(pj, "d0"); P.base = vecOr<double>(pj, "base"); P.k = vecOr<double>(pj, "k"); P.want = vecOr<double>(pj, "want");
    P.banded = vecOr<uint8_t>(pj, "banded");
    P.maxFactor = pj.at("maxFactor").get<double>(); P.floor = pj.at("floor").get<double>(); P.tol = pj.at("tol").get<double>();
    P.maxIter = pj.at("maxIter").get<int>(); P.bLo = pj.at("bLo").get<double>(); P.bHi = pj.at("bHi").get<double>(); P.classes = pj.at("classes").get<int>();
    P.pts = m.at("pts").get<std::vector<double>>();
    const size_t nF = P.nF, nP = P.nP;
    if (P.d0.size() != nF || P.base.size() != nF || P.k.size() != nF || P.want.size() != nF || P.banded.size() != nF || P.pts.size() != 2 * nP || P.classes < 1)
        throw std::runtime_error("pecSolve: inconsistent problem");
    if (P.contour && (P.ptWant.size() != nP || P.ptW.size() != nP || P.ptBand.size() != nP)) throw std::runtime_error("pecSolve: contour targets missing");
    return P;
}

inline pec::LR parseLR(const nlohmann_lmp::json &m) {
    pec::LR L;
    if (!m.contains("lr") || m.at("lr").is_null()) return L;
    const auto &lj = m.at("lr");
    L.on = true;
    L.K = lj.at("K").get<std::vector<int32_t>>(); L.Cl = lj.at("Cl").get<std::vector<int32_t>>(); L.Wt = lj.at("Wt").get<std::vector<double>>();
    const auto &sj = lj.at("spec");
    L.re = sj.at("re").get<std::vector<double>>(); L.im = sj.at("im").get<std::vector<double>>();
    L.NX = sj.at("NX").get<int>(); L.NY = sj.at("NY").get<int>();
    const auto &gj = lj.at("grid");
    L.x0 = gj.at("x0").get<double>(); L.y0 = gj.at("y0").get<double>(); L.dx = gj.at("dx").get<double>();
    L.nx = gj.at("nx").get<int>(); L.ny = gj.at("ny").get<int>();
    if (L.K.size() != L.Cl.size() || L.K.size() != L.Wt.size() || L.re.size() != (size_t)L.NX * L.NY || L.im.size() != L.re.size() || L.nx < 2 || L.ny < 2 || L.nx > L.NX || L.ny > L.NY)
        throw std::runtime_error("pecSolve: inconsistent long-range operator");
    for (auto c : L.Cl) if (c < 0 || c >= L.nx * L.ny) throw std::runtime_error("pecSolve: long-range cell out of range");
    return L;
}
