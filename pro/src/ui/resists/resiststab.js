// Resists tab: the resist library. Every resist with its advice, its process window, the contrast
// curves known for it (measured, datasheet, literature — each with its conditions and source), and a
// model that moves a curve to the conditions you plan — always saying whether that is calibrated,
// inside the process window, or extrapolated beyond it, and how uncertain it is.
//
// The library = the built-in entries (core/resists/builtin.js, curated) + resist packs: the user's
// own additions (kept in this browser and in the project file) and packs imported from the shared
// library (a GitHub repository, DTU only for now). Packs only ever add: datasets are not overwritten.

import { $, esc, toast, download, pickFile, openModal, store } from '../dom.js';
import { setupCanvas, onResize, FONT, FONT_SMALL } from '../plotkit.js';
import { BUILTIN_RESISTS, DEV_NAMES } from '../../core/resists/builtin.js';
import { predict, fitCurve, mergeLibrary, makePack, validatePack, validateDataset, REGIME_TEXT, describeConditions, PACK_FORMAT, MODEL_DOC, structureVerdict, betaUm } from '../../core/resists/model.js';
import { makeResist, remainingFraction } from '../../core/physics/resist.js';

const MY_PACK_KEY = 'ebw-resists-my-pack-v1';
const REGIME_CLASS = { measured: 'rs-ok', window: 'rs-win', extrapolated: 'rs-ext', unsupported: 'rs-bad' };
const devName = (k) => DEV_NAMES[k] || k;
const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(3));

// the acceleration voltage the project's PSF is for (Monte Carlo settings or the analytic model)
export const psfKeV = (project) => { const p = project.psf || {}; return (p.mode === 'mc' ? p.mcSettings?.energyKeV : p.energyKeV) ?? p.energyKeV ?? 100; };
export const LIB_PREFIX = 'lib:';

