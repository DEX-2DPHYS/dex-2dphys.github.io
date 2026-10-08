// hydro -- gates for transim's viscous (Stokes-Ohm) field model (2026-10-08).
//
//  1. Ohmic limit: with a vanishing Gurzhi length the hydrodynamic solve must give
//     the FEM's resistance and Hall voltage (two different discretisations).
//  2. Current conservation: the same current through every column of a strip.
//  3. Poiseuille: in a long channel the current profile is the Brinkman profile
//     j(y) = A [1 - cosh(y/D) / (cosh(h/D) + (l_s/D) sinh(h/D))], and the resistivity
//     rises by 1 / (1 - (2D/W) tanh(W/2D)) (no-slip).  Free slip: flat and Ohmic.
//  4. Gurzhi effect: at fixed mobility the resistance falls as T rises.
//  5. Negative vicinity resistance (Bandurin et al., Science 351, 1055 (2016)):
//     a probe next to a current injector reads a negative nonlocal voltage in the
//     viscous regime, positive in the Ohmic one.
//  6. Hall viscosity (Alekseev 2016, Berdyugin 2019): in a channel the Hall field is
//     E_y = s j + Dh^2 j'' (in jt units), which lowers the Hall voltage; the solve
//     must match that integral across the channel.
//
//   g++ -std=c++17 -O2 -fopenmp -static -Isrc test/hydro.cpp -o hydro.exe
#include "../src/plugin.cpp"
#include <cstdio>

static int fails = 0;
static void check(bool ok, const char *what) { std::printf("[%s] %s\n", ok ? " OK " : "FAIL", what); if (!ok) ++fails; }

static Instance base(double W, double H, int res) {
    Instance s;
    s.p.Wum = W; s.p.Hum = H; s.p.res = res; s.p.ncm2 = 1e12; s.p.mucm = 50000; s.p.B = 0;
    s.p.Vsource = 1e-3; s.p.Vdrain = 0; s.p.tempK = 200;
    return s;
}
static double colCurrent(const FEMResult &r, int i) { double I = 0; for (int j = 0; j < r.ny; ++j) I += r.qx[j * r.nx + i] * r.dy; return I; }
static double probe(const FEMResult &r, const char *id) { for (auto &p : r.probes) if (p.first == id) return p.second; return NAN; }

