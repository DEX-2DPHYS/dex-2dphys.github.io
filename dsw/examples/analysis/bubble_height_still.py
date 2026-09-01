"""Height companion to bubble_render.py.

The registry still shows the moire and CANNOT show the blister: registry is a
function of in-plane (x, y) only, and lifting a sheet 13 A barely moves atoms
sideways. This panel shows the topography instead, which is where the four
engines actually differ.
"""
import os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bubble_render as B

ZOOM = 120.0


def centre_h(xyz, r=25.0):
    c = xyz[np.hypot(xyz[:, 0], xyz[:, 1]) < r]
    return c[:, 2].mean() if len(c) else np.nan


def radial(xyz, lim=ZOOM, dr=4.0):
    r = np.hypot(xyz[:, 0], xyz[:, 1])
    bins = np.arange(0, lim + dr, dr)
    idx = np.digitize(r, bins) - 1
    rs, zs = [], []
    for k in range(len(bins) - 1):
        m = idx == k
        if m.sum() > 15:
            rs.append(0.5 * (bins[k] + bins[k + 1])); zs.append(xyz[m, 2].mean())
    return np.array(rs), np.array(zs)


def main():
    data = []
    for label, d, is_lmp in B.RUNS:
        fr = B.load_lammps(d) if is_lmp else B.load_dsw(d)
        if not fr:
            continue
        fr = [(s, B.crop(x, ZOOM * 1.6)) for s, x in fr]
        data.append((label, fr))

    # each engine at ITS OWN peak: the schedules end at slightly different
    # steps, and comparing blister heights at a common step would understate
    # whichever engine is still rising.
    peaks = []
    for label, fr in data:
        best = max(((s, centre_h(x)) for s, x in fr), key=lambda t: t[1])
        peaks.append((label, fr, best))

    allz = np.concatenate([B.pick(fr, b[0])[1][:, 2] for _, fr, b in peaks])
    vmin, vmax = float(np.percentile(allz, 1)), float(np.percentile(allz, 99.8))

    fig = plt.figure(figsize=(15.5, 8.6), facecolor="white")
    fig.suptitle("Twisted bubble at interface, 50 nm sheet — blister topography at each engine's own peak\n"
                 "Hencky gas pocket R = 5 nm at 100 kPa between the layers, 2° twist; "
                 "the registry panel cannot show this because registry depends only on in-plane position",
                 fontsize=12)
    for k, (label, fr, (pstep, ph)) in enumerate(peaks):
        step, xyz = B.pick(fr, pstep)
        ax = fig.add_subplot(2, 4, k + 1)
        m = (np.abs(xyz[:, 0]) <= ZOOM) & (np.abs(xyz[:, 1]) <= ZOOM)
        s = xyz[m]
        im = ax.scatter(s[:, 0], s[:, 1], c=s[:, 2], s=1.6, cmap="turbo",
                        vmin=vmin, vmax=vmax, linewidths=0)
        ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
        ax.set_title("%s\nstep %d, centre %.1f Å" % (label, step, ph), fontsize=8.5)
        ax.tick_params(labelsize=7); ax.set_xlabel("x (Å)", fontsize=8)
        if k == 0:
            ax.set_ylabel("y (Å)", fontsize=8)
        if k == 3:
            fig.colorbar(im, ax=ax, shrink=0.85, pad=0.03, label="z (Å)")

    ax = fig.add_subplot(2, 2, 3)
    for label, fr, (pstep, ph) in peaks:
        step, xyz = B.pick(fr, pstep)
        r, z = radial(xyz)
        ax.plot(r, z, lw=1.6, label="%s  (%.1f Å)" % (label, ph))
    ax.axvline(50, color="#888", ls="--", lw=1)
    ax.text(52, ax.get_ylim()[0] + 0.4, " blister edge R = 5 nm", fontsize=7.5, color="#666")
    ax.set_xlabel("radius (Å)"); ax.set_ylabel("mean height z (Å)")
    ax.set_title("radial blister profile at peak", fontsize=9.5)
    ax.legend(fontsize=7.5); ax.grid(alpha=.3)

    ax = fig.add_subplot(2, 2, 4)
    for label, fr, _ in peaks:
        st = [s for s, _ in fr]
        hh = [centre_h(x) for _, x in fr]
        ax.plot(st, hh, lw=1.5, label=label)
    ax.set_xlabel("step"); ax.set_ylabel("centre height z (Å)")
    ax.set_title("blister inflation and deflation over the cycle", fontsize=9.5)
    ax.legend(fontsize=7.5); ax.grid(alpha=.3)

    plt.subplots_adjust(top=0.85, hspace=0.32, wspace=0.30)
    out = os.path.join(B.BASE, "bubble-height-still.png")
    fig.savefig(out, dpi=130)
    print("wrote", out)
    for label, fr, (pstep, ph) in peaks:
        s0 = centre_h(fr[0][1])
        print("  %-28s start %.2f  peak %.2f at step %d  rise %.2f A"
              % (label, s0, ph, pstep, ph - s0))


if __name__ == "__main__":
    main()
