// Moving a contrast curve from the conditions it was measured at to the ones it is used at, with the
// resist library's model — for Fab Studio (the develop step, its hint, the spin step's preview). The
// curve itself (the library's, or the user's own from the spin step) is kept; only the change is
// taken from the model:
//
//   D100' = D100 · m(to) / m(from),   γ' = γ · g(to) / g(from)
//
// where m, g are the library model's (no datasets: pure laws and developer factors, so the ratio is the
// model's alone). A curve's conditions are five: kV, film thickness, developer, time, temperature. The
// result carries the regime of the new conditions — inside the process window or extrapolated — and
// the uncertainty the move adds.

import { BUILTIN_RESISTS } from './builtin.js';
import { predict, REGIME_TEXT, TOL } from './model.js';
import { calibrationOf, devDeviation } from '../physics/devcal.js';

const LIB = Object.fromEntries(BUILTIN_RESISTS.map((r) => [r.id, { ...r, datasets: [] }]));
export const libraryEntry = (id) => LIB[id] || null;

// curve {D100, gamma}; from / to {kV, thicknessNm, developer, timeS, tempC} → null (no model) or
// { D100, gamma, factor, gammaFactor, regime, regimeText, excursions, pm (± % on D100), unsupported }
export function moveCurve(libId, curve, from, to) {
  const e = LIB[libId];
  if (!e) return null;
  const R = e.model.ref, full = (c) => ({ ...Object.fromEntries((e.model.extra || []).map((x) => [x.key, c[x.key] ?? R[x.key]])), kV: c.kV || R.kV, thicknessNm: c.thicknessNm || R.thicknessNm, developer: c.developer || R.developer, timeS: c.timeS || R.timeS, tempC: c.tempC ?? R.tempC });
  const at = predict(e, full(to)), was = predict(e, full(from));
  const r0 = e.model.refUncertainty ?? 0.35;
  const unsupported = at.regime === 'unsupported' || was.regime === 'unsupported';
  const factor = unsupported ? 1 : at.D100 / was.D100, gf = unsupported ? 1 : at.gamma / was.gamma;
  const sigma = Math.sqrt(Math.max(0, at.sigmaLn ** 2 - r0 ** 2) + Math.max(0, was.sigmaLn ** 2 - r0 ** 2)) || 0;
  const regime = unsupported ? 'unsupported' : at.regime;
  return { D100: curve.D100 * factor, gamma: Math.max(0.5, curve.gamma * gf), factor, gammaFactor: gf, regime, regimeText: REGIME_TEXT[regime],
    excursions: at.excursions, pm: Math.round(100 * (Math.exp(unsupported ? Math.max(sigma, 0.7) : sigma) - 1)), unsupported };
}

// The studio's calibration warning says the curve is kept unchanged — not true for a library resist,
// whose curve the model moves: keep only the part that says what differs.
export const trimCalText = (text) => String(text || '').replace(/\s*The model keeps[\s\S]*$/, '');

// one line for messages and hints
export function describeMove(mv) {
  if (!mv) return '';
  if (mv.unsupported) return 'the resist library has no model for this developer with this resist: the curve is used unchanged — UNSUPPORTED, very uncertain';
  const what = `the resist library's model moves the curve: D₁₀₀ × ${mv.factor.toFixed(2)}, γ × ${mv.gammaFactor.toFixed(2)}, ±${mv.pm} %`;
  return mv.regime === 'extrapolated' ? `${what} — EXTRAPOLATED: ${mv.excursions.join('; ')}` : `${what} — inside the process window`;
}

// A resist on the sample (its spin step's devParams), developed with dev {developer, timeS, tempC} after
// an exposure at kV: how far is that from the curve's own conditions, and — for a library resist — the
// moved curve. preset: the resist's preset (its calibration and its library id, if the spin step has none).
// → { cal, calibration: devDeviation (developer/time/temperature), other: [text] (thickness, kV),
//     outside, from, to, lib, move }
export function developConditions(dp, preset, dev, kV) {
  const lib = dp.lib || preset?.lib || null, e = lib ? LIB[lib] : null;
  const cal = calibrationOf(dp, preset);
  const calibration = devDeviation(cal, dev);
  const other = [];
  let from = null, to = null, move = null;
  if (e) {
    from = { developer: cal.developer, timeS: cal.timeS, tempC: cal.tempC ?? 21, thicknessNm: dp.calThicknessNm || preset?.thicknessNm || dp.resistThick, kV: dp.calKV || preset?.calKV || e.model.ref.kV };
    to = { developer: dev.developer, timeS: dev.timeS, tempC: dev.tempC ?? 21, thicknessNm: dp.resistThick || from.thicknessNm, kV: kV || from.kV };
    if (Math.abs(to.thicknessNm / from.thicknessNm - 1) > TOL.thicknessRel) other.push(`a ${Math.round(to.thicknessNm)} nm film instead of ${Math.round(from.thicknessNm)} nm`);
    if (Math.abs(to.kV / from.kV - 1) > TOL.kVRel) other.push(`exposed at ${to.kV} kV instead of ${from.kV} kV`);
    for (const x of e.model.extra || []) {
      from[x.key] = dp.calExtras?.[x.key] ?? e.model.ref[x.key]; to[x.key] = dp.extras?.[x.key] ?? from[x.key];
      if (Math.abs(to[x.key] - from[x.key]) > (x.tol ?? 0)) other.push(`${x.short || x.name} ${to[x.key]} ${x.unit} instead of ${from[x.key]} ${x.unit}`);
    }
    if (calibration.outside || other.length) move = moveCurve(lib, { D100: dp.D100 || 120, gamma: dp.contrast || 3 }, from, to);
  }
  return { cal, calibration, other, outside: calibration.outside || other.length > 0, from, to, lib, move };
}
