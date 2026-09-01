// Phase 2 acceptance: the 2DM1 frame format and its single reader.
//
// Three things have to hold, and the third is the one the format exists for:
//   1. version 2 parses, layer table and blocks land where the spec says
//   2. a static layer is cached, so frames after the first still have a
//      substrate -- the easiest thing to get wrong about this format
//   3. an UNKNOWN block is stepped over and the block after it still reads.
//      That is tested against a synthesised frame, because the plugin cannot
//      be asked to emit a block kind it does not have.
//
//   node probe-2dmd-phase2.js

const crypto = require("crypto"), net = require("net"), path = require("path");
const { DMReader, toTriples } = require(
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
  for (let i = 0; i < 400 && !S; i++) await sleep(25); return S; };
const rawFrame = async () => { bin = null;
  const b = Buffer.from("f"), m = crypto.randomBytes(4);
  const h = Buffer.from([0x81, 0x80 | b.length]);
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x]));
  for (let i = 0; i < 400 && !bin; i++) await sleep(25);
  return bin; };

const mean = a => { let s = 0; for (const v of a) s += v; return s / a.length; };
const sd = a => { const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / a.length); };

let bad = 0;
const check = (name, ok, detail) => {
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   " + detail : ""));
  if (!ok) bad++;
};

// Build a frame by hand with an unknown block wedged between two known ones.
// The plugin will never emit kind 99, so the only way to prove the skip path
// works is to construct it.
function synthesiseWithUnknown() {
  const nL = 2, n0 = 3, n1 = 4;
  const words = 8 + 2 * nL + 3 * n0 + 3 * n1
              + (4 + n1)          // registry
              + (4 + 5)           // unknown kind 99, 5 values
              + (4 + n1);         // strain
  const b = Buffer.alloc(words * 4);
  let q = 0;
  const u = v => { b.writeUInt32LE(v >>> 0, q); q += 4; };
  const f = v => { b.writeFloatLE(v, q); q += 4; };
  u(0x314D4432); u(2); u(1); u(nL);
  u(7); f(-1.5); f(0.25); u(3);              // frame, ePot, eKin, nBlocks = 3
  u(n0); u(2);                                // layer 0: static, present
  u(n1); u(3);                                // layer 1: mobile, present
  for (let i = 0; i < n0 * 3; i++) f(i);
  for (let i = 0; i < n1 * 3; i++) f(100 + i);
  u(1); u(0b10); u(n1); u(0);                 // registry over layer 1
  for (let i = 0; i < n1; i++) f(0.5 + i);
  u(99); u(0b10); u(5); u(0);                 // UNKNOWN, 5 values
  for (let i = 0; i < 5; i++) f(-7);
  u(2); u(0b10); u(n1); u(0);                 // strain over layer 1
  for (let i = 0; i < n1; i++) f(0.01 * i);
  return b;
}

