// Anisotropic wet etching of single-crystal silicon (KOH) on the Fab Studio voxel grid.
//
// The surface moves along its normal at a rate R(n) that depends on the crystal orientation of
// that normal (crystal.js: Sato's rate diagram, {111} about 150× slower than {100}). As a level
// set: φ > 0 is the etchant, φ < 0 the solid, and φ_t = F(x, n)|∇φ| with n = ∇φ/|∇φ|. With a
// rate diagram like silicon's the Hamiltonian is not convex, and that is exactly what produces
// the shapes seen in practice: a concave region of the cavity is bounded by the slowest planes
// ({111} pits and V-grooves, the bounding box of a misaligned opening), while a convex corner of
// the remaining silicon is attacked by the fastest planes (mask-corner undercut). Level sets for
// etching: Adalsteinsson & Sethian, J. Comput. Phys. 122 (1995) 348.
//
// Scheme: local Lax–Friedrichs (Osher & Shu 1991), monotone and so convergent to the viscosity
// solution for a non-convex Hamiltonian, with the rate taken at the central-difference normal and
// the dissipation bounded per axis by R|n_i| + |∇_s R|·sqrt(1 − n_i²). Godunov's flux was tried
// and rejected: it takes the maximum rate over the interval of one-sided gradients, and with the
// {111} cusp any cell-to-cell noise in the normal (a staircase, a re-initialisation) then makes a
// {111} wall retreat at a sixth of the (100) rate. The cusp is softened within 8° of {111}
// (crystal.js), which is what lets the scheme hold a {111} facet: a 300 nm slot self-limits as a
// V within two voxels of the exact 212 nm and stays there.
//
// φ is re-initialised to a signed distance by fast marching (fmm.js) whenever the front has moved
// half the band (two of the largest voxel), keeping the zero level where it is.
//
// Materials: silicon follows R(n). Poly-Si is etched isotropically at the (100) rate, SiO₂ at its
// own small rate, Al quickly; Si₃N₄, Au, Cr, the 2D materials and (with a warning) resists are
// masks. A mask face and the sample edge are no-flux boundaries (φ is mirrored into them), so the
// silicon under a mask edge is undercut along its own crystal planes.

import { fastMarchSeeded } from './fmm.js';
import { kohRateModel, waferBasis } from './crystal.js';

const INERT = 3, ISO = 2, XTAL = 1, ETCHANT = 0;

// Signed distance (|φ| ≤ B) from the interface between pos = 1 and pos = 0 cells; a cell next to
// the interface keeps the sub-voxel position its own φ carries when keep(i) says it has one.
// wk: buffers kept between calls on one grid (workspace(N)); the arithmetic and the order of every
// operation are those of the first version, so φ is the same to the bit (the native core runs the
// same, gate gd6) — only the whole-grid allocations and rescans are gone (2026-10-06).
const workspace = (N) => ({ Tp: new Float32Array(N).fill(Infinity), Tn: new Float32Array(N).fill(Infinity), st: new Uint8Array(N), sP: new Int32Array(1024), sN: new Int32Array(1024), touched: [] });
function signedDistance(g, pos, phi, keep, B, wk = workspace(g.W * g.H * g.D)) {
  const { W, H, D, hx, hy, hz } = g, WH = W * H, N = WH * D;
  const { Tp, Tn } = wk;
  let nP = 0, nN = 0;
  for (let i = 0; i < N; i++) {
    const p = pos[i];
    const z = (i / WH) | 0, r = i - z * WH, y = (r / W) | 0, x = r - y * W;
    // most cells have no neighbour on the other side: nothing to do
    if (!((x > 0 && pos[i - 1] !== p) || (x < W - 1 && pos[i + 1] !== p) || (y > 0 && pos[i - W] !== p) || (y < H - 1 && pos[i + W] !== p)
      || (D > 1 && ((z > 0 && pos[i - WH] !== p) || (z < D - 1 && pos[i + WH] !== p))))) continue;
    let inv = 0;
    const look = (k, h) => {
      if (pos[k] === p) return;
      let d;
      if (keep(i) && keep(k)) d = (h * Math.abs(phi[i])) / (Math.abs(phi[i]) + Math.abs(phi[k]) || 1);
      else if (keep(i)) d = Math.min(h, Math.abs(phi[i]));
      else if (keep(k)) d = Math.max(0, h - Math.min(h, Math.abs(phi[k])));
      else d = h / 2;
      d = Math.max(d, 1e-3 * h);
      inv += 1 / (d * d);
    };
    if (x > 0) look(i - 1, hx);
    if (x < W - 1) look(i + 1, hx);
    if (y > 0) look(i - W, hy);
    if (y < H - 1) look(i + W, hy);
    if (D > 1 && z > 0) look(i - WH, hz);
    if (D > 1 && z < D - 1) look(i + WH, hz);
    if (p) { Tp[i] = 1 / Math.sqrt(inv); if (nP === wk.sP.length) { const a = new Int32Array(2 * nP); a.set(wk.sP); wk.sP = a; } wk.sP[nP++] = i; }
    else { Tn[i] = 1 / Math.sqrt(inv); if (nN === wk.sN.length) { const a = new Int32Array(2 * nN); a.set(wk.sN); wk.sN = a; } wk.sN[nN++] = i; }
  }
  const tP = [], tN = [];
  fastMarchSeeded(g, pos, 1, Tp, B, wk.sP, nP, wk.st, tP);
  fastMarchSeeded(g, pos, 0, Tn, B, wk.sN, nN, wk.st, tN);
  for (let i = 0; i < N; i++) phi[i] = pos[i] ? Math.min(B, Tp[i]) : -Math.min(B, Tn[i]);
  for (let k = 0; k < tP.length; k++) Tp[tP[k]] = Infinity;
  for (let k = 0; k < tN.length; k++) Tn[tN[k]] = Infinity;
}

