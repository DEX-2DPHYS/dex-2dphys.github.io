// 2DPHYS Atomic Workbench (formerly MD Lab VR) - build and run molecular dynamics and electron transport in WebXR
// (Meta Quest browser, or a Quest on a PC through SteamVR/OpenXR) - or on the desktop with mouse.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MD, ELEMENTS, units, MAXN, clamp } from './physics.js';
import { Mat, TU_FS, SPECIES, TERSOFF, SP } from './materials.js';
import { CHEM_ELEMENTS, VALENCE } from './chem.js';
import { UI, COL, setPalette } from './ui.js';
import { drawPlots, drawElec, PW, PH } from './plots.js';
import { analyse as analyseNow } from './tb.js';
import { tr, setLang, addLanguage } from './i18n.js';
import { DA } from './i18n-da.js';
addLanguage('da', DA);
import LOGO from './logo-2dphys.jpg';                                      // inlined as a data URL by build.js
const logoImg = new Image(); logoImg.src = LOGO;
// the three 2DPHYS posters (A0, inlined like the logo). The images are loaded once; every rebuild of the room makes its own textures.
import POSTER_TRANSPORT from './poster-transport.jpg';
import POSTER_QUANTUM from './poster-quantum.jpg';
import POSTER_LIGHT from './poster-light.jpg';
const posterImgs = [POSTER_TRANSPORT, POSTER_QUANTUM, POSTER_LIGHT].map((s) => { const im = new Image(); im.src = s; return im; });
function posterMesh(img, w, h) {
  const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  if (img.complete && img.naturalWidth) tex.needsUpdate = true; else img.addEventListener('load', () => { tex.needsUpdate = true; }, { once: true });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}
import { TASKS, VR_HELP } from './content.js';

/* ================================================================== state */
const lj = new MD(MAXN), mat = new Mat(1200);
let md = lj;                                                                 // the active engine: noble-gas LJ or the materials engine
const B = { sys: 'mat', el: 'Ar', cells: 4, start: 'fcc', rho: 1.0, T0: 30,   // build recipe shown on the BUILD tab
  mat: 'graphene', size: 10, layers: 3, nmol: 7, rad: 7, Tm: 300, open: true, chem: false };
const MAT_DEFAULTS = { empty: { Tm: 50 }, benzene: { nmol: 7, Tm: 100 }, graphene: { size: 8, Tm: 300 }, graphite: { size: 7, layers: 3, Tm: 300 }, mos2: { size: 7, layers: 2, Tm: 300 }, nanodiamond: { rad: 7, Tm: 300 } };
const MAT_INFO = {
  benzene: 'OPLS-style force field: bonds, angles, planarity; LJ + charges between molecules.',
  graphene: 'Tersoff carbon (Lindsay-Broido): covalent bonds that can break and re-form.',
  graphite: 'Tersoff layers + Lennard-Jones van der Waals between layers (AB stacking).',
  mos2: 'Stillinger-Weber (Jiang) layers + van der Waals between layers (2H stacking).',
  nanodiamond: 'Tersoff carbon cluster cut from diamond. Bare surface: it can reconstruct.',
  empty: 'An empty box: place atoms with Add, connect them with Bond, grow molecules with Attach.',
  cnt: 'Single-wall carbon nanotube rolled from graphene (Tersoff carbon). Set (n, m) and length on the SYSTEMS tab.',
  c60: 'Buckminsterfullerene C60 (Tersoff carbon).',
  hbn: 'Hexagonal boron nitride on the chemistry model (UFF, explicit bonds).',
  junction: 'Benzene rings between gold pads (held fixed), thiol anchors, chemistry model. Contacts on the anchor carbons.',
};
const CHEM_INFO = 'Chemistry: explicit bonds on the Universal Force Field (UFF). Attach any main-group atom; valence is respected, hybridisation follows the bonds (sp\u00B2 \u2192 sp\u00B3). Bonds snap at 1.6\u00D7 their length.';
const S = {
  el: 'Ar', TsetK: 30, thermo: true, paused: false, dt: 0.004, speed: 10, periodic: true,
  color: 'speed', tool: 'tweezers', trail: true, bonds: true, grab: 'atom', addSp: 3, dtFs: 1.0, tag: 0, tab: 0, taskPage: 0, helpPage: 0,
  rows: [], msg: '', msgUntil: 0, D: null, vr: false, xr: null, sps: 0, lastBuild: null, plots: true, panel: true,
  cel: 'F', fillH: false, bondA: -1,                                                       // chemistry tools
  theme: 'dark', tableH: 0.9, moveSpeed: 1.2, snapTurn: true, vignette: true,          // room and seated movement
  cm: new Set(), cp: new Set(), gamma: 1.0, bias: 0.2, arrows: false, curBonds: true, live: true, Tlog: false,     // electron transport (ELEC tab)
  lang: 'en', quality: 'high', thermoOn: true, atomR: 0.32, sameSize: true, bondR: 0.08, ptOpen: false, zapDeg: 6, escape: true, saveDel: false, savePage: 0,
  sys: { sel: 'graphene', size: 10, layers: 2, open: true, rad: 7, n: 6, m: 6, len: 4, nmol: 5, rings: 3, T: 300 },                                 // SETTINGS tab, periodic-table popup
};
const TABS = ['BUILD', 'RUN', 'DATA', 'LAB', 'ELEC', 'VR', 'SETTINGS', 'SYSTEMS'], TAB_ELEC = 4, TAB_VR = 5, TAB_SYS = 7;
try { const v = JSON.parse(localStorage.getItem('mdlab.view') || '{}'); for (const k of ['lang', 'quality', 'thermoOn', 'atomR', 'sameSize', 'bondR', 'arrows', 'curBonds', 'zapDeg', 'escape']) if (k in v) S[k] = v[k]; } catch (e) { /* no storage */ }
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
    sky: ['#03060d', '#0a1730', '#1a2c50'], stars: true, sign: ['#0a1120', '#4ae3e1', '#9fb2cf'], hemi: [0xaec6ff, 0x1a2234, 1.15], sun: 1.7, rim: 3 },
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
  const drawSign = (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    if (logoImg.complete && logoImg.naturalWidth) g.drawImage(logoImg, 40, 10, w - 80, (w - 80) * logoImg.naturalHeight / logoImg.naturalWidth);
    g.fillStyle = '#1b1b1f'; g.font = '700 74px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ATOMIC WORKBENCH', w / 2, h - 58);
  };
  const sign = canvasTex(1600, 640, drawSign);
  if (!logoImg.complete) logoImg.addEventListener('load', () => { drawSign(sign.image.getContext('2d'), 1600, 640); sign.needsUpdate = true; }, { once: true });
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 0.82), new THREE.MeshBasicMaterial({ map: sign })); sg.position.set(0, 2.77, Z0 + 0.06); grp.add(sg);
  // posters at A0 size (0.84 x 1.19 m): two on the wall behind the seat, one on a free-standing board to the left, turned towards the seat
  const PW = 0.84, PH = 1.19, PY = 1.62;
  for (const [img, x] of [[posterImgs[0], -2.1], [posterImgs[2], 2.1]]) {
    box('trim', PW + 0.06, PH + 0.06, 0.02, x, PY, Z1 - 0.06);
    const p = posterMesh(img, PW, PH); p.position.set(x, PY, Z1 - 0.075); p.rotation.y = Math.PI; grp.add(p);
  }
  {
    const st = new THREE.Group(), dark = new THREE.MeshLambertMaterial({ color: 0x3a4150 }), metal = new THREE.MeshLambertMaterial({ color: 0x9aa3b0 });
    const bx = (m, w, h, d, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); st.add(o); };
    bx(dark, PW + 0.08, PH + 0.08, 0.03, 0, PY, 0);                                         // the board
    for (const s of [-1, 1]) { bx(metal, 0.035, 2.3, 0.035, s * (PW / 2 + 0.06), 1.15, -0.02); bx(metal, 0.06, 0.03, 0.55, s * (PW / 2 + 0.06), 0.015, -0.02); }   // legs and feet
    const p = posterMesh(posterImgs[1], PW, PH); p.position.set(0, PY, 0.017); st.add(p);
    const sx = -2.9, sz = -0.3; st.position.set(sx, 0, sz); st.rotation.y = Math.atan2(-sx, -sz); grp.add(st);
  }
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
/* ---------- the thermometer on the table: red liquid = the temperature now, teal handle = the target. Grab the handle (trigger /
   mouse) and slide it up or down to set the target (logarithmic scale; it switches the thermostat on). ---------- */
