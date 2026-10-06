// Fast marching on the Fab Studio voxel grid (anisotropic voxels hx × hy × hz nm), and the
// truly isotropic etch built on it.
//
// An isotropic etch (BHF on SiO₂, O₂ plasma on resist) attacks every exposed face at the same
// rate, and a point of the target is reached at the time t = L/r, where L is the length of the
// shortest path to it THROUGH THE TARGET from the surface the etchant first touched (Huygens).
// So the etched region after a depth d is {T ≤ d}, with T the geodesic distance: the solution of
// the eikonal equation |∇T| = 1 inside the target, T = 0 on the wetted surface. A pinhole in a
// mask gives a hemisphere, a slit a half-cylinder, the undercut equals the depth, and a buried
// obstacle is etched around, not through. Fast marching solves the eikonal equation in one
// ordered sweep (Sethian 1996), here with the second-order upwind stencil wherever two accepted
// neighbours line up, which keeps a spherical front round on a 10:1 anisotropic grid.

// Min-heap of (key, index) with lazy deletion: a cell may be pushed several times and stale
// entries are skipped when popped.
export function makeHeap(cap = 1 << 16) {
  let k = new Float64Array(cap), v = new Int32Array(cap), n = 0;
  const grow = () => { const k2 = new Float64Array(k.length * 2), v2 = new Int32Array(v.length * 2); k2.set(k); v2.set(v); k = k2; v = v2; };
  return {
    get size() { return n; },
    push(key, idx) {
      if (n === k.length) grow();
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = idx;
    },
    pop(out) {           // out = [key, idx]
      out[0] = k[0]; out[1] = v[0];
      const lk = k[--n], lv = v[n];
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    },
  };
}

const CV = new Float64Array(3), CC = new Float64Array(3);

// T at cell j from its accepted neighbours (pass = 1 only). Along each axis the smaller upwind
// neighbour is used, second order when the next cell on that side is accepted and not larger
// (FMM2). The quadratic Σ c_q (T − v_q)² = 1 is solved adding axes in increasing v, dropping an
// axis whose value would exceed the solution (it is then not upwind).
function solveCell(j, x, y, z, g, T, st, pass) {
  const { W, H, D, WH } = g;
  let m = 0;
  const ok = (i) => st[i] === 2 && pass[i] === 1;
  const axis = (iM, iP, okM, okP, iMM, iPP, okMM, okPP, h) => {
    let t1 = Infinity, t2 = Infinity;
    if (okM && ok(iM)) { t1 = T[iM]; if (okMM && ok(iMM) && T[iMM] <= t1) t2 = T[iMM]; }
    if (okP && ok(iP) && T[iP] < t1) { t1 = T[iP]; t2 = okPP && ok(iPP) && T[iPP] <= t1 ? T[iPP] : Infinity; }
    if (t1 === Infinity) return;
    if (t2 !== Infinity) { CV[m] = (4 * t1 - t2) / 3; CC[m] = 9 / (4 * h * h); }
    else { CV[m] = t1; CC[m] = 1 / (h * h); }
    m++;
  };
  axis(j - 1, j + 1, x > 0, x < W - 1, j - 2, j + 2, x > 1, x < W - 2, g.hx);
  axis(j - W, j + W, y > 0, y < H - 1, j - 2 * W, j + 2 * W, y > 1, y < H - 2, g.hy);
  if (D > 1) axis(j - WH, j + WH, z > 0, z < D - 1, j - 2 * WH, j + 2 * WH, z > 1, z < D - 2, g.hz);
  if (!m) return Infinity;
  for (let a = 1; a < m; a++) for (let b = a; b > 0 && CV[b] < CV[b - 1]; b--) { let t = CV[b]; CV[b] = CV[b - 1]; CV[b - 1] = t; t = CC[b]; CC[b] = CC[b - 1]; CC[b - 1] = t; }
  let A = 0, B = 0, C = 0, sol = Infinity;
  for (let q = 0; q < m; q++) {
    A += CC[q]; B += CC[q] * CV[q]; C += CC[q] * CV[q] * CV[q];
    const disc = B * B - A * (C - 1);
    if (disc < 0) break;
    sol = (B + Math.sqrt(disc)) / A;
    if (!(q + 1 < m && sol > CV[q + 1])) break;      // the next axis is not upwind: done
  }
  return sol;
}

