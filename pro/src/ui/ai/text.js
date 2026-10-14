// Text as outlines (for the AI assistant: "fill the word 2DPHYS with dots", sweep labels).
//
// The browser draws the text with a system font; the outlines are traced from that image by marching
// squares (sub-pixel, interpolated), simplified, and turned into components — each letter an outline,
// its counters (the holes in A, O, P …) holes. The height asked for is the height of the ink (a capital
// letter), measured on the image, not the font size. Cached per text/font/height.

import { componentsEvenOdd } from '../../core/geom/boolean.js';
import { rdp } from '../../core/geom/shapes.js';

const FONTS = {
  sans: 'Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", "DejaVu Serif", serif',
  mono: 'Consolas, "Courier New", "Liberation Mono", monospace',
};
const PX = 160;                // font size of the tracing (larger = finer outlines, slower)
const cache = new Map();

export function textPolygons(text, { font = 'sans', heightNm = 10000, bold = true } = {}) {
  const fam = FONTS[font] || (font && /[a-z]/i.test(font) ? `${font}, ${FONTS.sans}` : FONTS.sans);
  const key = `${text}|${fam}|${bold}`;
  let traced = cache.get(key);
  if (!traced) { traced = trace(String(text), fam, bold); cache.set(key, traced); if (cache.size > 40) cache.delete(cache.keys().next().value); }
  if (!traced) return null;
  const s = heightNm / traced.inkH;
  const tf = (p) => p.map(([x, y]) => [x * s, y * s]);
  return traced.comps.map((c) => ({ outer: tf(c.outer), holes: c.holes.map(tf) }));
}

function trace(text, fam, bold) {
  if (!text.trim()) return null;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const fontCss = `${bold ? 'bold ' : ''}${PX}px ${fam}`;
  g.font = fontCss;
  const w = Math.ceil(g.measureText(text).width) + PX, h = Math.ceil(PX * 1.8);
  c.width = w; c.height = h;
  g.font = fontCss; g.fillStyle = '#000'; g.textBaseline = 'middle';
  g.fillText(text, PX / 2, h / 2);
  const d = g.getImageData(0, 0, w, h).data;
  const W = w + 2, H = h + 2, v = new Float32Array(W * H);          // a zero border so every outline closes
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = d[(y * w + x) * 4 + 3] / 255;
    v[(y + 1) * W + x + 1] = a;
    if (a > 0.5) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  if (!(y1 >= y0)) return null;
  const loops = marching(v, W, H, 0.5);
  const cx = (x0 + x1) / 2 + 1, cy = (y0 + y1) / 2 + 1;
  const simple = loops.map((l) => rdp(l, 0.35)).filter((l) => l.length >= 3).map((l) => l.map(([x, y]) => [x - cx, -(y - cy)]));
  const comps = componentsEvenOdd(simple);
  return { comps, inkH: y1 - y0 + 1 };
}

// Marching squares on a grid of values (row-major, W × H), threshold t → closed loops in grid units.
function marching(v, W, H, t) {
  const pt = new Map();                 // edge id → [x, y] where the outline crosses it
  const crossH = (x, y) => { const id = 2 * (y * W + x); if (!pt.has(id)) { const a = v[y * W + x], b = v[y * W + x + 1]; pt.set(id, [x + (t - a) / (b - a), y]); } return id; };
  const crossV = (x, y) => { const id = 2 * (y * W + x) + 1; if (!pt.has(id)) { const a = v[y * W + x], b = v[(y + 1) * W + x]; pt.set(id, [x, y + (t - a) / (b - a)]); } return id; };
  const nb = new Map();                 // edge id → the edge ids it links to
  const link = (a, b) => { (nb.get(a) || nb.set(a, []).get(a)).push(b); (nb.get(b) || nb.set(b, []).get(b)).push(a); };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = v[y * W + x] > t, b = v[y * W + x + 1] > t, c = v[(y + 1) * W + x + 1] > t, d = v[(y + 1) * W + x] > t;
    const k = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const T = () => crossH(x, y), R = () => crossV(x + 1, y), B = () => crossH(x, y + 1), L = () => crossV(x, y);
    switch (k) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: case 10: {                // saddle: decided by the centre
        const m = (v[y * W + x] + v[y * W + x + 1] + v[(y + 1) * W + x + 1] + v[(y + 1) * W + x]) / 4 > t;
        if ((k === 5) === m) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(T(), R()); }
        break;
      }
      default: break;
    }
  }
  const loops = [], seen = new Set();
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur); loop.push(pt.get(cur));
      const n = nb.get(cur), next = n[0] !== prev ? n[0] : n[1];
      prev = cur; cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
