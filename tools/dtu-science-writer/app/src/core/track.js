/* Track changes. While tracking is on (doc attr `tracking`), an edit is not carried out but recorded as a suggestion:

     inline   text and inline items (math, references, citations, footnotes) carry the mark `ins` or `del`
              with { id, author, initials, time }; deleted content stays in the document until the change is accepted.
     blocks   attr `track` = { kind, id, author, initials, time }:
              - on a text block (paragraph, heading): the paragraph boundary in front of it. kind 'ins' = the boundary was
                inserted (Enter: a paragraph was split, or a new one started); 'del' = it was deleted (the paragraph is
                to be joined to the one before). This is Word's "inserted / deleted paragraph mark".
              - on a unit (equation, figure, table, page break, contents, reference list): the whole item was inserted
                or deleted; for an equation also kind 'mod' with `old: { latex }` = its formula was changed.
     Pieces with the same id are one change (a replacement = deletion + insertion; text typed in one go).

   Deleting your own pending insertion really deletes it (as in Word). Formatting (bold, heading level, style) and
   table structure are not tracked: they are simply applied.

   trackTransaction() turns a transaction into its tracked form; resolveChanges() accepts or rejects; changesOf() lists
   them; finalDoc() / originalDoc() give the document with all changes accepted / rejected (PDF and LaTeX show the
   final text). No editor or DOM in here. */
import { Fragment, Slice } from 'prosemirror-model';
import { ReplaceStep, StepMap, Mapping, Transform } from 'prosemirror-transform';
import { TextSelection, NodeSelection, Selection } from 'prosemirror-state';

export const TRACK_UNITS = new Set(['equation', 'figure', 'table_figure', 'page_break', 'outline', 'bibliography']);
/* Containers a paragraph is never merged out of (its "scope"). */
const SCOPES = new Set(['doc', 'supplement', 'abstract', 'table_cell', 'table_header', 'caption', 'footnote', 'figure', 'table_figure']);
/* Leaf items whose content is an attribute: changing it is a change of content (tracked), other attributes are not. */
const CONTENT_ATTRS = { math_inline: ['latex'], equation: ['latex'], citation: ['items', 'mode'], xref: ['target'] };

const COLORS = ['#1f4e79', '#990000', '#2f6b3a', '#7a4a00', '#5b2a86', '#0f6e72', '#7a1f5c'];
/** A stable colour per author (the same palette as the comment badges). */
export function colorFor(name) { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }

export const isTracking = (doc) => !!(doc && doc.attrs && doc.attrs.tracking);
export const newChangeId = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const isUnit = (n) => TRACK_UNITS.has(n.type.name);
const flaggable = (n) => !!(n.type.spec.attrs && 'track' in n.type.spec.attrs);
const markOf = (node, name) => node.marks.find(m => m.type.name === name) || null;
const sameAuthor = (attrs, user) => !!attrs && attrs.author === user.name;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- reading ---------- */

/** Text of an inline node for summaries. */
function label(node) {
  if (node.isText) return node.text;
  switch (node.type.name) {
    case 'math_inline': return '⟨' + (node.attrs.latex || 'equation').slice(0, 30) + '⟩';
    case 'xref': return '⟨reference⟩';
    case 'citation': return '⟨citation⟩';
    case 'footnote': return '⟨footnote⟩';
    case 'hard_break': return '↵';
    default: return '';
  }
}
const UNIT_NAME = { equation: 'equation', figure: 'figure', table_figure: 'table', page_break: 'page break', outline: 'contents list', bibliography: 'reference list' };

/**
 * The pending changes, in document order:
 * [{ id, author, initials, time, from, to, ins, del, blocks: [{ kind, type, pos, unit }] }]
 * ins / del: the inserted / deleted text (inline items as ⟨…⟩); blocks: paragraph boundaries and units.
 */
