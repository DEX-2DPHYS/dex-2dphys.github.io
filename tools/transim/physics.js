/* physics.js — shared constants, unit conversions and graphene relations.
 * Loaded as a plain script (no modules) so the app works from file:// too.
 * Everything internal is SI. UI-facing units are converted at the edges.
 */
(function (global) {
  "use strict";

  const PHYS = {
    e: 1.602176634e-19, // C
    h: 6.62607015e-34, // J s
    hbar: 6.62607015e-34 / (2 * Math.PI),
    vF: 1.0e6, // m/s, graphene Fermi velocity
  };

  // --- unit conversions (UI <-> SI) ---------------------------------------
  const U = {
    umToM: (x) => x * 1e-6,
    mToUm: (x) => x * 1e6,
    nmToM: (x) => x * 1e-9,
    mToNm: (x) => x * 1e9,
    cm2ToM2: (x) => x * 1e4, // areal density cm^-2 -> m^-2  (1 cm^-2 = 1e4 m^-2)
    m2ToCm2: (x) => x * 1e-4,
    mobCmToSI: (x) => x * 1e-4, // cm^2/Vs -> m^2/Vs
    mobSIToCm: (x) => x * 1e4,
  };

  // --- graphene relations (SI in/out) -------------------------------------
  // Fermi wavevector from areal carrier density n (m^-2): kF = sqrt(pi |n|)
  function fermiWavevector(n_m2) {
    return Math.sqrt(Math.PI * Math.abs(n_m2));
  }

  // Sheet conductivity sigma0 = e |n| mu  (S/sq)
  function sheetConductivity(n_m2, mu_SI) {
    return PHYS.e * Math.abs(n_m2) * mu_SI;
  }

  // Cyclotron radius rc = hbar kF / (e B)  (m). Returns Infinity at B=0.
  function cyclotronRadius(n_m2, B) {
    if (!B) return Infinity;
    return (PHYS.hbar * fermiWavevector(n_m2)) / (PHYS.e * Math.abs(B));
  }

  // Mean free path from mobility & density: l = hbar mu sqrt(pi |n|) / e  (m)
  function mfpFromMobility(mu_SI, n_m2) {
    return (PHYS.hbar * mu_SI * fermiWavevector(n_m2)) / PHYS.e;
  }

  // Number of conducting modes across a contact of width W: M ~ W kF / pi
  function modeCount(W_m, n_m2) {
    return Math.max(1, (W_m * fermiWavevector(n_m2)) / Math.PI);
  }

  // Conductance quantum-scale prefactor (S): G ~ (4 e^2 / h) M T
  function conductanceQuantum() {
    return (4 * PHYS.e * PHYS.e) / PHYS.h;
  }

  global.GT = global.GT || {};
  global.GT.PHYS = PHYS;
  global.GT.U = U;
  global.GT.phys = {
    fermiWavevector,
    sheetConductivity,
    cyclotronRadius,
    mfpFromMobility,
    modeCount,
    conductanceQuantum,
  };
})(typeof window !== "undefined" ? window : globalThis);
