// Drive the LIVE 2DMD panel and watch what happens when a material is chosen
// at a large size.
//
// Peter: "selecting MoS2 (rebo) or any other often reverts the view to
// graphene ... especially for large sizes, starting even around 20. could it be
// memory problem?"
//
// Already ruled out by measurement, so this is the remaining suspect:
//   * the core holds the right material at every size up to 30 nm / 62k atoms
//     (mat=mos2, pot=MoS.rebomos, engine=lammps, no error);
//   * the frames carry the right thing too -- 2 mobile layers, the right atom
//     counts, and a 3.4-4.3 A sandwich rather than a flat sheet;
//   * the page DOES send a build carrying the chosen material.
// So whatever reverts is in the page's own state, which is what this reads.
//
// Chrome runs HEADED here on purpose: requestAnimationFrame does not fire in
// headless, and dex.js drives every frame from it, so a headless run would show
// no frames arriving and prove nothing about frame handling.
//
//   node probe-2dmd-matlive.js          (needs dsw.exe running on :8090)

const crypto = require("crypto"), net = require("net"), http = require("http"),
      fs = require("fs"), os = require("os"), path = require("path"),
      { spawn } = require("child_process");

const PORT = 9251;
const URL = "http://127.0.0.1:8090/plugins/2dmd/ui/index.html";
const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(p => fs.existsSync(p));

const wait = ms => new Promise(r => setTimeout(r, ms));
const get = url => new Promise((res, rej) => {
  http.get(url, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res(b)); })
      .on("error", rej);
});

class CDP {
  constructor(ws) {
    const m = ws.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    this.host = m[1]; this.port = +m[2]; this.path = m[3];
    this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.up = false;
  }
  connect() {
    return new Promise((res, rej) => {
      this.sock = net.connect(this.port, this.host, () => {
        this.sock.write("GET " + this.path + " HTTP/1.1\r\nHost: " + this.host + ":" +
          this.port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
          crypto.randomBytes(16).toString("base64") + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
      });
      this.sock.on("error", rej);
      this.sock.on("data", d => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!this.up) {
          const i = this.buf.indexOf("\r\n\r\n");
          if (i < 0) return;
          this.up = true; this.buf = this.buf.subarray(i + 4); res();
        }
        for (;;) {
          if (this.buf.length < 2) return;
          let len = this.buf[1] & 127, off = 2;
          if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
          if (this.buf.length < off + len) return;
          const payload = this.buf.subarray(off, off + len).toString();
          this.buf = this.buf.subarray(off + len);
          try { const m = JSON.parse(payload);
            if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
          } catch {}
        }
      });
    });
  }
  send(method, params) {
    const id = ++this.id, msg = Buffer.from(JSON.stringify({ id, method, params: params || {} }));
    const mask = crypto.randomBytes(4);
    let h;
    if (msg.length < 126) h = Buffer.from([0x81, 0x80 | msg.length]);
    else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(msg.length, 2); }
    const x = Buffer.from(msg); for (let i = 0; i < x.length; i++) x[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([h, mask, x]));
    return new Promise(r => this.pending.set(id, r));
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails)
      return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
}

let bad = 0;
const ck = (n, ok, d) => { console.log("    " + (ok ? "PASS" : "FAIL") + "  " + n +
  (d ? "   " + d : "")); if (!ok) bad++; };

// what the page believes, in one shot
const SNAP = `(() => { const q = id => document.getElementById(id); return {
  select:   (q('material')||{}).value,
  engine:   (q('engine')||{}).value,
  Nnm:      (q('Nnm')||{}).value,
  sMaterial: S.material, matKey: S.matKey, specNsp: S.specNsp,
  nTop: S.top.length, nBonds: S.bonds.length,
  colorMode: S.colorMode, pointsMode: S.pointsMode,
  status: (document.getElementById('status')||{}).textContent,
  frame: S.frame, err: (window.__err||[]).slice(-3),
}; })()`;

