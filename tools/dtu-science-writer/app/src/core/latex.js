/* Document -> LaTeX (step 5). For pdfLaTeX (what journals, arXiv and Overleaf expect by default).
   One main.tex plus references.bib and the figures; the export packs them as a zip that Overleaf uploads directly.
   - Numbers stay live: sections, figures, tables and equations get \label{<id>}, cross-references are \ref / \eqref
     (with "Fig.~", "Section~", … as in the editor — only the number after a typed "Fig. ").
   - Citations are \cite{keys}; the reference list is written out (thebibliography), formatted by the same citeproc
     style as the PDF and Word, so no BibTeX run is needed. references.bib holds the same library for BibTeX users.
   - Text is escaped character by character; common Unicode symbols become LaTeX commands (pdfLaTeX has no font for
     them). Math is the document's own LaTeX (normalised).
   Comments and figure annotations are review marks and are not exported. */
import { TableMap } from 'prosemirror-tables';
import { normalizeLatex } from './mathconv.js';
import { computeNumbers, numberOnly, refText, firstSentence, nextContext } from './numbering.js';
import { highlightHex } from './schema.js';
import { hasSupplement, splitParts } from './parts.js';
import { finalDoc } from './track.js';
import { styleOf } from './style.js';
import { formatAuthors } from './authors.js';
import { referencesFor, htmlSegments, isAuthorYear, libraryOf, toBibtex } from './references.js';

/* ---------- text ---------- */
const UNI = {
  '\u00a0': '~', '\u2009': '\\,', '\u202f': '\\,', '\u200b': '', '–': '--', '—': '---', '−': '$-$', '…': '\\ldots{}', '•': '\\textbullet{}',
  '×': '$\\times$', '·': '$\\cdot$', '±': '$\\pm$', '∓': '$\\mp$', '≈': '$\\approx$', '≃': '$\\simeq$', '∼': '$\\sim$', '≠': '$\\neq$',
  '≤': '$\\leq$', '≥': '$\\geq$', '≪': '$\\ll$', '≫': '$\\gg$', '→': '$\\rightarrow$', '←': '$\\leftarrow$', '↔': '$\\leftrightarrow$',
  '⇒': '$\\Rightarrow$', '∞': '$\\infty$', '∝': '$\\propto$', '∂': '$\\partial$', '∇': '$\\nabla$', '√': '$\\surd$', '′': '$\'$', '″': "$''$",
  '°': '\\textdegree{}', '℃': '\\textdegree{}C', 'Å': '\\AA{}', 'µ': '$\\mu$', 'ℏ': '$\\hbar$', '€': '\\texteuro{}', '©': '\\textcopyright{}',
  '⁰': '$^{0}$', '¹': '$^{1}$', '²': '$^{2}$', '³': '$^{3}$', '⁴': '$^{4}$', '⁵': '$^{5}$', '⁶': '$^{6}$', '⁷': '$^{7}$', '⁸': '$^{8}$', '⁹': '$^{9}$', '⁻': '$^{-}$', '⁺': '$^{+}$',
  '₀': '$_{0}$', '₁': '$_{1}$', '₂': '$_{2}$', '₃': '$_{3}$', '₄': '$_{4}$', '₅': '$_{5}$', '₆': '$_{6}$', '₇': '$_{7}$', '₈': '$_{8}$', '₉': '$_{9}$',
  '‘': '`', '’': "'", '“': '``', '”': "''",
};
const GREEK = 'αalpha βbeta γgamma δdelta εvarepsilon ϵepsilon ζzeta ηeta θtheta ϑvartheta ιiota κkappa λlambda μmu νnu ξxi πpi ρrho σsigma ςvarsigma τtau υupsilon φvarphi ϕphi χchi ψpsi ωomega ΓGamma ΔDelta ΘTheta ΛLambda ΞXi ΠPi ΣSigma ΦPhi ΨPsi ΩOmega';
for (const g of GREEK.split(' ')) UNI[g[0]] = '$\\' + g.slice(1) + '$';
const SPECIAL = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '%': '\\%', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '<': '\\textless{}', '>': '\\textgreater{}' };

