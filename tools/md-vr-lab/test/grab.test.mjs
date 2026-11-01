// node test/grab.test.mjs  - tweezers "Grab: piece": a loose fragment moves as one unit, the rest stays where it is.
import { Mat, SP } from '../src/materials.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const com = (m, idx) => { let a = 0, b = 0, c = 0; for (const i of idx) { a += m.x[i]; b += m.y[i]; c += m.z[i]; } return [a / idx.length, b / idx.length, c / idx.length]; };
const m = new Mat(); m.buildC60(1);
const cage = Array.from({ length: m.N }, (_, i) => i), cx = com(m, cage);
const d0 = m.N; m.addRaw(SP.C, cx[0] + 12, cx[1], cx[2], 0); m.addRaw(SP.C, cx[0] + 13.3, cx[1], cx[2], 0); m.listDirty = true;
const dimer = [d0, d0 + 1];
const fA = m.fragmentMask(d0), fB = m.fragmentMask(0);
ok(fA.n === 2 && fB.n === 60 && !fA.mask[0] && !fB.mask[d0], `pieces found: dimer ${fA.n} atoms, cage ${fB.n} atoms, kept apart`);
m.run(200);                                  // settle the dimer bond before pulling
const c0 = com(m, cage), q0 = com(m, dimer);
Object.assign(m.ext, { i: d0, mode: 'frag', mask: fA.mask, x: q0[0], y: q0[1] + 6, z: q0[2] });
m.run(8000);
const c1 = com(m, cage), q1 = com(m, dimer), dy = q1[1] - q0[1], cage_ = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
const r = Math.hypot(m.x[d0] - m.x[d0 + 1], m.y[d0] - m.y[d0 + 1], m.z[d0] - m.z[d0 + 1]);
ok(dy > 5 && cage_ < 0.5 && r < 1.6, `pulled piece moved ${dy.toFixed(2)} A towards the hand, still bonded (${r.toFixed(2)} A); the cage moved ${cage_.toFixed(2)} A`);
// atom mode on the same piece pulls only the grabbed atom (the other follows through the bond)
Object.assign(m.ext, { i: -1, mask: null, mode: 'atom' });
console.log(fail ? fail + ' FAILED' : 'all grab tests passed'); process.exit(fail ? 1 : 0);
