// Exposure worker: holds the current project and answers dose queries off the main thread.
//
// in:  {type:'project', version, project}
//      {type:'raster', id, version, grid, field}            field: delivered|designed|write|longrange|uncorrected
//      {type:'points', id, version, points, fields:[…]}
//      {type:'correct', id, version}
//      {type:'wiener', id, version, grid, opts}
//      {type:'info', id, version, roi}
//      {type:'fracture', id, version, opts}                  fractured correction of the design
// With project.writing (applied fractured correction) the normal engine uses the writing library;
// 'designed', 'uncorrected' and the '…@design' fields always use the design.
// out: {id, ok, result | error}   (+ {id, progress} while correcting)

import { createEngine } from '../core/exposure/engine.js';
import { sceneCache } from '../core/exposure/scene.js';
import { correctPerShape } from '../core/pec/pershape.js';
import { wienerCorrection } from '../core/pec/wiener.js';
import { psfLabel, psfFromSettings } from '../core/psf/settings.js';
import { termPSF } from '../core/analysis/cd.js';
import { fractureCorrectAsync } from '../core/pec/fractured.js';
import { handleHelperMessage } from './helpers.js';
import { createSrPool } from './srpool.js';
import { unpackLibrary, packedTransfer } from '../core/geom/pack.js';

let pool = null;                          // helper workers for the fractured correction, started on first use

// Helpers are started by the page, not here. A worker cannot start a worker from its own blob URL when
// the page was opened from file:// — the origin is 'null' and Chrome refuses it ("Script at
// 'blob:null/…' cannot be accessed from origin 'null'"); the test browser's --allow-file-access-from-files
// hid that. The page starts each helper from the URL it made and joins it to this worker with a
// MessageChannel; the helper answers on its port (see 'helperPort' below), so srpool sees the same thing.
const helperErrors = new Map();
let nextHid = 1;
function pageSpawn() {
  const hid = nextHid++, ch = new MessageChannel(), port = ch.port1;
  self.postMessage({ spawnHelper: hid }, [ch.port2]);
  return {
    post: (msg, transfer) => port.postMessage(msg, transfer || []),
    onMessage: (fn) => { port.onmessage = (ev) => fn(ev.data); },
    onError: (fn) => helperErrors.set(hid, fn),
    terminate: () => { self.postMessage({ killHelper: hid }); port.close(); helperErrors.delete(hid); },
  };
}
// requests handed to the page for the DSW native core: rid → resolve(result | null)
const delegated = new Map();
let nextRid = 1;

let project = null, version = -1;
const engines = new Map();
// the engines on the design library share one geometry index (built once for a large layout);
// without writing data 'normal' and 'design' are the same engine
let designScene = null;
function engine(kind = 'normal') {
  if (kind === 'design' && !project.writing) kind = 'normal';
  let e = engines.get(kind);
  if (!e) {
    if (!designScene) designScene = sceneCache();
    e = kind === 'uncorrected' ? createEngine(project, { doseOverride: (s) => s.dose || 0, scene: designScene })
      : kind === 'normal' && project.writing ? createEngine({ library: project.writing.library, psf: project.psf })
      : createEngine(project, { scene: designScene });            // 'design' (or no writing data)
    engines.set(kind, e);
  }
  return e;
}

// The Analysis tab's engines: the same libraries with another PSF (a kept one, or one term of the PSF
// for the calibration). key → engine; cleared with the project.
const altEngines = new Map();
function engineWith(kind, sc) {
  if (!sc.psf && !sc.term) return engine(kind);
  if (kind === 'design' && !project.writing) kind = 'normal';
  const key = `${kind}|${JSON.stringify(sc.psf || sc.term)}`;
  let e = altEngines.get(key);
  if (!e) {
    const psfObject = sc.term ? termPSF(sc.term, sc.wideNm) : psfFromSettings(sc.psf);
    if (!designScene) designScene = sceneCache();
    e = kind === 'uncorrected' ? createEngine(project, { doseOverride: (q) => q.dose || 0, scene: designScene, psfObject })
      : kind === 'normal' && project.writing ? createEngine({ library: project.writing.library, psf: project.psf }, { psfObject })
      : createEngine(project, { scene: designScene, psfObject });
    if (altEngines.size > 24) altEngines.clear();
    altEngines.set(key, e);
  }
  return e;
}

