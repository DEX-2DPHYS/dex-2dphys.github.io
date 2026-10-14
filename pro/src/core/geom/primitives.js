// Parametric shapes (CleWin's standard shapes and a few more): regular N-gons, ellipses, rings,
// arcs (annular sectors), crosses and rounded rectangles.
//
// They are stored as ordinary polygons (kind 'poly', `pts` local to the centre), so exposure,
// correction, fracturing and GDS export treat them like any polygon. The parameters ride along in
// `gen`, which lets the editor show the right handles and dialog fields and regenerate the outline
// exactly. A shape whose corners are edited by hand drops its `gen` and becomes a plain polygon.
//
//   gen = { type: 'ngon',    n, r, phase }        r = circumradius, phase = angle of vertex 0 (deg)
//         { type: 'ellipse', rx, ry }
//         { type: 'arc',     ro, ri, a0, a1 }     annular sector a0 → a1 (deg, anticlockwise); ri 0 = pie slice
//         { type: 'ring',    ro, ri, part }       a donut: two half-rings (part 0 = upper, 1 = lower) fused into one object
//         { type: 'cross',   hw, hh, aw }         a plus sign: half width, half height, full arm width
//         { type: 'rrect',   hw, hh, cr }         rectangle with rounded corners of radius cr
//
// Lengths in nm, angles in degrees, y up. A ring has a hole, and the model keeps every polygon
// hole-free, so it is two pieces in a fused group ('gb…' ids: a body, drawn as one outline).

import { uid, circleSegments } from './shapes.js';

const D2R = Math.PI / 180;
const MIN = 0.5;   // nm

export const GEN_LABEL = {
  ngon: 'regular polygon', ellipse: 'ellipse', arc: 'arc', ring: 'ring', cross: 'cross', rrect: 'rounded rectangle',
};
export const NGON_NAME = { 3: 'triangle', 4: 'square', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon', 10: 'decagon', 12: 'dodecagon' };

// A regular polygon with a flat side at the bottom (the usual drawing; for a hexagon: flat top too).
export const flatPhase = (n) => -90 + 180 / n;

// segments of an arc of radius r over `deg` degrees, chord error ≤ tol nm
const arcSegs = (r, deg, tol) => Math.max(2, Math.ceil((circleSegments(Math.max(r, tol), tol) * Math.abs(deg)) / 360));

function arcPts(r, a0, a1, tol, out) {
  const n = arcSegs(r, a1 - a0, tol);
  for (let i = 0; i <= n; i++) { const t = (a0 + ((a1 - a0) * i) / n) * D2R; out.push([r * Math.cos(t), r * Math.sin(t)]); }
  return out;
}

// The outline(s) of a parametric shape, local to its centre: a list of hole-free polygons.
export function genPolygons(g, tol = 1) {
  switch (g.type) {
    case 'ngon': {
      const out = [];
      for (let k = 0; k < g.n; k++) { const t = (g.phase + (360 * k) / g.n) * D2R; out.push([g.r * Math.cos(t), g.r * Math.sin(t)]); }
      return [out];
    }
    case 'ellipse': {
      const n = circleSegments(Math.max(g.rx, g.ry), tol), out = [];
      for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; out.push([g.rx * Math.cos(t), g.ry * Math.sin(t)]); }
      return [out];
    }
    case 'arc': {
      const a0 = g.a0, a1 = g.a1 > g.a0 ? g.a1 : g.a1 + 360;
      if (a1 - a0 >= 360 - 1e-9) return genPolygons({ type: 'ring', ro: g.ro, ri: g.ri }, tol);   // a full turn is a ring
      const out = arcPts(g.ro, a0, a1, tol, []);
      if (g.ri > 0) { const inner = arcPts(g.ri, a0, a1, tol, []); for (let i = inner.length - 1; i >= 0; i--) out.push(inner[i]); }
      else out.push([0, 0]);
      return [out];
    }
    case 'ring': {
      // two half-rings; a solid disc when ri is 0
      const half = (a0) => { const out = arcPts(g.ro, a0, a0 + 180, tol, []); if (g.ri > 0) { const inn = arcPts(g.ri, a0, a0 + 180, tol, []); for (let i = inn.length - 1; i >= 0; i--) out.push(inn[i]); } return out; };
      return g.part == null ? [half(0), half(180)] : [half(g.part ? 180 : 0)];
    }
    case 'cross': {
      const { hw, hh } = g, a = Math.min(g.aw / 2, hw, hh);
      return [[[-a, -hh], [a, -hh], [a, -a], [hw, -a], [hw, a], [a, a], [a, hh], [-a, hh], [-a, a], [-hw, a], [-hw, -a], [-a, -a]]];
    }
    case 'rrect': {
      const { hw, hh } = g, r = Math.max(0, Math.min(g.cr, hw, hh)), out = [];
      if (r <= 0) return [[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]];
      arcPts(r, -90, 0, tol, []).forEach(([x, y]) => out.push([hw - r + x, -hh + r + y]));
      arcPts(r, 0, 90, tol, []).forEach(([x, y]) => out.push([hw - r + x, hh - r + y]));
      arcPts(r, 90, 180, tol, []).forEach(([x, y]) => out.push([-hw + r + x, hh - r + y]));
      arcPts(r, 180, 270, tol, []).forEach(([x, y]) => out.push([-hw + r + x, -hh + r + y]));
      return [out.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-9)];
    }
    default: throw new Error(`unknown shape type ${g.type}`);
  }
}

