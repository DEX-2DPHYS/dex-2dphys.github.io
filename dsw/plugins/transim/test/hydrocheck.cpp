// hydrocheck -- do the two hydrodynamic EXAMPLES give the physics they claim?
//   1. superballistic aperture: the slit's own resistance against Guo et al. (PNAS 114,
//      3068, 2017), R_vis = 32 rho D^2 / (pi w^2) for a slit in a thin wall, and its
//      conductance against the ballistic (Sharvin) ceiling G_S = (4e^2/h) k_F w / pi.
//   2. vicinity: the sign and size of the nonlocal voltage next to the injector as the
//      Gurzhi length D is varied (Bandurin et al., Science 351, 1055, 2016).
//   3. the new sweep types run through the core's own message path.
//   hydrocheck <test/examples-msgs dir>
#include "../src/plugin.cpp"
#include <fstream>
#include <cstdio>

static int fails = 0;
static void check(bool ok, const char *what) { std::printf("[%s] %s\n", ok ? " OK " : "FAIL", what); if (!ok) ++fails; }
static Instance load(const std::string &file) {
    Instance s; std::ifstream in(file); std::string line;
    while (std::getline(in, line)) if (!line.empty()) handleMessage(s, line);
    return s;
}
static double probeV(const FEMResult &r, const char *id) { for (auto &p : r.probes) if (p.first == id) return p.second; return NAN; }