// Fast marching. grid = {W, H, D, hx, hy, hz}; pass: Uint8Array (1 = the front may cross,
// 2 = a free region, a sealed void, that floods at once when the front reaches it, 0 = blocked);
// T: Float32Array, finite at the seed cells (their exact distance to the source surface),
// Infinity elsewhere. Cells farther than tmax stay Infinity. Returns T.
export function fastMarch(grid, pass, T, tmax = Infinity) {
  const W = grid.W, H = grid.H, D = grid.D, WH = W * H, N = WH * D;
  const g = { W, H, D, WH, hx: grid.hx, hy: grid.hy, hz: grid.hz };
  const st = new Uint8Array(N);              // 0 far, 1 trial, 2 accepted
  const heap = makeHeap(), out = [0, 0];
  for (let i = 0; i < N; i++) if (T[i] < Infinity && pass[i] === 1) { st[i] = 1; heap.push(T[i], i); }
  const flood = [], nb = new Int32Array(6), nn = new Int32Array(6);
  const hOf = (d) => (d === 1 ? g.hx : d === W ? g.hy : g.hz);
  const offer = (j, t) => { t = Math.fround(t); if (st[j] !== 2 && t < T[j]) { T[j] = t; st[j] = 1; heap.push(t, j); } };   // the key must equal the stored float32, or the stale test drops the cell
  const neighbours = (c, arr) => {
    const z = (c / WH) | 0, r = c - z * WH, y = (r / W) | 0, x = r - y * W;
    arr[0] = x > 0 ? -1 : 0; arr[1] = x < W - 1 ? 1 : 0; arr[2] = y > 0 ? -W : 0; arr[3] = y < H - 1 ? W : 0;
    arr[4] = D > 1 && z > 0 ? -WH : 0; arr[5] = D > 1 && z < D - 1 ? WH : 0;
  };
  while (heap.size) {
    heap.pop(out);
    const t = out[0], i = out[1];
    if (st[i] === 2 || t > T[i]) continue;   // stale
    if (t > tmax) break;
    st[i] = 2;
    neighbours(i, nb);
    for (let q = 0; q < 6; q++) {
      const d = nb[q];
      if (!d) continue;
      const j = i + d;
      if (st[j] === 2) continue;
      if (pass[j] === 2) {
        // the front opens a sealed void: it fills with etchant at once, from the face it was reached at
        const tFace = t + hOf(Math.abs(d)) / 2;
        flood.length = 0; flood.push(j); st[j] = 2; T[j] = tFace;
        for (let f = 0; f < flood.length; f++) {
          const c = flood[f];
          neighbours(c, nn);
          for (let e = 0; e < 6; e++) {
            if (!nn[e]) continue;
            const k = c + nn[e];
            if (pass[k] === 2 && st[k] !== 2) { st[k] = 2; T[k] = tFace; flood.push(k); }
            else if (pass[k] === 1) offer(k, tFace + hOf(Math.abs(nn[e])) / 2);
          }
        }
        continue;
      }
      if (pass[j] !== 1) continue;
      const jz = (j / WH) | 0, jr = j - jz * WH, jy = (jr / W) | 0, jx = jr - jy * W;
      offer(j, solveCell(j, jx, jy, jz, g, T, st, pass));
    }
  }
  return T;
}

