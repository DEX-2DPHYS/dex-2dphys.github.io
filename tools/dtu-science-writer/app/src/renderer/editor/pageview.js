/* Page breaks in the text (View → Page breaks in the text): a thin divider "page 3" where each page of the PDF
   starts, drawn in the editor while you write. The places come from Typst after each preview (doc/preview.js asks,
   core/pages.js decides): exact in front of a block, estimated inside a paragraph that runs over a page end.
   Off by default; remembered in the settings. */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { pageBreaks } from '../../core/pages.js';
import { supplementOf } from '../../core/numbering.js';

export const pageKey = new PluginKey('pageview');
let on = false;
export const pageBreaksOn = () => on;

function divider(page, inside) {
  return () => {
    const d = document.createElement(inside ? 'span' : 'div');
    d.className = 'pgbreak' + (inside ? ' pgbreak-in' : '');
    d.contentEditable = 'false';
    d.setAttribute('data-page', 'page ' + page);
    d.title = inside ? 'About here page ' + page + ' starts (the preview is exact)' : 'Page ' + page + ' starts here';
    return d;
  };
}

function build(doc, data) {
  if (!on || !data) return DecorationSet.empty;
  const byIndex = new Map(data.positions.map(([i, page, y]) => [i, { page, y }]));
  const sup = supplementOf(doc);
  const blocks = [];
  const add = (node, pos, k) => {
    const fi = data.blockOf[k];
    const at = fi === undefined ? null : byIndex.get(fi);
    // floats are placed by Typst away from where they stand in the text: they say nothing about the page of the text
    const floating = (node.type.name === 'figure' || node.type.name === 'table_figure') && node.attrs.placement === 'float';
    if (at && !floating && !(node.attrs && node.attrs.track && node.attrs.track.kind === 'del')) blocks.push({ node, pos, page: at.page, y: at.y });
  };
  if (data.part === 'si') {
    if (!sup) return DecorationSet.empty;
    sup.node.forEach((n, off, i) => add(n, sup.pos + 1 + off, i + 2));           // the SI document starts with title and authors
  } else {
    doc.forEach((n, off, i) => { if (n.type.name !== 'supplement') add(n, off, i); });
  }
  const decos = pageBreaks(blocks).map(b => Decoration.widget(b.pos, divider(b.page, b.inside), { side: -1, key: 'pg' + b.page + (b.inside ? 'i' : 'b'), ignoreSelection: true }));
  return DecorationSet.create(doc, decos);
}

export const pageViewPlugin = new Plugin({
  key: pageKey,
  state: {
    init: () => ({ data: null, set: DecorationSet.empty }),
    apply(tr, old, _o, state) {
      const meta = tr.getMeta(pageKey);
      if (meta) return { data: meta.data === undefined ? old.data : meta.data, set: build(state.doc, meta.data === undefined ? old.data : meta.data) };
      // typing moves the dividers along; the next preview puts them right
      return tr.docChanged ? { data: old.data, set: old.set.map(tr.mapping, tr.doc) } : old;
    },
  },
  props: { decorations(state) { return pageKey.getState(state).set; } },
});

/** New places from Typst: { part, blockOf, positions, pages }. */
export function setPagePositions(view, data) { view.dispatch(view.state.tr.setMeta(pageKey, { data })); }

/** Switch the dividers on or off. */
export function setPageBreaks(view, value) {
  on = !!value;
  if (view) view.dispatch(view.state.tr.setMeta(pageKey, on ? {} : { data: null }));
}
