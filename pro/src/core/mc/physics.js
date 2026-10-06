// Monte Carlo physics. Energies in keV, lengths in nm unless stated.
//
// Elastic scattering — screened Rutherford per element, with relativistic kinematics:
//   dσ/dΩ = (Z e²/(2 p v))² / (sin²(θ/2) + α)²,   (pv)_rel = 2E (1 + E/2mc²)/(1 + E/mc²)
//   σ_T   = 4π (Z e²/4E)² · 4((E + mc²)/(E + 2mc²))² / (α(1 + α))          [Joy's form]
//   α     = 3.4e-3 Z^0.67 / (E (1 + E/2mc²))       Nigam/Joy screening with relativistic p²
// optionally times the McKinley–Feshbach Mott factor (valid for Z ≲ 30)
//   R(θ)  = 1 − β² sin²(θ/2) + π Z α_fs β sin(θ/2)(1 − sin(θ/2)).
// The original sim-scattering.html used the non-relativistic σ (19 % low at 100 keV) and kept
// only the β² term of R.
//
// Energy loss — continuous slowing down (CSDA):
//   E ≥ 10 keV: relativistic Bethe collision stopping power for electrons (ICRU Report 37,
//               no density effect, which is < 1 % below 1 MeV for these materials)
//   E < 10 keV: Joy–Luo low-energy form, scaled to join continuously at 10 keV.
// The original used the non-relativistic Bethe formula: 22 % low in Si at 100 keV.
// Energy after a step comes from the CSDA range table, R(E) − s → E', which is exact for any
// step length (no per-step integration error).
//
// Fast secondary electrons — hybrid model (physics.secondaries, default on; added 2026-10-01
// after Peter questioned η = 0.43 at 100 keV against the measured 0.6–0.75):
//   collisions transferring W > Wc (1 keV) are events of their own, sampled from the Møller
//   cross-section of a free electron; the knocked-on electron is tracked like a primary. Only the
//   soft part, S_restricted = S − n_e ∫_Wc^{E/2} W dσ_M, is lost continuously. In CSDA the whole
//   stopping power is deposited on the track, so the forward core of the PSF is too strong:
//   δ-rays of a few keV leave almost sideways (cos θ = √(W(E+2mc²)/(E(W+2mc²)))) and carry
//   their energy 0.1–several µm away — the PSF's mid-range term.
//   dσ_M/dW = 2π r_e² mc²/β² · [1/W² + 1/(E−W)² + (τ/(τ+1))²/E² − (2τ+1)/((τ+1)² W(E−W))]

import { materialData } from './materials.js';

export const MC2 = 510.99895;            // keV
const ALPHA_FS = 1 / 137.035999;
const E2 = 1.43996448e-10;               // e²/4πε₀ in keV·cm
const SIG0 = 4 * Math.PI * (E2 / 4) ** 2; // 1.6285e-20 cm² keV²
const E_SWITCH = 10;                     // keV, Joy–Luo below, ICRU 37 above

export const beta2Of = (E) => { const g = 1 + E / MC2; return 1 - 1 / (g * g); };
const TWO_PI_RE2_MC2_NM = 2 * Math.PI * (2.8179403262e-6) ** 2 * MC2;   // nm²·keV
const NA = 6.02214076e23;
export const WCUT_DEFAULT = 1;                                          // keV

// Møller differential cross-section per target electron, nm²/keV (W ≤ E/2: the faster
// outgoing electron is called the primary).
export function mollerDCS(E, W) {
  const tau = E / MC2, b2 = beta2Of(E), g = tau + 1, Ew = E - W;
  return (TWO_PI_RE2_MC2_NM / b2) * (1 / (W * W) + 1 / (Ew * Ew) + (tau / g) ** 2 / (E * E) - (2 * tau + 1) / (g * g * W * Ew));
}
// ∫ dσ and ∫ W dσ over [Wc, E/2] (Simpson in ln W), per target electron: nm² and nm²·keV.
export function mollerIntegrals(E, Wc) {
  const Wmax = E / 2;
  if (!(Wmax > Wc)) return { sigma: 0, sigmaW: 0 };
  const n = 64, a = Math.log(Wc), h = (Math.log(Wmax) - a) / n;
  let s0 = 0, s1 = 0;
  for (let i = 0; i <= n; i++) {
    const W = Math.exp(a + i * h), c = i === 0 || i === n ? 1 : i % 2 ? 4 : 2, f = mollerDCS(E, W) * W;   // dW = W d lnW
    s0 += c * f; s1 += c * f * W;
  }
  return { sigma: (s0 * h) / 3, sigmaW: (s1 * h) / 3 };
}
// Energy transfer W ∈ [Wc, E/2] sampled from Møller: proposal ∝ 1/W², rejection on the rest.
export function sampleMoller(E, Wc, rng) {
  const tau = E / MC2, g = tau + 1, c = (tau / g) ** 2, d = (2 * tau + 1) / (g * g), ec = Wc / E;
  const gf = (e) => { const x = e / (1 - e); return 1 + x * x + c * e * e - d * x; };
  const gmax = Math.max(gf(ec), gf(0.5)) * 1.0001;
  for (;;) {
    const e = 1 / (1 / ec - rng() * (1 / ec - 2));
    if (rng() * gmax <= gf(e)) return e * E;
  }
}
// Polar angle of the knock-on electron (W) and of the primary after the collision (E − W).
export const cosKnockOn = (E, W) => Math.sqrt(Math.min(1, (W * (E + 2 * MC2)) / (E * (W + 2 * MC2))));

