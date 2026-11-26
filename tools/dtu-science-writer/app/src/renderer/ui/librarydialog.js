/* Reference library of the document (Format → Reference library…, or a double-click on the reference list):
   every work in the document's library, how often it is cited, edit or enter one by hand, remove unused ones,
   import BibTeX, export the library as .bib. Every change is one document step (undoable, saved in the file). */
import { libraryOf, summary, citationsOf, addToLibrary, toBibtex, updatedItem, incompleteReason } from '../../core/references.js';
import { api, toast, baseName } from '../context.js';
import { importBibtex } from './citedialog.js';
import { journalAbbreviation } from '../../core/journals.js';

const abbreviationOf = (it) => journalAbbreviation(Array.isArray(it['container-title']) ? it['container-title'][0] : it['container-title'] || '') || undefined;
let zstatus = { configured: false };       // the Zotero web library (Settings), fetched when the dialog opens

/** Send the references not yet linked to Zotero there (collection named after the document) and link them — one undo
    step for the links. Returns a message. */
/** Format → Add references to Zotero library: the collection is named after the paper. */
export async function addReferencesToZotero(view) {
  const st = await api.refs('zoteroStatus');
  if (!st || !st.configured) return 'Zotero: add your Zotero key in File → Settings first (with write access).';
  const title = (view.state.doc.firstChild && view.state.doc.firstChild.textContent.trim()) || 'Untitled';
  return sendToZotero(view, (title.length > 70 ? title.slice(0, 67) + '…' : title) + ' (DTU Science Writer)');
}

