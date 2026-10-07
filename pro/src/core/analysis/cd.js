// Analysis: from a delivered-dose profile across a feature to the questions a user asks at the
// machine — what dose gives the drawn width, how forgiving is it, can one dose print every
// feature, and what do my measured widths say about the PSF and the resist.
//
// Everything rests on one fact: exposure is linear. The dose along a probe (a cut-line across a
// feature) at base dose B is B · p(s), where p is the profile at unit base dose (delivered dose ÷
// nominal dose). The resist clears (positive) or stays (negative) where B · p(s) ≥ D100, so the
// developed width at every dose comes from ONE profile, read at the height D100 / B. A width-versus-
// dose curve is the profile turned on its side; the steeper the profile at the edge, the flatter
// the curve and the wider the dose window.
//
// Units: positions in nm along the probe (0 at its middle), doses in µC/cm².

import { makePSF, logGrid, gaussAt } from '../psf/psf.js';

// ---------------------------------------------------------------- probes
// probe = { id, name, a: [x, y], b: [x, y] }   (nm, world). Positions s run from −L/2 to +L/2.
export function probeFrame(probe) {
  const dx = probe.b[0] - probe.a[0], dy = probe.b[1] - probe.a[1], L = Math.hypot(dx, dy);
  if (!(L > 0)) throw new Error('a probe needs two different end points');
  return { L, ux: dx / L, uy: dy / L, cx: (probe.a[0] + probe.b[0]) / 2, cy: (probe.a[1] + probe.b[1]) / 2 };
}
export const pointAt = (F, s) => [F.cx + F.ux * s, F.cy + F.uy * s];

// Uniform samples along the probe, then dense windows around given positions (the drawn edges),
// so a 100 µm pad's edge is still located to a nanometre or two.
export function sampleProbe(probe, { n = 801, around = [], half = null, step = null } = {}) {
  const F = probeFrame(probe), s = [];
  for (let i = 0; i < n; i++) s.push(-F.L / 2 + (F.L * i) / (n - 1));
  const h = half ?? Math.min(2000, F.L / 8), d = step ?? Math.max(0.5, Math.min(2, F.L / 4000));
  for (const e of around) for (let x = Math.max(-F.L / 2, e - h); x <= Math.min(F.L / 2, e + h); x += d) s.push(x);
  s.sort((a, b) => a - b);
  const u = s.filter((x, i) => !i || x - s[i - 1] > 1e-6);
  return { s: Float64Array.from(u), points: u.map((x) => pointAt(F, x)), frame: F };
}

