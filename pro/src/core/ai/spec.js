// The pattern-operation language of the AI assistant, and its deterministic engine.
//
// An AI model never writes coordinates for thousands of elements: it writes a short list of
// operations ("fill this region with 400 nm hexagons on a hexagonal lattice with 300 nm gaps"),
// and this module turns that into exact geometry — gaps solved on the real outlines, element
// counts and containment computed, arrays stored as arrays. The same operations can be typed or
// edited by hand (the assistant's "Show spec"), so the engine is also a small layout language.
//
//   { "reply": "...", "question": "", "ops": [ op, ... ] }
//
// Lengths in µm (fields end in _um), angles in degrees anticlockwise, doses in µC/cm², y up.
// See SPEC_DOC for the full description (it is what the model is given).
//
// applyOps(lib, cellName, selectionIds, ops, ctx) works on a COPY of the library and returns it with
// what was made, removed and checked; the caller decides whether to keep it (Accept) or not.

import { makeRect, makeCircle, makePoly, uid, outlineWorld, bboxWorld, roundToDbu, cloneShape, groupKeyOf, area as shapeArea, toWorld } from '../geom/shapes.js';
import { makeGenShapes, genPolygons, normGen, flatPhase, regen, scaleGen, mirrorGen } from '../geom/primitives.js';
import { booleanObjects, componentShapes, objectPaths, components, polyOnGrid, componentsArea } from '../geom/boolean.js';
import { offsetPolygons, signedArea, intersectPolygons } from '../geom/clip.js';
import { makeCell, makeRef, uniqueCellName, cloneLibrary, refBBox, cellBBox, flatStats } from '../geom/library.js';
import { unionBBox } from '../geom/transform.js';
import { makeRampArray } from '../geom/ramp.js';

const UM = 1000;
const D2R = Math.PI / 180;
const MAX_ELEMENTS = 2_000_000;          // refused above this (a typo in a pitch, usually)
const FLAT_TO_CELL = 2000;               // more flat shapes than this go into a cell of their own, placed once

export class SpecError extends Error {}

// ------------------------------------------------------------------ small helpers
const lc = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function reader(obj, path, errs) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const has = (k) => o[k] !== undefined && o[k] !== null && o[k] !== '';
  const num = (k, { min = -Infinity, max = Infinity, pos = false } = {}) => {
    if (!has(k)) return null;
    const v = typeof o[k] === 'string' ? parseFloat(o[k]) : o[k];
    if (!isNum(v)) { errs.push(`${path}.${k} must be a number`); return null; }
    if (pos && !(v > 0)) { errs.push(`${path}.${k} must be greater than 0 (got ${v})`); return null; }
    if (v < min || v > max) { errs.push(`${path}.${k} must be between ${min} and ${max} (got ${v})`); return null; }
    return v;
  };
  const len = (k, opts) => { const v = num(k, opts); return v == null ? null : v * UM; };   // µm field → nm
  const pt = (k) => {
    if (!has(k)) return null;
    const v = o[k];
    if (Array.isArray(v) && v.length === 2 && isNum(+v[0]) && isNum(+v[1])) return [+v[0] * UM, +v[1] * UM];
    if (v && typeof v === 'object' && isNum(+v.x) && isNum(+v.y)) return [+v.x * UM, +v.y * UM];
    errs.push(`${path}.${k} must be [x, y] in µm`); return null;
  };
  const str = (k) => (has(k) ? String(o[k]) : null);
  return { o, has, num, len, pt, str };
}
const rot2 = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
const bboxOfPolys = (polys) => { let b = null; for (const p of polys) for (const [x, y] of p) b = unionBBox(b, { x1: x, y1: y, x2: x, y2: y }); return b; };
const fmtUm = (nm) => (Math.abs(nm) >= 1000 ? `${+(nm / 1000).toFixed(3)} µm` : `${+nm.toFixed(1)} nm`);

// ------------------------------------------------------------------ elements
// An element is a template: its local outline (rotation included), its smallest feature, and a
// function placing copies. Kinds map onto the editor's own shapes (rectangles stay rectangles,
// circles circles, the CleWin shapes keep their parameters).
const NGON_SIDES = { triangle: 3, square_polygon: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, nonagon: 9, decagon: 10, dodecagon: 12 };
export const SHAPE_NAMES = ['rectangle', 'square', 'circle', 'ellipse', 'triangle', 'pentagon', 'hexagon', 'octagon', 'ngon', 'ring', 'arc', 'cross', 'rounded_rectangle', 'polygon', 'line', 'text'];

// An element with boolean parts — {"shape":"hexagon", …, "subtract":[{"shape":"circle","diameter_um":1}]}:
// the base element combined with its parts (each placed at its own "offset_um" from the centre), in
// the order union → subtract → intersect → xor, as in the editor. The result is a component list (an
// outline with holes), so a lattice repeats the holed shape; a hole makes each copy a body of
// hole-free pieces, exactly as a boolean in the editor would.
const BOOL_KEYS = ['union', 'subtract', 'intersect', 'xor'];
export function makeElement(spec, path, errs, ctx) {
  const parts = spec && typeof spec === 'object' ? BOOL_KEYS.filter((k) => spec[k] != null) : [];
  if (!parts.length) return makeSimpleElement(spec, path, errs, ctx);
  const baseSpec = { ...spec }; for (const k of BOOL_KEYS) delete baseSpec[k];
  delete baseSpec.rotation_deg;                                  // the rotation turns the finished shape, holes included
  const base = makeSimpleElement(baseSpec, path, errs, ctx);
  if (!base) return null;
  let current = [placeElement(base, 0, 0, 1, '0/0')];
  let minFeature = base.minFeature;
  for (const k of BOOL_KEYS) {
    if (spec[k] == null) continue;
    const list = Array.isArray(spec[k]) ? spec[k] : [spec[k]];
    const objs = [];
    list.forEach((p, i) => {
      const pp = `${path}.${k}[${i}]`, el = makeElement(p, pp, errs, ctx);
      if (!el) return;
      const off = reader(p, pp, errs).pt('offset_um') || [0, 0];
      objs.push(placeElement(el, off[0], off[1], 1, '0/0'));
      minFeature = Math.min(minFeature, el.minFeature);
    });
    if (!objs.length || errs.length) return null;
    const op = k === 'union' ? 'merge' : k;
    const comps = booleanObjects(op, [current.flat(), ...objs], { base: 0 });
    if (!comps.length) { errs.push(`${path}: after "${k}" nothing is left of the element`); return null; }
    current = [componentShapes(comps, { layer: '0/0', dose: 1 })];
  }
  const comps = components(objectPaths(current.flat()));
  // the thinnest part of a holed shape: what is left between an outline and a hole, roughly
  for (const c of comps) for (const h of c.holes) {
    let d = Infinity; for (const [x, y] of h) for (let i = 0, j = c.outer.length - 1; i < c.outer.length; j = i++) d = Math.min(d, segDist(x, y, c.outer[j][0], c.outer[j][1], c.outer[i][0], c.outer[i][1]));
    minFeature = Math.min(minFeature, d);
  }
  const rot = isNum(+spec.rotation_deg) ? +spec.rotation_deg : 0;
  return { shape: parts.length === 1 && parts[0] === 'subtract' ? `${base.shape}_holed` : `${base.shape}_${parts.join('_')}`, kind: 'comps', comps, rot, minFeature: Math.round(minFeature), boolean: parts };
}

