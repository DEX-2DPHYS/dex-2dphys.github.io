// Does 2DMD survive its own Run button, with the panel's own defaults?
//
// probe-2dmd-stability.js already says "the default run is stable" -- and the
// plugin detonates when Run is pressed. Both are true, because that probe sends
// ITS OWN parameters and the panel sends the panel's. Every explosion in this
// plugin so far has lived in exactly that gap: the timestep slider that was
// never read, and then the timestep default the panel held that the core never
// had.
//
// So this one takes no parameters of its own. It reads every default value out
// of the panel's markup, builds the message the page's physicsMsg would build,
// and runs it -- the same numbers a person gets by opening the plugin and
// pressing Run, and nothing else.
//
//   node probe-2dmd-default.js

const crypto = require("crypto"), net = require("net"), path = require("path"),
      fs = require("fs");
const BASE = path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd");
const ui = fs.readFileSync(path.join(BASE, "ui", "index.html"), "utf8");

// ---- the panel's defaults, straight out of its markup ----------------------
const defs = {};
for (const m of ui.matchAll(/<input([^>]*)id="([A-Za-z0-9_]+)"([^>]*)>/g)) {
  const attrs = m[1] + m[3];
  const v = attrs.match(/value="([^"]*)"/);
  if (v) defs[m[2]] = v[1];
}
for (const m of ui.matchAll(/<select id="([A-Za-z0-9_]+)">([\s\S]*?)<\/select>/g)) {
  const sel = m[2].match(/<option[^>]*\bselected\b[^>]*value="([^"]*)"/) ||
              m[2].match(/<option[^>]*value="([^"]*)"/);
  if (sel) defs[m[1]] = sel[1];
}

// physicsMsg's own shape: which panel ids go out, and under what key
const N = k => Number(defs[k]);
const MSG = {
  material: defs.material, engine: defs.engine,
  nLayers: N("nLayers") || 2, Nnm: N("Nnm"), Nsubnm: N("Nsubnm"),
  twistDeg: N("twistDeg") || 0,
  dtFs: N("dt"), gamma: N("gamma"),
  k2: N("k2"), kbend: N("kbend"),
  stepsPerFrame: N("stepsPerFrame") || 20,
  substrateOn: 1,
};
for (const k of Object.keys(MSG)) if (MSG[k] === undefined || Number.isNaN(MSG[k])) delete MSG[k];

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
  for (let i = 0; i < 900 && !S; i++) await sleep(25); return S; };

let bad = 0;
const ck = (n, ok, d) => { console.log("    " + (ok ? "PASS" : "FAIL") + "  " + n +
  (d ? "   " + d : "")); if (!ok) bad++; };

async function run() {
  console.log("2DMD: the panel's own defaults, pressed Run\n");
  console.log("  the message the panel would send:");
  for (const k of Object.keys(MSG)) console.log("    " + k.padEnd(14) + MSG[k]);
  console.log("");

  send(Object.assign({ t: "build" }, MSG));
  let s = null;
  for (let i = 0; i < 400; i++) { s = await st(); if (s && s.n > 0) break; await sleep(400); }
  if (!s || !s.n) { console.log("  build never completed"); process.exit(1); }
  console.log("  built " + s.n + " atoms, Epot " + s.epot.toFixed(1) + " eV, T " +
              (s.temp === undefined ? "?" : s.temp.toFixed(1)) + " K\n");

  send({ t: "run", on: 1 });
  const T = [], E = [];
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    const q = await st();
    if (!q) continue;
    T.push(q.temp); E.push(q.epot);
    if (i < 6 || i % 6 === 0)
      console.log("    t=" + (i * 0.4).toFixed(1) + "s   T " +
        (q.temp > 1e6 ? q.temp.toExponential(2) : q.temp.toFixed(1)).padStart(10) +
        " K   Epot " + (Math.abs(q.epot) > 1e7 ? q.epot.toExponential(2)
                                               : q.epot.toFixed(1)).padStart(12) + " eV");
    if (!isFinite(q.temp) || q.temp > 1e5) break;
  }
  send({ t: "run", on: 0 });

  const peak = Math.max(...T.filter(isFinite));
  console.log("");
  ck("stays finite", T.every(isFinite) && E.every(isFinite));
  // A cropped flake's rim is genuinely undercoordinated, so some heating is
  // real. Melting graphene is about 4000 K; anything past that is not physics.
  ck("does not detonate", peak < 4000, "peak " +
     (peak > 1e6 ? peak.toExponential(2) : peak.toFixed(1)) + " K");

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED — this is what Run does"
    : "ALL CLEAR — the default run is stable with the PANEL's numbers"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 300000);
