// Sound Wizard: room measurement. Pure functions, no DOM (tested in Node).
//
// A logarithmic sine sweep is played and recorded; deconvolving the recording with the sweep's inverse
// filter (Farina's method) gives the room's impulse response, with the loudspeaker's harmonic distortion
// pushed to before the response where it can be cut away. (A clap or balloon pop is already an impulse
// response, only far less clean.) From the impulse response: the frequency response (speaker + room +
// microphone together), the reverberation time per octave band (backward integration of the squared
// response, as in ISO 3382), and the strongest low-frequency resonances (room modes).

export const BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];

// ---- an in-place radix-2 complex FFT on Float64Arrays (inverse: scaled by 1/n)
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const pow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

// ---- the sweep and its inverse filter
export function sweepSignal(sr, T, f1, f2, amp = 1) {
  const n = Math.round(T * sr), x = new Float32Array(n), L = Math.log(f2 / f1), K = 2 * Math.PI * f1 * T / L;
  const fade = Math.round(0.02 * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = amp;
    if (i < fade) g *= 0.5 - 0.5 * Math.cos(Math.PI * i / fade);
    if (i > n - fade) g *= 0.5 - 0.5 * Math.cos(Math.PI * (n - i) / fade);
    x[i] = g * Math.sin(K * (Math.exp(t * L / T) - 1));
  }
  return x;
}
// the time-reversed sweep, with the amplitude falling 6 dB per octave (the sweep spends longer on low
// frequencies, so its spectrum is pink; this makes the product flat)
export function inverseFilter(sr, T, f1, f2) {
  const s = sweepSignal(sr, T, f1, f2, 1), n = s.length, L = Math.log(f2 / f1), inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = s[n - 1 - i] * Math.exp(-(i / sr) * L / T);
  return inv;
}

// ---- the impulse response from a recording of the sweep: { h (Float32Array from just before the direct
// sound), peak (index of the direct sound in the recording's own timeline), snr (dB) }
export function deconvolve(rec, sr, T, f1, f2, maxLen = 2.5) {
  const inv = inverseFilter(sr, T, f1, f2), N = pow2(rec.length + inv.length);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(rec); br.set(inv);
  fft(ar, ai); fft(br, bi);
  for (let k = 0; k < N; k++) { const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; ai[k] = i; }
  fft(ar, ai, true);
  // the linear response sits at index len(inv) − 1 + delay; the harmonics come before it. Look for the
  // strongest value from there to a second later (the direct sound).
  const c0 = inv.length - 1;
  let pk = c0, mx = 0;
  for (let i = c0 - Math.round(0.002 * sr); i < c0 + Math.round(1.0 * sr) && i < N; i++) if (i >= 0 && Math.abs(ar[i]) > mx) { mx = Math.abs(ar[i]); pk = i; }
  const pre = Math.round(0.003 * sr), len = Math.min(Math.round(maxLen * sr), N - pk + pre, rec.length + inv.length - pk + pre);
  const h = new Float32Array(len);
  for (let i = 0; i < len; i++) h[i] = ar[pk - pre + i] || 0;
  return { h, pre, delay: pk - c0 };
}

