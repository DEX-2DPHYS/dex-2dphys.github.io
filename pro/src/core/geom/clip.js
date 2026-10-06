// Polygon booleans via Clipper 1 (Angus Johnson, Boost licence; vendored in src/vendor).
// Clipper works on integers: coordinates are scaled by SCALE (sub-nm resolution) on the way in.

import ClipperLib from '../../vendor/clipper.cjs';

const SCALE = 16;

const toPath = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromPath = (p) => p.map((q) => [q.X / SCALE, q.Y / SCALE]);

// Union of polygons ([[x,y],…] each, any orientation). Returns outer boundaries counter-clockwise
// and holes clockwise, so signed-area sums give the union area.
export function unionPolygons(polys) {
  if (polys.length === 1) return [orientCCW(polys[0])];
  const c = new ClipperLib.Clipper();
  c.AddPaths(polys.map(toPath), ClipperLib.PolyType.ptSubject, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  // Clipper (y up) returns outers with positive area = counter-clockwise, holes negative
  return out.map(fromPath);
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

export const orientCCW = (pts) => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);

// ---- for fracturing -------------------------------------------------------------
const run = (type, subject, clip) => {
  const c = new ClipperLib.Clipper();
  if (subject.length) c.AddPaths(subject.map(toPath), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip.map(toPath), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map(fromPath).filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-6);
};
// subject ∩ clip and subject − clip (each a list of polygons; holes CW in, CW out)
export const intersectPolygons = (subject, clip) => run(ClipperLib.ClipType.ctIntersection, subject, clip);
export const differencePolygons = (subject, clip) => run(ClipperLib.ClipType.ctDifference, subject, clip);
// Offset by d (nm; negative = inset), sharp (mitred) corners up to miterLimit × |d|.
export function offsetPolygons(polys, d, miterLimit = 50) {
  const co = new ClipperLib.ClipperOffset(miterLimit, 0.25 * SCALE);
  co.AddPaths(polys.map(toPath), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, d * SCALE);
  return out.map(fromPath).filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-6);
}

// ---- self-crossing outlines ------------------------------------------------------
// true when no two edges of the closed outline meet except neighbours at their shared vertex. A ring
// drawn as one boundary with overlapping ends, a figure eight, or an edge doubling back all fail.
// Edges are bucketed on a grid, so large outlines stay cheap.
export function isSimplePolygon(pts) {
  const n = pts.length;
  if (n < 4) return true;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pts) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  const g = Math.max(1, Math.ceil(Math.sqrt(n))), cw = (x2 - x1) / g || 1, ch = (y2 - y1) / g || 1;
  const cell = new Map();
  const cx = (x) => Math.min(g - 1, Math.max(0, Math.floor((x - x1) / cw))), cy = (y) => Math.min(g - 1, Math.max(0, Math.floor((y - y1) / ch)));
  const orient = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return v > 0 ? 1 : v < 0 ? -1 : 0; };
  const onSeg = (a, b, p) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
  const meet = (i, j) => {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
    const adj = (j === i + 1) || (i === 0 && j === n - 1);
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (adj) {                               // neighbours: only a fold back along the shared line counts
      const shared = j === i + 1 ? b : a, far = j === i + 1 ? d : c, other = j === i + 1 ? a : b;
      return orient(other, shared, far) === 0 && ((far[0] - shared[0]) * (other[0] - shared[0]) + (far[1] - shared[1]) * (other[1] - shared[1])) > 0;
    }
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
  };
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], seen = new Set();
    for (let u = cx(Math.min(a[0], b[0])); u <= cx(Math.max(a[0], b[0])); u++) for (let v = cy(Math.min(a[1], b[1])); v <= cy(Math.max(a[1], b[1])); v++) {
      const k = u * 65536 + v; let list = cell.get(k);
      if (!list) cell.set(k, (list = []));
      for (const j of list) { if (seen.has(j)) continue; seen.add(j); if (meet(j, i)) return false; }
      list.push(i);
    }
  }
  return true;
}

// The area a self-crossing outline encloses, counted once (non-zero winding, as a writer exposes it):
// outer boundaries counter-clockwise, holes clockwise.
export function resolvePolygon(pts) {
  const c = new ClipperLib.Clipper();
  c.AddPaths([toPath(pts)], ClipperLib.PolyType.ptSubject, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map(fromPath).filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-6);
}

// Polygons with holes → hole-free pieces (cut through each hole), for storage as plain shapes.
export function holeFreePieces(polys, depth = 0) {
  const hole = polys.find((p) => signedArea(p) < 0);
  if (!hole || depth > 12) return polys.filter((p) => signedArea(p) > 0);
  let x1 = Infinity, x2 = -Infinity; for (const p of polys) for (const [x] of p) { if (x < x1) x1 = x; if (x > x2) x2 = x; }
  const hx = hole.reduce((a, q) => a + q[0], 0) / hole.length, B = 1e9;
  const left = intersectPolygons(polys, [[[x1 - 1, -B], [hx, -B], [hx, B], [x1 - 1, B]]]);
  const right = intersectPolygons(polys, [[[hx, -B], [x2 + 1, -B], [x2 + 1, B], [hx, B]]]);
  return [...holeFreePieces(left, depth + 1), ...holeFreePieces(right, depth + 1)];
}
