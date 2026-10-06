// Connection to the DSW plugin's native core.
//
// Only the DSW build has one (__BACKEND__ = 'dsw'); the HTML build gets null and never opens a
// socket. The core lists the request types it handles in its hello; everything else stays on the
// page's own Web Workers, so a missing or partial core can never break the page.
//
// We do NOT use dex.js: the DSW host sends nothing when render() has no frame, and dex.js asks
// for one every animation frame and then waits forever. Here a frame ("f") is requested only
// after a result announced binary data, one request per expected frame.

/* global __BACKEND__ */
export const BACKEND = typeof __BACKEND__ !== 'undefined' ? __BACKEND__ : 'html';
import { localBackend } from './local.js';
import { encodeWire, decodeWire } from '../core/wire.js';

let core;   // undefined = not tried yet, null = none

// The HTML build served by the Pro backend (desktop/server.mjs) gets the backend's native core, the
// same request types as the DSW one, over POST /api/ebw/core with binary wire messages (typed arrays
// raw). Served by anything else (a web site) the client stays unconnected and the page uses its own
// workers; from file:// there is no client at all.
export function nativeCore() {
  if (core !== undefined) return core;
  const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  core = BACKEND === 'dsw' ? connect() : http ? proCore() : null;
  return core;
}

function proCore() {
  const api = { supports: new Set(), limits: {}, version: null, connected: false, binary: true, pro: true, send() {} };
  api.ready = localBackend().then((h) => {
    if (h && h.core && Array.isArray(h.core.supports)) {
      api.supports = new Set(h.core.supports); api.limits = { threads: h.core.threads }; api.version = h.core.version; api.connected = true;
    }
  }).catch(() => {});
  api.request = async (type, payload = {}) => {
    const r = await fetch('/api/ebw/core', { method: 'POST', body: encodeWire({ type, payload }), headers: { 'Content-Type': 'application/octet-stream' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`native core: HTTP ${r.status}`);
    const m = decodeWire(await r.arrayBuffer());
    if (!m.ok) throw new Error(m.error || 'native core error');
    return m.result;
  };
  return api;
}

function connect() {
  const m = location.pathname.match(/^\/plugins\/([^/]+)\//);
  const empty = { supports: new Set(), limits: {}, version: null, connected: false };
  if (!m || !/^https?:$/.test(location.protocol)) {
    return { ...empty, ready: Promise.resolve(), request: () => Promise.reject(new Error('no native core')), send() {} };
  }
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/' + m[1]);
  ws.binaryType = 'arraybuffer';
  const api = { ...empty };
  let nextId = 1;
  const pending = new Map();      // id -> {resolve, reject, onProgress, result?, bin?}
  const awaitingFrames = [];      // ids whose binary part has not arrived, in order
  // The host coalesces frame requests (several "f" before it loops = one frame), so exactly one
  // request is kept outstanding and the next is sent when a frame arrives and more are owed.
  let frameAsked = false;
  const askFrame = () => { if (!frameAsked && awaitingFrames.length && ws.readyState === WebSocket.OPEN) { frameAsked = true; ws.send('f'); } };
  let readyResolve;
  api.ready = new Promise((r) => { readyResolve = r; });
  // a core that never says hello must not hold the page up
  const giveUp = setTimeout(() => readyResolve(), 2500);

  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') { onFrame(ev.data); return; }
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === 'hello') {
      api.supports = new Set(msg.supports || []);
      api.limits = msg.limits || {};
      api.version = msg.version || null;
      api.connected = true;
      clearTimeout(giveUp);
      readyResolve();
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.t === 'progress') { p.onProgress?.(msg.p); return; }
    if (msg.t !== 'res') return;
    if (!msg.ok) { pending.delete(msg.id); p.reject(new Error(msg.error || 'native core error')); return; }
    if (msg.bin && msg.bin.length) {
      p.result = msg.result; p.bin = msg.bin;
      awaitingFrames.push(msg.id);
      askFrame();
      return;
    }
    pending.delete(msg.id);
    p.resolve(msg.result);
  };

  // DSW frame: "DXF1" u32 w u32 h, then our bytes: "EBW1" u32 id, Float32 data.
  function onFrame(buf) {
    frameAsked = false;
    const dv = new DataView(buf);
    if (buf.byteLength < 20 || dv.getUint32(12, true) !== 0x31574245) return;   // "EBW1"
    const id = dv.getUint32(16, true);
    const k = awaitingFrames.indexOf(id);
    if (k >= 0) awaitingFrames.splice(k, 1);
    askFrame();
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    const data = new Float32Array(buf, 20, (buf.byteLength - 20) >> 2);
    const result = p.result || {};
    for (const b of p.bin) {
      // offset in 4-byte words from the start of the data; type f64 / i32 / u8, else float32
      if (b.type === 'f64') result[b.key] = new Float64Array(buf.slice(20 + 4 * b.offset, 20 + 4 * b.offset + 8 * b.count));
      else if (b.type === 'i32') result[b.key] = new Int32Array(buf.slice(20 + 4 * b.offset, 20 + 4 * b.offset + 4 * b.count));
      else if (b.type === 'u8') result[b.key] = new Uint8Array(buf.slice(20 + 4 * b.offset, 20 + 4 * b.offset + b.count));
      else result[b.key] = data.slice(b.offset, b.offset + b.count);
    }
    p.resolve(result);
  }

  ws.onclose = ws.onerror = () => {
    clearTimeout(giveUp);
    api.connected = false;
    api.supports = new Set();
    readyResolve();
    for (const p of pending.values()) p.reject(new Error('native core disconnected'));
    pending.clear();
  };

  api.send = (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
  api.request = (type, payload = {}, onProgress) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('native core not connected')); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    ws.send(JSON.stringify({ t: 'req', id, type, ...payload }));
  });
  return api;
}
