// Nano walk: the user is "made small" and walks on the structure, in a vast starry night. This module builds only the
// environment (sky, stars, haze, clouds, drifting motes, the glowing floor and its edge); main.js places the lab far away
// in the fog and moves the user. Everything is procedural (no files), made for a standalone headset: a handful of
// draw calls, no post-processing, and the sky is one texture on one sphere that follows the head.
import * as THREE from 'three';

/* ---------- noise on the sphere (so the sky texture has no seam) ---------- */
const hash3 = (x, y, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fx), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fx), fy),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fx), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fx), fy), fz);
}
const fbm = (x, y, z) => { let a = 0.5, s = 0, f = 1; for (let k = 0; k < 4; k++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---------- the sky: deep blue gradient, a tilted Milky Way with dust lanes, two faint nebulae, a glittering star dust ---------- */
function skyTexture() {
  const W = 512, H = 256, img = new ImageData(W, H), d = img.data, nx = 0.38, ny = 0.78, nz = 0.5, nl = Math.hypot(nx, ny, nz);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = (i + 0.5) / W * Math.PI * 2, x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
      const bd = (x * nx + y * ny + z * nz) / nl, band = Math.exp(-bd * bd / 0.05);
      const base = fbm(x * 3 + 11, y * 3, z * 3), dust = fbm(x * 6 + 40, y * 6, z * 6 + 9);
      const mw = band * (0.3 + 1.0 * base) * (1 - 0.7 * sstep(0.42, 0.68, dust));
      const n1 = sstep(0.5, 0.86, fbm(x * 1.7 + 5, y * 1.7, z * 1.7 + 3)) * 0.55, n2 = sstep(0.54, 0.9, fbm(x * 1.4 + 23, y * 1.4 + 7, z * 1.4)) * 0.45;
      const hz = Math.exp(-(lat * lat) / 0.09), up = Math.abs(sl);
      let r = 2 + 6 * (1 - up) + hz * 20, g = 4 + 10 * (1 - up) + hz * 30, b = 12 + 26 * (1 - up) + hz * 70;
      r += mw * (75 + 80 * base) + n1 * 95 + n2 * 14; g += mw * (70 + 50 * base) + n1 * 30 + n2 * 100; b += mw * (135 - 10 * base) + n1 * 140 + n2 * 120;
      const k = 4 * (j * W + i); d[k] = Math.min(255, r); d[k + 1] = Math.min(255, g); d[k + 2] = Math.min(255, b); d[k + 3] = 255;
    }
  }
  const small = document.createElement('canvas'); small.width = W; small.height = H; small.getContext('2d').putImageData(img, 0, 0);
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024; const c = cv.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(small, 0, 0, 2048, 1024);
  const r = rng(77);                                                          // fine star dust, uniform on the sphere
  for (let k = 0; k < 9000; k++) {
    const u = r(), lat = Math.asin(2 * r() - 1), v = 0.5 - lat / Math.PI, a = 0.12 + 0.7 * r() * r(), t = r();
    c.fillStyle = t < 0.2 ? `rgba(170,200,255,${a})` : t < 0.8 ? `rgba(235,240,255,${a})` : `rgba(255,214,170,${a})`; c.fillRect(Math.floor(u * 2048), Math.floor(v * 1024), 1 + (r() < 0.12 ? 1 : 0), 1);
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}
function blobTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d'), r = rng(kind === 'cloud' ? 5 : 9);
  if (kind === 'cloud') {                                                     // a billowy puff: many soft discs
    for (let k = 0; k < 46; k++) { const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 70, x = 128 + Math.cos(a) * d * 1.5, y = 128 + Math.sin(a) * d * 0.7, rad = 26 + r() * 40, gr = c.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 256, 256); }
  } else { const gr = c.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 256, 256); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function floorTexture() {                                                       // radial glow, thin rings, faint spokes
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), m = S / 2;
  const g = c.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, 'rgba(74,227,225,0.22)'); g.addColorStop(0.7, 'rgba(60,130,220,0.10)'); g.addColorStop(1, 'rgba(60,100,220,0)'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  c.lineWidth = 2; for (let k = 1; k <= 16; k++) { const rr = k / 16 * m * 0.97; c.strokeStyle = `rgba(120,220,255,${0.16 * (1 - k / 18)})`; c.beginPath(); c.arc(m, m, rr, 0, Math.PI * 2); c.stroke(); }
  c.lineWidth = 1.5; for (let k = 0; k < 36; k++) { const a = k / 36 * Math.PI * 2; const gg = c.createLinearGradient(m, m, m + Math.cos(a) * m, m + Math.sin(a) * m); gg.addColorStop(0, 'rgba(120,220,255,0.0)'); gg.addColorStop(0.3, 'rgba(120,220,255,0.10)'); gg.addColorStop(1, 'rgba(120,220,255,0)'); c.strokeStyle = gg; c.beginPath(); c.moveTo(m, m); c.lineTo(m + Math.cos(a) * m, m + Math.sin(a) * m); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function gradientStrip(stops, horizontal) { const cv = document.createElement('canvas'); cv.width = horizontal ? 256 : 4; cv.height = horizontal ? 4 : 256; const c = cv.getContext('2d'), g = horizontal ? c.createLinearGradient(0, 0, 256, 0) : c.createLinearGradient(0, 0, 0, 256); for (const [p, col] of stops) g.addColorStop(p, col); c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }

const STAR_VS = `attribute float aSize; attribute float aPhase; attribute vec3 aColor; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
void main(){ vC = aColor; float tw = 0.8 + 0.2 * sin(uTime * (1.1 + aPhase) + aPhase * 40.0); vA = tw; gl_PointSize = aSize * uScale * (0.9 + 0.1 * tw); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STAR_FS = `precision mediump float; varying vec3 vC; varying float vA;
void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; if (d > 1.0) discard; float a = pow(1.0 - d, 1.8); gl_FragColor = vec4(vC * (1.0 + a * 0.7), a * vA); }`;
const MOTE_VS = `attribute float aSize; uniform float uTime; uniform float uScale; uniform vec3 uCam; uniform float uBox; varying float vA;
void main(){ vec3 p = position * uBox + vec3(0.35, 0.22, -0.2) * uTime; p = mod(p - uCam, uBox) - 0.5 * uBox + uCam; vec4 mv = modelViewMatrix * vec4(p, 1.0); float dist = length(mv.xyz);
  vA = smoothstep(0.4, 2.5, dist) * (1.0 - smoothstep(0.34 * uBox, 0.5 * uBox, dist)); gl_PointSize = clamp(aSize * uScale * 9.0 / max(1.0, dist), 1.5, 16.0); gl_Position = projectionMatrix * mv; }`;
const MOTE_FS = `precision mediump float; varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vec3(0.55, 0.92, 1.0), pow(1.0 - d, 1.5) * vA * 0.75); }`;

export function createNanoWorld() {
  const root = new THREE.Group(); root.visible = false;
  const sky = new THREE.Group(); root.add(sky);                               // everything infinitely far: follows the head
  const world = new THREE.Group(); root.add(world);                           // motes and the floor: fixed in the world
  let built = false, lowQ = false, uScale = 1;
  const U = { uTime: { value: 0 }, uScale: { value: 1 } }, UM = { uTime: U.uTime, uScale: U.uScale, uCam: { value: new THREE.Vector3() }, uBox: { value: 34 } };
  const fog = new THREE.FogExp2(0x2a3c80, 0.00095), bg = new THREE.Color(0x03050d);
  const parts = {};

  function build() {
    if (built) return; built = true;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 28), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }));
    dome.renderOrder = -10; dome.rotation.y = 0.9; sky.add(dome); parts.dome = dome;
    // bright stars: crisp points with a slow twinkle, a third of them along the Milky Way
    const NS = 2800, pos = new Float32Array(NS * 3), col = new Float32Array(NS * 3), sz = new Float32Array(NS), ph = new Float32Array(NS), r = rng(4242), pal = [[0.62, 0.72, 1], [0.85, 0.9, 1], [1, 1, 0.95], [1, 0.88, 0.7], [1, 0.72, 0.55]];
    for (let k = 0; k < NS; k++) {
      let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.05);
      let l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      if (k % 3 === 0) { const n = new THREE.Vector3(0.38, 0.78, 0.5).normalize(), p = new THREE.Vector3(x, y, z), dn = p.dot(n); p.addScaledVector(n, -dn * 0.8).normalize(); x = p.x; y = p.y; z = p.z; }
      pos[3 * k] = x * 2800; pos[3 * k + 1] = y * 2800; pos[3 * k + 2] = z * 2800;
      const c = pal[Math.min(4, Math.floor(Math.pow(r(), 1.3) * 5))]; col[3 * k] = c[0]; col[3 * k + 1] = c[1]; col[3 * k + 2] = c[2];
      sz[k] = 1.6 + 5.5 * Math.pow(r(), 7); ph[k] = r();
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); sg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: U, vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    stars.frustumCulled = false; stars.renderOrder = -9; sky.add(stars); parts.stars = stars; parts.starN = NS;
    // horizon haze: a vertical band of luminous mist all round
    const haze = new THREE.Mesh(new THREE.CylinderGeometry(2600, 2600, 1500, 40, 1, true), new THREE.MeshBasicMaterial({ map: gradientStrip([[0, 'rgba(40,60,130,0)'], [0.42, 'rgba(46,70,150,0.16)'], [0.5, 'rgba(90,110,190,0.36)'], [0.58, 'rgba(40,60,140,0.14)'], [1, 'rgba(30,40,110,0)']]), side: THREE.BackSide, transparent: true, depthWrite: false, fog: false }));
    haze.renderOrder = -8; sky.add(haze);
    // cloud banks round the horizon: soft tinted puffs, the lab is seen among them
    const ct = blobTexture('cloud'), rc = rng(31); parts.clouds = [];
    const tints = [0x4a5fb8, 0x6a4fb0, 0x3f7fc0, 0x8a5aa8, 0x2f4f9a];
    for (let k = 0; k < 18; k++) {
      const m = new THREE.SpriteMaterial({ map: ct, color: tints[k % tints.length], transparent: true, opacity: 0.1 + 0.13 * rc(), depthWrite: false, fog: false, rotation: (rc() - 0.5) * 0.5 }), s = new THREE.Sprite(m);
      const az = rc() * Math.PI * 2, el = -0.1 + 0.34 * rc() * rc(), dist = 1700 + 800 * rc(); s.position.set(Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist);
      const w = 900 + 900 * rc(); s.scale.set(w, w * 0.42, 1); s.renderOrder = -7; sky.add(s); parts.clouds.push(s);
    }
    // a shooting star every now and then
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: gradientStrip([[0, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,1)']], true), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    sh.visible = false; sh.renderOrder = -6; sky.add(sh); parts.shoot = { m: sh, t: -8 - 10 * Math.random(), a: new THREE.Vector3(), b: new THREE.Vector3() };
    // drifting motes round the user: they make walking (and the scale of the world) readable
    const NM = 700, mp = new Float32Array(NM * 3), ms = new Float32Array(NM); for (let k = 0; k < NM; k++) { mp[3 * k] = r(); mp[3 * k + 1] = r(); mp[3 * k + 2] = r(); ms[k] = 0.5 + r() * r() * 1.4; }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('aSize', new THREE.BufferAttribute(ms, 1));
    const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ uniforms: UM, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    motes.frustumCulled = false; motes.renderOrder = 5; world.add(motes); parts.motes = motes; parts.moteN = NM;
    // the floor: a glowing field under the atoms, a bright edge and a soft curtain rising from it
    const fl = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); fl.rotation.x = -Math.PI / 2; fl.renderOrder = -1; world.add(fl); parts.floor = fl;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: 0x6fe8ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })); ring.rotation.x = -Math.PI / 2; world.add(ring); parts.ring = ring;
    const cur = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), new THREE.MeshBasicMaterial({ map: gradientStrip([[0, 'rgba(111,232,255,0)'], [1, 'rgba(111,232,255,0.5)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })); cur.renderOrder = 4; world.add(cur); parts.curtain = cur;
  }
  function setQuality(lo) {                                                    // Low: fewer stars, motes and clouds
    lowQ = lo; if (!built) return;
    parts.stars.geometry.setDrawRange(0, lo ? 1300 : parts.starN); parts.motes.geometry.setDrawRange(0, lo ? 260 : parts.moteN);
    parts.clouds.forEach((s, k) => { s.visible = !lo || k % 3 === 0; });
  }
  function setGround(R, cx, cz) {                                              // floor radius R (metres) centred at (cx, cz), y = 0 is the walking plane
    if (!built) return; const e = R + 3;
    parts.floor.scale.set(e, e, e); parts.floor.position.set(cx, -0.06, cz);
    parts.ring.scale.set(R, R, R); parts.ring.position.set(cx, 0.01, cz); parts.curtain.scale.set(R, 7, R); parts.curtain.position.set(cx, 3.5, cz);
  }
  const tmp = new THREE.Vector3();
  function update(camPos, t, dt, scale) {
    if (!built || !root.visible) return;
    U.uTime.value = UM.uTime.value = t; U.uScale.value = UM.uScale.value = scale; UM.uCam.value.copy(camPos);
    sky.position.copy(camPos);
    const s = parts.shoot; if (t - s.t > 14) { s.t = t; const az = Math.random() * 6.28, el = 0.25 + 0.5 * Math.random(); s.a.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(2600); s.b.set(-Math.sin(az) * 0.5, -0.18, Math.cos(az) * 0.5).multiplyScalar(1200).add(s.a); }
    const k = (t - s.t) / 0.9; s.m.visible = k >= 0 && k <= 1;
    if (s.m.visible) {                                                       // a streak facing the viewer, head first
      const dir = tmp.copy(s.b).sub(s.a).normalize(), len = 300, head = s.a.clone().lerp(s.b, k), mid = head.clone().addScaledVector(dir, -len * 0.5), zx = mid.clone().negate().normalize(), yx = zx.clone().cross(dir).normalize();
      s.m.matrix.makeBasis(dir, yx, zx).setPosition(mid); s.m.matrixAutoUpdate = false; s.m.scale.set(1, 1, 1); s.m.matrix.scale(new THREE.Vector3(len, 9, 1)); s.m.material.opacity = Math.sin(k * Math.PI);
    }
    parts.ring.material.opacity = 0.55 + 0.2 * Math.sin(t * 1.6);
  }
  return { root, fog, bg, build, setQuality, setGround, update, get built() { return built; } };
}

export const WALK_DA = {
  'Bring': 'Hent', 'Point the wand at the structure': 'Peg tryllestaven mod strukturen',
  'Tool: BRING - hold click on a piece out of reach: the wand pulls it to you and holds it at the tip; let go to drop it': 'Værktøj: HENT - hold museknappen nede på et stykke uden for rækkevidde: tryllestaven trækker det hen til dig og holder det i spidsen; slip for at tabe det',
  'Tool: BRING - hold trigger on a piece out of reach: the wand pulls it to you and holds it at the tip; let go to drop it': 'Værktøj: HENT - hold aftrækkeren inde på et stykke uden for rækkevidde: tryllestaven trækker det hen til dig og holder det i spidsen; slip for at tabe det',
  'Pulling {1} atoms to you - swing the wand to place them, let go to drop them': 'Trækker {1} atomer hen til dig - sving staven for at placere dem, slip for at tabe dem',
  'Pulling {1} atom to you - swing the wand to place them, let go to drop them': 'Trækker {1} atom hen til dig - sving staven for at placere det, slip for at tabe det',
  'Walk': 'Gå', 'General': 'Generelt', 'Display': 'Visning', 'Menu': 'Menu', 'Cancel': 'Annuller',
  'Tiny now: left stick walks, right stick turns. Walk button: back to the lab': 'Bittesmå nu: venstre pind går, højre pind drejer. Gå-knappen: tilbage til laboratoriet',
  'Tiny now: W A S D or arrows walk (Shift runs), drag to look, Esc: back to the lab': 'Bittesmå nu: W A S D eller piletaster går (Shift løber), træk for at kigge, Esc: tilbage til laboratoriet',
  'Click on or just next to the structure to add an atom': 'Klik på eller lige ved siden af strukturen for at tilføje et atom',
  'Click directly on an atom to delete it': 'Klik direkte på et atom for at slette det',
  'Nothing in the cone - aim at the structure': 'Intet i keglen - sigt mod strukturen',
  'Nothing gets through: are both contacts on the same connected piece?': 'Intet kommer igennem: sidder begge kontakter på det samme sammenhængende stykke?',
  'The tutorial starts with a fresh graphene sheet, so your current structure would be replaced.': 'Guiden starter med et nyt grafenark, så din nuværende struktur ville blive erstattet.',
  'Save my structure, then start': 'Gem min struktur, og start så', 'Start (replace my structure)': 'Start (erstat min struktur)',
  'WALK - be made small and walk on the structure (atom 30 cm, bond 1.5 m). Esc or this button: back to the lab': 'GÅ - bliv gjort lille og gå på strukturen (atom 30 cm, binding 1,5 m). Esc eller denne knap: tilbage til laboratoriet',
  'GUIDE - a short tour of the basic tools on a graphene sheet': 'GUIDE - en kort rundtur i de grundlæggende værktøjer på et grafenark',
  'WARMER - raise the target temperature: the atoms shake harder': 'VARMERE - hæv måltemperaturen: atomerne ryster kraftigere',
  'COLDER - lower the target temperature: the atoms calm down': 'KOLDERE - sænk måltemperaturen: atomerne falder til ro',
  'RUN / PAUSE - let time flow or freeze the atoms (space bar)': 'KØR / PAUSE - lad tiden løbe eller frys atomerne (mellemrumstasten)',
  'START AGAIN - rebuild the current structure from scratch': 'START FORFRA - byg den nuværende struktur op igen',
  'ELEMENT - choose which element Attach and Add use': 'GRUNDSTOF - vælg hvilket grundstof Påsæt og Tilføj bruger',
  'H FILL - fill free valences with hydrogen when attaching': 'H-FYLD - fyld frie valenser med brint ved påsætning',
  'Tool: BRING - hold click on a piece out of reach: the wand pulls it to you; let go to drop it': 'Værktøj: HENT - hold museknappen på et stykke uden for rækkevidde: staven trækker det til dig; slip for at tabe det',
  'Tool: BRING - hold trigger on a piece out of reach: the wand pulls it to you; let go to drop it': 'Værktøj: HENT - hold aftrækkeren på et stykke uden for rækkevidde: staven trækker det til dig; slip for at tabe det',
  'Tool: ADD ATOM - click on or next to the structure': 'Værktøj: TILFØJ ATOM - klik på eller ved siden af strukturen',
  'Tool: ADD ATOM - trigger on or next to the structure': 'Værktøj: TILFØJ ATOM - aftrækker på eller ved siden af strukturen', 'Back to the lab': 'Tilbage til laboratoriet', 'Made small': 'Gjort lille', 'Walk inside the structure': 'Gå rundt inde i strukturen',
  'You are tiny now - an atom is 30 cm and a bond 1.5 m. Left stick: walk. Right stick: turn. Press Walk to go back to the lab.': 'Du er blevet bittesmå - et atom er 30 cm og en binding 1,5 m. Venstre pind: gå. Højre pind: drej. Tryk på Gå for at vende tilbage til laboratoriet.',
  'You are tiny now - an atom is 30 cm and a bond 1.5 m. W A S D or arrows: walk (Shift: run). Drag: look. Esc or Walk: back to the lab.': 'Du er blevet bittesmå - et atom er 30 cm og en binding 1,5 m. W A S D eller piletaster: gå (Shift: løb). Træk: kig. Esc eller Gå: tilbage til laboratoriet.',
  'Walking needs a material (not the noble-gas box): pick graphene, a nanotube, C60 ...': 'At gå rundt kræver et materiale (ikke ædelgas-boksen): vælg grafen, et nanorør, C60 ...',
  'Build something first': 'Byg noget først',
  'Walking': 'Gå-tilstand', 'Make me small and let me walk on the structure': 'Gør mig lille, så jeg kan gå på strukturen',
  'Tip: add a substrate (graphene, MoS₂, SiO₂) under a molecule to walk on it.': 'Tip: tilføj et substrat (grafen, MoS₂, SiO₂) under et molekyle for at gå på det.',
};
