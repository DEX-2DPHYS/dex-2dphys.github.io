// Turns each ui/examples/*.transim.json into the exact messages the panel sends the core
// (configure, contacts, maps), one JSON per line, for the C++ example gate.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'ui', 'examples'), out = path.join(__dirname, '..', 'test', 'examples-msgs');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.transim.json'))) {
  const pr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const L = [JSON.stringify({ t: 'configure', ...pr.params }),
    JSON.stringify({ t: 'contacts', data: pr.contacts.map((c) => [c.id, c.role, c.x0, c.y0, c.x1, c.y1].join('|')).join(';') })];
  for (const k of ['density', 'mobility']) { const m = pr.maps[k]; L.push(m ? JSON.stringify({ t: 'map', kind: k, w: m.w, h: m.h, data: m.data }) : JSON.stringify({ t: 'clear_map', kind: k })); }
  fs.writeFileSync(path.join(out, f.replace('.transim.json', '.msgs')), L.join('\n') + '\n');
}
console.log('written to', out);
