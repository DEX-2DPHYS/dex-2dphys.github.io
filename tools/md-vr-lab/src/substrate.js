// A static substrate under the structure: graphene, MoS2 (S-Mo-S) or amorphous SiO2. Its atoms never move, are not
// part of the MD (no integration, no bonds, no tools) and act on the moving atoms only through van der Waals:
// a 12-6 Lennard-Jones with UFF parameters, E = D[(x/r)^12 - 2(x/r)^6], x and D mixed geometrically, cut at RC (shifted).
import { SPECIES } from './materials.js';

const KCAL = 0.0433641;                           // kcal/mol -> eV
// UFF non-bonded: x = distance of the minimum (A), D = well depth (kcal/mol)
export const UFF_LJ = { H: [2.886, 0.044], B: [4.083, 0.180], C: [3.851, 0.105], N: [3.660, 0.069], O: [3.500, 0.060], F: [3.364, 0.050],
  Si: [4.295, 0.402], P: [4.147, 0.305], S: [4.035, 0.274], Cl: [3.947, 0.227], Br: [4.189, 0.251], I: [4.500, 0.339], Au: [3.293, 0.039], Mo: [3.052, 0.056], Ar: [3.868, 0.185] };
export const SUB_KINDS = [['none', 'None'], ['graphene', 'Graphene'], ['mos2', 'MoS₂'], ['sio2', 'SiO₂']];
const RC = 10, BIN = 10;
/* The pair parameters [x (A), D (eV)]. Carbon on carbon (a graphene substrate under carbon structures): sigma 3.40 A as the app's
   graphite stacks (x = 2^(1/6) sigma), and the depth set so that a flake on the substrate binds 45 meV per atom at 3.4 A - the
   bilayer-graphene interlayer binding (graphite exfoliation ~50 meV/atom). UFF's C-C (x 3.851 A, D 0.105 kcal/mol) bound it at
   72 meV per atom, about 1.6 times too strongly; the graphite stack's eps 4.2 meV gives 66 with this 10 A cutoff.
   Other pairs keep UFF. */
function pairXD(sym, el) {
  if (sym === 'C' && el === 'C') return [3.40 * Math.pow(2, 1 / 6), 0.0029];
  const a = UFF_LJ[sym] || UFF_LJ.C, b = UFF_LJ[el]; return [Math.sqrt(a[0] * b[0]), Math.sqrt(a[1] * b[1]) * KCAL];
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// local frame: (u, v) in the surface plane, w = height (w = 0 is the top layer); returns { u, v, w, el } arrays
function makeLayer(kind, R) {
  const U = [], V = [], W = [], E = [];
  const put = (u, v, w, el) => { if (u * u + v * v <= R * R) { U.push(u); V.push(v); W.push(w); E.push(el); } };
  const lattice = (a, fn) => { const n = Math.ceil(R / a) + 2; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const u = a * (i + j / 2), v = a * j * Math.sqrt(3) / 2; fn(u, v); } };
  if (kind === 'graphene') { const a = 2.46, b = a / Math.sqrt(3); lattice(a, (u, v) => { put(u, v, 0, 'C'); put(u, v + b, 0, 'C'); }); }
  else if (kind === 'mos2') { const a = 3.16, b = a / Math.sqrt(3); lattice(a, (u, v) => { put(u, v + b, 0, 'S'); put(u, v, -1.56, 'Mo'); put(u, v + b, -3.12, 'S'); }); }
  else if (kind === 'sio2') {                       // amorphous silica, 2.2 g/cm3 (O 0.044, Si 0.022 per A^3), 7 A thick, random but not overlapping
    const r = rng(20261101), T = 7, vol = Math.PI * R * R * T, pts = [];
    const ok = (u, v, w, min) => { for (const p of pts) { const d = (p[0] - u) ** 2 + (p[1] - v) ** 2 + (p[2] - w) ** 2; if (d < (min[p[3]]) ** 2) return false; } return true; };
    for (const [el, n, min] of [['O', Math.round(0.044 * vol), { O: 2.45, Si: 1.5 }], ['Si', Math.round(0.022 * vol), { O: 1.5, Si: 2.9 }]]) {
      let made = 0, tries = 0;
      while (made < n && tries < n * 60) { tries++; const ang = r() * 2 * Math.PI, rad = R * Math.sqrt(r()), u = rad * Math.cos(ang), v = rad * Math.sin(ang), w = -T * r(); if (ok(u, v, w, min)) { pts.push([u, v, w, el]); made++; } }
    }
    for (const p of pts) put(p[0], p[1], p[2] - 0.0, p[3]);
    const top = Math.max(...W); for (let k = 0; k < W.length; k++) W[k] -= top;            // highest atom at w = 0
  }
  return { U, V, W, E };
}

