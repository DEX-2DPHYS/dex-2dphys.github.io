// Sound Wizard analysis worker: owns the engine and the views' OffscreenCanvases. Audio arrives on a
// MessagePort straight from the AudioWorklet; the page sends settings, sizes and touch positions.
import { Engine } from './engine.js?v=20261010.1112';

let eng = null;
const post = m => self.postMessage(m);
const raf = typeof self.requestAnimationFrame === 'function'
  ? cb => self.requestAnimationFrame(cb)
  : cb => setTimeout(() => cb(performance.now()), 16);

function loop() {
  if (eng) eng.frame();
  raf(loop);
}

self.onmessage = e => {
  const d = e.data;
  if (d.type === 'init') {
    eng = new Engine(d.sr, d.settings, post);
    for (const [id, cv] of Object.entries(d.canvases)) eng.attach(id, cv);
    for (const r of d.sizes || []) eng.message({ type: 'resize', ...r });
    raf(loop);
    post({ type: 'started' });
  } else if (d.type === 'port') {
    d.port.onmessage = m => { if (!eng) return; if (m.data && m.data.clock !== undefined) eng.clock(m.data.clock); else eng.push(m.data); };
  } else if (eng) {
    eng.message(d);
  }
};
post({ type: 'ready' });
