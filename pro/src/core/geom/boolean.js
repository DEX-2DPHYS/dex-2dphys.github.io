// Boolean operations on drawn objects (CleWin's Merge, Subtract, Intersect and XOR).
//
// An object is a single shape or a fused group; its area is the union of its members. The result is
// split into connected pieces (an outline with the holes inside it); each becomes a new object: a
// plain polygon, or — when it has holes — a fused body of hole-free pieces cut through the holes
// ('gb…' group: one object, one dose, drawn as one outline). That is how the rest of the Workbench
// already stores a shape with a hole (GDS import), so exposure, correction and export need nothing new.
//
//   merge      the union of all objects
//   subtract   the base object minus all the others (base: chosen by the caller, by default the largest)
//   intersect  the area every object covers
//   xor        the area an odd number of objects covers

import ClipperLib from '../../vendor/clipper.cjs';
import { signedArea, holeFreePieces } from './clip.js';
import { outlineWorld, makePoly, uid } from './shapes.js';

const SCALE = 16;
const toPath = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromPath = (p) => p.map((q) => [q.X / SCALE, q.Y / SCALE]);
const NZ = ClipperLib.PolyFillType.pftNonZero;
const CT = { merge: ClipperLib.ClipType.ctUnion, subtract: ClipperLib.ClipType.ctDifference, intersect: ClipperLib.ClipType.ctIntersection, xor: ClipperLib.ClipType.ctXor };

function exec(type, subj, clip = []) {
  const c = new ClipperLib.Clipper();
  if (subj.length) c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, NZ, NZ);
  return out;
}

// the area of one object (its members unioned), as Clipper paths
export function objectPaths(members, tol = 1) {
  const paths = members.map((s) => toPath(outlineWorld(s, tol)));
  return paths.length > 1 ? exec(ClipperLib.ClipType.ctUnion, paths) : paths;
}

// objects: [[shape, …], …] (one list of members per object). Returns connected components
// [{ outer: [[x,y],…] CCW, holes: [[[x,y],…] CW, …] }], largest first.
export function booleanObjects(op, objects, { base = null, tol = 1 } = {}) {
  if (!(op in CT)) throw new Error(`unknown boolean operation ${op}`);
  if (objects.length < 2) throw new Error('select at least two objects');
  const paths = objects.map((m) => objectPaths(m, tol));
  let res;
  if (op === 'merge') res = exec(CT.merge, paths.flat());
  else if (op === 'subtract') {
    const b = base ?? 0;
    res = exec(CT.subtract, paths[b], paths.filter((_, i) => i !== b).flat());
  } else {
    res = paths[0];
    for (let i = 1; i < paths.length; i++) res = exec(CT[op], res, paths[i]);
  }
  return components(res);
}

// Clipper paths → connected components (outline + its holes), via a PolyTree
export function components(paths) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, NZ, NZ);
  const out = [];
  const ok = (p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-3;
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) { walk(ch); continue; }
      const outer = fromPath(ch.Contour());
      if (!ok(outer)) continue;
      const holes = [];
      for (const h of ch.Childs()) {
        const hp = fromPath(h.Contour());
        if (ok(hp)) holes.push(signedArea(hp) > 0 ? hp.slice().reverse() : hp);
        walk(h);                                     // islands inside a hole are components of their own
      }
      out.push({ outer: signedArea(outer) < 0 ? outer.slice().reverse() : outer, holes });
    }
  };
  walk(tree);
  out.sort((a, b) => Math.abs(signedArea(b.outer)) - Math.abs(signedArea(a.outer)));
  return out;
}

// Loops of any orientation (e.g. traced letter outlines) → components, an area being inside when an odd
// number of loops surround it (so a letter's counter is a hole whichever way it was traced).
export function componentsEvenOdd(loops) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(loops.map(toPath), ClipperLib.PolyType.ptSubject, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return components(out);
}

// Components → shapes on `layer` with `dose`. A component with holes becomes a fused body.
export function componentShapes(comps, { layer, dose }) {
  const shapes = [];
  for (const c of comps) {
    if (!c.holes.length) { shapes.push(polyOnGrid(c.outer, dose, layer)); continue; }
    const gid = uid('gb');
    for (const p of holeFreePieces([c.outer, ...c.holes])) {
      const s = polyOnGrid(p, dose, layer);
      s.groupId = gid;
      shapes.push(s);
    }
  }
  return shapes;
}
// A polygon whose world corners land exactly on the 1 nm grid: the corners are rounded first and the
// centre is a whole nm, so two pieces sharing a cut line keep sharing it (no 1 nm slit between them).
export function polyOnGrid(worldPts, dose, layer) {
  const w = [];
  for (const [x, y] of worldPts) {
    const q = [Math.round(x), Math.round(y)];
    if (!w.length || q[0] !== w[w.length - 1][0] || q[1] !== w[w.length - 1][1]) w.push(q);
  }
  if (w.length > 1 && w[0][0] === w[w.length - 1][0] && w[0][1] === w[w.length - 1][1]) w.pop();
  const s = makePoly(w, dose, layer);
  const cx = Math.round(s.cx), cy = Math.round(s.cy);
  s.pts = w.map(([x, y]) => [x - cx, y - cy]); s.cx = cx; s.cy = cy;
  return s;
}

// area of a component list (nm²): outers minus holes
export const componentsArea = (comps) => comps.reduce((a, c) => a + Math.abs(signedArea(c.outer)) - c.holes.reduce((h, p) => h + Math.abs(signedArea(p)), 0), 0);

// the union of a set of shapes as world polygons (outers CCW, holes CW), e.g. to draw a fused group as one outline
export function unionOutline(members, tol = 1) {
  const p = objectPaths(members, tol);
  return p.map(fromPath);
}
