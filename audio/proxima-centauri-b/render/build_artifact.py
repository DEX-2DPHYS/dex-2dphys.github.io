#!/usr/bin/env python3
"""Compute the ladder pairs each demonstration is about, and emit them as JSON.

Each demonstration turns on a comparison, so each one gets two ladders drawn
against each other: the state at the top of the demonstration and the state at
the bottom.  Positions are frequencies; heights are that partial's share of the
disturbance.  Nothing here is decorative - it is the finding, plotted.
"""

import json
import os

import numpy as np

import common as C
import artefact22 as A22
import artefact67 as A67

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ladders.json")
MAX = 220


def pack(freqs, amps, cap=MAX):
    f = np.asarray(freqs, float)
    a = np.asarray(amps, float)
    a = a / max(a.max(), 1e-30)
    o = np.argsort(a)[::-1][:cap]
    o = o[np.argsort(f[o])]
    return [[round(float(x), 2), round(float(y), 4)]
            for x, y in zip(f[o], a[o]) if y > 0.004]


def energy_at(freqs, amps, meta, t, wake=0.93, warmth=0.45):
    """The amplitude surface of a B2311.22 disturbance, sampled at t seconds."""
    fr = C.frames_for(t + 0.2)
    dt = C.HOP / C.SR
    base = 0.10 + 4.2 * (1 - wake) ** 2
    tilt = 0.30 + 2.2 * (1 - warmth)
    rates = base * (1.0 + tilt * ((freqs / freqs[0]) ** 0.55 - 1.0))
    a = amps * (freqs / freqs[0]) ** (-0.55 + 1.1 * warmth)
    k = np.arange(len(freqs))
    a = a * np.exp(-0.5 * ((k - 0.34 * (len(freqs) - 1)) /
                           max(1.0, 0.10 * len(freqs) * 0.45)) ** 2)
    inj = np.zeros((len(freqs), fr))
    for i, g in enumerate((0.28, 0.42, 0.22, 0.08)):
        inj[:, i] = (a ** 2) * g
    env = C.redistribute(inj, np.exp(-2 * rates * dt), meta * 2.5, 0.60)
    return env[:, min(fr - 1, int(t / dt))]


