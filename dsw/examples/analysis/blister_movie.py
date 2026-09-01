"""Movie of a single fixed-N blister emerging and settling.

Three panels, because the interesting thing is not the picture but whether it
STOPS: a top-down height map, the radial profile against Hencky, and the centre
height and gas pressure against step so you can see the plateau arrive.

  BLISTER_DIR=... [BLISTER_R=10] [BLISTER_P=160] [BLISTER_ZOOM=200]
  python blister_movie.py
"""
import glob, json, os, struct, subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
BASE = os.environ.get("BLISTER_DIR",
    r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW\movies-blister10")
RNM = float(os.environ.get("BLISTER_R", 10))
PMPA = float(os.environ.get("BLISTER_P", 160))
ZOOM = float(os.environ.get("BLISTER_ZOOM", 200))
MAGIC = 0x31444D47
Z0, E2D, FPS = 3.35, 340.0, 25
R = RNM * 10.0
henckyH0 = 0.709 * (RNM * 1e-9) * np.cbrt(PMPA * 1e6 * RNM * 1e-9 / E2D) * 1e10


def read_gmd1(p):
    b = open(p, "rb").read()
    off = 0 if struct.unpack_from("<I", b, 0)[0] == MAGIC else 12
    _, flags, n, m, nb, step = struct.unpack_from("<6I", b, off)
    q = off + 32
    top = np.array(np.frombuffer(b, "<f4", 3 * n, q).reshape(n, 3))
    return step, top


def radial(xyz, lim, dr=6.0):
    r = np.hypot(xyz[:, 0], xyz[:, 1])
    bins = np.arange(0, lim + dr, dr)
    idx = np.digitize(r, bins) - 1
    rs, zs = [], []
    for k in range(len(bins) - 1):
        m = idx == k
        if m.sum() > 12:
            rs.append(0.5 * (bins[k] + bins[k + 1]))
            zs.append(xyz[m, 2].mean() - Z0)
    return np.array(rs), np.array(zs)


def main():
    files = sorted(glob.glob(os.path.join(BASE, "f*.gmd1")))
    if not files:
        sys.exit("no frames in " + BASE)
    frames = []
    for p in files:
        step, xyz = read_gmd1(p)
        m = (np.abs(xyz[:, 0]) <= ZOOM) & (np.abs(xyz[:, 1]) <= ZOOM)
        frames.append((step, xyz[m]))
    print("  %d frames, steps %d..%d" % (len(frames), frames[0][0], frames[-1][0]), flush=True)

    # centre height over the whole run, for the trace panel
    steps = np.array([f[0] for f in frames], dtype=float)
    hc = np.array([f[1][np.hypot(f[1][:, 0], f[1][:, 1]) < 0.25 * R][:, 2].mean() - Z0
                   for f in frames])
    zmax = float(np.percentile(np.concatenate([f[1][:, 2] for f in frames[::5]]), 99.8))

    tmp = os.path.join(BASE, "_png")
    os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)

    fig = plt.figure(figsize=(14.4, 5.4), facecolor="white")
    for i, (step, xyz) in enumerate(frames):
        fig.clf()
        fig.suptitle("Fixed-N gas blister, R = %g nm at %g MPa — emergence and settling "
                     "(%d sheet atoms, Morse toy model)"
                     % (RNM, PMPA, len(xyz)), fontsize=12, y=0.97)

        ax = fig.add_subplot(1, 3, 1)
        sc = ax.scatter(xyz[:, 0], xyz[:, 1], c=xyz[:, 2], s=1.1, cmap="turbo",
                        vmin=Z0, vmax=zmax, linewidths=0)
        th = np.linspace(0, 2 * np.pi, 200)
        ax.plot(R * np.cos(th), R * np.sin(th), color="w", lw=0.9, ls="--", alpha=.8)
        ax.set_aspect("equal"); ax.set_xlim(-ZOOM, ZOOM); ax.set_ylim(-ZOOM, ZOOM)
        ax.set_title("top-down, step %d" % step, fontsize=10)
        ax.set_xlabel("x (Å)", fontsize=8); ax.set_ylabel("y (Å)", fontsize=8)
        ax.tick_params(labelsize=7)

        ax2 = fig.add_subplot(1, 3, 2)
        rr, zz = radial(xyz, ZOOM)
        ax2.plot(rr, zz, color="#0a58c0", lw=1.8, label="measured")
        hpk = zz[0] if len(zz) else 0
        rho = np.linspace(0, 1, 120)
        ax2.plot(rho * R, hpk * (1 - rho ** 2) ** (2 / 3), color="#d33", lw=1.3, ls="--",
                 label="Hencky shape, same peak")
        ax2.axvline(R, color="#888", lw=1, ls=":")
        ax2.axhline(henckyH0, color="#2a7", lw=1, ls=":",
                    label="Hencky h₀ = %.1f Å" % henckyH0)
        ax2.set_xlim(0, ZOOM); ax2.set_ylim(-1, max(zmax - Z0, 2) * 1.1)
        ax2.set_xlabel("radius (Å)"); ax2.set_ylabel("height above substrate (Å)")
        ax2.set_title("radial profile   (peak %.2f Å)" % hpk, fontsize=10)
        ax2.legend(fontsize=7.5, loc="upper right"); ax2.grid(alpha=.3)

        ax3 = fig.add_subplot(1, 3, 3)
        ax3.plot(steps, hc, color="#7a3fb5", lw=1.4)
        ax3.plot(steps[i], hc[i], "o", color="#7a3fb5", ms=6)
        ax3.axhline(henckyH0, color="#2a7", lw=1, ls=":")
        ax3.set_xlabel("step"); ax3.set_ylabel("centre height (Å)")
        ax3.set_title("does it settle?", fontsize=10)
        ax3.grid(alpha=.3)

        plt.subplots_adjust(top=0.85, wspace=0.30, left=0.05, right=0.985, bottom=0.13)
        fig.savefig(os.path.join(tmp, "p%04d.png" % i), dpi=95)
        if i % 50 == 0:
            print("    rendered %d/%d" % (i, len(frames)), flush=True)
    plt.close(fig)

    out = os.path.join(BASE, "blister10.mp4")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(tmp, "p%04d.png"),
                    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", out], check=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)
    print("  wrote", out)

    # settling report on the last third
    n = len(hc); t = max(1, n // 3)
    a, b = hc[n - 2 * t:n - t].mean(), hc[n - t:].mean()
    drift = abs(b - a) / max(b, 1e-9)
    print("  final centre height %.2f A  (Hencky %.2f A, %+.1f %%)"
          % (b, henckyH0, 100 * (b / henckyH0 - 1)))
    print("  aspect ratio h/R = %.3f" % (b / R))
    print("  drift over the last third: %.2f %%  -> %s"
          % (100 * drift, "SETTLED" if drift < 0.02 else "still moving"))
    json.dump({"RNM": RNM, "PMPA": PMPA, "henckyH0": henckyH0,
               "steps": steps.tolist(), "hCentre": hc.tolist(),
               "final": float(b), "drift": float(drift)},
              open(os.path.join(BASE, "blister10.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
