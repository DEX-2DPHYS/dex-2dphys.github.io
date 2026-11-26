/* File → Import Word document…: a .docx becomes a new, unsaved document (core/docxin.js does the reading), and a
   report says what arrived and what could not be converted. The Word file itself is never changed. */
import { docxToDocument } from '../../core/docxin.js';
import { clearMedia, addImage, imageSize } from '../../core/media.js';
import { findTypedReferences } from '../../core/typedrefs.js';
import { findTypedXrefs } from '../../core/typedxrefs.js';
import { app, api, toast, runCommand } from '../context.js';
import { loadDocument, confirmDiscard } from './files.js';
import { supplementOf } from '../../core/parts.js';
import { libraryOf, addToLibrary } from '../../core/references.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LABEL = { headings: 'headings', paragraphs: 'paragraphs', equations: 'display equations', math: 'pieces of inline math', figures: 'figures', tables: 'tables',
  listItems: 'list items', footnotes: 'footnotes', comments: 'comment threads', citations: 'citations', references: 'references in the library', xrefs: 'cross-references', changes: 'tracked changes to review' };

/** Import a Word file. file: { name, bytes } (from the dialog, or given by a test). Returns the report, or null. */
export async function importWord(file) {
  if (!(await confirmDiscard())) return null;
  const f = file || await api.pickWord();
  if (!f) return null;
  let result;
  try { result = await docxToDocument(f.bytes); } catch (e) { toast('Could not read ' + f.name + ': ' + e.message, 'error'); return null; }
  const { json, media, report } = result;
  // the pictures go into the document's media store (named by content); the figures are pointed at them
  clearMedia();
  const names = new Map();
  for (const m of media) names.set(m.name, addImage(m.name, m.bytes));
  const sizes = new Map();
  for (const n of names.values()) sizes.set(n, await imageSize(n));
  const patch = (node) => {
    if (node.type === 'image' && node.attrs.src) { const src = names.get(node.attrs.src) || ''; const s = sizes.get(src) || { w: 0, h: 0 }; return { ...node, attrs: { ...node.attrs, src, w: s.w, h: s.h } }; }
    return node.content ? { ...node, content: node.content.map(patch) } : node;
  };
  await api.docClose();
  app.created = null;
  loadDocument(patch(json), null);
  app.savedDoc = null;                         // a new document that has not been saved yet
  app.importedFrom = f.name;
  showReport(f.name, report);
  return report;
}

/**
 * File → Import Word document as Supporting Information…: the Word file becomes the SI of the open paper (replacing
 * an SI that is there, after asking). Its title block is left out — the SI is headed by the paper's own title and
 * authors. Its figures, sections and comments get ids of their own, and its references join the paper's library.
 * One undo step. file: { name, bytes } (from the dialog, or given by a test). Returns the report, or null.
 */
