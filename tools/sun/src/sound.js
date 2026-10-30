// Listening to the Sun: its low-degree p modes (the 5-minute oscillations, ≈ 3 mHz) sped up
// 100 000× into the audible range. Ported from "The Sun, alive" (SunSim.html).
//
// Frequencies follow the asymptotic relation ν(n,l) ≈ Δν (n + l/2 + ε) − l(l+1) D₀ with
// Δν = 135.1 µHz; each mode's amplitude is an Ornstein–Uhlenbeck process (stochastic kicks from
// convection, damped with the ~3.7-day mode lifetime -> ~3 s after the speed-up).
import { rng } from './active.js';

const R = rng(31);
const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };

export const K = 1e5;   // speed-up factor
export const DNU = 135.1, NUMAX = 3090;

function buildModes() {
  const eps = 1.42, D0 = 1.5, sig = 420;
  const vis = [1, 1.45, 0.55, 0.06];           // relative visibility of degrees l = 0..3
  const out = [];
  for (let n = 14; n <= 30; n++) for (let l = 0; l <= 3; l++) {
    const nu = DNU * (n + l / 2 + eps) - l * (l + 1) * D0;
    const env = Math.exp(-((nu - NUMAX) ** 2) / (2 * sig * sig)) * vis[l];
    if (env > 0.03) out.push({ n, l, nu, env, a: gauss() * 0.5, g: null });
  }
  return out;
}

export function createSound() {
  const st = { on: false, ctx: null, master: null, modes: buildModes(), timer: 0 };

  function start() {
    if (!st.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      st.ctx = new Ctx();
      st.master = st.ctx.createGain(); st.master.gain.value = 0;
      const comp = st.ctx.createDynamicsCompressor();
      const lp = st.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      st.master.connect(lp); lp.connect(comp); comp.connect(st.ctx.destination);
      for (const m of st.modes) {
        const o = st.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = m.nu * 1e-6 * K;
        const g = st.ctx.createGain(); g.gain.value = 0;
        const pan = st.ctx.createStereoPanner ? st.ctx.createStereoPanner() : null;
        if (pan) { pan.pan.value = [0, -0.5, 0.5, 0][m.l]; o.connect(g); g.connect(pan); pan.connect(st.master); }
        else { o.connect(g); g.connect(st.master); }
        o.start(); m.g = g;
      }
    }
    st.ctx.resume();
    st.master.gain.setTargetAtTime(0.16, st.ctx.currentTime, 0.4);
    st.on = true;
    return true;
  }
  function stop() {
    if (!st.ctx) return;
    st.master.gain.setTargetAtTime(0, st.ctx.currentTime, 0.2);
    st.on = false;
  }
  function tick(dt) {
    if (!st.on || !st.ctx) return;
    st.timer += dt; if (st.timer < 0.1) return;
    const h = st.timer; st.timer = 0;
    const tau = 3.7 * 86400 / K, dec = Math.exp(-h / tau), kick = Math.sqrt(1 - dec * dec);
    for (const m of st.modes) {
      m.a = m.a * dec + kick * gauss() * 0.6;
      m.g.gain.setTargetAtTime(Math.abs(m.a) * m.env * 0.11, st.ctx.currentTime, 0.08);
    }
  }

  // the live power spectrum: a comb of modes, Δν apart, colour-coded by degree l
  const COLS = ['#ff6a4d', '#ffc24d', '#5fd0ff', '#c58cff'];
  function draw(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const f0 = 2000, f1 = 4300, bx = 12, bw = w - 24, by = h - 22, bh = h - 70;
    for (const m of st.modes) {
      const x = bx + (m.nu - f0) / (f1 - f0) * bw; if (x < bx || x > bx + bw) continue;
      const a = Math.min(1, Math.abs(m.a) * m.env * 1.3);
      c.strokeStyle = COLS[m.l]; c.lineWidth = 2; c.beginPath(); c.moveTo(x, by); c.lineTo(x, by - a * bh); c.stroke();
    }
    c.strokeStyle = 'rgba(255,230,200,.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + bw, by); c.stroke();
    c.font = '10.5px system-ui,sans-serif'; c.fillStyle = '#b7aa92'; c.textAlign = 'center';
    for (let f = 2000; f <= 4250; f += 500) c.fillText(String(f), bx + (f - f0) / (f1 - f0) * bw, by + 13);
    c.textAlign = 'left'; c.fillStyle = '#f3ead8';
    c.fillText(`p-mode power spectrum (µHz)  ×10⁵ → ${Math.round(NUMAX * 1e-6 * K)} Hz`, 10, 15);
    c.fillStyle = '#8f8577'; c.fillText(`comb spacing Δν = ${DNU} µHz ∝ √(mean density)`, 10, 29);
    ['degree l = 0', '1', '2', '3'].forEach((t, i) => { c.fillStyle = COLS[i]; c.fillText(t, 10 + (i ? 52 + i * 22 : 0), 43); });
  }

  return { start, stop, tick, draw, isOn: () => st.on };
}
