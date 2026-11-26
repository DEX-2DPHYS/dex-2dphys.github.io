/* Figures: insert from file/paste/drop, and the placement bar shown while a figure is selected. */
import { NodeSelection, TextSelection, Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { ctxHost, refreshHint } from '../ui/ctxbar.js';
import { addImage, imageSize, isSupportedImage, mediaUrl } from '../../core/media.js';
import { blockInsertPos } from './mathview.js';
import { annotationsOf, annotationsSvg } from '../../core/annotations.js';
import { threadsOf } from '../../core/comments.js';
import { runCommand } from '../context.js';

/** Insert a figure for image bytes at the cursor; cursor goes into the caption. */
export async function insertFigure(view, fileName, bytes, attrs = {}) {
  const src = addImage(fileName, bytes);
  const { w, h } = await imageSize(src);
  const { schema } = view.state;
  const fig = schema.nodes.figure.create({ placement: 'float', pos: 'top', width: 0.8, ...attrs }, [
    schema.nodes.image.create({ src, w, h }),
    schema.nodes.caption.create(),
  ]);
  let tr = view.state.tr;
  const at = blockInsertPos(view.state, (p) => { tr = tr.split(p); });
  tr = tr.insert(at, fig);
  const capStart = at + 1 + fig.firstChild.nodeSize + 1;
  tr.setSelection(TextSelection.create(tr.doc, capStart));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Position of the figure containing the selection, or null. */
export function selectedFigure(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'figure') return { pos: sel.from, node: sel.node };
  const $f = sel.$from;
  for (let d = $f.depth; d > 0; d--) {
    if ($f.node(d).type.name === 'figure') return { pos: $f.before(d), node: $f.node(d) };
  }
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
    const $p = state.doc.resolve(sel.from);
    if ($p.parent.type.name === 'figure') return { pos: $p.before($p.depth), node: $p.parent };
  }
  return null;
}

export function setFigureAttrs(view, attrs) {
  const f = selectedFigure(view.state);
  if (!f) return false;
  const tr = view.state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, ...attrs });
  view.dispatch(tr);
  return true;
}

const MODES = [
  { key: 'float-top', label: 'Top of page', attrs: { placement: 'float', pos: 'top' }, tip: 'Float: fixed to the top of a page, caption underneath' },
  { key: 'float-bottom', label: 'Bottom of page', attrs: { placement: 'float', pos: 'bottom' }, tip: 'Float: fixed to the bottom of a page' },
  { key: 'here', label: 'Here', attrs: { placement: 'here' }, tip: 'Centred here, text above and below' },
  { key: 'wrap-left', label: 'Wrap left', attrs: { placement: 'wrap', side: 'left', width: 0.4 }, tip: 'On the left, text flows past on the right' },
  { key: 'wrap-right', label: 'Wrap right', attrs: { placement: 'wrap', side: 'right', width: 0.4 }, tip: 'On the right, text flows past on the left' },
];
const modeOf = (a) => (a.placement === 'float' ? 'float-' + (a.pos === 'bottom' ? 'bottom' : 'top') : a.placement === 'wrap' ? 'wrap-' + (a.side === 'left' ? 'left' : 'right') : 'here');

