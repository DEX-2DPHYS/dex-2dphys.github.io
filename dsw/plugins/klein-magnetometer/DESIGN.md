# Klein-collimation magnetometer — DSW plugin design

Status: agreed 2026-10-01 (Peter's answers to the four design questions are
folded in below). Nothing built yet beyond this document.

Reference engine: `00 VSCODE/Klein magnetometer/analysis/engine.js`, which is
the verbatim Node port of `KMclaude_parabola_sensitivity.html` used for the
June 2026 report (`analysis/report.tex`, `data/results.json`,
`data/optimized.json`). The older `kleinmagnetometer.html` is a subset.

## Decisions

| Question | Decision |
|---|---|
| Junction profile default | Gate-electrostatic arctan profile, width set by the gate–graphene distance; linear ramp of width d kept as an option for continuity with June. |
| Curved / wavy junctions | Not this round. The junction is represented as a curve x = X_j(y) from the start so parabolic and wavy shapes drop in later without touching the tracer. |
| Coherent sidebar | Yes: normal-incidence transfer matrix of the full N-junction stack vs energy, Fabry–Pérot amplitude after thermal averaging, as a "why incoherent is justified" figure. |
| Noise model | Johnson + shot + optional 1/f with a Hooge parameter (input, default off). |
| Bundle location | `DSW/Plugins/2D Materials/klein-magnetometer/` (Dropbox library). |

## Physics

### Regions and bands
Alternating n / p cells along x. Cell j has signed Fermi wavevector
k_j = s_j sqrt(pi n_j), s = +1 electrons, -1 holes. Lengths L_n, L_p may differ.
Unipolar control: all cells electron-like (s = +1) with the "p" density, which
removes Klein filtering but keeps the geometry and refraction.

### Junction transmission (exact, tabulated)
For each junction and each conserved transverse momentum k_y the 2-component
Dirac equation is integrated across the profile U(x):

    -i hbar v_F (sigma_x d/dx + i sigma_y k_y) psi + U(x) psi = E psi

