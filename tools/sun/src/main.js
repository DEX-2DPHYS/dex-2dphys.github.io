import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildSun, U } from './sun.js';
import { buildLoops, buildProminence, buildFieldLines, buildParkerSpiral, buildCME, buildRandomWalk } from './active.js';
import { buildWind, buildEarth, buildStars } from './wind.js';
import { interiorTip, surfaceTip, offDiscTip, OBJ } from './tips.js';
import { AR_N, PROM, dirLL, EARTH_X } from './spec.js';
import { initPortal } from './portal.js';
import { createSound } from './sound.js';

const Q = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ------------------------------------------------------------------ renderer / scene
// Scene unit: 1 = one solar radius (695 700 km). The Sun turns about +y.
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x000000, 1);   // the clear colour reaches the output sRGB-encoded: keep it truly black
renderer.domElement.tabIndex = 0;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.002, 3000);

scene.add(buildStars());
const sun = buildSun();
scene.add(sun.sunGroup, sun.cut.group, sun.corona, sun.flash);
const loops = buildLoops();
const prom = buildProminence();
const field = buildFieldLines();
const parker = buildParkerSpiral();
sun.sunGroup.add(loops.group, prom.group, field, parker);
const wind = buildWind();
scene.add(wind.points);
const earth = buildEarth();
scene.add(earth.group);
const cme = buildCME();
scene.add(cme.mesh);
const walk = buildRandomWalk();
scene.add(walk.line);

// ------------------------------------------------------------------ post-processing
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
if (Q.get("nobloom") === "1") bloom.enabled = false;   // test switches
if (Q.get("debug") === "1") window.__sun = { scene, renderer, composer, U };

// ------------------------------------------------------------------ state
const BASE_PERIOD = 90;   // seconds of screen time per solar rotation at speed 1
const S = {
  rot: 1, evolve: 1, paused: false, filter: 0, cut: false, tmap: false,
  corona: true, loops: true, prom: true, field: false, parker: true, wind: true, earth: true, tips: true,
  exposure: 1, bloom: 0.55, coronaK: 1, cmeEarth: false, corot: false,
  cycleYear: 6.9,   // cycle 25 began at the minimum of December 2019: October 2026 ≈ year 6.9
};
// the eight instruments of "The Sun, alive" (SunSim.html)
const FILTERS = ['White light', 'H-α 656.3 nm', 'He II 304 Å', 'Fe IX 171 Å', 'Fe XII 193 Å', 'Magnetogram B∥', 'Dopplergram v∥', 'Total eclipse'];
const FILTER_NOTE = ['photosphere, 5 772 K', 'chromosphere, ≈ 10⁴ K', 'chromosphere / transition region, ≈ 5 × 10⁴ K',
  'quiet corona, ≈ 0.7 MK', 'corona, ≈ 1.5 MK', 'line-of-sight field (Zeeman effect)', 'line-of-sight velocity (Doppler shift)', 'K-corona, Moon covers the disc'];
let sunAngle = 0;
const omega = () => (S.paused ? 0 : (2 * Math.PI / BASE_PERIOD) * S.rot);

// ------------------------------------------------------------------ controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.minDistance = 0.02; controls.maxDistance = 400;
controls.zoomToCursor = true; controls.screenSpacePanning = true;

const keys = new Set();
const flyVel = new THREE.Vector3();
const VIEW_KEYS = ['overview', 'interior', 'core', 'convection', 'photosphere', 'sunspots', 'corona', 'wind'];
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (portal.isOpen()) return;
  const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
  if (nav.includes(e.code)) { keys.add(e.code); e.preventDefault(); return; }
  const dg = /^Digit([1-8])$/.exec(e.code);
  if (dg) { flyTo(VIEW_KEYS[+dg[1] - 1]); return; }
  switch (e.code) {
    case 'Space': set('paused', !S.paused); e.preventDefault(); break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyP': togglePanel(); break;
    case 'KeyC': set('cut', !S.cut); break;
    case 'KeyM': set('tmap', !S.tmap); break;
    case 'KeyV': setFilter((S.filter + (e.shiftKey ? 7 : 1)) % 8); break;
    case 'KeyL': toggleSound(); break;
    case 'KeyG': set('field', !S.field); break;
    case 'KeyT': set('tips', !S.tips); break;
    case 'KeyX': launchCME(); break;
    case 'KeyB': portal.open(currentView || 'overview'); break;
    case 'KeyR': flyTo('overview'); break;
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
  flyVel.lerp(want, 1 - Math.exp(-dt * 5));
  if (flyVel.lengthSq() > 1e-10) {
    const mv = flyVel.clone().multiplyScalar(dt);
    camera.position.add(mv); controls.target.add(mv);
  }
}

