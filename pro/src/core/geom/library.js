// Hierarchical layout library: cells holding editor shapes and references to
// other cells. A reference with cols = rows = 1 is a GDS SREF; anything larger is an AREF.
//
// Library { name, top, cells: { [name]: Cell }, layers: [Layer] }
// Cell    { name, shapes: [Shape], refs: [Ref] }
// Ref     { id, cell, x, y, rot, mag, mirrorX, cols, rows, colStep: [dx, dy], rowStep: [dx, dy] }
// Layer   { key: 'L/D', name, color, visible, purpose: 'exposure'|'design'|'marker' }
//
// Lattice vectors are in the parent's coordinates (as in GDS AREF); every element of an array
// carries the same rotation / magnification / mirror. Element (i, j) sits at
// (x, y) + i·colStep + j·rowStep.

import { gdsLinear, compose, applyBBox, unionBBox, invert, apply } from './transform.js';
import { bboxWorld, area, uid, transformShape, outlineWorld } from './shapes.js';
import { isPackedCell, packedBBox } from './pack.js';

export const DEVICE_LAYER = '200/0';
export const HRES_LAYER = '201/0';                        // high-resolution PEC zones (not exposed)
export const DEFAULT_LAYERS = [
  { key: '1/0', name: 'Exposure', color: '#2f6fd6', visible: true, purpose: 'exposure' },
  { key: '2/0', name: 'Exposure 2', color: '#d6532f', visible: true, purpose: 'exposure' },
  { key: '10/0', name: 'Marker (not exposed)', color: '#7a7a7a', visible: true, purpose: 'marker' },
  { key: DEVICE_LAYER, name: 'Device areas (Fab Studio)', color: '#c9a400', visible: true, purpose: 'device' },
  { key: HRES_LAYER, name: 'High-resolution PEC zones', color: '#d0368a', visible: true, purpose: 'hres' },
];

// A layer is exposed unless it is a marker, a device-area or a high-resolution-zone layer.
export const isExposedPurpose = (purpose) => purpose !== 'marker' && purpose !== 'device' && purpose !== 'hres';

// High-resolution PEC: the zones (bounding boxes of the top cell's shapes on 'hres' layers) and the
// exposed layers marked pec: 'high'. Both are corrected in full, the rest by the base method.
export function hresZones(lib) {
  const z = new Set(lib.layers.filter((l) => l.purpose === 'hres').map((l) => l.key));
  const top = lib.cells[lib.top];
  if (!top || !z.size) return [];
  return top.shapes.filter((s) => z.has(s.layer)).map((s) => bboxWorld(s));
}
export const highLayers = (lib) => lib.layers.filter((l) => l.pec === 'high' && isExposedPurpose(l.purpose)).map((l) => l.key);

// Device areas: rectangles on a device layer in the top cell. Each gets a stable
// id (the shape id), its world bbox and a name. Rotated rectangles use their bounding box.
export function deviceAreas(lib) {
  const dev = new Set(lib.layers.filter((l) => l.purpose === 'device').map((l) => l.key));
  const top = lib.cells[lib.top];
  if (!top || !dev.size) return [];
  const out = [];
  let n = 0;
  for (const s of top.shapes) {
    if (!dev.has(s.layer)) continue;
    n++;
    const bb = bboxWorld(s);
    out.push({ id: s.id, name: s.name || `Device area ${n}`, kind: s.kind, bb, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1, shape: s });
  }
  return out;
}

export function makeCell(name) { return { name, shapes: [], refs: [] }; }

export function makeLibrary(name = 'LIB', top = 'TOP') {
  return { name, top, cells: { [top]: makeCell(top) }, layers: DEFAULT_LAYERS.map((l) => ({ ...l })) };
}

export function makeRef(cell, { x = 0, y = 0, rot = 0, mag = 1, mirrorX = false, cols = 1, rows = 1, colStep = [0, 0], rowStep = [0, 0] } = {}) {
  return { id: uid('i'), cell, x, y, rot, mag, mirrorX, cols, rows, colStep: [...colStep], rowStep: [...rowStep] };
}

export const isArray = (ref) => ref.cols * ref.rows > 1;
export const refLinear = (ref) => gdsLinear(ref);
export const elementTransform = (ref, i = 0, j = 0) => ({
  ...gdsLinear(ref),
  e: ref.x + i * ref.colStep[0] + j * ref.rowStep[0],
  f: ref.y + i * ref.colStep[1] + j * ref.rowStep[1],
});

