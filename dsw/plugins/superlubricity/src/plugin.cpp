// Structural Superlubricity — vdW calculator with moire lateral MD.
//
// A DSW port of the 10321 prototype `superlubricity-moire-md.html`
// ("vdW calculator — moire lateral MD"), by Peter Boggild.
//
// ---------------------------------------------------------------- the model
//
// Two rigid graphene layers, a square bottom sheet and a circular top flake,
// at interlayer separation d. Every top atom interacts with every bottom atom
// through a Lennard-Jones 12-6 pair potential in SI units:
//
//     V(r) = C12 / r^12  -  C6 / r^6,      r^2 = dx^2 + dy^2 + d^2
//     C12  = 0.5 * C6 * r0^6                (so dV/dr = 0 at r0 = 3.40 A)
//
// with C6 = 2.45e-78 J m^6 fitted to graphene. The total energy U and the
// energy per unit area U/A are what the experiment is actually about: the
// twist angle, the lateral offset and the interlayer spacing all move the
// layers around this landscape, and superlubricity is what the landscape
// looks like when the lattices do not share a period.
//
// THE SAME PASS RETURNS THE LATERAL GRADIENT. dU/dtx and dU/dty cost two extra
// multiply-adds per pair, and having them turns three separate jobs into one
// potential:
//   * xy relaxation becomes gradient descent instead of a 4-candidate pattern
//     search (same minimum, far fewer energy evaluations),
//   * the lateral force on a rigid flake is -grad U directly, so the AFM
//     friction loop is measured from the vdW energy rather than from a second,
//     inconsistent toy potential,
//   * sweeps get the restoring force for free.
//
// Lateral MD ("moire reconstruction") relaxes the individual atoms instead of
// the rigid body: each top atom is bonded to its three C-C neighbours by a
// Hooke spring (k, r_eq = a_CC = 1.42 A) and pulled by the LJ gradient from
// the bottom layer, integrated by normalised steepest descent. At soft k the
// flake reconstructs into commensurate domains separated by domain walls.
//
// ------------------------------------------------------------ host contract
//
// Everything expensive is RESUMABLE. A single energy evaluation over a
// 250x250 system is ~1.2e10 pair terms, far more than one frame, so the sum
// carries a cursor and `advance()` runs it in slices; relaxations, sweeps and
// MD are state machines layered on top of that. The consequence is that the
// UI keeps receiving frames and readouts at any system size, and Stop always
// responds — neither of which the browser prototype could manage.

#include "dex_plugin.h"
#include "dex_msg.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <string>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

// ---------------------------------------------------------------- constants

constexpr int W = 900, H = 620;      // frame size, px

constexpr double A0 = 2.46;          // graphene lattice constant, Angstrom
constexpr double ANG2M = 1e-10;      // Angstrom -> m
constexpr double DENS_AT = 3.8176967e19; // atoms / m^2
constexpr double LJ_R0_ANG = 3.40;   // LJ minimum, sets C12 from C6
constexpr double D_MIN = 3.34;       // graphite equilibrium separation
constexpr double D_MAX = 3.75;       // upper bound for this rigid-layer model
constexpr double OFFSET_MAX = 10 * A0; // +/- 10 lattice constants, Angstrom

// ---------------------------------------------------------------- Hamaker
//
// Hamaker's construction is the SAME dispersion physics as the pair sum, done
// as a continuum integral over uniform densities instead of over lattice
// sites. For two parallel 2D sheets of areal density n, integrating -C6/r^6
// over one sheet gives, per unit area,
//
//     W(d) = - pi * C6 * n^2 / (2 d^4)
//
// (2D-2D falls off as d^-4; the familiar -A/(12 pi d^2) is the 3D half-space
// case.) The corresponding 3D Hamaker constant is A = pi^2 * C6 * rho^2 with
// rho the volume density, which for graphite lands on ~3e-19 J — squarely in
// the measured 2.4-4.7e-19 J range, so it doubles as a check on C6.
//
// This is used for two things, and deliberately NOT for a third:
//   * as an exact analytic TAIL: the discrete sum only covers a finite
//     lateral radius, and r^-6 summed over a plane converges as R^-4, so a
//     truncated window loses real binding energy. Adding the continuum
//     integral of everything outside the covered radius,
//         E_tail/atom = - pi * C6 * n / (2 (R^2 + d^2)^2),
//     recovers it. That is what makes the fast neighbour mode trustworthy.
//   * as a reference baseline to compare the discrete result against.
//   * NOT as the corrugation. The continuum average is precisely the step
//     that erases registry, so W(d) has no theta or offset dependence
//     whatsoever. Superlubricity lives entirely in what Hamaker averages out.
constexpr double GRAPHITE_INTERLAYER_M = 3.35e-10; // for the volume density

// Lateral MD
constexpr double A_CC = A0 / 1.7320508075688772; // C-C bond, ~1.42 A
constexpr double VDW_LAT_CUTOFF = 8.0;   // lateral neighbour cutoff, A
constexpr double MD_MAX_DISP = 1.5;      // clamp on total per-atom displacement
constexpr double MD_STEP = 0.02;         // target max displacement per step, A

// The lateral force on the rigid flake is exactly -grad U. dU/dt is carried in
// J per Angstrom, and 1 J/A = 1e10 N, so this is the only constant needed to
// report a real force in nN. No spring, no damping, no fitted parameters.
constexpr double JPA_TO_NN = 1.0e19; // (J/Angstrom) -> nN

// Lattice vectors and the two-atom basis.
const double a1x = A0, a1y = 0.0;
const double a2x = A0 * 0.5, a2y = A0 * 0.8660254037844386;
const double b0x = 0.0, b0y = 0.0;
const double b1x = A0 * 0.5, b1y = A0 / 3.4641016151377544;

struct Vec2 { double x = 0, y = 0; };

// Geometry helpers — direct ports of the prototype so the masks, and hence
// the atom counts and the absolute energies, match it exactly.
inline void cell_pair_center(int i, int j, double *x, double *y) {
    *x = i * a1x + j * a2x + 0.5 * (b0x + b1x);
    *y = i * a1y + j * a2y + 0.5 * (b0y + b1y);
}
inline void center_of_flake(int Nx, int Ny, double *x, double *y) {
    const double ci = (Nx - 1) * 0.5, cj = (Ny - 1) * 0.5;
    *x = ci * a1x + cj * a2x + (b0x + b1x) * 0.5;
    *y = ci * a1y + cj * a2y + (b0y + b1y) * 0.5;
}
inline double flake_mask_half(int Nx, int Ny) {
    double cx, cy; center_of_flake(Nx, Ny, &cx, &cy);
    const int ii[4] = {0, Nx - 1, 0, Nx - 1};
    const int jj[4] = {0, 0, Ny - 1, Ny - 1};
    double hx = 0, hy = 0;
    for (int k = 0; k < 4; k++) {
        double x, y; cell_pair_center(ii[k], jj[k], &x, &y);
        hx = std::max(hx, std::fabs(x - cx));
        hy = std::max(hy, std::fabs(y - cy));
    }
    return std::min(hx, hy);
}

// ---------------------------------------------------------------- instance

