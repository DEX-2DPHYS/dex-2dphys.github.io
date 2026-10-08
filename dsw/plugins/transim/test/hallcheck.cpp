// hallcheck -- the field model's Hall resistance against R_xy = B/(n e).
// A long bar with thin edge probes must give B/ne to within a percent; the default
// L/W = 2 Hall bar falls short only by the physical shorting of its end contacts.
#include "../src/plugin.cpp"
#include <cstdio>
static int fails = 0;
static void check(bool ok, const char *w) { std::printf("[%s] %s\n", ok ? " OK " : "FAIL", w); if (!ok) ++fails; }
static double hall(double W, double H, int res, double depthFrac, double B, bool old) {
    Instance s; s.p.Wum = W; s.p.Hum = H; s.p.res = res; s.p.B = B; s.p.ncm2 = 1e12; s.p.mucm = 50000;
    s.contacts = {{"source", "source", 0, .1, .04, .9}, {"drain", "drain", .96, .1, 1, .9},
                  {"probe_top", "probe", .4, 1 - depthFrac, .6, 1}, {"probe_bottom", "probe", .4, 0, .6, depthFrac}};
    g_probeAverageForTests = old;
    const FEMResult r = solveFEM(s, s.p);
    g_probeAverageForTests = false;
    double vt = 0, vb = 0; for (auto &p : r.probes) { if (p.first == "probe_top") vt = p.second; if (p.first == "probe_bottom") vb = p.second; }
    return (vt - vb) / r.current / (B / (1e16 * E_CHARGE));
}
int main() {
    std::printf("    R_xy / (B/ne)            old (cell average)   new (reading at the edge)\n");
    struct C { double W, H; int res; double d, B; const char *name; } cs[] = {
        {16, 2, 300, 0.01, 0.5, "L/W 8, res 300, thin probes, 0.5 T"}, {16, 2, 100, 0.06, 0.5, "L/W 8, res 100, default probes"},
        {4, 2, 100, 0.06, 0.5, "default Hall bar (L/W 2), 0.5 T"}, {4, 2, 100, 0.06, 0.05, "default Hall bar, 0.05 T"},
        {4, 2, 200, 0.06, 0.5, "default Hall bar, res 200"}};
    double r[5][2];
    for (int k = 0; k < 5; ++k) { r[k][0] = hall(cs[k].W, cs[k].H, cs[k].res, cs[k].d, cs[k].B, true); r[k][1] = hall(cs[k].W, cs[k].H, cs[k].res, cs[k].d, cs[k].B, false);
        std::printf("    %-38s %8.4f                     %8.4f\n", cs[k].name, r[k][0], r[k][1]); }
    check(std::abs(r[0][1] - 1) < 0.002, "a long bar with thin probes gives B/ne within 0.2 %");
    check(std::abs(r[1][1] - 1) < 0.002, "...and with the default probe depth on a coarse grid within 0.2 %");
    check(std::abs(r[2][1] - r[4][1]) < 0.005, "the default Hall bar's reading no longer depends on the grid (res 100 vs 200 within 0.5 %)");
    check(r[2][1] < 0.99 && r[2][1] > 0.9, "the default L/W = 2 bar keeps its physical contact shorting (a few %)");
    std::printf(fails ? "\n%d CHECK(S) FAILED\n" : "\nALL HALL CHECKS CLEAR\n", fails);
    return fails ? 1 : 0;
}
