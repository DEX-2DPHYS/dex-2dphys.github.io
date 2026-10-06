// One fractured correction on the Pro backend, in a thread of its own (cancelling = terminating it,
// which also ends its helper threads; the server kills its native core by pid). The same code path as
// the page's correction worker (exposure.worker.js, case 'fracture'), with Node worker threads as the
// helpers and — when desktop/bin/ebw-core exists — the native core for the targets, the short-range
// operator (kept in the core) and the global solve, sent as raw typed arrays. Anything the core
// refuses or fails falls back to the helpers / JavaScript, so a missing core never breaks a run.
//
// workerData: {body: ArrayBuffer (wire: {project: {library (packed), psf}, opts}), helpers, core}
// posts:      {corePid}, {progress} while running, {coreUsed}, then {done: ArrayBuffer (wire result)} or {error}
import os from 'node:os';
import { parentPort, workerData, Worker } from 'node:worker_threads';
import { decodeWire, encodeWire } from '../src/core/wire.js';
import { unpackLibrary } from '../src/core/geom/pack.js';
import { fractureCorrectAsync } from '../src/core/pec/fractured.js';
import { createSrPool } from '../src/workers/srpool.js';
import { createEngine } from '../src/core/exposure/engine.js';
import { startCore } from './core.mjs';

const HELPER = new URL('./helper-worker.mjs', import.meta.url);
const spawn = () => {
  const w = new Worker(HELPER, { resourceLimits: { maxOldGenerationSizeMb: workerData.helperHeapMb || 4096 } });
  return {
    post: (m, t) => w.postMessage(m, t || []),
    onMessage: (fn) => w.on('message', fn),
    onError: (fn) => w.on('error', (e) => fn(e && e.message)),
    terminate: () => w.terminate(),
  };
};
// srPayload's big arrays as typed arrays: the core gets them as raw bytes
const f64 = (a) => (a instanceof Float64Array ? a : Float64Array.from(a));
const i32 = (a) => (a instanceof Int32Array ? a : Int32Array.from(a));
const typed = (p) => ({ ...p, pts: f64(p.pts), polys: { off: i32(p.polys.off), xy: f64(p.polys.xy), dose: f64(p.polys.dose), key: i32(p.polys.key) } });

