// node test/transport.test.mjs  - open flakes stay intact; tight-binding transport: eigen solver, Green's function
// against closed forms, current conservation, benzene quantum interference, gap / no gap, speed.
import { Mat, SP, TU_FS } from '../src/materials.js';
import { eigSym, Transport, buildHamiltonian, analyse, TBP } from '../src/tb.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const rng = (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();

/* ---------------- open flakes (no periodic boundaries) ---------------- */
function bondsPerAtom(md, rb) {
  let s = 0; for (let i = 0; i < md.N; i++) for (let j = 0; j < md.N; j++) { if (i === j) continue; if (md.model === 'sw' && md.sp[i] === md.sp[j]) continue; const d = Math.hypot(md.x[i] - md.x[j], md.y[i] - md.y[j], md.z[i] - md.z[j]); if (d < rb) s++; }
  return s / md.N;
}
for (const [label, build, rb] of [
  ['graphene flake', (m) => m.buildGraphene(8, 5, 300, 1, false, true), 1.8],
  ['graphite flake (3 layers)', (m) => m.buildGraphite(7, 4, 3, 300, true), 1.8],
  ['MoS2 flake', (m) => m.buildMoS2(7, 4, 1, 300, true), 2.8],
]) {
  const md = new Mat(); build(md);
  const z0 = bondsPerAtom(md, rb), n0 = md.N;
  md.thermostat = true; md.Ttarget = 300; const t0 = Date.now(); md.run(3000);
  const z1 = bondsPerAtom(md, rb), T = md.temperature();
  ok(md.per.every((p) => !p) && md.sheet, `${label}: built open (no periodic axis), ${n0} atoms`);
  ok(!md.exploded && Math.abs(z1 - z0) < 0.25 && Math.abs(T - 300) < 120, `${label}: 3000 steps (${(3000 * md.dt * TU_FS / 1000).toFixed(1)} ps) at 300 K stable - bonds/atom ${z0.toFixed(2)} -> ${z1.toFixed(2)}, T = ${T.toFixed(0)} K (${Date.now() - t0} ms)`);
}
{ // the periodic sheet is unchanged by the option: same atoms in the same places
  const a = new Mat(), b = new Mat(); a.buildGraphene(6, 3, 0); b.buildGraphene(6, 3, 0, 1, false, false);
  let d = 0; for (let i = 0; i < a.N; i++) d = Math.max(d, Math.abs(a.x[i] - b.x[i]) + Math.abs(a.y[i] - b.y[i]));
  ok(a.N === b.N && d === 0 && a.per[0] && a.per[1], 'periodic sheet (default) identical to before');
}

/* ---------------- eigen solver ---------------- */
{
  const n = 70, A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) A[i * n + j] = A[j * n + i] = rng() * 2 - 1;
  const { w, U } = eigSym(A, n); let res = 0, orth = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += A[i * n + j] * U[k * n + j]; res = Math.max(res, Math.abs(s - w[k] * U[k * n + i])); }
  for (let a = 0; a < n; a += 7) for (let b = 0; b < n; b += 5) { let s = 0; for (let i = 0; i < n; i++) s += U[a * n + i] * U[b * n + i]; orth = Math.max(orth, Math.abs(s - (a === b ? 1 : 0))); }
  let sorted = true; for (let k = 1; k < n; k++) if (w[k] < w[k - 1]) sorted = false;
  ok(res < 1e-11 && orth < 1e-11 && sorted, `eigSym 70x70: |Au - wu| = ${res.toExponential(1)}, orthonormality ${orth.toExponential(1)}`);
}

