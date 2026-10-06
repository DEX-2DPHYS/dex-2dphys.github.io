// Small DOM helpers shared by every tab: help chips, context menu, modal dialogs, toast,
// file download / open.

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- help chips (.q with data-tip), ported from PPS ----
export function initTips() {
  const tipEl = $('tip');
  let pinned = null;
  const place = (q) => {
    const r = q.getBoundingClientRect();
    tipEl.style.display = 'block';
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = r.left - 8, y = r.bottom + 8;
    if (x + tw > innerWidth - 10) x = innerWidth - tw - 10;
    if (y + th > innerHeight - 10) y = Math.max(10, r.top - th - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  };
  const show = (q) => { tipEl.innerHTML = q.dataset.tip || ''; place(q); };
  document.addEventListener('mouseover', (e) => { const q = e.target.closest('.q'); if (q && !pinned) show(q); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('.q') && !pinned) tipEl.style.display = 'none'; });
  document.addEventListener('click', (e) => {
    const q = e.target.closest('.q');
    if (q) {
      e.preventDefault(); e.stopPropagation();
      if (pinned === q) { pinned = null; tipEl.style.display = 'none'; } else { pinned = null; show(q); pinned = q; }
      return;
    }
    pinned = null; tipEl.style.display = 'none';
  }, true);
}

// ---- context menu ----
export function openMenu(px, py, items) {
  const m = $('ctxMenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { const d = document.createElement('div'); d.className = 'sepm'; m.appendChild(d); continue; }
    const d = document.createElement('div');
    d.className = 'item' + (it.disabled ? ' disabled' : '');
    d.textContent = it.label;
    d.onclick = () => { closeMenu(); it.fn(); };
    m.appendChild(d);
  }
  m.style.display = 'block';
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(px, innerWidth - w - 8) + 'px';
  m.style.top = Math.min(py, innerHeight - h - 8) + 'px';
}
export function closeMenu() { $('ctxMenu').style.display = 'none'; }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxMenu')) closeMenu(); });
window.addEventListener('blur', closeMenu);

// ---- modal ----
// openModal({title, html, narrow, buttons:[{label, primary, left, fn}], onOpen}) — a button's fn
// returning false keeps the dialog open. Enter presses the primary button, Esc cancels; onDismiss runs
// when it is closed without a button (Esc, a click beside it).
let modalState = null;
export function openModal({ title, html, narrow = true, buttons = [], onOpen, onDismiss }) {
  const back = $('modalBack'), box = $('modal');
  box.className = 'modal' + (narrow ? ' narrow' : '');
  box.innerHTML = `<h2>${esc(title)}</h2><div class="mbody">${html}</div><div class="actions"><div class="left"></div></div>`;
  const actions = box.querySelector('.actions'), left = box.querySelector('.actions .left');
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn' + (b.primary ? ' primary' : '');
    el.textContent = b.label;
    el.onclick = () => { if (b.fn && b.fn(box) === false) return; closeModal(); };
    (b.left ? left : actions).appendChild(el);
    if (b.primary) el.dataset.primary = '1';
  }
  back.classList.add('show');
  modalState = { box, onDismiss };
  if (onOpen) onOpen(box);
  const first = box.querySelector('input,select');
  if (first) setTimeout(() => { first.focus(); first.select?.(); }, 0);
}
export function closeModal() { $('modalBack').classList.remove('show'); modalState = null; }
export const modalOpen = () => !!modalState;
const dismissModal = () => { const f = modalState && modalState.onDismiss; closeModal(); if (f) f(); };
$('modalBack')?.addEventListener('mousedown', (e) => { if (e.target === $('modalBack')) dismissModal(); });
document.addEventListener('keydown', (e) => {
  if (!modalState) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissModal(); }
  else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    const p = modalState.box.querySelector('button[data-primary]');
    if (p) { e.preventDefault(); e.stopPropagation(); p.click(); }
  }
}, true);

