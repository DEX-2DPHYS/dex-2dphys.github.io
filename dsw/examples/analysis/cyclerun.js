// Generic runner: build a sheet, arm the ramp-hold-return lift, export the
// deck at cycle start, run the cycle, capture packed geometry at the peak of
// the hold and at completion, and write a timing.json.
//
//   node cyclerun.js <engine: classic|lammps> <Nnm> <Nsubnm> <outdir> <tag>
//
// Reports the step rate after 25 steps so a hopeless projection is caught
// before committing to all 2497 steps.

const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const path = require("path");

const ENGINE = process.argv[2] || "classic";
const NNM = Number(process.argv[3] || 50);
const NSUB = Number(process.argv[4] || 60);
const OUT = process.argv[5];
const TAG = process.argv[6] || ENGINE;
if (!OUT) { console.log("usage: cyclerun.js <engine> <Nnm> <Nsubnm> <outdir> <tag>"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(7) + "s";
const log = (...a) => console.log(el(), ...a);

const sock = net.connect(8090, "127.0.0.1", () => {
    sock.write("GET /ws/graphene-md HTTP/1.1\r\nHost: 127.0.0.1:8090\r\n" +
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

let state = null, lastBinary = null, exportFiles = 0, exportDone = false;
const notices = [];
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
            else if (m.t === "notice") { notices.push(m.msg); log("NOTICE:", m.msg); }
            else if (m.t === "lmpexport") {
                if (m.name === "__done__") exportDone = true;
                else { fs.writeFileSync(path.join(OUT, m.name), m.text); exportFiles++;
                       log(`  deck: ${m.name} ${(m.text.length / 1048576).toFixed(2)} MB`); }
            }
        } else if (op === 2) lastBinary = p;
        else if (op === 8) { log("server closed"); process.exit(1); }
    }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function grab(name) {
    lastBinary = null;
    askFrame();
    for (let i = 0; i < 300 && !lastBinary; i++) await sleep(100);
    if (!lastBinary) { log("no frame for " + name); return; }
    fs.writeFileSync(path.join(OUT, name), lastBinary);
    log(`captured ${name} ${(lastBinary.length / 1048576).toFixed(2)} MB ` +
        `(frame ${state && state.frame}, elevz ${state && state.elevz}, phase ${state && state.phase})`);
}

async function begin() {
    log(`[${TAG}] building ${NNM} nm sheet / ${NSUB} nm substrate, engine=${ENGINE} ...`);
    state = null;
    const tb = Date.now();
    send({ t: "build", Nnm: NNM, Nsubnm: NSUB, z0: 3.35, twistDeg: 0,
           material: "graphene", engine: ENGINE });
    let waited = 0;
    while (!(state && state.n > 0)) {
        await sleep(1000); waited++;
        if (waited % 30 === 0) log(`  ... still building (${waited} s)`);
        if (waited > 3000) { log("build timed out"); process.exit(1); }
    }
    const tBuild = (Date.now() - tb) / 1000;
    log(`[${TAG}] built in ${tBuild.toFixed(1)} s: ${state.n} sheet + ${state.nsub} substrate atoms, ` +
        `engine=${state.engine}, pot="${state.pot}", Epot=${state.epot} eV`);
    if (ENGINE === "lammps" && state.engine !== "lammps") {
        log("FELL BACK to " + state.engine + " - AIREBO did not engage; stopping");
        process.exit(1);
    }

    send({ t: "params", stepsPerFrame: 50 });
    await sleep(300);

    log(`[${TAG}] arming lift and exporting the deck at cycle start ...`);
    send({ t: "elev", on: 1 });
    await sleep(500);
    send({ t: "run", on: 0 });
    await sleep(800);
    const startEpot = state.epot, startFrame = state.frame;
    send({ t: "export" });
    for (let i = 0; i < 2400 && !exportDone; i++) await sleep(1000);
    log(`[${TAG}] deck exported (${exportFiles} files) at frame ${state.frame}, elevz ${state.elevz}`);

    log(`[${TAG}] running the cycle ...`);
    send({ t: "run", on: 1 });
    const tRun = Date.now();
    let grabbedPeak = false, lastLog = 0, projected = false;
    const f0 = state.frame;
    for (;;) {
        await sleep(1000);
        if (!state) continue;
        const done = state.frame - f0, secs = (Date.now() - tRun) / 1000;
        if (!projected && done >= 25) {
            projected = true;
            log(`[${TAG}] RATE ${(done / secs).toFixed(2)} steps/s -> full cycle projected at ` +
                `${(2497 / (done / secs) / 60).toFixed(1)} min`);
        }
        if (Date.now() - lastLog > 30000) {
            lastLog = Date.now();
            log(`  step ${state.frame} elevz ${state.elevz} ${state.phase} ` +
                `Epot ${state.epot} T ${state.temp} K (${(done / secs).toFixed(2)} steps/s)`);
        }
        if (!grabbedPeak && state.phase === "hold") { grabbedPeak = true; await grab(TAG + "-peak.gmd1"); }
        if (state.phase === "idle" && state.elev === 0 && done > 100) {
            log(`[${TAG}] cycle complete: ${done} steps in ${secs.toFixed(1)} s ` +
                `(${(done / secs).toFixed(2)} steps/s)`);
            send({ t: "run", on: 0 });
            await sleep(600);
            await grab(TAG + "-end.gmd1");
            fs.writeFileSync(path.join(OUT, TAG + "-timing.json"), JSON.stringify({
                tag: TAG, engine: state.engine, pot: state.pot, Nnm: NNM, Nsubnm: NSUB,
                nSheet: state.n, nSub: state.nsub, nBonds: state.nbonds,
                buildSeconds: tBuild, cycleSeconds: secs, steps: done,
                stepsPerSecond: done / secs,
                epotStart: startEpot, epotEnd: state.epot, tempEnd: state.temp,
                notices
            }, null, 2));
            log(`[${TAG}] final Epot ${state.epot} eV, T ${state.temp} K, bonds ${state.nbonds}`);
            process.exit(0);
        }
    }
}

setTimeout(() => { log("global timeout"); process.exit(1); }, 20000000);
