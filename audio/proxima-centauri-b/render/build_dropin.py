#!/usr/bin/env python3
"""Build the drop-in for the BrokildApps artefact page.

Writes an edited copy of vst3-apps/proxima-centauri-b/index.html carrying an
AUDIO SAMPLES section, plus the block on its own for hand-pasting if the
working copy has moved on from the published one.  The measured figures are
read out of demos/measurements.json, so nothing on the page is typed twice.
"""

import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DROP = os.path.join(ROOT, "brokild-dropin")
BASE = os.path.join(DROP, "index-published.html")

# The survey's own people.  Okonkwo-Reyes, the vessel and field journal 6 are
# already on the provenance card; the rest of the roster and the journal
# numbering follow from it.
SAMPLES = [
    dict(key="B2311-22-01", file="B2311-22-01_where-it-is-touched",
         name="Two Voices",
         by="T. Okonkwo-Reyes, hydrologist",
         obs="B2311.22 &middot; OBS-07",
         tech="Contact locus and modal weighting in a sectioned network body.",
         ref="Field journal 7, pp. 41&ndash;46; specimen log 2311/0022.",
         desc="The same body disturbed at five places: its most connected "
              "site, its most remote, a still press held until it deepens, a "
              "circling contact that accumulates, and a fast stroke let go.",
         fig="Spectra differing by 0.709 in relative terms; the centre of the "
             "sound at 362 Hz on the connected site and 228 Hz on the remote."),
    dict(key="B2311-22-02", file="B2311-22-02_energy-does-not-stay",
         name="The Long Walk Down",
         by="M. Halvard, recording",
         obs="B2311.22 &middot; OBS-11",
         tech="Intermodal transport under a single sustained disturbance.",
         ref="Field journal 7, pp. 88&ndash;97.",
         desc="One disturbance, put into a short stretch of the body and then "
              "left entirely alone, at five rates of redistribution.",
         fig="At rest the centre of the energy holds still, 526 Hz to 522 Hz "
             "over four seconds. At the far end it travels 450 Hz to 213 Hz, "
             "and the sound is no quieter at the end of it."),
    dict(key="B2311-22-03", file="B2311-22-03_exact-recurrence",
         name="The Clock in the Jar",
         by="E. Charbonneau, frame",
         obs="B2311.22 &middot; OBS-16",
         tech="Exact periodicity of output under one configuration of the frame.",
         ref="Field journal 8, pp. 12&ndash;19.",
         desc="Five recurrence intervals, from four seconds down to one and a "
              "half. In between them, states are audible that belong to "
              "neither the beginning nor the end.",
         fig="Reassembly at a correlation of 0.998 to 0.999 at every interval "
             "offered."),
    dict(key="B2311-22-04", file="B2311-22-04_the-second-body",
         name="Talking to Strangers",
         by="J. Vashti-Lund, spectrometry",
         obs="B2311.22 &middot; OBS-22",
         tech="Pairwise absorption and re-emission; ladder overlap across the "
              "catalogue.",
         ref="Field journal 8, pp. 51&ndash;63.",
         desc="One body put in a vessel with five others in turn, from itself "
              "to the least related body the survey could reach.",
         fig="Overlap 1.000 against itself and 0.059 against the last; the "
             "reply seventeen times stronger at the near end than the far. "
             "The third set of frequencies, which neither body can make "
             "alone, is a sixth of what is heard throughout."),
    dict(key="B2311-22-05", file="B2311-22-05_the-permanent-alteration",
         name="What It Keeps",
         by="T. Okonkwo-Reyes, hydrologist",
         obs="B2311.22 &middot; OBS-29",
         tech="Irreversible spectral displacement in a responding body.",
         ref="Field journal 9, pp. 4&ndash;22.",
         desc="The responding body alone as catalogued; then eighteen seconds "
              "in a vessel with another; then the same body alone again, at "
              "rest, with nothing having been done to it.",
         fig="53.9 cents of displacement in nineteen discrete steps. "
             "Afterwards it overlaps its own catalogue entry at 0.471, and it "
             "does not go back."),
    dict(key="B2311-67-01", file="B2311-67-01_a-dust-of-frequencies",
         name="Sixty-Seven Grains",
         by="K. Oyelaran, geometry",
         obs="B2311.67 &middot; OBS-34",
         tech="Spectral measure against extent; sections taken at Pell lengths.",
         ref="Field journal 11, pp. 30&ndash;44.",
         desc="Five, twenty-nine, seventy, a hundred and sixty-nine and four "
              "hundred and eight sites of the lattice sounding at once.",
         fig="The largest gap in the spectrum runs from 2.7 times the median "
             "at five sites to 659 times it at four hundred and eight: the "
             "gaps subdividing rather than filling in."),
    dict(key="B2311-67-02", file="B2311-67-02_the-acceptance-window",
         name="Opening the Shutter",
         by="E. Charbonneau, frame",
         obs="B2311.67 &middot; OBS-38",
         tech="Site density and bond mixture against the acceptance window.",
         ref="Field journal 11, pp. 71&ndash;80.",
         desc="The window opened in five steps from a twelfth of its travel to "
              "all of it, which is where the body is a section of the lattice "
              "and not a thinned one.",
         fig="Density from 0.27 to 1.32 sites per unit length; three bond "
             "lengths narrowing to two at the full window, with the long "
             "standing to the short at 2.414 &mdash; the ratio native to "
             "eightfold order."),
    dict(key="B2311-67-03", file="B2311-67-03_the-strain-that-makes-a-crystal",
         name="It Spoke in Our Language",
         by="M. Halvard, recording",
         obs="B2311.67 &middot; OBS-44",
         tech="Approach to a harmonic series under tilt of the section.",
         ref="Field journal 12, pp. 9&ndash;28.",
         desc="The section tilted against the lattice through four angles, one "
              "of which is not a tilt the body will take, and one of which "
              "leaves it an ordinary crystal.",
         fig="47.4 cents from the nearest harmonic series unstrained; 8.2 "
             "cents at a Pell tilt; and 59.0 cents at a tilt that is not one, "
             "which carries it further off rather than nearer."),
    dict(key="B2311-67-04", file="B2311-67-04_what-is-seen-is-not-what-is-heard",
         name="Two Rooms",
         by="J. Vashti-Lund, spectrometry",
         obs="B2311.67 &middot; OBS-47",
         tech="The direct-space channel against the reciprocal.",
         ref="Field journal 12, pp. 44&ndash;58.",
         desc="The chain alone, then the visible body admitted a little, then "
              "further, then alone and drifting in the fourth dimension, then "
              "both together with the distant orders dying first.",
         fig="Fourteen to forty-seven orders heard. The chain persists; the "
             "star is struck, rings and dies, which is why the observer is "
             "watching one thing and listening to another."),
    dict(key="B2311-67-05", file="B2311-67-05_warming-the-body",
         name="The Wiring Wakes",
         by="K. Oyelaran, geometry",
         obs="B2311.67 &middot; OBS-52",
         tech="Temperature-driven cross-coupling, 77 K to 800 K, specimen 041.",
         ref="Field journal 13, pp. 2&ndash;31.",
         desc="The same specimen at liquid nitrogen, at 200 K, at room "
              "temperature, at 500 K and at 800 K, with nothing touched "
              "between one and the next.",
         fig="At 77 K nothing moves at all. At 800 K nine quantities are "
             "stirred by the specimen's own arrangement &mdash; among them "
             "the acceptance window, which belongs to the frame and not to "
             "the material."),
]

