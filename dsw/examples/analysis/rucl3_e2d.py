"""RuCl3's 2D Young's modulus from MACE-MP-0.

Only IN-PLANE properties are taken from this model. Validation showed it
reproduces the intralayer geometry to 0.67 % with the cell held, but loses the
monoclinic stacking angle entirely when the cell is free -- so the interlayer
adhesion Gamma must come from elsewhere and does not appear here.

Two bugs in the first version of this file are worth stating, because both were
caught by a cheap check rather than by the physics looking wrong:

  * The layer was cut by slicing at half the cell height, which cut THROUGH a
    layer rather than between two. It produced Ru4Cl6 -- Ru:Cl = 2:3 -- and a
    1.35 A "layer" where a real RuCl3 sandwich is ~5.6 A of Cl-Ru-Cl. Layers are
    now found by clustering projected heights, and THE STOICHIOMETRY IS
    ASSERTED. A structure that is not RuCl3 cannot give RuCl3's modulus.

  * The reference was relaxed in POSITIONS ONLY, leaving the in-plane cell at
    its bulk value. A monolayer has its own equilibrium area, so E(eps) had a
    large linear term and the fitted curvature came out negative. The in-plane
    cell is now relaxed first, and the linear term is reported as the check that
    it worked.

Y_2D is quoted in N/m. A monolayer has no well-defined thickness, so a Pa value
requires choosing one; for a layered halide that choice is arbitrary.
"""
import numpy as np
from ase.spacegroup import crystal
from ase.optimize import BFGS
from mace.calculators import mace_mp

EXP = dict(a=5.9762, b=10.342, c=6.013, beta=108.87)
EV_A2_TO_N_M = 16.02176634          # 1 eV/A^2 = 16.02 N/m

def bulk():
    return crystal(
        symbols=["Ru", "Cl", "Cl"],
        basis=[(0.0, 0.3332, 0.0), (0.2265, 0.0, 0.2371), (0.2497, 0.3260, 0.7710)],
        spacegroup=12,
        cellpar=[EXP["a"], EXP["b"], EXP["c"], 90.0, EXP["beta"], 90.0],
        primitive_cell=False)

def monolayer(vac=18.0):
    """One COMPLETE RuCl3 layer, isolated by vacuum.

    Layers are found by clustering the atoms' projection on the stacking
    normal: within a layer the Cl-Ru-Cl planes are ~1.2 A apart, between layers
    there is a van der Waals gap of ~3 A. Splitting on the largest gap in the
    sorted heights therefore separates layers, where a fixed half-height cut
    does not -- the monoclinic cell means fractional z is not the stacking
    direction at all.
    """
    at = bulk()
    cell = at.cell.array
    n = np.cross(cell[0], cell[1]); n /= np.linalg.norm(n)
    # work in the periodic image that puts one layer contiguous
    h = at.get_positions() @ n
    period = abs(cell[2] @ n)
    h = np.mod(h, period)
    order = np.argsort(h)
    hs = h[order]
    gaps = np.diff(np.concatenate([hs, [hs[0] + period]]))
    cut = int(np.argmax(gaps))                 # the vdW gap
    # rotate the ordering so the layer starts just after the largest gap
    roll = np.roll(order, -(cut + 1))
    hr = np.mod(h[roll] - h[roll][0], period)
    # a layer is everything within ~4 A of its first atom along the normal
    keep = roll[hr < 4.0]
    at = at[keep]

    ns = at.get_chemical_symbols()
    nRu, nCl = ns.count("Ru"), ns.count("Cl")
    if nCl != 3 * nRu:
        raise SystemExit("layer extraction is wrong: Ru%d Cl%d is not RuCl3"
                         % (nRu, nCl))
    pos = at.get_positions()
    thick = (pos @ n).max() - (pos @ n).min()
    at.set_cell(np.array([cell[0], cell[1], n * (thick + vac)]), scale_atoms=False)
    at.center(axis=2)
    at.pbc = (True, True, True)
    return at, thick