export function uniqueCellName(lib, base) {
  base = base.replace(/[^A-Za-z0-9_$?]/g, '_').slice(0, 32) || 'CELL';
  if (!lib.cells[base]) return base;
  for (let k = 2; ; k++) if (!lib.cells[`${base}_${k}`]) return `${base}_${k}`;
}

// ---- hierarchy queries ----

// Does `name` (transitively) reference `target`? Used to refuse recursive placements.
export function references(lib, name, target, seen = new Set()) {
  if (name === target) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const c = lib.cells[name];
  return !!c && c.refs.some((r) => references(lib, r.cell, target, seen));
}

export function parentsOf(lib, name) {
  return Object.values(lib.cells).filter((c) => c.refs.some((r) => r.cell === name)).map((c) => c.name);
}

// Bounding box of a cell in its own coordinates (nm), memoised per call via `cache`.
export function cellBBox(lib, name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name);
  cache.set(name, null);   // guards against cycles
  const c = lib.cells[name];
  let bb = null;
  if (c) {
    if (isPackedCell(c)) for (let i = 0; i < c.__shapes.n; i++) bb = unionBBox(bb, packedBBox(c.__shapes, i, bboxWorld));
    else for (const s of c.shapes) bb = unionBBox(bb, bboxWorld(s));
    for (const r of c.refs) bb = unionBBox(bb, refBBox(lib, r, cache));
  }
  cache.set(name, bb);
  return bb;
}

// Bounding box of a whole reference (all array elements) in the parent's coordinates.
export function refBBox(lib, ref, cache = new Map()) {
  const b0 = applyBBox(refLinear(ref), cellBBox(lib, ref.cell, cache));
  if (!b0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const i of [0, ref.cols - 1]) for (const j of [0, ref.rows - 1]) {
    const ox = ref.x + i * ref.colStep[0] + j * ref.rowStep[0], oy = ref.y + i * ref.colStep[1] + j * ref.rowStep[1];
    x1 = Math.min(x1, ox + b0.x1); y1 = Math.min(y1, oy + b0.y1); x2 = Math.max(x2, ox + b0.x2); y2 = Math.max(y2, oy + b0.y2);
  }
  return { x1, y1, x2, y2 };
}

// Lattice index range of the elements of `ref` whose bounding boxes can touch `view`
// (parent coordinates). Exact for any non-degenerate lattice; conservative otherwise.
export function visibleRange(lib, ref, view, cache) {
  const all = { i0: 0, i1: ref.cols - 1, j0: 0, j1: ref.rows - 1 };
  const b0 = applyBBox(refLinear(ref), cellBBox(lib, ref.cell, cache));
  if (!b0) return null;
  // lattice origins whose element can overlap the view lie in view ⊖ element bbox
  const vx1 = view.x1 - b0.x2 - ref.x, vx2 = view.x2 - b0.x1 - ref.x;
  const vy1 = view.y1 - b0.y2 - ref.y, vy2 = view.y2 - b0.y1 - ref.y;
  if (vx1 > vx2 || vy1 > vy2) return null;
  const [cx, cy] = ref.colStep, [rx, ry] = ref.rowStep;
  const det = cx * ry - cy * rx;
  const clampR = (r) => {
    r.i0 = Math.max(0, r.i0); r.j0 = Math.max(0, r.j0);
    r.i1 = Math.min(ref.cols - 1, r.i1); r.j1 = Math.min(ref.rows - 1, r.j1);
    return r.i0 > r.i1 || r.j0 > r.j1 ? null : r;
  };
  if (Math.abs(det) > 1e-9) {
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [px, py] of [[vx1, vy1], [vx2, vy1], [vx2, vy2], [vx1, vy2]]) {
      const i = (px * ry - py * rx) / det, j = (cx * py - cy * px) / det;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    return clampR({ i0: Math.ceil(i0 - 1e-9), i1: Math.floor(i1 + 1e-9), j0: Math.ceil(j0 - 1e-9), j1: Math.floor(j1 + 1e-9) });
  }
  // 1D array (rows or cols = 1) or degenerate lattice: project on the non-zero step
  const step = ref.cols > 1 ? ref.colStep : ref.rowStep, n = Math.max(ref.cols, ref.rows);
  const L2 = step[0] * step[0] + step[1] * step[1];
  if (L2 < 1e-18) return all;
  let k0 = Infinity, k1 = -Infinity;
  for (const [px, py] of [[vx1, vy1], [vx2, vy1], [vx2, vy2], [vx1, vy2]]) {
    const k = (px * step[0] + py * step[1]) / L2;
    k0 = Math.min(k0, k); k1 = Math.max(k1, k);
  }
  k0 = Math.max(0, Math.ceil(k0 - 1e-9)); k1 = Math.min(n - 1, Math.floor(k1 + 1e-9));
  if (k0 > k1) return null;
  return ref.cols > 1 ? clampR({ i0: k0, i1: k1, j0: 0, j1: 0 }) : clampR({ i0: 0, i1: 0, j0: k0, j1: k1 });
}

