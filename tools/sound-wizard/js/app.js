// Sound Wizard: the page. Starts the microphone (inside the tap, as iPhones require), hands the audio
// and the views' canvases to the analysis worker, and runs the controls. Everything that moves on screen
// is drawn by the engine (engine.js); this file only touches the DOM.
import { DEFAULTS, TUNINGS } from './engine.js?v=20261009.1504';
import { CMAP_NAMES } from './dsp.js?v=20261009.1504';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const KEY = 'soundwizard.settings.v1';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: settings last this visit */ } },
};
const S = { ...DEFAULTS, ...store.get() };
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
    { key: 'tuning', label: 'Instrument', type: 'select', options: Object.entries(TUNINGS).map(([k, t]) => [k, t.name]) },
    { key: 'a4', label: 'A4', type: 'range', min: 415, max: 466, step: 1, fmt: v => `${v} Hz` },
    { type: 'note', text: 'Tap a string to lock the tuner onto it (tap again to let go); otherwise it follows the nearest string. Green within ±3 cents. The strip below shows the last ten seconds.' },
  ],
  tone: [
    { key: 'a4', label: 'A4', type: 'range', min: 415, max: 466, step: 1, fmt: v => `${v} Hz` },
    { type: 'note', text: 'Base note: the fundamental of a single note (or the root when several notes sound). Chord: from the last half second. Key: from the last few seconds, so let a phrase play. Harmonics: the overtones of the base note, odd ones cyan, even ones magenta.' },
  ],
};

function buildControls() {
  for (const [view, list] of Object.entries(CONTROLS)) {
    const sheet = $(`.view[data-view="${view}"] .sheet`);
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
        for (const [val, text] of c.options) {
          const b = document.createElement('button');
          b.textContent = text; b.dataset.val = val;
          b.addEventListener('click', () => setSetting(c.key, val));
          seg.appendChild(b);
        }
        row.appendChild(seg);
      } else if (c.type === 'select') {
        const sel = document.createElement('select');
        sel.dataset.key = c.key;
        for (const [val, text] of c.options) sel.add(new Option(text, val));
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
function action(act) {
  if (act === 'reset') send({ type: 'reset' });
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
      const wk = new Worker('js/worker.js?v=20261009.1504', { type: 'module' });
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
    const { Engine } = await import('./engine.js?v=20261009.1504');
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
    await ac.audioWorklet.addModule('js/capture.worklet.js?v=20261009.1504');
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

$('#startBig').addEventListener('click', async () => { if (running && await resume()) return; if (running) stop(); start(); });
$('#power').addEventListener('click', () => (running ? stop() : start()));
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
  stats: () => new Promise(res => { const id = ++statsId; statsWait.set(id, res); send({ type: 'stats', id }); }),
  set: setSetting,
  view: showView,
  mode: () => mode,
};

buildControls();
showView(S.view in CONTROLS ? S.view : 'meter');
