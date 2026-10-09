// Sound Wizard: pulses and polyrhythms from onset strength. Pure functions, no DOM (tested in Node).
//
// Input: onset strength per frame (how much new sound starts in each ~11 ms frame), for the whole
// signal and for three registers (low / mid / high), oldest frame first. Output: the candidate pulses,
// the main pulse refined to a fraction of a frame with its phase, the subdivision (eighths, triplets…),
// the bar (how many beats, which is the downbeat) and, if there is one, the second layer of a
// polyrhythm p:q with where it was heard.
//
// Everything is tested against the onsets themselves, not only the autocorrelation: a claimed second
// layer must put sound on its own grid points (the ones not shared with the main pulse) in most cycles,
// and must not simply be a subdivision of the main beat.

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const BANDS = ['all', 'low', 'mid', 'high'];

// the onset strength minus its moving average (1 s), negatives dropped; scale: divide by it (the
// strong onsets of the whole signal ≈ 1), the same for every register
function detrend(src, n, fr, scale = 0) {
  const half = Math.round(fr / 2), out = new Float32Array(n);
  let s = 0, c = 0;
  for (let i = 0; i < Math.min(n, half); i++) { s += src[i]; c++; }
  for (let i = 0; i < n; i++) {
    if (i + half < n) { s += src[i + half]; c++; }
    if (i - half - 1 >= 0) { s -= src[i - half - 1]; c--; }
    out[i] = Math.max(0, src[i] - s / c);
  }
  if (!scale) { const sorted = Array.from(out).sort((a, b) => a - b); scale = sorted[Math.floor(sorted.length * 0.97)] || 1; }
  for (let i = 0; i < n; i++) out[i] /= scale;
  out.scale = scale;
  return out;
}

// candidate pulses from the autocorrelation (with the multiples of each period added in, so a beat is
// not confused with its own subdivision), strongest first, clustered within 4 %
export function pulseCandidates(o, fr, { bpmMin = 40, bpmMax = 240, prior = 120 } = {}) {
  const n = o.length, Lmin = Math.floor(60 * fr / bpmMax), Lmax = Math.min(Math.ceil(60 * fr / bpmMin), Math.floor(n / 3));
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += o[i] * o[i];
  if (e0 <= 1e-9 || Lmax <= Lmin) return [];
  const acf = new Float32Array(3 * Lmax + 3);
  for (let L = Math.max(1, Lmin - 1); L <= Math.min(n - 1, 3 * Lmax + 2); L++) {
    let a = 0;
    for (let i = L; i < n; i++) a += o[i] * o[i - L];
    acf[L] = (a / (n - L)) / (e0 / n);
  }
  const sc = new Float32Array(Lmax + 2);
  for (let L = Lmin; L <= Lmax; L++) {
    const bpm = 60 * fr / L, pr = Math.exp(-0.5 * (Math.log2(bpm / prior) / 0.9) ** 2);
    sc[L] = (acf[L] + 0.5 * (acf[2 * L] || 0) + 0.33 * (acf[3 * L] || 0)) * pr;
  }
  const peaks = [];
  for (let L = Lmin + 1; L < Lmax; L++) if (sc[L] >= sc[L - 1] && sc[L] > sc[L + 1] && sc[L] > 0) {
    const a = sc[L - 1], b = sc[L], c = sc[L + 1], d = a - 2 * b + c, dl = d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0;
    peaks.push({ L: L + dl, bpm: 60 * fr / (L + dl), score: b, acf: acf[L] });
  }
  peaks.sort((x, y) => y.score - x.score);
  const out = [];
  for (const p of peaks) {
    if (out.some(q => Math.abs(Math.log(p.bpm / q.bpm)) < 0.04)) continue;
    out.push(p);
    if (out.length >= 5) break;
  }
  const best = out[0] ? out[0].score : 1;
  return out.filter(p => p.score >= 0.25 * best).map(p => ({ bpm: p.bpm, strength: Math.max(0, Math.min(1, p.acf)), score: p.score / best }));
}

