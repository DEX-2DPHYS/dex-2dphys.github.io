// Fractured proximity correction: every exposed object is cut
// into edge, corner/tip and interior fragments (fracture.js) and each fragment gets its own dose,
// solved globally with the FULL PSF (exact short range: forward scattering and the fast-secondary
// mid-range; long range: backscatter) at each fragment's control point:
//   edge / corner / small:  delivered = ½ · target   (the developed outline passes there)
//   interior / joint:       delivered = 1 · target
// The result is WRITING DATA — a separate library of fragments with doses, rounded to N dose
// classes — which is what a writer's pattern generator fills with shots. The design is untouched.
//
// Hierarchy: an array is split into context classes, so a 10⁶-element array costs a few hundred
// corrections, not 10⁶:
//   • per axis, the first and last `ctx` elements individually (their short-range surroundings
//     differ: neighbours are missing on one side), and the middle in tiles of ≈ β/4 (the
//     backscatter varies slowly across the array);
//   • every class is a sub-array with its own fractured copy of the cell, corrected at its
//     central element.
// Nested references inside an arrayed cell are flattened into that cell's objects.

import { createEngine } from '../exposure/engine.js';
import { indexPolygons } from '../exposure/shortrange.js';
import { exposedLayer } from '../exposure/scene.js';
import { groupKeyOf, outlineWorld, uid } from '../geom/shapes.js';
import { elementTransform, makeLibrary, makeCell, makeRef } from '../geom/library.js';
import { compose, apply, invert, applyBBox, IDENTITY } from '../geom/transform.js';
import { quickLongRange } from './quicklr.js';
import { flatPoints, toXY, boundsXY, growF64, growU8 } from '../geom/points.js';
import { rowsOf, srEntries as srCount } from '../exposure/srrows.js';
import { makePolyPacker, setNum, valAt, dropColumn, appendShapes, subsetPacked, isPackedCell, unpackCells } from '../geom/pack.js';
import { recoverArrays } from '../geom/rehier.js';
import { unionPolygons, signedArea, intersectPolygons, differencePolygons, holeFreePieces } from '../geom/clip.js';
import { fractureObject, FRACTURE_DEFAULTS, areaOf, interiorPoint } from './fracture.js';

// minFactor: dose floor as a fraction of the shape dose (null = 1 / maxFactor, as before).
// interior: 'full' — interior and joint fragments are solved to the full target (as before);
//           'band' — edge equalization: edges, corners and ends are solved to
//           the equalization level, interiors only have to stay inside interiorBand × target, so
//           their dose is changed only when they leave the band.
// corners: 'square' — a sharp corner's vertex is pulled to ½ (the outline passes through the corner;
//           as before); 'natural' — to the share a perfectly exposed shape has there (interior
//           angle / 360°, ¼ for a right angle), so corners round as the PSF dictates and the edges
//           next to them are not over-exposed (edge equalization).
// level:   the equalization level, the dose at a developed edge as a fraction of the target (½).
// fit:     'contour' — the doses are fitted, in the least-squares sense, to targets at many points:
//           every object's outline sampled every sampleNm (and its vertices), and a point inside
//           every fragment. The target at a point is the design convolved with the short-range PSF
//           normalised to unit integral, T·(χ ⊗ k̂_SR): ½ T on a straight edge, the interior-angle
//           share at a vertex, T deep inside, and less than T inside a feature narrower than the
//           forward/secondary range. It is what the design delivers once the backscatter is
//           removed, so the expectation follows each feature's size relative to the PSF instead
//           of being assumed. The update is the weighted multiplicative least-squares step
//           d_i ← d_i · Σ_k w_k A_ki want_k / Σ_k w_k A_ki got_k (A = short-range sensitivity),
//           whose fixed point balances each fragment's weighted error over the points it reaches.
//           'control' — one control point per fragment, solved exactly (the earlier method).
// region:  {x1, y1, x2, y2} (nm) — correct only there: the objects meeting the region plus a margin
//           (halo, nm; default max(2 × short-range reach, 1 µm); the context enters as a fixed source,
//           backscatter and short range both, so a narrow margin is enough — measured 0.23 % from a full
//           run at 0.4 µm, 0.26 % at 15.6 µm) are fractured and solved as above;
//           every other object is context, at its design dose × the quick long-range factor
//           (quicklr.js), present in the solve as a fixed backscatter source and copied into the
//           writing data so maps, 3D and Fab Studio see the whole layout. The statistics count the
//           region alone (the margin's own fragments see a truncated neighbourhood).
// high:    { layers: [layer keys], zones: [{x1, y1, x2, y2}] } — correct in full only the high-resolution
//           parts: every object on a listed layer (whole, wherever it is) and the parts of objects
//           inside a zone (+ the margin, as for a region; several zones, cut where an object crosses a
//           zone edge). Everything else is the base correction (the quick long-range factor), a fixed
//           source of backscatter and short-range dose for the solve, exactly as a region's context.
//           Then one feedback pass: the base factors are solved again with the high parts at their
//           corrected doses as a fixed source, and the high parts solved once more against that
//           (feedback: false skips it). stats.high.feedback says how far that pass moved things.
// range:   'quick' — no fragments: every object is written at its dose × the quick long-range factor
//           (quicklr.js) at its centre; seconds for a whole chip, a first look before a fractured run.
//           'full' — the full PSF at every control point (above); 'long' — long-range correction
//           only: the short range is taken as that of an infinitely large exposed area (its whole
//           integral, at the fragment's own dose) and every fragment is solved so that this plus
//           the backscatter it receives equals the full target. Backscatter is equalized across the
//           layout; edges and corners keep the shape the forward scattering gives them, with no
//           edge boost (and so no overshoot inside narrow features).
export const PEC_DEFAULTS = { ...FRACTURE_DEFAULTS, tile: null, maxFactor: 8, minFactor: null, classes: 64, maxIter: 40, tol: 0.003, ctx: null, interior: 'full', interiorBand: [0.75, 1.5], corners: 'square', level: 0.5, range: 'full', fit: 'contour', sampleNm: null, region: null, high: null, feedback: true, halo: null, recoverArrays: true };

const inPoly = (pts, x, y) => {
  let w = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    if (ay <= y) { if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++; } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
  }
  return w !== 0;
};
const inObj = (o, x, y) => x >= o.bb.x1 && x <= o.bb.x2 && y >= o.bb.y1 && y <= o.bb.y2 && o.polys.reduce((k, p) => k + (inPoly(p, x, y) ? (signedArea(p) > 0 ? 1 : -1) : 0), 0) > 0;
const bbOf = (polys) => { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const p of polys) for (const [x, y] of p) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; } return { x1, y1, x2, y2 }; };

// Polygons with holes → hole-free pieces (cut through each hole), for storage as plain shapes.
const holeFree = holeFreePieces;

