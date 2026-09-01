// Does the registry height damping actually do anything?
//
// Registry is a statement about how two lattices sit relative to each other.
// Inside an inflated blister they are far apart and the question is meaningless
// -- but the plain x,y formula answers it anyway, painting a confident moire
// across a region where there is no registry at all. That is exactly the part
// of a twisted bubble one is trying to read, so it matters.
//
// The check: inflate a blister, then compare the registry CONTRAST inside the
// footprint with damping off and on. Off, inside should look like outside. On,
// inside should be visibly flatter.
//
//   node probe-mb-regdamp.js [plugin]

const crypto = require("crypto"), net = require("net");
const PLUG = process.argv[2] || "moire-bubble";
const R_NM = 4, P_MPA = 900, TWIST = 3.0;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let chunks = [], total = 0, up = false, S = null, bin = null;

const sock = net.connect(8090, "127.0.0.1", () => {
  sock.write("GET /ws/" + PLUG + " HTTP/1.1\r\nHost:127.0.0.1:8090\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
    crypto.randomBytes(16).toString("base64") + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
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
const state = async () => { S = null; send({ t: "state", q: 1 });
  for (let i = 0; i < 400 && !S; i++) await sleep(25); return S; };

const MAGIC = 0x314C424D;
async function frame() {
  bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 400 && !bin; i++) await sleep(25);
  if (!bin) return null;
  let o = bin.readUInt32LE(0) === MAGIC ? 0 : (bin.readUInt32LE(12) === MAGIC ? 12 : -1);
  if (o < 0) return null;
  const flags = bin.readUInt32LE(o + 4);
  const n1 = bin.readUInt32LE(o + 8), n2 = bin.readUInt32LE(o + 12), ns = bin.readUInt32LE(o + 16);
  let q = o + 32;
  const L2 = [];
  q += 12 * n1;
  for (let i = 0; i < n2; i++, q += 12)
    L2.push([bin.readFloatLE(q), bin.readFloatLE(q + 4), bin.readFloatLE(q + 8)]);
  if (flags & 2) q += 12 * ns;
  let reg2 = null;
  if (flags & 4) { q += 4 * n1; reg2 = []; for (let i = 0; i < n2; i++, q += 4) reg2.push(bin.readFloatLE(q)); }
  return { L2, reg2, flags };
}

const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

async function measure(damp) {
  send({ t: "params", registry: 1, regGamma: 1, regHeightDamp: damp });
  await sleep(700);
  const f = await frame();
  if (!f || !f.reg2) return null;
  const R = R_NM * 10;
  const inside = [], outside = [];
  let zin = 0, nin = 0;
  for (let i = 0; i < f.L2.length; i++) {
    const r = Math.hypot(f.L2[i][0], f.L2[i][1]);
    if (r < 0.6 * R) { inside.push(f.reg2[i]); zin += f.L2[i][2]; nin++; }
    else if (r > 1.6 * R) outside.push(f.reg2[i]);
  }
  return { inSd: sd(inside), outSd: sd(outside), zin: nin ? zin / nin : 0,
           nin: inside.length, nout: outside.length };
}

async function run() {
  console.log("registry height damping: " + PLUG + "\n");
  send({ t: "build", Nnm: 30, Nsubnm: 36, twistDeg: TWIST, z0: 3.35, zSub: 3.35,
         substrateOn: 1, gasWhere: "between", bubbleRnm: R_NM, bubbleP: P_MPA,
         Cxnm: 0, Cynm: 0, stepsPerFrame: 60 });
  for (let i = 0; i < 200; i++) { const s = await state(); if (s && s.n2 > 0) break; await sleep(300); }

  send({ t: "gas", on: 1 });
  send({ t: "run", on: 1 });
  console.log("  inflating...");
  for (let i = 0; i < 40; i++) { await sleep(1000); const s = await state();
    if (s && s.fill >= 0.999) break; }
  send({ t: "run", on: 0 });
  await sleep(500);
  const st = await state();
  console.log("  fill " + (st ? (100 * st.fill).toFixed(0) : "?") + " %   blister radius " +
              (st ? st.gasR.toFixed(1) : "?") + " A\n");

  const off = await measure(0);
  const on = await measure(1);
  if (!off || !on) { console.log("  no registry data"); process.exit(1); }

  console.log("  mean height of layer 2 inside the footprint: " + on.zin.toFixed(2) + " A" +
              "   (flat would be " + (3.35 + 3.35).toFixed(2) + ")");
  console.log("  atoms sampled: " + on.nin + " inside, " + on.nout + " outside\n");
  console.log("  damping   sd(registry) inside   sd outside   inside/outside");
  console.log("  -------   -------------------   ----------   --------------");
  for (const [n, m] of [["off", off], ["on ", on]])
    console.log("  " + n + "       " + m.inSd.toFixed(4).padStart(17) + "   " +
                m.outSd.toFixed(4).padStart(10) + "   " +
                (m.inSd / m.outSd).toFixed(3).padStart(14));

  const ratioOff = off.inSd / off.outSd, ratioOn = on.inSd / on.outSd;
  const lifted = on.zin > 3.35 + 3.35 + 0.5;
  const checks = [
    ["the blister actually inflated", lifted],
    ["undamped, inside is as textured as outside", ratioOff > 0.6],
    ["damping flattens the inside", ratioOn < 0.75 * ratioOff],
    ["damping leaves the far field alone", Math.abs(on.outSd - off.outSd) / off.outSd < 0.15],
  ];
  console.log("");
  let bad = 0;
  for (const [n, ok] of checks) { console.log("  " + (ok ? "PASS" : "FAIL") + "  " + n); if (!ok) bad++; }
  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 600000);
