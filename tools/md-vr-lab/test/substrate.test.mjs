// node test/substrate.test.mjs  - the fixed substrate (van der Waals only) and building blocks (mergeFrom)
import { Mat, SP } from '../src/materials.js';
import { buildSubstrate, substrateForces } from '../src/substrate.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const flake = () => { const m = new Mat(); m.buildGraphene(6, 4, 5, 1, false, true); return m; };
const under = (m, kind, gap = 3.4) => { let a = 0, b = 0, low = 1e9; for (let i = 0; i < m.N; i++) { a += m.x[i]; b += m.y[i]; low = Math.min(low, m.z[i]); } return buildSubstrate(kind, 'z', [a / m.N, b / m.N], low - gap, 25); };

for (const kind of ['graphene', 'mos2', 'sio2']) {
  const m = flake(), sub = under(m, kind);
  // forces are minus the gradient of the energy (finite differences on a few atoms)
  let worst = 0; const f = () => { m.fx.fill(0); m.fy.fill(0); m.fz.fill(0); return substrateForces(m, sub); };
  f(); const F = [Array.from(m.fx.slice(0, m.N)), Array.from(m.fy.slice(0, m.N)), Array.from(m.fz.slice(0, m.N))];
  for (const i of [0, 7, 30, m.N - 1]) for (const [arr, c] of [[m.x, 0], [m.y, 1], [m.z, 2]]) { const o = arr[i], h = 1e-5; arr[i] = o + h; const e1 = f(); arr[i] = o - h; const e2 = f(); arr[i] = o; worst = Math.max(worst, Math.abs(-(e1 - e2) / (2 * h) - F[c][i])); }
  const E = f() / m.N;
  ok(worst < 1e-5 && E < -0.01 && E > -0.2, `${kind}: ${sub.n} fixed atoms, binding ${(1000 * E).toFixed(1)} meV per flake atom, |F + dE/dx| ${worst.toExponential(1)} eV/A`);
  // with the substrate in the MD, the flake settles above it and nothing in the substrate moves
  m.sub = sub; const z0 = Array.from(sub.z); m.thermostat = true; m.Ttarget = 100; m.run(2000);
  let low = 1e9; for (let i = 0; i < m.N; i++) low = Math.min(low, m.z[i] - sub.wTop);
  ok(!m.exploded && low > 2.0 && low < 5 && sub.z.every((v, k) => v === z0[k]), `${kind}: after 2000 steps the flake lies ${low.toFixed(2)} A above the top layer; substrate unchanged`);
}
{ // building blocks: carbon + carbon keeps Tersoff; groups and bonds come along
  const m = flake(), n0 = m.N, o = new Mat(); o.buildC60(5);
  m.mergeFrom(o, 30, 0, 0);
  ok(m.N === n0 + 60 && m.model === 'tersoff' && m.grp[n0] > m.grp[0], `C60 merged into a flake: ${n0} + 60 = ${m.N} atoms, its own group`);
  const c = flake(); c.toChem(5); const b = new Mat(); b.buildBenzene(1, 5); b.toChem(5); const nb = c.chem.bonds.length;
  c.mergeFrom(b, 25, 0, 0); m.run(10);
  ok(c.chem.bonds.length === nb + b.chem.bonds.length, `chemistry model: the benzene's ${b.chem.bonds.length} bonds come along`);
}
console.log(fail ? fail + ' FAILED' : 'all substrate tests passed'); process.exit(fail ? 1 : 0);
