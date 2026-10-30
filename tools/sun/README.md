# The Sun – interactive textbook (source)

`index.html` is one self-contained file (Three.js 0.170 bundled inline, works offline from
file://). It is generated from this folder. Built on the same pattern as the salmonella model
(`2026 Interactive Notes/InteractivePresentations/2026 09 29 DTU BOARD/sims/salmonella-src`).

## Rebuild

```
node build.js index.html
```

node_modules live outside Dropbox in `%LOCALAPPDATA%\ulam-build\node_modules` (three@0.170.0,
esbuild@0.24.0), shared with the salmonella and Ulam builds. Edit the src files, never the bundle.

## Layout

- `src/main.js`     renderer, bloom, views, camera tweens (and co-rotation for Sun-frame views),
                    panel wiring, HUD, hover read-outs (analytic ray–sphere/cut-face hits + raycast
                    on loops/prominence/Earth/CME), flare + CME, textbook figure capture
- `src/sun.js`      photosphere shader (granulation, Eddington limb darkening, sunspots, faculae,
                    white light / H-α / EUV 171 Å), cut faces (illustrative or log-T map), chromosphere,
                    corona billboard (Baumbach K-corona, streamers, plumes), flare flash
- `src/active.js`   coronal loops, prominence, dipole + open field lines, Parker spiral, CME, photon random walk
- `src/wind.js`     solar-wind particles (discrete sources -> spiral streams), Earth + bow shock + aurora, stars
- `src/model.js`    rounded standard-solar-model table (T, ρ, m, L vs r), Baumbach–Allen n_e,
                    Snodgrass–Ulrich rotation, isothermal Parker wind solver
- `src/spec.js`     where things are on the Sun (spots, active regions, prominence, Earth); shared by
                    scene and textbook so pins and captions follow the geometry
- `src/tips.js`     hover read-out cards (each instrument adds what it measures at the cursor)
- `src/sound.js`    Listen: the low-degree p modes, sped up 100 000×, with a live spectrum
- `src/portal.js`   the textbook reader: book symbol per view, chapters, annotated captures,
                    glossary popups, previous/next, open-question box
- `src/content/en.js`     chapters, glossary, UI strings;  `charts.js` SVG charts computed from model.js;
                    `kit.js` maths/SVG/glossary helpers
- `template.html`   page, CSS, control panel, key hints

## Eight instruments (ported from SunSim.html, "The Sun, alive")

`uFilter` 0 white light (ACES tone mapping) · 1 Hα · 2 He II 304 · 3 Fe IX 171 · 4 Fe XII 193 ·
5 magnetogram · 6 Dopplergram · 7 total eclipse (1–7 shown without tone mapping, as false-colour maps).
The solar-cycle slider sets `uAct`, `uPolarN` and `uSpotVis` (corona shape, coronal holes, polar
field, spots fading at minimum). In eclipse mode `behindMoon()` hides whatever lies in front of the disc.
GLSL note: `filter` is a reserved word in GLSL ES 3.0 - don't use it as a name.

## Published

DEX site: `dex-2dphys.github.io/tools/sun/` (index.html = SunTextbook.html, plus this source).
After edits: rebuild, then copy index.html, src/, template.html, build.js into the repo.

## One table, three uses

The solar-model table in `model.js` feeds the cut-face temperature map (as uniforms), the hover
read-out, and the textbook's profile charts and data sheet, so they cannot disagree.

## Not to scale (stated in the Contents chapter)

Rotation ≈ 24 000× real time at speed 1; granulation on its own clock; chromosphere ≈ 2× too thick;
corona brightened ~10⁶× and faded out near the surface; wind view: distances beyond 3 R☉ compressed
(Earth at 21.5 instead of 215 R☉), Earth ≈ 30× too large. White light is slightly warmed (the Sun is white).

## URL parameters (testing)

`?view=` overview | interior | core | convection | photosphere | sunspots | corona | wind,
`&filter=0|1|2`, `&tmap=1`, `&field=1`, `&cut=1`, `&panel=1`, `&open=<chapter>`, `&cme=1`,
`&cycle=<year 0–11>`, `&nobloom=1`, `&debug=1` (exposes `window.__sun`), `&rot0=<rad>` (initial rotation; default -1.05 puts the northern active region on the disc), `&clean=1`.
