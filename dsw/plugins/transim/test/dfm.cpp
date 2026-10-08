// dfm -- the Dirac fermion microscope of Boggild et al., Nat. Commun. 8, 15783
// (2017), run on transim's stepped tracer: Fig. 3c (pinhole + parabolic p-n lens,
// a reflecting disc scanned by the magnetic field) and Fig. 4 (the same gun aimed
// at a Veselago dot, a circular p-n junction, for a sharp and a smooth junction).
//
//   dfm [out.json]        runs everything, prints the checks, writes the data
//
// Geometry, after the paper's Methods: a 4 x 2 um sample, |n| = 1e12 cm^-2 on both
// sides of every junction, beam along +x.  The emitter is a 20 nm contact at the
// focus of a parabolic p-n junction (focal length 0.5 um) inside a grounded
// aperture (two absorbing jaws 80 nm apart, 0.25 um long).  Electrodes: 2 = the
// back edge, 3 = the top edge and 4 = the bottom edge (both from x = 1.8 um);
// every other edge absorbs.
#include "../src/plugin.cpp"

#include <cstdio>
#include <string>

static int fails = 0;
static void check(bool ok, const std::string &what) {
    std::printf("%s %s\n", ok ? "[ OK ]" : "[FAIL]", what.c_str());
    if (!ok) ++fails;
}

static const double W = 4, H = 2, YC = 1.0, XF = 0.01, FPAR = 0.5, N0 = 1e12, RAMP = 0.02; // um, cm^-2

// signed density: the p-type gun cap behind the parabola, n-type elsewhere,
// optionally a p-type dot.  A tanh of the signed distance, so the bilinear
// map puts the n = 0 contour exactly on the curve.
static double density(double x, double y, double dotX, double dotR) {
    const double dy = y - YC, xp = XF + FPAR - dy * dy / (4 * FPAR);
    const double gPar = (xp - x) / std::sqrt(1 + (dy / (2 * FPAR)) * (dy / (2 * FPAR)));
    double n = -N0 * std::tanh(gPar / RAMP);
    if (dotR > 0) {
        const double gDot = dotR - std::hypot(x - dotX, dy);
        n = std::min(n, -N0 * std::tanh(gDot / RAMP));
    }
    return n;
}

static void buildMap(FieldMap &m, double dotX, double dotR) {
    m.w = 256; m.h = 256; m.v.assign(256 * 256, 0.f);
    for (int j = 0; j < 256; ++j) for (int i = 0; i < 256; ++i) {
        const double x = static_cast<double>(i) / 255 * W, y = (1 - static_cast<double>(j) / 255) * H;
        m.v[static_cast<size_t>(j) * 256 + i] = static_cast<float>(density(x, y, dotX, dotR));
    }
}

static std::vector<Contact> contacts(bool disc, double discX, double discR) {
    const double a = 0.04, t = 0.03, L = 0.25; // aperture half-opening, jaw thickness, length (um)
    std::vector<Contact> c = {
        {"source", "source", 0.0, (YC - 0.01) / H, 0.005, (YC + 0.01) / H},
        {"back", "drain", 0.995, 0.0, 1.0, 1.0},
        {"top", "drain", 0.45, 0.99, 0.99, 1.0},
        {"bottom", "drain", 0.45, 0.0, 0.99, 0.01},
        {"jawTop", "absorber", 0.0, (YC + a) / H, L / W, (YC + a + t) / H},
        {"jawBottom", "absorber", 0.0, (YC - a - t) / H, L / W, (YC - a) / H},
    };
    if (disc) c.push_back({"disc", "reflector", (discX - discR) / W, (YC - discR) / H, (discX + discR) / W, (YC + discR) / H});
    return c;
}

struct Run { double B; double T2, T3, T4; std::vector<uint64_t> dens; int gx, gy; };

