/* app.js — UI orchestration, rendering and export for the Graphene Hybrid
 * FEM / Ballistic Transport Explorer. Plain ES5-ish browser JS (no build step).
 * Depends on physics.js, fem_solver.js, trajectory_solver.js, maps.js.
 */
(function () {
  "use strict";
  const { PHYS, U, phys, FEMSolver, fem, TrajectorySolver, maps } = GT;

  /* ===== Help text: every control, exact 3-section structure ============= */
  const HELP_TEXT = {
    deviceWidth: { what: "The horizontal size of the rectangular graphene device.", physics: "Sets the source–drain separation L. Transport is diffusive when the mean free path is much smaller than this, ballistic when comparable or larger.", how: "Use micrometres. Larger devices favour diffusive (FEM) behaviour." },
    deviceHeight: { what: "The vertical size (transverse width W) of the device.", physics: "The width sets the number of conducting modes (M ≈ W·k_F/π) and the scale for magnetic focusing (r_c ~ W).", how: "Use micrometres. Narrow devices show stronger boundary and ballistic effects." },
    gridResolution: { what: "Number of finite-volume cells along the longer axis of the device.", physics: "Finer grids resolve sharp gradients and thin features better, at higher computational cost (roughly N^1.5).", how: "Start around 80–120 for interactive use; increase for sharper fields." },
    carrierDensity: { what: "The areal carrier density n of the graphene sheet.", physics: "Sets the Fermi wavevector k_F = √(π|n|), the conductivity σ₀ = e|n|μ, the cyclotron radius and the mode count. Its sign selects electrons (n>0) or holes (n<0).", how: "Enter in cm⁻². Typical gated graphene is 10¹¹–10¹³ cm⁻²." },
    mobility: { what: "The carrier mobility μ of the graphene.", physics: "Sets the conductivity σ₀ = e|n|μ and, via ℓ = ħμ√(π|n|)/e, the mean free path.", how: "Enter in cm²/Vs. Exfoliated graphene on hBN can reach 10⁴–10⁶." },
    meanFreePath: { what: "The average distance an electron travels before its momentum is randomized by scattering.", physics: "When the mean free path is much shorter than the device size, transport is diffusive. When it is comparable to or larger than the device size, ballistic and nonlocal effects become important.", how: "Start with a small value to reproduce FEM-like diffusive behavior, then increase it to see the transition into quasi-ballistic and ballistic transport." },
    mfpFromMobility: { what: "Compute the mean free path from mobility and density instead of entering it directly.", physics: "Uses the semiclassical graphene relation ℓ = ħ μ √(π|n|) / e. This is an estimate, not an exact value.", how: "Tick to derive ℓ automatically; untick to override it manually." },
    magneticField: { what: "The out-of-plane magnetic field B.", physics: "Bends trajectories along cyclotron arcs of radius r_c = ħk_F/(eB) and produces a Hall conductivity σ_xy ∝ sign(n)μB. Reversing B reverses the Hall sign.", how: "Use tesla. Sweep through 0 to see straight→curved trajectories and the onset of magnetic focusing." },
    sourceVoltage: { what: "The fixed potential applied to the source contact.", physics: "Together with the drain voltage it drives the current. Resistance is R = (V_source − V_drain)/I.", how: "Use volts (millivolts are typical). Only the difference matters for linear response." },
    drainVoltage: { what: "The fixed potential applied to the drain contact.", physics: "Sets the second Dirichlet boundary for the drift-diffusion solve.", how: "Use volts. Often set to 0 as the reference." },
    contactDefinition: { what: "The set of terminals (contacts) on the device edges.", physics: "Contacts inject, collect or sense carriers. Their placement determines whether a probe pair reads the longitudinal (R_xx) or Hall (R_xy) signal.", how: "Use the default Hall bar, or edit positions/widths. Place a pair across the current for Hall, along it for longitudinal." },
    contactRole: { what: "The role of each contact: source, drain, voltage probe, or absorber/floating.", physics: "Source and drain are fixed-voltage (Dirichlet) terminals. Voltage probes are read passively. Absorbers remove carriers without injecting.", how: "Assign one source and one drain at minimum; add probes to read potentials." },
    densityMap: { what: "An optional image giving the spatial map of local carrier density n(x,y).", physics: "Represents gates, p–n junctions, inhomogeneity, charge puddles or patterned electrostatic landscapes. Local n sets local k_F, r_c and conductivity.", how: "Upload a JPG/PNG; brighter pixels map to higher density between the chosen min and max." },
    mobilityMap: { what: "An optional image giving the spatial map of local mobility μ(x,y).", physics: "Local mobility sets local conductivity and/or local mean free path, allowing dirty and clean regions in one device.", how: "Upload a JPG/PNG and choose whether it controls conductivity, mean free path, or both." },
    contactMap: { what: "An optional image that defines contacts from coloured regions.", physics: "Convention: black = active graphene, white = etched/outside, saturated colours = contacts.", how: "Upload a JPG/PNG; each distinct colour becomes a contact you can assign a role to." },
    mapChannel: { what: "Which colour channel of the image is read as intensity.", physics: "Different channels let one image encode different fields.", how: "Use luminance for greyscale maps, or pick R/G/B for colour-coded maps." },
    mapInvert: { what: "Invert the image intensity before mapping to a value.", physics: "Flips the correspondence between brightness and the physical quantity.", how: "Tick if dark regions should mean high density/mobility." },
    mapSmooth: { what: "Spatially smooth the map with a box blur.", physics: "Removes pixel noise and sharp jumps that the coarse solver grid cannot resolve.", how: "Increase the radius for noisier images; keep at 0 for sharp features." },
    scatteringModel: { what: "How a scattering event changes the electron's direction.", physics: "Isotropic randomizes the angle fully; small-angle gives gentle deflections; forward-biased keeps memory of direction; none is the ballistic limit.", how: "Use isotropic for strong disorder, small-angle/forward for smoother scattering." },
    edgeScattering: { what: "How electrons interact with insulating device edges.", physics: "Specular reflection conserves the tangential momentum; diffuse randomizes it; absorbing removes the carrier; mixed interpolates.", how: "Use specular for clean edges, diffuse for rough edges." },
    numTrajectories: { what: "How many electron trajectories to launch from the source.", physics: "More trajectories reduce statistical noise in transmission and density estimates (error ~ 1/√N).", how: "Start at ~2,000; increase toward 10⁵ for smoother statistics (slower)." },
    randomSeed: { what: "Seed for the random number generator.", physics: "Fixes the stochastic launch angles and scattering so runs are reproducible.", how: "Keep fixed to compare changes; vary it to see statistical scatter." },
    sweepMeasure: { what: "What the sweep measures: the two-terminal source–drain response, or a four-probe resistance from a probe pair.", physics: "Two-terminal G = I/ΔV (and R = 1/G) is EVEN in B — a symmetric dome that never crosses zero. A four-probe resistance R = (V₁−V₂)/I uses the voltage probes: the transverse (Hall) pair gives R_xy, which is ODD in B and passes through the origin (R_xy(B=0)=0, R_xy ≈ B/ne); the in-line pair gives the longitudinal R_xx. Probe measurements come from the FEM (the trajectory model has no probe voltages).", how: "Use a Hall-bar or Hall-cross layout with a transverse probe pair, pick Hall R_xy, and sweep B to see it cross the origin." },
    parameterSweep: { what: "Sweep gate voltage V_g and/or magnetic field B and plot the two-terminal conductance G (in Siemens, on a shared axis).", physics: "G vs V_g traces the ambipolar transfer curve (n = C_ox(V_g−V₀)/e); G vs B shows magnetoconductance; the 2D sweep maps G over both. FEM gives the diffusive drift-diffusion G = I/ΔV; the Landauer curve is the ballistic↔diffusive crossover (see its help).", how: "Choose the sweep type, set the ranges and gate model, tick FEM and/or Landauer, then Run sweep. Export CSV for the raw values." },
    landauerCrossover: { what: "Semiclassical Landauer–Büttiker conductance spanning the ballistic and diffusive regimes.", physics: "The ballistic (Sharvin) resistance from the trajectory transmission, R_ball = 1/[(4e²/h)·M·T̄] with M = k_F·W/π (k_F=√(πn)) and cosine-injected flux, is added IN SERIES with the diffusive (Drude) resistance from the FEM solve: G = 1/(1/G_ball + 1/G_Drude). It tends to the Sharvin ceiling when ℓ≫L and converges to the FEM/Drude value when ℓ≪L — which is why a pure-ballistic estimate (T̄≈1) never matches FEM at short mean free path. A direct trajectory Monte-Carlo cannot reach the deep-diffusive limit because diffusion across the channel needs ~(L/ℓ)² steps; the series crossover supplies that limit analytically.", how: "Tick it alongside FEM and watch the two curves meet as you lower the mobility (shorter ℓ)." },
    sweepSnapshots: { what: "Store the full device field (potential/current for FEM, density for ballistic) at every swept point.", physics: "Lets you scrub back through the sweep and watch how the fields evolve with gate voltage and magnetic field — e.g. current crowding, Hall deflection, or the channel pinching off near the Dirac point.", how: "Tick before running, then use the sliders below the plot to step through V_g and B. Memory grows with points × grid, so keep large 2-D sweeps modest. Computed inline (workers off)." },
    webWorkers: { what: "Run the independent sweep points in parallel across background threads.", physics: "Each sweep point is an independent solve, so they parallelize cleanly. The solver code is identical to the inline path, so results match.", how: "Enable for large sweeps and set the thread count (≈ CPU cores). Requires serving over http (e.g. python -m http.server); falls back to inline if workers are unavailable." },
    maxPathLength: { what: "The largest total arc length a single trajectory may travel before it is stopped — the binding physical limit on trajectory length.", physics: "A diffusive carrier random-walks, so reaching a contact a distance L away takes a path of order L²/ℓ; a ballistic carrier in a large device still needs a path of order L. The step cap auto-scales to reach this length (≈ max-path/ds steps), so this value — not ‘Max trajectory steps’ — governs how far carriers can go.", how: "Increase it so carriers can actually reach the drain (raises transmission); larger values cost proportionally more time. ‘Max trajectory steps’ now only acts as a floor/safety cap." },
    simulationMode: { what: "Which physical model to run.", physics: "Diffusive FEM solves drift-diffusion; ballistic/quasi-ballistic propagate trajectories; hybrid runs both for comparison.", how: "Pick the regime suggested by the validity assistant, or compare in hybrid mode." },
    femIterations: { what: "Maximum iterations for the linear FEM solver.", physics: "The iterative (BiCGSTAB) solver stops at this cap if the tolerance is not yet met.", how: "Increase if the convergence indicator reports non-convergence." },
    femTolerance: { what: "Relative residual at which the FEM solve is considered converged.", physics: "Smaller tolerances give more accurate potentials at higher cost.", how: "1e-7 is a good default; loosen for speed, tighten for accuracy." },
    trajTimeStep: { what: "The spatial step length used to advance each trajectory.", physics: "Smaller steps resolve cyclotron arcs and scattering more accurately.", how: "Defaults to device size / 400. Reduce for strong magnetic fields." },
    maxTrajSteps: { what: "Maximum number of steps before a trajectory is stopped.", physics: "Prevents trajectories trapped by scattering or orbits from running forever.", how: "Increase if many trajectories report 'max steps' instead of reaching a contact." },
    exportResults: { what: "Download the current inputs and results.", physics: "Captures parameters, derived quantities, FEM summary and trajectory statistics for reproducibility.", how: "Use Export JSON for data and Export PNG for the current view." },
  };

  /* ===== Contacts are rectangles in fractional device coords (y up, 0..1):
   * {id, role, x0,y0,x1,y1, color?}. They may sit on edges or in the interior,
   * be drawn interactively, or be imported (as bounding boxes) from a map. ==== */
  const ROLE_COLOR = { source: "#e06c75", drain: "#61afef", probe: "#e5c07b", absorber: "#98c379", floating: "#98c379" };
  const RECT_PRESETS = {
    hall_bar: [
      { id: "source", role: "source", x0: 0.0, y0: 0.05, x1: 0.04, y1: 0.95 },
      { id: "drain", role: "drain", x0: 0.96, y0: 0.05, x1: 1.0, y1: 0.95 },
      { id: "probe_top", role: "probe", x0: 0.42, y0: 0.93, x1: 0.58, y1: 1.0 },
      { id: "probe_bottom", role: "probe", x0: 0.42, y0: 0.0, x1: 0.58, y1: 0.07 },
    ],
    two_terminal: [
      { id: "source", role: "source", x0: 0.0, y0: 0.05, x1: 0.04, y1: 0.95 },
      { id: "drain", role: "drain", x0: 0.96, y0: 0.05, x1: 1.0, y1: 0.95 },
    ],
    four_probe: [
      { id: "source", role: "source", x0: 0.0, y0: 0.05, x1: 0.04, y1: 0.95 },
      { id: "drain", role: "drain", x0: 0.96, y0: 0.05, x1: 1.0, y1: 0.95 },
      { id: "probe_1", role: "probe", x0: 0.28, y0: 0.93, x1: 0.40, y1: 1.0 },
      { id: "probe_2", role: "probe", x0: 0.60, y0: 0.93, x1: 0.72, y1: 1.0 },
    ],
    hall_cross: [
      { id: "source", role: "source", x0: 0.0, y0: 0.35, x1: 0.04, y1: 0.65 },
      { id: "drain", role: "drain", x0: 0.96, y0: 0.35, x1: 1.0, y1: 0.65 },
      { id: "probe_top", role: "probe", x0: 0.35, y0: 0.96, x1: 0.65, y1: 1.0 },
      { id: "probe_bottom", role: "probe", x0: 0.35, y0: 0.0, x1: 0.65, y1: 0.04 },
    ],
  };
  function presetRects(name) { return RECT_PRESETS[name].map((c) => ({ ...c, color: ROLE_COLOR[c.role] })); }
  function inRect(xf, yf, c) { return xf >= c.x0 && xf <= c.x1 && yf >= c.y0 && yf <= c.y1; }

  /* ===== Default device: graphene Hall bar ================================ */
  function defaults() {
    return {
      W_um: 4.0, H_um: 2.0, res: 100,
      n_cm2: 1e12, mu_cm: 50000, B: 0.0,
      mfpFromMobility: true, mfp_um: 0.5,
      Vsource: 1e-3, Vdrain: 0.0,
      scattering: "isotropic", edge: "specular",
      nTraj: 2000, seed: 7, mode: "hybrid",
      femIter: 3000, femTol: 1e-7, maxSteps: 8000, maxPath_um: 240,
      contacts: presetRects("hall_bar"),
      // gate model n(Vg): SiO2 300 nm by default
      tox_nm: 300, epsr: 3.9, vdirac: 0,
      // sweep configuration
      sweepType: "vg", sweepFem: true, sweepBal: false, sweepSnap: false, sweepBalMode: "crossover",
      vgFrom: -40, vgTo: 40, vgN: 41, bFrom: -1, bTo: 1, bN: 41,
      lFrom: 1, lTo: 10000, lN: 41, sweepQuantity: "G", sweepMeasure: "2t",
      useWorkers: false, workerCount: Math.max(1, (navigator.hardwareConcurrency || 4) - 1),
    };
  }

  // Gate model: areal density (cm⁻², signed) from gate voltage via parallel-plate
  // capacitance n = Cox (Vg − V0) / e, Cox = εr ε0 / t_ox.
  function densityCm2FromVg(Vg) {
    const eps0 = 8.8541878128e-12;
    const Cox = state.epsr * eps0 / (state.tox_nm * 1e-9); // F/m²
    return (Cox * (Vg - state.vdirac) / PHYS.e) / 1e4;     // m⁻² → cm⁻²
  }

  let state = defaults();
  let densityField = null, mobilityField = null; // {values,gx,gy} in image space
  let lastFEM = null, lastTraj = null, lastSweep = null;
  let activeTab = "device";

  /* ===== Colormaps ======================================================= */
  const VIRIDIS = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
  const RDBU = [[178,24,43],[239,138,98],[247,247,247],[103,169,207],[33,102,172]];
  function lut(stops, t) {
    t = Math.min(1, Math.max(0, t));
    const x = t * (stops.length - 1), i = Math.floor(x), f = x - i;
    const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
    return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f];
  }

  /* ===== Unit helpers ===================================================== */
  function siParams() {
    const W = U.umToM(state.W_um), H = U.umToM(state.H_um);
    const n = U.cm2ToM2(state.n_cm2);
    const mu = U.mobCmToSI(state.mu_cm);
    let mfp = state.mfpFromMobility ? phys.mfpFromMobility(mu, n) : U.umToM(state.mfp_um);
    return { W, H, n, mu, mfp };
  }

  function solverGrid() {
    const { W, H } = siParams();
    const long = Math.max(state.W_um, state.H_um);
    const nx = Math.max(8, Math.round(state.res * state.W_um / long));
    const ny = Math.max(8, Math.round(state.res * state.H_um / long));
    return { nx, ny, dx: W / nx, dy: H / ny };
  }

  // Per-cell carrier density and mobility arrays (apply maps if loaded).
  function fields(nx, ny) {
    const { W, H, n, mu } = siParams();
    const nArr = new Float64Array(nx * ny).fill(n);
    const muArr = new Float64Array(nx * ny).fill(mu);
    if (densityField) {
      const r = maps.resampleToGrid(densityField, W, H, nx, ny);
      for (let k = 0; k < r.length; k++) nArr[k] = U.cm2ToM2(r[k]);
    }
    if (mobilityField && (state.mobScope === "cond" || state.mobScope === "both" || !state.mobScope)) {
      const r = maps.resampleToGrid(mobilityField, W, H, nx, ny);
      for (let k = 0; k < r.length; k++) muArr[k] = U.mobCmToSI(r[k]);
    }
    return { nArr, muArr };
  }

  /* ===== Contacts: rectangle regions -> grid cells, Dirichlet, samplers === */
  // Which contact (if any) covers fractional device point (xf, yf). y is up.
  function contactAtFrac(xf, yf) {
    for (const c of state.contacts) if (inRect(xf, yf, c)) return c;
    return null;
  }

  // FEM Dirichlet mask/values for source & drain; probe cells for readout.
  function dirichletMasks(nx, ny) {
    const mask = new Uint8Array(nx * ny), val = new Float64Array(nx * ny);
    const probeMap = {};
    for (let j = 0; j < ny; j++) {
      const yf = (j + 0.5) / ny;
      for (let i = 0; i < nx; i++) {
        const c = contactAtFrac((i + 0.5) / nx, yf);
        if (!c) continue;
        const k = j * nx + i;
        if (c.role === "source" || c.role === "drain") {
          mask[k] = 1; val[k] = c.role === "source" ? state.Vsource : state.Vdrain;
        } else {
          (probeMap[c.id] = probeMap[c.id] || []).push(k);
        }
      }
    }
    const probes = Object.keys(probeMap).map((id) => ({ id, cells: probeMap[id] }));
    return { mask, val, probes };
  }

  // Geometry of a contact: which edge it sits on (inward-normal angle), its
  // transverse width (mode count ∝ width) and centre, in SI metres.
  function edgeInfo(c) {
    const { W, H } = siParams();
    const gap = { left: c.x0, right: 1 - c.x1, bottom: c.y0, top: 1 - c.y1 };
    const e = Object.keys(gap).reduce((a, b) => (gap[b] < gap[a] ? b : a));
    const ang = { left: 0, right: Math.PI, bottom: Math.PI / 2, top: -Math.PI / 2 }[e];
    const wid = (e === "left" || e === "right") ? (c.y1 - c.y0) * H : (c.x1 - c.x0) * W;
    return { ang, wid, cx: (c.x0 + c.x1) / 2 * W, cy: (c.y0 + c.y1) / 2 * H };
  }
  // Flux-correct (cosine / Knudsen) launch about a contact's inward normal.
  function makeLaunch(c) {
    const { W, H } = siParams(); const e = edgeInfo(c);
    return (rng) => {
      const xf = c.x0 + rng() * (c.x1 - c.x0), yf = c.y0 + rng() * (c.y1 - c.y0);
      return [xf * W, yf * H, e.ang + Math.asin(2 * rng() - 1)];
    };
  }

  // Build region-mode trajectory inputs from the rectangle contacts.
  function regionConfig() {
    const { W, H } = siParams();
    const contactAt = (x, y) => {
      const c = contactAtFrac(x / W, y / H);
      // voltage probes draw no net current, so they must NOT absorb carriers
      // (matching the FEM, where probe cells are passive readouts). Carriers that
      // reach a probe simply reflect off the edge like any insulating boundary.
      return (c && c.role !== "probe") ? { id: c.id, role: c.role } : null;
    };
    const sources = state.contacts.filter((c) => c.role === "source").map((c) => {
      const e = edgeInfo(c);
      return { id: c.id, role: "source", width: e.wid, cx: e.cx, cy: e.cy, launch: makeLaunch(c) };
    });
    const terminals = state.contacts.map((c) => ({ id: c.id }));
    return { contactAt, sources, terminals };
  }

  // Multi-terminal config: ALL contacts absorb and inject (for the Landauer–
  // Büttiker probe solve). Each contact is launched in turn.
  function multiterminalConfig() {
    const { W, H } = siParams();
    const contactAt = (x, y) => { const c = contactAtFrac(x / W, y / H); return c ? { id: c.id, role: c.role } : null; };
    const sources = state.contacts.map((c) => { const e = edgeInfo(c); return { id: c.id, role: c.role, width: e.wid, cx: e.cx, cy: e.cy, launch: makeLaunch(c) }; });
    return { contactAt, sources, terminals: state.contacts.map((c) => ({ id: c.id })) };
  }

  // Solve A x = b for small dense A (Gaussian elimination w/ partial pivot).
  function solveLinear(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-300) continue;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  // Ballistic/semiclassical four-probe resistance via multi-terminal Landauer–
  // Büttiker: launch from every contact, build the conductance matrix from the
  // transmission probabilities, hold the probes at zero net current, solve for
  // their floating voltages, then R = (V₁−V₂)/I_source.
  function trajButtikerR(kind) {
    const { W, H, n, mfp } = siParams();
    const kF = phys.fermiWavevector(Math.abs(n));
    const ballistic = state.scattering === "none";
    const region = multiterminalConfig();
    const cfg = {
      W, H, vF: PHYS.vF, n0: n, mfp: ballistic ? 1e9 : mfp, B: state.B,
      contactAt: region.contactAt, sources: region.sources, terminals: region.terminals,
      scattering: state.scattering, edge: state.edge,
      nTraj: Math.max(state.nTraj, 4000), seed: state.seed,
      ds: state.trajDs || Math.min(W, H) / 400, maxSteps: state.maxSteps, maxPath: U.umToM(state.maxPath_um),
      gx: 80, gy: Math.max(20, Math.round(80 * H / W)),
    };
    const res = new TrajectorySolver(cfg).run({ keepPaths: 0 });
    const Tb = {}; res.transmission.forEach((row) => (Tb[row.source] = row.T));
    const cs = state.contacts, ids = cs.map((c) => c.id), idx = {}; ids.forEach((id, i) => (idx[id] = i));
    const N = ids.length, M = {}; cs.forEach((c) => (M[c.id] = Math.max(1, edgeInfo(c).wid * kF / Math.PI)));
    const Gq = phys.conductanceQuantum();
    const Cm = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (i === j) continue; const ii = ids[i], jj = ids[j];
      Cm[i][i] += Gq * M[ii] * ((Tb[ii] && Tb[ii][jj]) || 0);   // leaving i toward j
      Cm[i][j] -= Gq * M[jj] * ((Tb[jj] && Tb[jj][ii]) || 0);   // arriving at i from j
    }
    const src = cs.find((c) => c.role === "source"), drn = cs.find((c) => c.role === "drain");
    const ps = cs.filter((c) => c.role === "probe").map((c) => ({ id: c.id, x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }));
    if (!src || !drn || ps.length < 2) return NaN;
    let pa, pb;
    if (kind === "hall") { ps.sort((a, b) => b.y - a.y); pa = ps[0]; pb = ps[ps.length - 1]; }
    else { ps.sort((a, b) => a.x - b.x); pa = ps[ps.length - 1]; pb = ps[0]; }
    const fixed = { [src.id]: 1, [drn.id]: 0 };
    const unk = ids.filter((id) => !(id in fixed));
    const A = [], bb = [];
    unk.forEach((u) => {
      const ui = idx[u], rowA = unk.map((v) => Cm[ui][idx[v]]);
      let rhs = 0; for (const f in fixed) rhs -= Cm[ui][idx[f]] * fixed[f];
      A.push(rowA); bb.push(rhs);
    });
    const Vu = solveLinear(A, bb), V = Object.assign({}, fixed);
    unk.forEach((u, a) => (V[u] = Vu[a]));
    let Is = 0; const si = idx[src.id]; for (let j = 0; j < N; j++) Is += Cm[si][j] * V[ids[j]];
    return Is !== 0 ? (V[pa.id] - V[pb.id]) / Is : NaN; // Ω
  }

  /* ===== FEM run ========================================================= */
  function runFEM() {
    const g = solverGrid();
    const { nArr, muArr } = fields(g.nx, g.ny);
    const K = fem.magnetotransportTensor(nArr, muArr, state.B, PHYS.e);
    const { mask, val, probes } = dirichletMasks(g.nx, g.ny);
    const solver = new FEMSolver(g);
    const t0 = performance.now();
    const res = solver.solve(K, null, mask, val, { tol: state.femTol, maxIter: state.femIter });
    const flux = solver.flux(res.u, K);
    // current through a vertical cut at mid: I = ∫ jx dy
    const col = Math.floor(g.nx / 2);
    let I = 0; for (let j = 0; j < g.ny; j++) I += flux.qx[j * g.nx + col] * g.dy;
    const R = I !== 0 ? (state.Vsource - state.Vdrain) / I : Infinity;
    // probe potentials (mean over probe cells)
    const probeV = probes.map((p) => ({ id: p.id, V: p.cells.reduce((a, k) => a + res.u[k], 0) / p.cells.length }));
    lastFEM = {
      grid: g, u: res.u, qx: flux.qx, qy: flux.qy, I, R, probeV,
      iters: res.iters, residual: res.residual, converged: res.converged,
      ms: performance.now() - t0,
    };
    return lastFEM;
  }

  /* ===== Trajectory run ================================================== */
  function runTraj(ballistic) {
    const { W, H, n, mu, mfp } = siParams();
    const g = solverGrid();
    const { nArr, muArr } = fields(g.nx, g.ny);
    // samplers from arrays (solver-grid order, row0=bottom)
    const sampleArr = (arr) => (x, y) => {
      const i = Math.min(g.nx - 1, Math.max(0, Math.floor((x / W) * g.nx)));
      const j = Math.min(g.ny - 1, Math.max(0, Math.floor((y / H) * g.ny)));
      return arr[j * g.nx + i];
    };
    const nSampler = (densityField) ? sampleArr(nArr) : null;
    let mfpSampler = null;
    if (mobilityField && (state.mobScope === "mfp" || state.mobScope === "both")) {
      mfpSampler = (x, y) => phys.mfpFromMobility(sampleArr(muArr)(x, y), Math.abs(sampleArr(nArr)(x, y)) || n);
    }
    const region = regionConfig();
    const cfg = {
      W, H, vF: PHYS.vF, n0: n, mfp: ballistic ? 1e9 : mfp,
      B: state.B,
      contactAt: region.contactAt, sources: region.sources, terminals: region.terminals,
      scattering: ballistic ? "none" : state.scattering,
      edge: state.edge, specularFrac: 0.5,
      nTraj: state.nTraj, seed: state.seed,
      ds: state.trajDs || Math.min(W, H) / 400,
      maxSteps: state.maxSteps, maxPath: U.umToM(state.maxPath_um),
      nSampler, mfpSampler,
      gx: 140, gy: Math.max(20, Math.round(140 * H / W)),
    };
    const solver = new TrajectorySolver(cfg);
    const t0 = performance.now();
    const res = solver.run({ keepPaths: 80 });
    res.ms = performance.now() - t0;
    res.ballistic = ballistic;
    lastTraj = res;
    return res;
  }

  /* ===== Validity assistant ============================================= */
  function validity() {
    const { W, H, n, mfp } = siParams();
    const rc = phys.cyclotronRadius(n, state.B);
    const L = W; // source-drain direction
    const ratios = {
      "ℓ/W": mfp / W, "ℓ/L": mfp / L,
      "ℓ/r_c": isFinite(rc) ? mfp / rc : 0,
      "r_c/W": isFinite(rc) ? rc / W : Infinity,
    };
    const notes = [];
    if (mfp / L < 0.2) notes.push(["ok", "ℓ ≪ L: diffusive FEM is likely appropriate."]);
    else if (mfp / L < 3) notes.push(["warn", "ℓ ~ L: quasi-ballistic simulation is important; FEM and ballistic limits both approximate."]);
    else notes.push(["warn", "ℓ ≫ L: ballistic transmission dominates; the diffusive FEM is out of its regime."]);
    if (isFinite(rc) && rc / W > 0.3 && rc / W < 3) notes.push(["warn", "r_c ~ W: magnetic focusing and geometric effects may be visible."]);
    if (densityField) notes.push(["info", "A density map is loaded: if n changes sign, p–n interface effects may matter (treated semiclassically)."]);
    return { ratios, rc, notes };
  }

  /* ===== Rendering ======================================================= */
  function canvasCtx() {
    const cv = document.getElementById("main-canvas");
    const wrap = cv.parentElement;
    const W = wrap.clientWidth - 4;
    const aspect = state.H_um / state.W_um;
    cv.width = W; cv.height = Math.max(160, Math.round(W * aspect));
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    return { cv, ctx };
  }

  function drawHeat(ctx, cv, vals, nx, ny, stops, vmin, vmax, diverging) {
    const off = document.createElement("canvas"); off.width = nx; off.height = ny;
    const octx = off.getContext("2d"); const img = octx.createImageData(nx, ny);
    const span = (vmax - vmin) || 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      // flip y: row0 of canvas = top = high y
      const v = vals[(ny - 1 - j) * nx + i];
      let t = (v - vmin) / span;
      const rgb = lut(stops, diverging ? t : t);
      const p = (j * nx + i) * 4;
      img.data[p] = rgb[0]; img.data[p+1] = rgb[1]; img.data[p+2] = rgb[2]; img.data[p+3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
  }

  function drawContacts(ctx, cv) {
    ctx.font = "11px system-ui"; ctx.lineWidth = 2;
    const cw = cv.width, ch = cv.height;
    for (const c of state.contacts) {
      const col = c.color || ROLE_COLOR[c.role] || "#98c379";
      // fractional rect (y up) -> canvas pixels (y down)
      const px = c.x0 * cw, py = (1 - c.y1) * ch, pw = (c.x1 - c.x0) * cw, ph = (c.y1 - c.y0) * ch;
      ctx.fillStyle = col + "cc"; ctx.strokeStyle = col;
      ctx.fillRect(px, py, Math.max(2, pw), Math.max(2, ph));
      ctx.strokeRect(px, py, Math.max(2, pw), Math.max(2, ph));
      ctx.fillStyle = "#0d1117"; ctx.fillText(c.id, px + 2, py + 11);
    }
  }

  function render() {
    const { cv, ctx } = canvasCtx();
    const g = solverGrid();
    const info = document.getElementById("view-info");
    info.textContent = "";

    if (activeTab === "device") {
      // show carrier density map (uniform or from map)
      const { nArr } = fields(g.nx, g.ny);
      let mn = Infinity, mx = -Infinity;
      for (const v of nArr) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      drawHeat(ctx, cv, nArr, g.nx, g.ny, VIRIDIS, mn, mx);
      drawContacts(ctx, cv);
      info.textContent = `Carrier density n ∈ [${U.m2ToCm2(mn).toExponential(2)}, ${U.m2ToCm2(mx).toExponential(2)}] cm⁻²`;
      colorbar(U.m2ToCm2(mn), U.m2ToCm2(mx), "cm⁻²", VIRIDIS);
    } else if (activeTab === "potential") {
      if (!lastFEM) { placeholder(ctx, cv, "Run FEM to see the potential."); return; }
      let mn = Infinity, mx = -Infinity; for (const v of lastFEM.u) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      drawHeat(ctx, cv, lastFEM.u, g.nx, g.ny, RDBU, mn, mx, true);
      drawContacts(ctx, cv);
      info.textContent = `Potential V ∈ [${mn.toExponential(2)}, ${mx.toExponential(2)}] V · R ≈ ${fmtR(lastFEM.R)} · ${lastFEM.converged ? "converged" : "NOT converged"} (${lastFEM.iters} it)`;
      colorbar(mn, mx, "V", RDBU);
    } else if (activeTab === "current") {
      if (!lastFEM) { placeholder(ctx, cv, "Run FEM to see the current density."); return; }
      const mag = new Float64Array(lastFEM.qx.length);
      let mx = 0; for (let k = 0; k < mag.length; k++) { mag[k] = Math.hypot(lastFEM.qx[k], lastFEM.qy[k]); mx = Math.max(mx, mag[k]); }
      drawHeat(ctx, cv, mag, g.nx, g.ny, VIRIDIS, 0, mx);
      drawCurrentArrows(ctx, cv, g, mx);
      drawContacts(ctx, cv);
      info.textContent = `Current density |j| (arrows show direction) · total I ≈ ${lastFEM.I.toExponential(3)} A/m`;
      colorbar(0, mx, "A/m²", VIRIDIS);
    } else if (activeTab === "trajectories") {
      if (!lastTraj) { placeholder(ctx, cv, "Run trajectories to see them here."); return; }
      // density heatmap background
      let mx = 0; for (const v of lastTraj.density) mx = Math.max(mx, v);
      drawHeat(ctx, cv, flipForTraj(lastTraj.density, lastTraj.gx, lastTraj.gy), lastTraj.gx, lastTraj.gy, VIRIDIS, 0, mx || 1);
      drawTrajectories(ctx, cv);
      drawContacts(ctx, cv);
      const s = lastTraj.statuses;
      info.textContent = `${lastTraj.nLaunched} trajectories · ` + Object.keys(s).map((k) => `${k}:${s[k]}`).join("  ");
    } else if (activeTab === "transmission") {
      renderTransmission();
    } else if (activeTab === "validity") {
      renderValidity();
    }
  }

  function flipForTraj(d, gx, gy) {
    // trajectory density row0 = bottom (y small). drawHeat flips, expecting row0=bottom too. keep as-is.
    return d;
  }

  function drawCurrentArrows(ctx, cv, g, mx) {
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
    const step = Math.max(1, Math.floor(g.nx / 25));
    const sx = cv.width / g.nx, sy = cv.height / g.ny;
    for (let j = 0; j < g.ny; j += step) for (let i = 0; i < g.nx; i += step) {
      const k = j * g.nx + i; const m = Math.hypot(lastFEM.qx[k], lastFEM.qy[k]) || 1;
      const len = 0.8 * step * sx * Math.min(1, m / (mx || 1));
      const ux = lastFEM.qx[k] / m, uy = lastFEM.qy[k] / m;
      const cx = (i + 0.5) * sx, cy = cv.height - (j + 0.5) * sy;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ux * len, cy - uy * len); ctx.stroke();
    }
  }

  function drawTrajectories(ctx, cv) {
    const { W, H } = siParams();
    const colmap = { transmitted: "#98c379", reflected: "#e06c75", absorbed: "#e5c07b", lost: "#888", max_steps: "#666" };
    ctx.lineWidth = 1;
    for (const tr of lastTraj.paths) {
      ctx.strokeStyle = colmap[tr.status] || "#aaa"; ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let p = 0; p < tr.points.length; p++) {
        const x = tr.points[p][0] / W * cv.width;
        const y = cv.height - tr.points[p][1] / H * cv.height;
        p ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function placeholder(ctx, cv, msg) {
    ctx.fillStyle = "#8b98a5"; ctx.font = "14px system-ui";
    ctx.fillText(msg, 16, cv.height / 2);
    colorbar(null);
  }

  function colorbar(vmin, vmax, unit, stops) {
    const el = document.getElementById("colorbar");
    if (vmin == null) { el.style.display = "none"; return; }
    el.style.display = "flex";
    const grad = (stops || VIRIDIS).map((c, i) => `rgb(${c[0]|0},${c[1]|0},${c[2]|0}) ${(i/(stops.length-1))*100}%`).join(",");
    el.innerHTML = `<span>${fmtNum(vmin)}</span><span class="cb-grad" style="background:linear-gradient(to right,${grad})"></span><span>${fmtNum(vmax)} ${unit}</span>`;
  }

  function renderTransmission() {
    const cv = document.getElementById("main-canvas"); cv.getContext("2d").clearRect(0,0,cv.width,cv.height);
    const host = document.getElementById("table-host"); host.innerHTML = "";
    if (!lastTraj) { host.innerHTML = '<p class="hint">Run trajectories to compute the transmission matrix.</p>'; return; }
    let html = '<table class="tmatrix"><thead><tr><th>from \\ to</th>';
    const terms = state.contacts;
    for (const t of terms) html += `<th>${t.id}</th>`;
    html += "<th>reflected</th><th>lost</th></tr></thead><tbody>";
    for (const row of lastTraj.transmission) {
      html += `<tr><th>${row.source}</th>`;
      const Ni = lastTraj.launched[row.source] || 1;
      for (const t of terms) {
        if (t.id === row.source) { html += '<td class="diag">—</td>'; continue; }
        const T = row.T[t.id] || 0;
        html += `<td title="G ≈ ${row.G[t.id].toExponential(2)} S">${T.toFixed(3)}</td>`;
      }
      const refl = ((lastTraj.reached[row.source] && lastTraj.reached[row.source][row.source]) || 0) / Ni;
      const lost = (lastTraj.statuses.lost || 0) / lastTraj.nLaunched;
      html += `<td>${refl.toFixed(3)}</td><td>${lost.toFixed(3)}</td></tr>`;
    }
    html += "</tbody></table><p class='hint'>Semiclassical Landauer–Büttiker estimate: T_ij = N(i→j)/N_i, G_ij ≈ (4e²/h)·M_i·T_ij. Hover a cell for G.</p>";
    host.innerHTML = html;
    document.getElementById("view-info").textContent = "Transmission matrix";
    colorbar(null);
  }

  function renderValidity() {
    const cv = document.getElementById("main-canvas"); cv.getContext("2d").clearRect(0,0,cv.width,cv.height);
    const host = document.getElementById("table-host");
    const v = validity();
    let html = '<table class="tmatrix"><tbody>';
    for (const k in v.ratios) html += `<tr><th>${k}</th><td>${fmtNum(v.ratios[k])}</td></tr>`;
    html += `<tr><th>r_c</th><td>${isFinite(v.rc) ? (U.mToUm(v.rc)).toFixed(3)+' µm' : '∞ (B=0)'}</td></tr></tbody></table>`;
    html += '<div class="notes">';
    for (const [lvl, txt] of v.notes) html += `<div class="note ${lvl}">${txt}</div>`;
    html += "</div>";
    host.innerHTML = html;
    document.getElementById("view-info").textContent = "Validity assistant — dimensionless ratios and guidance";
    colorbar(null);
  }

  /* ===== formatting ====================================================== */
  function fmtNum(v) { if (v === Infinity) return "∞"; const a = Math.abs(v); return (a !== 0 && (a >= 1e4 || a < 1e-2)) ? v.toExponential(2) : v.toFixed(3); }
  function fmtR(R) { if (!isFinite(R)) return "∞"; const a = Math.abs(R); return a >= 1e3 ? (R/1e3).toFixed(2)+" kΩ·m" : R.toFixed(1)+" Ω·m"; }

  /* ===== Run orchestration =============================================== */
  function run(mode) {
    setStatus("Running…");
    setTimeout(() => {
      try {
        if (mode === "fem") { runFEM(); activeTab = "potential"; }
        else if (mode === "ballistic") { runTraj(true); activeTab = "trajectories"; }
        else if (mode === "quasi") { runTraj(false); activeTab = "trajectories"; }
        else if (mode === "hybrid") { runFEM(); runTraj(state.scattering === "none" ? true : false); activeTab = "current"; }
        setTab(activeTab); setStatus("Done.");
        logRun(mode);
      } catch (e) { setStatus("Error: " + e.message); console.error(e); }
    }, 10);
  }

  function logRun(mode) {
    const v = validity();
    let msg = `[${new Date().toLocaleTimeString()}] mode=${mode}`;
    if (lastFEM) msg += ` · FEM: R≈${fmtR(lastFEM.R)}, ${lastFEM.converged ? "conv" : "NO-conv"} (${lastFEM.iters} it, ${lastFEM.ms.toFixed(0)} ms)`;
    if (lastTraj) { const s = lastTraj.statuses; msg += ` · traj: ` + Object.keys(s).map((k)=>`${k}=${s[k]}`).join(","); }
    const warn = v.notes.filter((n) => n[0] === "warn").map((n) => n[1]);
    log(msg);
    if ((mode === "hybrid") && warn.length) warn.forEach((w) => log("⚠ " + w));
  }

  function setStatus(s) { document.getElementById("status").textContent = s; }
  function log(s) { const el = document.getElementById("log"); el.textContent = s + "\n" + el.textContent; }

  /* ===== Export ========================================================== */
  function exportJSON() {
    const { W, H, n, mu, mfp } = siParams();
    const out = {
      tool: "Graphene Hybrid FEM / Ballistic Transport Explorer", version: "0.1",
      inputs: state,
      derived_SI: { W, H, n, mu, mfp, kF: phys.fermiWavevector(n), rc: phys.cyclotronRadius(n, state.B) },
      validity: validity().ratios,
      fem: lastFEM ? { I: lastFEM.I, R: lastFEM.R, converged: lastFEM.converged, iters: lastFEM.iters, probeV: lastFEM.probeV } : null,
      trajectories: lastTraj ? { nLaunched: lastTraj.nLaunched, statuses: lastTraj.statuses, transmission: lastTraj.transmission } : null,
    };
    download(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), "transim_results.json");
  }
  function exportPNG() {
    const cv = document.getElementById("main-canvas");
    cv.toBlob((b) => download(b, "transim_view.png"));
  }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ===== UI wiring ======================================================= */
  const $ = (id) => document.getElementById(id);
  let drawMode = false, drawStart = null, drawPreviewRect = null;

  // Interactive contact placement: click-drag on the device canvas.
  function initContactDrawing() {
    const cv = $("main-canvas");
    $("draw-contact").addEventListener("click", () => {
      drawMode = !drawMode;
      $("draw-contact").classList.toggle("active", drawMode);
      cv.style.cursor = drawMode ? "crosshair" : "default";
      setStatus(drawMode ? "Draw mode: drag on the map to place a contact." : "Done.");
    });
    $("clear-contacts").addEventListener("click", () => { state.contacts = []; renderContactsList(); render(); log("Cleared all contacts."); });
    const toFrac = (e) => { const r = cv.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)]; };
    cv.addEventListener("mousedown", (e) => { if (!drawMode) return; drawStart = toFrac(e); });
    cv.addEventListener("mousemove", (e) => { if (!drawMode || !drawStart) return; drawPreviewRect = rectFrom(drawStart, toFrac(e)); render(); previewRect(drawPreviewRect); });
    window.addEventListener("mouseup", (e) => {
      if (!drawMode || !drawStart) return;
      const rc = rectFrom(drawStart, toFrac(e)); drawStart = null; drawPreviewRect = null;
      if (rc.x1 - rc.x0 > 0.01 && rc.y1 - rc.y0 > 0.01) addDrawnContact(rc);
      else render();
    });
  }
  function clamp01(v) { return Math.min(1, Math.max(0, v)); }
  function rectFrom(a, b) { return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) }; }
  function previewRect(r) {
    const cv = $("main-canvas"), ctx = cv.getContext("2d");
    ctx.setLineDash([5, 4]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x0 * cv.width, (1 - r.y1) * cv.height, (r.x1 - r.x0) * cv.width, (r.y1 - r.y0) * cv.height);
    ctx.setLineDash([]);
  }
  function addDrawnContact(rc) {
    const role = $("drawRole").value;
    const n = state.contacts.filter((c) => c.role === role).length + 1;
    state.contacts.push({ id: `${role}_${n}`, role, color: ROLE_COLOR[role], x0: rc.x0, y0: rc.y0, x1: rc.x1, y1: rc.y1 });
    renderContactsList(); render(); log(`Added ${role} contact.`);
  }
  function renderContactsList() {
    const host = $("contacts-list"); if (!host) return;
    host.innerHTML = "";
    state.contacts.forEach((c, idx) => {
      const row = document.createElement("div"); row.className = "contact-row";
      row.innerHTML = `<span class="dot" style="background:${c.color || ROLE_COLOR[c.role]}"></span><span class="cid">${c.id}</span>`;
      const sel = document.createElement("select");
      ["source", "drain", "probe", "absorber"].forEach((r) => { const o = document.createElement("option"); o.value = r; o.textContent = r; if (r === c.role) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", () => { c.role = sel.value; c.color = ROLE_COLOR[sel.value]; render(); });
      const del = document.createElement("button"); del.textContent = "✕"; del.className = "del";
      del.addEventListener("click", () => { state.contacts.splice(idx, 1); renderContactsList(); render(); });
      row.append(sel, del); host.appendChild(row);
    });
  }

  function setControlsFromState() {
    $("W_um").value = state.W_um; $("H_um").value = state.H_um; $("res").value = state.res;
    $("n_cm2").value = state.n_cm2; $("mu_cm").value = state.mu_cm;
    $("mfpFromMobility").checked = state.mfpFromMobility; $("mfp_um").value = state.mfp_um;
    $("mfp_um").disabled = state.mfpFromMobility;
    $("B").value = state.B; $("B_val").textContent = state.B.toFixed(2) + " T";
    $("Vsource").value = state.Vsource; $("Vdrain").value = state.Vdrain;
    $("scattering").value = state.scattering; $("edge").value = state.edge;
    $("nTraj").value = state.nTraj; $("seed").value = state.seed; $("maxSteps").value = state.maxSteps; $("maxPath_um").value = state.maxPath_um;
    $("mode").value = state.mode; $("femIter").value = state.femIter; $("femTol").value = state.femTol;
    // sweep + gate + workers
    $("sweepType").value = state.sweepType; $("sweepFem").checked = state.sweepFem; $("sweepBal").checked = state.sweepBal; $("sweepSnap").checked = state.sweepSnap; $("sweepBalMode").value = state.sweepBalMode;
    $("vgFrom").value = state.vgFrom; $("vgTo").value = state.vgTo; $("vgN").value = state.vgN;
    $("bFrom").value = state.bFrom; $("bTo").value = state.bTo; $("bN").value = state.bN;
    $("lFrom").value = state.lFrom; $("lTo").value = state.lTo; $("lN").value = state.lN;
    $("sweepQuantity").value = state.sweepQuantity; $("sweepMeasure").value = state.sweepMeasure;
    $("tox").value = state.tox_nm; $("epsr").value = state.epsr; $("vdirac").value = state.vdirac;
    $("useWorkers").checked = state.useWorkers; $("workerCount").value = state.workerCount;
    syncSweepUI();
    updateDerived();
  }

  function readControls() {
    state.W_um = +$("W_um").value; state.H_um = +$("H_um").value; state.res = +$("res").value;
    state.n_cm2 = +$("n_cm2").value; state.mu_cm = +$("mu_cm").value;
    state.mfpFromMobility = $("mfpFromMobility").checked; state.mfp_um = +$("mfp_um").value;
    $("mfp_um").disabled = state.mfpFromMobility;
    state.B = +$("B").value; $("B_val").textContent = state.B.toFixed(2) + " T";
    state.Vsource = +$("Vsource").value; state.Vdrain = +$("Vdrain").value;
    state.scattering = $("scattering").value; state.edge = $("edge").value;
    state.nTraj = +$("nTraj").value; state.seed = +$("seed").value; state.maxSteps = +$("maxSteps").value;
    state.maxPath_um = Math.max(1, +$("maxPath_um").value);
    state.mode = $("mode").value; state.femIter = +$("femIter").value; state.femTol = +$("femTol").value;
    if (state.nTraj > 20000) log("⚠ " + state.nTraj + " trajectories may be slow in the browser.");
    updateDerived();
  }

  function updateDerived() {
    const { n, mfp } = siParams();
    const rc = phys.cyclotronRadius(n, state.B);
    $("derived").innerHTML =
      `k_F = ${phys.fermiWavevector(n).toExponential(2)} m⁻¹ · ` +
      `ℓ = ${(U.mToNm(mfp)).toFixed(0)} nm · ` +
      `r_c = ${isFinite(rc) ? U.mToUm(rc).toFixed(2) + " µm" : "∞"}`;
  }

  /* Floating help popup: opens next to the "?" on ~1s hover (or click/focus). */
  let helpPop = null, helpShowTimer = null, helpHideTimer = null;

  function ensureHelpPop() {
    if (helpPop) return helpPop;
    helpPop = document.createElement("div");
    helpPop.className = "help-pop";
    helpPop.innerHTML =
      '<div class="help-pop-title"></div>' +
      '<h4>What is this?</h4><p class="hp-what"></p>' +
      '<h4>Physics</h4><p class="hp-physics"></p>' +
      '<h4>How to use it</h4><p class="hp-how"></p>';
    document.body.appendChild(helpPop);
    helpPop.addEventListener("mouseenter", () => clearTimeout(helpHideTimer));
    helpPop.addEventListener("mouseleave", () => { helpHideTimer = setTimeout(hideHelp, 200); });
    return helpPop;
  }

  function positionHelpPop(anchor) {
    const r = anchor.getBoundingClientRect();
    const p = helpPop, m = 8;
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let x = r.right + m;
    if (x + pw > window.innerWidth - m) x = r.left - pw - m;
    if (x < m) x = m;
    let y = r.top;
    if (y + ph > window.innerHeight - m) y = window.innerHeight - m - ph;
    if (y < m) y = m;
    p.style.left = x + "px";
    p.style.top = y + "px";
  }

  function showHelp(key, anchor) {
    const h = HELP_TEXT[key]; if (!h) return;
    const p = ensureHelpPop();
    p.querySelector(".help-pop-title").textContent =
      key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    p.querySelector(".hp-what").textContent = h.what;
    p.querySelector(".hp-physics").textContent = h.physics;
    p.querySelector(".hp-how").textContent = h.how;
    if (anchor) positionHelpPop(anchor);
    p.classList.add("show");
  }

  function hideHelp() { if (helpPop) helpPop.classList.remove("show"); }

  function wireHelpDots() {
    ensureHelpPop();
    document.querySelectorAll("[data-help]").forEach((el) => {
      el.addEventListener("mouseenter", () => {
        clearTimeout(helpHideTimer);
        helpShowTimer = setTimeout(() => showHelp(el.dataset.help, el), 1000);
      });
      el.addEventListener("mouseleave", () => {
        clearTimeout(helpShowTimer);
        helpHideTimer = setTimeout(hideHelp, 200);
      });
      // The "?" badges (not action buttons) also open on click/focus for touch + a11y.
      if (el.classList.contains("help")) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", "Help: what it is, the physics, and how to use it");
        el.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          clearTimeout(helpShowTimer); showHelp(el.dataset.help, el);
        });
        el.addEventListener("focus", () => showHelp(el.dataset.help, el));
        el.addEventListener("blur", () => { helpHideTimer = setTimeout(hideHelp, 150); });
        el.addEventListener("keydown", (e) => { if (e.key === "Escape") hideHelp(); });
      }
    });
    // Hide the floating popup on scroll (any panel) or resize — but not while
    // the user is scrolling inside the popup itself.
    window.addEventListener("scroll", (e) => {
      if (helpPop && helpPop.contains(e.target)) return;
      hideHelp();
    }, true);
    window.addEventListener("resize", hideHelp);
    // Legacy side panel is no longer opened; keep its close button harmless.
    const closeBtn = $("help-close");
    if (closeBtn) closeBtn.addEventListener("click", () => {
      const hp = $("help-panel"); if (hp) hp.classList.remove("open");
    });
  }

  function handleUpload(fileInput, kind) {
    const file = fileInput.files[0]; if (!file) return;
    maps.fileToImageData(file, 256, (imgData) => {
      if (!imgData) { log("Could not read image."); return; }
      if (kind === "contact") {
        const res = maps.contactsFromImage(imgData, {});
        if (res.regions.length) {
          // image rows are top-down; device y is up -> flip y for the rect.
          state.contacts = res.regions.map((r, i) => ({
            id: r.id, role: i === 0 ? "source" : i === 1 ? "drain" : "probe",
            color: r.color || ROLE_COLOR[i === 0 ? "source" : i === 1 ? "drain" : "probe"],
            x0: r.x0, y0: 1 - r.y1, x1: r.x1, y1: 1 - r.y0,
          }));
          log(`Contact map: found ${res.regions.length} contact region(s) (${res.mode}).`);
          renderContactsList(); render();
        } else log("Contact map: no contact regions found.");
        return;
      }
      const opts = {
        channel: $("mapChannel").value, invert: $("mapInvert").checked,
        smooth: +$("mapSmooth").value,
        vmin: kind === "density" ? +$("dmin").value : +$("mmin").value,
        vmax: kind === "density" ? +$("dmax").value : +$("mmax").value,
      };
      const field = maps.imageToField(imgData, opts);
      if (kind === "density") { window.TranSimApp.setDensityField(field); log("Density map loaded."); }
      else { window.TranSimApp.setMobilityField(field); state.mobScope = $("mobScope").value; log("Mobility map loaded."); }
      activeTab = "device"; window.TranSimApp.setTab("device");
    });
  }

  function initUI() {
    setControlsFromState();
    // control listeners
    ["W_um","H_um","res","n_cm2","mu_cm","mfpFromMobility","mfp_um","B","Vsource","Vdrain",
     "scattering","edge","nTraj","seed","maxSteps","mode","femIter","femTol"].forEach((id) => {
      const el = $(id); if (!el) return;
      el.addEventListener("input", () => { readControls(); if (["W_um","H_um","res"].includes(id)) render(); });
    });
    $("contactPreset").addEventListener("change", (e) => {
      state.contacts = presetRects(e.target.value); renderContactsList(); render();
    });
    initContactDrawing();
    // run buttons
    $("run-fem").addEventListener("click", () => run("fem"));
    $("run-traj").addEventListener("click", () => run(state.scattering === "none" ? "ballistic" : "quasi"));
    $("run-hybrid").addEventListener("click", () => run("hybrid"));
    $("reset").addEventListener("click", () => { state = defaults(); window.TranSimApp.state = state; window.TranSimApp.setDensityField(null); window.TranSimApp.setMobilityField(null); setControlsFromState(); $("contactPreset").value = "hall_bar"; renderContactsList(); render(); log("Reset to default Hall bar."); });
    $("export-json").addEventListener("click", exportJSON);
    $("export-png").addEventListener("click", exportPNG);
    $("toggle-advanced").addEventListener("click", () => document.body.classList.toggle("show-advanced"));
    // tabs
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => window.TranSimApp.setTab(t.dataset.tab)));
    // uploads
    $("densityFile").addEventListener("change", (e) => handleUpload(e.target, "density"));
    $("mobilityFile").addEventListener("change", (e) => handleUpload(e.target, "mobility"));
    $("contactFile").addEventListener("change", (e) => handleUpload(e.target, "contact"));
    // sweep controls
    ["sweepType","sweepFem","sweepBal","sweepSnap","sweepBalMode","sweepQuantity","sweepMeasure","vgFrom","vgTo","vgN","bFrom","bTo","bN",
     "lFrom","lTo","lN","tox","epsr","vdirac","useWorkers","workerCount"].forEach((id) => {
      const el = $(id); if (!el) return;
      el.addEventListener("input", () => { readSweepControls(); });
    });
    $("run-sweep").addEventListener("click", runSweep);
    $("export-sweep").addEventListener("click", exportSweepCSV);
    syncSweepUI();
    wireHelpDots();
    renderContactsList();
    window.addEventListener("resize", () => { render(); drawSweep(); });
    window.TranSimApp.setTab("device");
    drawSweep();
    log("Ready. Default: graphene Hall bar (4×2 µm).");
  }

  /* ===== Parameter sweeps =============================================== */
  function readSweepControls() {
    state.sweepType = $("sweepType").value;
    state.sweepFem = $("sweepFem").checked; state.sweepBal = $("sweepBal").checked; state.sweepSnap = $("sweepSnap").checked; state.sweepBalMode = $("sweepBalMode").value;
    state.vgFrom = +$("vgFrom").value; state.vgTo = +$("vgTo").value; state.vgN = Math.max(2, Math.min(201, +$("vgN").value | 0));
    state.bFrom = +$("bFrom").value; state.bTo = +$("bTo").value; state.bN = Math.max(2, Math.min(201, +$("bN").value | 0));
    state.lFrom = Math.max(0.1, +$("lFrom").value); state.lTo = Math.max(state.lFrom + 1, +$("lTo").value); state.lN = Math.max(2, Math.min(201, +$("lN").value | 0));
    state.sweepQuantity = $("sweepQuantity").value; state.sweepMeasure = $("sweepMeasure").value;
    state.tox_nm = +$("tox").value; state.epsr = +$("epsr").value; state.vdirac = +$("vdirac").value;
    state.useWorkers = $("useWorkers").checked; state.workerCount = Math.max(1, Math.min(32, +$("workerCount").value | 0));
    syncSweepUI();
  }
  function syncSweepUI() {
    const t = $("sweepType").value;
    $("vg-range").style.display = (t === "vg" || t === "vgb") ? "" : "none";
    $("b-range").style.display = (t === "b" || t === "vgb") ? "" : "none";
    $("l-range").style.display = (t === "mfp") ? "" : "none";
    // gate-model derived readout
    const eps0 = 8.8541878128e-12;
    const Cox = state.epsr * eps0 / (state.tox_nm * 1e-9);
    const perV = (Cox / PHYS.e) / 1e4; // cm⁻²/V
    const d = $("gate-derived");
    if (d) d.innerHTML = `C_ox = ${Cox.toExponential(2)} F/m² · dn/dV_g = ${perV.toExponential(2)} cm⁻²/V`;
  }
  function linspace(a, b, n) { if (n < 2) return [a]; const o = []; for (let i = 0; i < n; i++) o.push(a + (b - a) * i / (n - 1)); return o; }
  function logspace(a, b, n) { const la = Math.log(a), lb = Math.log(b); return linspace(la, lb, n).map(Math.exp); }
  // Quantity transform. Probe measurements are already resistances (Ω) — pass
  // through. Two-terminal: conductance G [S] or its inverse R = 1/G [Ω].
  function qOf(g) {
    if (lastSweep && lastSweep.measure && lastSweep.measure !== "2t") return g;
    return (lastSweep && lastSweep.quantity === "R") ? (g > 0 && isFinite(g) ? 1 / g : Infinity) : g;
  }
  function qLabel() {
    if (lastSweep) { if (lastSweep.measure === "hall") return "R_xy (Ω)"; if (lastSweep.measure === "rxx") return "R_xx (Ω)"; }
    return (lastSweep && lastSweep.quantity === "R") ? "R (Ω)" : "G (S)";
  }

  // Two-terminal conductances at the current state (uniform fields), per model.
  // FEM gives the diffusive (drift-diffusion / Drude) conductance G = I/ΔV [S].
  function femG() {
    const r = runFEM();
    return (isFinite(r.R) && r.R !== 0) ? 1 / r.R : 0; // S
  }
  // Four-probe resistance R = (V₁ − V₂)/I from a probe pair (FEM probe voltages).
  // kind "hall" -> transverse pair (max |Δy|): R_xy, odd in B, R_xy(B=0)=0.
  // kind "rxx"  -> in-line pair (max |Δx|): longitudinal R_xx.
  function femProbeR(kind) {
    const r = runFEM();
    if (!r.I) return NaN;
    const Vof = {}; r.probeV.forEach((p) => (Vof[p.id] = p.V));
    const ps = state.contacts.filter((c) => c.role === "probe" && Vof[c.id] != null)
      .map((c) => ({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, V: Vof[c.id] }));
    if (ps.length < 2) return NaN;
    let a, b;
    if (kind === "hall") { ps.sort((p, q) => q.y - p.y); a = ps[0]; b = ps[ps.length - 1]; }
    else { ps.sort((p, q) => p.x - q.x); a = ps[ps.length - 1]; b = ps[0]; }
    return (a.V - b.V) / r.I; // Ω
  }

  // Pure-ballistic Landauer (Sharvin) conductance from the trajectories:
  // G = (4e²/h) Σ M·T̄, capturing geometry, B-deflection and edge scattering [S].
  function ballisticSharvinG() {
    const r = runTraj(true);
    const drains = state.contacts.filter((c) => c.role === "drain").map((c) => c.id);
    const row = r.transmission && r.transmission[0];
    if (!row) return 0;
    return drains.reduce((a, id) => a + (row.G[id] || 0), 0); // S
  }
  // Semiclassical crossover: ballistic (Sharvin) resistance in SERIES with the
  // diffusive (Drude/FEM) resistance — G = 1/(1/G_ball + 1/G_Drude). Tends to the
  // Sharvin ceiling when ℓ≫L and to the FEM/Drude value when ℓ≪L. gDrude may be
  // passed in to avoid a redundant FEM solve.
  function landauerG(gDrude) {
    const gB = ballisticSharvinG();
    const gD = gDrude != null ? gDrude : femG();
    if (!(gB > 0)) return gD;
    if (!(gD > 0)) return gB;
    return 1 / (1 / gB + 1 / gD);
  }
  // Pure trajectory Monte-Carlo conductance — no Drude term. Uses the configured
  // scattering and mean free path (ballistic when scattering = none). Honest
  // semiclassical result; under-resolves the deep-diffusive limit unless the max
  // path / step caps are large (a random walk needs path ~ L²/ℓ to cross).
  function mcLandauerG() {
    const r = runTraj(false);
    const drains = state.contacts.filter((c) => c.role === "drain").map((c) => c.id);
    const row = r.transmission && r.transmission[0];
    if (!row) return 0;
    return drains.reduce((a, id) => a + (row.G[id] || 0), 0); // S
  }
  function trajectorySeriesG(gDrude) {
    return state.sweepBalMode === "mc" ? mcLandauerG() : landauerG(gDrude);
  }

  let sweepBusy = false, lastDrawT = 0, workerWarned = false;
  function showProgress() { const p = $("sweep-progress"); if (p) { p.classList.add("active"); p.value = 0; } }
  function setProgress(done, total) { const p = $("sweep-progress"); if (p) { p.max = total; p.value = done; } setStatus(`Sweep ${done}/${total}…`); }
  function hideProgress() { const p = $("sweep-progress"); if (p) p.classList.remove("active"); }
  function onProgress(done, total) {
    setProgress(done, total);
    const now = performance.now();
    if (done === total || now - lastDrawT > 120) { lastDrawT = now; drawSweep(); }
  }

  // Capture the current device field(s) so the sweep can be scrubbed afterwards.
  function captureSnapshot() {
    const s = { n_cm2: state.n_cm2, B: state.B };
    if (state.sweepFem && lastFEM) { s.u = Float32Array.from(lastFEM.u); s.qx = Float32Array.from(lastFEM.qx); s.qy = Float32Array.from(lastFEM.qy); s.R = lastFEM.R; }
    if (state.sweepBal && lastTraj) { s.density = Float32Array.from(lastTraj.density); s.gx = lastTraj.gx; s.gy = lastTraj.gy; }
    return s;
  }

  async function runSweep() {
    if (sweepBusy) return;
    readControls(); readSweepControls();
    const type = state.sweepType;
    const meas = state.sweepMeasure;                 // "2t" | "hall" | "rxx"
    const probeMode = meas !== "2t";                 // four-probe resistance (FEM-only)
    if (probeMode && state.contacts.filter((c) => c.role === "probe").length < 2) {
      setStatus("Hall R_xy / R_xx needs ≥ 2 voltage probes — use a Hall-bar or Hall-cross layout."); return;
    }
    if (!probeMode && !state.sweepFem && !state.sweepBal) { setStatus("Tick FEM and/or Landauer for the sweep."); return; }
    const vgs = linspace(state.vgFrom, state.vgTo, state.vgN);
    const bs = linspace(state.bFrom, state.bTo, state.bN);
    // ℓ swept via mobility at fixed n, B:  μ = ℓ·e/(ħ k_F),  k_F = √(πn)
    const nFix = Math.abs(siParams().n);
    const muCmFromL = (l_m) => (l_m * PHYS.e / (PHYS.hbar * Math.sqrt(Math.PI * (nFix || 1e15)))) * 1e4;
    const ls = logspace(U.umToM(state.lFrom / 1000), U.umToM(state.lTo / 1000), state.lN); // nm→m
    let pts, x, y, xlabel, ylabel, logx = false;
    if (type === "vg") { x = vgs; xlabel = "V_g (V)"; pts = vgs.map((vg) => ({ vg, b: state.B })); }
    else if (type === "b") { x = bs; xlabel = "B (T)"; pts = bs.map((b) => ({ vg: null, b })); }
    else if (type === "mfp") { x = ls.map((l) => l * 1e9); xlabel = "ℓ (nm)"; logx = true; pts = ls.map((l) => ({ vg: null, b: state.B, mu_cm: muCmFromL(l) })); }
    else { x = vgs; y = bs; xlabel = "V_g (V)"; ylabel = "B (T)"; pts = []; for (const b of bs) for (const vg of vgs) pts.push({ vg, b }); }

    const wantSnap = state.sweepSnap;
    // Snapshots are produced inline; workers can't cheaply ship full fields back.
    const useWorkers = state.useWorkers && window.Worker && !wantSnap;
    if (wantSnap && state.useWorkers) log("Field snapshots require inline computation — workers disabled for this run.");
    const g = solverGrid();
    if (wantSnap) {
      const per = ((state.sweepFem ? 3 : 0) + (state.sweepBal ? 1 : 0)) * g.nx * g.ny * 4;
      const estMB = pts.length * per / 1e6;
      if (estMB > 200) log(`⚠ Snapshots will use ~${estMB | 0} MB — reduce points or grid if the tab gets heavy.`);
    }

    // Pure-MC mode is only valid where the trajectories can resolve the regime.
    if (!probeMode && state.sweepBal && state.sweepBalMode === "mc") {
      if (state.scattering === "none") {
        log("⚠ Pure-MC with Scattering = None is the ballistic (Sharvin) limit: it is independent of mobility/ℓ, so it will NOT approach FEM at low mobility. Set Scattering = Isotropic (left panel), or use the Crossover mode.");
      } else if (state.scattering !== "isotropic") {
        log(`⚠ Pure-MC with Scattering = ${state.scattering}: small-angle/forward scattering barely relaxes momentum (transport mfp ≫ ℓ), so the curve stays quasi-ballistic and sits ABOVE the diffusive FEM. The FEM/Drude conductance uses the transport mfp — to compare like-for-like set Scattering = Isotropic (left panel), where transport mfp = ℓ.`);
      } else {
        const { W, H, mu } = siParams();
        // representative density: the largest |n| spanned by the sweep
        let nRep = Math.abs(siParams().n);
        if (type === "vg" || type === "vgb") nRep = Math.abs(U.cm2ToM2(densityCm2FromVg(Math.abs(state.vgFrom) > Math.abs(state.vgTo) ? state.vgFrom : state.vgTo)));
        const ell = phys.mfpFromMobility(mu, nRep || 1e15);
        const L = Math.max(W, H);
        const needUm = 3 * L * L / ell * 1e6;
        // Max path length is now the binding limit (the step cap auto-scales to
        // reach it), so just compare the path budget to what diffusion needs.
        if (state.maxPath_um < needUm) {
          log(`⚠ Pure-MC (scattering=${state.scattering}) in the diffusive regime: a random walk needs path ≈ L²/ℓ ≈ ${needUm.toFixed(0)} µm to cross (ℓ≈${(ell * 1e9).toFixed(1)} nm), but Max path length is ${state.maxPath_um} µm. Trajectories that don't arrive count as 0, so G is under-estimated. Raise Max path length ≳ ${needUm.toFixed(0)} µm (slower), or use the Crossover mode.`);
        }
      }
    }
    const save = { n: state.n_cm2, B: state.B, df: densityField, tr: state.nTraj, mu: state.mu_cm };
    densityField = null; // sweeps use a uniform n(Vg)
    // FEM series uses probe voltages; trajectory series uses multi-terminal Büttiker
    const fem = state.sweepFem ? new Array(pts.length).fill(NaN) : null;
    const bal = state.sweepBal ? new Array(pts.length).fill(NaN) : null;
    const snaps = wantSnap ? new Array(pts.length) : null;
    lastSweep = { type, x, y, xlabel, ylabel, fem, bal, vgs, bs, snaps, grid: g, balMode: state.sweepBalMode,
      quantity: state.sweepQuantity, measure: meas, logx, logy: type === "mfp" && !probeMode, cursor: 0, cursorI: 0, cursorJ: 0 };

    sweepBusy = true; showProgress(); $("run-sweep").disabled = true;
    const t0 = performance.now();
    const sweepInline = async () => {
      const batch = Math.max(1, Math.round(pts.length / 50));
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        state.n_cm2 = p.vg != null ? densityCm2FromVg(p.vg) : save.n;
        if (p.mu_cm != null) state.mu_cm = p.mu_cm;
        state.B = p.b;
        if (probeMode) {
          if (fem) fem[i] = femProbeR(meas);          // FEM four-probe R = (V₁−V₂)/I [Ω]
          if (bal) bal[i] = trajButtikerR(meas);       // ballistic multi-terminal Büttiker R [Ω]
        } else {
          // crossover needs the Drude (FEM) value; pure-MC mode does not
          const gD = (fem || state.sweepBalMode === "crossover") ? femG() : null;
          if (fem) fem[i] = gD;
          if (bal) bal[i] = trajectorySeriesG(gD);
        }
        if (snaps) snaps[i] = captureSnapshot();
        if ((i + 1) % batch === 0 || i === pts.length - 1) { onProgress(i + 1, pts.length); await new Promise((r) => setTimeout(r, 0)); }
      }
    };
    let usedWorkers = 0;
    try {
      if (useWorkers) {
        try { usedWorkers = await sweepWithWorkers(pts, fem, bal, (d) => onProgress(d, pts.length)); }
        catch (e) {
          if (!workerWarned) { workerWarned = true; log("⚠ Web Workers unavailable (" + e.message + "). Workers need the page served over http (e.g. python -m http.server), not opened as a file://… URL. Running inline."); }
          await sweepInline();
        }
      } else await sweepInline();
    } catch (err) {
      setStatus("Sweep error: " + err.message); console.error(err);
    } finally {
      state.n_cm2 = save.n; state.B = save.B; densityField = save.df; state.nTraj = save.tr; state.mu_cm = save.mu;
      sweepBusy = false; hideProgress(); $("run-sweep").disabled = false;
    }
    // For G-vs-ℓ, fit the two asymptotes: Sharvin plateau (ballistic, ℓ→∞) and the
    // Drude line G = slope·ℓ. The crossover model is 1/(1/G_Sharvin + 1/(slope·ℓ)).
    if (type === "mfp" && !probeMode) {
      const lsm = x.map((nm) => nm * 1e-9); // ℓ in metres
      lastSweep.fitSharvin = ballisticSharvinG();            // ℓ-independent ceiling [S]
      let slope = 0, ns = 0;                                  // Drude slope dG/dℓ [S/m]
      const drudeSrc = fem || bal;
      if (drudeSrc) for (let i = 0; i < lsm.length; i++) { if (isFinite(drudeSrc[i]) && lsm[i] > 0) { slope += drudeSrc[i] / lsm[i]; ns++; } }
      // FEM is exactly Drude (G∝ℓ); use the smallest-ℓ FEM point as the cleanest slope
      if (fem && isFinite(fem[0]) && lsm[0] > 0) slope = fem[0] / lsm[0];
      else if (ns) slope /= ns;
      lastSweep.fitDrudeSlope = slope;
    }
    drawSweep(); buildSliders();
    const dt = (performance.now() - t0) / 1000;
    const how = usedWorkers ? `${usedWorkers} workers`
      : state.useWorkers ? (state.sweepSnap ? "inline (snapshots force inline)" : "inline (workers unavailable — serve over http, not file://)")
      : "inline (workers off)";
    setStatus(`Sweep done: ${pts.length} points in ${dt.toFixed(1)} s` +
      (fem ? " · FEM" : "") + (bal ? " · ballistic" : "") + (snaps ? " · snapshots stored" : "") + ".");
    log(`Sweep ${type}: ${pts.length} points in ${dt.toFixed(2)} s (${(pts.length / dt).toFixed(0)} pts/s, ${how}).`);
  }

  // Parallel sweep: split points across a worker pool (round-robin). Each worker
  // computes its whole chunk independently and streams results back, so workers
  // stay busy instead of waiting on the main thread between points.
  function sweepWithWorkers(pts, femArr, balArr, onProg) {
    return new Promise((resolve, reject) => {
      // honor the user's requested thread count (capped only by #points). Points
      // are split round-robin so each worker runs its share independently; results
      // fill in by index as they arrive (the curve may populate out of order).
      const nW = Math.max(1, Math.min(state.workerCount, pts.length));
      const { W, H } = siParams();
      const g = solverGrid();
      const base = {
        W, H, nx: g.nx, ny: g.ny, mu_cm: state.mu_cm, vF: PHYS.vF,
        Vsource: state.Vsource, Vdrain: state.Vdrain,
        contacts: state.contacts, scattering: state.scattering, edge: state.edge, n_cm2: state.n_cm2,
        nTraj: state.nTraj, seed: state.seed, maxSteps: state.maxSteps, maxPath: U.umToM(state.maxPath_um),
        femTol: state.femTol, femIter: state.femIter, balMode: state.sweepBalMode, measure: state.sweepMeasure,
        wantFem: state.sweepFem, wantBal: state.sweepBal,
        tox_nm: state.tox_nm, epsr: state.epsr, vdirac: state.vdirac,
      };
      // round-robin chunks balance the varying per-point cost across workers
      const chunks = Array.from({ length: nW }, () => []);
      pts.forEach((pt, idx) => chunks[idx % nW].push({ idx, pt }));
      let done = 0, failed = false;
      const workers = [];
      const cleanup = () => workers.forEach((w) => w.terminate());
      try {
        for (let i = 0; i < nW; i++) {
          const w = new Worker("./sweep_worker.js");
          workers.push(w);
          w.onmessage = (e) => {
            const { idx, gFem, gBal } = e.data;
            if (femArr) femArr[idx] = gFem; if (balArr) balArr[idx] = gBal;
            done++; if (onProg) onProg(done);
            if (done === pts.length) { cleanup(); resolve(nW); }
          };
          w.onerror = (err) => { if (!failed) { failed = true; cleanup(); reject(new Error(err.message || "worker error")); } };
          w.postMessage({ base, chunk: chunks[i] });
        }
      } catch (err) { cleanup(); reject(err); }
    });
  }

  /* ===== Sweep sliders: fit models (ℓ sweep) and/or snapshot scrubbing ==== */
  function buildSliders() {
    const host = $("sweep-sliders"); if (!host) return;
    host.innerHTML = "";
    const s = lastSweep; if (!s) return;
    // G-vs-ℓ: sliders to adjust the fitted Sharvin plateau and Drude slope
    if (s.type === "mfp" && s.fitSharvin != null) {
      const sh0 = s.fitSharvin, sl0 = s.fitDrudeSlope, lmaxNm = s.x[s.x.length - 1];
      addSlider(host, "G_S", 0, sh0 * 3 || 1, sh0, (v) => `${v.toExponential(2)} S`, (v) => { s.fitSharvin = v; drawSweep(); }, (sh0 * 3 || 1) / 200);
      // express the Drude slope via G_Drude at ℓ_max (more intuitive than S/m)
      const gDmax0 = sl0 * lmaxNm * 1e-9;
      addSlider(host, "G_D(ℓmax)", 0, gDmax0 * 3 || 1, gDmax0, (v) => `${v.toExponential(2)} S`, (v) => { s.fitDrudeSlope = v / (lmaxNm * 1e-9); drawSweep(); }, (gDmax0 * 3 || 1) / 200);
    }
    if (!s.snaps) {
      if (s.type !== "mfp") host.innerHTML = '<span class="hint">Tick “Store field snapshots” before running to scrub the device fields.</span>';
      return;
    }
    if (s.type === "vgb") {
      addSlider(host, "V_g", 0, s.vgs.length - 1, 0, (i) => `${s.vgs[i].toPrecision(3)} V`, (i) => { s.cursorI = i; updateCursor(); });
      addSlider(host, "B", 0, s.bs.length - 1, 0, (j) => `${s.bs[j].toPrecision(3)} T`, (j) => { s.cursorJ = j; updateCursor(); });
    } else {
      const unit = s.type === "vg" ? "V" : s.type === "b" ? "T" : "nm";
      addSlider(host, s.type === "vg" ? "V_g" : s.type === "b" ? "B" : "ℓ", 0, s.x.length - 1, 0, (i) => `${s.x[i].toPrecision(3)} ${unit}`, (i) => { s.cursor = i; updateCursor(); });
    }
    updateCursor();
  }
  function addSlider(host, label, min, max, val, fmt, onInput, step) {
    const row = document.createElement("div"); row.className = "srow";
    const lab = document.createElement("span"); lab.textContent = label; lab.style.minWidth = "26px";
    const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step || 1; inp.value = val;
    const out = document.createElement("span"); out.className = "sval"; out.textContent = fmt(val);
    inp.addEventListener("input", () => { out.textContent = fmt(+inp.value); onInput(+inp.value); });
    row.append(lab, inp, out); host.appendChild(row);
  }
  function updateCursor() {
    const s = lastSweep; if (!s || !s.snaps) return;
    const idx = s.type === "vgb" ? (s.cursorJ || 0) * s.vgs.length + (s.cursorI || 0) : (s.cursor || 0);
    showSnapshot(s.snaps[idx]);
    drawSweep();
  }
  function showSnapshot(snap) {
    if (!snap) return;
    if (snap.u) lastFEM = { grid: lastSweep.grid, u: snap.u, qx: snap.qx, qy: snap.qy, I: 0, R: snap.R, probeV: [], iters: 0, residual: 0, converged: true, ms: 0 };
    if (snap.density) lastTraj = { density: snap.density, gx: snap.gx, gy: snap.gy, nLaunched: state.nTraj, statuses: {}, paths: [], scatterPoints: [], transmission: (lastTraj && lastTraj.transmission) || [] };
    // show the most relevant main-viz tab for what was stored
    if (snap.u && activeTab !== "current") activeTab = "potential";
    else if (!snap.u && snap.density) activeTab = "trajectories";
    setTab(activeTab);
    setStatus(`Snapshot: V_g→n=${snap.n_cm2.toExponential(2)} cm⁻², B=${snap.B.toFixed(2)} T` + (snap.R != null && isFinite(snap.R) ? ` · R≈${fmtR(snap.R)}` : ""));
  }


  function exportSweepCSV() {
    if (!lastSweep) { setStatus("Run a sweep first."); return; }
    const s = lastSweep; let csv = "";
    if (s.type === "vgb") {
      const cols = s.x.map((v) => v.toPrecision(6)).join(",");
      if (s.fem) { csv += `# FEM G (S/depth)\nB\\Vg,${cols}\n`; s.bs.forEach((b, j) => { csv += b.toPrecision(6) + "," + s.x.map((_, i) => s.fem[j * s.x.length + i]).join(",") + "\n"; }); }
      if (s.bal) { csv += `# Ballistic G (S)\nB\\Vg,${cols}\n`; s.bs.forEach((b, j) => { csv += b.toPrecision(6) + "," + s.x.map((_, i) => s.bal[j * s.x.length + i]).join(",") + "\n"; }); }
    } else if (s.measure && s.measure !== "2t") {
      // four-probe resistance (Ω): FEM and/or ballistic Büttiker
      const tag = s.measure === "hall" ? "Rxy" : "Rxx";
      let head = s.xlabel.replace(/,/g, "");
      if (s.fem) head += `,${tag}_FEM(Ohm)`;
      if (s.bal) head += `,${tag}_ballistic(Ohm)`;
      csv += head + "\n";
      s.x.forEach((v, i) => { let row = v.toPrecision(6); if (s.fem) row += `,${s.fem[i]}`; if (s.bal) row += `,${s.bal[i]}`; csv += row + "\n"; });
    } else {
      const R = (g) => (g > 0 && isFinite(g) ? 1 / g : "");
      let head = s.xlabel.replace(/,/g, "");
      if (s.fem) head += ",G_FEM(S),R_FEM(Ohm)";
      if (s.bal) head += ",G_traj(S),R_traj(Ohm)";
      if (s.type === "mfp" && s.fitSharvin != null) head += ",G_Sharvin(S),G_Drude(S),G_crossover(S)";
      csv += head + "\n";
      s.x.forEach((v, i) => {
        let row = v.toPrecision(6);
        if (s.fem) row += `,${s.fem[i]},${R(s.fem[i])}`;
        if (s.bal) row += `,${s.bal[i]},${R(s.bal[i])}`;
        if (s.type === "mfp" && s.fitSharvin != null) {
          const gD = s.fitDrudeSlope * v * 1e-9, gS = s.fitSharvin;
          row += `,${gS},${gD},${1 / (1 / gS + 1 / gD)}`;
        }
        csv += row + "\n";
      });
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `transim_sweep_${s.type}.csv`; a.click(); URL.revokeObjectURL(a.href);
    log("Sweep CSV exported.");
  }

  /* ===== Sweep plotting (its own canvas) ================================= */
  function sweepCanvas() {
    const cv = $("sweep-canvas");
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(200, r.width); cv.height = Math.max(160, r.height);
    return { cv, ctx: cv.getContext("2d") };
  }
  function drawSweep() {
    if (!$("sweep-canvas")) return;
    const { cv, ctx } = sweepCanvas();
    ctx.clearRect(0, 0, cv.width, cv.height);
    const info = $("sweep-info");
    if (!lastSweep) { ctx.fillStyle = "#5b6472"; ctx.font = "12px system-ui"; ctx.fillText("Set ranges, choose FEM/Ballistic, then Run sweep.", 12, 24); if (info) info.textContent = ""; return; }
    const s = lastSweep;
    if (s.type === "vgb") drawSweep2D(ctx, cv, s, info);
    else drawSweep1D(ctx, cv, s, info);
  }
  function niceMax(a) { let m = 0; for (const v of a) if (isFinite(v)) m = Math.max(m, v); return m || 1; }
  function fmtG(v) { return v === 0 ? "0" : v.toExponential(1); }
  function drawSweep1D(ctx, cv, s, info) {
    const m = { l: 64, r: 12, t: 14, b: 32 };
    const w = cv.width - m.l - m.r, h = cv.height - m.t - m.b;
    const xs = s.x, x0 = xs[0], x1 = xs[xs.length - 1];
    const isR = s.quantity === "R";
    const series = [];
    const balName = s.measure === "hall" ? "Landauer R_xy (ballistic)" : s.measure === "rxx" ? "Landauer R_xx (ballistic)"
      : s.balMode === "mc" ? "Trajectory MC" : "Landauer (ball.↔diff.)";
    const femName = s.measure === "hall" ? "FEM R_xy" : s.measure === "rxx" ? "FEM R_xx" : "FEM (Drude)";
    if (s.fem) series.push({ name: femName, color: "#61afef", v: s.fem });
    if (s.bal) series.push({ name: balName, color: "#e5c07b", v: s.bal });
    // analytic overlays for the ℓ sweep (transformed to G or R like the data)
    const overlays = [];
    if (s.type === "mfp" && s.fitDrudeSlope != null) {
      const gD = (nm) => s.fitDrudeSlope * nm * 1e-9;          // Drude G = slope·ℓ
      const gS = s.fitSharvin;                                 // Sharvin plateau
      overlays.push({ name: "Drude fit (∝ℓ)", color: "#56b6c2", dash: [5, 4], f: (nm) => gD(nm) });
      overlays.push({ name: "Sharvin fit (ℓ→∞)", color: "#c678dd", dash: [5, 4], f: () => gS });
      overlays.push({ name: "Crossover 1/(1/G_S+1/G_D)", color: "#abb2bf", dash: [2, 3], f: (nm) => 1 / (1 / gS + 1 / gD(nm)) });
    }
    // y-range from transformed finite values (data + overlays). yLo≤0≤yMax keeps
    // the origin in view so e.g. R_xy(B) (odd in B) shows its zero crossing.
    const logy = !!s.logy;
    let yMax = 0, yMin = Infinity, yLo = 0;
    const consider = (g) => { const q = qOf(g); if (!isFinite(q)) return; yMax = Math.max(yMax, q); yLo = Math.min(yLo, q); if (q > 0) yMin = Math.min(yMin, q); };
    for (const ser of series) for (const v of ser.v) consider(v);
    for (const o of overlays) for (const nm of xs) consider(o.f(nm));
    yMax = yMax || 1; if (!isFinite(yMin) || yMin <= 0) yMin = yMax / 1e4;
    // x mapping (linear, or log for ℓ)
    const lx = (v) => Math.log(Math.max(v, 1e-12));
    const X = s.logx ? (x) => m.l + (lx(x) - lx(x0)) / ((lx(x1) - lx(x0)) || 1) * w
                     : (x) => m.l + (x - x0) / ((x1 - x0) || 1) * w;
    const lyN = (Math.log(yMax) - Math.log(yMin)) || 1;
    const Y = (g) => {
      const q = qOf(g); if (!isFinite(q)) return m.t;
      if (logy) { const t = (Math.log(Math.max(q, yMin * 0.5)) - Math.log(yMin)) / lyN; return m.t + (1 - clamp01(t)) * h; }
      return m.t + (1 - clamp01((q - yLo) / ((yMax - yLo) || 1))) * h;
    };
    ctx.strokeStyle = "#2a313c"; ctx.lineWidth = 1; ctx.strokeRect(m.l, m.t, w, h);
    // y grid + numbered ticks
    ctx.font = "10px system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    if (logy) {
      for (let d = Math.floor(Math.log10(yMin)); d <= Math.ceil(Math.log10(yMax)); d++) {
        const yv = Math.pow(10, d); if (yv < yMin * 0.5 || yv > yMax * 1.5) continue; const yy = Y(yv);
        ctx.strokeStyle = "#1c222b"; ctx.beginPath(); ctx.moveTo(m.l, yy); ctx.lineTo(m.l + w, yy); ctx.stroke();
        ctx.fillStyle = "#8a94a6"; ctx.fillText("1e" + d, m.l - 5, yy);
      }
    } else {
      for (let k = 0; k <= 4; k++) {
        const yv = yLo + (yMax - yLo) * k / 4, yy = m.t + (1 - k / 4) * h;
        ctx.strokeStyle = (Math.abs(yv) < 1e-30) ? "#3a414c" : "#1c222b"; ctx.beginPath(); ctx.moveTo(m.l, yy); ctx.lineTo(m.l + w, yy); ctx.stroke();
        ctx.fillStyle = "#8a94a6"; ctx.fillText(fmtG(yv), m.l - 5, yy);
      }
      if (yLo < 0) { ctx.strokeStyle = "#4a515c"; ctx.beginPath(); ctx.moveTo(m.l, Y(0)); ctx.lineTo(m.l + w, Y(0)); ctx.stroke(); }
    }
    // x numbered ticks (decade ticks in log mode)
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#8a94a6";
    if (s.logx) {
      const d0 = Math.floor(Math.log10(x0)), d1 = Math.ceil(Math.log10(x1));
      for (let d = d0; d <= d1; d++) { const xv = Math.pow(10, d); if (xv < x0 * 0.999 || xv > x1 * 1.001) continue; ctx.fillText(xv >= 1000 ? (xv / 1000) + "k" : "" + xv, X(xv), cv.height - 20); }
    } else {
      for (let k = 0; k <= 4; k++) { const xv = x0 + (x1 - x0) * k / 4; ctx.fillText(xv.toPrecision(3), X(xv), cv.height - 20); }
    }
    ctx.fillText(s.xlabel, m.l + w / 2, cv.height - 6);
    ctx.save(); ctx.translate(13, m.t + h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(qLabel(), 0, 0); ctx.restore();
    if (!s.logx && x0 < 0 && x1 > 0) { ctx.strokeStyle = "#3a414c"; ctx.beginPath(); ctx.moveTo(X(0), m.t); ctx.lineTo(X(0), m.t + h); ctx.stroke(); }
    // analytic overlays first (behind data)
    for (const o of overlays) {
      ctx.strokeStyle = o.color; ctx.lineWidth = 1.5; ctx.setLineDash(o.dash); ctx.beginPath();
      let pen = false;
      xs.forEach((x) => { const q = qOf(o.f(x)); if (!isFinite(q)) { pen = false; return; } const px = X(x), py = Y(o.f(x)); pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true; });
      ctx.stroke(); ctx.setLineDash([]);
    }
    // data series
    for (const ser of series) {
      ctx.strokeStyle = ser.color; ctx.lineWidth = 2; ctx.beginPath();
      let pen = false;
      xs.forEach((x, i) => { const v = ser.v[i]; if (!isFinite(v)) { pen = false; return; } const py = Y(v); pen ? ctx.lineTo(X(x), py) : ctx.moveTo(X(x), py); pen = true; });
      ctx.stroke();
    }
    // scrub cursor
    if (s.snaps && xs.length) {
      const ci = Math.max(0, Math.min(xs.length - 1, s.cursor || 0));
      ctx.strokeStyle = "#e06c75"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(xs[ci]), m.t); ctx.lineTo(X(xs[ci]), m.t + h); ctx.stroke();
    }
    // legend
    let ly = m.t + 4; ctx.textAlign = "left"; ctx.font = "11px system-ui";
    for (const ser of series.concat(overlays)) { ctx.fillStyle = ser.color; ctx.fillRect(m.l + 6, ly, 12, 3); ctx.fillStyle = "#cfd6e0"; ctx.fillText(ser.name, m.l + 22, ly + 5); ly += 13; }
    if (info) {
      if (s.measure === "hall") info.textContent = `${s.xlabel} sweep · Hall R_xy = (V_top − V_bottom)/I from the transverse probe pair — FEM (probe voltages) and/or ballistic multi-terminal Landauer–Büttiker. Odd in B, through the origin (R_xy ≈ B/ne).`;
      else if (s.measure === "rxx") info.textContent = `${s.xlabel} sweep · Longitudinal R_xx = (V₁ − V₂)/I from the in-line probe pair — FEM and/or ballistic Büttiker.`;
      else if (s.type === "mfp") info.textContent = `G vs ℓ (log x) · ${qLabel()} · Drude line ∝ℓ and Sharvin plateau are fitted (sliders below); their series combination is the crossover. FEM lies on Drude; Landauer on the crossover.`;
      else info.textContent = `${s.xlabel} sweep · ${xs.length} points · ${qLabel()} (shared axis). Landauer = ballistic (Sharvin) in series with the diffusive FEM resistance → meets FEM when ℓ≪L.`;
    }
  }
  function drawSweep2D(ctx, cv, s, info) {
    const balName = s.balMode === "mc" ? "Trajectory MC" : "Landauer (ball.↔diff.)";
    const panels = []; if (s.fem) panels.push({ name: "FEM (Drude)", v: s.fem }); if (s.bal) panels.push({ name: balName, v: s.bal });
    const nx = s.x.length, ny = s.bs.length;
    const gap = 28, ph = (cv.height - gap * panels.length) / panels.length;
    const qlab = s.quantity === "R" ? "R" : "G";
    panels.forEach((p, pi) => {
      const tv = p.v.map((g) => qOf(g));                 // transform to G or R
      const max = niceMax(tv), y0 = pi * (ph + gap) + 18;
      const cw = cv.width - 60, cellw = cw / nx, cellh = ph / ny;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const raw = tv[j * nx + i];
        const t = (isFinite(raw) ? raw : 0) / max; const c = lut(VIRIDIS, t);
        ctx.fillStyle = `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
        ctx.fillRect(46 + i * cellw, y0 + (ny - 1 - j) * cellh, Math.ceil(cellw), Math.ceil(cellh));
      }
      // scrub cursor outline at (cursorI, cursorJ)
      if (s.snaps) {
        const ci = Math.max(0, Math.min(nx - 1, s.cursorI || 0)), cj = Math.max(0, Math.min(ny - 1, s.cursorJ || 0));
        ctx.strokeStyle = "#e06c75"; ctx.lineWidth = 1.5;
        ctx.strokeRect(46 + ci * cellw, y0 + (ny - 1 - cj) * cellh, Math.ceil(cellw), Math.ceil(cellh));
      }
      ctx.fillStyle = "#cfd6e0"; ctx.font = "11px system-ui"; ctx.textAlign = "left";
      ctx.fillText(`${p.name}  ${qlab}∈[0, ${max.toExponential(2)}]`, 46, y0 - 4);
      ctx.fillStyle = "#8a94a6"; ctx.save(); ctx.translate(12, y0 + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText(s.ylabel, 0, 0); ctx.restore();
    });
    ctx.fillStyle = "#8a94a6"; ctx.textAlign = "center"; ctx.fillText(s.xlabel, cv.width / 2, cv.height - 2);
    if (info) info.textContent = `2D sweep ${s.xlabel} × ${s.ylabel} · ${nx}×${ny} grid · colour = G (each panel scaled to its own max).`;
  }

  /* ===== Public surface ================================================== */
  window.TranSimApp = {
    HELP_TEXT, defaults, get state() { return state; }, set state(s) { state = s; },
    run, render, exportJSON, exportPNG,
    setTab(tab) { activeTab = tab; document.querySelectorAll(".tab").forEach((t)=>t.classList.toggle("active", t.dataset.tab===tab)); render(); },
    setDensityField(f) { densityField = f; }, setMobilityField(f) { mobilityField = f; },
    validity, siParams,
  };
  function setTab(t) { window.TranSimApp.setTab(t); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initUI);
  else initUI();
})();
