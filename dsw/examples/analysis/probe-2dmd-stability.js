// Does the default 2DMD run actually sit still?
//
// A freshly built sheet is at its own equilibrium, so with no gas and no
// protrusion it should barely move: the temperature should stay near zero and
// the potential energy should not climb. It exploded instead, because the
// distance-based topology rebuild swept the THIRD neighbour shell (2.841 A)
// into the second-neighbour spring list (rest length 2.460 A) -- every one of
// those pre-stretched by 0.38 A from step zero.
//
// The checks below would have caught that immediately, so they are worth
// keeping: coordination counts against what a honeycomb must have, and then
// the run actually left alone for a while.
//
//   node probe-2dmd-stability.js

const crypto = require("crypto"), net = require("net"), path = require("path");
const { DMReader } = require(
  path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd", "ui", "dmframe.js"));

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
    up = true; ch = [b.subarray(i + 4)]; tot = ch[0].length;
    if (!tot) ch = []; setTimeout(run, 250); }
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
  for (let i = 0; i < 800 && !S; i++) await sleep(25); return S; };
const fr = async () => { bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 800 && !bin; i++) await sleep(25); return bin; };

let bad = 0;
const check = (n, ok, d) => { console.log("  " + (ok ? "PASS" : "FAIL") + "  " + n +
  (d ? "   " + d : "")); if (!ok) bad++; };

// Coordination straight from the geometry: a honeycomb interior atom has 3
// nearest neighbours and 6 second neighbours. Anything else means the topology
// rebuild is picking the wrong shells, which is exactly what detonated it.
function shells(pos, n) {
  const A = 2.46, d1 = A / Math.sqrt(3), d2 = A, d3 = 2 * d1;
  const R1 = 0.5 * (d1 + d2), R2 = 0.5 * (d2 + d3);
  const cell = R2, pts = [];
  for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1], pos[i + 2]]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0]<x0)x0=p[0]; if (p[0]>x1)x1=p[0];
                         if (p[1]<y0)y0=p[1]; if (p[1]>y1)y1=p[1]; }
  const nx = Math.ceil((x1-x0)/cell)+3, ny = Math.ceil((y1-y0)/cell)+3;
  const head = new Int32Array(nx*ny).fill(-1), next = new Int32Array(pts.length).fill(-1);
  const cx = p => Math.min(nx-1, Math.max(0, Math.floor((p[0]-x0)/cell)+1));
  const cy = p => Math.min(ny-1, Math.max(0, Math.floor((p[1]-y0)/cell)+1));
  for (let i=0;i<pts.length;i++){ const c = cy(pts[i])*nx+cx(pts[i]); next[i]=head[c]; head[c]=i; }
  let n1=0, n2=0, interior=0;
  for (let i=0;i<pts.length;i+=7){
    // only judge atoms well inside, so the rim does not skew the counts
    if (pts[i][0]<x0+8 || pts[i][0]>x1-8 || pts[i][1]<y0+8 || pts[i][1]>y1-8) continue;
    let c1=0,c2=0;
    const gx=cx(pts[i]), gy=cy(pts[i]);
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      const X=gx+dx,Y=gy+dy; if(X<0||X>=nx||Y<0||Y>=ny) continue;
      for (let j=head[Y*nx+X]; j>=0; j=next[j]){
        if (j===i) continue;
        const d = Math.hypot(pts[j][0]-pts[i][0], pts[j][1]-pts[i][1]);
        if (d<R1) c1++; else if (d<R2) c2++;
      }
    }
    n1+=c1; n2+=c2; interior++;
  }
  return { nn: n1/interior, sn: n2/interior, interior };
}

async function run() {
  console.log("2DMD default bilayer — does it sit still?\n");
  // the panel's own defaults
  send({ t: "build", nLayers: 2, Nnm: 12, Nsubnm: 12, twistDeg: 0, z0: 3.35,
         zSub: 3.35, substrateOn: 1, engine: "classic", dt: 0.5, gamma: 1.0,
         stepsPerFrame: 20 });
  let s = null;
  for (let i = 0; i < 300; i++) { s = await st(); if (s && s.n > 0) break; await sleep(300); }
  console.log("  built " + s.n + " atoms in " + s.nLayers + " sheets, Epot " +
              s.epot.toFixed(1) + " eV (" + (s.epot/s.n).toFixed(4) + " eV/atom)");

  const R = new DMReader(); await fr();
  const F = R.parse(await fr());
  const sh = shells(F.mobile[F.mobile.length-1].pos);
  console.log("  interior coordination: " + sh.nn.toFixed(2) + " nearest, " +
              sh.sn.toFixed(2) + " second  (" + sh.interior + " atoms sampled)");
  check("3 nearest neighbours", Math.abs(sh.nn - 3) < 0.15);
  check("6 second neighbours", Math.abs(sh.sn - 6) < 0.3,
        "7+ means the third shell is leaking into the shear springs");

  const e0 = s.epot, n = s.n;
  console.log("\n  running 12 s with no gas and no protrusion...");
  send({ t: "run", on: 1 });
  const T = [];
  for (let i = 0; i < 12; i++) { await sleep(1000); const q = await st();
    if (q) T.push({ t: q.temp, e: q.epot }); }
  send({ t: "run", on: 0 }); await sleep(400);
  const f = await st();
  console.log("    temperature: start " + T[0].t.toFixed(1) + " K   end " +
              T[T.length-1].t.toFixed(1) + " K   peak " +
              Math.max(...T.map(x=>x.t)).toFixed(1) + " K");
  console.log("    Epot: " + e0.toFixed(1) + " -> " + f.epot.toFixed(1) + " eV  (" +
              (1000*(f.epot-e0)/n).toFixed(2) + " meV/atom)");
  check("it does not heat up", Math.max(...T.map(x=>x.t)) < 300,
        "an undisturbed sheet at its own equilibrium should stay cold");
  check("the energy does not run away", Math.abs(f.epot - e0)/n < 0.05,
        "per-atom change under 50 meV");
  check("nothing became non-finite", isFinite(f.epot) && isFinite(f.temp));

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — the default run is stable"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 600000);
