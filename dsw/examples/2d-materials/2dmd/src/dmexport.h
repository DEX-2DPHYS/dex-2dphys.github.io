// dmexport.h — write the current layer stack as a stock LAMMPS deck.
//
// Phase 7 of DSW/2DMD-DESIGN.md. The point is not convenience: it is that a
// result produced inside this plugin can be checked OUTSIDE it, by LAMMPS, with
// no plugin in the loop at all. Twisted bubbles have never had that.
//
// The one place the exported deck must differ from the running plugin is the
// substrate. In the plugin it is not a LAMMPS atom -- it is the plugin's own
// Lennard-Jones, injected through `fix external`. A standalone deck has no
// callback, so here the substrate becomes REAL FROZEN ATOMS of a second type
// and the same LJ is written as a `lj/cut` pair coefficient. Same physics,
// expressed the way LAMMPS can express it.
//
// LAMMPS syntax traps this file is written around, each of which cost a debug
// round when it was first met:
//
//   * min() and max() are REDUCTIONS over a vector, not two-argument maths. So
//     every clamp below is arithmetic: a*(a>f) + f*(a<=f).
//   * A negative base to a fractional power is NaN, so a guard has to protect
//     the ARGUMENT, not the result.
//   * `group edge id <thousands of ids>` rescans every atom per argument and
//     hangs setup for minutes. Layers are contiguous here, so groups are
//     written as `a:b` ranges and cost nothing.
//   * The substrate's own internal pairs are pointless work -- it is frozen --
//     so they are excluded from the neighbour list.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <string>
#include <vector>

namespace dmexport {

struct File {
    std::string name;
    std::string text;
};

struct LayerSpec {
    int first = 0, last = 0;     // 1-based inclusive atom id range
    double zRest = 0;
    bool mobile = true;
};

struct Deck {
    // geometry
    std::vector<double> x, y, z;        // all atoms, sheets first then substrate
    std::vector<int> type;              // 1 = sheet, 2 = substrate
    std::vector<LayerSpec> layers;      // [0] substrate, then the sheets
    std::vector<int> edgeIds;           // 1-based, undercoordinated rim atoms

    // physics
    double sigma = 3.42, epsSub = 2.387e-3;
    double dtFs = 0.5, gamma = 1.0;
    double edgeK = 0.0;

    // gas
    bool gasOn = false;
    std::string profile = "bubbleFree";
    int gasGapIdx = 1;
    double bubbleRnm = 4, bubbleP = 600, gasT = 300, gasGapA = 1.2;
    double Cxnm = 0, Cynm = 0;
    double areaAtom = 2.62;

