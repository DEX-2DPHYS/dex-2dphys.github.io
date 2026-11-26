/* Shared context of the renderer: application state, the bridge to the main process, a command registry and
   change events. Modules talk to each other through this, not by importing each other, so editor/, ui/ and doc/
   stay independent:
     editor/  the editing surface (schema setup, plugins, node views)
     ui/      toolbar, status line, dialogs, context row, update bar
     doc/     files (new/open/save), preview, export */
import { EXT } from '../core/fileformat.js';

export const api = window.dsw;
export const $ = (s) => document.querySelector(s);

export const app = {
  view: null,          // the EditorView
  path: null,          // file on disk, or null for a new document
  savedDoc: null,      // document as last saved/opened (for the dirty flag)
  created: null,       // creation date from the file's manifest
  info: null,          // { version, test, openPath } from the main process
  settings: {},        // user settings (name, initials, …) from the main process
  readOnly: false,     // someone else has the document open (lock file)
  lockOwner: null,     // { user, machine, opened } of that someone
};

export const fileName = () => (app.path ? app.path.split(/[\\/]/).pop() : 'Untitled.' + EXT);
export const baseName = () => fileName().replace(/\.[^.]+$/, '');
// savedDoc null = never saved (a recovered or backup copy): counts as unsaved
export const isDirty = () => !!(app.view && (!app.savedDoc || !app.view.state.doc.eq(app.savedDoc)));

/* ---------- commands: name -> function (toolbar buttons, menu, shortcuts, node views) ---------- */
export const commands = {};
export function registerCommands(map) { Object.assign(commands, map); }
export function runCommand(name, ...args) {
  const c = commands[name];
  if (!c) { console.warn('unknown command', name); return undefined; }
  return c(...args);
}

/* ---------- events ---------- */
const listeners = { change: [], load: [], saved: [], readonly: [] };
/** fn() when the document became read-only or editable (lock lost / lock free) */
export const onReadOnly = (fn) => listeners.readonly.push(fn);
/** fn(tr, state) after every transaction */
export const onChange = (fn) => listeners.change.push(fn);
/** fn() after a document was loaded or created */
export const onLoad = (fn) => listeners.load.push(fn);
/** fn() after the document was saved */
export const onSaved = (fn) => listeners.saved.push(fn);
export function emit(kind, ...args) {
  if (!listeners[kind]) throw new Error('unknown event ' + kind);
  for (const fn of listeners[kind]) { try { fn(...args); } catch (e) { console.error(e); } }
}

/* ---------- messages ---------- */
export function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show ' + (kind || '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, kind === 'error' ? 7000 : 3500);
}