function makeSimpleElement(spec, path, errs, ctx) {
  const r = reader(spec, path, errs);
  let shape = lc(r.str('shape') || 'rectangle');
  const ALIAS = { rect: 'rectangle', box: 'rectangle', bar: 'rectangle', disc: 'circle', disk: 'circle', dot: 'circle', pillar: 'circle', hole: 'circle', oval: 'ellipse', donut: 'ring', annulus: 'ring', torus: 'ring', sector: 'arc', pie: 'arc', annular_sector: 'arc', plus: 'cross', rounded_rect: 'rounded_rectangle', rrect: 'rounded_rectangle', regular_polygon: 'ngon', n_gon: 'ngon', custom: 'polygon', wire: 'line', path: 'line', label: 'text' };
  shape = ALIAS[shape] || shape;
  const rot = (r.num('rotation_deg') ?? 0);
  const el = { shape, rot, minFeature: Infinity };
  const need = (v, what) => { if (v == null) errs.push(`${path}: a ${shape} needs ${what}`); return v; };
  const sizePair = () => {
    let w = r.len('width_um', { pos: true }), h = r.len('height_um', { pos: true });
    const side = r.len('side_um', { pos: true }), size = r.has('size_um') && Array.isArray(r.o.size_um) ? r.o.size_um : null;
    if (size) { w = +size[0] * UM; h = +size[1] * UM; }
    if (w == null && side != null) w = side;
    if (h == null) h = side ?? w;
    if (w == null) w = h;
    return [need(w, 'width_um (and height_um)'), h];
  };

  if (shape === 'rectangle' || shape === 'square') {
    const [w, h] = sizePair();
    if (w == null) return null;
    el.kind = 'rect'; el.hw = w / 2; el.hh = h / 2; el.minFeature = Math.min(w, h);
  } else if (shape === 'circle') {
    let d = r.len('diameter_um', { pos: true }); const rr = r.len('radius_um', { pos: true });
    if (d == null && rr != null) d = 2 * rr;
    if (need(d, 'diameter_um') == null) return null;
    el.kind = 'circle'; el.r = d / 2; el.minFeature = d;
  } else if (shape === 'ellipse') {
    const [w, h] = sizePair(); if (w == null) return null;
    el.kind = 'gen'; el.gen = { type: 'ellipse', rx: w / 2, ry: h / 2 }; el.minFeature = Math.min(w, h);
  } else if (NGON_SIDES[shape] || shape === 'ngon') {
    const n = NGON_SIDES[shape] || Math.round(r.num('sides', { min: 3, max: 360 }) ?? NaN);
    if (!(n >= 3)) { errs.push(`${path}: an ngon needs sides (3 or more)`); return null; }
    const sinT = Math.sin(Math.PI / n), cosT = Math.cos(Math.PI / n);
    let R = r.len('circumradius_um', { pos: true });
    const side = r.len('side_um', { pos: true }), v2v = r.len('vertex_to_vertex_um', { pos: true }) ?? r.len('diameter_um', { pos: true });
    const f2f = r.len('flat_to_flat_um', { pos: true }), inr = r.len('inradius_um', { pos: true }), hgt = r.len('height_um', { pos: true }), wid = r.len('width_um', { pos: true });
    if (R == null && side != null) R = side / (2 * sinT);
    if (R == null && v2v != null) R = v2v / 2;
    if (R == null && f2f != null) R = n % 2 ? f2f / (1 + cosT) : f2f / (2 * cosT);
    if (R == null && inr != null) R = inr / cosT;
    if (R == null && (hgt != null || wid != null)) R = n % 2 ? (hgt ?? wid) / (1 + cosT) : (hgt ?? wid) / 2;
    if (need(R, 'a size: side_um, circumradius_um, vertex_to_vertex_um or flat_to_flat_um') == null) return null;
    const or = lc(r.str('orientation') || (n === 6 ? 'flat_top' : 'flat_bottom'));
    let phase = flatPhase(n);                                   // a flat side at the bottom (hexagon: flat top and bottom)
    if (/pointy|point_up|vertex_up|tip_up/.test(or)) phase = 90;
    else if (/point_down|tip_down/.test(or)) phase = -90;
    else if (/flat_top/.test(or) && n % 2) phase = -flatPhase(n);  // odd n: flat side on top
    el.kind = 'gen'; el.gen = { type: 'ngon', n, r: R, phase }; el.minFeature = n % 2 ? R * (1 + cosT) : 2 * R * cosT;
  } else if (shape === 'ring' || shape === 'arc') {
    let od = r.len('outer_diameter_um', { pos: true }) ?? r.len('diameter_um', { pos: true });
    if (od == null && r.has('outer_radius_um')) od = 2 * r.len('outer_radius_um', { pos: true });
    let id = r.len('inner_diameter_um', { min: 0 });
    if (id == null && r.has('inner_radius_um')) id = 2 * r.len('inner_radius_um', { min: 0 });
    const width = r.len('width_um', { pos: true });
    if (od == null && id != null && width != null) od = id + 2 * width;
    if (id == null && width != null && od != null) id = od - 2 * width;
    if (need(od, 'outer_diameter_um') == null) return null;
    if (id == null) id = shape === 'ring' ? od / 2 : 0;
    if (id >= od) { errs.push(`${path}: inner_diameter_um must be smaller than outer_diameter_um`); return null; }
    el.kind = 'gen';
    if (shape === 'ring') { el.gen = { type: 'ring', ro: od / 2, ri: id / 2 }; el.minFeature = (od - id) / 2; }
    else {
      const a0 = r.num('start_deg') ?? 0, span = r.num('span_deg'), a1 = r.num('end_deg') ?? (span != null ? a0 + span : a0 + 90);
      el.gen = { type: 'arc', ro: od / 2, ri: id / 2, a0, a1 }; el.minFeature = id > 0 ? (od - id) / 2 : od / 2;
    }
  } else if (shape === 'cross') {
    const [w, h] = sizePair(); if (w == null) return null;
    const aw = r.len('arm_width_um', { pos: true }) ?? Math.min(w, h) * 0.2;
    el.kind = 'gen'; el.gen = { type: 'cross', hw: w / 2, hh: h / 2, aw }; el.minFeature = aw;
  } else if (shape === 'rounded_rectangle') {
    const [w, h] = sizePair(); if (w == null) return null;
    const cr = r.len('corner_radius_um', { min: 0 }) ?? Math.min(w, h) * 0.2;
    el.kind = 'gen'; el.gen = { type: 'rrect', hw: w / 2, hh: h / 2, cr }; el.minFeature = Math.min(w, h);
  } else if (shape === 'polygon') {
    const v = r.o.vertices_um;
    if (!Array.isArray(v) || v.length < 3 || !v.every((p) => Array.isArray(p) && isNum(+p[0]) && isNum(+p[1]))) { errs.push(`${path}: a polygon needs vertices_um: [[x, y], …] (3 or more, µm, relative to where it is placed)`); return null; }
    el.kind = 'poly'; el.pts = v.map(([x, y]) => [+x * UM, +y * UM]);
    const bb = bboxOfPolys([el.pts]); el.minFeature = Math.min(bb.x2 - bb.x1, bb.y2 - bb.y1);
  } else if (shape === 'line') {
    const a = r.pt('from_um'), b = r.pt('to_um'), w = r.len('width_um', { pos: true });
    if (!a || !b || w == null) { errs.push(`${path}: a line needs from_um, to_um and width_um`); return null; }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!(L > 0)) { errs.push(`${path}: a line needs from_um ≠ to_um`); return null; }
    el.kind = 'rect'; el.hw = L / 2; el.hh = w / 2; el.rot += Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R; el.lineCentre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; el.minFeature = w;
  } else if (shape === 'text') {
    const text = r.str('text'), h = r.len('height_um', { pos: true });
    if (!text || h == null) { errs.push(`${path}: text needs text and height_um`); return null; }
    if (!ctx.textPolygons) { errs.push(`${path}: text is not available here`); return null; }
    const comps = ctx.textPolygons(text, { font: lc(r.str('font') || 'sans'), heightNm: h, bold: r.o.bold !== false });
    if (!comps || !comps.length) { errs.push(`${path}: the text "${text}" gave no outline`); return null; }
    el.kind = 'comps'; el.comps = comps; el.minFeature = h * 0.12; el.text = text;
  } else {
    errs.push(`${path}.shape "${r.str('shape')}" is not known; use one of ${SHAPE_NAMES.join(', ')}`);
    return null;
  }
  return el;
}

// The local outline(s) of an element, rotation applied (for gaps and containment).
export function elementOutline(el) {
  const a = el.rot * D2R;
  let polys;
  if (el.kind === 'rect') polys = [[[-el.hw, -el.hh], [el.hw, -el.hh], [el.hw, el.hh], [-el.hw, el.hh]]];
  else if (el.kind === 'circle') { const n = Math.min(256, Math.max(24, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 1 / Math.max(el.r, 1)))))); polys = [Array.from({ length: n }, (_, i) => [el.r * Math.cos((2 * Math.PI * i) / n), el.r * Math.sin((2 * Math.PI * i) / n)])]; }
  else if (el.kind === 'gen') polys = genPolygons(normGen(el.gen), Math.max(1, (el.gen.ro || el.gen.r || el.gen.rx || 1000) / 2000));
  else if (el.kind === 'poly') polys = [el.pts];
  else polys = el.comps.map((c) => c.outer);
  return a ? polys.map((p) => p.map(([x, y]) => rot2(x, y, a))) : polys;
}

