// Physics probe for the moire-bubble plugin. The point of this plugin is that
// BOTH layers are alive and the gas can go in either gap, so the checks are
// about which layer moves, and by how much.

const crypto = require("crypto"), net = require("net");
const MAGIC = 0x314C424D;   // 'MBL1'
let fails = 0;
const ok = (n, c, d = "") => { if (!c) fails++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${d ? "   " + d : ""}`); };

const sock = net.connect(8090, "127.0.0.1", () => {
  sock.write("GET /ws/moire-bubble HTTP/1.1\r\nHost:127.0.0.1:8090\r\nUpgrade: websocket\r\n" +
    "Connection: Upgrade\r\nSec-WebSocket-Key: " + crypto.randomBytes(16).toString("base64") +
    "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
sock.on("error", e => { console.log("socket error: " + e.message); process.exit(1); });

let chunks = [], total = 0, up = false, S = null, bin = null;
const peek = n => { if (total < n) return null;
  if (chunks[0].length >= n) return chunks[0].subarray(0, n);
  const b = Buffer.concat(chunks, total); chunks = [b]; return b.subarray(0, n); };
const take = n => { const b = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
  chunks = [b.subarray(n)]; total -= n; if (!chunks[0].length) chunks = []; return b.subarray(0, n); };
sock.on("data", d => {
  chunks.push(d); total += d.length;
  if (!up) { const b = Buffer.concat(chunks, total); const i = b.indexOf("\r\n\r\n");
    if (i < 0) { chunks = [b]; return; }
    up = true; chunks = [b.subarray(i + 4)]; total = chunks[0].length;
    if (!total) chunks = []; setTimeout(run, 250); }
  for (;;) { const h = peek(2); if (!h) return;
    const op = h[0] & 15; let len = h[1] & 127, off = 2;
    if (len === 126) { const q = peek(4); if (!q) return; len = q.readUInt16BE(2); off = 4; }
    else if (len === 127) { const q = peek(10); if (!q) return; len = Number(q.readBigUInt64BE(2)); off = 10; }
    if (total < off + len) return; take(off); const p = take(len);
    if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") S = m; } catch {} }
    else if (op === 2) bin = p; }
});
const send = v => { const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
  let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x])); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = async () => { S = null; send({ t: "state", q: 1 });
  for (let i = 0; i < 400 && !S; i++) await sleep(25); return S; };

let lastSub = null;
async function frame() {
  bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 400 && !bin; i++) await sleep(25);
  if (!bin) return null;
  let o = bin.readUInt32LE(0) === MAGIC ? 0 : 12;
  const flags = bin.readUInt32LE(o + 4);
  const n1 = bin.readUInt32LE(o + 8), n2 = bin.readUInt32LE(o + 12), ns = bin.readUInt32LE(o + 16);
  const step = bin.readUInt32LE(o + 20);
  let q = o + 32;
  const rd = n => { const a = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) a[i] = bin.readFloatLE(q + 4 * i); q += 12 * n; return a; };
  const l1 = rd(n1), l2 = rd(n2);
  if (flags & 2) lastSub = rd(ns);
  return { step, n1, n2, ns, l1, l2, sub: lastSub };
}
const meanZ = (a, rmax) => { let s = 0, c = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (rmax !== undefined && Math.hypot(a[i], a[i+1]) > rmax) continue;
    s += a[i+2]; c++; }
  return c ? s / c : NaN; };

async function build(extra) {
  send(Object.assign({ t: "build", Nnm: 12, Nsubnm: 15, twistDeg: 2, z0: 3.35, zSub: 3.35,
                       bubbleRnm: 2, bubbleP: 800, gamma: 1.0, stepsPerFrame: 40,
                       fillRate: 0.01 }, extra));
  for (let i = 0; i < 200; i++) { const s = await state(); if (s && s.n1 > 0) break; await sleep(300); }
  return await state();
}

async function run() {
  console.log("=== build: two live layers plus a rigid substrate ===");
  let s = await build({});
  let f = await frame();
  ok("frame parses", !!f);
  ok("two layers of equal size", f.n1 === f.n2 && f.n1 > 100, `n1=${f.n1} n2=${f.n2}`);
  ok("substrate present", f.ns > 0, `nsub=${f.ns}`);
  ok("layers stacked at the right heights",
     Math.abs(meanZ(f.l1) - 3.35) < 0.4 && Math.abs(meanZ(f.l2) - 6.70) < 0.4,
     `z1=${meanZ(f.l1).toFixed(2)} z2=${meanZ(f.l2).toFixed(2)}`);
  ok("state agrees with the frame", s.n1 === f.n1 && s.n2 === f.n2);

  console.log("\n=== the twist is real: layer 2 is rotated, layer 1 is not ===");
  // a corner atom of each layer, compared with the same index
  const ang = a => Math.atan2(a[1], a[0]) * 180 / Math.PI;
  let best = 0, bi = 0;
  for (let i = 0; i < f.n1; i++) { const r = Math.hypot(f.l1[3*i], f.l1[3*i+1]);
    if (r > best) { best = r; bi = i; } }
  const d = ((ang(f.l2.subarray(3*bi)) - ang(f.l1.subarray(3*bi))) + 540) % 360 - 180;
  ok("relative rotation is the requested twist", Math.abs(Math.abs(d) - 2) < 0.35,
     `measured ${d.toFixed(2)} deg at r = ${best.toFixed(0)} A`);

  console.log("\n=== quiet without gas ===");
  send({ t: "step", n: 400 }); await sleep(2500);
  const f2 = await frame();
  ok("nothing runs away with the gas off",
     Math.abs(meanZ(f2.l2) - meanZ(f.l2)) < 0.5,
     `z2 ${meanZ(f.l2).toFixed(3)} -> ${meanZ(f2.l2).toFixed(3)}`);

  console.log("\n=== gas BETWEEN the layers lifts layer 2, not layer 1 ===");
  s = await build({ gasWhere: "between" });
  const a0 = await frame();
  send({ t: "gas", on: 1 }); send({ t: "run", on: 1 });
  await sleep(9000);
  send({ t: "run", on: 0 }); await sleep(400);
  const a1 = await frame(); s = await state();
  const d2 = meanZ(a1.l2, 20) - meanZ(a0.l2, 20);
  const d1 = meanZ(a1.l1, 20) - meanZ(a0.l1, 20);
  ok("layer 2 rises", d2 > 0.4, `dz2 = ${d2.toFixed(3)} A`);
  ok("layer 1 does NOT rise with it", d1 < d2 * 0.5,
     `dz1 = ${d1.toFixed(3)} A vs dz2 = ${d2.toFixed(3)} A`);
  ok("pressure is reported and finite", s.gasP > 0 && isFinite(s.gasP),
     `${(s.gasP/1e6).toFixed(0)} MPa`);
  ok("peel radius is an output and at least the seed",
     s.gasR >= 19, `gasR = ${Number(s.gasR).toFixed(1)} A (seed 20 A)`);

  console.log("\n=== gas BELOW the bilayer lifts BOTH layers together ===");
  s = await build({ gasWhere: "below" });
  const b0 = await frame();
  send({ t: "gas", on: 1 }); send({ t: "run", on: 1 });
  await sleep(9000);
  send({ t: "run", on: 0 }); await sleep(400);
  const b1 = await frame(); s = await state();
  const e1 = meanZ(b1.l1, 20) - meanZ(b0.l1, 20);
  const e2 = meanZ(b1.l2, 20) - meanZ(b0.l2, 20);
  ok("layer 1 rises", e1 > 0.4, `dz1 = ${e1.toFixed(3)} A`);
  ok("layer 2 is carried up with it", e2 > 0.5 * e1,
     `dz2 = ${e2.toFixed(3)} A vs dz1 = ${e1.toFixed(3)} A`);
  ok("the two stay bound (spacing roughly preserved)",
     Math.abs((meanZ(b1.l2,20)-meanZ(b1.l1,20)) - (meanZ(b0.l2,20)-meanZ(b0.l1,20))) < 1.2,
     `gap ${(meanZ(b0.l2,20)-meanZ(b0.l1,20)).toFixed(2)} -> ${(meanZ(b1.l2,20)-meanZ(b1.l1,20)).toFixed(2)} A`);
  ok("substrate never moves", b1.sub && Math.abs(meanZ(b1.sub)) < 1e-6,
     `mean z_sub = ${meanZ(b1.sub).toExponential(1)}`);

  console.log("\n=== that is the distinction the plugin exists for ===");
  ok("between-mode separates the layers, below-mode does not",
     (d2 - d1) > (e2 - e1),
     `between: dz2-dz1 = ${(d2-d1).toFixed(3)} A ; below: ${(e2-e1).toFixed(3)} A`);

  console.log(fails === 0 ? "\nALL CLEAR" : `\n${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 300000);
