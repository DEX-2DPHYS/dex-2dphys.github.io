// node test/systems.test.mjs  - built-in systems (nanotubes, C60, hBN, molecular junctions), fixed atoms, save/restore,
// removing many atoms at once, and transport through the junctions.
import { Mat, SP } from '../src/materials.js';
import { analyse } from '../src/tb.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const nb = (m, rb, i) => { let n = 0; for (let j = 0; j < m.N; j++) if (j !== i && Math.hypot(m.x[i] - m.x[j], m.y[i] - m.y[j], m.z[i] - m.z[j]) < rb) n++; return n; };
const meanNb = (m, rb) => { let s = 0; for (let i = 0; i < m.N; i++) s += nb(m, rb, i); return s / m.N; };

/* ---------------- nanotubes ---------------- */
for (const [n, k, len] of [[5, 5, 3], [10, 0, 3], [6, 5, 4]]) {
  const m = new Mat(); m.buildCNT(n, k, len, 300);
  const d = 0.246 * Math.sqrt(n * n + n * k + k * k) / Math.PI * 10;                 // A
  let rs = 0, cx = m.Lx / 2, cy = m.Ly / 2; for (let i = 0; i < m.N; i++) rs += Math.hypot(m.x[i] - cx, m.y[i] - cy) / m.N;
  const z0 = meanNb(m, 1.8); m.thermostat = true; m.Ttarget = 300; m.run(2000);
  ok(Math.abs(2 * rs - d) < 0.35 && z0 > 2.85 && !m.exploded && Math.abs(meanNb(m, 1.8) - z0) < 0.1, `nanotube (${n},${k}): ${m.N} atoms, diameter ${(2 * rs / 10).toFixed(3)} nm (theory ${(d / 10).toFixed(3)}), bonds/atom ${z0.toFixed(2)}, 2 ps at 300 K intact`);
}
{ // a metallic armchair tube conducts at E_F, a semiconducting zigzag (10,0) has a gap
  const tube = (n, k) => { const m = new Mat(); m.buildCNT(n, k, 4, 1); return m; };
  const run = (m) => { const zs = Array.from(m.z.subarray(0, m.N)), lo = Math.min(...zs), hi = Math.max(...zs), a = [], b = []; for (let i = 0; i < m.N; i++) { if (m.z[i] < lo + 2.3) a.push(i); else if (m.z[i] > hi - 2.3) b.push(i); } return analyse({ N: m.N, x: m.x, y: m.y, z: m.z, per: m.per, L: [m.Lx, m.Ly, m.Lz], orb: (i) => m.sp[i] === SP.C }, a, b, { gamma: 1, nE: 801 }); };
  // zone folding: (n - m) divisible by 3 -> metallic. Short (4 nm) tubes: the gap partly tunnels, so compare T(E_F)
  const T = Object.fromEntries([[5, 5], [9, 0], [10, 0], [8, 0]].map(([n, k]) => [`${n},${k}`, run(tube(n, k)).TEF]));
  const metal = Math.min(T['5,5'], T['9,0']), semi = Math.max(T['10,0'], T['8,0']);
  ok(metal > 0.5 && semi < 0.1 * metal, `zone folding in the transport: T(E_F) metallic (5,5) ${T['5,5'].toFixed(2)}, (9,0) ${T['9,0'].toFixed(2)}; semiconducting (10,0) ${T['10,0'].toFixed(3)}, (8,0) ${T['8,0'].toFixed(3)}`);
}

/* ---------------- C60, hBN ---------------- */
{
  const m = new Mat(); m.buildC60(300); let three = 0; for (let i = 0; i < m.N; i++) if (nb(m, 1.7, i) === 3) three++;
  m.thermostat = true; m.Ttarget = 300; m.run(2000);
  let r = 0, c = [0, 0, 0]; for (let i = 0; i < m.N; i++) { c[0] += m.x[i] / 60; c[1] += m.y[i] / 60; c[2] += m.z[i] / 60; } for (let i = 0; i < m.N; i++) r += Math.hypot(m.x[i] - c[0], m.y[i] - c[1], m.z[i] - c[2]) / 60;
  ok(m.N === 60 && three === 60 && !m.exploded && Math.abs(2 * r - 7.1) < 0.3, `C60: 60 atoms, all with 3 bonds, diameter ${(2 * r).toFixed(2)} A (experiment 7.1) after 2 ps at 300 K`);
}
{
  const m = new Mat(); m.buildHBN(8, 5, 300, true); let bn = 0, cnt = 0;
  for (const [a, b] of m.chem.bonds) { if (m.sp[a] !== m.sp[b]) { bn += Math.hypot(m.x[a] - m.x[b], m.y[a] - m.y[b], m.z[a] - m.z[b]); cnt++; } }
  const nB = m.chem.bonds.length; m.thermostat = true; m.Ttarget = 300; m.run(2000);
  ok(cnt === nB && Math.abs(bn / cnt - 1.446) < 0.03 && m.chem.bonds.length === nB && !m.exploded, `hBN flake: every bond is B-N, length ${(bn / cnt).toFixed(3)} A (experiment 1.446), types ${[...new Set(m.chem.type.slice(0, m.N))].join('/')}, 2 ps at 300 K with no bond lost`);
}

