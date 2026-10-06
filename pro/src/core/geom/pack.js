// A library as a few typed arrays, for handing it to a Web Worker.
//
// postMessage copies an object graph one object at a time on the main thread: a flat GDS of
// 318 000 shapes with 5.4 million [x, y] pairs took 4 s, the page frozen meanwhile. Packed, each
// cell's shapes become columns — numbers in Float64Arrays, strings as a table plus indices, the
// vertices of every polygon in one Float64Array — and the arrays are transferred, not copied. The
// worker unpacks them into the same shape objects (off the main thread).
//
// Generic over shape properties: a property that is a number (or missing) everywhere becomes a
// number column, a string (or missing) everywhere a string column, anything else stays a plain
// array. `pts` (a list of [x, y]) is packed apart. Missing properties stay missing.

const NUM = 1, STR = 2, ANY = 3, SEP = '\u0000';

function packShapes(shapes) {
  const n = shapes.length, kinds = new Map();
  for (const s of shapes) for (const k in s) {
    if (k === 'pts') continue;
    const v = s[k], t = kinds.get(k) ?? 0;
    if (v === undefined || v === null) { if (!kinds.has(k)) kinds.set(k, 0); continue; }
    const want = typeof v === 'number' ? NUM : typeof v === 'string' ? STR : ANY;
    kinds.set(k, t === 0 ? want : t === want ? t : ANY);
  }
  const cols = {}, keys = [...kinds.keys()];
  for (const k of keys) {
    const t = kinds.get(k) || ANY;
    if (t === NUM) {
      // has: 0 absent, 1 a number, 2 null
      const data = new Float64Array(n), has = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const v = shapes[i][k]; if (v === null) has[i] = 2; else if (v !== undefined) { data[i] = v; has[i] = 1; } }
      cols[k] = { t: NUM, data, has };
    } else if (t === STR) {
      // idx: -1 absent, -2 null; the table travels as one joined string (one string, not 300 000)
      const table = [], at = new Map(), idx = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const v = shapes[i][k];
        if (v === undefined) { idx[i] = -1; continue; }
        if (v === null) { idx[i] = -2; continue; }
        let j = at.get(v);
        if (j === undefined) { j = table.length; table.push(v); at.set(v, j); }
        idx[i] = j;
      }
      const joined = table.some((x) => x.includes(SEP)) ? null : table.join(SEP);
      cols[k] = joined === null ? { t: STR, table, idx } : { t: STR, joined, idx };
    } else {
      const vals = new Array(n), has = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (k in shapes[i]) { vals[i] = shapes[i][k]; has[i] = 1; }
      cols[k] = { t: ANY, vals, has };
    }
  }
  // vertices: off[i]..off[i+1] pairs; hasPts tells an absent pts from an empty one
  let nv = 0;
  for (const s of shapes) if (s.pts) nv += s.pts.length;
  const off = new Int32Array(n + 1), xy = new Float64Array(2 * nv), hasPts = new Uint8Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = shapes[i].pts;
    if (p) { hasPts[i] = 1; for (let q = 0; q < p.length; q++) { xy[2 * v] = p[q][0]; xy[2 * v + 1] = p[q][1]; v++; } }
    off[i + 1] = v;
  }
  return { n, keys, cols, off, xy, hasPts };
}

function unpackShapes(P) {
  const out = new Array(P.n);
  for (const c of Object.values(P.cols)) if (c.t === STR && !c.table) c.table = c.joined.length || c.idx.some((j) => j === 0) ? c.joined.split(SEP) : [];
  for (let i = 0; i < P.n; i++) {
    const s = {};
    for (const k of P.keys) {
      const c = P.cols[k];
      if (c.t === NUM) { const h = c.has[i]; if (h === 1) s[k] = c.data[i]; else if (h === 2) s[k] = null; }
      else if (c.t === STR) { const j = c.idx[i]; if (j >= 0) s[k] = c.table[j]; else if (j === -2) s[k] = null; }
      else if (c.has[i]) s[k] = c.vals[i];
    }
    if (P.hasPts[i]) {
      const a = P.off[i], b = P.off[i + 1], pts = new Array(b - a);
      for (let q = a; q < b; q++) pts[q - a] = [P.xy[2 * q], P.xy[2 * q + 1]];
      s.pts = pts;
    }
    out[i] = s;
  }
  return out;
}

// → {packed, transfer}: transfer lists the buffers to hand over with postMessage.
export function packLibrary(lib) {
  const transfer = [], cells = {};
  for (const [name, c] of Object.entries(lib.cells)) {
    const { shapes, __shapes, ...rest } = c;
    // a cell that is packed already is copied, so transferring the copy leaves the original intact
    const P = __shapes && !shapes ? clonePacked(__shapes) : packShapes(shapes || []);
    transfer.push(P.off.buffer, P.xy.buffer, P.hasPts.buffer);
    for (const col of Object.values(P.cols)) {
      if (col.t === NUM) transfer.push(col.data.buffer, col.has.buffer);
      else if (col.t === STR) transfer.push(col.idx.buffer);
      else transfer.push(col.has.buffer);
    }
    cells[name] = { ...rest, __shapes: P };
  }
  const { cells: _omit, ...meta } = lib;
  return { packed: { __packedLibrary: 1, meta, cells }, transfer };
}

