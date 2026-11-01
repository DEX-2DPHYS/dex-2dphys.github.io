// Materials MD engine in real units: Angstrom, eV, amu, K.  Time unit TU = sqrt(amu*A^2/eV) = 10.18 fs.
//
// Models (all parameters taken from published sets distributed with LAMMPS):
//   tersoff  - carbon. 'graphene': Lindsay & Broido, PRB 81, 205441 (2010) (optimised for graphene/CNT phonons)
//              'diamond': Tersoff, PRB 39, 5566 (1989) carbon (diamond, cohesive energy 7.37 eV)
//   sw       - MoS2: Stillinger-Weber set of J.-W. Jiang, Acta Mech. Solida Sin. 32, 17 (2019) (tmd.sw.mod)
//   ff       - benzene: harmonic bonds/angles + out-of-plane terms with OPLS-AA bond/angle constants,
//              OPLS-AA Lennard-Jones and partial charges between molecules.
// Van der Waals between layers/molecules: shifted-force Lennard-Jones between atoms of *different groups*
// (graphite: C-C epsilon/sigma from the usual graphite LJ set; MoS2: effective S/Mo values tuned in
// test/materials.test.mjs to the bulk interlayer spacing and binding energy).
export const KB = 8.617333262e-5;           // eV/K
export const TU_FS = 10.1805055;            // fs per time unit
import { Chem } from './chem.js';
import { substrateForces } from './substrate.js';
const OPEN_MARGIN = 10;                      // A of vacuum round an open flake (its box is display/tweezers room only)
// equilibrium lattice parameters of the potentials themselves (found by scanning, see test/materials.test.mjs)
export const GR_B = 1.438;                  // C-C bond in graphene, Lindsay-Broido Tersoff
export const MOS2 = { a: 3.12, h: 1.559 };  // SW(mod) minimum: a = 3.12 A (exp. 3.16), S height 1.56 A (Mo-S 2.40 A, exp. 2.41)
export const SP = { C: 0, H: 1, Mo: 2, S: 3, B: 4, N: 5, O: 6, F: 7, Si: 8, P: 9, Cl: 10, Br: 11, I: 12, Au: 13 };
export const SPECIES = [
  { sym: 'C', mass: 12.011, color: 0x4d5360, r: 0.46, bond: 1.9 },
  { sym: 'H', mass: 1.008, color: 0xf2f2f2, r: 0.28, bond: 1.3 },
  { sym: 'Mo', mass: 95.95, color: 0x4fb3b3, r: 0.72, bond: 2.9 },
  { sym: 'S', mass: 32.06, color: 0xf2d43d, r: 0.62, bond: 2.9 },
  // Chemistry mode (src/chem.js) adds the rest of the main groups; colours after the usual CPK scheme
  { sym: 'B', mass: 10.81, color: 0xffb5b5, r: 0.44, bond: 2.0 },
  { sym: 'N', mass: 14.007, color: 0x3a5cf0, r: 0.42, bond: 1.9 },
  { sym: 'O', mass: 15.999, color: 0xe8322b, r: 0.40, bond: 1.9 },
  { sym: 'F', mass: 18.998, color: 0x8fe05a, r: 0.38, bond: 1.9 },
  { sym: 'Si', mass: 28.085, color: 0xd9b48a, r: 0.58, bond: 2.5 },
  { sym: 'P', mass: 30.974, color: 0xff8a1f, r: 0.55, bond: 2.5 },
  { sym: 'Cl', mass: 35.45, color: 0x36d636, r: 0.52, bond: 2.4 },
  { sym: 'Br', mass: 79.904, color: 0xa83b2c, r: 0.58, bond: 2.6 },
  { sym: 'I', mass: 126.904, color: 0x8a2be2, r: 0.66, bond: 2.9 },
  { sym: 'Au', mass: 196.967, color: 0xf2c14e, r: 0.72, bond: 2.9 },
];
const KCAL = 0.0433641153;                  // kcal/mol -> eV
const KE_COUL = 14.399645;                  // eV*A / e^2

export const TERSOFF = {
  diamond:  { A: 1393.6, B: 346.74, l1: 3.4879, l2: 2.2119, beta: 1.5724e-7, n: 0.72751, c: 38049, d: 4.3484, h: -0.57058, R: 1.95, D: 0.15 },
  graphene: { A: 1393.6, B: 430.00, l1: 3.4879, l2: 2.2119, beta: 1.5724e-7, n: 0.72751, c: 38049, d: 4.3484, h: -0.93000, R: 1.95, D: 0.15 },
};
// Jiang SW (LAMMPS 'sw/mod' with maxdelcs 0.25 0.35), Mo-S: pair (Mo S S) and (S Mo Mo); three-body lambda for centre Mo (S,S) and centre S (Mo,Mo)
export const SW = { eps: 1.0, sigma: 1.252, a: 2.523, A: 6.918, B: 7.223, p: 4, cos0: 0.143, d1: 0.25, d2: 0.35, gamma: 1.0, lamMoSS: 67.883, lamSMoMo: 62.449 };

// van der Waals: [epsilon eV, sigma A] per species pair index a*4+b
function vdwTable(spec) { const e = new Float64Array(16), s = new Float64Array(16); for (const [a, b, eps, sig] of spec) { e[a * 4 + b] = e[b * 4 + a] = eps; s[a * 4 + b] = s[b * 4 + a] = sig; } return { e, s }; }
export const VDW = {
  graphite: vdwTable([[0, 0, 0.0042, 3.40]]),
  mos2: vdwTable([[3, 3, 0.0207, 3.12], [2, 3, 0.0058, 3.20], [2, 2, 0.00145, 3.40]]),
  benzene: vdwTable([[0, 0, 0.070 * KCAL, 3.550], [1, 1, 0.030 * KCAL, 2.420], [0, 1, Math.sqrt(0.070 * 0.030) * KCAL, Math.sqrt(3.550 * 2.420)]]),
};
const BENZENE_Q = [-0.115, 0.115, 0, 0];

const fc = (r, R, D) => r < R - D ? 1 : r > R + D ? 0 : 0.5 - 0.5 * Math.sin(Math.PI / 2 * (r - R) / D);
const dfc = (r, R, D) => (r < R - D || r > R + D) ? 0 : -0.25 * Math.PI / D * Math.cos(Math.PI / 2 * (r - R) / D);

export class Mat {
  constructor(maxN = 1200) {
    this.maxN = maxN; const f = () => new Float64Array(maxN);
    this.x = f(); this.y = f(); this.z = f(); this.vx = f(); this.vy = f(); this.vz = f(); this.fx = f(); this.fy = f(); this.fz = f();
    this.cx = f(); this.cy = f(); this.cz = f(); this.xr = f(); this.yr = f(); this.zr = f();
    this.fixed = new Uint8Array(maxN);                             // atoms held in place (electrode pads)
    this.mass = f(); this.sp = new Uint8Array(maxN); this.grp = new Int16Array(maxN); this.z_ = new Float32Array(maxN);
    this.N = 0; this.Lx = 20; this.Ly = 20; this.Lz = 20; this.per = [false, false, false];
    this.model = 'none'; this.tp = TERSOFF.graphene; this.vdw = null; this.charges = false;
    this.dt = 0.05; this.thermostat = true; this.Ttarget = 300; this.tauT = 40;     // tau in TU (~0.4 ps)
    this.time = 0; this.step = 0; this.PE = 0; this.KE = 0; this.markTime = 0; this.exploded = false;
    this.ext = { i: -1, x: 0, y: 0, z: 0, k: 4, mode: 'atom' }; this.extForce = 0; this.extForceEV = 0;
    this.skinC = 0.6; this.skinV = 1.4; this.listDirty = true;
    this.grpK = 0.02; this.grpCap = 0.12; this.grpGam = 0.5;      // tweezers on a whole layer/molecule: stiffness, force cap (per atom, eV/A), damping
    this.bi = new Int32Array(1 << 14); this.bj = new Int32Array(1 << 14); this.nb = 0;     // covalent half list
    this.vi = new Int32Array(1 << 16); this.vj = new Int32Array(1 << 16); this.nv = 0;     // vdW half list
    this.start = new Int32Array(maxN + 1); this.nbr = new Int32Array(1 << 14);              // covalent full list (CSR)
    this.bonds = []; this.angles = []; this.oops = [];                                       // topology for 'ff'
    this.rdfBins = 120; this.rdfMax = 6; this.rdfHist = new Float64Array(this.rdfBins); this.rdfSamples = 0; this.rdfWant = false;
    this.label = ''; this.name = ''; this.chem = new Chem(this);
    this.scratch = { j: new Int32Array(64), dx: new Float64Array(64), dy: new Float64Array(64), dz: new Float64Array(64), r: new Float64Array(64), fc: new Float64Array(64), dfc: new Float64Array(64) };
  }
  get isMat() { return true; }
  get density() { return this.N; }
  get periodicAny() { return this.per[0] || this.per[1] || this.per[2]; }

