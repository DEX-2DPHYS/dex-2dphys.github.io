// MD Lab VR - build and run a Lennard-Jones molecular-dynamics simulation in WebXR
// (Meta Quest browser, or a Quest on a PC through SteamVR/OpenXR) - or on the desktop with mouse.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MD, ELEMENTS, units, MAXN, clamp } from './physics.js';
import { UI, COL } from './ui.js';
import { drawPlots, PW, PH } from './plots.js';
import { TASKS, VR_HELP } from './content.js';

/* ================================================================== state */
const md = new MD(MAXN);
const B = { el: 'Ar', cells: 4, start: 'fcc', rho: 1.0, T0: 30 };           // build recipe shown on the BUILD tab
const S = {
  el: 'Ar', TsetK: 30, thermo: true, paused: false, dt: 0.004, speed: 10, periodic: true,
  color: 'speed', tool: 'tweezers', trail: true, tag: 0, tab: 0, taskPage: 0, helpPage: 0,
  rows: [], msg: '', msgUntil: 0, D: null, vr: false, xr: null, sps: 0, lastBuild: null, plots: true, panel: true,
};
let U = units(S.el);
const now = () => performance.now();
const toast = (m, ms = 4000) => { S.msg = m; S.msgUntil = now() + ms; };

/* ================================================================== renderer / scene */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
renderer.domElement.id = 'gl';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b13);
scene.fog = new THREE.Fog(0x070b13, 6, 16);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.03, 60);
camera.position.set(0.9, 1.65, 0.55);

scene.add(new THREE.HemisphereLight(0xaec6ff, 0x1a2234, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(1.5, 4, 2); scene.add(sun);
const rim = new THREE.PointLight(0x4ae3e1, 6, 4); rim.position.set(0, 1.9, -1.0); scene.add(rim);

/* ---------- the lab room ---------- */
const bench = new THREE.Group(); scene.add(bench);
{
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshLambertMaterial({ color: 0x0c121d }));
  floor.rotation.x = -Math.PI / 2; bench.add(floor);
  const grid = new THREE.GridHelper(14, 28, 0x20314f, 0x131d31); grid.position.y = 0.002; bench.add(grid);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 1.0), new THREE.MeshLambertMaterial({ color: 0x1c2640 }));
  top.position.set(0, 0.9, -1.0); bench.add(top);
  const legM = new THREE.MeshLambertMaterial({ color: 0x141b2e });
  for (const sx of [-0.92, 0.92]) for (const sz of [-1.42, -0.58]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), legM); leg.position.set(sx, 0.45, sz); bench.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.008, 8, 96), new THREE.MeshBasicMaterial({ color: 0x4ae3e1 }));
  ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.935, -1.0); bench.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.34, 64), new THREE.MeshBasicMaterial({ color: 0x4ae3e1, transparent: true, opacity: 0.07 }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(0, 0.934, -1.0); bench.add(disc);
  // back wall with title
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const g = cv.getContext('2d'); g.fillStyle = '#0a1120'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#4ae3e1'; g.font = '700 84px system-ui,sans-serif'; g.textBaseline = 'middle'; g.fillText('MD LAB', 40, 100);
  g.fillStyle = '#9fb2cf'; g.font = '34px system-ui,sans-serif'; g.fillText('Molecular dynamics in virtual reality  ·  DEX · 2DPHYS · DTU', 44, 190);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex }));
  wall.position.set(0, 2.1, -3.2); bench.add(wall);
}

/* ---------- simulation objects ---------- */
const simRoot = new THREE.Group(); scene.add(simRoot);           // placed in the world, scaled: world metres per sigma
const inner = new THREE.Group(); simRoot.add(inner);             // box coordinates [0,L]^3 -> centred
const SIM_HOME = new THREE.Vector3(0, 1.33, -1.0);               // in bench coordinates
simRoot.position.copy(SIM_HOME);
let userScale = 1, wps = 0.1;                                     // wps = metres per sigma at build time

const sphereLo = new THREE.SphereGeometry(1, 12, 9);
const atomMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 70, specular: 0x556677 });
const atoms = new THREE.InstancedMesh(sphereLo, atomMat, MAXN);
atoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
atoms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 3), 3); atoms.instanceColor.setUsage(THREE.DynamicDrawUsage);
atoms.frustumCulled = false; atoms.count = 0;
{ const a = atoms.instanceMatrix.array; for (let i = 0; i < MAXN; i++) { a[16 * i] = a[16 * i + 5] = a[16 * i + 10] = a[16 * i + 15] = 1; } }
inner.add(atoms);

const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x4ae3e1, transparent: true, opacity: 0.55 }));
const boxFaces = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4ae3e1, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false }));
inner.add(boxEdges); inner.add(boxFaces);

const TRAIL_MAX = 900;
const trailGeo = new THREE.BufferGeometry(); const trailPos = new Float32Array(TRAIL_MAX * 3);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffd36b })); trail.frustumCulled = false; inner.add(trail);
let trailN = 0; const trailAcc = new THREE.Vector3(), trailLast = new THREE.Vector3();

const tweezLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff })); tweezLine.visible = false; tweezLine.frustumCulled = false; inner.add(tweezLine);
const tweezDot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })); tweezDot.visible = false; inner.add(tweezDot);

/* ================================================================== building the system */
function retag() {
  S.tag = md.N ? Math.floor(Math.random() * md.N) : -1; trailN = 0; trailGeo.setDrawRange(0, 0);
  if (S.tag >= 0) { trailLast.set(md.x[S.tag], md.y[S.tag], md.z[S.tag]); trailAcc.copy(trailLast); }
}

const H = { t: [], T: [], ke: [], pe: [], e: [], P: [], mt: [], my: [], pt: [], py: [], lastStep: 0, markStep: 0 };
function resetHistory() { for (const k of ['t', 'T', 'ke', 'pe', 'e', 'P', 'mt', 'my', 'pt', 'py']) H[k].length = 0; H.lastStep = md.step; S.D = null; }