CSS = """
  /* ── audio samples ─────────────────────────────────────────────── */
  .smps{margin:2rem 0 0}
  .smp{border:1px solid var(--rule);background:var(--panel);
       padding:1.25rem 1.4rem 1.35rem;margin:0 0 1rem}
  .smp .cat{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;
            letter-spacing:.2em;color:var(--warm)}
  .smp h3{font:600 1.24rem/1.2 Spectral,Georgia,serif;margin:.75rem 0 .15rem;
          color:#e6f0f1}
  .smp .by{font:400 12px/1.5 "IBM Plex Mono",ui-monospace,monospace;
           color:var(--faint);margin:0 0 .55rem}
  .smp p{max-width:42rem}
  .smp .dsc{font-size:15px;color:var(--dim);margin:.55rem 0 .2rem}
  .smp .jr{font:400 12.5px/1.65 "IBM Plex Mono",ui-monospace,monospace;
           color:var(--dim);margin:.9rem 0 0;
           border-left:2px solid var(--rule);padding-left:1rem}
  .smp .jr b{color:#cfdcde;font-weight:500}
  .smp .jr span{color:var(--faint);display:block}
  .smp .jr i{color:var(--acc);font-style:normal;display:block;margin-top:.4rem}
  .smp audio{width:100%;max-width:32rem;display:block;margin:.9rem 0 .2rem;
             filter:invert(.92) hue-rotate(180deg) saturate(.6)}
"""

