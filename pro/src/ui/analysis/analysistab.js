// Analysis tab: will it print? For the features you probe (cut-lines across them): the developed
// width at a dose, the dose that gives the drawn width, how forgiving that dose is, whether one dose
// prints every feature (the process window), with and without correction or with another PSF — and,
// from widths measured on a real dose test, the clearing dose and the backscatter η.
//
// The profiles come from the exposure worker ('profiles'); everything after that (any dose, any
// clearing dose) is instant, because exposure is linear: core/analysis/cd.js.
// Settings live in project.settings.analysis and travel with the project file.

import { $, esc, toast, download } from '../dom.js';
import { setupCanvas, onResize, fmtLen, FONT, FONT_SMALL, FONT_BOLD, niceStep } from '../plotkit.js';
import { probeProfiles, cdAt, doseForWidth, doseWindow, edgeSlope, commonWindow, autoProbes, combine, calibrate, probeFrame } from '../../core/analysis/cd.js';
import { RESIST_PRESETS, RESIST_LABELS, DEVELOPERS, MAT_COLOR, M } from '../../core/fab/materials.js';
import { calibrationOf, devDeviation, describeCal } from '../../core/physics/devcal.js';
import { judge, clearingDose, resistModel } from '../../core/analysis/develop.js';
import { remainingFraction } from '../../core/physics/resist.js';
import { REGIME_TEXT, describeConditions } from '../../core/resists/model.js';
import { psfKeV, LIB_PREFIX } from '../resists/resiststab.js';
import { psfFromSettings, psfLabel } from '../../core/psf/settings.js';
import { forEachCellInstance } from '../../core/exposure/scene.js';
import { cellBBox, isExposedPurpose, makeRef } from '../../core/geom/library.js';
import { bboxLocal, bboxWorld, outlineWorld, effDose, makeRect } from '../../core/geom/shapes.js';
import { apply, applyBBox } from '../../core/geom/transform.js';
import { makeProject } from '../../core/project.js';

