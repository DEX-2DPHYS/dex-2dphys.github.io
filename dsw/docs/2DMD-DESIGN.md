# 2DMD — the combined plugin

**Read this before touching `graphene-md`, `graphene-md-gpu` or `moire-bubble`.**
Written 2026-09-01. Rendered version:
https://claude.ai/code/artifact/137afaf8-7cd8-4999-a4db-e52ab1142108

One plugin, three engines, and a stack of layers instead of "a sheet on a
substrate". Every number quoted here was measured, not estimated.

## Why

| plugin | core lines | live layers | engines | gas | materials |
|---|---|---|---|---|---|
| `graphene-md` | 2060 | 1 | Morse CPU, **LAMMPS** | open loop + protrusions | all six |
| `graphene-md-gpu` | 1373 | 1 | Morse OpenCL | open loop | graphene |
| `moire-bubble` | 774 | **2** | Morse CPU | **fixed-N + peel front** | graphene |

~4200 lines of core across three trees, holding three copies of the same Morse
force loop. They have drifted, and every feature added on 2026-09-01 had to be
written twice.

Capability gaps that matter:
- `graphene-md` has ONE live sheet on a RIGID substrate ("moves only when a
  protrusion lifts it"). It cannot do a bubble between two live layers, a bubble
  under a bilayer, or **moiré reconstruction** — a twisted pair only relaxes into
  AB domains with soliton walls if BOTH layers can move. That last one is the
  scientific point of the twisted-bubble work.
- `moire-bubble` can do all three and has neither LAMMPS nor an exporter, so its
  results have **no independent check at all**.

## The keystone: geometry becomes a list

Do this first; everything else is cheap after it and expensive before it.

```cpp
struct Layer {
    std::vector<double> x, y, z, vx, vy, vz, fx, fy, fz;
    std::vector<double> x0, y0, z0r;   // as-built reference
    Material mat;  double twistRad, zOffset;
    bool mobile;                        // substrate = false
};
std::vector<Layer> layers;              // [0] is the substrate
```

Monolayer on substrate = two entries, one mobile. Twisted bilayer = three.
"Gas below the bilayer" becomes "gas between layer 0 and layer 1" — not a
special case. Layer count becomes a parameter rather than an architecture.

## Engines

```cpp
struct Engine {
    virtual void prepare(const System&)      = 0;
    virtual void step(System&, int nSteps)   = 0;
    virtual Caps caps() const                = 0;   // layers, materials, gas
};
```

| engine | layers | materials | notes |
|---|---|---|---|
| Morse CPU | any | graphene, hBN geometry | reference path; must stay bit-identical at one mobile layer |
| Morse GPU | any | graphene, hBN geometry | five OpenCL kernels exist, all assume one sheet |
| LAMMPS | any | all six (AIREBO / ExTeP / REBO / SW) | GPL by linkage |

**Not every combination is physical.** The toy Morse model is a honeycomb with
two atoms per cell; MoS2 is a trilayer S-Mo-S and cannot be expressed in it. A
capability table drives the UI so picking MoS2 disables the toy engines AND SAYS
WHY. A dropdown that offers an impossible combination is a control that lies.

## The LAMMPS windfall

LAMMPS has no notion of "the sheet" — a second live layer is another group of
atoms, and interlayer vdW is already `pair_style hybrid ... lj/cut`. Bilayer
support therefore costs little more than group bookkeeping, and twisted bubbles
gain real potentials and a real check. This also collapses the outstanding
exporter task: a deck for N layers is the same job as running N layers.

## Gas

| model | pressure | footprint | status |
|---|---|---|---|
| `bubble` | prescribed on a fixed disc | pinned | keep for comparison, label approximate (carries the 25x `betweenBoost` fudge) |
| `bubbleN` | p = NkT/V, V measured | pinned | keep |
| `bubbleFree` | p = NkT/V, V measured | follows the peel front | **default** |

Only `bubbleFree` is comparable with experiment: peeling is the mechanism
adhesion energy is measured BY, so blister radius must be an output.
Placement becomes "between layer i and layer i+1", covering between/below with
one control.

## Two fixes to make while the code is open

**Tabulate the substrate field.** 85 % of every GPU step is substrate LJ —
measured 2.32 ms/step at 34,263 atoms vs 0.35 ms with the substrate shrunk away.
It is rigid, flat and periodic, so U(x,y,z) never changes: tabulate over one unit
cell, trilinear interpolation, ~8 lookups instead of ~180 pair terms. Est. 3-5x,
accuracy set by grid spacing. `U(x, y, z - lift(x,y))` preserves it under a
protrusion. Shared code, all three engines benefit.

**Registry per Bravais cell, not per atom.** Per-atom colouring lays the
honeycomb sublattice checkerboard over the moire and swamps it. Same lesson
already recorded for superlubricity; this is its second sighting.

## Frame format

`GMD1` and `MBL1` each hard-code atom counts, and the host prefixes 12 bytes so
readers must sniff the magic at offset 0 AND 12. Replace with a header + a LAYER
TABLE (count, offset, flags per layer) + optional per-atom scalar blocks
(registry, strain). Version it. Write the reader exactly twice: page, and
`DSW/tools`.

## Licensing

Linking LAMMPS makes the binary GPL-2.0-or-later, covering the whole plugin
including the toy model. Decide before writing, it affects the build:
- one GPL plugin (simplest; 16 MB for every use), or
- load LAMMPS dynamically — `graphene-md` already carries `dl_stub.cpp`, so
  check whether it does this already; an MIT core could then ship without it.

## Acceptance gate — reproduce before retiring

The three plugins produced the results in `report/blisters-2d-materials.tex`.
The combined plugin must reproduce these before ANY of them is retired, and
retired means moved aside, not deleted.

- Adhesion from LJ parameters Gamma = 0.241 J/m2; blister test recovers 0.22
- Hencky K = 3.09, C = 0.52
- Moire period scales as 1/sin(theta/2); row spacing within 12 % over 2-6 deg
- Bilayer centre gap 8.28 A (between, 600 MPa), 13.04 (1400), 3.40/3.41 (below)
- Far-field interlayer 3.42 A in every run
- Edge clamp: free rim creeps 0.524 A, clamped 0.040 A
- **Bit-identity**: one mobile layer, no gas, classic engine == today's
  `graphene-md` exactly

Existing probes that already check most of this live in `DSW/tools`:
`probe-mb-registry.js`, `probe-mb-regdamp.js`, `probe-mb-edge.js`,
`gasconfirm.js`, `gassweep.js`.

## Status

**Phase 1 is DONE** (2026-09-01). Bundle `DSW/Plugins/2D Materials/2dmd/`,
core `src/plugin.cpp`, 0.91 MB DLL, Morse CPU engine on a layer stack.
Gate run by `DSW/tools/probe-2dmd-phase1.js` — same scenario on both plugins:

| check | 2dmd | moire-bubble | diff |
|---|---|---|---|
| far-field top-layer z | 6.7000 A | 6.7000 A | 0.00 % |
| far field after inflation | 6.8361 | 6.8349 | 0.02 % |
| blister centre z | 11.2918 | 11.3024 | 0.09 % |
| rim radius as built | 184.8895 | 184.8895 | 0.00 % |
| rim creep, unclamped | 0.1712 | 0.1728 | 0.96 % |
| registry sd / mean | 0.2702 / 0.6668 | 0.2702 / 0.6668 | 0.00 % |
| gas fill, blister radius | 1.000 / 40.0 A | 1.000 / 40.0 A | 0.00 % |

Plus the capability the stack exists for, which moire-bubble cannot express:
**one** live sheet (19,208 atoms) and **three** live sheets in a twist series
(57,624 atoms).

The sub-percent differences are the predicted float-ordering effect: moire-bubble
sums the interlayer energy before the substrate term, this iterates gaps
bottom-up. Everything measured sits far above it. Bit-identity is claimed only
for the monolayer classic path against graphene-md, which is phase 3.

**Phase 2 is DONE** (2026-09-01). Frame format **2DM1 version 2**, spec in
`DSW/2DMD-FRAME-FORMAT.md`. Gate: `DSW/tools/probe-2dmd-phase2.js`, 17 checks
ALL CLEAR.

The plan said "two readers written from one spec". One reader used by both is
strictly better, so `2dmd/ui/dmframe.js` is a UMD module that runs unchanged in
node and in the browser — the analysis scripts `require()` it and the page loads
it with a `<script>` tag. Verified in both: the node probe and a browser
self-test on the placeholder page parse the same synthesised frame and agree.
Two readers agree right up until they don't, and nothing tells you when.

What the format buys:
- **Layer count is data**, not a header field to change per configuration.
- **Every scalar block carries its own length**, so an unknown `kind` is stepped
  over and the block AFTER it still reads. Tested against a synthesised frame
  with kind 99 wedged between registry and strain, because the plugin will never
  emit a block it does not have.
- A **newer version is refused** rather than misread: blocks are skippable, a
  header change is not.
- Static layers are cached by the reader. The substrate is ~16k atoms and never
  moves; omitting it saves **190 KB per frame**, and the cache means callers
  never notice.

New scalar block: **strain**, mean bond dilatation per atom, `r0` measured at
build time rather than assumed to be `re` (the lattice is built at `A_LATT`, so
a strain against `re` would report a uniform offset everywhere). Measured inside
a blister cap: 1.82e-3 against (d/a)^2 = 1.99e-2, i.e. ~0.09 (d/a)^2 — right for
bond dilatation, which is about half the areal strain of a Hencky cap.

**The bug the gate caught:** a `Float32Array` VIEW needs a 4-aligned byte offset.
In the browser a frame arrives as an ArrayBuffer at offset 0 and every view is
free; in node the same bytes are a slice of a shared pool at an arbitrary offset
and the view THROWS. `dmframe.js` now views when it can and copies when it must.
The synthetic test passed throughout — only the live socket frame exposed it.

**Phase 3 is DONE** (2026-09-01). LAMMPS engine on the layer stack, AIREBO,
16.2 MB DLL. Gate: `DSW/tools/probe-2dmd-phase3.js`, ALL CLEAR.

The architecture is graphene-md's, generalised: **LAMMPS owns the atoms and
their chemistry; the plugin injects, through `fix external pf/callback`, only
what LAMMPS cannot see** — the rigid substrate's LJ, the gas, the edge clamp.
The substrate is the ONLY non-LAMMPS body, which is exactly why extra live
layers are nearly free: they are more atoms in the same box.

| check | result |
|---|---|
| energy per atom, 1152-atom flake | **-7.2101 eV** (bulk AIREBO graphene -7.408; a rim is undercoordinated) |
| bilayer built at 4.20 A | relaxes to **3.416 A**, AIREBO's own equilibrium |
| three live sheets | 3456 atoms, gaps **3.399 A and 3.399 A**, difference 0.0000 |
| classic engine | still selectable, unchanged |

**AIREBO already contains the interlayer van der Waals** — the `3.0` in
`pair_style airebo 3.0` is its LJ cutoff in sigma. So under LAMMPS the callback
adds NO layer-layer term; under the classic engine it still does. The 4.20 ->
3.416 relaxation is the falsifiable check on that: no interlayer term at all
would leave it at 4.20, and double-counting would collapse it.

Corrections to this plan, found by reading the code rather than assuming:

- **`dl_stub.cpp` is NOT dynamic loading.** It satisfies libgomp's offload
  plugin loader when OpenMP is linked statically on MinGW. LAMMPS is linked
  **statically** against `liblammps.a`. The licensing option "load LAMMPS
  dynamically" is therefore unbuilt work, not something already present.
- The answer used instead: **`#ifdef DMD_LAMMPS`**. The same source builds with
  or without LAMMPS, and the LAMMPS-free build is not GPL-encumbered. Both
  builds are verified to compile.
- A **failed LAMMPS start falls back to the classic engine and says so** in the
  state (`engine`, `lmpError`). A silent downgrade to the toy model is the worst
  possible outcome for a plugin whose whole point is that the top tier is real.

Open modelling question, deliberately not changed here: the substrate LJ reaches
the SECOND layer too (3 sigma is 10.3 A, the second sheet sits 6.7 A up), but
moire-bubble only ever applied it to the first layer and phase 1 is accepted
against moire-bubble's numbers. Changing it here would silently move the
reference. It should be decided on its merits, in phase 4 or later.

**Phase 4 is DONE** (2026-09-01), and it carries the substrate correction.
Gate: `DSW/tools/probe-2dmd-phase4.js`, ALL CLEAR.

**The substrate correction.** Every mobile layer within 3 sigma now feels the
rigid substrate, not just the first. Switching the substrate off isolates its
term exactly (in-plane and interlayer energies cancel in the difference), so the
fix has a falsifiable test:

| | energy gained from the substrate |
|---|---|
| monolayer | -248.400 eV |
| bilayer | -272.400 eV |
| ratio | **1.0966** (independent lattice sum predicts 1.094; it was exactly 1.000 before) |

Kept as the plugin's own LJ in BOTH engines rather than handing the substrate to
LAMMPS as a frozen group. AIREBO is arguably the better potential for
carbon-on-carbon, but it would delete the `epsSub` control and make the two
engines incomparable — and comparing them is why there are two.

This deliberately moves 2dmd off moire-bubble's numbers. That reference has done
its job; keeping it would have meant shipping a known-wrong term through phases
5-8 and re-running everything afterwards.

**The three gas models**, on any gap:

| model | p at 600 MPa nominal | footprint | pV = NkT |
|---|---|---|---|
| `bubble` | 600.0 MPa, asserted | pinned | no — N = 0 by construction |
| `bubbleN` | 754.3 MPa, derived | pinned at the seed | **0.000 %** |
| `bubbleFree` | 754.2 MPa, derived | **peels** | **0.000 %** |

The pressure sitting ABOVE the nominal is the feedback working, not failing: N
is fixed from the Hencky volume (16 408 A^3), the blister settles at 13 051 —
80 % of it, because the toy stiffness and the adhesion both resist — so p rises
by exactly that ratio. 600 x 16408/13051 = 754.

Peel front, demonstrated at 1600 MPa where it is clearly past threshold:
`bubbleN` stays pinned at **39.9 A** while `bubbleFree` peels to **61.8 A**.
That difference IS the peel front, and it is why only `bubbleFree` is comparable
with experiment.

Gas verified in gap 0 (under a bilayer), gap 1 (between), and gap 2 of a
three-layer stack.

At 600 MPa the energy release rate G = 0.65 p d came to ~0.245 J/m^2 against an
interlayer Gamma of ~0.24 — within 2 % of the peeling threshold. Worth knowing:
blister tests near that point are coin flips, and a probe run there measures
nothing.

**Phase 5 is DONE** (2026-09-01) — the tabulated substrate. The OpenCL port is
NOT done, deliberately: the measurement the plan demanded first says it is worth
much less than assumed. Gate: `DSW/tools/probe-2dmd-phase5.js`, ALL CLEAR.

**Measure before building, and it changed the plan.** The 85 %-of-a-step figure
came from `graphene-md-gpu`, a MONOLAYER on a GPU where the sheet dynamics is so
fast the substrate dominates. On the layer stack:

| | ms/step | substrate share |
|---|---|---|
| 1 layer | 2.786 | **52 %** |
| 2 layers | 8.556 | **35 %** |

With two mobile layers the **interlayer LJ is the bigger cost** — 4.25 of
8.56 ms — and it **cannot be tabulated, because both layers move**. That is
precisely the "do two mobile layers erode the GPU advantage" question, and the
answer is yes for the tabulation trick and no for the GPU: the GPU would
parallelise the interlayer term too, so it is now the *larger* remaining win for
bilayers, not the smaller one. It is also much more work. Recommended as its own
decision rather than something to nod through.

Delivered: `U(x,y,z)` of the rigid substrate sampled over one unit cell,
trilinear lookup instead of ~180 pair terms. **Forces are tabulated directly**,
not differentiated from the interpolated energy — trilinear `U` has a
piecewise-constant gradient, and using it would give a force that jumps between
cells.

| | exact sum | tabulated | speedup |
|---|---|---|---|
| monolayer | 2.578 ms | 1.411 ms | **1.83x** |
| bilayer | 5.325 ms | 4.293 ms | **1.24x** |

Accuracy against the exact pair sum, as `subGrid` refines: 0.0149 % -> 0.0002 %,
which is the wire's own `%.6g` floor. `subTab: 0` keeps the exact sum available
as the reference it needs to be.

**Two real bugs, both found because the error REFUSED TO SHRINK with the knob:**

1. `buildSheet` centres a lattice on `(i-half, j-half)`, so with an even cell
   count there is **no lattice site at the origin** — and a table built about
   the origin sits a fraction of a lattice vector out of registry with the real
   substrate. Registry is exactly what this field encodes. Fixing it cut the
   error 4x (0.0198 % -> 0.0049 %).
2. `subGrid` refined only the in-plane axes; `nz` was pinned at 0.12 A, so the z
   interpolation error was untouched however fine the grid got — and it was the
   dominant term. An accuracy knob that does not control the dominant error is
   not an accuracy knob.

Neither would have been caught by "is it faster" or "is it close enough". They
were caught by asserting that refinement must *help*.

**Phase 6 is DONE** (2026-09-02). The panel IS graphene-md's, not a new one.

The first attempt wrote a fresh 2-D canvas panel and it looked nothing like the
plugin it replaces — graphene-md draws with three.js (perspective camera,
lights, instanced spheres, bond lines). So the second attempt takes that file
wholesale and changes only what FEEDS the renderer:

    S.top   <- every mobile layer, concatenated
    S.sub   <- layer 0, the rigid substrate
    S.bonds <- derived in the page, since 2DM1 carries no topology

Added: the stack controls (live sheets, above-substrate), both epsilons, the
tabulated-substrate switch and its grid, the gas model and gap selectors,
registry-per-cell. 106 controls in all.

**Controls grey out when an engine or model cannot honour them** — the
capability table from this document, made visible. Under LAMMPS the Morse
parameters go grey (AIREBO owns the sheets' chemistry) while the substrate's
epsilon stays live, because the substrate is the plugin's own LJ in both
engines. The open-loop gas greys the temperature (there is no N). One sheet
greys the interlayer epsilon. A control that lies is worse than one that is
absent.

**Registry is averaged per Bravais CELL**, which fixes the known limitation:
per-atom colouring laid the honeycomb's two-sublattice checkerboard over the
moire and swamped it. The beat was always in the data; only this makes it
legible.

The bug worth remembering: after `setupMeshes()` replaces the instanced meshes,
every atom sits at the origin until something writes the matrices. 6724 spheres
in one clump renders as a dot, which reads as "nothing drawn at all" — the data,
the meshes, the camera and the materials were all fine. Diagnosed by reading the
instance matrix rather than by looking at the picture.

## What is NOT done

**Phase 7 (exporter)**: `src/dmexport.h` is written — a stock LAMMPS deck for N
layers, with the substrate as real frozen atoms since a standalone deck has no
callback — but it is NOT wired into the plugin and NOT tested. `lmp.exe` is
present at `C:/Users/pbog/b/lammps/build/lmp.exe`, so the right acceptance is to
RUN the exported deck and compare, not merely to read it.

**Phase 8 (acceptance and retiring)**: not run. The three old plugins stay.


## Order of work

1. **Layer stack + Morse CPU engine**, one and two layers. Reproduce
   moire-bubble's numbers. Nothing else starts until this holds.
2. **Frame format + its two readers.**
3. **LAMMPS engine on the stack** (bilayer nearly free). Reproduce
   graphene-md's numbers, then the AIREBO material set.
4. **Gas models on arbitrary layer pairs**, `bubbleFree` default. Reproduce the
   blister and adhesion numbers.
5. **GPU engine + tabulated substrate.** Measure whether two mobile layers erode
   the GPU advantage BEFORE building the rest of the GPU path around it.
6. **UI consolidation** — graphene-md's panel as base, plus the layer-stack
   editor, capability table, Analysis histogram, recording, true-aspect fix.
7. **Exporter for N layers.**
8. **Acceptance run, then retire the three.**

Phases 1-4 are the substance. Several sessions, not an afternoon.

## Risks

- **Combining means choosing.** The cores have drifted; some behaviour will
  change. Bit-identity is promised only for the monolayer classic path.
- **Two mobile layers hurt the GPU** — the interlayer pair list then has both
  sides moving and rebuilds far more often. Measure in phase 5 first.
- **One binary for every use** unless LAMMPS is loaded dynamically.
- **Another instance edits these bundles.** This is a rewrite, not an additive
  patch, so it needs coordinating rather than interleaving.

## What NOT to do

Not a runtime plugin-loading framework, not a general multi-physics abstraction,
and not a rewrite of the working DSP — the Morse force loop, the Hencky profile
and the deck generator are measured and correct; they MOVE, they do not get
rewritten.

And not a fourth plugin alongside the three. If this is built it replaces them;
if it is not built, the three stay as they are. The failure mode to avoid is
four trees with four copies of the same force loop.
