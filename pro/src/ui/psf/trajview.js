// The PSF tab's trajectory view: the first N Monte Carlo electrons seen from the side (x across, depth z
// down, equal scales), coloured by whether they left through the top surface (backscattered) or stayed
// in the sample, with the energy each layer received as an optional overlay (log scale). Wheel = zoom
// about the cursor, drag = pan, double click = fit.

import { setupCanvas, FONT, FONT_SMALL, FONT_BOLD, niceStep } from '../plotkit.js';
import { cmapFn } from '../colormaps.js';

export const COL_OUT = '#e4572e', COL_IN = '#1d4ed8';
const LAYER_FILL = ['rgba(250,204,21,0.16)', 'rgba(148,163,184,0.18)', 'rgba(100,116,139,0.10)'];

export function createTrajView({ canvas, hover, onView }) {
  const M = { L: 64, R: 16, T: 12, B: 44 };
  let view = null, layers = [], tracks = null, dep = null, show = { tracks: true, dep: false }, frame = null;
  const heat = cmapFn('gray');                    // white → black: neutral under the coloured tracks

  function plotRect() { const w = canvas.clientWidth, h = canvas.clientHeight; return { x: M.L, y: M.T, w: Math.max(10, w - M.L - M.R), h: Math.max(10, h - M.T - M.B) }; }
  // view {cx, cz, s (nm per px)} → the rectangle in nm
  function rectNm() { const p = plotRect(); return { x0: view.cx - (p.w / 2) * view.s, x1: view.cx + (p.w / 2) * view.s, z0: view.cz - (p.h / 2) * view.s, z1: view.cz + (p.h / 2) * view.s }; }
  function fitTo(x0, x1, z0, z1) {
    const p = plotRect(), s = Math.max((x1 - x0) / p.w, (z1 - z0) / p.h) * 1.06;
    view = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, s: s > 0 ? s : 1 };
  }
  function fit() {
    let x0 = Infinity, x1 = -Infinity, z0 = 0, z1 = -Infinity;
    if (tracks && tracks.xy.length) for (let k = 0; k < tracks.xy.length; k += 2) { const x = tracks.xy[k], z = tracks.xy[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (!(x1 > x0)) { const h = layers[0] ? layers[0].z1 : 100; x0 = -h; x1 = h; z1 = 2 * h; }
    const m = Math.max(x1 - x0, z1 - z0) * 0.04;
    const xm = Math.max(Math.abs(x0), Math.abs(x1));          // symmetric about the beam
    fitTo(-xm - m, xm + m, Math.min(z0, 0) - m, z1 + m);
    changed();
  }
  // the resist and the top of what lies under it
  function fitResist() {
    const h = layers[0] ? layers[0].z1 - layers[0].z0 : 100;
    const p = plotRect(), z0 = -0.25 * h, z1 = 2.5 * h, s = (z1 - z0) / p.h;
    view = { cx: 0, cz: (z0 + z1) / 2, s }; changed();
  }
  function changed() { draw(); onView?.(); }

  function draw() {
    const { ctx, w, h } = setupCanvas(canvas);
    const p = plotRect();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    if (!view) { ctx.fillStyle = '#888'; ctx.font = FONT; ctx.fillText('No trajectories yet.', p.x + 10, p.y + 24); return; }
    const R = rectNm(), sx = (x) => p.x + (x - R.x0) / view.s, sz = (z) => p.y + (z - R.z0) / view.s;
    ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
    // layers
    layers.forEach((L, i) => {
      const a = Math.max(p.y, sz(L.z0)), b = Math.min(p.y + p.h, Number.isFinite(L.z1) ? sz(L.z1) : p.y + p.h);
      if (b > a) { ctx.fillStyle = LAYER_FILL[Math.min(i, LAYER_FILL.length - 1)]; ctx.fillRect(p.x, a, p.w, b - a); }
    });
    // deposition overlay (drawn where it was computed; recomputed after the view settles)
    if (show.dep && dep && dep.grid) {
      if (!dep.img) dep.img = depImage(dep);
      const v = dep.view;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(dep.img, sx(v.x0), sz(v.z0), (v.x1 - v.x0) / view.s, (v.z1 - v.z0) / view.s);
    }
    // layer boundaries
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1;
    for (const L of layers) for (const z of [L.z0, L.z1]) if (Number.isFinite(z)) { const y = Math.round(sz(z)) + 0.5; if (y >= p.y && y <= p.y + p.h) { ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); } }
    // tracks: knock-ons first (thin), then primaries; the backscattered ones last so they read on top
    if (show.tracks && tracks) {
      const { xy, off, flags } = tracks;
      for (const pass of [0, 1, 2, 3]) {           // 0 knock-on in, 1 knock-on out, 2 primary in, 3 primary out
        const prim = pass >= 2, out = pass & 1;
        ctx.strokeStyle = out ? COL_OUT : COL_IN; ctx.globalAlpha = prim ? 0.65 : 0.4; ctx.lineWidth = prim ? 1 : 0.6;
        ctx.beginPath();
        for (let t = 0; t + 1 < off.length; t++) {
          if (((flags[t] & 2) !== 0) !== prim || (flags[t] & 1) !== out) continue;
          for (let k = off[t]; k < off[t + 1]; k++) { const X = sx(xy[2 * k]), Y = sz(xy[2 * k + 1]); k === off[t] ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // beam axis mark and surface label
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w, p.h);
    // axes: one unit per axis
    const span = Math.max(R.x1 - R.x0, R.z1 - R.z0), um = span >= 3000, u = um ? 1000 : 1, unit = um ? 'µm' : 'nm';
    const step = niceStep((R.x1 - R.x0) / u, Math.max(3, Math.floor(p.w / 90))) * u;
    const dec = (v) => { const d = Math.max(0, -Math.floor(Math.log10(step / u) + 1e-9)); return (v / u).toFixed(d).replace('-', '−'); };
    ctx.font = FONT; ctx.fillStyle = '#333'; ctx.strokeStyle = '#333'; ctx.textAlign = 'center';
    for (let x = Math.ceil(R.x0 / step) * step; x <= R.x1; x += step) { const X = sx(x); ctx.beginPath(); ctx.moveTo(X, p.y + p.h); ctx.lineTo(X, p.y + p.h + 5); ctx.stroke(); ctx.fillText(dec(Math.abs(x) < step * 1e-6 ? 0 : x), X, p.y + p.h + 20); }
    ctx.fillText(`x (${unit})`, p.x + p.w / 2, p.y + p.h + 38);
    ctx.textAlign = 'right';
    for (let z = Math.ceil(R.z0 / step) * step; z <= R.z1; z += step) { const Y = sz(z); ctx.beginPath(); ctx.moveTo(p.x - 5, Y); ctx.lineTo(p.x, Y); ctx.stroke(); ctx.fillText(dec(Math.abs(z) < step * 1e-6 ? 0 : z), p.x - 8, Y + 4.5); }
    ctx.save(); ctx.translate(16, p.y + p.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(`depth z (${unit})`, 0, 0); ctx.restore();
    // layer names, at the left inside the plot
    ctx.textAlign = 'left'; ctx.font = FONT_BOLD;
    layers.forEach((L) => {
      const a = sz(L.z0), b = Number.isFinite(L.z1) ? sz(L.z1) : p.y + p.h;
      const y = Math.max(a, p.y) + 17;
      if (y < Math.min(b, p.y + p.h) - 2 && y > p.y) { label(ctx, L.name, p.x + 8, y); }
    });
    if (sz(0) > p.y + 20) { ctx.font = FONT_SMALL; ctx.fillStyle = '#666'; ctx.fillText('vacuum', p.x + 8, Math.min(sz(0), p.y + p.h) - 6); }
    // legend
    legend(ctx, p);
    frame = { p, R };
  }
  function label(ctx, txt, x, y) { const w = ctx.measureText(txt).width; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x - 3, y - 13, w + 6, 17); ctx.fillStyle = '#222'; ctx.fillText(txt, x, y); }
  function legend(ctx, p) {
    const rows = [];
    if (show.tracks && tracks) {
      const b = tracks.backscattered, n = tracks.primaries;
      rows.push([COL_OUT, `backscattered: ${b} of ${n} (${n ? Math.round((100 * b) / n) : 0} %)`]);
      rows.push([COL_IN, `stayed in the sample: ${n - b}`]);
    }
    if (show.dep && dep) rows.push(['dep', p.w > 420 ? `energy deposited (${dep.nDep.toLocaleString()} e⁻, log, 4 decades)` : 'energy deposited (log)']);
    if (!rows.length) return;
    ctx.font = FONT_SMALL;
    const wMax = Math.max(...rows.map((r) => ctx.measureText(r[1]).width)) + 40, hh = rows.length * 18 + 10;
    const x = Math.max(p.x + 4, p.x + p.w - wMax - 8), y = p.y + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(x, y, wMax, hh); ctx.strokeStyle = '#ccc'; ctx.strokeRect(x + 0.5, y + 0.5, wMax, hh);
    rows.forEach((r, i) => {
      const yy = y + 18 + i * 18;
      if (r[0] === 'dep') { for (let k = 0; k < 24; k++) { const c = heat(0.25 + 0.75 * (k / 23)); ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; ctx.fillRect(x + 8 + k, yy - 9, 1, 10); } }
      else { ctx.strokeStyle = r[0]; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 8, yy - 4); ctx.lineTo(x + 32, yy - 4); ctx.stroke(); }
      ctx.fillStyle = '#222'; ctx.fillText(r[1], x + 38, yy);
    });
  }
  // the map as an image: log scale over four decades below the largest pixel; light = little
  function depImage(d) {
    const { W, H } = d.view, g = d.grid;
    let mx = 0; for (let i = 0; i < g.length; i++) if (g[i] > mx) mx = g[i];
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d'), im = cx.createImageData(W, H);
    const lo = Math.log10(mx) - 4;
    for (let i = 0; i < g.length; i++) {
      if (!(g[i] > 0)) continue;
      const t = Math.min(1, Math.max(0, (Math.log10(g[i]) - lo) / 4));
      if (t <= 0) continue;
      const col = heat(0.25 + 0.75 * t);
      im.data[4 * i] = col[0]; im.data[4 * i + 1] = col[1]; im.data[4 * i + 2] = col[2]; im.data[4 * i + 3] = Math.round(255 * Math.min(1, 0.15 + 0.75 * t));
    }
    cx.putImageData(im, 0, 0);
    return c;
  }

  // interaction
  let drag = null;
  canvas.addEventListener('wheel', (e) => {
    if (!view || !frame) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, p = frame.p;
    const wx = view.cx + (mx - (p.x + p.w / 2)) * view.s, wz = view.cz + (my - (p.y + p.h / 2)) * view.s;
    const f = Math.pow(1.2, e.deltaY / 100);
    view.s *= f; view.cx = wx - (wx - view.cx) * f; view.cz = wz - (wz - view.cz) * f;
    changed();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => { if (!view) return; drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) { view.cx = drag.cx - (e.clientX - drag.x) * view.s; view.cz = drag.cz - (e.clientY - drag.y) * view.s; draw(); return; }
    if (!frame || !hover) return;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, p = frame.p;
    if (mx < p.x || mx > p.x + p.w || my < p.y || my > p.y + p.h) { hover.textContent = ''; return; }
    const x = frame.R.x0 + (mx - p.x) * view.s, z = frame.R.z0 + (my - p.y) * view.s;
    const L = layers.find((l) => z >= l.z0 && z < l.z1);
    const f = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(3) + ' µm' : v.toFixed(1) + ' nm');
    hover.textContent = `x = ${f(x)}, z = ${f(z)}${L ? ' · ' + L.name : z < 0 ? ' · vacuum' : ''}`;
  });
  const endDrag = () => { if (drag) { drag = null; changed(); } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', () => fit());

  return {
    draw, fit, fitResist,
    setLayers(l) { layers = l; },
    setShow(s) { show = { ...show, ...s }; draw(); },
    setTracks(r, refit) { tracks = r; if (refit || !view) fit(); else draw(); },
    setDep(r) { dep = r; draw(); },
    clear() { tracks = null; dep = null; view = null; draw(); },
    // the map request for the current view, at half the canvas resolution (enough for a log map)
    depView() { if (!view) return null; const p = plotRect(), R = rectNm(); return { ...R, W: Math.max(16, Math.round(p.w / 2)), H: Math.max(16, Math.round(p.h / 2)) }; },
    hasView: () => !!view,
  };
}
