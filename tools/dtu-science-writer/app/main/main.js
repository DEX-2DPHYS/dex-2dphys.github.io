/* DTU Science Writer — Electron main process: startup and the window.
   context.js shared state · menu.js menu · ipc.js renderer requests · storage.js file writing
   typst.js layout engine · update.js self-update · testdriver.js automated tests */
'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');
const { createGuard, lockWindow } = require('./guard.js');
const path = require('path');
const fs = require('fs');
const ctx = require('./context.js');
const { TypstRunner } = require('./typst.js');
const { createUpdater } = require('./update.js');
const { buildMenu } = require('./menu.js');
const { registerIpc } = require('./ipc.js');
const docs = require('./docs.js');

app.setName(ctx.NAME);
if (process.platform === 'win32') app.setAppUserModelId(ctx.APP_ID);
if (ctx.argVal('--userdata')) app.setPath('userData', path.resolve(ctx.argVal('--userdata')));

function createWindow(openPath) {
  const b = ctx.TEST ? { x: -20000, y: 0, width: +(ctx.argVal('--w') || 1500), height: +(ctx.argVal('--h') || 950) } : { width: 1500, height: 950 };
  const icon = path.join(ctx.ROOT, 'assets', 'icon.png');
  const win = new BrowserWindow({
    ...b, show: !ctx.TEST, title: ctx.NAME, backgroundColor: '#e9e7e2',
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  ctx.win = win;
  lockWindow(win, ctx.guard, shell);                 // no navigation, no new windows, no web permissions (guard.js)
  win.__openPath = ctx.guard.allowOpen(openPath);
  win.loadFile(path.join(ctx.ROOT, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (ctx.forceClose || ctx.TEST || !ctx.dirty) return;
    e.preventDefault();
    win.webContents.send('close-request');          // the renderer asks Save / Don't save / Cancel
  });
  win.on('closed', () => { ctx.win = null; });
  win.webContents.session.setSpellCheckerLanguages(['en-GB']);
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    for (const s of p.dictionarySuggestions || []) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (p.misspelledWord) items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

if (!ctx.TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, args) => {
    const p = ctx.fileArg(args);
    const win = ctx.win;
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (p) win.webContents.send('open-path', ctx.guard.allowOpen(p)); }
  });
  app.whenReady().then(() => {
    ctx.loadConfig();
    ctx.guard = createGuard({ test: ctx.TEST, recent: () => ctx.config.recent || [], currentDoc: () => docs.currentPath(), page: path.join(ctx.ROOT, 'renderer', 'index.html') });
    ctx.typst = new TypstRunner(app);
    registerIpc();
    buildMenu();
    ctx.log('start', app.getVersion(), 'packaged=' + app.isPackaged, 'test=' + ctx.TEST, 'typst=' + ctx.typst.available());
    createWindow(ctx.fileArg(ctx.argv));
    ctx.updater = createUpdater({ app, getWin: () => ctx.win, url: ctx.argVal('--update-url'), test: ctx.TEST, log: ctx.log, exit: ctx.exit });
    ctx.updater.start(ctx.ROOT);
    if (ctx.TEST) require('./testdriver.js').run({ app, win: () => ctx.win, argv: ctx.argv, log: ctx.log, exit: ctx.exit });
  });
  /* The document open when the app closes is the one opened at the next start (null: an unsaved document was
     open, so the next start begins with a new one). Recorded once, before the lock is released. */
  let remembered = false;
  const rememberDoc = () => {
    if (remembered || ctx.TEST) return;
    remembered = true;
    ctx.config.lastDoc = docs.currentPath();
    ctx.saveConfig();
    ctx.log('closing with', ctx.config.lastDoc || '(unsaved document)');
  };
  app.on('window-all-closed', () => { rememberDoc(); docs.close(); if (ctx.typst) ctx.typst.cleanup(); app.quit(); });
  app.on('before-quit', () => { rememberDoc(); docs.close(); });           // release the lock file (also on quit from the menu)
  ctx.onExit(() => { rememberDoc(); docs.close(); });                      // and on hard exits (tests, Restart now)
}
