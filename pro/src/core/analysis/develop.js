// Will it print — with the whole resist, not just its clearing dose. Along a probe, the developed
// resist is read off the contrast curve point by point, as Fab Studio develops each column:
//
//   remaining(x) = T · t(B · p(x))       t: the contrast curve (D₀, D₁₀₀, γ, rounding, scum tail)
//   minus the dark erosion of the development (rate × time) where nothing developed.
//
// So the bottom width — where the resist clears to the substrate — depends on the dose at which the
// curve reaches zero (clearingDose: D₁₀₀, or above it for a rounded curve), and γ, the
// thickness and the development decide everything around it: how far the top opens (the walls), how
// much resist is left between openings, whether scum stays in the opening. The verdict weighs these.
//
// The model is one-dimensional per column (no lateral dissolution, no undercut, no swelling or
// collapse mechanics). It is as good as the contrast curve, and the curve only holds for the
// development it was measured with (physics/devcal.js).

import { makeResist, remainingFraction } from '../physics/resist.js';
import { cdAt } from './cd.js';

// resist settings → resist model: { D100, gamma, round, tone, scumNm, thicknessNm }
export const resistModel = (r) => makeResist({ D100: r.D100, gamma: r.gamma, round: r.round || 0, tone: r.tone || 'positive', scumNm: r.scumNm || 0, thicknessNm: r.thicknessNm || 100 });

// The dose at which the curve itself is done: a positive resist fully cleared (≤ epsNm left, scum
// aside — that is residue for a descum), a negative one at full height (within epsNm). With a rounded
// curve this is above D₁₀₀ (100 % rounding: about 1.27 × D₁₀₀ at γ 7, 2 × at γ 2.5); without rounding it
// is D₁₀₀. Every width in the Analysis tab is read at this dose, so it agrees with Fab Studio's develop.
export function clearingDose(R, epsNm = null) {
  const T = R.thicknessNm, eps = (epsNm ?? Math.max(0.5, 0.005 * T)) / T, bare = { ...R, scumNm: 0 };
  const done = (D) => (R.tone === 'negative' ? remainingFraction(bare, D) >= 1 - eps : remainingFraction(bare, D) <= eps);
  let lo = R.D100 * 0.5, hi = R.D100 * 8;
  if (done(lo)) return R.D100;
  for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (done(m)) hi = m; else lo = m; }
  return hi;
}

// remaining resist (nm) along the probe at base dose B; darkLossNm: dark erosion of the development
export function developedProfile(prof, B, R, darkLossNm = 0) {
  const T = R.thicknessNm, out = new Float64Array(prof.length);
  for (let i = 0; i < prof.length; i++) {
    const t = remainingFraction(R, B * prof[i]);
    // Fab Studio's rule: dark erosion only where nothing developed (an unexposed or untouched column)
    out[i] = R.tone === 'negative' ? T * t : (t >= 0.999 ? Math.max(0, T * t - darkLossNm) : T * t);
  }
  return out;
}

// a run of samples where f(i) holds, around index k (or empty)
function runAround(s, ok, k) {
  if (k < 0 || !ok(k)) return null;
  let i0 = k; while (i0 > 0 && ok(i0 - 1)) i0--;
  let i1 = k; while (i1 < s.length - 1 && ok(i1 + 1)) i1++;
  return { i0, i1, left: s[i0], right: s[i1], width: s[i1] - s[i0] };
}
const indexAt = (s, x) => { let k = 0; while (k < s.length - 1 && s[k + 1] <= x) k++; return Math.abs(s[k + 1] - x) < Math.abs(s[k] - x) ? k + 1 : k; };

// From the edge of a run outwards, the first maximum (positive resist: the resist ridge beside the
// opening) or minimum (negative: the residue in the space beside the line).
function nextExtremum(rem, from, step, wantMax) {
  let i = from, best = rem[i];
  while (i + step >= 0 && i + step < rem.length) {
    const v = rem[i + step];
    if (wantMax ? v < best - 1e-9 : v > best + 1e-9) return { value: best, atEnd: false };
    if (wantMax ? v > best : v < best) best = v;
    i += step;
  }
  return { value: best, atEnd: true };
}

