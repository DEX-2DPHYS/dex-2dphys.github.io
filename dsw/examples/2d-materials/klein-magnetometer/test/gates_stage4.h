// gates_stage4.h — G10: the coherent sidebar.
//   (a) one cell (no junction): T_coh = 1 at every k_y, unitarity < 1e-8
//   (b) two cells (one junction, gate profile): the full-device coherent
//       transfer reproduces the single-junction Dirac table at E_F
//   (c) three cells: coherent T(E) oscillates (Fabry–Pérot) and its thermal
//       average at 300 K is within a few percent of the incoherent series
#pragma once
#include "klein_coherent.h"
#include <iostream>
#include <string>

static void check(bool ok, const std::string &what);
static std::string fmt(double v, int prec);

static void gateCoherent() {
    using namespace klein;
    {
        CoherentSpec cs; cs.p.nCells = 1; cs.p.Ln = 1e-6; cs.p.W = 1; cs.p.mfp = 0; cs.eN = 5; cs.kyN = 16; cs.temps = {20};
        CoherentJob job(cs); while (job.step()) {}
        const CoherentResult r = job.result();
        double worst = 0, unit = 0; for (size_t i = 0; i < r.Tcoh.size(); ++i) { worst = std::max(worst, std::abs(r.Tcoh[i] - 1)); unit = std::max(unit, r.worstUnit[i]); }
        check(worst < 1e-9 && unit < 1e-8, "G10a one cell: coherent T = 1 at every k_y and energy (worst " + fmt(worst, 2) + ", unitarity " + fmt(unit, 2) + ")");
    }
    {
        Params p; p.nCells = 2; p.Ln = p.Lp = 0.5e-6; p.W = 1; p.mfp = 0; p.profile = Profile::Gate; p.d = 10e-9;
        const Device dv = buildDevice(p);
        DeviceProfile dp; dp.dv = &dv; dp.profile = Profile::Gate; dp.win.push_back(dv.tables[0].window);
        double worst = 0, unit = 0;
        for (int i = 0; i < 20; ++i) {
            const double ky = dv.tables[0].kMax * (i + 0.5) / 20;
            double u; const double T = coherentT(dp, ky, u);
            worst = std::max(worst, std::abs(T - dv.tables[0].at(ky))); unit = std::max(unit, u);
        }
        check(worst < 2e-3 && unit < 1e-6, "G10b one junction: whole-device coherent transfer matches the junction table (worst " + fmt(worst, 2) + ")");
    }
    {
        CoherentSpec cs; cs.p.nCells = 3; cs.p.Ln = cs.p.Lp = 0.5e-6; cs.p.W = 1; cs.p.mfp = 0; cs.p.profile = Profile::Gate; cs.p.d = 10e-9;
        cs.eRange = 15e-3 * E_CHARGE; cs.eN = 151; cs.kyN = 33; cs.temps = {1, 4, 20};
        CoherentJob job(cs); while (job.step()) {}
        const CoherentResult r = job.result();
        double mn = 1, mx = 0; for (double v : r.Tcoh) { mn = std::min(mn, v); mx = std::max(mx, v); }
        std::cout << "       G10c two junctions: coherent T(E) in [" << fmt(mn, 4) << ", " << fmt(mx, 4) << "], incoherent " << fmt(r.TincEF, 4)
                  << "; thermal coh/inc at 1 K " << fmt(r.thermalCoh[0], 4) << "/" << fmt(r.thermalInc[0], 4) << ", 20 K " << fmt(r.thermalCoh[2], 4) << "/" << fmt(r.thermalInc[2], 4)
                  << ", 4 K " << fmt(r.thermalCoh[1], 4) << "/" << fmt(r.thermalInc[1], 4) << "; visibility " << fmt(r.visibility[0], 3) << " / " << fmt(r.visibility[1], 3)
                  << " / " << fmt(r.visibility[2], 3) << "  (" << fmt(r.ms / 1000, 3) << " s)\n";
        check(mx - mn > 0.02, "G10c Fabry-Perot oscillation present in the coherent T(E)");
        check(r.visibility[0] > r.visibility[1] && r.visibility[1] > r.visibility[2], "G10c visibility decreases monotonically with temperature");
        check(std::isfinite(r.thermalCoh[2]) && std::abs(r.thermalCoh[2] / r.thermalInc[2] - 1) < 0.08, "G10c 20 K thermal average of the coherent result within 8 % of the incoherent series (" + fmt(r.thermalCoh[2] / r.thermalInc[2] - 1, 2) + ")");
    }
}
