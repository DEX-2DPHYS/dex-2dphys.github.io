// Editor shapes, ported from Pattern Studio §1–2.
//
// Units nm, y up, rotation in degrees counter-clockwise. Every shape keeps its own centre
// (cx, cy) and rotation; polygons store their corners relative to the centre (`pts`, local).
//
//   { id, kind: 'rect'|'circle'|'poly', layer: 'L/D', cx, cy, rot,
//     hw, hh            (rect: half width / half height)
//     r                 (circle)
//     pts: [[x, y], …]  (poly, local, unrotated)
//     dose              target dose, µC/cm² (what the pattern asks for)
//     writeDose         dose the beam writes after correction; null = write the target
//     groupId }         fused object (union, one uniform dose); null = on its own

let uidN = 0;
export const uid = (p) => `${p}${(++uidN).toString(36)}_${Date.now().toString(36)}`;

const MIN = 0.1;   // nm; a shape never collapses to zero size while it is being dragged

export function makeRect(cx, cy, hw, hh, dose, layer = '1/0') {
  return { id: uid('r'), kind: 'rect', layer, cx, cy, rot: 0, hw: Math.max(hw, MIN), hh: Math.max(hh, MIN), dose, writeDose: null, groupId: null };
}
export function makeCircle(cx, cy, r, dose, layer = '1/0') {
  return { id: uid('c'), kind: 'circle', layer, cx, cy, rot: 0, r: Math.max(r, MIN), dose, writeDose: null, groupId: null };
}
// From world-coordinate corners [[x,y],…]; the centre is the vertex mean (as in PPS).
export function makePoly(worldPts, dose, layer = '1/0') {
  let cx = 0, cy = 0;
  for (const [x, y] of worldPts) { cx += x; cy += y; }
  cx /= worldPts.length; cy /= worldPts.length;
  return { id: uid('p'), kind: 'poly', layer, cx, cy, rot: 0, pts: worldPts.map(([x, y]) => [x - cx, y - cy]), dose, writeDose: null, groupId: null };
}

export function cloneShape(s) {
  const c = { ...s };
  if (s.pts) c.pts = s.pts.map((p) => [p[0], p[1]]);
  return c;
}

export const groupKeyOf = (s) => s.groupId || s.id;
export const effDose = (s) => (s.writeDose != null ? s.writeDose : s.dose || 0);
export const isCorrected = (s) => s.writeDose != null;

// ---- local <-> world ----
export function toLocal(s, x, y) {
  const t = (-s.rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t), dx = x - s.cx, dy = y - s.cy;
  return [dx * c - dy * sn, dx * sn + dy * c];
}
export function toWorld(s, lx, ly) {
  const t = (s.rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  return [s.cx + lx * c - ly * sn, s.cy + lx * sn + ly * c];
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Signed distance to the outline, negative inside.
export function signedDistance(s, x, y) {
  const [px, py] = toLocal(s, x, y);
  if (s.kind === 'rect') {
    const dx = Math.abs(px) - s.hw, dy = Math.abs(py) - s.hh;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  }
  if (s.kind === 'circle') return Math.hypot(px, py) - s.r;
  const pts = s.pts;
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
    const t = clamp((wx * vx + wy * vy) / Math.max(1e-12, vx * vx + vy * vy), 0, 1);
    const dd = Math.hypot(wx - t * vx, wy - t * vy);
    if (dd < d) d = dd;
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay || 1e-12) + ax) inside = !inside;
  }
  return inside ? -d : d;
}

export function inside(s, x, y) {
  const [px, py] = toLocal(s, x, y);
  if (s.kind === 'rect') return Math.abs(px) <= s.hw && Math.abs(py) <= s.hh;
  if (s.kind === 'circle') return px * px + py * py <= s.r * s.r;
  const pts = s.pts;
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay || 1e-12) + ax) ins = !ins;
  }
  return ins;
}

// Number of segments for a circle so the chord error stays below tol (nm).
export function circleSegments(r, tol = 1) {
  if (r <= tol) return 8;
  return clamp(Math.ceil(Math.PI / Math.acos(1 - tol / r)), 16, 4096);
}

export function outlineLocal(s, tol = 1) {
  if (s.kind === 'rect') return [[-s.hw, -s.hh], [s.hw, -s.hh], [s.hw, s.hh], [-s.hw, s.hh]];
  if (s.kind === 'circle') {
    const n = circleSegments(s.r, tol), out = [];
    for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; out.push([s.r * Math.cos(t), s.r * Math.sin(t)]); }
    return out;
  }
  return s.pts;
}
export const outlineWorld = (s, tol = 1) => outlineLocal(s, tol).map(([x, y]) => toWorld(s, x, y));

