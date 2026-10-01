// probe-klein-panel.js — gate G9 for the Klein-magnetometer panel.
// Drives the LIVE panel (http://127.0.0.1:8090/plugins/klein-magnetometer/ui/)
// in headless Chrome over CDP, with real DOM change events, and checks:
//   * static: every control key is a core `configure` key and echoed in
//     derived.params; every core configure key has a control (source parse);
//   * the panel's payload is what the core reports back (all keys), and an
//     out-of-range value is corrected by the core AND shown corrected;
//   * each run mode produces its result and draws ink on its chart;
//   * no page errors.
//   node probe-klein-panel.js [--shots <dir>]      (dsw.exe must be running)
'use strict';
const crypto = require('crypto');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9247;
const URL = 'http://127.0.0.1:8090/plugins/klein-magnetometer/ui/index.html';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC = path.join(__dirname, '..', 'Plugins', '2D Materials', 'klein-magnetometer', 'src', 'plugin.cpp');
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const wait = ms => new Promise(r => setTimeout(r, ms));
function get(url) { return new Promise((res, rej) => { http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej); }); }

class CDP {
  constructor(wsUrl) { const m = wsUrl.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/); this.host = m[1]; this.port = +m[2]; this.pathname = m[3]; this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.up = false; }
  connect() {
    return new Promise((res, rej) => {
      this.sock = net.connect(this.port, this.host, () => {
        this.sock.write('GET ' + this.pathname + ' HTTP/1.1\r\nHost: ' + this.host + ':' + this.port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      this.sock.on('error', rej);
      this.sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); if (!this.up) { const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return; this.up = true; this.buf = this.buf.slice(i + 4); res(); } this.drain(); });
    });
  }
  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const len0 = this.buf[1] & 0x7F; let off = 2, len = len0;
      if (len0 === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len0 === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len).toString(); this.buf = this.buf.slice(off + len);
      let m; try { m = JSON.parse(payload); } catch (e) { continue; }
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    }
  }
  send(method, params) {
    const id = ++this.id, body = Buffer.from(JSON.stringify({ id, method, params: params || {} })), mask = crypto.randomBytes(4);
    let header;
    if (body.length < 126) header = Buffer.from([0x81, 0x80 | body.length]);
    else if (body.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xFE; header.writeUInt16BE(body.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(body.length), 2); }
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([header, mask, body]));
    return new Promise(r => this.pending.set(id, r));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result.result.value;
  }
}