// The exposed objects of a cell in its own coordinates (fused groups unioned; nested refs flattened).
function cellObjects(lib, name, exposed, T = IDENTITY, k = 1, out = [], depth = 0) {
  const c = lib.cells[name];
  const groups = new Map();
  for (const s of c.shapes) {
    if (!exposed(s.layer) || !(s.dose > 0)) continue;
    const key = groupKeyOf(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const members of groups.values()) {
    const outl = members.map((s) => outlineWorld(s, 1).map(([x, y]) => apply(T, x, y)));
    const polys = members.length > 1 ? unionPolygons(outl) : [signedArea(outl[0]) < 0 ? outl[0].slice().reverse() : outl[0]];
    out.push({ polys, bb: bbOf(polys), dose: members[0].dose * k, layer: members[0].layer });
  }
  if (depth < 16) for (const r of c.refs) for (let i = 0; i < r.cols; i++) for (let j = 0; j < r.rows; j++) cellObjects(lib, r.cell, exposed, compose(T, elementTransform(r, i, j)), k * (r.doseScale ?? 1), out, depth + 1);
  return out;
}

// covered(x, y, self): inside an exposed object other than `self` ({top: k} or {arr, i, j, obj}).
// topObjs: [{polys, bb, …}] (top-level objects, world); arraysIn: [{r, objs}] (each top reference and
// its cell's objects in cell coordinates). Built in the correction worker for the whole layout, and by a
// fracture helper for its share (the top objects near its jobs, every array).
export function makeCovered(topObjs, arraysIn) {
  const arrays = arraysIn.map(({ r, objs }) => {
    const L = elementTransform(r, 0, 0);
    const M = { a: r.colStep[0], b: r.colStep[1], c: r.rowStep[0], d: r.rowStep[1], e: r.x, f: r.y };
    const singular = Math.abs(M.a * M.d - M.b * M.c) < 1e-9;
    // world box of the whole array, and the inverse of its element linear part (an element's local
    // point is that inverse applied to the point minus the element's offset)
    let bb = null;
    for (const ob of objs) { const b = applyBBox(L, ob.bb); bb = bb ? { x1: Math.min(bb.x1, b.x1), y1: Math.min(bb.y1, b.y1), x2: Math.max(bb.x2, b.x2), y2: Math.max(bb.y2, b.y2) } : b; }
    if (bb) {
      const ex = [0, (r.cols - 1) * r.colStep[0], (r.rows - 1) * r.rowStep[0], (r.cols - 1) * r.colStep[0] + (r.rows - 1) * r.rowStep[0]];
      const ey = [0, (r.cols - 1) * r.colStep[1], (r.rows - 1) * r.rowStep[1], (r.cols - 1) * r.colStep[1] + (r.rows - 1) * r.rowStep[1]];
      bb = { x1: bb.x1 + Math.min(...ex), x2: bb.x2 + Math.max(...ex), y1: bb.y1 + Math.min(...ey), y2: bb.y2 + Math.max(...ey) };
    }
    return { r, objs, L, Minv: singular ? null : invert(M), Lin: invert({ ...L, e: 0, f: 0 }), bb };
  });
  // the arrays bucketed by their world box (ChipV11 after array recovery: 5 419 arrays; testing every
  // one for every sample point cost ~0.5 s per object), very large ones kept in a short list of their own
  const ARR_B = 10000, arrBuckets = new Map(), arrWide = [];
  arrays.forEach((A, a) => {
    if (!A.bb) return;
    const i1 = Math.floor(A.bb.x1 / ARR_B), i2 = Math.floor(A.bb.x2 / ARR_B), j1 = Math.floor(A.bb.y1 / ARR_B), j2 = Math.floor(A.bb.y2 / ARR_B);
    if ((i2 - i1 + 1) * (j2 - j1 + 1) > 4096) { arrWide.push(a); return; }
    for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) { const k = i + ',' + j; let L = arrBuckets.get(k); if (!L) arrBuckets.set(k, (L = [])); L.push(a); }
  });
  const arraysNear = (x, y) => { const L = arrBuckets.get(Math.floor(x / ARR_B) + ',' + Math.floor(y / ARR_B)); return arrWide.length ? (L ? [...L, ...arrWide] : arrWide) : (L || []); };
  // covered(x, y, self): inside an exposed object other than `self` ({top: k} or {arr, i, j, obj}).
  // The top-level objects are bucketed, so a test looks only at the objects whose box holds the point.
  const topIdx = topObjs.length ? indexPolygons(topObjs, (() => {
    const w = topObjs.map((ob) => Math.max(ob.bb.x2 - ob.bb.x1, ob.bb.y2 - ob.bb.y1)).sort((a, b) => a - b);
    return Math.min(20000, Math.max(200, 2 * w[w.length >> 1]));
  })()) : null;
  const covered = (x, y, self) => {
    if (topIdx) for (const k of topIdx.near(x, y, 0)) if (!(self.top === k) && inObj(topObjs[k], x, y)) return true;
    for (const a of arraysNear(x, y)) {
      const A = arrays[a], r = A.r;
      if (x < A.bb.x1 || x > A.bb.x2 || y < A.bb.y1 || y > A.bb.y2) continue;
      let cand;
      if (A.Minv) { const [fi, fj] = apply(A.Minv, x, y); cand = []; for (let i = Math.floor(fi) - 1; i <= Math.floor(fi) + 1; i++) for (let j = Math.floor(fj) - 1; j <= Math.floor(fj) + 1; j++) if (i >= 0 && j >= 0 && i < r.cols && j < r.rows) cand.push([i, j]); }
      else cand = r.cols * r.rows === 1 ? [[0, 0]] : [];
      for (const [i, j] of cand) {
        const [lx, ly] = apply(A.Lin, x - (r.x + i * r.colStep[0] + j * r.rowStep[0]), y - (r.y + i * r.colStep[1] + j * r.rowStep[1]));
        for (let q = 0; q < A.objs.length; q++) if (!(self.arr === a && self.i === i && self.j === j && self.obj === q) && inObj(A.objs[q], lx, ly)) return true;
      }
    }
    return false;
  };
  return { covered, arrays };
}

// Slivers: in a feature only a few edge widths across, the edge pieces between corner pieces can
// come out a fraction of a nm wide. Such a piece cannot deliver dose, so its control point could
// never be met and would pin its dose to the floor. Its polygon is handed to the nearest real
// fragment of the same object (the tiling stays exact); its control point is dropped.
function absorbSlivers(fs, edgeW) {
  const sliverArea = 0.05 * edgeW * edgeW;
  const isSliver = (f) => f.kind !== 'interior' && f.kind !== 'small' && Math.abs(areaOf(f.polys)) < sliverArea;
  const keep = fs.filter((f) => !isSliver(f));
  if (!keep.length || keep.length === fs.length) return { frags: fs, degenerate: 0 };
  let degenerate = 0;
  for (const f of fs) {
    if (!isSliver(f)) continue;
    let best = keep[0], bd = Infinity;
    for (const g of keep) { const d = Math.hypot(g.control[0] - f.control[0], g.control[1] - f.control[1]); if (d < bd) { bd = d; best = g; } }
    best.polys = [...best.polys, ...f.polys]; degenerate++;
  }
  return { frags: keep, degenerate };
}

// One object's fracture and outline samples: job = {polys, self, full?} (full: the whole object when
// polys is its part inside the zones — outside the zones it is a joint, not an edge). Samples come back
// flat, [x, y, w, vertex] per point; the caller adds dose and counting. Pure: the same job gives the same
// answer in any thread.
export function fractureJob(job, o, covered, zones, hS, contour) {
  const inZone = (x, y) => zones.some((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
  const cov = job.full ? (x, y, me) => covered(x, y, me) || (!inZone(x, y) && inObj(job.full, x, y)) : covered;
  const { frags, degenerate } = absorbSlivers(fractureObject(job.polys, o, (x, y) => cov(x, y, job.self)), o.edgeW);
  const samples = [];
  if (contour) {
    const ob = { polys: job.polys, bb: bbOf(job.polys) };
    for (const ring of job.polys) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n], L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        let nx = (by - ay) / L, ny = -(bx - ax) / L;            // a normal; pointed outwards below
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (inObj(ob, mx + nx * 0.5, my + ny * 0.5)) { nx = -nx; ny = -ny; }
        const m = Math.max(1, Math.ceil(L / hS));
        for (let j = 0; j < m; j++) {
          const t = (j + 0.5) / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          if (cov(x + nx * 2, y + ny * 2, job.self)) continue;   // a joint: no developed edge here
          samples.push(x, y, 1, 0);
        }
        if (!cov(ax, ay, job.self)) samples.push(ax, ay, 0.3, 1);
      }
    }
  }
  return { frags, degenerate, samples };
}
// A batch of jobs in order (progress: called with the number done).
export function runFractureJobs(jobs, o, covered, zones, hS, contour, progress) {
  const out = new Array(jobs.length);
  for (let n = 0; n < jobs.length; n++) { out[n] = fractureJob(jobs[n], o, covered, zones, hS, contour); if (progress && (n & 63) === 63) progress(n + 1); }
  progress?.(jobs.length);
  return out;
}

