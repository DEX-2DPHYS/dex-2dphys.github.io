// Per-shape proximity correction, level (a).
//
// Every object (a single shape, or a fused group) gets one writing dose. Its control point is the
// midpoint of its longest outer edge, where the developed edge should sit; the condition is
//
//   delivered(control point) = ½ · target dose
//
// (a large isolated pad delivers exactly ½ at its edge, so this is "every edge behaves like the
// edge of a big pad"). The delivered dose uses the full PSF: exact short range, long-range grid.
// Solved by multiplicative fixed-point iteration d ← d · (½T / D).
//
// Shapes inside arrays share one dose per object of their cell; the control point sits on the
// central element of the first placement found.

import { createEngine, winding } from '../exposure/engine.js';
import { exposedLayer } from '../exposure/scene.js';
import { groupKeyOf, outlineWorld } from '../geom/shapes.js';
import { elementTransform } from '../geom/library.js';
import { compose, apply, IDENTITY } from '../geom/transform.js';
import { unionPolygons, signedArea } from '../geom/clip.js';

// One representative placement per cell reachable from top (central element of arrays).
export function representatives(lib, top) {
  const rep = new Map([[top, IDENTITY]]);
  const visit = (name, T, depth) => {
    if (depth > 32) return;
    for (const r of lib.cells[name].refs) {
      if (rep.has(r.cell)) continue;
      const Tc = compose(T, elementTransform(r, Math.floor((r.cols - 1) / 2), Math.floor((r.rows - 1) / 2)));
      rep.set(r.cell, Tc);
      visit(r.cell, Tc, depth + 1);
    }
  };
  visit(top, IDENTITY, 0);
  return rep;
}

export function correctionObjects(lib) {
  const exposed = exposedLayer(lib);
  const rep = representatives(lib, lib.top);
  const objs = [];
  for (const [cell, T] of rep) {
    const groups = new Map();
    for (const s of lib.cells[cell].shapes) {
      if (!exposed(s.layer) || !(s.dose > 0)) continue;
      const k = groupKeyOf(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    for (const [key, members] of groups) {
      const outlines = members.map((s) => outlineWorld(s, 1).map(([x, y]) => apply(T, x, y)));
      const polys = members.length > 1 ? unionPolygons(outlines) : outlines;
      objs.push({ id: key, cell, target: members[0].dose, members: members.length, polys: polys.filter((p) => members.length === 1 || signedArea(p) > 0) });
    }
  }
  // Control point: the middle of the longest edge — but only where that edge is a real edge.
  // Where another exposed object touches or overlaps it (a lead joining a pad, the arms of an
  // unfused cross) there is no developed edge, and a point there "sees" the neighbour's dose
  //. So walk the edges, longest first, and take the sample
  // nearest the middle whose outside (2 nm beyond the edge) is free of other objects.
  for (const q of objs) { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const p of q.polys) for (const [x, y] of p) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; } q.bb = { x1, y1, x2, y2 }; }
  const covered = (o, x, y) => objs.some((q) => q !== o && x >= q.bb.x1 && x <= q.bb.x2 && y >= q.bb.y1 && y <= q.bb.y2 && q.polys.some((p) => winding(p, x, y) !== 0));
  for (const o of objs) {
    const edges = [];
    for (const p of o.polys) {
      const sgn = signedArea(p) >= 0 ? 1 : -1;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L > 0) edges.push({ a, b, L, nx: (sgn * (b[1] - a[1])) / L, ny: (sgn * -(b[0] - a[0])) / L });
      }
    }
    edges.sort((e1, e2) => e2.L - e1.L);
    let pick = null;
    for (const e of edges) {
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
        const x = e.a[0] + (e.b[0] - e.a[0]) * t, y = e.a[1] + (e.b[1] - e.a[1]) * t;
        if (!covered(o, x + 2 * e.nx, y + 2 * e.ny) && !covered(o, x - 2 * e.nx, y - 2 * e.ny)) { pick = { x, y, L: e.L }; break; }
      }
      if (pick) break;
    }
    const longest = edges[0];
    // touching: another object lies against (or over) any part of the outline
    o.touching = !pick || edges.some((e) => [0.1, 0.3, 0.5, 0.7, 0.9].some((t) => covered(o, e.a[0] + (e.b[0] - e.a[0]) * t + 2 * e.nx, e.a[1] + (e.b[1] - e.a[1]) * t + 2 * e.ny)));
    if (!pick) pick = { x: (longest.a[0] + longest.b[0]) / 2, y: (longest.a[1] + longest.b[1]) / 2, L: longest.L };
    o.x = pick.x; o.y = pick.y; o.edgeLength = pick.L;
  }
  return objs.map(({ polys, bb, ...o }) => o);
}

export function correctPerShape(project, { maxIter = 40, tol = 1e-3, maxFactor = 8, onProgress } = {}) {
  const lib = project.library;
  const objs = correctionObjects(lib);
  const d = new Map(objs.map((o) => [o.id, o.target]));
  const pts = objs.map((o) => [o.x, o.y]);
  const history = [];
  let delivered = null, it = 0, err = Infinity;
  for (it = 1; it <= maxIter; it++) {
    const eng = createEngine(project, { doseOverride: (s) => (d.has(groupKeyOf(s)) ? d.get(groupKeyOf(s)) : 0) });
    delivered = eng.doseAt(pts);
    err = 0;
    objs.forEach((o, k) => {
      const want = 0.5 * o.target, got = delivered[k];
      const ratio = got > 0 ? want / got : maxFactor;
      err = Math.max(err, Math.abs(got / want - 1));
      const nd = Math.min(o.target * maxFactor, Math.max(o.target / maxFactor, d.get(o.id) * ratio));
      d.set(o.id, nd);
    });
    history.push(err);
    if (onProgress) onProgress({ iteration: it, maxError: err });
    if (err < tol) break;
  }
  // final check with the doses that will be written
  const eng = createEngine(project, { doseOverride: (s) => (d.has(groupKeyOf(s)) ? d.get(groupKeyOf(s)) : 0) });
  delivered = eng.doseAt(pts);
  return {
    doses: d,
    controls: objs.map((o, k) => ({ ...o, write: d.get(o.id), delivered: delivered[k], ratio: delivered[k] / (0.5 * o.target) })),
    iterations: Math.min(it, maxIter), converged: err < tol, history,
  };
}

// Write the solved doses into the shapes (writeDose); target doses stay as they were.
export function applyCorrection(lib, doses) {
  let n = 0;
  for (const c of Object.values(lib.cells)) for (const s of c.shapes) {
    const k = groupKeyOf(s);
    if (doses.has(k)) { s.writeDose = doses.get(k); n++; }
  }
  return n;
}

export function clearCorrection(lib) {
  let n = 0;
  for (const c of Object.values(lib.cells)) for (const s of c.shapes) if (s.writeDose != null) { s.writeDose = null; n++; }
  return n;
}
