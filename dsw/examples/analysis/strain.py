"""Per-atom 2D strain from a reference and a deformed configuration.

The standard "atomic strain": for each atom, find the local deformation gradient
F that best maps its reference neighbour vectors onto its current ones, in a
least-squares sense,

    F_i = argmin  sum_j | F (r0_j - r0_i) - (r_j - r_i) |^2

solved as F = (sum_j dr dr0^T)(sum_j dr0 dr0^T)^{-1}. The small-strain tensor is
then eps = (F + F^T)/2 - I, from which

    dilatation   tr(eps)          -- area change, positive in tension
    shear        sqrt(((exx-eyy)/2)^2 + exy^2)   -- max in-plane shear
    principal    eigenvalues/vectors of eps

This is computed HERE rather than in the plugin for the same reason registry is:
it is a function of positions only, so the identical routine applies to plugin
frames and to LAMMPS dumps, and the two stay comparable.

Neighbours are taken from the REFERENCE configuration within a cutoff, which is
what makes the measure well defined even after bonds break: the reference
topology does not change.
"""
import numpy as np


def neighbour_lists(ref_xy, cutoff):
    """Reference-configuration neighbours within `cutoff`, via a uniform grid."""
    n = len(ref_xy)
    lo = ref_xy.min(axis=0)
    cell = cutoff
    ij = np.floor((ref_xy - lo) / cell).astype(np.int64)
    nx = ij[:, 0].max() + 1
    key = ij[:, 1] * nx + ij[:, 0]
    order = np.argsort(key, kind="stable")
    key_s = key[order]
    starts = {}
    b = 0
    for a in range(1, len(key_s) + 1):
        if a == len(key_s) or key_s[a] != key_s[b]:
            starts[int(key_s[b])] = (b, a)
            b = a
    out = []
    c2 = cutoff * cutoff
    for i in range(n):
        gx, gy = ij[i]
        cand = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                k = int((gy + dy) * nx + (gx + dx))
                r = starts.get(k)
                if r:
                    cand.append(order[r[0]:r[1]])
        if not cand:
            out.append(np.empty(0, dtype=np.int64)); continue
        cand = np.concatenate(cand)
        d = ref_xy[cand] - ref_xy[i]
        m = (d[:, 0] ** 2 + d[:, 1] ** 2 <= c2) & (cand != i)
        out.append(cand[m])
    return out


def atomic_strain(ref_xy, cur_xy, cutoff=3.2, min_neigh=3):
    """Return (dilatation, shear, exx, eyy, exy) per atom. NaN where undersampled."""
    ref_xy = np.asarray(ref_xy, float)[:, :2]
    cur_xy = np.asarray(cur_xy, float)[:, :2]
    n = len(ref_xy)
    nb = neighbour_lists(ref_xy, cutoff)
    exx = np.full(n, np.nan); eyy = np.full(n, np.nan); exy = np.full(n, np.nan)
    for i in range(n):
        j = nb[i]
        if len(j) < min_neigh:
            continue
        dr0 = ref_xy[j] - ref_xy[i]
        dr = cur_xy[j] - cur_xy[i]
        A = dr0.T @ dr0
        det = A[0, 0] * A[1, 1] - A[0, 1] * A[1, 0]
        if abs(det) < 1e-12:
            continue
        Ainv = np.array([[A[1, 1], -A[0, 1]], [-A[1, 0], A[0, 0]]]) / det
        F = (dr.T @ dr0) @ Ainv
        e = 0.5 * (F + F.T) - np.eye(2)
        exx[i], eyy[i], exy[i] = e[0, 0], e[1, 1], e[0, 1]
    dil = exx + eyy
    shear = np.sqrt(((exx - eyy) / 2) ** 2 + exy ** 2)
    return dil, shear, exx, eyy, exy


def selfcheck():
    """Uniform 2 % biaxial stretch and a pure shear must come back exactly."""
    a = 2.46
    pts = []
    for i in range(-6, 7):
        for j in range(-6, 7):
            R = np.array([a * i + a / 2 * j, a * np.sqrt(3) / 2 * j])
            pts.append(R)
            pts.append(R + np.array([a / 2, a / (2 * np.sqrt(3))]))
    ref = np.array(pts)

    cur = ref * 1.02
    dil, sh, exx, eyy, exy = atomic_strain(ref, cur)
    m = ~np.isnan(dil)
    assert abs(np.nanmedian(dil[m]) - 0.04) < 1e-9, np.nanmedian(dil[m])
    assert np.nanmax(np.abs(sh[m])) < 1e-9
    print("  biaxial 2%%: dilatation %.6f (expect 0.04), shear %.2e"
          % (np.nanmedian(dil[m]), np.nanmax(np.abs(sh[m]))))

    g = 0.03
    S = np.array([[1.0, g], [g, 1.0]])
    cur2 = ref @ S.T
    dil2, sh2, *_ = atomic_strain(ref, cur2)
    m2 = ~np.isnan(dil2)
    assert abs(np.nanmedian(dil2[m2])) < 1e-9
    assert abs(np.nanmedian(sh2[m2]) - g) < 1e-9, np.nanmedian(sh2[m2])
    print("  pure shear %.2f: dilatation %.2e, shear %.6f (expect %.2f)"
          % (g, np.nanmedian(dil2[m2]), np.nanmedian(sh2[m2]), g))
    print("  strain selfcheck ok")


if __name__ == "__main__":
    selfcheck()