const SC_COLORS = { w: '#2f6fd6', u: '#d6532f', k0: '#2a9d5f', k1: '#8e44ad', k2: '#b07d00' };
const PROBE_COLORS = ['#e4572e', '#2e86ab', '#7a9e3d', '#a23b72', '#f18f01', '#3b1f2b', '#00a6a6', '#6c4ab6', '#c2185b', '#455a64'];
const fmtD = (d) => (d == null || !Number.isFinite(d) ? '—' : d >= 1000 ? d.toFixed(0) : d >= 10 ? d.toFixed(1) : d.toPrecision(3));
const pct = (v) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)} %`;

export const ANALYSIS_DEFAULTS = { probes: [], resist: 'PMMA', D100: null, gamma: null, baseDose: null, tol: 10, showUncorrected: true, kept: true, measured: {}, selected: null, field: 'delivered' };

export function createAnalysisTab(app, { psfTab, jeolTab } = {}) {
  const root = $('tab-analysis');
  const S = () => {
    app.project.settings ??= {};
    const s = app.project.settings.analysis ??= {};
    for (const [k, v] of Object.entries(ANALYSIS_DEFAULTS)) if (s[k] === undefined) s[k] = Array.isArray(v) ? [] : v && typeof v === 'object' ? {} : v;
    return s;
  };
  // The whole resist: its contrast curve (D₁₀₀, γ, rounding), film (thickness, scum, dark erosion),
  // the development the curve was measured with (cal) and the one planned (dev). Blank = the preset's.
  const libEntry = (s) => (String(s.resist).startsWith(LIB_PREFIX) ? app.resists?.entryOf(s.resist.slice(LIB_PREFIX.length)) : null);
  // A library resist: its curve comes from the resist library's model for the PSF's voltage, this film
  // and this development — with the regime (calibrated / inside the process window / extrapolated).
  const libResistOf = (s, e) => {
    const r = e.model.ref, dev = { developer: s.dev?.developer ?? r.developer, timeS: s.dev?.timeS ?? r.timeS, tempC: s.dev?.tempC ?? r.tempC };
    const thicknessNm = s.thickNm ?? r.thicknessNm, c = { kV: psfKeV(app.project), thicknessNm, ...dev };
    const P = app.resists.predictFor(e.id, c);
    const preset = RESIST_PRESETS[e.id];
    const darkNmMin = s.darkNmMin ?? (preset && preset.cal?.developer === dev.developer ? preset.darkErosion ?? 0 : 0);
    const outside = P.regime === 'extrapolated' || P.regime === 'unsupported';
    const pm = Math.round(100 * (Math.exp(P.sigmaLn) - 1));
    return { D100: s.D100 ?? P.D100, gamma: s.gamma ?? +P.gamma.toFixed(2), round: s.round ?? P.round, tone: e.tone, thicknessNm, scumNm: s.scumNm ?? 0, darkNmMin,
      cal: dev, dev, darkLossNm: darkNmMin * dev.timeS / 60, custom: s.D100 != null || s.gamma != null || s.round != null,
      deviation: { outside, text: outside ? `${REGIME_TEXT[P.regime]}: ${[...P.excursions, ...(P.regime === 'unsupported' ? P.notes : [])].join('; ')} — D₁₀₀ ±${pm} %` : `${REGIME_TEXT[P.regime]} — D₁₀₀ ±${pm} %` },
      lib: { entry: e, cond: c, P, pm } };
  };
  const resistOf = (s) => {
    const e = libEntry(s);
    if (e) return libResistOf(s, e);
    const p = RESIST_PRESETS[s.resist] || RESIST_PRESETS.PMMA;
    const cal = { ...calibrationOf({}, p), ...(s.cal || {}) }, dev = { ...cal, ...(s.dev || {}) };
    const darkNmMin = s.darkNmMin ?? p.darkErosion;
    return { D100: s.D100 ?? p.D100, gamma: s.gamma ?? p.contrast, round: s.round ?? (p.soft ?? 1), tone: p.type || 'positive',
      thicknessNm: s.thickNm ?? 100, scumNm: s.scumNm ?? p.scum ?? 0, darkNmMin, cal, dev, deviation: devDeviation(cal, dev),
      darkLossNm: darkNmMin * dev.timeS / 60, custom: s.D100 != null || s.gamma != null || s.round != null || s.cal != null };
  };

  // Widths are read where the resist is done developing: fully cleared (positive) or at full height
  // (negative) — D₁₀₀ for an ideal curve, higher for a rounded one (develop.js clearingDose).
  const threshold = (s) => clearingDose(resistModel(resistOf(s)));

  root.innerHTML = `
  <div class="an-inputs" id="anInputs"></div>
  <div class="an-intro"><b>Will it print?</b> Probe the features that matter — a cut-line across each — and read off the developed width, the dose that gives the drawn width, how much dose error it forgives, and whether one dose prints them all.
    <button class="btn small" id="anExplainBtn">How to read this</button>
    <button class="btn small" id="anExample" title="A new project: one 50 nm line isolated, inside a dense grating, at the grating's edge, and 200 nm from a large pad — the proximity effect in one picture">Example: proximity test</button></div>
  <div class="panel an-explain" id="anExplain" hidden>
    <ol>
      <li><b>The resist only sees the delivered dose</b> — the pattern blurred by the PSF. A positive resist clears where it exceeds the clearing dose D₁₀₀ (a negative one stays). The developed edge is where the profile crosses D₁₀₀.</li>
      <li><b>Exposure is linear.</b> Doubling the dose doubles the profile, so the width at any dose is the same profile cut at a different height (D₁₀₀ ÷ dose). <i>Width vs dose</i> is the profile turned on its side — no new simulation needed.</li>
      <li><b>A steep edge forgives.</b> Where the profile is steep, a dose error barely moves the edge. The table gives it as nm of width per % of dose; the dose window is the range that keeps the width within ±tolerance.</li>
      <li><b>The proximity effect, in one picture:</b> features with different surroundings collect different backscatter and need different doses. The <i>process window</i> chart shows each feature's dose window; if they do not overlap, no single dose prints everything — that is what proximity correction is for (Exposure tab). Compare <i>as written</i> with <i>without correction</i>.</li>
      <li><b>The rest of the resist.</b> The cleared bottom width depends on D₁₀₀ alone; the contrast γ, the thickness and the development decide what happens around it — how far the top opens (the walls), how much resist the neighbours' dose eats away between openings, whether scum stays in the opening. The <i>Developed resist</i> chart and the verdict show it. And a contrast curve only holds for the development it was measured with: develop longer or warmer and the result is less certain.</li>
      <li><b>Calibration:</b> widths measured on a real dose test fix the clearing dose — and, if the features differ in how much backscatter they collect (an isolated line and a dense grating, say), the backscatter ratio η too.</li>
    </ol></div>
  <div class="grid">
    <div class="col">
      <div class="panel">
        <div class="section-title">Probes <span class="q" data-tip="A probe is a cut-line across one feature. <b>Find features</b> puts one across each kind of shape in the layout (the narrowest first; in an array, the element in the middle, where the surroundings are densest). <b>Draw</b>: drag across a feature on the map. <b>From Exposure</b>: the Exposure tab's cut-line.<br><br>Its target width is the drawn width the probe crosses; type another to aim elsewhere.">?</span></div>
        <div class="row" style="margin-bottom:6px;"><button class="btn small primary" id="anAuto">Find features</button><button class="btn small" id="anDraw">Draw</button><button class="btn small" id="anFromEx">From Exposure</button><button class="btn small" id="anClear">Clear</button></div>
        <div id="anProbeList"></div>
      </div>
      <div class="panel">
        <div class="section-title">Resist and dose <span class="q" data-tip="<b>D₁₀₀</b> — the clearing dose (positive) or saturation dose (negative) of the resist, in µC/cm², for its standard development; the presets are Fab Studio's.<br><b>Dose</b> — the absolute dose of the Workbench's nominal dose (Pattern Studio's dose 100 is written at this many µC/cm²; the same number as RESIST in the JEOL tab).<br><b>Tolerance</b> — how far the width may stray from its target and still count as printed.">?</span></div>
        <div class="two">
          <div><div class="label">Resist</div><select class="field" id="anResist"></select></div>
          <div><div class="label">Thickness (nm)</div><input class="field" id="anThick" type="number" min="5" step="10"></div>
        </div>
        <div class="label" style="margin-top:6px;">Contrast curve <span class="q" data-tip="Remaining thickness against dose, as in Fab Studio: <b>D₁₀₀</b> clears (positive) or saturates (negative) the resist; <b>γ</b> sets how fast it thins between D₀ = D₁₀₀·10^(−1/γ) and D₁₀₀; <b>rounding</b> softens the two kinks. <b>Scum</b>: what a positive resist leaves in an opening near D₁₀₀; <b>dark erosion</b>: what the developer removes from unexposed resist per minute.<br><br>The presets are illustrative: put in your own measured curve.">?</span></div>
        <div class="three">
          <div><div class="label">D₁₀₀ (µC/cm²)</div><input class="field" id="anD100" type="number" min="1" step="10"></div>
          <div><div class="label">γ</div><input class="field" id="anGamma" type="number" min="0.5" step="0.5"></div>
          <div><div class="label">Rounding %</div><input class="field" id="anRound" type="number" min="0" max="100" step="10"></div>
          <div><div class="label">Scum (nm)</div><input class="field" id="anScum" type="number" min="0" step="0.5"></div>
          <div><div class="label">Dark (nm/min)</div><input class="field" id="anDark" type="number" min="0" step="0.5"></div>
          <div></div>
        </div>
        <div id="anCalBox"><div class="label" style="margin-top:6px;">Curve measured with <span class="q" data-tip="A contrast curve only holds for the development it was measured with. Put in the developer, time and temperature of YOUR curve; the planned development below is compared with it.">?</span></div>
        <div class="three">
          <div><select class="field" id="anCalDev">${Object.entries(DEVELOPERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
          <div><input class="field" id="anCalT" type="number" min="1" step="5" title="time (s)"></div>
          <div><input class="field" id="anCalC" type="number" step="0.5" title="temperature (°C)"></div>
        </div></div>
        <div class="label" style="margin-top:6px;">This development</div>
        <div class="three">
          <div><select class="field" id="anDevDev">${Object.entries(DEVELOPERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
          <div><input class="field" id="anDevT" type="number" min="1" step="5" title="time (s)"></div>
          <div><input class="field" id="anDevC" type="number" step="0.5" title="temperature (°C)"></div>
        </div>
        <div class="hint" id="anDevNote" style="margin-top:4px;"></div>
        <div class="hint" id="anClearNote" style="margin-top:2px;"></div>
        <div class="two" style="margin-top:6px;">
          <div><div class="label">Tolerance ± %</div><input class="field" id="anTol" type="number" min="1" max="50" step="1"></div>
          <div><div class="label">Dose (µC/cm²)</div><input class="field" id="anDose" type="number" min="1" step="10"></div>
        </div>
        <input type="range" id="anDoseSlider" min="0" max="1000" style="width:100%;margin-top:6px;">
        <div class="row" style="margin-top:4px;"><button class="btn small" id="anToSize">Dose to size (selected)</button><button class="btn small" id="anBest">Best common dose</button><button class="btn small" id="anToJeol" title="RESIST in the JEOL tab">Use in JEOL tab</button></div>
      </div>
      <div class="panel">
        <div class="section-title">Compare <span class="q" data-tip="<b>As written</b> — the pattern as the beam will write it: the fractured writing data if in use, otherwise the shapes at their (corrected) writing doses.<br><b>Without correction</b> — every shape at its design dose: what the proximity effect does on its own.<br><b>Kept PSFs</b> — the curves kept with <i>Keep curve</i> in the PSF tab (another energy, a Monte Carlo, a BEAMER PSF…), on the same pattern.">?</span></div>
        <label class="row" style="gap:6px;font-size:13px;"><input type="checkbox" id="anUnc"> Without correction <span class="hint" id="anUncHint"></span></label>
        <label class="row" style="gap:6px;font-size:13px;"><input type="checkbox" id="anKept"> PSFs kept in the PSF tab <span class="hint" id="anKeptHint"></span></label>
      </div>
      <div class="panel">
        <div class="section-title">Calibrate from measured widths <span class="q" data-tip="Type the widths you measured (SEM) for the selected probe: one line per dose, <i>dose, width</i> (µC/cm², nm). Do it for several probes. <b>Fit</b> finds the clearing dose D₁₀₀ — and, if ticked, the backscatter η of the PSF — that reproduce them best, with the pattern as written.<br><br>η can only be fitted from features that collect different amounts of backscatter (isolated and dense, small and large); the result says whether your data pin it down.">?</span></div>
        <div class="label" id="anMeasLabel">Measured on the selected probe</div>
        <textarea class="field" id="anMeas" rows="4" placeholder="dose, width&#10;400, 85&#10;500, 102" style="font:12px ui-monospace,Consolas,monospace;"></textarea>
        <label class="row" style="gap:6px;font-size:13px;margin-top:4px;"><input type="checkbox" id="anFitEta" checked> also fit η (backscatter)</label>
        <div class="row" style="margin-top:4px;"><button class="btn small primary" id="anFit">Fit</button><button class="btn small" id="anUseD100" disabled>Use D₁₀₀</button><button class="btn small" id="anUseEta" disabled>Use η in the PSF</button></div>
        <div class="hint" id="anFitOut" style="margin-top:6px;"></div>
      </div>
    </div>
    <div class="col">
      <div class="panel">
        <div class="section-title" style="justify-content:space-between;"><span>Map <span class="hint" id="anMapHint">wheel zooms, drag pans</span></span><button class="btn small" id="anFit0">Fit</button></div>
        <canvas id="anMap" style="width:100%;height:280px;display:block;border:1px solid var(--border);border-radius:8px;background:#fff;touch-action:none;"></canvas>
      </div>
      <div class="an-two">
        <div class="panel"><div class="section-title">Dose along the probe <span class="q" data-tip="The delivered dose along the selected probe at the dose above (µC/cm²). The grey band is the drawn feature; the red line is D₁₀₀. The resist clears (positive) where the curve is above it: the coloured bar under the curve, with its width.">?</span><span class="hint" id="anProfTitle"></span></div><canvas id="anProf" class="an-chart"></canvas></div>
        <div class="panel"><div class="section-title">Developed resist <span class="q" data-tip="The resist left after development along the selected probe (as written), read off the contrast curve point by point with the dark erosion of this development — Fab Studio's 1D development. Grey-blue: the silicon; pink: resist. The cleared bottom width depends on D₁₀₀ only; γ, thickness and development decide the walls and how much resist stays between openings.">?</span><span class="hint" id="anDevTitle"></span></div><canvas id="anDevCut" class="an-chart"></canvas></div>
        <div class="panel"><div class="section-title">Width vs dose <span class="q" data-tip="The developed width of the selected feature at every dose (log scale). The green band is the target ± tolerance; where a curve runs through it is the dose window. The dot marks the dose to size; the vertical line the dose above. Measured widths, if typed in, are the black dots.">?</span><span class="hint" id="anCdTitle"></span></div><canvas id="anCd" class="an-chart"></canvas></div>
        <div class="panel"><div class="section-title">Will it print? <span class="q" data-tip="The verdict for the selected probe at the dose above, as written: does it clear (or, negative, stand at full height), is it to size within the tolerance, how much resist is left beside it, are the walls steep, is there scum — and is the development the one the contrast curve was measured for. ✓ prints · ! prints with remarks · ✕ does not print.">?</span></div><div id="anVerdict"></div></div>
      </div>
      <div class="panel">
        <div class="section-title">Process window — one dose for all? <span class="q" data-tip="Each bar is a feature's dose window: the doses that print it within ± tolerance. The shaded column is the window they share. No shared column: no single dose prints all of them — correct the proximity effect, or accept the worst feature. The vertical line is the dose above.">?</span></div>
        <canvas id="anWin" style="width:100%;height:160px;display:block;"></canvas>
        <div class="hint" id="anWinText" style="margin-top:4px;"></div>
      </div>
      <div class="panel">
        <div class="section-title" style="justify-content:space-between;"><span>All probes</span><button class="btn small" id="anCsv">Export CSV</button></div>
        <div id="anTable" style="overflow:auto;"></div>
        <div class="hint" id="anStatus" style="margin-top:4px;"></div>
      </div>
    </div>
  </div>`;

  // ---------------------------------------------------------------- state
  let results = new Map();                // probe id → { key, R (profiles), error }
  let computing = null, fitResult = null;
  const view = { ox: 0, oy: 0, s: 100, fitted: false };
  let drawMode = false, dragging = null;
  const lib = () => app.project.library;
  const correctionInUse = () => !!app.project.writing?.active || Object.values(lib().cells).some((c) => (c.shapes || []).some((q) => q.writeDose != null));
  const keptPsfs = () => (psfTab?.getSession?.().compare || []).slice(0, 3);
  function scenarios() {
    const s = S(), out = [{ key: 'w', field: 'delivered', label: correctionInUse() ? 'as written' : 'design doses' }];
    if (s.showUncorrected && correctionInUse()) out.push({ key: 'u', field: 'uncorrected', label: 'without correction' });
    if (s.kept) keptPsfs().forEach((k, i) => out.push({ key: `k${i}`, field: 'delivered', label: `PSF: ${k.label}`, psf: { mode: 'table', table: { r: k.r, f: k.f, meta: { source: 'kept', file: k.label }, model: 'double', useFit: false } } }));
    return out;
  }
  const query = (points, scs) => { app.exposure.setProject(app.project, app.version); return app.exposure.request('profiles', { points, scenarios: scs }).then((r) => r.values); };
  const probeById = (id) => S().probes.find((p) => p.id === id);
  const sel = () => probeById(S().selected) || S().probes[0] || null;
  const newId = () => 'p' + Math.random().toString(36).slice(2, 8);

  // ---------------------------------------------------------------- compute
  async function computeAll() {
    const s = S(), scs = scenarios(), token = {};
    computing = token;
    const sk = JSON.stringify(scs.map((q) => q.key + (q.psf ? q.psf.table.r.length : '')));
    for (const p of s.probes) {
      const key = `${app.version}|${sk}|${p.a}|${p.b}`;
      const have = results.get(p.id);
      if (have && have.key === key) continue;
      $('anStatus').textContent = `Computing the dose along ${p.name}…`;
      try {
        const R = await probeProfiles(p, scs, query, { nominal: app.nominalDose() });
        if (computing !== token) return;
        results.set(p.id, { key, R, scs });
      } catch (e) { results.set(p.id, { key, error: e.message }); }
      render();
    }
    if (computing === token) {
      $('anStatus').textContent = '';
      if (s.baseDose == null && s.probes.length) {           // first use: start where the features print
        const D100 = threshold(s), wins = s.probes.map((p) => probeNumbers(p, s, D100, app.nominalDose())?.per.w?.win).filter(Boolean);
        const cw = commonWindow(wins), first = wins.find((w) => w.toSize)?.toSize;
        const d = cw ? Math.sqrt(cw.lo * cw.hi) : first;
        if (d) { s.baseDose = +d.toPrecision(4); app.markDirty(); }
      }
      render();
    }
  }

  // per probe: target, and per scenario the numbers at the current dose
  function probeNumbers(p, s, D100, B) {
    const r = results.get(p.id);
    if (!r || !r.R) return null;
    const R = r.R, target = p.target ?? R.drawn?.width ?? null;
    const per = {};
    for (const sc of r.scs) {
      const prof = R.profiles[sc.key];
      if (!prof || !target) continue;
      const at = cdAt(R.s, prof, B, D100, R.ref, R.others);
      const win = doseWindow(R.s, prof, D100, target, s.tol / 100, R.ref, R.others);
      const slope = win.toSize ? edgeSlope(R.s, prof, win.toSize, D100, R.ref) : null;      // at the operating point
      const res = resistOf(s);
      const verdict = judge({ s: R.s, prof, ref: R.ref, others: R.others, target, tol: s.tol / 100, B, resist: res, darkLossNm: res.darkLossNm, outsideCalibration: res.deviation.outside });
      per[sc.key] = { at, win, slope, verdict };
    }
    return { R, target, per, scs: r.scs };
  }

  // ---------------------------------------------------------------- probes from the layout
  // One probe per kind of feature. A kind is a shape (size, layer, dose) in a kind of surroundings:
  // the same 50 nm line isolated, inside a grating, at its edge or beside a large pad prints at
  // different doses — the proximity effect — so each is a kind of its own. Surroundings: how many
  // shapes come within 4 widths (none / one or two / more), and whether one of them is much larger.
  function findFeatures() {
    const L = lib(), purpose = new Map(L.layers.map((l) => [l.key, l.purpose]));
    const bb = cellBBox(L, L.top); if (!bb) { toast('The layout is empty.'); return; }
    const inst = [];
    let budget = 300000, packed = false;
    forEachCellInstance(L, L.top, bb, (name, T) => {
      if (budget <= 0) return;
      const c = L.cells[name];
      if (!c.shapes) { packed = true; return; }
      for (const sh of c.shapes) {
        if (budget-- <= 0) break;
        if (!isExposedPurpose(purpose.get(sh.layer)) || !(effDose(sh) > 0)) continue;
        const b = bboxLocal(sh), mag = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c));
        const [cx, cy] = apply(T, sh.cx, sh.cy);
        const angle = (sh.rot || 0) + Math.atan2(T.b, T.a) * 180 / Math.PI;
        const W = (b.x2 - b.x1) * mag, H = (b.y2 - b.y1) * mag;
        inst.push({ name, cx, cy, w: W, h: H, angle, kind: sh.kind, narrow: Math.min(W, H), box: applyBBox(T, bboxWorld(sh)),
          sig: `${name}|${sh.kind}|${Math.round(W)}|${Math.round(H)}|${Math.round(((angle % 180) + 180) % 180)}|${sh.layer}|${+effDose(sh).toPrecision(4)}` });
      }
    });
    if (!inst.length) { toast(packed ? 'The layout is stored packed (a very large import): draw the probes on the map instead.' : 'No exposed shapes found.'); return; }
    // neighbours through a grid of boxes; shapes covering many cells are checked against everything
    const G = Math.min(50000, Math.max(200, 10 * [...inst].sort((a, b) => a.narrow - b.narrow)[inst.length >> 1].narrow));
    const grid = new Map(), big = [];
    const cellsOf = (b, f) => { for (let i = Math.floor(b.x1 / G); i <= Math.floor(b.x2 / G); i++) for (let j = Math.floor(b.y1 / G); j <= Math.floor(b.y2 / G); j++) f(`${i},${j}`); };
    inst.forEach((q, k) => { const n = (Math.floor(q.box.x2 / G) - Math.floor(q.box.x1 / G) + 1) * (Math.floor(q.box.y2 / G) - Math.floor(q.box.y1 / G) + 1); if (n > 64) { big.push(k); return; } cellsOf(q.box, (key) => { let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(k); }); });
    const hits = (a, b) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
    inst.forEach((q, k) => {
      const d = Math.max(4 * q.narrow, 100), E = { x1: q.box.x1 - d, y1: q.box.y1 - d, x2: q.box.x2 + d, y2: q.box.y2 + d };
      const seen = new Set(); let n = 0, large = false;
      // neighbours that matter: not much smaller than this shape (fine lines do not make a pad "dense")
      const look = (m) => { if (m === k || seen.has(m)) return; seen.add(m); const o = inst[m]; if (o.narrow >= q.narrow / 10 && hits(E, o.box)) { n++; if (o.narrow > 10 * q.narrow) large = true; } };
      const span = (Math.floor(E.x2 / G) - Math.floor(E.x1 / G) + 1) * (Math.floor(E.y2 / G) - Math.floor(E.y1 / G) + 1);
      if (span <= 400) cellsOf(E, (key) => { for (const m of grid.get(key) || []) look(m); }); else inst.forEach((_, m) => look(m));
      for (const m of big) look(m);
      q.ctx = (large ? 'beside a large shape' : '') || (n === 0 ? 'isolated' : n <= 2 ? 'sparse' : 'dense');
      q.key = `${q.sig}|${q.ctx}`;
    });
    const mean = new Map();
    for (const q of inst) { const m = mean.get(q.key) || { x: 0, y: 0, n: 0 }; m.x += q.cx; m.y += q.cy; m.n++; mean.set(q.key, m); }
    const found = autoProbes((cb) => { for (const q of inst) { const m = mean.get(q.key); cb(null, q, q.key, Math.hypot(q.cx - m.x / m.n, q.cy - m.y / m.n)); } }, { max: 8 });
    if (!found.length) { toast('No exposed shapes found.'); return; }
    const s = S();
    s.probes = found.map((f, i) => {
      const parts = f.key.split('|'), cell = parts[0], ctx = parts[parts.length - 1], what = f.narrow >= 1000 ? fmtLen(f.narrow) : `${Math.round(f.narrow)} nm`;
      return { id: newId(), name: `${i + 1} · ${what}, ${ctx}${f.count > 1 ? ` (×${f.count.toLocaleString()})` : ''}${cell !== L.top ? ` in ${cell}` : ''}`, ...f.probe };
    });
    s.selected = s.probes[0].id; results.clear(); fitResult = null;
    app.markDirty(); fitView(); render(); computeAll();
    toast(`${s.probes.length} probe${s.probes.length > 1 ? 's' : ''}: one across each kind of feature and surroundings, the narrowest first.`);
  }

  // The proximity effect in one picture: the same 50 nm line in four surroundings, and a large pad.
  // No single dose prints them all until the proximity is corrected (Exposure tab).
  // The grating is wider than the backscatter range β (≈ 31 µm at 100 kV in Si): a narrow one collects
  // almost no backscatter, and the lesson would show nothing.
  function proximityExample() {
    const p = makeProject(), L = p.library, top = L.cells[L.top], line = (x) => makeRect(x, 0, 25, 50000, 100);
    top.shapes.push(line(-150000));                                      // isolated
    L.cells.LINE = { name: 'LINE', shapes: [line(0)], refs: [] };         // grating: 1001 lines of 50 nm at 100 nm pitch, 100 µm square
    top.refs.push(makeRef('LINE', { x: -50000, y: 0, cols: 1001, rows: 1, colStep: [100, 0], rowStep: [0, 0] }));
    top.shapes.push(line(150000));                                       // 200 nm from …
    top.shapes.push(makeRect(150000 + 25 + 200 + 15000, 0, 15000, 15000, 100));  // … a 30 µm pad
    p.settings.analysis = { ...ANALYSIS_DEFAULTS, probes: [], measured: {}, resist: 'PMMA' };
    return p;
  }
  $('anExample').onclick = () => {
    if (!confirm('Open the proximity example as a new project? (Save first if you want to keep this one.)')) return;
    app.openProject(proximityExample(), 'proximity example');
    findFeatures();
    $('anExplain').hidden = false;
    toast('The same 50 nm line, four surroundings. Look at the process window: no single dose prints all of them. Then correct the proximity effect in the Exposure tab (Fracture &amp; correct) and come back.', 9000);
  };

  // ---------------------------------------------------------------- map
  const mapEl = $('anMap');
  const w2s = (x, y) => [(x - view.ox) / view.s, (view.oy - y) / view.s];
  const s2w = (px, py) => [view.ox + px * view.s, view.oy - py * view.s];
  function fitView() {
    const s = S(), bb0 = cellBBox(lib(), lib().top);
    let bb = bb0 ? { ...bb0 } : { x1: -1000, y1: -1000, x2: 1000, y2: 1000 };
    const pr = sel();
    if (pr && s.probes.length) {                                // around the probes, not the whole chip
      const xs = s.probes.flatMap((p) => [p.a[0], p.b[0]]), ys = s.probes.flatMap((p) => [p.a[1], p.b[1]]);
      bb = { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
      const pad = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) * 0.15 + 500; bb.x1 -= pad; bb.x2 += pad; bb.y1 -= pad; bb.y2 += pad;
    }
    const W = mapEl.clientWidth || 600, H = mapEl.clientHeight || 280;
    view.s = Math.max((bb.x2 - bb.x1) / W, (bb.y2 - bb.y1) / H) * 1.05 || 1;
    view.ox = (bb.x1 + bb.x2) / 2 - (W / 2) * view.s; view.oy = (bb.y1 + bb.y2) / 2 + (H / 2) * view.s;
    view.fitted = true;
  }
  function drawMap() {
    const { ctx, w, h } = setupCanvas(mapEl);
    if (!view.fitted) fitView();
    const L = lib(), roi = { x1: view.ox, y1: view.oy - h * view.s, x2: view.ox + w * view.s, y2: view.oy };
    const colors = new Map(L.layers.map((l) => [l.key, l]));
    let n = 0;
    ctx.lineWidth = 1;
    forEachCellInstance(L, L.top, roi, (name, T) => {
      if (n > 30000) return;
      for (const sh of L.cells[name].shapes || []) {
        if (++n > 30000) break;
        const lay = colors.get(sh.layer); if (lay && lay.visible === false) continue;
        const pts = outlineWorld(sh, Math.max(1, view.s)).map(([x, y]) => w2s(...apply(T, x, y)));
        if (pts.length < 2) continue;
        ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        const col = lay?.color || '#2f6fd6';
        ctx.fillStyle = col + '33'; ctx.strokeStyle = col; ctx.fill(); ctx.stroke();
      }
    });
    const s = S();
    s.probes.forEach((p, i) => {
      const [x1, y1] = w2s(...p.a), [x2, y2] = w2s(...p.b), on = p.id === sel()?.id;
      ctx.strokeStyle = PROBE_COLORS[i % PROBE_COLORS.length]; ctx.lineWidth = on ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x2, y2, on ? 9 : 7, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = FONT_BOLD; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x2, y2 + 0.5);
    });
    if (dragging?.draw) { const [x1, y1] = w2s(...dragging.a), [x2, y2] = w2s(...dragging.b); ctx.strokeStyle = '#111'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = FONT_SMALL; ctx.fillStyle = '#666';
    const bar = niceStep(w * view.s / 4, 1); ctx.fillRect(10, h - 14, bar / view.s, 3); ctx.fillText(fmtLen(bar), 10, h - 20);
  }
  const pos = (e) => { const r = mapEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  mapEl.addEventListener('wheel', (e) => { e.preventDefault(); const [px, py] = pos(e), [wx, wy] = s2w(px, py), f = e.deltaY > 0 ? 1.25 : 0.8; view.s *= f; view.ox = wx - px * view.s; view.oy = wy + py * view.s; drawMap(); }, { passive: false });
  mapEl.addEventListener('pointerdown', (e) => {
    const p = pos(e); mapEl.setPointerCapture(e.pointerId);
    if (drawMode) { const w = s2w(...p); dragging = { draw: true, a: w, b: w }; return; }
    // a click near a probe selects it
    const s = S(); let best = null, bd = 10;
    for (const pr of s.probes) { const [x1, y1] = w2s(...pr.a), [x2, y2] = w2s(...pr.b), dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x1 + t * dx - p[0], y1 + t * dy - p[1]); if (d < bd) { bd = d; best = pr; } }
    if (best) { s.selected = best.id; app.markDirty(); render(); return; }
    dragging = { pan: true, p, ox: view.ox, oy: view.oy };
  });
  mapEl.addEventListener('pointermove', (e) => {
    if (!dragging) return; const p = pos(e);
    if (dragging.pan) { view.ox = dragging.ox - (p[0] - dragging.p[0]) * view.s; view.oy = dragging.oy + (p[1] - dragging.p[1]) * view.s; }
    else dragging.b = s2w(...p);
    drawMap();
  });
  mapEl.addEventListener('pointerup', () => {
    const d = dragging; dragging = null;
    if (d?.draw) {
      const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      if (len > 4 * view.s) addProbe({ a: d.a, b: d.b }, 'drawn');
      drawMode = false; $('anDraw').classList.remove('active'); $('anMapHint').textContent = 'wheel zooms, drag pans';
    }
    drawMap();
  });
  function addProbe(pr, how) {
    const s = S(), n = s.probes.length + 1;
    const p = { id: newId(), name: `${n} · ${how}`, a: [...pr.a], b: [...pr.b] };
    s.probes.push(p); s.selected = p.id; app.markDirty(); render(); computeAll();
  }

  // ---------------------------------------------------------------- charts
  function axes(ctx, w, h, m) { ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, h - m.b); ctx.lineTo(w - m.r, h - m.b); ctx.stroke(); }
  const logTicks = (lo, hi) => { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= lo && v <= hi) out.push(v); } return out; };

  function drawProfile(P, s, D100, B, D0, Dc = D100) {
    const { ctx, w, h } = setupCanvas($('anProf')), m = { l: 52, r: 10, t: 10, b: 30 };
    if (!P) { ctx.font = FONT; ctx.fillStyle = '#888'; ctx.fillText('Add a probe: Find features, or Draw on the map.', 12, 24); return; }
    const R = P.R, xs = R.s, x0 = xs[0], x1 = xs[xs.length - 1];
    let ymax = D100 * 1.3; for (const sc of P.scs) { const pr = R.profiles[sc.key]; if (pr) for (const v of pr) ymax = Math.max(ymax, v * B); }
    ymax *= 1.05;
    const X = (x) => m.l + (x - x0) / (x1 - x0) * (w - m.l - m.r), Y = (y) => h - m.b - y / ymax * (h - m.t - m.b);
    if (R.drawn) { ctx.fillStyle = '#e9edf2'; ctx.fillRect(X(R.drawn.left), m.t, X(R.drawn.right) - X(R.drawn.left), h - m.t - m.b); }
    axes(ctx, w, h, m);
    ctx.font = FONT_SMALL; ctx.fillStyle = '#555'; ctx.textAlign = 'right';
    const ys = niceStep(ymax, 4); for (let y = 0; y <= ymax; y += ys) { ctx.fillText(fmtD(y), m.l - 4, Y(y) + 4); ctx.strokeStyle = '#f0f0f0'; ctx.beginPath(); ctx.moveTo(m.l, Y(y)); ctx.lineTo(w - m.r, Y(y)); ctx.stroke(); }
    ctx.textAlign = 'center';
    const xsStep = niceStep(x1 - x0, 5); for (let x = Math.ceil(x0 / xsStep) * xsStep; x <= x1; x += xsStep) ctx.fillText(fmtLen(x), X(x), h - m.b + 15);
    ctx.fillText('position along the probe', (m.l + w - m.r) / 2, h - 2);
    ctx.save(); ctx.translate(12, (m.t + h - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('dose (µC/cm²)', 0, 0); ctx.restore();
    // D100 and D0
    ctx.strokeStyle = '#d00'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.l, Y(D100)); ctx.lineTo(w - m.r, Y(D100)); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#d0000088'; ctx.beginPath(); ctx.moveTo(m.l, Y(D0)); ctx.lineTo(w - m.r, Y(D0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'left'; ctx.fillStyle = '#d00'; ctx.fillText(`D₁₀₀ ${fmtD(D100)}`, m.l + 4, Y(D100) - 4);
    if (Dc > D100 * 1.005) {                           // a rounded curve clears fully only above D₁₀₀
      ctx.strokeStyle = '#7a0000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.l, Y(Dc)); ctx.lineTo(w - m.r, Y(Dc)); ctx.stroke();
      ctx.fillStyle = '#7a0000'; ctx.textAlign = 'right'; ctx.fillText(`fully cleared ${fmtD(Dc)}`, w - m.r - 4, Y(Dc) - 4); ctx.textAlign = 'left';
    }
    P.scs.forEach((sc, k) => {
      const pr = R.profiles[sc.key]; if (!pr) return;
      ctx.strokeStyle = SC_COLORS[sc.key] || '#333'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < xs.length; i++) { const px = X(xs[i]), py = Y(pr[i] * B); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke();
      const at = P.per[sc.key]?.at;
      if (at && at.cd > 0) { ctx.fillStyle = (SC_COLORS[sc.key] || '#333') + 'cc'; ctx.fillRect(X(at.left), h - m.b - 7 - 6 * k, X(at.right) - X(at.left), 5); }
    });
  }

  function drawCd(P, s, D100, B) {
    const { ctx, w, h } = setupCanvas($('anCd')), m = { l: 56, r: 12, t: 10, b: 30 };
    if (!P || !P.target) { ctx.font = FONT; ctx.fillStyle = '#888'; ctx.fillText('No feature under the selected probe.', 12, 24); return; }
    const R = P.R, T = P.target, main = P.per.w;
    const ref = main?.win?.toSize || B;
    const lo = ref / 4, hi = ref * 4, ymax = 2 * T;
    const X = (d) => m.l + Math.log(d / lo) / Math.log(hi / lo) * (w - m.l - m.r), Y = (y) => h - m.b - Math.min(y, ymax) / ymax * (h - m.t - m.b);
    ctx.fillStyle = '#e3f4e8'; ctx.fillRect(m.l, Y(T * (1 + s.tol / 100)), w - m.l - m.r, Y(T * (1 - s.tol / 100)) - Y(T * (1 + s.tol / 100)));
    axes(ctx, w, h, m);
    ctx.font = FONT_SMALL; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    for (const d of logTicks(lo, hi)) { ctx.fillText(fmtD(d), X(d), h - m.b + 15); ctx.strokeStyle = '#f0f0f0'; ctx.beginPath(); ctx.moveTo(X(d), m.t); ctx.lineTo(X(d), h - m.b); ctx.stroke(); }
    ctx.fillText('dose (µC/cm², log)', (m.l + w - m.r) / 2, h - 2);
    ctx.textAlign = 'right'; for (const y of [0, T / 2, T, 1.5 * T, 2 * T]) ctx.fillText(fmtLen(y), m.l - 4, Y(y) + 4);
    ctx.strokeStyle = '#2a9d5f'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(m.l, Y(T)); ctx.lineTo(w - m.r, Y(T)); ctx.stroke(); ctx.setLineDash([]);
    P.scs.forEach((sc) => {
      const pr = R.profiles[sc.key]; if (!pr) return;
      ctx.strokeStyle = SC_COLORS[sc.key] || '#333'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 160; i++) { const d = lo * (hi / lo) ** (i / 160), r = cdAt(R.s, pr, d, D100, R.ref, R.others); const y = (r.openL || r.openR || r.merged) ? ymax : r.cd; i ? ctx.lineTo(X(d), Y(y)) : ctx.moveTo(X(d), Y(y)); }
      ctx.stroke();
      const t = P.per[sc.key]?.win?.toSize; if (t) { ctx.fillStyle = SC_COLORS[sc.key] || '#333'; ctx.beginPath(); ctx.arc(X(t), Y(T), 4, 0, 2 * Math.PI); ctx.fill(); }
    });
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(B), m.t); ctx.lineTo(X(B), h - m.b); ctx.stroke();
    const p = sel(); for (const [d, cd] of measuredOf(p)) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(X(d), Y(cd), 3.5, 0, 2 * Math.PI); ctx.fill(); }
  }

  function drawWindows(all, s, B) {
    const c = $('anWin'), rows = all.filter((q) => q.P && q.P.target);
    c.style.height = `${Math.max(90, 34 + rows.length * 22)}px`;
    const { ctx, w, h } = setupCanvas(c), m = { l: 150, r: 12, t: 6, b: 26 };
    if (!rows.length) { $('anWinText').textContent = ''; return; }
    const scs = rows[0].P.scs;
    let lo = Infinity, hi = 0;
    for (const q of rows) for (const sc of scs) { const W = q.P.per[sc.key]?.win; if (W?.lo) { lo = Math.min(lo, W.lo); hi = Math.max(hi, Math.min(W.hi, W.lo * 50)); } }
    if (!(hi > lo)) { lo = B / 4; hi = B * 4; }
    lo /= 1.5; hi *= 1.5;
    const X = (d) => m.l + Math.log(Math.max(d, lo) / lo) / Math.log(hi / lo) * (w - m.l - m.r);
    const rowH = (h - m.t - m.b) / rows.length;
    // the shared window of each scenario
    const texts = [];
    scs.forEach((sc, k) => {
      const cw = commonWindow(rows.map((q) => q.P.per[sc.key]?.win || { lo: null }));
      if (cw) { ctx.fillStyle = (SC_COLORS[sc.key] || '#333') + '22'; ctx.fillRect(X(cw.lo), m.t, X(cw.hi) - X(cw.lo), h - m.t - m.b); }
      texts.push(`<span style="color:${SC_COLORS[sc.key]}">■</span> ${esc(sc.label)}: ${cw ? `one dose prints all ${rows.length} — <b>${fmtD(cw.lo)}–${fmtD(cw.hi)}</b> µC/cm² (latitude ${(100 * cw.latitude).toFixed(0)} %)` : `<b>no single dose prints all ${rows.length}</b>`}`);
    });
    rows.forEach((q, i) => {
      const y = m.t + i * rowH;
      ctx.font = FONT_SMALL; ctx.fillStyle = '#333'; ctx.textAlign = 'right'; ctx.fillText(q.p.name.length > 22 ? q.p.name.slice(0, 21) + '…' : q.p.name, m.l - 6, y + rowH / 2 + 4);
      scs.forEach((sc, k) => {
        const W = q.P.per[sc.key]?.win; const bh = Math.max(3, rowH / (scs.length + 1));
        const yy = y + (k + 0.5) * rowH / (scs.length + 0.5);
        if (W?.lo) { ctx.fillStyle = SC_COLORS[sc.key] || '#333'; ctx.fillRect(X(W.lo), yy, Math.max(2, X(W.hi) - X(W.lo)), bh); }
        else if (W?.toSize) { ctx.fillStyle = SC_COLORS[sc.key]; ctx.fillRect(X(W.toSize) - 1, yy, 2, bh); }
      });
    });
    axes(ctx, w, h, m);
    ctx.font = FONT_SMALL; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    for (const d of logTicks(lo, hi)) ctx.fillText(fmtD(d), X(d), h - m.b + 15);
    ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(X(B), m.t); ctx.lineTo(X(B), h - m.b); ctx.stroke();
    $('anWinText').innerHTML = texts.join('<br>');
  }

  // ---------------------------------------------------------------- inputs, developed cut, verdict
  // what every answer here rests on, said every time
  function inputsLine(res) {
    const psf = psfFromSettings(app.project.psf), src = app.project.psf.mode;
    const psfNote = src === 'mc' && !app.project.psf.mc ? 'from beam energy and substrate (no Monte Carlo run yet)' : src === 'table' ? 'imported table' : src === 'mc' ? 'Monte Carlo' : src === 'manual' ? 'typed in' : 'from beam energy and substrate';
    $('anInputs').innerHTML = `<b>Only as good as its inputs.</b> These answers follow from the PSF, the resist's contrast curve with its thickness, and the development the curve was measured with — not from the machine. ${res.lib ? 'The library’s curve is measured, published or a best guess, and moved to your conditions by a model — the line below says which, and how far to trust it' : 'The presets are illustrative'}; calibrate against your own dose test (bottom left) before you trust an absolute dose.`
      + `<div class="an-inputs-list"><span>PSF: ${esc(psfLabel(psf))} — ${psfNote}</span>${res.lib ? libLine(res) : `<span>Resist: ${esc(RESIST_LABELS[S().resist] || S().resist)}, ${res.thicknessNm} nm, D₁₀₀ ${fmtD(res.D100)} µC/cm², γ ${res.gamma}${res.custom ? '' : ' (preset values)'}</span>`}`
      + `<span class="${res.deviation.outside ? 'an-bad' : ''}">Development: ${esc(describeCal(res.dev))}${res.deviation.outside ? ` — ⚠ curve measured for ${esc(describeCal(res.cal))}` : ' — as the curve was measured'}</span></div>`;
  }

  // a library resist in the banner: where its curve comes from, and whether that is inside the process window
  function libLine(res) {
    const { entry: e, cond: c, P, pm } = res.lib, cls = { measured: 'ok', window: 'win', extrapolated: 'ext', unsupported: 'bad' }[P.regime];
    return `<span>Resist: <b>${esc(e.name)}</b> from the resist library, ${res.thicknessNm} nm at ${c.kV} kV — D₁₀₀ ${fmtD(res.D100)} µC/cm² (±${pm} %), γ ${res.gamma}${res.custom ? ' (your values)' : ''}</span>`
      + `<span class="an-reg an-reg-${cls}">${esc(REGIME_TEXT[P.regime])}${P.excursions.length ? `: ${esc(P.excursions.join('; '))}` : ''} — from ${esc(P.basis)}</span>`;
  }

  // the resist left along the selected probe, as written (Fab Studio's colours)
  function drawDeveloped(P, res) {
    const { ctx, w, h } = setupCanvas($('anDevCut')), m = { l: 52, r: 10, t: 12, b: 30 };
    const q = P?.per.w?.verdict;
    if (!P || !q) { ctx.font = FONT; ctx.fillStyle = '#888'; ctx.fillText('Select a probe.', 12, 24); $('anDevTitle').textContent = ''; return; }
    const xs = P.R.s, x0 = xs[0], x1 = xs[xs.length - 1], T = res.thicknessNm, sub = 0.35 * T;
    const X = (x) => m.l + (x - x0) / (x1 - x0) * (w - m.l - m.r), Y = (z) => h - m.b - (z + sub) / (T * 1.15 + sub) * (h - m.t - m.b);
    const rgb = (k) => `rgb(${MAT_COLOR[k].join(',')})`;
    ctx.fillStyle = rgb(M.SI); ctx.fillRect(X(x0), Y(0), X(x1) - X(x0), Y(-sub) - Y(0));
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(X(x0), Y(0), X(x1) - X(x0), 2);          // a little sheen on the wafer
    const resistKey = { PMMA: M.PMMA, CSAR: M.CSAR, MEDUSA: M.MEDUSA, S1813: M.S1813, AZ5214E: M.AZ5214E, SU8: M.SU8, MAN2400: M.MAN2400 }[res.lib ? res.lib.entry.id : S().resist] ?? M.RESIST;
    ctx.fillStyle = rgb(resistKey); ctx.strokeStyle = '#9a4d6a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(x0), Y(0));
    for (let i = 0; i < xs.length; i++) ctx.lineTo(X(xs[i]), Y(q.rem[i]));
    ctx.lineTo(X(x1), Y(0)); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (P.R.drawn) { ctx.strokeStyle = '#555'; ctx.setLineDash([3, 3]); for (const x of [P.R.drawn.left, P.R.drawn.right]) { ctx.beginPath(); ctx.moveTo(X(x), Y(-sub)); ctx.lineTo(X(x), Y(T * 1.1)); ctx.stroke(); } ctx.setLineDash([]); }
    ctx.strokeStyle = '#bbb'; ctx.beginPath(); ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, h - m.b); ctx.stroke();
    ctx.font = FONT_SMALL; ctx.fillStyle = '#555'; ctx.textAlign = 'right';
    for (const z of [0, T / 2, T]) ctx.fillText(`${Math.round(z)} nm`, m.l - 4, Y(z) + 4);
    ctx.textAlign = 'center';
    const xsStep = niceStep(x1 - x0, 5); for (let x = Math.ceil(x0 / xsStep) * xsStep; x <= x1; x += xsStep) ctx.fillText(fmtLen(x), X(x), h - m.b + 15);
    ctx.fillText('position along the probe — dashed: the drawn feature', (m.l + w - m.r) / 2, h - 2);
    $('anDevTitle').textContent = ` — at ${fmtD(S().baseDose ?? app.nominalDose())} µC/cm², ${res.dev.timeS} s`;
  }

  function verdictBox(P, res) {
    const q = P?.per.w?.verdict, el = $('anVerdict');
    if (!P || !q) { el.innerHTML = '<div class="hint">Select a probe across a feature.</div>'; return; }
    const head = q.level === 'ok' ? '<div class="an-verdict ok">✓ Prints</div>' : q.level === 'warn' ? '<div class="an-verdict warn">! Prints, with remarks</div>' : '<div class="an-verdict fail">✕ Does not print</div>';
    const neg = res.tone === 'negative', f = (v) => (v == null ? '—' : fmtLen(v));
    const facts = [
      [neg ? 'Full-height width' : 'Bottom width (cleared)', q.width > 0 ? `${f(q.width)}${q.err != null ? ` (${pct(q.err)} of ${f(P.target)})` : ''}` : '—'],
      [neg ? 'Foot spreads' : 'Top opening', q.topWidth != null ? (neg ? `${f(q.wallNm)} each side` : `${f(q.topWidth)} — walls ${f(q.wallNm)} each side`) : '—'],
      [neg ? 'Line height' : 'Resist beside it', q.ridgeNm != null ? `${q.ridgeNm.toFixed(0)} of ${res.thicknessNm} nm` : '—'],
      [neg ? 'Residue in the spaces' : 'Left in the opening', q.residueNm != null ? `${q.residueNm.toFixed(1)} nm` : '—'],
    ];
    el.innerHTML = head + `<ul class="an-reasons">${q.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      + `<table class="keytab">${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`
      + `<div class="hint" style="margin-top:6px;">1D development per point (as Fab Studio): no undercut, no lateral dissolution, no pattern collapse. The verdict is the model's; the contrast curve decides it.</div>`;
  }

  // ---------------------------------------------------------------- render
  const measuredOf = (p) => {
    if (!p) return [];
    return (S().measured[p.id] || '').split(/\r?\n/).map((l) => l.split(/[,;\t ]+/).map(Number)).filter((a) => a.length >= 2 && a[0] > 0 && a[1] >= 0);
  };
  function render() {
    if (!app.isTabActive('analysis')) return;
    const s = S(), res = resistOf(s), D100 = res.D100, D0 = D100 * 10 ** (-1 / res.gamma), Dc = threshold(s);
    const B = s.baseDose ?? app.nominalDose();
    const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    resistOptions(res); $('anResist').value = s.resist; keep('anD100', D100); keep('anTol', s.tol); keep('anDose', +B.toFixed(1));
    keep('anThick', res.thicknessNm); keep('anGamma', res.gamma); keep('anRound', Math.round(100 * res.round)); keep('anScum', res.scumNm); keep('anDark', res.darkNmMin);
    $('anCalDev').value = res.cal.developer; keep('anCalT', res.cal.timeS); keep('anCalC', res.cal.tempC);
    $('anDevDev').value = res.dev.developer; keep('anDevT', res.dev.timeS); keep('anDevC', res.dev.tempC);
    $('anCalBox').hidden = !!res.lib;
    if (res.lib) $('anDevNote').innerHTML = `<span style="color:${res.deviation.outside ? '#b45309' : res.lib.P.regime === 'measured' ? '#15803d' : '#1e3a8a'}">${res.deviation.outside ? '⚠ ' : ''}${esc(res.deviation.text)}</span>${res.lib.P.notes.length ? `<br>${res.lib.P.notes.map(esc).join('<br>')}` : ''} <a href="#" id="anToLib">Open in Resists</a>`;
    else $('anDevNote').innerHTML = res.deviation.outside ? `<span style="color:#b45309">⚠ ${esc(res.deviation.text)}</span>` : `<span style="color:#15803d">✓ develops as the curve was measured.</span> Dark erosion ${res.darkLossNm.toFixed(1)} nm.`;
    inputsLine(res);
    $('anDoseSlider').value = Math.round(1000 * Math.log(B / 10) / Math.log(1e5 / 10));
    $('anUnc').checked = !!s.showUncorrected; $('anKept').checked = !!s.kept;
    $('anUncHint').textContent = correctionInUse() ? '' : '(no correction in use)';
    $('anKeptHint').textContent = keptPsfs().length ? `(${keptPsfs().length})` : '(none kept)';
    // probe list
    const all = s.probes.map((p, i) => ({ p, i, P: probeNumbers(p, s, Dc, B) }));
    $('anProbeList').innerHTML = s.probes.length ? all.map(({ p, i, P }) => `<div class="an-probe${p.id === sel()?.id ? ' on' : ''}" data-id="${p.id}"><span class="an-dot" style="background:${PROBE_COLORS[i % PROBE_COLORS.length]}"></span><span class="an-pname">${esc(p.name)}</span><span class="hint">${P?.target ? fmtLen(P.target) : results.get(p.id)?.error ? 'error' : '…'}</span><input class="an-target" data-id="${p.id}" type="number" min="1" step="1" placeholder="target nm" value="${p.target ?? ''}" title="Target width (nm); blank = the drawn width"><button class="an-x" data-del="${p.id}" title="Remove">×</button></div>`).join('')
      : '<div class="hint">No probes yet. <b>Find features</b> puts one across each kind of shape.</div>';
    const cur = all.find((q) => q.p.id === sel()?.id);
    const P = cur?.P || null;
    $('anProfTitle').textContent = P ? ` — ${cur.p.name}, drawn ${P.R.drawn ? fmtLen(P.R.drawn.width) : '—'}` : '';
    $('anCdTitle').textContent = P?.per.w?.win?.toSize ? ` — to size at ${fmtD(P.per.w.win.toSize)} µC/cm²` : '';
    $('anMeasLabel').textContent = cur ? `Measured on ${cur.p.name}` : 'Measured on the selected probe';
    if (document.activeElement !== $('anMeas')) $('anMeas').value = cur ? (s.measured[cur.p.id] || '') : '';
    drawMap(); drawProfile(P, s, D100, B, D0, Dc); drawDeveloped(P, res); drawCd(P, s, Dc, B); drawWindows(all, s, B); verdictBox(P, res);
    $('anClearNote').innerHTML = Dc > D100 * 1.005 ? `The curve's rounding leaves ${(100 * remainingFraction(resistModel({ ...res, scumNm: 0 }), D100) * res.thicknessNm / 100).toFixed(0)} nm at D₁₀₀: ${res.tone === 'negative' ? 'full height' : 'fully cleared'} only from <b>${fmtD(Dc)}</b> µC/cm² (${(Dc / D100).toFixed(2)} × D₁₀₀). Widths are read there, as Fab Studio develops.` : `${res.tone === 'negative' ? 'Full height' : 'Fully cleared'} at D₁₀₀.`;
    // table
    const scs = all.find((q) => q.P)?.P.scs || scenarios();
    const head = `<tr><td><b>probe</b></td><td><b>target</b></td>${scs.map((sc) => `<td><b style="color:${SC_COLORS[sc.key]}">${esc(sc.label)}</b><br><span class="hint">width at ${fmtD(B)} · dose to size · window (EL) · nm per % dose</span></td>`).join('')}</tr>`;
    const rows = all.map(({ p, P }) => `<tr><td>${esc(p.name)}</td><td>${P?.target ? fmtLen(P.target) : '—'}</td>${scs.map((sc) => {
      const q = P?.per[sc.key]; if (!q) return '<td>—</td>';
      const err = q.at.cd > 0 && P.target ? (q.at.cd - P.target) / P.target : null;
      const bad = err == null || Math.abs(err) > s.tol / 100;
      const vm = q.verdict ? `<b class="an-v an-v-${q.verdict.level}" title="${esc(q.verdict.reasons.join('; '))}">${q.verdict.level === 'ok' ? '✓' : q.verdict.level === 'warn' ? '!' : '✕'}</b> ` : '';
      return `<td>${vm}<span style="color:${bad ? '#b45309' : '#15803d'}">${q.at.cd > 0 ? fmtLen(q.at.cd) : 'not cleared'}${err != null ? ` (${pct(err)})` : ''}${q.at.openL || q.at.openR || q.at.merged ? ' merged' : ''}</span><br>${fmtD(q.win.toSize)} · ${q.win.lo ? `${fmtD(q.win.lo)}–${fmtD(q.win.hi)} (EL ${(100 * (q.win.hi - q.win.lo) / q.win.toSize).toFixed(0)} %)` : 'none'} · ${q.slope ? (q.slope.dCDdlnD / 100).toFixed(2) : '—'}</td>`;
    }).join('')}</tr>`).join('');
    $('anTable').innerHTML = `<table class="keytab an-table">${head}${rows}</table>`;
  }

  // the resist list: the library (with each resist's developers) and Fab Studio's illustrative presets
  let optKey = '';
  function resistOptions(res) {
    const lib = app.resists?.library() || [];
    const devs = res.lib ? [...new Set([res.lib.entry.model.ref.developer, ...(res.lib.entry.window?.developers || []), ...Object.keys(res.lib.entry.model.developers || {}), res.dev.developer])] : null;
    const key = JSON.stringify([lib.map((r) => r.id), devs]);
    if (key === optKey) return; optKey = key;
    $('anResist').innerHTML = (lib.length ? `<optgroup label="Resist library (DTU Nanolab)">${lib.map((r) => `<option value="${LIB_PREFIX}${esc(r.id)}">${esc(r.name)}</option>`).join('')}</optgroup>` : '')
      + `<optgroup label="Illustrative presets (Fab Studio)">${Object.keys(RESIST_PRESETS).map((k) => `<option value="${k}">${esc(RESIST_LABELS[k] || k)}</option>`).join('')}</optgroup>`;
    $('anDevDev').innerHTML = devs ? devs.map((d) => `<option value="${esc(d)}">${esc(app.resists.devName(d))}</option>`).join('') : Object.entries(DEVELOPERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  }

  // ---------------------------------------------------------------- controls
  root.addEventListener('click', (ev) => { if (ev.target.id === 'anToLib') { ev.preventDefault(); const r = resistOf(S()); if (r.lib) app.resists.select(r.lib.entry.id, r.lib.cond); } });
  const readNum = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  $('anExplainBtn').onclick = () => { $('anExplain').hidden = !$('anExplain').hidden; };
  $('anAuto').onclick = findFeatures;
  $('anDraw').onclick = () => { drawMode = !drawMode; $('anDraw').classList.toggle('active', drawMode); $('anMapHint').textContent = drawMode ? 'drag across a feature to add a probe' : 'wheel zooms, drag pans'; };
  $('anFromEx').onclick = () => { const l = app.exposureCutLine(); addProbe(l, 'Exposure cut-line'); };
  $('anClear').onclick = () => { const s = S(); s.probes = []; s.selected = null; results.clear(); app.markDirty(); render(); };
  $('anFit0').onclick = () => { fitView(); drawMap(); };
  $('anProbeList').addEventListener('click', (e) => {
    const x = e.target.closest('[data-del]'); const s = S();
    if (x) { s.probes = s.probes.filter((p) => p.id !== x.dataset.del); results.delete(x.dataset.del); if (s.selected === x.dataset.del) s.selected = s.probes[0]?.id ?? null; app.markDirty(); render(); return; }
    const row = e.target.closest('.an-probe'); if (row && !e.target.closest('input')) { s.selected = row.dataset.id; app.markDirty(); render(); }
  });
  $('anProbeList').addEventListener('change', (e) => { const t = e.target.closest('.an-target'); if (!t) return; const p = probeById(t.dataset.id); const v = parseFloat(t.value); p.target = v > 0 ? v : undefined; if (p.target === undefined) delete p.target; app.markDirty(); render(); });
  $('anResist').onchange = () => { const s = S(); s.resist = $('anResist').value; for (const k of ['D100', 'gamma', 'round', 'scumNm', 'darkNmMin', 'cal', 'dev']) s[k] = null; app.markDirty(); render(); };
  $('anD100').oninput = () => { S().D100 = readNum('anD100'); app.markDirty(); render(); };
  const field = (id, key, f = (v) => v) => { $(id).oninput = () => { const v = readNum(id); S()[key] = v == null ? null : f(v); app.markDirty(); render(); }; };
  field('anThick', 'thickNm', (v) => Math.max(1, v)); field('anGamma', 'gamma', (v) => Math.max(0.5, v)); field('anRound', 'round', (v) => Math.min(1, Math.max(0, v / 100)));
  field('anScum', 'scumNm', (v) => Math.max(0, v)); field('anDark', 'darkNmMin', (v) => Math.max(0, v));
  // the curve's calibration and the planned development; a new calibration moves the plan with it
  const cond = (which) => { const s = S(), r = resistOf(s), pre = which === 'cal' ? 'anCal' : 'anDev';
    const v = { developer: $(pre + 'Dev').value, timeS: readNum(pre + 'T') ?? r[which].timeS, tempC: readNum(pre + 'C') ?? r[which].tempC };
    if (r.lib && which === 'dev') { s.dev = v; app.markDirty(); render(); return; }
    if (which === 'cal') { const was = r.cal; s.cal = v; if (!s.dev || (s.dev.developer === was.developer && s.dev.timeS === was.timeS && s.dev.tempC === was.tempC)) s.dev = { ...v }; } else s.dev = v;
    app.markDirty(); render(); };
  for (const id of ['anCalDev', 'anCalT', 'anCalC']) { $(id).oninput = () => cond('cal'); $(id).onchange = () => cond('cal'); }
  for (const id of ['anDevDev', 'anDevT', 'anDevC']) { $(id).oninput = () => cond('dev'); $(id).onchange = () => cond('dev'); }
  $('anTol').oninput = () => { S().tol = Math.min(50, Math.max(1, readNum('anTol') ?? 10)); app.markDirty(); render(); };
  $('anDose').oninput = () => { const v = readNum('anDose'); if (v > 0) { S().baseDose = v; app.markDirty(); render(); } };
  $('anDoseSlider').oninput = () => { S().baseDose = +(10 * (1e5 / 10) ** ($('anDoseSlider').value / 1000)).toPrecision(4); app.markDirty(); render(); };
  $('anUnc').onchange = () => { S().showUncorrected = $('anUnc').checked; app.markDirty(); results.clear(); computeAll(); render(); };
  $('anKept').onchange = () => { S().kept = $('anKept').checked; app.markDirty(); results.clear(); computeAll(); render(); };
  $('anToSize').onclick = () => {
    const s = S(), p = sel(), P = p && probeNumbers(p, s, threshold(s), s.baseDose ?? app.nominalDose());
    const d = P?.per.w?.win?.toSize;
    if (!d) { toast(P?.per.w?.win?.why ? `No dose gives the target width: ${esc(P.per.w.win.why)}.` : 'Select a probe across a feature first.'); return; }
    s.baseDose = +d.toPrecision(4); app.markDirty(); render();
  };
  $('anBest').onclick = () => {
    const s = S(), D100 = threshold(s), B = s.baseDose ?? app.nominalDose();
    const wins = s.probes.map((p) => probeNumbers(p, s, D100, B)?.per.w?.win).filter(Boolean);
    const cw = commonWindow(wins);
    if (!cw) { toast('No dose prints every probe within the tolerance (see the process window). Correct the proximity effect, or remove the probe that does not fit.', 6000); return; }
    s.baseDose = +Math.sqrt(cw.lo * cw.hi).toPrecision(4); app.markDirty(); render();
    toast(`The middle (in log dose) of the shared window: ${fmtD(s.baseDose)} µC/cm².`);
  };
  $('anToJeol').onclick = () => {
    const s = S(), B = s.baseDose ?? app.nominalDose();
    app.project.settings.jeol ??= {}; app.project.settings.jeol.baseDose = +B.toPrecision(4); app.markDirty();
    toast(`RESIST in the JEOL tab set to ${fmtD(B)} µC/cm² (the absolute dose of the nominal).`);
  };
  $('anMeas').oninput = () => { const p = sel(); if (!p) return; S().measured[p.id] = $('anMeas').value; app.markDirty(); render(); };

  // ---------------------------------------------------------------- calibration
  $('anFit').onclick = async () => {
    const s = S(), psf = psfFromSettings(app.project.psf), terms = psf.gauss ?? psf.fit?.terms;
    const withData = s.probes.filter((p) => measuredOf(p).length);
    if (!withData.length) { toast('Type measured widths (dose, width) for at least one probe.'); return; }
    if (!terms || terms.length < 2) { toast('The PSF has no Gaussian terms to fit.'); return; }
    const sorted = [...terms].sort((a, b) => a.s - b.s), fwd = sorted[0], back = sorted[sorted.length - 1], mid = sorted.length > 2 ? sorted[1] : null;
    const eta0 = back.w / fwd.w, nu = mid ? mid.w / fwd.w : 0;
    $('anFitOut').textContent = 'Computing the dose of each PSF term along the probes…';
    try {
      const items = [];
      for (const p of withData) {
        const scs = [{ key: 'fwd', field: s.field, term: { s: fwd.s, kind: fwd.kind || 'gauss', label: 'forward' }, wideNm: back.s }, { key: 'back', field: s.field, term: { s: back.s, kind: back.kind || 'gauss', label: 'back' }, wideNm: back.s }];
        if (mid) scs.push({ key: 'mid', field: s.field, term: { s: mid.s, kind: mid.kind || 'gauss', label: 'mid' }, wideNm: back.s });
        const R = await probeProfiles(p, scs, query, { nominal: app.nominalDose() });
        items.push({ s: R.s, ref: R.ref, P: { fwd: R.profiles.fwd, back: R.profiles.back, mid: R.profiles.mid }, meas: measuredOf(p).map(([dose, cd]) => ({ dose, cd })), probe: p });
      }
      fitResult = calibrate(items, { D100: threshold(s), eta: eta0, nu, fitEta: $('anFitEta').checked });
      fitResult.Dclear = fitResult.D100; fitResult.D100 = fitResult.Dclear * resistOf(s).D100 / threshold(s);   // the D₁₀₀ that clears fully there, with this curve's shape
      fitResult.eta0 = eta0; fitResult.table = !psf.gauss;
      const f = fitResult;
      $('anFitOut').innerHTML = `<b>D₁₀₀ = ${fmtD(f.D100)} µC/cm²</b>${Math.abs(f.Dclear / f.D100 - 1) > 0.005 ? ` (fully cleared at ${fmtD(f.Dclear)} with this curve's rounding)` : ''}${$('anFitEta').checked ? `, <b>η = ${f.eta.toFixed(3)}</b> (was ${eta0.toFixed(3)})` : ''} — rms misfit ${f.rms.toFixed(1)} nm over ${f.n} widths.`
        + (f.etaCheck ? (f.etaDetermined
          ? `<br>Moving η by 25 % (and refitting D₁₀₀) raises the misfit by ${f.etaCheck.rise.toFixed(1)} nm — more than the scatter of the fit: η is determined.`
          : `<br><span style="color:#b45309">η is not pinned down by these widths: moving it by 25 % (and refitting D₁₀₀) raises the misfit by only ${f.etaCheck.rise.toFixed(1)} nm, no more than the scatter of the fit. Add features that collect different backscatter — an isolated line and the same line in a large dense area, or next to a large pad.</span>`) : '')
        + (f.table ? '<br><span style="color:#b45309">The PSF in use is a table: its fitted model was used for the terms.</span>' : '');
      $('anUseD100').disabled = false; $('anUseEta').disabled = !$('anFitEta').checked || f.etaDetermined === false;
    } catch (e) { $('anFitOut').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
  };
  $('anUseD100').onclick = () => { if (!fitResult) return; const s = S(); s.D100 = +fitResult.D100.toPrecision(4); app.markDirty(); render(); toast(`D₁₀₀ set to ${fmtD(s.D100)} µC/cm².`); };
  $('anUseEta').onclick = () => {
    if (!fitResult) return;
    const psf = psfFromSettings(app.project.psf), f = psf.fit, ps = app.project.psf;
    Object.assign(ps, { mode: 'manual', model: f.model || 'double', alpha: f.alpha, beta: f.beta, eta: +fitResult.eta.toPrecision(4), gamma: f.gamma ?? null, nu: f.nu ?? 0 });
    app.psfChanged('fitted η'); results.clear(); computeAll(); render();
    toast(`PSF set to manual with η = ${ps.eta} (α, β as before). The PSF tab shows it.`, 5000);
  };

  // ---------------------------------------------------------------- CSV
  $('anCsv').onclick = () => {
    const s = S(), res = resistOf(s), B = s.baseDose ?? app.nominalDose();
    const lines = [`# EBL Workbench analysis — resist ${s.resist}, D100 ${res.D100} uC/cm2 (widths read where fully developed: ${threshold(s).toFixed(1)} uC/cm2), ${res.thicknessNm} nm, development ${describeCal(res.dev)}${res.deviation.outside ? ' (OUTSIDE the curve calibration ' + describeCal(res.cal) + ')' : ''}, dose ${B} uC/cm2, tolerance ${s.tol} %, PSF ${psfLabel(psfFromSettings(app.project.psf))}`, 'probe,scenario,target_nm,width_nm,dose_to_size,window_lo,window_hi,latitude,nm_per_percent_dose'];
    for (const p of s.probes) { const P = probeNumbers(p, s, threshold(s), B); if (!P) continue; for (const sc of P.scs) { const q = P.per[sc.key]; if (!q) continue; lines.push([JSON.stringify(p.name), JSON.stringify(sc.label), P.target?.toFixed(2), q.at.cd.toFixed(2), q.win.toSize?.toFixed(2) ?? '', q.win.lo?.toFixed(2) ?? '', q.win.hi?.toFixed(2) ?? '', q.win.latitude.toFixed(4), q.slope ? (q.slope.dCDdlnD / 100).toFixed(3) : ''].join(',')); } }
    download('analysis.csv', lines.join('\n') + '\n', 'text/csv');
  };

  const redraw = onResize([mapEl, $('anProf'), $('anDevCut'), $('anCd'), $('anWin')], () => render());
  function show() { render(); computeAll(); redraw(); }
  function reset() { results.clear(); fitResult = null; view.fitted = false; computing = null; }
  return { show, reset, render, computeAll, _test: { S, results: () => results, probeNumbers, findFeatures, fit: () => fitResult, cdAt, view, threshold: () => threshold(S()) } };
}

export const ANALYSIS_CSS = `
  .an-reg { padding:1px 8px; border-radius:7px; font-weight:600; } .an-reg-ok { background:#dcfce7; color:#14532d; } .an-reg-win { background:#dbeafe; color:#1e3a8a; } .an-reg-ext { background:#fef3c7; color:#92400e; } .an-reg-bad { background:#fee2e2; color:#7f1d1d; }
  .an-inputs { margin:0 0 10px; padding:8px 12px; border-radius:10px; background:#f4f6fa; border:1px solid #d8dee8; font-size:13px; color:#333; }
  .an-inputs-list { display:flex; flex-wrap:wrap; gap:4px 18px; margin-top:4px; color:#555; font-size:12px; }
  .an-inputs-list .an-bad { color:#b45309; font-weight:600; }
  .an-verdict { font-size:20px; font-weight:700; margin:0 0 4px; } .an-verdict.ok { color:#15803d; } .an-verdict.warn { color:#b45309; } .an-verdict.fail { color:#b91c1c; }
  .an-reasons { margin:0 0 8px 18px; padding:0; font-size:13px; line-height:1.45; }
  .an-v { display:inline-block; width:16px; text-align:center; } .an-v-ok { color:#15803d; } .an-v-warn { color:#b45309; } .an-v-fail { color:#b91c1c; }
  .an-intro { margin:0 0 10px; color:#333; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .an-explain ol { margin:0; padding-left:20px; line-height:1.5; } .an-explain li { margin:3px 0; }
  .an-two { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
  @media (max-width: 1300px) { .an-two { grid-template-columns:minmax(0,1fr); } }
  .an-chart { width:100%; height:240px; display:block; }
  .an-probe { display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:6px; cursor:pointer; font-size:13px; }
  .an-probe:hover { background:#f3f5f8; } .an-probe.on { background:#e8eefb; }
  .an-dot { flex:0 0 10px; height:10px; border-radius:50%; }
  .an-pname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .an-target { width:78px; border:1px solid #ccc; border-radius:6px; padding:1px 4px; font-size:12px; }
  .an-x { border:0; background:none; color:#999; cursor:pointer; font-size:15px; } .an-x:hover { color:#c00; }
  .an-table td { font-size:12px; white-space:nowrap; }
`;
