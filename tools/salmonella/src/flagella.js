// Flagellar motor (basal body), hook and rotating helical filament.
import * as THREE from 'three';
import { TAU, CELL, cellFrame, makeFrame, quatZTo, DynTube, smoothstep, lerp, clamp, bendY, lumpySphere, mulberry32 } from './geom.js';
import { protMat, latticeMaterial } from './materials.js';
import { PAL } from './palette.js';

const dummy = new THREE.Object3D();
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);
const IDQ = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

function instanced(geom, mat, items) {
  const im = new THREE.InstancedMesh(geom, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.copy(it.p); dummy.quaternion.copy(it.q || IDQ);
    if (typeof it.s === 'number') dummy.scale.set(it.s, it.s, it.s); else dummy.scale.copy(it.s || ONE);
    dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
  });
  im.instanceMatrix.needsUpdate = true;
  return im;
}
function ring(n, r, z, s, phase = 0) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + phase;
    items.push({ p: new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z), q: new THREE.Quaternion().setFromAxisAngle(Z, a), s });
  }
  return items;
}
const sph = new THREE.IcosahedronGeometry(1, 2);
const lump = lumpySphere(1, 2, 0.18, 4, 1.6);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1); cyl.rotateX(Math.PI / 2); // axis z, unit height

export function motorMaterials() {
  const m = {};
  for (const k of ['cringG', 'cringM', 'cringN', 'msring', 'msringDark', 'rod', 'rodCore', 'lring', 'pring', 'stator', 'motB', 'exportGate', 'flhA', 'fliI', 'fliH', 'cap'])
    m[k] = protMat(PAL[k]);
  m.filament = latticeMaterial({ color: PAL.filament, tubeR: 10, nProto: 11, rise: 5.27, dome: 1.7, roughness: 0.45 });
  m.hook = latticeMaterial({ color: PAL.hook, tubeR: 10, nProto: 11, rise: 4.4, dome: 1.7, roughness: 0.45 });
  return m;
}

// Builds one motor in local coordinates: z = outward normal, z = 0 at the outer membrane mid-plane.
export function buildMotorTemplate(M) {
  const g = new THREE.Group(); const rotor = new THREE.Group(); const stat = new THREE.Group();
  g.add(rotor, stat);
  const V = (r, t, a) => new THREE.Vector3(r, t, a);
  // --- rotor ---
  rotor.add(instanced(lump, M.cringG, ring(34, 21.5, -38, V(2.6, 2.3, 2.5))));
  rotor.add(instanced(lump, M.cringM, ring(34, 22.5, -43.5, V(2.3, 2.1, 2.7), 0.05)));
  {
    const items = [];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU; const q = new THREE.Quaternion().setFromAxisAngle(Z, a);
      for (const off of [-1.4, 1.4]) items.push({ p: new THREE.Vector3(22 * Math.cos(a) - off * Math.sin(a), 22 * Math.sin(a) + off * Math.cos(a), -49), q, s: 1.5 });
    }
    rotor.add(instanced(sph, M.cringN, items));
  }
  rotor.add(instanced(lump, M.msring, ring(34, 11.8, -32, V(2.4, 1.9, 4.4))));
  rotor.add(new THREE.Mesh(new THREE.TorusGeometry(9.5, 2.4, 8, 40), M.msringDark).translateZ(-29));
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(9, 8, 2.5, 24).rotateX(Math.PI / 2), M.msringDark).translateZ(-36.5));
  {
    const items = [];
    for (let i = 0; i < 66; i++) { const a = i * TAU / 5.5; items.push({ p: new THREE.Vector3(3.6 * Math.cos(a), 3.6 * Math.sin(a), -30 + i * 0.5), s: 2.3 }); }
    rotor.add(instanced(sph, M.rod, items));
    const core = new THREE.Mesh(cyl, M.rodCore); core.position.z = -13.5; core.scale.set(2.4, 2.4, 36);
    rotor.add(core);
  }
  // --- stator / static parts ---
  {
    const items = [];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; items.push({ p: new THREE.Vector3(3.4 * Math.cos(a), 3.4 * Math.sin(a), -37.5), s: 1.6 }); }
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; items.push({ p: new THREE.Vector3(1.9 * Math.cos(a), 1.9 * Math.sin(a), -40.5), s: 1.5 }); }
    stat.add(instanced(sph, M.exportGate, items));
  }
  stat.add(instanced(lump, M.flhA, ring(9, 7.6, -46.5, V(2.7, 2.5, 3.2))));
  {
    const items = ring(6, 4.8, -63, 2.7); items.push({ p: new THREE.Vector3(0, 0, -63), s: 1.6 });
    stat.add(instanced(sph, M.fliI, items));
    const h = [];
    for (const a of [0.9, 0.9 + Math.PI]) for (let k = 0; k < 4; k++) {
      const t = k / 3; h.push({ p: new THREE.Vector3(lerp(7.6, 5.5, t) * Math.cos(a), lerp(7.6, 5.5, t) * Math.sin(a), lerp(-48.5, -60, t)), s: 1.15 });
    }
    stat.add(instanced(sph, M.fliH, h));
  }
  {
    const A = [], B = [], Bc = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + 0.12; const cx = 24.5 * Math.cos(a), cy = 24.5 * Math.sin(a);
      for (let k = 0; k < 5; k++) { const b = (k / 5) * TAU + a; A.push({ p: new THREE.Vector3(cx + 3.4 * Math.cos(b), cy + 3.4 * Math.sin(b), -32), s: 2.2 }); }
      for (const off of [-1.3, 1.3]) {
        const px = cx - off * Math.sin(a), py = cy + off * Math.cos(a);
        Bc.push({ p: new THREE.Vector3(px, py, -24.5), s: new THREE.Vector3(0.9, 0.9, 13) });
        B.push({ p: new THREE.Vector3(px, py, -17.5), s: 1.9 });
      }
    }
    stat.add(instanced(sph, M.stator, A));
    stat.add(instanced(cyl, M.motB, Bc));
    stat.add(instanced(sph, M.motB, B));
  }
  stat.add(instanced(lump, M.pring, ring(26, 13.2, -18, V(2.5, 2.0, 2.7), 0.1)));
  stat.add(instanced(lump, M.lring, ring(26, 13.2, -1, V(2.5, 2.0, 3.0))));
  return { group: g };
}

