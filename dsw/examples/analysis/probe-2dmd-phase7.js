// Phase 7 acceptance: the exported deck must RUN, in stock LAMMPS, and agree.
//
// Reading a generated input file proves nothing -- a deck that is syntactically
// perfect and physically wrong reads identically. So this exports the current
// state, shells out to lmp.exe, and compares the potential energy LAMMPS reports
// at the exported coordinates against what the plugin reports for the same atoms.
//
// They should agree closely, because both compute the same thing by different
// routes: AIREBO over the sheets plus a Lennard-Jones to a rigid substrate --
// injected through `fix external` in the plugin, written as real frozen atoms
// with an lj/cut coefficient in the deck. A disagreement means a wrong pair
// coefficient or a wrong geometry, and both matter.
//
//   node probe-2dmd-phase7.js

const crypto = require("crypto"), net = require("net"), fs = require("fs"),
      os = require("os"), path = require("path"), cp = require("child_process");

const LMP = "C:/Users/pbog/b/lammps/build/lmp.exe";
// lmp.exe is a MinGW build and needs its runtime DLLs (libgomp, libstdc++,
// libgcc) on PATH. Without them it exits 0xC0000139 -- ENTRY POINT NOT FOUND --
// with no output whatsoever, which looks exactly like a blocked binary and is
// not one. That cost a wrong diagnosis once already.
const MINGW = "C:/Users/pbog/AppData/Local/Microsoft/WinGet/Packages/"
            + "BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/"
            + "mingw64/bin";
const ENV = Object.assign({}, process.env, { PATH: MINGW + ";" + process.env.PATH });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ch = [], tot = 0, up = false, S = null, note = null;

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
    if (op === 1) { try { const m = JSON.parse(p.toString());
      if (m.t === "state") S = m; else note = m; } catch {} } }
});
const send = v => { const b = Buffer.from(JSON.stringify(v)), m = crypto.randomBytes(4);
  let h; if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(b.length, 2); }
  const x = Buffer.from(b); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3];
  sock.write(Buffer.concat([h, m, x])); };
const st = async () => { S = null; send({ t: "state", q: 1 });
  for (let i = 0; i < 800 && !S; i++) await sleep(25); return S; };

let bad = 0;
const check = (name, ok, detail) => {
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   " + detail : ""));
  if (!ok) bad++;
};

async function run() {
  console.log("2dmd phase 7 — the exported deck, run in stock LAMMPS\n");
  if (!fs.existsSync(LMP)) { console.log("  lmp.exe not found at " + LMP); process.exit(1); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "2dmd-export-"));
  console.log("  export dir: " + dir);

  // Small on purpose: LAMMPS has to actually run it, here, in this probe.
  send({ t: "build", nLayers: 1, Nnm: 5, Nsubnm: 8, twistDeg: 0,
         zSub: 3.35, z0: 3.35, substrateOn: 1, engine: "lammps",
         dt: 0.5, gamma: 1.0, edgeK: 0, stepsPerFrame: 10 });
  let s = null;
  for (let i = 0; i < 400; i++) { s = await st(); if (s && s.n > 0) break; await sleep(400); }
  check("plugin is on the LAMMPS engine", s && s.engine === "lammps",
        s ? s.n + " sheet atoms, Epot " + s.epot.toFixed(2) + " eV" : "");
  if (!s || s.engine !== "lammps") { console.log("  cannot compare without it."); process.exit(1); }
  const pluginE = s.epot, nSheet = s.n;

  note = null;
  send({ t: "export", dir: dir.replace(/\\/g, "/"), steps: 0, dumpEvery: 1000 });
  for (let i = 0; i < 400 && !note; i++) await sleep(25);
  check("the plugin wrote a deck", note && note.t === "exported",
        note ? note.atoms + " atoms (" + note.sheets + " sheet + " +
               note.substrate + " substrate)" : "no reply");
  if (!note || note.t !== "exported") process.exit(1);

  for (const f of ["system.data", "in.2dmd", "CH.airebo"]) {
    const p = path.join(dir, f);
    check("wrote " + f, fs.existsSync(p),
          fs.existsSync(p) ? (fs.statSync(p).size / 1024).toFixed(0) + " KB" : "missing");
  }
  check("the deck is self-contained", fs.existsSync(path.join(dir, "CH.airebo")),
        "the potential travels with it, so the folder can be zipped and sent");

  // ---- the part that matters --------------------------------------------
  console.log("\n  Running lmp.exe on it...");
  let out = "";
  try {
    out = cp.execSync('"' + LMP + '" -in in.2dmd -log none',
                      { cwd: dir, encoding: "utf8", timeout: 900000, env: ENV });
  } catch (e) { out = (e.stdout || "") + "\n" + (e.stderr || ""); }
  const errs = out.split(/\r?\n/).filter(l => /^ERROR|Last input line/i.test(l));
  check("LAMMPS ran the deck", errs.length === 0,
        errs.length ? "\n      " + errs.slice(0, 3).join("\n      ") : "no errors");
  if (errs.length) { console.log("\n  " + bad + " CHECK(S) FAILED"); process.exit(1); }

  // The first PE printed is the energy AT THE EXPORTED COORDINATES, before the
  // deck's own minimize moves anything -- which is what makes it comparable.
  const lines = out.split(/\r?\n/);
  let hdr = -1;
  for (let i = 0; i < lines.length; i++)
    if (/^\s*Step\s/.test(lines[i]) && /PotEng|E_pair|TotEng/.test(lines[i])) { hdr = i; break; }
  let lmpE = NaN;
  if (hdr >= 0) {
    const names = lines[hdr].trim().split(/\s+/);
    let col = names.indexOf("PotEng");
    if (col < 0) col = names.indexOf("E_pair");
    for (let i = hdr + 1; i < lines.length; i++) {
      const t = lines[i].trim().split(/\s+/);
      if (t.length > col && /^-?\d/.test(t[0])) { lmpE = Number(t[col]); break; }
    }
  }
  console.log("");
  console.log("    plugin, via fix external   " + pluginE.toFixed(3) + " eV");
  console.log("    stock LAMMPS deck          " +
              (isFinite(lmpE) ? lmpE.toFixed(3) : "not parsed") + " eV");
  if (isFinite(lmpE)) {
    const rel = Math.abs(lmpE - pluginE) / Math.abs(pluginE);
    console.log("    difference                 " + (100 * rel).toFixed(3) + " %   (" +
                (lmpE - pluginE).toFixed(3) + " eV over " + nSheet + " sheet atoms)");
    check("the two routes agree on the energy", rel < 0.01,
          "same atoms, same AIREBO; substrate as fix-external vs frozen atoms");
  } else check("energy parsed from the LAMMPS output", false);

  check("a trajectory was written", fs.existsSync(path.join(dir, "sheet.lammpstrj")));

  console.log("\n  deck kept at " + dir);
  console.log("  " + (bad ? bad + " CHECK(S) FAILED" : "ALL CLEAR — phase 7 gate met"));
  process.exit(bad ? 1 : 0);
}
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 1200000);