export function screening(Z, E, relativistic = true) { return (3.4e-3 * Math.pow(Z, 0.67)) / (E * (relativistic ? 1 + E / (2 * MC2) : 1)); }

// Total screened-Rutherford cross-section (cm²), relativistic.
export function sigmaRutherford(Z, E, relativistic = true) {
  const a = screening(Z, E, relativistic);
  const frel = relativistic ? 4 * ((E + MC2) / (E + 2 * MC2)) ** 2 : 1;
  return (SIG0 * Z * Z * frel) / (E * E * a * (1 + a));
}

// Mean of the McKinley–Feshbach factor over the screened-Rutherford distribution of
// s = sin²(θ/2), whose density is α(1+α)/(s+α)² on [0, 1]. Closed forms:
//   ⟨s⟩       = α(1+α)[ln((1+α)/α) − 1/(1+α)]
//   ⟨√s⟩      = α(1+α)·(1/√α)[atan(1/√α) − (1/√α)/(1/α + 1)]
export function mottMean(Z, E) {
  const a = screening(Z, E), b2 = beta2Of(E), kappa = Math.PI * Z * ALPHA_FS * Math.sqrt(b2);
  const sMean = a * (1 + a) * (Math.log((1 + a) / a) - 1 / (1 + a));
  const U = 1 / Math.sqrt(a);
  const sqrtMean = a * (1 + a) * U * (Math.atan(U) - U / (U * U + 1));
  return 1 - b2 * sMean + kappa * (sqrtMean - sMean);
}
export const mottKappa = (Z, E) => Math.PI * Z * ALPHA_FS * Math.sqrt(beta2Of(E));

// ---- sampling (used by the transport loop) --------------------------
// s = sin²(θ/2) from the screened Rutherford distribution (inverse CDF), accepted with the
// Mott factor 1 − β²s + κ(√s − s) when mottOn (κ = π Z α_fs β; κ = 0 keeps only the β² term).
// The factor never exceeds 1 + κ/4, which bounds the rejection.
export function sampleSin2Half(a, mottOn, kappa0, E, rng) {
  if (!mottOn) { const r1 = rng(); return (a * r1) / (1 + a - r1); }
  const g = 1 + E / MC2, b2 = 1 - 1 / (g * g), kap = kappa0 * Math.sqrt(b2), mx = 1 + 0.25 * kap;
  for (;;) {
    const r1 = rng();
    const s2 = (a * r1) / (1 + a - r1);
    if (rng() * mx <= 1 - b2 * s2 + kap * (Math.sqrt(s2) - s2)) return s2;
  }
}

// New direction after scattering by polar angle (cos ct, sin st) and a uniform azimuth, drawn
// without trigonometry (polar method). d = Float64Array [u, v, w], updated in place.
export function scatterDirection(d, ct, st, rng) {
  let pa, pb, ps;
  do { pa = 2 * rng() - 1; pb = 2 * rng() - 1; ps = pa * pa + pb * pb; } while (ps >= 1 || ps < 1e-12);
  rotateDir(d, ct, st, (pa * pa - pb * pb) / ps, (2 * pa * pb) / ps);
}
// The same rotation with a given azimuth (cos φ, sin φ) — for the two electrons of a collision.
export function rotateDir(d, ct, st, cp, sp) {
  const u = d[0], v = d[1], w = d[2];
  let nu, nv, nw;
  if (Math.abs(w) < 0.99999) {
    const sq = Math.sqrt(1 - w * w), inv = 1 / sq;
    nu = st * (u * w * cp - v * sp) * inv + u * ct;
    nv = st * (v * w * cp + u * sp) * inv + v * ct;
    nw = -st * cp * sq + w * ct;
  } else { const sg = w > 0 ? 1 : -1; nu = st * cp; nv = sg * st * sp; nw = sg * ct; }
  const nrm = 1 / Math.sqrt(nu * nu + nv * nv + nw * nw);
  d[0] = nu * nrm; d[1] = nv * nrm; d[2] = nw * nrm;
}