async function run() {
  console.log("2dmd phase 2 — frame format 2DM1 v2 and its reader\n");

  // ---- the synthetic case first: it needs no plugin at all ----------------
  console.log("  Forward compatibility (synthesised frame):");
  const R0 = new DMReader();
  const syn = R0.parse(synthesiseWithUnknown());
  check("version reported", syn && syn.version === 2, "v" + (syn && syn.version));
  check("layer table read", syn.layers.length === 2 &&
        syn.layers[0].n === 3 && syn.layers[1].n === 4 && syn.layers[1].mobile);
  check("registry block before the unknown one", !!syn.blocks.registry &&
        syn.blocks.registry[1][0] === 0.5);
  check("UNKNOWN block skipped", syn.unknownBlocks.length === 1 &&
        syn.unknownBlocks[0] === 99, "kinds seen: [" + syn.unknownBlocks + "]");
  check("block AFTER the unknown one still reads", !!syn.blocks.strain &&
        Math.abs(syn.blocks.strain[1][2] - 0.02) < 1e-6,
        "strain[2] = " + (syn.blocks.strain ? syn.blocks.strain[1][2].toFixed(4) : "-"));
  const R1 = new DMReader();
  const future = Buffer.from(syn ? synthesiseWithUnknown() : Buffer.alloc(0));
  future.writeUInt32LE(3, 4);            // pretend it is version 3
  const f3 = R1.parse(future);
  check("a newer version is refused, not misread", !!(f3 && f3.error),
        f3 && f3.error ? "\"" + f3.error + "\"" : "");

  // ---- now the live plugin ------------------------------------------------
  console.log("\n  Live plugin:");
  send({ t: "build", nLayers: 2, Nnm: 18, Nsubnm: 22, twistDeg: 3,
         z0: 3.35, zSub: 3.35, substrateOn: 1, stepsPerFrame: 40 });
  for (let i = 0; i < 200; i++) { const s = await state(); if (s && s.n > 0) break; await sleep(300); }

  const R = new DMReader();
  const f1 = R.parse(await rawFrame());
  check("first frame carries the substrate", f1.staticIncluded && f1.layers[0].present,
        f1.layers[0].n + " substrate atoms");
  const subZ = mean(f1.layers[0].pos.filter((_, i) => i % 3 === 2));
  check("substrate is flat at z = 0", Math.abs(subZ) < 1e-6, "z = " + subZ.toFixed(6));

  const f2 = R.parse(await rawFrame());
  check("second frame omits the substrate", !f2.layers[0].present,
        (f1.bytes - f2.bytes) + " bytes saved");
  check("reader supplies it from cache anyway", !!f2.layers[0].pos &&
        f2.layers[0].pos.length === 3 * f1.layers[0].n);
  check("mobile layers always present", f2.mobile.length === 2 &&
        f2.mobile.every(L => L.present));

  // ---- scalar blocks ------------------------------------------------------
  send({ t: "params", registry: 1, strain: 1, regHeightDamp: 0 });
  await sleep(700);
  const f3b = R.parse(await rawFrame());
  const reg = f3b.blocks.registry, str = f3b.blocks.strain;
  check("both blocks present", !!reg && !!str,
        "kinds: " + Object.keys(f3b.blocks).join(", "));
  const rTop = reg[2], sTop = str[2];
  check("registry spans its range", Math.min(...rTop) < 0.05 && Math.max(...rTop) > 0.95,
        "range " + Math.min(...rTop).toFixed(3) + " .. " + Math.max(...rTop).toFixed(3));
  check("strain is ~0 on an undisturbed sheet", Math.abs(mean(sTop)) < 2e-3,
        "mean " + mean(sTop).toExponential(2) + "  sd " + sd(sTop).toExponential(2));

  // inflate, and strain must respond
  const flatSd = sd(sTop);
  send({ t: "params", bubbleRnm: 3, bubbleP: 900, gasT: 300, edgeK: 1.5 });
  await sleep(300);
  send({ t: "gas", on: 1 }); send({ t: "run", on: 1 });
  await sleep(16000);
  send({ t: "run", on: 0 });
  await sleep(500);
  const f4 = R.parse(await rawFrame());
  const sTop2 = f4.blocks.strain[2];
  const infSd = sd(sTop2);
  check("strain responds to a blister", infSd > 3 * flatSd,
        "sd " + flatSd.toExponential(2) + " -> " + infSd.toExponential(2));

  // Exactly-zero on a sheet that has not moved is correct by construction --
  // b0 is measured from the same coordinates -- but it means that check alone
  // cannot fail. So measure the MAGNITUDE where the strain actually lives: a
  // Hencky cap of rise d over radius a carries a mean membrane strain of order
  // (d/a)^2. Anything orders out from that is a broken implementation passing
  // a test that could not fail.
  const topPos = f4.mobile[f4.mobile.length - 1].pos;
  let inSum = 0, inN = 0, zMax = -1e30, zFar = 0, nFar = 0;
  const Rfoot = 30;                              // the 3 nm footprint, in A
  for (let i = 0, k = 0; i < topPos.length; i += 3, k++) {
    const r = Math.hypot(topPos[i], topPos[i + 1]);
    if (r < Rfoot) { inSum += Math.abs(sTop2[k]); inN++; if (topPos[i+2] > zMax) zMax = topPos[i+2]; }
    else if (r > 70) { zFar += topPos[i + 2]; nFar++; }
  }
  const inStrain = inN ? inSum / inN : 0;
  const rise = zMax - (nFar ? zFar / nFar : 0);
  const expect = Math.pow(rise / Rfoot, 2);
  console.log("        blister rise " + rise.toFixed(2) + " A over a = " + Rfoot +
              " A   ->  (d/a)^2 = " + expect.toExponential(2));
  check("strain magnitude is the right order inside the cap",
        inStrain > 0.05 * expect && inStrain < 5 * expect,
        "mean |strain| inside = " + inStrain.toExponential(2));
  check("registry still present alongside it", !!f4.blocks.registry);

  // ---- turning them off shrinks the frame ---------------------------------
  send({ t: "params", registry: 0, strain: 0 });
  await sleep(600);
  const f5 = R.parse(await rawFrame());
  check("blocks are optional", Object.keys(f5.blocks).length === 0,
        f4.bytes + " B with blocks, " + f5.bytes + " B without");

  console.log("\n  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — phase 2 gate met"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 600000);
