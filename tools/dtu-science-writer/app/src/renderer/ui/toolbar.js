/* Commands and their wiring: toolbar buttons (data-cmd), the paragraph-style box, menu items, page shortcuts. */
import { cmd, toggleNumbered } from '../editor/editor.js';
import { mathState } from '../editor/mathview.js';
import { insertFigure } from '../editor/figures.js';
import { openTablePicker } from '../editor/tables.js';
import { app, api, $, registerCommands, runCommand, toast } from '../context.js';
import { newDocument, openDialog, save, confirmDiscard, openPath, loadDocument } from '../doc/files.js';
import { exportPdf, exportDocx, exportLatex } from '../doc/export.js';
import { togglePreview } from '../doc/preview.js';
import { openRefPicker, isRefPickerOpen } from './refpicker.js';
import { openStyleDialog } from './styledialog.js';
import { openAuthorsDialog } from './authorsdialog.js';
import { openSettings } from './settings.js';
import { openBackups } from './restore.js';
import { openCiteDialog } from './citedialog.js';
import { openLibraryDialog } from './librarydialog.js';
import { convertTyped } from './convertrefs.js';
import { importWord } from '../doc/importword.js';
import { openJournalDialog } from './journaldialog.js';
import { addReferencesToZotero } from './librarydialog.js';
import { insertSupplement, removeSupplement, showPart } from './parttabs.js';
import { importWordSI } from '../doc/importword.js';
import { setPageBreaks, pageBreaksOn } from '../editor/pageview.js';
import { schedulePreview } from '../doc/preview.js';
import { openGuide } from './help.js';
import { buildTutorial } from '../tutorial.js';
import { insertBibliography } from '../editor/citations.js';
import { insertFootnote, insertOutline, insertPageBreak, toggleAppendix } from '../editor/structure.js';
import { clearMedia } from '../../core/media.js';
import { buildSample } from '../sample.js';
import { saveAsTemplate } from './templatedialog.js';

/** Editor command -> toolbar command (runs on the current state, then gives the focus back). */
const run = (c) => () => { c(app.view.state, app.view.dispatch, app.view); app.view.focus(); };

async function pickFigure() {
  const f = await api.pickImage();
  if (f) await insertFigure(app.view, f.name, f.bytes);
}

function toggleMathKeyboard() {
  const kb = window.mathVirtualKeyboard;
  if (!kb) return;
  if (kb.visible) kb.hide(); else { kb.show(); if (mathState.open && mathState.open.field) mathState.open.field.focus(); }
}

async function openTutorial() {
  if (!(await confirmDiscard())) return;
  await api.docClose();
  clearMedia();
  app.created = null;
  loadDocument(await buildTutorial(), null);
  app.savedDoc = app.view.state.doc;          // a practice document: closing it without saving asks nothing
}

/** View → Page breaks in the text: on / off, remembered. */
export function togglePageBreaks(force, remember = true) {
  const value = force !== undefined ? !!force : !pageBreaksOn();
  setPageBreaks(app.view, value);
  document.body.classList.toggle('page-breaks', value);
  api.viewState({ pageBreaks: value });
  if (remember) { app.settings = { ...app.settings, pageBreaks: value }; api.settings('set', { pageBreaks: value }); }
  if (value) schedulePreview(true);
}

async function openSample() {
  if (!(await confirmDiscard())) return;
  clearMedia();
  loadDocument(await buildSample(), null);
}

registerCommands({
  new: (choice) => newDocument(choice), open: openDialog, saveTemplate: () => saveAsTemplate(), save: () => save(false), saveAs: () => save(true),
  exportPdf: () => exportPdf(), exportDocx: () => exportDocx(), exportLatex: () => exportLatex(),
  undo: run(cmd.undo), redo: run(cmd.redo),
  bold: run(cmd.bold), italic: run(cmd.italic), underline: run(cmd.underline), sup: run(cmd.sup), sub: run(cmd.sub),
  bullets: run(cmd.bullets), numbers: run(cmd.numbers),
  inlineMath: run(cmd.inlineMath), equation: run(cmd.equation), numbered: run(toggleNumbered),
  figure: pickFigure, ref: openRefPicker,
  footnote: run(insertFootnote), toc: run(insertOutline('contents')), lof: run(insertOutline('figures')), lot: run(insertOutline('tables')),
  pageBreak: run(insertPageBreak), appendix: () => { if (!run(toggleAppendix)()) toast('Put the cursor in a top-level heading (Heading 1) where the appendix should start.'); },
  convertRefs: () => convertTyped(app.view),
  zoteroAddAll: async () => { toast('Sending references to Zotero …'); const msg = await addReferencesToZotero(app.view); toast(msg, /Not sent|first|no answer|Zotero: [^0-9]/.test(msg) ? 'error' : undefined); return msg; },
  importWord: () => importWord(),
  importWordSI: () => importWordSI(),
  supplement: () => insertSupplement(),
  removeSupplement: () => removeSupplement(),
  showPart: (part) => showPart(part),
  cite: () => openCiteDialog(app.view), library: () => openLibraryDialog(app.view), bibliography: run(insertBibliography),
  table: () => openTablePicker(app.view, $('[data-cmd="table"]')),
  style: () => openStyleDialog(app.view),
  journal: () => openJournalDialog(app.view),
  authors: () => openAuthorsDialog(app.view),
  settings: () => openSettings(),
  backups: openBackups,
  preview: () => togglePreview(),
  keyboard: toggleMathKeyboard,
  sample: openSample,
  tutorial: openTutorial,
  guide: (topic) => openGuide(typeof topic === 'string' ? topic : undefined),
  pageBreaks: () => togglePageBreaks(),
});

const STYLE_BOX = { p: cmd.paragraph, h1: cmd.h1, h2: cmd.h2, h3: cmd.h3, h4: cmd.h4 };
// handled in the page (the menu shows them but does not register them), so they also work inside an equation editor
const PAGE_KEYS = { r: 'ref', F8: 'preview', 0: 'zoom100', F1: 'guide' };
// Ctrl+Alt shortcuts, also handled here: on Danish and other keyboards AltGr arrives as Ctrl+Alt (AltGr+M types µ),
// which a menu accelerator cannot tell apart
const PAGE_ALT_KEYS = { m: 'comment', c: 'cite', f: 'footnote' };

export function wireToolbar() {
  document.querySelectorAll('[data-cmd]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the editor's selection
    b.addEventListener('click', () => runCommand(b.dataset.cmd));
  });
  const sel = $('#tb-style');
  sel.addEventListener('change', () => { const c = STYLE_BOX[sel.value]; if (c) run(c)(); });
  api.onMenu((name) => runCommand(name));
  document.addEventListener('keydown', (e) => {
    const altGr = e.getModifierState && e.getModifierState('AltGraph');
    const name = e.key === 'F8' ? PAGE_KEYS.F8 : e.key === 'F1' ? PAGE_KEYS.F1
      : (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey ? PAGE_KEYS[e.key.toLowerCase()]
      : e.ctrlKey && e.altKey && !e.shiftKey && !altGr ? PAGE_ALT_KEYS[{ KeyM: 'm', KeyC: 'c', KeyF: 'f' }[e.code] || ''] : null;
    if (!name || isRefPickerOpen()) return;
    e.preventDefault(); e.stopPropagation();
    if (mathState.open) mathState.open.leave(null);
    runCommand(name);
  }, true);
  api.onOpenPath(async (path) => { if (await confirmDiscard()) await openPath(path); });
  api.onCloseRequest(async () => { api.closeAnswer(await confirmDiscard()); });
}
