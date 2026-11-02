// 2DPHYS Atomic Workbench (formerly MD Lab VR) - build and run molecular dynamics and electron transport in WebXR
// (Meta Quest browser, or a Quest on a PC through SteamVR/OpenXR) - or on the desktop with mouse.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MD, ELEMENTS, units, MAXN, clamp } from './physics.js';
import { Mat, TU_FS, SPECIES, TERSOFF, SP } from './materials.js';
import { CHEM_ELEMENTS, VALENCE } from './chem.js';
import { UI, COL, setPalette, roundRect, fitText } from './ui.js';
import { ICONS } from './icons.js';
import { buildSubstrate, SUB_KINDS } from './substrate.js';
import { drawPlots, drawElec, PW, PH } from './plots.js';
import { analyse as analyseNow } from './tb.js';
import { tr, setLang, addLanguage } from './i18n.js';
import { DA } from './i18n-da.js';
import { TUT_STEPS, TUT_DA } from './tutorial.js';
import { createNanoWorld, WALK_DA } from './nanowalk.js';
addLanguage('da', Object.assign({}, DA, TUT_DA, WALK_DA));
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
  color: 'speed', tool: 'hand', trail: true, bonds: true, grab: 'atom', addSp: 3, dtFs: 1.0, tag: 0, tab: 0, taskPage: 0, helpPage: 0,
  rows: [], msg: '', msgUntil: 0, D: null, vr: false, xr: null, sps: 0, lastBuild: null, plots: true, panel: true,
  cel: 'C', fillH: false, bondA: -1,                                                       // chemistry tools
  theme: 'dark', tableH: 0.9, moveSpeed: 1.2, snapTurn: true, vignette: true,          // room and seated movement
  cm: new Set(), cp: new Set(), gamma: 1.0, bias: 0.2, arrows: false, curBonds: true, live: true, Tlog: false,     // electron transport (ELEC tab)
  substrate: 'none', lang: 'en', level: 'adult', tutAsk: false, buildN: null, hoverTool: null, walk: false, wa: null, tut: -1, tutOk: false, tutAt: 0, quality: 'high', thermoOn: true, atomR: 0.32, sameSize: true, bondR: 0.08, ptOpen: false, zapDeg: 6, escape: true, saveDel: false, savePage: 0,
  sys: { sel: 'graphene', size: 10, layers: 2, open: true, rad: 7, n: 6, m: 6, len: 4, nmol: 5, rings: 3, T: 300 },                                 // SETTINGS tab, periodic-table popup
};
const TABS = ['BUILD', 'RUN', 'DATA', 'LAB', 'ELEC', 'VR', 'SETTINGS', 'SYSTEMS'], TAB_ELEC = 4, TAB_VR = 5, TAB_SYS = 7;
try { const v = JSON.parse(localStorage.getItem('mdlab.view') || '{}'); for (const k of ['lang', 'level', 'quality', 'thermoOn', 'atomR', 'sameSize', 'bondR', 'arrows', 'curBonds', 'zapDeg', 'escape']) if (k in v) S[k] = v[k]; } catch (e) { /* no storage */ }
try { const t = localStorage.getItem('mdlab.theme'); if (t === 'light' || t === 'dark') S.theme = t; } catch (e) { /* no storage */ }
const ljUnits = (el) => { const u = units(el); u.msdnm2 = (v) => v * u.sigma * u.sigma * 1e18; return u; };
const matUnits = () => ({ K: (T) => T, Tstar: (T) => T, nm: (r) => r * 0.1, ps: (t) => t * TU_FS / 1000, fs: (t) => t * TU_FS, bar: () => 0, eV: (e) => e, D_m2s: (D) => D * 1e-20 / (TU_FS * 1e-15), msdnm2: (v) => v * 0.01, sigma: 1, eps: 1 });
let U = ljUnits(S.el);
const isMat = () => md === mat;
const dims = () => isMat() ? [mat.Lx, mat.Ly, mat.Lz] : [md.L, md.L, md.L];
const perAxis = () => isMat() ? mat.per : (md.periodic ? [true, true, true] : [false, false, false]);
const now = () => performance.now();
const toast = (m, ms = 4000) => { S.msg = m; S.msgUntil = now() + ms; showDomToast(m, ms); };
let domToastT = 0;
function showDomToast(m, ms) { const el = document.getElementById('toast'); if (!el || S.vr) return; el.textContent = tr(m); el.classList.add('on'); clearTimeout(domToastT); domToastT = setTimeout(() => el.classList.remove('on'), Math.min(ms, 9000)); }

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
  SIM_HOME.y = homeY();
  if (dh && typeof tbMesh !== "undefined") { tbMesh.position.y += dh; ptMesh.position.y += dh; }
  if (moveSim && dh) { simRoot.position.y += dh; if (!S.vr) { controls.target.y += dh; camera.position.y += dh; } }
}
let userScale = 1, wps = 0.1;
/* The experiment hovers above the table - unless it has a substrate: then the substrate lies on the table (its lowest atoms just touch the
   worktop) and the structure sits on it. Walking uses the same surface (see walkPlace). */
