// The KOH level set (see koh.h): a line-for-line port of kohCompute + signedDistance + fastMarch
// from the page (src/core/fab/koh.js, fmm.js). Arrays the page keeps as Float32Array are float
// here and every intermediate is double, as in JavaScript, so the result is the same voxels.
// Parallel: the per-step update (each cell independent, the time step a maximum, which does not
// depend on the order it is taken in) and, since 2026-10-06, every whole-grid pass of the
// re-initialisation, in fixed chunks whose lists are joined in order; the fast marches are serial.
// Buffers are kept between re-initialisations. The voxels are still those of the page (gate gd6).
#include "koh.h"
#include "ompcompat.h"
#include <algorithm>
#include <cmath>
#include <limits>

namespace koh {
namespace {

const double INF = std::numeric_limits<double>::infinity();
const float FINF = std::numeric_limits<float>::infinity();
enum { ETCHANT = 0, XTAL = 1, ISO = 2, INERT = 3 };

struct Grid { int W, H, D; double hx, hy, hz; };

// min-heap of (key, index); keys are the float32 values stored in T, as on the page
struct Heap {
    std::vector<double> k; std::vector<int32_t> v; size_t n = 0;
    Heap() : k(1 << 16), v(1 << 16) {}
    void push(double key, int32_t idx) {
        if (n == k.size()) { k.resize(k.size() * 2); v.resize(v.size() * 2); }
        size_t i = n++;
        while (i > 0) { size_t p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
        k[i] = key; v[i] = idx;
    }
    void pop(double &key, int32_t &idx) {
        key = k[0]; idx = v[0];
        double lk = k[--n]; int32_t lv = v[n];
        size_t i = 0;
        for (;;) { size_t c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
        k[i] = lk; v[i] = lv;
    }
};

double solveCell(int j, int x, int y, int z, const Grid &g, const std::vector<float> &T, const std::vector<uint8_t> &st, const std::vector<uint8_t> &side, uint8_t want) {
    const int W = g.W, H = g.H, D = g.D, WH = W * H;
    double CV[3], CC[3]; int m = 0;
    auto ok = [&](int i) { return st[i] == 2 && side[i] == want; };
    auto axis = [&](int iM, int iP, bool okM, bool okP, int iMM, int iPP, bool okMM, bool okPP, double h) {
        double t1 = INF, t2 = INF;
        if (okM && ok(iM)) { t1 = T[iM]; if (okMM && ok(iMM) && T[iMM] <= t1) t2 = T[iMM]; }
        if (okP && ok(iP) && T[iP] < t1) { t1 = T[iP]; t2 = okPP && ok(iPP) && T[iPP] <= t1 ? (double)T[iPP] : INF; }
        if (t1 == INF) return;
        if (t2 != INF) { CV[m] = (4 * t1 - t2) / 3; CC[m] = 9 / (4 * h * h); }
        else { CV[m] = t1; CC[m] = 1 / (h * h); }
        m++;
    };
    axis(j - 1, j + 1, x > 0, x < W - 1, j - 2, j + 2, x > 1, x < W - 2, g.hx);
    axis(j - W, j + W, y > 0, y < H - 1, j - 2 * W, j + 2 * W, y > 1, y < H - 2, g.hy);
    if (D > 1) axis(j - WH, j + WH, z > 0, z < D - 1, j - 2 * WH, j + 2 * WH, z > 1, z < D - 2, g.hz);
    if (!m) return INF;
    for (int a = 1; a < m; a++) for (int b = a; b > 0 && CV[b] < CV[b - 1]; b--) { std::swap(CV[b], CV[b - 1]); std::swap(CC[b], CC[b - 1]); }
    double A = 0, B = 0, C = 0, sol = INF;
    for (int q = 0; q < m; q++) {
        A += CC[q]; B += CC[q] * CV[q]; C += CC[q] * CV[q] * CV[q];
        double disc = B * B - A * (C - 1);
        if (disc < 0) break;
        sol = (B + std::sqrt(disc)) / A;
        if (!(q + 1 < m && sol > CV[q + 1])) break;
    }
    return sol;
}

// The fast march of the page's fmm.js fastMarchSeeded: the cells that may be crossed are those with
// side[i] == want; the seeds come as a list in increasing index (the order a whole-grid scan would
// push them in, so the heap and the result are those of the first version); st is all 0 on entry and
// again on return; touched gets every cell whose T was set, for the caller to reset.
void fastMarchSeeded(const Grid &g, const std::vector<uint8_t> &side, uint8_t want, std::vector<float> &T, double tmax,
                     const std::vector<int32_t> &seeds, std::vector<uint8_t> &st, std::vector<int32_t> &touched, Heap &heap) {
    const int W = g.W, H = g.H, D = g.D, WH = W * H;
    heap.n = 0;
    for (int32_t i : seeds) { st[i] = 1; heap.push(T[i], i); touched.push_back(i); }
    while (heap.n) {
        double t; int32_t i;
        heap.pop(t, i);
        if (st[i] == 2 || t > T[i]) continue;
        if (t > tmax) break;
        st[i] = 2;
        const int z = i / WH, r = i - z * WH, y = r / W, x = r - y * W;
        const int nb[6] = { x > 0 ? -1 : 0, x < W - 1 ? 1 : 0, y > 0 ? -W : 0, y < H - 1 ? W : 0, D > 1 && z > 0 ? -WH : 0, D > 1 && z < D - 1 ? WH : 0 };
        for (int q = 0; q < 6; q++) {
            const int d = nb[q];
            if (!d) continue;
            const int j = i + d;
            if (st[j] == 2 || side[j] != want) continue;
            const int jz = j / WH, jr = j - jz * WH, jy = jr / W, jx = jr - jy * W;
            float tj = (float)solveCell(j, jx, jy, jz, g, T, st, side, want);
            if (st[j] != 2 && tj < T[j]) { if (T[j] == FINF) touched.push_back(j); T[j] = tj; st[j] = 1; heap.push(tj, j); }
        }
    }
    heap.n = 0;
    for (int32_t i : touched) st[i] = 0;
}

// buffers kept between re-initialisations on one grid
struct Work {
    std::vector<float> Tp, Tn; std::vector<uint8_t> st; std::vector<int32_t> tP, tN, sP, sN; Heap heap;
    std::vector<std::vector<int32_t>> cP, cN;
    explicit Work(int N) : Tp(N, FINF), Tn(N, FINF), st(N, 0) {}
};

// Signed distance as the page's koh.js signedDistance: the same arithmetic in the same order, so the
// same φ. The scan for interface cells and the final φ pass run on all threads in fixed chunks (the
// seed lists are joined in chunk order: increasing index); the two marches are serial.
template <class Keep>
void signedDistance(const Grid &g, const std::vector<uint8_t> &pos, std::vector<float> &phi, Keep keep, double B, Work &wk, int nth) {
    const int W = g.W, H = g.H, D = g.D, WH = W * H, N = WH * D;
    std::vector<float> &Tp = wk.Tp, &Tn = wk.Tn;
    nth = std::max(1, nth);
    wk.cP.assign(nth, {}); wk.cN.assign(nth, {});
    #pragma omp parallel for num_threads(nth) schedule(static, 1)
    for (int c = 0; c < nth; c++) {
        const int i0 = (int)((int64_t)N * c / nth), i1 = (int)((int64_t)N * (c + 1) / nth);
        std::vector<int32_t> &lp = wk.cP[c], &ln = wk.cN[c];
        for (int i = i0; i < i1; i++) {
            const uint8_t p = pos[i];
            const int z = i / WH, r = i - z * WH, y = r / W, x = r - y * W;
            if (!((x > 0 && pos[i - 1] != p) || (x < W - 1 && pos[i + 1] != p) || (y > 0 && pos[i - W] != p) || (y < H - 1 && pos[i + W] != p)
                || (D > 1 && ((z > 0 && pos[i - WH] != p) || (z < D - 1 && pos[i + WH] != p))))) continue;
            double inv = 0;
            auto look = [&](int k, double h) {
                if (pos[k] == p) return;
                double d;
                const double pi = std::fabs((double)phi[i]), pk = std::fabs((double)phi[k]);
                if (keep(i) && keep(k)) { double den = pi + pk; d = (h * pi) / (den != 0 ? den : 1); }
                else if (keep(i)) d = std::min(h, pi);
                else if (keep(k)) d = std::max(0.0, h - std::min(h, pk));
                else d = h / 2;
                d = std::max(d, 1e-3 * h);
                inv += 1 / (d * d);
            };
            if (x > 0) look(i - 1, g.hx);
            if (x < W - 1) look(i + 1, g.hx);
            if (y > 0) look(i - W, g.hy);
            if (y < H - 1) look(i + W, g.hy);
            if (D > 1 && z > 0) look(i - WH, g.hz);
            if (D > 1 && z < D - 1) look(i + WH, g.hz);
            if (p) { Tp[i] = (float)(1 / std::sqrt(inv)); lp.push_back(i); } else { Tn[i] = (float)(1 / std::sqrt(inv)); ln.push_back(i); }
        }
    }
    wk.sP.clear(); wk.sN.clear();
    for (int c = 0; c < nth; c++) { wk.sP.insert(wk.sP.end(), wk.cP[c].begin(), wk.cP[c].end()); wk.sN.insert(wk.sN.end(), wk.cN[c].begin(), wk.cN[c].end()); }
    wk.tP.clear(); wk.tN.clear();
    fastMarchSeeded(g, pos, 1, Tp, B, wk.sP, wk.st, wk.tP, wk.heap);
    fastMarchSeeded(g, pos, 0, Tn, B, wk.sN, wk.st, wk.tN, wk.heap);
    #pragma omp parallel for num_threads(nth) schedule(static)
    for (int i = 0; i < N; i++) phi[i] = pos[i] ? (float)std::min(B, (double)Tp[i]) : (float)-std::min(B, (double)Tn[i]);
    for (int32_t i : wk.tP) Tp[i] = FINF;
    for (int32_t i : wk.tN) Tn[i] = FINF;
}

}  // namespace

Output etch(const Input &in, int threads) {
    const int W = in.W, HF = in.H, D = in.D, WHF = W * HF, NF = WHF * D, N_ = in.lutN;
    const double hx = in.hx, hyF = in.hy, hz = in.hz, timeS = in.timeS;
    const double *bx = in.bx, *bz = in.bz, *bu = in.bu;
    const std::vector<float> &lut = in.lut, &slut = in.slut;
    auto R = [&](double nx, double ny, double nz) {
        double h = std::fabs(nx), k = std::fabs(ny), l = std::fabs(nz), t;
        if (k > h) { t = h; h = k; k = t; }
        if (l > h) { t = h; h = l; l = t; }
        if (l > k) { t = k; k = l; l = t; }
        if (!(h > 0)) return in.ratePoly;
        const double u = (k / h) * N_, v = (l / h) * N_;
        int a = (int)std::floor(u), b = (int)std::floor(v);
        if (a >= N_) a = N_ - 1;
        if (b > a) b = a;
        const double fu = u - a, fv = v - b;
        auto L = [&](int p, int q) { return (double)lut[(size_t)p * (N_ + 1) + std::min(q, p)]; };
        return (L(a, b) * (1 - fu) + L(a + 1, b) * fu) * (1 - fv) + (L(a, b + 1) * (1 - fu) + L(a + 1, b + 1) * fu) * fv;
    };
    auto Sl = [&](double nx, double ny, double nz) {
        double h = std::fabs(nx), k = std::fabs(ny), l = std::fabs(nz), t;
        if (k > h) { t = h; h = k; k = t; }
        if (l > h) { t = h; h = l; l = t; }
        if (l > k) { t = k; k = l; l = t; }
        if (!(h > 0)) return 0.0;
        const int a = std::min(N_, (int)std::round((k / h) * N_)), b = std::min(a, (int)std::round((l / h) * N_));
        return (double)slut[(size_t)a * (N_ + 1) + b];
    };

    std::vector<uint8_t> clsF(NF); std::vector<float> isoF(NF, 0.f);
    for (int i = 0; i < NF; i++) {
        const uint8_t c = in.codes[i];
        if (c == 0) clsF[i] = ETCHANT;
        else if (c == 1) clsF[i] = XTAL;
        else if (c == 2) { clsF[i] = ISO; isoF[i] = (float)in.ratePoly; }
        else if (c == 3) { clsF[i] = in.rateOx > 0 ? ISO : INERT; isoF[i] = (float)in.rateOx; }
        else if (c == 4) { clsF[i] = ISO; isoF[i] = (float)in.rateAl; }
        else clsF[i] = INERT;
    }
    Output out; out.mask.assign(NF, 0);
    if (!(timeS > 0)) return out;

    const int f = std::max(1, std::min((int)std::floor(hx / hyF), (int)std::round(in.coarseNm / hyF)));
    const int H = (HF + f - 1) / f, WH = W * H, N = WH * D;
    const double hy = hyF * f;
    const double hMax = std::max({ hx, hy, D > 1 ? hz : 0.0 }), B = 2 * hMax;
    const int nth = std::max(1, threads);
    std::vector<float> phiF(NF); std::vector<uint8_t> posF(NF);
    for (int i = 0; i < NF; i++) posF[i] = clsF[i] == ETCHANT ? 1 : 0;
    { Work wkF(NF); signedDistance(Grid{ W, HF, D, hx, hyF, hz }, posF, phiF, [](int) { return false; }, B + hy, wkF, nth); }
    std::vector<uint8_t> cls(N); std::vector<float> iso(N), phi(N);
    for (int z = 0; z < D; z++) for (int yc = 0; yc < H; yc++) for (int x = 0; x < W; x++) {
        const int i = z * WH + yc * W + x;
        bool inert = false, xtal = false, any = false; double isoR = -1;
        for (int q = 0; q < f; q++) {
            const int y = yc * f + q;
            if (y >= HF) break;
            const int k = z * WHF + y * W + x, c = clsF[k];
            if (c == INERT) inert = true; else if (c == XTAL) xtal = true; else if (c == ISO) isoR = std::max(isoR, (double)isoF[k]);
            if (c != ETCHANT) any = true;
        }
        cls[i] = inert ? INERT : xtal ? XTAL : isoR >= 0 ? ISO : any ? INERT : ETCHANT;
        iso[i] = (float)isoR;
        const double yMid = yc * f + (f - 1) / 2.0;
        const int y0 = std::min(HF - 1, (int)std::floor(yMid)), y1 = std::min(HF - 1, y0 + 1);
        const double t = yMid - std::floor(yMid);
        phi[i] = (float)(phiF[z * WHF + y0 * W + x] * (1 - t) + phiF[z * WHF + y1 * W + x] * t);
    }
    auto etchable = [&](int i) { return cls[i] == XTAL || cls[i] == ISO; };
    const Grid grid{ W, H, D, hx, hy, hz };
    for (int i = 0; i < N; i++) { if (cls[i] == ETCHANT && phi[i] <= 0) phi[i] = (float)(0.25 * hyF); if (cls[i] == INERT && phi[i] >= 0) phi[i] = (float)(-0.25 * hyF); }
    std::vector<uint8_t> pos(N);
    Work wk(N);
    auto reinit = [&]() {
        #pragma omp parallel for num_threads(nth) schedule(static)
        for (int i = 0; i < N; i++) pos[i] = cls[i] == ETCHANT || (etchable(i) && phi[i] > 0) ? 1 : 0;
        signedDistance(grid, pos, phi, etchable, B, wk, nth);
    };
    reinit();

    // the cells that move, in increasing index: counted per chunk on all threads, then filled in place
    std::vector<int32_t> active, nb;
    std::vector<int> chunkN(nth + 1);
    auto buildActive = [&]() {
        auto in = [&](int i) { return etchable(i) && std::fabs((double)phi[i]) < B; };
        #pragma omp parallel for num_threads(nth) schedule(static, 1)
        for (int c = 0; c < nth; c++) { int n = 0; const int i0 = (int)((int64_t)N * c / nth), i1 = (int)((int64_t)N * (c + 1) / nth); for (int i = i0; i < i1; i++) if (in(i)) n++; chunkN[c + 1] = n; }
        chunkN[0] = 0; for (int c = 0; c < nth; c++) chunkN[c + 1] += chunkN[c];
        active.resize(chunkN[nth]); nb.resize((size_t)6 * chunkN[nth]);
        #pragma omp parallel for num_threads(nth) schedule(static, 1)
        for (int c = 0; c < nth; c++) {
            int a = chunkN[c];
            const int i0 = (int)((int64_t)N * c / nth), i1 = (int)((int64_t)N * (c + 1) / nth);
            for (int i = i0; i < i1; i++) {
                if (!in(i)) continue;
                const int z = i / WH, r = i - z * WH, y = r / W, x = r - y * W;
                auto ok = [&](int k, bool inside) { return inside && cls[k] != INERT ? k : -1; };
                const size_t o = (size_t)6 * a;
                nb[o] = ok(i - 1, x > 0); nb[o + 1] = ok(i + 1, x < W - 1); nb[o + 2] = ok(i - W, y > 0); nb[o + 3] = ok(i + W, y < H - 1);
                nb[o + 4] = D > 1 ? ok(i - WH, z > 0) : -1; nb[o + 5] = D > 1 ? ok(i + WH, z < D - 1) : -1;
                active[a++] = i;
            }
        }
    };
    buildActive();

    std::vector<float> rhs(N);
    const double CFL = 0.8;
    std::vector<double> thRate(nth), thF(nth);
    double t = 0, moved = 0; int steps = 0;
    while (t < timeS - 1e-9 && steps < 400000) {
        const int na = (int)active.size();
        std::fill(thRate.begin(), thRate.end(), 0.0); std::fill(thF.begin(), thF.end(), 0.0);
        #pragma omp parallel for num_threads(nth) schedule(static)
        for (int a = 0; a < na; a++) {
            const int th = omp_get_thread_num();
            const int i = active[a], o = 6 * a;
            const double p0 = phi[i];
            int k;
            const double xm = (k = nb[o]) >= 0 ? phi[k] : p0, xp = (k = nb[o + 1]) >= 0 ? phi[k] : p0;
            const double ym = (k = nb[o + 2]) >= 0 ? phi[k] : p0, yp = (k = nb[o + 3]) >= 0 ? phi[k] : p0;
            const double zm = (k = nb[o + 4]) >= 0 ? phi[k] : p0, zp = (k = nb[o + 5]) >= 0 ? phi[k] : p0;
            const double pxm = (p0 - xm) / hx, pxp = (xp - p0) / hx, pym = (p0 - ym) / hy, pyp = (yp - p0) / hy, pzm = (p0 - zm) / hz, pzp = (zp - p0) / hz;
            const double gx = (pxm + pxp) / 2, gy = (pym + pyp) / 2, gz = (pzm + pzp) / 2;
            const double gn = std::sqrt(gx * gx + gy * gy + gz * gz);
            double F, ax, ay, az;
            if (cls[i] == ISO) { F = iso[i]; ax = ay = az = F; }
            else {
                double nx, ny, nz, ux = 0, uy = 1, uz = 0;
                if (gn > 1e-9) {
                    ux = gx / gn; uy = gy / gn; uz = gz / gn;
                    nx = ux * bx[0] - uy * bu[0] + uz * bz[0]; ny = ux * bx[1] - uy * bu[1] + uz * bz[1]; nz = ux * bx[2] - uy * bu[2] + uz * bz[2];
                } else { nx = bu[0]; ny = bu[1]; nz = bu[2]; }
                F = R(nx, ny, nz);
                const double S = Sl(nx, ny, nz);
                ux = std::fabs(ux); uy = std::fabs(uy); uz = std::fabs(uz);
                ax = F * ux + S * std::sqrt(std::max(0.0, 1 - ux * ux)) + 0.05 * F;
                ay = F * uy + S * std::sqrt(std::max(0.0, 1 - uy * uy)) + 0.05 * F;
                az = F * uz + S * std::sqrt(std::max(0.0, 1 - uz * uz)) + 0.05 * F;
            }
            double rr = F * gn + (ax * (pxp - pxm) + ay * (pyp - pym)) / 2, sum = ax / hx + ay / hy;
            if (D > 1) { rr += (az * (pzp - pzm)) / 2; sum += az / hz; }
            rhs[a] = (float)rr;
            if (sum > thRate[th]) thRate[th] = sum;
            if (F > thF[th]) thF[th] = F;
        }
        double maxRate = 0, maxF = 0;
        for (int q = 0; q < nth; q++) { maxRate = std::max(maxRate, thRate[q]); maxF = std::max(maxF, thF[q]); }
        if (!(maxRate > 0)) break;
        const double dt = std::min(CFL / maxRate, timeS - t);
        #pragma omp parallel for num_threads(nth) schedule(static)
        for (int a = 0; a < na; a++) { const int i = active[a]; phi[i] = (float)std::min(B, (double)phi[i] + dt * (double)rhs[a]); }
        t += dt; steps++; moved += dt * maxF;
        if (moved > B / 2) { reinit(); buildActive(); moved = 0; }
    }
    for (int z = 0; z < D; z++) for (int y = 0; y < HF; y++) {
        const double yc = (y + 0.5) / f - 0.5;
        const int c0 = std::max(0, std::min(H - 1, (int)std::floor(yc))), c1 = std::min(H - 1, c0 + 1);
        const double tt = std::max(0.0, std::min(1.0, yc - c0));
        for (int x = 0; x < W; x++) {
            const int k = z * WHF + y * W + x;
            if (!(clsF[k] == XTAL || clsF[k] == ISO)) continue;
            const int ia = z * WH + c0 * W + x, ib = z * WH + c1 * W + x;
            const double pa = phi[ia], pb = cls[ib] == INERT ? pa : (double)phi[ib], pa2 = cls[ia] == INERT ? pb : pa;
            if (pa2 * (1 - tt) + pb * tt > 0) out.mask[k] = 1;
        }
    }
    out.steps = steps;
    return out;
}

}  // namespace koh
