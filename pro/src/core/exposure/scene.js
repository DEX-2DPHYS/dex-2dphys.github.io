// Walking the placed layout for the exposure engine: hierarchy traversal with region culling,
// dose-weighted coverage rasters, and exact world polygons (fused groups unioned).
//
// Only exposure layers count (not markers, not device areas); hidden layers are still exposed —
// visibility is a display matter.

import { visibleRange, elementTransform, cellBBox, isExposedPurpose } from '../geom/library.js';
import { compose, invert, applyBBox, apply, IDENTITY } from '../geom/transform.js';
import { transformShape, signedDistance, outlineWorld, bboxWorld, area } from '../geom/shapes.js';
import { unionPolygons, orientCCW } from '../geom/clip.js';
import { isPackedCell, valAt, shapeAt, packedBBox } from '../geom/pack.js';

export const exposedLayer = (lib) => {
  const off = new Set(lib.layers.filter((l) => !isExposedPurpose(l.purpose)).map((l) => l.key));
  return (key) => !off.has(key);
};

// Placement parameters of a similarity transform (rotation, uniform scale, optional mirror).
export function placementOf(T) {
  const det = T.a * T.d - T.b * T.c;
  return { x: T.e, y: T.f, mag: Math.sqrt(Math.abs(det)), mirrorX: det < 0, rot: (Math.atan2(T.b, T.a) * 180) / Math.PI };
}

// cb(cellName, T, k) for every cell instance (including the top cell itself) whose bbox can touch
// roi. k is the product of the references' dose multipliers (doseScale, dose-ramp arrays) down to it.
export function forEachCellInstance(lib, top, roi, cb, cache = new Map()) {
  const visit = (name, T, depth, k) => {
    if (depth > 32) throw new Error('hierarchy deeper than 32 levels');
    cb(name, T, k);
    const local = applyBBox(invert(T), roi);
    for (const r of lib.cells[name].refs) {
      const rg = visibleRange(lib, r, local, cache);
      if (!rg) continue;
      const kr = k * (r.doseScale ?? 1);
      for (let i = rg.i0; i <= rg.i1; i++) for (let j = rg.j0; j <= rg.j1; j++) visit(r.cell, compose(T, elementTransform(r, i, j)), depth + 1, kr);
    }
  };
  if (cellBBox(lib, top, cache)) visit(top, IDENTITY, 0, 1);
}

// Group a cell's shapes into objects: fused groups (same groupId) and singles.
// → {objs, P}. An ordinary cell's objects are {members: [shape…]}. A packed cell's (P set) are row
// numbers — a single shape, or a group of one — or {mi: [rows]}: its shapes are built when visited
// (members()), so a cell of a million fragments costs its columns, not a million objects.
function cellObjects(cell, exposed) {
  const groups = new Map(), out = [];
  if (isPackedCell(cell)) {
    const P = cell.__shapes;
    for (let i = 0; i < P.n; i++) {
      if (!exposed(valAt(P, 'layer', i))) continue;
      const g = valAt(P, 'groupId', i);
      if (g) { const e = groups.get(g); if (e === undefined) { groups.set(g, out.length); out.push(i); } else { const o = out[e]; if (typeof o === 'number') out[e] = { mi: [o, i] }; else o.mi.push(i); } }
      else out.push(i);
    }
    return { objs: out, P };
  }
  for (const s of cell.shapes) {
    if (!exposed(s.layer)) continue;
    if (s.groupId) { if (!groups.has(s.groupId)) { const g = { members: [] }; groups.set(s.groupId, g); out.push(g); } groups.get(s.groupId).members.push(s); }
    else out.push({ members: [s] });
  }
  return { objs: out, P: null };
}
const members = (c, o) => (typeof o === 'number' ? [shapeAt(c.P, o)] : o.mi ? o.mi.map((i) => shapeAt(c.P, i)) : o.members);
const memberBBox = (c, o) => {
  if (!c.P) { let b = null; for (const s of o.members) { const q = bboxWorld(s); b = b ? { x1: Math.min(b.x1, q.x1), y1: Math.min(b.y1, q.y1), x2: Math.max(b.x2, q.x2), y2: Math.max(b.y2, q.y2) } : q; } return b; }
  const rows = typeof o === 'number' ? [o] : o.mi;
  let b = null; for (const i of rows) { const q = packedBBox(c.P, i, bboxWorld); b = b ? { x1: Math.min(b.x1, q.x1), y1: Math.min(b.y1, q.y1), x2: Math.max(b.x2, q.x2), y2: Math.max(b.y2, q.y2) } : q; }
  return b;
};