function build(recipe, opts = {}) {
  S.el = recipe.el; U = units(S.el);
  md.periodic = S.periodic; md.dt = S.dt;
  const Ts = U.Tstar(recipe.T0);
  try {
    if (recipe.start === 'fcc') md.buildFCC(recipe.cells, recipe.rho, Ts); else md.buildGas(4 * recipe.cells ** 3, recipe.rho, Ts);
  } catch (e) { toast(String(e.message || e)); return; }
  md.thermostat = S.thermo; md.Ttarget = U.Tstar(S.TsetK);
  wps = clamp(0.5 / md.L, 0.03, 0.12);
  S.paused = false; S.lastBuild = Object.assign({}, recipe);
  resetHistory(); retag();
  atoms.material.color.set(0xffffff);
  if (!opts.quiet) toast(`Built ${md.N} ${ELEMENTS[S.el].name.toLowerCase()} atoms in a ${U.nm(md.L).toFixed(2)} nm box`);
}

function equilibrate(steps, TsetK) {
  const th = md.thermostat; md.thermostat = true; md.Ttarget = U.Tstar(TsetK);
  md.run(steps); md.thermostat = th;
}

function addRandom(k) {
  let ok = 0;
  for (let i = 0; i < k; i++) if (md.addAtom(Math.random() * md.L, Math.random() * md.L, Math.random() * md.L) >= 0) ok++;
  if (ok < k) toast(ok ? `Only room for ${ok} more atoms` : 'The box is full - expand it first');
  if (S.tag < 0 && md.N) retag();
  H.my.length = 0; H.mt.length = 0; md.mark();
}
function removeAtomAt(i) {
  const last = md.N - 1; md.removeAtom(i);
  if (S.tag === i) retag(); else if (S.tag === last) S.tag = i;
}
function removeRandom(k) { for (let i = 0; i < k && md.N > 2; i++) removeAtomAt(Math.floor(Math.random() * md.N)); }

function applyTask(t) {
  Object.assign(B, t.setup.build);
  S.TsetK = t.setup.TsetK; S.thermo = true; S.dt = t.setup.dt || 0.004; S.periodic = t.setup.periodic !== false;
  S.color = t.setup.color || 'speed'; S.speed = t.setup.speed || 10;
  build(B, { quiet: true });
  if (t.setup.equil) for (const [steps, K] of t.setup.equil) equilibrate(steps, K);
  if (t.setup.thermo === false) S.thermo = false;
  S.paused = false; resetHistory(); md.mark(); md.resetRDF();
  toast('Loaded: ' + t.title);
}

/* ================================================================== sampling / analysis */
function sample() {
  const N = md.N; if (!N) return;
  const ke = U.eV(md.KE / N) * 1000, pe = U.eV(md.PE / N) * 1000;
  H.t.push(U.ps(md.time)); H.T.push(U.K(md.temperature())); H.ke.push(ke); H.pe.push(pe); H.e.push(ke + pe); H.P.push(U.bar(md.pressure()));
  const tm = md.time - md.markTime;
  H.mt.push(U.ps(tm)); H.my.push(md.msd() * U.sigma * U.sigma * 1e18);
  if (H.t.length > 320) for (const k of ['t', 'T', 'ke', 'pe', 'e', 'P']) H[k].shift();
  // MSD window: restart every ~6 reduced time units, keep the last window as a ghost and estimate D from it
  if (tm >= 6) {
    S.D = md.msd() / (6 * tm);
    H.pt = H.mt.slice(); H.py = H.my.slice(); H.mt.length = 0; H.my.length = 0; md.mark();
  }
}

function phaseGuess() {
  if (!md.N) return ['empty box', COL.muted];
  const Z = md.meanCoord(), rho = md.density;
  if (rho < 0.12 || Z < 2.5) return ['GAS', COL.warn];
  if (S.D === null) return ['measuring…', COL.muted];
  if (S.D < 0.006 && Z > 9.5) return ['SOLID (crystal)', COL.good];
  if (Z < 5) return ['GAS / clusters', COL.warn];
  return ['LIQUID / dense fluid', '#6aa8ff'];
}

const mean = (a, n) => { const s = a.slice(-n); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : 0; };
const fmtP = (bar) => Math.abs(bar) >= 9999 ? (bar / 1000).toFixed(1) + ' kbar' : bar.toFixed(Math.abs(bar) < 10 ? 2 : 1) + ' bar';

