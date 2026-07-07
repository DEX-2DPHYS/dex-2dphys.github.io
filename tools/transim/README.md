# Graphene Hybrid FEM / Ballistic Transport Explorer (TranSim)

A self-contained, exploratory tool for **hybrid FEM + ballistic / quasi-ballistic
electron transport** in 2D graphene devices. It lets you explore the transition
between:

- **diffusive** drift-diffusion transport (FEM),
- **quasi-ballistic** stochastic Monte-Carlo trajectory transport, and
- **fully ballistic** Landauer–Büttiker-style transmission,

all on the same device geometry, with tunable mean free path, magnetic field,
carrier density, mobility and contact placement.

It ships in **two equivalent implementations**:

1. A **browser app** (`TransportSimulator.html` + JS) — no build step.
2. A **Python / Streamlit app** (`python_app/`) with the same layout and controls.

> This is an exploratory scientific instrument, **not** a production quantum
> transport solver. See *Known limitations*.

## What it does

- Solves the 2D drift-diffusion equation ∇·(σ(x,y,B)∇V)=0 on a finite-volume
  grid with a **Hall conductivity tensor**, producing the potential map, the
  current-density map, a resistance estimate, and — because the Hall term enters
  the boundary face fluxes — a **transverse Hall voltage that emerges naturally**.
  So placing a probe pair *across* the current reads the Hall signal (R_xy),
  while a pair *along* it reads the longitudinal signal (R_xx).
- Propagates **semiclassical electron trajectories** from the source: straight
  lines at B=0, cyclotron arcs at finite B, with exponential mean-free-path
  scattering and specular/diffuse/absorbing/mixed edges.
- Builds a **Landauer–Büttiker transmission matrix** T_ij = N(i→j)/N_i and a
  conductance estimate G_ij ≈ (4e²/h)·M_i·T_ij.
- Loads optional **image maps** for carrier density, mobility and contacts.
- Lets you **place contacts anywhere** on the device: pick a preset, **draw
  contact rectangles** by click-dragging on the device map (browser) or edit a
  contact table (Streamlit), or **import contact geometry from an image**
  (colour regions, or 8/16-bit greyscale where distinct grey levels become
  distinct contacts). Contacts work on edges *or* in the interior.
- Provides a **validity assistant** and a **model-assumptions** panel.

## How to run

### Browser version
Either **double-click `TransportSimulator.html`**, or serve it (recommended — the
parallel-sweep Web Workers require http, not `file://`):
```bash
cd TranSim
python3 -m http.server 8000
# then open http://localhost:8000/TransportSimulator.html
```
No dependencies — everything is plain HTML/CSS/JS.

### Python / Streamlit version
```bash
cd TranSim/python_app
pip install -r requirements.txt
streamlit run streamlit_app.py
```

> **Windows PowerShell:** run each command on its own line. PowerShell does **not**
> accept `&&` as a separator (`The token '&&' is not a valid statement separator`),
> so don't chain commands with it — or use `;` instead (`cd TranSim; python -m http.server 8000`).

## The three regimes

| Regime | When | Best tool |
|--------|------|-----------|
| **Diffusive** | ℓ ≪ device size (ℓ/L ≪ 1) | FEM drift-diffusion |
| **Quasi-ballistic** | ℓ ~ device size (ℓ/L ~ 1) | Monte-Carlo trajectories with finite ℓ |
| **Ballistic** | ℓ ≫ device size (ℓ/L ≫ 1) | trajectory transmission (Landauer–Büttiker) |

ℓ is the mean free path, set directly or from mobility and density via the
semiclassical graphene relation ℓ = ħμ√(π|n|)/e.

## Image maps

Upload JPG/PNG maps (see `examples/`):

- **Carrier density** n(x,y): gates, p–n junctions, charge puddles, patterned
  landscapes. Sets local k_F, cyclotron radius and conductivity.
- **Mobility** μ(x,y): local conductivity and/or local mean free path.
- **Contacts**: black = active graphene, white = etched, saturated colours =
  contacts (assign roles: source / drain / probe / absorber).

## Units

| Quantity | UI unit | Internal |
|----------|---------|----------|
| width/height | µm | m |
| carrier density | cm⁻² | m⁻² |
| mobility | cm²/Vs | m²/Vs |
| magnetic field | T | T |
| mean free path | nm / µm | m |
| voltage | V | V |

All computation is in SI; conversions happen at the UI edges.

## Physics assumptions

This tool is **semiclassical**. It does **not** solve the Dirac equation and
omits quantum interference, weak localization, universal conductance
fluctuations, tunneling/Klein tunneling, edge-state quantization and full
self-consistent electrostatics. The FEM Hall voltage is qualitatively (not
quantitatively) exact in v1; voltage probes are read passively. Landauer–Büttiker
conductances are classical-transmission estimates.

## Known limitations

- Finite-difference / finite-volume on a rectangular grid (no unstructured mesh).
- Hall boundary terms use a clamped stencil at edges → Hall voltage ~10–15% low.
- Voltage probes are passive readouts (no enforced zero-net-current floating).
- p–n refraction (Klein tunneling) is not modelled; sign-changing density is
  treated semiclassically.
- Trajectory counts up to ~10⁵ are feasible but slow in the browser.

## Testing checklist (verified)

1. **Zero field** — trajectories are straight; source→drain transmission is high
   in open geometry (ballistic T ≈ 0.51 for the default half-open Hall bar). ✓
2. **Finite field** — trajectories curve; reversing B reverses curvature; FEM
   Hall voltage flips sign with B (verified ∓2.1×10⁻⁴ V at ±0.5 T on a test bar). ✓
3. **Short mean free path** — many scattering events (~35–40 for ℓ=100 nm) and a
   diffuse trajectory-density map. ✓
4. **Long mean free path** — ~0 scattering events; ballistic statistics. ✓
5. **Density dependence** — higher n raises k_F, mode count and r_c (formulas in
   `physics.js`/`physics.py`). ✓
6. **Mobility dependence** — higher µ raises conductivity and (if enabled) ℓ. ✓
7. **Electrostatics** — Laplace between two plates gives the exact linear
   potential (mid-plane = 0.5000). ✓
8. **Export** — JSON includes inputs, derived quantities, FEM summary and
   trajectory statistics. ✓

## Future improvements

- True unstructured FEM mesh; self-consistent Poisson–transport iteration.
- Proper floating voltage probes (enforced zero net current).
- p–n junction Klein tunneling and angular transmission.
- Hydrodynamic transport regime; quantum transport via Kwant.
- GPU / Web Worker acceleration for large trajectory ensembles.
- Uncertainty analysis over mobility/density maps; magnetoresistance fitting.

## Files

```
TranSim/
├── TransportSimulator.html   browser entry point
├── style.css  app.js  physics.js  fem_solver.js  trajectory_solver.js  maps.js
├── examples/                 example image maps + README
└── python_app/               Streamlit mirror (+ its own README)
```