// ---------------------------------------------------------------- coverage raster
// grid = {x0, y0, dx, nx, ny}; cell (i, j) has its centre at (x0 + (i+½)dx, y0 + (j+½)dx).
// Adds Σ dose · covered fraction to `out` (Float32Array nx·ny). Shapes smaller than a cell are
// splatted (area · dose, bilinear at the centre); fused groups count overlaps once.
// emit(cellIndex, value, shape), if given, receives every contribution instead of `out` (the
// long-range operator of the correction builds per-fragment coverage from it).
// scene (from sceneCache()): reuse each cell's objects, boxes and bucket index, so a raster of a small
// region of a large flat cell costs what is in the region (same objects, same order, same sums).
export function rasterize(lib, top, grid, doseOf, out = new Float32Array(grid.nx * grid.ny), emit = null, scene = null) {
  if (!out) out = new Float32Array(grid.nx * grid.ny);
  const { x0, y0, dx, nx, ny } = grid;
  const roi = { x1: x0, y1: y0, x2: x0 + nx * dx, y2: y0 + ny * dx };
  const exposed = exposedLayer(lib);
  const objCache = new Map();
  const half = 0.7072 * dx, inv = 1 / (dx * dx);

  const splat = (x, y, amount, add) => {
    const u = (x - x0) / dx - 0.5, v = (y - y0) / dx - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    for (const [di, dj, w] of [[0, 0, (1 - fu) * (1 - fv)], [1, 0, fu * (1 - fv)], [0, 1, (1 - fu) * fv], [1, 1, fu * fv]]) {
      const i = i0 + di, j = j0 + dj;
      if (i >= 0 && j >= 0 && i < nx && j < ny) add(j * nx + i, amount * w * inv);
    }
  };
  // Cells well inside / outside (by signed distance) are 1 / 0; boundary cells get the exact
  // area of polygon ∩ cell (Sutherland–Hodgman against the cell square), so thin lines and
  // small dots weigh exactly what they should.
  const cover = (ws, bb, put) => {
    const i0 = Math.max(0, Math.floor((bb.x1 - x0) / dx)), i1 = Math.min(nx - 1, Math.floor((bb.x2 - x0) / dx));
    const j0 = Math.max(0, Math.floor((bb.y1 - y0) / dx)), j1 = Math.min(ny - 1, Math.floor((bb.y2 - y0) / dx));
    let outline = null;
    for (let j = j0; j <= j1; j++) {
      const cy = y0 + (j + 0.5) * dx;
      for (let i = i0; i <= i1; i++) {
        const cx = x0 + (i + 0.5) * dx;
        const sd = signedDistance(ws, cx, cy);
        let c;
        if (sd <= -half) c = 1;
        else if (sd >= half) continue;
        else {
          if (!outline) outline = outlineWorld(ws, Math.max(dx / 50, 0.05));
          c = clippedArea(outline, cx - dx / 2, cy - dx / 2, cx + dx / 2, cy + dx / 2) * inv;
          if (c <= 0) continue;
        }
        put(j * nx + i, Math.min(1, c));
      }
    }
  };

  forEachCellInstance(lib, top, roi, (name, T, k) => {
    let c = scene ? indexedCell(scene, lib, name, exposed) : objCache.get(name);
    if (!c) { c = cellObjects(lib.cells[name], exposed); objCache.set(name, c); }
    const objs = c.objs;
    if (!objs.length) return;
    const P = placementOf(T), m2 = P.mag * P.mag;
    const which = c.index ? candidates(c, applyBBox(invert(T), roi)) : null;
    const nObj = which ? which.length : objs.length;
    for (let w = 0; w < nObj; w++) {
      const q = which ? which[w] : w, ms = members(c, objs[q]);
      const dose = doseOf(ms[0]) * k;
      if (!dose) continue;
      if (ms.length === 1) {
        const s = ms[0];
        const add = emit ? (k, v) => emit(k, v, s) : (k, v) => { out[k] += v; };
        const bb = applyBBox(T, c.bbs ? c.bbs[q] : bboxWorld(s));
        if (bb.x2 < roi.x1 || bb.x1 > roi.x2 || bb.y2 < roi.y1 || bb.y1 > roi.y2) continue;
        if (Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) < dx) { const [cx, cy] = apply(T, s.cx, s.cy); splat(cx, cy, area(s) * m2 * dose, add); continue; }
        cover(transformShape(s, P), bb, (k, c) => add(k, c * dose));
      } else {
        const acc = new Map();
        for (const s of ms) {
          const bb = applyBBox(T, bboxWorld(s));
          if (bb.x2 < roi.x1 || bb.x1 > roi.x2 || bb.y2 < roi.y1 || bb.y1 > roi.y2) continue;
          cover(transformShape(s, P), bb, (k, c) => { if (!(acc.get(k) >= c)) acc.set(k, c); });
        }
        for (const [k, c] of acc) { if (emit) emit(k, c * dose, ms[0]); else out[k] += c * dose; }
      }
    }
  }, scene ? scene.bb : undefined);
  return out;
}

