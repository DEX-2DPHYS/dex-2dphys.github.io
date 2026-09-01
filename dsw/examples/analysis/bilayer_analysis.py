"""Compare a twisted bubble BETWEEN the layers with one BELOW the bilayer.

Same twist, same seed, same pressure -- only the gas placement differs. The
question is what that does to the moire registry and to the in-plane strain
field, in each layer separately.

  python bilayer_analysis.py            # figure + movie for both runs

Registry and strain use the same routines as everywhere else in DSW, so these
numbers are directly comparable with the single-layer runs and with LAMMPS.
"""
import glob, json, os, struct, subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from registry import registry
from strain import atomic_strain

ROOT = r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW"
RUNS = [("between", os.path.join(ROOT, "bilayer-between")),
        ("below",   os.path.join(ROOT, "bilayer-below"))]
FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
MAGIC = 0x314C424D
ZOOM = float(os.environ.get("ZOOM", 120))
FPS = 25


def read_mbl1(p, keep_sub=None):
    b = open(p, "rb").read()
    off = 0 if struct.unpack_from("<I", b, 0)[0] == MAGIC else 12
    _, flags, n1, n2, ns, step = struct.unpack_from("<6I", b, off)
    q = off + 32
    l1 = np.array(np.frombuffer(b, "<f4", 3 * n1, q).reshape(n1, 3)); q += 12 * n1
    l2 = np.array(np.frombuffer(b, "<f4", 3 * n2, q).reshape(n2, 3)); q += 12 * n2
    sub = keep_sub
    if flags & 2:
        sub = np.array(np.frombuffer(b, "<f4", 3 * ns, q).reshape(ns, 3))
    return step, l1, l2, sub


def load(d):
    files = sorted(glob.glob(os.path.join(d, "f*.mbl1")))
    if not files:
        return None
    sub = None
    out = []
    for p in files:
        step, l1, l2, sub = read_mbl1(p, sub)
        out.append((step, l1, l2))
    return out, sub


def crop(a, lim):
    m = (np.abs(a[:, 0]) <= lim) & (np.abs(a[:, 1]) <= lim)
    return m


def analyse(frames):
    """Registry and strain for both layers, reference = frame 0 of the same run."""
    _, r1, r2 = frames[0]
    step, c1, c2 = frames[-1]
    m1, m2 = crop(r1, ZOOM), crop(r2, ZOOM)
    out = {"step": step}
    for tag, ref, cur, m in (("L1", r1, c1, m1), ("L2", r2, c2, m2)):
        rr, cc = ref[m], cur[m]
        dil, shear, *_ = atomic_strain(rr[:, :2], cc[:, :2], cutoff=3.2)
        out[tag] = {"xy": cc[:, :2], "z": cc[:, 2], "reg": registry(cc),
                    "dil": dil, "shear": shear,
                    "r": np.hypot(cc[:, 0], cc[:, 1])}
    return out


