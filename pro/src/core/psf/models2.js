// Two PSF models that are not sums of Gaussians. Both become radial tables for the exposure engines
// (which already use tables, e.g. for Monte Carlo PSFs); a Gaussian fit of the table gives the grid scale.
//
// Power-Gaussian (PLG): a power-law (Moffat) forward core and a Gaussian backscatter term,
//   f(r) = 1/(1+η) · [ (p−1)/(π α²) · (1 + r²/α²)^(−p)  +  η · e^(−r²/β²) / (π β²) ],   p > 1.
//   The core is sharper than a Gaussian at its centre and has a power-law tail ∝ r^(−2p) that a
//   Gaussian cannot follow; α is its width, p how fast the tail falls. Both terms integrate to 1.
//
// Spline-based: log f against log r through knots (from a Monte Carlo or a measured table), joined by
//   a monotone cubic (Fritsch–Carlson), flat inside the first knot and zero beyond the last; the table
//   is normalised so that it integrates to 1. No formula is imposed on the shape.

import { logGrid } from './psf.js';

// ---------------------------------------------------------------- Power-Gaussian
export function plgAt({ alpha, p, beta, eta }, r) {
  const core = ((p - 1) / (Math.PI * alpha * alpha)) * Math.pow(1 + (r * r) / (alpha * alpha), -p);
  const back = (eta * Math.exp(-(r * r) / (beta * beta))) / (Math.PI * beta * beta);
  return (core + back) / (1 + eta);
}
// energy inside radius R, in closed form
export function plgCumulative({ alpha, p, beta, eta }, R) {
  const core = 1 - Math.pow(1 + (R * R) / (alpha * alpha), 1 - p);
  const back = 1 - Math.exp(-(R * R) / (beta * beta));
  return (core + eta * back) / (1 + eta);
}
// a table out to where the core's tail and the backscatter hold < 1e-6 of the energy
export function plgTable(par, perDecade = 100) {
  const { alpha, p, beta } = par;
  const rCore = alpha * Math.pow(1e6, 1 / (2 * (p - 1)));
  const rMax = Math.min(Math.max(6 * beta, rCore), 1e7);
  const r = logGrid(alpha / 200, rMax, perDecade);
  return { r, f: r.map((x) => plgAt(par, x)) };
}

// Nelder–Mead in n dimensions (small, local)
function nelderMead(fn, x0, steps, iters = 2000) {
  const n = x0.length;
  let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; S.push(x); }
  let F = S.map(fn);
  for (let it = 0; it < iters; it++) {
    const o = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = o.map((i) => S[i]); F = o.map((i) => F[i]);
    if (Math.abs(F[n] - F[0]) < 1e-14 * (1 + Math.abs(F[0])) && it > 50) break;
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const w = S[n], xr = c.map((v, j) => 2 * v - w[j]), fr = fn(xr);
    if (fr < F[0]) { const xe = c.map((v, j) => 3 * v - 2 * w[j]), fe = fn(xe); if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; } }
    else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
    else { const xc = c.map((v, j) => (v + w[j]) / 2), fc = fn(xc); if (fc < F[n]) { S[n] = xc; F[n] = fc; } else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => (v + S[0][j]) / 2); F[i] = fn(S[i]); } }
  }
  return { x: S[0], f: F[0] };
}