// ---------------------------------------------------------------- exact polygons
// World polygons within roi: [{pts, dose}] — singles counter-clockwise; fused groups unioned
// (outer boundaries CCW, holes CW). `tol` is the chord tolerance for circles (nm).
// `scene` (optional, from sceneCache()) keeps each cell's objects, bounding boxes and a bucket index
// between calls of one engine, so a call costs what is near roi rather than the whole layout.
export function sceneCache() { return { cells: new Map(), inst: new Map(), bb: new Map() }; }   // bb: cell bounding boxes (a large flat cell's costs a pass over its vertices)
function indexedCell(scene, lib, name, exposed) {
  let c = scene && scene.cells.get(name);
  if (c) return c;
  const { objs, P } = cellObjects(lib.cells[name], exposed);
  const bbs = objs.map((o) => memberBBox({ P }, o));
  c = { objs, P, bbs, index: null };
  if (objs.length > 256) {                 // bucket index: ~4 objects per bucket on average
    let X1 = Infinity, Y1 = Infinity, X2 = -Infinity, Y2 = -Infinity;
    for (const b of bbs) { X1 = Math.min(X1, b.x1); Y1 = Math.min(Y1, b.y1); X2 = Math.max(X2, b.x2); Y2 = Math.max(Y2, b.y2); }
    const size = Math.max(1, Math.sqrt(((X2 - X1) * (Y2 - Y1)) / (objs.length / 4)));
    const nx = Math.max(1, Math.ceil((X2 - X1) / size)), ny = Math.max(1, Math.ceil((Y2 - Y1) / size));
    const buckets = new Map();
    bbs.forEach((b, q) => {
      const i0 = Math.max(0, Math.floor((b.x1 - X1) / size)), i1 = Math.min(nx - 1, Math.floor((b.x2 - X1) / size));
      const j0 = Math.max(0, Math.floor((b.y1 - Y1) / size)), j1 = Math.min(ny - 1, Math.floor((b.y2 - Y1) / size));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = j * nx + i; let a = buckets.get(k); if (!a) buckets.set(k, (a = [])); a.push(q); }
    });
    c.index = { X1, Y1, size, nx, ny, buckets };
  }
  if (scene) scene.cells.set(name, c);
  return c;
}
// object indices of a cell whose bbox may touch a cell-local box, in their original order
function candidates(c, b) {
  if (!c.index) return null;
  const { X1, Y1, size, nx, ny, buckets } = c.index, seen = new Set();
  const i0 = Math.max(0, Math.floor((b.x1 - X1) / size)), i1 = Math.min(nx - 1, Math.floor((b.x2 - X1) / size));
  const j0 = Math.max(0, Math.floor((b.y1 - Y1) / size)), j1 = Math.min(ny - 1, Math.floor((b.y2 - Y1) / size));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = buckets.get(j * nx + i); if (a) for (const q of a) seen.add(q); }
  return [...seen].sort((p, q) => p - q);
}

export function collectPolygons(lib, top, roi, doseOf, tol = 1, scene = null) {
  const exposed = exposedLayer(lib);
  const polys = [];
  forEachCellInstance(lib, top, roi, (name, T, k) => {
    const c = indexedCell(scene, lib, name, exposed);
    const local = c.index ? applyBBox(invert(T), roi) : null;
    const which = local ? candidates(c, local) : null;
    const n = which ? which.length : c.objs.length;
    for (let w = 0; w < n; w++) {
      const ms = members(c, c.objs[which ? which[w] : w]);
      const dose = doseOf(ms[0]) * k;
      if (!dose) continue;
      let touch = false;
      for (const s of ms) {
        const bb = applyBBox(T, bboxWorld(s));
        if (!(bb.x2 < roi.x1 || bb.x1 > roi.x2 || bb.y2 < roi.y1 || bb.y1 > roi.y2)) { touch = true; break; }
      }
      if (!touch) continue;
      const parts = ms.map((s) => outlineWorld(s, tol).map(([x, y]) => apply(T, x, y)));
      const shapes = parts.length === 1 ? [orientCCW(parts[0])] : unionPolygons(parts);
      for (const pts of shapes) polys.push({ pts, dose, bb: bboxOf(pts), src: ms[0] });
    }
  }, scene ? scene.bb : undefined);
  return polys;
}

// |area| of a polygon clipped to the rectangle [x1,x2]×[y1,y2] (Sutherland–Hodgman).
export function clippedArea(pts, x1, y1, x2, y2) {
  let p = pts;
  const clip = (keep, cut) => {
    const out = [];
    for (let k = 0, n = p.length; k < n; k++) {
      const a = p[k], b = p[(k + 1) % n], ina = keep(a), inb = keep(b);
      if (ina) out.push(a);
      if (ina !== inb) out.push(cut(a, b));
    }
    p = out;
  };
  const lerpX = (xc) => (a, b) => [xc, a[1] + ((b[1] - a[1]) * (xc - a[0])) / (b[0] - a[0])];
  const lerpY = (yc) => (a, b) => [a[0] + ((b[0] - a[0]) * (yc - a[1])) / (b[1] - a[1]), yc];
  clip((q) => q[0] >= x1, lerpX(x1)); if (p.length < 3) return 0;
  clip((q) => q[0] <= x2, lerpX(x2)); if (p.length < 3) return 0;
  clip((q) => q[1] >= y1, lerpY(y1)); if (p.length < 3) return 0;
  clip((q) => q[1] <= y2, lerpY(y2)); if (p.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

function bboxOf(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pts) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  return { x1, y1, x2, y2 };
}
