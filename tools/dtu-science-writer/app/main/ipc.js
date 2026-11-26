/* IPC handlers: everything the renderer asks of the main process (see preload.js for the other side). */
'use strict';
const { app, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ctx = require('./context.js');
const { atomicWrite, writeError } = require('./storage.js');
const { buildMenu } = require('./menu.js');
const docs = require('./docs.js');
const refs = require('./refs.js');
const csl = require('./csl.js');
const zweb = require('./zotero.js');

/* Every call is checked to come from our own page in our own window (guard.js). */
const refuse = (what) => { const e = new Error(what + ' is not allowed: the program only reads and writes files you chose yourself.'); e.code = 'NOT_ALLOWED'; return e; };
const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!ctx.guard.trustedSender(e, ctx.win)) throw refuse('This call'); return fn(...a); });
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (ctx.guard.trustedSender(e, ctx.win)) fn(e, ...a); });

function registerIpc() {
  const win = () => ctx.win;

  /* window and lifecycle */
  // lastPath: the most recent document that still exists, reopened when the app starts without a file (not in tests)
  h('boot', () => ({ version: app.getVersion(), test: ctx.TEST, openPath: ctx.win && ctx.win.__openPath,
    lastPath: ctx.TEST ? null : ctx.guard.allowOpen(lastDocument()) }));
  on('title', (_e, t) => { if (win()) win().setTitle(t); });
  on('dirty', (_e, d) => { ctx.dirty = !!d; if (win()) win().setDocumentEdited(ctx.dirty); });
  on('view:state', (_e, s) => {                          // keep the View menu ticks in step with the page
    const m = Menu.getApplicationMenu(), it = m && m.getMenuItemById('preview');
    if (it && s && typeof s.preview === 'boolean') it.checked = s.preview;
    for (const k of ['comments', 'showResolved']) { const it2 = m && m.getMenuItemById(k); if (it2 && s && typeof s[k] === 'boolean') it2.checked = s[k]; }
    const pb = m && m.getMenuItemById('pageBreaks');
    if (pb && s && typeof s.pageBreaks === 'boolean') pb.checked = s.pageBreaks;
    const tk = m && m.getMenuItemById('tracking');
    if (tk && s && typeof s.tracking === 'boolean') tk.checked = s.tracking;
    const mk = m && s && s.markup && m.getMenuItemById('markup-' + s.markup);
    if (mk) mk.checked = true;
  });
  on('close-answer', (_e, ok) => { if (ok && win()) { ctx.forceClose = true; win().close(); } });
  on('app:restart', () => { ctx.forceClose = true; ctx.updater.restart(); });   // update bar: Restart now
  h('app:checkUpdate', () => ctx.updater.check());

  /* user settings (name and initials for comments, changes and locks) */
  h('settings', (op, data) => {
    if (op === 'set') { ctx.config.user = { ...ctx.config.user, ...data }; ctx.saveConfig(); }
    return { ...ctx.config.user, suggestedName: ctx.config.user.name ? undefined : os.userInfo().username };
  });

  /* recent files */
  // the document that was open when the app last closed (main.js), if it still exists; older settings files: the newest recent one
  function lastDocument() {
    const exists = (p) => { try { return !!p && fs.existsSync(p); } catch (_) { return false; } };
    if ('lastDoc' in ctx.config) return exists(ctx.config.lastDoc) ? ctx.config.lastDoc : null;
    return (ctx.config.recent || []).find(exists) || null;
  }
  on('recent:add', (_e, p) => {
    if (!ctx.guard.canOpen(p) && !ctx.guard.canSaveDoc(p)) return;        // only documents the user opened or saved
    ctx.config.recent = [p, ...(ctx.config.recent || []).filter(x => x !== p)].slice(0, 12);
    ctx.saveConfig(); buildMenu();
    ctx.log('document', p);          // opened or saved: the one reopened at the next start
  });

  /* dialogs */
  h('dialog:open', async () => {
    const r = await dialog.showOpenDialog(win(), { filters: [{ name: ctx.NAME + ' document', extensions: [ctx.EXT] }], properties: ['openFile'] });
    return r.canceled ? null : ctx.guard.allowOpen(r.filePaths[0]);
  });
  h('dialog:save', async ({ defaultName, kind }) => {
    const filters = { dtusw: [{ name: ctx.NAME + ' document', extensions: [ctx.EXT] }], pdf: [{ name: 'PDF', extensions: ['pdf'] }], docx: [{ name: 'Word document', extensions: ['docx'] }], bib: [{ name: 'BibTeX', extensions: ['bib'] }], zip: [{ name: 'LaTeX for Overleaf (zip)', extensions: ['zip'] }] }[kind];
    const r = await dialog.showSaveDialog(win(), { defaultPath: defaultName, filters });
    return r.canceled ? null : ctx.guard.allowWrite(r.filePath);
  });
  h('dialog:word', async () => {
    const r = await dialog.showOpenDialog(win(), { filters: [{ name: 'Word document', extensions: ['docx'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    return { name: path.basename(r.filePaths[0]), bytes: new Uint8Array(fs.readFileSync(r.filePaths[0])) };
  });
  h('dialog:image', async () => {
    const r = await dialog.showOpenDialog(win(), { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    const p = r.filePaths[0];
    return { name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
  });

  /* files */
  h('file:read', (p) => { if (!ctx.guard.canReadAny()) throw refuse('Reading this file'); return new Uint8Array(fs.readFileSync(p)); });
  h('file:write', (p, bytes) => {
    if (!ctx.guard.canExport(p)) return { error: 'the program only writes to a file you chose in a save dialog' };
    try { atomicWrite(p, Buffer.from(bytes)); return { ok: true }; } catch (e) { return { error: writeError(e) }; }
  });

  /* the open document: lock, checksum, conflict copies, backups, recovery (docs.js) */
  h('doc:open', (p) => { if (!ctx.guard.canOpen(p)) throw refuse('Opening this file'); return docs.open(p); });
  h('doc:save', (p, bytes) => (ctx.guard.canSaveDoc(p) ? docs.save(p, bytes) : { error: 'choose where to save with Save as' }));
  h('doc:close', () => docs.close());
  h('doc:recheck', () => docs.recheck());
  h('comments:shared', (op, p, a) => {
    if (!ctx.guard.isCurrent(p)) return op === 'list' ? [] : { error: 'not the open document' };
    if (op === 'append') return docs.sideAppend(p, a);
    if (op === 'list') return docs.sideList(p);
    if (op === 'clear') return docs.sideClear(p, a);
    return null;
  });
  h('backups:list', (p) => (ctx.guard.isCurrent(p) || ctx.guard.canOpen(p) ? docs.listBackups(p) : []));
  // a backup is read only from the program's own backup folder
  h('backups:read', (f) => { if (!docs.isBackupFile(f)) throw refuse('Reading this file'); return docs.readBackup(f); });
  h('recovery', (op, a, b) => {
    if (op === 'write') return docs.recoveryWrite(a, b);
    if (op === 'clear') return docs.recoveryClear();
    if (op === 'list') return docs.recoveryList();
    if ((op === 'read' || op === 'discard') && !/^[A-Za-z0-9_-]{1,80}$/.test(String(a))) throw refuse('This recovery file');
    if (op === 'read') return docs.recoveryRead(a);
    if (op === 'discard') return docs.recoveryDiscard(a);
    return null;
  });

  /* layout engine */
  h('typst:compile', (req) => {
    if (req && req.format === 'pdf' && !ctx.guard.canExport(req.out)) return { error: 'the program only writes to a file you chose in a save dialog' };
    return ctx.typst.compile(req);
  });

  /* affiliation library: settings folder, plus export/import of a shareable JSON file */
  /* spell-check language of the open document (style lang); only languages Chromium has a dictionary for */
  on('spell:lang', (_e, code) => {
    const ses = win() && win().webContents.session;
    if (!ses) return;
    const have = ses.availableSpellCheckerLanguages || [];
    const pick = [code, code.slice(0, 2)].find(c => have.includes(c));
    if (pick) ses.setSpellCheckerLanguages([pick]);
  });

  /* references: DOI/arXiv lookup, Zotero search, BibTeX files (refs.js) */
  h('refs', (op, q) => {
    if (op === 'lookup') return refs.lookup(q);
    if (op === 'zotero') return refs.zotero(q);
    if (op === 'match') return refs.match(q);
    if (op === 'matchText') return refs.matchText(q);
    // the Zotero web library (main/zotero.js): key, add items, update an item
    if (op === 'zoteroStatus') return zweb.status();
    if (op === 'zoteroSetKey') return zweb.setKey(q);
    if (op === 'zoteroClearKey') return zweb.clearKey();
    if (op === 'zoteroAdd') return zweb.add(q.items, q.collection).catch(e => ({ error: e.message }));
    if (op === 'zoteroUpdate') return zweb.update(q.key, q.csl, q.abbreviation).catch(e => ({ error: e.message }));
    if (op === 'bibtex') return refs.pickBibtex();
    // reference styles from the CSL repository, or a .csl file (csl.js)
    if (op === 'cslSearch') return csl.search(q);
    if (op === 'cslFetch') return csl.fetchStyle(q);
    if (op === 'cslPick') return csl.pick(q);
    return null;
  });

  h('affil:library', async (op, data) => {
    const file = path.join(app.getPath('userData'), 'affiliations.json');
    const jsonFilter = [{ name: 'Affiliation library', extensions: ['json'] }];
    if (op === 'load') { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; } }
    if (op === 'save') { atomicWrite(file, Buffer.from(JSON.stringify(data, null, 1))); return true; }
    if (op === 'export') {
      const r = await dialog.showSaveDialog(win(), { defaultPath: 'affiliations.json', filters: jsonFilter });
      if (r.canceled) return false;
      atomicWrite(r.filePath, Buffer.from(JSON.stringify(data, null, 1))); return true;
    }
    if (op === 'import') {
      const r = await dialog.showOpenDialog(win(), { filters: jsonFilter, properties: ['openFile'] });
      if (r.canceled) return null;
      try { const v = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); return Array.isArray(v) ? v.filter(a => a && typeof a === 'object') : null; } catch (_) { return null; }
    }
    return null;
  });
}

module.exports = { registerIpc };
