// Floating debris in the liquid medium: small protein blobs, larger aggregates, vesicles, rod fragments.
import * as THREE from 'three';
import { CELL, cellRadialDist, lumpySphere, mulberry32, TAU } from './geom.js';
import { protMat } from './materials.js';
import { PAL } from './palette.js';

const dummy = new THREE.Object3D();
const BOX = { xMin: -10500, xMax: 6500, r: 5500 };

export function buildMedium() {
  const group = new THREE.Group(); group.name = 'medium';
  const rng = mulberry32(99);
  const kinds = [
    { geom: lumpySphere(1, 1, 0.4, 21, 1.8), mat: protMat(0xffffff, { roughness: 0.6 }), count: 2200, sMin: 3, sMax: 12, colors: PAL.debris },
    { geom: lumpySphere(1, 2, 0.32, 22, 1.4), mat: protMat(0xffffff, { roughness: 0.55 }), count: 420, sMin: 14, sMax: 45, colors: PAL.debris },
    { geom: new THREE.SphereGeometry(1, 18, 12), mat: protMat(PAL.vesicle, { roughness: 0.4, clearcoat: 0.4, sheen: 0.5 }), count: 90, sMin: 40, sMax: 140, colors: null },
    { geom: new THREE.CapsuleGeometry(1, 8, 4, 10).rotateX(Math.PI / 2), mat: protMat(0xffffff, { roughness: 0.5 }), count: 60, sMin: 8, sMax: 14, colors: PAL.debris, rod: true },
  ];
  const sets = [];
  for (const k of kinds) {
    const im = new THREE.InstancedMesh(k.geom, k.mat, k.count); im.frustumCulled = false;
    const st = { im, n: k.count, p: new Float32Array(k.count * 3), v: new Float32Array(k.count * 3), rot: new Float32Array(k.count * 3), rv: new Float32Array(k.count * 3), s: new Float32Array(k.count * 3) };
    const col = new THREE.Color();
    for (let i = 0; i < k.count; i++) {
      let x, y, z;
      for (let tries = 0; tries < 50; tries++) {
        x = BOX.xMin + rng() * (BOX.xMax - BOX.xMin);
        const rr = Math.sqrt(rng()) * BOX.r, a = rng() * TAU; y = rr * Math.cos(a); z = rr * Math.sin(a);
        if (cellRadialDist(new THREE.Vector3(x, y, z)) > CELL.R + 120) break;
      }
      st.p[i * 3] = x; st.p[i * 3 + 1] = y; st.p[i * 3 + 2] = z;
      const s = k.sMin + rng() * (k.sMax - k.sMin);
      st.s[i * 3] = s; st.s[i * 3 + 1] = k.rod ? s : s * (0.8 + rng() * 0.4); st.s[i * 3 + 2] = k.rod ? s * (2 + rng() * 5) / 5 : s;
      st.rot[i * 3] = rng() * TAU; st.rot[i * 3 + 1] = rng() * TAU; st.rot[i * 3 + 2] = rng() * TAU;
      const rs = 0.6 / Math.sqrt(s);
      st.rv[i * 3] = (rng() - 0.5) * rs; st.rv[i * 3 + 1] = (rng() - 0.5) * rs; st.rv[i * 3 + 2] = (rng() - 0.5) * rs;
      if (k.colors) { col.set(k.colors[Math.floor(rng() * k.colors.length)]); im.setColorAt(i, col); }
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    sets.push(st); group.add(im);
  }
  const rng2 = mulberry32(5);
  return {
    group,
    update(dt, drift) {
      for (const st of sets) {
        const { im, n, p, v, rot, rv, s } = st;
        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
          const sig = 220 / Math.sqrt(s[i3]);   // Brownian: smaller moves more
          v[i3] += (rng2() - 0.5) * sig * dt * 8; v[i3 + 1] += (rng2() - 0.5) * sig * dt * 8; v[i3 + 2] += (rng2() - 0.5) * sig * dt * 8;
          const damp = Math.exp(-dt * 2.5);
          v[i3] *= damp; v[i3 + 1] *= damp; v[i3 + 2] *= damp;
          p[i3] += (v[i3] - drift) * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
          if (p[i3] < BOX.xMin) p[i3] += BOX.xMax - BOX.xMin; else if (p[i3] > BOX.xMax) p[i3] -= BOX.xMax - BOX.xMin;
          const rr = Math.hypot(p[i3 + 1], p[i3 + 2]); if (rr > BOX.r) { p[i3 + 1] *= -0.98; p[i3 + 2] *= -0.98; }
          rot[i3] += rv[i3] * dt; rot[i3 + 1] += rv[i3 + 1] * dt; rot[i3 + 2] += rv[i3 + 2] * dt;
          dummy.position.set(p[i3], p[i3 + 1], p[i3 + 2]);
          dummy.rotation.set(rot[i3], rot[i3 + 1], rot[i3 + 2]);
          dummy.scale.set(s[i3], s[i3 + 1], s[i3 + 2]);
          dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
