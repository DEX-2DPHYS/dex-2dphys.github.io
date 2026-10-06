// Energy and material scaling of the double-Gaussian PSF parameters.
//
// Convention (notes Eq. 2.16, Chang):  f(r) = 1/(π(1+η)) [ e^{-r²/α²}/α² + η e^{-r²/β²}/β² ]
// so α and β here are the notes' a and b, NOT Gaussian standard deviations (σ = α/√2).
//
// Sources, all from the 10855 notes:
//   β, η      Figure 17 (fig17_v2.png): Owen (1990), Boere et al. (1990), Rishton and Kern (1987)
//   forward   Eq. 2.17   d = 0.9 (h/E)^1.5          h resist thickness in nm, E in keV, d in nm
//   floor     text below Eq. 2.16: secondary-electron limit d_α = 5–10 nm
//   Grün      Eq. 2.18   R_G = 2.6e-13/ρ · E^1.75    E in eV, R_G in m, ρ in g/cm³
//   dose      Eq. 3.1    D_c ∝ E^a, a = 0.75
//
// Owen's three Si points (20, 50, 100 kV → 2.0, 9.5, 31.2 µm) follow β ∝ E^1.70–1.72, i.e. the
// Grün-range exponent, so 1.7 is used to extrapolate outside the tabulated energies.

export const BETA_ENERGY_EXPONENT = 1.7;
export const DOSE_ENERGY_EXPONENT = 0.75;
export const ALPHA_MIN_NM_DEFAULT = 8;      // within the notes' 5–10 nm; equals PPS's 100 kV value

// points: tabulated (E keV, β µm, η). `use` marks the series used for interpolation; the rest
// are kept for display ("other references give ...").
export const SUBSTRATES = {
  Si: {
    name: 'Si', rho: 2.33, Z: 14,
    etaDefault: 0.7,   // notes §2: "For silicon, η can be taken as 0.7, independent of energy"
    points: [
      { E: 20,  betaUm: 2.0,  eta: 0.74, ref: 'Owen (1990)', use: true },
      { E: 50,  betaUm: 9.5,  eta: 0.74, ref: 'Owen (1990)', use: true },
      { E: 100, betaUm: 31.2, eta: 0.74, ref: 'Owen (1990)', use: true },
      { E: 50,  betaUm: 10.2, eta: 0.51, ref: 'Boere et al. (1990)' },
      { E: 50,  betaUm: 8.8,  eta: 0.75, ref: 'Rishton and Kern (1987)' },
    ],
  },
  GaAs: {
    name: 'GaAs', rho: 5.32, Z: 32,
    etaDefault: 0.88,
    points: [
      { E: 50,  betaUm: 3.9,  eta: 0.88, ref: 'Boere et al. (1990)', use: true },
      { E: 100, betaUm: 11.1, eta: 0.89, ref: 'Boere et al. (1990)', use: true },
      { E: 50,  betaUm: 3.28, eta: 1.07, ref: 'Rishton and Kern (1987)' },
    ],
  },
  InP: {
    name: 'InP', rho: 4.81, Z: 32,
    etaDefault: 0.99,
    points: [{ E: 50, betaUm: 4.1, eta: 0.99, ref: 'Boere et al. (1990)', use: true }],
  },
  C: {
    name: 'C', rho: 2.26, Z: 6,
    etaDefault: 0.19,
    points: [{ E: 50, betaUm: 17.5, eta: 0.19, ref: 'Boere et al. (1990)', use: true }],
  },
};

function substrateOf(name) {
  const s = SUBSTRATES[name];
  if (!s) throw new Error(`unknown substrate "${name}" (known: ${Object.keys(SUBSTRATES).join(', ')})`);
  return s;
}

// β in nm at energy E (keV). Log–log interpolation between the tabulated points of the
// reference series; outside them, β ∝ E^1.7 from the nearest point.
export function betaNm(energyKeV, substrate = 'Si') {
  const pts = substrateOf(substrate).points.filter((p) => p.use).sort((a, b) => a.E - b.E);
  const E = energyKeV;
  let um;
  if (E <= pts[0].E) {
    um = pts[0].betaUm * Math.pow(E / pts[0].E, BETA_ENERGY_EXPONENT);
  } else if (E >= pts[pts.length - 1].E) {
    const p = pts[pts.length - 1];
    um = p.betaUm * Math.pow(E / p.E, BETA_ENERGY_EXPONENT);
  } else {
    let i = 0;
    while (pts[i + 1].E < E) i++;
    const a = pts[i], b = pts[i + 1];
    const t = Math.log(E / a.E) / Math.log(b.E / a.E);
    um = Math.exp(Math.log(a.betaUm) + t * Math.log(b.betaUm / a.betaUm));
  }
  return um * 1000;
}

export function etaDefault(substrate = 'Si') {
  return substrateOf(substrate).etaDefault;
}

// Forward-scatter broadening, notes Eq. 2.17 (nm).
export function forwardBroadeningNm(resistNm, energyKeV) {
  return 0.9 * Math.pow(resistNm / energyKeV, 1.5);
}

// α combines the secondary-electron / beam floor with the forward broadening in quadrature.
export function alphaNm(energyKeV, resistNm = 100, alphaMinNm = ALPHA_MIN_NM_DEFAULT) {
  const d = forwardBroadeningNm(resistNm, energyKeV);
  return Math.sqrt(alphaMinNm * alphaMinNm + d * d);
}

// Grün range, notes Eq. 2.18, returned in nm.
export function grunRangeNm(energyKeV, rho) {
  const m = (2.6e-13 / rho) * Math.pow(energyKeV * 1000, 1.75);
  return m * 1e9;
}

// Clearing / critical dose at another energy, notes Eq. 3.1.
export function scaleDoseToEnergy(dose, fromKeV, toKeV, a = DOSE_ENERGY_EXPONENT) {
  return dose * Math.pow(toKeV / fromKeV, a);
}

// Everything the analytic PSF needs, with the provenance shown in the UI.
export function psfParamsFor({
  energyKeV = 100, substrate = 'Si', resistNm = 100,
  alphaMinNm = ALPHA_MIN_NM_DEFAULT, eta,
} = {}) {
  return {
    alpha: alphaNm(energyKeV, resistNm, alphaMinNm),
    beta: betaNm(energyKeV, substrate),
    eta: eta ?? etaDefault(substrate),
    energyKeV, substrate, resistNm, alphaMinNm,
    source: `notes Fig. 17 (${substrate}), Eq. 2.17, α floor ${alphaMinNm} nm`,
  };
}