// Number of shapes in the fully flattened cell, and its total exposed area (nm²) per layer.
export function flatStats(lib, name, memo = new Map()) {
  if (memo.has(name)) return memo.get(name);
  memo.set(name, { shapes: 0, area: {} });
  const c = lib.cells[name], out = { shapes: 0, area: {} };
  if (c) {
    for (const s of c.shapes) { out.shapes++; out.area[s.layer] = (out.area[s.layer] || 0) + area(s); }
    for (const r of c.refs) {
      const sub = flatStats(lib, r.cell, memo), n = r.cols * r.rows, m2 = r.mag * r.mag;
      out.shapes += n * sub.shapes;
      for (const [k, a] of Object.entries(sub.area)) out.area[k] = (out.area[k] || 0) + n * m2 * a;
    }
  }
  memo.set(name, out);
  return out;
}

// Which reference of `cell` covers point (x, y)? Checks the element(s) near the point, and the
// child's real geometry, so clicking a gap inside an array does not select it.
export function hitRef(lib, cell, x, y, tolNm = 0, cache = new Map()) {
  const c = lib.cells[cell];
  for (let k = c.refs.length - 1; k >= 0; k--) {
    const ref = c.refs[k];
    const view = { x1: x - tolNm, y1: y - tolNm, x2: x + tolNm, y2: y + tolNm };
    const rg = visibleRange(lib, ref, view, cache);
    if (!rg) continue;
    for (let i = rg.i0; i <= rg.i1; i++) for (let j = rg.j0; j <= rg.j1; j++) {
      const T = elementTransform(ref, i, j);
      const [lx, ly] = apply(invert(T), x, y);
      if (pointInCell(lib, ref.cell, lx, ly, tolNm / Math.max(ref.mag, 1e-9), cache)) return { ref, i, j };
    }
  }
  return null;
}

function pointInCell(lib, name, x, y, tol, cache, depth = 0) {
  if (depth > 32) return false;
  const c = lib.cells[name];
  const bb = cellBBox(lib, name, cache);
  if (!bb || x < bb.x1 - tol || x > bb.x2 + tol || y < bb.y1 - tol || y > bb.y2 + tol) return false;
  for (const s of c.shapes) {
    const b = bboxWorld(s);
    if (x < b.x1 - tol || x > b.x2 + tol || y < b.y1 - tol || y > b.y2 + tol) continue;
    return true;   // bbox-level is enough to pick an instance
  }
  for (const r of c.refs) {
    const rg = visibleRange(lib, r, { x1: x - tol, y1: y - tol, x2: x + tol, y2: y + tol }, cache);
    if (!rg) continue;
    for (let i = rg.i0; i <= rg.i1; i++) for (let j = rg.j0; j <= rg.j1; j++) {
      const [lx, ly] = apply(invert(elementTransform(r, i, j)), x, y);
      if (pointInCell(lib, r.cell, lx, ly, tol / Math.max(r.mag, 1e-9), cache, depth + 1)) return true;
    }
  }
  return false;
}

// ---- edits ----

// Move shapes (by id) of `parent` into a new cell, placed back as an array.
// The new cell's origin is the lower-left corner of the selection's bounding box, rounded to nm.
export function makeArrayCell(lib, parent, shapeIds, { cols = 1, rows = 1, pitchX = 0, pitchY = 0, name = 'ARRAY' } = {}) {
  const pc = lib.cells[parent];
  const moving = pc.shapes.filter((s) => shapeIds.has(s.id));
  if (!moving.length) throw new Error('nothing to put in the array');
  let bb = null;
  for (const s of moving) bb = unionBBox(bb, bboxWorld(s));
  const ox = Math.round(bb.x1), oy = Math.round(bb.y1);
  const cname = uniqueCellName(lib, name);
  const cell = makeCell(cname);
  cell.shapes = moving.map((s) => ({ ...transformShape(s, { x: -ox, y: -oy }), id: s.id }));
  lib.cells[cname] = cell;
  pc.shapes = pc.shapes.filter((s) => !shapeIds.has(s.id));
  const ref = makeRef(cname, { x: ox, y: oy, cols, rows, colStep: [pitchX, 0], rowStep: [0, pitchY] });
  pc.refs.push(ref);
  return { cell: cname, ref };
}

