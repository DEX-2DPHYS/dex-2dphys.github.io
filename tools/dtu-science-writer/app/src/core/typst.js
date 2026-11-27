/* Document -> Typst source (preview and PDF). DESIGN.md §7.1.
   Text is escaped character by character, so nothing the writer types can turn into Typst code. */
import { TableMap } from 'prosemirror-tables';
import { latexToTypst } from './mathconv.js';
import { FONTS, styleOf, levelSize } from './style.js';
import { computeNumbers, numberOnly, refText, OUTLINE_TITLE, firstSentence, nextContext } from './numbering.js';
import { highlightHex } from './schema.js';
import { hasSupplement, splitParts } from './parts.js';
import { finalWithMapping } from './track.js';
import { formatAuthors } from './authors.js';
import { referencesFor, htmlSegments } from './references.js';

export const PAGE = { paper: 'a4', margin: '2.5cm' };

// Characters that can start Typst syntax (markup, code, math, labels, refs, comments, shorthands).
// "." and "(" are included so text right after a #fn[...] call is never read as a method call or argument.
// Quotes are left alone so Typst turns them into typographic quotes.
const ESC = /[\\*_`$#\[\]<>@~=\-+\/.()]/g;
export function escText(s) {
  return s.replace(ESC, (c) => '\\' + c);
}
const str = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

const MATH_OPTS = { textFn: 'bodytext' };     // \text{…} -> body font (see preamble)

const MARK_FN = { bold: 'strong', italic: 'emph', underline: 'underline', sup: 'super', sub: 'sub' };
const MARK_ORDER = ['bold', 'italic', 'underline', 'sup', 'sub'];

/** text(...) arguments for a title/heading level of the document style. */
function levelText(st, k) {
  const v = st[k];
  return 'size: ' + levelSize(st, k) + 'pt, weight: ' + (v.bold ? '"bold"' : '"regular"') + ', style: ' + (v.italic ? '"italic"' : '"normal"') + ', fill: rgb(' + str(v.color) + ')';
}

export function preamble(st, part) {
  const f = FONTS[st.font];
  return [
    '#import "@preview/meander:0.4.6"',
    `#set page(paper: ${str(PAGE.paper)}, margin: ${PAGE.margin}, numbering: "1")`,
    `#set text(font: ${str(f.body)}, size: ${st.size}pt, lang: ${str(st.lang.slice(0, 2))}, region: ${str(st.lang.slice(3).toLowerCase())})`,
    `#show math.equation: set text(font: ${str(f.math)})`,
    // plain text inside equations (\text{…}) is set in the body font, like the text around it
    `#let bodytext(s) = text(font: ${str(f.body)}, s)`,
    // line spacing 1 / 1.5 / 2: Typst's "leading" is the gap between lines (0.65em when single)
    '#set par(justify: true, leading: ' + (0.65 + (st.spacing - 1) * 1.2).toFixed(2) + 'em, spacing: ' + (0.9 + (st.spacing - 1) * 1.2).toFixed(2) + 'em)',
    ...(st.lineNumbers ? ['#set par.line(numbering: n => text(size: 0.7em, fill: luma(110))[#n])', '#show figure: set par.line(numbering: none)', '#show footnote.entry: set par.line(numbering: none)'] : []),
    // heading numbers are precomputed (numbering.js) and given per heading, so editor, PDF and Word agree
    '#set heading(supplement: [Section])',
    '#show heading: set block(above: 1.5em, below: 0.9em)',
    '#show heading.where(level: 1): set text(' + levelText(st, 'h1') + ')',
    '#show heading.where(level: 2): set text(' + levelText(st, 'h2') + ')',
    '#show heading.where(level: 3): set text(' + levelText(st, 'h3') + ')',
    '#show heading.where(level: 4): set text(' + levelText(st, 'h4') + ')',
    part === 'si' ? '#set math.equation(numbering: n => "(S" + str(n) + ")", supplement: [Eq.])' : '#set math.equation(numbering: "(1)", supplement: [Eq.])',
    ...(part === 'si' ? ['#set figure(numbering: n => "S" + str(n))'] : []),
    // equation references read "Eq. (3)", like the equation number itself
    '#show ref: it => { let el = it.element; if el != none and el.func() == math.equation { link(el.location(), [Eq.~#numbering(el.numbering, ..counter(math.equation).at(el.location()))]) } else { it } }',
    '#show figure.where(kind: image): set figure(supplement: [' + st.figLabel + '])',
    '#show figure.where(kind: table): set figure.caption(position: top)',
    '#show figure.where(kind: table): set block(breakable: true)',
    '#show table: set text(size: 0.95em)',
    '#show table: set par(justify: false)',
    '#set figure(gap: 0.7em)',
    '#show figure.caption: it => block(width: 100%, align(left, text(size: 0.92em)[*#it.supplement~#context it.counter.display(it.numbering).* #it.body]))',
    '#show figure: set block(breakable: false)',
    // lists of figures/tables show short captions (captionTypst); the outline's own heading is not numbered
    '#let in-outline = state("in-outline", false)',
    '#show outline: it => { in-outline.update(true); it; in-outline.update(false) }',
    '',
  ].join('\n');
}