function homeY() {
  const sb = isMat() && md.N ? mat.sub : null; if (!sb) return S.tableH + 0.43;
  const [, Ly, Lz] = dims(), Lup = mat.sheet ? Lz : Ly;
  return S.tableH + 0.025 + (Lup / 2 - sb.wMin + 0.85 * S.atomR) * wps;
}
function tableFit() {                                            // called when the fit key (substrate, size, table height) changes
  const y0 = SIM_HOME.y; SIM_HOME.y = homeY(); const dh = SIM_HOME.y - y0; if (S.walk || S.wa || Math.abs(dh) < 1e-6) return;
  if (S.vr) { bench.updateMatrixWorld(true); simRoot.position.copy(SIM_HOME).applyMatrix4(bench.matrixWorld); simRoot.quaternion.copy(bench.quaternion); }
  else { simRoot.position.y = SIM_HOME.y; controls.target.y += dh; camera.position.y += dh; }
}
let fitKey = '';                                     // wps = metres per sigma at build time

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
const bondGeoWalk = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), sphereWalkCache = {};
function sphereWalk(N, lo) { const k = (lo ? 8 : N <= 400 ? 26 : N <= 1500 ? 16 : 12), key = k + ''; return sphereWalkCache[key] || (sphereWalkCache[key] = new THREE.SphereGeometry(1, k, Math.max(6, Math.round(k * 0.7)))); }
let subGeoLow = null, bondGeoHigh = null, bondMatHigh = null; const bondGeoLow = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), bondMatLow = new THREE.MeshLambertMaterial({ color: 0xffffff });
function applyQuality() {
  const lo = S.quality === 'low';
  atoms.geometry = lo ? (S.walk ? sphereWalk(md.N, true) : sphereCoarse) : (S.walk ? sphereWalk(md.N, false) : sphereLo); atoms.material = lo ? atomMatLow : atomMat;
  if (typeof bondsMesh !== 'undefined') { if (!bondGeoHigh) { bondGeoHigh = bondsMesh.geometry; bondMatHigh = bondsMesh.material; } bondsMesh.geometry = lo ? bondGeoLow : (S.walk ? bondGeoWalk : bondGeoHigh); bondsMesh.material = lo ? bondMatLow : bondMatHigh; }
  rim.visible = !lo || S.walk;
  if (typeof subAtoms !== 'undefined') { if (!subGeoLow) subGeoLow = subAtoms.geometry; subAtoms.geometry = S.walk && !lo && subAtoms.count < 2500 ? sphereWalk(1000, false) : subGeoLow; }
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
  S.lastBuild = Object.assign({}, recipe); S.buildN = null; clearContacts();
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

function buildInto(m, r) {
  const T0 = r.Tm, n = Math.round(r.size), ny = Math.max(2, Math.round(n / 1.73));
  if (r.mat === 'empty') m.buildEmpty(30);
  else if (r.mat === 'benzene') m.buildBenzene(Math.round(r.nmol), T0);
  else if (r.mat === 'graphene') m.buildGraphene(n, ny, T0, 1, false, !!r.open);
  else if (r.mat === 'graphite') m.buildGraphite(n, ny, Math.round(r.layers), T0, !!r.open);
  else if (r.mat === 'mos2') m.buildMoS2(n, ny, Math.round(r.layers), T0, !!r.open);
  else if (r.mat === 'cnt') m.buildCNT(r.n, r.m, r.len, T0);
  else if (r.mat === 'c60') m.buildC60(T0);
  else if (r.mat === 'hbn') m.buildHBN(n, ny, T0, !!r.open);
  else if (r.mat === 'junction') m.buildJunction(r.rings, T0);
  else m.buildNanodiamond(r.rad, T0);
  if (r.chem && m.model !== 'uff') m.toChem(T0);
}
// Load a system as a BUILDING BLOCK: it is built on its own and placed 6 A beside the current structure, so nothing bonds
// until you push the two together with the Hand. Carbon + carbon keeps the reactive model; anything else switches both
// to the chemistry model. MoS2 combines only with MoS2 (its potential has no partners). A periodic sheet cannot take a block.
function addBlock() {
  if (!isMat() || !mat.N) { loadSystem(); return; }
  if (mat.periodicAny) { toast('A block can only be added to an open structure (a flake, tube or molecule), not to a periodic sheet'); return; }
  const Y = S.sys, r = Object.assign({}, B, { sys: 'mat', mat: Y.sel, size: Y.size, layers: Y.layers, open: true, rad: Y.rad, n: Y.n, m: Y.m, len: Y.len, nmol: Y.nmol, rings: Y.rings, Tm: Y.T, chem: false });
  const o = new Mat(1200);
  try { buildInto(o, r); } catch (e) { toast(String(e.message || e)); return; }
  if (o.periodicAny) { toast('That system is periodic; choose Open flake to use it as a block'); return; }
  if (mat.N + o.N > mat.maxN) { toast(`Too many atoms: ${mat.N} + ${o.N} (at most ${mat.maxN})`); return; }
  const sw = mat.model === 'sw' || o.model === 'sw';
  if (sw && !(mat.model === 'sw' && o.model === 'sw')) { toast('MoS\u2082 can only be combined with MoS\u2082 - its potential has no partner elements'); return; }
  const allC = (m) => { for (let i = 0; i < m.N; i++) if (m.sp[i] !== SP.C) return false; return true; };
  try {
    if (!sw && !(mat.model === 'tersoff' && o.model === 'tersoff' && allC(mat) && allC(o))) { if (mat.model !== 'uff') mat.toChemLive(); if (o.model !== 'uff') o.toChem(Y.T); S.dtFs = mat.dt * TU_FS; }
  } catch (e) { toast(String(e.message || e)); return; }
  const box = (m) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.N; i++) { const p = [m.x[i], m.y[i], m.z[i]]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } } return { lo, hi }; };
  const a = box(mat), b = box(o), up = mat.sheet ? 2 : 1, side = up === 2 ? 1 : 2;      // beside the structure along x, centred in the other two
  const d = [a.hi[0] + 6 - b.lo[0], 0, 0]; d[up] = (a.lo[up] + a.hi[up]) / 2 - (b.lo[up] + b.hi[up]) / 2; d[side] = (a.lo[side] + a.hi[side]) / 2 - (b.lo[side] + b.hi[side]) / 2;
  try { mat.mergeFrom(o, d[0], d[1], d[2]); } catch (e) { toast(String(e.message || e)); return; }
  rebox(); mat.name = `${mat.name.replace(/ \u00B7 chemistry$/, '')} + ${o.name}`;
  applySubstrate(); resetHistory(); ui.dirty = true;
  toast(`Added ${o.name} (${o.N} atoms) as a block. Take the Hand and push it onto the structure to join them.`, 6000);
}
// keep every atom inside the (open) box after something was added: shift and grow the box where needed
function rebox() {
  const L = [mat.Lx, mat.Ly, mat.Lz], P = [mat.x, mat.y, mat.z];
  for (let k = 0; k < 3; k++) {
    if (mat.per[k]) continue; let lo = 1e9, hi = -1e9; for (let i = 0; i < mat.N; i++) { lo = Math.min(lo, P[k][i]); hi = Math.max(hi, P[k][i]); }
    if (lo < 5 || hi > L[k] - 5) { const sh = 8 - lo; for (let i = 0; i < mat.N; i++) P[k][i] += sh; L[k] = Math.max(L[k], hi - lo + 16); if (mat.ext.i >= 0) { const e = mat.ext; if (k === 0) e.x += sh; else if (k === 1) e.y += sh; else e.z += sh; } }
  }
  mat.Lx = L[0]; mat.Ly = L[1]; mat.Lz = L[2]; mat.listDirty = true; mat.computeForces();
}
/* ---------- the fixed substrate (src/substrate.js): about the size of the circle on the table, under the structure ---------- */
const SUB_COL = { C: 0x4a5160, Mo: 0x3f9a9a, S: 0xcdb03c, Si: 0xb8966e, O: 0xc23a30 };
const subAtoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), 9000);
subAtoms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(9000 * 3), 3); subAtoms.count = 0; subAtoms.frustumCulled = false; inner.add(subAtoms);
let subDrawnR = 0;
function drawSubstrate() {
  const sb = isMat() ? mat.sub : null; subAtoms.count = 0; if (!sb) return;
  const n = Math.min(sb.n, 9000), m = subAtoms.instanceMatrix.array, c = subAtoms.instanceColor.array, s = S.atomR * 0.85, col = new THREE.Color();
  for (let k = 0; k < n; k++) { const j = 16 * k; m.fill(0, j, j + 16); m[j] = m[j + 5] = m[j + 10] = s; m[j + 15] = 1; m[j + 12] = sb.x[k]; m[j + 13] = sb.y[k]; m[j + 14] = sb.z[k]; col.setHex(SUB_COL[sb.el[k]] || 0x888888); c[3 * k] = col.r; c[3 * k + 1] = col.g; c[3 * k + 2] = col.b; }
  subAtoms.count = n; subAtoms.instanceMatrix.needsUpdate = true; subAtoms.instanceColor.needsUpdate = true; subDrawnR = S.atomR;
}
function applySubstrate() {
  if (!isMat()) return;
  if (S.substrate === 'none' || !mat.N || mat.model === 'ff') { mat.sub = null; drawSubstrate(); if (mat.N) mat.computeForces(); return; }
  const axis = mat.sheet ? 'z' : 'y', up = axis === 'z' ? mat.z : mat.y, other = axis === 'z' ? mat.y : mat.z;
  let a = 0, b = 0, low = 1e9; for (let i = 0; i < mat.N; i++) { a += mat.x[i]; b += other[i]; low = Math.min(low, up[i]); }
  let ext = 0; for (let i = 0; i < mat.N; i++) ext = Math.max(ext, Math.hypot(mat.x[i] - a / mat.N, other[i] - b / mat.N));
  const R = clamp(Math.max(0.3 / (wps * userScale), ext + 10), 15, 55);      // the circle on the table, but always 10 A beyond the structure
  mat.sub = buildSubstrate(S.substrate, axis, [a / mat.N, b / mat.N], low - 3.4, R); mat.computeForces(); drawSubstrate();
}
function buildMat(r, opts) {
  const T0 = r.Tm, n = Math.round(r.size), ny = Math.max(2, Math.round(n / 1.73));
  S.bondA = -1;
  if (r.chem && r.mat === 'mos2') { toast('MoS\u2082 is not available in the chemistry mode - built with its own potential'); r = Object.assign({}, r, { chem: false }); }
  try { buildInto(mat, r); } catch (e) { toast(String(e.message || e)); return; }
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
  applySubstrate();
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
  removeAtomsBatch(hit); pulse(src, 0.7, 40); tutEvent('zap'); return true;
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
  for (const hi of HOVER.values()) if (hi >= 0 && hi < N) {        // the atom under the laser or the mouse: bigger and glowing cyan-white
    const k = 16 * hi; m[k] *= 1.35; m[k + 5] *= 1.35; m[k + 10] *= 1.35;
    c[3 * hi] = 0.4 * c[3 * hi] + 0.6 * 0.7; c[3 * hi + 1] = 0.4 * c[3 * hi + 1] + 0.6 * 1.0; c[3 * hi + 2] = 0.4 * c[3 * hi + 2] + 0.6 * 1.0;
  }
  if (subAtoms.count && subDrawnR !== S.atomR) drawSubstrate();
  atoms.instanceMatrix.needsUpdate = true; atoms.instanceColor.needsUpdate = true;
  updateBonds(); updateArrows();

  const [Lx, Ly, Lz] = dims();
  inner.position.set(-Lx / 2, -Ly / 2, -Lz / 2);
  boxEdges.scale.set(Lx, Ly, Lz); boxEdges.position.set(Lx / 2, Ly / 2, Lz / 2);
  boxFaces.scale.set(Lx, Ly, Lz); boxFaces.position.set(Lx / 2, Ly / 2, Lz / 2);
  const showBox = (!mt || mat.periodicAny) && !S.walk;
  boxEdges.visible = showBox; boxFaces.visible = showBox && !mt && !md.periodic;
  boxEdges.material.opacity = (mt || md.periodic) ? 0.5 : 0.95;
  if (!S.walk && !S.wa) { const sb = mt ? mat.sub : null, key = `${sb ? sb.kind + sb.wMin.toFixed(2) : '-'}|${wps}|${S.atomR}|${S.tableH}|${Lx.toFixed(0)}${Ly.toFixed(0)}${Lz.toFixed(0)}`; if (key !== fitKey) { fitKey = key; tableFit(); } }
  simRoot.scale.setScalar(walkScale((mt ? wps : Math.min(wps, 0.85 / Lx)) * userScale));
  if (S.walk && mt) walkPlace();
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
/* ---------- levels: Kid, Adult (non-expert), Researcher. Same simulation; the level only decides what is shown and how.
   Tools are pictograms with a colour per kind: teal = grab, green = build, red/orange = remove, blue/red = electrodes. ---------- */
const famCol = (e) => (FAMILY[FAM_OF[e] || 'unknown'] || ['', '#cccccc'])[1];
const nudgeT = (f) => { const [lo, hi] = tRange(); S.thermo = true; S.TsetK = clamp(Math.round(S.TsetK * f / 5) * 5, lo, hi); ui.dirty = true; tbar.dirty = true; tutEvent(f > 1 ? 'warm' : 'cool'); };
const TOOLDEF = {
  camera: { l: 'Camera', icon: ICONS.camera, tint: '#b48cff', on: () => S.tool === 'camera', act: () => selectTool('camera') },
  hand: { l: 'Hand', icon: ICONS.hand, tint: '#f2b880', on: () => S.tool === 'hand', act: () => selectTool('hand') },
  tweezers: { l: 'Tweezers', icon: ICONS.tweezers, tint: '#2bd3cf', on: () => S.tool === 'tweezers', act: () => selectTool('tweezers') },
  add: { l: 'Add', icon: ICONS.add, tint: '#5fd38a', on: () => S.tool === 'add', act: () => selectTool('add') },
  attach: { l: 'Attach', icon: ICONS.attach, tint: '#5fd38a', on: () => S.tool === 'attach', act: () => selectTool('attach') },
  bond: { l: 'Bond', icon: ICONS.bond, tint: '#5fd38a', on: () => S.tool === 'bond', act: () => selectTool('bond') },
  delete: { l: 'Delete', icon: ICONS.delete, tint: '#ff6b6b', on: () => S.tool === 'delete', act: () => selectTool('delete') },
  zap: { l: 'Zap', icon: ICONS.zap, tint: '#ff9f43', on: () => S.tool === 'zap', act: () => selectTool('zap') },
  element: { l: () => `${S.cel} \u25BE`, icon: ICONS.element, arg: () => S.cel, tint: () => famCol(S.cel), on: () => S.ptOpen, act: () => { S.ptOpen = !S.ptOpen; ptab.dirty = true; } },
  hfill: { l: 'H fill', icon: ICONS.hfill, tint: '#d8dde6', on: () => S.fillH, act: () => { S.fillH = !S.fillH; } },
  cminus: { l: '\u2212 contact', icon: ICONS.cminus, tint: '#4aa3ff', on: () => S.tool === 'cminus', act: () => selectTool('cminus') },
  cplus: { l: '+ contact', icon: ICONS.cplus, tint: '#ff5a5a', on: () => S.tool === 'cplus', act: () => selectTool('cplus') },
  run: { l: () => (S.paused ? 'Run' : 'Pause'), dynIcon: () => (S.paused ? ICONS.run : ICONS.pause), tint: '#ffd166', on: () => S.paused, act: () => { S.paused = !S.paused; tutEvent(S.paused ? 'pause' : 'run'); } },
  cool: { l: 'Colder', icon: ICONS.cold, tint: '#5fb6ff', on: () => false, act: () => nudgeT(1 / 1.5) },
  warm: { l: 'Warmer', icon: ICONS.warm, tint: '#ff8a5c', on: () => false, act: () => nudgeT(1.5) },
  wand: { l: 'Bring', icon: ICONS.wand, tint: '#ffd166', on: () => S.tool === 'wand', act: () => selectTool('wand') },
  walk: { l: 'Walk', icon: ICONS.walk, tint: '#7be0ff', on: () => S.walk || !!S.wa, act: () => toggleWalk() },
  help: { l: 'Guide', icon: ICONS.help, tint: '#b48cff', on: () => S.tut >= 0, act: () => toggleTutorial() },
  rebuild: { l: 'Start again', icon: ICONS.rebuild, tint: '#c3cad6', on: () => false, act: () => { if (S.lastBuild) build(S.lastBuild, { keepColor: true }); } },
};
const TB_LEVEL = {
  kid: ['hand', 'add', 'zap', 'wand', 'cool', 'warm', 'run', 'camera', 'rebuild', 'walk', 'help'],
  adult: ['hand', 'add', 'attach', 'bond', 'delete', 'zap', 'wand', 'element', 'cool', 'warm', 'run', 'camera', 'walk', 'help'],
  researcher: ['hand', 'tweezers', 'add', 'attach', 'bond', 'delete', 'zap', 'wand', 'element', 'hfill', 'cminus', 'cplus', 'run', 'camera', 'walk', 'help'],
};
const TB_TUT = ['hand', 'add', 'delete', 'zap', 'cool', 'warm', 'run', 'help'];             // the toolbar while the tutorial runs, whatever the level
const val = (v) => (typeof v === 'function' ? v() : v), iconOf = (d) => (d.dynIcon ? d.dynIcon() : d.icon);
function drawToolbar() {
  const tut = S.tut >= 0, list = tut ? TB_TUT : (TB_LEVEL[S.level] || TB_LEVEL.researcher), kid = S.level === 'kid' && !tut, hl = tut ? TUT_STEPS[S.tut].tool : null;
  tbar.begin(); tbar.y = 13; tbar.row(list.length); let hov = null;
  for (const k of list) {
    const d = TOOLDEF[k], r = tbar._rect(66); if (tbar._hover(r)) hov = k;
    if (tbar.button(kid ? '' : val(d.l), { icon: iconOf(d), iconArg: d.arg ? d.arg() : undefined, tint: val(d.tint), active: d.on(), h: 66, size: list.length > 14 ? 13 : list.length > 10 ? 15 : 17 })) { d.act(); tbar.dirty = true; ui.dirty = true; }
    if (k === hl) { const c = tbar.ctx; c.save(); c.strokeStyle = '#ffd166'; c.lineWidth = 3 + 2 * Math.sin(now() / 220); roundRect(c, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 16); c.stroke(); c.restore(); }
  }
  if (hov !== S.hoverTool) { S.hoverTool = hov; ui.dirty = true; }
  tbar.end(); if (tut) tbar.dirty = true;                                          // keeps the highlight pulsing
}
const LEVELS = [['kid', 'Kid', ICONS.kid], ['adult', 'Adult', ICONS.adult], ['researcher', 'Researcher', ICONS.researcher]];
function setLevel(l, force) {
  if (!TB_LEVEL[l] || (l === S.level && !force)) return;
  S.level = l; S.ptOpen = false;
  if (!TB_LEVEL[l].includes(S.tool)) selectTool(TB_LEVEL[l][0]);
  if (l === 'kid') { S.cel = 'C'; S.addSp = SP.C; S.fillH = false; }
  S.tab = 0; S.plots = l === 'researcher' && window.innerWidth >= 760; dom.plots.style.display = S.plots ? '' : 'none';
  if (S.vr) plotMesh.visible = l === 'researcher';
  ui.dirty = true; tbar.dirty = true; ptab.dirty = true;
  toast(l === 'kid' ? 'Kid level: pictures and simple tools' : l === 'adult' ? 'Adult level: the essentials, with short explanations' : 'Researcher level: everything', 4000);
}
// leaving the Kid level takes three taps within two seconds, so a child does not end up in the expert panels by accident
const levelTaps = { l: '', n: 0, t: 0 };
function levelRow(h = 64) {
  ui.row(3);
  for (const [l, lab, ic] of LEVELS) if (ui.button(lab, { icon: ic, tint: '#2bd3cf', active: S.level === l, h, size: 16 })) {
    if (S.level !== 'kid' || l === 'kid') setLevel(l);
    else { const t = now(); if (levelTaps.l !== l || t - levelTaps.t > 2000) { levelTaps.l = l; levelTaps.n = 0; levelTaps.t = t; } if (++levelTaps.n >= 3) { levelTaps.n = 0; setLevel(l); } else toast(`Tap ${3 - levelTaps.n} more times to change the level`, 1500); }
  }
}
const KID_SYS = [['graphene', 'Graphene', ICONS.graphene, '#2bd3cf'], ['cnt', 'Nanotube', ICONS.nanotube, '#5fd38a'], ['c60', 'Football', ICONS.c60, '#ffd166'],
  ['benzene', 'Benzene', ICONS.benzene, '#ff9f43'], ['nanodiamond', 'Diamond', ICONS.nanodiamond, '#9fd3ff'], ['graphite', 'Graphite', ICONS.graphite, '#c3cad6']];
const ADULT_SYS = KID_SYS.concat([['hbn', 'hBN', ICONS.graphene, '#b9a6ff'], ['mos2', 'MoS\u2082', ICONS.graphite, '#f2d43d'], ['junction', 'Molecule wire', ICONS.benzene, '#f2c14e']]);
function systemCards(list, h) {
  for (let k = 0; k < list.length; k += 3) {
    ui.row(3);
    for (const [key, lab, ic, col] of list.slice(k, k + 3)) if (ui.button(lab, { icon: ic, tint: col, active: S.sys.sel === key && S.lastBuild && S.lastBuild.mat === key, h, size: 17 })) { S.sys.sel = key; loadSystem(); }
  }
}
// a temperature bar: blue (cold) to red (hot), white tick = now, ring = target
function tempBar(h = 64) {
  const r = ui._rect(h), c = ui.ctx, [lo, hi] = tRange(), T = U.K(md.temperature()), fx = (v) => r.x + 10 + (r.w - 20) * tFrac(v);
  const g = c.createLinearGradient(r.x, 0, r.x + r.w, 0); g.addColorStop(0, '#3d7cff'); g.addColorStop(0.5, '#f3d36b'); g.addColorStop(1, '#ff4b3e');
  c.fillStyle = g; roundRect(c, r.x + 10, r.y + h * 0.42, r.w - 20, h * 0.28, h * 0.14); c.fill();
  c.fillStyle = '#ffffff'; c.fillRect(fx(T) - 3, r.y + h * 0.3, 6, h * 0.52);
  if (S.thermo) { c.strokeStyle = COL.text; c.lineWidth = 3; c.beginPath(); c.arc(fx(S.TsetK), r.y + h * 0.56, h * 0.2, 0, Math.PI * 2); c.stroke(); }
  c.font = '700 22px system-ui,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = COL.text; c.fillText(`${T.toFixed(0)} K`, r.x + 10, r.y + h * 0.14);
  c.textAlign = 'right'; c.fillStyle = COL.muted; c.font = '18px system-ui,sans-serif'; c.fillText(`${lo} \u2013 ${hi} K`, r.x + r.w - 10, r.y + h * 0.14);
  ui._advance(h);
}
/* ---------- tutorial: a guided tour of the basic tools on a graphene sheet (src/tutorial.js). The toolbar switches to the tools
   in play, the next one pulses, and the panel shows the step. Tool code reports what the user did through tutEvent(). ---------- */
function startTutorial() {
  S.tutAsk = false;
  S.sys.sel = 'graphene'; S.sys.open = true; loadSystem();
  S.paused = false; S.ptOpen = false; S.tab = 0; selectTool('hand'); S.tut = 0; S.tutOk = false;
  ui.dirty = true; tbar.dirty = true;
}
function stopTutorial() { S.tut = -1; S.tutOk = false; ui.dirty = true; tbar.dirty = true; }
const structureDirty = () => !!md.N && (md.N !== S.buildN || S.cm.size > 0 || S.cp.size > 0 || S.substrate !== 'none' || !S.lastBuild || S.lastBuild.mat !== 'graphene' || S.lastBuild.sys !== 'mat');
function toggleTutorial() { if (S.tut >= 0) stopTutorial(); else if (S.tutAsk) { S.tutAsk = false; ui.dirty = true; } else if (structureDirty()) { S.tutAsk = true; ui.dirty = true; } else startTutorial(); }
function drawTutAsk() {
  ui.begin(); ui.hdrR = 52; ui.header('TUTORIAL', ''); helpBtn(); ui.space(10);
  ui.paragraph('The tutorial starts with a fresh graphene sheet, so your current structure would be replaced.', { size: 26 }); ui.space(14);
  if (ui.button('Save my structure, then start', { h: 76, primary: true, size: 24 })) { saveCurrent(); S.tutAsk = false; startTutorial(); }
  if (ui.button('Start (replace my structure)', { h: 76, size: 24 })) { S.tutAsk = false; startTutorial(); }
  if (ui.button('Cancel', { h: 76, size: 24 })) { S.tutAsk = false; ui.dirty = true; }
  ui.end();
}
function tutGo(k) { S.tut = clamp(k, 0, TUT_STEPS.length - 1); S.tutOk = false; ui.dirty = true; tbar.dirty = true; }
function tutEvent(ev) { const st = S.tut >= 0 && TUT_STEPS[S.tut]; if (st && st.ev === ev && !S.tutOk) { S.tutOk = true; S.tutAt = now(); } }
// the round "?" in the panel header (all levels)
function helpBtn() {
  const r = { x: CW - ui.pad - 44, y: ui.pad - 4, w: 44, h: 44 }, hov = ui._hover(r), c = ui.ctx; if (hov) ui.cursorOver = true;
  c.fillStyle = hov ? COL.hover : COL.card2; c.beginPath(); c.arc(r.x + 22, r.y + 22, 22, 0, Math.PI * 2); c.fill();
  c.save(); ICONS.help(c, r.x + 22, r.y + 22, 14, S.tut >= 0 ? COL.accent : COL.text); c.restore();
  if (hov && ui.pressed && ui.owner !== null) toggleTutorial();
}
function drawFooter(text, warn) {                                   // one line at the bottom of the panel; long text shrinks, then gets an ellipsis (desktop also shows the full text as a toast)
  const c = ui.ctx; c.fillStyle = COL.card; c.fillRect(ui.pad, CH - 56, CW - 2 * ui.pad, 36);
  c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = warn ? COL.warn : COL.muted; text = tr(text); const maxW = CW - 2 * ui.pad - 24;
  let size = 20; c.font = size + 'px system-ui,Segoe UI,sans-serif'; while (size > 15 && c.measureText(text).width > maxW) { size--; c.font = size + 'px system-ui,Segoe UI,sans-serif'; }
  c.fillText(fitText(c, text, maxW), ui.pad + 12, CH - 38);
}
function drawTutorial() {
  const st = TUT_STEPS[S.tut], N = TUT_STEPS.length;
  if (st.ev === 'pause' && S.paused) tutEvent('pause'); else if (st.ev === 'run' && !S.paused) tutEvent('run');
  if (S.tutOk && !st.last && now() - S.tutAt > 2200) tutGo(S.tut + 1);
  ui.begin(); ui.hdrR = 52; ui.header('TUTORIAL', `Step ${S.tut + 1} of ${N}`); helpBtn();
  ui.bar((S.tut + (S.tutOk || st.last ? 1 : 0)) / N); ui.space(6);
  tempBar(64); ui.space(2);
  ui.section(st.title);
  if (st.tool) { const d = TOOLDEF[st.tool]; if (ui.button(`Use the tool: ${val(d.l)}`, { icon: iconOf(d), tint: d.tint, active: d.on(), h: 150, size: 21 })) { d.act(); tbar.dirty = true; } }
  ui.paragraph(S.vr && st.vr ? st.vr : st.text, { size: 25 });
  if (S.tutOk) ui.label('\u2713 ' + tr('Well done!'), { size: 28, bold: true, color: COL.good });
  ui.y = CH - 214;
  ui.row(2);
  if (ui.button('\u25C0 ' + tr('Back'), { h: 64, disabled: S.tut === 0, size: 24 })) tutGo(S.tut - 1);
  if (ui.button(st.last ? tr('Finish') : tr('Next') + ' \u25B6', { h: 64, primary: true, active: S.tutOk || st.last, size: 24 })) { if (st.last) stopTutorial(); else tutGo(S.tut + 1); }
  ui.row(2);
  if (ui.button('Rebuild sheet', { h: 56, size: 21 })) { S.sys.sel = 'graphene'; loadSystem(); S.paused = false; toast('Rebuilt the graphene sheet', 2500); }
  if (ui.button('Exit', { h: 56, size: 21 })) stopTutorial();
  drawFooter(now() < S.msgUntil ? S.msg : toolHint(S.hoverTool || S.tool), now() < S.msgUntil);
  ui.end();
}
function drawKid() {
  ui.begin(); ui.hdrR = 52; ui.header('ATOMIC WORKBENCH', md.N ? `${md.name} \u00B7 ${md.N} atoms` : 'empty'); helpBtn();
  tempBar(70); ui.space(2);
  systemCards(KID_SYS, 170); ui.space(6);
  ui.row(3);
  for (const k of ['cool', 'warm', 'run']) { const d = TOOLDEF[k]; if (ui.button('', { icon: iconOf(d), tint: d.tint, active: d.on(), h: 160 })) { d.act(); tbar.dirty = true; } }
  ui.row(3);
  for (const k of ['hand', 'add', 'zap']) { const d = TOOLDEF[k]; if (ui.button('', { icon: iconOf(d), tint: d.tint, active: d.on(), h: 150 })) { d.act(); tbar.dirty = true; } }
  ui.space(6); levelRow(84);
  ui.end();
}
function adultBuild() {
  ui.section('Pick a material or molecule');
  systemCards(ADULT_SYS, 132);
  const Y = S.sys;
  if (['graphene', 'hbn', 'graphite', 'mos2'].includes(Y.sel)) Y.size = ui.slider('asz', 'Size', clamp(Y.size, 4, 12), 4, 12, (v) => `${(Math.round(v) * 0.249).toFixed(1)} nm`, { step: 1, h: 60 });
  ui.row(2); if (ui.button('Replace', { primary: true, h: 56 })) loadSystem(); if (ui.button('Add next to it', { h: 56 })) addBlock();
  ui.label('Surface underneath:', { size: 20 });
  { const sb = ui.choice(SUB_KINDS, S.substrate, { h: 48, size: 19 }); if (sb !== S.substrate) { S.substrate = sb; applySubstrate(); } }
  ui.paragraph('Use the tools on the table to grab, add, bond or remove atoms. Atoms you push together can bond.', { size: 22, color: COL.muted });
}
function adultRun() {
  ui.row(2);
  if (ui.button(S.paused ? '\u25B6  Run' : '\u275A\u275A  Pause', { primary: !S.paused, active: S.paused, h: 62 })) S.paused = !S.paused;
  if (ui.button('Start again', { h: 62 })) { if (S.lastBuild) build(S.lastBuild, { keepColor: true }); }

  S.thermo = ui.toggle('Keep the temperature', S.thermo);
  const [lo, hi] = tRange(); S.TsetK = ui.slider('aT', 'Temperature', S.TsetK, lo, hi, (v) => `${v.toFixed(0)} K`, { step: 5, h: 64 });
  ui.paragraph('Heat makes the atoms shake. Very hot: bonds break. Cold: everything freezes still.', { size: 22, color: COL.muted });
}
function adultElec() {
  ui.paragraph('Mark where the current goes in (\u2212) and out (+). Bonds then light up: violet = little current, yellow = a lot.', { size: 22, color: COL.muted });
  ui.row(3); for (const k of ['cminus', 'cplus', 'hand']) { const d = TOOLDEF[k]; if (ui.button(d.l, { icon: d.icon, tint: d.tint, active: d.on(), h: 96, size: 19 })) { d.act(); tbar.dirty = true; } }
  ui.row(2);
  if (ui.button('Contacts at the ends', { h: 52, size: 20 })) contactsAtEnds();
  if (ui.button('Clear contacts', { h: 52, size: 20 })) { clearContacts(); ui.dirty = true; }
  S.curBonds = ui.toggle('Colour the bonds by current', S.curBonds, { h: 50 });
  if (TR.res && TR.res.TEF !== undefined) { ui.readout('How easily electrons pass', `${(100 * Math.min(1, TR.res.TEF)).toFixed(0)} %`, { color: COL.accent }); if (TR.res.TEF < 0.005) ui.paragraph('Nothing gets through: are both contacts on the same connected piece?', { size: 18, color: COL.warn }); }
  else if (TR.err) ui.label(TR.err, { size: 18, color: COL.muted });
}
const ADULT_TABS = [[0, 'BUILD'], [1, 'RUN'], [TAB_ELEC, 'ELEC'], [6, 'SETTINGS']];
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
  if (S.tutAsk) return drawTutAsk();
  if (S.tut >= 0) return drawTutorial();
  if (S.level === 'kid') return drawKid();
  const mt = isMat(), T = U.K(md.temperature());
  ui.begin();
  if (S.level === 'adult') {
    ui.hdrR = 52; ui.header('ATOMIC WORKBENCH', md.N ? `${md.name} \u00B7 ${md.N} atoms` : 'empty box'); helpBtn();
    tempBar(64); ui.space(2);
    let ai = ADULT_TABS.findIndex(([t]) => t === S.tab); if (ai < 0) { ai = 0; S.tab = 0; }
    ai = ui.tabs(ADULT_TABS.map(([, l]) => l), ai, 17); S.tab = ADULT_TABS[ai][0];
    ui.space(2);
    [adultBuild, adultRun, adultElec, tabSettings][ai]();
    drawFooter(now() < S.msgUntil ? S.msg : toolHint(S.hoverTool || S.tool), now() < S.msgUntil);
    ui.end(); return;
  }
  ui.hdrR = 52;
  ui.header('ATOMIC WORKBENCH', md.N ? (mt ? `${md.name} \u00B7 ${md.N} atoms` : `${S.el} \u00B7 ${md.N} atoms \u00B7 box ${U.nm(md.L).toFixed(2)} nm`) : 'empty box'); helpBtn();
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
  const msgOn = now() < S.msgUntil;
  const fN = md.ext.i >= 0 ? (isMat() ? md.extForceEV * 1.602177 : md.extForce * 60 * (U.eps / U.sigma) * 1e9) : 0;
  drawFooter(msgOn ? S.msg : fN > 0 ? `Tweezer force: ${fN.toFixed(fN < 10 ? 2 : 1)} nN` : toolHint(S.hoverTool || S.tool), msgOn);
  ui.end();
}