const THERMO = { g: new THREE.Group(), H: 0.34, y0: 0.06, shownT: 0, lastLabel: 0 };
{
  const T = THERMO, g = T.g, glass = new THREE.MeshPhongMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, shininess: 120, depthWrite: false }), red = new THREE.MeshPhongMaterial({ color: 0xe8322b, emissive: 0x4a0a08 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.09), new THREE.MeshLambertMaterial({ color: 0x2a3550 })); base.position.y = 0.01; g.add(base);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, T.H, 24, 1, true), glass); tube.position.y = T.y0 + T.H / 2; g.add(tube);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.017, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass); cap.position.y = T.y0 + T.H; g.add(cap);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.027, 20, 14), red); bulb.position.y = T.y0 - 0.008; g.add(bulb);
  T.liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 1, 14), red); T.liquid.position.y = T.y0; g.add(T.liquid);
  const tickM = new THREE.MeshBasicMaterial({ color: 0x9fb2cf });
  for (let k = 0; k <= 8; k++) { const t = new THREE.Mesh(new THREE.BoxGeometry(k % 2 ? 0.008 : 0.014, 0.0016, 0.002), tickM); t.position.set(-0.024, T.y0 + T.H * k / 8, 0.012); g.add(t); }
  T.knob = new THREE.Group(); const km = new THREE.MeshPhongMaterial({ color: 0x2bd3cf, emissive: 0x0a3a3a, shininess: 80 });
  const ring_ = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0055, 10, 28), km); ring_.rotation.x = Math.PI / 2; T.knob.add(ring_);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), km); tab.position.x = 0.04; T.knob.add(tab); T.knobMat = km; g.add(T.knob);
  T.hit = new THREE.Mesh(new THREE.BoxGeometry(0.12, T.H + 0.1, 0.1), new THREE.MeshBasicMaterial({ visible: false })); T.hit.position.y = T.y0 + T.H / 2; g.add(T.hit);
  T.bottom = new THREE.Object3D(); T.bottom.position.y = T.y0; g.add(T.bottom);
  T.cv = document.createElement('canvas'); T.cv.width = 320; T.cv.height = 120; T.tex = new THREE.CanvasTexture(T.cv); T.tex.colorSpace = THREE.SRGBColorSpace;
  T.label = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ map: T.tex, transparent: true, toneMapped: false })); T.label.position.set(0, T.y0 + T.H + 0.07, 0); g.add(T.label);
  g.position.set(0.56, 0.9, -0.72); g.rotation.y = -0.35; desk.add(g);
}
const tRange = () => (isMat() ? [10, 3000] : [3, 600]);
const tFrac = (T) => { const [a, b] = tRange(); return clamp(Math.log(Math.max(T, a) / a) / Math.log(b / a), 0, 1); };
const thermoRay = new THREE.Raycaster();
function thermoHit(o, d) { if (!S.thermoOn || !THERMO.g.visible) return false; thermoRay.set(o, d); THERMO.g.updateWorldMatrix(true, true); return thermoRay.intersectObject(THERMO.hit, false).length > 0; }
function thermoDrag(o, d) {
  const b = THERMO.bottom.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(d.x, 0, d.z); if (n.lengthSq() < 1e-6) n.set(0, 0, 1); n.normalize();
  const den = n.dot(d); if (Math.abs(den) < 1e-4) return;
  const t = n.dot(b.clone().sub(o)) / den, y = o.y + d.y * t, f = clamp((y - b.y) / THERMO.H, 0, 1), [lo, hi] = tRange();
  S.TsetK = Math.round(lo * Math.pow(hi / lo, f) / (isMat() ? 5 : 1)) * (isMat() ? 5 : 1); S.thermo = true; ui.dirty = true;
}
function updateThermo(t) {
  const T = THERMO; T.g.visible = S.thermoOn; if (!S.thermoOn) return;
  const now_ = md.N ? U.K(md.temperature()) : 0; T.shownT += (now_ - T.shownT) * 0.15;
  const fl = Math.max(0.02, tFrac(T.shownT)) * T.H; T.liquid.scale.y = fl; T.liquid.position.y = T.y0 + fl / 2;
  T.knob.position.y = T.y0 + tFrac(S.TsetK) * T.H; T.knobMat.opacity = 1; T.knobMat.emissive.setHex(S.thermo ? 0x0a3a3a : 0x000000); T.knobMat.color.setHex(S.thermo ? 0x2bd3cf : 0x66707f);
  if (t - T.lastLabel > 250) {
    T.lastLabel = t; const c = T.cv.getContext('2d'); c.clearRect(0, 0, 320, 120); c.fillStyle = S.theme === 'light' ? 'rgba(255,255,255,0.88)' : 'rgba(10,17,32,0.85)'; c.fillRect(0, 0, 320, 120);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ff6a5c'; c.font = '700 54px system-ui,sans-serif'; c.fillText(`${now_.toFixed(0)} K`, 160, 44);
    c.fillStyle = S.thermo ? '#2bd3cf' : '#8894a8'; c.font = '28px system-ui,sans-serif'; c.fillText(S.thermo ? `${tr('target')} ${S.TsetK.toFixed(0)} K` : tr('thermostat off'), 160, 96); T.tex.needsUpdate = true;
  }
}

