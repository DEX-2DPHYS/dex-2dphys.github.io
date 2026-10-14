// Settings (⚙ in the title bar): settings that belong to this browser, not to a project. First tab:
// the AI assistant — provider, model and the user's own API key.
//
// The key is kept in this browser only — never in a project file, an export or the autosave — in
// localStorage when "Remember on this computer" is ticked, otherwise in sessionStorage (gone when the
// tab closes). It is sent only to the provider it belongs to.

import { $, esc, openModal, store } from './dom.js';
import { PROVIDERS, modelInfo, callModel } from './ai/providers.js';

const PREF_KEY = 'ebw-ai-settings-v1', KEY_LOCAL = 'ebw-ai-keys-v1', KEY_SESSION = 'ebw-ai-keys-session-v1';
const ss = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } }, del(k) { try { sessionStorage.removeItem(k); } catch { /* blocked */ } } };
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function aiSettings() {
  const p = parse(store.get(PREF_KEY), {});
  const provider = PROVIDERS[p.provider] ? p.provider : 'anthropic';
  const models = p.models || {};
  const remember = p.remember !== false;
  const keys = { ...parse(ss.get(KEY_SESSION), {}), ...parse(store.get(KEY_LOCAL), {}) };
  const model = models[provider] || PROVIDERS[provider].models[0].id;
  return { provider, model, models, remember, keys, key: keys[provider] || '' };
}
function saveAi({ provider, models, remember, keys }) {
  store.set(PREF_KEY, JSON.stringify({ provider, models, remember }));
  const clean = Object.fromEntries(Object.entries(keys).filter(([, v]) => v));
  if (remember) { store.set(KEY_LOCAL, JSON.stringify(clean)); ss.del(KEY_SESSION); }
  else { ss.set(KEY_SESSION, JSON.stringify(clean)); store.del(KEY_LOCAL); }
  for (const fn of listeners) fn(aiSettings());
}
const listeners = new Set();
export const onAiSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const aiLabel = (s = aiSettings()) => `${modelInfo(s.provider, s.model).name}`;