/** Floating bar above the selected figure: placement + width. */
export function figureBarPlugin() {
  return new Plugin({
    view(editorView) {
      const bar = document.createElement('div');
      bar.className = 'figbar';
      bar.style.display = 'none';
      bar.classList.add('ctx-panel');
      bar.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
      const modes = document.createElement('div');
      modes.className = 'figbar-modes';
      for (const m of MODES) {
        const b = document.createElement('button');
        b.textContent = m.label; b.title = m.tip; b.dataset.mode = m.key;
        b.addEventListener('click', () => {
          const f = selectedFigure(editorView.state);
          const attrs = { ...m.attrs };
          if (f && m.attrs.placement !== 'wrap' && f.node.attrs.placement === 'wrap') attrs.width = 0.8;   // leaving wrap: back to a normal width
          if (f && m.attrs.placement === 'wrap' && f.node.attrs.placement === 'wrap') delete attrs.width;   // keep the chosen wrap width
          setFigureAttrs(editorView, attrs);
        });
        modes.appendChild(b);
      }
      const wlab = document.createElement('label');
      wlab.className = 'figbar-width';
      wlab.textContent = 'Width ';
      const range = document.createElement('input');
      range.type = 'range'; range.min = '20'; range.max = '100'; range.step = '5';
      const wval = document.createElement('span');
      range.addEventListener('input', () => { wval.textContent = range.value + ' %'; setFigureAttrs(editorView, { width: +range.value / 100 }); });
      wlab.append(range, wval);
      bar.append(modes, wlab);
      ctxHost().appendChild(bar);   // context row under the toolbar: never covers the text

      const update = (view) => {
        setTimeout(refreshHint, 0);
        const f = selectedFigure(view.state);
        if (!f || !view.editable) { bar.style.display = 'none'; return; }
        const dom = view.nodeDOM(f.pos);
        if (!dom || !dom.getBoundingClientRect) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        const mk = modeOf(f.node.attrs);
        for (const b of modes.children) b.classList.toggle('on', b.dataset.mode === mk);
        const isWrap = f.node.attrs.placement === 'wrap';
        range.max = isWrap ? '60' : '100';
        range.value = String(Math.round(f.node.attrs.width * 100));
        wval.textContent = range.value + ' %';
      };
      update(editorView);
      return { update, destroy: () => bar.remove() };
    },
  });
}

/* Image view with corner handles. Dragging a corner resizes the figure (aspect ratio kept), in 5 % steps of the
   text width; the width is written once on release, so a resize is one undo step. Centred figures grow on both
   sides, so the drag counts double; wrapped figures grow away from the side they sit on. */
/* The figure's annotations reach its image view as a decoration spec (as equation numbers do): when only the figure's
   attributes change, the editor keeps the image view and would not tell it otherwise. */
export const figureAnnotationsPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos = [], threads = threadsOf(state.doc);
      state.doc.descendants((n, pos) => {
        if (n.type.name !== 'figure') return n.isBlock && n.type.name !== 'table_figure';
        const img = n.firstChild;
        if (img && img.type.name === 'image') decos.push(Decoration.node(pos + 1, pos + 1 + img.nodeSize, {}, { ann: annotationsOf(n), threads }));
        return false;
      });
      return DecorationSet.create(state.doc, decos);
    },
  },
});

