// Sound Wizard: practice mode maths. Pure functions, no DOM (tested in Node), shared by the page (which
// plays the clicks) and the engine (which measures the player against the same schedule).
//
// The click schedule is a pure function of a configuration, so both sides can generate the same events:
//   cfg = { t0, bpm, beats, sub, poly }      t0: context time (s) of beat 0; beats: beats per bar (1 = no accent);
//   sub: 0 | 2 | 3 | 4 quiet subdivision clicks; poly: null | { p, q }: p evenly spaced notes in the time of q
//   beats, in a voice of its own (a polyrhythm to play against).
// Event kinds: accent (beat 1 of the bar), beat, sub, poly.

export const POLY_PRESETS = ['off', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '5:3', '3:5', '7:4', '5:2', '7:5'];
export function parsePoly(s) {
  const m = /^(\d+):(\d+)$/.exec(String(s || ''));
  if (!m) return null;
  const p = +m[1], q = +m[2];
  return p >= 2 && q >= 2 && p <= 12 && q <= 12 ? { p, q } : null;
}

// the events with t in [from, to), time-ordered
export function clickEvents(cfg, from, to) {
  const out = [], B = 60 / cfg.bpm, beats = Math.max(1, cfg.beats | 0);
  const k0 = Math.max(0, Math.floor((from - cfg.t0) / B) - 1), k1 = Math.ceil((to - cfg.t0) / B) + 1;
  for (let k = k0; k <= k1; k++) {
    const t = cfg.t0 + k * B;
    if (t >= from && t < to) out.push({ t, kind: beats > 1 && k % beats === 0 ? 'accent' : 'beat', beat: k });
    if (cfg.sub > 1) for (let j = 1; j < cfg.sub; j++) { const ts = t + j * B / cfg.sub; if (ts >= from && ts < to) out.push({ t: ts, kind: 'sub', beat: k }); }
  }
  if (cfg.poly) {
    const { p, q } = cfg.poly, cyc = q * B, c0 = Math.max(0, Math.floor((from - cfg.t0) / cyc) - 1), c1 = Math.ceil((to - cfg.t0) / cyc) + 1;
    for (let c = c0; c <= c1; c++) for (let j = 0; j < p; j++) {
      const t = cfg.t0 + c * cyc + j * cyc / p;
      if (t >= from && t < to) out.push({ t, kind: 'poly', beat: c * q, j });
    }
  }
  out.sort((a, b) => a.t - b.t || (a.kind === 'poly') - (b.kind === 'poly'));
  return out;
}

// which events the player is measured against
export const TARGETS = {
  beats: e => e.kind === 'accent' || e.kind === 'beat',
  layer2: e => e.kind === 'poly',
  all: () => true,
};

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