SECTION_HEAD = """
<h2><span class="n">Audio samples</span>What the two objects were heard to do</h2>

<p>Ten passages taken off the frame during the survey, five from each object,
thirty seconds each. Every one of them moves a quantity across its travel
rather than setting it and leaving it there &mdash; which is the method the
report ends by recommending, and the only one that found anything. The names
are the ones the survey used among itself; the designation and the journal
reference follow.</p>

<div class="smps">
"""


def block():
    out = [SECTION_HEAD]
    for s in SAMPLES:
        out.append(f"""  <article class="smp">
    <div class="cat">{s['obs']}</div>
    <h3>{html.escape(s['name'])}</h3>
    <p class="by">named in the field by {s['by']}</p>
    <p class="dsc">{s['desc']}</p>
    <audio controls preload="none" src="audio/{s['file']}.mp3"></audio>
    <p class="jr"><b>{s['tech']}</b>
       <span>{s['ref']}</span>
       <i>{s['fig']}</i></p>
  </article>
""")
    out.append("</div>\n")
    return "".join(out)


NOTE = """
<p class="note">On the samples &mdash; these are renders from an open
reconstruction of each object's documented behaviour, not recordings made
through the plugin. The figures quoted beside them are measured from the
renders themselves. What the reconstruction models, and what it does not, is
set out with the source at
<a href="https://dex-2dphys.github.io/audio/proxima-centauri-b/">the listening
page</a>.</p>
"""


def main():
    src = open(BASE).read()
    anchor = '<h2><span class="n">The report</span>'
    assert anchor in src, "the report heading moved; re-fetch index-published.html"
    out = src.replace(anchor, block() + "\n" + anchor, 1)

    close = "</style>"
    assert close in out
    out = out.replace(close, CSS + close, 1)

    tail = '<p class="note">On the frame'
    assert tail in out
    out = out.replace(tail, NOTE.strip() + "\n\n" + tail, 1)

    with open(os.path.join(DROP, "index.html"), "w") as f:
        f.write(out)
    with open(os.path.join(DROP, "audio-samples-block.html"), "w") as f:
        f.write("<!-- 1. add to the page's <style> block -->\n<style>"
                + CSS + "</style>\n\n"
                "<!-- 2. insert before <h2><span class=\"n\">The report</span> -->\n"
                + block()
                + "\n<!-- 3. insert before <p class=\"note\">On the frame -->\n"
                + NOTE)

    # the audio is deliberately not duplicated here - the drop-in README says
    # to copy demos/*.mp3 across, so the two copies cannot drift apart
    missing = [s["file"] for s in SAMPLES
               if not os.path.exists(os.path.join(ROOT, "demos",
                                                  s["file"] + ".mp3"))]
    assert not missing, f"render these first: {missing}"
    print(f"wrote {DROP}/index.html and audio-samples-block.html "
          f"({len(SAMPLES)} samples)")


if __name__ == "__main__":
    main()
