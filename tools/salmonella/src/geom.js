// Geometry helpers: cell surface parametrisation, dynamic tubes, helices, ribbons, lumpy blobs.
// Scene unit = 1 nm.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3i(x, y, z) {
  let n = (x * 1619 + y * 31337 + z * 6971) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 15), 2246822519) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3i(xi, yi, zi), hash3i(xi + 1, yi, zi), u), l(hash3i(xi, yi + 1, zi), hash3i(xi + 1, yi + 1, zi), u), v),
    l(l(hash3i(xi, yi, zi + 1), hash3i(xi + 1, yi, zi + 1), u), l(hash3i(xi, yi + 1, zi + 1), hash3i(xi + 1, yi + 1, zi + 1), u), v),
    w);
}

// ---------------------------------------------------------------------------
// Cell surface: a capsule (radius R, cylindrical half-length Hc) along the x axis,
// front pole at +x. Meridian parameter m in [0,1] runs from the front pole to the
// rear pole; phi is the angle around the axis (0 = +y). Layers are parallel
// surfaces at signed offset (nm) from the outer membrane mid-plane.
// ---------------------------------------------------------------------------
export const CELL = { R: 400, Hc: 850 };
CELL.Lm = Math.PI * CELL.R + 2 * CELL.Hc;      // meridian length
CELL.halfLen = CELL.Hc + CELL.R;               // 1250
CELL.bend = 30;

const _bumps = (() => {
  const rng = mulberry32(7); const arr = [];
  for (let i = 0; i < 14; i++) {
    const k = TAU / (110 + rng() * 420);
    const dir = new THREE.Vector3(rng() - .5, rng() - .5, rng() - .5).normalize().multiplyScalar(k);
    arr.push({ dir, ph: rng() * TAU, amp: 0.8 + rng() * 1.8 });
  }
  return arr;
})();
export function surfDisp(p) { let d = 0; for (const b of _bumps) d += b.amp * Math.sin(b.dir.dot(p) + b.ph); return d; }
export function bendY(x) { const xn = clamp(x / CELL.halfLen, -1, 1); return CELL.bend * xn * xn; }