// Copies of the element centred at (x, y).
function placeElement(el, x, y, dose, layer) {
  if (el.kind === 'rect') { const s = makeRect(x, y, el.hw, el.hh, dose, layer); s.rot = el.rot; return [s]; }
  if (el.kind === 'circle') return [makeCircle(x, y, el.r, dose, layer)];
  if (el.kind === 'gen') return makeGenShapes(el.gen, x, y, dose, layer, el.rot);
  if (el.kind === 'poly') { const s = makePoly(el.pts.map(([px, py]) => { const [u, v] = rot2(px, py, el.rot * D2R); return [x + u, y + v]; }), dose, layer); return [s]; }
  // text: components (outline + holes) moved and turned
  const a = el.rot * D2R, mv = (p) => p.map(([px, py]) => { const [u, v] = rot2(px, py, a); return [x + u, y + v]; });
  return componentShapes(el.comps.map((c) => ({ outer: mv(c.outer), holes: c.holes.map(mv) })), { layer, dose });
}

// ------------------------------------------------------------------ distances between outlines
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay, L = vx * vx + vy * vy;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L)) : 0;
  return Math.hypot(wx - t * vx, wy - t * vy);
}
function pip(poly, x, y) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) ins = !ins;
  }
  return ins;
}
// edge-to-edge distance between outline set P and P shifted by (tx, ty); 0 when they overlap
function shiftDist(P, tx, ty) {
  let d = Infinity;
  for (const p of P) for (const q of P) {
    for (const [x, y] of q) { const X = x + tx, Y = y + ty; if (pip(p, X, Y)) return 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segDist(X, Y, p[j][0], p[j][1], p[i][0], p[i][1])); }
    for (const [x, y] of p) { const X = x - tx, Y = y - ty; if (pip(q, X, Y)) return 0; for (let i = 0, j = q.length - 1; i < q.length; j = i++) d = Math.min(d, segDist(X, Y, q[j][0], q[j][1], q[i][0], q[i][1])); }
  }
  return d;
}
// smallest s with gap(s·v) ≥ target for every neighbour vector v (gap grows with s)
function solveScale(P, vecs, target) {
  const f = (s) => Math.min(...vecs.map(([vx, vy]) => shiftDist(P, s * vx, s * vy)));
  let lo = 0, hi = 1;
  while (f(hi) < target && hi < 1e9) hi *= 2;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (f(m) < target) lo = m; else hi = m; }
  return hi;
}

// ------------------------------------------------------------------ lattices
// → { a1, a2 } basis vectors (nm), the gap actually reached, and a description
export function makeLattice(spec, el, path, errs) {
  const r = reader(spec || {}, path, errs);
  let type = lc(r.str('type') || (spec ? 'square' : 'single'));
  if (type === 'triangular') type = 'hexagonal';
  if (!['single', 'square', 'rectangular', 'hexagonal', 'oblique'].includes(type)) { errs.push(`${path}.type "${type}" is not known; use single, square, rectangular, hexagonal or oblique`); return null; }
  if (type === 'single') return { type, a1: [0, 0], a2: [0, 0], gapX: null, gapY: null };
  const ang = (r.num('angle_deg') ?? 0) * D2R;
  const P = elementOutline(el);
  let a1, a2, gx = null, gy = null;
  const pitch = r.len('pitch_um', { pos: true }), gap = r.len('gap_um', { min: -1e9 });
  if (type === 'rectangular' || (type === 'square' && (r.has('pitch_x_um') || r.has('gap_x_um')))) {
    let px = r.len('pitch_x_um', { pos: true }) ?? pitch, py = r.len('pitch_y_um', { pos: true }) ?? pitch;
    const gxs = r.len('gap_x_um', { min: -1e9 }) ?? gap, gys = r.len('gap_y_um', { min: -1e9 }) ?? gap;
    if (px == null && gxs != null) { px = solveScale(P, [[1, 0]], gxs); gx = gxs; }
    if (py == null && gys != null) { py = solveScale(P, [[0, 1]], gys); gy = gys; }
    if (px == null || py == null) { errs.push(`${path}: a rectangular lattice needs pitch_x_um/pitch_y_um or gap_x_um/gap_y_um (or pitch_um / gap_um for both)`); return null; }
    a1 = [px, 0]; a2 = [0, py];
  } else {
    const unit = type === 'square' ? [[1, 0], [0, 1]] : type === 'hexagonal' ? [[1, 0], [0.5, Math.sqrt(3) / 2]]
      : (() => { const b = (r.num('oblique_angle_deg') ?? 60) * D2R, k = r.num('aspect') ?? 1; return [[1, 0], [k * Math.cos(b), k * Math.sin(b)]]; })();
    let s = pitch;
    if (s == null && gap != null) {
      const [u, v] = unit, nb = [u, v, [u[0] + v[0], u[1] + v[1]], [u[0] - v[0], u[1] - v[1]]];
      s = solveScale(P, nb, gap); gx = gy = gap;
    }
    if (s == null) { errs.push(`${path}: give pitch_um (centre to centre) or gap_um (edge to edge)`); return null; }
    a1 = [unit[0][0] * s, unit[0][1] * s]; a2 = [unit[1][0] * s, unit[1][1] * s];
  }
  if (ang) { a1 = rot2(a1[0], a1[1], ang); a2 = rot2(a2[0], a2[1], ang); }
  // the gap the lattice actually has (also when a pitch was given)
  const gapReal = Math.min(...[a1, a2, [a1[0] + a2[0], a1[1] + a2[1]], [a1[0] - a2[0], a1[1] - a2[1]]].map(([x, y]) => shiftDist(P, x, y)));
  return { type, a1, a2, gap: gapReal, overlap: gapReal <= 0, angle: ang };
}

// ------------------------------------------------------------------ regions
// A region is a set of polygons (outers CCW, holes CW) with a fast point test.
function regionTester(polys) {
  const bb = bboxOfPolys(polys), NB = 256, h = (bb.y2 - bb.y1) / NB || 1;
  const bands = Array.from({ length: NB }, () => []);
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, ay] = p[j], [bx, by] = p[i];
    const b0 = Math.max(0, Math.floor((Math.min(ay, by) - bb.y1) / h)), b1 = Math.min(NB - 1, Math.floor((Math.max(ay, by) - bb.y1) / h));
    for (let b = b0; b <= b1; b++) bands[b].push(ax, ay, bx, by);
  }
  const inside = (x, y) => {
    if (x < bb.x1 || x > bb.x2 || y < bb.y1 || y > bb.y2) return false;
    const e = bands[Math.min(NB - 1, Math.max(0, Math.floor((y - bb.y1) / h)))];
    let ins = false;
    for (let k = 0; k < e.length; k += 4) { const ay = e[k + 1], by = e[k + 3]; if ((ay > y) !== (by > y) && x < ((e[k + 2] - e[k]) * (y - ay)) / (by - ay) + e[k]) ins = !ins; }
    return ins;
  };
  return { polys, bb, inside };
}

