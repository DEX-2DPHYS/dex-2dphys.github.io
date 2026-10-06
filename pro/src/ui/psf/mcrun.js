// Runs the Monte Carlo on a pool of Web Workers (one per core but one), merging batches as they
// arrive. Batches are seeded by (seed, index), so the result does not depend on the pool size.

/* global __MC_WORKER_SRC__ */
import { createTransport } from '../../core/mc/transport.js';
import { makeAccumulator, addBatch, addAggregate, tailError, summary, transportPayload } from '../../core/mc/result.js';
import { nativeCore } from '../native.js';

let workerUrl = null;
function mcWorkerUrl() {
  if (workerUrl) return workerUrl;
  if (typeof __MC_WORKER_SRC__ === 'undefined') throw new Error('Monte Carlo worker missing from the build');
  workerUrl = URL.createObjectURL(new Blob([__MC_WORKER_SRC__], { type: 'text/javascript' }));
  return workerUrl;
}

export const defaultThreads = () => Math.max(1, Math.min(32, (navigator.hardwareConcurrency || 4) - 1));

// opts: maxElectrons, targetErr (relative error of the halo energy, 0 = off), minElectrons,
//       seed, threads, onProgress({acc, summary, tailErr, rate, elapsed})
function runWorkers(cfg, opts = {}) {
  const { maxElectrons = 100000, targetErr = 0.01, minElectrons = 10000, seed = 1, threads = defaultThreads(), onProgress } = opts;
  const t = createTransport(cfg);                 // for the tally layout (edges, bins)
  const acc = makeAccumulator(t);
  const perBatch = Math.max(100, Math.min(2000, Math.round(40000 / cfg.E0)));
  const nBatches = Math.ceil(maxElectrons / perBatch);
  const t0 = performance.now();
  let next = 0, stopped = false, done = false, lastReport = 0;
  const workers = [];
  let resolveRun, rejectRun;
  const promise = new Promise((res, rej) => { resolveRun = res; rejectRun = rej; });

  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 400) return;
    lastReport = now;
    const elapsed = (now - t0) / 1000;
    onProgress?.({ acc, summary: summary(acc), tailErr: tailError(acc), rate: acc.n / Math.max(elapsed, 1e-3), elapsed, batches: nBatches, done: next });
  };
  const finish = () => {
    if (done) return;
    done = true;
    for (const w of workers) w.terminate();
    report(true);
    acc.ms = performance.now() - t0;
    resolveRun({ acc, transport: t, stopped });
  };
  let outstanding = 0;
  const feed = (w) => {
    const converged = targetErr > 0 && acc.n >= minElectrons && tailError(acc) < targetErr;
    if (stopped || converged || next >= nBatches) { if (outstanding === 0) finish(); return; }
    outstanding++;
    w.postMessage({ type: 'batch', n: perBatch, seed, batch: next++ });
  };
  try {
    const url = mcWorkerUrl();
    for (let k = 0; k < Math.min(threads, nBatches); k++) {
      const w = new Worker(url);
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') { feed(w); return; }
        if (m.type === 'error') { stopped = true; for (const x of workers) x.terminate(); rejectRun(new Error(m.error)); return; }
        outstanding--;
        addBatch(acc, m.b);
        report();
        feed(w);
      };
      w.onerror = (e) => { stopped = true; rejectRun(new Error(e.message || 'worker error')); };
      w.postMessage({ type: 'init', cfg });
      workers.push(w);
    }
  } catch (e) { rejectRun(e); }
  return { promise, stop: () => { stopped = true; if (outstanding === 0) finish(); } };
}

// The DSW plugin's native core runs the same batches (same seeds, same trajectories)
// on every core; the page keeps the accumulator, the progress and the stopping rule. Without a
// core (the HTML build, or a core that does not offer the Monte Carlo) the workers run as before.
export function runMonteCarlo(cfg, opts = {}) {
  const nat = nativeCore();
  if (!nat) return runWorkers(cfg, opts);
  let inner = null, stopped = false;
  const workers = () => { inner = runWorkers(cfg, opts); if (stopped) inner.stop(); return inner.promise; };
  const promise = nat.ready.then(() => {
    if (!nat.connected || !nat.supports.has('mcBatches')) return workers();
    // a core that fails mid-run (stopped, out of memory) hands the run to the page's workers, from the start
    return runNative(nat, cfg, opts, () => stopped).catch((e) => { console.warn('Monte Carlo on the native core failed, the page runs it:', e.message); return workers(); });
  });
  return { promise, stop: () => { stopped = true; inner?.stop(); } };
}

async function runNative(nat, cfg, opts, isStopped) {
  const { maxElectrons = 100000, targetErr = 0.01, minElectrons = 10000, seed = 1, threads = defaultThreads(), onProgress } = opts;
  const t = createTransport(cfg);
  const acc = makeAccumulator(t);
  const perBatch = Math.max(100, Math.min(2000, Math.round(40000 / cfg.E0)));     // as the workers: same batches
  const nBatches = Math.ceil(maxElectrons / perBatch);
  const t0 = performance.now();
  await nat.request('mcInit', transportPayload(t));
  let next = 0, count = Math.max(1, threads), stopped = false;
  const report = () => {
    const elapsed = (performance.now() - t0) / 1000;
    onProgress?.({ acc, summary: summary(acc), tailErr: tailError(acc), rate: acc.n / Math.max(elapsed, 1e-3), elapsed, batches: nBatches, done: next });
  };
  for (;;) {
    if (isStopped()) { stopped = true; break; }
    if (targetErr > 0 && acc.n >= minElectrons && tailError(acc) < targetErr) break;
    if (next >= nBatches) break;
    const k = Math.min(count, nBatches - next);
    const r = await nat.request('mcBatches', { perBatch, seed, from: next, count: k, threads });
    next += k;
    addAggregate(acc, r);
    report();
    // chunks of about 0.4 s keep the progress line and Stop responsive
    count = Math.max(1, Math.min(4 * count, Math.round((k * 0.4) / Math.max(r.seconds, 1e-3))));
  }
  acc.ms = performance.now() - t0;
  report();
  return { acc, transport: t, stopped };
}

// Trajectories + deposition map for the trajectory view (traceRun in core/mc/trace.js), on a worker of
// its own that keeps its transport while the configuration stays the same. A newer request supersedes
// an older one still running (its promise resolves to null).
let traceW = null, traceCfg = '', traceSeq = 0;
const traceWait = new Map();
export function traceMonteCarlo(cfg, opts) {
  const key = JSON.stringify(cfg);
  if (!traceW) {
    traceW = new Worker(mcWorkerUrl());
    traceW.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') return;
      const p = traceWait.get(m.id); if (!p) return;
      traceWait.delete(m.id);
      m.type === 'error' ? p.reject(new Error(m.error)) : p.resolve(m.r);
    };
  }
  if (key !== traceCfg) { traceCfg = key; traceW.postMessage({ type: 'init', cfg }); }
  const id = ++traceSeq;
  for (const [k, p] of traceWait) if (k < id) { p.resolve(null); traceWait.delete(k); }
  return new Promise((resolve, reject) => { traceWait.set(id, { resolve, reject }); traceW.postMessage({ type: 'trace', id, ...opts }); });
}
