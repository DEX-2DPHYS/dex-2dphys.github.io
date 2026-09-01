// Does {t:"step", n:N} actually advance a graphene-md session while the run
// loop is off? Asks for state explicitly (q) rather than waiting for the
// periodic broadcast.
const crypto = require("crypto"), net = require("net");
const sock = net.connect(8090, "127.0.0.1", () => {
    sock.write("GET /ws/graphene-md HTTP/1.1\r\nHost: 127.0.0.1:8090\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
        crypto.randomBytes(16).toString("base64") +
        "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
function wsframe(p, op) {
    const m = crypto.randomBytes(4); let h;
    if (p.length < 126) h = Buffer.from([0x80 | op, 0x80 | p.length]);
    else { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0xFE; h.writeUInt16BE(p.length, 2); }
    const x = Buffer.from(p); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    sock.write(Buffer.concat([h, m, x]));
}
const send = v => wsframe(Buffer.from(JSON.stringify(v)), 1);
let buf = Buffer.alloc(0), up = false, S = null, nbin = 0;
sock.on("data", d => {
    buf = Buffer.concat([buf, d]);
    if (!up) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; up = true; buf = buf.slice(i + 4); setTimeout(run, 200); }
    for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const p = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (op === 1) { try { const m = JSON.parse(p.toString()); if (m.t === "state") S = m; } catch {} }
        else if (op === 2) nbin++;
    }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function st(tag) { S = null; send({ t: "state", q: 1 }); for (let i = 0; i < 60 && !S; i++) await sleep(50);
    console.log(`  ${tag}: frame=${S && S.frame} running=${S && S.running} elev=${S && S.elev} elevz=${S && S.elevz} phase=${S && S.phase}`); return S; }

async function run() {
    send({ t: "build", Nnm: 12, Nsubnm: 12, z0: 3.35, twistDeg: 0, material: "graphene", engine: "classic" });
    await sleep(1500);
    await st("after build");

    console.log("A) step 100 with run OFF and elevation NOT armed");
    send({ t: "run", on: 0 }); await sleep(300);
    let a = await st("  before");
    send({ t: "step", n: 100 }); await sleep(2000);
    let b = await st("  after 2 s");
    console.log(`  -> advanced ${b.frame - a.frame} steps`);

    console.log("B) arm elevation, take run loop back, then step 100");
    send({ t: "elev", on: 1 }); await sleep(300);
    send({ t: "run", on: 0 }); await sleep(500);
    a = await st("  before");
    send({ t: "step", n: 100 }); await sleep(2000);
    b = await st("  after 2 s");
    console.log(`  -> advanced ${b.frame - a.frame} steps`);

    console.log("C) same, but with a frame request in between (as the capture does)");
    a = await st("  before");
    send({ t: "step", n: 100 });
    wsframe(Buffer.from("f"), 1);
    await sleep(2000);
    b = await st("  after 2 s");
    console.log(`  -> advanced ${b.frame - a.frame} steps, ${nbin} binary frames seen`);
    process.exit(0);
}
setTimeout(() => { console.log("timeout"); process.exit(1); }, 60000);
