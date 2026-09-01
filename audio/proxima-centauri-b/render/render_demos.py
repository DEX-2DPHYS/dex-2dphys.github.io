#!/usr/bin/env python3
"""Render the ten field demonstrations.

Five for each recovered object, thirty seconds each, five sounds per demo,
and in every one of them something on the frame is moved rather than set.
The report is explicit that this is the only method that found anything:
"nothing about them will be found by setting a quantity to a value and
leaving it there, any more than a language is found by holding one note."

Every number printed in the log is measured off the rendered audio or the
rendered ladder, not asserted.
"""

import json
import os
import sys

import numpy as np

import common as C
import artefact22 as A22
import artefact67 as A67

SR = C.SR
SEC = 6.0                     # five sounds of six seconds each
TAIL = 0.4                    # rendered past the slot, for the crossfade
SECR = SEC + TAIL             # what each section actually renders
OUT = os.path.join(os.path.dirname(__file__), "..", "demos")
NOTES = []                    # measurement log, written out as JSON


def note(demo, section, **kw):
    NOTES.append(dict(demo=demo, section=section, **kw))
    bits = "  ".join(f"{k}={v}" for k, v in kw.items())
    print(f"    [{section}] {bits}")


def _rms(x):
    return float(np.sqrt(np.mean(np.asarray(x, float) ** 2)) + 1e-12)


def assemble(sections, xfade=0.4, trim_db=10.0):
    """Five six-second sections, crossfaded, thirty seconds exactly.

    Each section is rendered a little longer than its slot so the tail of one
    can overlap the head of the next without stealing time from either.
    """
    n = int(SEC * SR)
    x = int(xfade * SR)
    total = n * len(sections)
    out = np.zeros((total + x, 2))
    # The frame's GAIN, set once per observation.  Five sounds meant to be
    # compared have to arrive at comparable loudness, so each section is
    # trimmed towards the median of the five - by no more than trim_db, which
    # leaves the differences that are the point of the demonstration intact.
    levels = np.array([_rms(np.asarray(s)[:n]) for s in sections])
    target = float(np.median(levels))
    gains = np.clip(target / levels, 10 ** (-trim_db / 20), 10 ** (trim_db / 20))
    for i, s in enumerate(sections):
        s = np.asarray(s) * gains[i]
        if s.ndim == 1:
            s = np.stack([s, s], axis=1)
        s = s[:n + x]
        if len(s) < n + x:
            s = np.pad(s, ((0, n + x - len(s)), (0, 0)))
        w = np.ones((n + x, 1))
        r = (np.linspace(0, 1, x) ** 0.5)[:, None]
        if i > 0:
            w[:x] = r
        w[-x:] = r[::-1]
        out[i * n:i * n + n + x] += s * w
    return out[:total]


def finish(y, ceiling_amt=0.45, air_amt=0.25, cav=0.0, cavcol=0.5):
    """The last of the frame: cavity, ceiling, air."""
    if cav > 0:
        y = np.stack([C.cavity(y[:, 0], cav, cavcol),
                      C.cavity(y[:, 1], cav, cavcol)], axis=1)
    # CEILING is what makes an object with a 30 dB crest listenable at all.
    # It is driven at a fixed level so it does the same amount of work on
    # every demo rather than a different amount on each.
    y = y * (1.9 / max(float(np.max(np.abs(y))), 1e-12))
    y = C.ceiling(y, ceiling_amt)
    y = np.stack([C.air(y[:, 0], air_amt), C.air(y[:, 1], air_amt)],
                 axis=1)
    y = np.stack([C.declick(y[:, 0]), C.declick(y[:, 1])], axis=1)
    # land every demo at the same programme level, then keep the peak safe
    y = y * (10 ** (-14.0 / 20) / _rms(y))
    p = float(np.max(np.abs(y)))
    if p > 0.89:
        y = y * (0.89 / p)
    return y


# =====================================================================  B2311.22