// ------------------------------------------------------------------ views
// frame 'world': fixed in space. frame 'sun': given in the Sun's own coordinates, so the camera
// turns with the Sun and the feature it looks at stays in the picture.
const views = {};
{
  views.overview = { frame: 'world', pos: [1.5, 1.25, 5.6], target: [0, 0, 0], cut: false };
  views.interior = { frame: 'world', pos: [1.55, 1.45, 2.95], target: [0.12, -0.02, 0.1], cut: true, bloom: 0.4 };
  views.core = { frame: 'world', pos: [0.62, 0.5, 1.45], target: [0.12, 0.0, 0.06], cut: true, bloom: 0.25 };
  views.convection = { frame: 'world', pos: [1.3, 0.55, 1.4], target: [0.72, 0.12, 0.04], cut: true, bloom: 0.35 };

  const tangentN = (d) => new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();   // towards north
  {
    const s = V3(dirLL(4, -38));
    const t = tangentN(s);
    views.photosphere = { frame: 'sun', pos: s.clone().multiplyScalar(1.06).addScaledVector(t, -0.13).toArray(), target: s.toArray(), cut: false, bloom: 0.35 };
  }
  {
    const a = V3(dirLL(AR_N.lat, AR_N.lon));
    const t = tangentN(a);
    views.sunspots = { frame: 'sun', pos: a.clone().multiplyScalar(1.2).addScaledVector(t, -0.12).toArray(), target: a.clone().multiplyScalar(1.01).toArray(), cut: false, bloom: 0.4 };
  }
  {
    const p = V3(dirLL(PROM.lat, PROM.lon));
    const c = new THREE.Vector3().crossVectors(p, new THREE.Vector3(0, 1, 0)).normalize();
    views.corona = { frame: 'sun', pos: p.clone().multiplyScalar(1.0).addScaledVector(c, -1.25).add(new THREE.Vector3(0, 0.12, 0)).toArray(), target: p.clone().multiplyScalar(1.0).toArray(), cut: false, bloom: 0.4 };
  }
  views.wind = { frame: 'world', pos: [6, 25, 25], target: [10.5, -1, 0], cut: false };
}
const VIEW_NAMES = { overview: 'The whole Sun', interior: 'Interior cutaway', core: 'The core', convection: 'Convection zone', photosphere: 'Photosphere close-up', sunspots: 'Active region', corona: 'Corona & prominence', wind: 'Solar wind & Earth' };

function viewPose(v) {
  const p = V3(v.pos), t = V3(v.target);
  if (v.frame === 'sun') { sun.sunGroup.updateMatrixWorld(true); p.applyMatrix4(sun.sunGroup.matrixWorld); t.applyMatrix4(sun.sunGroup.matrixWorld); }
  return { p, t };
}

let camTween = null, currentView = null;
function flyTo(name, dur = 2.6) {
  const v = views[name]; if (!v) return;
  currentView = name;
  camTween = { p0: camera.position.clone(), t0: controls.target.clone(), v, t: 0, dur };
  S.corot = false;
  set('cut', v.cut);
  bloom.strength = S.bloom * (v.bloom !== undefined ? v.bloom : 0.55) / 0.55;
  flyVel.set(0, 0, 0);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  hud();
}

