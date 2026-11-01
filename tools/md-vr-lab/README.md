# MD Lab VR (source)

`index.html` is one self-contained file (Three.js 0.170 bundled inline, works offline). It is generated
from this folder - edit `src/`, never the bundle.

## Rebuild and test

```
npm install three@0.170.0 esbuild@0.24.0     # or: MDLAB_NODE_MODULES=/path/to/node_modules node build.js
node build.js                                # writes index.html
node test/physics.test.mjs                   # physics checks (no browser needed)
```

## What it is

A WebXR lab in which the user **builds** either a Lennard-Jones noble-gas system (element, lattice size, FCC crystal or random
gas, density, start temperature) or a real material - benzene, graphene, graphite, MoS2, nanodiamond (see below) - and edits it atom by atom with the Add and Delete tools, **runs** it (heat, squeeze, thermostat
on/off, time step, periodic box or hard walls) and **measures** it (T, P, energy per atom, coordination, g(r),
MSD and D, a recordable table with CSV export). Twelve guided tasks load ready-made setups.

It runs in three places with one code path:

| Where | How |
|-------|-----|
| Meta Quest, standalone | Open the page in the Quest Browser, press *Enter VR* (needs HTTPS) |
| Quest + PC via **SteamVR** | Link / Air Link / Steam Link / Virtual Desktop -> SteamVR running -> SteamVR *Settings -> Developer -> Set SteamVR as OpenXR runtime* -> open the page in Chrome or Edge (https or `http://localhost`) -> *Enter VR* |
| Desktop | Mouse: drag atoms, orbit, zoom; space = run/pause, 1/2/3 = tools, R = rebuild |

SteamVR is reached through the browser's OpenXR runtime; there is no native OpenVR build.

VR controls: trigger = press UI / use tool, grip = move the experiment (both grips: scale), right stick = target T,
left stick = box size, while holding an atom the stick reels it in/out, A/X = next tool, B/Y = run/pause,
stick click = recentre.

## Electron transport (ELEC tab)

Mark atoms as the **−** electrode (electrons enter) and the **+** electrode with the contact tools (keys 4 / 5, or the ELEC tab),
and the lab computes, from the live geometry a few times a second:

- **bond currents**, drawn as arrows (conventional current, + to −; size and colour = magnitude),
- **T(E)** with the bias window marked, **I(V)** and dI/dV, the HOMO–LUMO gap and the transport gap.

Model (`src/tb.js`, run in a Web Worker `src/tbworker.js`): one π (p) orbital per carbon along the local bond normal,
Slater–Koster hopping from the actual distances and angles (−2.7 eV at 1.42 Å, interlayer σ term, smooth cutoff 4.0–4.5 Å);
wide-band contacts −iΓ/2 on the marked atoms; H diagonalised once per geometry, then every energy only needs the contact block
(Dyson equation, exact). I = (2e²/h)∫T(E)[f₋ − f₊]dE. The bias sets only the energy window (no self-consistent potential drop).
Hydrogen carries no orbital; MoS₂ (needs d orbitals) is refused with a message.

**Open flakes**: graphene, graphite and MoS₂ can be built as *Open flake (free edges)* instead of the default periodic sheet:
no periodic images, vacuum all round, dangling edge atoms trimmed. Use this for transport; on a periodic sheet current can also
run round the boundary.

`test/transport.test.mjs`: eigen solver, single level (Breit–Wigner) and dimer against closed forms, the sign and size of the bond
current, Kirchhoff at every inner atom of a flake, benzene para / meta / ortho interference, uniform vs dimerised carbon chain
(gap = 2|t₁ − t₂|), open flakes stable for 3 ps at 300 K, periodic sheets unchanged, speed.

## Room, table and panels

- Dark or white lab (VR tab, the *White lab* button, or key T). The furnished room (benches, cabinets, shelves, windows) is merged
  into one mesh per material and costs well under 1 ms of GPU time per frame.
- Recentring (thumbstick click) fits the table to the user: half a metre below the eyes, seated or standing; the VR tab has a
  table-height slider and the left stick moves the table in the materials mode.
