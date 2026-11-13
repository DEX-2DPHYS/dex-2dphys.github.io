// node test/newsystems.test.mjs - water (ice Ih, SPC/Fw scaled), gold (Gupta), armchair graphene nanoribbons (2026-11-13)
import { Mat, SP, TU_FS, WATER_F } from '../src/materials.js';
import { analyse } from '../src/tb.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const rnd = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
function fd(md, n = 10) {                                          // analytic forces against finite differences of the energy
  md.computeForces(); const F = Array.from(md.fx.slice(0, md.N)); let worst = 0; const h = 1e-5;
  for (let t = 0; t < n; t++) { const i = (t * 37) % md.N, o = md.x[i]; md.x[i] = o + h; md.computeForces(); const e1 = md.PE; md.x[i] = o - h; md.computeForces(); const e2 = md.PE; md.x[i] = o; worst = Math.max(worst, Math.abs(-(e1 - e2) / (2 * h) - F[i])); }
  md.computeForces(); return worst;
}

{ // water: the ice rules, forces, energy conservation, no spin, molecules removed whole
  const md = new Mat(); md.buildWater(150, 100, rnd(7));
  const O = []; for (let i = 0; i < md.N; i++) if (md.sp[i] === SP.O) O.push(i);
  const hOf = new Map(); for (const [o, h] of md.bonds) { if (!hOf.has(o)) hOf.set(o, []); hOf.get(o).push(h); }
  let pairs = 0, good = 0;
  for (let a = 0; a < O.length; a++) for (let b = a + 1; b < O.length; b++) {     // (geometry as built is after a short quench: test on the bonds' directions)
    const i = O[a], j = O[b]; if (Math.hypot(md.x[i] - md.x[j], md.y[i] - md.y[j], md.z[i] - md.z[j]) > 3.1) continue; pairs++;
    let c = 0; for (const [o, k] of [[i, j], [j, i]]) for (const h of hOf.get(o)) if (Math.hypot(md.x[h] - md.x[k], md.y[h] - md.y[k], md.z[h] - md.z[k]) < 2.2) c++;
    if (c === 1) good++;
  }
  ok(O.length === 150 && md.bonds.length === 300 && md.angles.length === 150, `water: 150 molecules, 300 O-H bonds, 150 angles (scale f = ${WATER_F})`);
  ok(pairs > 200 && good === pairs, `ice Ih: exactly one hydrogen on each of the ${pairs} O-O hydrogen bonds (Bernal-Fowler rules)`);
  ok(fd(md) < 1e-6, `water: forces match the energy`);
  let L = 0; { let cx = 0, cy = 0, cz = 0, M = 0; for (let i = 0; i < md.N; i++) { M += md.mass[i]; cx += md.mass[i] * md.x[i]; cy += md.mass[i] * md.y[i]; cz += md.mass[i] * md.z[i]; } cx /= M; cy /= M; cz /= M;
    let lx = 0, ly = 0, lz = 0; for (let i = 0; i < md.N; i++) { const x = md.x[i] - cx, y = md.y[i] - cy, z = md.z[i] - cz, m = md.mass[i]; lx += m * (y * md.vz[i] - z * md.vy[i]); ly += m * (z * md.vx[i] - x * md.vz[i]); lz += m * (x * md.vy[i] - y * md.vx[i]); } L = Math.hypot(lx, ly, lz); }
  ok(L < 1e-6, `water: built without spin (|L| ${L.toExponential(1)}): no flying ice cube`);
  md.thermostat = false; md.computeForces(); const e0 = md.PE + md.kinetic(); md.run(1000); const dE = (md.PE + md.KE - e0) / O.length;
  ok(Math.abs(dE) < 0.002, `water NVE ${(1000 * md.dt * TU_FS / 1000).toFixed(1)} ps at ${(md.dt * TU_FS).toFixed(1)} fs (H 4 amu): drift ${(dE * 1000).toFixed(2)} meV/molecule`);
  const n0 = md.N; md.removeAtom(md.N - 2); md.removeAtom(md.N - 1); md.removeAtom(md.N - 1);
  ok(md.N === n0 - 3 && md.bonds.every((b) => b[0] < md.N && b[1] < md.N) && md.bonds.length === 2 * md.N / 3 && md.angles.length === md.N / 3, 'water: removing a molecule renumbers its neighbours\' bonds and angles');
  const s = md.serialize(), m2 = new Mat(); m2.restore(s); let hm = true; for (let i = 0; i < m2.N; i++) if (m2.sp[i] === SP.H && m2.mass[i] !== md.mass[i]) hm = false;
  ok(m2.water && hm && Math.abs(m2.PE - md.PE) < 0.05, `water: save/restore keeps the model and the H mass (dE ${(m2.PE - md.PE).toExponential(1)} eV)`);
}

