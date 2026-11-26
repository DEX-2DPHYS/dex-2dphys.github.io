/* Editor plugins: ids for labelled items, live numbering (headings, captions, equations, cross-references),
   placeholders, typographic input rules. */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { computeNumbers, missingIds, FORMS, refText, outlineEntries, contextBefore, inSupplement } from '../../core/numbering.js';
import { styleOf } from '../../core/style.js';

/** Every heading, figure and equation gets a unique id (also after copy/paste). */
export const idPlugin = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some(t => t.docChanged)) return null;
    const fixes = missingIds(state.doc);
    if (!fixes.length) return null;
    const tr = state.tr;
    for (const f of fixes) tr.setNodeAttribute(f.pos, 'id', f.id);
    tr.setMeta('addToHistory', false);
    return tr;
  },
});

/** The document always ends with a paragraph, so there is somewhere to type after a final equation or figure. */
export const trailingParagraph = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some(t => t.docChanged)) return null;
    const last = state.doc.lastChild;
    if (last && last.type.name === 'paragraph') return null;
    return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create()).setMeta('addToHistory', false);
  },
});

export const numberingKey = new PluginKey('numbering');

function numberDecorations(doc) {
  const nums = computeNumbers(doc);
  const decos = [];
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === 'heading') {
      const info = nums.byPos.get(pos);
      if (info && info.num) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': info.num }));
      return false;
    }
    if (t === 'figure') {
      const info = nums.byPos.get(pos);
      const capPos = pos + 1 + node.firstChild.nodeSize;
      const cap = node.lastChild;
      decos.push(Decoration.node(capPos, capPos + cap.nodeSize, { 'data-num': FORMS.captionLabel(info.num == null ? '–' : info.num, info.label), class: cap.content.size ? '' : 'empty' }));
      // a wrapped figure needs text after it to flow around (same rule as the Typst export)
      if (node.attrs.placement === 'wrap') {
        const next = doc.resolve(pos + node.nodeSize).nodeAfter;
        if (!next || next.type.name !== 'paragraph' || !next.content.size) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nowrap' }));
      }
      return true;      // descend: captions can hold cross-references
    }
    if (t === 'table_figure') {
      const info = nums.byPos.get(pos);
      const cap = node.firstChild;
      decos.push(Decoration.node(pos + 1, pos + 1 + cap.nodeSize, { 'data-num': FORMS.tableCaptionLabel(info.num == null ? '–' : info.num), class: cap.content.size ? '' : 'empty' }));
      return true;
    }
    if (t === 'caption' || t === 'image') return t === 'caption';
    if (t === 'equation') {
      const info = nums.byPos.get(pos);
      decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { eqNum: info && info.num }));
      return false;
    }
    if (t === 'xref') {
      const info = nums.byId.get(node.attrs.target);
      const $p = doc.resolve(pos);
      const prev = contextBefore($p.parent, $p.index());
      decos.push(Decoration.node(pos, pos + node.nodeSize, info ? { 'data-ref': refText(info, prev) } : { 'data-ref': '??', class: 'xref-missing' }));
    }
    if (t === 'authors') {
      // the affiliation format lives in the document style: a changed format redraws the author block
      const st = styleOf(doc);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-affil': st.affil.marker + '/' + st.affil.fields }));
      return false;
    }
    if (t === 'footnote') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { fnNum: nums.footnotes.get(pos) }));
      return false;
    }
    if (t === 'outline') {
      // the entries of a table of contents / list (editor/structure.js draws them)
      decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { outline: outlineEntries(doc, node.attrs.kind, nums, inSupplement(doc, pos) ? 'si' : 'main') }));
      return false;
    }
    if ((t === 'paragraph' || t === 'title') && !node.content.size) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'empty' }));
    }
    return true;
  });
  return { nums, set: DecorationSet.create(doc, decos) };
}

export const numberingPlugin = new Plugin({
  key: numberingKey,
  state: {
    init: (_, state) => numberDecorations(state.doc),
    apply: (tr, value, _old, state) => (tr.docChanged ? numberDecorations(state.doc) : value),
  },
  props: { decorations: (state) => numberingKey.getState(state).set },
});

/* Typography while typing: curly quotes, dashes, ellipsis; $…$ becomes inline math. */
const typo = [
  new InputRule(/(?:^|[\s{[(<'"‘“])(")$/, '“'),
  new InputRule(/"$/, '”'),
  new InputRule(/(?:^|[\s{[(<'"‘“])(')$/, '‘'),
  new InputRule(/'$/, '’'),
  new InputRule(/--$/, '–'),
  new InputRule(/–-$/, '—'),
  new InputRule(/\.\.\.$/, '…'),
];

export function buildInputRules(schema) {
  const rules = [...typo];
  rules.push(new InputRule(/(?:^|[^$\\])\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => {
    const latex = match[1];
    const off = match[0].length - latex.length - 2;
    return state.tr.replaceWith(start + off, end, schema.nodes.math_inline.create({ latex }));
  }));
  rules.push(textblockTypeInputRule(/^(#{1,4})\s$/, schema.nodes.heading, (m) => ({ level: m[1].length })));
  rules.push(wrappingInputRule(/^\s*([-*•])\s$/, schema.nodes.bullet_list));
  rules.push(wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, (m) => ({ order: +m[1] }), (m, n) => n.childCount + n.attrs.order === +m[1]));
  return inputRules({ rules });
}
