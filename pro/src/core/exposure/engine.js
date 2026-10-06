// Exposure engine: delivered dose of a placed layout, at points (exact short
// range + long-range field) or on a raster (blurred coverage + long-range field).
//
//   const eng = createEngine(project)
//   eng.doseAt([[x, y], …], 'delivered' | 'designed' | 'write' | 'longrange')   → Float64Array
//   eng.raster({x0, y0, dx, nx, ny}, field)                                      → Float32Array
//
// Doses: 'designed' uses each shape's target dose, everything else the written dose
// (writeDose after correction, else the target).

import { psfFromSettings } from '../psf/settings.js';
import { splitPSF } from '../psf/split.js';
import { srCumulative, indexPolygons, srAt, polygonSR } from './shortrange.js';
import { lrGridFor, buildLRField, lrReach, termsKernel, lrSpectrum, lrSampler } from './longrange.js';
import { isGauss, kernelReach } from '../psf/psf.js';
import { rasterize, collectPolygons, sceneCache } from './scene.js';
import { cellBBox } from '../geom/library.js';
import { effDose } from '../geom/shapes.js';
import { erf } from '../math.js';
import { toXY, boundsXY, growI32, growF64 } from '../geom/points.js';
import { nextPow2, kernelSpectrum, convolve } from './fft.js';

export const FIELDS = ['delivered', 'designed', 'write', 'longrange'];