def b22_note(body, f0, depth, slab, aperture, membrane, where, seconds,
             wake=0.5, warmth=0.5, meta=0.0, hold=0.0, spread=0.0,
             onset=0.0, revival=0.0, focus=0.0, focus_at=0.30, gain=1.0,
             cache={}):
    key = (body.cat, round(depth, 4), round(slab, 4), round(aperture, 4),
           round(membrane, 4))
    if key not in cache:
        cache[key] = body.ladder(f0=98.0, depth=depth, slab=slab,
                                 aperture=aperture, membrane=membrane)
    freqs, vec, deg = cache[key]
    freqs = freqs * (f0 / 98.0)
    if revival > 0:
        freqs = A22.revive(freqs, revival)
    a = A22.touch(vec, deg, where, spread=spread)
    y = A22.voice(freqs, a, seconds, wake=wake, warmth=warmth, meta=meta,
                  onset=onset, hold=hold, focus=focus, focus_at=focus_at)
    return gain * y, freqs, a


def demo_22_01():
    """Where it is touched. The same body, five contacts."""
    d = "B2311-22-01"
    print(f"  {d}  the same body, five contacts")
    body = A22.Body(37)
    freqs, vec, deg = body.ladder()
    hub, rim = A22.touch(vec, deg, "hub"), A22.touch(vec, deg, "rim")
    note(d, "catalogue", specimen="037", modes=len(freqs),
         ladder_hz=f"{freqs[0]:.1f}-{freqs[-1]:.1f}",
         cents_from_harmonic=round(C.harmonicity(freqs[:16])[0], 1),
         hub_rim_spectral_difference=round(A22.spectral_difference(hub, rim), 3))

    secs = []
    plan = [("the most connected site", dict(where="hub", spread=0.0)),
            ("the most remote site", dict(where="rim", spread=0.0)),
            ("a still press, held and deepening", dict(where="hub", spread=0.8,
                                                       hold=0.34, wake=0.85)),
            ("a circling contact - it accumulates", dict(where="hub", spread=0.4)),
            ("a fast straight stroke, then relaxed", dict(where="rim", wake=0.12))]
    for i, (label, kw) in enumerate(plan):
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        if i == 3:                                   # the circling contact
            onsets = np.arange(0.0, SEC - 0.6, 0.62)
            for j, t in enumerate(onsets):
                w = int(np.argsort(deg)[::-1][j % 6])
                for c in (0, 1):
                    y, _, _ = b22_note(body, 98.0, 0.0, 0.34, 0.55, 0.5, w,
                                       SECR, wake=0.55, warmth=0.4 + 0.02 * j,
                                       onset=t, spread=0.1 * c,
                                       gain=0.28 + 0.06 * j)
                    ch[c] += y
        else:
            onsets = [0.05, 2.3, 4.2] if i != 2 else [0.05]
            for t in onsets:
                for c in (0, 1):
                    y, _, _ = b22_note(body, 98.0, 0.0, 0.34, 0.55, 0.5,
                                       kw["where"] if c == 0 else
                                       ("rim" if kw["where"] == "hub" else "hub"),
                                       SECR, wake=kw.get("wake", 0.5),
                                       warmth=0.5, hold=kw.get("hold", 0.0),
                                       spread=kw.get("spread", 0.0), onset=t,
                                       gain=0.9)
                    ch[c] += y
        note(d, label, centroid_hz=round(C.centroid(ch[0]), 1))
        secs.append(C.stereo(ch[0], ch[1], 0.55))
    return finish(assemble(secs), cav=0.28, cavcol=0.45)