// Profiles along a probe, for several scenarios at once. query(points, scenarios) → { key: values }
// (the exposure worker's 'profiles' request, or an engine directly in Node). A coarse pass finds the
// drawn edges from the designed dose; a second pass samples densely around them. The profiles come
// back per unit base dose: delivered ÷ nominal.
export async function probeProfiles(probe, scenarios, query, { nominal = 100, n = 801, maxEdges = 8 } = {}) {
  const designed = { key: '__designed', field: 'designed' };
  const c = sampleProbe(probe, { n });
  const v0 = await query(c.points, [designed]);
  const d0 = v0.__designed;
  const edges = [];                                  // wherever the designed dose changes (features of any dose)
  for (let i = 1; i < c.s.length; i++) if (Math.abs(d0[i] - d0[i - 1]) > 1e-9 * (Math.abs(d0[i]) + Math.abs(d0[i - 1]))) edges.push((c.s[i - 1] + c.s[i]) / 2);
  edges.sort((a, b) => Math.abs(a) - Math.abs(b));
  const f = sampleProbe(probe, { n, around: edges.slice(0, maxEdges) });
  const v = await query(f.points, [designed, ...scenarios]);
  const profiles = {};
  for (const sc of scenarios) profiles[sc.key] = Float64Array.from(v[sc.key], (x) => x / nominal);
  const drawn = drawnFeature(f.s, v.__designed, 0);
  if (drawn && !drawn.open) {
    // the designed dose is a step: its edges to a fraction of a nanometre by bisection (both at once)
    const F = f.frame, half = drawn.dose / 2;
    const br = [drawn.left, drawn.right].map((e) => { let k = 0; while (k < f.s.length - 2 && f.s[k + 1] < e) k++; return [f.s[k], f.s[k + 1]]; });
    for (let it = 0; it < 24; it++) {
      const mids = br.map(([a, b]) => (a + b) / 2);
      const q = (await query(mids.map((x) => pointAt(F, x)), [designed])).__designed;
      // left edge: inside is to the right; right edge: inside is to the left
      br[0] = q[0] >= half ? [br[0][0], mids[0]] : [mids[0], br[0][1]];
      br[1] = q[1] >= half ? [mids[1], br[1][1]] : [br[1][0], mids[1]];
    }
    drawn.left = (br[0][0] + br[0][1]) / 2; drawn.right = (br[1][0] + br[1][1]) / 2;
    drawn.width = drawn.right - drawn.left; drawn.centre = (drawn.left + drawn.right) / 2;
  }
  // the other drawn features along the probe: a developed run that reaches one has merged with it
  const others = [], dz = v.__designed;
  for (let i = 0; i < f.s.length;) {
    if (!(dz[i] > 0)) { i++; continue; }
    let j = i; while (j + 1 < f.s.length && dz[j + 1] > 0) j++;
    const o = { left: f.s[i], right: f.s[j] };
    if (!drawn || o.right < drawn.left - 1e-6 || o.left > drawn.right + 1e-6) others.push(o);
    i = j + 1;
  }
  return { s: f.s, designed: Float64Array.from(v.__designed), profiles, drawn, others, frame: f.frame, ref: drawn ? drawn.centre : 0 };
}

// ---------------------------------------------------------------- reading a profile
// The run of samples at or above `level` that holds (or is nearest to) the reference position,
// with its two crossings found by linear interpolation. → { cd, left, right, openL, openR }
// cd = 0 when nothing reaches the level. open*: the run reaches the end of the probe (the feature
// has merged with its neighbour, or the probe is too short).
// others: the other drawn features along the probe [{left, right}]; a run that reaches one has merged.
export function runAt(s, v, level, ref = 0, others = null) {
  const n = s.length;
  let k = 0; while (k < n - 1 && s[k + 1] <= ref) k++;
  if (!(v[k] >= level) && !(v[k + 1] >= level)) {                    // ref not inside: the nearest run
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (v[i] >= level && Math.abs(s[i] - ref) < bd) { bd = Math.abs(s[i] - ref); best = i; }
    if (best < 0) return { cd: 0, left: ref, right: ref, openL: false, openR: false, merged: false };
    // a run inside another drawn feature is that feature's, not this one's: this one has not cleared
    if (others && others.some((o) => s[best] >= o.left - 1e-6 && s[best] <= o.right + 1e-6)) return { cd: 0, left: ref, right: ref, openL: false, openR: false, merged: false };
    k = best;
  } else if (!(v[k] >= level)) k++;
  let i0 = k; while (i0 > 0 && v[i0 - 1] >= level) i0--;
  let i1 = k; while (i1 < n - 1 && v[i1 + 1] >= level) i1++;
  const cross = (a, b) => s[a] + (level - v[a]) * (s[b] - s[a]) / (v[b] - v[a]);
  const left = i0 > 0 ? cross(i0 - 1, i0) : s[0], right = i1 < n - 1 ? cross(i1, i1 + 1) : s[n - 1];
  const merged = !!others && others.some((o) => o.right > left && o.left < right);
  return { cd: right - left, left, right, openL: i0 === 0, openR: i1 === n - 1, merged };
}

