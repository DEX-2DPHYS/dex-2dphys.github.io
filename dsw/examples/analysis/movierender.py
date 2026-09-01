"""Render captured lift-cycle frames as a 45-degree perspective movie.

The projection is done by hand rather than with mplot3d: it is ~10x faster over
a thousand frames, and every movie must share exactly one camera or the
comparison is worthless.

    python movierender.py <framedir-or-dumpdir> <outmp4> <label> [--lammps]

Camera: azimuth 35 deg, elevation 45 deg (Peter's request), painter's algorithm
by depth. Height is exaggerated 3x and the figure says so — the default bump is
10 A on a 120 A sheet, which at true scale is nearly invisible at 45 degrees.
"""
import glob, json, os, struct, subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
MAGIC = 0x31444D47
AZ = np.deg2rad(35.0)
EL = np.deg2rad(45.0)
ZEX = 3.0            # vertical exaggeration, stated on the figure
FPS = 25


def project(xyz):
    """3D -> screen (u, v) plus depth, for azimuth AZ and elevation EL."""
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2] * ZEX
    ca, sa, ce, se = np.cos(AZ), np.sin(AZ), np.cos(EL), np.sin(EL)
    fwd = x * ca + y * sa
    u = -x * sa + y * ca
    v = -fwd * se + z * ce
    depth = fwd * ce + z * se
    return u, v, depth


def read_gmd1(p, keep):
    """(step, sheet, sub, epot). Substrate rides along only when it changed, so
    the caller keeps the last one seen."""
    b = open(p, "rb").read()
    off = 0 if struct.unpack_from("<I", b, 0)[0] == MAGIC else 12
    if struct.unpack_from("<I", b, off)[0] != MAGIC:
        raise ValueError("no GMD1 magic in " + p)
    _, flags, n, m, nb, step = struct.unpack_from("<6I", b, off)
    epot, ekin = struct.unpack_from("<2f", b, off + 24)
    q = off + 32
    top = np.array(np.frombuffer(b, "<f4", 3 * n, q).reshape(n, 3)); q += 12 * n
    if flags & 4:
        q += 8 * n
    sub = keep
    if flags & 2:
        sub = np.array(np.frombuffer(b, "<f4", 3 * m, q).reshape(m, 3))
    return step, top, sub, epot


def read_lammps_dump(path_sheet, path_sub):
    """Return [(step, sheet_xyz)] and one substrate snapshot per available step."""
    def parse(p):
        frames = []
        if not os.path.exists(p):
            return frames
        with open(p) as f:
            while True:
                ln = f.readline()
                if not ln:
                    break
                if not ln.startswith("ITEM: TIMESTEP"):
                    continue
                step = int(f.readline())
                f.readline(); n = int(f.readline())
                while not f.readline().startswith("ITEM: ATOMS"):
                    pass
                d = np.empty((n, 4))
                for k in range(n):
                    d[k] = np.array(f.readline().split()[:4], dtype=float)
                d = d[np.argsort(d[:, 0])]
                frames.append((step, d[:, 1:4]))
        return frames
    return parse(path_sheet), parse(path_sub)


def draw(ax, sheet, sub, lim, vmin, vmax):
    ax.clear()
    if sub is not None and len(sub):
        us, vs, ds = project(sub)
        ax.scatter(us, vs, s=1.0, c="#9aa0ad", alpha=0.30, linewidths=0, zorder=1)
    u, v, d = project(sheet)
    o = np.argsort(d)
    ax.scatter(u[o], v[o], s=2.6, c=sheet[o, 2], cmap="turbo",
               vmin=vmin, vmax=vmax, linewidths=0, zorder=2)
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim * 0.62, lim * 0.78)
    ax.set_aspect("equal")
    ax.axis("off")


def main():
    src = sys.argv[1]
    outmp4 = sys.argv[2]
    label = sys.argv[3]
    is_lammps = "--lammps" in sys.argv

    tmp = os.path.join(os.path.dirname(outmp4), "_png_" + os.path.basename(outmp4).replace(".mp4", ""))
    os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)

    frames = []
    if is_lammps:
        sh, sb = read_lammps_dump(os.path.join(src, "sheet.lammpstrj"),
                                  os.path.join(src, "sub.lammpstrj"))
        subs = dict(sb)
        keep = None
        for step, xyz in sh:
            if step in subs:
                keep = subs[step]
            frames.append((step, xyz, keep, None))
        meta = {}
    else:
        meta = json.load(open(os.path.join(src, "meta.json")))
        keep = None
        for p in sorted(glob.glob(os.path.join(src, "f*.gmd1"))):
            step, top, keep, epot = read_gmd1(p, keep)
            frames.append((step, top, keep, epot))

    if not frames:
        sys.exit("no frames in " + src)

    allz = np.concatenate([f[1][:, 2] for f in frames[::max(1, len(frames) // 20)]])
    vmin, vmax = float(np.percentile(allz, 1)), float(np.percentile(allz, 99.5))
    xy = frames[0][1]
    lim = 1.15 * max(np.abs(xy[:, 0]).max(), np.abs(xy[:, 1]).max())

    fig = plt.figure(figsize=(7.2, 6.0), facecolor="white")
    ax = fig.add_axes([0.02, 0.02, 0.96, 0.90])
    for i, (step, sheet, sub, epot) in enumerate(frames):
        draw(ax, sheet, sub, lim, vmin, vmax)
        fig.suptitle(label, fontsize=12, y=0.975)
        ax.set_title(f"step {step}   ({step/1000:.2f} ps)     "
                     f"45° view, height ×{ZEX:.0f}", fontsize=9, pad=2)
        fig.savefig(os.path.join(tmp, f"p{i:04d}.png"), dpi=100)
        if i % 50 == 0:
            print(f"  {label}: rendered {i}/{len(frames)}", flush=True)
    plt.close(fig)

    cmd = [FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
           "-i", os.path.join(tmp, "p%04d.png"),
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", outmp4]
    subprocess.run(cmd, check=True)
    print("wrote", outmp4, f"({len(frames)} frames, {len(frames)/FPS:.1f} s)")
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)
    os.rmdir(tmp)


if __name__ == "__main__":
    main()