const JS_FALLBACK_MAX_POINTS = 3e6;    // above this a failed core request stops the run instead of falling back
const t0 = performance.now();
let pool = null, core = null;
const used = { targets: 0, sr: 0, solve: 0, failed: 0 };
try {
  const { project, opts } = decodeWire(workerData.body);
  const library = unpackLibrary(project.library);
  pool = createSrPool({ size: workerData.helpers, spawn });
  if (workerData.core) {
    core = await startCore({ log: (s) => parentPort.postMessage({ coreUsed: s }) });
    if (core) parentPort.postMessage({ corePid: core.pid });
  }
  // A request is built, checked against the free memory, encoded and DROPPED before its answer is awaited:
  // while the core computes (minutes on a whole chip) this thread holds only the correction's own state.
  // ChipV11's contour fit held its 1 GB operator request through the whole wait and took a 32 GB machine
  // to its last 100 MB of commit. The check refuses a request that would not fit with a margin, rather
  // than let the computer run out (os.freemem: the memory available now).
  const bytesOf = (o) => { let b = 0; const walk = (v) => { if (ArrayBuffer.isView(v)) b += v.byteLength; else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]); }; walk(o); return b; };
  const send = (type, build, what) => {
    let p = build();
    if (!p) return null;
    const bytes = bytesOf(p), need = 3 * bytes + (1 << 30), free = os.freemem();
    if (bytes > (256 << 20) && free < need) throw Object.assign(new Error(`Not enough free memory on this computer for this correction: the ${what} request is ${(bytes / 2 ** 30).toFixed(1)} GB and needs about ${(need / 2 ** 30).toFixed(1)} GB free, ${(free / 2 ** 30).toFixed(1)} GB is. Close other programs, or correct part of the layout: a region, the high-resolution parts, or the control-point fit (about 15 times fewer points than the contour fit).`), { fatal: true });
    const pr = core.request(type, p);
    p = null;
    return pr;
  };
  // the requests the core can take (as exposure.worker.js viaNative does for the DSW core)
  const viaCore = async (req) => {
    if (!core || !core.alive || req.kind === 'fracture') return null;
    try {
      if (req.kind === 'solve') {
        if (req.sr.token == null || (req.lr && req.lr.fixed)) return null;   // a fixed (context) source: the core does not take one yet
        const P = req.prob;
        const res = await send('pecSolve', () => ({ token: req.sr.token, prob: P, pts: req.pts.xy || Float64Array.from(req.pts.flat()), lr: req.lr }), 'solve');
        const ok = res && res.write instanceof Float64Array && res.write.length === P.nF && res.cls instanceof Int32Array && res.cls.length === P.nF
          && res.classes instanceof Float64Array && res.classes.length === P.classes && res.gotQ instanceof Float64Array && res.gotQ.length === P.nP
          && res.history instanceof Float64Array && Number.isInteger(res.it) && Number.isFinite(res.err);
        if (!ok) { used.failed++; return null; }
        used.solve++;
        return { write: res.write, cls: res.cls, classes: res.classes, gotQ: res.gotQ, history: res.history, it: res.it, err: res.err, lo: res.lo, hi: res.hi };
      }
      const N = req.pts.length;
      const build = () => {
        const payload = createEngine({ library: req.library, psf: req.psf }).srPayload(req.pts, req.kind, (sh) => sh.fi, req.roi);
        return payload && (req.kind === 'sr' ? { ...typed(payload), keep: true } : typed(payload));   // keep: the rows stay in the core for the solve
      };
      const pending = send('srRows', build, req.kind === 'sr' ? 'short-range operator' : 'targets');
      if (!pending) return null;                                   // a kernel the core does not take
      if (req.kind === 'sr') {
        const res = await pending;
        if (!(res && Number.isInteger(res.kept) && Number.isInteger(res.entries) && res.points === N)) { used.failed++; return null; }
        used.sr++;
        return { token: res.kept, entries: res.entries };
      }
      const res = await pending;
      if (!(res && res.values instanceof Float64Array && res.values.length === N)) { used.failed++; return null; }
      used.targets++;
      return res.values;
    } catch (e) {
      if (e.fatal) throw e;                                        // the free-memory check: stop, no fallback
      // out of memory: JavaScript would need more, so the run stops here with what to do instead
      if (e.oom) throw new Error(`Not enough free memory on this computer for this correction (${req.pts.length.toLocaleString()} points: the native core ran out while building the ${req.kind === 'sr' ? 'short-range operator' : req.kind === 'solve' ? 'solve' : 'targets'}). Close other programs, or correct part of the layout: a region, the high-resolution parts, or the control-point fit (about 15 times fewer points than the contour fit).`);
      // any other failure: JavaScript takes the request — but only one it can carry (it needs several times
      // the core's memory; ChipV11's contour fit sent to JS took the machine to its last gigabyte)
      if (req.pts.length > JS_FALLBACK_MAX_POINTS) throw new Error(`The native core failed on this correction (${e.message}), and at ${req.pts.length.toLocaleString()} points it is too large to redo in JavaScript. Try again; if it fails again, correct part of the layout (a region, the high-resolution parts) or use the control-point fit.`);
      used.failed++; parentPort.postMessage({ coreUsed: `request failed (${e.message}); JavaScript takes it` }); return null;
    }
  };
  const w = await fractureCorrectAsync({ library, psf: project.psf }, { ...(opts || {}), packed: true },
    (p) => parentPort.postMessage({ progress: p }),
    async (req) => (await viaCore(req)) ?? (req.kind === 'solve' ? null : pool.run(req)));
  if (core) parentPort.postMessage({ coreUsed: `targets ${used.targets}, operator ${used.sr}, solve ${used.solve}${used.failed ? `, ${used.failed} fell back to JavaScript` : ''}` });
  const out = encodeWire({ library: w.library, method: w.method, params: w.params, classes: w.classes,
    stats: { ...w.stats, helpers: pool.size, backend: 'desktop', core: core ? { version: core.version, threads: core.limits.threads, ...used } : null }, controls: w.controls, ms: performance.now() - t0 });
  parentPort.postMessage({ done: out }, [out]);
} catch (e) {
  parentPort.postMessage({ error: (e && e.message) || String(e) });
} finally {
  pool?.terminate();
  core?.close();
}