/** Inline content of a node -> Typst markup. */
export function inlineToTypst(node, ctx) {
  let out = '';
  let prevText = '';
  node.forEach((child) => {
    let piece;
    switch (child.type.name) {
      case 'text': piece = escText(child.text); break;
      case 'math_inline': piece = mathInline(child.attrs.latex, ctx); break;
      case 'xref': piece = xref(child.attrs.target, ctx, prevText); break;
      case 'citation': piece = segmentsToTypst(htmlSegments(ctx.cites.citeHtml(child))); break;
      case 'footnote': piece = '#footnote[' + inlineToTypst(child, ctx) + ']'; break;
      case 'hard_break': piece = '#linebreak()'; break;
      default: piece = escText(child.textContent);
    }
    for (const m of [...MARK_ORDER].reverse()) {
      if (child.marks.some(mk => mk.type.name === m)) piece = '#' + MARK_FN[m] + '[' + piece + ']';
    }
    const col = child.marks.find(mk => mk.type.name === 'color'), hl = child.marks.find(mk => mk.type.name === 'highlight');
    if (col && /^[0-9A-F]{6}$/i.test(col.attrs.color)) piece = '#text(fill: rgb("#' + col.attrs.color + '"))[' + piece + ']';
    if (hl) piece = '#highlight(fill: rgb("#' + highlightHex(hl.attrs.color) + '"))[' + piece + ']';
    out += piece;
    prevText = nextContext(prevText, child);
  });
  return out;
}

/** Formatted reference text (htmlSegments) -> Typst markup. */
const SEG_FN = { italic: 'emph', bold: 'strong', sup: 'super', sub: 'sub', smallcaps: 'smallcaps' };
function segmentsToTypst(segs) {
  return segs.map((s) => {
    let p = escText(s.text);
    for (const m of s.marks) if (SEG_FN[m]) p = '#' + SEG_FN[m] + '[' + p + ']';
    return p;
  }).join('');
}

/** The reference list: an unnumbered heading, then label + entry columns (numbered styles) or hanging indents. */
function bibliography(node, ctx) {
  const { entries, flush } = ctx.cites.refs.bib;
  const title = (node && node.attrs.title) || 'References';
  const out = ['#heading(level: 1, numbering: none)[' + escText(title) + ']'];
  if (!entries.length) return out.join('\n');
  if (flush) {
    const cells = entries.map(e => '[' + segmentsToTypst(htmlSegments(e.label)) + '], [' + segmentsToTypst(htmlSegments(e.html)) + ']');
    out.push('#block(text(size: 0.92em, grid(columns: (auto, 1fr), column-gutter: 0.6em, row-gutter: 0.55em,\n  ' + cells.join(',\n  ') + ',\n)))');
  } else {
    out.push('#block(text(size: 0.92em)[#set par(hanging-indent: 1.5em, justify: false, spacing: 0.55em)\n' + entries.map(e => segmentsToTypst(htmlSegments(e.html))).join('\n\n') + '])');
  }
  return out.join('\n');
}

