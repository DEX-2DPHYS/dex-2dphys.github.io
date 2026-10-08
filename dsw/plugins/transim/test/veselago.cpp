// veselago -- p-n junction gates for transim's stepped tracer (2026-10-06).
//
// Compiles the plugin source into the test so the trajectory density grid can be
// read directly.  Two known results:
//
//  1. Klein tunnelling through an abrupt p-n junction.  With carriers injected
//     uniformly over the transverse modes (uniform in sin th, the Landauer
//     weighting), a symmetric junction transmits <cos^2 th> = 2/3
//     (Cheianov & Fal'ko, PRB 74, 041403, 2006).  An asymmetric one is checked
//     against the abrupt-step formula integrated over the same weighting, and
//     the old "pass" mode must transmit everything.
//
//  2. Veselago lens (Cheianov, Fal'ko & Altshuler, Science 315, 1252, 2007).
//     A point source a distance a in front of a symmetric junction refocuses at
//     a distance a behind it; with k2/k1 = 2 the rays form a caustic whose cusp
//     (paraxial focus) sits at 2a behind the junction.
//
//   g++ -std=c++17 -O2 -fopenmp -static -Isrc test/veselago.cpp -o veselago.exe
#include "../src/plugin.cpp"

#include <cstdio>
#include <string>

static int fails = 0;
static void check(bool ok, const std::string &what) {
    std::printf("%s %s\n", ok ? "[ OK ]" : "[FAIL]", what.c_str());
    if (!ok) ++fails;
}

// A map W x H with n1 left of xJ and n2 right of it (cm^-2).  Returns the x
// (fraction of W) of the zero crossing the bilinear map actually has.
static double stepMap(FieldMap &m, int w, int h, double xJfrac, double n1, double n2) {
    m.w = w; m.h = h; m.v.assign(static_cast<size_t>(w) * h, 0.f);
    int iJ = 0;
    for (int i = 0; i < w; ++i) if (static_cast<double>(i) / (w - 1) < xJfrac) iJ = i;
    for (int j = 0; j < h; ++j) for (int i = 0; i < w; ++i)
        m.v[static_cast<size_t>(j) * w + i] = static_cast<float>(i <= iJ ? n1 : n2);
    // zero of the linear ramp between pixel iJ (n1) and iJ+1 (n2)
    const double f = n1 / (n1 - n2);
    return (iJ + f) / (w - 1);
}

static Params baseParams(double Wum, double Hum, const std::string &edge, const std::string &pn) {
    Params p;
    p.Wum = Wum; p.Hum = Hum; p.ncm2 = 1e12; p.B = 0;
    p.edge = edge; p.tracer = "step"; p.refract = false; p.pnMode = pn;
    p.maxPathUm = 1000; p.seed = 11;
    return p;
}

// -------------------------------------------------------------- 1. Klein T
static double kleinT(double n1, double n2, const std::string &pn, int N) {
    Instance s;
    s.p = baseParams(4, 2, "specular", pn);
    stepMap(s.densityMap, 256, 16, 0.5, n1, n2);
    s.contacts = {{"source", "source", 0.0, 0.0, 0.004, 1.0}, {"drain", "drain", 0.996, 0.0, 1.0, 1.0}};
    const TrajResult tr = runTrajectoriesSync(s, s.p, true, false, N);
    return static_cast<double>(tr.reached[1]) / tr.launchedBy[0];
}

// the abrupt-step formula averaged uniformly over s = sin th1 in (-1, 1)
static double kleinExpected(double n1, double n2) {
    const double r = std::sqrt(std::abs(n1) / std::abs(n2));
    const int K = 200000; double sum = 0;
    for (int k = 0; k < K; ++k) {
        const double sn = -1 + (k + 0.5) * 2.0 / K, sr = r * sn;
        if (std::abs(sr) >= 1) continue;
        const double t1 = std::asin(sn), t2 = -std::asin(sr), ch = std::cos(0.5 * (t1 + t2));
        sum += std::cos(t1) * std::cos(t2) / (ch * ch);
    }
    return sum / K;
}

// -------------------------------------------------------------- 2. Veselago
struct Lens { std::vector<double> xum, frac; double xJum = 0; };

