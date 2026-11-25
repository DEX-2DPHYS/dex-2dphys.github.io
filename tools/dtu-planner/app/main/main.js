/* One Todo Tree — Electron main process. */
'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, globalShortcut, Notification, nativeTheme, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const M = require('../shared/model.js');
const { Store, atomicWrite, monthTitle } = require('./store.js');
const phone = require('./phone.js');

// packaged flavour (e.g. the generic "DTU Planner" build): product name, app id, starting categories
let FLAVOR = null;
try { FLAVOR = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'flavor.json'), 'utf8')); } catch (_) { /* normal build: no flavour file */ }
const NAME = (FLAVOR && FLAVOR.productName) || 'DTU Planner';
M.setAppName(NAME);
if (FLAVOR && FLAVOR.categories) M.setStartCategories(FLAVOR.categories);
app.setName(NAME);
const APP_ID = (FLAVOR && FLAVOR.appId) || 'dk.dtu.dtuplanner';
// the program was called "One Todo Tree" until 2026-11-25; its settings, autostart and morning task are moved over once
const LEGACY = { name: 'One Todo Tree', appId: 'dk.dtu.onetodotree' };
// installed copies look here for new versions (written by the release workflow on the DEX site repo)
const UPDATE_URL = ((i) => (i >= 0 ? process.argv[i + 1] : null))(process.argv.indexOf('--update-url')) || process.env.DTUPLANNER_UPDATE_URL || (FLAVOR && FLAVOR.updateUrl) || 'https://github.com/DEX-2DPHYS/dex-2dphys.github.io/releases/download/dtu-planner/latest.json';
const DOWNLOAD_PAGE = 'https://dex-2dphys.github.io/tools/dtu-planner/';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const argv = process.argv.slice(1);
const flag = (f) => argv.includes(f);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const TEST = flag('--test');              // automated test mode: own data/user dirs, no tray/autostart
if (argVal('--userdata')) app.setPath('userData', path.resolve(argVal('--userdata')));

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const TRAY_ICON = path.join(ROOT, 'assets', 'tray.png');
const ICON_ICO = path.join(ROOT, 'assets', 'icon.ico');

/** Running from source: give our Desktop/Start-menu shortcuts the app id + icon, so the taskbar matches them. */
function tagShortcuts() {
  if (app.isPackaged || process.platform !== 'win32') return;
  const places = [path.join(app.getPath('desktop'), NAME + '.lnk'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', NAME + '.lnk')];
  for (const lnk of places) {
    try {
      if (!fs.existsSync(lnk)) continue;
      const cur = shell.readShortcutLink(lnk);
      if (cur.appUserModelId === APP_ID && cur.icon === ICON_ICO) continue;
      shell.writeShortcutLink(lnk, 'update', { appUserModelId: APP_ID, icon: ICON_ICO, iconIndex: 0 });
      log('tagged shortcut', lnk);
    } catch (e) { log('shortcut tag failed', lnk, e.message); }
  }
}

let win = null, tray = null, store = null, quitting = false;
let config = {};
let currentEditionId = null;
let pdfTimer = null, notifyTimer = null, lockTimer = null;

function log(...a) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'log.txt'), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (_) {}
}

// ---------- config ----------
function configFile() { return path.join(app.getPath('userData'), 'config.json'); }
function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch (_) { config = {}; }
  if (argVal('--data')) config.dataDir = path.resolve(argVal('--data'));
}
function saveConfig() { if (!TEST || argVal('--userdata')) atomicWrite(configFile(), JSON.stringify(config, null, 1)); }


function defaultDataDir() {
  const dbx = require('./store.js').detectDropboxRoot(os.homedir());
  const act = dbx && path.join(dbx, 'ACTIVITIES');
  const bases = [act && fs.existsSync(act) ? act : null, dbx, app.getPath('documents')].filter(Boolean);
  for (const b of bases) { const old = path.join(b, LEGACY.name + ' Data'); if (fs.existsSync(path.join(old, 'editions'))) return old; }
  return path.join(bases[0], NAME + ' Data');
}

