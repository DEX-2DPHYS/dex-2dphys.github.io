// Materials for the Monte Carlo: real compositions (not an "effective Z"), densities, and mean
// excitation energies I. Elastic scattering is computed per element (σ ∝ Z², so averaging Z
// first is wrong: PMMA's mean Z of 3.6 underestimates its elastic cross-section by ~38 %).
//
// I-values (eV): ICRU Report 37 / NIST ESTAR for elements and for the listed compounds; other
// compounds use Bragg additivity of the elemental values (ln I weighted by Z/A).

export const ELEMENTS = {
  H: { Z: 1, A: 1.008, I: 19.2 },
  C: { Z: 6, A: 12.011, I: 78.0 },
  N: { Z: 7, A: 14.007, I: 82.0 },
  O: { Z: 8, A: 15.999, I: 95.0 },
  Al: { Z: 13, A: 26.982, I: 166.0 },
  Si: { Z: 14, A: 28.086, I: 173.0 },
  P: { Z: 15, A: 30.974, I: 173.0 },
  Cl: { Z: 17, A: 35.453, I: 174.0 },
  Ti: { Z: 22, A: 47.867, I: 233.0 },
  Cr: { Z: 24, A: 51.996, I: 257.0 },
  Cu: { Z: 29, A: 63.546, I: 322.0 },
  Ga: { Z: 31, A: 69.723, I: 334.0 },
  Ge: { Z: 32, A: 72.630, I: 350.0 },
  As: { Z: 33, A: 74.922, I: 347.0 },
  In: { Z: 49, A: 114.818, I: 488.0 },
  Au: { Z: 79, A: 196.967, I: 790.0 },
};

// atoms per formula unit, density g/cm³, I (eV) when tabulated for the compound
export const MATERIALS = {
  PMMA: { name: 'PMMA', formula: { C: 5, H: 8, O: 2 }, rho: 1.19, I: 74.0, resist: true },
  HSQ: { name: 'HSQ (cured, HSiO₁.₅)', formula: { H: 1, Si: 1, O: 1.5 }, rho: 1.4, resist: true },
  // CSAR 62 (AR-P 6200): 1:1 copolymer of α-methylstyrene C9H10 and methyl α-chloroacrylate C4H5ClO2;
  // density as for ZEP (≈ 1.18 g/cm³, not published by Allresist); I by Bragg additivity
  CSAR: { name: 'CSAR 62', formula: { C: 13, H: 15, Cl: 1, O: 2 }, rho: 1.18, resist: true },
  Si: { name: 'Si', formula: { Si: 1 }, rho: 2.33, I: 173.0 },
  SiO2: { name: 'SiO₂', formula: { Si: 1, O: 2 }, rho: 2.20, I: 139.2 },
  Si3N4: { name: 'Si₃N₄', formula: { Si: 3, N: 4 }, rho: 3.17 },
  GaAs: { name: 'GaAs', formula: { Ga: 1, As: 1 }, rho: 5.32, I: 384.9 },
  InP: { name: 'InP', formula: { In: 1, P: 1 }, rho: 4.81 },
  Ge: { name: 'Ge', formula: { Ge: 1 }, rho: 5.32, I: 350.0 },
  C: { name: 'C (graphite)', formula: { C: 1 }, rho: 2.26, I: 78.0 },
  Al: { name: 'Al', formula: { Al: 1 }, rho: 2.70, I: 166.0 },
  Cr: { name: 'Cr', formula: { Cr: 1 }, rho: 7.19, I: 257.0 },
  Cu: { name: 'Cu', formula: { Cu: 1 }, rho: 8.96, I: 322.0 },
  Ti: { name: 'Ti', formula: { Ti: 1 }, rho: 4.51, I: 233.0 },
  Au: { name: 'Au', formula: { Au: 1 }, rho: 19.32, I: 790.0 },
  H2O: { name: 'water (test material)', formula: { H: 2, O: 1 }, rho: 1.0, I: 75.0, hidden: true },
};

const NA = 6.02214076e23;

// Derived quantities: per-element number densities (atoms/cm³), Z/A of the mixture, I.
export function materialData(key) {
  const m = MATERIALS[key];
  if (!m) throw new Error(`unknown material ${key}`);
  const els = Object.entries(m.formula).map(([sym, n]) => ({ sym, n, ...ELEMENTS[sym] }));
  const M = els.reduce((a, e) => a + e.n * e.A, 0);                     // g/mol of the formula unit
  const atoms = els.map((e) => ({ sym: e.sym, Z: e.Z, A: e.A, nDens: (NA * m.rho * e.n) / M }));
  const ZoverA = els.reduce((a, e) => a + (e.n * e.Z) / M, 0);           // electrons per gram / N_A
  let I = m.I;
  if (!I) {                                                              // Bragg additivity
    const zw = els.reduce((a, e) => a + e.n * e.Z, 0);
    I = Math.exp(els.reduce((a, e) => a + ((e.n * e.Z) / zw) * Math.log(e.I), 0));
  }
  return { key, name: m.name, rho: m.rho, atoms, ZoverA, I, Zmean: els.reduce((a, e) => a + e.n * e.Z, 0) / els.reduce((a, e) => a + e.n, 0) };
}