// the main pulse refined: the period and phase whose grid catches the most onset strength
function refine(o, fr, bpm) {
  const n = o.length;
  let best = { P: 60 * fr / bpm, phi: 0, e: -1 };
  const search = (P0, span, step) => {
    for (let k = -span; k <= span; k++) {
      const P = P0 * (1 + k * step);
      for (let phi = 0; phi < P; phi += 1) {
        let s = 0, c = 0;
        for (let t = phi; t < n; t += P) { s += atPeak(o, t); c++; }
        if (c && s / c > best.e) best = { P, phi, e: s / c };
      }
    }
  };
  search(best.P, 6, 0.004);           // ±2.4 % in 0.4 % steps
  search(best.P, 8, 0.0005);          // then ±0.4 % in 0.05 % steps (0.05 % = a quarter frame over 10 s)
  return best;
}
// for the tempo refinement: the same window, but an onset counts most when it sits exactly on the grid
// point (a flat window would let the estimate settle anywhere on a plateau)
function atPeak(o, t) {
  const i = Math.round(t), n = o.length;
  let m = 0;
  for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { const v = o[j] * (1 - Math.abs(j - t) / 4.5); if (v > m) m = v; }
  return m;
}
// onset strength at a (fractional) frame: the most within ±3 frames (±32 ms: hands, not machines)
function at(o, t) {
  const i = Math.round(t), n = o.length;
  let m = 0;
  for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) if (o[j] > m) m = o[j];
  return m;
}
// how a set of grid points stands out in a register. The register is judged by its own loud onsets
// (ref: the mean of its N loudest frames, N = the number of grid points), so a quiet hi-hat layer
// counts as much as a loud kick in the kick's register. prom = the grid's mean level / ref (1 when the
// grid points ARE the register's loudest onsets); cov = the share of points above 0.3·ref; spiky = the
// register has real onsets at all (its loud frames stand far above its median). ok needs all three.
function gridStats(o, reg, pts, minProm = 0.35) {
  if (!pts.length || !reg.spiky) return { prom: 0, cov: 0, score: 0, ok: false };
  const ref = reg.refFor(pts.length), thr = 0.2 * ref;
  let s = 0, hit = 0;
  for (const t of pts) { const v = at(o, t); s += v; if (v > thr) hit++; }
  const mean = s / pts.length, prom = Math.min(1.5, mean / ref), cov = hit / pts.length;
  const ok = cov >= 0.6 && prom >= minProm;
  return { prom, cov, z: reg.spikiness, score: ok ? cov * Math.min(1, prom) : 0, ok };
}
// a register's reference levels: its frames sampled like grid points (±2 frames), sorted
function registerStats(o) {
  const n = o.length, v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = at(o, i);
  const sorted = Array.from(v).sort((a, b) => b - a);
  const median = sorted[n >> 1], top = sorted[Math.floor(n * 0.02)] || 0;
  const spikiness = top / (median + 0.02 * top + 1e-9);
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + sorted[i];
  return { sorted, median, top, spikiness, spiky: spikiness > 4 && top > 0, refFor: k => cum[Math.max(1, Math.min(n, k))] / Math.max(1, Math.min(n, k)) };
}

