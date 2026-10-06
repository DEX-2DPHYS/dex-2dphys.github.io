// KOH by arrival time — TRIED AND REJECTED as the fast option (2026-10-06). Not wired into Fab Studio;
// kept for the KOH methods prototype page, which shows why. With silicon's 150 : 1 rate contrast and
// the {111} cusp, T jumps steeply across the slow walls, and the Lax–Friedrichs dissipation the scheme
// needs then lets a V-groove tip run on at nearly the (100) rate: a 300 nm slot gives a 402 nm "V"
// instead of 212 nm (668 nm when over-etched 2×), with 50 nm of spurious undercut along <110>; with
// the textbook global σ it does not converge at all. It is also slower than the level set in 2D
// (2.4 s vs 0.16 s). The 2D answer is kohwj.js (Wulff–Jaccodine); see DESIGN.md §11, 2026-10-06 evening.
//
// The level set (koh.js) moves the surface in thousands of small steps. With rates that depend only
// on the crystal orientation and the material (not on time), and a front that only ever moves into
// the solid, the same problem can be solved once for the time T(x) at which the front reaches each
// voxel: the static Hamilton–Jacobi equation F(x, n)·|∇T| = 1, n = ∇T/|∇T| (Osher 1993: the level
// set and the arrival time give the same front). The etched voxels for an etch of t seconds are then
// T ≤ t, for every t at once.
//
// Scheme: Lax–Friedrichs fast sweeping (Kao, Osher & Qian, J. Comput. Phys. 196 (2004) 367), which
// converges to the viscosity solution for a non-convex Hamiltonian such as silicon's — Godunov or
// fast marching would need a convex one. Gauss–Seidel sweeps in the 2^dim axis orders, each update
//   T = [1 − H(p) + Σ σ_a (T_a+ + T_a−) / (2 h_a)] / Σ σ_a / h_a,   p = central differences,
// kept only when it lowers T. σ_a bounds |∂H/∂p_a| as in the level set: F|n_a| + |∇_s F|·√(1 − n_a²).
// The Lax–Friedrichs dissipation rounds sharp corners by about a voxel — the "minor imperfections"
// the page warns about — and the {111} cusp is the softened one of crystal.js, as in the level set.
//
// Same inputs as the level set (kohSetup), same material classes, same boundaries: a mask face and
// the sample edge mirror T (no flux). The front starts half a voxel from the etchant cell centres.

import { KC } from './koh.js';

const INERT = 3, ISO = 2, XTAL = 1, ETCHANT = 0;
const BIG = 1e12;

