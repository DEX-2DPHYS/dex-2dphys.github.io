/* Document structure in the editor (step 4): footnotes, table of contents / lists of figures and tables, page breaks,
   the start of the appendix. Numbers and list entries come from the numbering plugin (decoration specs), so editor,
   PDF and Word agree. */
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { StepMap } from 'prosemirror-transform';
import { keymap } from 'prosemirror-keymap';
import { undo, redo } from 'prosemirror-history';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { OUTLINE_TITLE } from '../../core/numbering.js';
import { mathNodeViews } from './mathview.js';
import { blockInsertPos, blockDepth } from './mathview.js';

/* ---------- footnotes ---------- */

/* The footnote shows as its number; selected, a small editor for its text opens below it (ProseMirror's nested-editor
   pattern): its steps are mapped into the document, so the text is part of the document and of its undo history. */
class FootnoteView {
  constructor(node, view, getPos, decos) {
    this.node = node; this.outerView = view; this.getPos = getPos;
    this.dom = document.createElement('span');
    this.dom.className = 'footnote';
    this.num = document.createElement('sup');
    this.num.className = 'fn-num';
    this.dom.appendChild(this.num);
    this.inner = null;
    this.setNumber(decos);
  }
  setNumber(decos) {
    const d = decos && decos.find(x => x.spec && x.spec.fnNum !== undefined);
    this.num.textContent = d ? String(d.spec.fnNum) : '*';
    this.dom.title = 'Footnote ' + this.num.textContent + (this.node.textContent ? ': ' + this.node.textContent.slice(0, 120) : '') + ' — click to edit';
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); if (!this.inner) this.open(); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); if (this.inner) this.close(); }

  open() {
    const box = this.dom.appendChild(document.createElement('div'));
    box.className = 'fn-editor';
    const label = box.appendChild(document.createElement('div'));
    label.className = 'fn-label';
    label.textContent = 'Footnote ' + this.num.textContent + ' — Enter or Esc to return to the text';
    const leave = () => {
      // back to the main text, right after the footnote
      const pos = this.getPos();
      if (typeof pos !== 'number') return true;
      this.outerView.dispatch(this.outerView.state.tr.setSelection(TextSelection.create(this.outerView.state.doc, pos + this.node.nodeSize)));
      this.outerView.focus();
      return true;
    };
    this.inner = new EditorView(box, {
      state: EditorState.create({
        doc: this.node,
        plugins: [keymap({
          'Mod-z': () => undo(this.outerView.state, this.outerView.dispatch),
          'Mod-y': () => redo(this.outerView.state, this.outerView.dispatch),
          'Shift-Mod-z': () => redo(this.outerView.state, this.outerView.dispatch),
          'Mod-b': toggleMark(this.node.type.schema.marks.bold), 'Mod-i': toggleMark(this.node.type.schema.marks.italic),
          Enter: leave, Escape: leave,
        }), keymap(baseKeymap)],
      }),
      editable: () => this.outerView.editable,
      dispatchTransaction: (tr) => this.dispatchInner(tr),
      nodeViews: { math_inline: mathNodeViews.math_inline },
      handleDOMEvents: { mousedown: () => { if (this.outerView.hasFocus()) this.inner.focus(); return false; } },
      attributes: { class: 'fn-text', spellcheck: 'true' },
    });
    setTimeout(() => { if (this.inner) { this.inner.focus(); this.inner.dispatch(this.inner.state.tr.setSelection(TextSelection.atEnd(this.inner.state.doc)).setMeta('fromOutside', true)); } }, 0);
  }
  close() { this.inner.destroy(); this.inner = null; const box = this.dom.querySelector('.fn-editor'); if (box) box.remove(); }

  dispatchInner(tr) {
    const { state, transactions } = this.inner.state.applyTransaction(tr);
    this.inner.updateState(state);
    if (tr.getMeta('fromOutside')) return;
    const outerTr = this.outerView.state.tr, offset = StepMap.offset(this.getPos() + 1);
    for (const t of transactions) for (const step of t.steps) outerTr.step(step.map(offset));
    if (outerTr.docChanged) this.outerView.dispatch(outerTr);
  }

  update(node, decos) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    this.setNumber(decos);
    if (this.inner) {
      // changes from outside (undo, a collaborator's merge): bring the inner editor in line
      const state = this.inner.state;
      const start = node.content.findDiffStart(state.doc.content);
      if (start != null) {
        let { a: endA, b: endB } = node.content.findDiffEnd(state.doc.content);
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) { endA += overlap; endB += overlap; }
        this.inner.dispatch(state.tr.replace(start, endB, node.slice(start, endA)).setMeta('fromOutside', true));
      }
    }
    return true;
  }
  destroy() { if (this.inner) this.close(); }
  stopEvent(e) { return !!(this.inner && this.inner.dom.contains(e.target)); }
  ignoreMutation() { return true; }
}

