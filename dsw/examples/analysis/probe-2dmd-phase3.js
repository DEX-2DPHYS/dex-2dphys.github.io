// Phase 3 acceptance: LAMMPS on the layer stack.
//
// The claim being tested is not "it runs". It is that a SECOND LIVE LAYER costs
// nothing on the LAMMPS engine, and that the interlayer physics is AIREBO's
// rather than the plugin's. Those need falsifiable checks:
//
//   1. energy per atom lands where AIREBO graphene lands
//   2. built DELIBERATELY WRONG at 4.2 A, the bilayer relaxes back toward
//      AIREBO's own equilibrium spacing (~3.4 A). Nothing in the plugin pushes
//      it there -- the classic engine's interlayer LJ is switched off under
//      LAMMPS precisely because AIREBO already carries it. If the spacing did
//      not move, the interlayer term would be missing; if it collapsed, it
//      would be double-counted.
//   3. three live layers work too, which no previous plugin could do at all
//
//   node probe-2dmd-phase3.js

const crypto = require("crypto"), net = require("net"), path = require("path");
const { DMReader } = require(
  path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd", "ui", "dmframe.js"));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(plug) {
  const S = { chunks: [], total: 0, up: false, state: null, bin: null };
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
  S.st = async () => { S.state = null; S.send({ t: "state", q: 1 });
    for (let i = 0; i < 600 && !S.state; i++) await sleep(25); return S.state; };
  S.frame = async () => { S.bin = null;
    const b = Buffer.from("f"), m = crypto.randomBytes(4);
    const h = Buffer.from([0x81, 0x80 | b.length]);
    const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    S.sock.write(Buffer.concat([h, m, x]));
    for (let i = 0; i < 600 && !S.bin; i++) await sleep(25); return S.bin; };
  return S;
}

let bad = 0;
const check = (name, ok, detail) => {
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   " + detail : ""));
  if (!ok) bad++;
};
const mean = a => { let s = 0; for (const v of a) s += v; return s / a.length; };
// mean z of the interior only: the rim of a cropped flake curls, and including
// it would report the curl rather than the interlayer spacing
const interiorZ = (pos, rmax) => {
  const v = [];
  for (let i = 0; i < pos.length; i += 3)
    if (Math.hypot(pos[i], pos[i + 1]) < rmax) v.push(pos[i + 2]);
  return v.length ? mean(v) : NaN;
};

async function buildAndSettle(S, R, opts, steps, label) {
  S.send(Object.assign({ t: "build", Nnm: 6, Nsubnm: 8, twistDeg: 0,
                         substrateOn: 0, dt: 0.5, gamma: 1.0,
                         stepsPerFrame: 20, engine: "lammps" }, opts));
  let st = null;
  for (let i = 0; i < 400; i++) { st = await S.st(); if (st && st.n > 0) break; await sleep(400); }
  if (steps > 0) {
    S.send({ t: "run", on: 1 });
    await sleep(steps);
    S.send({ t: "run", on: 0 });
    await sleep(600);
    st = await S.st();
  }
  R.reset();
  await S.frame();
  const f = R.parse(await S.frame());
  return { st, f };
}