// ------------------------------------------------------------------ settings
const setters = {
  cut: (v) => { U.uCut.value = v ? 1 : 0; walk.line.visible = v; },
  tmap: (v) => { U.uTmap.value = v ? 1 : 0; },
  corona: (v) => { sun.corona.visible = v; },
  loops: (v) => { loops.group.visible = v; },
  prom: (v) => { prom.group.visible = v; },
  field: (v) => { field.visible = v; },
  parker: (v) => { parker.visible = v; },
  wind: (v) => { wind.points.visible = v; },
  earth: (v) => { earth.group.visible = v; },
  tips: (v) => { if (!v) hideTip(); },
};
function set(k, v) {
  S[k] = v;
  setters[k]?.(v);
  const el = document.getElementById(k);
  if (el && el.type === 'checkbox') el.checked = !!v;
  hud();
}
// White light is a physical brightness and goes through filmic tone mapping; the other
// instruments are false-colour maps (filtergram ramps, ±B, ±v) and are shown as they are.
function applyToneMapping(f) {
  renderer.toneMapping = f === 0 ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
}
function setFilter(f) {
  S.filter = f; U.uFilter.value = f;
  applyToneMapping(f);
  document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('on', +b.dataset.filter === f));
  hud();
}

// ------------------------------------------------------------------ solar cycle
// Activity rises fast and decays slowly; spots emerge at lower latitudes as it goes (Spörer);
// the polar field reverses shortly before maximum. Same model as "The Sun, alive".
function setCycleUniforms(y) {
  const x = clamp(y / 11, 0, 1);
  const act = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.75)), 2);
  U.uAct.value = act;
  U.uPolarN.value = Math.cos(Math.PI * x / 0.9);
  // the fixed active regions of the model stand for the cycle's spots: they fade out at minimum
  U.uSpotVis.value = clamp((act - 0.03) / 0.25, 0, 1);
  return { x, act };
}
function setCycle(y) {
  S.cycleYear = y;
  const { x, act } = setCycleUniforms(y);
  S.act = act;
  S.phase = x < 0.08 ? 'minimum' : x < 0.33 ? 'rising' : x < 0.55 ? 'maximum' : x < 0.9 ? 'declining' : 'minimum';
  const el = document.getElementById('cycle'); if (el && +el.value !== y) el.value = y;
  const o = document.getElementById('cycleO'); if (o) o.textContent = `year ${y.toFixed(1)} · ${S.phase}`;
  hud();
}

// ------------------------------------------------------------------ sound
const sound = createSound();
const specEl = document.getElementById('spec');
function toggleSound() {
  if (sound.isOn()) { sound.stop(); hudMsg('Sound off'); }
  else if (sound.start()) hudMsg('Listening: the 5-minute p modes, sped up 100 000×');
  document.getElementById('soundBtn')?.classList.toggle('on', sound.isOn());
  specEl?.classList.toggle('on', sound.isOn());
}
for (const k of Object.keys(setters)) setters[k](S[k]);

// ------------------------------------------------------------------ panel
const panel = document.getElementById('panel');
const edge = document.getElementById('edge');
let closeTimer = null;
function openPanel() { clearTimeout(closeTimer); panel.classList.add('open'); }
function closePanel() { panel.classList.remove('open'); }
function togglePanel() { panel.classList.toggle('open'); }
edge.addEventListener('mouseenter', openPanel);
edge.addEventListener('click', openPanel);
if (Q.get('panel') === '1') openPanel();
panel.addEventListener('mouseleave', () => { closeTimer = setTimeout(closePanel, 500); });
panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));
document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => setFilter(+b.dataset.filter)));
const bind = (id, fn) => { const el = document.getElementById(id); if (!el) return; const h = () => fn(el.type === 'checkbox' ? el.checked : parseFloat(el.value)); el.addEventListener('input', h); el.addEventListener('change', h); };
for (const k of ['paused', 'cut', 'tmap', 'corona', 'loops', 'prom', 'field', 'parker', 'wind', 'earth', 'tips', 'cmeEarth']) {
  const el = document.getElementById(k); if (el) el.checked = !!S[k];
  bind(k, (v) => set(k, v));
}
bind('rot', (v) => { S.rot = v; hud(); });
bind('evolve', (v) => { S.evolve = v; });
bind('exposure', (v) => { S.exposure = v; renderer.toneMappingExposure = v; });
bind('bloom', (v) => { S.bloom = v; const b = views[currentView]?.bloom; bloom.strength = v * (b !== undefined ? b / 0.55 : 1); });
bind('coronaK', (v) => { S.coronaK = v; });
bind('gran', (v) => { U.uGran.value = v; });
bind('darkdoc', (v) => document.documentElement.classList.toggle('dark', v));
bind('cycle', (v) => setCycle(v));
document.getElementById('soundBtn')?.addEventListener('click', toggleSound);
document.getElementById('cmeBtn')?.addEventListener('click', () => launchCME());
document.getElementById('fullscreen')?.addEventListener('click', toggleFullscreen);
document.getElementById('bookContents')?.addEventListener('click', () => portal.open('contents'));
document.getElementById('bookData')?.addEventListener('click', () => portal.open('datasheet'));
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.();
}