// Index ranges along one array axis: the first and last `ctx` elements one by one, the middle in tiles.
function axisSegments(n, ctx, tileE) {
  // ctx elements at each end individually (their short-range surroundings differ), then tiles
  // that grow ¼, ½ … of a tile away from the ends (the backscatter background changes fastest
  // there) up to tileE, and uniform tiles of ≤ tileE in the middle
  if (n <= 2 * ctx + 1) return Array.from({ length: n }, (_, i) => [i, i]);
  const head = [], tail = [];
  let a = ctx, b = n - ctx - 1;                               // the remaining middle [a, b]
  for (let i = 0; i < ctx; i++) { head.push([i, i]); tail.unshift([n - 1 - i, n - 1 - i]); }
  for (let w = Math.max(1, Math.round(tileE / 4)); w < tileE && b - a + 1 > 2 * w + tileE; w *= 2) { head.push([a, a + w - 1]); tail.unshift([b - w + 1, b]); a += w; b -= w; }
  const nt = Math.max(1, Math.ceil((b - a + 1) / tileE)), mid = [];
  for (let t = 0; t < nt; t++) mid.push([a + Math.floor(((b - a + 1) * t) / nt), a + Math.floor(((b - a + 1) * (t + 1)) / nt) - 1]);
  return [...head, ...mid, ...tail];
}

// Progress: every message carries frac, the overall fraction 0..1. The stages are weighted by
// their measured share of a typical large run (PROGRESS_WEIGHTS); within a stage
// the fraction is objects fractured, points integrated, or the solve's progress towards tol.
// Messages are throttled to one per 80 ms, except a stage's first and last.
export const PROGRESS_WEIGHTS = { fracture: 0.10, sr: 0.26, lr: 0.08, solve: 0.53, finish: 0.03 };
// The correction as a sequence of steps that yields its two heavy requests (the targets and the short-
// range operator) instead of computing them, so a caller can hand them to several workers. Each request
// carries everything a worker needs ({kind, pts, roi, library, psf}) and a local() fallback.
const boundsPts = (P) => boundsXY(toXY(P));
// The global solve and the dose classes on plain arrays. The native core's pec.cpp is a line-by-line
// port (gate gd5 compares the two). P: the problem (fragments, points, targets, options); SR: the short-
// range rows {ptr, idx, val}; lrApply(d) → the long-range dose at the points for fragment doses d.
// Returns the writing doses rounded to the dose classes, their class indices, the delivered dose with
// them, and the convergence record.
export function solveFractured(P, SR, lrApply, onIter) {
  const { I: RI, V: RV, S: RS, O: RO, L: RL } = rowsOf(SR);      // either row form (srrows.js), same order
  const { nF, nP, contour, longOnly, srSelf, ptWant, ptW, ptBand, base, k: kk, want, banded, maxFactor, floor, tol, maxIter, bLo, bHi } = P;
  const d = Float64Array.from(P.d0);
  const doseNow = () => {
    const lr = lrApply(d), out = new Float64Array(nP);
    for (let p = 0; p < nP; p++) { let v = lr[p] + (longOnly ? srSelf * d[p] : 0); const s = RS ? RS[p] : 0, ri = RI[s], rv = RV[s], o = RO[p], e = o + RL[p]; for (let q = o; q < e; q++) v += rv[q] * d[ri[q]]; out[p] = v; }
    return out;
  };
  let it, err = Infinity;
  const history = [];
  const num = contour ? new Float64Array(nF) : null, den = contour ? new Float64Array(nF) : null;
  for (it = 1; it <= maxIter; it++) {
    const got = doseNow();
    err = 0;
    if (contour) {
      num.fill(0); den.fill(0);
      for (let p = 0; p < nP; p++) {
        const g = got[p];
        let w = ptWant[p];
        if (ptBand[p]) w = Math.min(Math.max(g, bLo * w), bHi * w);    // inside the band: no error
        const wk = ptW[p];
        const s = RS ? RS[p] : 0, ri = RI[s], rv = RV[s], o = RO[p], e = o + RL[p];
        for (let q = o; q < e; q++) { const a = rv[q] * wk, i = ri[q]; num[i] += a * w; den[i] += a * g; }
      }
      for (let i = 0; i < nF; i++) {
        const di = d[i];
        const nd = Math.min(base[i] * maxFactor, Math.max(base[i] * floor, den[i] > 0 ? di * (num[i] / den[i]) : di));
        err = Math.max(err, Math.abs(nd / di - 1));
        d[i] = nd;
      }
    } else {
      for (let n = 0; n < nF; n++) {
        let w = want[n] * base[n] * kk[n];
        const g = got[n], dn = d[n];
        if (banded[n]) {                                     // inside the band: leave it alone
          if (g >= bLo * w && g <= bHi * w) continue;
          w *= g < bLo * w ? bLo : bHi;
        }
        err = Math.max(err, Math.abs(g / w - 1));
        d[n] = Math.min(base[n] * maxFactor, Math.max(base[n] * floor, g > 0 ? dn * (w / g) : dn * maxFactor));
      }
    }
    history.push(err);
    onIter?.(it, err, history);
    if (err < tol) break;
  }
  // dose classes: N levels, logarithmic between the smallest and largest absolute dose
  let lo = Infinity, hi = -Infinity;
  const abs = new Float64Array(nF);
  for (let n = 0; n < nF; n++) { abs[n] = d[n] * kk[n]; if (abs[n] < lo) lo = abs[n]; if (abs[n] > hi) hi = abs[n]; }
  const N = P.classes;
  const classes = new Float64Array(N);
  for (let c = 0; c < N; c++) classes[c] = N === 1 || hi <= lo ? lo : lo * Math.pow(hi / lo, c / (N - 1));
  const cls = new Int32Array(nF);
  for (let n = 0; n < nF; n++) {
    const c = N === 1 || hi <= lo ? 0 : Math.round((Math.log(abs[n] / lo) / Math.log(hi / lo)) * (N - 1));
    cls[n] = c; d[n] = classes[c] / kk[n];
  }
  return { write: d, cls, classes, gotQ: doseNow(), history: Float64Array.from(history), it: Math.min(it, maxIter), err, lo, hi };
}

