import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, cellFrame, makeFrame, quatZTo, clamp, lerp } from './geom.js';
import { buildCell } from './cell.js';
import { motorMaterials, buildMotorTemplate, Flagellum } from './flagella.js';
import { buildPorin, buildKChannel, buildATPSynthase } from './proteins.js';
import { buildMedium } from './medium.js';
import { SceneDoFPass } from './dof.js';
import { vignetteFragGLSL } from './glsl.js';
import { PAL } from './palette.js';
import { initPortal } from './portal.js';

const Q = new URLSearchParams(location.search);
const stage = document.getElementById('stage');

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;
renderer.domElement.tabIndex = 0;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 90000);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xffffff, 0xb9c2cc, 0.3);
const key = new THREE.DirectionalLight(0xfff1de, 1.9); key.position.set(-0.35, 1.0, 0.75);
const fill = new THREE.DirectionalLight(0xdbe6ff, 0.45); fill.position.set(0.9, 0.1, 0.3);
const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(-0.3, 0.5, -1);
scene.add(hemi, key, fill, rim);

// background: a large gradient dome (unaffected by fog)
const bgMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color(0xffffff) }, bottom: { value: new THREE.Color(0xcccccc) } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vDir; void main(){ float t = smoothstep(-0.7, 0.9, vDir.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const bgDome = new THREE.Mesh(new THREE.SphereGeometry(70000, 32, 16), bgMat);
bgDome.frustumCulled = false; bgDome.renderOrder = -10;
scene.add(bgDome);

// ------------------------------------------------------------------ specimen
const ctx = { clippables: [], exclusions: [] };
const flagSpots = [[0.30, 2.0], [0.42, 4.3], [0.55, 0.6], [0.63, 3.2], [0.72, 5.3], [0.80, 1.7], [0.88, 4.0]];
const heroSpots = { porin: [0.40, 1.25, -0.5], kch: [0.50, 1.55, -30.0], atp: [0.58, 1.15, -33.5] };
for (const s of flagSpots) ctx.exclusions.push({ p: cellFrame(s[0], s[1], 0).p.clone(), r: 75 });
ctx.exclusions.push({ p: cellFrame(...heroSpots.porin).p.clone(), r: 48 });
ctx.exclusions.push({ p: cellFrame(...heroSpots.kch).p.clone(), r: 36 });
ctx.exclusions.push({ p: cellFrame(...heroSpots.atp).p.clone(), r: 48 });

const cell = buildCell(ctx);
scene.add(cell.group);

const M = motorMaterials();
const template = buildMotorTemplate(M);
const flagella = flagSpots.map((s, i) => new Flagellum(i, s[0], s[1], template, M, mergeGeometries));
for (const f of flagella) scene.add(f.group);

function place(obj, m, phi, offset, flip = false) {
  const f = cellFrame(m, phi, offset, makeFrame());
  obj.position.copy(f.p);
  obj.quaternion.copy(quatZTo(flip ? f.n.clone().negate() : f.n));
  return f;
}
const porin = buildPorin({ flow: true });
const porinFrame = place(porin.group, ...heroSpots.porin);
scene.add(porin.group);
{
  // a crowd of porins around the hero one
  const seeds = [[0.010, 0.06], [-0.011, 0.05], [0.004, -0.085], [-0.006, -0.07], [0.014, -0.02], [-0.013, -0.015], [0.002, 0.10], [0.012, 0.11], [-0.009, 0.10], [0.0, -0.11]];
  seeds.forEach((s, i) => { const p = buildPorin({ flow: false, spin: i * 0.7 }); place(p.group, heroSpots.porin[0] + s[0], heroSpots.porin[1] + s[1], 0); scene.add(p.group); });
}
const kch = buildKChannel();
kch.group.scale.set(1.15, 1.15, 1.25);
const kchFrame = place(kch.group, ...heroSpots.kch);
scene.add(kch.group);
const atp = buildATPSynthase();
const atpFrame = place(atp.group, ...heroSpots.atp, true);
scene.add(atp.group);

const medium = buildMedium();
scene.add(medium.group);

// ------------------------------------------------------------------ post-processing
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const composer = new EffectComposer(renderer);
const dof = new SceneDoFPass(scene, camera, size.x, size.y);
composer.addPass(dof);
composer.addPass(new OutputPass());
const smaa = new SMAAPass(size.x, size.y);
composer.addPass(smaa);
const vig = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 }, grain: { value: 0.006 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: vignetteFragGLSL,
});
composer.addPass(vig);