// the whole analysis. env: { all, low, mid, high } Float32Arrays (oldest first, same length), fr: frames/s
//   opts.mainBpm: a pulse the player chose (kept even when the sound changes), else the strongest
export function analysePoly(env, fr, opts = {}) {
  const n = env.all.length;
  if (n < fr * 3) return null;
  const o = { all: detrend(env.all, n, fr) };
  for (const b of ['low', 'mid', 'high']) o[b] = detrend(env[b], n, fr, o.all.scale);
  const cands = pulseCandidates(o.all, fr);
  if (!cands.length) return { cands: [], main: null };
  // each register's own strongest pulse is offered too (a hi-hat layer is drowned by the kick in the sum)
  for (const b of ['low', 'mid', 'high']) {
    const rc = pulseCandidates(o[b], fr)[0];
    if (rc && rc.strength >= 0.3 && !cands.some(c => Math.abs(Math.log(c.bpm / rc.bpm)) < 0.04)) cands.push({ bpm: rc.bpm, strength: rc.strength, score: 0.5 * rc.score, band: b });
  }
  // the main pulse: the one the player chose (kept even when it fades), else the strongest, with a
  // preference for staying on the current one while it remains a clear candidate (no flip-flopping)
  let mainBpm = cands[0].bpm, locked = false;
  if (opts.mainBpm > 0) {
    const near = cands.find(c => Math.abs(Math.log(c.bpm / opts.mainBpm)) < 0.08);
    mainBpm = near ? near.bpm : opts.mainBpm; locked = true;
  } else if (opts.prefer > 0) {
    const near = cands.find(c => Math.abs(Math.log(c.bpm / opts.prefer)) < 0.06);
    if (near && near.score >= 0.55) mainBpm = near.bpm;
  }
  const { P, phi, e } = refine(o.all, fr, mainBpm);
  const bpm = 60 * fr / P;
  const mainPts = [];
  for (let t = phi; t < n; t += P) mainPts.push(t);
  // per register: the floor away from the main grid (mean and noise), and the main grid's level
  // per register: its reference levels and the main grid's level there
  const st = {};
  for (const b of BANDS) {
    const reg = registerStats(o[b]);
    let m = 0;
    for (const t of mainPts) m += at(o[b], t);
    st[b] = { reg, mainE: m / mainPts.length, base: reg.median, sd: reg.top };
  }
  const span = Math.max(1e-6, st.all.mainE);
  const mainBand = ['low', 'mid', 'high'].reduce((a, b) => (st[b].mainE > st[a].mainE ? b : a), 'low');
  // the best register's statistics; the register named is the specific one (low / mid / high) where the
  // points stand out most clearly, 'all' only when no single register carries them
  const bestBand = (pts, minProm) => {
    let best = null, named = null;
    for (const b of BANDS) {
      const g = gridStats(o[b], st[b].reg, pts, minProm);
      if (!best || g.score > best.score) best = { band: b, ...g };
      if (b !== 'all' && g.ok && (!named || g.z > named.z)) named = { band: b, ...g };
    }
    if (named && named.score >= 0.8 * best.score) best = { ...best, band: named.band };
    return best;
  };
  // subdivisions of the beat: s notes per beat, the points between the beats
  const subs = {};
  for (let s = 2; s <= 8; s++) {
    const pts = [];
    for (let t = phi; t < n; t += P) for (let j = 1; j < s; j++) if (t + j * P / s < n) pts.push(t + j * P / s);
    subs[s] = bestBand(pts, 0.25); // a subdivision needs a little less: it only names the feel and vetoes claims
  }
  // the finest subdivision that is well populated (sixteenths contain the eighths; the eighths alone
  // would not fill a sixteenth grid)
  let subdiv = null;
  for (const s of [2, 3, 4, 5, 6, 7, 8]) { const g = subs[s]; if (g.ok && (!subdiv || g.score >= subdiv.score * 0.8)) subdiv = { s, ...g }; }
  // the second layer: p notes in the time of q beats, the cycle starting on main beat d
  const ratios = [];
  for (let p = 2; p <= 7; p++) for (let q = 2; q <= 7; q++) {
    if (gcd(p, q) !== 1) continue;
    const P2 = q * P / p;
    let best = null;
    for (let d = 0; d < q; d++) {
      const pts = [];
      for (let t0 = phi + d * P; t0 - q * P < n; t0 += q * P) for (let j = 1; j < p; j++) { const t = t0 + j * P2; if (t >= 0 && t < n) pts.push(t); }
      if (pts.length < 3) continue;
      const g = bestBand(pts);
      if (!best || g.score > best.score) best = { ...g, d, pts: pts.length };
    }
    if (!best) continue;
    // explained by a plain subdivision (the p:q grid lies on every grid of p, 2p, 3p … notes per beat)?
    let explained = false;
    for (let m = p; m <= 8; m += p) if (subs[m] && subs[m].ok) explained = true;
    // the union pattern: both layers on one sound ("bam-babadam" = X·XXX· for 3:2). The pattern's
    // filled slots must be hit in most cycles AND its empty slots must stay empty (else it is a
    // plain subdivision). Judged in the register where the pattern is clearest.
    let union = null;
    if (!explained) {
      const U = p * q, unit = P / p, d = best.d;
      const filled = [], second = [], empty = [];
      for (let t0 = phi + d * P; t0 - q * P < n; t0 += q * P) for (let u = 0; u < U; u++) {
        const t = t0 + u * unit;
        if (t < 0 || t >= n) continue;
        if (u % p === 0) filled.push(t); else if (u % q === 0) { filled.push(t); second.push(t); } else empty.push(t);
      }
      if (second.length >= 3 && empty.length >= 2) for (const b of BANDS) {
        const reg = st[b].reg;
        if (!reg.spiky) continue;
        const ref = reg.refFor(filled.length), thr = 0.2 * ref, thrSoft = 0.15 * ref;
        let hf = 0, sf = 0, se = 0, he = 0, hs = 0;
        for (const t of filled) { const v = at(o[b], t); sf += v; if (v > thr) hf++; }
        for (const t of second) if (at(o[b], t) > thrSoft) hs++; // the second layer's own slots, soft notes allowed
        for (const t of empty) { const v = at(o[b], t); se += v; if (v > thr) he++; }
        const cov = hf / filled.length, covS = hs / second.length, quiet = 1 - he / empty.length, meanF = sf / filled.length, meanE = se / empty.length;
        const ok = covS >= 0.6 && cov >= 0.7 && quiet >= 0.7 && meanF / ref >= 0.3 && meanE < 0.35 * meanF;
        const score = ok ? covS * quiet * Math.min(1, meanF / ref) : 0;
        if (score > (union ? union.score : 0)) union = { score, cov: covS, quiet, band: b, d };
      }
    }
    const byLayer = best.ok && !explained, byUnion = !!union && union.score >= 0.4;
    if (byUnion && !byLayer) best = { ...best, score: union.score, cov: union.cov, prom: Math.max(best.prom, 0.3), band: union.band, d: union.d, union: true };
    else if (byUnion && byLayer) best = { ...best, score: Math.max(best.score, union.score), union: true };
    ratios.push({ p, q, ...best, ok: byLayer || byUnion, explained });
  }
  // a coarser layer whose grid lies inside a well-populated denser one is that denser layer
  for (const r of ratios) {
    if (!r.ok) continue;
    for (const s of ratios) {
      if (s === r || !s.ok || s.cov < 0.65) continue;
      const m = (r.q * s.p) / (r.p * s.q); // second-layer period of r over that of s
      if (m > 1.5 && Math.abs(m - Math.round(m)) < 1e-6 && s.score >= 0.8 * r.score) { r.ok = false; r.inside = `${s.p}:${s.q}`; break; }
    }
  }
  let good = ratios.filter(r => r.ok).sort((a, b) => b.score - a.score);
  let poly = good.length && good[0].score >= 0.25 ? good[0] : null;
  // the main taken as the whole cycle (one "bam" per cycle): both layers then look like subdivisions
  // (2 and 3 per beat, but not 6). Read it again from the slower layer.
  if (!poly && !opts.again && !opts.mainBpm) {
    const okS = [2, 3, 4, 5, 7].filter(a => subs[a] && subs[a].ok);
    for (const a of okS) for (const b of okS) if (a < b && gcd(a, b) === 1 && !(subs[a * b] && subs[a * b].ok)) {
      const r2 = analysePoly(env, fr, { ...opts, mainBpm: bpm * a, again: true });
      if (r2 && r2.poly) { r2.main.locked = false; r2.cands = cands; return r2; }
    }
  }
  // the second layer's pulse is always a choice for the main
  if (poly) { const b2 = bpm * poly.p / poly.q; if (!cands.some(c => Math.abs(Math.log(c.bpm / b2)) < 0.04)) cands.push({ bpm: b2, strength: poly.score, score: 0.5 * poly.score, band: poly.band }); }
  cands.sort((a, b) => b.score - a.score); cands.length = Math.min(cands.length, 5);
  // the bar: which count of beats has the clearest accent, and on which beat
  let meter = null;
  const gridVals = mainPts.map(t => at(o.all, t)), gMean = gridVals.reduce((a, b) => a + b, 0) / gridVals.length;
  const gSd = Math.sqrt(gridVals.reduce((a, v) => a + (v - gMean) ** 2, 0) / gridVals.length);
  for (const [B, pr] of [[2, 0.85], [3, 0.95], [4, 1], [5, 0.75], [6, 0.85], [7, 0.7]]) {
    const E = [], C = [];
    for (let d = 0; d < B; d++) { let s = 0, c = 0; for (let t = phi + d * P; t < n; t += B * P) { s += at(o.all, t); c++; } E.push(c ? s / c : 0); C.push(c); }
    if (Math.min(...C) < 3) continue;
    const mx = Math.max(...E), mean = E.reduce((a, b) => a + b, 0) / B;
    // what chance alone would give for the best of B offsets, each an average of ~c beats
    const chance = gSd * Math.sqrt(2 * Math.log(B) / Math.min(...C));
    const contrast = (mx - mean - chance) / span, sc = contrast * pr;
    if (contrast > 0.08 && (!meter || sc > meter.sc)) meter = { beats: B, down: E.indexOf(mx), contrast, sc };
  }
  // the downbeat as a frame index (the latest one), for drawing bar lines
  let downFrame = null;
  if (meter) { for (let i = mainPts.length - 1; i >= 0; i--) if (i % meter.beats === meter.down) { downFrame = mainPts[i]; break; } }
  return {
    cands, main: { bpm, P, phi, e, band: mainBand, locked, pts: mainPts.length }, st,
    subdiv, poly: poly && { p: poly.p, q: poly.q, score: poly.score, prom: poly.prom, cov: poly.cov, band: poly.band, d: poly.d, bpm2: bpm * poly.p / poly.q },
    others: good.slice(1, 3).map(r => ({ p: r.p, q: r.q, score: r.score })),
    meter: meter && { beats: meter.beats, down: meter.down, contrast: meter.contrast, downFrame },
    subs: opts.debug ? subs : undefined, ratios: opts.debug ? ratios : undefined,
  };
}