- The panels stand beside the table, not through it. Grip while pointing at a panel moves it.

## WebXR start (Quest + PC)

Chrome exposes the WebXR Layers API and three.js then renders through a projection layer; with Meta Horizon Link that path
delivered no frames at all (the headset waited, then reported "page not responding"). `enterVR()` hides `renderState.layers` on
its own session so three.js uses the classic XRWebGLLayer path, asks only for `local-floor`, and ignores repeated clicks while a
session is starting. If the headset still shows only a loading screen, an earlier Chrome session is holding Link: end Chrome in
Task Manager and restart Link.

## Layout

- `src/physics.js`  MD engine, reduced LJ units: velocity-Verlet, truncated + shifted potential (r_c = 2.5 sigma),
                    Verlet neighbour list built from a cell list, Berendsen thermostat, periodic box or reflecting walls
                    (pressure from wall impulse), tweezers spring, g(r), MSD, coordination number. Real units for Ne/Ar/Kr/Xe.
- `src/materials.js` real-unit engine (Angstrom, eV, amu, fs) for the Materials mode:
                    Tersoff carbon (Lindsay-Broido for graphene/graphite, Tersoff 1989 for nanodiamond),
                    Stillinger-Weber MoS2 (Jiang, with LAMMPS' `sw/mod` angle switch), OPLS-style benzene
                    (harmonic bonds/angles, out-of-plane terms, LJ + partial charges), shifted-force LJ van der Waals between
                    layers / molecules, Verlet lists, Berendsen thermostat, tweezers on an atom or a whole layer/molecule.
- `src/ui.js`       immediate-mode UI drawn on a 2D canvas: a DOM element on the desktop, a texture on a floating
                    panel in VR (controller ray -> canvas pixel).
- `src/plots.js`    the four live plots on a second canvas.
- `src/content.js`  lab tasks and VR set-up help text.
- `src/main.js`     scene, lab room, instanced atoms, controllers, mouse tools, tabs, main loop.
- `test/materials.test.mjs` finite-difference force checks for every model, diamond a0 and cohesive energy,
                    graphene / MoS2 equilibrium, benzene C-H stretch (3066 cm^-1), NVE conservation, graphite and MoS2
                    interlayer spacing and binding energy.
- `test/lammps/`    cross-check against LAMMPS: energies and forces agree to ~1e-12 eV.
- `test/physics.test.mjs`  energy conservation, ideal-gas pressure (periodic and walls), melting, g(r), speed.

Tested headlessly with Chromium + the Immersive Web Emulation Runtime (session start, ray/UI hit, trigger,
tweezers, thumbsticks, grip). It has not been run on a physical headset from this repository's CI.

## Materials mode - what is and is not validated

- Validated against LAMMPS to ~1e-12 eV: Tersoff (graphene, diamond) and Stillinger-Weber/mod (MoS2) energies and forces.
- Reproduces: Tersoff diamond a0 = 3.566 A, E = -7.371 eV/atom; graphite spacing 3.35 A, binding 50 meV/atom;
  MoS2 bilayer spacing 6.15 A, binding 0.22 J/m^2; benzene C-C 1.40 A, C-H 1.08 A, C-H stretch ~3060 cm^-1.
- Known limits of the published potentials: the Lindsay-Broido set gives a graphene bond of 1.44 A (exp. 1.42 A) and a
  cohesive energy of -7.98 eV (fitted to phonons, not energies); the MoS2 SW set gives a = 3.12 A (exp. 3.16 A) and is only reliable up to ~700 K: above ~800 K (bilayer) / ~900 K (monolayer) it
  collapses into an unphysical, much lower-energy dense state within ~20 ps (an artefact of the `sw/mod` angle switch; LAMMPS gives
  identical energies and forces, so this is the potential, not the code).
  Nanodiamond is bare (no hydrogen), so its surface reconstructs; benzene molecules cannot react.
- Interlayer and intermolecular van der Waals terms are effective Lennard-Jones forms, not the full KC/ILP potentials.
- No pressure/stress for materials. Speed on a standalone Quest has not been measured; a 336-atom graphite stack costs
  about 1 ms per step on a desktop CPU.