int main() {
    // ---------------------------------------------------------------- 1. Ohmic limit
    {
        Instance s = base(4, 2, 120);
        s.contacts = presetContacts("hall_bar");
        s.p.B = 0.5;
        const FEMResult fe = solveFEM(s, s.p);
        s.p.fieldModel = "hydro"; s.p.hydroLeeUm = 1e-5;          // Gurzhi length ~ 1 nm
        const FEMResult hy = solveField(s, s.p);
        std::printf("    ohmic limit: R  FEM %.6g  hydro %.6g Ohm (D = %.3g um)\n", fe.resistance, hy.resistance, hy.DnuUm);
        const double vF = probe(fe, "probe_top") - probe(fe, "probe_bottom"), vH = probe(hy, "probe_top") - probe(hy, "probe_bottom");
        std::printf("                 V_H FEM %.6g  hydro %.6g V\n", vF, vH);
        check(hy.valid && std::abs(hy.resistance / fe.resistance - 1) < 0.03, "Ohmic limit: the hydrodynamic resistance equals the FEM's within 3 %");
        check(std::abs(vH / vF - 1) < 0.05, "Ohmic limit: the Hall voltage equals the FEM's within 5 %, same sign");
    }
    // ---------------------------------------------------------------- 2-3. channel
    const double W = 20, H = 2, lee = 0.2, lmr = 5;                // D = sqrt(lee lmr)/2 = 0.5 um
    auto channel = [&](double slip, double B, bool hallVisc) {
        Instance s = base(W, H, 300);
        s.contacts = {{"source", "source", 0.0, 0.0, 0.02, 1.0}, {"drain", "drain", 0.98, 0.0, 1.0, 1.0}};
        s.p.fieldModel = "hydro"; s.p.hydroLeeUm = lee; s.p.mfpFromMobility = false; s.p.mfpum = lmr;
        s.p.hydroSlipUm = slip; s.p.B = B; s.p.hydroHallVisc = hallVisc;
        return std::make_pair(s, solveField(s, s.p));
    };
    {
        auto [s, r] = channel(0, 0, true);
        check(r.valid && r.converged, "channel: the solve converged");
        const double I1 = colCurrent(r, r.nx / 4), I2 = colCurrent(r, r.nx / 2), I3 = colCurrent(r, 3 * r.nx / 4);
        std::printf("    columns: %.9g %.9g %.9g A, source %.9g A\n", I1, I2, I3, r.current);
        check(std::abs(I1 / I2 - 1) < 1e-6 && std::abs(I3 / I2 - 1) < 1e-6 && std::abs(r.current / I2 - 1) < 1e-6, "current is conserved: the same through every column and out of the source");
        // profile at mid channel against Brinkman
        const double D = r.DnuUm, h = H / 2;
        double emax = 0; const int i = r.nx / 2;
        const double jc = r.qx[(r.ny / 2) * r.nx + i];
        auto prof = [&](double y, double ls) { return 1 - std::cosh(y / D) / (std::cosh(h / D) + ls / D * std::sinh(h / D)); };
        const double norm = prof(((r.ny / 2) + 0.5) * H / r.ny - h, 0);
        for (int j = 0; j < r.ny; ++j) { const double y = (j + 0.5) * H / r.ny - h; emax = std::max(emax, std::abs(r.qx[j * r.nx + i] / jc - prof(y, 0) / norm)); }
        std::printf("    Poiseuille (no-slip, D = %.4f um): worst profile deviation %.4f\n", D, emax);
        check(emax < 0.02, "no-slip channel: the current profile is the Brinkman profile within 2 %");
        // resistivity from the field in the middle and the current per width
        const int ia = r.nx * 2 / 5, ib = r.nx * 3 / 5;
        double Ex = 0; for (int j = 0; j < r.ny; ++j) Ex += (r.u[j * r.nx + ia] - r.u[j * r.nx + ib]) / ((ib - ia) * r.dx); Ex /= r.ny;
        const double rhoEff = Ex / (I2 / (H * 1e-6)), rho = hydroPhys(s.p).rho;
        const double want = 1 / (1 - 2 * D / H * std::tanh(H / (2 * D)));
        std::printf("    rho_eff / rho = %.5f, Brinkman %.5f\n", rhoEff / rho, want);
        check(std::abs(rhoEff / rho / want - 1) < 0.01, "no-slip channel: the resistivity rises by 1/(1 - (2D/W) tanh(W/2D)) within 1 %");
    }
    {
        auto [s, r] = channel(0.3, 0, true);
        const double D = r.DnuUm, h = H / 2; const int i = r.nx / 2;
        auto prof = [&](double y) { return 1 - std::cosh(y / D) / (std::cosh(h / D) + 0.3 / D * std::sinh(h / D)); };
        const double jc = r.qx[(r.ny / 2) * r.nx + i], norm = prof(((r.ny / 2) + 0.5) * H / r.ny - h);
        double emax = 0; for (int j = 0; j < r.ny; ++j) { const double y = (j + 0.5) * H / r.ny - h; emax = std::max(emax, std::abs(r.qx[j * r.nx + i] / jc - prof(y) / norm)); }
        std::printf("    partial slip l_s = 0.3 um: worst profile deviation %.4f\n", emax);
        check(emax < 0.02, "partial-slip channel: the Navier-slip Brinkman profile within 2 %");
    }
    {
        auto [s, r] = channel(-1, 0, true);
        const int i = r.nx / 2; double lo = 1e300, hi = -1e300;
        for (int j = 0; j < r.ny; ++j) { lo = std::min(lo, r.qx[j * r.nx + i]); hi = std::max(hi, r.qx[j * r.nx + i]); }
        const int ia = r.nx * 2 / 5, ib = r.nx * 3 / 5;
        double Ex = 0; for (int j = 0; j < r.ny; ++j) Ex += (r.u[j * r.nx + ia] - r.u[j * r.nx + ib]) / ((ib - ia) * r.dx); Ex /= r.ny;
        const double rhoEff = Ex / (colCurrent(r, i) / (H * 1e-6)), rho = hydroPhys(s.p).rho;
        std::printf("    free slip: profile spread %.2e, rho_eff / rho = %.6f\n", (hi - lo) / hi, rhoEff / rho);
        check((hi - lo) / hi < 1e-3 && std::abs(rhoEff / rho - 1) < 1e-3, "free-slip channel: flat profile and the Ohmic resistivity");
    }
    // ---------------------------------------------------------------- 4. Gurzhi
    {
        double prev = 1e300; bool falling = true; double Rohm = 0;
        { Instance s = base(4, 1, 160); s.contacts = presetContacts("two_terminal"); Rohm = solveFEM(s, s.p).resistance; }
        std::printf("    Gurzhi: R_ohmic = %.3f Ohm;", Rohm);
        bool above = true;
        for (double T : {80.0, 120.0, 180.0, 260.0, 360.0}) {
            Instance s = base(4, 1, 160); s.contacts = presetContacts("two_terminal");
            s.p.mucm = 1e6; s.p.fieldModel = "hydro"; s.p.tempK = T;   // clean: l_mr = 11.6 um
            const FEMResult r = solveField(s, s.p);
            Instance s2 = s; s2.p.fieldModel = "ohmic"; const double R0 = solveFEM(s2, s2.p).resistance;
            std::printf("  T %.0f: R %.3f (Ohmic %.3f)", T, r.resistance, R0);
            falling &= r.resistance < prev; prev = r.resistance; above &= r.resistance > R0;
        }
        std::printf("\n");
        check(falling, "Gurzhi effect: at fixed mobility the resistance falls as the temperature rises");
        check(above, "viscosity only adds resistance: every R is above the Ohmic value");
    }
    // ---------------------------------------------------------------- 5. vicinity
    auto vicinity = [&](double leeUm, double mfp) {
        Instance s = base(10, 2, 250);
        s.contacts = {{"source", "source", 0.30, 0.0, 0.32, 0.06}, {"drain", "drain", 0.0, 0.0, 0.02, 1.0},
                      {"near", "probe", 0.34, 0.0, 0.36, 0.06}, {"far", "probe", 0.97, 0.0, 1.0, 1.0}};
        s.p.fieldModel = "hydro"; s.p.hydroLeeUm = leeUm; s.p.mfpFromMobility = false; s.p.mfpum = mfp;
        const FEMResult r = solveField(s, s.p);
        return (probe(r, "near") - probe(r, "far")) / r.current;
    };
    {
        const double Rv = vicinity(0.1, 20), R0 = vicinity(1e-5, 20);   // D = 0.71 um vs ~2 nm
        std::printf("    vicinity resistance: viscous %.4g Ohm, Ohmic %.4g Ohm\n", Rv, R0);
        check(R0 > 0, "vicinity: the Ohmic limit is positive");
        check(Rv < 0, "vicinity: the viscous regime is negative (Bandurin 2016)");
    }
    // ---------------------------------------------------------------- 6. Hall viscosity
    {
        const double B = 0.05;
        auto [s, r] = channel(0, B, true);
        auto [s0, r0] = channel(0, B, false);
        const HydroPhys hp = hydroPhys(s.p);
        const int i = r.nx / 2; const double h = H / 2, D = std::sqrt(hp.D2) * 1e6, Dh2 = hp.Dh2 * 1e12, dy = H / r.ny;
        // amplitude from the current: I_t = A (2h - 2D tanh(h/D)) in jt units (V/um * um)
        const double It = colCurrent(r, i) * hp.rho / 1.0, A = It / (2 * h - 2 * D * std::tanh(h / D));
        auto j1 = [&](double y) { return -A * std::sinh(y / D) / (D * std::cosh(h / D)); };
        auto J0 = [&](double y) { return A * (y - D * std::sinh(y / D) / std::cosh(h / D)); };  // antiderivative of j
        const double yb = -h + dy / 2, yt = h - dy / 2;
        const double want = -(hp.s * (J0(yt) - J0(yb)) + Dh2 * (j1(yt) - j1(yb)));
        const double got = r.u[(r.ny - 1) * r.nx + i] - r.u[i];
        const double plain = r0.u[(r0.ny - 1) * r0.nx + i] - r0.u[i];
        std::printf("    Hall voltage at B = %.2f T (2 w tau_ee = %.3f): solve %.6g V, analytic %.6g V, without Hall viscosity %.6g V\n",
                    B, 2 * hp.omega * hp.tauee, got, want, plain);
        check(std::abs(got / want - 1) < 0.03, "Hall viscosity: the Hall voltage across the channel matches E_y = s j + Dh^2 j'' within 3 %");
        check(std::abs(got) < std::abs(plain), "Hall viscosity lowers the Hall voltage");
    }
    // ---------------------------------------------------------------- obstacle
    {
        Instance s = base(6, 3, 150);
        s.contacts = {{"source", "source", 0.0, 0.0, 0.03, 1.0}, {"drain", "drain", 0.97, 0.0, 1.0, 1.0}, {"disc", "reflector", 0.4, 0.3, 0.6, 0.7}};
        s.p.fieldModel = "hydro"; s.p.hydroLeeUm = 0.2; s.p.mfpFromMobility = false; s.p.mfpum = 5;
        const FEMResult r = solveField(s, s.p);
        bool finite = r.valid; int solid = 0;
        for (size_t k = 0; k < r.u.size(); ++k) { if (!std::isfinite(r.u[k])) ++solid; else if (!std::isfinite(r.qx[k])) finite = false; }
        std::printf("    disc obstacle: %d solid cells, I = %.6g A\n", solid, r.current);
        check(finite && solid > 100 && std::abs(colCurrent(r, r.nx / 5) / r.current - 1) < 1e-6, "a reflector is a solid obstacle and the flow goes round it, current conserved");
    }
    // ---------------------------------------------------------------- Ohmic current, any contact layout
    // the left-right square measures I through the middle column; the same square turned
    // 90 degrees (source on the bottom, drain on the top) cannot, and takes I from the source
    // faces instead. The two resistances must agree, with and without a field.
    {
        for (double B : {0.0, 0.7}) {
            Instance a = base(2, 2, 80), b = base(2, 2, 80); a.p.B = b.p.B = B;
            a.contacts = {{"source", "source", 0, .2, .05, .8}, {"drain", "drain", .95, .2, 1, .8}};
            b.contacts = {{"source", "source", .2, 0, .8, .05}, {"drain", "drain", .2, .95, .8, 1}};
            // Ra: the mid-column flux the core uses for a left-right device; Rf: the current at
            // the source faces (forced), which the turned square must use. At large Hall angle Rf
            // carries the contact-corner discretisation error (it converges slowly with the grid;
            // test/hallcheck.cpp), which is why the mid-column flux is kept where it applies.
            const double Ra = solveFEM(a, a.p).resistance, Rb = solveFEM(b, b.p).resistance;
            g_faceCurrentForTests = true; const double Rf = solveFEM(a, a.p).resistance; g_faceCurrentForTests = false;
            std::printf("    Ohmic R, square: mid-column %.6g, source faces %.6g, turned 90 deg %.6g Ohm (B = %.1f T)\n", Ra, Rf, Rb, B);
            check(std::abs(Rb / Rf - 1) < 1e-4, B == 0 ? "source-face current: the square turned 90 degrees gives the same R (B = 0)" : "... and in a field (mu B = 3.5): it is the conserved discrete current");
            // the two agree at B = 0 and differ by ~1 % at mu B = 3.5 on this coarse grid
            check(std::abs(Rf / Ra - 1) < (B == 0 ? 1e-4 : 0.02), B == 0 ? "mid-column current equals the source-face current at B = 0" : "mid-column current within 2 % of it at mu B = 3.5");
        }
    }
    // ---------------------------------------------------------------- walls ("wall" = the rectangle)
    {
        auto dev = [&](int kind) {      // 0 open, 1 wall with a slit, 2 full-height wall
            Instance s = base(6, 3, 150);
            s.contacts = {{"source", "source", 0.0, 0.0, 0.03, 1.0}, {"drain", "drain", 0.97, 0.0, 1.0, 1.0}};
            if (kind == 1) { s.contacts.push_back({"w1", "wall", 0.48, 0.0, 0.52, 0.42}); s.contacts.push_back({"w2", "wall", 0.48, 0.58, 0.52, 1.0}); }
            if (kind == 2) s.contacts.push_back({"w", "wall", 0.48, 0.0, 0.52, 1.0});
            return s;
        };
        double R[3], Rh[3], T[3];
        for (int k = 0; k < 3; ++k) {
            Instance s = dev(k);
            R[k] = solveFEM(s, s.p).resistance;
            s.p.fieldModel = "hydro"; s.p.hydroLeeUm = 0.2; s.p.mfpFromMobility = false; s.p.mfpum = 5;
            const FEMResult h = solveField(s, s.p); Rh[k] = h.valid && h.current > 0 ? h.resistance : INFINITY;
            const TrajResult tr = runTrajectoriesSync(s, s.p, true, false, 20000);
            const uint64_t hit = tr.reached[0 * s.contacts.size() + 1];
            T[k] = tr.launchedBy[0] ? static_cast<double>(hit) / tr.launchedBy[0] : 0;
        }
        std::printf("    walls: Ohmic R %.4g / %.4g / %.4g, hydro R %.4g / %.4g / %.4g, ballistic T %.4f / %.4f / %.4f (open / slit / closed)\n",
                    R[0], R[1], R[2], Rh[0], Rh[1], Rh[2], T[0], T[1], T[2]);
        check(R[1] > 1.2 * R[0] && R[2] > 1e4 * R[0], "Ohmic: a wall is insulating, a slit raises the resistance and a closed wall blocks it");
        check(Rh[1] > Rh[0] && !(Rh[2] < 1e4 * Rh[0]), "hydrodynamic: a slit raises the resistance and a closed wall leaves no flow");
        check(T[2] == 0 && T[1] > 0.02 && T[1] < T[0], "ballistic: a closed wall reflects every carrier, a slit lets some through");
    }
    std::printf(fails ? "\n%d CHECK(S) FAILED\n" : "\nALL HYDRO GATES CLEAR\n", fails);
    return fails ? 1 : 0;
}
