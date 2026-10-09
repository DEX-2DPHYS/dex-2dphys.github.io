// Resist contrast curve. One parameterisation for the whole Workbench:
//
//   D0    onset dose (resist starts to thin)
//   D100  clearing dose (positive) / saturation dose (negative)
//   γ     contrast, γ = 1 / log10(D100/D0)
//
// Remaining fraction for a positive resist: t = 1 − γ·log10(D/D0), clamped to [0, 1].
// This is exactly the curve in both existing sims:
//   MNS v2 doDevelop       D0 = D100·10^(−1/γ), plus a scum tail and negative-tone inversion
//   EBL Development sim    Dtop = Dc/10^(1/γ) (so Dc ≡ D100, Dtop ≡ D0), plus an optional
//                          smoothstep blend ("smoothing", 0 = linear)
//
// `round` (0..1) rounds the two kinks at D0 and D100 WITHOUT changing γ: the curve becomes a
// difference of two softplus corners, rescaled so the tangent at D50 keeps slope γ and still
// meets 1 and 0 at exactly D0 and D100. round = 0 is the piecewise curve bit for bit.

import { scaleDoseToEnergy } from './scaling.js';

export function makeResist({
  D100, gamma, tone = 'positive', scumNm = 0, thicknessNm = 100, smooth = 0, round = 0, name = 'custom',
  energyKeV = null,
} = {}) {
  if (!(D100 > 0) || !(gamma > 0)) throw new Error('resist needs D100 > 0 and gamma > 0');
  return { name, D100, gamma, D0: D100 * Math.pow(10, -1 / gamma), tone, scumNm, thicknessNm, smooth, round, energyKeV };
}

// EBL Development simulator parameters (Dc, γ) → resist.
export const fromDcGamma = (Dc, gamma, extra = {}) => makeResist({ D100: Dc, gamma, ...extra });

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smoothstep01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const softplus = (x) => (x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x)));

// Remaining fraction on the normalised dose axis u (0 at D0, 1 at D100) with the two kinks
// rounded by `round` (0..1). Corner radius r = 0.4·round in u; the ramp is stretched about u = ½
// by 1/s so the slope at D50 is exactly −1 (γ unchanged) and its tangent still hits 1 at u = 0
// and 0 at u = 1. Exported because the Fab develop step evaluates the same curve.
export function roundedRamp(u, round) {
  if (!(round > 0)) return clamp01(1 - u);
  const r = 0.4 * Math.min(1, round);
  const s = 2 / (1 + Math.exp(-0.5 / r)) - 1;                   // slope of the unscaled blend at ½
  const v = 0.5 + (u - 0.5) / s;
  return clamp01(1 - (r * softplus(v / r) - r * softplus((v - 1) / r)));
}

// Remaining thickness fraction after development at dose D (µC/cm²).
export function remainingFraction(resist, D) {
  const { D0, D100, gamma, tone, scumNm, thicknessNm, smooth, round } = resist;
  let t;
  if (!(D > 0) || (!(D > D0) && !(round > 0))) {   // with rounding the curve starts below D0
    t = 1;
  } else {
    const u = (Math.log10(D) - Math.log10(D0)) * gamma;          // 0 at D0, 1 at D100
    // EBL Dev allows smooth up to 4 (an extrapolated blend), hence the outer clamp
    t = smooth > 0 ? clamp01((1 - smooth) * clamp01(1 - u) + smooth * (1 - smoothstep01(u)))
      : round > 0 ? roundedRamp(u, round) : clamp01(1 - u);
    if (scumNm > 0 && thicknessNm > 0) {
      // MNS v2 scum tail: a residue that only dies away well above D100
      const scumFrac = Math.min(0.9, scumNm / thicknessNm);
      t = Math.max(t, scumFrac * Math.exp(-6 * Math.max(0, Math.log10(D / D100))));
    }
  }
  return tone === 'negative' ? 1 - t : t;
}

// Resist at another beam energy: D0 and D100 scale as E^0.75 (an empirical scaling), γ unchanged.
export function atEnergy(resist, toKeV) {
  if (resist.energyKeV == null) throw new Error(`resist "${resist.name}" has no reference energy`);
  return makeResist({ ...resist, D100: scaleDoseToEnergy(resist.D100, resist.energyKeV, toKeV), energyKeV: toKeV });
}

// Presets carried over from the Micro and Nanofabrication Studio v2.
// MNS stores a suggested exposure dose with each; kept as `dose`. Reference energy unknown.
export const RESIST_PRESETS = {
  PMMA:    { tone: 'positive', dose: 500, gamma: 7,   D100: 450, darkErosion: 2,   scumNm: 2   },
  CSAR:    { tone: 'positive', dose: 300, gamma: 5,   D100: 250, darkErosion: 1.5, scumNm: 1   },
  MEDUSA:  { tone: 'negative', dose: 350, gamma: 10,  D100: 300, darkErosion: 0.5, scumNm: 0.5 },
  S1813:   { tone: 'positive', dose: 90,  gamma: 2.5, D100: 95,  darkErosion: 4,   scumNm: 2   },
  AZ5214E: { tone: 'negative', dose: 70,  gamma: 2.2, D100: 85,  darkErosion: 3.5, scumNm: 2   },
  SU8:     { tone: 'negative', dose: 180, gamma: 1.8, D100: 220, darkErosion: 0.8, scumNm: 0.5 },
  MAN2400: { tone: 'negative', dose: 120, gamma: 2.1, D100: 140, darkErosion: 1.2, scumNm: 1   },
};
