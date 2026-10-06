// Exact short-range dose at points.
//
// For a radially symmetric kernel with cumulative energy C(R) = ∫₀^R 2πr f(r) dr, the dose at p
// from a polygon P is a sum over its edges of angular integrals:
//
//   I(p) = 1/(2π) · Σ_edges sign(A×B) ∫_{φ_A}^{φ_B} C( d / cos φ ) dφ
//
// with A, B the edge ends relative to p, d the distance from p to the edge's line, and φ the angle
// from the foot of the perpendicular (tan φ = t/d along the edge). Counter-clockwise outer
// boundaries add, clockwise holes subtract. Exact up to the quadrature tolerance, for any polygon
// and any point (inside, outside, on an edge), and for any C — analytic Gaussians or a table.

import { termsCumulative, isGauss } from '../psf/psf.js';
import { erf } from '../math.js';

// Use the closed-form rectangle path where it applies (off: the general path everywhere).
export const SR_OPTIONS = { rectClosedForm: true };

// C(R) for the short-range part of a split PSF. Analytic terms (Gaussian or exponential) use
// their closed forms; anything else (imported tables) integrates the SR table.
export function srCumulative(split, exactTerms) {
  if (exactTerms) {
    const T = split.sr.terms;
    // gauss: all-Gaussian SR terms, so a Manhattan polygon has a closed form (polygonSR)
    const C = (R) => termsCumulative(T, R), total = T.reduce((a, t) => a + t.w, 0);
    const allGauss = T.length && T.every(isGauss);
    const K = { C, total, rMax: split.rMaxSR, gauss: allGauss ? T : null };
    if (!allGauss && T.length) { const sMin = Math.min(...T.map((t) => t.s)); attachGaussFit(K, sMin, sMin / 4); }
    return K;
  }
  const r = split.r, f = split.sr.f, n = r.length;
  const cum = new Float64Array(n);
  let s = Math.PI * r[0] * r[0] * f[0]; cum[0] = s;
  for (let i = 1; i < n; i++) { s += Math.PI * (r[i - 1] * r[i - 1] * f[i - 1] + r[i] * r[i] * f[i]) * Math.log(r[i] / r[i - 1]); cum[i] = s; }
  const lr0 = Math.log(r[0]), dl = (Math.log(r[n - 1]) - lr0) / (n - 1);
  const isLog = Math.abs(Math.log(r[1] / r[0]) - dl) < 1e-9 * Math.abs(dl);
  const C = (R) => {
    if (R <= r[0]) return cum[0] * (R * R) / (r[0] * r[0]);
    if (R >= r[n - 1]) return cum[n - 1];
    let k;
    if (isLog) k = Math.min(n - 2, Math.floor((Math.log(R) - lr0) / dl));
    else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r[m] < R) lo = m; else hi = m; } k = lo; }
    const t = Math.log(R / r[k]) / Math.log(r[k + 1] / r[k]);
    return cum[k] + t * (cum[k + 1] - cum[k]);
  };
  const K = { C, total: cum[n - 1], rMax: split.rMaxSR };
  // a table says nothing finer than its first radius, and nothing below 1 nm matters to a pattern
  attachGaussFit(K, r[0], Math.max(r[0], 1));
  return K;
}

