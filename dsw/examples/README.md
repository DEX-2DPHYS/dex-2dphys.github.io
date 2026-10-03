# DSW examples: analysis scripts

The research plugins that used to live here as source are now built-ins in
`dsw/plugins/` (2DMD, Graphene MD (GPU), Graphene Lattice Vibrations, Structural
Superlubricity, Klein Magnetometer Workbench, Graphene Transport Explorer, EBL
Workbench), built for Windows, macOS and Linux by CI. What remains here are the
scripts used to check them.

## analysis/

Probe and analysis scripts, mostly used to check that the plugins agree with
LAMMPS and with textbook membrane mechanics.

Testing a plugin needs no browser: a script that hand-rolls the WebSocket
upgrade against `ws://127.0.0.1:8090/ws/<id>` can drive the whole UI vocabulary
and assert on the replies. Binary `DXF1` frames can be written straight to PNG.

* `probe-*.js`, `stepprobe.js`, `cyclerun.js` - drive a plugin and assert
* `gasconfirm.js`, `gassweep.js`, `gastest.js` - blister pressure and volume,
  compared against the Hencky solution
* `registry.py`, `strain.py` - commensurate-site registry and per-atom strain
  from a geometry frame
* `bilayer_analysis.py`, `moire_bubble_analysis.py` - twisted-bubble analysis
* `moviecap*.js`, `makemovies.py`, `*_movie.py`, `movierender.py` - frame
  capture and rendering
* `patch_deck.py` - post-process an exported LAMMPS deck

Some of these were written for plugins that have since been folded into 2DMD
(`graphene-md`, `moire-bubble`); they are kept as the record of how the numbers
in the report were obtained.

Two traps worth knowing before you trust a number from these: the frame magic
differs per plugin (`2DM1`, `GMD1`, `GPH1`) and **the host prefixes 12 bytes**,
so sniff the magic at offset 0 *and* 12; and height exaggeration must scale the
deviation from the reference plane, never absolute z, or a 3.35 A interlayer
gap draws as 10 A.

## The report

`../docs/blisters-2d-materials.pdf` - blisters, bubbles and protrusions in 2D
materials: what the toy model gets right, what LAMMPS adds, how the pressure is
actually implemented and where that approximation bites, and a fully commented
LAMMPS deck as an appendix. The LaTeX source is beside it.

## A warning about paths

These are working research scripts, published as they were run. Several of them
have the author's own directories baked in (output folders, the `run-*.sh`
drivers). Expect to edit those before running anything.