def demo_22_02():
    """Energy does not stay where it is put. METABOLISM 0 to 1."""
    d = "B2311-22-02"
    print(f"  {d}  METABOLISM: one disturbance, five rates of redistribution")
    body = A22.Body(112)
    secs = []
    for m in (0.0, 0.25, 0.5, 0.75, 1.0):
        ch = []
        for c, where in ((0, "hub"), (1, "rim")):
            y, freqs, a = b22_note(body, 110.0, 0.0, 0.36, 0.5, 0.45, where,
                                   SECR, wake=0.93, warmth=0.45, meta=m,
                                   hold=0.0, focus=0.90, focus_at=0.34)
            ch.append(y)
        head = C.centroid(ch[0][int(0.7 * SR):int(1.5 * SR)])
        tail = C.centroid(ch[0][int(4.4 * SR):int(5.2 * SR)])
        r0 = float(np.sqrt((ch[0][int(0.7 * SR):int(1.5 * SR)] ** 2).mean()))
        r1 = float(np.sqrt((ch[0][int(4.4 * SR):int(5.2 * SR)] ** 2).mean()))
        note(d, f"metabolism {m:.2f}", centroid_at_1s_hz=round(head, 1),
             centroid_at_4s8_hz=round(tail, 1),
             travelled_hz=round(head - tail, 1),
             still_sounding_dB=round(20 * np.log10(max(r1, 1e-12) / max(r0, 1e-12)), 1))
        secs.append(C.stereo(ch[0], ch[1], 0.6))
    return finish(assemble(secs), cav=0.34, cavcol=0.4)


def demo_22_03():
    """Exact recurrence. Five revival periods."""
    d = "B2311-22-03"
    print(f"  {d}  REVIVAL: the configuration under which recurrence is exact")
    body = A22.Body(84)
    secs = []
    for T in (4.0, 3.0, 2.4, 1.9, 1.5):
        ch = []
        for c, where in ((0, "hub"), (1, "rim")):
            y, freqs, a = b22_note(body, 104.0, 0.06, 0.36, 0.55, 0.5, where,
                                   SECR, wake=0.97, warmth=0.5, hold=0.55,
                                   revival=T)
            ch.append(y)
        x = ch[0][int(0.6 * SR):]
        lag = int(T * SR)
        if len(x) > lag + SR:
            a1 = x[:len(x) - lag]
            a2 = x[lag:]
            r = float(np.corrcoef(a1, a2)[0, 1])
        else:
            r = float("nan")
        note(d, f"period {T:.1f} s", reassembly_correlation=round(r, 3))
        secs.append(C.stereo(ch[0], ch[1], 0.5))
    return finish(assemble(secs), cav=0.22, cavcol=0.55)


