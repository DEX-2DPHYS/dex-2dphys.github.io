/* Comments while someone else edits the document (DESIGN.md §9, shared comments).
   Editable document: comment actions are ordinary undoable steps.
   Read-only document: the action is shown at once (a "commentOnly" step, the only change a read-only view accepts)
   and written next to the document (main/docs.js) for the editor.
   Every 30 s and on open, the actions of all readers are applied (core/commentops.js, idempotent): the editor
   merges them into the document (saved with it, then the files are deleted); a reader sees the others'. */
import { applyCommentOps, describeAnchor, newReplyId } from '../../core/commentops.js';
import { threadsOf } from '../../core/comments.js';
import { updateThread } from '../editor/comments.js';
import { app, api, isDirty, onLoad, onSaved, onChange, onReadOnly, toast } from '../context.js';

export const MERGE_MS = 30 * 1000;
let seen = new Map();          // file -> number of its actions applied to the open document
let merged = [];               // [{file, size}] merged into the editable document, cleared after the next save
let timer = null;
let localShared = false;       // this read-only copy shows comment actions that are not in the file yet

const now = () => new Date().toISOString();
const reading = () => app.readOnly && !!app.path;

/** Apply a step that only touches comments; in a read-only document it is not an unsaved change. */
function dispatchShared(tr) {
  tr.setMeta('commentOnly', true).setMeta('addToHistory', false);
  localShared = true;
  app.view.dispatch(tr);
}
onChange((tr, ns) => { if (app.readOnly && tr.getMeta('commentOnly')) app.savedDoc = ns.doc; });

async function record(op) {
  const r = await api.sharedComments('append', app.path, op);
  if (r && r.error) toast('Could not store your comment next to the document: ' + r.error, 'error');
}

/* ---------- the actions (comment pane) ---------- */
export function reply(view, id, text) {
  const u = app.settings;
  const rep = { id: newReplyId(), author: u.name, initials: u.initials, time: now(), text };
  if (!reading()) return updateThread(view, id, (x) => ({ ...x, replies: [...(x.replies || []), rep] }));
  const op = { op: 'reply', thread: id, reply: rep };
  const tr = applyCommentOps(view.state, [op]);
  if (tr) dispatchShared(tr);
  record(op);
}

export function setResolved(view, id, resolved) {
  const time = now();
  if (!reading()) return updateThread(view, id, (x) => ({ ...x, resolved, statusTime: time }));
  const op = { op: 'resolve', thread: id, resolved, time };
  const tr = applyCommentOps(view.state, [op]);
  if (tr) dispatchShared(tr);
  record(op);
}

/** Save the text of a comment: a new one is posted, an existing one (own) edited. */
export function saveText(view, id, text, isNew) {
  const time = now();
  if (!reading()) return updateThread(view, id, (x) => ({ ...x, text, ...(isNew ? {} : { editTime: time }) }));
  updateThread(view, id, (x) => ({ ...x, text, ...(isNew ? {} : { editTime: time }) }), true);
  if (isNew) {
    const thread = threadsOf(view.state.doc)[id];
    const anchor = describeAnchor(view.state.doc, id);
    if (thread && anchor) record({ op: 'new', thread, anchor });
  } else record({ op: 'edit', thread: id, text, time });
}

/* ---------- merging ---------- */

/** Read every reader's actions and apply the new ones. Returns how many actions changed the document. */
export async function mergeNow() {
  if (!app.view || !app.path) return 0;
  const files = await api.sharedComments('list', app.path);
  if (!app.view || !files) return 0;
  const fresh = [], authors = new Set();
  for (const f of files) {
    const from = seen.get(f.file) || 0;
    for (const op of f.ops.slice(from)) {
      fresh.push(op);
      const who = op.reply ? op.reply.author : op.thread && op.thread.author;
      if (who && who !== app.settings.name) authors.add(who);
    }
    seen.set(f.file, f.ops.length);
  }
  if (!app.readOnly) merged = files.map(f => ({ file: f.file, size: f.size }));
  const tr = fresh.length ? applyCommentOps(app.view.state, fresh) : null;
  if (tr) {
    if (app.readOnly) dispatchShared(tr);
    else app.view.dispatch(tr.setMeta('addToHistory', false));     // others' comments: not undone with your typing
    if (authors.size) toast('New comments from ' + [...authors].join(', ') + '.');
  }
  // editor, nothing new and nothing unsaved: the file on disk already holds everything in them
  if (!app.readOnly && !tr && merged.length && !isDirty()) clearMerged();
  return tr ? fresh.length : 0;
}

function clearMerged() {
  if (!merged.length || !app.path) return;
  api.sharedComments('clear', app.path, merged);
  merged = [];
}

function restart() {
  clearInterval(timer);
  timer = app.path ? setInterval(() => { mergeNow().catch(e => console.error('shared comments', e)); }, MERGE_MS) : null;
}

onLoad(() => { seen = new Map(); merged = []; localShared = false; restart(); if (app.path) mergeNow().catch(e => console.error('shared comments', e)); });
onReadOnly(() => {
  // became editable with comment actions that are only in this copy: they are unsaved changes now
  // (otherwise the merge below would find nothing new and delete the files that hold them)
  if (!app.readOnly && localShared) { app.savedDoc = null; api.setDirty(true); localShared = false; }
  seen = new Map(); restart();
  if (app.path) mergeNow().catch(() => {});
});
onSaved(() => { if (!app.readOnly) clearMerged(); });