/** Insert an empty footnote at the cursor and open it for typing. */
export function insertFootnote(state, dispatch) {
  const type = state.schema.nodes.footnote;
  if (!dispatch) return true;
  const { $from } = state.selection;
  if (!$from.parent.type.contentMatch.matchType(type) && !$from.parent.inlineContent) return false;
  const node = type.create();
  const tr = state.tr.replaceSelectionWith(node, false);
  const pos = tr.selection.from - node.nodeSize;
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  dispatch(tr.scrollIntoView());
  return true;
}

/* ---------- table of contents, lists of figures and tables ---------- */
class OutlineView {
  constructor(node, view, getPos, decos) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'outline outline-' + node.attrs.kind;
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-pos]');
      if (!li) return;
      e.preventDefault();
      this.goTo(+li.dataset.pos);
    });
    this.update(node, decos);
  }
  goTo(pos) {
    const { view } = this;
    const $p = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size));
    view.dispatch(view.state.tr.setSelection(TextSelection.near($p)));
    const dom = view.nodeDOM(pos);
    if (dom && dom.scrollIntoView) dom.scrollIntoView({ block: 'center', behavior: 'smooth' });
    view.focus();
  }
  update(node, decos) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const d = decos && decos.find(x => x.spec && x.spec.outline);
    const entries = d ? d.spec.outline : [];
    const key = node.attrs.kind + '|' + node.attrs.title + '|' + JSON.stringify(entries);
    if (key === this.key) return true;
    this.key = key;
    const kind = node.attrs.kind;
    this.dom.textContent = '';
    const h = this.dom.appendChild(document.createElement('div'));
    h.className = 'ol-title';
    h.textContent = node.attrs.title || OUTLINE_TITLE[kind];
    const list = this.dom.appendChild(document.createElement('div'));
    list.className = 'ol-list';
    for (const e of entries) {
      const row = list.appendChild(document.createElement('div'));
      row.className = 'ol-entry ol-l' + e.level;
      row.dataset.pos = e.pos;
      const label = kind === 'figures' ? 'Fig. ' + e.num + '.' : kind === 'tables' ? 'Table ' + e.num + '.' : e.num || '';
      if (label) { const n = row.appendChild(document.createElement('span')); n.className = 'ol-num'; n.textContent = label; }
      row.appendChild(document.createTextNode(e.text));
    }
    if (!entries.length) { const p = list.appendChild(document.createElement('div')); p.className = 'ol-empty'; p.textContent = kind === 'contents' ? 'No headings yet.' : 'Nothing to list yet.'; }
    const foot = this.dom.appendChild(document.createElement('div'));
    foot.className = 'ol-foot';
    foot.textContent = 'Kept up to date automatically · page numbers in the PDF and in Word';
    return true;
  }
  selectNode() { this.dom.classList.add('selected'); }
  deselectNode() { this.dom.classList.remove('selected'); }
  ignoreMutation() { return true; }
}

/** Insert a table of contents ('contents') or a list of figures / tables at the cursor (after the current block). */
export const insertOutline = (kind) => (state, dispatch) => {
  if (!dispatch) return true;
  let tr = state.tr;
  const at = blockInsertPos(state, (p) => { tr = tr.split(p); });
  tr = tr.insert(at, state.schema.nodes.outline.create({ kind }));
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
  return true;
};

/* ---------- page break ---------- */
export function insertPageBreak(state, dispatch) {
  const { $from } = state.selection;
  if (!dispatch) return true;
  const bd = blockDepth($from);
  if ($from.depth > bd && $from.node(bd).type.name !== 'paragraph') return false;     // not inside tables, lists, captions
  let tr = state.tr;
  const at = blockInsertPos(state, (p) => { tr = tr.split(p); });
  tr = tr.insert(at, state.schema.nodes.page_break.create());
  const after = at + 1;
  if (!tr.doc.resolve(after).nodeAfter || !tr.doc.resolve(after).nodeAfter.isTextblock) tr = tr.insert(after, state.schema.nodes.paragraph.create());
  dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
  return true;
}

/* ---------- appendix ---------- */
/** "Appendix starts here" on the level-1 heading at the cursor (toggle; only one start per document). */
export function toggleAppendix(state, dispatch) {
  const { $from } = state.selection;
  const h = $from.parent.type.name === 'heading' ? $from.parent : null;
  if (!h || h.attrs.level !== 1 || blockDepth($from) !== 1) return false;
  if (!dispatch) return true;
  const here = $from.before($from.depth);
  const on = !h.attrs.appendix;
  const tr = state.tr;
  state.doc.forEach((n, off) => { if (n.type.name === 'heading' && n.attrs.appendix && off !== here) tr.setNodeMarkup(off, null, { ...n.attrs, appendix: false }); });
  tr.setNodeMarkup(here, null, { ...h.attrs, appendix: on });
  dispatch(tr);
  return true;
}

export const structureNodeViews = {
  footnote: (node, view, getPos, decos) => new FootnoteView(node, view, getPos, decos),
  outline: (node, view, getPos, decos) => new OutlineView(node, view, getPos, decos),
};