def main():
    L = {}

    # ---- B2311.22 ------------------------------------------------------
    b37 = A22.Body(37)
    f37, v37, d37 = b37.ladder()
    L["B2311-22-01"] = dict(
        a=pack(f37, A22.touch(v37, d37, "hub")),
        b=pack(f37, A22.touch(v37, d37, "rim")),
        la="the most connected site", lb="the most remote site",
        cap="One body, one ladder, two contacts. Same partials, different "
            "shares of them - the 0.709 the survey records.")

    b112 = A22.Body(112)
    f112, v112, d112 = b112.ladder()
    f112 = f112 * (110.0 / 98.0)
    amp = A22.touch(v112, d112, "hub")
    L["B2311-22-02"] = dict(
        a=pack(f112, energy_at(f112, amp, 1.0, 1.0)),
        b=pack(f112, energy_at(f112, amp, 1.0, 4.8)),
        la="one second in", lb="four point eight seconds in",
        cap="The disturbance is put into a short stretch of the ladder and "
            "then left. The energy does not stay in it.")

    b84 = A22.Body(84)
    f84, v84, d84 = b84.ladder(depth=0.06)
    f84 = f84 * (104.0 / 98.0)
    a84 = A22.touch(v84, d84, "hub")
    L["B2311-22-03"] = dict(
        a=pack(f84, a84), b=pack(A22.revive(f84, 2.4), a84),
        la="as the body stands", lb="on the comb of one in 2.4 seconds",
        cap="Recurrence is exact because the partials are commensurate. The "
            "few left off the comb are what is audible in between.")

    b28 = A22.Body(28)
    f28, v28, d28 = b28.ladder()
    amp37 = A22.touch(v37, d37, "hub")
    kin = C.ladder_overlap(f37, f28)
    reply, tf, ta = A22.converse(f37, amp37, f28, 6.0, kin, commune=0.65)
    L["B2311-22-04"] = dict(
        a=pack(f37, amp37), b=pack(f28, reply),
        la="specimen 037, speaking", lb="specimen 028, answering",
        cap="It hears only at the frequencies it itself possesses, and answers "
            "in its own. Overlap between this pair, 0.059.")

    b150 = A22.Body(150)
    f150, v150, d150 = b150.ladder()
    a150 = A22.touch(v150, d150, "hub")
    full, _ = A22.plasticity_track(f150, f37, 64)
    L["B2311-22-05"] = dict(
        a=pack(f150, a150), b=pack(f150 * full[:, -1], a150),
        la="specimen 150, as catalogued", lb="the same body, afterwards",
        cap="53.9 cents, in nineteen steps applied while the object was at "
            "rest. It no longer matches its own catalogue entry.")

    # ---- B2311.67 ------------------------------------------------------
    def q(**kw):
        f, v = A67.ladder(**{"aperture": 1.0, **kw})
        return f, A67.excite(v, 0.5, 0.75)

    f408, a408 = q(extent=408)
    f29, a29 = q(extent=29)
    L["B2311-67-01"] = dict(a=pack(f408, a408), b=pack(f29, a29),
                            la="408 sites", lb="29 sites",
                            cap="The gaps do not fill in as the body grows. "
                                "They subdivide - the largest running from 2.7 "
                                "times the median to 659 times it.")

    f1, a1 = q(extent=169, aperture=1.00)
    f2, a2 = q(extent=169, aperture=0.12)
    L["B2311-67-02"] = dict(a=pack(f1, a1), b=pack(f2, a2),
                            la="the window fully open", lb="the window at 0.12",
                            cap="Density from 1.32 to 0.27 sites per unit "
                                "length, and three bond lengths where the open "
                                "window gives two.")

    f3, a3 = q(extent=169)
    f4, a4 = q(extent=169, slope=0.5)
    L["B2311-67-03"] = dict(a=pack(f3, a3), b=pack(f4, a4),
                            la="unstrained - 47.4 cents off",
                            lb="strained to 1 in 2 - 9.1 cents off",
                            cap="A tilted cut through an ordered aperiodic "
                                "body is the classical route by which it "
                                "becomes an ordinary crystal. It goes willingly.")

    sf, si, _ = A67.star(orders=34, window=0.62, extinction=0.18)
    L["B2311-67-04"] = dict(a=pack(f3, a3), b=pack(sf, si),
                            la="the chain - what persists",
                            lb="the star - struck, rings, dies",
                            cap="Two voices belonging to different parts of "
                                "one object. For as long as a sound is held, "
                                "the observer watches one and hears the other.")

    names = ["aperture", "rim", "contrast", "bondlaw", "tilt4", "cutpos",
             "traverse", "station", "incidence", "loss", "loss_tilt", "blend",
             "orders", "window", "precession", "extinction", "level", "ref",
             "habit", "extent"]
    wiring = A67.Wiring(41, names)
    base = dict(aperture=0.5, rim=0.25, contrast=0.5, bondlaw=0.5, tilt4=0.5,
                cutpos=0.5, traverse=0.5, station=0.5, incidence=0.65,
                loss=0.34, loss_tilt=0.5, blend=0.15, orders=0.5, window=0.5,
                precession=0.2, extinction=0.35, level=0.8, ref=0.5,
                habit=41 / 256, extent=0.5)

    def at(kelvin, t):
        v = wiring.apply(base, t, kelvin)
        f, vec = A67.ladder(extent=169, aperture=v["aperture"], rim=v["rim"],
                            contrast=v["contrast"], bondlaw=v["bondlaw"],
                            slope=A67.SLOPE * (1 + 0.16 * (v["tilt4"] - 0.5)),
                            cutpos=v["cutpos"] - 0.5,
                            traverse=v["traverse"] - 0.5)
        return f, A67.excite(vec, v["station"], v["incidence"])

    fc, ac = at(77.0, 3.0)
    fh, ah = at(800.0, 27.0)
    L["B2311-67-05"] = dict(a=pack(fc, ac), b=pack(fh, ah),
                            la="held at 77 K", lb="at 800 K, twenty-four seconds later",
                            cap="Nothing was touched between the two. Cold, "
                                "the quantities hold where they were put; warm, "
                                "they drive one another.")

    json.dump(L, open(OUT, "w"))
    n = sum(len(v["a"]) + len(v["b"]) for v in L.values())
    print(f"wrote {OUT}: {len(L)} pairs, {n} partials")


if __name__ == "__main__":
    main()