/* ---------- simulation objects ---------- */
const simRoot = new THREE.Group(); scene.add(simRoot);           // placed in the world, scaled: world metres per sigma
const tilt = new THREE.Group(); simRoot.add(tilt);                // lays 2D sheets flat on the bench (sim z -> up)
const inner = new THREE.Group(); tilt.add(inner);             // box coordinates [0,L]^3 -> centred
const SIM_HOME = new THREE.Vector3(0, 1.33, -1.0);               // in bench coordinates (its height follows the table)
simRoot.position.copy(SIM_HOME);
function setTableHeight(h, moveSim = true) {
  h = clamp(h, 0.5, 1.2); const dh = h - S.tableH; S.tableH = h;
  deskTop.position.set(0, h, -1.0); for (const l of legs) { l.scale.y = h - 0.025; l.position.y = (h - 0.025) / 2; }
  ring.position.set(0, h + 0.03, -1.0); disc.position.set(0, h + 0.029, -1.0); rim.position.set(0, h + 1.0, -1.0); THERMO.g.position.y = h + 0.025;
  SIM_HOME.y = h + 0.43;
  if (dh && typeof tbMesh !== "undefined") { tbMesh.position.y += dh; ptMesh.position.y += dh; }
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
/* ---------- graphics quality: Low is for older or slower headsets. It never changes the simulation, only the pixels:
   VR resolution 70 % (applied when VR starts), matte atoms and bonds lit by one light, coarser spheres, desktop pixel ratio 1. ---------- */
const sphereCoarse = new THREE.SphereGeometry(1, 8, 6), atomMatLow = new THREE.MeshLambertMaterial({ color: 0xffffff });
const XR_SCALE = { high: 1, low: 0.7 };
let bondGeoHigh = null, bondMatHigh = null; const bondGeoLow = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), bondMatLow = new THREE.MeshLambertMaterial({ color: 0xffffff });
function applyQuality() {
  const lo = S.quality === 'low';
  atoms.geometry = lo ? sphereCoarse : sphereLo; atoms.material = lo ? atomMatLow : atomMat;
  if (typeof bondsMesh !== 'undefined') { if (!bondGeoHigh) { bondGeoHigh = bondsMesh.geometry; bondMatHigh = bondsMesh.material; } bondsMesh.geometry = lo ? bondGeoLow : bondGeoHigh; bondsMesh.material = lo ? bondMatLow : bondMatHigh; }
  rim.visible = !lo;
  if (!renderer.xr.isPresenting) { renderer.setPixelRatio(lo ? 1 : Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(window.innerWidth, window.innerHeight); }
}
function setQuality(q) {
  S.quality = q; applyQuality(); ui.dirty = true;
  if (renderer.xr.isPresenting) toast(q === 'low' ? 'Low quality now; the lower VR resolution starts the next time you enter VR' : 'High quality now; the full VR resolution starts the next time you enter VR', 6000);
}

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
  S.bondA = -1;
  if (r.chem && r.mat === 'mos2') { toast('MoS\u2082 is not available in the chemistry mode - built with its own potential'); r = Object.assign({}, r, { chem: false }); }
  try {
    if (r.mat === 'empty') mat.buildEmpty(30);
    else if (r.mat === 'benzene') mat.buildBenzene(Math.round(r.nmol), T0);
    else if (r.mat === 'graphene') mat.buildGraphene(n, ny, T0, 1, false, !!r.open);
    else if (r.mat === 'graphite') mat.buildGraphite(n, ny, Math.round(r.layers), T0, !!r.open);
    else if (r.mat === 'mos2') mat.buildMoS2(n, ny, Math.round(r.layers), T0, !!r.open);
    else if (r.mat === 'cnt') mat.buildCNT(r.n, r.m, r.len, T0);
    else if (r.mat === 'c60') mat.buildC60(T0);
    else if (r.mat === 'hbn') mat.buildHBN(n, ny, T0, !!r.open);
    else if (r.mat === 'junction') mat.buildJunction(r.rings, T0);
    else mat.buildNanodiamond(r.rad, T0);
    if (r.chem && mat.model !== 'uff') mat.toChem(T0);
  } catch (e) { toast(String(e.message || e)); return; }
  md = mat; U = matUnits(); S.el = r.mat;
  S.TsetK = T0; S.thermo = true; mat.thermostat = true; mat.Ttarget = T0; S.dtFs = mat.dt * TU_FS;
  if (S.color === 'speed' && !opts.keepColor) S.color = 'el';
  S.tool = S.tool === 'add' && r.mat === 'benzene' ? 'tweezers' : S.tool;
  S.grab = (r.mat === 'graphite' || r.mat === 'mos2' || r.mat === 'benzene') ? 'group' : 'frag';
  S.addSp = r.mat === 'mos2' ? 3 : 0;
  // metres per angstrom so that the object is about half a metre across
  let ext;
  if (mat.periodicAny) ext = Math.max(mat.Lx, mat.Ly);
  else if (!mat.N) ext = 30;
  else { let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < mat.N; i++) { lo[0] = Math.min(lo[0], mat.x[i]); hi[0] = Math.max(hi[0], mat.x[i]); lo[1] = Math.min(lo[1], mat.y[i]); hi[1] = Math.max(hi[1], mat.y[i]); lo[2] = Math.min(lo[2], mat.z[i]); hi[2] = Math.max(hi[2], mat.z[i]); } ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 5; }
  wps = clamp(0.45 / ext, 0.006, 0.14);
  S.paused = false; resetHistory(); retag();
  if (r.mat === 'junction' && mat.junction) { S.cm.add(mat.junction[0]); S.cp.add(mat.junction[1]); S.gamma = 0.5; contactsChanged(); }
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
// current scale (bonds): dark violet -> magenta-red -> orange -> pale yellow; deliberately no cyan, so it never blends with the atoms
const CUR_STOPS = [[0.28, 0.08, 0.45], [0.75, 0.15, 0.45], [0.98, 0.42, 0.12], [1.0, 0.92, 0.45]];
function curRamp(t, out) { t = clamp(t, 0, 1) * 3; const k = Math.min(2, Math.floor(t)), f = t - k, a = CUR_STOPS[k], b = CUR_STOPS[k + 1]; for (let q = 0; q < 3; q++) out[q] = a[q] + (b[q] - a[q]) * f; }
// coordination colouring for materials: blue = the ideal number of bonds, red = defect / surface
const idealZ = (i) => { if (mat.model === 'uff') { const e = SPECIES[mat.sp[i]].sym; return e === 'C' ? (mat.z_[i] > 3.5 ? 4 : 3) : (VALENCE[e] ?? 1); } const q = mat.sp[i]; return q === 1 ? 1 : q === 2 ? 6 : q === 3 ? 3 : (mat.model === 'tersoff' && mat.tp === TERSOFF.diamond ? 4 : 3); };
const spCol = SPECIES.map((s) => new THREE.Color(s.color));
const BMAX = 7000;
const bondsMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30, specular: 0x333344 }), BMAX);
bondsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bondsMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BMAX * 3), 3); bondsMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
bondsMesh.frustumCulled = false; bondsMesh.count = 0; inner.add(bondsMesh);
function updateBonds() {
  if (!isMat() || !S.bonds) { bondsMesh.count = 0; return; }
  const m = bondsMesh.instanceMatrix.array, c = bondsMesh.instanceColor.array, per = mat.per, Lx = mat.Lx, Ly = mat.Ly, Lz = mat.Lz; let n = 0;
  const BR = S.bondR, curOn = S.curBonds && hasCurrent(), dim = S.theme === 'light' ? 0.62 : 0.17;
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
      if (curOn) {                                                // current: blue (little) -> red (most); no current: dim
        const f = (TR.curMap.get(i < j ? i * 65536 + j : j * 65536 + i) || 0) / TR.Jmax;
        if (f > 0.02) { curRamp(Math.sqrt(f), rgb); c[3 * n] = rgb[0]; c[3 * n + 1] = rgb[1]; c[3 * n + 2] = rgb[2]; } else { c[3 * n] = c[3 * n + 1] = dim; c[3 * n + 2] = dim * 1.1; }
        n++; continue;
      }
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
const TR = { curMap: new Map(), worker: null, busy: false, pendingCurve: false, pendingLive: false, res: null, curve: null, id: 0, last: 0, err: '', Jmax: 0, curveKey: '' };
try { TR.worker = new Worker(URL.createObjectURL(new Blob([window.__TB_WORKER || ''], { type: 'text/javascript' }))); TR.worker.onmessage = (e) => onTransport(e.data); TR.worker.onerror = () => { TR.worker = null; TR.busy = false; }; } catch (e) { TR.worker = null; }
const transportOK = () => isMat() && (mat.model === 'tersoff' || mat.model === 'ff' || mat.model === 'uff');
// while currents are drawn, atoms and bonds are drawn thinner so the arrows between them can be seen
const hasCurrent = () => isMat() && !!TR.res && TR.res.N === mat.N && TR.Jmax > 0;
function clearContacts() { S.cm.clear(); S.cp.clear(); TR.res = null; TR.curve = null; TR.err = ''; arrows.count = 0; }
function contactsChanged() { TR.curve = null; requestTransport(true); }
/* ---------- removing many atoms at once: the annihilator and the boundary sphere ---------- */
function removeAtomsBatch(list) {
  const sorted = [...new Set(list)].sort((a, b) => b - a); if (!sorted.length) return;
  if (isMat() && mat.model === 'ff' && !ensureChem()) return;
  for (const i of sorted) {
    if (i >= md.N) continue; const last = md.N - 1, n0 = md.N; md.removeAtom(i, true); if (md.N === n0) continue;
    if (S.tag === i) S.tag = -1; else if (S.tag === last) S.tag = i;
    if (S.bondA === i || S.bondA === last) S.bondA = -1;
    for (const s of [S.cm, S.cp]) { s.delete(i); if (s.delete(last)) s.add(i); }
  }
  md.computeForces(); if (S.tag < 0 && md.N) retag();
  if (S.cm.size && S.cp.size) contactsChanged(); else { TR.res = null; arrows.count = 0; }
}
// every atom inside a cone around the pointing ray (half angle S.zapDeg), any distance in front
function doZap(src, o, d) {
  const r = toLocal(o, d), dl = Math.hypot(r.d.x, r.d.y, r.d.z), ux = r.d.x / dl, uy = r.d.y / dl, uz = r.d.z / dl, tn = Math.tan(S.zapDeg * Math.PI / 180), pad = 0.5, hit = [];
  for (let i = 0; i < md.N; i++) {
    const vx = md.x[i] - r.o.x, vy = md.y[i] - r.o.y, vz = md.z[i] - r.o.z, t = vx * ux + vy * uy + vz * uz; if (t <= 0) continue;
    const lim = t * tn + pad; if (vx * vx + vy * vy + vz * vz - t * t < lim * lim) hit.push(i);
  }
  if (!hit.length) return false;
  for (const i of hit) flashAt(md.x[i], md.y[i], md.z[i], 0xff5533);
  removeAtomsBatch(hit); pulse(src, 0.7, 40); return true;
}
const FLASH = [], flashGeo = new THREE.SphereGeometry(1, 12, 8); let flashI = 0;
for (let k = 0; k < 40; k++) { const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; inner.add(m); FLASH.push({ m, age: 9 }); }
function flashAt(x, y, z, col) { const f = FLASH[flashI++ % FLASH.length]; f.m.position.set(x, y, z); f.m.material.color.setHex(col); f.age = 0; f.m.visible = true; }
function updateFlashes(dt) {
  for (const f of FLASH) { if (!f.m.visible) continue; f.age += dt; const a = f.age / 0.6; if (a >= 1) { f.m.visible = false; continue; } f.m.scale.setScalar(0.5 * (1 + 3 * a)); f.m.material.opacity = 1 - a; }
}
// atoms that fly beyond a sphere well outside the system (out of reach of the tweezers) light up and are removed
let escapeTick = 0;
function escapeCheck() {
  if (++escapeTick % 10) return;
  const m = mat, per = m.per, c = [m.Lx / 2, m.Ly / 2, m.Lz / 2], L = [m.Lx, m.Ly, m.Lz]; let R2 = 0;
  for (let k = 0; k < 3; k++) if (!per[k]) R2 += L[k] * L[k]; if (!R2) return;
  const R = 0.5 * Math.sqrt(R2) + 15, held = m.ext.i, hg = m.ext.mode === 'group' && held >= 0 ? m.grp[held] : -999, out = [];
  for (let i = 0; i < m.N; i++) {
    if (i === held || m.grp[i] === hg) continue; let s = 0; const P = [m.x[i], m.y[i], m.z[i]];
    for (let k = 0; k < 3; k++) if (!per[k]) s += (P[k] - c[k]) ** 2;
    if (s > R * R) out.push(i);
  }
  if (!out.length) return;
  for (const i of out) flashAt(m.x[i], m.y[i], m.z[i], 0x66ccff);
  removeAtomsBatch(out); toast(`${out.length} stray atom${out.length > 1 ? 's' : ''} flew out of reach and ${out.length > 1 ? 'were' : 'was'} removed`);
}
function contactsAtEnds(w = 2.3) {                          // electrodes on the two ends of the sheet (along x)
  clearContacts(); if (!isMat()) return;
  const A = [mat.x, mat.y, mat.z], ext = [0, 1, 2].map((k) => { let a = 1e9, b = -1e9; for (let i = 0; i < mat.N; i++) if (mat.sp[i] === 0) { a = Math.min(a, A[k][i]); b = Math.max(b, A[k][i]); } return [a, b]; });
  const k = mat.sheet ? 0 : [0, 1, 2].reduce((p, q) => (ext[q][1] - ext[q][0] > ext[p][1] - ext[p][0] ? q : p), 0), X = A[k], lo = ext[k][0], hi = ext[k][1];
  for (let i = 0; i < mat.N; i++) { if (mat.sp[i] !== 0) continue; if (X[i] < lo + w) S.cm.add(i); else if (X[i] > hi - w) S.cp.add(i); }
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
  const N = mat.N, orb = new Uint8Array(N), chem = mat.model === 'uff';
  for (let i = 0; i < N; i++) orb[i] = mat.sp[i] === SP.C && (!chem || mat.chem.deg[i] <= 3) ? 1 : 0;      // sp3 carbons: no pi orbital
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
    TR.curMap = new Map(); for (let p = 0; p < r.J.length; p++) { const a = r.pairs[2 * p], b = r.pairs[2 * p + 1]; TR.curMap.set(a < b ? a * 65536 + b : b * 65536 + a, Math.abs(r.J[p])); }
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
  const N = md.N, m = atoms.instanceMatrix.array, c = atoms.instanceColor.array, mt = isMat();
  atoms.count = N;
  const T = Math.max(mt ? md.temperature() * KBT : md.temperature(), 0.03);
  const base = mt ? null : col.set(ELEMENTS[S.el].color);
  for (let i = 0; i < N; i++) {
    const k = 16 * i, R0 = mt ? (S.sameSize ? S.atomR : SPECIES[md.sp[i]].r * S.atomR / 0.42) : 0.47, s = i === S.tag ? R0 * 1.35 : R0;
    m[k] = m[k + 5] = m[k + 10] = s; m[k + 12] = md.x[i]; m[k + 13] = md.y[i]; m[k + 14] = md.z[i];
    if (mt && i === S.bondA) { m[k] = m[k + 5] = m[k + 10] = s * 1.4; c[3 * i] = 1; c[3 * i + 1] = 0.85; c[3 * i + 2] = 0.2; continue; }
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
/* ---------- toolbar (essential editing tools) and the periodic-table popup: DOM canvases on the desktop, panels in VR ---------- */
const TBW = 1000, TBH = 92, PTW = 1000, PTH = 590;
// element families, coloured the usual way
const FAMILY = { alkali: ['Alkali metal', '#ff9e80'], alkaline: ['Alkaline earth', '#ffd180'], transition: ['Transition metal', '#ffe9a8'], post: ['Post-transition metal', '#b9e3b0'],
  metalloid: ['Metalloid', '#8fd8cf'], nonmetal: ['Nonmetal', '#9fd8fb'], halogen: ['Halogen', '#c6b4f2'], noble: ['Noble gas', '#e7a6ee'], lanact: ['Lanthanide / actinide', '#f6a9c6'], unknown: ['Unknown', '#cfd8dc'] };
const FAM_OF = {};
for (const [f, list] of Object.entries({ alkali: 'Li Na K Rb Cs Fr', alkaline: 'Be Mg Ca Sr Ba Ra', transition: 'Sc Ti V Cr Mn Fe Co Ni Cu Zn Y Zr Nb Mo Tc Ru Rh Pd Ag Cd Hf Ta W Re Os Ir Pt Au Hg Rf Db Sg Bh Hs Cn',
  post: 'Al Ga In Sn Tl Pb Bi Po', metalloid: 'B Si Ge As Sb Te', nonmetal: 'H C N O P S Se', halogen: 'F Cl Br I At', noble: 'He Ne Ar Kr Xe Rn', lanact: 'La Ac', unknown: 'Mt Ds Rg Nh Fl Mc Lv Ts Og' })) for (const e of list.split(' ')) FAM_OF[e] = f;
const tbar = new UI(TBW, TBH); tbar.pad = 10; tbar.gap = 8;
const ptab = new UI(PTW, PTH); ptab.pad = 14; ptab.gap = 6;
const tbTex = makeTex(tbar.canvas), ptTex = makeTex(ptab.canvas);
const tbMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86 * TBH / TBW), new THREE.MeshBasicMaterial({ map: tbTex, transparent: true, toneMapped: false }));
const ptMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86 * PTH / PTW), new THREE.MeshBasicMaterial({ map: ptTex, transparent: true, toneMapped: false }));
tbMesh.visible = ptMesh.visible = false; bench.add(tbMesh); bench.add(ptMesh);
const PT_ROWS = ['H,,,,,,,,,,,,,,,,,He', 'Li,Be,,,,,,,,,,,B,C,N,O,F,Ne', 'Na,Mg,,,,,,,,,,,Al,Si,P,S,Cl,Ar', 'K,Ca,Sc,Ti,V,Cr,Mn,Fe,Co,Ni,Cu,Zn,Ga,Ge,As,Se,Br,Kr',
  'Rb,Sr,Y,Zr,Nb,Mo,Tc,Ru,Rh,Pd,Ag,Cd,In,Sn,Sb,Te,I,Xe', 'Cs,Ba,La,Hf,Ta,W,Re,Os,Ir,Pt,Au,Hg,Tl,Pb,Bi,Po,At,Rn', 'Fr,Ra,Ac,Rf,Db,Sg,Bh,Hs,Mt,Ds,Rg,Cn,Nh,Fl,Mc,Lv,Ts,Og'].map((r) => r.split(','));