export function changesOf(doc) {
  const byId = new Map();
  const get = (a, pos, end) => {
    let c = byId.get(a.id);
    if (!c) { c = { id: a.id, author: a.author || '', initials: a.initials || '', time: a.time || '', from: pos, to: end, ins: '', del: '', blocks: [] }; byId.set(a.id, c); }
    c.from = Math.min(c.from, pos); c.to = Math.max(c.to, end);
    return c;
  };
  doc.descendants((node, pos) => {
    const end = pos + node.nodeSize;
    const t = node.attrs && node.attrs.track;
    if (t && flaggable(node)) get(t, pos, end).blocks.push({ kind: t.kind, type: node.type.name, pos, unit: isUnit(node), old: t.old || null });
    if (node.isInline) {
      const i = markOf(node, 'ins'), d = markOf(node, 'del');
      if (i) get(i.attrs, pos, end).ins += label(node);
      if (d) get(d.attrs, pos, end).del += label(node);
      // a marked footnote is one piece: its text carries the same mark, not counted twice
      if ((i || d) && !node.isText && !node.isLeaf) return false;
    }
    return true;
  });
  return [...byId.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}
export const hasChanges = (doc) => changesOf(doc).length > 0;

/** One line saying what a change does. */
export function describeChange(c) {
  const q = (s) => '“' + (s.length > 60 ? s.slice(0, 57) + '…' : s) + '”';
  const parts = [];
  if (c.del && c.ins) parts.push('Replaced ' + q(c.del) + ' with ' + q(c.ins));
  else if (c.ins) parts.push('Inserted ' + q(c.ins));
  else if (c.del) parts.push('Deleted ' + q(c.del));
  for (const b of c.blocks) {
    if (b.unit) parts.push((b.kind === 'ins' ? 'Inserted ' : b.kind === 'del' ? 'Deleted ' : 'Changed ') + UNIT_NAME[b.type]);
    else if (!c.ins && !c.del) parts.push(b.kind === 'ins' ? 'New paragraph' : 'Joined two paragraphs');
  }
  return [...new Set(parts)].join('; ') || 'Change';
}

/* ---------- accepting and rejecting ---------- */

/** The text block that ends right in front of position `pos` (only closing / opening tokens between), within the
    same scope: { node, end } (end = position at the end of its content), or null. */
function prevTextblock(doc, pos) {
  let p = pos;
  for (;;) {
    const $p = doc.resolve(p);
    const nb = $p.nodeBefore;
    if (nb) {
      let n = nb, end = p - 1;
      while (!n.isTextblock) {
        if (n.isLeaf || isUnit(n) || SCOPES.has(n.type.name) || !n.lastChild) return null;
        n = n.lastChild; end -= 1;
      }
      return { node: n, end };
    }
    if ($p.depth === 0 || SCOPES.has($p.parent.type.name)) return null;
    p = $p.before();
  }
}

/** The range that removes the block at `pos` together with ancestors it would leave empty (list item, list);
    null when its scope would be left without any block. */
function removalRange(doc, pos) {
  let from = pos, to = pos + doc.nodeAt(pos).nodeSize;
  for (;;) {
    const $f = doc.resolve(from);
    const parent = $f.parent;
    if (parent.childCount > 1) return { from, to };
    if (SCOPES.has(parent.type.name) || $f.depth === 0) return null;
    from = $f.before(); to = $f.after();
  }
}

/** Join the text block at `pos` to the one before it (its content moves to the end of that one); an empty one is
    just removed. Returns false when there is nothing to join to (the block then simply stays). */
function mergeBack(tr, pos) {
  const doc = tr.doc, node = doc.nodeAt(pos);
  if (!node || !node.isTextblock) return false;
  const range = removalRange(doc, pos);
  if (!node.content.size) { if (!range) return false; tr.delete(range.from, range.to); return true; }
  const prev = prevTextblock(doc, pos);
  if (!prev || !range) return false;
  const content = node.content;
  tr.delete(range.from, range.to);
  tr.insert(prev.end, content);
  return true;
}

/** Remove a unit (an only child of its scope leaves an empty paragraph behind). */
function removeUnit(tr, pos) {
  const doc = tr.doc, node = doc.nodeAt(pos);
  if (!node) return;
  const $p = doc.resolve(pos);
  if ($p.parent.childCount === 1) tr.replaceWith(pos, pos + node.nodeSize, doc.type.schema.nodes.paragraph.create());
  else tr.delete(pos, pos + node.nodeSize);
}

/**
 * Accept (accept = true) or reject the changes whose id passes `pick` (default: all), on a Transform / Transaction.
 * range: [from, to] limits it to changes touching that part of the document.
 */
export function resolveChanges(tr, { accept = true, pick = null, range = null } = {}) {
  const doc = tr.doc, schema = doc.type.schema;
  const want = (a, pos, end) => !!a && (!pick || pick(a.id)) && (!range || (end > range[0] && pos < range[1]) || (range[0] === range[1] && pos <= range[0] && end >= range[0]));
  const clearMarks = [], clearFlags = [], later = [];        // later: { pos, run(tr) } carried out from the end backwards
  doc.descendants((node, pos) => {
    const end = pos + node.nodeSize;
    const t = node.attrs && node.attrs.track;
    if (t && flaggable(node) && want(t, pos, end)) {
      if (isUnit(node)) {
        if (t.kind === 'mod') {
          if (accept) clearFlags.push(pos);
          else later.push({ pos, run: (x) => { const n = x.doc.nodeAt(pos); if (n) x.setNodeMarkup(pos, null, { ...n.attrs, ...(t.old || {}), track: null }); } });
        } else if ((t.kind === 'ins') === accept) clearFlags.push(pos);
        else later.push({ pos, run: (x) => removeUnit(x, pos) });
      } else if ((t.kind === 'ins') === accept) clearFlags.push(pos);
      else later.push({ pos, run: (x) => { if (!mergeBack(x, pos)) { const n = x.doc.nodeAt(pos); if (n) x.setNodeAttribute(pos, 'track', null); } } });
    }
    if (node.isInline) {
      const i = markOf(node, 'ins'), d = markOf(node, 'del');
      const wi = i && want(i.attrs, pos, end), wd = d && want(d.attrs, pos, end);
      // the piece goes when its insertion is rejected or its deletion accepted; otherwise the chosen marks come off
      if ((wi && !accept) || (wd && accept)) { later.push({ pos, run: (x) => x.delete(pos, end) }); return false; }
      if (wi) clearMarks.push([pos, end, schema.marks.ins]);
      if (wd) clearMarks.push([pos, end, schema.marks.del]);
    }
    return true;
  });
  // marks and flags first: they move nothing; then the removals and joins, from the end, so positions stay true
  for (const [a, b, type] of clearMarks) tr.removeMark(a, b, type);
  for (const pos of clearFlags) tr.setNodeAttribute(pos, 'track', null);
  later.sort((a, b) => b.pos - a.pos);
  for (const op of later) op.run(tr);
  return tr;
}

/** The document with every change accepted (what the PDF and LaTeX show). */
export function finalDoc(doc) { return hasMarkup(doc) ? resolveChanges(new Transform(doc), { accept: true }).doc : doc; }
/** The final document and the mapping from positions in doc to positions in it. */
export function finalWithMapping(doc) {
  if (!hasMarkup(doc)) return { doc, mapping: null };
  const tr = resolveChanges(new Transform(doc), { accept: true });
  return { doc: tr.doc, mapping: tr.mapping };
}
/** The document with every change rejected. */
export function originalDoc(doc) { return hasMarkup(doc) ? resolveChanges(new Transform(doc), { accept: false }).doc : doc; }
/** Cheap test: any track mark or flag at all? */
export function hasMarkup(doc) {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if ((node.attrs && node.attrs.track) || (node.isInline && node.marks.some(m => m.type.name === 'ins' || m.type.name === 'del'))) found = true;
    return !found;
  });
  return found;
}