struct Instance {
    // ---- controls (the panel) ----
    int nB = 30, nT = 18;
    double dist = D_MIN;
    double angle = 0.0;      // deg
    double tx = 0.0, ty = 0.0; // Angstrom
    bool limited = false;    // neighbour mode
    int nneigh = 6;
    bool use_tail = true;    // add the Hamaker continuum tail correction
    double c6 = 2.45e-78;
    int metric = 1;          // 0 = U (J), 1 = U/A
    double atom_size = 4.0;  // px
    double kspring = 950.0;  // N/m
    int md_max_steps = 400;
    double angle_step = 2.0;
    double translation_step = 0.20;
    double disp_amp = 50.0;
    bool relax_xy = true, relax_d = true;
    bool show_registry = true, show_arrows = true;
    bool show_bottom = true;
    int theme = 1;           // 0 = dark, 1 = light (light by default)
    double zoom = 1.0;

    // ---- geometry caches ----
    std::vector<int> tci, tcj;           // top cells inside the circle
    std::vector<double> tAx0, tAy0, tBx0, tBy0; // their unrotated site positions
    std::vector<uint8_t> bmask;          // bottom cell mask, NxB*NyB
    std::vector<double> bAx, bAy, bBx, bBy; // bottom site positions per cell
    std::vector<double> botx, boty;      // flat bottom atom list (drawing / MD)
    double cxTop = 0, cyTop = 0, cxBot = 0, cyBot = 0, shiftX = 0, shiftY = 0;
    double botHalf = 1;
    int atoms_top = 0, atoms_bot = 0;
    long long pair_count = 0;
    double area_top = 1;
    bool geom_dirty = true;

    // ---- energy evaluation (resumable) ----
    double UJ = 0, UA = 0;      // last completed result
    double gx = 0, gy = 0;      // dU/dtx, dU/dty  (J per Angstrom)
    double acc_u = 0, acc_gx = 0, acc_gy = 0;
    size_t ecur = 0;            // cursor over top cells
    bool energy_running = false, energy_dirty = true;
    double eval_ms = 0;
    std::chrono::steady_clock::time_point eval_t0;
    long long evals = 0;

    // ---- jobs ----
    enum Job { JOB_NONE, JOB_RELAX, JOB_SWEEP_ROT, JOB_SWEEP_TX, JOB_MD };
    Job job = JOB_NONE;
    std::string job_label;

    // relaxation sub-state
    int relax_phase = 0;   // 0 = xy, 1 = height
    int relax_pass = 0, relax_max_pass = 4;
    bool relax_quick = false;
    // xy (gradient descent)
    double rx_step = 0, rx_tx0 = 0, rx_ty0 = 0, rx_best = 0;
    double rx_px = 0, rx_py = 0;   // best-so-far offset, for backtracking
    int rx_iter = 0, rx_max_iter = 0;
    bool rx_have_ref = false;
    // height (scan)
    double rd_cur = 0, rd_max = 0, rd_best_val = 0, rd_best_d = 0;
    bool rd_have_ref = false;

    // sweeps
    double sweep_cur = 0, sweep_end = 0, sweep_step = 0;
    int sweep_stage = 0;   // 0 = relax xy, 1 = relax height, 2 = record
    bool sw_rx_started = false, sw_rd_started = false;
    double sweep_fixed_angle = 0;

    // ---- lateral MD ----
    struct MDAtom {
        double x0, y0, dx, dy;
        int nb[3]; int nnb;
        int bstart, bcount;
    };
    std::vector<MDAtom> md;
    std::vector<int> md_bnb;   // flattened bottom-neighbour indices
    int md_step_i = 0;
    double md_max_disp = 0, md_maxf = 0;
    bool md_built = false;

    // ---- rigid drag (PT on the vdW landscape) ----
    bool dragging = false;
    int drag_mode = 0;         // 1 = translate, 2 = rotate
    Vec2 grab_world, grab_off;
    double grab_angle = 0, grab_bearing = 0;

    // ---- view / output ----
    double ppa = 1.0;          // px per Angstrom
    std::vector<uint8_t> frame;
    std::vector<float> nearest; // registry distance per top atom, A
    bool nearest_dirty = true;

    double msg_clock = 0;
    double series_t = 0;
    std::deque<std::string> outbox;
    std::string handout;
    std::string status;

    Instance() : frame((size_t)W * H * 4) { rebuild(); }

    // ------------------------------------------------------------ geometry

    double c12() const {
        const double r0m = LJ_R0_ANG * ANG2M;
        return 0.5 * c6 * r0m * r0m * r0m * r0m * r0m * r0m;
    }

    // ------------------------------------------------------------ Hamaker

    // Radius (m) actually covered by the discrete sum: the neighbour window
    // when limited, otherwise the inscribed half-width of the bottom sheet.
    double covered_radius_m() const {
        const double r_ang = limited ? std::max(0, nneigh) * A0 : botHalf;
        return std::max(A0, r_ang) * ANG2M;
    }

    // Continuum energy of everything the discrete sum does not reach, per top
    // atom: -pi C6 n / (2 (R^2 + d^2)^2). Exact for a uniform sheet.
    double hamaker_tail_per_atom() const {
        const double R = covered_radius_m();
        const double dm = std::max(D_MIN, dist) * ANG2M;
        const double s = R * R + dm * dm;
        return -M_PI * c6 * DENS_AT / (2.0 * s * s);
    }
    double hamaker_tail_total() const {
        return use_tail ? hamaker_tail_per_atom() * atoms_top : 0.0;
    }

    // Sheet-on-sheet continuum energy per unit area, J/m^2 (negative).
    double hamaker_W() const {
        const double dm = std::max(D_MIN, dist) * ANG2M;
        const double d4 = dm * dm * dm * dm;
        return -M_PI * c6 * DENS_AT * DENS_AT / (2.0 * d4);
    }

    // Conventional 3D Hamaker constant implied by this C6, for comparison
    // against the measured graphite value.
    double hamaker_A() const {
        const double rho = DENS_AT / GRAPHITE_INTERLAYER_M; // atoms / m^3
        return M_PI * M_PI * c6 * rho * rho;
    }

    void rebuild() {
        nB = std::max(1, std::min(250, nB));
        nT = std::max(1, std::min(250, nT));
        center_of_flake(nT, nT, &cxTop, &cyTop);
        center_of_flake(nB, nB, &cxBot, &cyBot);
        shiftX = cxBot - cxTop;
        shiftY = cyBot - cyTop;

        // top cells inside the inscribed circle
        tci.clear(); tcj.clear();
        tAx0.clear(); tAy0.clear(); tBx0.clear(); tBy0.clear();
        {
            const double R = flake_mask_half(nT, nT);
            const double R2 = R * R;
            for (int i = 0; i < nT; i++)
                for (int j = 0; j < nT; j++) {
                    double x, y; cell_pair_center(i, j, &x, &y);
                    const double dx = x - cxTop, dy = y - cyTop;
                    if (dx * dx + dy * dy > R2) continue;
                    tci.push_back(i); tcj.push_back(j);
                    const double cx = i * a1x + j * a2x, cy = i * a1y + j * a2y;
                    tAx0.push_back(cx + b0x); tAy0.push_back(cy + b0y);
                    tBx0.push_back(cx + b1x); tBy0.push_back(cy + b1y);
                }
        }
        atoms_top = (int)tci.size() * 2;

        // bottom cells inside the square
        bmask.assign((size_t)nB * nB, 0);
        bAx.assign((size_t)nB * nB, 0); bAy.assign((size_t)nB * nB, 0);
        bBx.assign((size_t)nB * nB, 0); bBy.assign((size_t)nB * nB, 0);
        botx.clear(); boty.clear();
        botHalf = flake_mask_half(nB, nB);
        for (int i = 0; i < nB; i++)
            for (int j = 0; j < nB; j++) {
                double x, y; cell_pair_center(i, j, &x, &y);
                if (std::fabs(x - cxBot) > botHalf || std::fabs(y - cyBot) > botHalf)
                    continue;
                const size_t k = (size_t)i * nB + j;
                bmask[k] = 1;
                const double cx = i * a1x + j * a2x, cy = i * a1y + j * a2y;
                bAx[k] = cx + b0x; bAy[k] = cy + b0y;
                bBx[k] = cx + b1x; bBy[k] = cy + b1y;
                botx.push_back(bAx[k]); boty.push_back(bAy[k]);
                botx.push_back(bBx[k]); boty.push_back(bBy[k]);
            }
        atoms_bot = (int)botx.size();
        area_top = atoms_top / DENS_AT;

        count_pairs();
        fit_view();
        geom_dirty = false;
        energy_dirty = true;
        md_built = false;
        md.clear();
        nearest_dirty = true;
    }

