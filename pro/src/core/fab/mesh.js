// Voxel volume → list of axis-aligned quads (the standalone's buildMesh, l.3425–3582, without
// the DOM). Interior faces are culled, vertical runs collapsed, identical faces merged along z
// and x, so a structure that is uniform in depth costs one cross-section's worth of quads.
// Quads are nudged along their outward normal so coplanar pairs never tie in the painter's sort.

import { M, MAT_COLOR } from './materials.js';

export const FACE_NX = [0, 0, -1, 1, 0, 0], FACE_NY = [-1, 1, 0, 0, 0, 0], FACE_NZ = [0, 0, 0, 0, -1, 1];
const SH_BY_TYPE = [1.0, 0.42, 0.70, 0.88, 0.82, 0.55];
const MAX_MERGE_CELLS = 8;

// state: {W, H, D, nmLat, nmVert, grid}; q: quality step (1 = every voxel); alphaOf(m): 0..1
// exag: vertical exaggeration of the model (1 = true proportions)
export function buildMesh(state, q = 1, alphaOf = () => 1, exag = 1) {
  const { W, H, D, grid } = state;
  const idx = (x, y) => y * W + x;
  const yS = (state.nmVert / state.nmLat) * exag;
  const nx = Math.ceil(W / q), nz = Math.ceil(D / q), maxRun = MAX_MERGE_CELLS * q;
  const X0 = [], X1 = [], XS = [], Z0 = [], Z1 = [], ZS = [];
  for (let i = 0; i < nx; i++) { X0.push(i * q); X1.push(Math.min(W, (i + 1) * q)); XS.push(Math.min(W - 1, i * q)); }
  for (let i = 0; i < nz; i++) { Z0.push(i * q); Z1.push(Math.min(D, (i + 1) * q)); ZS.push(Math.min(D - 1, i * q)); }
  const slices = ZS.map((z) => grid[z]);
  const seeThrough = (m) => m === M.AIR || alphaOf(m) < 1;
  const faces = [];

  let prevCol = new Map();
  for (let ci = 0; ci < nx; ci++) {
    const xa = X0[ci], xb = X1[ci], xs = XS[ci], xl = ci > 0 ? XS[ci - 1] : -1, xr = ci < nx - 1 ? XS[ci + 1] : -1;
    const colFaces = [];
    let prevSlice = new Map();
    for (let zi = 0; zi < nz; zi++) {
      const g = slices[zi], za = Z0[zi], zb = Z1[zi], curSlice = new Map();
      const face = (t, y0, y1, m, nb) => {
        const k = t + '|' + y0 + '|' + y1 + '|' + m + '|' + nb, pf = prevSlice.get(k);
        if (pf && zb - pf.z0 <= maxRun) { pf.z1 = zb; curSlice.set(k, pf); return; }
        const fo = { t, m, nb, x0: xa, x1: xb, y0, y1, z0: za, z1: zb };
        colFaces.push(fo); curSlice.set(k, fo);
      };
      let y = 0;
      while (y < H) {
        const m = g[idx(xs, y)];
        if (m === M.AIR) { y++; continue; }
        let yEnd = y + 1; while (yEnd < H && g[idx(xs, yEnd)] === m) yEnd++;
        const above = y > 0 ? g[idx(xs, y - 1)] : M.AIR;
        if (above !== m && seeThrough(above)) face(0, y, y, m, above);
        const below = yEnd < H ? g[idx(xs, yEnd)] : M.AIR;
        if (below === M.AIR) face(1, yEnd, yEnd, m, below);
        for (let side = 0; side < 2; side++) {
          const t = side === 0 ? 2 : 3, ns = side === 0 ? xl : xr;
          let yy = y;
          while (yy < yEnd) {
            const nb = ns < 0 ? M.AIR : g[idx(ns, yy)];
            let yy2 = yy + 1; while (yy2 < yEnd && (ns < 0 ? M.AIR : g[idx(ns, yy2)]) === nb) yy2++;
            if (nb !== m && seeThrough(nb)) face(t, yy, yy2, m, nb);
            yy = yy2;
          }
        }
        y = yEnd;
      }
      prevSlice = curSlice;
    }
    const nextCol = new Map();
    for (const fo of colFaces) {
      if (fo.t < 2) {
        const k = fo.t + '|' + fo.y0 + '|' + fo.m + '|' + fo.nb + '|' + fo.z0 + '|' + fo.z1, pf = prevCol.get(k);
        if (pf && pf.x1 === fo.x0 && fo.x1 - pf.x0 <= maxRun) { pf.x1 = fo.x1; nextCol.set(k, pf); continue; }
        nextCol.set(k, fo);
      }
      faces.push(fo);
    }
    prevCol = nextCol;
  }

  for (let zi = 0; zi <= nz; zi++) {
    const zAt = zi < nz ? Z0[zi] : D, gA = zi > 0 ? slices[zi - 1] : null, gB = zi < nz ? slices[zi] : null;
    let prevC = new Map();
    for (let ci = 0; ci < nx; ci++) {
      const xa = X0[ci], xb = X1[ci], xs = XS[ci], cur = new Map();
      let y = 0;
      while (y < H) {
        const a = gA ? gA[idx(xs, y)] : M.AIR, b = gB ? gB[idx(xs, y)] : M.AIR;
        if (a === b) { y++; continue; }
        let yEnd = y + 1;
        while (yEnd < H) { const a2 = gA ? gA[idx(xs, yEnd)] : M.AIR, b2 = gB ? gB[idx(xs, yEnd)] : M.AIR; if (a2 !== a || b2 !== b) break; yEnd++; }
        const yT = y, yB = yEnd;
        const add = (t, m, nb) => {
          if (!seeThrough(nb)) return;
          const k = t + '|' + yT + '|' + yB + '|' + m + '|' + nb, pf = prevC.get(k);
          if (pf && pf.x1 === xa && xb - pf.x0 <= maxRun) { pf.x1 = xb; cur.set(k, pf); return; }
          const fo = { t, m, nb, x0: xa, x1: xb, y0: yT, y1: yB, z0: zAt, z1: zAt };
          faces.push(fo); cur.set(k, fo);
        };
        if (b !== M.AIR) add(4, b, a);
        if (a !== M.AIR) add(5, a, b);
        y = yEnd;
      }
      prevC = cur;
    }
  }

  const EPS = 0.02, n = faces.length;
  const pos = new Float32Array(n * 12), col = new Float32Array(n * 4), mat = new Uint8Array(n), typ = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = faces[i], o = i * 12;
    mat[i] = f.m; typ[i] = f.t;
    let ax, bx, cx2, dx2, ay, by, cy2, dy2, az, bz, cz2, dz2;
    if (f.t < 2) { ax = f.x0; bx = f.x1; cx2 = f.x1; dx2 = f.x0; ay = by = cy2 = dy2 = f.y0; az = f.z0; bz = f.z0; cz2 = f.z1; dz2 = f.z1; }
    else if (f.t < 4) { const xf = f.t === 2 ? f.x0 : f.x1; ax = bx = cx2 = dx2 = xf; ay = f.y0; by = f.y1; cy2 = f.y1; dy2 = f.y0; az = f.z0; bz = f.z0; cz2 = f.z1; dz2 = f.z1; }
    else { ax = f.x0; bx = f.x1; cx2 = f.x1; dx2 = f.x0; ay = f.y0; by = f.y0; cy2 = f.y1; dy2 = f.y1; az = bz = cz2 = dz2 = f.z0; }
    const ex = FACE_NX[f.t] * EPS, ey = FACE_NY[f.t] * EPS, ez = FACE_NZ[f.t] * EPS;
    pos[o] = ax + ex; pos[o + 1] = ay * yS + ey; pos[o + 2] = az + ez;
    pos[o + 3] = bx + ex; pos[o + 4] = by * yS + ey; pos[o + 5] = bz + ez;
    pos[o + 6] = cx2 + ex; pos[o + 7] = cy2 * yS + ey; pos[o + 8] = cz2 + ez;
    pos[o + 9] = dx2 + ex; pos[o + 10] = dy2 * yS + ey; pos[o + 11] = dz2 + ez;
    const c = MAT_COLOR[f.m], sh = SH_BY_TYPE[f.t], co = i * 4;
    col[co] = c[0] * sh; col[co + 1] = c[1] * sh; col[co + 2] = c[2] * sh; col[co + 3] = alphaOf(f.m);
  }
  return { pos, col, mat, typ, n };
}