// ------------------------------------------------------------------ HUD (data screen)
const hudEl = document.getElementById('hud');
function hud() {
  if (!hudEl) return;
  const lapse = S.paused || S.rot === 0 ? 'paused' : `1 rotation per ${(BASE_PERIOD / S.rot).toFixed(0)} s · ≈ ${Math.round(25.38 * 86400 / (BASE_PERIOD / S.rot) / 1000).toLocaleString('en-US')} 000× real time`;
  hudEl.innerHTML = `<div class="hud-t">The Sun <span>G2 V · 4.57 Gyr</span></div>
    <div class="hud-r"><span>View</span><b>${VIEW_NAMES[currentView] || 'free'}</b></div>
    <div class="hud-r"><span>Filter</span><b>${FILTERS[S.filter]} <i>· ${FILTER_NOTE[S.filter]}</i></b></div>
    <div class="hud-r"><span>Cycle 25</span><b>year ${(S.cycleYear ?? 6.9).toFixed(1)} · ${S.phase || ''} · activity ${Math.round((S.act ?? 0) * 100)} %</b></div>
    <div class="hud-r"><span>Rotation</span><b>${lapse}</b></div>
    ${S.cut ? `<div class="hud-r"><span>Cut faces</span><b>${S.tmap ? 'temperature map (log T)' : 'illustrative colours'}</b></div>` : ''}
    ${currentView === 'wind' ? '<div class="hud-r"><span>Scale</span><b>distances compressed beyond 3 R☉; Earth enlarged</b></div>' : ''}
    <div class="hud-msg" id="hudMsg"></div>`;
}
let msgTimer = 0;
function hudMsg(s) {
  const el = document.getElementById('hudMsg'); if (!el) return;
  el.textContent = s; el.classList.add('on');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.remove('on'), 5000);
}

// ------------------------------------------------------------------ flare + CME
let cmeState = null, auroraBoost = 0;
function launchCME() {
  sun.sunGroup.updateMatrixWorld(true);
  const dir = S.cmeEarth ? new THREE.Vector3(1, 0, 0) : V3(dirLL(AR_N.lat, AR_N.lon)).applyMatrix4(sun.sunGroup.matrixWorld).normalize();
  cmeState = { dir, t: 0, hit: false };
  U.uFlare.value = 1;
  sun.flash.position.copy(dir).multiplyScalar(1.03);
  cme.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  cme.mesh.visible = true;
  hudMsg(S.cmeEarth ? 'Flare and Earth-directed CME launched' : 'Flare in the active region; CME launched');
}
function updateCME(dt) {
  U.uFlare.value *= Math.exp(-dt / 1.4);
  sun.flash.material.uniforms.uI.value = U.uFlare.value * 2.2;
  sun.flash.scale.setScalar(0.18 + 0.25 * (1 - U.uFlare.value));
  auroraBoost *= Math.exp(-dt / 5);
  earth.auroraU.value = 0.12 + auroraBoost;
  earth.bowU.value = 0.35 + auroraBoost * 0.8;
  if (!cmeState) return;
  cmeState.t += dt;
  const t = cmeState.t;
  const d = 1.05 + 3.0 * t;
  const rad = 0.06 + 0.42 * (d - 1.05);
  cme.mesh.position.copy(cmeState.dir).multiplyScalar(d + rad * 0.2);
  cme.mesh.scale.setScalar(rad);
  cme.mat.uniforms.uI.value = 1.3 * Math.min(1, t / 0.5) * (1 - clamp((d - 26) / 12, 0, 1)) / (1 + 0.04 * d);
  if (!cmeState.hit && d > EARTH_X - rad * 0.4 && cmeState.dir.angleTo(new THREE.Vector3(1, 0, 0)) < 0.55) {
    cmeState.hit = true; auroraBoost = 1.2;
    hudMsg('CME arrives at Earth: geomagnetic storm, bright aurorae');
  }
  if (d > 38) { cmeState = null; cme.mesh.visible = false; }
}

