// Layout outlines over a field view (Exposure tab): same view convention and level-of-detail rules
// as the editor (arrays far away → outline of the lattice region only), stroke only.

import { cellBBox, refBBox, visibleRange, elementTransform, refLinear, deviceAreas } from '../../core/geom/library.js';
import { compose, invert, applyBBox, apply, scaleOf, IDENTITY } from '../../core/geom/transform.js';
import { outlineWorld, bboxWorld } from '../../core/geom/shapes.js';

const TAU = Math.PI * 2;

export function createOutlineRenderer() {
  let cacheVersion = -1;
  const paths = new Map(), bbCache = new Map();
  function addShapes(p, shapes) {
    for (const s of shapes) {
      // closed with a lineTo, not closePath: Chrome's closePath is quadratic in the subpaths of one
      // Path2D (34.6 s for 100 000 shapes against 13 ms), and this path holds a whole cell
      if (s.kind === 'circle') { p.moveTo(s.cx + s.r, s.cy); p.arc(s.cx, s.cy, s.r, 0, TAU); continue; }
      const pts = outlineWorld(s);
      p.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
      p.lineTo(pts[0][0], pts[0][1]);
    }
  }
  // A cell's outline: one Path2D, or — for a large cell (CHUNK_FROM shapes and more) — square chunks
  // of about CHUNK shapes, each with its box and typical shape size, its path built the first time
  // it is drawn. A chunk whose shapes would be under ~1.5 px on screen is not outlined (the dose map
  // shows them); one stroke of a 300 000-shape path every frame was the tab's heaviest redraw.
  const CHUNK_FROM = 20000, CHUNK = 2000;
  function pathOf(lib, name) {
    let p = paths.get(name);
    if (p) return p;
    const dev = new Set(lib.layers.filter((l) => l.purpose === 'device' || l.purpose === 'hres').map((l) => l.key));
    const shapes = lib.cells[name].shapes.filter((s) => !dev.has(s.layer));   // device areas: drawn separately, in gold
    if (shapes.length < CHUNK_FROM) { p = new Path2D(); addShapes(p, shapes); paths.set(name, p); return p; }
    const bbs = shapes.map(bboxWorld);
    let X1 = Infinity, Y1 = Infinity, X2 = -Infinity, Y2 = -Infinity;
    for (const b of bbs) { if (b.x1 < X1) X1 = b.x1; if (b.y1 < Y1) Y1 = b.y1; if (b.x2 > X2) X2 = b.x2; if (b.y2 > Y2) Y2 = b.y2; }
    const G = Math.max(1, Math.ceil(Math.sqrt(shapes.length / CHUNK))), cw = Math.max(X2 - X1, 1) / G, ch = Math.max(Y2 - Y1, 1) / G;
    const groups = new Map();
    shapes.forEach((s, i) => {
      const b = bbs[i], gi = Math.min(G - 1, Math.floor(((b.x1 + b.x2) / 2 - X1) / cw)), gj = Math.min(G - 1, Math.floor(((b.y1 + b.y2) / 2 - Y1) / ch));
      const k = gj * G + gi;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { shapes: [], bb: { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }, sizes: [], path: null }));
      g.shapes.push(s); g.sizes.push(Math.max(b.x2 - b.x1, b.y2 - b.y1));
      if (b.x1 < g.bb.x1) g.bb.x1 = b.x1; if (b.y1 < g.bb.y1) g.bb.y1 = b.y1; if (b.x2 > g.bb.x2) g.bb.x2 = b.x2; if (b.y2 > g.bb.y2) g.bb.y2 = b.y2;
    });
    const chunks = [...groups.values()].map((g) => { g.sizes.sort((a, b) => a - b); g.size = g.sizes[g.sizes.length >> 1]; delete g.sizes; return g; });
    p = { chunks };
    paths.set(name, p);
    return p;
  }

  // view = {s, ox, oy, W, H, dpr}
  return function draw(ctx, lib, version, view, { color = 'rgba(20,20,20,0.75)', budget = 20000 } = {}) {
    if (version !== cacheVersion) { paths.clear(); bbCache.clear(); cacheVersion = version; }
    const { s, ox, oy, W, H, dpr } = view;
    const k = dpr / s;
    const vr = { x1: ox, y1: oy - H * s, x2: ox + W * s, y2: oy };
    const setT = (T) => ctx.setTransform(k * T.a, -k * T.b, k * T.c, -k * T.d, k * (T.e - ox), -k * (T.f - oy));
    let left = budget;
    ctx.strokeStyle = color;
    const drawCell = (name, T, depth) => {
      const bb = cellBBox(lib, name, bbCache);
      if (!bb) return;
      const wb = applyBBox(T, bb);
      if (wb.x2 < vr.x1 || wb.x1 > vr.x2 || wb.y2 < vr.y1 || wb.y1 > vr.y2) return;
      if (Math.max(wb.x2 - wb.x1, wb.y2 - wb.y1) / s < 1.5) return;
      setT(T); ctx.lineWidth = s / scaleOf(T);
      const p = pathOf(lib, name);
      if (p instanceof Path2D) ctx.stroke(p);
      else for (const c of p.chunks) {
        const cb = applyBBox(T, c.bb);
        if (cb.x2 < vr.x1 || cb.x1 > vr.x2 || cb.y2 < vr.y1 || cb.y1 > vr.y2) continue;
        if ((c.size * scaleOf(T)) / s < 1.5) continue;            // under a pixel and a half: left to the map
        if (!c.path) { c.path = new Path2D(); addShapes(c.path, c.shapes); }
        ctx.stroke(c.path);
      }
      if (depth > 24) return;
      for (const r of lib.cells[name].refs) drawRef(r, T, depth + 1);
    };
    const drawRef = (r, T, depth) => {
      const rb = refBBox(lib, r, bbCache);
      if (!rb) return;
      const wb = applyBBox(T, rb);
      if (wb.x2 < vr.x1 || wb.x1 > vr.x2 || wb.y2 < vr.y1 || wb.y1 > vr.y2) return;
      const rg = visibleRange(lib, r, applyBBox(invert(T), vr), bbCache);
      if (!rg) return;
      const n = (rg.i1 - rg.i0 + 1) * (rg.j1 - rg.j0 + 1);
      const cb = cellBBox(lib, r.cell, bbCache);
      const elemPx = (Math.max(cb.x2 - cb.x1, cb.y2 - cb.y1) * r.mag * scaleOf(T)) / s;
      if (n > 1 && (elemPx < 4 || n > left)) {
        const b0 = applyBBox(refLinear(r), cb);
        const P = (i, j) => apply(T, r.x + i * r.colStep[0] + j * r.rowStep[0], r.y + i * r.colStep[1] + j * r.rowStep[1]);
        const q = [P(rg.i0, rg.j0), P(rg.i1 + 1, rg.j0), P(rg.i1 + 1, rg.j1 + 1), P(rg.i0, rg.j1 + 1)];
        setT(IDENTITY);
        ctx.lineWidth = s; ctx.setLineDash([4 * s, 3 * s]);
        ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x + b0.x1, y + b0.y1) : ctx.moveTo(x + b0.x1, y + b0.y1))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        left -= 50;
        return;
      }
      for (let i = rg.i0; i <= rg.i1; i++) for (let j = rg.j0; j <= rg.j1; j++) { left--; drawCell(r.cell, compose(T, elementTransform(r, i, j)), depth); }
    };
    drawCell(lib.top, IDENTITY, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
}

