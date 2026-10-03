// The fractured correction's global solve and dose classes (the 'pecSolve' request).
// A line-by-line port of solveFractured in the page's src/core/pec/fractured.js, with the long-range
// operator of engine.js lrOperator (weighted gather onto the β grid, FFT convolution with the
// spectrum the page computed, bilinear sampling) and the short-range rows the core kept from the
// 'srRows' request, so the operator never travels back to the page.
#pragma once
#include "sr.h"
#include <cstdint>
#include <vector>

namespace pec {

struct LR {                       // engine.js lrOperator(...).data
    bool on = false;
    std::vector<int32_t> K, Cl;   // per entry: fragment, grid cell
    std::vector<double> Wt;       // per entry: coverage weight
    std::vector<double> re, im;   // kernel spectrum, NX × NY
    int NX = 0, NY = 0;
    double x0 = 0, y0 = 0, dx = 1;
    int nx = 0, ny = 0;
};

struct Problem {                  // fractured.js prob
    int nF = 0, nP = 0;
    bool contour = false, longOnly = false;
    double srSelf = 0;
    std::vector<double> ptWant, ptW;  // contour fit only
    std::vector<uint8_t> ptBand;
    std::vector<double> d0, base, k, want;
    std::vector<uint8_t> banded;
    double maxFactor = 8, floor = 0.125, tol = 0.003;
    int maxIter = 40;
    double bLo = 0.75, bHi = 1.5;
    int classes = 64;
    std::vector<double> pts;      // x0 y0 x1 y1 ... (the long-range sampling points)
};

struct Result {
    std::vector<double> write, classes, gotQ, history;
    std::vector<int32_t> cls;
    int it = 0;
    double err = 0, lo = 0, hi = 0;
};

Result solve(const Problem &P, const sr::Rows &SR, const LR &L, int threads);

}  // namespace pec
