// Short-range dose of polygons at points, for the fractured correction (the 'srRows' request).
// A line-by-line port of polygonSR / srAt / srOperator in the page's src/core/exposure/shortrange.js
// and engine.js, run on all cores. The page collects the polygons (cell hierarchy, arrays, dose scale)
// and sends them flat; the kernel comes as Gaussian terms (exact, or the page's accepted fit).
#pragma once
#include <cstdint>
#include <vector>

namespace sr {

struct Kernel {
    std::vector<double> w, s;   // Gaussian terms
    bool exact = true;          // false: a fitted sum (then only Manhattan polygons are accepted)
    double total = 0, rMax = 0, eps = 1e-10;
};

struct Polys {
    std::vector<int32_t> off;   // polygon k has vertices off[k] .. off[k+1]-1
    std::vector<double> xy;     // x0 y0 x1 y1 ...
    std::vector<double> dose;
    std::vector<int32_t> key;
};

// targets: dose at every point (sum over polygons of dose · polygonSR)
std::vector<double> doseAt(const Kernel &K, const Polys &P, const std::vector<double> &pts, int threads);

// operator: per point, Σ over polygons of dose · polygonSR, aggregated by key (CSR)
struct Rows { std::vector<int32_t> ptr, idx; std::vector<double> val; };
Rows rows(const Kernel &K, const Polys &P, const std::vector<double> &pts, int threads);

// one polygon at one point (exposed for the test)
double polygonSR(const Kernel &K, const double *xy, int n, double x, double y);

}  // namespace sr