// scene: a sceneCache() to share between engines on the same library (it holds geometry only).
export function createEngine(project, { hFactor = 8, maxPolygons = 250000, doseOverride = null, scene: sharedScene = null } = {}) {
  const lib = project.library, top = lib.top;
  const psf = psfFromSettings(project.psf);
  const exact = !!psf.gauss;
  const terms = psf.gauss ?? psf.fit.terms;
  const betaMax = Math.max(...terms.map((t) => t.s));
  const hTarget = betaMax / hFactor;
  const writeOf = doseOverride ? (s) => doseOverride(s) : (s) => effDose(s);
  const targetOf = (s) => s.dose || 0;
  const doseFor = (field) => (field === 'designed' ? targetOf : writeOf);
  const bbox = cellBBox(lib, top);
  const scene = sharedScene || sceneCache();   // objects + bucket index per cell, for this engine's lifetime

  // Split and long-range grid for a region. The split depends on the grid cell (terms narrower
  // than 2h move to the short range), so the cell is chosen first.
  function prepare(roi) {
    let split = splitPSF(psf, { coarseCellNm: hTarget });
    let grid = lrGridFor(roi, split, hTarget);
    if (grid.dx > hTarget * 1.0001) {
      split = splitPSF(psf, { coarseCellNm: grid.dx });
      grid = lrGridFor(roi, split, grid.dx);
    }
    split.exactTerms = exact;
    return { split, grid, K: srCumulative(split, exact) };
  }

  // points: an array of [x, y] or a flat set {xy, length} (geom/points.js)
  function boundsOf(points) { return boundsXY(toXY(points)); }
  // point indices grouped by square tiles of the region (tile key -> [k...])
  function tilesOf(xy, roi, tile) {
    const tiles = new Map();
    for (let k = 0, n = xy.length >> 1; k < n; k++) {
      const key = `${Math.floor((xy[2 * k] - roi.x1) / tile)},${Math.floor((xy[2 * k + 1] - roi.y1) / tile)}`;
      let a = tiles.get(key);
      if (!a) tiles.set(key, (a = []));
      a.push(k);
    }
    return tiles;
  }

  function doseAt(points, field = 'delivered', roiIn = null) {
    const xy = toXY(points), n = xy.length >> 1;
    const out = new Float64Array(n);
    if (!n || !bbox) return out;
    const roi = roiIn || boundsXY(xy);
    if (field === 'designed' || field === 'write') {
      const polys = collectPolygons(lib, top, roi, doseFor(field), 1, scene);
      for (let k = 0; k < n; k++) {
        const x = xy[2 * k], y = xy[2 * k + 1];
        let v = 0;
        for (const p of polys) {
          if (x < p.bb.x1 || x > p.bb.x2 || y < p.bb.y1 || y > p.bb.y2) continue;
          v += p.dose * winding(p.pts, x, y);
        }
        out[k] = v;
      }
      return out;
    }
    const { split, grid, K } = prepare(roi);
    // 'shortrange': the short-range part alone (forward scattering and the fast secondaries)
    const lr = field !== 'shortrange' && (split.lr.terms.length || !split.exactTerms) ? buildLRField(lib, top, split, grid, writeOf, scene) : null;
    if (field === 'longrange') { for (let k = 0; k < n; k++) out[k] = lr ? lr.sampleAt(xy[2 * k], xy[2 * k + 1]) : 0; return out; }
    // Short range: polygons within reach, gathered per tile so that points spread over a chip
    // (control points of a correction) never pull in the whole chip at once.
    const pad = K.rMax, tile = Math.max(64 * pad, 20000);
    const tiles = tilesOf(xy, roi, tile);
    const tol = Math.min(1, terms[0].s / 10);
    for (const ks of tiles.values()) {
      const tb = boundsXY(xy, ks);
      const polys = collectPolygons(lib, top, { x1: tb.x1 - pad, y1: tb.y1 - pad, x2: tb.x2 + pad, y2: tb.y2 + pad }, writeOf, tol, scene);
      if (polys.length > maxPolygons) throw new Error(`${polys.length.toLocaleString()} polygons within reach of these points — zoom in or shorten the line`);
      const index = polys.length ? indexPolygons(polys, Math.max(K.rMax, 50)) : null;
      for (const k of ks) {
        const x = xy[2 * k], y = xy[2 * k + 1];
        out[k] = (index ? srAt(K, polys, index, x, y) : 0) + (lr ? lr.sampleAt(x, y) : 0);
      }
    }
    return out;
  }

  // The short-range part of doseAt as a linear map: point k gets Σ val · dose(key) over the
  // shapes within reach, keyOf(shape) → integer key (a fragment), val = unit-dose SR integral
  // × the dose scale of the instance. Iterative solvers build it once and only re-sample
  // the long range (doseAt(points, 'longrange')) per iteration. Segmented rows (srrows.js).
  // onTick(fraction): called as the points are integrated (this is the slow part of a correction)
  function srOperator(points, keyOf, onTick, roiIn = null) {
    const xy = toXY(points), n = xy.length >> 1;
    const sp = new Int32Array(n), off = new Int32Array(n), len = new Int32Array(n), seg = [];
    let doneK = 0, nnz = 0;
    if (!n || !bbox) return { seg, sp, off, len, nnz };
    const roi = roiIn || boundsXY(xy);
    const { K } = prepare(roi);
    const pad = K.rMax, tile = Math.max(64 * pad, 20000), tol = Math.min(1, terms[0].s / 10);
    const tiles = tilesOf(xy, roi, tile);
    // each tile's rows stay in the tile's own buffers (srrows.js: the segmented form) — copying them
    // into one point-ordered array doubled the peak and needed one allocation the size of all rows
    for (const ks of tiles.values()) {
      const tb = boundsXY(xy, ks);
      const polys = collectPolygons(lib, top, { x1: tb.x1 - pad, y1: tb.y1 - pad, x2: tb.x2 + pad, y2: tb.y2 + pad }, () => 1, tol, scene);
      const keys = polys.map((p) => keyOf(p.src));
      const index = polys.length ? indexPolygons(polys, Math.max(K.rMax, 50)) : null;
      const ti = growI32(), tv = growF64(), si = seg.length;
      for (const k of ks) {
        const x = xy[2 * k], y = xy[2 * k + 1], row = new Map();
        if (index) for (const q of index.near(x, y, K.rMax)) {
          const p = polys[q];
          if (x < p.bb.x1 - K.rMax || x > p.bb.x2 + K.rMax || y < p.bb.y1 - K.rMax || y > p.bb.y2 + K.rMax) continue;
          const v = p.dose * polygonSR(K, p.pts, x, y);
          if (v) row.set(keys[q], (row.get(keys[q]) || 0) + v);
        }
        sp[k] = si; off[k] = ti.length; len[k] = row.size;
        for (const [j, v] of row) { ti.push(j); tv.push(v); }
        if (onTick && (++doneK & 255) === 0) onTick(doneK / n);
      }
      nnz += ti.length;
      seg.push({ idx: ti.finish(), val: tv.finish() });
    }
    return { seg, sp, off, len, nnz };
  }

  // The short-range work of srOperator (kind 'sr', unit dose, keyOf) or of doseAt(points, 'shortrange')
  // (kind 'targets', the writing doses) as plain data for the DSW native core: the kernel's Gaussian terms
  // and every polygon within reach of the region, flat. null when the core could not reproduce it exactly:
  // no Gaussian terms, or a fitted kernel meeting a non-Manhattan polygon (the quadrature uses the table).
  function srPayload(points, kind, keyOf, roiIn = null) {
    if (!points.length || !bbox) return null;
    const pxy = toXY(points);
    const roi = roiIn || boundsXY(pxy);
    const { K } = prepare(roi);
    const G = K.gauss || K.gaussFit;
    if (!G) return null;
    const pad = K.rMax, tol = Math.min(1, terms[0].s / 10);
    const polys = collectPolygons(lib, top, { x1: roi.x1 - pad, y1: roi.y1 - pad, x2: roi.x2 + pad, y2: roi.y2 + pad }, kind === 'sr' ? () => 1 : writeOf, tol, scene);
    let nv = 0;
    for (const p of polys) {
      nv += p.pts.length;
      if (!K.gauss) for (let k = 0, n = p.pts.length; k < n; k++) { const a = p.pts[k], b = p.pts[(k + 1) % n]; if (a[0] !== b[0] && a[1] !== b[1]) return null; }
    }
    const off = new Int32Array(polys.length + 1), xy = new Float64Array(2 * nv), dose = new Float64Array(polys.length), key = new Int32Array(polys.length);
    let v = 0;
    polys.forEach((p, k) => {
      for (const [x, y] of p.pts) { xy[2 * v] = x; xy[2 * v + 1] = y; v++; }
      off[k + 1] = v; dose[k] = p.dose; key[k] = kind === 'sr' ? keyOf(p.src) : 0;
    });
    return { kind, terms: G.map((t) => [t.w, t.s]), exact: !!K.gauss, total: K.total, rMax: K.rMax, eps: 1e-10, pts: pxy, polys: { off, xy, dose, key } };
  }

  // The long-range part of doseAt as a linear map of per-key doses (keyOf(shape) → integer key):
  // each key's coverage of the long-range grid (× the instance dose scale) is gathered once, so a
  // call is a weighted sum + one FFT convolution + sampling, instead of re-rasterising the layout.
  // Same grid, kernel and sampling as doseAt(points, 'longrange'). Returns {apply(dose by key)}.
  // fixedOf(grid) → Float32Array: a fixed density on the operator's grid added to every evaluation
  // (sources whose doses are not being solved, e.g. the context of a region correction).
  function lrOperator(points, keyOf, fixedOf = null) {
    const xy = toXY(points), n = xy.length >> 1;
    const zero = () => new Float64Array(n);
    if (!n || !bbox) return { apply: zero, entries: 0 };
    const { split, grid } = prepare(boundsXY(xy));
    if (!(split.lr.terms.length || !split.exactTerms)) return { apply: zero, entries: 0 };
    const keys = [], cells = [], ws = [];
    rasterize(lib, top, grid, () => 1, null, (cell, v, s) => { keys.push(keyOf(s)); cells.push(cell); ws.push(v); }, scene);
    const K = Int32Array.from(keys), Cl = Int32Array.from(cells), Wt = Float64Array.from(ws);
    const spec = lrSpectrum(split, grid);
    const fixed = fixedOf ? fixedOf({ x0: grid.x0, y0: grid.y0, dx: grid.dx, nx: grid.nx, ny: grid.ny }) : null;
    return {
      entries: K.length,
      // the same operator as plain data (the native core applies it itself)
      data: { K, Cl, Wt, spec: { re: spec.re, im: spec.im, NX: spec.NX, NY: spec.NY }, grid: { x0: grid.x0, y0: grid.y0, dx: grid.dx, nx: grid.nx, ny: grid.ny }, ...(fixed ? { fixed } : {}) },
      apply(dose) {
        const density = fixed ? Float32Array.from(fixed) : new Float32Array(grid.nx * grid.ny);
        for (let q = 0; q < K.length; q++) density[Cl[q]] += dose[K[q]] * Wt[q];
        const sample = lrSampler(grid, convolve(density, grid.nx, grid.ny, spec)), out = new Float64Array(n);
        for (let k = 0; k < n; k++) out[k] = sample(xy[2 * k], xy[2 * k + 1]);
        return out;
      },
    };
  }

  // Raster of a field on grid {x0, y0, dx, nx, ny} (cell centres).
  function raster(grid, field = 'delivered') {
    const { x0, y0, dx, nx, ny } = grid;
    if (field === 'designed' || field === 'write') return rasterize(lib, top, grid, doseFor(field), undefined, null, scene);
    // small or thin rasters (a Fab Studio 2D cut is 1 row): evaluate the cell centres exactly
    // instead of convolving — a wide short-range term (the MC's fast-secondary exponential,
    // γ ≈ 60 nm) would pad a 1-row strip into an 8192 × 4096 FFT (user-test regeneration, 2026-10-01)
    if (field === 'delivered' && nx * ny <= 20000) {
      const pts = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dx]);
      return Float32Array.from(doseAt(pts, 'delivered'));
    }
    const roi = { x1: x0, y1: y0, x2: x0 + nx * dx, y2: y0 + ny * dx };
    const { split, grid: lg } = prepare(roi);
    const out = new Float32Array(nx * ny);
    if (split.lr.terms.length || !split.exactTerms) {
      const lr = buildLRField(lib, top, split, lg, writeOf, scene);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = lr.sampleAt(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dx);
    }
    if (field === 'longrange') return out;
    // short range: coverage blurred with the SR terms (scaled to the SR integral). Gaussian
    // terms blur separably; an exponential term, or a very wide kernel, goes through the FFT.
    // terms under 0.5 % of the SR weight are left out of the blur (the scale below keeps the SR
    // energy exact): a fitted ν ≈ 0 exponential would otherwise force the FFT path
    const srAll = split.sr.terms.length ? split.sr.terms : [{ w: split.sr.integral, s: terms[0].s, kind: 'gauss' }];
    const wAll = srAll.reduce((a, t) => a + t.w, 0);
    const srTerms = srAll.filter((t) => t.w >= 0.005 * wAll);
    const wsum = srTerms.reduce((a, t) => a + t.w, 0);
    const scale = wsum > 0 ? split.sr.integral / wsum : 0;
    const sMax = Math.max(...srTerms.map((t) => t.s));
    const R = Math.ceil(Math.max(...srTerms.map(kernelReach)) / dx);
    const P = sMax < 0.25 * dx ? 1 : R;     // padding so shapes just outside still blur in
    const big = { x0: x0 - P * dx, y0: y0 - P * dx, dx, nx: nx + 2 * P, ny: ny + 2 * P };
    const cov = rasterize(lib, top, big, writeOf, undefined, null, scene);
    const BX = big.nx, BY = big.ny;
    let blurred;
    if (sMax < 0.25 * dx) {
      blurred = cov.map((v) => v * split.sr.integral);
    } else if (R <= 48 && srTerms.every(isGauss)) {
      blurred = new Float32Array(BX * BY);
      for (const t of srTerms) {
        const k1 = new Float64Array(2 * R + 1);
        for (let k = -R; k <= R; k++) k1[k + R] = 0.5 * (erf((k * dx + dx / 2) / t.s) - erf((k * dx - dx / 2) / t.s));
        const tmp = new Float32Array(BX * BY);
        for (let j = 0; j < BY; j++) for (let i = 0; i < BX; i++) {
          let v = 0;
          for (let k = -R; k <= R; k++) { const ii = i + k; if (ii >= 0 && ii < BX) v += cov[j * BX + ii] * k1[k + R]; }
          tmp[j * BX + i] = v;
        }
        const w = t.w * scale;
        for (let i = 0; i < BX; i++) for (let j = 0; j < BY; j++) {
          let v = 0;
          for (let k = -R; k <= R; k++) { const jj = j + k; if (jj >= 0 && jj < BY) v += tmp[jj * BX + i] * k1[k + R]; }
          blurred[j * BX + i] += w * v;
        }
      }
    } else {
      const kfun = termsKernel(srTerms.map((t) => ({ ...t, w: t.w * scale })), dx, R);
      const spec = kernelSpectrum(kfun, R, R, nextPow2(BX + 2 * R), nextPow2(BY + 2 * R));
      blurred = convolve(cov, BX, BY, spec);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] += blurred[(j + P) * BX + (i + P)];
    return out;
  }

  return { psf, exact, doseAt, srOperator, srPayload, lrOperator, raster, prepare, hTarget, bbox, lrReach: () => lrReach(splitPSF(psf, { coarseCellNm: hTarget })) };
}

// Winding number (0 outside, ±1 inside) of a closed polygon around (x, y).
export function winding(pts, x, y) {
  let w = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    if (ay <= y) { if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++; }
    else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
  }
  return w;
}