{ // gold: bulk fcc from the Gupta potential, the particle
  const md = new Mat(); let best = null;
  for (let a = 4.0; a <= 4.16; a += 0.005) {
    md.clear(); md.model = 'eam'; md.vdw = null; const n = 4; md.Lx = md.Ly = md.Lz = n * a; md.per = [true, true, true];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) for (const b of [[0, 0, 0], [.5, .5, 0], [.5, 0, .5], [0, .5, .5]]) md.addRaw(SP.Au, (i + b[0]) * a, (j + b[1]) * a, (k + b[2]) * a, 0);
    md.listDirty = true; md.computeForces(); const e = md.PE / md.N; if (!best || e < best.e) best = { a, e };
  }
  ok(Math.abs(best.a - 4.08) < 0.02 && Math.abs(-best.e - 3.78) < 0.05, `gold fcc: a0 ${best.a.toFixed(3)} A (exp. 4.08), cohesive energy ${(-best.e).toFixed(3)} eV (exp. 3.78)`);
  const p = new Mat(); p.buildGold(11, 300);
  ok(p.N > 300 && p.N < 500 && fd(p) < 1e-6, `gold particle: ${p.N} atoms, forces match the energy`);
  p.run(500); ok(!p.exploded && Math.abs(p.temperature() - 300) < 60, `gold particle runs at ${p.temperature().toFixed(0)} K`);
}

{ // armchair ribbons on their ideal geometry: the three families (nearest-neighbour + edge correction, as in test/ribbons.test.mjs)
  const gap = (N) => { const m = new Mat(); m.finish = () => {}; m.buildRibbon(N, 60, 1); let lo = 1e9, hi = -1e9; for (let i = 0; i < m.N; i++) { lo = Math.min(lo, m.x[i]); hi = Math.max(hi, m.x[i]); }
    const cm = [], cp = []; for (let i = 0; i < m.N; i++) { if (m.x[i] < lo + 2.3) cm.push(i); else if (m.x[i] > hi - 2.3) cp.push(i); }
    const lines = new Set(Array.from(m.y.subarray(0, m.N), (v) => Math.round(v * 4))).size;
    return { lines, g: analyse({ N: m.N, x: m.x, y: m.y, z: m.z, orb: () => true, per: m.per, L: [m.Lx, m.Ly, m.Lz] }, cm, cp, { gamma: 1.0, nE: 801, Emin: -2, Emax: 2, curve: true }).gap };
  };
  const r = Object.fromEntries([6, 7, 8, 9, 10].map((N) => [N, gap(N)]));
  ok(Object.entries(r).every(([N, v]) => v.lines === +N), `ribbons: N dimer lines across for N = 6..10`);
  ok(r[7].g > 1.3 && r[10].g > 0.8 && r[6].g > 0.6 && r[9].g > 0.4 && r[8].g < 0.1, `ribbon transport gaps: N=6 ${r[6].g.toFixed(2)}, 7 ${r[7].g.toFixed(2)}, 8 ${r[8].g.toFixed(2)}, 9 ${r[9].g.toFixed(2)}, 10 ${r[10].g.toFixed(2)} eV (3p+1 > 3p > 3p+2 ~ 0)`);
  const m = new Mat(); m.buildRibbon(7, 60, 300); m.run(2000); ok(!m.exploded, `ribbon N=7 runs at 300 K (${m.temperature().toFixed(0)} K)`);
}
console.log(fail ? `${fail} FAILED` : 'all newsystems tests passed'); process.exit(fail ? 1 : 0);