// The level set does not need the fine vertical voxels of a Fab sample (often 2 nm under 10–20 nm
// lateral ones): the band height in cells and the number of time steps both go as 1/h_y, so the
// cost goes as 1/h_y². It runs on a grid whose vertical cell is f fine voxels (≈ 4 nm, never more
// than the lateral voxel). The starting surface is taken from the fine voxels (φ sampled from their
// signed distance), and the result is mapped back by interpolating φ at every fine voxel, so the
// boundary stays at the fine resolution. A coarse cell holding any mask voxel is a mask: a lip of
// at most one coarse cell of silicon can be left right under a mask edge.
export const KOH_COARSE_NM = 4;

// Material codes of the fine voxels, the single thing the level set reads about materials (the
// page decides them, so the native core needs no material table): 0 etchant, 1 single-crystal Si,
// 2 poly-Si, 3 SiO2, 4 Al, 5 mask.
export const KC = { ETCHANT: 0, SI: 1, POLY: 2, OX: 3, AL: 4, MASK: 5 };

// s: engine state; opts: {conc, tempC, timeS, oxRateNmMin, wafer, azimuth, AIR, isAir, isSi,
// isPoly, isOx, isAl, isResist, coarseNm}. Everything the level set needs, nothing it does not.
export function kohSetup(s, opts) {
  const W = s.W, HF = s.H, D = s.D, WHF = W * HF, NF = WHF * D;
  const model = kohRateModel(opts.conc, opts.tempC);
  const R100 = model.nmPerS['100'];
  const ox = (opts.oxRateNmMin != null && opts.oxRateNmMin !== '' ? +opts.oxRateNmMin : (R100 * 60) / 182) / 60;   // nm/s
  const timeS = Math.max(0, +opts.timeS || 0);
  const basis = waferBasis(opts.wafer, opts.azimuth || 0);
  const codes = new Uint8Array(NF);
  let resist = 0;
  for (let z = 0; z < D; z++) {
    const g = s.grid[z];
    for (let r = 0; r < WHF; r++) {
      const i = z * WHF + r, m = g[r];
      if (opts.isAir(m)) codes[i] = KC.ETCHANT;
      else if (opts.isSi(m)) codes[i] = KC.SI;
      else if (opts.isPoly(m)) codes[i] = KC.POLY;
      else if (opts.isOx(m)) codes[i] = KC.OX;
      else if (opts.isAl(m)) codes[i] = KC.AL;
      else { codes[i] = KC.MASK; if (opts.isResist && opts.isResist(m)) resist++; }
    }
  }
  const warnings = [];
  if (resist) warnings.push('Resist is not a dependable KOH mask (hot KOH attacks or lifts most resists); here it is kept as a mask. A Si₃N₄ or SiO₂ hard mask is what is used in practice.');
  return {
    W, H: HF, D, hx: s.nmLat, hy: s.nmVert, hz: s.nmLat, codes, model, basis, timeS,
    rates: { poly: R100, ox, al: 100 },
    coarseNm: opts.coarseNm != null ? +opts.coarseNm : KOH_COARSE_NM,
    out: { removed: 0, depth100: R100 * timeS, rates: model.nmPerS, steps: 0, warnings, basis, oxNmMin: ox * 60 },
  };
}

