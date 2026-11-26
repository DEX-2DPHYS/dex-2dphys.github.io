/* Document style: applied to the editor page as CSS variables, edited in a dialog.
   Changes are document steps (undoable, saved in the file). */
import { STYLES as CITE_STYLES, citeStyleLabel } from '../../core/references.js';
import { journalById, describeJournal } from '../../core/journalstyles.js';
import { openJournalDialog } from './journaldialog.js';
import { SPACINGS, FIG_LABELS, LANGS, FONTS, LEVELS, LEVEL_LABEL, SIZES, DELTAS, SWATCHES, NUMBERINGS, AFFIL_MARKERS, AFFIL_FIELDS, DEFAULT_STYLE, styleOf, resolveStyle, levelSize, headingLabel } from '../../core/style.js';

/** Put the document style on the editor page (CSS variables used by style.css). */
export function applyStyleToPage(doc, page) {
  const st = styleOf(doc);
  const set = (k, v) => page.style.setProperty(k, v);
  set('--body-font', FONTS[st.font].css);
  set('--body-size', st.size + 'pt');
  set('--title-align', st.titleAlign);
  set('--body-leading', String(1.45 + (st.spacing - 1) * 0.9));
  // the document language: the page's lang (Chromium uses it) and the spell-checker's dictionary
  if (page.getAttribute('lang') !== st.lang) {
    page.setAttribute('lang', st.lang);
    if (window.dsw && window.dsw.setSpellLanguage) window.dsw.setSpellLanguage(st.lang);
  }
  for (const k of LEVELS) {
    set('--' + k + '-size', levelSize(st, k) + 'pt');
    set('--' + k + '-weight', st[k].bold ? '700' : '400');
    set('--' + k + '-style', st[k].italic ? 'italic' : 'normal');
    set('--' + k + '-color', st[k].color);
  }
}

function setStyle(view, st) {
  view.dispatch(view.state.tr.setDocAttribute('style', resolveStyle(st)));
}

const SAMPLE_COUNTERS = [2, 1, 3, 2];

