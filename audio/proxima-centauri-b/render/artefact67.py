"""B2311.67 - Sabik Terminator. A lattice that is ordered and never repeats.

The reconstruction builds the object the way the report describes it: a
regular four-dimensional array, met as a section.  The section is taken by
cut-and-project - a line through a square lattice at the eightfold slope,
with an acceptance window - which is the standard construction for an ordered
aperiodic body and the reason the lengths at which the structure repeats its
own logic come out as the Pell numbers 5, 12, 29, 70, 169, 408 and nothing
else.

What is heard is that chain of sites vibrating: masses on bonds, two bond
lengths in the silver ratio, solved exactly.  Its spectrum is neither a set of
separated tones nor a continuum but the third thing - a set with self-similar
gaps at every scale.  Nothing has to be done to make that happen; it is what
the geometry gives.

Frame quantities, off the plugin's own eight rosettes of five:

  EXTENT      how much of the body sounds - a Pell number of sites
  APERTURE    size of the acceptance window: how dense the matter
  RIM         how gradually matter leaves existence at the window
  CONTRAST    heavy-to-light mass ratio across the body
  BOND LAW    how much a short bond is stiffer than a long one
  OBLIQUITY   tilt of the cut against the lattice - the strain that crystallises
  CUT OFFSET  how far the sounding line is set from the centre
  CUT BEARING which way the sounding line lies across the body
  TRAVERSE    depth of the cut in w - the wheel drags the body through
  BEARING     the heading of travel within the unseen plane
  STATION     where along the cut a note enters the body
  WALK        how far up the body the keyboard walks
  INCIDENCE   broad and soft, or point and hard
  LOSS        how fast the body forgets
  LOSS TILT   how much more the top of the spectrum is lost
  STRAIN      stiffening under displacement
  ASPECT      direct space (the chain) against reciprocal (the star)
  ORDERS      how many diffraction orders are heard
  WINDOW      width of the conjugate window: which orders survive
  PRECESSION  standing drift in w - each order detunes by its shadow
  EXTINCTION  how fast a distant shadow is extinguished
  ORDER DECAY how much faster a high order dies
  TEMPERATURE how much the specimen's own wiring stirs it
  HABIT       which specimen: a colouring of the fourth dimension
"""

import numpy as np
import common as C

SILVER = 1.0 + np.sqrt(2.0)            # the ratio native to eightfold order
PELL = [5, 12, 29, 70, 169, 408]       # the lengths at which the logic repeats
SLOPE = 1.0 / SILVER                   # sqrt(2) - 1


