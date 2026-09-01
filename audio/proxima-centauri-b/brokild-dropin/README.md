# Drop-in for the BrokildApps artefact page

An **AUDIO SAMPLES** section for
`peterboggild/BrokildApps` → `vst3-apps/proxima-centauri-b/index.html`,
carrying the ten demonstrations under the names the survey used, with the
designation and journal reference after each.

This session could not attach the BrokildApps repository — adding it was
blocked by the permission classifier, for push and for read alike — so the
edit is prepared here instead of pushed there.

## Applying it

```
# from the BrokildApps working copy
cp <this>/index.html                     vst3-apps/proxima-centauri-b/index.html
mkdir -p                                 vst3-apps/proxima-centauri-b/audio
cp <this>/../demos/*.mp3                 vst3-apps/proxima-centauri-b/audio/
```

That is the whole change: one page, and ten files in a new `audio/` folder
beside it (6.0 MB).

## Files

| file | what it is |
|---|---|
| `index.html` | the artefact page with the section in it, ready to drop in |
| `index-published.html` | the page exactly as published on 2026-09-01, for reference |
| `audio-samples-block.html` | the same change as three paste-able pieces, if the working copy has moved on |
| — | the audio itself lives in `../demos/`; it is not duplicated here so the two copies cannot drift |

`index.html` is **purely additive** against the published page: 142 lines added,
none removed. The three insertions are

1. the `.smp` rules at the end of the existing `<style>` block,
2. the section, immediately before `<h2><span class="n">The report</span>`,
3. one `<p class="note">`, immediately before the existing `On the frame` note.

Rebuild it with `python3 ../render/build_dropin.py`. The sample names, the
designations and the journal references live in `SAMPLES` at the top of that
script, so they are edited in one place.

## The samples, as named

### B2311.22 — Kell Rille, specimen log 2311/0022

| given name | designation | journal |
|---|---|---|
| Two Voices | `B2311.22 · OBS-07` — contact locus and modal weighting | fj. 7, 41–46 |
| The Long Walk Down | `B2311.22 · OBS-11` — intermodal transport under sustained disturbance | fj. 7, 88–97 |
| The Clock in the Jar | `B2311.22 · OBS-16` — exact periodicity under one frame configuration | fj. 8, 12–19 |
| Talking to Strangers | `B2311.22 · OBS-22` — pairwise absorption and re-emission; ladder overlap | fj. 8, 51–63 |
| What It Keeps | `B2311.22 · OBS-29` — irreversible spectral displacement in a responding body | fj. 9, 4–22 |

### B2311.67 — Sabik Terminator, specimen log 2311/0067

| given name | designation | journal |
|---|---|---|
| Sixty-Seven Grains | `B2311.67 · OBS-34` — spectral measure against extent, at Pell lengths | fj. 11, 30–44 |
| Opening the Shutter | `B2311.67 · OBS-38` — site density and bond mixture against the window | fj. 11, 71–80 |
| It Spoke in Our Language | `B2311.67 · OBS-44` — approach to a harmonic series under tilt | fj. 12, 9–28 |
| Two Rooms | `B2311.67 · OBS-47` — the direct-space channel against the reciprocal | fj. 12, 44–58 |
| The Wiring Wakes | `B2311.67 · OBS-52` — temperature-driven cross-coupling, 77–800 K | fj. 13, 2–31 |

Names are attributed to five of the survey's people, two apiece —
T. Okonkwo-Reyes (hydrologist, who lifted B2311.22 and is already on the
provenance card), M. Halvard (recording), E. Charbonneau (frame),
J. Vashti-Lund (spectrometry) and K. Oyelaran (geometry). Journal numbering
continues from the card's own `Field journal 6, pp. 210–214`: journals 7–9 for
the Kell Rille work, 11–13 for Sabik, which recovery day 204 leaves room for.

## The one line that is not in character

Insertion 3 is a plain note saying the samples are renders from an open
reconstruction rather than recordings made through the plugin. It is there so
nobody downloads the VST3 expecting these exact voices. It is one paragraph and
deleting it changes nothing else on the page.
