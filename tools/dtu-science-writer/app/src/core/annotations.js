/* Figure annotations: review marks drawn on a figure (figure.attrs.annotations), not part of the printed figure.
     { id, kind: 'pen' | 'marker', color, pts: [[x, y], …], author, initials, time }
     { id, kind: 'text', color, x, y, text, size, author, initials, time }      (size: text height as a fraction of the image width)
     { id, kind: 'comment', x, y, w, h, thread, author, initials, time }      (thread: a comment thread, figure.attrs.comments)
   Coordinates are fractions of the image width (x) and height (y), so marks stay in place when the figure is resized.
   Rendering is one SVG over the image (viewBox 1000 wide, 1000·h/w high), used by the editor and the figure viewer.
   In Word, comment boxes become Word comments on the picture; drawings have no Word equivalent (later: track changes). */

export const PEN_COLORS = ['#d0021b', '#1f5fbf', '#2e8540', '#111111'];
export const MARKER_COLORS = ['#ffe14d', '#7cf27c', '#ff9de2', '#8fd3ff'];
export const TEXT_SIZE = 0.022;              // default text height as a fraction of the image width
export const TEXT_SIZE_MIN = 0.01, TEXT_SIZE_MAX = 0.06;
export const ANN_FONT = 'Arial, Helvetica, sans-serif';      // annotations are always Arial, whatever the document font
export const textSize = (a) => (typeof a.size === 'number' && a.size >= TEXT_SIZE_MIN && a.size <= TEXT_SIZE_MAX ? a.size : TEXT_SIZE);

export const annotationsOf = (fig) => (fig && fig.attrs && Array.isArray(fig.attrs.annotations) ? fig.attrs.annotations : []);
export const newAnnotationId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

const r4 = (v) => Math.round(v * 10000) / 10000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Drop points closer than `tol` to the previous one and round (keeps files small). */
export function simplify(pts, tol = 0.002) {
  const out = [];
  for (const [x, y] of pts) {
    const p = [r4(clamp01(x)), r4(clamp01(y))];
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= tol) out.push(p);
  }
  const last = pts[pts.length - 1];
  if (last && out.length && (out[out.length - 1][0] !== r4(clamp01(last[0])) || out[out.length - 1][1] !== r4(clamp01(last[1])))) out.push([r4(clamp01(last[0])), r4(clamp01(last[1]))]);
  return out;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const color = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fallback);

/** Comment boxes are numbered in reading order (top to bottom, left to right) — the same numbers in editor and viewer. */
export function commentNumbers(list) {
  const boxes = list.filter(a => a.kind === 'comment').slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return new Map(boxes.map((a, i) => [a.id, i + 1]));
}

/**
 * SVG markup for the annotations of a figure. aspect = image height / width.
 * opts.threads: comment threads (resolved ones drawn faint, missing ones skipped); opts.active: id to emphasise;
 * opts.hit: add wide invisible strokes so thin lines can be clicked (figure viewer).
 */
export function annotationsSvg(list, aspect, opts = {}) {
  const W = 1000, H = Math.round(1000 * (aspect > 0 ? aspect : 0.75));
  const X = (v) => (v * W).toFixed(1), Y = (v) => (v * H).toFixed(1);
  const threads = opts.threads || null, nums = commentNumbers(list);
  const parts = [];
  for (const a of list) {
    const act = opts.active && a.id === opts.active ? ' data-active="1"' : '';
    if ((a.kind === 'pen' || a.kind === 'marker') && Array.isArray(a.pts) && a.pts.length) {
      const d = a.pts.map(([x, y], i) => (i ? 'L' : 'M') + X(x) + ' ' + Y(y)).join(' ') + (a.pts.length === 1 ? ' l0.1 0' : '');
      const marker = a.kind === 'marker';
      parts.push('<path data-id="' + esc(a.id) + '"' + act + ' d="' + d + '" fill="none" stroke="' + color(a.color, marker ? MARKER_COLORS[0] : PEN_COLORS[0]) + '" stroke-width="' + (marker ? 22 : 4) + '" stroke-linecap="round" stroke-linejoin="round"' + (marker ? ' stroke-opacity="0.42" style="mix-blend-mode:multiply"' : '') + '/>');
      if (opts.hit) parts.push('<path data-id="' + esc(a.id) + '" class="hit" d="' + d + '" fill="none" stroke="transparent" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>');
    } else if (a.kind === 'text' && a.text) {
      const lines = String(a.text).split('\n');
      const size = textSize(a) * W;
      parts.push('<text data-id="' + esc(a.id) + '"' + act + ' x="' + X(a.x) + '" y="' + Y(a.y) + '" fill="' + color(a.color, PEN_COLORS[0]) + '" font-size="' + size.toFixed(1) + '" font-family="' + ANN_FONT + '" paint-order="stroke" stroke="#fff" stroke-width="' + (size * 0.18).toFixed(1) + '" stroke-linejoin="round">'
        + lines.map((l, i) => '<tspan x="' + X(a.x) + '" dy="' + (i ? (size * 1.2).toFixed(1) : '0') + '">' + esc(l) + '</tspan>').join('') + '</text>');
    } else if (a.kind === 'comment') {
      const t = threads ? threads[a.thread] : null;
      if (threads && !t) continue;                         // thread deleted: the box goes with it
      const faint = t && t.resolved ? ' opacity="0.35"' : '';
      const n = nums.get(a.id) || '';
      parts.push('<g data-id="' + esc(a.id) + '"' + act + faint + ' class="ann-comment"><rect x="' + X(a.x) + '" y="' + Y(a.y) + '" width="' + X(a.w) + '" height="' + Y(a.h) + '" fill="rgba(255,200,0,0.08)" stroke="#e0a100" stroke-width="3" stroke-dasharray="10 6" rx="4"/>'
        + '<circle cx="' + X(a.x) + '" cy="' + Y(a.y) + '" r="17" fill="#e0a100"/><text x="' + X(a.x) + '" y="' + (a.y * H + 7).toFixed(1) + '" text-anchor="middle" font-size="20" font-weight="bold" font-family="Arial, sans-serif" fill="#fff">' + n + '</text></g>');
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="ann-svg">' + parts.join('') + '</svg>';
}
