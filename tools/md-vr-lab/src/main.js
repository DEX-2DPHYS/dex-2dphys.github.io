// MD Lab VR - build and run a Lennard-Jones molecular-dynamics simulation in WebXR
// (Meta Quest browser, or a Quest on a PC through SteamVR/OpenXR) - or on the desktop with mouse.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MD, ELEMENTS, units, MAXN, clamp } from './physics.js';
import { Mat, TU_FS, SPECIES, TERSOFF } from './materials.js';
import { UI, COL, setPalette } from './ui.js';
import { drawPlots, drawElec, PW, PH } from './plots.js';
import { analyse as analyseNow } from './tb.js';
import { TASKS, VR_HELP } from './content.js';

/* ================================================================== state */
const lj = new MD(MAXN), mat = new Mat(1200);
let md = lj;                                                                 // the active engine: noble-gas LJ or the materials engine
const B = { sys: 'lj', el: 'Ar', cells: 4, start: 'fcc', rho: 1.0, T0: 30,   // build recipe shown on the BUILD tab
  mat: 'graphene', size: 8, layers: 3, nmol: 7, rad: 7, Tm: 300, open: false };
const MAT_DEFAULTS = { benzene: { nmol: 7, Tm: 100 }, graphene: { size: 8, Tm: 300 }, graphite: { size: 7, layers: 3, Tm: 300 }, mos2: { size: 7, layers: 2, Tm: 300 }, nanodiamond: { rad: 7, Tm: 300 } };
const MAT_INFO = {
  benzene: 'OPLS-style force field: bonds, angles, planarity; LJ + charges between molecules.',
  graphene: 'Tersoff carbon (Lindsay-Broido): covalent bonds that can break and re-form.',
  graphite: 'Tersoff layers + Lennard-Jones van der Waals between layers (AB stacking).',
  mos2: 'Stillinger-Weber (Jiang) layers + van der Waals between layers (2H stacking).',
  nanodiamond: 'Tersoff carbon cluster cut from diamond. Bare surface: it can reconstruct.',
};
const S = {
  el: 'Ar', TsetK: 30, thermo: true, paused: false, dt: 0.004, speed: 10, periodic: true,
  color: 'speed', tool: 'tweezers', trail: true, bonds: true, grab: 'atom', addSp: 3, dtFs: 1.0, tag: 0, tab: 0, taskPage: 0, helpPage: 0,
  rows: [], msg: '', msgUntil: 0, D: null, vr: false, xr: null, sps: 0, lastBuild: null, plots: true, panel: true,
  theme: 'dark', tableH: 0.9, moveSpeed: 1.2, snapTurn: true, vignette: true,          // room and seated movement
  cm: new Set(), cp: new Set(), gamma: 1.0, bias: 0.2, arrows: true, live: true, Tlog: false,     // electron transport (ELEC tab)
};
const TABS = ['BUILD', 'RUN', 'DATA', 'LAB', 'ELEC', 'VR'], TAB_ELEC = 4, TAB_VR = 5;
try { const t = localStorage.getItem('mdlab.theme'); if (t === 'light' || t === 'dark') S.theme = t; } catch (e) { /* no storage */ }
const ljUnits = (el) => { const u = units(el); u.msdnm2 = (v) => v * u.sigma * u.sigma * 1e18; return u; };
const matUnits = () => ({ K: (T) => T, Tstar: (T) => T, nm: (r) => r * 0.1, ps: (t) => t * TU_FS / 1000, fs: (t) => t * TU_FS, bar: () => 0, eV: (e) => e, D_m2s: (D) => D * 1e-20 / (TU_FS * 1e-15), msdnm2: (v) => v * 0.01, sigma: 1, eps: 1 });
let U = ljUnits(S.el);
const isMat = () => md === mat;
const dims = () => isMat() ? [mat.Lx, mat.Ly, mat.Lz] : [md.L, md.L, md.L];
const perAxis = () => isMat() ? mat.per : (md.periodic ? [true, true, true] : [false, false, false]);
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
const dolly = new THREE.Group(); scene.add(dolly); dolly.add(camera);       // the user's "rig" for seated movement in VR

const hemi = new THREE.HemisphereLight(0xaec6ff, 0x1a2234, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(1.5, 4, 2); scene.add(sun);
const rim = new THREE.PointLight(0x4ae3e1, 6, 4); rim.position.set(0, 1.9, -1.0); scene.add(rim);

/* ---------- the lab room: a furnished lab, dark or white ----------
   Everything static is merged into one mesh per material (a handful of draw calls), Lambert-shaded and without shadows,
   so the room costs the GPU well under a millisecond per frame and the CPU nothing at all. */
const THEMES = {
  dark: { bg: 0x070b13, fog: [8, 20], floor: 0x0c121d, grid: [0x20314f, 0x131d31], wall: 0x111a2b, trim: 0x1a2640, top: 0x1c2640, cab: 0x141b2e,
    accent: 0x4ae3e1, glass: 0x9fd6ff, prop: 0x2d6f8f, screen: 0x0e2a3a, lamp: 0x9fb8d8,
    sky: ['#03060d', '#0a1730', '#1a2c50'], stars: true, sign: ['#0a1120', '#4ae3e1', '#9fb2cf'], hemi: [0xaec6ff, 0x1a2234, 1.15], sun: 1.7, rim: 6 },
  light: { bg: 0xe8edf3, fog: [10, 28], floor: 0xcdd4de, grid: [0xb3bfce, 0xc4cdd8], wall: 0xf4f6f9, trim: 0xd9dfe7, top: 0xbfc8d4, cab: 0xe4e8ee,
    accent: 0x0b827f, glass: 0x7fb3dc, prop: 0x2b8fa8, screen: 0x1b2532, lamp: 0xffffff,
    sky: ['#6fa9e2', '#b9d8f4', '#f3f8ff'], stars: false, sign: ['#ffffff', '#0b827f', '#4f5f79'], hemi: [0xffffff, 0xb5bfcc, 1.55], sun: 1.25, rim: 2.5 },
};
const bench = new THREE.Group(); scene.add(bench);      // the whole room; recentring turns and moves it to face the user
let room = null;
function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
function makeRoom(th) {
  const grp = new THREE.Group(), parts = {};
  const add = (key, geo) => { (parts[key] = parts[key] || []).push(geo); };
  const box = (key, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); add(key, g); };
  const cyl = (key, r, h, x, y, z) => { const g = new THREE.CylinderGeometry(r, r * 0.92, h, 14, 1); g.translate(x, y, z); add(key, g); };
  const X0 = -4.5, X1 = 4.5, Z0 = -4.8, Z1 = 3.6, H = 3.2, W = X1 - X0, Dp = Z1 - Z0, ZC = (Z0 + Z1) / 2;
  // floor, ceiling, walls (with openings for the windows: walls are built from strips around them)
  box('floor', W, 0.02, Dp, 0, -0.01, ZC);
  box('wall', W, 0.04, Dp, 0, H, ZC);
  const winY0 = 1.2, winY1 = 2.35;                                     // window band
  const wallStrips = (axis, at, from, to, holes) => {                  // a wall along one axis with rectangular holes in the window band
    const seg = (a, b, y0, y1) => { if (b - a < 1e-3 || y1 - y0 < 1e-3) return; const m = (a + b) / 2, l = b - a, hy = y1 - y0, cy = (y0 + y1) / 2; if (axis === 'x') box('wall', l, hy, 0.1, m, cy, at); else box('wall', 0.1, hy, l, at, cy, m); };
    seg(from, to, 0, winY0); seg(from, to, winY1, H);
    let p = from; for (const [c, w] of holes) { seg(p, c - w / 2, winY0, winY1); p = c + w / 2; } seg(p, to, winY0, winY1);
  };
  const backWins = [[-2.6, 1.8], [0, 1.8], [2.6, 1.8]], sideWins = [[-3.1, 1.5], [-0.8, 1.5]];
  wallStrips('x', Z0, X0, X1, backWins); wallStrips('x', Z1, X0, X1, []);
  wallStrips('z', X0, Z0, Z1, sideWins); wallStrips('z', X1, Z0, Z1, sideWins);
  // window frames and sills
  const frame = (axis, at, c, w) => {
    const t = 0.06, inset = axis === 'x' ? (at < 0 ? 0.06 : -0.06) : (at < 0 ? 0.06 : -0.06);
    if (axis === 'x') { box('trim', w + 0.12, t, 0.14, c, winY0 - t / 2, at + inset); box('trim', w + 0.12, t, 0.1, c, winY1 + t / 2, at + inset); box('trim', t, winY1 - winY0, 0.1, c - w / 2 - t / 2, (winY0 + winY1) / 2, at + inset); box('trim', t, winY1 - winY0, 0.1, c + w / 2 + t / 2, (winY0 + winY1) / 2, at + inset); box('trim', 0.03, winY1 - winY0, 0.05, c, (winY0 + winY1) / 2, at + inset); }
    else { box('trim', 0.14, t, w + 0.12, at + inset, winY0 - t / 2, c); box('trim', 0.1, t, w + 0.12, at + inset, winY1 + t / 2, c); box('trim', 0.1, winY1 - winY0, t, at + inset, (winY0 + winY1) / 2, c - w / 2 - t / 2); box('trim', 0.1, winY1 - winY0, t, at + inset, (winY0 + winY1) / 2, c + w / 2 + t / 2); box('trim', 0.05, winY1 - winY0, 0.03, at + inset, (winY0 + winY1) / 2, c); }
  };
  backWins.forEach(([c, w]) => frame('x', Z0, c, w)); sideWins.forEach(([c, w]) => { frame('z', X0, c, w); frame('z', X1, c, w); });
  // skirting
  box('trim', W, 0.1, 0.03, 0, 0.05, Z0 + 0.06); box('trim', W, 0.1, 0.03, 0, 0.05, Z1 - 0.06); box('trim', 0.03, 0.1, Dp, X0 + 0.06, 0.05, ZC); box('trim', 0.03, 0.1, Dp, X1 - 0.06, 0.05, ZC);
  // lab benches all round: worktop + cabinets with handles
  const run = (axis, at, from, to, depthSign) => {               // depthSign: +1 bench extends towards +axis from the wall
    const d = 0.7, l = to - from, m = (from + to) / 2, c0 = at + depthSign * d / 2;
    if (axis === 'x') { box('top', l, 0.04, d + 0.02, m, 0.92, c0); box('cab', l - 0.02, 0.84, d - 0.06, m, 0.46, c0 - depthSign * 0.02); }
    else { box('top', d + 0.02, 0.04, l, c0, 0.92, m); box('cab', d - 0.06, 0.84, l - 0.02, c0 - depthSign * 0.02, 0.46, m); }
    const nDoor = Math.max(1, Math.round(l / 0.6));
    for (let k = 0; k < nDoor; k++) {
      const p = from + (k + 0.5) * l / nDoor, f = at + depthSign * (d - 0.035);
      if (axis === 'x') { box('trim', l / nDoor - 0.03, 0.78, 0.012, p, 0.47, f); box('accent', 0.12, 0.018, 0.02, p, 0.78, f + depthSign * 0.012); }
      else { box('trim', 0.012, 0.78, l / nDoor - 0.03, f, 0.47, p); box('accent', 0.02, 0.018, 0.12, f + depthSign * 0.012, 0.78, p); }
    }
  };
  run('x', Z0 + 0.05, -3.9, 3.9, 1);
  run('z', X0 + 0.05, -4.0, 2.9, 1); run('z', X1 - 0.05, -4.0, 2.9, -1);
  // shelves on the side walls, behind the user
  for (const xs of [X0 + 0.2, X1 - 0.2]) for (const y of [1.55, 2.0]) box('top', 0.28, 0.03, 2.4, xs, y, 1.7);
  // props: beakers, flasks and bottles on the benches and shelves, two monitors on the back bench
  const rnd = (() => { let s = 99; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  for (let k = 0; k < 14; k++) { const r = 0.035 + 0.03 * rnd(), h = 0.1 + 0.16 * rnd(); cyl('glass', r, h, -3.6 + 7.2 * rnd(), 0.94 + h / 2, Z0 + 0.25 + 0.3 * rnd()); }
  for (const xs of [X0 + 0.4, X1 - 0.4]) for (let k = 0; k < 9; k++) { const r = 0.03 + 0.03 * rnd(), h = 0.1 + 0.18 * rnd(); cyl(k % 3 ? 'glass' : 'prop', r, h, xs + (rnd() - 0.5) * 0.25, 0.94 + h / 2, -3.6 + 6 * rnd()); }
  for (const xs of [X0 + 0.2, X1 - 0.2]) for (const y of [1.565, 2.015]) for (let k = 0; k < 7; k++) { const r = 0.03 + 0.02 * rnd(), h = 0.12 + 0.12 * rnd(); cyl(k % 2 ? 'prop' : 'glass', r, h, xs, y + h / 2 + 0.015, 0.7 + 2 * rnd()); }
  for (const xm of [-1.5, 1.5]) { box('cab', 0.64, 0.4, 0.04, xm, 1.32, Z0 + 0.35); box('screen', 0.6, 0.36, 0.01, xm, 1.32, Z0 + 0.375); box('cab', 0.05, 0.36, 0.05, xm, 1.12, Z0 + 0.3); box('cab', 0.24, 0.02, 0.16, xm, 0.95, Z0 + 0.3); }
  // ceiling lights
  for (const x of [-2.2, 2.2]) for (const z of [-2.8, 0.6]) box('lamp', 1.4, 0.03, 0.4, x, H - 0.03, z);
  const mats = {
    floor: new THREE.MeshLambertMaterial({ color: th.floor }), wall: new THREE.MeshLambertMaterial({ color: th.wall }), trim: new THREE.MeshLambertMaterial({ color: th.trim }),
    top: new THREE.MeshLambertMaterial({ color: th.top }), cab: new THREE.MeshLambertMaterial({ color: th.cab }), accent: new THREE.MeshBasicMaterial({ color: th.accent }),
    glass: new THREE.MeshLambertMaterial({ color: th.glass, transparent: true, opacity: 0.45, depthWrite: false }), prop: new THREE.MeshLambertMaterial({ color: th.prop }),
    screen: new THREE.MeshBasicMaterial({ color: th.screen }), lamp: new THREE.MeshBasicMaterial({ color: th.lamp }),
  };
  for (const k in parts) { const m = new THREE.Mesh(mergeGeometries(parts[k]), mats[k]); parts[k].forEach((g) => g.dispose()); grp.add(m); }
  const grid = new THREE.GridHelper(8.6, 43, th.grid[0], th.grid[1]); grid.position.set(0, 0.002, ZC); grp.add(grid);
  // the sky outside the windows: one texture, one plane per window just outside the wall
  const sky = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.6, th.sky[1]); gr.addColorStop(1, th.sky[2]); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (th.stars) { g.fillStyle = '#ffffff'; for (let k = 0; k < 70; k++) { g.globalAlpha = 0.3 + 0.7 * rnd(); g.fillRect(rnd() * w, rnd() * h * 0.7, 1.5, 1.5); } g.globalAlpha = 1; }
    else { g.fillStyle = 'rgba(255,255,255,0.75)'; for (let k = 0; k < 5; k++) { const cx = rnd() * w, cy = 40 + rnd() * 90; for (let j = 0; j < 6; j++) { g.beginPath(); g.ellipse(cx + j * 14 - 35, cy + (j % 2) * 6, 22, 11, 0, 0, 6.28); g.fill(); } } }
  });
  const skyMat = new THREE.MeshBasicMaterial({ map: sky, fog: false });
  const win = (w, x, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, winY1 - winY0), skyMat); p.position.set(x, (winY0 + winY1) / 2, z); p.rotation.y = ry; grp.add(p); };
  backWins.forEach(([c, w]) => win(w, c, Z0 - 0.08, 0)); sideWins.forEach(([c, w]) => { win(w, X0 - 0.08, c, Math.PI / 2); win(w, X1 + 0.08, c, -Math.PI / 2); });
  // title sign above the middle window
  const sign = canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = th.sign[0]; g.fillRect(0, 0, w, h);
    g.fillStyle = th.sign[1]; g.font = '700 78px system-ui,sans-serif'; g.textBaseline = 'middle'; g.fillText('MD LAB', 36, 70);
    g.fillStyle = th.sign[2]; g.font = '32px system-ui,sans-serif'; g.fillText('Molecular dynamics in virtual reality  ·  DEX · 2DPHYS · DTU', 40, 148);
  });
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.49), new THREE.MeshBasicMaterial({ map: sign })); sg.position.set(0, 2.75, Z0 + 0.06); grp.add(sg);
  return grp;
}
function disposeTree(o) { o.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); }

