// Confirm a stable fixed-N blister and compare it with Hencky's solution --
// the SHAPE w(r) = h0 (1 - (r/R)^2)^(2/3), not just the peak height.
//
//   node gasconfirm.js <Rnm> <pMPa> [sheet_nm] [sub_nm] [seconds]
//
// Writes <out>.json with the measured radial profile so it can be plotted.

const crypto = require("crypto"), net = require("net"), fs = require("fs");

const RNM = +(process.argv[2] || 3), PMPA = +(process.argv[3] || 700);
const NNM = +(process.argv[4] || 20), NSUB = +(process.argv[5] || 24);
const SECS = +(process.argv[6] || 180);
const E2D = 340, Z0 = 3.35, MAGIC = 0x31444d47;
const henckyH0 = 0.709 * (RNM * 1e-9) * Math.cbrt(PMPA * 1e6 * RNM * 1e-9 / E2D) * 1e10;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let chunks = [], total = 0, up = false, S = null, bin = null;

const sock = net.connect(8090, "127.0.0.1", () => {
  sock.write("GET /ws/graphene-md HTTP/1.1\r\nHost:127.0.0.1:8090\r\nUpgrade: websocket\r\n" +
    "Connection: Upgrade\r\nSec-WebSocket-Key: " + crypto.randomBytes(16).toString("base64") +
    "\r\nSec-WebSocket-Version: 13\r\n\r\n");
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

async function frame() {
  bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 400 && !bin; i++) await sleep(25);
  if (!bin) return null;
  let o = bin.readUInt32LE(0) === MAGIC ? 0 : 12;
  const flags = bin.readUInt32LE(o + 4), n = bin.readUInt32LE(o + 8);
  const pos = [];
  let q = o + 32;
  for (let i = 0; i < n; i++)
    pos.push([bin.readFloatLE(q + 12 * i), bin.readFloatLE(q + 12 * i + 4),
              bin.readFloatLE(q + 12 * i + 8)]);
  return pos;
}

async function run() {
  console.log(`Confirming a stable blister: R = ${RNM} nm, P set = ${PMPA} MPa, ` +
              `sheet ${NNM} nm\n  Hencky h0 = ${henckyH0.toFixed(3)} A\n`);
  send({ t: "build", Nnm: NNM, Nsubnm: NSUB, z0: Z0, twistDeg: 0,
         material: "graphene", engine: (process.env.ENGINE || "classic"),
         profile: "bubbleN", protLoc: "between", bubbleRnm: RNM, bubbleP: PMPA,
         gasT: 300, Cxnm: 0, Cynm: 0, elevMode: "const", liftRate: 0.02,
         g: 0.35, stepsPerFrame: 200 });
  for (let i = 0; i < 200; i++) { const s = await state(); if (s && s.n > 0) break; await sleep(400); }
  send({ t: "elev", on: 1 });

  const hist = [];
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < SECS * 1000) {
    await sleep(1000);
    const s = await state();
    if (!s) continue;
    last = s;
    hist.push({ step: s.frame, V: s.gasV, P: s.gasP });
    if (hist.length % 20 === 0)
      console.log(`  step ${String(s.frame).padStart(6)}  V ${s.gasV.toFixed(0).padStart(7)} A^3` +
                  `  P ${(s.gasP / 1e6).toFixed(1).padStart(7)} MPa`);
  }
  send({ t: "run", on: 0 });
  await sleep(400);

  // stability over the last third
  const n = hist.length, t = Math.floor(n / 3);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const v1 = avg(hist.slice(n - 2 * t, n - t).map(r => r.V));
  const v2 = avg(hist.slice(n - t).map(r => r.V));
  const drift = Math.abs(v2 - v1) / v2;
  console.log(`\n  volume drift over the last third: ${(100 * drift).toFixed(2)} %` +
              `  -> ${drift < 0.02 ? "STABLE" : "not settled"}`);
  console.log(`  settled pressure ${(avg(hist.slice(n - t).map(r => r.P)) / 1e6).toFixed(1)} MPa ` +
              `(set ${PMPA} MPa)`);

  // radial profile, and Hencky through the SAME peak height
  const pos = await frame();
  const R = RNM * 10;
  const bins = 24, prof = [];
  for (let k = 0; k < bins; k++) {
    const r0 = R * k / bins, r1 = R * (k + 1) / bins;
    let sum = 0, cnt = 0;
    for (const p of pos) {
      const r = Math.hypot(p[0], p[1]);
      if (r >= r0 && r < r1) { sum += p[2] - Z0; cnt++; }
    }
    if (cnt > 4) prof.push({ r: 0.5 * (r0 + r1), h: sum / cnt, n: cnt });
  }
  const hPeak = prof.length ? prof[0].h : 0;
  console.log(`\n  measured peak height ${hPeak.toFixed(3)} A   vs Hencky ${henckyH0.toFixed(3)} A` +
              `   (${((hPeak / henckyH0 - 1) * 100).toFixed(1)} %)`);
  console.log(`  aspect ratio h/R = ${(hPeak / R).toFixed(3)}` +
              "   (measured graphene bubbles sit at 0.10-0.20)\n");
  console.log("    r/R     h measured   Hencky shape   difference");
  console.log("    -----   ----------   ------------   ----------");
  let worst = 0;
  for (const q of prof) {
    const rho = q.r / R;
    const hH = hPeak * Math.pow(Math.max(0, 1 - rho * rho), 2 / 3);
    worst = Math.max(worst, Math.abs(q.h - hH));
    console.log(`    ${rho.toFixed(3)}   ${q.h.toFixed(3).padStart(8)} A   ` +
                `${hH.toFixed(3).padStart(9)} A   ${(q.h - hH).toFixed(3).padStart(8)} A`);
  }
  console.log(`\n  worst deviation from the Hencky shape: ${worst.toFixed(3)} A ` +
              `(${(100 * worst / Math.max(hPeak, 1e-9)).toFixed(1)} % of peak)`);
  fs.writeFileSync(`gasconfirm-R${RNM}-P${PMPA}-${process.env.ENGINE||"classic"}.json`,
                   JSON.stringify({ RNM, PMPA, henckyH0, hPeak, drift, prof, hist }, null, 1));
  console.log(`  -> gasconfirm-R${RNM}-P${PMPA}.json`);
  process.exit(0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 900000);
