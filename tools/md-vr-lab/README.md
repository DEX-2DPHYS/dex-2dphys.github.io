# 2DPHYS Atomic Workbench (source; folder md-vr-lab)

`index.html` is one self-contained file (Three.js 0.170 bundled inline, works offline). It is generated
from this folder - edit `src/`, never the bundle.

## Rebuild and test

```
npm install three@0.170.0 esbuild@0.24.0     # or: MDLAB_NODE_MODULES=/path/to/node_modules node build.js
node build.js                                # writes index.html
node test/physics.test.mjs                   # physics checks (no browser needed); likewise the other test/*.test.mjs
node test/xr-emulator.cjs index.html out     # VR in headless Chrome (IWER + puppeteer-core)
node test/xr-ar.cjs index.html               # see-through on a real table, same tools
node test/xr-interact.cjs index.html         # recentre only by the headset, two-grip scale, table floor, spin, panel handles
node test/xr-hand.cjs index.html             # building blocks as objects, the Hand carrying them, the atom in the hand
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
holding the Meta button (the headset's own recentre) = recentre; nothing else on the controllers moves the table.

## Together (Settings → Together; `src/collab.js`, `src/avatars.js`)

One more person in the lab. The first person in a room is the **host** and runs the simulation; the second is the **guest** and sees it from the
other side of the table (a third is turned away). The guest's copy of the structure is rebuilt from the host's (`Mat.serialize/restore`),
then atom positions stream at about 10 Hz (16-bit quantised, interpolated) and velocities at 2 Hz; the structure is re-sent when it
changes (atoms added or removed, substrate...). Each sees the other's head, name tag and hands (VR) or pointer ray (desktop), drawn in the
structure's coordinates and scaled to the sender's size - so a person walking on the structure is a tiny figure for the other one, and the lab
person is a giant in the starry sky for the walker. The guest only watches for now (edit tools say so); if the host leaves the guest gets their
own experiment back. Transport: Supabase Realtime *broadcast* only (no tables, no presence); put the project in `supabase-config.js` or open the
page once with `?sburl=https://xxxx.supabase.co&sbkey=ANON_KEY`. "Two tabs" mode (BroadcastChannel) needs no server. Invite link: `?room=ABCD&via=sb`.

## Together, round two (control, sides of the table, link, plots)

