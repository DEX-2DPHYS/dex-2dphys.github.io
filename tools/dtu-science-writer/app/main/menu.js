/* Application menu. Items send command names to the renderer (ui/toolbar.js registers them). */
'use strict';
const { app, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ctx = require('./context.js');
const { DOWNLOAD_PAGE } = require('./update.js');

function buildMenu() {
  const send = ctx.send;
  const recent = (ctx.config.recent || []).filter(p => fs.existsSync(p)).slice(0, 10);
  const tpl = [
    { label: '&File', submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Open recent', enabled: recent.length > 0, submenu: recent.map(p => ({ label: p, click: () => ctx.win && ctx.win.webContents.send('open-path', p) })) },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Save as…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
      { label: 'Backups of this document…', click: send('backups') },
      { type: 'separator' },
      { label: 'Export PDF…', accelerator: 'CmdOrCtrl+E', click: send('exportPdf') },
      { label: 'Export Word document…', accelerator: 'CmdOrCtrl+Shift+E', click: send('exportDocx') },
      { label: 'Export LaTeX (for Overleaf)…', click: send('exportLatex') },
      { type: 'separator' },
      { label: 'Import Word document…', click: send('importWord') },
      { label: 'Import Word document as Supporting Information…', click: send('importWordSI') },
      { type: 'separator' },
      { label: 'Settings…', click: send('settings') },
      { type: 'separator' },
      { label: 'Exit', role: 'quit' },
    ] },
    { label: '&Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo'), registerAccelerator: false },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: send('redo'), registerAccelerator: false },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: '&Insert', submenu: [
      { label: 'Math in the text', accelerator: 'CmdOrCtrl+M', click: send('inlineMath'), registerAccelerator: false },
      { label: 'Equation', accelerator: 'CmdOrCtrl+Shift+M', click: send('equation'), registerAccelerator: false },
      { label: 'Figure…', accelerator: 'CmdOrCtrl+Shift+F', click: send('figure') },
      { label: 'Table…', click: send('table') },
      { label: 'Cross-reference…', accelerator: 'CmdOrCtrl+R', click: send('ref'), registerAccelerator: false },
      { type: 'separator' },
      { label: 'Citation…', accelerator: 'CmdOrCtrl+Alt+C', click: send('cite'), registerAccelerator: false },
      { label: 'Reference list', click: send('bibliography') },
      { label: 'Footnote', accelerator: 'CmdOrCtrl+Alt+F', click: send('footnote'), registerAccelerator: false },
      { type: 'separator' },
      { label: 'Table of contents', click: send('toc') },
      { label: 'List of figures', click: send('lof') },
      { label: 'List of tables', click: send('lot') },
      { label: 'Page break', accelerator: 'CmdOrCtrl+Enter', click: send('pageBreak'), registerAccelerator: false },
      { type: 'separator' },
      { label: 'Supporting Information', click: send('supplement') },
      { type: 'separator' },
      // Ctrl+Alt shortcuts are handled in the page (AltGr on Danish keyboards is Ctrl+Alt: AltGr+M types µ)
      { label: 'Comment', accelerator: 'CmdOrCtrl+Alt+M', click: send('comment'), registerAccelerator: false },
    ] },
    { label: 'F&ormat', submenu: [
      { label: 'Document style…', click: send('style') },
      { label: 'Journal style…', click: send('journal') },
      { label: 'Authors and affiliations…', click: send('authors') },
      { label: 'Reference library…', click: send('library') },
      { label: 'Convert typed references…', click: send('convertRefs') },
      { label: 'Add references to Zotero library', click: send('zoteroAddAll') },
      { type: 'separator' },
      { label: 'Appendix starts here (on/off)', click: send('appendix') },
      { label: 'Remove Supporting Information…', click: send('removeSupplement') },
    ] },
    { label: '&Review', submenu: [
      { id: 'tracking', label: 'Track changes', type: 'checkbox', checked: false, accelerator: 'CmdOrCtrl+Shift+T', click: send('track') },
      { type: 'separator' },
      { label: 'Next change', accelerator: 'F7', click: send('nextChange') },
      { label: 'Previous change', accelerator: 'Shift+F7', click: send('prevChange') },
      { label: 'Accept the change at the cursor', click: send('acceptChange') },
      { label: 'Reject the change at the cursor', click: send('rejectChange') },
      { type: 'separator' },
      { label: 'Accept all changes', click: send('acceptAll') },
      { label: 'Reject all changes', click: send('rejectAll') },
      { type: 'separator' },
      { id: 'markup-all', label: 'Show all markup', type: 'radio', checked: true, click: send('markupAll') },
      { id: 'markup-final', label: 'Show the final text', type: 'radio', click: send('markupFinal') },
      { id: 'markup-original', label: 'Show the original text', type: 'radio', click: send('markupOriginal') },
      { type: 'separator' },
      { label: 'Comment', accelerator: 'CmdOrCtrl+Alt+M', click: send('comment'), registerAccelerator: false },
    ] },
    { label: '&View', submenu: [
      { id: 'preview', label: 'Page preview', type: 'checkbox', checked: (ctx.config.user || {}).preview !== false, accelerator: 'F8', click: send('preview'), registerAccelerator: false },
      { id: 'pageBreaks', label: 'Page breaks in the text', type: 'checkbox', checked: !!(ctx.config.user || {}).pageBreaks, click: send('pageBreaks') },
      { id: 'comments', label: 'Comments and changes beside the page', type: 'checkbox', checked: true, click: send('toggleComments') },
      { id: 'showResolved', label: 'Resolved comments', type: 'checkbox', checked: false, click: send('showResolved') },
      { type: 'separator' },
      // page zoom (ui/zoom.js); Ctrl + mouse wheel over the page does the same
      { label: 'Zoom in', click: send('zoomIn') }, { label: 'Zoom out', click: send('zoomOut') },
      { label: 'Actual size (100 %)', accelerator: 'CmdOrCtrl+0', click: send('zoom100'), registerAccelerator: false },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ] },
    { label: '&Help', submenu: [
      { label: 'Guide', accelerator: 'F1', click: send('guide'), registerAccelerator: false },
      { label: 'Tutorial: a paper to practise in', click: send('tutorial') },
      { label: 'Open sample paper', click: send('sample') },
      { type: 'separator' },
      { label: 'Check for updates', click: () => ctx.updater && ctx.updater.check() },
      { label: 'Download page', click: () => { if (ctx.guard.canOpenUrl(DOWNLOAD_PAGE)) shell.openExternal(DOWNLOAD_PAGE); } },
      { label: 'About (version ' + app.getVersion() + ')', enabled: false },
      { label: 'Design notes (DESIGN.md)', click: () => shell.openPath(path.join(ctx.ROOT, 'DESIGN.md')) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

module.exports = { buildMenu };
