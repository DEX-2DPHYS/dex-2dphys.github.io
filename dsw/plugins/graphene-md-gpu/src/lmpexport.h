// lmpexport.h — generate a self-contained, runnable LAMMPS input deck from
// the current state of a graphene-md simulation ("continue from now" mode).
//
// The exporter is deliberately a pure function of a plain Deck struct: the
// plugin fills the struct (engine-specific: classic arrays, or gathered from
// the embedded LAMMPS), and everything below is string building. The same
// header is dropped unchanged into graphene-md and graphene-md-gpu.
//
// Fidelity contract, stated in the generated README and kept honest here:
//   * LAMMPS-engine sessions export to the SAME potential the plugin ran
//     (AIREBO / ExTeP / REBO-MoS2 / SW), with the plugin's fix-external
//     substrate LJ replaced by the native equivalent: pair_style hybrid with
//     lj/cut cross terms against a frozen substrate type. Near-exact.
//   * Classic-engine sessions export the Morse bond list + harmonic angles
//     (LAMMPS conventions: bond morse is exactly De(1-e^{-a(r-re)})^2;
//     angle harmonic is K(t-t0)^2, so K = ktheta/2). Two toy-model terms
//     have no LAMMPS equivalent and are OMITTED, with consequences stated:
//     the bending umbrella (wrinkle wavelengths shift) and the velocity cap.
//     The displacement cap maps exactly to fix nve/limit. Bond break/reform
//     maps to fix bond/break + bond/create (MC package) and is emitted
//     COMMENTED, since not every LAMMPS build carries that package.
//   * The protrusion driver exports as native fixes: substrate lift as
//     fix move variable over stored initial coordinates, gas pocket as
//     fix addforce with an atom-style weight — both continuing the ramp
//     from the exported instant.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace lmpexport {

struct File {
    std::string name, text;
};

struct Deck {
    // engine / material
    bool lammpsEngine = false;
    std::string materialKey = "graphene";
    int nsp = 1;
    double mass[3] = {12.011, 0, 0};
    std::string pairStyle;   // e.g. "pair_style airebo 3.0" (lammps engine)
    std::string potFile;     // file name inside potDir
    std::string coeffTail;   // element mapping, e.g. "C" or "W S1 S2"
    std::string potDir;      // absolute path to the bundle's potentials/

    // physics parameters
    double dtFs = 1, gamma = 1e-5, sigma = 3.42, eps = 2.387e-3;
    double edgeK = 0;        // >=200 means hard-pinned
    double De = 1.67, alpha = 3.0, re = 1.42;
    double ktheta = 8.0, theta0 = 120.0, kbend = 1.0;
    double maxV = 5, maxDX = 0.3;
    double breakMul = 1.2, reformMul = 1.1;
    double viscous = 0;      // precomputed fix-viscous coefficient (eV*ps/A^2)
    double Nnm = 12;

    // protrusion driver
    std::string profile = "gauss", protLoc = "subUp", elevMode = "rhrd";
    double Mxnm = 6, Mynm = 6, Cxnm = 0, Cynm = 0;
    double bubbleRnm = 4, bubbleP = 1000, betweenBoost = 25;
    double liftRate = 0.01, targetDz = 10;
    int holdSteps = 500;
    bool elevActive = false;
    double elevz = 0, henckyH0 = 0, areaAtom = 2.62;
    double gasT = 300, gasGap = 1.2;   // fixed-N gas: temperature, peel gap
    double z0ref = 3.35;               // substrate contact plane, A

    // state
    std::vector<double> tx, ty, tz;      // sheet positions, A
    std::vector<double> vx, vy, vz;      // sheet velocities, A/ps (LAMMPS units)
    std::vector<int> tSpec;              // species index per sheet atom (0-based)
    std::vector<uint8_t> isEdge;
    std::vector<double> sx, sy, sz;      // substrate positions, A
    // classic topology (empty for the lammps engine)
    std::vector<int32_t> bondI, bondJ, angC, angA, angB;

    double epotNow = 0, temperature = 0;
    long long frame = 0;
};

inline void addf(std::string &s, const char *fmt, ...) {
    char b[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof b, fmt, ap);
    va_end(ap);
    s += b;
}

