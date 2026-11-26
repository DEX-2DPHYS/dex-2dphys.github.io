/* Comment cards in a column beside the page, each level with its anchor (pushed down when cards would overlap).
   New comment: type, Ctrl+Enter or Post. Cards: reply, resolve/reopen, edit (own), delete. */
import { anchoredThreads } from '../../core/comments.js';
import { addComment, updateThread, setCommentUi, commentUi } from '../editor/comments.js';
import { reply, setResolved, saveText } from '../doc/sharedcomments.js';
import { app, api, $, onChange, onLoad, onReadOnly, registerCommands, toast } from '../context.js';
import { ensureUserName } from './settings.js';
import { changesOf, describeChange } from '../../core/track.js';
import { resolve, selectChange } from '../editor/track.js';

const COLORS = ['#1f4e79', '#990000', '#2f6b3a', '#7a4a00', '#5b2a86', '#0f6e72', '#7a1f5c'];
const colorOf = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const isMine = (who) => app.settings && who && (who === app.settings.name);

function header(who, initials, time) {
  const h = el('div', 'cmt-head');
  const badge = el('span', 'cmt-badge', initials || (who || '?').slice(0, 2).toUpperCase());
  badge.style.background = colorOf(who);
  h.append(badge, el('b', null, who || 'Unknown'), el('span', 'cmt-time', ago(time)));
  return h;
}

/** Text box with Post / Cancel. onPost(text), onCancel(). */
/* takeFocus false (the Reply box of the active card): it must not pull the keyboard away from the text while the
   author is typing there — the pane is redrawn at every keystroke. */
function editor(initial, placeholder, onPost, onCancel, postLabel = 'Post', takeFocus = true) {
  const box = el('div', 'cmt-edit');
  const ta = el('textarea');
  ta.value = initial || ''; ta.placeholder = placeholder; ta.rows = 2;
  const post = el('button', 'primary', postLabel), cancel = el('button', null, 'Cancel');
  const go = () => { const v = ta.value.trim(); if (v) onPost(v); };
  post.onclick = go; cancel.onclick = onCancel;
  ta.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };
  const bar = el('div', 'cmt-buttons'); bar.append(cancel, post);
  box.append(ta, bar);
  setTimeout(() => { if (takeFocus || !(app.view && app.view.hasFocus())) ta.focus(); }, 0);
  return box;
}

function card(view, t, ui) {
  const c = el('div', 'cmt-card' + (t.id === ui.active ? ' active' : '') + (t.resolved ? ' resolved' : ''));
  c.dataset.id = t.id;
  c.addEventListener('mousedown', (e) => {
    if (e.target.closest('textarea, input, button')) return;
    if (commentUi(view.state).active !== t.id) setCommentUi(view, { active: t.id });
  });
  c.append(header(t.author, t.initials, t.time));
  const editingThis = ui.editing === t.id;
  if (editingThis) {
    const isNew = !t.text;
    c.append(editor(t.text, isNew ? 'Write a comment… (Ctrl+Enter to post)' : '', (v) => {
      saveText(view, t.id, v, isNew);
      setCommentUi(view, { editing: null });
    }, () => {
      if (isNew) updateThread(view, t.id, () => null, app.readOnly);   // an unposted comment disappears with its anchor
      else setCommentUi(view, { editing: null });
    }, isNew ? 'Post' : 'Save'));
    return c;
  }
  c.append(el('div', 'cmt-text', t.text));
  for (const r of t.replies || []) {
    const rep = el('div', 'cmt-reply');
    rep.append(header(r.author, r.initials, r.time), el('div', 'cmt-text', r.text));
    c.append(rep);
  }
  if (t.id === ui.active) {
    c.append(editor('', 'Reply…', async (v) => {
      if (await ensureUserName()) reply(view, t.id, v);
    }, () => setCommentUi(view, { active: null }), 'Reply', false));
  }
  const acts = el('div', 'cmt-actions');
  const resolve = el('button', null, t.resolved ? 'Reopen' : '✓ Resolve');
  resolve.onclick = () => setResolved(view, t.id, !t.resolved);
  acts.append(resolve);
  if (isMine(t.author)) {
    const edit = el('button', null, 'Edit');
    edit.onclick = () => setCommentUi(view, { active: t.id, editing: t.id });
    acts.append(edit);
  }
  if (!app.readOnly) {             // deleting is for whoever edits the document
    const del = el('button', 'danger', 'Delete');
    del.title = 'Delete the comment and its replies';
    del.onclick = () => updateThread(view, t.id, () => null);
    acts.append(del);
  }
  c.append(acts);
  return c;
}

