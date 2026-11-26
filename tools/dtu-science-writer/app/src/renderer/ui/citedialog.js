/* Citation dialog (Insert → Citation…, Ctrl+Alt+C, or a click on a citation).
   One search box: the document's own references, the local Zotero library, a DOI or arXiv number (looked up
   online), or pasted BibTeX. Chosen works become one citation; new works enter the document's library in the
   same undo step. */
import { NodeSelection } from 'prosemirror-state';
import { libraryOf, summary, findSame, addToLibrary, parseBibtex, isAuthorYear } from '../../core/references.js';
import { styleOf } from '../../core/style.js';
import { putCitation } from '../editor/citations.js';
import { api, toast } from '../context.js';
import { openLibraryDialog } from './librarydialog.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** DOI or arXiv number (same rule as main/refs.js doiOf). */
export const looksLikeId = (s) => /10\.\d{4,9}\/\S+/.test(s) || /^(arxiv:\s*|https?:\/\/arxiv\.org\/(abs|pdf)\/)?(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?(\.pdf)?$/i.test(s.trim());
const GROUP = { library: 'In this document', zotero: 'Zotero', doi: 'Found online', bibtex: 'From BibTeX' };

function libraryMatches(lib, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(lib)
    .filter(it => { const hay = (summary(it) + ' ' + (it['container-title'] || '') + ' ' + (it.DOI || '') + ' ' + it.id).toLowerCase(); return words.every(w => hay.includes(w)); })
    .sort((a, b) => summary(a).localeCompare(summary(b)))
    .map(it => ({ source: 'library', item: it, id: it.id }));
}

let seq = 0;          // search generation: answers to older searches are dropped

export function openCiteDialog(view) {
  const lib = () => libraryOf(view.state.doc);
  const sel = view.state.selection;
  const editing = sel instanceof NodeSelection && sel.node.type.name === 'citation' ? sel.node : null;
  const chosen = editing ? editing.attrs.items.map(x => ({ id: x.id, item: lib()[x.id] || { title: x.id + ' (missing)' }, locator: x.locator || '' })) : [];
  let mode = editing ? editing.attrs.mode : 'normal';
  let results = [], active = 0, status = '', timer = null;

  let dlg = document.querySelector('#citedlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'citedlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  const authorYear = isAuthorYear(view.state.doc, styleOf(view.state.doc).cite);
  dlg.innerHTML = '<div class="box"><h3>' + (editing ? 'Edit citation' : 'Cite') + '</h3>'
    + '<input class="q" placeholder="Search your references or Zotero — or paste a DOI, arXiv number or BibTeX" autocomplete="off" spellcheck="false">'
    + '<div class="status"></div><ul class="results"></ul>'
    + '<div class="chosen"></div>'
    + (authorYear ? '<div class="row"><span class="lab">Form</span><label><input type="radio" name="cmode" value="normal"> (Author, year)</label><label><input type="radio" name="cmode" value="suppress-author"> year only — when the names are in your sentence</label></div>' : '')
    + '<div class="buttons"><button data-act="bibfile">Import BibTeX file…</button><button data-act="library">Reference library…</button><span class="grow"></span>'
    + '<button data-act="cancel">Cancel</button><button data-act="ok" class="primary"></button></div></div>';
  const q = dlg.querySelector('.q'), list = dlg.querySelector('.results'), chosenEl = dlg.querySelector('.chosen'), statusEl = dlg.querySelector('.status'), okBtn = dlg.querySelector('[data-act="ok"]');
  if (authorYear) dlg.querySelector('input[name="cmode"][value="' + (mode === 'suppress-author' ? 'suppress-author' : 'normal') + '"]').checked = true;

  const renderResults = () => {
    statusEl.textContent = status;
    list.innerHTML = '';
    let group = null;
    results.forEach((r, i) => {
      if (r.source !== group) { group = r.source; const h = document.createElement('li'); h.className = 'grp'; h.textContent = GROUP[group]; list.appendChild(h); }
      const li = document.createElement('li');
      li.className = 'res' + (i === active ? ' active' : '') + (chosen.some(c => c.item === r.item || (r.id && c.id === r.id)) ? ' picked' : '');
      li.innerHTML = '<span class="sum">' + esc(summary(r.item)) + '</span>' + (r.item['container-title'] ? '<span class="src">' + esc(r.item['container-title']) + '</span>' : '')
        + (r.source !== 'library' && r.id ? '<span class="have">already in this document</span>' : '');
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.appendChild(li);
    });
    const a = list.querySelector('.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  };
  const renderChosen = () => {
    chosenEl.innerHTML = '<span class="lab">Citing</span>' + (chosen.length ? '' : '<span class="none">nothing yet — pick from the list</span>');
    chosen.forEach((c, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = '<span class="t">' + esc(summary(c.item).split(' · ').slice(0, 2).join(' ')) + '</span>'
        + '<input class="loc" placeholder="p." title="Page or other locator (optional)" value="' + esc(c.locator) + '"><button title="Remove">✕</button>';
      chip.querySelector('.loc').addEventListener('input', (e) => { c.locator = e.target.value.trim(); });
      chip.querySelector('button').addEventListener('click', () => { chosen.splice(i, 1); renderChosen(); renderResults(); });
      chosenEl.appendChild(chip);
    });
    okBtn.textContent = editing ? (chosen.length ? 'Update' : 'Remove citation') : 'Insert';
    okBtn.disabled = !editing && !chosen.length;
  };

  const search = () => {
    const text = q.value.trim(), my = ++seq;
    active = 0; status = '';
    if (text.startsWith('@')) {
      const items = parseBibtex(text);
      results = items.map(it => ({ source: 'bibtex', item: it, id: (findSame(lib(), it) || {}).id }));
      status = items.length ? '' : 'No BibTeX entry recognised.';
      return renderResults();
    }
    if (looksLikeId(text)) {
      results = []; status = 'Looking up ' + text + ' …'; renderResults();
      api.refs('lookup', text).then((r) => {
        if (my !== seq) return;
        status = r.error || '';
        results = (r.items || []).map(it => ({ source: 'doi', item: it, id: (findSame(lib(), it) || {}).id }));
        renderResults();
      });
      return;
    }
    results = libraryMatches(lib(), text);
    renderResults();
    if (text.length >= 3) {
      api.refs('zotero', text).then((r) => {
        if (my !== seq) return;
        if (r.error) { status = Object.keys(lib()).length ? '' : 'Zotero is not available — paste a DOI or BibTeX instead.'; statusEl.title = r.error; }
        else {
          const have = new Set(results.map(x => x.id).filter(Boolean));
          results = results.concat((r.items || []).map(it => ({ source: 'zotero', item: it, id: (findSame(lib(), it) || {}).id })).filter(x => !x.id || !have.has(x.id)));
        }
        renderResults();
      });
    }
  };

  const choose = (i) => {
    const r = results[i];
    if (!r) return;
    if (!chosen.some(c => c.item === r.item || (r.id && c.id === r.id))) chosen.push({ id: r.id || null, item: r.id ? lib()[r.id] : r.item, locator: '', zotero: r.source === 'zotero' ? r.item : null });
    renderChosen(); renderResults();
    q.focus(); q.select();
  };

  const close = () => { dlg.hidden = true; clearTimeout(timer); seq++; view.focus(); };
  const commit = () => {
    if (editing && !chosen.length) {
      const s = view.state.selection;
      if (s instanceof NodeSelection && s.node.type.name === 'citation') view.dispatch(view.state.tr.deleteSelection());
      return close();
    }
    if (!chosen.length) return;
    const fresh = chosen.filter(c => !c.id);
    // works already in the document but picked from Zotero: their Zotero link is recorded (addToLibrary merges it)
    const linked = chosen.filter(c => c.id && c.zotero && !(lib()[c.id] || {}).zotero);
    let newLib = null;
    if (fresh.length || linked.length) {
      const r = addToLibrary(lib(), [...fresh.map(c => c.item), ...linked.map(c => c.zotero)]);
      newLib = r.library;
      fresh.forEach((c, k) => { c.id = r.keys[k]; });
    }
    const items = chosen.filter(c => c.id).map(c => (c.locator ? { id: c.id, locator: c.locator } : { id: c.id }));
    close();
    putCitation(view, items, mode, newLib);
  };

  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; search(); }, q.value.trim().startsWith('@') || looksLikeId(q.value) ? 0 : 180); };
  q.onkeydown = (e) => {
    // Enter right after typing: search first (the debounced search has not run yet)
    if (e.key === 'Enter' && timer) { clearTimeout(timer); timer = null; search(); }
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter' && (e.ctrlKey || !results.length || !q.value.trim())) { commit(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
  };
  dlg.onchange = (e) => { if (e.target.name === 'cmode') mode = e.target.value; };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { close(); e.preventDefault(); } };
  dlg.onclick = async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (e.target === dlg || act === 'cancel') return close();
    if (act === 'ok') return commit();
    if (act === 'library') { close(); return openLibraryDialog(view); }
    if (act === 'bibfile') {
      const text = await api.refs('bibtex');
      if (!text) return;
      const n = importBibtex(view, text);
      status = n ? 'Added ' + n + ' reference' + (n > 1 ? 's' : '') + ' to this document.' : 'No new references in that file.';
      q.value = ''; search(); q.focus();
    }
  };

  dlg.hidden = false;
  renderChosen();
  search();
  q.focus();
}

/** Add the entries of a BibTeX text to the document's library (one undo step); returns how many were new. */
export function importBibtex(view, text) {
  const lib = libraryOf(view.state.doc);
  const items = parseBibtex(text);
  const r = addToLibrary(lib, items);
  const added = Object.keys(r.library).length - Object.keys(lib).length;
  if (added) view.dispatch(view.state.tr.setDocAttribute('references', r.library));
  else if (!items.length) toast('No BibTeX entries found.');
  return added;
}