static Run runOne(Instance &s, double B, int N) {
    Params p = s.p; p.B = B;
    const TrajResult tr = runTrajectoriesSync(s, p, false, false, N);
    const size_t nc = s.contacts.size();
    auto T = [&](int j) { return static_cast<double>(tr.reached[0 * nc + j]) / tr.launchedBy[0]; };
    return {B, T(1), T(2), T(3), tr.density, tr.gx, tr.gy};
}

static Instance makeDevice(const std::string &scat, double mfpUm, double pnWidth, bool disc, double dotR) {
    Instance s;
    Params &p = s.p;
    p.Wum = W; p.Hum = H; p.ncm2 = N0; p.edge = "absorbing"; p.tracer = "step"; p.refract = false;
    p.pnMode = "klein"; p.pnWidthNm = pnWidth; p.maxPathUm = 200; p.seed = 3;
    p.scattering = scat; p.fwdSigmaDeg = 2; p.mfpFromMobility = false; p.mfpum = mfpUm;
    buildMap(s.densityMap, 3.0, dotR);
    s.contacts = contacts(disc, 3.3, 0.1);
    return s;
}

// transverse beam profile in the column nearest x (um): centroid and FWHM (um)
static void profile(const Run &r, double x, double &yc, double &fwhm) {
    const int ix = std::min(r.gx - 1, static_cast<int>(x / W * r.gx));
    std::vector<double> c(r.gy);
    double tot = 0, m1 = 0, mx = 0;
    for (int iy = 0; iy < r.gy; ++iy) { c[iy] = static_cast<double>(r.dens[static_cast<size_t>(iy) * r.gx + ix]); tot += c[iy]; m1 += c[iy] * (iy + 0.5); mx = std::max(mx, c[iy]); }
    yc = tot > 0 ? m1 / tot / r.gy * H : 0;
    int lo = r.gy, hi = -1;
    for (int iy = 0; iy < r.gy; ++iy) if (c[iy] >= 0.5 * mx) { lo = std::min(lo, iy); hi = std::max(hi, iy); }
    fwhm = hi >= lo ? (hi - lo + 1) * H / r.gy : 0;
}

static void writeRuns(FILE *f, const char *name, const std::vector<Run> &runs, const std::vector<double> &keepB) {
    std::fprintf(f, "\"%s\":{\"B\":[", name);
    for (size_t i = 0; i < runs.size(); ++i) std::fprintf(f, "%s%.6g", i ? "," : "", runs[i].B);
    std::fprintf(f, "],\"T2\":[");
    for (size_t i = 0; i < runs.size(); ++i) std::fprintf(f, "%s%.5f", i ? "," : "", runs[i].T2);
    std::fprintf(f, "],\"T3\":[");
    for (size_t i = 0; i < runs.size(); ++i) std::fprintf(f, "%s%.5f", i ? "," : "", runs[i].T3);
    std::fprintf(f, "],\"T4\":[");
    for (size_t i = 0; i < runs.size(); ++i) std::fprintf(f, "%s%.5f", i ? "," : "", runs[i].T4);
    std::fprintf(f, "],\"maps\":[");
    bool first = true;
    for (const Run &r : runs) {
        bool keep = false; for (double b : keepB) if (std::abs(r.B - b) < 1e-9) keep = true;
        if (!keep) continue;
        std::fprintf(f, "%s{\"B\":%.6g,\"gx\":%d,\"gy\":%d,\"d\":[", first ? "" : ",", r.B, r.gx, r.gy);
        for (size_t k = 0; k < r.dens.size(); ++k) std::fprintf(f, "%s%llu", k ? "," : "", static_cast<unsigned long long>(r.dens[k]));
        std::fprintf(f, "]}");
        first = false;
    }
    std::fprintf(f, "]}");
}

