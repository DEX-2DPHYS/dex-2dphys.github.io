// Figures from dfm.exe's JSON, laid out like Boggild et al. 2017 Figs. 3c and 4.
//   node dfm-plot.js dfm.json out-dir
// Writes fig3c.svg and fig4.svg (density images embedded as PNG).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [, , inFile, outDir] = process.argv;
const D = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const W = D.W, H = D.H, YC = 1.0, XF = 0.01, FPAR = 0.5;

// ---------------------------------------------------------------- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
function png(w, h, px) { // px(x, y) -> [r,g,b], y = 0 top
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
// inferno-like ramp
const STOPS = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
const ramp = t => { t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1); const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i; return STOPS[i].map((v, k) => Math.round(v + f * (STOPS[i + 1][k] - v))); };

const inP = (x, y, dotR) => { const dy = y - YC; if (x < XF + FPAR - dy * dy / (4 * FPAR)) return true; return dotR > 0 && Math.hypot(x - 3.0, dy) < dotR; };

// one density image: several fields overlaid, each normalised to its own 99.7th percentile
// light 1-2-1 smoothing in both directions (display only)
function smooth(m) {
  const { gx, gy } = m, a = m.d, t = new Float64Array(a.length), o = new Float64Array(a.length);
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) { const k = y * gx + x; t[k] = (2 * a[k] + a[y * gx + Math.max(0, x - 1)] + a[y * gx + Math.min(gx - 1, x + 1)]) / 4; }
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) { const k = y * gx + x; o[k] = (2 * t[k] + t[Math.max(0, y - 1) * gx + x] + t[Math.min(gy - 1, y + 1) * gx + x]) / 4; }
  return { gx, gy, d: Array.from(o) };
}
function densityImage(maps, dotR, x0 = 0, x1 = W) {
  maps = maps.map(smooth);
  const gx = maps[0].gx, gy = maps[0].gy;
  const norm = maps.map(m => { const s = m.d.slice().sort((a, b) => a - b); return Math.max(1, s[Math.floor(0.997 * s.length)]); });
  const i0 = Math.floor(x0 / W * gx), i1 = Math.ceil(x1 / W * gx);
  return { w: i1 - i0, h: gy, uri: png(i1 - i0, gy, (xi, yi) => {
    const ix = xi + i0, iy = gy - 1 - yi;
    let v = 0; maps.forEach((m, k) => { v = Math.max(v, m.d[iy * gx + ix] / norm[k]); });
    const t = Math.sqrt(Math.min(1, v));
    const x = (ix + 0.5) / gx * W, y = (iy + 0.5) / gy * H;
    const base = inP(x, y, dotR) ? [70, 18, 52] : [18, 14, 60]; // p: plum, n: indigo, like the paper's two scales
    const c = ramp(t);
    const a = Math.min(1, t * 3);
    return base.map((b, k) => Math.round(b * (1 - a) + c[k] * a));
  }) };
}