function toolHint(t = S.tool) {
  const trig = S.vr ? 'trigger' : 'click';
  if (t === 'zap') return `Tool: ANNIHILATOR - hold ${trig}: every atom in the ${S.zapDeg.toFixed(0)}\u00B0 cone is removed`;
  if (t === 'wand') return `Tool: BRING - hold ${trig} on a piece out of reach: the wand pulls it to you; let go to drop it`;
  if (t === 'attach') return `Tool: ATTACH ${S.cel}${S.fillH ? ' (+H)' : ''} - ${trig} an atom; the new atom goes on the side you point from`;
  if (t === 'bond') return `Tool: BOND - ${trig} two atoms to connect them (valence permitting)`;
  if (t === 'cminus' || t === 'cplus') return `Tool: ${t === 'cminus' ? '\u2212' : '+'} CONTACT - ${trig} (or drag over) atoms; again to remove`;
  if (t === 'camera') return S.vr ? 'Tool: CAMERA - aim and press the trigger; the photo goes to the Downloads folder on the PC' : 'Tool: CAMERA - click in the view to take a photo (1920 x 1080 PNG, saved to Downloads)';
  if (t === 'hand') return S.vr ? 'Tool: HAND - trigger grabs an atom or a loose piece (pull hard to break it off); grip carries a piece' : 'Tool: HAND - drag an atom or a loose piece; pull hard to break it off';
  if (t === 'walk') return 'WALK - be made small and walk on the structure (atom 30 cm, bond 1.5 m). Esc or this button: back to the lab';
  if (t === 'help') return 'GUIDE - a short tour of the basic tools on a graphene sheet';
  if (t === 'cool' || t === 'warm') return t === 'warm' ? 'WARMER - raise the target temperature: the atoms shake harder' : 'COLDER - lower the target temperature: the atoms calm down';
  if (t === 'run') return 'RUN / PAUSE - let time flow or freeze the atoms (space bar)';
  if (t === 'rebuild') return 'START AGAIN - rebuild the current structure from scratch';
  if (t === 'element') return 'ELEMENT - choose which element Attach and Add use';
  if (t === 'hfill') return 'H FILL - fill free valences with hydrogen when attaching';
  if (t === 'tweezers') return `Tool: TWEEZERS - hold ${trig} on an atom and drag`;
  return t === 'add' ? `Tool: ADD ATOM - ${trig} on or next to the structure` : `Tool: DELETE - ${trig} an atom to remove it`;
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

function homeView() { const dx = window.innerWidth < 760 ? 0 : 0.14; controls.target.set(SIM_HOME.x + dx, SIM_HOME.y, SIM_HOME.z); camera.position.set(SIM_HOME.x + 0.44 + dx, SIM_HOME.y + 0.27, SIM_HOME.z + 0.92); controls.update(); }   // close enough to see the atoms, structure left of the panel
function recenterSim() { userScale = 1; if (S.vr) recenter(); else { simRoot.position.copy(SIM_HOME); simRoot.quaternion.identity(); homeView(); } }

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
  ui.row(2); if (ui.button('Replace system', { primary: true, h: 52, size: 20 })) loadSystem(); if (ui.button('Add as a block', { h: 52, size: 20 })) addBlock();
  ui.label('Substrate (fixed atoms, van der Waals only):', { size: 17 });
  { const sb = ui.choice(SUB_KINDS, S.substrate, { h: 42, size: 18 }); if (sb !== S.substrate) { S.substrate = sb; applySubstrate(); } }
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
  S.setPage = ui.choice([['a', 'General'], ['b', 'Display']], S.setPage || 'a', { h: 46, size: 19 });
  if (S.setPage !== 'b') {
  ui.section('Walking');
  if (ui.button(S.walk ? 'Back to the lab' : 'Make me small and let me walk on the structure', { icon: ICONS.walk, tint: '#7be0ff', active: S.walk, h: 72, size: 18 })) toggleWalk();
  ui.section('Level');
  levelRow(62);
  ui.section('Language / Sprog  \u00B7  Graphics');
  ui.row(4);
  for (const [v, l, f] of [['en', 'English', ICONS.flagGB], ['da', 'Dansk', ICONS.flagDK]]) if (ui.button(l, { icon: f, tint: COL.accent, active: S.lang === v, h: 76, size: 20 }) && S.lang !== v) setLangUI(v);
  for (const [v, l] of [['high', 'High quality'], ['low', 'Low quality']]) if (ui.button(l, { active: S.quality === v, h: 76, size: 19 }) && S.quality !== v) setQuality(v);
  } else {
  ui.section('Atoms and bonds');
  S.atomR = ui.slider('atomR', 'Atom size', S.atomR, 0.12, 0.6, (v) => `${v.toFixed(2)} \u00C5 radius`, { step: 0.01, h: 58 });
  S.sameSize = ui.toggle('Same size for every element', S.sameSize, { h: 50 });
  S.bondR = ui.slider('bondR', 'Bond width', S.bondR, 0.02, 0.16, (v) => `${(2 * v).toFixed(2)} \u00C5`, { step: 0.005, h: 58 });
  S.bonds = ui.toggle('Show bonds', S.bonds, { h: 50 });
  ui.section('Current (ELEC tab)');
  ui.row(2); S.curBonds = ui.toggle('Colour by current', S.curBonds, { h: 50 }); S.arrows = ui.toggle('Arrows', S.arrows, { h: 50 });
  ui.paragraph('Violet = little current \u2192 red \u2192 yellow = the most; grey = none. Arrows: conventional current, + to \u2212.', { size: 18, color: COL.muted });
  ui.section('Annihilator and boundary');
  S.zapDeg = ui.slider('zap', 'Annihilator cone (half angle)', S.zapDeg, 1, 25, (v) => `${v.toFixed(0)}\u00B0`, { step: 1, h: 60 });
  S.escape = ui.toggle('Remove atoms that fly out of reach', S.escape, { h: 48 });
  S.thermoOn = ui.toggle('Thermometer on the table', S.thermoOn, { h: 48 });
  }
  try { localStorage.setItem('mdlab.view', JSON.stringify({ lang: S.lang, level: S.level, quality: S.quality, thermoOn: S.thermoOn, atomR: S.atomR, sameSize: S.sameSize, bondR: S.bondR, arrows: S.arrows, curBonds: S.curBonds, zapDeg: S.zapDeg, escape: S.escape })); } catch (e) { /* no storage */ }
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
  en: '<b>Mouse:</b> drag an atom with the Hand \u00B7 drag empty space to orbit \u00B7 right-drag to pan \u00B7 wheel to zoom<br><b>Keys:</b> space run/pause \u00B7 1\u20139 tools \u00B7 F fit view \u00B7 R rebuild \u00B7 P plots \u00B7 T dark/white lab \u00B7 Walk mode: W A S D, Esc',
  da: '<b>Mus:</b> tr\u00E6k et atom med H\u00E5nden \u00B7 tr\u00E6k i tomt rum for at dreje \u00B7 h\u00F8jre-tr\u00E6k for at flytte \u00B7 hjul for at zoome<br><b>Taster:</b> mellemrum k\u00F8r/pause \u00B7 1\u20139 v\u00E6rkt\u00F8jer \u00B7 F tilpas visning \u00B7 R byg igen \u00B7 P grafer \u00B7 T m\u00F8rkt/lyst laboratorium \u00B7 G\u00E5-tilstand: W A S D, Esc',
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
if (window.innerWidth < 760) { S.plots = false; dom.plots.style.display = 'none'; S.panel = false; dom.ui.style.display = 'none'; }

/* ================================================================== picking / tools (shared by mouse and VR) */
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3();
function toLocal(o, d) {
  inner.updateWorldMatrix(true, false);
  tmpM.copy(inner.matrixWorld).invert();
  const lo = o.clone().applyMatrix4(tmpM), ld = d.clone().transformDirection(tmpM);
  return { o: lo, d: ld, s: simRoot.scale.x };
}
// the atom the ray points at: of the atoms within Rpick of the ray (A; 1.6 for materials, so a laser between the atoms of a
// sheet still finds it), take the front layer (within 1.5 A of the nearest one) and in it the atom closest to the ray
function pickAtom(o, d, Rpick = 0) {
  const r = toLocal(o, d), R = S.walk ? (Rpick >= 5 ? Rpick * 0.35 : Rpick ? 0.7 : 0.55) : (Rpick || (isMat() ? 1.6 : 0.7)), R2 = R * R; let tmin = 1e9;
  const T = new Float64Array(md.N), D2 = new Float64Array(md.N);
  for (let i = 0; i < md.N; i++) {
    const px = md.x[i] - r.o.x, py = md.y[i] - r.o.y, pz = md.z[i] - r.o.z;
    const t = px * r.d.x + py * r.d.y + pz * r.d.z; T[i] = t; D2[i] = t < 0 ? 1e9 : px * px + py * py + pz * pz - t * t;
    if (D2[i] < R2 && t < tmin) tmin = t;
  }
  if (tmin === 1e9) return null;
  let best = -1, bd = 1e9; for (let i = 0; i < md.N; i++) if (D2[i] < R2 && T[i] < tmin + 1.5 && D2[i] < bd) { bd = D2[i]; best = i; }
  return { i: best, t: T[best], s: r.s };
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
  if (S.tool === 'camera') { shoot(src); return true; }
  if (S.tool === 'wand') {
    if (!isMat() || !md.N || carry) return false;
    const p = pickAtom(o, d, 6); if (!p) { toast('Point the wand at the structure'); return true; }
    startWand(src, p.i); pulse(src, 0.6, 50); return true;
  }
  if (S.tool === 'zap') { hold.src = src; hold.kind = 'zap'; hold.next = now() + 120; if (!doZap(src, o, d)) toast('Nothing in the cone - aim at the structure'); return true; }
  if (S.tool === 'attach' || S.tool === 'bond') {
    if (!ensureChem()) return false;
    const p = pickAtom(o, d); if (!p) return false;
    if (S.tool === 'attach') {
      const r = toLocal(o, d).o, res = mat.chem.attach(p.i, S.cel, S.fillH, [r.x, r.y, r.z], true);
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
  if (S.tool === 'tweezers' || S.tool === 'hand') {
    const p = pickAtom(o, d); if (!p) return false;
    if (S.tool === 'hand') { grabAt(src, o, d, p, 'hand'); pulse(src, 0.5, 40); return true; }
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
    hold.src = null; hold.kind = null; toast(S.tool === 'add' ? 'Click on or just next to the structure to add an atom' : 'Click directly on an atom to delete it'); return false;
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
  pulse(src, 0.25, 20); tutEvent('add'); return true;
}
function doDel(src, o, d) {
  const p = pickAtom(o, d); if (!p) return false;
  removeAtomAt(p.i); pulse(src, 0.4, 30); tutEvent('del'); return true;
}
// Hand grabs. mode 'hand': a loose piece (at most half the atoms) moves whole, otherwise the atom itself is pulled hard
// (it breaks out); mode 'sheet': the whole layer the atom belongs to (grip button)
const HAND_PULL = { kk: 20, cap: 40 };                                   // eV/A^2, eV/A - test/hand.test.mjs uses the same numbers
function grabAt(src, o, d, p, mode) {
  let frag = null, grp = false;
  if (isMat()) {
    if (mode === 'sheet') grp = true;
    else { frag = mat.fragmentMask(p.i); if (frag.n < 2 || frag.n > md.N / 2) frag = null; }
  }
  const w0 = o.clone().addScaledVector(d, p.t * p.s), r0 = toLocal(w0, d).o;
  const ref = frag ? mat.maskCOM(p.i, frag.mask) : grp ? mat.groupCOM(p.i) : [md.x[p.i], md.y[p.i], md.z[p.i]];
  hold.src = src; hold.kind = 'tw'; hold.byGrip = mode === 'sheet'; hold.grab = { i: p.i, dist: p.t * p.s, off: [ref[0] - r0.x, ref[1] - r0.y, ref[2] - r0.z] };
  if (isMat()) {
    md.ext.mask = frag ? frag.mask : null; md.ext.kk = frag || grp ? 0 : HAND_PULL.kk; md.ext.cap = frag || grp ? 0 : HAND_PULL.cap;
    md.ext.anchor = null;
    if (mode === 'hand' && !frag) {                // pulling one atom out of a big piece: the rest is held in place
      const rest = mat.fragmentMask(p.i).mask; rest[p.i] = 0; let any = false; for (let k = 0; k < md.N; k++) if (rest[k]) { any = true; break; }
      if (any) md.ext.anchor = mat.anchorFor(rest);
    }
  }
  md.ext.i = p.i; md.ext.mode = frag ? 'frag' : grp ? 'group' : 'atom'; tutEvent('grab');
}
function toolUp(src) {
  if (carry && carry.wand && carry.src === src) stopCarry();
  if (hold.src !== src) return;
  if (hold.kind === 'tw') { md.ext.i = -1; md.ext.kk = 0; md.ext.cap = 0; md.ext.anchor = null; }
  hold.byGrip = false;
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
const HOVER = new Map();                                       // pointer (controller index or 'mouse') -> atom it points at
let mouseIn = false;
function updateMouseHover() { HOVER.delete('mouse'); if (!S.vr && mouseIn && md.N && S.tool !== 'camera') { const p = pickAtom(mouseRay.origin, mouseRay.direction); if (p) HOVER.set('mouse', p.i); } }
function setMouse(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera); mouseRay.copy(ray.ray);
}
const controls = new OrbitControls(camera, renderer.domElement);
renderer.domElement.addEventListener('pointerdown', (e) => {
  setMouse(e);
  let hit = false;
  if (e.button === 0 && e.shiftKey && !S.vr && isMat() && md.N && !carry) { const p = pickAtom(mouseRay.origin, mouseRay.direction, 2.0); if (p) { startCarry('mouse', p.i); hit = true; } }
  if (!hit) hit = e.button === 0 && !S.vr && toolDown('mouse');
  controls.mouseButtons.LEFT = hit ? -1 : THREE.MOUSE.ROTATE; controls.touches.ONE = hit ? -1 : THREE.TOUCH.ROTATE;
}, true);
renderer.domElement.addEventListener('pointermove', (e) => { setMouse(e); mouseIn = true; }, true);
renderer.domElement.addEventListener('pointerleave', () => { mouseIn = false; });
window.addEventListener('pointerup', () => { toolUp('mouse'); if (carry && carry.src === 'mouse') stopCarry(); });
renderer.domElement.addEventListener('wheel', (e) => { if (carry && carry.src === 'mouse') { mouseHand.userData.dist = Math.max(0.05, mouseHand.userData.dist * (1 + Math.sign(e.deltaY) * 0.08)); e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false });
controls.target.copy(SIM_HOME); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.3; controls.maxDistance = 6;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
homeView();
window.addEventListener('keydown', (e) => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if (e.code === 'Space') { S.paused = !S.paused; e.preventDefault(); }
  else if (e.key === '1') S.tool = 'tweezers'; else if (e.key === '2') S.tool = 'add'; else if (e.key === '3') S.tool = 'delete';
  else if (e.key === '4') S.tool = 'cminus'; else if (e.key === '5') S.tool = 'cplus';
  else if (e.key === '8') S.tool = 'zap'; else if (e.key === '9') S.tool = 'wand';
  else if (e.key === '6') S.tool = 'attach'; else if (e.key === '7') { S.tool = 'bond'; S.bondA = -1; }
  else if (e.key === 'Escape') { S.bondA = -1; if (S.walk) exitWalk(); }
  else if (e.key === 't' || e.key === 'T') applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  else if (e.key === 'f' || e.key === 'F') { if (!S.vr && !S.walk) homeView(); }
  else if (e.key === 'r' || e.key === 'R') { if (S.lastBuild) build(S.lastBuild); }
  else if (e.key === 'p' || e.key === 'P') dom.plotBtn.click();
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); if (!S.vr) renderer.setSize(window.innerWidth, window.innerHeight); });

/* ================================================================== WebXR */
const xrState = { supported: false };
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { xrState.supported = ok; setBtn(dom.vrBtn, ok ? 'Enter VR' : 'VR not detected'); dom.vrBtn.classList.toggle('on', ok); dom.vrBtn.classList.toggle('off', !ok); dom.vrBtn.title = ok ? '' : 'No VR headset found - press for setup help'; }).catch(() => { dom.vrBtn.textContent = 'VR not detected'; });
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
    const r = new THREE.Vector3(-f.z, 0, f.x), s = S.moveSpeed * dt * (S.walk ? 1.8 : 1);          // r = f x up
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
  if (S.walk || S.wa) exitWalk(true);
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0);
  S.vr = true; needRecenter = 4; document.body.classList.add('vr');
  // the headset's own recentre (e.g. holding the Meta button) moves the tracking origin: put the table back in front of the user
  try { const rs = renderer.xr.getReferenceSpace(); if (rs && rs.addEventListener) rs.addEventListener('reset', () => { needRecenter = 3; }); } catch (e) { /* not supported */ }
  uiMesh.visible = plotMesh.visible = tbMesh.visible = true; plotMesh.visible = S.level === 'researcher';
  S.xr = renderer.xr.getSession();
});
renderer.xr.addEventListener('sessionend', () => {
  if (S.walk || S.wa) exitWalk(true);
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); vign.visible = false;
  S.vr = false; document.body.classList.remove('vr'); uiMesh.visible = plotMesh.visible = tbMesh.visible = ptMesh.visible = false;
  bench.position.set(0, 0, 0); bench.rotation.set(0, 0, 0); simRoot.position.copy(SIM_HOME); simRoot.quaternion.identity(); userScale = 1;
  for (const vc of vrc) { vc.src = null; vc.obj.visible = false; vc.sq = null; vc.hit = null; toolUp(vc.i); }
  S.xr = null; renderer.setSize(window.innerWidth, window.innerHeight);
  setTableHeight(0.9, false); placePanels(1.32); simRoot.position.copy(SIM_HOME);
  homeView();
});