/** A caption; with a list of figures/tables in the document, the list shows only its first sentence
    (state in-outline, set by the preamble's outline show rule). */
function captionTypst(cap, ctx) {
  const full = inlineToTypst(cap, ctx);
  if (!ctx.flexCaptions) return full;
  return '#context if in-outline.get() [' + escText(firstSentence(cap.textContent)) + '] else [' + full + ']';
}

/** Table of contents / list of figures / list of tables (figures and tables by the first sentence of the caption). */
function outline(node) {
  const kind = node.attrs.kind;
  const title = '[' + escText(node.attrs.title || OUTLINE_TITLE[kind] || 'Contents') + ']';
  if (kind === 'figures' || kind === 'tables') return '#outline(title: ' + title + ', target: figure.where(kind: ' + (kind === 'figures' ? 'image' : 'table') + '))';
  return '#outline(title: ' + title + ', depth: 3, indent: auto)';
}

function mathInline(latex, ctx) {
  try {
    const t = latexToTypst(latex, MATH_OPTS);
    return t ? '$' + t + '$' : '';
  } catch (e) {
    ctx.problems.push({ kind: 'math', latex, message: String(e.message || e) });
    return '#text(fill: red)[\\[math error\\]]';
  }
}

function xref(target, ctx, prevText) {
  if (!target || !ctx.ids.has(target)) {
    ctx.problems.push({ kind: 'xref', target, message: 'reference to a missing item' });
    return '#text(fill: red)[??]';
  }
  // an unnumbered heading cannot be @-referenced in Typst: link its title instead
  const info = ctx.nums.byId.get(target);
  if (info && info.type === 'heading' && !info.num) return '#link(<' + safeLabel(target) + '>)[' + escText(info.ref) + ']';
  // "Fig. " already typed before the reference: the number only (same rule as the editor)
  if (numberOnly(info, prevText)) return '#link(<' + safeLabel(target) + '>)[' + escText(refText(info, prevText)) + ']';
  return '#ref(<' + safeLabel(target) + '>)';
}

/* A label from a document id. Ids come from files other people made: anything but letters, digits, . _ - is
   replaced, so an id can never smuggle Typst code into the source. */
export const safeLabel = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_');
function label(id) { return id ? ' <' + safeLabel(id) + '>' : ''; }

function equation(node, ctx) {
  let body;
  try { body = latexToTypst(node.attrs.latex, MATH_OPTS); } catch (e) {
    ctx.problems.push({ kind: 'math', latex: node.attrs.latex, message: String(e.message || e) });
    return '#text(fill: red)[\\[equation error\\]]';
  }
  if (!body) body = '';
  if (node.attrs.numbered) return '$ ' + body + ' $' + label(node.attrs.id);
  return '#math.equation(block: true, numbering: none, $ ' + body + ' $)' + label(node.attrs.id);
}

function figureCall(node, ctx, inWrap) {
  const img = node.firstChild, cap = node.lastChild;
  const w = Math.round((node.attrs.width || 0.8) * 100);
  const imgSrc = img && img.attrs.src ? 'image(' + str(img.attrs.src) + ', width: ' + (inWrap ? '100%' : w + '%') + ')' : 'rect(width: ' + w + '%, height: 3cm, stroke: 0.5pt + gray)[missing image]';
  let placement = 'none';
  if (!inWrap && node.attrs.placement === 'float') placement = node.attrs.pos === 'bottom' ? 'bottom' : 'top';
  const args = [imgSrc, 'caption: [' + captionTypst(cap, ctx) + ']'];
  if (placement !== 'none') args.push('placement: ' + placement);
  return '#figure(' + args.join(', ') + ')' + label(node.attrs.id);
}