// ---- measures from an impulse response h (the direct sound at index `pre`)
const db10 = x => 10 * Math.log10(x + 1e-30);
// the noise floor of the IR: the mean power of its last 10 % (after the room has long decayed)
function noisePower(h2) {
  const n = h2.length, a = Math.floor(n * 0.88);
  let s = 0; for (let i = a; i < n; i++) s += h2[i];
  return s / (n - a);
}
// the decay of one band: Schroeder's backward integral of the squared response, noise-compensated.
// Returns { curve (dB, 0 at the start, step dt), t20, t30, edt, range (dB above the noise) }
function decayOf(hb, pre, sr) {
  const n = hb.length, h2 = new Float64Array(n);
  for (let i = 0; i < n; i++) h2[i] = hb[i] * hb[i];
  const noise = noisePower(h2);
  // cut the response where it reaches the noise floor + 3 dB (smoothed over 20 ms), subtract the noise power
  const win = Math.round(0.02 * sr);
  let end = n, run = 0;
  for (let i = 0; i < n; i++) {
    run += h2[i]; if (i >= win) run -= h2[i - win];
    if (i > pre + win && run / Math.min(i + 1, win) < noise * 2) { end = i; break; }
  }
  end = Math.max(end, pre + win * 2);
  const s = new Float64Array(end + 1);
  for (let i = end - 1; i >= pre; i--) s[i] = s[i + 1] + Math.max(0, h2[i] - noise);
  const tot = s[pre] || 1e-30, dt = 1 / sr;
  const curve = new Float32Array(end - pre);
  for (let i = pre; i < end; i++) curve[i - pre] = db10(s[i] / tot);
  // the dynamic range: the strongest 20 ms of the response over the noise floor
  let pkMean = 0, acc = 0;
  for (let i = 0; i < n; i++) { acc += h2[i]; if (i >= win) acc -= h2[i - win]; if (i >= win - 1 && acc / win > pkMean) pkMean = acc / win; }
  const range = db10(pkMean) - db10(noise);
  const fit = (a, b) => { // slope between a and b dB (negative), as the time for a 60 dB decay
    let ia = -1, ib = -1;
    for (let i = 0; i < curve.length; i++) { if (ia < 0 && curve[i] <= a) ia = i; if (curve[i] <= b) { ib = i; break; } }
    if (ia < 0 || ib < 0 || ib - ia < 8) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
    for (let i = ia; i <= ib; i++) { const x = i * dt, y = curve[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; m++; }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx); // dB per second
    return slope < 0 ? -60 / slope : null;
  };
  return { curve, dt, t20: fit(-5, -25), t30: fit(-5, -35), edt: fit(0, -10), range, noiseDb: db10(noise) };
}
// a smooth band mask: 1 inside the octave band around fc, raised-cosine edges of 1/3 octave
function bandMask(freq, fc) {
  const lo = fc / Math.SQRT2, hi = fc * Math.SQRT2, e = Math.pow(2, 1 / 6);
  if (freq <= lo / e || freq >= hi * e) return 0;
  if (freq >= lo && freq <= hi) return 1;
  const x = freq < lo ? Math.log(freq / (lo / e)) / Math.log(e) : Math.log((hi * e) / freq) / Math.log(e);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}
// fractional-octave smoothing of a power spectrum onto a log-frequency grid
function smoothSpectrum(pw, df, fLo, fHi, perOct, frac) {
  const f = [], d = [], n = Math.round(Math.log2(fHi / fLo) * perOct);
  for (let i = 0; i <= n; i++) {
    const fc = fLo * Math.pow(2, i / perOct), a = Math.max(1, Math.round(fc * Math.pow(2, -1 / (2 * frac)) / df)), b = Math.min(pw.length - 1, Math.max(a, Math.round(fc * Math.pow(2, 1 / (2 * frac)) / df)));
    let s = 0; for (let k = a; k <= b; k++) s += pw[k];
    f.push(fc); d.push(db10(s / (b - a + 1)));
  }
  return { f, db: d };
}

