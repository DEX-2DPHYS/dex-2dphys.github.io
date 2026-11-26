/* Document -> Word .docx. DESIGN.md §7.2.
   Numbers are real Word fields (SEQ for figures/equations, heading list numbering, REF for cross-references)
   with the current numbers already filled in, so the file reads correctly without "update fields" and
   stays live when co-authors edit in Word. Equations are native Word equations (OMML). */
import JSZip from 'jszip';
import { TableMap } from 'prosemirror-tables';
import { hasSupplement, splitParts } from './parts.js';
import { finalDoc, originalDoc } from './track.js';
import { computeNumbers, numberOnly, NBSP, nextContext, outlineEntries, OUTLINE_TITLE } from './numbering.js';

/* Tracked changes are written as Word revisions: runs inside <w:ins> / <w:del> (deleted text as w:delText, deleted
   field codes as w:delInstrText), an inserted / deleted paragraph mark as <w:ins/> / <w:del/> in the paragraph's rPr,
   the rows of an inserted / deleted table in their trPr. */
const asDeleted = (xml) => xml.replace(/<w:t( |>)/g, '<w:delText$1').replace(/<\/w:t>/g, '</w:delText>').replace(/<w:instrText/g, '<w:delInstrText').replace(/<\/w:instrText>/g, '</w:delInstrText>');
const PMARK = (n) => '<!--pmark' + n + '-->';
const APPENDIX_NUM = 60;
/** A SEQ field for a number that may carry a prefix ("S3" in the SI): the prefix as text, the counter as the field. */
function seqNum(kind, num, marks) {
  const m = /^(\D*)(\d+)$/.exec(String(num));
  return m ? (m[1] ? run(m[1], marks) : '') + field('SEQ ' + kind + ' \\* ARABIC', m[2], marks) : field('SEQ ' + kind + ' \\* ARABIC', String(num), marks);
}      // numbering.xml instance for appendix headings (A, A.1, …)
import { latexToOmml } from './mathconv.js';
import { FONTS, styleOf, levelSize } from './style.js';
import { formatAuthors } from './authors.js';
import { anchorsOf, threadsOf } from './comments.js';
import { referencesFor, htmlSegments, libraryOf, styleId } from './references.js';

// A4, 2.5 cm margins
const PAGE = { w: 11906, h: 16838, margin: 1417 };
const TEXT_W = PAGE.w - 2 * PAGE.margin;           // twips
const EMU_PER_TWIP = 635;
// fonts come from the document style (style.js); Word equations use Cambria Math (settings.xml)

const SPACER = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
const SPACER_AFTER_TABLE = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="160" w:lineRule="exact"/></w:pPr></w:p>';
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (s) => '<w:t xml:space="preserve">' + x(s) + '</w:t>';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function rPr(marks, extra) {
  const p = [];
  for (const m of marks || []) {
    const n = m.type ? m.type.name : m;
    if (n === 'bold') p.push('<w:b/>');
    else if (n === 'italic') p.push('<w:i/>');
    else if (n === 'underline') p.push('<w:u w:val="single"/>');
    else if (n === 'sup') p.push('<w:vertAlign w:val="superscript"/>');
    else if (n === 'sub') p.push('<w:vertAlign w:val="subscript"/>');
  }
  if (extra) p.push(extra);
  return p.length ? '<w:rPr>' + p.join('') + '</w:rPr>' : '';
}
const run = (text, marks, extra) => '<w:r>' + rPr(marks, extra) + t(text) + '</w:r>';

/** A complex field with its current result. */
function field(instr, result, marks) {
  const rp = rPr(marks);
  return '<w:r>' + rp + '<w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r>' + rp + '<w:instrText xml:space="preserve"> ' + x(instr) + ' </w:instrText></w:r>'
    + '<w:r>' + rp + '<w:fldChar w:fldCharType="separate"/></w:r>'
    + '<w:r>' + rp + t(result) + '</w:r>'
    + '<w:r>' + rp + '<w:fldChar w:fldCharType="end"/></w:r>';
}

/* Column widths (twips) from the content, for tables without dragged widths: Word does not shrink an
   auto-fit table to its content when it opens a generated file, so we give it content-based widths.
   Roughly 105 twips per character at 10 pt, bold a little wider, plus cell padding; scaled down to the text width. */
function visibleLength(cell) {
  let n = 0;
  cell.descendants((x) => {
    if (x.isText) n += x.text.length;
    else if (x.type.name === 'math_inline') n += normalizeForLength(x.attrs.latex);
    else if (x.type.name === 'xref') n += 7;
    return true;
  });
  return n;
}
// visible width of inline math in "characters": letters/digits count ~1.1, binary operators and relations
// carry space on both sides (~2.5), scripts are smaller (~0.7)
function normalizeForLength(tex) {
  const s = String(tex).replace(/\\(mathrm|text|mathbf|operatorname|left|right)\b/g, '')
    .replace(/\\(bmod|pmod|mod|sin|cos|tan|log|ln|exp|max|min|det|lim)\b/g, (_, w) => w + '  ');   // named operators: their letters + spacing
  const ops = (s.match(/\\(times|cdot|pm|mp|approx|leq|geq|neq|sim|propto)\b|[=+<>]|(?<![\^_{])-/g) || []).length;
  const scripts = (s.match(/[\^_](\{[^}]*\}|.)/g) || []).join('').replace(/[{}^_]/g, '').length;
  const base = s.replace(/[\^_](\{[^}]*\}|.)/g, '').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}\\\s,;:!]/g, '').length - ops;
  return Math.ceil(Math.max(0, base) * 1.1 + scripts * 0.7 + ops * 2.5);
}

function estimateWidths(table, map) {
  const w = new Array(map.width).fill(500);
  for (let i = 0; i < map.map.length; i++) {
    const rect = map.findCell(map.map[i]);
    if (rect.right - rect.left !== 1) continue;             // spanning cells don't set a single column's width
    const cell = table.nodeAt(map.map[i]);
    const per = cell.type.name === 'table_header' ? 115 : 105;
    w[rect.left] = Math.max(w[rect.left], Math.round(visibleLength(cell) * per + 260));
  }
  const total = w.reduce((a, b) => a + b, 0);
  return total > TEXT_W ? w.map(x => Math.round(x * TEXT_W / total)) : w;
}

/* Comments: Word ids per thread (parent first, then one per reply) and the number of anchor segments, so the range
   opens at the first segment and closes after the last. */
