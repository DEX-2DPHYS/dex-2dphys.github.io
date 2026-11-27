/* window.DSW: the handle the automated tests (tests/*.js via main/testdriver.js) use to drive the app. */
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { numberingKey } from './editor/plugins.js';
import { commentsKey } from './editor/comments.js';
import { selectedFigure, insertFigure } from './editor/figures.js';
import { insertTable } from './editor/tables.js';
import { docToTypst } from '../core/typst.js';
import { clearMedia, mediaNames, addImage, imageSize } from '../core/media.js';
import { app, api, commands } from './context.js';
import { loadDocument, save, openPath } from './doc/files.js';
import { exportPdf, exportDocx, exportLatex } from './doc/export.js';
import { preview, waitPreview } from './doc/preview.js';
import { buildSample } from './sample.js';
import { autosaveNow, checkLockNow } from './doc/safety.js';
import { mergeNow } from './doc/sharedcomments.js';
import { convertTyped } from './ui/convertrefs.js';
import { importWord, importWordSI } from './doc/importword.js';
import { splitParts } from '../core/parts.js';
import { changesOf } from '../core/track.js';
import { siPath } from './doc/export.js';
import { convertXrefs } from './ui/convertrefs.js';
import { offerRecovery, openBackups } from './ui/restore.js';
import { chooseTemplate, saveAsTemplate } from './ui/templatedialog.js';
import { lastLimits, refreshLimits, setPageInfo } from './ui/limits.js';
import { VENUES, JOURNAL_VENUES, FUNDER_VENUES, venueById } from '../core/venues.js';

window.DSW = {
  app, COMMANDS: commands, preview, commentsKey,
  json: () => app.view.state.doc.toJSON(),
  loadSample: async () => { clearMedia(); loadDocument(await buildSample(), null); },
  typst: () => docToTypst(app.view.state.doc),
  exportPdf, exportDocx, exportLatex,
  saveTo: async (path) => { app.path = path; return save(false); },
  openPath, waitPreview,
  pageCount: () => document.querySelectorAll('#pv-pages img').length,
  mediaNames,
  selectedFigure: () => selectedFigure(app.view.state),
  insertFigure: (name, bytes) => insertFigure(app.view, name, bytes),
  insertTable: (r, c, data) => insertTable(app.view, r, c, data),
  // scripted documents (tests, the example manuscript): add an image from base64, then load JSON keeping the media
  addImageB64: async (fileName, b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const name = addImage(fileName, bytes);
    return { name, ...(await imageSize(name)) };
  },
  loadDoc: (json) => loadDocument(json, null),
  autosaveNow, checkLockNow, offerRecovery, openBackups, mergeNow, convertTyped,
  importWordSIFile: async (p) => importWordSI({ name: p.split(/[\\/]/).pop(), bytes: await api.readFile(p) }),
  typstOf: (part) => { const { main, si } = splitParts(app.view.state.doc); return docToTypst(part === 'si' ? si : main).source; },
  siPath, convertXrefs: () => convertXrefs(app.view),
  changes: () => changesOf(app.view.state.doc),
  importWordFile: async (p) => importWord({ name: p.split(/[\\/]/).pop(), bytes: await api.readFile(p) }),
  labels: () => [...numberingKey.getState(app.view.state).nums.byId.entries()].map(([id, i]) => [id, i.ref]),
  pm: { TextSelection, NodeSelection, CellSelection },
  chooseTemplate, saveAsTemplate, lastLimits, refreshLimits, setPageInfo,
  venues: { VENUES, JOURNAL_VENUES, FUNDER_VENUES, venueById },
};