// Match the player's onsets (context times, s) to the target events and measure how they sit.
//   opts: { target: 'beats'|'layer2'|'all', comp: latency in ms removed from every onset, now: context time
//   (targets later than this are not yet due), maxOff: furthest a note may be from its target (s) }
// Returns { hits: [{t, off (ms, + = late), kind, beat, target}], extras (unmatched onsets), missed,
//   n, mean, sd, mad, worst, early, late, ontime, drift (ms per bar), swing }
export function analyseTake(onsets, cfg, opts = {}) {
  const target = TARGETS[opts.target] || TARGETS.beats, comp = (opts.comp || 0) / 1000, now = opts.now ?? Infinity;
  const B = 60 / cfg.bpm, last = Math.min(now, onsets.length ? onsets[onsets.length - 1] + 1 : cfg.t0);
  const evs = clickEvents(cfg, cfg.t0 - B, last + B).filter(target);
  const hits = [], extras = [];
  const used = new Set();
  const adj = onsets.map(t => t - comp);
  for (const t of adj) {
    // the nearest target
    let bi = -1, bd = Infinity;
    for (let i = 0; i < evs.length; i++) { const d = Math.abs(evs[i].t - t); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) { extras.push(t); continue; }
    const prev = evs[bi - 1], next = evs[bi + 1];
    const gap = Math.min(prev ? evs[bi].t - prev.t : Infinity, next ? next.t - evs[bi].t : Infinity);
    const lim = Math.min(opts.maxOff ?? 0.2, isFinite(gap) ? gap * 0.5 : Infinity);
    if (bd > lim) { extras.push(t); continue; }
    if (used.has(bi)) { // two notes for one target: the nearer keeps it
      const h = hits.find(x => x.i === bi);
      if (bd < Math.abs(h.off) / 1000) { extras.push(h.t); Object.assign(h, { t, off: (t - evs[bi].t) * 1000 }); } else extras.push(t);
      continue;
    }
    used.add(bi);
    hits.push({ i: bi, t, off: (t - evs[bi].t) * 1000, kind: evs[bi].kind, beat: evs[bi].beat, target: evs[bi].t });
  }
  hits.sort((a, b) => a.t - b.t);
  // targets that fell inside the played stretch with nothing near them
  let missed = 0;
  if (hits.length >= 2) {
    const lo = hits[0].target, hi = Math.min(hits[hits.length - 1].target, now);
    for (let i = 0; i < evs.length; i++) if (evs[i].t > lo && evs[i].t < hi && !used.has(i)) missed++;
  }
  const offs = hits.map(h => h.off);
  const res = { hits, extras: extras.length, missed, n: hits.length, swing: swingOf(adj, cfg) };
  if (hits.length) {
    res.mean = mean(offs); res.sd = sd(offs); res.mad = mean(offs.map(Math.abs));
    res.worst = offs.reduce((w, x) => (Math.abs(x) > Math.abs(w) ? x : w), 0);
    res.early = offs.filter(x => x < -10).length; res.late = offs.filter(x => x > 10).length; res.ontime = offs.length - res.early - res.late;
    // drift: the slope of the offsets over time, in ms per bar (the bar = beats × beat length)
    if (hits.length >= 6) {
      const ts = hits.map(h => h.t), mt = mean(ts), mo = mean(offs);
      let num = 0, den = 0;
      for (let i = 0; i < hits.length; i++) { num += (ts[i] - mt) * (offs[i] - mo); den += (ts[i] - mt) ** 2; }
      const slope = den > 0 ? num / den : 0; // ms per second
      res.drift = slope * B * Math.max(1, cfg.beats | 0);
      res.driftSec = slope; res.trend = { mt, mo, slope };
    }
  }
  return res;
}

// the swing ratio: where the off-beat notes sit between two beats. Notes at 0.3–0.8 of a beat (not near a
// beat) count; their mean position f gives long:short = f/(1−f): 1:1 straight, 2:1 triplet swing.
export function swingOf(times, cfg) {
  const B = 60 / cfg.bpm, fr = [];
  for (const t of times) {
    const x = (t - cfg.t0) / B, f = x - Math.floor(x);
    if (x >= 0 && f >= 0.3 && f <= 0.8) fr.push(f);
  }
  if (fr.length < 4) return null;
  const f = mean(fr);
  return { f, ratio: f / (1 - f), n: fr.length, sd: sd(fr) };
}

// plain words for the report
export function describeTake(a) {
  if (!a || !a.n) return null;
  const bias = Math.abs(a.mean) < 5 ? 'right on the beat' : a.mean > 0 ? `${a.mean.toFixed(0)} ms behind the beat` : `${(-a.mean).toFixed(0)} ms ahead of the beat`;
  const spread = a.sd < 8 ? 'very even' : a.sd < 15 ? 'fairly even' : a.sd < 25 ? 'uneven' : 'loose';
  let drift = null;
  if (a.drift != null && Math.abs(a.drift) >= 2) drift = a.drift > 0 ? `dragging: ${a.drift.toFixed(0)} ms later each bar` : `rushing: ${(-a.drift).toFixed(0)} ms earlier each bar`;
  return { bias, spread, drift };
}
