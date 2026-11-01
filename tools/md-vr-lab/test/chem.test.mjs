// node test/chem.test.mjs  - chemistry mode (UFF, explicit bonds, valence): forces, molecular geometry, valence rules,
// sp2 -> sp3 pucker when atoms are attached to graphene, bond breaking, stability, and what an adsorbate does to transport.
import { Mat, SP } from '../src/materials.js';
import { bondR0, typeFor } from '../src/chem.js';
import { analyse } from '../src/tb.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const rng = (() => { let s = 4242; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const dist = (m, i, j) => Math.hypot(m.x[i] - m.x[j], m.y[i] - m.y[j], m.z[i] - m.z[j]);
const ang = (m, i, j, k) => { const a = [m.x[i] - m.x[j], m.y[i] - m.y[j], m.z[i] - m.z[j]], b = [m.x[k] - m.x[j], m.y[k] - m.y[j], m.z[k] - m.z[j]]; return Math.acos((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))) * 180 / Math.PI; };

function fdCheck(md, label, jiggle = 0.12, tol = 2e-5) {
  for (let i = 0; i < md.N; i++) { md.x[i] += (rng() - .5) * jiggle; md.y[i] += (rng() - .5) * jiggle; md.z[i] += (rng() - .5) * jiggle; }
  md.listDirty = true; md.computeForces();
  const F = [Array.from(md.fx.slice(0, md.N)), Array.from(md.fy.slice(0, md.N)), Array.from(md.fz.slice(0, md.N))];
  let worst = 0; const h = 1e-6;
  for (let i = 0; i < md.N; i++) for (const [ax, c] of [[md.x, 0], [md.y, 1], [md.z, 2]]) {
    const o = ax[i]; ax[i] = o + h; md.computeForces(); const e1 = md.PE; ax[i] = o - h; md.computeForces(); const e2 = md.PE; ax[i] = o;
    worst = Math.max(worst, Math.abs(-(e1 - e2) / (2 * h) - F[c][i]));
  }
  md.computeForces();
  ok(worst < tol, `${label}: max |F - (-dE/dx)| = ${worst.toExponential(2)} eV/A`);
}
function molecule(atoms, bonds) {           // atoms: [sym, x, y, z]
  const m = new Mat(); m.buildEmpty(30);
  for (const [s, x, y, z] of atoms) m.addRaw(SP[s], 15 + x, 15 + y, 15 + z, 0);
  for (const [a, b] of bonds) m.chem.bonds.push([a, b]);
  m.chem.dirty = true; m.chem.retype(); m.listDirty = true; m.computeForces(); return m;
}
const relax = (m, steps = 3000) => { m.quench(steps, 0.3); m.computeForces(); };

/* ---------------- forces = -gradient (bonds, angles, torsions, inversions, vdW, the bond switch) ---------------- */
{
  // ethylene-like + methyl + halogen: every term type
  const m = molecule([['C', 0, 0, 0], ['C', 1.34, 0, 0], ['H', -0.6, 0.9, 0], ['H', -0.6, -0.9, 0], ['C', 2.1, 1.2, 0], ['H', 1.9, -0.95, 0.1], ['H', 3.1, 1.0, 0.3], ['H', 1.8, 1.9, 0.8], ['F', 2.0, 1.7, -1.2], ['O', -1.0, 0, 3.5]],
    [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [4, 6], [4, 7], [4, 8]]);
  ok(m.chem.tor.length > 0 && m.chem.inv.length > 0 && m.chem.ang.length > 0, `test molecule has ${m.chem.ang.length} angles, ${m.chem.tor.length} torsions, ${m.chem.inv.length} inversions`);
  fdCheck(m, 'small molecule (all terms)');
  // the same with one bond pulled into the switching zone (1.25-1.6 rest lengths)
  const k = m.chem.bonds.findIndex(([a, b]) => a === 4 && b === 8), r0 = m.chem.bp[4 * k];
  const d = [m.x[8] - m.x[4], m.y[8] - m.y[4], m.z[8] - m.z[4]], l = Math.hypot(...d), want = 1.42 * r0;
  m.x[8] = m.x[4] + d[0] / l * want; m.y[8] = m.y[4] + d[1] / l * want; m.z[8] = m.z[4] + d[2] / l * want;
  fdCheck(m, 'C-F bond at 1.42 rest lengths (inside the switch)', 0.02);
}
{
  const m = new Mat(); m.buildGraphene(5, 3, 1, 1, false, true); m.toChem(1);
  const host = 20; m.chem.attach(host, 'F', false, [m.x[host], m.y[host], m.z[host] + 5]);
  fdCheck(m, `graphene flake + F (${m.N} atoms)`, 0.08);
}