/* ---------- the experiment table: its height follows the user (seated or standing) ---------- */
const desk = new THREE.Group(); bench.add(desk);
const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.8), new THREE.MeshLambertMaterial({ color: 0x1c2640 }));
const legM = new THREE.MeshLambertMaterial({ color: 0x141b2e }), legs = [];
for (const sx of [-0.64, 0.64]) for (const sz of [-1.34, -0.66]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), legM); l.position.set(sx, 0, sz); legs.push(l); desk.add(l); }
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.008, 8, 96), new THREE.MeshBasicMaterial({ color: 0x4ae3e1 })); ring.rotation.x = Math.PI / 2;
const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 64), new THREE.MeshBasicMaterial({ color: 0x4ae3e1, transparent: true, opacity: 0.07 })); disc.rotation.x = -Math.PI / 2;
desk.add(deskTop); desk.add(ring); desk.add(disc);

/* ---------- simulation objects ---------- */
const simRoot = new THREE.Group(); scene.add(simRoot);           // placed in the world, scaled: world metres per sigma
const tilt = new THREE.Group(); simRoot.add(tilt);                // lays 2D sheets flat on the bench (sim z -> up)
const inner = new THREE.Group(); tilt.add(inner);             // box coordinates [0,L]^3 -> centred
const SIM_HOME = new THREE.Vector3(0, 1.33, -1.0);               // in bench coordinates (its height follows the table)
simRoot.position.copy(SIM_HOME);
function setTableHeight(h, moveSim = true) {
  h = clamp(h, 0.5, 1.2); const dh = h - S.tableH; S.tableH = h;
  deskTop.position.set(0, h, -1.0); for (const l of legs) { l.scale.y = h - 0.025; l.position.y = (h - 0.025) / 2; }
  ring.position.set(0, h + 0.03, -1.0); disc.position.set(0, h + 0.029, -1.0); rim.position.set(0, h + 1.0, -1.0);
  SIM_HOME.y = h + 0.43;
  if (moveSim && dh) { simRoot.position.y += dh; if (!S.vr) { controls.target.y += dh; camera.position.y += dh; } }
}
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
  S.lastBuild = Object.assign({}, recipe); clearContacts();
  if (recipe.sys === 'mat') return buildMat(recipe, opts);
  md = lj; S.el = recipe.el; U = ljUnits(S.el); if (S.dt > 0.02 || S.dt < 0.001) S.dt = 0.004;
  md.periodic = S.periodic; md.dt = S.dt;
  const Ts = U.Tstar(recipe.T0);
  try {
    if (recipe.start === 'fcc') md.buildFCC(recipe.cells, recipe.rho, Ts); else md.buildGas(4 * recipe.cells ** 3, recipe.rho, Ts);
  } catch (e) { toast(String(e.message || e)); return; }
  md.thermostat = S.thermo; md.Ttarget = U.Tstar(S.TsetK);
  wps = clamp(0.5 / md.L, 0.03, 0.12);
  S.paused = false; if (S.color === 'el' && !opts.keepColor) S.color = 'speed';
  resetHistory(); retag();
  if (!opts.quiet) toast(`Built ${md.N} ${ELEMENTS[S.el].name.toLowerCase()} atoms in a ${U.nm(md.L).toFixed(2)} nm box`);
}

function buildMat(r, opts) {
  const T0 = r.Tm, n = Math.round(r.size), ny = Math.max(2, Math.round(n / 1.73));
  try {
    if (r.mat === 'benzene') mat.buildBenzene(Math.round(r.nmol), T0);
    else if (r.mat === 'graphene') mat.buildGraphene(n, ny, T0, 1, false, !!r.open);
    else if (r.mat === 'graphite') mat.buildGraphite(n, ny, Math.round(r.layers), T0, !!r.open);
    else if (r.mat === 'mos2') mat.buildMoS2(n, ny, Math.round(r.layers), T0, !!r.open);
    else mat.buildNanodiamond(r.rad, T0);
  } catch (e) { toast(String(e.message || e)); return; }
  md = mat; U = matUnits(); S.el = r.mat;
  S.TsetK = T0; S.thermo = true; mat.thermostat = true; mat.Ttarget = T0; S.dtFs = mat.dt * TU_FS;
  if (S.color === 'speed' && !opts.keepColor) S.color = 'el';
  S.tool = S.tool === 'add' && r.mat === 'benzene' ? 'tweezers' : S.tool;
  S.grab = (r.mat === 'graphite' || r.mat === 'mos2' || r.mat === 'benzene') ? 'group' : 'atom';
  S.addSp = r.mat === 'mos2' ? 3 : 0;
  // metres per angstrom so that the object is about half a metre across
  let ext;
  if (mat.periodicAny) ext = Math.max(mat.Lx, mat.Ly);
  else { let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < mat.N; i++) { lo[0] = Math.min(lo[0], mat.x[i]); hi[0] = Math.max(hi[0], mat.x[i]); lo[1] = Math.min(lo[1], mat.y[i]); hi[1] = Math.max(hi[1], mat.y[i]); lo[2] = Math.min(lo[2], mat.z[i]); hi[2] = Math.max(hi[2], mat.z[i]); } ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 5; }
  wps = clamp(0.45 / ext, 0.006, 0.14);
  S.paused = false; resetHistory(); retag();
  if (!opts.quiet) toast(`Built ${mat.name}: ${mat.N} atoms`);
}

