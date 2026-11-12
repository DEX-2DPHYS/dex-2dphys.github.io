// See-through mode on a real table, driven headlessly: Meta's Immersive Web Emulation Runtime (IWER, Quest 3 profile) with a stand-in
// room scan (one table plane, as Space Setup would give). Starts an immersive-ar session from the page button, checks that the lab sits
// on the table (height, centre, facing, worktop, toolbar), that nothing glides, that walking covers the room and comes back to the
// table, the touch-the-edge fallback, and that leaving restores the VR lab. (Passthrough itself and real plane data need the headset.)
//
//   node test/xr-ar.cjs <index.html>
// needs iwer + puppeteer-core (in %LOCALAPPDATA%\ulam-build, \fv-test or \ink2latex-deps on Peter's PCs).
const fs = require('fs'), path = require('path'), http = require('http');
const LA = process.env.LOCALAPPDATA;
const DIRS = ['ulam-build', 'fv-test', 'ink2latex-deps'];
const req = (m) => { for (const d of DIRS) { const p = path.join(LA, d, 'node_modules', m); if (fs.existsSync(p)) return require(p); } return require(m); };
const puppeteer = req('puppeteer-core');
const IWER = DIRS.map((d) => path.join(LA, d, 'node_modules', 'iwer', 'build', 'iwer.min.js')).find((p) => fs.existsSync(p));
const [, , page0] = process.argv;
// the room scan: a 1.2 x 0.7 m table, top at 74 cm, centre (0.3, -0.9), turned 20 degrees; the user stands at the origin looking along -z
const TABLE = { W: 1.2, D: 0.7, top: 0.74, cx: 0.3, cz: -0.9, a: 20 * Math.PI / 180 };
const html = fs.readFileSync(page0, 'utf8').replace('<head>', () => `<head><script src="/iwer.js"></script><script>
window.__dev = new IWER.XRDevice(IWER.metaQuest3); window.__dev.installRuntime({ forceInstall: true });
(function () {
  const T = ${JSON.stringify(TABLE)}, c = Math.cos(T.a), s = Math.sin(T.a);
  const plane = { transform: { matrix: new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, T.cx, T.top, T.cz, 1]), orientation: { x: 0, y: Math.sin(T.a / 2), z: 0, w: Math.cos(T.a / 2) } },
    polygon: [[-T.W / 2, -T.D / 2], [T.W / 2, -T.D / 2], [T.W / 2, T.D / 2], [-T.W / 2, T.D / 2]].map(([x, z]) => new DOMPointReadOnly(x, 0, z, 1)), semanticLabel: 'table' };
  const floor = { transform: { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), orientation: { x: 0, y: 0, z: 0, w: 1 } },
    polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]].map(([x, z]) => new DOMPointReadOnly(x, 0, z, 1)), semanticLabel: 'floor' };
  window.__scan = { table: plane, floor };
  window.__dev.installSEM(class { constructor() { this.trackedPlanes = new Set([floor, plane]); this.trackedMeshes = new Set(); this.environmentCanvas = document.createElement('canvas'); window.__sem = this; } render() {} computeHitTestResults() { return []; } });
})();
</script>`);
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,800', `--user-data-dir=${path.join(LA, 'Temp', 'mdar-' + Date.now())}`],
  });
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 800 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
  await wait(1500);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const press = async (hand, id, ms = 250) => { await ev((h, b) => window.__dev.controllers[h].updateButtonValue(b, 1), hand, id); await wait(ms); await ev((h, b) => window.__dev.controllers[h].updateButtonValue(b, 0), hand, id); await wait(ms); };
  // where things are, in the table's own frame: x along its width, z across (+z = the user's side), y above the floor
  const state = () => ev((T) => {
    const L = window.__mdlab, V = L.camera.position.constructor, c = Math.cos(T.a), s = Math.sin(T.a);
    const tl = (v) => { const dx = v.x - T.cx, dz = v.z - T.cz; return { x: +(c * dx - s * dz).toFixed(3), y: +v.y.toFixed(3), z: +(s * dx + c * dz).toFixed(3) }; };
    L.bench.updateMatrixWorld(true);
    const deskC = new V(0, L.S.tableH + 0.025, -1.0).applyMatrix4(L.bench.matrixWorld), sim = new V(), tb = new V(), ui = new V();
    L.simRoot.getWorldPosition(sim); L.tbMesh.getWorldPosition(tb); L.uiMesh.getWorldPosition(ui);
    const fwd = new V(0, 0, -1).applyQuaternion(L.bench.quaternion);
    return { ar: L.S.ar, vr: L.S.vr, walk: L.S.walk, table: L.S.arTable, cal: !!L.S.cal, bg: L.scene.background ? (L.scene.background.isColor ? 'color' : 'other') : null, fog: !!L.scene.fog,
      room: !!(L.room && L.room.visible), top: L.deskTop.material.visible, legs: L.deskTop.parent.children.filter((o) => o.geometry && o.geometry.parameters && o.geometry.parameters.height === 1).every((o) => o.visible),
      desk: tl(deskC), sim: tl(sim), tb: tl(tb), ui: tl(ui), fwd: { x: +(c * fwd.x - s * fwd.z).toFixed(3), z: +(s * fwd.x + c * fwd.z).toFixed(3) }, TB: Object.assign({}, L.TB), dolly: L.dolly.position.toArray().map((v) => +v.toFixed(3)), step: L.md.step };
  }, TABLE);

  ok('the page offers Real table (immersive-ar supported)', await ev(() => document.getElementById('arBtn').style.display !== 'none' && window.__mdlab.xrState.ar));
  await ev(() => { document.getElementById('arBtn').click(); document.getElementById('arBtn').click(); });
  await wait(3500);
  let st = await state();
  ok('see-through session started (one session for two clicks)', st.ar && st.vr && errs.filter((e) => /already/.test(e)).length === 0);
  ok('no room, sky or fog: the real room shows', st.bg === null && !st.fog && !st.room, `background ${st.bg}, room ${st.room}`);
  ok('virtual worktop and legs hidden', !st.top && !st.legs);
  ok('table found in the room scan (not the floor)', st.table && st.table.src === 'plane' && Math.abs(st.table.W - 1.2) < 0.01 && Math.abs(st.table.D - 0.7) < 0.01 && Math.abs(st.table.top - 0.74) < 0.005, JSON.stringify(st.table));
  ok('the worktop lies on the real table top, at its centre', Math.abs(st.desk.y - 0.74) < 0.003 && Math.abs(st.desk.x) < 0.005 && Math.abs(st.desk.z) < 0.005, JSON.stringify(st.desk));
  ok('the lab faces into the table from the user\'s long edge', Math.abs(st.fwd.x) < 0.01 && st.fwd.z < -0.99, JSON.stringify(st.fwd));
  ok('the structure stands over the table centre, above the top', Math.hypot(st.sim.x, st.sim.z) < 0.02 && st.sim.y > 0.74, JSON.stringify(st.sim));
  ok('the solid worktop matches the real table', Math.abs(st.TB.x1 - st.TB.x0 - 1.2) < 0.01 && Math.abs(st.TB.z1 - st.TB.z0 - 0.7) < 0.01, JSON.stringify(st.TB));
  ok('the toolbar lies over the table, just inside the front edge', Math.abs(st.tb.x) < 0.01 && st.tb.z < 0.35 && st.tb.z > 0.2 && st.tb.y > 0.74, JSON.stringify(st.tb));
  ok('the menu panel stands to the left of the table', st.ui.x < -0.6, JSON.stringify(st.ui));
  const s0 = st.step; await wait(800); ok('frames run (the simulation advances)', (await ev(() => window.__mdlab.md.step)) > s0);

  // no gliding or turning: the lab must stay on the real table
  const d0 = st.dolly.join(); await ev(() => window.__dev.controllers.left.updateAxes('thumbstick', 0, -1)); await wait(600); await ev(() => window.__dev.controllers.left.updateAxes('thumbstick', 0, 0));
  await ev(() => window.__dev.controllers.right.updateAxes('thumbstick', 1, 0)); await wait(400); await ev(() => window.__dev.controllers.right.updateAxes('thumbstick', 0, 0)); await wait(300);
  ok('sticks do not move or turn the lab off the table', (await state()).dolly.join() === d0);
  // the user walks round to the far side and recentres: the lab turns to face them, same centre
  await ev((T) => { const s = Math.sin(T.a), c = Math.cos(T.a); window.__dev.position.set(T.cx - s * 0.9, 1.6, T.cz - c * 0.9); window.__dev.quaternion.set(0, Math.sin((T.a + Math.PI) / 2), 0, Math.cos((T.a + Math.PI) / 2)); }, TABLE); await wait(300);
  await press('right', 'thumbstick'); await wait(400); st = await state();
  ok('recentre from the far side: lab turned round, worktop still at the table centre', st.fwd.z > 0.99 && Math.abs(st.desk.x) < 0.005 && Math.abs(st.desk.z) < 0.005, `fwd ${JSON.stringify(st.fwd)} desk ${JSON.stringify(st.desk)}`);
  await ev(() => { window.__dev.position.set(0, 1.6, 0); window.__dev.quaternion.set(0, 0, 0, 1); }); await wait(200); await press('right', 'thumbstick'); await wait(300);

  // walking: the night sky covers the room; coming back puts the lab on the table again
  await ev(() => window.__mdlab.enterWalk()); await wait(3200); st = await state();
  ok('walk in see-through: tiny, the sky covers the room (opaque dome), feet on the real floor', st.walk && st.bg === 'color' && st.dolly[1] === 0, `walk ${st.walk} bg ${st.bg} dolly ${st.dolly}`);
  await ev(() => window.__mdlab.exitWalk()); await wait(2200); st = await state();
  ok('back from the walk: see-through again, lab on the table', !st.walk && st.bg === null && !st.room && Math.abs(st.desk.y - 0.74) < 0.003 && Math.hypot(st.desk.x, st.desk.z) < 0.005 && Math.hypot(st.sim.x, st.sim.z) < 0.02, JSON.stringify({ walk: st.walk, bg: st.bg, room: st.room, desk: st.desk, sim: st.sim }));

  // the room scan loses the table: Find my table again asks for the edge to be touched; two touches set the table
  await ev(() => window.__sem.trackedPlanes.delete(window.__scan.table)); await wait(300);
  await ev(() => window.__mdlab.arRefit(true)); await wait(200);
  ok('no table in the scan: Find my table again starts the touch fallback', (await state()).cal);
  const touch = async (x, y, z) => {
    await ev((a, b, c) => { const C = window.__dev.controllers.right; C.position.set(a, b, c); C.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); }, x, y, z); await wait(300);   // pointing down at the table
    const at = await ev(() => { const L = window.__mdlab, v = new L.camera.position.constructor(); L.vrc.find((q) => q.hand === 'right').obj.getWorldPosition(v); return [v.x, v.y, v.z]; });
    await press('right', 'trigger'); return at;
  };
  const a = await touch(-0.35, 0.7, -0.45), b = await touch(0.35, 0.72, -0.45);
  st = await state();
  ok('two touches on the edge: table set from the fingertip', !st.cal && st.table && st.table.src === 'touch' && Math.abs(st.table.top - (a[1] + b[1]) / 2) < 0.002, `top ${st.table && st.table.top.toFixed(3)} touched ${a[1].toFixed(3)} / ${b[1].toFixed(3)}`);
  const fe = await ev((A, B) => { const L = window.__mdlab, V = L.camera.position.constructor; L.bench.updateMatrixWorld(true); const e = new V(0, 0, L.TB.z1).applyMatrix4(L.bench.matrixWorld), d = new V(0, 0, -1).applyQuaternion(L.bench.quaternion); return { ez: e.z, mid: (A[2] + B[2]) / 2, fz: d.z, fx: d.x }; }, a, b);
  ok('touched edge = the worktop front edge, the lab faces away from the user', Math.abs(fe.ez - fe.mid) < 0.005 && fe.fz < -0.99, JSON.stringify(fe));

  // leave: the VR lab comes back as it was
  await ev(() => window.__mdlab.renderer.xr.getSession().end()); await wait(900); st = await state();
  ok('left see-through: lab room, sky and worktop restored', !st.ar && !st.vr && st.bg === 'color' && st.fog && st.room && st.top && st.legs, JSON.stringify({ ar: st.ar, bg: st.bg, room: st.room, top: st.top }));
  ok('virtual table size restored', st.TB.x0 === -0.7 && st.TB.x1 === 0.7 && st.TB.z0 === -1.4 && st.TB.z1 === -0.6);
  // and plain VR is unchanged by all this
  await ev(() => document.getElementById('vrBtn').click()); await wait(2500); st = await state();
  ok('Enter VR afterwards: the ordinary VR lab (room, fog, worktop)', st.vr && !st.ar && st.bg === 'color' && st.room && st.top, JSON.stringify({ vr: st.vr, ar: st.ar, room: st.room }));
  await ev(() => window.__mdlab.renderer.xr.getSession().end()); await wait(600);

  const bad = errs.filter((e) => !/favicon|supabase|Failed to load resource|Unexpected token '<'/i.test(e));
  ok('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all see-through checks passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
