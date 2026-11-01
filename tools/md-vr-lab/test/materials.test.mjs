// node test/materials.test.mjs  - force/gradient checks, equilibrium geometries, energies, NVE conservation
import { Mat, TU_FS, SP, SPECIES, KB } from '../src/materials.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// finite-difference force check on a perturbed system
function fdCheck(md, label, tol = 2e-5, nAtoms = 8) {
  const rng = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  for (let i = 0; i < md.N; i++) { md.x[i] += (rng() - .5) * 0.25; md.y[i] += (rng() - .5) * 0.25; md.z[i] += (rng() - .5) * 0.25; }
  md.listDirty = true; md.computeForces();
  const F = [Array.from(md.fx.slice(0, md.N)), Array.from(md.fy.slice(0, md.N)), Array.from(md.fz.slice(0, md.N))];
  let worst = 0; const h = 1e-5;
  for (let t = 0; t < nAtoms; t++) {
    const i = Math.floor(rng() * md.N);
    for (const [ax, name] of [[md.x, 0], [md.y, 1], [md.z, 2]]) {
      const o = ax[i]; ax[i] = o + h; md.listDirty = true; md.computeForces(); const e1 = md.PE; ax[i] = o - h; md.listDirty = true; md.computeForces(); const e2 = md.PE; ax[i] = o;
      const num = -(e1 - e2) / (2 * h); worst = Math.max(worst, Math.abs(num - F[name][i]));
    }
  }
  md.listDirty = true; md.computeForces();
  ok(worst < tol, `${label}: max |F_analytic - F_numeric| = ${worst.toExponential(2)} eV/A`);
}

// energy per atom for a uniformly scaled periodic system (no relaxation)
const eps = (md) => md.PE / md.N;

{ // Tersoff carbon: diamond lattice (periodic bulk through 3D box)
  const md = new Mat(); md.clear(); md.model = 'tersoff'; md.vdw = null;
  const build = (a, P) => { md.clear(); md.tp = P; const n = 2; md.Lx = md.Ly = md.Lz = n * a; md.per = [true, true, true];
    const basis = [[0, 0, 0], [.5, .5, 0], [.5, 0, .5], [0, .5, .5], [.25, .25, .25], [.75, .75, .25], [.75, .25, .75], [.25, .75, .75]];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) for (const q of basis) md.addRaw(SP.C, (i + q[0]) * a, (j + q[1]) * a, (k + q[2]) * a, 0); md.listDirty = true; md.computeForces(); };
  const { TERSOFF } = await import('../src/materials.js');
  let best = [1e9, 0]; for (let a = 3.50; a <= 3.64; a += 0.002) { build(a, TERSOFF.diamond); if (eps(md) < best[0]) best = [eps(md), a]; }
  ok(Math.abs(best[0] + 7.37) < 0.02 && Math.abs(best[1] - 3.567) < 0.01, `Tersoff diamond: a0=${best[1].toFixed(3)} A (3.567), E=${best[0].toFixed(3)} eV/atom (-7.37)`);
  build(3.567, TERSOFF.diamond); fdCheck(md, 'Tersoff diamond bulk');
}
{ // graphene with Lindsay-Broido
  const md = new Mat(); md.buildGraphene(5, 3, 1);
  // scan a uniform in-plane scale to find the equilibrium bond length
  const x0 = Array.from(md.x.slice(0, md.N)), y0 = Array.from(md.y.slice(0, md.N)), Lx = md.Lx, Ly = md.Ly; let best = [1e9, 1];
  for (let s = 0.98; s <= 1.03; s += 0.0005) { for (let i = 0; i < md.N; i++) { md.x[i] = x0[i] * s; md.y[i] = y0[i] * s; } md.Lx = Lx * s; md.Ly = Ly * s; md.listDirty = true; md.computeForces(); if (eps(md) < best[0]) best = [eps(md), s]; }
  console.log(`   graphene (LB): bond ${(1.438 * best[1]).toFixed(3)} A, E ${best[0].toFixed(3)} eV/atom`);
  ok(Math.abs(1.438 * best[1] - 1.438) < 0.004, 'graphene equilibrium bond length 1.438 A (this parameter set; exp. 1.42)');
  ok(best[0] < -7.7 && best[0] > -8.2, 'graphene cohesive energy ~ -7.98 eV/atom (LB set, fitted to phonons)');
  fdCheck(md, 'Tersoff graphene (periodic xy)');
}
{ // SW MoS2
  const md = new Mat(); md.buildMoS2(4, 2, 1, 1);
  const x0 = Array.from(md.x.slice(0, md.N)), y0 = Array.from(md.y.slice(0, md.N)), Lx = md.Lx, Ly = md.Ly; let best = [1e9, 1];
  for (let s = 0.96; s <= 1.04; s += 0.0005) { for (let i = 0; i < md.N; i++) { md.x[i] = x0[i] * s; md.y[i] = y0[i] * s; } md.Lx = Lx * s; md.Ly = Ly * s; md.listDirty = true; md.computeForces(); if (eps(md) < best[0]) best = [eps(md), s]; }
  console.log(`   MoS2 (SW, unrelaxed z): a = ${(3.12 * best[1]).toFixed(3)} A, E ${best[0].toFixed(3)} eV/atom`);
  ok(Math.abs(3.12 * best[1] - 3.12) < 0.03, 'MoS2 lattice constant ~3.12 A (SW minimum)');
  fdCheck(md, 'SW MoS2');
}
{ // benzene
  const md = new Mat(); md.buildBenzene(2, 1, (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })());
  fdCheck(md, 'benzene FF (2 molecules, incl. vdW + Coulomb)');
}
// geometry of an isolated, relaxed benzene
{ const md = new Mat(); md.buildBenzene(1, 1); const d = (a, b) => Math.hypot(md.x[a] - md.x[b], md.y[a] - md.y[b], md.z[a] - md.z[b]);
  ok(Math.abs(d(0, 1) - 1.40) < 0.02 && Math.abs(d(0, 6) - 1.08) < 0.02, `benzene geometry: C-C ${d(0, 1).toFixed(3)} (1.40), C-H ${d(0, 6).toFixed(3)} (1.08)`); }