function equilibrate(steps, TsetK) {
  const th = md.thermostat; md.thermostat = true; md.Ttarget = U.Tstar(TsetK);
  md.run(steps); md.thermostat = th;
}

function addRandom(k) {
  if (isMat()) { toast('Use the Add tool to place atoms in a material'); return; }
  let ok = 0;
  for (let i = 0; i < k; i++) if (md.addAtom(Math.random() * md.L, Math.random() * md.L, Math.random() * md.L) >= 0) ok++;
  if (ok < k) toast(ok ? `Only room for ${ok} more atoms` : 'The box is full - expand it first');
  if (S.tag < 0 && md.N) retag();
  H.my.length = 0; H.mt.length = 0; md.mark();
}
function removeAtomAt(i) {
  const last = md.N - 1, n0 = md.N; md.removeAtom(i);
  if (md.N === n0) return;                                       // not removable (molecules)
  if (S.tag === i) retag(); else if (S.tag === last) S.tag = i;
  for (const s of [S.cm, S.cp]) { s.delete(i); if (s.delete(last)) s.add(i); }   // removeAtom moved the last atom into slot i
  contactsChanged();
}
function removeRandom(k) { for (let i = 0; i < k && md.N > 2; i++) removeAtomAt(Math.floor(Math.random() * md.N)); }

function applyTask(t) {
  Object.assign(B, { sys: 'lj' }, t.setup.build);
  S.TsetK = t.setup.TsetK; S.thermo = true; S.dt = t.setup.dt || 0.004; S.periodic = t.setup.periodic !== false;
  S.color = t.setup.color || (B.sys === 'mat' ? 'el' : 'speed'); S.speed = t.setup.speed || 10;
  build(B, { quiet: true, keepColor: true });
  if (B.sys === 'mat') { S.TsetK = t.setup.TsetK; md.Ttarget = S.TsetK; if (t.setup.dtFs) S.dtFs = t.setup.dtFs; }
  if (t.setup.equil) for (const [steps, K] of t.setup.equil) equilibrate(steps, K);
  if (t.setup.thermo === false) S.thermo = false;
  if (t.setup.bias !== undefined) S.bias = t.setup.bias;
  if (t.setup.contacts === 'ends') contactsAtEnds();
  else if (Array.isArray(t.setup.contacts)) { clearContacts(); t.setup.contacts[0].forEach((i) => S.cm.add(i)); t.setup.contacts[1].forEach((i) => S.cp.add(i)); contactsChanged(); }
  if (t.setup.tab === 'ELEC') S.tab = TAB_ELEC;
  S.paused = false; resetHistory(); md.mark(); md.resetRDF();
  toast('Loaded: ' + t.title);
}

/* ================================================================== sampling / analysis */
function sample() {
  const N = md.N; if (!N) return;
  const ke = U.eV(md.KE / N) * 1000, pe = U.eV(md.PE / N) * 1000;
  H.t.push(U.ps(md.time)); H.T.push(U.K(md.temperature())); H.ke.push(ke); H.pe.push(pe); H.e.push(ke + pe); H.P.push(U.bar(md.pressure()));
  const tm = md.time - md.markTime;
  H.mt.push(U.ps(tm)); H.my.push(U.msdnm2(md.msd()));
  if (H.t.length > 320) for (const k of ['t', 'T', 'ke', 'pe', 'e', 'P']) H[k].shift();
  // MSD window: restart every ~6 reduced time units, keep the last window as a ghost and estimate D from it
  if (tm >= (isMat() ? 400 : 6)) {
    S.D = md.msd() / (6 * tm);
    H.pt = H.mt.slice(); H.py = H.my.slice(); H.mt.length = 0; H.my.length = 0; md.mark();
  }
}

function phaseGuess() {
  if (!md.N) return ['empty box', COL.muted];
  if (isMat()) return [md.name, COL.accent];
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
const KBT = 8.617333262e-5;                                      // eV/K: converts K to eV for the speed colour scale
function ramp(t, out) {                 // blue -> cyan -> yellow -> red
  t = clamp(t, 0, 1);
  if (t < 0.35) { const f = t / 0.35; out[0] = 0.10 + 0.0 * f; out[1] = 0.25 + 0.55 * f; out[2] = 0.95 - 0.05 * f; }
  else if (t < 0.65) { const f = (t - 0.35) / 0.3; out[0] = 0.1 + 0.9 * f; out[1] = 0.8 + 0.1 * f; out[2] = 0.9 - 0.7 * f; }
  else { const f = (t - 0.65) / 0.35; out[0] = 1; out[1] = 0.9 - 0.7 * f; out[2] = 0.2 - 0.1 * f; }
}
const rgb = [0, 0, 0];
// coordination colouring for materials: blue = the ideal number of bonds, red = defect / surface
const idealZ = (i) => { const q = mat.sp[i]; return q === 1 ? 1 : q === 2 ? 6 : q === 3 ? 3 : (mat.model === 'tersoff' && mat.tp === TERSOFF.diamond ? 4 : 3); };
const spCol = SPECIES.map((s) => new THREE.Color(s.color));
const BMAX = 7000;
const bondsMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30, specular: 0x333344 }), BMAX);
bondsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bondsMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BMAX * 3), 3); bondsMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
bondsMesh.frustumCulled = false; bondsMesh.count = 0; inner.add(bondsMesh);
function updateBonds() {
  if (!isMat() || !S.bonds) { bondsMesh.count = 0; return; }
  const m = bondsMesh.instanceMatrix.array, c = bondsMesh.instanceColor.array, per = mat.per, Lx = mat.Lx, Ly = mat.Ly, Lz = mat.Lz; let n = 0;
  const BR = showingCurrents() ? 0.06 : 0.115;
  for (let p = 0; p < mat.nb && n < BMAX - 1; p++) {
    const i = mat.bi[p], j = mat.bj[p], lim = mat.bondLimit(i, j); if (lim === 0) continue;
    let dx = mat.x[j] - mat.x[i], dy = mat.y[j] - mat.y[i], dz = mat.z[j] - mat.z[i];
    if (per[0]) dx -= Lx * Math.round(dx / Lx); if (per[1]) dy -= Ly * Math.round(dy / Ly); if (per[2]) dz -= Lz * Math.round(dz / Lz);
    const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= lim * lim) continue;
    const r = Math.sqrt(r2), ux = dx / r, uy = dy / r, uz = dz / r;
    let hx = 0, hy = 1, hz = 0; if (Math.abs(uy) > 0.9) { hx = 1; hy = 0; }
    let xx = uy * hz - uz * hy, xy = uz * hx - ux * hz, xz = ux * hy - uy * hx; const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
    const zx = xy * uz - xz * uy, zy = xz * ux - xx * uz, zz = xx * uy - xy * ux;     // Z = X x u
    for (let h = 0; h < 2; h++) {
      const a = h ? j : i, sg = h ? -1 : 1, k = 16 * n;
      m[k] = xx * BR; m[k + 1] = xy * BR; m[k + 2] = xz * BR; m[k + 3] = 0;
      m[k + 4] = sg * ux * r * 0.5; m[k + 5] = sg * uy * r * 0.5; m[k + 6] = sg * uz * r * 0.5; m[k + 7] = 0;
      m[k + 8] = sg * zx * BR; m[k + 9] = sg * zy * BR; m[k + 10] = sg * zz * BR; m[k + 11] = 0;
      m[k + 12] = mat.x[a] + sg * ux * r * 0.25; m[k + 13] = mat.y[a] + sg * uy * r * 0.25; m[k + 14] = mat.z[a] + sg * uz * r * 0.25; m[k + 15] = 1;
      const q = S.color === 'el' ? spCol[mat.sp[a]] : null;
      c[3 * n] = q ? q.r * 0.75 : 0.1; c[3 * n + 1] = q ? q.g * 0.75 : 0.1; c[3 * n + 2] = q ? q.b * 0.75 : 0.12; n++;
    }
  }
  bondsMesh.count = n; bondsMesh.instanceMatrix.needsUpdate = true; bondsMesh.instanceColor.needsUpdate = true;
}