function commentPlan(doc) {
  const threads = threadsOf(doc), byId = new Map(), entries = [];
  let n = 0;
  for (const [id, a] of anchorsOf(doc)) {
    const t = threads[id];
    if (!t) continue;
    const nums = [n++];
    entries.push({ num: nums[0], id, author: t.author, initials: t.initials, time: t.time, text: t.text, parent: null, done: !!t.resolved });
    for (const r of t.replies || []) {
      const k = n++;
      nums.push(k);
      entries.push({ num: k, id, author: r.author, initials: r.initials, time: r.time, text: r.text, parent: nums[0], done: !!t.resolved });
    }
    byId.set(id, { nums, segments: a.segments, seen: 0, closed: false });
  }
  return { byId, entries };
}

const paraId = (n) => (0x10000000 + n).toString(16).toUpperCase();
const wordDate = (iso) => (iso ? new Date(iso).toISOString().replace(/\.\d+Z$/, 'Z') : new Date().toISOString().replace(/\.\d+Z$/, 'Z'));

/** comments.xml and commentsExtended.xml (threads: paraIdParent; resolved: done). Only threads written into the text. */
function commentParts(cmt) {
  const written = cmt.entries.filter(e => cmt.byId.get(e.id).seen > 0);
  if (!written.length) return null;
  const W14 = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"';
  let comments = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' + W14 + '>';
  let ext = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w15">';
  for (const e of written) {
    const lines = String(e.text || '').split(/\r?\n/);
    comments += '<w:comment w:id="' + e.num + '" w:author="' + x(e.author || 'Unknown') + '" w:date="' + wordDate(e.time) + '" w:initials="' + x(e.initials || '') + '">';
    lines.forEach((line, i) => {
      const last = i === lines.length - 1;
      comments += '<w:p' + (last ? ' w14:paraId="' + paraId(e.num) + '" w14:textId="77777777"' : '') + '><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>'
        + (i === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : '') + run(line) + '</w:p>';
    });
    comments += '</w:comment>';
    ext += '<w15:commentEx w15:paraId="' + paraId(e.num) + '"' + (e.parent !== null ? ' w15:paraIdParent="' + paraId(e.parent) + '"' : '') + ' w15:done="' + (e.done ? 1 : 0) + '"/>';
  }
  return { comments: comments + '</w:comments>', ext: ext + '</w15:commentsEx>' };
}

class Writer {
  constructor(doc, opts) {
    this.doc = doc;
    this.opts = opts;
    this.nums = computeNumbers(doc);
    this.bm = new Map();      // our id -> Word bookmark name
    this.bmId = 0;
    this.rels = [];           // {id, type, target}
    this.media = [];          // {path, bytes}
    this.mediaByName = new Map();
    this.lists = [];          // ordered list instances needing their own numId (start values)
    this.problems = [];
    this.docPrId = 1;
    this.style = styleOf(doc);
    this.cmt = commentPlan(doc);
    this.cites = referencesFor(doc, this.style.cite);
    this.footnotes = [];      // [{ id, body }] -> footnotes.xml
    this.citeSeq = 0;
    this.revId = 9000;        // w:id of revision elements
    this.pCount = 0;          // paragraphs written (each has a place for a tracked paragraph mark)
    this.paraMarks = new Map();   // paragraph number -> { kind, author, time } of its tracked mark
    this.prevTextPara = null; // the text paragraph written just before (a tracked boundary is its mark)
    this.force = null;        // inside an inserted / deleted figure or table: everything in it is
    this.zoteroUsed = false;  // a Zotero field was written -> the document preferences (docProps/custom.xml)
    this.cites.lib = libraryOf(doc);
  }

  /** A footnote: the reference mark here, the text in footnotes.xml (numbered by Word in order, like ours). */
  footnoteRef(node, marks) {
    const id = this.footnotes.length + 1;
    this.footnotes.push({ id, body: this.inline(node) });
    return '<w:r>' + rPr(marks, '<w:rStyle w:val="FootnoteReference"/>') + '<w:footnoteReference w:id="' + id + '"/></w:r>';
  }

  /** Table of contents / list of figures / list of tables: a TOC field with the current entries; Word fills in the
      page numbers when it updates the field (marked dirty, so it does that on opening). */
  outline(node) {
    const kind = node.attrs.kind;
    const title = node.attrs.title || OUTLINE_TITLE[kind] || 'Contents';
    const instr = kind === 'figures' ? 'TOC \\h \\z \\c "Figure"' : kind === 'tables' ? 'TOC \\h \\z \\c "Table"' : 'TOC \\o "1-3" \\h \\z \\u';
    const entries = outlineEntries(this.doc, kind, this.nums);
    const begin = '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> ' + x(instr) + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    let out = this.p('TOCHeading', run(title));
    if (!entries.length) return out + this.p(null, begin + run('(nothing to list yet)', [], '<w:color w:val="808080"/>') + end);
    entries.forEach((e, i) => {
      const label = kind === 'figures' ? this.style.figLabel + ' ' + e.num + '. ' : kind === 'tables' ? 'Table ' + e.num + '. ' : (e.num ? e.num + ' ' : '');
      const style = kind === 'contents' ? 'TOC' + Math.min(e.level, 3) : 'TableofFigures';
      out += this.p(style, (i === 0 ? begin : '') + run(label + e.text) + (i === entries.length - 1 ? end : ''));
    });
    return out;
  }

  bookmarkName(id) {
    if (!this.bm.has(id)) this.bm.set(id, '_Ref' + String(100000000 + this.bm.size + 1));
    return this.bm.get(id);
  }
  /** The number a deleted item has when the deletion is rejected (it has none in the final numbering). */
  numOf(info, id) {
    if (!info.deleted) return info.num;
    if (!this.origNums) this.origNums = computeNumbers(originalDoc(this.doc));
    const o = id && this.origNums.byId.get(id);
    return (o && o.num) || '?';
  }
  revAttrs(a) { return ' w:id="' + (this.revId++) + '" w:author="' + x(a.author || 'Unknown') + '"' + (a.time ? ' w:date="' + x(a.time) + '"' : ''); }
  /** The runs of one inline piece as an insertion and / or deletion (from its marks, or the unit it is in). */
  rev(xml, marks) {
    if (!xml) return xml;
    const get = (name) => { const m = (marks || []).find(k => k.type && k.type.name === name); return m ? m.attrs : (this.force && this.force.kind === name ? this.force : null); };
    const d = get('del'), i = get('ins');
    if (d) xml = '<w:del' + this.revAttrs(d) + '>' + asDeleted(xml) + '</w:del>';
    if (i) xml = '<w:ins' + this.revAttrs(i) + '>' + xml + '</w:ins>';
    return xml;
  }
  /** Write a unit that is inserted or deleted as a whole: its runs, paragraph marks and rows are. */
  withRev(track, fn) {
    const prev = this.force;
    if (track && (track.kind === 'ins' || track.kind === 'del')) this.force = track;
    this.prevTextPara = null;
    try { return fn(); } finally { this.force = prev; this.prevTextPara = null; }
  }
  /** Put the tracked paragraph marks in (after everything is written). */
  finish(xml) {
    return xml.replace(/<!--pmark(\d+)-->/g, (m, n) => { const t = this.paraMarks.get(+n); return t ? '<w:rPr><w:' + t.kind + this.revAttrs(t) + '/></w:rPr>' : ''; }).replace(/<w:pPr><\/w:pPr>/g, '');
  }

