'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('ott', {
  boot: inv('boot'),
  listEditions: inv('editions:list'),
  loadEdition: inv('edition:load'),
  saveEdition: inv('edition:save'),
  createEdition: inv('edition:create'),
  checkEdition: inv('edition:check'),
  journalTheirs: inv('edition:journalTheirs'),
  journalNow: inv('edition:journalNow'),
  listBackups: inv('backups:list'),
  readBackup: inv('backups:read'),
  savePeople: inv('people:save'),
  loadPeople: inv('people:load'),
  saveSettings: inv('settings:save'),
  calendarPdf: inv('cal:pdf'),
  saveUi: inv('ui:save'),
  setTheme: inv('theme:set'),
  attach: inv('attach'),
  attachStatus: inv('attach:status'),
  openAttachment: inv('attach:open'),
  revealAttachment: inv('attach:reveal'),
  pickFiles: inv('attach:pick'),
  openDataFolder: inv('data:open'),
  chooseDataFolder: inv('data:choose'),
  pdfNow: inv('pdf:now'),
  pdfOpen: inv('pdf:open'),
  sysGet: inv('sys:get'),
  setAutostart: inv('sys:autostart'),
  setMorning: inv('sys:morning'),
  testToast: inv('sys:testToast'),
  quit: inv('app:quit'),
  restart: inv('app:restart'),
  exportBackup: inv('backup:export'),
  pickImport: inv('backup:pick'),
  applyImport: inv('backup:apply'),
  revealFile: inv('backup:reveal'),
  listTemplates: inv('templates:list'),
  saveTemplate: inv('templates:save'),
  deleteTemplate: inv('templates:delete'),
  clipRead: inv('clip:read'),
  clipWrite: inv('clip:write'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return ''; } },
  setTitlebar: (c) => ipcRenderer.send('app:titlebar', c),
  flushed: () => ipcRenderer.send('app:flushed'),
  on: (ch, fn) => {
    const allowed = ['app:flush', 'app:select', 'app:theme', 'app:update', 'test:run'];
    if (!allowed.includes(ch)) return;
    ipcRenderer.on(ch, (_e, ...a) => fn(...a));
  },
});