/* ---------- electron transport: contacts, worker, current arrows ---------- */
const cMinus = new THREE.Color(), cPlus = new THREE.Color();
const ARR_MAX = 6000;
const arrows = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 10, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), ARR_MAX);   // unlit: readable from any side
arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage); arrows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ARR_MAX * 3), 3); arrows.instanceColor.setUsage(THREE.DynamicDrawUsage);
arrows.frustumCulled = false; arrows.count = 0; inner.add(arrows);
const TR = { worker: null, busy: false, pendingCurve: false, pendingLive: false, res: null, curve: null, id: 0, last: 0, err: '', Jmax: 0, curveKey: '' };
try { TR.worker = new Worker(URL.createObjectURL(new Blob([window.__TB_WORKER || ''], { type: 'text/javascript' }))); TR.worker.onmessage = (e) => onTransport(e.data); TR.worker.onerror = () => { TR.worker = null; TR.busy = false; }; } catch (e) { TR.worker = null; }
const transportOK = () => isMat() && (mat.model === 'tersoff' || mat.model === 'ff');
// while currents are drawn, atoms and bonds are drawn thinner so the arrows between them can be seen
const showingCurrents = () => S.arrows && isMat() && !!TR.res && TR.res.N === mat.N && TR.Jmax > 0;
function clearContacts() { S.cm.clear(); S.cp.clear(); TR.res = null; TR.curve = null; TR.err = ''; arrows.count = 0; }
function contactsChanged() { TR.curve = null; requestTransport(true); }
function contactsAtEnds(w = 2.3) {                          // electrodes on the two ends of the sheet (along x)
  clearContacts(); if (!isMat()) return;
  let lo = 1e9, hi = -1e9; for (let i = 0; i < mat.N; i++) if (mat.sp[i] === 0 || mat.model === 'tersoff') { lo = Math.min(lo, mat.x[i]); hi = Math.max(hi, mat.x[i]); }
  for (let i = 0; i < mat.N; i++) { if (mat.sp[i] !== 0) continue; if (mat.x[i] < lo + w) S.cm.add(i); else if (mat.x[i] > hi - w) S.cp.add(i); }
  contactsChanged();
}
function setContact(i, which, on) {
  const a = which === 'm' ? S.cm : S.cp, b = which === 'm' ? S.cp : S.cm;
  if (on) { if (a.has(i)) return; b.delete(i); a.add(i); } else { if (!a.has(i)) return; a.delete(i); }
  contactsChanged();
}
function requestTransport(curve) {
  if (curve) TR.pendingCurve = true; else TR.pendingLive = true;
  if (TR.busy) return;
  if (!transportOK() || !S.cm.size || !S.cp.size) { TR.pendingCurve = TR.pendingLive = false; TR.res = null; arrows.count = 0; TR.err = !isMat() ? 'Electron transport needs a material (carbon).' : !transportOK() ? 'MoS₂ needs a d-orbital model - not supported yet. Use graphene, graphite or benzene.' : 'Mark at least one − and one + contact.'; return; }
  const wantCurve = TR.pendingCurve; TR.pendingCurve = TR.pendingLive = false;
  const N = mat.N, orb = new Uint8Array(N); for (let i = 0; i < N; i++) orb[i] = mat.sp[i] === 0 ? 1 : 0;      // SP.C = 0
  const msg = { id: ++TR.id, N, x: mat.x.slice(0, N), y: mat.y.slice(0, N), z: mat.z.slice(0, N), orb, per: mat.per.slice(), L: [mat.Lx, mat.Ly, mat.Lz],
    cm: [...S.cm], cp: [...S.cp], opts: { gamma: S.gamma, V: S.bias, kT: 0.02585, curve: wantCurve, nE: 801, Vmax: Math.max(2, Math.ceil(S.bias)), nV: 81 } };
  TR.last = now();
  if (TR.worker) { TR.busy = true; TR.worker.postMessage(msg, [msg.x.buffer, msg.y.buffer, msg.z.buffer]); }
  else {                                                    // no worker (very old browser): compute here, live part only
    const sys = { N, x: msg.x, y: msg.y, z: msg.z, per: msg.per, L: msg.L, orb: (i) => orb[i] === 1 };
    const r = analyseNow(sys, msg.cm, msg.cp, Object.assign({}, msg.opts, { curve: false })); r.id = msg.id; r.curve = false; r.N = N; onTransport(r);
  }
}
function onTransport(r) {
  TR.busy = false;
  if (r.error) { TR.err = r.error; TR.res = null; arrows.count = 0; }
  else {
    TR.err = ''; TR.res = r; let jm = 0; for (let p = 0; p < r.J.length; p++) jm = Math.max(jm, Math.abs(r.J[p])); TR.Jmax = jm;
    if (r.curve) { TR.curve = r; TR.curveAt = now(); }
  }
  lastPlot = 0; ui.dirty = true;
  if (TR.pendingCurve || TR.pendingLive) requestTransport(TR.pendingCurve);
}
function updateArrows() {
  const r = TR.res;
  if (!S.arrows || !r || !isMat() || r.N !== mat.N || !TR.Jmax) { arrows.count = 0; return; }
  const m = arrows.instanceMatrix.array, c = arrows.instanceColor.array, P = r.pairs, J = r.J, per = mat.per, Lx = mat.Lx, Ly = mat.Ly, Lz = mat.Lz; let n = 0;
  for (let p = 0; p < J.length && n < ARR_MAX; p++) {
    const f = Math.abs(J[p]) / TR.Jmax; if (f < 0.04) continue;
    // electron flow a -> b for J > 0; draw conventional current (opposite), from + towards -
    let a = P[2 * p], b = P[2 * p + 1]; if (J[p] > 0) { const t = a; a = b; b = t; }
    let dx = mat.x[b] - mat.x[a], dy = mat.y[b] - mat.y[a], dz = mat.z[b] - mat.z[a];
    if (per[0]) dx -= Lx * Math.round(dx / Lx); if (per[1]) dy -= Ly * Math.round(dy / Ly); if (per[2]) dz -= Lz * Math.round(dz / Lz);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-6 || d > 2.0) continue;      // arrows on bonds only
    const ux = dx / d, uy = dy / d, uz = dz / d, sq = Math.sqrt(f), R = 0.1 + 0.2 * sq, Lh = 0.45 + 0.5 * sq;
    let hx = 0, hy = 0, hz = 1; if (Math.abs(uz) > 0.9) { hx = 1; hz = 0; }
    let xx = uy * hz - uz * hy, xy = uz * hx - ux * hz, xz = ux * hy - uy * hx; const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
    const zx = xy * uz - xz * uy, zy = xz * ux - xx * uz, zz = xx * uy - xy * ux;
    const k = 16 * n;
    m[k] = xx * R; m[k + 1] = xy * R; m[k + 2] = xz * R; m[k + 3] = 0;
    m[k + 4] = ux * Lh; m[k + 5] = uy * Lh; m[k + 6] = uz * Lh; m[k + 7] = 0;
    m[k + 8] = zx * R; m[k + 9] = zy * R; m[k + 10] = zz * R; m[k + 11] = 0;
    m[k + 12] = mat.x[a] + dx / 2; m[k + 13] = mat.y[a] + dy / 2; m[k + 14] = mat.z[a] + dz / 2 + 0; m[k + 15] = 1;
    ramp(0.2 + 0.8 * f, rgb); c[3 * n] = rgb[0]; c[3 * n + 1] = rgb[1]; c[3 * n + 2] = rgb[2]; n++;
  }
  arrows.count = n; arrows.instanceMatrix.needsUpdate = true; arrows.instanceColor.needsUpdate = true;
}

