// node test/substrate.test.mjs  - the fixed substrate (van der Waals only) and building blocks (mergeFrom)
import { Mat, SP } from '../src/materials.js';
import { buildSubstrate, substrateForces } from '../src/substrate.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const flake = () => { const m = new Mat(); m.buildGraphene(6, 4, 5, 1, false, true); return m; };
const under = (m, kind, gap = 3.4) => { let a = 0, b = 0, low = 1e9; for (let i = 0; i < m.N; i++) { a += m.x[i]; b += m.y[i]; low = Math.min(low, m.z[i]); } return buildSubstrate(kind, 'z', [a / m.N, b / m.N], low - gap, 25); };

for (const kind of ['graphene', 'mos2', 'sio2']) {
  const m = flake(), sub = under(m, kind);
  // forces are minus the gradient of the energy (finite differences on a few atoms) - for the direct sum
  sub.exact = true;
  let worst = 0; const f = () => { m.fx.fill(0); m.fy.fill(0); m.fz.fill(0); return substrateForces(m, sub); };
  f(); const F = [Array.from(m.fx.slice(0, m.N)), Array.from(m.fy.slice(0, m.N)), Array.from(m.fz.slice(0, m.N))];
  for (const i of [0, 7, 30, m.N - 1]) for (const [arr, c] of [[m.x, 0], [m.y, 1], [m.z, 2]]) { const o = arr[i], h = 1e-5; arr[i] = o + h; const e1 = f(); arr[i] = o - h; const e2 = f(); arr[i] = o; worst = Math.max(worst, Math.abs(-(e1 - e2) / (2 * h) - F[c][i])); }
  const E = f() / m.N;
  sub.exact = false;
  if (kind !== 'sio2') {                                          // the crystalline ones: the lattice table against the direct sum
    const t = new Mat(); t.buildGraphene(6, 4, 5, 1, false, true); let ew = 0, fw = 0, fmax = 0, n = 0;
    for (const lift of [3.0, 3.4, 4.5, 6.5]) {
      for (let i = 0; i < t.N; i++) { t.x[i] = m.x[i] + 0.37 * Math.sin(3 * i); t.y[i] = m.y[i] + 0.29 * Math.cos(5 * i); t.z[i] = sub.wTop + lift + 0.2 * Math.sin(i); }
      const run = (ex) => { sub.exact = ex; t.fx.fill(0); t.fy.fill(0); t.fz.fill(0); const e = substrateForces(t, sub); return [e, Float64Array.from(t.fx.subarray(0, t.N)), Float64Array.from(t.fy.subarray(0, t.N)), Float64Array.from(t.fz.subarray(0, t.N))]; };
      const A = run(true), B = run(false); sub.exact = false;
      ew = Math.max(ew, Math.abs(A[0] - B[0]) / t.N);
      for (let i = 0; i < t.N; i++) { const d = Math.hypot(A[1][i] - B[1][i], A[2][i] - B[2][i], A[3][i] - B[3][i]); fw = Math.max(fw, d); fmax = Math.max(fmax, Math.hypot(A[1][i], A[2][i], A[3][i])); n++; }
    }
    const tm = (ex) => { sub.exact = ex; const t0 = performance.now(); for (let k = 0; k < 200; k++) { m.fx.fill(0); substrateForces(m, sub); } sub.exact = false; return (performance.now() - t0) / 200; };
    tm(false); const te = tm(true), tt = tm(false);
    ok(ew < 2e-3 && fw < 0.03 * fmax + 1e-3,      // (2 meV of a ~70 meV binding per atom; forces within 3 %)
    `${kind}: lattice table = direct sum within ${(ew * 1e3).toFixed(3)} meV/atom, |dF| ${fw.toExponential(1)} of ${fmax.toExponential(1)} eV/A (${n} atom positions, 2.8-6.7 A up); ${te.toFixed(2)} -> ${tt.toFixed(2)} ms per call`);
  }
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