function* fractureSteps(project, options = {}, onProgress) {
  const t0 = Date.now();
  const stageOrder = Object.keys(PROGRESS_WEIGHTS);
  let lastSent = 0, lastFrac = 0;
  const report = (stage, f, extra = {}, force = false) => {
    if (!onProgress) return;
    let base = 0; for (const k of stageOrder) { if (k === stage) break; base += PROGRESS_WEIGHTS[k]; }
    const frac = Math.max(lastFrac, Math.min(1, base + PROGRESS_WEIGHTS[stage] * Math.max(0, Math.min(1, f))));
    const now = Date.now();
    if (!force && now - lastSent < 80) return;
    lastSent = now; lastFrac = frac;
    onProgress({ stage, stageFrac: f, frac, elapsed: now - t0, ...extra });
  };
  report('fracture', 0, {}, true);
  // a flat layout's regular grids of identical shapes become arrays first, so the array machinery
  // (one fractured element per context class) can reuse its work; the polygons are the same
  const recovered = options.recoverArrays === false ? null : recoverArrays(project.library);
  if (recovered && recovered.stats.arrays) project = { ...project, library: recovered.library };
  const lib = project.library, top = lib.cells[lib.top], exposed = exposedLayer(lib);
  const probe = createEngine(project);
  const sp = probe.prepare(probe.bbox || { x1: 0, y1: 0, x2: 1, y2: 1 }).split;
  const beta = Math.max(...(probe.psf.gauss ?? probe.psf.fit.terms).map((t) => t.s));
  const o = { ...PEC_DEFAULTS, ...options };
  if (!o.tile) o.tile = Math.min(10000, Math.max(500, beta / 8));
  const ctxDist = sp.rMaxSR;                                   // short-range reach (forward + mid-range)
  // ---- what is solved and what is context. A region is one zone; a high-resolution run has any
  // number of zones and/or whole layers. Zone = rectangle + halo (solved); the rectangle alone counts.
  const nrm = (r) => ({ x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2), x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2) });
  const region = o.region ? nrm(o.region) : null;
  const rects = [...(region ? [region] : []), ...((o.high && o.high.zones) || []).map(nrm)];
  const highL = new Set((o.high && o.high.layers) || []);
  const partial = rects.length > 0 || highL.size > 0;
  const halo = partial ? (o.halo != null ? +o.halo : Math.max(2 * ctxDist, 1000)) : 0;
  const zones = rects.map((r) => ({ x1: r.x1 - halo, y1: r.y1 - halo, x2: r.x2 + halo, y2: r.y2 + halo }));
  const zone = zones.length ? zones[0] : null;
  const quickOnly = o.range === 'quick';
  const hits = (b, z) => !(b.x2 < z.x1 || b.x1 > z.x2 || b.y2 < z.y1 || b.y1 > z.y2);
  const meetsZone = (b) => zones.some((z) => hits(b, z));
  const meets = (b, layer) => !quickOnly && (!partial || highL.has(layer) || meetsZone(b));
  const inRegion = (x, y) => !partial || rects.some((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2);
  let curHigh = false;                                         // the object being fractured is on a high layer
  const counts = (x, y) => curHigh || inRegion(x, y);          // its pieces count in the statistics
  let quick = null, ctxLib = null, ctxObjects = 0;
  if (partial || quickOnly) {
    report('fracture', 0, { quick: true }, true);
    quick = o.quickIn || quickLongRange(project, { maxFactor: o.maxFactor, minFactor: o.minFactor });
    ctxLib = makeLibrary('CONTEXT');
  }
  const ctxTop = ctxLib ? ctxLib.cells[ctxLib.top] : null;
  // context dose classes: log spaced over every dose the context can get (design doses × array dose
  // scales × quick factors), o.classes of them; a context dose is snapped to its class, so what the
  // solve sees as the fixed source is exactly what is written
  let snapC = null, stepC = 1;
  if (ctxLib) {
    let dLo = Infinity, dHi = 0, kLo = 1, kHi = 1, fLo = Infinity, fHi = 0;
    for (const c of Object.values(lib.cells)) {
      for (const sh of c.shapes) if (exposed(sh.layer) && sh.dose > 0) { if (sh.dose < dLo) dLo = sh.dose; if (sh.dose > dHi) dHi = sh.dose; }
      for (const rr of c.refs) { const k = rr.doseScale ?? 1; if (k < kLo) kLo = k; if (k > kHi) kHi = k; }
    }
    for (const v of quick.factor) { if (v < fLo) fLo = v; if (v > fHi) fHi = v; }
    const loC = dLo * kLo * kLo * fLo, hiC = dHi * kHi * kHi * fHi, nC = Math.max(2, o.classes);
    stepC = hiC > loC * 1.000001 ? Math.pow(hiC / loC, 1 / (nC - 1)) : 1;
    snapC = (v) => { if (stepC === 1) return { i: 0, v: loC }; const i = Math.min(nC - 1, Math.max(0, Math.round(Math.log(v / loC) / Math.log(stepC)))); return { i, v: loC * Math.pow(stepC, i) }; };
  }
  // a context object of the top cell: its outline as plain shapes at dose × the quick factor
  const addContextTop = (ob) => {
    const fq = quick ? quick.sampleAt((ob.bb.x1 + ob.bb.x2) / 2, (ob.bb.y1 + ob.bb.y2) / 2) : 1, g = uid('c'), c = snapC(ob.dose * fq);
    for (const p of holeFree(ob.polys)) {
      let cx = 0, cy = 0; for (const [x, y] of p) { cx += x; cy += y; } cx /= p.length; cy /= p.length;
      ctxTop.shapes.push({ id: uid('c'), kind: 'poly', layer: ob.layer, cx, cy, rot: 0, pts: p.map(([x, y]) => [x - cx, y - cy]), dose: ob.dose, writeDose: c.v, _cc: c.i, groupId: g, frag: 'context' });
    }
    ctxObjects++;
  };
  // a design cell as context at factor m (× its design doses): one copy per factor class, with its
  // shapes as polygons at snapped doses and its children copied the same way (a child's own dose
  // scale folded into the factor), so the writing data carries no dose-scaled references
  const ctxCopy = (name, m) => {
    const qi = Math.round(Math.log(m) / Math.log(stepC > 1 ? stepC : 1.0005)), key = `${name}~ctx${qi}`;
    if (ctxLib.cells[key]) return key;
    const src = lib.cells[name], c = makeCell(key);
    ctxLib.cells[key] = c;
    const mq = Math.pow(stepC > 1 ? stepC : 1.0005, qi);
    for (const sh of src.shapes) {
      if (!exposed(sh.layer)) continue;
      const p = sh.kind === 'poly' ? null : outlineWorld(sh), sn = snapC((sh.dose || 0) * mq);
      let cx = sh.cx, cy = sh.cy, pts = sh.pts;
      if (p) { cx = 0; cy = 0; for (const [x, y] of p) { cx += x; cy += y; } cx /= p.length; cy /= p.length; pts = p.map(([x, y]) => [x - cx, y - cy]); }
      c.shapes.push({ ...sh, kind: 'poly', cx, cy, rot: sh.kind === 'poly' ? sh.rot : 0, pts, writeDose: sn.v, _cc: sn.i, frag: 'context' });
    }
    for (const rr of src.refs) { const { doseScale, ...rest } = rr; c.refs.push({ ...rest, cell: ctxCopy(rr.cell, mq * (doseScale ?? 1)) }); }
    return key;
  };

  // ---- world objects, for joints (touching / overlapping neighbours)
  const topObjs = cellObjects({ ...lib, cells: { ...lib.cells, [lib.top]: { ...top, refs: [] } } }, lib.top, exposed);
  const { covered, arrays } = makeCovered(topObjs, top.refs.map((r) => ({ r, objs: cellObjects(lib, r.cell, exposed) })));

  // ---- the writing library: fragments as fused groups of hole-free polygons
  const W = makeLibrary('WRITING');
  W.layers = lib.layers.map((l) => ({ ...l }));
  const WT = W.cells[W.top];
  // fragments as columns (ChipV11: 1.46 M of them; as objects with their shapes 1.1 kB each): control
  // point (world), want (0.5|1|tip share), base (dose before k), k, kind, cnt (counts in the statistics),
  // and where its shapes are: rows r0..r1 of writing cell number cell
  const FR = { cx: [], cy: [], want: [], base: [], k: [], kind: [], cnt: [], cell: [], r0: [], r1: [] };
  // the writing cells' shapes, packed row by row (pack.js); a cell's packer is made on its first fragment
  const packers = new Map();
  const packerOf = (cell) => {
    let e = packers.get(cell);
    if (!e) { e = { cell, idx: packers.size, p: makePolyPacker(['layer', 'frag'], ['cx', 'cy', 'rot', 'dose', 'writeDose', 'groupId', 'fi', 'doseClass']), P: null }; packers.set(cell, e); }
    return e;
  };
  let gCount = 0;
  // Slivers: in a feature only a few edge widths across, the edge pieces between corner pieces can
  // come out a fraction of a nm wide. Such a piece cannot deliver dose, so its control point could
  // never be met and would pin its dose to the floor. Its polygon is handed to the nearest real
  // fragment of the same object (the tiling stays exact); its control point is dropped.
  let degenerate = 0;
  // the fracture work as jobs, in loop order; each carries what to do with its result (then)
  const jobs = [];
  const queue = (job, then) => { const ch = curHigh; jobs.push({ job, then: (r) => { curHigh = ch; degenerate += r.degenerate; then(r); } }); };
  const addSamples = (flat) => { for (let q = 0; q < flat.length; q += 4) { SM.x.push(flat[q]); SM.y.push(flat[q + 1]); SM.w.push(flat[q + 2]); SM.cnt.push(counts(flat[q], flat[q + 1]) ? 1 : 0); } };
  const addFrag = (cell, f, T, Tinv, base, k, layer) => {
    const e = packerOf(cell), g = ++gCount, n = FR.cx.length, r0 = e.p.n;
    for (const p of holeFree(f.polys)) {
      const pts = Tinv ? p.map(([x, y]) => apply(Tinv, x, y)) : p;
      let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; } cx /= pts.length; cy /= pts.length;
      e.p.push({ layer, frag: f.kind, cx, cy, rot: 0, dose: base, writeDose: base, groupId: g, fi: n }, pts.map(([x, y]) => [x - cx, y - cy]));
    }
    // targets: ½ at edges becomes the equalization level; a corner may take its natural share instead.
    // An ACUTE corner (share < ¼, a tip sharper than 90°) always does: pulling a sharp tip to ½ needs
    // several times the dose and spills along the axis (a bowtie gap measured 392 % of target).
    const want = o.range === 'long' ? 1 : f.target >= 1 ? f.target : (f.kind === 'corner' && f.tip != null && (o.corners === 'natural' || f.tip < 0.25) ? f.tip : f.target) * (o.level / 0.5);
    FR.cx.push(f.control[0]); FR.cy.push(f.control[1]); FR.want.push(want); FR.base.push(base); FR.k.push(k); FR.kind.push(f.kind);
    FR.cnt.push(counts(f.control[0], f.control[1]) ? 1 : 0); FR.cell.push(e.idx); FR.r0.push(r0); FR.r1.push(e.p.n);
  };
  // contour samples (world): outline every h nm and the vertices; the targets are set later
  const SM = { x: growF64(), y: growF64(), w: growF64(), cnt: growU8() };   // contour samples (world), weight, counts
  const hS = o.sampleNm ?? Math.max(5, Math.min(25, o.edgeW / 2));
  const contour = o.fit === 'contour' && o.range !== 'long';
  // ---- region: solve a world object (top level or an array element taken alone)
  const zoneRings = zones.map((z) => [[z.x1, z.y1], [z.x2, z.y1], [z.x2, z.y2], [z.x1, z.y2]]);
  const inZone = (x, y) => zones.some((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
  const insideZone = (b) => zones.some((z) => b.x1 >= z.x1 && b.x2 <= z.x2 && b.y1 >= z.y1 && b.y2 <= z.y2);
  const solveWorld = (polys, bb, dose, k, layer, self) => {
    if (!meets(bb, layer)) { addContextTop({ polys, bb, dose: dose * k, layer }); return; }
    curHigh = highL.has(layer);
    if (!partial || curHigh || insideZone(bb)) {
      queue({ polys, self }, (r) => { for (const f of r.frags) addFrag(WT, f, null, null, dose, k, layer); addSamples(r.samples); });
      return;
    }
    // straddles the zone: the cut is a joint (the object continues beyond it), the rest is context
    const full = { polys, bb };
    const inner = intersectPolygons(polys, zoneRings), outer = differencePolygons(polys, zoneRings);
    if (inner.length) queue({ polys: inner, self, full }, (r) => { for (const f of r.frags) addFrag(WT, f, null, null, dose, k, layer); addSamples(r.samples); });
    if (outer.length) addContextTop({ polys: outer, bb: bbOf(outer), dose: dose * k, layer });
  };
  // segments of each array, computed once: used to count the work and then to do it
  const segsOf = arrays.map((A) => {
    const r = A.r;
    const pitchI = Math.hypot(...r.colStep) || 1, pitchJ = Math.hypot(...r.rowStep) || 1;
    const ctxI = o.ctx ?? Math.max(1, Math.ceil(ctxDist / pitchI)), ctxJ = o.ctx ?? Math.max(1, Math.ceil(ctxDist / pitchJ));
    return { segI: axisSegments(r.cols, ctxI, Math.max(1, Math.round(o.tile / pitchI))), segJ: axisSegments(r.rows, ctxJ, Math.max(1, Math.round(o.tile / pitchJ))) };
  });
  const objTotal = Math.max(1, topObjs.length + arrays.reduce((t, A, a) => t + segsOf[a].segI.length * segsOf[a].segJ.length * A.objs.length, 0));
  let objDone = 0;
  const tickObj = () => { objDone++; report('fracture', 0.05 * objDone / objTotal, { objects: 0, objectsTotal: objTotal }); };
  topObjs.forEach((ob, k) => { solveWorld(ob.polys, ob.bb, ob.dose, 1, ob.layer, { top: k }); tickObj(); });
  let nClasses = 0;
  arrays.forEach((A, a) => {
    const r = A.r, kref = r.doseScale ?? 1;
    const { segI, segJ } = segsOf[a];
    const cellBB = A.objs.length ? bbOf(A.objs.flatMap((ob) => ob.polys)) : null;
    // a cell entirely on high layers is fractured as an array (its work reused), as in a full run
    const allHigh = A.objs.length > 0 && A.objs.every((ob) => highL.has(ob.layer)), anyHigh = A.objs.some((ob) => highL.has(ob.layer));
    curHigh = allHigh;
    for (const [i0, i1] of segI) for (const [j0, j1] of segJ) {
      const ic = Math.floor((i0 + i1) / 2), jc = Math.floor((j0 + j1) / 2);
      if ((partial || quickOnly) && cellBB && !(allHigh && !quickOnly)) {
        let sb = null;
        for (const [ii, jj] of [[i0, j0], [i1, j0], [i0, j1], [i1, j1]]) { const b = applyBBox(elementTransform(r, ii, jj), cellBB); sb = sb ? { x1: Math.min(sb.x1, b.x1), y1: Math.min(sb.y1, b.y1), x2: Math.max(sb.x2, b.x2), y2: Math.max(sb.y2, b.y2) } : b; }
        if (quickOnly || !(anyHigh || meetsZone(sb))) {
          // the sub-array as context: the design cell, dose scaled by the quick factor at its centre
          const [ox, oy] = [r.x + i0 * r.colStep[0] + j0 * r.rowStep[0], r.y + i0 * r.colStep[1] + j0 * r.rowStep[1]];
          const ref = makeRef(ctxCopy(r.cell, kref * quick.sampleAt((sb.x1 + sb.x2) / 2, (sb.y1 + sb.y2) / 2)), { x: ox, y: oy, rot: r.rot, mag: r.mag, mirrorX: r.mirrorX, cols: i1 - i0 + 1, rows: j1 - j0 + 1, colStep: r.colStep, rowStep: r.rowStep });
          ctxTop.refs.push(ref); ctxObjects += A.objs.length * ref.cols * ref.rows;
          for (let q = 0; q < A.objs.length; q++) tickObj();
          continue;
        }
        // it meets the zone: element by element; elements that miss it stay context as one-element refs
        for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) {
          const T = elementTransform(r, ii, jj), eb = applyBBox(T, cellBB);
          if (!(anyHigh || meetsZone(eb))) {
            const ref = makeRef(ctxCopy(r.cell, kref * quick.sampleAt((eb.x1 + eb.x2) / 2, (eb.y1 + eb.y2) / 2)), { x: r.x + ii * r.colStep[0] + jj * r.rowStep[0], y: r.y + ii * r.colStep[1] + jj * r.rowStep[1], rot: r.rot, mag: r.mag, mirrorX: r.mirrorX });
            ctxTop.refs.push(ref); ctxObjects += A.objs.length;
            continue;
          }
          A.objs.forEach((ob, q) => {
            const wp = ob.polys.map((p) => p.map(([x, y]) => apply(T, x, y)));
            solveWorld(wp, bbOf(wp), ob.dose, kref, ob.layer, { arr: a, i: ii, j: jj, obj: q });
          });
        }
        for (let q = 0; q < A.objs.length; q++) tickObj();
        continue;
      }
      const T = elementTransform(r, ic, jc), Tinv = invert(T);
      const cname = `${r.cell}~${a}_${i0}_${j0}`;
      const cell = makeCell(cname); W.cells[cname] = cell;
      A.objs.forEach((ob, q) => {
        const wp = ob.polys.map((p) => p.map(([x, y]) => apply(T, x, y)));
        queue({ polys: wp, self: { arr: a, i: ic, j: jc, obj: q } }, (r) => { for (const f of r.frags) addFrag(cell, f, T, Tinv, ob.dose, kref, ob.layer); addSamples(r.samples); });
        tickObj();
      });
      // the sub-array: origin of element (i0, j0) with the cell's own placement
      const [ox, oy] = [r.x + i0 * r.colStep[0] + j0 * r.rowStep[0], r.y + i0 * r.colStep[1] + j0 * r.rowStep[1]];
      const ref = makeRef(cname, { x: ox, y: oy, rot: r.rot, mag: r.mag, mirrorX: r.mirrorX, cols: i1 - i0 + 1, rows: j1 - j0 + 1, colStep: r.colStep, rowStep: r.rowStep });
      if (kref !== 1) ref.doseScale = kref;
      WT.refs.push(ref); nClasses++;
    }
  });
  {
    const plain = jobs.map((j) => j.job);
    // too big to solve here? The control points: one per fragment (about one per segment length of outline
    // plus the interior tiles) and, for the contour fit, one per sample spacing of outline. Estimated from
    // the outline lengths before any work; ChipV11 at 25 nm came to 22.7 M points and 9.7 GB, which no
    // browser worker holds. o.maxPoints (set by the page) refuses such a run with the ways out.
    if (o.maxPoints > 0) {
      let per = 0, nv = 0;
      for (const j of plain) for (const p of j.polys) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); nv++; }
      const est = Math.round(per / Math.max(20, o.segLen || 500) + nv + (contour ? per / hS : 0));
      if (est > o.maxPoints) {
        const what = `${plain.length.toLocaleString()} objects, ${(per / 1e6).toFixed(1)} mm of outline${contour ? ` sampled every ${hS} nm` : ''}`;
        throw new Error(`This correction would need about ${(est / 1e6).toFixed(1)} million control points (${what}), more than ${o.desktop ? "this computer can hold" : "fits in the browser"} (${(o.maxPoints / 1e6).toFixed(0)} million). ${o.desktop ? "" : "The desktop version (Start EBL Workbench.cmd) uses the whole computer and takes much larger runs. "}Or use Correct: high-resolution parts (mark only what needs it) or a selected region; the Quick method for the whole chip; or the Control points fit${contour ? ' or Precision: Draft' : ''}.`);
      }
    }
    const fo = { ...o, quickIn: undefined };
    const prog = (d) => report('fracture', 0.05 + 0.95 * d / Math.max(1, plain.length), { objects: d, objectsTotal: plain.length });
    const res = yield { kind: 'fracture', jobs: plain, o: fo, zones, hS, contour, topObjs, arrays: arrays.map((A) => ({ r: A.r, objs: A.objs })), progress: prog,
      local: () => runFractureJobs(plain, fo, covered, zones, hS, contour, prog) };
    jobs.forEach((j, n) => { j.then(res[n]); res[n] = null; plain[n] = null; });
    jobs.length = 0;                                             // the jobs and their results are not needed again (memory)
  }
  const Ps = [];
  for (const e of packers.values()) { e.P = e.p.finish(); e.p = null; delete e.cell.shapes; e.cell.__shapes = e.P; Ps[e.idx] = e.P; }
  packers.clear();
  const nF = FR.cx.length;
  const eachRow = (n, fn) => { const P = Ps[FR.cell[n]]; for (let r = FR.r0[n]; r < FR.r1[n]; r++) fn(P, r); };
  // the context joins the top writing cell (packed or not)
  const joinContext = () => {
    if (isPackedCell(WT)) WT.__shapes = appendShapes(WT.__shapes, ctxTop.shapes); else for (const x of ctxTop.shapes) WT.shapes.push(x);
    for (const x of ctxTop.refs) WT.refs.push(x);
  };
  if (ctxLib) ctxLib.layers = lib.layers.map((l) => ({ ...l }));
  // the dose classes in use: the solve's and the context's, merged in order of dose
  let classMerge = 0;                                         // the largest dose change merging caused
  const mergeClasses = (fragClasses, fragCls) => {
    const used = new Set();
    for (const c of Object.values(ctxLib ? ctxLib.cells : {})) for (const sh of c.shapes) if (sh._cc != null) used.add(sh._cc);
    const all = [...fragClasses.map((v, i) => ({ v, f: i })), ...[...used].map((i) => ({ v: snapC.at(i), c: i }))].sort((a, b) => a.v - b.v);
    // the two sets interleave (solve and context each up to o.classes): a writer's table holds
    // o.classes in all, so the closest neighbours (in log dose) are merged until it fits, each merged
    // class at the geometric mean of its members; the shapes are written at their class's value
    const grp = all.map((e) => ({ lo: Math.log(e.v), hi: Math.log(e.v), sum: Math.log(e.v), n: 1, m: [e] }));
    while (grp.length > Math.max(1, o.classes)) {
      let best = 0, bd = Infinity;
      for (let i = 0; i + 1 < grp.length; i++) { const d = grp[i + 1].hi - grp[i].lo; if (d < bd) { bd = d; best = i; } }
      const a = grp[best], b = grp[best + 1];
      grp.splice(best, 2, { lo: a.lo, hi: b.hi, sum: a.sum + b.sum, n: a.n + b.n, m: [...a.m, ...b.m] });
    }
    const vals = grp.map((g) => Math.exp(g.sum / g.n));
    const fMap = new Int32Array(fragClasses.length), cMap = new Map();
    grp.forEach((g, n) => { for (const e of g.m) { classMerge = Math.max(classMerge, Math.abs(vals[n] / e.v - 1)); if (e.f != null) fMap[e.f] = n; else cMap.set(e.c, n); } });
    if (fragCls) for (let n = 0; n < nF; n++) { const c = fMap[fragCls[n]]; eachRow(n, (P, r) => { setNum(P, 'doseClass', r, c); setNum(P, 'writeDose', r, vals[c]); }); }
    for (const c of Object.values(ctxLib ? ctxLib.cells : {})) for (const sh of c.shapes) if (sh._cc != null) { sh.doseClass = cMap.get(sh._cc); sh.writeDose = vals[sh.doseClass]; delete sh._cc; }
    return vals;
  };
  if (snapC) snapC.at = (i) => snapC(0).v * Math.pow(stepC, i);
  if (quickOnly) {
    // the quick result: the context is the writing data
    const classes = mergeClasses([], null);
    joinContext();
    for (const [name, c] of Object.entries(ctxLib.cells)) if (name !== ctxLib.top) W.cells[name] = c;
    report('finish', 1, {}, true);
    return {
      library: W, method: 'quick-lr', params: { ...o, quickIn: undefined, packed: undefined, beta, ctxDist }, classes,
      stats: { fragments: 0, slivers: 0, shapes: 0, arrayClasses: 0, kinds: {}, iterations: quick.iterations, converged: quick.converged, maxErr: quick.maxErr, maxErrQuant: 0, worst: {}, history: [],
        doseRange: [classes[0] ?? 0, classes[classes.length - 1] ?? 0], capped: 0, ms: Date.now() - t0, fit: 'quick',
        quick: { objects: ctxObjects, grid: { nx: quick.grid.nx, ny: quick.grid.ny, dx: quick.grid.dx }, factor: quick.factor.reduce((m, v) => [Math.min(m[0], v), Math.max(m[1], v)], [Infinity, -Infinity]), ms: quick.ms } },
      controls: [],
    };
  }
  // a region or zones that meet nothing: say so (an empty solve gives no doses and no classes)
  if (partial && !quickOnly && !FR.cnt.some((c) => c)) {
    throw new Error(region && !o.high ? 'The selected region contains no part of the layout. Press Pick region and drag a rectangle over the pattern.'
      : 'The high-resolution parts contain no exposed object: check the layers set to high resolution and the zones on the High-resolution PEC zones layer.');
  }
  report('fracture', 1, { fragments: nF, classes: nClasses }, true);
  onProgress?.({ stage: 'fractured', fragments: nF, classes: nClasses });
  report('sr', 0, { points: nF }, true);

  // ---- the global solve: d ← d · want / got at every control point, full PSF. The short range
  // is linear in the fragment doses: one sparse operator, built once; the long range (the β grid)
  // is re-sampled each iteration.
  for (const k of ['x', 'y', 'w', 'cnt']) SM[k] = SM[k].finish();   // typed from here on
  const nS = contour ? SM.x.length : 0;
  const pxy = new Float64Array(2 * (nF + nS));
  for (let n = 0; n < nF; n++) { pxy[2 * n] = FR.cx[n]; pxy[2 * n + 1] = FR.cy[n]; }
  for (let q = 0; q < nS; q++) { pxy[2 * (nF + q)] = SM.x[q]; pxy[2 * (nF + q) + 1] = SM.y[q]; }
  const pts = flatPoints(pxy);
  SM.x = SM.y = null;                                          // copied into pts
  // contour fit: every point gets a target from the design's short-range dose (normalised)
  let ptW = null, ptWant = null, ptBand = null;
  if (contour) {
    const extra = [];
    // no extra point inside edge strips: with backscatter present, the full target there and ½ on the
    // edge cannot both be met by one strip dose, and asking for both biases every edge upward
    // (the samples follow the control points in pts already)
    report('sr', 0.02, { points: pts.length }, true);
    const roi = boundsPts(pts);                               // one region for every chunk of the job
    const srN = probe.prepare(roi).split.sr.integral || 1;
    const ref = yield { kind: 'targets', pts, roi, reach: ctxDist, library: project.library, psf: project.psf, local: () => probe.doseAt(pts, 'shortrange', roi) };
    ptW = new Float64Array(pts.length); ptWant = new Float64Array(pts.length); ptBand = new Uint8Array(pts.length);
    for (let n = 0; n < pts.length; n++) {
      ptWant[n] = ref[n] / srN;
      ptW[n] = n < nF ? (FR.want[n] >= 1 ? 0.5 : FR.kind[n] === 'corner' || FR.kind[n] === 'end' ? 0.3 : 1) : n < nF + extra.length ? extra[n - nF].w : SM.w[n - nF - extra.length];
      ptBand[n] = o.interior === 'band' && n < nF && FR.want[n] >= 1 ? 1 : 0;
    }
    // array context classes are corrected at their central element: those doses count once per class
  }
  const solveProject = { library: W, psf: project.psf };
  // each writing shape carries its fragment index (fi, set as it was packed), so a worker given a copy of
  // the library can map shapes back to fragments; removed again before the result is returned
  const solver = createEngine(solveProject), keyOf = (s) => s.fi;
  const longOnly = o.range === 'long';
  const srSelf = sp.sr.integral;                               // short range of an infinite area, per unit dose
  const roiAll = boundsPts(pts);
  const SR = longOnly ? { ptr: new Int32Array(pts.length + 1), idx: new Int32Array(0), val: new Float64Array(0) }
    : yield { kind: 'sr', pts, roi: roiAll, reach: ctxDist, library: W, psf: project.psf, progress: (f) => report('sr', f, { points: pts.length }), local: () => solver.srOperator(pts, keyOf, (f) => report('sr', f, { points: pts.length }), roiAll) };
  if (longOnly) report('sr', 1, { points: pts.length }, true);
  const srEntries = SR.token != null ? SR.entries : srCount(SR);
  report('lr', 0, { entries: srEntries }, true);
  // long range: each fragment's coverage of the β grid gathered once; per iteration a weighted sum
  // and one FFT (was: re-rasterising every fragment each iteration)
  const hasCtx = !!ctxLib && (ctxTop.shapes.length > 0 || ctxTop.refs.length > 0);
  const LR = solver.lrOperator(pts, keyOf, hasCtx ? (grid) => createEngine({ library: ctxLib, psf: project.psf }).raster(grid, 'write') : null);
  if (hasCtx) {
    // the context's short-range dose at the points too, not only its backscatter: an object cut at the
    // margin, or a neighbour just outside it, forward-scatters onto the fragments beside it, and without
    // this they look under-exposed, are pushed to the dose cap and stop the solve converging
    const ctxSR = createEngine({ library: ctxLib, psf: project.psf }).doseAt(pts, 'shortrange', roiAll), lrBase = LR.apply;
    LR.apply = (dose) => { const v = lrBase(dose); for (let k = 0; k < v.length; k++) v[k] += ctxSR[k]; return v; };
  }
  report('lr', 1, {}, true);
  onProgress?.({ stage: 'operator', entries: srEntries, lrEntries: LR.entries });
  const floor = o.minFactor > 0 ? o.minFactor : 1 / o.maxFactor;
  const banded = (n) => o.interior === 'band' && FR.want[n] >= 1;     // interior / joint under edge equalization
  const [bLo, bHi] = o.interiorBand;
  const prob = {
    nF, nP: pts.length, contour, longOnly, srSelf, ptWant, ptW, ptBand,
    d0: Float64Array.from(FR.base), base: Float64Array.from(FR.base),
    k: Float64Array.from(FR.k), want: Float64Array.from(FR.want), banded: Uint8Array.from(FR.want, (w, n) => (banded(n) ? 1 : 0)),
    maxFactor: o.maxFactor, floor, tol: o.tol, maxIter: contour ? Math.max(o.maxIter, 150) : o.maxIter, bLo, bHi, classes: Math.max(1, o.classes | 0),
  };
  // towards tol on a log scale, or through the iteration budget, whichever is further along
  const onIter = (it, e, history) => {
    const e0 = history[0], conv = e0 > o.tol && e < e0 ? Math.log(e0 / e) / Math.log(e0 / o.tol) : 0;
    report('solve', Math.max(it / prob.maxIter, conv), { iteration: it, maxIter: prob.maxIter, maxError: e, tol: o.tol }, true);
  };
  // the native core can solve with the short-range operator it kept (SR.token); done here instead,
  // an operator the core kept is rebuilt first
  const sol = yield { kind: 'solve', prob, sr: SR, pts, lr: LR.data || null, local: () => solveFractured(prob, SR.token != null ? solver.srOperator(pts, keyOf, null, roiAll) : SR, LR.apply, onIter) };
  const it = sol.it, err = sol.err, history = Array.from(sol.history), lo = sol.lo, hi = sol.hi, gotQ = sol.gotQ;
  report('finish', 0, { iterations: it }, true);
  for (let n = 0; n < nF; n++) eachRow(n, (P, r) => { setNum(P, 'doseClass', r, sol.cls[n]); setNum(P, 'writeDose', r, sol.write[n]); });
  const classes = ctxLib ? mergeClasses(Array.from(sol.classes), sol.cls) : Array.from(sol.classes);
  const kinds = {}, worst = {};
  // held: controls at the dose floor that still get too much, or at the cap that still get too little —
  // no dose of their own can reach the target (overlapping objects, stacked layer markers); the solve's
  // error cannot fall below theirs, so they are counted apart and the rest is reported on its own
  let held = 0, heldWorst = 0, heldAt = null, freeWorst = 0;
  for (let n = 0; n < nF; n++) {
    if (!FR.cnt[n]) continue;                                    // a region / zone run: the margin does not count
    const kind = FR.kind[n];
    kinds[kind] = (kinds[kind] || 0) + 1;
    const w = FR.want[n] * FR.base[n] * FR.k[n], r = gotQ[n] / w;
    const e = banded(n) ? (r < bLo ? bLo - r : r > bHi ? r - bHi : 0) / (r < bLo ? bLo : r > bHi ? bHi : 1) : Math.abs(r - 1);
    worst[kind] = Math.max(worst[kind] || 0, e);
    const d = sol.write[n], atFloor = d <= FR.base[n] * floor * 1.02, atCap = d >= FR.base[n] * o.maxFactor * 0.98;
    if (e > o.tol && ((atFloor && r > 1) || (atCap && r < 1))) { held++; if (e > heldWorst) { heldWorst = e; heldAt = [FR.cx[n], FR.cy[n]]; } }
    else freeWorst = Math.max(freeWorst, e);
  }
  let outlineRms = null, outlineWorst = null;
  if (contour) {
    let s2 = 0, n2 = 0, wmax = 0;
    for (let k = nF; k < pts.length; k++) { if (ptW[k] < 1 || !(ptWant[k] > 0) || !SM.cnt[k - nF]) continue; const e = gotQ[k] / ptWant[k] - 1; s2 += e * e; n2++; wmax = Math.max(wmax, Math.abs(e)); }
    outlineRms = n2 ? Math.sqrt(s2 / n2) : 0; outlineWorst = wmax; worst.outline = wmax;
  }
  report('finish', 1, {}, true);
  const writeOf = (n) => valAt(Ps[FR.cell[n]], 'writeDose', FR.r0[n]);   // after any class merge
  let capped = 0, nShapes = 0, regionFragments = 0;
  for (let n = 0; n < nF; n++) { if (writeOf(n) >= FR.base[n] * o.maxFactor * 0.999 / 1 && FR.k[n] === 1) capped++; nShapes += FR.r1[n] - FR.r0[n]; if (FR.cnt[n]) regionFragments++; }
  if (!partial) regionFragments = nF;
  const controls = [];
  for (let n = 0; n < nF; n++) if (FR.cnt[n]) controls.push({ x: FR.cx[n], y: FR.cy[n], kind: FR.kind[n], want: FR.want[n] * FR.base[n] * FR.k[n], got: gotQ[n], write: writeOf(n) * FR.k[n], base: FR.base[n] * FR.k[n] });
  for (const P of Ps) dropColumn(P, 'fi');
  // a region run: the context joins the writing data (doses already set), the design cells it uses too
  if (ctxLib) {
    joinContext();
    for (const [name, c] of Object.entries(ctxLib.cells)) if (name !== ctxLib.top && !W.cells[name]) W.cells[name] = c;
  }
  return {
    library: W, method: longOnly ? 'fractured-lr' : 'fractured', params: { ...o, quickIn: undefined, packed: undefined, beta, ctxDist },
    classes, stats: {
      fragments: nF, slivers: degenerate, shapes: nShapes, arrayClasses: nClasses, kinds,
      iterations: it, converged: err < o.tol, maxErr: err, held: { count: held, worst: heldWorst, at: heldAt, othersWorst: freeWorst }, maxErrQuant: Math.max(...Object.values(worst)), worst, history,
      doseRange: [lo, hi], capped, ms: Date.now() - t0, fit: contour ? 'contour' : 'control', samples: contour ? pts.length - nF : 0, outlineRms, outlineWorst,
      ...(recovered && recovered.stats.arrays ? { recovered: recovered.stats } : {}),
      ...(ctxLib ? { classMerge } : {}),
      ...(region ? { region: { ...region, halo, regionFragments, contextObjects: ctxObjects, quickMs: quick.ms } } : {}),
      ...(o.high ? { high: { layers: [...highL], zones: rects.length - (region ? 1 : 0), halo, fragments: regionFragments, contextObjects: ctxObjects, quickMs: quick.ms, quickFactor: quick.factor } } : {}),
    },
    controls,
  };
}

