// The AI assistant in Pattern Studio (✦ AI assistant, or the A key).
//
// The user describes a new pattern, or a change to the selection; the model (Settings → AI assistant:
// Claude, OpenAI or Mistral, with the user's own key) answers with operations (core/ai/spec.js), the
// engine builds them on a copy of the layout, and the map shows the result as a suggestion: nothing
// changes until Accept (Enter), Discard (Esc) leaves the layout as it was. Further sentences refine the
// suggestion ("smaller gap", "make it 50 µm tall"); the answer is always the complete set of operations,
// applied afresh to the layout as it was. The operations can be read and edited ("Spec"), which also
// works with no key at all.
//
// When the engine rejects an answer (an unknown shape, a missing size …) the problems go back to the
// model once, automatically, before the user sees anything.

import { $, esc, toast, store } from '../dom.js';
import { applyOps, parseReply, SpecError } from '../../core/ai/spec.js';
import { SYSTEM_PROMPT, contextMessage, describeObject } from '../../core/ai/prompt.js';
import { callModel } from './providers.js';
import { aiSettings, aiLabel, openSettings, onAiSettings } from '../settings.js';
import { textPolygons } from './text.js';

const EXAMPLES_NEW = [
  ['Hexagons filling a word', '400 nm hexagons filling the word DTU, 300 nm gap, 40 µm tall'],
  ['Dose test', 'a 6 × 6 array of 200 nm dots, pitch 2 µm, dose from 100 to 600 µC/cm² along x'],
  ['Line-width test', 'lines 50, 100, 200 and 500 nm wide, 20 µm long, 5 µm apart, labelled'],
  ['Ring array', 'rings 2 µm outer and 1 µm inner diameter, 8 × 8, with 1 µm gaps'],
  ['Alignment marks', 'four crosses 20 µm wide with 2 µm arms at the corners of a 200 µm square'],
];
const EXAMPLES_MOD = [
  ['Shrink by 10 nm', 'shrink the selection by 10 nm on every side'],
  ['Fill with dots', 'fill the selection with 100 nm dots on a hexagonal lattice, 150 nm gap'],
  ['Make a 5 × 5 array', 'repeat the selection 5 × 5 with 2 µm gaps'],
  ['Rotate 45°', 'rotate the selection by 45 degrees'],
  ['Dose 300', 'set the dose of the selection to 300 µC/cm²'],
];