// Replace a reference by copies of its cell's contents (one level). Fused groups get fresh
// ids per element so elements stay independent objects.
export function explodeRef(lib, parent, refId, { maxElements = 20000 } = {}) {
  const pc = lib.cells[parent];
  const ref = pc.refs.find((r) => r.id === refId);
  if (!ref) return null;
  const n = ref.cols * ref.rows;
  if (n > maxElements) throw new Error(`array has ${n} elements; exploding more than ${maxElements} is refused`);
  const child = lib.cells[ref.cell];
  const newShapes = [], newRefs = [];
  for (let i = 0; i < ref.cols; i++) for (let j = 0; j < ref.rows; j++) {
    const ox = ref.x + i * ref.colStep[0] + j * ref.rowStep[0], oy = ref.y + i * ref.colStep[1] + j * ref.rowStep[1];
    const place = { x: ox, y: oy, rot: ref.rot, mag: ref.mag, mirrorX: ref.mirrorX };
    const gmap = new Map();
    for (const s of child.shapes) {
      const c = transformShape(s, place);
      c.id = uid('x');
      const k = ref.doseScale ?? 1;                       // a dose-ramp step becomes the shapes' own dose
      if (k !== 1) { c.dose = (c.dose || 0) * k; if (c.writeDose != null) c.writeDose *= k; }
      if (s.groupId) { if (!gmap.has(s.groupId)) gmap.set(s.groupId, uid('g')); c.groupId = gmap.get(s.groupId); }
      newShapes.push(c);
    }
    for (const r of child.refs) {
      // compose placements: child ref inside this element
      const L = gdsLinear(place);
      const [nx, ny] = apply({ ...L, e: ox, f: oy }, r.x, r.y);
      const step = (v) => { const [a, b] = apply(L, v[0], v[1]); return [a, b]; };
      newRefs.push(makeRef(r.cell, {
        x: nx, y: ny, rot: (ref.mirrorX ? -r.rot : r.rot) + ref.rot, mag: r.mag * ref.mag,
        mirrorX: r.mirrorX !== ref.mirrorX, cols: r.cols, rows: r.rows, colStep: step(r.colStep), rowStep: step(r.rowStep),
      }));
      const k = (ref.doseScale ?? 1) * (r.doseScale ?? 1);
      if (k !== 1) newRefs[newRefs.length - 1].doseScale = k;
    }
  }
  pc.refs = pc.refs.filter((r) => r.id !== refId);
  pc.shapes.push(...newShapes);
  pc.refs.push(...newRefs);
  return { shapes: newShapes, refs: newRefs };
}

export function placeCell(lib, parent, child, x, y) {
  if (references(lib, child, parent)) throw new Error(`placing ${child} in ${parent} would make the hierarchy recursive`);
  const ref = makeRef(child, { x: Math.round(x), y: Math.round(y) });
  lib.cells[parent].refs.push(ref);
  return ref;
}

export function renameCell(lib, from, to) {
  if (!lib.cells[from]) throw new Error(`no cell ${from}`);
  if (lib.cells[to]) throw new Error(`a cell named ${to} already exists`);
  const c = lib.cells[from];
  delete lib.cells[from];
  c.name = to;
  lib.cells[to] = c;
  for (const cell of Object.values(lib.cells)) for (const r of cell.refs) if (r.cell === from) r.cell = to;
  if (lib.top === from) lib.top = to;
}

export function deleteCell(lib, name) {
  if (name === lib.top) throw new Error('the top cell cannot be deleted');
  const users = parentsOf(lib, name);
  if (users.length) throw new Error(`${name} is still placed in ${users.join(', ')}`);
  delete lib.cells[name];
}

// Polygons of the flattened cell, for physics and export (later stages). Calls fn(layer,
// worldPts, shape, transform) for every shape instance; arrays are walked element by element.
export function forEachFlatPolygon(lib, name, fn, { tol = 1, T = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, depth = 0 } = {}) {
  if (depth > 32) throw new Error('hierarchy deeper than 32 levels');
  const c = lib.cells[name];
  for (const s of c.shapes) fn(s.layer, outlineWorld(s, tol).map(([x, y]) => apply(T, x, y)), s, T);
  for (const r of c.refs) for (let i = 0; i < r.cols; i++) for (let j = 0; j < r.rows; j++) {
    forEachFlatPolygon(lib, r.cell, fn, { tol, T: compose(T, elementTransform(r, i, j)), depth: depth + 1 });
  }
}

export function cloneLibrary(lib) {
  return typeof structuredClone === 'function' ? structuredClone(lib) : JSON.parse(JSON.stringify(lib));
}
