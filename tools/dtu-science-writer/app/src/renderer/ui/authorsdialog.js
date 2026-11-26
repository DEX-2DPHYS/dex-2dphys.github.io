/* Authors and affiliations dialog (the author block itself is editor/authorsview.js).
   The affiliation library is a JSON file in the app's settings folder; it can be exported/imported to share it. */
import { AFFIL_KEYS, AFFIL_LABELS, affilText, newAffilId } from '../../core/authors.js';
import { styleOf } from '../../core/style.js';
import { findAuthors } from '../editor/authorsview.js';
import { api as bridge } from '../context.js';

const api = () => bridge;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- dialog ---------- */
let lib = null;                       // affiliation library (array), loaded on first use
async function loadLib() { if (!lib) lib = (await api().affilLibrary('load')) || []; return lib; }
async function saveLib() { await api().affilLibrary('save', lib); }
const sameAffil = (a, b) => AFFIL_KEYS.every(k => (a[k] || '').trim() === (b[k] || '').trim());

export async function openAuthorsDialog(view) {
  const found = findAuthors(view.state);
  if (!found) return;
  await loadLib();
  const st = styleOf(view.state.doc);
  // working copy; written back to the document on every change (one undo step each)
  let data = { list: clone(found.node.attrs.list || []), affils: clone(found.node.attrs.affils || []) };
  if (!data.list.length) data.list.push({ name: '', affils: [], corresponding: false, email: '' });
  let dlg = document.querySelector('#authdlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'authdlg'; document.body.appendChild(dlg); }

  const commit = () => {
    const f = findAuthors(view.state);
    if (!f) return;
    view.dispatch(view.state.tr.setNodeMarkup(f.pos, null, { list: clone(data.list), affils: clone(data.affils) }));
  };

  const render = () => {
    const affilShort = (a) => affilText(a, 'short') || affilText(a, 'full') || '(empty affiliation)';
    const authorRows = data.list.map((au, i) => '<tr data-i="' + i + '">'
      + '<td class="num">' + (i + 1) + '</td>'
      + '<td><input data-f="name" value="' + esc(au.name) + '" placeholder="Full name, e.g. Peter Bøggild"></td>'
      + '<td class="affchecks">' + (data.affils.length ? data.affils.map((a, k) => '<label title="' + esc(affilText(a, 'full')) + '"><input type="checkbox" data-aff="' + a.id + '"' + ((au.affils || []).includes(a.id) ? ' checked' : '') + '> ' + (k + 1) + '</label>').join('') : '<span class="hint">add an affiliation below</span>') + '</td>'
      + '<td><label title="Corresponding author"><input type="checkbox" data-f="corresponding"' + (au.corresponding ? ' checked' : '') + '> ✉</label></td>'
      + '<td><input data-f="email" value="' + esc(au.email) + '" placeholder="e-mail (corresponding)"' + (au.corresponding ? '' : ' disabled') + '></td>'
      + '<td class="act"><button data-act="up" title="Move up">↑</button><button data-act="down" title="Move down">↓</button><button data-act="del" title="Remove author">✕</button></td></tr>').join('');
    const affilRows = data.affils.map((a, k) => '<div class="affil" data-id="' + a.id + '"><div class="affhead"><b>' + (k + 1) + '</b> <span>' + esc(affilShort(a)) + '</span>'
      + '<span class="affacts">' + (lib.some(x => sameAffil(x, a)) ? '<span class="saved">in library</span>' : '<button data-act="tolib">Save to library</button>') + '<button data-act="delaff" title="Remove affiliation">✕</button></span></div>'
      + '<div class="afffields">' + AFFIL_KEYS.map(key => '<label>' + AFFIL_LABELS[key] + '<input data-k="' + key + '" value="' + esc(a[key]) + '"></label>').join('') + '</div></div>').join('');
    const libOpts = lib.map((a, i) => '<option value="' + i + '">' + esc(affilText(a, 'medium') || affilText(a, 'full')) + '</option>').join('');
    dlg.innerHTML = '<div class="box">'
      + '<h3>Authors and affiliations</h3>'
      + '<table class="authors"><thead><tr><th></th><th>Name</th><th>Affiliations</th><th></th><th></th><th></th></tr></thead><tbody>' + authorRows + '</tbody></table>'
      + '<button data-act="addauthor">+ Author</button>'
      + '<h4>Affiliations <small>numbered in the order the authors use them</small></h4>' + (affilRows || '<p class="hint">No affiliations yet.</p>')
      + '<div class="affadd"><button data-act="addaff">+ New affiliation</button>'
      + '<select data-act="fromlib"><option value="">+ From library…</option>' + libOpts + '</select>'
      + '<span class="libfile"><button data-act="libimport" title="Add the affiliations of a saved library file">Import library…</button><button data-act="libexport" title="Save the library to a file you can share">Export library…</button></span></div>'
      + '<p class="hint">Format (markers ' + esc(st.affil.marker) + ', ' + esc(st.affil.fields) + ' address) is set in Style.</p>'
      + '<div class="buttons"><button data-act="close" class="primary">Done</button></div></div>';
  };

  const change = () => { commit(); };
  dlg.oninput = (e) => {
    const el = e.target;
    const row = el.closest('tr[data-i]');
    if (row && el.dataset.f === 'name') { data.list[+row.dataset.i].name = el.value; change(); return; }
    if (row && el.dataset.f === 'email') { data.list[+row.dataset.i].email = el.value; change(); return; }
    const af = el.closest('.affil');
    if (af && el.dataset.k) {
      const a = data.affils.find(x => x.id === af.dataset.id);
      a[el.dataset.k] = el.value;
      af.querySelector('.affhead span').textContent = affilText(a, 'short') || affilText(a, 'full');
      change();
    }
  };
  dlg.onchange = (e) => {
    const el = e.target;
    const row = el.closest('tr[data-i]');
    if (row && el.dataset.aff) {
      const au = data.list[+row.dataset.i];
      const set = new Set(au.affils || []);
      if (el.checked) set.add(el.dataset.aff); else set.delete(el.dataset.aff);
      au.affils = data.affils.map(a => a.id).filter(id => set.has(id));
      change(); return;
    }
    if (row && el.dataset.f === 'corresponding') { data.list[+row.dataset.i].corresponding = el.checked; change(); render(); return; }
    if (el.dataset.act === 'fromlib' && el.value !== '') {
      const a = { ...clone(lib[+el.value]), id: newAffilId() };
      if (!data.affils.some(x => sameAffil(x, a))) data.affils.push(a);
      change(); render();
    }
  };
  dlg.onclick = async (e) => {
    const el = e.target;
    if (el === dlg || el.dataset.act === 'close') { dlg.hidden = true; view.focus(); return; }
    const act = el.dataset.act;
    if (!act || el.tagName === 'SELECT') return;
    const row = el.closest('tr[data-i]');
    const i = row ? +row.dataset.i : -1;
    const af = el.closest('.affil');
    if (act === 'addauthor') data.list.push({ name: '', affils: [], corresponding: false, email: '' });
    else if (act === 'del') data.list.splice(i, 1);
    else if (act === 'up' && i > 0) [data.list[i - 1], data.list[i]] = [data.list[i], data.list[i - 1]];
    else if (act === 'down' && i < data.list.length - 1) [data.list[i + 1], data.list[i]] = [data.list[i], data.list[i + 1]];
    else if (act === 'addaff') data.affils.push({ id: newAffilId(), dept: '', inst: '', street: '', postcode: '', city: '', country: '' });
    else if (act === 'delaff') { const id = af.dataset.id; data.affils = data.affils.filter(a => a.id !== id); data.list.forEach(au => { au.affils = (au.affils || []).filter(x => x !== id); }); }
    else if (act === 'tolib') { const a = data.affils.find(x => x.id === af.dataset.id); const { id, ...rest } = a; lib.push(rest); await saveLib(); }
    else if (act === 'libexport') { await api().affilLibrary('export', lib); return; }
    else if (act === 'libimport') { const more = await api().affilLibrary('import'); if (Array.isArray(more)) { for (const a of more) if (!lib.some(x => sameAffil(x, a))) lib.push(a); await saveLib(); } }
    else return;
    change(); render();
  };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { dlg.hidden = true; view.focus(); } };
  render();
  dlg.hidden = false;
  const first = dlg.querySelector('input[data-f="name"]');
  if (first) first.focus();
}
