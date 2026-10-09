// Sound Wizard engine: takes the microphone samples, analyses them and draws the views. Runs in a
// Web Worker on OffscreenCanvases (the page only handles touch), or on the page where a browser cannot
// draw from a worker. Nothing here touches the DOM.
//
// Timing: analysis that has a time axis (the waterfall, the level history) is driven by the samples
// as they arrive, so its time scale is exact whatever the screen does; drawing happens once per screen
// frame and only for the view that is showing.
import { RealFFT, hann, peakInterp, Weighting, noteOf, fmtHz, lut, PitchMPM, chromaFromSpectrum, estimateKey, ChordListener, NOTE_NAMES } from './dsp.js?v=20261009.1712';
import { analysePoly } from './poly.js?v=20261009.1712';
import { describePolyrhythm, METERS } from './notation.js?v=20261009.1712';

// instruments for the tuner: strings low to high. The pitch range searched and the analysis window follow
// from the strings (below ~40 Hz the window is 8192 samples: two periods of a low B are 65 ms).
const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'E2', 'F#1', 'Bb0', 'E♭4' → { midi }; a letter without octave ('A', 'F#') → { pc }; null if not a note.
// Only a lowercase b is a flat, so "AEADGBE" reads as seven notes.
export function parseNote(s) {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)?$/.exec(String(s).trim());
  if (!m) return null;
  const base = NOTE_IDX[m[1].toUpperCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0);
  return m[3] === undefined ? { pc: (base + 12) % 12 } : { midi: base + 12 * (+m[3] + 1) };
}
// a typed tuning, low to high: "A1 E2 A2 D3 G3 B3 E4", or letters only ("AEADGBE", "DADGAD"): then the
// lowest string is placed between A1 and G♯2 and each next string is the nearest note above the one before
export function parseTuning(text) {
  const raw = String(text || '').trim();
  const toks = /[\s,]/.test(raw) ? raw.split(/[\s,]+/).filter(Boolean) : (raw.match(/[A-Ga-g][#♯b♭]?-?\d?/g) || []);
  if (!toks.length || toks.length > 12 || toks.join('').length !== raw.replace(/[\s,]+/g, '').length) return null;
  const out = [];
  for (const t of toks) {
    const p = parseNote(t);
    if (!p) return null;
    if (p.midi !== undefined) out.push(p.midi);
    else if (!out.length) out.push(33 + ((p.pc - 9 + 12) % 12));
    else { let m = out[out.length - 1] + 1; while (((m % 12) + 12) % 12 !== p.pc) m++; out.push(m); }
  }
  return out;
}
const T = (name, strings, opts = {}) => ({ name, strings, ...opts });
export const TUNINGS = {
  free: T('Free · any note', [], { fmin: 25, fmax: 4200, W: 4096 }),
  guitar: T('Guitar · standard', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  dropd: T('Guitar · drop D', ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  dropc: T('Guitar · drop C', ['C2', 'G2', 'C3', 'F3', 'A3', 'D4']),
  dropb: T('Guitar · drop B', ['B1', 'F♯2', 'B2', 'E3', 'G♯3', 'C♯4']),
  halfdown: T('Guitar · ½ step down', ['E♭2', 'A♭2', 'D♭3', 'G♭3', 'B♭3', 'E♭4']),
  dadgad: T('Guitar · DADGAD', ['D2', 'A2', 'D3', 'G3', 'A3', 'D4']),
  openg: T('Guitar · open G', ['D2', 'G2', 'D3', 'G3', 'B3', 'D4']),
  g7dropa: T('7-string · drop A (AEADGBE)', ['A1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  g7: T('7-string · standard', ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  g8: T('8-string · standard', ['F♯1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  g8drope: T('8-string · drop E', ['E1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  bass4: T('Bass · 4 strings', ['E1', 'A1', 'D2', 'G2'], { fmax: 500 }),
  bass5: T('Bass · 5 strings', ['B0', 'E1', 'A1', 'D2', 'G2'], { fmax: 500 }),
  ukulele: T('Ukulele', ['G4', 'C4', 'E4', 'A4']),
  violin: T('Violin', ['G3', 'D4', 'A4', 'E5']),
  cello: T('Cello', ['C2', 'G2', 'D3', 'A3']),
};
function finishTuning(t) {
  t.midi = t.strings.map(s => parseNote(s).midi);
  if (t.midi.length) {
    const fLo = 440 * Math.pow(2, (Math.min(...t.midi) - 69) / 12), fHi = 440 * Math.pow(2, (Math.max(...t.midi) - 69) / 12);
    if (t.fmin === undefined) t.fmin = Math.max(20, fLo * 0.7);
    if (t.fmax === undefined) t.fmax = Math.min(4200, fHi * 4);
    if (t.W === undefined) t.W = fLo < 40 ? 8192 : 4096;
  }
  return t;
}
for (const t of Object.values(TUNINGS)) finishTuning(t);
// a tuning by key: a preset, or 'custom:N' from the user's own (settings.custom = [{ name, strings }])
export function tuningOf(key, custom) {
  if (String(key).startsWith('custom:')) {
    const c = (custom || [])[+String(key).slice(7)];
    if (c && c.strings && c.strings.length) return finishTuning({ name: `★ ${c.name}`, strings: c.strings.slice(), custom: true });
  }
  return TUNINGS[key] || TUNINGS.free;
}
export const midiName = m => { const n = Math.round(m); return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`; };
const HIST = 480; // pitch history: 480 blocks of 1024 samples ≈ 10 s

const RING = 1 << 18;          // ~5.5 s at 48 kHz: enough for the largest FFT and the scope
const MASK = RING - 1;
const AES17 = 3.0103;          // dB: a full-scale sine reads 0 dBFS (RMS, AES17)
const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
const BAND_COL = { low: '#ff8a3d', mid: '#3dff8a', high: '#e6f3ff' }; // the registers of the heard onsets
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const DEFAULTS = {
  view: 'meter',
  // meter
  weight: 'A', tw: 'fast', unit: 'dbfs', cal: 110, calibrated: false,
  // spectrum
  layout: 'both', fft: 4096, speed: 60, gain: 0, range: 100, scale: 'log', fmin: 20, fmax: 20000, cmap: 'spectro', hold: true, a4: 440,
  // scope
  win: 10, sgain: 'auto', trig: 'auto',
  // tuner
  tuning: 'free', custom: [],
  // tone generator (the page plays it; listed here so all settings live in one place)
  genMode: 'note', genWave: 'sine', genLevel: -18, genHz: 440, genMidi: 69,
  // rhythm
  meter: 'auto',
  autoFs: true,
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
    // pitch (tuner and tone)
    this.pm = null;
    this.pRecent = [];                                   // the last few good estimates (median)
    this.pitch = null;                                   // { f, midi, clarity, at }
    this.hMidi = new Float32Array(HIST).fill(NaN);       // smoothed pitch per block
    this.hCents = new Float32Array(HIST).fill(NaN);      // cents from the tuner's target per block
    this.hI = 0;
    this.lockString = -1; this.target = null; this.centsSm = 0; this.settledAt = 0;
    this.hAtk = new Uint8Array(HIST); this.coach = []; this.strStatus = []; this.learn = null;
    // tone
    this.toneFFT = null; this.toneAcc = 0;
    this.chroma = new Float32Array(12); this.chromaFast = new Float32Array(12); this.chromaSlow = new Float32Array(12);
    this.harm = new Float32Array(16).fill(-80); this.centroid = NaN; this.key = null; this.chord = null;
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
      case 'pointer':
        this.pointer = d.active ? { id: d.id, x: d.x, y: d.y } : null;
        if (d.down && d.id === 'tuner') {
          const hit = list => (list || []).find(q => d.x * q.dpr >= q.x && d.x * q.dpr <= q.x + q.w && d.y * q.dpr >= q.y && d.y * q.dpr <= q.y + q.h);
          const lb = this.learn && hit(this.learnBtns), c = !this.learn && hit(this.tunerCells), nb = hit(this.noteBox ? [this.noteBox] : []);
          if (lb) { // learn my tuning: Undo / Done / Cancel
            if (lb.id === 'undo') { this.learn.notes.pop(); this.learn.capT = -9; }
            if (lb.id === 'cancel') this.learn = null;
            if (lb.id === 'done' && this.learn.notes.length) { this.post({ type: 'learned', strings: this.learn.notes.map(midiName) }); this.learn = null; }
          } else if (c) this.lockString = this.lockString === c.i ? -1 : c.i; // tap a string to lock onto it, again to let go
          else if (nb && this.target) this.post({ type: 'ref', midi: this.target.midi }); // the target as a reference tone
        }
        if (d.down && d.id === 'rhythm' && this.rh) {
          const R = this.rh, hit = list => (list || []).find(q => d.x * q.dpr >= q.x && d.x * q.dpr <= q.x + q.w && d.y * q.dpr >= q.y && d.y * q.dpr <= q.y + q.h);
          const chip = hit(this.chipBoxes), mb = hit(this.meterBoxes), sg = hit(this.sugBoxes), tb = this.tapBox && hit([this.tapBox]);
          if (chip) { // choose the main pulse (the chosen one again: back to automatic)
            R.mainLock = R.mainLock && Math.abs(Math.log(chip.bpm / R.mainLock)) < 0.04 ? null : chip.bpm;
            R.polyShown = null; R.polyLast = null; R.polyCount = 0; R.notation = null;
            R.polyNow = true; // the next frame runs the analysis
          } else if (mb) { this.set('meter', mb.meter); this.post({ type: 'saved', settings: { meter: mb.meter } }); }
          else if (sg) { R.sugSel = sg.i; }
          else if (tb) { // tap tempo
            const t = now(), T = R.taps;
            if (T.length && t - T[T.length - 1] > 2500) T.length = 0;
            T.push(t); if (T.length > 9) T.shift();
          }
        }
        break;
      case 'pause': this.paused = !!d.on; break;
      case 'hidden': this.hidden = !!d.on; break;
      case 'learnStart': this.learn = { notes: [], buf: [], silence: true }; this.lockString = -1; break;
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
    if (key === 'tuning' || key === 'custom') { this.lockString = -1; this.pRecent.length = 0; this.strStatus = []; this.tunCache = null; }
    if (key === 'view') { this.pRecent.length = 0; }
    if (key === 'meter' && this.rh) { this.rh.notation = null; this.updateNotation(); }
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
    this.lastBlockDb = 10 * Math.log10(sz / n + 1e-20) + AES17;
    if (pk > this.peakBlock) this.peakBlock = pk;
    if (pk > this.peakMax) this.peakMax = pk;
    const lv = this.level(this.S.weight, this.S.tw);
    if (this.w > this.sr * 0.3) { if (lv < this.min) this.min = lv; if (lv > this.max) this.max = lv; }
    this.histAcc += n;
    while (this.histAcc >= this.sr * 0.1) { this.histAcc -= this.sr * 0.1; this.hist[this.histI] = lv; this.histI = (this.histI + 1) % this.hist.length; }
    const view = this.S.view;
    if (view === 'spec') this.specRows(n);
    if (view === 'tuner' || view === 'tone') this.pitchStep();
    if (view === 'tone') this.toneStep(n);
    if (view === 'rhythm') this.rhythmStep(n);
    this.busy += now() - t0;
  }

  // --------------------------------------------------------------------------------- rhythm
  // Every 512 samples (~94 frames/s): spectral flux in 48 log-spaced bands (the onset strength) and the
  // RMS envelope. Every ~0.25 s: tempo from the autocorrelation of the onset strength, with the multiples
  // of each period added in (a beat repeats at 2P and 3P too) and a broad preference around 120 BPM to
  // settle double/half ambiguity. Every ~0.5 s: the repetition rate (spectrum of the RMS envelope,
  // 0.5–40 Hz) and the main frequencies (peaks of a 2 s average spectrum).
  setupRhythm() {
    const R = this.rh = { hop: 512, acc: 0, fr: this.sr / 512, N: 1024 };
    R.fft = new RealFFT(R.N); R.win = hann(R.N).w; R.buf = new Float64Array(R.N); R.pow = new Float32Array(R.N / 2 + 1);
    const nb = 48, df = this.sr / R.N;
    R.bandEdge = new Int32Array(nb + 1);
    for (let b = 0; b <= nb; b++) R.bandEdge[b] = Math.max(1, Math.round(40 * Math.pow(12000 / 40, b / nb) / df));
    R.prev = new Float32Array(nb); R.cur = new Float32Array(nb);
    R.E = 1024; R.env = new Float32Array(R.E); R.rms = new Float32Array(R.E); R.ei = 0; R.frames = 0;
    // the same onset strength per register: low (40–200 Hz), middle (200–2000), high (2000–12000)
    R.envB = { low: new Float32Array(R.E), mid: new Float32Array(R.E), high: new Float32Array(R.E) };
    R.bandGroup = new Uint8Array(nb);
    for (let b = 0; b < nb; b++) { const f = 40 * Math.pow(12000 / 40, (b + 0.5) / nb); R.bandGroup[b] = f < 200 ? 0 : f < 2000 ? 1 : 2; }
    R.polyRaw = null; R.polyShown = null; R.polyMiss = 0; R.polyCount = 0; R.polyLast = null; R.mainLock = null; R.notation = null; R.sugSel = 0; R.polyAbs = null; R.barFrames = null;
    R.lin = new Float32Array(R.E); R.acf = new Float32Array(R.E);
    R.bpm = NaN; R.bpmSm = NaN; R.conf = 0; R.pending = null; R.hist = new Float32Array(120).fill(NaN); R.hi = 0;
    R.onsets = []; R.lastOnset = {};
    R.modFFT = new RealFFT(1024); R.modBuf = new Float64Array(1024); R.modPow = new Float32Array(513); R.modWin = hann(512).w; R.mod = null;
    R.big = new RealFFT(32768); R.bigWin = hann(32768).w; R.bigBuf = new Float64Array(32768); R.bigPow = new Float32Array(16385); R.avgDb = null; R.peaks = [];
    R.taps = [];
  }
  rhythmStep(n) {
    if (!this.rh) this.setupRhythm();
    const R = this.rh;
    R.acc += n;
    while (R.acc >= R.hop) {
      R.acc -= R.hop;
      const end = this.w - R.acc, ring = this.ring, buf = R.buf, win = R.win, N = R.N;
      let ss = 0;
      for (let i = 0; i < N; i++) { const x = ring[(end - N + i) & MASK]; buf[i] = x * win[i]; if (i >= N - R.hop) ss += x * x; }
      R.fft.power(buf, R.pow);
      let flux = 0, fl = 0, fm = 0, fh = 0;
      for (let b = 0; b < R.cur.length; b++) {
        let e = 0;
        for (let k = R.bandEdge[b], k1 = Math.max(R.bandEdge[b] + 1, R.bandEdge[b + 1]); k < k1; k++) e += R.pow[k];
        const L = Math.pow(e, 0.3); // compressed like loudness, not logarithmic: a loud kick outweighs a quiet hat
        const d = L - R.prev[b];
        if (d > 0) { flux += d; const g = R.bandGroup[b]; if (g === 0) fl += d; else if (g === 1) fm += d; else fh += d; }
        R.prev[b] = L;
      }
      R.env[R.ei] = flux; R.envB.low[R.ei] = fl; R.envB.mid[R.ei] = fm; R.envB.high[R.ei] = fh;
      R.rms[R.ei] = Math.sqrt(ss / R.hop); R.ei = (R.ei + 1) % R.E; R.frames++;
      // an onset: the flux well above its recent level, and the highest in the last ~70 ms
      this.onsetCheck(R);
      if (R.frames % 24 === 0 && R.frames > R.fr * 3) this.tempoEstimate(R);
      if (R.frames % 48 === 0) { this.modEstimate(R); this.mainFreqs(R); }
      if ((R.frames % 48 === 24 || R.polyNow) && R.frames > R.fr * 3) { R.polyNow = false; this.polyEstimate(R); }
    }
  }
  // the pulses and the polyrhythm, every ~0.5 s, over the last ~11 s; a second layer must be found
  // twice running before it is shown and is kept for ~1.5 s after it stops being found
  polyEstimate(R) {
    const E = R.E, W = Math.min(E, R.frames), lin = k => { const out = new Float32Array(W); for (let i = 0; i < W; i++) out[i] = k[(R.ei - W + i + E) % E]; return out; };
    const env = { all: lin(R.env), low: lin(R.envB.low), mid: lin(R.envB.mid), high: lin(R.envB.high) };
    const prefer = R.mainLock || (R.polyRaw && R.polyRaw.main ? R.polyRaw.main.bpm : null);
    const res = analysePoly(env, R.fr, { mainBpm: R.mainLock, prefer });
    if (!res || !res.main) { R.polyRaw = res; return; }
    R.polyRaw = res;
    const first = R.frames - W; // the window's frame 0, as an absolute frame count
    const P = res.main.P;
    // the grid in absolute frames: the latest main beat, and the cycle start it belongs to
    const nPts = res.main.pts, lastBeat = first + res.main.phi + (nPts - 1) * P;
    // the bars: the chosen meter's length, or the detected one; the downbeat from the detection
    const M = METERS[this.S.meter], beats = M ? M.n : res.meter ? res.meter.beats : 0; // main beats per bar
    const down = res.meter && res.meter.downFrame != null ? first + res.meter.downFrame : lastBeat;
    R.barFrames = beats ? { start: down, len: beats * P } : null;
    const d = res.poly ? res.poly.d : 0;
    const cycle = res.poly ? res.poly.q * P : beats ? beats * P : P;
    const cycleStart = res.poly ? lastBeat - (((nPts - 1 - d) % res.poly.q + res.poly.q) % res.poly.q) * P : beats ? down : lastBeat;
    R.polyAbs = { P, cycle, gridStart: lastBeat, cycleStart, beats };
    // hysteresis on the claim
    const same = (a, b) => a && b && a.p === b.p && a.q === b.q;
    if (res.poly) {
      R.polyCount = same(res.poly, R.polyLast) ? R.polyCount + 1 : 1;
      R.polyLast = res.poly; R.polyMiss = 0;
      if (R.polyCount >= 2) R.polyShown = { ...res.poly };
    } else {
      R.polyMiss++;
      if (R.polyMiss >= 3) { R.polyShown = null; R.polyLast = null; R.polyCount = 0; }
    }
    this.updateNotation();
  }
  updateNotation() {
    const R = this.rh, sh = R.polyShown, main = R.polyRaw && R.polyRaw.main;
    if (!sh || !main) { R.notation = null; return; }
    const key = `${sh.p}:${sh.q}|${this.S.meter}|${Math.round(main.bpm)}|${main.band}|${sh.band}`;
    if (R.notation && R.notation.key === key) return;
    const nt = describePolyrhythm({ p: sh.p, q: sh.q, bpm: main.bpm, meter: this.S.meter, bands: { main: main.band, second: sh.band === 'all' ? null : sh.band } });
    R.notation = nt ? { ...nt, key } : null;
    if (R.notation && R.sugSel >= R.notation.suggestions.length) R.sugSel = 0;
  }
  // onsets, per register: a frame whose onset strength stands well above that register's recent level
  // and is the highest in the last ~70 ms. A kick and a hat at once give two onsets (amber and white).
  onsetCheck(R) {
    const M = 40, E = R.E, loud = 10 * Math.log10(this.ms.Z[0] + 1e-20) + AES17 > -60;
    if (!loud) return;
    const k = (R.ei - 2 + E) % E;
    for (const band of ['low', 'mid', 'high']) {
      const env = R.envB[band];
      let mean = 0, sq = 0;
      for (let i = 1; i <= M; i++) { const v = env[(R.ei - 1 - i + E) % E]; mean += v; sq += v * v; }
      mean /= M; const sd = Math.sqrt(Math.max(0, sq / M - mean * mean));
      const v = env[k], before = env[(R.ei - 3 + E) % E], after = env[(R.ei - 1 + E) % E];
      const last = R.lastOnset[band] || -99;
      if (v > mean + 1.8 * sd + 0.15 * mean && v > 0.02 && v >= before && v >= after && R.frames - 1 - last > R.fr * 0.07) {
        R.lastOnset[band] = R.frames - 1;
        R.onsets.push({ f: R.frames - 1, amp: v, band, ripple: true });
        if (R.onsets.length > 240) R.onsets.shift();
        this.onsetFlash = now();
      }
    }
  }
  tempoEstimate(R) {
    const E = R.E, N = Math.min(E, R.frames), lin = R.lin, acf = R.acf, fr = R.fr;
    // the onset strength, oldest first, minus its moving average (1 s), negative parts dropped
    for (let i = 0; i < N; i++) lin[i] = R.env[(R.ei - N + i + E) % E];
    const half = Math.round(fr / 2), tmp = new Float32Array(N);
    let s = 0, c = 0;
    for (let i = 0; i < Math.min(N, half); i++) { s += lin[i]; c++; }
    for (let i = 0; i < N; i++) {
      if (i + half < N) { s += lin[i + half]; c++; }
      if (i - half - 1 >= 0) { s -= lin[i - half - 1]; c--; }
      tmp[i] = Math.max(0, lin[i] - s / c);
    }
    const Lmin = Math.floor(60 * fr / 240), Lmax = Math.min(Math.ceil(60 * fr / 40), Math.floor(N / 3));
    let e0 = 0;
    for (let i = 0; i < N; i++) e0 += tmp[i] * tmp[i];
    if (e0 <= 1e-9) { R.conf *= 0.8; return; }
    for (let L = Lmin - 1; L <= Math.min(N - 1, 3 * Lmax + 2); L++) {
      let a = 0;
      for (let i = L; i < N; i++) a += tmp[i] * tmp[i - L];
      acf[L] = (a / (N - L)) / (e0 / N);
    }
    let best = -1, bestL = 0;
    for (let L = Lmin; L <= Lmax; L++) {
      const bpm = 60 * fr / L, prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
      const sc = (acf[L] + 0.5 * (acf[2 * L] || 0) + 0.33 * (acf[3 * L] || 0)) * prior;
      if (sc > best) { best = sc; bestL = L; }
    }
    const a = acf[bestL - 1], b = acf[bestL], cc = acf[bestL + 1], d = a - 2 * b + cc;
    const Lf = bestL + (d < 0 ? 0.5 * (a - cc) / d : 0);
    const bpm = 60 * fr / Lf;
    R.conf = Math.max(0, Math.min(1, b));
    // follow small drifts smoothly; a new tempo has to show up twice before it replaces the old one
    if (!isFinite(R.bpmSm) || Math.abs(bpm / R.bpmSm - 1) < 0.04) R.bpmSm = isFinite(R.bpmSm) ? R.bpmSm + (bpm - R.bpmSm) * 0.35 : bpm;
    else if (R.pending && Math.abs(bpm / R.pending - 1) < 0.04) { R.bpmSm = bpm; R.pending = null; }
    else R.pending = bpm;
    R.bpm = bpm;
    R.hist[R.hi] = R.conf > 0.15 ? R.bpmSm : NaN; R.hi = (R.hi + 1) % R.hist.length;
  }
  modEstimate(R) {
    const E = R.E, M = 512;
    if (R.frames < M) return;
    let mean = 0;
    for (let i = 0; i < M; i++) mean += R.rms[(R.ei - M + i + E) % E];
    mean /= M;
    if (mean < 1e-5) { R.mod = null; return; }
    const buf = R.modBuf;
    buf.fill(0);
    for (let i = 0; i < M; i++) buf[i] = (R.rms[(R.ei - M + i + E) % E] - mean) * R.modWin[i];
    R.modFFT.power(buf, R.modPow);
    const df = R.fr / 1024, k0 = Math.ceil(0.5 / df), k1 = Math.min(511, Math.floor(40 / df));
    let mx = 0, km = k0, tot = 0;
    for (let k = k0; k <= k1; k++) { tot += R.modPow[k]; if (R.modPow[k] > mx) { mx = R.modPow[k]; km = k; } }
    const p = peakInterp(R.modPow, km);
    R.mod = { f: p.k * df, share: tot > 0 ? mx / tot : 0, depth: Math.sqrt(mx) / (mean * 512 / 4), df, k0, k1 };
  }
  mainFreqs(R) {
    const N = 32768, buf = R.bigBuf, ring = this.ring, start = this.w - N;
    for (let i = 0; i < N; i++) buf[i] = ring[(start + i) & MASK] * R.bigWin[i];
    R.big.power(buf, R.bigPow);
    const m = N / 2, norm = 20 * Math.log10(2 / (N / 2));
    if (!R.avgDb) R.avgDb = new Float32Array(m + 1).fill(-200);
    for (let k = 0; k <= m; k++) { const d = 10 * Math.log10(R.bigPow[k] + 1e-30) + norm; R.avgDb[k] = R.avgDb[k] < -150 ? d : R.avgDb[k] + (d - R.avgDb[k]) * 0.3; }
    const df = this.sr / N, k0 = Math.ceil(25 / df), k1 = Math.min(m - 2, Math.floor(16000 / df)), A = R.avgDb;
    let mx = -300;
    for (let k = k0; k <= k1; k++) if (A[k] > mx) mx = A[k];
    const cand = [];
    for (let k = k0; k <= k1; k++) if (A[k] > mx - 45 && A[k] > -90 && A[k] >= A[k - 1] && A[k] > A[k + 1]) {
      // it must stand out: 8 dB above the lowest point on each side within ±6 % (not a shoulder of a broader peak)
      const span = Math.max(3, Math.round(k * 0.06));
      let lmin = A[k], rmin = A[k];
      for (let j = k - 1; j >= Math.max(1, k - span) && A[j] <= A[k]; j--) lmin = Math.min(lmin, A[j]);
      for (let j = k + 1; j <= Math.min(m, k + span) && A[j] <= A[k]; j++) rmin = Math.min(rmin, A[j]);
      if (A[k] - Math.max(lmin, rmin) < 8) continue;
      const a = A[k - 1], b = A[k], c = A[k + 1], d = a - 2 * b + c, dk = d < 0 ? 0.5 * (a - c) / d : 0;
      cand.push({ f: (k + dk) * df, db: b - 0.25 * (a - c) * dk });
    }
    cand.sort((x, y) => y.db - x.db);
    const out = [];
    for (const c of cand) { if (out.every(o => Math.abs(Math.log2(c.f / o.f)) > 0.04)) out.push(c); if (out.length >= 6) break; }
    R.peaks = out;
  }

  // ---------------------------------------------------------------------------------- pitch
  // the tuning in use (presets, or the user's own: cached, as this runs every block)
  tuning() {
    const S = this.S, key = `${S.tuning}|${S.tuning.startsWith('custom:') ? JSON.stringify(S.custom || []) : ''}`;
    if (!this.tunCache || this.tunCache.key !== key) this.tunCache = { key, t: tuningOf(S.tuning, S.custom) };
    return this.tunCache.t;
  }
  // one estimate per arriving block (~21 ms): McLeod pitch on the latest window, a median of the last
  // five good estimates against stray readings, and a history for the traces. A new pluck (the level
  // jumps 6 dB above its decaying envelope) starts an "attack" of 150 ms: a plucked string runs sharp
  // there, so those readings go on the trace (dimmed) but do not move the needle, the coaching or the
  // per-string memory.
  pitchStep() {
    const S = this.S, tun = this.tuning();
    const cfg = S.view === 'tone' ? { W: 8192, fmin: 27, fmax: 2100 } : tun;
    if (!this.pm || this.pm.W !== cfg.W) this.pm = new PitchMPM(cfg.W);
    const lvl = 10 * Math.log10(this.ms.Z[0] + 1e-20) + AES17;
    const bl = this.lastBlockDb ?? -120, env = this.lvlEnv ?? -120;
    if (bl > env + 6 && bl > -60) { this.attackUntil = this.w + this.sr * 0.15; this.newStrum = true; }
    this.lvlEnv = Math.max(bl, env - 1.2);
    const attack = this.w < (this.attackUntil || 0);
    const p = lvl > -65 ? this.pm.detect(this.ring, MASK, this.w, this.sr, cfg.fmin, cfg.fmax) : { f: NaN, clarity: 0 };
    let midi = NaN;
    if (p.clarity > 0.86 && isFinite(p.f)) {
      const m = 69 + 12 * Math.log2(p.f / S.a4);
      // a reading an octave or more away from the last ones is held back until it repeats
      this.pRecent.push(m);
      if (this.pRecent.length > 5) this.pRecent.shift();
      const sorted = [...this.pRecent].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      midi = Math.abs(m - med) < 0.6 ? m : med;
      this.pitch = { f: S.a4 * Math.pow(2, (midi - 69) / 12), midi, clarity: p.clarity, at: this.w };
    } else if (this.pitch && this.w - this.pitch.at > this.sr * 0.25) {
      this.pRecent.length = 0;
    }
    // the tuner's target: a locked string, the nearest string, or (free) the nearest note
    let cents = NaN;
    if (isFinite(midi)) {
      let tm = Math.round(midi), idx = -1;
      if (S.view === 'tuner' && tun.midi.length) {
        idx = this.lockString >= 0 && this.lockString < tun.midi.length ? this.lockString
          : tun.midi.reduce((b, x, i) => (Math.abs(x - midi) < Math.abs(tun.midi[b] - midi) ? i : b), 0);
        tm = tun.midi[idx];
      }
      this.target = { midi: tm, idx };
      cents = (midi - tm) * 100;
    }
    if (S.view === 'tuner') {
      const t = this.w / this.sr;
      if (isFinite(cents) && !attack) {
        // the needle: smoothed, but a jump to another note follows at once
        this.centsSm = Math.abs(cents - this.centsSm) > 30 || !this.settledAt ? cents : this.centsSm + (cents - this.centsSm) * 0.35;
        this.settledAt = this.w;
        this.coach.push([t, cents]);
        while (this.coach.length && t - this.coach[0][0] > 0.4) this.coach.shift();
        if (this.target.idx >= 0) this.strStatus[this.target.idx] = { cents: this.centsSm, at: this.w };
      } else if (!isFinite(cents)) {
        this.coach.length = 0;
        if (this.settledAt && this.w - this.settledAt > this.sr * 1.5) this.settledAt = 0;
      }
      if (this.learn) this.learnStep(midi, attack, t);
    }
    this.hMidi[this.hI] = midi; this.hCents[this.hI] = cents; this.hAtk[this.hI] = attack ? 1 : 0; this.hI = (this.hI + 1) % HIST;
  }
  // learn my tuning: each open string played and held; a note that stays within a quarter tone for
  // ~0.45 s is captured (rounded to the nearest note); the next capture needs a different note, or the
  // same note again after a silence, and at least 0.8 s
  learnStep(midi, attack, t) {
    const L = this.learn;
    if (!isFinite(midi)) { L.buf.length = 0; if (t - (L.lastPitchT || 0) > 0.4) L.silence = true; return; }
    if (attack) return;
    L.lastPitchT = t;
    L.buf.push([t, midi]);
    while (L.buf.length && t - L.buf[0][0] > 0.45) L.buf.shift();
    if (L.buf.length < 15 || t - (L.capT ?? -9) < 0.8 || L.notes.length >= 12) return;
    const ms = L.buf.map(x => x[1]).sort((a, b) => a - b);
    if (ms[ms.length - 1] - ms[0] > 0.25) return;
    const note = Math.round(ms[ms.length >> 1]);
    if (L.notes.length && note === L.notes[L.notes.length - 1] && !L.silence) return;
    L.notes.push(note); L.capT = t; L.silence = false; L.buf.length = 0;
  }
  // what the player should do now: from the distance and from how the pitch is moving (a straight line
  // through the last 0.4 s of settled readings: cents per second)
  advice(c, live, tun) {
    const k = this.coach, free = !tun.midi.length;
    if (!live) return { text: free ? 'play a note' : 'play a string', sub: '', col: C.text };
    if (this.w < (this.attackUntil || 0) && !this.settledAt) return { text: 'listening…', sub: '', col: C.text };
    let slope = 0;
    if (k.length >= 6) {
      const n = k.length, mt = k.reduce((s, x) => s + x[0], 0) / n, mc = k.reduce((s, x) => s + x[1], 0) / n;
      let num = 0, den = 0;
      for (const [t, v] of k) { num += (t - mt) * (v - mc); den += (t - mt) ** 2; }
      slope = den > 0 ? num / den : 0;
    }
    const a = Math.abs(c), steady = Math.abs(slope) < 4;
    // a locked string more than 1.5 semitones off: most likely another string is ringing; turning the peg
    // that far would be wrong advice
    if (this.lockString >= 0 && a > 150) return { text: 'wrong string?', sub: `${(a / 100).toFixed(1)} semitones ${c < 0 ? 'below' : 'above'} the ${tun.strings[this.lockString]} string`, col: C.amber };
    const next = this.nextString(tun);
    if (a <= 2) return steady ? { text: '✓ in tune', sub: free ? '' : next >= 0 ? `next: ${tun.strings[next]} string` : 'all strings in tune ✓', col: C.green } : { text: 'almost…', sub: 'hold it there', col: C.green };
    if (slope * c > 0 && Math.abs(slope) > 3) return { text: 'other way!', sub: c < 0 ? 'it is flat: tighten (raise) it' : 'it is sharp: loosen (lower) it', col: C.red };
    if (slope * c < 0 && Math.abs(slope) > 3) {
      const tt = a / Math.abs(slope);
      return tt < 0.6 ? { text: 'slow down…', sub: `${a.toFixed(0)} ¢ to go`, col: C.amber } : { text: 'keep going', sub: `${a.toFixed(0)} ¢ to go`, col: C.amber };
    }
    const amount = a > 25 ? 'a lot' : a > 8 ? 'a bit' : 'a touch';
    return { text: c < 0 ? `tighten ▲ ${amount}` : `loosen ▼ ${amount}`, sub: c < 0 ? 'flat: too low' : 'sharp: too high', col: a > 10 ? C.red : C.amber };
  }
  // the first string (low to high) not yet measured in tune; −1 when all are
  nextString(tun) {
    const cur = this.target ? this.target.idx : -1;
    for (let i = 0; i < tun.midi.length; i++) {
      const s = this.strStatus[i];
      if (i === cur && Math.abs(this.centsSm) <= 2) continue;
      if (!s || Math.abs(s.cents) > 2) return i;
    }
    return -1;
  }

  // ----------------------------------------------------------------------------------- tone
  // every ~85 ms: a 16384-point spectrum → the 12-note profile (fast for the chord, slow for the key),
  // the harmonics of the current pitch, and the spectral centroid (brightness)
  toneStep(n) {
    this.toneAcc += n;
    if (this.toneAcc < 4096) return;
    this.toneAcc = 0;
    const N = 16384;
    if (!this.toneFFT) { this.toneFFT = new RealFFT(N); const h = hann(N); this.toneWin = h.w; this.toneBuf = new Float64Array(N); this.tonePow = new Float32Array(N / 2 + 1); }
    const lvl = 10 * Math.log10(this.ms.Z[0] + 1e-20) + AES17;
    if (lvl < -65) return;
    const buf = this.toneBuf, win = this.toneWin, ring = this.ring, start = this.w - N;
    for (let i = 0; i < N; i++) buf[i] = ring[(start + i) & MASK] * win[i];
    this.toneFFT.power(buf, this.tonePow);
    const pow = this.tonePow, df = this.sr / N;
    if (chromaFromSpectrum(pow, df, this.S.a4, this.chroma) > 0) {
      for (let i = 0; i < 12; i++) { this.chromaFast[i] += (this.chroma[i] - this.chromaFast[i]) * 0.4; this.chromaSlow[i] += (this.chroma[i] - this.chromaSlow[i]) * 0.03; }
      // the chord: overtone-aware patterns over everything since the last strum (dsp.js ChordListener)
      if (!this.chordL || this.chordL.a4 !== this.S.a4) this.chordL = new ChordListener(this.sr, N, this.S.a4);
      // after a strum, wait until the window holds only the new strum (it reaches 0.34 s back, into the
      // previous chord's ringing, and the first 30 ms are pick noise): the last chord stays shown meanwhile
      if (this.newStrum) { this.strumAt = this.w - 1024; this.newStrum = false; }
      if (this.strumAt != null && this.w - N >= this.strumAt + this.sr * 0.03) { this.chordL.onset(); this.strumAt = null; }
      if (this.strumAt == null) {
        const r = this.chordL.add(pow);
        this.chord = r && { root: r.root, name: r.type, score: r.score, tones: r.tones, alt: r.alt, bass: r.bass, full: r.full };
      }
      this.key = estimateKey(this.chromaSlow);
    }
    // harmonics of the current pitch, relative to the strongest
    const p = this.pitch;
    if (p && this.w - p.at < this.sr * 0.2) {
      const db = new Float32Array(16);
      for (let h = 1; h <= 16; h++) {
        const f = p.f * h, k0 = Math.max(2, Math.floor((f * 0.985) / df)), k1 = Math.min(pow.length - 2, Math.ceil((f * 1.015) / df));
        let mx = 0;
        for (let k = k0; k <= k1; k++) if (pow[k] > mx) mx = pow[k];
        db[h - 1] = f < this.sr / 2 ? 10 * Math.log10(mx + 1e-30) : -300;
      }
      const top = Math.max(...db);
      for (let i = 0; i < 16; i++) this.harm[i] += (Math.max(-80, db[i] - top) - this.harm[i]) * 0.5;
    }
    let sa = 0, sf = 0;
    for (let k = Math.floor(50 / df); k < Math.min(pow.length, 10000 / df); k++) { const a = Math.sqrt(pow[k]); sa += a; sf += a * k * df; }
    this.centroid = sa > 0 ? sf / sa : NaN;
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
      else if (this.S.view === 'tuner') this.drawTuner(v);
      else if (this.S.view === 'tone') this.drawTone(v);
      else if (this.S.view === 'rhythm') this.drawRhythm(v);
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

  // ---------------------------------------------------------------------------------- tuner
  // Top to bottom: the strings (each with its last measured state; tap to lock), a strobe band (still =
  // in tune), the note, what to do now (with coaching while the peg turns), any warning, the gauge and
  // the last 10 s. Tap the note for a reference tone of the target.
  drawTuner(v) {
    const { ctx, w, h, dpr } = v, S = this.S, tun = this.tuning(), free = !tun.midi.length;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const pad = 14 * dpr, cx = w / 2;
    const p = this.pitch, live = p && this.w - p.at < this.sr * 0.35, recent = p && this.w - p.at < this.sr * 2.5;
    ctx.font = `${12 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(tun.name, pad, 20 * dpr);
    ctx.textAlign = 'right'; ctx.fillText(`A4 = ${S.a4} Hz`, w - pad, 20 * dpr);
    let y = 30 * dpr;
    this.tunerCells = []; this.learnBtns = [];
    if (this.learn) { y = this.drawLearn(v, y); }
    else if (tun.midi.length) {
      const n = tun.midi.length, gap = 5 * dpr, cw = (w - 2 * pad - gap * (n - 1)) / n, ch = 54 * dpr, next = this.nextString(tun);
      tun.strings.forEach((s, i) => {
        const x = pad + i * (cw + gap), on = this.target && this.target.idx === i && recent, locked = this.lockString === i, st = this.strStatus[i];
        ctx.fillStyle = on ? 'rgba(62,232,255,0.18)' : C.panel; ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = locked ? C.amber : on ? C.cyan : C.grid2; ctx.lineWidth = (locked ? 2 : 1) * dpr; ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        ctx.textAlign = 'center'; ctx.fillStyle = on ? C.bright : C.text; ctx.font = `600 ${(n > 6 ? 14 : 16) * dpr}px ${FONT}`;
        ctx.fillText(s.replace(/-?\d+$/, ''), x + cw / 2, y + 20 * dpr);
        ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillText(locked ? 'locked' : s.replace(/^[^\d-]+/, ''), x + cw / 2, y + 33 * dpr);
        if (st) { // the last settled reading of this string
          const ok = Math.abs(st.cents) <= 2, col = ok ? C.green : Math.abs(st.cents) <= 10 ? C.amber : C.red;
          ctx.fillStyle = col; ctx.fillRect(x + 3 * dpr, y + ch - 6 * dpr, cw - 6 * dpr, 3 * dpr);
          ctx.font = `600 ${10 * dpr}px ${FONT}`; ctx.fillText(ok ? '✓' : `${st.cents > 0 ? '+' : '−'}${Math.abs(st.cents).toFixed(0)}`, x + cw / 2, y + ch - 11 * dpr);
        }
        if (i === next && !on) { ctx.fillStyle = C.cyan; ctx.beginPath(); ctx.moveTo(x + cw / 2 - 5 * dpr, y - 1); ctx.lineTo(x + cw / 2 + 5 * dpr, y - 1); ctx.lineTo(x + cw / 2, y + 6 * dpr); ctx.fill(); }
        this.tunerCells.push({ i, x, y, w: cw, h: ch, dpr });
      });
      y += ch;
    } else {
      ctx.textAlign = 'center'; ctx.font = `${12 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
      ctx.fillText('finds the note you play: tuned to no instrument and no scale', cx, y + 18 * dpr);
      y += 26 * dpr;
    }
    // the strobe band: stripes drift right when sharp, left when flat, faster the further off; still = in tune
    const c = this.centsSm, inTune = live && Math.abs(c) <= 2;
    const t = now(), dt = Math.min(0.1, (t - (this.strobeT || t)) / 1000);
    this.strobeT = t;
    if (live && isFinite(c) && this.settledAt) this.strobePh = (this.strobePh || 0) + clamp(c, -60, 60) * 5 * dpr * dt;
    y += 12 * dpr;
    const sh = 40 * dpr, sw = w - 2 * pad;
    ctx.fillStyle = C.panel; ctx.fillRect(pad, y, sw, sh);
    ctx.save(); ctx.beginPath(); ctx.rect(pad, y, sw, sh); ctx.clip();
    for (let row = 0; row < 2; row++) {
      const sp = (row ? 13 : 26) * dpr, ph = ((((this.strobePh || 0) * (row ? 2 : 1)) % sp) + sp) % sp, yy = y + row * sh / 2 + dpr, hh = sh / 2 - 2 * dpr;
      ctx.fillStyle = !live ? 'rgba(110,150,200,0.16)' : inTune ? (row ? 'rgba(61,255,138,0.6)' : C.green) : (row ? 'rgba(62,232,255,0.55)' : C.cyan);
      for (let x = pad - sp + ph; x < w - pad; x += sp) ctx.fillRect(x, yy, sp / 2, hh);
    }
    ctx.restore();
    ctx.font = `${9 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.fillText('◀ flat', pad + 3 * dpr, y + sh + 11 * dpr);
    ctx.textAlign = 'right'; ctx.fillText('sharp ▶', w - pad - 3 * dpr, y + sh + 11 * dpr);
    ctx.textAlign = 'center'; ctx.fillText('strobe: still = in tune', cx, y + sh + 11 * dpr);
    y += sh + 14 * dpr;
    // the note (tap it for a reference tone)
    const adv = this.advice(c, live && this.settledAt, tun);
    const col = !recent ? C.text : inTune ? C.green : Math.abs(c) <= 10 ? C.amber : C.red;
    const big = Math.min(w * 0.24, h * 0.12);
    const noteTop = y;
    y += big + 6 * dpr;
    ctx.textAlign = 'center'; ctx.fillStyle = recent ? col : C.grid2; ctx.font = `700 ${big}px ${FONT}`;
    const tname = this.target ? midiName(this.target.midi) : '—', letter = tname.replace(/-?\d+$/, ''), oct = tname.replace(/^[^\d-]+/, '');
    ctx.fillText(recent ? letter : '—', cx, y);
    if (recent) { const lw = ctx.measureText(letter).width; ctx.font = `600 ${big * 0.32}px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(oct, cx + lw / 2 + 4 * dpr, y); }
    this.noteBox = { x: cx - big, y: noteTop, w: 2 * big, h: big + 10 * dpr, dpr };
    ctx.textAlign = 'center'; ctx.font = `600 ${16 * dpr}px ${MONO}`; ctx.fillStyle = recent ? C.bright : C.text;
    ctx.fillText(recent ? `${fmtHz(p.f)}   ${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c).toFixed(1)} ¢` : '', cx, y + 24 * dpr);
    ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
    ctx.fillText(this.target ? `target ${fmtHz(S.a4 * Math.pow(2, (this.target.midi - 69) / 12))} · tap the note to hear it` : 'tap the note to hear it', cx, y + 39 * dpr);
    y += 70 * dpr;
    // what to do now
    ctx.font = `700 ${22 * dpr}px ${FONT}`; ctx.fillStyle = adv.col; ctx.fillText(adv.text, cx, y);
    ctx.font = `${13 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(adv.sub, cx, y + 19 * dpr);
    // warnings: a locked string played on the wrong string, or a note far from every string
    let warn = '';
    if (live && p && tun.midi.length) {
      if (this.lockString >= 0 && Math.abs(p.midi - tun.midi[this.lockString]) > 1.5) warn = `sounds like ${midiName(p.midi)}: is this the ${tun.strings[this.lockString]} string?`;
      else if (this.lockString < 0 && Math.min(...tun.midi.map(m => Math.abs(m - p.midi))) > 2.5) warn = `${midiName(p.midi)} is far from every string of this tuning`;
    }
    if (warn) { ctx.font = `600 ${12 * dpr}px ${FONT}`; ctx.fillStyle = C.amber; ctx.fillText(`⚠ ${warn}`, cx, y + 37 * dpr); }
    y += 46 * dpr;
    // the gauge: ±50 cents, green within ±2
    const gr = Math.min(w * 0.34, (h - y) * 0.42), gy = y + 32 * dpr + gr;
    if (gr > 40 * dpr) {
      const A = 1.15, ang = d => -Math.PI / 2 + clamp(d / 50, -1, 1) * A;
      ctx.lineWidth = 9 * dpr; ctx.lineCap = 'butt';
      ctx.strokeStyle = C.panel; ctx.beginPath(); ctx.arc(cx, gy, gr, ang(-50), ang(50)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,176,32,0.35)'; ctx.beginPath(); ctx.arc(cx, gy, gr, ang(-10), ang(10)); ctx.stroke();
      ctx.strokeStyle = 'rgba(61,255,138,0.75)'; ctx.beginPath(); ctx.arc(cx, gy, gr, ang(-2), ang(2)); ctx.stroke();
      ctx.lineWidth = 1.5 * dpr; ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
      for (let d = -50; d <= 50; d += 10) {
        const a = ang(d), r0 = gr + 8 * dpr, r1 = gr + (d % 50 === 0 || d === 0 ? 18 : 13) * dpr;
        ctx.strokeStyle = d === 0 ? C.bright : C.grid2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, gy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, gy + Math.sin(a) * r1); ctx.stroke();
        if (d % 25 === 0) ctx.fillText(d > 0 ? `+${d}` : String(d), cx + Math.cos(a) * (gr + 30 * dpr), gy + Math.sin(a) * (gr + 30 * dpr) + 4 * dpr);
      }
      if (recent && this.settledAt) {
        const a = ang(c);
        ctx.strokeStyle = col; ctx.lineWidth = 4 * dpr; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * gr * 0.15, gy + Math.sin(a) * gr * 0.15); ctx.lineTo(cx + Math.cos(a) * (gr - 4 * dpr), gy + Math.sin(a) * (gr - 4 * dpr)); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, gy, 6 * dpr, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.lineCap = 'butt';
    }
    // the last 10 s (the sharp start of each pluck dimmed)
    const ty = gy + 22 * dpr, th = h - ty - 22 * dpr;
    if (th > 50 * dpr) this.drawTrace(ctx, pad, ty, w - 2 * pad, th, dpr, 'cents');
  }
  // learn my tuning: what has been heard so far, the note now, and Undo / Done / Cancel
  drawLearn(v, y) {
    const { ctx, w, dpr } = v, L = this.learn, pad = 14 * dpr, cx = w / 2;
    ctx.fillStyle = 'rgba(255,62,200,0.12)'; ctx.fillRect(pad, y, w - 2 * pad, 112 * dpr);
    ctx.strokeStyle = C.magenta; ctx.lineWidth = dpr; ctx.strokeRect(pad + 0.5, y + 0.5, w - 2 * pad - 1, 112 * dpr - 1);
    ctx.textAlign = 'center'; ctx.font = `600 ${13 * dpr}px ${FONT}`; ctx.fillStyle = C.bright;
    ctx.fillText(`Learn my tuning: play string ${L.notes.length + 1}, lowest first, and let it ring`, cx, y + 20 * dpr);
    ctx.font = `600 ${18 * dpr}px ${MONO}`; ctx.fillStyle = L.notes.length ? C.magenta : C.text;
    ctx.fillText(L.notes.length ? L.notes.map(midiName).join('  ') : '…', cx, y + 48 * dpr);
    const labels = [['undo', 'Undo'], ['done', 'Done ✓'], ['cancel', 'Cancel']], bw = (w - 2 * pad - 40 * dpr) / 3;
    labels.forEach(([id, txt], i) => {
      const x = pad + 10 * dpr + i * (bw + 10 * dpr), by = y + 64 * dpr, bh = 38 * dpr;
      const on = id !== 'done' || L.notes.length > 0;
      ctx.fillStyle = id === 'done' && on ? C.magenta : C.panel; ctx.fillRect(x, by, bw, bh);
      ctx.strokeStyle = C.grid2; ctx.strokeRect(x + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.font = `600 ${14 * dpr}px ${FONT}`; ctx.fillStyle = on ? C.bright : C.grid2; ctx.fillText(txt, x + bw / 2, by + 24 * dpr);
      this.learnBtns.push({ id, x, y: by, w: bw, h: bh, dpr });
    });
    return y + 112 * dpr;
  }

  // a history strip: 'cents' (−50 … +50 around the target) or 'notes' (a note grid around the recent pitch)
  drawTrace(ctx, x, y, gw, gh, dpr, kind) {
    ctx.fillStyle = C.panel; ctx.fillRect(x, y, gw, gh);
    const n = HIST, data = kind === 'cents' ? this.hCents : this.hMidi;
    let lo, hi, Y;
    if (kind === 'cents') {
      lo = -50; hi = 50;
      Y = d => y + gh * (1 - (clamp(d, lo, hi) - lo) / (hi - lo));
      ctx.fillStyle = 'rgba(61,255,138,0.12)'; ctx.fillRect(x, Y(3), gw, Y(-3) - Y(3));
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'left';
      for (const d of [-50, -25, 0, 25, 50]) { ctx.fillStyle = d ? C.grid : C.grid2; ctx.fillRect(x, Y(d), gw, 1); ctx.fillStyle = C.text; ctx.fillText(d > 0 ? `+${d}¢` : `${d}¢`, x + 3 * dpr, Y(d) - 3 * dpr); }
    } else {
      const vals = [];
      for (let i = 0; i < n; i++) if (isFinite(data[i])) vals.push(data[i]);
      vals.sort((a, b) => a - b);
      const mid = vals.length ? Math.round(vals[vals.length >> 1]) : 60;
      lo = mid - 7; hi = mid + 7;
      Y = m => y + gh * (1 - (m - lo) / (hi - lo));
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'left';
      for (let m = lo; m <= hi; m++) {
        const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
        ctx.fillStyle = black ? 'rgba(0,0,0,0.25)' : 'rgba(110,150,200,0.06)'; ctx.fillRect(x, Y(m + 0.5), gw, Y(m - 0.5) - Y(m + 0.5));
        ctx.fillStyle = C.grid; ctx.fillRect(x, Y(m - 0.5), gw, 1);
        if (!black) { ctx.fillStyle = C.text; ctx.fillText(midiName(m), x + 3 * dpr, Y(m) + 3 * dpr); }
      }
    }
    ctx.textAlign = 'center'; ctx.fillStyle = C.text;
    for (const s of [10, 5, 0]) ctx.fillText(s ? `−${s} s` : 'now', x + gw * (1 - s / 10.24) - (s ? 0 : 10 * dpr), y + gh + 14 * dpr);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      const val = data[(this.hI + i) % n];
      if (!isFinite(val)) { pen = false; continue; }
      const px = x + gw * i / (n - 1), py = Y(val);
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 2 * dpr; ctx.lineJoin = 'round'; ctx.stroke();
    if (kind === 'cents') { // the sharp start of each pluck, dimmed over the line
      ctx.fillStyle = 'rgba(5,7,11,0.6)';
      for (let i = 0; i < n; i++) if (this.hAtk[(this.hI + i) % n]) ctx.fillRect(x + gw * i / (n - 1) - gw / n, y, gw / n * 2, gh);
    }
  }

  // ----------------------------------------------------------------------------------- tone
  drawTone(v) {
    const { ctx, w, h, dpr } = v, S = this.S;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const pad = 14 * dpr, cx = w / 2;
    const p = this.pitch, live = p && this.w - p.at < this.sr * 0.4, recent = p && this.w - p.at < this.sr * 3;
    // the base note: the pitch when there is one clear note, else the chord's root
    const big = Math.min(w * 0.22, h * 0.11);
    let y = pad + big;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `${12 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText('base note', cx, pad + 4 * dpr);
    y += 8 * dpr;
    if (recent) {
      const q = noteOf(p.f, S.a4), ct = Math.round(q.cents);
      ctx.font = `700 ${big}px ${FONT}`; ctx.fillStyle = live ? C.bright : C.text;
      ctx.fillText(`${q.name}${q.octave}`, cx, y);
      ctx.font = `600 ${15 * dpr}px ${MONO}`; ctx.fillStyle = C.cyan;
      ctx.fillText(`${fmtHz(p.f)}  ${ct > 0 ? '+' : ct < 0 ? '−' : '±'}${Math.abs(ct)}¢  clarity ${(p.clarity * 100).toFixed(0)}%`, cx, y + 24 * dpr);
    } else if (this.chord && this.chord.score > 0.8) {
      ctx.font = `700 ${big}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(NOTE_NAMES[this.chord.root], cx, y);
      ctx.font = `${13 * dpr}px ${FONT}`; ctx.fillText('(root of the chord: no single clear note)', cx, y + 24 * dpr);
    } else { ctx.font = `700 ${big}px ${FONT}`; ctx.fillStyle = C.grid2; ctx.fillText('—', cx, y); }
    y += 46 * dpr;
    // chord and key
    const half = (w - 3 * pad) / 2;
    const box = (x, title, main, sub, conf) => {
      ctx.fillStyle = C.panel; ctx.fillRect(x, y, half, 62 * dpr);
      ctx.textAlign = 'left'; ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(title, x + 10 * dpr, y + 16 * dpr);
      ctx.font = `700 ${22 * dpr}px ${FONT}`; ctx.fillStyle = main ? C.bright : C.grid2; ctx.fillText(main || '—', x + 10 * dpr, y + 42 * dpr);
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(sub || '', x + 10 * dpr, y + 56 * dpr);
      ctx.fillStyle = C.cyan; ctx.fillRect(x, y + 60 * dpr, half * clamp(conf || 0, 0, 1), 2 * dpr);
    };
    const ch = this.chord, k = this.key;
    const chOk = ch && ch.score > 0.85;
    box(pad, 'chord', chOk ? NOTE_NAMES[ch.root] + ch.name : '', chOk ? `${ch.bass >= 0 && ch.bass !== ch.root ? `bass ${NOTE_NAMES[ch.bass]} · ` : ''}or ${ch.alt.join(' · ')}` : '', ch ? (ch.score - 0.8) / 0.18 : 0);
    box(2 * pad + half, 'key (last few seconds)', k && k.score > 0.5 ? `${NOTE_NAMES[k.root]} ${k.mode}` : '', k ? `fit ${(k.score * 100).toFixed(0)}% · lead ${(k.margin * 100).toFixed(0)}` : '', k ? k.margin * 4 : 0);
    y += 62 * dpr + 18 * dpr;
    // the 12-note profile
    const chH = Math.max(60 * dpr, h * 0.14), bw = (w - 2 * pad) / 12;
    const tones = chOk ? new Set(ch.tones) : new Set();
    const mx = Math.max(1e-6, ...this.chromaFast);
    ctx.font = `${11 * dpr}px ${FONT}`; ctx.textAlign = 'center';
    for (let i = 0; i < 12; i++) {
      const v2 = this.chromaFast[i] / mx, x = pad + i * bw, bh = v2 * (chH - 16 * dpr);
      ctx.fillStyle = C.panel; ctx.fillRect(x + 2 * dpr, y, bw - 4 * dpr, chH - 16 * dpr);
      ctx.fillStyle = tones.has(i) ? C.cyan : 'rgba(142,164,188,0.55)';
      ctx.fillRect(x + 2 * dpr, y + chH - 16 * dpr - bh, bw - 4 * dpr, bh);
      if (k && k.score > 0.5 && k.root === i) { ctx.strokeStyle = C.magenta; ctx.lineWidth = 2 * dpr; ctx.strokeRect(x + 2 * dpr, y, bw - 4 * dpr, chH - 16 * dpr); }
      ctx.fillStyle = tones.has(i) ? C.bright : C.text; ctx.fillText(NOTE_NAMES[i], x + bw / 2, y + chH - 2 * dpr);
    }
    y += chH + 30 * dpr;
    // harmonics of the base note
    const hh = Math.max(56 * dpr, h * 0.12), hw = (w - 2 * pad) / 16;
    ctx.textAlign = 'left'; ctx.fillStyle = C.text; ctx.font = `${11 * dpr}px ${FONT}`;
    ctx.fillText(`harmonics (dB, strongest = 0)${isFinite(this.centroid) ? ` · brightness ${fmtHz(this.centroid)}` : ''}`, pad, y - 4 * dpr);
    ctx.textAlign = 'center';
    for (let i = 0; i < 16; i++) {
      const x = pad + i * hw, val = recent ? clamp((this.harm[i] + 60) / 60, 0, 1) : 0, bh = val * (hh - 14 * dpr);
      ctx.fillStyle = C.panel; ctx.fillRect(x + 1.5 * dpr, y, hw - 3 * dpr, hh - 14 * dpr);
      ctx.fillStyle = i === 0 ? C.bright : i % 2 ? C.cyan : C.magenta;
      ctx.fillRect(x + 1.5 * dpr, y + hh - 14 * dpr - bh, hw - 3 * dpr, bh);
      ctx.fillStyle = C.text; ctx.font = `${9 * dpr}px ${FONT}`; ctx.fillText(String(i + 1), x + hw / 2, y + hh - 2 * dpr);
    }
    y += hh + 12 * dpr;
    // the pitch over time on a note grid
    const th = h - y - 22 * dpr;
    if (th > 50 * dpr) this.drawTrace(ctx, pad, y, w - 2 * pad, th, dpr, 'notes');
  }

  // --------------------------------------------------------------------------------- rhythm
  // A tall view (the page scrolls it): tempo with the candidate pulses to choose from, the time
  // signature, the polyrhythm reading with both grids on the onset strip and the cycle rings, the ways
  // to write it (a drawn staff for the chosen one, the subdivision grid, the counting), then the tempo
  // history, the repetition rate and the main frequencies.
  drawRhythm(v) {
    const { ctx, w, h, dpr } = v, S = this.S;
    if (!this.rh) this.setupRhythm();
    const R = this.rh;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const pad = 14 * dpr, cx = w / 2, gw = w - 2 * pad;
    const PR = R.polyRaw, main = PR && PR.main, shown = R.polyShown, NT = R.notation;
    // ---- tempo (tap the number for tap tempo; the chips choose the main pulse)
    const boxH = 128 * dpr;
    this.tapBox = { x: pad, y: pad, w: gw, h: boxH - 40 * dpr, dpr };
    ctx.fillStyle = C.panel; ctx.fillRect(pad, pad, gw, boxH);
    const flash = this.onsetFlash && now() - this.onsetFlash < 110;
    ctx.fillStyle = flash ? C.magenta : C.grid2; ctx.beginPath(); ctx.arc(pad + 18 * dpr, pad + 18 * dpr, 7 * dpr, 0, 2 * Math.PI); ctx.fill();
    ctx.textAlign = 'left'; ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText('onset', pad + 30 * dpr, pad + 22 * dpr);
    const bpmNow = main ? main.bpm : R.bpmSm, ok = isFinite(bpmNow) && (main || R.conf > 0.15);
    ctx.textAlign = 'center'; ctx.font = `700 ${56 * dpr}px ${FONT}`; ctx.fillStyle = ok ? C.bright : C.grid2;
    ctx.fillText(ok ? bpmNow.toFixed(1) : '—', cx, pad + 66 * dpr);
    ctx.font = `600 ${13 * dpr}px ${FONT}`; ctx.fillStyle = C.cyan;
    ctx.fillText(`BPM · main pulse${R.mainLock ? ' (chosen)' : ' (auto)'}${main ? ` · ${main.band === 'low' ? 'low' : main.band === 'mid' ? 'middle' : 'high'} register` : ''}`, cx, pad + 84 * dpr);
    ctx.textAlign = 'right'; ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
    ctx.fillText(`beat strength ${(R.conf * 100).toFixed(0)}%`, w - pad - 8 * dpr, pad + 22 * dpr);
    const tapBpm = this.tapBpm();
    if (tapBpm) ctx.fillText(`tap ${tapBpm.toFixed(1)}`, w - pad - 8 * dpr, pad + 40 * dpr);
    // the candidate pulses as chips
    this.chipBoxes = [];
    const cands = PR ? PR.cands : [];
    if (cands.length) {
      const cw = Math.min(74 * dpr, (gw - 16 * dpr) / cands.length - 6 * dpr), chY = pad + boxH - 36 * dpr, chH = 28 * dpr;
      let x = pad + 8 * dpr;
      ctx.font = `600 ${13 * dpr}px ${FONT}`; ctx.textAlign = 'center';
      for (const c of cands) {
        const on = main && Math.abs(Math.log(c.bpm / main.bpm)) < 0.04;
        ctx.fillStyle = on ? C.cyan : 'rgba(110,150,200,0.14)'; ctx.fillRect(x, chY, cw, chH);
        ctx.fillStyle = on ? '#001018' : C.bright; ctx.fillText(c.bpm.toFixed(0), x + cw / 2, chY + 19 * dpr);
        ctx.fillStyle = on ? 'rgba(0,16,24,0.5)' : C.grid2; ctx.fillRect(x, chY + chH - 3 * dpr, cw * clamp(c.score, 0, 1), 3 * dpr);
        this.chipBoxes.push({ bpm: c.bpm, x, y: chY, w: cw, h: chH, dpr });
        x += cw + 6 * dpr;
      }
      ctx.fillStyle = C.text; ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'left';
      ctx.fillText(R.mainLock ? 'tap again: auto' : 'tap = main pulse', x + 2 * dpr, chY + 18 * dpr);
    }
    let y = pad + boxH + 10 * dpr;
    // ---- time signature chips
    this.meterBoxes = [];
    const meters = ['auto', '2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8'];
    const mw = (gw - (meters.length - 1) * 4 * dpr) / meters.length, mh = 30 * dpr;
    ctx.font = `600 ${11.5 * dpr}px ${FONT}`; ctx.textAlign = 'center';
    meters.forEach((m, i) => {
      const x = pad + i * (mw + 4 * dpr), on = S.meter === m;
      ctx.fillStyle = on ? C.amber : C.panel; ctx.fillRect(x, y, mw, mh);
      ctx.fillStyle = on ? '#1a1200' : C.text;
      const label = m === 'auto' ? (PR && PR.meter ? `auto ${PR.meter.beats}` : 'auto') : m;
      ctx.fillText(label, x + mw / 2, y + 19 * dpr);
      this.meterBoxes.push({ meter: m, x, y, w: mw, h: mh, dpr });
    });
    y += mh + 14 * dpr;
    // ---- the reading
    const feel = PR && PR.subdiv ? ({ 2: 'straight eighths', 3: 'triplets (a swing or 12/8 feel)', 4: 'sixteenths', 5: 'quintuplets', 6: 'sextuplets', 7: 'septuplets', 8: 'thirty-seconds' })[PR.subdiv.s] : null;
    ctx.textAlign = 'left';
    if (shown) {
      const bandName = b => ({ low: 'low register', mid: 'middle register', high: 'high register', all: 'all registers' })[b];
      ctx.font = `700 ${22 * dpr}px ${FONT}`; ctx.fillStyle = C.bright;
      ctx.fillText(`${shown.p} against ${shown.q}`, pad, y + 20 * dpr);
      ctx.font = `600 ${13 * dpr}px ${MONO}`; ctx.fillStyle = C.magenta;
      ctx.fillText(`${shown.bpm2.toFixed(1)} against ${bpmNow.toFixed(1)}`, pad + 150 * dpr, y + 20 * dpr);
      ctx.font = `${11.5 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
      ctx.fillText(`second layer in the ${bandName(shown.band)} · ${(shown.score * 100).toFixed(0)}% sure · cycle ${shown.q} beats = ${(60 / bpmNow * shown.q).toFixed(2)} s${feel ? ` · also ${feel}` : ''}`, pad, y + 38 * dpr);
    } else {
      ctx.font = `700 ${18 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
      ctx.fillText(ok ? 'no polyrhythm heard' : 'listening for a pulse…', pad, y + 20 * dpr);
      ctx.font = `${11.5 * dpr}px ${FONT}`;
      ctx.fillText(ok ? (feel ? `one pulse with ${feel}` : 'one pulse, no clear subdivision') + (PR && PR.meter ? ` · accent every ${PR.meter.beats} beats` : '') : 'give it a few bars', pad, y + 38 * dpr);
    }
    y += 48 * dpr;
    // ---- the onset strip with both grids and the bar lines
    const sh = 96 * dpr, frames = Math.min(R.E, Math.round(R.fr * 8));
    ctx.fillStyle = C.panel; ctx.fillRect(pad, y, gw, sh);
    let mx = 1e-6;
    for (let i = 0; i < frames; i++) mx = Math.max(mx, R.env[(R.ei - frames + i + R.E) % R.E]);
    const X = f => pad + gw * (1 - (R.frames - f) / frames);
    const A = R.polyAbs;
    if (A) {
      const first = R.frames - frames;
      // bars (brighter), main beats (cyan), the second layer (magenta)
      const bar = R.barFrames, P = A.P;
      ctx.fillStyle = 'rgba(62,232,255,0.22)';
      for (let f = A.gridStart; f < R.frames; f += P) if (f > first) ctx.fillRect(X(f), y, Math.max(1, dpr), sh);
      if (bar) { ctx.fillStyle = 'rgba(230,243,255,0.55)'; for (let f = bar.start; f < R.frames; f += bar.len) if (f > first) ctx.fillRect(X(f) - dpr * 0.5, y, 2 * dpr, sh); for (let f = bar.start - bar.len; f > first; f -= bar.len) ctx.fillRect(X(f) - dpr * 0.5, y, 2 * dpr, sh); }
      if (shown) {
        const P2 = A.cycle / shown.p;
        ctx.fillStyle = 'rgba(255,62,200,0.5)';
        for (let f = A.cycleStart; f < R.frames; f += P2) if (f > first) ctx.fillRect(X(f), y + sh * 0.5, Math.max(1, dpr), sh * 0.5);
        for (let f = A.cycleStart - P2; f > first; f -= P2) ctx.fillRect(X(f), y + sh * 0.5, Math.max(1, dpr), sh * 0.5);
      }
    }
    ctx.beginPath();
    for (let i = 0; i < frames; i++) {
      const val = R.env[(R.ei - frames + i + R.E) % R.E] / mx, x = pad + gw * i / (frames - 1), yy = y + sh - val * (sh - 4 * dpr);
      if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
    }
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.3 * dpr; ctx.stroke();
    for (const o of R.onsets) if (o.f > R.frames - frames) { ctx.fillStyle = BAND_COL[o.band]; ctx.fillRect(X(o.f) - dpr, y, 2 * dpr, 6 * dpr); }
    ctx.font = `${10 * dpr}px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = C.text;
    ctx.fillText('onsets · last 8 s · │ main beats  │ bars' + (shown ? '  │ second layer (lower half)' : ''), pad + 4 * dpr, y + 13 * dpr);
    y += sh + 12 * dpr;
    // ---- the orbit: the cycle as a wheel, live
    if (A) {
      const size = Math.min(gw, 300 * dpr);
      this.drawOrbit(ctx, cx - size / 2, y, size, dpr, R, shown, A, bpmNow, PR);
      y += size + 8 * dpr;
      if (shown && NT) { // counting, the second layer's syllables lit
        ctx.textAlign = 'left'; ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
        ctx.fillText(`count ${shown.p} per beat · [second layer]${NT.mnemonic ? `  ·  “${NT.mnemonic}”` : ''}`, pad, y + 12 * dpr);
        ctx.font = `600 ${15 * dpr}px ${MONO}`;
        let x = pad, yy = y + 36 * dpr;
        for (const c of NT.counting) {
          const t = c.text || '·', ww = ctx.measureText(t).width + 9 * dpr;
          if (x + ww > w - pad) { x = pad; yy += 24 * dpr; }
          if (c.second) { ctx.fillStyle = 'rgba(255,62,200,0.25)'; ctx.fillRect(x - 2 * dpr, yy - 14 * dpr, ww - 4 * dpr, 19 * dpr); }
          ctx.fillStyle = c.second ? C.magenta : c.main ? C.bright : C.text; ctx.fillText(t, x, yy);
          x += ww;
        }
        y = yy + 16 * dpr;
      }
    }
    // ---- notation
    this.sugBoxes = [];
    if (NT) {
      ctx.textAlign = 'left'; ctx.font = `600 ${12 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText('ways to write it (tap one to see it)', pad, y + 12 * dpr);
      y += 18 * dpr;
      NT.suggestions.forEach((s, i) => {
        const on = i === (R.sugSel || 0), rh = 36 * dpr;
        ctx.fillStyle = on ? 'rgba(255,176,32,0.14)' : C.panel; ctx.fillRect(pad, y, gw, rh);
        if (on) { ctx.strokeStyle = C.amber; ctx.lineWidth = dpr; ctx.strokeRect(pad + 0.5, y + 0.5, gw - 1, rh - 1); }
        ctx.font = `600 ${12.5 * dpr}px ${FONT}`; ctx.fillStyle = on ? C.bright : C.text;
        ctx.fillText(`${i + 1}. ${s.title}`, pad + 8 * dpr, y + 15 * dpr);
        ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
        ctx.fillText(this.ellipsis(ctx, s.why, gw - 70 * dpr), pad + 8 * dpr, y + 29 * dpr);
        ctx.textAlign = 'right'; ctx.fillStyle = C.amber; ctx.fillText(`fit ${(s.fit * 100).toFixed(0)}%`, w - pad - 6 * dpr, y + 15 * dpr); ctx.textAlign = 'left';
        this.sugBoxes.push({ i, x: pad, y, w: gw, h: rh, dpr });
        y += rh + 4 * dpr;
      });
      const sel = NT.suggestions[R.sugSel || 0] || NT.suggestions[0];
      y += 6 * dpr;
      y = this.drawStaff(ctx, pad, y, gw, dpr, sel.staff, bpmNow);
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.textAlign = 'left';
      ctx.fillText(sel.why, pad, y + 4 * dpr, gw);
      y += 14 * dpr;
      // the subdivision grid
      ctx.font = `600 ${12 * dpr}px ${MONO}`;
      const rows = [['main  ', NT.grid.main, C.cyan], ['second', NT.grid.second, C.magenta]];
      for (const [name, row, col] of rows) {
        y += 16 * dpr;
        ctx.fillStyle = C.text; ctx.fillText(name, pad, y);
        const cellW = Math.min(16 * dpr, (gw - 60 * dpr) / row.length);
        row.forEach((hit, u) => { ctx.fillStyle = hit ? col : C.grid2; ctx.beginPath(); ctx.arc(pad + 62 * dpr + u * cellW + cellW / 2, y - 4 * dpr, (hit ? 4.5 : 2) * dpr, 0, 2 * Math.PI); ctx.fill(); });
      }
      y += 22 * dpr;
    }
    // ---- tempo over the last 30 s
    const th = 54 * dpr;
    ctx.fillStyle = C.panel; ctx.fillRect(pad, y, gw, th);
    const lo = 40, hi = 240, TY = b => y + th * (1 - Math.log(b / lo) / Math.log(hi / lo));
    ctx.font = `${9 * dpr}px ${FONT}`; ctx.textAlign = 'left';
    for (const b of [60, 90, 120, 180]) { ctx.fillStyle = C.grid; ctx.fillRect(pad, TY(b), gw, 1); ctx.fillStyle = C.text; ctx.fillText(String(b), pad + 3 * dpr, TY(b) - 2 * dpr); }
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < R.hist.length; i++) {
      const b = R.hist[(R.hi + i) % R.hist.length];
      if (!isFinite(b)) { pen = false; continue; }
      const x = pad + gw * i / (R.hist.length - 1), yy = TY(clamp(b, lo, hi));
      if (pen) ctx.lineTo(x, yy); else { ctx.moveTo(x, yy); pen = true; }
    }
    ctx.strokeStyle = C.amber; ctx.lineWidth = 1.6 * dpr; ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.fillText('tempo · last 30 s', w - pad - 4 * dpr, y + 11 * dpr);
    y += th + 18 * dpr;
    // ---- repetition rate: the spectrum of the loudness envelope, 0.5–40 Hz
    const mh2 = 80 * dpr;
    ctx.fillStyle = C.panel; ctx.fillRect(pad, y, gw, mh2);
    const MX = f => pad + gw * Math.log(f / 0.5) / Math.log(80);
    ctx.font = `${9 * dpr}px ${FONT}`; ctx.textAlign = 'center';
    for (const f of [0.5, 1, 2, 5, 10, 20, 40]) { ctx.fillStyle = C.grid; ctx.fillRect(MX(f), y, 1, mh2); ctx.fillStyle = C.text; ctx.fillText(`${f}`, MX(f), y + mh2 + 11 * dpr); }
    const M = R.mod;
    if (M) {
      let pm = 0;
      for (let k = M.k0; k <= M.k1; k++) pm = Math.max(pm, R.modPow[k]);
      ctx.beginPath();
      for (let k = M.k0; k <= M.k1; k++) { const x = MX(k * M.df), yy = y + mh2 - (mh2 - 4 * dpr) * Math.sqrt(R.modPow[k] / pm); if (k === M.k0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.strokeStyle = C.green; ctx.lineWidth = 1.4 * dpr; ctx.stroke();
      ctx.fillStyle = C.bright; ctx.beginPath(); ctx.arc(MX(M.f), y + 6 * dpr, 4 * dpr, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.textAlign = 'left'; ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText('repetition rate (Hz) of the loudness', pad + 4 * dpr, y + 13 * dpr);
    y += mh2 + 34 * dpr;
    ctx.font = `600 ${14 * dpr}px ${MONO}`; ctx.fillStyle = M && M.share > 0.04 ? C.green : C.text;
    ctx.fillText(M && M.share > 0.04 ? `repeats ${M.f.toFixed(2)} Hz · ${(M.f * 60).toFixed(0)} per minute` : 'no clear repetition', pad, y - 8 * dpr);
    // ---- main frequencies
    y += 10 * dpr;
    ctx.font = `${11 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText('main frequencies (2 s average)', pad, y);
    y += 6 * dpr;
    const rowH = 22 * dpr;
    R.peaks.slice(0, Math.max(0, Math.floor((h - y - 8 * dpr) / rowH))).forEach((p, i) => {
      const q = noteOf(p.f, S.a4), ct = Math.round(q.cents), yy = y + (i + 1) * rowH;
      ctx.fillStyle = i === 0 ? C.bright : C.text; ctx.font = `600 ${14 * dpr}px ${MONO}`; ctx.textAlign = 'left';
      ctx.fillText(fmtHz(p.f).padStart(10), pad, yy);
      ctx.fillStyle = C.cyan; ctx.fillText(`${q.name}${q.octave} ${ct > 0 ? '+' : ct < 0 ? '−' : '±'}${Math.abs(ct)}¢`, pad + 130 * dpr, yy);
      ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.fillText(`${p.db.toFixed(0)} dB`, w - pad, yy);
    });
  }
  // The orbit. One turn = one cycle of the polyrhythm (or one bar, or one beat). Rings from the
  // outside in: the heard onsets as sparks at their moment in the cycle (amber low, green middle, white
  // high; they fade over three cycles), the main beats (cyan nodes joined into a polygon), the second
  // layer (magenta nodes, its own polygon), the subdivision as faint ticks, the bars as spokes. A hand
  // sweeps the cycle; a node flashes as the hand passes it, and a ripple spreads from each spark as it
  // lands. The centre names what is heard.
  drawOrbit(ctx, x0, y0, size, dpr, R, shown, A, bpm, PR) {
    const cx = x0 + size / 2, cy = y0 + size / 2, rOut = size * 0.46, t = now();
    const cycle = A.cycle, start = A.cycleStart, P = A.P;
    const posOf = f => ((((f - start) % cycle) + cycle) % cycle) / cycle;
    const pos = posOf(R.frames), ang = u => -Math.PI / 2 + 2 * Math.PI * u;
    const q = shown ? shown.q : Math.max(1, Math.round(cycle / P)), p = shown ? shown.p : 0;
    const bar = R.barFrames, bars = bar ? Math.max(1, Math.round(cycle / bar.len)) : 0;
    // background: a glow that breathes with the beat
    const beatPhase = ((((R.frames - A.gridStart) % P) + P) % P) / P;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rOut * 1.1);
    glow.addColorStop(0, `rgba(62,232,255,${0.16 * Math.exp(-beatPhase * 4)})`); glow.addColorStop(1, 'rgba(62,232,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(x0, y0, size, size);
    // the cycle ring and the subdivision ticks
    ctx.strokeStyle = C.grid2; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(cx, cy, rOut, 0, 2 * Math.PI); ctx.stroke();
    const sub = PR && PR.subdiv ? PR.subdiv.s : 0, units = shown ? p * q : (sub ? sub * q : q);
    for (let u = 0; u < units; u++) {
      const a = ang(u / units), big = shown ? (u % p === 0 || u % q === 0) : (u % Math.max(1, sub) === 0);
      ctx.strokeStyle = big ? C.grid2 : C.grid; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (rOut - (big ? 7 : 4) * dpr), cy + Math.sin(a) * (rOut - (big ? 7 : 4) * dpr)); ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut); ctx.stroke();
    }
    // bar spokes
    if (bars > 0 && bar) {
      const barPos = posOf(bar.start);
      for (let k = 0; k < bars; k++) {
        const a = ang(barPos + k / bars);
        ctx.strokeStyle = 'rgba(230,243,255,0.35)'; ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rOut * 0.35, cy + Math.sin(a) * rOut * 0.35); ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut); ctx.stroke();
      }
    }
    // the layers: polygons and nodes
    const layer = (nn, r, col, phaseOff) => {
      if (nn < 2) return;
      ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2 * dpr; ctx.beginPath();
      for (let k = 0; k <= nn; k++) { const a = ang(phaseOff + k / nn); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      for (let k = 0; k < nn; k++) {
        const u = phaseOff + k / nn, a = ang(u), d = ((pos - u) % 1 + 1) % 1, lit = d < 0.08, rr = (lit ? 7.5 - d * 30 : 5) * dpr;
        ctx.fillStyle = col; ctx.globalAlpha = lit ? 1 : 0.75;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rr, 0, 2 * Math.PI); ctx.fill();
        if (lit) { ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.globalAlpha = 0.5 * (1 - d / 0.08); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, (8 + d * 220) * dpr, 0, 2 * Math.PI); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    };
    const mainPhase = posOf(A.gridStart);
    layer(q, rOut * 0.78, C.cyan, mainPhase);
    if (shown) layer(p, rOut * 0.5, C.magenta, posOf(start));
    // the heard onsets: sparks on the outer ring, fading over three cycles; a ripple when they land
    for (const o of R.onsets) {
      const age = (R.frames - o.f) / cycle;
      if (age > 3) continue;
      const a = ang(posOf(o.f)), col = BAND_COL[o.band], r = rOut * (o.band === 'low' ? 0.93 : o.band === 'mid' ? 0.98 : 1.03);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, al = Math.max(0, 1 - age / 3);
      ctx.fillStyle = col; ctx.globalAlpha = 0.25 + 0.75 * al;
      ctx.beginPath(); ctx.arc(x, y, (2.2 + 3.5 * al) * dpr, 0, 2 * Math.PI); ctx.fill();
      if (o.ripple) { if (!o.t0) o.t0 = t; const u = (t - o.t0) / 450; if (u < 1) { ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.globalAlpha = 0.7 * (1 - u); ctx.beginPath(); ctx.arc(x, y, (4 + 26 * u) * dpr, 0, 2 * Math.PI); ctx.stroke(); } else o.ripple = false; }
      ctx.globalAlpha = 1;
    }
    // the hand
    const a = ang(pos);
    ctx.strokeStyle = C.bright; ctx.lineWidth = 2 * dpr; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rOut * 0.9, cy + Math.sin(a) * rOut * 0.9); ctx.stroke();
    ctx.fillStyle = C.bright; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rOut * 0.9, cy + Math.sin(a) * rOut * 0.9, 3.5 * dpr, 0, 2 * Math.PI); ctx.fill();
    ctx.lineCap = 'butt';
    // the centre
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(cx, cy, rOut * 0.3, 0, 2 * Math.PI); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (shown) {
      ctx.font = `700 ${30 * dpr}px ${FONT}`; ctx.fillStyle = C.bright; ctx.fillText(`${p}:${q}`, cx, cy + 8 * dpr);
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(`${shown.bpm2.toFixed(0)} · ${bpm.toFixed(0)}`, cx, cy + 22 * dpr);
    } else {
      ctx.font = `700 ${22 * dpr}px ${FONT}`; ctx.fillStyle = C.bright; ctx.fillText(isFinite(bpm) ? bpm.toFixed(0) : '—', cx, cy + 6 * dpr);
      ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(q > 1 ? `bar of ${q}` : 'beat', cx, cy + 20 * dpr);
    }
    // legend
    ctx.font = `${9 * dpr}px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = C.text;
    const leg = [[C.cyan, 'main'], ...(shown ? [[C.magenta, 'second']] : []), [BAND_COL.low, 'low'], [BAND_COL.mid, 'mid'], [BAND_COL.high, 'high']];
    let lx = x0 + 4 * dpr;
    for (const [col, name] of leg) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx + 4 * dpr, y0 + size - 8 * dpr, 3 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = C.text; ctx.fillText(name, lx + 11 * dpr, y0 + size - 5 * dpr); lx += ctx.measureText(name).width + 22 * dpr; }
    ctx.textAlign = 'right'; ctx.fillText('sparks = what the microphone heard', x0 + size - 4 * dpr, y0 + 12 * dpr);
  }
  ellipsis(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -4);
    return s.trim() + '…';
  }
  // one bar of a written rhythm: a one-line staff per layer, notes at their real positions, with
  // stems, flags, dots, ties and tuplet brackets; the time signature at the left
  drawStaff(ctx, x0, y0, w, dpr, staff, bpm) {
    const layers = staff.layers, lineGap = 60 * dpr, left = 44 * dpr, right = 10 * dpr;
    const sx = x0 + left, sw = w - left - right, X = t => sx + sw * t / staff.barBeats;
    const cols = [C.cyan, C.magenta];
    ctx.fillStyle = C.panel; ctx.fillRect(x0, y0, w, lineGap * layers.length + 8 * dpr);
    layers.forEach((L, li) => {
      const ly = y0 + 38 * dpr + li * lineGap, col = cols[li];
      ctx.strokeStyle = C.grid2; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(sx, ly); ctx.lineTo(sx + sw, ly); ctx.stroke();
      // time signature and bar lines
      const sig = li === 1 && staff.sig2 ? staff.sig2 : staff.sig;
      ctx.fillStyle = C.bright; ctx.font = `700 ${13 * dpr}px ${MONO}`; ctx.textAlign = 'center';
      ctx.fillText(String(sig[0]), x0 + 14 * dpr, ly - 3 * dpr); ctx.fillText(String(sig[1]), x0 + 14 * dpr, ly + 11 * dpr);
      ctx.font = `${9 * dpr}px ${FONT}`; ctx.fillStyle = col; ctx.fillText(L.name, x0 + 14 * dpr, ly + 24 * dpr);
      ctx.strokeStyle = C.text; ctx.lineWidth = 1.2 * dpr;
      for (const b of [...staff.bars, staff.barBeats]) { const xb = X(b); ctx.beginPath(); ctx.moveTo(xb, ly - 12 * dpr); ctx.lineTo(xb, ly + 12 * dpr); ctx.stroke(); }
      // notes
      const heads = [];
      L.notes.forEach((n, i) => {
        const x = X(n.t), hollow = n.value >= 2, whole = n.value >= 4;
        ctx.save(); ctx.translate(x, ly); ctx.rotate(-0.35);
        ctx.beginPath(); ctx.ellipse(0, 0, 4.6 * dpr, 3.3 * dpr, 0, 0, 2 * Math.PI);
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.4 * dpr;
        if (hollow) ctx.stroke(); else ctx.fill();
        ctx.restore();
        if (!whole) {
          const stemX = x + 4 * dpr, top = ly - 21 * dpr;
          ctx.strokeStyle = col; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.moveTo(stemX, ly - 1); ctx.lineTo(stemX, top); ctx.stroke();
          const flags = n.value <= 0.5 ? (n.value <= 0.125 ? 3 : n.value <= 0.25 ? 2 : 1) : 0;
          for (let f = 0; f < flags; f++) { ctx.beginPath(); ctx.moveTo(stemX, top + f * 4.5 * dpr); ctx.quadraticCurveTo(stemX + 7 * dpr, top + 3 * dpr + f * 4.5 * dpr, stemX + 4 * dpr, top + 11 * dpr + f * 4.5 * dpr); ctx.stroke(); }
        }
        for (let d = 0; d < (n.dots || 0); d++) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + (8 + d * 4) * dpr, ly - 2 * dpr, 1.4 * dpr, 0, 2 * Math.PI); ctx.fill(); }
        heads.push({ x, tie: n.tie });
        if (i > 0 && L.notes[i - 1].tie) { // a tie from the previous note
          const xa = heads[i - 1].x + 5 * dpr, xb = x - 5 * dpr;
          ctx.strokeStyle = col; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.moveTo(xa, ly + 5 * dpr); ctx.quadraticCurveTo((xa + xb) / 2, ly + 12 * dpr, xb, ly + 5 * dpr); ctx.stroke();
        }
      });
      for (const tp of L.tuplets || []) {
        const xa = heads[tp.from].x - 4 * dpr, xb = heads[tp.to].x + 8 * dpr, ty = ly - 30 * dpr;
        ctx.strokeStyle = col; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(xa, ty + 5 * dpr); ctx.lineTo(xa, ty); ctx.lineTo(xb, ty); ctx.lineTo(xb, ty + 5 * dpr); ctx.stroke();
        ctx.fillStyle = C.panel; const lw = ctx.measureText(tp.label).width + 6 * dpr; ctx.fillRect((xa + xb) / 2 - lw / 2, ty - 6 * dpr, lw, 11 * dpr);
        ctx.fillStyle = col; ctx.font = `italic 600 ${10 * dpr}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(tp.label, (xa + xb) / 2, ty + 3 * dpr);
      }
    });
    ctx.textAlign = 'right'; ctx.font = `${9 * dpr}px ${FONT}`; ctx.fillStyle = C.text;
    ctx.fillText(`♩ = ${Math.round(bpm)} · one bar · notes at their real timing`, x0 + w - 6 * dpr, y0 + 12 * dpr);
    return y0 + lineGap * layers.length + 12 * dpr;
  }
  tapBpm() {
    const R = this.rh, t = R && R.taps;
    if (!t || t.length < 3 || now() - t[t.length - 1] > 4000) return null;
    const iv = [];
    for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
    return 60000 / (iv.reduce((a, b) => a + b, 0) / iv.length);
  }

  // ---------------------------------------------------------------------------------- stats (tests, status)
  stats() {
    const pk = this.specFresh !== undefined && this.fftN ? this.specPeak() : null;
    return {
      sr: this.sr, samples: this.w, load: this.load,
      level: { Z: this.level('Z', 'fast', true), A: this.level('A', 'fast', true), C: this.level('C', 'fast', true), Zslow: this.level('Z', 'slow', true) },
      peakDb: 20 * Math.log10(this.peakMax + 1e-12), specPeak: pk, rows: this.rowCount, scopeFreq: this.scopeFreq, view: this.S.view,
      pitch: this.pitch, target: this.target, cents: this.centsSm, lock: this.lockString,
      tuner: this.S.view === 'tuner' ? { advice: this.advice(this.centsSm, !!(this.pitch && this.w - this.pitch.at < this.sr * 0.35 && this.settledAt), this.tuning()).text, next: this.nextString(this.tuning()), strings: this.strStatus.map(x => x && Math.round(x.cents * 10) / 10), learn: this.learn ? this.learn.notes.map(midiName) : null,
        learnBtns: (this.learnBtns || []).map(b => ({ id: b.id, x: (b.x + b.w / 2) / b.dpr, y: (b.y + b.h / 2) / b.dpr })), cells: (this.tunerCells || []).map(b => ({ x: (b.x + b.w / 2) / b.dpr, y: (b.y + b.h / 2) / b.dpr })), noteBox: this.noteBox && { x: (this.noteBox.x + this.noteBox.w / 2) / this.noteBox.dpr, y: (this.noteBox.y + this.noteBox.h / 2) / this.noteBox.dpr } } : null,
      chord: this.chord ? NOTE_NAMES[this.chord.root] + this.chord.name : null, chordFull: this.chord ? this.chord.full : null, chordAlt: this.chord ? this.chord.alt : null, key: this.key ? `${NOTE_NAMES[this.key.root]} ${this.key.mode}` : null,
      harmonics: Array.from(this.harm), centroid: this.centroid,
      rhythm: this.rh ? { bpm: this.rh.bpmSm, raw: this.rh.bpm, conf: this.rh.conf, onsets: this.rh.onsets.length, mod: this.rh.mod && { f: this.rh.mod.f, share: this.rh.mod.share }, peaks: this.rh.peaks.slice(0, 6), tap: this.tapBpm(),
        main: this.rh.polyRaw && this.rh.polyRaw.main ? { bpm: this.rh.polyRaw.main.bpm, band: this.rh.polyRaw.main.band, locked: !!this.rh.mainLock } : null,
        cands: this.rh.polyRaw ? this.rh.polyRaw.cands.map(c => ({ bpm: c.bpm, score: c.score })) : [],
        poly: this.rh.polyShown, polyRaw: this.rh.polyRaw && this.rh.polyRaw.poly, subdiv: this.rh.polyRaw && this.rh.polyRaw.subdiv && this.rh.polyRaw.subdiv.s, meter: this.rh.polyRaw && this.rh.polyRaw.meter,
        notation: this.rh.notation && { suggestions: this.rh.notation.suggestions.map(x => ({ id: x.id, title: x.title, fit: x.fit })), text: this.rh.notation.text, mnemonic: this.rh.notation.mnemonic },
        chips: (this.chipBoxes || []).map(b => ({ bpm: b.bpm, x: (b.x + b.w / 2) / b.dpr, y: (b.y + b.h / 2) / b.dpr })), meterChips: (this.meterBoxes || []).map(b => ({ meter: b.meter, x: (b.x + b.w / 2) / b.dpr, y: (b.y + b.h / 2) / b.dpr })), sugBoxes: (this.sugBoxes || []).map(b => ({ i: b.i, x: (b.x + b.w / 2) / b.dpr, y: (b.y + b.h / 2) / b.dpr })) } : null,
      weighting: { A: [100, 1000, 10000].map(f => 20 * Math.log10(this.wA.response(f, this.sr))), C: [100, 1000, 10000].map(f => 20 * Math.log10(this.wC.response(f, this.sr))) },
    };
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const CHORD_IV = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 5: [0, 7] };
function estimateChordTones(ch) { return (CHORD_IV[ch.name] || [0]).map(d => (ch.root + d) % 12); }
