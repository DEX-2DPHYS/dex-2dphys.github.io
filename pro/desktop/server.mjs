// EBL Workbench Pro backend: serves the Workbench page from this computer and runs the heavy work —
// the fractured correction in Node, on all cores and with the computer's memory instead of a browser
// worker's ~4 GB, and (with the native core, native/ → desktop/bin/ebw-core) the Monte Carlo, the
// short-range operator, the solve and KOH in C++. The page is the ordinary EBL Workbench.html; served
// from here it finds /api/ebw/hello and hands that work over (src/ui/local.js, src/ui/native.js).
// Opened from file:// it works alone. Without the core binary everything runs as before, in JS.
//
//   node desktop/server.mjs [--port 8095] [--no-open]
//
// Binds 127.0.0.1 only. Endpoints:
//   GET  /api/ebw/hello      {app, version, cores, helpers, memGB, maxPoints, core: {version, supports, threads} | null}
//   POST /api/ebw/core       body: wire {type, payload} → wire {ok, result} | {ok: false, error}  (the page's core)
//   POST /api/ebw/fracture   body: wire {project, opts}; response: a stream of records
//                            [u8 kind][u32 length][bytes]: 1 progress (JSON), 2 result (wire), 3 error (JSON)
//                            closing the request cancels the run
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { startCore, coreAvailable } from './core.mjs';
import { encodeWire, decodeWire } from '../src/core/wire.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');                 // the EBL Workbench folder
const PAGE = 'EBL Workbench.html';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = +(arg('--port', process.env.EBW_PORT || 8095));
const CORES = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
const HELPERS = +(process.env.EBW_HELPERS || Math.max(1, Math.min(16, CORES - 2)));
const MEM = os.totalmem();
// heap of the correction thread: most of the machine (typed arrays live outside it and count against RAM only)
const PEC_HEAP_MB = Math.floor((MEM / 1048576) * 0.6);
// how many control points a run may have: about 700 bytes a point all told (fragments, points,
// short-range rows, solve), within 70 % of the memory
const MAX_POINTS = Math.floor((MEM * 0.7) / 700);
const VERSION = '2';

// the page's native core (Monte Carlo, KOH): one process, started now and again if it stops
// (a fractured correction starts its own, in its thread, so cancelling one kills only that one)
let pageCore = null, pageCoreStarting = null;
const coreCalls = {};                    // requests the page's core answered, by type (hello shows them)
const corelog = (s) => console.log(s);
function getPageCore() {
  if (pageCore && pageCore.alive) return Promise.resolve(pageCore);
  if (!pageCoreStarting) pageCoreStarting = startCore({ log: corelog }).then((c) => { pageCore = c; pageCoreStarting = null; return c; });
  return pageCoreStarting;
}
await getPageCore();

