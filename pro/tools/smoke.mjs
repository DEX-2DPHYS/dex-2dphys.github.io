// EBL Workbench Pro — the package's own test, run with the package's Node on each platform (the release
// workflow does, before anything is published):   app/node/node app/tools/smoke.mjs
//   1. the backend starts with its native core and answers
//   2. a fractured correction through the backend = the same correction in JavaScript here (writing data
//      and dose classes; class values to 1e-12 — the platform's libm may round pow/exp's last bit apart)
//   3. KOH: the core's level set = JavaScript's, voxel for voxel
//   4. Monte Carlo: the same batches; trajectories may part where libm's exp/log round differently from
//      V8's, so the check is statistical (η_BSE within 1 %), and an exact match is reported when there is one
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localFracture } from '../src/ui/local.js';
import { packLibrary, unpackCells } from '../src/core/geom/pack.js';
import { fractureCorrect } from '../src/core/pec/fractured.js';
import { demoProject } from '../src/core/project.js';
import { encodeWire, decodeWire } from '../src/core/wire.js';
import { createFabEngine } from '../src/core/fab/engine.js';
import { kohCompute, kohPayloadRaw } from '../src/core/fab/koh.js';
import { createTransport } from '../src/core/mc/transport.js';
import { transportPayload } from '../src/core/mc/result.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.EBW_SMOKE_PORT || 8199), BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [path.join(here, '..', 'desktop', 'server.mjs'), '--port', String(PORT), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
const core = async (type, payload) => { const r = decodeWire(await (await fetch(BASE + '/api/ebw/core', { method: 'POST', body: encodeWire({ type, payload }) })).arrayBuffer()); if (!r.ok) throw new Error(r.error); return r.result; };

try {
  console.log(`EBL Workbench Pro smoke test: Node ${process.version}, ${process.platform}-${process.arch}`);
  let hello = null;
  for (let k = 0; k < 60 && !hello; k++) { await sleep(250); try { hello = await (await fetch(BASE + '/api/ebw/hello')).json(); } catch { /* not up yet */ } }
  check('the backend answers, with its native core', !!(hello && hello.core && ['srRows', 'pecSolve', 'kohEtch', 'mcBatches'].every((t) => hello.core.supports.includes(t))), hello ? JSON.stringify(hello.core) : log.slice(0, 400));
  if (!hello || !hello.core) throw new Error('no core: ' + log.slice(0, 600));
  const e = await core('echo', { n: 3, data: new Float64Array([1, 2, 3.5]) });
  check('a binary round trip', e.data.length === 3 && e.data[2] === 1 && e.sumIn === 6.5, JSON.stringify({ n: e.data.length, sumIn: e.sumIn }));

  // 2. the correction
  const P = demoProject();
  const r = await localFracture({ project: { library: packLibrary(P.library).packed, psf: P.psf }, opts: { fit: 'contour', desktop: true } }, null, undefined, BASE);
  const one = fractureCorrect({ library: P.library, psf: P.psf }, { fit: 'contour' });
  const sig = (L) => { const c = []; for (const [n, cell] of Object.entries(L.cells)) for (const s of cell.shapes) c.push(`${n}|${s.layer}|${s.frag}|${s.writeDose.toPrecision(10)}|${s.doseClass}`); return c; };
  const a = sig(unpackCells(r.library)), b = sig(one.library);
  let diff = 0; for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) diff++;
  const clsRel = Math.max(0, ...r.classes.map((v, k) => Math.abs(v - one.classes[k]) / Math.abs(one.classes[k])));
  check('a correction through the backend = the same in JavaScript (every shape, dose and class)', a.length === b.length && diff === 0, `${a.length} vs ${b.length} shapes, ${diff} differ`);
  check('… dose-class values to 1e-12', r.classes.length === one.classes.length && clsRel <= 1e-12, clsRel.toExponential(2));
  check('… and the native core did the heavy parts', !!(r.stats.core && r.stats.core.sr === 1 && r.stats.core.solve === 1 && !r.stats.core.failed), JSON.stringify(r.stats.core));

  // 3. KOH on a small 3D block with a round hole in a nitride mask
  const eng = createFabEngine();
  eng.buildSubstrate({ siNm: 300, oxNm: 0, polyNm: 0, metNm: 0, headroomNm: 150, nmLat: 10, nmVert: 2, w: 400, d: 400, wfW: 1000, wfD: 1000, wafer: { surface: '100', flat: '110', rot: 20 } });
  eng.run('deposit', { material: 'SI3N4', thickness: 20, method: 'directional' });
  const s = eng.state, W = s.W, H = s.H;
  let top = 0; while (top < H && s.grid[0][top * W] === 0) top++;
  for (let z = 0; z < s.D; z++) for (let y = top; y < top + 10; y++) for (let x = 0; x < W; x++) if (Math.hypot((x - W / 2) * 10, (z - s.D / 2) * 10) < 100) s.grid[z][y * W + x] = 0;
  const S = eng.kohPrepare({ conc: 30, temp: 80, time: 8 });
  const js = kohCompute(S), nat = await core('kohEtch', kohPayloadRaw(S));
  let kd = 0, n = 0; for (let i = 0; i < js.mask.length; i++) { n += js.mask[i]; if (js.mask[i] !== nat.mask[i]) kd++; }
  check('KOH: the same steps and voxels as JavaScript', nat.steps === js.steps && kd === 0 && n > 0, `steps ${nat.steps}/${js.steps}, ${kd} of ${n} voxels differ`);

  // 4. Monte Carlo
  const t = createTransport({ E0: 50, layers: [{ mat: 'PMMA', thickness: 100 }, { mat: 'Si', thickness: Infinity }], rMax: 1e5 });
  await core('mcInit', transportPayload(t));
  let same = 0, bsJ = 0, nJ = 0;
  for (let b = 0; b < 10; b++) {
    const j = t.runBatch(200, 3, b), c = await core('mcBatches', { perBatch: 200, seed: 3, from: b, count: 1, threads: 1 });
    if (j.steps === c.steps && j.bsCount === c.bsCount) same++;
    bsJ += j.bsCount; nJ += 200;
  }
  const big = await core('mcBatches', { perBatch: 400, seed: 3, from: 0, count: 50, threads: 0 });
  let bsJ2 = 0; for (let b = 0; b < 50; b++) bsJ2 += t.runBatch(400, 3, b).bsCount;
  const etaN = big.bsCount / 20000, etaJ = bsJ2 / 20000;
  check('Monte Carlo: η_BSE of 20 000 electrons = JavaScript\'s within 1 %', Math.abs(etaN - etaJ) < 0.01, `core ${etaN.toFixed(4)}, JS ${etaJ.toFixed(4)}; ${same}/10 batches with identical trajectories`);
} catch (err) {
  check('the smoke test ran to the end', false, err.stack);
} finally { server.kill(); }
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