def chain(extent=70, aperture=0.5, rim=0.25, cutpos=0.0, traverse=0.0,
          slope=SLOPE):
    """Cut and project: the sounding line through the lattice.

    Sites of the square lattice whose shadow in the unseen direction falls
    inside the acceptance window are present in the section.  TRAVERSE slides
    the window along that direction: nothing is created or destroyed, the
    lattice rearranges, and the result is equally ordered and equally
    non-repeating.
    """
    th = np.arctan(slope)
    ct, st = np.cos(th), np.sin(th)
    full = ct + st                                  # the perfect chain's window
    # the window never opens past the projected unit cell: beyond that the set
    # stops being a section of the lattice and starts being a different object
    W = full * (0.10 + 0.90 * aperture)
    r = max(int(extent * 1.6) + 24, 48)
    n1 = np.arange(-r, r + 1)
    n2 = np.arange(-r, r + 1)
    N1, N2 = np.meshgrid(n1, n2, indexing="ij")
    x = N1 * ct + N2 * st
    y = -N1 * st + N2 * ct
    c = cutpos * full + traverse * full
    inside = np.abs(y - c) < W / 2
    xs = x[inside]
    ys = y[inside] - c
    # a tilted cut lands several lattice sites on one place in our space;
    # they are one site of the chain, not two, and merging them is what makes
    # a strained body an ordinary crystal rather than a division by zero
    o = np.argsort(xs)
    xs, ys = xs[o], ys[o]
    keep = np.concatenate(([True], np.diff(xs) > 1e-9 * max(1.0, np.abs(xs).max())))
    xs, ys = xs[keep], ys[keep]
    c0 = int(np.argmin(np.abs(xs)))
    lo = max(0, min(c0 - extent // 2, len(xs) - extent))
    xs, ys = xs[lo:lo + extent], ys[lo:lo + extent]
    # RIM: matter does not vanish at the window edge, it thins out
    edge = 1.0 - np.abs(ys) / (W / 2)
    occ = np.clip(edge / max(rim, 1e-3), 0.0, 1.0) ** 0.5
    return xs, ys, occ, W


def dynamical(xs, ys, occ, contrast=0.5, bondlaw=0.5):
    """Masses on bonds - solved exactly.

    Two site types (heavy and light, told apart by their shadow) and two bond
    lengths in the silver ratio.  BOND LAW sets how much stiffer the short
    bond is; CONTRAST sets the mass ratio.  The eigenvalues of this are the
    thing the report calls a dust with self-similar gaps.
    """
    n = len(xs)
    d = np.diff(xs)
    p = 0.4 + 4.6 * bondlaw
    k = (d / max(d.min(), 1e-9)) ** (-p)
    ratio = 1.0 + 7.0 * contrast
    m = np.where(ys > 0, ratio, 1.0) * np.maximum(occ, 0.05)
    K = np.zeros((n, n))
    for i in range(n - 1):
        K[i, i] += k[i]; K[i + 1, i + 1] += k[i]
        K[i, i + 1] -= k[i]; K[i + 1, i] -= k[i]
    K[0, 0] += k[0]; K[-1, -1] += k[-1]            # the body is held at its ends
    s = 1.0 / np.sqrt(m)
    D = K * s[:, None] * s[None, :]
    w2, vec = np.linalg.eigh(D)
    w = np.sqrt(np.maximum(w2, 0.0))
    return w, vec


def ladder(extent=70, aperture=0.5, rim=0.25, contrast=0.5, bondlaw=0.5,
           cutpos=0.0, traverse=0.0, slope=SLOPE, top_hz=5200.0,
           max_modes=420, lo_hz=32.0):
    xs, ys, occ, W = chain(extent, aperture, rim, cutpos, traverse, slope)
    w, vec = dynamical(xs, ys, occ, contrast, bondlaw)
    if w.max() <= 0:
        return np.array([1.0]), np.ones((1, 1))
    f = top_hz * w / w.max()
    keep = f > lo_hz
    f, vec = f[keep], vec[:, keep]
    if f.size > max_modes:
        f, vec = f[:max_modes], vec[:, :max_modes]
    return f, vec


def excite(vec, station=0.5, incidence=0.6):
    """STATION - where along the cut a note enters the body.

    INCIDENCE runs from a point (hard, every mode with its own weight at that
    one site) to broad (soft, the disturbance averaged over a stretch).  The
    eigenvectors of an ordered aperiodic chain are critical rather than
    extended, which is why energy injected at one point spreads by a power law
    and arrives smeared.
    """
    n = vec.shape[0]
    j = int(np.clip(station, 0, 1) * (n - 1))
    width = max(1, int((1.0 - incidence) * n * 0.25))
    lo = max(0, j - width); hi = min(n, j + width + 1)
    a = np.abs(vec[lo:hi]).mean(axis=0)
    s = a.sum()
    return a / s if s > 0 else a


# ------------------------------------------------------------ the star voice

def star(orders=24, window=0.5, precession=0.0, extinction=0.35,
         slope=SLOPE, base_hz=196.0, span=9):
    """The visible structure: reciprocal space, not the chain.

    The Bragg module of a cut-and-project set is indexed by two integers, and
    each order carries a shadow in the unseen direction.  The conjugate window
    decides which orders survive; PRECESSION detunes each by its own shadow,
    so the figure drifts without anything moving in our space.  This voice is
    struck, rings and dies - it is not the one that persists.
    """
    th = np.arctan(slope)
    ct, st = np.cos(th), np.sin(th)
    h = np.arange(-span, span + 1)
    H, K = np.meshgrid(h, h, indexing="ij")
    qp = (H * ct + K * st).ravel()
    qs = (-H * st + K * ct).ravel()
    good = qp > 1e-6
    qp, qs = qp[good], qs[good]
    Wd = 0.4 + 3.6 * window
    u = Wd * qs
    I = np.where(np.abs(u) < 1e-9, 1.0, (np.sin(u) / np.where(u == 0, 1, u)) ** 2)
    I = I * np.exp(-(2.0 + 14.0 * extinction) * np.abs(qs))
    o = np.argsort(I)[::-1][:max(2, int(orders))]
    qp, qs, I = qp[o], qs[o], I[o]
    f = base_hz * qp * (1.0 + precession * 0.06 * qs)
    ok = (f > 30) & (f < 16000)
    f, I, qs = f[ok], I[ok], qs[ok]
    s = I.sum()
    return f, (I / s if s > 0 else I), qs


# ------------------------------------------------------------------ voicing

def voice(freqs, amps, seconds, loss=0.45, loss_tilt=0.5, onset=0.0,
          hold=0.0, sustain=0.0, drift=None, sr=C.SR):
    n = int(seconds * sr)
    fr = C.frames_for(seconds)
    f = np.asarray(freqs, float)
    base = 0.35 + 7.0 * loss
    rates = base * (1.0 + (0.4 + 5.0 * loss_tilt) * (f / max(f.min(), 1e-9)) ** 0.35)
    env = C.strike_env(fr, int(onset * sr / C.HOP), rates, hold=sustain)
    env = env * np.asarray(amps, float)[:, None]
    return C.additive(f, env, n, detune=drift)


def strain_stiffen(x, amount):
    """STRAIN - stiffening under displacement; the body bends hard."""
    if amount <= 0:
        return x
    k = 1.0 + 9.0 * amount
    return np.sign(x) * (np.abs(x) + k * 0.35 * np.abs(x) ** 3) / (1.0 + k * 0.35)


# ------------------------------------------------------------- the couplings

FRAME_QUANTITIES = {"aperture", "cutpos", "cutang", "tilt4", "traverse",
                    "bearing"}
NEVER_DRIVEN = {"level", "ref", "habit", "extent"}

# the table the report prints: depth of stir against temperature
TEMP_TABLE = [(77.0, 0.0000, 0.00),
              (293.0, 0.0896, 0.00),
              (500.0, 0.1900, 0.00),
              (800.0, 0.3000, 0.12)]


def temp_depth(kelvin):
    ks = [t[0] for t in TEMP_TABLE]
    mat = np.interp(kelvin, ks, [t[1] for t in TEMP_TABLE])
    frm = np.interp(kelvin, ks, [t[2] for t in TEMP_TABLE])
    return float(mat), float(frm)


class Wiring:
    """The specimen's own arrangement: fixed, one-way, and never a loop.

    Four quantities are connected outward, each to two or three others.  All
    256 arrangements differ, each is fixed to its specimen, and no connection
    has ever been observed to read back what it wrote.
    """

    def __init__(self, habit, names, seed_salt=6700):
        rng = np.random.default_rng(seed_salt + int(habit))
        order = list(names)
        rng.shuffle(order)                       # a topological order: no loops
        sources = order[:4]
        self.edges = []
        for i, s in enumerate(sources):
            downstream = [n for n in order[order.index(s) + 1:]
                          if n not in NEVER_DRIVEN]
            if not downstream:
                continue
            k = min(len(downstream), int(rng.integers(2, 4)))
            for t in rng.choice(downstream, size=k, replace=False):
                self.edges.append({
                    "src": s, "dst": str(t),
                    "gain": float(rng.uniform(0.45, 1.0) * rng.choice([-1, 1])),
                    "rate": float(np.exp(rng.uniform(np.log(1 / 50), np.log(1 / 2)))),
                    "phase": float(rng.uniform(0, 2 * np.pi)),
                    "kind": "depth" if rng.random() < 0.6 else "rate",
                })
        self.sources = sources
        # 141 of 256 stir the frame at the top of the range; 115 hold it still
        self.stirs_frame = bool(rng.random() < 141 / 256)

    def apply(self, values, t, kelvin):
        """Move the quantities the way the wiring says, at this temperature."""
        mat, frm = temp_depth(kelvin)
        out = dict(values)
        for e in self.edges:
            base = values.get(e["src"], 0.5)
            lfo = np.sin(2 * np.pi * e["rate"] * t + e["phase"])
            depth = frm if e["dst"] in FRAME_QUANTITIES else mat
            if e["dst"] in FRAME_QUANTITIES and not self.stirs_frame:
                depth = 0.0
            d = e["gain"] * depth * (0.25 + 0.75 * base) * lfo
            out[e["dst"]] = float(np.clip(out.get(e["dst"], 0.5) + d, 0.0, 1.0))
        return out

    def describe(self):
        return [f"{e['src']} -> {e['dst']} "
                f"({'further' if e['kind'] == 'depth' else 'sooner'}, "
                f"1 cycle in {1 / e['rate']:.0f} s)" for e in self.edges]
