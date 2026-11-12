// Electron transport through the current atomic geometry: pi-electron tight binding + wide-band contacts (NEGF).
//
// Hamiltonian: one p orbital per carbon atom, pointing along the local normal of the atom (plane of its bonded
// neighbours), so bent sheets, graphite layers and randomly oriented benzene molecules are all handled the same way.
// Hopping between orbitals i and j a distance d apart (Slater-Koster, Trambly de Laissardiere et al., Nano Lett. 10, 804 (2010)):
//   t_ij = Vpps(d) (n_i.u)(n_j.u) + Vppp(d) [n_i.n_j - (n_i.u)(n_j.u)],   u = unit vector i->j
//   Vppp(d) = -2.7 eV exp(q_p (1 - d/a0)),   Vpps(d) = 0.48 eV exp(q_s (1 - d/d0)),   a0 = 1.42 A, d0 = 3.35 A, q_p/a0 = q_s/d0
// with a smooth cutoff between 4.0 and 4.5 A. Hydrogen, Mo and S carry no orbital (MoS2 needs a d-orbital model: not supported).
//
// Contacts: a set of atoms tied to the "-" electrode (electrons are injected there) and a set tied to the "+" electrode.
// Each contact atom gets a wide-band self-energy -i Gamma/2. The Green's function is never inverted at full size:
// H = U diag(eps) U^T is diagonalised once per geometry, and every energy then only needs the small contact block
//   G_CC = (I - g0_CC Sigma)^-1 g0_CC,   g0 = (E + i eta - H)^-1        (Dyson equation, exact)
// Transmission T(E) = sum_{l in -, r in +} Gamma_l Gamma_r |G_lr|^2, current I(V) = (2e^2/h) int T(E) [f_- - f_+] dE (spin included).
// Bond currents: electron flow i -> j at energy E carried by the states injected from the "-" contact,
//   J_ij(E) = -2 Im[H_ij A_ji],  A = G Gamma_- G^dagger,   in units where the total is T(E) (checked in the tests).
export const TBP = { a0: 1.42, d0: 3.35, Vppp: -2.7, Vpps: 0.48, qp: 3.15, qs: 7.43, rOn: 4.0, rCut: 4.5, bond: 1.9, edgeT: 1.12 };
export const HUB = { U: 2.7 };                     // on-site Coulomb repulsion for the spin-polarised edges (eV); 0 = off
export const G0_SIEMENS = 7.748091729e-5;        // 2e^2/h

const fcut = (d) => d <= TBP.rOn ? 1 : d >= TBP.rCut ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (d - TBP.rOn) / (TBP.rCut - TBP.rOn));

