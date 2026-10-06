// Long-range dose field on a coarse grid: dose-weighted coverage of everything
// within reach, convolved by FFT with the long-range part of the PSF.
//
// Kernel entries:
//   Gaussian terms     exact cell integrals, ¼[erf((Δx+h/2)/s) − erf((Δx−h/2)/s)]·[same in y]
//   exponential terms  sampled at cell centres; the centre cell takes the integral over the
//                      disc of equal area, since the exponential has a cusp at r = 0
//   tabulated PSFs     the non-analytic remainder sampled at cell centres, with the centre cell
//                      taking whatever keeps the total exact

import { erf } from '../math.js';
import { nextPow2, kernelSpectrum, convolve } from './fft.js';
import { rasterize } from './scene.js';
import { gaussAt, psfAt, termAt, termsCumulative, isGauss, kernelReach } from '../psf/psf.js';

// Span of the long-range kernel: Gaussians dead at 4 s (e^{-16}), exponentials at 12 s (8e-5).
export function lrReach(split) {
  const t = split.lr.terms;
  return Math.max(t.length ? Math.max(...t.map(kernelReach)) : 0, 1);
}

export function lrGridFor(roi, split, h, maxCells = 1800) {
  const margin = 0.75 * lrReach(split);       // sources beyond 3 s (9 s) contribute < e^{-9}
  const w = roi.x2 - roi.x1 + 2 * margin, ht = roi.y2 - roi.y1 + 2 * margin;
  const dx = Math.max(h, w / maxCells, ht / maxCells);
  const nx = Math.max(4, Math.ceil(w / dx)), ny = Math.max(4, Math.ceil(ht / dx));
  return { x0: roi.x1 - margin, y0: roi.y1 - margin, dx, nx, ny };
}

// Kernel of a set of analytic terms on a grid of cell dx, as a function of integer offsets.
export function termsKernel(terms, dx, R) {
  const gauss = terms.filter(isGauss), exps = terms.filter((t) => !isGauss(t));
  const one = gauss.map((t) => {
    const a = new Float64Array(2 * R + 1);
    for (let k = -R; k <= R; k++) a[k + R] = 0.5 * (erf((k * dx + dx / 2) / t.s) - erf((k * dx - dx / 2) / t.s));
    return a;
  });
  const rho = dx / Math.sqrt(Math.PI);          // radius of the disc with the cell's area
  const expCentre = exps.reduce((a, t) => a + termsCumulative([t], rho), 0);
  return (di, dj) => {
    let v = 0;
    for (let q = 0; q < gauss.length; q++) v += gauss[q].w * one[q][di + R] * one[q][dj + R];
    if (exps.length) {
      if (!di && !dj) v += expCentre;
      else { const r = Math.hypot(di, dj) * dx; for (const t of exps) v += termAt(t, r) * dx * dx; }
    }
    return v;
  };
}

export function buildLRField(lib, top, split, grid, doseOf, scene = null) {
  const density = rasterize(lib, top, grid, doseOf, undefined, null, scene);
  const field = convolve(density, grid.nx, grid.ny, lrSpectrum(split, grid));
  return { grid, field, density, sampleAt: lrSampler(grid, field) };
}

// The long-range kernel's spectrum on a grid (convolve(density, nx, ny, spectrum) gives the field).
export function lrSpectrum(split, grid) {
  const { dx, nx, ny } = grid;
  const terms = split.lr.terms;
  const reach = lrReach(split);
  const R = Math.max(1, Math.ceil(reach / dx));
  const kterms = termsKernel(terms, dx, R);
  // non-analytic remainder of a tabulated long-range part
  const rem = (r) => psfAt({ r: split.r, f: split.lr.f }, r) - gaussAt(terms, r);
  const tabulated = !split.exactTerms;
  let remSum = 0;
  const remCache = new Map();
  if (tabulated) {
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      if (!di && !dj) continue;
      const v = rem(Math.hypot(di, dj) * dx) * dx * dx;
      remCache.set(di + ',' + dj, v); remSum += v;
    }
  }
  const termTotal = terms.reduce((a, t) => a + t.w, 0);
  const remCentre = tabulated ? split.lr.integral - termTotal - remSum : 0;
  const kfun = (di, dj) => kterms(di, dj) + (tabulated ? (!di && !dj ? remCentre : remCache.get(di + ',' + dj)) : 0);
  const NX = nextPow2(nx + 2 * R), NY = nextPow2(ny + 2 * R);
  return kernelSpectrum(kfun, R, R, NX, NY);
}

// Bilinear sampling of a field on the grid's cell centres.
export function lrSampler(grid, field) {
  const { dx, nx, ny } = grid;
  return function sampleAt(x, y) {
      const u = (x - grid.x0) / dx - 0.5, v = (y - grid.y0) / dx - 0.5;
      const i0 = Math.max(0, Math.min(nx - 2, Math.floor(u))), j0 = Math.max(0, Math.min(ny - 2, Math.floor(v)));
      const fu = Math.max(0, Math.min(1, u - i0)), fv = Math.max(0, Math.min(1, v - j0));
      const f = field;
      return (1 - fu) * (1 - fv) * f[j0 * nx + i0] + fu * (1 - fv) * f[j0 * nx + i0 + 1] + (1 - fu) * fv * f[(j0 + 1) * nx + i0] + fu * fv * f[(j0 + 1) * nx + i0 + 1];
  };
}