// --------------------------------------------------------- runaway atoms
//
// A hot run can throw a few atoms clear of the sheet. They are still tracked
// by the plugin, but once they are further than a cutoff from everything they
// exert and feel exactly nothing — they are evaporated debris. They are NOT
// harmless in a LAMMPS deck though: the box must contain them, and LAMMPS bins
// the whole box, so a handful of escapees at 7000 A turned a 12 nm sheet into
// 879 million neighbour bins and 98.8% of the runtime went into building
// neighbour lists (measured on a real export).
//
// So they are identified here and deleted by the deck, which is exactly
// equivalent physics for everything that remains, and the generated script
// says so and shows how to keep them instead.

struct Outliers {
    std::vector<size_t> ids;   // 1-based LAMMPS ids
    double bulkR = 0;          // 99th-percentile sheet radius about the median
    double cut = 0;            // distance threshold used
};

inline Outliers findOutliers(const Deck &D) {
    Outliers o;
    const size_t n = D.tx.size();
    if (n < 16) return o;
    std::vector<double> xs(D.tx), ys(D.ty), zs(D.tz);
    auto median = [](std::vector<double> v) {
        std::nth_element(v.begin(), v.begin() + v.size() / 2, v.end());
        return v[v.size() / 2];
    };
    const double cx = median(xs), cy = median(ys), cz = median(zs);
    std::vector<double> r(n);
    for (size_t i = 0; i < n; i++) {
        const double dx = D.tx[i] - cx, dy = D.ty[i] - cy, dz = D.tz[i] - cz;
        r[i] = std::sqrt(dx * dx + dy * dy + dz * dz);
    }
    std::vector<double> rs(r);
    std::nth_element(rs.begin(), rs.begin() + (size_t)(0.99 * rs.size()), rs.end());
    o.bulkR = rs[(size_t)(0.99 * rs.size())];
    // Generous: ten interaction cutoffs beyond the bulk, and at least twice the
    // bulk radius, so only genuinely departed atoms qualify.
    o.cut = std::max(o.bulkR * 2.0, o.bulkR + 30.0 * D.sigma);
    for (size_t i = 0; i < n; i++)
        if (r[i] > o.cut) o.ids.push_back(i + 1);
    return o;
}

// ------------------------------------------------------------- data file

inline std::string dataFile(const Deck &D) {
    const size_t n = D.tx.size(), m = D.sx.size();
    const int subType = D.nsp + 1;
    const bool classic = !D.lammpsEngine;

    double lo[3] = {1e30, 1e30, 1e30}, hi[3] = {-1e30, -1e30, -1e30};
    auto grow = [&](double x, double y, double z) {
        lo[0] = std::min(lo[0], x); hi[0] = std::max(hi[0], x);
        lo[1] = std::min(lo[1], y); hi[1] = std::max(hi[1], y);
        lo[2] = std::min(lo[2], z); hi[2] = std::max(hi[2], z);
    };
    for (size_t i = 0; i < n; i++) grow(D.tx[i], D.ty[i], D.tz[i]);
    for (size_t i = 0; i < m; i++) grow(D.sx[i], D.sy[i], D.sz[i]);
    // The box MUST contain every atom, so a handful of runaway atoms from a hot
    // run can stretch it enormously — and LAMMPS bins the whole box: a 12 nm
    // sheet with 8 escapees reaching 7000 A produced 879 MILLION neighbour
    // bins and spent 98.8% of its runtime building neighbour lists (measured).
    // Nothing is dropped here; instead the deck is told to bin sensibly, and
    // the count of far-flung atoms is reported so the number is not a mystery.

    std::string s;
    addf(s, "# graphene-md export: %s, %s engine, frame %lld\n",
         D.materialKey.c_str(), classic ? "classic" : "lammps", D.frame);
    addf(s, "# continue-from-now snapshot; positions A, velocities A/ps (metal units)\n\n");
    addf(s, "%zu atoms\n", n + m);
    if (classic) {
        addf(s, "%zu bonds\n%zu angles\n", D.bondI.size(), D.angC.size());
    }
    addf(s, "%d atom types\n", subType);
    if (classic) addf(s, "1 bond types\n1 angle types\n");
    addf(s, "\n%.6f %.6f xlo xhi\n", lo[0] - 25, hi[0] + 25);
    addf(s, "%.6f %.6f ylo yhi\n", lo[1] - 25, hi[1] + 25);
    addf(s, "%.6f %.6f zlo zhi\n", lo[2] - 15, hi[2] + 40);

    s += "\nMasses\n\n";
    for (int t = 0; t < D.nsp; t++) addf(s, "%d %.6f\n", t + 1, D.mass[t]);
    addf(s, "%d %.6f  # substrate (frozen)\n", subType, D.mass[0]);

    addf(s, "\nAtoms # %s\n\n", classic ? "molecular" : "atomic");
    for (size_t i = 0; i < n; i++) {
        const int typ = (i < D.tSpec.size() ? D.tSpec[i] : 0) + 1;
        if (classic)
            addf(s, "%zu 1 %d %.8f %.8f %.8f\n", i + 1, typ, D.tx[i], D.ty[i], D.tz[i]);
        else
            addf(s, "%zu %d %.8f %.8f %.8f\n", i + 1, typ, D.tx[i], D.ty[i], D.tz[i]);
    }
    for (size_t i = 0; i < m; i++) {
        if (classic)
            addf(s, "%zu 1 %d %.8f %.8f %.8f\n", n + i + 1, subType, D.sx[i], D.sy[i], D.sz[i]);
        else
            addf(s, "%zu %d %.8f %.8f %.8f\n", n + i + 1, subType, D.sx[i], D.sy[i], D.sz[i]);
    }

    s += "\nVelocities\n\n";
    for (size_t i = 0; i < n; i++)
        addf(s, "%zu %.8f %.8f %.8f\n", i + 1, D.vx[i], D.vy[i], D.vz[i]);
    for (size_t i = 0; i < m; i++) addf(s, "%zu 0 0 0\n", n + i + 1);

    if (classic && !D.bondI.empty()) {
        s += "\nBonds\n\n";
        for (size_t b = 0; b < D.bondI.size(); b++)
            addf(s, "%zu 1 %d %d\n", b + 1, D.bondI[b] + 1, D.bondJ[b] + 1);
    }
    if (classic && !D.angC.empty()) {
        s += "\nAngles\n\n";
        // LAMMPS order: atom1 - atom2(centre) - atom3
        for (size_t a = 0; a < D.angC.size(); a++)
            addf(s, "%zu 1 %d %d %d\n", a + 1, D.angA[a] + 1, D.angC[a] + 1, D.angB[a] + 1);
    }
    return s;
}

