// 2D affine transforms. M = {a, b, c, d, e, f}:  x' = a·x + c·y + e,  y' = b·x + d·y + f
// (the same layout as canvas setTransform / DOMMatrix 2D).
//
// GDS reference semantics (SREF/AREF STRANS): reflect about the x axis first (y → −y), then
// magnify, then rotate counter-clockwise by `rot` degrees, then translate.

export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function make(a, b, c, d, e, f) { return { a, b, c, d, e, f }; }

// p ∘ q : apply q first, then p
export function compose(p, q) {
  return {
    a: p.a * q.a + p.c * q.b,
    b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d,
    d: p.b * q.c + p.d * q.d,
    e: p.a * q.e + p.c * q.f + p.e,
    f: p.b * q.e + p.d * q.f + p.f,
  };
}

export function invert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-300) throw new Error('singular transform');
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export const apply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

export const scaleOf = (m) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

// Linear part of a GDS transform: mirror about x, magnify, rotate.
export function gdsLinear({ rot = 0, mag = 1, mirrorX = false }) {
  const t = (rot * Math.PI) / 180;
  // exact values at multiples of 90° keep integer layouts integer
  let cs = Math.cos(t), sn = Math.sin(t);
  const q = rot / 90;
  if (Number.isInteger(q)) { const k = ((q % 4) + 4) % 4; cs = [1, 0, -1, 0][k]; sn = [0, 1, 0, -1][k]; }
  const my = mirrorX ? -1 : 1;
  return { a: mag * cs, b: mag * sn, c: -mag * sn * my, d: mag * cs * my, e: 0, f: 0 };
}

export function gdsTransform({ x = 0, y = 0, rot = 0, mag = 1, mirrorX = false }) {
  const L = gdsLinear({ rot, mag, mirrorX });
  return { ...L, e: x, f: y };
}

// Axis-aligned bounding box of a transformed box {x1,y1,x2,y2}.
export function applyBBox(m, bb) {
  if (!bb) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]) {
    const [u, v] = apply(m, x, y);
    if (u < x1) x1 = u; if (u > x2) x2 = u; if (v < y1) y1 = v; if (v > y2) y2 = v;
  }
  return { x1, y1, x2, y2 };
}

export function unionBBox(a, b) {
  if (!a) return b; if (!b) return a;
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}

export const bboxOverlap = (a, b) => !!a && !!b && a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
