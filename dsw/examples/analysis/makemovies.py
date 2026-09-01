"""Render the four lift-cycle movies plus a synchronised 2x2 quad.

All five share ONE camera, ONE colour scale and ONE step grid, computed here
across every dataset. Doing it per-movie would let a taller sheet quietly
rescale its own view, and part of the visible difference between the engines
would then be an artefact of the plotting rather than the physics.
"""
import glob, json, os, struct, subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
MOV = r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW\movies"
MAGIC = 0x31444D47
AZ, EL = np.deg2rad(35.0), np.deg2rad(45.0)
ZEX = 3.0
FPS = 25
STEP_GRID = np.arange(0, 2501, 10)


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
    frames, keep = [], None
    for p in sorted(glob.glob(os.path.join(d, "f*.gmd1"))):
        step, top, keep = read_gmd1(p, keep)
        frames.append((step, top, keep))
    return frames


def load_lammps(d):
    def parse(p):
        out = []
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
    sh = parse(os.path.join(d, "sheet.lammpstrj"))
    sb = dict(parse(os.path.join(d, "sub.lammpstrj")))
    frames, keep = [], None
    for step, xyz in sh:
        if step in sb:
            keep = sb[step]
        frames.append((step, xyz, keep))
    return frames


def pick(frames, step):
    """Nearest captured frame to a wanted step."""
    steps = np.array([f[0] for f in frames])
    return frames[int(np.argmin(np.abs(steps - step)))]


def draw(ax, sheet, sub, box, vmin, vmax, title, sub_alpha=0.22, ssize=3.0):
    ax.clear()
    if sub is not None and len(sub):
        us, vs, _ = project(sub)
        ax.scatter(us, vs, s=0.9, c="#cbd0d9", alpha=sub_alpha, linewidths=0, zorder=1)
    u, v, d = project(sheet)
    o = np.argsort(d)
    ax.scatter(u[o], v[o], s=ssize, c=sheet[o, 2], cmap="turbo",
               vmin=vmin, vmax=vmax, linewidths=0, zorder=2)
    ax.set_xlim(box[0], box[1])
    ax.set_ylim(box[2], box[3])
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(title, fontsize=9, pad=1)


def encode(tmp, out, n):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(tmp, "p%04d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "20", out], check=True)
    print(f"  wrote {os.path.basename(out)}  ({n} frames, {n/FPS:.1f} s)", flush=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)


def main():
    runs = [
        ("1-graphene-md-classic", "DSW graphene-md — Morse toy model (CPU)", os.path.join(MOV, "cap-classic"), False),
        ("2-graphene-md-gpu",     "DSW graphene-md-gpu — Morse toy model (OpenCL)", os.path.join(MOV, "cap-gpu"), False),
        ("3-graphene-md-airebo",  "DSW graphene-md — AIREBO (embedded LAMMPS)", os.path.join(MOV, "cap-airebo"), False),
        ("4-lammps-airebo",       "stock LAMMPS — AIREBO (exported deck)", os.path.join(MOV, "cap-airebo"), True),
    ]

    data = []
    for slug, label, d, is_lmp in runs:
        fr = load_lammps(d) if is_lmp else load_dsw(d)
        if not fr:
            print("  NO FRAMES for " + slug); continue
        data.append((slug, label, fr))
        print(f"  loaded {slug}: {len(fr)} frames, steps {fr[0][0]}..{fr[-1][0]}", flush=True)

    # One camera and one colour scale for everything. The view box is MEASURED
    # from the projected coordinates of every dataset, not guessed from the
    # sheet width -- guessing letterboxes the panels.
    zs, us, vs = [], [], []
    for _, _, fr in data:
        for f in fr[::max(1, len(fr) // 15)]:
            zs.append(f[1][:, 2])
            a, b, _ = project(f[1])
            us.append(a); vs.append(b)
            if f[2] is not None and len(f[2]):
                a2, b2, _ = project(f[2])
                us.append(a2); vs.append(b2)
    allz = np.concatenate(zs)
    vmin, vmax = float(np.percentile(allz, 1)), float(np.percentile(allz, 99.5))
    au, av = np.concatenate(us), np.concatenate(vs)
    mu = 0.03 * (au.max() - au.min())
    box = (au.min() - mu, au.max() + mu, av.min() - mu, av.max() + mu)
    print(f"  shared view {box[0]:.0f}..{box[1]:.0f} x {box[2]:.0f}..{box[3]:.0f} A, "
          f"colour {vmin:.2f}..{vmax:.2f} A", flush=True)

    tmp = os.path.join(MOV, "_png")
    os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(os.path.join(tmp, "*.png")):
        os.remove(f)

    # ---- individual movies
    for slug, label, fr in data:
        fig = plt.figure(figsize=(7.2, 6.2), facecolor="white")
        ax = fig.add_axes([0.02, 0.02, 0.96, 0.88])
        for i, s in enumerate(STEP_GRID):
            step, sheet, sub = pick(fr, s)
            draw(ax, sheet, sub, box, vmin, vmax,
                 f"step {step}   ({step/1000:.2f} ps)      45° view, height ×{ZEX:.0f}")
            fig.suptitle(label, fontsize=11.5, y=0.972)
            fig.savefig(os.path.join(tmp, f"p{i:04d}.png"), dpi=100)
        plt.close(fig)
        encode(tmp, os.path.join(MOV, slug + ".mp4"), len(STEP_GRID))

    # ---- quad
    aspect = (box[1] - box[0]) / (box[3] - box[2])
    fig = plt.figure(figsize=(12.4, 12.4 / aspect * 1.06), facecolor="white")
    axes = []
    for k in range(4):
        ax = fig.add_axes([0.005 + 0.5 * (k % 2), 0.475 - 0.465 * (k // 2), 0.49, 0.435])
        axes.append(ax)
    for i, s in enumerate(STEP_GRID):
        for k, (slug, label, fr) in enumerate(data):
            step, sheet, sub = pick(fr, s)
            draw(axes[k], sheet, sub, box, vmin, vmax, label, ssize=2.4)
        fig.suptitle(f"Same lift cycle, four engines — step {int(s)}  ({s/1000:.2f} ps)      "
                     f"45° view, height ×{ZEX:.0f}, shared camera and colour scale",
                     fontsize=12.5, y=0.985)
        fig.savefig(os.path.join(tmp, f"p{i:04d}.png"), dpi=95)
    plt.close(fig)
    encode(tmp, os.path.join(MOV, "quad.mp4"), len(STEP_GRID))
    os.rmdir(tmp)


if __name__ == "__main__":
    main()
