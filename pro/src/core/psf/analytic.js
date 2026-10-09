// Analytic PSF models, with the widths in exp(−r²/α²) (not Gaussian σ; σ = α/√2):
//
//   double     f(r) = 1/(π(1+η))   [ e^{-r²/α²}/α² + η e^{-r²/β²}/β² ]
//   triple     f(r) = 1/(π(1+η+ν)) [ … + ν e^{-r²/γ²}/γ² ]                 mid-range Gaussian
//   gauss-exp  f(r) = 1/(1+η+ν)    [ … + ν e^{-r/γ}/(2πγ²) ]                mid-range exponential
//
// α, β, γ in nm. η and ν are the weights of the backscatter and mid-range terms relative to the
// forward term. Every model integrates to exactly 1. Two models that are not sums of Gaussians —
// power-Gaussian and spline-based — are in models2.js and become tables (settings.js tableModelPSF).

import { makePSF, logGrid, gaussAt, kernelReach } from './psf.js';
import { psfParamsFor } from '../physics/scaling.js';

export const MODELS = {
  double: { label: 'Double Gaussian', mid: null, short: 'DG' },
  triple: { label: 'Triple Gaussian', mid: 'gauss', short: 'TG' },
  'gauss-exp': { label: 'Double Gaussian + exponential', mid: 'exp', short: 'DG+exp' },
  plg: { label: 'Power-Gaussian (power-law core + Gaussian)', mid: null, short: 'PLG', table: true },
  spline: { label: 'Spline-based (tabulated)', mid: null, short: 'Spline', table: true },
};

// Without an explicit model, a γ with ν > 0 means the triple Gaussian (as before).
export function modelOf({ model = null, gamma = null, nu = 0 }) {
  if (model && MODELS[model]) return model;
  return gamma > 0 && nu > 0 ? 'triple' : 'double';
}

export function gaussianTerms(params) {
  const { alpha, beta, eta, gamma = null, nu = 0 } = params;
  if (!(alpha > 0) || !(beta > 0) || !(eta >= 0)) throw new Error('need alpha > 0, beta > 0, eta >= 0');
  const model = modelOf(params), mid = MODELS[model].mid;
  const hasMid = !!mid && gamma > 0 && nu > 0;
  const N = 1 + eta + (hasMid ? nu : 0);
  const terms = [
    { w: 1 / N, s: alpha, kind: 'gauss', label: 'forward' },
    { w: eta / N, s: beta, kind: 'gauss', label: 'backscatter' },
  ];
  if (hasMid) terms.push({ w: nu / N, s: gamma, kind: mid, label: mid === 'exp' ? 'mid-range (exponential)' : 'mid-range' });
  return terms;
}

// 100 points per decade keeps log–log interpolation of the table within ~0.4 % down to
// f = 1e-6·f(0); exposure code uses the exact terms anyway.
export function makeAnalyticPSF(params, { meta = {}, perDecade = 100 } = {}) {
  const terms = gaussianTerms(params);
  const model = modelOf(params);
  const sMin = Math.min(...terms.map((t) => t.s));
  const rMax = Math.max(...terms.map((t) => (t.kind === 'exp' ? 20 * t.s : 6 * t.s)));   // exp tail: 4e-8 left
  const r = logGrid(sMin / 200, rMax, perDecade);
  const f = r.map((x) => gaussAt(terms, x));
  const { alpha, beta, eta, gamma = null, nu = 0 } = params;
  const hasMid = terms.length > 2;
  return makePSF({
    r, f, gauss: terms,
    fit: { alpha, beta, eta, gamma: hasMid ? gamma : null, nu: hasMid ? nu : 0, model, terms, rms: 0 },
    meta: { source: 'analytic', model, ...meta },
  });
}

// From beam energy and substrate (scaling.js), e.g. makeAnalyticFor({energyKeV: 30, substrate: 'Si'}).
export function makeAnalyticFor(opts = {}) {
  const p = psfParamsFor(opts);
  return makeAnalyticPSF(p, { meta: { energyKeV: p.energyKeV, substrate: p.substrate, resistNm: p.resistNm, basis: p.source } });
}

// Pattern Studio stores α, β as Gaussian standard deviations σ (it uses
// exp(-r²/2σ²) and erfc(d/(σ√2))). As widths in exp(−r²/α²) they are √2 larger.
export function fromPPSParams({ alpha, beta, eta }) {
  return { alpha: Math.SQRT2 * alpha, beta: Math.SQRT2 * beta, eta };
}

export { kernelReach };
