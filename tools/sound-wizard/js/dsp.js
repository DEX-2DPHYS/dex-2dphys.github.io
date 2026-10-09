// Sound Wizard: signal-processing building blocks. No DOM: used by the analysis worker and, where a
// phone cannot draw from a worker, by the page itself.

// ------------------------------------------------------------------------------------------- FFT
// Real FFT of n points (a power of two) as an n/2-point complex FFT of the even/odd samples packed
// as re/im, then split. Tables are built once per size; power() allocates nothing.
export class RealFFT {
  constructor(n) {
    const m = n >> 1;
    this.n = n; this.m = m;
    this.re = new Float64Array(m); this.im = new Float64Array(m);
    const bits = Math.round(Math.log2(m));
    this.rev = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
    this.cm = new Float64Array(m / 2); this.sm = new Float64Array(m / 2);
    for (let k = 0; k < m / 2; k++) { this.cm[k] = Math.cos(2 * Math.PI * k / m); this.sm[k] = -Math.sin(2 * Math.PI * k / m); }
    this.cn = new Float64Array(m + 1); this.sn = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) { this.cn[k] = Math.cos(2 * Math.PI * k / n); this.sn[k] = -Math.sin(2 * Math.PI * k / n); }
  }
  // x: n samples (already windowed). out: n/2 + 1 values of |X[k]|².
  power(x, out) { this.run(x, out, false); }
  // the real part of X[k], k = 0 … n/2 (for an even input, such as a power spectrum, X is real: this
  // is how the pitch tracker turns a power spectrum back into an autocorrelation)
  realPart(x, out) { this.run(x, out, true); }
  run(x, out, realOnly) {
    const { m, re, im, rev, cm, sm } = this;
    for (let i = 0; i < m; i++) { const j = rev[i]; re[j] = x[2 * i]; im[j] = x[2 * i + 1]; }
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1, step = m / size;
      for (let start = 0; start < m; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const c = cm[t], s = sm[t], a = start + k, b = a + half;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    const { cn, sn } = this;
    for (let k = 0; k <= m; k++) {
      const k1 = k === m ? 0 : k, k2 = k === 0 ? 0 : m - k;
      const zr = re[k1], zi = im[k1], wr = re[k2], wi = -im[k2];
      const er = (zr + wr) * 0.5, ei = (zi + wi) * 0.5;
      const or = (zi - wi) * 0.5, oi = -(zr - wr) * 0.5;
      const c = cn[k], s = sn[k];
      const xr = er + or * c - oi * s, xi = ei + or * s + oi * c;
      out[k] = realOnly ? xr : xr * xr + xi * xi;
    }
  }
}

