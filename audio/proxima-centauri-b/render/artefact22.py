"""B2311.22 - Kell Rille. A body whose sound is its own connectedness.

The reconstruction takes the report at its word and builds the object the way
it is described: a four-dimensional cloud of sites, of which only a slab is
present in the section; the sites that are present are joined to their
neighbours; and what is heard is that network of joins ringing.  The ladder is
therefore the square root of the spectrum of the graph Laplacian - which has
no octave in it and no harmonic ladder, because nothing put one there.

Frame quantities (the names are the expedition's, off the plugin's own rail):

  SPECIMEN     which body out of the catalogue
  WINCH        drags the four-dimensional body through the section
  DEPTH/SLAB   where the section is taken, and how thick it is
  APERTURE     how much of the body is admitted - the joining radius
  MEMBRANE     how much stiffer a short join is than a long one
  GRAVITY      draws the section back towards where it was
  METABOLISM   the rate at which energy leaves the mode it was put into
  REVIVAL      the configuration under which the output is exactly periodic
  WAKE         how long the body goes on after the hand has stopped
  WARMTH       spectral tilt of the excitation
  CONVERSE     open the vessel onto a second body
  OTHER        which second body
  COMMUNION    the strength of the exchange
  PLASTICITY   the rate of the permanent alteration
  SIDEREAL     walk the body's own intervals instead of ours
"""

import numpy as np
import common as C


class Body:
    """One catalogue specimen, sectioned."""

    def __init__(self, cat, n_sites=132, seed_salt=2311):
        self.cat = int(cat)
        rng = np.random.default_rng(seed_salt * 1000 + self.cat)
        # a four-dimensional body: sites in a 4-ball, not a shell
        p = rng.normal(size=(n_sites, 4))
        p /= np.linalg.norm(p, axis=1, keepdims=True)
        p *= rng.uniform(0, 1, (n_sites, 1)) ** 0.25
        self.sites = p
        self.rng = rng
        # every specimen has its own scale as well as its own shape - two of
        # them are never found sharing a lowest mode
        self.pitch = float(2.0 ** rng.uniform(-0.42, 0.42))

    # ---------------------------------------------------------------- section
    def section(self, depth=0.0, slab=0.34, aperture=0.55, membrane=0.5,
                max_modes=56):
        """Return (freqs, vectors, degree, present) for the current cut.

        Sites whose fourth coordinate lies inside the slab are present.  Move
        the section and a different part of the body is simply there: the
        ladder changes because the graph changes, not because anything was
        transposed.
        """
        w = self.sites[:, 3]
        present = np.abs(w - depth) < slab
        if present.sum() < 8:                       # never let it go silent
            present = np.argsort(np.abs(w - depth))[:8]
            m = np.zeros(len(w), bool); m[present] = True; present = m
        q = self.sites[present][:, :3]
        n = len(q)
        d = np.linalg.norm(q[:, None, :] - q[None, :, :], axis=2)
        np.fill_diagonal(d, np.inf)
        # APERTURE opens the joining radius; k-nearest keeps the body one body
        r = 0.16 + 0.42 * aperture
        adj = (d < r)
        k = min(2, n - 1)
        near = np.argsort(d, axis=1)[:, :k]
        for i in range(n):
            adj[i, near[i]] = True
        adj = adj | adj.T
        # MEMBRANE: a short join is stiffer than a long one
        p = 0.5 + 3.0 * membrane
        wgt = np.where(adj, 1.0 / np.maximum(d, 1e-3) ** p, 0.0)
        np.fill_diagonal(wgt, 0.0)
        deg = wgt.sum(axis=1)
        L = np.diag(deg) - wgt
        lam, vec = np.linalg.eigh(L)
        lam = np.maximum(lam, 0.0)
        keep = lam > 1e-9
        lam, vec = lam[keep], vec[:, keep]
        idx = np.argsort(lam)[:max_modes]
        lam, vec = lam[idx], vec[:, idx]
        f = np.sqrt(lam / lam[0])
        return f, vec, wgt.sum(axis=1), present

    # ---------------------------------------------------------------- ladder
    def ladder(self, f0=98.0, depth=0.0, slab=0.34, aperture=0.55,
               membrane=0.5, max_modes=56, floor_cents=20.0):
        f, vec, deg, present = self.section(depth, slab, aperture, membrane,
                                            max_modes)
        freqs = f0 * self.pitch * f
        freqs = freqs[freqs < 9000.0]
        vec = vec[:, :len(freqs)]
        # the catalogue floor, established across every specimen
        freqs = C.push_off_harmonic(freqs, floor_cents)
        return freqs, vec, deg


def touch(vec, deg, where="hub", spread=0.0, rng=None):
    """Where the body is disturbed.

    'hub'  the most connected site; 'rim' the most remote.  Disturbing the
    object at its most connected point versus its most remote gives, on the
    same body, two different voices.
    """
    if where == "hub":
        j = int(np.argmax(deg))
    elif where == "rim":
        j = int(np.argmin(deg))
    else:
        j = int(where)
    a = np.abs(vec[j])
    if spread > 0:                       # a broad press rather than a point
        rng = rng or np.random.default_rng(7)
        n = vec.shape[0]
        js = rng.choice(n, size=max(2, int(2 + spread * 8)), replace=False)
        a = np.abs(vec[js]).mean(axis=0)
    s = a.sum()
    return a / s if s > 0 else a


