// Split a PSF into short- and long-range parts.
//
//   long range  LR: smooth on the scale of the coarse density grid (cell h), used numerically
//                   on that grid (FFT over the whole pattern)
//   short range SR: everything else, compact (zero beyond 2·rSplit), used exactly near edges
//
// Built so that SR + LR reproduces the table exactly:
//   g_LR = analytic terms (exact or fitted; Gaussian or exponential) with width s ≥ 2h
//   LR(r) = g_LR(r) + (table(r) − g_LR(r))·b(r),  b = 0 below rSplit, smoothstep to 1 at 2·rSplit
//   SR(r) = table(r) − LR(r)
// For the analytic double Gaussian this gives SR = forward term, LR = backscatter term.
// rSplit comes from the reach of the SR terms that carry ≥ 0.5 % of the energy (5 s for a Gaussian, 8 s for an exponential,
// whose tail is heavy).

import { gaussAt, radialIntegral, psfAt, termReach } from './psf.js';

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function splitPSF(psf, { coarseCellNm } = {}) {
  const terms = psf.gauss ?? psf.fit?.terms;
  if (!terms) throw new Error('splitPSF needs exact analytic terms or a fit (run fitGaussians first)');
  const sMax = Math.max(...terms.map((t) => t.s));
  const h = coarseCellNm ?? sMax / 4;
  const lrTerms = terms.filter((t) => t.s >= 2 * h);
  const srTerms = terms.filter((t) => t.s < 2 * h);
  // A term with a negligible weight does not set the reach: a fit can leave e.g. ν ≈ 0 at γ = 90 nm,
  // whose 8γ reach would make the exact short range 2 µm wide and the maps 100× slower.
  // Tables lose nothing (beyond rSplit the remainder goes to LR); closed forms lose < 3e-4.
  const wSum = terms.reduce((a, t) => a + t.w, 0);
  const reachTerms = srTerms.filter((t) => t.w >= 0.005 * wSum);
  const rSplit = Math.max(reachTerms.length ? Math.max(...reachTerms.map(termReach)) : 0, 200);

  const n = psf.r.length;
  const lr = new Float64Array(n), sr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = psf.r[i], g = gaussAt(lrTerms, r);
    const b = smoothstep((r - rSplit) / rSplit);
    lr[i] = g + (psf.f[i] - g) * b;
    sr[i] = psf.f[i] - lr[i];
  }
  return {
    rSplit, rMaxSR: 2 * rSplit, coarseCellNm: h,
    r: psf.r,
    sr: { f: sr, terms: srTerms, integral: radialIntegral(psf.r, sr) },
    lr: { f: lr, terms: lrTerms, integral: radialIntegral(psf.r, lr) },
  };
}

// Evaluate a split part at any r with the same log–log interpolation as the table.
export const splitPartAt = (split, part, r) => psfAt({ r: split.r, f: split[part].f }, r);
