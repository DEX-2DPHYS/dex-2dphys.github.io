/* Typed cross-references -> live ones. A manuscript from Word usually has "Fig. 2a", "Figs. 1a–e and 3", "Table S1",
   "Eq. (4)", "Section S1.1" typed as text; they go stale when a figure is added or moved. findTypedXrefs locates the
   numbers after such a label (lists and ranges too) that match a figure, table, equation or section of the document;
   convertTypedXrefs replaces each number by a reference. The label and the panel letters stay as typed, so the text
   reads as before ("Figs. " + reference + "a–e and " + reference).
   Numbers follow the document's own numbering: "S3" is the third figure of the Supplementary Information. */
import { Fragment } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { computeNumbers } from './numbering.js';
import { withoutColour } from './typedrefs.js';

const SP = '[\\s\\u00a0]*';
const KINDS = [
  { type: 'figure', label: '(?:Supplementary' + SP + ')?(?:Figs?\\.?|Figures?)' },
  { type: 'table_figure', label: '(?:Supplementary' + SP + ')?Tables?' },
  { type: 'equation', label: '(?:Eqs?\\.?|Equations?)' },
  { type: 'heading', label: '(?:Supplementary' + SP + 'Notes?|Sections?|Secs?\\.)' },
];
const OBJ = '￼';        // stands for a non-text inline node in the flattened text

/** [{ from, to, target, type }] — the numbers to replace, in document order. */
export function findTypedXrefs(doc, nums) {
  doc = withoutColour(doc);
  nums = nums || computeNumbers(doc);
  const byNum = new Map();
  for (const [id, info] of nums.byId) if (info.num) byNum.set(info.type + ':' + info.num, id);
  const out = [];
  doc.descendants((block, bpos) => {
    if (!block.isTextblock) return true;
    if (block.type.name === 'title' || block.type.name === 'heading') return false;
    // the block as one string, with the document position of every character
    let text = '';
    const at = [];
    block.forEach((c, off) => {
      if (c.isText) { for (let i = 0; i < c.text.length; i++) at.push(bpos + 1 + off + i); text += c.text; }
      else { at.push(-1); text += OBJ; }
    });
    for (const k of KINDS) {
      const re = new RegExp('(?:^|[\\s(\\[;,])(' + k.label + ')' + SP, 'g');
      let m;
      while ((m = re.exec(text))) {
        const supplementary = /^supplementary/i.test(m[1]);
        let i = m.index + m[0].length;
        for (;;) {
          const open = /^\(/.exec(text.slice(i));
          if (open) i += 1;
          const n = (k.type === 'heading' ? /^S?\d+(?:\.\d+)*/ : /^S?\d+/).exec(text.slice(i));
          if (!n) break;
          // "Supplementary Fig. 3" means the SI's third figure
          const key = supplementary && !/^S/.test(n[0]) ? 'S' + n[0] : n[0];
          const target = byNum.get(k.type + ':' + key);
          const from = at[i], last = at[i + n[0].length - 1];
          // the number must be plain text in one piece, and not the start of something longer ("Fig. 12" for figure 1)
          const next = text[i + n[0].length] || '';
          if (target && from > 0 && last === from + n[0].length - 1 && !/[\d.]\d/.test(next + (text[i + n[0].length + 1] || ''))) out.push({ from, to: last + 1, target, type: k.type });
          i += n[0].length;
          // panel letters "a", "a–e", "(a)", a closing bracket, then a separator before the next number
          const tail = /^(?:\(?[a-z]\)?(?:\s*[–—-]\s*\(?[a-z]\)?)?)?\)?(\s*(?:,|;|and|&|or|to|–|—|-)\s*)(?=\(?S?\d)/.exec(text.slice(i));
          if (!tail) break;
          i += tail[0].length;
        }
        re.lastIndex = Math.max(re.lastIndex, i);
      }
    }
    return false;
  });
  out.sort((a, b) => a.from - b.from);
  return out.filter((x, i) => i === 0 || x.from >= out[i - 1].to);
}

/** One transaction replacing every found number by a reference. */
export function convertTypedXrefs(state, found) {
  let tr = state.tr;
  for (const x of [...found].sort((a, b) => b.from - a.from)) {
    tr = tr.replaceWith(x.from, x.to, Fragment.from(state.schema.nodes.xref.create({ target: x.target })));
  }
  return tr;
}

/** The document with every found number replaced (no editor state needed). */
export function withTypedXrefs(doc, found) {
  const tr = new Transform(doc);
  for (const x of [...found].sort((a, b) => b.from - a.from)) tr.replaceWith(x.from, x.to, Fragment.from(doc.type.schema.nodes.xref.create({ target: x.target })));
  return tr.doc;
}