/* ================================================================== visuals */
const col = new THREE.Color();
function ramp(t, out) {                 // blue -> cyan -> yellow -> red
  t = clamp(t, 0, 1);
  if (t < 0.35) { const f = t / 0.35; out[0] = 0.10 + 0.0 * f; out[1] = 0.25 + 0.55 * f; out[2] = 0.95 - 0.05 * f; }
  else if (t < 0.65) { const f = (t - 0.35) / 0.3; out[0] = 0.1 + 0.9 * f; out[1] = 0.8 + 0.1 * f; out[2] = 0.9 - 0.7 * f; }
  else { const f = (t - 0.65) / 0.35; out[0] = 1; out[1] = 0.9 - 0.7 * f; out[2] = 0.2 - 0.1 * f; }
}
const rgb = [0, 0, 0];
function updateAtoms() {
  const N = md.N, m = atoms.instanceMatrix.array, c = atoms.instanceColor.array;
  atoms.count = N;
  const T = Math.max(md.temperature(), 0.03), R = 0.47;
  const base = col.set(ELEMENTS[S.el].color);
  for (let i = 0; i < N; i++) {
    const k = 16 * i, s = i === S.tag ? R * 1.35 : R;
    m[k] = m[k + 5] = m[k + 10] = s; m[k + 12] = md.x[i]; m[k + 13] = md.y[i]; m[k + 14] = md.z[i];
    if (i === S.tag) { rgb[0] = 1; rgb[1] = 0.95; rgb[2] = 0.55; }
    else if (S.color === 'speed') { const ke = 0.5 * (md.vx[i] ** 2 + md.vy[i] ** 2 + md.vz[i] ** 2); ramp(ke / (T * 4), rgb); }
    else if (S.color === 'coord') ramp(1 - clamp((md.z_[i] - 3) / 9, 0, 1), rgb);
    else { rgb[0] = Math.sqrt(base.r); rgb[1] = Math.sqrt(base.g); rgb[2] = Math.sqrt(base.b); }
    c[3 * i] = rgb[0] * rgb[0]; c[3 * i + 1] = rgb[1] * rgb[1]; c[3 * i + 2] = rgb[2] * rgb[2];
  }
  atoms.instanceMatrix.needsUpdate = true; atoms.instanceColor.needsUpdate = true;

  const L = md.L;
  inner.position.setScalar(-L / 2);
  boxEdges.scale.setScalar(L); boxEdges.position.setScalar(L / 2);
  boxFaces.scale.setScalar(L); boxFaces.position.setScalar(L / 2);
  boxFaces.visible = !md.periodic; boxEdges.material.opacity = md.periodic ? 0.5 : 0.95;
  const sc = Math.min(wps, 0.85 / L) * userScale;
  simRoot.scale.setScalar(sc);

  // trail of the tagged atom (unwrapped)
  if (S.trail && S.tag >= 0 && S.tag < N) {
    const i = S.tag; let dx = md.x[i] - trailLast.x, dy = md.y[i] - trailLast.y, dz = md.z[i] - trailLast.z;
    if (md.periodic) { dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); dz -= L * Math.round(dz / L); }
    trailAcc.x += dx; trailAcc.y += dy; trailAcc.z += dz; trailLast.set(md.x[i], md.y[i], md.z[i]);
    if (!S.paused) {
      if (trailN >= TRAIL_MAX) { trailPos.copyWithin(0, 3 * 20, 3 * TRAIL_MAX); trailN -= 20; }
      trailPos[3 * trailN] = trailAcc.x; trailPos[3 * trailN + 1] = trailAcc.y; trailPos[3 * trailN + 2] = trailAcc.z; trailN++;
      trailGeo.attributes.position.needsUpdate = true; trailGeo.setDrawRange(0, trailN);
    }
    trail.position.set(md.x[i] - trailAcc.x, md.y[i] - trailAcc.y, md.z[i] - trailAcc.z);   // keep the trail attached to the atom
    trail.visible = true;
  } else trail.visible = false;

  // tweezers visual
  const e = md.ext;
  if (e.i >= 0 && e.i < N) {
    const p = tweezLine.geometry.attributes.position;
    p.setXYZ(0, md.x[e.i], md.y[e.i], md.z[e.i]); p.setXYZ(1, e.x, e.y, e.z); p.needsUpdate = true;
    tweezLine.visible = true; tweezDot.visible = true; tweezDot.position.set(e.x, e.y, e.z);
    tweezLine.material.color.setHSL(0.12 - 0.12 * md.extForce, 1, 0.65);
  } else { tweezLine.visible = false; tweezDot.visible = false; }
}

/* ================================================================== panels (canvas UIs) */
const CW = 800, CH = 1160;
const ui = new UI(CW, CH);
const plotCanvas = document.createElement('canvas'); plotCanvas.width = PW; plotCanvas.height = PH;
const pctx = plotCanvas.getContext('2d');

const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
function makeTex(cv) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; return t; }
const uiTex = makeTex(ui.canvas), plotTex = makeTex(plotCanvas);
const PANEL_W = 0.72;
const uiMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_W * CH / CW), new THREE.MeshBasicMaterial({ map: uiTex, transparent: true, toneMapped: false }));
const plotMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86 * PH / PW), new THREE.MeshBasicMaterial({ map: plotTex, transparent: true, toneMapped: false }));
uiMesh.position.set(-0.86, 1.32, -0.74); uiMesh.rotation.y = 0.56;
plotMesh.position.set(0.98, 1.3, -0.78); plotMesh.rotation.y = -0.6;
uiMesh.visible = plotMesh.visible = false;
bench.add(uiMesh); bench.add(plotMesh);
uiMesh.userData.ui = true;

function drawControls() {
  const T = U.K(md.temperature());
  ui.begin();
  ui.header('MD LAB', md.N ? `${S.el} · ${md.N} atoms · box ${U.nm(md.L).toFixed(2)} nm` : 'empty box');
  const Pb = U.bar(md.pressure());
  ui.row(2); ui.readout('Temperature', T.toFixed(1) + ' K', { color: COL.accent }); ui.readout('Target', S.thermo ? S.TsetK.toFixed(0) + ' K' : 'off (NVE)', { color: S.thermo ? COL.warn : COL.muted });
  ui.row(2); ui.readout('Pressure', fmtP(Pb)); ui.readout('Density ρ*', md.density.toFixed(3));
  ui.row(2); ui.readout('Energy / atom', (U.eV((md.KE + md.PE) / Math.max(1, md.N)) * 1000).toFixed(1) + ' meV'); ui.readout('Coordination Z', md.meanCoord().toFixed(1));
  const [ph, pc] = phaseGuess();
  ui.row(2); ui.readout('Looks like', ph, { color: pc }); ui.readout('Speed', `${(U.ps(md.dt) * S.sps).toFixed(1)} ps/s`, {});
  if (md.exploded) { ui.label('⚠ The simulation blew up - the time step was too large. Press Rebuild.', { color: COL.bad, size: 20, bold: true }); }
  ui.space(2);
  S.tab = ui.tabs(['BUILD', 'RUN', 'DATA', 'LAB', 'VR'], S.tab);
  ui.space(2);
  [tabBuild, tabRun, tabData, tabLab, tabVR][S.tab]();
  // footer
  const c = ui.ctx;
  c.fillStyle = COL.card; c.fillRect(ui.pad, CH - 56, CW - 2 * ui.pad, 36);
  c.font = '20px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  const msgOn = now() < S.msgUntil;
  c.fillStyle = msgOn ? COL.warn : COL.muted;
  c.fillText(msgOn ? S.msg : toolHint(), ui.pad + 12, CH - 38);
  ui.end();
}

