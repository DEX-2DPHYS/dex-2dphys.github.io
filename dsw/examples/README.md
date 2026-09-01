# DSW example plugins

Six research plugins for the Digital Science Workstation, plus the analysis
scripts used to check them. Everything here is **source**: build a bundle and
put it in your plugin library, or read it as a worked example of the plugin
ABI.

## These are deliberately NOT built-ins

They live under `examples/`, not under `dsw/plugins/`, and the host does not
scan this folder. That is on purpose. **Bundle ids must be unique across the
built-in root and your library, and built-ins win** - so a copy left in
`dsw/plugins/` silently shadows the one you are editing in your library, and
you get to debug a plugin whose source is not the source being loaded.

To use one, copy the folder into your library (default `Documents/DSW Plugins`,
repointable from the launcher) and build it there.

## The plugins

| bundle | what it does | licence |
|---|---|---|
| `graphene-md` | Molecular dynamics of a 2D sheet on a substrate. Toy Morse engine **or real LAMMPS** (AIREBO, ExTeP, REBO-MoS2, Stillinger-Weber) chosen from a dropdown, plus a LAMMPS input-deck exporter. Lift cycles, blisters, adhesion. | **GPL-2.0-or-later** (see `NOTICE.md`) |
| `graphene-md-gpu` | OpenCL port of the toy Morse engine. Same panel, no LAMMPS linkage. | MIT |
| `moire-bubble` | Two live layers on a rigid substrate with a gas pocket between them or below the pair. Free peel front, registry and atomic-strain readout - for twisted bubbles. | MIT |
| `moire-bubble-tb-v1` | The same, carrying four twisted-bubble presets. | MIT |
| `graphene-phonons` | Honeycomb lattice vibrations: Morse or harmonic bonds, second-neighbour shear springs, optional bond breaking and healing. | MIT |
| `superlubricity` | Lennard-Jones interlayer energetics and moire lateral MD - stacking energy against twist and translation. | MIT |

## Building a bundle

No CMake needed for the MIT ones. With a MinGW g++ (or MSVC equivalent):

```
g++ -shared -std=c++17 -O3 -ffast-math -fopenmp -static -static-libgcc     -static-libstdc++ -o <id>.dll src/plugin.cpp -Isrc
```

`-static` matters: it leaves the DLL depending only on KERNEL32 and the system
UCRT, so there is nothing to ship alongside it. A MinGW-built plugin loads fine
in the MSVC-built host - the ABI is plain C and the host never frees plugin
memory, so there is no CRT boundary to cross.

`graphene-md` needs `liblammps` and uses its `CMakeLists.txt`. Build it only if
you want the LAMMPS engine; `graphene-md-gpu` gives you the toy model with no
such dependency.

**Stop the host before rebuilding.** A running DSW keeps a plugin's library
loaded once its socket has been opened, and the *link* then fails with
"Permission denied". Reloading a replaced binary needs a host restart anyway.

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

Two traps worth knowing before you trust a number from these: the frame magic
differs per plugin (`GMD1`, `GPH1`, `MBL1`) and **the host prefixes 12 bytes**,
so sniff the magic at offset 0 *and* 12; and height exaggeration must scale the
deviation from the reference plane, never absolute z, or a 3.35 A interlayer
gap draws as 10 A.

## The report

`../docs/blisters-2d-materials.pdf` - blisters, bubbles and protrusions in 2D
materials: what the toy model gets right, what LAMMPS adds, how the pressure is
actually implemented and where that approximation bites, and a fully commented
LAMMPS deck as an appendix. The LaTeX source is beside it.