function updateAtoms() {
  const N = md.N, m = atoms.instanceMatrix.array, c = atoms.instanceColor.array, mt = isMat(), shrink = showingCurrents() ? 0.5 : 1;
  atoms.count = N;
  const T = Math.max(mt ? md.temperature() * KBT : md.temperature(), 0.03);
  const base = mt ? null : col.set(ELEMENTS[S.el].color);
  for (let i = 0; i < N; i++) {
    const k = 16 * i, R0 = (mt ? SPECIES[md.sp[i]].r : 0.47) * shrink, s = i === S.tag ? R0 * 1.35 : R0;
    m[k] = m[k + 5] = m[k + 10] = s; m[k + 12] = md.x[i]; m[k + 13] = md.y[i]; m[k + 14] = md.z[i];
    if (mt && (S.cm.has(i) || S.cp.has(i))) {                       // electrodes: blue = "-" contact, red = "+" contact
      const q = S.cm.has(i) ? cMinus : cPlus; m[k] = m[k + 5] = m[k + 10] = s * 1.25; c[3 * i] = q.r; c[3 * i + 1] = q.g; c[3 * i + 2] = q.b; continue;
    }
    if (i === S.tag) { rgb[0] = 1; rgb[1] = 0.95; rgb[2] = 0.55; }
    else if (S.color === 'speed') { const ke = mt ? 0.5 * md.mass[i] * (md.vx[i] ** 2 + md.vy[i] ** 2 + md.vz[i] ** 2) : 0.5 * (md.vx[i] ** 2 + md.vy[i] ** 2 + md.vz[i] ** 2); ramp(ke / (T * 4), rgb); }
    else if (S.color === 'coord') ramp(mt ? clamp(Math.abs(idealZ(i) - md.z_[i]) / 2, 0, 1) : 1 - clamp((md.z_[i] - 3) / 9, 0, 1), rgb);
    else if (mt) { const q = spCol[md.sp[i]]; c[3 * i] = q.r; c[3 * i + 1] = q.g; c[3 * i + 2] = q.b; continue; }
    else { rgb[0] = Math.sqrt(base.r); rgb[1] = Math.sqrt(base.g); rgb[2] = Math.sqrt(base.b); }
    c[3 * i] = rgb[0] * rgb[0]; c[3 * i + 1] = rgb[1] * rgb[1]; c[3 * i + 2] = rgb[2] * rgb[2];
  }
  atoms.instanceMatrix.needsUpdate = true; atoms.instanceColor.needsUpdate = true;
  updateBonds(); updateArrows();

  const [Lx, Ly, Lz] = dims();
  inner.position.set(-Lx / 2, -Ly / 2, -Lz / 2);
  boxEdges.scale.set(Lx, Ly, Lz); boxEdges.position.set(Lx / 2, Ly / 2, Lz / 2);
  boxFaces.scale.set(Lx, Ly, Lz); boxFaces.position.set(Lx / 2, Ly / 2, Lz / 2);
  const showBox = !mt || mat.periodicAny;
  boxEdges.visible = showBox; boxFaces.visible = showBox && !mt && !md.periodic;
  boxEdges.material.opacity = (mt || md.periodic) ? 0.5 : 0.95;
  simRoot.scale.setScalar((mt ? wps : Math.min(wps, 0.85 / Lx)) * userScale);
  tilt.rotation.x = (mt && mat.sheet) ? -Math.PI / 2 : 0;

  // trail of the tagged atom (unwrapped)
  if (S.trail && S.tag >= 0 && S.tag < N) {
    const i = S.tag, per = perAxis(); let dx = md.x[i] - trailLast.x, dy = md.y[i] - trailLast.y, dz = md.z[i] - trailLast.z;
    if (per[0]) dx -= Lx * Math.round(dx / Lx); if (per[1]) dy -= Ly * Math.round(dy / Ly); if (per[2]) dz -= Lz * Math.round(dz / Lz);
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
    tweezLine.visible = true; tweezDot.visible = true; tweezDot.position.set(e.x, e.y, e.z); tweezDot.scale.setScalar(mt ? 3 : 1);
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
function placePanels(y) {                 // either side of the table (it spans x = -0.7..0.7), angled towards the user
  uiMesh.position.set(-1.13, y, -0.8); uiMesh.rotation.set(0, 0.72, 0);
  plotMesh.position.set(1.18, y - 0.02, -0.82); plotMesh.rotation.set(0, -0.72, 0);
}
placePanels(1.32);
uiMesh.visible = plotMesh.visible = false;
bench.add(uiMesh); bench.add(plotMesh);
uiMesh.userData.ui = true;

function drawControls() {
  const mt = isMat(), T = U.K(md.temperature());
  ui.begin();
  ui.header('MD LAB', md.N ? (mt ? `${md.name} \u00B7 ${md.N} atoms` : `${S.el} \u00B7 ${md.N} atoms \u00B7 box ${U.nm(md.L).toFixed(2)} nm`) : 'empty box');
  const Pb = U.bar(md.pressure());
  ui.row(2); ui.readout('Temperature', T.toFixed(mt ? 0 : 1) + ' K', { color: COL.accent }); ui.readout('Target', S.thermo ? S.TsetK.toFixed(0) + ' K' : 'off (NVE)', { color: S.thermo ? COL.warn : COL.muted });
  if (mt) { ui.row(2); ui.readout('Pressure', 'n/a'); ui.readout('Atoms', String(md.N)); }
  else { ui.row(2); ui.readout('Pressure', fmtP(Pb)); ui.readout('Density \u03C1*', md.density.toFixed(3)); }
  const eAtom = U.eV((md.KE + md.PE) / Math.max(1, md.N));
  ui.row(2); ui.readout('Energy / atom', mt ? eAtom.toFixed(3) + ' eV' : (eAtom * 1000).toFixed(1) + ' meV'); ui.readout(mt ? 'Mean bonds' : 'Coordination Z', md.meanCoord().toFixed(1));
  const [ph, pc] = phaseGuess();
  ui.row(2); ui.readout(mt ? 'System' : 'Looks like', ph, { color: pc }); ui.readout('Speed', `${(U.ps(md.dt) * S.sps).toFixed(mt ? 2 : 1)} ps/s`, {});
  if (md.exploded) { ui.label('\u26A0 The simulation blew up - the time step was too large. Press Rebuild.', { color: COL.bad, size: 20, bold: true }); }
  ui.space(2);
  S.tab = ui.tabs(TABS, S.tab);
  ui.space(2);
  [tabBuild, tabRun, tabData, tabLab, tabElec, tabVR][S.tab]();
  // footer
  const c = ui.ctx;
  c.fillStyle = COL.card; c.fillRect(ui.pad, CH - 56, CW - 2 * ui.pad, 36);
  c.font = '20px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  const msgOn = now() < S.msgUntil;
  c.fillStyle = msgOn ? COL.warn : COL.muted;
  const fN = md.ext.i >= 0 ? (isMat() ? md.extForceEV * 1.602177 : md.extForce * 60 * (U.eps / U.sigma) * 1e9) : 0;
  c.fillText(msgOn ? S.msg : fN > 0 ? `Tweezer force: ${fN.toFixed(fN < 10 ? 2 : 1)} nN` : toolHint(), ui.pad + 12, CH - 38);
  ui.end();
}

function toolHint() {
  const t = S.tool;
  const trig = S.vr ? 'trigger' : 'click';
  if (t === 'cminus' || t === 'cplus') return `Tool: ${t === 'cminus' ? '\u2212' : '+'} CONTACT - ${trig} (or drag over) atoms; again to remove`;
  return t === 'tweezers' ? `Tool: TWEEZERS - hold ${trig} on an atom and drag` : t === 'add' ? `Tool: ADD ATOM - ${trig} inside the box` : `Tool: DELETE - ${trig} an atom to remove it`;
}

function matSel() {
  const r1 = [['benzene', 'Benzene'], ['graphene', 'Graphene'], ['graphite', 'Graphite']], r2 = [['mos2', 'MoS\u2082'], ['nanodiamond', 'Nanodiamond']];
  const a = ui.choice(r1, B.mat, { h: 52 }), b = ui.choice(r2, B.mat, { h: 52 });
  const nv = a !== B.mat ? a : b !== B.mat ? b : B.mat;
  if (nv !== B.mat) { B.mat = nv; Object.assign(B, MAT_DEFAULTS[nv]); }
}

function tabBuild() {
  ui.section('System');
  B.sys = ui.choice([['lj', 'Noble gas (LJ)'], ['mat', 'Materials']], B.sys, { h: 52 });
  if (B.sys === 'lj') {
    ui.section('1  Atoms');
    B.el = ui.choice(Object.keys(ELEMENTS).map((k) => [k, k]), B.el);
    const e = ELEMENTS[B.el];
    ui.label(`${e.name}: \u03C3 = ${e.sigma} nm,  \u03B5/k = ${e.epsK} K,  m = ${e.mass} u`, { size: 19 });
    ui.section('2  Size and structure');
    B.cells = Math.round(ui.slider('cells', 'Lattice cells n', B.cells, 2, 7, (v) => `n = ${Math.round(v)}  \u2192  ${4 * Math.round(v) ** 3} atoms`, { step: 1, h: 64 }));
    B.start = ui.choice([['fcc', 'FCC crystal'], ['gas', 'Random gas']], B.start);
    const gcc = (B.rho * e.mass * 1.66053907e-27 / ((e.sigma * 1e-9) ** 3)) / 1000;
    B.rho = ui.slider('rho', 'Density \u03C1*', B.rho, 0.02, 1.3, (v) => `${v.toFixed(2)}  (${(v * gcc / B.rho).toFixed(2)} g/cm\u00B3)`, { log: true, h: 64 });
    B.rho = Math.round(B.rho * 100) / 100;
    B.T0 = ui.slider('T0', 'Start temperature', B.T0, 5, 500, (v) => `${v.toFixed(0)} K   (T* = ${(v / e.epsK).toFixed(2)})`, { step: 1, h: 64 });
    ui.space(4);
    ui.row(2);
    if (ui.button('BUILD SYSTEM', { primary: true, h: 62, size: 25 })) { S.TsetK = B.T0; build(B); }
    if (ui.button('Clear box', { h: 62 })) { md = lj; U = ljUnits(S.el); md.clear(); md.L = 6; resetHistory(); trailN = 0; trailGeo.setDrawRange(0, 0); S.tag = -1; toast('Box emptied - use the Add tool to place atoms'); }
    ui.section('3  Edit by hand');
    S.tool = ui.choice([['tweezers', 'Tweezers'], ['add', 'Add atom'], ['delete', 'Delete']], S.tool);
    ui.row(3);
    if (ui.button('+10 atoms')) addRandom(10);
    if (ui.button('\u221210 atoms')) removeRandom(10);
    if (ui.button('Tag atom')) { retag(); toast('New atom tagged (shown large, with a trail)'); }
  } else {
    ui.section('Structure');
    matSel();
    ui.label(MAT_INFO[B.mat], { size: 17 });
    if (B.mat === 'benzene') B.nmol = Math.round(ui.slider('nmol', 'Number of molecules', B.nmol, 1, 19, (v) => `${Math.round(v)}  (${12 * Math.round(v)} atoms)`, { step: 1, h: 64 }));
    else if (B.mat === 'nanodiamond') B.rad = ui.slider('rad', 'Cluster radius', B.rad, 4, 9, (v) => `${v.toFixed(1)} \u00C5   (diameter ${(0.2 * v).toFixed(1)} nm)`, { step: 0.5, h: 64 });
    else {
      const lo = B.mat === 'graphene' ? 3 : 7, hi = B.mat === 'graphene' ? 16 : 10;
      B.size = Math.round(ui.slider('size', 'Sheet size (unit cells along x)', clamp(B.size, lo, hi), lo, hi, (v) => `${Math.round(v)} cells  \u2248 ${(Math.round(v) * (B.mat === 'mos2' ? 0.312 : 0.249)).toFixed(1)} nm wide`, { step: 1, h: 64 }));
      if (B.mat === 'graphite') B.layers = Math.round(ui.slider('layers', 'Layers', clamp(B.layers, 2, 4), 2, 4, (v) => `${Math.round(v)} layers`, { step: 1, h: 64 }));
      if (B.mat === 'mos2') B.layers = Math.round(ui.slider('layers', 'Layers', clamp(B.layers, 1, 2), 1, 2, (v) => `${Math.round(v)} ${Math.round(v) === 1 ? 'layer' : 'layers (2H)'}`, { step: 1, h: 64 }));
      B.open = ui.choice([[false, 'Periodic sheet'], [true, 'Open flake (free edges)']], B.open, { h: 50, size: 21 });
    }
    B.Tm = ui.slider('Tm', 'Start temperature', B.Tm, 5, 2500, (v) => `${v.toFixed(0)} K`, { step: 5, h: 64 });
    ui.space(4);
    ui.row(2);
    if (ui.button('BUILD', { primary: true, h: 62, size: 25 })) build(Object.assign({}, B, { sys: 'mat' }));
    if (ui.button('Reset view', { h: 62 })) { recenterSim(); }
    ui.section('Edit by hand');
    S.tool = ui.choice([['tweezers', 'Tweezers'], ['add', 'Add atom'], ['delete', 'Delete']], S.tool);
    if (isMat() && mat.model === 'sw') { ui.row(2); S.grab = ui.choice([['atom', 'Grab: atom'], ['group', 'Grab: layer']], S.grab, { h: 50 }); }
    else if (isMat()) { S.grab = ui.choice([['atom', 'Grab: atom'], ['group', mat.model === 'ff' ? 'Grab: molecule' : 'Grab: layer']], S.grab, { h: 50 }); }
    if (isMat() && mat.model === 'sw') S.addSp = ui.choice([[2, 'Add Mo'], [3, 'Add S']], S.addSp, { h: 50 });
  }
}

function recenterSim() { userScale = 1; if (S.vr) recenter(); else { simRoot.position.copy(SIM_HOME); simRoot.quaternion.identity(); controls.target.copy(SIM_HOME); camera.position.set(0.85, 1.75, 0.55); controls.update(); } }

function tabRun() {
  const mt = isMat();
  ui.row(3);
  if (ui.button(S.paused ? '\u25B6  Run' : '\u275A\u275A  Pause', { primary: !S.paused, active: S.paused, h: 62, size: 25 })) S.paused = !S.paused;
  if (ui.button('Step \u00D720', { h: 62 })) { S.paused = true; md.run(20); }
  if (ui.button('Rebuild', { h: 62, danger: md.exploded })) { if (S.lastBuild) { build(S.lastBuild, { keepColor: true }); } }
  ui.space(2);
  S.thermo = ui.toggle(S.thermo ? 'Thermostat ON  (constant T)' : 'Thermostat OFF  (energy conserved)', S.thermo);
  if (mt) S.TsetK = ui.slider('Tset', 'Target temperature', S.TsetK, 10, 3000, (v) => `${v.toFixed(0)} K`, { step: 10, h: 66 });
  else S.TsetK = ui.slider('Tset', 'Target temperature', S.TsetK, 3, 600, (v) => `${v.toFixed(0)} K  (T* ${(v / ELEMENTS[S.el].epsK).toFixed(2)})`, { step: 1, h: 66 });
  if (!mt) {
    const rho = md.density, nr = ui.slider('vol', 'Density \u03C1*  (squeeze / expand the box)', rho, 0.02, 1.4, (v) => `${v.toFixed(3)}   L = ${U.nm(Math.cbrt(md.N / v)).toFixed(2)} nm`, { log: true, h: 66 });
    if (nr !== rho && md.N) md.setBox(Math.cbrt(md.N / nr));
    S.periodic = ui.choice([[true, 'Periodic box'], [false, 'Hard walls']], S.periodic);
    if (S.periodic !== md.periodic) md.switchBoundary(S.periodic);
    S.dt = ui.slider('dt', 'Time step', S.dt, 0.001, 0.02, (v) => `${v.toFixed(3)}   (${U.fs(v).toFixed(1)} fs)`, { h: 66 });
    if (S.dt > 0.01) ui.label('Large steps: watch the total energy drift (DATA).', { color: COL.warn, size: 18 });
  } else {
    ui.label(mat.periodicAny ? 'Periodic in x and y (sheet); free surfaces along z.' : mat.sheet ? 'Open flake: free edges, no periodic images.' : 'Isolated cluster in vacuum.', { size: 19 });
    S.dtFs = ui.slider('dtfs', 'Time step', S.dtFs, 0.1, 3, (v) => `${v.toFixed(2)} fs`, { h: 66 });
    if (S.dtFs > (mat.model === 'ff' ? 1.0 : 2.0)) ui.label('Large steps: watch the total energy drift (DATA).', { color: COL.warn, size: 18 });
    if (mat.model === 'sw' && S.TsetK > 700) ui.label('\u26A0 This MoS\u2082 potential is unreliable above ~700 K (unphysical collapse).', { color: COL.warn, size: 18 });
  }
  S.speed = Math.round(ui.slider('speed', 'Simulation steps per frame (max)', S.speed, 1, 60, (v) => `${Math.round(v)}`, { step: 1, h: 66 }));
  ui.section('Look');
  S.color = ui.choice(mt ? [['el', 'Element'], ['speed', 'Speed'], ['coord', 'Defects']] : [['speed', 'Speed'], ['coord', 'Coordination'], ['el', 'Plain']], S.color);
  S.trail = ui.toggle('Trail of the tagged atom', S.trail, { h: 48 });
  if (mt) S.bonds = ui.toggle('Show bonds', S.bonds, { h: 48 });
}

function tabData() {
  ui.row(2);
  if (ui.button('Reset g(r)')) { md.resetRDF(); }
  if (ui.button('Restart MSD')) { md.mark(); H.mt.length = 0; H.my.length = 0; H.pt.length = 0; H.py.length = 0; S.D = null; }
  ui.row(2);
  if (ui.button('●  Record row', { primary: true })) recordRow();
  if (ui.button('Export CSV', { disabled: S.vr })) exportCSV();
  ui.section('Averages (last ~60 samples)');
  ui.row(2); ui.readout('⟨T⟩', mean(H.T, 60).toFixed(1) + ' K'); ui.readout('⟨P⟩', isMat() ? 'n/a' : fmtP(mean(H.P, 60)));
  ui.row(2); ui.readout('⟨KE⟩ / atom', mean(H.ke, 60).toFixed(1) + ' meV'); ui.readout('⟨PE⟩ / atom', mean(H.pe, 60).toFixed(1) + ' meV');
  const D = S.D === null ? null : U.D_m2s(S.D) * 1e9;
  ui.row(2); ui.readout('D (diffusion)', D === null ? '…' : D.toFixed(D < 0.1 ? 3 : 2) + ' ×10⁻⁹ m²/s'); ui.readout('Total E drift', H.e.length > 5 ? (H.e[H.e.length - 1] - H.e[0]).toFixed(2) + ' meV' : '…');
  ui.section('Recorded measurements');
  const c = ui.ctx; c.font = '600 19px ui-monospace,Consolas,monospace'; c.textAlign = 'left';
  const colsX = [0, 88, 165, 285, 400, 500];
  c.fillStyle = COL.accent; ['#', 'T/K', isMat() ? 'N' : 'ρ*', 'P/bar', 'U/meV', 'D/1e-9'].forEach((h, i) => c.fillText(h, ui.pad + colsX[i], ui.y + 10));
  ui.y += 28;
  c.fillStyle = COL.text;
  const rows = S.rows.slice(-9);
  rows.forEach((r, k) => {
    const vals = [String(S.rows.length - rows.length + k + 1), r.T.toFixed(1), (r.mat ? String(r.rho) : r.rho.toFixed(3)), r.mat ? '-' : r.P.toFixed(Math.abs(r.P) < 10 ? 2 : 0), r.U.toFixed(1), r.D === null ? '-' : r.D.toFixed(2)];
    vals.forEach((v, i) => c.fillText(v, ui.pad + colsX[i], ui.y + 10)); ui.y += 27;
  });
  if (!rows.length) ui.label('Press "Record row" to log T, ρ*, P, U and D.', { size: 19 });
}

function recordRow() {
  const T = mean(H.T, 20), P = mean(H.P, 20), Uu = mean(H.pe, 20);
  S.rows.push({ T, rho: isMat() ? md.N : md.density, mat: isMat(), P, U: Uu, D: S.D === null ? null : U.D_m2s(S.D) * 1e9 });
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

function tabElec() {
  ui.label('\u03C0-electron tight binding from the live geometry. Mark the electrodes:', { size: 19 });
  S.tool = ui.choice([['cminus', '\u2212 contact'], ['cplus', '+ contact'], ['tweezers', 'Tweezers']], S.tool, { h: 50 });
  ui.row(3);
  if (ui.button('Contacts at ends', { h: 50, size: 20 })) contactsAtEnds();
  if (ui.button('Clear contacts', { h: 50, size: 20 })) { clearContacts(); ui.dirty = true; }
  if (ui.button('T(E), I(V)', { h: 50, size: 20, primary: true })) requestTransport(true);
  ui.row(2); ui.readout('\u2212 contact atoms', String(S.cm.size), { color: COL.minus, h: 30 }); ui.readout('+ contact atoms', String(S.cp.size), { color: COL.plus, h: 30 });
  const g = ui.slider('gamma', 'Contact coupling \u0393', S.gamma, 0.05, 3, (v) => `${v.toFixed(2)} eV`, { log: true, h: 60 });
  const v = ui.slider('bias', 'Bias voltage', S.bias, 0.01, 6, (x) => `${x.toFixed(2)} V`, { h: 60 });
  if (g !== S.gamma || v !== S.bias) { S.gamma = g; S.bias = v; TR.dirtyAt = now(); }
  ui.row(3); S.arrows = ui.toggle('Arrows', S.arrows, { h: 46 }); S.live = ui.toggle('Live', S.live, { h: 46 }); S.Tlog = ui.toggle('Log T', S.Tlog, { h: 46 });
  ui.section('Result');
  const r = TR.res;
  if (TR.err) ui.paragraph(TR.err, { size: 20, color: COL.warn });
  else if (!r) ui.label(TR.busy ? 'computing\u2026' : '\u2026', { size: 20 });
  else {
    const cur = r.Ibias * 1e6, Ga = r.TEF * 77.48;
    ui.row(2); ui.readout('Current at bias', (cur < 0.01 ? cur.toExponential(1) : cur.toFixed(cur < 1 ? 3 : 2)) + ' \u00B5A', { color: COL.warn }); ui.readout('T(E_F)', r.TEF < 1e-3 ? r.TEF.toExponential(1) : r.TEF.toFixed(3));
    ui.row(2); ui.readout('Conductance', (Ga < 0.1 ? Ga.toExponential(1) : Ga.toFixed(2)) + ' \u00B5S'); ui.readout('HOMO\u2013LUMO', r.gapHL.toFixed(2) + ' eV');
    const cv = TR.curve; ui.row(2); ui.readout('Transport gap', cv ? (cv.gap > 0 ? cv.gap.toFixed(2) + ' eV' : 'none') : '\u2026'); ui.readout('Orbitals / time', `${r.n} / ${r.ms.toFixed(0)} ms`);
    if (mat.periodicAny) ui.paragraph('Periodic sheet: current can also run round the boundary. Rebuild as an Open flake for a clean device.', { size: 18, color: COL.warn });
  }
}

function tabVR() {
  ui.row(2);
  const th = ui.choice([['dark', 'Dark lab'], ['light', 'White lab']], S.theme, { h: 50, size: 21 }); if (th !== S.theme) applyTheme(th);
  const h = ui.slider('table', 'Table height', S.tableH, 0.5, 1.2, (x) => `${(x * 100).toFixed(0)} cm`, { step: 0.01, h: 62 });
  if (h !== S.tableH) setTableHeight(h);
  ui.row(2);
  if (ui.button('Fit table + panels to me', { h: 50, size: 20, disabled: !S.vr })) recenter();
  if (ui.button('Reset panels', { h: 50, size: 20 })) placePanels(S.vr ? uiMesh.position.y : 1.32);
  ui.row(3);
  if (ui.button('Snap turn', { h: 48, size: 20, active: S.snapTurn })) S.snapTurn = true;
  if (ui.button('Smooth turn', { h: 48, size: 20, active: !S.snapTurn })) S.snapTurn = false;
  S.vignette = ui.toggle('Vignette', S.vignette, { h: 48 });
  S.moveSpeed = ui.slider('mspeed', 'Walking speed (left stick)', S.moveSpeed, 0.3, 3, (x) => `${x.toFixed(1)} m/s`, { step: 0.1, h: 60 });
  ui.space(2);
  const p = VR_HELP[S.helpPage];
  ui.row(3);
  if (ui.button('◀ Prev', { disabled: S.helpPage === 0 })) S.helpPage = Math.max(0, S.helpPage - 1);
  ui.skip();
  if (ui.button('Next ▶', { disabled: S.helpPage === VR_HELP.length - 1 })) S.helpPage = Math.min(VR_HELP.length - 1, S.helpPage + 1);
  ui.ctx.fillStyle = COL.muted; ui.ctx.font = '20px system-ui'; ui.ctx.textAlign = 'center'; ui.ctx.fillText(`${S.helpPage + 1} / ${VR_HELP.length}`, CW / 2, ui.y - 35);
  ui.label(p.title, { size: 26, bold: true, color: COL.accent });
  p.lines.forEach((l) => ui.paragraph(l, { size: 20, color: COL.text }));
  ui.row(1);
  if (S.vr) { if (ui.button('Exit VR', { danger: true, h: 56 })) endVR(); }
  else if (ui.button(xrState.supported ? 'Enter VR' : 'VR not detected on this device', { primary: xrState.supported, h: 56, disabled: !xrState.supported })) enterVR();
}

function plotData() {
  const rr = [], gg = [], g = md.rdf(), dr = md.rdfMax / md.rdfBins, mt = isMat();
  if (mt) { for (let b = 0; b < g.length; b++) { rr.push((b + 0.5) * dr); gg.push(g[b]); } }
  else { const e = ELEMENTS[S.el]; for (let b = 0; b < g.length; b++) { const r = (b + 0.5) * dr; if (r > md.rcUsed) break; rr.push(r * e.sigma); gg.push(g[b]); } }
  return {
    t: H.t, T: H.T, ke: H.ke, pe: H.pe, e: H.e, Ttarget: S.thermo ? S.TsetK : (H.T.length ? H.T[H.T.length - 1] : S.TsetK),
    rdf: { r: rr, g: gg }, msd: { t: H.mt, y: H.my, tPrev: H.pt, yPrev: H.py },
    rdfTitle: mt ? 'Pair distances' : 'Radial distribution g(r)', rdfX: mt ? 'r (\u00C5)' : 'r (nm)', rdfY: mt ? 'pairs / atom / \u00C5' : 'g(r)', rdfRef: !mt, rdfMin: mt ? 0.4 : 3,
    Dtext: S.D === null ? '' : 'D \u2248 ' + (U.D_m2s(S.D) * 1e9).toFixed(3) + ' \u00D710\u207B\u2079 m\u00B2/s',
  };
}

/* ================================================================== DOM wiring (desktop) */
const dom = {
  ui: document.getElementById('uiWrap'), plots: document.getElementById('plotWrap'),
  vrBtn: document.getElementById('vrBtn'), plotBtn: document.getElementById('plotBtn'), panelBtn: document.getElementById('panelBtn'), themeBtn: document.getElementById('themeBtn'),
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
  const r = toLocal(o, d), R2 = isMat() ? 0.55 * 0.55 : 0.7 * 0.7; let best = -1, bt = 1e9;
  for (let i = 0; i < md.N; i++) {
    const px = md.x[i] - r.o.x, py = md.y[i] - r.o.y, pz = md.z[i] - r.o.z;
    const t = px * r.d.x + py * r.d.y + pz * r.d.z; if (t < 0) continue;
    const d2 = px * px + py * py + pz * pz - t * t;
    if (d2 < R2 && t < bt) { bt = t; best = i; }
  }
  return best < 0 ? null : { i: best, t: bt, s: r.s };
}
function rayBox(o, d) {
  const r = toLocal(o, d), DM = dims(); let t0 = 0, t1 = 1e9;
  for (const ax of ['x', 'y', 'z']) {
    const L = DM[ax === 'x' ? 0 : ax === 'y' ? 1 : 2], oo = r.o[ax], dd = r.d[ax];
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
  if (S.tool === 'cminus' || S.tool === 'cplus') {
    if (!isMat()) { toast('Contacts need a material: build graphene, graphite or benzene'); return false; }
    const p = pickAtom(o, d); if (!p) return false;
    const w = S.tool === 'cminus' ? 'm' : 'p', set = w === 'm' ? S.cm : S.cp;
    hold.src = src; hold.kind = 'ct'; hold.grab = { w, on: !set.has(p.i) };
    setContact(p.i, w, hold.grab.on); pulse(src, 0.4, 25); return true;
  }
  if (S.tool === 'tweezers') {
    const p = pickAtom(o, d); if (!p) return false;
    // the spring pulls a reference point (the atom, or the centre of mass of its layer / molecule) so nothing jumps on grab
    const w0 = o.clone().addScaledVector(d, p.t * p.s), r0 = toLocal(w0, d).o;
    const grp = isMat() && S.grab === 'group', ref = grp ? mat.groupCOM(p.i) : [md.x[p.i], md.y[p.i], md.z[p.i]];
    hold.src = src; hold.kind = 'tw'; hold.grab = { i: p.i, dist: p.t * p.s, off: [ref[0] - r0.x, ref[1] - r0.y, ref[2] - r0.z] };
    md.ext.i = p.i; md.ext.mode = grp ? 'group' : 'atom'; pulse(src, 0.5, 40); return true;
  }
  if (S.tool === 'add' || S.tool === 'delete') {
    hold.src = src; hold.kind = S.tool === 'add' ? 'add' : 'del'; hold.next = now() + 380;
    if (S.tool === 'add' ? doAdd(src, o, d) : doDel(src, o, d)) return true;
    hold.src = null; hold.kind = null; return false;
  }
  return false;
}
function doAdd(src, o, d) {
  let p = rayBox(o, d);
  if (!p) return false;
  if (isMat()) {                                    // put the new atom where it will bond: first point on the ray 1.5-2 A from an existing atom
    if (md.model === 'ff') { toast('Molecules are fixed - use the other materials to add atoms'); return true; }
    const r = toLocal(o, d); let found = null;
    for (let t = 0; t < 60 && !found; t += 0.3) {
      const X = r.o.x + r.d.x * t, Y = r.o.y + r.d.y * t, Z = r.o.z + r.d.z * t; let best = 1e9;
      for (let k = 0; k < md.N; k++) { const q = Math.hypot(md.x[k] - X, md.y[k] - Y, md.z[k] - Z); if (q < best) best = q; }
      if (best > 1.5 && best < 2.1) found = { x: X, y: Y, z: Z };
    }
    if (found) p = found;
  }
  const i = isMat() ? md.addAtom(p.x, p.y, p.z, S.addSp) : md.addAtom(p.x, p.y, p.z);
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
    const r = toLocal(w, d), DM = dims(), per = perAxis(), off = hold.grab.off || [0, 0, 0];
    const cl = (v, k) => per[k] || !isMat() ? clamp(v, 0, DM[k]) : clamp(v, -DM[k], 2 * DM[k]);
    md.ext.x = cl(r.o.x + off[0], 0); md.ext.y = cl(r.o.y + off[1], 1); md.ext.z = cl(r.o.z + off[2], 2); md.ext.i = hold.grab.i;
    if (hold.src !== 'mouse') pulse(hold.src, 0.08 + 0.5 * md.extForce, 30);
  } else if (hold.kind === 'ct' && hold.grab) {             // drag over atoms to paint (or erase) a contact
    const p = pickAtom(o, d); if (p) { const set = hold.grab.w === 'm' ? S.cm : S.cp; if (set.has(p.i) !== hold.grab.on) { setContact(p.i, hold.grab.w, hold.grab.on); pulse(hold.src, 0.25, 15); } }
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
  else if (e.key === '4') S.tool = 'cminus'; else if (e.key === '5') S.tool = 'cplus';
  else if (e.key === 't' || e.key === 'T') applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  else if (e.key === 'r' || e.key === 'R') { if (S.lastBuild) build(S.lastBuild); }
  else if (e.key === 'p' || e.key === 'P') dom.plotBtn.click();
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); if (!S.vr) renderer.setSize(window.innerWidth, window.innerHeight); });

/* ================================================================== WebXR */
const xrState = { supported: false };
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { xrState.supported = ok; dom.vrBtn.textContent = ok ? 'Enter VR' : 'VR not detected'; dom.vrBtn.classList.toggle('on', ok); }).catch(() => { dom.vrBtn.textContent = 'VR not detected'; });
} else dom.vrBtn.textContent = 'WebXR unavailable';
let vrStarting = false;
// Chrome exposes the WebXR Layers API, and three.js then renders through a projection layer. With the Quest via
// Meta Horizon Link that path delivers no frames at all (the headset waits, then reports "page not responding"),
// while the classic XRWebGLLayer path works. Hiding renderState.layers on our session makes three.js take that path.
function useBaseLayer(session) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(session), 'renderState');
  if (!desc || !desc.get) return;
  Object.defineProperty(session, 'renderState', { configurable: true, get() { const r = desc.get.call(session); return new Proxy(r, { get(t, k) { if (k === 'layers') return undefined; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }); } });
}
async function enterVR() {
  if (!navigator.xr) { S.tab = TAB_VR; return; }
  if (vrStarting || renderer.xr.getSession()) return;            // a second click must not ask for a second session
  vrStarting = true; dom.vrBtn.textContent = 'Starting VR\u2026';
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    useBaseLayer(session);
    await renderer.xr.setSession(session);
  } catch (e) { toast('Could not start VR: ' + (e.message || e)); S.tab = TAB_VR; }
  finally { vrStarting = false; dom.vrBtn.textContent = 'Enter VR'; }
}
function endVR() { const s = renderer.xr.getSession(); if (s) s.end(); }
dom.vrBtn.onclick = () => { if (xrState.supported) enterVR(); else { S.tab = TAB_VR; S.helpPage = 0; toast('No VR device found - see the VR tab for setup help', 6000); } };
dom.themeBtn.onclick = () => applyTheme(S.theme === 'dark' ? 'light' : 'dark');