function toolHint() {
  const t = S.tool;
  const trig = S.vr ? 'trigger' : 'click';
  return t === 'tweezers' ? `Tool: TWEEZERS - hold ${trig} on an atom and drag` : t === 'add' ? `Tool: ADD ATOM - ${trig} inside the box` : `Tool: DELETE - ${trig} an atom to remove it`;
}

function tabBuild() {
  ui.section('1  Atoms');
  B.el = ui.choice(Object.keys(ELEMENTS).map((k) => [k, k]), B.el);
  const e = ELEMENTS[B.el];
  ui.label(`${e.name}: σ = ${e.sigma} nm,  ε/k = ${e.epsK} K,  m = ${e.mass} u`, { size: 19 });
  ui.section('2  Size and structure');
  B.cells = Math.round(ui.slider('cells', 'Lattice cells n', B.cells, 2, 7, (v) => `n = ${Math.round(v)}  →  ${4 * Math.round(v) ** 3} atoms`, { step: 1, h: 66 }));
  B.start = ui.choice([['fcc', 'FCC crystal'], ['gas', 'Random gas']], B.start);
  const gcc = (B.rho * ELEMENTS[B.el].mass * 1.66053907e-27 / ((ELEMENTS[B.el].sigma * 1e-9) ** 3)) / 1000;
  B.rho = ui.slider('rho', 'Density ρ*', B.rho, 0.02, 1.3, (v) => `${v.toFixed(2)}  (${(v * gcc / B.rho).toFixed(2)} g/cm³)`, { log: true, h: 66 });
  B.rho = Math.round(B.rho * 100) / 100;
  B.T0 = ui.slider('T0', 'Start temperature', B.T0, 5, 500, (v) => `${v.toFixed(0)} K   (T* = ${(v / e.epsK).toFixed(2)})`, { step: 1, h: 66 });
  ui.space(4);
  ui.row(2);
  if (ui.button('BUILD SYSTEM', { primary: true, h: 62, size: 25 })) { S.TsetK = B.T0; build(B); }
  if (ui.button('Clear box', { h: 62 })) { md.clear(); md.L = 6; resetHistory(); trailN = 0; trailGeo.setDrawRange(0, 0); S.tag = -1; toast('Box emptied - use the Add tool to place atoms'); }
  ui.section('3  Edit by hand');
  S.tool = ui.choice([['tweezers', 'Tweezers'], ['add', 'Add atom'], ['delete', 'Delete']], S.tool);
  ui.row(3);
  if (ui.button('+10 atoms')) addRandom(10);
  if (ui.button('−10 atoms')) removeRandom(10);
  if (ui.button('Tag atom')) { retag(); toast('New atom tagged (shown large, with a trail)'); }
  ui.space(6);
  ui.paragraph('Pick the atoms, size, structure, density and start temperature, then press BUILD SYSTEM. Use RUN to heat, squeeze and step the system, DATA to measure, and LAB for guided experiments.', { size: 19, color: COL.muted });
}

function tabRun() {
  ui.row(3);
  if (ui.button(S.paused ? '▶  Run' : '❚❚  Pause', { primary: !S.paused, active: S.paused, h: 62, size: 25 })) S.paused = !S.paused;
  if (ui.button('Step ×20', { h: 62 })) { S.paused = true; md.run(20); }
  if (ui.button('Rebuild', { h: 62, danger: md.exploded })) { if (S.lastBuild) { build(S.lastBuild); } }
  ui.space(2);
  S.thermo = ui.toggle(S.thermo ? 'Thermostat ON  (constant T)' : 'Thermostat OFF  (energy conserved)', S.thermo);
  S.TsetK = ui.slider('Tset', 'Target temperature', S.TsetK, 3, 600, (v) => `${v.toFixed(0)} K  (T* ${(v / ELEMENTS[S.el].epsK).toFixed(2)})`, { step: 1, h: 66 });
  const rho = md.density, nr = ui.slider('vol', 'Density ρ*  (squeeze / expand the box)', rho, 0.02, 1.4, (v) => `${v.toFixed(3)}   L = ${U.nm(Math.cbrt(md.N / v)).toFixed(2)} nm`, { log: true, h: 66 });
  if (nr !== rho && md.N) md.setBox(Math.cbrt(md.N / nr));
  S.periodic = ui.choice([[true, 'Periodic box'], [false, 'Hard walls']], S.periodic);
  if (S.periodic !== md.periodic) md.switchBoundary(S.periodic);
  S.dt = ui.slider('dt', 'Time step', S.dt, 0.001, 0.02, (v) => `${v.toFixed(3)}   (${U.fs(v).toFixed(1)} fs)`, { h: 66 });
  if (S.dt > 0.01) ui.label('Large steps: watch the total energy drift (DATA).', { color: COL.warn, size: 18 });
  S.speed = Math.round(ui.slider('speed', 'Simulation steps per frame (max)', S.speed, 1, 60, (v) => `${Math.round(v)}`, { step: 1, h: 66 }));
  ui.section('Look');
  S.color = ui.choice([['speed', 'Speed'], ['coord', 'Coordination'], ['el', 'Plain']], S.color);
  S.trail = ui.toggle('Trail of the tagged atom', S.trail, { h: 48 });
}

