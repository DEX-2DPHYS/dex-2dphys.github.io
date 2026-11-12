// Web Worker: runs the transport analysis (src/tb.js) off the main thread, so the MD and the VR frames never wait for it.
// build.js bundles this file separately and inlines it into the page; main.js starts it from a Blob URL.
import { analyse } from './tb.js';

// The spin-polarised edges are solved self-consistently; the last solution starts the next one (the geometry changes little between
// calls), so a live update needs only a couple of iterations. A structure found non-magnetic (no zigzag edge states) skips the spin
// calculation on the live updates that follow - it is checked again every 10th call, and always for the full T(E), I(V) curves.
let prev = null, calls = 0;

self.onmessage = (e) => {
  const m = e.data; let r;
  try {
    const sys = { N: m.N, x: m.x, y: m.y, z: m.z, per: m.per, L: m.L, orb: (i) => m.orb[i] === 1 };
    let nOrb = 0; for (let i = 0; i < m.N; i++) if (m.orb[i] === 1) nOrb++;
    const live = m.opts.curve === false, same = prev && prev.n === nOrb;
    const skip = m.opts.U > 0 && live && same && prev.mmax < 0.01 && (++calls % 10 !== 0);
    r = analyse(sys, m.cm, m.cp, Object.assign({}, m.opts, { U: skip ? 0 : m.opts.U, prev: m.opts.U > 0 ? prev : null }));
    if (skip) r.mf = { U: m.opts.U, it: 0, conv: true, mmax: prev.mmax, warm: true, skipped: true };
    else prev = r.mfState ? Object.assign(r.mfState, { mmax: r.mf.mmax }) : null;
    delete r.mfState;
  } catch (err) { r = { error: String((err && err.message) || err) }; }
  r.id = m.id; r.curve = m.opts.curve !== false; r.N = m.N;
  const transfer = [];
  for (const k of ['E', 'T', 'V', 'I', 'dIdV', 'J', 'pairs']) if (r[k]) transfer.push(r[k].buffer);
  self.postMessage(r, transfer);
};
