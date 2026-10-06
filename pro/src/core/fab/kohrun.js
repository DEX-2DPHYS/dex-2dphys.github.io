// How a KOH step is computed (2026-10-06): which method, and results remembered.
//
//   'auto'      Wulff–Jaccodine (kohwj.js, exact facets, milliseconds) for a 2D cut and for a 3D sample
//               that is the same in every slice along z or along x (a line, a trench); the level set
//               (koh.js; the DSW core when there is one) for everything else
//   'levelset'  always the level set
//   'fast'      the level set on a coarser vertical cell (FAST_COARSE_NM): several times faster, edges
//               a few nm off — the page says so
//
// Results are remembered by a hash of everything the etch reads (the material codes, the voxel sizes,
// the time, the rate model, the wafer, the method), so undo, redo, editing another step and replaying
// a flow reuse a KOH result instead of etching again. A remembered result is the same voxels.

import { kohCompute } from './koh.js';
import { kohWulff2D } from './kohwj.js';

export const FAST_COARSE_NM = 10;
export const KOH_METHODS = { auto: 'Auto: exact facets (Wulff–Jaccodine) for cuts and lines, level set otherwise', levelset: 'Level set, standard', fast: 'Level set, fast (coarser; edges a few nm off)' };

// ---- the setup for a method: 'fast' only changes the level set's vertical cell
export function kohSetupFor(S, method) {
  return method === 'fast' ? { ...S, coarseNm: Math.max(S.coarseNm, FAST_COARSE_NM) } : S;
}

// ---- Wulff–Jaccodine on a 2D cut, or on a sample uniform along z or x (one slice etched, copied)
function sameSlices(S) {
  const { W, H, D, codes } = S, WH = W * H;
  if (D === 1) return 'cut';
  let z = true;
  for (let k = 1; k < D && z; k++) for (let r = 0; r < WH; r++) if (codes[k * WH + r] !== codes[r]) { z = false; break; }
  if (z) return 'z';
  let x = true;
  for (let k = 0; k < D && x; k++) for (let y = 0; y < H && x; y++) { const row = k * WH + y * W, c0 = codes[row]; for (let i = 1; i < W; i++) if (codes[row + i] !== c0) { x = false; break; } }
  return x ? 'x' : null;
}
export function kohWulffAny(S) {
  const kind = sameSlices(S);
  if (!kind) return null;
  const { W, H, D } = S, WH = W * H;
  if (kind === 'cut') { const r = kohWulff2D(S); return r && { ...r, how: 'wj', along: 'cut' }; }
  if (kind === 'z') {
    const r = kohWulff2D({ ...S, D: 1, codes: S.codes.subarray(0, WH) });
    if (!r) return null;
    const mask = new Uint8Array(WH * D);
    for (let k = 0; k < D; k++) mask.set(r.mask, k * WH);
    return { ...r, mask, how: 'wj', along: 'z' };
  }
  // uniform along x: the cut runs along z (the sample's depth axis), crystal-wise along basis.z
  const codes2 = new Uint8Array(D * H);
  for (let y = 0; y < H; y++) for (let k = 0; k < D; k++) codes2[y * D + k] = S.codes[k * WH + y * W];
  const b = S.basis, S2 = { ...S, W: D, D: 1, hx: S.hz, hz: S.hx, codes: codes2, basis: { ...b, x: b.z, z: b.x.map((v) => -v) } };
  const r = kohWulff2D(S2);
  if (!r) return null;
  const mask = new Uint8Array(WH * D);
  for (let y = 0; y < H; y++) for (let k = 0; k < D; k++) if (r.mask[y * D + k]) mask.fill(1, k * WH + y * W, k * WH + y * W + W);
  return { ...r, mask, how: 'wj', along: 'x' };
}

// ---- remembered results: a hash of what the etch reads → the etched voxels (as indices)
const cache = new Map();
const CACHE_MAX = 12, CACHE_BYTES = 256e6;
function fnv(h, u8) { for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return h >>> 0; }
export function kohKey(S, method) {
  const meta = JSON.stringify([S.W, S.H, S.D, S.hx, S.hy, S.hz, S.timeS, S.coarseNm, S.rates, S.model.concPct, S.model.tempC, S.basis.x, S.basis.z, S.basis.up, method]);
  const te = new TextEncoder().encode(meta);
  return `${fnv(fnv(2166136261, te), S.codes).toString(36)}:${fnv(0x9747b28c, S.codes).toString(36)}:${S.codes.length}`;
}
function bytesOf() { let b = 0; for (const e of cache.values()) b += e.idx.byteLength; return b; }
export function kohRemember(key, r) {
  let n = 0; for (let i = 0; i < r.mask.length; i++) n += r.mask[i];
  const idx = new Int32Array(n); n = 0;
  for (let i = 0; i < r.mask.length; i++) if (r.mask[i]) idx[n++] = i;
  cache.delete(key);
  cache.set(key, { idx, N: r.mask.length, steps: r.steps || 0, how: r.how, along: r.along, fronts: r.fronts || null, uses: 0 });
  while (cache.size > CACHE_MAX || (cache.size > 1 && bytesOf() > CACHE_BYTES)) cache.delete(cache.keys().next().value);
}
export function kohRecall(key) {
  const e = cache.get(key);
  if (!e) return null;
  cache.delete(key); cache.set(key, e);                 // most recently used
  const mask = new Uint8Array(e.N);
  for (let i = 0; i < e.idx.length; i++) mask[e.idx[i]] = 1;
  e.uses++;
  return { mask, steps: e.steps, how: e.how, along: e.along, fronts: e.fronts, reused: e.uses > 1 };
}
export function kohForget() { cache.clear(); }

// Before an etch: a remembered result, or Wulff–Jaccodine (milliseconds, remembered at once), or null
// — the level set is needed (the page then asks the DSW core, or the engine runs it).
export function kohPrepareResult(S, method) {
  const m = method || 'auto', S1 = kohSetupFor(S, m), key = kohKey(S1, m);
  const r = kohRecall(key);
  if (r) return { key, S: S1, result: r };
  if (m === 'auto') {
    const w = kohWulffAny(S1);
    if (w) { kohRemember(key, w); return { key, S: S1, result: kohRecall(key) }; }
  }
  return { key, S: S1, result: null };
}

// The whole step, in the page: remembered → Wulff–Jaccodine → the level set (or the mask the DSW core
// sent, ctxMask, when the level set was needed). → {mask, steps, how, along, fronts, reused}
export function kohResult(S, method, ctxMask = null, ctxSteps = 0) {
  const P = kohPrepareResult(S, method);
  if (P.result) return P.result;
  let r;
  if (ctxMask && ctxMask.length === S.W * S.H * S.D) r = { mask: ctxMask, steps: ctxSteps, how: method === 'fast' ? 'fast-native' : 'native' };
  else { const c = kohCompute(P.S); r = { mask: c.mask, steps: c.steps, how: method === 'fast' ? 'fast' : 'levelset' }; }
  kohRemember(P.key, r);
  cache.get(P.key).uses = 1;                            // this use; the next recall is a reuse
  return { ...r, reused: false };
}
