/* User settings (per Windows user, stored by the main process in config.json): name and initials,
   used for comments, track changes and the "being edited by" lock. */
import { app, api } from '../context.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const initialsOf = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 3);

export async function loadSettings() { app.settings = (await api.settings('get')) || {}; return app.settings; }

/** The user's name; asks for it first when it is not set yet (returns null if the user cancels). */
export async function ensureUserName() {
  if (app.settings.name) return app.settings;
  const ok = await openSettings({ reason: 'Your name is shown on comments and changes you make.' });
  return ok && app.settings.name ? app.settings : null;
}

/* Zotero online library (main/zotero.js): status and key */
async function showZotero(dlg) {
  const st = await api.refs('zoteroStatus');
  const el = dlg.querySelector('.zst');
  if (el) el.textContent = st && st.configured ? 'connected: ' + st.username + (st.canWrite ? ' — can search, add and edit' : ' — read only: allow write access for the key to add and edit') : 'not connected (desktop Zotero is used when it runs)';
  const rm = dlg.querySelector('[data-act="zremove"]');
  if (rm) rm.hidden = !(st && st.configured);
}
async function connectZotero(dlg) {
  const input = dlg.querySelector('[data-k="zkey"]'), el = dlg.querySelector('.zst');
  if (!input.value.trim()) return;
  el.textContent = 'checking the key…';
  const r = await api.refs('zoteroSetKey', input.value.trim());
  input.value = '';                                  // the key is not kept in the page
  if (r && r.error) { el.textContent = r.error; return; }
  await showZotero(dlg);
}

/** Settings dialog. Resolves true when saved, false when cancelled. */
export function openSettings({ reason } = {}) {
  return new Promise((resolve) => {
    let dlg = document.querySelector('#setdlg');
    if (!dlg) { dlg = document.createElement('div'); dlg.id = 'setdlg'; document.body.appendChild(dlg); }
    const s = app.settings;
    dlg.innerHTML = '<div class="box"><h3>Settings</h3>' + (reason ? '<p class="hint">' + esc(reason) + '</p>' : '')
      + '<label>Your name<input data-k="name" value="' + esc(s.name || s.suggestedName || '') + '" placeholder="e.g. Peter Bøggild"></label>'
      + '<label>Initials<input data-k="initials" value="' + esc(s.initials || initialsOf(s.name || s.suggestedName)) + '" maxlength="4" style="width:6em"></label>'
      + '<label class="check"><input type="checkbox" data-k="eqHidePreview"' + (s.eqHidePreview !== false ? ' checked' : '') + '> Hide the page preview while editing an equation <small>(room for the equation tools)</small></label>'
      + '<label class="check"><input type="checkbox" data-k="alwaysDocx"' + (s.alwaysDocx ? ' checked' : '') + '> Always save a Word copy <small>(name.docx next to the document, replaced at every save)</small></label>'
      + '<label class="check"><input type="checkbox" data-k="wordZotero"' + (s.wordZotero !== false ? ' checked' : '') + '> Citations in Word as Zotero fields <small>(Word co-authors with Zotero can refresh and add citations)</small></label>'
      // Zotero online library: the key stays in the main process, encrypted; only its status comes here
      + '<div class="zot"><span class="lab">Zotero</span> <span class="zst">…</span>'
      + '<div class="zrow"><input type="password" data-k="zkey" autocomplete="off" spellcheck="false" placeholder="API key from zotero.org/settings/keys (allow write access)">'
      + '<button data-act="zconnect">Connect</button><button data-act="zremove" class="quiet">Remove</button></div></div>'
      + '<div class="buttons"><button data-act="cancel">Cancel</button><button data-act="save" class="primary">Save</button></div></div>';
    const name = dlg.querySelector('[data-k="name"]'), ini = dlg.querySelector('[data-k="initials"]');
    let iniTouched = !!s.initials;
    ini.oninput = () => { iniTouched = true; };
    name.oninput = () => { if (!iniTouched) ini.value = initialsOf(name.value); };
    const close = (ok) => { dlg.hidden = true; if (app.view) app.view.focus(); resolve(ok); };
    dlg.onclick = async (e) => {
      const act = e.target.dataset.act;
      if (e.target === dlg || act === 'cancel') return close(false);
      if (act === 'zconnect') { await connectZotero(dlg); return; }
      if (act === 'zremove') { await api.refs('zoteroClearKey'); await showZotero(dlg); return; }
      if (act === 'save') {
        const eqHidePreview = dlg.querySelector('[data-k="eqHidePreview"]').checked;
        const alwaysDocx = dlg.querySelector('[data-k="alwaysDocx"]').checked;
        const wordZotero = dlg.querySelector('[data-k="wordZotero"]').checked;
        app.settings = { ...app.settings, name: name.value.trim(), initials: (ini.value.trim() || initialsOf(name.value)).toUpperCase(), eqHidePreview, alwaysDocx, wordZotero };
        await api.settings('set', { name: app.settings.name, initials: app.settings.initials, eqHidePreview, alwaysDocx, wordZotero });
        close(true);
      }
    };
    dlg.onkeydown = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter' && e.target.dataset.k === 'zkey') { e.preventDefault(); connectZotero(dlg); return; }
      if (e.key === 'Enter') dlg.querySelector('[data-act="save"]').click();
    };
    showZotero(dlg);
    dlg.hidden = false;
    name.focus(); name.select();
  });
}