function selectTool(v) { S.tool = v; S.bondA = -1; ui.dirty = true; tbar.dirty = true; }
function drawToolbar() {
  tbar.begin(); tbar.y = 13; tbar.row(11);
  for (const [v, l] of [['tweezers', 'Tweezers'], ['add', 'Add'], ['attach', 'Attach'], ['bond', 'Bond'], ['delete', 'Delete'], ['zap', 'Zap']]) if (tbar.button(l, { active: S.tool === v, h: 66, size: 20 })) selectTool(v);
  if (tbar.button(`${S.cel} \u25BE`, { active: S.ptOpen, primary: !S.ptOpen, h: 66, size: 26 })) { S.ptOpen = !S.ptOpen; ptab.dirty = true; }
  if (tbar.button('H fill', { active: S.fillH, h: 66, size: 19 })) S.fillH = !S.fillH;
  if (tbar.button('\u2212 contact', { active: S.tool === 'cminus', h: 66, size: 19 })) selectTool('cminus');
  if (tbar.button('+ contact', { active: S.tool === 'cplus', h: 66, size: 19 })) selectTool('cplus');
  if (tbar.button(S.paused ? '\u25B6 Run' : '\u275A\u275A Pause', { active: S.paused, h: 66, size: 19 })) S.paused = !S.paused;
  tbar.end();
}
function drawPtable() {
  ptab.begin(); ptab.header('Choose an element', 'highlighted = available');
  for (const row of PT_ROWS) {
    ptab.row(18);
    for (const e of row) {
      if (!e) { ptab.skip(50); continue; }
      const ok = CHEM_ELEMENTS.includes(e);
      const fam = FAMILY[FAM_OF[e] || 'unknown'];
      if (ptab.button(e, { h: 50, size: e === S.cel ? 24 : 20, bg: fam[1], fg: '#15202f', bd: ok ? '#15202f' : fam[1], alpha: ok ? 1 : 0.45, disabled: !ok, active: false }) && ok) {
        S.cel = e; S.addSp = SP[e]; S.ptOpen = false; if (S.tool !== 'attach' && S.tool !== 'add') selectTool('attach'); tbar.dirty = true; ui.dirty = true;
      }
    }
  }
  // the chosen element gets a white ring
  { const c = ptab.ctx; c.save(); for (let r = 0; r < PT_ROWS.length; r++) { const col = PT_ROWS[r].indexOf(S.cel); if (col < 0) continue; const cw = (PTW - 2 * ptab.pad - 17 * ptab.gap) / 18, x = ptab.pad + col * (cw + ptab.gap), y = ptab.pad + 42 + r * 56; c.strokeStyle = COL.text; c.lineWidth = 5; c.strokeRect(x - 3, y - 3, cw + 6, 56); } c.restore(); }
  ptab.space(2);
  { const c = ptab.ctx, keys = Object.keys(FAMILY); c.font = '16px system-ui,Segoe UI,sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left'; let x = ptab.pad, y = ptab.y + 10;
    for (const k of keys) { const nm = tr(FAMILY[k][0]), col = FAMILY[k][1], wd = c.measureText(nm).width + 34; if (x + wd > PTW - ptab.pad) { x = ptab.pad; y += 26; } c.fillStyle = col; c.fillRect(x, y - 8, 16, 16); c.fillStyle = COL.text; c.fillText(nm, x + 21, y); x += wd + 8; }
    ptab.y = y + 22; }
  ptab.label(`${S.cel}: valence ${VALENCE[S.cel]}. Bright = available; faded = no force-field parameters yet.`, { size: 18 });
  ptab.end();
}
function placePanels(y) {                 // either side of the table (it spans x = -0.7..0.7), angled towards the user
  uiMesh.position.set(-1.13, y, -0.8); uiMesh.rotation.set(0, 0.72, 0);
  plotMesh.position.set(1.18, y - 0.02, -0.82); plotMesh.rotation.set(0, -0.72, 0);
  tbMesh.position.set(0, S.tableH + 0.07, -0.5); tbMesh.rotation.set(-0.75, 0, 0);          // toolbar: at the front edge of the table, tilted up
  ptMesh.position.set(0, S.tableH + 0.36, -0.56); ptMesh.rotation.set(-0.3, 0, 0);          // periodic table: above it while open
}
placePanels(1.32);
uiMesh.visible = plotMesh.visible = false;
bench.add(uiMesh); bench.add(plotMesh);
uiMesh.userData.ui = true;

function drawControls() {
  const mt = isMat(), T = U.K(md.temperature());
  ui.begin();
  ui.header('ATOMIC WORKBENCH', md.N ? (mt ? `${md.name} \u00B7 ${md.N} atoms` : `${S.el} \u00B7 ${md.N} atoms \u00B7 box ${U.nm(md.L).toFixed(2)} nm`) : 'empty box');
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
  S.tab = ui.tabs(TABS, S.tab, 15);
  ui.space(2);
  [tabBuild, tabRun, tabData, tabLab, tabElec, tabVR, tabSettings, tabSystems][S.tab]();
  // footer
  const c = ui.ctx;
  c.fillStyle = COL.card; c.fillRect(ui.pad, CH - 56, CW - 2 * ui.pad, 36);
  c.font = '20px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  const msgOn = now() < S.msgUntil;
  c.fillStyle = msgOn ? COL.warn : COL.muted;
  const fN = md.ext.i >= 0 ? (isMat() ? md.extForceEV * 1.602177 : md.extForce * 60 * (U.eps / U.sigma) * 1e9) : 0;
  c.fillText(tr(msgOn ? S.msg : fN > 0 ? `Tweezer force: ${fN.toFixed(fN < 10 ? 2 : 1)} nN` : toolHint()), ui.pad + 12, CH - 38);
  ui.end();
}

function toolHint() {
  const t = S.tool;
  const trig = S.vr ? 'trigger' : 'click';
  if (t === 'zap') return `Tool: ANNIHILATOR - hold ${trig}: every atom in the ${S.zapDeg.toFixed(0)}\u00B0 cone is removed`;
  if (t === 'attach') return `Tool: ATTACH ${S.cel}${S.fillH ? ' (+H)' : ''} - ${trig} an atom; the new atom goes on the side you point from`;
  if (t === 'bond') return `Tool: BOND - ${trig} two atoms to connect them (valence permitting)`;
  if (t === 'cminus' || t === 'cplus') return `Tool: ${t === 'cminus' ? '\u2212' : '+'} CONTACT - ${trig} (or drag over) atoms; again to remove`;
  return t === 'tweezers' ? `Tool: TWEEZERS - hold ${trig} on an atom and drag` : t === 'add' ? `Tool: ADD ATOM - ${trig} inside the box` : `Tool: DELETE - ${trig} an atom to remove it`;
}