// ------------------------------------------------------------------------------- pitch (MPM)
// McLeod pitch method: the normalised square difference function n(τ) = 2r(τ)/m(τ), with the
// autocorrelation r from an FFT of the zero-padded window (two FFTs of 2W instead of W² products) and
// m from running sums. The first "key maximum" within 90 % of the highest is the period: this picks the
// fundamental, not a strong second harmonic, and does not jump octaves. Parabolic interpolation gives
// the period to a fraction of a sample (well under a cent for the guitar's range).
export class PitchMPM {
  constructor(W) {
    this.W = W;
    this.fft = new RealFFT(2 * W);
    this.x = new Float64Array(W);
    this.buf = new Float64Array(2 * W);
    this.pow = new Float32Array(W + 1);
    this.pfull = new Float64Array(2 * W);
    this.r = new Float64Array(W + 1);
    this.sq = new Float64Array(W + 1);
    this.nsdf = new Float64Array(W + 1);
  }
  detect(ring, mask, end, sr, fmin, fmax) {
    const W = this.W, x = this.x;
    let mean = 0;
    for (let i = 0; i < W; i++) { x[i] = ring[(end - W + i) & mask]; mean += x[i]; }
    mean /= W;
    let e = 0;
    for (let i = 0; i < W; i++) { x[i] -= mean; e += x[i] * x[i]; }
    const rms = Math.sqrt(e / W);
    if (rms < 1e-5) return { f: NaN, clarity: 0, rms };
    const buf = this.buf;
    buf.fill(0, W); buf.set(x);
    this.fft.power(buf, this.pow);
    const P = this.pfull, N = 2 * W;
    for (let k = 0; k <= W; k++) P[k] = this.pow[k];
    for (let k = 1; k < W; k++) P[N - k] = this.pow[k];
    this.fft.realPart(P, this.r);
    const sq = this.sq;
    sq[0] = 0;
    for (let i = 0; i < W; i++) sq[i + 1] = sq[i] + x[i] * x[i];
    const tmin = Math.max(2, Math.floor(sr / fmax)), tmax = Math.min(W >> 1, Math.ceil(sr / fmin));
    const n = this.nsdf;
    for (let t = 0; t <= tmax + 1; t++) {
      const m = sq[W - t] + (sq[W] - sq[t]);
      n[t] = m > 0 ? 2 * (this.r[t] / N) / m : 0;
    }
    // key maxima: the highest point of each positive region after the first dip below zero
    let seenNeg = false, inPos = false, curT = -1, curV = -1, best = 0;
    const keys = [];
    for (let t = 1; t <= tmax; t++) {
      const v = n[t];
      if (!seenNeg) { if (v < 0) seenNeg = true; continue; }
      if (v > 0) {
        if (!inPos) { inPos = true; curV = -1; }
        if (v > curV) { curV = v; curT = t; }
      } else if (inPos) {
        inPos = false;
        if (curT >= tmin) { keys.push(curT); if (curV > best) best = curV; }
      }
    }
    if (inPos && curT >= tmin && curT < tmax) { keys.push(curT); if (curV > best) best = curV; }
    if (!keys.length) return { f: NaN, clarity: 0, rms };
    const thr = 0.9 * best;
    const t = keys.find(k => n[k] >= thr);
    const a = n[t - 1], b = n[t], c = n[t + 1], d = a - 2 * b + c;
    // the refinement is only valid within half a sample of the maximum; a near-flat top would send it anywhere
    const dt = d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0;
    return { f: sr / (t + dt), clarity: Math.max(0, Math.min(1, b - 0.25 * (a - c) * dt)), rms };
  }
}