function regionPolys(spec, path, errs, ctx, anchor) {
  const r = reader(spec, path, errs);
  const type = lc(r.str('type') || 'rect');
  const c = r.pt('center_um') || anchor;
  if (type === 'rect' || type === 'square' || type === 'rectangle') {
    let w = r.len('width_um', { pos: true }), h = r.len('height_um', { pos: true });
    const side = r.len('side_um', { pos: true }); if (w == null) w = side ?? h; if (h == null) h = side ?? w;
    if (w == null) { errs.push(`${path}: a rect region needs width_um and height_um`); return null; }
    const a = (r.num('rotation_deg') ?? 0) * D2R;
    return [[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => { const [u, v] = rot2(x, y, a); return [c[0] + u, c[1] + v]; })];
  }
  if (type === 'circle' || type === 'ring' || type === 'disc') {
    let d = r.len('diameter_um', { pos: true }) ?? r.len('outer_diameter_um', { pos: true }); if (d == null && r.has('radius_um')) d = 2 * r.len('radius_um', { pos: true });
    if (d == null) { errs.push(`${path}: a ${type} region needs diameter_um`); return null; }
    const di = type === 'ring' ? (r.len('inner_diameter_um', { min: 0 }) ?? 0) : 0;
    const circ = (R, ccw) => { const n = Math.min(4096, Math.max(64, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 1 / R))))); const p = []; for (let i = 0; i < n; i++) { const t = (2 * Math.PI * (ccw ? i : n - i)) / n; p.push([c[0] + R * Math.cos(t), c[1] + R * Math.sin(t)]); } return p; };
    return di > 0 ? [circ(d / 2, true), circ(di / 2, false)] : [circ(d / 2, true)];
  }
  if (type === 'polygon') {
    const v = r.o.vertices_um;
    if (!Array.isArray(v) || v.length < 3) { errs.push(`${path}: a polygon region needs vertices_um: [[x, y], …] (µm, absolute)`); return null; }
    const p = v.map(([x, y]) => [+x * UM, +y * UM]);
    return [signedArea(p) < 0 ? p.reverse() : p];
  }
  if (type === 'text') {
    const text = r.str('text'), h = r.len('height_um', { pos: true });
    if (!text || h == null) { errs.push(`${path}: a text region needs text and height_um`); return null; }
    if (!ctx.textPolygons) { errs.push(`${path}: text is not available here`); return null; }
    const comps = ctx.textPolygons(text, { font: lc(r.str('font') || 'sans'), heightNm: h, bold: r.o.bold !== false });
    if (!comps?.length) { errs.push(`${path}: the text "${text}" gave no outline`); return null; }
    const out = [];
    for (const k of comps) { out.push(k.outer.map(([x, y]) => [x + c[0], y + c[1]])); for (const hl of k.holes) out.push(hl.map(([x, y]) => [x + c[0], y + c[1]])); }
    return out;
  }
  if (type === 'selection') {
    if (!ctx.selectionPolys?.length) { errs.push(`${path}: region "selection" needs objects to be selected`); return null; }
    return ctx.selectionPolys;
  }
  errs.push(`${path}.type "${type}" is not known; use rect, circle, ring, polygon, text or selection`);
  return null;
}

// ------------------------------------------------------------------ where things go
function resolvePosition(spec, path, errs, ctx) {
  if (!spec) return ctx.defaultCentre;
  if (Array.isArray(spec)) return [+spec[0] * UM, +spec[1] * UM];
  const r = reader(spec, path, errs);
  if (r.has('x_um') || r.has('y_um')) return [(r.num('x_um') ?? 0) * UM, (r.num('y_um') ?? 0) * UM];
  const rel = lc(r.str('relative_to') || 'view');
  const bb = rel === 'selection' ? ctx.selectionBBox : rel === 'origin' ? { x1: 0, y1: 0, x2: 0, y2: 0 } : rel === 'cell' ? ctx.cellBBox : ctx.viewBBox;
  if (!bb) { errs.push(`${path}.relative_to "${rel}": there is nothing to be relative to${rel === 'selection' ? ' (nothing is selected)' : ''}`); return null; }
  const an = lc(r.str('anchor') || 'center');
  const x = /left/.test(an) ? bb.x1 : /right/.test(an) ? bb.x2 : (bb.x1 + bb.x2) / 2;
  const y = /top/.test(an) ? bb.y2 : /bottom/.test(an) ? bb.y1 : (bb.y1 + bb.y2) / 2;
  return [x + (r.num('dx_um') ?? 0) * UM, y + (r.num('dy_um') ?? 0) * UM];
}

// ------------------------------------------------------------------ patterns
// Builds one pattern into the edited cell (flat shapes, an array, or a cell of its own).
function buildPattern(spec, path, errs, warns, ctx, W) {
  const r = reader(spec, path, errs);
  const el = makeElement(r.o.element, `${path}.element`, errs, ctx);
  if (!el) return;
  const layer = r.str('layer') || ctx.activeLayer, dose = r.num('dose', { pos: true }) ?? ctx.nominalDose;
  W.ensureLayer(layer);
  const lat = makeLattice(r.o.lattice, el, `${path}.lattice`, errs);
  if (!lat) return;
  if (lat.overlap) warns.push(`${path}: the elements overlap (pitch smaller than the element) — they will be exposed twice where they overlap`);
  const pos = resolvePosition(r.o.position, `${path}.position`, errs, ctx);
  if (!pos) return;
  const centre = el.lineCentre && !r.o.position ? el.lineCentre : pos;
  const reg = r.o.region ? reader(r.o.region, `${path}.region`, errs) : null;
  const regType = reg ? lc(reg.str('type') || 'rect') : (lat.type === 'single' ? 'point' : 'array');
  // a cell named by what it holds: HEXAGON_400NM, CIRCLE_200NM …
  const name = r.str('name') || `${el.shape.toUpperCase()}_${el.minFeature >= 1000 ? +(el.minFeature / 1000).toFixed(2) + 'UM' : Math.round(el.minFeature) + 'NM'}`.replace(/\./g, 'P');
  const stats = { pattern: path, element: el.shape, layer, dose, minFeature: el.minFeature, gap: lat.type === 'single' ? null : lat.gap, count: 0 };
  W.stats.push(stats);

  // one element
  if (regType === 'point' || lat.type === 'single') {
    if (reg && regType !== 'point') warns.push(`${path}: a region needs a lattice to fill it — placed one element at its centre`);
    const sh = placeElement(el, centre[0], centre[1], dose, layer);
    W.addShapes(sh); stats.count = 1; return;
  }

  // an nx × ny array: a cell holding one element, placed as an array (stored once)
  if (regType === 'array') {
    const nx = Math.round(reg?.num('nx', { min: 1 }) ?? r.num('nx', { min: 1 }) ?? NaN), ny = Math.round(reg?.num('ny', { min: 1 }) ?? r.num('ny', { min: 1 }) ?? NaN);
    if (!(nx >= 1 && ny >= 1)) { errs.push(`${path}: an array needs nx and ny (columns and rows) — in region {"type":"array","nx":…,"ny":…}`); return; }
    if (nx * ny > MAX_ELEMENTS) { errs.push(`${path}: ${nx} × ${ny} elements is more than ${MAX_ELEMENTS.toLocaleString()}`); return; }
    const ramp = r.o.dose_ramp ? doseRamp(r.o.dose_ramp, `${path}.dose_ramp`, errs) : null;
    const o = [centre[0] - ((nx - 1) * lat.a1[0] + (ny - 1) * lat.a2[0]) / 2, centre[1] - ((nx - 1) * lat.a1[1] + (ny - 1) * lat.a2[1]) / 2];
    const axisAligned = Math.abs(lat.a1[1]) < 1e-9 && Math.abs(lat.a2[0]) < 1e-9;
    if (ramp && axisAligned) {
      // a dose test: the element in the cell, then the editor's own dose-ramp array (one dose class per step)
      const sh = placeElement(el, Math.round(o[0]), Math.round(o[1]), dose, layer);
      W.cell.shapes.push(...sh.map(roundToDbu));
      const out = makeRampArray(W.lib, W.cellName, new Set(sh.map((s) => s.id)), { cols: nx, rows: ny, pitchX: Math.round(lat.a1[0]), pitchY: Math.round(lat.a2[1]), name: uniqueCellName(W.lib, name), ...ramp });
      out.refs.forEach((x) => W.created.add(x.id));
      stats.count = nx * ny; stats.ramp = ramp; return;
    }
    if (ramp) warns.push(`${path}: a dose ramp needs an unrotated square or rectangular lattice — made without the ramp`);
    if (nx * ny === 1) { W.addShapes(placeElement(el, centre[0], centre[1], dose, layer)); stats.count = 1; return; }
    const cname = uniqueCellName(W.lib, name);
    const cell = makeCell(cname);
    cell.shapes = placeElement(el, 0, 0, dose, layer).map(roundToDbu);
    W.lib.cells[cname] = cell;
    const ref = makeRef(cname, { x: Math.round(o[0]), y: Math.round(o[1]), cols: nx, rows: ny, colStep: lat.a1.map(Math.round), rowStep: lat.a2.map(Math.round) });
    W.cell.refs.push(ref); W.created.add(ref.id);
    stats.count = nx * ny; return;
  }

  // a region filled with the lattice
  const regionAnchor = reg.pt('center_um') ? null : centre;
  const polys0 = regionPolys(r.o.region, `${path}.region`, errs, ctx, regionAnchor || centre);
  if (!polys0) return;
  let polys = polys0;
  const inset = reg.len('inset_um', { min: -1e9 });
  if (inset) polys = offsetPolygons(polys, -inset);
  if (!polys.length) { errs.push(`${path}.region: nothing is left after the inset`); return; }
  const R = regionTester(polys);
  const contain = lc(reg.str('containment') || 'full');
  if (!['full', 'center', 'centre', 'clip'].includes(contain)) { errs.push(`${path}.region.containment must be full, center or clip`); return; }
  // lattice points over the region's box, the lattice centred on the region's centre
  const c0 = [(R.bb.x1 + R.bb.x2) / 2, (R.bb.y1 + R.bb.y2) / 2];
  const det = lat.a1[0] * lat.a2[1] - lat.a1[1] * lat.a2[0];
  if (Math.abs(det) < 1e-9) { errs.push(`${path}.lattice is degenerate`); return; }
  const P = elementOutline(el), eb = bboxOfPolys(P), er = Math.max(Math.abs(eb.x1), Math.abs(eb.x2), Math.abs(eb.y1), Math.abs(eb.y2));
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const [x, y] of [[R.bb.x1 - er, R.bb.y1 - er], [R.bb.x2 + er, R.bb.y1 - er], [R.bb.x2 + er, R.bb.y2 + er], [R.bb.x1 - er, R.bb.y2 + er]]) {
    const dx = x - c0[0], dy = y - c0[1], i = (dx * lat.a2[1] - dy * lat.a2[0]) / det, j = (lat.a1[0] * dy - lat.a1[1] * dx) / det;
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  }
  i0 = Math.floor(i0); i1 = Math.ceil(i1); j0 = Math.floor(j0); j1 = Math.ceil(j1);
  const candidates = (i1 - i0 + 1) * (j1 - j0 + 1);
  if (candidates > 4 * MAX_ELEMENTS) { errs.push(`${path}: about ${Math.round(candidates).toLocaleString()} lattice points over the region — far too many (a pitch typed in nm instead of µm?)`); return; }
  // full containment: every corner of the element inside, and no corner of the region inside the element
  const corners = P.flat();
  const regionCorners = polys.flat();
  const out = [];
  let n = 0, clipped = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = c0[0] + i * lat.a1[0] + j * lat.a2[0], y = c0[1] + i * lat.a1[1] + j * lat.a2[1];
    if (contain === 'center' || contain === 'centre') { if (!R.inside(x, y)) continue; }
    else {
      let all = true, any = false;
      for (const [u, v] of corners) { const ins = R.inside(x + u, y + v); all = all && ins; any = any || ins; if (!all && any) break; }
      if (all) {
        for (const [u, v] of regionCorners) if (u > x + eb.x1 && u < x + eb.x2 && v > y + eb.y1 && v < y + eb.y2 && P.some((p) => pip(p, u - x, v - y))) { all = false; break; }
      }
      if (!all) {
        if (contain !== 'clip' || (!any && !R.inside(x, y) && !regionCorners.some(([u, v]) => u > x + eb.x1 && u < x + eb.x2 && v > y + eb.y1 && v < y + eb.y2))) continue;
        // clip: the part of the element inside the region
        const parts = intersectPolygons(P.map((p) => p.map(([u, v]) => [x + u, y + v])), polys);
        if (!parts.length) continue;
        out.push(...componentShapes(components(parts.map((p) => p.map(([u, v]) => ({ X: Math.round(u * 16), Y: Math.round(v * 16) })))), { layer, dose }));
        clipped++; n++;
        if (n > MAX_ELEMENTS) break;
        continue;
      }
    }
    out.push(...placeElement(el, x, y, dose, layer));
    if (++n > MAX_ELEMENTS) break;
  }
  if (n > MAX_ELEMENTS) { errs.push(`${path}: more than ${MAX_ELEMENTS.toLocaleString()} elements — use a larger pitch or a smaller region`); return; }
  if (!n) warns.push(`${path}: no element fits in the region (elements larger than the region, or the pitch too large) — nothing was made`);
  stats.count = n; stats.clipped = clipped;
  if (out.length > FLAT_TO_CELL) W.addCell(name, out); else W.addShapes(out);
}