/* ---------- seated movement: the left stick glides, the right stick turns (30 degree snaps or smooth) ----------
   The headset camera and both controllers ride on a "dolly"; moving or turning the dolly moves the user through the room.
   three.js composes the dolly with the tracked poses, so rays, grabs and recentring all keep working in world space. */
const LOCO = { snapArmed: true, active: 0 };
const UP = new THREE.Vector3(0, 1, 0), locoH = new THREE.Vector3();
function locoMove(wx, wz) { dolly.position.x += wx; dolly.position.z += wz; }
function locoTurn(a) {                                            // a > 0 turns left (counter-clockwise seen from above), about the head
  camera.getWorldPosition(locoH); locoH.y = 0;
  dolly.position.sub(locoH).applyAxisAngle(UP, a).add(locoH); dolly.rotation.y += a;
}
// comfort vignette: a dark ring round the edge of the view while gliding or turning smoothly
const vign = new THREE.Mesh(new THREE.RingGeometry(0.16, 1.2, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
vign.position.z = -0.25; vign.renderOrder = 9999; vign.visible = false; camera.add(vign);
function locomotion(vc, gp, dt) {
  const dz = 0.15, axv = (k) => { const v = gp.axes[k] || 0; return Math.abs(v) > dz ? (v - Math.sign(v) * dz) / (1 - dz) : 0; };
  const x = axv(2), y = axv(3);
  if (vc.hand === 'left' && !(hold.src === vc.i && hold.grab) && (x || y)) {
    const cam = camera, f = new THREE.Vector3(); cam.getWorldDirection(f); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x), s = S.moveSpeed * dt;          // r = f x up
    locoMove((f.x * -y + r.x * x) * s, (f.z * -y + r.z * x) * s); LOCO.active = 0.25;
  }
  if (vc.hand === 'right') {
    const xr = gp.axes[2] || 0;
    if (S.snapTurn) {
      if (Math.abs(xr) > 0.7 && LOCO.snapArmed) { locoTurn(-Math.sign(xr) * Math.PI / 6); LOCO.snapArmed = false; pulse(vc.i, 0.2, 15); }
      else if (Math.abs(xr) < 0.3) LOCO.snapArmed = true;
    } else if (Math.abs(xr) > 0.2) { locoTurn(-xr * dt * 1.6); LOCO.active = 0.25; }
  }
}

let needRecenter = false;
renderer.xr.addEventListener('sessionstart', () => {
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0);
  S.vr = true; needRecenter = true; document.body.classList.add('vr');
  uiMesh.visible = plotMesh.visible = true;
  S.xr = renderer.xr.getSession();
});
renderer.xr.addEventListener('sessionend', () => {
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); vign.visible = false;
  S.vr = false; document.body.classList.remove('vr'); uiMesh.visible = plotMesh.visible = false;
  bench.position.set(0, 0, 0); bench.rotation.set(0, 0, 0); simRoot.position.copy(SIM_HOME); simRoot.quaternion.identity(); userScale = 1;
  for (const vc of vrc) { vc.src = null; vc.obj.visible = false; vc.sq = null; vc.hit = null; toolUp(vc.i); }
  S.xr = null; renderer.setSize(window.innerWidth, window.innerHeight);
  setTableHeight(0.9, false); placePanels(1.32); simRoot.position.copy(SIM_HOME);
  camera.position.set(0.85, 1.75, 0.55); controls.target.copy(SIM_HOME); controls.update();
});