// S: kohSetup(...). opts: {tol (s), maxIter, coarseNm}. → {mask, T, iterations, ms, grid}
export function kohArrival(S, opts = {}) {
  const t0 = Date.now();
  const { W, D, hx, hz, codes, model, basis, timeS } = S, HF = S.H, hyF = S.hy, WHF = W * HF, NF = WHF * D;
  const mask = new Uint8Array(NF);
  if (!(timeS > 0)) return { mask, T: null, iterations: 0, ms: 0 };
  // the vertical cell, as in the level set: f fine rows (≈ coarseNm, never more than the lateral voxel)
  const coarseNm = opts.coarseNm != null ? +opts.coarseNm : (S.coarseNm ?? 4);
  const f = Math.max(1, Math.min(Math.floor(hx / hyF), Math.round(coarseNm / hyF)));
  const H = Math.ceil(HF / f), WH = W * H, N = WH * D, hy = hyF * f;
  const cls = new Uint8Array(N), iso = new Float32Array(N);
  for (let z = 0; z < D; z++) for (let yc = 0; yc < H; yc++) for (let x = 0; x < W; x++) {
    let inert = false, xtal = false, isoR = -1, any = false;
    for (let q = 0; q < f; q++) {
      const y = yc * f + q;
      if (y >= HF) break;
      const c = codes[z * WHF + y * W + x];
      if (c === KC.ETCHANT) continue;
      any = true;
      if (c === KC.SI) xtal = true;
      else if (c === KC.POLY) isoR = Math.max(isoR, S.rates.poly);
      else if (c === KC.OX) { if (S.rates.ox > 0) isoR = Math.max(isoR, S.rates.ox); else inert = true; }
      else if (c === KC.AL) isoR = Math.max(isoR, S.rates.al);
      else inert = true;
    }
    const i = z * WH + yc * W + x;
    cls[i] = inert ? INERT : xtal ? XTAL : isoR >= 0 ? ISO : any ? INERT : ETCHANT;
    iso[i] = isoR;
  }
  const R = model.R, Sl = model.S, bx = basis.x, bz = basis.z, bu = basis.up;
  const rateAt = (i, ux, uy, uz) => {
    if (cls[i] === ISO) return iso[i];
    const nx = ux * bx[0] - uy * bu[0] + uz * bz[0], ny = ux * bx[1] - uy * bu[1] + uz * bz[1], nz = ux * bx[2] - uy * bu[2] + uz * bz[2];
    return R(nx, ny, nz);
  };
  const slopeAt = (i, ux, uy, uz) => {
    if (cls[i] === ISO) return 0;
    const nx = ux * bx[0] - uy * bu[0] + uz * bz[0], ny = ux * bx[1] - uy * bu[1] + uz * bz[1], nz = ux * bx[2] - uy * bu[2] + uz * bz[2];
    return Sl(nx, ny, nz);
  };

  // T: etchant cells next to the solid start at minus the time to cover their half voxel (the front
  // lies on the cell faces); everything that can etch starts unreached
  const T = new Float64Array(N).fill(BIG);
  const fixed = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (cls[i] !== ETCHANT) continue;
    fixed[i] = 1;
    const z = (i / WH) | 0, r = i - z * WH, y = (r / W) | 0, x = r - y * W;
    // the solid neighbours: distance to the interface and the direction it faces
    let inv = 0, gx = 0, gy = 0, gz = 0, any = -1;
    const look = (k, h, dx, dy, dz) => { if (cls[k] === XTAL || cls[k] === ISO) { inv += 4 / (h * h); gx += dx / h; gy += dy / h; gz += dz / h; any = k; } };
    if (x > 0) look(i - 1, hx, -1, 0, 0);
    if (x < W - 1) look(i + 1, hx, 1, 0, 0);
    if (y > 0) look(i - W, hy, 0, -1, 0);
    if (y < H - 1) look(i + W, hy, 0, 1, 0);
    if (D > 1 && z > 0) look(i - WH, hz, 0, 0, -1);
    if (D > 1 && z < D - 1) look(i + WH, hz, 0, 0, 1);
    if (any < 0) { T[i] = 0; continue; }
    const d = 1 / Math.sqrt(inv), g = Math.hypot(gx, gy, gz) || 1;
    T[i] = -d / Math.max(1e-6, rateAt(any, gx / g, gy / g, gz / g));
  }
  for (let i = 0; i < N; i++) if (cls[i] === INERT) fixed[i] = 1;

  const ihx = 1 / hx, ihy = 1 / hy, ihz = 1 / hz, three = D > 1;
  // opts.globalSigma: one σ for every cell and axis (rMax + sMax), the textbook Lax–Friedrichs choice
  const gSig = opts.globalSigma ? model.rMax + model.sMax : 0;
  const tol = opts.tol != null ? opts.tol : 1e-4 * timeS, maxIter = opts.maxIter || 300;
  // one Lax–Friedrichs update of cell i; returns the decrease
  const update = (i, x, y, z) => {
    const t = T[i];
    // neighbours: a mask or the sample edge mirrors (the value of this cell)
    let k;
    const xm = x > 0 && cls[k = i - 1] !== INERT ? T[k] : t, xp = x < W - 1 && cls[k = i + 1] !== INERT ? T[k] : t;
    const ym = y > 0 && cls[k = i - W] !== INERT ? T[k] : t, yp = y < H - 1 && cls[k = i + W] !== INERT ? T[k] : t;
    let zm = t, zp = t;
    if (three) { zm = z > 0 && cls[k = i - WH] !== INERT ? T[k] : t; zp = z < D - 1 && cls[k = i + WH] !== INERT ? T[k] : t; }
    // nothing reached around it yet
    if (xm >= BIG && xp >= BIG && ym >= BIG && yp >= BIG && zm >= BIG && zp >= BIG) return 0;
    const px = (xp - xm) * 0.5 * ihx, py = (yp - ym) * 0.5 * ihy, pz = three ? (zp - zm) * 0.5 * ihz : 0;
    const gn = Math.sqrt(px * px + py * py + pz * pz);
    let ux = 0, uy = 1, uz = 0;
    if (gn > 0) { ux = px / gn; uy = py / gn; uz = pz / gn; }
    const F = rateAt(i, ux, uy, uz), Sg = slopeAt(i, ux, uy, uz);
    const ax = gSig > 0 ? gSig : F * Math.abs(ux) + Sg * Math.sqrt(Math.max(0, 1 - ux * ux)) + 0.05 * F;
    const ay = gSig > 0 ? gSig : F * Math.abs(uy) + Sg * Math.sqrt(Math.max(0, 1 - uy * uy)) + 0.05 * F;
    let den = ax * ihx + ay * ihy, num = 1 - F * gn + ax * (xp + xm) * 0.5 * ihx + ay * (yp + ym) * 0.5 * ihy;
    if (three) { const az = gSig > 0 ? gSig : F * Math.abs(uz) + Sg * Math.sqrt(Math.max(0, 1 - uz * uz)) + 0.05 * F; den += az * ihz; num += az * (zp + zm) * 0.5 * ihz; }
    const tn = num / den;
    if (tn < t) { T[i] = tn; return t - tn; }
    return 0;
  };
  let it = 0, change = Infinity;
  const orders = three ? 8 : 4;
  while (it < maxIter && change > tol) {
    change = 0;
    for (let o = 0; o < orders; o++) {
      const sx = o & 1, sy = (o >> 1) & 1, sz = (o >> 2) & 1;
      for (let zz = 0; zz < D; zz++) {
        const z = sz ? D - 1 - zz : zz;
        for (let yy = 0; yy < H; yy++) {
          const y = sy ? H - 1 - yy : yy;
          for (let xx = 0; xx < W; xx++) {
            const x = sx ? W - 1 - xx : xx, i = z * WH + y * W + x;
            if (fixed[i]) continue;
            const d = update(i, x, y, z);
            if (d > change && T[i] < BIG / 2) change = d;
          }
        }
      }
    }
    it++;
  }
  // back to the fine voxels: T interpolated between the cell centres in y
  for (let z = 0; z < D; z++) for (let y = 0; y < HF; y++) {
    const yc = (y + 0.5) / f - 0.5, c0 = Math.max(0, Math.min(H - 1, Math.floor(yc))), c1 = Math.min(H - 1, c0 + 1), tt = Math.max(0, Math.min(1, yc - c0));
    for (let x = 0; x < W; x++) {
      const k = z * WHF + y * W + x, c = codes[k];
      if (!(c === KC.SI || c === KC.POLY || c === KC.AL || (c === KC.OX && S.rates.ox > 0))) continue;
      const ia = z * WH + c0 * W + x, ib = z * WH + c1 * W + x;
      const ta = cls[ia] === INERT ? T[ib] : T[ia], tb = cls[ib] === INERT ? ta : T[ib];
      if (ta * (1 - tt) + tb * tt <= timeS) mask[k] = 1;
    }
  }
  return { mask, T, iterations: it, ms: Date.now() - t0, grid: { W, H, D, hx, hy, hz, f } };
}
