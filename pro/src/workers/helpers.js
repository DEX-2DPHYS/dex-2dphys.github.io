// The helper side of the fractured correction (srpool.js): a share of the fracture or of the short-range
// work. Shared by the browser's helper Web Workers (exposure.worker.js) and the desktop backend's
// worker threads, so both compute exactly the same thing.
//   post(message, transferList)
import { createEngine } from '../core/exposure/engine.js';
import { makeCovered, runFractureJobs } from '../core/pec/fractured.js';
import { livePacked } from '../core/geom/pack.js';
import { decodeWire } from '../core/wire.js';
import { srTransfer } from '../core/exposure/srrows.js';

// true when m was a helper message (handled), false otherwise
export function handleHelperMessage(m, post) {
  if (m.type === 'fracChunk') {
    try {
      const { covered } = makeCovered(m.topObjs, m.arrays);
      const r = runFractureJobs(m.jobs, m.o, covered, m.zones, m.hS, m.contour, (d) => post({ id: m.id, progress: { done: d } }));
      post({ id: m.id, ok: true, result: r });
    } catch (e) { post({ id: m.id, ok: false, error: e.message || String(e) }); }
    return true;
  }
  if (m.type === 'srChunk') {
    try {
      // the share stays packed (the engine reads it so); it comes as one wire buffer (srpool.js shareOf)
      const e = createEngine({ library: livePacked(m.libWire ? decodeWire(m.libWire) : m.library), psf: m.psf });
      if (m.kind === 'targets') { const v = e.doseAt(m.pts, 'shortrange', m.roi); post({ id: m.id, ok: true, result: v }, [v.buffer]); }
      else {
        const r = e.srOperator(m.pts, (sh) => sh.fi, (f) => post({ id: m.id, progress: { done: Math.round(f * m.pts.length) } }), m.roi);
        post({ id: m.id, ok: true, result: r }, srTransfer(r));
      }
    } catch (e) { post({ id: m.id, ok: false, error: e.message || String(e) }); }
    return true;
  }
  return false;
}