// Device areas as dashed gold boxes with their names (same view convention as above).
export function drawDeviceAreas(ctx, lib, view, { highlight = null } = {}) {
  const { s, ox, oy, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '12px system-ui';
  for (const a of deviceAreas(lib)) {
    const x1 = (a.bb.x1 - ox) / s, y1 = (oy - a.bb.y2) / s, w = (a.bb.x2 - a.bb.x1) / s, h = (a.bb.y2 - a.bb.y1) / s;
    const hi = highlight === a.id;
    ctx.fillStyle = hi ? 'rgba(201,164,0,0.18)' : 'rgba(201,164,0,0.07)'; ctx.fillRect(x1, y1, w, h);
    ctx.strokeStyle = hi ? '#8a6d00' : '#c9a400'; ctx.lineWidth = hi ? 2 : 1.5; ctx.setLineDash([8, 4]); ctx.strokeRect(x1, y1, w, h); ctx.setLineDash([]);
    const txt = a.name, tw = ctx.measureText(txt).width + 6;
    ctx.fillStyle = 'rgba(255,250,220,0.9)'; ctx.fillRect(x1, Math.max(2, y1 - 17), tw, 15);
    ctx.fillStyle = '#7a6200'; ctx.fillText(txt, x1 + 3, Math.max(2, y1 - 17) + 12);
  }
}
