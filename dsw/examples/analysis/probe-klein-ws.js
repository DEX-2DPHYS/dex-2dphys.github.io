// probe-klein-ws.js — drive the Klein-magnetometer plugin through the live DSW
// host (ws://127.0.0.1:8090/ws/klein-magnetometer): hello -> ready/derived,
// configure, run a curve, run a short sweep, request frames, and assert on the
// replies. Hand-rolled WebSocket, no npm packages.
//
//   node probe-klein-ws.js            # run the checks
//   node probe-klein-ws.js --shot f.png   # also save the device frame
'use strict';
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');
const zlib = require('zlib');

const PLUGIN = 'klein-magnetometer';
const shotIdx = process.argv.indexOf('--shot');
const shotPath = shotIdx > 0 ? process.argv[shotIdx + 1] : null;

let failures = 0;
function check(ok, what) { console.log((ok ? '[ OK ] ' : '[FAIL] ') + what); if (!ok) failures++; }

const sock = net.connect(8090, '127.0.0.1', () => {
  const key = crypto.randomBytes(16).toString('base64');
  sock.write(`GET /ws/${PLUGIN} HTTP/1.1\r\nHost: 127.0.0.1:8090\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
sock.on('error', (e) => { console.log('socket error', e.message, '- is dsw.exe running?'); process.exit(1); });

function send(payloadBuf, opcode) {
  const mask = crypto.randomBytes(4);
  let header;
  if (payloadBuf.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | payloadBuf.length]);
  else if (payloadBuf.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0xFE; header.writeUInt16BE(payloadBuf.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(payloadBuf.length), 2); }
  const m = Buffer.from(payloadBuf);
  for (let i = 0; i < m.length; i++) m[i] ^= mask[i & 3];
  sock.write(Buffer.concat([header, mask, m]));
}
const sendJson = (o) => send(Buffer.from(JSON.stringify(o)), 1);
const askFrame = () => send(Buffer.from('f'), 1);

let buf = Buffer.alloc(0), upgraded = false;
const msgs = [];
let lastFrame = null;
const waiters = [];
function waitFor(pred, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const hit = msgs.find(pred);
    if (hit) return resolve(hit);
    const w = { pred, resolve, timer: setTimeout(() => reject(new Error('timeout waiting')), timeoutMs) };
    waiters.push(w);
  });
}
function deliver(m) {
  msgs.push(m);
  for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { clearTimeout(waiters[i].timer); waiters[i].resolve(m); waiters.splice(i, 1); }
}

sock.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  if (!upgraded) {
    const i = buf.indexOf('\r\n\r\n');
    if (i < 0) return;
    upgraded = true; buf = buf.slice(i + 4);
    main().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
  }
  for (;;) {
    if (buf.length < 2) return;
    const op = buf[0] & 0x0F, len0 = buf[1] & 0x7F;
    let off = 2, len = len0;
    if (len0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + len) return;
    const payload = buf.slice(off, off + len);
    buf = buf.slice(off + len);
    if (op === 2 && payload.slice(0, 4).toString() === 'DXF1') {
      lastFrame = { w: payload.readUInt32LE(4), h: payload.readUInt32LE(8), pix: payload.slice(12) };
      deliver({ t: '__frame' });
    } else if (op === 1) {
      try { deliver(JSON.parse(payload.toString())); } catch (e) { console.log('bad json', payload.toString().slice(0, 100)); }
    }
  }
});

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : crc32(td)); return Buffer.concat([len, td, crc]); };
  function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  console.log('WS upgraded');
  sendJson({ t: 'hello' });
  const ready = await waitFor((m) => m.t === 'ready');
  check(ready.threads >= 1 && typeof ready.version === 'string', `ready: ${ready.threads} threads, core ${ready.version}`);
  const derived0 = await waitFor((m) => m.t === 'derived');
  check(Math.abs(derived0.kF - 1.7725e8) / 1.7725e8 < 1e-3 && derived0.modes === 564, `derived: kF ${derived0.kF.toExponential(4)}, modes ${derived0.modes}, kFd ${derived0.kFd.toFixed(2)}, T30 ${derived0.T30.toFixed(3)} (asymptotic ${derived0.T30asym.toFixed(3)})`);
  check(derived0.worstUnitarity < 1e-6, `Dirac tables unitarity ${derived0.worstUnitarity.toExponential(1)}, window ${derived0.window_nm.toFixed(1)} nm, mismatch ${derived0.mismatch.toExponential(1)}`);

  // the June optimum with the asymptotic formula, modest statistics
  msgs.length = 0;
  sendJson({ t: 'configure', tag: 'june', nCells: 16, L_um: 0.5, W_um: 10, n_cm2: 1e12, profile: 'asymptotic', d_nm: 10, mfp_um: 30, scatter: 'forward', forwardSigmaDeg: 10,
             engine: 'mc', nTraj: 20000, bMin_mT: -20, bMax_mT: 20, bN: 41, seed: 13, biasA_uA: 10, noiseTempK: 20, nEnergy: 1, maxPathFactor: 6 });
  const derived1 = await waitFor((m) => m.t === 'derived' && m.tag === 'june');
  check(derived1.params.nCells === 16 && derived1.params.profile === 'asymptotic' && derived1.params.nTraj === 20000, `configure round-trips through derived.params (nCells ${derived1.params.nCells}, profile ${derived1.params.profile}, nTraj ${derived1.params.nTraj}, d_nm ${derived1.params.d_nm})`);
  const t0 = Date.now();
  sendJson({ t: 'run', mode: 'curve' });
  const curve = await waitFor((m) => m.t === 'curve');
  const ms = Date.now() - t0;
  const nProg = msgs.filter((m) => m.t === 'progress').length;
  check(curve.B_mT.length === 41 && curve.R.length === 41 && curve.T.length === 41, `curve: 41 points in ${ms} ms (${nProg} progress messages, core ${curve.ms.toFixed(0)} ms)`);
  const m = curve.metrics;
  check(Math.abs(m.R0global - 62.4) / 62.4 < 0.06, `R0 ${m.R0global.toFixed(2)} ohm (June 62.4)`);
  check(Math.abs(m.fwhm_mT - 27.9) / 27.9 < 0.2, `FWHM ${m.fwhm_mT.toFixed(1)} mT (June 27.9)`);
  check(m.peakSensParabola > 250 && m.peakSensParabola < 420, `parabola sensitivity ${m.peakSensParabola.toFixed(0)} /T (June 331), true interior slope ${m.peakSens.toFixed(0)} /T at ${m.peakSlopeB_mT} mT${m.peakAtEdge ? ' (still rising at the window edge)' : ''}`);
  check(m.bMinFlank_nT > 0.8 && m.bMinFlank_nT < 4, `B_min flank ${m.bMinFlank_nT.toFixed(2)} nT/rtHz, vertex ${(m.bMinVertex_nT / 1000).toFixed(1)} uT`);
  check(curve.params && curve.params.seed === 13 && curve.nodes.length === 1, 'curve carries its full parameter set and energy nodes');
  await waitFor((mm) => mm.t === 'job' && mm.state === 'done');

  // paths + frame
  msgs.length = 0;
  sendJson({ t: 'run', mode: 'paths', B_mT: 15, n: 120 });
  const paths = await waitFor((mm) => mm.t === 'paths');
  check(paths.points > 120, `paths: ${paths.points} points for ${paths.n} trajectories at ${paths.B_mT} mT`);
  askFrame();
  await waitFor((mm) => mm.t === '__frame');
  let different = 0; const pix = lastFrame.pix;
  for (let i = 4; i < pix.length; i += 4) if (pix[i] !== pix[0] || pix[i + 1] !== pix[1] || pix[i + 2] !== pix[2]) different++;
  check(lastFrame.w === 960 && lastFrame.h === 540 && different > 20000, `frame 960x540, ${different} non-background pixels`);
  if (shotPath) { fs.writeFileSync(shotPath, png(lastFrame.w, lastFrame.h, pix)); console.log('       frame saved to ' + shotPath); }

  // a short sweep in N
  msgs.length = 0;
  sendJson({ t: 'configure', tag: 'sw', nTraj: 4000, bN: 21 });
  await waitFor((mm) => mm.t === 'derived' && mm.tag === 'sw');
  sendJson({ t: 'run', mode: 'sweep', param: 'nCells', from: 4, to: 16, n: 3 });
  const start = await waitFor((mm) => mm.t === 'sweep_start');
  check(start.n === 3 && start.xs.join() === '4,10,16', `sweep_start ${start.param}: ${start.xs.join(', ')}`);
  await waitFor((mm) => mm.t === 'sweep_done');
  const pts = msgs.filter((mm) => mm.t === 'sweep_point');
  check(pts.length === 3 && pts.every((p) => p.curve && p.curve.R.length === 21), `3 sweep points, each with a 21-point curve`);
  check(pts[2].curve.metrics.mrDepth > pts[0].curve.metrics.mrDepth, `MR depth grows with N: ${pts.map((p) => p.curve.metrics.mrDepth.toFixed(2)).join(' -> ')}`);

  // stop responsiveness: start a big curve, stop it
  msgs.length = 0;
  sendJson({ t: 'configure', tag: 'big', nTraj: 2000000, bN: 81 });
  await waitFor((mm) => mm.t === 'derived' && mm.tag === 'big');
  sendJson({ t: 'run', mode: 'curve' });
  await waitFor((mm) => mm.t === 'progress');
  const ts = Date.now();
  sendJson({ t: 'stop' });
  await waitFor((mm) => mm.t === 'job' && mm.state === 'stopped');
  check(Date.now() - ts < 1500, `stop acknowledged in ${Date.now() - ts} ms`);

  // coherent sidebar, small
  msgs.length = 0;
  sendJson({ t: 'configure', tag: 'coh', nCells: 4, profile: 'gate', W_um: 2 });
  await waitFor((mm) => mm.t === 'derived' && mm.tag === 'coh');
  const tc = Date.now();
  sendJson({ t: 'run', mode: 'coherent', eRange_meV: 10, eN: 41, kyN: 17 });
  const coh = await waitFor((mm) => mm.t === 'coherent', 300000);
  check(coh.eps_meV.length === 41 && coh.Tcoh.every((v) => v >= 0 && v <= 1) && Math.max(...coh.worstUnit) < 1e-5,
        `coherent: 41 energies in ${Date.now() - tc} ms, worst unitarity ${Math.max(...coh.worstUnit).toExponential(1)}, T_coh(EF) ${coh.TcohEF.toFixed(3)} vs incoherent ${coh.TincEF.toFixed(3)}`);
  check(coh.visibility.length === coh.temps.length && coh.visibility[0] >= coh.visibility[coh.visibility.length - 1],
        `FP visibility falls with T: ${coh.temps.map((t, i) => `${t}K:${(coh.visibility[i] * 100).toFixed(1)}%`).join(' ')}`);

  console.log(failures ? `FAILED (${failures})` : 'ALL CLEAR');
  sock.destroy();
  process.exit(failures ? 2 : 0);
}
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 600000);