// A kernel with no Gaussian closed form (an imported or Monte Carlo table, or a fit with an exponential
// term) is represented, for the polygon integrals, as a sum of Gaussians with log-spaced widths and
// non-negative weights fitted to its cumulative energy C(R) on [0, rMax]. It is used only when the fit
// reproduces C(R) within FIT_TOL of the total for every R from rFrom (a table: its first radius, below
// which it holds no information) to rMax; otherwise the exact angular quadrature stays.
// K.fitErr reports the worst deviation found (fraction of the total).
// 0.2 % of the short-range energy: about the bin-to-bin noise of a Monte Carlo table, and a tenth of
// the step between neighbouring dose classes; the fit runs smoothly through that noise.
export const FIT_TOL = 2e-3;
function attachGaussFit(K, rMin, rFrom) {
  const total = K.total, rMax = K.rMax;
  if (!(total > 0) || !(rMax > 0)) return;
  const s0 = Math.max(0.02, 0.5 * Math.min(rMin || 1, rMax / 100)), s1 = rMax / 2;
  const nb = Math.min(64, Math.max(8, Math.ceil(Math.log(s1 / s0) / Math.log(1.15)) + 1));
  const s = Array.from({ length: nb }, (_, j) => s0 * Math.pow(s1 / s0, j / (nb - 1)));
  const nR = 500, R = [];
  const R0 = Math.max(rFrom, 1e-3);
  for (let i = 0; i < nR; i++) R.push(R0 * Math.pow(rMax / R0, i / (nR - 1)));
  // rows: C at each R, plus the total (R = infinity) weighted heavily
  const rows = R.map((r) => s.map((sj) => 1 - Math.exp(-(r * r) / (sj * sj))));
  const rhs = R.map((r) => K.C(r));
  rows.push(s.map(() => 10)); rhs.push(10 * total);
  const w = nnls(rows, rhs);
  if (!w) return;
  let err = 0;
  for (let i = 0; i < nR; i++) { let c = 0; for (let j = 0; j < nb; j++) c += w[j] * rows[i][j]; err = Math.max(err, Math.abs(c - rhs[i])); }
  let sum = 0; for (const x of w) sum += x;
  err = Math.max(err, Math.abs(sum - total)) / Math.abs(total);
  K.fitErr = err;
  if (err <= FIT_TOL) K.gaussFit = s.map((sj, j) => ({ w: w[j], s: sj })).filter((t) => t.w > 0);
}

// Non-negative least squares (Lawson and Hanson): minimise |A w - b| subject to w >= 0.
function nnls(A, b) {
  const m = A.length, n = A[0].length;
  const AtA = Array.from({ length: n }, () => new Float64Array(n)), Atb = new Float64Array(n);
  for (let i = 0; i < m; i++) { const a = A[i]; for (let j = 0; j < n; j++) { Atb[j] += a[j] * b[i]; for (let k = 0; k < n; k++) AtA[j][k] += a[j] * a[k]; } }
  const w = new Float64Array(n), P = new Array(n).fill(false);
  const solveP = () => {                      // least squares restricted to the passive set
    const idx = []; for (let j = 0; j < n; j++) if (P[j]) idx.push(j);
    const k = idx.length, M = idx.map((j) => idx.map((l) => AtA[j][l])), v = idx.map((j) => Atb[j]);
    for (let i = 0; i < k; i++) M[i][i] *= 1 + 1e-12;
    for (let c = 0; c < k; c++) {             // Gaussian elimination with partial pivoting
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]]; [v[c], v[p]] = [v[p], v[c]];
      if (Math.abs(M[c][c]) < 1e-300) return null;
      for (let r = c + 1; r < k; r++) { const f = M[r][c] / M[c][c]; for (let q = c; q < k; q++) M[r][q] -= f * M[c][q]; v[r] -= f * v[c]; }
    }
    const z = new Float64Array(n);
    for (let c = k - 1; c >= 0; c--) { let t = v[c]; for (let q = c + 1; q < k; q++) t -= M[c][q] * z[idx[q]]; z[idx[c]] = t / M[c][c]; }
    return z;
  };
  for (let outer = 0; outer < 3 * n; outer++) {
    const g = new Float64Array(n);
    for (let j = 0; j < n; j++) { let t = Atb[j]; for (let k = 0; k < n; k++) t -= AtA[j][k] * w[k]; g[j] = t; }
    let jmax = -1, gmax = 1e-14 * (Math.abs(Atb.reduce((a, x) => Math.max(a, Math.abs(x)), 0)) + 1e-300);
    for (let j = 0; j < n; j++) if (!P[j] && g[j] > gmax) { gmax = g[j]; jmax = j; }
    if (jmax < 0) break;
    P[jmax] = true;
    for (let inner = 0; inner < 3 * n; inner++) {
      const z = solveP(); if (!z) return null;
      let ok = true; for (let j = 0; j < n; j++) if (P[j] && z[j] <= 0) ok = false;
      if (ok) { for (let j = 0; j < n; j++) w[j] = P[j] ? z[j] : 0; break; }
      let alpha = Infinity; for (let j = 0; j < n; j++) if (P[j] && z[j] <= 0) alpha = Math.min(alpha, w[j] / (w[j] - z[j]));
      for (let j = 0; j < n; j++) { w[j] += alpha * ((P[j] ? z[j] : 0) - w[j]); if (P[j] && w[j] <= 1e-15) { P[j] = false; w[j] = 0; } }
    }
  }
  return w;
}