// ------------------------------------------------------------ the driver

// Equal-style elevation variable elev(t), continuing from elevz at t=0.
// t is elapsed*dt in ps; rate converts A/step to A/ps.
inline std::string elevVariable(const Deck &D) {
    const double rate = D.liftRate * 1000.0 / D.dtFs;  // A per ps
    const double target = (D.profile == "bubble" || D.profile == "bubbleN"
                           || D.profile == "bubbleFree") ? D.henckyH0 : D.targetDz;
    const double e0 = D.elevz;
    std::string s;
    addf(s, "variable tps    equal elapsed*dt\n");
    if (D.elevMode == "const") {
        addf(s, "variable elev   equal \"(v_tps*%.8g+%.8g)*((v_tps*%.8g+%.8g)<%.8g)+"
                "%.8g*((v_tps*%.8g+%.8g)>=%.8g)\"\n",
             rate, e0, rate, e0, target, target, rate, e0, target);
    } else {
        const double durUp = std::max(0.0, (target - e0) / rate);
        const double hold = D.holdSteps * D.dtFs / 1000.0;
        const double durDn = target / rate;
        const double t1 = durUp, t2 = durUp + hold, t3 = durUp + hold + durDn;
        addf(s, "# ramp-hold-return continuing from elev=%.4g A: up to %.4g A at %.4g A/ps,\n",
             e0, target, rate);
        addf(s, "# hold %.4g ps, return; piecewise via boolean algebra\n", hold);
        addf(s, "variable elev   equal \"(%.8g+%.8g*v_tps)*(v_tps<%.8g)"
                "+%.8g*(v_tps>=%.8g)*(v_tps<%.8g)"
                "+(%.8g-%.8g*(v_tps-%.8g))*(v_tps>=%.8g)*(v_tps<%.8g)\"\n",
             e0, rate, t1, target, t1, t2, target, rate, t2, t2, t3);
    }
    return s;
}

