/* Figure viewer: double-click a figure to see it nearly full screen and mark it up.
   Tools: Select (click a mark to select it — Delete removes it; click a typed text to edit it; click a comment box to
   read it), Comment (drag a box, type the comment — a real comment thread on the figure, shown in the comment column
   and exported to Word), Type (text on the figure, Arial, size slider), Pen, Marker; colours; Undo; Remove
   annotations; Close. Every change is a document step (undoable, saved in the file); the data model is
   core/annotations.js. The marks are review marks: not printed in the PDF. */
import { annotationsOf, annotationsSvg, simplify, newAnnotationId, commentNumbers, textSize, PEN_COLORS, MARKER_COLORS, TEXT_SIZE, TEXT_SIZE_MIN, TEXT_SIZE_MAX, ANN_FONT } from '../../core/annotations.js';
import { threadsOf, newCommentId, withThread } from '../../core/comments.js';
import { mediaUrl } from '../../core/media.js';
import { numberingKey } from '../editor/plugins.js';
import { cmd } from '../editor/editor.js';
import { app, onChange, registerCommands, toast } from '../context.js';
import { ensureUserName } from './settings.js';

const TOOLS = [
  ['look', '⬉ Select', 'Select: click a mark to select it (Delete removes it), click a typed text to edit it, click a comment box to read it (V)', 'v'],
  ['comment', '▭ Comment', 'Comment box: drag a box around what the comment is about, then type it (C)', 'c'],
  ['text', 'T Type', 'Type text on the figure: click where it should go, or click a text to edit it (T)', 't'],
  ['pen', '✎ Pen', 'Pen: draw (P)', 'p'],
  ['marker', '▮ Marker', 'Marker: highlight (M)', 'm'],
];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = () => new Date().toISOString();
const r4 = (v) => Math.round(v * 10000) / 10000;

let S = null;        // the open viewer: { view, figId, tool, colors, size, selected, editing, el: {...} }

/* ---------- document access ---------- */
function findFigure(state, id) {
  let out = null;
  state.doc.descendants((n, pos) => { if (out) return false; if (n.type.name === 'figure' && n.attrs.id === id) { out = { pos, node: n }; return false; } return true; });
  return out;
}
function figureAtSelection(state) {
  const sel = state.selection;
  if (sel.node && sel.node.type.name === 'figure') return { pos: sel.from, node: sel.node };
  const $p = sel.$from;
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'figure') return { pos: $p.before(d), node: $p.node(d) };
  if (sel.node && sel.node.type.name === 'image' && $p.parent.type.name === 'figure') return { pos: $p.before($p.depth), node: $p.parent };
  return null;
}
const aspectOf = (fig) => { const img = fig.node.firstChild; return img && img.attrs.w && img.attrs.h ? img.attrs.h / img.attrs.w : 0.75; };
const me = () => ({ author: (app.settings && app.settings.name) || '', initials: (app.settings && app.settings.initials) || '', time: now() });
const currentList = () => { const f = S && findFigure(S.view.state, S.figId); return f ? annotationsOf(f.node) : []; };
const byId = (id) => currentList().find(a => a.id === id);

/** Change the figure's annotations (and optionally its comments / the document's threads) in one undo step. */
function changeFigure(fn) {
  const { view, figId } = S;
  const f = findFigure(view.state, figId);
  if (!f) return;
  const r = fn(f.node);
  let tr = view.state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, ...r.attrs });
  if (r.threads) tr = tr.setDocAttribute('comments', r.threads);
  view.dispatch(tr);
}
const addAnnotation = (a) => changeFigure((node) => ({ attrs: { annotations: [...annotationsOf(node), a] } }));
const replaceAnnotation = (id, fn) => changeFigure((node) => ({ attrs: { annotations: annotationsOf(node).map(a => (a.id === id ? fn(a) : a)) } }));

