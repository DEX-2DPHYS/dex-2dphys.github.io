"""Registry (CSL-style) colouring, ported from graphene-md's computeRegistry().

The point of having it here: registry is a pure function of each sheet atom's
(x, y) against the SUBSTRATE's reciprocal lattice. It needs no substrate atoms
and nothing LAMMPS has to support -- so the identical function can be applied
to a DSW packed frame and to a LAMMPS dump, and the four engines become
directly comparable. Using the plugin's built-in values for three datasets and
something else for the fourth would not be a comparison.

Source: graphene-md/src/plugin.cpp, computeRegistry()
    g      = 4*pi / (sqrt(3) * aLatt)
    G_k    = g * (cos(pi/2 + 2*pi*k/3), sin(pi/2 + 2*pi*k/3)),  k = 0,1,2
    s_i    = sum_k cos(G_k . r_i)
    t_i    = clamp(1 - (s_i - SMIN)/(SMAX - SMIN), 0, 1) ** gamma
with SMIN = -1.5, SMAX = 3.0 (constants REG_SMIN / REG_SMAX).

t = 0 is AA-like (atom over atom, s at its maximum 3), t = 1 is the
worst-registry site. That is the plugin's own convention; keep it so colours
match the DSW panel.

The optional height damping (regHeightDamp) is deliberately NOT ported: it
needs the nearest substrate atom per sheet atom, the preset has it off, and it
only modulates opacity, not the registry value itself.
"""
import numpy as np

REG_SMIN = -1.5
REG_SMAX = 3.0
A_GRAPHENE = 2.46      # in-plane lattice constant, A (MatSpec.aLatt for graphene)


def registry(xy, a_latt=A_GRAPHENE, gamma=1.0):
    """Registry parameter t in [0, 1] for each sheet atom.

    xy : (N, 2) or (N, 3) array of positions in Angstrom; only x and y are used.
    """
    xy = np.asarray(xy, dtype=float)
    x, y = xy[:, 0], xy[:, 1]
    g = 4.0 * np.pi / (np.sqrt(3.0) * a_latt)
    s = np.zeros(len(x))
    for k in range(3):
        ang = np.pi / 2 + k * 2 * np.pi / 3
        s += np.cos(g * np.cos(ang) * x + g * np.sin(ang) * y)
    t = 1.0 - (s - REG_SMIN) / (REG_SMAX - REG_SMIN)
    np.clip(t, 0.0, 1.0, out=t)
    if gamma != 1.0:
        t = t ** gamma
    return t


def selfcheck():
    """A perfect AA stack sits at s = 3 exactly, i.e. t = 0."""
    t = registry(np.zeros((1, 2)))
    assert abs(t[0]) < 1e-12, t
    # A generic point should not be at either extreme.
    t2 = registry(np.array([[0.7, 1.3]]))
    assert 0.0 < t2[0] < 1.0, t2
    print("registry selfcheck ok: AA site t=%.3g, generic site t=%.3f" % (t[0], t2[0]))


if __name__ == "__main__":
    selfcheck()