function wrapBlock(fig, paras, ctx) {
  const w = Math.round((fig.attrs.width || 0.4) * 100);
  const side = fig.attrs.side === 'left' ? 'left' : 'right';
  // absolute lengths: meander compares margins with 0pt and cannot do that with font-relative em
  const margin = side === 'left' ? '(right: 10pt, bottom: 6pt)' : '(left: 10pt, bottom: 6pt)';
  // meander drops the normal paragraph spacing between the paragraphs it flows; put it back explicitly
  const body = paras.map(p => inlineToTypst(p, ctx)).join('\n\n#v(0.9em)\n\n');
  return [
    '#meander.reflow({',
    '  import meander: *',
    '  opt.placement.spacing(below: 0.9em)',
    '  placed(top + ' + side + ', boundary: contour.margin' + margin + ', box(width: ' + w + '%)[' + figureCall(fig, ctx, true) + '])',
    '  container()',
    '  content[' + body + ']',
    '})',
  ].join('\n');
}

/* Tables: booktabs rules (thick top/bottom, thin under the header), no vertical lines.
   Cells are emitted in document order; Typst's auto-placement skips the slots covered by row/col spans,
   exactly like the editor's table map. Column widths dragged in the editor (CSS px) become pt. */
const PX_TO_PT = 0.75;
function tableTypst(table, ctx) {
  const map = TableMap.get(table);
  const widths = new Array(map.width).fill(null);
  table.forEach((row, _o, r) => {
    row.forEach((cell) => {
      const cw = cell.attrs.colwidth;
      if (!cw) return;
      const rect = map.findCell(map.map.find((p) => table.nodeAt(p) === cell));
      cw.forEach((w, i) => { if (w && widths[rect.left + i] == null) widths[rect.left + i] = w; });
    });
  });
  const columns = widths.every(w => w) ? '(' + widths.map(w => (w * PX_TO_PT).toFixed(1) + 'pt').join(', ') + ')' : String(map.width);
  let headerRows = 0;
  for (let r = 0; r < table.childCount; r++) {
    let allHead = true;
    table.child(r).forEach((c) => { if (c.type.name !== 'table_header') allHead = false; });
    if (!allHead) break;
    headerRows++;
  }
  const cellTypst = (cell) => {
    const body = [];
    cell.forEach((p) => body.push(inlineToTypst(p, ctx)));
    let content = '[' + body.join('\n\n') + ']';
    if (cell.type.name === 'table_header') content = '[#strong' + content + ']';
    const args = [];
    if (cell.attrs.colspan > 1) args.push('colspan: ' + cell.attrs.colspan);
    if (cell.attrs.rowspan > 1) args.push('rowspan: ' + cell.attrs.rowspan);
    if (cell.attrs.align) args.push('align: ' + cell.attrs.align);
    return args.length ? 'table.cell(' + args.join(', ') + ')' + content : content;
  };
  const rows = [];
  table.forEach((row) => { const cells = []; row.forEach((c) => cells.push(cellTypst(c))); rows.push(cells.join(', ')); });
  const parts = ['columns: ' + columns, 'stroke: none', 'inset: (x: 0.45em, y: 0.32em)', 'align: left + horizon', 'table.hline(stroke: 0.9pt)'];
  if (headerRows) {
    parts.push('table.header(' + rows.slice(0, headerRows).join(',\n    ') + ')');
    parts.push('table.hline(stroke: 0.5pt)');
  }
  for (const r of rows.slice(headerRows)) if (r) parts.push(r);
  parts.push('table.hline(stroke: 0.9pt)');
  return 'table(\n    ' + parts.join(',\n    ') + ',\n  )';
}