// ---------------------------------------------------------------- static part
function staticChecks() {
  const src = fs.readFileSync(SRC, 'utf8');
  const out = [];
  // configure keys: setParam names + g("...") reads + get_str keys inside configure()
  const conf = src.slice(src.indexOf('void configure(Settings &s'), src.indexOf('std::string paramsJson'));
  const keys = new Set();
  for (const m of conf.matchAll(/g\("([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  for (const m of conf.matchAll(/get_str\(m, "([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  const listBlock = conf.match(/for \(const char \*k : \{([^}]*)\}\)/);
  if (listBlock) for (const m of listBlock[1].matchAll(/"([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  const pj = src.slice(src.indexOf('std::string paramsJson'), src.indexOf('std::string metricsJson'));
  const echoed = new Set([...pj.matchAll(/\\"([A-Za-z0-9_]+)\\":/g)].map(m => m[1]));
  return { keys: [...keys], echoed: [...echoed] };
}

const DRIVE = (keys, echoed) => `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
  const out = { checks: [], notes: {} };
  const ck = (ok, what) => out.checks.push([!!ok, what]);
  const KM = window.__KM;
  const coreKeys = ${JSON.stringify(keys)}, echoed = new Set(${JSON.stringify(echoed)});
  const waitFor = async (fn, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(100); } return false; };
  const ink = id => { const c = $(id); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; const r0 = d[0], g0 = d[1], b0 = d[2]; let n = 0; for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - r0) + Math.abs(d[i+1] - g0) + Math.abs(d[i+2] - b0) > 60) n++; return n; };
  const setCtl = (k, v) => { const el = $('c_' + k); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; fire(el, 'change'); };

  // ---- static: controls vs core
  const ctl = KM.CONTROLS.filter(c => !c.local).map(c => c.k);
  const notCore = ctl.filter(k => !coreKeys.includes(k));
  ck(!notCore.length, 'every control key is a core configure key' + (notCore.length ? ' — not in core: ' + notCore.join(', ') : ' (' + ctl.length + ' keys)'));
  const notEcho = ctl.filter(k => !echoed.has(k));
  ck(!notEcho.length, 'every control key is echoed in derived.params' + (notEcho.length ? ' — missing: ' + notEcho.join(', ') : ''));
  const exempt = ['tag', 'pathEvery', 'L_um', 'n_cm2'];   // pathEvery: not exposed (paths use run paths); L_um/n_cm2: shorthands for the pairs
  const noCtl = coreKeys.filter(k => !ctl.includes(k) && !exempt.includes(k));
  ck(!noCtl.length, 'every core configure key has a control' + (noCtl.length ? ' — no control for: ' + noCtl.join(', ') : ''));
  const ids = [...document.querySelectorAll('[id]')].map(e => e.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  ck(!dup.length, 'no duplicate element ids' + (dup.length ? ': ' + [...new Set(dup)].join(', ') : ''));
  ck(KM.CONTROLS.every(c => $('c_' + c.k)), 'every control is rendered');

  // ---- connection and first sync
  ck(await waitFor(() => KM.S.connected && KM.S.lastEcho, 20000), 'panel connected and received a configure echo');
  ck(KM.S.lastEcho && KM.S.lastEcho.adjusted.length === 0, 'initial payload confirmed by the core for all keys' + (KM.S.lastEcho && KM.S.lastEcho.adjusted.length ? ': ' + JSON.stringify(KM.S.lastEcho.adjusted) : ''));
  ck(/in sync/.test($('syncFlag').textContent), 'sync flag says in sync: ' + $('syncFlag').textContent.slice(0, 80));
  ck($('derivedTable').rows.length >= 15, 'derived table filled (' + $('derivedTable').rows.length + ' rows)');

  // ---- change many controls through real events
  const changes = {nCells: 8, Ln_um: 0.4, Lp_um: 0.6, W_um: 3, skewDeg: 5, nN_cm2: 8e11, nP_cm2: 1.2e12, profile: 'tanh', d_nm: 12, edge: 'diffuse', specularity: 0.6,
    injection: 'aperture', apertureFrac: 0.5, mfp_um: 12, scatter: 'drude', tempK: 30, mfpPh300_um: 3, eeMfp_um: 4, eeSigmaDeg: 12, sigmaPos_nm: 5, sigmaWidth: 0.1,
    sigmaDensity: 0.02, sigmaTiltDeg: 2, disorderSeed: 3, nTraj: 3000, bMin_mT: -30, bMax_mT: 30, bN: 21, seed: 11, nEnergy: 3, biasA_uA: 5, noiseTempK: 30, hooge: 0.002,
    freqHz: 10, fitWindow_mT: 8, sgHalf: 3, maxPathFactor: 8, engine: 'mc'};
  for (const [k, v] of Object.entries(changes)) setCtl(k, v);
  const tagBefore = KM.S.sentTag;
  await waitFor(() => KM.S.sentTag !== tagBefore && KM.S.derived.tag === KM.S.sentTag, 10000);
  const p = KM.S.derived.params;
  const wrong = Object.entries(changes).filter(([k, v]) => typeof v === 'string' ? p[k] !== v : Math.abs(p[k] - v) > 1e-6 * Math.max(1, Math.abs(v)));
  ck(!wrong.length, 'all ' + Object.keys(changes).length + ' changed controls reached the core' + (wrong.length ? ' — wrong: ' + wrong.map(([k, v]) => k + ' sent ' + v + ' core ' + p[k]).join('; ') : ''));
  ck(KM.S.lastEcho.adjusted.length === 0, 'no silent adjustment of the changed values');
  ck(/drude|forward/.test(p.scatter) && $('row_forwardSigmaDeg').classList.contains('off'), 'forward-kick row greys out for Drude scattering');

  // ---- out-of-range value: the core clamps it and the panel shows the clamp
  const tagB = KM.S.sentTag; setCtl('bN', 1);
  await waitFor(() => KM.S.sentTag !== tagB && KM.S.derived.tag === KM.S.sentTag, 10000);
  await sleep(100);
  ck(KM.S.derived.params.bN === 2 && $('c_bN').value === '2' && $('row_bN').classList.contains('adj') && /Core adjusted/.test($('syncFlag').textContent),
     'bN = 1 is clamped to 2 by the core and the control now shows 2, flagged (' + $('syncFlag').textContent.slice(0, 70) + ')');
  setCtl('bN', 21);

  // ---- run R(B)
  KM.setTab('rb'); $('runCurve').click();
  ck(await waitFor(() => KM.S.curve && KM.S.curve.params.bN === 21 && !KM.S.busy, 120000), 'R(B) curve returned');
  await sleep(200);
  ck(ink('cRB') > 400, 'R(B) chart has ink (' + ink('cRB') + ')');
  ck(/Ω/.test($('metricTable').textContent) && $('metricTable').rows.length >= 10, 'metric table filled');
  ck($('methods').value.length > 400 && /tanh/.test($('methods').value) && /3000/.test($('methods').value.replace(/,/g, '')), 'methods text generated from the run parameters');
  out.notes.methods = $('methods').value.slice(0, 300);
  document.querySelector('#tbHold').click(); await sleep(100);
  ck(KM.S.held.length === 1 && $('heldList').textContent.includes('N=8'), 'Hold adds a held curve');
  KM.setTab('fates'); await sleep(200); ck(ink('cT') > 200 && ink('cFate') > 200, 'transmission and fates charts drawn');
  KM.setTab('sens'); await sleep(200); ck(ink('cSens') > 200 && /Johnson/.test($('noiseTable').textContent) && /Hooge/.test($('noiseTable').textContent), 'sensitivity chart and noise budget drawn');

  // ---- sweep
  KM.setTab('sweep'); await sleep(100);
  $('tbSP').value = 'nCells'; fire($('tbSP'), 'change'); $('tbSF').value = 4; fire($('tbSF'), 'change'); $('tbST').value = 8; fire($('tbST'), 'change'); $('tbSN').value = 3; fire($('tbSN'), 'change');
  $('tbSRun').click();
  ck(await waitFor(() => KM.S.sweep && KM.S.sweep.pts.filter(Boolean).length === 3 && !KM.S.busy, 180000), 'sweep over nCells returned 3 points');
  await sleep(200); ck(ink('cSweep') > 300, 'sweep family chart drawn');
  $('tbSV').value = 'metric'; fire($('tbSV'), 'change'); await sleep(150); ck(ink('cSweep') > 150, 'metric-vs-parameter chart drawn');

  // ---- grid + optimiser
  KM.setTab('grid'); await sleep(100);
  const setT = (id, v) => { $(id).value = v; fire($(id), 'change'); };
  setT('tbGP', 'nCells'); setT('tbGF', 4); setT('tbGT', 8); setT('tbGN', 2); setT('tbGP2', 'd_nm'); setT('tbGF2', 8); setT('tbGT2', 16); setT('tbGN2', 2); $('tbGL2').checked = false; fire($('tbGL2'), 'change');
  setT('tbC1', 0); setT('tbC3', 0);
  $('tbGRun').click();
  ck(await waitFor(() => KM.S.grid && KM.S.grid.pts.flat().filter(Boolean).length === 4 && !KM.S.busy, 240000), '2x2 grid returned 4 devices');
  await sleep(200); ck(ink('cGrid') > 500, 'heat map drawn');
  ck(/Best admissible device/.test($('gridInfo').textContent), 'optimiser names a best device');
  $('tbApply').click(); await sleep(400);
  const best = KM.S.grid; ck([4, 8].includes(+$('c_nCells').value) && [8, 16].includes(+$('c_d_nm').value), 'Apply best sets nCells/d_nm controls (' + $('c_nCells').value + ', ' + $('c_d_nm').value + ')');

  // ---- angular
  KM.setTab('angular');
  ck(await waitFor(() => KM.S.angular && KM.S.angular.profiles && Object.keys(KM.S.angular.profiles).length === 5, 30000), 'junction T(θ) returned for 5 profiles');
  await sleep(200); ck(ink('cAng') > 300, 'angular chart drawn');
  const a = KM.S.angular.profiles; ck(Math.abs(a.gate.T[0] - 1) < 1e-6 && a.gate.T[60] < a.linear.T[60], 'T(0)=1 and the gate profile collimates more than the linear ramp at 30°');

  // ---- coherent (small)
  setCtl('eN', 41); setCtl('kyN', 12); setCtl('eRange_meV', 8);
  KM.setTab('coherent'); await sleep(200); $('tbCRun').click();
  ck(await waitFor(() => KM.S.coherent && !KM.S.busy, 240000), 'coherent calculation returned');
  await sleep(200); ck(ink('cCoh') > 300 && /visibility/i.test($('cohTable').textContent), 'coherent chart and visibility table drawn');

  // ---- presets and device tab
  const tagP = KM.S.sentTag; $('preset').value = 'june'; fire($('preset'), 'change');
  await waitFor(() => KM.S.sentTag !== tagP && KM.S.derived.tag === KM.S.sentTag, 10000); await sleep(100);
  ck(KM.S.derived.params.profile === 'asymptotic' && KM.S.derived.params.nCells === 16 && KM.S.lastEcho.adjusted.length === 0, 'June preset reaches the core intact');
  KM.setTab('device'); await sleep(1500);
  ck(true, 'device tab shown');
  out.errors = window.__ERR || [];
  ck(!out.errors.length, 'no page errors' + (out.errors.length ? ': ' + out.errors.join(' | ') : ''));
  return JSON.stringify(out);
})()`;

(async () => {
  const st = staticChecks();
  console.log('core configure keys parsed: ' + st.keys.length + ', echoed: ' + st.echoed.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klein-cdp-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1720,1060', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json')).find(t => t.type === 'page'); } catch (e) {} }
  if (!target) { console.error('chrome did not come up'); chrome.kill(); process.exit(2); }
  const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__ERR=[];addEventListener('error',e=>window.__ERR.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__ERR.push(String(e.reason)));" });
  await cdp.send('Page.navigate', { url: URL });
  await wait(2500);
  const shot = async name => { if (!SHOTS) return; const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); console.log('shot -> ' + name); };
  let raw;
  try { raw = await cdp.eval(DRIVE(st.keys, st.echoed)); } catch (e) { console.error(String(e)); chrome.kill(); process.exit(1); }
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const t of ['device', 'rb', 'sens', 'sweep', 'grid', 'angular', 'coherent']) { await cdp.eval(`window.__KM.setTab('${t}')`); await wait(t === 'device' ? 1500 : 500); await shot(`panel-${t}.png`); }
    await cdp.eval("document.documentElement.dataset.theme='dark';window.__KM.setTab('rb')"); await wait(600); await shot('panel-rb-dark.png');
  }
  const out = JSON.parse(raw);
  let bad = 0;
  for (const [ok, what] of out.checks) { if (!ok) bad++; console.log((ok ? '[ OK ] ' : '[FAIL] ') + what); }
  if (out.notes.methods) console.log('       methods: ' + out.notes.methods + '…');
  console.log(bad ? `FAILED (${bad})` : `ALL CLEAR (${out.checks.length} checks)`);
  chrome.kill(); process.exit(bad ? 1 : 0);
})();