// The level set on a setup: returns {mask (1 = etched), steps}. The native core runs the same
// algorithm, operation for operation, on the same inputs (see the DSW plugin's koh.cpp).
export function kohCompute(S) {
  const { W, D, hx, hz, codes, model, basis, timeS } = S, HF = S.H, hyF = S.hy, WHF = W * HF, NF = WHF * D;
  const bx = basis.x, bz = basis.z, bu = basis.up;
  const clsF = new Uint8Array(NF), isoF = new Float32Array(NF);
  for (let i = 0; i < NF; i++) {
    const c = codes[i];
    if (c === KC.ETCHANT) clsF[i] = ETCHANT;
    else if (c === KC.SI) clsF[i] = XTAL;
    else if (c === KC.POLY) { clsF[i] = ISO; isoF[i] = S.rates.poly; }
    else if (c === KC.OX) { clsF[i] = S.rates.ox > 0 ? ISO : INERT; isoF[i] = S.rates.ox; }
    else if (c === KC.AL) { clsF[i] = ISO; isoF[i] = S.rates.al; }
    else clsF[i] = INERT;
  }
  const mask = new Uint8Array(NF);
  if (!(timeS > 0)) return { mask, steps: 0 };
  const coarseNm = S.coarseNm;

  // the evolution grid: f fine rows per cell
  const f = Math.max(1, Math.min(Math.floor(hx / hyF), Math.round(coarseNm / hyF)));
  const H = Math.ceil(HF / f), WH = W * H, N = WH * D, hy = hyF * f;
  const hMax = Math.max(hx, hy, D > 1 ? hz : 0), B = 2 * hMax;
  // starting surface from the fine voxels
  const phiF = new Float32Array(NF), posF = new Uint8Array(NF);
  for (let i = 0; i < NF; i++) posF[i] = clsF[i] === ETCHANT ? 1 : 0;
  signedDistance({ W, H: HF, D, hx, hy: hyF, hz }, posF, phiF, () => false, B + hy);
  // coarse cells: a mask if any voxel is one, else silicon if any, else isotropic (its fastest),
  // else etchant; φ sampled at the cell centre
  const cls = new Uint8Array(N), iso = new Float32Array(N), phi = new Float32Array(N);
  for (let z = 0; z < D; z++) for (let yc = 0; yc < H; yc++) for (let x = 0; x < W; x++) {
    const i = z * WH + yc * W + x;
    let inert = false, xtal = false, isoR = -1, any = false;
    for (let q = 0; q < f; q++) {
      const y = yc * f + q;
      if (y >= HF) break;
      const k = z * WHF + y * W + x, c = clsF[k];
      if (c === INERT) inert = true; else if (c === XTAL) xtal = true; else if (c === ISO) isoR = Math.max(isoR, isoF[k]);
      if (c !== ETCHANT) any = true;
    }
    cls[i] = inert ? INERT : xtal ? XTAL : isoR >= 0 ? ISO : any ? INERT : ETCHANT;
    iso[i] = isoR;
    const yMid = yc * f + (f - 1) / 2, y0 = Math.min(HF - 1, Math.floor(yMid)), y1 = Math.min(HF - 1, y0 + 1), t = yMid - Math.floor(yMid);
    phi[i] = phiF[z * WHF + y0 * W + x] * (1 - t) + phiF[z * WHF + y1 * W + x] * t;
  }
  const etchable = (i) => cls[i] === XTAL || cls[i] === ISO;
  const grid = { W, H, D, hx, hy, hz };
  // a coarse cell's φ must agree in sign with its class: etchant positive, a mask negative
  for (let i = 0; i < N; i++) { if (cls[i] === ETCHANT && phi[i] <= 0) phi[i] = 0.25 * hyF; if (cls[i] === INERT && phi[i] >= 0) phi[i] = -0.25 * hyF; }
  const pos = new Uint8Array(N), wk = workspace(N);
  function reinit() {
    for (let i = 0; i < N; i++) pos[i] = cls[i] === ETCHANT || (etchable(i) && phi[i] > 0) ? 1 : 0;
    signedDistance(grid, pos, phi, etchable, B, wk);
  }
  reinit();

  // the cells that move (etchable, within the band), each with its six neighbours; −1 marks a mask
  // face or the sample edge, where φ is mirrored
  let active = null, nb = null;
  const buildActive = () => {
    let n = 0;
    for (let i = 0; i < N; i++) if (etchable(i) && Math.abs(phi[i]) < B) n++;
    active = new Int32Array(n); nb = new Int32Array(6 * n);
    n = 0;
    for (let i = 0; i < N; i++) {
      if (!(etchable(i) && Math.abs(phi[i]) < B)) continue;
      const z = (i / WH) | 0, r = i - z * WH, y = (r / W) | 0, x = r - y * W, o = 6 * n;
      const ok = (k, inside) => (inside && cls[k] !== INERT ? k : -1);
      nb[o] = ok(i - 1, x > 0); nb[o + 1] = ok(i + 1, x < W - 1); nb[o + 2] = ok(i - W, y > 0); nb[o + 3] = ok(i + W, y < H - 1);
      nb[o + 4] = D > 1 ? ok(i - WH, z > 0) : -1; nb[o + 5] = D > 1 ? ok(i + WH, z < D - 1) : -1;
      active[n++] = i;
    }
  };
  buildActive();

  const rhs = new Float32Array(N), R = model.R, Sl = model.S, CFL = 0.8;
  let t = 0, steps = 0, moved = 0;
  while (t < timeS - 1e-9 && steps < 400000) {
    let maxRate = 0, maxF = 0;
    for (let a = 0; a < active.length; a++) {
      const i = active[a], p0 = phi[i], o = 6 * a;
      let k;
      const xm = (k = nb[o]) >= 0 ? phi[k] : p0, xp = (k = nb[o + 1]) >= 0 ? phi[k] : p0;
      const ym = (k = nb[o + 2]) >= 0 ? phi[k] : p0, yp = (k = nb[o + 3]) >= 0 ? phi[k] : p0;
      const zm = (k = nb[o + 4]) >= 0 ? phi[k] : p0, zp = (k = nb[o + 5]) >= 0 ? phi[k] : p0;
      const pxm = (p0 - xm) / hx, pxp = (xp - p0) / hx, pym = (p0 - ym) / hy, pyp = (yp - p0) / hy, pzm = (p0 - zm) / hz, pzp = (zp - p0) / hz;
      const gx = (pxm + pxp) / 2, gy = (pym + pyp) / 2, gz = (pzm + pzp) / 2;
      const gn = Math.sqrt(gx * gx + gy * gy + gz * gz);
      let F, ax, ay, az;
      if (cls[i] === ISO) { F = iso[i]; ax = ay = az = F; }
      else {
        // crystal-frame normal (sample y points down, into the wafer)
        let nx, ny, nz, ux = 0, uy = 1, uz = 0;
        if (gn > 1e-9) {
          ux = gx / gn; uy = gy / gn; uz = gz / gn;
          nx = ux * bx[0] - uy * bu[0] + uz * bz[0]; ny = ux * bx[1] - uy * bu[1] + uz * bz[1]; nz = ux * bx[2] - uy * bu[2] + uz * bz[2];
        } else { nx = bu[0]; ny = bu[1]; nz = bu[2]; }
        F = R(nx, ny, nz);
        const S = Sl(nx, ny, nz);
        ux = Math.abs(ux); uy = Math.abs(uy); uz = Math.abs(uz);
        ax = F * ux + S * Math.sqrt(Math.max(0, 1 - ux * ux)) + 0.05 * F;
        ay = F * uy + S * Math.sqrt(Math.max(0, 1 - uy * uy)) + 0.05 * F;
        az = F * uz + S * Math.sqrt(Math.max(0, 1 - uz * uz)) + 0.05 * F;
      }
      let rr = F * gn + (ax * (pxp - pxm) + ay * (pyp - pym)) / 2, sum = ax / hx + ay / hy;
      if (D > 1) { rr += (az * (pzp - pzm)) / 2; sum += az / hz; }
      rhs[a] = rr;
      if (sum > maxRate) maxRate = sum;
      if (F > maxF) maxF = F;
    }
    if (!(maxRate > 0)) break;
    const dt = Math.min(CFL / maxRate, timeS - t);
    for (let a = 0; a < active.length; a++) { const i = active[a]; phi[i] = Math.min(B, phi[i] + dt * rhs[a]); }
    t += dt; steps++; moved += dt * maxF;
    if (moved > B / 2) { reinit(); buildActive(); moved = 0; }
  }
  // back to the fine voxels: φ interpolated between coarse cell centres
  for (let z = 0; z < D; z++) {
    for (let y = 0; y < HF; y++) {
      const yc = (y + 0.5) / f - 0.5, c0 = Math.max(0, Math.min(H - 1, Math.floor(yc))), c1 = Math.min(H - 1, c0 + 1), tt = Math.max(0, Math.min(1, yc - c0));
      for (let x = 0; x < W; x++) {
        const k = z * WHF + y * W + x;
        if (!(clsF[k] === XTAL || clsF[k] === ISO)) continue;
        const ia = z * WH + c0 * W + x, ib = z * WH + c1 * W + x;
        // a mask cell's φ never moved; interpolate only across cells that evolve
        const pa = phi[ia], pb = cls[ib] === INERT ? pa : phi[ib], pa2 = cls[ia] === INERT ? pb : pa;
        if (pa2 * (1 - tt) + pb * tt > 0) mask[k] = 1;
      }
    }
  }
  return { mask, steps };
}