const _base = { center: new THREE.Vector3(), dir: new THREE.Vector3() };
export function cellBase(m, phi, out = _base) {
  const { R, Hc } = CELL; const s = m * CELL.Lm; const q = Math.PI * R / 2;
  let cx, dx, sr;
  if (s < q) { const psi = s / R; cx = Hc; dx = Math.cos(psi); sr = Math.sin(psi); }
  else if (s < q + 2 * Hc) { cx = Hc - (s - q); dx = 0; sr = 1; }
  else { const psi = Math.PI / 2 + (s - q - 2 * Hc) / R; cx = -Hc; dx = Math.cos(psi); sr = Math.sin(psi); }
  out.center.set(cx, 0, 0); out.dir.set(dx, sr * Math.cos(phi), sr * Math.sin(phi));
  return out;
}
const _p0 = new THREE.Vector3();
export function cellPoint(m, phi, offset, target) {
  cellBase(m, phi, _base);
  _p0.copy(_base.dir).multiplyScalar(CELL.R).add(_base.center);
  const d = surfDisp(_p0);
  target.copy(_base.dir).multiplyScalar(CELL.R + offset + d).add(_base.center);
  target.y += bendY(target.x);
  return target;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
export function makeFrame() { return { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3(), b: new THREE.Vector3() }; }
// p = point, n = outward normal, t = along +m (toward rear), b = n x t (around)
export function cellFrame(m, phi, offset, out = makeFrame()) {
  m = clamp(m, 2e-4, 1 - 2e-4);
  const e = 1e-3;
  cellPoint(m, phi, offset, out.p);
  cellPoint(Math.min(m + e, 1), phi, offset, _a); cellPoint(Math.max(m - e, 0), phi, offset, _b);
  cellPoint(m, phi + e, offset, _c); cellPoint(m, phi - e, offset, _d);
  out.t.subVectors(_a, _b).normalize();
  _e.subVectors(_c, _d);
  out.n.crossVectors(out.t, _e).normalize();
  cellBase(m, phi, _base);
  if (out.n.dot(_base.dir) < 0) out.n.negate();
  out.b.crossVectors(out.n, out.t).normalize();
  return out;
}
// distance from a point to the cell axis segment (undoing the bend), for inside tests
export function cellRadialDist(p) {
  const y = p.y - bendY(p.x);
  const xc = clamp(p.x, -CELL.Hc, CELL.Hc);
  return Math.hypot(p.x - xc, y, p.z);
}
export function buildCellGeometry(offset, rows = 260, cols = 168) {
  const nv = (rows + 1) * (cols + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const f = makeFrame(); let vi = 0, ui = 0;
  for (let i = 0; i <= rows; i++) {
    const m = i / rows;
    for (let j = 0; j <= cols; j++) {
      const phi = (j / cols) * TAU;
      cellFrame(m, phi, offset, f);
      pos[vi] = f.p.x; pos[vi + 1] = f.p.y; pos[vi + 2] = f.p.z;
      nor[vi] = f.n.x; nor[vi + 1] = f.n.y; nor[vi + 2] = f.n.z;
      uv[ui] = j / cols; uv[ui + 1] = m; vi += 3; ui += 2;
    }
  }
  const idx = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Dynamic tube: a tube around a polyline with stable ring reference directions.
// Attributes: position, normal, uv (u = arc length in nm, v = angle fraction), aTan (tangent).
// ---------------------------------------------------------------------------
const _tmpV = new THREE.Vector3();
export class DynTube {
  constructor(nSeg, nRad, radius) {
    this.nSeg = nSeg; this.nRad = nRad; this.radius = radius;
    const nv = (nSeg + 1) * (nRad + 1);
    this.pos = new Float32Array(nv * 3); this.nor = new Float32Array(nv * 3);
    this.tan = new Float32Array(nv * 3); this.uv = new Float32Array(nv * 2);
    const idx = [];
    for (let i = 0; i < nSeg; i++) for (let k = 0; k < nRad; k++) {
      const a = i * (nRad + 1) + k, b = a + 1, c = a + nRad + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('aTan', new THREE.BufferAttribute(this.tan, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setIndex(idx);
    this.geometry = g;
    this.T = []; this.E1 = []; this.E2 = [];
    for (let i = 0; i <= nSeg; i++) { this.T.push(new THREE.Vector3()); this.E1.push(new THREE.Vector3()); this.E2.push(new THREE.Vector3()); }
    this.seedE1 = new THREE.Vector3(1, 0, 0);
    this.arcTotal = 0;
  }
  // pts: Vector3[nSeg+1]; refs: Vector3[] ring reference directions (optional, else parallel transport)
  // radiusFn(i, arc) optional per-ring radius
  update(pts, refs, radiusFn) {
    const n = this.nSeg, K = this.nRad, T = this.T, E1 = this.E1, E2 = this.E2;
    for (let i = 0; i <= n; i++) {
      T[i].subVectors(pts[Math.min(i + 1, n)], pts[Math.max(i - 1, 0)]);
      if (T[i].lengthSq() < 1e-14) T[i].copy(i > 0 ? T[i - 1] : _tmpV.set(0, 0, 1));
      T[i].normalize();
    }
    for (let i = 0; i <= n; i++) {
      const e1 = E1[i], t = T[i];
      if (refs) e1.copy(refs[i]); else e1.copy(i === 0 ? this.seedE1 : E1[i - 1]);
      e1.addScaledVector(t, -e1.dot(t));
      if (e1.lengthSq() < 1e-8) { _tmpV.set(1, 0, 0); if (Math.abs(t.x) > 0.9) _tmpV.set(0, 1, 0); e1.crossVectors(t, _tmpV); }
      e1.normalize(); E2[i].crossVectors(t, e1);
    }
    let arc = 0, vi = 0, ui = 0;
    const pos = this.pos, nor = this.nor, tan = this.tan, uv = this.uv;
    for (let i = 0; i <= n; i++) {
      if (i > 0) arc += pts[i].distanceTo(pts[i - 1]);
      const r = radiusFn ? radiusFn(i, arc) : this.radius;
      const p = pts[i], e1 = E1[i], e2 = E2[i], t = T[i];
      for (let k = 0; k <= K; k++) {
        const ang = (k / K) * TAU, c = Math.cos(ang), s = Math.sin(ang);
        const nx = c * e1.x + s * e2.x, ny = c * e1.y + s * e2.y, nz = c * e1.z + s * e2.z;
        pos[vi] = p.x + r * nx; pos[vi + 1] = p.y + r * ny; pos[vi + 2] = p.z + r * nz;
        nor[vi] = nx; nor[vi + 1] = ny; nor[vi + 2] = nz;
        tan[vi] = t.x; tan[vi + 1] = t.y; tan[vi + 2] = t.z;
        uv[ui] = arc; uv[ui + 1] = k / K;
        vi += 3; ui += 2;
      }
    }
    this.arcTotal = arc;
    const g = this.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    g.attributes.aTan.needsUpdate = true; g.attributes.uv.needsUpdate = true;
    g.computeBoundingSphere();
  }
}
export function tubeGeometry(pts, radius, nRad = 8, radiusFn) {
  const t = new DynTube(pts.length - 1, nRad, radius);
  t.update(pts, null, radiusFn);
  return t.geometry;
}
export function curvePoints(curve, n) { const arr = []; for (let i = 0; i <= n; i++) arr.push(curve.getPointAt(i / n)); return arr; }

// alpha-helix centre line as a helix around the segment from -> to
export function helixPoints(from, to, radius = 0.23, pitch = 0.54, segsPerTurn = 9, phase = 0) {
  const axis = new THREE.Vector3().subVectors(to, from); const L = axis.length(); const u = axis.clone().normalize();
  const turns = L / pitch; const n = Math.max(6, Math.ceil(turns * segsPerTurn));
  const tmp = new THREE.Vector3(1, 0, 0); if (Math.abs(u.x) > 0.9) tmp.set(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(u, tmp).normalize(); const e2 = new THREE.Vector3().crossVectors(u, e1);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = TAU * turns * i / n + phase;
    pts.push(new THREE.Vector3().copy(from).addScaledVector(u, L * i / n).addScaledVector(e1, radius * Math.cos(th)).addScaledVector(e2, radius * Math.sin(th)));
  }
  return pts;
}
export function helixGeometry(from, to, opts = {}) {
  const pts = helixPoints(from, to, opts.r ?? 0.23, opts.pitch ?? 0.54, opts.segsPerTurn ?? 9, opts.phase ?? 0);
  return tubeGeometry(pts, opts.tube ?? 0.17, opts.nRad ?? 6);
}
// smooth tube through control points (Catmull-Rom)
export function splineTubeGeometry(ctrl, radius, nSeg, nRad = 6, radiusFn) {
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  return tubeGeometry(curvePoints(curve, nSeg), radius, nRad, radiusFn);
}

// Flat ribbon (beta strand) with hard edges. widthDirs: Vector3[] per point (any vector not parallel to the path).
export function stripGeometry(points, widthDirs, w, t) {
  const n = points.length; const pos = [], nor = [], idx = [];
  const T = new THREE.Vector3(), W = new THREE.Vector3(), U = new THREE.Vector3();
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < n; i++) {
    T.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]).normalize();
    W.copy(widthDirs[i]); W.addScaledVector(T, -W.dot(T)).normalize();
    U.crossVectors(T, W).normalize();
    const p = points[i];
    corners[0].copy(p).addScaledVector(W, w / 2).addScaledVector(U, t / 2);
    corners[1].copy(p).addScaledVector(W, -w / 2).addScaledVector(U, t / 2);
    corners[2].copy(p).addScaledVector(W, -w / 2).addScaledVector(U, -t / 2);
    corners[3].copy(p).addScaledVector(W, w / 2).addScaledVector(U, -t / 2);
    const faceN = [U, W.clone().negate(), U.clone().negate(), W];
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f], c1 = corners[(f + 1) % 4], fn = faceN[f];
      pos.push(c0.x, c0.y, c0.z, c1.x, c1.y, c1.z);
      nor.push(fn.x, fn.y, fn.z, fn.x, fn.y, fn.z);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let f = 0; f < 4; f++) {
    const a = i * 8 + f * 2, b = a + 1, c = a + 8, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function lumpySphere(r, detail = 2, amp = 0.25, seed = 1, freq = 1.3) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position; const v = new THREE.Vector3();
  const off = seed * 17.31;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize();
    const nz = noise3(d.x * freq + off, d.y * freq + off * 0.7, d.z * freq + off * 1.3) - 0.5;
    const nz2 = noise3(d.x * freq * 2.7 + 5, d.y * freq * 2.7 + 9, d.z * freq * 2.7 + 2) - 0.5;
    v.multiplyScalar(1 + amp * (nz * 1.4 + nz2 * 0.6));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const g2 = mergeVerts(g); g2.computeVertexNormals();
  return g2;
}
// merge duplicate vertices produced by IcosahedronGeometry (non-indexed) so shading is smooth
function mergeVerts(g) {
  const p = g.attributes.position; const map = new Map(); const pos = []; const idx = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = x.toFixed(5) + '_' + y.toFixed(5) + '_' + z.toFixed(5);
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(x, y, z); }
    idx.push(id);
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g2.setIndex(idx);
  return g2;
}

export const Z_AXIS = new THREE.Vector3(0, 0, 1);
export function quatZTo(dir, q = new THREE.Quaternion()) { return q.setFromUnitVectors(Z_AXIS, dir); }
