# Graphene / hBN / MoS₂ Molecular Dynamics — a DSW plugin

The bilayer-sandbox experiment, extended 2026-08-24 from graphene-only to
three 2D materials, with the interatomic forces supplied by **real published
many-body potentials** running inside an embedded LAMMPS.

## Materials and potentials

| Material | Engine | Potential file | Reference |
|---|---|---|---|
| Graphene | classic | — (Morse toy model, the original) | |
| Graphene | lammps | `potentials/CH.airebo` | Stuart, Tutein, Harrison (2000) — AIREBO |
| hBN | lammps | `potentials/BN.extep` | Los et al., PRB 96, 184108 (2017) — ExTeP |
| MoS₂ | lammps | `potentials/MoS.rebomos` | Liang, Phillpot, Sinnott, PRB 79, 245110 (2009; erratum 2012) |
| WS₂ | lammps | `potentials/ws2.jiang3t.sw` | Jiang & Zhou, arXiv:1704.03147 — SW (reduced, see below) |
| MoTe₂ | lammps | `potentials/mote2.jiang3t.sw` | Jiang & Zhou, arXiv:1704.03147 — SW (reduced) |
| WTe₂ | lammps | `potentials/wte2.jiang3t.sw` | Jiang & Zhou, arXiv:1704.03147 — SW (reduced) |

**The `.jiang3t.sw` files are generated, not downloaded** (`gensw.js` in the
session scratchpad; parameters verbatim from the paper's LAMMPS tables, which
were recovered from the arXiv source tarball — Jiang's own supplemental site
is dead and OpenKIM has no models for these species). They are a **3-type
reduced realization**: exact bonds, exact same-plane X–M–X and M–X–M bending;
the vertical cross-plane X–M–X′ bending class is omitted (Jiang's full scheme
needs 12 atom types solely to include it without spurious oblique terms).
Cost, measured against the paper's own moduli: C11 within ~6–11 % soft —
WS₂ 114 vs 121.5 N/m, MoTe₂ 76.6 vs 79.8, WTe₂ 76.2 vs 82.7.

**RuCl₃ is not included**: no published classical interatomic potential
exists for it (checked OpenKIM and the literature) — it is a Kitaev-magnet
material studied with DFT and spin models, and inventing parameters would
just be a mislabeled toy.

**Why not "AIREBO for everything":** AIREBO is parameterized for C and H
only — no B, N, Mo or S exists for it. ExTeP and REBO-MoS₂ are the
literature-standard bond-order potentials filling the same role for hBN and
MoS₂. All three files are verbatim from the LAMMPS distribution
(`lammps/potentials`, UNITS: metal). `WenShirodkarPlechac_2017_MoS2.params`
(+ CDDL licence, citation) is the OpenKIM Stillinger–Weber MoS₂ model, kept
as reference material.

## Architecture

The C++ plugin embeds LAMMPS through its C library interface (`library.h`):

- One serial LAMMPS instance per build (`units metal`, `boundary m m m` —
  **not `s`**: shrink-wrap collapses a flat sheet to zero thickness and
  neighbour binning dies with "box size << cutoff").
- The sheet's many-body forces are LAMMPS's; everything the sandbox adds —
  rigid-substrate LJ, gas-pocket pressure, soft edge collar, protrusion
  kinematics — is injected per step through `fix external pf/callback`, so
  both force sources combine inside LAMMPS's own velocity Verlet.
- On build the flake is energy-minimized and started cold: a cropped flake's
  undercoordinated rim carries real bond-order strain, and released as
  kinetic energy it reads as thousands of kelvin (measured 9500 K for MoS₂
  before this was added).
- **The trilayer X-column sits on the (a₁+a₂)/3 hollow — not (a₁+2a₂)/3.**
  The wrong site puts X 2.8 Å from M in-plane, outside every bond well: SW
  reads 20× too soft, and rebomos "worked" only by violently reconstructing
  the wrong lattice (that was the real root of the original MoS₂
  instability). On the correct lattice rebomos's relaxed S-plane height is
  ±1.62 Å and the crystallographic ±1.564 start is a gentle 26 meV/atom
  from equilibrium.
- `tx/ty/tz` shadow the LAMMPS positions, so rendering, the registry
  colouring and the wire protocol are engine-agnostic. Frame flag bit 8
  carries a per-atom species block; the UI colours B/N and Mo/S by element.
- hBN and MoS₂ have no Morse parameterization here and always run on
  LAMMPS; graphene runs on either engine (`engine: "classic" | "lammps"`).

Verified: AIREBO graphene −7.41 eV/atom, ExTeP hBN −6.690 eV/atom (both the
papers' fitted values, periodic); offline ABI harness (41 checks) plus a live
WebSocket probe through the host — all materials build, run, and stream both
species.

## Building

Needs a LAMMPS static library with the MANYBODY package (that package holds
airebo, extep, rebomos, tersoff, sw). Built here from the `stable` branch
(22 Jul 2025 Update 5) with MinGW-w64 — **no admin needed anywhere**:

```powershell
git clone --depth 1 -b stable https://github.com/lammps/lammps C:\Users\pbog\b\lammps
cmake -G Ninja -S C:\Users\pbog\b\lammps\cmake -B C:\Users\pbog\b\lammps\build `
  -D CMAKE_BUILD_TYPE=Release -D PKG_MANYBODY=yes -D PKG_OPENMP=yes -D BUILD_MPI=no `
  -D BUILD_OMP=yes -D BUILD_SHARED_LIBS=no -D BUILD_TOOLS=no
ninja -C C:\Users\pbog\b\lammps\build     # ~2.5 min, liblammps.a ≈ 28 MB
```

**PKG_OPENMP is not optional.** It provides the threaded `/omp` pair styles
(`suffix omp` in the plugin), and the plugin passes an explicit thread count
(`package omp N`, N = physical cores) because LAMMPS defaults to ONE thread
when `OMP_NUM_THREADS` is unset. Without this, a 12 nm AIREBO sheet costs
28 ms/step and its build minimize 17+ s — which blocks the plugin's whole
message queue and looks like a dead experiment (this shipped once; measured
after: 4.6 ms/step, 0.9 s build). extep and rebomos have no `/omp` variant
and fall back to serial — hBN is the slowest of the three at large sizes.

Then the plugin (from this folder; **stop dsw.exe first** — it holds the DLL):

```powershell
g++ -shared -std=c++17 -O3 -fno-fast-math -fopenmp -static -static-libgcc `
    -static-libstdc++ -o graphene-md.dll src/plugin.cpp -Isrc `
    -IC:\Users\pbog\b\lammps\src -LC:\Users\pbog\b\lammps\build -llammps -lpsapi
```

`-lpsapi` is for LAMMPS's memory-usage reporting. The DLL is ~14 MB (the
linker keeps only what the four pair styles pull in).

**Licence note:** LAMMPS is GPLv2; statically linking it makes this plugin
binary GPL. Fine here — the bundle ships its full source.

## Traps hit (so you don't again)

- `boundary s s s` + flat sheet → "Cannot use neighbor bins". Use `m m m`.
- Skipping the initial minimize → edge strain becomes heat (thousands of K).
- The plugin finds its parameter files relative to its own DLL path
  (`GetModuleFileName` → `<bundle>/potentials/`), so the bundle works from
  any library folder — but don't rename `potentials/`.
- A `\"pe\"` of exactly 0 right after build meant the thermo hadn't been
  computed yet — fetch it once after the setup `run 0`.