def area(at):
    c = at.cell.array
    return np.linalg.norm(np.cross(c[0], c[1]))

def relax_inplane(at, calc, steps=8):
    """Relax the in-plane cell isotropically, then the positions. A monolayer
    has its own equilibrium area and the bulk value is not it."""
    best = None
    for _ in range(steps):
        scales, energies = [], []
        for s in np.linspace(-0.01, 0.01, 5):
            a2 = at.copy()
            c = a2.cell.array.copy()
            c[0] *= (1 + s); c[1] *= (1 + s)
            a2.set_cell(c, scale_atoms=True)
            a2.calc = calc
            BFGS(a2, logfile=None).run(fmax=0.03, steps=40)
            scales.append(s); energies.append(a2.get_potential_energy())
        k = int(np.argmin(energies))
        if abs(scales[k]) < 1e-6:
            break
        c = at.cell.array.copy()
        c[0] *= (1 + scales[k]); c[1] *= (1 + scales[k])
        at.set_cell(c, scale_atoms=True)
    at.calc = calc
    BFGS(at, logfile=None).run(fmax=0.02, steps=200)
    return at

def strained(base, calc, eps):
    """Uniaxial strain along a, with the transverse vector relaxed so the
    transverse stress goes to zero -- otherwise the curvature mixes elastic
    constants and is not Young's modulus."""
    cell0 = base.cell.array.copy()
    best = None
    for t in (np.linspace(-0.7 * eps, 0.2 * eps, 5) if abs(eps) > 1e-9 else [0.0]):
        a2 = base.copy()
        c = cell0.copy()
        c[0] = cell0[0] * (1 + eps)
        c[1] = cell0[1] * (1 + t)
        a2.set_cell(c, scale_atoms=True)
        a2.calc = calc
        BFGS(a2, logfile=None).run(fmax=0.03, steps=80)
        e = a2.get_potential_energy()
        if best is None or e < best:
            best = e
    return best

def main():
    print("RuCl3 in-plane stiffness from MACE-MP-0\n")
    at, thick = monolayer()
    print("  monolayer: %s, %d atoms, layer thickness %.2f A  (stoichiometry checked)"
          % (at.get_chemical_formula(), len(at), thick))

    calc = mace_mp(model="medium", dispersion=False, default_dtype="float64",
                   device="cpu")
    A_bulk = area(at)
    print("  relaxing the in-plane cell (a monolayer has its own equilibrium area)...")
    at = relax_inplane(at, calc)
    A0 = area(at)
    e0 = at.get_potential_energy()
    print("  area %.3f -> %.3f A^2 (%+.2f %%)   E0 %.4f eV"
          % (A_bulk, A0, 100 * (A0 - A_bulk) / A_bulk, e0))

    eps = np.array([-0.02, -0.01, -0.005, 0.0, 0.005, 0.01, 0.02])
    print("\n    strain      energy (eV)     dE (meV)")
    E = []
    for x in eps:
        e = strained(at, calc, float(x))
        E.append(e)
        print("    %+7.4f   %12.5f   %10.2f" % (x, e, 1000 * (e - e0)))
    E = np.array(E)

    c2, c1, c0 = np.polyfit(eps, E, 2)
    Y = 2 * c2 / A0 * EV_A2_TO_N_M
    resid = E - np.polyval([c2, c1, c0], eps)
    print("\n  parabola: curvature %.3f eV   residual max %.3f meV" % (2 * c2, 1000 * np.abs(resid).max()))
    print("  linear term %.5f eV   <- must be near zero, or the reference is not relaxed" % c1)
    print("\n  Y_2D = %.1f N/m        (graphene: ~340 N/m, ratio %.2f)" % (Y, Y / 340.0))
    if c2 <= 0:
        print("  NEGATIVE curvature -- the reference is still not at a minimum;")
        print("  do not use this number.")

if __name__ == "__main__":
    main()
