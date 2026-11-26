/* Comment threads. Stored in the document (doc attr `comments`), so they are saved in the file and undoable:
     { [id]: { id, author, initials, time, text, resolved, replies: [{ author, initials, time, text }] } }
   Anchors: the `comment` mark (text, inline math, references; may overlap) and `attrs.comments` of a node
   commented as a whole (NODE_ANCHORS: a display equation, a figure — the comment boxes drawn on it). A thread whose anchor was deleted stays in the document (undo can bring the
   text back) but is not shown or exported. */

export const NODE_ANCHORS = new Set(['equation', 'figure']);

export const newCommentId = () => 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const threadsOf = (doc) => (doc.attrs && doc.attrs.comments) || {};

/** Anchors in document order: Map id -> { from, to, segments } (from/to: first and last position). */
export function anchorsOf(doc) {
  const out = new Map();
  const add = (id, from, to) => {
    const a = out.get(id);
    if (a) { a.to = Math.max(a.to, to); a.segments++; } else out.set(id, { from, to, segments: 1 });
  };
  doc.descendants((node, pos) => {
    if (NODE_ANCHORS.has(node.type.name)) {
      for (const id of node.attrs.comments || []) add(id, pos, pos + node.nodeSize);
      if (node.type.name === 'equation') return false;          // a figure's caption can hold comments of its own
    }
    for (const m of node.marks) if (m.type.name === 'comment') add(m.attrs.id, pos, pos + node.nodeSize);
    return true;
  });
  return out;
}

/** Threads that have an anchor, in document order: [{ thread, from, to }]. */
export function anchoredThreads(doc) {
  const threads = threadsOf(doc);
  return [...anchorsOf(doc).entries()].filter(([id]) => threads[id]).map(([id, a]) => ({ thread: threads[id], ...a }));
}

/** New threads object with one thread replaced (or removed when `thread` is null). */
export function withThread(doc, id, thread) {
  const next = { ...threadsOf(doc) };
  if (thread) next[id] = thread; else delete next[id];
  return next;
}
