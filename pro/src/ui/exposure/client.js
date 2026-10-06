// Main-thread side of the exposure worker: sends the project when it changes, returns promises
// for queries, drops answers to superseded requests.
//
// In the DSW build a request goes to the native core when the core lists its type, and to the
// worker otherwise. The HTML build only ever has the worker.

import { nativeCore } from '../native.js';
import { packLibrary } from '../../core/geom/pack.js';
import { localBackend, localFracture } from '../local.js';

/* global __WORKER_SRC__ */
function createWorkerClient() {
  const src = typeof __WORKER_SRC__ !== 'undefined' ? __WORKER_SRC__ : null;
  if (!src) throw new Error('worker source missing from the build');
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  let nextId = 1, sentVersion = -1, delegate = null;
  const pending = new Map();
  const helpers = new Map();               // helper workers started for this worker (exposure.worker.js pageSpawn)
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.spawnHelper) {                    // started here: a worker may not start one from a file:// page's blob URL
      const hid = m.spawnHelper, h = new Worker(url);
      h.onerror = (e) => worker.postMessage({ type: 'helperError', hid, message: e.message || 'helper worker failed' });
      h.postMessage({ type: 'helperPort' }, [ev.ports[0]]);
      helpers.set(hid, h);
      return;
    }
    if (m.killHelper) { helpers.get(m.killHelper)?.terminate(); helpers.delete(m.killHelper); return; }
    if (m.delegate) {                       // a request the worker hands to the DSW native core
      const d = m.delegate;
      Promise.resolve(delegate ? delegate(d.payload) : null)
        // the typed arrays are handed over, not copied (an operator can be hundreds of MB)
        .then((result) => worker.postMessage({ type: 'delegateResult', rid: d.rid, ok: !!result, result }, result ? Object.values(result).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer) : []), () => worker.postMessage({ type: 'delegateResult', rid: d.rid, ok: false }));
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) { p.onProgress?.(m.progress); return; }
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker error')); pending.clear(); };

  return {
    // stops the worker (and the helpers it started) at once; what it was doing is rejected with reason
    terminate(reason = 'Cancelled') { worker.terminate(); for (const h of helpers.values()) h.terminate(); helpers.clear(); URL.revokeObjectURL(url); for (const p of pending.values()) p.reject(new Error(reason)); pending.clear(); },
    setDelegate(fn) { delegate = fn; },
    setProject(project, version) {
      if (version === sentVersion) return;
      sentVersion = version;
      // packed and transferred: a plain postMessage of a large layout copies every shape object on
      // the main thread (4 s for a 318 000-shape GDS, page frozen)
      const p = projectPayload(project), transfer = [];
      const pack = (lib) => { const r = packLibrary(lib); transfer.push(...r.transfer); return r.packed; };
      const msg = { library: pack(p.library), psf: p.psf, writing: p.writing ? { ...p.writing, library: pack(p.writing.library) } : null };
      worker.postMessage({ type: 'project', version, project: msg }, transfer);
    },
    request(type, payload = {}, onProgress) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ type, id, ...payload });
      });
    },
  };
}

// What the engines need from the project: the same object for the worker and the native core.
function projectPayload(project) {
  const w = project.writing && project.writing.active ? { library: project.writing.library } : null;
  return { library: project.library, psf: project.psf, writing: w };
}

// The fractured correction runs in a worker of its own, started on first use and sent the project only
// then: a run of minutes no longer holds up the maps, and cancelling it is stopping that worker.
// Served by the desktop backend (local.js), the correction runs there instead: same request, same
// progress, cancel stops the backend's run.
function withCorrectionWorker(maps, delegate) {
  let pec = null, project = null, version = -1, abort = null;
  const pecClient = () => { if (!pec) { pec = createWorkerClient(); if (delegate) pec.setDelegate(delegate); } pec.setProject(project, version); return pec; };
  return {
    setProject(p, v) { maps.setProject(p, v); project = p; version = v; },
    request(type, payload, onProgress) {
      if (type !== 'fracture') return maps.request(type, payload, onProgress);
      return localBackend().then((L) => {
        if (!L) return pecClient().request(type, payload, onProgress);
        const ctl = (abort = new AbortController());
        const opts = { ...(payload && payload.opts), maxPoints: L.maxPoints, desktop: true };
        return localFracture({ project: { library: packLibrary(project.library).packed, psf: project.psf }, opts }, onProgress, ctl.signal)
          .catch((e) => { throw ctl.signal.aborted ? new Error('Cancelled') : e; })
          .finally(() => { if (abort === ctl) abort = null; });
      });
    },
    cancel() { if (abort) { abort.abort(); abort = null; } if (pec) { pec.terminate('Cancelled'); pec = null; } },
  };
}

export function createExposureClient() {
  const nat = nativeCore();
  if (!nat) return withCorrectionWorker(createWorkerClient(), null);
  let project = null, version = -1, nativeVersion = -1;
  // typed arrays travel as plain arrays in the core's JSON
  const plain = (o) => (ArrayBuffer.isView(o) ? Array.from(o) : o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, plain(v)])) : o);
  const delegate = async (payload) => {
    await nat.ready;
    const { op = 'srRows', ...rest } = payload;
    if (!nat.connected || !nat.supports.has(op)) return null;
    return nat.request(op, plain(rest));
  };
  const base = createWorkerClient();
  base.setDelegate(delegate);
  const js = withCorrectionWorker(base, delegate);
  return {
    cancel() { js.cancel(); },
    setProject(p, v) { js.setProject(p, v); project = p; version = v; },
    async request(type, payload = {}, onProgress) {
      await nat.ready;
      if (type === 'fracture') payload = { ...payload, native: nat.connected && nat.supports.has('srRows'), nativeSolve: nat.connected && nat.supports.has('pecSolve') };
      if (!nat.connected || !nat.supports.has(type)) return js.request(type, payload, onProgress);
      if (nativeVersion !== version && project) {
        nat.send({ t: 'project', version, project: projectPayload(project) });
        nativeVersion = version;
      }
      return nat.request(type, payload, onProgress);
    },
  };
}
