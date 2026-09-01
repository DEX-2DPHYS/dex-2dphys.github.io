# Graphene MD (GPU) — a DSW plugin

The bilayer-graphene sandbox's **classic Morse engine ported to the GPU**, as a
separate bundle so the LAMMPS-based `graphene-md` (another session's work, and
a 15 MB static link) stays untouched. Same physics, same UI, same wire
protocol — the compute moved.

## How the GPU path works

- **OpenCL, compiled at runtime through the driver.** This machine has no CUDA
  toolkit and no OpenCL SDK, and needs neither: `OpenCL.dll` ships with every
  GPU driver, is loaded with `LoadLibrary`, and the ~20 entry points are
  resolved by hand (`src/clmd.h`). The kernels are compiled by the driver when
  the plugin first needs them. If any of that fails — no GPU, no driver, RDP
  session — the plugin reports why and runs the ordinary OpenMP path. The DLL
  itself never fails to load.
- **The kernels are line-for-line ports** of the CPU loops: Morse bonds, the
  sp² angle gather with packed roles, the bending umbrella, sheet–substrate
  LJ, edge collar, gas-pocket pressure, both Verlet half-kicks with the
  velocity/displacement caps, and the substrate lift profiles (gauss / mesa /
  Hencky bubble). One structural change: the LJ walks the static 2D substrate
  cell list directly instead of through Verlet lists — the cell list depends
  only on substrate x,y, which never change, so there is no rebuild machinery
  on the device at all.
- **Division of labour per frame batch:** GPU does lift, bending precompute,
  forces, kicks, drift, edge pinning. CPU keeps the elevation state machine,
  bond breaking/re-forming (once per batch — a bond takes many steps to
  stretch to the break length, so the cadence is invisible), the moiré
  registry colouring, and the wire protocol. Positions, per-atom v² and
  potential energy come back once per batch.
- **float32 on the device.** The T1000 runs float64 at 1/32 rate, so doubles
  would be slower than the CPU. Two precision lessons are baked in: the
  kernels are built **without** `-cl-fast-relaxed-math` (it swaps `exp()` for
  a low-precision native op, and Morse is nothing but exponentials — measured
  as a 2 % shift in total potential energy), and energies are summed in double
  on the host.

## Measured (NVIDIA T1000, 4 GB, vs 36-thread OpenMP CPU path)

| sheet | atoms | CPU ms/step | GPU ms/step | speed-up |
|---|---|---|---|---|
| 12 nm | ~5 500 | 3.2 | 0.55 | **5.8×** |
| 24 nm | ~22 000 | 13.1 | 2.1 | **6.3×** |
| 48 nm | ~88 000 | 42.2 | 8.2 | **5.1×** |

Physics parity against the CPU reference over a 400-step mesa lift: mean
height within 0.09 Å, potential energy within 1.7 %, temperature within the
chaotic scatter. (Trajectories cannot match step-for-step — the dynamics are
chaotic and float32 diverges from float64 — so aggregates are what is
comparable.) Verified again live through the host: device engages in Auto,
1.07 ms/step at 22 000 atoms, and the backend can be switched mid-run in both
directions.

The Compute selector (Auto / GPU / CPU) sits next to the speed slider; the
stats line names the device actually in use.

## AIREBO — and what GPU can and cannot do

Short version: **AIREBO on this GPU is not realistic, and nothing is lost.**
There is no `airebo/gpu` in LAMMPS (the GPU package accelerates pair-style
potentials like `sw` and `tersoff`; the reactive many-body ones — AIREBO,
REBO, ExTeP — have never been ported), and writing AIREBO in OpenCL from
scratch is a multi-week project whose validation would be a paper of its own.
AIREBO therefore stays where it is: the `graphene-md` bundle's embedded LAMMPS,
on the CPU, quantitatively correct at the sizes it is used at. The honest
split is:

- **this bundle** — qualitative mechanics (draping, wrinkling, tearing,
  blisters) at 5–20× the size or speed;
- **`graphene-md`** — quantitative energetics on real potentials, CPU-bound.

The one cheap LAMMPS-GPU win, if ever wanted: the SW-parameterised materials
(WS2, MoTe2, WTe2) do have `sw/gpu`, so a LAMMPS rebuild with `PKG_GPU` in
OpenCL mode would accelerate exactly those. Not done here — the LAMMPS bundle
is another session's workspace.

## ML potentials (fairchem / UMA and friends) — assessment

The force evaluation here is deliberately one pluggable stage with the same
contract an ML potential fills: **positions in → forces + energy out**, with
the integrator, neighbour machinery, transfers and UI all indifferent to where
the forces came from. That is also exactly ASE's calculator interface, which
is how fairchem models are served. So the architecture is ready; the physics
and hardware set the real limits:

- **Compatibility:** fairchem models (UMA, eSEN, EquiformerV2…) are PyTorch.
  The clean integration is **not** linking libtorch into the plugin (2 GB of
  DLLs, CUDA-version coupling) but a **Python sidecar**: a small process
  running the fairchem ASE calculator, talking to the plugin over a local
  socket with the same positions→forces contract. The plugin's batch loop
  already blocks per batch, so a blocking round-trip fits naturally, and the
  CPU/GPU/ML choice becomes a third entry in the existing Compute selector.
- **Realism on a T1000 (4 GB):** UMA-small runs, but at graphene-sandbox sizes
  the throughput is seconds per step for thousands of atoms — interactive MD
  is off the table. What IS realistic: **hundreds of atoms interactively**
  (~1–5 steps/s), or "relax this structure / single-point energy" buttons on
  any size that fits memory. DFT-level accuracy where the Morse model is
  qualitative and AIREBO is unparameterised — e.g. defects, edges, adsorbates.
- **Licensing note:** the UMA weights are gated behind a Meta licence
  agreement (HuggingFace login) — fine for research use here, but the weights
  cannot be redistributed inside the bundle; the sidecar must fetch them under
  Peter's account.

Recommended order if pursued: sidecar protocol first (it is ~200 lines and
independently testable), UMA-small single-point energies as a button, then
small-system interactive dynamics.

## Build

```powershell
g++ -shared -std=c++17 -O3 -fno-fast-math -fopenmp -static -static-libgcc `
    -static-libstdc++ -o graphene-md-gpu.dll src/plugin.cpp -Isrc
```

No GPU libraries at build time — `OpenCL.dll` is found at runtime. Stop
`dsw.exe` first; the host holds the DLL open.

## Verifying

`gputest.cpp` (session scratchpad) loads the DLL through the real ABI and runs
the CPU-vs-GPU comparison in the table above; `probe-gpu-live.js` drives a
session through the host and asserts the device engages, mid-run backend
switches work, and frames flow. Traps already hit so they need not be hit
again: the plugin id must differ from `graphene-md` or the launcher silently
drops it as a duplicate; and through the host, the GMD1 packed-state block
starts at byte 12, after the DXF1 wrapper.