function tabData() {
  ui.row(2);
  if (ui.button('Reset g(r)')) { md.resetRDF(); }
  if (ui.button('Restart MSD')) { md.mark(); H.mt.length = 0; H.my.length = 0; H.pt.length = 0; H.py.length = 0; S.D = null; }
  ui.row(2);
  if (ui.button('●  Record row', { primary: true })) recordRow();
  if (ui.button('Export CSV', { disabled: S.vr })) exportCSV();
  ui.section('Averages (last ~60 samples)');
  ui.row(2); ui.readout('⟨T⟩', mean(H.T, 60).toFixed(1) + ' K'); ui.readout('⟨P⟩', fmtP(mean(H.P, 60)));
  ui.row(2); ui.readout('⟨KE⟩ / atom', mean(H.ke, 60).toFixed(1) + ' meV'); ui.readout('⟨PE⟩ / atom', mean(H.pe, 60).toFixed(1) + ' meV');
  const D = S.D === null ? null : U.D_m2s(S.D) * 1e9;
  ui.row(2); ui.readout('D (diffusion)', D === null ? '…' : D.toFixed(D < 0.1 ? 3 : 2) + ' ×10⁻⁹ m²/s'); ui.readout('Total E drift', H.e.length > 5 ? (H.e[H.e.length - 1] - H.e[0]).toFixed(2) + ' meV' : '…');
  ui.section('Recorded measurements');
  const c = ui.ctx; c.font = '600 19px ui-monospace,Consolas,monospace'; c.textAlign = 'left';
  const colsX = [0, 88, 165, 285, 400, 500];
  c.fillStyle = COL.accent; ['#', 'T/K', 'ρ*', 'P/bar', 'U/meV', 'D/1e-9'].forEach((h, i) => c.fillText(h, ui.pad + colsX[i], ui.y + 10));
  ui.y += 28;
  c.fillStyle = COL.text;
  const rows = S.rows.slice(-9);
  rows.forEach((r, k) => {
    const vals = [String(S.rows.length - rows.length + k + 1), r.T.toFixed(1), r.rho.toFixed(3), r.P.toFixed(Math.abs(r.P) < 10 ? 2 : 0), r.U.toFixed(1), r.D === null ? '-' : r.D.toFixed(2)];
    vals.forEach((v, i) => c.fillText(v, ui.pad + colsX[i], ui.y + 10)); ui.y += 27;
  });
  if (!rows.length) ui.label('Press "Record row" to log T, ρ*, P, U and D.', { size: 19 });
}

function recordRow() {
  const T = mean(H.T, 20), P = mean(H.P, 20), Uu = mean(H.pe, 20);
  S.rows.push({ T, rho: md.density, P, U: Uu, D: S.D === null ? null : U.D_m2s(S.D) * 1e9 });
  toast('Row ' + S.rows.length + ' recorded');
}
function exportCSV() {
  if (!S.rows.length) { toast('Nothing recorded yet'); return; }
  const txt = 'T_K,rho_star,P_bar,U_meV_per_atom,D_1e-9_m2_per_s\n' + S.rows.map((r) => [r.T.toFixed(2), r.rho.toFixed(4), r.P.toFixed(3), r.U.toFixed(3), r.D === null ? '' : r.D.toFixed(4)].join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'md-lab-measurements.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function tabLab() {
  const t = TASKS[S.taskPage];
  ui.row(3);
  if (ui.button('◀ Prev', { disabled: S.taskPage === 0 })) S.taskPage = Math.max(0, S.taskPage - 1);
  ui.skip();
  if (ui.button('Next ▶', { disabled: S.taskPage === TASKS.length - 1 })) S.taskPage = Math.min(TASKS.length - 1, S.taskPage + 1);
  ui.ctx.fillStyle = COL.muted; ui.ctx.font = '20px system-ui'; ui.ctx.textAlign = 'center'; ui.ctx.fillText(`Task ${S.taskPage + 1} of ${TASKS.length}`, CW / 2, ui.y - 35);
  ui.label(t.title, { size: 28, bold: true, color: COL.accent });
  ui.paragraph(t.goal, { size: 22, color: COL.text });
  ui.row(1);
  if (ui.button('Load this setup  ▶', { primary: true, h: 58 })) applyTask(t);
  ui.space(2);
  t.steps.forEach((s, i) => ui.paragraph(`${i + 1}.  ${s}`, { size: 21, color: COL.muted }));
  if (t.ask) { ui.space(2); ui.paragraph('Think about: ' + t.ask, { size: 21, color: COL.warn }); }
}

function tabVR() {
  const p = VR_HELP[S.helpPage];
  ui.row(3);
  if (ui.button('◀ Prev', { disabled: S.helpPage === 0 })) S.helpPage = Math.max(0, S.helpPage - 1);
  ui.skip();
  if (ui.button('Next ▶', { disabled: S.helpPage === VR_HELP.length - 1 })) S.helpPage = Math.min(VR_HELP.length - 1, S.helpPage + 1);
  ui.ctx.fillStyle = COL.muted; ui.ctx.font = '20px system-ui'; ui.ctx.textAlign = 'center'; ui.ctx.fillText(`${S.helpPage + 1} / ${VR_HELP.length}`, CW / 2, ui.y - 35);
  ui.label(p.title, { size: 26, bold: true, color: COL.accent });
  p.lines.forEach((l) => ui.paragraph(l, { size: 22, color: COL.text }));
  ui.row(1);
  if (S.vr) { if (ui.button('Exit VR', { danger: true, h: 56 })) endVR(); }
  else if (ui.button(xrState.supported ? 'Enter VR' : 'VR not detected on this device', { primary: xrState.supported, h: 56, disabled: !xrState.supported })) enterVR();
}

function plotData() {
  const e = ELEMENTS[S.el], rr = [], gg = [];
  const g = md.rdf(), dr = md.rdfMax / md.rdfBins;
  for (let b = 0; b < g.length; b++) { const r = (b + 0.5) * dr; if (r > md.rcUsed) break; rr.push(r * e.sigma); gg.push(g[b]); }
  return {
    t: H.t, T: H.T, ke: H.ke, pe: H.pe, e: H.e, Ttarget: S.thermo ? S.TsetK : (H.T.length ? H.T[H.T.length - 1] : S.TsetK),
    rdf: { r: rr, g: gg }, msd: { t: H.mt, y: H.my, tPrev: H.pt, yPrev: H.py },
    Dtext: S.D === null ? '' : 'D ≈ ' + (U.D_m2s(S.D) * 1e9).toFixed(3) + ' ×10⁻⁹ m²/s',
  };
}

/* ================================================================== DOM wiring (desktop) */
const dom = {
  ui: document.getElementById('uiWrap'), plots: document.getElementById('plotWrap'),
  vrBtn: document.getElementById('vrBtn'), plotBtn: document.getElementById('plotBtn'), panelBtn: document.getElementById('panelBtn'),
};
dom.ui.appendChild(ui.canvas); dom.plots.appendChild(plotCanvas);
function canvasXY(cv, ev) { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]; }
ui.canvas.addEventListener('pointermove', (e) => { const [x, y] = canvasXY(ui.canvas, e); ui.move(x, y, 'mouse'); });
ui.canvas.addEventListener('pointerleave', () => ui.leave('mouse'));
ui.canvas.addEventListener('pointerdown', (e) => { const [x, y] = canvasXY(ui.canvas, e); ui.canvas.setPointerCapture(e.pointerId); ui.move(x, y, 'mouse'); ui.press('mouse'); e.preventDefault(); });
ui.canvas.addEventListener('pointerup', (e) => { ui.release('mouse'); if (e.pointerType !== 'mouse') ui.leave('mouse'); });
ui.canvas.addEventListener('pointercancel', () => ui.release('mouse'));
ui.canvas.style.touchAction = 'none';
dom.plotBtn.onclick = () => { S.plots = !S.plots; dom.plots.style.display = S.plots ? '' : 'none'; };
dom.panelBtn.onclick = () => { S.panel = !S.panel; dom.ui.style.display = S.panel ? '' : 'none'; };
if (window.innerWidth < 760) { S.plots = false; dom.plots.style.display = 'none'; }

