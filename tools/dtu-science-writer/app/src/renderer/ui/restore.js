/* Backups of the open document (File → Backups…) and recovery of unsaved work after a crash (at start). */
import { app, api, toast } from '../context.js';
import { openCopy, confirmDiscard } from '../doc/files.js';
import { autosaveNow } from '../doc/safety.js';

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB');

/** Small list dialog: rows [{label, sub, value}], buttons per row. Resolves { action, value } or null. */
function listDialog({ title, text, rows, actions, empty }) {
  return new Promise((resolve) => {
    let dlg = document.querySelector('#listdlg');
    if (!dlg) { dlg = document.createElement('div'); dlg.id = 'listdlg'; document.body.appendChild(dlg); }
    const box = document.createElement('div');
    box.className = 'box';
    const h = document.createElement('h3'); h.textContent = title; box.appendChild(h);
    if (text) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = text; box.appendChild(p); }
    const list = document.createElement('div'); list.className = 'rows';
    if (!rows.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = empty || 'Nothing here.'; list.appendChild(p); }
    rows.forEach((r) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('div'); l.className = 'label';
      const b = document.createElement('b'); b.textContent = r.label; l.appendChild(b);
      if (r.sub) { const s = document.createElement('span'); s.textContent = r.sub; l.appendChild(s); }
      row.appendChild(l);
      for (const [action, label] of actions) {
        const btn = document.createElement('button'); btn.textContent = label; btn.dataset.action = action;
        btn.onclick = () => close({ action, value: r.value });
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
    box.appendChild(list);
    const foot = document.createElement('div'); foot.className = 'buttons';
    const c = document.createElement('button'); c.textContent = 'Close'; c.onclick = () => close(null); foot.appendChild(c);
    box.appendChild(foot);
    dlg.replaceChildren(box);
    const close = (v) => { dlg.hidden = true; dlg.onkeydown = null; if (app.view) app.view.focus(); resolve(v); };
    dlg.onclick = (e) => { if (e.target === dlg) close(null); };
    dlg.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
    dlg.hidden = false;
    c.focus();
  });
}

export async function openBackups() {
  if (!app.path) { toast('This document has not been saved yet, so it has no backups.'); return; }
  const list = await api.backupsList(app.path);
  const r = await listDialog({
    title: 'Backups of ' + app.path.split(/[\\/]/).pop(),
    text: 'Each save keeps the previous version here (the last 20, and one per day for 30 days). Opening one gives an unsaved copy; the current file is not touched.',
    rows: list.map(b => ({ label: when(b.time), sub: kb(b.size), value: b.file })),
    actions: [['open', 'Open a copy']],
    empty: 'No backups yet — they are made from the second save on.',
  });
  if (!r) return;
  if (!(await confirmDiscard())) return;
  await openCopy(await api.backupsRead(r.value), { path: app.path });
  toast('Opened a copy of the backup from ' + when(list.find(b => b.file === r.value).time) + '. Save it under a name of your choice.');
}

/** At start: unsaved work from a session that crashed. */
export async function offerRecovery() {
  const list = await api.recovery('list');
  if (!list.length) return false;
  const r = await listDialog({
    title: 'Recover unsaved work?',
    text: 'DTU Science Writer was closed while these documents had unsaved changes. Restore opens the last autosaved state as an unsaved copy.',
    rows: list.map(x => ({ label: x.title || 'Untitled', sub: 'autosaved ' + when(x.savedAt) + (x.path ? ' · ' + x.path : ''), value: x.id })),
    actions: [['restore', 'Restore'], ['discard', 'Discard']],
  });
  if (!r) return false;
  if (r.action === 'discard') { await api.recovery('discard', r.value); return offerRecovery(); }
  const item = list.find(x => x.id === r.value);
  await openCopy(await api.recovery('read', r.value), { path: item.path });
  await autosaveNow();                         // this session holds the work now, before the old copy goes
  await api.recovery('discard', r.value);
  toast('Restored "' + (item.title || 'Untitled') + '" from ' + when(item.savedAt) + '. Save it to keep it' + (item.path ? ' (the original file was not changed)' : '') + '.');
  return true;
}