export function openStyleDialog(view) {
  let dlg = document.querySelector('#styledlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'styledlg'; document.body.appendChild(dlg); }
  const render = () => {
    const st = styleOf(view.state.doc);
    const opt = (v, cur, label) => '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>';
    let rows = '';
    for (const k of LEVELS) {
      const v = st[k];
      const lvl = k === 'title' ? 0 : +k.slice(1);
      const num = lvl ? headingLabel(st, SAMPLE_COUNTERS, lvl) : null;
      rows += '<tr data-level="' + k + '"><th>' + LEVEL_LABEL[k] + '</th>'
        + '<td><select data-f="delta">' + DELTAS.map(d => opt(d, v.delta, (d ? 'body +' + d : 'body size') + ' (' + (st.size + d) + ' pt)')).join('') + '</select></td>'
        + '<td><label><input type="checkbox" data-f="bold"' + (v.bold ? ' checked' : '') + '> <b>B</b></label></td>'
        + '<td><label><input type="checkbox" data-f="italic"' + (v.italic ? ' checked' : '') + '> <i>I</i></label></td>'
        + '<td>' + (lvl ? '<select data-f="num" title="Numbering">' + NUMBERINGS.map(([n, label]) => opt(n, v.num, label)).join('') + '</select>' : '') + '</td>'
        + '<td class="colors"><input type="color" data-f="color" value="' + v.color + '" title="Colour">'
        + SWATCHES.map(([c, n]) => '<button class="sw' + (c === v.color ? ' on' : '') + '" data-color="' + c + '" title="' + n + '" style="background:' + c + '"></button>').join('') + '</td>'
        + '<td class="sample" style="font-family:' + FONTS[st.font].css.replace(/"/g, '&quot;') + ';font-size:' + levelSize(st, k) + 'pt;font-weight:' + (v.bold ? 700 : 400) + ';font-style:' + (v.italic ? 'italic' : 'normal') + ';color:' + v.color + '">'
        + (lvl ? (num ? num + '&ensp;' : '') + 'Results' : 'Paper title') + '</td></tr>';
    }
    dlg.innerHTML = '<div class="box"><h3>Document style</h3>'
      + '<div class="row"><span class="lab">Font</span>' + Object.entries(FONTS).map(([key, f]) => '<label class="fontopt"><input type="radio" name="font" value="' + key + '"' + (st.font === key ? ' checked' : '') + '> <span style="font-family:' + f.css.replace(/"/g, '&quot;') + '">' + f.label + '</span> <small>with ' + f.mathLabel + ' for equations</small></label>').join('') + '</div>'
      + '<div class="row"><span class="lab">Body text</span><select data-body="size">' + SIZES.map(s => opt(s, st.size, s + ' pt')).join('') + '</select>'
      + '<span class="lab" style="margin-left:24px">Title block</span><label><input type="radio" name="talign" value="left"' + (st.titleAlign === 'left' ? ' checked' : '') + '> left</label><label><input type="radio" name="talign" value="center"' + (st.titleAlign === 'center' ? ' checked' : '') + '> centred</label></div>'
      + '<table class="levels"><thead><tr><th></th><th>Size</th><th></th><th></th><th>Numbering</th><th>Colour</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div class="row"><span class="lab">Affiliations</span><select data-affil="marker">' + AFFIL_MARKERS.map(([m, l]) => opt(m, st.affil.marker, l)).join('') + '</select>'
      + '<select data-affil="fields">' + AFFIL_FIELDS.map(([f, l]) => opt(f, st.affil.fields, l)).join('') + '</select></div>'
      + '<div class="row"><span class="lab">Journal</span><span class="jname">' + (journalById(st.journal) ? '<b>' + journalById(st.journal).name + '</b> <small>' + describeJournal(journalById(st.journal)) + '</small>' : '<span class="muted">none chosen</span>') + '</span><button data-act="journal">Choose journal…</button></div>'
      + '<div class="row"><span class="lab">Layout</span><label>Line spacing <select data-lay="spacing">' + SPACINGS.map(([v, l]) => opt(v, st.spacing, l)).join('') + '</select></label>'
      + '<label><input type="checkbox" data-lay="lineNumbers"' + (st.lineNumbers ? ' checked' : '') + '> Line numbers <small>(PDF, Word, LaTeX)</small></label>'
      + '<label>Figures <select data-lay="figLabel">' + FIG_LABELS.map(v => opt(v, st.figLabel, '“' + v + ' 1”')).join('') + '</select></label></div>'
      + '<div class="row"><span class="lab">Citations</span><select data-cite="style">' + CITE_STYLES.map(([k, l]) => opt(k, st.cite, l)).join('') + (st.csl ? opt('csl:' + st.csl.name, st.cite, citeStyleLabel(view.state.doc, 'csl:' + st.csl.name) + ' (stored in the document)') : '') + '</select>'
      + '<span class="lab" style="margin-left:24px">Language</span><select data-lang="lang" title="Spell-check, hyphenation in the PDF, proofing language in Word">' + LANGS.map(([k, l]) => opt(k, st.lang, l)).join('') + '</select></div>'
      + '<p class="note">Saved in this document; used in the editor, the PDF and the Word export. In Word, equations use Cambria Math (co-authors have it).</p>'
      + '<div class="buttons"><button data-act="reset">Reset to defaults</button><button data-act="close" class="primary">Close</button></div></div>';
  };
  const update = (mutate) => { const st = JSON.parse(JSON.stringify(styleOf(view.state.doc))); mutate(st); setStyle(view, st); render(); };
  dlg.onchange = (e) => {
    const el = e.target;
    if (el.name === 'font') return update((st) => { st.font = el.value; });
    if (el.name === 'talign') return update((st) => { st.titleAlign = el.value; });
    if (el.dataset.body === 'size') return update((st) => { st.size = +el.value; });
    if (el.dataset.affil) return update((st) => { st.affil[el.dataset.affil] = el.value; });
    if (el.dataset.cite) return update((st) => { st.cite = el.value; st.journal = ''; });
    if (el.dataset.lay === 'spacing') return update((st) => { st.spacing = +el.value; st.journal = ''; });
    if (el.dataset.lay === 'lineNumbers') return update((st) => { st.lineNumbers = el.checked; st.journal = ''; });
    if (el.dataset.lay === 'figLabel') return update((st) => { st.figLabel = el.value; st.journal = ''; });
    if (el.dataset.lang) return update((st) => { st.lang = el.value; });
    const tr = el.closest('tr[data-level]');
    if (!tr) return;
    const k = tr.dataset.level, f = el.dataset.f;
    update((st) => { st[k][f] = f === 'delta' ? +el.value : (f === 'color' || f === 'num') ? el.value : el.checked; if (f === 'num') st.journal = ''; });
  };
  dlg.onclick = (e) => {
    const el = e.target;
    if (el === dlg || el.dataset.act === 'close') { dlg.hidden = true; view.focus(); return; }
    if (el.dataset.act === 'journal') { dlg.hidden = true; openJournalDialog(view, () => { render(); dlg.hidden = false; }); return; }
    if (el.dataset.act === 'reset') return update((st) => { Object.assign(st, JSON.parse(JSON.stringify(DEFAULT_STYLE))); });
    if (el.dataset.color) { const k = el.closest('tr[data-level]').dataset.level; update((st) => { st[k].color = el.dataset.color; }); }
  };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { dlg.hidden = true; view.focus(); } };
  render();
  dlg.hidden = false;
  const first = dlg.querySelector('input[name="font"]:checked');
  if (first) first.focus();
}