// the picture at one field: a finer density grid (11.1 nm) and more trajectories
static Run runHi(Instance &s, double B, int N) {
    Instance t;
    t.p = s.p; t.p.B = B; t.contacts = s.contacts; t.densityMap = s.densityMap;
    initTrajectories(t, t.p, false, false, N, 0);
    t.traj.gx = 360; t.traj.gy = 180; t.traj.density.assign(360 * 180, 0); // cell = the tracer step (H/180), no sampling beat
    simulateRange(t, t.p, 0, N);
    const size_t nc = t.contacts.size();
    auto T = [&](int j) { return static_cast<double>(t.traj.reached[0 * nc + j]) / t.traj.launchedBy[0]; };
    return {B, T(1), T(2), T(3), t.traj.density, t.traj.gx, t.traj.gy};
}

static std::vector<Run> sweep(Instance &s, double bMaxT, int nB, int N, std::vector<double> extra = {}) {
    std::vector<double> Bs;
    for (int i = 0; i < nB; ++i) Bs.push_back(-bMaxT + 2 * bMaxT * i / (nB - 1));
    for (double b : extra) Bs.push_back(b);
    std::sort(Bs.begin(), Bs.end());
    std::vector<Run> out;
    for (double b : Bs) out.push_back(runOne(s, b, N));
    return out;
}

// pictures for the figures: replace the density of the chosen fields by a fine one
static void addPictures(Instance &s, std::vector<Run> &r, const std::vector<double> &Bs) {
    for (double b : Bs) {
        const Run hi = runHi(s, b, 300000);
        bool done = false;
        for (Run &q : r) if (std::abs(q.B - b) < 1e-9) { q.dens = hi.dens; q.gx = hi.gx; q.gy = hi.gy; done = true; }
        if (!done) r.push_back(hi);
    }
}

static double at(const std::vector<Run> &r, double B, double Run::*f) {
    size_t best = 0; for (size_t i = 0; i < r.size(); ++i) if (std::abs(r[i].B - B) < std::abs(r[best].B - B)) best = i;
    return r[best].*f;
}

