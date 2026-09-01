#!/usr/bin/env python3
"""Assemble the standalone listening record: one file, audio and figures inside.

Everything the page needs is embedded, so it can be published or opened from
anywhere without the demos folder beside it.
"""

import base64
import json
import os

from build_dropin import SAMPLES

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get("ARTIFACT_OUT",
                     os.path.join(HERE, "listening-record.html"))

LAD = json.load(open(os.path.join(HERE, "ladders.json")))
MEAS = json.load(open(os.path.join(ROOT, "demos", "measurements.json")))

SECTIONS = {}
for r in MEAS:
    if r["section"] in ("catalogue", "wiring"):
        continue
    SECTIONS.setdefault(r["demo"], []).append(r["section"])

ALL_TICKS = [(30, "30"), (50, "50"), (70, "70"), (100, "100"), (150, "150"),
             (200, "200"), (300, "300"), (500, "500"), (700, "700"),
             (1000, "1k"), (1500, "1.5k"), (2000, "2k"), (3000, "3k"),
             (5000, "5k"), (8000, "8k")]


def span(d):
    """Each figure gets the axis its own two ladders need, not a shared one."""
    fs = [f for side in ("a", "b") for f, _ in d[side]]
    lo = max(25.0, min(fs) * 0.82)
    hi = min(9000.0, max(fs) * 1.20)
    return lo, hi


def strip(key):
    d = LAD[key]
    LO, HI = span(d)
    ticks = [t for t in ALL_TICKS if LO * 1.04 < t[0] < HI * 0.97]

    def xpos(f):
        import math
        return 100.0 * (math.log(f) - math.log(LO)) / (math.log(HI) - math.log(LO))

    out = ['<svg class="lad" viewBox="0 0 1000 128" preserveAspectRatio="none" '
           'role="img" aria-label="the two ladders this passage compares">']
    for f, _ in ticks:
        x = xpos(f) * 10
        out.append(f'<line class="grid" x1="{x:.1f}" y1="4" x2="{x:.1f}" y2="124"/>')
    out.append('<line class="axis" x1="0" y1="64" x2="1000" y2="64"/>')
    for side, cls, sgn, base in (("a", "up", -1, 61), ("b", "dn", 1, 67)):
        for f, h in d[side]:
            if not (LO <= f <= HI):
                continue
            x = xpos(f) * 10
            y = base + sgn * (54 * (h ** 0.45))
            out.append(f'<line class="{cls}" x1="{x:.1f}" y1="{base}" '
                       f'x2="{x:.1f}" y2="{y:.1f}"/>')
    out.append("</svg>")
    axis = "".join(
        f'<span style="left:{xpos(f):.2f}%">{lab}</span>' for f, lab in ticks)
    return f'''<figure class="fig">
  <div class="ladwrap">{"".join(out)}</div>
  <div class="axis">{axis}<span class="unit" style="left:100%">Hz</span></div>
  <div class="key"><span class="ka">{d['la']}</span><span class="kb">{d['lb']}</span></div>
  <figcaption>{d['cap']}</figcaption>
</figure>'''


def transport(i, key):
    labs = SECTIONS[key]
    cells = "".join(
        f'<button class="cell" data-at="{j * 6}">'
        f'<span class="ix">{j + 1}</span><span class="cl">{s}</span></button>'
        for j, s in enumerate(labs))
    return f'''<div class="tp" data-i="{i}">
  <button class="pp" aria-label="play"><span>&#9654;</span></button>
  <div class="track"><div class="fill"></div>{cells}</div>
  <span class="clk">0:00</span>
</div>'''


def article(i, s):
    return f'''<article class="smp" id="{s['key']}">
  <div class="cat">{s['obs']}</div>
  <h3>{s['name']}</h3>
  <p class="by">named in the field by {s['by']}</p>
  <p class="dsc">{s['desc']}</p>
  {strip(s['key'])}
  {transport(i, s['key'])}
  <div class="jr">
    <p class="tech">{s['tech']}</p>
    <p class="ref">{s['ref']}</p>
    <p class="fig-m">{s['fig']}</p>
  </div>
</article>'''