// Fit the PLG to a table. objective 'energy': the cumulative energy fraction (the Monte Carlo default);
// 'logf': ln f with a free amplitude. start: a double-Gaussian fit {alpha, beta, eta}.
export function fitPLG(r, f, cumulativeFrac, start, objective = 'energy') {
  const use = []; const fmax = Math.max(...f);
  for (let i = 0; i < r.length; i++) if (f[i] > 1e-15 * fmax) use.push(i);
  const unpack = (x) => ({ alpha: Math.exp(x[0]), p: 1 + Math.exp(x[1]), beta: Math.exp(x[2]), eta: Math.exp(x[3]) });
  const cost = (x) => {
    const par = unpack(x);
    if (!(par.beta > par.alpha) || par.p > 50) return 1e9;
    let ss = 0;
    if (objective === 'energy') { for (const i of use) { const d = plgCumulative(par, r[i]) - cumulativeFrac[i]; ss += d * d; } return ss / use.length; }
    const res = use.map((i) => Math.log(Math.max(plgAt(par, r[i]), 1e-300)) - Math.log(f[i]));
    const m = res.reduce((a, b) => a + b, 0) / res.length;          // free amplitude
    for (const v of res) ss += (v - m) ** 2;
    return ss / use.length;
  };
  let best = null;
  for (const p0 of [1.3, 1.8, 3, 6]) for (const af of [0.5, 1, 2]) {
    const x0 = [Math.log(start.alpha * af), Math.log(p0 - 1), Math.log(start.beta), Math.log(Math.max(start.eta, 1e-3))];
    const res = nelderMead(cost, x0, [0.3, 0.4, 0.2, 0.3]);
    if (!best || res.f < best.f) best = res;
  }
  const par = unpack(best.x);
  return { ...par, rms: Math.sqrt(best.f) };
}

// ---------------------------------------------------------------- Spline-based
// Knots from a table: log-spaced (perDecade), each the table's value at that radius (interpolated in
// log–log), from the first radius to where f falls below floor·f(0); log f is then kept non-increasing
// outward (Monte Carlo noise can make a small bump in the far tail).
export function splineKnots(r, f, { perDecade = 10, floor = 1e-13 } = {}) {
  const fmax = Math.max(...f);
  let iEnd = r.length - 1; while (iEnd > 0 && !(f[iEnd] > floor * fmax)) iEnd--;
  const r0 = r[0], r1 = r[iEnd], n = Math.max(4, Math.ceil(Math.log10(r1 / r0) * perDecade) + 1), step = Math.log(r1 / r0) / (n - 1);
  const knots = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const rk = k === n - 1 ? r1 : r0 * Math.exp(step * k);
    while (j < iEnd - 1 && r[j + 1] < rk) j++;
    const a = Math.max(f[j], 1e-300), b = Math.max(f[j + 1], 1e-300), u = Math.log(rk / r[j]) / Math.log(r[j + 1] / r[j]);
    knots.push([rk, Math.exp(Math.log(a) + Math.min(1, Math.max(0, u)) * (Math.log(b) - Math.log(a)))]);
  }
  for (let k = 1; k < knots.length; k++) if (knots[k][1] > knots[k - 1][1]) knots[k][1] = knots[k - 1][1];
  return knots;
}
// Monotone cubic Hermite (Fritsch–Carlson) in (ln r, ln f), on a log grid; flat inside the first knot,
// zero beyond the last.
export function splineTable(knots, perDecade = 100) {
  const X = knots.map((k) => Math.log(k[0])), Y = knots.map((k) => Math.log(k[1])), n = X.length;
  const d = []; for (let i = 0; i < n - 1; i++) d.push((Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const at = (x) => {
    if (x <= X[0]) return Y[0];
    let i = 0; while (i < n - 2 && x > X[i + 1]) i++;
    const h = X[i + 1] - X[i], t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
  const r = logGrid(knots[0][0] / 20, knots[n - 1][0], perDecade);
  const f = r.map((x) => Math.exp(at(Math.log(x))));
  // normalise: ∫ 2π r f dr = 1 (a flat disc inside r[0], trapezoids in ln r)
  let tot = Math.PI * r[0] * r[0] * f[0];
  for (let i = 1; i < r.length; i++) tot += Math.PI * (r[i] * r[i] * f[i] + r[i - 1] * r[i - 1] * f[i - 1]) * Math.log(r[i] / r[i - 1]);
  return { r, f: f.map((v) => v / tot) };
}