  bookmark(id, inner) {
    const n = this.bmId++;
    return '<w:bookmarkStart w:id="' + n + '" w:name="' + this.bookmarkName(id) + '"/>' + inner + '<w:bookmarkEnd w:id="' + n + '"/>';
  }

  math(latex, display) {
    try {
      // plain text in an equation (\text{…}, a "normal text" run) is set in the body font, like the text around it
      const f = FONTS[this.style.font].word;
      return latexToOmml(latex, display).replace(/(<m:r><m:rPr><m:nor\/>[^]*?<\/m:rPr>)/g, '$1<w:rPr><w:rFonts w:ascii="' + f + '" w:hAnsi="' + f + '" w:cs="' + f + '"/></w:rPr>');
    } catch (e) {
      this.problems.push({ kind: 'math', latex, message: String(e.message || e) });
      return run('[equation: ' + latex + ']', [], '<w:color w:val="C00000"/>');
    }
  }

  /* ---------- comments: a thread = one Word comment + one per reply, all on the same range ---------- */
  cmtStart(marks) {
    let out = '';
    for (const m of marks) {
      if (m.type.name !== 'comment') continue;
      const c = this.cmt.byId.get(m.attrs.id);
      if (c && c.seen++ === 0) for (const n of c.nums) out += '<w:commentRangeStart w:id="' + n + '"/>';
    }
    return out;
  }
  cmtEnd(marks) {
    let out = '';
    for (const m of marks) {
      if (m.type.name !== 'comment') continue;
      const c = this.cmt.byId.get(m.attrs.id);
      if (c && c.seen === c.segments && !c.closed) out += this.cmtClose(c);
    }
    return out;
  }
  cmtClose(c) {
    c.closed = true;
    let out = '';
    for (const n of c.nums) out += '<w:commentRangeEnd w:id="' + n + '"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="' + n + '"/></w:r>';
    return out;
  }
  /** Comment ids on a whole equation, as pseudo-marks for cmtStart/cmtEnd. */
  eqMarks(node) { return (node.attrs.comments || []).map(id => ({ type: { name: 'comment' }, attrs: { id } })); }

  inline(node, extraMarks) {
    let out = '';
    // Word shows an equation that is alone in its paragraph as a display equation (own alignment, display size).
    // A zero-width space beside it keeps it inline, so it follows the paragraph/cell alignment.
    let onlyMath = node.childCount > 0;
    node.forEach((c) => { if (c.type.name !== 'math_inline' && !(c.isText && !c.text.trim())) onlyMath = false; });
    if (onlyMath) out += run('​');
    let prevText = '';
    node.forEach((c) => {
      const marks = extraMarks ? [...c.marks, ...extraMarks] : c.marks;
      out += this.cmtStart(c.marks);
      const piece0 = out.length;
      switch (c.type.name) {
        case 'text': out += run(c.text, marks); break;
        case 'math_inline': out += this.math(c.attrs.latex, false); break;
        case 'hard_break': out += '<w:r><w:br/></w:r>'; break;
        case 'xref': out += this.xref(c.attrs.target, marks, prevText); break;
        case 'citation': out += this.citation(c, marks); break;
        case 'footnote': out += this.footnoteRef(c, marks); break;
        default: out += run(c.textContent, marks);
      }
      out = out.slice(0, piece0) + this.rev(out.slice(piece0), c.marks);       // tracked insertion / deletion
      out += this.cmtEnd(c.marks);
      prevText = nextContext(prevText, c);
    });
    return out;
  }