// Drawn feature: the designed (target) dose is a step; its half height marks the drawn edges.
// The feature is the one under the reference point (its designed dose there), else the nearest one;
// the probe may cross features of other doses (a dose-300 array beside a dose-100 pad).
export function drawnFeature(s, designed, ref = 0) {
  let k = 0; while (k < s.length - 1 && s[k + 1] <= ref) k++;
  let d = designed[k];
  if (!(d > 0)) { let bd = Infinity; for (let i = 0; i < s.length; i++) if (designed[i] > 0 && Math.abs(s[i] - ref) < bd) { bd = Math.abs(s[i] - ref); d = designed[i]; } }
  if (!(d > 0)) return null;
  const r = runAt(s, designed, 0.5 * d, ref);
  return { width: r.cd, left: r.left, right: r.right, centre: (r.left + r.right) / 2, dose: d, open: r.openL || r.openR };
}

// Developed width at base dose B: where B · p ≥ D100.
export const cdAt = (s, p, B, D100, ref = 0, others = null) => runAt(s, p, D100 / B, ref, others);

// Base dose at which the width is `target` (CD grows with dose). Bisection in log dose.
// → { dose } | { dose: null, why }
export function doseForWidth(s, p, D100, target, ref = 0, { lo = 1, hi = 1e6, others = null } = {}) {
  const w = (B) => cdAt(s, p, B, D100, ref, others);
  const gone = (r) => r.openL || r.openR || r.merged;
  const wl = w(lo), wh = w(hi);
  if (wl.cd >= target) return { dose: null, why: 'already wider at the lowest dose' };
  if (wh.cd < target && !gone(wh)) return { dose: null, why: 'never this wide' };
  let a = Math.log(lo), b = Math.log(hi);
  for (let it = 0; it < 80; it++) {
    const m = (a + b) / 2, r = w(Math.exp(m));
    if (r.cd >= target || gone(r)) b = m; else a = m;
  }
  const B = Math.exp(b), r = w(B);
  if (gone(r)) return { dose: null, why: 'the feature merges with its neighbours before it reaches this width', mergeDose: B };
  return { dose: B };
}

// Dose window: the doses that keep the width within ±tol of the target, and stop where the feature
// merges with a neighbour. → { lo, hi, latitude (hi/lo − 1), toSize } (nulls when there is none)
export function doseWindow(s, p, D100, target, tol = 0.1, ref = 0, others = null) {
  const toSize = doseForWidth(s, p, D100, target, ref, { others });
  const a = doseForWidth(s, p, D100, target * (1 - tol), ref, { others });
  const b = doseForWidth(s, p, D100, target * (1 + tol), ref, { others });
  const lo = a.dose, hi = b.dose ?? b.mergeDose ?? null;
  const ok = lo != null && hi != null && hi > lo;
  return { lo: ok ? lo : null, hi: ok ? hi : null, latitude: ok ? hi / lo - 1 : 0, toSize: toSize.dose, why: toSize.why || a.why || null, mergeDose: b.mergeDose ?? null };
}

// The steepness of the profile where the edge lands: |d ln p / ds| at both crossings (1/nm). The
// exposure latitude follows from it: dCD / d(ln dose) = 1/slopeL + 1/slopeR.
export function edgeSlope(s, p, B, D100, ref = 0) {
  const r = cdAt(s, p, B, D100, ref);
  if (!(r.cd > 0)) return null;
  // derivative of ln p at x from the cubic through the four samples around it (a one-sided
  // difference is several % off where the profile turns over within a few nm)
  const at = (x) => {
    let k = 0; while (k < s.length - 2 && s[k + 1] < x) k++;
    const i0 = Math.max(0, Math.min(s.length - 4, k - 1)), xs = [], ys = [];
    for (let i = i0; i < i0 + 4; i++) { xs.push(s[i]); ys.push(Math.log(Math.max(p[i], 1e-30))); }
    let d = 0;
    for (let i = 0; i < 4; i++) {                    // d/dx of the Lagrange basis polynomial i at x
      let den = 1; for (let j = 0; j < 4; j++) if (j !== i) den *= xs[i] - xs[j];
      let num = 0;
      for (let m = 0; m < 4; m++) { if (m === i) continue; let t = 1; for (let j = 0; j < 4; j++) if (j !== i && j !== m) t *= x - xs[j]; num += t; }
      d += ys[i] * num / den;
    }
    return Math.abs(d);
  };
  const sl = at(r.left), sr = at(r.right);
  return { left: sl, right: sr, dCDdlnD: 1 / sl + 1 / sr };
}