function simpson(f, a, b, fa, fm, fb, whole, eps, depth) {
  const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
  const flm = f(lm), frm = f(rm);
  const left = ((m - a) / 6) * (fa + 4 * flm + fm), right = ((b - m) / 6) * (fm + 4 * frm + fb);
  const delta = left + right - whole;
  if (depth <= 0 || Math.abs(delta) <= 15 * eps) return left + right + delta / 15;
  return simpson(f, a, m, fa, flm, fm, left, eps / 2, depth - 1) + simpson(f, m, b, fm, frm, fb, right, eps / 2, depth - 1);
}
function integrate(f, a, b, eps) {
  if (b <= a) return 0;
  const fa = f(a), fb = f(b), m = (a + b) / 2, fm = f(m);
  return simpson(f, a, b, fa, fm, fb, ((b - a) / 6) * (fa + 4 * fm + fb), eps, 40);
}

// Angular integral of C(d / cos φ) over the part of an edge between t1 < t2 (along-edge
// coordinates from the foot of the perpendicular). Beyond rMax, C is constant.
function edgeIntegral(K, d, t1, t2, eps) {
  const p1 = Math.atan2(t1, d), p2 = Math.atan2(t2, d);
  if (d >= K.rMax) return K.total * (p2 - p1);
  const pc = Math.acos(d / K.rMax);          // |φ| > pc  ⇒  d/cos φ > rMax  ⇒  C = total
  const f = (phi) => K.C(d / Math.cos(phi));
  let v = 0;
  const lo = Math.max(p1, -pc), hi = Math.min(p2, pc);
  if (hi > lo) v += integrate(f, lo, hi, eps);
  if (p1 < -pc) v += K.total * (Math.min(p2, -pc) - p1);
  if (p2 > pc) v += K.total * (p2 - Math.max(p1, pc));
  return v;
}

// Short-range dose at (x, y) from one closed polygon (unit dose).
export function polygonSR(K, pts, x, y, eps = 1e-10) {
  // Axis-aligned rectangle under Gaussian terms: Σ w/4 · [erf((x2−x)/s) − erf((x1−x)/s)] · [same in y],
  // exact (no quadrature, no rMax truncation). Most fragments of a Manhattan layout are rectangles.
  const G = K.gauss || K.gaussFit;
  // Per-term reach: a Gaussian term whose width is under a sixth of the gap between the point and the
  // polygon's box adds less than erfc(6) ≈ 2e-17 of its weight, so it is skipped (a fitted table kernel
  // has narrow terms that matter only within a nanometre and wide ones that reach hundreds).
  let gx = 0, gy = 0;
  if (G && SR_OPTIONS.rectClosedForm) {
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    for (const q of pts) { if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1]; }
    gx = x < x1 ? x1 - x : x > x2 ? x - x2 : 0; gy = y < y1 ? y1 - y : y > y2 ? y - y2 : 0;
  }
  const gap = Math.max(gx, gy) / 6;
  if (G && pts.length === 4 && SR_OPTIONS.rectClosedForm) {
    const r = axisRect(pts);
    if (r) {
      let v = 0;
      for (const t of G) if (t.s > gap) v += t.w * (erf((r.x2 - x) / t.s) - erf((r.x1 - x) / t.s)) * (erf((r.y2 - y) / t.s) - erf((r.y1 - y) / t.s));
      return (r.sign * v) / 4;
    }
  }
  // Manhattan polygon (every edge horizontal or vertical) under Gaussian terms: by Green's theorem the
  // area integral of a separable kernel is a sum over the vertical edges,
  //   w/4 · Σ (1 + erf((x_e − x)/s)) · [erf((y_end − y)/s) − erf((y_start − y)/s)],
  // exact like the rectangle (which is its simplest case). Holes (clockwise) subtract by themselves.
  if (G && SR_OPTIONS.rectClosedForm && isManhattan(pts)) {
    const n = pts.length;
    let v = 0;
    for (const t of G) {
      if (t.s <= gap) continue;
      let tv = 0;
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        if (a[0] !== b[0] || a[1] === b[1]) continue;      // horizontal (or degenerate) edges add nothing
        tv += (1 + erf((a[0] - x) / t.s)) * (erf((b[1] - y) / t.s) - erf((a[1] - y) / t.s));
      }
      v += t.w * tv;
    }
    return v / 4;
  }
  let sum = 0;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const ax = pts[k][0] - x, ay = pts[k][1] - y;
    const b = pts[(k + 1) % n], bx = b[0] - x, by = b[1] - y;
    const cross = ax * by - ay * bx;
    const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey);
    if (L === 0) continue;
    const d = Math.abs(cross) / L;
    if (d < 1e-9) continue;                   // p on the edge's line: the edge subtends no angle
    const ux = ex / L, uy = ey / L;
    const t1 = ax * ux + ay * uy, t2 = bx * ux + by * uy;
    sum += Math.sign(cross) * edgeIntegral(K, d, t1, t2, eps);
  }
  return sum / (2 * Math.PI);
}

