/* assets/icon.png -> assets/icon.ico (Windows shortcuts and file-type icons need .ico).
   Renders 16…256 px with the bundled Typst from tools/icon.typ and stores them as PNG images inside the ICO
   (supported since Windows Vista).  Usage: node tools/make-ico.js */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const typst = path.join(process.env.LOCALAPPDATA, 'dtu-science-writer-build', 'bin', 'typst.exe');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtusw-ico-'));
const pngs = sizes.map((s) => {
  const out = path.join(tmp, s + '.png');
  // the page is 512 pt: ppi = 72 * size / 512 gives size × size pixels
  execFileSync(typst, ['compile', '--font-path', path.join(ROOT, 'assets', 'fonts'), '--format', 'png', '--ppi', String(72 * s / 512), path.join(__dirname, 'icon.typ'), out]);
  return fs.readFileSync(out);
});
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), Buffer.concat([header, dir, ...pngs]));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote assets/icon.ico (' + sizes.join(', ') + ' px)');
