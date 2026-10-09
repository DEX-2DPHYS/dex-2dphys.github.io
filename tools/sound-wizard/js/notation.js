// Sound Wizard: how a polyrhythm can be written down. Pure functions, no DOM (tested in Node).
//
// A polyrhythm p:q here means: the second layer plays p evenly spaced notes in the time of q beats of the
// main pulse (the one the player chose or the strongest one). The cycle is q main beats long. Everything
// below is expressed in main beats (a main beat = one written quarter note in a simple meter).

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;

// written note values in quarter-note units, and their names
const VALUES = [[4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'], [0.25, 'sixteenth'], [0.125, '32nd']];
const valueName = v => (VALUES.find(x => Math.abs(x[0] - v) < 1e-9) || [v, `${v}-quarter`])[1];
const plural = (name, n) => (n === 1 ? name : name.endsWith('h') && !name.endsWith('th') ? name + 's' : name + 's');

// a duration (quarter units) as written notes: one plain or dotted value, or a few tied values
export function writeDuration(d) {
  for (const [v] of VALUES) {
    if (Math.abs(d - v) < 1e-9) return [{ value: v, dots: 0 }];
    if (Math.abs(d - v * 1.5) < 1e-9) return [{ value: v, dots: 1 }];
    if (Math.abs(d - v * 1.75) < 1e-9) return [{ value: v, dots: 2 }];
  }
  const parts = [];
  let left = d;
  for (const [v] of VALUES) { while (left >= v - 1e-9) { parts.push({ value: v, dots: 0 }); left -= v; } }
  if (left > 1e-6) parts.push({ value: 0.125, dots: 0 }); // rounded to a 32nd
  return parts.map((p, i) => ({ ...p, tie: i < parts.length - 1 }));
}
export const durationName = d => writeDuration(d).map(p => `${p.dots === 2 ? 'double-dotted ' : p.dots ? 'dotted ' : ''}${valueName(p.value)}`).join(' tied to ');

// the tuplet that writes p notes in the time of q main beats: the written value v (quarter units) and
// the bracket "p" (or "p:k" when the squeeze is not the usual one)
export function tupletFor(p, q) {
  const usual = Math.pow(2, Math.floor(Math.log2(p)));
  for (const v of [4, 2, 1, 0.5, 0.25, 0.125]) {
    const k = q / v;
    if (Math.abs(k - Math.round(k)) > 1e-9) continue;
    if (k > p / 2 && k <= p) return { value: v, k: Math.round(k), label: Math.round(k) === usual ? String(p) : `${p}:${Math.round(k)}` };
  }
  return { value: 1, k: q, label: `${p}:${q}` };
}

// the meter options the player can choose: [beats per bar, main pulse written as, denominator, compound?]
export const METERS = {
  auto: null,
  '2/4': { n: 2, d: 4, beat: 1 }, '3/4': { n: 3, d: 4, beat: 1 }, '4/4': { n: 4, d: 4, beat: 1 }, '5/4': { n: 5, d: 4, beat: 1 },
  '6/8': { n: 2, d: 8, beat: 1.5 }, '9/8': { n: 3, d: 8, beat: 1.5 }, '12/8': { n: 4, d: 8, beat: 1.5 },
  '5/8': { n: 5, d: 8, beat: 0.5 }, '7/8': { n: 7, d: 8, beat: 0.5 },
};

// counting syllables for p units per beat
const COUNT = { 2: ['', '&'], 3: ['', 'trip', 'let'], 4: ['', 'e', '&', 'a'], 5: ['', 'ta', 'ka', 'ta', 'ka'], 6: ['', 'ta', 'ta', '&', 'ta', 'ta'], 7: ['', 'ta', 'ka', 'ta', 'ka', 'ta', 'ka'] };
const MNEMONICS = { '3:2': 'nice cup of tea', '2:3': 'nice cup of tea', '4:3': 'pass the golden butter', '3:4': 'what atrocious weather' };

// everything about writing p:q at `bpm` on the main pulse, in the chosen meter ('auto' = the one that fits)
//   bands: { main: 'low' | 'mid' | 'high' | null, second: same }  (where each layer was heard)
export function describePolyrhythm({ p, q, bpm, meter = 'auto', bands = {} }) {
  if (!(p >= 2 && q >= 2) || gcd(p, q) !== 1) return null;
  const cycleBeats = q, cycleSec = 60 / bpm * q, secondBpm = bpm * p / q;
  const units = p * q, unitBeats = 1 / p; // the common subdivision: p units per main beat
  const grid = {
    units,
    main: Array.from({ length: units }, (_, u) => u % p === 0),
    second: Array.from({ length: units }, (_, u) => u % q === 0),
  };
  grid.text = [`main (${q} per cycle):   ${grid.main.map(h => (h ? 'X' : '.')).join(' ')}`, `second (${p} per cycle): ${grid.second.map(h => (h ? 'X' : '.')).join(' ')}`].join('\n');
  // counting: p syllables per beat, the second layer's hits marked
  const syl = COUNT[p] || Array.from({ length: p }, (_, i) => (i ? 'ta' : ''));
  const counting = [];
  for (let u = 0; u < units; u++) {
    const beat = Math.floor(u / p) + 1, sub = u % p;
    counting.push({ text: sub === 0 ? String(beat) : syl[sub], main: sub === 0, second: u % q === 0 });
  }
  const mnemonic = MNEMONICS[`${p}:${q}`] || null;

  const differentBands = bands.main && bands.second && bands.main !== bands.second;
  const sug = [];
  const M = METERS[meter] || null;
  // the bar the suggestions are written in: the chosen one, or the cycle itself
  const barBeats = M ? M.n * M.beat : cycleBeats;
  const fitsBar = Math.abs(barBeats / cycleBeats - Math.round(barBeats / cycleBeats)) < 1e-9 && barBeats >= cycleBeats;
  const cyclesPerBar = fitsBar ? Math.round(barBeats / cycleBeats) : 1;
  const barWarn = M && !fitsBar ? `The cycle is ${q} beats, so in ${meter} it starts on a different beat each bar and lines up again every ${cycleBeats * (barBeats / gcd(cycleBeats, barBeats)) / barBeats} bars. A ${q}/4 bar (or a multiple) fits it.` : '';
  const simpleMeter = M && M.beat === 1 ? meter : `${fitsBar ? barBeats : q}/4`;

  // 1. tuplets in a simple meter
  {
    const t = tupletFor(p, q);
    const sig = M && M.beat === 1 ? [M.n, 4] : [q, 4];
    sug.push({
      id: 'tuplet', title: `${simpleMeter}: ${plural(valueName(t.value), p)} in a ${t.label} tuplet`,
      why: `${p} notes in the time of ${t.k} ${plural(valueName(t.value), t.k)} (${q} beats). The standard way; the bracket says "${t.label}".` + (barWarn ? ' ' + barWarn : ''),
      fit: 0.6 + (p <= 5 ? 0.1 : p >= 7 ? -0.15 : 0) - (barWarn ? 0.2 : 0),
      staff: staffSimple(sig, cycleBeats, cyclesPerBar, p, q, { value: t.value, dots: 0 }, t.label),
    });
  }
  // 2. plain or dotted values, no tuplet (when p is a power of two)
  if (isPow2(p)) {
    const d = q / p, w = writeDuration(d);
    const sig = M && M.beat === 1 ? [M.n, 4] : [q, 4];
    sug.push({
      id: 'dotted', title: `${simpleMeter}: ${plural(durationName(d), p)}, no tuplet`,
      why: `Each note of the second layer lasts ${q}/${p} of a beat, which ordinary note values can write${w.length > 1 ? ' with ties' : ''}. Cleanest on the page.` + (barWarn ? ' ' + barWarn : ''),
      fit: 0.85 - (w.length > 1 ? 0.15 : 0) - (barWarn ? 0.2 : 0),
      staff: staffSimple(sig, cycleBeats, cyclesPerBar, p, q, w[0], null, w),
    });
  }
  // 3. compound meter: the cycle as one bar of p·q eighths, the main beat = p eighths
  if (p === 3 || q === 3) {
    const sig = [units, 8], mainVal = p * 0.5, secVal = q * 0.5; // written values in quarter units
    const mainName = durationName(mainVal), secName = durationName(secVal);
    sug.push({
      id: 'compound', title: `${units}/8: ${plural(secName, p)} against ${plural(mainName, q)}`,
      why: p === 3 ? `The main beat becomes a dotted quarter (${q} per bar) and the second layer plain ${plural(secName, 2)}: the usual "${p} over ${q}" look of ${units}/8.`
        : `Felt on the dotted quarter, the ${p}-layer is the pulse of ${units}/8 and the ${q}-layer becomes ${plural(mainName, 2)}: the "${q} over ${p}" feel.`,
      fit: p === 3 ? 0.8 : 0.7,
      staff: staffCompound(sig, cycleBeats, p, q, mainVal, secVal),
    });
  }
  // 4. hemiola (3:2 and 2:3)
  if ((p === 3 && q === 2) || (p === 2 && q === 3)) {
    sug.push({
      id: 'hemiola', title: 'Hemiola: 3/4 against 6/8',
      why: 'Three quarters across two dotted quarters. Written as alternating 6/8 and 3/4 bars, or as 3/4 with two dotted quarters in the other part.',
      fit: 0.8,
      staff: p === 3 ? staffCompound([6, 8], cycleBeats, p, q, 1.5, 1) : staffSimple([3, 4], cycleBeats, 1, p, q, { value: 1, dots: 1 }, null, [{ value: 1, dots: 1 }]),
    });
  }
  // 5. polymeter: two staves, each in its own simple meter, sharing the downbeat
  sug.push({
    id: 'polymeter', title: `Two parts: ${q}/4 at ♩ = ${Math.round(bpm)} and ${p}/4 at ♩ = ${Math.round(secondBpm)}`,
    why: `Each layer in its own meter and tempo; the bar lines meet every cycle (${q} beats of one = ${p} beats of the other).` + (differentBands ? ' The two layers were heard in different registers, so they may well be two parts.' : ''),
    fit: 0.5 + (differentBands ? 0.3 : 0),
    staff: staffPolymeter(cycleBeats, p, q),
  });
  sug.sort((a, b) => b.fit - a.fit);
  const reading = `${p} against ${q}: ${p} notes of the second layer in the time of ${q} main beats. Cycle ${q} beats = ${cycleSec.toFixed(2)} s. Second layer ${secondBpm.toFixed(1)} per minute.`;
  return { p, q, bpm, secondBpm, cycleBeats, cycleSec, units, unitBeats, grid, counting, mnemonic, suggestions: sug, reading, meter: M ? meter : `${q}/4 (cycle)`, text: asText({ p, q, bpm, secondBpm, cycleSec, grid, counting, mnemonic, suggestions: sug }) };
}

// ---- staff specs for drawing: layers of notes with real positions (main beats) and written values
function staffSimple(sig, cycleBeats, cyclesPerBar, p, q, written, tupletLabel, parts = null) {
  const barBeats = cycleBeats * cyclesPerBar;
  const main = [], second = [], tuplets = [];
  for (let b = 0; b < barBeats; b++) main.push({ t: b, value: 1, dots: 0 });
  for (let c = 0; c < cyclesPerBar; c++) {
    const from = second.length;
    for (let j = 0; j < p; j++) {
      const t = c * cycleBeats + j * q / p;
      if (parts) { // dotted / tied values
        let tt = t;
        parts.forEach((pt, i) => { second.push({ t: tt, value: pt.value, dots: pt.dots, tie: i < parts.length - 1 }); tt += pt.value * (pt.dots === 2 ? 1.75 : pt.dots ? 1.5 : 1); });
      } else second.push({ t, value: written.value, dots: written.dots });
    }
    if (tupletLabel) tuplets.push({ from, to: second.length - 1, label: tupletLabel });
  }
  return { sig, barBeats, bars: [0], layers: [{ name: 'main', notes: main }, { name: 'second', notes: second, tuplets }] };
}
function staffCompound(sig, cycleBeats, p, q, mainVal, secVal) {
  const main = [], second = [];
  for (let b = 0; b < q; b++) main.push({ t: b, value: mainVal, dots: 0 });
  for (let j = 0; j < p; j++) second.push({ t: j * q / p, value: secVal, dots: 0 });
  // written values may be dotted (3 eighths) or tied (5 eighths): resolve for drawing
  const fix = n => { const w = writeDuration(n.value); return { ...n, value: w[0].value, dots: w[0].dots, tie: w.length > 1 }; };
  return { sig, barBeats: cycleBeats, bars: [0], layers: [{ name: 'main', notes: main.map(fix) }, { name: 'second', notes: second.map(fix) }] };
}
function staffPolymeter(cycleBeats, p, q) {
  const main = [], second = [];
  for (let b = 0; b < q; b++) main.push({ t: b, value: 1, dots: 0 });
  for (let j = 0; j < p; j++) second.push({ t: j * q / p, value: 1, dots: 0 });
  return { sig: [q, 4], sig2: [p, 4], barBeats: cycleBeats, bars: [0], layers: [{ name: 'main', notes: main }, { name: 'second', notes: second }] };
}
function asText({ p, q, bpm, secondBpm, cycleSec, grid, counting, mnemonic, suggestions }) {
  const count = counting.map(c => (c.second ? `[${c.text || '·'}]` : c.text || '·')).join(' ');
  return [
    `Polyrhythm ${p}:${q}  (${p} against ${q})`,
    `Main pulse ${bpm.toFixed(1)} BPM, second layer ${secondBpm.toFixed(1)} per minute, cycle ${q} beats = ${cycleSec.toFixed(2)} s`,
    '', grid.text, '',
    `Counting (${p} per beat, [ ] = second layer): ${count}` + (mnemonic ? `   — "${mnemonic}"` : ''),
    '', 'Ways to write it:',
    ...suggestions.map((s, i) => `${i + 1}. ${s.title}\n   ${s.why}`),
  ].join('\n');
}