// ------------------------------------------------------------------- chroma, key and chord
// 12-note profile from the peaks of a power spectrum (each peak's amplitude added to its pitch class)
export function chromaFromSpectrum(pow, df, a4, out, fmin = 55, fmax = 5000) {
  out.fill(0);
  const k0 = Math.max(2, Math.floor(fmin / df)), k1 = Math.min(pow.length - 2, Math.ceil(fmax / df));
  let mx = 0;
  for (let k = k0; k <= k1; k++) if (pow[k] > mx) mx = pow[k];
  const floor = mx * 1e-5; // 50 dB below the strongest peak
  let tot = 0;
  for (let k = k0; k <= k1; k++) {
    const p = pow[k];
    if (p < floor || p < pow[k - 1] || p < pow[k + 1]) continue;
    const q = peakInterp(pow, k), f = q.k * df;
    const pc = ((Math.round(12 * Math.log2(f / a4)) % 12) + 12 + 9) % 12; // 0 = C
    const amp = Math.sqrt(p);
    out[pc] += amp; tot += amp;
  }
  if (tot > 0) for (let i = 0; i < 12; i++) out[i] /= tot;
  return tot;
}
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function pearson(a, b, rot) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[(i + rot) % 12] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
// Krumhansl–Kessler key profiles: the best of 24 keys, and how clearly it beats the runner-up
export function estimateKey(chroma) {
  const res = [];
  for (let r = 0; r < 12; r++) { res.push({ root: r, mode: 'major', score: pearson(chroma, KK_MAJOR, r) }); res.push({ root: r, mode: 'minor', score: pearson(chroma, KK_MINOR, r) }); }
  res.sort((a, b) => b.score - a.score);
  return { ...res[0], margin: res[0].score - res[1].score };
}
// ------------------------------------------------------------------- chords, overtone-aware
// A real strummed chord is not three pure notes: each string brings its overtones (the 3rd is a fifth
// up, the 5th a major third, the 7th a flat seventh), and on a thin unplugged string or a phone mic the
// overtones can outweigh the fundamentals. So (1) the spectrum is levelled (each peak measured against
// its surroundings, a third of an octave wide, so weak low strings still count), (2) the chord patterns
// compared with include the overtones each chord tone brings, and (3) everything since the last strum is
// gathered (the start of a new strum clears it), instead of judging the latest 85 ms.
const OVERTONE_PC = [0, 0, 7, 0, 4, 7, 10, 0]; // pitch class of harmonics 1–8 relative to the note
export const CHORD_TYPES = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['5', [0, 7]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]]];
export class ChordListener {
  constructor(sr, N, a4 = 440, opts = {}) {
    this.df = sr / N; this.a4 = a4;
    // tuned on strummed Karplus–Strong chords coloured like an unplugged electric at a phone (tests/chord-search.mjs)
    this.s = opts.s ?? 0.8;              // how slowly the overtones fade in the patterns
    this.fmax = opts.fmax ?? 800;        // peaks above this are mostly high overtones: left out
    this.weight = opts.weight ?? 'log';  // a peak counts by the log of how far it stands out
    this.hmax = opts.hmax ?? 4;          // overtones modelled per chord tone
    this.bassAcc = new Float64Array(12);
    this.leak = opts.leak ?? 0.97;       // older frames fade (~3 s): chords played without new strums still change
    this.acc = new Float64Array(12); this.n = 0; this.res = null;
    this.templates = [];
    for (let r = 0; r < 12; r++) for (const [name, iv] of CHORD_TYPES) {
      const T = new Float64Array(12);
      for (const d of iv) for (let h = 0; h < Math.min(this.hmax, OVERTONE_PC.length); h++) T[(r + d + OVERTONE_PC[h]) % 12] += Math.pow(this.s, h);
      let nrm = 0;
      for (let i = 0; i < 12; i++) nrm += T[i] * T[i];
      nrm = Math.sqrt(nrm);
      for (let i = 0; i < 12; i++) T[i] /= nrm;
      this.templates.push({ root: r, name, T, size: iv.length });
    }
    this.chroma = new Float32Array(12);
  }
  onset() { this.acc.fill(0); this.bassAcc.fill(0); this.n = 0; }   // a new strum: start over
  // one spectrum (power, N/2 + 1 bins): add its levelled 12-note profile, return the chord so far
  add(pow) {
    const df = this.df, k0 = Math.max(2, Math.floor(60 / df)), k1 = Math.min(pow.length - 2, Math.ceil(this.fmax / df));
    const m = new Float64Array(k1 + 2), pre = new Float64Array(k1 + 3);
    for (let k = 1; k <= k1 + 1; k++) { m[k] = Math.sqrt(pow[k]); pre[k + 1] = pre[k] + m[k]; }
    const ch = this.chroma, low = [];
    ch.fill(0);
    let tot = 0;
    const r6 = Math.pow(2, 1 / 6);
    for (let k = k0; k <= k1; k++) {
      if (m[k] < m[k - 1] || m[k] < m[k + 1]) continue;
      const a = Math.max(1, Math.floor(k / r6)), b = Math.min(k1 + 1, Math.ceil(k * r6));
      const env = (pre[b + 1] - pre[a]) / (b - a + 1);
      const w = m[k] / (env + 1e-12);
      if (w < 2) continue;                                   // a peak 6 dB above its third-octave
      const q = peakInterp(pow, k), f = q.k * df;
      const pc = ((Math.round(12 * Math.log2(f / this.a4)) % 12) + 12 + 9) % 12;
      const v = this.weight === 'log' ? Math.log(w) : this.weight === 'amp' ? m[k] : this.weight === 'sqrt' ? Math.sqrt(m[k]) : w;
      ch[pc] += v; tot += v;
      if (f < 400) low.push({ f, w, pc });
    }
    // the bass: the lowest strong peak that its octave confirms (or that stands well out on its own)
    for (const p of low) {
      const oct = low.some(q => Math.abs(q.f / p.f - 2) < 0.04);
      if (oct || p.w > 6) { this.bassAcc[p.pc] += Math.log(p.w); break; }
    }
    if (tot <= 0) return this.res;
    for (let i = 0; i < 12; i++) { this.acc[i] = this.acc[i] * this.leak + ch[i] / tot; this.bassAcc[i] *= this.leak; }
    this.n++;
    this.res = this.decide();
    return this.res;
  }
  decide() {
    const a = this.acc;
    let nrm = 0;
    for (let i = 0; i < 12; i++) nrm += a[i] * a[i];
    nrm = Math.sqrt(nrm);
    if (!nrm) return null;
    const scored = this.templates.map(t => {
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += a[i] * t.T[i];
      return { ...t, score: dot / nrm - (t.size === 4 ? 0.015 : 0) };
    }).sort((x, y) => y.score - x.score);
    // the bass decides between near-equal readings (Am7 and C6 are the same four notes); an inversion
    // is named as such (C/E)
    let bass = -1, bm = 0;
    for (let i = 0; i < 12; i++) if (this.bassAcc[i] > bm) { bm = this.bassAcc[i]; bass = i; }
    let b = scored[0];
    if (bass >= 0 && b.root !== bass) { const alt = scored.slice(1, 6).find(x => x.root === bass && b.score - x.score < 0.03); if (alt) b = alt; }
    const tones = (CHORD_TYPES.find(t => t[0] === b.name) || [, [0]])[1].map(d => (b.root + d) % 12);
    const slash = bass >= 0 && bass !== b.root && tones.includes(bass) ? `/${NOTE_NAMES[bass]}` : '';
    return { root: b.root, type: b.name, name: NOTE_NAMES[b.root] + b.name, full: NOTE_NAMES[b.root] + b.name + slash, bass, tones, score: b.score, margin: b.score - scored.filter(x => x !== b)[0].score, alt: scored.filter(x => x !== b).slice(0, 2).map(x => NOTE_NAMES[x.root] + x.name) };
  }
  result() { return this.res; }
}
const CHORDS = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['5', [0, 7]]];
export function estimateChord(chroma) {
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += chroma[i] * chroma[i];
  norm = Math.sqrt(norm) || 1;
  let best = null;
  for (let r = 0; r < 12; r++) for (const [name, iv] of CHORDS) {
    let dot = 0;
    const w = iv.map((_, j) => (j === 0 ? 1.15 : 1)); // the root counts a little more
    let wn = 0;
    iv.forEach((d, j) => { dot += chroma[(r + d) % 12] * w[j]; wn += w[j] * w[j]; });
    const score = dot / (norm * Math.sqrt(wn)) - (iv.length === 2 ? 0.08 : 0) - (iv.length === 4 ? 0.02 : 0);
    if (!best || score > best.score) best = { root: r, name, score };
  }
  return best;
}