/* ================================================================== picking / tools (shared by mouse and VR) */
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3();
function toLocal(o, d) {
  inner.updateWorldMatrix(true, false);
  tmpM.copy(inner.matrixWorld).invert();
  const lo = o.clone().applyMatrix4(tmpM), ld = d.clone().transformDirection(tmpM);
  return { o: lo, d: ld, s: simRoot.scale.x };
}
function pickAtom(o, d) {
  const r = toLocal(o, d), R2 = 0.7 * 0.7; let best = -1, bt = 1e9;
  for (let i = 0; i < md.N; i++) {
    const px = md.x[i] - r.o.x, py = md.y[i] - r.o.y, pz = md.z[i] - r.o.z;
    const t = px * r.d.x + py * r.d.y + pz * r.d.z; if (t < 0) continue;
    const d2 = px * px + py * py + pz * pz - t * t;
    if (d2 < R2 && t < bt) { bt = t; best = i; }
  }
  return best < 0 ? null : { i: best, t: bt, s: r.s };
}
function rayBox(o, d) {
  const r = toLocal(o, d), L = md.L; let t0 = 0, t1 = 1e9;
  for (const ax of ['x', 'y', 'z']) {
    const oo = r.o[ax], dd = r.d[ax];
    if (Math.abs(dd) < 1e-9) { if (oo < 0 || oo > L) return null; continue; }
    let a = (0 - oo) / dd, b = (L - oo) / dd; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
  }
  const t = 0.5 * (t0 + t1);
  return { x: r.o.x + r.d.x * t, y: r.o.y + r.d.y * t, z: r.o.z + r.d.z * t };
}

const hold = { src: null, kind: null, next: 0, grab: null };      // current tool interaction (one at a time)
function rayOf(src) {
  if (src === 'mouse') { return { o: mouseRay.origin.clone(), d: mouseRay.direction.clone() }; }
  const vc = vrc[src], o = new THREE.Vector3().setFromMatrixPosition(vc.obj.matrixWorld);
  const d = new THREE.Vector3(0, 0, -1).transformDirection(vc.obj.matrixWorld); return { o, d };
}
function toolDown(src) {
  if (hold.src !== null) return false;
  const { o, d } = rayOf(src);
  if (S.tool === 'tweezers') {
    const p = pickAtom(o, d); if (!p) return false;
    hold.src = src; hold.kind = 'tw'; hold.grab = { i: p.i, dist: p.t * p.s }; md.ext.i = p.i; pulse(src, 0.5, 40); return true;
  }
  if (S.tool === 'add' || S.tool === 'delete') {
    hold.src = src; hold.kind = S.tool === 'add' ? 'add' : 'del'; hold.next = now() + 380;
    if (S.tool === 'add' ? doAdd(src, o, d) : doDel(src, o, d)) return true;
    hold.src = null; hold.kind = null; return false;
  }
  return false;
}
function doAdd(src, o, d) {
  const p = rayBox(o, d);
  if (!p) return false;
  const i = md.addAtom(p.x, p.y, p.z);
  if (i < 0) { toast('No room for another atom there'); return true; }
  if (S.tag < 0) retag();
  pulse(src, 0.25, 20); return true;
}
function doDel(src, o, d) {
  const p = pickAtom(o, d); if (!p) return false;
  removeAtomAt(p.i); pulse(src, 0.4, 30); return true;
}
function toolUp(src) {
  if (hold.src !== src) return;
  if (hold.kind === 'tw') md.ext.i = -1;
  hold.src = null; hold.kind = null; hold.grab = null;
}
function toolUpdate() {
  if (hold.src === null) return;
  const { o, d } = rayOf(hold.src);
  if (hold.kind === 'tw' && hold.grab) {
    const w = o.clone().addScaledVector(d, hold.grab.dist);
    const r = toLocal(w, d); const L = md.L;
    md.ext.x = clamp(r.o.x, 0, L); md.ext.y = clamp(r.o.y, 0, L); md.ext.z = clamp(r.o.z, 0, L); md.ext.i = hold.grab.i;
    if (hold.src !== 'mouse') pulse(hold.src, 0.08 + 0.5 * md.extForce, 30);
  } else if (hold.kind === 'add' || hold.kind === 'del') {
    if (now() > hold.next) { hold.next = now() + (hold.kind === 'add' ? 140 : 220); if (hold.kind === 'add') doAdd(hold.src, o, d); else doDel(hold.src, o, d); }
  }
}
function pulse(src, strength, ms) {
  if (src === 'mouse') return;
  const gp = vrc[src].src && vrc[src].src.gamepad; const h = gp && gp.hapticActuators && gp.hapticActuators[0];
  if (h && h.pulse) { try { h.pulse(strength, ms); } catch (e) { /* ignore */ } }
}