    int runSteps = 20000, dumpEvery = 500;
    std::string potentialPath = "CH.airebo";
};

inline void addf(std::string &s, const char *fmt, ...) {
    char buf[2048];
    va_list ap; va_start(ap, fmt);
    vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    s += buf;
}

// Contiguous ids as `a:b`, which LAMMPS reads in one step. A list of ids makes
// it rescan every atom per argument.
inline std::string ranges(const std::vector<int> &ids) {
    std::string out;
    size_t i = 0;
    while (i < ids.size()) {
        size_t j = i;
        while (j + 1 < ids.size() && ids[j + 1] == ids[j] + 1) j++;
        char buf[64];
        if (j > i) snprintf(buf, sizeof buf, "%d:%d", ids[i], ids[j]);
        else snprintf(buf, sizeof buf, "%d", ids[i]);
        if (!out.empty()) out += " ";
        out += buf;
        i = j + 1;
    }
    return out;
}

inline std::vector<File> exportDeck(const Deck &D) {
    std::vector<File> out;
    const size_t n = D.x.size();

    // ---------------------------------------------------------- system.data
    {
        double lo[3] = {1e30, 1e30, 1e30}, hi[3] = {-1e30, -1e30, -1e30};
        for (size_t i = 0; i < n; i++) {
            lo[0] = std::min(lo[0], D.x[i]); hi[0] = std::max(hi[0], D.x[i]);
            lo[1] = std::min(lo[1], D.y[i]); hi[1] = std::max(hi[1], D.y[i]);
            lo[2] = std::min(lo[2], D.z[i]); hi[2] = std::max(hi[2], D.z[i]);
        }
        const double pad = 60.0;
        std::string s;
        s.reserve(n * 48 + 512);
        addf(s, "2DMD export - %d layers, %zu atoms\n\n",
             (int)D.layers.size() - 1, n);
        addf(s, "%zu atoms\n2 atom types\n\n", n);
        addf(s, "%.6f %.6f xlo xhi\n", lo[0] - pad, hi[0] + pad);
        addf(s, "%.6f %.6f ylo yhi\n", lo[1] - pad, hi[1] + pad);
        addf(s, "%.6f %.6f zlo zhi\n\n", lo[2] - pad, hi[2] + pad);
        addf(s, "Masses\n\n1 12.011\n2 12.011\n\n");
        addf(s, "Atoms # atomic\n\n");
        for (size_t i = 0; i < n; i++)
            addf(s, "%zu %d %.6f %.6f %.6f\n", i + 1, D.type[i], D.x[i], D.y[i], D.z[i]);
        out.push_back({"system.data", std::move(s)});
    }

    // ------------------------------------------------------------- in.2dmd
    std::string s;
    const double cut = 3 * D.sigma;
    addf(s, "# 2DMD export - a stock LAMMPS deck for the same system.\n");
    addf(s, "#\n");
    addf(s, "# Type 1 is the live sheets, type 2 the rigid substrate. In the plugin\n");
    addf(s, "# the substrate is not a LAMMPS atom at all -- it is the plugin's own\n");
    addf(s, "# Lennard-Jones through `fix external`. A standalone deck has no\n");
    addf(s, "# callback, so here it is real frozen atoms with the same LJ written as\n");
    addf(s, "# a pair coefficient. Same physics, expressed the way LAMMPS can.\n");
    addf(s, "#\n");
    addf(s, "#   mpirun -np N lmp -in in.2dmd      (or plain: lmp -in in.2dmd)\n\n");

    addf(s, "units           metal\n");
    addf(s, "dimension       3\n");
    addf(s, "boundary        m m m\n");
    addf(s, "atom_style      atomic\n");
    addf(s, "atom_modify     map array sort 0 0.0\n");
    addf(s, "read_data       system.data\n\n");

    addf(s, "group           sheets type 1\n");
    addf(s, "group           sub    type 2\n");
    for (size_t k = 1; k < D.layers.size(); k++)
        addf(s, "group           layer%zu id %d:%d\n", k, D.layers[k].first, D.layers[k].last);
    addf(s, "\n");

    addf(s, "# AIREBO carries REBO bonds, the interlayer van der Waals AND torsion in\n");
    addf(s, "# one style -- the 3.0 is its LJ cutoff in sigma. So a stack of sheets\n");
    addf(s, "# needs nothing extra between them; adding an interlayer LJ here would\n");
    addf(s, "# double-count it. NULL keeps the substrate out of AIREBO.\n");
    addf(s, "pair_style      hybrid airebo 3.0 lj/cut %.6f\n", cut);
    // Quoted: LAMMPS splits arguments on whitespace and real paths here are
    // full of spaces ("00 VSCODE", "2D Materials"). Unquoted, the path
    // arrives as several arguments and the pair style rejects the line.
    addf(s, "pair_coeff      * * airebo \"%s\" C NULL\n", D.potentialPath.c_str());
    addf(s, "pair_coeff      1 2 lj/cut %.8g %.6f\n", D.epsSub, D.sigma);
    addf(s, "pair_coeff      2 2 lj/cut 0.0 %.6f\n\n", D.sigma);

    addf(s, "# The substrate is rigid, so its own internal pairs are pure waste.\n");
    addf(s, "neighbor        2.0 bin\n");
    addf(s, "neigh_modify    every 1 delay 0 check yes exclude group sub sub\n");
    addf(s, "velocity        sub set 0.0 0.0 0.0\n");
    addf(s, "fix             froze sub setforce 0.0 0.0 0.0\n\n");

    addf(s, "timestep        %.10g\n", D.dtFs * 1e-3);
    addf(s, "fix             mdint sheets nve\n");
    if (D.gamma > 0)
        addf(s, "fix             visc sheets viscous %.10g\n", D.gamma);
    addf(s, "\n");

    if (D.edgeK > 0 && !D.edgeIds.empty()) {
        addf(s, "# The rim, held to where it was built: without it a growing blister\n");
        addf(s, "# feeds itself by dragging the whole flake inward.\n");
        addf(s, "group           rim id %s\n", ranges(D.edgeIds).c_str());
        addf(s, "fix             pin rim spring/self %.8g\n\n", D.edgeK);
    }

    if (D.gasOn) {
        const int gi = D.gasGapIdx;
        const int drivenK = gi + 1;
        const double R = D.bubbleRnm * 10.0, R2 = R * R;
        const double CX = D.Cxnm * 10, CY = D.Cynm * 10;
        const double href = (drivenK < (int)D.layers.size()) ? D.layers[drivenK].zRest : 0.0;
        const double kT = 1.380649e-23 * (D.gasT > 0 ? D.gasT : 300.0);
        const double h0 = 0.709 * R * std::cbrt(D.bubbleP * 1e6 * (R * 1e-10) / 340.0);
        const double Vh = 0.6 * 3.14159265358979 * h0 * R * R * 1e-30;
        const double Ntot = Vh > 0 ? (D.bubbleP * 1e6) * Vh / kT : 0;
        const double Vfloor = 3.14159265358979 * R2 * 0.5;
        const bool fixedN = (D.profile != "bubble");
        const bool freeFront = (D.profile == "bubbleFree");

        addf(s, "# ---- the gas pocket, in gap %d --------------------------------\n", gi);
        addf(s, "# Model: %s\n", D.profile.c_str());
        if (fixedN) {
            addf(s, "# p = N k T / V, with V measured from the sheet EVERY STEP, so\n");
            addf(s, "# inflating the blister relieves the pressure. That feedback is the\n");
            addf(s, "# whole difference from a prescribed-pressure model.\n");
        } else {
            addf(s, "# Open loop: the pressure is asserted and inflation never relieves\n");
            addf(s, "# it. Kept only so older results reproduce.\n");
        }
        if (freeFront) {
            addf(s, "# The wetted mask tests z as well as radius, so the pressurised\n");
            addf(s, "# footprint FOLLOWS THE PEEL FRONT and the blister radius is an\n");
            addf(s, "# OUTPUT. Note min()/max() are reductions in LAMMPS, not\n");
            addf(s, "# two-argument functions, so the clamps below are arithmetic.\n");
        }
        const char *dg = "driven";
        addf(s, "group           %s union layer%d\n", dg, drivenK);
        if (freeFront)
            addf(s, "variable        wet   atom \"(((x-%.6g)^2+(y-%.6g)^2)<%.8g)||((z-%.8g)>%.8g)\"\n",
                 CX, CY, R2, href, D.gasGapA);
        else
            addf(s, "variable        wet   atom \"(((x-%.6g)^2+(y-%.6g)^2)<%.8g)\"\n", CX, CY, R2);

        if (fixedN) {
            addf(s, "variable        gapz  atom \"(z-%.8g)*((z-%.8g)>0)\"\n", href, href);
            addf(s, "variable        voli  atom v_gapz*v_wet*%.6g\n", D.areaAtom);
            addf(s, "compute         Vsum  %s reduce sum v_voli\n", dg);
            addf(s, "# a pocket of zero volume would give infinite pressure; clamp it\n");
            addf(s, "variable        gasV  equal \"c_Vsum*(c_Vsum>%.8g)+%.8g*(c_Vsum<=%.8g)\"\n",
                 Vfloor, Vfloor, Vfloor);
            addf(s, "variable        gasP  equal \"%.10g*%.10g/(v_gasV*1.0e-30)\"\n", Ntot, kT);
        } else {
            addf(s, "variable        gasP  equal %.10g\n", D.bubbleP * 1e6);
        }
        addf(s, "variable        fzg   atom v_gasP*6.2415e-12*%.6g*v_wet\n", D.areaAtom);
        addf(s, "fix             gas %s addforce 0.0 0.0 v_fzg\n", dg);
        if (D.layers[gi].mobile) {
            addf(s, "# Newton's third law: the gas presses the sheet below down just as\n");
            addf(s, "# hard. Omitting it lets a bubble lift the top sheet for free.\n");
            addf(s, "group           pressed union layer%d\n", gi);
            addf(s, "variable        fzp   atom -v_gasP*6.2415e-12*%.6g*v_wet\n", D.areaAtom);
            addf(s, "fix             gasr pressed addforce 0.0 0.0 v_fzp\n");
        }
        addf(s, "\n");
    }

    addf(s, "thermo          %d\n", D.dumpEvery);
    if (D.gasOn && D.profile != "bubble")
        addf(s, "thermo_style    custom step temp pe ke v_gasV v_gasP\n");
    else
        addf(s, "thermo_style    custom step temp pe ke\n");
    addf(s, "thermo_modify   lost warn flush yes\n\n");

    addf(s, "# A cropped flake's undercoordinated rim carries real bond-order strain.\n");
    addf(s, "# Released as kinetic energy it reads as thousands of kelvin, so settle\n");
    addf(s, "# it first, then start cold. Capped: the point is the rim, not full\n");
    addf(s, "# convergence.\n");
    addf(s, "min_style       cg\n");
    addf(s, "minimize        0.0 1.0e-4 200 1000\n");
    addf(s, "velocity        sheets set 0.0 0.0 0.0\n");
    addf(s, "reset_timestep  0\n\n");

    addf(s, "dump            d1 all custom %d sheet.lammpstrj id type x y z\n", D.dumpEvery);
    addf(s, "dump_modify     d1 sort id\n");
    addf(s, "run             %d\n", D.runSteps);

    out.push_back({"in.2dmd", std::move(s)});
    return out;
}

}  // namespace dmexport
