// Arrays recovered from a flat layout (2026-10-05).
//
// A GDS exported flat carries every element of an array as its own shape: ChipV11 has 318 377 shapes
// but only 21 distinct outlines, 240 000 of them one outline on a 1.5 × 1.0 µm grid. The correction
// treats a real array as one fractured element per context class, so turning the grids back into
// arrays is what lets it reuse its work. The design library is not changed; the result is a new
// library with the same polygons, for the correction to run on.
//
// Per (layer, dose, outline up to translation): the most common gap between neighbours along x and
// along y is the pitch; points are put on that lattice (one lattice per residue class, so two grids
// with the same pitch but different offsets stay separate); occupied lattice cells are covered by
// rectangles (runs along x, merged across rows when they span the same columns); a rectangle with
// at least `minElems` elements becomes an array reference to a one-shape cell, everything else
// stays a flat shape. Shapes in fused groups (more than one shape per group) are left alone.

import { outlineWorld, cloneShape, groupKeyOf } from './shapes.js';
import { makeCell, makeRef } from './library.js';

const Q = 16;                                   // outline key resolution: 1/16 nm

function keyOf(s) {
  const p = outlineWorld(s);
  let x0 = Infinity, y0 = Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; }
  let k = `${s.layer}|${s.dose ?? ''}|${s.kind}`;
  for (const [x, y] of p) k += `;${Math.round((x - x0) * Q)},${Math.round((y - y0) * Q)}`;
  return { k, x0, y0 };
}

const modeOf = (vals) => {
  const m = new Map();
  for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
  let best = 0, n = 0;
  for (const [v, c] of m) if (c > n || (c === n && v < best)) { best = v; n = c; }
  return { v: best, n };
};

// Pitch along one axis: the most common positive gap between consecutive points sharing the other coordinate.
function pitchOf(pts, along) {
  const other = 1 - along, byLine = new Map(), gaps = [];
  for (const p of pts) { const k = Math.round(p[other] * Q); let a = byLine.get(k); if (!a) byLine.set(k, (a = [])); a.push(p[along]); }
  for (const a of byLine.values()) { a.sort((x, y) => x - y); for (let i = 1; i < a.length; i++) { const g = Math.round((a[i] - a[i - 1]) * Q) / Q; if (g > 0) gaps.push(g); } }
  return gaps.length ? modeOf(gaps).v : 0;
}

// Cover occupied lattice cells (Set of "i,j") with rectangles: runs along i, merged across consecutive j.
function rectangles(cells) {
  const rows = new Map();
  for (const c of cells) { const [i, j] = c.split(',').map(Number); let r = rows.get(j); if (!r) rows.set(j, (r = [])); r.push(i); }
  const runsByRow = new Map();
  for (const [j, is] of rows) {
    is.sort((a, b) => a - b);
    const runs = [];
    for (let s = 0; s < is.length;) { let e = s; while (e + 1 < is.length && is[e + 1] === is[e] + 1) e++; runs.push([is[s], is[e]]); s = e + 1; }
    runsByRow.set(j, runs);
  }
  const out = [], open = new Map();               // "i0,i1" → rect being grown
  for (const j of [...runsByRow.keys()].sort((a, b) => a - b)) {
    const next = new Map();
    for (const [i0, i1] of runsByRow.get(j)) {
      const k = `${i0},${i1}`, r = open.get(k);
      if (r && r.j1 === j - 1) { r.j1 = j; next.set(k, r); open.delete(k); }
      else next.set(k, { i0, i1, j0: j, j1: j });
    }
    for (const r of open.values()) out.push(r);
    open.clear();
    for (const [k, r] of next) open.set(k, r);
  }
  for (const r of open.values()) out.push(r);
  return out;
}

// → { library, stats: { shapesIn, shapesFlat, arrays, elements, cells, ms } }. `cell`: the cell to scan (default top).
export function recoverArrays(lib, { minElems = 16, cell = lib.top, tolNm = 0.5 } = {}) {
  const t0 = Date.now();
  const src = lib.cells[cell];
  const groupSize = new Map();
  for (const s of src.shapes) { const g = groupKeyOf(s); groupSize.set(g, (groupSize.get(g) || 0) + 1); }
  const groups = new Map();                       // key → [{s, x0, y0}]
  const flat = [];
  for (const s of src.shapes) {
    if (groupSize.get(groupKeyOf(s)) > 1) { flat.push(s); continue; }
    const { k, x0, y0 } = keyOf(s);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push({ s, x0, y0 });
  }
  const cells = { ...lib.cells };
  const newCell = { ...src, shapes: [], refs: [...src.refs] };
  cells[cell] = newCell;
  let arrays = 0, elements = 0, nCells = 0;
  const usedNames = new Set(Object.keys(lib.cells));
  for (const g of groups.values()) {
    if (g.length < minElems) { for (const e of g) flat.push(e.s); continue; }
    const pts = g.map((e) => [e.x0, e.y0]);
    const px = pitchOf(pts, 0), py = pitchOf(pts, 1);
    if (!(px > 0) && !(py > 0)) { for (const e of g) flat.push(e.s); continue; }
    const sx = px > 0 ? px : 1e12, sy = py > 0 ? py : 1e12;
    // lattices: one per residue class of the origin modulo the pitch
    const lattices = new Map();
    for (const e of g) {
      const rx = ((e.x0 % sx) + sx) % sx, ry = ((e.y0 % sy) + sy) % sy;
      const k = `${Math.round(rx * Q)},${Math.round(ry * Q)}`;
      let L = lattices.get(k);
      if (!L) lattices.set(k, (L = { rx, ry, at: new Map() }));
      const i = Math.round((e.x0 - rx) / sx), j = Math.round((e.y0 - ry) / sy);
      if (Math.abs(e.x0 - rx - i * sx) > tolNm || Math.abs(e.y0 - ry - j * sy) > tolNm) { flat.push(e.s); continue; }
      const ck = `${i},${j}`;
      if (L.at.has(ck)) { flat.push(e.s); continue; }   // a duplicate on the same site stays flat (it doubles dose there)
      L.at.set(ck, e);
    }
    const rep = g[0];
    let cname = null;
    for (const L of lattices.values()) {
      for (const r of rectangles(new Set(L.at.keys()))) {
        const cols = r.i1 - r.i0 + 1, rows = r.j1 - r.j0 + 1;
        if (cols * rows < minElems) { for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) flat.push(L.at.get(`${i},${j}`).s); continue; }
        if (!cname) {
          let base = `RA_${nCells}`, n = 0; while (usedNames.has(base)) base = `RA_${nCells}_${++n}`;
          cname = base; usedNames.add(cname);
          const c = makeCell(cname), sh = cloneShape(rep.s);
          sh.cx -= rep.x0; sh.cy -= rep.y0;            // element origin = the outline's lower-left corner
          c.shapes.push(sh); cells[cname] = c; nCells++;
        }
        newCell.refs.push(makeRef(cname, { x: L.rx + r.i0 * sx, y: L.ry + r.j0 * sy, cols, rows, colStep: [px > 0 ? sx : 0, 0], rowStep: [0, py > 0 ? sy : 0] }));
        arrays++; elements += cols * rows;
      }
    }
  }
  newCell.shapes = flat;
  return { library: { ...lib, cells }, stats: { shapesIn: src.shapes.length, shapesFlat: flat.length, arrays, elements, cells: nCells, ms: Date.now() - t0 } };
}
