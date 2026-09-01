// Find a STABLE fixed-N gas blister: sweep radius and pressure, hold the gas
// load constant, and see whether the blister settles instead of collapsing or
// running away. Then compare the settled height with the Hencky solution.
//
// elevMode "const" is the point here: the ramp fills the pocket and then STAYS,
// so anything that happens afterwards is the blister finding its own
// equilibrium rather than the schedule pushing it around.
//
//   node gassweep.js [sheet_nm] [sub_nm] [steps]

const crypto = require("crypto"), net = require("net"), fs = require("fs");

const NNM = +(process.argv[2] || 20), NSUB = +(process.argv[3] || 24);
const STEPS = +(process.argv[4] || 6000);
const E2D = 340;                         // N/m
const Z0 = 3.35, LJCUT = 10.26;          // A: contact height and adhesion cutoff

const RADII = (process.env.RADII || '2,3,4,5').split(',').map(Number);
const PRESSURES = (process.env.PRESSURES || '100,200,400,800').split(',').map(Number);

const hencky = (pMPa, Rnm) =>
  0.709 * (Rnm * 1e-9) * Math.cbrt(pMPa * 1e6 * Rnm * 1e-9 / E2D) * 1e10;   // A
// Hencky cap volume (3/5) pi h R^2, so a measured volume maps back to a height.
const hFromV = (V_A3, Rnm) => V_A3 / (0.6 * Math.PI * (Rnm * 10) ** 2);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function open(id) {
  return new Promise(res => {
    const s = net.connect(8090, "127.0.0.1", () => {
      s.write(`GET /ws/${id} HTTP/1.1\r\nHost:127.0.0.1:8090\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n");
    });
    const api = { S: null };
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
        if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") api.S = m; } catch {} } }
    });
    api.send = v => { const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
      let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
      else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
      const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
      s.write(Buffer.concat([h, m, x])); };
    api.state = async () => { api.S = null; api.send({ t: "state", q: 1 });
      for (let i = 0; i < 400 && !api.S; i++) await sleep(25); return api.S; };
  });
}

async function trial(api, Rnm, pMPa) {
  api.send({ t: "build", Nnm: NNM, Nsubnm: NSUB, z0: Z0, twistDeg: 0,
             material: "graphene", engine: "classic",
             profile: "bubbleN", protLoc: "between",
             bubbleRnm: Rnm, bubbleP: pMPa, gasT: 300,
             Cxnm: 0, Cynm: 0,
             elevMode: "const",           // fill, then hold the gas load
             liftRate: 0.02, holdSteps: 0,
             g: +(process.env.DAMP || 0.08),   // damping: this is a relaxation to
                                              // equilibrium, not a dynamics run
             stepsPerFrame: 200 });
  let s = null;
  for (let i = 0; i < 200; i++) { s = await api.state(); if (s && s.n > 0) break; await sleep(400); }
  api.send({ t: "elev", on: 1 });

  const hist = [];
  const t0 = Date.now();
  while (Date.now() - t0 < +(process.env.MAXSEC || 90) * 1000) {
    await sleep(600);
    s = await api.state();
    if (!s) continue;
    hist.push({ step: s.frame, V: s.gasV || 0, P: s.gasP || 0 });
    if (s.frame >= STEPS) break;
  }
  api.send({ t: "run", on: 0 });
  await sleep(200);

  // settled? compare the last quarter with the quarter before it
  const n = hist.length;
  if (n < 8) return { Rnm, pMPa, verdict: "no data", hist };
  const q = Math.floor(n / 4);
  const mid = hist.slice(n - 2 * q, n - q).map(r => r.V);
  const end = hist.slice(n - q).map(r => r.V);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const vMid = avg(mid), vEnd = avg(end);
  const drift = Math.abs(vEnd - vMid) / Math.max(vEnd, 1e-9);
  const hMeas = hFromV(vEnd, Rnm);
  const Vfloor = Math.PI * (Rnm * 10) ** 2 * 0.5;
  const flat = vEnd <= Vfloor * 1.02;
  const escaped = Z0 + hMeas > LJCUT;
  const verdict = flat ? "never lifted"
                : escaped ? "escaped the adhesion cutoff"
                : drift < 0.03 ? "STABLE"
                : "still drifting";
  return { Rnm, pMPa, verdict, drift, hMeas, hHencky: hencky(pMPa, Rnm),
           pEnd: avg(end.map((_, i) => hist[n - q + i].P)), hist };
}

(async () => {
  const api = await open("graphene-md");
  await sleep(400);
  console.log(`Stable-blister sweep — sheet ${NNM} nm / substrate ${NSUB} nm, ` +
              `gas held constant (elevMode "const"), ${STEPS} steps max\n`);
  console.log("  adhesion vanishes above z = 10.26 A, i.e. h > 6.91 A\n");
  console.log("   R(nm)  P(MPa)   h Hencky   h measured   h/R      drift    verdict");
  console.log("   -----  ------   --------   ----------   ------   ------   -------");
  const out = [];
  for (const R of RADII) {
    for (const p of PRESSURES) {
      const r = await trial(api, R, p);
      out.push({ R: r.Rnm, P: r.pMPa, verdict: r.verdict, drift: r.drift,
                 hMeas: r.hMeas, hHencky: r.hHencky, pEnd: r.pEnd });
      const hm = r.hMeas === undefined ? "  --  " : r.hMeas.toFixed(2).padStart(8);
      const hr = r.hMeas === undefined ? " --  " : (r.hMeas / (R * 10)).toFixed(3).padStart(5);
      const dr = r.drift === undefined ? " --  " : (100 * r.drift).toFixed(1).padStart(5) + "%";
      console.log(`   ${String(R).padStart(4)}   ${String(p).padStart(5)}   ` +
                  `${r.hHencky.toFixed(2).padStart(7)} A   ${hm} A   ${hr}   ${dr}   ${r.verdict}`);
    }
  }
  fs.writeFileSync("gassweep.json", JSON.stringify(out, null, 1));
  console.log("\n  -> gassweep.json");
  process.exit(0);
})();
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 3000000);
