/* The two parts of a paper as two tabs: Manuscript | Supplementary Information (core/parts.js).
   They are one document; a tab shows one part and hides the other, and the page preview shows the part of the tab.
   The tab follows the cursor: a click on a reference to "Fig. S2", a comment in the other part, Ctrl+End — wherever
   the selection lands, that part is shown. The tabs sit in the context row and appear once the paper has an SI. */
import { TextSelection } from 'prosemirror-state';
import { supplementOf, partAt, PARTS } from '../../core/parts.js';
import { app, $, onChange, onLoad, toast } from '../context.js';
import { schedulePreview } from '../doc/preview.js';

const state = { scroll: { main: 0, si: 0 }, sel: { main: null, si: null } };
let bar = null;

export const currentPart = () => app.part || 'main';

function paint() {
  if (!app.view) return;                       // before the first document is loaded
  const page = $('#page');
  const has = !!supplementOf(app.view.state.doc);
  if (!has) app.part = 'main';
  page.classList.toggle('has-si', has);
  page.classList.toggle('part-main', has && currentPart() === 'main');
  page.classList.toggle('part-si', has && currentPart() === 'si');
  if (bar) {
    bar.hidden = !has;
    const sup = supplementOf(app.view.state.doc);
    for (const b of bar.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.part === currentPart());
      if (b.dataset.part === 'si' && sup && b.textContent !== sup.node.attrs.title) b.textContent = sup.node.attrs.title;     // the tab carries its name
    }
  }
}

/** Show a part. The cursor goes back to where it was in that part (or to its start). */
export function showPart(part, { moveCursor = true } = {}) {
  const view = app.view;
  const sup = supplementOf(view.state.doc);
  if (!sup) { app.part = 'main'; paint(); return; }
  if (part !== 'si') part = 'main';
  const scroller = $('#editor-scroll');
  const was = currentPart();
  if (was !== part) state.scroll[was] = scroller.scrollTop;
  app.part = part;
  paint();
  if (moveCursor && partAt(view.state.doc, view.state.selection.from) !== part) {
    const doc = view.state.doc;
    let pos = state.sel[part];
    const lo = part === 'si' ? sup.pos + 1 : 0, hi = part === 'si' ? sup.pos + sup.node.nodeSize - 1 : sup.pos;
    if (pos == null || pos < lo || pos > hi) pos = part === 'si' ? sup.pos + 2 : 1;
    try { view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(pos, doc.content.size)), 1))); } catch (_) { /* keep the selection */ }
  }
  if (was !== part) { scroller.scrollTop = state.scroll[part] || 0; schedulePreview(true); }
  view.focus();
}

/** Insert → Supplementary Information: go to it, or start one (a first section and an empty paragraph). */
export function insertSupplement() {
  const view = app.view;
  if (supplementOf(view.state.doc)) { showPart('si'); return true; }
  const s = view.state.schema;
  const node = s.nodes.supplement.create(null, [s.nodes.paragraph.create()]);
  const at = view.state.doc.content.size;
  const tr = view.state.tr.insert(at, node);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)));
  showPart('si', { moveCursor: false });
  toast('Supplementary Information added: figures, tables, equations and sections in it are numbered S1, S2, … It is exported as its own PDF and Word file.');
  return true;
}

/** Format → Remove Supplementary Information… (one undo step brings it back). */
export function removeSupplement() {
  const view = app.view;
  const sup = supplementOf(view.state.doc);
  if (!sup) { toast('This document has no Supplementary Information.'); return false; }
  if (sup.node.textContent.trim() && !window.confirm('Remove the Supplementary Information from this document?\n\nReferences to its figures and tables will show “??”. Ctrl+Z brings it back.')) return false;
  showPart('main');
  view.dispatch(view.state.tr.delete(sup.pos, sup.pos + sup.node.nodeSize));
  paint();
  return true;
}

export function wirePartTabs() {
  bar = document.createElement('div');
  bar.className = 'parttabs';
  bar.hidden = true;
  bar.innerHTML = PARTS.map(([k, label]) => '<button data-part="' + k + '" title="' + (k === 'si' ? 'The Supplementary Information of this paper (numbered S1, S2, …; its own PDF and Word file)' : 'The manuscript') + '">' + label + '</button>').join('');
  bar.onmousedown = (e) => e.preventDefault();          // keep the focus in the document
  bar.onclick = (e) => { const b = e.target.closest('button'); if (b) showPart(b.dataset.part); };
  $('#ctxbar').prepend(bar);
  onLoad(() => { app.part = 'main'; state.scroll = { main: 0, si: 0 }; state.sel = { main: null, si: null }; paint(); });
  onChange((tr) => {
    const doc = app.view.state.doc;
    const sup = supplementOf(doc);
    if (!sup) { if (app.part !== 'main' || $('#page').classList.contains('has-si')) { app.part = 'main'; paint(); } return; }
    // the tab follows the cursor
    const here = partAt(doc, app.view.state.selection.from);
    state.sel[here] = app.view.state.selection.from;
    if (here !== currentPart()) showPart(here, { moveCursor: false });
    else if (tr.docChanged && (!$('#page').classList.contains('has-si') || bar.querySelector('button[data-part=si]').textContent !== sup.node.attrs.title)) paint();
  });
  paint();
}