/** Remove marks by id; comment boxes take their threads with them. */
function removeAnnotations(ids) {
  const set = new Set(ids);
  changeFigure((node) => {
    const list = annotationsOf(node);
    const gone = new Set(list.filter(a => set.has(a.id) && a.kind === 'comment').map(a => a.thread));
    let threads = threadsOf(S.view.state.doc);
    for (const t of gone) threads = withThread({ attrs: { comments: threads } }, t, null);
    return { attrs: { annotations: list.filter(a => !set.has(a.id)), comments: (node.attrs.comments || []).filter(t => !gone.has(t)) }, threads: gone.size ? threads : null };
  });
}

/* ---------- open / close ---------- */
export function openFigureViewer(view) {
  const f = figureAtSelection(view.state);
  if (!f) { toast('Click a figure first (or double-click it).'); return; }
  if (!f.node.attrs.id) return;
  closeFigureViewer();
  const el = document.createElement('div');
  el.id = 'figview';
  el.innerHTML = '<div class="fv-bar"><span class="fv-title"></span><div class="fv-tools">'
    + TOOLS.map(([k, label, title]) => '<button data-tool="' + k + '" title="' + esc(title) + '">' + label + '</button>').join('')
    + '<span class="fv-colors"></span>'
    + '<label class="fv-size" title="Text size"><span>Size</span><input type="range" min="' + TEXT_SIZE_MIN + '" max="' + TEXT_SIZE_MAX + '" step="0.002"></label>'
    + '<button data-act="delete" title="Delete the selected mark (Delete)">🗑 Delete</button>'
    + '<button data-act="undo" title="Undo (Ctrl+Z)">↶ Undo</button></div><span class="grow"></span>'
    + '<button data-act="clear" class="quiet-danger" title="Remove every mark and comment box on this figure (Ctrl+Z brings them back)">Remove annotations</button>'
    + '<button data-act="close" class="primary" title="Close (Esc)">Close</button></div>'
    + '<div class="fv-main"><div class="fv-stage"><img alt=""><div class="fv-ann"></div><svg class="fv-live" preserveAspectRatio="none"></svg><div class="fv-input"></div></div>'
    + '<aside class="fv-notes"></aside></div><div class="fv-hint"></div>';
  document.body.appendChild(el);
  S = { view, figId: f.node.attrs.id, tool: 'look', colors: { pen: PEN_COLORS[0], text: PEN_COLORS[0], marker: MARKER_COLORS[0] }, size: TEXT_SIZE, selected: null, editing: null,
    el: { root: el, title: el.querySelector('.fv-title'), stage: el.querySelector('.fv-stage'), img: el.querySelector('.fv-stage img'),
      ann: el.querySelector('.fv-ann'), live: el.querySelector('.fv-live'), input: el.querySelector('.fv-input'), size: el.querySelector('.fv-size'),
      notes: el.querySelector('.fv-notes'), colors: el.querySelector('.fv-colors'), hint: el.querySelector('.fv-hint'), main: el.querySelector('.fv-main') } };
  S.el.img.src = mediaUrl(f.node.firstChild.attrs.src);
  S.el.img.onload = layout;
  wire();
  render();
  layout();
  el.focus();
}

export function closeFigureViewer() {
  if (!S) return;
  const v = S.view;
  commitOpenText();
  window.removeEventListener('resize', layout);
  S.el.root.remove();
  S = null;
  v.focus();
}
export const figureViewerOpen = () => !!S;

/* ---------- layout and drawing ---------- */
function layout() {
  if (!S) return;
  const f = findFigure(S.view.state, S.figId);
  if (!f) return;
  const aspect = aspectOf(f);
  const box = S.el.main.getBoundingClientRect();
  const notesW = S.el.notes.offsetWidth ? S.el.notes.offsetWidth + 16 : 0;
  const availW = Math.max(200, box.width - notesW - 32), availH = Math.max(150, box.height - 24);
  const w = Math.min(availW, availH / aspect);
  S.el.stage.style.width = Math.round(w) + 'px';
  S.el.stage.style.height = Math.round(w * aspect) + 'px';
  S.el.live.setAttribute('viewBox', '0 0 1000 ' + Math.round(1000 * aspect));
}