export function unpackLibrary(p) {
  if (!p || !p.__packedLibrary) return p;          // a plain library passes through
  const cells = {};
  for (const [name, c] of Object.entries(p.cells)) {
    const { __shapes, ...rest } = c;
    cells[name] = { ...rest, shapes: unpackShapes(__shapes) };
  }
  return { ...p.meta, cells };
}

// ---------------------------------------------------------------- packed cells in a live library
// A cell may hold its shapes packed ({…, __shapes: P}, no `shapes`). The fractured correction builds
// its writing data this way: ChipV11's 1.46 M fragments took 1.1 kB each as objects, packed under
// 200 B. The exposure engine reads such cells through the functions below (scene.js, cellBBox);
// unpackCells() turns them into ordinary cells for the page.
export const isPackedCell = (c) => !!(c && c.__shapes && !c.shapes);

function tablesReady(P) {
  if (P.__ready) return;
  for (const c of Object.values(P.cols)) if (c.t === STR && !c.table) c.table = c.joined.length || c.idx.some((j) => j === 0) ? c.joined.split(SEP) : [];
  Object.defineProperty(P, '__ready', { value: true, enumerable: false, configurable: true });
}
// any column's value at row i: undefined when absent, null when null
export function valAt(P, k, i) {
  const c = P.cols[k];
  if (!c) return undefined;
  if (c.t === NUM) { const h = c.has[i]; return h === 1 ? c.data[i] : h === 2 ? null : undefined; }
  if (c.t === STR) { tablesReady(P); const j = c.idx[i]; return j >= 0 ? c.table[j] : j === -2 ? null : undefined; }
  return c.has[i] ? c.vals[i] : undefined;
}
// shape i, as a fresh object (the same object unpacking gives)
export function shapeAt(P, i) {
  tablesReady(P);
  const s = {};
  for (const k of P.keys) {
    const c = P.cols[k];
    if (c.t === NUM) { const h = c.has[i]; if (h === 1) s[k] = c.data[i]; else if (h === 2) s[k] = null; }
    else if (c.t === STR) { const j = c.idx[i]; if (j >= 0) s[k] = c.table[j]; else if (j === -2) s[k] = null; }
    else if (c.has[i]) s[k] = c.vals[i];
  }
  if (P.hasPts[i]) {
    const a = P.off[i], b = P.off[i + 1], pts = new Array(b - a);
    for (let q = a; q < b; q++) pts[q - a] = [P.xy[2 * q], P.xy[2 * q + 1]];
    s.pts = pts;
  }
  return s;
}
// set a numeric column at row i (the column must exist and be numeric)
export function setNum(P, k, i, v) { const c = P.cols[k]; c.data[i] = v; c.has[i] = 1; }
export function dropColumn(P, k) { if (!P.cols[k]) return; delete P.cols[k]; P.keys = P.keys.filter((x) => x !== k); }
// world box of shape i: an unrotated polygon straight from the columns, anything else through the shape
export function packedBBox(P, i, bboxWorld) {
  if (P.hasPts[i] && valAt(P, 'kind', i) === 'poly' && !valAt(P, 'rot', i)) {
    const cx = valAt(P, 'cx', i), cy = valAt(P, 'cy', i);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let q = P.off[i]; q < P.off[i + 1]; q++) { const x = P.xy[2 * q], y = P.xy[2 * q + 1]; if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
    return { x1: cx + x1, y1: cy + y1, x2: cx + x2, y2: cy + y2 };   // bboxWorld's arithmetic exactly
  }
  return bboxWorld(shapeAt(P, i));
}

function clonePacked(P) {
  const cols = {};
  for (const [k, c] of Object.entries(P.cols)) {
    if (c.t === NUM) cols[k] = { t: NUM, data: c.data.slice(), has: c.has.slice() };
    else if (c.t === STR) cols[k] = c.table ? { t: STR, table: c.table, idx: c.idx.slice() } : { t: STR, joined: c.joined, idx: c.idx.slice() };
    else cols[k] = { t: ANY, vals: c.vals.slice(), has: c.has.slice() };
  }
  return { n: P.n, keys: [...P.keys], cols, off: P.off.slice(), xy: P.xy.slice(), hasPts: P.hasPts.slice() };
}