/* ---------------- molecular geometry (UFF reference values) ---------------- */
{
  const m = molecule([['C', 0, 0, 0], ['H', 0.6, 0.6, 0.6], ['H', -0.6, -0.6, 0.6], ['H', -0.6, 0.6, -0.6], ['H', 0.6, -0.6, -0.6]], [[0, 1], [0, 2], [0, 3], [0, 4]]);
  relax(m); const r = dist(m, 0, 1), a = ang(m, 1, 0, 2);
  ok(Math.abs(r - bondR0('C_3', 'H_')) < 0.01 && Math.abs(a - 109.47) < 1.5, `CH4: C-H ${r.toFixed(3)} A (UFF ${bondR0('C_3', 'H_').toFixed(3)}), H-C-H ${a.toFixed(1)} deg`);
}
{
  const m = molecule([['O', 0, 0, 0], ['H', 0.95, 0.1, 0], ['H', -0.3, 0.9, 0]], [[0, 1], [0, 2]]);
  relax(m); const r = dist(m, 0, 1), a = ang(m, 1, 0, 2);
  ok(Math.abs(r - 0.99) < 0.02 && Math.abs(a - 104.5) < 2.5, `H2O: O-H ${r.toFixed(3)} A, H-O-H ${a.toFixed(1)} deg (UFF 0.990 A, 104.5 deg)`);
}
{
  const m = new Mat(); m.buildBenzene(1, 1, () => 0.4); m.toChem(1); relax(m);
  let cc = 0; for (let k = 0; k < 6; k++) cc += dist(m, k, (k + 1) % 6) / 6;
  // UFF's aromatic rest length is 1.379 A; the 1-4 van der Waals across the ring stretches it towards experiment (1.397 A)
  ok(Math.abs(cc - 1.397) < 0.015, `benzene (chemistry): C-C ${cc.toFixed(3)} A (experiment 1.397; UFF rest length ${bondR0('C_R', 'C_R', 1.5).toFixed(3)}), types ${m.chem.type[0]}/${m.chem.type[6]}`);
}

/* ---------------- valence rules ---------------- */
{
  const m = molecule([['C', 0, 0, 0], ['H', 0.6, 0.6, 0.6], ['H', -0.6, -0.6, 0.6], ['H', -0.6, 0.6, -0.6], ['H', 0.6, -0.6, -0.6]], [[0, 1], [0, 2], [0, 3], [0, 4]]);
  const r1 = m.chem.attach(0, 'F', false, [20, 20, 20]), r2 = m.chem.attach(1, 'H', false, [20, 20, 20]);
  ok(!!r1.err && !!r2.err, `refused: "${r1.err}" / "${r2.err}"`);
  // a bare C with H fill: CH3 on it, then OH on the same C (the new CH3 carbon is full: H fill used its valence)
  const e = molecule([['C', 0, 0, 0]], []); const r3 = e.chem.attach(0, 'C', true, [20, 15, 15]); const r4 = e.chem.attach(0, 'O', true, [10, 15, 15]);
  const r5 = e.chem.attach(r3.atom, 'F', false, [25, 15, 15]);
  ok(!r3.err && !r4.err && e.N === 1 + 4 + 2 && !!r5.err, `attach with H fill: C + CH3 + OH -> ${e.N} atoms (expect 7); CH3 carbon then full: "${r5.err}"`);
}

/* ---------------- graphene: attach H, F, OH -> sp3 host, pucker, longer C-C ---------------- */
function centreAtom(m) { let cx = 0, cy = 0; for (let i = 0; i < m.N; i++) { cx += m.x[i] / m.N; cy += m.y[i] / m.N; } let b = 0, bd = 1e9; for (let i = 0; i < m.N; i++) { const d = Math.hypot(m.x[i] - cx, m.y[i] - cy); if (d < bd && m.chem.deg[i] === 3) { bd = d; b = i; } } return b; }
for (const [el, fill] of [['H', false], ['F', false], ['O', true]]) {
  const m = new Mat(); m.buildGraphene(8, 5, 1, 1, false, true); m.toChem(1);
  const host = centreAtom(m), nb = m.chem.neighbours(host);
  relax(m, 600); const z0 = m.z[host];
  const r = m.chem.attach(host, el, fill, [m.x[host], m.y[host], m.z[host] + 5]);
  relax(m, 4000);
  const plane = nb.reduce((s, j) => s + m.z[j], 0) / 3, pucker = m.z[host] - plane;
  const cc = nb.reduce((s, j) => s + dist(m, host, j), 0) / 3, ccc = (ang(m, nb[0], host, nb[1]) + ang(m, nb[1], host, nb[2]) + ang(m, nb[0], host, nb[2])) / 3, cx = dist(m, host, r.atom);
  ok(m.chem.type[host] === 'C_3' && pucker > 0.25 && cc > 1.46 && ccc < 116, `graphene + ${el}${fill ? 'H' : ''}: host ${m.chem.type[host]}, pulled ${pucker.toFixed(2)} A out of the sheet, C-C ${cc.toFixed(3)} A (sheet 1.42), C-C-C ${ccc.toFixed(1)} deg, C-${el} ${cx.toFixed(3)} A`);
}