export const ASSISTANT_CSS = `
.ai-split { display:flex; gap:10px; align-items:flex-start; }
.ai-split > .canvas-wrap { flex:1 1 auto; min-width:0; }
#aiPanel { display:none; flex:none; width:clamp(300px, 30%, 400px); flex-direction:column; min-height:0; border:1px solid #cdbff5; background:linear-gradient(180deg,#fbf9ff,#fff 80px); border-radius:12px; padding:10px 12px; box-shadow:0 2px 10px rgba(59,31,143,.06); overflow:hidden; }
#aiPanel.show { display:flex; }
#aiPanel .aihead { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
#aiPanel .aimoderow { margin-bottom:8px; }
#aiPanel .aimode { display:flex !important; }
#aiPanel .aimode button { flex:1; }
#aiPanel .gorow { display:flex; align-items:center; gap:8px; margin-top:6px; }
#aiPanel .gorow .hint { flex:1; }
#aiPanel .aititle { font-weight:650; color:#3b1f8f; }
#aiPanel .aimodel { font-size:12px; color:#555; border:1px solid #ddd; background:#fff; border-radius:12px; padding:1px 9px; cursor:pointer; }
#aiPanel .aimodel:hover { border-color:#3b1f8f; color:#3b1f8f; }
#aiPanel .aiclose { margin-left:auto; border:0; background:none; font-size:16px; color:#888; cursor:pointer; padding:0 4px; }
#aiPanel .aimode { display:inline-flex; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; }
#aiPanel .aimode button { border:0; background:#fff; padding:3px 10px; font:inherit; font-size:12px; cursor:pointer; color:#334155; }
#aiPanel .aimode button.on { background:#3b1f8f; color:#fff; }
#aiPanel .aimode button:disabled { color:#aaa; cursor:default; }
#aiPanel .airow { display:flex; }
#aiPanel textarea { flex:1; width:100%; min-height:64px; max-height:200px; resize:vertical; border:1px solid #c4b5fd; border-radius:8px; padding:6px 9px; font:inherit; font-size:13px; line-height:1.4; }
#aiPanel textarea:focus { outline:none; border-color:#3b1f8f; box-shadow:0 0 0 3px rgba(59,31,143,.12); }
#aiPanel .aigo { min-width:104px; background:#3b1f8f; color:#fff; border-color:#3b1f8f; font-weight:600; }
#aiPanel .aigo:hover { background:#4c2bb0; }
#aiPanel .aigo.stop { background:#fff; color:#b91c1c; border-color:#fca5a5; }
#aiPanel .aiex { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
#aiPanel .aiex button { border:1px solid #e4dcfb; background:#f7f4ff; color:#4b2ea8; border-radius:12px; padding:1px 9px; font:inherit; font-size:11.5px; cursor:pointer; }
#aiPanel .aiex button:hover { background:#ede6ff; }
#aiPanel .ailog { margin-top:8px; display:flex; flex-direction:column; gap:6px; flex:1 1 auto; min-height:40px; overflow-y:auto; }
#aiPanel .msg { font-size:13px; line-height:1.45; border-radius:10px; padding:6px 10px; }
#aiPanel .msg.user { align-self:flex-end; background:#eef2ff; color:#1e293b; max-width:85%; }
#aiPanel .msg.ai { background:#fff; border:1px solid #e5e7eb; }
#aiPanel .msg.ai.ask { border-color:#f59e0b; background:#fffbeb; }
#aiPanel .msg.err { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; }
#aiPanel .msg .stats { font-size:12px; color:#475569; margin-top:3px; }
#aiPanel .msg .warn { font-size:12px; color:#b45309; margin-top:3px; }
#aiPanel .msg .acts { display:flex; gap:6px; align-items:center; margin-top:6px; flex-wrap:wrap; }
#aiPanel .msg .acts .cost { margin-left:auto; font-size:11px; color:#888; }
#aiPanel .accept { background:#15803d; color:#fff; border-color:#15803d; font-weight:600; }
#aiPanel .accept:hover { background:#166534; }
#aiPanel details.spec { margin-top:6px; flex:none; }
#aiPanel > * { flex-shrink:0; }
#aiPanel > .ailog { flex-shrink:1; }
#aiPanel details.spec summary { cursor:pointer; font-size:12px; color:#555; }
#aiPanel details.spec textarea { width:100%; height:min(22vh, 170px); min-height:80px; max-height:40vh; font:12px/1.4 ui-monospace,Consolas,monospace; margin-top:4px; }
#aiPanel .nokey { background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:6px 10px; font-size:12.5px; margin-top:6px; }
#aiPanel .busy { font-size:12px; color:#3b1f8f; }
#aiPanel .busy::before { content:''; display:inline-block; width:10px; height:10px; margin-right:6px; border:2px solid #c4b5fd; border-top-color:#3b1f8f; border-radius:50%; animation:aispin .8s linear infinite; vertical-align:-1px; }
@keyframes aispin { to { transform:rotate(360deg); } }
#aiBanner { position:absolute; left:50%; top:10px; transform:translateX(-50%); z-index:6; display:none; align-items:center; gap:8px; background:#3b1f8f; color:#fff; border-radius:10px; padding:5px 6px 5px 12px; font-size:13px; white-space:nowrap; box-shadow:0 6px 20px rgba(59,31,143,.3); }
#aiBanner.show { display:flex; }
#aiBanner .btn { padding:3px 10px; }
#aiBanner .btn.accept { background:#22c55e; border-color:#22c55e; color:#fff; font-weight:600; }
#aiBanner kbd { background:rgba(255,255,255,.2); border-color:rgba(255,255,255,.35); color:#fff; }
#tab-layout.ai-preview .toolbar .btn:not(.ai-btn):not(#btnFit):not(#btnResetView):not(#btnHelp), #tab-layout.ai-preview .grid > .col:first-child .panel { opacity:.45; pointer-events:none; }
#tab-layout.ai-preview #layoutCanvas { box-shadow:inset 0 0 0 3px #a78bfa; }
`;