// The rows `idx` (ascending) of a packed set, as a new packed set, column by column.
export function subsetPacked(P, idx) {
  tablesReady(P);
  const n = idx.length, cols = {};
  for (const k of P.keys) {
    const c = P.cols[k];
    if (c.t === NUM) { const data = new Float64Array(n), has = new Uint8Array(n); for (let q = 0; q < n; q++) { data[q] = c.data[idx[q]]; has[q] = c.has[idx[q]]; } cols[k] = { t: NUM, data, has }; }
    else if (c.t === STR) { const ix = new Int32Array(n); for (let q = 0; q < n; q++) ix[q] = c.idx[idx[q]]; cols[k] = { t: STR, table: c.table, idx: ix }; }
    else { const vals = new Array(n), has = new Uint8Array(n); for (let q = 0; q < n; q++) { vals[q] = c.vals[idx[q]]; has[q] = c.has[idx[q]]; } cols[k] = { t: ANY, vals, has }; }
  }
  let nv = 0; for (let q = 0; q < n; q++) nv += P.off[idx[q] + 1] - P.off[idx[q]];
  const off = new Int32Array(n + 1), xy = new Float64Array(2 * nv), hasPts = new Uint8Array(n);
  let v = 0;
  for (let q = 0; q < n; q++) {
    const i = idx[q];
    hasPts[q] = P.hasPts[i];
    xy.set(P.xy.subarray(2 * P.off[i], 2 * P.off[i + 1]), 2 * v); v += P.off[i + 1] - P.off[i];
    off[q + 1] = v;
  }
  return { n, keys: [...P.keys], cols, off, xy, hasPts };
}
// packLibrary's form as a live library whose cells stay packed (the engine reads them as they are)
export function livePacked(p) {
  if (!p || !p.__packedLibrary) return p;
  return { ...p.meta, cells: { ...p.cells } };
}
// A packed set with shapes (objects) appended after its rows.
export function appendShapes(P, shapes) {
  if (!shapes.length) return P;
  const all = new Array(P.n + shapes.length);
  for (let i = 0; i < P.n; i++) all[i] = shapeAt(P, i);
  for (let i = 0; i < shapes.length; i++) all[P.n + i] = shapes[i];
  return packShapes(all);
}

// Builds a packed set of polygons row by row. numKeys / strKeys are the columns besides kind
// ('poly') and pts (relative to cx, cy); a numeric value left undefined is absent in that row.
export function makePolyPacker(strKeys, numKeys) {
  const num = numKeys.map(() => []), hasN = numKeys.map(() => []);
  const str = strKeys.map(() => ({ table: [], at: new Map(), idx: [] }));
  const off = [0], xy = [];
  let n = 0;
  return {
    get n() { return n; },
    push(row, pts) {
      numKeys.forEach((k, q) => { const v = row[k]; num[q].push(v === undefined ? 0 : v); hasN[q].push(v === undefined ? 0 : 1); });
      strKeys.forEach((k, q) => { const v = row[k], S = str[q]; let j = S.at.get(v); if (j === undefined) { j = S.table.length; S.table.push(v); S.at.set(v, j); } S.idx.push(j); });
      for (const p of pts) xy.push(p[0], p[1]);
      off.push(xy.length / 2);
      return n++;
    },
    finish() {
      const cols = { kind: { t: STR, table: ['poly'], idx: new Int32Array(n) } };
      strKeys.forEach((k, q) => { cols[k] = { t: STR, table: str[q].table, idx: Int32Array.from(str[q].idx) }; });
      numKeys.forEach((k, q) => { cols[k] = { t: NUM, data: Float64Array.from(num[q]), has: Uint8Array.from(hasN[q]) }; });
      return { n, keys: Object.keys(cols), cols, off: Int32Array.from(off), xy: Float64Array.from(xy), hasPts: new Uint8Array(n).fill(1) };
    },
  };
}

// Ordinary cells for every packed cell (the page edits and draws shape objects). A packed library
// (packLibrary's form) is unpacked as unpackLibrary does.
export function unpackCells(lib) {
  if (!lib || lib.__packedLibrary) return unpackLibrary(lib);
  if (!Object.values(lib.cells).some(isPackedCell)) return lib;
  const cells = {};
  for (const [name, c] of Object.entries(lib.cells)) {
    if (!isPackedCell(c)) { cells[name] = c; continue; }
    const { __shapes, ...rest } = c;
    cells[name] = { ...rest, shapes: unpackShapes(__shapes) };
  }
  return { ...lib, cells };
}
// the buffers of every packed cell of a live library (to transfer it with postMessage)
export function packedTransfer(lib) {
  const t = [];
  for (const c of Object.values(lib.cells)) {
    if (!isPackedCell(c)) continue;
    const P = c.__shapes;
    t.push(P.off.buffer, P.xy.buffer, P.hasPts.buffer);
    for (const col of Object.values(P.cols)) { if (col.t === NUM) t.push(col.data.buffer, col.has.buffer); else if (col.t === STR) t.push(col.idx.buffer); else t.push(col.has.buffer); }
  }
  return [...new Set(t)];
}
