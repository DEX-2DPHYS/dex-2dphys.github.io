// Chemistry mode: explicit bonds between any main-group atoms, with valence rules, on the Universal Force Field
// (UFF: A. K. Rappe, C. J. Casewit, K. S. Colwell, W. A. Goddard, W. M. Skiff, J. Am. Chem. Soc. 114, 10024 (1992)).
//
// * Every bond is in a list (the topology). The attach / bond / delete tools edit it; the valence of each element limits
//   how many bonds an atom can carry (H 1, O 2, N 3, C 4 ...). The hybridisation follows from the number of bonds:
//   a graphene carbon with 3 bonds is sp2 (C_R, planar), with a 4th atom attached it becomes sp3 (C_3, tetrahedral),
//   so the pucker and the strain around an adsorbate come out of the force field, not from a rule.
// * Bonds are Morse (dissociation energy 70 kcal/mol per bond order, UFF's own suggestion) multiplied by a smooth switch
//   between 1.25 and 1.6 rest lengths; a bond stretched past 1.6 rest lengths is removed. Angle, torsion and inversion
//   terms are multiplied by the switches of their bonds, so energy and forces stay continuous while a bond breaks.
// * Angles: UFF Fourier form (linear centres: K(1 + cos)). Torsions: UFF (sp3-sp3 n = 3, sp2-sp2 n = 2 with the bond-order
//   factor, sp2-sp3 n = 6, 1 kcal/mol). Inversion at sp2 centres: (K/6)(n.u)^2 per neighbour (UFF K = 6 kcal/mol, shared over
//   the three choices; harmonic in the out-of-plane angle). Van der Waals: UFF Lennard-Jones, 1-2 and 1-3 pairs excluded,
//   shifted-force cutoff 8 A. No charges.
// * One deliberate change: in a 2D sheet the aromatic C_R-C_R bond rest length is 1.42 A (graphene) instead of UFF's
//   benzene-like 1.38 A.
import { SPECIES } from './materials.js';

const KCAL = 0.0433641153;                              // kcal/mol -> eV
// UFF atom types: [r_bond (A), theta0 (deg), x_vdW (A), D_vdW (kcal/mol), Z_eff, chi_GMP]
const T = {
  H_: [0.354, 180, 2.886, 0.044, 0.712, 4.528],
  B_3: [0.838, 109.47, 4.083, 0.180, 1.755, 5.110], B_2: [0.828, 120, 4.083, 0.180, 1.755, 5.110],
  C_3: [0.757, 109.47, 3.851, 0.105, 1.912, 5.343], C_R: [0.729, 120, 3.851, 0.105, 1.912, 5.343], C_2: [0.732, 120, 3.851, 0.105, 1.912, 5.343], C_1: [0.706, 180, 3.851, 0.105, 1.912, 5.343],
  N_3: [0.700, 106.7, 3.660, 0.069, 2.544, 6.899], N_R: [0.699, 120, 3.660, 0.069, 2.544, 6.899], N_2: [0.685, 111.2, 3.660, 0.069, 2.544, 6.899], N_1: [0.656, 180, 3.660, 0.069, 2.544, 6.899],
  O_3: [0.658, 104.51, 3.500, 0.060, 2.300, 8.741], O_2: [0.634, 120, 3.500, 0.060, 2.300, 8.741], O_1: [0.639, 180, 3.500, 0.060, 2.300, 8.741],
  F_: [0.668, 180, 3.364, 0.050, 1.735, 10.874],
  Si3: [1.117, 109.47, 4.295, 0.402, 2.323, 4.168],
  P_3: [1.101, 93.8, 4.147, 0.305, 2.863, 5.463],
  S_3: [1.064, 92.1, 4.035, 0.274, 2.703, 6.928], S_2: [0.854, 120, 4.035, 0.274, 2.703, 6.928],
  Cl: [1.044, 180, 3.947, 0.227, 2.348, 8.564], Br: [1.192, 180, 4.189, 0.251, 2.519, 7.790], I_: [1.382, 180, 4.500, 0.339, 2.650, 6.822],
};
// torsion barriers: sp3 V (kcal/mol) and sp2 U, per element
const TV = { C: 2.119, N: 0.450, O: 0.018, Si: 1.225, P: 2.400, S: 0.484 }, TU = { B: 1.25, C: 2.0, N: 2.0, O: 2.0, Si: 1.25, P: 1.25, S: 1.25 };
export const VALENCE = { H: 1, B: 3, C: 4, N: 3, O: 2, F: 1, Si: 4, P: 3, S: 2, Cl: 1, Br: 1, I: 1 };
export const CHEM_ELEMENTS = ['H', 'B', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Br', 'I'];
const HYB = (t) => t === 'H_' || t === 'F_' || t === 'Cl' || t === 'Br' || t === 'I_' ? 0 : /_1$/.test(t) ? 1 : /_[R2]$/.test(t) ? 2 : 3;
const SW_LO = 1.25, SW_HI = 1.6;                        // bond switch (in rest lengths): 1 below LO, 0 at HI, removed above HI
const RC = 8.0, SKIN = 1.0;

export function typeFor(sym, deg, nSp2C = 0) {
  switch (sym) {
    case 'H': return 'H_'; case 'F': return 'F_'; case 'Cl': return 'Cl'; case 'Br': return 'Br'; case 'I': return 'I_';
    case 'B': return deg >= 4 ? 'B_3' : 'B_2';
    case 'C': return deg >= 4 ? 'C_3' : deg === 3 ? (nSp2C >= 2 ? 'C_R' : 'C_2') : deg === 2 ? 'C_2' : 'C_2';
    case 'N': return deg === 3 ? (nSp2C >= 1 ? 'N_R' : 'N_3') : deg === 2 ? 'N_2' : deg === 1 ? 'N_1' : 'N_3';
    case 'O': return deg >= 2 ? 'O_3' : 'O_2';
    case 'Si': return 'Si3'; case 'P': return 'P_3'; case 'S': return deg <= 1 ? 'S_2' : 'S_3';
    default: return 'C_3';
  }
}
// rest length of a bond of order n between UFF types a and b (bond-order and electronegativity corrections)
export function bondR0(a, b, n = 1) {
  const A = T[a], B = T[b], ri = A[0], rj = B[0], ci = A[5], cj = B[5];
  const rbo = -0.1332 * (ri + rj) * Math.log(n), ren = ri * rj * (Math.sqrt(ci) - Math.sqrt(cj)) ** 2 / (ci * ri + cj * rj);
  return ri + rj + rbo - ren;
}
const sw = (t) => t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t), dsw = (t) => t <= 0 || t >= 1 ? 0 : -6 * t * (1 - t);

