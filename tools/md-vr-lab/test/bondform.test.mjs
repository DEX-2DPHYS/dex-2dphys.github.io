// node test/bondform.test.mjs  - chemistry mode: bonds FORM when a radical meets an atom with a free valence
// (a loose carbon pushed onto graphene, onto a bare edge), and stacked layers never fuse.
import { Mat, SP } from '../src/materials.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const dist = (m, i, j) => Math.hypot(m.x[i] - m.x[j], m.y[i] - m.y[j], m.z[i] - m.z[j]);
const centre = (m) => { let cx = 0, cy = 0; for (let i = 0; i < m.N; i++) { cx += m.x[i] / m.N; cy += m.y[i] / m.N; } let b = 0, bd = 1e9; for (let i = 0; i < m.N; i++) { const d = Math.hypot(m.x[i] - cx, m.y[i] - cy); if (d < bd) { bd = d; b = i; } } return b; };
// push atom a towards the point (x,y,z) with the tweezers spring, n steps
const push = (m, a, p, n) => { Object.assign(m.ext, { i: a, mode: 'atom', mask: null, x: p[0], y: p[1], z: p[2] }); m.run(n); m.ext.i = -1; };

{ // a lone carbon pushed onto the middle of a graphene flake binds there; the host goes sp3
  const m = new Mat(); m.buildGraphene(8, 5, 1, 1, false, true); m.toChem(1); m.thermostat = true; m.Ttarget = 5;
  const h = centre(m), n0 = m.chem.bonds.length, a = m.N; m.addRaw(SP.C, m.x[h], m.y[h], m.z[h] + 3.2, 0); m.chem.dirty = true; m.listDirty = true;
  m.run(200);
  ok(!m.chem.bonded(a, h), `a carbon 3.2 A above the sheet does not bond by itself (bonds ${m.chem.bonds.length - n0})`);
  push(m, a, [m.x[h], m.y[h], m.z[h] + 1.4], 1500); m.run(1500);
  ok(m.chem.bonded(a, h) && dist(m, a, h) < 1.75 && m.chem.type[h] === 'C_3', `pushed onto the sheet it bonds: C-C ${dist(m, a, h).toFixed(2)} A, host now ${m.chem.type[h]}`);
  ok(!m.exploded, 'stays stable');
}
{ // a lone carbon pushed onto a bare edge carbon bonds there
  const m = new Mat(); m.buildGraphene(8, 5, 1, 1, false, true); m.toChem(1); m.thermostat = true; m.Ttarget = 5;
  let e = -1; for (let i = 0; i < m.N; i++) if (m.chem.open(i)) { e = i; break; }
  let cx = 0, cy = 0; for (let i = 0; i < m.N; i++) { cx += m.x[i] / m.N; cy += m.y[i] / m.N; }
  const ux = m.x[e] - cx, uy = m.y[e] - cy, u = Math.hypot(ux, uy), a = m.N;
  m.addRaw(SP.C, m.x[e] + 3 * ux / u, m.y[e] + 3 * uy / u, m.z[e], 0); m.chem.dirty = true; m.listDirty = true;
  push(m, a, [m.x[e], m.y[e], m.z[e]], 1500); m.run(1000);
  ok(e >= 0 && m.chem.bonded(a, e), `pushed onto a bare edge carbon it bonds (C-C ${dist(m, a, e).toFixed(2)} A)`);
}
{ // two stacked layers in the chemistry model stay apart at 600 K: no bonds between them
  const m = new Mat(); m.buildGraphite(6, 4, 2, 600, true); m.toChem(600); m.thermostat = true; m.Ttarget = 600;
  const lay = (i) => m.grp[i];
  m.run(3000);
  let cross = 0; for (const [i, j] of m.chem.bonds) if (lay(i) !== lay(j)) cross++;
  ok(cross === 0 && !m.exploded, `graphite bilayer at 600 K for 3000 steps: ${cross} bonds between the layers`);
}
console.log(fail ? fail + ' FAILED' : 'all bond-formation tests passed'); process.exit(fail ? 1 : 0);
