// Monte Carlo worker: builds the transport once per run and runs batches on request.
//   in:  {type:'init', cfg}  then  {type:'batch', n, seed, batch}
//        {type:'trace', nShow, nDep, seed, view}   tracks + deposition map for the trajectory view
//   out: {type:'ready'}         and {type:'batch', b} / {type:'trace', r} (typed arrays transferred)

import { createTransport } from '../core/mc/transport.js';
import { traceRun } from '../core/mc/trace.js';

let t = null;
self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') { t = createTransport(m.cfg); self.postMessage({ type: 'ready' }); return; }
    if (m.type === 'batch') {
      const b = t.runBatch(m.n, m.seed, m.batch);
      self.postMessage({ type: 'batch', b }, [b.tally.buffer, b.depLayer.buffer]);
    }
    if (m.type === 'trace') {
      const r = traceRun(t, m);
      const tr = [r.xy.buffer, r.off.buffer, r.flags.buffer, r.elec.buffer];
      if (r.grid) tr.push(r.grid.buffer);
      self.postMessage({ type: 'trace', id: m.id, r }, tr);
    }
  } catch (e) { self.postMessage({ type: 'error', id: m.id, error: e.message || String(e) }); }
};
