// Capture a movie of the DEFAULT lift sequence from a DSW graphene-md session.
//
//   node moviecap.js <pluginId> <engine> <outdir> [backend]
//
// Frames are captured DETERMINISTICALLY: the run loop is left off and the
// session is advanced with explicit {t:"step", n:EVERY} messages, so every
// frame lands on an exact step number and all four movies line up.
//
// The step number is read from the GMD1 frame itself, NOT from a state message.
// The plugin only emits state once its advance() has accumulated 0.5 s of host
// time, which under deterministic stepping is ~125 batches — waiting on it
// stalls the capture (learned the hard way).
//
// Also exports the LAMMPS deck at cycle start so the stock-LAMMPS movie can
// begin from an identical state.

const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const path = require("path");

const PLUGIN = process.argv[2] || "graphene-md";
const ENGINE = process.argv[3] || "classic";
const OUT = process.argv[4];
const BACKEND = process.argv[5] || null;
const EVERY = +(process.env.EVERY || 10);       // steps between captured frames
const MAXSTEP = +(process.env.MAXSTEP || 6000);  // hard stop
// With elevMode "const" the driver never returns to idle, so the phase test
// below can never fire; MAXSTEP is what ends those runs.
const MAGIC = 0x31444d47;

// Optional 5th argument: a JSON object of extra build parameters, merged over
// the defaults. Used for the "Twisted bubble at interface" preset (the numbers
// live in graphene-md/ui/index.html as PRESET_BUBBLE).
let PRESET = {};
if (process.argv[6]) {
    try { PRESET = JSON.parse(process.argv[6]); }
    catch (e) { console.log("bad preset JSON: " + e.message); process.exit(1); }
}
if (!OUT) { console.log("usage: moviecap.js <pluginId> <engine> <outdir> [backend]"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(7) + "s", ...a);

const sock = net.connect(8090, "127.0.0.1", () => {
    sock.write(`GET /ws/${PLUGIN} HTTP/1.1\r\nHost: 127.0.0.1:8090\r\n` +
        "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
        crypto.randomBytes(16).toString("base64") +
        "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
sock.on("error", e => { console.log("socket error:", e.message); process.exit(1); });

function wsframe(payload, op) {
    const m = crypto.randomBytes(4);
    let h;
    if (payload.length < 126) h = Buffer.from([0x80 | op, 0x80 | payload.length]);
    else if (payload.length < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0xFE; h.writeUInt16BE(payload.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0xFF; h.writeBigUInt64BE(BigInt(payload.length), 2); }
    const x = Buffer.from(payload);
    for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    sock.write(Buffer.concat([h, m, x]));
}
const send = v => wsframe(Buffer.from(JSON.stringify(v)), 1);
const askFrame = () => wsframe(Buffer.from("f"), 1);

let chunks = [], total = 0, upgraded = false;
function peek(n) {
    if (total < n) return null;
    if (chunks[0].length >= n) return chunks[0].subarray(0, n);
    const b = Buffer.concat(chunks, total); chunks = [b]; return b.subarray(0, n);
}
function take(n) {
    const b = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
    chunks = [b.subarray(n)]; total -= n;
    if (chunks[0].length === 0) chunks = [];
    return b.subarray(0, n);
}

// GMD1 header: magic, flags, nTop, nSub, nBonds, frame, ePot, eKin.
// The host prefixes DXF1 + w + h, so the payload may start at byte 12.
function frameStep(buf) {
    let off = 0;
    if (buf.length < 32) return null;
    if (buf.readUInt32LE(0) !== MAGIC) {
        off = 12;
        if (buf.length < 44 || buf.readUInt32LE(off) !== MAGIC) return null;
    }
    return buf.readUInt32LE(off + 20);
}

let state = null, lastBinary = null, exportDone = false, exportFiles = 0;
sock.on("data", d => {
    chunks.push(d); total += d.length;
    if (!upgraded) {
        const b = Buffer.concat(chunks, total);
        const i = b.indexOf("\r\n\r\n");
        if (i < 0) { chunks = [b]; return; }
        upgraded = true; chunks = [b.subarray(i + 4)]; total = chunks[0].length;
        if (total === 0) chunks = [];
        setTimeout(begin, 200);
    }
    for (;;) {
        const h2 = peek(2); if (!h2) return;
        const op = h2[0] & 0x0f;
        let len = h2[1] & 0x7f, off = 2;
        if (len === 126) { const h = peek(4); if (!h) return; len = h.readUInt16BE(2); off = 4; }
        else if (len === 127) { const h = peek(10); if (!h) return; len = Number(h.readBigUInt64BE(2)); off = 10; }
        if (total < off + len) return;
        take(off);
        const p = take(len);
        if (op === 1) {
            let m; try { m = JSON.parse(p.toString()); } catch { continue; }
            if (m.t === "state") state = m;
            else if (m.t === "notice") log("NOTICE:", m.msg);
            else if (m.t === "lmpexport") {
                if (m.name === "__done__") exportDone = true;
                else { fs.writeFileSync(path.join(OUT, m.name), m.text); exportFiles++; }
            }
        } else if (op === 2) lastBinary = p;
        else if (op === 8) { log("server closed"); process.exit(1); }
    }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ask for a frame and return [buffer, step], retrying until one arrives.
async function fetchFrame() {
    lastBinary = null;
    askFrame();
    for (let i = 0; i < 1200 && !lastBinary; i++) await sleep(25);
    if (!lastBinary) return null;
    const s = frameStep(lastBinary);
    return [lastBinary, s];
}

async function begin() {
    log(`[${PLUGIN}/${ENGINE}${BACKEND ? "/" + BACKEND : ""}] building` +
        (Object.keys(PRESET).length ? ` with preset ${JSON.stringify(PRESET)}` : " default sheet (12 nm / 12 nm)") + " ...");
    state = null;
    const msg = Object.assign(
        { t: "build", Nnm: 12, Nsubnm: 12, z0: 3.35, twistDeg: 0,
          material: "graphene", engine: ENGINE },
        PRESET);
    if (BACKEND) msg.backend = BACKEND;
    const tb = Date.now();
    send(msg);
    let w = 0;
    while (!(state && state.n > 0)) { await sleep(500); if (++w > 1200) { log("build timeout"); process.exit(1); } }
    const tBuild = (Date.now() - tb) / 1000;
    log(`built in ${tBuild.toFixed(1)} s: ${state.n} sheet + ${state.nsub} substrate, ` +
        `engine=${state.engine}, pot="${state.pot}", Epot=${state.epot} eV`);
    if (ENGINE === "lammps" && state.engine !== "lammps") {
        log("FELL BACK to " + state.engine + "; stopping"); process.exit(1);
    }

    send({ t: "elev", on: 1 });
    await sleep(400);
    send({ t: "run", on: 0 });         // stepping is ours from here
    await sleep(600);

    send({ t: "export" });
    for (let i = 0; i < 900 && !exportDone; i++) await sleep(200);
    log(`deck exported (${exportFiles} files)`);

    const meta = { plugin: PLUGIN, engine: state.engine, backend: BACKEND,
                   pot: state.pot, nSheet: state.n, nSub: state.nsub,
                   buildSeconds: tBuild, every: EVERY, frames: [] };

    log("capturing frames ...");
    const tRun = Date.now();
    let idx = 0;
    let got = await fetchFrame();
    if (!got) { log("no first frame"); process.exit(1); }
    fs.writeFileSync(path.join(OUT, "f0000.gmd1"), got[0]);
    meta.frames.push({ i: 0, step: got[1] });
    let cur = got[1];
    idx = 1;

    for (let k = 0; k < 100000; k++) {
        const target = cur + EVERY;
        // advance() caps a batch at 10 ms and ZEROES pendingSteps first, so a
        // step request is silently truncated (n:100 advances ~3 steps at this
        // size). Re-issue until the target is actually reached.
        let f = null, tries = 0, stuck = 0;
        while (cur < target && tries++ < 2000) {
            send({ t: "step", n: target - cur });
            await sleep(15);
            f = await fetchFrame();
            if (!f) break;
            if (f[1] === cur) { if (++stuck > 400) break; } else stuck = 0;
            cur = f[1];
        }
        if (!f || cur < target) { log(`stalled at step ${cur} (wanted ${target})`); break; }
        fs.writeFileSync(path.join(OUT, "f" + String(idx).padStart(4, "0") + ".gmd1"), f[0]);
        meta.frames.push({ i: idx, step: cur });
        idx++;
        if (idx % 25 === 0) {
            const secs = (Date.now() - tRun) / 1000;
            log(`  ${idx} frames, step ${cur} (${(cur / secs).toFixed(1)} steps/s incl. capture)` +
                (state ? `, elevz ${state.elevz}, ${state.phase}` : ""));
        }
        if (state && state.phase === "idle" && state.elev === 0 && cur > 200) break;
        if (cur >= MAXSTEP) break;
    }

    meta.cycleSeconds = (Date.now() - tRun) / 1000;
    meta.steps = cur;
    meta.stepsPerSecond = cur / meta.cycleSeconds;
    if (state) { meta.epotEnd = state.epot; meta.tempEnd = state.temp; meta.bondsEnd = state.nbonds; }
    fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
    log(`done: ${idx} frames over ${cur} steps in ${meta.cycleSeconds.toFixed(1)} s`);
    process.exit(0);
}

setTimeout(() => { log("global timeout"); process.exit(1); }, 7200000);
