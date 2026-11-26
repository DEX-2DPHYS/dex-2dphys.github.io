/* Shared state of the main process: names, command-line switches, the window, the settings file, the log.
   main.js starts the app; menu.js, ipc.js, storage.js, typst.js, update.js use this. */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { atomicWrite } = require('./storage.js');

const argv = process.argv.slice(1);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const ctx = {
  NAME: 'DTU Science Writer',
  APP_ID: 'dk.dtu.sciencewriter',
  EXT: 'dtusw',
  ROOT: path.join(__dirname, '..'),
  argv, argVal,
  // the test driver runs a script inside the program: only when running from source, never in an installed copy
  TEST: argv.includes('--test') && !app.isPackaged,
  /** A test stand-in address from the environment (DTUSW_…_URL): ignored by an installed copy. */
  devEnv: (name) => (app.isPackaged ? undefined : process.env[name]),
  guard: null,          // what the page may ask for (guard.js)
  win: null,            // the main BrowserWindow
  typst: null,          // TypstRunner
  updater: null,
  dirty: false,         // renderer reports unsaved changes
  forceClose: false,    // close without asking (after the renderer has dealt with unsaved changes)
  config: { recent: [], user: {} },
};

const configFile = () => path.join(app.getPath('userData'), 'config.json');
ctx.loadConfig = () => {
  try { ctx.config = { recent: [], user: {}, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) }; } catch (_) { /* first start */ }
};
ctx.saveConfig = () => { try { atomicWrite(configFile(), Buffer.from(JSON.stringify(ctx.config, null, 1))); } catch (_) {} };

ctx.log = (...a) => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (_) {}
};

/** The .dtusw file named on a command line (double-click, second instance), or null. */
ctx.fileArg = (args) => {
  const a = args.filter(x => x && !x.startsWith('--') && x.toLowerCase().endsWith('.' + ctx.EXT));
  return a.length ? path.resolve(a[a.length - 1]) : null;
};

/* app.exit() skips Electron's quit events, so every hard exit goes through ctx.exit(), which runs these first
   (e.g. releasing the document's lock file). */
const exitHooks = [];
ctx.onExit = (fn) => exitHooks.push(fn);
ctx.exit = (code = 0) => {
  for (const fn of exitHooks) { try { fn(); } catch (_) {} }
  app.exit(code);
};

/** Send a menu command to the renderer. */
ctx.send = (name) => () => { if (ctx.win) ctx.win.webContents.send('menu', name); };

module.exports = ctx;