function recenter() {
  const cam = camera;                                   // the user camera rides on the dolly, so its world pose includes seated movement
  const p = new THREE.Vector3(), f = new THREE.Vector3();
  cam.getWorldPosition(p); cam.getWorldDirection(f); f.y = 0;
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  bench.rotation.set(0, Math.atan2(-f.x, -f.z), 0); bench.position.set(p.x, 0, p.z);
  // fit to this person, seated or standing: table half a metre below the eyes, panels just below eye level
  setTableHeight(clamp(p.y - 0.52, 0.55, 1.05), false); placePanels(clamp(p.y - 0.12, 0.85, 1.75));
  bench.updateMatrixWorld(true);
  simRoot.position.copy(SIM_HOME).applyMatrix4(bench.matrixWorld); simRoot.quaternion.copy(bench.quaternion); userScale = 1;
}

// controllers: simple geometry (no network needed)
const vrc = [0, 1].map((i) => {
  const obj = renderer.xr.getController(i); dolly.add(obj); obj.visible = false;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.1, 12), new THREE.MeshPhongMaterial({ color: 0x2a3a5c, emissive: 0x0a1020 }));
  body.rotation.x = Math.PI / 2; body.position.z = 0.04; obj.add(body);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0x4ae3e1 })); obj.add(tip);
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x4ae3e1, transparent: true, opacity: 0.8 }));
  laser.scale.z = 1.5; obj.add(laser);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); dot.visible = false; scene.add(dot);
  const vc = { i, obj, laser, dot, src: null, hit: null, hitObj: null, pg: null, uiHeld: false, sq: null, prev: [false, false, false], hand: '' };
  obj.addEventListener('connected', (e) => { vc.src = e.data; vc.hand = e.data.handedness; obj.visible = true; });
  obj.addEventListener('disconnected', () => { vc.src = null; obj.visible = false; });
  obj.addEventListener('selectstart', () => {
    if (vc.hit) { if (vc.hit.ui) { ui.press(i); vc.uiHeld = true; } return; }
    toolDown(i);
  });
  obj.addEventListener('selectend', () => { if (vc.uiHeld) { ui.release(i); vc.uiHeld = false; } toolUp(i); });
  obj.addEventListener('squeezestart', () => {
    if (vc.hitObj === uiMesh || vc.hitObj === plotMesh) { vc.obj.updateWorldMatrix(true, false); vc.hitObj.updateWorldMatrix(true, false); vc.pg = { mesh: vc.hitObj, rel: vc.obj.matrixWorld.clone().invert().multiply(vc.hitObj.matrixWorld) }; pulse(i, 0.3, 30); return; }
    vc.sq = true; regrab();
  });
  obj.addEventListener('squeezeend', () => { if (vc.pg) { vc.pg = null; return; } vc.sq = null; regrab(); });
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
const pgM = new THREE.Matrix4(), pgS = new THREE.Vector3();
function updatePanelGrabs() {
  for (const vc of vrc) if (vc.pg) {
    pgM.multiplyMatrices(vc.obj.matrixWorld, vc.pg.rel); pgM.premultiply(tmpM.copy(bench.matrixWorld).invert());
    pgM.decompose(vc.pg.mesh.position, vc.pg.mesh.quaternion, pgS);
  }
}
function updateGrab() {
  updatePanelGrabs();
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
    vc.hit = null; if (!vc.pg) vc.hitObj = null;
    if (!vc.src) continue;
    const o = new THREE.Vector3().setFromMatrixPosition(vc.obj.matrixWorld), d = new THREE.Vector3(0, 0, -1).transformDirection(vc.obj.matrixWorld);
    rc.set(o, d); rc.far = 3;
    const hits = rc.intersectObjects([uiMesh, plotMesh], false);
    let len = 1.5;
    if (hits.length) {
      const h = hits[0]; len = h.distance; if (!vc.pg) vc.hitObj = h.object;
      if (h.object === uiMesh) { vc.hit = { ui: true }; ui.move(h.uv.x * CW, (1 - h.uv.y) * CH, vc.i); } else vc.hit = { ui: false };
      vc.dot.visible = true; vc.dot.position.copy(h.point);
    } else { vc.dot.visible = false; ui.leave(vc.i); }
    vc.laser.scale.z = len;
    vc.laser.material.color.set(vc.hit ? 0xffffff : 0x4ae3e1);

    const gp = vc.src.gamepad;
    if (gp) {
      locomotion(vc, gp, dt);
      const ay = Math.abs(gp.axes[3] || 0) > 0.2 ? gp.axes[3] : 0;
      const btn = [!!(gp.buttons[4] && gp.buttons[4].pressed), !!(gp.buttons[5] && gp.buttons[5].pressed), !!(gp.buttons[3] && gp.buttons[3].pressed)];
      if (btn[0] && !vc.prev[0]) { S.tool = S.tool === 'tweezers' ? 'add' : S.tool === 'add' ? 'delete' : 'tweezers'; toast('Tool: ' + S.tool); }
      if (btn[1] && !vc.prev[1]) S.paused = !S.paused;
      if (btn[2] && !vc.prev[2]) recenter();
      vc.prev = btn;
      if (ay) {
        if (hold.src === vc.i && hold.grab) hold.grab.dist = clamp(hold.grab.dist - ay * dt * 0.9, 0.12, 3.5);
        else if (vc.hand === 'right') { if (S.thermo) S.TsetK = clamp(S.TsetK - ay * dt * (isMat() ? 250 : 45), isMat() ? 10 : 3, isMat() ? 3000 : 600); }
      }
    }
  }
  updateGrab();
  LOCO.active = Math.max(0, LOCO.active - dt);
  const vo = S.vignette && LOCO.active > 0 ? 0.62 : 0; vign.material.opacity += (vo - vign.material.opacity) * Math.min(1, dt * 10); vign.visible = vign.material.opacity > 0.01;
}

