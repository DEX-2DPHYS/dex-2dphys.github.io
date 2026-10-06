// Helper workers for the heavy part of the fractured correction: the targets (short-range dose of the
// design at many points) and the short-range operator rows. The exposure worker starts copies of itself
// (new Worker(self.location.href)); each gets a spatially contiguous block of the points, the library
// and the PSF, computes its block with the same engine and the same region (roi), and sends it back.
// Results are merged into the original point order, so the solve sees exactly what one thread computes.

import { bboxWorld } from '../core/geom/shapes.js';
import { packLibrary, isPackedCell, packedBBox, subsetPacked } from '../core/geom/pack.js';
import { toXY, pickPoints } from '../core/geom/points.js';
import { refBBox } from '../core/geom/library.js';
import { encodeWire } from '../core/wire.js';
import { rowsOf } from '../core/exposure/srrows.js';

const MIN_POINTS = 20000;                 // below this, starting helpers costs more than it saves
const MIN_JOBS = 400;                     // fracture jobs: below this, one thread is quicker

// The fracture jobs in spatial chunks, handed to the helpers as each one finishes its last (the work per
// object varies by orders of magnitude). A chunk carries the top objects that come near its jobs (the
// joint test looks only there), every array, and its jobs with their top indices renumbered. The results
// go back into job order, so the caller sees what one thread computes.
async function runFracture(req, size, send) {
  const N = req.jobs.length;
  const bbOf = (polys) => { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const p of polys) for (const [x, y] of p) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; } return { x1, y1, x2, y2 }; };
  const jb = req.jobs.map((j) => bbOf(j.polys));
  let X1 = Infinity, Y1 = Infinity, X2 = -Infinity, Y2 = -Infinity;
  for (const b of jb) { if (b.x1 < X1) X1 = b.x1; if (b.x2 > X2) X2 = b.x2; if (b.y1 < Y1) Y1 = b.y1; if (b.y2 > Y2) Y2 = b.y2; }
  const w = X2 - X1 || 1, h = Y2 - Y1 || 1, nb = Math.max(1, Math.round(Math.sqrt(size * 8)));
  const keys = new Int32Array(N);
  for (let k = 0; k < N; k++) { const b = jb[k], bx = Math.min(nb - 1, Math.floor((((b.x1 + b.x2) / 2 - X1) / w) * nb)), by = Math.min(nb - 1, Math.floor((((b.y1 + b.y2) / 2 - Y1) / h) * nb)); keys[k] = by * nb + (by & 1 ? nb - 1 - bx : bx); }
  const order = Array.from({ length: N }, (_, k) => k).sort((a, b) => keys[a] - keys[b] || a - b);
  const nC = Math.min(N, size * 6), chunks = [];
  for (let c = 0; c < nC; c++) { const a = Math.floor((N * c) / nC), b = Math.floor((N * (c + 1)) / nC); if (b > a) chunks.push(order.slice(a, b)); }
  const margin = 2 * (req.o.edgeW || 50) + 100;
  const tb = req.topObjs.map((ob) => ob.bb);
  const results = new Array(N);
  let done = 0, next = 0;
  const lane = async (i) => {
    while (next < chunks.length) {
      const idx = chunks[next++];
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const k of idx) { const b = jb[k]; if (b.x1 < x1) x1 = b.x1; if (b.x2 > x2) x2 = b.x2; if (b.y1 < y1) y1 = b.y1; if (b.y2 > y2) y2 = b.y2; }
      x1 -= margin; y1 -= margin; x2 += margin; y2 += margin;
      const local = new Map(), sub = [];
      for (let t = 0; t < tb.length; t++) { const b = tb[t]; if (b.x2 >= x1 && b.x1 <= x2 && b.y2 >= y1 && b.y1 <= y2) { local.set(t, sub.length); sub.push(req.topObjs[t]); } }
      const jobs = idx.map((k) => { const j = req.jobs[k]; return j.self.top != null ? { ...j, self: { top: local.get(j.self.top) ?? -1 } } : j; });
      let last = 0;
      const res = await send(i, { type: 'fracChunk', jobs, topObjs: sub, arrays: req.arrays, o: req.o, zones: req.zones, hS: req.hS, contour: req.contour }, (d) => { done += d - last; last = d; req.progress?.(done); });
      idx.forEach((k, q) => { results[k] = res[q]; });
      done += idx.length - last; req.progress?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, chunks.length) }, (_, i) => lane(i)));
  return results;
}

