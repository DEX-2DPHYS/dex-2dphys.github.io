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
  return { kind, axis, n, x, y, z, el, R, wTop, wMin, a0, b0, na, nb, cells: cells.map((c) => Int32Array.from(c)) };
}

// van der Waals of the substrate on the moving atoms; adds forces, returns the energy (eV)
export function substrateForces(m, sub) {
  const N = m.N, up = sub.axis === 'z' ? m.z : m.y, pa = m.x, pb = sub.axis === 'z' ? m.y : m.z, sa = sub.x, sb = sub.axis === 'z' ? sub.y : sub.z;
  const cache = sub.pair || (sub.pair = {}); let E = 0;
  for (let i = 0; i < N; i++) {
    if (up[i] - sub.wTop > RC) continue;                                      // too high above the surface to feel it
    const sym = SPECIES[m.sp[i]].sym, ia = Math.floor((pa[i] - sub.a0) / BIN), ib = Math.floor((pb[i] - sub.b0) / BIN);
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
      const A = ia + da, B = ib + db; if (A < 0 || B < 0 || A >= sub.na || B >= sub.nb) continue;
      const cell = sub.cells[A * sub.nb + B];
      for (let q = 0; q < cell.length; q++) {
        const k = cell[q], dx = m.x[i] - sub.x[k], dy = m.y[i] - sub.y[k], dz = m.z[i] - sub.z[k], r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > RC * RC) continue;
        const key = sym + sub.el[k]; let p = cache[key];
        if (!p) { const a = UFF_LJ[sym] || UFF_LJ.C, b = UFF_LJ[sub.el[k]], X = Math.sqrt(a[0] * b[0]), D = Math.sqrt(a[1] * b[1]) * KCAL, xr = (X / RC) ** 6; p = cache[key] = [X * X, D, D * (xr * xr - 2 * xr)]; }
        const s2 = p[0] / r2, s6 = s2 * s2 * s2, e = p[1] * (s6 * s6 - 2 * s6) - p[2], f = 12 * p[1] * (s6 * s6 - s6) / r2;   // f = -dE/dr / r
        E += e; m.fx[i] += f * dx; m.fy[i] += f * dy; m.fz[i] += f * dz;
      }
    }
  }
  return E;
}