// the whole analysis. opts: { sweep: true (a log sweep response) or false (a pop: h is the recording itself) }
export function analyseImpulse(h, pre, sr, opts = {}) {
  const n = h.length, N = pow2(Math.max(n, Math.round(sr * 0.5))), re = new Float64Array(N), im = new Float64Array(N);
  // the response: the direct sound onward, a half-Hann fade over the last 15 % so the cut does not ring
  const useN = Math.min(n, Math.round(1.0 * sr));
  for (let i = 0; i < useN; i++) re[i] = h[i] * (i > useN * 0.85 ? 0.5 + 0.5 * Math.cos(Math.PI * (i - useN * 0.85) / (useN * 0.15)) : 1);
  fft(re, im);
  const df = sr / N, half = N >> 1, pw = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
  const fHi = Math.min(sr * 0.45, 18000);
  const sm = smoothSpectrum(pw, df, 30, fHi, 24, 6); // 1/6-octave smoothing, 24 points per octave
  // relative to the mean of 500–2000 Hz
  let ref = 0, rc = 0; for (let i = 0; i < sm.f.length; i++) if (sm.f[i] >= 500 && sm.f[i] <= 2000) { ref += sm.db[i]; rc++; }
  ref = rc ? ref / rc : 0;
  const response = { f: sm.f, db: sm.db.map(x => x - ref) };
  // the modes: peaks of a finer smoothing (1/24 octave) between 30 and 300 Hz, standing ≥ 4 dB above the
  // median of their neighbourhood (±25 %)
  const fine = smoothSpectrum(pw, df, 30, 300, 96, 24), modes = [];
  for (let i = 2; i < fine.f.length - 2; i++) {
    if (!(fine.db[i] >= fine.db[i - 1] && fine.db[i] > fine.db[i + 1] && fine.db[i] >= fine.db[i - 2] && fine.db[i] > fine.db[i + 2])) continue;
    const near = []; for (let j = 0; j < fine.f.length; j++) if (fine.f[j] >= fine.f[i] * 0.8 && fine.f[j] <= fine.f[i] * 1.25 && Math.abs(j - i) > 3) near.push(fine.db[j]);
    near.sort((a, b) => a - b);
    const med = near[near.length >> 1];
    if (near.length >= 4 && fine.db[i] - med >= 4) modes.push({ f: fine.f[i], db: fine.db[i] - med });
  }
  modes.sort((a, b) => b.db - a.db);
  const topModes = modes.slice(0, 6).sort((a, b) => a.f - b.f);
  // are the lows there at all? (a phone speaker is weak below ~150 Hz)
  let lo = 0, lc = 0, mid = 0, mc = 0;
  for (let i = 0; i < sm.f.length; i++) { if (sm.f[i] >= 40 && sm.f[i] <= 100) { lo += sm.db[i]; lc++; } if (sm.f[i] >= 500 && sm.f[i] <= 2000) { mid += sm.db[i]; mc++; } }
  const lowWeak = lc && mc ? (lo / lc - mid / mc) < -20 : false;
  // reverberation per octave band
  const rt = [], decays = {};
  const hr = new Float64Array(N), hi = new Float64Array(N);
  for (let i = 0; i < Math.min(n, N); i++) hr[i] = h[i];
  fft(hr, hi);
  for (const fc of BANDS) {
    if (fc * Math.SQRT2 > sr / 2.2) continue;
    const br = new Float64Array(N), bi = new Float64Array(N);
    for (let k = 0; k <= half; k++) {
      const m = bandMask(k * df, fc);
      br[k] = hr[k] * m; bi[k] = hi[k] * m;
      if (k > 0 && k < half) { br[N - k] = hr[N - k] * m; bi[N - k] = hi[N - k] * m; }
    }
    fft(br, bi, true);
    const hb = new Float32Array(Math.min(n, N)); for (let i = 0; i < hb.length; i++) hb[i] = br[i];
    const d = decayOf(hb, pre, sr);
    const T = d.t30 != null ? d.t30 : d.t20;
    rt.push({ f: fc, t20: d.t20, t30: d.t30, edt: d.edt, t: T, range: d.range });
    // the curve at 100 Hz for plotting
    const step = Math.max(1, Math.round(sr / 100)), pl = [];
    for (let i = 0; i < d.curve.length; i += step) pl.push(d.curve[i]);
    decays[fc] = pl;
  }
  // overall level against the noise: the direct sound's peak against the tail
  let pk = 0; for (let i = 0; i < Math.min(n, pre + Math.round(0.01 * sr)); i++) pk = Math.max(pk, Math.abs(h[i]));
  const h2 = new Float64Array(n); for (let i = 0; i < n; i++) h2[i] = h[i] * h[i];
  const snr = db10(pk * pk) - db10(noisePower(h2));
  // the quality: how far the decay stands above the noise in the middle bands (T20 needs 30 dB, T30 40)
  const ranges = rt.filter(r => r.f >= 500 && r.f <= 2000).map(r => r.range).sort((a, b) => a - b), range = ranges.length ? ranges[0] : 0;
  const quality = range >= 45 ? 'good' : range >= 30 ? 'fair' : 'poor';
  const valid = rt.filter(r => r.t != null && r.f >= 250 && r.f <= 4000);
  const rtMean = valid.length ? valid.reduce((s, r) => s + r.t, 0) / valid.length : null;
  // the impulse response's envelope for a plot: 10 ms steps, dB below the peak
  const env = []; const st = Math.round(sr * 0.01);
  for (let i = 0; i < n; i += st) { let m = 0; for (let j = i; j < Math.min(n, i + st); j++) m = Math.max(m, Math.abs(h[j])); env.push(20 * Math.log10(m / (pk || 1) + 1e-6)); }
  return { sr, snr, range, quality, response, modes: topModes, lowWeak, rt, rtMean, decays, env, pre };
}

// from a recording of the sweep
export function analyseSweep(rec, sr, T, f1, f2) {
  const { h, pre } = deconvolve(rec, sr, T, f1, f2);
  return { ...analyseImpulse(h, pre, sr), sweep: true };
}
// from a pop / clap / balloon: the recording from a little before the bang
export function analysePop(rec, sr) {
  let pk = 0, pi = 0;
  for (let i = 0; i < rec.length; i++) if (Math.abs(rec[i]) > pk) { pk = Math.abs(rec[i]); pi = i; }
  const pre = Math.min(pi, Math.round(0.003 * sr)), a = pi - pre;
  return { ...analyseImpulse(rec.subarray(a), pre, sr), sweep: false };
}
