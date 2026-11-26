/* Review: the Track button, the markup view (all markup / final / original) and the commands of the Review menu.
   The change cards themselves are drawn beside the page with the comments (ui/commentspane.js). */
import { changesOf, isTracking, hasMarkup } from '../../core/track.js';
import { setTracking, resolve, gotoChange } from '../editor/track.js';
import { app, api, $, onChange, onLoad, registerCommands, toast } from '../context.js';
import { ensureUserName } from './settings.js';

const MODES = ['all', 'final', 'original'];
let mode = 'all', sent = '';

function paint() {
  const view = app.view;
  if (!view) return;
  const on = isTracking(view.state.doc);
  const btn = document.querySelector('[data-cmd="track"]');
  if (btn) { btn.classList.toggle('on', on); btn.title = (on ? 'Track changes is on: edits are recorded as suggestions' : 'Track changes: record edits as suggestions to accept or reject') + ' (Ctrl+Shift+T)'; }
  const page = $('#page');
  for (const m of MODES) page.classList.toggle('tc-' + m, mode === m);
  const n = changesOf(view.state.doc).length;
  const st = $('#st-changes');
  if (st) st.textContent = n ? n + ' change' + (n === 1 ? '' : 's') + ' to review' + (mode !== 'all' ? ' (shown: ' + (mode === 'final' ? 'final text' : 'original text') + ')' : '') : (on ? 'Tracking changes' : '');
  // the ticks in the Review menu (only when something changed: this runs on every keystroke)
  const sig = on + '/' + mode;
  if (sig !== sent && api.viewState) { sent = sig; api.viewState({ tracking: on, markup: mode }); }
}

async function toggleTracking() {
  const view = app.view;
  if (app.readOnly) { toast('The document is read-only.'); return; }
  const on = !isTracking(view.state.doc);
  if (on && !(await ensureUserName())) return;           // changes carry the author's name
  setTracking(view, on);
  toast(on ? 'Track changes is on: what you type, delete or move is recorded as a suggestion.' : 'Track changes is off: edits are made directly. The changes already recorded stay until accepted or rejected.');
}

function setMode(m) {
  mode = MODES.includes(m) ? m : 'all';
  paint();
}

function act(accept, opts, none) {
  if (app.readOnly) { toast('The document is read-only.'); return 0; }
  const n = resolve(app.view, accept, opts);
  if (!n && none) toast(none);
  return n;
}

registerCommands({
  track: toggleTracking,
  acceptChange: (id) => act(true, typeof id === 'string' ? { id } : { atCursor: true }, 'Put the cursor in a change (or use Accept all).'),
  rejectChange: (id) => act(false, typeof id === 'string' ? { id } : { atCursor: true }, 'Put the cursor in a change (or use Reject all).'),
  acceptAll: () => { const n = act(true, {}, 'There are no changes to accept.'); if (n) toast(n + ' change' + (n === 1 ? '' : 's') + ' accepted. Ctrl+Z undoes it.'); return n; },
  rejectAll: () => { const n = act(false, {}, 'There are no changes to reject.'); if (n) toast(n + ' change' + (n === 1 ? '' : 's') + ' rejected. Ctrl+Z undoes it.'); return n; },
  nextChange: () => { if (!gotoChange(app.view, 1)) toast('No changes in this document.'); },
  prevChange: () => { if (!gotoChange(app.view, -1)) toast('No changes in this document.'); },
  markupAll: () => setMode('all'), markupFinal: () => setMode('final'), markupOriginal: () => setMode('original'),
});

export const markupMode = () => mode;
export const hasPendingChanges = () => !!app.view && hasMarkup(app.view.state.doc);

onChange(paint);
onLoad(() => { mode = 'all'; paint(); });
