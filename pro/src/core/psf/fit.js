// Fit an analytic model (double Gaussian, triple Gaussian, or double Gaussian + exponential) to
// a PSF table. Least squares on ln f over the table points, so every
// decade counts; points below `floor`·max(f) are left out. The floor must sit well below the
// backscatter plateau, which at 100 keV is only ~5e-8 of the peak (η α²/β²).
//
// Parameters are fitted in log space: [ln α, ln β, ln η, ln A] (+ [ln γ, ln ν] for the models
// with a mid-range term), where A is an overall amplitude (1 for a normalised table).
//
// Two objectives:
//   'logf'    least squares on ln f at every table point — every decade of f counts equally;
//             right for analytic or smooth tables, but a non-Gaussian halo is then fitted by
//             its far tail (at 100 keV the log fit puts β 25 % below the halo's rms radius)
//   'energy'  least squares on the cumulative energy fraction C(r) at the (log-spaced) table
//             radii — matches where the energy goes, robust to noise in the deep tail; the
//             default for Monte Carlo and imported tables. rms is then in units of energy
//             fraction (0.01 = 1 % of the energy misplaced).

import { gaussianTerms, MODELS } from './analytic.js';
import { fitPLG, splineKnots, splineTable } from './models2.js';
import { gaussAt, termsCumulative, cumulative } from './psf.js';

const hasMid = (model) => !!MODELS[model].mid;

function unpack(x, model) {
  const p = { alpha: Math.exp(x[0]), beta: Math.exp(x[1]), eta: Math.exp(x[2]), A: Math.exp(x[3]), model };
  if (hasMid(model)) { p.gamma = Math.exp(x[4]); p.nu = Math.exp(x[5]); }
  return p;
}

function residuals(x, pts, model, out) {
  const p = unpack(x, model);
  const terms = gaussianTerms(p);
  let ss = 0;
  for (let i = 0; i < pts.r.length; i++) {
    let d;
    if (pts.C) d = p.A * termsCumulative(terms, pts.r[i]) - pts.C[i];
    else { const m = p.A * gaussAt(terms, pts.r[i]); d = (m > 1e-300 ? Math.log(m) : -690) - pts.lnf[i]; }
    if (out) out[i] = d;
    ss += d * d;
  }
  return ss;
}

// Small dense solve (Gaussian elimination with partial pivoting).
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let i = c + 1; i < n; i++) {
      const k = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function levenbergMarquardt(x0, pts, model, maxIter = 300) {
  const n = x0.length, m = pts.r.length;
  let x = [...x0], lambda = 1e-3;
  const r0 = new Float64Array(m), rp = new Float64Array(m), rm = new Float64Array(m);
  let ss = residuals(x, pts, model, r0);
  for (let it = 0; it < maxIter; it++) {
    const J = Array.from({ length: n }, () => new Float64Array(m));
    for (let k = 0; k < n; k++) {
      const h = 1e-6;
      const xp = [...x]; xp[k] += h; residuals(xp, pts, model, rp);
      const xm = [...x]; xm[k] -= h; residuals(xm, pts, model, rm);
      for (let i = 0; i < m; i++) J[k][i] = (rp[i] - rm[i]) / (2 * h);
    }
    const JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => {
      let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * J[b][i]; return s;
    }));
    const JTr = Array.from({ length: n }, (_, a) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * r0[i]; return -s; });
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const dx = solve(A, JTr);
      if (!dx) { lambda *= 10; continue; }
      const xn = x.map((v, k) => v + dx[k]);
      const ssn = residuals(xn, pts, model, null);
      if (ssn < ss) {
        const rel = (ss - ssn) / Math.max(ss, 1e-300);
        x = xn; ss = ssn; residuals(x, pts, model, r0);
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (rel < 1e-14 || ss < 1e-24) return { x, ss };
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return { x, ss };
}

