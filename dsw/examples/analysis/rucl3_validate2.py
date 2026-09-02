"""Does MACE-MP-0 know alpha-RuCl3? -- separating the two failure modes.

The first attempt relaxed the cell with no dispersion correction and produced
nonsense: a 25 % interlayer expansion and a Ru-Ru distance shorter than Ru-Cl.
Reporting that as "MACE is inaccurate" would have been wrong twice over.

MACE-MP-0 is trained on PBE, and PBE has essentially no van der Waals
attraction. RuCl3 is a vdW-layered halide, so without a dispersion correction
its layers are simply not bound and the cell inflates until the structure
destabilises. That is a known, expected failure of the underlying functional --
not evidence about the model's chemistry.

So this tests the two things separately:

  A. POSITIONS ONLY, cell held at the experimental one. This asks whether the
     INTRALAYER chemistry is right -- the Ru honeycomb and the RuCl6 octahedra
     -- with the vdW question taken off the table entirely.

  B. FULL relaxation WITH D3 dispersion. This asks whether the layered
     structure, interlayer spacing included, comes out right.

A pass on A and a fail on B means the model is fine and the dispersion
treatment is not. A fail on A means the model does not know this chemistry and
nothing downstream is worth computing.
"""
import numpy as np
from ase.spacegroup import crystal
from ase.optimize import BFGS
from ase.filters import FrechetCellFilter
from mace.calculators import mace_mp

EXP = dict(a=5.9762, b=10.342, c=6.013, beta=108.87)

def build():
    return crystal(
        symbols=["Ru", "Cl", "Cl"],
        basis=[(0.0, 0.3332, 0.0),
               (0.2265, 0.0, 0.2371),
               (0.2497, 0.3260, 0.7710)],
        spacegroup=12,
        cellpar=[EXP["a"], EXP["b"], EXP["c"], 90.0, EXP["beta"], 90.0],
        primitive_cell=False)

def geom(at):
    d = at.get_all_distances(mic=True)
    sym = at.get_chemical_symbols()
    ru = [i for i, s in enumerate(sym) if s == "Ru"]
    cl = [i for i, s in enumerate(sym) if s == "Cl"]
    rr = min(d[i][j] for i in ru for j in ru if i != j)
    rc = min(d[i][j] for i in ru for j in cl)
    cp = at.cell.cellpar()
    return rr, rc, cp[2] * np.sin(np.radians(cp[4]))

def report(tag, at, ref):
    rr, rc, inter = geom(at)
    cp = at.cell.cellpar()
    rows = [("a (A)", EXP["a"], cp[0]), ("b (A)", EXP["b"], cp[1]),
            ("c (A)", EXP["c"], cp[2]), ("beta (deg)", EXP["beta"], cp[4]),
            ("Ru-Ru (A)", ref[0], rr), ("Ru-Cl (A)", ref[1], rc),
            ("interlayer (A)", ref[2], inter)]
    print("\n  %s" % tag)
    print("  %-15s %10s %10s %9s" % ("", "experiment", "MACE", "error"))
    worst = 0.0
    for name, r, g in rows:
        e = 100 * (g - r) / r
        worst = max(worst, abs(e))
        print("  %-15s %10.4f %10.4f %8.2f %%" % (name, r, g, e))
    print("  worst: %.2f %%" % worst)
    return worst

def main():
    print("alpha-RuCl3 against MACE-MP-0, with the vdW question separated\n")
    ref_at = build()
    ref = geom(ref_at)
    print("  experiment:  Ru-Ru %.3f A   Ru-Cl %.3f A   interlayer %.3f A"
          % ref)

    # ---- A: intralayer chemistry, cell fixed, no dispersion needed ---------
    at = build()
    at.calc = mace_mp(model="medium", dispersion=False,
                      default_dtype="float64", device="cpu")
    BFGS(at, logfile=None).run(fmax=0.02, steps=200)
    wa = report("A. positions only, experimental cell (no dispersion)", at, ref)

    # ---- B: the full thing, with D3 ---------------------------------------
    at2 = build()
    at2.calc = mace_mp(model="medium", dispersion=True,
                       default_dtype="float64", device="cpu")
    BFGS(FrechetCellFilter(at2), logfile=None).run(fmax=0.02, steps=400)
    wb = report("B. full relaxation WITH D3 dispersion", at2, ref)

    print("\n  ---------------------------------------------------------------")
    if wa < 3:
        print("  The INTRALAYER chemistry is right (worst %.2f %% with the cell held)."
              % wa)
    else:
        print("  The intralayer chemistry is already off by %.2f %% -- the model does"
              % wa)
        print("  not know this material well enough to derive anything from.")
    if wb < 4:
        print("  With D3 the layered structure comes out too (worst %.2f %%)." % wb)
        print("  VERDICT: usable. Derive E2D, kappa and Gamma from this.")
    elif wa < 3:
        print("  With D3 the full cell is still %.2f %% out, so the interlayer" % wb)
        print("  binding is the weak part. In-plane properties (E2D, kappa) can be")
        print("  taken from A; Gamma should NOT be taken from this model.")
    else:
        print("  VERDICT: not usable as it stands.")

if __name__ == "__main__":
    main()