// A helper's library: the top cell's shapes and references whose box comes within reach of the helper's
// points (the short range ends there, so the others cannot contribute), and the cells those references
// reach. Packed and sent as ONE buffer (wire.js): a flat chip recovered into arrays has a writing cell per
// array segment, and sending all of them to every helper as separate typed arrays (ChipV11: over a
// million buffers per message) stalled the pool for many minutes before a helper started.
// refBB: the top references' boxes, computed once per request.
function shareOf(lib, bbs, refBB, pts, reach) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const xy = toXY(pts);
  for (let k = 0; k < xy.length; k += 2) { const x = xy[k], y = xy[k + 1]; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  const m = reach * 1.05 + 1; x1 -= m; y1 -= m; x2 += m; y2 += m;
  const top = lib.cells[lib.top], keep = [];
  for (let i = 0; i < bbs.length; i++) { const b = bbs[i]; if (b.x2 >= x1 && b.x1 <= x2 && b.y2 >= y1 && b.y1 <= y2) keep.push(i); }
  const refs = top.refs.filter((r, i) => { const b = refBB[i]; return b && b.x2 >= x1 && b.x1 <= x2 && b.y2 >= y1 && b.y1 <= y2; });
  // the cells those references reach (a context copy can refer on), in the library's own order
  const need = new Set(), stack = refs.map((r) => r.cell);
  while (stack.length) { const n = stack.pop(); if (need.has(n) || !lib.cells[n]) continue; need.add(n); for (const r of lib.cells[n].refs) stack.push(r.cell); }
  const cells = {};
  for (const [n, c] of Object.entries(lib.cells)) {
    if (n === lib.top) {
      if (isPackedCell(top)) { const { __shapes, ...rest } = top; cells[n] = { ...rest, refs, __shapes: subsetPacked(__shapes, keep) }; }
      else cells[n] = { ...top, refs, shapes: keep.map((i) => top.shapes[i]) };
    } else if (need.has(n)) cells[n] = c;
  }
  const wire = encodeWire(packLibrary({ ...lib, cells }).packed);
  return { libWire: wire, transfer: [wire] };
}