/* ---------------- Green's function against closed forms ---------------- */
{ // one site, both contacts on it: T = g^2 / (E^2 + g^2)  (total width 2 * g/2)
  const g = 0.8, tr = new Transport({ n: 1, H: Float64Array.of(0), pairs: new Int32Array(0) }, [0], [0], g); let err = 0;
  for (const E of [-2, -0.5, 0, 0.3, 1.7]) err = Math.max(err, Math.abs(tr.transmission(E) - g * g / (E * E + g * g)));
  ok(err < 1e-8, `single level: T(E) = Breit-Wigner to ${err.toExponential(1)} (limit: the 1e-9 eV broadening)`);
}
{ // dimer with hopping t, "-" on site 0, "+" on site 1: T = g^2 |t|^2 / |(E + i g/2)^2 - t^2|^2
  const g = 0.6, t = -1.3, tr = new Transport({ n: 2, H: Float64Array.of(0, t, t, 0), pairs: Int32Array.of(0, 1) }, [0], [1], g); let err = 0;
  for (const E of [-2, -1.3, 0, 0.4, 1.3, 2.5]) {
    const ar = E * E - g * g / 4 - t * t, ai = E * g, Tex = g * g * t * t / (ar * ar + ai * ai);
    err = Math.max(err, Math.abs(tr.transmission(E) - Tex));
    const J = tr.bondCurrents(E); err = Math.max(err, Math.abs(J[0] - Tex));       // the one bond carries everything
  }
  ok(err < 1e-6, `dimer: T(E) and bond current = closed form to ${err.toExponential(1)} (also fixes the current sign)`);
}

/* ---------------- current conservation in a real flake ---------------- */
function flakeSys(md) { return { N: md.N, x: md.x, y: md.y, z: md.z, per: md.per, L: [md.Lx, md.Ly, md.Lz], orb: (i) => md.sp[i] === SP.C }; }
function edgeContacts(md, w = 2.2) {             // atoms within w A of the left / right ends
  let lo = 1e9, hi = -1e9; for (let i = 0; i < md.N; i++) { lo = Math.min(lo, md.x[i]); hi = Math.max(hi, md.x[i]); }
  const m = [], p = []; for (let i = 0; i < md.N; i++) { if (md.x[i] < lo + w) m.push(i); else if (md.x[i] > hi - w) p.push(i); }
  return [m, p];
}
{
  const md = new Mat(); md.buildGraphene(6, 3, 0, 1, false, true);
  const ham = buildHamiltonian(flakeSys(md)), o = new Map(ham.idx.map((a, k) => [a, k]));
  const [m, p] = edgeContacts(md), cm = m.map((a) => o.get(a)), cp = p.map((a) => o.get(a));
  const tr = new Transport(ham, cm, cp, 1.0), cset = new Set(cm.concat(cp));
  let worstK = 0, worstOut = 0, scale = 0;
  for (const E of [tr.EF - 1.1, tr.EF + 0.37, tr.EF + 1.9]) {
    const J = tr.bondCurrents(E), T = tr.transmission(E), net = new Float64Array(ham.n); let out = 0;
    for (let q = 0; q < J.length; q++) {
      const a = ham.pairs[2 * q], b = ham.pairs[2 * q + 1]; net[a] += J[q]; net[b] -= J[q];
      const am = cm.includes(a), bm = cm.includes(b); if (am && !bm) out += J[q]; else if (bm && !am) out -= J[q];
    }
    for (let k = 0; k < ham.n; k++) if (!cset.has(k)) worstK = Math.max(worstK, Math.abs(net[k]));
    worstOut = Math.max(worstOut, Math.abs(out - T) / Math.max(T, 1e-12)); scale = Math.max(scale, T);
  }
  ok(worstK < 1e-7 * Math.max(1, scale), `graphene flake (${ham.n} orbitals): Kirchhoff at every inner atom to ${worstK.toExponential(1)}`);
  ok(worstOut < 1e-6, `current leaving the "-" contact = T(E) to ${worstOut.toExponential(1)} (relative)`);
}

