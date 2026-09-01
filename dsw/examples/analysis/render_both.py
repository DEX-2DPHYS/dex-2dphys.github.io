"""Plugin vs LAMMPS on the same 100 nm lift cycle, drawn identically.

Both engines integrate the same Morse/harmonic-angle model over the same
ramp-hold-return schedule; the plugin adds a bending umbrella that has no
LAMMPS analogue, which is the one known physics difference.
"""
import os, re, struct, sys
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = r"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW\graphene_md_exports_100nm"
MAGIC = 0x31444D47


def read_gmd1(p):
    """Return (frame, epot, sheet_xyz, sub_xyz_or_None) from a packed frame."""
    b = open(p, "rb").read()
    off = 0
    if struct.unpack_from("<I", b, 0)[0] != MAGIC:
        off = 12                       # host wrapper: DXF1 + w + h
        if struct.unpack_from("<I", b, off)[0] != MAGIC:
            raise ValueError("no GMD1 magic in " + p)
    _, flags, n, m, nb, frame = struct.unpack_from("<6I", b, off)
    epot, ekin = struct.unpack_from("<2f", b, off + 24)
    q = off + 32
    top = np.frombuffer(b, "<f4", 3 * n, q).reshape(n, 3); q += 12 * n
    if flags & 4: q += 8 * n
    sub = None
    if flags & 2:
        sub = np.frombuffer(b, "<f4", 3 * m, q).reshape(m, 3); q += 12 * m
    return frame, epot, np.array(top), (np.array(sub) if sub is not None else None)


def read_dump(p, want_steps):
    """Parse a LAMMPS custom dump (id x y z) -> {step: xyz sorted by id}."""
    out = {}
    if not os.path.exists(p):
        return out
    with open(p) as f:
        while True:
            ln = f.readline()
            if not ln:
                break
            if not ln.startswith("ITEM: TIMESTEP"):
                continue
            step = int(f.readline())
            f.readline(); n = int(f.readline())
            for _ in range(5):
                ln = f.readline()
                if ln.startswith("ITEM: ATOMS"):
                    break
            if step not in want_steps:
                for _ in range(n):
                    f.readline()
                continue
            d = np.empty((n, 4))
            for k in range(n):
                d[k] = np.array(f.readline().split()[:4], dtype=float)
            d = d[np.argsort(d[:, 0])]
            out[step] = d[:, 1:4]
    return out


def hmap(ax, xyz, lim, vmin, vmax, title):
    sel = (np.abs(xyz[:, 0]) <= lim) & (np.abs(xyz[:, 1]) <= lim)
    s = xyz[sel]
    im = ax.scatter(s[:, 0], s[:, 1], c=s[:, 2], s=1.2, cmap="turbo",
                    vmin=vmin, vmax=vmax, linewidths=0)
    ax.set_aspect("equal"); ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim)
    ax.set_title(title, fontsize=9.5)
    ax.tick_params(labelsize=7)
    return im


def profile(xyz, halfwidth=8.0, lim=220.0):
    """Height along y ~ 0, averaged in bins of x."""
    sel = np.abs(xyz[:, 1]) < halfwidth
    s = xyz[sel]
    bins = np.arange(-lim, lim + 4, 4.0)
    idx = np.digitize(s[:, 0], bins) - 1
    ok = (idx >= 0) & (idx < len(bins) - 1)
    xs, zs = [], []
    for k in range(len(bins) - 1):
        m = ok & (idx == k)
        if m.sum() >= 3:
            xs.append(0.5 * (bins[k] + bins[k + 1])); zs.append(s[m, 2].mean())
    return np.array(xs), np.array(zs)


# ---------------------------------------------------------------- load
pk = os.path.join(BASE, "plugin-peak.gmd1")
en = os.path.join(BASE, "plugin-end.gmd1")
for p in (pk, en):
    if not os.path.exists(p):
        sys.exit("missing " + p + " (plugin run not finished)")
fpk, epk, shpk, subpk = read_gmd1(pk)
fen, een, shen, suben = read_gmd1(en)

L_PEAK, L_END = 1250, 2500
lam = read_dump(os.path.join(BASE, "sheet.lammpstrj"), {L_PEAK, L_END})
have_lam = L_PEAK in lam and L_END in lam