// build the substrate in simulation coordinates. axis = the 'up' axis of the structure ('z' for sheets, 'y' otherwise),
// centre = [a, b] in the plane, wTop = height of the top layer
export function buildSubstrate(kind, axis, centre, wTop, R) {
  if (kind === 'none') return null;
  const L = makeLayer(kind, R), n = L.U.length, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), el = [];
  for (let k = 0; k < n; k++) {
    const a = centre[0] + L.U[k], b = centre[1] + L.V[k], w = wTop + L.W[k];
    if (axis === 'z') { x[k] = a; y[k] = b; z[k] = w; } else { x[k] = a; y[k] = w; z[k] = b; }
    el.push(L.E[k]);
  }
  // 2-D bins over the plane for the force search
  const pa = axis === 'z' ? x : x, pb = axis === 'z' ? y : z;
  let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity; for (let k = 0; k < n; k++) { a0 = Math.min(a0, pa[k]); a1 = Math.max(a1, pa[k]); b0 = Math.min(b0, pb[k]); b1 = Math.max(b1, pb[k]); }
  const na = Math.max(1, Math.ceil((a1 - a0) / BIN) + 1), nb = Math.max(1, Math.ceil((b1 - b0) / BIN) + 1), cells = Array.from({ length: na * nb }, () => []);
  for (let k = 0; k < n; k++) cells[Math.floor((pa[k] - a0) / BIN) * nb + Math.floor((pb[k] - b0) / BIN)].push(k);
  const wMin = Math.min(...L.W) + wTop;
  return { kind, axis, n, x, y, z, el, R, wTop, wMin, a0, b0, na, nb, cells: cells.map((c) => Int32Array.from(c)), cu: centre[0], cv: centre[1] };
}


/* The crystalline substrates (graphene, MoS2) are periodic in the plane: the field they put on a moving atom of a given element repeats
   with the lattice. So it is computed once (per substrate kind and element) on a grid over one rectangular cell of the lattice
   (a x a*sqrt(3), about 0.1 A apart) and over heights W0..RC above the top layer (0.08 A), as energy and force, from an infinite patch of
   the lattice - and looked up with trilinear interpolation: a constant cost per atom instead of ~340 distance checks (the force call
   with a graphene substrate under a 238-atom flake went from 2.3 to ~0.3 ms). The corrugation (registry, moire) is kept. Atoms
   closer than W0 to the top layer, or near the edge of the disc, and the amorphous SiO2 use the direct sum (substrateForcesExact). */
