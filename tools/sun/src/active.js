// Magnetic structures: coronal loops over the active regions, the prominence, the global
// (dipole-like) field, the Parker-spiral interplanetary field, a CME, and one photon's random
// walk drawn on the cut face.
import * as THREE from 'three';
import { commonGLSL, cutGLSL } from './glsl.js';
import { U } from './sun.js';
import { SPOTS, PROM, dirLL, DEG, EARTH_X } from './spec.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// deterministic random numbers, so the loops are the same every time the page opens
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// a point jittered within `rad` radians of the direction d, on the unit sphere
function jitterDir(d, rad, R) {
  const e1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const e2 = new THREE.Vector3().crossVectors(d, e1);
  const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad;
  return d.clone().addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r).normalize();
}

// an arch from A to B (unit vectors) rising to height h, as a smooth curve
function archCurve(A, B, h, wobble = 0, R = Math.random) {
  const pts = [];
  const n = 28;
  const side = new THREE.Vector3().crossVectors(A, B).normalize();
  const tw = (R() - 0.5) * wobble;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().copy(A).lerp(B, t).normalize();
    const lift = 1 + h * Math.pow(Math.sin(Math.PI * t), 0.85);
    p.multiplyScalar(lift).addScaledVector(side, tw * Math.sin(Math.PI * t));
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

// optically thin plasma in a tube: brightest along the line of sight through its middle,
// with knots streaming along the loop and bright footpoints
function loopMaterial(kind) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uShow: { value: 1 }, uPhase: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSeed;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNW; varying float vSeed;
      void main(){
        vUv = uv; vSeed = aSeed;
        vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz;
        vNW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${commonGLSL}
      ${cutGLSL}
      uniform float uTime, uFilter, uFlare, uShow, uSpotVis;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNW; varying float vSeed;
      void main(){
        if (cutAway(vWorld) || behindMoon(vWorld, uFilter)) discard;
        int m = int(uFilter + .5);
        vec3 V = normalize(cameraPosition - vWorld);
        float mu = abs(dot(normalize(vNW), V));
        float u = vUv.x;
        float knots = .65 + .35 * sin(u * 34. - uTime * (2.2 + vSeed) + vSeed * 20.);
        float foot = exp(-u * 18.) + exp(-(1. - u) * 18.);
        float I = pow(mu, .6) * (knots + .8 * foot);
        vec3 col;
        ${kind === 'prom' ? `
        // prominence: cool (~8000 K) hydrogen - red in H-alpha, faint pink in white light
        float flick = .7 + .6 * vnoise(vec3(u * 12., vSeed * 9., uTime * .4));
        I *= flick;
        // optically thick in Hα and He II: red / orange; pink at totality; faint in Fe IX / XII
        col = m == 0 ? vec3(1., .38, .5) * .55 : m == 1 ? vec3(1., .22, .12) * .45 : m == 2 ? vec3(1., .5, .12) * .6
            : m <= 4 ? vec3(.9, .55, .25) * .12 : m == 7 ? vec3(1., .32, .48) * .7 : vec3(0.);
        ` : `
        // coronal loop, 1-3 MK: bright in Fe IX 171 and Fe XII 193, cooler legs in He II 304,
        // barely visible in white light and Hα, absent from the magnetogram and Dopplergram
        col = m == 0 ? vec3(1., .86, .62) * .07 : m == 1 ? vec3(1., .3, .2) * .06 : m == 2 ? vec3(1., .5, .15) * .22
            : m == 3 ? vec3(1., .80, .32) * .5 : m == 4 ? vec3(.95, .68, .42) * .42 : m == 7 ? vec3(.9, .9, 1.) * .05 : vec3(0.);
        I *= (1. + uFlare * 4.) * uSpotVis;
        // in white light only the loop bodies, not a pile-up of footpoints around the spots
        if (m == 0) I *= smoothstep(.0, .15, u) * smoothstep(1., .85, u);
        `}
        gl_FragColor = vec4(col * I * uShow, 1.);
      }`,
  });
}

function tubeWithSeed(curve, radius, seed) {
  const g = new THREE.TubeGeometry(curve, 64, radius, 8, false);
  const n = g.attributes.position.count;
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(seed), 1));
  return g;
}

export function buildLoops() {
  const R = rng(7);
  const group = new THREE.Group();
  const mat = loopMaterial('loop');
  const pairs = [['leadN', 'followN', 26], ['leadS', 'followS', 14]];
  const geoms = [];
  for (const [a, b, count] of pairs) {
    const sa = SPOTS.find((s) => s.id === a), sb = SPOTS.find((s) => s.id === b);
    const A0 = v3(dirLL(sa.lat, sa.lon)), B0 = v3(dirLL(sb.lat, sb.lon));
    const sep = A0.angleTo(B0);
    for (let i = 0; i < count; i++) {
      // footpoints spread around both spots; the outer loops are larger and higher
      const spread = 0.35 + 0.65 * (i / count);
      const A = jitterDir(A0, sa.r * DEG * 2.2 * spread, R);
      const B = jitterDir(B0, sb.r * DEG * 2.2 * spread, R);
      const h = sep * (0.38 + 0.55 * spread) * (0.8 + 0.4 * R());
      const curve = archCurve(A, B, h, 0.02, R);
      geoms.push(tubeWithSeed(curve, 0.0009 + 0.0011 * R(), R()));
    }
  }
  for (const g of geoms) group.add(new THREE.Mesh(g, mat));
  return { group, mat };
}

export function buildProminence() {
  const R = rng(19);
  const group = new THREE.Group();
  const mat = loopMaterial('prom');
  const c = v3(dirLL(PROM.lat, PROM.lon));
  // the arch runs north-south, so the Corona view (looking along the east-west line) sees it broadside
  const A0 = v3(dirLL(PROM.lat - PROM.span / 2, PROM.lon - 1.2));
  const B0 = v3(dirLL(PROM.lat + PROM.span / 2, PROM.lon + 1.2));
  // the arch: a bundle of twisted threads
  for (let i = 0; i < 16; i++) {
    const A = jitterDir(A0, 0.9 * DEG, R), B = jitterDir(B0, 0.9 * DEG, R);
    const curve = archCurve(A, B, PROM.h * (0.82 + 0.3 * R()), 0.05, R);
    group.add(new THREE.Mesh(tubeWithSeed(curve, 0.0035 + 0.004 * R(), R()), mat));
  }
  // hedgerow: vertical threads hanging from the arch down to the chromosphere
  for (let i = 0; i < 22; i++) {
    const t = 0.12 + 0.76 * R();
    const base = new THREE.Vector3().copy(A0).lerp(B0, t).normalize();
    const topH = PROM.h * Math.pow(Math.sin(Math.PI * t), 0.85) * (0.75 + 0.25 * R());
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const p = base.clone().multiplyScalar(1.004 + topH * k / 10);
      p.x += (R() - 0.5) * 0.004; p.z += (R() - 0.5) * 0.004;
      pts.push(p);
    }
    group.add(new THREE.Mesh(tubeWithSeed(new THREE.CatmullRomCurve3(pts), 0.0022 + 0.002 * R(), R()), mat));
  }
  return { group, mat, center: c };
}

// ------------------------------------------------------------------ global field
// Field lines of a dipole (r = L sin²θ) for the closed corona, and open lines fanning out of
// the polar coronal holes. The cutaway hides them with built-in clipping planes, which line
// materials support: clipIntersection removes only the region behind both planes.
export const cutPlanes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];

export function buildFieldLines() {
  const pos = [], col = [];
  const cClosed = new THREE.Color(0x7fd3ff), cOpen = new THREE.Color(0xffb35c);
  const push = (pts, c) => {
    for (let i = 0; i < pts.length - 1; i++) {
      pos.push(...pts[i], ...pts[i + 1]);
      const f0 = 1 - i / pts.length, f1 = 1 - (i + 1) / pts.length;
      col.push(c.r * (0.4 + 0.6 * f0), c.g * (0.4 + 0.6 * f0), c.b * (0.4 + 0.6 * f0), c.r * (0.4 + 0.6 * f1), c.g * (0.4 + 0.6 * f1), c.b * (0.4 + 0.6 * f1));
    }
  };
  for (let j = 0; j < 14; j++) {
    const ph = (j / 14) * Math.PI * 2;
    for (const L of [1.35, 1.8, 2.5, 3.4]) {
      const t0 = Math.asin(Math.sqrt(1 / L));
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const th = t0 + (Math.PI - 2 * t0) * (i / 60);
        const r = L * Math.sin(th) ** 2;
        pts.push([r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), -r * Math.sin(th) * Math.sin(ph)]);
      }
      push(pts, cClosed);
    }
    for (const sgn of [1, -1]) {
      for (const t0 of [0.08, 0.2, 0.34]) {
        const pts = [];
        for (let i = 0; i <= 50; i++) {
          const r = 1 + 6 * (i / 50) ** 1.3;
          const th = t0 * (1 + 2.1 * (1 - 1 / r));
          const y = sgn * r * Math.cos(th), s = r * Math.sin(th);
          pts.push([s * Math.cos(ph + 0.11), y, -s * Math.sin(ph + 0.11)]);
        }
        push(pts, cOpen);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: cutPlanes, clipIntersection: true });
  return new THREE.LineSegments(g, m);
}

// Parker spiral in the Sun's rotating frame: φ = φ0 − (r − r0)/a with a = v/Ω. The value of a
// makes the spiral cross Earth's (compressed) orbit at 45°, as the real one does at 1 AU.
export function buildParkerSpiral() {
  const a = EARTH_X;   // tan ψ = Ωr/v = 1 at r = EARTH_X
  const pos = [], col = [];
  const sectors = 4;
  for (let s = 0; s < sectors * 3; s++) {
    const phi0 = (s / (sectors * 3)) * Math.PI * 2;
    const c = new THREE.Color(Math.floor(s / 3) % 2 ? 0x6fb6ff : 0xff8a6a);   // alternating sector polarity
    let prev = null;
    for (let i = 0; i <= 220; i++) {
      const r = 1.6 + (36 - 1.6) * (i / 220);
      const phi = phi0 - (r - 1.6) / a;
      const p = [r * Math.cos(phi), 0, -r * Math.sin(phi)];
      if (prev) {
        pos.push(...prev, ...p);
        const f = Math.min(1, (r - 1.6) / 4) * (1 - 0.6 * r / 36);
        col.push(c.r * f, c.g * f, c.b * f, c.r * f, c.g * f, c.b * f);
      }
      prev = p;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
}

// ------------------------------------------------------------------ CME
// A magnetic bubble: bright leading edge (limb-brightened shell), launched radially.
export function buildCME() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uTime: U.uTime },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vW; varying vec3 vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${commonGLSL}
      uniform float uI, uTime; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){
        float mu = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float shell = pow(1. - mu, 2.2);
        float fil = .55 + .9 * fbm(vL * 3.5 + vec3(uTime * .2));
        // brighter on the front (+x of the bubble's own frame)
        float front = .45 + .55 * smoothstep(-.4, .9, normalize(vL).x);
        gl_FragColor = vec4(vec3(1., .93, .82) * shell * fil * front * uI, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ------------------------------------------------------------------ photon random walk
// One photon's path, drawn on the z = 0 cut face. Each step is ~8000 km, i.e. the true mean
// free path (a fraction of a millimetre to millimetres) magnified about ten billion times.
export function buildRandomWalk() {
  const N = 900;
  const pos = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1f6fd6, transparent: true, opacity: 0.9, depthWrite: false }));
  line.renderOrder = 3;
  line.frustumCulled = false;
  const R = rng(3);
  let n = 0, acc = 0;
  function reset() {
    let x = 0.06 + 0.03 * R(), y = 0.12 * (R() - 0.5);
    pos[0] = x; pos[1] = y; pos[2] = 0.004;
    for (let i = 1; i < N; i++) {
      const th = R() * Math.PI * 2;
      x += 0.012 * Math.cos(th); y += 0.012 * Math.sin(th);
      // reflect off the axis plane so the walk stays on this face (x ≥ 0)
      if (x < 0.01) x = 0.02 - x;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = 0.004;
    }
    g.attributes.position.needsUpdate = true;
    n = 1;
  }
  reset();
  g.setDrawRange(0, 1);
  function update(dt) {
    acc += dt * 60;
    while (acc > 1) { acc -= 1; n++; }
    if (n >= N) reset();
    g.setDrawRange(0, n);
  }
  return { line, update };
}
