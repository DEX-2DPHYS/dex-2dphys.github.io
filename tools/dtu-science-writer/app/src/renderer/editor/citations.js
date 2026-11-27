/* Citations and the reference list in the editor. The text comes from citeproc (core/references.js) — the same
   engine as the PDF and Word export — and reaches the node views as decoration specs, like equation numbers.
   A click on a citation opens the citation dialog on it (ui/citedialog.js, command "cite"). */
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { formatReferences, htmlSegments, libraryOf } from '../../core/references.js';
import { supplementOf } from '../../core/numbering.js';
import { styleOf } from '../../core/style.js';
import { runCommand } from '../context.js';

export const refsKey = new PluginKey('references');

/** Formatted text (citeproc HTML) -> DOM, through htmlSegments (never innerHTML: titles come from outside). */
function fillSegments(el, html) {
  el.textContent = '';
  const TAG = { italic: 'i', bold: 'b', sup: 'sup', sub: 'sub' };
  for (const s of htmlSegments(html)) {
    let node = document.createTextNode(s.text);
    for (const m of s.marks) {
      const w = document.createElement(TAG[m] || 'span');
      if (m === 'smallcaps') w.style.fontVariant = 'small-caps';
      w.appendChild(node); node = w;
    }
    el.appendChild(node);
  }
}

/** The reference list as DOM (also used for the automatic list at the end of the document). */
function bibDom(dom, title, bib, auto) {
  dom.textContent = '';
  const h = document.createElement('div');
  h.className = 'bib-title';
  h.textContent = title || 'References';
  if (auto) { const s = document.createElement('small'); s.textContent = 'added at the end — Insert → Reference list places it elsewhere'; h.appendChild(s); }
  dom.appendChild(h);
  const list = document.createElement('div');
  list.className = 'bib-list' + (bib.flush ? ' flush' : '');
  for (const e of bib.entries) {
    const row = document.createElement('div');
    row.className = 'bib-entry';
    if (bib.flush) { const l = document.createElement('span'); l.className = 'bib-label'; fillSegments(l, e.label); row.appendChild(l); }
    const b = document.createElement('span'); b.className = 'bib-body'; fillSegments(b, e.html);
    row.appendChild(b);
    list.appendChild(row);
  }
  if (!bib.entries.length) { const p = document.createElement('div'); p.className = 'bib-empty'; p.textContent = 'Nothing cited yet — Insert → Citation (Ctrl+Alt+C).'; list.appendChild(p); }
  dom.appendChild(list);
}

function decorations(doc) {
  const cite = styleOf(doc).cite;
  const lib = libraryOf(doc);
  const sup = supplementOf(doc);
  // the manuscript and the Supplementary Information each have their own numbering and list (as in the exported files)
  const parts = sup
    ? { main: { refs: formatReferences(doc, cite, 'main'), i: 0, hasList: false, end: sup.pos }, si: { refs: formatReferences(doc, cite, 'si'), i: 0, hasList: false, end: sup.pos + sup.node.nodeSize - 1 } }
    : { main: { refs: formatReferences(doc, cite), i: 0, hasList: false, end: doc.content.size } };
  const decos = [];
  doc.descendants((n, pos) => {
    const part = sup && pos > sup.pos ? parts.si : parts.main;
    if (n.type.name === 'citation') {
      const missing = (n.attrs.items || []).some(x => !lib[x.id]);
      decos.push(Decoration.node(pos, pos + n.nodeSize, missing ? { class: 'cite-missing' } : {}, { cite: part.refs.cites[part.i++] }));
    } else if (n.type.name === 'bibliography') {
      part.hasList = true;
      decos.push(Decoration.node(pos, pos + n.nodeSize, {}, { bib: part.refs.bib }));
    }
    return n.isBlock;
  });
  for (const [name, part] of Object.entries(parts)) {
    if (part.hasList || !part.refs.bib.entries.length) continue;
    const bib = part.refs.bib;
    decos.push(Decoration.widget(part.end, () => {
      const d = document.createElement('div');
      d.className = 'bibliography auto';
      d.contentEditable = 'false';
      bibDom(d, 'References', bib, true);
      return d;
    }, { side: 1, key: 'autobib-' + name + '-' + bib.entries.map(e => e.id).join(',') + '-' + JSON.stringify(bib.entries).length }));
  }
  const refs = parts.main.refs;
  return { refs, set: DecorationSet.create(doc, decos) };
}

