// JEOL tab: a machine-specific module for the JBX-9500FS at DTU Nanolab. It plans one write of the
// Workbench's pattern: beam condition, write time (JEOL's own time model, fitted to its wrtest
// estimates), the dose ranks (MODULAT), and the jobdeck (.jdf) and schedule (.sdf) files. The
// pattern file itself (.v30) is made by BEAMER from the Workbench's dose-class GDS.
//
// Settings live in project.settings.jeol, so they travel with the project file.

import { $, esc, toast, download, pickFile } from '../dom.js';
import { JBX9500_DTU } from '../../core/jeol/profile.js';
import { patternStats, doseRanks, writeTime, currentSweep, jdfText, sdfText, checkPlan, parseWrtestCSV, fmtHMS } from '../../core/jeol/plan.js';

const P = JBX9500_DTU;
const SEG = [
  ['exposure', 'Beam on (exposure)', '#2f6fd6'], ['figures', 'Figure settling', '#7c5cd6'], ['stage', 'Stage moves', '#d6532f'],
  ['initial', 'Initial calibration (current, height map)', '#c9a400'], ['cyclic', 'Cyclic calibration (current, drift)', '#2a9d8f'], ['other', 'Cassette preparation and end', '#888'],
];
const fmtT = (s) => (s < 90 ? `${s.toFixed(1)} s` : s < 5400 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(2)} h`);
const um2 = (nm2) => (nm2 / 1e6 >= 1e4 ? `${(nm2 / 1e6).toExponential(3)} µm²` : `${(nm2 / 1e6).toFixed(nm2 / 1e6 < 10 ? 3 : 1)} µm²`);

export const JEOL_DEFAULTS = {
  source: 'auto', calprm: null, stdcur: null, pitchNm: 4, baseDose: null, ffocus: true, transport: true,
  waferIn: 3, array: { x0: 0, nx: 1, dx: 0, y0: 0, ny: 1, dy: 0 }, offset: [0, 0],
  magazine: 'WAFER', jdfName: 'pattern', v30: 'pattern.v30', jobName: 'WAFER', shelf: 6, slot: '3C', path: 'DRF5M',
};

export function createJeolTab(app) {
  const root = $('tab-jeol');
  const S = () => {
    app.project.settings ??= {};
    const s = app.project.settings.jeol ??= {};
    for (const [k, v] of Object.entries(JEOL_DEFAULTS)) if (s[k] === undefined) s[k] = Array.isArray(v) ? [...v] : typeof v === 'object' && v ? { ...v } : v;
    return s;
  };
  let cache = { key: null, stats: null }, wrtest = null, last = null;

  root.innerHTML = `
  <div class="machine-banner"><b>${esc(P.name)}</b> · ${esc(P.site)} · ${P.kV} kV <span class="machine-chip">machine-specific module</span>
    <span class="hint" style="color:inherit;opacity:.85;">Plans a write on this machine: beam current, write time, dose ranks and the job files. The pattern file (.v30) is still made by BEAMER.</span>
    <span class="q" data-tip="${esc(P.source)}<br><br>The time model is JEOL's: beam-on time from the area, dose and current, plus figure settling, stage moves and the calibrations of the DRF5M path. Its constants were fitted to JEOL wrtest estimates of DTU jobs; on the ShapeMatrix_v2 job the model gives the layer time within 1 % when the doses are known.<br><br>Other machines and other sites: the numbers will not apply.">?</span></div>
  <div class="grid">
    <div class="col">
      <div class="panel">
        <div class="section-title">Pattern <span class="q" data-tip="<b>Fractured writing data</b> — the fragments and dose classes from Exposure → Fracture &amp; correct → Use as writing data. Each dose class becomes one shot rank (rank k = class k = the GDS datatype the dose-class export gives it).<br><b>Design doses</b> — the shapes as drawn, each at its writing dose (after a per-shape correction) or its design dose. One rank per distinct dose.<br><br>Markers, device areas and high-resolution zones are not written.">?</span></div>
        <select class="field" id="jlSource"><option value="auto">automatic (writing data if in use)</option><option value="writing">fractured writing data (dose classes)</option><option value="design">design doses (shapes as drawn)</option></select>
        <div class="hint" id="jlPattern" style="margin-top:6px;"></div>
      </div>
      <div class="panel">
        <div class="section-title">Beam <span class="q" data-tip="<b>CALPRM</b> — the calibration file, which sets the beam current and the aperture (LabAdviser's list; type another name if the machine has it).<br><b>STDCUR</b> — the current the machine uses to compute the shot time; LabAdviser: about 10 % above the nominal, so that a beam slightly stronger than nominal cannot break the 10 ns limit.<br><b>Beam pitch</b> — the distance between shots (SHOT A,n with n in units of 0.25 nm).<br><b>RESIST</b> — the absolute dose of the Workbench's nominal dose; every rank is a percentage of the nominal.<br><b>FFOCUS</b> — refocus every field from the height map. The height map itself (HEIMAP, about 4 min) is part of the DRF5M calibration at the start either way; without FFOCUS the machine uses only the HEIMAP points.">?</span></div>
        <div class="two">
          <div><div class="label">Beam condition (CALPRM)</div><select class="field" id="jlCal">${P.calprm.map((c) => `<option value="${c.name}">${c.nA} nA · ap ${c.aperture} (${c.name})</option>`).join('')}<option value="__other">other…</option></select></div>
          <div><div class="label">STDCUR (nA)</div><input class="field" id="jlStd" type="number" min="0.01" step="0.1" placeholder="auto"></div>
          <div id="jlCalOtherBox" style="display:none;"><div class="label">CALPRM name</div><input class="field" id="jlCalOther" placeholder="e.g. 8na_ap5"></div>
          <div id="jlCalNABox" style="display:none;"><div class="label">its current (nA)</div><input class="field" id="jlCalNA" type="number" min="0.01" step="0.1"></div>
          <div><div class="label">Beam pitch (nm)</div><input class="field" id="jlPitch" type="number" min="0.25" step="0.25"></div>
          <div><div class="label">RESIST (µC/cm²) <span class="q" data-tip="The absolute dose the Workbench's <b>nominal dose</b> (Pattern Studio, usually 100) is written at. The Workbench works in doses relative to the nominal; every rank is a percentage of it, and the machine writes RESIST × (1 + rank %). Blank: RESIST = the nominal (the doses are taken as absolute). The Analysis tab's dose to size can fill it in.">?</span></div><input class="field" id="jlBase" type="number" min="1" step="10" placeholder="= nominal"></div>
        </div>
        <label class="row" style="gap:6px;margin-top:8px;font-size:13px;"><input type="checkbox" id="jlFF"> FFOCUS (height map, refocus per field)</label>
        <label class="row" style="gap:6px;font-size:13px;"><input type="checkbox" id="jlTr"> Count the loading time (autoloader → stage)</label>
        <div class="hint" id="jlShot" style="margin-top:4px;"></div>
      </div>
      <div class="panel">
        <div class="section-title">Placement <span class="q" data-tip="Where the pattern goes on the substrate: an ARRAY of copies (µm, the first copy at x0, y0; rows go down in y). One copy: 1 × 1. Offsets shift the whole job (OFFSET in the schedule). Chip cassettes at DTU are converted 3″ wafer cassettes, so a chip job is a 3″ job.<br><br>First print only: alignment (GLMDET, CHIPAL) is added by hand — see LabAdviser.">?</span></div>
        <div class="two">
          <div><div class="label">Substrate (JOB/W, inch)</div><select class="field" id="jlWafer">${P.waferInches.map((w) => `<option value="${w}">${w}″${w === 3 ? ' (also chips)' : ''}</option>`).join('')}</select></div>
          <div><div class="label">Calibration path</div><select class="field" id="jlPath">${P.paths.map((p) => `<option>${p}</option>`).join('')}</select></div>
        </div>
        <div class="three" style="margin-top:6px;">
          <div><div class="label">x0 (µm)</div><input class="field" id="jlX0" type="number" step="100"></div>
          <div><div class="label">columns</div><input class="field" id="jlNX" type="number" min="1" step="1"></div>
          <div><div class="label">pitch x (µm)</div><input class="field" id="jlDX" type="number" step="100"></div>
          <div><div class="label">y0 (µm)</div><input class="field" id="jlY0" type="number" step="100"></div>
          <div><div class="label">rows</div><input class="field" id="jlNY" type="number" min="1" step="1"></div>
          <div><div class="label">pitch y (µm)</div><input class="field" id="jlDY" type="number" step="100"></div>
        </div>
        <div class="two" style="margin-top:6px;">
          <div><div class="label">OFFSET x (µm)</div><input class="field" id="jlOX" type="number" step="100"></div>
          <div><div class="label">OFFSET y (µm)</div><input class="field" id="jlOY" type="number" step="100"></div>
        </div>
      </div>
      <div class="panel">
        <div class="section-title">Job names <span class="q" data-tip="LabAdviser's rules: the magazine (MAGAZIN) at most 9 uppercase letters and digits, starting with a letter; the jobdeck file name at most 24 characters, no capitals, no spaces. The pattern file is the .v30 BEAMER will write; it goes in ${esc(P.patternDir)}.<br><b>#</b> is the autoloader shelf, <b>%</b> the slot in the cassette (e.g. 3C).">?</span></div>
        <div class="two">
          <div><div class="label">Magazine (SDF)</div><input class="field" id="jlMag"></div>
          <div><div class="label">JOB name</div><input class="field" id="jlJob"></div>
          <div><div class="label">Jobdeck file (.jdf)</div><input class="field" id="jlJdf"></div>
          <div><div class="label">Pattern file (.v30)</div><input class="field" id="jlV30"></div>
          <div><div class="label">Shelf (#)</div><input class="field" id="jlShelf" type="number" min="1" step="1"></div>
          <div><div class="label">Slot (%)</div><input class="field" id="jlSlot"></div>
        </div>
      </div>
    </div>
    <div class="col">
      <div class="panel" id="jlTimePanel">
        <div class="section-title">Write time</div>
        <div id="jlTime"></div>
      </div>
      <div class="panel"><div class="section-title">Problems</div><div id="jlChecks"></div></div>
      <div class="panel">
        <div class="section-title">Which current? <span class="q" data-tip="The same job at every beam condition: higher current writes faster, until the shortest shot (the lowest dose rank) drops below the 10 ns limit of the scanner. A larger beam pitch lengthens every shot. Click a row to use it.">?</span></div>
        <div id="jlSweep" style="max-height:260px;overflow:auto;"></div>
      </div>
      <div class="panel">
        <div class="section-title">Dose ranks (MODULAT) <span class="q" data-tip="Each rank is a percentage of the base dose (RESIST), written to the jobdeck as MOD001. The machine multiplies the shot time of every figure by its rank's factor. With fractured writing data, rank k is dose class k — the GDS datatype the dose-class export gives it, which BEAMER carries to the .v30.">?</span></div>
        <div id="jlRanks" style="max-height:280px;overflow:auto;"></div>
      </div>
      <div class="panel">
        <div class="section-title">Job files</div>
        <div class="row" style="margin-bottom:8px;">
          <button class="btn primary" id="jlDlJdf">Download .jdf</button><button class="btn primary" id="jlDlSdf">Download .sdf</button>
          <button class="btn" id="jlDlGds" title="The dose-class GDS (layer = datatype = dose class) for BEAMER">Export dose-class GDS for BEAMER…</button>
          <button class="btn" id="jlCsv" title="JEOL's own estimate, made by wrtest after SCHD: compare it with this one">Compare with JEOL's estimate (.csv)…</button>
        </div>
        <div class="two"><div><div class="label" id="jlJdfName">jobdeck</div><pre class="jl-file" id="jlJdfText"></pre></div><div><div class="label" id="jlSdfName">schedule</div><pre class="jl-file" id="jlSdfText"></pre></div></div>
        <ol class="hint" style="margin:8px 0 0 18px;padding:0;line-height:1.5;">
          <li><b>Export dose-class GDS</b> (Dose classes) and the _doses.txt beside it.</li>
          <li>In <b>BEAMER</b>: import the GDS with its datatypes as dose classes, export <b>JEOL52 (.v30)</b> named <span id="jlV30Name"></span>, with the shot-rank (modulation) numbers = the datatypes.</li>
          <li>Copy the .v30 to <code>${esc(P.patternDir)}</code>, the .jdf and .sdf to your job folder.</li>
          <li><b>SCHD</b> the .sdf, check the placement with <b>ACHK</b>, and (optionally) run <b>wrtest</b> — load its CSV here to compare.</li>
          <li>All of this before your session: LabAdviser's rule. The rank ↔ class mapping in BEAMER should be checked once on a test job.</li>
        </ol>
      </div>
      <div class="panel" id="jlCmpPanel" style="display:none;"><div class="section-title">This estimate and JEOL's</div><div id="jlCmp"></div></div>
    </div>
  </div>`;

  // ---------------------------------------------------------------- form ↔ settings
  const ids = { jlPitch: 'pitchNm', jlBase: 'baseDose', jlStd: 'stdcur', jlMag: 'magazine', jlJob: 'jobName', jlJdf: 'jdfName', jlV30: 'v30', jlShelf: 'shelf', jlSlot: 'slot' };
  function fill() {
    const s = S();
    const known = P.calprm.some((c) => c.name === s.calprm);
    $('jlSource').value = s.source;
    $('jlCal').value = known ? s.calprm : '__other';
    $('jlCalOtherBox').style.display = $('jlCalNABox').style.display = known ? 'none' : '';
    $('jlCalOther').value = known ? '' : s.calprm; $('jlCalNA').value = s.calNA ?? '';
    for (const [id, k] of Object.entries(ids)) $(id).value = s[k] ?? '';
    $('jlFF').checked = !!s.ffocus; $('jlTr').checked = s.transport !== false;
    $('jlWafer').value = s.waferIn; $('jlPath').value = s.path;
    const a = s.array; $('jlX0').value = a.x0; $('jlNX').value = a.nx; $('jlDX').value = a.dx; $('jlY0').value = a.y0; $('jlNY').value = a.ny; $('jlDY').value = a.dy;
    $('jlOX').value = s.offset[0]; $('jlOY').value = s.offset[1];
  }
  const numOr = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };
  function read() {
    const s = S();
    s.source = $('jlSource').value;
    const cal = $('jlCal').value === '__other' ? $('jlCalOther').value.trim() : $('jlCal').value;
    const calChanged = cal !== s.calprm, was = { base: s.baseDose, pitch: s.pitchNm };
    if (calChanged) s.suggested = false;
    if ($('jlCal').value === '__other') { s.calprm = cal; s.calNA = numOr('jlCalNA', null); }
    else { s.calprm = cal; delete s.calNA; }
    $('jlCalOtherBox').style.display = $('jlCalNABox').style.display = $('jlCal').value === '__other' ? '' : 'none';
    s.pitchNm = Math.max(P.pitchUnitNm, numOr('jlPitch', 4));
    s.baseDose = numOr('jlBase', null); s.stdcur = numOr('jlStd', null);
    // a typed STDCUR belongs to the beam condition it was typed for: a new CALPRM starts from auto (1.1 × nominal)
    if (calChanged && s.stdcur != null) { s.stdcur = null; $('jlStd').value = ''; toast('STDCUR is back to automatic (1.1 × the new beam\'s nominal current).'); }
    // a suggested beam (not chosen by you) is suggested again when RESIST or the pitch changes
    if (s.suggested && !calChanged && (s.baseDose !== was.base || s.pitchNm !== was.pitch)) s.calprm = null;
    s.magazine = $('jlMag').value.trim(); s.jobName = $('jlJob').value.trim(); s.jdfName = $('jlJdf').value.trim(); s.v30 = $('jlV30').value.trim();
    s.shelf = Math.round(numOr('jlShelf', 6)); s.slot = $('jlSlot').value.trim();
    s.ffocus = $('jlFF').checked; s.transport = $('jlTr').checked;
    s.waferIn = +$('jlWafer').value; s.path = $('jlPath').value;
    s.array = { x0: numOr('jlX0', 0), nx: Math.max(1, Math.round(numOr('jlNX', 1))), dx: numOr('jlDX', 0), y0: numOr('jlY0', 0), ny: Math.max(1, Math.round(numOr('jlNY', 1))), dy: numOr('jlDY', 0) };
    s.offset = [numOr('jlOX', 0), numOr('jlOY', 0)];
    app.markDirty();
  }
  root.addEventListener('input', (e) => { if (e.target.closest('.col') && e.target.id?.startsWith('jl')) { read(); update(); } });
  root.addEventListener('change', (e) => { if (e.target.id?.startsWith('jl')) { read(); update(); } });

  // ---------------------------------------------------------------- the plan
  function source() {
    const s = S(), w = app.project.writing, haveW = !!(w && w.active && w.library);
    const src = s.source === 'auto' ? (haveW ? 'writing' : 'design') : s.source;
    if (src === 'writing' && !haveW) return { src, missing: true };
    return { src, lib: src === 'writing' ? w.library : app.project.library, classes: src === 'writing' ? w.classes : null };
  }
  function stats(src) {
    const key = `${app.version}|${src.src}`;
    if (cache.key !== key) cache = { key, stats: patternStats(src.lib, { fieldUm: P.fieldUm, subfieldUm: P.subfieldUm }) };
    return cache.stats;
  }
  function currentOf(s) { const c = P.calprm.find((o) => o.name === s.calprm); return c ? c.nA : s.calNA ?? null; }
  function plan() {
    const s = S(), src = source();
    if (src.missing) return { error: 'No fractured writing data in use: run Exposure → Fracture &amp; correct → Use as writing data, or choose design doses.' };
    const st = stats(src);
    if (!st.areaNm2) return { error: 'Nothing to write: the pattern has no exposed area (markers, device areas and high-resolution zones are not written).' };
    // The Workbench's doses are relative to Pattern Studio's nominal dose: the ranks are percent of the
    // nominal, and RESIST is the absolute dose (µC/cm²) the nominal is written at
    const nominalDose = app.nominalDose();
    const base = s.baseDose ?? nominalDose;
    const ranks = doseRanks(st.doses, nominalDose, { maxRanks: P.maxRanks, levels: src.classes && src.classes.length ? src.classes : null });
    ranks.baseDose = base;
    for (const k of ranks.ranks) k.dose = base * k.factor;
    const shotN0 = Math.round(s.pitchNm / P.pitchUnitNm);
    if (!s.calprm) {
      // nothing chosen yet: the fastest condition that keeps 15 % above the 10 ns limit (else the lowest current)
      const sw = currentSweep({ stats: st, ranks, pitchNm: shotN0 * P.pitchUnitNm, ffocus: s.ffocus, path: s.path, instances: s.array.nx * s.array.ny, transport: s.transport }, P);
      const okc = sw.filter((c) => c.shortestShotNs >= 1.15 * P.minShotNs).sort((a, b) => a.total - b.total);
      s.calprm = (okc[0] || sw[0]).name; s.suggested = true; app.markDirty();
    }
    const nominal = currentOf(s);
    const stdcur = s.stdcur ?? (nominal ? +(nominal * P.stdcurOverNominal).toFixed(2) : null);
    if (!(stdcur > 0)) return { error: 'Give the beam current: choose a CALPRM from the list, or give the current of the one you typed.' };
    const shotN = Math.round(s.pitchNm / P.pitchUnitNm), pitchNm = shotN * P.pitchUnitNm;
    const instances = s.array.nx * s.array.ny;
    const p = { stats: st, ranks, pitchNm, stdcurNA: stdcur, ffocus: s.ffocus, path: s.path, calprm: s.calprm, instances, transport: s.transport };
    const time = writeTime(p, P);
    const job = { ...s, ranks, stdcurNA: stdcur, baseDose: base, shotN, note: `EBL Workbench ${new Date().toISOString().slice(0, 10)}` };
    return { s, src, st, ranks, time, job, p, nominal, pitchNm, checks: checkPlan(job, time, P) };
  }

  // ---------------------------------------------------------------- render
  function update() {
    if (!app.isTabActive('jeol')) return;
    let r;
    try { r = plan(); } catch (e) { r = { error: esc(e.message) }; }
    last = r;
    if (r.error) {
      $('jlPattern').innerHTML = `<span style="color:#b45309">${r.error}</span>`;
      for (const id of ['jlTime', 'jlChecks', 'jlSweep', 'jlRanks', 'jlJdfText', 'jlSdfText']) $(id).innerHTML = '';
      return;
    }
    const { s, src, st, ranks, time, job, pitchNm } = r;
    const n = s.array.nx * s.array.ny;
    $('jlPattern').innerHTML = `${src.src === 'writing' ? 'Fractured writing data' : 'Design doses'}: <b>${um2(st.areaNm2)}</b> exposed, ${ranks.fixed ? `${ranks.ranks.filter((k) => k.areaNm2 > 0).length} of ${ranks.ranks.length} dose classes used (rank = class)` : `${st.doses.length} dose${st.doses.length > 1 ? 's' : ''} → ${ranks.ranks.length} rank${ranks.ranks.length > 1 ? 's' : ''}`}, ${Math.round(st.figures).toLocaleString()} figures, ${st.fields} writing field${st.fields > 1 ? 's' : ''} of ${P.fieldUm} µm${st.fieldsApprox ? ' (approximate)' : ''}${n > 1 ? `; × ${n} copies` : ''}.${st.skippedLayers.length ? ` Not written: layer${st.skippedLayers.length > 1 ? 's' : ''} ${st.skippedLayers.map(esc).join(', ')}.` : ''}`;
    $('jlShot').innerHTML = `${s.suggested ? '<b>Suggested beam:</b> the fastest with 15 % margin above the 10 ns limit (choose another above, or in the table). ' : ''}SHOT A,${job.shotN} = ${pitchNm} nm pitch · STDCUR ${job.stdcurNA} nA${s.stdcur == null ? ' (auto: 1.1 × nominal)' : ''} · shot time ${time.tShotNs.toFixed(1)} ns at the base dose, ${time.shortestShotNs.toFixed(1)}–${time.longestShotNs.toFixed(1)} ns over the ranks`;

    const parts = SEG.map(([k, label, col]) => ({ k, label, col, v: time.parts[k] }));
    const bar = parts.map((p) => `<div title="${esc(p.label)}: ${fmtHMS(p.v)}" style="flex:${Math.max(p.v, 0)};background:${p.col};"></div>`).join('');
    $('jlTime').innerHTML = `<div class="jl-total"><span>${fmtHMS(time.total)}</span> <small>writing (${fmtT(time.total)})</small>${s.transport !== false ? `<small> + loading ≈ ${fmtHMS(time.transport)} → <b>${fmtHMS(time.withTransport)}</b> at the machine</small>` : ''}</div>
      <div class="jl-bar">${bar}</div>
      <table class="keytab" style="margin-top:6px;">${parts.map((p) => `<tr><td><span class="jl-sw" style="background:${p.col}"></span>${esc(p.label)}</td><td>${fmtHMS(p.v)}</td><td class="hint">${p.k === 'exposure' ? `${time.shots.toExponential(3)} shots` : p.k === 'figures' ? `${Math.round(st.figures * n).toLocaleString()} × ${(P.time.figureOverheadS * 1e6).toFixed(1)} µs` : p.k === 'stage' ? `${time.moves.toLocaleString()} fields × ${P.time.stageMoveS} s + ${P.time.stageLayerS} s` : p.k === 'initial' ? 'CURRNT 10 s + HEIMAP 4 min (DRF5M)' : p.k === 'cyclic' ? `${time.cycles} × ${P.time.cyclicCycleS} s (every ${(P.time.cyclicPeriodS / 60).toFixed(1)} min of writing)` : ''}</td></tr>`).join('')}</table>
      <div class="hint" style="margin-top:4px;">JEOL's time model for ${esc(P.name)} at ${esc(P.site)}, constants fitted to wrtest. Loading depends on the shelf; one measured value is used.</div>`;

    const errs = r.checks.filter((c) => c.level === 'error'), warns = r.checks.filter((c) => c.level !== 'error');
    $('jlChecks').innerHTML = !r.checks.length ? '<span style="color:#15803d">✓ No problems found: names, shot time and ranks are within the rules.</span>'
      : [...errs.map((c) => `<div class="jl-err">✕ ${esc(c.text)}</div>`), ...warns.map((c) => `<div class="jl-warn">! ${esc(c.text)}</div>`)].join('');

    const sweep = currentSweep(r.p, P);
    const best = sweep.filter((c) => c.ok).sort((a, b) => a.total - b.total)[0];
    $('jlSweep').innerHTML = `<table class="keytab jl-pick"><tr><td><b>CALPRM</b></td><td><b>STDCUR</b></td><td><b>writing</b></td><td><b>shortest shot</b></td></tr>${sweep.map((c) => `<tr data-cal="${esc(c.name)}" class="${c.name === s.calprm ? 'on' : ''}${c.ok ? '' : ' bad'}"><td>${esc(c.name)}</td><td>${c.stdcur} nA</td><td>${fmtHMS(c.total)}</td><td>${c.shortestShotNs.toFixed(1)} ns ${c.ok ? (best && c.name === best.name ? '<b style="color:#15803d">fastest</b>' : '') : '<span style="color:#c00">&lt; 10 ns</span>'}</td></tr>`).join('')}</table>`;

    $('jlRanks').innerHTML = ranks.single ? `<div class="hint">One dose (${ranks.baseDose} µC/cm²): no modulation table is needed.</div>`
      : `<table class="keytab"><tr><td><b>rank</b></td><td><b>%</b></td><td><b>dose (µC/cm²)</b></td><td><b>area</b></td><td><b>shot</b></td>${src.src === 'design' ? '<td><b>layers</b></td>' : ''}</tr>${ranks.ranks.map((k) => `<tr${k.areaNm2 ? '' : ' style="color:#aaa"'}><td>${k.rank}</td><td>${k.pct.toFixed(1)}</td><td>${k.dose.toFixed(1)}</td><td>${k.areaNm2 ? um2(k.areaNm2 * n) : 'unused'}</td><td>${(time.tShotNs * k.factor).toFixed(1)} ns</td>${src.src === 'design' ? `<td>${esc((k.layers || []).join(', '))}</td>` : ''}</tr>`).join('')}</table>`
        + (ranks.quantized ? `<div class="hint">More doses than ${P.maxRanks} ranks: log-spaced levels, each dose to the nearest (within ${(100 * ranks.worstRounding).toFixed(2)} %).</div>` : '');

    $('jlJdfName').textContent = `${job.jdfName}.jdf`; $('jlSdfName').textContent = `${job.magazine.toLowerCase()}.sdf`;
    $('jlJdfText').textContent = jdfText(job); $('jlSdfText').textContent = sdfText(job);
    $('jlV30Name').textContent = job.v30;
    if (wrtest) compare(); else $('jlCmpPanel').style.display = 'none';
  }

  $('jlSweep').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-cal]'); if (!tr) return;
    const s = S(); s.calprm = tr.dataset.cal; s.stdcur = null; s.suggested = false; delete s.calNA; fill(); app.markDirty(); update();
  });
  const guard = () => { if (!last || last.error) { toast('Nothing to write yet — see the Pattern panel.'); return false; } if (last.checks.some((c) => c.level === 'error')) toast('Downloaded, but the Problems panel lists errors: fix them before SCHD.', 5000); return true; };
  $('jlDlJdf').onclick = () => { if (guard()) download(`${last.job.jdfName}.jdf`, jdfText(last.job), 'text/plain'); };
  $('jlDlSdf').onclick = () => { if (guard()) download(`${last.job.magazine.toLowerCase()}.sdf`, sdfText(last.job), 'text/plain'); };
  $('jlDlGds').onclick = () => { $('btnExportGds').click(); if (!app.project.writing?.active) toast('The dose-class export needs fractured writing data (Exposure → Fracture &amp; correct → Use as writing data). Without it, export the design and assign the doses per layer in BEAMER (the Layers column of the dose ranks).', 8000); };
  $('jlCsv').onclick = () => pickFile('.csv,text/csv,text/plain', (text, name) => {
    const w = parseWrtestCSV(text);
    if (!w || !w.layers.length) { alert(`${name} is not a JEOL wrtest estimate (no "wrtest" header or no LAYER section).`); return; }
    wrtest = { name, w }; compare();
  });

  function compare() {
    if (!last || last.error || !wrtest) return;
    const L = wrtest.w.layers[0], Pth = L.paths?.[0] || {}, t = last.time;
    const rows = [
      ['Beam on (exposure)', t.parts.exposure + t.parts.figures, Pth['Exposure time'] ?? L['Exposure time']],
      ['Stage moves', t.parts.stage, L['Stage movement time']],
      ['Initial calibration', t.parts.initial, L['INITIAL CALIB time']],
      ['Cyclic calibration', t.parts.cyclic, L['CYCLIC CALIB time']],
      ['Writing (layer, without loading)', t.total, (L['Total time(Layer)'] ?? 0) - (L['Material transport time'] ?? 0)],
      ['At the machine (with loading)', t.withTransport, L['Total time(Layer)']],
    ];
    const pat = L.patterns?.[0] || {};
    $('jlCmp').innerHTML = `<div class="hint" style="margin-bottom:4px;">${esc(wrtest.name)} — ${esc(wrtest.w.totals['Machine type'] || '')}, CALPRM ${esc(L['Calibration condition name'] || '?')}, ${esc(String(L['Standard current (nA)'] ?? '?'))} nA, ${esc(String(L['Area sens. (uC/cm^2)'] ?? '?'))} µC/cm², pitch ${L['Scan step count'] ? L['Scan step count'] * P.pitchUnitNm + ' nm' : '?'}${pat['Field count(pattern)'] ? ` · JEOL counts ${pat['Field count(pattern)']} fields (this estimate ${last.st.fields}) and ${(pat['Shot count'] || 0).toExponential(3)} shots (${last.time.shots.toExponential(3)})` : ''}</div>
      <table class="keytab"><tr><td><b>part</b></td><td><b>this estimate</b></td><td><b>JEOL</b></td><td><b>difference</b></td></tr>${rows.map(([k, a, b]) => `<tr><td>${k}</td><td>${fmtHMS(a)}</td><td>${fmtHMS(b)}</td><td>${b ? `${(100 * (a - b) / b).toFixed(1)} %` : '—'}</td></tr>`).join('')}</table>
      <div class="hint" style="margin-top:4px;">The CSV describes the job it was made for: compare like with like (same current, dose, pitch and pattern).</div>`;
    $('jlCmpPanel').style.display = '';
  }

  function show() { update(); fill(); update(); }        // the first update may pick (suggest) the beam condition
  function reset() { cache = { key: null, stats: null }; wrtest = null; }
  return { show, reset, update, plan, _test: { S, fill, read, compare: () => compare() } };
}