function render() {
  if (!S) return;
  const { view } = S;
  const f = findFigure(view.state, S.figId);
  if (!f) { closeFigureViewer(); return; }
  const list = annotationsOf(f.node), threads = threadsOf(view.state.doc);
  if (S.selected && !list.some(a => a.id === S.selected)) S.selected = null;
  const info = numberingKey.getState(view.state).nums.byId.get(S.figId);
  const cap = f.node.lastChild.textContent;
  S.el.title.textContent = 'Fig. ' + ((info && info.num) || '?') + (cap ? ' — ' + (cap.length > 70 ? cap.slice(0, 70) + '…' : cap) : '');
  // the text being edited is hidden in the drawing (its text box stands in its place)
  const shown = S.editing ? list.filter(a => a.id !== S.editing) : list;
  S.el.ann.innerHTML = annotationsSvg(shown, aspectOf(f), { threads, active: S.selected, hit: true });
  // tools
  const ro = app.readOnly;
  S.el.root.querySelectorAll('[data-tool]').forEach(b => { b.classList.toggle('on', b.dataset.tool === S.tool); b.disabled = ro && b.dataset.tool !== 'look'; });
  S.el.root.querySelector('[data-act="clear"]').disabled = ro || !list.length;
  S.el.root.querySelector('[data-act="undo"]').disabled = ro;
  S.el.root.querySelector('[data-act="delete"]').disabled = ro || !S.selected;
  S.el.stage.dataset.tool = S.tool;
  const sel = S.selected ? list.find(a => a.id === S.selected) : null;
  // colours: the tool's, or the selected mark's (a click recolours it)
  const ckey = sel && sel.kind !== 'comment' ? (sel.kind === 'marker' ? 'marker' : sel.kind) : (S.tool === 'marker' ? 'marker' : S.tool === 'pen' || S.tool === 'text' ? S.tool : null);
  const cur = sel && sel.kind !== 'comment' ? sel.color : ckey && S.colors[ckey];
  S.el.colors.innerHTML = ckey ? (ckey === 'marker' ? MARKER_COLORS : PEN_COLORS).map(c => '<button class="sw' + (c === cur ? ' on' : '') + '" data-color="' + c + '" style="background:' + c + '" title="Colour"></button>').join('') : '';
  // size: for the Type tool, or the selected text
  const showSize = S.tool === 'text' || (sel && sel.kind === 'text') || !!S.editing;
  S.el.size.hidden = !showSize;
  if (showSize) S.el.size.querySelector('input').value = String(sel && sel.kind === 'text' ? textSize(sel) : S.size);
  // comment list
  const nums = commentNumbers(list);
  const boxes = list.filter(a => a.kind === 'comment' && threads[a.thread]).sort((a, b) => nums.get(a.id) - nums.get(b.id));
  S.el.notes.innerHTML = boxes.length ? '<h4>Comments on this figure</h4>' + boxes.map((a) => {
    const t = threads[a.thread];
    return '<div class="fv-note' + (a.id === S.selected ? ' active' : '') + (t.resolved ? ' resolved' : '') + '" data-id="' + esc(a.id) + '"><b>' + nums.get(a.id) + '</b> <span class="who">' + esc(t.author || '') + '</span>'
      + '<div class="txt">' + esc(t.text) + '</div>' + ((t.replies || []).length ? '<div class="rep">' + t.replies.length + ' repl' + (t.replies.length > 1 ? 'ies' : 'y') + '</div>' : '') + (t.resolved ? '<div class="rep">resolved</div>' : '') + '</div>';
  }).join('') + '<p class="fv-small">Reply and resolve in the comment column after closing.</p>' : '';
  S.el.notes.hidden = !boxes.length;
  S.el.hint.textContent = ro ? 'Read-only: someone else is editing this document. You can look, not annotate.'
    : sel ? (sel.kind === 'text' ? 'Selected text: click it again to edit, Delete to remove; the size slider and colours change it.' : 'Selected: Delete removes it; a colour recolours it.')
      : { look: 'Click a mark to select it, a typed text to edit it. Marks are review marks: saved with the document, not printed.', comment: 'Drag a box around what your comment is about.', text: 'Click where the text should go, or click a text to edit it. Enter to finish, Shift+Enter for a new line.', pen: 'Draw with the mouse or a pen.', marker: 'Highlight with the mouse or a pen.' }[S.tool];
  layout();
}

