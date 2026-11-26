/* Where the pages break, for the page-boundary view of the editor.
   The Typst writer can mark every top-level block (docToTypst(doc, { positions: true })); a Typst query then tells
   the page and the height on the page where each block starts (main/typst.js, format 'query'). pageBreaks() turns
   that into places in the document: exactly in front of a block that starts a new page, and — for a paragraph or
   list that runs over a page end — at an estimated place inside it (the browser and Typst break lines a little
   differently, so that one can be a line off; the preview is exact). No editor or DOM in here. */

export const PAGE_GEOMETRY = { height: 841.89, top: 70.87, bottom: 841.89 - 70.87 };     // A4, 2.5 cm margins, in pt
const BREAKABLE = new Set(['paragraph', 'bullet_list', 'ordered_list', 'bibliography', 'outline', 'table_figure']);

/** The document position inside the block at `pos` that lies the fraction f (0..1) through its text. */
function posAtFraction(node, pos, f) {
  const total = node.textContent.length;
  if (!total) return pos;
  const want = Math.max(1, Math.min(total - 1, Math.round(total * f)));
  let seen = 0, found = null;
  node.descendants((n, off) => {
    if (found !== null) return false;
    if (n.isText) {
      if (seen + n.text.length >= want) {
        // at a word boundary, so the divider does not cut a word
        let k = want - seen;
        const sp = n.text.lastIndexOf(' ', k);
        if (sp > 0) k = sp + 1;
        found = pos + 1 + off + k;
      }
      seen += n.text.length;
    }
    return true;
  });
  return found === null ? pos : found;
}

/**
 * blocks: [{ node, pos, page, y }] — the blocks of the shown part in order, with where Typst put the start of each
 * (page from 1, y in pt from the top of the page); blocks without a place (floats, things Typst did not report)
 * are left out by the caller. pages: the number of pages.
 * Returns [{ pos, page, inside }] — a divider in front of document position pos, announcing `page`; inside: it sits
 * within a block (approximate) and not between two.
 */
export function pageBreaks(blocks, geometry = PAGE_GEOMETRY) {
  const out = [];
  const { top, bottom } = geometry, full = bottom - top;
  for (let i = 0; i + 1 < blocks.length; i++) {
    const cur = blocks[i], next = blocks[i + 1];
    const span = next.page - cur.page;
    if (span <= 0) continue;
    const atTop = next.y <= top + 6;
    if (atTop && span === 1) { out.push({ pos: next.pos, page: next.page, inside: false }); continue; }
    if (!BREAKABLE.has(cur.node.type.name) || !cur.node.textContent.length) { out.push({ pos: next.pos, page: next.page, inside: false }); continue; }
    // the block runs over the page end(s): its height on each page tells where in its text the breaks fall
    const first = Math.max(0, bottom - cur.y), last = atTop ? 0 : Math.max(0, next.y - top);
    const pagesIn = atTop ? span - 1 : span;                       // page ends inside the block
    const total = first + Math.max(0, pagesIn - 1) * full + last + (atTop ? full : 0);
    for (let m = 0; m < pagesIn; m++) {
      const f = (first + m * full) / (total || 1);
      const pos = posAtFraction(cur.node, cur.pos, f);
      out.push({ pos, page: cur.page + m + 1, inside: pos !== cur.pos });
    }
    if (atTop) out.push({ pos: next.pos, page: next.page, inside: false });
  }
  return out;
}