*Control* is handed over like presenting in a video meeting. The person **in charge** (host) runs the simulation and has every tool and panel; the other
person watches. The person in charge can **Hand over control**, the watcher can **Request control**, a non-admin in charge can **Release** it, and
the room's **admin** (its creator, ★) can always **Take control back**. A handover moves the whole experiment - positions, velocities, contacts - to the
other computer, which then runs it (so there is never a second simulation to drift out of step). The two people stand on **opposite sides of the table**:
for the guest the room and table furniture are turned half a circle about the table centre, and with two people the experiment is locked to the table
centre and only turns about the vertical, so a reset or a twist on one side can no longer leave it skewed on the other. The guest sees the plots (the host
sends them at 1 Hz) and the ELEC curves (the contacts and bias are synced and the guest's own worker computes the curves from the mirrored atoms).
*Link*: a direct WebRTC data channel (signalled over Supabase; the relay stays as the fallback) carries poses and snapshots; the sender stops
and waits when the other side has not confirmed the last snapshots, so a slow link no longer piles up delay; the guest interpolates with an adaptive
delay and carries atoms on with their velocities when a packet is late.

## The table

The default is a graphene substrate (Settings: None / Graphene / MoS2 / SiO2). A substrate always lies on the table (its lowest atoms touch the worktop; this is re-applied every frame, so
replacing the structure or moving the experiment keeps it level), with the structure on it. The table is solid: atoms that reach the worktop
bounce off it (specular reflection, the normal velocity flips), so an unsupported structure pushed down onto the table does not pass through.
The worktop is a floor for **every** atom over it - the main structure, loose pieces, single atoms, a piece held by the Hand or carried with the
grip - checked after every MD step (`tableWall` once a frame for the plane, `tableWallStep` after each step: an atom below goes back onto the
surface, at most 1 A a step, and its downward velocity flips), so a fast atom cannot slip through between frames. Moving or scaling the whole
experiment with the grips cannot push it into the table either (`keepAboveTable`: it is lifted by what its lowest atom over the worktop lacks).

## Controls (2026-11-12)

- **Only the headset recentres.** The thumbstick click no longer recentres (it fired by accident while pushing the stick for the temperature
  or to reel an atom); no controller button moves the table. Holding the Meta button (the headset's own recentre, a reference-space
  `reset`) does, and Settings keeps *Recenter table*. In VR the toolbar has **Stop spin** where Recenter was; the desktop toolbar has both.
- **Both grips = scale, always.** The second grip turns whatever the first grip was doing (carrying a piece, moving a panel) into the
  two-hand gesture: spread the hands to scale, twist to turn, about the point between them. Letting go of either grip ends it - the other
  hand does not start dragging the experiment. A hidden panel (the plots below Researcher level) no longer catches the ray.
- **Spinning.** A piece pulled off-centre keeps its angular momentum and turns. `spinOff` removes the rigid-body rotation of a piece (the part
  omega x r of the velocities about its centre of mass, omega = I^-1 L) and nothing else: the centre-of-mass motion and the thermal motion
  stay (test: the kinetic energy returns exactly to its value before the spin was added). **Stop spin** (toolbar) does it for every connected
  piece; **holding** a piece with the Hand (or a layer) damps its spin with a 0.12 s time constant, so holding it still stops it. Pieces with
  atoms held fixed, and periodic sheets, are left alone.
- **Moving panels.** Each panel (menu, plots, toolbar, periodic table) has a handle bar with six grip dots on its top edge: trigger on it and
  drag - the panel follows the ray at the same distance and keeps facing you. Grip anywhere on a panel still moves it with the hand.

## Objects and the atom in the hand (2026-11-12)

- **Building blocks are objects** (`Mat.objects`, set by `mergeFrom`). Each block keeps its own group; two atoms of different objects (each of
  at least 4 atoms) never bond on their own - between them only van der Waals acts (the reactive model gets the graphite C-C Lennard-Jones
  for it, MoS2 its interlayer one, the chemistry model its UFF van der Waals; radicals of different objects feel the wall too). So a block
  that drifts or flaps against the structure stays a separate thing. **Joining** happens only while one of them is held (Hand, grip or
  wand: `updateJoin` hands the held groups to `Mat.join`): then the pair is treated covalently, and the first contact inside the
  potential's reach (2.15 A reactive, 3.0 A MoS2, a new bond in the chemistry model) makes them one object (`fuseCheck`, "Joined").
  Single atoms and small bits (< 4 atoms) are not objects: they bond to anything and join the object they bond to. Saved and synced
  (Together) with the system. Before this, a block's edge atoms bonded to the flake on their own as the sheets flapped, and the joined
  piece (more than half the atoms) could no longer be moved.
- **The Hand picks pieces up.** Trigger on a loose piece or on any object but the original structure (the group of atom 0) carries it - it
  follows the hand at once, moved and turned, like the grip - however big it is. (It used to be pulled by its centre of mass, strongly
  damped: about 1 A per ps, a centimetre or two a second on the headset.) Trigger on the original structure still pulls the atom (out of it,
  if you pull hard); a bit broken off it (less than half of it) is carried. A carried piece is no longer dropped when an atom elsewhere is
  removed (zapped, flown off): it follows the renumbering.
- **Add in VR: the atom in your hand.** With Add, each hand holds the next atom just in front of the fingertip, with a tag (symbol and
  name); the right stick moves it nearer or farther. Within bonding reach of an atom that can take a bond (chemistry model: free valence;
  reactive: fewer neighbours than its valence) a dashed bond line shows it, with a tick in the controller. Trigger: bonded there (chemistry
  model: `chem.attach` on that side, H fill as set; reactive / MoS2: one bond length from it, on the side it was held) - or, with no bond
  line, it stays floating where it was let go, at rest. A floating atom is picked up with the Hand and bonds where it is brought (the
  potential, or `formClose`). This is Attach, so the VR toolbar has no Attach button (the desktop keeps it); the periodic table selects Add.
- **The element button is the atom tool** (Adult, Researcher): first press = an atom of that element in the hand (Add), press again = the
  periodic table. Add, Attach and Bond are no longer on these toolbars - the atom in the hand bonds where it is let go, and two atoms
  brought close bond by themselves (desktop keys 2 / 6 / 7 still pick Add / Attach / Bond). Kid keeps its Add button (carbon only).
- **No starting spin**: a freshly built or added free piece has its rigid rotation removed (random thermal velocities carry some
  angular momentum, which made flakes tumble slowly); its heat is unchanged.
  `test/xr-hand.cjs` covers blocks and the atom in the hand.

## VR reset and floor level

The headset's own recentre (hold the Meta button), Settings → General → *Recenter table* and the desktop **Recenter** button put the table and panels in front of you (the thumbstick click no longer does: it happened by accident while pushing the stick; in VR the toolbar has *Stop spin* in its place): the direction is
taken from the gaze (or from the top of the head when you look steeply up or down), the table height is 55 % of eye height (0.55–1.0 m) and a second
recentre happens 1.7 s after VR starts (the first pose of a headset is often off). Settings has a **Floor level** slider (±50 cm) that raises or lowers
you relative to the virtual floor, if the headset's floor is a little off.

## Real table (see-through; the **Real table** button next to Enter VR, `src/realtable.js`)

An `immersive-ar` session on a headset with passthrough (Quest 3 / 3S in colour; Quest 2 in black and white): the room, sky and fog are not
drawn, so the real room shows, and the lab stands on a **real table**. The virtual worktop and legs are hidden; the work-area ring, thermometer,
prints, toolbar and panels stay.

- **Finding the table.** The session asks for `plane-detection` and `mesh-detection`, which on a Quest give the room scan (Space Setup; the
  browser asks once for permission to share it): surfaces, and volumes (a Quest 3 scan gives furniture as boxes - the top face of a
  *table*/*desk* volume is used). The nearest surface or volume labelled *table* or *desk* wins, else a horizontal surface 35–130 cm high
  (a scan without labels). The outline is taken through its pose into the world and must be flat (whatever axis convention the headset
  uses for the plane); it becomes a rectangle (smallest area round it). The edge nearest you is the front: the lab faces into the table from
  there. The scan is read twice a second for the whole session, so a table that arrives late (after the permission question) is still
  used. Settings → General shows what the scan holds ("Room scan - surfaces: floor, wall x4, table; volumes: ..."), to see why a table is or
  is not found.
- **Placing.** The virtual worktop's upper face lies exactly on the real table top; the experiment stands over the table centre (on a table
  wider than 2 m or deeper than 1.2 m: in front of you, at least 0.6 m from its ends and 0.5 m in from the edge). The solid worktop
  (atoms bounce off it) takes the real table's size, the toolbar lies just inside the front edge, the panels stand beside the table (at most
  0.9 m out from the centre, so they stay in reach on a long table), the ring shrinks on a small table.
- **No table in the scan** (no Space Setup, or the browser was not allowed to read it): after 8 s the lab asks you to **touch the table edge**
  nearest you with the fingertip, where the laser starts - first at the left, then at the right (at least 25 cm apart). The table is then
  taken to be 80 cm deep (a table that the scan delivers later replaces the request, unless you have already touched the edge). Settings → General has *Find my table again* (the Meta-button recentre does the same), *Touch the
  table edge*, *Scan the room* (Quest Browser: opens Space Setup to draw or confirm the table) and *Leave see-through*.
- **Fixed to the table:** the sticks do not glide or turn the user in see-through (the lab would slide off the real table); the floor-level
  slider is replaced by the table section (the real floor is the floor). Grip still moves and turns the experiment.
- **Walking** works as before: while you are small the night sky (an opaque dome) covers the room, your feet are on the real floor, and
  coming back puts the lab on the table again.
- **Together:** both headsets fit the structure to the centre of the same table, the guest's turned half a circle as always; with the two
  people on opposite sides of a real table each sees the other's avatar on the real person (each headset's own room scan must contain the
  table). Sitting at a corner (90°) is not handled: the guest's view would be turned by a quarter.
- **Photos** (camera tool) cannot see the passthrough image (a web page has no access to the cameras), so they get the lab's background.

## Interface notes (from the synthetic first-time-user test)

Panel text is fitted (long text shrinks, then gets an ellipsis; desktop also shows every message as a toast). Hovering a toolbar button
shows what it does in the panel footer. SETTINGS has two pages (General / Display) so nothing falls off the bottom. Empty clicks with
Add / Delete / Zap / Bring say what to aim at. Starting the tutorial with a changed structure asks first (save / replace / cancel).
The first view is close to the structure (key F re-fits it). New visitors start at Adult level. On a phone (< 760 px) the panel is the
**Menu** button and a bottom sheet, and the toolbar is a swipeable strip.

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

**Edges** (2026-11-12). The plain pi model gets the textbook nanoribbon families right (checked: armchair N = 3p+2 gapless, N = 7
1.28 eV vs 1.27, N = 10 0.94 vs 0.91; zigzag ribbons metallic), but real narrow ribbons all have gaps. Two edge effects are now in:
- *Armchair edge dimers* (always on): the bond between the two edge atoms is shorter and its hopping 12 % stronger (Son, Cohen, Louie,
  PRL 97, 216803 (2006)). N = 7 then has 1.57 eV (their formula: +0.28 eV; DFT ~1.5-1.6) and the 3p+2 ribbons a small gap (N = 8:
  0.13 eV). Edge dimer = two bonded carbons with two carbon neighbours each, both bonded to a three-fold carbon (not chains, not benzene).
- *Spin-polarised zigzag edges* (ELEC: *Edge magnetism*, on by default): mean-field Hubbard, U = t = 2.7 eV, H_s = H0 + U(n_-s - 1/2),
  solved self-consistently per geometry (sublattice-antiferromagnetic start, linear mixing, the chemical potential mid-gap of the two spin
  spectra); T(E) and the bond currents are the spin averages. A 1.3 nm zigzag ribbon gets edge moments ~0.14 uB and a 0.47 eV transport
  gap (LSDA ~0.5 eV); a structure without edge states (benzene, chains) converges to the non-magnetic solution and is unchanged. Cost:
  for a 238-atom flake the full T(E), I(V) goes from 2.1 to 7.6 s and a live update from 0.25 to 0.8 s on a desktop (a Quest ~3x more);
  the worker starts each live update from the last solution (2 iterations) and skips the spin loop while the structure is non-magnetic.
- *Edge roughness*: a ribbon that is metallic when perfect gets a transport gap from rough edges - localisation, growing with length
  (armchair N = 8, 20 % of its edge atoms removed: 1.4 eV over 6 nm, 1.9 eV over 15 nm; zigzag 1.3 nm: none over 6 nm, 1.5 eV over 15 nm).
  This is why lithographic ribbons show transport gaps ~ 1/W whatever their orientation (Han et al., PRL 98, 206805 (2007)).
- Still missing: the many-body enhancement of the gaps (a 7-armchair ribbon is ~2.4 eV in experiment), and any self-consistent
  potential drop under bias.
`test/ribbons.test.mjs` checks all of these.

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
- **Substrate** (None / Graphene / MoS2 / SiO2, src/substrate.js): fixed atoms under the structure, about the table circle in size and at least 10 A beyond the structure; not in the MD, only 12-6 van der Waals on the moving atoms: carbon on the graphene substrate with sigma 3.40 A and the depth set to the bilayer-graphene interlayer binding (45 meV per flake atom at 3.40 A; graphite exfoliation ~50 meV/atom - UFF had 72, about 1.6 times too strong), other pairs UFF (MoS2 42, SiO2 23 meV per flake carbon). For graphene and MoS2 the field is a precomputed lattice table (one cell, 0.1 A in plane, 0.08 A in height, looked up trilinearly; within 3 % of the direct sum in force, 2 meV/atom in energy, at 2.8-6.7 A) - a force call with a substrate under a 238-atom flake went from 2.3 to 0.3 ms; atoms within 2.6 A of the surface or near the disc edge, and SiO2, use the direct sum. test/substrate.test.mjs.
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
- Recentring (Meta button, or Settings) fits the table to the user: half a metre below the eyes, seated or standing; the VR tab has a
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

Used on Meta Quest headsets by hand. Automated checks run headlessly with Chromium + the Immersive Web Emulation Runtime
(`test/xr-emulator.cjs`: session start, ray/UI hit, trigger, tweezers, thumbsticks, grip; `test/xr-ar.cjs`: see-through on a
real table with a stand-in room scan). Passthrough itself and real room-scan data can only be checked on a headset.

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
