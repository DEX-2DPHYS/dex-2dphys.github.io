/* The header of the Supplementary Information, at the top of its tab: its name (editable), a tick box
   "Same title and authors as the paper", and then either the paper's own title, authors and affiliations (locked:
   they follow the manuscript) or a title line and an author line to type freely (empty = left out).
   The same header is what the PDF, Word and LaTeX files of the supplementary part start with (core/parts.js). */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { supplementOf } from '../../core/numbering.js';
import { formatAuthors } from '../../core/authors.js';
import { styleOf } from '../../core/style.js';

const key = new PluginKey('siheader');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** The paper's title and author names as plain text (what the free lines start from). */
export function paperHeaderText(doc) {
  let title = '', names = '';
  doc.forEach((n) => {
    if (n.type.name === 'title') title = n.textContent;
    if (n.type.name === 'authors') names = formatAuthors(n.attrs, styleOf(doc).affil).authors.map(a => a.name).join(', ');
  });
  return { title, names };
}

function setAttrs(view, patch) {
  const sup = supplementOf(view.state.doc);
  if (!sup) return;
  let tr = view.state.tr;
  for (const [k, v] of Object.entries(patch)) tr = tr.setNodeAttribute(sup.pos, k, v);
  view.dispatch(tr.setMeta('untracked', true));
}

function header(doc, sup) {
  return (view) => {
    const a = sup.node.attrs;
    const box = el('div', 'si-head');
    box.contentEditable = 'false';
    const field = (cls, value, placeholder, title, commit) => {
      const i = el('input', cls);
      i.value = value || ''; i.placeholder = placeholder; i.title = title; i.spellcheck = false;
      i.onchange = () => commit(i.value.trim());
      i.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); i.blur(); } if (e.key === 'Escape') { i.value = value || ''; i.blur(); } };
      return i;
    };
    box.append(field('si-name', a.title, 'Supplementary Information', 'The name of this part: click to change it (Supplementary Information, Supporting Information, Supplementary Material, …)', (v) => setAttrs(view, { title: v || 'Supplementary Information' })));
    const lab = el('label', 'si-lock');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = a.lock !== false;
    cb.onchange = () => {
      if (cb.checked) return setAttrs(view, { lock: true });
      // freed: the lines start as a copy of the paper's, so only what differs needs typing
      const p = paperHeaderText(view.state.doc);
      setAttrs(view, { lock: false, freeTitle: a.freeTitle || p.title, freeAuthors: a.freeAuthors || p.names });
    };
    lab.append(cb, document.createTextNode(' Same title and authors as the paper'));
    lab.title = 'Ticked: the header follows the manuscript. Not ticked: type a title and an author line of its own (an empty line is left out).';
    box.append(lab);
    if (a.lock !== false) {
      let title = '', fa = null;
      doc.forEach((n) => { if (n.type.name === 'title') title = n.textContent; if (n.type.name === 'authors') fa = formatAuthors(n.attrs, styleOf(doc).affil); });
      box.append(el('div', 'si-title', title || '(the paper has no title yet)'));
      if (fa && fa.authors.length) {
        const line = el('div', 'si-authors');
        fa.authors.forEach((au, i) => {
          if (i) line.append(', ');
          line.append(au.name);
          const m = au.marks + (au.corresponding ? (au.marks ? ',' : '') + '*' : '');
          if (m) line.append(el('sup', null, m));
        });
        box.append(line);
        for (const af of fa.affils) { const d = el('div', 'si-affil'); d.append(el('sup', null, af.mark), af.text); box.append(d); }
      }
    } else {
      box.append(field('si-title si-free', a.freeTitle, 'Title of the supplementary part (leave empty for none)', 'The title printed under the name', (v) => setAttrs(view, { freeTitle: v })));
      box.append(field('si-authors si-free', a.freeAuthors, 'Authors (leave empty for none)', 'The author line printed under the title', (v) => setAttrs(view, { freeAuthors: v })));
    }
    return box;
  };
}

function build(doc) {
  const sup = supplementOf(doc);
  if (!sup) return DecorationSet.empty;
  let paper = '';
  doc.forEach((n) => { if (n.type.name === 'title') paper += n.textContent; if (n.type.name === 'authors') paper += JSON.stringify(n.attrs); });
  const sig = JSON.stringify([sup.node.attrs.title, sup.node.attrs.lock, sup.node.attrs.freeTitle, sup.node.attrs.freeAuthors, paper, styleOf(doc).affil]);
  return DecorationSet.create(doc, [Decoration.widget(sup.pos + 1, header(doc, sup), { side: -1, key: 'sihead-' + sig, stopEvent: () => true, ignoreSelection: true })]);
}

export const siHeaderPlugin = new Plugin({
  key,
  state: { init: (_c, state) => build(state.doc), apply: (tr, old, _o, state) => (tr.docChanged ? build(state.doc) : old) },
  props: { decorations(state) { return key.getState(state); } },
});
