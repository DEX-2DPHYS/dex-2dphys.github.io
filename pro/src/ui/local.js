// The desktop backend (source/desktop/server.mjs): when the ordinary HTML page is served by it over
// http, the fractured correction runs there, in Node, on all cores and with the computer's memory,
// instead of in the page's workers. Opened from file:// (or as the DSW plugin) there is no backend
// and nothing here is used.
import { BACKEND } from './native.js';
import { encodeWire, decodeWire } from '../core/wire.js';

let probe;   // Promise<hello | null>

export function localBackend() {
  if (probe) return probe;
  const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  if (BACKEND !== 'html' || !http || typeof fetch === 'undefined') return (probe = Promise.resolve(null));
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 2500);
  probe = fetch('/api/ebw/hello', { cache: 'no-store', signal: ctl?.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((h) => (h && h.app === 'ebw-desktop' ? h : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
  return probe;
}

// payload {project: {library (packed), psf}, opts} → the correction result; onProgress as the page's
// worker reports it; signal aborts (the backend stops the run); base: the server ('' = this page's)
export async function localFracture(payload, onProgress, signal, base = '') {
  const res = await fetch(base + '/api/ebw/fracture', { method: 'POST', body: encodeWire(payload), signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`desktop backend: HTTP ${res.status}`);
  const reader = res.body.getReader();
  let chunks = [], have = 0;                     // received bytes not yet used
  const take = (n) => {                          // the first n bytes as one Uint8Array
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const c = chunks[0], k = Math.min(c.length, n - at);
      out.set(c.subarray(0, k), at); at += k;
      if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
    }
    have -= n;
    return out;
  };
  let need = 5, head = null, result;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) { chunks.push(value); have += value.length; }
    while (have >= need) {
      if (!head) { const h = take(5); head = { kind: h[0], len: new DataView(h.buffer).getUint32(1, true) }; need = head.len; continue; }
      const body = take(head.len), kind = head.kind;
      head = null; need = 5;
      if (kind === 1) onProgress?.(JSON.parse(new TextDecoder().decode(body)));
      else if (kind === 2) result = decodeWire(body);
      else if (kind === 3) throw new Error(JSON.parse(new TextDecoder().decode(body)).error);
    }
    if (done) break;
  }
  if (!result) throw new Error('desktop backend: the run ended without a result');
  return result;
}