  xref(target, marks, prevText) {
    const info = this.nums.byId.get(target);
    if (!info) { this.problems.push({ kind: 'xref', target }); return run('??', marks, '<w:color w:val="C00000"/>'); }
    const bm = this.bookmarkName(target);
    if (numberOnly(info, prevText)) {           // "Fig. " typed before the reference: the number field only
      const f = field('REF ' + bm + (info.type === 'heading' ? ' \\n' : '') + ' \\h \\* Charformat', info.num, marks);
      return info.type === 'equation' && !/\(\s*$/.test(prevText) ? run('(', marks) + f + run(')', marks) : f;
    }
    // \* Charformat: when Word refreshes the field, the result takes the formatting of the field code
    // (plain text here), not that of the bookmarked caption number (bold)
    const ref = (sw, result) => field('REF ' + bm + sw + ' \\h \\* Charformat', result, marks);
    if (info.type === 'figure') return run(this.style.figLabel + NBSP, marks) + ref('', info.num);
    if (info.type === 'table_figure') return run('Table ', marks) + ref('', info.num);
    if (info.type === 'equation') {
      if (!info.num) return run('Eq. (–)', marks);
      return run('Eq. (', marks) + ref('', info.num) + run(')', marks);
    }
    if (info.num) return run((info.appendix ? 'Appendix' : 'Section') + ' ', marks) + ref(' \\n', info.num);   // \n: the number as shown at the heading (no added parent levels)
    return run('“', marks) + ref('', info.snippet) + run('”', marks);
  }

  /** Formatted reference text (htmlSegments) -> runs; plain text, not a field (no reference-manager plugin needed). */
  segments(segs, marks) {
    return segs.map(s => run(s.text, [...(marks || []), ...s.marks.filter(m => m !== 'smallcaps')], s.marks.includes('smallcaps') ? '<w:smallCaps/>' : '')).join('');
  }

  /** Reference list: unnumbered heading, then one paragraph per entry (label + tab for numbered styles). */
  /* Citations and the reference list as Zotero fields (opts.zoteroFields, the default): what Zotero's Word plugin
     writes — ADDIN ZOTERO_ITEM CSL_CITATION {json} with our formatted text as the field result. Word co-authors without
     Zotero see ordinary text; with Zotero they can refresh, add citations or change the style (the reference data is
     in the field: their library need not contain it); step 6 (Word import) reads the fields back. */
  zoteroField(instr, resultRuns, marks) {
    const rp = rPr(marks);
    // long instructions are split over several runs, as Zotero does
    const chunks = [];
    for (let i = 0; i < instr.length; i += 250) chunks.push(instr.slice(i, i + 250));
    return '<w:r>' + rp + '<w:fldChar w:fldCharType="begin"/></w:r>'
      + chunks.map(c => '<w:r>' + rp + '<w:instrText xml:space="preserve">' + x(c) + '</w:instrText></w:r>').join('')
      + '<w:r>' + rp + '<w:fldChar w:fldCharType="separate"/></w:r>' + resultRuns + '<w:r>' + rp + '<w:fldChar w:fldCharType="end"/></w:r>';
  }

  citation(node, marks) {
    const html = this.cites.citeHtml(node);
    const runs = this.segments(htmlSegments(html), marks);
    if (this.opts.zoteroFields === false) return runs;
    const lib = this.cites.lib || {};
    const items = (node.attrs.items || []).filter(it => lib[it.id]);
    if (!items.length) return runs;
    const plain = htmlSegments(html).map(s => s.text).join('');
    const json = {
      citationID: 'dsw' + (++this.citeSeq).toString(36) + Math.random().toString(36).slice(2, 7),
      properties: { formattedCitation: plain, plainCitation: plain, noteIndex: 0 },
      citationItems: items.map((it) => {
        const data = lib[it.id], z = data.zotero;
        const uri = z && /^https?:\/\//.test(z.id || '') ? z.id : null;
        const { zotero, ...itemData } = data;
        return { id: it.id, ...(uri ? { uris: [uri] } : {}), itemData, ...(it.locator ? { locator: it.locator, label: 'page' } : {}), ...(node.attrs.mode === 'suppress-author' ? { 'suppress-author': true } : {}) };
      }),
      schema: 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json',
    };
    this.zoteroUsed = true;
    return this.zoteroField('ADDIN ZOTERO_ITEM CSL_CITATION ' + JSON.stringify(json), runs, marks);
  }

  bibliography(node) {
    const { entries, flush } = this.cites.refs.bib;
    const title = (node && node.attrs.title) || 'References';
    let out = this.p('Heading1', run(title), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>');
    const zf = this.opts.zoteroFields !== false && entries.length;
    const instr = 'ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY';
    entries.forEach((e, i) => {
      let body = flush ? this.segments(htmlSegments(e.label)) + '<w:r><w:tab/></w:r>' + this.segments(htmlSegments(e.html)) : this.segments(htmlSegments(e.html));
      // one field over the whole list: it opens in the first entry and closes in the last
      if (zf && i === 0) body = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">' + x(instr) + '</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + body;
      if (zf && i === entries.length - 1) body += '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      out += this.p(flush ? 'BibliographyNumbered' : 'Bibliography', body);
    });
    return out;
  }

  /* node: the text block this paragraph is (paragraph, heading, list paragraph), for its tracked boundary. Word keeps
     an inserted / deleted paragraph boundary on the paragraph *before* it (its paragraph mark); we keep it on the block
     after — so the flag goes to the previous text paragraph, or to this one when there is none (a wholly new one). */
  p(style, body, pPrExtra, node) {
    const n = ++this.pCount;
    if (this.force) this.paraMarks.set(n, this.force);
    if (node && node.isTextblock) {
      const t = node.attrs.track;
      if (t && (t.kind === 'ins' || t.kind === 'del')) this.paraMarks.set(this.prevTextPara || n, t);
      this.prevTextPara = n;
    }
    const ppr = (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (pPrExtra || '') + PMARK(n);
    return '<w:p><w:pPr>' + ppr + '</w:pPr>' + body + '</w:p>';
  }

  image(name) {
    if (this.mediaByName.has(name)) return this.mediaByName.get(name);
    const img = this.opts.getImage(name);
    if (!img) return null;
    const path = 'media/image' + (this.media.length + 1) + '.' + img.ext;
    this.media.push({ path: 'word/' + path, bytes: img.bytes });
    const rid = 'rIdImg' + (this.media.length);
    this.rels.push({ id: rid, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: path });
    const rec = { rid, w: img.w, h: img.h };
    this.mediaByName.set(name, rec);
    return rec;
  }

  drawing(name, widthTw) {
    const rec = this.image(name);
    if (!rec) return run('[missing image]', [], '<w:color w:val="C00000"/>');
    const cx = Math.round(widthTw * EMU_PER_TWIP);
    const ratio = rec.w && rec.h ? rec.h / rec.w : 0.75;
    const cy = Math.round(cx * ratio);
    const id = this.docPrId++;
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
      + '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Figure ' + id + '"/>'
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
      + '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="image' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>'
      + '<pic:blipFill><a:blip r:embed="' + rec.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
      + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  figure(node) {
    const info = this.nums.byPos.get(this.pos) || { num: '?' };
    const a = node.attrs;
    const frac = Math.min(Math.max(a.width || 0.8, 0.15), 1);
    const img = node.firstChild, cap = node.lastChild;
    let frame = '', imgW, capInd = '';
    if (a.placement === 'float' && this.opts.wordFloats === 'frame') {
      // frame at the top/bottom of the page. Not the default: Word frames do not stack (two on a page overlap)
      // and a frame on page 1 sits above the title.
      frame = '<w:framePr w:w="' + TEXT_W + '" w:hSpace="0" w:vSpace="227" w:wrap="notBeside" w:vAnchor="margin" w:hAnchor="margin" w:xAlign="center" w:yAlign="' + (a.pos === 'bottom' ? 'bottom' : 'top') + '"/>';
      imgW = TEXT_W * frac;
    } else if (a.placement === 'wrap') {
      const w = Math.round(TEXT_W * frac);
      frame = '<w:framePr w:w="' + w + '" w:hSpace="255" w:vSpace="113" w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="' + (a.side === 'left' ? 'left' : 'right') + '" w:y="1"/>';
      imgW = w;
    } else {
      imgW = TEXT_W * frac;
      if (frac < 0.999) { const ind = Math.round((TEXT_W - imgW) / 2); capInd = '<w:ind w:left="' + ind + '" w:right="' + ind + '"/>'; }
    }
    const cm = this.eqMarks(node);            // comment boxes drawn on the figure -> Word comments on the picture
    const imgP = this.p('Figure', this.cmtStart(cm) + this.rev(img && img.attrs.src ? this.drawing(img.attrs.src, imgW) : '', []) + this.cmtEnd(cm), frame);
    const label = this.bookmark(a.id || 'fig' + this.pos, seqNum('Figure', this.numOf(info, a.id), ['bold']));
    const capP = this.p('Caption', this.rev(run(this.style.figLabel + NBSP, ['bold']) + label + run('.', ['bold']) + run(' ', []), []) + this.inline(cap), frame + capInd);
    return imgP + capP;
  }

  /* Table with caption above. Booktabs borders, gridSpan / vMerge for merged cells, header rows repeat on new pages. */
  tableFigure(node) {
    const info = this.nums.byPos.get(this.pos) || { num: '?' };
    const cap = node.firstChild, table = node.lastChild;
    const label = this.bookmark(node.attrs.id || 'tab' + this.pos, seqNum('Table', this.numOf(info, node.attrs.id), ['bold']));
    const capP = this.p('Caption', this.rev(run('Table ', ['bold']) + label + run('.', ['bold']) + run(' ', []), []) + this.inline(cap), '<w:keepNext/>');
    const map = TableMap.get(table);
    // column widths: dragged widths (CSS px -> twips), else equal shares of the text width
    const widths = new Array(map.width).fill(null);
    for (let i = 0; i < map.map.length; i++) {
      const cell = table.nodeAt(map.map[i]);
      const rect = map.findCell(map.map[i]);
      (cell.attrs.colwidth || []).forEach((w, k) => { if (w && widths[rect.left + k] == null) widths[rect.left + k] = Math.round(w * 15); });
    }
    const fixed = widths.every(w => w);
    const grid = fixed ? widths : estimateWidths(table, map);
    let headerRows = 0;
    for (let r = 0; r < table.childCount; r++) {
      let allHead = true;
      table.child(r).forEach((c) => { if (c.type.name !== 'table_header') allHead = false; });
      if (!allHead) break;
      headerRows++;
    }
    const last = map.height - 1;
    // every grid row gets its own <w:tc> (row-merged cells continue with vMerge), so borders can go per row
    const borders = (r) => {
      const b = [];
      if (r === 0) b.push('<w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/>');
      if (r === last) b.push('<w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/>');
      else if (headerRows && r === headerRows - 1) b.push('<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>');
      return b.length ? '<w:tcBorders>' + b.join('') + '</w:tcBorders>' : '';
    };
    let rowsXml = '';
    for (let r = 0; r < map.height; r++) {
      let tcs = '';
      for (let c = 0; c < map.width; c++) {
        const off = map.map[r * map.width + c];
        const rect = map.findCell(off);
        if (rect.left !== c) continue;                       // covered by a colspan
        const cell = table.nodeAt(off);
        const span = rect.right - rect.left;
        const w = grid.slice(rect.left, rect.right).reduce((a, b) => a + b, 0);
        const head = cell.type.name === 'table_header';
        const vm = rect.bottom - rect.top > 1 ? (rect.top === r ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '';
        const tcPr = '<w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + vm + borders(r) + '<w:vAlign w:val="center"/></w:tcPr>';
        const jc = '<w:jc w:val="' + (cell.attrs.align === 'center' ? 'center' : cell.attrs.align === 'right' ? 'right' : 'left') + '"/>';
        let paras = '';
        this.prevTextPara = null;                             // a cell is a scope of its own
        if (rect.top === r) cell.forEach((p) => { paras += this.p('TableText', this.inline(p, head ? ['bold'] : null), jc, p); });
        else paras = this.p('TableText', '', jc);                 // continuation of a row-merged cell
        tcs += '<w:tc>' + tcPr + paras + '</w:tc>';
      }
      const trPr = '<w:trPr><w:cantSplit/>' + (r < headerRows ? '<w:tblHeader/>' : '') + (this.force ? '<w:' + this.force.kind + this.revAttrs(this.force) + '/>' : '') + '</w:trPr>';
      rowsXml += '<w:tr>' + trPr + tcs + '</w:tr>';
    }
    const total = grid.reduce((a, b) => a + b, 0);
    const tbl = '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:jc w:val="center"/>'
      + '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
      + '<w:tblLayout w:type="' + (fixed ? 'fixed' : 'autofit') + '"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>'
      + '<w:tblGrid>' + grid.map(g => '<w:gridCol w:w="' + g + '"/>').join('') + '</w:tblGrid>' + rowsXml + '</w:tbl>';
    return capP + tbl + SPACER_AFTER_TABLE;
  }

  equation(node) {
    const info = this.nums.byPos.get(this.pos) || {};
    const omml = this.math(node.attrs.latex, true);
    const cm = this.eqMarks(node);
    const mathPara = this.cmtStart(cm) + '<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>' + omml + '</m:oMathPara>' + this.cmtEnd(cm);
    const t = node.attrs.track;
    if (t) {
      const as = (kind, latex) => this.rev(this.math(latex, false), [{ type: { name: kind }, attrs: t }]);
      const formula = t.kind === 'mod' ? as('del', (t.old && t.old.latex) || '') + as('ins', node.attrs.latex) : this.rev(this.math(node.attrs.latex, false), []);
      const tab = '<w:r><w:tab/></w:r>';
      const number = node.attrs.numbered ? tab + run('(') + this.bookmark(node.attrs.id || 'eq' + this.pos, seqNum('Equation', this.numOf(info, node.attrs.id) || '?')) + run(')') : '';
      const tabs = '<w:tabs><w:tab w:val="center" w:pos="' + Math.round(TEXT_W / 2) + '"/><w:tab w:val="right" w:pos="' + TEXT_W + '"/></w:tabs><w:jc w:val="left"/>';
      return this.p('Equation', this.cmtStart(cm) + this.rev(tab, []) + formula + (t.kind === 'mod' ? number : this.rev(number, [])) + this.cmtEnd(cm), tabs);
    }
    if (!node.attrs.numbered) return this.p('Equation', mathPara);
    const side = Math.round(TEXT_W * 0.12), mid = TEXT_W - 2 * side;
    const cell = (w, body, jc) => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>'
      + '<w:p><w:pPr><w:pStyle w:val="Equation"/><w:jc w:val="' + jc + '"/></w:pPr>' + body + '</w:p></w:tc>';
    const num = run('(') + this.bookmark(node.attrs.id || 'eq' + this.pos, seqNum('Equation', info.num || '?')) + run(')');
    return '<w:tbl><w:tblPr><w:tblW w:w="' + TEXT_W + '" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
      + '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
      + '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'
      + '<w:tblLook w:val="0000"/></w:tblPr>'
      + '<w:tblGrid><w:gridCol w:w="' + side + '"/><w:gridCol w:w="' + mid + '"/><w:gridCol w:w="' + side + '"/></w:tblGrid>'
      + '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + cell(side, '', 'left') + cell(mid, mathPara, 'center') + cell(side, num, 'right') + '</w:tr></w:tbl>';
  }

  /* Author line with superscript affiliation markers, affiliation lines, corresponding author. */
  authors(node) {
    const fa = formatAuthors(node.attrs, this.style.affil);
    if (!fa.authors.length) return '';
    let line = '';
    fa.authors.forEach((a, i) => {
      if (i) line += run(', ');
      line += run(a.name);
      const m = a.marks + (a.corresponding ? (a.marks ? ',' : '') + '*' : '');
      if (m) line += run(m, ['sup']);
    });
    const paras = [];
    for (const a of fa.affils) paras.push(run(a.mark, ['sup']) + run(a.text));
    for (const c of fa.corresponding) if (c.email) paras.push(run('*', ['sup']) + run('Corresponding author: ' + c.email));
    let out = this.p('Authors', line, paras.length ? '' : '<w:spacing w:after="360"/>');
    // space before the abstract after the last line of the block
    paras.forEach((body, i) => { out += this.p('Affiliation', body, i === paras.length - 1 ? '<w:spacing w:after="360"/>' : ''); });
    return out;
  }

  heading(node) {
    const lvl = Math.min(Math.max(node.attrs.level, 1), 4);
    const body = this.inline(node);
    const inner = node.attrs.id ? this.bookmark(node.attrs.id, body) : body;
    const info = this.nums.byPos.get(this.pos);
    // appendix headings: their own numbering instance (A, A.1, …; numbering.xml numId APPENDIX_NUM)
    const numOff = !node.attrs.numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>'
      : info && info.appendix ? '<w:numPr><w:ilvl w:val="' + (lvl - 1) + '"/><w:numId w:val="' + APPENDIX_NUM + '"/></w:numPr>' : '';
    return this.p('Heading' + lvl, inner, numOff, node);
  }

  list(node, level) {
    let numId;
    if (node.type.name === 'bullet_list') numId = 2;
    else { this.lists.push(node.attrs.order || 1); numId = 2 + this.lists.length; }
    let out = '';
    node.forEach((item) => {
      let first = true;
      item.forEach((c) => {
        if (c.type.name === 'paragraph') {
          const numPr = first ? '<w:numPr><w:ilvl w:val="' + level + '"/><w:numId w:val="' + numId + '"/></w:numPr>' : '';
          const ind = first ? '' : '<w:ind w:left="' + (567 * (level + 1)) + '"/>';
          out += this.p('ListParagraph', this.inline(c), numPr + ind, c);
          first = false;
        } else out += this.list(c, Math.min(level + 1, 2));
      });
    });
    return out;
  }

  body() {
    const out = [];
    this.doc.forEach((n, offset) => {
      this.pos = offset;
      switch (n.type.name) {
        case 'title': if (n.content.size) out.push(this.p('Title', this.inline(n))); this.prevTextPara = null; break;
        case 'authors': out.push(this.authors(n)); break;
        case 'abstract': {
          let first = true;
          n.forEach((pp) => { out.push(this.p('Abstract', (first ? run('Abstract. ', ['bold']) : '') + this.inline(pp))); first = false; });
          break;
        }
        case 'paragraph': out.push(this.p(null, this.inline(n), '', n)); break;
        case 'heading': out.push(this.heading(n)); break;
        case 'equation': out.push(this.withRev(n.attrs.track, () => this.equation(n))); break;
        case 'figure': out.push(this.withRev(n.attrs.track, () => this.figure(n))); break;
        case 'table_figure': out.push(this.withRev(n.attrs.track, () => this.tableFigure(n))); break;
        case 'bullet_list': case 'ordered_list': out.push(this.list(n, 0)); break;
        // a deleted reference list, contents list or page break is simply left out; an inserted one is written plainly
        case 'bibliography': this.prevTextPara = null; if (!(n.attrs.track && n.attrs.track.kind === 'del')) out.push(this.bibliography(n)); this.prevTextPara = null; break;
        case 'outline': this.prevTextPara = null; if (!(n.attrs.track && n.attrs.track.kind === 'del')) out.push(this.outline(n)); this.prevTextPara = null; break;
        case 'page_break': this.prevTextPara = null; if (!(n.attrs.track && n.attrs.track.kind === 'del')) out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); break;
        default: out.push(this.p(null, run(n.textContent)));
      }
      // Word merges tables that touch: keep consecutive numbered equations apart with an invisible paragraph
      const k = out.length;
      if (k >= 2 && out[k - 1].startsWith('<w:tbl>') && out[k - 2].endsWith('</w:tbl>')) out.splice(k - 1, 0, SPACER);
    });
    if (this.cites.needsList) out.push(this.bibliography(null));     // cited but no list placed: it goes at the end
    if (out.length && out[out.length - 1].endsWith('</w:tbl>')) out.push(SPACER);
    // a comment range that was opened but never closed (anchor in a place we do not write) is closed here,
    // so the file stays valid
    const open = [...this.cmt.byId.values()].filter(c => c.seen > 0 && !c.closed);
    if (open.length) out.push('<w:p>' + open.map(c => this.cmtClose(c)).join('') + '</w:p>');
    const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="' + PAGE.w + '" w:h="' + PAGE.h + '"/>'
      + '<w:pgMar w:top="' + PAGE.margin + '" w:right="' + PAGE.margin + '" w:bottom="' + PAGE.margin + '" w:left="' + PAGE.margin + '" w:header="708" w:footer="708" w:gutter="0"/>' + (this.style.lineNumbers ? '<w:lnNumType w:countBy="1" w:restart="continuous"/>' : '') + '</w:sectPr>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS + '><w:body>' + out.join('') + sect + '</w:body></w:document>';
  }
}

/* Word styles from the document style. sz is in half-points. Caption/table text one point below the body. */
function stylesXml(stl) {
  const font = FONTS[stl.font].word;
  const hp = (pt) => Math.round(pt * 2);
  const body = hp(stl.size), small = hp(stl.size - 1);
  const jcT = stl.titleAlign === 'center' ? 'center' : 'left';
  const st = (id, name, ppr, rpr, extra) => '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/>'
    + (extra || '') + '<w:qFormat/>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '</w:style>';
  const levelR = (k) => {
    const v = stl[k];
    return (v.bold ? '<w:b/>' : '<w:b w:val="0"/>') + (v.italic ? '<w:i/>' : '<w:i w:val="0"/>') + '<w:color w:val="' + v.color.slice(1).toUpperCase() + '"/>'
      + '<w:sz w:val="' + hp(levelSize(stl, k)) + '"/><w:szCs w:val="' + hp(levelSize(stl, k)) + '"/>';
  };
  const head = (lvl) => st('Heading' + lvl, 'heading ' + lvl,
    '<w:keepNext/><w:keepLines/><w:numPr><w:ilvl w:val="' + (lvl - 1) + '"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="' + (lvl === 1 ? 360 : 240) + '" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="' + (lvl - 1) + '"/>',
    levelR('h' + lvl), '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:eastAsia="' + font + '" w:cs="' + font + '"/><w:sz w:val="' + body + '"/><w:szCs w:val="' + body + '"/><w:lang w:val="' + stl.lang + '"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="' + Math.round(264 * stl.spacing / (stl.spacing > 1 ? 1.1 : 1)) + '" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>'
    + head(1) + head(2) + head(3) + head(4)
    + st('Title', 'Title', '<w:jc w:val="' + jcT + '"/><w:spacing w:after="160"/>', levelR('title'), '<w:basedOn w:val="Normal"/><w:next w:val="Authors"/>')
    + st('Authors', 'Authors', '<w:jc w:val="' + jcT + '"/><w:spacing w:after="80"/>', '<w:sz w:val="' + hp(stl.size + 0.5) + '"/>', '<w:basedOn w:val="Normal"/>')
    + st('Affiliation', 'Affiliation', '<w:jc w:val="' + jcT + '"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="' + hp(stl.size - 1.5) + '"/>', '<w:basedOn w:val="Normal"/>')
    + st('Abstract', 'Abstract', '<w:ind w:left="567" w:right="567"/><w:spacing w:after="240"/>', '<w:sz w:val="' + small + '"/>', '<w:basedOn w:val="Normal"/>')
    + st('Figure', 'Figure', '<w:keepNext/><w:jc w:val="center"/><w:spacing w:before="120" w:after="80"/>', '', '<w:basedOn w:val="Normal"/>')
    + st('Caption', 'caption', '<w:jc w:val="both"/><w:spacing w:after="240"/>', '<w:sz w:val="' + small + '"/>', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>')
    + st('Equation', 'Equation', '<w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/>', '', '<w:basedOn w:val="Normal"/>')
    + st('TableText', 'Table Text', '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>', '<w:sz w:val="' + small + '"/>', '<w:basedOn w:val="Normal"/>')
    + st('Bibliography', 'Bibliography', '<w:ind w:left="425" w:hanging="425"/><w:spacing w:after="60" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>', '<w:sz w:val="' + small + '"/>', '<w:basedOn w:val="Normal"/>')
    + st('BibliographyNumbered', 'Bibliography (numbered)', '<w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs><w:ind w:left="567" w:hanging="567"/><w:spacing w:after="60" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>', '<w:sz w:val="' + small + '"/>', '<w:basedOn w:val="Normal"/>')
    // table of contents and lists of figures/tables; footnotes
    + st('TOCHeading', 'TOC Heading', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:jc w:val="left"/>', levelR('h1'), '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>')
    + st('TOC1', 'toc 1', '<w:spacing w:before="60" w:after="20"/><w:jc w:val="left"/>', '', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>')
    + st('TOC2', 'toc 2', '<w:spacing w:after="20"/><w:ind w:left="397"/><w:jc w:val="left"/>', '', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>')
    + st('TOC3', 'toc 3', '<w:spacing w:after="20"/><w:ind w:left="794"/><w:jc w:val="left"/>', '', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>')
    + st('TableofFigures', 'table of figures', '<w:spacing w:after="40"/><w:jc w:val="left"/>', '', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>')
    + st('FootnoteText', 'footnote text', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="both"/>', '<w:sz w:val="' + hp(stl.size - 2) + '"/><w:szCs w:val="' + hp(stl.size - 2) + '"/>', '<w:basedOn w:val="Normal"/>')
    + '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>'
    + st('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/><w:ind w:left="567"/>', '', '<w:basedOn w:val="Normal"/>')
    + '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>'
    + st('CommentText', 'annotation text', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>', '<w:sz w:val="20"/>', '<w:basedOn w:val="Normal"/>')
    + '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>'
    + '</w:styles>';
}

const WORD_FMT = { '1': 'decimal', i: 'lowerRoman', I: 'upperRoman', a: 'lowerLetter', A: 'upperLetter', none: 'none' };
function numberingXml(orderedStarts, stl, si) {
  const lvl = (i, fmt, text, ind, extra) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/>' + (extra || '')
    + '<w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + ind + '" w:hanging="' + (ind ? 397 : 0) + '"/></w:pPr></w:lvl>';
  // same rule as style.headingLabel: '1' under all-'1' parents is hierarchical (1.2.3), other formats stand alone
  const headText = (i) => {
    const f = stl['h' + (i + 1)].num;
    if (f === 'none') return '';
    if (si) return 'S' + [...Array(i + 1).keys()].map(k => '%' + (k + 1)).join('.');      // SI: S1, S1.1 (as numbering.js)
    const chain = f === '1' && [...Array(i + 1).keys()].every(k => stl['h' + (k + 1)].num === '1');
    return chain ? [...Array(i + 1).keys()].map(k => '%' + (k + 1)).join('.') : '%' + (i + 1);
  };
  const headLvl = (i) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + (si && stl['h' + (i + 1)].num !== 'none' ? 'decimal' : WORD_FMT[stl['h' + (i + 1)].num]) + '"/><w:pStyle w:val="Heading' + (i + 1) + '"/>'
    + '<w:lvlText w:val="' + headText(i) + '"/><w:lvlJc w:val="left"/><w:suff w:val="' + (stl['h' + (i + 1)].num === 'none' ? 'nothing' : 'space') + '"/><w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl>';
  let s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>' + headLvl(0) + headLvl(1) + headLvl(2) + headLvl(3) + '</w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>'
    + lvl(0, 'bullet', '•', 567) + lvl(1, 'bullet', '–', 964) + lvl(2, 'bullet', '·', 1361) + '</w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>'
    + lvl(0, 'decimal', '%1.', 567) + lvl(1, 'lowerLetter', '(%2)', 964) + lvl(2, 'lowerRoman', '%3.', 1361) + '</w:abstractNum>'
    // appendix headings: A, A.1, A.1.1 (a level set to 'none' shows nothing)
    + '<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/>' + [0, 1, 2, 3].map(i => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + (i ? 'decimal' : 'upperLetter') + '"/>'
      + '<w:lvlText w:val="' + (stl['h' + (i + 1)].num === 'none' ? '' : [...Array(i + 1).keys()].map(k => '%' + (k + 1)).join('.')) + '"/><w:lvlJc w:val="left"/><w:suff w:val="' + (stl['h' + (i + 1)].num === 'none' ? 'nothing' : 'space') + '"/><w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl>').join('') + '</w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
    + '<w:num w:numId="' + APPENDIX_NUM + '"><w:abstractNumId w:val="3"/></w:num>';
  orderedStarts.forEach((start, i) => {
    s += '<w:num w:numId="' + (3 + i) + '"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + start + '"/></w:lvlOverride></w:num>';
  });
  return s + '</w:numbering>';
}

const FOOTER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>'
  + field('PAGE', '1') + '</w:p></w:ftr>';

const SETTINGS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
  + '<w:defaultTabStop w:val="709"/><w:characterSpacingControl w:val="doNotCompress"/>'
  + '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr>'
  + '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
/** settings.xml; with footnotes it names their separators (Word expects that). */
const settingsXml = (hasFootnotes, tracking) => (hasFootnotes ? SETTINGS.replace('<w:characterSpacingControl', '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:characterSpacingControl') : SETTINGS)
  .replace('<w:defaultTabStop', (tracking ? '<w:trackRevisions/>' : '') + '<w:defaultTabStop');       // Word opens it with Track Changes on, as here

/** footnotes.xml: the two separators Word requires, then one footnote per reference. */
function footnotesXml(list) {
  const sep = (type, id, el) => '<w:footnote w:type="' + type + '" w:id="' + id + '"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><' + el + '/></w:r></w:p></w:footnote>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ' + NS + '>' + sep('separator', -1, 'w:separator') + sep('continuationSeparator', 0, 'w:continuationSeparator')
    + list.map(f => '<w:footnote w:id="' + f.id + '"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
      + '<w:r><w:t xml:space="preserve"> </w:t></w:r>' + f.body + '</w:p></w:footnote>').join('') + '</w:footnotes>';
}

/**
 * Build a .docx. opts.getImage(name) -> { bytes, ext ('png'|'jpg'|'gif'), w, h } (SVGs must be rasterised by the caller).
 * Returns { bytes: Uint8Array, problems }.
 */
export async function docToDocx(doc, opts) {
  if (hasSupplement(doc)) doc = splitParts(doc).main;          // the SI is its own document (parts.js)
  if (opts && opts.revisions === false) doc = finalDoc(doc);   // no tracked changes in the file: the final text
  const w = new Writer(doc, opts);
  const documentXml = w.finish(w.body());
  for (const f of w.footnotes) f.body = w.finish(f.body);
  const zip = new JSZip();
  const types = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>', '<Default Extension="jpg" ContentType="image/jpeg"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>', '<Default Extension="gif" ContentType="image/gif"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'];
  const cparts = commentParts(w.cmt);
  const extraRels = [];
  if (cparts) {
    types.push('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>');
    extraRels.push({ id: 'rIdComments', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments', target: 'comments.xml' },
      { id: 'rIdCommentsExt', type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', target: 'commentsExtended.xml' });
    zip.file('word/comments.xml', cparts.comments);
    zip.file('word/commentsExtended.xml', cparts.ext);
  }
  let hasCustom = false;
  {
    // custom document properties: Zotero's preferences, and our structured author block (read back by docxin.js)
    const chunks = (name, text) => { const out = []; for (let i = 0; i < text.length; i += 255) out.push([name + '_' + (out.length + 1), text.slice(i, i + 255)]); return out; };
    const props = [];
    let au = null; doc.forEach((n) => { if (n.type.name === 'authors') au = n.attrs; });
    if (au && au.list && au.list.length) props.push(...chunks('DTUSW_AUTHORS', JSON.stringify({ list: au.list, affils: au.affils })));
    if (w.zoteroUsed) {
      const pref = '<data data-version="3" zotero-version="7.0"><session id="' + Math.random().toString(36).slice(2, 10) + '"/><style id="' + x(styleId(styleOf(doc).cite, doc)) + '" locale="' + styleOf(doc).lang + '" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/></prefs></data>';
      props.push(...chunks('ZOTERO_PREF', pref));
    }
    if (props.length) {
      zip.file('docProps/custom.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        + props.map(([name, text], i) => '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="' + (i + 2) + '" name="' + name + '"><vt:lpwstr>' + x(text) + '</vt:lpwstr></property>').join('') + '</Properties>');
      types.push('<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>');
      hasCustom = true;
    }
  }
  if (w.footnotes.length) {
    types.push('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>');
    extraRels.push({ id: 'rIdFootnotes', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes', target: 'footnotes.xml' });
    zip.file('word/footnotes.xml', footnotesXml(w.footnotes));
  }
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + types.join('') + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + (hasCustom ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>' : '') + '</Relationships>');
  const rels = [
    { id: 'rIdStyles', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' },
    { id: 'rIdNumbering', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', target: 'numbering.xml' },
    { id: 'rIdSettings', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', target: 'settings.xml' },
    { id: 'rIdFooter', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', target: 'footer1.xml' },
    ...extraRels, ...w.rels];
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.map(r => '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + r.target + '"/>').join('') + '</Relationships>');
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', stylesXml(styleOf(doc)));
  zip.file('word/numbering.xml', numberingXml(w.lists, styleOf(doc), doc.attrs.part === 'si'));
  zip.file('word/settings.xml', settingsXml(w.footnotes.length > 0, !!(doc.attrs && doc.attrs.tracking)));
  zip.file('word/footer1.xml', FOOTER);
  const title = doc.firstChild && doc.firstChild.type.name === 'title' ? doc.firstChild.textContent : '';
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '<dc:title>' + x(title) + '</dc:title><dc:creator>DTU Science Writer</dc:creator></cp:coreProperties>');
  for (const m of w.media) zip.file(m.path, m.bytes);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, problems: w.problems };
}
