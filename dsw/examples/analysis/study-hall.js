// study-hall.js — Hall-sensor reference runs through the live transim plugin
// (Graphene Transport Explorer): Buttiker multi-terminal ballistic / scattering
// Monte Carlo on a Hall bar. For each job:
//   * R_xy(B) over a field sweep (measure "hall")
//   * R_out: two-terminal resistance between the Hall probes with the current
//     contacts floating (measure "2tb" with the Hall pair as source/drain)
//   * R_2t: source-drain resistance with the Hall probes floating ("2tb")
//   * capped fraction from a single-source run at the largest field
//
//   node study-hall.js <jobs.json> <out.json>
'use strict';
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');

const [, , jobsPath, outPath] = process.argv;
const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
const PORT = +(process.env.PORT || 8090);
const sock = net.connect(PORT, '127.0.0.1', () => {
  sock.write(`GET /ws/transim HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
sock.on('error', e => { console.error('socket error', e.message); process.exit(1); });
function send(obj) {
  const b = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4);
  let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]); else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
  for (let i = 0; i < b.length; i++) b[i] ^= mask[i & 3];
  sock.write(Buffer.concat([h, mask, b]));
}
let buf = Buffer.alloc(0), up = false; const waiters = [], backlog = [];
function waitFor(pred) {
  return new Promise(res => {
    const i = backlog.findIndex(pred);
    if (i >= 0) { const m = backlog[i]; backlog.splice(0, i + 1); res(m); return; }
    waiters.push({ pred, res });
  });
}
sock.on('data', d => {
  buf = Buffer.concat([buf, d]);
  if (!up) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; up = true; buf = buf.slice(i + 4); main().catch(e => { console.error(e); process.exit(1); }); }
  for (;;) {
    if (buf.length < 2) return;
    const op = buf[0] & 0x0F, l0 = buf[1] & 0x7F; let off = 2, len = l0;
    if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + len) return;
    const p = buf.slice(off, off + len); buf = buf.slice(off + len);
    if (op !== 1) continue;
    let m; try { m = JSON.parse(p.toString()); } catch (e) { console.error("unparsable reply (fast-math build?):", p.toString().slice(0, 120)); continue; }
    let taken = false;
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].res(m); waiters.splice(i, 1); taken = true; }
    if (!taken && m.t !== 'progress') backlog.push(m);
  }
});

const enc = cs => cs.map(c => [c.id, c.role, c.x0, c.y0, c.x1, c.y1].join('|')).join(';');

async function sweep(cfg, contacts, measure, bFrom, bTo, bN) {
  send(Object.assign({ t: 'configure' }, cfg));
  send({ t: 'contacts', data: enc(contacts) });
  backlog.length = 0;
  send({ t: 'sweep', sweepType: 'b', measure, quantity: 'R', balMode: 'mc', quality: 'accurate', wantFem: 0, wantBal: 1, snapshots: 0, bFrom, bTo, bN });
  const start = await waitFor(m => m.t === 'sweep_start' || m.t === 'error');
  if (start.t === 'error') throw new Error(start.message);
  const pts = [];
  for (;;) {
    const m = await waitFor(x => x.t === 'sweep_point' || x.t === 'sweep_done' || x.t === 'error');
    if (m.t === 'error') throw new Error(m.message);
    if (m.t === 'sweep_done') break;
    pts.push({ B: m.x, R: m.bal });
  }
  await waitFor(m => m.t === 'job');
  return { pts, trajPerTerminal: start.trajPerTerminal, traj: start.traj };
}

async function capped(cfg, contacts, B) {
  send(Object.assign({ t: 'configure' }, cfg, { B }));
  send({ t: 'contacts', data: enc(contacts) });
  backlog.length = 0;
  send({ t: 'run', mode: cfg.scattering === 'none' ? 'ballistic' : 'quasi' });
  const tr = await waitFor(m => m.t === 'traj' || m.t === 'error');
  await waitFor(m => m.t === 'job' && m.state !== 'running');
  return tr.t === 'traj' ? tr.statuses.max_steps / tr.n : NaN;
}

function linfit(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const a = sxy / sxx, b = my - a * mx;
  let ss = 0; for (let i = 0; i < n; i++) ss += (y[i] - a * x[i] - b) ** 2;
  return { slope: a, intercept: b, slopeErr: Math.sqrt(ss / Math.max(1, n - 2) / sxx) };
}

async function main() {
  await waitFor(m => m.t === 'ready');
  const out = { started: new Date().toISOString(), runs: [] };
  for (const job of jobs.runs) {
    const t0 = Date.now();
    const cfg = Object.assign({}, jobs.base, job.cfg);
    const hall = await sweep(cfg, jobs.contacts, 'hall', -jobs.bMax, jobs.bMax, jobs.bN);
    const fit = linfit(hall.pts.map(p => p.B), hall.pts.map(p => p.R));
    const rout = await sweep(cfg, jobs.contactsHallPair, '2tb', -1e-4, 1e-4, 2);
    const r2t = await sweep(cfg, jobs.contacts, '2tb', -1e-4, 1e-4, 2);
    const cap = await capped(cfg, jobs.contacts, jobs.bMax);
    const Rout = 0.5 * (rout.pts[0].R + rout.pts[1].R), R2t = 0.5 * (r2t.pts[0].R + r2t.pts[1].R);
    const rec = { name: job.name, group: job.group, n: cfg.n_cm2, mu: cfg.scattering === 'none' ? null : cfg.mu_cm, cfg,
      hall: hall.pts, slope: fit.slope, slopeErr: fit.slopeErr, offset: fit.intercept, Rout, R2t, capped: cap, trajPerTerminal: hall.trajPerTerminal };
    out.runs.push(rec);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log(`${job.name}: dRxy/dB ${fit.slope.toFixed(1)} ± ${fit.slopeErr.toFixed(1)} ohm/T (1/ne = ${(1 / (cfg.n_cm2 * 1e4 * 1.602176634e-19)).toFixed(1)}), R_out ${Rout.toFixed(1)} ohm, R_2t ${R2t.toFixed(1)} ohm, capped ${(100 * cap).toFixed(3)} %, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  out.finished = new Date().toISOString();
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  sock.destroy(); process.exit(0);
}
