# MD Lab VR (source)

`index.html` is one self-contained file (Three.js 0.170 bundled inline, works offline). It is generated
from this folder - edit `src/`, never the bundle.

## Rebuild and test

```
npm install three@0.170.0 esbuild@0.24.0     # or: MDLAB_NODE_MODULES=/path/to/node_modules node build.js
node build.js                                # writes index.html
node test/physics.test.mjs                   # physics checks (no browser needed)
```

## What it is

A WebXR lab in which the user **builds** a Lennard-Jones system (element, lattice size, FCC crystal or random
gas, density, start temperature - or atom by atom with the Add tool), **runs** it (heat, squeeze, thermostat
on/off, time step, periodic box or hard walls) and **measures** it (T, P, energy per atom, coordination, g(r),
MSD and D, a recordable table with CSV export). Seven guided tasks load ready-made setups.

It runs in three places with one code path:

| Where | How |
|-------|-----|
| Meta Quest, standalone | Open the page in the Quest Browser, press *Enter VR* (needs HTTPS) |
| Quest + PC via **SteamVR** | Link / Air Link / Steam Link / Virtual Desktop -> SteamVR running -> SteamVR *Settings -> Developer -> Set SteamVR as OpenXR runtime* -> open the page in Chrome or Edge (https or `http://localhost`) -> *Enter VR* |
| Desktop | Mouse: drag atoms, orbit, zoom; space = run/pause, 1/2/3 = tools, R = rebuild |

SteamVR is reached through the browser's OpenXR runtime; there is no native OpenVR build.

VR controls: trigger = press UI / use tool, grip = move the experiment (both grips: scale), right stick = target T,
left stick = box size, while holding an atom the stick reels it in/out, A/X = next tool, B/Y = run/pause,
stick click = recentre.

## Layout

- `src/physics.js`  MD engine, reduced LJ units: velocity-Verlet, truncated + shifted potential (r_c = 2.5 sigma),
                    Verlet neighbour list built from a cell list, Berendsen thermostat, periodic box or reflecting walls
                    (pressure from wall impulse), tweezers spring, g(r), MSD, coordination number. Real units for Ne/Ar/Kr/Xe.
- `src/ui.js`       immediate-mode UI drawn on a 2D canvas: a DOM element on the desktop, a texture on a floating
                    panel in VR (controller ray -> canvas pixel).
- `src/plots.js`    the four live plots on a second canvas.
- `src/content.js`  lab tasks and VR set-up help text.
- `src/main.js`     scene, lab room, instanced atoms, controllers, mouse tools, tabs, main loop.
- `test/physics.test.mjs`  energy conservation, ideal-gas pressure (periodic and walls), melting, g(r), speed.

Tested headlessly with Chromium + the Immersive Web Emulation Runtime (session start, ray/UI hit, trigger,
tweezers, thumbsticks, grip). It has not been run on a physical headset from this repository's CI.
