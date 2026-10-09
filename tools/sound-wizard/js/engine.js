// Sound Wizard engine: takes the microphone samples, analyses them and draws the views. Runs in a
// Web Worker on OffscreenCanvases (the page only handles touch), or on the page where a browser cannot
// draw from a worker. Nothing here touches the DOM.
//
// Timing: analysis that has a time axis (the waterfall, the level history) is driven by the samples
// as they arrive, so its time scale is exact whatever the screen does; drawing happens once per screen
// frame and only for the view that is showing.
import { RealFFT, hann, peakInterp, Weighting, noteOf, fmtHz, lut } from './dsp.js?v=20261009.1453';

const RING = 1 << 18;          // ~5.5 s at 48 kHz: enough for the largest FFT and the scope
const MASK = RING - 1;
const AES17 = 3.0103;          // dB: a full-scale sine reads 0 dBFS (RMS, AES17)
const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const DEFAULTS = {
  view: 'meter',
  // meter
  weight: 'A', tw: 'fast', unit: 'dbfs', cal: 110, calibrated: false,
  // spectrum
  layout: 'both', fft: 4096, speed: 60, gain: 0, range: 100, scale: 'log', fmin: 20, fmax: 20000, cmap: 'spectro', hold: true, a4: 440,
  // scope
  win: 10, sgain: 'auto', trig: 'auto',
};

const C = {
  bg: '#05070b', panel: '#0b1018', grid: 'rgba(110,150,200,0.13)', grid2: 'rgba(110,150,200,0.28)',
  text: '#8aa0b8', bright: '#e6f3ff', cyan: '#3ee8ff', magenta: '#ff3ec8', amber: '#ffb020', red: '#ff4060', green: '#3dff8a',
};

const makeCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(self.document.createElement('canvas'), { width: w, height: h }));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Engine {
  constructor(sr, settings, post) {
    this.sr = sr;
    this.S = { ...DEFAULTS, ...settings };
    this.post = post || (() => {});
    this.ring = new Float32Array(RING);
    this.w = 0;                       // samples written in total
    this.views = {};
    this.paused = false;
    this.pointer = null;
    this.frames = 0;
    // level meter
    this.wA = new Weighting('A', sr); this.wC = new Weighting('C', sr);
    this.ms = { Z: [1e-12, 1e-12], A: [1e-12, 1e-12], C: [1e-12, 1e-12] };   // mean squares [fast, slow]
    this.kf = 1 - Math.exp(-1 / (0.125 * sr)); this.ks = 1 - Math.exp(-1 / (1.0 * sr));
    this.peakBlock = 0; this.peakShow = 0; this.peakHoldT = 0;
    this.resetStats();
    this.hist = new Float32Array(600).fill(NaN); this.histI = 0; this.histAcc = 0;
    // spectrum
    this.rowAcc = 0; this.rowCount = 0; this.specFresh = false;
    this.setupFFT();
    this.lut = lut(this.S.cmap);
    // load
    this.busy = 0; this.loadT0 = now(); this.load = 0;
  }

  resetStats() {
    this.leq = { Z: 0, A: 0, C: 0, n: 0 };
    this.min = Infinity; this.max = -Infinity; this.peakMax = 0;
  }

  setupFFT() {
    const N = this.S.fft;
    if (this.fftN === N) return;
    this.fftN = N;
    this.fft = new RealFFT(N);
    const h = hann(N);
    this.win = h.w; this.dbNorm = h.norm;
    this.fbuf = new Float64Array(N);
    this.pow = new Float32Array(N / 2 + 1);
    this.specDb = new Float32Array(N / 2 + 1).fill(-200);
    this.mapDirty = true;
  }

  // ------------------------------------------------------------------------------- messages
  attach(id, canvas) {
    this.views[id] = { cv: canvas, ctx: canvas.getContext('2d', { alpha: false }), w: canvas.width, h: canvas.height, dpr: 1 };
  }
  message(d) {
    switch (d.type) {
      case 'resize': {
        const v = this.views[d.id];
        if (!v) return;
        v.dpr = d.dpr; v.cssW = d.w; v.cssH = d.h;
        v.cv.width = Math.max(1, Math.round(d.w * d.dpr)); v.cv.height = Math.max(1, Math.round(d.h * d.dpr));
        v.w = v.cv.width; v.h = v.cv.height;
        if (d.id === 'spec') this.mapDirty = true;
        break;
      }
      case 'set': this.set(d.key, d.value); break;
      case 'pointer': this.pointer = d.active ? { id: d.id, x: d.x, y: d.y } : null; break;
      case 'pause': this.paused = !!d.on; break;
      case 'hidden': this.hidden = !!d.on; break;
      case 'reset': this.resetStats(); break;
      case 'calibrate': { // the reading the user's reference meter shows for the current sound
        const raw = this.level(this.S.weight, this.S.tw, true);
        this.S.cal = d.value - raw; this.S.calibrated = true; this.S.unit = 'spl';
        this.post({ type: 'saved', settings: { cal: this.S.cal, calibrated: true, unit: 'spl' } });
        this.resetStats();
        break;
      }
      case 'stats': this.post({ type: 'stats', id: d.id, stats: this.stats() }); break;
    }
  }
  set(key, value) {
    const S = this.S;
    S[key] = value;
    if (key === 'fft') { this.setupFFT(); this.clearWaterfall(); }
    if (key === 'cmap') { this.lut = lut(value); this.repaintWaterfall(); }
    if (key === 'gain' || key === 'range') this.repaintWaterfall();
    if (key === 'scale' || key === 'fmin' || key === 'fmax') { this.mapDirty = true; }
    if (key === 'weight' || key === 'tw' || key === 'unit') this.resetStats();
  }

  // ---------------------------------------------------------------------------------- input
  push(block) {
    if (this.paused) return;
    const t0 = now();
    const n = block.length, ring = this.ring, wA = this.wA, wC = this.wC, kf = this.kf, ks = this.ks;
    let w = this.w;
    let zf = this.ms.Z[0], zs = this.ms.Z[1], af = this.ms.A[0], as = this.ms.A[1], cf = this.ms.C[0], cs = this.ms.C[1];
    let pk = 0, sz = 0, sa = 0, sc = 0;
    for (let i = 0; i < n; i++) {
      const x = block[i];
      ring[(w + i) & MASK] = x;
      const a = wA.step(x), c = wC.step(x);
      const x2 = x * x, a2 = a * a, c2 = c * c;
      zf += (x2 - zf) * kf; zs += (x2 - zs) * ks;
      af += (a2 - af) * kf; as += (a2 - as) * ks;
      cf += (c2 - cf) * kf; cs += (c2 - cs) * ks;
      sz += x2; sa += a2; sc += c2;
      const ax = x < 0 ? -x : x;
      if (ax > pk) pk = ax;
    }
    this.w = w + n;
    this.ms.Z[0] = zf; this.ms.Z[1] = zs; this.ms.A[0] = af; this.ms.A[1] = as; this.ms.C[0] = cf; this.ms.C[1] = cs;
    const L = this.leq; L.Z += sz; L.A += sa; L.C += sc; L.n += n;
    if (pk > this.peakBlock) this.peakBlock = pk;
    if (pk > this.peakMax) this.peakMax = pk;
    const lv = this.level(this.S.weight, this.S.tw);
    if (this.w > this.sr * 0.3) { if (lv < this.min) this.min = lv; if (lv > this.max) this.max = lv; }
    this.histAcc += n;
    while (this.histAcc >= this.sr * 0.1) { this.histAcc -= this.sr * 0.1; this.hist[this.histI] = lv; this.histI = (this.histI + 1) % this.hist.length; }
    if (this.S.view === 'spec') this.specRows(n);
    this.busy += now() - t0;
  }

  // level in dB for a weighting (Z, A, C) and time weighting (fast, slow)
  level(wt, tw, raw = false) {
    const ms = this.ms[wt][tw === 'slow' ? 1 : 0];
    const db = 10 * Math.log10(ms + 1e-20) + AES17;
    return raw || this.S.unit !== 'spl' ? db : db + this.S.cal;
  }

  // ------------------------------------------------------------------------------- spectrum
  // the frequency at an x position of the plot, and the bin columns each pixel covers
  fAt(x, W) {
    const S = this.S, fmax = Math.min(S.fmax, this.sr / 2), fmin = Math.max(S.scale === 'log' ? 5 : 0, Math.min(S.fmin, fmax / 2));
    return S.scale === 'log' ? fmin * Math.pow(fmax / fmin, x / W) : fmin + (fmax - fmin) * x / W;
  }
  xOf(f, W) {
    const S = this.S, fmax = Math.min(S.fmax, this.sr / 2), fmin = Math.max(S.scale === 'log' ? 5 : 0, Math.min(S.fmin, fmax / 2));
    return S.scale === 'log' ? W * Math.log(f / fmin) / Math.log(fmax / fmin) : W * (f - fmin) / (fmax - fmin);
  }
  buildMap(W) {
    const df = this.sr / this.fftN, m = this.fftN / 2;
    this.xa = new Int32Array(W); this.xb = new Int32Array(W); this.xf = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const b0 = this.fAt(x, W) / df, b1 = this.fAt(x + 1, W) / df;
      if (b1 - b0 < 1) { // less than a bin per pixel: interpolate between the two nearest bins
        const bc = clamp((b0 + b1) / 2, 0, m - 1), i = Math.floor(bc);
        this.xa[x] = i; this.xb[x] = i + 1; this.xf[x] = bc - i;
      } else {             // several bins in one pixel: the strongest
        this.xa[x] = clamp(Math.floor(b0), 0, m); this.xb[x] = clamp(Math.ceil(b1), this.xa[x] + 1, m + 1); this.xf[x] = -1;
      }
    }
    this.mapW = W; this.mapDirty = false;
  }
  mapRow(db, out, W) {
    const xa = this.xa, xb = this.xb, xf = this.xf;
    for (let x = 0; x < W; x++) {
      const f = xf[x];
      if (f >= 0) { const a = db[xa[x]], b = db[xb[x]]; out[x] = a + (b - a) * f; }
      else { let mx = -300; for (let k = xa[x], e = xb[x]; k < e; k++) if (db[k] > mx) mx = db[k]; out[x] = mx; }
    }
  }
  computeSpectrum(end) {
    const N = this.fftN, buf = this.fbuf, win = this.win, ring = this.ring, start = end - N;
    for (let i = 0; i < N; i++) buf[i] = ring[(start + i) & MASK] * win[i];
    this.fft.power(buf, this.pow);
    const p = this.pow, db = this.specDb, k = this.dbNorm, m = N / 2;
    for (let j = 0; j <= m; j++) db[j] = 4.342944819 * Math.log(p[j] + 1e-30) + k; // 10·log10
    this.specFresh = true;
  }
  // waterfall geometry for the current canvas: the plot area and the row ring
  specLayout(v) {
    const pad = Math.round(6 * v.dpr), axis = Math.round(18 * v.dpr), S = this.S;
    const W = v.w - 2 * pad;
    let lineH = 0, wfH = 0;
    const top = Math.round(26 * v.dpr);
    const avail = v.h - top - axis - pad;
    if (S.layout === 'line') lineH = avail;
    else if (S.layout === 'wf') wfH = avail;
    else { lineH = Math.round(avail * 0.36); wfH = avail - lineH; }
    return { pad, axis, top, W: Math.max(16, W), lineH, wfH: Math.max(0, wfH), lineY: top, axisY: top + lineH, wfY: top + lineH + axis };
  }
  ensureWaterfall(W, H) {
    if (this.wf && this.wf.W === W && this.wf.H === H) return this.wf;
    if (H < 1) { this.wf = null; return null; }
    const cv = makeCanvas(W, H), ctx = cv.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    this.wf = { W, H, cv, ctx, r: 0, rows: new Float32Array(W * H).fill(-300), img: ctx.createImageData(W, 1) };
    this.wf.px = new Uint32Array(this.wf.img.data.buffer);
    this.rowBuf = new Float32Array(W);
    return this.wf;
  }
  clearWaterfall() { if (this.wf) { this.wf.rows.fill(-300); this.wf.ctx.fillStyle = '#000'; this.wf.ctx.fillRect(0, 0, this.wf.W, this.wf.H); } this.mapDirty = true; }
  repaintWaterfall() {
    const wf = this.wf;
    if (!wf) return;
    const img = wf.ctx.createImageData(wf.W, wf.H), px = new Uint32Array(img.data.buffer), lutT = this.lut;
    const g = this.S.gain, r = this.S.range;
    for (let i = 0, n = wf.W * wf.H; i < n; i++) px[i] = lutT[clamp(((wf.rows[i] + g + r) / r * 255) | 0, 0, 255)];
    wf.ctx.putImageData(img, 0, 0);
  }
  specRows(n) {
    const v = this.views.spec;
    if (!v) return;
    const L = this.specLayout(v);
    if (this.mapDirty || this.mapW !== L.W) { this.buildMap(L.W); this.clearWaterfall(); this.mapDirty = false; }
    const wf = this.ensureWaterfall(L.W, L.wfH);
    const hop = this.sr / this.S.speed;
    this.rowAcc += n;
    if (this.rowAcc > hop * 8) this.rowAcc = hop * 8; // after a pause: do not burst
    while (this.rowAcc >= hop) {
      this.rowAcc -= hop;
      this.computeSpectrum(Math.round(this.w - this.rowAcc));
      this.rowCount++;
      if (!wf) continue;
      wf.r = (wf.r - 1 + wf.H) % wf.H;
      const row = wf.rows.subarray(wf.r * wf.W, (wf.r + 1) * wf.W);
      this.mapRow(this.specDb, row, wf.W);
      const px = wf.px, lutT = this.lut, g = this.S.gain, r = this.S.range;
      for (let x = 0; x < wf.W; x++) px[x] = lutT[clamp(((row[x] + g + r) / r * 255) | 0, 0, 255)];
      wf.ctx.putImageData(wf.img, 0, wf.r);
    }
  }
  // the strongest peak between fmin and fmax in the latest spectrum
  specPeak() {
    const df = this.sr / this.fftN, m = this.fftN / 2, S = this.S;
    const a = Math.max(2, Math.floor(Math.max(S.fmin, 10) / df)), b = Math.min(m - 2, Math.ceil(Math.min(S.fmax, this.sr / 2) / df));
    let k = a, mx = -1;
    for (let j = a; j <= b; j++) if (this.pow[j] > mx) { mx = this.pow[j]; k = j; }
    const p = peakInterp(this.pow, k);
    return { f: p.k * df, db: p.db + this.dbNorm };
  }

  // ---------------------------------------------------------------------------------- frame
  // drawn even while held (paused input), so a frozen spectrum can still be read with a finger
  frame() {
    if (this.hidden) return;
    const t0 = now();
    const v = this.views[this.S.view];
    if (v && v.w > 1) {
      if (this.S.view === 'meter') this.drawMeter(v);
      else if (this.S.view === 'spec') this.drawSpec(v);
      else if (this.S.view === 'scope') this.drawScope(v);
    }
    this.frames++;
    this.busy += now() - t0;
    const t = now();
    if (t - this.loadT0 > 1000) {
      this.load = this.busy / (t - this.loadT0);
      this.busy = 0; this.loadT0 = t;
      this.post({ type: 'load', load: this.load, fps: this.frames });
      this.frames = 0;
    }
  }

  // ---------------------------------------------------------------------------------- meter
  drawMeter(v) {
    const { ctx, w, h, dpr } = v, S = this.S;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const spl = S.unit === 'spl';
    const lv = this.level(S.weight, S.tw);
    const lo = spl ? 20 : -100, hi = spl ? 130 : 0;
    // peak (sample peak, unweighted) with a short hold
    const t = now();
    const pkDb = 20 * Math.log10(this.peakBlock + 1e-12) + (spl ? S.cal : 0);
    if (pkDb > this.peakShow || t - this.peakHoldT > 1500) { this.peakShow = pkDb; this.peakHoldT = t; }
    this.peakBlock = 0;
    const pad = 16 * dpr, cx = w / 2;
    // the number
    const big = Math.min(w * 0.26, h * 0.17);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${big}px ${FONT}`;
    ctx.fillStyle = lv > (spl ? 100 : -6) ? C.amber : C.bright;
    const y0 = pad + big * 0.95;
    ctx.fillText(isFinite(lv) && lv > lo - 20 ? lv.toFixed(1) : '—', cx, y0);
    ctx.font = `500 ${15 * dpr}px ${FONT}`; ctx.fillStyle = C.cyan;
    const unitTxt = spl ? `dB(${S.weight}) SPL` : `dBFS · ${S.weight === 'Z' ? 'flat' : S.weight + '-weighted'}`;
    ctx.fillText(`${unitTxt} · ${S.tw === 'slow' ? 'Slow' : 'Fast'}`, cx, y0 + 22 * dpr);
    if (spl && !S.calibrated) { ctx.font = `${12 * dpr}px ${FONT}`; ctx.fillStyle = C.amber; ctx.fillText('estimate: not calibrated (⚙ → Calibrate)', cx, y0 + 40 * dpr); }
    // the bar
    const by = y0 + 56 * dpr, bh = Math.max(14 * dpr, h * 0.035), bx = pad, bw = w - 2 * pad;
    const X = d => bx + bw * clamp((d - lo) / (hi - lo), 0, 1);
    ctx.fillStyle = C.panel; ctx.fillRect(bx, by, bw, bh);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#0a7a4a'); grad.addColorStop(0.6, C.green); grad.addColorStop(0.82, C.amber); grad.addColorStop(1, C.red);
    ctx.fillStyle = grad; ctx.fillRect(bx, by, X(lv) - bx, bh);
    ctx.fillStyle = C.bright; ctx.fillRect(X(this.peakShow) - dpr, by - 3 * dpr, 2 * dpr, bh + 6 * dpr);
    if (isFinite(this.max)) { ctx.fillStyle = C.magenta; ctx.fillRect(X(this.max) - dpr, by, 2 * dpr, bh); }
    ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.textAlign = 'center';
    for (let d = lo; d <= hi; d += spl ? 10 : 10) { const x = X(d); ctx.fillRect(x, by + bh + 2 * dpr, 1, 4 * dpr); if ((d - lo) % 20 === 0) ctx.fillText(String(d), x, by + bh + 17 * dpr); }
    // the numbers below
    const L = this.leq, leqMs = L.n ? L[S.weight] / L.n : 0;
    const leq = 10 * Math.log10(leqMs + 1e-20) + AES17 + (spl ? S.cal : 0);
    const peakAll = 20 * Math.log10(this.peakMax + 1e-12) + (spl ? S.cal : 0);
    const cells = [['Min', this.min], ['Max', this.max], ['Leq', leq], ['Peak', peakAll]];
    const sy = by + bh + 30 * dpr, cw = bw / 4;
    cells.forEach(([k, val], i) => {
      const x = bx + cw * (i + 0.5);
      ctx.fillStyle = C.text; ctx.font = `${12 * dpr}px ${FONT}`; ctx.fillText(k, x, sy + 12 * dpr);
      ctx.fillStyle = C.bright; ctx.font = `600 ${19 * dpr}px ${MONO}`; ctx.fillText(isFinite(val) && val > lo - 40 ? val.toFixed(1) : '—', x, sy + 36 * dpr);
    });
    // the last minute
    const gy = sy + 52 * dpr, gh = h - gy - 22 * dpr;
    if (gh > 40 * dpr) {
      const gx = bx + 30 * dpr, gw = bw - 30 * dpr;
      ctx.fillStyle = C.panel; ctx.fillRect(gx, gy, gw, gh);
      ctx.textAlign = 'right'; ctx.font = `${10 * dpr}px ${FONT}`;
      const Y = d => gy + gh - gh * clamp((d - lo) / (hi - lo), 0, 1);
      for (let d = lo; d <= hi; d += 20) { ctx.fillStyle = C.grid; ctx.fillRect(gx, Y(d), gw, 1); ctx.fillStyle = C.text; ctx.fillText(String(d), gx - 4 * dpr, Y(d) + 3 * dpr); }
      ctx.textAlign = 'center';
      for (let s = 0; s <= 60; s += 10) { const x = gx + gw * (1 - s / 60); ctx.fillStyle = C.grid; ctx.fillRect(x, gy, 1, gh); ctx.fillStyle = C.text; ctx.fillText(s ? `−${s} s` : 'now', x, gy + gh + 14 * dpr); }
      ctx.beginPath();
      const n = this.hist.length;
      let started = false;
      for (let i = 0; i < n; i++) {
        const val = this.hist[(this.histI + i) % n];
        if (!isFinite(val)) { started = false; continue; }
        const x = gx + gw * i / (n - 1), y = Y(val);
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.6 * dpr; ctx.stroke();
    }
  }

  // ------------------------------------------------------------------------------- spectrum
  drawSpec(v) {
    const { ctx, w, h, dpr } = v, S = this.S;
    const L = this.specLayout(v);
    if (this.mapDirty || this.mapW !== L.W) { this.buildMap(L.W); this.clearWaterfall(); }
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const x0 = L.pad, W = L.W;
    const top = -S.gain, bot = -S.gain - S.range;
    // waterfall
    const wf = this.ensureWaterfall(W, L.wfH);
    if (wf && L.wfH > 0) {
      const r = wf.r;
      if (wf.H - r > 0) ctx.drawImage(wf.cv, 0, r, W, wf.H - r, x0, L.wfY, W, wf.H - r);
      if (r > 0) ctx.drawImage(wf.cv, 0, 0, W, r, x0, L.wfY + wf.H - r, W, r);
      // seconds along the left edge
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'left';
      for (let s = 1; s * S.speed < wf.H; s++) { const y = L.wfY + s * S.speed; ctx.fillRect(x0, y, 6 * dpr, 1); if (s % (S.speed >= 120 ? 1 : 2) === 0 || S.speed < 30) ctx.fillText(`${s}s`, x0 + 8 * dpr, y + 3 * dpr); }
    }
    // spectrum line
    if (!this.lineSm || this.lineSm.length !== W) { this.lineSm = new Float32Array(W).fill(-300); this.lineHold = new Float32Array(W).fill(-300); this.lineNow = new Float32Array(W); }
    if (this.specFresh) {
      this.mapRow(this.specDb, this.lineNow, W);
      for (let x = 0; x < W; x++) {
        const a = this.lineNow[x];
        this.lineSm[x] = this.lineSm[x] < -250 ? a : this.lineSm[x] + (a - this.lineSm[x]) * 0.45;
        this.lineHold[x] = Math.max(this.lineHold[x] - 0.35, a);
      }
      this.specFresh = false;
    }
    const lineY = L.lineY, lineH = L.lineH;
    const Y = d => lineY + lineH * clamp((top - d) / (top - bot), 0, 1);
    if (lineH > 0) {
      ctx.fillStyle = C.panel; ctx.fillRect(x0, lineY, W, lineH);
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'left';
      const step = S.range > 100 ? 20 : 10;
      for (let d = Math.ceil(bot / step) * step; d <= top; d += step) { const y = Y(d); ctx.fillStyle = C.grid; ctx.fillRect(x0, y, W, 1); ctx.fillStyle = C.text; if (y > lineY + 10 * dpr) ctx.fillText(`${d}`, x0 + 3 * dpr, y - 2 * dpr); }
      // fill under the smoothed line, then the line and the peak hold
      ctx.beginPath(); ctx.moveTo(x0, lineY + lineH);
      for (let x = 0; x < W; x++) ctx.lineTo(x0 + x, Y(this.lineSm[x]));
      ctx.lineTo(x0 + W, lineY + lineH); ctx.closePath();
      const g = ctx.createLinearGradient(0, lineY, 0, lineY + lineH);
      g.addColorStop(0, 'rgba(62,232,255,0.35)'); g.addColorStop(1, 'rgba(62,232,255,0.02)');
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath();
      for (let x = 0; x < W; x++) { const y = Y(this.lineSm[x]); if (x) ctx.lineTo(x0 + x, y); else ctx.moveTo(x0, y); }
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.4 * dpr; ctx.stroke();
      if (S.hold) {
        ctx.beginPath();
        for (let x = 0; x < W; x++) { const y = Y(this.lineHold[x]); if (x) ctx.lineTo(x0 + x, y); else ctx.moveTo(x0, y); }
        ctx.strokeStyle = 'rgba(255,62,200,0.7)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
      }
    }
    // frequency axis
    const ay = L.axisY;
    ctx.fillStyle = C.bg; ctx.fillRect(0, ay, w, L.axis);
    ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = C.text;
    for (const f of this.freqTicks(W)) {
      const x = x0 + this.xOf(f, W);
      ctx.fillStyle = C.grid2; ctx.fillRect(x, ay, 1, 4 * dpr);
      if (lineH > 0) { ctx.fillStyle = C.grid; ctx.fillRect(x, lineY, 1, lineH); }
      ctx.fillStyle = C.text; ctx.fillText(f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : String(f), x, ay + 14 * dpr);
    }
    // the strongest peak
    const pk = this.specPeak();
    ctx.textAlign = 'left'; ctx.font = `600 ${14 * dpr}px ${MONO}`;
    if (pk.db > bot + 12) {
      const q = noteOf(pk.f, S.a4);
      ctx.fillStyle = C.bright;
      ctx.fillText(`▲ ${fmtHz(pk.f)}`, x0, 18 * dpr);
      ctx.fillStyle = C.cyan;
      const ct = Math.round(q.cents);
      ctx.fillText(`${q.name}${q.octave} ${ct > 0 ? '+' : ct < 0 ? '−' : '±'}${Math.abs(ct)}¢  ${pk.db.toFixed(1)} dB`, x0 + ctx.measureText(`▲ ${fmtHz(pk.f)}  `).width, 18 * dpr);
      if (lineH > 0) { const px = x0 + this.xOf(pk.f, W); ctx.fillStyle = C.bright; ctx.beginPath(); ctx.moveTo(px, Y(pk.db) - 9 * dpr); ctx.lineTo(px - 5 * dpr, Y(pk.db) - 17 * dpr); ctx.lineTo(px + 5 * dpr, Y(pk.db) - 17 * dpr); ctx.fill(); }
    } else { ctx.fillStyle = C.text; ctx.fillText('listening…', x0, 18 * dpr); }
    ctx.textAlign = 'right'; ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
    ctx.fillText(`FFT ${S.fft} · ${(this.sr / S.fft).toFixed(1)} Hz/bin · ${(S.fft / this.sr * 1000).toFixed(0)} ms`, w - L.pad, 18 * dpr);
    // the cursor: frequency, note and level where the finger is
    const p = this.pointer;
    if (p && p.id === 'spec') {
      const px = p.x * dpr;
      if (px >= x0 && px <= x0 + W) {
        const f = this.fAt(px - x0, W), xi = clamp(Math.round(px - x0), 0, W - 1), d = this.lineSm[xi];
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(px, lineY, 1, h - lineY);
        const q = noteOf(f, S.a4), txt = `${fmtHz(f)}  ${q.name}${q.octave}  ${isFinite(d) && d > -250 ? d.toFixed(0) + ' dB' : ''}`;
        ctx.font = `600 ${13 * dpr}px ${MONO}`;
        const tw = ctx.measureText(txt).width + 12 * dpr, tx = clamp(px - tw / 2, 2, w - tw - 2), ty = lineY + 4 * dpr;
        ctx.fillStyle = 'rgba(5,7,11,0.85)'; ctx.fillRect(tx, ty, tw, 20 * dpr);
        ctx.fillStyle = C.bright; ctx.textAlign = 'left'; ctx.fillText(txt, tx + 6 * dpr, ty + 15 * dpr);
      }
    }
  }
  freqTicks(W) {
    const S = this.S, fmax = Math.min(S.fmax, this.sr / 2), fmin = S.scale === 'log' ? Math.max(5, S.fmin) : S.fmin;
    const out = [];
    if (S.scale === 'log') {
      for (let dec = 1; dec <= 100000; dec *= 10) for (const m of [1, 2, 5]) { const f = dec * m; if (f >= fmin && f <= fmax) out.push(f); }
    } else {
      const span = fmax - fmin, raw = span / Math.max(2, W / (70 * (this.views.spec?.dpr || 1))), p = 10 ** Math.floor(Math.log10(raw)), st = [1, 2, 5, 10].map(k => k * p).find(s => s >= raw);
      for (let f = Math.ceil(fmin / st) * st; f <= fmax; f += st) out.push(Math.round(f));
    }
    return out;
  }

  // ---------------------------------------------------------------------------------- scope
  drawScope(v) {
    const { ctx, w, h, dpr } = v, S = this.S, sr = this.sr, ring = this.ring;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const n = Math.max(16, Math.round(S.win / 1000 * sr));
    const pad = 8 * dpr, top = 26 * dpr, gx = pad, gy = top, gw = w - 2 * pad, gh = h - top - 24 * dpr;
    // amplitude of the recent signal (for auto gain, the trigger hysteresis and the readout)
    const look = Math.min(RING - 1, n * 3 + Math.round(sr * 0.05));
    let pk = 0;
    for (let i = this.w - look; i < this.w; i++) { const a = Math.abs(ring[i & MASK]); if (a > pk) pk = a; }
    // trigger: the latest rising crossing of zero (with hysteresis) that still leaves a full window
    let start = this.w - n, frac = 0, freq = NaN;
    const hyst = Math.max(pk * 0.08, 1e-5);
    if (S.trig === 'auto' && pk > 1e-4) {
      const from = this.w - look, to = this.w - n;
      let armed = false, found = -1;
      const cross = [];
      for (let i = from; i < this.w; i++) {
        const x = ring[i & MASK];
        if (x < -hyst) armed = true;
        else if (armed && x >= 0) {
          armed = false;
          const x0 = ring[(i - 1) & MASK], t = i - 1 + (x0 < 0 ? -x0 / (x - x0) : 0);
          cross.push(t);
          if (i <= to) found = t;
        }
      }
      if (found >= 0) { start = Math.floor(found); frac = found - start; }
      if (cross.length >= 3) { // frequency from the crossings in the last ~0.15 s
        const c = cross.filter(t => t > this.w - sr * 0.15);
        if (c.length >= 3) freq = (c.length - 1) * sr / (c[c.length - 1] - c[0]);
      }
    }
    const gain = S.sgain === 'auto' ? (pk > 1e-5 ? 0.85 / pk : 1) : +S.sgain;
    // grid: 10 × 8 divisions
    ctx.fillStyle = C.panel; ctx.fillRect(gx, gy, gw, gh);
    for (let i = 0; i <= 10; i++) { ctx.fillStyle = i === 5 ? C.grid2 : C.grid; ctx.fillRect(gx + gw * i / 10, gy, 1, gh); }
    for (let i = 0; i <= 8; i++) { ctx.fillStyle = i === 4 ? C.grid2 : C.grid; ctx.fillRect(gx, gy + gh * i / 8, gw, 1); }
    const mid = gy + gh / 2, amp = gh / 2;
    const Y = x => mid - clamp(x * gain, -1.05, 1.05) * amp;
    ctx.beginPath();
    const spp = n / gw; // samples per pixel
    if (spp > 1.5) { // min/max per pixel column: every peak shows, however long the window
      for (let px = 0; px < gw; px++) {
        const a = start + Math.floor(px * spp), b = start + Math.floor((px + 1) * spp);
        let mn = 1e9, mx = -1e9;
        for (let i = a; i < b; i++) { const x = ring[i & MASK]; if (x < mn) mn = x; if (x > mx) mx = x; }
        ctx.moveTo(gx + px + 0.5, Y(mx)); ctx.lineTo(gx + px + 0.5, Y(mn) + 0.5);
      }
    } else {
      for (let i = 0; i <= n; i++) {
        const x = gx + (i - frac) / n * gw, y = Y(ring[(start + i) & MASK]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
    }
    ctx.strokeStyle = 'rgba(61,255,138,0.25)'; ctx.lineWidth = 4 * dpr; ctx.stroke();
    ctx.strokeStyle = C.green; ctx.lineWidth = 1.4 * dpr; ctx.stroke();
    // readouts
    ctx.font = `600 ${14 * dpr}px ${MONO}`; ctx.textAlign = 'left'; ctx.fillStyle = C.bright;
    const per = S.win / 10;
    ctx.fillText(`${per >= 1 ? per.toFixed(per < 10 ? 1 : 0) + ' ms' : (per * 1000).toFixed(0) + ' µs'}/div`, gx, 18 * dpr);
    ctx.fillStyle = C.cyan;
    if (isFinite(freq)) { const q = noteOf(freq, S.a4); ctx.fillText(`${fmtHz(freq)}  ${q.name}${q.octave}`, gx + 120 * dpr, 18 * dpr); }
    ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.font = `${11 * dpr}px ${FONT}`;
    ctx.fillText(`peak ${(20 * Math.log10(pk + 1e-12)).toFixed(1)} dBFS · ${S.sgain === 'auto' ? 'auto' : '×' + S.sgain} · ${S.trig === 'auto' ? 'trig ↑' : 'free run'}`, w - pad, 18 * dpr);
    this.scopeFreq = freq;
  }

  // ---------------------------------------------------------------------------------- stats (tests, status)
  stats() {
    const pk = this.specFresh !== undefined && this.fftN ? this.specPeak() : null;
    return {
      sr: this.sr, samples: this.w, load: this.load,
      level: { Z: this.level('Z', 'fast', true), A: this.level('A', 'fast', true), C: this.level('C', 'fast', true), Zslow: this.level('Z', 'slow', true) },
      peakDb: 20 * Math.log10(this.peakMax + 1e-12), specPeak: pk, rows: this.rowCount, scopeFreq: this.scopeFreq, view: this.S.view,
      weighting: { A: [100, 1000, 10000].map(f => 20 * Math.log10(this.wA.response(f, this.sr))), C: [100, 1000, 10000].map(f => 20 * Math.log10(this.wC.response(f, this.sr))) },
    };
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
