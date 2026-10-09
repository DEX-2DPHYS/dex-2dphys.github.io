// Sound Wizard: the intonation trainer's maths. Pure functions, no DOM (tested in Node).
//
// A scale (root + intervals) gives the target notes; a played pitch is judged against the nearest target
// in cents. Equal temperament, or just intonation measured from the root (the way singers and string and
// wind players tune thirds and fifths). A NoteLog turns the stream of pitch readings into one entry per
// played note (the median of its settled part) and summarises how the player is doing.

export const SCALES = {
  major: { name: 'Major', pcs: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural minor', pcs: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { name: 'Harmonic minor', pcs: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: 'Dorian', pcs: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { name: 'Mixolydian', pcs: [0, 2, 4, 5, 7, 9, 10] },
  pentmaj: { name: 'Major pentatonic', pcs: [0, 2, 4, 7, 9] },
  pentmin: { name: 'Minor pentatonic', pcs: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', pcs: [0, 3, 5, 6, 7, 10] },
  chromatic: { name: 'Chromatic', pcs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};
// just intonation above the root, in cents (5-limit, with 45/32 for the tritone and 16/9 for the minor seventh)
export const JUST = [0, 111.73, 203.91, 315.64, 386.31, 498.04, 590.22, 701.96, 813.69, 884.36, 996.09, 1088.27];
export const TOL = { good: 5, ok: 15 }; // cents: ✓ within 5, amber within 15

const mod12 = n => ((n % 12) + 12) % 12;

// the nearest target note to a (fractional) MIDI pitch: { midi: target (fractional in just intonation),
// k: the equal-tempered note it belongs to, idx: the scale degree, cents: pitch minus target in cents }
export function targetFor(midi, root, scaleKey, temper = 'equal') {
  const sc = SCALES[scaleKey] || SCALES.major, pcs = sc.pcs;
  let best = null;
  const k0 = Math.round(midi);
  for (let k = k0 - 3; k <= k0 + 3; k++) {
    const d = mod12(k - root), idx = pcs.indexOf(d);
    if (idx < 0) continue;
    const tm = temper === 'just' ? k + (JUST[d] - 100 * d) / 100 : k;
    const diff = Math.abs(midi - tm);
    if (!best || diff < best.diff) best = { midi: tm, k, idx, diff };
  }
  if (!best) return null;
  return { midi: best.midi, k: best.k, idx: best.idx, cents: (midi - best.midi) * 100 };
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// Feeds on one reading per analysis block (~21 ms): { midi, cents, k, idx } while a note sounds, or null in
// silence, plus `attack` (the 150 ms after a new pluck/onset, whose readings are not trusted).
export class NoteLog {
  constructor(max = 40) { this.max = max; this.log = []; this.cur = null; this.quiet = 0; this.wasAttack = false; }
  clear() { this.log = []; this.cur = null; this.quiet = 0; }
  feed(r, attack) {
    const edge = attack && !this.wasAttack;
    this.wasAttack = attack;
    if (edge) this.finish(); // a new onset starts a new note, even on the same pitch
    if (!r) { if (++this.quiet >= 7) this.finish(); return; }
    this.quiet = 0;
    if (attack) return;
    if (this.cur && Math.abs(r.midi - this.cur.midi0) > 0.6) this.finish();
    if (!this.cur) this.cur = { midi0: r.midi, k: r.k, idx: r.idx, vals: [] };
    this.cur.vals.push(r.cents);
    this.cur.k = r.k; this.cur.idx = r.idx;
  }
  // the note so far (for the live display)
  live() { return this.cur && this.cur.vals.length >= 3 ? median(this.cur.vals.slice(-8)) : null; }
  finish() {
    const c = this.cur; this.cur = null;
    if (!c || c.vals.length < 8) return; // shorter than ~170 ms of settled sound: a blip, not a note
    const tail = c.vals.slice(Math.floor(c.vals.length * 0.3)); // skip the first 30 %: the settling
    const spread = Math.max(...tail) - Math.min(...tail);
    this.log.push({ cents: median(tail), k: c.k, idx: c.idx, spread, n: c.vals.length });
    if (this.log.length > this.max) this.log.shift();
  }
  // how the last notes went: mean absolute error, the lean (sharp > 0), the worst, per-degree leans
  summary(last = 12) {
    const L = this.log.slice(-last);
    if (!L.length) return null;
    const mean = L.reduce((s, x) => s + Math.abs(x.cents), 0) / L.length, lean = L.reduce((s, x) => s + x.cents, 0) / L.length;
    let worst = L[0];
    for (const x of L) if (Math.abs(x.cents) > Math.abs(worst.cents)) worst = x;
    const within = L.filter(x => Math.abs(x.cents) <= TOL.good).length;
    return { n: L.length, mean, lean, worst, within };
  }
}

// plain words for a reading: what to do with the pitch (not the peg)
export function intonationAdvice(c) {
  const a = Math.abs(c);
  if (a <= TOL.good) return { text: '✓ true', sub: `${a.toFixed(0)} ¢ off`, level: 'good' };
  const dir = c > 0 ? 'sharp' : 'flat', fix = c > 0 ? 'bring it down' : 'bring it up';
  if (a <= TOL.ok) return { text: `a little ${dir}`, sub: `${a.toFixed(0)} ¢ · ${fix} a touch`, level: 'ok' };
  if (a <= 35) return { text: dir, sub: `${a.toFixed(0)} ¢ · ${fix}`, level: 'bad' };
  return { text: `${a.toFixed(0)} ¢ ${dir}`, sub: a >= 50 ? 'closer to the next note: check which one you aim for' : fix, level: 'bad' };
}