// field → [engine field, engine kind]
function route(f) {
  if (f === 'uncorrected') return ['delivered', 'uncorrected'];
  if (f === 'designed') return ['designed', 'design'];
  if (f.endsWith('@design')) return [f.slice(0, -7), 'design'];
  return [f, 'normal'];
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'delegateResult') { const r = delegated.get(m.rid); if (r) { delegated.delete(m.rid); r(m.ok ? m.result : null); } return; }
  // this worker is a helper: its work comes on the port the page handed it
  if (m.type === 'helperPort') { const port = ev.ports[0]; port.onmessage = (e) => handleHelperMessage(e.data, (msg, transfer) => port.postMessage(msg, transfer || [])); return; }
  if (m.type === 'helperError') { helperErrors.get(m.hid)?.(m.message); return; }
  if (m.type === 'project') {
    const p = m.project;
    project = { ...p, library: unpackLibrary(p.library), writing: p.writing ? { ...p.writing, library: unpackLibrary(p.writing.library) } : null };
    version = m.version; engines.clear(); altEngines.clear(); designScene = null; return;
  }
  // a helper's share of the fracture or the short range (srpool.js; helpers.js does the work)
  if (handleHelperMessage(m, (msg, transfer) => self.postMessage(msg, transfer || []))) return;
  const reply = (result, transfer = []) => self.postMessage({ id: m.id, ok: true, version, result }, transfer);
  try {
    if (!project) throw new Error('no project yet');
    const t0 = performance.now();
    switch (m.type) {
      case 'raster': {
        const [field, kind] = route(m.field);
        const data = engine(kind).raster(m.grid, field);
        reply({ data, grid: m.grid, field: m.field, ms: performance.now() - t0 }, [data.buffer]);
        break;
      }
      case 'points': {
        const out = {};
        for (const f of m.fields) { const [field, kind] = route(f); out[f] = engine(kind).doseAt(m.points, field); }
        reply({ values: out, ms: performance.now() - t0 });
        break;
      }
      case 'profiles': {                 // the Analysis tab: {points, scenarios: [{key, field, psf?, term?, wideNm?}]}
        const out = {};
        for (const sc of m.scenarios) { const [field, kind] = route(sc.field); out[sc.key] = engineWith(kind, sc).doseAt(m.points, field); }
        reply({ values: out, ms: performance.now() - t0 });
        break;
      }
      case 'correct': {
        const res = correctPerShape(project, { onProgress: (p) => self.postMessage({ id: m.id, progress: p }) });
        reply({ doses: [...res.doses.entries()], controls: res.controls, iterations: res.iterations, converged: res.converged, history: res.history, ms: performance.now() - t0 });
        break;
      }
      case 'fracture': {
        // the targets and the short-range operator go to helper workers (srpool.js); the rest runs here
        if (!pool) pool = createSrPool({ spawn: pageSpawn });
        const proj = { library: project.library, psf: project.psf };
        // in the DSW page (m.native) each request goes first to the native core, through the page; a
        // refusal (null), an error or a reply of the wrong shape falls back to the helper workers
        let nativeUsed = 0;
        const toCore = (payload) => new Promise((resolve) => { const rid = nextRid++; delegated.set(rid, resolve); self.postMessage({ id: m.id, delegate: { rid, payload } }); });
        const viaNative = async (req) => {
          if (!m.native || req.kind === 'fracture') return null;     // the fracture runs on the helpers
          try {
            if (req.kind === 'solve') {        // with the operator the core kept (P2b)
              if (!m.nativeSolve || req.sr.token == null || (req.lr && req.lr.fixed)) return null;   // a fixed (context) source: the core does not take one yet
              const P = req.prob, res = await toCore({ op: 'pecSolve', token: req.sr.token, prob: P, pts: req.pts.xy || req.pts.flat(), lr: req.lr });
              const ok = res && res.write instanceof Float64Array && res.write.length === P.nF && res.cls instanceof Int32Array && res.cls.length === P.nF
                && res.classes instanceof Float64Array && res.classes.length === P.classes && res.gotQ instanceof Float64Array && res.gotQ.length === P.nP
                && res.history instanceof Float64Array && Number.isInteger(res.it) && Number.isFinite(res.err);
              if (!ok) return null;
              nativeUsed++;
              return { write: res.write, cls: res.cls, classes: res.classes, gotQ: res.gotQ, history: res.history, it: res.it, err: res.err, lo: res.lo, hi: res.hi };
            }
            const payload = createEngine({ library: req.library, psf: req.psf }).srPayload(req.pts, req.kind, (sh) => sh.fi, req.roi);
            if (!payload) return null;
            if (req.kind === 'sr' && m.nativeSolve) payload.keep = true;   // the core keeps the rows for the solve
            const res = await toCore(payload);
            const N = req.pts.length;
            if (payload.keep) { if (res && Number.isInteger(res.kept) && Number.isInteger(res.entries) && res.points === N) { nativeUsed++; return { token: res.kept, entries: res.entries }; } return null; }
            if (req.kind === 'targets') { if (res?.values instanceof Float64Array && res.values.length === N) { nativeUsed++; return res.values; } return null; }
            if (res?.ptr instanceof Int32Array && res.ptr.length === N + 1 && res.idx instanceof Int32Array && res.val instanceof Float64Array && res.idx.length === res.ptr[N] && res.val.length === res.ptr[N]) { nativeUsed++; return { ptr: res.ptr, idx: res.idx, val: res.val }; }
            return null;
          } catch { return null; }
        };
        // the writing library comes back with its large cells packed and goes to the page so, transferred
        fractureCorrectAsync(proj, { ...(m.opts || {}), packed: true }, (p) => self.postMessage({ id: m.id, progress: p }), async (req) => (await viaNative(req)) ?? (req.kind === 'solve' ? null : pool.run(req)))
          .then((w) => reply({ library: w.library, method: w.method, params: w.params, classes: w.classes, stats: { ...w.stats, helpers: pool.size, native: nativeUsed }, controls: w.controls, ms: performance.now() - t0 }, packedTransfer(w.library)))
          .catch((e) => self.postMessage({ id: m.id, ok: false, version, error: e.message || String(e) }));
        break;
      }
      case 'wiener': {
        const r = wienerCorrection(engine(), m.grid, m.opts);
        reply({ ...r, ms: performance.now() - t0 }, [r.target.buffer, r.write.buffer, r.delivered.buffer]);
        break;
      }
      case 'info': {
        const e = engine();
        const p = e.prepare(m.roi);
        reply({ label: psfLabel(e.psf), exact: e.exact, h: p.grid.dx, rSplit: p.split.rSplit, rMaxSR: p.split.rMaxSR, srWeight: p.split.sr.integral, lrTerms: p.split.lr.terms.length, gridN: [p.grid.nx, p.grid.ny] });
        break;
      }
      default: throw new Error('unknown request ' + m.type);
    }
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, version, error: e.message || String(e) });
  }
};
