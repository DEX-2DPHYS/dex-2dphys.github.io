// The glovebox (src/glovebox.js): a hot gas stays inside, bounces take a little energy, held atoms leave freely, a piece left
// outside comes home slowly; the pause/run ramp factor.
import assert from 'node:assert/strict';
import { GLOVE, gloveStep, gloveFit, rampFactor, RAMP_S } from '../src/glovebox.js';

const gas = (N, R, v) => {
  const m = { N, x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N), vx: new Float64Array(N), vy: new Float64Array(N), vz: new Float64Array(N), fixed: new Uint8Array(N) };
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < N; i++) { m.x[i] = rnd() * R; m.y[i] = Math.abs(rnd()) * R * 0.5; m.z[i] = rnd() * R; m.vx[i] = rnd() * v; m.vy[i] = rnd() * v; m.vz[i] = rnd() * v; }
  return m;
};
const ke = (m) => { let s = 0; for (let i = 0; i < m.N; i++) s += m.vx[i] ** 2 + m.vy[i] ** 2 + m.vz[i] ** 2; return s / 2; };

// 1. free flight in a dome of R = 20 A: nobody gets out, energy drains slowly through the bounces
{
  const m = gas(200, 20, 4), g = { cx: 0, cy: 0, cz: 0, R: 20, rad: 0.3 }, dt = 0.05, k0 = ke(m); let hits = 0;
  for (let st = 0; st < 4000; st++) {
    for (let i = 0; i < m.N; i++) { m.x[i] += m.vx[i] * dt; m.y[i] += m.vy[i] * dt; m.z[i] += m.vz[i] * dt; if (m.y[i] < 0) { m.y[i] = -m.y[i]; m.vy[i] = -m.vy[i]; } }
    hits += gloveStep(m, g, null);
  }
  let rmax = 0; for (let i = 0; i < m.N; i++) rmax = Math.max(rmax, Math.hypot(m.x[i], m.y[i], m.z[i]));
  const k1 = ke(m);
  assert.ok(rmax < 20 - 0.3 + 0.25, `an atom left the box: r = ${rmax.toFixed(2)}`);
  assert.ok(hits > 500, `few bounces: ${hits}`);
  assert.ok(k1 < 0.1 * k0, `energy ${k0.toFixed(1)} -> ${k1.toFixed(1)}`);
  console.log(`hot gas: ${hits} bounces, kinetic energy ${k0.toFixed(0)} -> ${k1.toFixed(0)}, furthest atom ${rmax.toFixed(2)} A of ${20 - 0.3}`);
}
// 2. one bounce: the normal velocity flips and keeps GLOVE.e of its size, the tangential keeps GLOVE.et
{
  const m = gas(1, 1, 0); m.x[0] = 10.01; m.y[0] = 0; m.z[0] = 0; m.vx[0] = 2; m.vy[0] = 0; m.vz[0] = 1;
  assert.equal(gloveStep(m, { cx: 0, cy: 0, cz: 0, R: 10.3, rad: 0.3 }, null), 1);
  assert.ok(Math.abs(m.vx[0] + 2 * GLOVE.e) < 1e-12 && Math.abs(m.vz[0] - GLOVE.et) < 1e-12 && m.x[0] <= 10 + 1e-12);
}
// 3. held atoms are free to leave; released far outside, they slide home at GLOVE.push per step, never jump
{
  const m = gas(1, 1, 0); m.x[0] = 30; m.y[0] = 0; m.z[0] = 0;
  assert.equal(gloveStep(m, { cx: 0, cy: 0, cz: 0, R: 20, rad: 0.3 }, Uint8Array.of(1)), 0); assert.equal(m.x[0], 30);
  gloveStep(m, { cx: 0, cy: 0, cz: 0, R: 20, rad: 0.3 }, null); assert.ok(Math.abs(m.x[0] - (30 - GLOVE.push)) < 1e-12);
}
// 4. the fitted radius: the default size on the bench, or the structure plus a margin
{
  const m = gas(2, 1, 0); m.x[0] = 0; m.x[1] = 50; m.y.fill(0); m.z.fill(0);
  assert.equal(gloveFit(m, 0, 0, 0, 0.005), GLOVE.baseM / 0.005);
  assert.equal(gloveFit(m, 0, 0, 0, 0.1), 50 + GLOVE.margin);
}
// 5. the warm-up ramp
assert.ok(rampFactor(0) > 0 && rampFactor(0) < 0.01); assert.equal(rampFactor(RAMP_S / 2), 0.5); assert.equal(rampFactor(RAMP_S + 1), 1);
console.log('glovebox: all checks passed');