/* ---------- recording ---------- */

/** A slice without track marks or flags (pasted or re-inserted content is a fresh insertion). */
function cleanSlice(slice) {
  const clean = (frag) => {
    const out = [];
    frag.forEach((n) => {
      if (n.isText) { out.push(n.mark(n.marks.filter(m => m.type.name !== 'ins' && m.type.name !== 'del'))); return; }
      const attrs = n.attrs && n.attrs.track ? { ...n.attrs, track: null } : n.attrs;
      out.push(n.type.create(attrs, clean(n.content), n.marks.filter(m => m.type.name !== 'ins' && m.type.name !== 'del')));
    });
    return Fragment.from(out);
  };
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
}

/** The author's own pending mark of `type` right before / after a position (typing on continues the same change). */
function adjacentOwn(doc, pos, type, user) {
  const $p = doc.resolve(pos);
  for (const n of [$p.nodeBefore, $p.nodeAfter]) {
    if (!n || !n.isInline) continue;
    const m = markOf(n, type);
    if (m && sameAuthor(m.attrs, user)) return m.attrs;
  }
  // at the start of a paragraph the author has just started: what is typed there belongs to it
  if (type === 'ins' && $p.parent.isTextblock && $p.parentOffset === 0) {
    const t = $p.parent.attrs.track;
    if (t && t.kind === 'ins' && sameAuthor(t, user)) { const { kind, old, ...attrs } = t; return attrs; }
  }
  return null;
}