/** A tracked change: who, when, what — Accept / Reject. */
function changeCard(view, c) {
  const card = el('div', 'cmt-card chg-card');
  card.dataset.change = c.id;
  card.append(header(c.author, c.initials, c.time || new Date().toISOString()));
  card.append(el('div', 'cmt-text chg-text', describeChange(c)));
  card.addEventListener('mousedown', (e) => { if (!e.target.closest('button')) { e.preventDefault(); selectChange(view, c); view.focus(); } });
  if (!app.readOnly) {
    const acts = el('div', 'cmt-actions chg-actions');
    const no = el('button', 'danger', '✗ Reject'), yes = el('button', 'primary', '✓ Accept');
    no.title = 'Reject this change: the text goes back to what it was';
    yes.title = 'Accept this change';
    no.onclick = () => resolve(view, false, { id: c.id });
    yes.onclick = () => resolve(view, true, { id: c.id });
    acts.append(no, yes);
    card.append(acts);
  }
  return card;
}

let menuSent = '';
let frame = 0;
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }

function render() {
  const view = app.view, pane = $('#cmtpane');
  if (!view || !pane) return;
  const ui = commentUi(view.state);
  const all = anchoredThreads(view.state.doc);
  const shown = all.filter(x => !x.thread.resolved || ui.showResolved || x.thread.id === ui.active);
  const resolvedCount = all.filter(x => x.thread.resolved).length;
  const changes = changesOf(view.state.doc);
  document.body.classList.toggle('with-comments', !ui.hidden && (all.length > 0 || !!ui.editing || changes.length > 0));
  $('#st-comments').textContent = all.length ? (all.length - resolvedCount) + ' open comment' + (all.length - resolvedCount === 1 ? '' : 's') + (resolvedCount ? ', ' + resolvedCount + ' resolved' : '') : '';
  const btn = document.querySelector('[data-cmd="comment"]');
  if (btn) btn.classList.toggle('on', !!ui.active);
  const sig = ui.hidden + '/' + ui.showResolved;
  if (sig !== menuSent) { menuSent = sig; api.viewState({ comments: !ui.hidden, showResolved: !!ui.showResolved }); }
  // hidden: the counts in the status bar say what is there, and bring the margin back when clicked
  for (const id of ['#st-comments', '#st-changes']) { const el = $(id); if (el) { el.classList.toggle('st-link', !!ui.hidden && !!el.textContent); el.title = ui.hidden && el.textContent ? 'Show the comments and changes beside the page' : ''; } }
  if (ui.hidden) { pane.replaceChildren(); return; }

  const head = el('div', 'cmt-pane-head');
  head.append(el('b', null, changes.length ? (all.length ? 'Comments and changes' : 'Changes') : 'Comments'));
  const lab = el('label');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = ui.showResolved;
  cb.onchange = () => setCommentUi(view, { showResolved: cb.checked });
  lab.append(cb, document.createTextNode(' show resolved (' + resolvedCount + ')'));
  head.append(lab);
  // the same as View → Comments
  const hide = el('button', 'cmt-hide', 'Hide ✕');
  hide.title = 'Hide the comments and changes (View → Comments, or click the count at the bottom, shows them again)';
  hide.onclick = () => setCommentUi(view, { hidden: true });
  head.append(hide);
  // comments and tracked changes together, in the order of the text
  const cards = [...shown.map(x => ({ x, node: card(view, x.thread, ui) })), ...changes.map(c => ({ x: c, node: changeCard(view, c) }))].sort((a, b) => a.x.from - b.x.from);
  pane.replaceChildren(head, ...cards.map(c => c.node));

  // place each card level with its anchor; push down to avoid overlaps
  const paneTop = pane.getBoundingClientRect().top;
  let y = head.offsetHeight + 8;
  for (const { x, node } of cards) {
    let top;
    try { top = view.coordsAtPos(Math.min(x.from + 1, view.state.doc.content.size)).top - paneTop; } catch (_) { top = y; }
    top = Math.max(top, y);
    node.style.top = top + 'px';
    y = top + node.offsetHeight + 8;
  }
  pane.style.minHeight = y + 'px';
}

async function newComment() {
  const view = app.view;
  // read-only (someone else edits it): the comment is shared with the editor (doc/sharedcomments.js)
  if (app.readOnly && !app.path) { toast('The document is read-only.'); return; }
  const user = await ensureUserName();
  if (!user) return;
  const id = addComment(view, user, app.readOnly);
  if (!id) toast('Select the text (or click the equation) you want to comment on, then add the comment.');
}

registerCommands({
  comment: newComment,
  toggleComments: () => setCommentUi(app.view, { hidden: !commentUi(app.view.state).hidden }),
  showResolved: () => setCommentUi(app.view, { showResolved: !commentUi(app.view.state).showResolved }),
});

onChange(schedule);
onLoad(schedule);
onReadOnly(schedule);
window.addEventListener('resize', schedule);
// the counts in the status bar show the margin again when it is hidden
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('#st-comments, #st-changes');
  if (el && app.view && commentUi(app.view.state).hidden) setCommentUi(app.view, { hidden: false });
});