/* ---------- interaction ---------- */
function norm(e) {
  const r = S.el.stage.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
}
function setTool(t) { if (!S || (app.readOnly && t !== 'look')) return; commitOpenText(); S.tool = t; S.selected = null; render(); }
const markAt = (e) => { const m = e.target.closest && e.target.closest('.fv-ann [data-id]'); return m ? byId(m.dataset.id) : null; };

function wire() {
  const { root, stage, live } = S.el;
  root.tabIndex = -1;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.tool) return setTool(b.dataset.tool);
    if (b && b.dataset.color) return pickColor(b.dataset.color);
    if (b && b.dataset.act === 'close') return closeFigureViewer();
    if (b && b.dataset.act === 'undo') return cmd.undo(S.view.state, S.view.dispatch);
    if (b && b.dataset.act === 'delete') return deleteSelected();
    if (b && b.dataset.act === 'clear') return clearAll();
    const note = e.target.closest('.fv-note');
    if (note) { S.selected = note.dataset.id === S.selected ? null : note.dataset.id; render(); }
  });
  S.el.size.querySelector('input').addEventListener('input', (e) => setSize(+e.target.value));
  // after the slider: back to the text being typed, if any
  S.el.size.querySelector('input').addEventListener('change', () => { const ta = S.el.input.querySelector('textarea.fv-text'); if (ta) ta.focus(); });
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('.fv-input')) return;            // typing text or a comment
    if (e.target.tagName === 'INPUT') return;               // the size slider
    if (e.key === 'Escape') { e.preventDefault(); if (S.selected) { S.selected = null; render(); } else closeFigureViewer(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) { e.preventDefault(); deleteSelected(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cmd.undo(S.view.state, S.view.dispatch); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); cmd.redo(S.view.state, S.view.dispatch); return; }
    const t = !e.ctrlKey && !e.altKey && !e.metaKey && TOOLS.find(x => x[3] === e.key.toLowerCase());
    if (t) { e.preventDefault(); setTool(t[0]); }
  }, true);
  window.addEventListener('resize', layout);

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !S || e.target.closest('.fv-input')) return;
    const p = norm(e);
    const hit = markAt(e);
    if (S.tool === 'look' || (S.tool === 'text' && hit && hit.kind === 'text')) {
      e.preventDefault();
      if (hit && hit.kind === 'text' && !app.readOnly && (S.tool === 'text' || S.selected === hit.id)) { openTextInput([hit.x, hit.y], hit); return; }
      S.selected = hit ? hit.id : null; render();
      return;
    }
    if (app.readOnly) return;
    e.preventDefault();
    if (S.tool === 'text') { openTextInput(p, null); return; }
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}    // not every pointer can be captured (some pens, synthetic events)
    drag = { start: p, pts: [p] };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = norm(e);
    const H = Math.round(1000 * (stage.offsetHeight / stage.offsetWidth));
    if (S.tool === 'comment') {
      const [x0, y0] = drag.start;
      live.innerHTML = '<rect x="' + Math.min(x0, p[0]) * 1000 + '" y="' + Math.min(y0, p[1]) * H + '" width="' + Math.abs(p[0] - x0) * 1000 + '" height="' + Math.abs(p[1] - y0) * H + '" fill="none" stroke="#e0a100" stroke-width="3" stroke-dasharray="10 6"/>';
      drag.end = p;
    } else {
      drag.pts.push(p);
      const marker = S.tool === 'marker';
      live.innerHTML = '<path d="' + drag.pts.map(([x, y], i) => (i ? 'L' : 'M') + (x * 1000).toFixed(1) + ' ' + (y * H).toFixed(1)).join(' ') + '" fill="none" stroke="' + S.colors[marker ? 'marker' : 'pen'] + '" stroke-width="' + (marker ? 22 : 4) + '" stroke-linecap="round" stroke-linejoin="round"' + (marker ? ' stroke-opacity="0.42"' : '') + '/>';
    }
  });
  const finish = () => {
    if (!drag) return;
    const d = drag; drag = null;
    live.innerHTML = '';
    if (S.tool === 'pen' || S.tool === 'marker') {
      addAnnotation({ id: newAnnotationId(), kind: S.tool, color: S.colors[S.tool], pts: simplify(d.pts), ...me() });
    } else if (S.tool === 'comment') {
      let [x0, y0] = d.start, [x1, y1] = d.end || d.start;
      if (Math.abs(x1 - x0) < 0.02 || Math.abs(y1 - y0) < 0.02) { x0 -= 0.08; x1 = x0 + 0.16; y0 -= 0.05; y1 = y0 + 0.1; }   // a click: a default box
      const r = { x: Math.max(0, Math.min(x0, x1)), y: Math.max(0, Math.min(y0, y1)) };
      r.w = Math.min(1 - r.x, Math.abs(x1 - x0)); r.h = Math.min(1 - r.y, Math.abs(y1 - y0));
      openCommentInput(r);
    }
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
}

