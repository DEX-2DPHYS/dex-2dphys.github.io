// pec.h — the fractured correction's solve, a line-by-line port of the page's JavaScript:
//   solveFractured            src/core/pec/fractured.js
//   lrOperator().apply        src/core/exposure/engine.js
//   convolve / fft2 / fftLine src/core/exposure/fft.js
//   lrSampler                 src/core/exposure/longrange.js
// The arithmetic is kept in the same order (and Float32 where the page uses Float32Array), so the
// result matches the page's to rounding; the loops that are parallel here are the ones whose sums do
// not change order (a point's row, a fragment's column, one FFT line).
#include "pec.h"
#include <omp.h>

#include <algorithm>
#include <cmath>

namespace pec {
namespace {

const double PI = 3.141592653589793;   // Math.PI

struct Tables { std::vector<uint32_t> rev; std::vector<double> cos, sin; };
Tables tablesFor(int n) {
    Tables t;
    t.rev.assign(n, 0);
    for (int i = 0, j = 0; i < n; i++) {
        t.rev[i] = j;
        int bit = n >> 1;
        while (j & bit) { j ^= bit; bit >>= 1; }
        j ^= bit;
    }
    t.cos.resize(n / 2); t.sin.resize(n / 2);
    for (int k = 0; k < n / 2; k++) { t.cos[k] = std::cos((-2 * PI * k) / n); t.sin[k] = std::sin((-2 * PI * k) / n); }
    return t;
}

// one line of a 2D array (offset, stride); forward sign −1
void fftLine(double *re, double *im, int n, long offset, long stride, bool inverse, const Tables &T) {
    for (int i = 0; i < n; i++) {
        const int j = T.rev[i];
        if (j > i) {
            const long a = offset + i * stride, b = offset + j * stride;
            double t = re[a]; re[a] = re[b]; re[b] = t;
            t = im[a]; im[a] = im[b]; im[b] = t;
        }
    }
    const double sg = inverse ? -1 : 1;
    for (int len = 2; len <= n; len <<= 1) {
        const int half = len >> 1, step = n / len;
        for (int i = 0; i < n; i += len) {
            for (int k = 0; k < half; k++) {
                const double wr = T.cos[k * step], wi = sg * T.sin[k * step];
                const long a = offset + (long)(i + k) * stride, b = a + half * stride;
                const double tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
            }
        }
    }
    if (inverse) for (int i = 0; i < n; i++) { const long a = offset + i * stride; re[a] /= n; im[a] /= n; }
}

// columns through a contiguous copy, as the page does (the copy does not change the arithmetic)
void fftColumns(double *re, double *im, int nx, int ny, bool inverse, const Tables &Ty, int threads) {
#pragma omp parallel num_threads(threads)
    {
        std::vector<double> cr(ny), ci(ny);
#pragma omp for schedule(static)
        for (int i = 0; i < nx; i++) {
            for (long j = 0, a = i; j < ny; j++, a += nx) { cr[j] = re[a]; ci[j] = im[a]; }
            fftLine(cr.data(), ci.data(), ny, 0, 1, inverse, Ty);
            for (long j = 0, a = i; j < ny; j++, a += nx) { re[a] = cr[j]; im[a] = ci[j]; }
        }
    }
}

void fft2(double *re, double *im, int nx, int ny, bool inverse, int rows, const Tables &Tx, const Tables &Ty, int threads) {
    if (!inverse) {
#pragma omp parallel for num_threads(threads) schedule(static)
        for (int j = 0; j < rows; j++) fftLine(re, im, nx, (long)j * nx, 1, false, Tx);
        fftColumns(re, im, nx, ny, false, Ty, threads);
    } else {
        fftColumns(re, im, nx, ny, true, Ty, threads);
#pragma omp parallel for num_threads(threads) schedule(static)
        for (int j = 0; j < rows; j++) fftLine(re, im, nx, (long)j * nx, 1, true, Tx);
    }
}

// lrOperator(points, keyOf).apply(dose): weighted gather (Float32), FFT convolution, bilinear sampling
struct LRApply {
    const LR &L; const std::vector<double> &pts; int nP, threads;
    Tables Tx, Ty;
    std::vector<float> density, field;
    std::vector<double> re, im;
    LRApply(const LR &l, const std::vector<double> &p, int n, int th) : L(l), pts(p), nP(n), threads(th) {
        if (L.on) { Tx = tablesFor(L.NX); Ty = tablesFor(L.NY); }
    }
    void apply(const std::vector<double> &dose, std::vector<double> &out) {
        out.assign(nP, 0.0);
        if (!L.on) return;
        const int nx = L.nx, ny = L.ny, NX = L.NX, NY = L.NY;
        density.assign((size_t)nx * ny, 0.0f);
        for (size_t q = 0; q < L.K.size(); q++) density[L.Cl[q]] = (float)((double)density[L.Cl[q]] + dose[L.K[q]] * L.Wt[q]);
        re.assign((size_t)NX * NY, 0.0); im.assign((size_t)NX * NY, 0.0);
        for (int j = 0; j < ny; j++) for (int i = 0; i < nx; i++) re[(size_t)j * NX + i] = density[(size_t)j * nx + i];
        fft2(re.data(), im.data(), NX, NY, false, ny, Tx, Ty, threads);     // rows ≥ ny are zero
        for (size_t k = 0; k < re.size(); k++) {
            const double a = re[k], b = im[k], c = L.re[k], d = L.im[k];
            re[k] = a * c - b * d; im[k] = a * d + b * c;
        }
        fft2(re.data(), im.data(), NX, NY, true, ny, Tx, Ty, threads);      // only rows < ny are read back
        field.assign((size_t)nx * ny, 0.0f);
        for (int j = 0; j < ny; j++) for (int i = 0; i < nx; i++) field[(size_t)j * nx + i] = (float)re[(size_t)j * NX + i];
        const double x0 = L.x0, y0 = L.y0, dx = L.dx;
        const float *f = field.data();
#pragma omp parallel for num_threads(threads) schedule(static)
        for (int k = 0; k < nP; k++) {
            const double x = pts[2 * k], y = pts[2 * k + 1];
            const double u = (x - x0) / dx - 0.5, v = (y - y0) / dx - 0.5;
            const double i0 = std::max(0.0, std::min((double)(nx - 2), std::floor(u))), j0 = std::max(0.0, std::min((double)(ny - 2), std::floor(v)));
            const double fu = std::max(0.0, std::min(1.0, u - i0)), fv = std::max(0.0, std::min(1.0, v - j0));
            const long a = (long)j0 * nx + (long)i0, b = ((long)j0 + 1) * nx + (long)i0;
            out[k] = (1 - fu) * (1 - fv) * f[a] + fu * (1 - fv) * f[a + 1] + (1 - fu) * fv * f[b] + fu * fv * f[b + 1];
        }
    }
};

// JavaScript's Math.round (half up) for finite values
inline double jsRound(double x) { const double r = std::floor(x); return x - r >= 0.5 ? r + 1 : r; }

}  // namespace

Result solve(const Problem &P, const sr::Rows &SR, const LR &L, int threads) {
    const int nF = P.nF, nP = P.nP;
    std::vector<double> d(P.d0);
    LRApply lr(L, P.pts, nP, threads);
    std::vector<double> lrv;
    auto doseNow = [&](std::vector<double> &out) {
        lr.apply(d, lrv);
        out.assign(nP, 0.0);
#pragma omp parallel for num_threads(threads) schedule(dynamic, 256)
        for (int p = 0; p < nP; p++) {
            double v = lrv[p] + (P.longOnly ? P.srSelf * d[p] : 0);
            for (int q = SR.ptr[p]; q < SR.ptr[p + 1]; q++) v += SR.val[q] * d[SR.idx[q]];
            out[p] = v;
        }
    };
    // contour fit: the rows transposed, each fragment's entries in point order (the page adds them in
    // that order, so the fragment's sums come out the same)
    std::vector<int32_t> colPtr, colQ, colP;
    if (P.contour) {
        colPtr.assign(nF + 1, 0);
        for (size_t q = 0; q < SR.idx.size(); q++) colPtr[SR.idx[q] + 1]++;
        for (int i = 0; i < nF; i++) colPtr[i + 1] += colPtr[i];
        colQ.resize(SR.idx.size()); colP.resize(SR.idx.size());
        std::vector<int32_t> fill(colPtr.begin(), colPtr.end() - 1);
        for (int p = 0; p < nP; p++) for (int q = SR.ptr[p]; q < SR.ptr[p + 1]; q++) { const int e = fill[SR.idx[q]]++; colQ[e] = q; colP[e] = p; }
    }
    Result R;
    std::vector<double> got, wEff(P.contour ? nP : 0);
    int it;
    double err = INFINITY;
    for (it = 1; it <= P.maxIter; it++) {
        doseNow(got);
        err = 0;
        if (P.contour) {
            for (int p = 0; p < nP; p++) {
                const double g = got[p];
                double w = P.ptWant[p];
                if (P.ptBand[p]) w = std::min(std::max(g, P.bLo * w), P.bHi * w);
                wEff[p] = w;
            }
#if OMP_HAS_MAX_REDUCTION
#pragma omp parallel for num_threads(threads) schedule(dynamic, 256) reduction(max : err)
#endif
            for (int i = 0; i < nF; i++) {
                double num = 0, den = 0;
                for (int e = colPtr[i]; e < colPtr[i + 1]; e++) { const int p = colP[e]; const double a = SR.val[colQ[e]] * P.ptW[p]; num += a * wEff[p]; den += a * got[p]; }
                const double di = d[i];
                const double nd = std::min(P.base[i] * P.maxFactor, std::max(P.base[i] * P.floor, den > 0 ? di * (num / den) : di));
                err = std::max(err, std::abs(nd / di - 1));
                d[i] = nd;
            }
        } else {
#if OMP_HAS_MAX_REDUCTION
#pragma omp parallel for num_threads(threads) schedule(static) reduction(max : err)
#endif
            for (int n = 0; n < nF; n++) {
                double w = P.want[n] * P.base[n] * P.k[n];
                const double g = got[n], dn = d[n];
                if (P.banded[n]) {
                    if (g >= P.bLo * w && g <= P.bHi * w) continue;
                    w *= g < P.bLo * w ? P.bLo : P.bHi;
                }
                err = std::max(err, std::abs(g / w - 1));
                d[n] = std::min(P.base[n] * P.maxFactor, std::max(P.base[n] * P.floor, g > 0 ? dn * (w / g) : dn * P.maxFactor));
            }
        }
        R.history.push_back(err);
        if (err < P.tol) break;
    }
    // dose classes: N levels, logarithmic between the smallest and largest absolute dose
    double lo = INFINITY, hi = -INFINITY;
    std::vector<double> absd(nF);
    for (int n = 0; n < nF; n++) { absd[n] = d[n] * P.k[n]; if (absd[n] < lo) lo = absd[n]; if (absd[n] > hi) hi = absd[n]; }
    const int N = P.classes;
    R.classes.resize(N);
    for (int c = 0; c < N; c++) R.classes[c] = N == 1 || hi <= lo ? lo : lo * std::pow(hi / lo, (double)c / (N - 1));
    R.cls.resize(nF);
    for (int n = 0; n < nF; n++) {
        const int c = N == 1 || hi <= lo ? 0 : (int)jsRound((std::log(absd[n] / lo) / std::log(hi / lo)) * (N - 1));
        R.cls[n] = c; d[n] = R.classes[c] / P.k[n];
    }
    doseNow(R.gotQ);
    R.write = d;
    R.it = std::min(it, P.maxIter); R.err = err; R.lo = lo; R.hi = hi;
    return R;
}

}  // namespace pec
