// Fab Studio cross-section (the standalone's render2D, l.3210–3337, without the DOM reads).
// Voxels are anisotropic, so the section is laid out in nanometres with its own scale per axis.
// Optionally a dose strip floats above the sample: the dose the pending exposure would deliver
// per column (greyscale, white = 0), which is how the layout's proximity halo becomes visible.

import { M, MAT_COLOR } from '../../core/fab/materials.js';

// exag: vertical exaggeration ('auto' = enough to make the section readable, at most ×20);
// xZoom / xCenter: horizontal zoom and the column fraction shown at the canvas centre.
export function drawCrossSection(canvas, state, { zSlice = 0, alphaOf = () => 1, pendingDose = null, doseMax = 0, doseLabel = '', exag = 'auto', xZoom = 1, xCenter = 0.5 } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const cx = canvas.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, cw, ch);
  if (!state.grid || !state.grid.length) return null;
  const { W, H, D, nmLat, nmVert } = state;
  const z = Math.min(Math.max(0, zSlice), D - 1), g = state.grid[z];
  // show the material and some air above it (room for the dose strip), not the whole head-room
  let globalTop = H;
  for (let x = 0; x < W; x++) for (let y = 0; y < globalTop; y++) if (g[y * W + x] !== M.AIR) { globalTop = y; break; }
  const y0 = globalTop >= H ? 0 : Math.max(0, globalTop - Math.max(4, Math.round(0.35 * (H - globalTop)))), Hv = H - y0;
  const physW = W * nmLat, physH = Hv * nmVert;
  const base = Math.min((cw * 0.92) / physW, (ch * 0.9) / physH);          // uniform fit, px per nm
  const exagK = exag === 'auto' ? Math.min(20, Math.max(1, Math.floor(((ch * 0.55) / physH) / base))) : Math.max(1, exag);
  const sx = base * nmLat * xZoom, sy = Math.min(base * nmVert * exagK, (ch * 0.9) / Hv);
  let ox = cw / 2 - xCenter * W * sx;
  if (W * sx <= cw * 0.95) ox = (cw - W * sx) / 2;                          // fits: keep it centred
  else ox = Math.min(cw * 0.04, Math.max(cw * 0.96 - W * sx, ox));          // zoomed: never leave the canvas empty
  const oy = (ch - Hv * sy) / 2 + ch * 0.02;

  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d'), img = octx.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = g[y * W + x], p = (y * W + x) * 4, c = MAT_COLOR[m];
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = Math.round(255 * alphaOf(m));
  }
  octx.putImageData(img, 0, 0);
  cx.imageSmoothingEnabled = false;
  cx.drawImage(off, 0, y0, W, Hv, ox, oy, W * sx, Hv * sy);
  cx.strokeStyle = 'rgba(0,0,0,0.25)'; cx.lineWidth = 1; cx.strokeRect(ox, oy, W * sx, Hv * sy);

  // dose strip above the sample
  if (pendingDose && doseMax > 0) {
    const topV = (globalTop - y0) * sy;
    const stripH = Math.max(6 * dpr, Math.min(topV * 0.2, 16 * dpr));
    const ry = oy + Math.max(2 * dpr, topV - stripH - 10 * dpr);
    for (let x = 0; x < W; x++) {
      const t = Math.max(0, Math.min(1, pendingDose[x] / doseMax)), gc = Math.round(255 * (1 - t));
      cx.fillStyle = `rgb(${gc},${gc},${gc})`;
      cx.fillRect(ox + x * sx, ry, Math.max(1, sx + 0.5), stripH);
    }
    cx.strokeStyle = 'rgba(0,0,0,0.45)'; cx.strokeRect(ox, ry, W * sx, stripH);
    // dose curve on the strip's top edge, scaled to doseMax = full strip height × 3
    cx.strokeStyle = 'rgba(220,40,40,0.9)'; cx.lineWidth = 1.2 * dpr; cx.beginPath();
    for (let x = 0; x < W; x++) { const yv = ry - 2 * dpr - Math.min(3 * stripH, (pendingDose[x] / doseMax) * 3 * stripH); x ? cx.lineTo(ox + (x + 0.5) * sx, yv) : cx.moveTo(ox + (x + 0.5) * sx, yv); }
    cx.stroke();
    cx.fillStyle = 'rgba(17,24,39,0.7)'; cx.font = `${Math.max(10, 11 * dpr)}px system-ui`; cx.textAlign = 'left';
    cx.fillText(doseLabel || `dose, max ${doseMax.toFixed(0)} µC/cm²`, ox + 4 * dpr, ry - 4 * dpr - 3 * stripH - 2 * dpr > 10 ? ry - 3 * stripH - 6 * dpr : ry + stripH + 12 * dpr);
  }

  cx.fillStyle = 'rgba(17,24,39,0.6)';
  cx.font = `${Math.max(11, 12 * dpr)}px system-ui`;
  cx.textAlign = 'center';
  const wTxt = physW >= 1000 ? `${(physW / 1000).toPrecision(3)} µm` : `${Math.round(physW)} nm`;
  cx.fillText(wTxt, ox + (W * sx) / 2, oy + Hv * sy + 15 * dpr);
  cx.save(); cx.translate(Math.max(ox, 0) - 8 * dpr, oy + (Hv * sy) / 2); cx.rotate(-Math.PI / 2); cx.fillText(`${Math.round(physH)} nm${sy / sx > 1.05 * (nmVert / nmLat) ? ` (×${(sy / nmVert / (sx / nmLat)).toFixed(0)} vertical)` : ''}`, 0, 0); cx.restore();
  if (D > 1) {
    cx.fillStyle = 'rgba(17,24,39,0.5)'; cx.font = `${Math.max(10, 10 * dpr)}px system-ui`; cx.textAlign = 'right';
    cx.fillText(`slice ${z + 1} / ${D} (${Math.round(((z + 0.5) * state.sampleDepthNm) / D)} nm)`, ox + W * sx, oy - 5 * dpr);
  }
  return { ox, oy, sx, sy, dpr, z, y0, exag: sy / nmVert / (sx / nmLat), xZoom };
}

