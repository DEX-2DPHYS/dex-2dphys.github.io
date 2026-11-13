// Controls in VR, driven headlessly (IWER, Quest 3 profile): no controller button recentres (only the headset's own recentre does),
// both grips always scale - even when the first grip started carrying a piece - the worktop is a floor for every atom and for the
// whole experiment, Stop spin and holding remove the rigid rotation of a piece but not its heat, and panels move by their handle bar.
//
//   node test/xr-interact.cjs <index.html>
// needs iwer + puppeteer-core (in %LOCALAPPDATA%\ulam-build, \fv-test or \ink2latex-deps on Peter's PCs).
const fs = require('fs'), path = require('path'), http = require('http');
const LA = process.env.LOCALAPPDATA;
const DIRS = ['ulam-build', 'fv-test', 'ink2latex-deps'];
const req = (m) => { for (const d of DIRS) { const p = path.join(LA, d, 'node_modules', m); if (fs.existsSync(p)) return require(p); } return require(m); };
const puppeteer = req('puppeteer-core');
const IWER = DIRS.map((d) => path.join(LA, d, 'node_modules', 'iwer', 'build', 'iwer.min.js')).find((p) => fs.existsSync(p));
const [, , page0] = process.argv;
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,800', `--user-data-dir=${path.join(LA, 'Temp', 'mdint-' + Date.now())}`],
  });
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 800 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
  await wait(1500);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  await ev(() => { const L = window.__mdlab; L.S.substrate = 'none'; L.applySubstrate(); });     // (timed checks: headless software rendering is slow with the substrate drawn)
  const press = async (hand, id, ms = 250) => { await ev((h, b) => window.__dev.controllers[h].updateButtonValue(b, 1), hand, id); await wait(ms); await ev((h, b) => window.__dev.controllers[h].updateButtonValue(b, 0), hand, id); await wait(ms); };
  const btn = (hand, id, v) => ev((h, b, x) => window.__dev.controllers[h].updateButtonValue(b, x), hand, id, v);
  // aim a controller from `from` at the world point `to` (both [x, y, z]), or along a direction
  const aimAt = (hand, from, to) => ev((h, f, t) => { const L = window.__mdlab, V = L.camera.position.constructor, Q = L.camera.quaternion.constructor, c = window.__dev.controllers[h];
    c.position.set(f[0], f[1], f[2]); const q = new Q().setFromUnitVectors(new V(0, 0, -1), new V(t[0] - f[0], t[1] - f[1], t[2] - f[2]).normalize()); c.quaternion.set(q.x, q.y, q.z, q.w); }, hand, from, to);
  const moveBy = (hand, d) => ev((h, x) => { const c = window.__dev.controllers[h]; c.position.set(c.position.x + x[0], c.position.y + x[1], c.position.z + x[2]); }, hand, d);
  // the worktop top and every atom's height above it (only atoms over the table)
  const lowest = () => ev(() => {
    const L = window.__mdlab, V = L.camera.position.constructor, M = L.camera.matrixWorld.constructor, md = L.md, TB = L.TB;
    L.inner.updateWorldMatrix(true, false); L.bench.updateMatrixWorld(true); const bi = new M().copy(L.bench.matrixWorld).invert(), top = L.bench.position.y + L.S.tableH + 0.025;
    let low = Infinity; for (let i = 0; i < md.N; i++) { const w = new V(md.x[i], md.y[i], md.z[i]).applyMatrix4(L.inner.matrixWorld), l = w.clone().applyMatrix4(bi); if (l.x < TB.x0 || l.x > TB.x1 || l.z < TB.z0 || l.z > TB.z1) continue; low = Math.min(low, w.y - top); }
    return { low, rad: L.S.atomR * L.simRoot.scale.x };
  });

  await ev(() => document.getElementById('vrBtn').click()); await wait(2800);
  const info = await ev(() => { const L = window.__mdlab; return { vr: L.S.vr, mat: L.isMat(), per: L.isMat() && !!L.mat.periodicAny, N: L.md.N, name: L.md.name }; });
  ok('in VR with an open structure to work on', info.vr && info.mat && !info.per && info.N > 10, JSON.stringify(info));

  // 1. only the headset's own recentre moves the table: the thumbstick click (and A/B/X/Y) no longer do
  const benchPose = () => ev(() => { const b = window.__mdlab.bench; return [b.position.x, b.position.z, b.rotation.y].map((v) => +v.toFixed(4)).join(','); });
  const b0 = await benchPose();
  await ev(() => { window.__dev.position.set(0.6, 1.5, 0.4); window.__dev.quaternion.set(0, Math.sin(0.4), 0, Math.cos(0.4)); }); await wait(300);
  for (const h of ['left', 'right']) for (const id of ['thumbstick', 'a-button', 'b-button', 'x-button', 'y-button']) { try { await press(h, id, 120); } catch (e) { /* that hand has no such button */ } }
  ok('thumbstick clicks and A/B/X/Y leave the table where it is', (await benchPose()) === b0, b0);
  await ev(() => window.__mdlab.recenter()); await wait(200);          // what the reference-space reset (Meta button) runs
  ok('the headset recentre (Meta button) still moves it', (await benchPose()) !== b0);
  await ev(() => { window.__dev.position.set(0, 1.6, 0); window.__dev.quaternion.set(0, 0, 0, 1); window.__mdlab.S.paused = false; }); await wait(200);
  await ev(() => window.__mdlab.recenter()); await wait(400);

  // 2. both grips = scale, even when the first grip landed on an atom and started carrying a piece
  const a0 = await ev(() => { const L = window.__mdlab, V = L.camera.position.constructor; L.inner.updateWorldMatrix(true, false); const w = new V(L.md.x[0], L.md.y[0], L.md.z[0]).applyMatrix4(L.inner.matrixWorld); return [w.x, w.y, w.z]; });
  await aimAt('right', [a0[0] + 0.1, a0[1] + 0.25, a0[2] + 0.3], a0); await wait(300);
  await btn('right', 'squeeze', 1); await wait(300);
  const carried = await ev(() => !!window.__mdlab.carry);
  await aimAt('left', [a0[0] - 0.3, a0[1] + 0.25, a0[2] + 0.3], [a0[0] - 0.3, a0[1] + 1.25, a0[2] + 0.3]); await wait(150);
  const s0 = await ev(() => window.__mdlab.simRoot.scale.x);
  await btn('left', 'squeeze', 1); await wait(300);
  const st2 = await ev(() => ({ carry: !!window.__mdlab.carry, two: !!(window.__mdlab.grabRef && window.__mdlab.grabRef.two) }));
  ok('first grip on an atom carries; the second grip turns it into the two-hand gesture', carried && !st2.carry && st2.two, JSON.stringify({ carried, ...st2 }));
  await moveBy('left', [-0.2, 0, 0]); await moveBy('right', [0.2, 0, 0]); await wait(400);
  const s1 = await ev(() => window.__mdlab.simRoot.scale.x);
  ok('spreading the hands scales the experiment', Math.abs(s1 / s0 - 0.8 / 0.4) < 0.05, `x${(s1 / s0).toFixed(2)} for hands 0.4 -> 0.8 m apart`);
  await btn('left', 'squeeze', 0); await wait(300);
  const r0 = await ev(() => window.__mdlab.simRoot.position.toArray().join());
  await moveBy('right', [0, 0.2, 0]); await wait(300);
  ok('letting go of one grip ends it: the other hand does not drag the experiment', (await ev(() => window.__mdlab.simRoot.position.toArray().join())) === r0 && !(await ev(() => window.__mdlab.grabRef)));
  await btn('right', 'squeeze', 0); await wait(200);
  await ev(() => window.__mdlab.recenter()); await wait(300);

  // 3. spinning: Stop spin removes the rigid rotation of each piece and keeps the heat; holding a piece damps it
  const spin = await ev(() => {
    const L = window.__mdlab, md = L.md, mat = L.mat, m = mat.mass; L.S.paused = true;
    const fm = mat.fragmentMask(0), N = md.N, KE = () => { let s = 0; for (let i = 0; i < N; i++) s += 0.5 * m[i] * (md.vx[i] ** 2 + md.vy[i] ** 2 + md.vz[i] ** 2); return s; };
    const com = () => { let M = 0, c = [0, 0, 0]; for (let i = 0; i < N; i++) if (fm.mask[i]) { M += m[i]; c[0] += m[i] * md.x[i]; c[1] += m[i] * md.y[i]; c[2] += m[i] * md.z[i]; } return c.map((v) => v / M); };
    const Lmag = () => { const c = com(); let l = [0, 0, 0]; for (let i = 0; i < N; i++) if (fm.mask[i]) { const r = [md.x[i] - c[0], md.y[i] - c[1], md.z[i] - c[2]], v = [md.vx[i], md.vy[i], md.vz[i]]; l[0] += m[i] * (r[1] * v[2] - r[2] * v[1]); l[1] += m[i] * (r[2] * v[0] - r[0] * v[2]); l[2] += m[i] * (r[0] * v[1] - r[1] * v[0]); } return Math.hypot(...l); };
    const twist = (w) => { const c = com(); for (let i = 0; i < N; i++) if (fm.mask[i]) { const r = [md.x[i] - c[0], md.y[i] - c[1], md.z[i] - c[2]]; md.vx[i] += w[1] * r[2] - w[2] * r[1]; md.vy[i] += w[2] * r[0] - w[0] * r[2]; md.vz[i] += w[0] * r[1] - w[1] * r[0]; } };
    L.stopSpin(false); const heat = KE(), l0 = Lmag();               // the piece as it is, without spin: its thermal energy
    twist([0.002, 0.0055, 0.0015]); const spun = KE(), lSpin = Lmag();
    L.stopSpin(false); const after = KE(), l1 = Lmag();
    twist([0, 0.001, 0]); const lb = Lmag();
    Object.assign(L.hold, { kind: 'tw' }); md.ext.i = 0; md.ext.mode = 'frag'; md.ext.mask = fm.mask;
    L.holdSpin(0.5); const lh = Lmag();
    L.hold.kind = null; md.ext.i = -1; md.ext.mode = null; md.ext.mask = null; L.stopSpin(false); L.S.paused = false;
    return { n: fm.n, heat, spun, after, l0, lSpin, l1, lb, lh };
  });
  ok('Stop spin: the spin is gone, the thermal energy stays', spin.spun > spin.heat * 1.2 && spin.l1 < 1e-5 * spin.lSpin && Math.abs(spin.after - spin.heat) < 1e-4 * spin.heat, `KE heat ${spin.heat.toFixed(3)} spun ${spin.spun.toFixed(3)} after ${spin.after.toFixed(3)} eV; |L| ${spin.lSpin.toExponential(2)} -> ${spin.l1.toExponential(2)} (${spin.n} atoms)`);
  ok('holding the piece for half a second stops its spin (98 %)', spin.lh < 0.03 * spin.lb, `|L| ${spin.lb.toExponential(2)} -> ${spin.lh.toExponential(2)}`);

  // 4. the worktop is a floor for every atom: a loose atom put under it and sent down comes up and stays on it
  const put = await ev(() => {
    const L = window.__mdlab, V = L.camera.position.constructor, M = L.camera.matrixWorld.constructor, md = L.md;
    L.inner.updateWorldMatrix(true, false); L.bench.updateMatrixWorld(true);
    let hi = 0, cx = 0, cz = 0; for (let i = 0; i < md.N; i++) { const w = new V(md.x[i], md.y[i], md.z[i]).applyMatrix4(L.inner.matrixWorld); cx += w.x; cz += w.z; } cx /= md.N; cz /= md.N;
    for (let i = 0; i < md.N; i++) { const w = new V(md.x[i], md.y[i], md.z[i]).applyMatrix4(L.inner.matrixWorld); hi = Math.max(hi, Math.hypot(w.x - cx, w.z - cz)); }
    const sc = L.simRoot.scale.x, top = L.bench.position.y + L.S.tableH + 0.025, right = new V(1, 0, 0).applyQuaternion(L.bench.quaternion);
    const w = new V(cx, top - 1.0 * sc, cz).addScaledVector(right, hi + 5 * sc), b = w.clone().applyMatrix4(new M().copy(L.inner.matrixWorld).invert());
    const i = md.addAtom(b.x, b.y, b.z);
    if (i >= 0) { const dn = new V(0, -1, 0).transformDirection(new M().copy(L.inner.matrixWorld).invert()); md.vx[i] = dn.x * 0.05; md.vy[i] = dn.y * 0.05; md.vz[i] = dn.z * 0.05; }
    return { i, depth: 1.0 };
  });
  await wait(1500);
  const lone = await ev((i) => { const L = window.__mdlab, V = L.camera.position.constructor, md = L.md; L.inner.updateWorldMatrix(true, false); const w = new V(md.x[i], md.y[i], md.z[i]).applyMatrix4(L.inner.matrixWorld); return { above: (w.y - (L.bench.position.y + L.S.tableH + 0.025)) / L.simRoot.scale.x, N: md.N }; }, put.i);
  ok('a loose atom under the worktop, moving down, is put back on it', put.i >= 0 && lone.above > 0.25, `atom ${put.i}: ${lone.above.toFixed(2)} A above the top (started 1 A below)`);
  // ... and the whole experiment cannot be pushed into the table with the grip
  const sim0 = await ev(() => window.__mdlab.simRoot.position.y);
  await aimAt('right', [0.25, 1.1, -0.45], [0.25, 2.1, -0.45]); await wait(200);          // pointing up: nothing on the ray, so the grip takes the experiment
  await btn('right', 'squeeze', 1); await wait(250);
  await moveBy('right', [0, -0.6, 0]); await wait(500);
  const lw = await lowest(), sim1 = await ev(() => window.__mdlab.simRoot.position.y);
  await btn('right', 'squeeze', 0); await wait(250);
  ok('grip-moving the experiment 60 cm down stops it on the worktop', lw.low > lw.rad - 0.002 && sim0 - sim1 < 0.5, `lowest atom ${(lw.low * 100).toFixed(1)} cm above the top (radius ${(lw.rad * 100).toFixed(1)} cm), moved ${((sim0 - sim1) * 100).toFixed(0)} cm`);
  await ev(() => window.__mdlab.recenter()); await wait(300);

  // 5. panels move by their handle bar: trigger on it, drag, let go; the panel keeps facing you
  const bar0 = await ev(() => { const L = window.__mdlab, V = L.camera.position.constructor, b = new V(), c = new V(); L.PANEL_BARS[0].getWorldPosition(b); L.uiMesh.getWorldPosition(c); return { b: [b.x, b.y, b.z], c: [c.x, c.y, c.z] }; });
  const from = [bar0.b[0] + 0.35, bar0.b[1] - 0.2, bar0.b[2] + 0.45];
  await aimAt('right', from, bar0.b); await wait(300);
  ok('the ray finds the handle bar on the menu panel', await ev(() => { const v = window.__mdlab.vrc.find((q) => q.hand === 'right'); return !!(v.hit && v.hit.bar === window.__mdlab.uiMesh); }));
  await btn('right', 'trigger', 1); await wait(250);
  await moveBy('right', [0.3, 0.1, 0]); await wait(400);
  await btn('right', 'trigger', 0); await wait(250);
  const after = await ev(() => { const L = window.__mdlab, V = L.camera.position.constructor, c = new V(), h = new V(), n = new V(0, 0, 1); L.uiMesh.getWorldPosition(c); L.camera.getWorldPosition(h); n.applyQuaternion(L.uiMesh.getWorldQuaternion(new L.camera.quaternion.constructor())); const t = h.sub(c); t.y = 0; n.y = 0; return { c: [c.x, c.y, c.z], face: t.normalize().dot(n.normalize()) }; });
  const dm = [after.c[0] - bar0.c[0], after.c[1] - bar0.c[1], after.c[2] - bar0.c[2]];
  ok('dragging the bar moves the panel with the ray', Math.abs(dm[0] - 0.3) < 0.03 && Math.abs(dm[1] - 0.1) < 0.03, `moved (${dm.map((v) => v.toFixed(2)).join(', ')}) m for a hand move of (0.30, 0.10, 0)`);
  ok('the moved panel faces the user', after.face > 0.99, `cos ${after.face.toFixed(3)}`);
  const stays = await ev(() => window.__mdlab.uiMesh.position.toArray().join()); await moveBy('right', [-0.3, 0, 0]); await wait(300);
  ok('after letting go the panel stays put', (await ev(() => window.__mdlab.uiMesh.position.toArray().join())) === stays);
  ok('the VR toolbar has Stop spin and Recenter (in the controls section)', await ev(() => { const l = window.__mdlab.tbList(), i = l.indexOf('|'); return i > 0 && l.indexOf('stopspin') > i && l.indexOf('recenter') > i; }));

  await ev(() => window.__mdlab.renderer.xr.getSession().end()); await wait(600);
  ok('the desktop toolbar has both Stop spin and Recenter', await ev(() => { const l = window.__mdlab.tbList(); return l.includes('stopspin') && l.includes('recenter'); }));
  const bad = errs.filter((e) => !/Unexpected token '<'|favicon|Failed to load resource/i.test(e));
  ok('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all interaction checks passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