// sys = { N, x, y, z, orb(i) -> bool (gets a p orbital), per [3 bools], L [Lx, Ly, Lz] }
export function buildHamiltonian(sys) {
  const { N, x, y, z, per, L } = sys;
  const mi = (d, k) => per[k] ? d - L[k] * Math.round(d / L[k]) : d;
  const idx = []; for (let i = 0; i < N; i++) if (sys.orb(i)) idx.push(i);
  const n = idx.length;
  // local normals from bonded neighbours (any species), oriented consistently within the atom only (the sign is a gauge)
  const nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    const i = idx[a], nb = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const dx = mi(x[j] - x[i], 0), dy = mi(y[j] - y[i], 1), dz = mi(z[j] - z[i], 2);
      const r2 = dx * dx + dy * dy + dz * dz; if (r2 < TBP.bond * TBP.bond) nb.push([dx, dy, dz]);
    }
    let cx = 0, cy = 0, cz = 0;
    for (let p = 0; p < nb.length; p++) for (let q = p + 1; q < nb.length; q++) {
      const u = nb[p], v = nb[q];
      let X = u[1] * v[2] - u[2] * v[1], Y = u[2] * v[0] - u[0] * v[2], Z = u[0] * v[1] - u[1] * v[0];
      if (X * cx + Y * cy + Z * cz < 0) { X = -X; Y = -Y; Z = -Z; }
      cx += X; cy += Y; cz += Z;
    }
    const l = Math.hypot(cx, cy, cz);
    if (l > 1e-6) { nx[a] = cx / l; ny[a] = cy / l; nz[a] = cz / l; }
    else if (nb.length === 1) {                                  // one neighbour: any normal perpendicular to the bond
      const u = nb[0], ul = Math.hypot(u[0], u[1], u[2]); let px = 0, py = 0, pz = 1;
      const d = (px * u[0] + py * u[1] + pz * u[2]) / ul; px -= d * u[0] / ul; py -= d * u[1] / ul; pz -= d * u[2] / ul;
      let pl = Math.hypot(px, py, pz); if (pl < 1e-6) { px = 1; py = 0; pz = 0; pl = 1; }
      nx[a] = px / pl; ny[a] = py / pl; nz[a] = pz / pl;
    } else { nx[a] = 0; ny[a] = 0; nz[a] = 1; }
  }
  const H = new Float64Array(n * n), pairs = [], cc = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const i = idx[a], j = idx[b];
    const dx = mi(x[j] - x[i], 0), dy = mi(y[j] - y[i], 1), dz = mi(z[j] - z[i], 2);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d >= TBP.rCut || d < 0.5) continue;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const ca = nx[a] * ux + ny[a] * uy + nz[a] * uz, cb = nx[b] * ux + ny[b] * uy + nz[b] * uz, nn = nx[a] * nx[b] + ny[a] * ny[b] + nz[a] * nz[b];
    const vp = TBP.Vppp * Math.exp(TBP.qp * (1 - d / TBP.a0)), vs = TBP.Vpps * Math.exp(TBP.qs * (1 - d / TBP.d0));
    const t = (vs * ca * cb + vp * (nn - ca * cb)) * fcut(d);
    if (Math.abs(t) < 1e-6) continue;
    H[a * n + b] = H[b * n + a] = t; pairs.push(a, b); if (d < 1.7) cc.push(a, b);
  }
  // Armchair edges: the bond between the two edge atoms of an edge dimer is shorter and its hopping ~12 % stronger (Son, Cohen, Louie,
  // PRL 97, 216803 (2006)); it opens the small gap of the otherwise metallic N = 3p+2 armchair ribbons. Edge dimer = two bonded carbons
  // with two carbon neighbours each, both also bonded to a three-fold carbon (so not a chain, not benzene).
  let edgeBonds = 0;
  if (TBP.edgeT !== 1) {
    const deg = new Int32Array(n); for (let p = 0; p < cc.length; p += 2) { deg[cc[p]]++; deg[cc[p + 1]]++; }
    const has3 = new Uint8Array(n); for (let p = 0; p < cc.length; p += 2) { const a = cc[p], b = cc[p + 1]; if (deg[b] === 3) has3[a] = 1; if (deg[a] === 3) has3[b] = 1; }
    for (let p = 0; p < cc.length; p += 2) { const a = cc[p], b = cc[p + 1]; if (deg[a] === 2 && deg[b] === 2 && has3[a] && has3[b]) { H[a * n + b] *= TBP.edgeT; H[b * n + a] *= TBP.edgeT; edgeBonds++; } }
  }
  return { n, idx, H, pairs: Int32Array.from(pairs), normals: [nx, ny, nz], edgeBonds };
}

// symmetric eigen decomposition (Householder tridiagonalisation + implicit QL, after JAMA/EISPACK tred2/tql2)
// in: A (n*n, row-major, symmetric) -> { w: eigenvalues ascending, U: n*n with eigenvector k in row k }
export function eigSym(A, n) {
  const V = []; for (let i = 0; i < n; i++) V.push(Float64Array.from(A.subarray(i * n, (i + 1) * n)));
  const d = new Float64Array(n), e = new Float64Array(n);
  if (n === 1) return { w: Float64Array.of(A[0]), U: Float64Array.of(1) };
  // tred2
  for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g;
      e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
        for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
        e[j] = g;
      }
      f = 0; for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h); for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]);
        d[j] = V[i - 1][j]; V[i][j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[n - 1][i] = V[i][i]; V[i][i] = 1; const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0; for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
        for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
  }
  for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
  V[n - 1][n - 1] = 1; e[0] = 0;
  // transpose: C[k] = column k of V, so the QL rotations run over contiguous memory
  const C = []; for (let k = 0; k < n; k++) { const c = new Float64Array(n); for (let r = 0; r < n; r++) c[r] = V[r][k]; C.push(c); }
  // tql2
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l; while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m > l) {
      let iter = 0;
      do {
        if (++iter > 60) throw new Error('eigSym: no convergence');
        let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1); if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1]; let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s; g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
          e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          const a = C[i], b = C[i + 1];
          for (let k = 0; k < n; k++) { const hk = b[k]; b[k] = s * a[k] + c * hk; a[k] = c * a[k] - s * hk; }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f; e[l] = 0;
  }
  const ord = Array.from({ length: n }, (_, k) => k).sort((a, b) => d[a] - d[b]);
  const w = new Float64Array(n), U = new Float64Array(n * n);
  ord.forEach((k, r) => { w[r] = d[k]; U.set(C[k], r * n); });
  return { w, U };
}

