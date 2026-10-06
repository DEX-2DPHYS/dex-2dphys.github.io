// Fab Studio 3D view: the standalone's painter's-algorithm renderer (l.3585–3889) over the
// mesh from core/fab/mesh.js. The mesh is rebuilt only when the grid or the quality changes;
// a frame projects the quads, culls those facing away, sorts back to front and fills.
// The view is framed on the material (the air head-room above the stack is left out), the
// layer labels sit in a column left of the block, and scale bars on the block's front edges
// give the lateral and the (possibly exaggerated) vertical scale.

import { buildMesh, FACE_NX, FACE_NY, FACE_NZ } from '../../core/fab/mesh.js';
import { M, MAT_NAMES, MAT_COLOR } from '../../core/fab/materials.js';

export function createIso(canvas, { onFrame } = {}) {
  const cx = canvas.getContext('2d');
  const cam = { az: 30, el: 25, zoom: 1, perspective: true };
  let mesh = null, meshKey = '', state = null, lastFaces = 0, moving = false, idleTimer = null, meshTopY = 0;
  const opts = { quality: 1, labels: true, alphaOf: () => 1, exag: 1 };

  function ensureMesh() {
    if (!state || !state.grid) { mesh = null; return; }
    let q = opts.quality;
    if (moving && lastFaces > 20000) q = Math.min(4, q * 2);
    const key = `${state.version}|${q}|${state.W}x${state.H}x${state.D}|${opts.exag}`;
    if (!mesh || meshKey !== key) {
      mesh = buildMesh(state, q, opts.alphaOf, opts.exag); meshKey = key; lastFaces = mesh.n;
      let top = Infinity; for (let f = 0; f < mesh.n; f++) for (let k = 0; k < 4; k++) top = Math.min(top, mesh.pos[f * 12 + k * 3 + 1]);
      meshTopY = Number.isFinite(top) ? top : 0;                        // scaled y of the highest material
    }
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, cw, ch);
    if (!state || !state.grid) return;
    const t0 = performance.now();
    ensureMesh();
    const { W, H, D } = state;
    const yS = (state.nmVert / state.nmLat) * opts.exag, modelH = H * yS;
    // frame the material only: from the highest voxel to the bottom (not the air head-room)
    const contentH = Math.max(1e-6, modelH - meshTopY);
    const cx0 = W / 2, cy0 = (meshTopY + modelH) / 2, cz0 = D / 2;
    const azRad = (cam.az * Math.PI) / 180, elRad = (cam.el * Math.PI) / 180;
    const cosAz = Math.cos(azRad), sinAz = Math.sin(azRad), cosEl = Math.cos(elRad), sinEl = Math.sin(elRad);
    const modelR = Math.max(W, D, contentH);
    // room for the label column on the left
    const fs = Math.max(11, Math.round(12.5 * (cw / 700)));
    let labelW = 0;
    if (opts.labels) { cx.font = `600 ${fs}px system-ui`; for (const m of new Set(mesh.mat)) if (m !== M.AIR) labelW = Math.max(labelW, cx.measureText(MAT_NAMES[m]).width); labelW = labelW ? labelW + fs * 3.2 : 0; }
    const sc = (Math.min(cw - labelW, ch) / (modelR * 1.3)) * cam.zoom;
    const hwx = labelW + (cw - labelW) / 2, hwy = ch / 2, fov = 600;
    const project = (x, y, z) => {
      const dx = x - cx0, dy = y * yS - cy0, dz = z - cz0;
      const rx = dx * cosAz + dz * sinAz, rz = -dx * sinAz + dz * cosAz;
      const ry = dy * cosEl - rz * sinEl, rz2 = dy * sinEl + rz * cosEl;
      let px, py;
      if (cam.perspective) { const s = fov / Math.max(rz2 + fov + D, 1); px = rx * s; py = ry * s; } else { px = rx; py = ry; }
      return { sx: hwx + px * sc, sy: hwy + py * sc, depth: rz2 };
    };
    const NRX = new Float32Array(6), NRY = new Float32Array(6), NRZ = new Float32Array(6);
    for (let t = 0; t < 6; t++) {
      const vx = FACE_NX[t], vy = FACE_NY[t], vz = FACE_NZ[t];
      const rxn = vx * cosAz + vz * sinAz, rzn = -vx * sinAz + vz * cosAz;
      NRX[t] = rxn; NRY[t] = vy * cosEl - rzn * sinEl; NRZ[t] = vy * sinEl + rzn * cosEl;
    }
    const eyeZ = fov + D;
    const n = mesh.n, MP = mesh.pos, MC = mesh.col, MT = mesh.typ;
    const px = new Float32Array(n * 4), py = new Float32Array(n * 4), dep = new Float32Array(n), order = new Uint32Array(n);
    let nDraw = 0;
    for (let f = 0; f < n; f++) {
      let dsum = 0, rxSum = 0, rySum = 0;
      for (let k = 0; k < 4; k++) {
        const o = f * 12 + k * 3;
        const dx = MP[o] - cx0, dy = MP[o + 1] - cy0, dz = MP[o + 2] - cz0;
        const rx = dx * cosAz + dz * sinAz, rz = -dx * sinAz + dz * cosAz;
        const ry = dy * cosEl - rz * sinEl, rz2 = dy * sinEl + rz * cosEl;
        let sxp, syp;
        if (cam.perspective) { const s = fov / Math.max(rz2 + fov + D, 1); sxp = rx * s; syp = ry * s; } else { sxp = rx; syp = ry; }
        px[f * 4 + k] = hwx + sxp * sc; py[f * 4 + k] = hwy + syp * sc;
        dsum += rz2; rxSum += rx; rySum += ry;
      }
      dep[f] = dsum * 0.25;
      if (MC[f * 4 + 3] >= 1) {
        const t = MT[f];
        const facing = cam.perspective ? NRX[t] * (rxSum * 0.25) + NRY[t] * (rySum * 0.25) + NRZ[t] * (dep[f] + eyeZ) : NRZ[t];
        if (facing > 0) continue;
      }
      order[nDraw++] = f;
    }
    const drawList = order.subarray(0, nDraw);
    drawList.sort((a, b) => dep[b] - dep[a]);
    let curAlpha = -1, curFill = '';
    for (let i = 0; i < nDraw; i++) {
      const f = drawList[i], b = f * 4, co = f * 4, a = MC[co + 3];
      if (a !== curAlpha) { cx.globalAlpha = a; curAlpha = a; }
      const fill = `rgb(${MC[co] | 0},${MC[co + 1] | 0},${MC[co + 2] | 0})`;
      if (fill !== curFill) { cx.fillStyle = fill; cx.strokeStyle = fill; curFill = fill; }
      cx.beginPath(); cx.moveTo(px[b], py[b]); cx.lineTo(px[b + 1], py[b + 1]); cx.lineTo(px[b + 2], py[b + 2]); cx.lineTo(px[b + 3], py[b + 3]); cx.closePath(); cx.fill();
      if (a >= 1) { cx.lineWidth = 0.7; cx.stroke(); }
    }
    cx.globalAlpha = 1;

    // layer callouts at the corner that reads leftmost
    if (opts.labels) {
      const corners = [{ ex: 0, ez: 0, col: 0, zi: 0 }, { ex: W, ez: 0, col: W - 1, zi: 0 }, { ex: 0, ez: D, col: 0, zi: D - 1 }, { ex: W, ez: D, col: W - 1, zi: D - 1 }];
      let best = null;
      for (const cn of corners) { const pm = project(cn.ex, H / 2, cn.ez); if (!best || pm.sx < best.sx) { best = pm; best.cn = cn; } }
      const gCol = state.grid[Math.min(best.cn.zi, D - 1)], colX = Math.min(best.cn.col, W - 1), runs = [];
      for (let yy = 0; yy < H;) { const m = gCol[yy * W + colX]; if (m === M.AIR) { yy++; continue; } let yE = yy + 1; while (yE < H && gCol[yE * W + colX] === m) yE++; runs.push({ m, y0: yy, y1: yE }); yy = yE; }
      if (runs.length) {
        const lineH = fs * 1.35;
        const items = runs.map((r) => { const pt = project(best.cn.ex, (r.y0 + r.y1) / 2, best.cn.ez); return { m: r.m, ax: pt.sx, ay: pt.sy, ty: pt.sy }; });
        const seen = new Set(items.map((it) => it.m)), extra = new Map();
        for (let f = 0; f < n; f++) {
          const m = mesh.mat[f];
          if (m === M.AIR || seen.has(m)) continue;
          for (let k = 0; k < 4; k++) { const vx = px[f * 4 + k], prev = extra.get(m); if (!prev || vx < prev.ax) extra.set(m, { ax: vx, ay: py[f * 4 + k] }); }
        }
        extra.forEach((pt, m) => items.push({ m, ax: pt.ax, ay: pt.ay, ty: pt.ay }));
        items.sort((a, b) => a.ty - b.ty);
        for (let i = 1; i < items.length; i++) if (items[i].ty - items[i - 1].ty < lineH) items[i].ty = items[i - 1].ty + lineH;
        const over = items[items.length - 1].ty - (ch - fs); if (over > 0) for (const it of items) it.ty -= over;
        const under = fs - items[0].ty; if (under > 0) for (const it of items) it.ty += under;
        // the column stands left of everything drawn, so no label covers the structure
        let minX = Infinity; for (let i = 0; i < nDraw; i++) { const b = drawList[i] * 4; for (let k = 0; k < 4; k++) if (px[b + k] < minX) minX = px[b + k]; }
        const toLeft = true, gap = Math.max(16, fs * 1.2), tx = Math.max(labelW - fs * 1.2, Math.min(minX - gap, best.sx - gap));
        cx.save(); cx.font = `600 ${fs}px system-ui`; cx.textBaseline = 'middle'; cx.textAlign = toLeft ? 'right' : 'left'; cx.lineJoin = 'round';
        for (const it of items) {
          cx.strokeStyle = 'rgba(15,23,42,0.35)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(it.ax, it.ay); cx.lineTo(tx + (toLeft ? 5 : -5), it.ty); cx.stroke();
          const c = MAT_COLOR[it.m];
          cx.beginPath(); cx.arc(it.ax, it.ay, Math.max(2.5, fs * 0.18), 0, Math.PI * 2); cx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; cx.fill(); cx.strokeStyle = 'rgba(15,23,42,0.55)'; cx.lineWidth = 1; cx.stroke();
          cx.lineWidth = Math.max(3, fs * 0.3); cx.strokeStyle = 'rgba(255,255,255,0.92)'; cx.strokeText(MAT_NAMES[it.m], tx, it.ty);
          cx.fillStyle = '#0f172a'; cx.fillText(MAT_NAMES[it.m], tx, it.ty);
        }
        cx.restore();
      }
    }
    // scale bars on the front-bottom corner: lateral along x, vertical up the corner
    {
      const nice = (v) => { const e = 10 ** Math.floor(Math.log10(v)), m = v / e; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e; };
      const corners = [[0, 0], [W, 0], [0, D], [W, D]].map(([x, z]) => ({ x, z, p: project(x, H, z) }));
      const front = corners.reduce((a, b) => (b.p.sy > a.p.sy ? b : a));
      const lenX = nice((W * state.nmLat) / 4), nX = lenX / state.nmLat, dirX = front.x === 0 ? 1 : -1;
      const contentNm = (contentH / yS) * state.nmVert, lenV = nice(contentNm / 2.5), nV = lenV / state.nmVert;
      const topRow = meshTopY / yS;
      const off = Math.max(2, W * 0.02);
      const a0 = project(front.x, H, front.z + (front.z === 0 ? -off : off)), a1 = project(front.x + dirX * nX, H, front.z + (front.z === 0 ? -off : off));
      const v0 = project(front.x + (front.x === 0 ? -off : off), H, front.z), v1 = project(front.x + (front.x === 0 ? -off : off), H - nV, front.z);
      const bfs = Math.max(10, Math.round(11 * (cw / 700)));
      cx.save(); cx.lineWidth = Math.max(2, cw / 500); cx.strokeStyle = '#111'; cx.fillStyle = '#111'; cx.font = `600 ${bfs}px system-ui`;
      const bar = (p, q, label, side) => {
        cx.beginPath(); cx.moveTo(p.sx, p.sy); cx.lineTo(q.sx, q.sy); cx.stroke();
        const nx = -(q.sy - p.sy), ny = q.sx - p.sx, nl = Math.hypot(nx, ny) || 1, t = bfs * 0.45;
        for (const e of [p, q]) { cx.beginPath(); cx.moveTo(e.sx - (nx / nl) * t, e.sy - (ny / nl) * t); cx.lineTo(e.sx + (nx / nl) * t, e.sy + (ny / nl) * t); cx.stroke(); }
        const mx = (p.sx + q.sx) / 2, my = (p.sy + q.sy) / 2;
        cx.textAlign = side === 'right' ? 'left' : side === 'left' ? 'right' : 'center'; cx.textBaseline = side === 'below' ? 'top' : 'middle';
        cx.lineWidth = 3; cx.strokeStyle = 'rgba(255,255,255,0.9)'; const tx2 = side === 'right' ? mx + bfs * 0.8 : side === 'left' ? mx - bfs * 0.8 : mx, ty2 = side === 'below' ? my + bfs * 0.6 : my;
        cx.strokeText(label, tx2, ty2); cx.fillText(label, tx2, ty2); cx.lineWidth = Math.max(2, cw / 500); cx.strokeStyle = '#111';
      };
      const fmt = (nm) => (nm >= 1000 ? `${+(nm / 1000).toPrecision(3)} µm` : `${+nm.toPrecision(3)} nm`);
      bar(a0, a1, fmt(lenX), 'below');
      if (topRow < H) bar(v0, v1, `${fmt(lenV)}${opts.exag > 1 ? ` (height ×${opts.exag})` : ''}`, v0.sx < front.p.sx ? 'left' : 'right');
      cx.restore();
    }
    cx.fillStyle = 'rgba(17,24,39,0.5)'; cx.font = `${Math.max(10, Math.round(11 * (cw / 700)))}px system-ui`; cx.textAlign = 'right'; cx.textBaseline = 'alphabetic';
    cx.fillText('Drag to rotate, scroll to zoom', cw - 10, ch - 8);
    if (onFrame) onFrame({ quads: n, ms: performance.now() - t0, q: meshKey.split('|')[1] });
  }

  let drag = null;
  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, az: cam.az, el: cam.el }; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    cam.az = drag.az + (e.clientX - drag.x) * 0.5;
    cam.el = Math.max(5, Math.min(85, drag.el + (e.clientY - drag.y) * 0.4));
    moving = true; clearTimeout(idleTimer); idleTimer = setTimeout(() => { moving = false; draw(); }, 220);
    draw();
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = Math.max(0.3, Math.min(6, cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); draw(); }, { passive: false });

  return {
    setState(s) { state = s; },
    setOptions(o) { Object.assign(opts, o); },
    camera: cam,
    resetCamera() { cam.az = 30; cam.el = 25; cam.zoom = 1; },
    draw, invalidate() { mesh = null; },
    faces: () => lastFaces,
  };
}
