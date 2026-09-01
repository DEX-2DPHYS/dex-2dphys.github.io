"""Movies of a twisted bubble in a bilayer: the two gas placements side by side.

Left pair  : gas BETWEEN the layers   (lifts layer 2 off layer 1)
Right pair : gas BELOW the bilayer    (lifts layer 1, layer 2 rides along)

Each pair shows the two layers, so it is visible at a glance whether the second
layer follows. Both movies share one camera and one colour scale, computed
across every frame of both runs -- otherwise the difference you see is partly
the plotting.

  BILAYER_MODE=height|registry  ZOOM=120  python bilayer_movie.py
"""
import glob, os, struct, subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from registry import registry

ROOT = r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW"
FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
MAGIC = 0x314C424D
ZOOM = float(os.environ.get("ZOOM", 120))
MODE = os.environ.get("BILAYER_MODE", "height")
TAG = os.environ.get("BILAYER_TAG", "")          # "" or "hi-"
FPS = 25


def read(p, keep=None):
    b = open(p, "rb").read()
    off = 0 if struct.unpack_from("<I", b, 0)[0] == MAGIC else 12
    _, flags, n1, n2, ns, step = struct.unpack_from("<6I", b, off)
    q = off + 32
    l1 = np.array(np.frombuffer(b, "<f4", 3 * n1, q).reshape(n1, 3)); q += 12 * n1
    l2 = np.array(np.frombuffer(b, "<f4", 3 * n2, q).reshape(n2, 3))
    return step, l1, l2


def load(d):
    fs = sorted(glob.glob(os.path.join(d, "f*.mbl1")))
    return [read(p) for p in fs]


def main():
    runs = []
    for name in ("between", "below"):
        d = os.path.join(ROOT, "bilayer-%s%s" % (TAG, name))
        fr = load(d)
        if not fr:
            print("  no frames in " + d); continue
        runs.append((name, fr))
        print("  %-8s %d frames, steps %d..%d" % (name, len(fr), fr[0][0], fr[-1][0]), flush=True)
    if not runs:
        sys.exit("nothing to render")

    lo = max(r[1][0][0] for r in runs)
    hi = min(r[1][-1][0] for r in runs)
    grid = np.linspace(lo, hi, min(240, min(len(r[1]) for r in runs)))
    print("  common step grid %d..%d, %d frames" % (lo, hi, len(grid)), flush=True)

    # shared colour scale over both runs and both layers
    zs = []
    for _, fr in runs:
        for k in range(0, len(fr), max(1, len(fr) // 12)):
            zs.append(fr[k][1][:, 2]); zs.append(fr[k][2][:, 2])
    allz = np.concatenate(zs)
    zlo, zhi = float(np.percentile(allz, 0.5)), float(np.percentile(allz, 99.8))
    print("  height scale %.2f..%.2f A" % (zlo, zhi), flush=True)

    def pick(fr, s):
        st = np.array([f[0] for f in fr])
        return fr[int(np.argmin(np.abs(st - s)))]

    tmp = os.path.join(ROOT, "_mbpng")
    os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)

    fig = plt.figure(figsize=(13.6, 7.4), facecolor="white")
    for i, s in enumerate(grid):
        fig.clf()
        fig.suptitle("Twisted bubble in a bilayer — 2° twist, gas BETWEEN (left) vs BELOW (right)"
                     "   ·   step %d   ·   colour = %s"
                     % (int(s), "height" if MODE == "height" else "registry (CSL)"),
                     fontsize=12, y=0.97)
        for c, (name, fr) in enumerate(runs):
            step, l1, l2 = pick(fr, s)
            for r, (L, lab) in enumerate(((l1, "layer 1 (bottom)"), (l2, "layer 2 (top)"))):
                ax = fig.add_subplot(2, 2 * len(runs) // 2, 0) if False else \
                     fig.add_subplot(2, 2, r * 2 + c + 1)
                m = (np.abs(L[:, 0]) <= ZOOM) & (np.abs(L[:, 1]) <= ZOOM)
                P = L[m]
                col = P[:, 2] if MODE == "height" else registry(P)
                lo_, hi_ = (zlo, zhi) if MODE == "height" else (0.0, 1.0)
                cm = "turbo" if MODE == "height" else "twilight_shifted"
                ax.scatter(P[:, 0], P[:, 1], c=col, s=1.0, cmap=cm,
                           vmin=lo_, vmax=hi_, linewidths=0)
                th = np.linspace(0, 2 * np.pi, 200)
                ax.plot(40 * np.cos(th), 40 * np.sin(th), "w--", lw=.8, alpha=.75)
                ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
                ax.set_xticks([]); ax.set_yticks([])
                ax.set_title("gas %s — %s" % (name.upper(), lab), fontsize=9.5)
        plt.subplots_adjust(top=0.89, hspace=0.14, wspace=0.06,
                            left=0.02, right=0.98, bottom=0.02)
        fig.savefig(os.path.join(tmp, "p%04d.png" % i), dpi=100)
        if i % 40 == 0:
            print("    rendered %d/%d" % (i, len(grid)), flush=True)
    plt.close(fig)

    out = os.path.join(ROOT, "bilayer-%s%s.mp4" % (TAG, MODE))
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(tmp, "p%04d.png"),
                    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", out], check=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)
    print("  wrote", out)


if __name__ == "__main__":
    main()
