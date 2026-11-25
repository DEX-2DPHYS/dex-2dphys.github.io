/* Test mode: electron . --test --userdata <dir> --data <dir> --script <file.js>
   The script exports async (t) => {...} with t.exec(js), t.shot(file), t.wait(ms), t.log(...). */
'use strict';
const fs = require('fs');
const path = require('path');

exports.run = ({ app, win, argv, log, store }) => {
  const i = argv.indexOf('--script');
  const script = i >= 0 ? path.resolve(argv[i + 1]) : null;
  const w = win();
  const out = [];
  const t = {
    store,
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    exec: (js) => w.webContents.executeJavaScript(js, true),
    shot: async (file) => { const img = await w.webContents.capturePage(); fs.writeFileSync(file, img.toPNG()); out.push('shot ' + file); },
    log: (...a) => { out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); },
    size: (wd, ht) => w.setContentSize(wd, ht),
    key: async (keyCode, modifiers) => {
      const wc = w.webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers || [] });
      if (keyCode.length === 1 && !(modifiers || []).some(m => m === 'control' || m === 'alt')) wc.sendInputEvent({ type: 'char', keyCode, modifiers: modifiers || [] });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers || [] });
      await t.wait(60);
    },
    type: async (text) => { for (const ch of text) { w.webContents.sendInputEvent({ type: 'char', keyCode: ch }); } await t.wait(80); },
    wheel: async (x, y, deltaY) => { w.webContents.sendInputEvent({ type: 'mouseMove', x, y }); await t.wait(30); w.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY, canScroll: true }); await t.wait(120); },
    clip: (text) => require('electron').clipboard.writeText(text),
    readClip: () => require('electron').clipboard.readText(),
    focus: () => { w.focus(); w.webContents.focus(); },
  };
  w.webContents.on('console-message', (e) => {
    const lvl = e.level != null ? e.level : '';
    if (lvl === 'error' || lvl === 3 || lvl === 'warning' || lvl === 2) out.push('console[' + lvl + '] ' + e.message);
  });
  w.webContents.once('did-finish-load', async () => {
    w.showInactive();
    await t.wait(1200);
    let code = 0;
    try {
      if (script) await require(script)(t);
    } catch (e) { out.push('TEST ERROR ' + (e.stack || e.message)); code = 1; }
    const res = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : null;
    if (res) fs.writeFileSync(res, out.join('\n'));
    else console.log(out.join('\n'));
    await t.exec('window.OTT && OTT.flush && OTT.flush()').catch(() => {});
    await t.wait(300);
    app.exit(code);
  });
};