const capGeom = (() => {
  const parts = [lumpySphere(5, 1, 0.25, 9, 1.5).scale(1, 1, 0.55)];
  for (let i = 0; i < 5; i++) { const a = i * TAU / 5; parts.push(lumpySphere(2.6, 1, 0.3, 10 + i, 1.5).translate(6.5 * Math.cos(a), 6.5 * Math.sin(a), 2)); }
  return parts;
})();

export class Flagellum {
  constructor(i, m, phi, template, M, mergeGeometries) {
    this.i = i; this.M = M;
    this.frame = cellFrame(m, phi, 0, makeFrame());
    this.phi = phi;
    this.group = new THREE.Group(); this.group.name = 'flagellum' + i;
    this.motor = template.group.clone();
    this.rotor = this.motor.children[0];
    this.motor.position.copy(this.frame.p); this.motor.quaternion.copy(quatZTo(this.frame.n));
    this.group.add(this.motor);
    this.nS = 480;
    this.spine = []; this.spineN = []; this.spineB = []; this.spineU = new Float32Array(this.nS + 1);
    this.helixPts = []; this.helixRef = [];
    for (let k = 0; k <= this.nS; k++) { this.spine.push(new THREE.Vector3()); this.spineN.push(new THREE.Vector3()); this.spineB.push(new THREE.Vector3()); this.helixPts.push(new THREE.Vector3()); this.helixRef.push(new THREE.Vector3()); }
    this.tube = new DynTube(this.nS, 12, 10);
    this.filament = new THREE.Mesh(this.tube.geometry, M.filament); this.filament.frustumCulled = false; this.filament.name = 'filament' + i;
    this.hookTube = new DynTube(32, 10, 10);
    this.hook = new THREE.Mesh(this.hookTube.geometry, M.hook); this.hook.frustumCulled = false;
    this.cap = new THREE.Mesh(mergeGeometries(capGeom), M.cap);
    this.group.add(this.filament, this.hook, this.cap);
    this.blend = -1;
    this.buildControlPoints();
    this.setBlend(0);
  }
  buildControlPoints() {
    const { p, n, t, b } = this.frame;
    const t0 = n.clone().multiplyScalar(0.5).addScaledVector(X, -0.85).addScaledVector(b, 0.1).normalize();
    this.t0 = t0;
    const K0 = p.clone().addScaledVector(n, 34).addScaledVector(t0, 30);
    const phi = this.phi;
    const cylP = (x, rho, ph) => new THREE.Vector3(x, rho * Math.cos(ph) + bendY(x), rho * Math.sin(ph));
    // run: hug the body, then converge into a bundle behind the rear pole
    const prof = [[-1000, 530], [-1420, 290], [-2150, 100], [-3600, 60], [-5400, 60], [-7400, 90]];
    const rhoAt = (x) => {
      if (x >= prof[0][0]) return prof[0][1];
      for (let k = 0; k < prof.length - 1; k++) if (x <= prof[k][0] && x >= prof[k + 1][0]) { const u = (x - prof[k][0]) / (prof[k + 1][0] - prof[k][0]); return lerp(prof[k][1], prof[k + 1][1], u); }
      return prof[prof.length - 1][1];
    };
    const run = [K0];
    const x1 = p.x - 150; run.push(cylP(x1, Math.max(rhoAt(x1), 300), phi + 0.05));
    let drift = 0.15;
    for (const [x] of prof) { if (x < x1 - 250) { run.push(cylP(x, rhoAt(x), phi + drift)); } drift += 0.35; }
    // tumble: splay out from the body in a wide helix
    const tOut = n.clone().multiplyScalar(0.85).addScaledVector(X, -0.25).addScaledVector(b, 0.25).normalize();
    const tum = [K0];
    const rng = mulberry32(100 + this.i);
    for (const d of [350, 900, 1600, 2500, 3600, 4900, 6400]) {
      tum.push(K0.clone().addScaledVector(tOut, d).addScaledVector(b, d * 0.18 * Math.sin(d / 2200 + this.i)).addScaledVector(t, d * 0.12 * (rng() - 0.5)).addScaledVector(X, -d * 0.15));
    }
    const resample = (ctrl) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(24);
    this.runPts = resample(run); this.tumPts = resample(tum);
  }
  setBlend(bl) {
    bl = clamp(bl, 0, 1);
    if (Math.abs(bl - this.blend) < 1e-4) return;
    this.blend = bl;
    const ctrl = this.runPts.map((q, k) => q.clone().lerp(this.tumPts[k], bl));
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const pts = curve.getSpacedPoints(this.nS);
    const n = this.nS; const S = this.spine, N = this.spineN, B = this.spineB, U = this.spineU;
    for (let k = 0; k <= n; k++) S[k].copy(pts[k]);
    U[0] = 0; for (let k = 1; k <= n; k++) U[k] = U[k - 1] + S[k].distanceTo(S[k - 1]);
    // parallel-transport frames from the far end (bundle-aligned)
    const T = new THREE.Vector3(), Tp = new THREE.Vector3();
    Tp.subVectors(S[n], S[n - 1]).normalize();
    N[n].set(0, 1, 0).addScaledVector(Tp, -Tp.y).normalize(); B[n].crossVectors(Tp, N[n]);
    for (let k = n - 1; k >= 0; k--) {
      T.subVectors(S[Math.min(k + 1, n)], S[Math.max(k - 1, 0)]).normalize();
      N[k].copy(N[k + 1]).addScaledVector(T, -N[k + 1].dot(T)).normalize(); B[k].crossVectors(T, N[k]);
    }
    // helix radius profile: small beside the body (run), full in the bundle / when splayed
    this.helixR = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const ramp = 200 * smoothstep(0, 800, U[k]);
      const runLimit = 60 + 140 * smoothstep(-1350, -1900, S[k].x);
      const limit = lerp(runLimit, 200, bl);
      this.helixR[k] = Math.min(ramp, limit);
    }
    // hook: cubic Bezier from the L-ring to the filament start, tangent-matched
    const { p, n: nn } = this.frame;
    const T0 = new THREE.Vector3().subVectors(S[1], S[0]).normalize();
    const B0 = p.clone().addScaledVector(nn, 3), B1 = B0.clone().addScaledVector(nn, 24), B3 = S[0].clone(), B2 = B3.clone().addScaledVector(T0, -24);
    const bez = new THREE.CubicBezierCurve3(B0, B1, B2, B3);
    const hp = []; for (let k = 0; k <= 32; k++) hp.push(bez.getPoint(k / 32));
    this.hookTube.seedE1.copy(this.frame.t);
    this.hookTube.update(hp, null, (i) => 5 + 5 * smoothstep(0, 4, i));
  }
  update(t, omega, blend) {
    this.setBlend(blend);
    const n = this.nS, lam = 2300;
    const S = this.spine, N = this.spineN, B = this.spineB, U = this.spineU, R = this.helixR;
    const H = this.helixPts, Rf = this.helixRef;
    const ph0 = -omega * t + this.phi;
    for (let k = 0; k <= n; k++) {
      const th = TAU * U[k] / lam + ph0; const c = Math.cos(th), s = Math.sin(th);
      const rx = c * N[k].x + s * B[k].x, ry = c * N[k].y + s * B[k].y, rz = c * N[k].z + s * B[k].z;
      Rf[k].set(rx, ry, rz);
      H[k].set(S[k].x + R[k] * rx, S[k].y + R[k] * ry, S[k].z + R[k] * rz);
    }
    this.tube.update(H, Rf);
    const Tend = this.tube.T[n];
    this.cap.position.copy(H[n]).addScaledVector(Tend, 3);
    this.cap.quaternion.copy(quatZTo(Tend));
    this.rotor.rotation.z = -omega * t;
  }
}
