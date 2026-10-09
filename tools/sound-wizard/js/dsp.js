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
  // x: n samples (already windowed). out: n/2 + 1 values of |X[k]|². Also keeps re/im of X in
  // this.xr / this.xi when keepComplex is set (the tuner and tone analysis use the phase-free power only).
  power(x, out) {
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
      out[k] = xr * xr + xi * xi;
    }
  }
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
  const p = 0.5 * (a - c) / d;
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
