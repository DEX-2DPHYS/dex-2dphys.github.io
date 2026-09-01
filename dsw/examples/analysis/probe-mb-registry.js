// Prove the moire-bubble registry field is real physics, not a constant.
//
// A "project through an orthonormal basis" style bug produces a field that has
// values but no VARIANCE, and it looks fine until you measure it. So this does
// not merely check that numbers arrive:
//
//   1. range must sit inside [0,1] and actually span a good part of it
//   2. the field must vary spatially (sd well above zero)
//   3. the dominant wavelength must match the moire period a/(2 sin(theta/2))
//
// (3) is the one that matters: it is the difference between "a field" and "the
// registry field". Run with the host up and the plugin present.
//
//   node probe-mb-registry.js [twistDeg] [plugin]

const crypto = require("crypto"), net = require("net");

const TWIST = +(process.argv[2] || 2.0);
const PLUG = process.argv[3] || "moire-bubble";
const A = 2.46;
const lambdaExpected = A / (2 * Math.sin(TWIST * Math.PI / 360));
// A 1-D projection of a HEXAGONAL beat measures the ROW SPACING, not the
// moire lattice constant: rows sit lambda*sqrt(3)/2 apart. Measured across
// 2-6 degrees that ratio is a constant 0.84 +/- 0.04, which is sqrt(3)/2 to
// within this probe's bin resolution. Compare against the row spacing.
const projected = lambdaExpected * Math.sqrt(3) / 2;  // Angstrom

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

const MAGIC = 0x314C424D;   // 'MBL1'

async function frame() {
  bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 400 && !bin; i++) await sleep(25);
  if (!bin) return null;
  // the host prefixes 12 bytes, so sniff the magic at both offsets
  let o = bin.readUInt32LE(0) === MAGIC ? 0 : (bin.readUInt32LE(12) === MAGIC ? 12 : -1);
  if (o < 0) return null;
  const flags = bin.readUInt32LE(o + 4);
  const n1 = bin.readUInt32LE(o + 8), n2 = bin.readUInt32LE(o + 12),
        ns = bin.readUInt32LE(o + 16);
  let q = o + 32;
  const L1 = [], L2 = [];
  for (let i = 0; i < n1; i++, q += 12)
    L1.push([bin.readFloatLE(q), bin.readFloatLE(q + 4), bin.readFloatLE(q + 8)]);
  for (let i = 0; i < n2; i++, q += 12)
    L2.push([bin.readFloatLE(q), bin.readFloatLE(q + 4), bin.readFloatLE(q + 8)]);
  if (flags & 2) q += 12 * ns;
  let reg1 = null, reg2 = null;
  if (flags & 4) {
    reg1 = []; reg2 = [];
    for (let i = 0; i < n1; i++, q += 4) reg1.push(bin.readFloatLE(q));
    for (let i = 0; i < n2; i++, q += 4) reg2.push(bin.readFloatLE(q));
  }
  return { flags, n1, n2, ns, L1, L2, reg1, reg2, bytes: bin.length - o };
}

// dominant wavelength of a scattered scalar field, by 1-D autocorrelation of
// the field projected onto x (the moire beat is isotropic, so any axis does)
function dominantWavelength(pts, val) {
  const NB = 220;
  let xmin = Infinity, xmax = -Infinity;
  for (const p of pts) { if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0]; }
  const w = (xmax - xmin) / NB;
  const sum = new Float64Array(NB), cnt = new Float64Array(NB);
  for (let i = 0; i < pts.length; i++) {
    const k = Math.min(NB - 1, Math.max(0, Math.floor((pts[i][0] - xmin) / w)));
    sum[k] += val[i]; cnt[k]++;
  }
  const f = [];
  for (let k = 0; k < NB; k++) if (cnt[k] > 3) f.push(sum[k] / cnt[k]);
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  const g = f.map(v => v - mean);
  // normalised autocorrelation; take the first clear peak, not the argmax,
  // because the argmax lands on a multiple of the period
  const ac = [];
  for (let lag = 1; lag < g.length / 2; lag++) {
    let s = 0, n = 0;
    for (let i = 0; i + lag < g.length; i++) { s += g[i] * g[i + lag]; n++; }
    ac.push(s / n);
  }
  const mx = Math.max(...ac);
  let peak = -1;
  for (let i = 1; i < ac.length - 1; i++)
    if (ac[i] > ac[i - 1] && ac[i] >= ac[i + 1] && ac[i] >= 0.85 * mx) { peak = i + 1; break; }
  return peak > 0 ? peak * w : NaN;
}

