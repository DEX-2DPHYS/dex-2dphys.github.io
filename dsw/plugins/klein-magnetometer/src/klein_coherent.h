// klein_coherent.h — the coherent sidebar: fully phase-coherent transmission
// of the WHOLE junction train in one dimension (B = 0, straight junctions,
// no edges) at finite transverse momentum, as a function of energy.
//
// Why: at normal incidence (k_y = 0) the 1-D Dirac equation has no
// backscattering for ANY profile (a' = i k b, b' = i k a decouple), so
// Fabry–Pérot interference lives entirely at k_y != 0. The mode-averaged
// coherent transmission
//     Tbar_coh(E) = (1/k_min) ∫_0^{k_min} T_coh(E, k_y) dk_y
// oscillates with E (cavity period ~ pi hbar vF / L). Convolving with -df/dE
// at temperature T gives the residual visibility, and comparing the thermal
// average with the incoherent (semiclassical, multiply-reflected) result from
// the flux engine quantifies the coherent correction the ray model omits.
//
// Numerics: between the junction windows the solution is propagated exactly
// (closed-form matrix exponential of the constant-k Dirac operator); inside
// each window the profile is integrated with RK4 on the same grid as the
// single-junction tables. Current conservation is checked per energy.
#pragma once
#include "klein_physics.h"
#include "klein_runner.h"
#include <complex>
#include <vector>

