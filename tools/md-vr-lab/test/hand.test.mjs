// node test/hand.test.mjs  - the Hand tool (Lego-style): pulled out of a sheet that is held in place, an atom breaks free;
// carried to the edge of the sheet it bonds again. Reactive model (Tersoff) and chemistry model (UFF).
import { Mat } from '../src/materials.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
export const HAND = { kk: 20, cap: 40 };      // eV/A^2 and eV/A, the same numbers main.js uses (HAND_PULL)
const piece = (m, a) => m.fragmentMask(a).n;
const centre = (m) => { let cx = 0, cy = 0; for (let i = 0; i < m.N; i++) { cx += m.x[i] / m.N; cy += m.y[i] / m.N; } let b = 0, bd = 1e9; for (let i = 0; i < m.N; i++) { const d = Math.hypot(m.x[i] - cx, m.y[i] - cy); if (d < bd) { bd = d; b = i; } } return b; };
// move the hand gradually from where the atom is to p, n steps of `per` MD steps
const carry = (m, a, p, n = 60, per = 40) => { const s = [m.x[a], m.y[a], m.z[a]]; for (let k = 1; k <= n; k++) { const f = k / n; m.ext.x = s[0] + (p[0] - s[0]) * f; m.ext.y = s[1] + (p[1] - s[1]) * f; m.ext.z = s[2] + (p[2] - s[2]) * f; m.run(per); } };

for (const chem of [false, true]) {
  const name = chem ? 'chemistry model' : 'reactive model';
  const m = new Mat(); m.buildGraphene(8, 5, 5, 1, false, true); if (chem) m.toChem(5); m.thermostat = true; m.Ttarget = 5; m.run(100);
  const a = centre(m), p0 = [m.x[a], m.y[a], m.z[a]];
  // grab with the Hand: the rest of the sheet is held where it is (as main.js grabAt does), pull 12 A up
  const rest = m.fragmentMask(a).mask; rest[a] = 0; m.ext.anchor = m.anchorFor(rest);
  Object.assign(m.ext, { i: a, mode: 'atom', mask: null, kk: HAND.kk, cap: HAND.cap });
  carry(m, a, [p0[0], p0[1], p0[2] + 12], 100, 40);
  const out = piece(m, a);
  ok(out <= 3 && !m.exploded, `${name}: pulled with the sheet held, the atom breaks free (it is now in a piece of ${out})`);
  // carry it over to the edge of the sheet (the anchor stays, as long as the hand holds) and let go next to an edge atom
  let e = -1, ex = -1e9; for (let i = 0; i < m.N; i++) if (piece(m, i) > m.N / 2 && m.x[i] > ex) { ex = m.x[i]; e = i; }
  carry(m, a, [m.x[e] + 3, m.y[e], m.z[e] + 2], 60, 40);
  carry(m, a, [m.x[e] + 1.4, m.y[e], m.z[e]], 60, 40);
  m.ext.i = -1; m.ext.anchor = null; m.ext.kk = 0; m.ext.cap = 0; m.run(1500);
  ok(piece(m, a) > m.N / 2 && !m.exploded, `${name}: brought to the edge of the sheet it bonds on again (now part of a piece of ${piece(m, a)} of ${m.N})`);
}
{ // without the anchor a floating sheet simply follows a slow pull; the gentle tweezers never break it
  const m = new Mat(); m.buildGraphene(8, 5, 5, 1, false, true); m.thermostat = true; m.Ttarget = 5; m.run(100);
  const a = centre(m), p0 = [m.x[a], m.y[a], m.z[a]];
  Object.assign(m.ext, { i: a, mode: 'atom', mask: null, kk: HAND.kk, cap: HAND.cap, anchor: null }); carry(m, a, [p0[0], p0[1], p0[2] + 12], 100, 40);
  ok(piece(m, a) > m.N / 2, `slow pull without the anchor: the floating sheet follows (the atom stays in a piece of ${piece(m, a)})`);
  const t = new Mat(); t.buildGraphene(8, 5, 5, 1, false, true); t.thermostat = true; t.Ttarget = 5; t.run(100);
  const b = centre(t), q0 = [t.x[b], t.y[b], t.z[b]], rest = t.fragmentMask(b).mask; rest[b] = 0; t.ext.anchor = t.anchorFor(rest);
  Object.assign(t.ext, { i: b, mode: 'atom', mask: null, kk: 0, cap: 0 }); carry(t, b, [q0[0], q0[1], q0[2] + 12], 100, 40);
  ok(piece(t, b) > t.N / 2, `the tweezers (gentle, 8 eV/A) do not tear an atom out: it stays in a piece of ${piece(t, b)}`);
}
console.log(fail ? fail + ' FAILED' : 'all hand tests passed'); process.exit(fail ? 1 : 0);