async function ensureDataDir() {
  if (!config.dataDir) {
    const def = defaultDataDir();
    const r = await dialog.showMessageBox({
      type: 'question', title: NAME, message: 'Where should ' + NAME + ' keep its data?',
      detail: 'Suggested:\n' + def + '\n\nA synced folder (Dropbox, OneDrive) keeps the tree on all your PCs and adds version history.',
      buttons: ['Use suggested folder', 'Choose another folder…', 'Quit'], defaultId: 0, cancelId: 2,
    });
    if (r.response === 2) { app.exit(0); return false; }
    if (r.response === 1) {
      const p = await dialog.showOpenDialog({ title: 'Data folder for ' + NAME, properties: ['openDirectory', 'createDirectory'] });
      if (p.canceled || !p.filePaths[0]) { app.exit(0); return false; }
      config.dataDir = p.filePaths[0];
    } else config.dataDir = def;
    saveConfig();
  }
  store = new Store(config.dataDir, path.join(app.getPath('userData'), 'mirror'), log);
  store.init();
  return true;
}

// ---------- one-time move from "One Todo Tree" ----------
function legacyUserData() { return argVal('--legacy-userdata') || path.join(app.getPath('appData'), LEGACY.name); }
/** Before loadConfig: copy the old settings (data folder, view, theme, window) if this name has none yet. */
function migrateLegacySettings() {
  if (APP_ID === LEGACY.appId || (TEST && !argVal('--legacy-userdata'))) return;
  const oldDir = legacyUserData(), newDir = app.getPath('userData');
  if (fs.existsSync(configFile()) || !fs.existsSync(path.join(oldDir, 'config.json'))) return;
  try {
    fs.mkdirSync(newDir, { recursive: true });
    for (const f of ['config.json', 'window.json', 'notified.json']) {
      if (fs.existsSync(path.join(oldDir, f))) fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
    }
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    c.migratedFrom = LEGACY.name; c.legacyStartupPending = true;
    atomicWrite(configFile(), JSON.stringify(c, null, 1));
    log('settings moved over from', oldDir);
  } catch (e) { log('settings move failed', e.message); }
}
/** After the data folder is open: replace the old autostart entry and morning task with ones under the new name. */
async function moveLegacyStartup() {
  if (TEST || !config.legacyStartupPending) return;
  const run = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const sh = (cmd, args) => new Promise(res => execFile(cmd, args, (err, so) => res(err ? null : String(so))));
  const hadAutostart = (await sh('reg', ['query', run, '/v', LEGACY.appId])) != null;
  const hadMorning = (await sh('schtasks', ['/Query', '/TN', LEGACY.name + ' morning summary'])) != null;
  if (hadAutostart) { setAutostart(true); await sh('reg', ['delete', run, '/v', LEGACY.appId, '/f']); }
  if (hadMorning) { await setMorningTask(true, config.morningTime || '08:00'); await sh('schtasks', ['/Delete', '/TN', LEGACY.name + ' morning summary', '/F']); }
  config.autostartDefaulted = true; config.morningDefaulted = true;
  delete config.legacyStartupPending; saveConfig();
  log('startup moved over', 'autostart=' + hadAutostart, 'morning=' + hadMorning);
}

// ---------- self-update (installed copy) ----------
let pendingInstaller = null;
function installedCopy() { return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE; }
function isNewer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
async function checkForUpdate() {
  if (pendingInstaller || quitting) return;
  try {
    const { net } = require('electron');
    const r = await net.fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) { log('update check', r.status); return; }
    const info = await r.json();
    if (!info || !info.version || !isNewer(info.version, app.getVersion())) return;
    if (!installedCopy() || !info.setup || !info.setup.url) {
      // portable copy: it cannot replace itself, so point to the download page
      if (win && !win.isDestroyed()) win.webContents.send('app:update', { version: info.version, download: info.page || DOWNLOAD_PAGE });
      return;
    }
    const res = await net.fetch(info.setup.url);
    if (!res.ok) { log('update download', res.status); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha512').update(buf).digest('base64');
    if (info.setup.sha512 && sha !== info.setup.sha512) { log('update rejected: checksum differs'); return; }
    const exe = path.join(app.getPath('temp'), 'DTUPlanner-' + info.version + '-setup.exe');
    fs.writeFileSync(exe, buf);
    pendingInstaller = { exe, version: info.version };
    log('update ready', info.version);
    if (win && !win.isDestroyed()) win.webContents.send('app:update', { version: info.version });
  } catch (e) { log('update check failed', e.message); }
}