const LATT = { graphene: 2.46, mos2: 3.16 }, W0 = 2.6, GSTEP = 0.1, WSTEP = 0.08, TABLES = new Map();      // (below W0 - on the steep wall - the direct sum)
function cellTable(kind, sym) {
  const key = kind + '|' + sym; if (TABLES.has(key)) return TABLES.get(key);
  const a = LATT[kind], b = a * Math.sqrt(3), nu = Math.round(a / GSTEP), nv = Math.round(b / GSTEP), nw = Math.ceil((RC - W0) / WSTEP) + 1;
  const du = a / nu, dv = b / nv, dw = (RC - W0) / (nw - 1), P = makeLayer(kind, RC + b + 2), np = P.U.length;
  const pr = P.E.map((el) => { const [X, D] = pairXD(sym, el), xr = (X / RC) ** 6; return [X * X, D, D * (xr * xr - 2 * xr)]; });
  const n = nu * nv * nw, E = new Float32Array(n), FU = new Float32Array(n), FV = new Float32Array(n), FW = new Float32Array(n), RC2 = RC * RC;
  for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nv; iv++) for (let iw = 0; iw < nw; iw++) {
    const u = iu * du, v = iv * dv, w = W0 + iw * dw; let e = 0, fu = 0, fv = 0, fw = 0;
    for (let k = 0; k < np; k++) {
      const x = u - P.U[k], y = v - P.V[k], z = w - P.W[k], r2 = x * x + y * y + z * z; if (r2 > RC2) continue;
      const p = pr[k], s2 = p[0] / r2, s6 = s2 * s2 * s2, ff = 12 * p[1] * (s6 * s6 - s6) / r2;
      e += p[1] * (s6 * s6 - 2 * s6) - p[2]; fu += ff * x; fv += ff * y; fw += ff * z;
    }
    const c = (iu * nv + iv) * nw + iw; E[c] = e; FU[c] = fu; FV[c] = fv; FW[c] = fw;
  }
  const t = { a, b, nu, nv, nw, du, dv, dw, E, FU, FV, FW }; TABLES.set(key, t); return t;
}
const _o = [0, 0, 0, 0];
function lookup(t, u, v, w) {                                     // trilinear: [E, Fu, Fv, Fw] at (u, v, w); u, v wrap with the lattice
  let fu = u / t.du, fv = v / t.dv; const fw = (w - W0) / t.dw;
  fu -= Math.floor(fu / t.nu) * t.nu; fv -= Math.floor(fv / t.nv) * t.nv;
  const i0 = Math.floor(fu), j0 = Math.floor(fv), k0 = Math.min(Math.floor(fw), t.nw - 2), a = fu - i0, b = fv - j0, c = fw - k0;
  const i1 = (i0 + 1) % t.nu, j1 = (j0 + 1) % t.nv, nv = t.nv, nw = t.nw;
  const c000 = (i0 * nv + j0) * nw + k0, c100 = (i1 * nv + j0) * nw + k0, c010 = (i0 * nv + j1) * nw + k0, c110 = (i1 * nv + j1) * nw + k0;
  const w000 = (1 - a) * (1 - b) * (1 - c), w100 = a * (1 - b) * (1 - c), w010 = (1 - a) * b * (1 - c), w110 = a * b * (1 - c);
  const w001 = (1 - a) * (1 - b) * c, w101 = a * (1 - b) * c, w011 = (1 - a) * b * c, w111 = a * b * c, arrs = [t.E, t.FU, t.FV, t.FW];
  for (let q = 0; q < 4; q++) { const A = arrs[q]; _o[q] = w000 * A[c000] + w100 * A[c100] + w010 * A[c010] + w110 * A[c110] + w001 * A[c000 + 1] + w101 * A[c100 + 1] + w011 * A[c010 + 1] + w111 * A[c110 + 1]; }
  return _o;
}
// van der Waals of the substrate on the moving atoms; adds forces, returns the energy (eV). The table where it applies, else the direct sum.
export function substrateForces(m, sub) {
  if (!LATT[sub.kind] || sub.exact) return substrateForcesExact(m, sub);
  const N = m.N, up = sub.axis === 'z' ? m.z : m.y, pa = m.x, pb = sub.axis === 'z' ? m.y : m.z, zAx = sub.axis === 'z', edge = sub.R - RC;
  let E = 0, rest = null;
  for (let i = 0; i < N; i++) {
    const w = up[i] - sub.wTop; if (w > RC) continue;
    const u = pa[i] - sub.cu, v = pb[i] - sub.cv;
    if (w < W0 || u * u + v * v > edge * edge) { (rest || (rest = [])).push(i); continue; }
    const t = sub.tab && sub.tab[m.sp[i]] || ((sub.tab || (sub.tab = []))[m.sp[i]] = cellTable(sub.kind, SPECIES[m.sp[i]].sym));
    const o = lookup(t, u, v, w); E += o[0];
    m.fx[i] += o[1]; if (zAx) { m.fy[i] += o[2]; m.fz[i] += o[3]; } else { m.fz[i] += o[2]; m.fy[i] += o[3]; }
  }
  if (rest) E += substrateForcesExact(m, sub, rest);
  return E;
}
// the direct sum over the substrate atoms in the nearby bins (all atoms, or only those in `only`)
export function substrateForcesExact(m, sub, only = null) {
  const N = only ? only.length : m.N, up = sub.axis === 'z' ? m.z : m.y, pa = m.x, pb = sub.axis === 'z' ? m.y : m.z, sa = sub.x, sb = sub.axis === 'z' ? sub.y : sub.z;
  const cache = sub.pair || (sub.pair = {}); let E = 0;
  for (let ii = 0; ii < N; ii++) {
    const i = only ? only[ii] : ii;
    if (up[i] - sub.wTop > RC) continue;                                      // too high above the surface to feel it
    const sym = SPECIES[m.sp[i]].sym, ia = Math.floor((pa[i] - sub.a0) / BIN), ib = Math.floor((pb[i] - sub.b0) / BIN);
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
      const A = ia + da, B = ib + db; if (A < 0 || B < 0 || A >= sub.na || B >= sub.nb) continue;
      const cell = sub.cells[A * sub.nb + B];
      for (let q = 0; q < cell.length; q++) {
        const k = cell[q], dx = m.x[i] - sub.x[k], dy = m.y[i] - sub.y[k], dz = m.z[i] - sub.z[k], r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > RC * RC) continue;
        const key = sym + sub.el[k]; let p = cache[key];
        if (!p) { const [X, D] = pairXD(sym, sub.el[k]), xr = (X / RC) ** 6; p = cache[key] = [X * X, D, D * (xr * xr - 2 * xr)]; }
        const s2 = p[0] / r2, s6 = s2 * s2 * s2, e = p[1] * (s6 * s6 - 2 * s6) - p[2], f = 12 * p[1] * (s6 * s6 - s6) / r2;   // f = -dE/dr / r
        E += e; m.fx[i] += f * dx; m.fy[i] += f * dy; m.fz[i] += f * dz;
      }
    }
  }
  return E;
}
