// Phase 1 acceptance for 2dmd: does the layer stack reproduce moire-bubble?
//
// The plan's gate is that the combined plugin reproduces the numbers the old
// ones produced, before any of them is retired. This runs the SAME scenario on
// both plugins and compares. It also checks the capability the stack was built
// for and moire-bubble never had: a single mobile layer.
//
// Not bit-identity -- the gaps are summed in a different order, so the last
// bits of the energy differ. Everything measured here is far above that.
//
//   node probe-2dmd-phase1.js
// 
// ===================================================================
// THIS GATE IS EXPECTED TO FAIL AS OF 2026-09-03, AND MUST NOT BE
// 'FIXED' BY MOVING ITS NUMBERS.
//
// It asks whether 2dmd reproduces moire-bubble. It did, to 0.09 % --
// and the reason turned out to be that BOTH omitted the eV/A -> A/fs^2
// conversion in the integrator, so both ran every acceleration 103.642
// times too large. 2dmd's is fixed; moire-bubble's is not.
//
// So the four checks that now differ are the DYNAMICS ones -- blister
// centre height, rim radius, and the registry pair that depends on
// them. Over the same number of steps a correctly integrated 2dmd has
// advanced about a tenth as much simulated time, so its blister has
// inflated less. The static checks (far-field z, blister radius, gas
// fill, layer counts) still agree exactly, which is the evidence that
// only the time axis moved.
//
// This gate becomes meaningful again only when someone decides what
// moire-bubble should be: corrected the same way (one line, and its
// published blister timings shift), or kept as the historical record.
// That is the same decision phase 8 is waiting on.
// ===================================================================