// keep a parameter set physical (no zero or negative sizes, inner inside outer)
export function normGen(g) {
  const o = { ...g };
  if (o.type === 'ngon') { o.n = Math.max(3, Math.min(360, Math.round(o.n || 6))); o.r = Math.max(MIN, o.r); o.phase = +o.phase || 0; }
  else if (o.type === 'ellipse') { o.rx = Math.max(MIN, o.rx); o.ry = Math.max(MIN, o.ry); }
  else if (o.type === 'arc' || o.type === 'ring') {
    o.ro = Math.max(MIN, o.ro); o.ri = Math.max(0, Math.min(o.ri || 0, o.ro - MIN));
    if (o.type === 'arc') { o.a0 = +o.a0 || 0; o.a1 = +o.a1; if (!Number.isFinite(o.a1)) o.a1 = o.a0 + 90; }
  } else if (o.type === 'cross') { o.hw = Math.max(MIN, o.hw); o.hh = Math.max(MIN, o.hh); o.aw = Math.max(2 * MIN, Math.min(o.aw, 2 * o.hw, 2 * o.hh)); }
  else if (o.type === 'rrect') { o.hw = Math.max(MIN, o.hw); o.hh = Math.max(MIN, o.hh); o.cr = Math.max(0, Math.min(o.cr || 0, o.hw, o.hh)); }
  return o;
}

// Shapes for a parametric shape at (cx, cy): one polygon, or (a ring) two half-rings in a fused body.
export function makeGenShapes(gen, cx, cy, dose, layer = '1/0', rot = 0) {
  const g = normGen(gen);
  if (g.type === 'ring' || (g.type === 'arc' && arcSpan(g) >= 360 - 1e-9)) {
    const rg = { type: 'ring', ro: g.ro, ri: g.ri }, gid = uid('gb');
    if (rg.ri <= 0) return [{ id: uid('p'), kind: 'poly', layer, cx, cy, rot, pts: genPolygons({ type: 'ellipse', rx: rg.ro, ry: rg.ro })[0], gen: { type: 'ellipse', rx: rg.ro, ry: rg.ro }, dose, writeDose: null, groupId: null }];
    return [0, 1].map((part) => ({ id: uid('p'), kind: 'poly', layer, cx, cy, rot, pts: genPolygons({ ...rg, part })[0], gen: { ...rg, part }, dose, writeDose: null, groupId: gid }));
  }
  return [{ id: uid('p'), kind: 'poly', layer, cx, cy, rot, pts: genPolygons(g)[0], gen: g, dose, writeDose: null, groupId: null }];
}
export const arcSpan = (g) => { const d = g.a1 - g.a0; return d > 0 ? d : d + 360; };

// Regenerate a shape's outline from its parameters (after an edit of `gen`).
export function regen(s) {
  if (!s.gen) return s;
  s.gen = normGen(s.gen);
  s.pts = genPolygons(s.gen)[0];
  return s;
}

// ---- handles: a few meaningful ones instead of every corner of a 300-point ellipse ----
// Each is [x, y] local; applyGenHandle(s, i, [x, y]) sets the parameter that handle stands for.
export function genHandles(g) {
  switch (g.type) {
    case 'ngon': { const t = g.phase * D2R; return [[g.r * Math.cos(t), g.r * Math.sin(t)]]; }
    case 'ellipse': return [[g.rx, 0], [0, g.ry], [-g.rx, 0], [0, -g.ry]];
    case 'arc': {
      const am = ((g.a0 + g.a0 + arcSpan(g)) / 2) * D2R, a0 = g.a0 * D2R, a1 = (g.a0 + arcSpan(g)) * D2R;
      const h = [[g.ro * Math.cos(a0), g.ro * Math.sin(a0)], [g.ro * Math.cos(a1), g.ro * Math.sin(a1)], [g.ro * Math.cos(am), g.ro * Math.sin(am)]];
      if (g.ri > 0) h.push([g.ri * Math.cos(am), g.ri * Math.sin(am)]);
      return h;
    }
    case 'ring': {
      if (g.part) return [];   // the upper half carries the handles (both halves are always selected together)
      const s = Math.SQRT1_2; return [[g.ro * s, g.ro * s], [g.ri * s, g.ri * s]];
    }
    case 'cross': return [[g.hw, g.hh], [g.aw / 2, g.hh]];
    case 'rrect': return [[g.hw, g.hh], [g.hw - g.cr, g.hh]];
    default: return [];
  }
}
export function applyGenHandle(s, i, [px, py], snapAngle = false) {
  const g = { ...s.gen }, rr = Math.hypot(px, py);
  let ang = Math.atan2(py, px) / D2R;
  if (snapAngle) ang = Math.round(ang / 15) * 15;
  switch (g.type) {
    case 'ngon': g.r = rr; break;
    case 'ellipse': if (i % 2 === 0) g.rx = Math.abs(px); else g.ry = Math.abs(py); break;
    case 'arc': {
      const span = arcSpan(g);
      if (i === 0) { const end = g.a0 + span; g.a0 = ang; g.a1 = end; }
      else if (i === 1) g.a1 = ang;
      else if (i === 2) g.ro = Math.max(rr, (g.ri || 0) + MIN);
      else g.ri = Math.min(rr, g.ro - MIN);
      break;
    }
    case 'ring': if (i === 0) g.ro = Math.max(rr, g.ri + MIN); else g.ri = Math.min(rr, g.ro - MIN); break;
    case 'cross': if (i === 0) { g.hw = Math.abs(px); g.hh = Math.abs(py); } else g.aw = 2 * Math.abs(px); break;
    case 'rrect': if (i === 0) { g.hw = Math.abs(px); g.hh = Math.abs(py); } else g.cr = g.hw - Math.abs(px); break;
    default: break;
  }
  s.gen = normGen(g);
  s.pts = genPolygons(s.gen)[0];
  return s;
}

