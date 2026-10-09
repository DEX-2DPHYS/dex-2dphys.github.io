// Sound Wizard: the page. Starts the microphone (inside the tap, as iPhones require), hands the audio
// and the views' canvases to the analysis worker, and runs the controls. Everything that moves on screen
// is drawn by the engine (engine.js); this file only touches the DOM.
import { DEFAULTS, TUNINGS, parseTuning, midiName } from './engine.js?v=20261009.1712';
import { CMAP_NAMES } from './dsp.js?v=20261009.1712';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const KEY = 'soundwizard.settings.v1';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: settings last this visit */ } },
};
const S = { ...DEFAULTS, ...store.get() };
if (S.tuning === 'chromatic') S.tuning = 'free'; // renamed
if (!Array.isArray(S.custom)) S.custom = [];
const save = () => store.set(S);

// ------------------------------------------------------------------------------------ controls
const hz = f => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
const CONTROLS = {
  meter: [
    { key: 'weight', label: 'Weighting', type: 'seg', options: [['A', 'A'], ['C', 'C'], ['Z', 'Flat']] },
    { key: 'tw', label: 'Response', type: 'seg', options: [['fast', 'Fast'], ['slow', 'Slow']] },
    { key: 'unit', label: 'Unit', type: 'seg', options: [['dbfs', 'dBFS'], ['spl', 'dB SPL']] },
    { type: 'buttons', items: [['calibrate', 'Calibrate…'], ['reset', 'Reset min/max/Leq']] },
    { type: 'note', text: 'dBFS is measured against the microphone\'s full scale. dB SPL needs one calibration against a real sound level meter (or a known source); until then it is an estimate.' },
  ],
  spec: [
    { key: 'layout', label: 'Show', type: 'seg', options: [['both', 'Both'], ['wf', 'Waterfall'], ['line', 'Spectrum']] },
    { key: 'fft', label: 'FFT size', type: 'select', num: true, options: [512, 1024, 2048, 4096, 8192, 16384, 32768].map(n => [n, String(n)]) },
    { key: 'speed', label: 'Speed', type: 'select', num: true, options: [15, 30, 60, 120, 240].map(n => [n, `${n} rows/s`]) },
    { key: 'gain', label: 'Gain', type: 'range', min: -20, max: 80, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v} dB` },
    { key: 'range', label: 'Range', type: 'range', min: 30, max: 150, step: 5, fmt: v => `${v} dB` },
    { key: 'scale', label: 'Frequency', type: 'seg', options: [['log', 'Log'], ['lin', 'Linear']] },
    { key: 'fmin', label: 'From', type: 'select', num: true, options: [10, 20, 50, 100, 200, 500, 1000, 2000].map(f => [f, hz(f)]) },
    { key: 'fmax', label: 'To', type: 'select', num: true, options: [500, 1000, 2000, 4000, 5000, 8000, 10000, 16000, 20000, 24000].map(f => [f, hz(f)]) },
    { key: 'cmap', label: 'Colours', type: 'select', options: Object.entries(CMAP_NAMES) },
    { key: 'hold', label: 'Peak hold', type: 'toggle' },
    { type: 'note', text: 'A larger FFT separates close frequencies better but reacts more slowly. Touch the plot to read frequency, note and level.' },
  ],
  scope: [
    { key: 'win', label: 'Window', type: 'select', num: true, options: [1, 2, 5, 10, 20, 50, 100, 200, 500].map(ms => [ms, `${ms} ms`]) },
    { key: 'sgain', label: 'Gain', type: 'select', options: [['auto', 'Auto'], ['1', '×1'], ['2', '×2'], ['4', '×4'], ['8', '×8'], ['16', '×16'], ['64', '×64']] },
    { key: 'trig', label: 'Trigger', type: 'seg', options: [['auto', 'Rising edge'], ['free', 'Free run']] },
  ],
  tuner: [
    { key: 'tuning', label: 'Instrument', type: 'select', options: () => [...Object.entries(TUNINGS).map(([k, t]) => [k, t.name]), ...S.custom.map((c, i) => [`custom:${i}`, `★ ${c.name}`])] },
    { key: 'a4', label: 'A4', type: 'range', min: 415, max: 466, step: 1, fmt: v => `${v} Hz` },
    { type: 'buttons', items: [['learn', 'Learn my tuning…'], ['type', 'Type a tuning…'], ['deltuning', 'Delete this tuning']] },
    { type: 'note', text: 'Free finds any note by itself. With an instrument: tap a string to lock onto it (again to let go), otherwise it follows the nearest string. The strobe stands still when in tune; the words say what to do, and while you turn the peg they coach you ("keep going", "slow down", "✓"). Each string keeps its last reading; ▼ marks the next one to tune. Tap the big note to hear the target. Learn my tuning: play each open string once, lowest first. Type a tuning: notes low to high, e.g. A1 E2 A2 D3 G3 B3 E4, or just AEADGBE.' },
  ],
  rhythm: [
    { type: 'buttons', items: [['copynotation', 'Copy the notation text']] },
    { type: 'note', text: 'Scroll the view for all of it. Tempo: the candidate pulses are the chips under the number; tap one to make it the main pulse (the polyrhythm is read against it), tap it again for automatic. Time signature: auto reads the accents; set it yourself and the notation follows. A polyrhythm is claimed only when its second layer puts sound on its own grid in most cycles and is not just a subdivision (eighths, triplets).' },
    { type: 'note', text: 'Tempo comes from the onsets (where new sound starts) over the last ~10 s: give it a few bars. Tap the tempo box in time for tap tempo. Repetition rate: how often the loudness repeats (engines, insects, tremolo, a ticking clock). Main frequencies: the strongest tones of the last two seconds.' },
  ],
  tone: [
    { key: 'a4', label: 'A4', type: 'range', min: 415, max: 466, step: 1, fmt: v => `${v} Hz` },
    { type: 'note', text: 'Base note: the fundamental of a single note (or the root when several notes sound). Chord: from the last half second. Key: from the last few seconds, so let a phrase play. Harmonics: the overtones of the base note, odd ones cyan, even ones magenta.' },
  ],
};

function buildControls() {
  for (const [view, list] of Object.entries(CONTROLS)) {
    const sheet = $(`.view[data-view="${view}"] .sheet`);
    if (!sheet) continue;
    sheet.innerHTML = '';
    for (const c of list) {
      const row = document.createElement('div');
      row.className = 'row';
      if (c.type === 'note') { row.className = 'note'; row.textContent = c.text; sheet.appendChild(row); continue; }
      if (c.type === 'buttons') {
        row.classList.add('btns');
        for (const [act, label] of c.items) {
          const b = document.createElement('button');
          b.className = 'act'; b.textContent = label; b.dataset.act = act;
          b.addEventListener('click', () => action(act));
          row.appendChild(b);
        }
        sheet.appendChild(row); continue;
      }
      const lab = document.createElement('label');
      lab.textContent = c.label;
      row.appendChild(lab);
      if (c.type === 'seg') {
        const seg = document.createElement('div');
        seg.className = 'seg'; seg.dataset.key = c.key;
        for (const [val, text] of (typeof c.options === 'function' ? c.options() : c.options)) {
          const b = document.createElement('button');
          b.textContent = text; b.dataset.val = val;
          b.addEventListener('click', () => setSetting(c.key, val));
          seg.appendChild(b);
        }
        row.appendChild(seg);
      } else if (c.type === 'select') {
        const sel = document.createElement('select');
        sel.dataset.key = c.key;
        for (const [val, text] of (typeof c.options === 'function' ? c.options() : c.options)) sel.add(new Option(text, val));
        sel.addEventListener('change', () => setSetting(c.key, c.num ? +sel.value : sel.value));
        row.appendChild(sel);
      } else if (c.type === 'range') {
        const r = document.createElement('input');
        r.type = 'range'; r.min = c.min; r.max = c.max; r.step = c.step; r.dataset.key = c.key;
        const out = document.createElement('span');
        out.className = 'val';
        r.addEventListener('input', () => { out.textContent = c.fmt(+r.value); setSetting(c.key, +r.value, false); });
        r._fmt = c.fmt; r._out = out;
        row.append(r, out);
      } else if (c.type === 'toggle') {
        const t = document.createElement('button');
        t.className = 'toggle'; t.dataset.key = c.key;
        t.addEventListener('click', () => setSetting(c.key, !S[c.key]));
        row.appendChild(t);
      }
      sheet.appendChild(row);
    }
  }
  syncControls();
}
function syncControls() {
  for (const seg of $$('.seg[data-key]')) for (const b of seg.children) b.classList.toggle('on', String(S[seg.dataset.key]) === b.dataset.val);
  for (const sel of $$('select[data-key]')) sel.value = String(S[sel.dataset.key]);
  for (const r of $$('input[type=range][data-key]')) { r.value = S[r.dataset.key]; r._out.textContent = r._fmt(+r.value); }
  for (const t of $$('.toggle[data-key]')) { t.classList.toggle('on', !!S[t.dataset.key]); t.textContent = S[t.dataset.key] ? 'On' : 'Off'; }
}
function setSetting(key, value, resync = true) {
  S[key] = value;
  save();
  send({ type: 'set', key, value });
  if (resync) syncControls();
}
function saveCustom(name, strings) {
  S.custom = [...S.custom, { name: String(name).slice(0, 40) || 'My tuning', strings }];
  setSetting('custom', S.custom);
  setSetting('tuning', `custom:${S.custom.length - 1}`);
  buildControls();
}
function action(act) {
  if (act === 'reset') send({ type: 'reset' });
  if (act === 'copynotation') {
    window.soundWizard.stats().then(st => {
      const t = st && st.rhythm && st.rhythm.notation && st.rhythm.notation.text;
      if (!t) { alert('No polyrhythm to describe at the moment.'); return; }
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => alert('Copied.'), () => prompt('Copy this:', t));
    });
  }
  if (act === 'learn') {
    for (const sh of $$('.sheet.open')) { sh.classList.remove('open'); sh.parentElement.querySelector('.gear').classList.remove('on'); }
    send({ type: 'learnStart' });
  }
  if (act === 'type') {
    const v = prompt('Your tuning, lowest string first: notes with octaves (A1 E2 A2 D3 G3 B3 E4) or just letters (AEADGBE, DADGAD; the lowest string is then put between A1 and G♯2).', '');
    if (v == null) return;
    const m = parseTuning(v);
    if (!m) { alert('That was not read as notes. Example: A1 E2 A2 D3 G3 B3 E4, or AEADGBE.'); return; }
    const strings = m.map(midiName);
    const name = prompt(`${strings.join(' ')}\nA name for this tuning:`, v.trim().length <= 12 ? v.trim() : 'My tuning');
    if (name != null) saveCustom(name, strings);
  }
  if (act === 'deltuning') {
    if (!String(S.tuning).startsWith('custom:')) { alert('Only your own tunings (★) can be deleted.'); return; }
    const i = +S.tuning.slice(7), c = S.custom[i];
    if (!c || !confirm(`Delete the tuning "${c.name}"?`)) return;
    S.custom = S.custom.filter((_, j) => j !== i);
    setSetting('custom', S.custom);
    setSetting('tuning', 'free');
    buildControls();
  }
  if (act === 'calibrate') {
    const v = prompt('Calibrate: play a steady sound and type what a sound level meter shows for it (in dB, with the same weighting).', '');
    const n = parseFloat(String(v || '').replace(',', '.'));
    if (isFinite(n)) send({ type: 'calibrate', value: n });
  }
}

// --------------------------------------------------------------------------------------- views
function showView(view) {
  S.view = view; save();
  for (const s of $$('.view')) s.classList.toggle('on', s.dataset.view === view);
  for (const b of $$('#tabs button')) b.classList.toggle('on', b.dataset.view === view);
  send({ type: 'set', key: 'view', value: view });
  sendSize($(`.view[data-view="${view}"] canvas`));
}
for (const b of $$('#tabs button')) b.addEventListener('click', () => showView(b.dataset.view));
for (const g of $$('.gear')) g.addEventListener('click', () => { const sh = g.parentElement.querySelector('.sheet'); sh.classList.toggle('open'); g.classList.toggle('on', sh.classList.contains('open')); });

// canvas sizes (CSS px; the engine multiplies by the pixel ratio, capped at 2: a 3× iPhone screen
// would cost 2.25× the drawing for detail the eye cannot use at this size)
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
const sizeOf = cv => ({ id: cv.dataset.id, w: cv.clientWidth, h: cv.clientHeight, dpr: DPR() });
function sendSize(cv) { if (cv && cv.clientWidth) send({ type: 'resize', ...sizeOf(cv) }); }
const ro = new ResizeObserver(entries => { for (const e of entries) sendSize(e.target); });
for (const cv of $$('canvas.cv')) ro.observe(cv);

// touch / mouse position for the readouts
for (const cv of $$('canvas.cv')) {
  const id = cv.dataset.id;
  const at = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); send({ type: 'pointer', id, active: true, down: true, ...at(e) }); });
  cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') send({ type: 'pointer', id, active: true, ...at(e) }); });
  const end = () => send({ type: 'pointer', id, active: false });
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') end(); });
}

// ---------------------------------------------------------------------------- engine and audio
let worker = null, eng = null, mode = '', engineStarted = false;
let ac = null, stream = null, node = null, running = false, wakeLock = null;
function send(msg, transfer) {
  if (worker) worker.postMessage(msg, transfer || []);
  else if (eng) eng.message(msg);
}
function onEngine(d) {
  if (d.type === 'load') {
    $('#status').textContent = `${(ac?.sampleRate || 0) / 1000} kHz · ${d.fps} fps · ${Math.round(d.load * 100)}% load`;
    $('#status').title = mode === 'worker' ? 'Analysis and drawing run in a background worker' : 'Analysis runs on the page (this browser cannot draw from a worker)';
  }
  if (d.type === 'saved') { Object.assign(S, d.settings); save(); syncControls(); }
  if (d.type === 'learned') {
    setTimeout(() => { // after the tap that ended it
      const name = prompt(`Heard: ${d.strings.join(' ')}\nA name for this tuning:`, 'My tuning');
      if (name != null) saveCustom(name, d.strings);
    }, 50);
  }
  if (d.type === 'ref') refTone(d.midi);
  if (d.type === 'stats' && statsWait.has(d.id)) { statsWait.get(d.id)(d.stats); statsWait.delete(d.id); }
}
const statsWait = new Map();
let statsId = 0;

async function startEngine(sr) {
  if (engineStarted) return;
  engineStarted = true;
  const canvases = $$('canvas.cv');
  if ('transferControlToOffscreen' in HTMLCanvasElement.prototype && typeof Worker !== 'undefined') {
    try {
      const wk = new Worker('js/worker.js?v=20261009.1712', { type: 'module' });
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('worker did not start')), 5000);
        wk.onmessage = e => { if (e.data.type === 'ready') { clearTimeout(t); res(); } };
        wk.onerror = ev => { clearTimeout(t); rej(ev); };
      });
      worker = wk;
    } catch { worker = null; }
  }
  if (worker) {
    mode = 'worker';
    const offs = {}, transfer = [];
    for (const cv of canvases) { const o = cv.transferControlToOffscreen(); offs[cv.dataset.id] = o; transfer.push(o); }
    worker.onmessage = e => onEngine(e.data);
    worker.postMessage({ type: 'init', sr, settings: S, canvases: offs, sizes: canvases.filter(c => c.clientWidth).map(sizeOf) }, transfer);
  } else {
    mode = 'page';
    const { Engine } = await import('./engine.js?v=20261009.1712');
    eng = new Engine(sr, S, onEngine);
    for (const cv of canvases) { eng.attach(cv.dataset.id, cv); if (cv.clientWidth) eng.message({ type: 'resize', ...sizeOf(cv) }); }
    const loop = () => { eng.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

async function start() {
  if (running) return;
  const err = $('#err');
  err.textContent = '';
  $('#startBig').classList.add('busy');
  try {
    if (!window.isSecureContext) throw Object.assign(new Error('Sound Wizard needs a secure (https) address to use the microphone.'), { name: 'Insecure' });
    // created and resumed inside the tap: iPhones only start audio from a user gesture
    ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const resumed = ac.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false,
    });
    await resumed;
    await ac.audioWorklet.addModule('js/capture.worklet.js?v=20261009.1712');
    const src = ac.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ac, 'sound-wizard-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const mute = ac.createGain();
    mute.gain.value = 0; // the worklet only runs when connected to the output; nothing is played
    src.connect(node); node.connect(mute); mute.connect(ac.destination);
    await startEngine(ac.sampleRate);
    if (worker) {
      const ch = new MessageChannel();
      node.port.postMessage({ port: ch.port1 }, [ch.port1]);
      worker.postMessage({ type: 'port', port: ch.port2 }, [ch.port2]);
    } else {
      node.port.onmessage = e => eng.push(e.data);
    }
    ac.onstatechange = () => { if (running && ac.state !== 'running') showResume(); };
    running = true;
    send({ type: 'pause', on: false });
    $('#overlay').hidden = true;
    $('#power').classList.add('on');
    keepAwake();
  } catch (e) {
    running = false;
    const msg = e.name === 'NotAllowedError' ? 'The microphone was not allowed. iPhone: Settings → Safari → Microphone (or the aA menu → Website Settings). Android: the lock icon by the address → Permissions. Then tap again.'
      : e.name === 'NotFoundError' ? 'No microphone found.'
      : e.message || String(e);
    err.textContent = msg;
    try { stream?.getTracks().forEach(t => t.stop()); ac?.close(); } catch { /* already gone */ }
  }
  $('#startBig').classList.remove('busy');
}
function stop() {
  running = false;
  try { stream?.getTracks().forEach(t => t.stop()); } catch { /* */ }
  try { ac?.close(); } catch { /* */ }
  ac = null; stream = null; node = null;
  $('#power').classList.remove('on');
  $('#overlay').hidden = false;
  $('#startBig').querySelector('span').textContent = 'Tap to listen';
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
}
function showResume() {
  $('#overlay').hidden = false;
  $('#startBig').querySelector('span').textContent = 'Tap to continue';
}
async function resume() {
  if (ac && ac.state !== 'running') { try { await ac.resume(); } catch { /* */ } }
  if (ac && ac.state === 'running') { $('#overlay').hidden = true; keepAwake(); return true; }
  return false;
}
async function keepAwake() {
  try { if ('wakeLock' in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed: fine */ }
}

// ---------------------------------------------------------------------------------- full screen
// Android/desktop: full screen at the Start tap (it needs a tap), and the ⤢ button in the top bar
// toggles it, so the way out is always visible. iPhone Safari has no full-screen mode for pages: there
// the app is full screen when added to the home screen (a one-time hint says how).
const root = document.documentElement;
// available when the browser has the call at all (as Sleeper Agent does it): some iPhones report full
// screen as not enabled and still allow it from a tap; whether it worked is checked afterwards
const fsAvailable = !!(root.requestFullscreen || root.webkitRequestFullscreen);
let fsFailed = false;
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFs() {
  try {
    const r = (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
    r?.catch?.(() => { fsFailed = true; });
  } catch { fsFailed = true; }
  setTimeout(() => { if (!isFs()) fsFailed = true; }, 700);
}
function exitFs() { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {}); } catch { /* */ } }
const fsBtn = $('#fs');
fsBtn.hidden = !fsAvailable || standalone;
fsBtn.addEventListener('click', () => (isFs() ? exitFs() : enterFs()));
const syncFs = () => fsBtn.classList.toggle('on', isFs());
document.addEventListener('fullscreenchange', syncFs);
document.addEventListener('webkitfullscreenchange', syncFs);
function iosHint() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let seen = false;
  try { seen = localStorage.getItem('soundwizard.hint.a2hs') === '1'; } catch { /* */ }
  if (!ios || standalone || seen || (fsAvailable && !fsFailed)) return;
  $('#hint').hidden = false;
}
$('#hint button').addEventListener('click', () => { $('#hint').hidden = true; try { localStorage.setItem('soundwizard.hint.a2hs', '1'); } catch { /* */ } });

$('#startBig').addEventListener('click', async () => {
  if (S.autoFs && fsAvailable && !standalone && !isFs()) enterFs(); // inside the tap, before anything waits
  if (running && await resume()) return;
  if (running) stop();
  await start();
  if (running) setTimeout(iosHint, 900); // after the full-screen attempt has had its chance
});
$('#power').addEventListener('click', () => (running ? stop() : start()));

// ---------------------------------------------------------------------------------- tone generator
// Its own AudioContext (works with or without the microphone; the analyser tabs can listen to it).
// Band-limited Web Audio oscillators; 15 ms ramps on start, stop and level so nothing clicks.
const G = { ctx: null, osc: null, gain: null, playing: false };
const genFreq = () => (S.genMode === 'note' ? S.a4 * Math.pow(2, (S.genMidi - 69) / 12) : S.genHz);
const dbGain = db => Math.pow(10, db / 20);
let unlocked = false;
function iosUnlock() {
  // iPhones play Web Audio through the "ambient" session, which the silent switch mutes. A looping,
  // silent <audio> element started from a tap moves the page to the "playback" session.
  if (unlocked) return;
  unlocked = true;
  try {
    const n = 4800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    const a = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
    a.loop = true; a.setAttribute('playsinline', ''); a.play().catch(() => {});
    G.silent = a;
  } catch { /* fine without */ }
}
// a 2.5 s sine of the tuner's target note, through the generator's audio context
function refTone(midi) {
  iosUnlock();
  if (!G.ctx) G.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  G.ctx.resume();
  const t = G.ctx.currentTime, o = G.ctx.createOscillator(), g = G.ctx.createGain();
  o.frequency.value = S.a4 * Math.pow(2, (midi - 69) / 12);
  g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(dbGain(-20), t, 0.02); g.gain.setTargetAtTime(0, t + 2.3, 0.08);
  o.connect(g).connect(G.ctx.destination); o.start(t); o.stop(t + 2.8);
  G.lastRef = { midi, at: performance.now() };
}
function genStart() {
  iosUnlock();
  if (!G.ctx) G.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  G.ctx.resume();
  const t = G.ctx.currentTime;
  G.osc = G.ctx.createOscillator();
  G.osc.type = S.genWave;
  G.osc.frequency.setValueAtTime(genFreq(), t);
  G.gain = G.ctx.createGain();
  G.gain.gain.setValueAtTime(0, t);
  G.gain.gain.setTargetAtTime(dbGain(S.genLevel), t, 0.015);
  G.osc.connect(G.gain).connect(G.ctx.destination);
  G.osc.start(t);
  G.playing = true;
  genSync();
}
function genStop() {
  if (!G.playing) return;
  const t = G.ctx.currentTime, osc = G.osc;
  G.gain.gain.setTargetAtTime(0, t, 0.015);
  osc.stop(t + 0.12);
  G.playing = false;
  genSync();
}
function genApply() {
  if (G.playing) {
    const t = G.ctx.currentTime;
    G.osc.frequency.setTargetAtTime(genFreq(), t, 0.008);
    if (G.osc.type !== S.genWave) G.osc.type = S.genWave;
    G.gain.gain.setTargetAtTime(dbGain(S.genLevel), t, 0.015);
  }
  genSync();
}
const NOTE_N = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const midiLabel = m => `${NOTE_N[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
function genSync() {
  const f = genFreq(), midi = 69 + 12 * Math.log2(f / S.a4), n = Math.round(midi), ct = Math.round((midi - n) * 100);
  $('#genMain').textContent = S.genMode === 'note' ? midiLabel(S.genMidi) : (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 2 : 3)} kHz` : `${f.toFixed(f < 100 ? 2 : 1)} Hz`);
  $('#genSub').textContent = S.genMode === 'note' ? `${f.toFixed(2)} Hz` : `nearest note ${midiLabel(n)} ${ct > 0 ? '+' : ct < 0 ? '−' : '±'}${Math.abs(ct)}¢`;
  $('#genNoteUI').hidden = S.genMode !== 'note';
  $('#genFreqUI').hidden = S.genMode !== 'freq';
  for (const b of $$('#genMode button')) b.classList.toggle('on', b.dataset.val === S.genMode);
  for (const b of $$('#genWave button')) b.classList.toggle('on', b.dataset.val === S.genWave);
  for (const k of $$('#keys button')) k.classList.toggle('on', +k.dataset.m + 12 * Math.floor(S.genMidi / 12) === S.genMidi && S.genMode === 'note');
  $('#octLabel').textContent = `octave ${Math.floor(S.genMidi / 12) - 1}`;
  $('#genLevel').value = S.genLevel; $('#genLevelVal').textContent = `${S.genLevel} dBFS`;
  const pos = Math.round(1000 * Math.log(clampN(S.genHz, 10, 20000) / 10) / Math.log(2000));
  if (document.activeElement !== $('#genHzIn')) $('#genHzIn').value = +S.genHz.toFixed(2);
  $('#genHzSlider').value = pos;
  $('#genPlay').classList.toggle('on', G.playing);
  $('#genPlay').textContent = G.playing ? '■ Stop' : '▶ Play';
}
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
function genSet(k, v) { S[k] = v; save(); genApply(); }
$('#genPlay').addEventListener('click', () => (G.playing ? genStop() : genStart()));
for (const b of $$('#genMode button')) b.addEventListener('click', () => genSet('genMode', b.dataset.val));
for (const b of $$('#genWave button')) b.addEventListener('click', () => genSet('genWave', b.dataset.val));
$('#genLevel').addEventListener('input', e => genSet('genLevel', +e.target.value));
$('#genHzSlider').addEventListener('input', e => genSet('genHz', +(10 * Math.pow(2000, +e.target.value / 1000)).toPrecision(4)));
$('#genHzIn').addEventListener('change', e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v)) genSet('genHz', clampN(v, 0.1, 24000)); });
for (const b of $$('[data-nudge]')) b.addEventListener('click', () => {
  const d = b.dataset.nudge;
  genSet('genHz', clampN(d === 'x2' ? S.genHz * 2 : d === 'half' ? S.genHz / 2 : S.genHz + +d, 0.1, 24000));
});
$('#octDown').addEventListener('click', () => genSet('genMidi', Math.max(12, S.genMidi - 12)));
$('#octUp').addEventListener('click', () => genSet('genMidi', Math.min(120, S.genMidi + 12)));
for (const k of $$('#keys button')) k.addEventListener('pointerdown', e => {
  e.preventDefault();
  genSet('genMidi', 12 * Math.floor(S.genMidi / 12) + +k.dataset.m);
  if (!G.playing) genStart();
});
genSync();

// ---------------------------------------------------------------------------------- offline (installed app)
if ('serviceWorker' in navigator && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
$('#hold').addEventListener('click', () => {
  const on = !$('#hold').classList.contains('on');
  $('#hold').classList.toggle('on', on);
  send({ type: 'pause', on });
});
document.addEventListener('visibilitychange', () => {
  send({ type: 'hidden', on: document.hidden });
  if (!running) return;
  if (document.hidden) ac?.suspend();
  else resume().then(ok => { if (!ok) showResume(); });
});

// for tests and the curious: window.soundWizard.stats() → what the engine measures now
window.soundWizard = {
  settings: S,
  stats: () => new Promise(res => { if (!worker && !eng) { res(null); return; } const id = ++statsId; statsWait.set(id, res); send({ type: 'stats', id }); }), // null until the engine runs
  set: setSetting,
  view: showView,
  mode: () => mode,
  lastRef: () => G.lastRef || null,
  generator: () => ({ playing: G.playing, type: G.osc?.type, freq: G.osc ? G.osc.frequency.value : null, target: genFreq(), level: S.genLevel, ctx: G.ctx?.state }),
};

// the generator does not need the microphone: open it straight from the start screen
$('#genOnly').addEventListener('click', () => { $('#overlay').hidden = true; showView('gen'); });
$('#overlayBack')?.addEventListener('click', () => { if (!running) $('#overlay').hidden = false; });

buildControls();
showView(['meter', 'spec', 'scope', 'tuner', 'tone', 'rhythm', 'gen'].includes(S.view) ? S.view : 'meter');
