// The Pro native core (native/core-main.cpp → desktop/bin/ebw-core[.exe]) as a child process, from
// Node: start it, wait for its hello, send requests and get replies. Messages both ways are
// [u32 byte length][EBW2 wire message] (src/core/wire.js), so typed arrays travel as raw bytes.
// Requests are answered in order (the core is single-request, internally multithreaded).
//
//   const core = await startCore();          // null when there is no core binary (JS only, as before)
//   const r = await core.request('srRows', payload);
//   core.close();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWire, decodeWire } from '../src/core/wire.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CORE_EXE = process.env.EBW_CORE || path.join(here, 'bin', process.platform === 'win32' ? 'ebw-core.exe' : 'ebw-core');
export const coreAvailable = () => fs.existsSync(CORE_EXE);

export function startCore({ exe = CORE_EXE, log = () => {} } = {}) {
  if (!fs.existsSync(exe)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { log(`core: could not start (${e.message})`); resolve(null); return; }
    let hello = null, dead = false, nextId = 1, oomSeen = false;
    const waiting = new Map();                     // id → {resolve, reject}
    const fail = (why) => {
      if (dead) return;
      dead = true;
      // a core that died of memory (std::bad_alloc on its error stream) says so: the caller must not retry in JS
      for (const w of waiting.values()) w.reject(Object.assign(new Error(oomSeen ? 'native core: out of memory' : `native core: ${why}`), { oom: oomSeen }));
      waiting.clear();
      if (!hello) resolve(null);
    };
    proc.on('error', (e) => { log(`core: ${e.message}`); fail(e.message); });
    proc.on('exit', (code, sig) => fail(`stopped (${sig || 'exit ' + code})`));
    proc.stderr.on('data', (d) => { if (/bad_alloc|out of memory/i.test(String(d))) oomSeen = true; log(`core: ${String(d).trim()}`); });
    // a failed write (the pipe broke, a message too large) must be seen: it ends the core's input
    proc.stdin.on('error', (e) => { log(`core: write failed (${e.code || e.message})`); fail(`write failed (${e.code || e.message})`); });
    // the pipe delivers 64 kB pieces: they are collected and joined once per message (joining on every
    // piece would copy a 100 MB reply thousands of times)
    let chunks = [], have = 0, need = -1;
    const joined = () => { if (chunks.length > 1) chunks = [Buffer.concat(chunks, have)]; return chunks[0]; };
    proc.stdout.on('data', (chunk) => {
      chunks.push(chunk); have += chunk.length;
      for (;;) {
        if (need < 0) { if (have < 4) break; need = joined().readUInt32LE(0); }
        if (have < 4 + need) break;
        const all = joined();
        const msg = decodeWire(all.subarray(4, 4 + need));
        const rest = all.subarray(4 + need);
        chunks = rest.length ? [rest] : []; have = rest.length; need = -1;
        if (!hello && msg.t === 'hello') {
          hello = msg;
          resolve(api);
          continue;
        }
        const w = waiting.get(msg.id);
        if (!w) continue;
        waiting.delete(msg.id);
        msg.ok ? w.resolve(msg.result) : w.reject(Object.assign(new Error(msg.error || 'native core error'), { oom: !!msg.oom }));
      }
    });
    // Requests go out one after another, in 8 MB pieces with back-pressure: one write of a few hundred MB
    // into the pipe failed with libuv "UNKNOWN" from a worker thread (the Pro correction's), and pieces
    // also keep Node from buffering a second copy of the message.
    const PIECE = 8 << 20;
    let writing = Promise.resolve();
    const writeAll = async (buf) => {
      for (let off = 0; off < buf.length; off += PIECE) {
        if (dead) throw new Error('not running');
        if (!proc.stdin.write(buf.subarray(off, Math.min(buf.length, off + PIECE)))) {
          await new Promise((ok, bad) => {
            const done = () => { proc.stdin.off('drain', done); proc.stdin.off('close', done); proc.stdin.off('error', fail1); ok(); };
            const fail1 = (e) => { proc.stdin.off('drain', done); proc.stdin.off('close', done); bad(e); };
            proc.stdin.on('drain', done); proc.stdin.on('close', done); proc.stdin.once('error', fail1);
          });
        }
      }
    };
    const api = {
      get version() { return hello && hello.version; },
      get supports() { return new Set((hello && hello.supports) || []); },
      get limits() { return (hello && hello.limits) || {}; },
      get alive() { return !dead; },
      get pid() { return proc.pid; },
      // payload: any object (typed arrays travel raw); → the result, typed arrays included
      request(type, payload = {}) {
        if (dead) return Promise.reject(new Error('native core: not running'));
        const id = nextId++;
        const body = Buffer.from(encodeWire({ id, type, payload }));
        if (body.length > 0xffffffff) return Promise.reject(new Error(`native core: a ${(body.length / 2 ** 30).toFixed(1)} GB request is over the 4 GB message limit`));
        const head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0);
        return new Promise((res, rej) => {
          waiting.set(id, { resolve: res, reject: rej });
          writing = writing.then(() => writeAll(head)).then(() => writeAll(body)).catch((e) => {
            if (waiting.has(id)) { waiting.delete(id); rej(new Error(`native core: write failed (${e.code || e.message})`)); }
          });
        });
      },
      close() { if (!dead) { dead = true; try { proc.stdin.end(); } catch { /* gone */ } setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 2000).unref(); } },
      kill() { dead = true; try { proc.kill(); } catch { /* gone */ } },
    };
    setTimeout(() => { if (!hello) { log('core: no hello within 10 s'); api.kill(); resolve(null); } }, 10000).unref();
  });
}
