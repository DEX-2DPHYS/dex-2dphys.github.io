"""Does MACE-MP-0 actually know alpha-RuCl3?

This is the gate, and it comes before any property extraction. MACE-MP-0 is a
FOUNDATION model trained broadly on Materials Project -- not fitted to RuCl3 --
so numbers derived from it are worth nothing until it is shown to reproduce the
structure it is being asked about. If the lattice comes out wrong, the answer is
a different model or a RuCl3-specific fit, not quietly carrying on.

alpha-RuCl3 is monoclinic C2/m at room temperature: Ru honeycomb layers of
edge-sharing RuCl6 octahedra, stacked with a van der Waals gap. Structure from
Johnson et al., Phys. Rev. B 92, 235119 (2015):

    a = 5.9762 A   b = 10.342 A   c = 6.013 A   beta = 108.87 deg
    Ru   4g  (0,      0.3332, 0)
    Cl1  4i  (0.2265, 0,      0.2371)
    Cl2  8j  (0.2497, 0.3260, 0.7710)

The comparison that matters is not the total energy -- which is on an arbitrary
reference -- but the RELAXED GEOMETRY: lattice constants, the Ru-Ru honeycomb
bond, the Ru-Cl octahedral bond, and the interlayer spacing.
"""
import numpy as np
from ase import Atoms
from ase.spacegroup import crystal
from ase.optimize import BFGS
from ase.filters import FrechetCellFilter
from mace.calculators import mace_mp

EXP = dict(a=5.9762, b=10.342, c=6.013, beta=108.87)

def build():
    """alpha-RuCl3 in C2/m (space group 12) from the published Wyckoff sites."""
    return crystal(
        symbols=["Ru", "Cl", "Cl"],
        basis=[(0.0, 0.3332, 0.0),
               (0.2265, 0.0, 0.2371),
               (0.2497, 0.3260, 0.7710)],
        spacegroup=12,
        cellpar=[EXP["a"], EXP["b"], EXP["c"], 90.0, EXP["beta"], 90.0],
        primitive_cell=False)

def geometry(at):
    """The distances that actually characterise the structure."""
    d = at.get_all_distances(mic=True)
    sym = at.get_chemical_symbols()
    ru = [i for i, s in enumerate(sym) if s == "Ru"]
    cl = [i for i, s in enumerate(sym) if s == "Cl"]
    # nearest Ru-Ru: the honeycomb bond
    rr = min(d[i][j] for i in ru for j in ru if i != j)
    # nearest Ru-Cl: the octahedral bond
    rc = min(d[i][j] for i in ru for j in cl)
    # interlayer spacing: layers stack along c, so it is c*sin(beta)
    cell = at.cell.cellpar()
    inter = cell[2] * np.sin(np.radians(cell[4]))
    return rr, rc, inter

def main():
    print("alpha-RuCl3 against MACE-MP-0\n")
    at = build()
    print("  built %d atoms  (%s)" % (len(at), at.get_chemical_formula()))
    rr0, rc0, in0 = geometry(at)
    print("  experiment:  Ru-Ru %.3f A   Ru-Cl %.3f A   interlayer %.3f A" % (rr0, rc0, in0))

    print("\n  loading MACE-MP-0 (downloads ~100 MB on first use)...")
    calc = mace_mp(model="medium", dispersion=False, default_dtype="float64",
                   device="cpu")
    at.calc = calc
    e0 = at.get_potential_energy()
    print("  single point ok: %.4f eV for %d atoms (%.4f eV/atom)"
          % (e0, len(at), e0 / len(at)))

    print("\n  relaxing cell and positions...")
    opt = BFGS(FrechetCellFilter(at), logfile=None)
    opt.run(fmax=0.02, steps=300)
    cp = at.cell.cellpar()
    rr, rc, inter = geometry(at)

    print("\n  %-14s %10s %10s %9s" % ("", "experiment", "MACE", "error"))
    print("  %-14s %10s %10s %9s" % ("", "----------", "----", "-----"))
    rows = [("a (A)", EXP["a"], cp[0]), ("b (A)", EXP["b"], cp[1]),
            ("c (A)", EXP["c"], cp[2]), ("beta (deg)", EXP["beta"], cp[4]),
            ("Ru-Ru (A)", rr0, rr), ("Ru-Cl (A)", rc0, rc),
            ("interlayer (A)", in0, inter)]
    worst = 0.0
    for name, ref, got in rows:
        err = 100 * (got - ref) / ref
        worst = max(worst, abs(err))
        print("  %-14s %10.4f %10.4f %8.2f %%" % (name, ref, got, err))

    print("\n  worst deviation: %.2f %%" % worst)
    # A foundation model within a few per cent of a layered halide's geometry is
    # doing its job; past ~5 % the derived elastic constants are not worth having.
    if worst < 3:
        print("  VERDICT: good enough to derive elastic properties from.")
    elif worst < 6:
        print("  VERDICT: marginal. Usable for trends, not for absolute numbers.")
    else:
        print("  VERDICT: NOT good enough. A RuCl3-specific fit or another model")
        print("           is needed before anything is derived from this.")

if __name__ == "__main__":
    main()