export function installAssistant(app, editor) {
  const css = document.createElement('style'); css.textContent = ASSISTANT_CSS; document.head.appendChild(css);
  const wrap = $('canvasWrap');
  const panel = document.createElement('div');
  panel.id = 'aiPanel';
  // the panel docks to the right of the map, as tall as the map: the map keeps its height
  const split = document.createElement('div'); split.className = 'ai-split';
  wrap.parentNode.insertBefore(split, wrap); split.appendChild(wrap); split.appendChild(panel);
  const fitHeight = () => { panel.style.height = wrap.offsetHeight + 'px'; };
  new ResizeObserver(fitHeight).observe(wrap);
  const banner = document.createElement('div');
  banner.id = 'aiBanner';
  banner.innerHTML = '<span title="Nothing is changed until you accept">✦ AI suggestion</span> <button class="btn accept" id="aiBannerAccept">Accept <kbd>↵</kbd></button><button class="btn" id="aiBannerDiscard">Discard <kbd>Esc</kbd></button>';
  wrap.appendChild(banner);

  const S = { mode: 'new', modeAuto: true, history: [], busy: null, last: null, totalCost: 0, base: null };
  const HISTORY_KEY = 'ebw-ai-prompts-v1';

  panel.innerHTML = `
    <div class="aihead">
      <span class="aititle">✦ AI assistant</span>
      <button class="aimodel" id="aiModel" title="Provider, model and API key (Settings)"></button>
      <span class="q" data-tip="<b>AI assistant</b><br>Describe a pattern in words — <i>400 nm hexagons filling the word DTU, 300 nm gap</i> — or, with objects selected, a change — <i>shrink these by 10 nm</i>, <i>fill with 100 nm dots</i>.<br><br>An AI model (yours: Settings → AI assistant) writes the operations; the Workbench builds the exact geometry and shows it on the map as a <b>suggestion</b>. Nothing changes until you press <b>Accept</b> (<kbd>Enter</kbd>); <b>Discard</b> (<kbd>Esc</kbd>) leaves the layout as it was. Type again to refine (<i>smaller gap</i>, <i>make it 50 µm tall</i>).<br><br><b>Spec</b> shows the operations as text: edit them and press <i>Run spec</i> — this works without any key.<br><br>Accepting is one step: <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it.">?</span>
      <button class="aiclose" id="aiClose" title="Close (the conversation is kept)">✕</button>
    </div>
    <div class="aimoderow"><div class="aimode" role="group"><button data-m="new" class="on">New pattern</button><button data-m="modify" id="aiModeMod">Change selection</button></div></div>
    <div class="airow"><textarea id="aiPrompt" rows="3" placeholder=""></textarea></div>
    <div class="gorow"><span class="hint">Ctrl+Enter · ↑ the last request</span><button class="btn aigo" id="aiGo" title="Generate (Ctrl+Enter)">Generate</button></div>
    <div class="aiex" id="aiEx"></div>
    <div id="aiNoKey" class="nokey" style="display:none;">No API key yet. <button class="btn small" id="aiOpenSettings">Open Settings</button> and paste a key from Anthropic, OpenAI or Mistral. Without one, <b>Spec</b> below still lets you write the operations yourself.</div>
    <div class="ailog" id="aiLog"></div>
    <details class="spec" id="aiSpecBox"><summary>Spec — the operations as text (edit and run without AI)</summary>
      <textarea id="aiSpec" spellcheck="false" placeholder='{"ops":[{"op":"add","pattern":{"element":{"shape":"hexagon","flat_to_flat_um":0.4},"lattice":{"type":"hexagonal","gap_um":0.3},"region":{"type":"rect","width_um":20,"height_um":10}}}]}'></textarea>
      <div class="row" style="margin-top:4px;"><button class="btn small" id="aiRunSpec">Run spec</button><span class="hint">Lengths in µm, y up. The language is described under the ? above and in the tutorial.</span></div>
    </details>`;

  const q = (id) => panel.querySelector('#' + id);
  const promptEl = q('aiPrompt'), goEl = q('aiGo'), logEl = q('aiLog');

  // ---------------------------------------------------------------- show / hide, mode, model chip
  function open(focus = true) {
    panel.classList.add('show'); $('btnAi').classList.add('active');
    refreshMode(); refreshKey();
    editor.resize();
    if (focus) setTimeout(() => promptEl.focus(), 0);
  }
  function close() { panel.classList.remove('show'); $('btnAi').classList.remove('active'); editor.resize(); }
  const toggle = () => (panel.classList.contains('show') ? close() : open());
  $('btnAi').onclick = toggle;
  q('aiClose').onclick = close;
  q('aiModel').onclick = () => openSettings();
  q('aiOpenSettings').onclick = () => openSettings();
  function refreshKey() {
    const s = aiSettings();
    q('aiModel').textContent = `${aiLabel(s)} ⚙`;
    q('aiNoKey').style.display = s.key ? 'none' : '';
  }
  onAiSettings(refreshKey);
  function setMode(m, auto = false) {
    S.mode = m; if (!auto) S.modeAuto = false;
    panel.querySelectorAll('.aimode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    promptEl.placeholder = S.last ? 'Refine: “smaller gap”, “50 µm tall”, “use circles instead” …  (Ctrl+Enter)'
      : m === 'modify' ? 'Describe the change to the selected objects, e.g. “shrink by 10 nm”  (Ctrl+Enter)' : 'Describe a pattern, e.g. “400 nm hexagons filling the word DTU, 300 nm gap”  (Ctrl+Enter)';
    const ex = m === 'modify' ? EXAMPLES_MOD : EXAMPLES_NEW;
    q('aiEx').innerHTML = S.last || logEl.children.length ? '' : ex.map(([t, p]) => `<button data-p="${esc(p)}" title="${esc(p)}">${esc(t)}</button>`).join('');
  }
  panel.querySelector('.aimode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) setMode(b.dataset.m); });
  q('aiEx').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; promptEl.value = b.dataset.p; promptEl.focus(); });
  // the mode follows the selection until the user picks one; "Change selection" needs something selected
  function refreshMode() {
    const n = editor.previewing() ? 0 : editor.aiContext().selectionIds.length;
    const btn = q('aiModeMod');
    btn.disabled = !n && S.mode !== 'modify';
    btn.textContent = n ? `Change selection (${objectCount()})` : 'Change selection';
    if (S.modeAuto && !S.last) setMode(n ? 'modify' : 'new', true);
    else setMode(S.mode, true);
  }
  function objectCount() { const c = editor.aiContext(); return c.objects.length + c.refs.length; }
  const selKey = () => editor.aiContext().selectionIds.slice().sort().join();
  app.onSelectionChanged = () => {
    if (!panel.classList.contains('show') || S.busy || editor.previewing()) return;
    if (S.pinnedSel != null && selKey() !== S.pinnedSel) { S.pinnedSel = null; S.modeAuto = true; }   // the user chose something else: the mode follows the selection again
    refreshMode();
  };

  // ---------------------------------------------------------------- log
  function addMsg(cls, html) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; logEl.appendChild(d); q('aiNoKey').style.display = 'none'; scrollEnd(); return d; }
  const scrollEnd = () => requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
  function startOver() {
    if (editor.previewing()) editor.discardPreview();
    S.history = []; S.last = null; S.base = null; logEl.innerHTML = ''; banner.classList.remove('show'); q('aiSpec').value = '';
    S.modeAuto = true; refreshMode();
  }

  // ---------------------------------------------------------------- the request
  function engineCtx(base) {
    const v = base.view;
    return {
      nominalDose: base.nominalDose, activeLayer: base.activeLayer, viewBBox: v,
      defaultCentre: [Math.round((v.x1 + v.x2) / 2 / 1000) * 1000, Math.round((v.y1 + v.y2) / 2 / 1000) * 1000],
      textPolygons,
    };
  }
  function snapshotBase() {
    // what the request is about: the layout and selection as they are now (refinements reuse it)
    const c = editor.aiContext();
    return { ...c, lib: app.project.library, selection: [...c.objects.slice(0, 40).map((m) => describeObject(m)), ...c.refs.slice(0, 10)], selectionCount: c.objects.length + c.refs.length };
  }

  async function generate() {
    const text = promptEl.value.trim();
    if (S.busy) { S.busy.abort(); return; }
    if (!text) { promptEl.focus(); return; }
    const st = aiSettings();
    if (!st.key && !window.__ebwAiMock) { refreshKey(); openSettings(); return; }
    // a refinement builds on the layout as it was asked about; if the layout has changed since, start afresh
    if (S.last && S.base && S.baseVersion !== app.version && !editor.previewing()) { S.last = null; addMsg('ai', '<span class="hint">The layout changed since the last request: this is a new request.</span>'); }
    if (!S.last || !S.base) { S.base = snapshotBase(); S.baseVersion = app.version; S.history = []; }
    const base = S.base;
    const mode = S.last ? S.lastMode : S.mode;
    if (mode === 'modify' && !base.selectionIds.length) { addMsg('err', 'Nothing is selected: select the objects to change, or switch to <b>New pattern</b>.'); return; }
    S.lastMode = mode;
    const userMsg = S.history.length ? `Refinement of the request: ${text}` : contextMessage(text, { ...base, mode });
    addMsg('user', esc(text));
    store.set(HISTORY_KEY, JSON.stringify([text, ...(JSON.parse(store.get(HISTORY_KEY) || '[]').filter((t) => t !== text))].slice(0, 30)));
    promptEl.value = '';
    const busyEl = addMsg('ai', `<span class="busy">Asking ${esc(aiLabel(st))}…</span>`);
    const ctl = new AbortController(); S.busy = ctl;
    goEl.textContent = 'Stop'; goEl.classList.add('stop');
    const t0 = performance.now();
    const tick = setInterval(() => { const s = Math.round((performance.now() - t0) / 1000); busyEl.querySelector('.busy').textContent = `Asking ${aiLabel(st)}… ${s} s`; }, 1000);
    let messages = [...S.history, { role: 'user', content: userMsg }];
    let cost = 0, out = null, reply = null, raw = '';
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await callModel({ provider: st.provider, model: st.model, key: st.key, system: SYSTEM_PROMPT, messages, signal: ctl.signal });
        cost += r.cost || 0; raw = r.text;
        try { reply = parseReply(r.text); } catch (e) {
          if (attempt) throw e;
          messages = [...messages, { role: 'assistant', content: r.text }, { role: 'user', content: `Your reply could not be read: ${e.message}. Reply again with ONE JSON object only.` }];
          continue;
        }
        if (reply.question && !reply.ops.length) break;
        out = runOps(reply.ops, base);
        if (!out.errors.length || attempt) break;
        // let the model fix what the engine rejected, once, before the user sees it
        messages = [...messages, { role: 'assistant', content: r.text }, { role: 'user', content: `The geometry engine rejected that:\n- ${out.errors.join('\n- ')}\nReply with the corrected, complete JSON.` }];
      }
    } catch (e) {
      clearInterval(tick); busyEl.className = 'msg err'; busyEl.innerHTML = esc(e.message) + (e.kind === 'key' ? ' <button class="btn small" data-act="settings">Open Settings</button>' : '');
      busyEl.querySelector('[data-act=settings]')?.addEventListener('click', () => openSettings());
      done(); return;
    }
    clearInterval(tick);
    S.totalCost += cost;
    S.history = [...messages, { role: 'assistant', content: raw }];
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const costTxt = `${esc(aiLabel(st))} · ${secs} s${cost ? ` · $${cost.toFixed(cost < 0.01 ? 4 : 3)}` : ''}`;
    if (reply.question && !reply.ops.length) {
      busyEl.className = 'msg ai ask';
      busyEl.innerHTML = `<b>?</b> ${esc(reply.question)}<div class="acts"><span class="cost">${costTxt}</span></div>`;
      S.last = { reply, out: null };
      done(); promptEl.focus(); return;
    }
    showResult(busyEl, reply, out, costTxt);
    done();
  }
  function done() { S.busy = null; goEl.textContent = 'Generate'; goEl.classList.remove('stop'); setMode(S.mode, true); }

  function runOps(ops, base) {
    try { return applyOps(base.lib, base.cell, base.selectionIds, ops, engineCtx(base)); }
    catch (e) { return { errors: [e instanceof SpecError ? e.message : `the engine failed: ${e.message}`], warnings: [], created: [], stats: {} }; }
  }

  const fmtLen = (nm) => (nm == null ? '—' : nm >= 1000 ? `${+(nm / 1000).toFixed(3)} µm` : nm >= 100 ? `${Math.round(nm)} nm` : `${+nm.toFixed(1)} nm`);
  function statsLine(out) {
    const s = out.stats || {}, bits = [];
    // count objects, not stored pieces (a holed hexagon is one object of two hole-free pieces)
    const made = (s.patterns || []).reduce((a, p) => a + (p.count || 0), 0);
    if (made) bits.push(`${made.toLocaleString()} new object${made > 1 ? 's' : ''}`);
    else if (s.shapes) bits.push(`${s.shapes.toLocaleString()} new shape${s.shapes > 1 ? 's' : ''}`);
    const chg = new Set((out.changed || []).map((id) => { const sh = out.lib.cells[S.base.cell]?.shapes.find((x) => x.id === id); return sh?.groupId || id; })).size;
    if (chg) bits.push(`${chg} object${chg > 1 ? 's' : ''} changed`);
    const pats = (s.patterns || []).filter((p) => p.count);
    if (pats.length) {
      const layers = [...new Set(pats.map((p) => p.layer))], doses = [...new Set(pats.map((p) => p.dose))];
      bits.push(`layer ${layers.join(', ')}`);
      const ramp = pats.find((p) => p.ramp), r = ramp && (ramp.ramp.rampX || ramp.ramp.rampY);
      if (r) bits.push(`dose ramp ${r.from} → ${r.to}${r.unit === 'factor' ? ' ×' : ' µC/cm²'}`);
      else if (doses.length <= 3) bits.push(`${doses.join(', ')} µC/cm²`);
    }
    if (s.minFeature != null) bits.push(`smallest feature ${fmtLen(s.minFeature)}`);
    if (s.minGap != null) bits.push(`gap ${fmtLen(s.minGap)}`);
    if (s.bbox && s.shapes) bits.push(`spanning ${fmtLen(s.bbox.x2 - s.bbox.x1)} × ${fmtLen(s.bbox.y2 - s.bbox.y1)}`);
    if (out.newLayers?.length) bits.push(`new layer ${out.newLayers.join(', ')}`);
    return bits.join(' · ');
  }
  function showResult(el, reply, out, costTxt) {
    if (S.last?.el && S.last.el !== el) {
      const old = S.last.el.querySelector('.acts');
      if (old && old.querySelector('[data-act=accept]')) { old.querySelectorAll('[data-act=accept],[data-act=discard]').forEach((b) => b.remove()); old.insertAdjacentHTML('afterbegin', '<span class="hint">Replaced by the version below.</span>'); }
    }
    q('aiSpec').value = JSON.stringify({ reply: reply.reply, ops: reply.ops }, null, 1);
    if (out.errors.length) {
      el.className = 'msg err';
      el.innerHTML = `${esc(reply.reply || 'The answer could not be built.')}<div class="warn" style="color:#991b1b">${out.errors.map(esc).join('<br>')}</div><div class="acts"><span class="hint">Rephrase, or correct the operations under Spec.</span><span class="cost">${costTxt}</span></div>`;
      if (editor.previewing()) { editor.discardPreview(); banner.classList.remove('show'); }
      S.last = { reply, out: null };
      return;
    }
    const nothing = !out.created.length && !out.changed?.length && !out.removed;
    el.className = 'msg ai';
    el.innerHTML = `${esc(reply.reply || 'Done.')}<div class="stats">${esc(statsLine(out))}</div>${out.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}`
      + `<div class="acts">${nothing ? '<span class="hint">Nothing to apply.</span>' : '<button class="btn small accept" data-act="accept">Accept ↵</button><button class="btn small" data-act="discard">Discard</button>'}<button class="btn small" data-act="over" title="Forget this conversation and start a new request">Start over</button><span class="cost">${costTxt}</span></div>`;
    el.querySelector('[data-act=accept]')?.addEventListener('click', accept);
    el.querySelector('[data-act=discard]')?.addEventListener('click', discard);
    el.querySelector('[data-act=over]').addEventListener('click', startOver);
    S.last = { reply, out, el };
    scrollEnd();
    if (nothing) return;
    editor.setPreview({ lib: out.lib, ids: [...out.created, ...(out.changed || [])] });
    banner.classList.add('show');
    editor.showBox(out.stats.bbox);
  }
  function accept() {
    if (!editor.previewing() || !S.last?.out) return;
    const what = S.last.reply.reply || 'AI suggestion';
    editor.acceptPreview(`AI: ${what.slice(0, 80)}`);
    banner.classList.remove('show');
    finishCard('✓ Applied — Ctrl+Z undoes it.');
    S.history = []; S.last = null; S.base = null;
    S.modeAuto = false; S.pinnedSel = selKey(); setMode('new', true);
    toast('Applied. <b>Ctrl+Z</b> undoes it.');
  }
  function discard() {
    if (!editor.previewing()) return;
    editor.discardPreview();
    banner.classList.remove('show');
    finishCard('Discarded — the layout is as it was. Type to refine it, or Start over.');
    S.modeAuto = true; refreshMode();
  }
  function finishCard(note) {
    const el = S.last?.el; if (!el) return;
    const acts = el.querySelector('.acts'); if (!acts) return;
    acts.querySelectorAll('[data-act=accept],[data-act=discard]').forEach((b) => b.remove());
    acts.insertAdjacentHTML('afterbegin', `<span class="hint">${esc(note)}</span>`);
  }
  $('aiBannerAccept').onclick = accept;
  $('aiBannerDiscard').onclick = discard;
  app.onPreviewKey = (k) => (k === 'accept' ? accept() : discard());
  app.onPreviewTouched = () => { banner.animate?.([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.08)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 300 }); toast('An AI suggestion is on show: <b>Accept</b> (Enter) or <b>Discard</b> (Esc) first.'); };

  // ---------------------------------------------------------------- spec, run by hand
  q('aiSpecBox').addEventListener('toggle', () => {
    if (!q('aiSpecBox').open) return;
    if (!q('aiSpec').value.trim()) q('aiSpec').value = JSON.stringify({ reply: 'Hexagons in a box (an example: edit and press Run spec)', ops: [{ op: 'add', pattern: { element: { shape: 'hexagon', flat_to_flat_um: 0.4 }, lattice: { type: 'hexagonal', gap_um: 0.3 }, region: { type: 'rect', width_um: 20, height_um: 10 } } }] }, null, 1);
    panel.scrollTop = 0;                                        // the panel never scrolls itself: the log gives way
  });
  q('aiRunSpec').onclick = () => {
    let reply;
    try { JSON.parse(q('aiSpec').value); reply = parseReply(q('aiSpec').value); } catch (e) { addMsg('err', `The spec is not valid JSON: ${esc(e.message.replace(/^the reply /, ''))}`); return; }
    if (editor.previewing()) editor.discardPreview();
    if (!S.base) S.base = snapshotBase();
    const out = runOps(reply.ops, S.base);
    showResult(addMsg('ai', ''), reply.reply ? reply : { ...reply, reply: 'Spec run by hand.' }, out, 'spec, no AI');
    setMode(S.mode, true);
  };

  // ---------------------------------------------------------------- keys
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); }
    else if (e.key === 'Enter' && !e.shiftKey && editor.previewing() && !promptEl.value.trim()) { e.preventDefault(); accept(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (editor.previewing()) discard(); else promptEl.blur(); }
    else if (e.key === 'ArrowUp' && !promptEl.value) {        // the last prompts, like a shell
      const h = JSON.parse(store.get(HISTORY_KEY) || '[]'); if (h.length) { e.preventDefault(); promptEl.value = h[0]; }
    }
  });
  goEl.onclick = generate;
  document.addEventListener('keydown', (e) => {
    if (!app.isTabActive('layout') || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target?.tagName || '';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(t) || e.target?.isContentEditable) return;
    if ((e.key === 'a' || e.key === 'A') && !editor.previewing() && !document.querySelector('.modal-back.show')) { e.preventDefault(); if (!panel.classList.contains('show')) open(); else promptEl.focus(); }
  });

  setMode('new', true); refreshKey();
  return { open, close, toggle, state: S, generate, startOver, accept, discard };
}