/* ---------------- bond breaking and stability ---------------- */
{
  const m = new Mat(); m.buildGraphene(8, 5, 1, 1, false, true); m.toChem(1);
  const host = centreAtom(m), r = m.chem.attach(host, 'F', false, [m.x[host], m.y[host], m.z[host] + 5]);
  const nb0 = m.chem.bonds.length; m.thermostat = true; m.Ttarget = 300;
  m.ext.i = r.atom; m.ext.mode = 'atom'; m.ext.x = m.x[r.atom]; m.ext.y = m.y[r.atom]; m.ext.z = m.z[r.atom] + 6;
  m.run(3000); m.ext.i = -1;
  ok(m.chem.bonds.length === nb0 - 1 && !m.exploded, `pulling F 6 A off with the tweezers breaks exactly its bond (${nb0} -> ${m.chem.bonds.length} bonds), host back to ${m.chem.type[host]}`);
}
{
  const m = new Mat(); m.buildGraphene(9, 6, 300, 1, false, true); m.toChem(300);
  const ids = [centreAtom(m)]; for (let i = 0; i < m.N && ids.length < 5; i += 37) if (m.chem.deg[i] === 3) ids.push(i);
  ids.forEach((h, k) => m.chem.attach(h, ['F', 'H', 'O', 'F', 'H'][k], true, [m.x[h], m.y[h], m.z[h] + (k % 2 ? -5 : 5)]));
  const nb0 = m.chem.bonds.length; m.thermostat = true; m.Ttarget = 300; const t0 = Date.now(); m.run(4000);
  ok(!m.exploded && m.chem.bonds.length === nb0 && Math.abs(m.temperature() - 300) < 120, `decorated flake (${m.N} atoms, H/F/OH both sides) 2 ps at 300 K: no bond lost, T ${m.temperature().toFixed(0)} K, ${((Date.now() - t0) / 4000).toFixed(2)} ms/step`);
}

/* ---------------- transport: an adsorbate removes a pi orbital and scatters ---------------- */
{
  const sysOf = (m) => ({ N: m.N, x: m.x, y: m.y, z: m.z, per: m.per, L: [m.Lx, m.Ly, m.Lz], orb: (i) => m.sp[i] === SP.C && m.chem.deg[i] <= 3 });
  const ends = (m) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < m.N; i++) { lo = Math.min(lo, m.x[i]); hi = Math.max(hi, m.x[i]); } const a = [], b = []; for (let i = 0; i < m.N; i++) { if (m.x[i] < lo + 2.3) a.push(i); else if (m.x[i] > hi - 2.3) b.push(i); } return [a, b]; };
  const m = new Mat(); m.buildGraphene(9, 5, 1, 1, false, true); m.toChem(1); relax(m, 800);
  const [a, b] = ends(m), clean = analyse(sysOf(m), a, b, { gamma: 1, nE: 401 });
  const hosts = []; for (let i = 0; i < m.N && hosts.length < 6; i++) if (m.chem.deg[i] === 3 && !a.includes(i) && !b.includes(i) && i % 7 === 0) hosts.push(i);
  hosts.forEach((h) => m.chem.attach(h, 'H', false, [m.x[h], m.y[h], m.z[h] + 5])); relax(m, 1500);
  const dirty = analyse(sysOf(m), a, b, { gamma: 1, nE: 401 });
  let mc = 0, md = 0; for (let k = 0; k < 401; k++) { if (Math.abs(clean.E[k] - clean.EF) < 1) { mc += clean.T[k]; md += dirty.T[k]; } }
  ok(dirty.n === clean.n - hosts.length && md < 0.8 * mc, `6 H adatoms: ${clean.n} -> ${dirty.n} pi orbitals; mean T within 1 eV of E_F ${(mc / md).toFixed(2)}x lower`);
}
if (fail) { console.log(fail + ' FAILED'); process.exit(1); } else console.log('all chemistry tests passed');
