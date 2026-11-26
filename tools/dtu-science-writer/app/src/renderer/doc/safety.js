/* Autosave to the recovery folder, recovery after a crash, and watching the lock of a read-only document.
   The rules themselves (lock file, checksum, backups) are in main/docs.js. */
import { packDocument } from '../../core/fileformat.js';
import { app, api, isDirty, fileName, onChange, onLoad, onSaved, toast } from '../context.js';
import { setReadOnly, openPath } from './files.js';

export const AUTOSAVE_MS = 30 * 1000;
const RECHECK_MS = 30 * 1000;

let dirtySince = 0, autosaveTimer = null;

/** Write the recovery copy now (also used by the tests). */
export async function autosaveNow() {
  if (!app.view || !isDirty()) return false;
  const { bytes } = await packDocument(app.view.state.doc, { appVersion: app.info.version, created: app.created });
  await api.recovery('write', bytes, { path: app.path, title: fileName() });
  return true;
}

function scheduleAutosave() {
  if (autosaveTimer) return;
  autosaveTimer = setTimeout(async () => {
    autosaveTimer = null;
    try { await autosaveNow(); } catch (e) { console.error('autosave', e); }
  }, AUTOSAVE_MS);
}

onChange((tr) => { if (tr.docChanged && !app.readOnly) { if (!dirtySince) dirtySince = Date.now(); scheduleAutosave(); } });
onSaved(() => { dirtySince = 0; });
onLoad(() => { dirtySince = 0; api.recovery('clear'); });

/* ---------- read-only documents: is the lock free yet? ---------- */
let recheckTimer = null;

/** Read-only document: take the lock if it is free now. Returns true when the document became editable. */
export async function checkLockNow() {
  if (!app.readOnly || !app.path) return false;
  const r = await api.docRecheck();
  if (r.readOnly) {
    // the editor saved a newer version: show it (comments shared by readers are applied again on load),
    // unless a comment or reply is being written right now
    const typing = [...document.querySelectorAll('.cmt-edit textarea')].some(ta => ta.value.trim());
    if (r.changed && !typing) {
      const sc = document.querySelector('#editor-scroll'), top = sc ? sc.scrollTop : 0;
      await openPath(app.path);
      if (sc) sc.scrollTop = top;
      toast(fileName() + ' was saved by ' + ((r.owner && r.owner.user) || 'its editor') + ' — showing the new version.');
    }
    return false;
  }
  clearInterval(recheckTimer);
  if (r.changed) {
    // the previous editor saved: show their version, now editable
    await openPath(app.path);
    toast(fileName() + ' is free now and has been reloaded with the latest changes. You can edit it.');
  } else {
    setReadOnly(false);
    toast(fileName() + ' is free now. You can edit it.');
  }
  return true;
}

function watchLock() {
  clearInterval(recheckTimer);
  if (app.readOnly && app.path) recheckTimer = setInterval(checkLockNow, RECHECK_MS);
}
onLoad(watchLock);

api.onDocEvent((ev) => {
  if (ev.kind === 'lock-lost') {
    setReadOnly(true, ev.owner);
    toast('Someone else (' + ev.owner.user + ' on ' + ev.owner.machine + ') has taken over this document. It is read-only now; save your changes under a new name if you need them.', 'error');
    watchLock();
  }
});

