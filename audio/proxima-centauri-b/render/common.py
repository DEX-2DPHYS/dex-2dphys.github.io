"""Shared synthesis and analysis machinery for the two artefact reconstructions.

Everything here is ordinary DSP: an additive engine that takes a ladder of
frequencies and a control-rate amplitude surface, plus the measurements the
field findings quote (spectral centroid, ladder overlap, distance to the
nearest harmonic series) so the demos can be checked against the report
rather than merely described by it.
"""

import numpy as np

SR = 44100
HOP = 256                      # control rate: 172.3 Hz


def frames_for(seconds, sr=SR, hop=HOP):
    return int(np.ceil(seconds * sr / hop)) + 1


def upsample(ctrl, n, hop=HOP):
    """Linear interpolation from control rate to sample rate."""
    t = np.arange(n) / hop
    i0 = np.clip(t.astype(np.int64), 0, len(ctrl) - 1)
    i1 = np.clip(i0 + 1, 0, len(ctrl) - 1)
    f = t - i0
    return ctrl[i0] * (1.0 - f) + ctrl[i1] * f


def additive(freqs, amps, n, sr=SR, hop=HOP, detune=None, phases=None):
    """Sum sinusoids.

    freqs  (M,)      base frequency of each mode, Hz
    amps   (M, F)    control-rate amplitude of each mode
    detune (M, F)    optional multiplicative frequency envelope (glide, phason
                     drift, the permanent alteration); 1.0 means "hold still"
    """
    freqs = np.asarray(freqs, dtype=np.float64)
    amps = np.asarray(amps, dtype=np.float64)
    m = len(freqs)
    if phases is None:
        # A ladder struck with every partial in phase is an impulse, not a
        # body: the crest is enormous and nothing else can be heard past it.
        # The phases are drawn from the ladder itself, so they are fixed for a
        # given object and scattered across it.
        phases = np.mod(np.cumsum(np.sqrt(np.abs(freqs) + 1.0)) * 2.399963, 2 * np.pi)
    out = np.zeros(n)
    for k in range(m):
        a = upsample(amps[k], n, hop)
        if a.max() < 1e-6:
            continue
        if detune is None:
            ph = 2 * np.pi * freqs[k] * np.arange(n) / sr + phases[k]
        else:
            f = freqs[k] * upsample(detune[k], n, hop)
            ph = 2 * np.pi * np.cumsum(f) / sr + phases[k]
        out += a * np.sin(ph)
    return out


# ---------------------------------------------------------------- envelopes

def strike_env(frames, onset_frame, decay_rates, hold=0.0, attack_ms=7.0,
               hop=HOP, sr=SR):
    """Per-mode exponential decay starting at onset_frame.

    decay_rates (M,) in nepers/second. hold adds a sustained floor. ONSET -
    how quickly force is applied - keeps the disturbance from being an
    impulse, which is the difference between a body answering and a click.
    """
    dt = hop / sr
    t = (np.arange(frames) - onset_frame) * dt
    t = np.maximum(t, 0.0)
    live = (np.arange(frames) >= onset_frame).astype(float)
    env = np.exp(-np.outer(decay_rates, t))
    env = env * live
    if attack_ms > 0:
        a = np.clip(t / (attack_ms / 1000.0), 0.0, 1.0)
        env = env * (a * a * (3 - 2 * a))[None, :]
    if hold > 0:
        env = env * (1 - hold) + hold * live
    return env


def redistribute(inject, decay, rate, bias, hop=HOP, sr=SR):
    """Energy leaves the mode it was put into and enters its ladder neighbours.

    A one-dimensional diffusion along the ordered mode ladder, run on energy
    rather than amplitude, with `bias` tipping the flow downward.  At rate 0
    this reduces exactly to the ordinary thing an instrument of ours does:
    each mode decays where it stands.  Turned up, the object stops losing the
    energy and starts moving it, and a sustained sound becomes the object
    exploring itself.

    inject  (M, F)   energy delivered to each mode in each frame
    decay   (M,)     per-frame energy retention, 0 < d <= 1
    """
    m, f = inject.shape
    dt = hop / sr
    step = float(np.clip(rate * dt, 0.0, 0.24))
    e = np.zeros((m, f))
    cur = np.zeros(m)
    for j in range(f):
        cur = cur * decay
        if step > 0:
            up = np.roll(cur, -1); up[-1] = cur[-1]
            dn = np.roll(cur, 1); dn[0] = cur[0]
            # positive bias tips the flow downward: the centre of the sound's
            # energy travels towards the bottom of the ladder as it goes
            cur = np.maximum(cur + step * ((1 + bias) * up
                                           + (1 - bias) * dn - 2 * cur), 0.0)
        cur = cur + inject[:, j]
        e[:, j] = cur
    return np.sqrt(e)


# ---------------------------------------------------------------- the frame