// ------------------------------------------------------------------ billboards
const _r = new THREE.Vector3(), _u = new THREE.Vector3();
function updateBillboards() {
  camera.updateMatrixWorld(true);
  sun.corona.quaternion.copy(camera.quaternion);
  sun.flash.quaternion.copy(camera.quaternion);
  const sc = 8;
  sun.corona.scale.setScalar(sc);
  const cu = sun.corona.material.uniforms;
  cu.uScale.value = sc;
  // the corona boost suits a distant view; from close to the surface it would read as fog
  cu.uK.value = S.coronaK * (0.12 + 0.88 * clamp((camera.position.length() - 1.15) / 1.6, 0, 1));
  _r.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
  const ax = new THREE.Vector2(_r.y, _u.y);   // the solar axis is world +y
  const len = ax.length();
  cu.uAxisLen.value = clamp(len * 1.5, 0, 1);
  if (len > 1e-4) cu.uAxis.value.copy(ax.divideScalar(len));
}

// ------------------------------------------------------------------ hover read-outs
const tipEl = document.getElementById('tip');
const pointer = { x: 0, y: 0, inside: false, down: false };
renderer.domElement.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; });
renderer.domElement.addEventListener('pointerleave', () => { pointer.inside = false; hideTip(); });
renderer.domElement.addEventListener('pointerdown', () => { pointer.down = true; hideTip(); });
window.addEventListener('pointerup', () => { pointer.down = false; });
function hideTip() { tipEl?.classList.remove('on'); }

