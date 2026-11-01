// Lab tasks (each "Load this setup" builds a system) and the VR set-up help pages.
// build: recipe for BUILD tab; TsetK: thermostat target; equil: [[steps, K], ...] silent pre-equilibration.

export const TASKS = [
  {
    title: '1 · Build a crystal',
    goal: 'Make an argon crystal and watch what "solid" means at the atomic scale: atoms vibrating about fixed lattice sites.',
    setup: { build: { el: 'Ar', cells: 4, start: 'fcc', rho: 1.08, T0: 20 }, TsetK: 20 },
    steps: [
      'Load the setup: 256 argon atoms in an FCC lattice at 20 K.',
      'Use the tweezers to push one atom out of place and let go. Where does it go?',
      'On RUN, set colour to Coordination: every atom has Z ≈ 12 neighbours.',
      'Open the g(r) plot: sharp peaks near 1.1σ, 1.6σ and 1.9σ. Read the first peak position in nm.',
    ],
    ask: 'Experimental solid argon has nearest neighbours at 0.376 nm. How well does the model agree?',
  },
  {
    title: '2 · Melt the crystal',
    goal: 'Heat a crystal in small steps and find the temperature at which order is lost.',
    setup: { build: { el: 'Ar', cells: 5, start: 'fcc', rho: 0.96, T0: 30 }, TsetK: 30 },
    steps: [
      'Load the setup (500 atoms at 30 K, thermostat on).',
      'Raise the target temperature by about 10 K at a time (RUN tab, or right thumbstick in VR). Wait ~20 ps after each step.',
      'Watch "Looks like", the coordination colours, the width of the g(r) peaks and the MSD curve.',
      'Record a row (DATA tab) just below and just above the melting point, then cool it down again. Does it recrystallise at the same T?',
    ],
    ask: 'Real argon melts at 83.8 K at low pressure. Here the volume is fixed, so the pressure rises on heating. Why does that change the melting temperature? What does hysteresis tell you about the finite box?',
  },
  {
    title: '3 · Energy conservation and the time step',
    goal: 'In an isolated system (no thermostat) the total energy must stay constant - if the integrator is good enough.',
    setup: { build: { el: 'Ar', cells: 4, start: 'fcc', rho: 0.85, T0: 300 }, TsetK: 100, equil: [[500, 300], [500, 100]], thermo: false },
    steps: [
      'Load the setup: a liquid argon sample, equilibrated, then released with the thermostat OFF (NVE).',
      'In the energy plot, kinetic and potential energy trade places but the green total stays flat.',
      'On RUN, increase the time step to 0.01, then 0.02. Watch the total energy.',
      'Rebuild and find the largest time step with drift below 0.1 meV per atom over 50 ps.',
    ],
    ask: 'Why does the error grow with the time step? What is the fastest motion in this system that the step must resolve?',
  },
  {
    title: '4 · Pressure of a gas (Boyle’s law)',
    goal: 'Compress a dilute gas at constant temperature and test p · V = N k T.',
    setup: { build: { el: 'Ar', cells: 5, start: 'gas', rho: 0.05, T0: 300 }, TsetK: 300 },
    steps: [
      'Load the setup: 500 argon atoms at 300 K and low density.',
      'Wait for the pressure to settle, then press Record row on the DATA tab.',
      'Squeeze the box with the density slider (RUN tab), or the left thumbstick in VR. Record at several densities.',
      'Compare the recorded pressure with the ideal-gas value ρ* T* × 419 bar. At what density does the gas stop being ideal?',
    ],
    ask: 'Switch to Hard walls (RUN tab). Pressure is now measured from collisions with the walls. Does it agree with the periodic-box result?',
  },
  {
    title: '5 · Diffusion in a liquid',
    goal: 'Follow a single atom through a liquid and measure the diffusion constant from the mean-square displacement.',
    setup: { build: { el: 'Ar', cells: 5, start: 'fcc', rho: 0.84, T0: 300 }, TsetK: 90, equil: [[800, 300], [800, 90]] },
    steps: [
      'Load the setup: liquid argon near its triple point (90 K).',
      'The large yellow atom is tagged; its trail shows the random walk. Compare with the crystal of task 1.',
      'DATA tab: D is estimated as MSD / (6 t) from each finished window; wait for two windows.',
      'Change the target temperature to 70 K, 90 K, 110 K and 130 K, recording D each time. Plot ln D against 1/T.',
    ],
    ask: 'Experimental liquid argon at 90 K has D of order 2×10⁻⁹ m²/s. What is the activation energy from your plot?',
  },
  {
    title: '6 · Condensation',
    goal: 'Cool a gas below its critical temperature and watch droplets nucleate.',
    setup: { build: { el: 'Ar', cells: 5, start: 'gas', rho: 0.12, T0: 200 }, TsetK: 200, dt: 0.006, speed: 20 },
    steps: [
      'Load the setup: 500 argon atoms at 200 K, above the critical point (about 151 K in experiment).',
      'Set the target to 90 K and colour by Coordination. A droplet needs a few hundred ps to form - be patient or raise the speed.',
      'Watch the pressure and potential energy fall as atoms bind to the cluster.',
      'Heat the droplet again and find the temperature at which it evaporates completely.',
    ],
    ask: 'Why does the pressure fall as the droplet grows although the temperature is constant?',
  },
  {
    title: '7 · Defects and free play',
    goal: 'Make a vacancy, an interstitial and a surface, and see how the lattice reacts.',
    setup: { build: { el: 'Ar', cells: 4, start: 'fcc', rho: 1.0, T0: 15 }, TsetK: 15 },
    steps: [
      'Pick the Delete tool (BUILD tab, or button A/X in VR) and remove one atom. Colour by Coordination: its 12 neighbours now have Z = 11.',
      'Warm the crystal to 60 K and track the tagged atom: does the vacancy hop?',
      'Expand the box slowly (density slider on RUN, 1.0 \u2192 0.8). The stretched crystal is under tension - look for voids opening up.',
      'Switch element to Ne or Xe (BUILD) and compare how easily each melts - the energy scale is ε/k.',
    ],
    ask: 'Which atoms vibrate most strongly: bulk atoms, surface atoms or neighbours of the vacancy?',
  },
  {
    title: '8 \u00B7 Benzene',
    goal: 'A real molecule: six carbons and six hydrogens in a flat ring. Watch it vibrate, then let seven molecules find out how benzene sticks together.',
    setup: { build: { sys: 'mat', mat: 'benzene', nmol: 1, Tm: 300 }, TsetK: 300, speed: 20 },
    steps: [
      'Load the setup: one benzene molecule at 300 K. Bonds are drawn as sticks, white = H, grey = C.',
      'Open the Pair distances plot: peaks at 1.08 \u00C5 (C\u2013H), 1.40 \u00C5 (C\u2013C), 2.42 \u00C5 and 2.80 \u00C5 (meta and para carbons).',
      'Pick Grab: molecule and pull it. Raise the temperature to 1500 K: the ring stays flat but wobbles; the C\u2013H stretch (3060 cm\u207B\u00B9) has a period of about 11 fs.',
      'Now go to BUILD, choose Benzene with 7 molecules at 100 K and let it relax: look for the molecules lining up edge-to-face (T-shaped), driven by the partial charges.',
    ],
    ask: 'Why do neighbouring benzene rings prefer a T-shaped or slipped-parallel arrangement and not sitting directly face-to-face?',
  },
  {
    title: '9 \u00B7 Graphene',
    goal: 'A single sheet of carbon atoms. Heat it, watch it ripple, and tear a hole in it.',
    setup: { build: { sys: 'mat', mat: 'graphene', size: 10, Tm: 300 }, TsetK: 300, speed: 8 },
    steps: [
      'Load the setup: a periodic sheet at 300 K (bond 1.44 \u00C5 in this potential; experiment 1.42 \u00C5). Every atom has three bonds.',
      'Rotate the view to see the sheet edge-on: thermal ripples grow with temperature. Try 1000 K and 2000 K.',
      'Delete one atom with the Delete tool. Colour by Defects: three neighbours now have only two bonds. Watch whether the hole reconstructs into a pentagon and a nine-ring.',
      'Delete a short line of atoms and heat to 2500 K: where does the sheet fail first?',
    ],
    ask: 'Why can a layer one atom thick be so strong and still ripple so easily?',
  },
  {
    title: '10 \u00B7 Graphite and van der Waals',
    goal: 'Graphite is graphene layers held together only by weak van der Waals forces. Peel one layer off and measure the force.',
    setup: { build: { sys: 'mat', mat: 'graphite', size: 7, layers: 3, Tm: 100 }, TsetK: 100, speed: 6 },
    steps: [
      'Load the setup: three AB-stacked layers at 100 K, spaced 3.35 \u00C5 apart.',
      'Choose Tweezers with Grab: layer, aim at the top layer and pull upwards slowly. The footer shows the tweezer force in nN.',
      'Pull slowly: the reading is the force in the tweezer spring and it peaks just before the layer lets go. Lift the layer 6 \u00C5 and note the largest force; per atom it should be a few tens of meV/\u00C5. Release: the layer falls back and re-stacks.',
      'Estimate the work (force \u00D7 distance) and divide by the number of atoms in the layer. The binding energy of graphite is about 50 meV per atom.',
      'Slide the top layer sideways instead of lifting it. Is it easier or harder?',
    ],
    ask: 'Why is sliding along the layers so much easier than pulling them apart? What does that say about graphite as a lubricant and as pencil lead?',
  },
  {
    title: '11 \u00B7 MoS\u2082 layers',
    goal: 'A transition-metal dichalcogenide: each layer is a Mo plane between two S planes. Compare it with graphite.',
    setup: { build: { sys: 'mat', mat: 'mos2', size: 7, layers: 2, Tm: 300 }, TsetK: 300, speed: 6 },
    steps: [
      'Load the setup: a 2H bilayer at 300 K. Mo atoms are teal, S yellow; each Mo has six S neighbours.',
      'Colour by Defects: edges and surface atoms stay blue (the S atoms keep their three Mo bonds).',
      'Grab one layer and slide it. The footer shows the force. Compare with task 10.',
      'Heat the bilayer in steps up to 700 K and watch the layer thickness (S\u2013S distance across one layer). Then go above 800 K and wait: the lattice collapses into a dense, much lower-energy state that real MoS\u2082 does not have.',
    ],
    ask: 'The potential gives a = 3.12 \u00C5 (experiment 3.16 \u00C5) and fails above ~800 K. What does that tell you about trusting any force field outside the conditions it was fitted for?',
  },
  {
    title: '12 \u00B7 Nanodiamond',
    goal: 'A nanometre-sized piece of diamond, cut from the lattice. Its surface is bare, so see what the atoms do about their dangling bonds.',
    setup: { build: { sys: 'mat', mat: 'nanodiamond', rad: 7, Tm: 300 }, TsetK: 300, speed: 8 },
    steps: [
      'Load the setup: a diamond cluster about 1.4 nm across. Colour by Defects: the core (4 bonds) is blue and the surface is red.',
      'Heat to 1500 K and then 2500 K in steps. Watch how the surface atoms rearrange.',
      'Compare the Pair distances plot at 300 K and 2500 K: diamond has a peak at 1.54 \u00C5 (sp\u00B3); graphite-like carbon (sp\u00B2) has one near 1.42 \u00C5.',
      'Cool it back to 300 K. Is it still diamond?',
    ],
    ask: 'Real nanodiamonds have hydrogen or oxygen on the surface. What would change here if every dangling bond were capped?',
  },
  {
    title: '13 \u00B7 Current through graphene',
    goal: 'Put two electrodes on a graphene flake and watch where the electrons go - while the atoms keep moving.',
    setup: { build: { sys: 'mat', mat: 'graphene', size: 10, Tm: 100, open: true }, TsetK: 100, speed: 6, contacts: 'ends', tab: 'ELEC' },
    steps: [
      'Load the setup: an open graphene flake (no periodic boundaries, free edges) at 100 K, with electrodes on the two short ends. Blue atoms are the \u2212 contact (electrons enter), red atoms the + contact.',
      'The ELEC tab shows the result. The arrows are the bond currents (conventional current, from + to \u2212): larger and warmer = more current. The plots show the transmission T(E) and the current I(V).',
      'Move the electrodes with the \u2212 and + contact tools: click (or drag over) atoms to add them, click again to remove. Try one atom at each end, then a whole edge.',
      'Delete a few atoms in the middle, or stretch the flake with the tweezers. The current finds its way round the hole, and the I(V) curve changes.',
    ],
    ask: 'Graphene has no band gap. How can you see that in T(E) and I(V)? Where in the flake does most of the current run, and why?',
  },
  {
    title: '14 \u00B7 Quantum interference in benzene',
    goal: 'The same molecule, the same electrodes - but where you attach them decides whether the waves add up or cancel.',
    setup: { build: { sys: 'mat', mat: 'benzene', nmol: 1, Tm: 20 }, TsetK: 20, speed: 4, contacts: [[0], [3]], tab: 'ELEC', bias: 0.5 },
    steps: [
      'Load the setup: one benzene molecule at 20 K with the electrodes on opposite carbon atoms (para).',
      'Read T(E_F) and the current on the ELEC tab. Benzene has a gap of about 5 eV, so the current is small - but not zero.',
      'Press Clear contacts and put the + contact two carbons round the ring from the \u2212 contact (meta). The current drops by a factor of a few hundred: the two paths round the ring cancel.',
      'Try ortho (neighbouring carbons). Then raise the bias towards 6 V: when the bias window reaches a molecular level the current jumps (resonant tunnelling).',
    ],
    ask: 'The electron has the same distance to travel in all three cases. Why does meta conduct so much worse at low bias?',
  },
];