/* ---------------- molecular junctions ---------------- */
{
  const res = [];
  for (const rings of [1, 2, 3]) {
    const m = new Mat(); const anchors = m.buildJunction(rings, 50);
    const fx = []; for (let i = 0; i < m.N; i++) if (m.fixed[i]) fx.push([i, m.x[i], m.y[i], m.z[i]]);
    const nB = m.chem.bonds.length; m.thermostat = true; m.Ttarget = 50; m.run(1500);
    const moved = Math.max(...fx.map(([i, x, y, z]) => Math.hypot(m.x[i] - x, m.y[i] - y, m.z[i] - z)));
    const r = analyse({ N: m.N, x: m.x, y: m.y, z: m.z, per: m.per, L: [m.Lx, m.Ly, m.Lz], orb: (i) => m.sp[i] === SP.C && m.chem.deg[i] <= 3 }, [anchors[0]], [anchors[1]], { gamma: 0.5, nE: 801 });
    res.push(r.TEF);
    ok(moved === 0 && m.chem.bonds.length === nB && !m.exploded && r.n === 6 * rings, `${m.name}: ${m.N} atoms, gold pads did not move, no bond lost; ${r.n} pi orbitals, T(E_F) = ${r.TEF.toExponential(2)}, HOMO-LUMO ${r.gapHL.toFixed(2)} eV`);
  }
  const b1 = Math.log(res[0] / res[1]), b2 = Math.log(res[1] / res[2]);
  ok(res[0] > res[1] && res[1] > res[2], `conductance falls with every ring (tunnelling): T(E_F) ratios 1->2 rings x${(res[0] / res[1]).toFixed(1)}, 2->3 rings x${(res[1] / res[2]).toFixed(1)} (decay ${(b1).toFixed(2)}, ${(b2).toFixed(2)} per ring)`);
}

/* ---------------- save / restore, batch removal ---------------- */
{
  const m = new Mat(); m.buildJunction(2, 50); m.thermostat = true; m.run(200);
  const d = JSON.parse(JSON.stringify(m.serialize())), m2 = new Mat(); m2.restore(d);
  let dx = 0; for (let i = 0; i < m.N; i++) dx = Math.max(dx, Math.abs(m.x[i] - m2.x[i]));
  ok(m2.N === m.N && m2.chem.bonds.length === m.chem.bonds.length && Math.abs(m2.PE - m.PE) < 1e-2 && dx < 1e-4 && m2.fixed.subarray(0, m.N).reduce((a, b) => a + b, 0) === 26, `save/restore (JSON): ${m2.N} atoms, bonds, fixed atoms and energy back (dE ${(m2.PE - m.PE).toExponential(1)} eV)`);
  const g = new Mat(); g.buildGraphene(8, 5, 300, 1, false, true); g.toChem(300); const N0 = g.N;
  const kill = []; for (let i = 0; i < g.N; i++) if (Math.hypot(g.x[i] - g.Lx / 2, g.y[i] - g.Ly / 2) < 4) kill.push(i);
  kill.sort((a, b) => b - a).forEach((i) => g.removeAtom(i, true)); g.computeForces(); g.run(1500);
  let bad = 0; for (const [a, b] of g.chem.bonds) if (a >= g.N || b >= g.N) bad++;
  ok(g.N === N0 - kill.length && !bad && !g.exploded, `cut a hole of ${kill.length} atoms at once: topology consistent, runs on`);
}
if (fail) { console.log(fail + ' FAILED'); process.exit(1); } else console.log('all systems tests passed');
