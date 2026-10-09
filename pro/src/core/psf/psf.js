// The internal PSF object. Every PSF — analytic, imported, Monte Carlo — is a
// radial table; analytic ones also carry their exact Gaussian terms.
//
// PSF {
//   r:     Float64Array   radii in nm, ascending, > 0 (log-spaced for generated tables)
//   f:     Float64Array   energy per unit area per incident electron, ∫ 2πr f dr = 1 when normalised
//   gauss: [{w, s, label}] | null   exact terms f = Σ w e^{-r²/s²}/(π s²), Σw = 1; analytic PSFs only
//   fit:   {alpha, beta, eta, gamma?, nu?, terms, rms} | null   Gaussian fit (fit.js)
//   depth: {mode: 'average'|'slice', z0Nm, z1Nm} | null
//   meta:  {source, energyKeV, substrate, stack, resist, electrons, file, notes, ...}
//   warnings: [string]
// }

export function makePSF({ r, f, gauss = null, fit = null, depth = null, meta = {}, warnings = [] }) {
  r = Float64Array.from(r);
  f = Float64Array.from(f);
  if (r.length !== f.length) throw new Error('PSF r and f differ in length');
  if (r.length < 2) throw new Error('PSF needs at least two points');
  for (let i = 0; i < r.length; i++) {
    if (!(r[i] > 0)) throw new Error(`PSF radius ${r[i]} at index ${i} is not > 0`);
    if (i && !(r[i] > r[i - 1])) throw new Error(`PSF radii not strictly ascending at index ${i}`);
    if (!Number.isFinite(f[i])) throw new Error(`PSF value at index ${i} is not finite`);
  }
  return { r, f, gauss, fit, depth, meta: { ...meta }, warnings: [...warnings] };
}

export function logGrid(rMin, rMax, perDecade = 50) {
  const n = Math.max(2, Math.ceil(Math.log10(rMax / rMin) * perDecade) + 1);
  const out = new Float64Array(n);
  const step = Math.log(rMax / rMin) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = rMin * Math.exp(i * step);
  return out;
}

// ---- Analytic terms ----
// A term is {w, s, kind}, kind 'gauss' (default) or 'exp', each normalised to integrate to w:
//   gauss   w e^{-r²/s²} / (π s²)        the Gaussians (α, β, and a mid-range γ)
//   exp     w e^{-r/s}   / (2π s²)       the exponential mid-range tail of the "two Gaussians +
//                                        exponential" model (fast secondaries)

export const isGauss = (t) => !t.kind || t.kind === 'gauss';

export function termAt(t, r) {
  if (t.kind === 'exp') return (t.w * Math.exp(-r / t.s)) / (2 * Math.PI * t.s * t.s);
  return (t.w * Math.exp(-(r * r) / (t.s * t.s))) / (Math.PI * t.s * t.s);
}

export function gaussAt(terms, r) {
  let v = 0;
  for (const t of terms) v += termAt(t, r);
  return v;
}

// Energy of the terms inside radius R, in closed form.
export function termsCumulative(terms, R) {
  let v = 0;
  for (const t of terms) {
    if (t.kind === 'exp') { const u = R / t.s; v += t.w * (1 - Math.exp(-u) * (1 + u)); }
    else v += t.w * (1 - Math.exp(-(R * R) / (t.s * t.s)));
  }
  return v;
}

// Radii beyond which a term no longer matters. The exponential has a heavy tail, so it needs
// many more decay lengths than a Gaussian: beyond 8 s it still holds 3e-3 of its weight, beyond
// 12 s 8e-5. Gaussians are at e^{-25} and e^{-16}.
export const termReach = (t) => (t.kind === 'exp' ? 8 * t.s : 5 * t.s);     // short-range split
export const kernelReach = (t) => (t.kind === 'exp' ? 12 * t.s : 4 * t.s);  // grid kernels

// Line spread function (PSF integrated along y), per unit length: Σ w e^{-x²/s²}/(√π s).
// Gaussian terms only (the exponential's LSF is a Bessel function and is not needed).
export function gaussLsfAt(terms, x) {
  let v = 0;
  for (const t of terms) {
    if (!isGauss(t)) throw new Error('gaussLsfAt: Gaussian terms only');
    v += (t.w * Math.exp(-(x * x) / (t.s * t.s))) / (Math.sqrt(Math.PI) * t.s);
  }
  return v;
}

// ---- Table evaluation ----

// f(r) by log–log interpolation; flat inside r[0] (PSFs are flat at the origin), 0 beyond r[n-1].
export function psfAt(psf, r) {
  const R = psf.r, F = psf.f, n = R.length;
  if (r <= R[0]) return F[0];
  if (r > R[n - 1]) return 0;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m] < r) lo = m; else hi = m; }
  const f0 = F[lo], f1 = F[hi];
  if (f0 > 0 && f1 > 0) {
    const t = Math.log(r / R[lo]) / Math.log(R[hi] / R[lo]);
    return Math.exp(Math.log(f0) + t * Math.log(f1 / f0));
  }
  const t = (r - R[lo]) / (R[hi] - R[lo]);
  return f0 + t * (f1 - f0);
}

