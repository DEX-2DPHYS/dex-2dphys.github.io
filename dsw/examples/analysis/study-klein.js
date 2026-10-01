// study-klein.js — run a list of R(B) curves through the live Klein plugin and
// save everything (full curve messages incl. parameters) to one JSON file.
//
//   node study-klein.js <jobs.json> <out.json>
//
// jobs.json: { "base": {configure keys…}, "runs": [ {"name": "...", "group": "...", "x": 4, "cfg": {…}} ] }
// Each run = base ∘ cfg sent as one configure, then run curve. The core's
// echo is checked key by key so a clamped value cannot slip through.
'use strict';
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');

const [, , jobsPath, outPath] = process.argv;
const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
const sock = net.connect(8090, '127.0.0.1', () => {
  sock.write(`GET /ws/klein-magnetometer HTTP/1.1\r\nHost: 127.0.0.1:8090\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
sock.on('error', e => { console.error('socket error', e.message); process.exit(1); });
function send(obj) {
  const b = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4);
  let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]); else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
  for (let i = 0; i < b.length; i++) b[i] ^= mask[i & 3];
  sock.write(Buffer.concat([h, mask, b]));
}
let buf = Buffer.alloc(0), up = false; const waiters = [];
// Messages are kept in a backlog: two replies can arrive in one TCP chunk, and
// a waiter registered after the chunk was parsed must still find its message.
const backlog = [];
function waitFor(pred) {
  return new Promise(res => {
    const i = backlog.findIndex(pred);
    if (i >= 0) { const m = backlog[i]; backlog.splice(0, i + 1); res(m); return; }
    waiters.push({ pred, res });
  });
}
sock.on('data', d => {
  buf = Buffer.concat([buf, d]);
  if (!up) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; up = true; buf = buf.slice(i + 4); main(); }
  for (;;) {
    if (buf.length < 2) return;
    const op = buf[0] & 0x0F, l0 = buf[1] & 0x7F; let off = 2, len = l0;
    if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + len) return;
    const p = buf.slice(off, off + len); buf = buf.slice(off + len);
    if (op !== 1) continue;
    const m = JSON.parse(p.toString());
    let taken = false;
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].res(m); waiters.splice(i, 1); taken = true; }
    if (!taken && m.t !== 'progress') backlog.push(m);
  }
});

async function main() {
  const out = { started: new Date().toISOString(), base: jobs.base, runs: [] };
  let k = 0;
  for (const r of jobs.runs) {
    const cfg = Object.assign({}, jobs.base, r.cfg), tag = 'study' + (++k);
    send(Object.assign({ t: 'configure', tag }, cfg));
    const d = await waitFor(m => m.t === "derived" && m.tag === tag);
    const bad = Object.entries(cfg).filter(([key, v]) => d.params[key] !== undefined && (typeof v === 'string' ? d.params[key] !== v : Math.abs(d.params[key] - v) > 1e-6 * Math.max(1, Math.abs(v))));
    if (bad.length) { console.error(`run ${r.name}: core changed ${bad.map(([a, v]) => `${a} ${v}->${d.params[a]}`).join(', ')}`); process.exit(2); }
    const t0 = Date.now();
    backlog.length = 0; send({ t: 'run', mode: 'curve' });
    const c = await waitFor(m => m.t === 'curve');
    await waitFor(m => m.t === 'job');
    const iz = c.B_mT.reduce((b, v, i) => Math.abs(v) < Math.abs(c.B_mT[b]) ? i : b, 0);
    console.log(`${r.group || ''} ${r.name}: T0 ${c.T[iz].toFixed(4)}  R0 ${c.metrics.R0.toFixed(2)}  depth ${(100 * c.metrics.mrDepth).toFixed(1)}%  capped≤${(100 * Math.max(...c.capped)).toFixed(1)}%  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    out.runs.push({ name: r.name, group: r.group, x: r.x, label: r.label, derived: d, curve: c });
    fs.writeFileSync(outPath, JSON.stringify(out));
  }
  out.finished = new Date().toISOString();
  fs.writeFileSync(outPath, JSON.stringify(out));
  sock.destroy(); process.exit(0);
}
