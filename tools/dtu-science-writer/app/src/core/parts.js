/* The two parts of a paper: the manuscript and its Supplementary Information (SI).
   In the editor they are one document — the SI is the optional last node `supplement` — so cross-references between
   them are live ("Fig. S3" in the main text follows the SI), the reference library is shared, and one file holds both.
   Journals want two files: splitParts() gives two complete documents. A reference that crosses from one part into the
   other becomes the text it shows ("Fig. S3"): the other file cannot be linked to. */
import { Fragment } from 'prosemirror-model';
import { schema } from './schema.js';
import { computeNumbers, refText, nextContext, supplementOf } from './numbering.js';

export { supplementOf };
export const hasSupplement = (doc) => !!supplementOf(doc);
export const PARTS = [['main', 'Manuscript'], ['si', 'Supplementary Information']];

/** Which part a document position is in: 'main' or 'si'. */
export function partAt(doc, pos) {
  const s = supplementOf(doc);
  return s && pos > s.pos ? 'si' : 'main';
}

/**
 * { main, si } — two documents for export / preview; si is null when there is no SI.
 * main: the document without the SI. si: the name of the part, the paper's title and authors (or its own), its blocks
 * (attrs.part = 'si', which numbers them S1, S2, … on their own).
 */
export function splitParts(doc) {
  const sup = supplementOf(doc);
  if (!sup) return { main: doc, si: null };
  const nums = computeNumbers(doc);
  const siIds = new Set(), mainIds = new Set();
  for (const [id, info] of nums.byId) (info.si ? siIds : mainIds).add(id);

  /* cross-part references -> their text, with the marks of the reference (the context decides "Fig. S3" or "S3") */
  const freeze = (node, foreign) => {
    if (node.isText || node.isLeaf) return node;
    const out = [];
    let ctx = '';
    node.forEach((c) => {
      const info = c.type.name === 'xref' && foreign.has(c.attrs.target) ? nums.byId.get(c.attrs.target) : null;
      if (info) { const t = refText(info, ctx); if (t) out.push(schema.text(t, c.marks)); }
      else out.push(freeze(c, foreign));
      if (node.inlineContent) ctx = nextContext(ctx, c);
    });
    return node.copy(Fragment.from(out));
  };

  const mainKids = [], head = {};
  doc.forEach((n) => {
    if (n.type.name === 'supplement') return;
    if (n.type.name === 'title' || n.type.name === 'authors') head[n.type.name] = n;
    mainKids.push(freeze(n, siIds));
  });
  const main = schema.nodes.doc.create({ ...doc.attrs, part: 'main' }, mainKids);

  const siKids = [];
  sup.node.forEach(n => siKids.push(freeze(n, mainIds)));
  /* its header: the name of the part on the first line (attrs.partLabel, written by the three writers above the
     title), then — locked, the standard — the paper's own title and authors; or the title and author line typed
     for it (attrs.partAuthors: a plain line instead of the structured author block; '' = none). */
  const a = sup.node.attrs;
  const locked = a.lock !== false;
  const free = String(a.freeTitle || '').trim();
  const siTitle = locked ? (head.title ? head.title.copy(head.title.content) : schema.nodes.title.create())
    : schema.nodes.title.create(null, free ? [schema.text(free)] : []);
  const siAuthors = locked && head.authors ? head.authors : schema.nodes.authors.create();
  const si = schema.nodes.doc.create({ ...doc.attrs, part: 'si', partLabel: a.title || 'Supplementary Information', partAuthors: locked ? null : String(a.freeAuthors || '').trim() },
    [siTitle, siAuthors, ...siKids]);
  return { main, si };
}
const children = (node) => { const out = []; node.forEach(c => out.push(c)); return out; };

/** The document of one part ('main' | 'si'); the whole document when it has no SI. */
export function partDoc(doc, part) {
  const { main, si } = splitParts(doc);
  return part === 'si' && si ? si : main;
}
