/* Track changes in the editor (the rules are in core/track.js):
   - trackDispatch(): the one place every edit passes (editor.js dispatchTransaction) — with tracking on, the edit is
     turned into a suggestion;
   - a plugin that draws the flags on blocks (a new / removed paragraph boundary, an inserted / deleted / changed
     figure, table or equation) and remembers whether Delete was pressed (the cursor then goes behind the deletion);
   - commands: switch tracking, accept / reject one change, those at the cursor, or all; go to the next / previous. */
import { Plugin, PluginKey, TextSelection, NodeSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { trackTransaction, resolveChanges, changesOf, isTracking, colorFor, TRACK_UNITS } from '../../core/track.js';

export const trackKey = new PluginKey('track');
let lastKey = { key: '', at: 0 };
const forwardDelete = () => lastKey.key === 'Delete' && Date.now() - lastKey.at < 400;

/** The transaction to apply: tracked when tracking is on and it is an edit by the user. */
export function trackDispatch(tr, state, user) {
  if (!tr.docChanged || !isTracking(state.doc)) return tr;
  // not edits to review: undo / redo, accepting and rejecting, shared comments, programmatic repairs
  if (tr.getMeta('untracked') || tr.getMeta('history$') || tr.getMeta('commentOnly') || tr.getMeta('addToHistory') === false) return tr;
  const who = { name: (user && user.name) || 'Author', initials: (user && user.initials) || '' };
  return trackTransaction(tr, state, who, { forward: forwardDelete() });
}

function decorations(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    const t = node.attrs && node.attrs.track;
    if (!t) return true;
    const unit = TRACK_UNITS.has(node.type.name);
    const what = unit
      ? (t.kind === 'ins' ? 'Inserted by ' : t.kind === 'del' ? 'Deleted by ' : 'Changed by ')
      : (t.kind === 'ins' ? 'New paragraph by ' : 'Paragraphs joined by ');
    decos.push(Decoration.node(pos, pos + node.nodeSize, {
      class: 'tc-blk tc-blk-' + t.kind + (unit ? ' tc-unit' : ' tc-para'), 'data-tc': t.id, 'data-tc-who': what + (t.author || 'unknown'), style: '--tc:' + colorFor(t.author),
    }));
    return true;
  });
  return DecorationSet.create(doc, decos);
}

export const trackPlugin = new Plugin({
  key: trackKey,
  state: {
    init: (_c, state) => decorations(state.doc),
    apply: (tr, old, _o, state) => (tr.docChanged ? decorations(state.doc) : old),
  },
  props: {
    decorations(state) { return trackKey.getState(state); },
    handleKeyDown(_view, e) { lastKey = { key: e.key, at: Date.now() }; return false; },
  },
});

/* ---------- commands ---------- */
const untracked = (tr) => tr.setMeta('untracked', true);

/** Switch track changes on or off (saved in the document, so co-authors open it the same way). */
export function setTracking(view, on) {
  view.dispatch(untracked(view.state.tr.setDocAttribute('tracking', !!on)));
}

/** Accept or reject: opts.id — one change; opts.atCursor — the changes at the selection; neither — all of them.
    Returns how many changes were resolved. */
export function resolve(view, accept, opts = {}) {
  const state = view.state;
  let list = changesOf(state.doc);
  if (opts.id) list = list.filter(c => c.id === opts.id);
  else if (opts.atCursor) {
    const { from, to } = state.selection;
    list = list.filter(c => (from === to ? c.from <= from && c.to >= from : c.to > from && c.from < to));
  }
  if (!list.length) return 0;
  const ids = new Set(list.map(c => c.id));
  const tr = resolveChanges(state.tr, { accept, pick: (id) => ids.has(id) });
  if (!tr.docChanged) return 0;
  view.dispatch(untracked(tr).scrollIntoView());
  return list.length;
}

/** Put the cursor on the next (dir 1) or previous (dir -1) change; returns the change or null. */
export function gotoChange(view, dir = 1) {
  const list = changesOf(view.state.doc);
  if (!list.length) return null;
  const at = view.state.selection.from;
  const c = dir > 0 ? (list.find(x => x.from > at) || list[0]) : ([...list].reverse().find(x => x.to < at) || list[list.length - 1]);
  selectChange(view, c);
  return c;
}

/** Select what a change covers (a unit as a whole, text as a text selection). */
export function selectChange(view, c) {
  const doc = view.state.doc;
  let sel = null;
  try {
    const unit = c.blocks.find(b => b.unit);
    if (unit && !c.ins && !c.del) sel = NodeSelection.create(doc, unit.pos);
    else sel = TextSelection.between(doc.resolve(Math.min(c.from + 1, doc.content.size)), doc.resolve(Math.min(c.from + 1, doc.content.size)));
  } catch (_) { sel = null; }
  if (sel) view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
}
