# Structural Superlubricity — a DSW plugin

A port of the 10321 prototype **`superlubricity-moire-md.html`** ("vdW
calculator — moiré lateral MD") into a native DSW experiment.

> v1 of this plugin was ported from the wrong file — the small
> `sim-10321-superlubricity.html`, which asserts a Gaussian registry index and
> computes no energy at all. v2 is the real thing.

## What it computes

Two rigid graphene layers — a square bottom sheet, a circular top flake — at
interlayer separation *d*. Every top atom against every bottom atom through a
Lennard-Jones 12-6 pair potential in SI units:

```
V(r) = C12/r¹² − C6/r⁶ ,   r² = dx² + dy² + d²
C12  = ½ C6 r₀⁶          (so dV/dr = 0 at r₀ = 3.40 Å)
```

C6 = 2.45×10⁻⁷⁸ J·m⁶ is the graphene-fitted value and the only free parameter.
The total energy **U** and the energy per unit area **U/A** are the point: twist,
lateral offset and spacing all move the layers around this landscape.

**The same pass returns the lateral gradient.** dU/dtx and dU/dty cost two extra
multiply-adds per pair, and having them exactly turns three jobs into one
potential: xy relaxation becomes gradient descent instead of a pattern search,
the lateral force is −∇U directly (so the force readout is exact and needs no
fitted spring or damping), and sweeps get the restoring force for free.

## Hamaker

Hamaker's construction is the *same* dispersion physics done as a continuum
integral instead of a lattice sum. For two 2D sheets of areal density n,

```
W(d) = −π C6 n² / (2 d⁴)
```

(2D-2D goes as d⁻⁴; the familiar −A/12πd² is the 3D half-space case.) It is used
here for two things and deliberately not for a third:

- **An exact analytic tail.** Summing r⁻⁶ over a plane converges only as R⁻⁴, so
  a finite window throws away real binding. The continuum integral of everything
  outside the covered radius, `E_tail/atom = −π C6 n / 2(R²+d²)²`, puts it back.
- **A sanity check on C6.** The implied 3D constant A = π²C6ρ² comes out at
  **3.14×10⁻¹⁹ J**, inside the measured graphite range of 2.4–4.7×10⁻¹⁹ J.
- **Not the corrugation.** The continuum average is precisely the step that
  erases registry: W(d) has no θ or offset dependence at all. Superlubricity
  lives entirely in what Hamaker averages away, which is why the lattice sum
  cannot be replaced by it. (The probe asserts this: the tail is bit-identical
  across twist and offset.)

## What the port fixed

- **The prototype's fast neighbour mode was mis-centred.** It windowed bottom
  cells around the *top* cell's own index, which is only the same cell when both
  layers are the same size. With a 12-cell flake centred on a 20-cell sheet the
  window sat ~4 cells (10 Å) off target and lost **57.4%** of the binding energy
  at N=4 — the reason its UI carried "increase if energy looks wrong". Centring
  the window on the cell the atom is actually over brings that to **0.89%**, and
  the Hamaker tail to **0.54%**.
- **Relaxation now backtracks.** Fixed-step descent orbits the minimum at the
  step radius; the residual force after "relaxing" was 7.2×10⁻³ nN. With a
  backtracking line search it is **2.7×10⁻⁵ nN**.
- **Nothing blocks.** A 250×250 system is ~1.2×10¹⁰ pair terms, far more than
  one frame. The sum carries a cursor and runs in slices; relaxations, sweeps
  and MD are state machines on top of it. Frames and readouts keep flowing at
  any size and **Stop** always responds — neither of which the browser version
  could manage, since it drove everything from `await requestAnimationFrame`.
- Built with `-fno-fast-math`: reciprocal approximations have no business in a
  calculator whose output is the number you quote.

## The panel

Geometry (N bottom/top, d, θ, offsets) · vdW model (neighbour mode, tail, C6,
metric) · relaxation (xy, height, both alternating) · lateral MD (spring k, max
steps, amplification) · automated modes (rotation sweep 0–180°, translate ±12 Å,
stop) · energy chart replottable against time, θ or offset · registry map,
displacement arrows, atom size, zoom · **light and dark themes**, including the
natively-rendered stage, which is told the theme so it repaints to match.

## Defaults

Light theme, **xy + height relaxation on**, registry map on. The relaxation
default matters: without it the offset stays wherever it was, and at a
commensurate angle that is AA stacking — the energy *maximum* — so the twist
sweep comes out upside down and the energies are only qualitative. With
relaxation on, each angle settles into its own minimum (the offset relaxes to
~1.42 Å, the C-C bond length, i.e. the AB site) and the commensurate angles
appear as the deep lock-in minima they are.

## Three bugs the relaxing sweep hid

All three only appeared on the default path, which the first probe never
exercised because it disabled relaxation before sweeping:

1. **The sweep never finished.** Deriving "which relaxation am I in" from
   `relax_phase` deadlocks: the height phase sets it to 1, the lateral branch
   reads "not 0", restarts itself, and the sweep spins without ever recording
   a point. Fixed with explicit sweep stages.
2. **Gradient descent cannot leave a symmetry point.** At a commensurate angle
   with zero offset the layers are in perfect AA registry, where ∇U is exactly
   zero — so the flake stayed pinned on the energy maximum at θ=0, the angle
   that matters most. The prototype never hit this because a 4-candidate
   pattern search samples the neighbourhood instead of following the gradient,
   and escapes by construction. Fixed with a symmetry-breaking nudge.
3. **The nudge then caused a drift.** `begin()` was followed by `step()` in the
   same iteration, so the step ran on the pre-nudge gradient and did nothing to
   undo it; and the "is this stationary?" threshold was absolute (1e-14) where
   a relaxed minimum sits at ~1e-24, so it fired at *every* angle. The offset
   walked off the sheet at exactly +0.28, +0.16 Å per step. Fixed by
   re-evaluating before stepping and judging stationarity relative to the
   sum's own rounding (1e-12·|U|).

Lesson: dumping the actual (θ, tx, ty, d, U/A) trajectory found all of this in
one run, where staring at the code had not.

## Build

Self-contained — `src/` vendors `dex_plugin.h` and `dex_msg.h`.

```powershell
g++ -shared -std=c++17 -O3 -fno-fast-math -fopenmp -static -static-libgcc `
    -static-libstdc++ -o superlubricity.dll src/plugin.cpp -Isrc
```

or `cmake -B <dir> -S . ; cmake --build <dir> --config Release`.

**Stop `dsw.exe` first** — the running host holds the DLL open, so the link
fails with "Permission denied", and a replaced binary needs a host restart.

## Verifying

`probe-v2.js` (kept in the session scratchpad) drives a real WebSocket session
and runs 38 checks, the important one being that **U is compared against an
independent JavaScript re-implementation of the prototype's own `computeCPU()`**
— agreement is to the 7 significant digits the wire format carries, at three
different sizes, twists and offsets, with atom and pair counts matching exactly.
It also checks the analytic gradient against finite differences taken in that
reference (differencing the transmitted U is hopeless — dU ~1e-21 on a 7-digit
value, which produced suspiciously round "agreement" until it was fixed), the
Hamaker tail against its closed form, that relaxation lowers U and leaves |F|≈0,
that sweeps produce lock-in minima at 0° and 60°, that Stop halts a sweep, that
MD moves atoms within the clamp, and that the two themes really render
differently.