  clear() { this.sub = null; this.sheet = false; this.N = 0; this.time = 0; this.step = 0; this.exploded = false; this.bonds = []; this.angles = []; this.oops = []; this.listDirty = true; this.ext.i = -1; this.resetRDF(); }

  addRaw(sp, x, y, z, grp) {
    const i = this.N++; this.sp[i] = sp; this.mass[i] = SPECIES[sp].mass; this.grp[i] = grp; this.fixed[i] = 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = this.vy[i] = this.vz[i] = 0; this.cx[i] = this.cy[i] = this.cz[i] = 0; this.z_[i] = 0; this.listDirty = true; return i;
  }

  /* ---------------- structure builders ---------------- */
  // graphene sheet: nx*ny rectangular 4-atom cells (zigzag along x), periodic in x and y -
  // or, with open = true, a free-standing flake: no periodic images, vacuum all round, dangling edge atoms removed
  buildGraphene(nx, ny, T0, layers = 1, stacked = false, open = false) {
    this.clear(); this.model = 'tersoff'; this.tp = TERSOFF.graphene; this.vdw = stacked ? VDW.graphite : null; this.charges = false;
    const b = GR_B, a = Math.sqrt(3) * b, dz = 3.35, vac = 14, M = open ? OPEN_MARGIN : 0;
    if (stacked && !open) { nx = Math.max(nx, Math.ceil(17 / a)); ny = Math.max(ny, Math.ceil(17 / (3 * b))); }
    if (4 * nx * ny * layers > this.maxN) throw new Error('too many atoms - choose a smaller sheet');
    this.Lx = nx * a + 2 * M; this.Ly = ny * 3 * b + 2 * M; this.Lz = (layers - 1) * dz + vac; this.per = open ? [false, false, false] : [true, true, false];
    const Px = nx * a, Py = ny * 3 * b, wrap = (v, Lm) => open ? v : ((v % Lm) + Lm) % Lm;
    const z0 = this.Lz / 2 - (layers - 1) * dz / 2;
    for (let L = 0; L < layers; L++) {
      const sy = (L % 2) * b;                                  // AB (Bernal) stacking: shift of one bond length
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (const [px, py] of [[0, 0], [a / 2, b / 2], [a / 2, 1.5 * b], [0, 2 * b]])
        this.addRaw(SP.C, M + wrap(i * a + px, Px), M + wrap(j * 3 * b + py + sy, Py), z0 + L * dz, L);
    }
    if (open) this.trimEdges(1.7, 2);
    this.sheet = true;
    this.name = open ? (layers === 1 ? 'Graphene flake' : `Graphite flake, ${layers} layers`) : (layers === 1 ? 'Graphene' : `Graphite (${layers} layers, AB)`);
    this.finish(T0, 0.5);
  }
  // graphite = stacked graphene with vdW between layers
  buildGraphite(nx, ny, layers, T0, open = false) { this.buildGraphene(nx, ny, T0, layers, true, open); }

  // MoS2 2H: 1 or 2 layers, periodic in x,y (or an open flake)
  buildMoS2(nx, ny, layers, T0, open = false) {
    this.clear(); this.model = 'sw'; this.vdw = layers > 1 ? VDW.mos2 : null; this.charges = false;
    const a = MOS2.a, hS = MOS2.h, c2 = 6.15, vac = 14, M = open ? OPEN_MARGIN : 0;
    if (layers > 1 && !open) { nx = Math.max(nx, Math.ceil(17 / a)); ny = Math.max(ny, Math.ceil(17 / (Math.sqrt(3) * a))); }
    if (6 * nx * ny * layers > this.maxN) throw new Error('too many atoms - choose a smaller sheet');
    const Px = nx * a, Py = ny * Math.sqrt(3) * a;
    this.Lx = Px + 2 * M; this.Ly = Py + 2 * M; this.Lz = (layers - 1) * c2 + 2 * hS + vac; this.per = open ? [false, false, false] : [true, true, false];
    const zc = this.Lz / 2 - (layers - 1) * c2 / 2;
    const ox = a / 2, oy = a / (2 * Math.sqrt(3));
    const w = (v, Lm) => M + (open ? v : ((v % Lm) + Lm) % Lm);
    for (let L = 0; L < layers; L++) {
      const z = zc + L * c2, flip = L % 2;                      // 2H: second layer has Mo over the first layer's S sites
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (const [px, py] of [[0, 0], [a / 2, Math.sqrt(3) * a / 2]]) {
        const X = i * a + px, Y = j * Math.sqrt(3) * a + py;
        const mx = flip ? X + ox : X, my = flip ? Y + oy : Y, sx = flip ? X : X + ox, sy = flip ? Y : Y + oy;
        this.addRaw(SP.Mo, w(mx, Px), w(my, Py), z, L);
        this.addRaw(SP.S, w(sx, Px), w(sy, Py), z + hS, L);
        this.addRaw(SP.S, w(sx, Px), w(sy, Py), z - hS, L);
      }
    }
    if (open) this.trimEdges(2.9, 2);
    this.sheet = true;
    this.name = open ? (layers === 1 ? 'MoS₂ flake' : 'MoS₂ flake, 2 layers') : (layers === 1 ? 'MoS₂ monolayer' : `MoS₂ (${layers} layers, 2H)`);
    this.finish(T0, 0.8);
  }

