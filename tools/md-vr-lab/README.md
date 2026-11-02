# 2DPHYS Atomic Workbench (source; folder md-vr-lab)

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

## Nano walk (the **Walk** button, SETTINGS → Walking, Esc to leave)

The user is "made small": the structure is shown at 1.056 m per Å (C–C bond 1.5 m, atom radius about 0.3 m) and you stand on its
**fixed surface**: the substrate if one is set (graphene, MoS₂, SiO₂ - its atoms become the floor), else the sheet itself (its top
layer), else a glowing pad under the structure. Around you is a starry night (`src/nanowalk.js`: procedural Milky Way and nebulae
texture on one sphere, 2800 twinkling stars, horizon haze, cloud banks, drifting motes, a shooting star now and then); the lab is still
there, 75 times larger and 1.2 km away, a translucent ghost in the fog. Materials only (not the noble-gas box).
Desktop: W A S D / arrows (Shift runs), drag to look. VR: left stick walks, right stick turns, the panels glide to your side as you walk,
and the walking surface has an edge you cannot pass. Tools work as usual (the pick radius shrinks to atom size). **Bring** (the wand, key 9) is for things out of reach: hold the trigger / button on a piece and it is pulled to the tip of the wand, about eye height and a reach away, and held there while you swing the wand; let go to drop it. Cost control: no
post-processing, one draw call each for the sky, stars, motes and floor, fewer stars/clouds/motes and no headlamp on Low quality.

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

## Chemistry mode (BUILD → Materials → Chemistry)

Explicit bonds between any of the main-group elements H, B, C, N, O, F, Si, P, S, Cl, Br, I on the Universal Force Field
(`src/chem.js`, Rappé et al. 1992). Graphene, graphite, benzene and nanodiamond are converted to bonds as built; *Empty box*
starts from nothing.

- Tools: **Attach** (pick an element, click an atom; the new atom goes on the side you point from; *Fill valence with H*
  turns O into OH, C into CH₃, N into NH₂), **Bond** (click two atoms), **Add**, **Delete**. Valence is enforced
  (H 1, O 2, N 3, C 4 …); the hybridisation follows the number of bonds, so an attached graphene carbon becomes sp³,
  puckers ~0.4 Å out of the sheet and its C–C bonds stretch from 1.42 to ~1.51 Å.
- Bonds are Morse (70 kcal/mol per bond order) times a smooth switch between 1.25 and 1.6 rest lengths; past 1.6 the bond
  is removed, so atoms can be pulled off with the tweezers. Angles (UFF Fourier), torsions, sp² inversion, UFF van der
  Waals (1-2, 1-3 excluded), no charges. One change from UFF: aromatic C–C in a sheet rests at 1.42 Å (graphene).
- Attach places the new atoms clear of their neighbours and relaxes them before the dynamics continue.
- Transport: carbons with 4 bonds (sp³) carry no π orbital; other elements carry none either (a vacancy-like model
  of an adsorbate). Published adsorbate orbital parameters (H, F, OH, CH₃) are not in yet.
- `test/chem.test.mjs` (15 checks): forces against −∇E for every term including the bond switch, CH₄, H₂O and benzene
  geometry, valence refusals, H fill, pucker and C–C stretch for H / F / OH on graphene, pulling an F off breaks exactly its
  bond, a decorated flake stays intact for 2 ps at 300 K, adsorbates remove π orbitals and lower T(E) near E_F.

## Toolbar and settings

- **Toolbar** (top left on the desktop; a panel at the front edge of the table in VR): Tweezers, Add, Attach, Bond, Delete,
  the element button (opens a periodic table; the 12 elements with force-field parameters are highlighted, the rest greyed),
  H fill, the − and + contact tools, Run/Pause.
- The default model stays the reactive potential. Attaching, bonding, or adding a foreign element to a running structure
  switches it on the spot to the chemistry model (UFF, explicit bonds), keeping positions and velocities, so other atoms can
  always be added. MoS₂ has no chemistry model yet.
- **SETTINGS tab**: one atom size for every element (default 0.32 Å, or element radii scaled), bond width, show bonds,
  current as bond colours (default) and optional arrows. Saved in the browser.
- Current is drawn as bond colour: dark violet (little) through red and orange to yellow (most), grey = none. Currents
  between graphite layers are computed but not drawn (they are not bonds).

## Systems, annihilator, boundary, hands

- **SYSTEMS tab**: built-in systems with their own settings - graphene, graphite, MoS₂, hBN (chemistry model), nanodiamond,
  carbon nanotube (n, m, length; shows armchair/zigzag/chiral and metallic/semiconducting by zone folding), C₆₀, benzene and
  molecular junctions (1-3 para-linked benzene rings, thiol anchors, gold pads held fixed; transport contacts on the anchor
  carbons, so the gold is mechanical and visual, not electronic). Save the current system to the browser's storage (on a
  Quest: the headset) and load or delete saved ones. The lab starts with an open graphene flake.
- **Annihilator** (Zap on the toolbar, key 8): hold the trigger to remove every atom inside a cone around the ray (half angle
  1-25 degrees, SETTINGS). In VR the cone is drawn from the fingertip.
- **Boundary sphere**: atoms that fly beyond half the box diagonal + 15 Å (out of reach of the tweezers) flash and are removed.
  Switch off in SETTINGS.
- **Hands**: a glove on each controller. The laser leaves the index fingertip; the trigger curls the index finger, holding an
  atom pinches, grip makes a fist. Both grips: pull the hands apart to scale, twist to turn, about the point between the hands.
- Atoms held fixed (the gold pads) carry no degrees of freedom in the thermostat and the system's drift is not removed when
  any are present (their push on the rest is real momentum).