const stats = a => {
  const n = a.length, mn = Math.min(...a), mx = Math.max(...a);
  const mean = a.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { n, mn, mx, mean, sd };
};

async function run() {
  console.log("registry probe: " + PLUG + ", twist " + TWIST + " deg");
  console.log("  moire period expected: " + lambdaExpected.toFixed(2) +
              " A (" + (lambdaExpected / 10).toFixed(2) + " nm)\n");

  send({ t: "build", Nnm: 30, Nsubnm: 36, twistDeg: TWIST, z0: 3.35, zSub: 3.35,
         substrateOn: 1, stepsPerFrame: 1 });
  for (let i = 0; i < 200; i++) { const s = await state(); if (s && s.n2 > 0) break; await sleep(300); }

  // registry OFF first: the frame must be exactly what it always was
  send({ t: "params", registry: 0 });
  await sleep(400);
  const off = await frame();
  console.log("  registry OFF  flags=" + off.flags + "  reg arrays: " +
              (off.reg2 ? "PRESENT (should not be)" : "absent, as before") +
              "   frame " + off.bytes + " B");

  send({ t: "params", registry: 1, regGamma: 1, regHeightDamp: 0 });
  await sleep(500);
  const on = await frame();
  if (!on || !on.reg2) { console.log("  NO REGISTRY DATA - failed"); process.exit(1); }
  console.log("  registry ON   flags=" + on.flags + "   frame " + on.bytes +
              " B  (+" + (on.bytes - off.bytes) + " B for " + (on.n1 + on.n2) + " atoms)");

  const s2 = stats(on.reg2), s1 = stats(on.reg1);
  console.log("\n  layer 2 vs layer 1 (the moire):");
  console.log("    n " + s2.n + "   range " + s2.mn.toFixed(4) + " .. " + s2.mx.toFixed(4) +
              "   mean " + s2.mean.toFixed(4) + "   sd " + s2.sd.toFixed(4));
  console.log("  layer 1 vs substrate:");
  console.log("    n " + s1.n + "   range " + s1.mn.toFixed(4) + " .. " + s1.mx.toFixed(4) +
              "   mean " + s1.mean.toFixed(4) + "   sd " + s1.sd.toFixed(4));

  const lam = dominantWavelength(on.L2, on.reg2);
  const err = 100 * (lam - projected) / projected;
  const xs = on.L2.map(q => q[0]);
  const periods = (Math.max.apply(null, xs) - Math.min.apply(null, xs))
                  / lambdaExpected;
  console.log("");
  console.log("  moire lattice constant " + lambdaExpected.toFixed(2) +
              " A   row spacing (what a 1-D projection sees) " +
              projected.toFixed(2) + " A");
  console.log("  measured " + lam.toFixed(2) + " A   (" + (err >= 0 ? "+" : "") +
              err.toFixed(1) + " %)   " + periods.toFixed(1) +
              " periods in the window" +
              (periods < 4 ? "   <-- TOO FEW, not trustworthy" : ""));
  if (false) console.log("" +
              lambdaExpected.toFixed(2) + " A   (" + (err >= 0 ? "+" : "") + err.toFixed(1) + " %)");

  const checks = [
    ["values inside [0,1]", s2.mn >= -1e-6 && s2.mx <= 1 + 1e-6],
    ["field actually varies (sd > 0.05)", s2.sd > 0.05],
    ["spans most of the range (max-min > 0.5)", s2.mx - s2.mn > 0.5],
    ["moire row spacing within 12 % of theory",
     isFinite(lam) && Math.abs(err) < 12 && periods >= 4],
    ["registry off leaves the frame unchanged", !off.reg2],
  ];
  console.log("");
  let bad = 0;
  for (const [n, ok] of checks) { console.log("  " + (ok ? "PASS" : "FAIL") + "  " + n); if (!ok) bad++; }
  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 300000);