// every edge horizontal or vertical (exact coordinates, as fracturing and rectangles produce them)
function isManhattan(p) {
  for (let k = 0, n = p.length; k < n; k++) { const a = p[k], b = p[(k + 1) % n]; if (a[0] !== b[0] && a[1] !== b[1]) return false; }
  return true;
}

// {x1, x2, y1, y2, sign} if the 4 points are an axis-aligned rectangle (sign +1 counter-clockwise)
function axisRect(p) {
  for (let k = 0; k < 4; k++) { const a = p[k], b = p[(k + 1) & 3]; if (a[0] !== b[0] && a[1] !== b[1]) return null; }
  const x1 = Math.min(p[0][0], p[2][0]), x2 = Math.max(p[0][0], p[2][0]), y1 = Math.min(p[0][1], p[2][1]), y2 = Math.max(p[0][1], p[2][1]);
  if (!(x2 > x1 && y2 > y1)) return null;
  let a2 = 0; for (let k = 0; k < 4; k++) { const a = p[k], b = p[(k + 1) & 3]; a2 += a[0] * b[1] - b[0] * a[1]; }
  return { x1, x2, y1, y2, sign: a2 > 0 ? 1 : -1 };
}

// Bucket index so each point only looks at polygons within rMax.
export function indexPolygons(polys, bucket) {
  let x1 = Infinity, y1 = Infinity;
  for (const p of polys) { x1 = Math.min(x1, p.bb.x1); y1 = Math.min(y1, p.bb.y1); }
  const map = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  polys.forEach((p, idx) => {
    const i0 = Math.floor((p.bb.x1 - x1) / bucket), i1 = Math.floor((p.bb.x2 - x1) / bucket);
    const j0 = Math.floor((p.bb.y1 - y1) / bucket), j1 = Math.floor((p.bb.y2 - y1) / bucket);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(idx);
    }
  });
  return {
    near(x, y, r) {
      const out = new Set();
      const i0 = Math.floor((x - r - x1) / bucket), i1 = Math.floor((x + r - x1) / bucket);
      const j0 = Math.floor((y - r - y1) / bucket), j1 = Math.floor((y + r - y1) / bucket);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = map.get(key(i, j)); if (a) for (const q of a) out.add(q); }
      return out;
    },
  };
}

// Σ dose · SR over polygons near (x, y).
export function srAt(K, polys, index, x, y) {
  let v = 0;
  for (const q of index.near(x, y, K.rMax)) {
    const p = polys[q];
    if (x < p.bb.x1 - K.rMax || x > p.bb.x2 + K.rMax || y < p.bb.y1 - K.rMax || y > p.bb.y2 + K.rMax) continue;
    v += p.dose * polygonSR(K, p.pts, x, y);
  }
  return v;
}

