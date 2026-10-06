// Exact duplicates in an imported layout: shapes identical in kind, geometry and position to an earlier
// shape of the same cell, both on exposed layers (any layer, the same or another). A writer exposes
// every copy, so a spot drawn n times gets n × the dose and no correction can take it back (ChipV11:
// 27 identical 10 nm squares on 18 layers at each chip corner, a bounding-box cell placed 2 × 2).
// Shapes that differ only in their dose fields, id or group are still duplicates; the first copy (in
// file order) is the one kept.
import { isExposedPurpose } from '../geom/library.js';

const NOT_GEOMETRY = new Set(['id', 'layer', 'dose', 'writeDose', 'groupId', 'doseClass']);
const geometryKey = (s) => JSON.stringify(Object.keys(s).filter((k) => !NOT_GEOMETRY.has(k) && k[0] !== '_').sort().map((k) => [k, s[k]]));

// How many times each cell appears in the flattened top cell (arrays count cols × rows).
function instanceCounts(lib) {
  const n = new Map([[lib.top, 1]]), order = [], seen = new Set();
  const visit = (name) => { if (seen.has(name) || !lib.cells[name]) return; seen.add(name); for (const r of lib.cells[name].refs || []) visit(r.cell); order.push(name); };
  visit(lib.top);
  for (let i = order.length - 1; i >= 0; i--) {             // parents before children
    const name = order[i], k = n.get(name) || 0;
    for (const r of lib.cells[name].refs || []) n.set(r.cell, (n.get(r.cell) || 0) + k * (r.cols || 1) * (r.rows || 1));
  }
  return n;
}

// → { count, crossLayer, groups: [{ cell, x, y, kind, copies, layers, placed }], remove() }
// count: shapes that would be deleted (per cell, not per placement); crossLayer: of those, how many
// sit on a layer other than the copy kept; remove() deletes them from the library in place.
export function findExactDuplicates(lib) {
  const hidden = new Set((lib.layers || []).filter((l) => !isExposedPurpose(l.purpose)).map((l) => l.key));
  const placed = instanceCounts(lib), groups = [], drop = new Map();
  let count = 0, crossLayer = 0;
  for (const [name, c] of Object.entries(lib.cells)) {
    if (!Array.isArray(c.shapes) || c.shapes.length < 2) continue;
    const first = new Map(), extra = new Map();
    c.shapes.forEach((s, i) => {
      if (hidden.has(s.layer)) return;
      const k = geometryKey(s);
      if (!first.has(k)) { first.set(k, i); return; }
      (extra.get(k) || extra.set(k, []).get(k)).push(i);
    });
    if (!extra.size) continue;
    const gone = new Set();
    for (const [k, idx] of extra) {
      const keep = c.shapes[first.get(k)], layers = [keep.layer];
      for (const i of idx) { gone.add(i); if (!layers.includes(c.shapes[i].layer)) layers.push(c.shapes[i].layer); if (c.shapes[i].layer !== keep.layer) crossLayer++; }
      count += idx.length;
      groups.push({ cell: name, x: keep.cx, y: keep.cy, kind: keep.kind, copies: idx.length + 1, layers, placed: placed.get(name) || 0 });
    }
    drop.set(name, gone);
  }
  groups.sort((a, b) => b.copies * Math.max(1, b.placed) - a.copies * Math.max(1, a.placed));
  const remove = () => { for (const [name, gone] of drop) lib.cells[name].shapes = lib.cells[name].shapes.filter((_, i) => !gone.has(i)); };
  return { count, crossLayer, groups, remove };
}
