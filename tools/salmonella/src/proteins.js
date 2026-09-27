// Hero membrane proteins in cartoon style: OmpF-like porin trimer (outer membrane),
// KcsA-like K+ channel tetramer (inner membrane), F1Fo ATP synthase (inner membrane).
// Local frame: z = outward membrane normal, z = 0 at the membrane mid-plane.
import * as THREE from 'three';
import { TAU, helixGeometry, tubeGeometry, splineTubeGeometry, stripGeometry, lumpySphere, smoothstep, lerp, mulberry32, clamp } from './geom.js';
import { protMat } from './materials.js';
import { PAL } from './palette.js';

const cylPt = (r, th, z) => new THREE.Vector3(r * Math.cos(th), r * Math.sin(th), z);
const sphereGeom = new THREE.IcosahedronGeometry(1, 2);
const dummy = new THREE.Object3D();

function helix(from, to, mat, opts) { return new THREE.Mesh(helixGeometry(from, to, opts), mat); }
function spline(ctrl, r, mat, nSeg = 20) { return new THREE.Mesh(splineTubeGeometry(ctrl, r, nSeg, 6), mat); }
function blob(r, mat, s, seed = 1) { const m = new THREE.Mesh(lumpySphere(r, 3, 0.2, seed, 1.6), mat); if (s) m.scale.copy(s); return m; }