// Thumbnail data for the flow list: the middle slice's materials, at most `width` columns, all
// rows (the crop is chosen later, the same for every step, so the thumbnails compare).
// top = the first row holding anything but air.
export function sliceThumbData(state, width = 240) {
  if (!state.grid || !state.grid.length) return null;
  const { W, H } = state, g = state.grid[Math.floor(state.D / 2)], w = Math.min(width, W);
  const ids = new Uint8Array(w * H);
  let top = H;
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    const m = g[y * W + Math.floor(((x + 0.5) * W) / w)];
    ids[y * w + x] = m;
    if (m !== M.AIR && y < top) top = y;
  }
  return { w, h: H, ids, top, urls: new Map() };
}

// The thumbnail as a data URL: rows y0…h stretched to outW × outH (cached per crop and size).
export function thumbURL(t, y0, outW, outH) {
  const key = `${y0}|${outW}|${outH}`;
  if (t.urls.has(key)) return t.urls.get(key);
  const c = document.createElement('canvas'); c.width = outW; c.height = outH;
  const cx = c.getContext('2d'), img = cx.createImageData(outW, outH), d = img.data, rows = Math.max(1, t.h - y0);
  for (let y = 0; y < outH; y++) {
    const gy = Math.min(t.h - 1, y0 + Math.floor((y * rows) / outH));
    for (let x = 0; x < outW; x++) {
      const m = t.ids[gy * t.w + Math.min(t.w - 1, Math.floor((x * t.w) / outW))], p = (y * outW + x) * 4, col = MAT_COLOR[m];
      d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png');
  t.urls.set(key, url);
  return url;
}
