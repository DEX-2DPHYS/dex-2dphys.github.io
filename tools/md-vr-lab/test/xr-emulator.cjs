// Drives the built MD Lab page in Chrome with Meta's Immersive Web Emulation Runtime (IWER, Quest 3 profile) standing in for
// a headset: enters VR (experiment 1 m in front), recentres seated and standing, checks the table and panels, the hands,
// two-hand scaling, moves a panel with grip, presses a toolbar button, walks with the left stick, snap-turns, leaves VR. (The real-headset Layers problem cannot be reproduced here.)
//
//   node test/xr-emulator.cjs <index.html> <out dir>
// needs iwer + puppeteer-core (in %LOCALAPPDATA%\ulam-build and \ink2latex-deps on Peter's PCs).
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
let fail = 0; const ok = (name, cond, info = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listening ? r() : srv.once('listening', r));
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,800', `--user-data-dir=${path.join(LA, 'Temp', 'mdxr-' + Date.now())}`],
  });
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 800 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
  await wait(1500);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const head = () => ev(() => { const L = window.__mdlab, c = L.camera, v = new L.camera.position.constructor(), d = v.clone(); c.getWorldPosition(v); c.getWorldDirection(d); return { x: v.x, y: v.y, z: v.z, yaw: Math.atan2(d.x, -d.z) * 180 / Math.PI }; });
  const press = async (hand, id, ms = 250) => { await ev((h, b) => window.__dev.controllers[h].updateButtonValue(b, 1), hand, id); await wait(ms); await ev((h, b) => window.__dev.controllers[h].updateButtonValue(b, 0), hand, id); await wait(ms); };
  const stick = async (hand, x, y, ms) => { await ev((h, a, b) => window.__dev.controllers[h].updateAxes('thumbstick', a, b), hand, x, y); await wait(ms); await ev((h) => window.__dev.controllers[h].updateAxes('thumbstick', 0, 0), hand); await wait(250); };

  // enter VR - and a second click while starting must not ask for a second session
  await ev(() => { document.getElementById('vrBtn').click(); document.getElementById('vrBtn').click(); });
  await wait(2500);
  ok('session started, single click handled', await ev(() => window.__mdlab.S.vr) && errs.filter((e) => /already/.test(e)).length === 0);
  ok('both controllers connected', await ev(() => window.__mdlab.vrc.filter((v) => v.src && v.src.gamepad).length) === 2);
  const where = await ev(() => { const L = window.__mdlab, V = L.camera.position.constructor, h = new V(), d = new V(), s = new V(); L.camera.getWorldPosition(h); L.camera.getWorldDirection(d); L.simRoot.getWorldPosition(s); const v = s.sub(h); return [v.x * d.x + v.z * d.z, v.x * -d.z + v.z * d.x]; });
  ok('on entering VR the experiment is 1 m in front, not around the head', Math.abs(where[0] - 1) < 0.05 && Math.abs(where[1]) < 0.05, `forward ${where[0].toFixed(2)} m, sideways ${where[1].toFixed(2)} m`);
  const s0 = await ev(() => window.__mdlab.md.step); await wait(1000);
  ok('frames run in VR (the simulation advances)', (await ev(() => window.__mdlab.md.step)) > s0);

  // seated: put the head at 1.2 m, recentre with the right thumbstick click
  await ev(() => window.__dev.position.set(0, 1.2, 0)); await wait(300);
  await press('right', 'thumbstick'); await wait(300);
  let t = await ev(() => ({ table: window.__mdlab.S.tableH, ui: window.__mdlab.uiMesh.position.y }));
  ok('seated (eyes 1.20 m): table fits below the eyes', Math.abs(t.table - 0.68) < 0.02, `table ${t.table.toFixed(2)} m, panels at ${t.ui.toFixed(2)} m`);
  await ev(() => window.__dev.position.set(0, 1.65, 0)); await wait(300);
  await press('right', 'thumbstick'); await wait(300);
  t = await ev(() => ({ table: window.__mdlab.S.tableH }));
  ok('standing (eyes 1.65 m): table rises', Math.abs(t.table - 1.05) < 0.02, `table ${t.table.toFixed(2)} m`);
  const clear = await ev(() => {
    const L = window.__mdlab, B3 = (o) => { o.updateWorldMatrix(true, true); const b = new (L.uiMesh.geometry.boundingBox ? L.uiMesh.geometry.boundingBox.constructor : Object)(); return b.setFromObject(o); };
    L.uiMesh.geometry.computeBoundingBox(); const d = B3(L.deskTop); return [B3(L.uiMesh).intersectsBox(d), B3(L.plotMesh).intersectsBox(d)];
  });
  ok('panels do not intersect the table', !clear[0] && !clear[1], JSON.stringify(clear));
  await p.screenshot({ path: path.join(outDir, '1-vr-standing.png') });

  // hands: a glove on each controller; the trigger curls the index finger
  ok('a hand is shown on each controller', await ev(() => window.__mdlab.vrc.every((v) => v.hand3 && v.hand3.group.visible)));
  await ev(() => window.__dev.controllers.right.updateButtonValue('trigger', 1)); await wait(400);
  const curl = await ev(() => window.__mdlab.vrc.find((v) => v.hand === 'right').hand3.pose.index);
  await ev(() => window.__dev.controllers.right.updateButtonValue('trigger', 0)); await wait(300);
  ok('pulling the trigger curls the index finger', curl > 0.6, 'index curl ' + curl.toFixed(2));
  // both grips: hands apart = bigger, about the point between the hands
  await ev(() => { const L = window.__mdlab, c = L.simRoot.position; for (const [h, dx] of [['left', -0.15], ['right', 0.15]]) { const rc = window.__dev.controllers[h]; rc.position.set(c.x + dx, c.y - 0.25, c.z + 0.35); const q = new L.camera.quaternion.constructor().setFromAxisAngle(new L.camera.position.constructor(1, 0, 0), -1.2); rc.quaternion.set(q.x, q.y, q.z, q.w); } }); await wait(400);
  const sc0 = await ev(() => window.__mdlab.simRoot.scale.x), m0 = await ev(() => { const c = window.__mdlab.simRoot.position; return [c.x, c.y, c.z]; });
  await ev(() => { window.__dev.controllers.left.updateButtonValue('squeeze', 1); window.__dev.controllers.right.updateButtonValue('squeeze', 1); }); await wait(300);
  await ev(() => { for (const [h, dx] of [['left', -0.15], ['right', 0.15]]) { const rc = window.__dev.controllers[h]; rc.position.set(rc.position.x + dx, rc.position.y, rc.position.z); } }); await wait(400);
  const sc1 = await ev(() => window.__mdlab.simRoot.scale.x), m1 = await ev(() => { const c = window.__mdlab.simRoot.position; return [c.x, c.y, c.z]; });
  await ev(() => { window.__dev.controllers.left.updateButtonValue('squeeze', 0); window.__dev.controllers.right.updateButtonValue('squeeze', 0); }); await wait(300);
  ok('both grips, hands twice as far apart: the structure doubles in size and stays put', Math.abs(sc1 / sc0 - 2) < 0.05 && Math.hypot(m1[0] - m0[0], m1[2] - m0[2]) < 0.4, `scale x${(sc1 / sc0).toFixed(2)}`);
  await press('right', 'thumbstick');
  // grip on a panel moves it: aim the right controller at the control panel, squeeze, move the hand 0.3 m sideways
  const aim = () => ev(() => {
    const L = window.__mdlab, V = L.camera.position.constructor, c = new V(); L.uiMesh.getWorldPosition(c);
    const rc = window.__dev.controllers.right, from = new V(c.x + 0.25, c.y - 0.1, c.z + 0.55); rc.position.set(from.x, from.y, from.z);
    const dir = c.clone().sub(from).normalize(), q = new L.camera.quaternion.constructor().setFromUnitVectors(new V(0, 0, -1), dir); rc.quaternion.set(q.x, q.y, q.z, q.w);
    return [c.x, c.y, c.z];
  });
  const c0 = await aim(); await wait(400);
  ok('ray hits the control panel', await ev(() => window.__mdlab.vrc.some((v) => v.hitObj === window.__mdlab.uiMesh)));
  await ev(() => window.__dev.controllers.right.updateButtonValue('squeeze', 1)); await wait(300);
  await ev(() => { const rc = window.__dev.controllers.right; rc.position.set(rc.position.x - 0.3, rc.position.y + 0.1, rc.position.z); }); await wait(400);
  await ev(() => window.__dev.controllers.right.updateButtonValue('squeeze', 0)); await wait(300);
  const c1 = await ev(() => { const L = window.__mdlab, c = new L.camera.position.constructor(); L.uiMesh.getWorldPosition(c); return [c.x, c.y, c.z]; });
  const moved = Math.hypot(c1[0] - c0[0] + 0.3, c1[1] - c0[1] - 0.1, c1[2] - c0[2]);
  ok('grip moves the panel with the hand', moved < 0.02, `panel moved (${(c1[0] - c0[0]).toFixed(2)}, ${(c1[1] - c0[1]).toFixed(2)}, ${(c1[2] - c0[2]).toFixed(2)}) m for a hand move of (-0.30, 0.10, 0)`);
  // trigger on a toolbar button: aim at "Attach" (third of ten) on the toolbar in front of the table
  await ev(() => {
    const L = window.__mdlab, V = L.camera.position.constructor, NB = L.TB_LEVEL[L.S.level].length, AT = L.TB_LEVEL[L.S.level].indexOf('attach'), cw = (1000 - 20 - (NB - 1) * 8) / NB, u = (10 + AT * (cw + 8) + cw / 2) / 1000;
    const g = L.tbMesh.geometry.parameters, pt = new V((u - 0.5) * g.width, 0, 0.001); L.tbMesh.updateWorldMatrix(true, false); pt.applyMatrix4(L.tbMesh.matrixWorld);
    const rc = window.__dev.controllers.right, from = new V(pt.x + 0.05, pt.y + 0.25, pt.z + 0.3); rc.position.set(from.x, from.y, from.z);
    const q = new L.camera.quaternion.constructor().setFromUnitVectors(new V(0, 0, -1), pt.clone().sub(from).normalize()); rc.quaternion.set(q.x, q.y, q.z, q.w);
  }); await wait(400);
  await press('right', 'trigger', 300);
  ok('trigger on the VR toolbar picks Attach', (await ev(() => window.__mdlab.S.tool)) === 'attach', await ev(() => window.__mdlab.S.tool));
  const simStill = await ev(() => window.__mdlab.simRoot.position.toArray());
  // walk: left stick forward for 1 s
  const h0 = await head();
  await ev(() => window.__dev.controllers.left.updateAxes('thumbstick', 0, -1)); await wait(600);
  const vOn = await ev(() => window.__mdlab.vign.visible && window.__mdlab.vign.material.opacity);
  await wait(400); await ev(() => window.__dev.controllers.left.updateAxes('thumbstick', 0, 0)); await wait(250);
  const h1 = await head(), step = Math.hypot(h1.x - h0.x, h1.z - h0.z), along = ((h1.x - h0.x) * Math.sin(h0.yaw * Math.PI / 180) - (h1.z - h0.z) * Math.cos(h0.yaw * Math.PI / 180)) / step;
  ok('left stick forward walks forward', step > 0.6 && step < 2.0 && along > 0.95, `moved ${step.toFixed(2)} m, ${(Math.acos(Math.min(1, along)) * 180 / Math.PI).toFixed(1)} deg off the view direction, height change ${(h1.y - h0.y).toFixed(3)} m`);
  ok('walking does not move the experiment', JSON.stringify(simStill) === JSON.stringify(await ev(() => window.__mdlab.simRoot.position.toArray())));
  ok('comfort vignette shows while walking', vOn > 0.4, 'opacity ' + (+vOn).toFixed(2));
  await wait(800); ok('and fades out when you stop', !(await ev(() => window.__mdlab.vign.visible)));
  // snap turn right
  const y0 = (await head()).yaw; const hp0 = await head();
  await stick('right', 1, 0, 300);
  const hp1 = await head(); let dyaw = hp1.yaw - y0; if (dyaw > 180) dyaw -= 360; if (dyaw < -180) dyaw += 360;
  ok('right stick right: snap turn 30 deg to the right, about the head', Math.abs(dyaw - 30) < 1.5 && Math.hypot(hp1.x - hp0.x, hp1.z - hp0.z) < 0.01, `yaw ${dyaw.toFixed(1)} deg, head shift ${Math.hypot(hp1.x - hp0.x, hp1.z - hp0.z).toFixed(3)} m`);
  await stick('right', 1, 0, 600);
  const hp2 = await head(); let d2 = hp2.yaw - hp1.yaw; if (d2 > 180) d2 -= 360; if (d2 < -180) d2 += 360;
  ok('one push = one step (holding the stick does not keep turning)', Math.abs(d2 - 30) < 1.5, `${d2.toFixed(1)} deg`);
  await p.screenshot({ path: path.join(outDir, '2-vr-after-walk.png') });
  // the camera: its head shows on the controller with a live preview; shooting renders a photo and puts a print on the table
  await ev(() => window.__mdlab.TOOLDEF.camera.act()); await wait(800);
  const cam = await ev(() => { const L = window.__mdlab, v = L.vrc.find((c) => c.tools && c.tools.H.camera.visible); return { head: !!v, pv: L.CAM.lastPreview > 0 }; });
  ok('camera tool: a camera on the controller with a live preview', cam.head && cam.pv, JSON.stringify(cam));
  await ev(() => window.__mdlab.shoot(window.__mdlab.vrc.find((c) => c.src).i)); await wait(600);
  ok('shooting in VR makes a photo and a print on the table', await ev(() => window.__mdlab.printMesh.visible && window.__mdlab.CAM.photo.width >= 1280 && window.__mdlab.renderer.xr.isPresenting));
  await p.screenshot({ path: path.join(outDir, '3-vr-camera.png') });
  await ev(() => window.__mdlab.TOOLDEF.hand.act());
  await ev(() => window.__mdlab.renderer.xr.getSession().end()); await wait(800);
  ok('left VR cleanly', !(await ev(() => window.__mdlab.S.vr)));
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all XR checks passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