/** Text -> LaTeX: specials escaped, known Unicode symbols as commands; letters with accents stay (inputenc utf8). */
export function texText(s) {
  let out = '';
  for (const ch of String(s)) out += SPECIAL[ch] !== undefined ? SPECIAL[ch] : UNI[ch] !== undefined ? UNI[ch] : ch;
  return out.replace(/\$\$/g, '');            // two adjacent symbols: $\pm$$\infty$ -> one math group
}

const MARK_CMD = { bold: 'textbf', italic: 'emph', underline: 'underline', sup: 'textsuperscript', sub: 'textsubscript' };
const MARK_ORDER = ['bold', 'italic', 'underline', 'sup', 'sub'];
const label = (id) => (id ? '\\label{' + id + '}' : '');

/** A LaTeX label/ref name from our ids (they are already safe: letters, digits, hyphens). */
const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9:._-]/g, '-');

/* ---------- inline ---------- */
function inline(node, ctx) {
  let out = '', prevText = '';
  node.forEach((c) => {
    let piece;
    switch (c.type.name) {
      case 'text': piece = texText(c.text); break;
      case 'math_inline': piece = mathInline(c.attrs.latex); break;
      case 'hard_break': piece = '\\newline{}'; break;
      case 'xref': piece = xref(c.attrs.target, ctx, prevText); break;
      case 'citation': piece = citation(c, ctx); break;
      case 'footnote': piece = '\\footnote{' + inline(c, ctx) + '}'; break;
      default: piece = texText(c.textContent);
    }
    const hl = c.marks.find(k => k.type.name === 'highlight'), col = c.marks.find(k => k.type.name === 'color');
    if (hl && c.type.name === 'text' && piece.trim()) { piece = '\\hlc{' + highlightHex(hl.attrs.color) + '}{' + piece + '}'; ctx.usesHighlight = true; }
    if (col && /^[0-9A-F]{6}$/i.test(col.attrs.color)) { piece = '\\textcolor[HTML]{' + col.attrs.color.toUpperCase() + '}{' + piece + '}'; ctx.usesColor = true; }
    for (const m of [...MARK_ORDER].reverse()) if (c.marks.some(k => k.type.name === m)) piece = '\\' + MARK_CMD[m] + '{' + piece + '}';
    out += piece;
    prevText = nextContext(prevText, c);
  });
  return out;
}
const mathInline = (latex) => { const t = normalizeLatex(latex); return t ? '$' + t + '$' : ''; };