// ------------------------------------------------------------------ state & theme
const S = {
  speed: 1.0, dof: 0.55, opacity: 1, debris: true, tumble: false, cutaway: false, dark: false, paused: false,
  exposure: 1.0, focusFactor: 1, fimbriae: true,
};
function setTheme(dark) {
  S.dark = dark;
  const T = dark ? PAL.dark : PAL.light;
  renderer.setClearColor(T.fog, 1);
  bgMat.uniforms.top.value.set(dark ? 0x18222d : 0xf4f6f8);
  bgMat.uniforms.bottom.value.set(dark ? 0x070a0f : 0xd3dbe2);
  scene.fog = new THREE.Fog(T.fog, dark ? 5000 : 6000, dark ? 24000 : 34000);
  hemi.intensity = dark ? 0.15 : 0.3;
  key.intensity = dark ? 2.6 : 1.9; fill.intensity = dark ? 0.35 : 0.45; rim.intensity = dark ? 2.4 : 1.4;
  vig.uniforms.strength.value = dark ? 0.55 : 0.32;
  document.documentElement.classList.toggle('dark', dark);
}
setTheme(Q.get('dark') === '1');

// ------------------------------------------------------------------ controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.minDistance = 1.2; controls.maxDistance = 40000;
controls.zoomToCursor = true; controls.screenSpacePanning = true;

// shift + wheel: focal plane (Windows turns shift+wheel into deltaX)
stage.addEventListener('wheel', (e) => {
  if (!e.shiftKey) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const d = e.deltaY || e.deltaX;
  S.focusFactor = clamp(S.focusFactor * Math.exp(-d * 0.0012), 0.03, 30);
}, { capture: true, passive: false });