/* ---------- desktop mouse ---------- */
const mouseRay = new THREE.Ray(); const ndc = new THREE.Vector2(); const ray = new THREE.Raycaster();
function setMouse(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera); mouseRay.copy(ray.ray);
}
const controls = new OrbitControls(camera, renderer.domElement);
renderer.domElement.addEventListener('pointerdown', (e) => {
  setMouse(e);
  const hit = e.button === 0 && !S.vr && toolDown('mouse');
  controls.mouseButtons.LEFT = hit ? -1 : THREE.MOUSE.ROTATE; controls.touches.ONE = hit ? -1 : THREE.TOUCH.ROTATE;
}, true);
renderer.domElement.addEventListener('pointermove', (e) => { setMouse(e); }, true);
window.addEventListener('pointerup', () => toolUp('mouse'));
controls.target.copy(SIM_HOME); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.3; controls.maxDistance = 6;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
camera.position.set(0.85, 1.75, 0.55); controls.update();
window.addEventListener('keydown', (e) => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if (e.code === 'Space') { S.paused = !S.paused; e.preventDefault(); }
  else if (e.key === '1') S.tool = 'tweezers'; else if (e.key === '2') S.tool = 'add'; else if (e.key === '3') S.tool = 'delete';
  else if (e.key === 'r' || e.key === 'R') { if (S.lastBuild) build(S.lastBuild); }
  else if (e.key === 'p' || e.key === 'P') dom.plotBtn.click();
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); if (!S.vr) renderer.setSize(window.innerWidth, window.innerHeight); });

/* ================================================================== WebXR */
const xrState = { supported: false };
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { xrState.supported = ok; dom.vrBtn.textContent = ok ? 'Enter VR' : 'VR not detected'; dom.vrBtn.classList.toggle('on', ok); }).catch(() => { dom.vrBtn.textContent = 'VR not detected'; });
} else dom.vrBtn.textContent = 'WebXR unavailable';
async function enterVR() {
  if (!navigator.xr) { S.tab = 4; return; }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    await renderer.xr.setSession(session);
  } catch (e) { toast('Could not start VR: ' + (e.message || e)); S.tab = 4; }
}
function endVR() { const s = renderer.xr.getSession(); if (s) s.end(); }
dom.vrBtn.onclick = () => { if (xrState.supported) enterVR(); else { S.tab = 4; S.helpPage = 0; toast('No VR device found - see the VR tab for setup help', 6000); } };

let needRecenter = false;
renderer.xr.addEventListener('sessionstart', () => {
  S.vr = true; needRecenter = true; document.body.classList.add('vr');
  uiMesh.visible = plotMesh.visible = true;
  S.xr = renderer.xr.getSession();
});
renderer.xr.addEventListener('sessionend', () => {
  S.vr = false; document.body.classList.remove('vr'); uiMesh.visible = plotMesh.visible = false;
  bench.position.set(0, 0, 0); bench.rotation.set(0, 0, 0); simRoot.position.copy(SIM_HOME); simRoot.quaternion.identity(); userScale = 1;
  for (const vc of vrc) { vc.src = null; vc.obj.visible = false; vc.sq = null; vc.hit = null; toolUp(vc.i); }
  S.xr = null; renderer.setSize(window.innerWidth, window.innerHeight); camera.position.set(0.85, 1.75, 0.55); controls.update();
});

function recenter() {
  const cam = renderer.xr.getCamera();
  const p = new THREE.Vector3(), f = new THREE.Vector3();
  cam.getWorldPosition(p); cam.getWorldDirection(f); f.y = 0;
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  bench.rotation.set(0, Math.atan2(-f.x, -f.z), 0); bench.position.set(p.x, 0, p.z);
  bench.updateMatrixWorld(true);
  simRoot.position.copy(SIM_HOME).applyMatrix4(bench.matrixWorld); simRoot.quaternion.copy(bench.quaternion); userScale = 1;
  // keep the panels at a comfortable height for this person
  const h = clamp(p.y - 0.12, 0.95, 1.7);
  uiMesh.position.y = h; plotMesh.position.y = h - 0.02; simRoot.position.y = h + 0.02;
}

// controllers: simple geometry (no network needed)
const vrc = [0, 1].map((i) => {
  const obj = renderer.xr.getController(i); scene.add(obj); obj.visible = false;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.1, 12), new THREE.MeshPhongMaterial({ color: 0x2a3a5c, emissive: 0x0a1020 }));
  body.rotation.x = Math.PI / 2; body.position.z = 0.04; obj.add(body);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0x4ae3e1 })); obj.add(tip);
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x4ae3e1, transparent: true, opacity: 0.8 }));
  laser.scale.z = 1.5; obj.add(laser);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); dot.visible = false; scene.add(dot);
  const vc = { i, obj, laser, dot, src: null, hit: null, uiHeld: false, sq: null, prev: [false, false, false], hand: '' };
  obj.addEventListener('connected', (e) => { vc.src = e.data; vc.hand = e.data.handedness; obj.visible = true; });
  obj.addEventListener('disconnected', () => { vc.src = null; obj.visible = false; });
  obj.addEventListener('selectstart', () => {
    if (vc.hit) { if (vc.hit.ui) { ui.press(i); vc.uiHeld = true; } return; }
    toolDown(i);
  });
  obj.addEventListener('selectend', () => { if (vc.uiHeld) { ui.release(i); vc.uiHeld = false; } toolUp(i); });
  obj.addEventListener('squeezestart', () => { vc.sq = true; regrab(); });
  obj.addEventListener('squeezeend', () => { vc.sq = null; regrab(); });
  return vc;
});