// small dense complex solve: A X = B (A m*m, B m*q), in place on copies, partial pivoting. Arrays re/im row-major.
function csolve(Ar, Ai, Br, Bi, m, q) {
  for (let c = 0; c < m; c++) {
    let p = c, best = -1;
    for (let r = c; r < m; r++) { const v = Ar[r * m + c] ** 2 + Ai[r * m + c] ** 2; if (v > best) { best = v; p = r; } }
    if (p !== c) {
      for (let k = 0; k < m; k++) { let t = Ar[c * m + k]; Ar[c * m + k] = Ar[p * m + k]; Ar[p * m + k] = t; t = Ai[c * m + k]; Ai[c * m + k] = Ai[p * m + k]; Ai[p * m + k] = t; }
      for (let k = 0; k < q; k++) { let t = Br[c * q + k]; Br[c * q + k] = Br[p * q + k]; Br[p * q + k] = t; t = Bi[c * q + k]; Bi[c * q + k] = Bi[p * q + k]; Bi[p * q + k] = t; }
    }
    const pr = Ar[c * m + c], pi = Ai[c * m + c], den = pr * pr + pi * pi || 1e-300, ir = pr / den, ii = -pi / den;
    for (let r = c + 1; r < m; r++) {
      const ar = Ar[r * m + c], ai = Ai[r * m + c]; if (ar === 0 && ai === 0) continue;
      const fr = ar * ir - ai * ii, fi = ar * ii + ai * ir;
      for (let k = c; k < m; k++) { const br = Ar[c * m + k], bi = Ai[c * m + k]; Ar[r * m + k] -= fr * br - fi * bi; Ai[r * m + k] -= fr * bi + fi * br; }
      for (let k = 0; k < q; k++) { const br = Br[c * q + k], bi = Bi[c * q + k]; Br[r * q + k] -= fr * br - fi * bi; Bi[r * q + k] -= fr * bi + fi * br; }
    }
  }
  for (let c = m - 1; c >= 0; c--) {
    const pr = Ar[c * m + c], pi = Ai[c * m + c], den = pr * pr + pi * pi || 1e-300, ir = pr / den, ii = -pi / den;
    for (let k = 0; k < q; k++) {
      let sr = Br[c * q + k], si = Bi[c * q + k];
      for (let j = c + 1; j < m; j++) { const ar = Ar[c * m + j], ai = Ai[c * m + j], xr = Br[j * q + k], xi = Bi[j * q + k]; sr -= ar * xr - ai * xi; si -= ar * xi + ai * xr; }
      Br[c * q + k] = sr * ir - si * ii; Bi[c * q + k] = sr * ii + si * ir;
    }
  }
}