def demo_22_04():
    """The second body. Five partners, from itself to the least related."""
    d = "B2311-22-04"
    print(f"  {d}  CONVERSE: five partners across the catalogue")
    a_body = A22.Body(37)
    af, av, ad = a_body.ladder()
    cands = [(c, C.ladder_overlap(af, A22.Body(c).ladder()[0]))
             for c in range(0, 256, 7)]
    cands.sort(key=lambda t: -t[1])
    picks = [37, cands[1][0], cands[len(cands) // 3][0],
             cands[2 * len(cands) // 3][0], cands[-1][0]]
    secs = []
    for other in picks:
        b_body = A22.Body(other)
        bf, bv, bd = b_body.ladder()
        kin = C.ladder_overlap(af, bf)
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        for t in (0.05, 2.1, 4.0):
            a_amp = A22.touch(av, ad, "hub")
            reply, tf, ta = A22.converse(af, a_amp, bf, SECR, kin, commune=0.65)
            for c in (0, 1):
                utter, _, _ = b22_note(a_body, 98.0, 0.0, 0.34, 0.55, 0.5,
                                       "hub" if c == 0 else "rim", SECR,
                                       wake=0.6, warmth=0.45 + 0.15 * c, onset=t)
                ch[c] += 0.85 * utter
                ch[c] += 0.9 * A22.voice(bf, reply, SECR, wake=0.75,
                                         warmth=0.5, onset=t + 0.22)
                if len(tf):
                    ch[c] += 0.55 * A22.voice(tf, ta, SECR, wake=0.35,
                                              warmth=0.7, onset=t + 0.30)
        third = float(ta.sum() / max(a_amp.sum() + reply.sum(), 1e-9))
        note(d, f"other {other:03d}", kin=round(kin, 3),
             reply_strength=round(float(reply.sum()), 3),
             third_set_share=round(third, 3))
        secs.append(C.stereo(ch[0], ch[1], 0.65))
    return finish(assemble(secs), cav=0.3, cavcol=0.5)


def demo_22_05():
    """The permanent alteration. Before, during, and after."""
    d = "B2311-22-05"
    print(f"  {d}  PLASTICITY: thirty seconds of exchange, and what is left")
    a_body, b_body = A22.Body(37), A22.Body(150)
    af, av, ad = a_body.ladder()
    bf, bv, bd = b_body.ladder()
    kin = C.ladder_overlap(af, bf)
    fr = C.frames_for(SECR)
    a_amp = A22.touch(av, ad, "hub")
    reply, tf, ta = A22.converse(af, a_amp, bf, SECR, kin, commune=0.7)
    b_amp = A22.touch(bv, bd, "hub")

    # nineteen discrete steps spread over the three exchange sections
    total_fr = fr * 3
    full, cents = A22.plasticity_track(bf, af, total_fr)
    secs, labels = [], []

    def sound_b(det, amps, gain=1.0):
        return gain * A22.voice(bf, amps, SECR, wake=0.8, warmth=0.5, detune=det)

    # 1 - the responding body alone, as catalogued
    ch = [sound_b(None, b_amp), sound_b(None, A22.touch(bv, bd, "rim"))]
    note(d, "before - body 150 as catalogued",
         cents_from_catalogue=0.0,
         centroid_hz=round(C.centroid(ch[0]), 1))
    secs.append(C.stereo(ch[0], ch[1], 0.5))

    for k in range(3):
        det = full[:, k * fr:(k + 1) * fr]
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        for t in (0.05, 2.0, 4.0):
            for c in (0, 1):
                u, _, _ = b22_note(a_body, 98.0, 0.0, 0.34, 0.55, 0.5,
                                   "hub" if c == 0 else "rim", SECR,
                                   wake=0.55, onset=t)
                ch[c] += 0.8 * u
                ch[c] += 0.95 * A22.voice(bf, reply, SECR, wake=0.8, warmth=0.5,
                                          onset=t + 0.2, detune=det)
                if len(tf):
                    ch[c] += 0.5 * A22.voice(tf, ta, SECR, wake=0.35,
                                             warmth=0.7, onset=t + 0.28)
        steps = int(np.unique(np.round(det, 9), axis=1).shape[1])
        note(d, f"exchange {k + 1} of 3",
             cents_displaced_so_far=round(
                 float(np.abs(1200 * np.log2(det[:, -1])).mean()), 2),
             discrete_steps_this_section=steps)
        secs.append(C.stereo(ch[0], ch[1], 0.62))

    det_end = np.repeat(full[:, -1:], fr, axis=1)
    ch = [sound_b(det_end, b_amp), sound_b(det_end, A22.touch(bv, bd, "rim"))]
    moved_cents = float(np.abs(1200 * np.log2(full[:, -1])).mean())
    note(d, "after - the same body, at rest",
         cents_from_catalogue=round(moved_cents, 1),
         discrete_steps=int(np.unique(np.round(full, 9), axis=1).shape[1]) - 1,
         kin_to_its_own_catalogue_entry=round(
             C.ladder_overlap(bf * full[:, -1], bf), 3),
         centroid_hz=round(C.centroid(ch[0]), 1), reversible="no")
    secs.append(C.stereo(ch[0], ch[1], 0.5))
    return finish(assemble(secs), cav=0.3, cavcol=0.5)


# =====================================================================  B2311.67

def b67_note(seconds, extent=70, aperture=0.5, rim=0.25, contrast=0.5,
             bondlaw=0.5, slope=A67.SLOPE, cutpos=0.0, traverse=0.0,
             station=0.5, incidence=0.6, loss=0.45, loss_tilt=0.5,
             sustain=0.06, onset=0.0, top_hz=5200.0, transpose=1.0,
             blend=0.0, orders=24, window=0.5, precession=0.0,
             extinction=0.35, order_decay=0.6, gain=1.0, max_render=150,
             cache={}):
    key = (extent, round(aperture, 4), round(rim, 4), round(contrast, 4),
           round(bondlaw, 4), round(slope, 8), round(cutpos, 4),
           round(traverse, 4), round(top_hz, 2))
    if key not in cache:
        cache[key] = A67.ladder(extent=extent, aperture=aperture, rim=rim,
                                contrast=contrast, bondlaw=bondlaw,
                                cutpos=cutpos, traverse=traverse, slope=slope,
                                top_hz=top_hz)
    freqs, vec = cache[key]
    a = A67.excite(vec, station, incidence)
    o = np.argsort(a)[::-1][:max_render]
    f, a = freqs[o] * transpose, a[o]
    y = np.zeros(int(seconds * SR))
    if blend < 1.0:
        y += (1.0 - blend) * A67.voice(f, a, seconds, loss=loss,
                                       loss_tilt=loss_tilt, onset=onset,
                                       sustain=sustain)
    if blend > 0.0:
        sf, si, sq = A67.star(orders=orders, window=window,
                             precession=precession, extinction=extinction)
        sf = sf * transpose
        rates = (0.8 + 9.0 * order_decay) * (1.0 + np.arange(len(sf)) * 0.12)
        env = C.strike_env(C.frames_for(seconds), int(onset * SR / C.HOP), rates)
        env = env * si[:, None]
        y += blend * 1.15 * C.additive(sf, env, int(seconds * SR))
    return gain * y, freqs, a


def demo_67_01():
    """A dust of frequencies. EXTENT through the Pell numbers."""
    d = "B2311-67-01"
    print(f"  {d}  EXTENT: 5, 29, 70, 169, 408 - a Pell number of sites")
    secs = []
    for n_sites in (5, 29, 70, 169, 408):
        f, v = A67.ladder(extent=n_sites, aperture=1.0)
        g = np.diff(np.sort(f))
        note(d, f"extent {n_sites}", partials=len(f),
             band_hz=f"{f.min():.0f}-{f.max():.0f}",
             largest_gap_over_median=round(float(g.max() / np.median(g)), 1)
             if len(g) > 2 else None)
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        for j, t in enumerate((0.05, 1.6, 3.1, 4.5)):
            for c in (0, 1):
                y, _, _ = b67_note(SECR, extent=n_sites, aperture=1.0,
                                   station=0.32 + 0.36 * c,
                                   incidence=0.75, loss=0.30, loss_tilt=0.45,
                                   sustain=0.05, onset=t,
                                   transpose=2 ** (j * 0.0), gain=0.85)
                ch[c] += y
        secs.append(C.stereo(ch[0], ch[1], 0.6))
    return finish(assemble(secs), cav=0.3, cavcol=0.5)


def demo_67_02():
    """The acceptance window. APERTURE 12 to 92 per cent."""
    d = "B2311-67-02"
    print(f"  {d}  APERTURE: how dense the matter, and what mixture it is")
    secs = []
    for ap in (0.12, 0.32, 0.52, 0.76, 1.00):
        xs, ys, occ, W = A67.chain(extent=169, aperture=ap)
        dd = np.diff(xs)
        types, counts = np.unique(np.round(dd, 6), return_counts=True)
        density = float(len(xs) / (xs[-1] - xs[0]))
        f, v = A67.ladder(extent=169, aperture=ap)
        note(d, f"aperture {ap:.2f}", window_width=round(float(W), 3),
             sites_per_unit_length=round(density, 3),
             bond_types=len(types),
             shortest_type_share=round(float(counts[0] / counts.sum()), 3),
             longest_over_shortest=round(float(types[-1] / types[0]), 3),
             partials=len(f))
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        for t in (0.05, 2.0, 3.9):
            for c in (0, 1):
                y, _, _ = b67_note(SECR, extent=169, aperture=ap,
                                   rim=0.15 + 0.4 * ap,
                                   station=0.36 + 0.3 * c, incidence=0.7,
                                   loss=0.34, loss_tilt=0.5, onset=t, gain=0.9)
                ch[c] += y
        secs.append(C.stereo(ch[0], ch[1], 0.6))
    return finish(assemble(secs), cav=0.32, cavcol=0.45)


def demo_67_03():
    """The strain that makes a crystal. OBLIQUITY."""
    d = "B2311-67-03"
    print(f"  {d}  OBLIQUITY: tilting the cut against the lattice")
    secs = []
    tilts = [(A67.SLOPE, "unstrained - the eightfold slope"),
             (1 / 3, "1 in 3 - a tilt that does not crystallise"),
             (12 / 29, "12 in 29 - a Pell tilt"),
             (2 / 5, "2 in 5"),
             (1 / 2, "1 in 2 - an ordinary crystal, in our intervals")]
    for slope, label in tilts:
        f, v = A67.ladder(extent=169, slope=slope, aperture=1.0)
        a = A67.excite(v, 0.5, 0.8)
        h, f0 = C.harmonicity(f[:16])
        xs, _, _, _ = A67.chain(extent=48, slope=slope, aperture=1.0)
        dd = np.diff(xs)
        seq = "".join("L" if x > dd.mean() else "S" for x in dd)[:24]
        note(d, label, cents_from_harmonic=round(h, 2),
             implied_fundamental_hz=round(f0, 1), bond_sequence=seq)
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        for t in (0.05, 1.9, 3.7):
            for c in (0, 1):
                y, _, _ = b67_note(SECR, extent=169, slope=slope, aperture=1.0,
                                   station=0.42 + 0.2 * c, incidence=0.8,
                                   loss=0.28, loss_tilt=0.42, sustain=0.05,
                                   onset=t, gain=0.9)
                ch[c] += y
        secs.append(C.stereo(ch[0], ch[1], 0.55))
    return finish(assemble(secs), cav=0.28, cavcol=0.5)


def demo_67_04():
    """What is seen is not what is heard. ASPECT, and the star."""
    d = "B2311-67-04"
    print(f"  {d}  ASPECT: the chain against the star")
    secs = []
    plan = [(0.00, dict(), "the chain alone - it persists"),
            (0.35, dict(orders=14, window=0.35), "the visible body admitted"),
            (0.70, dict(orders=34, window=0.62, extinction=0.18),
             "more orders, the shadow surviving further"),
            (1.00, dict(orders=34, window=0.62, precession=0.9,
                        extinction=0.18), "the star alone, precessing in w"),
            (0.55, dict(orders=48, window=0.85, precession=0.45,
                        extinction=0.10, order_decay=0.9),
             "both - and the high orders dying first")]
    for blend, kw, label in plan:
        sf, si, sq = A67.star(orders=kw.get("orders", 24),
                              window=kw.get("window", 0.5),
                              precession=kw.get("precession", 0.0),
                              extinction=kw.get("extinction", 0.35))
        note(d, label, aspect=blend, orders_heard=len(sf),
             star_band_hz=f"{sf.min():.0f}-{sf.max():.0f}" if len(sf) else "-")
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        for t in (0.05, 1.7, 3.3, 4.7):
            for c in (0, 1):
                y, _, _ = b67_note(SECR, extent=169, blend=blend, aperture=1.0,
                                   station=0.38 + 0.28 * c, incidence=0.72,
                                   loss=0.30, loss_tilt=0.5, sustain=0.05,
                                   onset=t, gain=0.8, **kw)
                ch[c] += y
        secs.append(C.stereo(ch[0], ch[1], 0.62))
    return finish(assemble(secs), cav=0.3, cavcol=0.55)


def demo_67_05():
    """Warming the body. TEMPERATURE, and the wiring it lets loose."""
    d = "B2311-67-05"
    print(f"  {d}  TEMPERATURE: 77 K to 800 K on specimen 041")
    names = ["aperture", "rim", "contrast", "bondlaw", "tilt4", "cutpos",
             "traverse", "station", "incidence", "loss", "loss_tilt", "blend",
             "orders", "window", "precession", "extinction", "level", "ref",
             "habit", "extent"]
    wiring = A67.Wiring(41, names)
    note(d, "wiring", connections=len(wiring.edges),
         sources=",".join(wiring.sources[:4]),
         stirs_the_frame_at_800K=wiring.stirs_frame,
         one_way="yes", loops=0)
    base = dict(aperture=0.5, rim=0.25, contrast=0.5, bondlaw=0.5, tilt4=0.5,
                cutpos=0.5, traverse=0.5, station=0.5, incidence=0.65,
                loss=0.34, loss_tilt=0.5, blend=0.15, orders=0.5, window=0.5,
                precession=0.2, extinction=0.35, level=0.8, ref=0.5,
                habit=41 / 256, extent=0.5)
    secs = []
    t0 = 0.0
    for kelvin in (77.0, 200.0, 293.0, 500.0, 800.0):
        mat, frm = A67.temp_depth(kelvin)
        n = int(SECR * SR)
        ch = [np.zeros(n), np.zeros(n)]
        seen = []
        for j, t in enumerate((0.05, 1.5, 2.9, 4.3)):
            v = wiring.apply(base, t0 + t, kelvin)
            seen.append(v)
            for c in (0, 1):
                y, _, _ = b67_note(
                    SECR, extent=169,
                    aperture=v["aperture"], rim=v["rim"],
                    contrast=v["contrast"], bondlaw=v["bondlaw"],
                    slope=A67.SLOPE * (1.0 + 0.16 * (v["tilt4"] - 0.5)),
                    cutpos=(v["cutpos"] - 0.5), traverse=(v["traverse"] - 0.5),
                    station=np.clip(v["station"] - 0.14 + 0.28 * c, 0, 1),
                    incidence=v["incidence"], loss=v["loss"],
                    loss_tilt=v["loss_tilt"], blend=v["blend"],
                    orders=int(8 + 48 * v["orders"]), window=v["window"],
                    precession=v["precession"], extinction=v["extinction"],
                    onset=t, gain=0.85)
                ch[c] += y
        driven = sorted({e["dst"] for e in wiring.edges})
        spread = {k: round(float(max(s[k] for s in seen) -
                                 min(s[k] for s in seen)), 3)
                  for k in driven if k in base}
        note(d, f"{kelvin:.0f} K", material_depth=f"+/-{mat * 100:.2f}%",
             frame_depth=f"+/-{frm * 100:.0f}%", moved_over_section=spread)
        secs.append(C.stereo(ch[0], ch[1], 0.6))
        t0 += SEC
    return finish(assemble(secs), cav=0.32, cavcol=0.5)


# =====================================================================  driver

DEMOS = [
    ("B2311-22-01_where-it-is-touched", demo_22_01),
    ("B2311-22-02_energy-does-not-stay", demo_22_02),
    ("B2311-22-03_exact-recurrence", demo_22_03),
    ("B2311-22-04_the-second-body", demo_22_04),
    ("B2311-22-05_the-permanent-alteration", demo_22_05),
    ("B2311-67-01_a-dust-of-frequencies", demo_67_01),
    ("B2311-67-02_the-acceptance-window", demo_67_02),
    ("B2311-67-03_the-strain-that-makes-a-crystal", demo_67_03),
    ("B2311-67-04_what-is-seen-is-not-what-is-heard", demo_67_04),
    ("B2311-67-05_warming-the-body", demo_67_05),
]


def encode(wav, bitrate="160k", keep_wav=False):
    """MP3 alongside the WAV - the demos are listened to over the web."""
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = "ffmpeg"
    mp3 = wav[:-4] + ".mp3"
    r = os.system(f'"{ff}" -v error -y -i "{wav}" -codec:a libmp3lame '
                  f'-b:a {bitrate} -joint_stereo 1 "{mp3}"')
    if r == 0:
        print(f"    -> {mp3}")
        if not keep_wav:
            os.remove(wav)
    return r


def main(only=None):
    os.makedirs(OUT, exist_ok=True)
    for name, fn in DEMOS:
        if only and only not in name:
            continue
        y = fn()
        wav = os.path.abspath(os.path.join(OUT, name + ".wav"))
        C.write_wav(wav, y)
        print(f"    -> {wav}  {len(y) / SR:.1f} s")
        encode(wav)
    # rendering one demonstration must not throw away the others' figures
    path = os.path.join(OUT, "measurements.json")
    rows = NOTES
    if only and os.path.exists(path):
        done = {r["demo"] for r in NOTES}
        rows = [r for r in json.load(open(path)) if r["demo"] not in done] + NOTES
        rows.sort(key=lambda r: r["demo"])
    with open(path, "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