const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.008;
const _nd = new THREE.Vector2();
let tipKey = '';
function pickAt(x, y) {
  _nd.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(_nd, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;

  // the Sun, analytically: sphere, minus the cut-away quadrant, plus the two cut faces
  let sunT = Infinity, sunHTML = null, sunKey = '';
  const b = o.dot(d), c = o.lengthSq() - 1, disc = b * b - c;
  if (disc > 0) {
    const t0 = -b - Math.sqrt(disc);
    if (t0 > 0) {
      const p = o.clone().addScaledVector(d, t0);
      if (!(S.cut && p.x > 0 && p.z > 0)) {
        sunT = t0;
        const local = sun.sunGroup.worldToLocal(p.clone()).normalize();
        const mu = clamp(-p.clone().normalize().dot(d), 0, 1);
        // rotational line-of-sight velocity (km/s, + = away) for the Dopplergram read-out
        const nw = p.clone().normalize(), s2 = local.y * local.y;
        const om = (14.713 - 2.396 * s2 - 1.787 * s2 * s2) / 14.713;
        const vlos = om * 2 * (nw.z * d.x - nw.x * d.z);
        sunHTML = surfaceTip(local, mu, { filter: S.filter, spotVis: U.uSpotVis.value, vlos, polarN: U.uPolarN.value, act: S.act });
        sunKey = 's' + local.x.toFixed(3) + local.y.toFixed(3);
      } else {
        for (const [ax, other, sign] of [['x', 'z', 1], ['z', 'x', 1]]) {
          if (Math.abs(d[ax]) < 1e-6) continue;
          const t = -o[ax] / d[ax];
          if (t <= 0 || t >= sunT) continue;
          const q = o.clone().addScaledVector(d, t);
          if (q[other] * sign >= 0 && q.length() <= 1) { sunT = t; sunHTML = interiorTip(q.length()); sunKey = 'i' + q.length().toFixed(3); }
        }
      }
    }
  }
  // objects in front of the Sun
  const objs = [];
  if (S.loops) objs.push(loops.group);
  if (S.prom) objs.push(prom.group);
  if (S.earth) objs.push(earth.earth, earth.bow);
  if (cme.mesh.visible) objs.push(cme.mesh);
  if (S.cut) objs.push(walk.line);
  const hits = raycaster.intersectObjects(objs, true).filter((h) => !(S.cut && h.point.x > 0 && h.point.z > 0 && h.point.length() < 1.3));
  if (hits.length && hits[0].distance < sunT) {
    // the bow shock is a thin shell around Earth's sunward side; Earth itself wins
    const h = hits.find((x) => x.object === earth.earth) || hits[0];
    const ob = h.object;
    const kind = ob === earth.earth ? 'earth' : ob === earth.bow ? 'bow' : ob === cme.mesh ? 'cme' : ob === walk.line ? 'walk' : prom.group.children.includes(ob) ? 'prom' : 'loop';
    return { html: OBJ[kind](), key: kind };
  }
  if (sunHTML) return { html: sunHTML, key: sunKey };
  // off the disc: where the line of sight passes closest to the Sun
  const tc = Math.max(0, -b);
  const pc = Math.sqrt(Math.max(0, o.lengthSq() - tc * tc));
  if (pc < 1) return null;   // looked through the cutaway and out the far side
  const windView = currentView === 'wind';
  if (pc < (windView ? 40 : 8)) return { html: offDiscTip(pc, S.filter, windView), key: 'o' + pc.toFixed(3) };
  return null;
}
function updateTip() {
  if (!tipEl || !S.tips || !pointer.inside || pointer.down || portal.isOpen()) { hideTip(); return; }
  const r = pickAt(pointer.x, pointer.y);
  if (!r) { hideTip(); return; }
  if (r.key !== tipKey) { tipEl.innerHTML = r.html; tipKey = r.key; }
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = pointer.x + 18, y = pointer.y + 16;
  if (x + w > innerWidth - 8) x = pointer.x - w - 18;
  if (y + h > innerHeight - 8) y = innerHeight - h - 8;
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  tipEl.classList.add('on');
}

// ------------------------------------------------------------------ textbook figures
// As in the salmonella model: a figure request snaps the camera to the view's own pose,
// renders one frame, reads it back and restores everything inside one animation frame.
const anchorObjects = { world: null, sun: sun.sunGroup };
const figCache = new Map();
const figQueue = [];
function requestFigure(viewName, opts = {}, cb) {
  const k = viewName + '|' + JSON.stringify(opts);
  const hit = figCache.get(k);
  if (hit) { cb(hit.url, hit.pts); return; }
  figQueue.push({ k, viewName, opts, cb });
}
function projectAnchors(a) {
  if (!a) return null;
  const obj = anchorObjects[a.obj];
  if (obj) obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  return a.pts.map((p) => {
    v.set(p[0], p[1], p[2]);
    if (obj) v.applyMatrix4(obj.matrixWorld);
    v.project(camera);
    return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100 };
  });
}
function downscale(src, w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round(w * src.height / src.width);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}
function serveFigure() {
  const job = figQueue.shift();
  const v = views[job.viewName];
  if (!v) { job.cb(null); return; }
  const o = job.opts;
  const keep = { pos: camera.position.clone(), tgt: controls.target.clone(), cut: S.cut, tmap: S.tmap, filter: S.filter, bloom: bloom.strength, near: camera.near, field: S.field };
  const { p, t } = viewPose(v);
  const dir = new THREE.Vector3().subVectors(p, t);
  if (o.zoom) dir.multiplyScalar(o.zoom);
  if (o.yaw) dir.applyAxisAngle(camera.up, o.yaw);
  camera.position.copy(t).add(dir); controls.target.copy(t);
  setters.cut(o.cut !== undefined ? o.cut : v.cut);
  U.uTmap.value = o.tmap ? 1 : 0;
  U.uFilter.value = o.filter !== undefined ? o.filter : 0;
  applyToneMapping(U.uFilter.value);
  const keepCycle = S.cycleYear;
  if (o.cycle !== undefined) setCycleUniforms(o.cycle);
  if (o.field !== undefined) field.visible = o.field;
  bloom.strength = 0.55 * (v.bloom !== undefined ? v.bloom / 0.55 : 1);
  camera.near = clamp(dir.length() * 0.01, 0.002, 1);
  camera.updateProjectionMatrix();
  camera.lookAt(t);
  updateBillboards();
  composer.render();
  let url = null;
  try { url = downscale(renderer.domElement, o.w || 760); } catch (e) { url = null; }
  const pts = projectAnchors(o.anchors);

  camera.position.copy(keep.pos); controls.target.copy(keep.tgt);
  setters.cut(keep.cut); U.uTmap.value = keep.tmap ? 1 : 0; U.uFilter.value = keep.filter;
  field.visible = keep.field; bloom.strength = keep.bloom;
  applyToneMapping(keep.filter);
  if (o.cycle !== undefined) setCycleUniforms(keepCycle);
  camera.near = keep.near; camera.updateProjectionMatrix();
  camera.lookAt(controls.target); camera.updateMatrixWorld(true);
  if (url) figCache.set(job.k, { url, pts });
  job.cb(url, pts);
}