// A transport solver for one geometry. cm / cp = orbital indices (into the Hamiltonian) of the "-" and "+" contacts.
export class Transport {
  constructor(ham, cm, cp, gamma = 1.0, eta = 1e-9, eig = null, EF = null) {
    this.ham = ham; this.n = ham.n; this.cm = cm; this.cp = cp; this.gamma = gamma; this.eta = eta;
    this.C = cm.concat(cp); this.nc = this.C.length; this.nm = cm.length;
    const { w, U } = eig || eigSym(ham.H, ham.n); this.w = w; this.U = U;
    const n = this.n, half = Math.floor(n / 2);                       // one pi electron per carbon: half filling
    this.EF = EF !== null ? EF : n < 2 ? 0 : n % 2 ? w[half] : 0.5 * (w[half - 1] + w[half]);
    this.gapHL = n < 2 ? 0 : n % 2 ? 0 : w[half] - w[half - 1];
    // eigenvector components on the contact orbitals, contiguous: UC[k*nc + c]
    const nc = this.nc; this.UC = new Float64Array(n * nc);
    for (let k = 0; k < n; k++) for (let c = 0; c < nc; c++) this.UC[k * nc + c] = U[k * n + this.C[c]];
  }

  // contact-block Green's function at energy E: returns { Gr, Gi } (nc*nc)
  gCC(E) {
    const n = this.n, nc = this.nc, w = this.w, UC = this.UC, eta = this.eta;
    const gr = new Float64Array(nc * nc), gi = new Float64Array(nc * nc);
    for (let k = 0; k < n; k++) {
      const dr = E - w[k], den = dr * dr + eta * eta, ar = dr / den, ai = -eta / den, o = k * nc;
      for (let a = 0; a < nc; a++) {
        const ua = UC[o + a]; if (ua === 0) continue;
        const pr = ua * ar, pi = ua * ai;
        for (let b = 0; b < nc; b++) { const ub = UC[o + b]; gr[a * nc + b] += pr * ub; gi[a * nc + b] += pi * ub; }
      }
    }
    // (I - g0 Sigma) G = g0, Sigma = -i Gamma/2 on the diagonal: g0 Sigma = g0 * (-i g/2)
    const Mr = new Float64Array(nc * nc), Mi = new Float64Array(nc * nc), h = this.gamma / 2;
    for (let a = 0; a < nc; a++) for (let b = 0; b < nc; b++) {
      // -(g0_ab * (-i h)) = i h g0_ab = (-h*gi) + i (h*gr)
      Mr[a * nc + b] = (a === b ? 1 : 0) - h * gi[a * nc + b];
      Mi[a * nc + b] = h * gr[a * nc + b];
    }
    const Br = Float64Array.from(gr), Bi = Float64Array.from(gi);
    csolve(Mr, Mi, Br, Bi, nc, nc);
    return { Gr: Br, Gi: Bi, g0r: gr, g0i: gi };
  }

  transmission(E) {
    const nc = this.nc, nm = this.nm, { Gr, Gi } = this.gCC(E), g2 = this.gamma * this.gamma; let T = 0;
    for (let l = 0; l < nm; l++) for (let r = nm; r < nc; r++) T += g2 * (Gr[l * nc + r] ** 2 + Gi[l * nc + r] ** 2);
    return T;
  }

  // full columns G_{:, l} for the "-" contact orbitals at energy E: returns { Xr, Xi } with X[i*nm + l]
  gColsMinus(E) {
    const n = this.n, nc = this.nc, nm = this.nm, U = this.U, w = this.w, UC = this.UC, eta = this.eta, h = this.gamma / 2;
    const { Gr, Gi } = this.gCC(E);
    // G_{:,l} = g0_{:,C} (I + Sigma G_CC)_{C,l}  =  sum_k U_k (U_kC . Y_l) / (E - w_k),  Y = (I + Sigma G_CC)_{C,l}
    const Yr = new Float64Array(nc * nm), Yi = new Float64Array(nc * nm);
    for (let c = 0; c < nc; c++) for (let l = 0; l < nm; l++) {
      // Sigma G = -i h G  ->  re: h*Gi, im: -h*Gr
      Yr[c * nm + l] = (c === l ? 1 : 0) + h * Gi[c * nc + l];
      Yi[c * nm + l] = -h * Gr[c * nc + l];
    }
    const Xr = new Float64Array(n * nm), Xi = new Float64Array(n * nm), cr = new Float64Array(nm), ci = new Float64Array(nm);
    for (let k = 0; k < n; k++) {
      const dr = E - w[k], den = dr * dr + eta * eta, ar = dr / den, ai = -eta / den, o = k * nc;
      let any = false;
      for (let l = 0; l < nm; l++) {
        let sr = 0, si = 0; for (let c = 0; c < nc; c++) { const u = UC[o + c]; sr += u * Yr[c * nm + l]; si += u * Yi[c * nm + l]; }
        cr[l] = sr * ar - si * ai; ci[l] = sr * ai + si * ar; if (cr[l] !== 0 || ci[l] !== 0) any = true;
      }
      if (!any) continue;
      const row = k * n;
      for (let i = 0; i < n; i++) { const u = U[row + i]; if (u === 0) continue; const b = i * nm; for (let l = 0; l < nm; l++) { Xr[b + l] += u * cr[l]; Xi[b + l] += u * ci[l]; } }
    }
    return { Xr, Xi };
  }