function pickColor(c) {
  const sel = S.selected && byId(S.selected);
  if (sel && sel.kind !== 'comment') { replaceAnnotation(sel.id, (a) => ({ ...a, color: c })); return; }
  const k = S.tool === 'marker' ? 'marker' : S.tool;
  S.colors[k] = c;
  const ta = S.el.input.querySelector('textarea.fv-text');
  if (ta) { ta.style.color = c; ta.focus(); }
  render();
}

function setSize(v) {
  const size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, v));
  const ta = S.el.input.querySelector('textarea.fv-text');
  if (ta) { S.size = size; ta.style.fontSize = (size * S.el.stage.offsetWidth).toFixed(1) + 'px'; return; }
  const sel = S.selected && byId(S.selected);
  if (sel && sel.kind === 'text') { replaceAnnotation(sel.id, (a) => ({ ...a, size: r4(size) })); return; }
  S.size = size;
}

function deleteSelected() {
  if (!S.selected || app.readOnly) return;
  removeAnnotations([S.selected]);
  S.selected = null;
  render();
}

function closeInput() { if (S) { S.el.input.innerHTML = ''; S.editing = null; } }
let commitOpenText = () => {};

/** Typed text (new, or an existing one being edited): a text box in Arial at the place; Enter commits, Shift+Enter breaks
    the line, Esc cancels; an emptied text is removed. */