namespace klein {

struct CoherentSpec {
    Params p;
    double eRange = 25e-3 * E_CHARGE;   // half range in J (25 meV)
    int eN = 251;
    int kyN = 49;
    std::vector<double> temps = {1, 4, 10, 20, 50, 100, 300};
    int incoherentEvery = 10;           // incoherent reference at every n-th energy (interpolated between)
    FluxGrid grid{1, 513, false};
    double fluxThreshold = 1e-5;
};

struct CoherentResult {
    std::vector<double> eps;            // J
    std::vector<double> Tcoh;           // mode-averaged coherent transmission per energy
    std::vector<double> worstUnit;      // |T+R-1| per energy
    std::vector<double> temps;
    std::vector<std::vector<double>> smoothed; // [temp][energy] thermal convolution
    std::vector<double> visibility;     // (max-min)/mean of the smoothed curve, per temp
    std::vector<double> thermalCoh;     // <Tbar_coh> at E_F per temp
    std::vector<double> thermalInc;     // incoherent <T> per temp (same thermal kernel on the incoherent curve)
    std::vector<double> Tinc;           // incoherent transmission interpolated onto the energy grid
    std::vector<double> epsInc, TincCoarse; // where it was actually computed
    double TcohEF = 0, TincEF = 0;      // single-energy values at E_F
    int kyEff = 0;                      // k_y points actually used (auto-raised for long cavities)
    double ms = 0;
};

// signed k(x) of the whole device at energy offset eps, straight junctions
struct DeviceProfile {
    const Device *dv = nullptr;
    Profile profile = Profile::Gate;
    double dk = 0;
    std::vector<double> win;            // per junction window half-width
    double k(double x) const {
        // find the cell; inside a window blend with the junction profile
        const auto &cells = dv->cells;
        int c = 0;
        for (size_t i = 0; i < cells.size(); ++i) if (x >= cells[i].x0) c = static_cast<int>(i);
        double kc = cells[c].k;
        // left junction window
        if (c > 0) { const Junction &j = dv->junctions[c - 1]; if (x - j.u < win[c - 1]) return profileK(profile, cells[c - 1].k, cells[c].k, j.d, x - j.u); }
        if (c + 1 < static_cast<int>(cells.size())) { const Junction &j = dv->junctions[c]; if (j.u - x < win[c]) return profileK(profile, cells[c].k, cells[c + 1].k, j.d, x - j.u); }
        return kc;
    }
};

// exact propagation over a constant-k segment of length L (may be negative: backwards)
inline void propagateConstant(std::complex<double> &a, std::complex<double> &b, double k, double ky, double L) {
    using C = std::complex<double>;
    const double q2 = k * k - ky * ky;
    C cs, sk; // cos(kappa L), sin(kappa L)/kappa
    if (q2 > 0) { const double kap = std::sqrt(q2); cs = std::cos(kap * L); sk = std::sin(kap * L) / kap; }
    else if (q2 < 0) { const double kap = std::sqrt(-q2); cs = std::cosh(kap * L); sk = std::sinh(kap * L) / kap; }
    else { cs = 1; sk = L; }
    const C I(0, 1);
    const C na = cs * a + sk * (ky * a + I * k * b);
    const C nb = cs * b + sk * (-ky * b + I * k * a);
    a = na; b = nb;
}

// coherent T through the whole device at (eps, ky); returns T and fills unit error
inline double coherentT(const DeviceProfile &dp, double ky, double &unit) {
    using C = std::complex<double>;
    const Device &dv = *dp.dv;
    const double kR = dv.cells.back().k, kL = dv.cells.front().k;
    const double aR = std::abs(kR), aL = std::abs(kL);
    unit = 0;
    if (ky >= aR || ky >= aL) return 0;
    const int sR = sgn(kR), sL = sgn(kL);
    const double kxR = std::sqrt(aR * aR - ky * ky) * sR, kxL = std::sqrt(aL * aL - ky * ky) * sL;
    const C I(0, 1);
    C a(1 / std::sqrt(2.0), 0), b = C(sR / std::sqrt(2.0), 0) * std::exp(I * std::atan2(ky, kxR));
    // walk from x = Ltot down to 0: constant segments exactly, windows with RK4
    double kmax = 0; for (const Cell &c : dv.cells) kmax = std::max(kmax, std::abs(c.k));
    double x = dv.Ltot;
    for (int j = static_cast<int>(dv.junctions.size()) - 1; j >= -1; --j) {
        const double xWinHi = j >= 0 ? dv.junctions[j].u + dp.win[j] : 0;
        const double xWinLo = j >= 0 ? dv.junctions[j].u - dp.win[j] : 0;
        // constant segment from x down to xWinHi (cell j+1)
        const double kc = dv.cells[j + 1].k;
        if (x > xWinHi) { propagateConstant(a, b, kc, ky, -(x - xWinHi)); x = xWinHi; }
        if (j < 0) break;
        // window with RK4
        const double d = dv.junctions[j].d;
        double dx = std::min(2 * PI / kmax / 48, d / 48);
        const int n = std::max(16, static_cast<int>(std::ceil((xWinHi - xWinLo) / dx)));
        dx = (xWinHi - xWinLo) / n;
        const double h = -dx;
        auto rhs = [&](double xx, const C &aa, const C &bb, C &da, C &db) { const double k = dp.k(xx); da = ky * aa + I * k * bb; db = -ky * bb + I * k * aa; };
        for (int i = 0; i < n; ++i) {
            C k1a, k1b, k2a, k2b, k3a, k3b, k4a, k4b;
            rhs(x, a, b, k1a, k1b);
            rhs(x + 0.5 * h, a + 0.5 * h * k1a, b + 0.5 * h * k1b, k2a, k2b);
            rhs(x + 0.5 * h, a + 0.5 * h * k2a, b + 0.5 * h * k2b, k3a, k3b);
            rhs(x + h, a + h * k3a, b + h * k3b, k4a, k4b);
            a += (h / 6) * (k1a + 2.0 * k2a + 2.0 * k3a + k4a);
            b += (h / 6) * (k1b + 2.0 * k2b + 2.0 * k3b + k4b);
            x += h;
        }
        x = xWinLo;
        if (!std::isfinite(a.real()) || !std::isfinite(b.real())) return 0;
    }
    const double phInc = std::atan2(ky, kxL), phRef = std::atan2(ky, -kxL);
    const C i1(1 / std::sqrt(2.0), 0), i2 = C(sL / std::sqrt(2.0), 0) * std::exp(I * phInc);
    const C r1(1 / std::sqrt(2.0), 0), r2 = C(sL / std::sqrt(2.0), 0) * std::exp(I * phRef);
    const C det = i1 * r2 - i2 * r1;
    const C A = (a * r2 - b * r1) / det, B = (i1 * b - i2 * a) / det;
    const double jT = std::abs(kxR) / aR, jI = std::abs(kxL) / aL;
    const double PA = std::norm(A), PB = std::norm(B);
    if (PA <= 0) return 0;
    const double T = jT / (PA * jI), R = PB / PA;
    unit = std::abs(T + R - 1);
    return std::max(0.0, std::min(1.0, T));
}

// The 1-D problem both sides of the comparison solve.
inline Params coherentProblem(Params q) {
    q.skewDeg = 0; q.W = 1; q.edge = EdgeModel::Specular;
    q.mfp = 0; q.mfpPh300 = 0; q.eeMfp = 0; q.scatter = Scatter::None; q.sigmaTiltDeg = 0;
    q.injection = Injection::Cosine; q.apertureFrac = 1;
    return q;
}

class CoherentJob {
public:
    explicit CoherentJob(const CoherentSpec &s) : spec_(s) {
        start_ = std::chrono::steady_clock::now();
        res_.eps = linspace(-spec_.eRange, spec_.eRange, std::max(3, spec_.eN));
        res_.Tcoh.assign(res_.eps.size(), 0.0);
        res_.worstUnit.assign(res_.eps.size(), 0.0);
        res_.temps = spec_.temps;
    }
    bool done() const { return ei_ >= res_.eps.size() && incDone_; }
    double fraction() const { return (static_cast<double>(ei_) + (incDone_ ? 1 : 0)) / (res_.eps.size() + 1); }

