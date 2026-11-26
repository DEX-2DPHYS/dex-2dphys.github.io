/* Help → Guide (F1, or the ? in the toolbar): what the program does and how, by topic, with a search box.
   The text lives here as data, so a new feature gets its lines in the same change that adds it.
   Help → Tutorial opens a document to practise in (tutorial.js). */
import { app, runCommand } from '../context.js';

/* [topic, [[what, how], …]] — "how" may use <kbd>, <b>, <i>. */
export const GUIDE = [
  ['Start here', [
    ['What it is', 'A writing program for scientific papers. What you see is the paper: no codes. The page preview on the right is the exact PDF.'],
    ['A new paper', '<b>New</b>, then type the title, click the author line to add authors and affiliations, and write. Headings: the style box in the toolbar, or <kbd>Ctrl+Alt+1</kbd> / <kbd>2</kbd> / <kbd>3</kbd>.'],
    ['Practise', 'Help → <b>Tutorial</b> opens a short document that asks you to try each thing once.'],
    ['Files', 'One file per paper, <code>name.dtusw</code>: text, figures, references, comments and changes are all inside it.'],
  ]],
  ['Equations', [
    ['In the text', '<kbd>Ctrl+M</kbd>, or type <code>$x^2$</code>. Type as you would say it: <code>x^2</code>, <code>a_n</code>, <code>\\alpha</code>, <code>/</code> for a fraction. <kbd>Enter</kbd> or <kbd>Esc</kbd> leaves the equation.'],
    ['On its own line', '<kbd>Ctrl+Shift+M</kbd>. The <b>#</b> button switches its number on or off.'],
    ['Symbols', 'While an equation is open, palettes stand left and right of the page: structures, Greek, operators, arrows.'],
    ['Bold, upright, text', 'Inside an equation: <kbd>Ctrl+B</kbd> bold (vectors), <kbd>Ctrl+I</kbd> upright (units, labels), <kbd>Ctrl+T</kbd> ordinary text.'],
    ['From LaTeX', 'Paste LaTeX source into the text: <code>$…$</code>, <code>equation</code>, <code>align</code> and the references between them become real equations.'],
  ]],
  ['Figures and tables', [
    ['A figure', '<b>Figure</b>, or paste / drop an image. Drag a corner to resize. The row under the toolbar sets where it goes: top of page, bottom, here, or with the text flowing around it.'],
    ['Look closely, mark up', 'Double-click a figure: it opens large, with a pen, a marker, text and comment boxes for marking what should change. The marks are not printed.'],
    ['A table', '<b>Table</b>, pick a size — or paste from Excel or Word. <kbd>Tab</kbd> moves between cells; <kbd>Tab</kbd> in the last cell adds a row.'],
    ['Captions and numbers', 'Type the caption under the figure (over the table). Numbers are automatic and follow when you move things.'],
  ]],
  ['Cross-references', [
    ['Refer to something', '<kbd>Ctrl+R</kbd>, type a few letters, <kbd>Enter</kbd>: “Fig. 3”, “Eq. (2)”, “Section 4”, “Table 1”. It follows the numbering.'],
    ['“Figs. 2 and 3”', 'Type the word yourself (“Figs. ”) and insert the references after it: they then show only the numbers.'],
    ['Contents and lists', 'Insert → Table of contents, List of figures, List of tables. Kept up to date.'],
    ['Footnotes', '<kbd>Ctrl+Alt+F</kbd>.'],
  ]],
  ['References', [
    ['Cite', '<kbd>Ctrl+Alt+C</kbd>: search your references in this paper and in Zotero, or paste a DOI or an arXiv number, or a BibTeX entry.'],
    ['The list', 'Appears at the end by itself; Insert → Reference list places it where you want it.'],
    ['Journal style', 'Format → <b>Journal style…</b>: pick the journal. It sets the reference style, section numbering, “Fig.” or “Figure”, line spacing and line numbers. Any other journal: its reference style is fetched for you.'],
    ['Check and repair', 'Format → Reference library → <b>Update from Zotero / DOI</b> fetches every reference again from its source and fixes journal abbreviations, title case and article numbers.'],
    ['Zotero', 'File → Settings: your Zotero key. Then Format → <b>Add references to Zotero library</b> sends the complete ones there; the Word export writes real Zotero citations for co-authors.'],
  ]],
  ['Working with others', [
    ['Comments', 'Select text (or click an equation), <kbd>Ctrl+Alt+M</kbd>, type, <kbd>Ctrl+Enter</kbd>. Reply and resolve on the card beside the page.'],
    ['Hide the margin', '<b>Hide</b> at the top of the comment margin (or View → Comments and changes beside the page) gives the page its full width. Click the count at the bottom of the window to show it again.'],
    ['Track changes', '<b>Track</b> (<kbd>Ctrl+Shift+T</kbd>): from then on what you type, delete or move is a suggestion in your colour. Each has a card with ✓ Accept and ✗ Reject. Review menu: next change <kbd>F7</kbd>, accept or reject all, show the final or the original text.'],
    ['On a shared drive', 'The first to open a paper edits it; the others get it read-only and can still comment. A save never overwrites someone else’s newer version.'],
    ['Co-authors in Word', '<b>Word</b> exports a real Word file: equations, numbered captions, cross-references, comments, tracked changes. File → <b>Import Word document…</b> brings their version back, with their comments and tracked changes.'],
    ['Co-authors in LaTeX', 'File → Export LaTeX (for Overleaf): one zip to upload.'],
  ]],
  ['Supporting Information', [
    ['Add it', 'Insert → <b>Supporting Information</b>: a second tab in the same paper. Its figures, tables, equations and sections are numbered S1, S2, …'],
    ['Refer across', 'A reference from the manuscript to “Fig. S2” is live: it follows when the SI changes.'],
    ['Export', 'PDF and Word write two files: <code>name</code> and <code>name-SI</code>.'],
    ['From Word', 'File → Import Word document as Supporting Information…'],
  ]],
  ['From a Word manuscript', [
    ['Import', 'File → Import Word document…: a new paper here; the Word file is not changed. A report lists what arrived and what to check.'],
    ['Typed references', 'Format → <b>Convert typed references</b>: “[1]”, superscript numbers and a typed reference list become real citations (each one looked up and verified); typed “Fig. 2” becomes a live reference.'],
  ]],
  ['Look and layout', [
    ['Document style', '<b>Style</b>: font, sizes, heading formats, line spacing, line numbers, language.'],
    ['Pages', 'The preview is the exact PDF (<kbd>F8</kbd> shows / hides it). View → <b>Page breaks in the text</b> also marks where each page starts while you write.'],
    ['Zoom', '<kbd>Ctrl</kbd> + mouse wheel, or the − / + in the toolbar. <kbd>Ctrl+0</kbd> is 100 %.'],
    ['Page break', '<kbd>Ctrl+Enter</kbd>.'],
  ]],
  ['Safety', [
    ['Saving', '<kbd>Ctrl+S</kbd>. Unsaved work is also kept every few seconds and offered again after a crash.'],
    ['Older versions', 'File → Backups of this document…: the earlier saves, to look at or restore.'],
    ['A Word copy always', 'File → Settings: “Always save a Word copy” writes <code>name.docx</code> next to the paper at every save.'],
  ]],
];

