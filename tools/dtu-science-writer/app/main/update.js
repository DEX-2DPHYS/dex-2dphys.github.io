/* Self-update, the same scheme as DTU Planner:
   - installed copy: reads latest.json (rolling release "dtu-science-writer" on the DEX repository) 20 s after start
     and every 6 h, downloads the new installer, checks its SHA-512, then offers "Restart now"; the installer runs
     silently (/S --force-run) and starts the new version;
   - portable copy: cannot replace itself, so it only says that a new version is out and links to the download page;
   - running from source: offers a restart when main/ or the built renderer change on disk. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_URL = 'https://github.com/DEX-2DPHYS/dex-2dphys.github.io/releases/download/dtu-science-writer/latest.json';
const DOWNLOAD_PAGE = 'https://dex-2dphys.github.io/tools/dtu-science-writer/';

/* An update is accepted only when its description (latest.json) is signed with the DTU Science Writer update key —
   the private half is held by the maintainer and the release workflow, this is the public half — and the installer
   comes from the DEX releases and has the signed SHA-512. So a tampered latest.json or installer is never run. */
const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAOHwDXVU8i8zCax+XqhYhf0Dsr0e6EGsmsqZp5UIvs20=';
const RELEASE_PREFIX = 'https://github.com/DEX-2DPHYS/dex-2dphys.github.io/releases/download/';
/** What is signed: version and the two checksums, on fixed lines. */
const signedText = (info) => ['dtu-science-writer-update', String(info.version), String((info.setup && info.setup.sha512) || ''), String((info.portable && info.portable.sha512) || '')].join('\n');
/** Is this latest.json genuine? Returns '' or the reason it is refused. key: base64 SPKI (the built-in one by default). */
function refuseUpdate(info, key = UPDATE_PUBLIC_KEY) {
  if (!info || typeof info !== 'object' || !/^\d+\.\d+\.\d+$/.test(String(info.version || ''))) return 'no valid version';
  if (!info.sig) return 'not signed';
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    if (!crypto.verify(null, Buffer.from(signedText(info)), pub, Buffer.from(String(info.sig), 'base64'))) return 'signature does not match';
  } catch (e) { return 'signature could not be checked'; }
  if (info.setup && info.setup.url && !String(info.setup.url).startsWith(RELEASE_PREFIX)) return 'installer is not from the DEX releases';
  if (info.setup && info.setup.url && !info.setup.sha512) return 'no checksum';
  return '';
}

function isNewer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/**
 * opts: { app, getWin, url, test, log }
 * Returns { check, start, restart(onBeforeExit) } — restart installs a downloaded update or relaunches.
 */
function createUpdater({ app, getWin, url, test, log = () => {}, exit = (c) => app.exit(c) }) {
  // another address only when running from source (tests); an installed copy updates from the DEX release only
  const UPDATE_URL = (!app.isPackaged && (url || process.env.DTUSW_UPDATE_URL)) || DEFAULT_URL;
  const installed = () => app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
  let pending = null;
  const tell = (info) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('app:update', info || {}); };

  async function check() {
    if (pending) return;
    try {
      const { net } = require('electron');
      const r = await net.fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) { log('update check', r.status); return; }
      const info = await r.json();
      const why = refuseUpdate(info, (!app.isPackaged && process.env.DTUSW_UPDATE_PUBKEY) || UPDATE_PUBLIC_KEY);
      if (why) { log('update ignored:', why); return; }
      if (!isNewer(info.version, app.getVersion())) return;
      if (!installed() || !info.setup || !info.setup.url) { tell({ version: info.version, download: info.page || DOWNLOAD_PAGE }); return; }
      const res = await net.fetch(info.setup.url);
      if (!res.ok) { log('update download', res.status); return; }
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = crypto.createHash('sha512').update(buf).digest('base64');
      if (sha !== info.setup.sha512) { log('update rejected: checksum differs'); return; }
      const exe = path.join(app.getPath('temp'), 'DTUScienceWriter-' + info.version + '-setup.exe');
      fs.writeFileSync(exe, buf);
      pending = { exe, version: info.version };
      log('update ready', info.version);
      tell({ version: info.version });
    } catch (e) { log('update check failed', e.message); }
  }

  /** Running from source: watch the code the app runs; a change means a restart gives the newer version. */
  function watchSource(root) {
    let timer = null;
    const onChange = (_ev, file) => {
      if (file && /\.map$|\.tmp/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => tell(null), 1500);
    };
    for (const d of ['main', 'renderer']) {
      try { fs.watch(path.join(root, d), { recursive: true }, onChange); } catch (e) { log('watch failed', d, e.message); }
    }
  }

  function start(root) {
    if (app.isPackaged) { setTimeout(check, 20 * 1000); setInterval(check, 6 * 60 * 60 * 1000); }
    else if (!test) watchSource(root);
  }

  function restart() {
    if (pending) {
      try {
        require('child_process').spawn(pending.exe, test ? ['/S'] : ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        log('installing', pending.version);
        exit(0);
        return;
      } catch (e) { log('installer failed to start', e.message); }
    }
    // without the document the app was first started with (a double-clicked file): the restart reopens the document
    // open now (config.lastDoc, main.js), not that first one
    app.relaunch({ args: process.argv.slice(1).filter(a => !(a && !a.startsWith('--') && /\.dtusw$/i.test(a))) });
    exit(0);
  }

  return { check, start, restart, isNewer };
}

module.exports = { createUpdater, isNewer, DOWNLOAD_PAGE, refuseUpdate, signedText, UPDATE_PUBLIC_KEY };