// The same march for the KOH level set's re-initialisation (koh.js), without its whole-grid work: the
// cells that may be crossed are those with side[i] === want (no voids), the seeds come as a list in
// increasing index — the order fastMarch's scan would push them in, so the heap, and the result, are
// the same — and st (all 0 on entry, all 0 again on return) and the heap are reused. touched: every
// cell whose T was set (seeds included), for the caller to reset.
const SEEDED_HEAP = makeHeap();
function solveSeeded(j, x, y, z, g, T, st, side, want) {
  const { W, H, D, WH } = g;
  let m = 0;
  const ok = (i) => st[i] === 2 && side[i] === want;
  const axis = (iM, iP, okM, okP, iMM, iPP, okMM, okPP, h) => {
    let t1 = Infinity, t2 = Infinity;
    if (okM && ok(iM)) { t1 = T[iM]; if (okMM && ok(iMM) && T[iMM] <= t1) t2 = T[iMM]; }
    if (okP && ok(iP) && T[iP] < t1) { t1 = T[iP]; t2 = okPP && ok(iPP) && T[iPP] <= t1 ? T[iPP] : Infinity; }
    if (t1 === Infinity) return;
    if (t2 !== Infinity) { CV[m] = (4 * t1 - t2) / 3; CC[m] = 9 / (4 * h * h); }
    else { CV[m] = t1; CC[m] = 1 / (h * h); }
    m++;
  };
  axis(j - 1, j + 1, x > 0, x < W - 1, j - 2, j + 2, x > 1, x < W - 2, g.hx);
  axis(j - W, j + W, y > 0, y < H - 1, j - 2 * W, j + 2 * W, y > 1, y < H - 2, g.hy);
  if (D > 1) axis(j - WH, j + WH, z > 0, z < D - 1, j - 2 * WH, j + 2 * WH, z > 1, z < D - 2, g.hz);
  if (!m) return Infinity;
  for (let a = 1; a < m; a++) for (let b = a; b > 0 && CV[b] < CV[b - 1]; b--) { let t = CV[b]; CV[b] = CV[b - 1]; CV[b - 1] = t; t = CC[b]; CC[b] = CC[b - 1]; CC[b - 1] = t; }
  let A = 0, B = 0, C = 0, sol = Infinity;
  for (let q = 0; q < m; q++) {
    A += CC[q]; B += CC[q] * CV[q]; C += CC[q] * CV[q] * CV[q];
    const disc = B * B - A * (C - 1);
    if (disc < 0) break;
    sol = (B + Math.sqrt(disc)) / A;
    if (!(q + 1 < m && sol > CV[q + 1])) break;
  }
  return sol;
}
export function fastMarchSeeded(grid, side, want, T, tmax, seeds, nSeeds, st, touched) {
  const W = grid.W, H = grid.H, D = grid.D, WH = W * H;
  const g = { W, H, D, WH, hx: grid.hx, hy: grid.hy, hz: grid.hz };
  const heap = SEEDED_HEAP, out = [0, 0];
  for (let s = 0; s < nSeeds; s++) { const i = seeds[s]; st[i] = 1; heap.push(T[i], i); touched.push(i); }
  while (heap.size) {
    heap.pop(out);
    const t = out[0], i = out[1];
    if (st[i] === 2 || t > T[i]) continue;
    if (t > tmax) break;
    st[i] = 2;
    const z = (i / WH) | 0, r = i - z * WH, y = (r / W) | 0, x = r - y * W;
    for (let q = 0; q < 6; q++) {
      const d = q === 0 ? (x > 0 ? -1 : 0) : q === 1 ? (x < W - 1 ? 1 : 0) : q === 2 ? (y > 0 ? -W : 0) : q === 3 ? (y < H - 1 ? W : 0) : q === 4 ? (D > 1 && z > 0 ? -WH : 0) : (D > 1 && z < D - 1 ? WH : 0);
      if (!d) continue;
      const j = i + d;
      if (st[j] === 2 || side[j] !== want) continue;
      const jz = (j / WH) | 0, jr = j - jz * WH, jy = (jr / W) | 0, jx = jr - jy * W;
      const tj = Math.fround(solveSeeded(j, jx, jy, jz, g, T, st, side, want));
      if (st[j] !== 2 && tj < T[j]) { if (T[j] === Infinity) touched.push(j); T[j] = tj; st[j] = 1; heap.push(tj, j); }
    }
  }
  // the heap may still hold entries (the march stopped at tmax): empty it for the next call
  while (heap.size) heap.pop(out);
  for (let k = 0; k < touched.length; k++) st[touched[k]] = 0;
}

