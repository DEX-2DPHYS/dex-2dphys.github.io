// Does the edge clamp hold the flake?
//
// A free rim lets a growing blister feed itself by dragging the whole sheet
// inward, so the radius you measure is partly the flake walking. The claim is
// that edgeK stops that. Bounded is not enough -- measure the rim.
//
//   node probe-mb-edge.js [plugin]

const crypto = require("crypto"), net = require("net");
const PLUG = process.argv[2] || "moire-bubble";
const R_NM = 4, P_MPA = 1200, SECS = 25;

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
async function layer2() {
  bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 400 && !bin; i++) await sleep(25);
  if (!bin) return null;
  let o = bin.readUInt32LE(0) === MAGIC ? 0 : (bin.readUInt32LE(12) === MAGIC ? 12 : -1);
  if (o < 0) return null;
  const n1 = bin.readUInt32LE(o + 8), n2 = bin.readUInt32LE(o + 12);
  let q = o + 32 + 12 * n1;
  const out = [];
  for (let i = 0; i < n2; i++, q += 12)
    out.push([bin.readFloatLE(q), bin.readFloatLE(q + 4), bin.readFloatLE(q + 8)]);
  return out;
}
// mean radius of the outermost 3 % of atoms: the flake's rim
const rimRadius = pts => {
  const r = pts.map(p => Math.hypot(p[0], p[1])).sort((a, b) => b - a);
  const k = Math.max(1, Math.floor(r.length * 0.03));
  return r.slice(0, k).reduce((a, b) => a + b, 0) / k;
};

async function trial(edgeK) {
  send({ t: "build", Nnm: 24, Nsubnm: 29, twistDeg: 0, z0: 3.35, zSub: 3.35,
         substrateOn: 1, gasWhere: "between", bubbleRnm: R_NM, bubbleP: P_MPA,
         Cxnm: 0, Cynm: 0, edgeK, stepsPerFrame: 80 });
  for (let i = 0; i < 200; i++) { const s = await state(); if (s && s.n2 > 0) break; await sleep(300); }
  const before = rimRadius(await layer2());
  send({ t: "gas", on: 1 });
  send({ t: "run", on: 1 });
  await sleep(SECS * 1000);
  send({ t: "run", on: 0 });
  await sleep(400);
  const st = await state();
  const after = rimRadius(await layer2());
  return { before, after, creep: before - after, fill: st ? st.fill : 0,
           gasR: st ? st.gasR : 0 };
}

async function run() {
  console.log("edge clamp: " + PLUG + "   blister " + R_NM + " nm at " + P_MPA + " MPa\n");
  console.log("  edgeK    rim before   rim after    inward creep   fill");
  console.log("  -----    ----------   ---------    ------------   ----");
  const res = {};
  for (const k of [0, 1.5]) {
    res[k] = await trial(k);
    const r = res[k];
    console.log("  " + String(k).padEnd(8) + r.before.toFixed(2).padStart(9) + " A " +
                r.after.toFixed(2).padStart(11) + " A " +
                r.creep.toFixed(3).padStart(13) + " A " +
                (100 * r.fill).toFixed(0).padStart(6) + " %");
  }
  const free = res[0].creep, held = res[1.5].creep;
  console.log("");
  const checks = [
    ["both runs inflated", res[0].fill > 0.2 && res[1.5].fill > 0.2],
    ["a free rim creeps inward", free > 0.02],
    ["clamping reduces the creep", held < 0.5 * free],
  ];
  let bad = 0;
  for (const [n, ok] of checks) { console.log("  " + (ok ? "PASS" : "FAIL") + "  " + n); if (!ok) bad++; }
  console.log("\n  creep with a free rim " + free.toFixed(3) + " A, clamped " +
              held.toFixed(3) + " A  (" + (free > 0 ? (100 * held / free).toFixed(0) : "-") + " % of it)");
  console.log("  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 600000);
