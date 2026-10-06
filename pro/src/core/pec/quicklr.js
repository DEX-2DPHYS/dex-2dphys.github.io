// Quick long-range correction on the backscatter grid (2026-10-05).
//
// The long-range part of the correction does not need fragments: backscatter varies on the scale of
// β, so a dose FACTOR per cell of the long-range grid (β/8 or coarser) captures it. Per covered cell,
// with t the design dose there and c its coverage, the factor f solves the same condition as the
// fractured correction's "long range correction only" mode:
//
//     srSelf · f · t  +  LR ⊗ (f · t · c)  =  t        (srSelf: the short-range integral of the PSF)
//
// by fixed-point iteration, one FFT convolution per step. A whole chip costs one rasterisation of the
// design and a few dozen FFTs on a grid of at most 1800 × 1800 cells — seconds, whatever the number of
// shapes. Used for a quick whole-layout result, and as the doses of everything outside a region that
// is corrected in full (fractured.js, options.region).

import { createEngine } from '../exposure/engine.js';
import { lrSpectrum, lrGridFor } from '../exposure/longrange.js';
import { splitPSF } from '../psf/split.js';
import { convolve } from '../exposure/fft.js';

// cellFrac: the grid cell as a fraction of the widest PSF term (β); maxCells caps the grid (FFT size).
// fixed: a library already corrected (writing doses set, design doses in .dose): it is taken out of
// the factor solve and its WRITTEN dose enters as a fixed backscatter source (the feedback pass of a
// high-resolution correction).
export function quickLongRange(project, { maxFactor = 8, minFactor = null, maxIter = 60, tol = 1e-4, scene = null, onProgress = null, cellFrac = 1 / 3, maxCells = 900, fixed = null } = {}) {
  const t0 = Date.now();
  const e = createEngine(project, { scene });
  const unit = createEngine(project, { doseOverride: () => 1, scene });      // coverage alone
  if (!e.bbox) return null;
  // the grid: about β/3 (backscatter is smooth on β; the exposure engine's β/8 grid is for maps),
  // split as the engine splits (terms narrower than two cells go to the short range)
  const beta = Math.max(...(e.psf.gauss ?? e.psf.fit.terms).map((q) => q.s));
  let h = Math.max(e.hTarget, beta * cellFrac);
  let split = splitPSF(e.psf, { coarseCellNm: h });
  let grid = lrGridFor(e.bbox, split, h, maxCells);
  if (grid.dx > h * 1.0001) { h = grid.dx; split = splitPSF(e.psf, { coarseCellNm: h }); grid = lrGridFor(e.bbox, split, h, maxCells); }
  split.exactTerms = e.exact;
  const srSelf = split.sr.integral;
  const hasLR = split.lr.terms.length > 0 || !split.exactTerms;
  const { nx, ny } = grid, N = nx * ny;
  const tA = Date.now();
  const D = e.raster(grid, 'designed');                // Σ target dose × coverage per cell
  const C = unit.raster(grid, 'write');                // coverage per cell
  let Fw = null;
  if (fixed) {
    const fp = { library: fixed, psf: project.psf };
    const fd = createEngine(fp).raster(grid, 'designed'), fc = createEngine(fp, { doseOverride: () => 1 }).raster(grid, 'write');
    Fw = createEngine(fp).raster(grid, 'write');
    for (let k = 0; k < D.length; k++) { D[k] = Math.max(0, D[k] - fd[k]); C[k] = Math.max(0, C[k] - fc[k]); }
  }
  const tRaster = Date.now() - tA;
  onProgress?.({ stage: 'quick', frac: 0.2 });
  const covered = new Uint8Array(N), t = new Float64Array(N);
  for (let k = 0; k < N; k++) if (C[k] > 1e-6 && D[k] > 0) { covered[k] = 1; t[k] = D[k] / C[k]; }
  const lo = minFactor > 0 ? minFactor : 1 / maxFactor;
  const f = new Float64Array(N).fill(1);
  let it = 0, err = 0;
  const tI = Date.now();
  if (hasLR) {
    const spec = lrSpectrum(split, grid), src = new Float32Array(N);
    for (it = 1; it <= maxIter; it++) {
      for (let k = 0; k < N; k++) src[k] = (covered[k] ? f[k] * D[k] : 0) + (Fw ? Fw[k] : 0);
      const lr = convolve(src, nx, ny, spec);
      err = 0;
      for (let k = 0; k < N; k++) {
        if (!covered[k]) continue;
        const nf = Math.min(maxFactor, Math.max(lo, (1 - lr[k] / t[k]) / srSelf));
        err = Math.max(err, Math.abs(nf - f[k]) / f[k]);
        f[k] = nf;
      }
      onProgress?.({ stage: 'quick', frac: 0.2 + 0.8 * Math.min(1, it / 20), iteration: it, maxError: err });
      if (err < tol) break;
    }
  } else for (let k = 0; k < N; k++) f[k] = 1 / srSelf;
  const tIter = Date.now() - tI, tFill = Date.now();
  // uncovered cells take the factor of the nearest covered one (a shape's centre can sit in a cell
  // its outline barely touches): one breadth-first sweep outwards from every covered cell
  const F = Float32Array.from(f), have = Uint8Array.from(covered), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let k = 0; k < N; k++) if (have[k]) queue[qt++] = k;
  while (qh < qt) {
    const k = queue[qh++], i = k % nx, j = (k - i) / nx;
    if (i > 0 && !have[k - 1]) { have[k - 1] = 1; F[k - 1] = F[k]; queue[qt++] = k - 1; }
    if (i < nx - 1 && !have[k + 1]) { have[k + 1] = 1; F[k + 1] = F[k]; queue[qt++] = k + 1; }
    if (j > 0 && !have[k - nx]) { have[k - nx] = 1; F[k - nx] = F[k]; queue[qt++] = k - nx; }
    if (j < ny - 1 && !have[k + nx]) { have[k + nx] = 1; F[k + nx] = F[k]; queue[qt++] = k + nx; }
  }
  for (let k = 0; k < N; k++) if (!have[k]) F[k] = 1;
  const msFill = Date.now() - tFill;
  // bilinear between cell centres
  const sampleAt = (x, y) => {
    const u = (x - grid.x0) / grid.dx - 0.5, v = (y - grid.y0) / grid.dx - 0.5;
    const i0 = Math.max(0, Math.min(nx - 2, Math.floor(u))), j0 = Math.max(0, Math.min(ny - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i0)), fv = Math.max(0, Math.min(1, v - j0));
    return (1 - fu) * (1 - fv) * F[j0 * nx + i0] + fu * (1 - fv) * F[j0 * nx + i0 + 1] + (1 - fu) * fv * F[(j0 + 1) * nx + i0] + fu * fv * F[(j0 + 1) * nx + i0 + 1];
  };
  return { grid, factor: F, covered, sampleAt, srSelf, iterations: it, maxErr: err, converged: !hasLR || err < tol, ms: Date.now() - t0, msRaster: tRaster, msIter: tIter, msFill };
}