function recenter() {
  if (S.walk) { benchToHead(); return; }
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
    if (isMat() && md.N && !carry) { const r = rayOf(i), p = pickAtom(r.o, r.d, 2.0); if (p) { startCarry(i, p.i); vc.sheet = true; pulse(i, 0.5, 40); return; } }
    if (S.walk) return;
    vc.sq = true; regrab();
  });
  obj.addEventListener('squeezeend', () => { if (vc.pg) { vc.pg = null; return; } if (vc.sheet) { vc.sheet = false; stopCarry(); return; } vc.sq = null; regrab(); });
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
/* ---------- the camera tool: a camera on the controller (VR) or the view itself (desktop). Shoot = trigger / click.
   A photo is rendered on its own at 1920 x 1080 (lasers, pointer dots and the camera itself hidden), saved as a PNG to the
   browser's download folder and shown as a print on the table. ---------- */
const CAM = {
  cam: new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 60),
  preview: new THREE.WebGLRenderTarget(256, 144), photo: null, n: 0, last: null, lastPreview: 0,
};
CAM.preview.texture.colorSpace = THREE.SRGBColorSpace;
function camPose(src) {                                   // put the photo camera where the lens is (VR) or where the view is (desktop)
  if (src === 'mouse' || src === undefined || src === null || !S.vr) { camera.updateMatrixWorld(); CAM.cam.position.setFromMatrixPosition(camera.matrixWorld); CAM.cam.quaternion.setFromRotationMatrix(camera.matrixWorld); CAM.cam.fov = camera.fov; }
  else { const o = vrc[src].obj; o.updateMatrixWorld(); o.getWorldQuaternion(CAM.cam.quaternion); o.getWorldPosition(CAM.cam.position); CAM.cam.position.add(new THREE.Vector3(0, 0, -0.075).applyQuaternion(CAM.cam.quaternion)); CAM.cam.fov = 55; }
  CAM.cam.aspect = 16 / 9; CAM.cam.updateProjectionMatrix(); CAM.cam.updateMatrixWorld();
}
function renderInto(rt) {
  const hidden = [];
  for (const vc of vrc) for (const o of [vc.laser, vc.dot, vc.tools && vc.tools.root]) if (o && o.visible) { o.visible = false; hidden.push(o); }
  const xr = renderer.xr.enabled, prev = renderer.getRenderTarget();
  renderer.xr.enabled = false; renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, CAM.cam); renderer.setRenderTarget(prev); renderer.xr.enabled = xr;
  for (const o of hidden) o.visible = true;
}
function camPreviewSrc() { const v = vrc.find((c) => c.src && c.hand === 'right') || vrc.find((c) => c.src); return v ? v.i : null; }
function updateCamPreview(t) {                            // the live picture on the back of the VR camera, a few times a second
  if (!S.vr || S.tool !== 'camera' || t - CAM.lastPreview < (S.quality === 'low' ? 200 : 90)) return;
  const s = camPreviewSrc(); if (s === null) return; CAM.lastPreview = t; camPose(s); renderInto(CAM.preview);
}
function stamp() { const d = new Date(), p = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function shoot(src) {
  const W = S.quality === 'low' ? 1280 : 1920, H = Math.round(W * 9 / 16);
  if (!CAM.photo || CAM.photo.width !== W) { if (CAM.photo) CAM.photo.dispose(); CAM.photo = new THREE.WebGLRenderTarget(W, H, { samples: 4 }); CAM.photo.texture.colorSpace = THREE.SRGBColorSpace; }
  camPose(src); renderInto(CAM.photo);
  const px = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(CAM.photo, 0, 0, W, H, px);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);      // WebGL rows run bottom-up
  for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255;
  c.putImageData(img, 0, 0);
  CAM.n++; const name = `2DPHYS-workbench_${stamp()}.png`;
  cv.toBlob((blob) => {
    if (!blob) { toast('Could not save the photo'); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    CAM.last = { name, url }; setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, 'image/png');
  showPrint(cv); camFlash(src);
  toast(`Photo saved to your Downloads folder: ${name}`, 5000);
}
// the latest photo lies on the table as a print, so in the headset you see that it worked
const printTex = new THREE.CanvasTexture(document.createElement('canvas')); printTex.colorSpace = THREE.SRGBColorSpace;
const printMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.256, 0.162), new THREE.MeshBasicMaterial({ map: printTex, toneMapped: false })); printMesh.visible = false;
printMesh.rotation.set(-Math.PI / 2, 0, 0.3); printMesh.position.set(-0.4, 0.027, 0.2); deskTop.add(printMesh);   // front left of the table top
function showPrint(src) {
  const cv = printTex.image; cv.width = 512; cv.height = 324; const c = cv.getContext('2d');
  c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, 512, 324); c.drawImage(src, 16, 16, 480, 270); c.fillStyle = '#5a5a5a'; c.font = '18px system-ui,sans-serif'; c.textAlign = 'right'; c.fillText(stamp().replace('_', '  '), 496, 312);
  printTex.needsUpdate = true; printMesh.visible = true;
}
function camFlash(src) {
  if (S.vr && src !== 'mouse') { pulse(src, 0.7, 60); for (const vc of vrc) { const s = vc.tools && vc.tools.H.camera && vc.tools.H.camera.userData.screen; if (s) { s.material.color.setRGB(4, 4, 4); setTimeout(() => s.material.color.setRGB(1, 1, 1), 120); } } }
  else { const f = document.createElement('div'); f.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:.85;pointer-events:none;transition:opacity .35s;z-index:99'; document.body.appendChild(f); requestAnimationFrame(() => { f.style.opacity = '0'; }); setTimeout(() => f.remove(), 450); }
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
  { const g = add('wand'), m = P(0xffd166, 0x5a3f00); cyl(g, P(0x30384a), 0.0035, 0.07, 0, 0, -0.02); const star = new THREE.Group(); star.position.set(0, 0, -0.062); for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) { const b = new THREE.Mesh(new THREE.BoxGeometry(a % (Math.PI / 2) === 0 ? 0.026 : 0.017, 0.0035, 0.0035), m); b.rotation.z = a; star.add(b); } ball(star, m, 0.006, 0, 0, 0); g.add(star); }
  { const g = add('delete'); box(g, P(0xff8fa3), 0.022, 0.012, 0.03, 0, 0, -0.018); box(g, P(0x6aa8ff), 0.022, 0.0125, 0.012, 0, 0, 0.003); }
  { const g = add('zap'); cyl(g, P(0x8e9aaf), 0.008, 0.055, 0, 0, -0.01); for (const z of [-0.02, -0.03]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.0095, 0.0022, 8, 20), P(0xff6a3d, 0x5a1a00)); t.position.set(0, 0, z); g.add(t); } ball(g, P(0xff4422, 0xaa2200), 0.006, 0, 0, -0.04); }
  for (const [k, col] of [['cminus', 0x3a6cf0], ['cplus', 0xe8473a]]) { const g = add(k), m = P(col, col === 0x3a6cf0 ? 0x0a1a50 : 0x500a0a); box(g, m, 0.018, 0.016, 0.022, 0, 0, -0.005); const pm = P(0xd9c27a); box(g, pm, 0.003, 0.003, 0.016, -0.004, 0, -0.024); box(g, pm, 0.003, 0.003, 0.016, 0.004, 0, -0.024); }
  { const g = add('camera'); box(g, P(0x2a2f3a), 0.05, 0.03, 0.022, 0, 0, -0.012); box(g, P(0x2a2f3a), 0.016, 0.008, 0.012, -0.012, 0.018, -0.012);
    cyl(g, P(0x111418), 0.009, 0.014, 0, 0, -0.03); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0095, 0.0016, 8, 20), P(0xb48cff, 0x2a1050)); ring.position.set(0, 0, -0.037); g.add(ring);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.0248), new THREE.MeshBasicMaterial({ map: CAM.preview.texture, toneMapped: false })); scr.position.set(0, 0, -0.0005); g.add(scr); g.userData.screen = scr; }
  const root = new THREE.Group(); for (const k in H) { H[k].visible = false; root.add(H[k]); } root.position.z = -0.004; root.scale.setScalar(1.6);
  return { root, H };
}
for (const vc of vrc) { vc.tools = makeToolHeads(); vc.obj.add(vc.tools.root); }
const CURSORS = { camera: 'zoom-in', hand: 'grab', tweezers: 'grab', add: 'copy', attach: 'cell', bond: 'alias', delete: 'not-allowed', zap: 'crosshair', wand: 'grab', cminus: 'pointer', cplus: 'pointer' };
let lastCursor = '';
function updateToolShapes() {
  const elCol = (isMat() && SPECIES[SP[S.cel]]) ? SPECIES[SP[S.cel]].color : 0x88a0c0;
  for (const vc of vrc) { if (!vc.tools) continue; for (const k in vc.tools.H) { const g = vc.tools.H[k], on = k === S.tool && !(vc.hit && vc.hit.ui); g.visible = on; if (on && g.userData.atom) g.userData.atom.material.color.setHex(S.tool === 'add' && !isMat() ? new THREE.Color(ELEMENTS[S.el] ? ELEMENTS[S.el].color : 0x88a0c0).getHex() : elCol); } }
  const cur = hold.src === 'mouse' && (S.tool === 'tweezers' || S.tool === 'hand') ? 'grabbing' : (CURSORS[S.tool] || 'default');
  if (cur !== lastCursor) { renderer.domElement.style.cursor = cur; lastCursor = cur; }
}
function handPose(vc, gp, dt) {
  const t = gp && gp.buttons[0] ? gp.buttons[0].value : 0, g = gp && gp.buttons[1] ? gp.buttons[1].value : 0;
  const handGrab = hold.src === vc.i && hold.kind === 'tw' && S.tool === 'hand', tw = hold.src === vc.i && hold.kind === 'tw' && !handGrab, ui_ = !!(vc.hit && vc.hit.ui), fist = vc.sq || vc.pg || handGrab || vc.sheet;
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
/* ---------- carrying a piece with the grip: the connected piece you point at (bonds, or bond-length contacts, so each
   graphite layer is its own piece) follows the hand like a held block - moved and turned - while everything else stays.
   Each of its atoms is pulled by a soft damped spring to where the hand puts it (Mat.carry), so it still feels the
   others: lay graphene on hBN and the van der Waals attraction takes over when you let go. ---------- */
let carry = null;
const mouseHand = new THREE.Object3D(); scene.add(mouseHand);
const carryObj = (src) => (src === 'mouse' ? mouseHand : vrc[src].obj);
function startCarry(src, atom) {
  if (src === 'mouse') { const w = new THREE.Vector3(mat.x[atom], mat.y[atom], mat.z[atom]).applyMatrix4(inner.matrixWorld); mouseHand.userData.dist = w.distanceTo(mouseRay.origin); mouseHand.position.copy(mouseRay.origin).addScaledVector(mouseRay.direction, mouseHand.userData.dist); mouseHand.quaternion.copy(camera.quaternion); }
  const fm = mat.fragmentMask(atom), N = mat.N, p0 = new Float64Array(3 * N);
  for (let i = 0; i < N; i++) if (fm.mask[i]) { p0[3 * i] = mat.x[i]; p0[3 * i + 1] = mat.y[i]; p0[3 * i + 2] = mat.z[i]; }
  carryObj(src).updateMatrixWorld(); inner.updateMatrixWorld();
  const M0 = new THREE.Matrix4().copy(carryObj(src).matrixWorld).invert().multiply(inner.matrixWorld);      // atom (box coordinates) -> hand
  carry = { src, N, mask: fm.mask, p0, M0, n: fm.n };
  mat.carry = { mask: fm.mask, p: Float64Array.from(p0), ka: 3 };
  toast(src === 'mouse' ? `Holding ${fm.n} atom${fm.n === 1 ? '' : 's'} - move the mouse (wheel: nearer / farther), release to put it down` : `Holding ${fm.n} atom${fm.n === 1 ? '' : 's'} - move and turn your hand, let go of the grip to put it down`, 3000);
}
/* ---------- the "bring to me" wand: a piece out of reach (high above you when you are tiny) is pulled to the tip of the wand and held there,
   a reach away along the pointing direction, but nearer eye height than where you aim; let go and it is dropped. ---------- */
const wandBeam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, fog: false }));
wandBeam.frustumCulled = false; wandBeam.visible = false; scene.add(wandBeam);
function startWand(src, atom) {
  const fm = mat.fragmentMask(atom), N = mat.N, p0 = new Float64Array(3 * N), c = new THREE.Vector3();
  for (let i = 0; i < N; i++) if (fm.mask[i]) { p0[3 * i] = mat.x[i]; p0[3 * i + 1] = mat.y[i]; p0[3 * i + 2] = mat.z[i]; c.x += mat.x[i]; c.y += mat.y[i]; c.z += mat.z[i]; }
  c.divideScalar(Math.max(1, fm.n)); let rad = 0;
  for (let i = 0; i < N; i++) if (fm.mask[i]) rad = Math.max(rad, Math.hypot(mat.x[i] - c.x, mat.y[i] - c.y, mat.z[i] - c.z));
  carry = { src, N, mask: fm.mask, p0, M0: null, n: fm.n, wand: { cb: c, off: new THREE.Vector3(), rad, t: now() } };
  mat.carry = { mask: fm.mask, p: Float64Array.from(p0), ka: 3 };
  toast(`Pulling ${fm.n} atom${fm.n === 1 ? '' : 's'} to you - swing the wand to place them, let go to drop them`, 3500);
}
const wV = new THREE.Vector3(), wT = new THREE.Vector3(), wI = new THREE.Matrix4();
function updateWand() {
  const w = carry.wand, t = now(), dt = Math.min(0.1, (t - w.t) / 1000); w.t = t;
  const { o, d } = rayOf(carry.src); inner.updateMatrixWorld();
  d.y *= 0.3; d.normalize();                                                     // aim high, it comes to about eye level
  wT.copy(o).addScaledVector(d, w.rad * simRoot.scale.x + (S.walk ? 1.5 : 0.3));
  wV.copy(w.cb).add(w.off).applyMatrix4(inner.matrixWorld);                      // the piece's centre in the world now
  wV.lerp(wT, 1 - Math.exp(-dt * 2.2));
  wI.copy(inner.matrixWorld).invert(); wV.applyMatrix4(wI); w.off.copy(wV).sub(w.cb);
  const p = mat.carry.p, p0 = carry.p0, m = carry.mask;
  for (let i = 0; i < carry.N; i++) if (m[i]) { p[3 * i] = p0[3 * i] + w.off.x; p[3 * i + 1] = p0[3 * i + 1] + w.off.y; p[3 * i + 2] = p0[3 * i + 2] + w.off.z; }
  const bp = wandBeam.geometry.attributes.position, c = wV.copy(w.cb).add(w.off).applyMatrix4(inner.matrixWorld);
  bp.setXYZ(0, o.x, o.y - 0.03, o.z); bp.setXYZ(1, c.x, c.y, c.z); bp.needsUpdate = true; wandBeam.visible = true;
}
function stopCarry() { carry = null; wandBeam.visible = false; if (isMat()) mat.carry = null; }
const cM = new THREE.Matrix4(), cV = new THREE.Vector3();
function updateCarry() {
  if (!carry) return;
  if (!isMat() || mat.N !== carry.N || !mat.carry) { stopCarry(); return; }
  if (carry.wand) { updateWand(); return; }
  if (carry.src === 'mouse') mouseHand.position.copy(mouseRay.origin).addScaledVector(mouseRay.direction, mouseHand.userData.dist);
  carryObj(carry.src).updateMatrixWorld(); inner.updateMatrixWorld();
  cM.copy(inner.matrixWorld).invert().multiply(carryObj(carry.src).matrixWorld).multiply(carry.M0);         // box -> hand(now) -> box
  const p = mat.carry.p, p0 = carry.p0, m = carry.mask;
  for (let i = 0; i < carry.N; i++) if (m[i]) { cV.set(p0[3 * i], p0[3 * i + 1], p0[3 * i + 2]).applyMatrix4(cM); p[3 * i] = cV.x; p[3 * i + 1] = cV.y; p[3 * i + 2] = cV.z; }
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
    let len = S.walk ? 14 : 1.5;
    if (hits.length) {
      const h = hits[0]; len = h.distance; if (!vc.pg) vc.hitObj = h.object;
      const U_ = h.object === uiMesh ? ui : h.object === tbMesh ? tbar : h.object === ptMesh ? ptab : null;
      for (const o of [ui, tbar, ptab]) if (o !== U_) o.leave(vc.i);
      if (U_) { vc.hit = { ui: U_ }; U_.move(h.uv.x * U_.w, (1 - h.uv.y) * U_.h, vc.i); } else vc.hit = { ui: null };
      vc.dot.visible = true; vc.dot.position.copy(h.point);
    } else { vc.dot.visible = false; ui.leave(vc.i); tbar.leave(vc.i); ptab.leave(vc.i); }
    HOVER.delete(vc.i);
    if (!hits.length && md.N && S.tool !== 'camera') { const p = pickAtom(o, d); if (p) { HOVER.set(vc.i, p.i); if (S.walk) len = Math.max(0.3, p.t * p.s); } }
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
        if (hold.src === vc.i && hold.grab) hold.grab.dist = clamp(hold.grab.dist - ay * dt * (S.walk ? 9 : 0.9), 0.12, S.walk ? 40 : 3.5);
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
  walkTick(dt);
  if (S.vr) { vrInput(dt); if (S.walk) { walkClamp(); walkPanels(dt); } } else { controls.update(); if (S.walk) walkEye(); }
  toolUpdate();

  md.dt = isMat() ? S.dtFs / TU_FS : S.dt; md.thermostat = S.thermo; md.Ttarget = U.Tstar(S.TsetK);
  if (isMat() && mat.model === 'uff' && mat.chem.pending) { mat.chem.relaxPending(S.vr ? 3 : 6); }   // settle a fresh attachment a few iterations per frame
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
  updateAtoms(); if (S.buildN === null && md.N) S.buildN = md.N;

  if (ui.pressed || ui.released || (ui.dirty && t - lastUI >= (S.vr ? 33 : 0)) || t - lastUI > (S.vr ? 130 : 90)) { drawControls(); lastUI = t; if (S.vr) uiTex.needsUpdate = true; }
  if (tbar.pressed || tbar.released || tbar.dirty || t - lastTB > 150) { drawToolbar(); lastTB = t; if (S.vr) tbTex.needsUpdate = true; }
  if (S.ptOpen && (ptab.pressed || ptab.released || ptab.dirty || t - lastPT > 200)) { drawPtable(); lastPT = t; if (S.vr) ptTex.needsUpdate = true; }
  ptMesh.visible = S.vr && S.ptOpen; dom.pt.style.display = S.ptOpen ? '' : 'none';
  if (t - lastPlot > (S.vr ? 600 : 300) && (S.plots || S.vr)) {
    if (S.tab === TAB_ELEC) { const cv = TR.curve; drawElec(pctx, cv ? { E: cv.E, T: cv.T, EF: cv.EF, V: cv.V, I: cv.I, dIdV: cv.dIdV, Vbias: S.bias, gap: cv.gap, log: S.Tlog } : { status: TR.err || (TR.busy ? 'computing\u2026' : 'mark contacts, then press T(E), I(V)'), Vbias: S.bias }); }
    else drawPlots(pctx, plotData());
    lastPlot = t; if (S.vr) plotTex.needsUpdate = true;
  }
  updateCamPreview(t); updateMouseHover(); updateCarry();
  walkSky(t / 1000, dt);
  renderer.render(scene, camera);
}
/* ================================================================== nano walk
   "Made small": the structure is shown at 1.056 m per Angstrom (C-C bond 1.5 m, atom radius about 0.3 m) and the user stands on
   its fixed surface - the substrate if there is one, else the sheet itself (its top layer), else a glowing pad - in a starry
   night. The lab is still there, but a hundred times larger and kilometres away, a ghost in the fog (src/nanowalk.js). */
