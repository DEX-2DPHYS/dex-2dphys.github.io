// Sound Wizard: a small synthetic piano, for hearing a chord to compare with the one being played.
// Additive: each note is a few partials with slight stretch (the stiffness of real strings), the higher
// partials dying faster than the fundamental, a short soft hammer, and a gentle low-pass; the notes
// of a chord start a few ms apart, like a rolled chord. Works on any AudioContext (also an offline one).

// the notes of a detected chord: the bass (root, or the slash bass) low, the root and the other tones
// above it as a close root-position voicing starting between G3 and F♯4
export function chordVoicing(root, tones, bass = -1) {
  const out = [], pcs = tones && tones.length ? tones : [root];
  const bassPc = bass >= 0 && pcs.includes(bass) ? bass : root;
  out.push(36 + bassPc);                       // C2–B2: the bass
  // the root first (G3–F♯4), then each other tone in chord order, each the next one above the last
  let m = 55 + (((root - 55) % 12) + 12) % 12;
  const hi = [m];
  for (const pc of pcs.filter(t => t !== root).sort((x, y) => ((x - root + 12) % 12) - ((y - root + 12) % 12))) {
    m += 1; while (((m % 12) + 12) % 12 !== pc) m++;
    hi.push(m);
  }
  return [out[0], ...hi];
}

export function playChord(ctx, midis, { a4 = 440, level = 0.22, when = null, dest = null, dur = 3.2 } = {}) {
  const t0 = when ?? ctx.currentTime + 0.03;
  const out = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.4;
  const norm = level / Math.sqrt(midis.length);
  out.gain.setValueAtTime(norm, t0);
  out.gain.setTargetAtTime(0, t0 + dur - 0.5, 0.18);
  out.connect(lp); lp.connect(dest || ctx.destination);
  const stop = t0 + dur + 0.4;
  midis.forEach((m, i) => {
    const f0 = a4 * Math.pow(2, (m - 69) / 12), t = t0 + i * 0.011;
    const decay = 2.6 * Math.pow(2, -(m - 48) / 30) + 0.5;    // low notes ring longer
    for (let h = 1; h <= 8; h++) {
      const f = f0 * h * Math.sqrt(1 + 0.0004 * h * h);
      if (f > 9000) break;
      const a = 1 / Math.pow(h, 1.15) * (h % 2 === 0 && h > 4 ? 0.7 : 1);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const tau = decay / (1 + 0.55 * (h - 1));              // higher partials die faster
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.004);            // the hammer
      g.gain.setTargetAtTime(0, t + 0.004, tau);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(stop);
    }
  });
  return { stopAt: stop };
}