export function createResistsTab(app) {
  const root = $('tab-resists');
  // the user's own pack (this browser) and the project's packs (imported or added, saved with the project)
  const myPack = () => { try { const t = store.get(MY_PACK_KEY); if (t) return JSON.parse(t); } catch { /* bad storage */ } return makePack({ author: 'me', resists: [] }); };
  const saveMyPack = (p) => store.set(MY_PACK_KEY, JSON.stringify(p));
  const projectPacks = () => (app.project.settings ??= {}).resistPacks ??= [];
  let cache = { key: null, lib: null };
  function library() {
    const key = JSON.stringify([store.get(MY_PACK_KEY)?.length || 0, projectPacks().length, projectPacks().map((p) => p.created)]);
    if (cache.key !== key) cache = { key, lib: mergeLibrary(BUILTIN_RESISTS, [...projectPacks(), myPack()]) };
    return cache.lib;
  }
  const S = () => ((app.project.settings ??= {}).resistsTab ??= { selected: BUILTIN_RESISTS[0].id, cond: {} });
  const entry = () => library().find((r) => r.id === S().selected) || library()[0];
  const kVofProject = () => psfKeV(app.project);
  // the planned conditions for a resist: what you typed, else its model reference (at the project's kV)
  function conditionsFor(e) {
    const c = S().cond[e.id] || {};
    const out = { kV: c.kV ?? kVofProject(), thicknessNm: c.thicknessNm ?? e.model.ref.thicknessNm, developer: c.developer ?? e.model.ref.developer, timeS: c.timeS ?? e.model.ref.timeS, tempC: c.tempC ?? e.model.ref.tempC };
    for (const x of e.model.extra || []) out[x.key] = c[x.key] ?? e.model.ref[x.key];     // a resist's own conditions (Medusa: PEB)
    return out;
  }

  root.innerHTML = `
  <div class="rs-intro"><b>Resist library.</b> Contrast curves with the conditions they were measured at, the advice that goes with them, and a model that moves a curve to the conditions you plan — always marked <span class="rs-badge rs-ok">calibrated</span>, <span class="rs-badge rs-win">inside the process window</span> or <span class="rs-badge rs-ext">extrapolated</span>. Where no measured curve exists the model starts from an <b>analytical best guess</b> built from LabAdviser and the literature: use it to plan, then measure.</div>
  <div class="grid">
    <div class="col">
      <div class="panel"><div class="section-title">Resists</div><div id="rsList"></div>
        <div class="row" style="margin-top:8px;"><button class="btn small" id="rsImport" title="A resist pack (JSON) from a colleague or the shared library">Import pack…</button><button class="btn small" id="rsExport" title="Your own datasets and notes, as a pack to share (GitHub pull request)">Export my additions…</button></div>
        <div class="hint" id="rsPacks" style="margin-top:6px;"></div></div>
    </div>
    <div class="col">
      <div class="panel" id="rsHead"></div>
      <div class="rs-two">
        <div class="panel">
          <div class="section-title">Your conditions <span class="q" data-tip="The conditions you plan to use. The library answers with a contrast curve and says how it got it: from a measured curve at these conditions (calibrated), moved by the model within the process window, or extrapolated outside it — with an uncertainty that grows with the distance from the data.">?</span></div>
          <div class="three">
            <div><div class="label">kV</div><input class="field" id="rsKV" type="number" min="1" step="5"></div>
            <div><div class="label">Thickness (nm)</div><input class="field" id="rsTh" type="number" min="5" step="10"></div>
            <div><div class="label">Developer</div><select class="field" id="rsDev"></select></div>
            <div><div class="label">Time (s)</div><input class="field" id="rsT" type="number" min="1" step="5"></div>
            <div><div class="label">Temperature (°C)</div><input class="field" id="rsC" type="number" step="1"></div>
            <div style="align-self:end;"><button class="btn small" id="rsReset">Reference</button></div>
          </div>
          <div class="three" id="rsExtra"></div>
          <div id="rsPred" style="margin-top:10px;"></div>
          <div class="row" style="margin-top:8px;"><button class="btn small primary" id="rsToAnalysis">Use in Analysis</button><button class="btn small" id="rsToFab" title="The resist and these conditions for the next spin and develop steps">Use in Fab Studio</button><button class="btn small" id="rsAdd">Add a measured curve…</button></div>
        </div>
        <div class="panel"><div class="section-title">Contrast curves <span class="q" data-tip="Remaining thickness against dose (log). Thick line: the curve for your conditions, with its uncertainty as a band. Dots and thin lines: the datasets in the library for this resist — each with its own conditions (hover the table below). Grey: datasets at other conditions.">?</span></div><canvas id="rsChart" style="width:100%;height:280px;display:block;"></canvas></div>
      </div>
      <div class="panel"><div class="section-title">What moves the curve <a href="#" class="rs-doc" style="font-weight:500;font-size:12px;margin-left:8px;">The model, explained</a> <span class="q" data-tip="The model: how the clearing dose changes with acceleration voltage, development time, film thickness, developer temperature and developer — each law with its value, its uncertainty and where it comes from. The process window is where the resist is normally used (manufacturer or DTU): inside it the model interpolates; outside it, it extrapolates.">?</span></div><div id="rsModel"></div></div>
      <div class="panel"><div class="section-title">Datasets <span class="q" data-tip="Every curve with its conditions and source. D₀ / D₁₀₀ / γ are the Workbench's (a fitted curve), comparable across resists — sources define contrast in different ways (tangent slope, 10–90 %, 1/log(D₁₀₀/D₀)); their own number is shown as 'reported'. Curves a source gives only as onset / half / clearing doses are rebuilt from them.">?</span></div><div id="rsData" style="overflow:auto;"></div></div>
      <div class="panel"><div class="section-title">Advice</div><div id="rsAdvice"></div></div>
      <div class="panel"><div class="section-title">Sources</div><div id="rsSources" class="hint"></div></div>
    </div>
  </div>`;

  let stepsOpen = false;
  // the documentation of the model, with this resist's own values
  function showDoc() {
    const e = entry(), M = e.model, row = (n, p, u = '') => `<tr><td>${n}</td><td>${p ? `${p.value}${p.sd ? ` ± ${p.sd}` : ''} ${u}` : '—'}</td></tr>`;
    openModal({ title: MODEL_DOC.title, narrow: false,
      html: `<div class="rs-doc-body">${MODEL_DOC.sections.map((x) => `<h3>${esc(x.h)}</h3>${x.p.map((t) => /^ln D/.test(t) ? `<pre>${esc(t)}</pre>` : `<p>${esc(t)}</p>`).join('')}`).join('')}
        <h3>${esc(e.name)}: the values used</h3><table class="keytab rs-tab">
        <tr><td>Reference curve</td><td>${esc(describeConditions(M.ref))}: D₁₀₀ ${fmt(M.ref.D100)} µC/cm², γ ${M.ref.gamma} — ${esc(M.refBasis || '')}, σ ${M.refUncertainty}</td></tr>
        ${row('nE (voltage)', M.nE)}${row('p (time)', M.p)}${row('q (thickness)', M.q)}${row('E_D (temperature)', M.EDeV, 'eV')}${row('cγ (contrast vs temperature)', M.cGamma, '/°C')}
        <tr><td>T_sat</td><td>${M.TsatC != null ? M.TsatC + ' °C' : 'none'}</td></tr><tr><td>density (electron range)</td><td>${M.density ?? 1.2} g/cm³</td></tr>
        ${Object.entries(M.developers || {}).map(([d, f]) => `<tr><td>${esc(devName(d))}</td><td>× ${f.factor} ± ${(100 * (f.sd ?? 0.3)).toFixed(0)} %${f.gammaFactor ? `, γ × ${f.gammaFactor}` : ''}${f.p != null ? `, p ${f.p}` : ''}${f.EDeV != null ? `, E_D ${f.EDeV} eV` : ''}</td></tr>`).join('')}
        </table>${M.notes ? `<p class="hint">${esc(M.notes)}</p>` : ''}<p class="hint">Code: core/resists/model.js (predict), the data: core/resists/builtin.js — both in the Workbench's source.</p></div>`,
      buttons: [{ label: 'Close', primary: true }] });
  }
  root.addEventListener('click', (ev) => { if (ev.target.closest('.rs-doc')) { ev.preventDefault(); showDoc(); } });

  // ---------------------------------------------------------------- render
  function render() {
    if (!app.isTabActive('resists')) return;
    const lib = library(), e = entry(), c = conditionsFor(e), P = predict(e, c);
    $('rsList').innerHTML = ['positive', 'negative'].map((tone) => `<div class="label" style="margin-top:4px;">${tone === 'positive' ? 'Positive tone' : 'Negative tone'}</div>` + lib.filter((r) => r.tone === tone).map((r) => `<div class="rs-item${r.id === e.id ? ' on' : ''}" data-id="${esc(r.id)}"><b>${esc(r.name)}</b>${r.atDTU ? ' <span class="rs-dtu">DTU</span>' : ''}<br><span class="hint">${esc(r.product || '')} · ${(r.datasets || []).filter((d) => !d.superseded).length} curve${(r.datasets || []).length === 1 ? '' : 's'}</span></div>`).join('')).join('');
    const extra = projectPacks().length + (myPack().resists.length ? 1 : 0);
    $('rsPacks').textContent = extra ? `Built-in library + ${projectPacks().length} imported pack${projectPacks().length === 1 ? '' : 's'}${myPack().resists.length ? ' + your additions' : ''}.` : 'Built-in library only.';
    $('rsHead').innerHTML = `<div class="rs-title">${esc(e.name)} <span class="rs-tone">${e.tone}</span></div><div class="hint">${esc(e.product || '')} — ${esc(e.supplier || '')}${e.family ? ` · ${esc(e.family)}` : ''}</div>${e.summary ? `<p style="margin:6px 0 0;">${e.summary}</p>` : ''}`;
    // conditions
    const devs = [...new Set([e.model.ref.developer, ...(e.window?.developers || []), ...Object.keys(e.model.developers || {}), ...(e.datasets || []).map((d) => d.conditions.developer), c.developer])];
    $('rsDev').innerHTML = devs.map((d) => `<option value="${esc(d)}">${esc(devName(d))}</option>`).join('');
    const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    keep('rsKV', c.kV); keep('rsTh', c.thicknessNm); $('rsDev').value = c.developer; keep('rsT', c.timeS); keep('rsC', c.tempC);
    const xk = e.id + (e.model.extra || []).map((x) => x.key).join();
    if ($('rsExtra').dataset.k !== xk) {
      $('rsExtra').dataset.k = xk;
      $('rsExtra').innerHTML = (e.model.extra || []).map((x) => `<div><div class="label">${esc(x.short || x.name)} (${esc(x.unit)}) <span class="q" data-tip="${esc(x.name)}: ${esc(x.note || '')}. This resist depends strongly on it: a curve only holds at its own value.">?</span></div><input class="field rs-x" data-key="${esc(x.key)}" id="rsX_${esc(x.key)}" type="number" step="5"></div>`).join('');
      for (const el of $('rsExtra').querySelectorAll('input')) el.oninput = setCond;
    }
    for (const x of e.model.extra || []) keep('rsX_' + x.key, c[x.key]);
    // prediction
    $('rsPred').innerHTML = `<div class="rs-badge big ${REGIME_CLASS[P.regime]}">${REGIME_TEXT[P.regime]}</div>
      <table class="keytab" style="margin-top:6px;"><tr><td>${e.tone === 'negative' ? 'D₁₀₀ (full thickness)' : 'D₁₀₀ (cleared)'}</td><td><b>${fmt(P.D100)} µC/cm²</b> <span class="hint">(${fmt(P.range[0])} – ${fmt(P.range[1])}, ±${(100 * (Math.exp(P.sigmaLn) - 1)).toFixed(0)} %)</span></td></tr>
      <tr><td>D₀ (onset)</td><td>${fmt(P.D0)} µC/cm²</td></tr><tr><td>Contrast γ</td><td>${P.gamma.toFixed(1)}</td></tr>
      <tr><td>From</td><td>${esc(P.basis)}</td></tr>
      ${P.excursions.length ? `<tr><td>Outside the window</td><td style="color:#b45309">${P.excursions.map(esc).join('<br>')}</td></tr>` : ''}
      ${P.notes.length ? `<tr><td>Notes</td><td>${P.notes.map(esc).join('<br>')}</td></tr>` : ''}</table>
      <details class="rs-steps" id="rsSteps"${stepsOpen ? ' open' : ''}><summary>How this number was made</summary>
      <table class="keytab rs-tab"><tr><td><b>step</b></td><td><b></b></td><td><b>× D₁₀₀</b></td><td><b>adds σ</b></td></tr>
      ${P.steps.map((st) => `<tr><td>${esc(st.what)}</td><td>${esc(st.text)}${st.what === 'anchor' ? `<br><span class="hint">${esc(describeConditions(st.cond))}: D₁₀₀ ${fmt(st.D100)} µC/cm², γ ${st.gamma.toFixed(2)}</span>` : ''}</td><td>${st.what === 'anchor' ? fmt(st.D100) : st.factor != null ? '× ' + st.factor.toFixed(3) : '—'}</td><td>${st.sigma != null ? st.sigma.toFixed(3) : '—'}</td></tr>`).join('')}
      <tr><td><b>result</b></td><td>D₁₀₀ = ${fmt(P.D100)} µC/cm², γ ${P.gamma.toFixed(2)}; σ = √(Σ σ²) = ${P.sigmaLn.toFixed(3)} → ×/÷ ${Math.exp(P.sigmaLn).toFixed(2)}</td><td></td><td></td></tr></table>
      <div class="hint">The laws and every parameter: <a href="#" class="rs-doc">The model, explained</a>.</div></details>`;
    $('rsSteps').ontoggle = () => { stepsOpen = $('rsSteps').open; };
    drawChart(e, c, P);
    // model
    const M = e.model, W = e.window || {}, src = (ids) => (ids || []).map((id) => `<a href="#rs-src-${esc(id)}">[${esc(id)}]</a>`).join(' ');
    const law = (name, p, unit, what, ids) => `<tr><td>${name}</td><td>${p ? `<b>${fmt(p.value)}</b>${p.sd ? ` ± ${fmt(p.sd)}` : ''} ${unit}` : '—'}</td><td>${what}</td><td>${src(p?.sources || ids)}</td></tr>`;
    $('rsModel').innerHTML = `<div class="hint" style="margin-bottom:6px;">D₁₀₀ moves from the nearest curve (or the reference) by these laws, and its uncertainty grows with each step: the ± below are the spreads in the literature. A developer is never interpolated — only the ones listed are known.</div><table class="keytab rs-tab"><tr><td><b>Process window</b></td><td colspan="2">${W.kV ? `${W.kV[0]}–${W.kV[1]} kV · ` : ''}${W.thicknessNm ? `${W.thicknessNm[0]}–${W.thicknessNm[1]} nm · ` : ''}${(W.developers || []).map(devName).join(', ')}${W.timeS ? ` · ${W.timeS[0]}–${W.timeS[1]} s` : ''}${W.tempC ? ` · ${W.tempC[0]}–${W.tempC[1]} °C` : ''}</td><td>${src(W.sources)}</td></tr>
      <tr><td><b>Reference curve</b></td><td colspan="2">${describeConditions(M.ref)}: D₁₀₀ ${fmt(M.ref.D100)} µC/cm², γ ${M.ref.gamma} — <i>${esc(M.refBasis || 'estimate')}</i>, ±${(100 * (Math.exp(M.refUncertainty ?? 0.35) - 1)).toFixed(0)} %</td><td>${src(M.refSources)}</td></tr>
      ${law('Acceleration voltage', M.nE, '', 'D₁₀₀ ∝ E^nE — faster electrons deposit less energy in a thin film (Bethe ≈ 0.75; measured 0.9–1.0)', M.sources)}
      ${law('Development time', M.p, '', 'D₁₀₀ ∝ t^(−p) — longer development, less dose (negative resists: p ≤ 0, hydroxide-developed HSQ ≈ 0)', M.sources)}
      ${law('Film thickness', M.q, '', 'D₁₀₀ ∝ h^q — a thicker film needs more dose to clear', M.sources)}
      ${law('Developer temperature', M.EDeV, 'eV', `D₁₀₀ ∝ exp[(E_D/k)(1/T − 1/T_ref)] — ${(M.EDeV?.value ?? 0) >= 0 ? 'colder development needs more dose' : 'hotter development needs MORE dose (negative resist)'}${M.TsatC != null ? `; no further change below ${M.TsatC} °C` : ''}`, M.sources)}
      ${law('Contrast vs temperature', M.cGamma, '/°C', `γ × exp(cγ·ΔT colder)${(M.cGamma?.value ?? 0) < 0 ? ' — this resist sharpens when developed hotter' : ''}`, M.sources)}
      ${(M.extra || []).map((x) => law(x.name.replace(/^./, (ch) => ch.toUpperCase()), x, '', `${x.law} — ${x.param}${x.note ? `; ${x.note}` : ''}`, x.sources)).join('')}
      ${Object.entries(M.developers || {}).map(([d, f]) => `<tr><td>Developer ${esc(devName(d))}</td><td>× ${fmt(f.factor)}${f.sd ? ` (±${(100 * f.sd).toFixed(0)} %)` : ''}${f.gammaFactor && f.gammaFactor !== 1 ? `, γ × ${f.gammaFactor}` : ''}${f.p != null ? `, p ${f.p}` : ''}${f.EDeV != null ? `, E_D ${f.EDeV} eV` : ''}</td><td>${esc(f.note || '')}</td><td>${src(f.sources)}</td></tr>`).join('')}
      </table>${M.notes ? `<div class="hint" style="margin-top:6px;">${M.notes}</div>` : ''}`;
    // datasets
    const ds = e.datasets || [];
    $('rsData').innerHTML = ds.length ? `<table class="keytab rs-tab"><tr><td><b>curve</b></td><td><b>conditions</b></td><td><b>D₀ / D₁₀₀ / γ</b></td><td><b>quality</b></td><td><b>source</b></td></tr>${ds.map((d) => `<tr${d.superseded ? ' style="opacity:.5"' : ''}><td>${esc(d.id)}${d.superseded ? ' (superseded)' : ''}${d.from ? `<br><span class="hint">from ${esc(d.from)}</span>` : ''}</td><td>${esc(describeConditions(d.conditions))}${d.conditions.prebake ? `<br><span class="hint">${esc(d.conditions.prebake)}</span>` : ''}${(() => { const v = structureVerdict(d.structure, d.conditions.kV); return `<br><span class="rs-st rs-st-${v.ok === true ? 'ok' : v.ok === false ? 'bad' : 'unk'}" title="${esc(v.text)}">${v.ok === true ? '✓' : v.ok === false ? '⚠' : '?'} ${esc(d.structure?.kind === 'pads' ? `${d.structure.sizeUm} µm pads` : d.structure?.kind === 'lines' ? (d.structure.text || 'lines').replace(/\s*\(.*\)$/, '') : 'test structure not stated')}</span>`; })()}</td><td>${fmt(d.fit?.D0 ?? (d.fit ? d.fit.D100 * 10 ** (-1 / d.fit.gamma) : null))} / ${fmt(d.fit?.D100)} / ${d.fit ? d.fit.gamma.toFixed(1) : '—'}${d.summary ? `<br><span class="hint" title="The source gives only these doses; the curve is rebuilt from them by fitting">source: ${[d.summary.onset != null ? `onset ${fmt(d.summary.onset)}` : '', d.summary.d50 != null ? `D50 ${fmt(d.summary.d50)}` : '', `${e.tone === 'negative' ? 'full' : 'clear'} ${fmt(d.summary.done)}`].filter(Boolean).join(', ')} (rebuilt)</span>` : ''}${d.gammaReported ? `<br><span class="hint">reported contrast ${esc(d.gammaReported)}</span>` : ''}</td><td><span class="rs-q rs-q-${esc(d.quality)}">${esc(d.quality)}</span></td><td>${src(d.provenance?.sources || (d.provenance?.source ? [d.provenance.source] : []))}${d.provenance?.who ? ` ${esc(d.provenance.who)}` : ''}${d.provenance?.note ? `<br><span class="hint">${esc(d.provenance.note)}</span>` : ''}</td></tr>`).join('')}</table>`
      : '<div class="hint">No contrast curve has been measured or published for this resist in the library yet: every number above comes from the analytical best guess. <b>Add a measured curve</b> to calibrate it.</div>';
    $('rsAdvice').innerHTML = (e.advice || []).map((a) => `<div class="rs-adv"><b>${esc(a.topic)}</b> ${a.text} ${src(a.sources)}${a.from ? ` <span class="hint">(${esc(a.from)})</span>` : ''}</div>`).join('') || '<div class="hint">No advice yet.</div>';
    $('rsSources').innerHTML = Object.entries(e.sources || {}).map(([id, s]) => `<div id="rs-src-${esc(id)}">[${esc(id)}] ${esc(s.cite)}${s.url ? ` — <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, '').slice(0, 70))}</a>` : ''} <span class="rs-q">${esc(s.kind || '')}</span></div>`).join('');
  }

  function drawChart(e, c, P) {
    const { ctx, w, h } = setupCanvas($('rsChart')), m = { l: 46, r: 10, t: 10, b: 32 };
    const doses = [P.range[0] / 4, P.range[1] * 2.5, ...(e.datasets || []).flatMap((d) => (d.points || []).map((q) => q[0]))].filter((v) => v > 0);
    const lo = Math.min(...doses) * 0.9, hi = Math.max(...doses) * 1.1;
    const X = (d) => m.l + Math.log(d / lo) / Math.log(hi / lo) * (w - m.l - m.r), Y = (f) => h - m.b - f * (h - m.t - m.b);
    ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, h - m.b); ctx.lineTo(w - m.r, h - m.b); ctx.stroke();
    ctx.font = FONT_SMALL; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    for (let ex = Math.floor(Math.log10(lo)); ex <= Math.ceil(Math.log10(hi)); ex++) for (const k of [1, 2, 5]) { const d = k * 10 ** ex; if (d >= lo && d <= hi) { ctx.fillText(fmt(d), X(d), h - m.b + 14); ctx.strokeStyle = '#f2f2f2'; ctx.beginPath(); ctx.moveTo(X(d), m.t); ctx.lineTo(X(d), h - m.b); ctx.stroke(); } }
    ctx.fillText('dose (µC/cm², log)', (m.l + w - m.r) / 2, h - 2);
    ctx.textAlign = 'right'; for (const f of [0, 0.5, 1]) ctx.fillText(f.toFixed(1), m.l - 4, Y(f) + 4);
    const curve = (D100, gamma, round, col, lw, dash = []) => {
      const R = makeResist({ D100, gamma, round, tone: e.tone, thicknessNm: 100 });
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath();
      for (let i = 0; i <= 200; i++) { const d = lo * (hi / lo) ** (i / 200), y = Y(remainingFraction(R, d)); i ? ctx.lineTo(X(d), y) : ctx.moveTo(X(d), y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    // the band: the same curve at the two ends of the D₁₀₀ range
    const R1 = makeResist({ D100: P.range[0], gamma: P.gamma, round: P.round, tone: e.tone, thicknessNm: 100 }), R2 = makeResist({ D100: P.range[1], gamma: P.gamma, round: P.round, tone: e.tone, thicknessNm: 100 });
    ctx.fillStyle = P.regime === 'measured' ? 'rgba(21,128,61,.14)' : P.regime === 'window' ? 'rgba(47,111,214,.14)' : 'rgba(217,119,6,.18)';
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) { const d = lo * (hi / lo) ** (i / 200); const y = Y(remainingFraction(R1, d)); i ? ctx.lineTo(X(d), y) : ctx.moveTo(X(d), y); }
    for (let i = 200; i >= 0; i--) { const d = lo * (hi / lo) ** (i / 200); ctx.lineTo(X(d), Y(remainingFraction(R2, d))); }
    ctx.closePath(); ctx.fill();
    for (const d of e.datasets || []) {
      if (!d.fit || d.superseded) continue;
      const near = d.conditions.developer === c.developer && Math.abs(Math.log(d.conditions.kV / c.kV)) < 0.05;
      const col = near ? '#7c3aed' : '#b8b8c8';
      curve(d.fit.D100, d.fit.gamma, d.fit.round ?? 0.3, col, 1, [4, 3]);
      if (d.rebuilt) continue;                            // rebuilt points are not measurements: no dots
      ctx.fillStyle = col; for (const [x, f] of d.points || []) { ctx.beginPath(); ctx.arc(X(x), Y(f), 3, 0, 2 * Math.PI); ctx.fill(); }
    }
    curve(P.D100, P.gamma, P.round, P.regime === 'measured' ? '#15803d' : P.regime === 'window' ? '#2f6fd6' : '#d97706', 2.5);
  }

  // ---------------------------------------------------------------- controls
  const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  $('rsList').addEventListener('click', (ev) => { const it = ev.target.closest('.rs-item'); if (it) { S().selected = it.dataset.id; app.markDirty(); render(); } });
  const setCond = () => { const e = entry(); S().cond[e.id] = { kV: num('rsKV'), thicknessNm: num('rsTh'), developer: $('rsDev').value, timeS: num('rsT'), tempC: num('rsC'), ...Object.fromEntries((e.model.extra || []).map((x) => [x.key, num('rsX_' + x.key)])) }; app.markDirty(); render(); };
  for (const id of ['rsKV', 'rsTh', 'rsT', 'rsC']) $(id).oninput = setCond;
  $('rsDev').onchange = setCond;
  $('rsReset').onclick = () => { delete S().cond[entry().id]; app.markDirty(); render(); };
  $('rsToAnalysis').onclick = () => {
    const e = entry(), c = conditionsFor(e);
    const a = (app.project.settings.analysis ??= {});
    Object.assign(a, { resist: LIB_PREFIX + e.id, D100: null, gamma: null, round: null, scumNm: null, darkNmMin: null, thickNm: c.thicknessNm, cal: null, dev: { developer: c.developer, timeS: c.timeS, tempC: c.tempC } });
    const kv = psfKeV(app.project);
    app.markDirty(); toast(`${esc(e.name)}, ${c.thicknessNm} nm, ${esc(devName(c.developer))} ${c.timeS} s at ${c.tempC} °C is now the resist in the Analysis tab${Math.abs(kv / c.kV - 1) > 0.02 ? ` — at the PSF's ${kv} kV, not the ${c.kV} kV typed here (the PSF decides the exposure)` : ''}.`, 7000);
  };
  $('rsToFab').onclick = () => { const e = entry(), c = conditionsFor(e); (app.project.settings.fabResist = { id: e.id, cond: c }); app.fabLevel?.('advanced'); app.markDirty(); toast(`${esc(e.name)}: the next spin step in Fab Studio starts with this resist and these conditions.`, 5000); };
  $('rsImport').onclick = () => pickFile('.json,application/json', (text, name) => {
    let pack; try { pack = JSON.parse(text); } catch (err) { alert(`${name} is not JSON: ${err.message}`); return; }
    const problems = validatePack(pack);
    if (problems.length) { alert(`${name} was not imported:\n${problems.slice(0, 12).join('\n')}`); return; }
    projectPacks().push(pack); app.markDirty(); cache.key = null; render();
    toast(`Imported <b>${esc(name)}</b>: ${pack.resists.reduce((n, r) => n + (r.datasets || []).length, 0)} curves for ${pack.resists.length} resist${pack.resists.length === 1 ? '' : 's'} (kept with this project).`, 6000);
  });
  $('rsExport').onclick = () => {
    const p = myPack();
    if (!p.resists.length) { toast('Nothing of your own yet: add a measured curve first.'); return; }
    download(`resist-pack-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...p, created: new Date().toISOString() }, null, 1));
    toast('Exported your additions as a resist pack. To share them: add the file to the shared library on GitHub (a pull request); a curator checks and merges it.', 8000);
  };
  // ---- a measured curve
  $('rsAdd').onclick = () => {
    const e = entry(), c = conditionsFor(e);
    openModal({
      title: `Add a measured curve — ${e.name}`, narrow: false,
      html: `<div class="hint" style="margin-bottom:6px;">The conditions of YOUR measurement (they are part of the curve — a curve without them is not accepted), then the points: one line per dose, <i>dose (µC/cm²), thickness after development (nm)</i>.</div>
        <div class="three"><div><div class="label">kV</div><input class="field" id="adKV" value="${c.kV}"></div><div><div class="label">Initial thickness (nm)</div><input class="field" id="adTh" value="${c.thicknessNm}"></div><div><div class="label">Developer</div><input class="field" id="adDev" value="${esc(c.developer)}"></div>
        <div><div class="label">Time (s)</div><input class="field" id="adT" value="${c.timeS}"></div><div><div class="label">Temperature (°C)</div><input class="field" id="adC" value="${c.tempC}"></div><div><div class="label">Prebake</div><input class="field" id="adPre" placeholder="e.g. 180 °C 2 min"></div>
        <div><div class="label">Test structure <span class="q" data-tip="A proper contrast curve is measured at the centre of pads much larger than β — at least ≈ 3β: about ${Math.round(3 * betaUm(100))} µm at 100 kV, ${Math.round(3 * betaUm(30))} µm at 30 kV on Si — so the centre receives its full backscatter. On lines or small pads the clearing dose comes out too high (up to ≈ 1.5×), and the Workbench, which adds the backscatter itself, would count it twice.">?</span></div><select class="field" id="adSt"><option value="pads">pads (size →)</option><option value="lines">lines / small features</option><option value="unknown">not known</option></select></div><div><div class="label">Pad size (µm)</div><input class="field" id="adStSize" type="number" min="1" step="10" placeholder="e.g. 200"></div>
        ${(e.model.extra || []).map((x) => `<div><div class="label">${esc(x.short || x.name)} (${esc(x.unit)})</div><input class="field" id="adX_${esc(x.key)}" value="${c[x.key] ?? ''}"></div>`).join('')}
        <div><div class="label">Substrate</div><input class="field" id="adSub" placeholder="e.g. Si"></div><div><div class="label">Measured by</div><input class="field" id="adWho" placeholder="name"></div><div><div class="label">Method</div><input class="field" id="adHow" placeholder="profilometer / ellipsometer / AFM"></div></div>
        <div class="label" style="margin-top:6px;">Points (dose, thickness nm)</div><textarea class="field" id="adPts" rows="7" style="font:12px ui-monospace,Consolas,monospace;" placeholder="100, 300\n150, 280\n200, 120\n250, 0"></textarea>
        <div class="row" style="margin-top:6px;"><button class="btn small" id="adFit">Fit</button><span class="hint" id="adOut"></span></div>`,
      buttons: [{ label: 'Cancel' }, { label: 'Save to my library', primary: true, fn: (box) => saveMeasured(box, e) }],
      onOpen: (box) => { box.querySelector('#adFit').onclick = () => { try { const f = fitBox(box, e); box.querySelector('#adOut').innerHTML = `D₀ ${fmt(f.D0)}, D₁₀₀ ${fmt(f.D100)} µC/cm², γ ${f.gamma.toFixed(2)}, rounding ${(100 * f.round).toFixed(0)} %; rms ${(100 * f.rms).toFixed(1)} % of the thickness over ${f.n} points.`; } catch (err) { box.querySelector('#adOut').innerHTML = `<span style="color:#c00">${esc(err.message)}</span>`; } }; },
    });
  };
  const pointsOf = (box) => { const T = parseFloat(box.querySelector('#adTh').value); return box.querySelector('#adPts').value.split(/\r?\n/).map((l) => l.split(/[,;\t ]+/).map(Number)).filter((a) => a.length >= 2 && a[0] > 0 && Number.isFinite(a[1])).map(([d, t]) => [d, Math.max(0, t / T)]); };
  const fitBox = (box, e) => fitCurve(pointsOf(box), e.tone);
  function saveMeasured(box, e) {
    const q = (id) => box.querySelector(id).value;
    const ds = {
      id: `${e.id}-${Date.now().toString(36)}`, quality: 'measured',
      conditions: { kV: +q('#adKV'), thicknessNm: +q('#adTh'), developer: q('#adDev').trim(), timeS: +q('#adT'), tempC: +q('#adC'), prebake: q('#adPre').trim() || null, substrate: q('#adSub').trim() || null,
        ...Object.fromEntries((e.model.extra || []).map((x) => [x.key, +q('#adX_' + x.key)])) },
      structure: q('#adSt') === 'pads' && +q('#adStSize') > 0 ? { kind: 'pads', sizeUm: +q('#adStSize'), text: `${+q('#adStSize')} µm pads` } : q('#adSt') === 'lines' ? { kind: 'lines', text: 'lines / small features' } : { kind: 'unknown', text: 'not recorded by the user' },
      points: pointsOf(box), provenance: { who: q('#adWho').trim() || null, method: q('#adHow').trim() || null, date: new Date().toISOString().slice(0, 10), lab: 'DTU' },
    };
    try { const f = fitCurve(ds.points, e.tone); ds.fit = { D0: f.D0, D100: f.D100, gamma: f.gamma, round: f.round, rms: f.rms }; } catch (err) { alert(err.message); return false; }
    const problems = validateDataset(ds);
    if (problems.length) { alert(`Not saved:\n${problems.join('\n')}`); return false; }
    const p = myPack();
    let r = p.resists.find((x) => x.id === e.id); if (!r) p.resists.push((r = { id: e.id, datasets: [] }));
    r.datasets.push(ds); saveMyPack(p);
    projectPacks().push(makePack({ author: ds.provenance.who || 'me', resists: [{ id: e.id, datasets: [ds] }] }));   // travels with the project too
    app.markDirty(); cache.key = null; render();
    toast(`Saved: ${esc(e.name)}, D₁₀₀ ${fmt(ds.fit.D100)} µC/cm² at ${esc(describeConditions(ds.conditions))}. Conditions near it are now calibrated.`, 6000);
    return true;
  }

  const redraw = onResize([$('rsChart')], () => render());
  function show() { render(); redraw(); }
  // open a resist at given conditions (from another tab)
  const select = (id, c) => { S().selected = id; if (c) S().cond[id] = { ...c }; app.markDirty(); app.showTab?.('resists'); render(); };
  return { show, render, select, devName, library, predictFor: (id, c) => { const e = library().find((r) => r.id === id); return e ? predict(e, c) : null; }, entryOf: (id) => library().find((r) => r.id === id), conditionsFor };
}

export const RESISTS_CSS = `
  .rs-intro { margin:0 0 10px; color:#333; line-height:1.5; }
  .rs-two { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); gap:12px; }
  @media (max-width: 1300px) { .rs-two { grid-template-columns:minmax(0,1fr); } }
  .rs-item { padding:5px 7px; border-radius:7px; cursor:pointer; margin:2px 0; }
  .rs-item:hover { background:#f3f5f8; } .rs-item.on { background:#e8eefb; }
  .rs-dtu { font-size:10px; font-weight:700; background:#990000; color:#fff; border-radius:4px; padding:0 4px; vertical-align:1px; }
  .rs-title { font-size:20px; font-weight:700; } .rs-tone { font-size:12px; font-weight:600; color:#666; text-transform:uppercase; letter-spacing:.05em; margin-left:6px; }
  .rs-badge { display:inline-block; padding:1px 8px; border-radius:8px; font-size:12px; font-weight:700; }
  .rs-badge.big { font-size:14px; padding:4px 10px; }
  .rs-ok { background:#dcfce7; color:#14532d; } .rs-win { background:#dbeafe; color:#1e3a8a; } .rs-ext { background:#fef3c7; color:#92400e; } .rs-bad { background:#fee2e2; color:#7f1d1d; }
  .rs-q { font-size:11px; border:1px solid #ddd; border-radius:6px; padding:0 5px; color:#555; }
  .rs-q-measured { background:#dcfce7; } .rs-q-datasheet { background:#e0f2fe; } .rs-q-literature { background:#ede9fe; } .rs-q-estimate { background:#fef3c7; }
  .rs-tab td { font-size:12.5px; }
  .rs-st { font-size:11.5px; } .rs-st-ok { color:#15803d; } .rs-st-bad { color:#b45309; font-weight:600; } .rs-st-unk { color:#6b7280; }
  .rs-steps { margin-top:8px; } .rs-steps summary { cursor:pointer; font-weight:600; font-size:13px; color:#1e3a8a; }
  .rs-doc-body { max-height:70vh; overflow:auto; line-height:1.5; font-size:13.5px; } .rs-doc-body h3 { font-size:15px; margin:14px 0 4px; }
  .rs-doc-body pre { background:#f3f5f8; padding:8px 10px; border-radius:6px; white-space:pre-wrap; font-size:12.5px; } .rs-adv { margin:4px 0 8px; line-height:1.5; font-size:13px; }
`;