function doseRamp(spec, path, errs) {
  const r = reader(spec, path, errs);
  const axis = lc(r.str('axis') || 'x'), from = r.num('from', { pos: true }), to = r.num('to', { pos: true });
  if (from == null || to == null) { errs.push(`${path} needs from and to (µC/cm²)`); return null; }
  const ramp = { from, to, mode: lc(r.str('mode') || 'lin') === 'log' ? 'log' : 'lin', unit: lc(r.str('unit') || 'abs') === 'factor' ? 'factor' : 'abs' };
  return axis === 'y' ? { rampY: ramp } : { rampX: ramp };
}

// a sweep: the same pattern several times with one parameter stepped, in a row (or column) of blocks
function buildSweep(spec, path, errs, warns, ctx, W) {
  const sw = reader(spec.sweep, `${path}.sweep`, errs);
  const param = lc(sw.str('parameter') || '');
  const values = Array.isArray(spec.sweep.values) ? spec.sweep.values.map(Number) : null;
  if (!values?.length || !values.every(isNum)) { errs.push(`${path}.sweep needs values: [ … ]`); return; }
  const dir = lc(sw.str('direction') || 'x') === 'y' ? 'y' : 'x';
  const spacing = sw.len('spacing_um', { min: 0 }) ?? null;
  const base = JSON.parse(JSON.stringify(spec)); delete base.sweep;
  // the block size, measured on the first value, sets the step
  const variants = values.map((v) => applySweepValue(base, param, v, `${path}.sweep`, errs));
  if (errs.length) return;
  const start = resolvePosition(spec.position, `${path}.position`, errs, ctx); if (!start) return;
  let at = 0;
  for (let k = 0; k < variants.length; k++) {
    const sub = { lib: W.lib, cell: makeCell('__sweep'), cellName: '__sweep', created: new Set(), stats: [], ensureLayer: W.ensureLayer };
    sub.addShapes = (sh) => { sub.cell.shapes.push(...sh); }; sub.addCell = (nm, sh) => { sub.cell.shapes.push(...sh); };
    W.lib.cells.__sweep = sub.cell;
    const v = { ...variants[k], position: { x_um: 0, y_um: 0 } };
    buildPattern(v, `${path} (${param} ${values[k]})`, errs, warns, ctx, sub);
    delete W.lib.cells.__sweep;
    if (errs.length) return;
    const bb = cellBBox({ cells: { ...W.lib.cells, __sweep: sub.cell } }, '__sweep');
    if (!bb) continue;
    const w = bb.x2 - bb.x1, h = bb.y2 - bb.y1, gapB = spacing ?? 0.5 * Math.max(w, h);
    const off = dir === 'x' ? [start[0] + at - bb.x1, start[1] - (bb.y1 + bb.y2) / 2] : [start[0] - (bb.x1 + bb.x2) / 2, start[1] - at - bb.y2];
    at += (dir === 'x' ? w : h) + gapB;
    const moved = sub.cell.shapes.map((s) => { const c = cloneShape(s); c.cx += off[0]; c.cy += off[1]; return roundToDbu(c); });
    for (const rf of sub.cell.refs) { rf.x = Math.round(rf.x + off[0]); rf.y = Math.round(rf.y + off[1]); W.cell.refs.push(rf); W.created.add(rf.id); }
    if (moved.length > FLAT_TO_CELL) W.addCell(`AI_${param.toUpperCase()}_${k + 1}`, moved); else W.addShapes(moved);
    W.stats.push(...sub.stats.map((s) => ({ ...s, sweep: `${param} = ${values[k]}` })));
    // a label above the block (on a marker layer: drawn, not exposed)
    const lab = lc(sw.str('labels') || 'marker');
    if (lab !== 'none' && ctx.textPolygons) {
      const txt = sweepLabel(param, values[k]);
      const hNm = Math.max(200, Math.min(0.12 * Math.max(w, h), 20 * UM));
      const comps = ctx.textPolygons(txt, { font: 'sans', heightNm: hNm, bold: true });
      const lx = dir === 'x' ? off[0] + (bb.x1 + bb.x2) / 2 : off[0] + bb.x1 - hNm * 0.8 - (comps ? bboxOfPolys(comps.map((c) => c.outer)).x2 : 0);
      const ly = dir === 'x' ? off[1] + bb.y2 + hNm * 1.0 : off[1] + (bb.y1 + bb.y2) / 2;
      if (comps) {
        const layerL = lab === 'exposed' ? (spec.layer || ctx.activeLayer) : W.markerLayer();
        const mv = (p) => p.map(([x, y]) => [x + lx, y + ly]);
        W.addShapes(componentShapes(comps.map((c) => ({ outer: mv(c.outer), holes: c.holes.map(mv) })), { layer: layerL, dose: spec.dose ?? ctx.nominalDose }));
      }
    }
  }
}
const sweepLabel = (param, v) => (param === 'dose' ? `${v}` : param === 'rotation' ? `${v}°` : `${v < 1 ? Math.round(v * 1000) + ' nm' : v + ' µm'}`);
// a copy of the pattern with the swept parameter set
function applySweepValue(base, param, v, path, errs) {
  const s = JSON.parse(JSON.stringify(base));
  s.element ??= {}; s.lattice ??= null;
  if (param === 'dose') s.dose = v;
  else if (param === 'rotation') s.element.rotation_deg = v;
  else if (param === 'gap') { s.lattice = { ...(s.lattice || { type: 'square' }) }; delete s.lattice.pitch_um; s.lattice.gap_um = v; }
  else if (param === 'pitch') { s.lattice = { ...(s.lattice || { type: 'square' }) }; delete s.lattice.gap_um; s.lattice.pitch_um = v; }
  else if (param === 'size') {
    const e = s.element, k = ['diameter_um', 'side_um', 'width_um', 'outer_diameter_um', 'circumradius_um', 'flat_to_flat_um', 'vertex_to_vertex_um'].find((x) => e[x] != null);
    if (!k) { errs.push(`${path}: a size sweep needs the element's size field (diameter_um, side_um, width_um …)`); return s; }
    const ratio = v / e[k];
    e[k] = v;
    // a rectangle's size is its width (a line-width test keeps the length); a ring scales as a whole
    if (k === 'outer_diameter_um' && e.inner_diameter_um != null) e.inner_diameter_um *= ratio;
  } else errs.push(`${path}.parameter "${param}" is not known; use size, gap, pitch, dose or rotation`);
  return s;
}

