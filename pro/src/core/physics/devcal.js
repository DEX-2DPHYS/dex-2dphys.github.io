// A contrast curve (D₀, D₁₀₀, γ) is a measurement for one development: one developer, one time, one
// temperature (and one resist thickness and bake). Develop longer or warmer and the resist clears at
// a lower dose and its contrast changes; use another developer and the curve is a different curve.
// The Workbench does not extrapolate: it keeps the calibrated curve and scales only the dark erosion
// of unexposed resist with time. What it can do is say, every time, when a development is outside the
// conditions its curve was measured for — so that a result is never taken for more than it is.

import { DEVELOPERS } from '../fab/materials.js';

export const ROOM_C = 21;

// The conditions a resist's curve belongs to: its own (set with the curve), else its preset's, else
// the studio's default (60 s at room temperature, the preset's first developer).
export function calibrationOf(dp = {}, preset = null) {
  return {
    developer: dp.calDeveloper || preset?.cal?.developer || preset?.developers?.[0] || null,
    timeS: +(dp.calTimeS ?? dp.devTime ?? preset?.cal?.timeS ?? 60),
    tempC: +(dp.calTempC ?? preset?.cal?.tempC ?? ROOM_C),
  };
}

const devName = (k) => (k ? DEVELOPERS[k] || k : 'unknown developer');
export const describeCal = (c) => `${devName(c.developer)}, ${c.timeS} s, ${c.tempC} °C`;

// How a development differs from the calibration. → { outside, items: [text], text }
// Tolerances: time within 5 %, temperature within 1 °C, the same developer.
export function devDeviation(cal, run) {
  const items = [];
  if (run.developer && cal.developer && run.developer !== cal.developer) items.push(`developer ${devName(run.developer)} instead of ${devName(cal.developer)}`);
  if (run.timeS != null && Math.abs(run.timeS - cal.timeS) > 0.05 * cal.timeS) items.push(`${run.timeS} s instead of ${cal.timeS} s`);
  if (run.tempC != null && Math.abs(run.tempC - cal.tempC) > 1) items.push(`${run.tempC} °C instead of ${cal.tempC} °C`);
  const outside = items.length > 0;
  return {
    outside, items,
    text: outside
      ? `Outside the contrast curve's calibration (${describeCal(cal)}): ${items.join(', ')}. The model keeps the calibrated curve and scales only the dark erosion with time — a real resist clears at a lower dose and changes contrast when developed longer or warmer, so treat this result as uncertain, or measure the curve for these conditions.`
      : `As calibrated: ${describeCal(cal)}.`,
  };
}