thermo = {"step": [], "pe": [], "T": []}
lo = os.path.join(BASE, "lmp-out.txt")
if os.path.exists(lo):
    on = False
    for ln in open(lo):
        if ln.startswith("   Step"):
            on = True; continue
        if on:
            m = re.match(r"\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)", ln)
            if not m:
                on = False; continue
            thermo["step"].append(int(m.group(1)))
            thermo["pe"].append(float(m.group(3)))
            thermo["T"].append(float(m.group(5)))

# ---------------------------------------------------------------- figure
LIM = 220.0
zs = [shpk[:, 2], shen[:, 2]]
if have_lam:
    zs += [lam[L_PEAK][:, 2], lam[L_END][:, 2]]
allz = np.concatenate(zs)
vmin, vmax = np.percentile(allz, 0.5), np.percentile(allz, 99.9)

fig = plt.figure(figsize=(15, 8.6), facecolor="white")
fig.suptitle(
    "Same 100 nm lift cycle, two engines — 381 704 sheet + 548 925 substrate atoms (930 629 total)\n"
    "Gaussian protrusion ramped to 10 Å over 997 steps, held 500, returned over 1000 — "
    "DSW plugin (classic Morse) vs the exported deck in stock LAMMPS",
    fontsize=11.5)

rows = [("DSW plugin", shpk, shen), ("LAMMPS", lam.get(L_PEAK), lam.get(L_END))]
for r, (nm, a, b) in enumerate(rows):
    for c, (xyz, when, st) in enumerate([(a, "peak of hold", L_PEAK), (b, "cycle complete", L_END)]):
        ax = fig.add_subplot(2, 3, 3 * r + c + 1)
        if xyz is None:
            ax.text(.5, .5, nm + "\nnot available yet", ha="center", va="center",
                    fontsize=10, transform=ax.transAxes); ax.set_xticks([]); ax.set_yticks([])
            continue
        im = hmap(ax, xyz, LIM, vmin, vmax,
                  f"{nm} — {when}   max z = {xyz[:,2].max():.1f} Å")
        if c == 0:
            ax.set_ylabel(nm + "\ny (Å)", fontsize=9)
        ax.set_xlabel("x (Å)", fontsize=8)
        if r == 0 and c == 1:
            fig.colorbar(im, ax=ax, shrink=.85, pad=.02, label="sheet height z (Å)")

ax = fig.add_subplot(2, 3, 3)
for xyz, lab, st in [(shpk, "plugin", "-"), (lam.get(L_PEAK), "LAMMPS", "--")]:
    if xyz is None: continue
    x, z = profile(xyz, lim=LIM)
    ax.plot(x, z, st, lw=1.6, label=lab)
ax.set_title("centre profile at peak of hold", fontsize=9.5)
ax.set_xlabel("x (Å)"); ax.set_ylabel("mean z (Å)"); ax.legend(fontsize=8); ax.grid(alpha=.3)

ax = fig.add_subplot(2, 3, 6)
for xyz, lab, st in [(shen, "plugin", "-"), (lam.get(L_END), "LAMMPS", "--")]:
    if xyz is None: continue
    x, z = profile(xyz, lim=LIM)
    ax.plot(x, z, st, lw=1.6, label=lab)
ax.set_title("centre profile after the protrusion has returned", fontsize=9.5)
ax.set_xlabel("x (Å)"); ax.set_ylabel("mean z (Å)"); ax.legend(fontsize=8); ax.grid(alpha=.3)

plt.subplots_adjust(top=.86, hspace=.30, wspace=.28)
out = os.path.join(BASE, "plugin-vs-lammps.png")
fig.savefig(out, dpi=130)
print("wrote", out)
print(f"plugin peak frame {fpk} Epot {epk:.1f} eV, end frame {fen} Epot {een:.1f} eV")
print(f"plugin max z: peak {shpk[:,2].max():.2f} A, end {shen[:,2].max():.2f} A")
if have_lam:
    print(f"LAMMPS max z: peak {lam[L_PEAK][:,2].max():.2f} A, end {lam[L_END][:,2].max():.2f} A")