const keys = new Set();
const flyVel = new THREE.Vector3();
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
  if (nav.includes(e.code)) { keys.add(e.code); e.preventDefault(); return; }
  switch (e.code) {
    case 'Space': setPaused(!S.paused); e.preventDefault(); break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyP': togglePanel(); break;
    case 'KeyC': setCutaway(!S.cutaway); break;
    case 'KeyT': setTumble(!S.tumble); break;
    case 'KeyR': flyTo('overview'); break;
    case 'Digit1': flyTo('overview'); break;
    case 'Digit2': flyTo('motor'); break;
    case 'Digit3': flyTo('filament'); break;
    case 'Digit4': flyTo('porin'); break;
    case 'Digit5': flyTo('kchannel'); break;
    case 'Digit6': flyTo('atp'); break;
    case 'Digit7': flyTo('inside'); break;
    case 'Escape': closePanel(); break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('pointerdown', () => { renderer.domElement.focus(); closePanel(); });

function fly(dt) {
  const dist = camera.position.distanceTo(controls.target);
  const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const want = new THREE.Vector3();
  if (keys.has('ArrowUp') || keys.has('KeyW')) want.add(fwd);
  if (keys.has('ArrowDown') || keys.has('KeyS')) want.sub(fwd);
  if (keys.has('ArrowRight') || keys.has('KeyD')) want.add(right);
  if (keys.has('ArrowLeft') || keys.has('KeyA')) want.sub(right);
  if (keys.has('PageUp') || keys.has('KeyE')) want.add(up);
  if (keys.has('PageDown') || keys.has('KeyQ')) want.sub(up);
  if (want.lengthSq() > 0) want.normalize().multiplyScalar(dist * 0.9);
  const k = 1 - Math.exp(-dt * 5);
  flyVel.lerp(want, k);
  if (flyVel.lengthSq() > 1e-8) {
    const mv = flyVel.clone().multiplyScalar(dt);
    camera.position.add(mv); controls.target.add(mv);
  }
}

// double-click: move the pivot onto the object under the cursor
const raycaster = new THREE.Raycaster();
const pickables = [cell.layers.om.mf, ...flagella.map((f) => f.group), porin.group, kch.group, atp.group, medium.group];
let pivotTween = null;
renderer.domElement.addEventListener('dblclick', (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(nd, camera);
  raycaster.near = camera.near; raycaster.far = camera.far;
  const hits = raycaster.intersectObjects(pickables, true);
  if (!hits.length) return;
  pivotTween = { from: controls.target.clone(), to: hits[0].point.clone(), t: 0, dur: 0.7 };
  S.focusFactor = 1;
});

// ------------------------------------------------------------------ views
const views = {};
{
  const f0 = flagella[0].frame;
  views.overview = { pos: new THREE.Vector3(1250, 900, 4100), target: new THREE.Vector3(-650, 0, 0), plane: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), cut: false, dof: 0.32 };
  {
    const target = f0.p.clone().addScaledVector(f0.n, -20);
    const pos = target.clone().addScaledVector(f0.n, 50).addScaledVector(f0.b, 125).addScaledVector(f0.t, 25);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f0.b.clone().negate(), f0.p);
    views.motor = { pos, target, plane, cut: true, dof: 0.3 };
  }
  {
    const sp = flagella[0].spine[Math.floor(flagella[0].nS * 0.28)].clone();
    views.filament = { pos: sp.clone().add(new THREE.Vector3(120, 180, 520)), target: sp, plane: views.overview.plane, cut: false, dof: 0.4 };
  }
  {
    const f = porinFrame; const target = f.p.clone().addScaledVector(f.n, 1.5);
    views.porin = { pos: target.clone().addScaledVector(f.n, 12).addScaledVector(f.t, 9).addScaledVector(f.b, 4), target, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(f.b.clone().negate(), f.p), cut: false, dof: 0.25 };
  }
  {
    const f = kchFrame; const target = f.p.clone().addScaledVector(f.n, 0.8);
    views.kchannel = { pos: target.clone().addScaledVector(f.n, 7.5).addScaledVector(f.t, 6.5).addScaledVector(f.b, 2), target, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(f.b.clone().negate(), f.p), cut: false, dof: 0.25 };
  }
  {
    const f = atpFrame; const target = f.p.clone().addScaledVector(f.n, -8);
    views.atp = { pos: target.clone().addScaledVector(f.n, -9).addScaledVector(f.t, 28).addScaledVector(f.b, 12), target, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(f.b.clone().negate(), f.p), cut: false, dof: 0.25 };
  }
  views.inside = { pos: new THREE.Vector3(420, 70, 40), target: new THREE.Vector3(-700, 30, 0), plane: views.overview.plane, cut: false, dof: 0.35 };
}
function setDof(v) { S.dof = v; const el = document.getElementById('dof'); if (el) el.value = v; }
let curPlane = views.overview.plane;
let camTween = null;
function flyTo(name, dur = 2.6) {
  const v = views[name]; if (!v) return;
  camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos.clone(), t1: v.target.clone(), f0: S.focusFactor, t: 0, dur };
  curPlane = v.plane;
  setCutaway(v.cut);
  if (v.dof !== undefined) setDof(v.dof);
  flyVel.set(0, 0, 0);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}
function applyClip() {
  for (const m of ctx.clippables) m.clippingPlanes = S.cutaway ? [curPlane] : [];
}
function setCutaway(v) { S.cutaway = v; applyClip(); const el = document.getElementById('cutaway'); if (el) el.checked = v; }
function setTumble(v) { S.tumble = v; const el = document.getElementById('tumble'); if (el) el.checked = v; }
function setPaused(v) { S.paused = v; const el = document.getElementById('pause'); if (el) el.checked = v; }