// ------------------------------------------------------------------ operations on the selection
function selectedObjects(W) {
  const objs = new Map();
  for (const s of W.cell.shapes) if (W.sel.has(s.id)) { const k = groupKeyOf(s); if (!objs.has(k)) objs.set(k, []); objs.get(k).push(s); }
  return [...objs.values()];
}
const needSel = (W, path, errs) => { if (!W.sel.size) { errs.push(`${path}: nothing is selected (this operation works on the selection)`); return false; } return true; };

function opTransform(op, path, errs, W) {
  if (!needSel(W, path, errs)) return;
  const r = reader(op, path, errs);
  const mv = r.pt('move_um') || [0, 0], rotDeg = r.num('rotate_deg') ?? 0, k = r.num('scale', { pos: true }) ?? 1, mir = lc(r.str('mirror') || '');
  const shapes = W.cell.shapes.filter((s) => W.sel.has(s.id)), refs = W.cell.refs.filter((x) => W.sel.has(x.id));
  let bb = null; for (const s of shapes) bb = unionBBox(bb, bboxWorld(s)); for (const x of refs) bb = unionBBox(bb, refBBox(W.lib, x));
  const c = r.pt('about_um') || [(bb.x1 + bb.x2) / 2, (bb.y1 + bb.y2) / 2];
  const a = rotDeg * D2R;
  const P = ([x, y]) => { let u = (x - c[0]) * k, v = (y - c[1]) * k; if (mir === 'x' || mir === 'horizontal') u = -u; if (mir === 'y' || mir === 'vertical') v = -v; [u, v] = rot2(u, v, a); return [c[0] + u + mv[0], c[1] + v + mv[1]]; };
  for (const s of shapes) {
    [s.cx, s.cy] = P([s.cx, s.cy]);
    if (k !== 1) { if (s.kind === 'rect') { s.hw *= k; s.hh *= k; } else if (s.kind === 'circle') s.r *= k; else { s.pts = s.pts.map(([x, y]) => [x * k, y * k]); if (s.gen) s.gen = scaleGen(s.gen, k); } }
    if (mir === 'x' || mir === 'horizontal' || mir === 'y' || mir === 'vertical') {
      const h = mir === 'x' || mir === 'horizontal';
      s.rot = -(s.rot || 0);
      if (s.kind === 'poly') s.pts = s.pts.map(([x, y]) => (h ? [-x, y] : [x, -y])).reverse();
      if (s.gen) s.gen = mirrorGen(s.gen, h ? 'h' : 'v');
    }
    s.rot = (s.rot || 0) + rotDeg;
    roundToDbu(s);
  }
  for (const x of refs) {
    [x.x, x.y] = P([x.x, x.y]).map(Math.round); x.rot = (x.rot || 0) + rotDeg; x.mag = (x.mag || 1) * k;
    const V = ([u, v]) => rot2(u * k * (mir === 'x' ? -1 : 1), v * k * (mir === 'y' ? -1 : 1), a);
    x.colStep = V(x.colStep).map(Math.round); x.rowStep = V(x.rowStep).map(Math.round);
    if (mir === 'x' || mir === 'y') { x.mirrorX = !x.mirrorX; if (mir === 'x') x.rot = 180 - x.rot; }
  }
  W.touched(shapes, refs);
}

function opResize(op, path, errs, W, warns = []) {
  if (!needSel(W, path, errs)) return;
  const r = reader(op, path, errs);
  const bias = r.len('bias_um', { min: -1e9 }), w = r.len('width_um', { pos: true }), h = r.len('height_um', { pos: true }), d = r.len('diameter_um', { pos: true }), side = r.len('side_um', { pos: true }), k = r.num('scale', { pos: true });
  const idn = r.len('inner_diameter_um', { min: 0 });
  if (bias == null && w == null && h == null && d == null && side == null && k == null && idn == null) { errs.push(`${path}: give bias_um (grow +, shrink −), width_um/height_um, diameter_um, side_um, inner_diameter_um or scale`); return; }
  const objs = selectedObjects(W), made = [], gone = new Set();
  for (const members of objs) {
    const s = members[0];
    if (bias != null) {
      // exact where the shape allows it, else a mitred offset of the outline
      if (members.length === 1 && s.kind === 'rect') { s.hw += bias; s.hh += bias; if (s.hw <= 0 || s.hh <= 0) errs.push(`${path}: shrinking by ${fmtUm(-bias)} removes a ${fmtUm(2 * (s.hw - bias))} wide rectangle`); continue; }
      if (members.length === 1 && s.kind === 'circle') { s.r += bias; if (s.r <= 0) errs.push(`${path}: shrinking removes a circle`); continue; }
      if (s.gen && (s.gen.type === 'ring' || s.gen.type === 'ngon' || s.gen.type === 'rrect' || s.gen.type === 'ellipse' && s.gen.rx === s.gen.ry)) {
        for (const m of members) { const g = { ...m.gen }; if (g.type === 'ring') { g.ro += bias; g.ri = Math.max(0, g.ri - bias); } else if (g.type === 'ngon') g.r += bias / Math.cos(Math.PI / g.n); else if (g.type === 'rrect') { g.hw += bias; g.hh += bias; g.cr = Math.max(0, g.cr + bias); } else { g.rx += bias; g.ry += bias; } m.gen = g; regen(m); }
        continue;
      }
      const was = s.gen ? { ellipse: 'an ellipse', arc: 'an arc', cross: 'a cross' }[s.gen.type] || 'a shape' : null;
      if (was) warns.push(`: ${was} grown or shrunk is no longer ${was} (its outline is offset, not scaled), so it became a polygon without size parameters`);
      const grown = offsetPolygons(objectPaths(members).map((p) => p.map((q) => [q.X / 16, q.Y / 16])), bias);
      const comps = components(grown.map((p) => p.map(([x, y]) => ({ X: Math.round(x * 16), Y: Math.round(y * 16) }))));
      if (!comps.length) { errs.push(`${path}: shrinking by ${fmtUm(-bias)} removes an object completely`); continue; }
      members.forEach((m) => gone.add(m.id));
      made.push(...componentShapes(comps, { layer: s.layer, dose: s.dose }));
      continue;
    }
    for (const m of members) {
      if (k != null) { if (m.kind === 'rect') { m.hw *= k; m.hh *= k; } else if (m.kind === 'circle') m.r *= k; else { m.pts = m.pts.map(([x, y]) => [x * k, y * k]); if (m.gen) { m.gen = scaleGen(m.gen, k); regen(m); } } continue; }
      if (m.kind === 'rect') { if (w != null || side != null) m.hw = (w ?? side) / 2; if (h != null || side != null) m.hh = (h ?? side) / 2; if (d != null) m.hw = m.hh = d / 2; }
      else if (m.kind === 'circle') { if (d != null || w != null) m.r = (d ?? w) / 2; }
      else if (m.gen) {
        const g = { ...m.gen };
        if (g.type === 'ellipse') { if (w != null || d != null) g.rx = (w ?? d) / 2; if (h != null || d != null) g.ry = (h ?? d) / 2; }
        else if (g.type === 'ring' || g.type === 'arc') { if (d != null) { const kk = d / 2 / g.ro; g.ro = d / 2; if (idn == null) g.ri *= kk; } if (idn != null) g.ri = idn / 2; }
        else if (g.type === 'ngon') { if (side != null) g.r = side / (2 * Math.sin(Math.PI / g.n)); else if (d != null) g.r = d / 2; }
        else if (g.type === 'cross' || g.type === 'rrect') { if (w != null) g.hw = w / 2; if (h != null) g.hh = h / 2; }
        m.gen = g; regen(m);
      } else {
        const bb = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
        for (const [x, y] of m.pts) { bb.x1 = Math.min(bb.x1, x); bb.x2 = Math.max(bb.x2, x); bb.y1 = Math.min(bb.y1, y); bb.y2 = Math.max(bb.y2, y); }
        const kx = w != null ? w / (bb.x2 - bb.x1) : d != null ? d / (bb.x2 - bb.x1) : 1, ky = h != null ? h / (bb.y2 - bb.y1) : d != null ? d / (bb.y2 - bb.y1) : (w != null && h == null ? kx : 1);
        m.pts = m.pts.map(([x, y]) => [x * kx, y * ky]);
      }
    }
  }
  W.replace(gone, made);
  W.touched(objs.flat().filter((s) => !gone.has(s.id)), []);
  objs.flat().forEach((s) => { if (!gone.has(s.id)) roundToDbu(s); });
}