def cavity(x, amount, colour, sr=SR):
    """CAVITY - how much every note hears the others in the one body.

    Four short coprime delays with a shared feedback path, low-passed by
    CAVITY COLOUR.  Cheap, and it is honestly what the frame does: it puts the
    body's own output back in front of it.
    """
    if amount <= 0:
        return x
    out = x.copy()
    lp = 0.12 + 0.80 * colour
    for t, g in ((0.0231, 0.58), (0.0311, 0.49), (0.0437, 0.41), (0.0591, 0.34)):
        d = int(sr * t)
        gg = g * amount
        y = np.zeros(len(out) + d)
        y[:len(out)] = out
        # single-pole smoothed feedback, applied in d-sample strides
        for start in range(d, len(y), d):
            end = min(start + d, len(y))
            seg = y[start - d:start - d + (end - start)]
            sm = np.empty_like(seg)
            s = 0.0
            for i in range(len(seg)):
                s += lp * (seg[i] - s)
                sm[i] = s
            y[start:end] += gg * sm
        out = y[:len(out)]
    return out


def ceiling(x, amount):
    """CEILING - the soft limit the artefact will not exceed."""
    k = 1.0 + 6.0 * amount
    return np.tanh(k * x) / np.tanh(k)


def air(x, amount, sr=SR):
    """AIR - top-end lift on the way out."""
    if amount <= 0:
        return x
    from scipy.signal import lfilter
    a = np.exp(-2 * np.pi * 4200.0 / sr)
    lo = lfilter([1 - a], [1, -a], x)
    return x + amount * 1.4 * (x - lo)


def declick(x, ms=6.0, sr=SR):
    n = int(sr * ms / 1000)
    w = np.ones(len(x))
    r = np.linspace(0, 1, n)
    w[:n] = r
    w[-n:] = r[::-1]
    return x * w


def centroid(x, sr=SR):
    w = np.hanning(len(x))
    X = np.abs(np.fft.rfft(x * w))
    f = np.fft.rfftfreq(len(x), 1 / sr)
    p = X ** 2
    return float((f * p).sum() / max(p.sum(), 1e-30))


def harmonicity(freqs, lo=None, hi=None, steps=3000, weights=None):
    """Mean cents from the nearest harmonic series, minimised over f0.

    The report's floor: no B2311.22 specimen anywhere in the catalogue comes
    within twenty cents.  A strained B2311.67 gets inside a fifth of a cent.
    Returns (cents, best_f0).
    """
    f = np.asarray(freqs, dtype=float)
    w = np.ones_like(f) if weights is None else np.asarray(weights, float)
    m = f > 0
    f, w = f[m], w[m]
    # The candidate fundamental has to be one a harmonic series could
    # plausibly have.  Let it go arbitrarily low and the comb becomes so dense
    # that every ladder scores well and the measure says nothing, so the
    # highest harmonic number is capped at 24 and the fundamental at a quarter
    # of the lowest partial - whichever binds first.
    if lo is None:
        lo = max(f.min() / 4.0, f.max() / 24.0)
    if hi is None:
        hi = max(lo * 1.001, f.min() * 1.02)
    w = w / max(w.sum(), 1e-30)
    f0s = np.geomspace(lo, hi, steps)
    n = np.maximum(np.round(f[None, :] / f0s[:, None]), 1.0)
    c = np.abs(1200 * np.log2(f[None, :] / (n * f0s[:, None])))
    d = c @ w
    i = int(np.argmin(d))
    return float(d[i]), float(f0s[i])


def push_off_harmonic(freqs, floor_cents=20.0, rounds=24, n_low=16):
    """Enforce the catalogue floor: no nearer than twenty cents, and no nearer.

    Pushing partials off one candidate series exposes another, so this repeats
    until the best-fitting harmonic series anywhere is at least the floor away.
    The report's phrasing is precise about the result: the closest approach
    found in the catalogue lands exactly on the floor and no nearer.
    """
    f = np.sort(np.array(freqs, dtype=float))
    k = min(n_low, len(f))
    for _ in range(rounds):
        d, f0 = harmonicity(f[:k])
        if d >= floor_cents:
            break
        n = np.maximum(np.round(f / f0), 1.0)
        h = n * f0
        c = 1200 * np.log2(f / h)
        near = np.abs(c) < floor_cents * 1.15
        if not near.any():
            break
        sign = np.where(c >= 0, 1.0, -1.0)
        f[near] = h[near] * 2 ** (sign[near] * floor_cents * 1.15 / 1200.0)
        f = np.sort(f)
    return f


def ladder_overlap(a, b, sigma_cents=12.0):
    """KIN - how well two bodies can hear one another.

    Each mode of a absorbs at the frequencies it itself possesses; the
    overlap is the mean best match, in cents, run through a Gaussian.  An
    object against itself measures 1.000.
    """
    a = np.asarray(a, float)[:, None]
    b = np.asarray(b, float)[None, :]
    c = np.abs(1200 * np.log2(a / b))
    d = c.min(axis=1)
    return float(np.exp(-(d ** 2) / (2 * sigma_cents ** 2)).mean())


def stereo(l, r, sep=0.5):
    """SEPARATION - the distance between the two listening points."""
    m = 0.5 * (l + r)
    s = 0.5 * (l - r)
    return np.stack([m + sep * s, m - sep * s], axis=1)


def write_wav(path, y, sr=SR):
    import wave, struct
    y = np.clip(y, -1, 1)
    if y.ndim == 1:
        y = y[:, None]
    d = (y * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(y.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(d.tobytes())
