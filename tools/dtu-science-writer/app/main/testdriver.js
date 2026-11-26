/* Test mode: electron . --test --userdata <dir> --script <file.js> [--out <log>]
   The script exports async (t) => {...} with t.exec(js), t.shot(file), t.wait(ms), t.log(...), t.key(), t.type(). */
'use strict';
const fs = require('fs');
const path = require('path');

exports.run = ({ app, win, argv, log = () => {}, exit = (c) => app.exit(c) }) => {
  log('testdriver: script ' + argv[argv.indexOf('--script') + 1]);
  const i = argv.indexOf('--script');
  const script = i >= 0 ? path.resolve(argv[i + 1]) : null;
  const w = win();
  const out = [];
  const t = {
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    exec: (js) => w.webContents.executeJavaScript(js, true),
    shot: async (file) => { const img = await w.webContents.capturePage(); fs.writeFileSync(file, img.toPNG()); out.push('shot ' + file); },
    log: (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); console.log(s); },
    size: (wd, ht) => w.setContentSize(wd, ht),
    key: async (keyCode, modifiers) => {
      const wc = w.webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers || [] });
      if (keyCode.length === 1 && !(modifiers || []).some(m => m === 'control' || m === 'alt')) wc.sendInputEvent({ type: 'char', keyCode, modifiers: modifiers || [] });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers || [] });
      await t.wait(60);
    },
    type: async (text) => { for (const ch of text) { w.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await t.wait(8); } await t.wait(80); },
    click: async (x, y) => {
      const wc = w.webContents;
      wc.sendInputEvent({ type: 'mouseMove', x, y }); await t.wait(20);
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await t.wait(20);
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await t.wait(120);
    },
    hover: async (x, y) => { w.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await t.wait(80); },
    drag: async (x0, y0, x1, y1, steps = 12) => {
      const wc = w.webContents;
      wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 }); await t.wait(30);
      wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 }); await t.wait(30);
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps);
        wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await t.wait(16);
      }
      wc.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }); await t.wait(150);
    },
    focus: () => { w.focus(); w.webContents.focus(); },
  };
  w.webContents.on('console-message', (e) => {
    const lvl = e.level != null ? e.level : '';
    if (lvl === 'error' || lvl === 3 || lvl === 'warning' || lvl === 2) out.push('console[' + lvl + '] ' + e.message);
  });
  // the packaged app (asar) can finish loading before this runs: start at once if the page is already there
  const whenLoaded = (fn) => (!w.webContents.isLoading() && w.webContents.getURL() ? setTimeout(fn, 0) : w.webContents.once('did-finish-load', fn));
  whenLoaded(async () => {
    w.showInactive();
    await t.wait(1000);
    let code = 0;
    try {
      if (script) await require(script)(t);
    } catch (e) { out.push('TEST ERROR ' + (e.stack || e.message)); code = 1; }
    const res = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : null;
    if (res) fs.writeFileSync(res, out.join('\n'));
    else console.log(out.join('\n'));
    await t.wait(200);
    exit(code);                   // ctx.exit: releases the document lock first
  });
};