// The verdict for one probe at base dose B.
// in:  { s, prof, ref, others, target, tol (fraction), B, resist (settings), darkLossNm, outsideCalibration }
// out: { level: 'ok'|'warn'|'fail', reasons: [text], width, err, topWidth, wallNm, ridgeNm, residueNm, rem, R }
export function judge({ s, prof, ref, others, target, tol, B, resist, darkLossNm = 0, outsideCalibration = false }) {
  const R = resistModel(resist), T = R.thicknessNm, neg = R.tone === 'negative';
  const rem = developedProfile(prof, B, R, darkLossNm);
  const Dc = clearingDose(R);
  const at = cdAt(s, prof, B, Dc, ref, others);                      // fully cleared (pos.) / full height (neg.)
  const clearNm = Math.max(0.5, 0.005 * T);
  const reasons = [];
  let level = 'ok';
  const worse = (l) => { if (l === 'fail' || (l === 'warn' && level === 'ok')) level = l; };
  const out = { clearingDose: Dc, width: at.cd, err: target && at.cd > 0 ? (at.cd - target) / target : null, rem, R, clearNm, topWidth: null, wallNm: null, ridgeNm: null, residueNm: null };
  if (!(at.cd > 0)) {
    worse('fail'); reasons.push(neg ? 'the line does not reach full height anywhere: under-exposed' : 'the resist does not clear to the substrate: under-exposed');
  } else if (at.merged) {
    worse('fail'); reasons.push(neg ? 'the line merges with its neighbour' : 'the opening merges with its neighbour: the resist between them is gone');
  } else if (at.openL || at.openR) {
    worse('fail'); reasons.push(`the ${neg ? 'line' : 'opening'} reaches the end of the probe: it merges with a neighbour, or the probe is too short — draw it longer, across the feature, to tell`);
  } else {
    const k = indexAt(s, (at.left + at.right) / 2);
    if (!neg) {
      // the top of the opening: wherever the resist is thinner than the untouched film
      const topOk = (i) => rem[i] < 0.98 * (T - darkLossNm);
      const top = runAround(s, topOk, k);
      out.topWidth = top ? top.width : at.cd; out.wallNm = Math.max(0, (out.topWidth - at.cd) / 2);
      const L = nextExtremum(rem, top ? top.i0 : k, -1, true), Rr = nextExtremum(rem, top ? top.i1 : k, +1, true);
      out.ridgeNm = Math.min(L.value, Rr.value);
      out.residueNm = rem[k];                                         // what is left at the middle of the opening
      if (out.residueNm > clearNm) { worse('warn'); reasons.push(`${out.residueNm.toFixed(1)} nm of resist (scum) left in the middle of the opening: descum before metal or etching`); }
      if (out.ridgeNm < 0.2 * T) { worse('fail'); reasons.push(`the resist beside the opening thins to ${out.ridgeNm.toFixed(0)} nm of ${T} nm: nothing left to mask or lift off`); }
      else if (out.ridgeNm < 0.6 * T) { worse('warn'); reasons.push(`the resist beside the opening thins to ${out.ridgeNm.toFixed(0)} nm of ${T} nm (partly developed by the neighbours' dose): thin walls, risky for lift-off and collapse`); }
      if (out.wallNm > Math.max(0.25 * at.cd, 0.5 * T)) { worse('warn'); reasons.push(`the top opens ${out.wallNm.toFixed(0)} nm wider on each side than the bottom: shallow walls (low contrast for this dose spread)`); }
    } else {
      const footOk = (i) => rem[i] > clearNm;
      const foot = runAround(s, footOk, k);
      out.topWidth = at.cd; out.wallNm = foot ? Math.max(0, (foot.width - at.cd) / 2) : 0;
      out.ridgeNm = rem[k];                                           // the line's height
      const L = nextExtremum(rem, foot ? foot.i0 : k, -1, false), Rr = nextExtremum(rem, foot ? foot.i1 : k, +1, false);
      out.residueNm = Math.max(L.value, Rr.value);                     // resist left in the spaces beside it
      if (out.residueNm > clearNm) { worse(out.residueNm > 0.2 * T ? 'fail' : 'warn'); reasons.push(`${out.residueNm.toFixed(1)} nm of resist left in the space beside the line (partly exposed by the neighbours' dose)`); }
      if (out.wallNm > Math.max(0.25 * at.cd, 0.5 * T)) { worse('warn'); reasons.push(`the foot spreads ${out.wallNm.toFixed(0)} nm beyond the full-height width on each side`); }
    }
    if (out.err != null && Math.abs(out.err) > tol) { worse('warn'); reasons.push(`${out.err > 0 ? 'wider' : 'narrower'} than the target by ${(100 * Math.abs(out.err)).toFixed(1)} % (tolerance ${(100 * tol).toFixed(0)} %)`); }
  }
  if (outsideCalibration) { worse('warn'); reasons.push('the development is outside the contrast curve\'s calibration: uncertain'); }
  if (level === 'ok') reasons.push(neg ? 'the line stands at full height, to size, with clean spaces' : 'clears to the substrate, to size, with enough resist around it');
  return { ...out, level, reasons };
}
