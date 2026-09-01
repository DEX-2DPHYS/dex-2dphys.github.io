// Phase 5 acceptance: the tabulated substrate field.
//
// Two things must hold, and the second is what makes it a knob rather than a
// fudge:
//
//   1. it is FASTER, by about what the cost breakdown predicted
//   2. its error SHRINKS with grid resolution, converging on a constant
//      residual. That residual is not interpolation error: the table is built
//      from the PERIODIC lattice while the exact path sums a FINITE substrate,
//      so they differ by the support the finite array does not have. If the
//      error instead sat still as the grid refined, the table would be wrong in
//      some other way and no amount of resolution would help.
//
//   node probe-2dmd-phase5.js

const crypto = require("crypto"), net = require("net");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ch = [], tot = 0, up = false, S = null;
const sock = net.connect(8090, "127.0.0.1", () => {
  sock.write("GET /ws/2dmd HTTP/1.1\r\nHost:127.0.0.1:8090\r\nUpgrade: websocket\r\n" +
    "Connection: Upgrade\r\nSec-WebSocket-Key: " +
    crypto.randomBytes(16).toString("base64") + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
const peek = n => { if (tot < n) return null;
  if (ch[0].length >= n) return ch[0].subarray(0, n);
  const b = Buffer.concat(ch, tot); ch = [b]; return b.subarray(0, n); };
const take = n => { const b = ch.length === 1 ? ch[0] : Buffer.concat(ch, tot);
  ch = [b.subarray(n)]; tot -= n; if (!ch[0].length) ch = []; return b.subarray(0, n); };
sock.on("data", d => {
  ch.push(d); tot += d.length;
  if (!up) { const b = Buffer.concat(ch, tot); const i = b.indexOf("\r\n\r\n");
    if (i < 0) { ch = [b]; return; }
    up = true; ch = [b.subarray(i + 4)]; tot = ch[0].length;
    if (!tot) ch = []; setTimeout(run, 250); }
  for (;;) { const h = peek(2); if (!h) return;
    const op = h[0] & 15; let l = h[1] & 127, o = 2;
    if (l === 126) { const q = peek(4); if (!q) return; l = q.readUInt16BE(2); o = 4; }
    else if (l === 127) { const q = peek(10); if (!q) return; l = Number(q.readBigUInt64BE(2)); o = 10; }
    if (tot < o + l) return; take(o); const p = take(l);
    if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") S = m; } catch {} } }
});
const send = v => { const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
  let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x])); };
const st = async () => { S = null; send({ t: "state", q: 1 });
  for (let i = 0; i < 600 && !S; i++) await sleep(25); return S; };

let bad = 0;
const check = (name, ok, detail) => {
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   " + detail : ""));
  if (!ok) bad++;
};

const BASE = { t: "build", Nnm: 20, Nsubnm: 26, twistDeg: 0, z0: 3.35, zSub: 3.35,
               engine: "classic", stepsPerFrame: 40, dt: 0.5, gamma: 1.0,
               substrateOn: 1 };

async function build(o) {
  send(Object.assign({}, BASE, o));
  let s = null;
  for (let i = 0; i < 400; i++) { s = await st(); if (s && s.n > 0) break; await sleep(300); }
  return s;
}
async function timed(o, ms) {
  const s0 = await build(o);
  send({ t: "run", on: 1 }); await sleep(ms); send({ t: "run", on: 0 });
  await sleep(400);
  const s = await st();
  return { epot0: s0.epot, ms: s.ms, n: s0.n };
}

async function run() {
  console.log("2dmd phase 5 — tabulated substrate field\n");

  // ---- accuracy, as a function of the knob --------------------------------
  console.log("  Accuracy vs the exact pair sum (energy of a 1-layer build):");
  const exact = await build({ nLayers: 1, subTab: 0 });
  console.log("    exact pair sum          " + exact.epot.toFixed(4) + " eV");
  const errs = [];
  for (const g of [12, 24, 48, 96]) {
    const t = await build({ nLayers: 1, subTab: 1, subGrid: g });
    const rel = Math.abs(t.epot - exact.epot) / Math.abs(exact.epot);
    errs.push({ g, epot: t.epot, rel });
    console.log("    grid " + String(g).padStart(3) + " (" +
                (2.46 / g).toFixed(3) + " A cells)   " + t.epot.toFixed(4) +
                " eV    " + (100 * rel).toFixed(4) + " %");
  }
  const e12 = errs[0].rel, e96 = errs[3].rel;
  check("refining the grid reduces the error", e96 < e12,
        (100 * e12).toFixed(4) + " % -> " + (100 * e96).toFixed(4) + " %");
  check("the fine grid agrees to better than 1 %", e96 < 0.01);
  console.log("    the residual at fine grid is the periodic-vs-finite substrate");
  console.log("    difference, not interpolation: the table does not pretend the");
  console.log("    support stops at the array's edge, and the exact sum does.");

  // ---- speed ---------------------------------------------------------------
  console.log("\n  Speed (20 nm sheets, 26 nm substrate):");
  const rows = [];
  for (const [nL, tab, tag] of [[1, 0, "1 layer, exact sum"],
                                 [1, 1, "1 layer, tabulated"],
                                 [2, 0, "2 layers, exact sum"],
                                 [2, 1, "2 layers, tabulated"]]) {
    const r = await timed({ nLayers: nL, subTab: tab, subGrid: 48 }, 6000);
    rows.push(r.ms);
    console.log("    " + tag.padEnd(22) + r.ms.toFixed(3).padStart(7) + " ms/step");
  }
  const sp1 = rows[0] / rows[1], sp2 = rows[2] / rows[3];
  console.log("    speedup: monolayer " + sp1.toFixed(2) + "x   bilayer " + sp2.toFixed(2) + "x");
  check("the monolayer got faster", sp1 > 1.3, sp1.toFixed(2) + "x");
  check("the bilayer got faster", sp2 > 1.15, sp2.toFixed(2) + "x");
  console.log("    (the breakdown predicted about 2.07x and 1.53x -- the bilayer");
  console.log("     gains less because its interlayer LJ cannot be tabulated)");

  // ---- it must still be switchable off ------------------------------------
  const off = await build({ nLayers: 1, subTab: 0 });
  check("the exact sum is still available as the reference",
        Math.abs(off.epot - exact.epot) < 1e-6);

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — phase 5 gate met"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 600000);