static Lens lens(double n1, double n2, const std::string &pn, int N) {
    Instance s;
    const double W = 6, H = 4, a = 1.5;
    s.p = baseParams(W, H, "absorbing", pn);
    const double xJ = stepMap(s.densityMap, 256, 16, a / W, n1, n2);
    // a point source: 40 nm of the left edge, centred
    s.contacts = {{"source", "source", 0.0, 0.495, 0.002, 0.505}, {"drain", "drain", 0.998, 0.0, 1.0, 1.0}};
    const TrajResult tr = runTrajectoriesSync(s, s.p, true, false, N);
    Lens L; L.xJum = xJ * W;
    const int gx = tr.gx, gy = tr.gy, yc = gy / 2;
    for (int ix = 0; ix < gx; ++ix) {
        double tot = 0, mid = 0;
        for (int iy = 0; iy < gy; ++iy) {
            const double v = static_cast<double>(tr.density[static_cast<size_t>(iy) * gx + ix]);
            tot += v; if (std::abs(iy - yc) <= 1) mid += v;
        }
        L.xum.push_back((ix + 0.5) / gx * W);
        L.frac.push_back(tot > 0 ? mid / tot : 0);
    }
    return L;
}

// where, behind the junction, the beam is most concentrated on the axis
static void peakBehind(const Lens &L, double &xPeak, double &fPeak) {
    xPeak = 0; fPeak = -1;
    for (size_t i = 0; i < L.xum.size(); ++i)
        if (L.xum[i] > L.xJum + 0.2 && L.xum[i] < 5.85 && L.frac[i] > fPeak) { fPeak = L.frac[i]; xPeak = L.xum[i]; }
}

static double fracAt(const Lens &L, double x) {
    size_t best = 0;
    for (size_t i = 0; i < L.xum.size(); ++i) if (std::abs(L.xum[i] - x) < std::abs(L.xum[best] - x)) best = i;
    return L.frac[best];
}

// --paths <file>: the first trajectories of each lens, for a picture
static void dumpPaths(const char *file) {
    FILE *f = std::fopen(file, "w");
    if (!f) return;
    const struct { const char *name; double n1, n2; } cases[] = {{"sym", 1e12, -1e12}, {"asym", 1e12, -4e12}, {"pass", 1e12, -1e12}};
    for (const auto &c : cases) {
        Instance s;
        s.p = baseParams(6, 4, "absorbing", std::string(c.name) == "pass" ? "pass" : "klein");
        s.p.scattering = "none"; // ballistic, as runTrajectoriesSync(..., true, ...) runs it
        stepMap(s.densityMap, 256, 16, 1.5 / 6, c.n1, c.n2);
        s.contacts = {{"source", "source", 0.0, 0.495, 0.002, 0.505}, {"drain", "drain", 0.998, 0.0, 1.0, 1.0}};
        const int keep = 400;
        initTrajectories(s, s.p, true, false, keep, keep);
        simulateRange(s, s.p, 0, keep);
        for (int i = 0; i < keep; ++i) {
            std::fprintf(f, "%s,%d", c.name, s.traj.paths[i].status);
            for (const Point &q : s.traj.paths[i].points) std::fprintf(f, ",%.5f,%.5f", q.x, q.y);
            std::fprintf(f, "\n");
        }
    }
    std::fclose(f);
}