// ---- stopping power -------------------------------------------------------------------
// ICRU 37 collision stopping power for electrons, MeV cm²/g.
export function stoppingICRU(mat, E) {
  const tau = E / MC2, b2 = beta2Of(E), Imc = mat.I / 1000 / MC2;
  const F = 1 - b2 + ((tau * tau) / 8 - (2 * tau + 1) * Math.LN2) / ((tau + 1) * (tau + 1));
  return ((0.1535375 * mat.ZoverA) / b2) * (Math.log((tau * tau * (tau + 2)) / (2 * Imc * Imc)) + F);
}
// Joy–Luo, keV/nm (shape only; scaled to ICRU at the switch energy).
function stoppingJoyLuo(mat, E) {
  const I = mat.I / 1000, k = 0.734 * Math.pow(mat.Zmean, 0.037);
  return ((7.85e4 * mat.rho * mat.ZoverA) / E) * Math.log((1.166 * (E + k * I)) / I) * 1e-7;
}
// Stopping power in keV/nm.
export function stopping(mat, E) {
  if (E >= E_SWITCH) return stoppingICRU(mat, E) * mat.rho * 1e-4;
  const scale = (stoppingICRU(mat, E_SWITCH) * mat.rho * 1e-4) / stoppingJoyLuo(mat, E_SWITCH);
  return stoppingJoyLuo(mat, E) * scale;
}

// The original sim-scattering.html stopping power: non-relativistic Bethe with the
// Berger–Seltzer J(Z) of the mean Z (kept only to quantify its error; physics: 'legacy').
export function stoppingLegacy(mat, E) {
  const J = (9.76 * mat.Zmean + 58.5 * Math.pow(mat.Zmean, -0.19)) * 1e-3;
  const arg = (1.166 * E) / J;
  return arg > 1.01 ? ((7.85e-3 * mat.rho * mat.ZoverA) / E) * Math.log(arg) : (7.85e-3 * mat.rho * mat.ZoverA / E) * 0.00995;
}

// Physics options. Defaults are the corrected physics; each switch restores one simplification
// of the original simulator, so its effect can be measured on its own:
//   elastic   'relativistic' | 'nonrel'        cross-section and screening kinematics
//   stopping  'icru'         | 'legacy'        relativistic Bethe (ICRU 37) or the old formula
//   mott      'mf' | 'beta2' | 'none'          McKinley–Feshbach (Z ≤ 30), only its β² term, or off
//   compound  'elements'     | 'effective'     per-element scattering or one atom of mean Z
//   secondaries true | false                   hybrid model (Møller events above wcut) or pure CSDA
export const PHYSICS_DEFAULT = { elastic: 'relativistic', stopping: 'icru', mott: 'mf', compound: 'elements', secondaries: true, wcut: WCUT_DEFAULT };
export const PHYSICS_CSDA = { ...PHYSICS_DEFAULT, secondaries: false };
export const PHYSICS_LEGACY = { elastic: 'nonrel', stopping: 'legacy', mott: 'beta2', compound: 'effective', secondaries: false };