export function openSettings() {
  const cur = aiSettings();
  const st = { provider: cur.provider, models: { ...cur.models }, keys: { ...cur.keys }, remember: cur.remember };
  const html = `<div class="set-tabs"><button class="on" data-t="ai">AI assistant</button></div>
  <div class="set-pane" data-p="ai">
    <p class="hint" style="margin-top:0;">The AI assistant (✦ in Pattern Studio) writes patterns and changes from a sentence. It uses <b>your own</b> account with an AI provider: paste an API key from that provider here. Each request costs a few cents or less; the assistant shows what each one cost.</p>
    <div class="label">Provider</div>
    <div class="prov-row" id="setProv">${Object.entries(PROVIDERS).map(([k, p]) => `<label class="prov${k === st.provider ? ' on' : ''}"><input type="radio" name="prov" value="${k}"${k === st.provider ? ' checked' : ''}> ${esc(p.name)}<span class="have" data-k="${k}"></span></label>`).join('')}</div>
    <div class="two" style="margin-top:10px;">
      <div><div class="label">Model</div><select class="field" id="setModel"></select></div>
      <div id="setCustomBox" style="display:none;"><div class="label">Model id</div><input class="field" id="setCustom" placeholder="as the provider names it"></div>
    </div>
    <div class="hint" id="setModelNote" style="margin-top:2px;"></div>
    <div class="label" style="margin-top:10px;">API key <a id="setKeyLink" href="#" target="_blank" rel="noopener" style="margin-left:6px;">get a key ↗</a></div>
    <div class="row" style="flex-wrap:nowrap;"><input class="field" id="setKey" type="password" autocomplete="off" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;"><button class="btn small" id="setShow" type="button">Show</button></div>
    <label class="check" style="margin-top:8px;"><input type="checkbox" id="setRemember"${st.remember ? ' checked' : ''}> Remember the key on this computer</label>
    <div class="hint">The key stays in this browser: never in a project file, an export or a GDS file, and it is sent only to the provider it belongs to. Unticked, it is forgotten when this tab closes. Anyone using this browser profile can read a remembered key — on a shared computer, untick it.</div>
    <div class="row" style="margin-top:10px;"><button class="btn" id="setTest" type="button">Test the key</button><span id="setTestOut" class="hint"></span></div>
  </div>`;
  openModal({
    title: 'Settings', html, narrow: false,
    onOpen: (box) => {
      const provEl = box.querySelector('#setProv'), modelEl = box.querySelector('#setModel'), keyEl = box.querySelector('#setKey');
      const customBox = box.querySelector('#setCustomBox'), customEl = box.querySelector('#setCustom'), note = box.querySelector('#setModelNote');
      const markHave = () => box.querySelectorAll('.have').forEach((h) => { h.textContent = st.keys[h.dataset.k] ? ' · key set' : ''; });
      const fill = () => {
        const P = PROVIDERS[st.provider], m = st.models[st.provider] || P.models[0].id, known = P.models.some((x) => x.id === m);
        modelEl.innerHTML = P.models.map((x) => `<option value="${x.id}">${esc(x.name)}${x.note ? ' — ' + esc(x.note) : ''}</option>`).join('') + '<option value="__other">Other model id…</option>';
        modelEl.value = known ? m : '__other';
        customBox.style.display = known ? 'none' : ''; customEl.value = known ? '' : m;
        const info = modelInfo(st.provider, m);
        note.textContent = info.price ? `$${info.price[0]} / $${info.price[1]} per million tokens in / out. A typical request: 3–6 thousand tokens in, 0.5–2 thousand out.` : 'Price unknown for a model typed in: the cost is not shown.';
        keyEl.value = st.keys[st.provider] || ''; keyEl.placeholder = P.keyHint;
        box.querySelector('#setKeyLink').href = P.keyUrl;
        box.querySelectorAll('.prov').forEach((l) => l.classList.toggle('on', l.querySelector('input').value === st.provider));
        box.querySelector('#setTestOut').textContent = '';
        markHave();
      };
      provEl.addEventListener('change', (e) => { st.provider = e.target.value; fill(); });
      modelEl.addEventListener('change', () => {
        if (modelEl.value === '__other') { customBox.style.display = ''; customEl.focus(); return; }
        st.models[st.provider] = modelEl.value; fill();
      });
      customEl.addEventListener('input', () => { const v = customEl.value.trim(); if (v) st.models[st.provider] = v; });
      keyEl.addEventListener('input', () => { st.keys[st.provider] = keyEl.value.trim(); markHave(); });
      box.querySelector('#setShow').onclick = () => { const show = keyEl.type === 'password'; keyEl.type = show ? 'text' : 'password'; box.querySelector('#setShow').textContent = show ? 'Hide' : 'Show'; };
      box.querySelector('#setRemember').onchange = (e) => { st.remember = e.target.checked; };
      box.querySelector('#setTest').onclick = async () => {
        const out = box.querySelector('#setTestOut'), key = st.keys[st.provider], model = st.models[st.provider] || PROVIDERS[st.provider].models[0].id;
        if (!key) { out.innerHTML = '<span style="color:#b45309">Paste a key first.</span>'; return; }
        out.textContent = `Asking ${modelInfo(st.provider, model).name}…`;
        try {
          const r = await callModel({ provider: st.provider, model, key, system: 'You are a connection test. Reply with the JSON object {"ok": true} and nothing else.', messages: [{ role: 'user', content: 'Test: reply with the JSON {"ok": true}.' }], maxTokens: 2000, effort: 'low' });
          out.innerHTML = `<span style="color:#15803d">✓ Works</span> — ${esc(modelInfo(st.provider, model).name)} answered in ${(r.ms / 1000).toFixed(1)} s${r.cost != null ? ` (cost $${r.cost.toFixed(4)})` : ''}.`;
        } catch (e) { out.innerHTML = `<span style="color:#b91c1c">✗ ${esc(e.message)}</span>`; }
      };
      fill();
    },
    buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, fn: () => { saveAi(st); } }],
  });
}

export const SETTINGS_CSS = `
.set-tabs { display:flex; gap:4px; border-bottom:1px solid #e5e7eb; margin:-4px 0 12px; }
.set-tabs button { border:0; background:none; padding:6px 12px; font:inherit; font-size:13px; color:#555; border-bottom:2px solid transparent; cursor:pointer; }
.set-tabs button.on { color:#111; border-bottom-color:#111; font-weight:600; }
.prov-row { display:flex; gap:8px; flex-wrap:wrap; }
.prov { display:flex; align-items:center; gap:6px; border:1px solid #d4d4d8; border-radius:10px; padding:7px 12px; cursor:pointer; font-size:13px; }
.prov.on { border-color:#3b1f8f; background:#f5f0ff; box-shadow:0 0 0 2px rgba(59,31,143,.12); }
.prov .have { color:#15803d; font-size:11px; }
`;

export function installSettings() {
  const b = document.createElement('button');
  b.className = 'btn small'; b.id = 'btnSettings'; b.title = 'Settings: the AI assistant (provider, model, API key)'; b.textContent = '⚙'; b.setAttribute('aria-label', 'Settings'); b.style.fontSize = '15px'; b.style.lineHeight = '1';
  $('btnDemo').after(b);
  b.onclick = () => openSettings();
  const css = document.createElement('style'); css.textContent = SETTINGS_CSS; document.head.appendChild(css);
}