  // electron-flow bond currents J_ab(E) for every Hamiltonian pair (a,b), a -> b positive
  bondCurrents(E) {
    const nm = this.nm, n = this.n, H = this.ham.H, P = this.ham.pairs, { Xr, Xi } = this.gColsMinus(E), g = this.gamma;
    const J = new Float64Array(P.length / 2);
    for (let p = 0; p < J.length; p++) {
      const a = P[2 * p], b = P[2 * p + 1];
      // A_ba = sum_l Gamma G_bl conj(G_al);  J_ab = -2 Im(H_ab A_ba)
      let ai = 0; for (let l = 0; l < nm; l++) ai += Xi[b * nm + l] * Xr[a * nm + l] - Xr[b * nm + l] * Xi[a * nm + l];
      J[p] = -2 * H[a * n + b] * g * ai;
    }
    return J;
  }
}


/* ---------------- spin-polarised edges: mean-field Hubbard ----------------
   The pi model alone leaves zigzag ribbons metallic (a flat edge band at E_F). With the on-site Coulomb repulsion U in mean field,
   H_s = H0 + U diag(n_{-s} - 1/2), the edge states polarise - ferromagnetic along an edge, opposite on the two edges - and a gap opens
   (Son, Cohen, Louie, PRL 97, 216803 (2006); Yazyev, Rep. Prog. Phys. 73, 056501 (2010); U = t = 2.7 eV, which gives the LSDA gaps of narrow zigzag ribbons, ~0.5 eV at 1 nm). Solved self-consistently
   for each geometry from an antiferromagnetic (sublattice) guess, or from the previous solution (prev), with linear mixing. A structure
   without edge states (benzene, a chain, a bulk sheet) converges to the non-magnetic solution and nothing changes. */