function tableFigure(node, ctx) {
  const cap = node.firstChild, table = node.lastChild;
  const args = [tableTypst(table, ctx), 'caption: [' + captionTypst(cap, ctx) + ']', 'kind: table'];
  if (node.attrs.placement === 'float') args.push('placement: ' + (node.attrs.pos === 'bottom' ? 'bottom' : 'top'));
  return '#figure(\n  ' + args.join(',\n  ') + ',\n)' + label(node.attrs.id);
}

function list(node, ctx, indent) {
  const marker = node.type.name === 'ordered_list' ? '+ ' : '- ';
  const lines = [];
  node.forEach((item) => {
    let first = true;
    item.forEach((child) => {
      if (child.type.name === 'paragraph') {
        lines.push(indent + (first ? marker : '  ') + inlineToTypst(child, ctx));
        first = false;
      } else lines.push(list(child, ctx, indent + '  '));
    });
  });
  return lines.join('\n');
}

/** Block sequence (doc or abstract) -> Typst. */
function blocks(parent, ctx) {
  const out = [];
  const kids = [], offs = [];
  parent.forEach((n, off) => { kids.push(n); offs.push(off); });
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    ctx.pos = offs[i];                        // document position (top level) for the precomputed numbers
    const made = out.length, index = i;
    if (ctx.positions && parent === ctx.top) ctx.markNext = true;
    switch (n.type.name) {
      // title block: collected and placed as the first top-of-page float, so figures go below it (as in LaTeX)
      case 'title':
        if (n.content.size) ctx.header.push('#align(' + ctx.style.titleAlign + ', block(below: 0.8em, text(' + levelText(ctx.style, 'title') + ')[' + inlineToTypst(n, ctx) + ']))');
        break;
      case 'authors': {
        const fa = formatAuthors(n.attrs, ctx.style.affil);
        if (!fa.authors.length) break;
        const names = fa.authors.map(a => escText(a.name) + (a.marks || a.corresponding ? '#super[' + escText(a.marks + (a.corresponding ? (a.marks ? ',' : '') + '*' : '')) + ']' : '')).join(', ');
        const lines = fa.affils.map(a => '#super[' + escText(a.mark) + ']' + escText(a.text));
        for (const c of fa.corresponding) if (c.email) lines.push('#super[' + escText('*') + ']Corresponding author: ' + escText(c.email));
        ctx.header.push('#align(' + ctx.style.titleAlign + ', block(below: 0.5em, text(size: 1.05em)[' + names + ']))');
        if (lines.length) ctx.header.push('#align(' + ctx.style.titleAlign + ', block(below: 1.4em, text(size: 0.88em)[' + lines.join(' #linebreak() ') + ']))');
        break;
      }
      case 'abstract':
        if (n.textContent.trim()) ctx.header.push('#pad(x: 2.2em, block(text(size: 0.95em)[*Abstract.* ' + [...Array(n.childCount).keys()].map(k => inlineToTypst(n.child(k), ctx)).join('\n\n') + ']))');
        break;
      case 'paragraph':
        out.push(n.content.size ? inlineToTypst(n, ctx) : '');
        break;
      case 'heading': {
        const lvl = Math.min(Math.max(n.attrs.level, 1), 4);
        const text = inlineToTypst(n, ctx);
        const info = ctx.nums.byPos.get(ctx.pos);
        const num = info && info.num;
        // appendix headings are referred to as "Appendix A.1" (the preamble's supplement is "Section")
        out.push('#heading(level: ' + lvl + ', numbering: ' + (num ? '(..n) => ' + str(num) : 'none') + (info && info.appendix ? ', supplement: [Appendix]' : '') + ')[' + text + ']' + label(n.attrs.id));
        break;
      }
      case 'equation': out.push(equation(n, ctx)); break;
      case 'figure': {
        if (n.attrs.placement === 'wrap') {
          const paras = [];
          while (i + 1 < kids.length && kids[i + 1].type.name === 'paragraph' && kids[i + 1].content.size) paras.push(kids[++i]);
          if (paras.length) { out.push(wrapBlock(n, paras, ctx)); break; }
        }
        out.push(figureCall(n, ctx, false));
        break;
      }
      case 'table_figure': out.push(tableFigure(n, ctx)); break;
      case 'bullet_list': case 'ordered_list': out.push(list(n, ctx, '')); break;
      case 'bibliography': out.push(bibliography(n, ctx)); break;
      case 'outline': out.push(outline(n)); break;
      case 'page_break': out.push('#pagebreak(weak: true)'); break;
      default: out.push(escText(n.textContent));
    }
    // page-boundary view: an invisible mark where this block starts (inside a paragraph's first line; on the line
    // before anything else)
    if (ctx.positions && parent === ctx.top && out.length > made && out[made] !== '') {
      out[made] = '#metadata(' + index + ') <dswpos>' + (n.type.name === 'paragraph' ? '' : '\n') + out[made];
    }
  }
  return out.join('\n\n');
}

