/* Hardening: what the page (the renderer) may ask the main process to do.
   The page is our own code, loaded from disk under a strict Content-Security-Policy — but it shows documents that
   come from other people, so the main process does not take its word for anything that reaches the disk:

   - only our own page may call in (trustedSender), and the window cannot be navigated anywhere else or open others;
   - a file is read or written only where the *user* pointed: a path chosen in an open / save dialog, a document from
     the recent list or the command line, the document that is open, and the files that belong beside it
     (name-SI.pdf next to an exported name.pdf, name.docx next to the open name.dtusw);
   - only the kinds of file the program makes (.dtusw; .pdf .docx .zip .bib for exports);
   - web pages get no permissions (camera, location, …) and links open in the browser only for a short list of sites.

   Tests drive the app through arbitrary temporary paths, so with --test the path rules are off unless a test
   switches them on (setEnforce). The --test switch itself does not exist in an installed copy (context.js). */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const norm = (p) => path.resolve(String(p)).toLowerCase();
const ext = (p) => path.extname(String(p)).slice(1).toLowerCase();
const DOC_EXT = 'dtusw';
const EXPORT_EXT = new Set(['pdf', 'docx', 'zip', 'bib']);
const OPEN_URLS = [/^https:\/\/dex-2dphys\.github\.io\//, /^https:\/\/github\.com\/DEX-2DPHYS\//, /^https:\/\/www\.zotero\.org\/settings\/keys/, /^https:\/\/doi\.org\//];

function createGuard({ test = false, recent = () => [], currentDoc = () => null, page = null } = {}) {
  let enforce = !test;
  const open = new Set(), write = new Set();
  const g = {
    setEnforce(v) { enforce = !!v; },
    enforcing: () => enforce,
    /** The user pointed at this document (dialog, recent list, command line, double-click). */
    allowOpen(p) { if (p) open.add(norm(p)); return p; },
    /** The user chose this path in a save dialog. */
    allowWrite(p) { if (p) { write.add(norm(p)); if (ext(p) === DOC_EXT) open.add(norm(p)); } return p; },
    canOpen(p) {
      if (typeof p !== 'string' || !p || ext(p) !== DOC_EXT) return false;
      if (!enforce) return true;
      const n = norm(p);
      return open.has(n) || recent().some(r => norm(r) === n) || (currentDoc() && norm(currentDoc()) === n);
    },
    canSaveDoc(p) {
      if (typeof p !== 'string' || !p || ext(p) !== DOC_EXT) return false;
      if (!enforce) return true;
      const n = norm(p);
      return write.has(n) || (currentDoc() && norm(currentDoc()) === n);
    },
    /** An export: the chosen file, its "-SI" companion, or the Word copy beside the open document. */
    canExport(p) {
      if (typeof p !== 'string' || !p || !EXPORT_EXT.has(ext(p))) return false;
      if (!enforce) return true;
      const n = norm(p);
      if (write.has(n)) return true;
      const e = path.extname(n);
      const base = n.slice(0, n.length - e.length);
      if (base.endsWith('-si') && write.has(base.slice(0, -3) + e)) return true;
      const cur = currentDoc();
      if (cur && e === '.docx') {
        const c = norm(cur).replace(/\.dtusw$/, '');
        if (base === c || base === c + '-si') return true;
      }
      return false;
    },
    /** Shared comments and backups belong to the open document only. */
    isCurrent(p) { return !enforce || (typeof p === 'string' && !!currentDoc() && norm(p) === norm(currentDoc())); },
    /** Reading any file by path is for tests only (the program itself reads through dialogs and doc:open). */
    canReadAny: () => !enforce,
    /** A link the program itself offers may be opened in the browser. */
    canOpenUrl: (u) => typeof u === 'string' && OPEN_URLS.some(re => re.test(u)),
    /** Is this IPC message from our own page in our own window? */
    trustedSender(event, win) {
      try {
        const f = event.senderFrame;
        if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
        if (!f || f !== win.webContents.mainFrame) return false;
        return !page || String(f.url).split(/[?#]/)[0].toLowerCase() === pathToFileURL(page).href.toLowerCase();
      } catch (_) { return false; }
    },
  };
  return g;
}

/** Lock a window down: no navigation away from our page, no new windows, no web permissions, no <webview>. */
function lockWindow(win, guard, shell) {
  const wc = win.webContents;
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-redirect', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { if (guard.canOpenUrl(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  wc.session.setPermissionCheckHandler(() => false);
}

module.exports = { createGuard, lockWindow };
