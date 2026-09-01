"""Twisted-bubble comparison: registry (CSL) and height, four engines.

Registry is computed HERE for all four datasets with the same function
(registry.py, ported from the plugin's computeRegistry) rather than taking the
plugin's built-in values for three and inventing something for the fourth.
That is what makes LAMMPS comparable at all: registry is a function of atom
positions, not a feature LAMMPS has to support.

Outputs into DSW/movies-bubble/:
  bubble-quad-registry.mp4   45 deg, coloured by registry   (Peter's view)
  bubble-quad-height.mp4     45 deg, coloured by height
  bubble-registry-still.png  top-down at peak + radial profiles + histogram

The still is top-down on purpose: the moire is a plan-view pattern and 45 deg
foreshortens it. The movies stay at 45 deg as asked.
"""
import glob, json, os, struct, subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from registry import registry

FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
# Overridable so the same renderer serves several blister runs and camera
# angles. BUBBLE_EL = 90 is a plan view (looking straight down).
BASE = os.environ.get(
    "BUBBLE_DIR", r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW\movies-bubble")
MAGIC = 0x31444D47
AZ = np.deg2rad(float(os.environ.get("BUBBLE_AZ", 35.0)))
EL = np.deg2rad(float(os.environ.get("BUBBLE_EL", 45.0)))
TOPDOWN = float(os.environ.get("BUBBLE_EL", 45.0)) >= 89.0
ZEX = 1.0 if TOPDOWN else 6.0   # no point exaggerating height in a plan view
FPS = 25
ZOOM = float(os.environ.get("BUBBLE_ZOOM", 170.0))
VIEWNAME = "top-down" if TOPDOWN else ("%g deg view, height x%g" % (
    float(os.environ.get("BUBBLE_EL", 45.0)), ZEX))


def project(xyz):
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2] * ZEX
    ca, sa, ce, se = np.cos(AZ), np.sin(AZ), np.cos(EL), np.sin(EL)
    fwd = x * ca + y * sa
    return (-x * sa + y * ca, -fwd * se + z * ce, fwd * ce + z * se)


def read_gmd1(p, keep):
    b = open(p, "rb").read()
    off = 0 if struct.unpack_from("<I", b, 0)[0] == MAGIC else 12
    _, flags, n, m, nb, step = struct.unpack_from("<6I", b, off)
    q = off + 32
    top = np.array(np.frombuffer(b, "<f4", 3 * n, q).reshape(n, 3)); q += 12 * n
    if flags & 4:
        q += 8 * n
    sub = keep
    if flags & 2:
        sub = np.array(np.frombuffer(b, "<f4", 3 * m, q).reshape(m, 3))
    return step, top, sub


def load_dsw(d):
    out, keep = [], None
    for p in sorted(glob.glob(os.path.join(d, "f*.gmd1"))):
        step, top, keep = read_gmd1(p, keep)
        out.append((step, top))
    return out


def load_lammps(d):
    out = []
    p = os.path.join(d, "sheet.lammpstrj")
    if not os.path.exists(p):
        return out
    with open(p) as f:
        while True:
            ln = f.readline()
            if not ln:
                break
            if not ln.startswith("ITEM: TIMESTEP"):
                continue
            step = int(f.readline()); f.readline(); n = int(f.readline())
            while not f.readline().startswith("ITEM: ATOMS"):
                pass
            a = np.empty((n, 4))
            for k in range(n):
                a[k] = np.array(f.readline().split()[:4], dtype=float)
            a = a[np.argsort(a[:, 0])]
            out.append((step, a[:, 1:4]))
    return out


def pick(frames, step):
    s = np.array([f[0] for f in frames])
    return frames[int(np.argmin(np.abs(s - step)))]


def crop(xyz, lim):
    m = (np.abs(xyz[:, 0]) <= lim) & (np.abs(xyz[:, 1]) <= lim)
    return xyz[m]


def draw45(ax, sheet, colour, cmap, vmin, vmax, box, title, ssize=2.2):
    ax.clear()
    u, v, d = project(sheet)
    o = np.argsort(d)
    ax.scatter(u[o], v[o], s=ssize, c=colour[o], cmap=cmap, vmin=vmin, vmax=vmax,
               linewidths=0)
    ax.set_xlim(box[0], box[1]); ax.set_ylim(box[2], box[3])
    ax.set_aspect("equal"); ax.axis("off")
    ax.set_title(title, fontsize=9, pad=1)


