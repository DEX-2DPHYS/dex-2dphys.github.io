// Physics probe for the graphene-phonons plugin. Asserts on behaviour, not
// just on plumbing: a plugin that answers every message and simulates nothing
// would pass a connectivity test.

const crypto = require("crypto"), net = require("net");
const MAGIC = 0x31485047;
let fails = 0;
const ok = (name, cond, detail = "") => {
    if (!cond) fails++;
    console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};

const sock = net.connect(8090, "127.0.0.1", () => {
    sock.write("GET /ws/graphene-phonons HTTP/1.1\r\nHost:127.0.0.1:8090\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
        crypto.randomBytes(16).toString("base64") + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
sock.on("error", e => { console.log("socket error: " + e.message); process.exit(1); });

function wsf(p, op) {
    const m = crypto.randomBytes(4); let h;
    if (p.length < 126) h = Buffer.from([0x80 | op, 0x80 | p.length]);
    else { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0xFE; h.writeUInt16BE(p.length, 2); }
    const x = Buffer.from(p); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
    sock.write(Buffer.concat([h, m, x]));
}
const send = v => wsf(Buffer.from(JSON.stringify(v)), 1);
const askFrame = () => wsf(Buffer.from("f"), 1);

let chunks = [], total = 0, up = false, S = null, bin = null;
function peek(n){ if(total<n) return null; if(chunks[0].length>=n) return chunks[0].subarray(0,n);
  const b=Buffer.concat(chunks,total); chunks=[b]; return b.subarray(0,n); }
function take(n){ const b=chunks.length===1?chunks[0]:Buffer.concat(chunks,total);
  chunks=[b.subarray(n)]; total-=n; if(chunks[0].length===0) chunks=[]; return b.subarray(0,n); }
sock.on("data", d => {
    chunks.push(d); total += d.length;
    if (!up) { const b=Buffer.concat(chunks,total); const i=b.indexOf("\r\n\r\n"); if(i<0){chunks=[b];return;}
        up=true; chunks=[b.subarray(i+4)]; total=chunks[0].length; if(!total) chunks=[]; setTimeout(run,200); }
    for(;;){ const h=peek(2); if(!h) return; const op=h[0]&15; let len=h[1]&127, off=2;
        if(len===126){const q=peek(4); if(!q)return; len=q.readUInt16BE(2); off=4;}
        else if(len===127){const q=peek(10); if(!q)return; len=Number(q.readBigUInt64BE(2)); off=10;}
        if(total<off+len) return; take(off); const p=take(len);
        if(op===1){ try{const m=JSON.parse(p.toString()); if(m.t==="state") S=m;}catch{} }
        else if(op===2) bin=p; }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastBonds = null;
function parse(buf) {
    let o = 0;
    if (buf.readUInt32LE(0) !== MAGIC) { o = 12; if (buf.readUInt32LE(o) !== MAGIC) return null; }
    const flags = buf.readUInt32LE(o + 4);
    const n = buf.readUInt32LE(o + 8), nb = buf.readUInt32LE(o + 12);
    const step = buf.readUInt32LE(o + 16);
    const epot = buf.readFloatLE(o + 24), ekin = buf.readFloatLE(o + 28);
    let q = o + 32;
    const pos = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) pos[i] = buf.readFloatLE(q + 4 * i);
    q += 8 * n;
    if (flags & 1) {
        lastBonds = new Int32Array(nb * 2);
        for (let i = 0; i < nb * 2; i++) lastBonds[i] = buf.readInt32LE(q + 4 * i);
        q += 8 * nb;
    }
    if (!lastBonds || lastBonds.length !== nb * 2) return null;
    const bonds = lastBonds;
    const strain = new Float32Array(nb);
    for (let i = 0; i < nb; i++) strain[i] = buf.readFloatLE(q + 4 * i);
    return { n, nb, step, epot, ekin, pos, bonds, strain };
}
async function frame() { bin = null; askFrame(); for (let i = 0; i < 200 && !bin; i++) await sleep(25); return bin ? parse(bin) : null; }
async function state() { S = null; send({ t: "state", q: 1 }); for (let i = 0; i < 200 && !S; i++) await sleep(25); return S; }

async function run() {
    console.log("=== build ===");
    // no disorder, no damping: a perfect lattice must be an equilibrium
    send({ t: "build", cells: 8, L0: 1, off: 0, g: 0, dt: 0.01,
           useMorse: 1, De: 5, alpha: 2, useAng: 1, kAng: 8,
           doBreak: 0, doReform: 0, stepsPerFrame: 4 });
    await sleep(900);
    let f = await frame(), s = await state();
    ok("frame parses", !!f);
    ok("atom count is 2*cells^2", f.n === 2 * 8 * 8, `n=${f.n}`);
    // honeycomb bond count: 3 per cell minus the two open edges
    ok("bond count matches the honeycomb", f.nb === 3 * 64 - 2 * 8, `nb=${f.nb}`);
    ok("state agrees with the frame", s.n === f.n && s.nbonds === f.nb);

    console.log("\n=== a relaxed lattice is an equilibrium ===");
    const s0 = Math.max(...Array.from(f.strain).map(Math.abs));
    ok("as built, every bond is at its rest length", s0 < 1e-5, `max |strain| = ${s0.toExponential(2)}`);
    send({ t: "step", n: 400 });
    await sleep(1500);
    const f2 = await frame();
    let moved = 0;
    for (let i = 0; i < f.n * 2; i++) moved = Math.max(moved, Math.abs(f2.pos[i] - f.pos[i]));
    ok("it stays put with no disorder and no damping", moved < 1e-4,
       `max displacement after 400 steps = ${moved.toExponential(2)} L0`);
    ok("kinetic energy stays ~zero", Math.abs(f2.ekin) < 1e-6, `Ekin = ${f2.ekin.toExponential(2)}`);

    console.log("\n=== it actually vibrates when disturbed ===");
    send({ t: "build", cells: 8, L0: 1, off: 0.03, g: 0, dt: 0.01,
           useMorse: 1, De: 5, alpha: 2, useAng: 1, kAng: 8, doBreak: 0, doReform: 0 });
    await sleep(900);
    const a = await frame();
    send({ t: "step", n: 300 }); await sleep(1400);
    const b = await frame();
    ok("energy is non-zero", b.ekin > 0 && b.epot !== 0, `Ekin=${b.ekin.toFixed(3)} Epot=${b.epot.toFixed(3)}`);
    const eA = a.epot + a.ekin, eB = b.epot + b.ekin;
    ok("total energy is conserved without damping (<2%)",
       Math.abs(eB - eA) / Math.max(Math.abs(eA), 1e-9) < 0.02,
       `E: ${eA.toFixed(4)} -> ${eB.toFixed(4)}`);

    console.log("\n=== damping removes energy ===");
    send({ t: "params", g: 0.5 }); await sleep(200);
    send({ t: "step", n: 600 }); await sleep(2200);
    const c = await frame();
    ok("kinetic energy decays under damping", c.ekin < b.ekin * 0.5,
       `Ekin ${b.ekin.toFixed(4)} -> ${c.ekin.toFixed(4)}`);

    console.log("\n=== bond breaking ===");
    // Disorder tuned so SOME bonds break and some survive. At off = 0.30 every
    // bond broke, and "no surviving bond is over the threshold" then passed
    // over an EMPTY set -- a vacuous check that proves nothing.
    send({ t: "build", cells: 8, L0: 1, off: 0.10, g: 0.15, dt: 0.01,
           useMorse: 1, De: 5, alpha: 2, useAng: 1, kAng: 8,
           doBreak: 1, doReform: 0, fBreak: 1.15 });
    await sleep(900);
    const d0 = await frame();
    send({ t: "step", n: 400 }); await sleep(1800);
    const d1 = await frame();
    ok("some bonds break", d1.nb < d0.nb, `${d0.nb} -> ${d1.nb} bonds`);
    ok("but the lattice does NOT disintegrate (check is not vacuous)",
       d1.nb > 0.5 * d0.nb, `${d1.nb} of ${d0.nb} bonds survive`);
    let maxAbs = 0;
    for (const v of d1.strain) maxAbs = Math.max(maxAbs, Math.abs(v));
    ok("no surviving bond is past the break threshold", d1.nb > 0 && maxAbs <= 0.15 + 1e-3,
       `max strain ${maxAbs.toFixed(4)} over ${d1.nb} bonds, threshold 0.15`);

    console.log("\n=== re-forming restores bonds, never past valence 3 ===");
    send({ t: "params", doReform: 1, fReform: 1.10, g: 0.6 });
    await sleep(200);
    send({ t: "step", n: 800 }); await sleep(2600);
    const d2 = await frame();
    ok("some bonds come back", d2.nb > d1.nb, `${d1.nb} -> ${d2.nb} bonds`);
    ok("never exceeds the original neighbour list", d2.nb <= d0.nb, `${d2.nb} <= ${d0.nb}`);
    const val = new Int32Array(d2.n);
    for (let k = 0; k < d2.nb; k++) { val[d2.bonds[2 * k]]++; val[d2.bonds[2 * k + 1]]++; }
    ok("no atom exceeds valence 3", Math.max(...val) <= 3, `max valence ${Math.max(...val)}`);

    console.log("\n=== harmonic mode and second-neighbour springs ===");
    send({ t: "build", cells: 6, L0: 1, off: 0.02, g: 0, dt: 0.01,
           useMorse: 0, k: 40, useAng: 0, kAng: 0, doBreak: 0, doReform: 0 });
    await sleep(900);
    const h0 = await frame();
    ok("harmonic mode runs", h0 && h0.n === 72, `n=${h0 ? h0.n : "?"}`);
    send({ t: "step", n: 500 }); await sleep(2000);
    const h1 = await frame();
    let fin = true;
    for (const v of h1.pos) if (!Number.isFinite(v)) { fin = false; break; }
    ok("stays finite without angular springs", fin);

    if (process.argv.includes("--large")) {
        console.log("\n=== 500-cell transport limit ===");
        send({ t: "build", cells: 500, L0: 1, off: 0, g: 0.05, dt: 0.01,
               useMorse: 1, De: 5, alpha: 2, useAng: 1, kAng: 8,
               doBreak: 0, doReform: 0, stepsPerFrame: 1 });
        await sleep(5000);
        const big = await frame();
        ok("500 cells builds", big && big.n === 500000,
           `n=${big ? big.n.toLocaleString() : "?"}`);
        ok("500-cell honeycomb topology is complete",
           big && big.nb === 3 * 500 * 500 - 2 * 500,
           `nb=${big ? big.nb.toLocaleString() : "?"}`);
        const big2 = await frame();
        ok("topology-cached follow-up frame parses", !!big2 && big2.n === big.n);
    }

    console.log(fails === 0 ? "\nALL CLEAR" : `\n${fails} FAILURE(S)`);
    process.exit(fails === 0 ? 0 : 1);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 180000);