export async function sendToZotero(view, collection) {
  const lib = libraryOf(view.state.doc);
  const unlinked = Object.values(lib).filter(it => !it.zotero);
  const todo = unlinked.filter(it => !incompleteReason(it));
  const left = unlinked.filter(it => incompleteReason(it));
  const leftMsg = left.length ? ' Not sent (' + left.length + '): ' + left.slice(0, 6).map(it => '“' + String(it.title || it.id).slice(0, 40) + '” — ' + incompleteReason(it)).join('; ') + (left.length > 6 ? '; …' : '') + '. Complete them (Edit, or Update from Zotero / DOI) and send again.' : '';
  if (!todo.length) return (unlinked.length ? 'Nothing complete to send.' : 'Every reference is already linked to Zotero.') + leftMsg;
  const r = await api.refs('zoteroAdd', { items: todo.map(it => { const { zotero, ...csl } = it; return { ref: it.id, csl, abbreviation: abbreviationOf(it) }; }), collection });
  if (!r || r.error) return 'Zotero: ' + ((r && r.error) || 'no answer');
  const now = libraryOf(view.state.doc), next = { ...now };
  for (const [ref, z] of Object.entries(r.links || {})) if (next[ref]) next[ref] = { ...next[ref], zotero: z };
  setLibrary(view, next);
  return 'Zotero: ' + r.created + ' added to the collection “' + collection + '”' + (r.existing ? ', ' + r.existing + ' already in your library (linked)' : '') + '.' + leftMsg;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPES = [['article-journal', 'Journal article'], ['article', 'Preprint'], ['book', 'Book'], ['chapter', 'Book chapter'], ['paper-conference', 'Conference paper'], ['thesis', 'Thesis'], ['report', 'Report'], ['webpage', 'Web page']];
const FIELDS = [['title', 'Title'], ['container-title', 'Journal / book'], ['volume', 'Volume'], ['issue', 'Issue'], ['page', 'Pages or article no.'], ['year', 'Year'], ['publisher', 'Publisher'], ['DOI', 'DOI'], ['URL', 'URL']];

/* authors <-> one per line, "Family, Given" */
const namesToText = (list) => (list || []).map(a => (a.literal ? a.literal : [a.family, a.given].filter(Boolean).join(', '))).join('\n');
const textToNames = (t) => t.split('\n').map(s => s.trim()).filter(Boolean).map((s) => {
  if (s.includes(',')) { const [family, ...g] = s.split(','); return { family: family.trim(), given: g.join(',').trim() }; }
  const parts = s.split(/\s+/);
  return parts.length > 1 ? { family: parts.pop(), given: parts.join(' ') } : { literal: s };
});
const yearOf = (it) => (it.issued && it.issued['date-parts'] && it.issued['date-parts'][0] && it.issued['date-parts'][0][0]) || '';

function citeCounts(doc) {
  const n = {};
  for (const c of citationsOf(doc)) for (const x of c.items) n[x.id] = (n[x.id] || 0) + 1;
  return n;
}

function setLibrary(view, lib) { view.dispatch(view.state.tr.setDocAttribute('references', lib)); }

/** Update every reference from its source (main/refs.js match) and apply the result as one undo step.
    Returns { updated, failed: [{ key, why }] } (also shown in the dialog). */
export async function updateAll(view, dlg) {
  const lib = libraryOf(view.state.doc), keys = Object.keys(lib);
  const st = dlg && dlg.querySelector('.lib-status');
  const say = (t) => { if (st) st.textContent = t; };
  const btn = dlg && dlg.querySelector('[data-act="update"]');
  if (btn) btn.disabled = true;
  const next = { ...lib }, failed = [];
  let updated = 0, i = 0;
  for (const k of keys) {
    say('Updating ' + (++i) + ' of ' + keys.length + ': ' + summary(lib[k]).slice(0, 70) + ' …');
    if (i > 1) await new Promise(res => setTimeout(res, 350));       // gentle on Crossref / doi.org rate limits
    const r = await api.refs('match', lib[k]);
    const it = r && r.item ? updatedItem(lib[k], r.item) : null;
    if (it) { next[k] = it; updated++; } else failed.push({ key: k, why: (r && r.error) || 'nothing found' });
  }
  if (updated) setLibrary(view, next);
  const msg = 'Updated ' + updated + ' of ' + keys.length + (failed.length ? '. Not found: ' + failed.map(f => f.key + ' (' + f.why + ')').join('; ') : '.') + (updated ? ' Ctrl+Z undoes it.' : '');
  return { updated, failed, msg };
}

export function openLibraryDialog(view) {
  let dlg = document.querySelector('#libdlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'libdlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  let editing = null;          // key being edited, '' = new reference, null = list

  const renderList = () => {
    const lib = libraryOf(view.state.doc), counts = citeCounts(view.state.doc);
    const keys = Object.keys(lib).sort((a, b) => summary(lib[a]).localeCompare(summary(lib[b])));
    const unused = keys.filter(k => !counts[k]).length;
    dlg.innerHTML = '<div class="box wide"><h3>Reference library <small>' + keys.length + ' in this document</small></h3>'
      + '<div class="libwrap"><table class="lib"><thead><tr><th>Reference</th><th>Cited</th><th></th></tr></thead><tbody>'
      + (keys.length ? keys.map(k => '<tr data-key="' + esc(k) + '"><td><div class="sum">' + esc(summary(lib[k])) + (lib[k].zotero ? ' <span class="zot" title="Linked to your Zotero library (item ' + esc(lib[k].zotero.key) + ')">Zotero</span>' : '') + '</div><div class="src">' + esc([lib[k]['container-title'], lib[k].DOI].filter(Boolean).join(' · ')) + '</div></td>'
        + '<td class="n">' + (counts[k] ? counts[k] + '×' : '<span class="unused">not cited</span>') + '</td>'
        + '<td class="act"><button data-act="edit">Edit</button><button data-act="del"' + (counts[k] ? ' disabled title="Cited in the text — remove the citations first"' : ' title="Remove from the library"') + '>✕</button></td></tr>').join('')
        : '<tr><td colspan="3" class="none">No references yet. Cite with Insert → Citation (Ctrl+Alt+C), import a BibTeX file or enter one by hand.</td></tr>')
      + '</tbody></table></div>'
      + '<div class="status lib-status"></div>'
      + '<div class="buttons"><button data-act="update"' + (keys.length ? '' : ' disabled') + ' title="Fetch every reference from its source — your Zotero library if linked, else doi.org by its DOI, else the matching Crossref record (title, year and first author must agree). One undo step.">↻ Update from Zotero / DOI</button><button data-act="zsend"' + (zstatus.configured && zstatus.canWrite && keys.some(k => !lib[k].zotero) ? '' : ' disabled') + ' title="' + (zstatus.configured ? (zstatus.canWrite ? 'Add the references that are not in Zotero yet to your Zotero library, in a collection named after this document, and link them' : 'The Zotero key in Settings is read only') : 'Add a Zotero API key in Settings first') + '">→ Send to Zotero</button><button data-act="new">+ New reference</button><button data-act="bibfile">Import BibTeX file…</button><button data-act="export"' + (keys.length ? '' : ' disabled') + '>Export .bib…</button>'
      + '<button data-act="unused"' + (unused ? '' : ' disabled') + '>Remove ' + (unused || '') + ' not cited</button><span class="grow"></span><button data-act="close" class="primary">Close</button></div></div>';
  };

  const renderForm = () => {
    const it = editing ? libraryOf(view.state.doc)[editing] : { type: 'article-journal' };
    const val = (k) => (k === 'year' ? yearOf(it) : it[k] || '');
    dlg.innerHTML = '<div class="box"><h3>' + (editing ? 'Edit reference <small>' + esc(editing) + '</small>' : 'New reference') + '</h3><div class="refform">'
      + '<label>Type<select data-k="type">' + TYPES.map(([t, l]) => '<option value="' + t + '"' + (it.type === t ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>'
      + '<label class="tall">Authors <small>one per line: Family, Given</small><textarea data-k="author" rows="4">' + esc(namesToText(it.author)) + '</textarea></label>'
      + FIELDS.map(([k, l]) => '<label>' + l + '<input data-k="' + k + '" value="' + esc(val(k)) + '">' + (k === 'DOI' ? '<button data-act="fill" title="Fill in the fields from the DOI or arXiv number">Look up</button>' : '') + '</label>').join('')
      + '</div>' + (editing && it.zotero && zstatus.configured && zstatus.canWrite ? '<label class="zupd"><input type="checkbox" data-zupd checked> Also update it in Zotero</label>' : '')
      + '<div class="status"></div><div class="buttons"><button data-act="back">Cancel</button><button data-act="save" class="primary">Save</button></div></div>';
  };

  const readForm = () => {
    const it = editing ? { ...libraryOf(view.state.doc)[editing] } : {};
    dlg.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k, v = el.value.trim();
      if (k === 'author') { const a = textToNames(el.value); if (a.length) it.author = a; else delete it.author; }
      else if (k === 'year') { if (v) it.issued = { 'date-parts': [[parseInt(v, 10) || v]] }; else delete it.issued; }
      else if (v) it[k] = v; else delete it[k];
    });
    return it;
  };

  const render = () => (editing === null ? renderList() : renderForm());

  dlg.onclick = async (e) => {
    const el = e.target, act = el.dataset && el.dataset.act;
    if (el === dlg || act === 'close') { dlg.hidden = true; view.focus(); return; }
    const key = el.closest && el.closest('tr[data-key]') && el.closest('tr[data-key]').dataset.key;
    const lib = libraryOf(view.state.doc);
    if (act === 'edit') { editing = key; return render(); }
    if (act === 'new') { editing = ''; return render(); }
    if (act === 'back') { editing = null; return render(); }
    if (act === 'del') { const l = { ...lib }; delete l[key]; setLibrary(view, l); return render(); }
    if (act === 'zsend') {
      const st = dlg.querySelector('.lib-status');
      if (st) st.textContent = 'Sending to Zotero …';
      const title = (view.state.doc.firstChild && view.state.doc.firstChild.textContent) || baseName();
      const msg = await sendToZotero(view, (title.length > 70 ? title.slice(0, 67) + '…' : title) + ' (DTU Science Writer)');
      render();
      const st2 = dlg.querySelector('.lib-status');
      if (st2) st2.textContent = msg;
      return;
    }
    if (act === 'update') {
      const r = await updateAll(view, dlg);
      render();
      const st = dlg.querySelector('.lib-status');
      if (st) st.textContent = r.msg;
      return;
    }
    if (act === 'unused') {
      const counts = citeCounts(view.state.doc), l = {};
      for (const k of Object.keys(lib)) if (counts[k]) l[k] = lib[k];
      setLibrary(view, l); return render();
    }
    if (act === 'bibfile') {
      const text = await api.refs('bibtex');
      if (text) { const n = importBibtex(view, text); toast(n ? 'Added ' + n + ' reference' + (n > 1 ? 's' : '') + '.' : 'No new references in that file.'); }
      return render();
    }
    if (act === 'export') {
      const path = await api.saveDialog({ defaultName: baseName() + '.bib', kind: 'bib' });
      if (!path) return;
      const r = await api.writeFile(path, new TextEncoder().encode(toBibtex(lib)));
      toast(r && r.error ? r.error : 'Saved ' + path, r && r.error ? 'error' : undefined);
      return;
    }
    if (act === 'fill') {
      const st = dlg.querySelector('.status'), doi = dlg.querySelector('[data-k="DOI"]').value.trim();
      st.textContent = 'Looking up ' + doi + ' …';
      const r = await api.refs('lookup', doi);
      if (r.error) { st.textContent = r.error; return; }
      const found = r.items[0], keep = editing;
      // show the looked-up fields in the form (not saved until Save)
      const tmp = { ...found, id: keep || 'new' };
      dlg.querySelector('[data-k="type"]').value = TYPES.some(t => t[0] === tmp.type) ? tmp.type : 'article-journal';
      dlg.querySelector('[data-k="author"]').value = namesToText(tmp.author);
      for (const [k] of FIELDS) {
        let v = k === 'year' ? yearOf(tmp) : tmp[k];
        if (Array.isArray(v)) v = v[0];
        dlg.querySelector('[data-k="' + k + '"]').value = v || '';
      }
      st.textContent = '';
      return;
    }
    if (act === 'save') {
      const it = readForm();
      if (!it.title && !it.author) { dlg.querySelector('.status').textContent = 'A reference needs at least a title or an author.'; return; }
      const alsoZotero = editing && it.zotero && dlg.querySelector('[data-zupd]') && dlg.querySelector('[data-zupd]').checked;
      if (editing) setLibrary(view, { ...lib, [editing]: { ...it, id: editing } });
      else setLibrary(view, addToLibrary(lib, [it]).library);
      editing = null;
      render();
      if (alsoZotero) {
        const st = dlg.querySelector('.lib-status');
        if (st) st.textContent = 'Updating it in Zotero …';
        const { zotero, ...csl } = it;
        const r = await api.refs('zoteroUpdate', { key: it.zotero.key, csl, abbreviation: abbreviationOf(it) });
        if (st) st.textContent = r && r.error ? 'Saved here; Zotero was not updated: ' + r.error : 'Saved here and in Zotero.';
      }
      return;
    }
  };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { if (editing !== null) { editing = null; render(); } else { dlg.hidden = true; view.focus(); } e.preventDefault(); } };
  render();
  dlg.hidden = false;
  // the Zotero buttons depend on the key in Settings (asked of the main process; the key itself never comes here)
  api.refs('zoteroStatus').then((st) => { zstatus = st || { configured: false }; if (!dlg.hidden && editing === null) render(); });
}