// The high-resolution parts of a writing library: everything but the context (shapes and the design
// cells the context refers to), with their design (.dose) and written doses — the fixed source of the
// feedback pass.
function solvedPart(W) {
  const T = W.cells[W.top];
  const refs = T.refs.filter((r) => !String(r.cell).includes('~ctx'));
  let top;
  if (isPackedCell(T)) { const keep = []; for (let i = 0; i < T.__shapes.n; i++) if (valAt(T.__shapes, 'frag', i) !== 'context') keep.push(i); const { __shapes, ...rest } = T; top = { ...rest, __shapes: subsetPacked(__shapes, keep), refs }; }
  else top = { ...T, shapes: T.shapes.filter((s) => s.frag !== 'context'), refs };
  const cells = { ...W.cells, [W.top]: top };
  return { ...W, cells };
}

// A high-resolution run with its feedback pass: solve, re-solve the base factors with the high parts
// fixed at their corrected doses, solve again. Progress: each pass half of the bar.
function* fractureStepsTop(project, options = {}, onProgress) {
  const o = { ...PEC_DEFAULTS, ...options };
  if (!o.high || o.feedback === false || o.range === 'quick') { const r = yield* fractureSteps(project, options, onProgress); if (r.stats.high) delete r.stats.high.quickFactor; return r; }
  const half = (off, pass) => (onProgress ? (p) => onProgress({ ...p, frac: off + 0.5 * (p.frac ?? 0), pass }) : null);
  const t0 = Date.now();
  const r1 = yield* fractureSteps(project, options, half(0, 1));
  const q2 = quickLongRange(project, { maxFactor: o.maxFactor, minFactor: o.minFactor, fixed: solvedPart(r1.library) });
  const r2 = yield* fractureSteps(project, { ...options, quickIn: q2 }, half(0.5, 2));
  // how far the pass moved: the base factors (covered cells of the grid) and the high parts' doses
  const f1 = r1.stats.high.quickFactor, f2 = q2.factor;
  let fs = 0; for (let k = 0; k < f1.length; k++) if (q2.covered[k]) fs = Math.max(fs, Math.abs(f2[k] / f1[k] - 1));
  const w = (r) => r.controls.map((c) => c.write);
  const a = w(r1), b = w(r2);
  let ds = 0; for (let k = 0; k < Math.min(a.length, b.length); k++) ds = Math.max(ds, Math.abs(b[k] / a[k] - 1));
  r2.stats.high.feedback = { factorShift: fs, doseShift: ds, passes: 2 };
  delete r1.stats.high.quickFactor; delete r2.stats.high.quickFactor;
  r2.stats.ms = Date.now() - t0;
  return r2;
}

// Everything in this thread (tests, scripts, a single worker).
export function fractureCorrect(project, options = {}, onProgress) {
  const g = fractureStepsTop(project, options, onProgress);
  let r = g.next();
  while (!r.done) r = g.next(r.value.local());
  return options.packed ? r.value : { ...r.value, library: unpackCells(r.value.library) };
}

// The same, with the heavy requests handed to run(request) — e.g. a pool of workers. run may return
// null to have a request done here instead.
export async function fractureCorrectAsync(project, options = {}, onProgress, run) {
  const g = fractureStepsTop(project, options, onProgress);
  let r = g.next();
  while (!r.done) {
    const req = r.value;
    const res = run ? await run(req) : null;
    r = g.next(res ?? req.local());
  }
  return options.packed ? r.value : { ...r.value, library: unpackCells(r.value.library) };
}
