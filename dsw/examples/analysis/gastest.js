// Fixed-N gas blister ("bubbleN") against the open-loop one ("bubble"),
// at four pressures.
//
// The question: does P = N k T / V actually self-limit the blister, and does it
// settle near the Hencky height h0 = 0.709 R (pR/E2D)^(1/3) instead of running
// away? And at what pressure does a nanoscale blister form at all?
//
//   node gastest.js [Nnm] [Nsubnm] [Rnm]

const crypto = require("crypto"), net = require("net"), fs = require("fs");

const NNM = +(process.argv[2] || 50), NSUB = +(process.argv[3] || 60);
const RNM = +(process.argv[4] || 5);
const PRESSURES = [0.1, 10, 100, 1000];        // MPa
const E2D = 340;                                // N/m, graphene
const hencky = pMPa => 0.709 * (RNM * 1e-9) *
      Math.cbrt(pMPa * 1e6 * RNM * 1e-9 / E2D) * 1e10;   // Angstrom

const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function open(id) {
  return new Promise(res => {
    const s = net.connect(8090, "127.0.0.1", () => {
      s.write(`GET /ws/${id} HTTP/1.1\r\nHost:127.0.0.1:8090\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n");
    });
    const api = { sock: s, S: null, bin: null };
    let chunks = [], total = 0, up = false;
    const peek = n => { if (total < n) return null;
      if (chunks[0].length >= n) return chunks[0].subarray(0, n);
      const b = Buffer.concat(chunks, total); chunks = [b]; return b.subarray(0, n); };
    const take = n => { const b = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
      chunks = [b.subarray(n)]; total -= n; if (!chunks[0].length) chunks = []; return b.subarray(0, n); };
    s.on("data", d => {
      chunks.push(d); total += d.length;
      if (!up) { const b = Buffer.concat(chunks, total); const i = b.indexOf("\r\n\r\n");
        if (i < 0) { chunks = [b]; return; }
        up = true; chunks = [b.subarray(i + 4)]; total = chunks[0].length;
        if (!total) chunks = []; res(api); }
      for (;;) { const h = peek(2); if (!h) return;
        const op = h[0] & 15; let len = h[1] & 127, off = 2;
        if (len === 126) { const q = peek(4); if (!q) return; len = q.readUInt16BE(2); off = 4; }
        else if (len === 127) { const q = peek(10); if (!q) return; len = Number(q.readBigUInt64BE(2)); off = 10; }
        if (total < off + len) return; take(off); const p = take(len);
        if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") api.S = m; } catch {} }
        else if (op === 2) api.bin = p; }
    });
    api.send = v => {
      const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
      let h;
      if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
      else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
      const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
      s.write(Buffer.concat([h, m, x]));
    };
    api.state = async () => { api.S = null; api.send({ t: "state", q: 1 });
      for (let i = 0; i < 400 && !api.S; i++) await sleep(25); return api.S; };
  });
}

async function runOne(api, profile, pMPa) {
  api.send({ t: "build", Nnm: NNM, Nsubnm: NSUB, z0: 3.35, twistDeg: 0,
             material: "graphene", engine: "classic",
             profile, protLoc: "between", bubbleRnm: RNM, bubbleP: pMPa,
             Mxnm: 6, Mynm: 6, Cxnm: 0, Cynm: 0,
             elevMode: "rhrd", liftRate: 0.01, holdSteps: 500, gasT: 300,
             stepsPerFrame: 100 });
  let s = null;
  for (let i = 0; i < 240; i++) { s = await api.state(); if (s && s.n > 0) break; await sleep(500); }
  api.send({ t: "elev", on: 1 });
  await sleep(400);

  const trace = [];
  let peakP = 0, peakN = 0;
  for (let k = 0; k < 400; k++) {
    await sleep(500);
    s = await api.state();
    if (!s) continue;
    if (s.gasP) peakP = Math.max(peakP, s.gasP);
    if (s.gasN) peakN = Math.max(peakN, s.gasN);
    trace.push({ step: s.frame, elevz: s.elevz, phase: s.phase,
                 gasP: s.gasP || 0, gasV: s.gasV || 0, gasN: s.gasN || 0 });
    if (s.phase === "idle" && s.elev === 0 && s.frame > 200) break;
  }
  api.send({ t: "run", on: 0 });
  await sleep(300);
  return { trace, peakP, peakN, last: s };
}

(async () => {
  const api = await open("graphene-md");
  await sleep(400);
  log(`Fixed-N gas blister test — sheet ${NNM} nm, substrate ${NSUB} nm, blister R = ${RNM} nm\n`);
  log("  P set     Hencky h0    peak N        peak P        final V");
  log("  --------  -----------  ------------  ------------  ------------");
  const out = {};
  for (const p of PRESSURES) {
    const r = await runOne(api, "bubbleN", p);
    out["bubbleN_" + p] = r.trace;
    log(`  ${String(p).padStart(6)} MPa  ${hencky(p).toFixed(2).padStart(8)} A  ` +
        `${r.peakN.toExponential(2).padStart(10)}  ` +
        `${(r.peakP / 1e6).toFixed(3).padStart(9)} MPa  ` +
        `${(r.last && r.last.gasV ? r.last.gasV : 0).toExponential(2).padStart(10)} A^3`);
  }
  // the open-loop one at the highest pressure, for contrast
  const ref = await runOne(api, "bubble", PRESSURES[PRESSURES.length - 1]);
  out["bubble_openloop"] = ref.trace;
  log("\n  open-loop 'bubble' at " + PRESSURES[PRESSURES.length - 1] +
      " MPa for contrast (no gas law, betweenBoost applies)");
  fs.writeFileSync("gastest-trace.json", JSON.stringify(out, null, 1));
  log("\n  traces -> gastest-trace.json");
  process.exit(0);
})();
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 3000000);