// Air connected to the head-room (row y = 0) through air, face to face, in any slice: the
// etchant. Air it does not reach is a sealed void. Returns Uint8Array (1 = ambient air).
export function ambientAir(s, isAir) {
  const { W, H, D } = s, WH = W * H, N = WH * D;
  const amb = new Uint8Array(N), q = new Int32Array(N);
  let n = 0;
  for (let z = 0; z < D; z++) { const g = s.grid[z]; for (let x = 0; x < W; x++) if (isAir(g[x])) { const i = z * WH + x; amb[i] = 1; q[n++] = i; } }
  for (let h = 0; h < n; h++) {
    const c = q[h], z = (c / WH) | 0, r = c - z * WH, y = (r / W) | 0, x = r - y * W;
    const g = s.grid[z];
    if (x > 0 && !amb[c - 1] && isAir(g[r - 1])) { amb[c - 1] = 1; q[n++] = c - 1; }
    if (x < W - 1 && !amb[c + 1] && isAir(g[r + 1])) { amb[c + 1] = 1; q[n++] = c + 1; }
    if (y > 0 && !amb[c - W] && isAir(g[r - W])) { amb[c - W] = 1; q[n++] = c - W; }
    if (y < H - 1 && !amb[c + W] && isAir(g[r + W])) { amb[c + W] = 1; q[n++] = c + W; }
    if (D > 1 && z > 0 && !amb[c - WH] && isAir(s.grid[z - 1][r])) { amb[c - WH] = 1; q[n++] = c - WH; }
    if (D > 1 && z < D - 1 && !amb[c + WH] && isAir(s.grid[z + 1][r])) { amb[c + WH] = 1; q[n++] = c + WH; }
  }
  return amb;
}

// Isotropic etch of the cells matching matchFn by depthNm, measured as geodesic distance through
// the target from every face the etchant touches. Sealed voids fill when the front opens them.
// Returns {removed}.
export function isotropicEtch(s, matchFn, depthNm, AIR = 0) {
  if (!(depthNm > 0)) return { removed: 0 };
  const { W, H, D } = s, WH = W * H, N = WH * D;
  const hx = s.nmLat, hy = s.nmVert, hz = s.nmLat;
  const amb = ambientAir(s, (m) => m === AIR);
  const pass = new Uint8Array(N), T = new Float32Array(N).fill(Infinity);
  for (let z = 0; z < D; z++) {
    const g = s.grid[z];
    for (let r = 0; r < WH; r++) { const i = z * WH + r, m = g[r]; pass[i] = matchFn(m) ? 1 : m === AIR && !amb[i] ? 2 : 0; }
  }
  // seeds: target cells with a face on the ambient etchant, half a voxel from that face
  let any = false;
  for (let i = 0; i < N; i++) {
    if (pass[i] !== 1) continue;
    const z = (i / WH) | 0, r = i - z * WH, y = (r / W) | 0, x = r - y * W;
    let t = Infinity;
    if ((x > 0 && amb[i - 1]) || (x < W - 1 && amb[i + 1])) t = hx / 2;
    if ((y > 0 && amb[i - W]) || (y < H - 1 && amb[i + W])) t = Math.min(t, hy / 2);
    if (D > 1 && ((z > 0 && amb[i - WH]) || (z < D - 1 && amb[i + WH]))) t = Math.min(t, hz / 2);
    if (t < Infinity) { T[i] = t; any = true; }
  }
  if (!any) return { removed: 0 };
  fastMarch({ W, H, D, hx, hy, hz }, pass, T, depthNm);
  let removed = 0;
  for (let z = 0; z < D; z++) {
    const g = s.grid[z];
    for (let r = 0; r < WH; r++) { const i = z * WH + r; if (pass[i] === 1 && T[i] <= depthNm + 1e-6) { g[r] = AIR; removed++; } }
  }
  return { removed };
}