// Reshape handles in local coordinates.
export function handlesLocal(s) {
  if (s.kind === 'rect') return [[-s.hw, -s.hh], [s.hw, -s.hh], [s.hw, s.hh], [-s.hw, s.hh]];
  if (s.kind === 'circle') return [[s.r, 0], [0, s.r], [-s.r, 0], [0, -s.r]];
  return s.pts;
}

export function bboxLocal(s) {
  if (s.kind === 'rect') return { x1: -s.hw, y1: -s.hh, x2: s.hw, y2: s.hh };
  if (s.kind === 'circle') return { x1: -s.r, y1: -s.r, x2: s.r, y2: s.r };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of s.pts) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
  return { x1, y1, x2, y2 };
}

export function bboxWorld(s) {
  if (s.kind === 'circle') return { x1: s.cx - s.r, y1: s.cy - s.r, x2: s.cx + s.r, y2: s.cy + s.r };
  // unrotated shapes: no trigonometry (this is called per shape per frame on large layouts)
  if (!s.rot) {
    if (s.kind === 'rect') return { x1: s.cx - s.hw, y1: s.cy - s.hh, x2: s.cx + s.hw, y2: s.cy + s.hh };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of s.pts) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
    return { x1: s.cx + x1, y1: s.cy + y1, x2: s.cx + x2, y2: s.cy + y2 };
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of outlineWorld(s)) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
  return { x1, y1, x2, y2 };
}

export function area(s) {
  if (s.kind === 'rect') return 4 * s.hw * s.hh;
  if (s.kind === 'circle') return Math.PI * s.r * s.r;
  let a = 0;
  const p = s.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

const um = (nm, d = 3) => (nm / 1000).toFixed(d);
export function describe(s) {
  const b = bboxLocal(s);
  if (s.kind === 'rect') return `rectangle ${um(2 * s.hw)} × ${um(2 * s.hh)} µm, ${s.rot.toFixed(1)}°`;
  if (s.kind === 'circle') return `circle Ø ${um(2 * s.r)} µm`;
  return `polygon, ${s.pts.length} corners, bbox ${um(b.x2 - b.x1)} × ${um(b.y2 - b.y1)} µm, ${s.rot.toFixed(1)}°`;
}

// Snap everything that is a coordinate to the 1 nm database grid (on commit, not while dragging).
export function roundToDbu(s) {
  s.cx = Math.round(s.cx); s.cy = Math.round(s.cy);
  if (s.kind === 'rect') { s.hw = Math.max(0.5, Math.round(2 * s.hw) / 2); s.hh = Math.max(0.5, Math.round(2 * s.hh) / 2); }
  else if (s.kind === 'circle') s.r = Math.max(1, Math.round(s.r));
  else s.pts = s.pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  return s;
}

// Apply a GDS-style placement {x, y, rot, mag, mirrorX} to a shape (used to explode a cell
// instance into its parent). Mirror about x maps local y → −y and rotation θ → −θ.
export function transformShape(s, { x = 0, y = 0, rot = 0, mag = 1, mirrorX = false }) {
  const c = cloneShape(s);
  const t = (rot * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  const ux = s.cx * mag, uy = (mirrorX ? -s.cy : s.cy) * mag;
  c.cx = x + ux * cs - uy * sn;
  c.cy = y + ux * sn + uy * cs;
  c.rot = (mirrorX ? -s.rot : s.rot) + rot;
  if (s.kind === 'rect') { c.hw = s.hw * mag; c.hh = s.hh * mag; }
  else if (s.kind === 'circle') c.r = s.r * mag;
  else c.pts = s.pts.map(([px, py]) => [px * mag, (mirrorX ? -py : py) * mag]);
  return c;
}

// Ramer–Douglas–Peucker simplification of a freehand outline (PPS lasso).
export function rdp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = pts[i0], [bx, by] = pts[i1];
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
    let best = -1, bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const wx = pts[i][0] - ax, wy = pts[i][1] - ay;
      const t = len2 > 1e-15 ? clamp((wx * vx + wy * vy) / len2, 0, 1) : 0;
      const d = Math.hypot(wx - t * vx, wy - t * vy);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = true; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