function deviceSVG(img, px0, py0, scale, opts) {
  const { dotR, disc, x0 = 0, x1 = W } = opts;
  const X = x => px0 + (x - x0) * scale, Y = y => py0 + (H - y) * scale;
  let s = `<image href="${img.uri}" x="${X(x0)}" y="${Y(H)}" width="${(x1 - x0) * scale}" height="${H * scale}" preserveAspectRatio="none" style="image-rendering:pixelated"/>`;
  // parabola + dot outlines
  if (x0 < 0.6) {
    let d = ''; for (let k = 0; k <= 80; k++) { const y = k / 80 * H, dy = y - YC, x = XF + FPAR - dy * dy / (4 * FPAR); if (x < x0) continue; d += (d ? 'L' : 'M') + X(x).toFixed(1) + ',' + Y(y).toFixed(1); }
    s += `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-dasharray="4 3"/>`;
    // aperture jaws and emitter
    for (const [ya, yb] of [[YC + 0.04, YC + 0.07], [YC - 0.07, YC - 0.04]]) s += `<rect x="${X(0)}" y="${Y(yb)}" width="${0.25 * scale}" height="${(yb - ya) * scale}" fill="#f5b041"/>`;
    s += `<rect x="${X(0)}" y="${Y(YC + 0.01)}" width="${Math.max(2, 0.02 * scale)}" height="${Math.max(2, 0.02 * scale)}" fill="#23b978"/>`;
  }
  if (dotR > 0) s += `<circle cx="${X(3.0)}" cy="${Y(YC)}" r="${dotR * scale}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-dasharray="4 3"/>`;
  if (disc) s += `<circle cx="${X(3.3)}" cy="${Y(YC)}" r="${0.1 * scale}" fill="#e8c840" stroke="#333"/>`;
  // electrodes: 2 back (black), 3 top (red), 4 bottom (blue)
  s += `<rect x="${X(W) - 4}" y="${Y(H)}" width="6" height="${H * scale}" fill="#111"/>`;
  const ex0 = Math.max(x0, 1.8);
  s += `<rect x="${X(ex0)}" y="${Y(H) - 5}" width="${(3.96 - ex0) * scale}" height="5" fill="#e0403f"/>`;
  s += `<rect x="${X(ex0)}" y="${Y(0)}" width="${(3.96 - ex0) * scale}" height="5" fill="#2f7fe0"/>`;
  return s;
}

function plotT(run, px0, py0, w, h, opts = {}) {
  const B = run.B.map(b => b * 1e3);
  const bmin = Math.min(...B), bmax = Math.max(...B);
  const tmax = opts.tmax || Math.max(...run.T2, ...run.T3, ...run.T4) * 1.08;
  const X = b => px0 + (b - bmin) / (bmax - bmin) * w, Y = t => py0 + h - t / tmax * h;
  let s = `<rect x="${px0}" y="${py0}" width="${w}" height="${h}" fill="#fff" stroke="#999"/>`;
  for (let b = Math.ceil(bmin / 4) * 4; b <= bmax; b += 4) s += `<line x1="${X(b)}" y1="${py0 + h}" x2="${X(b)}" y2="${py0 + h + 4}" stroke="#555"/><text x="${X(b)}" y="${py0 + h + 16}" font-size="11" text-anchor="middle">${b}</text>`;
  s += `<text x="${px0 + w / 2}" y="${py0 + h + 31}" font-size="12" text-anchor="middle">B (mT)</text>`;
  const line = (arr, col, dash) => `<polyline points="${arr.map((t, i) => X(B[i]).toFixed(1) + ',' + Y(t).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="1.6"${dash ? ' stroke-dasharray="4 3"' : ''}/>`;
  s += line(run.T2, '#111', true) + line(run.T3, '#e0403f') + line(run.T4, '#2f7fe0');
  for (const m of opts.mark || []) s += `<circle cx="${X(m.B)}" cy="${py0 + 8}" r="4" fill="${m.col}"/>`;
  s += `<text x="${px0 + 6}" y="${py0 + 14}" font-size="11">T12</text><text x="${px0 + 34}" y="${py0 + 14}" font-size="11" fill="#e0403f">T13</text><text x="${px0 + 64}" y="${py0 + 14}" font-size="11" fill="#2f7fe0">T14</text>`;
  s += `<text x="${px0 - 6}" y="${Y(0)}" font-size="10" text-anchor="end">0</text><text x="${px0 - 6}" y="${Y(tmax) + 8}" font-size="10" text-anchor="end">${tmax.toFixed(2)}</text>`;
  return s;
}

const svgWrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Segoe UI, Arial" font-size="13"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;