// ---------------------------------------------------------------- porin
export function buildPorin(opts = {}) {
  const g = new THREE.Group(); g.name = 'porin';
  const mats = PAL.porin.map((c) => protMat(c, { roughness: 0.45 }));
  const loopMat = protMat(PAL.porinLoop, { roughness: 0.5 });
  const nS = 16, rb = 1.55, h = 4.2, tilt = Math.tan(42 * Math.PI / 180);
  for (let k = 0; k < 3; k++) {
    const ca = k * TAU / 3 + (opts.spin ?? 0);
    const center = new THREE.Vector3(2.35 * Math.cos(ca), 2.35 * Math.sin(ca), 0);
    const strandPts = [];
    const geoms = [];
    for (let j = 0; j < nS; j++) {
      const th0 = j * TAU / nS + ca;
      const pts = [], wd = [];
      for (let q = 0; q <= 8; q++) {
        const z = -h / 2 + (q / 8) * h; const th = th0 + z * tilt / rb;
        pts.push(center.clone().add(cylPt(rb, th, z)));
        wd.push(new THREE.Vector3(-Math.sin(th), Math.cos(th), 0));
      }
      strandPts.push(pts);
      geoms.push(stripGeometry(pts, wd, 0.38, 0.13));
    }
    for (const ge of geoms) g.add(new THREE.Mesh(ge, mats[k]));
    // loops: alternate top (extracellular, long) and bottom (periplasmic, short)
    for (let j = 0; j < nS; j++) {
      const A = strandPts[j], B = strandPts[(j + 1) % nS];
      const top = j % 2 === 0;
      const a = top ? A[8] : A[0], b = top ? B[8] : B[0];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const radial = mid.clone().sub(center).setZ(0).normalize();
      let bulge = top ? 1.3 + 0.5 * Math.sin(j * 1.7) : 0.45;
      let rad = top ? 0.5 : 0.25;
      if (top && j === 4) { bulge = 1.0; rad = -1.3; } // L3 folds into the barrel: constriction
      const c1 = a.clone().addScaledVector(new THREE.Vector3(0, 0, top ? 1 : -1), bulge * 0.7).addScaledVector(radial, rad * 0.5);
      const c2 = mid.clone().addScaledVector(new THREE.Vector3(0, 0, top ? 1 : -1), bulge).addScaledVector(radial, rad);
      const c3 = b.clone().addScaledVector(new THREE.Vector3(0, 0, top ? 1 : -1), bulge * 0.7).addScaledVector(radial, rad * 0.5);
      g.add(spline([a, c1, c2, c3, b], 0.15, loopMat, 14));
    }
  }
  let flow = null;
  if (opts.flow !== false) {
    const mat = protMat(0xdfe8f0, { roughness: 0.35, clearcoat: 0.6 });
    flow = new THREE.InstancedMesh(sphereGeom, mat, 12);
    flow.frustumCulled = false; g.add(flow);
  }
  const state = { flow, spin: opts.spin ?? 0 };
  return {
    group: g,
    update(t) {
      if (!flow) return;
      for (let i = 0; i < 12; i++) {
        const k = i % 3; const ca = k * TAU / 3 + state.spin;
        const cx = 2.35 * Math.cos(ca), cy = 2.35 * Math.sin(ca);
        const ph = (t * 0.9 + i * 0.37) % 1;
        const z = 5.5 - ph * 11;
        const wob = 0.35 * (1 - smoothstep(-2.5, -1.2, z)) * (1 - smoothstep(1.2, 2.5, z) * 0) ; // wobble
        const lat = 0.25 + 0.5 * Math.abs(Math.sin(i * 2.1)); const ang = t * 3 + i;
        const inside = Math.abs(z) < 2.2 ? 0.25 : 1.0;
        dummy.position.set(cx + lat * inside * Math.cos(ang), cy + lat * inside * Math.sin(ang), z);
        const s = 0.22 + 0.06 * (i % 4);
        dummy.scale.set(s, s, s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        flow.setMatrixAt(i, dummy.matrix);
      }
      flow.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- K+ channel
export function buildKChannel() {
  const g = new THREE.Group(); g.name = 'kchannel';
  const mA = protMat(PAL.kA, { roughness: 0.45 }), mB = protMat(PAL.kB, { roughness: 0.45 });
  const mF = protMat(PAL.kFilter, { roughness: 0.4, clearcoat: 0.5 });
  const mLoop = (m) => m;
  for (let s = 0; s < 4; s++) {
    const th = s * TAU / 4; const mat = s % 2 ? mB : mA;
    const M1a = cylPt(2.05, th - 0.55, -2.1), M1b = cylPt(1.75, th + 0.15, 2.1);
    const Pa = cylPt(1.55, th + 0.95, 2.0), Pb = cylPt(0.62, th + 0.75, 0.75);
    const Fa = cylPt(0.45, th + 0.6, 0.7), Fb = cylPt(0.45, th + 0.6, 1.95);
    const M2a = cylPt(0.85, th + 1.75, -2.4), M2b = cylPt(1.9, th + 1.25, 1.95);
    g.add(helix(M1a, M1b, mat));
    g.add(helix(Pa, Pb, mat, { segsPerTurn: 9 }));
    g.add(helix(M2a, M2b, mat));
    g.add(new THREE.Mesh(tubeGeometry([Fa, Fb], 0.14, 6), mF));
    // connecting loops
    g.add(spline([M1b, cylPt(1.95, th + 0.5, 2.9), Pa], 0.13, mLoop(mat), 12));
    g.add(spline([Pb, cylPt(0.5, th + 0.68, 0.72), Fa], 0.13, mF, 6));
    g.add(spline([Fb, cylPt(1.0, th + 0.9, 2.7), cylPt(1.7, th + 1.2, 2.6), M2b], 0.13, mLoop(mat), 14));
    // cytoplasmic tail
    g.add(spline([M2a, cylPt(1.4, th + 2.1, -3.0), cylPt(2.2, th + 2.4, -3.3)], 0.13, mLoop(mat), 10));
  }
  const ionMat = protMat(PAL.ion, { roughness: 0.3, clearcoat: 0.6 });
  const ions = new THREE.InstancedMesh(sphereGeom, ionMat, 10); ions.frustumCulled = false; g.add(ions);
  const sites = [3.4, 2.75, 1.95, 1.6, 1.25, 0.9, 0.1, -1.1, -2.6, -4.0];
  const rng = mulberry32(77); const loose = [];
  for (let i = 0; i < 6; i++) loose.push({ p: new THREE.Vector3((rng() - 0.5) * 4, (rng() - 0.5) * 4, 3 + rng() * 3), v: new THREE.Vector3() });
  return {
    group: g,
    update(t, dt) {
      const period = 0.55; const n = sites.length - 1;
      for (let i = 0; i < 4; i++) {
        const tau = ((t / (period * n)) + i * 0.25) % 1;
        const idx = Math.min(n - 1, Math.floor(tau * n)); const fr = tau * n - idx;
        const z = lerp(sites[idx], sites[idx + 1], smoothstep(0.6, 1, fr));
        const wob = Math.abs(z) < 2.2 && z > 0.5 ? 0.04 : 0.25;
        dummy.position.set(wob * Math.cos(t * 5 + i), wob * Math.sin(t * 5 + i), z);
        dummy.scale.set(0.33, 0.33, 0.33); dummy.updateMatrix(); ions.setMatrixAt(i, dummy.matrix);
      }
      for (let i = 0; i < 6; i++) {
        const L = loose[i];
        L.v.x += (rng() - 0.5) * 20 * dt; L.v.y += (rng() - 0.5) * 20 * dt; L.v.z += (rng() - 0.5) * 20 * dt;
        L.v.multiplyScalar(Math.exp(-dt * 3));
        L.p.addScaledVector(L.v, dt);
        L.p.x = clamp(L.p.x, -3, 3); L.p.y = clamp(L.p.y, -3, 3); L.p.z = clamp(L.p.z, 2.6, 6.5);
        dummy.position.copy(L.p); dummy.scale.set(0.33, 0.33, 0.33); dummy.updateMatrix(); ions.setMatrixAt(4 + i, dummy.matrix);
      }
      ions.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- ATP synthase
// Built with F1 pointing to +z; the caller orients +z into the cytoplasm.
export function buildATPSynthase() {
  const g = new THREE.Group(); g.name = 'atpsynthase';
  const rotor = new THREE.Group(), stat = new THREE.Group(); g.add(rotor, stat);
  const mC = protMat(PAL.atpC, { roughness: 0.45 }), mG = protMat(PAL.atpGamma, { roughness: 0.45 });
  const mAl = protMat(PAL.atpAlpha), mBe = protMat(PAL.atpBeta), mA = protMat(PAL.atpA, { roughness: 0.45 });
  const mB = protMat(PAL.atpB, { roughness: 0.45 }), mD = protMat(PAL.atpDelta), mE = protMat(PAL.atpEps);
  // c10 ring of helical hairpins
  for (let i = 0; i < 10; i++) {
    const th = i * TAU / 10;
    const ia = cylPt(2.05, th, -3.3), ib = cylPt(2.15, th + 0.06, 3.1);
    const oa = cylPt(3.1, th + 0.3, 3.0), ob = cylPt(3.15, th + 0.24, -3.4);
    rotor.add(helix(ia, ib, mC), helix(oa, ob, mC));
    rotor.add(spline([ib, cylPt(2.65, th + 0.2, 3.9), oa], 0.14, mC, 8));
  }
  // gamma coiled coil + epsilon + foot
  rotor.add(helix(cylPt(0.6, 0.2, 2.4), cylPt(0.55, 2.3, 12.6), mG, { r: 0.26 }));
  rotor.add(helix(cylPt(0.6, Math.PI + 0.2, 2.4), cylPt(0.55, Math.PI + 2.3, 12.6), mG, { r: 0.26 }));
  rotor.add(blob(1.6, mG, new THREE.Vector3(1.1, 1.1, 0.7), 21).translateZ(3.0));
  const eps = blob(1.3, mE, new THREE.Vector3(1.2, 1, 0.9), 22); eps.position.set(1.9 * Math.cos(1.2), 1.9 * Math.sin(1.2), 3.9); rotor.add(eps);
  // F1 alpha3 beta3 head
  for (let i = 0; i < 6; i++) {
    const th = i * TAU / 6 + 0.3; const alpha = i % 2 === 0;
    const m = blob(1, alpha ? mAl : mBe, new THREE.Vector3(2.6, 2.5, alpha ? 4.4 : 4.1), 30 + i);
    m.position.set(3.5 * Math.cos(th), 3.5 * Math.sin(th), 9.6);
    m.rotation.z = th; m.rotateOnAxis(new THREE.Vector3(0, 1, 0), 0.14);
    stat.add(m);
  }
  // a-subunit (tilted helices beside the c-ring), b2 stalk, delta
  const phA = 0;
  for (let k = 0; k < 5; k++) {
    const a0 = cylPt(4.3 + 0.35 * k, phA - 0.55 + 0.27 * k, -3.2 + (k % 2) * 0.4);
    const a1 = cylPt(4.9 + 0.35 * k, phA - 0.75 + 0.27 * k, 2.6 - (k % 2) * 0.6);
    stat.add(helix(k % 2 ? a1 : a0, k % 2 ? a0 : a1, mA));
  }
  stat.add(helix(cylPt(5.4, phA - 0.16, -2.6), cylPt(4.4, phA - 0.12, 13.4), mB, { r: 0.24 }));
  stat.add(helix(cylPt(5.4, phA + 0.16, -2.6), cylPt(4.4, phA + 0.12, 13.4), mB, { r: 0.24 }));
  const delta = blob(1.4, mD, null, 40); delta.position.set(3.0 * Math.cos(phA), 3.0 * Math.sin(phA), 14.6); stat.add(delta);
  // protons
  const pMat = protMat(PAL.proton, { roughness: 0.3, clearcoat: 0.7, emissive: new THREE.Color(PAL.proton), emissiveIntensity: 0.25 });
  const protons = new THREE.InstancedMesh(sphereGeom, pMat, 4); protons.frustumCulled = false; stat.add(protons);
  return {
    group: g, rotor,
    update(t, omega) {
      rotor.rotation.z = omega * t;
      const rideFrac = 0.9; const rideT = rideFrac * TAU / Math.max(omega, 0.05);
      const P = rideT / 0.65;
      for (let k = 0; k < 4; k++) {
        const tau = ((t / P) + k / 4) % 1;
        let pos;
        if (tau < 0.2) { const u = smoothstep(0, 1, tau / 0.2); pos = cylPt(lerp(5.8, 2.6, u), phA + lerp(-0.25, 0, u), lerp(-5.5, -0.6, u)); }
        else if (tau < 0.85) { const u = (tau - 0.2) / 0.65; pos = cylPt(2.6, phA + u * rideFrac * TAU, -0.6); }
        else { const u = smoothstep(0, 1, (tau - 0.85) / 0.15); pos = cylPt(lerp(2.6, 4.2, u), phA + rideFrac * TAU + u * 0.4, lerp(-0.6, 4.8, u)); }
        dummy.position.copy(pos); const s = 0.24; dummy.scale.set(s, s, s); dummy.updateMatrix(); protons.setMatrixAt(k, dummy.matrix);
      }
      protons.instanceMatrix.needsUpdate = true;
    },
  };
}