export class Chem {
  constructor(mat) {
    this.m = mat; const n = mat.maxN;
    this.deg = new Int32Array(n); this.type = new Array(n).fill('C_3');
    this.bonds = [];            // [i, j]; derived per bond: order, r0, D, alpha
    this.version = 0; this.dirty = true;
    this.pi = new Int32Array(1 << 15); this.pj = new Int32Array(1 << 15); this.np = 0;   // non-bonded pair list
  }
  sym(i) { return SPECIES[this.m.sp[i]].sym; }
  valence(i) { return VALENCE[this.sym(i)] ?? 4; }
  free(i) { return this.valence(i) - this.deg[i]; }
  bonded(i, j) { for (const [a, b] of this.bonds) if ((a === i && b === j) || (a === j && b === i)) return true; return false; }
  neighbours(i) { const r = []; for (const [a, b] of this.bonds) { if (a === i) r.push(b); else if (b === i) r.push(a); } return r; }
  clear() { this.bonds = []; this.dirty = true; }

  // bonds from the current geometry: pairs closer than 1.25 x the sum of covalent radii, within the valence limits
  fromGeometry() {
    const m = this.m, N = m.N, cand = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = m.mi(m.x[j] - m.x[i], m.Lx, m.per[0]), dy = m.mi(m.y[j] - m.y[i], m.Ly, m.per[1]), dz = m.mi(m.z[j] - m.z[i], m.Lz, m.per[2]);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), lim = 1.25 * (T[typeFor(this.sym(i), 1)][0] + T[typeFor(this.sym(j), 1)][0]) + 0.1;
      if (d < lim) cand.push([d, i, j]);
    }
    cand.sort((p, q) => p[0] - q[0]); this.bonds = []; this.deg.fill(0);
    for (const [, i, j] of cand) if (this.deg[i] < this.valence(i) && this.deg[j] < this.valence(j)) { this.bonds.push([i, j]); this.deg[i]++; this.deg[j]++; }
    this.dirty = true;
  }
  addBond(i, j) {
    if (i === j || this.bonded(i, j)) return 'already bonded';
    if (this.free(i) < 1) return `${this.sym(i)} already has ${this.deg[i]} bond${this.deg[i] === 1 ? '' : 's'} (valence ${this.valence(i)})`;
    if (this.free(j) < 1) return `${this.sym(j)} already has ${this.deg[j]} bond${this.deg[j] === 1 ? '' : 's'} (valence ${this.valence(j)})`;
    this.bonds.push([i, j]); this.dirty = true; this.retype(); return null;
  }
  // Mat.removeAtom moved the last atom (index `last`) into slot i
  removeAtom(i, last) {
    this.bonds = this.bonds.filter(([a, b]) => a !== i && b !== i).map(([a, b]) => [a === last ? i : a, b === last ? i : b]);
    this.dirty = true; this.retype();
  }

  retype() {
    const m = this.m, N = m.N; this.deg.fill(0, 0, Math.max(N, 1));
    for (const [a, b] of this.bonds) { this.deg[a]++; this.deg[b]++; }
    const nb = Array.from({ length: N }, () => []); for (const [a, b] of this.bonds) { nb[a].push(b); nb[b].push(a); }
    this.nb = nb;
    for (let i = 0; i < N; i++) { let c = 0; for (const j of nb[i]) if (this.sym(j) === 'C' && this.deg[j] <= 3 && this.deg[j] >= 2) c++; this.type[i] = typeFor(this.sym(i), this.deg[i], c); }
    // bond orders: aromatic 1.5 inside an sp2 carbon/nitrogen network, then double bonds where both ends have valence left
    const fr = new Int32Array(N); for (let i = 0; i < N; i++) fr[i] = this.valence(i) - this.deg[i];
    const arom = (t) => t === 'C_R' || t === 'N_R';
    this.order = this.bonds.map(([a, b]) => arom(this.type[a]) && arom(this.type[b]) ? 1.5 : 1);
    this.bonds.forEach(([a, b], k) => { if (this.order[k] === 1 && fr[a] > 0 && fr[b] > 0 && HYB(this.type[a]) <= 2 && HYB(this.type[b]) <= 2) { this.order[k] = 2; fr[a]--; fr[b]--; } });
    // per-bond constants
    const B = this.bonds.length; this.bp = new Float64Array(B * 4);      // r0, D, alpha, (spare)
    this.bonds.forEach(([a, b], k) => {
      const ta = this.type[a], tb = this.type[b], n = this.order[k];
      let r0 = bondR0(ta, tb, n); if (m.sheet && ta === 'C_R' && tb === 'C_R') r0 = 1.42;
      const kb = 664.12 * T[ta][4] * T[tb][4] / (r0 * r0 * r0) * KCAL, D = 70 * n * KCAL;
      this.bp[4 * k] = r0; this.bp[4 * k + 1] = D; this.bp[4 * k + 2] = Math.sqrt(kb / (2 * D));
    });
    // bond index lookup for the multi-body terms
    const bkey = new Map(); this.bonds.forEach(([a, b], k) => { bkey.set(a * 65536 + b, k); bkey.set(b * 65536 + a, k); });
    const bid = (a, b) => bkey.get(a * 65536 + b);
    // angles [i, j(centre), k, b1, b2, K, C0, C1, C2, linear]
    const ang = [];
    for (let j = 0; j < N; j++) {
      const L = nb[j]; if (L.length < 2) continue;
      const tj = this.type[j], th0 = T[tj][1] * Math.PI / 180, c0 = Math.cos(th0), lin = T[tj][1] >= 179;
      for (let p = 0; p < L.length; p++) for (let q = p + 1; q < L.length; q++) {
        const i = L[p], k = L[q], b1 = bid(i, j), b2 = bid(j, k), rij = this.bp[4 * b1], rjk = this.bp[4 * b2];
        const rik2 = rij * rij + rjk * rjk - 2 * rij * rjk * c0, rik = Math.sqrt(rik2);
        let K = 664.12 * T[this.type[i]][4] * T[this.type[k]][4] / Math.pow(rik, 5) * (3 * rij * rjk * (1 - c0 * c0) - rik2 * c0) * KCAL;
        if (lin) K = Math.max(K, 0);
        const s2 = Math.max(1 - c0 * c0, 1e-6), C2 = 1 / (4 * s2), C1 = -4 * C2 * c0, C0 = C2 * (2 * c0 * c0 + 1);
        ang.push([i, j, k, b1, b2, K, C0, C1, C2, lin ? 1 : 0]);
      }
    }
    this.ang = ang;
    // torsions about bond j-k: [i, j, k, l, b1, b2, b3, V/ntors (eV), n, cos(n phi0)]
    const tor = [];
    this.bonds.forEach(([j, k], bk) => {
      const hj = HYB(this.type[j]), hk = HYB(this.type[k]); if (hj < 2 || hk < 2) return;          // linear / terminal centres: none
      if (nb[j].length < 2 || nb[k].length < 2) return;
      let V, n, cn;
      const ej = this.sym(j), ek = this.sym(k);
      if (hj === 3 && hk === 3) { V = Math.sqrt((TV[ej] ?? 1) * (TV[ek] ?? 1)); n = 3; cn = -1; }
      else if (hj === 2 && hk === 2) { V = 5 * Math.sqrt((TU[ej] ?? 1.25) * (TU[ek] ?? 1.25)) * (1 + 4.18 * Math.log(this.order[bk])); n = 2; cn = 1; }
      else { V = 1.0; n = 6; cn = 1; }
      const nt = (nb[j].length - 1) * (nb[k].length - 1); if (!nt || V <= 0) return;
      for (const i of nb[j]) if (i !== k) for (const l of nb[k]) if (l !== j && l !== i) tor.push([i, j, k, l, bid(i, j), bk, bid(k, l), 0.5 * V * KCAL / nt, n, cn]);
    });
    this.tor = tor;
    // inversion at 3-coordinated sp2 centres: [centre, a, b, c, ba, bb, bc, A]
    const inv = [];
    for (let i = 0; i < N; i++) {
      const t = this.type[i]; if (nb[i].length !== 3 || !(t === 'C_R' || t === 'C_2' || t === 'N_R' || t === 'B_2')) continue;
      const [a, b, c] = nb[i]; inv.push([i, a, b, c, bid(i, a), bid(i, b), bid(i, c), 6 * KCAL / 6]);
    }
    this.inv = inv;
    // non-bonded exclusions: 1-2 and 1-3
    this.excl = new Set();
    for (let i = 0; i < N; i++) { for (const j of nb[i]) this.excl.add(i < j ? i * 65536 + j : j * 65536 + i); for (const j of nb[i]) for (const k of nb[i]) if (j < k) this.excl.add(j * 65536 + k); }
    // LJ constants per element pair are computed on the fly from the types (x, D)
    this.version++; this.dirty = false;
  }

  // the materials engine asks for its lists here: covalent CSR (for display / coordination) and our non-bonded pairs
  syncLists() {
    const m = this.m, N = m.N; if (this.dirty || !this.nb || this.nb.length !== N) this.retype();
    const deg = m.start; deg.fill(0, 0, N + 1); let nb = 0;
    if (m.bi.length < this.bonds.length) { m.bi = new Int32Array(this.bonds.length * 2); m.bj = new Int32Array(this.bonds.length * 2); }
    for (const [a, b] of this.bonds) { m.bi[nb] = a; m.bj[nb] = b; nb++; deg[a + 1]++; deg[b + 1]++; }
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    if (m.nbr.length < deg[N]) m.nbr = new Int32Array(deg[N] * 2);
    const fill = m.fillPos || (m.fillPos = new Int32Array(m.maxN)); for (let i = 0; i < N; i++) fill[i] = deg[i];
    for (let p = 0; p < nb; p++) { const i = m.bi[p], j = m.bj[p]; m.nbr[fill[i]++] = j; m.nbr[fill[j]++] = i; }
    m.nb = nb; m.nv = 0;
    // non-bonded pairs within RC + SKIN
    const r2c = (RC + SKIN) ** 2; let np = 0;
    for (let i = 0; i < N - 1; i++) for (let j = i + 1; j < N; j++) {
      if (this.excl.has(i * 65536 + j)) continue;
      const dx = m.mi(m.x[j] - m.x[i], m.Lx, m.per[0]), dy = m.mi(m.y[j] - m.y[i], m.Ly, m.per[1]), dz = m.mi(m.z[j] - m.z[i], m.Lz, m.per[2]);
      if (dx * dx + dy * dy + dz * dz > r2c) continue;
      if (np >= this.pi.length) { const a = new Int32Array(np * 2); a.set(this.pi); this.pi = a; const b = new Int32Array(np * 2); b.set(this.pj); this.pj = b; }
      this.pi[np] = i; this.pj[np] = j; np++;
    }
    this.np = np;
  }

  // energy (eV), forces added to m.fx/fy/fz
  forces() {
    const m = this.m, x = m.x, y = m.y, z = m.z, fx = m.fx, fy = m.fy, fz = m.fz, per = m.per;
    const dX = (a, b) => m.mi(x[b] - x[a], m.Lx, per[0]), dY = (a, b) => m.mi(y[b] - y[a], m.Ly, per[1]), dZ = (a, b) => m.mi(z[b] - z[a], m.Lz, per[2]);
    const NB = this.bonds.length, s = new Float64Array(NB), ds = new Float64Array(NB), ux = new Float64Array(NB), uy = new Float64Array(NB), uz = new Float64Array(NB), rr = new Float64Array(NB);
    let E = 0;
    // bonds: s * Morse
    for (let k = 0; k < NB; k++) {
      const [a, b] = this.bonds[k], r0 = this.bp[4 * k], D = this.bp[4 * k + 1], al = this.bp[4 * k + 2];
      const dx = dX(a, b), dy = dY(a, b), dz = dZ(a, b), r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      rr[k] = r; ux[k] = dx / r; uy[k] = dy / r; uz[k] = dz / r;
      const t = (r / r0 - SW_LO) / (SW_HI - SW_LO); s[k] = sw(t); ds[k] = dsw(t) / ((SW_HI - SW_LO) * r0);
      const e = Math.exp(-al * (r - r0)), Em = D * ((1 - e) * (1 - e) - 1), dEm = 2 * D * al * e * (1 - e);
      E += s[k] * Em; const g = s[k] * dEm + ds[k] * Em;                        // dE/dr
      fx[a] += g * ux[k]; fy[a] += g * uy[k]; fz[a] += g * uz[k]; fx[b] -= g * ux[k]; fy[b] -= g * uy[k]; fz[b] -= g * uz[k];
    }
    // adds  -(E_term) * d(prod s)/dr  for every bond of a multi-body term (only when one of them is in its switching zone)
    const swForce = (Eterm, bl, prod) => {
      for (const k of bl) {
        if (ds[k] === 0) continue;
        const f = -Eterm * (prod / s[k]) * ds[k], [a, b] = this.bonds[k];      // d s_k / d r_b = ds * u (u from a to b)
        fx[a] -= f * ux[k]; fy[a] -= f * uy[k]; fz[a] -= f * uz[k]; fx[b] += f * ux[k]; fy[b] += f * uy[k]; fz[b] += f * uz[k];
      }
    };
    // angles
    for (const [i, j, k, b1, b2, K, C0, C1, C2, lin] of this.ang) {
      const prod = s[b1] * s[b2]; if (prod === 0) continue;
      const ax = dX(j, i), ay = dY(j, i), az = dZ(j, i), bx = dX(j, k), by = dY(j, k), bz = dZ(j, k);
      const la = Math.sqrt(ax * ax + ay * ay + az * az), lb = Math.sqrt(bx * bx + by * by + bz * bz);
      let c = (ax * bx + ay * by + az * bz) / (la * lb); c = Math.max(-1, Math.min(1, c));
      const Ea = lin ? K * (1 + c) : K * (C0 + C1 * c + C2 * (2 * c * c - 1)), dEc = lin ? K : K * (C1 + 4 * C2 * c);
      E += prod * Ea; const g = prod * dEc;
      // dc/dri = (b/lb - c a/la)/la ; dc/drk = (a/la - c b/lb)/lb
      const gix = (bx / lb - c * ax / la) / la, giy = (by / lb - c * ay / la) / la, giz = (bz / lb - c * az / la) / la;
      const gkx = (ax / la - c * bx / lb) / lb, gky = (ay / la - c * by / lb) / lb, gkz = (az / la - c * bz / lb) / lb;
      fx[i] -= g * gix; fy[i] -= g * giy; fz[i] -= g * giz; fx[k] -= g * gkx; fy[k] -= g * gky; fz[k] -= g * gkz;
      fx[j] += g * (gix + gkx); fy[j] += g * (giy + gky); fz[j] += g * (giz + gkz);
      if (ds[b1] !== 0 || ds[b2] !== 0) swForce(Ea, [b1, b2], prod);
    }
    // torsions
    for (const [i, j, k, l, b1, b2, b3, Vh, n, cn] of this.tor) {
      const prod = s[b1] * s[b2] * s[b3]; if (prod === 0) continue;
      const b1x = dX(i, j), b1y = dY(i, j), b1z = dZ(i, j), b2x = dX(j, k), b2y = dY(j, k), b2z = dZ(j, k), b3x = dX(k, l), b3y = dY(k, l), b3z = dZ(k, l);
      const mx = b1y * b2z - b1z * b2y, my = b1z * b2x - b1x * b2z, mz = b1x * b2y - b1y * b2x;
      const nx = b2y * b3z - b2z * b3y, ny = b2z * b3x - b2x * b3z, nz = b2x * b3y - b2y * b3x;
      const m2 = mx * mx + my * my + mz * mz, n2 = nx * nx + ny * ny + nz * nz; if (m2 < 1e-10 || n2 < 1e-10) continue;
      const lb2 = Math.sqrt(b2x * b2x + b2y * b2y + b2z * b2z);
      const phi = Math.atan2(lb2 * (b1x * nx + b1y * ny + b1z * nz), mx * nx + my * ny + mz * nz);
      const Et = Vh * (1 - cn * Math.cos(n * phi)), dEp = Vh * cn * n * Math.sin(n * phi);
      E += prod * Et; const g = prod * dEp;
      // dphi/dri = -|b2|/|m|^2 m, dphi/drl = |b2|/|n|^2 n, inner atoms from the usual projections
      const fix = -lb2 / m2 * mx, fiy = -lb2 / m2 * my, fiz = -lb2 / m2 * mz, flx = lb2 / n2 * nx, fly = lb2 / n2 * ny, flz = lb2 / n2 * nz;
      const p1 = (b1x * b2x + b1y * b2y + b1z * b2z) / (lb2 * lb2), p3 = (b3x * b2x + b3y * b2y + b3z * b2z) / (lb2 * lb2);
      // with b1 = rj - ri, b2 = rk - rj, b3 = rl - rk (checked against a numerical derivative in test/chem.test.mjs)
      const fjx = -(1 + p1) * fix + p3 * flx, fjy = -(1 + p1) * fiy + p3 * fly, fjz = -(1 + p1) * fiz + p3 * flz;
      const fkx = -(1 + p3) * flx + p1 * fix, fky = -(1 + p3) * fly + p1 * fiy, fkz = -(1 + p3) * flz + p1 * fiz;
      fx[i] -= g * fix; fy[i] -= g * fiy; fz[i] -= g * fiz; fx[l] -= g * flx; fy[l] -= g * fly; fz[l] -= g * flz;
      fx[j] -= g * fjx; fy[j] -= g * fjy; fz[j] -= g * fjz; fx[k] -= g * fkx; fy[k] -= g * fky; fz[k] -= g * fkz;
      if (ds[b1] !== 0 || ds[b2] !== 0 || ds[b3] !== 0) swForce(Et, [b1, b2, b3], prod);
    }
    // inversion: for each choice of l among the three neighbours, A (n . u_l)^2 with n the unit normal of (centre, other two)
    for (const [c, a1, a2, a3, ba, bb, bc, A] of this.inv) {
      const prod = s[ba] * s[bb] * s[bc]; if (prod === 0) continue;
      const nbr = [a1, a2, a3]; let Einv = 0;
      for (let q = 0; q < 3; q++) {
        const l = nbr[q], p = nbr[(q + 1) % 3], r = nbr[(q + 2) % 3];
        const ax = dX(c, p), ay = dY(c, p), az = dZ(c, p), bx = dX(c, r), by = dY(c, r), bz = dZ(c, r), ux_ = dX(c, l), uy_ = dY(c, l), uz_ = dZ(c, l);
        const Nx = ay * bz - az * by, Ny = az * bx - ax * bz, Nz = ax * by - ay * bx, Nl = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz), ul = Math.sqrt(ux_ * ux_ + uy_ * uy_ + uz_ * uz_);
        if (Nl < 1e-8) continue;
        const nx = Nx / Nl, ny = Ny / Nl, nz = Nz / Nl, f = Nx * ux_ + Ny * uy_ + Nz * uz_, co = f / (Nl * ul);
        Einv += A * co * co; const g = prod * 2 * A * co;
        // d co / d a = (b x u)/(|N||u|) - co (b x n)/|N| ; d co / d b = (u x a)/(|N||u|) - co (n x a)/|N| ; d co / d u = N/(|N||u|) - co u/|u|^2
        const bux = by * uz_ - bz * uy_, buy = bz * ux_ - bx * uz_, buz = bx * uy_ - by * ux_, bnx = by * nz - bz * ny, bny = bz * nx - bx * nz, bnz = bx * ny - by * nx;
        const uax = uy_ * az - uz_ * ay, uay = uz_ * ax - ux_ * az, uaz = ux_ * ay - uy_ * ax, nax = ny * az - nz * ay, nay = nz * ax - nx * az, naz = nx * ay - ny * ax;
        const NU = Nl * ul;
        const gax = bux / NU - co * bnx / Nl, gay = buy / NU - co * bny / Nl, gaz = buz / NU - co * bnz / Nl;
        const gbx = uax / NU - co * nax / Nl, gby = uay / NU - co * nay / Nl, gbz = uaz / NU - co * naz / Nl;
        const gux = Nx / NU - co * ux_ / (ul * ul), guy = Ny / NU - co * uy_ / (ul * ul), guz = Nz / NU - co * uz_ / (ul * ul);
        fx[p] -= g * gax; fy[p] -= g * gay; fz[p] -= g * gaz; fx[r] -= g * gbx; fy[r] -= g * gby; fz[r] -= g * gbz; fx[l] -= g * gux; fy[l] -= g * guy; fz[l] -= g * guz;
        fx[c] += g * (gax + gbx + gux); fy[c] += g * (gay + gby + guy); fz[c] += g * (gaz + gbz + guz);
      }
      E += prod * Einv;
      if (ds[ba] !== 0 || ds[bb] !== 0 || ds[bc] !== 0) swForce(Einv, [ba, bb, bc], prod);
    }
    // van der Waals (UFF Lennard-Jones, shifted force at RC)
    const rc2 = RC * RC;
    for (let p = 0; p < this.np; p++) {
      const i = this.pi[p], j = this.pj[p], dx = dX(i, j), dy = dY(i, j), dz = dZ(i, j), r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= rc2) continue;
      const Ti = T[this.type[i]], Tj = T[this.type[j]], X = Math.sqrt(Ti[2] * Tj[2]), D = Math.sqrt(Ti[3] * Tj[3]) * KCAL, r = Math.sqrt(r2);
      const q6 = Math.pow(X * X / r2, 3), c6 = Math.pow(X / RC, 6);
      const Er = D * (q6 * q6 - 2 * q6), Ec = D * (c6 * c6 - 2 * c6), dEr = D * (-12 * q6 * q6 + 12 * q6) / r, dEc = D * (-12 * c6 * c6 + 12 * c6) / RC;
      E += Er - Ec - (r - RC) * dEc; const g = (dEr - dEc) / r;       // dE/dr / r
      fx[i] += g * dx; fy[i] += g * dy; fz[i] += g * dz; fx[j] -= g * dx; fy[j] -= g * dy; fz[j] -= g * dz;
    }
    this.lastS = s; this.lastR = rr;
    return E;
  }

  // remove bonds stretched past SW_HI rest lengths (after a force call); returns how many broke
  breakStretched() {
    if (!this.lastR) return 0; const keep = [], R = this.lastR; let n = 0;
    this.bonds.forEach((b, k) => { if (R[k] > SW_HI * this.bp[4 * k]) n++; else keep.push(b); });
    if (n) { this.bonds = keep; this.dirty = true; this.retype(); this.m.listDirty = true; }
    return n;
  }

  // attach a new atom of element `el` to atom `host` (with optional H caps); `toward` is a point on the side to attach on
  attach(host, el, fillH, toward) {
    const m = this.m, spOf = (e) => SPECIES.findIndex((s) => s.sym === e);
    const sp = spOf(el); if (sp < 0) return { err: `unknown element ${el}` };
    if (this.free(host) < 1) return { err: `${this.sym(host)} already has ${this.deg[host]} bond${this.deg[host] === 1 ? '' : 's'} (valence ${this.valence(host)})` };
    const nH = fillH ? Math.max(0, (VALENCE[el] ?? 1) - 1) : 0;
    if (m.N + 1 + nH > m.maxN) return { err: 'too many atoms' };
    if (this.dirty || !this.nb || this.nb.length !== m.N) this.retype();
    // direction: away from the existing bonds; for a flat sp2 centre, along the normal on the side of `toward`
    const nbs = this.nb[host]; let dx = 0, dy = 0, dz = 0;
    for (const j of nbs) { const vx = m.mi(m.x[j] - m.x[host], m.Lx, m.per[0]), vy = m.mi(m.y[j] - m.y[host], m.Ly, m.per[1]), vz = m.mi(m.z[j] - m.z[host], m.Lz, m.per[2]), l = Math.hypot(vx, vy, vz); dx -= vx / l; dy -= vy / l; dz -= vz / l; }
    let tx = toward[0] - m.x[host], ty = toward[1] - m.y[host], tz = toward[2] - m.z[host]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (Math.hypot(dx, dy, dz) < 0.35 && nbs.length >= 2) {        // flat: normal of the neighbour plane
      const a = nbs[0], b = nbs[1];
      const ax = m.mi(m.x[a] - m.x[host], m.Lx, m.per[0]), ay = m.mi(m.y[a] - m.y[host], m.Ly, m.per[1]), az = m.mi(m.z[a] - m.z[host], m.Lz, m.per[2]);
      const bx = m.mi(m.x[b] - m.x[host], m.Lx, m.per[0]), by = m.mi(m.y[b] - m.y[host], m.Ly, m.per[1]), bz = m.mi(m.z[b] - m.z[host], m.Lz, m.per[2]);
      dx = ay * bz - az * by; dy = az * bx - ax * bz; dz = ax * by - ay * bx;
      if (dx * tx + dy * ty + dz * tz < 0) { dx = -dx; dy = -dy; dz = -dz; }
    } else if (Math.hypot(dx, dy, dz) < 0.35) { dx = tx; dy = ty; dz = tz; }
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    const tHost = typeFor(this.sym(host), this.deg[host] + 1), tNew = typeFor(el, 1 + nH), r0 = bondR0(tHost, tNew, 1);
    const X = m.x[host] + dx * r0, Y = m.y[host] + dy * r0, Z = m.z[host] + dz * r0;
    const k = m.addRaw(sp, X, Y, Z, m.grp[host]); this.bonds.push([host, k]);
    // H caps on the new atom: tetrahedral-ish around the new bond axis, turned to keep clear of the atoms already there
    const added = [k];
    if (nH) {
      let px = -dy, py = dx, pz = 0; if (Math.hypot(px, py, pz) < 1e-3) { px = 1; py = 0; pz = 0; }
      const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
      const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
      const rh = bondR0(tNew, 'H_', 1), tilt = (180 - (nH === 1 ? T[tNew][1] : 109.47)) * Math.PI / 180;
      const spots = (rot) => { const o = []; for (let h = 0; h < nH; h++) { const ph = rot + 2 * Math.PI * h / nH, c = Math.cos(ph), s = Math.sin(ph); o.push([X + rh * (Math.cos(tilt) * dx + Math.sin(tilt) * (c * px + s * qx)), Y + rh * (Math.cos(tilt) * dy + Math.sin(tilt) * (c * py + s * qy)), Z + rh * (Math.cos(tilt) * dz + Math.sin(tilt) * (c * pz + s * qz))]); } return o; };
      let best = null, bestD = -1;
      for (let t = 0; t < 24; t++) {                              // the rotation whose closest other atom is farthest away
        const o = spots(2 * Math.PI * t / 24); let dmin = 1e9;
        for (const [hx, hy, hz] of o) for (let i = 0; i < m.N; i++) { if (i === k) continue; const d = Math.hypot(m.x[i] - hx, m.y[i] - hy, m.z[i] - hz); if (d < dmin) dmin = d; }
        if (dmin > bestD) { bestD = dmin; best = o; }
      }
      for (const [hx, hy, hz] of best) { const hh = m.addRaw(spOf('H'), hx, hy, hz, m.grp[host]); this.bonds.push([k, hh]); added.push(hh); }
    }
    this.dirty = true; this.retype(); m.listDirty = true;
    this.relaxLocal(added.concat([host]), 120);
    return { atom: k, added: 1 + nH };
  }

  // short steepest descent on a few atoms only (the rest stay put, velocities untouched): takes the strain out of a fresh attachment
  relaxLocal(ids, iters) {
    const m = this.m;
    for (let it = 0; it < iters; it++) {
      m.computeForces(); let fmax = 0;
      for (const i of ids) {
        const f = Math.hypot(m.fx[i], m.fy[i], m.fz[i]); fmax = Math.max(fmax, f);
        const step = Math.min(0.05, 0.01 * f) / (f || 1);
        m.x[i] += m.fx[i] * step; m.y[i] += m.fy[i] * step; m.z[i] += m.fz[i] * step;
      }
      if (fmax < 0.05) break;
    }
    for (const i of ids) { m.vx[i] = m.vy[i] = m.vz[i] = 0; }
    m.computeForces();
  }
}