function matSel() {
  const r1 = [['benzene', 'Benzene'], ['graphene', 'Graphene'], ['graphite', 'Graphite']], r2 = B.chem ? [['nanodiamond', 'Nanodiamond'], ['empty', 'Empty box']] : [['mos2', 'MoS\u2082'], ['nanodiamond', 'Nanodiamond']];
  if (!B.chem && B.mat === 'empty') B.mat = 'graphene';
  if (B.chem && B.mat === 'mos2') B.mat = 'graphene';
  const a = ui.choice(r1, B.mat, { h: 46 }), b = ui.choice(r2, B.mat, { h: 46 });
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
    B.chem = ui.choice([[false, 'Reactive potentials'], [true, 'Chemistry (any element)']], B.chem, { h: 44, size: 20 });
    matSel();
    if (!B.chem || B.mat === 'empty') ui.label(B.chem ? MAT_INFO.empty : MAT_INFO[B.mat], { size: 17 });
    if (B.mat === 'benzene') B.nmol = Math.round(ui.slider('nmol', 'Number of molecules', B.nmol, 1, 19, (v) => `${Math.round(v)}  (${12 * Math.round(v)} atoms)`, { step: 1, h: 64 }));
    else if (B.mat === 'empty') { /* nothing to size */ }
    else if (B.mat === 'nanodiamond') B.rad = ui.slider('rad', 'Cluster radius', B.rad, 4, 9, (v) => `${v.toFixed(1)} \u00C5   (diameter ${(0.2 * v).toFixed(1)} nm)`, { step: 0.5, h: 64 });
    else {
      const lo = B.mat === 'graphene' ? 3 : 7, hi = B.mat === 'graphene' ? 16 : 10;
      B.size = Math.round(ui.slider('size', 'Sheet size (unit cells along x)', clamp(B.size, lo, hi), lo, hi, (v) => `${Math.round(v)} cells  \u2248 ${(Math.round(v) * (B.mat === 'mos2' ? 0.312 : 0.249)).toFixed(1)} nm wide`, { step: 1, h: 58 }));
      if (B.mat === 'graphite') B.layers = Math.round(ui.slider('layers', 'Layers', clamp(B.layers, 2, 4), 2, 4, (v) => `${Math.round(v)} layers`, { step: 1, h: 64 }));
      if (B.mat === 'mos2') B.layers = Math.round(ui.slider('layers', 'Layers', clamp(B.layers, 1, 2), 1, 2, (v) => `${Math.round(v)} ${Math.round(v) === 1 ? 'layer' : 'layers (2H)'}`, { step: 1, h: 64 }));
      B.open = ui.choice([[false, 'Periodic sheet'], [true, 'Open flake (free edges)']], B.open, { h: 50, size: 21 });
    }
    B.Tm = ui.slider('Tm', 'Start temperature', B.Tm, 5, 2500, (v) => `${v.toFixed(0)} K`, { step: 5, h: 58 });
    ui.space(4);
    ui.row(2);
    if (ui.button('BUILD', { primary: true, h: 54, size: 24 })) build(Object.assign({}, B, { sys: 'mat' }));
    if (ui.button('Reset view', { h: 54 })) { recenterSim(); }
    ui.section('Edit by hand');
    if (isMat() && mat.model === 'uff') { chemTools(); return; }
    S.tool = ui.choice([['tweezers', 'Tweezers'], ['add', 'Add atom'], ['delete', 'Delete']], S.tool);
    if (isMat()) { S.grab = ui.choice([['atom', 'Grab: atom'], ['frag', 'Grab: piece'], ['group', mat.model === 'ff' ? 'Grab: molecule' : 'Grab: layer']], S.grab, { h: 50, size: 19 }); }
    if (isMat() && mat.model === 'sw') S.addSp = ui.choice([[2, 'Add Mo'], [3, 'Add S']], S.addSp, { h: 50 });
  }
}

// chemistry: tools and the periodic-table palette (main groups)
function chemTools() {
  const t = ui.choice([['tweezers', 'Tweezers'], ['attach', 'Attach'], ['bond', 'Bond'], ['add', 'Add'], ['delete', 'Delete']], S.tool, { h: 46, size: 20 });
  if (t !== S.tool) { S.tool = t; S.bondA = -1; }
  const row1 = CHEM_ELEMENTS.slice(0, 6).map((e) => [e, e]), row2 = CHEM_ELEMENTS.slice(6).map((e) => [e, e]);
  const a = ui.choice(row1, S.cel, { h: 42, size: 21 }), b = ui.choice(row2, S.cel, { h: 42, size: 21 });
  S.cel = a !== S.cel ? a : b !== S.cel ? b : S.cel; S.addSp = SP[S.cel];
  ui.row(2); S.fillH = ui.toggle('Fill valence with H', S.fillH, { h: 46 }); ui.readout('valence', String(VALENCE[S.cel]), { h: 46 });
  if (S.tool === 'tweezers') { const g = ui.choice([['atom', 'Grab: atom'], ['frag', 'Grab: piece']], S.grab === 'group' ? 'frag' : S.grab, { h: 44, size: 19 }); S.grab = g; }
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
    ui.label(mat.model === 'uff' ? CHEM_INFO.slice(0, 92) + '\u2026' : mat.periodicAny ? 'Periodic in x and y (sheet); free surfaces along z.' : mat.sheet ? 'Open flake: free edges, no periodic images.' : 'Isolated cluster in vacuum.', { size: 19 });
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
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'atomic-workbench-measurements.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function tabLab() {
  const t = TASKS[S.taskPage];
  ui.row(3);
  if (ui.button('◀ Prev', { disabled: S.taskPage === 0 })) S.taskPage = Math.max(0, S.taskPage - 1);
  ui.skip();
  if (ui.button('Next ▶', { disabled: S.taskPage === TASKS.length - 1 })) S.taskPage = Math.min(TASKS.length - 1, S.taskPage + 1);
  ui.ctx.fillStyle = COL.muted; ui.ctx.font = '20px system-ui'; ui.ctx.textAlign = 'center'; ui.ctx.fillText(tr(`Task ${S.taskPage + 1} of ${TASKS.length}`), CW / 2, ui.y - 35);
  ui.label(t.title, { size: 28, bold: true, color: COL.accent });
  ui.paragraph(t.goal, { size: 22, color: COL.text });
  ui.row(1);
  if (ui.button('Load this setup  ▶', { primary: true, h: 58 })) applyTask(t);
  ui.space(2);
  t.steps.forEach((s, i) => ui.paragraph(`${i + 1}.  ${tr(s)}`, { size: 21, color: COL.muted }));
  if (t.ask) { ui.space(2); ui.paragraph(tr('Think about:') + ' ' + tr(t.ask), { size: 21, color: COL.warn }); }
}

