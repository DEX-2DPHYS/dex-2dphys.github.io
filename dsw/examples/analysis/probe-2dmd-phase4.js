// Phase 4 acceptance: the substrate correction, and three gas models on any gap.
//
// THE CORRECTION has an exact, falsifiable test. Switching the substrate off
// and on isolates its term completely -- the in-plane energy and the interlayer
// LJ are identical either way and cancel in the difference. So:
//
//     dE(monolayer) = the substrate's pull on layer 1
//     dE(bilayer)   = its pull on layer 1 AND layer 2
//
// A direct lattice sum says layer 2 at 6.70 A gets 9.4 % of what layer 1 gets at
// 3.35 A. So the ratio must come out near 1.094. Before the fix it was exactly
// 1.000, because layer 2 felt nothing at all.
//
// THE GAS MODELS differ in one visible way each:
//     bubble      pressure is asserted and never relieved by inflation
//     bubbleN     pressure falls as V grows, footprint stays at the seed
//     bubbleFree  footprint grows past the seed -- radius is an OUTPUT
//
//   node probe-2dmd-phase4.js

const crypto = require("crypto"), net = require("net"), path = require("path");
const { DMReader } = require(
  path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd", "ui", "dmframe.js"));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let chunks = [], total = 0, up = false, S = null, bin = null;
const sock = net.connect(8090, "127.0.0.1", () => {
  sock.write("GET /ws/2dmd HTTP/1.1\r\nHost:127.0.0.1:8090\r\nUpgrade: websocket\r\n" +
    "Connection: Upgrade\r\nSec-WebSocket-Key: " +
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
  for (let i = 0; i < 600 && !S; i++) await sleep(25); return S; };
const frame = async () => { bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 600 && !bin; i++) await sleep(25); return bin; };

let bad = 0;
const check = (name, ok, detail) => {
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   " + detail : ""));
  if (!ok) bad++;
};

const BASE = { t: "build", Nnm: 14, Nsubnm: 18, twistDeg: 0, z0: 3.35, zSub: 3.35,
               engine: "classic", stepsPerFrame: 40, dt: 0.5, gamma: 1.0 };

async function buildE(opts) {
  send(Object.assign({}, BASE, opts));
  let st = null;
  for (let i = 0; i < 300; i++) { st = await state(); if (st && st.n > 0) break; await sleep(300); }
  return st;
}

async function inflate(opts, ms) {
  send(Object.assign({}, BASE, opts));
  let st = null;
  for (let i = 0; i < 300; i++) { st = await state(); if (st && st.n > 0) break; await sleep(300); }
  send({ t: "gas", on: 1 });
  send({ t: "run", on: 1 });
  await sleep(ms);
  send({ t: "run", on: 0 });
  await sleep(500);
  return await state();
}

async function run() {
  console.log("2dmd phase 4 — substrate correction, and three gas models\n");

  // ---- the correction ------------------------------------------------------
  console.log("  Substrate correction (switching it off isolates its term exactly):");
  const m1on  = await buildE({ nLayers: 1, substrateOn: 1 });
  const m1off = await buildE({ nLayers: 1, substrateOn: 0 });
  const m2on  = await buildE({ nLayers: 2, substrateOn: 1 });
  const m2off = await buildE({ nLayers: 2, substrateOn: 0 });
  const d1 = m1on.epot - m1off.epot;
  const d2 = m2on.epot - m2off.epot;
  const ratio = d2 / d1;
  console.log("    monolayer gains  " + d1.toFixed(3) + " eV from the substrate");
  console.log("    bilayer gains    " + d2.toFixed(3) + " eV");
  console.log("    ratio            " + ratio.toFixed(4) +
              "   (lattice sum predicts 1.094; before the fix it was exactly 1.000)");
  check("layer 2 now feels the substrate", ratio > 1.03,
        "it felt nothing before this phase");
  check("and by the predicted amount", Math.abs(ratio - 1.094) < 0.03);
  check("substrate binding is attractive", d1 < 0 && d2 < 0);

  // ---- the three gas models -----------------------------------------------
  console.log("\n  Gas models (4 nm seed, 600 MPa, between the layers):");
  const G = { nLayers: 2, substrateOn: 1, bubbleRnm: 4, bubbleP: 600,
              gasT: 300, Cxnm: 0, Cynm: 0, edgeK: 1.5, gasGapIdx: 1 };
  const seedR = 40;
  const res = {};
  for (const prof of ["bubble", "bubbleN", "bubbleFree"]) {
    const st = await inflate(Object.assign({}, G, { profile: prof }), 14000);
    res[prof] = st;
    console.log("    " + prof.padEnd(11) +
                " p = " + (st.gasP / 1e6).toFixed(1).padStart(7) + " MPa" +
                "   V = " + st.gasV.toFixed(0).padStart(7) + " A^3" +
                "   radius = " + st.gasR.toFixed(1).padStart(6) + " A" +
                "   fill " + (100 * st.fill).toFixed(0) + " %");
  }
  check("all three reported their own profile",
        res.bubble.profile === "bubble" && res.bubbleN.profile === "bubbleN" &&
        res.bubbleFree.profile === "bubbleFree");
  // open loop asserts the pressure and inflation never relieves it
  check("bubble holds the pressure it was told",
        Math.abs(res.bubble.gasP / 1e6 - 600 * res.bubble.fill) < 30,
        "set 600 MPa x fill, got " + (res.bubble.gasP / 1e6).toFixed(1));
  // The defining property of a fixed-N model is that the gas law holds --
  // p is DERIVED from the measured volume. It is not that p ends up below the
  // nominal: N is fixed from the Hencky volume, the blister settles smaller
  // than that, so p rises to suit. That is the feedback working.
  const KB = 1.380649e-23;
  const pv = (st) => st.gasP * st.gasV * 1e-30;
  const nkt = (st) => st.gasN * KB * 300;
  for (const prof of ["bubbleN", "bubbleFree"]) {
    const st = res[prof];
    const err = Math.abs(pv(st) - nkt(st)) / Math.max(nkt(st), 1e-30);
    console.log("      " + prof.padEnd(11) + " pV = " + pv(st).toExponential(4) +
                " J   NkT = " + nkt(st).toExponential(4) + " J   (" +
                (100 * err).toFixed(3) + " %)");
    check(prof + " obeys p = NkT/V", err < 0.01);
  }
  check("bubble does NOT -- it asserts the pressure", res.bubble.gasN === 0,
        "N = " + res.bubble.gasN + ", so pV is whatever the volume makes it");
  check("bubbleN keeps the footprint at the seed",
        Math.abs(res.bubbleN.gasR - seedR) < 2,
        res.bubbleN.gasR.toFixed(1) + " A vs seed " + seedR + " A");
  // At 600 MPa the energy release rate G = 0.65 p d comes to about
  // 0.245 J/m^2 against an interlayer Gamma of ~0.24 -- within 2 % of the
  // peeling threshold, so whether the front moves is a coin flip. Testing a
  // marginal case tells you nothing. Push clearly past it and compare the two
  // models directly: the peel front is the ONLY difference between them.
  console.log("\n  Peel front, well past the threshold (1600 MPa):");
  const hiN = await inflate(Object.assign({}, G,
      { profile: "bubbleN", bubbleP: 1600 }), 16000);
  const hiF = await inflate(Object.assign({}, G,
      { profile: "bubbleFree", bubbleP: 1600 }), 16000);
  console.log("    bubbleN     radius " + hiN.gasR.toFixed(1) + " A   V " +
              hiN.gasV.toFixed(0) + " A^3");
  console.log("    bubbleFree  radius " + hiF.gasR.toFixed(1) + " A   V " +
              hiF.gasV.toFixed(0) + " A^3");
  check("bubbleN's footprint stays pinned at the seed",
        Math.abs(hiN.gasR - seedR) < 2, hiN.gasR.toFixed(1) + " A");
  check("bubbleFree's footprint PEELS past it",
        hiF.gasR > seedR + 2,
        hiF.gasR.toFixed(1) + " A vs " + hiN.gasR.toFixed(1) +
        " A pinned  <- radius is an output, not an input");

  // ---- any gap -------------------------------------------------------------
  console.log("\n  The gas in any gap:");
  const below = await inflate(Object.assign({}, G, { profile: "bubbleFree", gasGapIdx: 0 }), 12000);
  console.log("    gap 0 (under the bilayer)  radius " + below.gasR.toFixed(1) +
              " A   p " + (below.gasP / 1e6).toFixed(1) + " MPa");
  check("gap 0 inflates under the whole stack", below.gasR > 10 && below.fill > 0.2,
        "gasWhere reported \"" + below.gasWhere + "\"");

  const three = await inflate(Object.assign({}, G,
      { profile: "bubbleFree", nLayers: 3, gasGapIdx: 2 }), 12000);
  console.log("    gap 2 (in a 3-layer stack) radius " + three.gasR.toFixed(1) +
              " A   p " + (three.gasP / 1e6).toFixed(1) + " MPa");
  check("a third layer gives a third gap to fill",
        three.nLayers === 3 && three.gasR > 10 && three.fill > 0.2);

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — phase 4 gate met"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 900000);