    int window_n() const {
        return limited ? std::max(0, nneigh) : std::max(nB, nB);
    }

    void count_pairs() {
        const int N = window_n();
        long long p = 0;
        for (size_t t = 0; t < tci.size(); t++) {
            const int i = tci[t], j = tcj[t];
            int ci = i, cj = j;
            if (limited) {
                // same window centring as energy_tick(), at zero twist/offset
                const double px = 0.5 * (tAx0[t] + tBx0[t]) + shiftX
                                  - 0.5 * (b0x + b1x);
                const double py = 0.5 * (tAy0[t] + tBy0[t]) + shiftY
                                  - 0.5 * (b0y + b1y);
                cj = (int)std::lround(py / a2y);
                ci = (int)std::lround((px - cj * a2x) / a1x);
            }
            const int i0 = std::max(0, ci - N), i1 = std::min(nB - 1, ci + N);
            const int j0 = std::max(0, cj - N), j1 = std::min(nB - 1, cj + N);
            for (int ni = i0; ni <= i1; ni++)
                for (int nj = j0; nj <= j1; nj++)
                    if (bmask[(size_t)ni * nB + nj]) p += 4;
        }
        pair_count = p;
    }

    void fit_view() {
        const double half = (botHalf + 2 * A0) / std::max(0.05, zoom);
        ppa = (double)W / (2.0 * half);
    }

    // ------------------------------------------------- energy (resumable)

    void energy_begin() {
        acc_u = acc_gx = acc_gy = 0;
        ecur = 0;
        energy_running = true;
        eval_t0 = std::chrono::steady_clock::now();
    }

    // Sum a slice of top cells. Returns true when the whole flake is done.
    bool energy_tick(double budget_s) {
        if (!energy_running) energy_begin();
        const double th = angle * M_PI / 180.0;
        const double c = std::cos(th), s = std::sin(th);
        const double dm = std::max(D_MIN, dist) * ANG2M;
        const double cA = c6, cR = c12();
        const int N = window_n();
        const auto t0 = std::chrono::steady_clock::now();

        while (ecur < tci.size()) {
            // Chunk size is tuned so the time check itself stays cheap while
            // still letting Stop respond promptly on a huge system.
            size_t hi = std::min(tci.size(), ecur + 64);
            double su = 0, sgx = 0, sgy = 0;
            const int lo = (int)ecur, hii = (int)hi;
#ifdef _OPENMP
#pragma omp parallel for schedule(static) reduction(+ : su, sgx, sgy)
#endif
            for (int t = lo; t < hii; t++) {
                const int i = tci[t], j = tcj[t];
                const double ax0 = tAx0[t], ay0 = tAy0[t];
                const double bx0 = tBx0[t], by0 = tBy0[t];
                const double tAx = (ax0 - cxTop) * c - (ay0 - cyTop) * s + cxTop + shiftX + tx;
                const double tAy = (ax0 - cxTop) * s + (ay0 - cyTop) * c + cyTop + shiftY + ty;
                const double tBx = (bx0 - cxTop) * c - (by0 - cyTop) * s + cxTop + shiftX + tx;
                const double tBy = (bx0 - cxTop) * s + (by0 - cyTop) * c + cyTop + shiftY + ty;
                // Centre the neighbour window on the bottom cell the atom is
                // ACTUALLY over. The prototype windowed around the top cell's
                // own index, which is only the same cell when the two layers
                // are the same size — with a 12-cell flake centred on a
                // 20-cell sheet the window sat ~4 cells (10 A) off target and
                // threw away 57% of the binding at N=4. (That is what its
                // "increase if energy looks wrong" warning was about.)
                int ci = i, cj = j;
                if (limited) {
                    const double px = (tAx + tBx) * 0.5 - 0.5 * (b0x + b1x);
                    const double py = (tAy + tBy) * 0.5 - 0.5 * (b0y + b1y);
                    cj = (int)std::lround(py / a2y);
                    ci = (int)std::lround((px - cj * a2x) / a1x);
                }
                const int i0 = std::max(0, ci - N), i1 = std::min(nB - 1, ci + N);
                const int j0 = std::max(0, cj - N), j1 = std::min(nB - 1, cj + N);
                double u = 0, ggx = 0, ggy = 0;
                for (int ni = i0; ni <= i1; ni++) {
                    const size_t row = (size_t)ni * nB;
                    for (int nj = j0; nj <= j1; nj++) {
                        const size_t k = row + nj;
                        if (!bmask[k]) continue;
                        const double p[4] = {bAx[k], bAy[k], bBx[k], bBy[k]};
                        const double q[4] = {tAx, tAy, tBx, tBy};
                        for (int ts = 0; ts < 2; ts++)
                            for (int bs = 0; bs < 2; bs++) {
                                const double dx = (q[ts * 2] - p[bs * 2]) * ANG2M;
                                const double dy = (q[ts * 2 + 1] - p[bs * 2 + 1]) * ANG2M;
                                const double r2 = dx * dx + dy * dy + dm * dm;
                                const double i2 = 1.0 / r2;
                                const double i6 = i2 * i2 * i2;
                                const double i12 = i6 * i6;
                                u += cR * i12 - cA * i6;
                                // dV/d(dx) = (-12 C12 r^-14 + 6 C6 r^-8) dx
                                const double sc = (-12.0 * cR * i12 + 6.0 * cA * i6) * i2;
                                ggx += sc * dx;
                                ggy += sc * dy;
                            }
                    }
                }
                su += u; sgx += ggx; sgy += ggy;
            }
            acc_u += su; acc_gx += sgx; acc_gy += sgy;
            ecur = hi;
            if (std::chrono::duration<double>(std::chrono::steady_clock::now() - t0)
                    .count() > budget_s)
                break;
        }
        if (ecur < tci.size()) return false;

        // The tail is a smooth function of d alone, so it shifts U and its
        // d-dependence but contributes nothing to the lateral gradient — which
        // is exactly the statement that Hamaker carries no registry.
        UJ = acc_u + hamaker_tail_total();
        UA = UJ / area_top;
        // gradient is per metre of displacement; report per Angstrom
        gx = acc_gx * ANG2M;
        gy = acc_gy * ANG2M;
        energy_running = false;
        energy_dirty = false;
        evals++;
        eval_ms = std::chrono::duration<double>(
                      std::chrono::steady_clock::now() - eval_t0).count() * 1000.0;
        return true;
    }

