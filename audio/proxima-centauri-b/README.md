# Proxima Centauri b — audio demonstrations

Ten demonstrations, thirty seconds each: five for **B2311.22** (Kell Rille) and
five for **B2311.67** (Sabik Terminator), the two objects in the
[Proxima Centauri B findings](https://peterboggild.github.io/BrokildApps/vst3-apps/proxima-centauri-b/)
collection. Each demonstration is five sounds of six seconds, and in every one
of them a quantity on the frame is carried from one end of its travel to the
other rather than set and left — which is the method the field report
recommends, and the only one it says found anything.

Open `index.html` to listen. The timings beside each section are clickable.

## What these recordings are, and are not

**They were not captured from the plugins.** `Artefact B2311.22.vst3` and
`Artefact B2311.67.vst3` are Windows VST3 binaries; there is no Windows host
here and no way to run them. So the behaviour set out in the field findings was
rebuilt from the physics the report describes and rendered offline:

* **B2311.22** — sites in a four-dimensional body, of which only a slab is
  present in the section; the present sites are joined to their neighbours; the
  ladder is the square root of the spectrum of the weighted graph Laplacian.
  That construction has no octave in it and no harmonic ladder because nothing
  put one there, which is the report's central claim about this object.
* **B2311.67** — a line cut through a square lattice at the eightfold slope,
  with an acceptance window. This is the standard cut-and-project construction
  for an ordered aperiodic body; its natural lengths are the Pell numbers
  5, 12, 29, 70, 169, 408, its two bond lengths stand in the silver ratio
  1 + √2, and the phonon spectrum of masses on those bonds is the third thing
  between a set of tones and a continuum.

**The parameter names are the plugins' own.** They were read out of the shipped
binaries: eighteen on the B2311.22 rail (`APERTURE`, `METABOLISM`, `REVIVAL`,
`MEMBRANE`, `GRAVITY`, `DEPTH`, `WARMTH`, `WAKE`, `TRANSIT`, `SLAB`, `WINCH`,
`GAIN`, `CONVERSE`, `COMMUNION`, `PLASTICITY`, `SIDEREAL`, `SPECIMEN`, `OTHER`)
and forty rings in eight rosettes of five on B2311.67 (`EXTENT`, `CONTRAST`,
`BOND LAW`, `LOSS`, `LOSS TILT`, `OBLIQUITY`, `CUT OFFSET`, `CUT BEARING`,
`TRAVERSE`, `BEARING`, `STATION`, `WALK`, `INCIDENCE`, `ASPECT`, `ORDERS`,
`WINDOW`, `PRECESSION`, `EXTINCTION`, `ORDER DECAY`, `TEMPERATURE`, `HABIT`
and the rest).

**The figures are measured, not asserted.** Every number printed on the page and
in `demos/measurements.json` comes off the rendered audio or the rendered
ladder. Where a measurement lands near the report's own figure that is worth
noting; where it does not, the measured value is what is printed.

Treat the files as a faithful demonstration of the documented behaviour of these
two objects, not as a recording of them.

## The demonstrations

### B2311.22 — Kell Rille

| | | |
|---|---|---|
| 01 | Where it is touched | five contacts on one body: hub, rim, a held press, a circling contact, a fast stroke |
| 02 | Energy does not stay where it is put | `METABOLISM` 0 → 1; the centre of the sound's energy travels while the sound does not die away faster |
| 03 | Exact recurrence | `REVIVAL` at 4.0, 3.0, 2.4, 1.9 and 1.5 s; the sound reassembles itself, measured by autocorrelation |
| 04 | The second body | `CONVERSE` against five partners, ladder overlap 1.000 down to 0.059 |
| 05 | The permanent alteration | `PLASTICITY`: the responding body before, during and after 18 s of exchange |

### B2311.67 — Sabik Terminator

| | | |
|---|---|---|
| 01 | A dust of frequencies | `EXTENT` 5, 29, 70, 169, 408 — a Pell number of sites |
| 02 | The acceptance window | `APERTURE` 0.12 → 1.00; density, bond types and the mixture |
| 03 | The strain that makes a crystal | `OBLIQUITY` through four tilts, one of which does not crystallise |
| 04 | What is seen is not what is heard | `ASPECT` between the chain and the star, with `ORDERS`, `WINDOW`, `PRECESSION`, `EXTINCTION` |
| 05 | Warming the body | `TEMPERATURE` 77 K → 800 K on specimen 041, with the wiring it lets loose |

## Some of what the renders measure

* No B2311.22 specimen in the reconstruction comes within twenty cents of any
  harmonic series; the demonstration specimen measures 43.9 cents away.
* Disturbing one body at its most connected site rather than its most remote
  gives spectra differing by 0.709 in relative terms, and moves the spectral
  centroid from 362 Hz to 228 Hz.
* At `METABOLISM` 0 the centre of the sound's energy stays where it was put
  (526 → 522 Hz over four seconds). At full it travels 450 → 213 Hz, and the
  sound is no quieter at the end for it.
* `REVIVAL` reassembles the sound to a correlation of 0.998–0.999 at every
  period offered.
* Ladder overlap runs from 1.000 for a body against itself to 0.059 for the
  least related pair reached; the reply is 17× stronger for the first than the
  last, and the third set of frequencies is a sixth of what is heard.
* Eighteen seconds of exchange displaces the responding body by 53.9 cents in
  nineteen discrete steps. Afterwards it overlaps its own catalogue entry at
  0.471, and does not move back.
* Tilting B2311.67's section carries it from 47.4 cents off a harmonic series to
  8.2 cents at a Pell tilt — while a tilt of one in three, which is not a Pell
  tilt, goes the other way to 59.0 cents.
* At 77 K the coupling is absent and nothing moves at all. At 800 K nine
  quantities are stirred by the specimen's own wiring, including — for this
  specimen — the acceptance window, which is a quantity of the frame and not of
  the material.

## Rebuilding

```
pip install numpy scipy imageio-ffmpeg
cd render
python3 render_demos.py          # ~4 minutes; writes demos/*.mp3 + measurements.json
python3 build_page.py            # rebuilds index.html from those measurements
```

`render_demos.py NAME` renders one demonstration (e.g. `python3 render_demos.py 67-03`).
The WAVs are deleted after encoding; pass `keep_wav=True` to `encode()` to keep them.

| file | what it is |
|---|---|
| `render/common.py` | additive engine, energy redistribution, the frame's cavity/ceiling/air, and the measurements |
| `render/artefact22.py` | the network body: section, graph Laplacian, contact, revival, the pair, plasticity |
| `render/artefact67.py` | the lattice: cut-and-project, the dynamical matrix, the star, the temperature wiring |
| `render/render_demos.py` | the ten demonstrations |
| `render/build_page.py` | `index.html`, generated from `demos/measurements.json` |

Nothing in this directory is linked from the site's front page; it is a
self-contained listening page.
