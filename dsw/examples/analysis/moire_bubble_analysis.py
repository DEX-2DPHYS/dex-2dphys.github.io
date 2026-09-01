"""Atomistic analysis of a twisted moire bubble at equilibrium.

The target is not the overall shape (that is the sanity check) but the
distortion: how the moire registry and the in-plane strain field are arranged
around and inside the bubble.

Six panels:
  height            -- the sanity check
  registry (CSL)    -- moire pattern, three-cosine structure factor
  dilatation        -- tr(eps), area change; positive = stretched
  shear             -- max in-plane shear, where the lattice is sheared
  radial profiles   -- height, registry, dilatation, shear against radius
  strain histograms -- inside vs outside the delaminated region

  BUBBLE_DIR=... [BUBBLE_R=4] [BUBBLE_ZOOM=140] python moire_bubble_analysis.py

Reference for the strain is frame 0 of the same run, i.e. the as-built twisted
lattice before the gas is applied, so what is measured is the deformation the
bubble causes and nothing else.
"""
import glob, json, os, struct, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from registry import registry
from strain import atomic_strain

BASE = os.environ.get("BUBBLE_DIR",
    r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW\moire-bubble-free")
RNM = float(os.environ.get("BUBBLE_R", 4))
ZOOM = float(os.environ.get("BUBBLE_ZOOM", 140))
MAGIC = 0x31444D47
Z0 = 3.35
R = RNM * 10.0


def read_gmd1(p):
    b = open(p, "rb").read()
    off = 0 if struct.unpack_from("<I", b, 0)[0] == MAGIC else 12
    _, flags, n, m, nb, step = struct.unpack_from("<6I", b, off)
    q = off + 32
    return step, np.array(np.frombuffer(b, "<f4", 3 * n, q).reshape(n, 3))


def main():
    files = sorted(glob.glob(os.path.join(BASE, "f*.gmd1")))
    if not files:
        sys.exit("no frames in " + BASE)
    step0, ref = read_gmd1(files[0])
    stepN, cur = read_gmd1(files[-1])
    print("  reference step %d, deformed step %d, %d atoms" % (step0, stepN, len(ref)))

    # Work on the region of interest only -- the strain fit is the expensive part.
    m = (np.abs(ref[:, 0]) <= ZOOM) & (np.abs(ref[:, 1]) <= ZOOM)
    ref_c, cur_c = ref[m], cur[m]
    print("  %d atoms within +-%g A" % (len(ref_c), ZOOM), flush=True)

    h = cur_c[:, 2] - Z0
    reg = registry(cur_c)
    print("  computing atomic strain ...", flush=True)
    dil, shear, exx, eyy, exy = atomic_strain(ref_c, cur_c, cutoff=3.2)
    ok = ~np.isnan(dil)
    print("  strain defined on %d/%d atoms" % (ok.sum(), len(ok)))

    r = np.hypot(cur_c[:, 0], cur_c[:, 1])
    # delaminated radius: outermost atom standing off by more than the gas gap
    lifted = h > 1.2
    a_del = r[lifted].max() if lifted.any() else 0.0
    print("  delaminated radius %.1f A  (seed %.1f A)  peak height %.2f A"
          % (a_del, R, h.max()))

    fig = plt.figure(figsize=(15.5, 9.2), facecolor="white")
    fig.suptitle("Twisted moire bubble at equilibrium — free peel front, "
                 "%d atoms in view, step %d\n"
                 "delaminated radius %.0f Å (gas seed %.0f Å), peak height %.1f Å"
                 % (len(ref_c), stepN, a_del, R, h.max()), fontsize=12.5)

    def panel(k, val, title, cmap, lo, hi, unit=""):
        ax = fig.add_subplot(2, 3, k)
        good = ~np.isnan(val)
        s = ax.scatter(cur_c[good, 0], cur_c[good, 1], c=val[good], s=1.3,
                       cmap=cmap, vmin=lo, vmax=hi, linewidths=0)
        th = np.linspace(0, 2 * np.pi, 240)
        ax.plot(R * np.cos(th), R * np.sin(th), "w--", lw=0.9, alpha=.85)
        if a_del > 0:
            ax.plot(a_del * np.cos(th), a_del * np.sin(th), color="k", ls=":", lw=0.9, alpha=.7)
        ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
        ax.set_title(title, fontsize=10); ax.tick_params(labelsize=7)
        ax.set_xlabel("x (Å)", fontsize=8)
        cb = fig.colorbar(s, ax=ax, shrink=.85, pad=.02)
        cb.ax.tick_params(labelsize=7)
        if unit: cb.set_label(unit, fontsize=8)
        return ax

    panel(1, h, "height above substrate", "turbo", 0, max(h.max(), 1), "Å")
    panel(2, reg, "registry (CSL)  0 = AA-like", "twilight_shifted", 0, 1, "")
    dlim = np.nanpercentile(np.abs(dil[ok]), 99)
    panel(3, dil, "dilatation  tr(ε)   (area change)", "coolwarm", -dlim, dlim, "")
    slim = np.nanpercentile(shear[ok], 99)
    panel(4, shear, "max in-plane shear", "inferno", 0, slim, "")

    # radial profiles
    ax = fig.add_subplot(2, 3, 5)
    bins = np.linspace(0, ZOOM, 40)
    idx = np.digitize(r, bins) - 1
    rs, hh, rr, dd, ss = [], [], [], [], []
    for k in range(len(bins) - 1):
        sel = (idx == k)
        if sel.sum() < 15: continue
        rs.append(0.5 * (bins[k] + bins[k + 1]))
        hh.append(h[sel].mean()); rr.append(reg[sel].mean())
        dd.append(np.nanmean(dil[sel])); ss.append(np.nanmean(shear[sel]))
    rs = np.array(rs)
    ax.plot(rs, np.array(hh) / max(np.max(hh), 1e-9), lw=1.6, label="height (norm.)")
    ax.plot(rs, rr, lw=1.6, label="registry")
    ax.plot(rs, np.array(dd) / max(np.max(np.abs(dd)), 1e-9), lw=1.6, label="dilatation (norm.)")
    ax.plot(rs, np.array(ss) / max(np.max(ss), 1e-9), lw=1.6, label="shear (norm.)")
    ax.axvline(R, color="#888", ls="--", lw=1)
    if a_del > 0: ax.axvline(a_del, color="k", ls=":", lw=1)
    ax.set_xlabel("radius (Å)"); ax.set_ylabel("normalised")
    ax.set_title("radial profiles (dashed = gas seed, dotted = peel front)", fontsize=9.5)
    ax.legend(fontsize=7.5); ax.grid(alpha=.3)

    # inside vs outside
    ax = fig.add_subplot(2, 3, 6)
    ins = ok & (r < (a_del if a_del > 0 else R))
    out = ok & (r >= (a_del if a_del > 0 else R))
    for sel, lab, c in ((ins, "inside the bubble", "#d33"), (out, "adhered region", "#0a58c0")):
        if sel.sum() > 20:
            ax.hist(dil[sel], bins=70, range=(-dlim, dlim), histtype="step",
                    lw=1.5, density=True, color=c, label=lab + " — dilatation")
            ax.hist(shear[sel], bins=70, range=(-dlim, dlim), histtype="step",
                    lw=1.2, ls="--", density=True, color=c, label=lab + " — shear")
    ax.set_xlabel("strain"); ax.set_ylabel("density")
    ax.set_title("strain distribution, inside vs outside", fontsize=9.5)
    ax.legend(fontsize=7); ax.grid(alpha=.3)

    plt.subplots_adjust(top=0.87, hspace=0.28, wspace=0.30)
    out_png = os.path.join(BASE, "moire-bubble-analysis.png")
    fig.savefig(out_png, dpi=130)
    print("  wrote", out_png)

    summ = {
        "step": int(stepN), "nAtoms": int(len(ref_c)),
        "delaminatedRadiusA": float(a_del), "seedRadiusA": float(R),
        "peakHeightA": float(h.max()),
        "dilatation": {"inside_mean": float(np.nanmean(dil[ins])),
                       "inside_max": float(np.nanmax(dil[ins])) if ins.sum() else None,
                       "outside_mean": float(np.nanmean(dil[out]))},
        "shear": {"inside_mean": float(np.nanmean(shear[ins])),
                  "inside_max": float(np.nanmax(shear[ins])) if ins.sum() else None,
                  "outside_mean": float(np.nanmean(shear[out]))},
        "registry": {"inside_mean": float(reg[r < (a_del if a_del > 0 else R)].mean()),
                     "outside_mean": float(reg[r >= (a_del if a_del > 0 else R)].mean())},
    }
    json.dump(summ, open(os.path.join(BASE, "moire-bubble-summary.json"), "w"), indent=1)
    print("  delaminated radius %.1f A ; peak strain: dilatation %.4f, shear %.4f"
          % (a_del, summ["dilatation"]["inside_max"] or 0, summ["shear"]["inside_max"] or 0))
    print("  mean dilatation inside %.4f vs outside %.4f"
          % (summ["dilatation"]["inside_mean"], summ["dilatation"]["outside_mean"]))


if __name__ == "__main__":
    main()
