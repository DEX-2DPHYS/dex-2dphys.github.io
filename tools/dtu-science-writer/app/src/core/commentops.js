/* Shared comments: actions taken by someone who has the document read-only (someone else is editing it).
   They are stored next to the document (main/docs.js, one JSON line each) and applied to whichever copy of the
   document is open — the editor's (merged and saved) and the readers' own (shown at once).
   Applying is idempotent: an action already in the document changes nothing, so the files can be read again and
   again until a save holds them.
   Actions:
     { op: 'new', thread: {id, author, initials, time, text, resolved, replies}, anchor: {from, to, quote} | {node: id} }
     { op: 'reply', thread: id, reply: {id, author, initials, time, text} }
     { op: 'resolve', thread: id, resolved: bool, time }      (thread.statusTime: time of the last resolve/reopen)
     { op: 'edit', thread: id, text, time }                    (thread.editTime: time of the last edit) */
import { threadsOf, anchorsOf, NODE_ANCHORS } from './comments.js';

const LEAF = '￼';           // one character per inline non-text node (math, cross-reference, citation)

/** Anchor description for a thread now in `doc` (the reader's copy): positions plus the quoted text. */
export function describeAnchor(doc, id) {
  let eq = null;
  doc.descendants((n) => { if (eq === null && NODE_ANCHORS.has(n.type.name) && (n.attrs.comments || []).includes(id)) eq = n.attrs.id; return eq === null; });
  if (eq) return { node: eq };
  const a = anchorsOf(doc).get(id);
  if (!a) return null;
  const quote = doc.textBetween(a.from, a.to, '\n', LEAF).split('\n')[0];
  return { from: a.from, to: a.from + quote.length, quote };
}

/** Where to anchor `anchor` in `doc` (the text may have changed): {from, to} of the quote nearest the old place,
    else the whole text block at the old place. null when nothing fits. */
export function findAnchor(doc, anchor) {
  const quote = anchor.quote || '';
  let best = null, fallback = null;
  doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    const start = pos + 1, end = start + n.content.size;
    if (anchor.from >= start && anchor.from <= end && n.content.size) fallback = { from: start, to: end };
    if (quote) {
      let text = '';
      n.forEach((c) => { text += c.isText ? c.text : LEAF; });
      for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
        const d = Math.abs(start + i - anchor.from);
        if (!best || d < best.d) best = { from: start + i, to: start + i + quote.length, d };
      }
    }
    return false;
  });
  return best ? { from: best.from, to: best.to } : fallback;
}

/** Apply actions to an editor state: returns a transaction, or null when everything is already there. */
export function applyCommentOps(state, ops) {
  let tr = state.tr, changed = false;
  let threads = { ...threadsOf(state.doc) };
  const put = (id, t) => { threads = { ...threads, [id]: t }; changed = true; };
  for (const o of ops || []) {
    if (!o || typeof o !== 'object') continue;
    if (o.op === 'new' && o.thread && o.thread.id && !threads[o.thread.id]) {
      const id = o.thread.id, a = o.anchor || {};
      if (a.node) {
        let at = null;
        tr.doc.descendants((n, pos) => { if (at === null && NODE_ANCHORS.has(n.type.name) && n.attrs.id === a.node) at = { n, pos }; return at === null; });
        if (!at) continue;
        tr = tr.setNodeMarkup(at.pos, null, { ...at.n.attrs, comments: [...(at.n.attrs.comments || []), id] });
      } else {
        const r = findAnchor(tr.doc, a);
        if (!r) continue;
        tr = tr.addMark(r.from, r.to, state.schema.marks.comment.create({ id }));
      }
      put(id, { ...o.thread, replies: o.thread.replies || [] });
    } else if (o.op === 'reply' && threads[o.thread] && o.reply && o.reply.id) {
      const t = threads[o.thread];
      if ((t.replies || []).some(r => r.id === o.reply.id)) continue;
      put(o.thread, { ...t, replies: [...(t.replies || []), o.reply] });
    } else if (o.op === 'resolve' && threads[o.thread]) {
      // a toggle: only a newer action counts, so reading an old file again never undoes a later reopen
      const t = threads[o.thread];
      if (!!t.resolved === !!o.resolved || (t.statusTime && (!o.time || o.time <= t.statusTime))) continue;
      put(o.thread, { ...t, resolved: !!o.resolved, statusTime: o.time });
    } else if (o.op === 'edit' && threads[o.thread] && typeof o.text === 'string') {
      const t = threads[o.thread];
      if (t.text === o.text || (t.editTime && (!o.time || o.time <= t.editTime))) continue;
      put(o.thread, { ...t, text: o.text, editTime: o.time });
    }
  }
  if (!changed) return null;
  return tr.setDocAttribute('comments', threads);
}

export const newReplyId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