/* ================================================================== main loop */
let last = now(), lastUI = 0, lastPlot = 0;
function frame() {
  const t = now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (S.vr) vrInput(dt); else controls.update();
  toolUpdate();

  md.dt = isMat() ? S.dtFs / TU_FS : S.dt; md.thermostat = S.thermo; md.Ttarget = U.Tstar(S.TsetK);
  if (!S.paused && md.N && !md.exploded) {
    const budget = S.vr ? 4.5 : 9, t0 = now(); let n = 0;
    while (n < S.speed && now() - t0 < budget) { md.run(1); n++; }
    S.sps = S.sps * 0.9 + 0.1 * (n / Math.max(dt, 1e-3));
    const SI = isMat() ? 50 : 25; while (md.step - H.lastStep >= SI) { H.lastStep += SI; sample(); }
  } else S.sps *= 0.9;
  if (md.exploded && !S.paused) { S.paused = true; toast('Simulation unstable: lower the time step and Rebuild', 8000); }

  // transport: the live part (bond currents, current at the bias) a few times a second while atoms move; the curves on demand
  if (isMat() && S.cm.size && S.cp.size && !TR.busy) {
    const moving = !S.paused || md.ext.i >= 0;
    if (TR.dirtyAt && t - TR.dirtyAt > 250) { TR.dirtyAt = 0; TR.curve = null; requestTransport(true); }
    else if (S.live && moving && t - TR.last > 250 && (S.tab === TAB_ELEC || S.arrows)) requestTransport(S.tab === TAB_ELEC && (!TR.curve || t - TR.curveAt > 2000));
    else if (TR.res && TR.res.N !== mat.N && t - TR.last > 250) requestTransport(false);          // atoms were added: refresh
    else if (S.tab === TAB_ELEC && !TR.curve && !TR.err && t - TR.last > 400) requestTransport(true);
  }
  updateAtoms();

  if (ui.pressed || ui.released || (ui.dirty && t - lastUI >= (S.vr ? 33 : 0)) || t - lastUI > (S.vr ? 130 : 90)) { drawControls(); lastUI = t; if (S.vr) uiTex.needsUpdate = true; }
  if (t - lastPlot > (S.vr ? 600 : 300) && (S.plots || S.vr)) {
    if (S.tab === TAB_ELEC) { const cv = TR.curve; drawElec(pctx, cv ? { E: cv.E, T: cv.T, EF: cv.EF, V: cv.V, I: cv.I, dIdV: cv.dIdV, Vbias: S.bias, gap: cv.gap, log: S.Tlog } : { status: TR.err || (TR.busy ? 'computing\u2026' : 'mark contacts, then press T(E), I(V)'), Vbias: S.bias }); }
    else drawPlots(pctx, plotData());
    lastPlot = t; if (S.vr) plotTex.needsUpdate = true;
  }
  renderer.render(scene, camera);
}
/* ================================================================== themes */
function applyTheme(name) {
  S.theme = name === 'light' ? 'light' : 'dark'; const th = THEMES[S.theme];
  setPalette(S.theme);
  scene.background.set(th.bg); scene.fog.color.set(th.bg); scene.fog.near = th.fog[0]; scene.fog.far = th.fog[1];
  hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2]; sun.intensity = th.sun;
  rim.color.set(th.accent); rim.intensity = th.rim;
  if (room) { bench.remove(room); disposeTree(room); } room = makeRoom(th); bench.add(room);
  deskTop.material.color.set(th.top); legM.color.set(th.cab); ring.material.color.set(th.accent); disc.material.color.set(th.accent);
  boxEdges.material.color.set(th.accent); boxFaces.material.color.set(th.accent);
  cMinus.set(COL.minus); cPlus.set(COL.plus);
  document.body.classList.toggle('light', S.theme === 'light'); dom.themeBtn.textContent = S.theme === 'light' ? 'Dark lab' : 'White lab';
  ui.dirty = true; lastPlot = 0;
  try { localStorage.setItem('mdlab.theme', S.theme); } catch (e) { /* no storage */ }
}
applyTheme(S.theme);
setTableHeight(0.9, false);

build(B, { quiet: true });
md.run(300);
renderer.setAnimationLoop(frame);
window.__mdlab = { LOCO, vign, dolly, get md() { return md; }, mat, lj, isMat, S, B, H, build, ui, renderer, camera, scene, simRoot, vrc, applyTask, toolDown, toolUp, hold, enterVR,
  TR, applyTheme, setTableHeight, contactsAtEnds, requestTransport, placePanels, uiMesh, plotMesh, deskTop };
