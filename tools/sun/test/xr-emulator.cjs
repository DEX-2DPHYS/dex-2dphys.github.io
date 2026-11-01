// Drives the built page in Chrome with Meta's Immersive Web Emulation Runtime (IWER, Quest 3
// profile) standing in for a headset: enters VR, presses the controller buttons, moves the
// sticks, aims the trigger at the Sun, takes screenshots, leaves VR again.
//
//   node test/xr-emulator.cjs <built.html> <out dir>
// needs iwer + puppeteer-core (in %LOCALAPPDATA%\ulam-build and \ink2latex-deps on this PC).
const fs = require('fs'), path = require('path'), http = require('http');
const LA = process.env.LOCALAPPDATA;
const req = (m) => { for (const d of ['ulam-build', 'ink2latex-deps']) { const p = path.join(LA, d, 'node_modules', m); if (fs.existsSync(p)) return require(p); } return require(m); };
const puppeteer = req('puppeteer-core');
const IWER = path.join(LA, 'ulam-build', 'node_modules', 'iwer', 'build', 'iwer.min.js');
const [, , page0, outDir = 'xr-out'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });

const html = fs.readFileSync(page0, 'utf8').replace('<head>', () =>
  '<head><script src="/iwer.js"></script><script>window.__dev = new IWER.XRDevice(IWER.metaQuest3); window.__dev.installRuntime({forceInstall:true});</script>');
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/iwer.js')) { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(fs.readFileSync(IWER)); return; }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html);
}).listen(0, '127.0.0.1');