int main(int argc, char **argv) {
    const char *out = argc > 1 ? argv[1] : "dfm.json";
    const int N = 40000;
    std::printf("--- Fig. 3c: pinhole + parabolic lens, reflecting disc (d = 200 nm) at x = 3.3 um\n");

    // the gun alone, to measure collimation and deflection
    Instance gun = makeDevice("none", 1000, 0, false, 0);
    std::vector<Run> g = sweep(gun, 0.012, 13, N);
    double y15, w15, y30, w30;
    const Run &g0 = g[6];
    profile(g0, 1.5, y15, w15); profile(g0, 3.0, y30, w30);
    std::printf("    collimated beam at B = 0: FWHM %.0f nm at x = 1.5 um, %.0f nm at x = 3.0 um (centre %.3f / %.3f um)\n", w15 * 1e3, w30 * 1e3, y15, y30);
    check(w30 < 0.25 && w30 < 1.4 * w15 + 0.03, "the parabolic lens collimates: the beam keeps its width from 1.5 to 3 um");
    // beam position at x = 3.0 vs B: linear
    double sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0; int n = 0;
    std::vector<std::pair<double, double>> pos;
    for (const Run &r : g) { double yc, fw; profile(r, 3.3, yc, fw); pos.push_back({r.B, yc - YC}); sx += r.B; sy += yc - YC; sxx += r.B * r.B; sxy += r.B * (yc - YC); syy += (yc - YC) * (yc - YC); ++n; }
    const double slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), r2 = std::pow(n * sxy - sx * sy, 2) / ((n * sxx - sx * sx) * (n * syy - sy * sy));
    std::printf("    beam position at the disc (x = 3.3 um): %.1f nm per mT, linearity R^2 = %.5f\n", slope, r2);
    check(r2 > 0.995, "the beam position is linear in B (the paper's Supplementary Fig. 1)");

    std::vector<Run> clean, mild, strong;
    {
        Instance a = makeDevice("none", 1000, 0, true, 0);
        clean = sweep(a, 0.012, 97, N, {0.0035});
        Instance b = makeDevice("gaussian", 5000, 0, true, 0);
        mild = sweep(b, 0.012, 97, N, {0.0035});
        Instance c = makeDevice("gaussian", 1000, 0, true, 0);
        strong = sweep(c, 0.012, 97, N, {0.0035});
    }
    // dip in T2 (beam shadowed by the disc) and its width in beam position
    auto dipStats = [&](const std::vector<Run> &r, double &depth, double &wPos, double &bCentre) {
        double base = 0; int nb = 0; for (const Run &q : r) if (std::abs(q.B) > 0.009) { base += q.T2; ++nb; }
        base /= std::max(1, nb);
        double mn = 1; for (const Run &q : r) mn = std::min(mn, q.T2);
        depth = base > 0 ? 1 - mn / base : 0;
        const double half = 0.5 * (base + mn);
        double lo = 1, hi = -1, wsum = 0, bw = 0;
        for (const Run &q : r) if (q.T2 < half) { lo = std::min(lo, q.B); hi = std::max(hi, q.B); wsum += half - q.T2; bw += (half - q.T2) * q.B; }
        wPos = hi >= lo ? (hi - lo) * slope : 0; bCentre = wsum > 0 ? bw / wsum : 0;
    };
    double dc, wc, bc, dm, wm, bm, ds, ws, bs;
    dipStats(clean, dc, wc, bc); dipStats(mild, dm, wm, bm); dipStats(strong, ds, ws, bs);
    std::printf("    T12 dip (beam blocked by the disc): depth %.2f / %.2f / %.2f, width %.0f / %.0f / %.0f nm of beam travel  (clean / l = 5 mm / l = 1 mm, 2-degree kicks)\n", dc, dm, ds, wc * 1e3, wm * 1e3, ws * 1e3);
    check(std::abs(bc) < 0.0008, "the disc sits on the axis: the T12 dip is centred on B = 0");
    check(dc > 0.8, "clean: the disc blocks the focused beam almost completely");
    check(wc > 0.14 && wc < 0.26, "clean: the half-depth width of the dip is the disc diameter (0.2 um) scanned by a narrower beam");
    check(dm < dc && ds < dm, "small-angle scattering blurs the image: the dip gets shallower as the scattering grows");
    // mirror symmetry: T13(B) = T14(-B)
    double asym = 0, peak3 = 0, peak4 = 0, b3 = 0, b4 = 0;
    for (const Run &q : clean) {
        asym = std::max(asym, std::abs(q.T3 - at(clean, -q.B, &Run::T4)));
        if (q.T3 > peak3) { peak3 = q.T3; b3 = q.B; }
        if (q.T4 > peak4) { peak4 = q.T4; b4 = q.B; }
    }
    std::printf("    side electrodes: T13 peaks %.3f at %.1f mT, T14 peaks %.3f at %.1f mT; worst |T13(B) - T14(-B)| = %.3f\n", peak3, b3 * 1e3, peak4, b4 * 1e3, asym);
    check(peak3 > 0.05 && peak4 > 0.05 && b3 * b4 < 0, "backscatter from either flank of the disc goes to opposite side electrodes");
    check(asym < 0.03, "mirror symmetry of the device: T13(B) = T14(-B) within the Monte Carlo noise");

    std::printf("--- Fig. 4: the same gun aimed at a Veselago dot (p, radius 0.25 um, at x = 3.0 um)\n");
    std::vector<Run> vd25, vd40;
    {
        Instance a = makeDevice("none", 1000, 2.5, false, 0.25);
        vd25 = sweep(a, 0.010, 81, N, {0.002, 0.008});
        Instance b = makeDevice("none", 1000, 40, false, 0.25);
        vd40 = sweep(b, 0.010, 81, N, {0.002, 0.008});
    }
    auto insideDot = [&](const std::vector<Run> &r, double B) {
        size_t best = 0; for (size_t i = 0; i < r.size(); ++i) if (std::abs(r[i].B - B) < std::abs(r[best].B - B)) best = i;
        const Run &q = r[best]; double in = 0, all = 0;
        for (int iy = 0; iy < q.gy; ++iy) for (int ix = 0; ix < q.gx; ++ix) {
            const double x = (ix + 0.5) / q.gx * W, y = (iy + 0.5) / q.gy * H, v = static_cast<double>(q.dens[static_cast<size_t>(iy) * q.gx + ix]);
            all += v; if (std::hypot(x - 3.0, y - YC) < 0.25) in += v;
        }
        return in / all;
    };
    const double t0_25 = at(vd25, 0, &Run::T2), t0_40 = at(vd40, 0, &Run::T2);
    std::printf("    B = 0, beam through the dot's centre: T12 = %.3f (w = 2.5 nm), %.3f (w = 40 nm); without a dot %.3f\n", t0_25, t0_40, at(g, 0, &Run::T2));
    const auto fwd = [&](const std::vector<Run> &r) { return at(r, 0, &Run::T2) + at(r, 0, &Run::T3) + at(r, 0, &Run::T4); };
    std::printf("    reaching a forward electrode (2 + 3 + 4): %.3f (w = 2.5 nm), %.3f (w = 40 nm), %.3f without a dot\n", fwd(vd25), fwd(vd40), fwd(g));
    check(fwd(vd25) > 0.75 * fwd(g), "a sharp dot is nearly transparent to the beam (Klein tunnelling); it spreads it, it does not stop it");
    check(fwd(vd40) < 0.6 * fwd(vd25), "a smooth dot (w = 40 nm) reflects the oblique part of the beam");
    const double f25_8 = insideDot(vd25, 0.008), f40_8 = insideDot(vd40, 0.008), f25_2 = insideDot(vd25, 0.002), f40_2 = insideDot(vd40, 0.002);
    std::printf("    share of the trajectory density inside the dot: 2 mT %.3f / %.3f, 8 mT %.3f / %.3f (w = 2.5 / 40 nm)\n", f25_2, f40_2, f25_8, f40_8);
    check(f25_8 > 3 * f40_8, "8 mT, glancing incidence: the sharp dot traps carriers in bound orbits, the smooth one reflects them");
    double j25 = 0, j40 = 0;
    for (const Run &q : vd25) j25 = std::max(j25, std::abs(q.B) > 0.0005 ? q.T3 + q.T4 : 0.0);
    for (const Run &q : vd40) j40 = std::max(j40, std::abs(q.B) > 0.0005 ? q.T3 + q.T4 : 0.0);

    {   // fine pictures at the fields shown in the figures
        Instance a = makeDevice("none", 1000, 0, true, 0);      addPictures(a, clean, {0.0, 0.0035});
        Instance b = makeDevice("gaussian", 5000, 0, true, 0);  addPictures(b, mild, {0.0, 0.0035});
        Instance c = makeDevice("gaussian", 1000, 0, true, 0);  addPictures(c, strong, {0.0, 0.0035});
        Instance d = makeDevice("none", 1000, 2.5, false, 0.25); addPictures(d, vd25, {0.0, 0.002, 0.008});
        Instance e = makeDevice("none", 1000, 40, false, 0.25);  addPictures(e, vd40, {0.0, 0.002, 0.008});
    }
    FILE *f = std::fopen(out, "w");
    if (f) {
        std::fprintf(f, "{\"W\":%g,\"H\":%g,\"slope_um_per_T\":%g,", W, H, slope);
        writeRuns(f, "clean", clean, {0.0, 0.0035}); std::fprintf(f, ",");
        writeRuns(f, "mild", mild, {0.0, 0.0035}); std::fprintf(f, ",");
        writeRuns(f, "strong", strong, {0.0, 0.0035}); std::fprintf(f, ",");
        writeRuns(f, "vd25", vd25, {0.0, 0.002, 0.008}); std::fprintf(f, ",");
        writeRuns(f, "vd40", vd40, {0.0, 0.002, 0.008});
        std::fprintf(f, "}\n");
        std::fclose(f);
    }
    std::printf(fails ? "%d CHECK(S) FAILED\n" : "ALL CLEAR\n", fails);
    return fails ? 1 : 0;
}