def revive(freqs, period, loose=0.15):
    """REVIVAL - the configuration under which recurrence is exact.

    Every partial is pulled onto a common comb of 1/period, so every detail of
    the sound reassembles itself after `period` seconds and not approximately.
    The pull is not total: the report measures the reassembly at 0.997, not 1.
    """
    f = np.asarray(freqs, float)
    if period <= 0:
        return f
    g = 1.0 / period
    out = np.maximum(np.round(f / g), 1.0) * g
    # not everything comes onto the comb: the top of the ladder is left off it,
    # which is what makes the interval between recurrences audible as
    # fractional states rather than silence, and is why the measured
    # reassembly is 0.997 and not 1
    k = int(np.ceil(loose * len(f)))
    if k > 0:
        out[-k:] = f[-k:]
    return out


def voice(freqs, amps0, seconds, wake=0.5, warmth=0.5, meta=0.0,
          meta_bias=0.60, onset=0.0, hold=0.0, focus=0.0, focus_at=0.30,
          detune=None, sr=C.SR):
    """One disturbance, rendered.

    `focus` narrows the disturbance onto a short stretch of the ladder, which
    is what makes the redistribution audible rather than merely measurable:
    energy put into a few modes does not stay in them.
    """
    n = int(seconds * sr)
    fr = C.frames_for(seconds)
    f = np.asarray(freqs, float)
    # WAKE sets the base loss; the top of the spectrum is always lost faster
    base = 0.10 + 4.2 * (1.0 - wake) ** 2
    tilt = 0.30 + 2.2 * (1.0 - warmth)
    rates = base * (1.0 + tilt * ((f / f[0]) ** 0.55 - 1.0))
    a = amps0 * (f / f[0]) ** (-0.55 + 1.1 * warmth)
    if focus > 0:
        k = np.arange(len(f))
        c = focus_at * (len(f) - 1)
        w = max(1.0, (1.0 - focus) * len(f) * 0.45)
        a = a * np.exp(-0.5 * ((k - c) / w) ** 2)
        a = a / max(a.sum(), 1e-30) * max(amps0.sum(), 1e-30)
    dt = C.HOP / sr
    j0 = int(onset * sr / C.HOP)
    inject = np.zeros((len(f), fr))
    if j0 < fr:
        # the disturbance, applied over a few frames rather than in one: a
        # hand, not an impulse
        ramp = np.array([0.28, 0.42, 0.22, 0.08])
        for i, g in enumerate(ramp):
            if j0 + i < fr:
                inject[:, j0 + i] = (a ** 2) * g
        if hold > 0:                                 # a press, held
            inject[:, j0:] += (hold * a ** 2 * 2.0 * dt * rates)[:, None]
    decay = np.exp(-2.0 * rates * dt)
    env = C.redistribute(inject, decay, meta * 2.5, meta_bias)
    return C.additive(f, env, n, detune=detune)


# ------------------------------------------------------------------ the pair

def converse(a_freqs, a_amps, b_freqs, seconds, kin, commune=0.6,
             sigma_cents=12.0):
    """The second body's reply, and the third set of frequencies.

    It absorbs only at the frequencies it itself possesses, so what it hears
    is a fixed property of the pair.  It answers in its own frequencies: the
    shape of what it heard, re-spoken through a different anatomy.  While both
    sound, sum and difference tones appear that belong to neither and cannot
    be produced by either alone.
    """
    a = np.asarray(a_freqs, float)
    b = np.asarray(b_freqs, float)
    cents = np.abs(1200 * np.log2(b[:, None] / a[None, :]))
    wgt = np.exp(-(cents ** 2) / (2 * sigma_cents ** 2))
    heard = wgt @ np.asarray(a_amps, float)
    s = heard.sum()
    if s > 0:
        heard = heard / s
    reply = heard * (0.30 + 1.5 * commune) * kin
    # the third set: only while both are sounding, roughly a sixth of the sound
    ia = np.argsort(a_amps)[::-1][:6]
    ib = np.argsort(reply)[::-1][:6]
    third_f, third_a = [], []
    for i in ia:
        for j in ib:
            for f in (a[i] + b[j], abs(a[i] - b[j])):
                if 35.0 < f < 9000.0:
                    third_f.append(f)
                    third_a.append(a_amps[i] * reply[j])
    third_f = np.array(third_f)
    third_a = np.array(third_a)
    if third_a.sum() > 0:
        third_a *= (0.166 * (a_amps.sum() + reply.sum())) / third_a.sum()
    return reply, third_f, third_a


def plasticity_track(b_freqs, a_freqs, frames, total_cents=53.9, steps=19):
    """The finding the survey cannot account for.

    Being spoken to changes the listener - not its behaviour, its structure.
    The responding body's own frequencies move towards what it heard, in
    discrete steps applied while the object is at rest, and they do not move
    back.
    """
    b = np.asarray(b_freqs, float)
    a = np.asarray(a_freqs, float)
    nearest = a[np.argmin(np.abs(1200 * np.log2(b[:, None] / a[None, :])), axis=1)]
    direction = np.sign(1200 * np.log2(nearest / b))
    stair = np.floor(np.linspace(0, steps, frames)) / steps
    cents = direction[:, None] * (total_cents * stair)[None, :]
    return 2 ** (cents / 1200.0), float(total_cents)


def spectral_difference(a, b):
    """Total-variation distance between two normalised excitation spectra."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    a = a / max(a.sum(), 1e-30); b = b / max(b.sum(), 1e-30)
    return float(0.5 * np.abs(a - b).sum())