const crypto = require("crypto"), net = require("net");

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(plug) {
  const S = { chunks: [], total: 0, up: false, state: null, bin: null, sock: null };
  S.sock = net.connect(8090, "127.0.0.1", () => {
    S.sock.write("GET /ws/" + plug + " HTTP/1.1\r\nHost:127.0.0.1:8090\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
      crypto.randomBytes(16).toString("base64") + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
  });
  const peek = n => { if (S.total < n) return null;
    if (S.chunks[0].length >= n) return S.chunks[0].subarray(0, n);
    const b = Buffer.concat(S.chunks, S.total); S.chunks = [b]; return b.subarray(0, n); };
  const take = n => { const b = S.chunks.length === 1 ? S.chunks[0] : Buffer.concat(S.chunks, S.total);
    S.chunks = [b.subarray(n)]; S.total -= n; if (!S.chunks[0].length) S.chunks = [];
    return b.subarray(0, n); };
  S.sock.on("data", d => {
    S.chunks.push(d); S.total += d.length;
    if (!S.up) { const b = Buffer.concat(S.chunks, S.total); const i = b.indexOf("\r\n\r\n");
      if (i < 0) { S.chunks = [b]; return; }
      S.up = true; S.chunks = [b.subarray(i + 4)]; S.total = S.chunks[0].length;
      if (!S.total) S.chunks = []; }
    for (;;) { const h = peek(2); if (!h) return;
      const op = h[0] & 15; let len = h[1] & 127, off = 2;
      if (len === 126) { const q = peek(4); if (!q) return; len = q.readUInt16BE(2); off = 4; }
      else if (len === 127) { const q = peek(10); if (!q) return; len = Number(q.readBigUInt64BE(2)); off = 10; }
      if (S.total < off + len) return; take(off); const p = take(len);
      if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") S.state = m; } catch {} }
      else if (op === 2) S.bin = p; }
  });
  S.send = v => { const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
    let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
    else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
    const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    S.sock.write(Buffer.concat([h, m, x])); };
  S.raw = () => { const b = Buffer.from("f"), m = crypto.randomBytes(4);
    const h = Buffer.from([0x81, 0x80 | b.length]);
    const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    S.sock.write(Buffer.concat([h, m, x])); };
  S.st = async () => { S.state = null; S.send({ t: "state", q: 1 });
    for (let i = 0; i < 400 && !S.state; i++) await sleep(25); return S.state; };
  S.frame = async () => { S.bin = null; S.raw();
    for (let i = 0; i < 400 && !S.bin; i++) await sleep(25); return S.bin; };
  return S;
}

const MB = 0x314C424D;   // 'MBL1'
const DM = 0x314D4432;   // '2DM1'
const sniff = (b, magic) =>
  b.readUInt32LE(0) === magic ? 0 : (b.readUInt32LE(12) === magic ? 12 : -1);

// moire-bubble: magic, flags, n1, n2, nsub, frame, ePot, eKin
function parseMBL(b) {
  const o = sniff(b, MB); if (o < 0) return null;
  const flags = b.readUInt32LE(o + 4);
  const n1 = b.readUInt32LE(o + 8), n2 = b.readUInt32LE(o + 12), ns = b.readUInt32LE(o + 16);
  let q = o + 32;
  const rd = n => { const a = []; for (let i = 0; i < n; i++, q += 12)
      a.push([b.readFloatLE(q), b.readFloatLE(q + 4), b.readFloatLE(q + 8)]); return a; };
  const L1 = rd(n1), L2 = rd(n2);
  if (flags & 2) q += 12 * ns;
  let regs = null;
  if (flags & 4) { regs = [[], []];
    for (let i = 0; i < n1; i++, q += 4) regs[0].push(b.readFloatLE(q));
    for (let i = 0; i < n2; i++, q += 4) regs[1].push(b.readFloatLE(q)); }
  return { mobile: [L1, L2], reg: regs };
}

// 2dmd: header, layer table, present layers, then registry per mobile layer
function parse2DM(b) {
  const o = sniff(b, DM); if (o < 0) return null;
  const flags = b.readUInt32LE(o + 8), nL = b.readUInt32LE(o + 12);
  let q = o + 32;
  const tab = [];
  for (let k = 0; k < nL; k++, q += 8)
    tab.push({ n: b.readUInt32LE(q), lf: b.readUInt32LE(q + 4) });
  const pos = [];
  for (const t of tab) {
    if (!(t.lf & 2)) { pos.push(null); continue; }
    const a = [];
    for (let i = 0; i < t.n; i++, q += 12)
      a.push([b.readFloatLE(q), b.readFloatLE(q + 4), b.readFloatLE(q + 8)]);
    pos.push(a);
  }
  let reg = null;
  if (flags & 1) { reg = [];
    for (let k = 0; k < nL; k++) {
      if (!(tab[k].lf & 1)) continue;
      const a = []; for (let i = 0; i < tab[k].n; i++, q += 4) a.push(b.readFloatLE(q));
      reg.push(a);
    } }
  const mobile = [];
  for (let k = 0; k < nL; k++) if (tab[k].lf & 1) mobile.push(pos[k]);
  return { mobile, reg, nLayers: nL, tab };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
// mean z of atoms in the outer annulus: the undisturbed far field
const farZ = (pts, rmin) => {
  const v = pts.filter(p => Math.hypot(p[0], p[1]) > rmin).map(p => p[2]);
  return v.length ? mean(v) : NaN;
};
const centreZ = (pts, rmax) => {
  const v = pts.filter(p => Math.hypot(p[0], p[1]) < rmax).map(p => p[2]);
  return v.length ? mean(v) : NaN;
};
const rimR = pts => {
  const r = pts.map(p => Math.hypot(p[0], p[1])).sort((a, b) => b - a);
  const k = Math.max(1, Math.floor(r.length * 0.03));
  return mean(r.slice(0, k));
};

const BUILD = { Nnm: 24, Nsubnm: 29, twistDeg: 3, z0: 3.35, zSub: 3.35,
                substrateOn: 1, stepsPerFrame: 60 };

async function scenario(S, parse, extra) {
  S.send(Object.assign({ t: "build" }, BUILD, extra || {}));
  for (let i = 0; i < 200; i++) { const s = await S.st(); if (s && s.n > 0) break; await sleep(300); }
  // first frame carries the substrate; take two so the reader is exercised both ways
  await S.frame();
  const flat = parse(await S.frame());
  const top = flat.mobile[flat.mobile.length - 1];
  const out = { far: farZ(top, 90), rim0: rimR(top) };

  // registry, and its spatial variation
  S.send({ t: "params", registry: 1, regGamma: 1, regHeightDamp: 0 });
  await sleep(600);
  const withReg = parse(await S.frame());
  out.regSd = withReg.reg ? sd(withReg.reg[withReg.reg.length - 1]) : NaN;
  out.regMean = withReg.reg ? mean(withReg.reg[withReg.reg.length - 1]) : NaN;
  S.send({ t: "params", registry: 0 });
  await sleep(300);

  // inflate a blister and measure the centre rise and the rim creep
  S.send({ t: "params", edgeK: 0 });
  S.send(Object.assign({ t: "params" },
    { bubbleRnm: 4, bubbleP: 600, gasT: 300, Cxnm: 0, Cynm: 0 }));
  await sleep(300);
  S.send({ t: "gas", on: 1 });
  S.send({ t: "run", on: 1 });
  await sleep(22000);
  S.send({ t: "run", on: 0 });
  await sleep(500);
  const st = await S.st();
  const infl = parse(await S.frame());
  const t2 = infl.mobile[infl.mobile.length - 1];
  out.centre = centreZ(t2, 24);
  out.farAfter = farZ(t2, 90);
  out.rim1 = rimR(t2);
  out.creep = out.rim0 - out.rim1;
  out.fill = st ? st.fill : 0;
  out.gasR = st ? st.gasR : 0;
  return out;
}

const row = (k, a, b, unit, tol) => {
  const d = Math.abs(a - b);
  const rel = Math.abs(b) > 1e-9 ? 100 * d / Math.abs(b) : 0;
  const ok = d <= tol;
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + k.padEnd(28) +
              a.toFixed(4).padStart(10) + "  " + b.toFixed(4).padStart(10) + unit.padEnd(4) +
              "  " + (rel).toFixed(2).padStart(6) + " %");
  return ok;
};

async function run() {
  console.log("2dmd phase 1 acceptance — layer stack vs moire-bubble\n");
  const A = connect("2dmd"), B = connect("moire-bubble");
  await sleep(1200);

  console.log("  running the same scenario on both (this takes ~50 s)...\n");
  const a = await scenario(A, parse2DM);
  const b = await scenario(B, parseMBL);

  console.log("  check                          2dmd   moire-bubble        diff");
  console.log("  -----                          ----   ------------        ----");
  let bad = 0;
  if (!row("far-field top-layer z", a.far, b.far, " A", 0.05)) bad++;
  if (!row("far field after inflation", a.farAfter, b.farAfter, " A", 0.05)) bad++;
  if (!row("blister centre z", a.centre, b.centre, " A", 0.40)) bad++;
  if (!row("rim radius as built", a.rim0, b.rim0, " A", 0.02)) bad++;
  if (!row("rim creep, unclamped", a.creep, b.creep, " A", 0.15)) bad++;
  if (!row("registry sd", a.regSd, b.regSd, "", 0.02)) bad++;
  if (!row("registry mean", a.regMean, b.regMean, "", 0.02)) bad++;
  if (!row("gas fill reached", a.fill, b.fill, "", 0.02)) bad++;
  if (!row("blister radius", a.gasR, b.gasR, " A", 2.0)) bad++;

  // the capability the stack exists for
  console.log("\n  Single mobile layer — moire-bubble cannot express this at all:");
  A.send(Object.assign({ t: "build" }, BUILD, { nLayers: 1 }));
  for (let i = 0; i < 200; i++) { const s = await A.st(); if (s && s.n > 0) break; await sleep(300); }
  await A.frame();
  const one = parse2DM(await A.frame());
  const s1 = await A.st();
  console.log("    layers in frame " + one.nLayers + "   mobile " + one.mobile.length +
              "   atoms " + s1.n + "   nLayers reported " + s1.nLayers);
  const okOne = one.mobile.length === 1 && one.nLayers === 2 && s1.n > 0;
  console.log("    " + (okOne ? "PASS" : "FAIL") + "  one live sheet over the substrate");
  if (!okOne) bad++;

  // and three, which neither old plugin could do
  A.send(Object.assign({ t: "build" }, BUILD, { nLayers: 3 }));
  for (let i = 0; i < 200; i++) { const s = await A.st(); if (s && s.n > 0) break; await sleep(300); }
  await A.frame();
  const three = parse2DM(await A.frame());
  const s3 = await A.st();
  const okThree = three.mobile.length === 3 && s3.nLayers === 3;
  console.log("    " + (okThree ? "PASS" : "FAIL") + "  three live sheets (twist series " +
              (BUILD.twistDeg) + " deg per layer), atoms " + s3.n);
  if (!okThree) bad++;

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — phase 1 gate met"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 900000);
setTimeout(run, 300);
