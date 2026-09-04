// Every material on the FAST engine, and the Mo/W alloy.
//
// Peter: "CAN YOU also add mos2 as 'fast' material? Id also like to have a
// WTe2/MoTe2 alloy, i.e with Mo(x)Te2/W(1-x)Te2..., as default with W replacing
// Mo with relatively evenly distribution".
//
// The toy model used one global rest length -- the Morse from `re`, the
// second-neighbour spring from sqrt(3)*re, which is the honeycomb relation and
// nothing else -- so a dichalcogenide was born under enormous strain and the
// panel locked those materials to LAMMPS. Rest lengths now come from the
// lattice as built. Two things therefore need checking:
//
//   * every material now RUNS on the fast engine and stays cold, which is the
//     whole claim;
//   * the alloy's metal sublattice has the composition asked for and is spread
//     EVENLY. "Evenly" is measurable: count like-metal nearest-neighbour pairs.
//     A uniform random draw at x gives x^2 + (1-x)^2 of them; a well spread
//     substitution gives materially fewer. Clustering gives more.
//
//   node probe-2dmd-fastmat.js

const crypto = require("crypto"), net = require("net"), path = require("path");
const { DMReader } = require(path.join(__dirname, "..", "Plugins", "2D Materials",
                                       "2dmd", "ui", "dmframe.js"));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ch = [], tot = 0, up = false, S = null, bin = null;

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
    up = true; ch = [b.subarray(i + 4)]; tot = ch[0].length; if (!tot) ch = [];
    setTimeout(run, 300); }
  for (;;) { const h = peek(2); if (!h) return;
    const op = h[0] & 15; let l = h[1] & 127, o = 2;
    if (l === 126) { const q = peek(4); if (!q) return; l = q.readUInt16BE(2); o = 4; }
    else if (l === 127) { const q = peek(10); if (!q) return; l = Number(q.readBigUInt64BE(2)); o = 10; }
    if (tot < o + l) return; take(o); const p = take(l);
    if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") S = m; } catch {} }
    else if (op === 2) bin = p; }
});
const send = v => { const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
  let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x])); };
const st = async () => { S = null; send({ t: "state", q: 1 });
  for (let i = 0; i < 1200 && !S; i++) await sleep(25); return S; };
const frame = async () => { bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 1200 && !bin; i++) await sleep(25); return bin; };

let bad = 0;
const ck = (n, ok, d) => { console.log("    " + (ok ? "PASS" : "FAIL") + "  " + n +
  (d ? "   " + d : "")); if (!ok) bad++; };

async function build(mat, extra) {
  send(Object.assign({ t: "build", material: mat, subMaterial: "same",
    engine: "classic", nLayers: 1, Nnm: 8, Nsubnm: 8, twistDeg: 0,
    substrateOn: 1, gamma: 0.00001, stepsPerFrame: 4 }, extra || {}));
  let s = null;
  for (let i = 0; i < 400; i++) { s = await st(); if (s && s.n > 0) break; await sleep(400); }
  return s;
}

async function heat(sec) {
  send({ t: "run", on: 1 });
  let peak = 0;
  for (let i = 0; i < sec * 2.5; i++) {
    await sleep(400);
    const q = await st(); if (!q) continue;
    if (!isFinite(q.temp)) { peak = Infinity; break; }
    if (q.temp > peak) peak = q.temp;
    if (q.temp > 1e5) break;
  }
  send({ t: "run", on: 0 });
  return peak;
}

