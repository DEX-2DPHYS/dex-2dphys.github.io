/* Format → Journal style…: pick the journal the manuscript goes to.
   - A journal in the app's list (core/journalstyles.js) sets heading numbering, "Fig."/"Figure", line spacing,
     line numbers and the reference style in one undoable step.
   - Any other journal: its reference style from the CSL repository (main/csl.js), or a .csl file from disk.
     A style that is not bundled is stored in the document, so it formats the same everywhere, offline. */
import { searchJournals, describeJournal, applyJournal, journalById } from '../../core/journalstyles.js';
import { bundledKeyFor, cslInfo, citeStyleLabel, STYLES, styleId } from '../../core/references.js';

const BUNDLED = () => STYLES.map(s => styleId(s[0]).split('/').pop());
import { styleOf, resolveStyle } from '../../core/style.js';
import { venueById, venueOf } from '../../core/venues.js';
import { api, toast } from '../context.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setStyle(view, st) { view.dispatch(view.state.tr.setDocAttribute('style', resolveStyle(st))); }

/** Use a downloaded / loaded CSL style ({ name, title, parent, xml }) as the document's reference style. */
export function useCslStyle(view, got) {
  const st = JSON.parse(JSON.stringify(styleOf(view.state.doc)));
  // a journal whose style is one of ours (e.g. Physical Review B -> APS): the bundled copy, nothing stored
  const bundled = bundledKeyFor(got.parent) || bundledKeyFor(got.name);
  if (bundled) { st.cite = bundled; delete st.csl; }
  else {
    if (!cslInfo(got.xml)) { toast('That is not a citation style (CSL) file.', 'error'); return false; }
    st.csl = { name: got.name, title: got.title || got.name, xml: got.xml };
    st.cite = 'csl:' + got.name;
  }
  st.journal = '';
  setStyle(view, st);
  toast('Reference style: ' + (got.title || got.name) + (bundled ? '' : ' (stored in this document)'));
  return true;
}

export function openJournalDialog(view, onDone) {
  let dlg = document.querySelector('#jdlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'jdlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  const st = styleOf(view.state.doc);
  const current = journalById(st.journal);
  dlg.innerHTML = '<div class="box"><h3>Journal style</h3>'
    + '<p class="msg">Current: <b>' + esc(current ? current.name : 'none chosen') + '</b> · references: ' + esc(citeStyleLabel(view.state.doc, st.cite)) + '</p>'
    + '<input type="search" class="jq" placeholder="Journal name, e.g. Nano Letters, 2D Materials, Physical Review B" spellcheck="false">'
    + '<div class="jlist" role="listbox"></div>'
    + '<h4>Other journals: reference style only</h4>'
    + '<p class="msg small">From the citation style repository Zotero uses (about 10 000 journals). Heading and figure formats stay as they are.</p>'
    + '<div class="jcsl"><span class="muted">Type a journal name above.</span></div>'
    + '<p class="msg small">The settings are starting points from the journals’ author guidelines. Check the journal’s current guide before you submit.</p>'
    + '<div class="buttons"><button data-act="file">Load a .csl file…</button><span class="grow"></span><button data-act="close" class="primary">Close</button></div></div>';
  const q = dlg.querySelector('.jq'), list = dlg.querySelector('.jlist'), csl = dlg.querySelector('.jcsl');
  const close = () => { dlg.hidden = true; if (onDone) onDone(); else view.focus(); };
  let timer = null, seq = 0;

  const renderLocal = () => {
    const hits = searchJournals(q.value);
    list.innerHTML = hits.length ? hits.map(j => '<button class="jitem' + (j.id === st.journal ? ' on' : '') + '" data-j="' + j.id + '"><b>' + esc(j.name) + '</b> <span class="muted">' + esc(j.publisher) + '</span><br><small>' + esc(describeJournal(j)) + '</small></button>').join('')
      : '<span class="muted">Not in the app’s list — see below.</span>';
  };
  const searchRepo = async () => {
    const text = q.value.trim(), my = ++seq;
    if (text.length < 3) { csl.innerHTML = '<span class="muted">Type a journal name above.</span>'; return; }
    csl.innerHTML = '<span class="muted">Searching…</span>';
    const r = await api.refs('cslSearch', text);
    if (my !== seq) return;
    if (!r || r.error) { csl.innerHTML = '<span class="err">' + esc(r ? r.error : 'No answer.') + '</span>'; return; }
    csl.innerHTML = r.items.length ? r.items.slice(0, 12).map(x => '<button class="jitem" data-csl="' + esc(x.name) + '">' + esc(x.title) + ' <small class="muted">' + esc(x.format) + '</small></button>').join('') + (r.total > 12 ? '<small class="muted">' + (r.total - 12) + ' more — type more of the name.</small>' : '')
      : '<span class="muted">No style found for “' + esc(text) + '”.</span>';
  };
  q.oninput = () => { renderLocal(); clearTimeout(timer); timer = setTimeout(searchRepo, 350); };
  dlg.onclick = async (e) => {
    const b = e.target.closest('button') || e.target;
    if (e.target === dlg || b.dataset.act === 'close') return close();
    if (b.dataset.j) {
      const ns = applyJournal(styleOf(view.state.doc), b.dataset.j);
      // its limits (core/venues.js) follow the journal; the article type stays if the journal is the same
      const jv = venueById(b.dataset.j), cur = venueOf(ns.venue);
      ns.venue = jv ? (cur && cur.venue.id === jv.id ? ns.venue : jv.id + '/' + jv.types[0].id) : '';
      setStyle(view, ns);
      toast('Journal style: ' + journalById(b.dataset.j).name);
      return close();
    }
    if (b.dataset.csl) {
      b.disabled = true;
      const got = await api.refs('cslFetch', { name: b.dataset.csl, bundled: BUNDLED() });
      b.disabled = false;
      if (!got || got.error) { toast(got ? got.error : 'The style could not be downloaded.', 'error'); return; }
      if (useCslStyle(view, got)) close();
      return;
    }
    if (b.dataset.act === 'file') {
      const got = await api.refs('cslPick', { bundled: BUNDLED() });
      if (!got) return;
      if (got.error) { toast(got.error, 'error'); return; }
      if (useCslStyle(view, got)) close();
    }
  };
  dlg.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && e.target === q) { const first = list.querySelector('[data-j]'); if (first) first.click(); }
  };
  renderLocal();
  dlg.hidden = false;
  q.focus();
}