/** Is this step only a change of attributes of one leaf item? Returns { node, next, content } (content: an attribute
    that counts as content changed), or null. */
function leafAttrChange(doc, step) {
  const s = step.slice;
  if (!s || s.openStart || s.openEnd || s.content.childCount !== 1 || step.to <= step.from) return null;
  const node = doc.nodeAt(step.from), next = s.content.firstChild;
  if (!node || node.isText || !node.isLeaf || node.nodeSize !== step.to - step.from || next.type !== node.type) return null;
  const keys = CONTENT_ATTRS[node.type.name] || [];
  return { node, next, content: keys.some(k => !sameJson(node.attrs[k], next.attrs[k])) };
}

/** Adding or removing rows, columns or cells of a table: structure, not tracked (the text in the cells is). */
const TABLE_PARTS = new Set(['table_row', 'table_cell', 'table_header']);
function tableStructure(doc, step) {
  let hit = false;
  step.slice.content.forEach((n) => { if (TABLE_PARTS.has(n.type.name)) hit = true; });
  if (!hit && step.to > step.from) doc.nodesBetween(step.from, step.to, (n, pos) => {
    if (hit) return false;
    const inside = pos >= step.from && pos + n.nodeSize <= step.to;
    if (isUnit(n) && inside) return false;                       // a whole table (or figure) is a unit: tracked
    if (TABLE_PARTS.has(n.type.name) && inside) hit = true;
    return !hit;
  });
  return hit;
}

/**
 * The tracked form of a transaction made on `state`: deletions become `del` marks / flags, insertions get `ins`.
 * user: { name, initials }. opts.forward: the Delete key was used (the cursor goes behind what was deleted).
 * Steps that are not content changes (formatting, attributes) are passed on as they are.
 * If anything does not fit, the original transaction is returned (the edit then happens untracked, not lost).
 */
export function trackTransaction(tr, state, user, opts = {}) {
  if (!tr.docChanged || !tr.steps.length) return tr;
  try {
    return build(tr, state, user, opts) || tr;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('track changes: edit applied untracked —', e && e.message);
    return tr;
  }
}

