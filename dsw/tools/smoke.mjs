// Smoke-test a built DSW: does the host serve, and does every plugin bundle
// actually load and produce a frame?
//
// Listing a plugin only proves its files are on disk. Opening its socket is
// what forces the host to load the shared library, resolve dex_plugin_entry,
// construct an instance and call render() — so a binary frame coming back is
// the real "this build works on this platform" signal.
//
//   node smoke.mjs <base-url>        e.g. node smoke.mjs http://127.0.0.1:8899

const base = (process.argv[2] || 'http://127.0.0.1:8899').replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws');
const FRAME_TIMEOUT_MS = 15000;

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };

async function getText(path) {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.text();
}

// One frame from one plugin: the end-to-end proof that its core loaded.
function frameFrom(id) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let ws;
    try {
      ws = new WebSocket(`${wsBase}/ws/${id}`);
    } catch (e) {
      return done({ ok: false, why: `connect threw: ${e.message}` });
    }
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      done({ ok: false, why: `no frame within ${FRAME_TIMEOUT_MS} ms` });
      try { ws.close(); } catch {}
    }, FRAME_TIMEOUT_MS);
    ws.onopen = () => ws.send('f');
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return;      // status JSON, keep waiting
      clearTimeout(timer);
      const bytes = ev.data.byteLength;
      try { ws.close(); } catch {}
      done(bytes > 12 ? { ok: true, bytes } : { ok: false, why: `frame too small (${bytes} B)` });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done({ ok: false, why: 'socket error' });
    };
  });
}

console.log(`smoke-testing ${base}`);

if (typeof WebSocket === 'undefined') {
  console.log('  FAIL  this Node has no global WebSocket (needs Node 22+)');
  process.exit(1);
}

let plugins;
try {
  plugins = JSON.parse(await getText('/api/plugins'));
  ok(`/api/plugins listed ${plugins.length}: ${plugins.map(p => p.id).join(', ')}`);
} catch (e) {
  bad(`/api/plugins: ${e.message}`);
  process.exit(1);
}

if (!plugins.length) bad('no plugins discovered');

try { await getText('/'); ok('launcher page served'); }
catch (e) { bad(`launcher page: ${e.message}`); }

for (const p of plugins) {
  try { await getText(`/plugins/${p.id}/ui/index.html`); ok(`${p.id}: UI served`); }
  catch (e) { bad(`${p.id}: UI ${e.message}`); }

  const r = await frameFrom(p.id);
  if (r.ok) ok(`${p.id}: core loaded and rendered a ${r.bytes} B frame`);
  else bad(`${p.id}: ${r.why}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