// The doses that suit every feature at once
export function commonWindow(windows) {
  let lo = 0, hi = Infinity;
  for (const w of windows) { if (w.lo == null) return null; lo = Math.max(lo, w.lo); hi = Math.min(hi, w.hi); }
  return hi > lo ? { lo, hi, latitude: hi / lo - 1 } : null;
}

// ---------------------------------------------------------------- probes from the layout
// One probe per kind of feature: every distinct shape (by cell and shape) once, at the instance
// nearest the middle of its array (where the surroundings are densest), across its narrow side.
// shapesInView(cb) is the caller's walk over the flattened layout: cb(shape, T, cellName, k).
export function autoProbes(walk, { max = 8, minWidth = 1 } = {}) {
  const kinds = new Map();
  walk((sh, world, key, centreDist) => {
    const k = key;
    const prev = kinds.get(k);
    if (!prev || centreDist < prev.centreDist) kinds.set(k, { sh, world, centreDist, count: (prev?.count || 0) + 1 });
    else prev.count++;
  });
  const out = [];
  for (const [key, e] of kinds) {
    const w = e.world;                                              // { cx, cy, w, h, angle (deg) of the long side }
    const narrow = Math.min(w.w, w.h);
    if (!(narrow >= minWidth)) continue;
    const half = Math.max(1.5 * narrow, narrow / 2 + 400);
    const ang = ((w.w >= w.h ? 90 : 0) + (w.angle || 0)) * Math.PI / 180;   // across the narrow side
    const ux = Math.cos(ang), uy = Math.sin(ang);
    out.push({ key, count: e.count, narrow, probe: { a: [w.cx - ux * half, w.cy - uy * half], b: [w.cx + ux * half, w.cy + uy * half] } });
  }
  // the most telling first: the narrowest features, then the most numerous
  out.sort((a, b) => a.narrow - b.narrow || b.count - a.count);
  return out.slice(0, max);
}

// ---------------------------------------------------------------- calibration
// One PSF term as a PSF of its own (unit weight), for profiles that combine linearly:
// p(η, ν) = (P_fwd + η P_back + ν P_mid) / (1 + η + ν). A zero-weight wide Gaussian keeps the
// exposure engine's long-range grid as coarse as for the full PSF.
export function termPSF(term, wideNm) {
  const terms = [{ w: 1, s: term.s, kind: term.kind || 'gauss', label: term.label || 'term' }];
  if (wideNm > term.s * 1.5) terms.push({ w: 0, s: wideNm, kind: 'gauss', label: 'scale' });
  const r = logGrid(Math.min(...terms.map((t) => t.s)) / 200, Math.max(...terms.map((t) => (t.kind === 'exp' ? 20 : 6) * t.s)), 60);
  const f = r.map((x) => gaussAt(terms, x));
  return makePSF({ r, f, gauss: terms, fit: { alpha: term.s, beta: wideNm || term.s, eta: 0, gamma: null, nu: 0, model: 'double', terms, rms: 0 }, meta: { source: 'term', label: term.label } });
}

export const combine = (P, eta, nu = 0) => {
  const n = P.fwd.length, out = new Float64Array(n), N = 1 + eta + nu;
  for (let i = 0; i < n; i++) out[i] = (P.fwd[i] + eta * P.back[i] + (P.mid ? nu * P.mid[i] : 0)) / N;
  return out;
};