int main(int argc, char **argv) {
    if (argc > 2 && std::string(argv[1]) == "--paths") { dumpPaths(argv[2]); return 0; }
    const bool dump = argc > 1 && std::string(argv[1]) == "--dump";

    std::printf("--- 1. Klein tunnelling through an abrupt p-n junction\n");
    const int NT = 200000;
    {
        const double T = kleinT(2e12, -2e12, "klein", NT);
        std::printf("    symmetric n|p (+2e12 | -2e12): T = %.4f   (theory 2/3 = 0.6667)\n", T);
        check(std::abs(T - 2.0 / 3.0) < 0.006, "symmetric junction transmits 2/3 of the modes");
    }
    {
        const double T = kleinT(2e12, -0.5e12, "klein", NT), E = kleinExpected(2e12, -0.5e12);
        std::printf("    asymmetric (+2e12 | -0.5e12, k1/k2 = 2): T = %.4f   (formula %.4f)\n", T, E);
        check(std::abs(T - E) < 0.006, "asymmetric junction follows the abrupt-step formula (critical angle 30 deg)");
    }
    {
        const double T = kleinT(2e12, -2e12, "pass", NT);
        std::printf("    pass mode: T = %.4f\n", T);
        check(T > 0.999, "the old pass-through mode transmits everything");
    }
    {
        const double T = kleinT(2e12, 0.5e12, "klein", NT);
        std::printf("    same sign (+2e12 | +0.5e12), no junction: T = %.4f\n", T);
        check(T > 0.999, "a map that never changes sign is not treated as a junction");
    }

    std::printf("--- 1b. Smooth junctions (Cayssol, Huard & Goldhaber-Gordon, PRB 79, 075428, Eq. 10)\n");
    {
        // independent evaluation of Eq. 10 for a symmetric junction, averaged uniformly over sin th
        auto eq10 = [](double kF, double d, double s) {
            const double ky = kF * s, X = std::sqrt(std::max(0.0, kF * kF - ky * ky));
            const double K1 = kF, K2 = -kF, X1 = X, X2 = -X;          // incoming n, outgoing p
            const double pm = K2 - K1 + X2 - X1, mp = K2 - K1 - X2 + X1, pp = K2 - K1 + X2 + X1, mm = K2 - K1 - X2 - X1;
            const double a = M_PI * d;
            if (std::abs(a * mp) < 1e-300 || std::abs(a * pm) < 1e-300) return 1.0;
            const double R = std::sinh(a * pm) * std::sinh(a * mp) / (std::sinh(a * pp) * std::sinh(a * mm));
            return 1 - R;
        };
        const double kF = std::sqrt(M_PI * 2e16); // 2e12 cm^-2
        auto avg = [&](double d, bool largeD) {
            const int K = 200000; double sum = 0;
            for (int k = 0; k < K; ++k) {
                const double s = -1 + (k + 0.5) * 2.0 / K;
                sum += largeD ? std::exp(-4 * M_PI * kF * d * (1 - std::sqrt(1 - s * s))) : eq10(kF, d, s);
            }
            return sum / K;
        };
        auto kleinTw = [&](double wNm) {
            Instance s;
            s.p = baseParams(4, 2, "specular", "klein"); s.p.pnWidthNm = wNm;
            stepMap(s.densityMap, 256, 16, 0.5, 2e12, -2e12);
            s.contacts = {{"source", "source", 0.0, 0.0, 0.004, 1.0}, {"drain", "drain", 0.996, 0.0, 1.0, 1.0}};
            const TrajResult tr = runTrajectoriesSync(s, s.p, true, false, NT);
            return static_cast<double>(tr.reached[1]) / tr.launchedBy[0];
        };
        const double T001 = kleinTw(0.01), T10 = kleinTw(10), E10 = avg(10e-9, false), T40 = kleinTw(40), E40 = avg(40e-9, false), C40 = avg(40e-9, true);
        std::printf("    d = 0.01 nm: T = %.4f (abrupt limit 2/3)\n", T001);
        std::printf("    d = 10 nm:   T = %.4f (Eq. 10: %.4f)\n", T10, E10);
        std::printf("    d = 40 nm:   T = %.4f (Eq. 10: %.4f; its smooth limit exp(-4 pi kF d (1 - cos th)): %.4f)\n", T40, E40, C40);
        check(std::abs(T001 - 2.0 / 3.0) < 0.006, "a vanishing width reproduces the abrupt junction");
        check(std::abs(T10 - E10) < 0.006 && std::abs(T40 - E40) < 0.006, "finite widths follow Cayssol Eq. 10");
        check(std::abs(E40 - C40) < 0.01, "and at kF d >> 1 Eq. 10 is the smooth-junction (Cheianov-Fal'ko) limit");
    }

    std::printf("--- 2. Veselago lens: point source 1.5 um in front of the junction\n");
    const int NV = 400000;
    Lens sym = lens(1e12, -1e12, "klein", NV), pass = lens(1e12, -1e12, "pass", NV), asym = lens(1e12, -4e12, "klein", NV);
    double xs, fs, xp, fp, xa, fa;
    peakBehind(sym, xs, fs); peakBehind(pass, xp, fp); peakBehind(asym, xa, fa);
    const double a = sym.xJum, focus = 2 * sym.xJum;
    std::printf("    junction at x = %.3f um; mirror image expected at x = %.3f um\n", a, focus);
    std::printf("    symmetric  n|p : on-axis fraction peaks %.3f at x = %.3f um (just behind the junction %.3f)\n", fs, xs, fracAt(sym, a + 0.3));
    std::printf("    pass-through   : on-axis fraction peaks %.3f at x = %.3f um, %.3f at the image\n", fp, xp, fracAt(pass, focus));
    std::printf("    k2/k1 = 2      : on-axis fraction peaks %.3f at x = %.3f um (paraxial cusp at %.3f)\n", fa, xa, a + 2 * a);
    const double dx = sym.xum[1] - sym.xum[0];
    check(std::abs(xs - focus) <= 1.5 * dx, "the symmetric junction refocuses the point source at the mirror distance");
    check(fs > 0.5 && fs > 5 * fracAt(sym, a + 0.3), "the focus is sharp: most of the flux crosses the axis within +-1 cell");
    check(fracAt(pass, focus) < 0.2 * fs, "without Klein refraction nothing focuses there");
    // k2/k1 = 2 against independent geometric optics: a point source, rays uniform
    // in sin th1 out to the absorbing walls, Snell with negative refraction, each
    // ray weighted by its Klein T and by its path length per column (1/cos th2),
    // and the same +-1.5-cell on-axis window the grid uses.
    {
        const double W = 6, H = 4; const int gy = asym.frac.empty() ? 0 : static_cast<int>(std::lround(160 * H / W));
        const double dy = H / gy, lo = (gy / 2 - 1) * dy - H / 2, hi = (gy / 2 + 2) * dy - H / 2;
        double worst = 0, xw = 0;
        for (size_t i = 0; i < asym.xum.size(); ++i) {
            const double x = asym.xum[i];
            if (x < a + 0.3 || x > 5.8) continue;
            double mid = 0, tot = 0;
            // the source is the contact's 40 nm, not a mathematical point
            for (int q = 0; q < 16; ++q)
            for (int k = 0; k < 4000; ++k) {
                const double y0 = (-0.005 + (q + 0.5) / 16 * 0.01) * H;
                const double s = -1 + (k + 0.5) * 2.0 / 4000, t1 = std::asin(s), yJ = y0 + a * std::tan(t1);
                if (std::abs(yJ) > H / 2) continue;
                const double t2 = -std::asin(0.5 * s), ch = std::cos(0.5 * (t1 + t2));
                const double T = std::cos(t1) * std::cos(t2) / (ch * ch), y = yJ + (x - a) * std::tan(t2);
                if (std::abs(y) > H / 2) continue;
                const double w = T / std::cos(t2); tot += w; if (y >= lo && y < hi) mid += w;
            }
            const double d = std::abs(asym.frac[i] - (tot > 0 ? mid / tot : 0));
            if (d > worst) { worst = d; xw = x; }
        }
        std::printf("    k2/k1 = 2 vs independent ray optics: worst on-axis difference %.3f (at x = %.2f um)\n", worst, xw);
        check(worst < 0.10, "the k2/k1 = 2 caustic matches independent geometric optics behind the junction");
        check(xa > a + 2 * a, "and its on-axis maximum lies beyond the paraxial cusp at 2a, as a caustic's does");
    }

    if (dump) {
        std::printf("x_um,sym,pass,asym\n");
        for (size_t i = 0; i < sym.xum.size(); ++i)
            std::printf("%.4f,%.5f,%.5f,%.5f\n", sym.xum[i], sym.frac[i], pass.frac[i], asym.frac[i]);
    }
    std::printf(fails ? "%d CHECK(S) FAILED\n" : "ALL CLEAR\n", fails);
    return fails ? 1 : 0;
}