- `test/systems.test.mjs` (12 checks): nanotube diameters and stability, zone folding in the transport ((5,5), (9,0) metallic;
  (10,0), (8,0) semiconducting), C₆₀, hBN, junctions (pads fixed, no bond lost, conductance falls with every ring),
  JSON save/restore, cutting many atoms at once.

## Language, thermometer, grabbing pieces, tool shapes

- **Language**: SETTINGS -> Language / Sprog (English, Dansk). The code stays in English; every text the panels draw goes through
  `tr()` in `src/i18n.js` at draw time. The Danish table `src/i18n-da.js` is GENERATED: `node tools/extract-strings.cjs > strings.json`,
  translate the new entries into a JSON object (English -> Danish, keep {1} {2} placeholders), then `node tools/build-i18n.cjs <that.json>`.
  Text built from numbers uses templates ("{1} atoms"), whose inserted parts are translated too. The extractor skips all-caps words
  (the tab names), so those were added by hand.
- **Thermometer** on the table (SETTINGS switch, on by default): red liquid = the temperature now, teal ring = the target.
  Grab the ring (trigger / mouse) and slide it: logarithmic scale, 10-3000 K (materials) or 3-600 K (noble gas). Grabbing it switches
  the thermostat on.
- **Grab: piece** (the default tweezers mode, except graphite / MoS2 / benzene, which start on Grab: layer): the piece you grab
  (connected by bonds: chemical bonds in the chemistry model, bond-length contacts otherwise) is pulled by its centre of mass, so a
  loose fragment moves as one unit and the rest stays put. A piece larger than half the structure, or a lone atom, falls back to pulling
  the single atom. `test/grab.test.mjs`: a C2 dimer next to C60 moves 5.6 A, stays bonded, the cage moves 0.00 A.
- The **grip** buttons are different on purpose: one grip moves the whole structure (or a panel), both grips scale and turn it.
- **Carry a piece (grip; desktop: Shift + drag, wheel = nearer/farther)**: grip on an atom, with any tool, takes exactly the connected piece (bonds, or bond-length contacts, so each graphite layer is its own piece). It follows the hand in position and rotation (Mat.carry: each atom on a soft damped spring to its place in the hand) and still feels everything else, so graphene laid on hBN is held there by van der Waals. Grip in empty space still moves the experiment; both grips scale it. The momentum correction is off while carrying (it would push the rest away).
- **Camera** (tool): VR = a camera on the controller with a live preview, trigger = photo; desktop = click in the view. 1920 x 1080 PNG (1280 x 720 at Low quality), rendered separately without lasers and pointer dots, downloaded as 2DPHYS-workbench_<date>.png and shown as a print on the table.
- **Building blocks** (SYSTEMS: Replace system / Add as a block; Adult: Replace / Add next to it): the block is built separately (open) and placed 6 A beside the structure (Mat.mergeFrom, its own group). Carbon + carbon stays reactive; other elements switch to chemistry; MoS2 only with MoS2; no blocks on periodic sheets.
- **Substrate** (None / Graphene / MoS2 / SiO2, src/substrate.js): fixed atoms under the structure, about the table circle in size and at least 10 A beyond the structure; not in the MD, only 12-6 van der Waals on the moving atoms with UFF parameters (binding per flake atom: graphene 72, MoS2 42, SiO2 23 meV - UFF binds graphene-graphene about 40 % stronger than experiment). test/substrate.test.mjs.
- **Pointer highlight**: the atom under the laser or the mouse is drawn 35 % bigger and glows cyan-white (HOVER).
- **Hand** (default tool, every level): trigger / mouse on an atom: a loose piece (at most half the atoms) moves whole; an atom of a big piece is pulled hard (HAND_PULL 20 eV/A^2, cap 40 eV/A) while every other atom of its piece is held by a soft spring to where it was (anchorFor), so it breaks out instead of dragging a floating flake along. Bring it close to a sheet, an edge or another atom and it bonds (reactive model: by the potential; chemistry model: formClose). The grip carries a whole piece (see Carry a piece). The glove makes a fist while holding. Pulling an edge atom can unzip a carbon chain first: real physics. test/hand.test.mjs.
- **Attach does not freeze**: the local settling of a new atom runs in a few ms per frame (chem.relaxPending) instead of 120 force calls at once.
- **Levels** (SETTINGS -> Level; Kid needs three taps to leave): Kid = picture cards for six systems, colder/warmer/run and grab/add/zap as big icons, no text, no plots; Adult = four tabs (BUILD with picture cards, RUN, ELEC, SETTINGS), short explanations, temperature bar, no plots; Researcher = everything, as before. The simulation is identical in all three. The toolbar is one table (TOOLDEF) with a list per level (TB_LEVEL); every tool has a pictogram (src/icons.js) and a colour per kind.
- **Bonds form in the chemistry model**: an open atom (no bonds, or two or more missing) feels no van der Waals wall towards atoms with a free valence and bonds at 1.3 covalent radii (test/bondform.test.mjs). H fill is off by default.
- **Graphics quality** (SETTINGS, next to the language): High (default, as before) or Low for older or slower headsets. Low = VR resolution 70 % (applied when VR starts), matte atoms and bonds lit by one light, coarser spheres and bonds, desktop pixel ratio 1. The simulation itself is identical.
- **Posters**: the three 2DPHYS posters (src/poster-*.jpg, 1240 px wide, ~0.4 MB each, inlined) hang at A0 size, two on the wall behind the seat and one on a free-standing board to the left, turned towards the seat.
- **Tool shapes**: the tool at the end of the VR ray (and the desktop cursor) changes with the tool: tweezers, plus, chain link,
  bond pair, cross, and a cone for the annihilator.

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