// NVE energy conservation for each model
for (const [name, mk, dtfs, steps] of [
  ['graphene', () => { const m = new Mat(); m.buildGraphene(4, 3, 600); return m; }, 1.0, 3000],
  ['graphite', () => { const m = new Mat(); m.buildGraphite(4, 3, 3, 400); return m; }, 1.0, 3000],
  ['MoS2 bilayer', () => { const m = new Mat(); m.buildMoS2(4, 2, 2, 600); return m; }, 2.0, 3000],
  ['nanodiamond', () => { const m = new Mat(); m.buildNanodiamond(5.5, 600); return m; }, 0.5, 3000],
  ['benzene x7', () => { const m = new Mat(); m.buildBenzene(7, 150); return m; }, 0.5, 3000],
]) {
  const m = mk(); m.dt = dtfs / TU_FS; m.thermostat = true; m.Ttarget = m.temperature() || 300; m.run(1000); m.thermostat = false;
  m.run(1); const e0 = m.KE + m.PE; m.run(steps); const e1 = m.KE + m.PE;
  ok(Math.abs(e1 - e0) / m.N < 2e-3, `${name} (N=${m.N}): NVE drift ${((e1 - e0) / m.N * 1000).toFixed(3)} meV/atom over ${steps} steps, T=${m.temperature().toFixed(0)} K`);
}
// benzene C-H stretch frequency from velocity autocorrelation is overkill: check period via bond oscillation
{ const m = new Mat(); m.buildBenzene(1, 1); m.thermostat = false; m.dt = 0.1 / TU_FS; m.ext.i = -1;
  // stretch one C-H bond and measure oscillation period
  m.x[6] += 0.08 * (m.x[6] - m.x[0]) / Math.hypot(m.x[6] - m.x[0], m.y[6] - m.y[0], m.z[6] - m.z[0]); m.listDirty = true; m.computeForces();
  let last = 0, sign = 0, crossings = []; const r = () => Math.hypot(m.x[6] - m.x[0], m.y[6] - m.y[0], m.z[6] - m.z[0]);
  const mean = 1.08; for (let s = 0; s < 4000; s++) { m.stepOnce(); const q = r() - mean; const sg = q > 0 ? 1 : -1; if (sg !== sign && s > 0) { crossings.push(s * 0.1); } sign = sg; }
  const periods = []; for (let i = 2; i < crossings.length; i += 2) periods.push(crossings[i] - crossings[i - 2]); const T = periods.slice(0, 10).reduce((a, b) => a + b, 0) / Math.max(1, periods.slice(0, 10).length);
  const wn = 1e15 / (T * 2.99792458e10); console.log(`   C-H stretch period ${T.toFixed(1)} fs -> ${wn.toFixed(0)} cm^-1`);
  ok(wn > 2800 && wn < 3500, 'benzene C-H stretch ~3000 cm^-1'); }