const strip = (s) => s.replace(/<[^>]+>/g, '').toLowerCase();

export function openGuide(topic) {
  let dlg = document.querySelector('#helpdlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'helpdlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  dlg.innerHTML = '<div class="box wide"><h3>Guide <small>what it does and how</small></h3>'
    + '<input type="search" class="hq" placeholder="Search: equation, Zotero, track changes, page break …" spellcheck="false">'
    + '<div class="hbody"><nav class="htopics"></nav><div class="hlist"></div></div>'
    + '<div class="buttons"><button data-act="tutorial">Open the tutorial</button><span class="grow"></span><button data-act="close" class="primary">Close</button></div></div>';
  const q = dlg.querySelector('.hq'), nav = dlg.querySelector('.htopics'), list = dlg.querySelector('.hlist');
  let current = GUIDE.some(g => g[0] === topic) ? topic : GUIDE[0][0];
  const close = () => { dlg.hidden = true; if (app.view) app.view.focus(); };
  const render = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    nav.innerHTML = GUIDE.map(([t]) => '<button data-topic="' + t + '"' + (!words.length && t === current ? ' class="on"' : '') + '>' + t + '</button>').join('');
    const groups = words.length
      ? GUIDE.map(([t, rows]) => [t, rows.filter(([a, b]) => words.every(w => strip(t + ' ' + a + ' ' + b).includes(w)))]).filter(g => g[1].length)
      : GUIDE.filter(g => g[0] === current);
    list.innerHTML = groups.length
      ? groups.map(([t, rows]) => (words.length ? '<h4>' + t + '</h4>' : '') + '<dl>' + rows.map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('') + '</dl>').join('')
      : '<p class="muted">Nothing found for “' + q.value.replace(/</g, '&lt;') + '”.</p>';
  };
  q.oninput = render;
  dlg.onclick = (e) => {
    const b = e.target.closest('button');
    if (e.target === dlg || (b && b.dataset.act === 'close')) return close();
    if (b && b.dataset.topic) { current = b.dataset.topic; q.value = ''; render(); }
    if (b && b.dataset.act === 'tutorial') { close(); runCommand('tutorial'); }
  };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  render();
  dlg.hidden = false;
  q.focus();
}