// ---------------------------------------------------------------- Fig. 3c
{
  const cols = [['clean', 'Ballistic'], ['mild', 'Small-angle scattering, ℓ = 5 mm (2° kicks)'], ['strong', 'Small-angle scattering, ℓ = 1 mm (2° kicks)']];
  const scale = 150, iw = W * scale, ih = H * scale, gap = 40, top = 70;
  let body = `<text x="20" y="28" font-size="17" font-weight="600">Dirac fermion microscope, pinhole + parabolic p–n lens (cf. Bøggild et al. 2017, Fig. 3c), simulated in transim</text>`;
  cols.forEach(([k, title], c) => {
    const ox = 20 + c * (iw + gap);
    const run = D[k];
    const img = densityImage(run.maps, 0);
    body += `<text x="${ox}" y="${top - 8}" font-weight="600">${title}</text>`;
    body += deviceSVG(img, ox, top, scale, { dotR: 0, disc: true });
    body += `<text x="${ox + 6}" y="${top + 18}" fill="#fff" font-size="11">p</text><text x="${ox + 120}" y="${top + 18}" fill="#fff" font-size="11">n</text>`;
    body += plotT(run, ox, top + ih + 20, iw, 170, { mark: [{ B: 0, col: '#111' }, { B: 3.5, col: '#e0403f' }] });
  });
  body += `<text x="20" y="${top + ih + 250}" font-size="12" fill="#444">4 × 2 µm, n = ±10¹² cm⁻², point emitter at the focus of a parabolic p–n junction (f = 0.5 µm) behind an 80 nm aperture, reflecting disc (200 nm) at x = 3.3 µm. Images: B = 0 and 3.5 mT overlaid (dots on the curves). T12 back electrode (black), T13 top (red), T14 bottom (blue).</text>`;
  fs.writeFileSync(path.join(outDir, 'fig3c.svg'), svgWrap(20 + 3 * (iw + gap), top + ih + 270, body));
}

// ---------------------------------------------------------------- Fig. 4
{
  const rows = [['vd25', 'w = 2.5 nm'], ['vd40', 'w = 40 nm']];
  const Bs = [0, 0.002, 0.008];
  const x0 = 1.9, x1 = 4.0, scale = 190, iw = (x1 - x0) * scale, ih = H * scale, gap = 18, top = 60;
  let body = `<text x="20" y="28" font-size="17" font-weight="600">Imaging a Veselago dot (circular p–n junction, r = 0.25 µm) with the parabolic gun (cf. Bøggild et al. 2017, Fig. 4), simulated in transim</text>`;
  rows.forEach(([k, title], r) => {
    const oy = top + r * (ih + 40);
    body += `<text x="20" y="${oy + ih / 2}" font-weight="600" transform="rotate(-90 20 ${oy + ih / 2})" text-anchor="middle">${title}</text>`;
    Bs.forEach((b, c) => {
      const ox = 40 + c * (iw + gap);
      const m = D[k].maps.find(q => Math.abs(q.B - b) < 1e-9);
      const img = densityImage([m], 0.25, x0, x1);
      body += deviceSVG(img, ox, oy, scale, { dotR: 0.25, disc: false, x0, x1 });
      body += `<text x="${ox + 8}" y="${oy + 18}" fill="#fff" font-weight="600">${(b * 1e3).toFixed(0)} mT</text>`;
    });
  });
  const py = top + 2 * (ih + 40) + 10, pw = (3 * iw + 2 * gap - 40) / 2;
  rows.forEach(([k, title], r) => {
    const ox = 40 + r * (pw + 40);
    body += `<text x="${ox}" y="${py - 6}" font-weight="600">${title}</text>`;
    body += plotT(D[k], ox, py, pw, 170, { tmax: 0.2, mark: [{ B: 0, col: '#111' }, { B: 2, col: '#e0403f' }, { B: 8, col: '#2f7fe0' }] });
  });
  body += `<text x="40" y="${py + 220}" font-size="12" fill="#444">Same device as Fig. 3c with the disc replaced by a p-type dot; junction width d of Cayssol's smooth-step law. Images show x = 1.9–4 µm. T12 back (black dashed), T13 top (red), T14 bottom (blue).</text>`;
  fs.writeFileSync(path.join(outDir, 'fig4.svg'), svgWrap(40 + 3 * (iw + gap) + 20, py + 240, body));
}
console.log('wrote', path.join(outDir, 'fig3c.svg'), path.join(outDir, 'fig4.svg'));