    double metric_value() const { return metric == 0 ? UJ : UA * 1000.0; }

    void push_point() {
        char buf[200];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"point\",\"ang\":%.3f,\"tx\":%.4f,\"ty\":%.4f,"
                 "\"d\":%.3f,\"U\":%.6e,\"UA\":%.6e,\"ts\":%.3f}",
                 angle, tx, ty, dist, UJ, UA * 1000.0, series_t);
        outbox.push_back(buf);
    }

    // ------------------------------------------------------- relaxation

    void relax_xy_begin(bool quick) {
        // Break the symmetry before descending. At a commensurate angle with
        // zero offset the layers sit in perfect AA registry, which is a
        // stationary point: grad U is EXACTLY zero there, so gradient descent
        // cannot move and the flake stays pinned on the energy MAXIMUM -
        // precisely at theta = 0, the angle that matters most. The prototype
        // never hit this because its 4-candidate pattern search samples the
        // neighbourhood instead of following the gradient, so it escapes by
        // construction. A nudge of a fifth of a bond length costs two extra
        // evaluations at a genuine minimum (descent just walks back) and
        // rescues every stationary point.
        const double g0 = std::sqrt(gx * gx + gy * gy);
        if (!energy_dirty && g0 < 1e-12 * std::fabs(UJ)) {
            tx += 0.28; ty += 0.16;   // off every mirror line of the lattice
            energy_dirty = true;
        }
        rx_tx0 = tx; rx_ty0 = ty;
        rx_iter = 0;
        rx_max_iter = quick ? 18 : 60;
        rx_step = quick ? 0.10 : 0.18;   // Angstrom
        rx_px = tx; rx_py = ty;
        rx_have_ref = false;
        energy_dirty = true;
    }

    // Gradient descent with backtracking on (tx,ty), clamped to a disk of one
    // lattice constant around the start — "the nearest minimum", not the
    // global one. Backtracking matters: a fixed step never settles, it just
    // orbits the minimum at the step radius and leaves a residual force.
    bool relax_xy_step() {
        if (!rx_have_ref) {                 // first visit: remember and step
            rx_best = UA; rx_px = tx; rx_py = ty; rx_have_ref = true;
        } else if (UA <= rx_best) {         // downhill: accept, stretch out
            rx_best = UA; rx_px = tx; rx_py = ty;
            rx_step = std::min(rx_step * 1.35, 0.4);
        } else {                            // overshot: go back, halve
            tx = rx_px; ty = rx_py;
            rx_step *= 0.4;
            if (rx_step < 2e-4) { energy_dirty = true; return true; }
        }
        const double g = std::sqrt(gx * gx + gy * gy);
        if (!(g > 0) || !std::isfinite(g)) return true;
        double nx = rx_px - rx_step * gx / g;
        double ny = rx_py - rx_step * gy / g;
        double dx = nx - rx_tx0, dy = ny - rx_ty0;
        const double r = std::sqrt(dx * dx + dy * dy);
        if (r > A0 && r > 0) { dx *= A0 / r; dy *= A0 / r; }
        tx = std::max(-OFFSET_MAX, std::min(OFFSET_MAX, rx_tx0 + dx));
        ty = std::max(-OFFSET_MAX, std::min(OFFSET_MAX, rx_ty0 + dy));
        energy_dirty = true;
        rx_iter++;
        return rx_iter >= rx_max_iter;
    }

    void relax_d_begin(bool quick) {
        const double d0 = std::max(D_MIN, std::min(D_MAX, dist));
        rd_cur = quick ? std::max(D_MIN, d0 - 0.08) : D_MIN;
        rd_max = quick ? std::min(D_MAX, d0 + 0.08) : D_MAX;
        rd_best_d = d0;
        rd_have_ref = false;
        dist = rd_cur;
        energy_dirty = true;
    }

    bool relax_d_step() {
        if (!rd_have_ref) { rd_best_val = UA; rd_best_d = dist; rd_have_ref = true; }
        else if (UA < rd_best_val) { rd_best_val = UA; rd_best_d = dist; }
        rd_cur += 0.01;
        if (rd_cur > rd_max + 1e-9) {
            dist = rd_best_d;
            energy_dirty = true;
            return true;
        }
        dist = std::min(D_MAX, rd_cur);
        energy_dirty = true;
        return false;
    }

    // ------------------------------------------------------------- MD

    void md_build() {
        md.clear(); md_bnb.clear();
        const double th = angle * M_PI / 180.0;
        const double c = std::cos(th), s = std::sin(th);
        // index map over (cell, site) so bonds can be found by lattice offset
        const int nc = (int)tci.size();
        // Indexed by the TOP lattice, not the bottom: nT can exceed nB, and
        // sizing this against nB silently dropped every bond past the edge.
        std::vector<int> map((size_t)nT * nT * 2, -1);
        auto key = [&](int i, int j, int site) -> long long {
            if (i < 0 || j < 0 || i >= nT || j >= nT) return -1;
            return ((long long)i * nT + j) * 2 + site;
        };
        for (int t = 0; t < nc; t++) {
            const int i = tci[t], j = tcj[t];
            for (int site = 0; site < 2; site++) {
                const double ax0 = site ? tBx0[t] : tAx0[t];
                const double ay0 = site ? tBy0[t] : tAy0[t];
                MDAtom a{};
                a.x0 = (ax0 - cxTop) * c - (ay0 - cyTop) * s + cxTop + shiftX + tx;
                a.y0 = (ax0 - cxTop) * s + (ay0 - cyTop) * c + cyTop + shiftY + ty;
                a.dx = a.dy = 0; a.nnb = 0; a.bstart = 0; a.bcount = 0;
                const long long k = key(i, j, site);
                if (k >= 0 && (size_t)k < map.size()) map[(size_t)k] = (int)md.size();
                md.push_back(a);
            }
        }
        // in-plane C-C bonds: A(i,j) to three B neighbours and vice versa
        for (int t = 0; t < nc; t++) {
            const int i = tci[t], j = tcj[t];
            for (int site = 0; site < 2; site++) {
                const long long k = key(i, j, site);
                if (k < 0) continue;
                const int idx = map[(size_t)k];
                if (idx < 0) continue;
                long long nk[3];
                if (site == 0) {
                    nk[0] = key(i, j, 1); nk[1] = key(i - 1, j, 1); nk[2] = key(i, j - 1, 1);
                } else {
                    nk[0] = key(i, j, 0); nk[1] = key(i + 1, j, 0); nk[2] = key(i, j + 1, 0);
                }
                for (int q = 0; q < 3; q++) {
                    if (nk[q] < 0 || (size_t)nk[q] >= map.size()) continue;
                    const int ni = map[(size_t)nk[q]];
                    if (ni >= 0 && md[idx].nnb < 3) md[idx].nb[md[idx].nnb++] = ni;
                }
            }
        }
        // per-atom bottom neighbour lists within the lateral cutoff
        const double cut = VDW_LAT_CUTOFF + 1.5;
        const double cut2 = cut * cut;
        // bucket the bottom atoms so this is not O(N_top * N_bot)
        const double cell = cut;
        const int gw = std::max(1, (int)std::ceil((2 * botHalf + 4 * A0) / cell));
        const double gx0 = cxBot - botHalf - 2 * A0, gy0 = cyBot - botHalf - 2 * A0;
        std::vector<std::vector<int>> grid((size_t)gw * gw);
        for (size_t b = 0; b < botx.size(); b++) {
            int cxi = (int)((botx[b] - gx0) / cell), cyi = (int)((boty[b] - gy0) / cell);
            cxi = std::max(0, std::min(gw - 1, cxi));
            cyi = std::max(0, std::min(gw - 1, cyi));
            grid[(size_t)cxi * gw + cyi].push_back((int)b);
        }
        for (auto &a : md) {
            a.bstart = (int)md_bnb.size();
            int cxi = (int)((a.x0 - gx0) / cell), cyi = (int)((a.y0 - gy0) / cell);
            for (int ox = -1; ox <= 1; ox++)
                for (int oy = -1; oy <= 1; oy++) {
                    const int px = cxi + ox, py = cyi + oy;
                    if (px < 0 || py < 0 || px >= gw || py >= gw) continue;
                    for (int b : grid[(size_t)px * gw + py]) {
                        const double dx = a.x0 - botx[b], dy = a.y0 - boty[b];
                        if (dx * dx + dy * dy <= cut2) md_bnb.push_back(b);
                    }
                }
            a.bcount = (int)md_bnb.size() - a.bstart;
        }
        md_built = true;
        md_step_i = 0;
        md_max_disp = 0;
    }

    // One normalised steepest-descent step; returns max |F| in N.
    double md_do_step() {
        const int n = (int)md.size();
        if (n == 0) return 0;
        const double dm = std::max(D_MIN, dist) * ANG2M;
        const double cA = c6, cR = c12();
        const double cut2m = VDW_LAT_CUTOFF * VDW_LAT_CUTOFF * ANG2M * ANG2M;
        std::vector<double> fx((size_t)n, 0.0), fy((size_t)n, 0.0);

#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int i = 0; i < n; i++) {
            const MDAtom &a = md[i];
            const double axm = (a.x0 + a.dx) * ANG2M, aym = (a.y0 + a.dy) * ANG2M;
            double sx = 0, sy = 0;
            for (int q = 0; q < a.bcount; q++) {
                const int b = md_bnb[(size_t)a.bstart + q];
                const double ddx = axm - botx[b] * ANG2M;
                const double ddy = aym - boty[b] * ANG2M;
                if (ddx * ddx + ddy * ddy > cut2m) continue;
                const double r2 = ddx * ddx + ddy * ddy + dm * dm;
                const double i2 = 1.0 / r2, i6 = i2 * i2 * i2;
                const double sc = (12.0 * cR * i6 * i6 * i2 - 6.0 * cA * i6 * i2);
                sx += sc * ddx; sy += sc * ddy;
            }
            // Hooke springs to the bonded C-C neighbours
            for (int q = 0; q < a.nnb; q++) {
                const MDAtom &b = md[a.nb[q]];
                const double ddx = (b.x0 + b.dx) * ANG2M - axm;
                const double ddy = (b.y0 + b.dy) * ANG2M - aym;
                const double r = std::sqrt(ddx * ddx + ddy * ddy);
                if (r < 1e-30) continue;
                const double f = kspring * (r - A_CC * ANG2M);
                sx += f * ddx / r; sy += f * ddy / r;
            }
            fx[i] = sx; fy[i] = sy;
        }

        double maxf = 0;
        for (int i = 0; i < n; i++)
            maxf = std::max(maxf, std::sqrt(fx[i] * fx[i] + fy[i] * fy[i]));
        if (maxf < 1e-25) return 0;
        const double alpha = MD_STEP / maxf; // Angstrom per Newton
        double mx = 0;
        for (int i = 0; i < n; i++) {
            double ndx = md[i].dx + fx[i] * alpha;
            double ndy = md[i].dy + fy[i] * alpha;
            const double disp = std::sqrt(ndx * ndx + ndy * ndy);
            if (disp > MD_MAX_DISP) { ndx *= MD_MAX_DISP / disp; ndy *= MD_MAX_DISP / disp; }
            md[i].dx = ndx; md[i].dy = ndy;
            mx = std::max(mx, std::sqrt(ndx * ndx + ndy * ndy));
        }
        md_max_disp = mx;
        return maxf;
    }

    void md_reset() {
        for (auto &a : md) { a.dx = a.dy = 0; }
        md_max_disp = 0; md_step_i = 0;
    }

    // --------------------------------------------------- registry map

    void compute_nearest() {
        nearest.assign(tci.size() * 2, 0.0f);
        if (botx.empty()) { nearest_dirty = false; return; }
        const double th = angle * M_PI / 180.0;
        const double c = std::cos(th), s = std::sin(th);
        const double cell = A0 * 1.2;
        const int gw = std::max(1, (int)std::ceil((2 * botHalf + 4 * A0) / cell));
        const double gx0 = cxBot - botHalf - 2 * A0, gy0 = cyBot - botHalf - 2 * A0;
        std::vector<std::vector<int>> grid((size_t)gw * gw);
        for (size_t b = 0; b < botx.size(); b++) {
            int ci = (int)((botx[b] - gx0) / cell), cj = (int)((boty[b] - gy0) / cell);
            ci = std::max(0, std::min(gw - 1, ci)); cj = std::max(0, std::min(gw - 1, cj));
            grid[(size_t)ci * gw + cj].push_back((int)b);
        }
        const int n = (int)tci.size();
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int t = 0; t < n; t++) {
            for (int site = 0; site < 2; site++) {
                const double ax0 = site ? tBx0[t] : tAx0[t];
                const double ay0 = site ? tBy0[t] : tAy0[t];
                double x = (ax0 - cxTop) * c - (ay0 - cyTop) * s + cxTop + shiftX + tx;
                double y = (ax0 - cxTop) * s + (ay0 - cyTop) * c + cyTop + shiftY + ty;
                const size_t idx = (size_t)t * 2 + site;
                if (md_built && idx < md.size()) { x += md[idx].dx; y += md[idx].dy; }
                int ci = (int)((x - gx0) / cell), cj = (int)((y - gy0) / cell);
                double best = 1e9;
                for (int ox = -1; ox <= 1; ox++)
                    for (int oy = -1; oy <= 1; oy++) {
                        const int px = ci + ox, py = cj + oy;
                        if (px < 0 || py < 0 || px >= gw || py >= gw) continue;
                        for (int b : grid[(size_t)px * gw + py]) {
                            const double dx = x - botx[b], dy = y - boty[b];
                            const double d2 = dx * dx + dy * dy;
                            if (d2 < best) best = d2;
                        }
                    }
                nearest[idx] = (float)std::sqrt(best < 1e8 ? best : 0.0);
            }
        }
        nearest_dirty = false;
    }

    // ------------------------------------------------------------ drawing

    inline void to_screen(double x, double y, double *sx, double *sy) const {
        *sx = W * 0.5 + (x - cxBot) * ppa;
        *sy = H * 0.5 - (y - cyBot) * ppa;
    }
    Vec2 to_world(double nx, double ny) const {
        return {cxBot + (nx - 0.5) * (double)W / ppa,
                cyBot - (ny - 0.5) * (double)H / ppa};
    }

    inline void blend(int x, int y, int r, int g, int b, double a) {
        if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
        if (a > 1) a = 1;
        uint8_t *p = &frame[((size_t)y * W + x) * 4];
        p[0] = (uint8_t)(p[0] + (r - p[0]) * a);
        p[1] = (uint8_t)(p[1] + (g - p[1]) * a);
        p[2] = (uint8_t)(p[2] + (b - p[2]) * a);
    }
    void line(double x0, double y0, double x1, double y1, int r, int g, int b, double a) {
        const double dx = x1 - x0, dy = y1 - y0;
        const int n = (int)(std::max(std::fabs(dx), std::fabs(dy)) + 1);
        if (n > 4000) return;
        for (int i = 0; i <= n; i++) {
            const double t = (double)i / n;
            blend((int)std::lround(x0 + dx * t), (int)std::lround(y0 + dy * t), r, g, b, a);
        }
    }
    void ring(double cx, double cy, double rad, int r, int g, int b, double a, int dash = 0) {
        if (rad < 1 || rad > 4000) return;
        const int n = std::max(48, (int)(rad * 6));
        for (int i = 0; i < n; i++) {
            if (dash && ((i / dash) & 1)) continue;
            const double t = 2.0 * M_PI * i / n;
            blend((int)std::lround(cx + rad * std::cos(t)),
                  (int)std::lround(cy + rad * std::sin(t)), r, g, b, a);
        }
    }
    void disc(double cx, double cy, double rad, int r, int g, int b, double a) {
        const int ir = (int)std::ceil(rad);
        const int bx = (int)std::lround(cx), by = (int)std::lround(cy);
        if (bx < -ir || bx > W + ir || by < -ir || by > H + ir) return;
        for (int oy = -ir; oy <= ir; oy++)
            for (int ox = -ir; ox <= ir; ox++) {
                const double d = std::sqrt((double)(ox * ox + oy * oy));
                if (d > rad + 0.5) continue;
                const double edge = std::min(1.0, (rad + 0.5 - d));
                blend(bx + ox, by + oy, r, g, b, a * edge);
            }
    }

    // hue 0 (red, AA) -> 240 (blue, hollow site), as in the prototype
    static void hsl(double hdeg, double sat, double lig, int *r, int *g, int *b) {
        const double C = (1 - std::fabs(2 * lig - 1)) * sat;
        const double hp = hdeg / 60.0;
        const double X = C * (1 - std::fabs(std::fmod(hp, 2.0) - 1));
        double r1 = 0, g1 = 0, b1 = 0;
        if (hp < 1) { r1 = C; g1 = X; }
        else if (hp < 2) { r1 = X; g1 = C; }
        else if (hp < 3) { g1 = C; b1 = X; }
        else if (hp < 4) { g1 = X; b1 = C; }
        else if (hp < 5) { r1 = X; b1 = C; }
        else { r1 = C; b1 = X; }
        const double m = lig - C / 2;
        *r = (int)std::lround(255 * (r1 + m));
        *g = (int)std::lround(255 * (g1 + m));
        *b = (int)std::lround(255 * (b1 + m));
    }

    void paint() {
        const bool light = theme == 1;
        const uint8_t bgr = light ? 250 : 11, bgg = light ? 250 : 14, bgb = light ? 252 : 20;
        for (size_t i = 0; i < (size_t)W * H; i++) {
            uint8_t *p = &frame[i * 4];
            p[0] = bgr; p[1] = bgg; p[2] = bgb; p[3] = 255;
        }
        if (nearest_dirty && show_registry) compute_nearest();

        const double rad = std::max(0.7, atom_size * std::min(2.0, ppa / 3.0) * 0.5);

        // ---- bottom layer
        if (show_bottom) {
            const int br = light ? 176 : 58, bg2 = light ? 186 : 66, bb = light ? 200 : 84;
            const double brad = std::max(0.6, rad * 0.72);
            // Skip drawing when the sheet is so dense that atoms would merge
            // into a flat wash — a 250x250 sheet is 125 000 discs.
            const int stride = (ppa * A0 < 2.0) ? 3 : 1;
            for (size_t b = 0; b < botx.size(); b += stride) {
                double sx, sy; to_screen(botx[b], boty[b], &sx, &sy);
                if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
                disc(sx, sy, brad, br, bg2, bb, 0.85);
            }
        }

        // ---- top flake
        const double th = angle * M_PI / 180.0;
        const double c = std::cos(th), s = std::sin(th);
        for (size_t t = 0; t < tci.size(); t++) {
            for (int site = 0; site < 2; site++) {
                const double ax0 = site ? tBx0[t] : tAx0[t];
                const double ay0 = site ? tBy0[t] : tAy0[t];
                double x = (ax0 - cxTop) * c - (ay0 - cyTop) * s + cxTop + shiftX + tx;
                double y = (ax0 - cxTop) * s + (ay0 - cyTop) * c + cyTop + shiftY + ty;
                const size_t idx = t * 2 + site;
                double dxv = 0, dyv = 0;
                if (md_built && idx < md.size()) { dxv = md[idx].dx; dyv = md[idx].dy; }
                const double xa = x + dxv * disp_amp, ya = y + dyv * disp_amp;
                double sx, sy; to_screen(xa, ya, &sx, &sy);
                if (sx < -6 || sx > W + 6 || sy < -6 || sy > H + 6) continue;

                int r, g, b;
                if (show_registry && idx < nearest.size()) {
                    const double tt = std::min(1.0, std::max(0.0, nearest[idx] / A_CC));
                    hsl(tt * 240.0, 0.85, light ? 0.46 : 0.55, &r, &g, &b);
                } else {
                    r = light ? 30 : 235; g = light ? 64 : 240; b = light ? 140 : 250;
                }
                disc(sx, sy, rad, r, g, b, 0.95);

                if (show_arrows && md_built && (dxv != 0 || dyv != 0)) {
                    double ox, oy; to_screen(x, y, &ox, &oy);
                    const double len = std::hypot(sx - ox, sy - oy);
                    if (len > 1.2)
                        line(ox, oy, sx, sy, light ? 190 : 250, light ? 60 : 160,
                             light ? 30 : 40, 0.85);
                }
            }
        }

        // ---- flake outline + drag zones
        {
            const double R = flake_mask_half(nT, nT) * ppa;
            double fx, fy;
            to_screen(cxTop + shiftX + tx, cyTop + shiftY + ty, &fx, &fy);
            const int lr = light ? 90 : 226, lg = light ? 100 : 232, lb = light ? 120 : 240;
            ring(fx, fy, R, lr, lg, lb, 0.55);
            for (int o = 0; o < 2; o++) {
                ring(fx, fy, R * 0.40 + o, 34, 180, 220, 0.8, 4);
                ring(fx, fy, R * 0.75 + o, 150, 120, 240, 0.75, 4);
            }
            line(fx, fy, fx + R * std::cos(-th), fy + R * std::sin(-th),
                 light ? 40 : 120, light ? 90 : 170, light ? 200 : 250, 0.8);
        }
    }

    // ------------------------------------------------------------ messages

    void push_state() {
        char buf[1000];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"state\",\"angle\":%.3f,\"tx\":%.4f,\"ty\":%.4f,\"d\":%.3f,"
                 "\"U\":%.6e,\"UA\":%.6e,\"fx\":%.5g,\"fy\":%.5g,\"fmag\":%.5g,"
                 "\"atop\":%d,\"abot\":%d,\"pairs\":%lld,\"area\":%.6e,"
                 "\"tail\":%.6e,\"hamW\":%.6e,\"hamA\":%.6e,"
                 "\"maxdisp\":%.5f,\"mdstep\":%d,\"maxf\":%.4e,"
                 "\"job\":%d,\"prog\":%.3f,\"ms\":%.1f,\"busy\":%d,"
                 "\"drag\":%d,\"nT\":%d,\"nB\":%d}",
                 angle, tx, ty, dist, UJ, UA * 1000.0,
                 force_x(), force_y(), force_mag(),
                 atoms_top, atoms_bot, pair_count, area_top,
                 hamaker_tail_total(), hamaker_W() * 1000.0, hamaker_A(),
                 md_max_disp, md_step_i, md_maxf,
                 (int)job, job_progress(), eval_ms,
                 (job != JOB_NONE || energy_running) ? 1 : 0,
                 dragging ? 1 : 0, nT, nB);
        std::string m(buf);
        if (!status.empty()) {
            std::string esc;
            for (char ch : status) { if (ch == '"' || ch == '\\') esc += '\\'; esc += ch; }
            m.insert(m.size() - 1, ",\"status\":\"" + esc + "\"");
        }
        outbox.push_back(m);
    }

    double job_progress() const {
        switch (job) {
            case JOB_SWEEP_ROT:
            case JOB_SWEEP_TX:
                if (std::fabs(sweep_end) < 1e-12 && std::fabs(sweep_cur) < 1e-12) return 0;
                return std::min(1.0, std::fabs(sweep_cur) / std::max(1e-9, std::fabs(sweep_end)));
            case JOB_MD:
                return md_max_steps > 0 ? (double)md_step_i / md_max_steps : 0;
            default:
                return energy_running && !tci.empty()
                           ? (double)ecur / (double)tci.size() : 0;
        }
    }

    // ------------------------------------------------------------ jobs

    void stop_job() {
        job = JOB_NONE;
        job_label.clear();
        status = "stopped";
    }

    void start_relax(bool quick) {
        if (!relax_xy && !relax_d) { status = "no relaxation enabled"; return; }
        job = JOB_RELAX;
        relax_quick = quick;
        relax_pass = 0;
        relax_max_pass = quick ? 2 : 4;
        relax_phase = relax_xy ? 0 : 1;
        if (relax_phase == 0) relax_xy_begin(quick); else relax_d_begin(quick);
        status = "relaxing";
    }

    // Which stage a fresh sweep position starts in, given what is enabled.
    // Translation sweeps never relax laterally — that would just undo the
    // translation being applied, which is why the prototype switches it off.
    int sweep_first_stage() const {
        const bool xy = relax_xy && job == JOB_SWEEP_ROT;
        return xy ? 0 : (relax_d ? 1 : 2);
    }

    void start_sweep_rot() {
        job = JOB_SWEEP_ROT;
        sweep_cur = 0; sweep_end = 180; sweep_step = angle_step;
        angle = 0;
        sweep_stage = sweep_first_stage();
        sw_rx_started = sw_rd_started = false;
        energy_dirty = true;
        status = "rotation sweep";
    }

    void start_sweep_tx(int dir) {
        job = JOB_SWEEP_TX;
        sweep_fixed_angle = angle;
        const double target = tx + (dir > 0 ? 12.0 : -12.0);
        sweep_end = std::max(-OFFSET_MAX, std::min(OFFSET_MAX, target));
        sweep_step = (dir > 0 ? 1 : -1) * translation_step;
        sweep_cur = tx;
        sweep_stage = sweep_first_stage();
        sw_rx_started = sw_rd_started = false;
        energy_dirty = true;
        status = dir > 0 ? "translating right" : "translating left";
    }

    void start_md() {
        if (!md_built) md_build();
        job = JOB_MD;
        md_step_i = 0;
        status = "running lateral MD";
    }

    // Run one unit of whatever job is active. Returns true if work was done.
    bool job_tick(double budget) {
        if (job == JOB_NONE) return false;
        const auto t0 = std::chrono::steady_clock::now();
        auto over = [&] {
            return std::chrono::duration<double>(
                       std::chrono::steady_clock::now() - t0).count() > budget;
        };

        while (!over()) {
            if (job == JOB_MD) {
                if (md_step_i >= md_max_steps) {
                    status = "MD finished";
                    job = JOB_NONE;
                    nearest_dirty = true;
                    energy_dirty = true;
                    return true;
                }
                md_maxf = md_do_step();
                md_step_i++;
                nearest_dirty = true;
                if (md_maxf == 0) { status = "MD converged"; job = JOB_NONE; energy_dirty = true; }
                continue;
            }

            // every other job needs a completed energy evaluation
            if (energy_dirty || energy_running) {
                if (!energy_tick(budget)) return true;
            }

            if (job == JOB_RELAX) {
                bool phase_done;
                if (relax_phase == 0) phase_done = relax_xy_step();
                else phase_done = relax_d_step();
                if (!phase_done) continue;
                // move to the next phase / pass
                if (relax_phase == 0 && relax_d) { relax_phase = 1; relax_d_begin(relax_quick); continue; }
                relax_pass++;
                if (relax_pass >= relax_max_pass || !(relax_xy && relax_d)) {
                    job = JOB_NONE;
                    status = "relaxed";
                    return true;
                }
                relax_phase = relax_xy ? 0 : 1;
                if (relax_phase == 0) relax_xy_begin(relax_quick); else relax_d_begin(relax_quick);
                continue;
            }

            if (job == JOB_SWEEP_ROT || job == JOB_SWEEP_TX) {
                // Explicit stages. Deriving "which relaxation am I in" from
                // relax_phase does NOT work: the height phase sets it to 1, the
                // lateral branch then reads "not 0", restarts itself, and the
                // sweep spins forever without ever recording a point.
                //   0 = relax xy   1 = relax height   2 = record and advance
                if (sweep_stage == 0) {
                    if (!sw_rx_started) {
                        relax_xy_begin(true);
                        sw_rx_started = true;
                        continue;   // recompute U and grad U before stepping
                    }
                    if (!relax_xy_step()) continue;
                    sweep_stage = relax_d ? 1 : 2;
                    sw_rd_started = false;
                    continue;
                }
                if (sweep_stage == 1) {
                    if (!sw_rd_started) {
                        relax_d_begin(true);
                        sw_rd_started = true;
                        continue;   // ditto: begin() moved d, so re-evaluate
                    }
                    if (!relax_d_step()) continue;
                    sweep_stage = 2;
                    continue;
                }
                // record and step on
                push_point();
                series_t += 1.0;
                sweep_stage = sweep_first_stage();
                sw_rx_started = sw_rd_started = false;
                if (job == JOB_SWEEP_ROT) {
                    sweep_cur += sweep_step;
                    if (sweep_cur > sweep_end + 1e-9) { job = JOB_NONE; status = "sweep complete"; return true; }
                    angle = sweep_cur;
                } else {
                    sweep_cur += sweep_step;
                    const bool past = sweep_step > 0 ? (sweep_cur > sweep_end) : (sweep_cur < sweep_end);
                    if (past) { tx = sweep_end; job = JOB_NONE; status = "sweep complete"; energy_dirty = true; return true; }
                    tx = sweep_cur;
                    angle = sweep_fixed_angle;
                }
                energy_dirty = true;
                nearest_dirty = true;
                continue;
            }
        }
        return true;
    }

    // ------------------------------------------------------ rigid dragging

    void grab(double nx, double ny) {
        const Vec2 w = to_world(nx, ny);
        const double fx = cxTop + shiftX + tx, fy = cyTop + shiftY + ty;
        const double dx = w.x - fx, dy = w.y - fy;
        const double r = std::sqrt(dx * dx + dy * dy);
        const double R = flake_mask_half(nT, nT);
        if (r <= R * 0.40) drag_mode = 1;
        else if (r >= R * 0.55 && r <= R * 1.25) drag_mode = 2;
        else { drag_mode = 0; dragging = false; return; }
        dragging = true;
        grab_world = w;
        grab_off = {tx, ty};
        grab_angle = angle;
        grab_bearing = std::atan2(dy, dx);
    }

    void move(double nx, double ny) {
        if (!dragging) return;
        const Vec2 w = to_world(nx, ny);
        if (drag_mode == 1) {
            // Direct manipulation, as in the prototype: the flake follows the
            // pointer and the energy readout responds live. What you feel is
            // the number and the chart, not a simulated spring.
            tx = std::max(-OFFSET_MAX, std::min(OFFSET_MAX,
                          grab_off.x + (w.x - grab_world.x)));
            ty = std::max(-OFFSET_MAX, std::min(OFFSET_MAX,
                          grab_off.y + (w.y - grab_world.y)));
            energy_dirty = true;
            nearest_dirty = true;
        } else {
            const double fx = cxTop + shiftX + tx, fy = cyTop + shiftY + ty;
            double d = std::atan2(w.y - fy, w.x - fx) - grab_bearing;
            while (d > M_PI) d -= 2 * M_PI;
            while (d < -M_PI) d += 2 * M_PI;
            angle = grab_angle + d * 180.0 / M_PI;
            while (angle < 0) angle += 360.0;
            while (angle >= 360.0) angle -= 360.0;
            energy_dirty = true;
            nearest_dirty = true;
        }
    }

    // The lateral force on the rigid flake, in nN. This is -grad U from the
    // energy pass itself, so it is exact and shares the reported potential —
    // no spring constant, damping or any other fitted quantity involved.
    double force_x() const { return -gx * JPA_TO_NN; }
    double force_y() const { return -gy * JPA_TO_NN; }
    double force_mag() const { return std::sqrt(gx * gx + gy * gy) * JPA_TO_NN; }

    void reset_position() {
        tx = ty = 0; angle = 0; dist = D_MIN;
        md_reset();
        energy_dirty = true;
        nearest_dirty = true;
        status = "position reset";
    }
};

