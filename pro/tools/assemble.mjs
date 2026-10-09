// Assemble an EBL Workbench Pro package for this platform (run from the repository root, by the release
// workflow on each OS):
//   node pro/tools/assemble.mjs --core <built ebw-core[.exe]> --out <dir> [--libomp <libomp.dylib>]
// → <dir>/EBL Workbench Pro/
//     EBL Workbench.html, tutorial/videos/*.mp4        the page (the HTML build) and its videos
//     Start EBL Workbench Pro.cmd | .command | start-ebl-workbench-pro.sh, README.txt (+ .ico on Windows)
//     app/desktop/*.mjs, app/desktop/bin/ebw-core[.exe] (+ libomp.dylib on macOS)
//     app/src/**, app/package.json, app/tools/smoke.mjs
//     app/node/node[.exe] + LICENSE                     Node.js, the latest v24 from nodejs.org, checksum-verified
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const CORE = arg('--core'), OUT = arg('--out'), LIBOMP = arg('--libomp');
if (!CORE || !OUT) { console.error('usage: node pro/tools/assemble.mjs --core <ebw-core> --out <dir> [--libomp <dylib>]'); process.exit(2); }
const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const PRO = path.resolve('pro'), UI = path.resolve('ebl-workbench');
const pkg = path.join(path.resolve(OUT), 'EBL Workbench Pro'), app = path.join(pkg, 'app');
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.cpSync(a, b, { recursive: true }); };

fs.rmSync(pkg, { recursive: true, force: true });
cp(path.join(UI, 'app.html'), path.join(pkg, 'EBL Workbench.html'));
cp(path.join(UI, 'tutorial', 'videos'), path.join(pkg, 'tutorial', 'videos'));
for (const f of fs.readdirSync(path.join(PRO, 'desktop'))) if (f.endsWith('.mjs')) cp(path.join(PRO, 'desktop', f), path.join(app, 'desktop', f));
const exe = plat === 'win' ? 'ebw-core.exe' : 'ebw-core';
cp(path.resolve(CORE), path.join(app, 'desktop', 'bin', exe));
if (plat === 'darwin' && LIBOMP) cp(path.resolve(LIBOMP), path.join(app, 'desktop', 'bin', 'libomp.dylib'));
cp(path.join(PRO, 'src'), path.join(app, 'src'));
cp(path.join(PRO, 'package.json'), path.join(app, 'package.json'));
cp(path.join(PRO, 'tools', 'smoke.mjs'), path.join(app, 'tools', 'smoke.mjs'));
const start = { win: 'Start EBL Workbench Pro.cmd', darwin: 'Start EBL Workbench Pro.command', linux: 'start-ebl-workbench-pro.sh' }[plat];
cp(path.join(PRO, 'start', start), path.join(pkg, start));
if (plat === 'win') cp(path.join(PRO, 'start', 'EBL Workbench Pro.ico'), path.join(pkg, 'EBL Workbench Pro.ico'));

// Node.js: the latest v24 release for this platform, verified against nodejs.org's SHASUMS256
const index = await (await fetch('https://nodejs.org/dist/index.json')).json();
const ver = index.find((r) => r.version.startsWith('v24.')).version;
const file = plat === 'win' ? `node-${ver}-win-${arch}.zip` : `node-${ver}-${plat}-${arch}.${plat === 'linux' ? 'tar.xz' : 'tar.gz'}`;
const base = `https://nodejs.org/dist/${ver}/`;
const sums = await (await fetch(base + 'SHASUMS256.txt')).text();
const want = sums.split('\n').map((l) => l.trim().split(/\s+/)).find(([, f]) => f === file)?.[0];
const buf = Buffer.from(await (await fetch(base + file)).arrayBuffer());
const got = crypto.createHash('sha256').update(buf).digest('hex');
if (!want || got !== want) { console.error(`Node download ${file}: checksum ${got} does not match ${want}`); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ebw-node-'));
fs.writeFileSync(path.join(tmp, file), buf);
// Windows' own tar (bsdtar) opens zips; the GNU tar a Git-bash shell finds first does not
const winTar = plat === 'win' && process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : null;
execFileSync(winTar && fs.existsSync(winTar) ? winTar : 'tar', ['-xf', file], { cwd: tmp });
const dir = path.join(tmp, file.replace(/\.(zip|tar\.xz|tar\.gz)$/, ''));
const nodeBin = plat === 'win' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node');
cp(nodeBin, path.join(app, 'node', plat === 'win' ? 'node.exe' : 'node'));
cp(path.join(dir, 'LICENSE'), path.join(app, 'node', 'LICENSE'));
if (plat !== 'win') for (const f of [path.join(app, 'node', 'node'), path.join(app, 'desktop', 'bin', exe), path.join(pkg, start)]) fs.chmodSync(f, 0o755);

const startHow = {
  win: "double-click 'Start EBL Workbench Pro.cmd'. A console window opens (keep it open while you work;\nclose it to stop the Workbench) and the Workbench opens in your browser. Windows may warn about an\nunrecognised app the first time (More info → Run anyway).",
  darwin: "double-click 'Start EBL Workbench Pro.command'. A Terminal window opens (keep it open while you\nwork; close it to stop the Workbench) and the Workbench opens in your browser.\nThe package is not notarised, so the first time macOS blocks it. Either: right-click the .command file →\nOpen (or System Settings → Privacy & Security → Open Anyway); the script then removes the download\nquarantine from the whole folder itself. Or, in Terminal, type   xattr -dr com.apple.quarantine \n(with a space), drag this EBL Workbench Pro folder into the Terminal window, press Enter, and double-click\nagain. The title bar says 'PRO · N threads' when the fast native core runs; 'PRO' alone means it is\nstill blocked and the Workbench computes in JavaScript (everything works, but slower).",
  linux: "run ./start-ebl-workbench-pro.sh in a terminal (keep it open while you work; Ctrl+C stops the\nWorkbench). The Workbench opens in your browser (xdg-open), or open http://127.0.0.1:8095/ yourself.",
}[plat];
fs.writeFileSync(path.join(pkg, 'README.txt'), `EBL Workbench Pro - electron-beam lithography from layout to resist profile, for real e-beam work.

Start: ${startHow}

Pro is the same Workbench as the HTML version, with the heavy parts on this computer:
  - Monte Carlo, the short-range operator, the proximity-correction solve and KOH etching run in a
    native multithreaded core (app/desktop/bin/${exe}), on all processor cores;
  - the fractured correction of whole chips uses the computer's memory, not a browser tab's.
Results are the same as in the HTML version.

Nothing is installed and nothing leaves the computer: the backend listens on 127.0.0.1 only.
Projects are saved with Save / Save as... (downloads folder) and opened with Open...
Included: Node.js ${ver} (app/node, MIT licence, LICENSE beside it) to run the backend.
Check the package on this computer: app/node/node${plat === 'win' ? '.exe' : ''} app/tools/smoke.mjs
${plat === 'win' ? '' : '\nPlease note: the macOS and Linux versions have not yet been tested by real users. Feedback is\nwelcome at pbog@dtu.dk.\n'}
The tutorial videos (the T buttons) are AI-generated.
Free to use for students and staff at DTU. Users outside DTU: please ask for permission first, at
pbog@dtu.dk. More: https://dex-2dphys.github.io/ebl-workbench/
`.replace(/\n/g, plat === 'win' ? '\r\n' : '\n'));
let n = 0, bytes = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } }; walk(pkg);
console.log(`assembled ${pkg}: ${n} files, ${(bytes / 2 ** 20).toFixed(0)} MB, Node ${ver} (${file})`);