// Hann window (periodic) and the factor that makes a sine of amplitude 1 read 0 dB in its bin
export function hann(n) {
  const w = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); sum += w[i]; }
  return { w, norm: 20 * Math.log10(2 / sum) };
}

// The exact frequency of a peak between bins: Gaussian (log-parabolic) interpolation on the power
// of three neighbouring bins; good to a few hundredths of a bin with a Hann window.
export function peakInterp(pow, k) {
  const a = Math.log(pow[k - 1] + 1e-30), b = Math.log(pow[k] + 1e-30), c = Math.log(pow[k + 1] + 1e-30);
  const d = a - 2 * b + c;
  if (d >= 0) return { k, db: 10 * Math.log10(pow[k] + 1e-30) };
  const p = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)); // never beyond the neighbouring bins
  return { k: k + p, db: (10 / Math.LN10) * (b - 0.25 * (a - c) * p) };
}

// ------------------------------------------------------------------------- A and C weighting
// IEC 61672 weighting curves as analog prototypes, bilinear-transformed to biquads at the actual
// sample rate and normalised to 0 dB at 1 kHz. The bilinear transform squeezes the 12.2 kHz corner
// towards Nyquist (−1.2 dB at 10 kHz at 48 kHz); the low corners are prewarped, and the high one is
// placed where the curve fits the standard best up to 12.5 kHz (searched once per sample rate: within
// 0.5 dB at 44.1 and 48 kHz, well inside the class 1 tolerances).
const W1 = 2 * Math.PI * 20.598997, W2 = 2 * Math.PI * 107.65265, W3 = 2 * Math.PI * 737.86223, W4 = 2 * Math.PI * 12194.217;
const STANDARD = { // IEC 61672 values, dB
  A: { 31.5: -39.4, 63: -26.2, 125: -16.1, 250: -8.6, 500: -3.2, 1000: 0, 2000: 1.2, 4000: 1.0, 8000: -1.1, 10000: -2.5, 12500: -4.3 },
  C: { 31.5: -3.0, 63: -0.8, 125: -0.2, 1000: 0, 2000: -0.2, 4000: -0.8, 8000: -3.0, 10000: -4.4, 12500: -6.2 },
};
function bilinear(b, a, fs) { // b, a: [s², s, 1] coefficients
  const K = 2 * fs, K2 = K * K;
  const B0 = b[0] * K2 + b[1] * K + b[2], B1 = 2 * b[2] - 2 * b[0] * K2, B2 = b[0] * K2 - b[1] * K + b[2];
  const A0 = a[0] * K2 + a[1] * K + a[2], A1 = 2 * a[2] - 2 * a[0] * K2, A2 = a[0] * K2 - a[1] * K + a[2];
  return [B0 / A0, B1 / A0, B2 / A0, A1 / A0, A2 / A0];
}
function sectionResponse(c, f, fs) {
  const w = 2 * Math.PI * f / fs, cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
  let mag = 1;
  for (const [b0, b1, b2, a1, a2] of c) {
    const nr = b0 + b1 * cr + b2 * c2r, ni = b1 * ci + b2 * c2i, dr = 1 + a1 * cr + a2 * c2r, di = a1 * ci + a2 * c2i;
    mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
  return mag;
}
function weightingSections(kind, fs, m) {
  const K = 2 * fs, warp = w => K * Math.tan(w / K);
  const w1 = warp(W1), w2 = warp(W2), w3 = warp(W3), w4 = W4 * m;
  const s2 = [1, 0, 0], one = [0, 0, 1];
  const secs = kind === 'A'
    ? [[s2, [1, 2 * w1, w1 * w1]], [s2, [1, w2 + w3, w2 * w3]], [one, [1, 2 * w4, w4 * w4]]]
    : [[s2, [1, 2 * w1, w1 * w1]], [one, [1, 2 * w4, w4 * w4]]];
  const c = secs.map(([b, a]) => bilinear(b, a, fs));
  const g = 1 / sectionResponse(c, 1000, fs);
  c[0][0] *= g; c[0][1] *= g; c[0][2] *= g;
  return c;
}
export class Weighting {
  constructor(kind, fs) {
    let best = null;
    for (let m = 1; m <= 1.5; m += 0.005) {
      const c = weightingSections(kind, fs, m);
      let e = 0;
      for (const [f, v] of Object.entries(STANDARD[kind])) if (+f < fs / 2) e = Math.max(e, Math.abs(20 * Math.log10(sectionResponse(c, +f, fs)) - v));
      if (!best || e < best.e) best = { c, e };
    }
    this.c = best.c;
    this.maxError = best.e;
    this.z = this.c.map(() => [0, 0]);
  }
  response(f, fs) { return sectionResponse(this.c, f, fs); }
  // one sample through the cascade (transposed direct form II)
  step(x) {
    const c = this.c, z = this.z;
    for (let i = 0; i < c.length; i++) {
      const k = c[i], s = z[i];
      const y = k[0] * x + s[0];
      s[0] = k[1] * x - k[3] * y + s[1];
      s[1] = k[2] * x - k[4] * y;
      x = y;
    }
    return x;
  }
}

// ------------------------------------------------------------------------------------- notes
export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
export function noteOf(f, a4 = 440) {
  if (!(f > 0)) return null;
  const midi = 69 + 12 * Math.log2(f / a4), n = Math.round(midi);
  return { midi, n, name: NOTE_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1, cents: (midi - n) * 100 };
}
export const noteLabel = (f, a4) => { const q = noteOf(f, a4); return q ? `${q.name}${q.octave}` : ''; };
export function fmtHz(f) {
  if (!isFinite(f)) return '—';
  if (f >= 10000) return (f / 1000).toFixed(1) + ' kHz';
  if (f >= 1000) return (f / 1000).toFixed(2) + ' kHz';
  if (f >= 100) return f.toFixed(1) + ' Hz';
  return f.toFixed(2) + ' Hz';
}

// --------------------------------------------------------------------------------- colour maps
// 256-entry lookup tables as 32-bit pixels (ImageData order: R, G, B, A in memory).
const STOPS = {
  spectro: [[0, '#000000'], [0.13, '#06062e'], [0.3, '#3a0a8c'], [0.48, '#b4087a'], [0.63, '#ff2a2a'], [0.78, '#ff9a00'], [0.9, '#ffe640'], [1, '#ffffff']],
  inferno: [[0, '#000004'], [0.11, '#1b0c41'], [0.22, '#4a0c6b'], [0.33, '#781c6d'], [0.44, '#a52c60'], [0.56, '#cf4446'], [0.67, '#ed6925'], [0.78, '#fb9b06'], [0.89, '#f7d13d'], [1, '#fcffa4']],
  magma: [[0, '#000004'], [0.11, '#180f3d'], [0.22, '#440f76'], [0.33, '#721f81'], [0.44, '#9e2f7f'], [0.56, '#cd4071'], [0.67, '#f1605d'], [0.78, '#fd9668'], [0.89, '#feca8d'], [1, '#fcfdbf']],
  viridis: [[0, '#440154'], [0.11, '#482878'], [0.22, '#3e4989'], [0.33, '#31688e'], [0.44, '#26828e'], [0.56, '#1f9e89'], [0.67, '#35b779'], [0.78, '#6ece58'], [0.89, '#b5de2b'], [1, '#fde725']],
  ice: [[0, '#000000'], [0.25, '#001a4d'], [0.5, '#0066cc'], [0.75, '#33ccff'], [1, '#ffffff']],
  phosphor: [[0, '#000000'], [0.35, '#002a10'], [0.7, '#00c050'], [1, '#d0ffd8']],
  gray: [[0, '#000000'], [1, '#ffffff']],
};
export const CMAP_NAMES = { spectro: 'Spectro', inferno: 'Inferno', magma: 'Magma', viridis: 'Viridis', ice: 'Ice', phosphor: 'Phosphor', gray: 'Grey' };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export function lut(name) {
  const st = STOPS[name] || STOPS.spectro, out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < st.length - 2 && t > st[j + 1][0]) j++;
    const [t0, c0] = st[j], [t1, c1] = st[j + 1], u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const a = hex(c0), b = hex(c1);
    const r = Math.round(a[0] + (b[0] - a[0]) * u), g = Math.round(a[1] + (b[1] - a[1]) * u), bl = Math.round(a[2] + (b[2] - a[2]) * u);
    out[i] = (255 << 24 | bl << 16 | g << 8 | r) >>> 0;
  }
  return out;
}
export const lutCss = (name, i) => { const v = lut(name)[i]; return `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`; };
