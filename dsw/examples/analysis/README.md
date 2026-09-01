# DSW comparison tooling

Scripts for driving a DSW plugin over its WebSocket, exporting LAMMPS decks,
running them, and rendering comparison figures and movies. Written for
`graphene-md` / `graphene-md-gpu` but the WebSocket parts are generic.

They live here rather than in a session scratchpad because a scratchpad dies
with the session and every one of these encodes a bug that cost real time to
find. Read `../SESSION-PROGRESS-2026-08-29.md` for the measured results and
`../Plugins/CONVERSION-LOG.md` for the physics notes.

## Prerequisites

- `dsw.exe` running (from `dex-2dphys.github.io/dsw/`, serves 127.0.0.1:8090)
- node (any recent version; no npm packages needed — the WebSocket client is
  hand-rolled)
- python with numpy + matplotlib: `00 VSCODE/.venv/Scripts/python.exe`
- ffmpeg: `C:\ffmpeg\bin\ffmpeg.exe`
- LAMMPS: `C:/Users/pbog/b/lammps/build/lmp.exe`, with the MinGW bin dir on
  PATH or it exits 127 silently

## The scripts

| script | what it does |
|---|---|
| `cyclerun.js` | build a sheet, arm the lift, export the deck, run the full ramp-hold-return, capture geometry at peak and end, write `*-timing.json` |
| `moviecap.js` | same but captures a frame every 10 steps for a movie, stepping deterministically |
| `makemovies.py` | render four movies + a synchronised 2x2 quad, one shared camera/colour scale/step grid |
| `movierender.py` | render a single dataset (superseded by `makemovies.py`, kept for one-offs) |
| `render_both.py` | the plugin-vs-LAMMPS still figure (height maps + centre profiles) |
| `patch_deck.py` | set threads / run length / dump cadence on an exported deck |
| `stepprobe.js` | diagnostic: does `{t:"step"}` actually advance the session? |
| `edgetest.cpp` | unit-ish check of the exporter's edge-group emission |

### Typical use

```bash
# one engine, full cycle, with timings and a deck
node cyclerun.js classic 50 60 "<outdir>" classic
node cyclerun.js lammps  50 60 "<outdir>" airebo     # AIREBO via embedded LAMMPS

# run the exported deck in stock LAMMPS
python patch_deck.py "<outdir>" 18 2600
cd "<outdir>" && OMP_NUM_THREADS=18 lmp.exe -in run.in > lmp-out.txt 2>&1

# movies (default 12 nm build)
node moviecap.js graphene-md      classic "<mov>/cap-classic"
node moviecap.js graphene-md-gpu  classic "<mov>/cap-gpu" gpu
node moviecap.js graphene-md      lammps  "<mov>/cap-airebo"
python makemovies.py
```

## Traps these scripts already handle — do not re-learn them

1. **State messages are not a progress signal.** The plugin emits state only
   once `advance()` has accumulated 0.5 s of host time, which under manual
   stepping is ~125 batches. Read the step number out of the **GMD1 frame
   header** instead (`frame`, 4 bytes at payload offset 20).
2. **The host prefixes the plugin payload with `DXF1` + w + h**, so the GMD1
   magic is at byte 0 in-process but byte **12** through the host. Check both.
3. **`{t:"step", n:N}` used to be silently truncated** by the 10 ms budget in
   `advance()` (n = 100 advanced ~3 steps). Fixed in the plugin 2026-08-29;
   `moviecap.js` still re-issues until the target step is reached, which is
   harmless and works against older builds.
4. **`elev on` sets `running = true`**, so the session free-runs until you send
   `{t:"run", on:0}` — frame 0 is not step 0 (98, 124, 59 observed). Always
   record the actual step per frame and align by step number.
5. **The WebSocket reader must keep a chunk LIST.** `Buffer.concat` per chunk
   is O(n^2); the 108 MB export frame makes that unusable.
6. **LAMMPS stdout is block-buffered when redirected.** A redirected run shows
   only the version banner for many minutes while it is perfectly healthy —
   watch `log.lammps` or dump-file growth, never `lmp-out.txt`.
7. **Piping a long background command through `tail` buffers everything** until
   it exits. You will see nothing at all while it runs.
8. **Never let matplotlib pick the camera.** Its 3D axes auto-scale per
   dataset, so a taller sheet silently changes its own view and part of the
   difference you see between engines becomes an artefact of the plotting.
   `makemovies.py` projects by hand and **measures** the view box across every
   dataset at once.
9. **Absolute PotEng is not comparable between engines.** The Morse toy model
   is a bond-strain model with a different zero from AIREBO's cohesive energy.
   Compare energy *changes* and geometry.
