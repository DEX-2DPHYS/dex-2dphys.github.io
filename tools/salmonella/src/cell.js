// Cell body: outer membrane, peptidoglycan net, inner membrane, cytosol haze, surface proteins,
// ribosomes, nucleoid DNA, cytoplasmic enzymes and fimbriae.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, TAU, cellFrame, cellRadialDist, buildCellGeometry, lumpySphere, mulberry32, makeFrame, quatZTo, curvePoints, DynTube, bendY, clamp } from './geom.js';
import { membraneMaterial, pgMaterial, latticeMaterial, protMat } from './materials.js';
import { PAL } from './palette.js';

const dummy = new THREE.Object3D();

export function buildCell(ctx) {
  // ctx: { clippables: Material[], exclusions: [{p:Vector3, r:number}] }
  const cell = new THREE.Group(); cell.name = 'cell';
  const out = { group: cell, layers: {}, fimbriae: null };

  function layer(name, offset, matOpts, order) {
    const geom = buildCellGeometry(offset);
    const back = membraneMaterial({ ...matOpts, side: THREE.BackSide });
    const front = membraneMaterial({ ...matOpts, side: THREE.FrontSide });
    const mb = new THREE.Mesh(geom, back); mb.renderOrder = order;
    const mf = new THREE.Mesh(geom, front); mf.renderOrder = order + 1;
    mb.name = name + '_back'; mf.name = name + '_front';
    cell.add(mb, mf); ctx.clippables.push(back, front);
    out.layers[name] = { back, front, mb, mf, baseOpacity: matOpts.opacity };
  }
  // outer membrane bilayer: outer leaflet (LPS) and inner leaflet
  layer('om', 0, { color: PAL.om, opacity: 1.0, faceAlpha: 0.93, sheenColor: PAL.omSheen, bump0: [90, 2.4], bump1: [13, 1.3], bump2: [1.15, 0.5], roughness: 0.5 }, 30);
  layer('om2', -6, { color: PAL.omInner, opacity: 0.97, faceAlpha: 0.92, bump0: [90, 1.2], bump1: [9, 0.6], bump2: [1.05, 0.5], roughness: 0.55, sheen: 0.05 }, 28);
  // inner (cytoplasmic) membrane bilayer
  layer('im', -29, { color: PAL.im, opacity: 0.95, faceAlpha: 0.85, bump0: [70, 1.6], bump1: [9, 0.8], bump2: [1.05, 0.5], roughness: 0.5 }, 22);
  layer('im2', -35, { color: PAL.imInner, opacity: 0.95, faceAlpha: 0.9, bump0: [70, 1.0], bump1: [9, 0.6], bump2: [1.05, 0.5], roughness: 0.55, sheen: 0.05 }, 20);
  layer('cyto', -48, { color: PAL.cytosol, opacity: 0.28, faceAlpha: 0.35, fresnelPow: 3, bump0: [200, 0], bump1: [50, 0], bump2: [10, 0], roughness: 0.9, clearcoat: 0, sheen: 0, depthWrite: false }, 10);

  // peptidoglycan
  {
    const geom = buildCellGeometry(-18, 200, 128);
    const mat = pgMaterial({ color: PAL.pg, cell: 6.5, opacity: 0.95 });
    const m = new THREE.Mesh(geom, mat); m.renderOrder = 25; m.name = 'pg';
    cell.add(m); ctx.clippables.push(mat); out.layers.pg = { mat, mesh: m };
  }

  const excluded = (p, extra) => ctx.exclusions.some((e) => p.distanceTo(e.p) < e.r + extra);

  // surface proteins (studs)
  const studGeom = lumpySphere(1, 1, 0.35, 3, 1.6);
  function studs(count, offset, color, sMin, sMax, seed) {
    const mat = protMat(color, { roughness: 0.6 }); ctx.clippables.push(mat);
    const im = new THREE.InstancedMesh(studGeom, mat, count);
    const rng = mulberry32(seed); const f = makeFrame(); let n = 0, guard = 0;
    while (n < count && guard++ < count * 20) {
      const m = 0.01 + rng() * 0.98, phi = rng() * TAU;
      cellFrame(m, phi, offset, f);
      if (excluded(f.p, 6)) continue;
      const s = sMin + rng() * (sMax - sMin);
      dummy.position.copy(f.p).addScaledVector(f.n, -s * 0.45);
      dummy.quaternion.copy(quatZTo(f.n)); dummy.rotateZ(rng() * TAU);
      dummy.scale.set(s, s * (0.8 + rng() * 0.4), s * 0.75); dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix); n++;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; im.name = 'studs' + offset;
    cell.add(im); return im;
  }
  studs(3800, 0, PAL.studOM, 3.5, 7, 11);
  studs(1600, -6, PAL.studOM, 3, 5.5, 13);
  studs(2200, -29, PAL.studIM, 3, 6, 12);
  studs(2200, -35, PAL.studIM, 3, 6, 14);

  // random point inside the cell (before bend), margin from the inner membrane
  function randomInside(rng, margin, acceptFn) {
    const p = new THREE.Vector3();
    for (let k = 0; k < 200; k++) {
      p.set((rng() * 2 - 1) * CELL.halfLen, (rng() * 2 - 1) * CELL.R, (rng() * 2 - 1) * CELL.R);
      const xc = clamp(p.x, -CELL.Hc, CELL.Hc);
      const rd = Math.hypot(p.x - xc, p.y, p.z);
      if (rd > CELL.R - 32 - margin) continue;
      const q = p.clone(); q.y += bendY(q.x);
      if (excluded(q, margin)) continue;
      if (acceptFn && !acceptFn(p, rd)) continue;
      return q;
    }
    return null;
  }
  const inNucleoid = (p, rd) => Math.abs(p.x) < 620 && rd < 230;

  // ribosomes
  {
    const g1 = lumpySphere(11, 2, 0.22, 5, 1.5).translate(0, 0, -4);
    const g2 = lumpySphere(7.5, 2, 0.28, 6, 1.7).translate(0, 0, 9);
    const geom = mergeGeometries([g1, g2]);
    const mat = protMat(PAL.ribosome, { roughness: 0.62 }); ctx.clippables.push(mat);
    const count = 4200; const im = new THREE.InstancedMesh(geom, mat, count);
    const rng = mulberry32(31); let n = 0;
    while (n < count) {
      const p = randomInside(rng, 26, (q, rd) => !(inNucleoid(q, rd) && rng() < 0.9));
      if (!p) continue;
      dummy.position.copy(p); dummy.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
      const s = 0.9 + rng() * 0.25; dummy.scale.set(s, s, s); dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix); n++;
    }
    im.instanceMatrix.needsUpdate = true; im.name = 'ribosomes'; cell.add(im);
  }
  // cytoplasmic enzymes
  {
    const geom = lumpySphere(1, 1, 0.4, 8, 1.9);
    const mat = protMat(PAL.enzyme, { roughness: 0.65 }); ctx.clippables.push(mat);
    const count = 9000; const im = new THREE.InstancedMesh(geom, mat, count);
    const rng = mulberry32(32); let n = 0;
    while (n < count) {
      const p = randomInside(rng, 8, (q, rd) => !(inNucleoid(q, rd) && rng() < 0.6));
      if (!p) continue;
      dummy.position.copy(p); dummy.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
      const s = 2.5 + rng() * 3; dummy.scale.set(s, s * (0.7 + rng() * 0.5), s); dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix); n++;
    }
    im.instanceMatrix.needsUpdate = true; im.name = 'enzymes'; cell.add(im);
  }
  // nucleoid: supercoiled DNA strands as tubes
  {
    const rng = mulberry32(41); const geoms = [];
    for (let s = 0; s < 7; s++) {
      const ctrl = []; const p = new THREE.Vector3((rng() - 0.5) * 900, (rng() - 0.5) * 300, (rng() - 0.5) * 300);
      const dir = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      for (let k = 0; k < 34; k++) {
        ctrl.push(p.clone());
        dir.add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.9)).normalize();
        p.addScaledVector(dir, 150);
        // keep inside the nucleoid region
        if (Math.abs(p.x) > 640) { dir.x *= -1; p.x = clamp(p.x, -640, 640); }
        const rd = Math.hypot(p.y, p.z); if (rd > 225) { dir.y *= -1; dir.z *= -1; p.y *= 225 / rd; p.z *= 225 / rd; }
      }
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      const pts = curvePoints(curve, 640); for (const q of pts) q.y += bendY(q.x);
      const tube = new DynTube(pts.length - 1, 6, 1.6); tube.update(pts, null);
      geoms.push(tube.geometry);
    }
    const geom = mergeGeometries(geoms);
    const mat = latticeMaterial({ color: PAL.dna, tubeR: 1.6, nProto: 2, rise: 3.4, dome: 0.9, shear: 0.5, roughness: 0.45 });
    ctx.clippables.push(mat);
    const m = new THREE.Mesh(geom, mat); m.name = 'dna'; cell.add(m);
  }
  // fimbriae (type-1 pili): thin hairs from the outer membrane
  {
    const rng = mulberry32(51); const geoms = []; const f = makeFrame();
    let made = 0, guard = 0;
    while (made < 38 && guard++ < 500) {
      const m = 0.03 + rng() * 0.94, phi = rng() * TAU;
      cellFrame(m, phi, 0, f);
      if (excluded(f.p, 40)) continue;
      const L = 250 + rng() * 500;
      const dir = f.n.clone().addScaledVector(f.t, (rng() - 0.5) * 0.7).addScaledVector(f.b, (rng() - 0.5) * 0.7).normalize();
      const w = () => new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
      const ctrl = [
        f.p.clone().addScaledVector(f.n, -6),
        f.p.clone().addScaledVector(dir, L * 0.33).add(w().multiplyScalar(L * 0.12)),
        f.p.clone().addScaledVector(dir, L * 0.66).add(w().multiplyScalar(L * 0.22)),
        f.p.clone().addScaledVector(dir, L).add(w().multiplyScalar(L * 0.32)),
      ];
      const pts = curvePoints(new THREE.CatmullRomCurve3(ctrl, false, 'centripetal'), 40);
      const tube = new DynTube(40, 6, 3.5); tube.update(pts, null);
      geoms.push(tube.geometry); made++;
    }
    const geom = mergeGeometries(geoms);
    const mat = latticeMaterial({ color: PAL.fimbria, tubeR: 3.5, nProto: 3, rise: 2.4, dome: 0.9, shear: 1 / 3, roughness: 0.5 });
    ctx.clippables.push(mat);
    const m = new THREE.Mesh(geom, mat); m.name = 'fimbriae'; cell.add(m); out.fimbriae = m;
  }

  out.setMembraneOpacity = (v) => {
    for (const name of ['om', 'om2', 'im', 'im2', 'cyto']) {
      const L = out.layers[name]; const o = L.baseOpacity * v;
      L.back.opacity = o; L.front.opacity = o;
    }
    out.layers.pg.mat.opacity = 0.95 * v;
  };
  return out;
}