const portal = initPortal({
  requestFigure,
  onNavigate: (id) => { if (views[id]) flyTo(id); },
});

// ------------------------------------------------------------------ resize
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(size);
  composer.setSize(w, h); bloom.setSize(size.x, size.y);
}
window.addEventListener('resize', onResize);

// ------------------------------------------------------------------ start
setCycle(Q.get('cycle') ? +Q.get('cycle') : S.cycleYear);
if (Q.get('filter')) setFilter(+Q.get('filter'));
if (Q.get('tmap') === '1') set('tmap', true);
if (Q.get('field') === '1') set('field', true);
sunAngle = parseFloat(Q.get('rot0') || '-1.05');
sun.sunGroup.rotation.y = sunAngle;
{
  const start = Q.get('view');
  if (start && views[start]) {
    const v = views[start];
    const { p, t } = viewPose(v);
    camera.position.copy(p); controls.target.copy(t);
    currentView = start; set('cut', v.cut); S.corot = v.frame === 'sun';
    if (v.bloom !== undefined) bloom.strength = v.bloom;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === start));
  } else {
    camera.position.set(4, 3.2, 14); controls.target.set(0, 0, 0);
    flyTo('overview', 4.5);
  }
  if (Q.get('cut') === '1') set('cut', true);
  controls.update();
}
hud();
if (Q.get('open')) setTimeout(() => portal.open(Q.get('open')), 300);
if (Q.get('cme') === '1') setTimeout(launchCME, 200);

let simT = parseFloat(Q.get('t') || '0');
let last = performance.now() / 1000;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _yq = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);

function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last); last = now;
  if (!S.paused) simT += dt * S.evolve;
  U.uTime.value = simT;

  // the Sun turns; a camera in a 'sun' view turns with it
  const dA = omega() * dt;
  sunAngle += dA;
  sun.sunGroup.rotation.y = sunAngle;
  if (S.corot && !camTween && dA) {
    _yq.setFromAxisAngle(_Y, dA);
    camera.position.applyQuaternion(_yq); controls.target.applyQuaternion(_yq);
  }

  if (camTween) {
    camTween.t += dt;
    const u = easeIO(clamp(camTween.t / camTween.dur, 0, 1));
    const { p, t } = viewPose(camTween.v);
    camera.position.lerpVectors(camTween.p0, p, u);
    controls.target.lerpVectors(camTween.t0, t, u);
    if (u >= 1) { S.corot = camTween.v.frame === 'sun'; camTween = null; }
  } else {
    fly(dt);
  }
  controls.update();

  // near plane follows the distance to the nearest surface
  const dSurf = Math.max(0.002, camera.position.length() - 1.02);
  const near = clamp(Math.min(dSurf, camera.position.distanceTo(controls.target)) * 0.25, 0.0015, 1);
  if (Math.abs(camera.near - near) / near > 0.05) { camera.near = near; camera.updateProjectionMatrix(); }

  if (S.cut && !S.paused) walk.update(dt * S.evolve);
  // wind particles only make sense from a distance; near the surface they are clutter in the sky
  wind.mat.uniforms.uOpacity.value = clamp((camera.position.length() - 6.5) / 12, 0, 1);
  if (S.wind) { wind.update(S.paused ? 0 : dt, sunAngle, omega() || 1e-9); wind.mat.uniforms.uPx.value = renderer.getPixelRatio() * innerHeight / 1000; }
  updateCME(S.paused ? 0 : dt);
  updateBillboards();
  updateTip();
  sound.tick(dt);
  if (sound.isOn() && specEl) sound.draw(specEl);

  composer.render();
  if (figQueue.length) { serveFigure(); controls.update(); updateBillboards(); composer.render(); }
}
renderer.setAnimationLoop(frame);
