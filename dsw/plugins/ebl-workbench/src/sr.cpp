// See sr.h. Kept as close to the JavaScript as C++ allows, so the two can be compared line by line.
#include "sr.h"

#include <algorithm>
#include <cmath>
#include "ompcompat.h"
#include <unordered_map>

namespace sr {
namespace {

const double PI = 3.14159265358979323846;

// C(R) = Σ w (1 − exp(−R²/s²)): energy of the Gaussian terms inside radius R (termsCumulative)
inline double C(const Kernel &K, double R) {
    double v = 0;
    for (size_t t = 0; t < K.w.size(); t++) v += K.w[t] * (1 - std::exp(-(R * R) / (K.s[t] * K.s[t])));
    return v;
}

// adaptive Simpson, as in shortrange.js
template <class F>
double simpson(const F &f, double a, double b, double fa, double fm, double fb, double whole, double eps, int depth) {
    const double m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
    const double flm = f(lm), frm = f(rm);
    const double left = ((m - a) / 6) * (fa + 4 * flm + fm), right = ((b - m) / 6) * (fm + 4 * frm + fb);
    const double delta = left + right - whole;
    if (depth <= 0 || std::fabs(delta) <= 15 * eps) return left + right + delta / 15;
    return simpson(f, a, m, fa, flm, fm, left, eps / 2, depth - 1) + simpson(f, m, b, fm, frm, fb, right, eps / 2, depth - 1);
}
template <class F>
double integrate(const F &f, double a, double b, double eps) {
    if (b <= a) return 0;
    const double fa = f(a), fb = f(b), m = (a + b) / 2, fm = f(m);
    return simpson(f, a, b, fa, fm, fb, ((b - a) / 6) * (fa + 4 * fm + fb), eps, 40);
}

double edgeIntegral(const Kernel &K, double d, double t1, double t2, double eps) {
    const double p1 = std::atan2(t1, d), p2 = std::atan2(t2, d);
    if (d >= K.rMax) return K.total * (p2 - p1);
    const double pc = std::acos(d / K.rMax);
    auto f = [&](double phi) { return C(K, d / std::cos(phi)); };
    double v = 0;
    const double lo = std::max(p1, -pc), hi = std::min(p2, pc);
    if (hi > lo) v += integrate(f, lo, hi, eps);
    if (p1 < -pc) v += K.total * (std::min(p2, -pc) - p1);
    if (p2 > pc) v += K.total * (p2 - std::max(p1, pc));
    return v;
}

}  // namespace

bool isManhattan(const double *p, int n) {
    for (int k = 0; k < n; k++) {
        const double *a = p + 2 * k, *b = p + 2 * ((k + 1) % n);
        if (a[0] != b[0] && a[1] != b[1]) return false;
    }
    return true;
}

double polygonSR(const Kernel &K, const double *p, int n, double x, double y) {
    // per-term reach: terms narrower than a sixth of the gap to the polygon's box are skipped
    double x1 = INFINITY, x2 = -INFINITY, y1 = INFINITY, y2 = -INFINITY;
    for (int k = 0; k < n; k++) { const double px = p[2 * k], py = p[2 * k + 1]; x1 = std::min(x1, px); x2 = std::max(x2, px); y1 = std::min(y1, py); y2 = std::max(y2, py); }
    const double gx = x < x1 ? x1 - x : x > x2 ? x - x2 : 0, gy = y < y1 ? y1 - y : y > y2 ? y - y2 : 0;
    const double gap = std::max(gx, gy) / 6;
    const size_t T = K.w.size();
    // axis-aligned rectangle (exactly 4 points)
    if (n == 4) {
        bool rect = true;
        for (int k = 0; k < 4 && rect; k++) { const double *a = p + 2 * k, *b = p + 2 * ((k + 1) & 3); if (a[0] != b[0] && a[1] != b[1]) rect = false; }
        if (rect) {
            const double rx1 = std::min(p[0], p[4]), rx2 = std::max(p[0], p[4]), ry1 = std::min(p[1], p[5]), ry2 = std::max(p[1], p[5]);
            if (rx2 > rx1 && ry2 > ry1) {
                double a2 = 0; for (int k = 0; k < 4; k++) { const double *a = p + 2 * k, *b = p + 2 * ((k + 1) & 3); a2 += a[0] * b[1] - b[0] * a[1]; }
                double v = 0;
                for (size_t t = 0; t < T; t++) if (K.s[t] > gap) {
                    const double s = K.s[t];
                    v += K.w[t] * (std::erf((rx2 - x) / s) - std::erf((rx1 - x) / s)) * (std::erf((ry2 - y) / s) - std::erf((ry1 - y) / s));
                }
                return ((a2 > 0 ? 1 : -1) * v) / 4;
            }
        }
    }
    // Manhattan polygon: Green's theorem, a sum over the vertical edges
    if (isManhattan(p, n)) {
        double v = 0;
        for (size_t t = 0; t < T; t++) {
            const double s = K.s[t];
            if (s <= gap) continue;
            double tv = 0;
            for (int k = 0; k < n; k++) {
                const double *a = p + 2 * k, *b = p + 2 * ((k + 1) % n);
                if (a[0] != b[0] || a[1] == b[1]) continue;
                tv += (1 + std::erf((a[0] - x) / s)) * (std::erf((b[1] - y) / s) - std::erf((a[1] - y) / s));
            }
            v += K.w[t] * tv;
        }
        return v / 4;
    }
    // any other polygon: angular quadrature over the edges (exact kernels only; the page checks)
    double sum = 0;
    for (int k = 0; k < n; k++) {
        const double ax = p[2 * k] - x, ay = p[2 * k + 1] - y;
        const double *b = p + 2 * ((k + 1) % n);
        const double bx = b[0] - x, by = b[1] - y;
        const double cross = ax * by - ay * bx;
        const double ex = bx - ax, ey = by - ay, L = std::hypot(ex, ey);
        if (L == 0) continue;
        const double d = std::fabs(cross) / L;
        if (d < 1e-9) continue;
        const double ux = ex / L, uy = ey / L;
        const double t1 = ax * ux + ay * uy, t2 = bx * ux + by * uy;
        sum += (cross > 0 ? 1 : cross < 0 ? -1 : 0) * edgeIntegral(K, d, t1, t2, K.eps);
    }
    return sum / (2 * PI);
}

namespace {

// bucket index over polygon boxes (indexPolygons)
struct Index {
    double x1 = 0, y1 = 0, bucket = 1;
    std::unordered_map<int64_t, std::vector<int32_t>> map;
    std::vector<double> bb;   // x1 y1 x2 y2 per polygon
    static int64_t key(int64_t i, int64_t j) { return (i << 32) ^ (j & 0xffffffff); }
    Index(const Polys &P, double b) : bucket(b) {
        const size_t n = P.dose.size();
        bb.resize(4 * n);
        x1 = INFINITY; y1 = INFINITY;
        for (size_t k = 0; k < n; k++) {
            double a = INFINITY, c = INFINITY, e = -INFINITY, g = -INFINITY;
            for (int v = P.off[k]; v < P.off[k + 1]; v++) { a = std::min(a, P.xy[2 * v]); e = std::max(e, P.xy[2 * v]); c = std::min(c, P.xy[2 * v + 1]); g = std::max(g, P.xy[2 * v + 1]); }
            bb[4 * k] = a; bb[4 * k + 1] = c; bb[4 * k + 2] = e; bb[4 * k + 3] = g;
            x1 = std::min(x1, a); y1 = std::min(y1, c);
        }
        for (size_t k = 0; k < n; k++) {
            const int64_t i0 = (int64_t)std::floor((bb[4 * k] - x1) / bucket), i1 = (int64_t)std::floor((bb[4 * k + 2] - x1) / bucket);
            const int64_t j0 = (int64_t)std::floor((bb[4 * k + 1] - y1) / bucket), j1 = (int64_t)std::floor((bb[4 * k + 3] - y1) / bucket);
            for (int64_t i = i0; i <= i1; i++) for (int64_t j = j0; j <= j1; j++) map[key(i, j)].push_back((int32_t)k);
        }
    }
    // candidates near (x, y) within r, each once (stamp marks the ones already listed)
    void near(double x, double y, double r, std::vector<int32_t> &out, std::vector<uint32_t> &stamp, uint32_t mark) const {
        out.clear();
        const int64_t i0 = (int64_t)std::floor((x - r - x1) / bucket), i1 = (int64_t)std::floor((x + r - x1) / bucket);
        const int64_t j0 = (int64_t)std::floor((y - r - y1) / bucket), j1 = (int64_t)std::floor((y + r - y1) / bucket);
        for (int64_t i = i0; i <= i1; i++) for (int64_t j = j0; j <= j1; j++) {
            auto it = map.find(key(i, j));
            if (it == map.end()) continue;
            for (int32_t q : it->second) if (stamp[q] != mark) { stamp[q] = mark; out.push_back(q); }
        }
    }
};

}  // namespace

std::vector<double> doseAt(const Kernel &K, const Polys &P, const std::vector<double> &pts, int threads) {
    const size_t N = pts.size() / 2;
    std::vector<double> out(N, 0.0);
    if (P.dose.empty()) return out;
    const Index ix(P, std::max(K.rMax, 50.0));
    const double R = K.rMax;
#pragma omp parallel num_threads(threads)
    {
        std::vector<int32_t> cand;
        std::vector<uint32_t> stamp(P.dose.size(), 0);
        uint32_t mark = 0;
#pragma omp for schedule(dynamic, 256)
        for (long long k = 0; k < (long long)N; k++) {
            const double x = pts[2 * k], y = pts[2 * k + 1];
            ix.near(x, y, R, cand, stamp, ++mark);
            double v = 0;
            for (int32_t q : cand) {
                const double *b = &ix.bb[4 * q];
                if (x < b[0] - R || x > b[2] + R || y < b[1] - R || y > b[3] + R) continue;
                v += P.dose[q] * polygonSR(K, &P.xy[2 * P.off[q]], P.off[q + 1] - P.off[q], x, y);
            }
            out[k] = v;
        }
    }
    return out;
}

Rows rows(const Kernel &K, const Polys &P, const std::vector<double> &pts, int threads) {
    const size_t N = pts.size() / 2;
    std::vector<std::vector<std::pair<int32_t, double>>> per(N);
    if (!P.dose.empty()) {
        const Index ix(P, std::max(K.rMax, 50.0));
        const double R = K.rMax;
#pragma omp parallel num_threads(threads)
        {
            std::vector<int32_t> cand;
            std::vector<uint32_t> stamp(P.dose.size(), 0);
            uint32_t mark = 0;
#pragma omp for schedule(dynamic, 256)
            for (long long k = 0; k < (long long)N; k++) {
                const double x = pts[2 * k], y = pts[2 * k + 1];
                ix.near(x, y, R, cand, stamp, ++mark);
                auto &row = per[k];
                for (int32_t q : cand) {
                    const double *b = &ix.bb[4 * q];
                    if (x < b[0] - R || x > b[2] + R || y < b[1] - R || y > b[3] + R) continue;
                    const double v = P.dose[q] * polygonSR(K, &P.xy[2 * P.off[q]], P.off[q + 1] - P.off[q], x, y);
                    if (v != 0) row.emplace_back(P.key[q], v);
                }
                // aggregate by key (a fragment can be several polygons)
                std::sort(row.begin(), row.end(), [](auto &a, auto &c) { return a.first < c.first; });
                size_t w = 0;
                for (size_t i = 0; i < row.size(); i++) {
                    if (w && row[w - 1].first == row[i].first) row[w - 1].second += row[i].second;
                    else row[w++] = row[i];
                }
                row.resize(w);
            }
        }
    }
    Rows r;
    r.ptr.assign(N + 1, 0);
    for (size_t k = 0; k < N; k++) r.ptr[k + 1] = r.ptr[k] + (int32_t)per[k].size();
    r.idx.resize(r.ptr[N]); r.val.resize(r.ptr[N]);
    for (size_t k = 0; k < N; k++) { int32_t at = r.ptr[k]; for (auto &e : per[k]) { r.idx[at] = e.first; r.val[at] = e.second; at++; } }
    return r;
}

}  // namespace sr
