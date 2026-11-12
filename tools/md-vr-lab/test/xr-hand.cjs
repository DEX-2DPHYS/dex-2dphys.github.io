// Building blocks as objects and the atom in the hand, driven headlessly (IWER, Quest 3 profile): a block added beside the flake stays
// a separate object (it does not fuse on its own), the Hand moves it whole - even a block bigger than the flake - and holding it against
// the flake joins them; with Add the next atom sits in front of the fingertip with a tag, bonds where a bond line shows, otherwise floats
// where it was let go, and the Hand brings a floating atom to the flake where it bonds.
//
//   node test/xr-hand.cjs <index.html>
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,800', `--user-data-dir=${path.join(LA, 'Temp', 'mdhand-' + Date.now())}`],
  });
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 800 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
  await wait(1500);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const btn = (hand, id, v) => ev((h, b, x) => window.__dev.controllers[h].updateButtonValue(b, x), hand, id, v);
  const press = async (hand, id, ms = 250) => { await btn(hand, id, 1); await wait(ms); await btn(hand, id, 0); await wait(ms); };
  // world position of atom i, and of the centre of a set of atoms
  const W = (i) => ev((k) => { const L = window.__mdlab, V = L.camera.position.constructor; L.inner.updateWorldMatrix(true, false); const w = new V(L.md.x[k], L.md.y[k], L.md.z[k]).applyMatrix4(L.inner.matrixWorld); return [w.x, w.y, w.z]; }, i);
  const comW = (g) => ev((G) => { const L = window.__mdlab, V = L.camera.position.constructor, md = L.md; L.inner.updateWorldMatrix(true, false); const c = new V(); let n = 0; for (let i = 0; i < md.N; i++) if (L.mat.grp[i] === G) { c.add(new V(md.x[i], md.y[i], md.z[i]).applyMatrix4(L.inner.matrixWorld)); n++; } c.divideScalar(n); return [c.x, c.y, c.z]; }, g);
  // point the right controller straight down from above `t`, so that its ray passes through t
  const pointDownAt = (t, h = 0.25) => ev((T, H) => { const c = window.__dev.controllers.right; c.position.set(T[0], T[1] + H, T[2]); c.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); }, t, h);
  // put the atom in the right hand (the ghost) on the world point t: aim down, then correct by what the ghost really shows
  const ghostTo = async (t) => {
    await pointDownAt(t, 0.07); await wait(250);
    for (let k = 0; k < 3; k++) {
      const g = await ev(() => { const v = window.__mdlab.vrc.find((q) => q.hand === 'right'); return v.ghost ? v.ghost.P.toArray() : null; });
      if (!g) return null; const d = [t[0] - g[0], t[1] - g[1], t[2] - g[2]]; if (Math.hypot(...d) < 0.001) break;
      await ev((D) => { const c = window.__dev.controllers.right; c.position.set(c.position.x + D[0], c.position.y + D[1], c.position.z + D[2]); }, d); await wait(200);
    }
    return ev(() => { const v = window.__mdlab.vrc.find((q) => q.hand === 'right'); return { on: !!v.ghostOn, host: v.ghost.host, P: v.ghost.P.toArray(), tag: !!v.ghost.tag.material.map }; });
  };

  await ev(() => document.getElementById('vrBtn').click()); await wait(2800);
  await ev(() => { const L = window.__mdlab; L.S.paused = false; L.S.sys.sel = 'graphene'; L.S.sys.size = 12; L.S.sys.open = true; });
  const before = await ev(() => window.__mdlab.md.N);
  await ev(() => window.__mdlab.addBlock()); await wait(400);
  let st = await ev(() => { const L = window.__mdlab, md = L.md; const gs = new Set(); for (let i = 0; i < md.N; i++) gs.add(L.mat.grp[i]); return { N: md.N, objects: L.mat.objects, groups: [...gs], gB: L.mat.grp[md.N - 1], g0: L.mat.grp[0] }; });
  ok('a block added as a separate object (bigger than the flake)', st.objects && st.groups.length === 2 && st.gB !== st.g0 && st.N - before > before, JSON.stringify({ flake: before, block: st.N - before, groups: st.groups }));
  const B0 = st.N - 1, nBlock = st.N - before;
  for (let k = 0; k < 8; k++) { await wait(500); if (process.env.DBG) console.log(await ev(() => { const L = window.__mdlab, md = L.md, m = L.mat; let g = 99; for (let i = 0; i < md.N; i++) if (m.grp[i] === m.grp[0]) for (let j = 0; j < md.N; j++) if (m.grp[j] !== m.grp[0]) g = Math.min(g, Math.hypot(md.x[i] - md.x[j], md.y[i] - md.y[j], md.z[i] - md.z[j])); return JSON.stringify({ gap: +g.toFixed(2), join: m.join ? [...m.join] : null, carry: !!L.carry, hold: L.hold.kind }); })); }
  st = await ev(() => { const L = window.__mdlab; return { fused: L.mat.fused || 0, g: [L.mat.grp[0], L.mat.grp[L.md.N - 1]], piece: L.mat.fragmentMask(L.md.N - 1).n }; });
  ok('left alone for 4 s, the block stays separate', st.g[0] !== st.g[1] && st.piece === nBlock, JSON.stringify(st));
  ok('the Hand moves the block whole, though it has more than half the atoms', await ev((i) => { const L = window.__mdlab; return L.movesWhole(i, L.mat.fragmentMask(i)); }, B0));
  ok('... and the flake is still the main structure (pull an atom out of it), though it is the smaller one', !(await ev(() => { const L = window.__mdlab; return L.movesWhole(0, L.mat.fragmentMask(0)); })));

  // pick the block up with the Hand and move it 8 cm up: it follows, the flake stays
  await ev(() => { window.__mdlab.S.tool = 'hand'; });
  const gB = st.g[1], gF = st.g[0];
  const blk0 = await comW(gB), fl0 = await comW(gF), a0 = await W(B0 - Math.floor(nBlock / 2));
  await pointDownAt(a0, 0.2); await wait(300);
  await btn('right', 'trigger', 1); await wait(300);
  await ev(() => { const c = window.__dev.controllers.right; c.position.set(c.position.x, c.position.y + 0.08, c.position.z); }); for (let k = 0; k < 7; k++) { await wait(500); if (process.env.DBG) console.log("lift", await ev(() => JSON.stringify({ N: window.__mdlab.md.N, carry: !!window.__mdlab.carry, hold: window.__mdlab.hold.kind, step: window.__mdlab.md.step, T: Math.round(window.__mdlab.md.temperature()) }))); }     // (headless runs few MD steps a second; the carry follows in simulated time)
  const blk1 = await comW(gB), fl1 = await comW(gF);
  ok('the Hand (trigger) picks the block up and lifts it with the hand; the flake stays', blk1[1] - blk0[1] > 0.04 && Math.hypot(fl1[0] - fl0[0], fl1[1] - fl0[1], fl1[2] - fl0[2]) < 0.01, `block up ${((blk1[1] - blk0[1]) * 100).toFixed(1)} cm, flake moved ${(Math.hypot(fl1[0] - fl0[0], fl1[1] - fl0[1], fl1[2] - fl0[2]) * 100).toFixed(1)} cm`);
  // still holding: bring it down onto the flake - they join
  const fsum = await ev(() => window.__mdlab.mat.fused || 0);
  const tgt = await comW(gF);
  await ev((T, B, F) => { const c = window.__dev.controllers.right; c.position.set(c.position.x + (T[0] - B[0]) * 0.75, c.position.y - 0.08, c.position.z + (T[2] - B[2]) * 0.75); }, tgt, blk1, fl1);
  await wait(4000);
  st = await ev(() => { const L = window.__mdlab; return { fused: L.mat.fused || 0, g: [L.mat.grp[0], L.mat.grp[L.md.N - 1]] }; });
  ok('held and pushed onto the flake, the block joins it (one object)', st.fused > fsum && st.g[0] === st.g[1], JSON.stringify(st));
  await btn('right', 'trigger', 0); await wait(300);

  // start again with a plain flake for the atom in the hand
  await ev(() => { const L = window.__mdlab; L.build(L.S.lastBuild || L.B, { quiet: true }); L.S.tool = 'add'; L.S.cel = 'C'; L.S.paused = false; }); await wait(800);
  await ev(() => { const L = window.__mdlab; L.recenter(); }); await wait(300);
  // an edge atom of the flake (furthest from the centre, in the sheet) and the direction outward
  const edge = await ev(() => { const L = window.__mdlab, md = L.md, V = L.camera.position.constructor; L.inner.updateWorldMatrix(true, false);
    let cx = 0, cy = 0, cz = 0; for (let i = 0; i < md.N; i++) { cx += md.x[i]; cy += md.y[i]; cz += md.z[i]; } cx /= md.N; cy /= md.N; cz /= md.N;
    let e = 0, best = -1; for (let i = 0; i < md.N; i++) { const r = Math.hypot(md.x[i] - cx, md.y[i] - cy); if (r > best) { best = r; e = i; } }
    const dir = [md.x[e] - cx, md.y[e] - cy, 0], n = Math.hypot(...dir), out = [md.x[e] + dir[0] / n * 1.7, md.y[e] + dir[1] / n * 1.7, md.z[e]];
    const w = new V(...out).applyMatrix4(L.inner.matrixWorld); return { e, N: md.N, target: [w.x, w.y, w.z] }; });
  let gh = await ghostTo(edge.target);
  ok('Add: the next atom sits in front of the fingertip with its tag', gh && gh.on && gh.tag, JSON.stringify(gh));
  ok('near an edge atom the bond line shows which atom it bonds to', gh && gh.host >= 0, `host ${gh && gh.host} (edge atom ${edge.e})`);
  await press('right', 'trigger'); await wait(600);
  const bonded = await ev((h) => { const L = window.__mdlab, md = L.md, i = md.N - 1; return { N: md.N, d: Math.hypot(md.x[i] - md.x[h], md.y[i] - md.y[h], md.z[i] - md.z[h]) }; }, gh.host);
  ok('trigger: the atom goes in, bonded to it', bonded.N === edge.N + 1 && bonded.d < 1.8, `N ${edge.N} -> ${bonded.N}, ${bonded.d.toFixed(2)} A from its host`);
  // away from everything: it floats where it was let go
  const far = await ev(() => { const L = window.__mdlab, V = L.camera.position.constructor, c = new V(); L.simRoot.getWorldPosition(c); return [c.x + 0.05, c.y + 0.22, c.z]; });
  gh = await ghostTo(far);
  ok('in empty space: no bond line', gh && gh.on && gh.host < 0, JSON.stringify(gh));
  const nPre = await ev(() => window.__mdlab.md.N);
  await press('right', 'trigger'); await wait(300);
  const fl = await ev(() => { const L = window.__mdlab, md = L.md, i = md.N - 1; return { i, N: md.N, v: Math.hypot(md.vx[i], md.vy[i], md.vz[i]), x: [md.x[i], md.y[i], md.z[i]] }; });
  await wait(1000);
  const fl2 = await ev((i) => { const L = window.__mdlab, md = L.md; let nb = 99; for (let k = 0; k < md.N; k++) if (k !== i) nb = Math.min(nb, Math.hypot(md.x[k] - md.x[i], md.y[k] - md.y[i], md.z[k] - md.z[i])); return { x: [md.x[i], md.y[i], md.z[i]], nb }; }, fl.i);
  const drift = Math.hypot(fl2.x[0] - fl.x[0], fl2.x[1] - fl.x[1], fl2.x[2] - fl.x[2]);
  ok('trigger there: a floating atom, staying where it was let go', fl.N === nPre + 1 && fl.v < 1e-3 && drift < 0.5 && fl2.nb > 3, `drift ${drift.toFixed(2)} A in 1 s, nearest atom ${fl2.nb.toFixed(1)} A`);
  // the Hand takes it to the flake edge, where it bonds
  await ev(() => { window.__mdlab.S.tool = 'hand'; });
  const fw = await W(fl.i); await pointDownAt(fw, 0.15); await wait(300);
  await btn('right', 'trigger', 1); await wait(300);
  const edge2 = await ev((skip, added) => { const L = window.__mdlab, md = L.md, V = L.camera.position.constructor; L.inner.updateWorldMatrix(true, false);
    let cx = 0, cy = 0, n = 0; for (let i = 0; i < md.N; i++) if (i !== skip && i !== added) { cx += md.x[i]; cy += md.y[i]; n++; } cx /= n; cy /= n;
    let e = 0, best = -1; for (let i = 0; i < md.N; i++) if (i !== skip && i !== added && Math.hypot(md.x[i] - md.x[added], md.y[i] - md.y[added]) > 6) { const r = Math.hypot(md.x[i] - cx, md.y[i] - cy); if (r > best) { best = r; e = i; } }     // (an original edge atom, away from the one added before)
    const dir = [md.x[e] - cx, md.y[e] - cy], m = Math.hypot(...dir); const w = new V(md.x[e] + dir[0] / m * 1.5, md.y[e] + dir[1] / m * 1.5, md.z[e]).applyMatrix4(L.inner.matrixWorld); return [w.x, w.y, w.z]; }, fl.i, edge.N);
  const now = await W(fl.i);
  await ev((T, A) => { const c = window.__dev.controllers.right; c.position.set(c.position.x + T[0] - A[0], c.position.y + T[1] - A[1], c.position.z + T[2] - A[2]); }, edge2, now);
  let held = null; for (let k = 0; k < 10 && !(held && held.piece > 10); k++) { await wait(500); held = await ev((i) => { const L = window.__mdlab, md = L.md; let nb = 99; for (let k = 0; k < md.N; k++) if (k !== i) nb = Math.min(nb, Math.hypot(md.x[k] - md.x[i], md.y[k] - md.y[i], md.z[k] - md.z[i])); return { nb, piece: L.mat.fragmentMask(i).n, N: md.N }; }, fl.i); }     // (hold until it bonds: headless runs few MD steps a second)
  await btn('right', 'trigger', 0); await wait(1500);
  const end = await ev((i) => { const L = window.__mdlab, md = L.md; let nb = 99; for (let k = 0; k < md.N; k++) if (k !== i) nb = Math.min(nb, Math.hypot(md.x[k] - md.x[i], md.y[k] - md.y[i], md.z[k] - md.z[i])); return { nb, piece: L.mat.fragmentMask(i).n, N: md.N }; }, fl.i);
  ok('the Hand brings the floating atom to the edge: it bonds there', held.piece > 10 && end.nb < 1.75 && end.piece > 10, `nearest atom ${end.nb.toFixed(2)} A, its piece ${end.piece} of ${end.N} atoms`);
  ok('the VR toolbar has no Attach (Add does it)', await ev(() => !window.__mdlab.tbList().includes('attach') && window.__mdlab.tbList().includes('add')));

  await ev(() => window.__mdlab.renderer.xr.getSession().end()); await wait(600);
  const bad = errs.filter((e) => !/Unexpected token '<'|favicon|Failed to load resource/i.test(e));
  ok('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'all hand checks passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