/* ---------------- quantum interference in benzene ---------------- */
{
  const md = new Mat(); md.buildBenzene(1, 1, () => 0.31);
  const sys = flakeSys(md);
  const para = analyse(sys, [0], [3], { gamma: 0.5, nE: 601 }), meta = analyse(sys, [0], [2], { gamma: 0.5, nE: 601 }), ortho = analyse(sys, [0], [1], { gamma: 0.5, nE: 601 });
  // EF sits in the middle of a 5 eV HOMO-LUMO gap, so para and ortho transmit only off-resonance - but meta cancels
  ok(para.n === 6 && meta.TEF < 0.01 * para.TEF, `benzene meta: T(EF) = ${meta.TEF.toExponential(2)} vs para ${para.TEF.toExponential(2)} - destructive interference, ${(para.TEF / meta.TEF).toFixed(0)}x lower`);
  ok(ortho.TEF > 100 * meta.TEF, `benzene ortho: T(EF) = ${ortho.TEF.toExponential(2)} (constructive, like para)`);
  let pk = 0; for (let k = 0; k < para.T.length; k++) pk = Math.max(pk, para.T[k]);
  ok(pk > 0.9, `benzene para: on resonance with a molecular level T reaches ${pk.toFixed(3)} (ideal 1)`);
  ok(Math.abs(para.gapHL - 2 * 2.7 * Math.exp(TBP.qp * (1 - 1.40 / TBP.a0))) < 0.7, `benzene HOMO-LUMO gap ${para.gapHL.toFixed(2)} eV (Hückel 2|t| ~ ${(2 * 2.7 * Math.exp(TBP.qp * (1 - 1.40 / TBP.a0))).toFixed(2)})`);
}

/* ---------------- gap or no gap: carbon chains ---------------- */
function chain(n, d1, d2) {
  const md = new Mat(); md.clear(); md.model = 'tersoff'; md.Lx = md.Ly = md.Lz = 400; md.per = [false, false, false];
  let x = 10; for (let i = 0; i < n; i++) { md.addRaw(SP.C, x, 20, 20, 0); x += i % 2 ? d2 : d1; }
  return md;
}
{
  const uni = chain(40, 1.42, 1.42), dim = chain(40, 1.34, 1.52);
  const ru = analyse(flakeSys(uni), [0], [39], { gamma: 1.0 }), rd = analyse(flakeSys(dim), [0], [39], { gamma: 1.0 });
  const t1 = 2.7 * Math.exp(TBP.qp * (1 - 1.34 / TBP.a0)), t2 = 2.7 * Math.exp(TBP.qp * (1 - 1.52 / TBP.a0));
  ok(ru.gap === 0 && ru.TEF > 1e4 * rd.TEF, `uniform carbon chain: no transport gap, T(EF) = ${ru.TEF.toFixed(2)}`);
  const k2 = Math.round(0.2 / 2 * 80);   // the live current at the bias must match the full I(V) curve
  ok(Math.abs(ru.Ibias - ru.I[k2]) < 0.03 * ru.I[k2], `live current at 0.2 V ${(ru.Ibias * 1e6).toFixed(3)} uA = I(V) curve ${(ru.I[k2] * 1e6).toFixed(3)} uA`);
  ok(rd.TEF < 1e-3 && Math.abs(rd.gap - 2 * Math.abs(t1 - t2)) < 0.35, `dimerised chain (Peierls): T(EF) = ${rd.TEF.toExponential(1)}, transport gap ${rd.gap.toFixed(2)} eV vs 2|t1-t2| = ${(2 * Math.abs(t1 - t2)).toFixed(2)} eV`);
  const k = Math.round(0.5 / 2 * 80);      // current at 0.5 V
  ok(rd.I[k] < 0.02 * ru.I[k], `I(0.5 V): ${(ru.I[k] * 1e6).toFixed(2)} uA (uniform) vs ${(rd.I[k] * 1e6).toExponential(1)} uA (gapped)`);
}

/* ---------------- speed ---------------- */
{
  const md = new Mat(); md.buildGraphene(11, 7, 0, 1, false, true);
  const [m, p] = edgeContacts(md);
  const r = analyse(flakeSys(md), m, p, { gamma: 1.0 });
  ok(r.ms < 4000, `graphene flake ${r.n} orbitals: full analysis ${r.ms.toFixed(0)} ms (diagonalisation ${r.msEig.toFixed(0)} ms), T(EF) = ${r.TEF.toFixed(2)}`);
}
if (fail) { console.log(fail + ' FAILED'); process.exit(1); } else console.log('all transport tests passed');