async function run() {
  console.log("2DMD: every material on the fast (Morse) engine\n");
  console.log("    material   atoms   Epot/atom     peak T after 4 s");

  const MATS = ["graphene", "hbn", "mos2", "ws2", "mote2", "wte2", "mowte2"];
  for (const m of MATS) {
    const s = await build(m);
    if (!s || !s.n) { ck(m + " builds on the fast engine", false); continue; }
    const T = await heat(4);
    console.log("    " + m.padEnd(10) + String(s.n).padStart(6) + "  " +
      (s.epot / s.n).toFixed(4).padStart(10) + "   " +
      (T > 1e5 ? T.toExponential(2) : T.toFixed(1)).padStart(10) + " K" +
      "   engine " + s.engine);
    ck(m + " runs on the fast engine and stays cold",
       s.engine === "classic" && isFinite(T) && T < 4000 &&
       isFinite(s.epot) && s.epot < 0,
       "T " + (isFinite(T) ? T.toFixed(0) : "inf") + " K, " +
       (s.epot / s.n).toFixed(3) + " eV/atom");
  }

  // ---- the alloy -----------------------------------------------------------
  console.log("\n  Mo(1-x)W(x)Te2 metal sublattice:\n");
  console.log("    x asked   W fraction   like-neighbour pairs   random would be");
  for (const x of [0.15, 0.5, 0.85]) {
    const s = await build("mowte2", { alloyX: x });
    if (!s || !s.n) { ck("alloy builds at x=" + x, false); continue; }
    const R = new DMReader();
    const F = R.parse(await frame());
    // Species ride in their own block, indexed by LAYER, not attached to the
    // layer object -- the page reads them the same way (`spBlk[k]`).
    const spBlk = (F.blocks || {}).species;
    const li = F.layers.findIndex(L => L.mobile && L.present);
    const top = (F.mobile || [])[0];
    const sp = spBlk && li >= 0 ? spBlk[li] : null;
    if (!top || !sp) { ck("alloy frame carries species at x=" + x, false,
      "blocks: " + Object.keys(F.blocks || {}).join(",") + "  layer " + li); continue; }

    // metals are species 0 (Mo) and 3 (W); the chalcogens are 1 and 2
    const mx = [], my = [], msp = [];
    for (let i = 0; i < top.n; i++) {
      const v = sp[i];
      if (v !== 0 && v !== 3) continue;
      mx.push(top.pos[3 * i]); my.push(top.pos[3 * i + 1]); msp.push(v);
    }
    const nW = msp.filter(v => v === 3).length, frac = nW / msp.length;

    // nearest metal-metal separation, then like-pair fraction over those pairs
    let d2min = Infinity;
    for (let i = 0; i < Math.min(mx.length, 200); i++)
      for (let j = 0; j < mx.length; j++) {
        if (i === j) continue;
        const dx = mx[i] - mx[j], dy = my[i] - my[j], d2 = dx * dx + dy * dy;
        if (d2 > 1e-6 && d2 < d2min) d2min = d2;
      }
    const cut2 = d2min * 1.44;            // 1.2x the nearest metal spacing
    let pairs = 0, like = 0;
    for (let i = 0; i < mx.length; i++)
      for (let j = i + 1; j < mx.length; j++) {
        const dx = mx[i] - mx[j], dy = my[i] - my[j], d2 = dx * dx + dy * dy;
        if (d2 > 1e-6 && d2 < cut2) { pairs++; if (msp[i] === msp[j]) like++; }
      }
    const likeFrac = pairs ? like / pairs : NaN;
    const rnd = x * x + (1 - x) * (1 - x);
    console.log("    " + x.toFixed(2).padStart(6) + "    " + frac.toFixed(3).padStart(9) +
      "    " + likeFrac.toFixed(3).padStart(14) + "    " + rnd.toFixed(3).padStart(12));

    ck("x=" + x + ": composition matches", Math.abs(frac - x) < 0.05,
       "W fraction " + frac.toFixed(3) + " for x=" + x);
    ck("x=" + x + ": the substitution is spread, not clustered",
       likeFrac < rnd - 0.02,
       likeFrac.toFixed(3) + " like-neighbour pairs against " + rnd.toFixed(3) +
       " for a random draw");
  }

  // LAMMPS must refuse the alloy rather than pretend
  const s = await build("mowte2", { engine: "lammps" });
  ck("LAMMPS refuses the alloy and says why",
     s && s.engine === "classic" && /alloy/i.test(String(s.lmpError || "")),
     s ? (s.engine + "  " + (s.lmpError || "(no reason given)")) : "no state");

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED"
    : "ALL CLEAR — every material runs fast, and the alloy is evenly substituted"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 900000);