function opSet(op, path, errs, W) {
  if (!needSel(W, path, errs)) return;
  const r = reader(op, path, errs);
  const dose = r.num('dose', { min: 0 }), layer = r.str('layer');
  if (dose == null && !layer) { errs.push(`${path}: give dose and/or layer`); return; }
  if (layer) W.ensureLayer(layer);
  const shapes = W.cell.shapes.filter((s) => W.sel.has(s.id));
  for (const s of shapes) { if (dose != null) { s.dose = dose; s.writeDose = null; } if (layer) s.layer = layer; }
  W.touched(shapes, []);
}

function opArray(op, path, errs, W) {
  if (!needSel(W, path, errs)) return;
  const r = reader(op, path, errs);
  const cols = Math.round(r.num('cols', { min: 1 }) ?? r.num('nx', { min: 1 }) ?? NaN), rows = Math.round(r.num('rows', { min: 1 }) ?? r.num('ny', { min: 1 }) ?? NaN);
  if (!(cols >= 1 && rows >= 1)) { errs.push(`${path} needs cols and rows`); return; }
  if (W.cell.refs.some((x) => W.sel.has(x.id))) { errs.push(`${path}: an array is made from shapes; the selection holds instances/arrays`); return; }
  const shapes = W.cell.shapes.filter((s) => W.sel.has(s.id));
  let bb = null; for (const s of shapes) bb = unionBBox(bb, bboxWorld(s));
  let px = r.len('pitch_x_um', { pos: true }) ?? r.len('pitch_um', { pos: true }), py = r.len('pitch_y_um', { pos: true }) ?? r.len('pitch_um', { pos: true });
  const gx = r.len('gap_x_um', { min: -1e9 }) ?? r.len('gap_um', { min: -1e9 }), gy = r.len('gap_y_um', { min: -1e9 }) ?? r.len('gap_um', { min: -1e9 });
  if (px == null && gx != null) px = bb.x2 - bb.x1 + gx;
  if (py == null && gy != null) py = bb.y2 - bb.y1 + gy;
  if (px == null && cols > 1) { errs.push(`${path}: give pitch_x_um or gap_x_um`); return; }
  if (py == null && rows > 1) { errs.push(`${path}: give pitch_y_um or gap_y_um`); return; }
  const ramp = op.dose_ramp ? doseRamp(op.dose_ramp, `${path}.dose_ramp`, errs) : {};
  if (errs.length) return;
  const ids = new Set(); for (const s of W.cell.shapes) if (W.sel.has(s.id)) ids.add(s.id);
  const out = makeRampArray(W.lib, W.cellName, ids, { cols, rows, pitchX: Math.round(px ?? 1000), pitchY: Math.round(py ?? 1000), name: uniqueCellName(W.lib, r.str('name') || 'AI_ARRAY'), ...ramp });
  ids.forEach((id) => W.removed.add(id));
  out.refs.forEach((x) => W.created.add(x.id));
}

function opBoolean(op, path, errs, W) {
  if (!needSel(W, path, errs)) return;
  const r = reader(op, path, errs);
  if (W.cell.refs.some((x) => W.sel.has(x.id))) errs.push(`${path}: booleans work on shapes, not on arrays or instances (for a repeated holed shape put the boolean inside the element: "subtract":[…])`);
  const kind = lc(r.str('operation') || '');
  const map = { merge: 'merge', union: 'merge', subtract: 'subtract', difference: 'subtract', minus: 'subtract', intersect: 'intersect', intersection: 'intersect', and: 'intersect', xor: 'xor' };
  if (!map[kind]) { errs.push(`${path}.operation must be merge, subtract, intersect or xor`); return; }
  const objs = selectedObjects(W);
  if (objs.length < 2) { errs.push(`${path}: a boolean needs two or more selected objects`); return; }
  let base = 0;
  if (map[kind] === 'subtract') { const by = lc(r.str('base') || 'largest'); if (by === 'first') base = 0; else if (by === 'largest') { let best = -1; objs.forEach((m, i) => { const a = m.reduce((t, s) => t + shapeArea(s), 0); if (a > best) { best = a; base = i; } }); } }
  const comps = booleanObjects(map[kind], objs, { base });
  const b0 = objs[base][0];
  const gone = new Set(objs.flat().map((s) => s.id));
  W.replace(gone, componentShapes(comps, { layer: b0.layer, dose: b0.dose }));
}

function opFill(op, path, errs, warns, ctx, W) {
  if (!needSel(W, path, errs)) return;
  const pat = op.pattern || {};
  const objs = selectedObjects(W);
  ctx = { ...ctx, selectionPolys: objs.flatMap((m) => objectPaths(m).map((p) => p.map((q) => [q.X / 16, q.Y / 16]))) };
  const spec = { ...pat, region: { ...(pat.region || {}), type: 'selection' } };
  if (spec.layer == null) spec.layer = objs[0][0].layer;
  if (spec.dose == null) spec.dose = objs[0][0].dose;
  buildPattern(spec, `${path}.pattern`, errs, warns, ctx, W);
  if (op.keep_outline !== true) for (const m of objs) for (const s of m) W.removed.add(s.id);
}

function opDuplicate(op, path, errs, W) {
  if (!needSel(W, path, errs)) return;
  const r = reader(op, path, errs);
  const n = Math.round(r.num('count', { min: 1, max: 10000 }) ?? 1), step = r.pt('step_um');
  if (!step) { errs.push(`${path} needs step_um: [dx, dy]`); return; }
  const shapes = W.cell.shapes.filter((s) => W.sel.has(s.id)), refs = W.cell.refs.filter((x) => W.sel.has(x.id));
  for (let k = 1; k <= n; k++) {
    const remap = new Map();
    const sh = shapes.map((s) => { const c = cloneShape(s); c.id = uid('d'); c.cx += k * step[0]; c.cy += k * step[1]; if (s.groupId) { if (!remap.has(s.groupId)) remap.set(s.groupId, (s.groupId.startsWith('gb') ? uid('gb') : uid('g'))); c.groupId = remap.get(s.groupId); } return roundToDbu(c); });
    W.addShapes(sh, true);
    for (const x of refs) { const c = { ...x, id: uid('i'), x: Math.round(x.x + k * step[0]), y: Math.round(x.y + k * step[1]), colStep: [...x.colStep], rowStep: [...x.rowStep] }; W.cell.refs.push(c); W.created.add(c.id); }
  }
}

