#!/usr/bin/env python3
"""Build the listening page from measurements.json.

Every figure on the page is read out of the render log rather than typed in,
so the page cannot drift away from the audio it describes.
"""

import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEMOS = os.path.join(ROOT, "demos")

TITLE = {
    "B2311-22-01": ("Where it is touched",
                    "B2311-22-01_where-it-is-touched",
                    "The same body, five contacts. It is not struck like a bell "
                    "but joined like a network, so the sound is a property of "
                    "which part is being asked to move."),
    "B2311-22-02": ("Energy does not stay where it is put",
                    "B2311-22-02_energy-does-not-stay",
                    "METABOLISM from nothing to full. One disturbance, put into "
                    "a short stretch of the ladder, and then left alone."),
    "B2311-22-03": ("Exact recurrence",
                    "B2311-22-03_exact-recurrence",
                    "REVIVAL. Under one configuration of the frame the output "
                    "becomes periodic - not approximately."),
    "B2311-22-04": ("The second body",
                    "B2311-22-04_the-second-body",
                    "CONVERSE, against five partners from the catalogue. It "
                    "absorbs only at the frequencies it itself possesses."),
    "B2311-22-05": ("The permanent alteration",
                    "B2311-22-05_the-permanent-alteration",
                    "PLASTICITY. The responding body before the exchange, "
                    "during it, and afterwards at rest."),
    "B2311-67-01": ("A dust of frequencies",
                    "B2311-67-01_a-dust-of-frequencies",
                    "EXTENT through the Pell numbers. How much of the body "
                    "sounds, and what happens to the gaps as it grows."),
    "B2311-67-02": ("The acceptance window",
                    "B2311-67-02_the-acceptance-window",
                    "APERTURE from a twelfth of the window to all of it. How "
                    "dense the matter, and what mixture it is."),
    "B2311-67-03": ("The strain that makes a crystal",
                    "B2311-67-03_the-strain-that-makes-a-crystal",
                    "OBLIQUITY. Tilting the section against the lattice, which "
                    "is the classical route by which an ordered aperiodic body "
                    "becomes an ordinary one."),
    "B2311-67-04": ("What is seen is not what is heard",
                    "B2311-67-04_what-is-seen-is-not-what-is-heard",
                    "ASPECT, with ORDERS, WINDOW, PRECESSION and EXTINCTION. "
                    "The chain persists; the star is struck, rings and dies."),
    "B2311-67-05": ("Warming the body",
                    "B2311-67-05_warming-the-body",
                    "TEMPERATURE from liquid nitrogen to 800 K on specimen 041. "
                    "Held cold its quantities are independent. Warmed, they "
                    "begin to drive one another."),
}

ORDER = list(TITLE)


def fmt(v):
    if isinstance(v, dict):
        return ", ".join(f"{k} {x}" for k, x in v.items() if x)
    if isinstance(v, bool):
        return "yes" if v else "no"
    return str(v)


def main():
    rows = json.load(open(os.path.join(DEMOS, "measurements.json")))
    by = {}
    for r in rows:
        by.setdefault(r["demo"], []).append(r)

    out = {"22": [], "67": []}
    for key in ORDER:
        name, stem, blurb = TITLE[key]
        recs = by.get(key, [])
        pre = [r for r in recs if r["section"] in ("catalogue", "wiring")]
        secs = [r for r in recs if r not in pre]
        obj = "B2311.22" if "-22-" in key else "B2311.67"
        blk = out["22" if "-22-" in key else "67"]
        blk.append(f'<article class="demo" id="{key}">')
        blk.append(f'<div class="rec">{key} &middot; {obj}</div>')
        blk.append(f"<h3>{html.escape(name)}</h3>")
        blk.append(f"<p class=\"blurb\">{html.escape(blurb)}</p>")
        if pre:
            d = {k: v for k, v in pre[0].items() if k not in ("demo", "section")}
            blk.append('<p class="pre">' + " &middot; ".join(
                f"{html.escape(k.replace('_', ' '))} <b>{html.escape(fmt(v))}</b>"
                for k, v in d.items()) + "</p>")
        blk.append(f'<audio controls preload="none" '
                   f'src="demos/{stem}.mp3"></audio>')
        blk.append('<ol class="sections">')
        for j, r in enumerate(secs[:5]):
            d = {k: v for k, v in r.items() if k not in ("demo", "section")}
            t = f"0:{j * 6:02d}"
            meas = " &middot; ".join(
                f"{html.escape(k.replace('_', ' '))} <b>{html.escape(fmt(v))}</b>"
                for k, v in d.items() if fmt(v))
            blk.append(f'<li><span class="t" data-src="demos/{stem}.mp3" '
                       f'data-at="{j * 6}">{t}</span>'
                       f'<span class="lab">{html.escape(r["section"])}</span>'
                       f'<span class="m">{meas}</span></li>')
        blk.append("</ol></article>")

    page = (TEMPLATE.replace("{{DEMOS_22}}", "\n".join(out["22"]))
                    .replace("{{DEMOS_67}}", "\n".join(out["67"])))
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(page)
    print("wrote", os.path.join(ROOT, "index.html"))


TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proxima Centauri b &mdash; audio demonstrations</title>
<meta name="description" content="Five thirty-second demonstrations for each
of the two recovered artefacts B2311.22 and B2311.67, rendered from an open
reconstruction of the behaviour set out in the field findings.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,600;1,300&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#07090b; --panel:#0c1013; --rule:#1c2429;
         --text:#c6d1d4; --dim:#8ba0a4; --faint:#5b6f74;
         --acc:#7ee2d0; --warm:#e0955f; }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--ink);color:var(--text);
       font:300 16.5px/1.72 Spectral,Georgia,serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:62rem;margin:0 auto;padding:0 1.6rem}
  a{color:var(--acc)}
  nav{border-bottom:1px solid var(--rule);position:sticky;top:0;z-index:5;
      background:rgba(7,9,11,.92);backdrop-filter:blur(8px)}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;
            padding:.85rem 1.6rem;
            font:500 12px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.16em}
  nav a{text-decoration:none;color:var(--dim)}
  nav .brand{color:var(--acc)}
  header{padding:3.6rem 0 0}
  .rec{font:500 11.5px/1 "IBM Plex Mono",ui-monospace,monospace;
       letter-spacing:.26em;color:var(--acc);text-transform:uppercase}
  h1{font:600 clamp(2rem,5.4vw,3.2rem)/1.06 Spectral,Georgia,serif;
     margin:1rem 0 .6rem;letter-spacing:-.02em;color:#e6f0f1}
  .sub{font:300 italic clamp(1.02rem,2.3vw,1.24rem)/1.5 Spectral,Georgia,serif;
       color:var(--dim);margin:0;max-width:40rem}
  h2{font:600 1.5rem/1.25 Spectral,Georgia,serif;margin:3.4rem 0 .6rem;color:#e2ecee}
  h2 .n{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.24em;
        color:var(--acc);display:block;margin-bottom:.7rem;text-transform:uppercase}
  h3{font:600 1.24rem/1.25 Spectral,Georgia,serif;margin:.75rem 0 .3rem;color:#e6f0f1}
  p{max-width:42rem}
  .lede{font-size:1.12rem;color:#d6e0e2;max-width:42rem}
  .caution{border-left:2px solid var(--warm);padding:.1rem 0 .1rem 1.15rem;
           margin:2rem 0;max-width:42rem;
           font:400 13.5px/1.62 "IBM Plex Mono",ui-monospace,monospace;color:var(--dim)}
  .caution b{color:var(--warm);font-weight:500}
  .demo{border:1px solid var(--rule);background:var(--panel);
        padding:1.4rem 1.5rem 1.5rem;margin:1.1rem 0}
  .blurb{font-size:15.5px;color:var(--dim);margin:.4rem 0 .9rem}
  .pre{font:400 12px/1.7 "IBM Plex Mono",ui-monospace,monospace;
       color:var(--faint);margin:0 0 .9rem;max-width:none}
  .pre b,.m b{color:var(--acc);font-weight:500}
  audio{width:100%;max-width:34rem;display:block;margin:.2rem 0 1rem;
        filter:invert(.92) hue-rotate(180deg) saturate(.6)}
  ol.sections{list-style:none;margin:0;padding:0;
              font:400 12.5px/1.6 "IBM Plex Mono",ui-monospace,monospace}
  ol.sections li{display:grid;grid-template-columns:3.4rem minmax(9rem,15rem) 1fr;
                 gap:.2rem .9rem;padding:.42rem 0;border-top:1px solid var(--rule);
                 align-items:baseline}
  ol.sections li:first-child{border-top:0}
  .t{color:var(--warm);cursor:pointer;text-decoration:underline dotted}
  .t:hover{color:#ffd4ae}
  .lab{color:#cfdcde}
  .m{color:var(--faint)}
  @media (max-width:44rem){
    ol.sections li{grid-template-columns:3.4rem 1fr}
    .m{grid-column:1 / -1;padding-left:0}
  }
  table{border-collapse:collapse;margin:1.2rem 0;width:100%;max-width:42rem;
        font:400 13px/1.5 "IBM Plex Mono",ui-monospace,monospace;
        font-variant-numeric:tabular-nums}
  th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--rule);
        vertical-align:top}
  th{color:var(--dim);font-weight:500;letter-spacing:.12em;font-size:11px;
     text-transform:uppercase;border-bottom-color:#2c383e}
  td:first-child{color:var(--acc);white-space:nowrap}
  footer{font:400 12px/1.7 "IBM Plex Mono",ui-monospace,monospace;color:var(--faint);
         margin:3.4rem 0 5rem;max-width:42rem}
</style>
</head>
<body>
<nav><div class="wrap">
  <span class="brand">FIELD RECORD B2311</span>
  <a href="https://peterboggild.github.io/BrokildApps/vst3-apps/proxima-centauri-b/">The artefacts &rarr;</a>
</div></nav>

<div class="wrap">
<header>
  <div class="rec">Ten demonstrations &middot; thirty seconds each</div>
  <h1>Proxima Centauri b &mdash; what the two objects sound like</h1>
  <p class="sub">Five demonstrations for each recovered artefact. Every one of
  them moves something rather than setting it, because that is the method the
  survey recommends and the only one that found anything.</p>
</header>

<p class="lede">Neither object has controls and neither has an off state. What
follows is not a tour of settings; it is five sounds per demonstration, six
seconds each, with one quantity on the frame carried from one end of its travel
to the other while the object is listened to.</p>

<div class="caution">
  <b>What these recordings are.</b> They were not captured from the Windows
  plugins. The plugins are Windows VST3 binaries and could not be run here, so
  the behaviour set out in the field findings was rebuilt from the physics the
  report describes &mdash; a graph-Laplacian network for B2311.22, a
  cut-and-project quasiperiodic chain for B2311.67 &mdash; and rendered
  offline. The parameter names are the plugins' own, read out of the shipped
  binaries. The figures printed beside each section are measured off the
  rendered audio and the rendered ladders, not copied from the report. Treat
  them as a faithful demonstration of the documented behaviour, not as a
  recording of the objects.
</div>

<h2><span class="n">B2311.22</span>Kell Rille &mdash; a body whose sound is its own connectedness</h2>
<p>Sites in a four-dimensional body, of which only a slab is present in the
section; the sites that are present are joined to their neighbours; and what is
heard is that network of joins ringing. The ladder is the square root of the
spectrum of the graph Laplacian, which is why there is no octave in it and no
harmonic ladder. Every specimen in the reconstruction is held at least twenty
cents from any harmonic series, as the catalogue records.</p>

{{DEMOS_22}}

<h2><span class="n">B2311.67</span>Sabik Terminator &mdash; a lattice that is ordered and never repeats</h2>
<p>A line cut through a square lattice at the eightfold slope, with an
acceptance window: the standard construction for an ordered aperiodic body, and
the reason the lengths at which the structure repeats its own logic come out as
the Pell numbers 5, 12, 29, 70, 169, 408 and nothing else. What is heard is that
chain of sites vibrating &mdash; masses on bonds, two bond lengths in the silver
ratio, solved exactly. Its spectrum is neither separated tones nor a continuum
but the third thing.</p>

{{DEMOS_67}}

<h2><span class="n">The frame</span>Where the names come from</h2>
<p>Every quantity named on this page is an expedition quantity, read out of the
shipped plugin binaries: eighteen on the B2311.22 rail, and forty rings in eight
rosettes of five on B2311.67. The names describe what the apparatus does to the
objects, not any faculty the objects possess.</p>

<footer>
  Rendered by <code>render/render_demos.py</code>; the two reconstructions are
  <code>render/artefact22.py</code> and <code>render/artefact67.py</code>, and
  the shared synthesis and measurement machinery is <code>render/common.py</code>.
  Measurements in <code>demos/measurements.json</code>. Thirty seconds each,
  44.1 kHz, levelled to &minus;14 dBFS.
  <br><br>
  The objects, the field findings and the plugins are Peter B&oslash;ggild's
  &mdash; <a href="https://peterboggild.github.io/BrokildApps/vst3-apps/proxima-centauri-b/">Proxima Centauri B findings</a>.
</footer>
</div>

<script>
/* the timings are clickable: they seek the demonstration's own player */
document.addEventListener("click", function (e) {
  var t = e.target.closest(".t");
  if (!t) return;
  var a = t.closest("article").querySelector("audio");
  if (!a) return;
  a.currentTime = parseFloat(t.dataset.at || "0");
  a.play();
});
/* one at a time */
document.addEventListener("play", function (e) {
  document.querySelectorAll("audio").forEach(function (a) {
    if (a !== e.target) a.pause();
  });
}, true);
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