function coreRequest(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const reply = (obj) => { const b = Buffer.from(encodeWire(obj)); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-store' }); res.end(b); };
    try {
      const { type, payload } = decodeWire(Buffer.concat(chunks)); chunks.length = 0;
      const core = await getPageCore();
      if (!core) { reply({ ok: false, error: 'no native core' }); return; }
      const t0 = Date.now();
      const result = await core.request(type, payload);
      coreCalls[type] = (coreCalls[type] || 0) + 1;
      if (Date.now() - t0 > 1000) console.log(`core: ${type} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      reply({ ok: true, result });
    } catch (e) { reply({ ok: false, error: (e && e.message) || String(e) }); }
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.gds': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };

function serveFile(req, res, rel) {
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { if (!/favicon/.test(rel)) console.log('404', rel); res.writeHead(404).end('not found'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {                                            // videos seek with ranges
      let a = range[1] === '' ? st.size - +range[2] : +range[1], b = range[1] !== '' && range[2] !== '' ? +range[2] : st.size - 1;
      if (a < 0) a = 0;
      if (a >= st.size || b < a) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      b = Math.min(b, st.size - 1);
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

function record(res, kind, bytes) {
  const h = Buffer.alloc(5);
  h.writeUInt8(kind, 0); h.writeUInt32LE(bytes.length, 1);
  res.write(h); res.write(bytes);
}

let running = 0;
function fracture(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks); chunks.length = 0;
    const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    // Connection: close - a kept-alive socket the server later times out can be reused by the client for
    // the next POST and fail (Node's fetch did, after a 5 s pause between runs)
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
    // helpers by the memory free now: each holds its share of the layout (the arrays in every share), and 16 of
    // them took a machine with a small page file to its last gigabyte of commit while fracturing ChipV11
    const helpers = Math.max(2, Math.min(HELPERS, Math.floor(os.freemem() / (1.5 * 2 ** 30))));
    const w = new Worker(new URL('./pec-worker.mjs', import.meta.url), {
      workerData: { body: ab, helpers, core: coreAvailable() }, transferList: [ab],
      resourceLimits: { maxOldGenerationSizeMb: PEC_HEAP_MB },
    });
    running++;
    const t0 = Date.now();
    console.log(`correction started (${(body.length / 1e6).toFixed(1)} MB in, ${helpers} helpers, ${(os.freemem() / 2 ** 30).toFixed(1)} GB free)`);
    let finished = false, corePid = 0;
    // the run's own native core dies with the run (a terminated thread leaves its child running)
    const killCore = () => { if (corePid) { try { process.kill(corePid); } catch { /* gone */ } corePid = 0; } };
    const end = (msg) => { if (finished) return; finished = true; running--; console.log(msg); res.end(); killCore(); };
    w.on('message', (m) => {
      if (m.corePid) { corePid = m.corePid; return; }
      if (m.coreUsed) { console.log(`  native core: ${m.coreUsed}`); return; }
      if (m.progress) { record(res, 1, Buffer.from(JSON.stringify(m.progress))); return; }
      if (m.done) { record(res, 2, Buffer.from(m.done)); end(`correction done in ${((Date.now() - t0) / 1000).toFixed(1)} s (${(m.done.byteLength / 1e6).toFixed(1)} MB out)`); w.terminate(); return; }
      if (m.error) { record(res, 3, Buffer.from(JSON.stringify({ error: m.error }))); end(`correction failed: ${m.error}`); w.terminate(); }
    });
    w.on('error', (e) => { if (!finished) record(res, 3, Buffer.from(JSON.stringify({ error: e.message || String(e) }))); end(`correction thread error: ${e.message}`); });
    w.on('exit', () => { if (!finished) { if (!res.writableEnded) record(res, 3, Buffer.from(JSON.stringify({ error: 'the correction thread stopped (out of memory?)' }))); end('correction thread exited'); } });
    // the page closed the request: cancelled
    res.on('close', () => { if (!finished) { end('correction cancelled'); w.terminate(); } });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/api/ebw/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const core = pageCore && pageCore.alive ? { version: pageCore.version, supports: [...pageCore.supports], threads: pageCore.limits.threads, calls: coreCalls, pid: pageCore.pid } : null;
    res.end(JSON.stringify({ app: 'ebw-desktop', version: VERSION, cores: CORES, helpers: HELPERS, memGB: +(MEM / 2 ** 30).toFixed(1), maxPoints: MAX_POINTS, running, core }));
    return;
  }
  if (p === '/api/ebw/fracture' && req.method === 'POST') { fracture(req, res); return; }
  if (p === '/api/ebw/core' && req.method === 'POST') { coreRequest(req, res); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (p === '/') { res.writeHead(302, { Location: '/' + encodeURIComponent(PAGE) }).end(); return; }
  serveFile(req, res, p);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.requestTimeout = 0;      // a large layout can take a while to upload
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is in use - probably the Workbench is already running. Opening it.`);
    if (!process.argv.includes('--no-open')) openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  throw e;
});

function openBrowser() {
  const u = `http://127.0.0.1:${PORT}/${encodeURIComponent(PAGE)}`;
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`EBL Workbench Pro: http://127.0.0.1:${PORT}/  (${CORES} threads, ${HELPERS} helpers, ${(MEM / 2 ** 30).toFixed(0)} GB, up to ${(MAX_POINTS / 1e6).toFixed(0)} M control points)`);
  console.log(pageCore ? `Native core ${pageCore.version}: ${pageCore.limits.threads} threads (Monte Carlo, short range, solve, KOH in C++).` : 'No native core (desktop/bin/ebw-core): everything runs in JavaScript.');
  console.log('Keep this window open while you work; close it to stop the Workbench backend.');
  if (!process.argv.includes('--no-open')) openBrowser();
});