// vdW: graphite binding and spacing
{ const m = new Mat(); m.buildGraphite(5, 3, 2, 1);
  const zs = []; for (let i = 0; i < m.N; i++) zs.push(m.z[i]); const top = []; for (let i = 0; i < m.N; i++) if (m.grp[i] === 1) top.push(i);
  const Edz = (dz) => { for (const i of top) m.z[i] = zs[i] + dz; m.listDirty = true; m.computeForces(); return m.PE; };
  let best = [1e9, 0]; for (let dz = -0.4; dz <= 1.5; dz += 0.01) { const e = Edz(dz); if (e < best[0]) best = [e, dz]; }
  const Einf = Edz(9); const bind = (Einf - best[0]) / (m.N / 2) * 1000;   // per atom of one layer
  console.log(`   graphite 2 layers: spacing ${(3.35 + best[1]).toFixed(2)} A, binding ${bind.toFixed(1)} meV/atom (exp. ~52, DFT-vdW ~48)`);
  ok(Math.abs(3.35 + best[1] - 3.35) < 0.12 && bind > 40 && bind < 62, 'graphite vdW spacing and binding energy'); }
{ const m = new Mat(); m.buildMoS2(4, 2, 2, 1);
  const zs = []; for (let i = 0; i < m.N; i++) zs.push(m.z[i]); const top = []; for (let i = 0; i < m.N; i++) if (m.grp[i] === 1) top.push(i);
  const Edz = (dz) => { for (const i of top) m.z[i] = zs[i] + dz; m.listDirty = true; m.computeForces(); return m.PE; };
  let best = [1e9, 0]; for (let dz = -0.8; dz <= 2; dz += 0.01) { const e = Edz(dz); if (e < best[0]) best = [e, dz]; }
  const area = m.Lx * m.Ly; const bind = (Edz(12) - best[0]) / area * 1000;   // meV/A^2
  const gap = 6.15 + best[1];
  console.log(`   MoS2 bilayer: Mo-Mo plane spacing ${gap.toFixed(2)} A (exp. 6.15), binding ${bind.toFixed(1)} meV/A^2 = ${(bind * 0.01602).toFixed(2)} J/m^2 (exp./DFT-vdW ~0.2)`);
  ok(Math.abs(gap - 6.15) < 0.25 && bind > 10 && bind < 15, 'MoS2 interlayer spacing and binding'); }
// speed
{ const m = new Mat(); m.buildGraphite(8, 5, 3, 300); const t = performance.now(); m.run(300); console.log(`   graphite N=${m.N}: ${((performance.now() - t) / 300).toFixed(2)} ms/step`); }
{ const m = new Mat(); m.buildBenzene(13, 200); const t = performance.now(); m.run(300); console.log(`   benzene x13 N=${m.N}: ${((performance.now() - t) / 300).toFixed(2)} ms/step`); }
process.exit(fail ? 1 : 0);