function xref(target, ctx, prevText) {
  const info = ctx.nums.byId.get(target);
  if (!info) { ctx.problems.push({ kind: 'xref', target }); return '??'; }
  const id = safeId(target);
  if (info.type === 'heading' && !info.num) return '``' + texText(info.snippet) + "''";
  const only = numberOnly(info, prevText);
  if (info.type === 'equation') return only ? (/\(\s*$/.test(prevText) ? '\\ref{' + id + '}' : '\\eqref{' + id + '}') : 'Eq.~\\eqref{' + id + '}';
  if (only) return '\\ref{' + id + '}';
  const word = { figure: info.label || 'Fig.', table_figure: 'Table', heading: info.appendix ? 'Appendix' : 'Section' }[info.type];
  return word + '~\\ref{' + id + '}';
}

function citation(node, ctx) {
  const items = (node.attrs.items || []).filter(x => ctx.lib[x.id]);
  if (!items.length) return '[?]';
  if (ctx.authorYear) return segments(htmlSegments(ctx.cites.citeHtml(node)));        // the formatted text itself
  const keys = items.map(x => safeId(x.id));
  const loc = items.length === 1 && items[0].locator ? '[p.~' + texText(items[0].locator) + ']' : '';
  return '\\cite' + loc + '{' + keys.join(',') + '}';
}

/** Formatted reference text (htmlSegments) -> LaTeX. */
function segments(segs) {
  const CMD = { italic: 'textit', bold: 'textbf', sup: 'textsuperscript', sub: 'textsubscript', smallcaps: 'textsc' };
  return segs.map((s) => { let p = texText(s.text); for (const m of s.marks) if (CMD[m]) p = '\\' + CMD[m] + '{' + p + '}'; return p; }).join('');
}

/* ---------- blocks ---------- */
const SECTION = ['section', 'subsection', 'subsubsection', 'paragraph'];
const COUNTER_CMD = { 1: 'arabic', i: 'roman', I: 'Roman', a: 'alph', A: 'Alph' };

function heading(n, ctx) {
  const lvl = Math.min(Math.max(n.attrs.level, 1), 4);
  let pre = '';
  if (n.attrs.appendix && lvl === 1 && !ctx.appendixDone) { ctx.appendixDone = true; pre = '\\appendix\n'; }
  const numbered = n.attrs.numbered && ctx.style['h' + lvl].num !== 'none';
  const body = inline(n, ctx);
  // an unnumbered heading still belongs in the table of contents
  const toc = numbered ? '' : '\\addcontentsline{toc}{' + SECTION[lvl - 1] + '}{' + body + '}';
  return pre + '\\' + SECTION[lvl - 1] + (numbered ? '' : '*') + '{' + body + '}' + toc + label(n.attrs.id && safeId(n.attrs.id));
}

function equation(n) {
  const t = normalizeLatex(n.attrs.latex);
  if (n.attrs.numbered) return '\\begin{equation}\n  ' + t + '\n  ' + label(n.attrs.id && safeId(n.attrs.id)) + '\n\\end{equation}';
  return '\\[\n  ' + t + '\n\\]';
}

function caption(cap, ctx) {
  const long = inline(cap, ctx);
  // with a list of figures/tables, the list shows the first sentence (as in the PDF)
  if (ctx.shortCaptions) return '\\caption[' + texText(firstSentence(cap.textContent)) + ']{' + long + '}';
  return '\\caption{' + long + '}';
}

function figure(n, ctx) {
  const img = n.firstChild, cap = n.lastChild;
  const w = Math.min(Math.max(n.attrs.width || 0.8, 0.1), 1);
  const file = img && img.attrs.src ? ctx.figureFile(img.attrs.src) : null;
  const graphic = file ? '\\includegraphics[width=' + (n.attrs.placement === 'wrap' ? '\\linewidth' : w.toFixed(2) + '\\linewidth') + ']{figures/' + file + '}' : '\\fbox{missing image}';
  const lab = label(n.attrs.id && safeId(n.attrs.id));
  if (n.attrs.placement === 'wrap') {
    return '\\begin{wrapfigure}{' + (n.attrs.side === 'left' ? 'l' : 'r') + '}{' + Math.min(w, 0.6).toFixed(2) + '\\textwidth}\n  \\centering\n  ' + graphic + '\n  ' + caption(cap, ctx) + lab + '\n\\end{wrapfigure}';
  }
  const pos = n.attrs.placement === 'float' ? (n.attrs.pos === 'bottom' ? 'b' : 't') : '!htb';
  return '\\begin{figure}[' + pos + ']\n  \\centering\n  ' + graphic + '\n  ' + caption(cap, ctx) + lab + '\n\\end{figure}';
}

/** Booktabs table; \multicolumn for merged columns, \multirow for merged rows (covered slots stay empty). */
function tableTex(table, ctx) {
  const map = TableMap.get(table);
  const W = map.width, H = map.height;
  const at = new Map();                   // "r,c" -> { cell, rowspan, colspan } for the top-left slot of each cell
  map.map.forEach((pos, i) => {
    const r = Math.floor(i / W), c = i % W;
    const rect = map.findCell(pos);
    if (rect.top === r && rect.left === c) at.set(r + ',' + c, table.nodeAt(pos));
  });
  let headerRows = 0;
  for (let r = 0; r < table.childCount; r++) { let all = true; table.child(r).forEach(c => { if (c.type.name !== 'table_header') all = false; }); if (!all) break; headerRows++; }
  const rows = [];
  for (let r = 0; r < H; r++) {
    const cells = [];
    for (let c = 0; c < W;) {
      const pos = map.map[r * W + c];
      const rect = map.findCell(pos);
      const cs = rect.right - rect.left;
      if (rect.top !== r) { cells.push(cs > 1 ? '\\multicolumn{' + cs + '}{c}{}' : ''); c += cs; continue; }   // under a \multirow
      const cell = at.get(r + ',' + c);
      let body = [];
      cell.forEach((p) => body.push(inline(p, ctx)));
      body = body.join(' \\newline ');
      if (cell.type.name === 'table_header') body = '\\textbf{' + body + '}';
      const rs = rect.bottom - rect.top;
      if (rs > 1) body = '\\multirow{' + rs + '}{*}{' + body + '}';
      const al = { left: 'l', center: 'c', right: 'r' }[cell.attrs.align] || null;
      if (cs > 1 || al) body = '\\multicolumn{' + cs + '}{' + (al || 'c') + '}{' + body + '}';
      cells.push(body);
      c += cs;
    }
    rows.push('    ' + cells.join(' & ') + ' \\\\');
  }
  const lines = ['  \\begin{tabular}{' + 'l'.repeat(W) + '}', '    \\toprule'];
  rows.forEach((row, i) => { lines.push(row); if (i === headerRows - 1 && headerRows) lines.push('    \\midrule'); });
  lines.push('    \\bottomrule', '  \\end{tabular}');
  return lines.join('\n');
}

function tableFigure(n, ctx) {
  const cap = n.firstChild, table = n.lastChild;
  const pos = n.attrs.placement === 'float' ? (n.attrs.pos === 'bottom' ? 'b' : 't') : '!htb';
  return '\\begin{table}[' + pos + ']\n  \\centering\n  ' + caption(cap, ctx) + label(n.attrs.id && safeId(n.attrs.id)) + '\n' + tableTex(table, ctx) + '\n\\end{table}';
}

function list(n, ctx, depth) {
  const env = n.type.name === 'ordered_list' ? 'enumerate' : 'itemize';
  const out = ['\\begin{' + env + '}'];
  if (env === 'enumerate' && (n.attrs.order || 1) !== 1) out.push('\\setcounter{enum' + 'i'.repeat(Math.min(depth + 1, 4)) + '}{' + ((n.attrs.order || 1) - 1) + '}');
  n.forEach((item) => {
    const parts = [];
    item.forEach((c) => parts.push(c.type.name === 'paragraph' ? inline(c, ctx) : list(c, ctx, depth + 1)));
    out.push('  \\item ' + parts.join('\n'));
  });
  out.push('\\end{' + env + '}');
  return out.join('\n');
}

function bibliography(node, ctx) {
  const { entries } = ctx.cites.refs.bib;
  const title = (node && node.attrs.title) || 'References';
  if (!entries.length) return '';
  if (ctx.authorYear) {
    return '\\section*{' + texText(title) + '}\n\\begin{list}{}{\\leftmargin=1.5em \\itemindent=-1.5em \\itemsep=2pt \\parsep=0pt}\n'
      + entries.map(e => '  \\item ' + segments(htmlSegments(e.html))).join('\n') + '\n\\end{list}';
  }
  // numbered: LaTeX numbers the \bibitem entries in this order, which is the style's order
  return '\\renewcommand{\\refname}{' + texText(title) + '}\n\\begin{thebibliography}{' + (entries.length > 9 ? '99' : '9') + '}\n'
    + entries.map(e => '  \\bibitem{' + safeId(e.id) + '} ' + segments(htmlSegments(e.html))).join('\n') + '\n\\end{thebibliography}';
}

function blocks(doc, ctx) {
  const out = [];
  let prev = null;
  doc.forEach((n) => {
    // text that continues a sentence after a display equation ("… where x is …") is not a new paragraph in LaTeX:
    // no blank line, so it is not indented
    if (n.type.name === 'paragraph' && prev === 'equation' && /^[a-z]/.test(n.textContent.trim()) && out.length) {
      out[out.length - 1] += '\n' + inline(n, ctx);
      prev = n.type.name;
      return;
    }
    prev = n.type.name;
    switch (n.type.name) {
      case 'title': case 'authors': break;                                   // in the preamble (\maketitle)
      case 'abstract': if (n.textContent.trim()) { const ps = []; n.forEach(p => ps.push(inline(p, ctx))); out.push('\\begin{abstract}\n' + ps.join('\n\n') + '\n\\end{abstract}'); } break;
      case 'paragraph': if (n.content.size) out.push(inline(n, ctx)); break;
      case 'heading': out.push(heading(n, ctx)); break;
      case 'equation': out.push(equation(n)); break;
      case 'figure': out.push(figure(n, ctx)); break;
      case 'table_figure': out.push(tableFigure(n, ctx)); break;
      case 'bullet_list': case 'ordered_list': out.push(list(n, ctx, 0)); break;
      case 'bibliography': ctx.bibDone = true; out.push(bibliography(n, ctx)); break;
      case 'outline': out.push({ contents: '\\tableofcontents', figures: '\\listoffigures', tables: '\\listoftables' }[n.attrs.kind] || ''); break;
      case 'page_break': out.push('\\clearpage'); break;
      default: if (n.textContent) out.push(texText(n.textContent));
    }
  });
  return out.filter(Boolean).join('\n\n');
}

/* ---------- preamble ---------- */
const BABEL = { 'en-GB': 'british', 'en-US': 'american', 'da-DK': 'danish', 'de-DE': 'ngerman' };

/** The Supplementary Information on its own: S1, S1.1, Fig. S1, Table S1, Eq. (S1). */
function SI_NUMBERING(st) {
  const lines = ['\\renewcommand{\\thefigure}{S\\arabic{figure}}', '\\renewcommand{\\thetable}{S\\arabic{table}}', '\\renewcommand{\\theequation}{S\\arabic{equation}}'];
  if (st.h1.num === 'none') lines.push('\\setcounter{secnumdepth}{0}');
  else lines.push('\\renewcommand{\\thesection}{S\\arabic{section}}', '\\renewcommand{\\thesubsection}{\\thesection.\\arabic{subsection}}', '\\renewcommand{\\thesubsubsection}{\\thesubsection.\\arabic{subsubsection}}');
  return lines;
}

function sectionNumbering(st) {
  // our rule (style.headingLabel): '1' under all-'1' parents is hierarchical (1.2.3), other formats stand alone
  const lines = [];
  for (let l = 1; l <= 4; l++) {
    const f = st['h' + l].num;
    if (f === 'none') continue;
    const chain = f === '1' && [...Array(l).keys()].every(i => st['h' + (i + 1)].num === '1');
    if (!chain || l === 4) lines.push('\\renewcommand{\\the' + SECTION[l - 1] + '}{' + (chain ? '\\the' + SECTION[l - 2] + '.' : '') + '\\' + COUNTER_CMD[f] + '{' + SECTION[l - 1] + '}}');
  }
  return lines;
}

function titleBlock(doc, ctx) {
  let title = '', fa = { authors: [], affils: [], corresponding: [] };
  doc.forEach((n) => {
    if (n.type.name === 'title') title = inline(n, ctx);
    if (n.type.name === 'authors') fa = formatAuthors(n.attrs, ctx.style.affil);
  });
  // a supplementary document: its name above the title; a free author line instead of the author block
  const label = doc.attrs.partLabel ? '{\\large\\bfseries ' + texText(doc.attrs.partLabel) + '}' + (title ? '\\\\[0.8em] ' : '') : '';
  const lines = ['\\title{' + label + title + '}'];
  if (doc.attrs.partAuthors) { lines.push('\\author{' + texText(doc.attrs.partAuthors) + '}', '\\date{}'); return lines.join('\n'); }
  for (const a of fa.authors) {
    const marks = [a.marks, a.corresponding ? '*' : ''].filter(Boolean).join(',');
    lines.push('\\author' + (marks ? '[' + texText(marks) + ']' : '') + '{' + texText(a.name) + '}');
  }
  for (const a of fa.affils) lines.push('\\affil[' + texText(a.mark) + ']{' + texText(a.text) + '}');
  for (const c of fa.corresponding) if (c.email) lines.push('\\affil[*]{Corresponding author: \\href{mailto:' + c.email.replace(/[^\w.@+-]/g, '') + '}{' + texText(c.email) + '}}');
  lines.push('\\date{}');
  return lines.join('\n');
}

/**
 * Whole document -> { tex, bib, figures: [{ name, src }], problems }.
 * opts.imageName(src) -> file name for a media item (the caller writes the bytes, rasterising SVGs).
 */
export function docToLatex(doc, opts = {}) {
  doc = finalDoc(doc);                                         // tracked changes: LaTeX gets the final text
  if (hasSupplement(doc)) doc = splitParts(doc).main;          // the SI is its own document (parts.js)
  const style = styleOf(doc);
  const cites = referencesFor(doc, style.cite);
  const figures = new Map();                 // src -> file name
  const ctx = {
    style, cites, lib: libraryOf(doc), nums: computeNumbers(doc), problems: [], authorYear: isAuthorYear(doc, style.cite),
    figureFile: (src) => {
      if (!figures.has(src)) {
        const base = (opts.imageName ? opts.imageName(src) : src).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'figure';
        // pdfLaTeX reads PNG and JPEG; SVG and GIF are converted to PNG by the caller
        const ext = /\.jpe?g$/i.test(src) ? '.jpg' : '.png';
        let name = base + ext, k = 2;
        const taken = new Set(figures.values());
        while (taken.has(name)) name = base + '-' + (k++) + ext;
        figures.set(src, name);
      }
      return figures.get(src);
    },
    shortCaptions: false,
  };
  doc.forEach((n) => { if (n.type.name === 'outline' && n.attrs.kind !== 'contents') ctx.shortCaptions = true; });
  const body = blocks(doc, ctx);
  const bib = !ctx.bibDone && cites.needsList ? bibliography(null, ctx) : '';
  const superCite = !ctx.authorYear && cites.refs.cites.some(h => /<sup>/.test(h));
  const pre = [
    '% Exported by DTU Science Writer. Compile with pdfLaTeX (twice, for the cross-references).',
    '% references.bib holds the same references for BibTeX; the reference list below is written out in the document\'s',
    '% citation style, so no BibTeX run is needed.',
    '\\documentclass[' + (style.size >= 11.5 ? '12pt' : style.size >= 10.5 ? '11pt' : '10pt') + ',a4paper]{article}',
    '\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}',
    '\\usepackage[' + (BABEL[style.lang] || 'british') + ']{babel}',
    // amsmath before newtxmath; newtxmath has the AMS symbols itself (amssymb with it is an error)
    '\\usepackage{amsmath}',
    style.font === 'arial' ? '\\usepackage{amssymb}\n\\usepackage[scaled]{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}' : '\\usepackage{newtxtext,newtxmath}',
    '\\usepackage[margin=2.5cm]{geometry}',
    '\\usepackage{graphicx}', '\\usepackage{booktabs,multirow}', '\\usepackage{wrapfig}',
    '\\usepackage{textcomp}', '\\usepackage{authblk}',
    '\\usepackage[labelsep=period,labelfont=bf,font=small]{caption}',        // "Fig. 1." in bold, as in the app
    superCite ? '\\usepackage[super]{cite}' : '\\usepackage{cite}',
    ...(ctx.usesColor || ctx.usesHighlight ? ['\\usepackage{xcolor}'] : []),
    ...(ctx.usesHighlight ? ['\\usepackage{soul}', '\\newcommand{\\hlc}[2]{{\\definecolor{dswhl}{HTML}{#1}\\sethlcolor{dswhl}\\hl{#2}}}'] : []),
    '\\usepackage[hidelinks]{hyperref}',
    '\\renewcommand{\\figurename}{' + style.figLabel + '}',
    ...(style.spacing > 1 ? ['\\usepackage{setspace}', style.spacing >= 2 ? '\\doublespacing' : '\\onehalfspacing'] : []),
    ...(style.lineNumbers ? ['\\usepackage{lineno}', '\\linenumbers'] : []),
    '\\setcounter{secnumdepth}{4}',
    ...(doc.attrs.part === 'si' ? SI_NUMBERING(style) : sectionNumbering(style)),
    '',
    titleBlock(doc, ctx),
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
  ];
  const tex = pre.join('\n') + body + (bib ? '\n\n' + bib : '') + '\n\n\\end{document}\n';
  return { tex, bib: toBibtex(libraryOf(doc)), figures: [...figures].map(([src, name]) => ({ src, name })), problems: ctx.problems };
}