export const citationsPlugin = new Plugin({
  key: refsKey,
  state: {
    init: (_c, state) => decorations(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old),
  },
  props: { decorations: (state) => refsKey.getState(state).set },
});

/* ---------- node views ---------- */
class CitationView {
  constructor(node, view, getPos, decos) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = document.createElement('span');
    this.dom.className = 'citation';
    this.dom.title = 'Citation — click to edit';
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      runCommand('cite');
    });
    this.update(node, decos);
  }
  update(node, decos) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const d = decos && decos.find(x => x.spec && x.spec.cite !== undefined);
    const html = d ? d.spec.cite : '[?]';
    if (html !== this.html) { this.html = html; fillSegments(this.dom, html); }
    return true;
  }
  selectNode() { this.dom.classList.add('selected'); }
  deselectNode() { this.dom.classList.remove('selected'); }
  stopEvent(e) { return e.type === 'mousedown'; }
  ignoreMutation() { return true; }
}

class BibliographyView {
  constructor(node, view, getPos, decos) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'bibliography';
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('dblclick', (e) => { e.preventDefault(); runCommand('library'); });
    this.dom.title = 'Reference list — double-click to manage the references';
    this.update(node, decos);
  }
  update(node, decos) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const d = decos && decos.find(x => x.spec && x.spec.bib);
    const bib = d ? d.spec.bib : { entries: [], flush: false };
    if (bib !== this.bib || node.attrs.title !== this.title) { this.bib = bib; this.title = node.attrs.title; bibDom(this.dom, node.attrs.title, bib, false); }
    return true;
  }
  selectNode() { this.dom.classList.add('selected'); }
  deselectNode() { this.dom.classList.remove('selected'); }
  ignoreMutation() { return true; }
}

export const citationNodeViews = {
  citation: (node, view, getPos, decos) => new CitationView(node, view, getPos, decos),
  bibliography: (node, view, getPos, decos) => new BibliographyView(node, view, getPos, decos),
};

/* ---------- commands ---------- */

/** Insert the reference list at the selection (there is one per document: an existing one is selected instead). */
export function insertBibliography(state, dispatch) {
  let at = null;
  const $sel = state.selection.$from;
  const inSI = $sel.depth >= 1 && $sel.node(1).type.name === 'supplement';
  // one list per part: the manuscript's, or the Supplementary Information's own
  if (inSI) { const base = $sel.before(1) + 1; $sel.node(1).forEach((n, off) => { if (n.type.name === 'bibliography') at = base + off; }); }
  else state.doc.forEach((n, off) => { if (n.type.name === 'bibliography') at = off; });
  if (!dispatch) return true;
  if (at !== null) { dispatch(state.tr.setSelection(NodeSelection.create(state.doc, at)).scrollIntoView()); return true; }
  const node = state.schema.nodes.bibliography.create();
  const $f = state.selection.$from;
  // after the current top-level block
  const pos = inSI ? ($f.depth >= 2 ? $f.after(2) : $f.pos) : $f.depth ? $f.after(1) : state.selection.from;
  const tr = state.tr.insert(pos, node);
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView());
  return true;
}

/**
 * Put a citation at the selection (or replace the selected one) and add new library items in the same step,
 * so one undo removes both. items: [{ id, locator }], library: the new library object (or null = unchanged).
 */
export function putCitation(view, items, mode, library) {
  const { state } = view;
  let tr = state.tr;
  if (library) tr = tr.setDocAttribute('references', library);
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'citation') {
    tr = tr.setNodeMarkup(sel.from, null, { items, mode });
    tr = tr.setSelection(NodeSelection.create(tr.doc, sel.from));
  } else {
    tr = tr.replaceSelectionWith(state.schema.nodes.citation.create({ items, mode }), true);
  }
  view.dispatch(tr.scrollIntoView());
}
