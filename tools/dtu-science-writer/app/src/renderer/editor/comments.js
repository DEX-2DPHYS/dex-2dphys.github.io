/* Comments in the editor: adding a thread to the selection, and highlighting (active / resolved).
   The thread cards in the margin are ui/commentspane.js; the data model is core/comments.js. */
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { newCommentId, threadsOf, anchorsOf, withThread, NODE_ANCHORS } from '../../core/comments.js';

export const commentsKey = new PluginKey('comments');

/** UI state of the comments (not part of the document). */
export const setCommentUi = (view, patch) => view.dispatch(view.state.tr.setMeta(commentsKey, patch));
export const commentUi = (state) => commentsKey.getState(state);

function decorations(state, ui) {
  const threads = threadsOf(state.doc);
  const decos = [];
  state.doc.descendants((node, pos) => {
    if (NODE_ANCHORS.has(node.type.name) && node.attrs.comments && node.attrs.comments.length) {
      const ids = node.attrs.comments;
      const cls = [node.type.name === 'equation' ? 'cmt-eq' : 'cmt-fig'];
      if (ids.includes(ui.active)) cls.push('cmt-active');
      if (ids.every(id => threads[id] && threads[id].resolved)) cls.push('cmt-resolved');
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls.join(' ') }));
      if (node.type.name === 'equation') return false;
    }
    for (const m of node.marks) {
      if (m.type.name !== 'comment') continue;
      const t = threads[m.attrs.id];
      if (m.attrs.id === ui.active) decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'cmt-active' }));
      else if (!t || (t.resolved && !ui.showResolved) || ui.hidden) decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'cmt-quiet' }));
    }
    return true;
  });
  return DecorationSet.create(state.doc, decos);
}

export const commentsPlugin = new Plugin({
  key: commentsKey,
  state: {
    init: () => ({ active: null, editing: null, showResolved: false, hidden: false }),
    apply: (tr, ui) => {
      const patch = tr.getMeta(commentsKey);
      return patch ? { ...ui, ...patch } : ui;
    },
  },
  props: {
    decorations: (state) => decorations(state, commentsKey.getState(state)),
    handleClick: (view, pos) => {
      // clicking commented text makes its thread active (the innermost one when they overlap)
      const $p = view.state.doc.resolve(pos);
      const marks = ($p.nodeAfter && $p.nodeAfter.marks) || $p.marks();
      const m = [...marks].reverse().find(x => x.type.name === 'comment');
      const ui = commentUi(view.state);
      const id = m ? m.attrs.id : null;
      if (id !== ui.active) setCommentUi(view, { active: id });
      return false;
    },
  },
});

/** Add a comment thread to the selection. Returns the new id, or null (nothing selected).
    shared: the document is read-only (someone else edits it): a comment-only step (doc/sharedcomments.js). */
export function addComment(view, user, shared = false) {
  const { state } = view;
  const sel = state.selection;
  const id = newCommentId();
  const thread = { id, author: user.name, initials: user.initials, time: new Date().toISOString(), text: '', resolved: false, replies: [] };
  let tr = state.tr;
  if (sel instanceof NodeSelection && sel.node.type.name === 'equation') {
    tr = tr.setNodeMarkup(sel.from, null, { ...sel.node.attrs, comments: [...(sel.node.attrs.comments || []), id] });
  } else {
    if (sel.empty) return null;
    const mark = state.schema.marks.comment.create({ id });
    let marked = false;
    for (const r of sel.ranges) {
      if (r.$from.pos === r.$to.pos) continue;
      tr = tr.addMark(r.$from.pos, r.$to.pos, mark);
      marked = true;
    }
    if (!marked) return null;
  }
  tr = tr.setDocAttribute('comments', withThread(tr.doc, id, thread));
  tr.setMeta(commentsKey, { active: id, editing: id });
  if (shared) tr.setMeta('commentOnly', true).setMeta('addToHistory', false);
  view.dispatch(tr);
  return id;
}

/** Change one thread (fn gets a copy and returns the new thread, or null to delete it with its anchors). */
export function updateThread(view, id, fn, shared = false) {
  const { state } = view;
  const cur = threadsOf(state.doc)[id];
  if (!cur) return;
  const next = fn(JSON.parse(JSON.stringify(cur)));
  let tr = state.tr;
  if (!next) {
    // delete: remove the anchors as well
    const a = anchorsOf(state.doc).get(id);
    if (a) {
      tr = tr.removeMark(a.from, a.to, state.schema.marks.comment.create({ id }));
      state.doc.nodesBetween(a.from, a.to, (node, pos) => {
        if (NODE_ANCHORS.has(node.type.name) && (node.attrs.comments || []).includes(id)) {
          tr = tr.setNodeMarkup(pos, null, { ...node.attrs, comments: node.attrs.comments.filter(x => x !== id) });
        }
      });
    }
    tr.setMeta(commentsKey, { active: null, editing: null });
  }
  tr = tr.setDocAttribute('comments', withThread(tr.doc, id, next));
  if (shared) tr.setMeta('commentOnly', true).setMeta('addToHistory', false);
  view.dispatch(tr);
}