// ---------------------------------------------------------------- dispatch

void handle(Instance *s, const std::string &m) {
    const std::string t = dexmsg::type_of(m);
    if (t == "set") {
        const std::string k = dexmsg::get_str(m, "k");
        const double v = dexmsg::get_num(m, "v");
        if (k == "nB") { s->nB = (int)v; s->rebuild(); }
        else if (k == "nT") { s->nT = (int)v; s->rebuild(); }
        else if (k == "d") { s->dist = std::max(D_MIN, std::min(D_MAX, v)); s->energy_dirty = true; }
        else if (k == "angle") {
            double a = std::fmod(v, 360.0); if (a < 0) a += 360.0;
            s->angle = a; s->energy_dirty = true; s->nearest_dirty = true;
        }
        else if (k == "tx") { s->tx = std::max(-OFFSET_MAX, std::min(OFFSET_MAX, v)); s->energy_dirty = true; s->nearest_dirty = true; }
        else if (k == "ty") { s->ty = std::max(-OFFSET_MAX, std::min(OFFSET_MAX, v)); s->energy_dirty = true; s->nearest_dirty = true; }
        else if (k == "neigh") { s->limited = v != 0; s->count_pairs(); s->energy_dirty = true; }
        else if (k == "nneigh") { s->nneigh = (int)v; s->count_pairs(); s->energy_dirty = true; }
        else if (k == "tail") { s->use_tail = v != 0; s->energy_dirty = true; }
        else if (k == "c6") { if (v > 0) { s->c6 = v; s->energy_dirty = true; } }
        else if (k == "metric") s->metric = (int)v;
        else if (k == "atomSize") s->atom_size = std::max(1.0, std::min(10.0, v));
        else if (k == "kspring") s->kspring = std::max(1.0, std::min(20000.0, v));
        else if (k == "mdsteps") s->md_max_steps = std::max(10, std::min(5000, (int)v));
        else if (k == "angleStep") s->angle_step = std::max(0.05, std::min(30.0, v));
        else if (k == "translationStep") s->translation_step = std::max(0.01, std::min(12.0, v));
        else if (k == "amp") s->disp_amp = std::max(1.0, std::min(2000.0, v));
        else if (k == "relaxXY") s->relax_xy = v != 0;
        else if (k == "relaxD") s->relax_d = v != 0;
        else if (k == "registry") { s->show_registry = v != 0; s->nearest_dirty = true; }
        else if (k == "arrows") s->show_arrows = v != 0;
        else if (k == "bottom") s->show_bottom = v != 0;
        else if (k == "theme") s->theme = (int)v;
        else if (k == "zoom") { s->zoom = std::max(0.2, std::min(8.0, v)); s->fit_view(); }
    }
    else if (t == "relax") s->start_relax(dexmsg::get_num(m, "quick", 0) != 0);
    else if (t == "sweeprot") s->start_sweep_rot();
    else if (t == "sweeptx") s->start_sweep_tx((int)dexmsg::get_num(m, "dir", 1));
    else if (t == "stop") s->stop_job();
    else if (t == "md") s->start_md();
    else if (t == "mdstop") { if (s->job == Instance::JOB_MD) { s->job = Instance::JOB_NONE; s->status = "MD stopped"; } }
    else if (t == "mdreset") { s->md_reset(); s->nearest_dirty = true; s->status = "MD reset"; }
    else if (t == "mdbuild") { s->md_build(); s->nearest_dirty = true; }
    else if (t == "resetpos") s->reset_position();
    else if (t == "grab") s->grab(dexmsg::get_num(m, "x", 0.5), dexmsg::get_num(m, "y", 0.5));
    else if (t == "move") s->move(dexmsg::get_num(m, "x", 0.5), dexmsg::get_num(m, "y", 0.5));
    else if (t == "release") { s->dragging = false; s->drag_mode = 0; }
    else if (t == "recompute") s->energy_dirty = true;
    else if (t == "point") s->push_point();
}