export const VR_HELP = [
  {
    title: 'Quest + PC (Meta Horizon Link)',
    lines: [
      '1.  Connect the Quest to the PC (Link cable or Air Link) and start Link in the headset. In the Meta Horizon Link app on the PC: Settings \u2192 General \u2192 OpenXR runtime = Meta Horizon Link.',
      '2.  Open this page in Chrome or Edge on the PC (http://localhost or https, not file://) and press Enter VR once.',
      '3.  If the headset only shows a loading screen: an earlier Chrome session is still holding Link. Close Chrome completely (Task Manager \u2192 End task), restart Link in the headset and try again.',
      '4.  Windows: set Chrome to "High performance" in Settings \u2192 System \u2192 Display \u2192 Graphics, so it uses the same graphics card as Link.',
    ],
  },
  {
    title: 'Quest + PC via SteamVR',
    lines: [
      '1.  Connect the headset to the PC (Link cable, Air Link, Steam Link or Virtual Desktop) and start SteamVR.',
      '2.  In SteamVR, open Settings → Developer and choose "Set SteamVR as OpenXR runtime".',
      '3.  Open this page in Chrome or Edge on the PC and press Enter VR. The simulation then runs inside SteamVR on the headset. Local files need http://localhost, not file://.',
      '4.  If the Meta Quest Link app is the active OpenXR runtime instead, the session opens there - that works too.',
    ],
  },
  {
    title: 'Standalone Quest (no PC)',
    lines: [
      'Open the Meta Quest Browser, go to the address of this page and press Enter VR (HTTPS is required).',
      'The simulation runs on the headset’s own processor, so it is slower. Use up to ~500 atoms and the default settings; use the PC route for 1000+ atoms.',
      'Quest 2, 3, 3S and Pro and any other WebXR headset with controllers work. Hand tracking is not used.',
    ],
  },
  {
    title: 'Controls in VR',
    lines: [
      'Point at the panel with a controller ray and pull the TRIGGER to press buttons or drag sliders.',
      'Aim at atoms and hold the TRIGGER with the Tweezers tool: the atom follows your hand through a spring. Push the thumbstick forward or back to reel it in or out.',
      'GRIP while pointing at a panel: move the panel. GRIP anywhere else: pick up and rotate the experiment. Both grips: stretch to scale it.',
      'LEFT stick: walk (glide) in the direction you look, also while seated.  RIGHT stick left/right: turn (30\u00B0 steps, or smooth - VR tab).  RIGHT stick up/down: heat or cool (target T). Box size and table height: sliders on the RUN and VR tabs.',
      'A / X: next tool.  B / Y: run or pause.  Thumbstick click: recentre in front of you.',
      'Recentring also fits the table and the panels to your eye height, seated or standing. The VR tab has a table-height slider and a dark / white lab switch.',
    ],
  },
  {
    title: 'Electron transport: how it is modelled',
    lines: [
      'One \u03C0 (p) orbital per carbon atom, pointing along the local normal of its bonds. Hopping between orbitals follows their actual distance and angle (Slater-Koster form, -2.7 eV at 1.42 \u00C5), so stretching, rippling and the graphite interlayer coupling all enter.',
      'Electrodes are wide-band contacts on the marked atoms. T(E), the current I = (2e\u00B2/h) \u222B T(E)[f\u208B - f\u208A] dE and the bond currents come from the Green\u2019s function, recomputed from the live geometry a few times a second.',
      'The bias only sets the energy window (no self-consistent potential drop). Hydrogen carries no orbital; MoS\u2082 needs a d-orbital model and is not supported. Use Open flake for sheets: on a periodic sheet the current can also run round the boundary.',
    ],
  },
  {
    title: 'Materials: how they are modelled',
    lines: [
      'Graphene, graphite and nanodiamond use the Tersoff bond-order potential for carbon: bonds can stretch, break and re-form. Graphene uses the Lindsay-Broido parameters, diamond the original Tersoff set.',
      'MoS\u2082 uses Jiang\u2019s Stillinger-Weber potential (LAMMPS "sw/mod"). Benzene uses an OPLS-style molecular force field with partial charges; it cannot break.',
      'Layers and molecules attract each other through Lennard-Jones van der Waals terms tuned to the graphite binding energy (about 50 meV per atom) and the MoS\u2082 interlayer spacing and binding (0.2 J/m\u00B2).',
      'Energies and forces of the Tersoff and Stillinger-Weber models were checked against LAMMPS (agreement 10\u207B\u00B9\u00B2 eV). Pressure is not computed for materials.',
    ],
  },
  {
    title: 'The model',
    lines: [
      'Atoms interact through the Lennard-Jones potential, V = 4ε[(σ/r)¹² − (σ/r)⁶], cut off and shifted at 2.5σ. Velocity-Verlet integration, cell + neighbour lists, Berendsen thermostat.',
      'Everything is computed in reduced units and shown in real units for the chosen noble gas (σ, ε, m). One time unit is about 2.16 ps for argon.',
      'Pressure uses the virial (periodic box) or wall collisions (hard walls). No long-range tail corrections are applied.',
      'Coordination counts neighbours within 1.4σ. D = MSD/(6t).',
    ],
  },
];