async function run() {
  console.log("2dmd phase 3 — LAMMPS on the layer stack\n");
  const S = connect("2dmd");
  const R = new DMReader();
  await sleep(1500);

  // ---- 1. does the engine actually engage --------------------------------
  console.log("  Engine:");
  const mono = await buildAndSettle(S, R, { nLayers: 1, zSub: 3.35 }, 0);
  check("engine reports lammps", mono.st && mono.st.engine === "lammps",
        "engine=\"" + (mono.st ? mono.st.engine : "?") + "\"" +
        (mono.st && mono.st.lmpError ? "  err=\"" + mono.st.lmpError + "\"" : ""));
  if (!mono.st || mono.st.engine !== "lammps") {
    console.log("\n  LAMMPS did not start; the rest cannot be judged.");
    process.exit(1);
  }
  const nMono = mono.st.n;
  const ePerAtom = mono.st.epot / nMono;
  console.log("    " + nMono + " atoms, Epot = " + mono.st.epot.toFixed(1) +
              " eV  ->  " + ePerAtom.toFixed(4) + " eV/atom");
  // A finite flake is less bound than bulk graphene (-7.408 eV/atom under
  // AIREBO) because its rim is undercoordinated, so this is a window not a
  // point. Outside it, the potential is not being applied.
  check("energy per atom is AIREBO-like", ePerAtom < -6.0 && ePerAtom > -7.6,
        "bulk graphene under AIREBO is -7.408 eV/atom");

  // ---- 2. the interlayer physics is AIREBO's -----------------------------
  console.log("\n  Interlayer spacing (built deliberately wrong, left to relax):");
  const wide = await buildAndSettle(S, R, { nLayers: 2, zSub: 3.35, z0: 4.20 }, 0);
  const w1 = interiorZ(wide.f.mobile[0].pos, 20), w2 = interiorZ(wide.f.mobile[1].pos, 20);
  console.log("    requested           4.200 A");
  console.log("    first readable      " + (w2 - w1).toFixed(3) +
              " A   <- lmpStart runs a minimize, so AIREBO has ALREADY pulled");
  console.log("                             it in before any frame can be read");

  const rel = await buildAndSettle(S, R, { nLayers: 2, zSub: 3.35, z0: 4.20 }, 25000);
  const r1 = interiorZ(rel.f.mobile[0].pos, 20), r2 = interiorZ(rel.f.mobile[1].pos, 20);
  const relaxed = r2 - r1;
  console.log("    after relaxing      " + relaxed.toFixed(3) + " A" +
              "   (AIREBO equilibrium is about 3.4 A)");
  check("the layers pulled together", relaxed < 4.20 - 0.15,
        "moved " + (4.20 - relaxed).toFixed(3) + " A");
  check("toward AIREBO's spacing, not collapsed", relaxed > 2.9 && relaxed < 3.9,
        "a collapse would mean the interlayer term is counted twice");

  // ---- 3. the windfall: more layers cost nothing --------------------------
  console.log("\n  More live layers:");
  const tri = await buildAndSettle(S, R, { nLayers: 3, zSub: 3.35, z0: 3.35 }, 0);
  check("three live sheets under LAMMPS", tri.st && tri.st.nLayers === 3 &&
        tri.f.mobile.length === 3, tri.st ? tri.st.n + " atoms" : "");
  const t1 = interiorZ(tri.f.mobile[0].pos, 20);
  const t2 = interiorZ(tri.f.mobile[1].pos, 20);
  const t3 = interiorZ(tri.f.mobile[2].pos, 20);
  const g1 = t2 - t1, g2 = t3 - t2;
  console.log("    gaps after the startup minimize: " + g1.toFixed(3) +
              " A and " + g2.toFixed(3) + " A");
  // The requested 3.35 is a starting point, not an outcome: AIREBO relaxes the
  // stack to its own equilibrium. Asserting the requested value back would be
  // asserting that the potential does nothing.
  check("both gaps sit at AIREBO's equilibrium", g1 > 3.2 && g1 < 3.6 &&
        g2 > 3.2 && g2 < 3.6);
  check("the stack is evenly spaced", Math.abs(g1 - g2) < 0.06,
        "difference " + Math.abs(g1 - g2).toFixed(4) + " A");

  // ---- 4. the classic engine is still there and still right ---------------
  console.log("\n  Falling back:");
  S.send({ t: "build", nLayers: 2, Nnm: 6, Nsubnm: 8, twistDeg: 0,
           zSub: 3.35, z0: 3.35, substrateOn: 1, engine: "classic",
           stepsPerFrame: 20 });
  let cs = null;
  for (let i = 0; i < 300; i++) { cs = await S.st(); if (cs && cs.n > 0) break; await sleep(300); }
  check("classic engine still selectable", cs && cs.engine === "classic",
        "engine=\"" + (cs ? cs.engine : "?") + "\"");

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — phase 3 gate met"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 900000);
setTimeout(run, 300);