    // one energy per call (parallel over k_y inside), then the incoherent reference
    bool step() {
        if (ei_ < res_.eps.size()) {
            const double eps = res_.eps[ei_];
            Params q = coherentProblem(spec_.p);
            const Device dv = buildDevice(q, eps);
            DeviceProfile dp; dp.dv = &dv; dp.profile = spec_.p.profile == Profile::Asymptotic ? Profile::Linear : spec_.p.profile;
            for (size_t j = 0; j < dv.junctions.size(); ++j) dp.win.push_back(dv.tables[j].window > 0 ? dv.tables[j].window : 0.5 * dv.junctions[j].d);
            // Average over the INJECTING lead's modes, uniform in k_y on [0, |k_lead|]
            // (the same normalisation as the incoherent reference and the Landauer M);
            // modes evanescent somewhere in the device return T = 0.
            const double klead = std::abs(dv.cells.front().k);
            // k_y sampling must resolve the cavity phase: k_x L changes by ~L dk_y per sample,
            // so fewer than ~1.5 k_F L points alias the Fabry-Perot oscillation (a 1 um cavity
            // read 0.76 meV instead of 2.07 meV at 64 points; 2.070 at 256). Raise as needed.
            double lmax = 0; for (const Cell &c : dv.cells) lmax = std::max(lmax, c.x1 - c.x0);
            const int n = std::max({8, spec_.kyN, static_cast<int>(std::ceil(1.5 * klead * lmax))});
            res_.kyEff = std::max(res_.kyEff, n);
            std::vector<double> T(n), U(n);
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 1)
#endif
            for (int i = 0; i < n; ++i) { const double ky = klead * (i + 0.5) / n; T[i] = coherentT(dp, ky, U[i]); }
            double sum = 0, worst = 0; for (int i = 0; i < n; ++i) { sum += T[i]; worst = std::max(worst, U[i]); }
            res_.Tcoh[ei_] = sum / n;               // midpoint rule in k_y on [0, k_min]
            res_.worstUnit[ei_] = worst;
            ++ei_;
            return true;
        }
        if (!incDone_) { finishThermal(); incDone_ = true; }
        return false;
    }

    CoherentResult result() { res_.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start_).count(); return res_; }

