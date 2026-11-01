# The Sun – interactive textbook (source)

`../SunTextbook.html` is one self-contained file (Three.js 0.170 bundled inline, works offline from
file://). It is generated from this folder. Built on the same pattern as the salmonella model
(`2026 Interactive Notes/InteractivePresentations/2026 09 29 DTU BOARD/sims/salmonella-src`).

## Rebuild

```
node build.js "../SunTextbook.html"
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

## Virtual reality (WebXR, Meta Quest 2/3) - `src/xr.js`

"Enter VR" (bottom left, and in the panel) appears wherever the browser offers an immersive session:
the Quest Browser opening the published page, or desktop Chrome with Quest Link / Air Link. WebXR
needs https:// or localhost - the file:// copy has no VR. "Passthrough" (Quest 3) puts a 36 cm Sun
in the room.

The scene stays in solar radii; the headset camera sits in a scaled rig (`1 R☉ = x m`, shown on the
wrist panel). Each view has its own scale (`VIEW_M`). Bloom is skipped in VR (the composer cannot
render stereo). The hover read-out becomes the right trigger: `pickRay` in main.js is the same
function the mouse uses.

**Colour: tone mapping + sRGB happen ONCE, on the finished image.** The shaders return linear light;
on screen the OutputPass converts, in VR `xr.render()` draws the scene into a half-float target the
size of the headset framebuffer and a quad in front of the head converts it. Converting each
material on its own (three's chunks in every shader) was tried: the faint additive layers
(chromosphere, corona, loops) come out far too bright over the disc - pink blotches.

**Start-up must not freeze ("Page isn't responding" in the Quest Browser).** The photosphere program
takes ~2.5 s to link even on a desktop GPU, and a first draw that waits for it blocks the page.
`prepare()` in main.js compiles everything with `renderer.compileAsync` (KHR_parallel_shader_compile)
before the first frame, into the composer's target - the only variant the scene ever uses, so an
instrument change never recompiles. `checkShaderErrors` is on only with `?debug=1`.

**LITE** (`glsl.js`): the Quest Browser (user agent) or `?lite=1` - pixel ratio 1, no bloom, an
8-cell granulation search. Chrome on a PC (also in VR through Quest Link) keeps everything.
Fewer fbm octaves were measured (2.5 -> 1.7 s link) and rejected: they blotch the faculae.

**A dark headset = the GPU gave up.** In VR the scene is drawn at `rtScale` of the headset framebuffer
(LITE starts at 55 %, max 80 %; PC max 100 %; `?xrrt=` sets the max) and adapts to the frame rate
(below ~75 % of the session rate: x0.8, down to 30 %). Each eye's viewport is scaled with it - three
sets them in framebuffer pixels. No MSAA in LITE; 8-bit target if the GPU cannot render half float.
The wrist panel shows fps and resolution. `webglcontextlost` shows a notice, stores what it knew
(GPU, mode, resolution, fps) in localStorage `sun.lost` and reloads with `?lite=1&safe=1` (lower start
resolution); the next load reports it. The flat page in LITE lowers its pixel ratio (to 0.5) when slow.

Right stick fly · left stick forward/back world size, sideways snap turn · grip grab the world ·
right trigger read-out · A instrument · B next view (with a fade) · X flare + CME · Y cutaway ·
left trigger listen · stick press: T-map (right), field lines (left). `?xr=vr` starts VR at once,
`?xrscale=0.8` lowers the render resolution if a Quest 2 struggles.

Test without a headset: `node test/xr-emulator.cjs dist/sun.html <outdir>` (Meta's IWER Quest 3
emulator + puppeteer-core; 23 checks incl. "the page never froze", screenshots). iwer@2.7.0 is in `%LOCALAPPDATA%/ulam-build`.

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
