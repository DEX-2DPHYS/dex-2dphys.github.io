// node test/physics.test.mjs
import { MD, mulberry, units } from '../src/physics.js';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// 1. NVE energy conservation, LJ liquid at the classic state point rho=0.8442, T=0.728 (Verlet 1967 / Johnson et al.)
{
  const md = new MD(); const r = mulberry(1);
  md.buildFCC(4, 0.8442, 1.5, r); md.thermostat = true; md.Ttarget = 0.728; md.dt = 0.004;
  md.run(3000); md.thermostat = false;
  const E = () => (md.KE + md.PE) / md.N;
  md.run(1); const e0 = E(); md.run(3000); const e1 = E();
  ok(Math.abs(e1 - e0) < 2e-3, `NVE drift over 3000 steps: ${(e1 - e0).toExponential(2)} (E/N=${e1.toFixed(3)})`);
  // literature (truncated+shifted rc=2.5): U/N ~ -5.2 ... P ~ 0.0 - 0.5 at T=0.728
  console.log('   T=', md.temperature().toFixed(3), 'U/N=', (md.PE / md.N).toFixed(3), 'P=', md.pressure().toFixed(3), 'Z=', md.meanCoord().toFixed(2));
  ok(md.PE / md.N < -5.0 && md.PE / md.N > -6.0, 'potential energy per atom in the liquid range');
}
// 2. dt too large breaks conservation
{
  const md = new MD(); const r = mulberry(2);
  md.buildFCC(3, 0.8442, 1.0, r); md.thermostat = false; md.dt = 0.02; md.run(2000);
  const e1 = (md.KE + md.PE) / md.N;
  const md2 = new MD(); md2.buildFCC(3, 0.8442, 1.0, mulberry(2)); md2.thermostat = false; md2.dt = 0.004; const e0 = (md2.kinetic() + md2.PE) / md2.N; md2.run(2000);
  ok(Math.abs(e1 - e0) > Math.abs((md2.KE + md2.PE) / md2.N - e0) * 5 || md.exploded, 'large dt drifts much more than small dt');
}
// 3. dilute gas -> ideal gas law
{
  const md = new MD(); md.buildGas(300, 0.02, 2.0, mulberry(3)); md.thermostat = true; md.Ttarget = 2.0; md.run(2000);
  let P = 0, n = 0; for (let k = 0; k < 40; k++) { md.run(50); P += md.pressure(); n++; } P /= n;
  const ideal = md.density * md.temperature();
  ok(Math.abs(P / ideal - 1) < 0.08, `gas P=${P.toFixed(4)} vs rho*T=${ideal.toFixed(4)}`);
}
// 4. reflecting walls: pressure from wall impulse matches ideal gas
{
  const md = new MD(); md.periodic = false; md.buildGas(300, 0.02, 2.0, mulberry(4)); md.thermostat = true; md.Ttarget = 2.0; md.run(1500);
  let P = 0; const K = 30; for (let k = 0; k < K; k++) { md.run(400); P += md.Pwall; } P /= K;
  const ideal = md.density * md.temperature();
  ok(Math.abs(P / ideal - 1) < 0.1, `walls: P=${P.toFixed(4)} vs rho*T=${ideal.toFixed(4)}`);
}
// 5. crystal melts when heated; g(r) first peak near 1.1; D rises
{
  const md = new MD(); md.buildFCC(4, 1.0, 0.2, mulberry(5)); md.thermostat = true; md.Ttarget = 0.3; md.dt = 0.004; md.run(1500);
  md.mark(); md.run(1500); const msdSolid = md.msd(); const zSolid = md.meanCoord();
  md.Ttarget = 3.0; md.run(4000); md.mark(); md.run(1500); const msdMelt = md.msd(); const zMelt = md.meanCoord();
  console.log('   solid msd', msdSolid.toFixed(3), 'Z', zSolid.toFixed(2), '| hot msd', msdMelt.toFixed(3), 'Z', zMelt.toFixed(2));
  ok(msdSolid < 0.05 && msdMelt > 1.0, 'MSD separates solid from melt');
  ok(zSolid > 11 && zMelt < zSolid, 'coordination drops on melting');
}
// 6. g(r) of the liquid
{
  const md = new MD(); md.buildFCC(4, 0.8442, 1.5, mulberry(6)); md.thermostat = true; md.Ttarget = 0.9; md.run(3000); md.resetRDF(); md.run(3000);
  const g = md.rdf(); let im = 0; for (let i = 0; i < g.length; i++) if (g[i] > g[im]) im = i;
  const rpk = (im + 0.5) * md.rdfMax / md.rdfBins;
  ok(rpk > 1.0 && rpk < 1.2 && g[im] > 2, `g(r) first peak at r=${rpk.toFixed(2)} height ${g[im].toFixed(2)}`);
}
// 7. speed
{
  const md = new MD(); md.buildFCC(7, 0.8, 1.0, mulberry(7)); const t = performance.now(); md.run(200); const ms = (performance.now() - t) / 200;
  console.log(`   N=${md.N}: ${ms.toFixed(3)} ms/step`); ok(ms < 4, "N=1372 step < 4 ms");
}
// 8. add/remove
{
  const md = new MD(); md.buildGas(100, 0.3, 1, mulberry(8)); const n = md.N + 1; const i = md.addAtom(0.3, 0.3, 0.3); md.removeAtom(0);
  ok(md.N === n - 1 && i >= 0, 'add + remove keeps count'); md.run(100); ok(!md.exploded, 'still stable');
}
const u = units('Ar'); ok(Math.abs(u.ps(1) - 2.15) < 0.05 && Math.abs(u.bar(1) - 419) < 5, `Ar units: tau=${u.ps(1).toFixed(3)} ps, P*=1 -> ${u.bar(1).toFixed(0)} bar`);
process.exit(fail ? 1 : 0);
