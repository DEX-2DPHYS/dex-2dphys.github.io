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
];

export const VR_HELP = [
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
      'GRIP: pick up and rotate the experiment. Both grips: stretch to scale it.',
      'RIGHT stick up/down: heat or cool (target T).  LEFT stick up/down: expand or compress the box.',
      'A / X: next tool.  B / Y: run or pause.  Thumbstick click: recentre in front of you.',
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