export async function importWordSI(file) {
  const view = app.view;
  if (app.readOnly) { toast('The document is read-only.', 'error'); return null; }
  const old = supplementOf(view.state.doc);
  if (old && old.node.textContent.trim() && !window.confirm('Replace the Supporting Information of this document with the Word file?\n\nCtrl+Z brings the present one back.')) return null;
  const f = file || await api.pickWord();
  if (!f) return null;
  let result;
  try { result = await docxToDocument(f.bytes); } catch (e) { toast('Could not read ' + f.name + ': ' + e.message, 'error'); return null; }
  const { json, media, report } = result;

  // pictures: added to the document's media (nothing already there is touched)
  const names = new Map();
  for (const m of media) names.set(m.name, addImage(m.name, m.bytes));
  const sizes = new Map();
  for (const n of names.values()) sizes.set(n, await imageSize(n));

  // ids of the paper, so the imported ones can be made different
  const doc = view.state.doc;
  const taken = new Set(Object.keys(doc.attrs.comments || {}));
  doc.descendants((n) => { if (n.attrs && n.attrs.id) taken.add(n.attrs.id); return true; });
  const idMap = new Map();
  const fresh = (id) => {
    if (!idMap.has(id)) { let k = id.replace(/^([a-z]+)-/, '$1-s'), i = 1; while (taken.has(k)) k = id.replace(/^([a-z]+)-/, '$1-s' + (++i) + '-'); taken.add(k); idMap.set(id, k); }
    return idMap.get(id);
  };
  // references: into the paper's library (the same work is not added twice); citations follow the new keys
  const importedLib = (json.attrs && json.attrs.references) || {};
  const importedKeys = Object.keys(importedLib);
  const merged = addToLibrary(libraryOf(doc), importedKeys.map(k => importedLib[k]));
  const keyMap = new Map(importedKeys.map((k, i) => [k, merged.keys[i]]));

  const patch = (node) => {
    let out = node;
    if (node.type === 'image' && node.attrs && node.attrs.src) { const src = names.get(node.attrs.src) || ''; const z = sizes.get(src) || { w: 0, h: 0 }; out = { ...node, attrs: { ...node.attrs, src, w: z.w, h: z.h } }; }
    if (node.attrs && node.attrs.id) out = { ...out, attrs: { ...out.attrs, id: fresh(node.attrs.id) } };
    if (node.type === 'xref') out = { ...out, attrs: { ...out.attrs, target: fresh(node.attrs.target) } };
    if (node.type === 'citation') out = { ...out, attrs: { ...out.attrs, items: (node.attrs.items || []).map(x => ({ ...x, id: keyMap.get(x.id) || x.id })) } };
    if (out.attrs && Array.isArray(out.attrs.comments)) out = { ...out, attrs: { ...out.attrs, comments: out.attrs.comments.map(fresh) } };
    if (out.marks) out = { ...out, marks: out.marks.map(m => (m.type === 'comment' ? { ...m, attrs: { ...m.attrs, id: fresh(m.attrs.id) } } : m)) };
    return out.content ? { ...out, content: out.content.map(patch) } : out;
  };
  const blocks = (json.content || []).filter(n => !['title', 'authors', 'abstract'].includes(n.type)).map(patch);
  // the abstract of an SI file (rare) is ordinary text there
  for (const n of (json.content || []).filter(x => x.type === 'abstract').reverse()) blocks.unshift(...(n.content || []).map(patch));
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  const threads = { ...(doc.attrs.comments || {}) };
  for (const [id, th] of Object.entries((json.attrs && json.attrs.comments) || {})) { const k = fresh(id); threads[k] = { ...th, id: k }; }

  let node;
  try { node = view.state.schema.nodeFromJSON({ type: 'supplement', attrs: { title: old ? old.node.attrs.title : 'Supporting Information' }, content: blocks }); node.check(); }
  catch (e) { toast('The Word file could not be used as Supporting Information: ' + e.message, 'error'); return null; }
  const now = supplementOf(view.state.doc);
  let tr = view.state.tr.setDocAttribute('references', merged.library).setDocAttribute('comments', threads);
  tr = now ? tr.replaceWith(now.pos, now.pos + now.node.nodeSize, node) : tr.insert(tr.doc.content.size, node);
  view.dispatch(tr.setMeta('untracked', true));
  runCommand('showPart', 'si');
  showReport(f.name, report, { si: true });
  return report;
}

function showReport(name, report, opts = {}) {
  let dlg = document.querySelector('#impdlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'impdlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  const typed = !!findTypedReferences(app.view.state.doc, opts.si ? 'si' : 'main').list || findTypedXrefs(app.view.state.doc).length > 0;
  const counts = Object.entries(LABEL).filter(([k]) => report.counts[k]).map(([k, l]) => '<li><b>' + report.counts[k] + '</b> ' + l + '</li>').join('');
  dlg.innerHTML = '<div class="box"><h3>Imported ' + esc(name) + '</h3>'
    + '<p class="msg">' + (opts.si ? 'It is now the Supporting Information of this paper (the second tab) — the Word file is unchanged. Its figures, tables and equations are numbered S1, S2, …' : 'It is a new document — the Word file is unchanged. Save it to keep it.') + '</p>'
    + '<ul class="imp-counts">' + counts + '</ul>'
    + ((opts.si ? report.notes.filter(n => !/author list|Affiliations were read|which author belongs|read as the title/.test(n)) : report.notes).length
      ? '<h4>To check</h4><ul class="imp-notes">' + (opts.si ? report.notes.filter(n => !/author list|Affiliations were read|which author belongs|read as the title/.test(n)) : report.notes).map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>'
      : '<p class="msg">Everything in the file was converted.</p>')
    + (typed ? '<p class="msg">Citations and references like “Fig. 2” are typed text here. <b>Convert typed references</b> looks each reference up and makes citations and cross-references live.</p>' : '')
    + '<div class="buttons"><span class="grow"></span>' + (typed ? '<button data-act="convert">Convert typed references</button>' : '') + '<button data-act="close" class="primary">OK</button></div></div>';
  const close = () => { dlg.hidden = true; if (app.view) app.view.focus(); };
  dlg.onclick = (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (e.target === dlg || act === 'close') return close();
    if (act === 'convert') { close(); runCommand('convertRefs'); }
  };
  dlg.onkeydown = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
  dlg.hidden = false;
  dlg.querySelector('[data-act="close"]').focus();
}
