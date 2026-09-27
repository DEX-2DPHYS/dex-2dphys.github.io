# Salmonella 3D simulation – source

`index.html` is a single self-contained file (Three.js 0.170 bundled inline, no internet needed).
It is generated from this folder.

## Rebuild after editing

```
cd tools/salmonella
npm install          # once: installs three@0.170.0 and esbuild@0.24.0 into node_modules
node build.js "../index.html"
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
- `template.html`    page, CSS and the hidden right-hand panel

## URL parameters (useful for testing)

`?view=motor` (overview | motor | filament | porin | kchannel | atp | inside), `&dark=1`, `&panel=1`, `&t=2` (start time in s)