// ---------- window ----------
function boundsFile() { return path.join(app.getPath('userData'), 'window.json'); }
function createWindow(show) {
  let b = { width: 1440, height: 900 };
  try { b = Object.assign(b, JSON.parse(fs.readFileSync(boundsFile(), 'utf8'))); } catch (_) {}
  // keep the window on a visible display
  const visible = screen.getAllDisplays().some(d => b.x == null || (b.x < d.bounds.x + d.bounds.width - 100 && b.x + b.width > d.bounds.x + 100 && b.y >= d.bounds.y - 10 && b.y < d.bounds.y + d.bounds.height - 100));
  if (!visible) { delete b.x; delete b.y; }
  if (TEST) b = { x: -20000, y: 0, width: +(argVal('--w') || 1440), height: +(argVal('--h') || 900) };
  win = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 560, show: false, icon: process.platform === 'win32' && fs.existsSync(ICON_ICO) ? ICON_ICO : ICON,
    title: NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#f5f6f8',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (b.maximized) win.maximize();
  if (process.platform === 'win32') {
    // taskbar button: our icon and identity, also when running from source via electron.exe
    try {
      win.setAppDetails({
        appId: APP_ID, appIconPath: ICON_ICO, appIconIndex: 0,
        relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${ROOT}"`,
        relaunchDisplayName: NAME,
      });
    } catch (e) { log('setAppDetails', e.message); }
  }
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) { win.show(); win.focus(); } });
  const saveBounds = () => { if (TEST) return; try { if (!win.isMinimized()) atomicWrite(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch (_) {} };
  win.on('resize', debounce(saveBounds, 500));
  win.on('move', debounce(saveBounds, 500));
  win.on('close', (e) => {
    if (!quitting && !TEST) { e.preventDefault(); flushRenderer().then(() => win.hide()); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { safeOpenExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); safeOpenExternal(url); } });
}

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#1d2025' : '#ffffff', symbolColor: dark ? '#d8dbe0' : '#3a3f47', height: 44 };
}

function showWindow() {
  if (!win) createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function flushRenderer() {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    const t = setTimeout(resolve, 4000);
    ipcMain.once('app:flushed', () => { clearTimeout(t); resolve(); });
    win.webContents.send('app:flush');
  });
}

// ---------- tray / login / hotkey ----------
function createTray() {
  let img = nativeImage.createFromPath(fs.existsSync(TRAY_ICON) ? TRAY_ICON : ICON);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip(NAME);
  tray.on('click', () => { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWindow(); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ' + NAME, click: showWindow },
    { label: 'What is due?', click: () => morningSummary(true) },
    { label: 'Restart', click: restartApp },
    { type: 'separator' },
    { label: 'Quit', click: quit },
  ]));
}

function registerHotkey() {
  const key = config.hotkey || 'Control+Alt+T';
  try {
    globalShortcut.unregisterAll();
    if (!globalShortcut.register(key, () => { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWindow(); })) log('hotkey taken', key);
  } catch (e) { log('hotkey failed', e.message); }
}

function loginArgs() {
  // packaged: exe itself; dev: electron.exe + app folder
  return app.isPackaged ? { path: process.execPath, args: ['--hidden'] } : { path: process.execPath, args: [ROOT, '--hidden'] };
}
function setAutostart(on) {
  const a = loginArgs();
  app.setLoginItemSettings({ openAtLogin: !!on, path: a.path, args: a.args });
}
function getAutostart() { const a = loginArgs(); return app.getLoginItemSettings({ path: a.path, args: a.args }).openAtLogin; }

