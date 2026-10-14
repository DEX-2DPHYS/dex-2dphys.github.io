// Fab Studio: a process written in words (✦ at the top of the Process flow column).
//
// "PMMA lift-off of 5 nm Cr and 50 nm Au" → the model writes the steps (core/ai/fabprompt.js), the Fab tab
// fills in every parameter through its own step form and simulates them as a NEW flow, or appended to
// the flow on screen. Keep makes it permanent; Discard deletes the new flow (or replays the flow as it
// was). A step the simulator cannot run, or a name it does not know, goes back to the model once
// before the user sees anything. Same provider, model and key as the Pattern Studio assistant (Settings).

import { $, esc, toast } from '../dom.js';
import { callModel } from './providers.js';
import { aiSettings, aiLabel, openSettings, onAiSettings } from '../settings.js';
import { FAB_SYSTEM_PROMPT, fabContextMessage, parseFabReply } from '../../core/ai/fabprompt.js';

const EXAMPLES = [
  ['Lift-off Cr/Au', 'PMMA lift-off of 5 nm Cr and 50 nm Au'],
  ['Bilayer lift-off', 'PMMA 50K / 950K bilayer, 150 nm under 100 nm, develop in MIBK:IPA 1:3 for 60 s, 3 nm Cr and 60 nm Au, lift-off'],
  ['Grating into SiO₂', 'on 100 nm SiO₂, etch a 200 nm pitch grating 100 nm deep into the oxide through CSAR'],
  ['KOH V-grooves', '100 nm SiO₂ mask, open it with ZEP and BHF, then KOH 30 % at 80 °C for 60 s'],
  ['HSQ lines', 'HSQ 60 nm, expose 100 nm wide lines, develop in TMAH 25 %'],
];

const CSS = `
#fabAi { border:1px solid #cdbff5; background:linear-gradient(180deg,#fbf9ff,#fff 70px); border-radius:12px; padding:8px 10px; margin-bottom:12px; }
#fabAi .head { display:flex; align-items:center; gap:6px; }
#fabAi .ttl { font-weight:650; color:#3b1f8f; cursor:pointer; user-select:none; }
#fabAi .chip { font-size:11.5px; color:#555; border:1px solid #ddd; background:#fff; border-radius:12px; padding:1px 8px; cursor:pointer; white-space:nowrap; }
#fabAi .body { margin-top:8px; display:none; }
#fabAi.open .body { display:block; }
#fabAi .modes { display:flex; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; margin-bottom:6px; }
#fabAi .modes button { flex:1; border:0; background:#fff; padding:3px 6px; font:inherit; font-size:12px; cursor:pointer; color:#334155; }
#fabAi .modes button.on { background:#3b1f8f; color:#fff; }
#fabAi textarea { width:100%; min-height:62px; resize:vertical; border:1px solid #c4b5fd; border-radius:8px; padding:6px 8px; font:inherit; font-size:12.5px; line-height:1.4; }
#fabAi textarea:focus { outline:none; border-color:#3b1f8f; box-shadow:0 0 0 3px rgba(59,31,143,.12); }
#fabAi .go { display:flex; align-items:center; gap:6px; margin-top:5px; }
#fabAi .go .hint { flex:1; }
#fabAi .go .btn.gen { background:#3b1f8f; color:#fff; border-color:#3b1f8f; font-weight:600; }
#fabAi .go .btn.gen.stop { background:#fff; color:#b91c1c; border-color:#fca5a5; }
#fabAi .ex { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; }
#fabAi .ex button { border:1px solid #e4dcfb; background:#f7f4ff; color:#4b2ea8; border-radius:12px; padding:0 8px; font:inherit; font-size:11px; cursor:pointer; }
#fabAi .card { margin-top:7px; border:1px solid #e5e7eb; background:#fff; border-radius:10px; padding:6px 9px; font-size:12.5px; line-height:1.45; }
#fabAi .card.err { background:#fef2f2; border-color:#fecaca; color:#991b1b; }
#fabAi .card.ask { background:#fffbeb; border-color:#f59e0b; }
#fabAi .card ol { margin:4px 0 0 18px; padding:0; font-size:12px; color:#334155; }
#fabAi .card li.bad { color:#b91c1c; } #fabAi .card li.unc { color:#b45309; }
#fabAi .card .acts { display:flex; gap:6px; align-items:center; margin-top:6px; flex-wrap:wrap; }
#fabAi .card .acts .cost { margin-left:auto; font-size:10.5px; color:#888; }
#fabAi .btn.keep { background:#15803d; color:#fff; border-color:#15803d; font-weight:600; }
#fabAi .busy { font-size:12px; color:#3b1f8f; }
#fabAi .nokey { background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:5px 8px; font-size:12px; margin-top:5px; }
`;