// Measured widths → clearing dose D100 (and η). items: [{ s, P: {fwd, back, mid?}, ref, meas: [{dose, cd}] }]
// The fit minimises Σ (model − measured)² in nm²; a feature the model does not clear counts its whole
// measured width as the error. Nelder–Mead on (ln D100, ln η).
export function calibrate(items, { D100: D0, eta: e0, nu = 0, fitEta = true } = {}) {
  const pts = items.flatMap((it) => it.meas.map((m) => ({ it, ...m })));
  if (!pts.length) throw new Error('no measured widths to fit');
  const cache = new Map();
  const prof = (it, eta) => { const k = `${items.indexOf(it)}|${eta}`; if (!cache.has(k)) cache.set(k, combine(it.P, eta, nu)); return cache.get(k); };
  const cost = (lnD, lnE) => {
    const D = Math.exp(lnD), eta = fitEta ? Math.exp(lnE) : e0;
    let c = 0;
    for (const q of pts) { const r = cdAt(q.it.s, prof(q.it, eta), q.dose, D, q.it.ref); const e = (r.openL || r.openR) ? 2 * q.cd : r.cd - q.cd; c += e * e; }
    return c / pts.length;
  };
  // Nelder–Mead (2 parameters, or 1 with η fixed)
  const dim = fitEta ? 2 : 1;
  let simplex = [[Math.log(D0), Math.log(Math.max(e0, 0.01))]];
  simplex.push([simplex[0][0] + 0.3, simplex[0][1]]);
  if (dim === 2) simplex.push([simplex[0][0], simplex[0][1] + 0.4]);
  let vals = simplex.map((p) => cost(...p));
  for (let it = 0; it < 300; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    if (Math.abs(vals[dim] - vals[0]) < 1e-6 * (1 + vals[0]) && it > 20) break;
    const c = [0, 0]; for (let i = 0; i < dim; i++) for (let j = 0; j < 2; j++) c[j] += simplex[i][j] / dim;
    const w = simplex[dim], refl = c.map((x, j) => x + (x - w[j])), fr = cost(...refl);
    if (fr < vals[0]) { const ex = c.map((x, j) => x + 2 * (x - w[j])), fe = cost(...ex); if (fe < fr) { simplex[dim] = ex; vals[dim] = fe; } else { simplex[dim] = refl; vals[dim] = fr; } }
    else if (fr < vals[dim - 1]) { simplex[dim] = refl; vals[dim] = fr; }
    else {
      const con = c.map((x, j) => x + 0.5 * (w[j] - x)), fc = cost(...con);
      if (fc < vals[dim]) { simplex[dim] = con; vals[dim] = fc; }
      else for (let i = 1; i <= dim; i++) { simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j])); vals[i] = cost(...simplex[i]); }
    }
  }
  const D100 = Math.exp(simplex[0][0]), eta = fitEta ? Math.exp(simplex[0][1]) : e0;
  // Is η pinned down by these widths? Move it by 25 % either way, refit D100 alone, and compare
  // (a golden-section search on ln D100). Widths of one feature size rarely fix η: they need
  // features that differ in how much backscatter they collect.
  let etaDetermined = null;
  if (fitEta) {
    const refit = (e) => { let a = simplex[0][0] - 1.5, b = simplex[0][0] + 1.5; const g = (Math.sqrt(5) - 1) / 2; let c = b - g * (b - a), d = a + g * (b - a), fc = cost(c, Math.log(e)), fd = cost(d, Math.log(e));
      for (let i = 0; i < 60; i++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = cost(c, Math.log(e)); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = cost(d, Math.log(e)); } }
      return Math.sqrt(Math.min(fc, fd)); };
    // determined when moving η by 25 % raises the misfit by more than the misfit itself (the scatter
    // of the measurements), with a floor of 0.25 nm
    const best = Math.sqrt(vals[0]), lo = refit(eta / 1.25), hi = refit(eta * 1.25);
    const rise = Math.sqrt(Math.max(0, Math.min(lo, hi) ** 2 - best ** 2));
    etaDetermined = rise > Math.max(0.25, best);
    var etaCheck = { rmsAt: { lower: lo, higher: hi }, rise };   // eslint-disable-line no-var
  }
  const residuals = pts.map((q) => { const r = cdAt(q.it.s, combine(q.it.P, eta, nu), q.dose, D100, q.it.ref); return { dose: q.dose, measured: q.cd, model: r.cd, item: items.indexOf(q.it) }; });
  return { D100, eta, rms: Math.sqrt(vals[0]), residuals, n: pts.length, etaDetermined, etaCheck: fitEta ? etaCheck : null };
}