const TASK_NAME = NAME + ' morning summary';
function setMorningTask(on, time) {
  return new Promise((resolve) => {
    if (!on) { execFile('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], () => resolve({ ok: true })); return; }
    const exe = process.execPath;
    const tr = app.isPackaged ? `"${exe}" --morning` : `"${exe}" "${ROOT}" --morning`;
    execFile('schtasks', ['/Create', '/SC', 'DAILY', '/TN', TASK_NAME, '/TR', tr, '/ST', time || '08:00', '/F'], (err, so, se) => resolve(err ? { ok: false, error: String(se || err.message) } : { ok: true }));
  });
}
function getMorningTask() {
  return new Promise((resolve) => execFile('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST'], (err, so) => {
    if (err) return resolve({ on: false });
    const m = /(Next Run Time|Næste kørselstidspunkt)[^:]*:\s*(.*)/i.exec(so);
    resolve({ on: true, next: m ? m[2].trim() : '' });
  }));
}

// ---------- notifications ----------
function newestEditionId() { const l = store.listEditions(); return l.length ? l[0].id : null; }

function notifyStateFile() { return path.join(app.getPath('userData'), 'notified.json'); }
function checkNotifications(silentSeed) {
  try {
    const id = newestEditionId();
    if (!id) return;
    const ed = JSON.parse(fs.readFileSync(store.edFile(id), 'utf8'));
    M.validate(ed);
    const items = M.dueItems(ed, store.readSettings());
    let state = {};
    try { state = JSON.parse(fs.readFileSync(notifyStateFile(), 'utf8')); } catch (_) { silentSeed = true; }
    const fresh = [];
    const nextState = {};
    for (const it of items) {
      const key = it.id + (it.step ? ':' + it.step : '') + '|' + it.deadline + '|' + (it.overdue ? 'over' : 'u' + it.urg);
      nextState[key] = state[key] || new Date().toISOString();
      if (!state[key]) fresh.push(it);
    }
    atomicWrite(notifyStateFile(), JSON.stringify(nextState));
    if (silentSeed || !Notification.isSupported()) return;
    if (fresh.length === 1) {
      const it = fresh[0];
      toast(it.overdue ? 'Overdue: ' + it.title : it.now ? 'Now: ' + it.title : (it.urg >= 3 ? (it.range ? 'Starts very soon: ' : 'Due very soon: ') : 'Coming up: ') + it.title, it.path.slice(0, -1).join(' › ') + '\n' + dueText(it), it.id, id);
    } else if (fresh.length > 1) {
      toast(fresh.length + ' items became more urgent', fresh.slice(0, 4).map(it => '• ' + it.title + ' — ' + dueText(it)).join('\n'), fresh[0].id, id);
    }
  } catch (e) { log('notify failed', e.message); }
}

function dueText(it) {
  if (it.range) {
    if (it.now) return 'happening now (until ' + it.end + ')';
    return (it.days === 0 ? 'starts today' : it.days === 1 ? 'starts tomorrow' : 'starts in ' + it.days + ' days') + ' (' + it.deadline + ' – ' + it.end + ')';
  }
  if (it.days < 0) return (-it.days) + ' day' + (it.days === -1 ? '' : 's') + ' overdue';
  if (it.days === 0) return 'due today';
  if (it.days === 1) return 'due tomorrow';
  return 'due in ' + it.days + ' days (' + it.deadline + ')';
}

function toast(title, body, nodeId, edId) {
  const n = new Notification({ title, body, icon: ICON, silent: false });
  n.on('click', () => { showWindow(); if (nodeId && win) win.webContents.send('app:select', { edition: edId, node: nodeId }); });
  n.show();
}

function morningSummary(fromTray) {
  try {
    const id = newestEditionId();
    if (!id) return;
    const ed = JSON.parse(fs.readFileSync(store.edFile(id), 'utf8'));
    M.validate(ed);
    const items = M.dueItems(ed, store.readSettings());
    const over = items.filter(i => i.overdue), week = items.filter(i => !i.overdue && i.days <= 7);
    if (!over.length && !week.length) { toast(NAME, 'Nothing overdue and nothing due within 7 days.', null, id); return; }
    const head = [over.length ? over.length + ' overdue' : null, week.length ? week.length + ' due this week' : null].filter(Boolean).join(', ');
    toast('Good morning — ' + head, [...over, ...week].slice(0, 5).map(it => '• ' + it.title + ' — ' + dueText(it)).join('\n'), (over[0] || week[0]).id, id);
  } catch (e) { log('morning failed', e.message); }
}

// ---------- phone PDF ----------
function schedulePdf(delay) {
  clearTimeout(pdfTimer);
  pdfTimer = setTimeout(() => phone.writePdf(store, log).catch(e => log('pdf failed', e.message)), delay == null ? 20000 : delay);
}

// ---------- IPC ----------
function setupIpc() {
  const h = (name, fn) => ipcMain.handle(name, async (_e, ...a) => {
    try { return await fn(...a); } catch (e) { log('ipc', name, e.stack || e.message); return { error: e.message }; }
  });
  h('boot', () => ({
    dataDir: config.dataDir, dropboxRoot: store.dropboxRoot, machine: store.machine,
    settings: store.readSettings(), people: store.readPeople(), editions: store.listEditions(),
    conflicts: store.listEditions().conflicts || [],
    lastEdition: config.lastEdition, ui: config.ui || {}, version: app.getVersion(), appName: NAME, test: TEST,
    dark: nativeTheme.shouldUseDarkColors, themeSource: config.theme || 'system',
  }));
  h('editions:list', () => store.listEditions());
  h('edition:load', (id) => {
    if (currentEditionId && currentEditionId !== id) store.releaseLock(currentEditionId);
    const r = store.loadEdition(id);
    currentEditionId = id;
    config.lastEdition = id; saveConfig();
    store.touchLock(id);
    return r;
  });
  h('edition:save', (ed, opts) => {
    const r = store.saveEdition(ed, opts || {});
    if (r.ok) { schedulePdf(); clearTimeout(notifyTimer); notifyTimer = setTimeout(() => checkNotifications(false), 5000); }
    return r;
  });
  h('edition:create', (ed) => {
    if (fs.existsSync(store.edFile(ed.id))) return { error: 'An edition called "' + ed.id + '" already exists.' };
    const r = store.saveEdition(ed, { force: true, journal: true, reason: 'created' });
    return r;
  });
  h('edition:check', (id) => ({ changed: store.changedOnDisk(id), lock: store.checkLock(id) }));
  h('edition:journalTheirs', (id, theirs) => { store.journalObject(id, theirs, 'other-machine'); return { ok: true }; });
  h('edition:journalNow', (ed, reason) => { store.journalObject(ed.id, ed, reason || 'manual'); return { ok: true }; });
  h('backups:list', (id) => store.listBackups(id));
  h('backups:read', (file) => store.readBackup(file));
  h('people:save', (d, opts) => store.savePeople(d, opts || {}));
  h('people:load', () => store.readPeople());
  h('settings:save', (s) => { const r = store.saveSettings(s); schedulePdf(2000); return r; });
  h('ui:save', (ui) => { config.ui = ui; saveConfig(); return { ok: true }; });
  h('theme:set', (t) => { config.theme = t; saveConfig(); nativeTheme.themeSource = t; return { dark: nativeTheme.shouldUseDarkColors }; });
  h('attach', (paths, copy, ctx) => store.attach(paths, copy, ctx));
  h('attach:status', (recs) => recs.map(r => { const p = store.resolve(r); return { id: r.id, path: p, exists: !!(p && fs.existsSync(p)) }; }));
  h('attach:open', async (rec) => {
    if (rec.kind === 'url') return safeOpenExternal(rec.url) ? { ok: true } : { error: 'Blocked URL' };
    const p = store.resolve(rec);
    if (!p || !fs.existsSync(p)) return { error: 'File not found: ' + (p || rec.name) };
    const err = await shell.openPath(p);
    return err ? { error: err } : { ok: true };
  });
  h('attach:reveal', (rec) => { const p = store.resolve(rec); if (p && fs.existsSync(p)) shell.showItemInFolder(p); return { ok: true }; });
  h('attach:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  h('data:open', () => { shell.openPath(config.dataDir); return { ok: true }; });
  h('data:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Data folder for ' + NAME, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    config.dataDir = r.filePaths[0]; saveConfig();
    app.relaunch(); quit();
    return { ok: true };
  });
  h('pdf:now', async () => { await phone.writePdf(store, log); return { ok: true, file: phone.pdfPath(store) }; });
  h('pdf:open', () => { shell.openPath(phone.pdfPath(store)); return { ok: true }; });
  // calendar print: the renderer sends a complete page; it becomes a landscape PDF in <data>/calendar/
  h('cal:pdf', async (html, opts) => {
    let w = null;
    const tmp = path.join(require('os').tmpdir(), 'ott-cal-' + process.pid + '.html');
    try {
      fs.writeFileSync(tmp, String(html), 'utf8');
      w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
      await w.loadFile(tmp);
      const pdf = await w.webContents.printToPDF({ landscape: true, pageSize: opts && opts.size === 'A4' ? 'A4' : 'A3', printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
      const name = String((opts && opts.name) || 'Calendar.pdf').replace(/[\\/:*?"<>|]/g, '-');
      const file = store.p('calendar', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWrite(file, pdf);
      if (!TEST) shell.openPath(file);
      return { ok: true, file };
    } catch (e) {
      log('calendar pdf failed', e.stack || e.message);
      return { ok: false, error: e.message };
    } finally {
      if (w && !w.isDestroyed()) w.destroy();
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  });
  h('sys:get', async () => ({ autostart: getAutostart(), morning: await getMorningTask(), hotkey: config.hotkey || 'Control+Alt+T', morningTime: config.morningTime || '08:00' }));
  h('sys:autostart', (on) => { setAutostart(on); return { ok: true, autostart: getAutostart() }; });
  h('sys:morning', async (on, time) => { config.morningTime = time || '08:00'; saveConfig(); return setMorningTask(on, time); });
  h('sys:testToast', () => { morningSummary(true); return { ok: true }; });
  h('app:quit', () => { quit(); return { ok: true }; });
  h('app:restart', () => { restartApp(); return { ok: true }; });
  // whole-data backup as one JSON file. In test mode the file path is passed in (no dialogs).
  const backupMeta = () => ({ app: NAME, version: app.getVersion() });
  let pendingImport = null;
  h('backup:export', async (file) => {
    if (!(TEST && file)) {
      const def = path.join(config.exportDir && fs.existsSync(config.exportDir) ? config.exportDir : app.getPath('documents'), NAME.replace(/\s+/g, '') + '-backup-' + M.todayStr() + '.json');
      const r = await dialog.showSaveDialog(win, { title: 'Export backup', defaultPath: def, filters: [{ name: 'Backup (JSON)', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return { canceled: true };
      file = r.filePath;
      config.exportDir = path.dirname(file); saveConfig();
    }
    const data = store.buildBackup(backupMeta());
    atomicWrite(file, JSON.stringify(data, null, 1));
    const eds = Object.values(data.editions);
    return { ok: true, file, editions: eds.length, nodes: eds.reduce((s, e) => s + Object.keys(e.nodes || {}).length, 0), people: Object.keys(data.people.people || {}).length, templates: data.templates.length, notes: data.notes, size: fs.statSync(file).size };
  });
  h('backup:pick', async (file) => {
    if (!(TEST && file)) {
      const r = await dialog.showOpenDialog(win, { title: 'Import backup', defaultPath: config.exportDir && fs.existsSync(config.exportDir) ? config.exportDir : app.getPath('documents'), properties: ['openFile'], filters: [{ name: 'Backup or edition', extensions: ['json', 'gz'] }, { name: 'All files', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      file = r.filePaths[0];
    }
    const pkg = store.readImport(file);
    pendingImport = pkg;
    const cur = new Map(store.listEditions().map(e => [e.id, e]));
    return {
      file, name: path.basename(file), type: pkg.type, created: pkg.created || null, machine: pkg.machine || null, app: pkg.app || null, version: pkg.version || null,
      editions: Object.entries(pkg.editions).map(([id, ed]) => ({ id, title: ed.title || id, count: Object.keys(ed.nodes).length, modified: ed.modified || null, exists: cur.has(id), curCount: cur.has(id) ? cur.get(id).count : 0, curModified: cur.has(id) ? cur.get(id).modified : null }))
        .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })),
      people: pkg.people ? Object.keys(pkg.people.people).length : null,
      categories: pkg.settings ? pkg.settings.categories.filter(c => !c.archived).map(c => c.name) : null,
      templates: Array.isArray(pkg.templates) ? pkg.templates.length : 0,
      notes: pkg.notes || [],
    };
  });
  h('backup:apply', (choice) => {
    if (!pendingImport) return { error: 'Nothing to import — pick the file again.' };
    const r = store.applyImport(pendingImport, choice || {}, backupMeta());
    pendingImport = null;
    if (choice && choice.open && r.editions.includes(choice.open)) { config.lastEdition = choice.open; saveConfig(); }
    schedulePdf(2000);
    return r;
  });
  h('backup:reveal', (file) => { if (file && fs.existsSync(file)) shell.showItemInFolder(file); return { ok: true }; });
  h('templates:list', () => store.listTemplates());
  h('templates:save', (tpl) => store.saveTemplate(tpl));
  h('templates:delete', (file) => store.deleteTemplate(file));
  h('clip:read', () => clipboard.readText());
  h('clip:write', (text) => { clipboard.writeText(String(text)); return { ok: true }; });

  ipcMain.on('app:titlebar', (_e, colors) => { try { win && win.setTitleBarOverlay(colors); } catch (_) {} });
}

function safeOpenExternal(url) {
  if (/^(https?:|mailto:)/i.test(url)) { shell.openExternal(url); return true; }
  return false;
}

// ---------- newer source available (running from source only) ----------
function watchForUpdates() {
  if (app.isPackaged || TEST) return;
  let timer = null, told = false;
  const onChange = (ev, file) => {
    if (told || !file || !/\.(js|css|html)$/.test(String(file))) return;
    clearTimeout(timer);
    timer = setTimeout(() => { told = true; if (win && !win.isDestroyed()) win.webContents.send('app:update'); log('newer source detected', file); }, 3000);
  };
  for (const d of ['main', 'renderer', 'shared']) {
    try { fs.watch(path.join(ROOT, d), { recursive: true }, onChange); } catch (e) { log('watch failed', d, e.message); }
  }
}
function restartApp() {
  if (quitting) return;
  quitting = true;
  flushRenderer().then(() => {
    try { if (currentEditionId) store.releaseLock(currentEditionId); } catch (_) {}
    if (pendingInstaller) {
      // silent per-user install over this copy; --force-run starts the new version when it is done
      try {
        // (test mode: no --force-run, so the new version does not start against real settings)
        require('child_process').spawn(pendingInstaller.exe, TEST ? ['/S'] : ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        log('installing', pendingInstaller.version);
        app.exit(0);
        return;
      } catch (e) { log('installer failed to start', e.message); }
    }
    app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--hidden') });
    app.exit(0);
  });
}

// ---------- lifecycle ----------
function quit() {
  if (quitting) return;
  quitting = true;
  flushRenderer().then(async () => {
    try { if (currentEditionId) store.releaseLock(currentEditionId); } catch (_) {}
    try { await phone.writePdf(store, log); } catch (_) {}
    app.exit(0);
  });
}

// British/Danish conventions in Chromium widgets: DD/MM dates, weeks starting on Monday
app.commandLine.appendSwitch('lang', 'en-GB');

if (!TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, args) => {
    if (args.includes('--morning')) morningSummary(false);
    else showWindow();
  });

  app.whenReady().then(async () => {
    migrateLegacySettings();
    loadConfig();
    Menu.setApplicationMenu(null);   // no default menu: Ctrl+R (reload) / Ctrl+W (close) cannot fire by accident
    nativeTheme.themeSource = config.theme || 'system';
    nativeTheme.on('updated', () => { if (win) { try { win.setTitleBarOverlay(overlayColors()); } catch (_) {} win.webContents.send('app:theme', nativeTheme.shouldUseDarkColors); } });
    if (!(await ensureDataDir())) return;
    setupIpc();
    const morningOnly = flag('--morning');
    if (morningOnly) {
      // launched by Task Scheduler while the app was not running: toast, then stay in tray
      morningSummary(false);
    }
    if (!TEST) {
      tagShortcuts();
      watchForUpdates();
      moveLegacyStartup().catch(e => log('startup move failed', e.message));
      if (app.isPackaged) { setTimeout(checkForUpdate, 20 * 1000); setInterval(checkForUpdate, 6 * 60 * 60 * 1000); }
      createTray();
      registerHotkey();
      if (config.autostartDefaulted !== true) { setAutostart(true); config.autostartDefaulted = true; saveConfig(); }
      if (config.morningDefaulted !== true) { setMorningTask(true, config.morningTime || '08:00').then(r => log('morning task', JSON.stringify(r))); config.morningDefaulted = true; saveConfig(); }
      checkNotifications(false);
      setInterval(() => checkNotifications(false), 60 * 60 * 1000);
      lockTimer = setInterval(() => { if (currentEditionId) store.touchLock(currentEditionId); }, 60 * 1000);
    }
    if (TEST && argVal('--update-url')) setTimeout(checkForUpdate, 2000);   // update test: isolated, see README
    createWindow(!(flag('--hidden') || morningOnly));
    schedulePdf(8000);
    if (TEST) require('./testdriver.js').run({ app, win: () => win, argv, log, store });
  });

  app.on('window-all-closed', () => { if (TEST) app.exit(0); });
  app.on('before-quit', (e) => { if (!quitting) { e.preventDefault(); quit(); } });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
