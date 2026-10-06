# Salmonella 3D simulation – source

`index.html` is a single self-contained file (Three.js 0.170 bundled inline, no internet needed).
It is generated from this folder.

## Rebuild after editing

```
cd tools/salmonella
npm install          # once: installs three@0.170.0 and esbuild@0.24.0 into node_modules
node build.js index.html
```

## Layout

- `src/main.js`      scene, lights, post-processing chain, controls (orbit, fly, focus), views, panel wiring
- `src/cell.js`      membranes (outer/inner bilayers, peptidoglycan net), surface proteins, ribosomes, DNA, enzymes, fimbriae
- `src/flagella.js`  flagellar motor (C-ring, MS-ring, stators, rod, P/L rings, export apparatus), hook, rotating helical filament
- `src/proteins.js`  porin trimer (β-barrels), K⁺ channel tetramer, F₁F₀ ATP synthase, with animated ions/protons
- `src/medium.js`    floating debris with Brownian motion and drift
- `src/dof.js`       scene render + gather depth-of-field pass
- `src/glsl.js`      shader snippets (noise, membrane bumps, subunit lattice, DoF, vignette)
- `src/materials.js` material factories injecting the shader snippets into MeshPhysicalMaterial
- `src/geom.js`      cell surface parametrisation (1 unit = 1 nm), dynamic tubes, helices, ribbons
- `src/portal.js`    micro-textbooks: the book symbol beside each view preset, the chapter text,
                     the annotated K⁺ figure, and the mock-up "more material" footer
- `template.html`    page, CSS and the hidden right-hand panel

## Micro-textbooks

Each of the seven view presets carries a book symbol that opens a one-page chapter. The whole
set is framed around one question — understand the organism in order to find something to treat
it with — and every chapter closes with a **Drug target** box.

Two things are worth knowing before editing them:

- **Figures come out of the running scene.** `requestFigure(view, opts, cb)` in `main.js` snaps
  the camera to a stored view's own pose, renders one frame, reads the canvas back, and restores
  everything inside a single animation frame, so none of it reaches the screen. Results are
  cached per (view, opts). A figure therefore cannot fall out of step with the model.
- **Annotation pins are 3-D, not pixels.** The K⁺ chapter's `explore` block lists points in the
  channel's own coordinates (z = pore axis, +z = periplasmic side); they are projected through
  the capture camera, so labels stay on their parts if the geometry or the view is changed.
  `anchorObjects` in `main.js` maps a name to the object those coordinates belong to.

The footer buttons (Full chapter, Video lecture, …) are deliberately inert: they answer with a
"second level, not built in this mock-up" note rather than pretending to navigate.

## URL parameters (useful for testing)

`?view=motor` (overview | motor | filament | porin | kchannel | atp | inside), `&dark=1`, `&panel=1`, `&t=2` (start time in s)
