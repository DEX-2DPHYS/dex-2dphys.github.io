/* Photo Synth — audio worklet engine.
 *
 * A monophonic virtual-analog voice: two PolyBLEP oscillators that morph from
 * sine through triangle to saw/pulse, gently detuned and drifting, feeding a
 * zero-delay-feedback Moog ladder filter with a saturating core. Everything
 * runs at 2x the context rate and is decimated back down, so the waveshaping
 * and the resonant filter stay clean instead of folding aliases into the tone.
 *
 * Parameters arrive as messages, either immediately ({type:"params"}) or
 * scheduled on an absolute sample frame ({type:"events"}), which is what makes
 * an offline MIDI render come out identical every time.
 */
"use strict";

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

/* Band-limited step: removes the discontinuity of a naive saw/pulse. */
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/* One ladder stage set: four TPT one-poles inside a resolved feedback loop. */
function Ladder() {
  this.z = new Float64Array(4);
}
Ladder.prototype.reset = function () { this.z.fill(0); };
Ladder.prototype.process = function (x, g, k, mode, dk, dnorm) {
  var G = g / (1 + g), z = this.z;
  // The part of the fourth-stage output that does not depend on this sample.
  var S = (((z[0] * G + z[1]) * G + z[2]) * G + z[3]) / (1 + g);
  var G4 = G * G * G * G;
  var u = (x - k * S) / (1 + k * G4);
  // Saturating core: the reason a real ladder thickens instead of clipping.
  // Normalised by tanh(dk) so turning drive up thickens the sound without
  // changing how loud it is.
  var inp = Math.tanh(u * dk) * dnorm;
  var v, y1, y2, y3, y4;
  v = (inp - z[0]) * G; y1 = v + z[0]; z[0] = y1 + v;
  v = (y1 - z[1]) * G; y2 = v + z[1]; z[1] = y2 + v;
  v = (y2 - z[2]) * G; y3 = v + z[2]; z[2] = y3 + v;
  v = (y3 - z[3]) * G; y4 = v + z[3]; z[3] = y4 + v;
  if (mode === 0) return y4;                                  // 24 dB low-pass
  if (mode === 1) return 4 * y2 - 8 * y3 + 4 * y4;            // band-pass
  return inp - 4 * y1 + 6 * y2 - 4 * y3 + y4;                 // high-pass
};

var OS = 2;                       // oversampling factor
var OSC_GAIN = 0.75;              // gain staging into the ladder
var OUT_GAIN = 0.52;              // and back out of it

class VoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.fs = sampleRate * OS;
    this.p = {
      base: 220, ratio: 1, morph: 0.5, pulse: 0, detune: 6, level: 0,
      cut: 14000, res: 0, mode: 0, drive: 0.25,
      attack: 0.012, release: 0.18, glide: 0.03, spread: 0.5
    };
    this.f0 = 220; this.morph = 0.5; this.pulse = 0; this.detune = 6;
    this.level = 0; this.cut = 14000; this.res = 0;
    this.gate = 0; this.env = 0;
    this.phA = 0; this.phB = 0.37;
    this.triA = 0; this.triB = 0;
    this.driftA = 0; this.driftB = 0;
    this.lfo = 0;
    this.lad = [new Ladder(), new Ladder()];
    this.dz = [0, 0];
    this.events = [];
    this.port.onmessage = this.onmsg.bind(this);

    // Anything handed over in processorOptions is in place before the first
    // block. An OfflineAudioContext can finish rendering before a postMessage
    // is ever delivered, so a render passes its whole schedule in here.
    var o = (options && options.processorOptions) || {}, k;
    if (o.params) {
      for (k in o.params) { if (k === "gate") this.gate = o.params[k]; else this.p[k] = o.params[k]; }
    }
    if (o.events && o.events.length) {
      this.events = o.events.slice().sort(function (a, b) { return a.frame - b.frame; });
    }
  }

  onmsg(e) {
    var d = e.data;
    if (d.type === "params") {
      var k;
      for (k in d.p) { if (k === "gate") this.gate = d.p[k]; else this.p[k] = d.p[k]; }
    } else if (d.type === "events") {
      this.events = this.events.concat(d.ev);
      this.events.sort(function (a, b) { return a.frame - b.frame; });
    } else if (d.type === "clear") {
      this.events.length = 0;
    } else if (d.type === "reset") {
      this.env = 0; this.gate = 0;
      this.lad[0].reset(); this.lad[1].reset();
      this.phA = 0; this.phB = 0.37; this.triA = this.triB = 0;
    }
  }

  process(inputs, outputs) {
    var out = outputs[0];
    if (!out || !out.length) return true;
    var L = out[0], R = out.length > 1 ? out[1] : out[0], n = L.length;
    var fs = this.fs, p = this.p, i, k;

    // Per-block coefficients: parameter smoothing and the analogue wobble.
    var aSmooth = 1 - Math.exp(-1 / (0.006 * sampleRate));
    var glide = Math.max(0.0015, p.glide);
    var aGlide = 1 - Math.exp(-1 / (glide * sampleRate));
    this.driftA = clamp(this.driftA * 0.9985 + (Math.random() - 0.5) * 0.02, -1, 1);
    this.driftB = clamp(this.driftB * 0.9985 + (Math.random() - 0.5) * 0.02, -1, 1);
    this.lfo += 6.2831853 * 0.11 * n / sampleRate;
    if (this.lfo > 6.2831853) this.lfo -= 6.2831853;
    var pwm = 0.5 - 0.055 * Math.sin(this.lfo) * this.morph;
    var dk = 1 + clamp(p.drive, 0, 1) * 3.2, dnorm = 1 / Math.tanh(dk);

    // Stereo: the two oscillators lean to opposite sides, so their detune
    // opens the image up instead of just beating in the middle.
    var spread = clamp(p.spread, 0, 1);
    var lA = 0.5 + 0.25 * spread, lB = 0.5 - 0.25 * spread;

    for (i = 0; i < n; i++) {
      // ---- scheduled events (sample-accurate, used by the offline render) --
      var frame = currentFrame + i;
      while (this.events.length && this.events[0].frame <= frame) {
        var ev = this.events.shift();
        if (ev.p) { for (k in ev.p) p[k] = ev.p[k]; }
  
        if (ev.gate !== undefined) this.gate = ev.gate;
      }

      // ---- parameter smoothing ------------------------------------------
      this.f0 += (p.base * p.ratio - this.f0) * aGlide;
      this.morph += (p.morph - this.morph) * aSmooth;
      this.pulse += (p.pulse - this.pulse) * aSmooth;
      this.detune += (p.detune - this.detune) * aSmooth;
      this.level += (p.level - this.level) * aSmooth;
      this.cut += (p.cut - this.cut) * aSmooth;
      this.res += (p.res - this.res) * aSmooth;

      // ---- envelope -------------------------------------------------------
      var tau = this.gate ? Math.max(0.001, p.attack) / 3 : Math.max(0.004, p.release) / 3;
      this.env += ((this.gate ? 1 : 0) - this.env) * (1 - Math.exp(-1 / (tau * sampleRate)));

      // ---- oscillator + filter, run at 2x -------------------------------
      var det = this.detune / 1200;
      var fA = this.f0 * Math.pow(2, (this.driftA * 3.5 - det * 600) / 1200);
      var fB = this.f0 * Math.pow(2, (this.driftB * 3.5 + det * 600) / 1200);
      var dtA = clamp(fA / fs, 1e-7, 0.45);
      var dtB = clamp(fB / fs, 1e-7, 0.45);
      var g = Math.tan(Math.PI * clamp(this.cut, 18, fs * 0.45) / fs);
      var kres = 3.85 * clamp(this.res, 0, 1);
      var mode = p.mode | 0;
      // Resonance drains the low end of a ladder; feed it a little harder and
      // trim the output so the level stays put as the filter opens up.
      var inGain = OSC_GAIN * (1 + 0.25 * kres), outGain = OUT_GAIN / (1 + 0.3 * kres);
      var sl = 0, sr = 0, j;

      for (j = 0; j < OS; j++) {
        this.phA += dtA; if (this.phA >= 1) this.phA -= 1;
        this.phB += dtB; if (this.phB >= 1) this.phB -= 1;

        var a = this.shape(this.phA, dtA, pwm, "A");
        var b = this.shape(this.phB, dtB, pwm, "B");

        var xl = (a * lA + b * lB) * this.level * inGain;
        var xr = (a * lB + b * lA) * this.level * inGain;
        var yl = this.lad[0].process(xl, g, kres, mode, dk, dnorm) * outGain;
        var yr = this.lad[1].process(xr, g, kres, mode, dk, dnorm) * outGain;

        // 3-tap decimation FIR across the oversampled stream
        if (j === 0) { sl = 0.25 * this.dz[0] + 0.5 * yl; sr = 0.25 * this.dz[1] + 0.5 * yr; }
        else { sl += 0.25 * yl; sr += 0.25 * yr; this.dz[0] = yl; this.dz[1] = yr; }
      }

      var e = this.env * this.env * (3 - 2 * this.env);       // smoothstep envelope
      L[i] = clamp(sl * e, -1.4, 1.4);
      R[i] = clamp(sr * e, -1.4, 1.4);
    }
    return true;
  }

  /* sine -> triangle -> (saw / pulse) morph, band-limited. */
  shape(ph, dt, pw, which) {
    var m = clamp(this.morph, 0, 1);
    var sine = Math.sin(6.2831853 * ph);

    // Band-limited square, integrated into a triangle.
    var sq = (ph < pw ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 1 - pw) % 1, dt);
    var tri = which === "A" ? this.triA : this.triB;
    tri += 4 * dt * sq;
    tri *= 0.9995;
    if (which === "A") this.triA = tri; else this.triB = tri;

    var saw = 2 * ph - 1 - polyBlep(ph, dt);
    var pulsed = sq * 0.6;
    var bright = saw * (1 - this.pulse) + pulsed * this.pulse;

    return m < 0.5 ? sine + (tri - sine) * (m * 2)
                   : tri + (bright - tri) * ((m - 0.5) * 2);
  }
}

/* Capture processor: hands raw float blocks back for lossless WAV export. */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.size = 8192;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.fill = 0;
    this.port.onmessage = function (e) {
      if (e.data.on !== undefined) {
        if (e.data.on && !this.on) this.fill = 0;
        if (!e.data.on && this.on) this.flush();
        this.on = e.data.on;
      }
    }.bind(this);
  }
  flush() {
    if (!this.fill) return;
    var l = this.l.slice(0, this.fill), r = this.r.slice(0, this.fill);
    this.port.postMessage({ l: l, r: r }, [l.buffer, r.buffer]);
    this.fill = 0;
  }
  process(inputs) {
    var inp = inputs[0];
    if (!this.on || !inp || !inp.length) return true;
    var L = inp[0], R = inp.length > 1 ? inp[1] : inp[0], n = L.length, i;
    for (i = 0; i < n; i++) {
      this.l[this.fill] = L[i];
      this.r[this.fill] = R[i];
      this.fill++;
      if (this.fill === this.size) this.flush();
    }
    return true;
  }
}

registerProcessor("photo-synth-voice", VoiceProcessor);
registerProcessor("photo-synth-recorder", RecorderProcessor);