/** Whole document -> { source, problems }. */
/* opts.positions: for the page-boundary view — every top-level block is marked, and one more element collects, for
   each mark, [block index, page, height on the page in pt]; main/typst.js reads it with "typst query".
   The result then has blockOf: for each top-level block of the document given, the index of the block that stands
   for it in the document written (they differ while tracked changes are pending). */
export function docToTypst(doc, opts = {}) {
  const given = doc;
  const fin = finalWithMapping(doc);
  doc = fin.doc;                                               // tracked changes: the PDF shows the final text
  if (hasSupplement(doc)) doc = splitParts(doc).main;          // the SI is its own document (parts.js)
  const ids = new Set();
  doc.descendants((n) => { if (n.attrs && n.attrs.id) ids.add(n.attrs.id); });
  const style = styleOf(doc);
  let flexCaptions = false;
  doc.forEach((n) => { if (n.type.name === 'outline' && n.attrs.kind !== 'contents') flexCaptions = true; });
  const ctx = { ids, problems: [], header: [], style, nums: computeNumbers(doc), pos: 0, cites: referencesFor(doc, style.cite), flexCaptions, positions: !!opts.positions, top: doc };
  let body = blocks(doc, ctx);
  if (ctx.cites.needsList) body += '\n\n' + bibliography(null, ctx);     // cited but no list placed: it goes at the end
  for (const k of ctx.cites.refs.missing) ctx.problems.push({ kind: 'citation', target: k, message: 'citation of a reference not in the library' });
  if (ctx.cites.refs.error) ctx.problems.push({ kind: 'citation', message: ctx.cites.refs.error });
  // a supplementary document: its name above the title, and (free header) a plain author line under it
  if (doc.attrs.partAuthors) ctx.header.push('#align(' + style.titleAlign + ', block(below: 1.2em, text(size: 1.05em)[' + escText(doc.attrs.partAuthors) + ']))');
  if (doc.attrs.partLabel) ctx.header.unshift('#align(' + style.titleAlign + ', block(below: 0.7em, text(size: ' + (levelSize(style, 'title') - 3) + 'pt, weight: "bold", fill: luma(80))[' + escText(doc.attrs.partLabel) + ']))');
  const header = ctx.header.length ? '#place(top, float: true, clearance: 1.8em, block(width: 100%)[\n' + ctx.header.join('\n') + '\n])\n\n' : '';
  let blockOf = null;
  if (opts.positions) {
    body += '\n\n#context [#metadata(query(<dswpos>).map(m => (m.value, m.location().page(), m.location().position().y.pt()))) <dswmap>]';
    blockOf = [];
    let p = 0;
    const size = doc.content.size;
    given.forEach((n) => {
      const q = fin.mapping ? fin.mapping.map(p, 1) : p;
      blockOf.push(q >= size ? doc.childCount - 1 : doc.resolve(q).index(0));
      p += n.nodeSize;
    });
  }
  const source = preamble(style, doc.attrs.part) + header + body + '\n';
  return { source, problems: ctx.problems, blockOf };
}
