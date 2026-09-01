// Frame capture for the moire-bubble plugin (MBL1 frames, two live layers).
//
//   EVERY=120 MAXSTEP=36000 node moviecap-mb.js <outdir> '<build JSON>'
//
// Same deterministic stepping as moviecap.js: the run loop stays off and the
// session is advanced with explicit step requests, so every frame lands on a
// known step. The step number is read from the frame header, never from a state
// message -- state is only emitted every 0.5 s of accumulated advance time.

const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2];
const PRESET = JSON.parse(process.argv[3] || "{}");
const EVERY = +(process.env.EVERY || 100);
const MAXSTEP = +(process.env.MAXSTEP || 20000);
const MAGIC = 0x314c424d;                       // 'MBL1'
if (!OUT) { console.log("usage: moviecap-mb.js <outdir> '<json>'"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(7) + "s", ...a);

const sock = net.connect(8090, "127.0.0.1", () => {
    sock.write("GET /ws/moire-bubble HTTP/1.1\r\nHost: 127.0.0.1:8090\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
        crypto.randomBytes(16).toString("base64") + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
sock.on("error", e => { console.log("socket error: " + e.message); process.exit(1); });

function wsframe(payload, op) {
    const m = crypto.randomBytes(4);
    let h;
    if (payload.length < 126) h = Buffer.from([0x80 | op, 0x80 | payload.length]);
    else { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0xFE; h.writeUInt16BE(payload.length, 2); }
    const x = Buffer.from(payload);
    for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    sock.write(Buffer.concat([h, m, x]));
}
const send = v => wsframe(Buffer.from(JSON.stringify(v)), 1);
const askFrame = () => wsframe(Buffer.from("f"), 1);

let chunks = [], total = 0, up = false, state = null, bin = null;
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
        if (!total) chunks = []; setTimeout(begin, 250); }
    for (;;) { const h = peek(2); if (!h) return;
        const op = h[0] & 0x0f; let len = h[1] & 0x7f, off = 2;
        if (len === 126) { const q = peek(4); if (!q) return; len = q.readUInt16BE(2); off = 4; }
        else if (len === 127) { const q = peek(10); if (!q) return; len = Number(q.readBigUInt64BE(2)); off = 10; }
        if (total < off + len) return; take(off); const p = take(len);
        if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") state = m; } catch {} }
        else if (op === 2) bin = p; }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stepOf = b => {
    let o = 0;
    if (b.length < 32) return null;
    if (b.readUInt32LE(0) !== MAGIC) { o = 12; if (b.length < 44 || b.readUInt32LE(o) !== MAGIC) return null; }
    return b.readUInt32LE(o + 20);
};
async function fetchFrame() {
    bin = null; askFrame();
    for (let i = 0; i < 1200 && !bin; i++) await sleep(25);
    return bin ? [bin, stepOf(bin)] : null;
}

async function begin() {
    log("building:", JSON.stringify(PRESET));
    send(Object.assign({ t: "build" }, PRESET));
    for (let i = 0; i < 400; i++) { state = null; send({ t: "state", q: 1 });
        for (let k = 0; k < 200 && !state; k++) await sleep(25);
        if (state && state.n1 > 0) break; await sleep(300); }
    log(`built: ${state.n1} + ${state.n2} mobile atoms, substrate ${state.nsub}, twist ${state.twist} deg`);

    send({ t: "gas", on: 1 });
    await sleep(300);
    send({ t: "run", on: 0 });           // stepping is ours
    await sleep(400);

    const meta = { preset: PRESET, every: EVERY, n1: state.n1, n2: state.n2,
                   nsub: state.nsub, frames: [] };
    log("capturing ...");
    let idx = 0;
    let got = await fetchFrame();
    if (!got) { log("no first frame"); process.exit(1); }
    fs.writeFileSync(path.join(OUT, "f0000.mbl1"), got[0]);
    meta.frames.push({ i: 0, step: got[1] });
    let cur = got[1]; idx = 1;
    const tRun = Date.now();

    for (let k = 0; k < 100000; k++) {
        const target = cur + EVERY;
        let f = null, tries = 0, stuck = 0;
        while (cur < target && tries++ < 4000) {
            send({ t: "step", n: target - cur });
            await sleep(12);
            f = await fetchFrame();
            if (!f) break;
            if (f[1] === cur) { if (++stuck > 500) break; } else stuck = 0;
            cur = f[1];
        }
        if (!f || cur < target) { log(`stalled at ${cur}`); break; }
        fs.writeFileSync(path.join(OUT, "f" + String(idx).padStart(4, "0") + ".mbl1"), f[0]);
        meta.frames.push({ i: idx, step: cur });
        idx++;
        if (idx % 25 === 0) {
            const secs = (Date.now() - tRun) / 1000;
            log(`  ${idx} frames, step ${cur} (${(cur / secs).toFixed(0)} steps/s)` +
                (state ? `, gas ${(state.gasP/1e6).toFixed(0)} MPa, peel r ${Number(state.gasR).toFixed(0)} A, fill ${(100*state.fill).toFixed(0)}%` : ""));
        }
        if (cur >= MAXSTEP) break;
    }
    meta.steps = cur;
    meta.cycleSeconds = (Date.now() - tRun) / 1000;
    if (state) { meta.gasP = state.gasP; meta.gasR = state.gasR; meta.gasV = state.gasV; }
    fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
    log(`done: ${idx} frames over ${cur} steps in ${meta.cycleSeconds.toFixed(0)} s`);
    process.exit(0);
}
setTimeout(() => { log("global timeout"); process.exit(1); }, 7200000);