def main():
    data = {}
    for name, d in RUNS:
        got = load(d)
        if not got:
            print("  no frames for " + name); continue
        frames, sub = got
        print("  %-8s %d frames, steps %d..%d" % (name, len(frames), frames[0][0], frames[-1][0]),
              flush=True)
        data[name] = {"frames": frames, "an": analyse(frames)}
        print("     analysed", flush=True)
    if not data:
        sys.exit("nothing to do")

    # ---------------- comparative figure: 2 runs x (height, registry, dil, shear)
    zall = np.concatenate([data[k]["an"][L]["z"] for k in data for L in ("L1", "L2")])
    zlo, zhi = np.percentile(zall, 0.5), np.percentile(zall, 99.7)
    dall = np.concatenate([data[k]["an"][L]["dil"] for k in data for L in ("L1", "L2")])
    dlim = np.nanpercentile(np.abs(dall), 99.3)
    sall = np.concatenate([data[k]["an"][L]["shear"] for k in data for L in ("L1", "L2")])
    slim = np.nanpercentile(sall, 99.3)

    fig = plt.figure(figsize=(16.5, 9.4), facecolor="white")
    fig.suptitle("Twisted bubble in a bilayer — 2° twist, 4 nm gas seed at 600 MPa, "
                 "identical except for where the gas sits\n"
                 "top row: gas BETWEEN the layers (lifts layer 2)   ·   "
                 "bottom row: gas BELOW the bilayer (lifts both)",
                 fontsize=12.5)
    cols = [("z", "height (Å)", "turbo", zlo, zhi),
            ("reg", "registry (CSL)", "twilight_shifted", 0, 1),
            ("dil", "dilatation tr(ε)", "coolwarm", -dlim, dlim),
            ("shear", "in-plane shear", "inferno", 0, slim)]
    for r, name in enumerate(["between", "below"]):
        if name not in data: continue
        A = data[name]["an"]
        # show the layer the gas drives, plus the other layer's registry
        drive = "L2" if name == "between" else "L1"
        for c, (key, lab, cmap, lo, hi) in enumerate(cols):
            ax = fig.add_subplot(2, 4, 4 * r + c + 1)
            D = A[drive]
            v = D[key]
            good = ~np.isnan(v)
            s = ax.scatter(D["xy"][good, 0], D["xy"][good, 1], c=v[good], s=1.1,
                           cmap=cmap, vmin=lo, vmax=hi, linewidths=0)
            th = np.linspace(0, 2 * np.pi, 200)
            ax.plot(40 * np.cos(th), 40 * np.sin(th), "w--", lw=.8, alpha=.8)
            ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
            ax.set_title(("%s — %s" % (drive, lab)) if r == 0 else ("%s — %s" % (drive, lab)),
                         fontsize=9.5)
            ax.tick_params(labelsize=7)
            cb = fig.colorbar(s, ax=ax, shrink=.85, pad=.02); cb.ax.tick_params(labelsize=7)
            if c == 0:
                ax.set_ylabel(("gas BETWEEN" if name == "between" else "gas BELOW") + "\ny (Å)",
                              fontsize=9)
    plt.subplots_adjust(top=0.88, hspace=0.22, wspace=0.30)
    out1 = os.path.join(ROOT, "bilayer-compare.png")
    fig.savefig(out1, dpi=125); plt.close(fig)
    print("  wrote", out1)

    # ---------------- how the two layers differ within each run
    fig = plt.figure(figsize=(14.5, 8.4), facecolor="white")
    fig.suptitle("Does the second layer follow? — strain in BOTH layers, per placement",
                 fontsize=12.5)
    for r, name in enumerate(["between", "below"]):
        if name not in data: continue
        A = data[name]["an"]
        for c, L in enumerate(["L1", "L2"]):
            ax = fig.add_subplot(2, 3, 3 * r + c + 1)
            D = A[L]; good = ~np.isnan(D["dil"])
            s = ax.scatter(D["xy"][good, 0], D["xy"][good, 1], c=D["dil"][good], s=1.1,
                           cmap="coolwarm", vmin=-dlim, vmax=dlim, linewidths=0)
            ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
            ax.set_title("%s — %s : dilatation" % ("BETWEEN" if r == 0 else "BELOW", L), fontsize=9.5)
            ax.tick_params(labelsize=7)
            fig.colorbar(s, ax=ax, shrink=.85, pad=.02)
        ax = fig.add_subplot(2, 3, 3 * r + 3)
        for L, col in (("L1", "#0a58c0"), ("L2", "#d33")):
            D = A[L]
            bins = np.linspace(0, ZOOM, 34); idx = np.digitize(D["r"], bins) - 1
            rs, hh = [], []
            for k in range(len(bins) - 1):
                m = idx == k
                if m.sum() > 15:
                    rs.append(.5 * (bins[k] + bins[k+1])); hh.append(D["z"][m].mean())
            ax.plot(rs, hh, color=col, lw=1.7, label=L)
        ax.axvline(40, color="#888", ls="--", lw=1)
        ax.set_xlabel("radius (Å)"); ax.set_ylabel("mean height (Å)")
        ax.set_title("layer heights", fontsize=9.5); ax.legend(fontsize=8); ax.grid(alpha=.3)
    plt.subplots_adjust(top=0.88, hspace=0.28, wspace=0.28)
    out2 = os.path.join(ROOT, "bilayer-layers.png")
    fig.savefig(out2, dpi=125); plt.close(fig)
    print("  wrote", out2)

    # ---------------- numbers
    summ = {}
    for name in data:
        A = data[name]["an"]; summ[name] = {}
        for L in ("L1", "L2"):
            D = A[L]; inb = D["r"] < 40
            summ[name][L] = {
                "peakHeight": float(D["z"].max()),
                "meanHeight_inside": float(D["z"][inb].mean()),
                "dil_max": float(np.nanmax(D["dil"])), "dil_min": float(np.nanmin(D["dil"])),
                "shear_max": float(np.nanmax(D["shear"])),
                "shear_mean_inside": float(np.nanmean(D["shear"][inb])),
                "registry_inside": float(D["reg"][inb].mean()),
                "registry_outside": float(D["reg"][~inb].mean()),
            }
    json.dump(summ, open(os.path.join(ROOT, "bilayer-summary.json"), "w"), indent=1)
    for name in summ:
        print("\n  gas %s:" % name.upper())
        for L in ("L1", "L2"):
            q = summ[name][L]
            print("    %s  peak z %6.2f A  dil %+.4f..%+.4f  shear max %.4f  "
                  "registry in/out %.3f/%.3f"
                  % (L, q["peakHeight"], q["dil_min"], q["dil_max"],
                     q["shear_max"], q["registry_inside"], q["registry_outside"]))


if __name__ == "__main__":
    main()