def encode(tmp, out, n):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(tmp, "p%04d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "20", out], check=True)
    print("  wrote %s (%d frames)" % (os.path.basename(out), n), flush=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)


RUNS = [
    ("DSW — Morse (CPU)",        os.path.join(BASE, "cap-classic"), False),
    ("DSW — Morse (OpenCL GPU)", os.path.join(BASE, "cap-gpu"),     False),
    ("DSW — AIREBO (embedded)",  os.path.join(BASE, "cap-airebo"),  False),
    ("stock LAMMPS — AIREBO",    os.path.join(BASE, "cap-airebo"),  True),
]


def main():
    data = []
    for label, d, is_lmp in RUNS:
        fr = load_lammps(d) if is_lmp else load_dsw(d)
        if not fr:
            print("  NO FRAMES for " + label)
            continue
        fr = [(s, crop(x, ZOOM)) for s, x in fr]
        data.append((label, fr))
        print("  loaded %-28s %4d frames, steps %d..%d, %d atoms in view"
              % (label, len(fr), fr[0][0], fr[-1][0], len(fr[0][1])), flush=True)
    if not data:
        sys.exit("no data")

    lo = max(f[0][0] for _, f in data)
    hi = min(f[-1][0] for _, f in data)
    grid = np.arange(lo, hi + 1, 10)
    print("  common step grid %d..%d (%d frames)" % (lo, hi, len(grid)), flush=True)

    # shared camera + shared height scale
    us, vs, zs = [], [], []
    for _, fr in data:
        for s in grid[::max(1, len(grid) // 12)]:
            _, xyz = pick(fr, s)
            a, b, _ = project(xyz)
            us.append(a); vs.append(b); zs.append(xyz[:, 2])
    au, av = np.concatenate(us), np.concatenate(vs)
    mu = 0.03 * (au.max() - au.min())
    box = (au.min() - mu, au.max() + mu, av.min() - mu, av.max() + mu)
    allz = np.concatenate(zs)
    zmin, zmax = float(np.percentile(allz, 1)), float(np.percentile(allz, 99.7))
    print("  height scale %.2f..%.2f A" % (zmin, zmax), flush=True)

    tmp = os.path.join(BASE, "_png")
    os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)

    aspect = (box[1] - box[0]) / (box[3] - box[2])
    for mode, cmap, vmin, vmax, cname in [
            ("registry", "twilight_shifted", 0.0, 1.0, "registry (0 = AA-like, 1 = worst)"),
            ("height", "turbo", zmin, zmax, "height z (A)")]:
        fig = plt.figure(figsize=(12.4, 12.4 / aspect * 1.06), facecolor="white")
        axes = [fig.add_axes([0.005 + 0.5 * (k % 2), 0.475 - 0.465 * (k // 2), 0.49, 0.435])
                for k in range(4)]
        for i, s in enumerate(grid):
            for k, (label, fr) in enumerate(data):
                step, xyz = pick(fr, s)
                col = registry(xyz) if mode == "registry" else xyz[:, 2]
                draw45(axes[k], xyz, col, cmap, vmin, vmax, box, label)
            fig.suptitle("Twisted bubble at interface (2 deg twist, %s)"
                         "  —  step %d      %s, colour = %s"
                         % (os.environ.get("BUBBLE_LABEL", "Hencky blister R = 5 nm, 100 kPa"),
                            int(s), VIEWNAME, cname), fontsize=11.5, y=0.985)
            fig.savefig(os.path.join(tmp, "p%04d.png" % i), dpi=95)
        plt.close(fig)
        encode(tmp, os.path.join(BASE, "bubble-quad-%s.mp4" % mode), len(grid))

    # ---- still: top-down registry at the peak of the hold, plus profiles
    speak = grid[int(0.55 * len(grid))]
    fig = plt.figure(figsize=(15.5, 9.0), facecolor="white")
    fig.suptitle("Twisted bubble, lattice registry at step %d — the moire is a plan-view pattern, "
                 "so this panel is top-down\n"
                 "registry computed identically for all four datasets from atom positions "
                 "(three-cosine structure factor, a = 2.46 A)" % int(speak), fontsize=12)
    prof, hist = [], []
    for k, (label, fr) in enumerate(data):
        step, xyz = pick(fr, speak)
        t = registry(xyz)
        ax = fig.add_subplot(2, 4, k + 1)
        ax.scatter(xyz[:, 0], xyz[:, 1], c=t, s=1.0, cmap="twilight_shifted",
                   vmin=0, vmax=1, linewidths=0)
        ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
        ax.set_title(label, fontsize=9); ax.tick_params(labelsize=7)
        if k == 0:
            ax.set_ylabel("y (A)", fontsize=8)
        ax.set_xlabel("x (A)", fontsize=8)
        r = np.hypot(xyz[:, 0], xyz[:, 1])
        bins = np.arange(0, ZOOM + 5, 5.0)
        idx = np.digitize(r, bins) - 1
        rs, ts = [], []
        for b in range(len(bins) - 1):
            m = idx == b
            if m.sum() > 20:
                rs.append(0.5 * (bins[b] + bins[b + 1])); ts.append(t[m].mean())
        prof.append((label, np.array(rs), np.array(ts)))
        hist.append((label, t))

    ax = fig.add_subplot(2, 2, 3)
    for label, rs, ts in prof:
        ax.plot(rs, ts, lw=1.5, label=label)
    ax.axvline(50, color="#888", ls="--", lw=1)
    ax.text(52, ax.get_ylim()[0], " blister edge (R = 5 nm)", fontsize=7.5, color="#666")
    ax.set_xlabel("radius from blister centre (A)"); ax.set_ylabel("mean registry")
    ax.set_title("radial registry profile — lattice distortion vs distance from the blister",
                 fontsize=9.5)
    ax.legend(fontsize=7.5); ax.grid(alpha=.3)

    ax = fig.add_subplot(2, 2, 4)
    for label, t in hist:
        ax.hist(t, bins=60, range=(0, 1), histtype="step", lw=1.4,
                density=True, label=label)
    ax.set_xlabel("registry"); ax.set_ylabel("density")
    ax.set_title("registry distribution over the whole viewed region", fontsize=9.5)
    ax.legend(fontsize=7.5); ax.grid(alpha=.3)

    plt.subplots_adjust(top=0.86, hspace=0.30, wspace=0.28)
    out = os.path.join(BASE, "bubble-registry-still.png")
    fig.savefig(out, dpi=130)
    print("  wrote", out)

    # numbers for the report
    summary = {}
    for label, t in hist:
        summary[label] = {"mean": float(t.mean()), "std": float(t.std()),
                          "frac_AA_like": float((t < 0.25).mean())}
    json.dump(summary, open(os.path.join(BASE, "registry-summary.json"), "w"), indent=2)
    for k, v in summary.items():
        print("  %-28s mean %.4f  sd %.4f  AA-like %.3f" %
              (k, v["mean"], v["std"], v["frac_AA_like"]))


if __name__ == "__main__":
    main()