// Mirror the parameters with the outline: axis 'h' maps x → −x, 'v' maps y → −y (local).
export function mirrorGen(g, axis) {
  const o = { ...g };
  if (o.type === 'ngon') o.phase = axis === 'h' ? 180 - o.phase : -o.phase;
  else if (o.type === 'arc') { const a0 = o.a0, a1 = o.a0 + arcSpan(o); if (axis === 'h') { o.a0 = 180 - a1; o.a1 = 180 - a0; } else { o.a0 = -a1; o.a1 = -a0; } }
  else if (o.type === 'ring' && axis === 'v') o.part = o.part ? 0 : 1;
  return o;
}
export function scaleGen(g, k) {
  const o = { ...g };
  for (const key of ['r', 'rx', 'ry', 'ro', 'ri', 'hw', 'hh', 'aw', 'cr']) if (o[key] != null) o[key] *= k;
  return o;
}

const um = (nm, d = 3) => +(nm / 1000).toFixed(d);
export function describeGen(g) {
  switch (g.type) {
    case 'ngon': { const name = NGON_NAME[g.n] || `${g.n}-gon`; return `${name}, side ${um(2 * g.r * Math.sin(Math.PI / g.n))} µm (circumradius ${um(g.r)} µm)`; }
    case 'ellipse': return g.rx === g.ry ? `circle Ø ${um(2 * g.rx)} µm (polygon)` : `ellipse ${um(2 * g.rx)} × ${um(2 * g.ry)} µm`;
    case 'arc': return `arc ${um(2 * g.ro)} µm outer Ø${g.ri > 0 ? `, ${um(2 * g.ri)} µm inner Ø` : ' (pie slice)'}, ${(+g.a0).toFixed(1)}° → ${(g.a0 + arcSpan(g)).toFixed(1)}°`;
    case 'ring': return `ring ${um(2 * g.ro)} µm outer Ø, ${um(2 * g.ri)} µm inner Ø (width ${um(g.ro - g.ri)} µm)`;
    case 'cross': return `cross ${um(2 * g.hw)} × ${um(2 * g.hh)} µm, arms ${um(g.aw)} µm wide`;
    case 'rrect': return `rounded rectangle ${um(2 * g.hw)} × ${um(2 * g.hh)} µm, corner radius ${um(g.cr)} µm`;
    default: return 'shape';
  }
}

// Default parameters for the drawing tool, from a box (half sizes) or a radius.
export function genFromDrag(type, { r = 0, hw = 0, hh = 0 }, opts = {}) {
  switch (type) {
    case 'ngon': { const n = opts.sides || 6; return { type, n, r, phase: opts.pointy ? 90 : flatPhase(n) }; }
    case 'ellipse': return { type, rx: hw, ry: hh };
    case 'ring': return { type, ro: r, ri: r * (opts.innerFrac ?? 0.5) };
    case 'arc': return { type, ro: r, ri: r * (opts.innerFrac ?? 0.5), a0: opts.a0 ?? 0, a1: opts.a1 ?? 90 };
    case 'cross': return { type, hw, hh, aw: Math.min(hw, hh) * 2 * (opts.armFrac ?? 0.3) };
    case 'rrect': return { type, hw, hh, cr: Math.min(hw, hh) * (opts.cornerFrac ?? 0.25) };
    default: throw new Error(`unknown shape type ${type}`);
  }
}
// which tool shapes are drawn from the centre outwards (radius) and which corner to corner (box)
export const DRAWN_FROM_CENTRE = new Set(['ngon', 'ring', 'arc']);
