// Paused placement must not put atoms inside atoms. Paused, the Hand carries a piece rigidly (placePaused) and no forces act, so before
// 2026-11-13 a building block could be put down straight into the flake; Run then started from overlapping atoms and the energy blew up
// within a few hundred steps (the crash screen). Now the piece rides up until it touches (PLACE_DMIN in src/main.js).
// Drives the real carry path on the desktop: Pause, pick the block up with the mouse, move it onto the flake, let go, Run.
//
//   node test/paused-place.cjs <index.html>
// needs puppeteer-core (in %LOCALAPPDATA%\ulam-build, \fv-test or \ink2latex-deps on Peter's PCs).
const fs = require('fs'), path = require('path'), http = require('http');
const LA = process.env.LOCALAPPDATA;
const DIRS = ['ulam-build', 'fv-test', 'ink2latex-deps'];
const req = (m) => { for (const d of DIRS) { const p = path.join(LA, d, 'node_modules', m); if (fs.existsSync(p)) return require(p); } return require(m); };
const puppeteer = req('puppeteer-core');
const [, , page0] = process.argv;
const html = fs.readFileSync(page0, 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0, '127.0.0.1');
let fail = 0; const ok = (name, cond, info = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// where the block is put down, relative to the flake's centre (A, box coordinates): exactly on top of it, shifted so no atom
// coincides, half over its edge
const CASES = [['on the flake', [0, 0, 0]], ['shifted 0.7 A', [0.7, 0.4, 0]], ['half over the edge', [-12, 0, 0]]];

(async () => {
  await new Promise((r) => srv.listening ? r() : srv.once('listening', r));
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1200,800', `--user-data-dir=${path.join(LA, 'Temp', 'mdpp-' + Date.now())}`] });
  for (const [name, off] of CASES) {
    const p = await browser.newPage(); await p.setViewport({ width: 1200, height: 800 });
    const errs = []; p.on('pageerror', (e) => { if (!/Unexpected token/.test(e.message)) errs.push(e.message); });
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' }); await wait(1500);
    const ev = (f, ...a) => p.evaluate(f, ...a);
    await ev(() => { window.__mdlab.renderer.render = () => {}; });      // (only the MD is under test: frames come quicker)
    // a block beside the flake, Pause, pick the block up with the mouse
    await ev(() => { const L = window.__mdlab; window.__N0 = L.md.N; L.addBlock(); L.setPaused(true); L.startCarry('mouse', window.__N0); });
    await wait(300);
    // move the hand so the block's centre comes to the flake's centre + off
    await ev((off) => {
      const L = window.__mdlab, m = L.md, N0 = window.__N0, V = L.camera.position.constructor, c = (a, b) => { const v = new V(); for (let i = a; i < b; i++) v.add(new V(m.x[i], m.y[i], m.z[i])); return v.divideScalar(b - a); };
      L.inner.updateWorldMatrix(true, false);
      const to = c(0, N0).add(new V(off[0], off[1], off[2])).applyMatrix4(L.inner.matrixWorld), from = c(N0, m.N).applyMatrix4(L.inner.matrixWorld);
      L.mouseRay.origin.add(to.sub(from));
    }, off);
    await wait(500);
    const placed = await ev(() => {
      const L = window.__mdlab, m = L.md, N0 = window.__N0; let d2 = 1e9;
      for (let i = N0; i < m.N; i++) for (let j = 0; j < N0; j++) d2 = Math.min(d2, (m.x[i] - m.x[j]) ** 2 + (m.y[i] - m.y[j]) ** 2 + (m.z[i] - m.z[j]) ** 2);
      let zb = 0, zs = 0; for (let i = N0; i < m.N; i++) zb += m.z[i]; for (let j = 0; j < N0; j++) zs += m.z[j];
      L.stopCarry(); return { dmin: Math.sqrt(d2), up: zb / (m.N - N0) - zs / N0 };
    });
    ok(`${name}: put down touching, not inside`, placed.dmin > 2.4, `closest pair ${placed.dmin.toFixed(2)} A, block ${placed.up.toFixed(2)} A above the flake`);
    await ev(() => window.__mdlab.setPaused(false)); await wait(8000);
    const r = await ev(() => { const m = window.__mdlab.md; return { exploded: m.exploded, steps: m.step, T: m.temperature() }; });
    ok(`${name}: Run afterwards does not crash`, !r.exploded && r.steps > 1000, `${r.steps} steps, ${r.exploded ? 'CRASHED' : r.T.toFixed(0) + ' K'}`);
    ok(`${name}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await p.close();
  }
  await browser.close(); srv.close();
  console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