private:
    std::vector<double> smooth(const std::vector<double> &f, double temp) const {
        const size_t n = res_.eps.size();
        const double de = res_.eps[1] - res_.eps[0];
        const double kT = K_BOLTZ * std::max(temp, 1e-3);
        std::vector<double> sm(n, NAN);
        for (size_t i = 0; i < n; ++i) {
            double acc = 0, wsum = 0;
            for (size_t j = 0; j < n; ++j) {
                const double x = (res_.eps[j] - res_.eps[i]) / (2 * kT);
                if (std::abs(x) > 20) continue;
                const double w = de / (4 * kT * sqr(std::cosh(x)));
                acc += w * f[j]; wsum += w;
            }
            if (wsum > 0.99) sm[i] = acc / wsum;   // only where the kernel fits inside the grid
        }
        return sm;
    }

    void finishThermal() {
        const size_t n = res_.eps.size();
        size_t i0 = 0; for (size_t i = 0; i < n; ++i) if (std::abs(res_.eps[i]) < std::abs(res_.eps[i0])) i0 = i;
        res_.TcohEF = res_.Tcoh[i0];
        // incoherent reference on a coarse grid (always including the centre and both ends)
        std::vector<size_t> idx;
        const size_t every = std::max(1, spec_.incoherentEvery);
        for (size_t i = 0; i < n; i += every) idx.push_back(i);
        if (idx.back() != n - 1) idx.push_back(n - 1);
        if (std::find(idx.begin(), idx.end(), i0) == idx.end()) { idx.push_back(i0); std::sort(idx.begin(), idx.end()); }
        std::vector<double> Tc(idx.size(), 0.0);
        // Same problem as the coherent calculation: B = 0, straight junctions, no bulk or
        // e-e scattering, no local tilt, uniform-in-k_y (cos-theta) injection. Only then is
        // the difference between the two curves the coherence and nothing else.
        Params q = coherentProblem(spec_.p); q.fluxThreshold = spec_.fluxThreshold; q.fluxMaxDepth = 4000;
        const int ni = static_cast<int>(idx.size());
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 1)
#endif
        for (int k = 0; k < ni; ++k) {
            const Device dv = buildDevice(q, res_.eps[idx[k]]);
            Tc[k] = runFlux(dv, 0, 3, spec_.grid, 0, spec_.grid.nodes()).T();
        }
        for (size_t k = 0; k < idx.size(); ++k) { res_.epsInc.push_back(res_.eps[idx[k]]); res_.TincCoarse.push_back(Tc[k]); }
        res_.Tinc.assign(n, 0.0);
        for (size_t i = 0; i < n; ++i) {
            size_t k = 0; while (k + 1 < idx.size() && idx[k + 1] < i) ++k;
            if (k + 1 >= idx.size()) { res_.Tinc[i] = Tc.back(); continue; }
            const double f = (res_.eps[i] - res_.eps[idx[k]]) / std::max(1e-300, res_.eps[idx[k + 1]] - res_.eps[idx[k]]);
            res_.Tinc[i] = Tc[k] + (Tc[k + 1] - Tc[k]) * std::max(0.0, std::min(1.0, f));
        }
        res_.TincEF = res_.Tinc[i0];
        for (double temp : spec_.temps) {
            const std::vector<double> sm = smooth(res_.Tcoh, temp), si = smooth(res_.Tinc, temp);
            // Fabry-Perot visibility = peak-to-peak of (coherent / incoherent) after the
            // same thermal smoothing: the smooth energy trend common to both cancels.
            double mn = INF, mx = -INF; int cnt = 0;
            for (size_t i = 0; i < sm.size(); ++i) if (std::isfinite(sm[i]) && std::isfinite(si[i]) && si[i] > 0) { const double q = sm[i] / si[i]; mn = std::min(mn, q); mx = std::max(mx, q); ++cnt; }
            res_.smoothed.push_back(sm);
            res_.visibility.push_back(cnt >= 3 ? mx - mn : NAN);
            res_.thermalCoh.push_back(std::isfinite(sm[i0]) ? sm[i0] : NAN);
            res_.thermalInc.push_back(std::isfinite(si[i0]) ? si[i0] : NAN);
        }
    }
    CoherentSpec spec_;
    CoherentResult res_;
    size_t ei_ = 0;
    bool incDone_ = false;
    std::chrono::steady_clock::time_point start_;
};

} // namespace klein