// ------------------------------------------------------------------ panel
const panel = document.getElementById('panel');
const edge = document.getElementById('edge');
let closeTimer = null;
function openPanel() { clearTimeout(closeTimer); panel.classList.add('open'); }
function closePanel() { panel.classList.remove('open'); }
function togglePanel() { panel.classList.toggle('open'); }
edge.addEventListener('mouseenter', openPanel);
if (Q.get('panel') === '1') openPanel();
edge.addEventListener('click', openPanel);
panel.addEventListener('mouseleave', () => { closeTimer = setTimeout(closePanel, 500); });
panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));
const bind = (id, fn) => { const el = document.getElementById(id); if (!el) return; const h = () => fn(el.type === 'checkbox' ? el.checked : parseFloat(el.value)); el.addEventListener('input', h); el.addEventListener('change', h); };
bind('speed', (v) => { S.speed = v; });
bind('tumble', (v) => { S.tumble = v; });
bind('pause', (v) => { S.paused = v; });
bind('dof', (v) => { S.dof = v; });
bind('exposure', (v) => { S.exposure = v; renderer.toneMappingExposure = v; });
bind('dark', (v) => setTheme(v));
bind('opacity', (v) => { S.opacity = v; cell.setMembraneOpacity(v); });
bind('cutaway', (v) => setCutaway(v));
bind('debris', (v) => { S.debris = v; medium.group.visible = v; });
bind('fimbriae', (v) => { S.fimbriae = v; cell.fimbriae.visible = v; });
document.getElementById('focusReset')?.addEventListener('click', () => { S.focusFactor = 1; });
document.getElementById('fullscreen')?.addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.();
}

// ------------------------------------------------------------------ textbook figures
// The micro-textbooks illustrate themselves from this very scene, so a figure can never
// show something the model no longer does. A request snaps the camera to the view's own
// pose, renders one frame, reads the canvas back, and puts everything as it was - all
// inside a single animation frame, so nothing of it reaches the screen.
//
// The pose is exactly the stored view (no damping, no tween), which is what lets the K⁺
// annotation pins be placed once in percentage coordinates and stay put.
// Annotation pins are given as points in an object's own coordinates and projected through
// the capture camera, so a label can never drift off the part it names - if the model or the
// view pose is edited, the pins follow.
const anchorObjects = { kchannel: kch.group, porin: porin.group, atp: atp.group };

const figCache = new Map();
const figQueue = [];

function requestFigure(viewName, opts = {}, cb) {
  const k = viewName + '|' + JSON.stringify(opts);
  const hit = figCache.get(k);
  if (hit) { cb(hit.url, hit.pts); return; }
  figQueue.push({ k, viewName, opts, cb });
}

function projectAnchors(a) {
  const obj = a && anchorObjects[a.obj];
  if (!obj) return null;
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  return a.pts.map((p) => {
    v.set(p[0], p[1], p[2]).applyMatrix4(obj.matrixWorld).project(camera);
    return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100 };
  });
}

function downscale(src, w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round(w * src.height / src.width);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

function serveFigure() {
  const job = figQueue.shift();
  const v = views[job.viewName];
  if (!v) { job.cb(null); return; }
  const o = job.opts;

  // remember everything the capture is about to disturb
  const sPos = camera.position.clone(), sTgt = controls.target.clone();
  const sPlane = curPlane, sCut = S.cutaway, sDof = S.dof, sNear = camera.near, sFocus = focusCur;

  const dir = new THREE.Vector3().subVectors(v.pos, v.target);
  if (o.zoom) dir.multiplyScalar(o.zoom);
  if (o.yaw) dir.applyAxisAngle(camera.up, o.yaw);
  if (o.pitch) dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, camera.up).normalize(), o.pitch);
  camera.position.copy(v.target).add(dir);
  controls.target.copy(v.target);
  curPlane = v.plane;
  S.cutaway = o.cut !== undefined ? o.cut : v.cut; applyClip();

  const d = camera.position.distanceTo(controls.target);
  camera.near = clamp(d * 0.012, 0.04, 40);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  camera.updateMatrixWorld(true);

  S.dof = o.dof !== undefined ? o.dof : (v.dof !== undefined ? v.dof : 0.3);
  dof.uniforms.focus.value = d;
  dof.uniforms.dofWidth.value = 0.1 + 1.6 * Math.pow(1 - S.dof, 2);
  dof.uniforms.maxRadius.value = S.dof < 0.02 ? 0 : 18 * (size.y / 1080);

  composer.render();
  let url = null;
  try { url = downscale(renderer.domElement, o.w || 760); } catch (e) { url = null; }
  const pts = projectAnchors(o.anchors);   // same camera as the frame just captured

  // put it all back; the next frame re-derives focus and near from these
  camera.position.copy(sPos); controls.target.copy(sTgt);
  curPlane = sPlane; S.cutaway = sCut; applyClip();
  S.dof = sDof; focusCur = sFocus;
  camera.near = sNear; camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  if (url) figCache.set(job.k, { url, pts });
  job.cb(url, pts);
}