// Etched voxels become etchant. Returns the count.
export function kohApply(s, mask, AIR) {
  const WH = s.W * s.H;
  let removed = 0;
  for (let z = 0; z < s.D; z++) { const g = s.grid[z]; for (let r = 0; r < WH; r++) if (mask[z * WH + r]) { g[r] = AIR; removed++; } }
  return removed;
}

export function kohEtch(s, opts) {
  const S = kohSetup(s, opts);
  if (!(S.timeS > 0)) return S.out;
  const r = kohCompute(S);
  S.out.removed = kohApply(s, r.mask, opts.AIR);
  S.out.steps = r.steps;
  return S.out;
}

// The request the DSW core takes ('kohEtch'): typed arrays as base64 so a 2-million-voxel grid is
// not 2 million JSON numbers. The rate and slope tables travel with it, so both sides read the
// same model.
const b64 = (u8) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const bytes = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
export function kohPayload(S) {
  return {
    W: S.W, H: S.H, D: S.D, hx: S.hx, hy: S.hy, hz: S.hz, timeS: S.timeS, coarseNm: S.coarseNm,
    rates: S.rates, bx: S.basis.x, bz: S.basis.z, bu: S.basis.up,
    lutN: S.model.N, lut: b64(bytes(S.model.lut)), slut: b64(bytes(S.model.slut)), codes: b64(S.codes),
  };
}
// The same request for the Pro core (desktop/core.mjs, binary wire messages): tables and codes as raw
// typed arrays, no base64.
export function kohPayloadRaw(S) {
  return {
    W: S.W, H: S.H, D: S.D, hx: S.hx, hy: S.hy, hz: S.hz, timeS: S.timeS, coarseNm: S.coarseNm,
    rates: S.rates, bx: S.basis.x, bz: S.basis.z, bu: S.basis.up,
    lutN: S.model.N, lut: S.model.lut, slut: S.model.slut, codes: S.codes,
  };
}