def main():
    audio = []
    for s in SAMPLES:
        p = os.path.join(ROOT, "demos", s["file"] + ".mp3")
        audio.append("data:audio/mpeg;base64," +
                     base64.b64encode(open(p, "rb").read()).decode())
    arts22 = "\n".join(article(i, s) for i, s in enumerate(SAMPLES)
                       if "-22-" in s["key"])
    arts67 = "\n".join(article(i, s) for i, s in enumerate(SAMPLES)
                       if "-67-" in s["key"])
    page = TEMPLATE.replace("{{A22}}", arts22).replace("{{A67}}", arts67)
    page = page.replace("{{SRC}}", json.dumps(audio))
    open(OUT, "w").write(page)
    print(f"wrote {OUT}  {os.path.getsize(OUT) / 1e6:.1f} MB")


TEMPLATE = r"""<title>Field Record B2311</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,600;1,300&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --ink:#07090b; --panel:#0c1013; --raise:#0f1519; --rule:#1c2429;
  --text:#c6d1d4; --dim:#8ba0a4; --faint:#5b6f74;
  --acc:#7ee2d0; --warm:#e0955f;
  --serif:Spectral,"Iowan Old Style",Georgia,serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
body{background:var(--ink);color:var(--text);margin:0;
     font:300 16.5px/1.72 var(--serif);-webkit-font-smoothing:antialiased}
.wrap{max-width:62rem;margin:0 auto;padding:0 1.6rem}
a{color:var(--acc)}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}

.rec{font:500 11.5px/1 var(--mono);letter-spacing:.26em;color:var(--acc);
     text-transform:uppercase}
header{padding:4rem 0 0;display:flex;flex-direction:column;gap:.9rem}
h1{font:600 clamp(2.1rem,5.6vw,3.4rem)/1.05 var(--serif);margin:0;
   letter-spacing:-.02em;color:#e6f0f1;text-wrap:balance}
.sub{font:300 italic clamp(1.04rem,2.3vw,1.26rem)/1.5 var(--serif);
     color:var(--dim);margin:0;max-width:40rem}
.meta{display:flex;flex-wrap:wrap;gap:.7rem 1.8rem;margin-top:.7rem;
      font:400 12px/1.5 var(--mono);color:var(--faint)}
.meta b{display:block;color:var(--dim);font-weight:500;letter-spacing:.08em}

.caution{border-left:2px solid var(--warm);padding-left:1.15rem;margin:2.6rem 0 0;
         max-width:42rem;font:400 13.5px/1.62 var(--mono);color:var(--dim)}
.caution b{color:var(--warm);font-weight:500}

h2{font:600 1.55rem/1.25 var(--serif);margin:4rem 0 .5rem;color:#e2ecee}
h2 .n{font:500 11px/1 var(--mono);letter-spacing:.24em;color:var(--acc);
      display:block;margin-bottom:.7rem;text-transform:uppercase}
.lede{max-width:42rem;color:#cfdadc}

/* one sample: a ruled entry in a record, not a card */
.smp{border-top:1px solid var(--rule);padding:2.1rem 0 2.4rem;
     display:flex;flex-direction:column;gap:.55rem}
.smp .cat{font:500 11px/1 var(--mono);letter-spacing:.2em;color:var(--warm)}
.smp h3{font:600 1.42rem/1.2 var(--serif);margin:0;color:#e9f2f3}
.smp .by{font:400 12px/1.5 var(--mono);color:var(--faint);margin:0}
.smp .dsc{margin:.35rem 0 .5rem;max-width:42rem;color:var(--dim);font-size:15.5px}

/* the figure: two ladders against one another, positions and shares */
.fig{margin:.7rem 0 .3rem;max-width:52rem}
.ladwrap{background:var(--panel);border:1px solid var(--rule);padding:.35rem .5rem}
svg.lad{display:block;width:100%;height:118px}
svg.lad .grid{stroke:#141c21;stroke-width:1;vector-effect:non-scaling-stroke}
svg.lad .axis{stroke:#26333a;stroke-width:1;vector-effect:non-scaling-stroke}
svg.lad .up{stroke:var(--acc);stroke-width:1.15;vector-effect:non-scaling-stroke;
            opacity:.86}
svg.lad .dn{stroke:var(--warm);stroke-width:1.15;vector-effect:non-scaling-stroke;
            opacity:.8}
.fig .axis{position:relative;height:1.2rem;margin-top:.3rem}
.fig .axis span{position:absolute;transform:translateX(-50%);
                font:400 10px/1 var(--mono);color:var(--faint)}
.fig .axis .unit{transform:translateX(-100%);color:#41545a}
.key{display:flex;flex-wrap:wrap;gap:.35rem 1.4rem;
     font:400 11.5px/1.5 var(--mono);margin-top:.15rem}
.key span{display:flex;align-items:center;gap:.5rem}
.key span::before{content:"";width:16px;height:2px;flex:0 0 auto;border-radius:1px}
.ka{color:var(--acc)} .ka::before{background:var(--acc)}
.kb{color:var(--warm)} .kb::before{background:var(--warm)}
.fig figcaption{font:400 12.5px/1.6 var(--mono);color:var(--faint);
                margin-top:.6rem;max-width:44rem}

/* the transport: the five passages are the timeline */
.tp{display:flex;align-items:stretch;gap:.7rem;margin:1rem 0 .5rem;
    max-width:52rem}
.pp{flex:0 0 auto;width:2.9rem;background:var(--raise);color:var(--acc);
    border:1px solid var(--rule);cursor:pointer;font-size:13px;line-height:1;
    display:flex;align-items:center;justify-content:center}
.pp:hover{border-color:#31444c;color:#a8f0e2}
.pp.on{background:var(--acc);color:#06231e;border-color:transparent}
.track{position:relative;flex:1 1 auto;display:grid;
       grid-template-columns:repeat(5,1fr);background:var(--panel);
       border:1px solid var(--rule);overflow:hidden}
.fill{position:absolute;inset:0 auto 0 0;width:0;background:#122b2c;
      pointer-events:none}
.cell{position:relative;background:none;border:0;border-left:1px solid var(--rule);
      color:var(--dim);cursor:pointer;text-align:left;padding:.5rem .6rem;
      font:400 11px/1.35 var(--mono);display:flex;flex-direction:column;gap:.25rem;
      min-width:0}
.cell:first-child{border-left:0}
.cell:hover{color:#dceaec}
.cell .ix{color:var(--faint);letter-spacing:.12em}
.cell .cl{overflow-wrap:anywhere}
.cell.now .ix{color:var(--acc)}
.cell.now .cl{color:#e7f2f3}
.clk{flex:0 0 auto;align-self:center;font:400 12px/1 var(--mono);
     color:var(--faint);font-variant-numeric:tabular-nums;min-width:2.6rem;
     text-align:right}

.jr{border-left:2px solid var(--rule);padding-left:1.1rem;margin-top:.7rem;
    max-width:44rem;display:flex;flex-direction:column;gap:.3rem}
.jr p{margin:0;font:400 12.5px/1.62 var(--mono)}
.jr .tech{color:#cfdcde;font-weight:500}
.jr .ref{color:var(--faint)}
.jr .fig-m{color:var(--acc)}

footer{border-top:1px solid var(--rule);margin:3.6rem 0 5rem;padding-top:1.4rem;
       font:400 12px/1.75 var(--mono);color:var(--faint);max-width:44rem}

@media (max-width:46rem){
  .track{grid-template-columns:repeat(5,1fr)}
  .cell .cl{display:none}
  .cell{align-items:center;justify-content:center;padding:.6rem .2rem}
  svg.lad{height:96px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
<header>
  <div class="rec">Field record B2311 &middot; ten passages &middot; thirty seconds each</div>
  <h1>What the two objects were heard to do</h1>
  <p class="sub">Five passages from each recovered artefact, under the names the
  survey used among itself. Every one of them moves a quantity across its travel
  rather than setting it and leaving it there.</p>
  <div class="meta">
    <span><b>Primary</b>M5.5Ve &middot; 0.0485 AU</span>
    <span><b>Sites</b>Kell Rille &middot; Sabik Terminator</span>
    <span><b>Recovered</b>2 of 2 catalogued</span>
    <span><b>Status</b>Both objects active</span>
  </div>
</header>

<p class="caution"><b>What these recordings are.</b> They were not captured
through the plugins &mdash; those are Windows VST3 binaries and could not be
run. The behaviour set out in the field findings was rebuilt from the physics
the report describes and rendered offline: a graph-Laplacian network for
B2311.22, a cut-and-project quasiperiodic chain for B2311.67. The parameter
names are the plugins' own, read out of the shipped binaries. Every figure
quoted is measured from the renders themselves. Treat them as a faithful
demonstration of the documented behaviour, not as a recording of the objects.</p>

<h2><span class="n">B2311.22 &middot; Kell Rille</span>A body whose sound is its own connectedness</h2>
<p class="lede">Sites in a four-dimensional body, of which only a slab is
present in the section; the sites that are present are joined to their
neighbours; and what is heard is that network of joins ringing. There is no
octave in it and no harmonic ladder, because nothing put one there.</p>
{{A22}}

<h2><span class="n">B2311.67 &middot; Sabik Terminator</span>A lattice that is ordered and never repeats</h2>
<p class="lede">A line cut through a square lattice at the eightfold slope,
with an acceptance window. Its natural lengths are the Pell numbers 5, 12, 29,
70, 169, 408; its two bond lengths stand in the silver ratio; and its spectrum
is neither a set of separated tones nor a continuum but the third thing between
them.</p>
{{A67}}

<footer>
  Rendered offline at 44.1 kHz and levelled to &minus;14 dBFS. In each figure,
  position is frequency on a logarithmic axis from 30 Hz to 6 kHz and height is
  that partial's share of the disturbance; the strongest 220 partials of each
  ladder are drawn.
  <br><br>
  The objects, the field findings and the plugins are Peter B&oslash;ggild's.
</footer>
</div>

<script>
"use strict";
const SRC = {{SRC}};
const players = [...document.querySelectorAll(".tp")].map(tp => {
  const a = new Audio();
  a.preload = "none";
  a.src = SRC[+tp.dataset.i];
  const pp = tp.querySelector(".pp");
  const glyph = pp.querySelector("span");
  const fill = tp.querySelector(".fill");
  const clk = tp.querySelector(".clk");
  const cells = [...tp.querySelectorAll(".cell")];
  const p = { a, tp, stop() { a.pause(); } };

  function paint() {
    const d = a.duration || 30;
    const f = Math.min(a.currentTime / d, 1);
    fill.style.width = (f * 100) + "%";
    const s = Math.floor(a.currentTime);
    clk.textContent = "0:" + String(s).padStart(2, "0");
    const k = Math.min(4, Math.floor(a.currentTime / 6));
    cells.forEach((c, i) => c.classList.toggle("now", i === k && !a.paused));
  }
  pp.addEventListener("click", () => { a.paused ? a.play() : a.pause(); });
  cells.forEach(c => c.addEventListener("click", () => {
    a.currentTime = +c.dataset.at;
    if (a.paused) a.play(); else paint();
  }));
  a.addEventListener("timeupdate", paint);
  a.addEventListener("play", () => {
    players.forEach(o => { if (o !== p) o.stop(); });
    pp.classList.add("on"); glyph.innerHTML = "&#9646;&#9646;";
    pp.setAttribute("aria-label", "pause");
  });
  a.addEventListener("pause", () => {
    pp.classList.remove("on"); glyph.innerHTML = "&#9654;";
    pp.setAttribute("aria-label", "play");
    cells.forEach(c => c.classList.remove("now"));
  });
  a.addEventListener("ended", () => { fill.style.width = "0"; clk.textContent = "0:00"; });
  return p;
});
</script>
"""

if __name__ == "__main__":
    main()
