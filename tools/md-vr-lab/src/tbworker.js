// Web Worker: runs the transport analysis (src/tb.js) off the main thread, so the MD and the VR frames never wait for it.
// build.js bundles this file separately and inlines it into the page; main.js starts it from a Blob URL.
import { analyse } from './tb.js';

self.onmessage = (e) => {
  const m = e.data; let r;
  try {
    const sys = { N: m.N, x: m.x, y: m.y, z: m.z, per: m.per, L: m.L, orb: (i) => m.orb[i] === 1 };
    r = analyse(sys, m.cm, m.cp, m.opts);
  } catch (err) { r = { error: String((err && err.message) || err) }; }
  r.id = m.id; r.curve = m.opts.curve !== false; r.N = m.N;
  const transfer = [];
  for (const k of ['E', 'T', 'V', 'I', 'dIdV', 'J', 'pairs']) if (r[k]) transfer.push(r[k].buffer);
  self.postMessage(r, transfer);
};