// Per-atom footprint weight w(x,y) as an atom-style variable over coordinates
// held in cx/cy (either f_s0 stored coords for the lift, or live x/y for gas).
inline std::string weightExpr(const Deck &D, const std::string &cx, const std::string &cy) {
    const double CX = D.Cxnm * 10, CY = D.Cynm * 10;
    char b[400];
    if (D.profile == "mesa") {
        snprintf(b, sizeof b, "(abs(%s-%.6g)<=%.6g)*(abs(%s-%.6g)<=%.6g)",
                 cx.c_str(), CX, D.Mxnm * 5.0, cy.c_str(), CY, D.Mynm * 5.0);
    } else if (D.profile == "bubble") {
        const double R2 = D.bubbleRnm * 10 * D.bubbleRnm * 10;
        // (1-r2/R2)^(2/3) inside, exactly 0 outside. The base must be clamped
        // with ARITHMETIC: outside the blister 1-r2/R2 is negative, a negative
        // base to a fractional power is NaN, and 0*NaN = NaN -- which silently
        // NaN'd every atom outside the blister and destroyed the run on the
        // first step. max() cannot be used here: it is a LAMMPS *special*
        // function (a reduction) and is rejected in an atom-style formula.
        // Folding the guard into the base makes it 1 outside, never negative.
        snprintf(b, sizeof b,
                 "(((%s-%.6g)^2+(%s-%.6g)^2)<%.6g)*"
                 "((1-(((%s-%.6g)^2+(%s-%.6g)^2)/%.6g)*"
                 "((((%s-%.6g)^2+(%s-%.6g)^2)<%.6g)))^0.6666667)",
                 cx.c_str(), CX, cy.c_str(), CY, R2,
                 cx.c_str(), CX, cy.c_str(), CY, R2,
                 cx.c_str(), CX, cy.c_str(), CY, R2);
    } else {
        const double sx = D.Mxnm * 10 / 3, sy = D.Mynm * 10 / 3;
        snprintf(b, sizeof b, "exp(-((%s-%.6g)^2/%.6g+(%s-%.6g)^2/%.6g))",
                 cx.c_str(), CX, 2 * sx * sx, cy.c_str(), CY, 2 * sy * sy);
    }
    return b;
}