// grip = pick up the experiment; both grips = scale it
let grabRef = null;
function regrab() {
  const dr = vrc.filter((v) => v.sq);
  if (!dr.length) { grabRef = null; return; }
  const d = dr[0], q = d.obj.getWorldQuaternion(new THREE.Quaternion()), p = d.obj.getWorldPosition(new THREE.Vector3());
  const qi = q.clone().invert();
  grabRef = {
    drv: d, relP: simRoot.position.clone().sub(p).applyQuaternion(qi), relQ: qi.clone().multiply(simRoot.quaternion),
    s0: userScale, dist0: dr.length > 1 ? dr[0].obj.position.distanceTo(dr[1].obj.position) : 0, two: dr.length > 1,
  };
}
function updateGrab() {
  if (!grabRef) return;
  const d = grabRef.drv, q = d.obj.getWorldQuaternion(new THREE.Quaternion()), p = d.obj.getWorldPosition(new THREE.Vector3());
  simRoot.position.copy(grabRef.relP).applyQuaternion(q).add(p);
  simRoot.quaternion.copy(q).multiply(grabRef.relQ);
  const dr = vrc.filter((v) => v.sq);
  if (dr.length > 1 && grabRef.two && grabRef.dist0 > 0.05) userScale = clamp(grabRef.s0 * dr[0].obj.position.distanceTo(dr[1].obj.position) / grabRef.dist0, 0.25, 4);
}

const rc = new THREE.Raycaster();
function vrInput(dt) {
  if (needRecenter && renderer.xr.getCamera().cameras && renderer.xr.getCamera().cameras.length) { recenter(); needRecenter = false; }
  bench.updateMatrixWorld(true);
  for (const vc of vrc) {
    vc.hit = null;
    if (!vc.src) continue;
    const o = new THREE.Vector3().setFromMatrixPosition(vc.obj.matrixWorld), d = new THREE.Vector3(0, 0, -1).transformDirection(vc.obj.matrixWorld);
    rc.set(o, d); rc.far = 3;
    const hits = rc.intersectObjects([uiMesh, plotMesh], false);
    let len = 1.5;
    if (hits.length) {
      const h = hits[0]; len = h.distance;
      if (h.object === uiMesh) { vc.hit = { ui: true }; ui.move(h.uv.x * CW, (1 - h.uv.y) * CH, vc.i); } else vc.hit = { ui: false };
      vc.dot.visible = true; vc.dot.position.copy(h.point);
    } else { vc.dot.visible = false; ui.leave(vc.i); }
    vc.laser.scale.z = len;
    vc.laser.material.color.set(vc.hit ? 0xffffff : 0x4ae3e1);

    const gp = vc.src.gamepad;
    if (gp) {
      const ay = Math.abs(gp.axes[3] || 0) > 0.2 ? gp.axes[3] : 0;
      const btn = [!!(gp.buttons[4] && gp.buttons[4].pressed), !!(gp.buttons[5] && gp.buttons[5].pressed), !!(gp.buttons[3] && gp.buttons[3].pressed)];
      if (btn[0] && !vc.prev[0]) { S.tool = S.tool === 'tweezers' ? 'add' : S.tool === 'add' ? 'delete' : 'tweezers'; toast('Tool: ' + S.tool); }
      if (btn[1] && !vc.prev[1]) S.paused = !S.paused;
      if (btn[2] && !vc.prev[2]) recenter();
      vc.prev = btn;
      if (ay) {
        if (hold.src === vc.i && hold.grab) hold.grab.dist = clamp(hold.grab.dist - ay * dt * 0.9, 0.12, 3.5);
        else if (vc.hand === 'right') { if (S.thermo) S.TsetK = clamp(S.TsetK - ay * dt * 45, 3, 600); }
        else if (md.N) {
          const Lmin = Math.cbrt(md.N / 1.4), Lmax = Math.cbrt(md.N / 0.02);
          const Ln = clamp(md.L * (1 - ay * dt * 0.3), Lmin, Lmax); if (Ln !== md.L) md.setBox(Ln);
        }
      }
    }
  }
  updateGrab();
}

/* ================================================================== main loop */
let last = now(), lastUI = 0, lastPlot = 0;
function frame() {
  const t = now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (S.vr) vrInput(dt); else controls.update();
  toolUpdate();

  md.dt = S.dt; md.thermostat = S.thermo; md.Ttarget = U.Tstar(S.TsetK);
  if (!S.paused && md.N && !md.exploded) {
    const budget = S.vr ? 4.5 : 9, t0 = now(); let n = 0;
    while (n < S.speed && now() - t0 < budget) { md.run(1); n++; }
    S.sps = S.sps * 0.9 + 0.1 * (n / Math.max(dt, 1e-3));
    while (md.step - H.lastStep >= 25) { H.lastStep += 25; sample(); }
  } else S.sps *= 0.9;
  if (md.exploded && !S.paused) { S.paused = true; toast('Simulation unstable: lower the time step and Rebuild', 8000); }

  updateAtoms();

  if (ui.pressed || ui.released || (ui.dirty && t - lastUI >= (S.vr ? 33 : 0)) || t - lastUI > (S.vr ? 130 : 90)) { drawControls(); lastUI = t; if (S.vr) uiTex.needsUpdate = true; }
  if (t - lastPlot > (S.vr ? 600 : 300) && (S.plots || S.vr)) { drawPlots(pctx, plotData()); lastPlot = t; if (S.vr) plotTex.needsUpdate = true; }
  renderer.render(scene, camera);
}
build(B, { quiet: true });
md.run(300);
renderer.setAnimationLoop(frame);
window.__mdlab = { TASKS, md, S, B, H, build, ui, renderer, camera, scene, simRoot, vrc, applyTask, toolDown, toolUp, hold, enterVR };