class ImageView {
  constructor(node, view, getPos, decos) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'figimg';
    this.img = document.createElement('img');
    this.img.draggable = false;
    this.img.src = mediaUrl(node.attrs.src);
    this.dom.appendChild(this.img);
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      const h = document.createElement('span');
      h.className = 'rz rz-' + c;
      h.title = 'Drag to resize';
      h.addEventListener('pointerdown', (e) => this.start(e, c));
      this.dom.appendChild(h);
    }
    this.tip = document.createElement('span');
    this.tip.className = 'rz-tip';
    this.dom.appendChild(this.tip);
    // review marks (core/annotations.js), drawn over the image; double-click opens the figure viewer to look and annotate
    this.ann = document.createElement('div');
    this.ann.className = 'figann';
    this.dom.appendChild(this.ann);
    this.badge = document.createElement('span');
    this.badge.className = 'figann-badge';
    this.dom.appendChild(this.badge);
    this.dom.title = 'Double-click to look closer and annotate';
    this.dom.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('rz')) return;
      e.preventDefault();
      const f = this.figure();
      if (!f) return;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, f.pos)));
      runCommand('figureView');
    });
    this.img.addEventListener('load', () => this.paintAnnotations());
    this.setDecos(decos);
  }

  setDecos(decos) {
    const d = decos && decos.find(x => x.spec && x.spec.ann);
    const list = d ? d.spec.ann : [], threads = d ? d.spec.threads : {};
    if (list === this.annList && threads === this.annThreads) return;      // unchanged (the same objects)
    this.annList = list; this.annThreads = threads;
    this.paintAnnotations();
  }

  paintAnnotations() {
    const list = this.annList || [];
    const aspect = (this.node.attrs.h && this.node.attrs.w) ? this.node.attrs.h / this.node.attrs.w : (this.img.naturalHeight / this.img.naturalWidth) || 0.75;
    this.ann.innerHTML = list.length ? annotationsSvg(list, aspect, { threads: this.annThreads || {} }) : '';
    this.badge.textContent = list.length ? '✎ ' + list.length : '';
    this.badge.title = list.length ? list.length + ' annotation' + (list.length > 1 ? 's' : '') + ' — double-click the figure to see them' : '';
  }

  figure() {
    const pos = this.getPos();
    if (pos == null) return null;
    const $p = this.view.state.doc.resolve(pos);
    return $p.parent.type.name === 'figure' ? { pos: $p.before($p.depth), node: $p.parent } : null;
  }

  start(e, corner) {
    const fig = this.figure();
    if (!fig || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const colW = this.view.dom.clientWidth;
    const startW = this.img.getBoundingClientRect().width;
    const aspect = (this.img.naturalHeight || 3) / (this.img.naturalWidth || 4);
    const wrap = fig.node.attrs.placement === 'wrap';
    const factor = wrap ? 1 : 2;
    const maxFrac = wrap ? 0.6 : 1;
    // During the drag only this view's own element changes size (the editor ignores mutations inside it);
    // touching the figure element itself makes the editor redraw it and the drag would be lost.
    const x0 = e.clientX, y0 = e.clientY;
    let frac = fig.node.attrs.width;
    this.dom.classList.add('resizing');
    const move = (ev) => {
      const dx = (ev.clientX - x0) * (corner.includes('e') ? 1 : -1);
      const dy = ((ev.clientY - y0) * (corner.includes('s') ? 1 : -1)) / aspect;
      const d = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const w = Math.min(Math.max(startW + factor * d, 0.15 * colW), maxFrac * colW);
      frac = Math.round((w / colW) * 20) / 20;
      this.dom.style.width = Math.round(frac * colW) + 'px';
      if (!wrap) this.dom.style.margin = '0 auto';
      this.tip.textContent = Math.round(frac * 100) + ' % of text width';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.dom.classList.remove('resizing');
      this.dom.style.width = ''; this.dom.style.margin = '';
      const f = this.figure();
      if (f && frac !== f.node.attrs.width) this.view.dispatch(this.view.state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, width: frac }));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  update(node, decos) {
    if (node.type !== this.node.type) return false;
    if (node.attrs.src !== this.node.attrs.src) this.img.src = mediaUrl(node.attrs.src);
    this.node = node;
    this.setDecos(decos);
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e) { return !!(e.target && e.target.classList && e.target.classList.contains('rz')); }
  ignoreMutation() { return true; }
}

export const imageNodeView = { image: (node, view, getPos, decos) => new ImageView(node, view, getPos, decos) };

/** Paste/drop of image files becomes figures. */
export function imageDropPlugin() {
  const handleFiles = (view, files) => {
    const imgs = [...files].filter(f => isSupportedImage(f.name) || /^image\//.test(f.type));
    if (!imgs.length) return false;
    (async () => {
      for (const f of imgs) {
        const name = f.name && isSupportedImage(f.name) ? f.name : 'pasted.' + ((f.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg'));
        await insertFigure(view, name, new Uint8Array(await f.arrayBuffer()));
      }
    })();
    return true;
  };
  return new Plugin({
    props: {
      handlePaste: (view, e) => (e.clipboardData && e.clipboardData.files.length ? handleFiles(view, e.clipboardData.files) : false),
      handleDrop: (view, e) => {
        if (!e.dataTransfer || !e.dataTransfer.files.length) return false;
        const p = view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (p) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(p.pos))));
        e.preventDefault();
        return handleFiles(view, e.dataTransfer.files);
      },
    },
  });
}