  // open flakes: repeatedly remove atoms with fewer than minNb covalent neighbours (closer than rb, unlike-species for MoS2)
  trimEdges(rb, minNb) {
    for (let pass = 0; pass < 6; pass++) {
      const keep = [];
      for (let i = 0; i < this.N; i++) {
        let n = 0;
        for (let j = 0; j < this.N; j++) {
          if (j === i || this.grp[j] !== this.grp[i]) continue;
          if (this.model === 'sw' && this.sp[j] === this.sp[i]) continue;
          const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i], dz = this.z[j] - this.z[i];
          if (dx * dx + dy * dy + dz * dz < rb * rb) n++;
        }
        if (n >= minNb) keep.push(i);
      }
      if (keep.length === this.N) return;
      keep.forEach((i, k) => { this.sp[k] = this.sp[i]; this.mass[k] = this.mass[i]; this.grp[k] = this.grp[i]; this.x[k] = this.x[i]; this.y[k] = this.y[i]; this.z[k] = this.z[i]; });
      this.N = keep.length; this.listDirty = true;
    }
  }

  // diamond cluster of given radius (A): bare, carved from the lattice
  buildNanodiamond(R, T0) {
    this.clear(); this.model = 'tersoff'; this.tp = TERSOFF.diamond; this.vdw = null; this.charges = false; this.per = [false, false, false];
    const a = 3.567, M = Math.ceil(R / a) + 2, pts = [];
    const basis = [[0, 0, 0], [.5, .5, 0], [.5, 0, .5], [0, .5, .5], [.25, .25, .25], [.75, .75, .25], [.75, .25, .75], [.25, .75, .75]];
    for (let i = -M; i <= M; i++) for (let j = -M; j <= M; j++) for (let k = -M; k <= M; k++) for (const q of basis) {
      const x = (i + q[0]) * a, y = (j + q[1]) * a, z = (k + q[2]) * a;
      if (x * x + y * y + z * z <= R * R) pts.push([x, y, z]);
    }
    // drop atoms with fewer than 2 neighbours (loose bits)
    const keep = pts.filter((p, ii) => { let n = 0; for (const q of pts) { const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d > 0.1 && d < 1.7) n++; } return n >= 2; });
    const span = 2 * R + 14; this.Lx = this.Ly = this.Lz = span;
    for (const p of keep) this.addRaw(SP.C, p[0] + span / 2, p[1] + span / 2, p[2] + span / 2, 0);
    this.name = 'Nanodiamond'; this.finish(T0, 0.4);
  }

  // n benzene molecules in a compact cluster (random orientations)
  buildBenzene(n, T0, rand = Math.random) {
    this.clear(); this.model = 'ff'; this.vdw = VDW.benzene; this.charges = true; this.per = [false, false, false];
    const sites = [[0, 0, 0]];
    const s = 6.0;                                          // fcc-like cluster positions
    const dirs = [[1, 0, 0], [-1, 0, 0], [.5, .866, 0], [-.5, .866, 0], [.5, -.866, 0], [-.5, -.866, 0], [0, 0, 1], [0, 0, -1]];
    for (const d of dirs) sites.push([d[0] * s, d[1] * s, d[2] * s * 0.62]);
    for (const d of [[.5, .289, .8], [-.5, .289, .8], [0, -.577, .8], [.5, .289, -.8], [-.5, .289, -.8], [0, -.577, -.8]]) sites.push([d[0] * s, d[1] * s, d[2] * s * 0.8]);
    n = Math.min(n, sites.length);
    const span = 40; this.Lx = this.Ly = this.Lz = span;
    for (let m = 0; m < n; m++) {
      // random rotation
      const q = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]; const qn = Math.hypot(...q) || 1; const [w, x, y, z] = q.map((v) => v / qn);
      const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
      const base = this.N, ring = [];
      for (let k = 0; k < 6; k++) { const t = k * Math.PI / 3; ring.push([1.40 * Math.cos(t), 1.40 * Math.sin(t), 0]); }
      const hs = []; for (let k = 0; k < 6; k++) { const t = k * Math.PI / 3; hs.push([2.48 * Math.cos(t), 2.48 * Math.sin(t), 0]); }
      const place = (p, sp) => { const X = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2], Y = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2], Z = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]; this.addRaw(sp, span / 2 + sites[m][0] + X, span / 2 + sites[m][1] + Y, span / 2 + sites[m][2] + Z, m); };
      ring.forEach((p) => place(p, SP.C)); hs.forEach((p) => place(p, SP.H));
      for (let k = 0; k < 6; k++) {
        const c = base + k, cp = base + (k + 5) % 6, cn = base + (k + 1) % 6, h = base + 6 + k;
        this.bonds.push([c, cn, 1.400, 469 * KCAL], [c, h, 1.080, 367 * KCAL]);
        this.angles.push([cp, c, cn, 2.0944, 63 * KCAL], [h, c, cn, 2.0944, 35 * KCAL], [h, c, cp, 2.0944, 35 * KCAL]);
        this.oops.push([c, cp, cn, h, 3.0], [h, c, cp, cn, 2.0]);
      }
    }
    this.name = n === 1 ? 'Benzene' : `Benzene ×${n}`; this.finish(T0, 0.3);
  }

  finish(T0, quenchDt) {
    this.thermostat = true; this.Ttarget = T0; this.listDirty = true; this.exploded = false;
    this.computeForces(); this.quench(400, quenchDt);
    this.thermalise(T0); this.computeForces(); this.mark(); this.resetRDF(); this.time = 0; this.step = 0;
    this.dt = (this.model === 'ff' || this.model === 'uff' ? 0.5 : 1.0) / TU_FS;
  }

  quench(steps, dtfs) {
    const dt = dtfs / TU_FS; for (let i = 0; i < this.N; i++) this.vx[i] = this.vy[i] = this.vz[i] = 0;
    for (let s = 0; s < steps; s++) {
      let P = 0;
      for (let i = 0; i < this.N; i++) { if (this.fixed[i]) continue; const im = 1 / this.mass[i]; this.vx[i] += dt * this.fx[i] * im; this.vy[i] += dt * this.fy[i] * im; this.vz[i] += dt * this.fz[i] * im; P += this.fx[i] * this.vx[i] + this.fy[i] * this.vy[i] + this.fz[i] * this.vz[i]; }
      if (P < 0) for (let i = 0; i < this.N; i++) this.vx[i] = this.vy[i] = this.vz[i] = 0;
      for (let i = 0; i < this.N; i++) { this.move(i, Math.max(-0.1, Math.min(0.1, dt * this.vx[i])), Math.max(-0.1, Math.min(0.1, dt * this.vy[i])), Math.max(-0.1, Math.min(0.1, dt * this.vz[i])), false); }
      this.computeForces();
    }
    for (let i = 0; i < this.N; i++) this.vx[i] = this.vy[i] = this.vz[i] = 0;
  }

  gauss(rand = Math.random) { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }
  thermalise(T) {
    for (let i = 0; i < this.N; i++) { if (this.fixed[i]) { this.vx[i] = this.vy[i] = this.vz[i] = 0; continue; } const s = Math.sqrt(KB * T / this.mass[i]); this.vx[i] = s * this.gauss(); this.vy[i] = s * this.gauss(); this.vz[i] = s * this.gauss(); }
    this.removeCOM(); const cur = this.temperature(); if (cur > 0) { const k = Math.sqrt(T / cur); for (let i = 0; i < this.N; i++) { this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k; } }
  }
  removeCOM() {
    let M = 0, px = 0, py = 0, pz = 0; for (let i = 0; i < this.N; i++) { if (this.fixed[i]) continue; M += this.mass[i]; px += this.mass[i] * this.vx[i]; py += this.mass[i] * this.vy[i]; pz += this.mass[i] * this.vz[i]; }
    if (!M) return; for (let i = 0; i < this.N; i++) { if (this.fixed[i]) continue; this.vx[i] -= px / M; this.vy[i] -= py / M; this.vz[i] -= pz / M; }
  }

  move(i, dx, dy, dz, track = true) {
    if (this.fixed[i]) return;
    this.x[i] += dx; this.y[i] += dy; this.z[i] += dz; if (track) { this.cx[i] += dx; this.cy[i] += dy; this.cz[i] += dz; }
    if (this.per[0]) { if (this.x[i] < 0) this.x[i] += this.Lx; else if (this.x[i] >= this.Lx) this.x[i] -= this.Lx; }
    if (this.per[1]) { if (this.y[i] < 0) this.y[i] += this.Ly; else if (this.y[i] >= this.Ly) this.y[i] -= this.Ly; }
    if (this.per[2]) { if (this.z[i] < 0) this.z[i] += this.Lz; else if (this.z[i] >= this.Lz) this.z[i] -= this.Lz; }
  }

  /* ---------------- observables ---------------- */
  kinetic() { let s = 0; for (let i = 0; i < this.N; i++) s += this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2); return 0.5 * s; }
  temperature() { let nf = 0; for (let i = 0; i < this.N; i++) nf += this.fixed[i]; return 2 * this.kinetic() / (Math.max(1, 3 * (this.N - nf) - 3) * KB); }
  pressure() { return 0; }
  meanCoord() { let s = 0; for (let i = 0; i < this.N; i++) s += this.z_[i]; return this.N ? s / this.N : 0; }
  msd() { let s = 0; for (let i = 0; i < this.N; i++) s += this.cx[i] ** 2 + this.cy[i] ** 2 + this.cz[i] ** 2; return this.N ? s / this.N : 0; }
  mark() { for (let i = 0; i < this.N; i++) this.cx[i] = this.cy[i] = this.cz[i] = 0; this.markTime = this.time; }
  resetRDF() { this.rdfHist.fill(0); this.rdfSamples = 0; }
  rdf() { const o = new Float64Array(this.rdfBins); if (!this.rdfSamples || !this.N) return o; const dr = this.rdfMax / this.rdfBins; for (let b = 0; b < this.rdfBins; b++) o[b] = 2 * this.rdfHist[b] / (this.rdfSamples * this.N * dr); return o; }
  sampleRDF() {
    const N = this.N, h = this.rdfHist, k = this.rdfBins / this.rdfMax, m2 = this.rdfMax * this.rdfMax, pe = this.per;
    for (let i = 0; i < N - 1; i++) for (let j = i + 1; j < N; j++) {
      let dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j], dz = this.z[i] - this.z[j];
      if (pe[0]) dx -= this.Lx * Math.round(dx / this.Lx); if (pe[1]) dy -= this.Ly * Math.round(dy / this.Ly); if (pe[2]) dz -= this.Lz * Math.round(dz / this.Lz);
      const r2 = dx * dx + dy * dy + dz * dz; if (r2 < m2) h[(Math.sqrt(r2) * k) | 0]++;
    }
    this.rdfSamples++;
  }

  /* ---------------- neighbour lists ---------------- */
  rcov() { return this.model === 'sw' ? 3.17 : this.model === 'ff' ? 1.6 : (this.tp.R + this.tp.D); }
  rvdw() { return this.model === 'ff' ? 9.0 : this.model === 'sw' ? 9.0 : 8.0; }
  mi(d, L, p) { return p ? d - L * Math.round(d / L) : d; }

  buildLists() {
    const N = this.N, pe = this.per, Lx = this.Lx, Ly = this.Ly, Lz = this.Lz;
    if (this.model === 'uff') {                                   // chemistry mode: bonds come from the topology, not from distances
      this.chem.syncLists(); this.listN = N; this.xr.set(this.x.subarray(0, N)); this.yr.set(this.y.subarray(0, N)); this.zr.set(this.z.subarray(0, N)); this.listDirty = false; return;
    }
    const rc = this.rcov() + this.skinC, rc2 = rc * rc, rv = this.rvdw() + this.skinV, rv2 = rv * rv, useV = !!this.vdw;
    let nb = 0, nv = 0; const deg = this.start; deg.fill(0, 0, N + 1);
    const pushB = (i, j) => { if (nb >= this.bi.length) { const a = new Int32Array(nb * 2); a.set(this.bi); this.bi = a; const b = new Int32Array(nb * 2); b.set(this.bj); this.bj = b; } this.bi[nb] = i; this.bj[nb] = j; nb++; deg[i + 1]++; deg[j + 1]++; };
    const pushV = (i, j) => { if (nv >= this.vi.length) { const a = new Int32Array(nv * 2); a.set(this.vi); this.vi = a; const b = new Int32Array(nv * 2); b.set(this.vj); this.vj = b; } this.vi[nv] = i; this.vj[nv] = j; nv++; };
    for (let i = 0; i < N - 1; i++) for (let j = i + 1; j < N; j++) {
      let dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j], dz = this.z[i] - this.z[j];
      if (pe[0]) dx -= Lx * Math.round(dx / Lx); if (pe[1]) dy -= Ly * Math.round(dy / Ly); if (pe[2]) dz -= Lz * Math.round(dz / Lz);
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < rc2) pushB(i, j);
      if (useV && r2 < rv2 && this.grp[i] !== this.grp[j]) pushV(i, j);
    }
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    if (this.nbr.length < deg[N]) this.nbr = new Int32Array(deg[N] * 2);
    const fill = this.fillPos || (this.fillPos = new Int32Array(this.maxN)); for (let i = 0; i < N; i++) fill[i] = deg[i];
    for (let p = 0; p < nb; p++) { const i = this.bi[p], j = this.bj[p]; this.nbr[fill[i]++] = j; this.nbr[fill[j]++] = i; }
    this.nb = nb; this.nv = nv; this.listN = N; this.xr.set(this.x.subarray(0, N)); this.yr.set(this.y.subarray(0, N)); this.zr.set(this.z.subarray(0, N)); this.listDirty = false;
  }
  needList() {
    if (this.listDirty || this.listN !== this.N) return true;
    const lim = 0.09, pe = this.per; // 0.3 A
    for (let i = 0; i < this.N; i++) {
      const dx = this.mi(this.x[i] - this.xr[i], this.Lx, pe[0]), dy = this.mi(this.y[i] - this.yr[i], this.Ly, pe[1]), dz = this.mi(this.z[i] - this.zr[i], this.Lz, pe[2]);
      if (dx * dx + dy * dy + dz * dz > lim) return true;
    }
    return false;
  }

  /* ---------------- forces ---------------- */
  computeForces() {
    const N = this.N; for (let i = 0; i < N; i++) { this.fx[i] = this.fy[i] = this.fz[i] = 0; }
    if (this.needList()) this.buildLists();
    let pe = 0;
    if (this.model === 'tersoff') pe += this.fTersoff(); else if (this.model === 'sw') pe += this.fSW(); else if (this.model === 'ff') pe += this.fFF(); else if (this.model === 'uff') pe += this.chem.forces();
    if (this.vdw) pe += this.fVdw();
    pe += this.fExt();
    if (this.sub) pe += substrateForces(this, this.sub);
    if (this.carry) this.holdAnchor(this.carry);                     // a piece held in the hand (grip): every atom springs to its place in the hand               // a fixed substrate: van der Waals only (src/substrate.js)
    this.PE = pe; this.updateCoord();
  }

  updateCoord() {
    const N = this.N, zs = this.z_;
    for (let i = 0; i < N; i++) {
      let n = 0; const cut = SPECIES[this.sp[i]].bond;
      for (let p = this.start[i]; p < this.start[i + 1]; p++) {
        const j = this.nbr[p]; const dx = this.mi(this.x[j] - this.x[i], this.Lx, this.per[0]), dy = this.mi(this.y[j] - this.y[i], this.Ly, this.per[1]), dz = this.mi(this.z[j] - this.z[i], this.Lz, this.per[2]);
        const lim = this.bondLimit(i, j); if (dx * dx + dy * dy + dz * dz < lim * lim) n++;
      }
      zs[i] += 0.05 * (n - zs[i]);
    }
  }
  bondLimit(i, j) { if (this.model === 'uff') return 99; const a = this.sp[i], b = this.sp[j]; if (a === SP.S && b === SP.S) return 0; if (a === SP.Mo && b === SP.Mo) return 0; return Math.max(SPECIES[a].bond, SPECIES[b].bond) > 2 ? 2.9 : (a === SP.H || b === SP.H) ? 1.3 : 1.9; }

  fTersoff() {
    const P = this.tp, N = this.N, S = this.scratch, Rc = P.R + P.D, Rc2 = Rc * Rc, pe = this.per;
    const x = this.x, y = this.y, z = this.z, fx = this.fx, fy = this.fy, fz = this.fz;
    const bn = Math.pow(P.beta, P.n); void bn;
    let E = 0;
    for (let i = 0; i < N; i++) {
      let nn = 0;
      for (let p = this.start[i]; p < this.start[i + 1]; p++) {
        const j = this.nbr[p]; const dx = this.mi(x[j] - x[i], this.Lx, pe[0]), dy = this.mi(y[j] - y[i], this.Ly, pe[1]), dz = this.mi(z[j] - z[i], this.Lz, pe[2]);
        const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= Rc2) continue;
        if (nn >= 60) break;
        const r = Math.sqrt(r2); S.j[nn] = j; S.dx[nn] = dx / r; S.dy[nn] = dy / r; S.dz[nn] = dz / r; S.r[nn] = r; S.fc[nn] = fc(r, P.R, P.D); S.dfc[nn] = dfc(r, P.R, P.D); nn++;
      }
      for (let a = 0; a < nn; a++) {
        const j = S.j[a], ra = S.r[a], fca = S.fc[a], dfca = S.dfc[a];
        // repulsion: once per pair
        if (j > i) {
          const fR = P.A * Math.exp(-P.l1 * ra), dEdr = dfca * fR + fca * (-P.l1 * fR);
          E += fca * fR; const ux = S.dx[a], uy = S.dy[a], uz = S.dz[a];
          fx[i] += dEdr * ux; fy[i] += dEdr * uy; fz[i] += dEdr * uz; fx[j] -= dEdr * ux; fy[j] -= dEdr * uy; fz[j] -= dEdr * uz;
        }
        // attraction with bond order
        let zeta = 0;
        for (let b = 0; b < nn; b++) { if (b === a) continue; const c = S.dx[a] * S.dx[b] + S.dy[a] * S.dy[b] + S.dz[a] * S.dz[b]; const u = P.d * P.d + (P.h - c) * (P.h - c); zeta += S.fc[b] * P.c * P.c * (1 / (P.d * P.d) - 1 / u) + S.fc[b]; }
        // g(c) = 1 + c^2/d^2 - c^2/(d^2+(h-c)^2)   (gamma = 1)
        let t = 0, bij = 1, dbij = 0;
        if (zeta > 1e-14) { t = Math.pow(P.beta * zeta, P.n); const q = Math.pow(1 + t, -1 / (2 * P.n)); bij = q; dbij = -0.5 * q / (1 + t) * t / zeta; }
        const fA = -P.B * Math.exp(-P.l2 * ra), dfA = -P.l2 * fA;
        const Fa = 0.5 * fca * fA; E += Fa * bij;
        const dEdr = 0.5 * (dfca * fA + fca * dfA) * bij;
        const uax = S.dx[a], uay = S.dy[a], uaz = S.dz[a];
        let gjx = dEdr * uax, gjy = dEdr * uay, gjz = dEdr * uaz;
        const pre = Fa * dbij;
        if (pre !== 0) for (let b = 0; b < nn; b++) {
          if (b === a) continue; const k = S.j[b], ubx = S.dx[b], uby = S.dy[b], ubz = S.dz[b], rb = S.r[b];
          const c = uax * ubx + uay * uby + uaz * ubz, u = P.d * P.d + (P.h - c) * (P.h - c);
          const g = 1 + P.c * P.c / (P.d * P.d) - P.c * P.c / u, dg = -2 * P.c * P.c * (P.h - c) / (u * u);
          const dEdrk = pre * S.dfc[b] * g, dEdc = pre * S.fc[b] * dg;
          const jx = dEdc * (ubx - c * uax) / ra, jy = dEdc * (uby - c * uay) / ra, jz = dEdc * (ubz - c * uaz) / ra;
          const kx = dEdrk * ubx + dEdc * (uax - c * ubx) / rb, ky = dEdrk * uby + dEdc * (uay - c * uby) / rb, kz = dEdrk * ubz + dEdc * (uaz - c * ubz) / rb;
          gjx += jx; gjy += jy; gjz += jz;
          fx[k] -= kx; fy[k] -= ky; fz[k] -= kz; fx[i] += kx; fy[i] += ky; fz[i] += kz;       // F_k = -grad_k ; F_i = +grad_j + sum grad_k
        }
        fx[j] -= gjx; fy[j] -= gjy; fz[j] -= gjz; fx[i] += gjx; fy[i] += gjy; fz[i] += gjz;
      }
    }
    return E;
  }

  fSW() {
    const P = SW, N = this.N, S = this.scratch, pe = this.per, cut = P.a * P.sigma, x = this.x, y = this.y, z = this.z, fx = this.fx, fy = this.fy, fz = this.fz;
    let E = 0;
    for (let i = 0; i < N; i++) {
      let nn = 0; const si = this.sp[i];
      for (let p = this.start[i]; p < this.start[i + 1]; p++) {
        const j = this.nbr[p]; if (this.sp[j] === si) continue;        // only Mo-S interactions
        const dx = this.mi(x[j] - x[i], this.Lx, pe[0]), dy = this.mi(y[j] - y[i], this.Ly, pe[1]), dz = this.mi(z[j] - z[i], this.Lz, pe[2]);
        const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= cut * cut || nn >= 60) continue;
        const r = Math.sqrt(r2); S.j[nn] = j; S.dx[nn] = dx / r; S.dy[nn] = dy / r; S.dz[nn] = dz / r; S.r[nn] = r;
        const w = r - cut, e = Math.exp(P.sigma * P.gamma / w); S.fc[nn] = e; S.dfc[nn] = -e * P.sigma * P.gamma / (w * w);    // h(r), dh/dr
        nn++;
      }
      const lam = si === SP.Mo ? P.lamMoSS : P.lamSMoMo;
      for (let a = 0; a < nn; a++) {
        const j = S.j[a], ra = S.r[a];
        if (j > i) {
          const w = ra - cut, sr = P.sigma / ra, sp4 = sr ** 4, ex = Math.exp(P.sigma / w);
          const phi = P.A * P.eps * (P.B * sp4 - 1) * ex;
          const dphi = P.A * P.eps * ((-4 * P.B * sp4 / ra) * ex + (P.B * sp4 - 1) * ex * (-P.sigma / (w * w)));
          E += phi; fx[i] += dphi * S.dx[a]; fy[i] += dphi * S.dy[a]; fz[i] += dphi * S.dz[a]; fx[j] -= dphi * S.dx[a]; fy[j] -= dphi * S.dy[a]; fz[j] -= dphi * S.dz[a];
        }
        for (let b = a + 1; b < nn; b++) {
          const k = S.j[b], rb = S.r[b];
          const c = S.dx[a] * S.dx[b] + S.dy[a] * S.dy[b] + S.dz[a] * S.dz[b], dc = c - P.cos0, ha = S.fc[a], hb = S.fc[b];
          // 'sw/mod': the angular deviation is scaled by a smooth switch f(|dc|) that removes unwanted angle types
          const adc = Math.abs(dc); let fsw = 1, dfsw = 0;
          if (adc >= P.d2) { fsw = 0; } else if (adc > P.d1) { const xx = Math.PI * (adc - P.d1) / (P.d2 - P.d1); fsw = 0.5 + 0.5 * Math.cos(xx); dfsw = -0.5 * Math.sin(xx) * Math.PI / (P.d2 - P.d1); }
          const q = dc * fsw; if (q === 0 && fsw === 0) continue;
          E += lam * P.eps * q * q * ha * hb;
          const dEdc = 2 * lam * P.eps * q * (fsw + adc * dfsw) * ha * hb, dEra = lam * P.eps * q * q * S.dfc[a] * hb, dErb = lam * P.eps * q * q * ha * S.dfc[b];
          const jx = dEdc * (S.dx[b] - c * S.dx[a]) / ra + dEra * S.dx[a], jy = dEdc * (S.dy[b] - c * S.dy[a]) / ra + dEra * S.dy[a], jz = dEdc * (S.dz[b] - c * S.dz[a]) / ra + dEra * S.dz[a];
          const kx = dEdc * (S.dx[a] - c * S.dx[b]) / rb + dErb * S.dx[b], ky = dEdc * (S.dy[a] - c * S.dy[b]) / rb + dErb * S.dy[b], kz = dEdc * (S.dz[a] - c * S.dz[b]) / rb + dErb * S.dz[b];
          fx[j] -= jx; fy[j] -= jy; fz[j] -= jz; fx[k] -= kx; fy[k] -= ky; fz[k] -= kz; fx[i] += jx + kx; fy[i] += jy + ky; fz[i] += jz + kz;
        }
      }
    }
    return E;
  }

  fFF() {
    const x = this.x, y = this.y, z = this.z, fx = this.fx, fy = this.fy, fz = this.fz; let E = 0;
    for (const [i, j, r0, k] of this.bonds) {
      const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i], r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      E += k * (r - r0) ** 2; const d = 2 * k * (r - r0) / r;
      fx[i] += d * dx; fy[i] += d * dy; fz[i] += d * dz; fx[j] -= d * dx; fy[j] -= d * dy; fz[j] -= d * dz;
    }
    for (const [i, j, kk, th0, k] of this.angles) {          // centre atom j
      let ax = x[i] - x[j], ay = y[i] - y[j], az = z[i] - z[j], bx = x[kk] - x[j], by = y[kk] - y[j], bz = z[kk] - z[j];
      const ra = Math.hypot(ax, ay, az), rb = Math.hypot(bx, by, bz); ax /= ra; ay /= ra; az /= ra; bx /= rb; by /= rb; bz /= rb;
      let c = ax * bx + ay * by + az * bz; c = Math.max(-0.999999, Math.min(0.999999, c)); const th = Math.acos(c), s = Math.sqrt(1 - c * c);
      E += k * (th - th0) ** 2; const dEdc = 2 * k * (th - th0) * (-1 / s);
      const gix = dEdc * (bx - c * ax) / ra, giy = dEdc * (by - c * ay) / ra, giz = dEdc * (bz - c * az) / ra;
      const gkx = dEdc * (ax - c * bx) / rb, gky = dEdc * (ay - c * by) / rb, gkz = dEdc * (az - c * bz) / rb;
      fx[i] -= gix; fy[i] -= giy; fz[i] -= giz; fx[kk] -= gkx; fy[kk] -= gky; fz[kk] -= gkz; fx[j] += gix + gkx; fy[j] += giy + gky; fz[j] += giz + gkz;
    }
    // out-of-plane: height of atom a above plane (b,c,d); energy 1/2 k h^2, numerical gradient (central differences)
    const P = new Float64Array(12);
    const eo = (idx, k) => { const [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz] = P; const ux = cx - bx, uy = cy - by, uz = cz - bz, vx = dx - bx, vy = dy - by, vz = dz - bz; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; const h = ((ax - bx) * nx + (ay - by) * ny + (az - bz) * nz) / nl; return 0.5 * k * h * h; };
    for (const [a, b, c, d, k] of this.oops) {
      const ids = [a, b, c, d]; for (let m = 0; m < 4; m++) { P[3 * m] = x[ids[m]]; P[3 * m + 1] = y[ids[m]]; P[3 * m + 2] = z[ids[m]]; }
      E += eo(0, k);
      for (let q = 0; q < 12; q++) { const o = P[q], e = 1e-5; P[q] = o + e; const e1 = eo(0, k); P[q] = o - e; const e2 = eo(0, k); P[q] = o; const g = (e1 - e2) / (2 * e); const m = (q / 3) | 0, at = ids[m]; if (q % 3 === 0) fx[at] -= g; else if (q % 3 === 1) fy[at] -= g; else fz[at] -= g; }
    }
    return E;
  }

  fVdw() {
    const x = this.x, y = this.y, z = this.z, fx = this.fx, fy = this.fy, fz = this.fz, pe = this.per, sp = this.sp, T = this.vdw;
    const rc = this.rvdw(), rc2 = rc * rc, coul = this.charges, Lx = this.Lx, Ly = this.Ly, Lz = this.Lz, hx = 0.5 * Lx, hy = 0.5 * Ly, hz = 0.5 * Lz;
    if (!T.cache || T.cache.rc !== rc) {                       // shifted-force constants per species pair
      const ec = new Float64Array(16), dEc = new Float64Array(16);
      for (let k = 0; k < 16; k++) if (T.e[k] > 0) { const s6 = Math.pow(T.s[k] / rc, 6); ec[k] = 4 * T.e[k] * (s6 * s6 - s6); dEc[k] = -24 * T.e[k] * (2 * s6 * s6 - s6) / rc; }
      T.cache = { rc, ec, dEc };
    }
    const ecT = T.cache.ec, dEcT = T.cache.dEc; let E = 0;
    for (let p = 0; p < this.nv; p++) {
      const i = this.vi[p], j = this.vj[p];
      let dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j];
      if (pe[0]) { if (dx > hx) dx -= Lx; else if (dx < -hx) dx += Lx; }
      if (pe[1]) { if (dy > hy) dy -= Ly; else if (dy < -hy) dy += Ly; }
      if (pe[2]) { if (dz > hz) dz -= Lz; else if (dz < -hz) dz += Lz; }
      const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= rc2) continue;
      const r = Math.sqrt(r2), idx = sp[i] * 4 + sp[j], eps = T.e[idx]; let ff = 0;
      if (eps > 0) {
        const sig = T.s[idx], s2 = sig * sig / r2, s6 = s2 * s2 * s2, s12 = s6 * s6;
        E += 4 * eps * (s12 - s6) - ecT[idx] - (r - rc) * dEcT[idx];
        ff = 24 * eps * (2 * s12 - s6) / r + dEcT[idx];       // -(E'(r) - E'(rc))
      }
      if (coul) { const qq = KE_COUL * BENZENE_Q[sp[i]] * BENZENE_Q[sp[j]]; if (qq !== 0) { E += qq * (1 / r - 1 / rc + (r - rc) / (rc * rc)); ff += qq * (1 / r2 - 1 / rc2); } }
      const f = ff / r; fx[i] += f * dx; fy[i] += f * dy; fz[i] += f * dz; fx[j] -= f * dx; fy[j] -= f * dy; fz[j] -= f * dz;
    }
    return E;
  }

  // tweezers: a spring on one atom, or on the centre of mass of its whole group (layer / molecule)
  fExt() {
    const e = this.ext, N = this.N; this.extForce = 0; this.extForceEV = 0;
    if (e.i < 0 || e.i >= N) return 0;
    const fx = this.fx, fy = this.fy, fz = this.fz;
    if (e.mode === 'group' || e.mode === 'frag') {
      const g = this.grp[e.i], fr = e.mode === 'frag' && e.mask, inG = (k) => (fr ? fr[k] === 1 : this.grp[k] === g); let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, n = 0;
      const x0 = this.x[e.i], y0 = this.y[e.i], z0 = this.z[e.i];
      for (let i = 0; i < N; i++) if (inG(i)) { const m = this.mass[i]; M += m; n++; cx += m * this.mi(this.x[i] - x0, this.Lx, this.per[0]); cy += m * this.mi(this.y[i] - y0, this.Ly, this.per[1]); cz += m * this.mi(this.z[i] - z0, this.Lz, this.per[2]); vx += m * this.vx[i]; vy += m * this.vy[i]; vz += m * this.vz[i]; }
      cx = cx / M + x0; cy = cy / M + y0; cz = cz / M + z0; vx /= M; vy /= M; vz /= M;
      const K = this.grpK * n, cap = this.grpCap * n; let Fx = K * this.mi(e.x - cx, this.Lx, this.per[0]), Fy = K * this.mi(e.y - cy, this.Ly, this.per[1]), Fz = K * this.mi(e.z - cz, this.Lz, this.per[2]);
      const fm = Math.hypot(Fx, Fy, Fz); if (fm > cap) { const s = cap / fm; Fx *= s; Fy *= s; Fz *= s; }
      const gam = this.grpGam;               // strong damping of the centre-of-mass motion: the layer follows the hand slowly (~100 m/s)
      Fx -= gam * M * vx; Fy -= gam * M * vy; Fz -= gam * M * vz;
      for (let i = 0; i < N; i++) if (inG(i)) { const w = this.mass[i] / M; fx[i] += Fx * w; fy[i] += Fy * w; fz[i] += Fz * w; }
      this.extForce = Math.min(1, fm / cap); this.extForceEV = Math.min(fm, cap); return 0;
    }
    const i = e.i; let dx = this.mi(e.x - this.x[i], this.Lx, this.per[0]), dy = this.mi(e.y - this.y[i], this.Ly, this.per[1]), dz = this.mi(e.z - this.z[i], this.Lz, this.per[2]);
    const kk = e.kk || e.k; let Fx = kk * dx, Fy = kk * dy, Fz = kk * dz; const fm = Math.hypot(Fx, Fy, Fz), cap = e.cap || 8;   // the Hand pulls harder (kk, cap) than the tweezers
    if (fm > cap) { const s = cap / fm; Fx *= s; Fy *= s; Fz *= s; }
    const dm = 0.3 * this.mass[i] * 0.05;
    fx[i] += Fx - dm * this.vx[i]; fy[i] += Fy - dm * this.vy[i]; fz[i] += Fz - dm * this.vz[i];
    if (e.anchor) this.holdAnchor(e.anchor);
    this.extForce = Math.min(1, fm / cap); this.extForceEV = Math.min(fm, cap); return 0;
  }
  // the Hand pulling one atom out of a big piece: every other atom of the piece is held near where it was (a soft,
  // damped spring each), the way a hand on the table holds it. Holding only the centre of mass is not enough: the sheet
  // then tents up around the pull and tears instead of letting the atom go.
  anchorFor(mask) { const N = this.N, p = new Float64Array(3 * N); for (let i = 0; i < N; i++) if (mask[i]) { p[3 * i] = this.x[i]; p[3 * i + 1] = this.y[i]; p[3 * i + 2] = this.z[i]; } return { mask, p, ka: 2 }; }
  holdAnchor(a) {
    if (a.p) {
      const m = a.mask, p = a.p, k = a.ka, g = 0.05;
      for (let i = 0; i < this.N; i++) if (m[i]) {
        const dx = this.mi(p[3 * i] - this.x[i], this.Lx, this.per[0]), dy = this.mi(p[3 * i + 1] - this.y[i], this.Ly, this.per[1]), dz = this.mi(p[3 * i + 2] - this.z[i], this.Lz, this.per[2]);
        const dm = g * this.mass[i]; this.fx[i] += k * dx - dm * this.vx[i]; this.fy[i] += k * dy - dm * this.vy[i]; this.fz[i] += k * dz - dm * this.vz[i];
      }
      return;
    }
    const N = this.N, m = a.mask, x0 = a.x, y0 = a.y, z0 = a.z; let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, n = 0;
    for (let i = 0; i < N; i++) if (m[i]) { const w = this.mass[i]; M += w; n++; cx += w * this.mi(this.x[i] - x0, this.Lx, this.per[0]); cy += w * this.mi(this.y[i] - y0, this.Ly, this.per[1]); cz += w * this.mi(this.z[i] - z0, this.Lz, this.per[2]); vx += w * this.vx[i]; vy += w * this.vy[i]; vz += w * this.vz[i]; }
    if (!M) return; cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;
    const K = a.k || this.grpK * n, gam = this.grpGam;
    const Fx = -K * cx - gam * M * vx, Fy = -K * cy - gam * M * vy, Fz = -K * cz - gam * M * vz;
    for (let i = 0; i < N; i++) if (m[i]) { const w = this.mass[i] / M; this.fx[i] += Fx * w; this.fy[i] += Fy * w; this.fz[i] += Fz * w; }
  }

  /* ---------------- time stepping ---------------- */
  stepOnce() {
    const N = this.N; if (!N || this.exploded) return;
    const dt = this.dt, hdt = 0.5 * dt, vx = this.vx, vy = this.vy, vz = this.vz, fx = this.fx, fy = this.fy, fz = this.fz, m = this.mass;
    for (let i = 0; i < N; i++) {
      if (this.fixed[i]) { vx[i] = vy[i] = vz[i] = 0; continue; }
      const im = hdt / m[i]; vx[i] += im * fx[i]; vy[i] += im * fy[i]; vz[i] += im * fz[i];
      this.move(i, dt * vx[i], dt * vy[i], dt * vz[i]);
    }
    this.computeForces();
    if (this.model === 'uff' && this.step % 5 === 0 && (this.chem.breakStretched() + this.chem.formClose())) this.computeForces();     // overstretched bonds snap, radicals that meet bond
    for (let i = 0; i < N; i++) { if (this.fixed[i]) continue; const im = hdt / m[i]; vx[i] += im * fx[i]; vy[i] += im * fy[i]; vz[i] += im * fz[i]; }
    let KE = this.kinetic();
    if (this.thermostat && KE > 0) {
      let nf = 0; for (let i = 0; i < N; i++) nf += this.fixed[i];                 // fixed atoms carry no degrees of freedom
      const T = 2 * KE / (Math.max(1, 3 * (N - nf) - 3) * KB);
      let lam = Math.sqrt(1 + (dt / this.tauT) * (this.Ttarget / T - 1)); lam = Math.max(0.97, Math.min(1.03, lam));
      for (let i = 0; i < N; i++) { vx[i] *= lam; vy[i] *= lam; vz[i] *= lam; } KE *= lam * lam;
    }
    this.KE = KE; this.time += dt; this.step++;
    // drift removal; not with atoms held fixed (they push the rest, so its momentum is real)
    if (this.ext.i < 0 && !this.carry && !this.sub && this.step % 100 === 0 && !this.fixed.subarray(0, N).some((v) => v)) this.removeCOM();
    if (this.step % 40 === 0) this.sampleRDF();
    if (!isFinite(KE) || !isFinite(this.PE) || KE / N > 50) this.exploded = true;
  }
  run(n) { for (let k = 0; k < n && !this.exploded; k++) this.stepOnce(); }

  /* ---------------- editing ---------------- */
  addAtom(px, py, pz, sp = SP.C) {
    if (this.N >= this.maxN || this.model === 'ff') return -1;
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.N; i++) { const d = Math.hypot(this.x[i] - px, this.y[i] - py, this.z[i] - pz); if (d < bd) { bd = d; best = i; } }
    if (bd < 0.9) return -1;
    const g = best >= 0 ? this.grp[best] : 0, i = this.addRaw(sp, px, py, pz, g); if (this.model === 'uff') this.chem.dirty = true;
    const s = Math.sqrt(KB * Math.max(this.Ttarget, 10) / this.mass[i]); this.vx[i] = s * this.gauss(); this.vy[i] = s * this.gauss(); this.vz[i] = s * this.gauss();
    this.computeForces(); return i;
  }
  removeAtom(i, noForces = false) {
    if (i < 0 || i >= this.N || this.model === 'ff') return;
    const l = --this.N; this.listDirty = true;
    if (i !== l) { for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'cx', 'cy', 'cz', 'mass', 'sp', 'grp', 'z_', 'fixed']) this[k][i] = this[k][l]; }
    if (this.ext.mask) { this.ext.mask[i] = this.ext.mask[l]; this.ext.mask[l] = 0; }
    if (this.carry) this.carry = null;                               // indices move: let go of a carried piece
    if (this.ext.anchor) { const A = this.ext.anchor, am = A.mask; am[i] = am[l]; am[l] = 0; if (A.p) for (let c = 0; c < 3; c++) A.p[3 * i + c] = A.p[3 * l + c]; }
    if (this.ext.i === i) this.ext.i = -1; else if (this.ext.i === l) this.ext.i = i;
    if (this.model === 'uff') this.chem.removeAtom(i, l);
    if (!noForces) this.computeForces();
  }

  // append another structure (a building block), shifted by (dx, dy, dz). It keeps its own groups (so Grab: layer takes
  // it as one piece), velocities and fixed atoms; in the chemistry model its bonds come along.
  mergeFrom(o, dx, dy, dz) {
    if (this.N + o.N > this.maxN) throw new Error(`too many atoms (${this.N + o.N}, at most ${this.maxN})`);
    const off = this.N; let G = 0; for (let i = 0; i < this.N; i++) G = Math.max(G, this.grp[i] + 1);
    for (let i = 0; i < o.N; i++) { const k = this.addRaw(o.sp[i], o.x[i] + dx, o.y[i] + dy, o.z[i] + dz, o.grp[i] + G); this.vx[k] = o.vx[i]; this.vy[k] = o.vy[i]; this.vz[k] = o.vz[i]; this.fixed[k] = o.fixed[i]; }
    if (this.model === 'uff') { for (const [a, b] of o.chem.bonds) this.chem.bonds.push([a + off, b + off]); this.chem.dirty = true; this.chem.retype(); }
    this.listDirty = true; this.mark(); this.resetRDF(); this.computeForces(); return off;
  }

  /* ---------------- chemistry mode (src/chem.js) ---------------- */
  // turn the current structure into explicit bonds on the UFF force field (keeps the atoms where they are)
  toChem(T0) {
    if (this.model === 'sw') throw new Error('MoS\u2082 is not available in the chemistry mode');
    this.chem.fromGeometry(); this.model = 'uff'; this.vdw = null; this.charges = false; this.bonds = []; this.angles = []; this.oops = [];
    this.listDirty = true; this.name = this.name + ' \u00B7 chemistry'; this.finish(T0, 0.3);
  }
  // the same, without touching velocities or the clock: used when the user attaches a foreign atom to a running structure
  toChemLive() {
    if (this.model === 'sw') throw new Error('MoS\u2082 has no chemistry model yet');
    this.chem.fromGeometry(); this.model = 'uff'; this.vdw = null; this.charges = false; this.bonds = []; this.angles = []; this.oops = [];
    this.dt = 0.5 / TU_FS; this.listDirty = true; if (!/chemistry/.test(this.name)) this.name = this.name + ' \u00B7 chemistry'; this.computeForces();
  }
  // single-wall carbon nanotube (n, m), 'len' nm long, rolled from the graphene lattice (Tersoff carbon, open ends)
  buildCNT(n, m, len, T0) {
    n = Math.round(n); m = Math.round(m); if (n < 1 || m < 0 || m > n) throw new Error('nanotube needs n >= 1 and 0 <= m <= n');
    this.clear(); this.model = 'tersoff'; this.tp = TERSOFF.graphene; this.vdw = null; this.charges = false;
    const b = GR_B, a = Math.sqrt(3) * b, a1 = [a * Math.sqrt(3) / 2, a / 2], a2 = [a * Math.sqrt(3) / 2, -a / 2];
    const gcd = (p, q) => q ? gcd(q, p % q) : Math.abs(p), dR = gcd(2 * m + n, 2 * n + m), t1 = (2 * m + n) / dR, t2 = -(2 * n + m) / dR;
    const Ch = [n * a1[0] + m * a2[0], n * a1[1] + m * a2[1]], Tv = [t1 * a1[0] + t2 * a2[0], t1 * a1[1] + t2 * a2[1]];
    const C2 = Ch[0] ** 2 + Ch[1] ** 2, T2 = Tv[0] ** 2 + Tv[1] ** 2, R = Math.sqrt(C2) / (2 * Math.PI), cells = Math.max(1, Math.round(len * 10 / Math.sqrt(T2)));
    if (4 * (n * n + n * m + m * m) / dR * cells > this.maxN) throw new Error('nanotube too long for ' + this.maxN + ' atoms - make it shorter');
    const corners = [[0, 0], [n, m], [t1 * cells, t2 * cells], [n + t1 * cells, m + t2 * cells]], dl = [a / Math.sqrt(3), 0], pts = [];
    const i0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 2, i1 = Math.ceil(Math.max(...corners.map((c) => c[0]))) + 2, j0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 2, j1 = Math.ceil(Math.max(...corners.map((c) => c[1]))) + 2;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const off of [[0, 0], dl]) {
      const px = i * a1[0] + j * a2[0] + off[0] + 1e-7, py = i * a1[1] + j * a2[1] + off[1] + 2e-7;
      const s = (px * Ch[0] + py * Ch[1]) / C2, u = (px * Tv[0] + py * Tv[1]) / T2;
      if (s >= 0 && s < 1 && u >= 0 && u < cells) pts.push([R * Math.cos(2 * Math.PI * s), R * Math.sin(2 * Math.PI * s), u * Math.sqrt(T2)]);
    }
    const Lz = cells * Math.sqrt(T2); this.Lx = this.Ly = 2 * R + 24; this.Lz = Lz + 24; this.per = [false, false, false];
    for (const [x, y, z] of pts) this.addRaw(SP.C, x + this.Lx / 2, y + this.Ly / 2, z + 12, 0);
    this.trimEdges(1.7, 2);
    this.name = `Nanotube (${n},${m})`; this.finish(T0, 0.5);
  }
  // C60 buckminsterfullerene: the truncated icosahedron (cyclic permutations of the three vertex families), bond 1.42 A
  buildC60(T0) {
    this.clear(); this.model = 'tersoff'; this.tp = TERSOFF.graphene; this.vdw = null; this.charges = false;
    const p = (1 + Math.sqrt(5)) / 2, fam = [[0, 1, 3 * p], [1, 2 + p, 2 * p], [p, 2, 2 * p + 1]], pts = [];
    for (const [a, b, c] of fam) for (const sa of [1, -1]) for (const sb of [1, -1]) for (const sc of [1, -1]) {
      if ((a === 0 && sa < 0)) continue;
      const v = [a * sa, b * sb, c * sc]; for (let k = 0; k < 3; k++) pts.push([v[k % 3], v[(k + 1) % 3], v[(k + 2) % 3]]);
    }
    const s = 1.42 / 2, span = 30; this.Lx = this.Ly = this.Lz = span; this.per = [false, false, false];
    for (const q of pts) this.addRaw(SP.C, span / 2 + q[0] * s, span / 2 + q[1] * s, span / 2 + q[2] * s, 0);
    this.name = 'C\u2086\u2080'; this.finish(T0, 0.4);
  }
  // hexagonal boron nitride: the graphene lattice at 1.446 A with B and N on the two sublattices, on the chemistry model (UFF)
  buildHBN(nx, ny, T0, open = false) {
    this.buildGraphene(nx, ny, 1, 1, false, open);
    const k = 1.446 / GR_B, b = GR_B * k, y0 = open ? OPEN_MARGIN : 0;
    for (let i = 0; i < this.N; i++) { this.x[i] = (this.x[i] - (open ? OPEN_MARGIN : 0)) * k + (open ? OPEN_MARGIN : 0); this.y[i] = (this.y[i] - y0) * k + y0; }
    if (open) { this.Lx = (this.Lx - 2 * OPEN_MARGIN) * k + 2 * OPEN_MARGIN; this.Ly = (this.Ly - 2 * OPEN_MARGIN) * k + 2 * OPEN_MARGIN; } else { this.Lx *= k; this.Ly *= k; }
    for (let i = 0; i < this.N; i++) {                         // sublattice from the height in the 4-atom cell: 0 or 1.5 b -> B, 0.5 or 2 b -> N
      const q = ((Math.round((this.y[i] - y0) / (0.5 * b)) % 6) + 6) % 6, sp = (q === 0 || q === 3) ? SP.B : SP.N;
      this.sp[i] = sp; this.mass[i] = SPECIES[sp].mass;
    }
    this.name = open ? 'hBN flake' : 'hBN'; this.chem.fromGeometry(); this.model = 'uff'; this.vdw = null; this.listDirty = true; this.finish(T0, 0.3);
  }
  // molecular junction: 1-3 para-linked benzene rings, thiol (S) anchors, gold electrode pads held fixed (chemistry model).
  // Returns the two anchor carbons, where the transport contacts go.
  buildJunction(rings, T0) {
    rings = Math.max(1, Math.min(3, Math.round(rings)));
    this.clear(); this.model = 'uff'; this.vdw = null; this.charges = false; this.chem.clear(); this.per = [false, false, false];
    const rc = 1.40, rh = 2.48, step = 2 * rc + 1.49, tw = 35 * Math.PI / 180, bonds = [], ring = [];
    const xs = (rings - 1) * step, span = xs + 2 * (rc + 1.77 + 2.4 + 2.35) + 30; this.Lx = span; this.Ly = this.Lz = 34;
    const X0 = span / 2 - xs / 2, Y = this.Ly / 2, Z = this.Lz / 2;
    for (let k = 0; k < rings; k++) {
      const t = (k % 2) * tw, ids = [];
      for (let j = 0; j < 6; j++) { const th = j * Math.PI / 3; ids.push(this.addRaw(SP.C, X0 + k * step + rc * Math.cos(th), Y + rc * Math.sin(th) * Math.cos(t), Z + rc * Math.sin(th) * Math.sin(t), 0)); }
      for (let j = 0; j < 6; j++) bonds.push([ids[j], ids[(j + 1) % 6]]);
      for (const j of [1, 2, 4, 5]) { const th = j * Math.PI / 3, h = this.addRaw(SP.H, X0 + k * step + rh * Math.cos(th), Y + rh * Math.sin(th) * Math.cos(t), Z + rh * Math.sin(th) * Math.sin(t), 0); bonds.push([ids[j], h]); }
      if (k) bonds.push([ring[k - 1][0], ids[3]]);
      ring.push(ids);
    }
    const ends = [[ring[0][3], -1], [ring[rings - 1][0], 1]], anchors = [];
    for (const [c, sgn] of ends) {
      // the Au-S bond leaves at 30 degrees to the molecular axis: a straight C-S-Au line is an unstable balance point where the
      // torsion about C-S is undefined, and thermal motion off it throws huge forces (measured: tens of eV appear in 2 fs)
      const sx = this.x[c] + sgn * 1.77, s = this.addRaw(SP.S, sx, Y, Z, 0); bonds.push([c, s]); anchors.push(c);
      const ax = sx + sgn * 2.40 * Math.cos(Math.PI / 6), ay = Y + 2.40 * Math.sin(Math.PI / 6);
      for (const dy of [-2.88, 0, 2.88]) for (const dz of [-2.88, 0, 2.88]) { const g = this.addRaw(SP.Au, ax, ay + dy, Z + dz, 1); this.fixed[g] = 1; if (!dy && !dz) bonds.push([s, g]); }
      for (const dy of [-1.44, 1.44]) for (const dz of [-1.44, 1.44]) { const g = this.addRaw(SP.Au, ax + sgn * 2.35, ay + dy, Z + dz, 1); this.fixed[g] = 1; }
    }
    this.chem.bonds = bonds; this.chem.dirty = true; this.chem.retype(); this.listDirty = true;
    this.name = ['Benzene-dithiol', 'Biphenyl-dithiol', 'Terphenyl-dithiol'][rings - 1] + ' junction'; this.junction = anchors;
    // nudge (a symmetric start minimises onto a saddle and releases its energy as heat later), then relax fully
    for (let i = 0; i < this.N; i++) if (!this.fixed[i]) { this.x[i] += (Math.random() - 0.5) * 0.1; this.y[i] += (Math.random() - 0.5) * 0.1; this.z[i] += (Math.random() - 0.5) * 0.1; }
    this.listDirty = true; this.computeForces(); this.quench(3000, 0.3);
    this.finish(T0, 0.3);
    return anchors;
  }

  // everything needed to put the system back exactly as it is (positions, velocities, species, bonds, fixed atoms)
  serialize() {
    const N = this.N, r4 = (a) => Array.from(a.subarray(0, N), (v) => Math.round(v * 1e4) / 1e4);
    const vdwKey = Object.keys(VDW).find((k) => VDW[k] === this.vdw) || null;
    return { v: 1, name: this.name, model: this.model, tp: this.tp === TERSOFF.diamond ? 'diamond' : 'graphene', vdw: vdwKey, charges: this.charges, per: this.per.slice(), L: [this.Lx, this.Ly, this.Lz], sheet: this.sheet,
      sp: Array.from(this.sp.subarray(0, N)), grp: Array.from(this.grp.subarray(0, N)), fixed: Array.from(this.fixed.subarray(0, N)),
      x: r4(this.x), y: r4(this.y), z: r4(this.z), vx: r4(this.vx), vy: r4(this.vy), vz: r4(this.vz), dt: this.dt,
      chem: this.model === 'uff' ? this.chem.bonds.map((b) => b.slice()) : null, ff: this.model === 'ff' ? { bonds: this.bonds, angles: this.angles, oops: this.oops } : null };
  }
  restore(d) {
    this.clear(); this.model = d.model; this.tp = d.tp === 'diamond' ? TERSOFF.diamond : TERSOFF.graphene; this.vdw = d.vdw ? VDW[d.vdw] : null; this.charges = !!d.charges;
    this.per = d.per.slice(); [this.Lx, this.Ly, this.Lz] = d.L; this.sheet = !!d.sheet; this.name = d.name;
    for (let i = 0; i < d.sp.length; i++) { this.addRaw(d.sp[i], d.x[i], d.y[i], d.z[i], d.grp[i]); this.fixed[i] = d.fixed ? d.fixed[i] : 0; this.vx[i] = d.vx[i]; this.vy[i] = d.vy[i]; this.vz[i] = d.vz[i]; }
    if (d.ff) { this.bonds = d.ff.bonds; this.angles = d.ff.angles; this.oops = d.ff.oops; }
    this.chem.clear(); if (d.chem) { this.chem.bonds = d.chem.map((b) => b.slice()); this.chem.dirty = true; this.chem.retype(); }
    this.dt = d.dt; this.listDirty = true; this.computeForces(); this.KE = this.kinetic(); this.mark(); this.resetRDF();
  }
  buildEmpty(span = 30) {
    this.clear(); this.model = 'uff'; this.vdw = null; this.charges = false; this.per = [false, false, false];
    this.Lx = this.Ly = this.Lz = span; this.chem.clear(); this.name = 'Empty box \u00B7 chemistry'; this.listDirty = true; this.finish(10, 0.3);
  }
  // the connected piece an atom belongs to: chemical bonds in the chemistry model, otherwise bond-length contacts
  // (graphite layers 3.35 A apart stay separate pieces). Returns a mask over the atoms and their count.
  fragmentMask(i0) {
    const N = this.N, mask = new Uint8Array(this.x.length), st = [i0]; mask[i0] = 1; let n = 1;
    const adj = this.model === 'uff' && this.chem ? (() => { const a = Array.from({ length: N }, () => []); for (const [p, q] of this.chem.bonds) if (p < N && q < N) { a[p].push(q); a[q].push(p); } return a; })() : null;
    while (st.length) {
      const i = st.pop();
      if (adj) { for (const j of adj[i]) if (!mask[j]) { mask[j] = 1; n++; st.push(j); } continue; }
      const ri = SPECIES[this.sp[i]].bond;
      for (let j = 0; j < N; j++) {
        if (mask[j]) continue; const c = Math.max(ri, SPECIES[this.sp[j]].bond);
        const dx = this.mi(this.x[j] - this.x[i], this.Lx, this.per[0]); if (dx > c || dx < -c) continue;
        const dy = this.mi(this.y[j] - this.y[i], this.Ly, this.per[1]); if (dy > c || dy < -c) continue;
        const dz = this.mi(this.z[j] - this.z[i], this.Lz, this.per[2]);
        if (dx * dx + dy * dy + dz * dz < c * c) { mask[j] = 1; n++; st.push(j); }
      }
    }
    return { mask, n };
  }
  maskCOM(i, mask) { const x0 = this.x[i], y0 = this.y[i], z0 = this.z[i]; let M = 0, a = 0, b = 0, c = 0; for (let k = 0; k < this.N; k++) if (mask[k]) { const m = this.mass[k]; M += m; a += m * this.mi(this.x[k] - x0, this.Lx, this.per[0]); b += m * this.mi(this.y[k] - y0, this.Ly, this.per[1]); c += m * this.mi(this.z[k] - z0, this.Lz, this.per[2]); } return [x0 + a / M, y0 + b / M, z0 + c / M]; }
  groupCOM(i) { const g = this.grp[i], x0 = this.x[i], y0 = this.y[i], z0 = this.z[i]; let M = 0, a = 0, b = 0, c = 0; for (let k = 0; k < this.N; k++) if (this.grp[k] === g) { const m = this.mass[k]; M += m; a += m * this.mi(this.x[k] - x0, this.Lx, this.per[0]); b += m * this.mi(this.y[k] - y0, this.Ly, this.per[1]); c += m * this.mi(this.z[k] - z0, this.Lz, this.per[2]); } return [x0 + a / M, y0 + b / M, z0 + c / M]; }
  switchBoundary() { }
  setBox() { }
}