const MIX = 0.7;                                  // linear mixing of the densities between iterations
export function meanField(ham, U, prev = null, maxIt = 60, tol = 2e-4) {
  const n = ham.n, H0 = ham.H, kT = 0.01;
  let nUp = new Float64Array(n), nDn = new Float64Array(n), warm = false;
  if (prev && prev.n === n && prev.idx && prev.idx.length === n && prev.idx.every((v, k) => v === ham.idx[k])) { nUp.set(prev.nUp); nDn.set(prev.nDn); warm = true; }
  else {                                                          // sublattice colouring over the strong bonds: +/- 0.2 moments
    const col = new Int8Array(n), q = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (col[s0]) continue; col[s0] = 1; q.push(s0);
      while (q.length) { const a = q.pop(); for (let b = 0; b < n; b++) if (!col[b] && Math.abs(H0[a * n + b]) > 1.5) { col[b] = -col[a]; q.push(b); } }
    }
    for (let i = 0; i < n; i++) { nUp[i] = 0.5 + 0.2 * col[i]; nDn[i] = 0.5 - 0.2 * col[i]; }
  }
  const Hs = new Float64Array(n * n);
  const solve = (nOther) => { Hs.set(H0); for (let i = 0; i < n; i++) Hs[i * n + i] += U * (nOther[i] - 0.5); return eigSym(Hs, n); };
  let up = null, dn = null, mu = 0, it = 0, change = 1;
  for (it = 1; it <= maxIt; it++) {
    up = solve(nDn); dn = solve(nUp);
    // chemical potential: n electrons (half filling) in the two spin spectra - midway between the highest filled and the lowest empty
    // level of the combined spectrum (so it sits mid-gap in a gapped structure, as E_F without U); a little smearing for stability
    const all = Float64Array.from([...up.w, ...dn.w]).sort();
    mu = 0.5 * (all[n - 1] + all[n]);
    const occ = (sp, out) => { out.fill(0); for (let k = 0; k < n; k++) { const f = fermi(sp.w[k], mu, kT); if (f < 1e-12) continue; const r = k * n; for (let i = 0; i < n; i++) out[i] += f * sp.U[r + i] * sp.U[r + i]; } };
    const cu = new Float64Array(n), cd = new Float64Array(n); occ(up, cu); occ(dn, cd);
    change = 0; for (let i = 0; i < n; i++) change = Math.max(change, Math.abs(cu[i] - nUp[i]), Math.abs(cd[i] - nDn[i]));
    for (let i = 0; i < n; i++) { nUp[i] = (1 - MIX) * nUp[i] + MIX * cu[i]; nDn[i] = (1 - MIX) * nDn[i] + MIX * cd[i]; }
    if (change < tol) break;
  }
  let mmax = 0; for (let i = 0; i < n; i++) mmax = Math.max(mmax, Math.abs(nUp[i] - nDn[i]) / 2);
  const Hup = new Float64Array(H0), Hdn = new Float64Array(H0); for (let i = 0; i < n; i++) { Hup[i * n + i] += U * (nDn[i] - 0.5); Hdn[i * n + i] += U * (nUp[i] - 0.5); }
  return { up, dn, Hup, Hdn, mu, it: Math.min(it, maxIt), conv: change < tol, mmax, warm, state: { n, idx: Array.from(ham.idx), nUp, nDn } };
}
// the two spin channels as one transport object: T and the bond currents are the spin averages (the 2e^2/h prefactor keeps spin)
class SpinTransport {
  constructor(ham, cm, cp, gamma, mf) {
    this.up = new Transport(Object.assign({}, ham, { H: mf.Hup }), cm, cp, gamma, 1e-9, mf.up, mf.mu);
    this.dn = new Transport(Object.assign({}, ham, { H: mf.Hdn }), cm, cp, gamma, 1e-9, mf.dn, mf.mu);
    this.EF = mf.mu;
    let homo = -Infinity, lumo = Infinity; for (const w of [mf.up.w, mf.dn.w]) for (const e of w) { if (e <= mf.mu && e > homo) homo = e; if (e > mf.mu && e < lumo) lumo = e; }
    this.gapHL = isFinite(homo) && isFinite(lumo) ? lumo - homo : 0;
  }
  transmission(E) { return 0.5 * (this.up.transmission(E) + this.dn.transmission(E)); }
  bondCurrents(E) { const a = this.up.bondCurrents(E), b = this.dn.bondCurrents(E); for (let p = 0; p < a.length; p++) a[p] = 0.5 * (a[p] + b[p]); return a; }
}

export const fermi = (E, mu, kT) => { const x = (E - mu) / Math.max(kT, 1e-6); return x > 40 ? 0 : x < -40 ? 1 : 1 / (1 + Math.exp(x)); };