inline std::string driverBlock(const Deck &D) {
    std::string s;
    const bool active = D.elevActive;
    const char *c = active ? "" : "# ";
    s += "# ---------------- protrusion driver ----------------\n";
    if (!active)
        s += "# (elevation was idle at export; uncomment to drive it from here)\n";
    if (D.protLoc == "between") {
        const bool gasLaw = (D.profile == "bubbleN" || D.profile == "bubbleFree");
        const bool freeFront = (D.profile == "bubbleFree");
        const double target = (D.profile == "bubble" || gasLaw) ? D.henckyH0 : D.targetDz;
        if (gasLaw) {
            // ---- fixed-N gas, pressure from the volume the sheet encloses ----
            const double R = D.bubbleRnm * 10.0, R2 = R * R;
            const double CX = D.Cxnm * 10, CY = D.Cynm * 10;
            const double kT = 1.380649e-23 * (D.gasT > 0 ? D.gasT : 300.0);
            // N is fixed from the requested pressure at the Hencky volume, the
            // same rule the plugin uses, so the two agree by construction.
            const double Vh = 0.6 * 3.14159265358979 * D.henckyH0 * R2 * 1e-30;
            const double Ntot = Vh > 0 ? (D.bubbleP * 1e6) * Vh / kT : 0;
            const double Vfloor = 3.14159265358979 * R2 * 0.5;   // A^3
            const char *r2 = "((x-%.6g)^2+(y-%.6g)^2)";
            char rr[160];
            snprintf(rr, sizeof rr, r2, CX, CY);

            addf(s, "%s# Fixed-N gas: p = N k T / V with V measured from the sheet each\n", c);
            addf(s, "%s# step, so inflating the blister lowers the pressure. This is the\n", c);
            addf(s, "%s# feedback the prescribed-pressure form has no way to express.\n", c);
            if (freeFront)
                addf(s, "%s# The wetted mask tests z as well as radius, so the pressurised\n"
                        "%s# footprint FOLLOWS THE PEEL FRONT and the blister radius is an\n"
                        "%s# output, not an input. Note min()/max() are reductions in LAMMPS,\n"
                        "%s# not two-argument functions, so every clamp below is arithmetic.\n",
                     c, c, c, c);
            addf(s, "%s", elevVariable(D).insert(0, active ? "" : "# ").c_str());
            // molecules currently admitted: the ramp fills and empties the pocket
            addf(s, "%svariable gfrac equal \"(v_elev/%.8g)*((v_elev/%.8g)<1)+((v_elev/%.8g)>=1)\"\n",
                 c, target, target, target);
            addf(s, "%svariable gasN  equal %.10g*v_gfrac\n", c, Ntot);
            // wetted set: seed disc, plus anything peeled open (free front only)
            if (freeFront)
                addf(s, "%svariable wet   atom \"(%s<%.8g)||((z-%.8g)>%.8g)\"\n",
                     c, rr, R2, D.z0ref, D.gasGap);
            else
                addf(s, "%svariable wet   atom \"(%s<%.8g)\"\n", c, rr, R2);
            addf(s, "%svariable gapz  atom \"(z-%.8g)*((z-%.8g)>0)\"\n", c, D.z0ref, D.z0ref);
            addf(s, "%svariable voli  atom v_gapz*v_wet*%.6g\n", c, D.areaAtom);
            addf(s, "%scompute  Vsum  sheet reduce sum v_voli\n", c);
            // clamp the volume arithmetically: a pocket of zero volume would give
            // infinite pressure, and max() is not available here
            addf(s, "%svariable gasV  equal \"c_Vsum*(c_Vsum>%.8g)+%.8g*(c_Vsum<=%.8g)\"\n",
                 c, Vfloor, Vfloor, Vfloor);
            addf(s, "%svariable gasP  equal \"v_gasN*%.10g/(v_gasV*1.0e-30)\"\n", c, kT);
            addf(s, "%svariable fzg   atom v_gasP*6.2415e-12*%.6g*v_wet\n", c, D.areaAtom);
            addf(s, "%sfix gas sheet addforce 0.0 0.0 v_fzg\n", c);
            addf(s, "%s# thermo_style can carry v_gasP and v_gasV to watch the feedback,\n", c);
            addf(s, "%s# and c_Vsum is the blister volume in A^3 at any step.\n", c);
        } else {
            const double boost = D.betweenBoost > 0 ? D.betweenBoost : 1;
            // gasF(t) = P*min(elev/target,1) * conversion * area * boost, eV/A
            const double full = D.bubbleP * 1e6 * 6.2415e-12 * D.areaAtom * boost;
            addf(s, "%s", elevVariable(D).insert(0, active ? "" : "# ").c_str());
            addf(s, "%svariable gasF  equal \"%.8g*((v_elev/%.8g)*((v_elev/%.8g)<1)+((v_elev/%.8g)>=1))\"\n",
                 c, full, target, target, target);
            addf(s, "%svariable wfoot atom \"%s\"\n", c, weightExpr(D, "x", "y").c_str());
            addf(s, "%svariable fzg   atom v_gasF*v_wfoot\n", c);
            addf(s, "%sfix gas sheet addforce 0.0 0.0 v_fzg\n", c);
        }
    } else {
        addf(s, "%sfix s0 sub store/state 0 x y z\n", c);
        addf(s, "%s", elevVariable(D).insert(0, active ? "" : "# ").c_str());
        addf(s, "%svariable dlift equal v_elev-%.8g\n", c, D.elevz);
        addf(s, "%svariable wsub  atom \"%s\"\n", c, weightExpr(D, "f_s0[1]", "f_s0[2]").c_str());
        addf(s, "%svariable dzs   atom v_dlift*v_wsub\n", c);
        addf(s, "%svariable nul   atom 0.0\n", c);
        addf(s, "%sfix lift sub move variable NULL NULL v_dzs v_nul v_nul v_nul\n", c);
        if (!active)
            s += "# note: the lift continues from the exported height; the current\n"
                 "# profile is already baked into the substrate coordinates.\n";
    }
    return s;
}

// -------------------------------------------------------------- run script