export const JEOL_CSS = `
  .tabs button.machine { color:#f6b44f; }
  .tabs button.machine:hover { background:#3a2a10; color:#ffd28a; }
  .tabs button.machine.active { background:#f59e0b; color:#1b1203; }
  .machine-banner { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:0 0 12px; padding:8px 12px; border-radius:10px;
    background:linear-gradient(90deg,#fff4e0,#fffaf2); border:1px solid #f3c27a; color:#7a4a00; font-size:13px; }
  .machine-chip { font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; background:#f59e0b; color:#1b1203; border-radius:6px; padding:1px 7px; }
  #tab-jeol .panel { border-color:#efd8b4; }
  #tab-jeol .section-title { color:#7a4a00; }
  .jl-total span { font-size:28px; font-weight:700; letter-spacing:.01em; }
  .jl-total small { color:#555; margin-left:6px; }
  .jl-bar { display:flex; height:14px; border-radius:7px; overflow:hidden; margin-top:6px; background:#eee; }
  .jl-sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  .jl-err { color:#b91c1c; margin:3px 0; } .jl-warn { color:#b45309; margin:3px 0; }
  .jl-pick tr[data-cal] { cursor:pointer; } .jl-pick tr[data-cal]:hover td { background:#fff4e0; }
  .jl-pick tr.on td { background:#fde7c2; font-weight:600; } .jl-pick tr.bad td { color:#999; }
  .jl-file { margin:0; padding:8px; background:#fbfaf7; border:1px solid #eee; border-radius:8px; font:12px/1.4 ui-monospace,Consolas,monospace; max-height:300px; overflow:auto; white-space:pre; }
`;