function build(tr, state, user, opts) {
  const schema = state.schema;
  const time = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const fresh = () => ({ id: newChangeId(), author: user.name || '', initials: user.initials || '', time });
  const ntr = state.tr;
  /* diffs: where the tracked document holds content the original (untracked) result does not — deleted content that
     was kept. { pos, len } in the coordinates of the original document after the steps handled so far. */
  let diffs = [];
  const T = (x) => x + diffs.reduce((s, d) => s + (d.pos < x ? d.len : 0), 0);
  const asMapping = () => new Mapping([...diffs].sort((a, b) => b.pos - a.pos).map(d => new StepMap([d.pos, 0, d.len])));
  let tracked = false, lastPureDelete = null;

  tr.steps.forEach((step, i) => {
    const before = tr.docs[i];                                     // the original document this step applies to
    const isReplace = step instanceof ReplaceStep;
    const leaf = isReplace ? leafAttrChange(before, step) : null;
    if (!isReplace || (leaf && !leaf.content) || tableStructure(before, step)) {
      // not a change of content: applied as it is, at its place in the tracked document
      const mapped = step.map(asMapping());
      if (mapped) ntr.step(mapped);
      const map = step.getMap();
      diffs = diffs.map(d => ({ pos: map.map(d.pos, 1), len: d.len }));
      lastPureDelete = null;
      return;
    }
    tracked = true;
    const from = T(step.from), to = step.to === step.from ? from : T(step.to);
    const doc = ntr.doc;
    // a changed display equation keeps its place: the old formula is remembered on it
    if (leaf && leaf.node.type.name === 'equation') {
      const t = leaf.node.attrs.track;
      const keep = t && (t.kind === 'mod' || (t.kind === 'ins' && sameAuthor(t, user)));
      const track = keep ? t : { kind: 'mod', ...fresh(), old: { latex: leaf.node.attrs.latex } };
      // changed back to the original formula: no change left
      const back = track.kind === 'mod' && track.old && track.old.latex === leaf.next.attrs.latex;
      ntr.setNodeMarkup(from, null, { ...leaf.next.attrs, track: back ? null : track });
      const map = step.getMap();
      diffs = diffs.map(d => ({ pos: map.map(d.pos, 1), len: d.len }));
      lastPureDelete = null;
      return;
    }

    /* 1. what the deletion covers */
    const hasInsert = step.slice.size > 0;
    const ownDel = to > from ? (adjacentOwn(doc, from, 'del', user) || adjacentOwn(doc, to, 'del', user)) : null;
    const ownIns = hasInsert ? adjacentOwn(doc, to, 'ins', user) : null;
    const shared = !ownDel && !ownIns && to > from && hasInsert ? fresh() : null;        // a replacement is one change
    // deleting a word and then typing another in its place (or the other way round) is one replacement too:
    // an insertion right next to the author's own deletion joins that change, and vice versa
    const idOnly = (a) => (a ? { id: a.id, author: a.author, initials: a.initials, time: a.time } : null);
    const delAttrs = ownDel || shared || (to > from ? idOnly(adjacentOwn(doc, from, 'ins', user) || adjacentOwn(doc, to, 'ins', user)) || fresh() : null);
    const insAttrs = ownIns || shared || (hasInsert ? idOnly(adjacentOwn(doc, to, 'del', user)) || fresh() : null);
    const mark = [], flag = [], real = [];             // real: { pos, run } — the author's own insertions, really removed
    if (to > from) doc.nodesBetween(from, to, (node, pos) => {
      const end = pos + node.nodeSize;
      const inside = pos >= from && end <= to;
      if (isUnit(node)) {
        if (!inside) return !node.isLeaf;                         // partly selected (inside its caption or cells)
        const t = node.attrs.track;
        if (t && t.kind === 'ins' && sameAuthor(t, user)) real.push({ pos, run: (x) => removeUnit(x, pos) });
        else if (!(t && t.kind === 'del')) flag.push(pos);
        return false;
      }
      if (node.isInline) {
        const a = Math.max(pos, from), b = Math.min(end, to);
        if (!node.isText && !node.isLeaf && !inside) return true;            // inside a footnote: its text
        const own = markOf(node, 'ins');
        if (own && sameAuthor(own.attrs, user)) real.push({ pos: a, run: (x) => x.delete(a, b) });
        else if (!markOf(node, 'del')) mark.push([a, b]);
        return false;
      }
      if (node.isTextblock && flaggable(node) && pos >= from && pos < to) {
        // the paragraph boundary in front of this block is deleted
        const t = node.attrs.track;
        if (t && t.kind === 'ins' && sameAuthor(t, user)) real.push({ pos, run: (x) => { if (!mergeBack(x, pos)) x.setNodeAttribute(pos, 'track', null); } });
        else if (!(t && t.kind === 'del')) flag.push(pos);
      }
      return true;
    });

    /* 2. mark (moves nothing), then really remove the author's own insertions, from the end */
    for (const [a, b] of mark) ntr.addMark(a, b, schema.marks.del.create(delAttrs));
    for (const pos of flag) ntr.setNodeAttribute(pos, 'track', { kind: 'del', ...delAttrs });
    const mark0 = ntr.steps.length, sizeBefore = ntr.doc.content.size;
    real.sort((a, b) => b.pos - a.pos);
    for (const op of real) op.run(ntr);
    const keptFrom = ntr.mapping.slice(mark0).map(from, -1);
    // what is still there of the deleted range (the original edit would have left none of it), right behind keptFrom
    const retained = Math.max(0, ntr.doc.content.size - (sizeBefore - (to - from)));
    const keptTo = keptFrom + retained;

    /* 3. the insertion, behind what was kept */
    if (hasInsert) {
      const slice = cleanSlice(step.slice);
      const at = keptTo, s0 = ntr.steps.length;
      try { ntr.step(new ReplaceStep(at, at, slice)); } catch (_) { ntr.replace(at, at, slice); }
      const end = ntr.mapping.slice(s0).map(at, 1);
      const insMark = schema.marks.ins.create(insAttrs);
      const flags = [];
      ntr.doc.nodesBetween(at, end, (node, pos) => {
        const nend = pos + node.nodeSize;
        if (isUnit(node)) { if (pos >= at && nend <= end) { flags.push(pos); return false; } return !node.isLeaf; }
        if (node.isTextblock && flaggable(node) && pos >= at && pos < end) flags.push(pos);
        return true;
      });
      ntr.removeMark(at, end, schema.marks.del);
      ntr.addMark(at, end, insMark);
      for (const pos of flags) ntr.setNodeAttribute(pos, 'track', { kind: 'ins', ...insAttrs });
    }

    /* 4. bookkeeping for the steps that follow and for the selection */
    const map = step.getMap();
    diffs = diffs.map(d => ({ pos: map.map(d.pos, 1), len: d.len }));
    if (retained) diffs.push({ pos: step.from, len: retained });
    lastPureDelete = !hasInsert && retained ? { from: step.from, len: retained } : null;
  });
  if (!tracked) return null;

  /* the selection of the original transaction, at its place in the tracked document */
  const sel = tr.selection, size = ntr.doc.content.size;
  const clamp = (x) => Math.max(0, Math.min(size, x));
  let next = null;
  try {
    if (opts.forward && lastPureDelete && sel.empty && tr.steps.length === 1) next = Selection.near(ntr.doc.resolve(clamp(T(lastPureDelete.from) + lastPureDelete.len)), 1);
    else if (sel instanceof NodeSelection) next = NodeSelection.create(ntr.doc, clamp(T(sel.from)));
    else if (sel instanceof TextSelection) next = TextSelection.create(ntr.doc, clamp(T(sel.anchor)), clamp(T(sel.head)));
  } catch (_) { next = null; }
  if (!next || (next instanceof TextSelection && (!next.$anchor.parent.inlineContent || !next.$head.parent.inlineContent))) {
    try { next = Selection.near(ntr.doc.resolve(clamp(T(sel.head))), opts.forward ? 1 : -1); } catch (_) { next = null; }
  }
  if (next) ntr.setSelection(next);
  if (tr.storedMarksSet && tr.storedMarks) ntr.setStoredMarks(tr.storedMarks.filter(m => m.type.name !== 'ins' && m.type.name !== 'del'));
  if (tr.scrolledIntoView) ntr.scrollIntoView();
  for (const k of Object.keys(tr.meta || {})) ntr.setMeta(k, tr.meta[k]);
  ntr.setMeta('tracked', true);
  return ntr;
}