export function installFabAssistant(app, fab) {
  const css = document.createElement('style'); css.textContent = CSS; document.head.appendChild(css);
  const col = document.querySelector('#tab-fab .flowcol');
  const box = document.createElement('div');
  box.id = 'fabAi';
  col.insertBefore(box, col.firstChild);
  box.innerHTML = `
    <div class="head"><span class="ttl" id="fabAiToggle" title="Write a process in words">✦ Describe a process in words <span id="fabAiTw">▸</span></span>
      <span class="q" data-tip="Write the process the way you would tell a colleague — <i>PMMA lift-off of 5 nm Cr and 50 nm Au</i> — and an AI model (yours: Settings → AI assistant) writes the steps. Fab Studio fills in every parameter you did not give from its own presets (the resist's curve, the develop conditions) and simulates the flow at once.<br><br><b>New flow</b> makes it a flow of its own beside the others; <b>Add to this flow</b> continues the one on screen. <b>Keep</b> makes it permanent, <b>Discard</b> takes it away again. Every step can then be edited by clicking its card, as usual.">?</span>
      </div>
    <div class="body">
      <div class="modes"><button data-m="new" class="on">New flow</button><button data-m="append">Add to this flow</button></div>
      <textarea id="fabAiPrompt" placeholder="e.g. PMMA lift-off of 5 nm Cr and 50 nm Au  (Ctrl+Enter)"></textarea>
      <div class="go"><button class="chip" id="fabAiModel" title="Provider, model and key (Settings) — Ctrl+Enter writes the flow"></button><span class="hint"></span><button class="btn gen" id="fabAiGo" title="Ctrl+Enter">Write the flow</button></div>
      <div class="ex" id="fabAiEx">${EXAMPLES.map(([t, p]) => `<button data-p="${esc(p)}" title="${esc(p)}">${esc(t)}</button>`).join('')}</div>
      <div class="nokey" id="fabAiNoKey" style="display:none;">No API key yet: <a href="#" id="fabAiSet">open Settings</a> and paste one (Anthropic, OpenAI or Mistral).</div>
      <div id="fabAiOut"></div>
    </div>`;
  const q = (id) => box.querySelector('#' + id);
  const S = { mode: 'new', busy: null, history: [], card: null };

  const setOpen = (on) => { refreshKey(); box.classList.toggle('open', on); q('fabAiTw').textContent = on ? '▾' : '▸'; if (on) setTimeout(() => q('fabAiPrompt').focus(), 0); };
  q('fabAiToggle').onclick = () => setOpen(!box.classList.contains('open'));
  q('fabAiModel').onclick = () => openSettings();
  q('fabAiSet').onclick = (e) => { e.preventDefault(); openSettings(); };
  const refreshKey = () => { const s = aiSettings(); q('fabAiModel').textContent = `${aiLabel(s)} ⚙`; q('fabAiNoKey').style.display = s.key || window.__ebwAiMock ? 'none' : ''; };
  onAiSettings(refreshKey); refreshKey();
  box.querySelector('.modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.mode = b.dataset.m; box.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b)); q('fabAiPrompt').placeholder = S.mode === 'append' ? 'e.g. then etch 50 nm of the oxide by RIE and strip the resist' : 'e.g. PMMA lift-off of 5 nm Cr and 50 nm Au  (Ctrl+Enter)'; });
  q('fabAiEx').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { q('fabAiPrompt').value = b.dataset.p; q('fabAiPrompt').focus(); } });
  q('fabAiPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); write(); } });
  q('fabAiGo').onclick = write;

  function card(cls, html) { const d = document.createElement('div'); d.className = 'card ' + cls; d.innerHTML = html; q('fabAiOut').prepend(d); return d; }
  function settle(note) {
    const c = S.card; if (!c) return;
    c.querySelectorAll('[data-act=keep],[data-act=discard]').forEach((b) => b.remove());
    c.querySelector('.acts')?.insertAdjacentHTML('afterbegin', `<span class="hint">${esc(note)}</span>`);
  }

  async function write() {
    if (S.busy) { S.busy.abort(); return; }
    const text = q('fabAiPrompt').value.trim();
    if (!text) { q('fabAiPrompt').focus(); return; }
    const st = aiSettings();
    if (!st.key && !window.__ebwAiMock) { refreshKey(); openSettings(); return; }
    if (fab.words.previewing()) { await fab.words.discard(); settle('Replaced by the next request.'); }
    const mode = S.mode, ctx = fab.words.context();
    const el = card('', `<span class="busy">Asking ${esc(aiLabel(st))}…</span>`);
    S.card = el;
    const ctl = new AbortController(); S.busy = ctl;
    q('fabAiGo').textContent = 'Stop'; q('fabAiGo').classList.add('stop');
    const t0 = performance.now();
    let messages = [{ role: 'user', content: fabContextMessage(text, ctx, mode) }], cost = 0, reply = null, res = null, err = null;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await callModel({ provider: st.provider, model: st.model, key: st.key, system: FAB_SYSTEM_PROMPT, messages, signal: ctl.signal });
        cost += r.cost || 0;
        let problems = [];
        try { reply = parseFabReply(r.text); } catch (e) { problems = [`the reply could not be read: ${e.message}`]; }
        if (reply && reply.question && !reply.steps.length) break;
        if (reply && !reply.steps.length && !problems.length) problems = ['no steps were given'];
        if (!problems.length) {
          try { res = await fab.words.preview(reply.steps, { mode, name: reply.name || 'Written flow', substrate: mode === 'new' ? reply.substrate : null }); }
          catch (e) { problems = [e.message]; }
          if (res) { const bad = res.steps.filter((s) => !s.ok); if (bad.length && !attempt) { problems = bad.map((s) => `step "${s.headline}" could not run: ${s.error}`); await fab.words.discard(); res = null; } }
        }
        if (!problems.length || attempt) { if (problems.length) err = problems.join('; '); break; }
        messages = [...messages, { role: 'assistant', content: r.text }, { role: 'user', content: `Fab Studio could not use that:\n- ${problems.join('\n- ')}\nReply with the corrected, complete JSON.` }];
      }
    } catch (e) { err = e.message; }
    S.busy = null; q('fabAiGo').textContent = 'Write the flow'; q('fabAiGo').classList.remove('stop');
    const costTxt = `${esc(aiLabel(st))} · ${((performance.now() - t0) / 1000).toFixed(1)} s${cost ? ` · $${cost.toFixed(cost < 0.01 ? 4 : 3)}` : ''}`;
    if (err && !res) { el.className = 'card err'; el.innerHTML = `${esc(err)}<div class="acts"><span class="cost">${costTxt}</span></div>`; return; }
    if (reply?.question && !res) { el.className = 'card ask'; el.innerHTML = `<b>?</b> ${esc(reply.question)}<div class="acts"><span class="hint">Answer in the box above.</span><span class="cost">${costTxt}</span></div>`; return; }
    q('fabAiPrompt').value = '';
    el.className = 'card';
    el.innerHTML = `${esc(reply.reply || 'Flow written.')}<ol>${res.steps.map((s) => `<li class="${s.ok ? (s.uncertain ? 'unc' : '') : 'bad'}">${esc(s.headline)}${s.ok ? (s.uncertain ? ' — ⚠ outside the curve\'s calibration' : '') : ` — ⚠ ${esc(s.error || 'could not run')}`}</li>`).join('')}</ol>`
      + res.notes.map((n) => `<div class="hint" style="color:#b45309">⚠ ${esc(n)}</div>`).join('')
      + `<div class="acts"><button class="btn small keep" data-act="keep">Keep</button><button class="btn small" data-act="discard">Discard</button><span class="cost">${costTxt}</span></div>`;
    el.querySelector('[data-act=keep]').onclick = async () => { await fab.words.keep(reply.name); settle(mode === 'new' ? `Kept as the flow "${reply.name || 'Written flow'}".` : 'Kept.'); toast('Kept. Click a step in the flow to change it.'); };
    el.querySelector('[data-act=discard]').onclick = async () => { await fab.words.discard(); settle('Discarded.'); };
    toast(mode === 'new' ? 'A new flow is simulated: <b>Keep</b> or <b>Discard</b> it (the card at the top of the flow column).' : 'The steps were added: <b>Keep</b> or <b>Discard</b> them.', 4500);
  }
  return { open: () => setOpen(true), write, state: S };
}
