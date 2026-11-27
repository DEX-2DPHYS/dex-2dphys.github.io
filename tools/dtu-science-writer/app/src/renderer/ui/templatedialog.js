/* File → New…: pick a template (core/templates.js, plus the user's own); File → Save as template…: keep the open
   document as one. The user's templates live in the settings folder (main/ipc.js 'templates'), whole documents with
   their style, text and figures. The choice made last is preselected next time. */
import { TEMPLATES, DEFAULT_TEMPLATE } from '../../core/templates.js';
import { packDocument } from '../../core/fileformat.js';
import { app, api, baseName, toast } from '../context.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function box(id) {
  let dlg = document.getElementById(id);
  if (!dlg) { dlg = document.createElement('div'); dlg.id = id; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  return dlg;
}

/** Resolves { builtin: id } | { user: name }, or null when cancelled. */
export async function chooseTemplate() {
  const dlg = box('tpldlg');
  let mine = [];
  try { mine = (await api.templates('list')) || []; } catch (_) { /* no folder yet */ }
  const last = (app.settings && app.settings.template) || DEFAULT_TEMPLATE;
  let current = TEMPLATES.some(x => x.id === last) || mine.some(m => 'user:' + m.name === last) ? last : DEFAULT_TEMPLATE;

  const card = (key, name, desc, del) => '<button class="tpl' + (key === current ? ' on' : '') + '" data-key="' + esc(key) + '"><b>' + esc(name) + '</b><span>' + esc(desc) + '</span>'
    + (del ? '<i class="tpl-del" data-del="' + esc(name) + '" title="Delete this template">×</i>' : '') + '</button>';

  return new Promise((resolve) => {
    const render = () => {
      dlg.innerHTML = '<div class="box" role="dialog" aria-labelledby="tpldlg-title"><h3 id="tpldlg-title">New document</h3>'
        + '<div class="tpl-grid">' + TEMPLATES.map(x => card(x.id, x.name, x.desc)).join('') + '</div>'
        + (mine.length ? '<h4>Your templates</h4><div class="tpl-grid">' + mine.map(m => card('user:' + m.name, m.name, 'saved ' + new Date(m.modified).toLocaleDateString(), true)).join('') + '</div>'
          : '<p class="hint">File → Save as template… keeps any document as a template of your own.</p>')
        + '<div class="buttons"><span class="grow"></span><button data-r="cancel">Cancel</button><button data-r="ok" class="primary">Create</button></div></div>';
      const on = dlg.querySelector('.tpl.on');
      if (on) on.focus();
    };
    const done = (key) => {
      dlg.hidden = true; dlg.onclick = dlg.ondblclick = dlg.onkeydown = null;
      if (!key) { if (app.view) app.view.focus(); return resolve(null); }
      app.settings = { ...app.settings, template: key };
      api.settings('set', { template: key });
      resolve(key.startsWith('user:') ? { user: key.slice(5) } : { builtin: key });
    };
    dlg.onclick = async (e) => {
      if (e.target === dlg) return done(null);
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const name = del.dataset.del;
        if (!window.confirm('Delete the template “' + name + '”?')) return;
        const r = await api.templates('remove', name);
        if (r && r.error) { toast('Not deleted: ' + r.error, 'error'); return; }
        mine = mine.filter(m => m.name !== name);
        if (current === 'user:' + name) current = DEFAULT_TEMPLATE;
        return render();
      }
      const t = e.target.closest('.tpl');
      if (t) { current = t.dataset.key; dlg.querySelectorAll('.tpl').forEach(b => b.classList.toggle('on', b === t)); return; }
      const r = e.target.closest('[data-r]');
      if (r) done(r.dataset.r === 'ok' ? current : null);
    };
    dlg.ondblclick = (e) => { const t = e.target.closest('.tpl'); if (t && !e.target.closest('[data-del]')) done(t.dataset.key); };
    dlg.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const f = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tpl');
        done(f && dlg.contains(f) ? f.dataset.key : (e.target.dataset && e.target.dataset.r === 'cancel' ? null : current));
      } else if (/^Arrow/.test(e.key)) {           // arrows move between the cards
        const all = [...dlg.querySelectorAll('.tpl')], i = all.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        const cols = getComputedStyle(all[i].parentElement).gridTemplateColumns.split(' ').length;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
        const next = all[Math.max(0, Math.min(all.length - 1, i + step))];
        next.focus(); next.click();
      }
    };
    render();
    dlg.hidden = false;
  });
}

/** File → Save as template…: asks for a name and stores the open document under it. */
export async function saveAsTemplate() {
  if (!app.view) return false;
  const dlg = box('tplsave');
  let mine = [];
  try { mine = (await api.templates('list')) || []; } catch (_) { /* none */ }
  const titleText = app.view.state.doc.firstChild ? app.view.state.doc.firstChild.textContent.trim() : '';
  const suggested = app.path ? baseName() : (titleText || 'My template').slice(0, 60);
  return new Promise((resolve) => {
    dlg.innerHTML = '<div class="box" role="dialog" aria-labelledby="tplsave-title"><h3 id="tplsave-title">Save as template</h3>'
      + '<label class="tpl-name">Name<input data-k="name" value="' + esc(suggested) + '" spellcheck="false"></label>'
      + '<p class="hint">The whole document is kept — style, text, figures and authors — and File → New… offers it. Empty it first if you only want the layout.</p>'
      + '<p class="hint tpl-warn" hidden></p>'
      + '<div class="buttons"><span class="grow"></span><button data-r="cancel">Cancel</button><button data-r="ok" class="primary">Save template</button></div></div>';
    const input = dlg.querySelector('input'), warn = dlg.querySelector('.tpl-warn');
    const check = async () => {
      const n = await api.templates('clean', input.value);
      const taken = n && mine.some(m => m.name.toLowerCase() === n.toLowerCase());
      warn.hidden = !taken;
      warn.textContent = taken ? 'Replaces your template “' + n + '”.' : '';
      return n;
    };
    const done = async (ok) => {
      if (ok) {
        const name = await check();
        if (!name) { input.focus(); return; }
        const { bytes } = await packDocument(app.view.state.doc, { appVersion: app.info && app.info.version });
        const r = await api.templates('save', name, bytes);
        if (r && r.error) { toast('Template not saved: ' + r.error, 'error'); return; }
        toast('Saved as the template “' + r.name + '” — File → New… offers it.');
      }
      dlg.hidden = true; dlg.onclick = dlg.onkeydown = null; input.oninput = null;
      app.view.focus();
      resolve(!!ok);
    };
    input.oninput = check;
    dlg.onclick = (e) => {
      if (e.target === dlg) return done(false);
      const r = e.target.closest('[data-r]');
      if (r) done(r.dataset.r === 'ok');
    };
    dlg.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); done(true); }
    };
    dlg.hidden = false;
    check();
    input.focus(); input.select();
  });
}
