/* Window title (with the unsaved-changes dot), word count, toolbar button states, page style. */
import { NodeSelection } from 'prosemirror-state';
import { app, api, $, fileName, isDirty, onChange, onLoad, onSaved } from '../context.js';
import { applyStyleToPage } from './styledialog.js';

export function refreshTitle() {
  const dirty = isDirty();
  api.setTitle((dirty ? '● ' : '') + fileName() + ' — DTU Science Writer');
  api.setDirty(dirty);
}

function wordCount(doc) {
  let n = 0;
  doc.descendants((node) => { if (node.isText) n += (node.text.match(/\S+/g) || []).length; return true; });
  return n;
}
function refreshStatus() { $('#st-words').textContent = wordCount(app.view.state.doc).toLocaleString('en-GB') + ' words'; }

function blockStyleOf(state) {
  const p = state.selection.$from.parent;
  if (p.type.name === 'heading') return 'h' + p.attrs.level;
  if (p.type.name === 'paragraph') return 'p';
  return '';
}
function markActive(state, type) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}
export function refreshToolbar() {
  const s = app.view.state;
  const sel = $('#tb-style');
  const bs = blockStyleOf(s);
  sel.value = bs || '';
  sel.disabled = !bs;
  for (const m of ['bold', 'italic', 'underline', 'sup', 'sub']) {
    const b = document.querySelector('[data-cmd="' + m + '"]');
    if (b) b.classList.toggle('on', markActive(s, s.schema.marks[m]));
  }
  const numBtn = document.querySelector('[data-cmd="numbered"]');
  let numbered = null;
  if (s.selection instanceof NodeSelection && s.selection.node.type.name === 'equation') numbered = s.selection.node.attrs.numbered;
  else if (s.selection.$from.parent.type.name === 'heading') numbered = s.selection.$from.parent.attrs.numbered;
  numBtn.disabled = numbered === null;
  numBtn.classList.toggle('on', !!numbered);
}

function refreshAll() {
  applyStyleToPage(app.view.state.doc, $('#page'));
  refreshTitle(); refreshToolbar(); refreshStatus();
}

onChange((tr) => {
  refreshToolbar();
  if (tr.docChanged) { applyStyleToPage(app.view.state.doc, $('#page')); refreshTitle(); refreshStatus(); }
});
onLoad(refreshAll);
onSaved(refreshTitle);
