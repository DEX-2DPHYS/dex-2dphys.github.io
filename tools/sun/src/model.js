// A compact standard-solar-model profile. Rounded values after published standard solar models
// (Christensen-Dalsgaard et al. 1996 "Model S"; Bahcall, Serenelli & Basu 2005), good to a few
// per cent - enough for a textbook readout, not for research.
// Columns: r [R☉], T [K], ρ [g cm⁻³], m = M(r)/M☉, l = L(r)/L☉
// The cut-face shader, the hover readout and the textbook charts all read this one table.
export const SSM = [
  [0.000, 1.57e7, 152,    0.000, 0.00],
  [0.050, 1.50e7, 125,    0.011, 0.10],
  [0.100, 1.36e7, 86,     0.074, 0.44],
  [0.150, 1.17e7, 54,     0.18,  0.77],
  [0.200, 9.9e6,  33,     0.34,  0.94],
  [0.250, 8.4e6,  19,     0.49,  0.99],
  [0.300, 7.1e6,  11,     0.61,  1.00],
  [0.400, 5.4e6,  3.9,    0.79,  1.00],
  [0.500, 4.3e6,  1.3,    0.89,  1.00],
  [0.600, 3.4e6,  0.45,   0.95,  1.00],
  [0.700, 2.4e6,  0.20,   0.98,  1.00],
  [0.713, 2.2e6,  0.18,   0.98,  1.00],
  [0.800, 1.4e6,  0.090,  0.99,  1.00],
  [0.900, 6.5e5,  0.029,  0.998, 1.00],
  [0.950, 3.3e5,  0.010,  0.9995, 1.00],
  [0.980, 1.3e5,  2.6e-3, 1.000, 1.00],
  [0.990, 6.5e4,  9.0e-4, 1.000, 1.00],
  [0.995, 3.5e4,  3.0e-4, 1.000, 1.00],
  [1.000, 5772,   2.5e-7, 1.000, 1.00],
];

export const R_CORE = 0.25, R_CZ = 0.713;

// log-linear interpolation in r (T and ρ span ten decades, so interpolate their logarithms)
export function ssmAt(r) {
  r = Math.max(0, Math.min(1, r));
  let i = 0;
  while (i < SSM.length - 2 && SSM[i + 1][0] < r) i++;
  const a = SSM[i], b = SSM[i + 1];
  const u = (r - a[0]) / (b[0] - a[0]);
  const lg = (k) => Math.pow(10, Math.log10(a[k]) + u * (Math.log10(b[k]) - Math.log10(a[k])));
  const ln = (k) => a[k] + u * (b[k] - a[k]);
  const T = lg(1), rho = lg(2);
  // ideal gas, fully ionised; mean molecular weight rises in the core where hydrogen is spent
  const mu = r < 0.3 ? 0.85 - 0.24 * (r / 0.3) : 0.61;
  const P = (rho * 1e3) * 1.380649e-23 * T / (mu * 1.66054e-27);
  return { T, rho, m: ln(3), l: ln(4), P, mu };
}

export function zoneOf(r) {
  if (r < R_CORE) return 'core';
  if (r < 0.69) return 'radiative';
  if (r < 0.735) return 'tachocline';
  if (r < 0.998) return 'convection';
  return 'photosphere';
}

// For the shader: the table as flat float arrays
export const SSM_R = SSM.map((s) => s[0]);
export const SSM_LOGT = SSM.map((s) => Math.log10(s[1]));
export const SSM_LOGRHO = SSM.map((s) => Math.log10(s[2]));

// Baumbach-Allen electron density of the quiet corona, ρ in R☉ from Sun centre, n_e in cm⁻³
export const coronaNe = (p) => 1e8 * (2.99 * Math.pow(p, -16) + 1.55 * Math.pow(p, -6) + 0.036 * Math.pow(p, -1.5));

// Differential rotation of the surface (Snodgrass & Ulrich 1990), sidereal, degrees per day
export const omegaDeg = (latDeg) => {
  const s2 = Math.sin(latDeg * Math.PI / 180) ** 2;
  return 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
};

// Isothermal Parker wind: speed (km/s) at r (R☉) for coronal temperature T (K)
export function parkerV(r, T) {
  const cs = Math.sqrt(2 * 1.380649e-23 * T / 1.67262e-27);   // electron-proton plasma
  const rc = 1.32712e20 / (2 * cs * cs) / 6.957e8;             // critical radius in R☉
  const rhs = 4 * Math.log(r / rc) + 4 * rc / r - 3;
  const f = (u) => u * u - Math.log(u * u);
  let lo, hi;
  if (r < rc) { lo = 1e-6; hi = 1; } else { lo = 1; hi = 40; }
  for (let k = 0; k < 80; k++) {
    const mid = 0.5 * (lo + hi);
    const above = f(mid) > rhs;
    // below rc f decreases with u, above rc it increases
    if (r < rc ? above : !above) lo = mid; else hi = mid;
  }
  return { v: 0.5 * (lo + hi) * cs / 1e3, rc, cs: cs / 1e3 };
}