// options: model 'double' | 'triple' | 'gauss-exp' (triple: true is accepted as 'triple')
export function fitGaussians(psf, { model = 'double', triple = false, floor = 1e-15, objective = 'logf' } = {}) {
  if (triple && model === 'double') model = 'triple';
  if (!MODELS[model]) throw new Error(`unknown PSF model ${model}`);
  if (MODELS[model].table) {
    // power-Gaussian / spline: fitted on their own; a double-Gaussian fit gives the grid scale (terms)
    const g = fitGaussians(psf, { model: 'double', floor, objective });
    const C = cumulative(psf.r, psf.f), tot = C[C.length - 1], frac = Array.from(C, (c) => c / tot);
    if (model === 'plg') {
      const P = fitPLG(psf.r, psf.f, frac, g, objective);
      return { alpha: P.alpha, p: P.p, beta: P.beta, eta: P.eta, gamma: null, nu: 0, model, terms: g.terms, amplitude: null, rms: P.rms, objective };
    }
    const knots = splineKnots(psf.r, psf.f), T = splineTable(knots);
    const CT = cumulative(T.r, T.f), at = (R) => { if (R <= T.r[0]) return CT[0] * (R / T.r[0]) ** 2; let i = 0; while (i < T.r.length - 2 && T.r[i + 1] < R) i++; if (R >= T.r[T.r.length - 1]) return CT[CT.length - 1]; const u = Math.log(R / T.r[i]) / Math.log(T.r[i + 1] / T.r[i]); return CT[i] + u * (CT[i + 1] - CT[i]); };
    let ss = 0, n = 0; for (let i = 0; i < psf.r.length; i++) if (psf.f[i] > floor * Math.max(...psf.f.slice(0, 1))) { const d = at(psf.r[i]) - frac[i]; ss += d * d; n++; }
    return { alpha: g.alpha, beta: g.beta, eta: g.eta, gamma: null, nu: 0, model, knots, terms: g.terms, amplitude: null, rms: Math.sqrt(ss / Math.max(1, n)), objective };
  }
  const fmax = Math.max(...psf.f);
  const r = [], lnf = [];
  for (let i = 0; i < psf.r.length; i++) {
    if (psf.f[i] > floor * fmax) { r.push(psf.r[i]); lnf.push(Math.log(psf.f[i])); }
  }
  if (r.length < (hasMid(model) ? 8 : 5)) throw new Error('too few usable points to fit');
  const pts = { r, lnf };
  if (objective === 'energy') {
    // cumulative energy fraction at each table radius (flat disc inside r[0], trapezoid in ln r)
    const C = cumulative(psf.r, psf.f), tot = C[C.length - 1];
    const cr = [], cc = [];
    for (let i = 0; i < psf.r.length; i++) if (psf.f[i] > floor * fmax) { cr.push(psf.r[i]); cc.push(C[i] / tot); }
    pts.r = cr; pts.C = cc;
  }
  const rLo = r[0], rHi = r[r.length - 1];

  // Coarse grid search for the double Gaussian, then LM.
  let best = null;
  for (let i = 0; i < 24; i++) {
    const a = rLo * 2 * Math.pow(rHi / 30 / (rLo * 2), i / 23);
    for (let j = 0; j < 24; j++) {
      const b = a * 5 * Math.pow(rHi / (a * 5), j / 23);
      if (!(b > a)) continue;
      for (let k = 0; k < 16; k++) {
        const e = 0.02 * Math.pow(250, k / 15);
        const x = [Math.log(a), Math.log(b), Math.log(e), 0];
        const ss = residuals(x, pts, 'double', null);
        if (!best || ss < best.ss) best = { x, ss };
      }
    }
  }
  let res = levenbergMarquardt(best.x, pts, 'double');
  if (hasMid(model)) {
    // mid-range term: several starts between α and β, keep the best
    const p = unpack(res.x, 'double');
    let tbest = null;
    for (const gf of [0.1, 0.3, 0.5, 0.7]) {
      const g = Math.exp(Math.log(p.alpha) + gf * Math.log(p.beta / p.alpha));
      for (const nf of [0.03, 0.1, 0.3]) {
        const r1 = levenbergMarquardt([...res.x, Math.log(g), Math.log(nf * p.eta + 1e-3)], pts, model);
        if (!tbest || r1.ss < tbest.ss) tbest = r1;
      }
    }
    res = tbest;
  }
  const p = unpack(res.x, model);
  // keep α < β; swapping the two terms maps η → 1/η and leaves the amplitude unchanged
  if (p.beta < p.alpha) { [p.alpha, p.beta] = [p.beta, p.alpha]; p.eta = 1 / p.eta; }
  const out = { alpha: p.alpha, beta: p.beta, eta: p.eta, gamma: hasMid(model) ? p.gamma : null, nu: hasMid(model) ? p.nu : 0, model, amplitude: p.A };
  out.terms = gaussianTerms(out);
  out.rms = Math.sqrt(res.ss / pts.r.length);   // ln f: 0.01 ≈ 1 % misfit; energy: 0.01 = 1 % of the energy
  out.objective = objective;
  return out;
}

// Fit all three models and report them side by side (for choosing one in the UI).
export function fitAllModels(psf, opts = {}) {
  const out = {};
  for (const m of Object.keys(MODELS)) { try { out[m] = fitGaussians(psf, { ...opts, model: m }); } catch (e) { out[m] = { error: e.message }; } }
  return out;
}