inline std::string runScript(const Deck &D) {
    const bool classic = !D.lammpsEngine;
    const int subType = D.nsp + 1;
    const double rc = 3 * D.sigma;
    const bool pinned = D.edgeK >= 200;
    std::string s;

    addf(s, "# graphene-md -> LAMMPS export (%s engine, %s), continue-from-now\n",
         classic ? "classic" : "embedded-LAMMPS", D.materialKey.c_str());
    addf(s, "# plugin state at export: frame %lld, Epot %.6g eV, T %.1f K\n",
         D.frame, D.epotNow, D.temperature);
    s += "# Run from this directory:  lmp -in run.in\n";
    s += "#\n";
    s += "# THREADS: LAMMPS defaults to ONE OpenMP thread when OMP_NUM_THREADS is\n";
    s += "# unset, so an idle multicore box will quietly run serial. Uncomment the\n";
    s += "# two lines below (set N to your physical core count) or export\n";
    s += "# OMP_NUM_THREADS before launching. Needs a build with PKG_OPENMP.\n";
    s += "# package omp 8\n";
    s += "# suffix omp\n\n";
    s += "units metal\ndimension 3\n";
    s += "boundary m m m   # 'm', never 's': shrink-wrap on a flat sheet kills neighbor binning\n";
    addf(s, "atom_style %s\n", classic ? "molecular" : "atomic");
    s += "read_data system.data\n\n";

    if (classic) {
        s += "# Morse bonds and harmonic angles carry the toy model's in-plane physics.\n";
        s += "# LAMMPS bond morse IS De(1-exp(-a(r-re)))^2; angle harmonic is K(t-t0)^2,\n";
        s += "# so K = ktheta/2. Requires the MOLECULE package.\n";
        s += "bond_style morse\n";
        addf(s, "bond_coeff 1 %.8g %.8g %.8g\n", D.De, D.alpha, D.re);
        s += "angle_style harmonic\n";
        addf(s, "angle_coeff 1 %.8g %.8g\n", D.ktheta / 2, D.theta0);
        s += "special_bonds lj 0 0 0\n";
        addf(s, "pair_style lj/cut %.6g\n", rc);
        s += "pair_coeff * * 0.0 1.0   # sheet-sheet nonbonded: none in the model\n";
        addf(s, "pair_coeff 1 %d %.8g %.8g %.6g   # sheet-substrate\n",
             subType, D.eps, D.sigma, rc);
    } else {
        // "pair_style airebo 3.0" -> "pair_style hybrid airebo 3.0 lj/cut rc"
        std::string args = D.pairStyle.substr(std::string("pair_style ").size());
        const std::string styleName = args.substr(0, args.find(' ') == std::string::npos
                                                         ? args.size() : args.find(' '));
        addf(s, "# The plugin computed the sheet with %s and added the substrate LJ\n", styleName.c_str());
        addf(s, "# through fix external; here that becomes a native hybrid cross term.\n");
        addf(s, "pair_style hybrid %s lj/cut %.6g\n", args.c_str(), rc);
        addf(s, "pair_coeff * * %s \"%s/%s\" %s NULL\n",
             styleName.c_str(), D.potDir.c_str(), D.potFile.c_str(), D.coeffTail.c_str());
        for (int t = 1; t <= D.nsp; t++)
            addf(s, "pair_coeff %d %d lj/cut %.8g %.8g %.6g\n", t, subType, D.eps, D.sigma, rc);
        addf(s, "pair_coeff %d %d none\n", subType, subType);
    }

    s += "\nneighbor 2.0 bin\nneigh_modify every 1 delay 0 check yes\n";
    addf(s, "timestep %.10g\n\n", D.dtFs * 1e-3);

    // groups
    if (D.nsp == 1) s += "group sheet type 1\n";
    else addf(s, "group sheet type 1:%d\n", D.nsp);
    addf(s, "group sub type %d\n", subType);
    {
        // Exact edge membership by id, but ONLY when the collar is actually
        // used. LAMMPS' "group ... id" rescans every atom once PER ARGUMENT,
        // so a raw id list is O(nEdge * nAtoms): at 930k atoms and 37k edge
        // ids that is 3.5e10 comparisons and LAMMPS never leaves setup.
        // Collapsing to "a:b" ranges costs one scan per range instead, and a
        // border collar is contiguous, so the count drops by ~100x.
        // Build the list first: emitting inline risks a trailing continuation
        // '&' (a parse error) or, with no edge atoms, a bare "group edge id".
        std::vector<size_t> eids;
        if (D.edgeK > 0)
            for (size_t i = 0; i < D.isEdge.size(); i++)
                if (D.isEdge[i]) eids.push_back(i + 1);
        if (eids.empty()) {
            s += "group edge empty";
            if (D.edgeK <= 0)
                s += "   # edge springs are off (edgeK = 0); membership not computed";
            s += "\n";
        } else {
            std::vector<std::pair<size_t, size_t>> runs;
            for (size_t k = 0; k < eids.size(); k++) {
                if (!runs.empty() && eids[k] == runs.back().second + 1) runs.back().second = eids[k];
                else runs.push_back({eids[k], eids[k]});
            }
            addf(s, "# %zu edge atoms in %zu contiguous id ranges\n",
                 eids.size(), runs.size());
            s += "group edge id";
            for (size_t k = 0; k < runs.size(); k++) {
                if (runs[k].first == runs[k].second) addf(s, " %zu", runs[k].first);
                else addf(s, " %zu:%zu", runs[k].first, runs[k].second);
                if ((k + 1) % 12 == 0 && k + 1 < runs.size()) s += " &\n   ";
            }
            s += "\n";
        }
    }

    // Evaporated debris: delete it, loudly. See findOutliers() for why.
    {
        const Outliers o = findOutliers(D);
        if (!o.ids.empty()) {
            addf(s, "\n# %zu atom(s) had escaped the sheet at export (further than\n",
                 o.ids.size());
            addf(s, "# %.0f A from the bulk, whose 99%% radius is %.0f A). They are beyond\n",
                 o.cut, o.bulkR);
            s += "# every interaction cutoff, so removing them changes no FORCE on any\n"
                 "# remaining atom — and it matters for speed: keeping them forces\n"
                 "# LAMMPS to bin a box thousands of Angstroms wide, which can put 99%\n"
                 "# of the runtime into neighbour-list builds.\n"
                 "# It does change GLOBAL AGGREGATES. Escaping atoms are fast, so they\n"
                 "# can dominate total kinetic energy: in one real export 8 atoms out of\n"
                 "# 5481 carried 79% of it, and the reported temperature fell from\n"
                 "# 1048 K to 219 K on deletion. The lower number is the meaningful one\n"
                 "# (ballistic debris is not thermal motion of the sheet), but it will\n"
                 "# not match the plugin's readout. Comment these lines out to keep them.\n";
            s += "group far id";
            for (size_t k = 0; k < o.ids.size(); k++) {
                addf(s, " %zu", o.ids[k]);
                if ((k + 1) % 16 == 0 && k + 1 < o.ids.size()) s += " &\n   ";
            }
            s += "\n";
            addf(s, "delete_atoms group far compress no%s\n",
                 classic ? " bond yes" : "");
        }
    }

    if (classic) {
        s += "\n# Pairs that contribute nothing should not even be neighbour-listed:\n"
             "# sheet-sheet nonbonded is zero in this model and the substrate is frozen.\n";
        s += "neigh_modify exclude type 1 1\n";
        addf(s, "neigh_modify exclude type %d %d\n", subType, subType);
    }

    s += "\n# substrate is rigid: simply not integrated\n";
    if (pinned) {
        s += "group mobile subtract sheet edge   # hard-pinned collar\n";
        s += "velocity edge set 0 0 0\n";
        addf(s, "fix mdint mobile %s\n",
             classic ? "nve/limit" : "nve");
    } else {
        addf(s, "fix mdint sheet %s\n", classic ? "nve/limit" : "nve");
        if (D.edgeK > 0)
            addf(s, "fix collar edge spring/self %.8g\n", D.edgeK);
    }
    if (classic) {
        // fix nve/limit needs its cap argument appended to the fix line above;
        // patch it in here to keep the branch logic readable.
        const std::string cap = " " + std::to_string(D.maxDX * (D.dtFs / 0.5));
        const size_t p = s.rfind("nve/limit");
        if (p != std::string::npos) s.insert(p + 9, cap);
        s += "# (the plugin also caps VELOCITY at maxV; no stock LAMMPS analog - omitted)\n";
    }
    if (D.viscous > 0)
        addf(s, "fix visc sheet viscous %.10g\n", D.viscous);

    if (classic) {
        s += "\n# Bond break/reform, as in the plugin (needs the MC package; commented\n";
        s += "# because not every build carries it):\n";
        addf(s, "# fix brk sheet bond/break 10 1 %.6g\n", D.breakMul * D.re);
        addf(s, "# fix mk  sheet bond/create 10 1 1 %.6g 1 iparam 3 1 jparam 3 1\n",
             D.reformMul * D.re);
        s += "# The bending umbrella (kbend = " + std::to_string(D.kbend) + " eV) has NO\n";
        s += "# LAMMPS equivalent and is omitted: expect wrinkle wavelengths to shift.\n";
        s += "# For quantitative bending, rerun with AIREBO (see README).\n";
    }

    s += "\n" + driverBlock(D) + "\n";

    s += "# Temperature of the SHEET, not the box: thermo's default temp averages\n";
    s += "# over the frozen substrate too and reads roughly half the real value.\n";
    s += "compute Tsheet sheet temp\n";
    s += "thermo 100\nthermo_style custom step time pe ke c_Tsheet press\n";

    // Dump cadence scales with the system: "all atoms every 500" is a few MB at
    // 10k atoms and ~3 GB of text at 930k. Past a threshold, dump the sheet
    // often and the substrate rarely -- the substrate only moves under the
    // protrusion and one snapshot per phase is enough to see it.
    const size_t nAll = D.tx.size() + D.sx.size();
    if (nAll > 100000) {
        s += "# Large system: the sheet is dumped often, the (rigid) substrate rarely.\n";
        s += "# Dumping every atom this often would be gigabytes of text.\n";
        s += "dump sh sheet custom 250 sheet.lammpstrj id x y z\n";
        s += "dump_modify sh sort id\n";
        s += "dump sb sub custom 1250 sub.lammpstrj id x y z\n";
        s += "dump_modify sb sort id\n\n";
    } else {
        s += "dump traj all custom 100 traj.lammpstrj id type x y z\n";
        s += "dump_modify traj sort id\n\n";
    }

    // Run exactly the driver's own cycle when it is armed. The schedule is
    // already known here (elevVariable computes the same t3), so hardcoding a
    // round number just makes the user guess.
    if (D.elevActive && D.elevMode != "const") {
        const double rate = D.liftRate * 1000.0 / D.dtFs;             // A per ps
        const double target = (D.profile == "bubble" || D.profile == "bubbleN"
                               || D.profile == "bubbleFree") ? D.henckyH0 : D.targetDz;
        const double t3 = (target - D.elevz) / rate
                        + D.holdSteps * D.dtFs / 1000.0
                        + target / rate;                              // ps
        const long long cyc = (long long)(t3 * 1000.0 / D.dtFs + 0.5);
        const long long settle = cyc / 5;
        addf(s, "# The ramp-hold-return completes at step %lld; the tail lets the\n", cyc);
        addf(s, "# sheet settle once the protrusion is fully retracted.\n");
        addf(s, "run %lld\n", cyc + settle);
    } else {
        s += "run 20000\n";
    }
    return s;
}