// opts.spawn(i) → {post(msg, transfer), onMessage(fn), onError(fn), terminate()}: how a helper is started
// (default: a copy of this Web Worker; the desktop backend passes worker threads). opts.size: helpers.
export function createSrPool(opts = {}) {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const size = opts.size || Math.max(1, Math.min(16, hc - 2));
  const spawn = opts.spawn || (() => {
    const w = new Worker(self.location.href);
    return { post: (m, t) => w.postMessage(m, t), onMessage: (fn) => { w.onmessage = (ev) => fn(ev.data); }, onError: (fn) => { w.onerror = (e) => fn(e.message || 'helper worker failed'); }, terminate: () => w.terminate() };
  });
  const workers = [];
  let nextId = 1;
  const pending = new Map();
  function worker(i) {
    if (!workers[i]) {
      const w = spawn(i);
      w.onMessage((m) => {
        const p = pending.get(m.id);
        if (!p) return;
        if (m.progress) { p.onProgress?.(m.progress.done); return; }
        pending.delete(m.id);
        m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
      });
      w.onError((msg) => { for (const p of pending.values()) p.reject(new Error(msg || 'helper worker failed')); pending.clear(); });
      workers[i] = w;
    }
    return workers[i];
  }
  function send(i, msg, onProgress, transfer = []) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker(i).post({ ...msg, id }, transfer);
    });
  }

  return {
    size,
    terminate() { for (const w of workers) w?.terminate(); workers.length = 0; },
    // request: { kind: 'targets' | 'sr', pts, roi, library, psf, progress? } → the same result local() gives
    async run(req) {
      if (req.kind === 'fracture') return size < 2 || req.jobs.length < MIN_JOBS ? null : runFracture(req, size, send);
      if (req.kind !== 'targets' && req.kind !== 'sr') return null;   // the solve stays in this worker
      const N = req.pts.length;
      if (size < 2 || N < MIN_POINTS) return null;
      // spatial order: strips of the region, so each helper's points sit together
      const w = req.roi.x2 - req.roi.x1 || 1, h = req.roi.y2 - req.roi.y1 || 1;
      const nb = Math.max(1, Math.round(Math.sqrt(size * 4)));
      const order = Array.from({ length: N }, (_, k) => k);
      const pxy = toXY(req.pts);
      const key = (k) => { const x = pxy[2 * k], y = pxy[2 * k + 1]; const bx = Math.min(nb - 1, Math.floor(((x - req.roi.x1) / w) * nb)); const by = Math.min(nb - 1, Math.floor(((y - req.roi.y1) / h) * nb)); return by * nb + (by & 1 ? nb - 1 - bx : bx); };
      const keys = new Int32Array(N); for (let k = 0; k < N; k++) keys[k] = key(k);
      order.sort((a, b) => keys[a] - keys[b] || a - b);
      const parts = [];
      for (let i = 0; i < size; i++) { const a = Math.floor((N * i) / size), b = Math.floor((N * (i + 1)) / size); if (b > a) parts.push(order.slice(a, b)); }
      const done = new Array(parts.length).fill(0);
      const tick = () => req.progress?.(done.reduce((s, x) => s + x, 0) / N);
      const tc = req.library.cells[req.library.top];
      const refBB = req.reach > 0 ? (() => { const c = new Map(); return tc.refs.map((r) => refBBox(req.library, r, c)); })() : null;
      const bbs = req.reach > 0 ? (isPackedCell(tc) ? Array.from({ length: tc.__shapes.n }, (_, i) => packedBBox(tc.__shapes, i, bboxWorld)) : tc.shapes.map(bboxWorld)) : null;
      const results = await Promise.all(parts.map((idx, i) => {
        const pts = pickPoints(req.pts, idx);
        const share = bbs ? shareOf(req.library, bbs, refBB, pts, req.reach) : { packed: req.library, transfer: [] };
        return send(i, { type: 'srChunk', kind: req.kind, pts, roi: req.roi, library: share.packed, libWire: share.libWire, psf: req.psf }, (d) => { done[i] = d; tick(); }, [...share.transfer, pts.xy.buffer]);
      }));
      if (req.kind === 'targets') {
        const out = new Float64Array(N);
        parts.forEach((idx, i) => { const v = results[i]; for (let j = 0; j < idx.length; j++) out[idx[j]] = v[j]; });
        return out;
      }
      // the rows stay in the buffers the helpers built them in (segmented form, srrows.js); only the
      // per-point index (segment, offset, length) is put back into the original point order
      const sp = new Int32Array(N), off = new Int32Array(N), len = new Int32Array(N), seg = [];
      let nnz = 0;
      parts.forEach((idx, i) => {
        const R = rowsOf(results[i]), base = seg.length;
        for (let s = 0; s < R.I.length; s++) seg.push({ idx: R.I[s], val: R.V[s] });
        for (let j = 0; j < idx.length; j++) { const k = idx[j]; sp[k] = base + (R.S ? R.S[j] : 0); off[k] = R.O[j]; len[k] = R.L[j]; nnz += R.L[j]; }
        results[i] = null;
      });
      return { seg, sp, off, len, nnz };
    },
  };
}