// ∫_0^{r_n} 2π r f dr. Trapezoid in ln r on 2π r² f (exponentially accurate for smooth,
// decaying PSFs on a log grid), plus the disc inside r[0] taken as flat.
export function radialIntegral(r, f) {
  let s = Math.PI * r[0] * r[0] * f[0];
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1] * r[i - 1] * f[i - 1], b = r[i] * r[i] * f[i];
    s += Math.PI * (a + b) * Math.log(r[i] / r[i - 1]);
  }
  return s;
}

// Cumulative version of radialIntegral: fraction of energy inside each r[i].
export function cumulative(r, f) {
  const out = new Float64Array(r.length);
  let s = Math.PI * r[0] * r[0] * f[0];
  out[0] = s;
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1] * r[i - 1] * f[i - 1], b = r[i] * r[i] * f[i];
    s += Math.PI * (a + b) * Math.log(r[i] / r[i - 1]);
    out[i] = s;
  }
  return out;
}

// Normalise to ∫ = 1. The factor applied is reported, never hidden.
export function normalize(psf) {
  const I = radialIntegral(psf.r, psf.f);
  if (!(I > 0)) throw new Error('PSF integral is not positive; cannot normalise');
  const f = psf.f.map((v) => v / I);
  const warnings = [...psf.warnings];
  if (Math.abs(I - 1) > 1e-3) warnings.push(`normalised: integral was ${I.toPrecision(6)} (factor ${(1 / I).toPrecision(6)} applied)`);
  return { ...psf, f, meta: { ...psf.meta, integralBeforeNormalise: I }, warnings };
}

// Replace the table below rTrust by a Gaussian (normally the fitted forward term), scaled to
// meet the table at rTrust. For noisy Monte Carlo bins near the origin.
export function patchSmallR(psf, s, rTrust) {
  const i0 = psf.r.findIndex((v) => v >= rTrust);
  if (i0 <= 0) return psf;
  const g = (r) => Math.exp(-(r * r) / (s * s));
  const A = psf.f[i0] / g(psf.r[i0]);
  const f = Float64Array.from(psf.f);
  for (let i = 0; i < i0; i++) f[i] = A * g(psf.r[i]);
  return { ...psf, f, warnings: [...psf.warnings, `values below r = ${rTrust} nm replaced by a Gaussian (s = ${s.toPrecision(4)} nm)`] };
}

// Extend the tail log-linearly (ln f vs r, i.e. an exponential in r fitted to the last decade
// of points) out to rMax, so the integral is not lost when a table stops early.
export function extendTail(psf, rMax, perDecade = 50) {
  const R = psf.r, F = psf.f, n = R.length;
  if (rMax <= R[n - 1]) return psf;
  const pts = [];
  for (let i = n - 1; i >= 0 && R[i] >= R[n - 1] / 10; i--) if (F[i] > 0) pts.push([R[i], Math.log(F[i])]);
  if (pts.length < 3) return { ...psf, warnings: [...psf.warnings, 'tail not extended: too few positive points in the last decade'] };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const m = pts.length, k = (m * sxy - sx * sy) / (m * sxx - sx * sx), c = (sy - k * sx) / m;
  if (!(k < 0)) return { ...psf, warnings: [...psf.warnings, 'tail not extended: last decade is not decaying'] };
  const extra = logGrid(R[n - 1], rMax, perDecade).slice(1);
  const r = new Float64Array(n + extra.length), f = new Float64Array(n + extra.length);
  r.set(R); f.set(F);
  extra.forEach((x, j) => { r[n + j] = x; f[n + j] = Math.exp(c + k * x); });
  return { ...psf, r, f, warnings: [...psf.warnings, `tail extended exponentially from ${R[n - 1].toPrecision(4)} to ${rMax.toPrecision(4)} nm`] };
}

// ---- Serialisation (*.psf.json) ----

export function psfToJSON(psf) {
  return JSON.stringify({
    format: 'ebl-workbench-psf', version: 1,
    r_nm: Array.from(psf.r), f_per_nm2: Array.from(psf.f),
    gauss: psf.gauss, fit: psf.fit, depth: psf.depth, meta: psf.meta, warnings: psf.warnings,
  });
}

export function psfFromJSON(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o.format !== 'ebl-workbench-psf') throw new Error('not an EBL Workbench PSF file');
  return makePSF({ r: o.r_nm, f: o.f_per_nm2, gauss: o.gauss, fit: o.fit, depth: o.depth, meta: o.meta, warnings: o.warnings });
}