// ---------------------------------------------------------------- README

inline std::string readme(const Deck &D) {
    std::string s;
    s += "graphene-md LAMMPS export\n=========================\n\n";
    addf(s, "Snapshot of a running %s-engine %s simulation at frame %lld\n",
         D.lammpsEngine ? "LAMMPS" : "classic", D.materialKey.c_str(), D.frame);
    s += "(continue-from-now: positions, velocities and topology as they were\n"
         "on screen; the deck resumes the same dynamics).\n\n";
    s += "Files:\n  run.in       the input script\n  system.data  atoms, velocities";
    s += D.lammpsEngine ? "\n" : ", bonds, angles\n";
    s += "\nRun:  lmp -in run.in\n\n";
    if (D.lammpsEngine) {
        addf(s, "Potential file: %s/%s — referenced by absolute path; copy it next\n",
             D.potDir.c_str(), D.potFile.c_str());
        s += "to the deck and shorten the path if you move the deck to another machine.\n\n";
        s += "Fidelity: same potential, timestep and damping as the plugin ran; the\n"
             "plugin's fix-external substrate LJ is replaced by the native hybrid\n"
             "lj/cut cross term (same epsilon/sigma/cutoff). Trajectories diverge\n"
             "chaotically after ~ps, aggregates match. The edge treatment is exact\n"
             "(same atom ids).\n";
    } else {
        s += "Fidelity notes (classic toy model):\n"
             " * Morse bonds + harmonic angles: exact mapping (MOLECULE package).\n"
             " * displacement cap -> fix nve/limit: exact analog.\n"
             " * velocity cap: no LAMMPS analog, omitted.\n"
             " * bending umbrella: no LAMMPS analog, omitted - wrinkle wavelengths\n"
             "   shift. For quantitative bending physics rerun with AIREBO.\n"
             " * bond break/reform: commented fixes in run.in (MC package).\n";
    }
    s += "\nThe protrusion driver continues from the exported instant using native\n"
         "fixes (move variable / addforce); if elevation was idle it is included\n"
         "commented, ready to enable.\n";
    return s;
}

inline std::vector<File> exportDeck(const Deck &D) {
    return { {"system.data", dataFile(D)}, {"run.in", runScript(D)},
             {"README.txt", readme(D)} };
}

} // namespace lmpexport