(async () => {
  if (!CHROME) { console.log("no chrome found"); process.exit(1); }
  const prof = path.join(os.tmpdir(), "2dmd-live-" + process.pid);
  fs.mkdirSync(prof, { recursive: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT,
    "--user-data-dir=" + prof, "--no-first-run", "--no-default-browser-check",
    "--window-size=1500,950", URL], { stdio: "ignore", detached: false });

  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await wait(500);
    try { const list = JSON.parse(await get("http://127.0.0.1:" + PORT + "/json"));
      const pg = list.find(t => t.type === "page" && t.url.indexOf("2dmd") >= 0);
      if (pg) ws = pg.webSocketDebuggerUrl; } catch {}
  }
  if (!ws) { console.log("could not attach to the page"); chrome.kill(); process.exit(1); }

  const cdp = new CDP(ws);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.eval("window.__err=[];addEventListener('error',e=>window.__err.push(e.message));");
  await wait(6000);                       // let it connect and build once

  console.log("2DMD: picking a material on the live panel\n");

  const SIZES = [12];
  for (const nm of SIZES) {
    // start from graphene at this size, exactly as a user would
    await cdp.eval(`(() => { const q=id=>document.getElementById(id);
      q('material').value='graphene';
      q('material').dispatchEvent(new Event('change',{bubbles:true}));
      q('Nnm').value=${nm}; q('Nsubnm').value=${nm};
      q('Nnm').dispatchEvent(new Event('change',{bubbles:true}));
      q('nLayers').dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await wait(nm >= 20 ? 200000 : 70000);
    const before = await cdp.eval(SNAP);

    // now pick MoS2, and nothing else
    await cdp.eval(`(() => { const q=id=>document.getElementById(id);
      q('material').value='mos2';
      q('material').dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await wait(2500);
    const busy = await cdp.eval(`(() => { const b=document.getElementById('buildBar');
      return { shown: b && !b.hidden,
               what: (document.getElementById('buildWhat')||{}).textContent,
               time: (document.getElementById('buildTime')||{}).textContent,
               fill: (document.getElementById('buildFill')||{}).style.width }; })()`);
    ck(nm + " nm: the Setting up bar is showing",
       !!(busy && busy.shown && /setting up/i.test(String(busy.what))),
       JSON.stringify(busy));
    ck(nm + " nm: the bar has started filling",
       !!(busy && parseFloat(busy.fill) > 0 && parseFloat(busy.fill) <= 96),
       "fill=" + (busy ? busy.fill : "?") + "  " + (busy ? busy.time : ""));
    await wait(nm >= 20 ? 220000 : 90000);
    const after = await cdp.eval(SNAP);

    if (!after || after.__err) {
      console.log("    " + nm + " nm: " + JSON.stringify(after));
      bad++; continue;
    }
    console.log("    " + nm + " nm   graphene: select=" + before.select +
      " atoms=" + before.nTop + " nsp=" + before.specNsp + " bonds=" + before.nBonds);
    console.log("           after MoS2: select=" + after.select +
      " matKey=" + after.matKey + " atoms=" + after.nTop +
      " nsp=" + after.specNsp + " bonds=" + after.nBonds +
      (after.err && after.err.length ? "  ERR " + after.err.join(" | ") : ""));

    ck(nm + " nm: the selector still says mos2", after.select === "mos2", after.select);
    ck(nm + " nm: the page's material followed", after.sMaterial === "mos2", after.sMaterial);
    ck(nm + " nm: the core reports mos2", after.matKey === "mos2", after.matKey);
    ck(nm + " nm: the atom count changed to the MoS2 lattice",
       after.nTop !== before.nTop, before.nTop + " -> " + after.nTop);
    ck(nm + " nm: species were received (a TMD has 2+)",
       after.specNsp >= 2, "specNsp=" + after.specNsp);
    ck(nm + " nm: bonds were re-derived", after.nBonds > 0,
       "bonds=" + after.nBonds);
    const done = await cdp.eval(`(() => ({
      what: (document.getElementById('buildWhat')||{}).textContent,
      time: (document.getElementById('buildTime')||{}).textContent }))()`);
    ck(nm + " nm: the bar finished and reported the real time",
       /built in/i.test(String(done && done.time)), JSON.stringify(done));
    console.log("");
  }

  console.log("  " + (bad ? bad + " CHECK(S) FAILED"
    : "ALL CLEAR — the panel follows the material at every size tested"));
  chrome.kill();
  process.exit(bad ? 1 : 0);
})();