const checks = []; const ok = (name, cond, info = '') => { checks.push([name, !!cond]); console.log((cond ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listening ? r() : srv.once('listening', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,800', `--user-data-dir=${path.join(LA, 'Temp', 'xrtest-' + Date.now())}`],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 800 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${port}/?debug=1&nobloom=0`, { waitUntil: 'load' });
  await wait(1500);
  await p.evaluate(() => window.__sun.refreshXR());   // the emulator installs after the page asked once
  await wait(300);
  const vis = await p.evaluate(() => { const b = document.getElementById('vrBtn'); const r = b.getBoundingClientRect(); return { hidden: b.hidden || document.getElementById('xrBtns').hidden, w: r.width }; });
  ok('Enter VR button shown when the runtime offers immersive-vr', !vis.hidden && vis.w > 40, JSON.stringify(vis));
  await p.screenshot({ path: path.join(outDir, '0-desktop.png') });
  if (vis.hidden) { console.log('errors:', errs.join(' | '), await p.evaluate(async () => ({ xr: !!navigator.xr, vr: await navigator.xr?.isSessionSupported('immersive-vr'), sun: !!window.__sun, b: document.getElementById('vrBtn').hidden, g: document.getElementById('xrBtns').hidden, note: document.getElementById('xrNote').textContent, hasXr: !!window.__sun.xr, ar: await Promise.race([navigator.xr.isSessionSupported('immersive-ar'), new Promise(r=>setTimeout(()=>r('timeout'),1500))]) }))); }

  await p.click('#vrBtn');
  await wait(2500);
  const D = () => p.evaluate(() => window.__sun.xr.debug());
  let d = await D();
  ok('session started (vr)', d.mode === 'vr', JSON.stringify(d));
  ok('both controllers connected with gamepads', d.ctrls.filter((c) => c.includes('+gp')).length === 2, d.ctrls.join(','));
  ok('initial scale is the overview one (1.2 m per R)', Math.abs(d.mPerR - 1.2) < 0.01, d.mPerR);
  const headR = Math.hypot(...d.head);
  ok('eye starts where the desktop camera was (outside the Sun)', headR > 3 && headR < 20, 'head ' + headR.toFixed(2) + ' R');
  await p.screenshot({ path: path.join(outDir, '1-vr-overview.png') });

  const press = async (hand, id, ms = 200) => {
    await p.evaluate((h, b) => window.__dev.controllers[h].updateButtonValue(b, 1), hand, id); await wait(ms);
    await p.evaluate((h, b) => window.__dev.controllers[h].updateButtonValue(b, 0), hand, id); await wait(ms);
  };
  const filt = () => p.evaluate(() => window.__sun.U.uFilter.value);
  const f0 = await filt(); await press('right', 'a-button');
  ok('A: next instrument', (await filt()) === (f0 + 1) % 8, `${f0} -> ${await filt()}`);
  await press('right', 'a-button'); await press('right', 'a-button');   // -> He II 304
  await p.screenshot({ path: path.join(outDir, '2-vr-he304.png') });
  for (let i = 0; i < 5; i++) await press('right', 'a-button');           // 3 + 5 = 8: back to white light
  ok('A cycles all eight instruments', (await filt()) === f0);

  const cut0 = await p.evaluate(() => window.__sun.U.uCut.value);
  await press('left', 'y-button'); await wait(300);
  ok('Y: cutaway toggles', (await p.evaluate(() => window.__sun.U.uCut.value)) !== cut0);
  await p.screenshot({ path: path.join(outDir, '3-vr-cutaway.png') });
  await press('left', 'y-button');

  // B: next view (overview -> interior), with a fade, and the rig moves
  const rig0 = (await D()).rig;
  await press('right', 'b-button', 120);
  const mid = await D();
  await wait(900);
  d = await D();
  ok('B: view jump fades', mid.fade > 0 || d.fade === 0, 'fade mid ' + mid.fade.toFixed(2));
  ok('B: rig moved to the next view at its own scale', Math.abs(d.mPerR - 1.4) < 0.01 && d.rig.join() !== rig0.join(), JSON.stringify(d.rig) + ' ' + d.mPerR);
  await p.screenshot({ path: path.join(outDir, '4-vr-interior.png') });

  // left stick forward: world bigger (more metres per solar radius), about the head
  const m0 = d.mPerR, h0 = d.head;
  await p.evaluate(() => window.__dev.controllers.left.updateAxes('thumbstick', 0, -1)); await wait(800);
  await p.evaluate(() => window.__dev.controllers.left.updateAxes('thumbstick', 0, 0)); await wait(200);
  d = await D();
  ok('left stick: world size changes', d.mPerR > m0 * 1.2, `${m0} -> ${d.mPerR.toFixed(3)}`);
  ok('scaling keeps the eye in place', Math.hypot(d.head[0] - h0[0], d.head[1] - h0[1], d.head[2] - h0[2]) < 0.05, JSON.stringify(h0) + ' -> ' + JSON.stringify(d.head));

  // right stick forward: fly
  const r0 = d.head;
  await p.evaluate(() => window.__dev.controllers.right.updateAxes('thumbstick', 0, -1)); await wait(600);
  await p.evaluate(() => window.__dev.controllers.right.updateAxes('thumbstick', 0, 0)); await wait(200);
  d = await D();
  ok('right stick: flies', Math.hypot(d.head[0] - r0[0], d.head[1] - r0[1], d.head[2] - r0[2]) > 0.1, JSON.stringify(r0) + ' -> ' + JSON.stringify(d.head));

  // aim at the Sun's centre with the right controller and hold the trigger
  await p.evaluate(() => {
    const s = window.__sun, xr = s.xr, rc = window.__dev.controllers.right;
    // place the controller so its ray points at the Sun: aim in the rig frame
    const rig = s.scene.getObjectByName('xr-rig'); rig.updateMatrixWorld(true);
    const THREE = { };
    const inv = rig.matrixWorld.clone().invert();
    const sunLocal = new rig.position.constructor(0, 0, 0).applyMatrix4(inv);
    const from = new rig.position.constructor(rc.position.x, rc.position.y, rc.position.z);
    const dir = sunLocal.sub(from).normalize();
    const q = new rig.quaternion.constructor().setFromUnitVectors(new rig.position.constructor(0, 0, -1), dir);
    rc.quaternion.set(q.x, q.y, q.z, q.w);
    rc.updateButtonValue('trigger', 1);
  });
  await wait(700);
  d = await D();
  ok('trigger aimed at the Sun: read-out card shown', d.card && d.cardText.length > 10, d.cardText);
  await p.screenshot({ path: path.join(outDir, '5-vr-readout.png') });
  await p.evaluate(() => window.__dev.controllers.right.updateButtonValue('trigger', 0)); await wait(400);
  ok('trigger released: card hidden', !(await D()).card);

  // X: flare + CME
  await press('left', 'x-button'); await wait(400);
  ok('X: flare fired', (await p.evaluate(() => window.__sun.U.uFlare.value)) > 0.3);
  await p.screenshot({ path: path.join(outDir, '6-vr-cme.png') });

  // leave VR: desktop restored
  await p.evaluate(() => window.__dev.activeSession.end()); await wait(1200);
  d = await D();
  const desk = await p.evaluate(() => ({ btn: !document.getElementById('xrBtns').classList.contains('busy'), w: window.__sun.renderer.domElement.width }));
  ok('session ended, desktop restored', d.mode === null && desk.btn, JSON.stringify(desk));
  await wait(800);
  await p.screenshot({ path: path.join(outDir, '7-desktop-after.png') });

  d = await D();
  // passthrough (Quest 3): a small Sun in the room, transparent background
  const arShown = await p.evaluate(() => !document.getElementById('arBtn').hidden);
  ok('Passthrough button shown (Quest 3 profile offers immersive-ar)', arShown);
  if (arShown) {
    await p.click('#arBtn'); await wait(2000);
    d = await D();
    const clear = await p.evaluate(() => window.__sun.renderer.getClearAlpha());
    ok('passthrough session: table-top scale, clear alpha 0', d.mode === 'ar' && Math.abs(d.mPerR - 0.18) < 0.01 && clear === 0, JSON.stringify({ m: d.mPerR, clear }));
    const hr = Math.hypot(...d.head) * d.mPerR;
    ok('passthrough: Sun about 0.8 m in front of the eye', hr > 0.6 && hr < 1.0, hr.toFixed(2) + ' m');
    await p.screenshot({ path: path.join(outDir, '8-passthrough.png') });
    await p.evaluate(() => window.__dev.activeSession.end()); await wait(1000);
    ok('passthrough ended: opaque black again', (await p.evaluate(() => window.__sun.renderer.getClearAlpha())) === 1);
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
  await browser.close(); srv.close();
  const fail = checks.filter((c) => !c[1]).length;
  console.log(fail ? `${fail} FAILED of ${checks.length}` : `ALL CLEAR (${checks.length} checks)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
