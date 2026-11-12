// node test/ribbons.test.mjs - graphene nanoribbons in the transport model (src/tb.js): the armchair families and their edge-bond
// correction, spin-polarised zigzag edges (mean-field Hubbard), structures without edge states left alone, the warm start, and
// edge roughness opening a transport gap in a ribbon that is metallic when perfect.
import { analyse, HUB } from '../src/tb.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const a = 2.46, b = a / Math.sqrt(3);
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const deg = (pts) => { const n = pts.map(() => 0); for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 1.6) { n[i]++; n[j]++; } return n; };
const clean = (pts) => { for (;;) { const n = deg(pts), k = pts.filter((p, i) => n[i] >= 2); if (k.length === pts.length) return pts; pts = k; } };
function lattice(xmin, xmax, ymin, ymax) {                         // honeycomb, x = zigzag direction, y = armchair direction
  const P = [], n = 80;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const x = i * a + j * a / 2, y = j * a * Math.sqrt(3) / 2; for (const [px, py] of [[x, y], [x, y + b]]) if (px >= xmin - 1e-6 && px <= xmax + 1e-6 && py >= ymin - 1e-6 && py <= ymax + 1e-6) P.push([px, py]); }
  return clean(P);
}
const armchair = (N, L = 60) => lattice(-1e-6, (N - 1) * a / 2 + 1e-6, 0, L);
const zigzag = (rows, L = 60) => lattice(0, L, 0.01, rows * 1.5 * b - 0.5 * b);
function run(pts, axis, U = 0, prev = null) {
  const N = pts.length, x = Float64Array.from(pts, (p) => p[0]), y = Float64Array.from(pts, (p) => p[1]), z = new Float64Array(N), t = axis === 'x' ? x : y;
  const lo = Math.min(...t), hi = Math.max(...t), cm = [], cp = []; for (let i = 0; i < N; i++) { if (t[i] < lo + 2.2) cm.push(i); if (t[i] > hi - 2.2) cp.push(i); }
  return analyse({ N, x, y, z, orb: () => true, per: [false, false, false], L: [400, 400, 400] }, cm, cp, { gamma: 1.0, nE: 801, Emin: -2, Emax: 2, curve: true, U, prev });
}

{ // armchair: N = 3p+1 gap raised by the edge correction (Son-Cohen-Louie: +8 dt/(3p+2) sin^2((p+1)pi/(3p+2)) = +0.28 eV for N = 7)
  const r7 = run(armchair(7), 'y'), r8 = run(armchair(8), 'y');
  ok(r7.edgeBonds > 0 && Math.abs(r7.gapHL - 1.55) < 0.1 && r7.gap > 1.3, `armchair N=7: ${r7.edgeBonds} edge dimers stiffened, HOMO-LUMO ${r7.gapHL.toFixed(2)} eV (nearest-neighbour 1.27 + 0.28 edge = 1.55; DFT ~1.5-1.6), transport gap ${r7.gap.toFixed(2)} eV`);
  ok(r8.gapHL > 0.08 && r8.gapHL < 0.3, `armchair N=8 (3p+2, metallic without the edge correction): small gap ${r8.gapHL.toFixed(2)} eV`);
}
{ // zigzag: metallic without U, a gap with spin-polarised edges
  const p0 = run(zigzag(6), 'x', 0), p = run(zigzag(6), 'x', HUB.U);
  ok(p0.gap === 0 && p0.TEF > 0.5, `zigzag 6 chains (1.3 nm), U = 0: metallic, T(EF) ${p0.TEF.toFixed(2)}`);
  ok(p.mf && p.mf.conv && p.mf.mmax > 0.08 && p.gap > 0.3 && p.gap < 0.8, `zigzag 6 chains, U = ${HUB.U} eV: edge moments ${p.mf.mmax.toFixed(2)} uB, transport gap ${p.gap.toFixed(2)} eV (LSDA ~0.5 eV), ${p.mf.it} iterations`);
  // warm start: the next geometry (slightly moved) starts from this solution
  const moved = zigzag(6).map(([x, y], i) => [x + 0.02 * Math.sin(i), y + 0.02 * Math.cos(3 * i)]), w = run(moved, 'x', HUB.U, p.mfState);
  ok(w.mf.warm && w.mf.it <= 0.6 * p.mf.it && w.mf.conv && Math.abs(w.mf.mmax - p.mf.mmax) < 0.03, `warm start for a slightly moved ribbon: ${w.mf.it} iterations instead of ${p.mf.it}, moments ${w.mf.mmax.toFixed(3)} vs ${p.mf.mmax.toFixed(3)}, converged ${w.mf.conv}`);
}
{ // no edge states: the mean field changes nothing
  const ring = Array.from({ length: 6 }, (_, k) => [1.4 * Math.cos(k * Math.PI / 3), 1.4 * Math.sin(k * Math.PI / 3)]);
  const sys = { N: 6, x: Float64Array.from(ring, (p) => p[0]), y: Float64Array.from(ring, (p) => p[1]), z: new Float64Array(6), orb: () => true, per: [false, false, false], L: [50, 50, 50] };
  const r0 = analyse(sys, [0], [3], { curve: false }), rU = analyse(sys, [0], [3], { curve: false, U: HUB.U, mfIt: 60 });     // (fully converged; live calls stop after 2 and continue next time)
  ok(rU.mf.mmax < 1e-3 && Math.abs(rU.TEF - r0.TEF) < 1e-3 * r0.TEF, `benzene para with U: no moments (${rU.mf.mmax.toExponential(1)}), T(EF) ${rU.TEF.toExponential(3)} = ${r0.TEF.toExponential(3)}`);
}
{ // edge roughness: the metallic N=8 ribbon, 15 nm long, with 20 % of its side-edge atoms removed, has a transport gap
  const r = rnd(41), pts = armchair(8, 150), n = deg(pts), ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  const rough = clean(pts.filter((p, i) => !(n[i] === 2 && p[1] > lo + 4 && p[1] < hi - 4 && r() < 0.2)));
  const g = run(rough, 'y');
  ok(g.TEF < 1e-3 && g.gap > 0.3, `armchair N=8, 15 nm, rough edges (${pts.length - rough.length} atoms gone): T(EF) ${g.TEF.toExponential(1)}, transport gap ${g.gap.toFixed(2)} eV (perfect: metallic)`);
}
console.log(fail ? fail + ' FAILED' : 'all ribbon tests passed'); process.exit(fail ? 1 : 0);
