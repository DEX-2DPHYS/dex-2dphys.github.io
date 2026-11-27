/* Documents: create, open, save. Opening takes the lock (main/docs.js); a document someone else is editing opens
   read-only. Saving never overwrites a file that changed on disk since it was opened: the main process writes a
   conflict copy instead. */
import { createState, createView, NEW_DOC } from '../editor/editor.js';
import { packDocument, unpackDocument, EXT } from '../../core/fileformat.js';
import { clearMedia } from '../../core/media.js';
import { app, api, $, fileName, baseName, isDirty, emit, toast } from '../context.js';
import { askSave } from '../ui/asksave.js';
import { chooseTemplate } from '../ui/templatedialog.js';
import { templateDoc } from '../../core/templates.js';

/** Show a document (JSON) in the editor. Media must already be in the media store. */
export function loadDocument(json, path, { readOnly = false, owner = null } = {}) {
  const state = createState(json);
  app.readOnly = readOnly;
  app.lockOwner = owner;
  if (app.view) app.view.updateState(state);
  else app.view = createView($('#page'), state, (tr, ns) => emit('change', tr, ns), () => !app.readOnly, () => app.settings);
  app.view.setProps({});                       // re-evaluate "editable"
  app.path = path || null;
  app.savedDoc = app.view.state.doc;
  emit('load');
}

/** Switch read-only on or off for the open document (lock lost / lock became free). */
export function setReadOnly(readOnly, owner = null) {
  app.readOnly = readOnly;
  app.lockOwner = owner;
  if (app.view) app.view.setProps({});
  emit('readonly');
}

/** Unsaved changes: ask Save / Don't save / Cancel. Returns false when the user cancels. */
export async function confirmDiscard() {
  if (!isDirty()) return true;
  const r = await askSave(fileName());
  if (r === 'cancel') return false;
  if (r === 'save') return await save();
  return true;
}

/** File → New…: choice = a built-in template id ('article', 'thesis', …), { builtin: id }, { user: name }, or nothing
    to ask (ui/templatedialog.js; unattended test runs get the article, as before). */
export async function newDocument(choice) {
  if (choice === undefined || choice === null) choice = app.info && app.info.test ? { builtin: 'article' } : await chooseTemplate();
  if (!choice) return false;
  if (typeof choice === 'string') choice = { builtin: choice };
  let bytes = null;
  if (choice.user) {
    try { bytes = await api.templates('read', choice.user); } catch (e) { toast('Could not read the template “' + choice.user + '”: ' + e.message, 'error'); return false; }
  }
  if (!(await confirmDiscard())) return false;
  await api.docClose();
  app.created = null;
  if (bytes) {
    try {
      const { json } = await unpackDocument(bytes);     // loads the template's figures into the media store
      loadDocument(json, null);
    } catch (e) { toast('The template “' + choice.user + '” could not be opened: ' + e.message, 'error'); clearMedia(); loadDocument(NEW_DOC, null); }
  } else {
    clearMedia();
    loadDocument(choice.builtin ? templateDoc(choice.builtin) : NEW_DOC, null);
  }
  app.view.focus();
  return true;
}

export async function openPath(path) {
  try {
    const r = await api.docOpen(path);
    const { json, manifest } = await unpackDocument(r.bytes);
    app.created = manifest.created;
    loadDocument(json, path, { readOnly: r.readOnly, owner: r.owner });
    api.addRecent(path);
    if (r.tookOver) toast('Took over the lock left by ' + r.tookOver.user + ' on ' + r.tookOver.machine + ' (no longer active).');
    if (r.conflicts && r.conflicts.length) toast('Note: Dropbox conflicted copies next to this file: ' + r.conflicts.join(', '), 'error');
    if (r.readOnly) emit('readonly');
    return true;
  } catch (e) {
    toast('Could not open ' + path.split(/[\\/]/).pop() + ': ' + e.message, 'error');
    return false;
  }
}

export async function openDialog() {
  if (!(await confirmDiscard())) return;
  const path = await api.openDialog();
  if (path) await openPath(path);
}

/** Save; `as` asks for a new name. A read-only document can only be saved under a new name. */
export async function save(as) {
  let path = app.path;
  if (!path || as || app.readOnly) {
    path = await api.saveDialog({ defaultName: baseName() + (app.readOnly && !as ? ' (copy)' : '') + '.' + EXT, kind: 'dtusw' });
    if (!path) return false;
  }
  const { bytes, missing } = await packDocument(app.view.state.doc, { appVersion: app.info.version, created: app.created });
  const res = await api.docSave(path, bytes);
  if (res && res.error) { toast('Not saved: ' + res.error, 'error'); return false; }
  if (res && res.conflict) {
    // the file changed on disk since it was opened (someone else, or a sync): nothing was overwritten
    toast('The file was changed by someone else since you opened it. Your version was saved as ' + res.savedAs.split(/[\\/]/).pop() + ' — nothing was overwritten.', 'error');
    return false;
  }
  app.path = path;
  app.savedDoc = app.view.state.doc;
  if (app.readOnly) setReadOnly(false);
  emit('saved');
  api.addRecent(path);
  toast('Saved' + (missing.length ? ' (' + missing.length + ' image(s) were missing)' : ''));
  return true;
}

/** Open a document from bytes as a new, unsaved document (backups, recovery). */
export async function openCopy(bytes, { path = null, dirty = true } = {}) {
  const { json, manifest } = await unpackDocument(bytes);
  await api.docClose();
  app.created = manifest.created;
  loadDocument(json, null);
  if (dirty) app.savedDoc = null;              // shown as unsaved until the user saves it
  app.copyOf = path;
  emit('saved');                               // refresh the title
  return true;
}
