// Statistics gates for the trajectory Monte Carlo (added 2026-10-08 after the
// "Prof. Jonnson" researcher test):
//   1. two seeds are independent runs (no shared trajectories), and the check is
//      sensitive: the old seed mixing fails it;
//   2. the reported error bars are honest: the binomial dT for a transmission and the
//      jackknife error for a Buttiker Hall resistance both match the scatter over seeds;
//   3. deep in the diffusive regime the trajectories still reproduce Landauer-Drude
//      (the fixed 240 um path budget used to cut the transmission in half at l = 20 nm).
// Build: g++ -std=c++17 -O2 -fopenmp -static -o statcheck.exe test/statcheck.cpp -Isrc
#include "../src/plugin.cpp"
#include <cstdio>
#include <set>

static int fails = 0;
static void check(bool ok, const char *what) { std::printf("[%s] %s\n", ok ? " OK " : "FAIL", what); if (!ok) ++fails; }
static double kF(double ncm2) { return std::sqrt(M_PI * std::abs(ncm2 * 1e4)); }

int main() {
    // ---- 1. seed independence
    {
        int sharedNew = 0, sharedOld = 0;
        std::set<uint32_t> a, b;
        for (int i = 0; i < 2000; ++i) { a.insert(mixedSeedHashed(7, i)); b.insert(mixedSeed(7, i)); }
        for (int i = 0; i < 2000; ++i) { sharedNew += a.count(mixedSeedHashed(8, i)); sharedOld += b.count(mixedSeed(8, i)); }
        std::printf("   seeds 7 and 8 share %d of 2000 trajectory streams (old mixing: %d)\n", sharedNew, sharedOld);
        check(sharedNew == 0, "seeds 7 and 8 share no trajectories");
        check(sharedOld > 1000, "  ... and the check is sensitive: the old seed mixing fails it");
    }
    // ---- 2a. binomial dT matches the seed scatter of a transmission
    {
        std::vector<double> Ts; double dT = 0;
        for (int sd = 1; sd <= 24; ++sd) {
            Instance s; s.p.Wum = 4; s.p.Hum = 2; s.p.seed = sd;
            s.contacts = {{"source", "source", 0, 0, .04, 1}, {"drain", "drain", .96, 0, 1, 1}};
            TrajResult tr = runTrajectoriesSync(s, s.p, false, false, 2000);
            const double T = double(tr.reached[1]) / tr.launchedBy[0];
            Ts.push_back(T); dT += std::sqrt(T * (1 - T) / tr.launchedBy[0]);
        }
        double m = 0; for (double t : Ts) m += t; m /= Ts.size();
        double v = 0; for (double t : Ts) v += (t - m) * (t - m); v /= Ts.size() - 1;
        dT /= Ts.size();
        std::printf("   transmission over 24 seeds: sd %.5f, reported dT %.5f, ratio %.3f\n", std::sqrt(v), dT, std::sqrt(v) / dT);
        check(std::sqrt(v) / dT > 0.65 && std::sqrt(v) / dT < 1.4, "binomial dT matches the seed-to-seed scatter (ratio 0.65-1.4)");
    }
    // ---- 2b. jackknife error of a Buttiker Hall resistance matches the seed scatter
    {
        std::vector<double> R; double sj = 0;
        for (int sd = 1; sd <= 16; ++sd) {
            Instance s; s.p.Wum = 4; s.p.Hum = 2; s.p.B = 0.5; s.p.seed = sd;
            s.contacts = presetContacts("hall_bar");
            TrajResult tr = runTrajectoriesSync(s, s.p, false, true, 4000);
            const double r = buttikerResistance(s, s.p, tr, "hall");
            const double e = jackknifeSigma(tr, [&](const TrajResult &t) { return buttikerResistance(s, s.p, t, "hall"); });
            R.push_back(r); sj += e;
        }
        double m = 0; for (double r : R) m += r; m /= R.size();
        double v = 0; for (double r : R) v += (r - m) * (r - m); v /= R.size() - 1;
        sj /= R.size();
        std::printf("   Hall Rxy (MC, 0.5 T, N 4000) over 16 seeds: mean %.1f, sd %.2f Ohm, mean jackknife %.2f Ohm, ratio %.3f\n",
                    m, std::sqrt(v), sj, std::sqrt(v) / sj);
        check(std::isfinite(sj) && sj > 0, "multi-terminal resistance carries a jackknife error");
        check(std::sqrt(v) / sj > 0.6 && std::sqrt(v) / sj < 1.6, "the jackknife error matches the seed-to-seed scatter (ratio 0.6-1.6)");
    }
    // ---- 3. deep diffusive two-terminal vs Landauer-Drude
    {
        const double Gq = 4 * E_CHARGE * E_CHARGE / PLANCK;
        for (double l : {0.02, 0.05}) {
            Instance s; s.p.Wum = 4; s.p.Hum = 2;
            s.contacts = {{"source", "source", 0, 0, .04, 1}, {"drain", "drain", .96, 0, 1, 1}};
            s.p.mucm = l * 1e-6 * E_CHARGE / (HBAR * kF(1e12)) * 1e4;
            TrajResult tr = runTrajectoriesSync(s, s.p, false, false, 20000);
            const double G = sourceDrainG(s, s.p, tr);
            const double M = kF(1e12) * 2e-6 / M_PI, Leff = 3.68e-6, lam = M_PI / 2 * l * 1e-6;
            const double Gld = Gq * M * lam / (lam + Leff);
            std::printf("   l = %.2f um: G %.4g S vs Landauer-Drude %.4g S, ratio %.3f, truncated %llu\n", l, G, Gld, G / Gld,
                        (unsigned long long)tr.statuses[MAXSTEPS]);
            char msg[160]; std::snprintf(msg, sizeof msg, "diffusive l = %.2f um: trajectories within 10 %% of Landauer-Drude, nothing truncated", l);
            check(std::abs(G / Gld - 1) < 0.10 && tr.statuses[MAXSTEPS] == 0, msg);
        }
        // and the old fixed budget really did cut it off (the gate can fail)
        Instance s; s.p.Wum = 4; s.p.Hum = 2; s.p.pathAuto = 0;
        s.contacts = {{"source", "source", 0, 0, .04, 1}, {"drain", "drain", .96, 0, 1, 1}};
        s.p.mucm = 0.02 * 1e-6 * E_CHARGE / (HBAR * kF(1e12)) * 1e4;
        TrajResult tr = runTrajectoriesSync(s, s.p, false, false, 8000);
        std::printf("   old 240 um budget at l = 0.02 um: %.1f %% of carriers truncated\n", 100.0 * tr.statuses[MAXSTEPS] / tr.launched);
        check(tr.statuses[MAXSTEPS] > 0, "  ... the old fixed budget truncates carriers there (the check is sensitive)");
    }
    // ---- 4. the FEM only says "converged" when it is (a 4000 um bar used to report
    //         converged at 21x the tolerance with a conductance 4x too large)
    {
        Instance s; s.p.Wum = 4000; s.p.Hum = 2;
        s.contacts = {{"source", "source", 0, 0, .001, 1}, {"drain", "drain", .999, 0, 1, 1}};
        FEMResult f = solveFEM(s, s.p);
        const double sig = s.p.n() * E_CHARGE * s.p.mu();
        const double Gd = sig * 2e-6 / (0.998 * 4000e-6);
        std::printf("   4000 x 2 um bar: G %.4g S vs sigma W/L %.4g S (ratio %.4f), converged %d, direct %d, residual %.2e\n",
                    1 / f.resistance, Gd, (1 / f.resistance) / Gd, f.converged ? 1 : 0, f.direct ? 1 : 0, f.residual);
        check(f.converged && std::abs((1 / f.resistance) / Gd - 1) < 0.03, "a very long bar gives sigma W/L, and 'converged' is honest");
        check(f.residual <= s.p.femTol || f.direct, "  ... the residual really is below the tolerance (or the direct solve took over)");
    }
    std::printf(fails ? "\n%d CHECK(S) FAILED\n" : "\nALL STATISTICS CHECKS CLEAR\n", fails);
    return fails ? 1 : 0;
}
