// The heliosphere: solar-wind particles streaming out along the Parker spiral, Earth with its
// bow shock and aurorae, and the background stars.
import * as THREE from 'three';
import { commonGLSL } from './glsl.js';
import { EARTH_X, EARTH_R } from './spec.js';
import { rng } from './active.js';

export function buildWind(N = 7000) {
  const R = rng(11);
  const lam = new Float32Array(N), lat = new Float32Array(N), spd = new Float32Array(N);
  const phiB = new Float32Array(N), rr = new Float32Array(N);
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), fade = new Float32Array(N);
  const R0 = 1.15, RMAX = 36;
  for (let i = 0; i < N; i++) {
    const fast = R() < 0.3;
    // fast wind comes out of two coronal-hole extensions; slow wind from the streamer belt
    // discrete sources, so that each one's stream draws its own spiral as the Sun turns
    lam[i] = fast ? (R() < 0.5 ? 0.9 : 4.0) + 0.12 * (R() - 0.5) : Math.floor(R() * 10) * 0.628 + 0.2 + 0.05 * (R() - 0.5);
    lat[i] = (R() - 0.5) * (fast ? 0.16 : 0.1);
    spd[i] = fast ? 1.85 : 1.0;                 // ≈ 750 vs 400 km/s
    const c = fast ? [1.0, 0.78, 0.5] : [0.62, 0.8, 1.0];
    col.set(c, i * 3);
    rr[i] = -1;                                  // seeded on the first update
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uPx: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 color; attribute float aFade; varying vec3 vC; varying float vF;
      uniform float uPx;
      void main(){ vC = color; vF = aFade; vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = clamp(uPx * 45. / -mv.z, 1.3, 3.5); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOpacity; varying vec3 vC; varying float vF;
      void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard;
        gl_FragColor = vec4(vC * (1. - d * d) * vF * uOpacity * .9, 1.); }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;

  // sunAngle: the Sun's current rotation angle; omega: its visual angular speed (rad/s)
  function update(dt, sunAngle, omega) {
    const v0 = omega * EARTH_X;                  // slow wind speed in R☉ per visual second
    for (let i = 0; i < N; i++) {
      if (rr[i] < 0) {
        const age = R() * (RMAX - R0) / (v0 * spd[i]);
        rr[i] = R0 + v0 * spd[i] * age;
        phiB[i] = lam[i] + sunAngle - omega * age;
      }
      rr[i] += v0 * spd[i] * dt;
      if (rr[i] > RMAX) { rr[i] = R0; phiB[i] = lam[i] + sunAngle; }
      const r = rr[i], cl = Math.cos(lat[i]);
      pos[i * 3] = r * Math.cos(phiB[i]) * cl;
      pos[i * 3 + 1] = r * Math.sin(lat[i]);
      pos[i * 3 + 2] = -r * Math.sin(phiB[i]) * cl;
      fade[i] = Math.min(1, (r - R0) / 3.5) * (1 - Math.pow(r / RMAX, 3));
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aFade.needsUpdate = true;
  }
  return { points, mat, update };
}

export function buildEarth() {
  const group = new THREE.Group();
  group.position.set(EARTH_X, 0, 0);
  const auroraU = { value: 0.12 };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 40), new THREE.ShaderMaterial({
    uniforms: { uAur: auroraU },
    vertexShader: 'varying vec3 vN; varying vec3 vL; varying vec3 vW; void main(){ vL = normalize(position); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${commonGLSL}
      uniform float uAur; varying vec3 vN; varying vec3 vL; varying vec3 vW;
      void main(){
        vec3 L = normalize(-vW);                       // the Sun is at the origin
        float day = clamp(dot(normalize(vN), L) * 1.4 + .15, 0., 1.);
        float land = smoothstep(.5, .54, fbm(vL * 2.4 + 3.));
        float ice = smoothstep(.82, .9, abs(vL.y));
        vec3 c = mix(vec3(.04, .16, .42), vec3(.20, .38, .16), land);
        c = mix(c, vec3(.9), ice);
        float cl = smoothstep(.55, .75, fbm(vL * 5. + 11.));
        c = mix(c, vec3(1.), cl * .7);
        float rim = pow(1. - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 3.);
        vec3 col = c * day * 1.2 + vec3(.3, .55, 1.) * rim * (.25 + .75 * day);
        float aur = smoothstep(.12, 0., abs(abs(vL.y) - .9)) * uAur;
        col += vec3(.2, 1., .45) * aur * 2.;
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  group.add(earth);

  // bow shock: a paraboloid standing upstream (towards the Sun, -x), nose ~4 Earth radii away
  // here (the real one sits ~13-15 R_E out, but Earth itself is drawn ~30× too large)
  const prof = [];
  for (let i = 0; i <= 30; i++) { const p = i / 30 * 1.7; prof.push(new THREE.Vector2(p, -1.15 + 0.32 * p * p)); }
  const bg = new THREE.LatheGeometry(prof, 64);
  bg.rotateZ(-Math.PI / 2);
  const bowU = { value: 0.35 };
  const bow = new THREE.Mesh(bg, new THREE.ShaderMaterial({
    uniforms: { uI: bowU },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uI; varying vec3 vN; varying vec3 vW;
      void main(){ float mu = abs(dot(normalize(vN), normalize(cameraPosition - vW))); gl_FragColor = vec4(vec3(.35, .65, 1.) * pow(1. - mu, 2.5) * uI, 1.); }`,
  }));
  group.add(bow);
  return { group, earth, bow, auroraU, bowU };
}

export function buildStars(N = 2600) {
  const R = rng(5);
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([1400 * s * Math.cos(a), 1400 * u, 1400 * s * Math.sin(a)], i * 3);
    const b = 0.12 + 0.6 * Math.pow(R(), 5);
    const t = R();
    col.set(t < 0.15 ? [b, b * 0.8, b * 0.6] : t > 0.85 ? [b * 0.75, b * 0.85, b] : [b, b, b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}