initPortal({
  requestFigure,
  onNavigate: (id) => flyTo(id),   // following a "related" link also moves the model
});

// ------------------------------------------------------------------ resize
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(size);
  composer.setSize(w, h); dof.setSize(size.x, size.y); smaa.setSize(size.x, size.y);
}
window.addEventListener('resize', onResize);

// ------------------------------------------------------------------ start position
{
  const startView = Q.get('view') || 'overview';
  const v = views[startView] || views.overview;
  if (Q.get('view')) { camera.position.copy(v.pos); controls.target.copy(v.target); curPlane = v.plane; setCutaway(v.cut); if (v.dof !== undefined) setDof(v.dof); }
  else { camera.position.copy(v.pos).multiplyScalar(1.9).add(new THREE.Vector3(0, 400, 0)); controls.target.copy(v.target); flyTo('overview', 4.5); }
  controls.update();
}
let simT = parseFloat(Q.get('t') || '0');
let tumbleBlend = 0;
let focusCur = camera.position.distanceTo(controls.target);
let last = performance.now() / 1000;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function frame() {
  const now = performance.now() / 1000;
  let dt = Math.min(0.05, now - last); last = now;
  if (!S.paused) simT += dt;

  // camera tweens
  if (camTween) {
    camTween.t += dt; const u = easeIO(clamp(camTween.t / camTween.dur, 0, 1));
    camera.position.lerpVectors(camTween.p0, camTween.p1, u);
    controls.target.lerpVectors(camTween.t0, camTween.t1, u);
    S.focusFactor = lerp(camTween.f0, 1, u);
    if (u >= 1) camTween = null;
  } else {
    fly(dt);
  }
  if (pivotTween) {
    pivotTween.t += dt; const u = easeIO(clamp(pivotTween.t / pivotTween.dur, 0, 1));
    controls.target.lerpVectors(pivotTween.from, pivotTween.to, u);
    if (u >= 1) pivotTween = null;
  }
  controls.update();

  // adaptive near plane
  const dist = camera.position.distanceTo(controls.target);
  const near = clamp(dist * 0.012, 0.04, 40);
  if (Math.abs(camera.near - near) / near > 0.05) { camera.near = near; camera.updateProjectionMatrix(); }

  // simulation
  const omega = TAU * S.speed;
  tumbleBlend += clamp((S.tumble ? 1 : 0) - tumbleBlend, -dt * 0.6, dt * 0.6);
  for (const f of flagella) f.update(simT, omega, tumbleBlend);
  M.hook.userData.u.uLatPhase.value = (-omega * simT / TAU) % 1;
  porin.update(simT);
  kch.update(simT, S.paused ? 0 : dt);
  atp.update(simT, omega * 0.45);
  if (S.debris && !S.paused) medium.update(dt, 260);

  // focus / depth of field
  const focusTarget = dist * S.focusFactor;
  focusCur += (focusTarget - focusCur) * (1 - Math.exp(-dt * 7));
  dof.uniforms.focus.value = focusCur;
  const w = 0.1 + 1.6 * Math.pow(1 - S.dof, 2);
  dof.uniforms.dofWidth.value = w;
  dof.uniforms.maxRadius.value = S.dof < 0.02 ? 0 : 18 * (size.y / 1080);
  vig.uniforms.time.value = simT;

  composer.render();
  // A pending textbook figure is rendered and read back here, then the frame is drawn
  // again from the restored camera, so the captured pose never reaches the screen.
  if (figQueue.length) { serveFigure(); controls.update(); composer.render(); }
  autoQuality(dt);
}

// If the machine cannot hold ~35 fps after warm-up, drop to a 1:1 pixel ratio once.
let qFrames = 0, qAccum = 0, qDone = false;
function autoQuality(dt) {
  if (qDone || performance.now() < 6000) return;
  qAccum += dt; qFrames++;
  if (qFrames < 90) return;
  const avg = qAccum / qFrames; qFrames = 0; qAccum = 0;
  if (avg > 0.029 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); onResize(); qDone = true; }
  else if (avg <= 0.029) qDone = true;
}
renderer.setAnimationLoop(frame);