// ------------------------------------------------------------------ the engine
// ctx: { nominalDose, activeLayer, viewBBox, defaultCentre, textPolygons?(text, {font, heightNm, bold}) }
export function applyOps(libIn, cellName, selIds, ops, ctx) {
  const errs = [], warns = [];
  if (!Array.isArray(ops)) throw new SpecError('"ops" must be a list of operations');
  const lib = cloneLibrary(libIn), cell = lib.cells[cellName];
  if (!cell) throw new SpecError(`no cell ${cellName}`);
  const sel = new Set(selIds);
  // selection geometry for positions relative to it
  let selBB = null;
  for (const s of cell.shapes) if (sel.has(s.id)) selBB = unionBBox(selBB, bboxWorld(s));
  for (const x of cell.refs) if (sel.has(x.id)) selBB = unionBBox(selBB, refBBox(lib, x));
  ctx = { ...ctx, selectionBBox: selBB, cellBBox: cellBBox(lib, cellName), defaultCentre: ctx.defaultCentre || [0, 0] };
  const W = {
    lib, cell, cellName, sel, created: new Set(), removed: new Set(), changed: new Set(), stats: [], newLayers: [],
    addShapes(sh) { const r = sh.map(roundToDbu); cell.shapes.push(...r); r.forEach((s) => W.created.add(s.id)); },
    addCell(name, sh) {
      // many shapes: a cell of their own, placed once (the edited cell stays light; Explode undoes it)
      const cname = uniqueCellName(lib, name);
      const c = makeCell(cname); c.shapes = sh.map(roundToDbu);
      lib.cells[cname] = c;
      const ref = makeRef(cname, { x: 0, y: 0 }); cell.refs.push(ref); W.created.add(ref.id);
    },
    replace(gone, made) {
      if (!gone.size && !made.length) return;
      const at = cell.shapes.findIndex((s) => gone.has(s.id));
      cell.shapes = cell.shapes.filter((s) => !gone.has(s.id));
      gone.forEach((id) => { W.removed.add(id); sel.delete(id); });
      const r = made.map((s) => roundToDbu(s));
      cell.shapes.splice(at < 0 ? cell.shapes.length : Math.min(at, cell.shapes.length), 0, ...r);
      r.forEach((s) => { W.created.add(s.id); sel.add(s.id); });
    },
    touched(shapes, refs) { shapes.forEach((s) => W.changed.add(s.id)); refs.forEach((x) => W.changed.add(x.id)); },
    ensureLayer(key) {
      if (!/^\d{1,5}\/\d{1,5}$/.test(key)) { errs.push(`layer "${key}" must be "layer/datatype", e.g. 1/0`); return; }
      if (!lib.layers.some((l) => l.key === key)) {
        const palette = ['#2f6fd6', '#d6532f', '#2a9d5b', '#9b4fd6', '#d6a72f', '#2fb8d6', '#d62f8f'];
        lib.layers.push({ key, name: `Layer ${key}`, color: palette[lib.layers.length % palette.length], visible: true, purpose: 'exposure' });
        W.newLayers.push(key);
      }
    },
    markerLayer() { const m = lib.layers.find((l) => l.purpose === 'marker'); if (m) return m.key; W.ensureLayer('10/0'); const l = lib.layers.find((x) => x.key === '10/0'); l.purpose = 'marker'; l.name = 'Marker (not exposed)'; return '10/0'; },
  };

  ops.forEach((op, i) => {
    if (errs.length) return;
    const path = `ops[${i}]`;
    if (!op || typeof op !== 'object') { errs.push(`${path} must be an object`); return; }
    const kind = lc(op.op);
    const target = lc(op.target || 'selection');
    if (target === 'all') { sel.clear(); for (const s of cell.shapes) sel.add(s.id); for (const x of cell.refs) sel.add(x.id); }
    // "created": what the earlier operations of this answer made (draw two shapes, then cut one from the other)
    if (target === 'created' || target === 'new') { sel.clear(); for (const id of W.created) sel.add(id); }
    try {
      if (kind === 'add') { if (op.pattern?.sweep) buildSweep(op.pattern, `${path}.pattern`, errs, warns, ctx, W); else buildPattern(op.pattern || {}, `${path}.pattern`, errs, warns, ctx, W); }
      else if (kind === 'transform' || kind === 'move' || kind === 'rotate') opTransform(op, path, errs, W);
      else if (kind === 'resize' || kind === 'bias') opResize(op, path, errs, W, warns);
      else if (kind === 'set') opSet(op, path, errs, W);
      else if (kind === 'array') opArray(op, path, errs, W);
      else if (kind === 'boolean') opBoolean(op, path, errs, W);
      else if (kind === 'fill') opFill(op, path, errs, warns, ctx, W);
      else if (kind === 'duplicate' || kind === 'copy') opDuplicate(op, path, errs, W);
      else if (kind === 'delete') { if (needSel(W, path, errs)) { const gone = new Set([...sel]); cell.shapes = cell.shapes.filter((s) => !gone.has(s.id)); cell.refs = cell.refs.filter((x) => !gone.has(x.id)); gone.forEach((id) => W.removed.add(id)); sel.clear(); } }
      else errs.push(`${path}.op "${op.op}" is not known; use add, transform, resize, set, array, boolean, fill, duplicate or delete`);
    } catch (e) { errs.push(`${path}: ${e.message}`); }
  });
  // what was removed by a later step was not "made"
  for (const id of W.removed) W.created.delete(id);
  for (const s of cell.shapes) if (W.removed.has(s.id)) W.removed.delete(s.id);       // kept after all (e.g. fill with keep_outline)
  const live = new Set([...cell.shapes.map((s) => s.id), ...cell.refs.map((x) => x.id)]);
  const created = [...W.created].filter((id) => live.has(id));
  const changed = [...W.changed].filter((id) => live.has(id) && !W.created.has(id));
  return { lib, errors: errs, warnings: warns, created, changed, removed: [...W.removed].length, stats: summarise(W, lib, cellName, created), newLayers: W.newLayers };
}

function summarise(W, lib, cellName, created) {
  const cell = lib.cells[cellName], ids = new Set(created);
  let n = 0, area = 0, bb = null;
  const memo = new Map(), objs = new Set();
  for (const s of cell.shapes) if (ids.has(s.id)) { n++; objs.add(groupKeyOf(s)); area += Math.abs(shapeArea(s)); bb = unionBBox(bb, bboxWorld(s)); }
  for (const x of cell.refs) if (ids.has(x.id)) { const st = flatStats(lib, x.cell, memo); const k = x.cols * x.rows; n += st.shapes * k; objs.add(x.id); area += k * Object.values(st.area).reduce((a, v) => a + v, 0) * (x.mag || 1) ** 2; bb = unionBBox(bb, refBBox(lib, x)); }
  const minFeature = Math.min(...W.stats.map((s) => s.minFeature).filter(isNum), Infinity);
  const gaps = W.stats.map((s) => s.gap).filter(isNum);
  return { shapes: n, objects: objs.size, area, bbox: bb, minFeature: isFinite(minFeature) ? minFeature : null, minGap: gaps.length ? Math.min(...gaps) : null, patterns: W.stats };
}

// A model's reply: the first JSON object in it (models sometimes wrap it in a code fence or a sentence).
export function parseReply(text) {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const i = body.indexOf('{'), j = body.lastIndexOf('}');
  if (i < 0 || j <= i) throw new SpecError('the reply holds no JSON object');
  let o;
  try { o = JSON.parse(body.slice(i, j + 1)); } catch (e) { throw new SpecError(`the reply is not valid JSON (${e.message})`); }
  if (!o || typeof o !== 'object') throw new SpecError('the reply is not a JSON object');
  o.ops = Array.isArray(o.ops) ? o.ops : [];
  o.reply = String(o.reply || '');
  o.question = String(o.question || '');
  return o;
}