function openTextInput([x, y], existing) {
  commitOpenText();
  const stage = S.el.stage, box = S.el.input;
  const size = existing ? textSize(existing) : S.size;
  if (existing) { S.size = size; S.colors.text = existing.color || S.colors.text; S.editing = existing.id; S.selected = null; }
  const color = S.colors.text;
  const px = size * stage.offsetWidth;
  box.innerHTML = '<textarea class="fv-text" rows="1" placeholder="Type…" style="left:' + x * 100 + '%;top:calc(' + y * 100 + '% - ' + (px * 0.95).toFixed(0) + 'px);font-size:' + px.toFixed(1) + 'px;color:' + color + ';font-family:' + ANN_FONT + '"></textarea>';
  const ta = box.querySelector('textarea');
  if (existing) { ta.value = existing.text; ta.rows = Math.max(1, existing.text.split('\n').length); }
  let done = false;
  const commit = (keep) => {
    if (done) return; done = true;
    commitOpenText = () => {};
    const text = ta.value.replace(/\s+$/, '');
    const col = S.colors.text, sz = r4(S.size);
    closeInput();
    if (existing) {
      if (!keep) { render(); return; }
      if (!text) { removeAnnotations([existing.id]); return; }
      replaceAnnotation(existing.id, (a) => ({ ...a, text, size: sz, color: col }));
    } else if (keep && text) {
      addAnnotation({ id: newAnnotationId(), kind: 'text', color: col, x: r4(x), y: r4(y), text, size: sz, ...me() });
    }
    render();
  };
  commitOpenText = () => commit(true);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  ta.addEventListener('input', () => { ta.rows = Math.max(1, ta.value.split('\n').length); });
  ta.addEventListener('blur', (e) => { if (!e.relatedTarget || !S.el.root.contains(e.relatedTarget) || !e.relatedTarget.closest('.fv-tools')) commit(true); });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  render();
}

/** Comment box: the rectangle is drawn; the comment is typed next to it and becomes a thread on the figure. */
function openCommentInput(r) {
  const box = S.el.input;
  const left = Math.min(r.x + r.w, 0.7) * 100, top = Math.min(r.y, 0.75) * 100;
  box.innerHTML = '<div class="fv-cmt" style="left:' + left + '%;top:' + top + '%"><textarea rows="3" placeholder="Comment… (Ctrl+Enter to post)"></textarea>'
    + '<div class="row"><button data-c="cancel">Cancel</button><button data-c="post" class="primary">Post</button></div></div>';
  const H = Math.round(1000 * (S.el.stage.offsetHeight / S.el.stage.offsetWidth));
  S.el.live.innerHTML = '<rect x="' + r.x * 1000 + '" y="' + r.y * H + '" width="' + r.w * 1000 + '" height="' + r.h * H + '" fill="rgba(255,200,0,0.08)" stroke="#e0a100" stroke-width="3" stroke-dasharray="10 6"/>';
  const ta = box.querySelector('textarea');
  const cancel = () => { closeInput(); S.el.live.innerHTML = ''; };
  const post = async () => {
    const text = ta.value.trim();
    if (!text) return;
    const user = await ensureUserName();
    if (!user || !S) return;
    cancel();
    const id = newCommentId(), time = now();
    const thread = { id, author: user.name, initials: user.initials, time, text, resolved: false, replies: [] };
    const ann = { id: newAnnotationId(), kind: 'comment', x: r4(r.x), y: r4(r.y), w: r4(r.w), h: r4(r.h), thread: id, author: user.name, initials: user.initials, time };
    changeFigure((node) => ({ attrs: { annotations: [...annotationsOf(node), ann], comments: [...(node.attrs.comments || []), id] }, threads: withThread(S.view.state.doc, id, thread) }));
    S.selected = ann.id; render();
  };
  box.querySelector('[data-c="cancel"]').onclick = cancel;
  box.querySelector('[data-c="post"]').onclick = post;
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); }
  });
  setTimeout(() => ta.focus(), 0);
}

/** Remove every mark and comment box on the figure (and the comment threads of the boxes) — one undo step. */
function clearAll() {
  const list = currentList();
  if (!list.length) return;
  removeAnnotations(list.map(a => a.id));
  S.selected = null;
  toast('Removed ' + list.length + ' annotation' + (list.length > 1 ? 's' : '') + ' — Ctrl+Z brings them back.');
}

onChange(() => { if (S) render(); });

registerCommands({ figureView: () => openFigureViewer(app.view) });