// ---- tables -----------------------------------------------------------------------------
// One log-energy grid shared by all materials of a run.
//   invLam[m][i]    1/λ_el in 1/nm (Mott-weighted when mott is on)
//   elCum[m][i·k+j] cumulative probability of scattering on element j
//   lnR[m][i]       ln of the CSDA range in nm
//   inverse: lnE as a function of lnR on a uniform lnR grid
export function buildTables(materialKeys, { E0, Ecut = 0.5, mott = true, physics = {}, NE = 2048, NI = 4096 } = {}) {
  const ph = { ...PHYSICS_DEFAULT, ...(mott ? {} : { mott: 'none' }), ...physics };
  const rel = ph.elastic === 'relativistic';
  const Elo = Math.max(0.02, Ecut * 0.5), Ehi = E0 * 1.02;
  const lnLo = Math.log(Elo), lnHi = Math.log(Ehi), dln = (lnHi - lnLo) / (NE - 1);
  const mats = materialKeys.map((k) => {
    const md0 = materialData(k);
    // 'effective': one pseudo-atom of the mean Z carrying all atoms (the old simulator's PMMA)
    const md = ph.compound === 'effective' && md0.atoms.length > 1
      ? { ...md0, atoms: [{ sym: 'eff', Z: md0.Zmean, A: 0, nDens: md0.atoms.reduce((a, t) => a + t.nDens, 0) }] }
      : md0;
    const nEl = md.atoms.length;
    const invLam = new Float64Array(NE), elCum = new Float64Array(NE * nEl), S = new Float64Array(NE);
    // hybrid: Møller event rate (1/nm) and the full stopping power (S then holds the restricted one)
    const invLamM = new Float64Array(NE), Sfull = new Float64Array(NE);
    const hybrid = !!ph.secondaries, Wc = ph.wcut || WCUT_DEFAULT;
    const ne = md.rho * NA * md.ZoverA * 1e-21;                    // electrons per nm³
    const lnR = new Float64Array(NE);
    for (let i = 0; i < NE; i++) {
      const E = Math.exp(lnLo + i * dln);
      let tot = 0;
      const part = md.atoms.map((at) => {
        const mf = ph.mott === 'mf' && at.Z <= 30 ? Math.max(0.05, mottMean(at.Z, E)) : 1;
        const v = at.nDens * sigmaRutherford(at.Z, E, rel) * mf;    // 1/cm
        tot += v;
        return v;
      });
      invLam[i] = tot * 1e-7;                                     // 1/nm
      let c = 0;
      for (let j = 0; j < nEl; j++) { c += part[j] / tot; elCum[i * nEl + j] = c; }
      elCum[i * nEl + nEl - 1] = 1;
      S[i] = ph.stopping === 'legacy' ? stoppingLegacy(md, E) : stopping(md, E);
      Sfull[i] = S[i];
      if (hybrid) {
        const mi = mollerIntegrals(E, Wc);
        invLamM[i] = ne * mi.sigma;
        S[i] = Math.max(0.15 * Sfull[i], Sfull[i] - ne * mi.sigmaW);   // soft collisions only
      }
    }
    // range: R(Elo) ≈ Elo/S(Elo), then trapezoid of E/S in ln E
    let R = Elo / S[0];
    lnR[0] = Math.log(R);
    for (let i = 1; i < NE; i++) {
      const Ea = Math.exp(lnLo + (i - 1) * dln), Eb = Math.exp(lnLo + i * dln);
      R += 0.5 * (Ea / S[i - 1] + Eb / S[i]) * dln;
      lnR[i] = Math.log(R);
    }
    // inverse table on a uniform ln R grid
    const r0 = lnR[0], r1 = lnR[NE - 1], dr = (r1 - r0) / (NI - 1);
    const invLnE = new Float64Array(NI), invE = new Float64Array(NI);
    let j = 0;
    for (let q = 0; q < NI; q++) {
      const target = r0 + q * dr;
      while (j < NE - 2 && lnR[j + 1] < target) j++;
      const t = (target - lnR[j]) / (lnR[j + 1] - lnR[j]);
      invLnE[q] = lnLo + (j + Math.max(0, Math.min(1, t))) * dln;
      invE[q] = Math.exp(invLnE[q]);              // E itself too: the transport loop then needs no exp
    }
    return {
      key: k, data: md, nEl, Z: Float64Array.from(md.atoms, (a) => a.Z),
      // per element: apply a Mott factor at all (mottOn), and its Z term (kappa0 = π Z α_fs)
      mottOn: Uint8Array.from(md.atoms, (a) => ((ph.mott === 'mf' && a.Z <= 30) || ph.mott === 'beta2' ? 1 : 0)),
      kappa0: Float64Array.from(md.atoms, (a) => (ph.mott === 'mf' && a.Z <= 30 ? Math.PI * a.Z * ALPHA_FS : 0)),
      relScreen: rel,
      invLam, elCum, S, lnR, invLnE, invE, r0, dr, NI,
      invLamM, Sfull, hybrid, wcut: Wc,
    };
  });
  return { Elo, Ehi, lnLo, dln, NE, mats, Ecut, mott, physics: ph };
}

// Range (nm) and inverse, by interpolation in the tables.
export function rangeOf(tbl, m, E) {
  const u = (Math.log(E) - tbl.lnLo) / tbl.dln;
  const i = Math.max(0, Math.min(tbl.NE - 2, Math.floor(u))), f = u - i;
  return Math.exp(m.lnR[i] + f * (m.lnR[i + 1] - m.lnR[i]));
}
export function energyAtRange(m, R) {
  if (!(R > 0)) return 0;
  const u = (Math.log(R) - m.r0) / m.dr;
  if (u <= 0) return Math.exp(m.invLnE[0]) * Math.max(0, R / Math.exp(m.r0));
  const i = Math.min(m.NI - 2, Math.floor(u)), f = Math.min(1, u - i);
  return Math.exp(m.invLnE[i] + f * (m.invLnE[i + 1] - m.invLnE[i]));
}