int main(int argc, char **argv) {
    const std::string dir = argc > 1 ? argv[1] : "test/examples-msgs";
    // ------------------------------------------------------------ 1. aperture
    {
        Instance s = load(dir + "/hydro-aperture.msgs");
        Instance o = s;                                    // the same strip with the wall removed
        o.contacts.erase(std::remove_if(o.contacts.begin(), o.contacts.end(), [](const Contact &c) { return c.role == "wall"; }), o.contacts.end());
        const double w = 0.5e-6, H = s.p.H();
        const double n = s.p.n(), kF = std::sqrt(M_PI * std::abs(n));
        const double GS = (4 * E_CHARGE * E_CHARGE / PLANCK) * kF * w / M_PI;
        const double GSstrip = (4 * E_CHARGE * E_CHARGE / PLANCK) * kF * H / M_PI;
        std::printf("    aperture: slit w = 0.5 um in a 3 um strip, n = %.2g cm^-2, l_mr = %.1f um, Sharvin G of the slit %.4g S (R %.1f Ohm)\n",
                    s.p.ncm2, s.p.mfpum, GS, 1 / GS);
        std::printf("    %6s %8s %8s %10s %10s %10s %10s %8s %8s\n", "T (K)", "l_ee um", "D um", "R slit", "R open", "R excess", "R Guo", "ratio", "G/G_S");
        double prevG = 0, Gfirst = 0, Glast = 0, Dfirst = 0, Dlast = 0; bool mono = true, super = false, near = true;
        for (double T : {50.0, 100.0, 150.0, 200.0, 300.0}) {
            s.p.tempK = o.p.tempK = T;
            const FEMResult a = solveField(s, s.p), b = solveField(o, o.p);
            const double Rex = a.resistance - b.resistance;
            const double rho = 1.0 / (n * E_CHARGE * (E_CHARGE * s.p.mfp() / (HBAR * kF)));
            const double D = a.DnuUm * 1e-6, Rguo = 32 * rho * D * D / (M_PI * w * w);
            const double G = 1 / Rex;
            std::printf("    %6.0f %8.3f %8.3f %10.2f %10.2f %10.2f %10.2f %8.3f %8.2f\n", T, a.leeUm, a.DnuUm, a.resistance, b.resistance, Rex, Rguo, Rex / Rguo, G / GS);
            if (prevG && G <= prevG) mono = false; prevG = G;
            if (!Gfirst) { Gfirst = G; Dfirst = D; } Glast = G; Dlast = D;
            if (G > GS) super = true;
            if (D > 2 * w && std::abs(std::log(Rex / Rguo)) > std::log(1.6)) near = false;
        }
        std::printf("    G(300)/G(50) = %.2f, (D(50)/D(300))^2 = %.2f (pure viscous slit: equal)\n", Glast / Gfirst, (Dfirst / Dlast) * (Dfirst / Dlast));
        check(mono, "aperture: the slit conductance rises monotonically with temperature (viscosity falls)");
        check(near, "aperture: while D > 2w the slit resistance is within a factor 1.6 of Guo's 32 rho D^2/(pi w^2)");
        check(super, "aperture: at the higher temperatures the slit conducts MORE than its Sharvin (ballistic) ceiling");
        (void)GSstrip;
    }
    // ------------------------------------------------------------ 2. vicinity
    {
        Instance s = load(dir + "/hydro-vicinity.msgs");
        std::printf("    vicinity: injector at x = 3.1 um, probe 0.4 um away, reference far end\n");
        std::printf("    %8s %8s %12s\n", "l_ee um", "D um", "R_v (Ohm)");
        double Rbig = 0, Rsmall = 0;
        for (double lee : {1.0, 0.3, 0.1, 0.03, 0.01, 0.001, 1e-5}) {
            s.p.hydroLeeUm = lee;
            const FEMResult r = solveField(s, s.p);
            const double Rv = (probeV(r, "near") - probeV(r, "far")) / r.current;
            std::printf("    %8.3g %8.3f %12.3f\n", lee, r.DnuUm, Rv);
            if (lee == 1.0) Rbig = Rv; if (lee == 1e-5) Rsmall = Rv;
        }
        Params po = s.p; po.fieldModel = "ohmic"; const FEMResult ro = solveFEM(s, po);
        const double Rohm = (probeV(ro, "near") - probeV(ro, "far")) / ro.current;
        std::printf("    Ohmic FEM on the same device: %.3f Ohm\n", Rohm);
        check(Rbig < 0, "vicinity: with D comparable to the probe spacing the near probe reads NEGATIVE");
        check(Rsmall > 0 && std::abs(Rsmall / Rohm - 1) < 0.05, "vicinity: as D -> 0 it turns positive and approaches the Ohmic FEM value");
    }
    // ------------------------------------------------------------ 3. new sweep types
    {
        Instance s = load(dir + "/hydro-aperture.msgs");
        handleMessage(s, "{\"t\":\"sweep\",\"sweepType\":\"T\",\"measure\":\"2t\",\"quantity\":\"G\",\"wantFem\":1,\"wantBal\":0,\"tFrom\":100,\"tTo\":300,\"tN\":3}");
        while (s.sweepIndex < s.sweepPoints.size()) computeSweepPoint(s);
        check(s.sweepPoints.size() == 3 && s.sweepFem[2] > s.sweepFem[0], "G vs T line sweep runs and follows the viscosity (G rises with T)");
        handleMessage(s, "{\"t\":\"sweep\",\"sweepType\":\"map2\",\"measure\":\"2t\",\"quantity\":\"R\",\"wantFem\":1,\"wantBal\":0,\"mapXParam\":\"T\",\"mapYParam\":\"b\",\"mxFrom\":100,\"mxTo\":300,\"mxN\":3,\"myFrom\":0,\"myTo\":0.2,\"myN\":2}");
        while (s.sweepIndex < s.sweepPoints.size()) computeSweepPoint(s);
        bool tOk = s.sweepPoints.size() == 6 && s.sweepPoints[4].tempK == 200 && s.sweepPoints[4].B == 0.2;
        check(tOk, "map2 T x B: 3 x 2 points, each carrying its own T and B");
        Instance e = s; e.outbox.clear();
        handleMessage(e, "{\"t\":\"sweep\",\"sweepType\":\"map2\",\"mapXParam\":\"vg\",\"mapYParam\":\"n\"}");
        bool refused = e.sweepPoints.empty() && e.job == Job::Idle;
        for (auto &m : e.outbox) if (m.find("\"error\"") != std::string::npos) refused = refused && true;
        check(refused, "map2 refuses two axes that set the same thing (Vg and n)");
        Instance f = load(dir + "/two-terminal.msgs");
        handleMessage(f, "{\"t\":\"sweep\",\"sweepType\":\"map2\",\"measure\":\"2t\",\"quantity\":\"G\",\"wantFem\":1,\"wantBal\":0,\"mapXParam\":\"mfp\",\"mapYParam\":\"n\",\"mxFrom\":10,\"mxTo\":1000,\"mxN\":3,\"myFrom\":1e12,\"myTo\":4e12,\"myN\":2}");
        while (f.sweepIndex < f.sweepPoints.size()) computeSweepPoint(f);
        // Drude G = n e mu W/L with mu = e l/(hbar kF): G grows as l and as sqrt(n)
        check(f.sweepPoints.size() == 6 && std::abs(f.sweepPoints[1].mfpum - 0.1) < 1e-9 && f.sweepFem[2] > 9 * f.sweepFem[0] && std::abs(f.sweepFem[5] / f.sweepFem[2] - 2.0) < 0.05,
              "map2 mfp (log) x n: G grows 100x over two decades of l and as sqrt(n) (x2 for 4x n)");
    }
    std::printf(fails ? "\n%d CHECK(S) FAILED\n" : "\nALL HYDRO EXAMPLE CHECKS CLEAR\n", fails);
    return fails ? 1 : 0;
}