// everything the panel shows, for one geometry
// opts: { gamma, Emin, Emax, nE, Vmax, nV, V (bias for the current map), kT, curve (false = live part only:
//         bond currents, T(EF) and I at the chosen bias - no T(E) and I(V) curves) }
export function analyse(sys, contactsMinus, contactsPlus, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const ham = buildHamiltonian(sys);
  const where = new Map(); ham.idx.forEach((atom, o) => where.set(atom, o));
  const cm = [], cp = [];
  for (const a of contactsMinus) if (where.has(a)) cm.push(where.get(a));
  for (const a of contactsPlus) if (where.has(a) && !contactsMinus.includes(a)) cp.push(where.get(a));
  if (!ham.n) return { error: 'No carbon atoms: transport uses a carbon p-orbital model (MoS₂ is not supported yet).' };
  if (!cm.length || !cp.length) return { error: 'Mark at least one − contact and one + contact on carbon atoms.', n: ham.n };
  const gamma = opts.gamma ?? 1.0, kT = opts.kT ?? 0.025, U = opts.U ?? 0;
  let tr, mf = null;
  if (U > 0 && ham.n > 1) { mf = meanField(ham, U, opts.prev || null, opts.mfIt ?? (opts.curve === false ? 2 : 60)); tr = new SpinTransport(ham, cm, cp, gamma, mf); }
  else tr = new Transport(ham, cm, cp, gamma);
  const tEig = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  const EF = tr.EF, out = { n: ham.n, EF, gapHL: tr.gapHL, TEF: tr.transmission(EF), edgeBonds: ham.edgeBonds };
  if (mf) { out.mf = { U, it: mf.it, conv: mf.conv, mmax: mf.mmax, warm: mf.warm }; out.mfState = mf.state; }
  // live part: bond currents and the current at the chosen bias, from energies across the bias window (with thermal tails)
  const vb = Math.max(1e-4, opts.V ?? 0.2), lo = EF - vb / 2 - 5 * kT, hi = EF + vb / 2 + 5 * kT;
  const nw = Math.min(opts.nWindow ?? 24, Math.max(6, Math.ceil((hi - lo) / 0.015))), dw = (hi - lo) / nw;
  const Jsum = new Float64Array(ham.pairs.length / 2); let Ib = 0;
  for (let s = 0; s < nw; s++) {
    const e = lo + (s + 0.5) * dw, wgt = (fermi(e, EF + vb / 2, kT) - fermi(e, EF - vb / 2, kT)) * dw; if (wgt < 1e-9) continue;
    Ib += wgt * tr.transmission(e);
    const J = tr.bondCurrents(e); for (let p = 0; p < J.length; p++) Jsum[p] += wgt * J[p];
  }
  out.Vbias = vb; out.Ibias = G0_SIEMENS * Ib;                         // amperes; I = (2e^2/h) int T (f- - f+) dE
  const pairsAtoms = new Int32Array(ham.pairs.length); for (let p = 0; p < ham.pairs.length; p++) pairsAtoms[p] = ham.idx[ham.pairs[p]];
  out.pairs = pairsAtoms; out.J = Jsum;                                 // J in the same units as T: multiply by 2e^2/h for amperes
  if (opts.curve !== false) {
    const Emin = EF + (opts.Emin ?? -3), Emax = EF + (opts.Emax ?? 3), nE = opts.nE ?? 1201;
    const E = new Float64Array(nE), T = new Float64Array(nE), dE = (Emax - Emin) / (nE - 1);
    for (let k = 0; k < nE; k++) { E[k] = Emin + k * dE; T[k] = tr.transmission(E[k]); }
    // I(V): chemical potentials EF +- V/2 (the "-" electrode holds the higher electron energy)
    const Vmax = opts.Vmax ?? 2, nV = opts.nV ?? 81, V = new Float64Array(nV), I = new Float64Array(nV), dIdV = new Float64Array(nV);
    for (let s = 0; s < nV; s++) {
      const v = V[s] = Vmax * s / (nV - 1); let acc = 0;
      for (let k = 0; k < nE; k++) acc += T[k] * (fermi(E[k], EF + v / 2, kT) - fermi(E[k], EF - v / 2, kT));
      I[s] = G0_SIEMENS * acc * dE;                                     // amperes (dE in eV, V in volts)
    }
    for (let s = 0; s < nV; s++) { const a = Math.max(0, s - 1), b = Math.min(nV - 1, s + 1); dIdV[s] = (I[b] - I[a]) / (V[b] - V[a]) / G0_SIEMENS; }
    // transport gap: the stretch around EF with T below 1 % of the largest value in the window
    let Tmax = 0; for (let k = 0; k < nE; k++) Tmax = Math.max(Tmax, T[k]);
    const k0 = Math.round((EF - Emin) / dE), thr = 0.01 * Tmax; let gap = 0;
    if (T[k0] < thr) { let a = k0, b = k0; while (a > 0 && T[a - 1] < thr) a--; while (b < nE - 1 && T[b + 1] < thr) b++; gap = (b - a) * dE; }
    Object.assign(out, { E, T, V, I, dIdV, gap });
  }
  out.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0; out.msEig = tEig;
  return out;
}