const WALK_SCALE = 1.056, EYE = 1.7;
const nano = createNanoWorld(); scene.add(nano.root);
const labFar = new THREE.Group(); scene.add(labFar);
const headlamp = new THREE.PointLight(0xcfe6ff, 0, 45, 1.5); scene.add(headlamp);
const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x03060f, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
fadeMesh.position.z = -0.2; fadeMesh.renderOrder = 10000; fadeMesh.visible = false; camera.add(fadeMesh);
const WI = { R: 20, ext: 10, last: 0 }, walkSaved = {}, wKeys = new Set(), wp = new THREE.Vector3();
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
window.addEventListener('keydown', (e) => { if (S.walk && !(e.target && /input|textarea/i.test(e.target.tagName))) { wKeys.add(e.code); if (/^Arrow/.test(e.code)) e.preventDefault(); } });
window.addEventListener('keyup', (e) => wKeys.delete(e.code));
window.addEventListener('blur', () => wKeys.clear());

function walkScale(base) {                                       // the model's scale in metres per Angstrom; grows towards the viewer while "shrinking"
  if (S.walk) return WALK_SCALE;
  const w = S.wa; if (w && w.kind === 'in' && !S.vr) return base * Math.pow(WALK_SCALE / base, Math.pow(clamp(w.t / w.d, 0, 1), 2.2));
  return base;
}
function walkPlace() {                                            // every frame: the walking surface at y = 0, the reference point on the vertical axis
  const sc = WALK_SCALE, [Lx, Ly, Lz] = dims(), sh = !!mat.sheet, up = sh ? md.z : md.y, pl = sh ? md.y : md.z, N = md.N, sb = mat.sub;
  if (!N) return;
  const topMean = () => { let hi = -1e9, a = 0, n = 0; for (let i = 0; i < N; i++) if (up[i] > hi) hi = up[i]; for (let i = 0; i < N; i++) if (up[i] > hi - 1.2) { a += up[i]; n++; } return a / n; };
  let L = WI.lock;
  if (!L) {                                                       // fixed when you arrive, so pulling a piece with the wand does not drag the floor along
    let cx = 0, cp = 0, lo = 1e9; for (let i = 0; i < N; i++) { cx += md.x[i]; cp += pl[i]; if (up[i] < lo) lo = up[i]; } cx /= N; cp /= N;
    let ext = 0; for (let i = 0; i < N; i++) ext = Math.max(ext, Math.hypot(md.x[i] - cx, pl[i] - cp));
    L = WI.lock = { cx, cp, ext, g: sb ? sb.wTop : sh ? topMean() : lo - 3.4 };
  }
  if (sh && !sb && !carry) L.g = topMean();                       // a sheet is the floor: follow its (slowly bobbing) top layer
  simRoot.position.set(-(L.cx - Lx / 2) * sc, -(L.g - (sh ? Lz : Ly) / 2) * sc, (sh ? (L.cp - Ly / 2) : -(L.cp - Lz / 2)) * sc);
  simRoot.quaternion.identity();
  WI.R = Math.max(10, (sb ? sb.R : L.ext + 9) * sc); WI.ext = L.ext * sc;
  if (Math.abs(WI.R - WI.last) > 0.05) { WI.last = WI.R; nano.setGround(WI.R, 0, 0); }
}
function benchToHead() {                                          // panels: back to the user's side, sized to this person
  const p = new THREE.Vector3(), f = new THREE.Vector3(); camera.getWorldPosition(p); camera.getWorldDirection(f); f.y = 0;
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  bench.rotation.set(0, Math.atan2(-f.x, -f.z), 0); bench.position.set(p.x, 0, p.z);
  setTableHeight(clamp(p.y - 0.52, 0.55, 1.05), false); placePanels(clamp(p.y - 0.12, 0.85, 1.75)); bench.updateMatrixWorld(true);
}
function ghostify(g, on) {                                      // the far lab as a see-through ghost: its materials turn translucent (and back)
  g.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) {
    if (on) { if (!m.userData.g) m.userData.g = { t: m.transparent, o: m.opacity, w: m.depthWrite, s: m.side }; m.transparent = true; m.opacity = Math.min(m.opacity, 0.42); m.depthWrite = false; m.side = THREE.DoubleSide; }
    else if (m.userData.g) { const q = m.userData.g; m.transparent = q.t; m.opacity = q.o; m.depthWrite = q.w; m.side = q.s; delete m.userData.g; }
    m.needsUpdate = true; } });
}
function toggleWalk() { if (S.wa) return; if (S.walk) exitWalk(); else enterWalk(); }
function enterWalk() {
  if (S.walk || S.wa) return;
  if (!md.N) { toast('Build something first'); return; }
  if (!isMat()) { toast('Walking needs a material (not the noble-gas box): pick graphene, a nanotube, C60 ...', 6000); return; }
  S.wa = { kind: 'in', t: 0, d: 1.1 };
}
function exitWalk(instant) {
  if (!S.walk && !S.wa) return;
  if (instant) { const was = S.walk; S.wa = null; fadeMesh.visible = false; if (was) finishExit(); return; }
  if (S.walk) S.wa = { kind: 'out', t: 0, d: 0.55 };
}
function finishEnter() {
  S.walk = true;
  Object.assign(walkSaved, { near: camera.near, far: camera.far, fog: scene.fog, bg: scene.background, sunPos: sun.position.clone(), sunCol: sun.color.getHex(), rimD: rim.distance });
  nano.build(); nano.setQuality(S.quality === 'low'); nano.root.visible = true;
  labFar.add(room); labFar.add(desk); labFar.position.set(-200, -40, -1250); labFar.rotation.set(0, 0.35, 0); labFar.scale.setScalar(75); ghostify(labFar, true);
  scene.background = nano.bg; scene.fog = nano.fog;
  hemi.color.setHex(0x8fa6ff); hemi.groundColor.setHex(0x3a2060); hemi.intensity = 1.05;
  sun.color.setHex(0xbcd0ff); sun.intensity = 1.1; sun.position.set(-6, 10, 4);
  rim.color.setHex(0x4ae3e1); rim.intensity = 900; rim.distance = 70; rim.visible = true; headlamp.intensity = S.quality === 'low' ? 0 : 150;
  camera.near = 0.05; camera.far = 4500; camera.updateProjectionMatrix();
  userScale = 1; WI.lock = null; applyQuality(); walkPlace();
  const sz = clamp(WI.ext * 0.75 + 3, 6, WI.R - 2);
  if (S.vr) {
    dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); dolly.updateMatrixWorld(true);
    const f = new THREE.Vector3(); camera.getWorldDirection(f); dolly.rotation.y = -Math.atan2(-f.x, -f.z); dolly.updateMatrixWorld(true);
    camera.getWorldPosition(wp); dolly.position.x += -wp.x; dolly.position.z += sz - wp.z; dolly.position.y = 0; benchToHead();
  } else {
    controls.rotateSpeed = 0.6; controls.minDistance = 0.001; controls.maxDistance = 0.5; controls.enableZoom = false; controls.enablePan = false; controls.minPolarAngle = 0.3; controls.maxPolarAngle = Math.PI - 0.3;
    camera.position.set(0, EYE, sz); controls.target.set(0, EYE - 0.004, sz - 0.02); controls.update();
  }
  toast(S.vr ? 'Tiny now: left stick walks, right stick turns. Walk button: back to the lab' : 'Tiny now: W A S D or arrows walk (Shift runs), drag to look, Esc: back to the lab', 9000);
  ui.dirty = tbar.dirty = true;
}
function finishExit() {
  S.walk = false; nano.root.visible = false; ghostify(labFar, false); bench.add(room); bench.add(desk); headlamp.intensity = 0; rim.distance = walkSaved.rimD || 4;
  scene.fog = walkSaved.fog; scene.background = walkSaved.bg; sun.position.copy(walkSaved.sunPos); sun.color.setHex(walkSaved.sunCol);
  camera.near = walkSaved.near; camera.far = walkSaved.far; camera.updateProjectionMatrix();
  applyTheme(S.theme); applyQuality(); userScale = 1;
  controls.rotateSpeed = 1; controls.minDistance = 0.3; controls.maxDistance = 6; controls.enableZoom = true; controls.enablePan = true; controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
  if (S.vr) { dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); bench.position.set(0, 0, 0); bench.rotation.set(0, 0, 0); recenter(); }
  else { simRoot.position.copy(SIM_HOME); simRoot.quaternion.identity(); homeView(); }
  ui.dirty = tbar.dirty = true;
}
function walkTick(dt) {                                           // the shrinking / growing animation, the fade, desktop walking
  const w = S.wa;
  if (S.walk && !w && !isMat()) exitWalk();
  if (w) {
    w.t += dt; const f = Math.min(1, w.t / w.d); let op = 0;
    if (w.kind === 'in') { op = ss(0.6, 1, f); if (f >= 1) { finishEnter(); S.wa = { kind: 'fadein', t: 0, d: 1.6 }; op = 1; } }
    else if (w.kind === 'out') { op = f; if (f >= 1) { finishExit(); S.wa = { kind: 'fadein', t: 0, d: 0.9 }; op = 1; } }
    else { op = 1 - ss(0, 1, f); if (f >= 1) { S.wa = null; op = 0; } }
    fadeMesh.material.opacity = op; fadeMesh.visible = op > 0.003;
  }
  if (S.walk && !S.vr) {
    const K = (c) => (wKeys.has(c) ? 1 : 0), fw = K('KeyW') + K('ArrowUp') - K('KeyS') - K('ArrowDown'), st = K('KeyD') + K('ArrowRight') - K('KeyA') - K('ArrowLeft');
    if (fw || st) {
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
      const v = (wKeys.has('ShiftLeft') || wKeys.has('ShiftRight') ? 5.5 : 2.4) * dt, l = Math.hypot(fw, st), dx = (f.x * fw - f.z * st) * v / l, dz = (f.z * fw + f.x * st) * v / l;
      camera.position.x += dx; camera.position.z += dz; controls.target.x += dx; controls.target.z += dz;
      const d = Math.hypot(camera.position.x, camera.position.z), R = WI.R - 1.2;
      if (d > R) { const k = (R - d) / d, ex = camera.position.x * k, ez = camera.position.z * k; camera.position.x += ex; camera.position.z += ez; controls.target.x += ex; controls.target.z += ez; }
    }
  }
}
function walkEye() { const dy = EYE - camera.position.y; camera.position.y += dy; controls.target.y += dy; }
function walkClamp() {                                            // the edge of the walking surface stops you (VR: slides the rig back)
  camera.getWorldPosition(wp); const d = Math.hypot(wp.x, wp.z), R = WI.R - 1.2;
  if (d > R) { const k = (R - d) / d; dolly.position.x += wp.x * k; dolly.position.z += wp.z * k; }
}
let benchFollow = false;
function walkPanels(dt) {                                         // panels follow lazily: when you walk away or turn round they glide to your side
  const f = new THREE.Vector3(); camera.getWorldPosition(wp); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-4) return; f.normalize();
  const yaw = Math.atan2(-f.x, -f.z); let dy = yaw - bench.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const dist = Math.hypot(wp.x - bench.position.x, wp.z - bench.position.z);
  if (dist > 1.5 || Math.abs(dy) > 1.3) benchFollow = true;
  if (benchFollow) {
    const k = 1 - Math.exp(-dt * 3); bench.position.x += (wp.x - bench.position.x) * k; bench.position.z += (wp.z - bench.position.z) * k; bench.rotation.y += dy * k;
    if (dist < 0.15 && Math.abs(dy) < 0.12) benchFollow = false;
  }
}
function walkSky(t, dt) {
  if (!S.walk) return;
  camera.getWorldPosition(wp); nano.update(wp, t, dt, S.vr ? 1.5 : renderer.getPixelRatio());
  headlamp.position.set(wp.x, wp.y + 0.3, wp.z); rim.position.set(0, 12, 0);
}
/* ================================================================== themes */
function applyTheme(name) {
  S.theme = name === 'light' ? 'light' : 'dark'; const th = THEMES[S.theme];
  setPalette(S.theme);
  if (!S.walk) { scene.background.set(th.bg); scene.fog.color.set(th.bg); scene.fog.near = th.fog[0]; scene.fog.far = th.fog[1]; }
  if (!S.walk) { hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2]; sun.intensity = th.sun; rim.color.set(th.accent); rim.intensity = th.rim; }
  if (room) { const par = room.parent || bench; par.remove(room); disposeTree(room); room = makeRoom(th); par.add(room); } else { room = makeRoom(th); bench.add(room); }
  deskTop.material.color.set(th.top); legM.color.set(th.cab); ring.material.color.set(th.accent); disc.material.color.set(th.accent);
  boxEdges.material.color.set(th.accent); boxFaces.material.color.set(th.accent);
  cMinus.set(COL.minus); cPlus.set(COL.plus);
  document.body.classList.toggle('light', S.theme === 'light'); setBtn(dom.themeBtn, S.theme === 'light' ? 'Dark lab' : 'White lab');
  ui.dirty = true; lastPlot = 0;
  try { localStorage.setItem('mdlab.theme', S.theme); } catch (e) { /* no storage */ }
}
setLang(S.lang); applyTheme(S.theme); applyLangDom(); applyQuality();
/* ---------- start screen: pick the level (kid / adult / researcher) and the language before the lab opens ---------- */
const START_TXT = {
  en: { sub: 'Build, heat and measure atoms \u2013 in VR or on the screen', hl: 'Language', hv: 'Who is using the lab?', kid: 'Kid', kidd: 'Pictures and simple tools', adult: 'Adult', adultd: 'The essentials, with short explanations', res: 'Researcher', resd: 'Everything: plots, transport, chemistry', go: 'Start', tut: '? Take the graphene tutorial' },
  da: { sub: 'Byg, varm op og m\u00E5l p\u00E5 atomer \u2013 i VR eller p\u00E5 sk\u00E6rmen', hl: 'Sprog', hv: 'Hvem bruger laboratoriet?', kid: 'Barn', kidd: 'Billeder og enkle v\u00E6rkt\u00F8jer', adult: 'Voksen', adultd: 'Det vigtigste, med korte forklaringer', res: 'Forsker', resd: 'Alt: grafer, transport, kemi', go: 'Start', tut: '? Tag guiden om grafen' },
};
(function startScreen() {
  const root = document.getElementById('start'); if (!root) return;
  let lg = S.lang === 'da' ? 'da' : 'en', lv = TB_LEVEL[S.level] ? S.level : 'researcher';
  const paint = () => {
    root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = START_TXT[lg][el.dataset.t]; });
    root.querySelectorAll('canvas[data-ic]').forEach((cv) => { const c = cv.getContext('2d'); c.clearRect(0, 0, 96, 96); ICONS[cv.dataset.ic](c, 48, 48, 38, COL.accent); });
    root.querySelectorAll('#stLang button').forEach((b) => b.classList.toggle('sel', b.dataset.v === lg));
    root.querySelectorAll('#stLevel button').forEach((b) => b.classList.toggle('sel', b.dataset.v === lv));
  };
  root.querySelector('#stLang').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { lg = b.dataset.v; paint(); } });
  root.querySelector('#stLevel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { lv = b.dataset.v; paint(); } });
  const go = (tutorial) => {
    setLangUI(lg); setLevel(lv, true); root.classList.add('hide'); if (tutorial) startTutorial();
    try { const v = JSON.parse(localStorage.getItem('mdlab.view') || '{}'); v.lang = lg; v.level = lv; localStorage.setItem('mdlab.view', JSON.stringify(v)); } catch (e) { /* no storage */ }
  };
  root.querySelector('#stGo').addEventListener('click', () => go(false));
  root.querySelector('#stTut').addEventListener('click', () => go(true));
  paint();
})();

setTableHeight(0.9, false);

build(B, { quiet: true });
md.run(300);
renderer.setAnimationLoop(frame);
window.__mdlab = { enterWalk, exitWalk, toggleWalk, nano, WI, labFar, pickAtom, mouseRay, get carry() { return carry; }, startCarry, stopCarry, HOVER, addBlock, applySubstrate, subAtoms, shoot, CAM, printMesh, setLevel, TOOLDEF, TB_LEVEL, setQuality, atoms, controls, setLangUI, THERMO, thermoDrag, loadSystem, saveCurrent, loadSaved, readSaved, tbar, ptab, tbMesh, ptMesh, LOCO, vign, dolly, TASKS, get md() { return md; }, mat, lj, isMat, S, B, H, build, ui, renderer, camera, scene, simRoot, vrc, applyTask, toolDown, toolUp, hold, enterVR,
  TR, applyTheme, setTableHeight, contactsAtEnds, requestTransport, placePanels, uiMesh, plotMesh, deskTop };