export const numField = (id, label, value, step = 'any', extra = '') =>
  `<div><div class="label">${label}</div><input class="field" id="${id}" type="number" step="${step}" value="${value}" ${extra}></div>`;
export const readNum = (box, id) => { const el = box.querySelector('#' + id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };

// ---- toast ----
let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('toast');
  t.innerHTML = msg;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, ms);
}

// ---- files ----
export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---- busy: a panel over the page while a large file is read and turned into a layout ----
// Reading shows a real bar (the reader's progress); the steps after it block the page, so they get a
// moving bar and a line saying what is happening, painted before the work starts (await nextPaint()).
export const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
export const BIG_FILE = 1 << 20;                // smaller files load too fast for the panel to help
let busyEl = null;
export function busy(msg, frac = null) {
  if (!busyEl) {
    const css = document.createElement('style');
    css.textContent = `#busyPanel{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(20,20,20,.18);}
#busyPanel .card{min-width:320px;max-width:520px;padding:16px 18px;border-radius:10px;background:var(--panel,#fff);color:var(--fg,#1d1d1b);box-shadow:0 8px 30px rgba(0,0,0,.25);font:14px/1.4 system-ui,sans-serif;}
#busyPanel .bar{height:6px;border-radius:3px;background:rgba(127,127,127,.25);margin-top:10px;overflow:hidden;position:relative;}
#busyPanel .fill{position:absolute;left:0;top:0;bottom:0;background:#2f6fd6;border-radius:3px;transition:width .15s;}
#busyPanel .fill.ind{width:30%;animation:busyMove 1.1s ease-in-out infinite;}
@keyframes busyMove{0%{left:-30%}100%{left:100%}}`;
    document.head.appendChild(css);
    busyEl = document.createElement('div');
    busyEl.id = 'busyPanel';
    busyEl.innerHTML = '<div class="card"><div class="msg"></div><div class="bar"><div class="fill"></div></div></div>';
    document.body.appendChild(busyEl);
  }
  busyEl.style.display = 'flex';
  busyEl.querySelector('.msg').innerHTML = msg;
  const fill = busyEl.querySelector('.fill');
  if (frac == null) { fill.classList.add('ind'); fill.style.width = ''; }
  else { fill.classList.remove('ind'); fill.style.left = '0'; fill.style.width = `${Math.round(100 * Math.min(1, Math.max(0, frac)))}%`; }
}
export function busyDone() { if (busyEl) busyEl.style.display = 'none'; }
const mb = (b) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0);
// a file read with the panel showing its progress (large files only); resolves to text or bytes
export function readFile(f, binary = false) {
  return new Promise((resolve, reject) => {
    const big = f.size >= BIG_FILE, r = new FileReader();
    if (big) { busy(`Reading <b>${esc(f.name)}</b> — 0 / ${mb(f.size)} MB`, 0); r.onprogress = (e) => { if (e.lengthComputable) busy(`Reading <b>${esc(f.name)}</b> — ${mb(e.loaded)} / ${mb(e.total)} MB`, e.loaded / e.total); }; }
    r.onload = () => resolve(binary ? new Uint8Array(r.result) : String(r.result));
    r.onerror = () => { busyDone(); reject(r.error || new Error('the file could not be read')); };
    if (binary) r.readAsArrayBuffer(f); else r.readAsText(f);
  });
}
// a step that blocks the page, after the panel has said what it is (only for a large file)
export async function busyStep(big, msg, fn) {
  if (!big) return fn();
  busy(msg); await nextPaint();
  return fn();
}

export function pickFile(accept, cb) {
  const inp = $('fileInput');
  inp.accept = accept;
  inp.value = '';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let text;
    try { text = await readFile(f, false); } catch (e) { alert(`Could not read ${f.name}:\n${e.message}`); return; }
    try { await busyStep(f.size >= BIG_FILE, `Opening <b>${esc(f.name)}</b> — building the layout…`, () => cb(text, f.name)); }
    finally { busyDone(); }
  };
  inp.click();
}

// localStorage that never throws (private windows, blocked storage, file:// quirks).
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
