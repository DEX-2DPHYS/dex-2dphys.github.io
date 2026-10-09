// Sound Wizard: the metronome. Plays the click schedule of practice.js on an AudioContext's own clock
// (look-ahead scheduling: a timer every 25 ms schedules everything due in the next 150 ms, so the timer's
// jitter never reaches the sound). The same context is the one the microphone is captured on whenever
// listening is on, so the engine can measure the player against exactly these times.
import { clickEvents } from './practice.js?v=20261009.2302';

const VOICES = {
  accent: { f: 1568, type: 'sine', g: 1.0, d: 0.05 },
  beat: { f: 1046.5, type: 'sine', g: 0.8, d: 0.045 },
  sub: { f: 1046.5, type: 'sine', g: 0.3, d: 0.03 },
  poly: { f: 659.25, type: 'triangle', g: 0.9, d: 0.07 },
};
export class Metronome {
  constructor() { this.timer = null; this.ctx = null; this.cfg = null; this.upTo = 0; this.vol = -12; this.count = 0; }
  get running() { return !!this.timer; }
  start(ctx, cfg, volDb) {
    this.stop();
    this.ctx = ctx; this.cfg = cfg; this.vol = volDb; this.upTo = cfg.t0 - 0.001; this.count = 0;
    this.out = ctx.createGain(); this.out.gain.value = Math.pow(10, volDb / 20); this.out.connect(ctx.destination);
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }
  setVolume(db) { this.vol = db; if (this.out) this.out.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.01); }
  tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') { this.stop(); return; }
    const to = ctx.currentTime + 0.15;
    for (const e of clickEvents(this.cfg, this.upTo, to)) { this.voice(e); this.count++; }
    this.upTo = Math.max(this.upTo, to);
  }
  voice(e) {
    const v = VOICES[e.kind], ctx = this.ctx, t = Math.max(e.t, ctx.currentTime);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = v.type; o.frequency.value = v.f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v.g, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0005, t + v.d);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + v.d + 0.02);
  }
  // a short loud burst for the latency measurement, at the given context times
  bursts(ctx, times, volDb) {
    const out = ctx.createGain(); out.gain.value = Math.pow(10, volDb / 20); out.connect(ctx.destination);
    for (const t of times) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 1800;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.0005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.05);
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.out && this.out.disconnect(); } catch { /* the context may be gone */ }
    this.out = null;
  }
}