const SYS_LIST = [['graphene', 'Graphene'], ['graphite', 'Graphite'], ['mos2', 'MoS\u2082'], ['hbn', 'hBN'], ['nanodiamond', 'Nanodiamond'], ['cnt', 'Nanotube'], ['c60', 'C\u2086\u2080'], ['benzene', 'Benzene'], ['junction', 'Molecular junction']];
function readSaved() { try { return JSON.parse(localStorage.getItem('mdlab.systems') || '[]'); } catch (e) { return []; } }
function writeSaved(list) { try { localStorage.setItem('mdlab.systems', JSON.stringify(list)); return true; } catch (e) { toast('Could not save: the browser storage is full or blocked'); return false; } }
function saveCurrent() {
  if (!isMat() || !mat.N) { toast('Saving works for materials (not the noble-gas box)'); return; }
  const d = new Date(), list = readSaved();
  list.unshift({ name: mat.name, N: mat.N, date: `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, T: S.TsetK, cm: [...S.cm], cp: [...S.cp], gamma: S.gamma, bias: S.bias, data: mat.serialize() });
  if (writeSaved(list)) toast(`Saved: ${mat.name} (${mat.N} atoms)`);
}
function loadSaved(e) {
  try { mat.restore(e.data); } catch (err) { toast('Could not load this system: ' + (err.message || err)); return; }
  md = mat; U = matUnits(); S.el = 'saved'; S.lastBuild = null; clearContacts();
  S.TsetK = e.T; S.thermo = true; mat.thermostat = true; mat.Ttarget = e.T; S.dtFs = mat.dt * TU_FS; S.bondA = -1;
  let ext; if (mat.periodicAny) ext = Math.max(mat.Lx, mat.Ly); else { let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < mat.N; i++) { const P = [mat.x[i], mat.y[i], mat.z[i]]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[k]); hi[k] = Math.max(hi[k], P[k]); } } ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 5; }
  wps = clamp(0.45 / ext, 0.006, 0.14); userScale = 1;
  S.paused = false; resetHistory(); retag();
  for (const i of e.cm || []) S.cm.add(i); for (const i of e.cp || []) S.cp.add(i); S.gamma = e.gamma ?? S.gamma; S.bias = e.bias ?? S.bias;
  if (S.cm.size && S.cp.size) contactsChanged();
  toast(`Loaded: ${e.name} (${e.N} atoms)`);
}
function loadSystem() {
  const Y = S.sys, r = Object.assign({}, B, { sys: 'mat', mat: Y.sel, size: Y.size, layers: Y.layers, open: Y.open, rad: Y.rad, n: Y.n, m: Y.m, len: Y.len, nmol: Y.nmol, rings: Y.rings, Tm: Y.T, chem: false });
  Object.assign(B, r); S.TsetK = Y.T; build(r);
}
function tabSystems() {
  const Y = S.sys;
  ui.section('Built-in systems');
  for (let k = 0; k < 3; k++) { const v = ui.choice(SYS_LIST.slice(3 * k, 3 * k + 3), Y.sel, { h: 46, size: 20 }); if (v !== Y.sel) Y.sel = v; }
  const sl = (id, lab, key, lo, hi, fmt, step = 1) => { Y[key] = ui.slider('sys' + id, lab, clamp(Y[key], lo, hi), lo, hi, fmt, { step, h: 56 }); };
  if (Y.sel === 'graphene' || Y.sel === 'hbn') sl('sz', 'Size (unit cells along x)', 'size', 3, 16, (v) => `${Math.round(v)} cells \u2248 ${(Math.round(v) * 0.249).toFixed(1)} nm`);
  if (Y.sel === 'graphite') { sl('sz', 'Size (unit cells along x)', 'size', 4, 12, (v) => `${Math.round(v)} cells`); sl('ly', 'Layers', 'layers', 2, 4, (v) => `${Math.round(v)} layers`); }
  if (Y.sel === 'mos2') { sl('sz', 'Size (unit cells along x)', 'size', 4, 10, (v) => `${Math.round(v)} cells`); sl('ly', 'Layers', 'layers', 1, 2, (v) => `${Math.round(v)}`); }
  if (Y.sel === 'nanodiamond') sl('rd', 'Radius', 'rad', 4, 9, (v) => `${v.toFixed(1)} \u00C5`, 0.5);
  if (Y.sel === 'benzene') sl('nm', 'Molecules', 'nmol', 1, 19, (v) => `${Math.round(v)}`);
  if (Y.sel === 'junction') { sl('rg', 'Benzene rings between the electrodes', 'rings', 1, 3, (v) => ['1  (benzene-dithiol)', '2  (biphenyl-dithiol)', '3  (terphenyl-dithiol)'][Math.round(v) - 1]); ui.label('Gold pads held fixed; the transport contacts sit on the anchor carbons.', { size: 17 }); }
  if (Y.sel === 'cnt') {
    sl('n', 'Chirality n', 'n', 3, 14, (v) => `n = ${Math.round(v)}`); sl('m', 'Chirality m', 'm', 0, Math.round(Y.n), (v) => `m = ${Math.round(v)}`);
    sl('len', 'Length', 'len', 1, 6, (v) => `${v.toFixed(1)} nm`, 0.5);
    const n = Math.round(Y.n), m = Math.round(Y.m), dia = 0.246 * Math.sqrt(n * n + n * m + m * m) / Math.PI;
    ui.label(`(${n},${m}) ${m === n ? 'armchair' : m === 0 ? 'zigzag' : 'chiral'}, \u00D8 ${dia.toFixed(2)} nm, ${(n - m) % 3 === 0 ? 'metallic' : 'semiconducting'} (zone folding)`, { size: 17 });
  }
  if (Y.sel === 'graphene' || Y.sel === 'graphite' || Y.sel === 'mos2' || Y.sel === 'hbn') Y.open = ui.choice([[false, 'Periodic'], [true, 'Open flake']], Y.open, { h: 44, size: 20 });
  sl('T', 'Temperature', 'T', 5, 1500, (v) => `${v.toFixed(0)} K`, 5);
  ui.row(1); if (ui.button(`Load ${SYS_LIST.find((s) => s[0] === Y.sel)[1]}`, { primary: true, h: 52, size: 22 })) loadSystem();
  ui.section('My systems (stored in this browser / headset)');
  ui.row(2);
  if (ui.button('Save current system', { h: 48, size: 20 })) saveCurrent();
  if (ui.button(S.saveDel ? 'Delete mode: ON' : 'Delete mode', { h: 48, size: 20, danger: S.saveDel })) S.saveDel = !S.saveDel;
  const list = readSaved(), per = 4, pages = Math.max(1, Math.ceil(list.length / per)); S.savePage = Math.min(S.savePage, pages - 1);
  if (!list.length) ui.label('Nothing saved yet.', { size: 18 });
  list.slice(S.savePage * per, S.savePage * per + per).forEach((e, k) => {
    ui.row(1);
    if (ui.button(`${S.saveDel ? '\u2715 ' : ''}${e.name} \u00B7 ${e.N} atoms \u00B7 ${e.date}`, { h: 44, size: 19, danger: S.saveDel })) {
      const idx = S.savePage * per + k;
      if (S.saveDel) { list.splice(idx, 1); writeSaved(list); toast('Deleted'); } else loadSaved(list[idx]);
    }
  });
  if (pages > 1) { ui.row(3); if (ui.button('\u25C0', { h: 40, disabled: S.savePage === 0 })) S.savePage--; ui.skip(40); if (ui.button('\u25B6', { h: 40, disabled: S.savePage >= pages - 1 })) S.savePage++; ui.ctx.fillStyle = COL.muted; ui.ctx.font = '18px system-ui'; ui.ctx.textAlign = 'center'; ui.ctx.fillText(`${S.savePage + 1} / ${pages}`, CW / 2, ui.y - 28); }
}

function tabSettings() {
  ui.section('Language / Sprog  \u00B7  Graphics');
  ui.row(4);
  for (const [v, l] of [['en', 'English'], ['da', 'Dansk']]) if (ui.button(l, { active: S.lang === v, h: 48, size: 21 }) && S.lang !== v) setLangUI(v);
  for (const [v, l] of [['high', 'High quality'], ['low', 'Low quality']]) if (ui.button(l, { active: S.quality === v, h: 48, size: 19 }) && S.quality !== v) setQuality(v);
  ui.section('Atoms and bonds');
  S.atomR = ui.slider('atomR', 'Atom size', S.atomR, 0.12, 0.6, (v) => `${v.toFixed(2)} \u00C5 radius`, { step: 0.01, h: 58 });
  S.sameSize = ui.toggle('Same size for every element', S.sameSize, { h: 50 });
  S.bondR = ui.slider('bondR', 'Bond width', S.bondR, 0.02, 0.16, (v) => `${(2 * v).toFixed(2)} \u00C5`, { step: 0.005, h: 58 });
  S.bonds = ui.toggle('Show bonds', S.bonds, { h: 50 });
  ui.section('Current (ELEC tab)');
  ui.row(2); S.curBonds = ui.toggle('Colour by current', S.curBonds, { h: 50 }); S.arrows = ui.toggle('Arrows', S.arrows, { h: 50 });
  ui.paragraph('Bond colour: dark violet = little current, through red and orange to yellow = the most; grey = none. Arrows point along the conventional current, from + to \u2212. Currents between graphite layers are computed but not drawn (they are not bonds).', { size: 19, color: COL.muted });
  ui.section('Annihilator and boundary');
  S.zapDeg = ui.slider('zap', 'Annihilator cone (half angle)', S.zapDeg, 1, 25, (v) => `${v.toFixed(0)}\u00B0`, { step: 1, h: 60 });
  S.escape = ui.toggle('Remove atoms that fly out of reach', S.escape, { h: 48 });
  S.thermoOn = ui.toggle('Thermometer on the table', S.thermoOn, { h: 48 });
  try { localStorage.setItem('mdlab.view', JSON.stringify({ lang: S.lang, quality: S.quality, thermoOn: S.thermoOn, atomR: S.atomR, sameSize: S.sameSize, bondR: S.bondR, arrows: S.arrows, curBonds: S.curBonds, zapDeg: S.zapDeg, escape: S.escape })); } catch (e) { /* no storage */ }
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
  ui.row(3); S.curBonds = ui.toggle('Current', S.curBonds, { h: 46 }); S.live = ui.toggle('Live', S.live, { h: 46 }); S.Tlog = ui.toggle('Log T', S.Tlog, { h: 46 });
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
// DOM buttons keep their English text in data-en and show the translation; the hint line has one version per language
function setBtn(el, en) { el.dataset.en = en; el.textContent = tr(en); }
const HINT = {
  en: '<b>Mouse:</b> drag atoms with the tweezers \u00B7 drag empty space to orbit \u00B7 right-drag to pan \u00B7 wheel to zoom<br><b>Keys:</b> space run/pause \u00B7 1 2 3 tools \u00B7 4 5 \u2212/+ contacts \u00B7 6 attach \u00B7 7 bond \u00B7 8 zap \u00B7 R rebuild \u00B7 P plots \u00B7 T dark/white lab',
  da: '<b>Mus:</b> tr\u00E6k atomer med pincetten \u00B7 tr\u00E6k i tomt rum for at dreje \u00B7 h\u00F8jre-tr\u00E6k for at flytte \u00B7 hjul for at zoome<br><b>Taster:</b> mellemrum k\u00F8r/pause \u00B7 1 2 3 v\u00E6rkt\u00F8jer \u00B7 4 5 \u2212/+ kontakter \u00B7 6 p\u00E5s\u00E6t \u00B7 7 bind \u00B7 8 zap \u00B7 R byg igen \u00B7 P grafer \u00B7 T m\u00F8rkt/lyst laboratorium',
};
function setLangUI(lg) { S.lang = lg; setLang(lg); applyLangDom(); ui.dirty = true; }
function applyLangDom() {
  for (const el of [dom.vrBtn, dom.themeBtn, dom.plotBtn, dom.panelBtn]) { if (!el.dataset.en) el.dataset.en = el.textContent; el.textContent = tr(el.dataset.en); }
  const h = document.getElementById('hint'); if (h) h.innerHTML = HINT[S.lang] || HINT.en;
  const sb = document.querySelector('.brand .sub, header .sub, .sub'); if (sb) { if (!sb.dataset.en) sb.dataset.en = sb.textContent; sb.textContent = tr(sb.dataset.en); }
  document.documentElement.lang = S.lang; ui.dirty = true; tbar.dirty = true; ptab.dirty = true; lastPlot = 0;
}
dom.tb = document.getElementById('tbWrap'); dom.pt = document.getElementById('ptWrap'); dom.tb.appendChild(tbar.canvas); dom.pt.appendChild(ptab.canvas);
for (const U_ of [tbar, ptab]) {               // the toolbar canvases take the mouse exactly like the main panel
  const cv = U_.canvas; cv.style.touchAction = 'none';
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); U_.move((e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height, 'mouse'); });
  cv.addEventListener('pointerleave', () => U_.leave('mouse'));
  cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); cv.setPointerCapture(e.pointerId); U_.move((e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height, 'mouse'); U_.press('mouse'); e.preventDefault(); });
  cv.addEventListener('pointerup', (e) => { U_.release('mouse'); if (e.pointerType !== 'mouse') U_.leave('mouse'); });
  cv.addEventListener('pointercancel', () => U_.release('mouse'));
}
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
  if (thermoHit(o, d)) { hold.src = src; hold.kind = 'thermo'; thermoDrag(o, d); pulse(src, 0.3, 20); return true; }
  if (S.tool === 'zap') { hold.src = src; hold.kind = 'zap'; hold.next = now() + 120; doZap(src, o, d); return true; }
  if (S.tool === 'attach' || S.tool === 'bond') {
    if (!ensureChem()) return false;
    const p = pickAtom(o, d); if (!p) return false;
    if (S.tool === 'attach') {
      const r = toLocal(o, d).o, res = mat.chem.attach(p.i, S.cel, S.fillH, [r.x, r.y, r.z]);
      if (res.err) { toast(res.err); pulse(src, 0.8, 60); return true; }
      toast(`Attached ${S.cel}${S.fillH && VALENCE[S.cel] > 1 ? 'H' + (VALENCE[S.cel] - 1 > 1 ? VALENCE[S.cel] - 1 : '') : ''} to ${SPECIES[mat.sp[p.i]].sym}`); pulse(src, 0.4, 30);
    } else if (S.bondA < 0 || S.bondA >= md.N) { S.bondA = p.i; toast('Now pick the second atom'); pulse(src, 0.3, 20); }
    else {
      const a = S.bondA, dd = Math.hypot(mat.x[a] - mat.x[p.i], mat.y[a] - mat.y[p.i], mat.z[a] - mat.z[p.i]); S.bondA = -1;
      const err = dd > 3.2 ? 'Too far apart to bond (more than 3.2 \u00C5)' : mat.chem.addBond(a, p.i);
      if (err) { toast(err); pulse(src, 0.8, 60); } else { mat.listDirty = true; mat.computeForces(); toast('Bonded'); pulse(src, 0.4, 30); }
    }
    if (S.cm.size && S.cp.size) contactsChanged();
    return true;
  }
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
    let frag = isMat() && S.grab === 'frag' ? mat.fragmentMask(p.i) : null; const grp = isMat() && S.grab === 'group';
    if (frag && (frag.n < 2 || frag.n > md.N / 2)) frag = null;   // a lone atom, or the main structure: pull the atom itself
    const ref = frag ? mat.maskCOM(p.i, frag.mask) : grp ? mat.groupCOM(p.i) : [md.x[p.i], md.y[p.i], md.z[p.i]];
    if (isMat()) md.ext.mask = frag ? frag.mask : null;
    hold.src = src; hold.kind = 'tw'; hold.grab = { i: p.i, dist: p.t * p.s, off: [ref[0] - r0.x, ref[1] - r0.y, ref[2] - r0.z] };
    md.ext.i = p.i; md.ext.mode = frag ? 'frag' : grp ? 'group' : 'atom'; pulse(src, 0.5, 40); return true;
  }
  if (S.tool === 'add' || S.tool === 'delete') {
    hold.src = src; hold.kind = S.tool === 'add' ? 'add' : 'del'; hold.next = now() + 380;
    if (S.tool === 'add' ? doAdd(src, o, d) : doDel(src, o, d)) return true;
    hold.src = null; hold.kind = null; return false;
  }
  return false;
}
// attaching a foreign atom switches a running structure to the bonded chemistry model (UFF), where every element can bond
function ensureChem() {
  if (!isMat()) { toast('Build a material first (BUILD \u2192 Materials), or an Empty box'); return false; }
  if (mat.model === 'uff') return true;
  try { mat.toChemLive(); } catch (e) { toast(String(e.message || e)); return false; }
  S.dtFs = mat.dt * TU_FS; S.bondA = -1; if (S.cm.size && S.cp.size) contactsChanged();
  toast('Switched to the chemistry model (UFF, explicit bonds) so other elements can bond', 6000); return true;
}
const nativeSp = (sp) => mat.model === 'uff' || (mat.model === 'tersoff' && sp === SP.C) || (mat.model === 'sw' && (sp === SP.Mo || sp === SP.S));
function doAdd(src, o, d) {
  if (isMat() && !nativeSp(S.addSp) && !ensureChem()) return true;
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
  } else if (hold.kind === 'thermo') {
    thermoDrag(o, d);
  } else if (hold.kind === 'zap') {
    if (now() > hold.next) { hold.next = now() + 120; doZap(hold.src, o, d); }
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
  else if (e.key === '8') S.tool = 'zap';
  else if (e.key === '6') S.tool = 'attach'; else if (e.key === '7') { S.tool = 'bond'; S.bondA = -1; }
  else if (e.key === 'Escape') S.bondA = -1;
  else if (e.key === 't' || e.key === 'T') applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  else if (e.key === 'r' || e.key === 'R') { if (S.lastBuild) build(S.lastBuild); }
  else if (e.key === 'p' || e.key === 'P') dom.plotBtn.click();
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); if (!S.vr) renderer.setSize(window.innerWidth, window.innerHeight); });

/* ================================================================== WebXR */
const xrState = { supported: false };
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { xrState.supported = ok; setBtn(dom.vrBtn, ok ? 'Enter VR' : 'VR not detected'); dom.vrBtn.classList.toggle('on', ok); }).catch(() => { dom.vrBtn.textContent = 'VR not detected'; });
} else setBtn(dom.vrBtn, 'WebXR unavailable');
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
  vrStarting = true; setBtn(dom.vrBtn, 'Starting VR\u2026');
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    useBaseLayer(session);
    renderer.xr.setFramebufferScaleFactor(XR_SCALE[S.quality] || 1);
    await renderer.xr.setSession(session);
  } catch (e) { toast('Could not start VR: ' + (e.message || e)); S.tab = TAB_VR; }
  finally { vrStarting = false; setBtn(dom.vrBtn, 'Enter VR'); }
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

let needRecenter = 0;          // frames to wait: the camera only carries the headset pose after the first rendered VR frames
renderer.xr.addEventListener('sessionstart', () => {
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0);
  S.vr = true; needRecenter = 4; document.body.classList.add('vr');
  // the headset's own recentre (e.g. holding the Meta button) moves the tracking origin: put the table back in front of the user
  try { const rs = renderer.xr.getReferenceSpace(); if (rs && rs.addEventListener) rs.addEventListener('reset', () => { needRecenter = 3; }); } catch (e) { /* not supported */ }
  uiMesh.visible = plotMesh.visible = tbMesh.visible = true;
  S.xr = renderer.xr.getSession();
});
renderer.xr.addEventListener('sessionend', () => {
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); vign.visible = false;
  S.vr = false; document.body.classList.remove('vr'); uiMesh.visible = plotMesh.visible = tbMesh.visible = ptMesh.visible = false;
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
    if (vc.hit) { if (vc.hit.ui) { vc.hit.ui.press(i); vc.uiHeld = vc.hit.ui; } return; }
    toolDown(i);
  });
  obj.addEventListener('selectend', () => { if (vc.uiHeld) { vc.uiHeld.release(i); vc.uiHeld = null; } toolUp(i); });
  obj.addEventListener('squeezestart', () => {
    if (vc.hitObj === uiMesh || vc.hitObj === plotMesh || vc.hitObj === tbMesh || vc.hitObj === ptMesh) { vc.obj.updateWorldMatrix(true, false); vc.hitObj.updateWorldMatrix(true, false); vc.pg = { mesh: vc.hitObj, rel: vc.obj.matrixWorld.clone().invert().multiply(vc.hitObj.matrixWorld) }; pulse(i, 0.3, 30); return; }
    vc.sq = true; regrab();
  });
  obj.addEventListener('squeezeend', () => { if (vc.pg) { vc.pg = null; return; } vc.sq = null; regrab(); });
  return vc;
});

/* ---------- hands: a glove on each controller. The laser leaves the index fingertip; trigger curls the index finger,
   holding an atom with the tweezers pinches, grip makes a fist. Built from simple shapes (no model files). ---------- */
function makeHand() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xe8eef8, emissive: 0x1b2433 });
  const g = new THREE.Group(), fingers = [], thumb = [];
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat); palm.scale.set(0.041, 0.015, 0.047); palm.position.set(0, 0, 0.105); g.add(palm);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.05, 14), mat); wrist.rotation.x = Math.PI / 2; wrist.scale.set(1.25, 1, 0.65); wrist.position.set(0, -0.002, 0.16); g.add(wrist);
  const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.074, 12), mat); knuckle.rotation.z = Math.PI / 2; knuckle.position.set(0, 0, 0.072); g.add(knuckle);
  const seg = (len, r) => { const j = new THREE.Group(), m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, len, 10), mat); m.rotation.x = Math.PI / 2; m.position.z = -len / 2; j.add(m); j.add(new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat)); return j; };
  const chain = (parent, lens, r) => { const out = []; let p = parent; for (const len of lens) { const j = seg(len, r); p.add(j); out.push(j); const nx = new THREE.Group(); nx.position.z = -len; j.add(nx); p = nx; } p.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 10, 8), mat)); return out; };
  for (const [x, L, r] of [[-0.026, [0.040, 0.024, 0.019], 0.0088], [-0.009, [0.044, 0.027, 0.020], 0.009], [0.009, [0.041, 0.025, 0.019], 0.0088], [0.026, [0.032, 0.020, 0.017], 0.0078]]) {
    const base = new THREE.Group(); base.position.set(x, 0, 0.07); g.add(base); fingers.push(chain(base, L, r));
  }
  const tb = new THREE.Group(); tb.position.set(-0.036, -0.006, 0.105); tb.rotation.set(0, 0.75, 0); g.add(tb); thumb.push(...chain(tb, [0.036, 0.03], 0.0098));
  const pose = { index: 0, thumb: 0.1, others: 0.25 };
  const apply = () => {
    const C = [1.15, 1.5, 1.1];
    fingers.forEach((ch, k) => { const c = k === 0 ? pose.index : pose.others; ch.forEach((j, q) => { j.rotation.x = -c * C[q]; }); });
    thumb[0].rotation.set(-pose.thumb * 0.35, -pose.thumb * 0.85, 0); thumb[1].rotation.set(-pose.thumb * 0.7, 0, 0);
  };
  apply(); return { group: g, pose, apply, mat };
}
for (const vc of vrc) {
  vc.hand3 = makeHand(); vc.obj.add(vc.hand3.group); vc.obj.children[0].visible = false;          // the glove replaces the stick
  vc.obj.addEventListener('connected', (e) => { vc.hand3.group.scale.x = e.data && e.data.handedness === 'left' ? -1 : 1; });
}
function makeToolHeads() {
  const P = (c, e = 0x000000) => new THREE.MeshPhongMaterial({ color: c, emissive: e, shininess: 60, specular: 0x666666 });
  const H = {}, add = (k) => (H[k] = new THREE.Group());
  const box = (g, m, w, h, d, x, y, z, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.y = ry; g.add(b); return b; };
  const cyl = (g, m, r, len, x, y, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); return c; };
  const ball = (g, m, r, x, y, z) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); s.position.set(x, y, z); g.add(s); return s; };
  { const g = add('tweezers'), m = P(0xd9c27a); box(g, m, 0.004, 0.003, 0.07, -0.006, 0, -0.025, -0.16); box(g, m, 0.004, 0.003, 0.07, 0.006, 0, -0.025, 0.16); box(g, m, 0.02, 0.006, 0.01, 0, 0, 0.012); }
  { const g = add('add'); g.userData.atom = ball(g, P(0x888888), 0.012, 0, 0.004, -0.02); const m = P(0x7be495, 0x1d5a2b); box(g, m, 0.018, 0.004, 0.004, 0, 0.022, -0.02); box(g, m, 0.004, 0.018, 0.004, 0, 0.022, -0.02); }
  { const g = add('attach'); g.userData.atom = ball(g, P(0x888888), 0.011, 0, 0, -0.035); cyl(g, P(0xcfd6e0), 0.003, 0.03, 0, 0, -0.012); }
  { const g = add('bond'), m = P(0xcfd6e0); cyl(g, m, 0.0035, 0.045, 0, 0, -0.02); ball(g, P(0x4d5360), 0.007, 0, 0, 0.003); ball(g, P(0x4d5360), 0.007, 0, 0, -0.043); }
  { const g = add('delete'); box(g, P(0xff8fa3), 0.022, 0.012, 0.03, 0, 0, -0.018); box(g, P(0x6aa8ff), 0.022, 0.0125, 0.012, 0, 0, 0.003); }
  { const g = add('zap'); cyl(g, P(0x8e9aaf), 0.008, 0.055, 0, 0, -0.01); for (const z of [-0.02, -0.03]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.0095, 0.0022, 8, 20), P(0xff6a3d, 0x5a1a00)); t.position.set(0, 0, z); g.add(t); } ball(g, P(0xff4422, 0xaa2200), 0.006, 0, 0, -0.04); }
  for (const [k, col] of [['cminus', 0x3a6cf0], ['cplus', 0xe8473a]]) { const g = add(k), m = P(col, col === 0x3a6cf0 ? 0x0a1a50 : 0x500a0a); box(g, m, 0.018, 0.016, 0.022, 0, 0, -0.005); const pm = P(0xd9c27a); box(g, pm, 0.003, 0.003, 0.016, -0.004, 0, -0.024); box(g, pm, 0.003, 0.003, 0.016, 0.004, 0, -0.024); }
  const root = new THREE.Group(); for (const k in H) { H[k].visible = false; root.add(H[k]); } root.position.z = -0.004; root.scale.setScalar(1.6);
  return { root, H };
}
for (const vc of vrc) { vc.tools = makeToolHeads(); vc.obj.add(vc.tools.root); }
const CURSORS = { tweezers: 'grab', add: 'copy', attach: 'cell', bond: 'alias', delete: 'not-allowed', zap: 'crosshair', cminus: 'pointer', cplus: 'pointer' };
let lastCursor = '';
function updateToolShapes() {
  const elCol = (isMat() && SPECIES[SP[S.cel]]) ? SPECIES[SP[S.cel]].color : 0x88a0c0;
  for (const vc of vrc) { if (!vc.tools) continue; for (const k in vc.tools.H) { const g = vc.tools.H[k], on = k === S.tool && !(vc.hit && vc.hit.ui); g.visible = on; if (on && g.userData.atom) g.userData.atom.material.color.setHex(S.tool === 'add' && !isMat() ? new THREE.Color(ELEMENTS[S.el] ? ELEMENTS[S.el].color : 0x88a0c0).getHex() : elCol); } }
  const cur = hold.src === 'mouse' && S.tool === 'tweezers' ? 'grabbing' : (CURSORS[S.tool] || 'default');
  if (cur !== lastCursor) { renderer.domElement.style.cursor = cur; lastCursor = cur; }
}
function handPose(vc, gp, dt) {
  const t = gp && gp.buttons[0] ? gp.buttons[0].value : 0, g = gp && gp.buttons[1] ? gp.buttons[1].value : 0;
  const tw = hold.src === vc.i && hold.kind === 'tw', ui_ = !!(vc.hit && vc.hit.ui), fist = vc.sq || vc.pg;
  const want = fist ? { index: 0.95, thumb: 0.8, others: 1 } : tw ? { index: 0.6, thumb: 0.9, others: 0.7 } : ui_ ? { index: 0.08 + 0.25 * t, thumb: 0.6, others: 0.9 } : { index: 0.1 + 0.8 * t, thumb: 0.15 + 0.6 * t, others: Math.max(0.25, g) };
  const a = Math.min(1, dt * 14), P = vc.hand3.pose; for (const k in want) P[k] += (want[k] - P[k]) * a; vc.hand3.apply();
}
const zapGeo = new THREE.ConeGeometry(1.6, 1.6, 28, 1, true); zapGeo.rotateX(Math.PI / 2); zapGeo.translate(0, 0, -0.8);      // apex at the hand, 1.6 m long
for (const vc of vrc) { vc.cone = new THREE.Mesh(zapGeo, new THREE.MeshBasicMaterial({ color: 0xff4422, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })); vc.cone.visible = false; vc.obj.add(vc.cone); }
// grip = pick up the experiment; both grips = scale it
let grabRef = null;
function regrab() {
  const dr = vrc.filter((v) => v.sq);
  if (!dr.length) { grabRef = null; return; }
  if (dr.length > 1) {                     // both grips: the point between the hands is the pivot; spreading the hands scales, twisting them turns
    const a = dr[0].obj.getWorldPosition(new THREE.Vector3()), b = dr[1].obj.getWorldPosition(new THREE.Vector3());
    grabRef = { two: true, a: dr[0], b: dr[1], mid0: a.clone().add(b).multiplyScalar(0.5), v0: b.clone().sub(a), pos0: simRoot.position.clone(), q0: simRoot.quaternion.clone(), s0: userScale };
    return;
  }
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
  if (grabRef.two) {
    const a = grabRef.a.obj.getWorldPosition(new THREE.Vector3()), b = grabRef.b.obj.getWorldPosition(new THREE.Vector3());
    const mid = a.clone().add(b).multiplyScalar(0.5), v = b.clone().sub(a), l0 = grabRef.v0.length(), l = v.length(); if (l0 < 0.02 || l < 0.02) return;
    const k = clamp(grabRef.s0 * l / l0, 0.15, 6) / grabRef.s0, q = new THREE.Quaternion().setFromUnitVectors(grabRef.v0.clone().normalize(), v.clone().normalize());
    simRoot.position.copy(grabRef.pos0).sub(grabRef.mid0).multiplyScalar(k).applyQuaternion(q).add(mid);
    simRoot.quaternion.copy(q).multiply(grabRef.q0); userScale = grabRef.s0 * k;
    return;
  }
  const d = grabRef.drv, q = d.obj.getWorldQuaternion(new THREE.Quaternion()), p = d.obj.getWorldPosition(new THREE.Vector3());
  simRoot.position.copy(grabRef.relP).applyQuaternion(q).add(p);
  simRoot.quaternion.copy(q).multiply(grabRef.relQ);
}

const rc = new THREE.Raycaster();
function vrInput(dt) {
  if (needRecenter > 0 && renderer.xr.getCamera().cameras && renderer.xr.getCamera().cameras.length && --needRecenter === 0) recenter();
  bench.updateMatrixWorld(true);
  for (const vc of vrc) {
    vc.hit = null; if (!vc.pg) vc.hitObj = null;
    if (!vc.src) continue;
    const o = new THREE.Vector3().setFromMatrixPosition(vc.obj.matrixWorld), d = new THREE.Vector3(0, 0, -1).transformDirection(vc.obj.matrixWorld);
    rc.set(o, d); rc.far = 3;
    const hits = rc.intersectObjects(ptMesh.visible ? [uiMesh, plotMesh, tbMesh, ptMesh] : [uiMesh, plotMesh, tbMesh], false);
    let len = 1.5;
    if (hits.length) {
      const h = hits[0]; len = h.distance; if (!vc.pg) vc.hitObj = h.object;
      const U_ = h.object === uiMesh ? ui : h.object === tbMesh ? tbar : h.object === ptMesh ? ptab : null;
      for (const o of [ui, tbar, ptab]) if (o !== U_) o.leave(vc.i);
      if (U_) { vc.hit = { ui: U_ }; U_.move(h.uv.x * U_.w, (1 - h.uv.y) * U_.h, vc.i); } else vc.hit = { ui: null };
      vc.dot.visible = true; vc.dot.position.copy(h.point);
    } else { vc.dot.visible = false; ui.leave(vc.i); tbar.leave(vc.i); ptab.leave(vc.i); }
    vc.laser.scale.z = len; handPose(vc, vc.src.gamepad, dt);
    vc.cone.visible = S.tool === 'zap'; if (vc.cone.visible) { const s = Math.tan(S.zapDeg * Math.PI / 180); vc.cone.scale.set(s, s, 1); }
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
let last = now(), lastUI = 0, lastPlot = 0, lastTB = 0, lastPT = 0;
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
  if (S.escape && isMat() && md.N && !S.paused) escapeCheck();
  updateFlashes(dt); updateToolShapes(); updateThermo(t);

  // transport: the live part (bond currents, current at the bias) a few times a second while atoms move; the curves on demand
  if (isMat() && S.cm.size && S.cp.size && !TR.busy) {
    const moving = !S.paused || md.ext.i >= 0;
    if (TR.dirtyAt && t - TR.dirtyAt > 250) { TR.dirtyAt = 0; TR.curve = null; requestTransport(true); }
    else if (S.live && moving && t - TR.last > 250 && (S.tab === TAB_ELEC || S.curBonds || S.arrows)) requestTransport(S.tab === TAB_ELEC && (!TR.curve || t - TR.curveAt > 2000));
    else if (TR.res && TR.res.N !== mat.N && t - TR.last > 250) requestTransport(false);          // atoms were added: refresh
    else if (S.tab === TAB_ELEC && !TR.curve && !TR.err && t - TR.last > 400) requestTransport(true);
  }
  updateAtoms();

  if (ui.pressed || ui.released || (ui.dirty && t - lastUI >= (S.vr ? 33 : 0)) || t - lastUI > (S.vr ? 130 : 90)) { drawControls(); lastUI = t; if (S.vr) uiTex.needsUpdate = true; }
  if (tbar.pressed || tbar.released || tbar.dirty || t - lastTB > 150) { drawToolbar(); lastTB = t; if (S.vr) tbTex.needsUpdate = true; }
  if (S.ptOpen && (ptab.pressed || ptab.released || ptab.dirty || t - lastPT > 200)) { drawPtable(); lastPT = t; if (S.vr) ptTex.needsUpdate = true; }
  ptMesh.visible = S.vr && S.ptOpen; dom.pt.style.display = S.ptOpen ? '' : 'none';
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
  document.body.classList.toggle('light', S.theme === 'light'); setBtn(dom.themeBtn, S.theme === 'light' ? 'Dark lab' : 'White lab');
  ui.dirty = true; lastPlot = 0;
  try { localStorage.setItem('mdlab.theme', S.theme); } catch (e) { /* no storage */ }
}
setLang(S.lang); applyTheme(S.theme); applyLangDom(); applyQuality();
setTableHeight(0.9, false);

build(B, { quiet: true });
md.run(300);
renderer.setAnimationLoop(frame);
window.__mdlab = { setQuality, atoms, controls, setLangUI, THERMO, thermoDrag, loadSystem, saveCurrent, loadSaved, readSaved, tbar, ptab, tbMesh, ptMesh, LOCO, vign, dolly, TASKS, get md() { return md; }, mat, lj, isMat, S, B, H, build, ui, renderer, camera, scene, simRoot, vrc, applyTask, toolDown, toolUp, hold, enterVR,
  TR, applyTheme, setTableHeight, contactsAtEnds, requestTransport, placePanels, uiMesh, plotMesh, deskTop };