// ---------------------------------------------------------------- the ABI

void *create() { return new Instance(); }
void destroy(void *p) { delete (Instance *)p; }

int advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    int busy = 0;

    if (s->job != Instance::JOB_NONE) {
        s->job_tick(0.012);
        busy = 1;
    } else {
        if (s->energy_dirty || s->energy_running) {
            if (s->energy_tick(0.012)) {
                s->series_t += dt;
            }
            busy = 1;
        }
    }

    s->msg_clock += dt;
    if (s->msg_clock >= 0.05) {
        s->push_state();
        s->msg_clock = 0;
    }
    return busy;
}

void on_message(void *p, const char *json, size_t len) {
    handle((Instance *)p, std::string(json, len));
}

const char *poll_message(void *p) {
    Instance *s = (Instance *)p;
    if (s->outbox.empty()) return nullptr;
    s->handout = std::move(s->outbox.front());
    s->outbox.pop_front();
    return s->handout.c_str();
}

int render(void *p, dex_frame *out) {
    Instance *s = (Instance *)p;
    s->paint();
    out->width = W;
    out->height = H;
    out->rgba = s->frame.data();
    return 1;
}

const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "superlubricity",
    "Structural Superlubricity",
    "2.0",
    create, destroy, advance, on_message, poll_message, render,
};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) {
    return &API;
}