with plane-wave matching on both sides. Output T(k_y), checked for T + R = 1.
Profiles (all parameterised so that the maximum |dk/dx| equals 2 k_F / d, so
every profile shares the Cheianov–Fal'ko asymptote exp(-pi k_y^2 / |dk/dx|)):

* `gate`   : k(x) ∝ arctan(x / h) — field below the edge of a top gate at
             height h above graphene (default). d = pi h.
* `linear` : k(x) linear over width d (June convention, |dk/dx| = 2 k_F / d).
* `tanh`, `erf` : smooth alternatives.
* `asymptotic` : the June formula itself, no ODE (validation / speed).

Limits that must be recovered (gate G4): sharp junction → cos^2 θ for a
symmetric step; k_F d ≥ 10 → asymptotic formula within 1 %; T(0) = 1.

### Trajectories (event-driven, exact arcs)
Between events a carrier moves on an exact circle of radius
R_c = hbar k_F / (e B), sense set by the band sign. Events: junction crossing
(circle–curve intersection, bracketed root along the arc), edge hit (y = 0, W),
scattering (free path drawn from exp(-l/ℓ) in path length), e–e kick
(separate rate, speed-conserving, not counted in ℓ), flight-length cap.
No timestep. Junctions: accept with T(k_y), else specular reflection across
the junction normal; accepted rays refract with conserved k_y and the sign flip
of the band (negative refraction). Total internal reflection handled.

### Two transport engines, which must agree (gate G6)
* `mc`   : accept/reject Monte Carlo, common random numbers across B and
           across any sweep (seed depends on trajectory index only). THE
           PRODUCTION ENGINE.
* `flux` : ray splitting. At each junction the ray splits into weight T
           (transmitted) and 1 - T (reflected). Branches below a weight
           threshold play Russian roulette (survive with probability w/thr at
           weight thr), so NO weight is ever discarded and the estimate is
           unbiased. Quadrature over (y_0, sin θ_0), midpoint or jittered.
  Measured 2026-10-01 (G6, N=8 device): the reflected-ray tree costs
  2–12 thousand traced rays per quadrature node, and the roulette noise makes
  the flux estimate NOISIER per CPU second than Monte Carlo (σ 0.003 at 6 168
  nodes vs 0.001 at 200 000 trajectories, at ~10× the cost). The first
  version simply dropped sub-threshold branches and was biased low by 5–16 %;
  that is why roulette is mandatory. The flux engine is therefore an
  independent-bookkeeping CROSS-CHECK (it reproduces the one- and
  two-junction closed forms to 1e-4), not a variance-reduction tool.

### Conductance
Landauer, G = (4 e^2 / h) M <T>, M = floor(k_F,min W / pi), <T> the
cos-θ-weighted (flux) average over injection. Thermal averaging: energies on a
Gauss–Hermite-like grid over the Fermi window, each energy shifting all k_j
(n cells up, p cells down), G = ∫ G(E) (-df/dE) dE. One energy at T ≤ 20 K
unless forced.

### Field-response metrics (per curve)
T(0), R0, MR depth, FWHM, even-parabola curvature a/R0, peak |dR/dB|/R0 by
Savitzky–Golay derivative, flank operating point, and field resolution
B_min = sqrt(S_R) / |dR/dB| with S_R from Johnson (4 k T R), shot
(2 e I R^2), and optional 1/f (Hooge α / N_carriers / f).

### Disorder and controls
Per-junction jitter: position, width d, density, local tilt (rms). Edge models:
specular, specularity p (Lambertian otherwise), absorbing (grounded side
contacts: ray lost), open (ray leaves the strip: lost). Injection: Landauer
cos θ over the full width, aperture of fraction w/W, collimated Gaussian of
width σ_θ.

### Coherent sidebar
1D transfer matrix at k_y = 0 through the full stack (N junctions with the
same profiles), T(E) over the Fermi window, FP oscillation amplitude vs T and
vs ℓ_φ. Reported as a number next to the incoherent result. Not used in R(B).

## 2026-10-01 afternoon: review fixes, v0.5.0
Path-cap bias (default 6 -> 200; MR(20 mT) overstated 3.6x at cap 6), fixed-field MR
metric (`mrField_mT`, `mrAt`, `mrEdge`, `cappedOverT`), transport vs event mean free
path (`mfpTr_um`, `mobility_cm2Vs` in derived; panel mobility box converts), and the
nine defects of the independent review (skew start cell, tilt leakage, Landauer lead
mode count, coherent normalisation and visibility, scatter none, equal-density
unipolar, per-energy random streams, noise temperature 0 = device T, side-aware line
hits). Cyclotron sense is now physical (B > 0 along +z); gates compare with the
reference engine at -B. New gates G11-G17 (`test/gates_stage5.h`, `--stage5`).
Scaling study and its findings: `Klein magnetometer/analysis/nscaling/RESULTS.md`.

## Findings that matter for the paper (measured, 2026-10-01)
* **Two "peak sensitivities".** The June report's 331 /T is 2 a B_max / R0
  from the global even-parabola fit evaluated at the window edge. The TRUE
  local slope |dR/dB|/R0 at the flank (±15–20 mT) is about 690 /T, because
  R(B) rises ~350 % over ±20 mT and is nowhere near parabolic there. The
  plugin reports both (`peakSens` = true slope, `peakSensParabola` = June
  definition).
* **Superseded numbers:** everything below was measured at path cap 6 or with the
  bottleneck mode count; see the 2026-10-01 afternoon section and nscaling/RESULTS.md.
* **The 0.7 nT/√Hz was optimistic.** It used R0 = 62 Ω for the Johnson noise,
  but at the flank operating point the device sits at ~265 Ω, and the shot
  noise at 10 µA (2 e I R²) is comparable to Johnson at 20 K. With both,
  B_min ≈ 1.7 nT/√Hz at the flank. The vertex (parabolic) readout is ~7 µT in
  1 Hz — three to four orders worse — so a linear magnetometer must be
  flank-biased or skewed.
* **Junction profile matters at k_F d ≈ 2.** At d = 10 nm, n = 1e12 cm⁻²:
  T(30°) = 0.36 (gate-electrostatic), 0.47 (tanh), 0.50 (erf / asymptotic),
  0.59 (linear ramp). The asymptotic formula is 1 % accurate only for
  k_F d ≳ 20. The June numbers used the asymptotic form; the gate profile
  collimates more strongly at the same nominal d.
* **Thermal averaging reduces the mode count.** With n = |p|, the bottleneck
  cell at energy E_F + ε is always the one whose |k| decreased, so
  <M(ε)> < M(0): 112 → 88 effective modes at 300 K for W = 2 µm.
* **Flight-length cap.** 3–5 % of injected carriers hit the 6 L_tot path cap
  (grazing incidence); they count as not transmitted in both engines and in
  the June engine. The fraction is reported per point.

## Validation gates (offline probe, run before every install)
G1 mulberry32 stream bit-identical to the JS engine (first 32 draws).
G2 verbatim dt-engine port reproduces `data/optimized.json` (81 points,
   40 000 trajectories) within 3 σ at every B, and `results.json` groups
   within 3 σ on T(0).
G3 event-driven engine vs dt engine (dt → 1e-16) within MC σ on a matrix:
   B ∈ {0, ±20 mT}, skew ∈ {0, 10°}, specularity ∈ {1, 0.5}, ℓ ∈ {∞, 3 µm}.
G4 Dirac solver limits (above) + unitarity + reciprocity.
G5 Analytic: single region arc angle = L / R_c; N = 1 and N = 2 incoherent
   multiple-reflection series closed form at B = 0.
G6 flux engine = mc engine within σ; dropped weight < 1e-3.
G7 Landauer identity on the reported R0.
G8 thermal averaging at 1 K equals the single-energy result to 1e-4.
G9 panel ↔ core: every control id equals the parameter the core received
   (the 2DMD lesson).

## Architecture
* `src/plugin.cpp` — core; DEX ABI v1 (create/destroy/advance/on_message/
  poll_message/render). Jobs are resumable state machines inside advance().
* `src/klein_physics.h` — profiles, Dirac solver, arc geometry, engines.
  Header-only so the probe links it without the DLL.
* `src/reference_engine.h` — verbatim dt engine (validation only).
* `test/probe.cpp` — gates G1–G8; `test/build.ps1 [-Install]`.
* `ui/index.html` — panel; `DSW/tools/probe-klein-*.js` — WebSocket drivers
  for headless study runs (the report will be generated from these).
* Messages: `configure`, `run` (curve | sweep | grid | coherent), `stop`,
  `export`, `view`. Replies: `ready`, `derived`, `progress`, `curve`,
  `sweep_point`, `grid_point`, `coherent`, `done`, `error`.
* Frame: 960×540 device view (cells, junction curves, sample rays coloured by
  fate) with the response curve overlaid; the panel draws the charts.

## Build stages — status 2026-10-01
1. DONE  Core physics header + verbatim reference engine + probe with G1, G2.
2. DONE  Dirac solver + profiles + G4; event-driven tracer + G3, G5.
3. DONE  Flux engine + thermal averaging + metrics + G6–G8.
4. DONE  Plugin shell, messages, sweeps/grids, renderer, coherent sidebar
         (G10); installed and driven through the live host
         (`DSW/tools/probe-klein-ws.js` ALL CLEAR).
5. DONE  Panel UI (Opus 5.5, 2026-10-01) + G9: `node DSW/tools/probe-klein-panel.js
         [--shots <dir>]`, 35 checks ALL CLEAR. The panel is generated from one
         CONTROLS table (50 core keys + a local mobility helper); every configure
         reply is compared key by key and any value the core clamps is written
         back into the control and flagged. Tabs: Device (sample paths), R(B)
         (fits, error bars, held-curve overlay), Transmission & fates,
         Sensitivity & noise (budget table), Sweep (family / metric / table),
         Optimise (2-D grid heat map, constraints T(0), L_tot, L_tot/ℓ, best
         device, Apply best, Refine around best), Junction T(θ) (all five
         profiles, series product), Coherent (T_coh vs T_inc, thermal
         smoothing, visibility table). Results computed for other physical
         settings are tagged in their chart title. Exports: result JSON, curve
         CSV, sweep/grid CSV, chart PNG, settings JSON, generated methods text.
         Core additions for the panel: `run {mode:"angular"}`, `clear_paths`,
         sweepable `disorderSeed`, device cached for the frame (was rebuilt per
         animation frame), and the coherent sidebar's incoherent reference now
         solves the same ballistic B = 0 problem (`coherentProblem()`); before
         that fix, bulk/e–e scattering in the settings leaked into the reference
         and faked a 10–20 % coherent excess.
6. DONE  (folded into 4) Coherent sidebar.
7. TODO  Study matrix for the paper → JSON → figures → report.

Later: curved / wavy junction shapes (X_j(y) already generic), electrostatic
n(x,y) import.

## How to build and test
```
powershell -File test\build.ps1            # probe (all gates, ~6 min) ; add -Install to relink + swap the DLL
powershell -File test\build.ps1 -Quick     # skips the 40 000-trajectory G2 gate
%TEMP%\klein-stage\probe.exe "<analysis dir>" --stage2   # or --stage1/3/4: one stage only
node DSW\tools\probe-klein-ws.js [--shot frame.png]        # needs dsw.exe running
```
* The host holds the DLL once a session has opened it: stop `dsw.exe` before
  `-Install`, delete `klein-magnetometer.old.dll` after the next restart.
* Start the host from `dex-2dphys.github.io\dsw\` (`dsw.exe`, or the desktop
  `Start DSW` shortcut which handles a Smart-App-Control block).
* Probe reference numbers come from `$TEMP/klein-ref.js` run against
  `Klein magnetometer/analysis/engine.js` (node); they are embedded in
  `test/probe.cpp` and are bit-exact on this machine's libm.

## Message protocol (as implemented in src/plugin.cpp)
In: `hello` · `configure {tag?, …}` · `run {mode}` · `stop` · `reset` ·
`theme {light}` · `view {name}`.

`configure` keys (any subset; units in the name; strings where noted):
`nCells, L_um | Ln_um, Lp_um, W_um, n_cm2 | nN_cm2, nP_cm2, unipolar(0/1),
profile(gate|linear|tanh|erf|asymptotic), d_nm, skewDeg, sigmaPos_nm,
sigmaWidth, sigmaDensity, sigmaTiltDeg, disorderSeed,
edge(specular|diffuse|absorbing), specularity, injection(cosine|aperture|
collimated), apertureFrac, collimSigmaDeg, vF, mfp_um (<=0: infinite),
mfpPh300_um (0: off), tempK, scatter(none|drude|forward), forwardSigmaDeg,
eeMfp_um, eeSigmaDeg, maxPathFactor, fluxThreshold, engine(mc|flux), nTraj,
fluxNY, fluxNS, fluxJitter, nEnergy (1 = single energy), seed, bMin_mT,
bMax_mT, bN, fitWindow_mT (0 = a third of the window), sgHalf, biasA_uA,
noiseTempK, hooge, freqHz, threads, pathEvery, eRange_meV, eN, kyN`.
Every `derived` reply echoes the full set under `params` plus the `tag`.

`run` modes: `curve` · `sweep {param, from, to, n, log}` ·
`grid {…, param2, from2, to2, n2, log2}` · `coherent {eRange_meV, eN, kyN}` ·
`paths {B_mT, n}` (sample trajectories for the frame).
Sweepable params: nCells, L_um, Ln_um, Lp_um, W_um, n_cm2, nN_cm2, nP_cm2,
d_nm, skewDeg, sigmaPos_nm, sigmaWidth, sigmaDensity, sigmaTiltDeg,
specularity, apertureFrac, collimSigmaDeg, mfp_um, mfpPh300_um, tempK,
forwardSigmaDeg, eeMfp_um, eeSigmaDeg, maxPathFactor, vF.

Out: `ready {threads, version}` · `derived {kF, EF_meV, lambdaF_nm, kFd, h_nm,
Rc_um, deltaPerCell_deg, modes, Ltot_um, mfpEff_um, ballisticRatio,
junctions, T30, T30asym, worstUnitarity, mismatch, window_nm, kT_meV, tag,
params}` · `progress {mode, frac, i, total}` (≤ every 120 ms) ·
`curve {B_mT[], T[], sigmaT[], R[], sigmaR[], G[], reflected[], lost[],
capped[], meanPath_um[], edgeFrac[], meanCross[], dRdB[], metrics{R0,
R0global, R0local, aGlobal, aLocal, curvNorm, T0, Rmin, Rmax, mrDepth,
fwhm_mT, peakSlope, peakSlopeB_mT, peakSens, peakSensParabola, flankR, sv,
johnson, shot, flicker, bMinFlank_nT, bMinVertex_nT, peakAtEdge}, modes,
modesEff, nodes[{eps_meV,w}], ms, carriers, mfpEff_um, worstUnitarity,
mismatch, params}` · `sweep_start {param, n, xs}` / `sweep_point {i, x,
curve}` (curve without the per-point arrays) / `sweep_done` · `grid_start
{param, param2, n, n2, xs, ys}` / `grid_point {i, j, x, y, curve}` /
`grid_done` · `coherent {eps_meV[], Tcoh[], Tinc[], epsInc_meV[],
TincCoarse[], worstUnit[], temps[], smoothed[[…]], visibility[],
thermalCoh[], thermalInc[], TcohEF, TincEF, ms, params}` (null entries when
the thermal kernel does not fit inside eRange — raise eRange_meV) ·
`paths {B_mT, n, points}` · `job {state: running|done|stopped}` · `error
{message}` · `reset_done`.

Frame: 960×540, the strip fitted with its true aspect ratio (x = L_tot,
y = W), n cells blue / p cells orange, junction lines (skew drawn), sample
paths coloured by fate (green transmitted, orange reflected, red lost, grey
capped), 1 µm scale bar below. The panel draws all charts itself.

## Hand-over to the panel session (stage 5)
Follow `DSW/Plugins/2D Materials/transim/ui/index.html` for the DSW panel
conventions (dex.js, topbar, settings drawer, theme message, 16:9 view).
What the panel must offer:
* every `configure` key above as a control, grouped: Geometry (nCells, Ln,
  Lp, W, skew), Junctions (profile, d, densities, unipolar, disorder four
  sigmas + seed), Edges & injection, Scattering & temperature (mfp, phonon
  mfp, T, scatter model, e-e), Engine (mc/flux, nTraj or grid, nEnergy,
  seed, threads), Field grid & metrics (bMin/bMax/bN, fitWindow, sgHalf),
  Noise (bias, T, Hooge, f), Coherent (eRange, eN, kyN);
* charts: R(B) with error bars and the even-parabola fits; T(B) and the fate
  fractions; dR/dB; a metrics table that shows BOTH sensitivities and both
  B_min values with their definitions; sweep: family of R(B)/R0 curves plus
  metric-vs-x plots (T0, R0, FWHM, peakSens, curvNorm, bMinFlank); grid:
  heat maps of the chosen metric; coherent: T_coh(E) with T_inc(E) overlaid,
  smoothed curves per temperature, visibility-vs-T table;
* `derived` readout strip: k_F, E_F, λ_F, k_F d, h, R_c, rotation per cell,
  modes, L_tot/ℓ, T(30°) exact vs asymptotic, unitarity, profile mismatch;
* a "paths" slider (B) that sends `run paths` and shows the frame;
* export: JSON of the last curve/sweep/grid/coherent message (it already
  carries `params`), CSV of the curve, and a "methods" text block generated
  from `params` (profile, engine, trajectories, energies, seed, version).
* Gate G9 (`DSW/tools/probe-klein-panel.js`, headless Chrome as in
  `probe-2dmd-panel.js`): every control id ↔ configure key, no duplicate ids,
  the payload the panel sends equals the controls' values, and `derived.params`
  echoes them back.

## Hand-over for the study matrix (stage 7)
Drive the core from node over the WebSocket (pattern: `probe-klein-ws.js`),
one JSON file per study, 1e6 trajectories per point for headline curves.
Studies the paper needs (see the June `run_sweeps.js` for the first set):
N at fixed L and at fixed total length; L; W; d for each profile; density
(symmetric and asymmetric, plus the unipolar control); specularity; mobility
and scattering model; e-e; temperature with thermal averaging on (nEnergy 9)
and phonon mfp; junction disorder (each sigma); skew (odd response); the
(N, d) optimisation grid with bMinFlank as the figure of merit; the coherent
sidebar for the chosen device at 1–20 K. Figures with matplotlib from
`00 VSCODE/.venv`, report with tectonic (`Klein magnetometer/analysis/tools`).

## 2026-10-01 evening: Veselago geometry, density maps, validation against known results
* `leftContactFrac` / `rightContactFrac`: centred partial contacts on the end walls; outside
  them the end is a specular wall (`endWall()`), and a partial source sets the injection
  width. Default 1 = unchanged device (gate G18c proves it bit for bit).
* `run {mode:"density", B_mT, n, gx, gy, first}` -> path-length density map (first flight
  or full dynamics) + fates incl. `Tdirect` (reached the drain without touching any wall);
  the device frame shows it as a heat map. Gates G18a/b.
* Coherent sidebar: k_y sampling auto-raised to ~1.5 k_F L_max (`kyEff` in the reply);
  64 points aliased a 1 um cavity's Fabry-Perot period (0.76 instead of 2.07 meV).
* Known-result validation: `Klein magnetometer/analysis/validation/` — Veselago lens and
  image position b = a k_p/k_n (beam waist, within 1 %), 2D Landauer-Drude limit, FP
  period (within 0.4 %). Hall reference: `analysis/hall/` (transim, now rebuilt WITHOUT
  fast-math, plus a "2tb" measure = two-terminal resistance with floating probes).
* Report: claude.ai doc "Klein Magnetometer — Model, Methods and Viability".
