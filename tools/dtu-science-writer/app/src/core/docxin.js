/* Word .docx -> document (step 6). The reverse of docx.js, for any Word file — ours or someone else's.
   What becomes live content:
     styles      -> title, headings (levels 1–4, numbered or not), abstract, lists (bullets / numbers, nested)
     equations   -> Word equations (OMML) as LaTeX (ommlin.js): inline math and display equations (numbered ones too)
     fields      -> REF: cross-references to headings, figures, tables, equations (through Word's bookmarks);
                    SEQ: caption numbers (dropped: ours are automatic); TOC: table of contents / list of figures / tables;
                    Zotero and Mendeley citations (CSL_CITATION): citations + library; their bibliography: reference list
     pictures    -> figures, paired with their captions; tables with merged cells, paired with theirs
     footnotes and endnotes, comments with replies and "resolved", page breaks
   Tracked changes are accepted (insertions kept, deletions dropped) and counted. What cannot be converted is not
   dropped silently: MathType objects become marked placeholders, EMF/WMF pictures empty figures, and everything is
   listed in the report.
   Returns { json, media: [{ name, bytes }], report: { counts, notes } }. */
import JSZip from 'jszip';
import { parseXml, kids, kid, find, findAll, textOf, val, on } from './xml.js';
import { ommlToLatex, ommlRevision } from './ommlin.js';
import { addToLibrary, STYLES, styleId } from './references.js';
import { SIZES, LANGS } from './style.js';

const TEXT_W_DEFAULT = 11906 - 2 * 1417;       // twips: A4 with 2.5 cm margins
const SUPPORTED_IMG = /\.(png|jpe?g|gif|svg)$/i;

/* Symbol font (older documents type Greek and operators with it) */
const SYM_L = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ', SYM_U = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYM_X = { 0xB1: '±', 0xB4: '×', 0xB0: '°', 0xA3: '≤', 0xB3: '≥', 0xB9: '≠', 0xBB: '≈', 0xA5: '∞', 0xB6: '∂', 0xAE: '→', 0xAC: '←', 0xD7: '⋅', 0xB5: '∝', 0x2D: '−', 0xD1: '∇', 0xD6: '√', 0xE5: '∑', 0xF2: '∫', 0xA2: '′', 0xB2: '″', 0xBA: '≡', 0x40: '≅', 0x7E: '∼', 0xCE: '∈', 0xC5: '⊕', 0xC4: '⊗', 0xBC: '…', 0xD0: '∠' };
function symbolChar(code) {
  code &= 0xFF;
  if (code >= 0x61 && code <= 0x7A) return SYM_L[code - 0x61];
  if (code >= 0x41 && code <= 0x5A) return SYM_U[code - 0x41];
  return SYM_X[code] || String.fromCharCode(code);
}

export async function docxToDocument(bytes, opts = {}) {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p) => (zip.file(p) ? parseXml(await zip.file(p).async('string')) : null);
  const docXml = await read('word/document.xml');
  if (!docXml) throw new Error('This is not a Word document (word/document.xml is missing).');
  const [stylesXml, numXml, footXml, endXml, cmtXml, cmtExtXml, relsXml, customXml, settingsXml] = await Promise.all(
    ['word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml', 'word/commentsExtended.xml', 'word/_rels/document.xml.rels', 'docProps/custom.xml', 'word/settings.xml'].map(read));

  const report = { counts: {}, notes: [] };
  const count = (k, n = 1) => { report.counts[k] = (report.counts[k] || 0) + n; };
  const noteCounts = {};
  const note = (k, detail) => { (noteCounts[k] = noteCounts[k] || []).push(detail); };

  /* ---------- styles ---------- */
  const styles = new Map();
  for (const s of findAll(stylesXml, 'w:style')) {
    const pPr = kid(s, 'w:pPr');
    styles.set(s.attrs['w:styleId'], { id: s.attrs['w:styleId'], name: (val(s, 'w:name') || '').toLowerCase(), basedOn: val(s, 'w:basedOn'), outline: pPr && kid(pPr, 'w:outlineLvl') ? +val(pPr, 'w:outlineLvl') : null, numPr: pPr ? kid(pPr, 'w:numPr') : null, rPr: kid(s, 'w:rPr') });
  }
  const styleChain = (id) => { const out = []; for (let s = styles.get(id), k = 0; s && k < 12; s = styles.get(s.basedOn), k++) out.push(s); return out; };
  const styleKind = (id) => {
    const chain = styleChain(id);
    if (!chain.length) return { kind: 'p' };
    const names = chain.map(s => s.name), ids = chain.map(s => s.id.toLowerCase());
    const is = (re) => names.some(n => re.test(n)) || ids.some(n => re.test(n));
    for (const s of chain) {
      const m = /^heading\s*(\d)$/.exec(s.name) || /^heading(\d)$/.exec(s.id.toLowerCase());
      if (m) return { kind: 'heading', level: Math.min(4, Math.max(1, +m[1])) };
    }
    if (is(/^part ?label$/)) return { kind: 'partlabel' };
    if (is(/^title$/)) return { kind: 'title' };
    if (is(/^subtitle$/)) return { kind: 'p' };
    if (is(/^caption$/)) return { kind: 'caption' };
    if (is(/^abstract$/)) return { kind: 'abstract' };
    if (is(/^authors?$/)) return { kind: 'authors' };
    if (is(/^affiliations?$/)) return { kind: 'affil' };
    if (is(/^toc ?\d$|^toc heading$|^tocheading$|^table ?of ?figures$/)) return { kind: 'toc' };
    if (is(/^bibliography/)) return { kind: 'bib' };
    const o = chain.find(s => s.outline != null);
    if (o && o.outline < 4) return { kind: 'heading', level: o.outline + 1 };
    return { kind: 'p' };
  };

  /* ---------- numbering (lists) ---------- */
  const abstractNums = new Map(), nums = new Map();
  for (const a of findAll(numXml, 'w:abstractNum')) {
    const lv = {};
    for (const l of kids(a, 'w:lvl')) lv[+l.attrs['w:ilvl']] = { fmt: val(l, 'w:numFmt') || 'decimal', start: +(val(l, 'w:start') || 1) };
    abstractNums.set(a.attrs['w:abstractNumId'], lv);
  }
  for (const n of findAll(numXml, 'w:num')) {
    const ov = {};
    for (const o of kids(n, 'w:lvlOverride')) { const so = kid(o, 'w:startOverride'); if (so) ov[+o.attrs['w:ilvl']] = +so.attrs['w:val']; }
    nums.set(n.attrs['w:numId'], { abs: val(n, 'w:abstractNumId'), starts: ov });
  }
  const listInfo = (numId, ilvl) => {
    const n = nums.get(String(numId));
    const lv = n && abstractNums.get(n.abs) ? abstractNums.get(n.abs)[ilvl] || abstractNums.get(n.abs)[0] : null;
    return { ordered: lv ? lv.fmt !== 'bullet' && lv.fmt !== 'none' : false, start: (n && n.starts[ilvl]) || (lv && lv.start) || 1, fmt: lv ? lv.fmt : 'bullet' };
  };

  /* ---------- relationships and media ---------- */
  const rels = new Map();
  for (const r of findAll(relsXml, 'Relationship')) rels.set(r.attrs.Id, { target: r.attrs.Target, type: r.attrs.Type, external: r.attrs.TargetMode === 'External' });
  const media = [], mediaByPath = new Map();
  async function imageFor(rId) {
    const rel = rels.get(rId);
    if (!rel || rel.external) return null;
    const p = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target.replace(/^\.\//, '');
    if (mediaByPath.has(p)) return mediaByPath.get(p);
    const f = zip.file(p);
    const base = p.split('/').pop();
    let out = null;
    if (!f) out = null;
    else if (!SUPPORTED_IMG.test(base)) { note('image', base); out = { name: '', unsupported: base }; }
    else { const name = 'word-' + base.replace(/[^A-Za-z0-9._-]+/g, '-'); media.push({ name, bytes: await f.async('uint8array') }); out = { name }; }
    mediaByPath.set(p, out);
    return out;
  }

  /* ---------- comments ---------- */
  const threads = {}, threadOf = new Map();      // Word comment id -> thread id (top comments only)
  if (cmtXml) {
    const ext = new Map();                        // paraId -> { parent, done }
    for (const e of findAll(cmtExtXml, 'w15:commentEx')) ext.set(e.attrs['w15:paraId'], { parent: e.attrs['w15:paraIdParent'] || null, done: e.attrs['w15:done'] === '1' });
    const all = findAll(cmtXml, 'w:comment').map((c) => {
      const ps = findAll(c, 'w:p');
      const paraId = ps.length ? ps[ps.length - 1].attrs['w14:paraId'] : null;
      const text = ps.map(p => findAll(p, 'w:t').map(textOf).join('')).join('\n').trim();
      return { id: c.attrs['w:id'], author: c.attrs['w:author'] || '', initials: c.attrs['w:initials'] || '', time: c.attrs['w:date'] || '', text, paraId, paraIds: ps.map(p => p.attrs['w14:paraId']) };
    });
    const byPara = new Map();
    for (const c of all) for (const p of c.paraIds) if (p) byPara.set(p, c);
    for (const c of all) {
      const e = c.paraId ? ext.get(c.paraId) : null;
      const parent = e && e.parent ? byPara.get(e.parent) : null;
      if (parent && parent !== c) { c.parent = parent; continue; }
      const id = 'c-w' + c.id;
      threads[id] = { id, author: c.author, initials: c.initials, time: c.time, text: c.text, resolved: !!(e && e.done), replies: [] };
      threadOf.set(c.id, id);
    }
    for (const c of all) {
      if (!c.parent) continue;
      let top = c.parent; while (top.parent) top = top.parent;
      const t = threads['c-w' + top.id];
      if (t) t.replies.push({ id: 'r-w' + c.id, author: c.author, initials: c.initials, time: c.time, text: c.text });
    }
    for (const t of Object.values(threads)) t.replies.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    count('comments', Object.keys(threads).length);
  }

  /* ---------- the walk ---------- */
  let library = {};
  const ctx = {
    comments: new Set(),          // Word comment ids open at this point
    fields: [],                   // open complex fields (they may span paragraphs)
    bookmarks: new Map(),         // bookmark name -> block id
    // tracked changes (Word revisions -> our ins / del marks and block flags, track.js)
    rev: { ins: null, del: null }, revLast: null, revBreak: true, revCount: 0, pendingMark: null, madeText: null, wantEmpty: false,
    seq: 0, tracked: 0, mathtype: 0, usedThreads: new Set(), textW: TEXT_W_DEFAULT, citeStyle: null,
  };
  const sect = find(docXml, 'w:sectPr');
  if (sect) { const sz = kid(sect, 'w:pgSz'), mar = kid(sect, 'w:pgMar'); if (sz && mar) ctx.textW = (+sz.attrs['w:w'] || 11906) - (+mar.attrs['w:left'] || 1417) - (+mar.attrs['w:right'] || 1417); }
  const newId = (prefix) => prefix + '-w' + (++ctx.seq);
  const marksOf = (rPr, base = []) => {
    const m = new Set(base);
    if (rPr) {
      if (kid(rPr, 'w:b')) { if (on(rPr, 'w:b')) m.add('bold'); else m.delete('bold'); }
      if (kid(rPr, 'w:i')) { if (on(rPr, 'w:i')) m.add('italic'); else m.delete('italic'); }
      const u = kid(rPr, 'w:u'); if (u) { if (u.attrs['w:val'] && u.attrs['w:val'] !== 'none') m.add('underline'); else m.delete('underline'); }
      const va = val(rPr, 'w:vertAlign'); if (va === 'superscript') m.add('sup'); else if (va === 'subscript') m.add('sub');
      const hl = val(rPr, 'w:highlight');
      if (hl !== null) { for (const k of [...m]) if (k.startsWith('highlight:')) m.delete(k); if (hl && hl !== 'none') m.add('highlight:' + hl); }
      const col = val(rPr, 'w:color');
      if (col !== null) { for (const k of [...m]) if (k.startsWith('color:')) m.delete(k); if (/^[0-9A-Fa-f]{6}$/.test(col) && col !== '000000') m.add('color:' + col.toUpperCase()); }
    }
    return [...m];
  };
  const keepRevisions = !(opts && opts.acceptRevisions);
  const revOf = (el) => ({ author: el.attrs['w:author'] || 'Unknown', time: el.attrs['w:date'] || '' });
  const initialsOf = (name) => String(name || '').split(/[\s.-]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  /* Neighbouring revisions of one author made at the same time are one change (typed text, a replacement, a new
     paragraph with its text): they share the id until other text comes between. */
  const revAttrs = (r) => {
    const key = r.author + '|' + r.time;
    if (ctx.revBreak || !ctx.revLast || ctx.revLast.key !== key) ctx.revLast = { key, id: 't-w' + (++ctx.revCount) };
    ctx.revBreak = false;
    return { id: ctx.revLast.id, author: r.author, initials: initialsOf(r.author), time: r.time };
  };
  const currentRev = () => (ctx.rev.del ? { kind: 'del', r: ctx.rev.del } : ctx.rev.ins ? { kind: 'ins', r: ctx.rev.ins } : null);
  const withMarks = (node, marks) => {
    const all = marks.map(type => { const i = type.indexOf(':'); return i > 0 ? { type: type.slice(0, i), attrs: { color: type.slice(i + 1) } } : { type }; });
    if (ctx.rev.ins) all.push({ type: 'ins', attrs: revAttrs(ctx.rev.ins) });
    if (ctx.rev.del) all.push({ type: 'del', attrs: revAttrs(ctx.rev.del) });
    if (!ctx.rev.ins && !ctx.rev.del && !(node.type === 'text' && !String(node.text).trim())) ctx.revBreak = true;
    for (const c of ctx.comments) { const t = threadOf.get(c); if (t) { all.push({ type: 'comment', attrs: { id: t } }); ctx.usedThreads.add(t); } }
    return all.length ? { ...node, marks: all } : node;
  };
  /* Word equations. A tracked change inside one (Word keeps it inside the math) makes the equation a change of its
     own: the old version (Reject) as a deletion, the new one (Accept) as an insertion — for a display equation that is
     one "changed equation" suggestion. MathType objects inside a Word equation become the usual placeholder. */
  const mathObjects = new Map();
  const onObject = (obj) => {
    if (!mathObjects.has(obj)) {
      const ole = find(obj, 'o:OLEObject');
      let tex;
      if (ole && /equation|mathtype/i.test(ole.attrs.ProgID || '')) tex = '\\text{[MathType equation ' + (++ctx.mathtype) + ' — retype]}';
      else { note('object', (ole && ole.attrs.ProgID) || 'an embedded object'); tex = '\\text{[object]}'; }
      mathObjects.set(obj, tex);
    }
    return mathObjects.get(obj);
  };
  const mathOf = (el) => {
    const latex = ommlToLatex(el, { onObject });
    const rev = keepRevisions ? ommlRevision(el) : null;
    if (!rev) return { latex, old: latex, rev: null };
    return { latex, old: ommlToLatex(el, { view: 'reject', onObject }), rev };
  };
  const text = (s, marks) => { s = String(s).replace(/​/g, ''); return s ? withMarks({ type: 'text', text: s }, marks) : null; };

  /* A field whose result is a whole block: a table of contents / list, or a reference list (Zotero, Mendeley, Word). */
  function blockField(instr) {
    const ins = instr.replace(/\s+/g, ' ').trim();
    if (/ZOTERO_BIBL|CSL_BIBLIOGRAPHY|Mendeley Bibliography|^BIBLIOGRAPHY/i.test(ins)) return { type: 'bibliography' };
    if (/^TOC\b/i.test(ins)) return { type: 'outline', attrs: { kind: /\\c\s+"?Fig/i.test(ins) ? 'figures' : /\\c\s+"?Tab/i.test(ins) ? 'tables' : 'contents' } };
    return null;
  }

  /* a finished field -> inline nodes */
  /* A citation's text in Word is the field result; what the citation itself reads is in the field (plainCitation).
     When a Word author typed into the result ("1" -> "1, 45"), the typed text is kept beside the citation (with its
     tracked-change marks); a change that is not an addition before or after is reported. */
  const flat = (s) => String(s || '').replace(/[\s\u00a0]+/g, ' ');
  function sliceInline(nodes, from, to) {
    const out = []; let pos = 0;
    for (const n of nodes) {
      if (n.type !== 'text') { if (pos >= from && pos < to) out.push(n); continue; }
      const a = Math.max(from, pos), b = Math.min(to, pos + n.text.length);
      if (b > a) out.push({ ...n, text: n.text.slice(a - pos, b - pos) });
      pos += n.text.length;
    }
    return out;
  }
  function typedAroundCitation(cit, result, plain) {
    if (typeof plain !== 'string' || !plain.trim()) return [cit];
    const shown = flat(result.map(n => (n.type === 'text' ? n.text : '')).join(''));
    const want = flat(plain);
    if (shown === want || shown.trim() === want.trim()) return [cit];
    const at = shown.indexOf(want.trim());
    if (at < 0) { note('citechanged', shown.trim() + '|' + want.trim()); return [cit]; }
    const end = at + want.trim().length;
    const before = sliceInline(result, 0, at), after = sliceInline(result, end, shown.length);
    const typed = (before.concat(after)).map(n => n.text || '').join('');
    if (!typed.trim()) return [cit];
    note('citetyped', typed.trim());
    return [...before, cit, ...after];
  }

  function fieldNodes(instr, result, para, marks) {
    const ins = instr.replace(/\s+/g, ' ').trim();
    const word = (ins.split(' ')[0] || '').toUpperCase();
    if (word === 'REF') {
      const bm = ins.split(' ')[1];
      count('xrefs');
      return [withMarks({ type: 'xref', attrs: { target: 'bm:' + bm }, fallback: result.map(n => n.text || '').join('') }, [])];
    }
    if (word === 'SEQ') { para.seq = (ins.split(' ')[1] || '').toLowerCase(); return [{ type: 'seq', text: result.map(n => n.text || '').join('') }]; }
    if (/CSL_CITATION/.test(ins)) {
      const j = ins.slice(ins.indexOf('{'));
      try {
        const data = JSON.parse(j);
        const items = [];
        for (const ci of data.citationItems || []) {
          if (!ci.itemData) continue;
          const uri = (ci.uris || ci.uri || [])[0];
          const z = uri && /zotero\.org/.test(uri) ? { zotero: { id: uri, key: uri.split('/').pop() } } : {};
          const r = addToLibrary(library, [{ ...ci.itemData, ...z }]);
          library = r.library;
          if (r.keys[0]) items.push({ id: r.keys[0], ...(ci.locator ? { locator: String(ci.locator) } : {}) });
        }
        if (items.length) {
          count('citations');
          const cit = withMarks({ type: 'citation', attrs: { items, mode: (data.citationItems || []).some(c => c['suppress-author']) ? 'suppress-author' : 'normal' } }, []);
          return typedAroundCitation(cit, result, data.properties && data.properties.plainCitation);
        }
      } catch (_) { note('citation', 'a citation field could not be read'); }
      return result;
    }
    if (blockField(ins)) return [];                    // TOC / bibliography: the block was made when the field's result began
    if (/EN\.CITE|EN\.REFLIST/.test(ins)) note('endnote', 'EndNote');
    return result;                 // HYPERLINK, PAGEREF, DATE, … : the text Word showed
  }

  /* inline content of a paragraph (or footnote / comment paragraph) */
  async function inline(p, para, baseMarks = []) {
    const out = [];
    const push = (n) => {
      if (!n) return;
      const f = ctx.fields[ctx.fields.length - 1];
      if (f) { if (f.phase === 'result') f.result.push(n); return; }       // inside a field: its result, or dropped while in the code
      out.push(n);
    };
    const walk = async (el, marks) => {
      for (const c of el.children) {
        if (!c.name) continue;
        switch (c.name) {
          case 'w:r': await run(c, marks); break;
          case 'w:ins': case 'w:moveTo': {
            ctx.tracked++;
            if (!keepRevisions) { await walk(c, marks); break; }
            const prev = ctx.rev.ins; ctx.rev.ins = revOf(c);
            await walk(c, marks);
            ctx.rev.ins = prev;
            break;
          }
          case 'w:del': case 'w:moveFrom': {
            ctx.tracked++;
            if (!keepRevisions) break;                          // accepted: the deleted text is left out
            const prev = ctx.rev.del; ctx.rev.del = revOf(c);
            await walk(c, marks);
            ctx.rev.del = prev;
            break;
          }
          case 'w:hyperlink': case 'w:smartTag': case 'w:sdt': case 'w:sdtContent': case 'w:customXml': await walk(c, marks); break;
          case 'w:fldSimple': {
            const inner = [];
            ctx.fields.push({ instr: c.attrs['w:instr'] || '', result: inner, phase: 'result', simple: true });
            { const b = blockField(c.attrs['w:instr'] || ''); if (b && !para.block) para.block = b; }
            await walk(c, marks);
            const f = ctx.fields.pop();
            for (const n of fieldNodes(f.instr, f.result, para, marks)) push(n);
            break;
          }
          case 'w:bookmarkStart': if (c.attrs['w:name'] && c.attrs['w:name'] !== '_GoBack') para.bookmarks.push(c.attrs['w:name']); break;
          case 'w:commentRangeStart': ctx.comments.add(c.attrs['w:id']); para.comments.add(c.attrs['w:id']); break;
          case 'w:commentRangeEnd': ctx.comments.delete(c.attrs['w:id']); break;
          case 'm:oMathPara': case 'm:oMath': {
            const display = c.name === 'm:oMathPara';
            const { latex, old, rev } = mathOf(c);
            const emit = (tex) => { if (display) para.display.push(tex); else count('math'); push(withMarks({ type: 'math_inline', attrs: { latex: tex }, ...(display ? { display: true } : {}) }, [])); };
            if (latex === old) { if (latex) emit(latex); break; }
            ctx.tracked++;
            if (old) { const prev = ctx.rev.del; ctx.rev.del = rev; emit(old); ctx.rev.del = prev; }
            if (latex) { const prev = ctx.rev.ins; ctx.rev.ins = rev; emit(latex); ctx.rev.ins = prev; }
            break;
          }
          default: break;
        }
      }
    };
    const run = async (r, base) => {
      const rPr = kid(r, 'w:rPr');
      let marks = marksOf(rPr, base);
      if (para.plainMarks) marks = marks.filter(m => m !== 'bold' && m !== 'underline');       // headings, title: their style gives the weight
      const symbolFont = rPr && kid(rPr, 'w:rFonts') && /^symbol$/i.test(kid(rPr, 'w:rFonts').attrs['w:ascii'] || '');
      for (const c of r.children) {
        if (!c.name) continue;
        switch (c.name) {
          case 'w:t': case 'w:delText': { let s = textOf(c); if (symbolFont) s = [...s].map(ch => symbolChar(ch.charCodeAt(0))).join(''); push(text(s, marks)); break; }
          case 'w:tab': push(text(para.tabAsSpace === false ? '\t' : ' ', marks)); break;
          case 'w:noBreakHyphen': push(text('‑', marks)); break;
          case 'w:sym': push(text(/symbol/i.test(c.attrs['w:font'] || '') ? symbolChar(parseInt(c.attrs['w:char'], 16)) : String.fromCharCode(parseInt(c.attrs['w:char'], 16) & 0xFFFF), marks)); break;
          case 'w:br': case 'w:cr':
            if (c.attrs['w:type'] === 'page') para.pageBreak = true; else if (out.length || ctx.fields.length) push({ type: 'hard_break' });
            break;
          case 'w:lastRenderedPageBreak': break;
          case 'w:fldChar': {
            const t = c.attrs['w:fldCharType'];
            if (t === 'begin') ctx.fields.push({ instr: '', result: [], phase: 'instr' });
            else if (t === 'separate') {
              const f = ctx.fields[ctx.fields.length - 1];
              if (f) { f.phase = 'result'; const b = blockField(f.instr); if (b && !para.block) { para.block = b; f.block = true; } }
            }
            else if (t === 'end') {
              const f = ctx.fields.pop();
              if (f) for (const n of fieldNodes(f.instr, f.result, para, marks)) push(n);
            }
            break;
          }
          case 'w:instrText': case 'w:delInstrText': { const f = ctx.fields[ctx.fields.length - 1]; if (f && f.phase === 'instr') f.instr += textOf(c); break; }
          case 'w:footnoteReference': case 'w:endnoteReference': {
            const src = c.name === 'w:footnoteReference' ? footnotes : endnotes;
            const body = src.get(c.attrs['w:id']);
            if (body) { count('footnotes'); push({ type: 'footnote', content: body }); }
            break;
          }
          case 'w:drawing': case 'w:pict': {
            const blip = find(c, 'a:blip'), vimg = find(c, 'v:imagedata');
            const rId = blip ? blip.attrs['r:embed'] || blip.attrs['r:link'] : vimg ? vimg.attrs['r:id'] : null;
            const txbx = find(c, 'w:txbxContent');
            if (txbx) { para.textboxes.push(txbx); break; }
            if (!rId) { if (find(c, 'c:chart') || find(c, 'dgm:relIds')) note('object', 'a chart or diagram'); break; }
            const img = await imageFor(rId);
            if (!img) break;
            const ext = find(c, 'wp:extent');
            const frac = ext ? Math.min(1, Math.max(0.15, (+ext.attrs.cx / 635) / ctx.textW)) : 0.8;
            para.images.push({ ...img, width: Math.round(frac * 100) / 100, anchored: !!find(c, 'wp:anchor'), rev: currentRev() });
            break;
          }
          case 'w:object': {
            const ole = find(c, 'o:OLEObject');
            if (ole && /equation|mathtype/i.test(ole.attrs.ProgID || '')) {
              const n = ++ctx.mathtype;
              push(withMarks({ type: 'math_inline', attrs: { latex: '\\text{[MathType equation ' + n + ' — retype]}' }, mathtype: true }, []));
            } else note('object', (ole && ole.attrs.ProgID) || 'an embedded object');
            break;
          }
          default: break;
        }
      }
    };
    await walk(p, baseMarks);
    return out;
  }

  /* footnotes and endnotes: id -> inline nodes */
  async function notesOf(xml, tag) {
    const map = new Map();
    for (const f of findAll(xml, tag)) {
      if (f.attrs['w:type']) continue;                              // separators
      const parts = [];
      for (const p of findAll(f, 'w:p')) {
        const para = newPara();
        const nodes = await inline(p, para);
        if (parts.length && nodes.length) parts.push({ type: 'text', text: ' ' });
        parts.push(...nodes);
      }
      const clean = tidy(parts).filter(n => ['text', 'math_inline', 'citation', 'xref', 'hard_break'].includes(n.type));
      if (clean.length && clean[0].type === 'text') clean[0] = { ...clean[0], text: clean[0].text.replace(/^\s+/, '') };
      map.set(f.attrs['w:id'], clean.filter(n => n.type !== 'text' || n.text));
    }
    return map;
  }
  const newPara = () => ({ bookmarks: [], comments: new Set(ctx.comments), display: [], images: [], textboxes: [], seq: null, block: null, pageBreak: false });

  /** merge neighbouring text nodes with the same marks; drop internal helpers */
  function tidy(nodes) {
    const out = [];
    for (const n of nodes) {
      if (!n) continue;
      const p = out[out.length - 1];
      if (p && p.type === 'text' && n.type === 'text' && JSON.stringify(p.marks || []) === JSON.stringify(n.marks || [])) p.text += n.text;
      else out.push({ ...n });
    }
    return out;
  }
  const plainText = (nodes) => nodes.map(n => (n.type === 'text' || n.type === 'seq' ? n.text : n.type === 'xref' ? n.fallback || '' : '')).join('');
  const trimEnds = (nodes, keep = {}) => {
    const out = tidy(nodes);
    if (!keep.start) while (out.length && out[0].type === 'text' && !out[0].text.trim()) out.shift();
    if (!keep.end) while (out.length && out[out.length - 1].type === 'text' && !out[out.length - 1].text.trim()) out.pop();
    if (!keep.start && out.length && out[0].type === 'text') out[0].text = out[0].text.replace(/^\s+/, '');
    if (!keep.end && out.length && out[out.length - 1].type === 'text') out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
    return out.filter(n => n.type !== 'text' || n.text);
  };
  const realInline = (nodes) => nodes.filter(n => n.type !== 'seq').map(({ fallback, display, mathtype, ...n }) => n);

  const footnotes = new Map(), endnotes = new Map();
  for (const [k, v] of await notesOf(footXml, 'w:footnote')) footnotes.set(k, realInline(v));
  for (const [k, v] of await notesOf(endXml, 'w:endnote')) endnotes.set(k, realInline(v));

  /* ---------- blocks ---------- */
  const blocks = [];
  let title = null, authorsRaw = [], affilRaw = [], abstract = [], guessedAuthors = '';
  let abstractOpen = false, keywordsNext = false;        // after a line that only says "Abstract" / "Keywords"
  const TYPED_CAPTION = /^\s*(fig(?:ure)?|scheme|chart|table)\.?\s*S?\d+[a-z]?\s*[:.|–—-]\s*\S/i;
  const NAME_WORD = /^(?:\p{Lu}[\p{L}.'’-]*|van|von|de|der|den|del|di|da|la|le|bin|al|af|ten|ter)$/u;
  const looksLikeNames = (text) => {
    const t = text.trim();
    if (t.length < 4 || t.length > 600 || /[!?:]|\d/.test(t)) return false;
    const pieces = t.split(/\s*(?:,|;|&|\band\b|\bog\b|\bund\b)\s*/).map(x => x.replace(/[*†‡§]+$/, '').trim()).filter(Boolean);
    return pieces.length > 0 && pieces.every(x => { const w = x.split(/\s+/); return w.length >= 2 && w.length <= 5 && w.every(y => NAME_WORD.test(y)) && /\p{L}{2}/u.test(w[w.length - 1]); });
  };
  let pendingCaption = null;       // { kind, content, id } waiting for its picture or table
  let lastFigure = null, lastTable = null;
  const listStack = [];            // open lists: { node, ilvl, numId }
  const closeLists = () => { listStack.length = 0; };
  const addBlock = (b) => { closeLists(); blocks.push(b); if (b.type === 'paragraph' || b.type === 'heading') ctx.madeText = b; return b; };
  /* Word keeps an inserted / deleted paragraph boundary on the paragraph before it (its paragraph mark); we keep it
     on the text block after. When nothing follows to carry it, a paragraph that is itself wholly inserted / deleted
     carries it; otherwise it is dropped (accepted). */
  const flushPendingMark = () => {
    const pm = ctx.pendingMark;
    ctx.pendingMark = null;
    if (pm && pm.node && pm.whole) pm.node.attrs = { ...(pm.node.attrs || {}), track: pm.track };
  };
  const bind = (para, id) => { for (const b of para.bookmarks) if (!ctx.bookmarks.has(b)) ctx.bookmarks.set(b, id); };
  const threadIds = (para) => { const ids = []; for (const c of para.comments) { const t = threadOf.get(c); if (t) { ids.push(t); ctx.usedThreads.add(t); } } return ids; };

  /** "Fig. 3. Text" / "Figure 3: Text" / "Table 2 – Text" -> caption content without the label and number */
  function captionContent(nodes) {
    let out = trimEnds(nodes);
    const i = out.findIndex(n => n.type === 'seq');
    if (i >= 0) out = out.slice(i + 1);
    else if (out.length && out[0].type === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s*(fig(ure)?|table|tab|scheme)\.?\s*\d+[a-z]?\s*/i, '') };
    if (out.length && out[0].type === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s*[.:–—-]?\s*/, '') };
    // captions are not bold in our model (the label is drawn by the app)
    return realInline(trimEnds(out)).map(n => (n.marks ? { ...n, marks: n.marks.filter(m => m.type !== 'bold') } : n)).map(n => (n.marks && !n.marks.length ? (({ marks, ...r }) => r)(n) : n));
  }
  const captionKind = (para, nodes) => (para.seq ? (/^tab/.test(para.seq) ? 'table' : /^(fig|scheme|chart)/.test(para.seq) ? 'figure' : /^(eq)/.test(para.seq) ? 'equation' : 'figure') : /^\s*(table|tab\.)/i.test(plainText(nodes)) ? 'table' : 'figure');

  function figureNode(img, caption, attrs = {}) {
    count('figures');
    return { type: 'figure', attrs: { placement: 'here', pos: 'top', side: 'right', width: img.width || 0.8, id: attrs.id || newId('fig'), comments: attrs.comments || [], annotations: [], track: img.rev ? { kind: img.rev.kind, ...revAttrs(img.rev.r) } : null },
      content: [{ type: 'image', attrs: { src: img.name || '', w: 0, h: 0 } }, { type: 'caption', content: caption || [] }] };
  }

  async function tableNode(tbl) {
    const rows = [];
    const trs = kids(tbl, 'w:tr');
    const open = [];           // column -> cell still spanning rows (vMerge)
    for (let r = 0; r < trs.length; r++) {
      const tr = trs[r];
      const header = !!(kid(tr, 'w:trPr') && kid(kid(tr, 'w:trPr'), 'w:tblHeader'));
      const cells = [];
      let col = 0;
      for (const tc of kids(tr, 'w:tc')) {
        const pr = kid(tc, 'w:tcPr');
        const span = pr && kid(pr, 'w:gridSpan') ? +val(pr, 'w:gridSpan') || 1 : 1;
        const vm = pr ? kid(pr, 'w:vMerge') : null;
        if (vm && (vm.attrs['w:val'] || 'continue') === 'continue' && open[col]) { open[col].attrs.rowspan++; col += span; continue; }
        const content = [];
        let align = null;
        for (const p of kids(tc, 'w:p')) {
          const para = newPara();
          const nodes = realInline(trimEnds(await inline(p, para)));
          const jc = val(kid(p, 'w:pPr'), 'w:jc');
          if (!align && (jc === 'center' || jc === 'right')) align = jc;
          if (para.images.length) note('cellimage', 'a picture inside a table cell');
          content.push(nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' });
        }
        if (kids(tc, 'w:tbl').length) { note('nested', 'a table inside a table'); for (const t of kids(tc, 'w:tbl')) content.push({ type: 'paragraph', content: [{ type: 'text', text: findAll(t, 'w:t').map(textOf).join(' ') }] }); }
        // drop empty paragraphs around real content
        let real = content.filter(c => c.content);
        if (header) real = real.map(par => ({ ...par, content: par.content.map(n => (n.marks ? (({ marks, ...rest }) => { const left = marks.filter(m => m.type !== 'bold'); return left.length ? { ...rest, marks: left } : rest; })(n) : n)) }));
        const cell = { type: header ? 'table_header' : 'table_cell', attrs: { colspan: span, rowspan: 1, colwidth: null, align }, content: real.length ? real : [{ type: 'paragraph' }] };
        cells.push(cell);
        for (let k = 0; k < span; k++) open[col + k] = vm ? cell : null;
        if (vm) open[col] = cell;
        col += span;
      }
      if (cells.length) rows.push({ type: 'table_row', content: cells });
    }
    // a header row: the first row when Word marks none but all its cells are bold is left as it is (no guessing)
    // every row inserted (or every row deleted): the table as a whole is
    const rowRev = trs.map((tr) => { const pr = kid(tr, 'w:trPr'); const d = pr && kid(pr, 'w:del'), i = pr && kid(pr, 'w:ins'); return d ? { kind: 'del', r: revOf(d) } : i ? { kind: 'ins', r: revOf(i) } : null; });
    const whole = keepRevisions && rowRev.length && rowRev.every(x => x && x.kind === rowRev[0].kind) ? rowRev[0] : null;
    return rows.length ? { type: 'table', content: rows, rev: whole } : null;
  }

  /** A table that only lays out one numbered equation (as our own export writes, and many authors do by hand). */
  function equationTable(tbl) {
    const trs = kids(tbl, 'w:tr');
    if (trs.length !== 1) return null;
    const maths = findAll(tbl, 'm:oMath');
    if (!maths.length) return null;
    const txt = findAll(tbl, 'w:t').map(textOf).join('').replace(/[\s​]/g, '');
    if (!/^\(?[\dA-Z.]*\)?$/i.test(txt)) return null;       // only an equation number beside the math
    const para = findAll(tbl, 'm:oMathPara')[0];
    return { ...mathOf(para || maths[0]), numbered: /\d/.test(txt) || findAll(tbl, 'w:instrText').some(i => /SEQ/i.test(textOf(i))) };
  }

  /* Manuscripts typed without Word's heading styles ("INTRODUCTION" in capitals, "Acknowledgments" on a line):
     only then are such lines read as headings, so a document that does use the styles is never second-guessed. */
  const SECTION_NAMES = /^(abstract|introduction|background|results|discussion|results and discussion|conclusions?|summary|outlook|methods|materials and methods|experimental( section| methods| details)?|methods and materials|theory|theoretical (model|methods)|acknowledge?ments?|references|bibliography|supporting information|supplementary (information|material)|associated content|author information|author contributions|data availability|code availability|competing interests|conflicts? of interest|notes|funding|appendix)$/i;
  if (ctx.plainHeadings === undefined) {
    const bodyEl = find(docXml, 'w:body');
    ctx.plainHeadings = !findAll(bodyEl, 'w:pStyle').some(ps => styleKind(ps.attrs['w:val']).kind === 'heading');
  }
  /** "RESULTS AND DISCUSSION" -> "Results and discussion" (words with digits or mixed case are kept). */
  const unshout = (t) => t.toLowerCase().replace(/^\s*\p{L}/u, c => c.toUpperCase());
  function plainHeading(txt, nodes, numId, hasImages) {
    const t = txt.trim();
    if (!ctx.plainHeadings || numId || hasImages || !t || t.length > 90 || /[.,;]$/.test(t)) return null;
    const words = t.replace(/[:]$/, '');
    if (SECTION_NAMES.test(words)) return { level: 1, caps: words === words.toUpperCase() };
    const letters = words.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 4 && letters === letters.toUpperCase() && /\p{Lu}{2}/u.test(letters) && words.split(/\s+/).length <= 8) return { level: 1, caps: true };
    // a short line that is bold all through: a subheading
    const texts = nodes.filter(n => n.type === 'text' && n.text.trim());
    if (texts.length && texts.every(n => (n.marks || []).some(m => m.type === 'bold')) && words.split(/\s+/).length <= 12 && !/@/.test(t)) return { level: 2, caps: false };
    return null;
  }

  async function paragraph(p) {
    const incoming = keepRevisions ? ctx.pendingMark : null;       // the boundary in front of this paragraph is tracked
    ctx.madeText = null;
    ctx.wantEmpty = !!incoming;
    const ownMark = (() => { const a = kid(p, 'w:pPr'), b = a && kid(a, 'w:rPr'); return !!(b && (kid(b, 'w:ins') || kid(b, 'w:del'))); })();
    ctx.keepStart = !!incoming; ctx.keepEnd = keepRevisions && ownMark;
    await paragraphInner(p);
    ctx.wantEmpty = false; ctx.keepStart = false; ctx.keepEnd = false;
    const made = ctx.madeText;
    if (incoming) {
      if (made) { ctx.pendingMark = null; made.attrs = { ...(made.attrs || {}), track: incoming.track }; }
      else flushPendingMark();
    }
    // this paragraph's own mark: the boundary to whatever comes next
    const pPr0 = kid(p, 'w:pPr'), rp = pPr0 && kid(pPr0, 'w:rPr');
    const mk = rp && (kid(rp, 'w:del') ? ['del', kid(rp, 'w:del')] : kid(rp, 'w:ins') ? ['ins', kid(rp, 'w:ins')] : null);
    if (mk && keepRevisions && made) {
      const inl = (made.content || []).filter(n => !(n.type === 'text' && !n.text.trim()));
      const whole = inl.every(n => (n.marks || []).some(m => m.type === mk[0]));
      ctx.pendingMark = { track: { kind: mk[0], ...revAttrs(revOf(mk[1])) }, node: made, whole };
    }
  }
  async function paragraphInner(p) {
    const pPr = kid(p, 'w:pPr');
    const styleIdOf = pPr ? val(pPr, 'w:pStyle') : null;
    const sk = styleKind(styleIdOf);
    const para = newPara();
    para.plainMarks = sk.kind === 'heading' || sk.kind === 'title';
    const wasOpen = ctx.fields.length > 0;            // inside a field that began in an earlier paragraph (TOC, bibliography)
    const nodes = await inline(p, para);
    const stillOpen = ctx.fields.length > 0;
    if (para.block) {
      if (para.block.type === 'outline') addBlock({ type: 'outline', attrs: { kind: para.block.attrs.kind, title: null } });
      else {
        // the heading typed above the list ("References") is the list's own title in our model
        const prev = blocks[blocks.length - 1];
        let title = 'References';
        if (prev && prev.type === 'heading' && /^(references?|bibliography|literature|works cited)$/i.test((prev.content || []).map(n => n.text || '').join('').trim())) { title = prev.content.map(n => n.text || '').join('').trim(); blocks.pop(); }
        addBlock({ type: 'bibliography', attrs: { title } });
      }
      ctx.inBlockField = stillOpen;
      return;
    }
    if (wasOpen || ctx.inBlockField) { if (!stillOpen) ctx.inBlockField = false; return; }      // the rest of a TOC / bibliography field
    if (sk.kind === 'toc') return;
    if (sk.kind === 'partlabel') { report.partLabel = plainText(nodes).trim(); return; }        // "Supplementary Information" above the title
    for (const tb of para.textboxes) { note('textbox', 'a text box'); for (const tp of findAll(tb, 'w:p')) await paragraph(tp); }
    if (para.pageBreak && !plainText(nodes).trim() && !para.images.length) { addBlock({ type: 'page_break' }); return; }
    const txt = plainText(nodes);
    const content = realInline(trimEnds(nodes, { start: ctx.keepStart, end: ctx.keepEnd }));

    // numbering of the paragraph itself, or of its style
    const numPr = (pPr && kid(pPr, 'w:numPr')) || (styleChain(styleIdOf).find(s => s.numPr) || {}).numPr || null;
    const numId = numPr ? val(numPr, 'w:numId') : null, ilvl = numPr ? +(val(numPr, 'w:ilvl') || 0) : 0;

    if (!title && sk.kind === 'p' && !blocks.length && !abstract.length && !authorsRaw.length && !numId && !para.images.length && content.length) {
      const t = txt.trim();
      if (t.length >= 10 && t.length <= 300 && !/[.:;,]$/.test(t) && !/^abstract\b/i.test(t) && content.every(n => n.type === 'text' || n.type === 'math_inline')) {
        title = content.map(n => (n.marks ? (({ marks, ...r }) => { const keep = marks.filter(m => m.type === 'sub' || m.type === 'sup'); return keep.length ? { ...r, marks: keep } : r; })(n) : n));
        ctx.guessedTitle = true;
        return;
      }
    }
    if (sk.kind === 'title' && !title) { title = content.filter(n => n.type === 'text' || n.type === 'math_inline'); return; }
    if (sk.kind === 'authors') { authorsRaw.push(nodes); return; }
    if (sk.kind === 'affil') { affilRaw.push(nodes); return; }
    /* Most Word manuscripts have no "Author" style: a plain line right under the title that reads as a list of names
       is the author line, and lines after it that start with a superscript mark are the affiliations. */
    if (title && !blocks.length && !abstract.length && !numId && !['heading', 'caption', 'toc', 'abstract'].includes(sk.kind) && content.length && content.every(n => n.type === 'text')) {
      const isSup = (n) => (n.marks || []).some(m => m.type === 'sup');
      if (!authorsRaw.length && looksLikeNames(content.filter(n => !isSup(n)).map(n => n.text).join(''))) { authorsRaw.push(nodes); guessedAuthors = txt.trim(); return; }
      if (authorsRaw.length && (isSup(content[0]) || /^\s*[*†‡]?\s*(e-?mail|corresponding author|to whom correspondence)/i.test(txt))) { affilRaw.push(nodes); return; }
    }
    // (C) "Abstract" on a line of its own: the paragraphs after it are the abstract; "Keywords" likewise labels the next one
    if (!blocks.length && !numId && sk.kind !== 'heading' && sk.kind !== 'caption' && !para.images.length) {
      if (/^\s*abstract\s*[.:]?\s*$/i.test(txt) && !abstract.length) { abstractOpen = true; return; }
      if (/^\s*key\s?words?\s*[.:]?\s*$/i.test(txt)) { abstractOpen = false; keywordsNext = true; return; }
      if (/^\s*key\s?words?\b/i.test(txt)) abstractOpen = false;
      if (keywordsNext && content.length) { keywordsNext = false; addBlock({ type: 'paragraph', content: [{ type: 'text', text: 'Keywords: ', marks: [{ type: 'bold' }] }, ...content] }); count('paragraphs'); return; }
      if (abstractOpen && content.length) { abstract.push({ type: 'paragraph', content }); return; }
    }
    if (sk.kind === 'abstract' || (!blocks.length && !abstract.length && /^\s*abstract\b/i.test(txt) && txt.trim().length > 20)) {
      const c = content.slice();
      if (c.length && c[0].type === 'text') { c[0] = { ...c[0], text: c[0].text.replace(/^\s*abstract\s*[.:–—-]?\s*/i, '') }; if (c[0].marks) c[0].marks = c[0].marks.filter(m => m.type !== 'bold'); if (c[0].marks && !c[0].marks.length) delete c[0].marks; if (!c[0].text) c.shift(); }
      if (c.length) abstract.push({ type: 'paragraph', content: c });
      return;
    }
    if (sk.kind === 'heading') {
      if (!txt.trim()) return;
      if (!title && !blocks.length && !abstract.length && !authorsRaw.length) { title = content.filter(n => n.type === 'text' || n.type === 'math_inline').map(n => (n.marks ? (({ marks, ...r }) => r)(n) : n)); return; }
      abstractOpen = false;
      const numbered = !!numId && numId !== '0';
      const c = content.filter(n => n.type !== 'hard_break');
      let typedNumber = false;
      if (c.length && c[0].type === 'text' && /^\s*(\d+|[A-Z])(\.\d+)*\.?\s+\S/.test(c[0].text) && !numbered) { c[0] = { ...c[0], text: c[0].text.replace(/^\s*(\d+|[A-Z])(\.\d+)*\.?\s+/, '') }; typedNumber = true; }
      const id = newId('sec');
      bind(para, id);
      count('headings');
      const appendix = numbered && numId === String(opts.appendixNumId || 60) && sk.level === 1 && !ctx.appendixSeen;
      if (appendix) ctx.appendixSeen = true;
      addBlock({ type: 'heading', attrs: { level: sk.level, numbered: numbered || typedNumber, id, appendix }, content: c });
      return;
    }
    if (sk.kind !== 'caption' && (blocks.length || abstract.length || authorsRaw.length || title)) {
      const ph = plainHeading(txt, content, numId && numId !== '0', para.images.length);
      if (ph && !(ph.level === 1 && /^abstract:?$/i.test(txt.trim()) && !blocks.length)) {
        abstractOpen = false; keywordsNext = false;
        let c = content.filter(n => n.type !== 'hard_break').map(n => (n.marks ? (({ marks, ...r }) => { const keep = marks.filter(m => m.type === 'sub' || m.type === 'sup' || m.type === 'italic'); return keep.length ? { ...r, marks: keep } : r; })(n) : n));
        if (ph.caps) c = c.map((n, i) => (n.type === 'text' ? { ...n, text: i === 0 ? unshout(n.text) : n.text.toLowerCase() } : n));
        if (c.length && c[c.length - 1].type === 'text') c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text.replace(/\s*:\s*$/, '') };
        const id = newId('sec');
        bind(para, id);
        count('headings');
        ctx.plainHeadingCount = (ctx.plainHeadingCount || 0) + 1;
        addBlock({ type: 'heading', attrs: { level: ph.level, numbered: false, id, appendix: false }, content: c });
        return;
      }
    }
    // display equation: the paragraph is one equation (and perhaps its number)
    const others = nodes.filter(n => !(n.type === 'math_inline') && !(n.type === 'seq'));
    const mathNodes = nodes.filter(n => n.type === 'math_inline');
    const restText = others.map(n => n.text || '').join('').replace(/[\s​()]/g, '');
    const eqTail = /^([.,;]?)(S?\d+[a-z]?)?([.,;]?)$/.exec(restText);
    const revMark = (n, kind) => (n.marks || []).find(m => m.type === kind);
    const changed = mathNodes.length === 2 && revMark(mathNodes[0], 'del') && revMark(mathNodes[1], 'ins') && eqTail;
    if (changed) {
      const id = newId('eq');
      bind(para, id);
      count('equations');
      const { id: tid, author, initials, time } = revMark(mathNodes[1], 'ins').attrs;
      addBlock({ type: 'equation', attrs: { latex: mathNodes[1].attrs.latex, numbered: para.seq === 'equation' || /\d/.test(restText), id, comments: threadIds(para), track: { kind: 'mod', id: tid, author, initials, time, old: { latex: mathNodes[0].attrs.latex } } } });
      return;
    }
    if (mathNodes.length === 1 && eqTail && (para.display.length || mathNodes[0].mathtype || nodes[0] === mathNodes[0] || styleIdOf === 'Equation')) {
      const d = revMark(mathNodes[0], 'del'), i = revMark(mathNodes[0], 'ins');
      para.eqTrack = d ? { kind: 'del', ...d.attrs } : i ? { kind: 'ins', ...i.attrs } : null;
      const punct = eqTail[1] || eqTail[3];
      if (punct && !mathNodes[0].mathtype) mathNodes[0] = { ...mathNodes[0], attrs: { latex: mathNodes[0].attrs.latex + punct } };
      const id = newId('eq');
      bind(para, id);
      count('equations');
      if (mathNodes[0].mathtype) note('mathtype', 'display');
      addBlock({ type: 'equation', attrs: { latex: mathNodes[0].attrs.latex, numbered: para.seq === 'equation' || /\d/.test(restText), id, comments: threadIds(para), track: para.eqTrack || null } });
      return;
    }
    for (const m of mathNodes) if (m.mathtype) note('mathtype', 'inline');
    // caption
    if (sk.kind === 'caption' || (para.seq && /^(fig|tab|scheme|chart)/.test(para.seq))) {
      const kind = captionKind(para, nodes);
      const cap = captionContent(nodes);
      if (kind === 'table') {
        if (lastTable && !lastTable.content[0].content.length && blocks[blocks.length - 1] === lastTable) { lastTable.content[0].content = cap; bind(para, lastTable.attrs.id); }
        else pendingCaption = { kind, content: cap, para };
        return;
      }
      if (para.images.length) { const f = addBlock(figureNode(para.images[0], cap, { comments: threadIds(para) })); bind(para, f.attrs.id); lastFigure = f; return; }
      if (lastFigure && !lastFigure.content[1].content.length && blocks[blocks.length - 1] === lastFigure) { lastFigure.content[1].content = cap; bind(para, lastFigure.attrs.id); return; }
      pendingCaption = { kind: 'figure', content: cap, para };
      return;
    }
    if (!para.images.length && TYPED_CAPTION.test(txt)) {
      const isTable = /^\s*tab/i.test(txt);
      const last = blocks[blocks.length - 1];
      if (!isTable && lastFigure && last === lastFigure && !lastFigure.content[1].content.length) { lastFigure.content[1].content = captionContent(nodes); bind(para, lastFigure.attrs.id); return; }
      if (isTable && lastTable && last === lastTable && !lastTable.content[0].content.length) { lastTable.content[0].content = captionContent(nodes); bind(para, lastTable.attrs.id); return; }
    }
    // pictures
    if (para.images.length) {
      let hasText = txt.trim().length > 0;
      const ownCaption = hasText && para.images.length === 1 && TYPED_CAPTION.test(txt) && !(pendingCaption && pendingCaption.kind === 'figure') ? captionContent(nodes) : null;
      if (ownCaption) { const f = addBlock(figureNode(para.images[0], ownCaption, { comments: threadIds(para) })); bind(para, f.attrs.id); lastFigure = f; return; }
      for (const img of para.images) {
        if (img.unsupported) { /* an empty figure marks the place */ }
        // a table caption over a picture: the table was pasted as an image; it stays a picture with its caption
        const cap = pendingCaption ? pendingCaption : null;
        if (cap && cap.kind === 'table') { note('tableimage', 'a table pasted as a picture'); cap.content = [{ type: 'text', text: 'Table: ' }, ...cap.content]; }
        const f = addBlock(figureNode(img, cap ? cap.content : [], { comments: threadIds(para) }));
        if (cap) { bind(cap.para, f.attrs.id); pendingCaption = null; }
        bind(para, f.attrs.id);
        lastFigure = f;
      }
      if (!hasText) return;
    }
    if (!content.length && !ctx.wantEmpty) return;      // empty paragraph (spacing) — kept when a tracked boundary leads to it
    if (pendingCaption) { blocks.push({ type: 'paragraph', content: pendingCaption.content.length ? pendingCaption.content : [{ type: 'text', text: ' ' }] }); note('lonecaption', 'a caption without a picture or table'); pendingCaption = null; }
    // list item
    if (numId && numId !== '0') {
      const info = listInfo(numId, ilvl);
      while (listStack.length && listStack[listStack.length - 1].ilvl > ilvl) listStack.pop();
      let top = listStack[listStack.length - 1];
      if (!top || top.ilvl < ilvl || top.numId !== numId) {
        const node = info.ordered ? { type: 'ordered_list', attrs: { order: info.start }, content: [] } : { type: 'bullet_list', content: [] };
        if (top && top.ilvl < ilvl && top.node.content.length) top.node.content[top.node.content.length - 1].content.push(node);
        else { listStack.length = 0; blocks.push(node); }
        top = { node, ilvl, numId };
        listStack.push(top);
      }
      const itemPara = { type: 'paragraph', content };
      ctx.madeText = itemPara;
      top.node.content.push({ type: 'list_item', content: [itemPara] });
      count('listItems');
      return;
    }
    count('paragraphs');
    addBlock({ type: 'paragraph', content });
  }

  const body = find(docXml, 'w:body');
  const walkBody = async (el) => {
    for (const c of el.children) {
      if (c.name === 'w:p') await paragraph(c);
      else if (c.name === 'w:sdt') { const sc = kid(c, 'w:sdtContent'); if (sc) await walkBody(sc); }
      else if (c.name === 'w:tbl') {
        if (ctx.fields.length || ctx.inBlockField) continue;
        const eq = equationTable(c);
        if (eq) {
          const para = newPara();
          for (const b of findAll(c, 'w:bookmarkStart')) para.bookmarks.push(b.attrs['w:name']);
          for (const s of findAll(c, 'w:commentRangeStart')) para.comments.add(s.attrs['w:id']);
          for (const s of findAll(c, 'w:commentRangeStart')) ctx.comments.add(s.attrs['w:id']);
          for (const s of findAll(c, 'w:commentRangeEnd')) ctx.comments.delete(s.attrs['w:id']);
          const id = newId('eq');
          bind(para, id);
          count('equations');
          let track = null, latex = eq.latex;
          if (eq.rev && eq.old !== eq.latex) {
            ctx.tracked++;
            ctx.revBreak = true;
            const a = revAttrs(eq.rev);
            ctx.revBreak = true;
            track = !eq.old ? { kind: 'ins', ...a } : !eq.latex ? { kind: 'del', ...a } : { kind: 'mod', ...a, old: { latex: eq.old } };
            if (!eq.latex) latex = eq.old;
          }
          addBlock({ type: 'equation', attrs: { latex, numbered: eq.numbered, id, comments: threadIds(para), track } });
          continue;
        }
        const table = await tableNode(c);
        if (!table) continue;
        count('tables');
        const cap = pendingCaption && pendingCaption.kind === 'table' ? pendingCaption : null;
        flushPendingMark();
        const tableRev = table.rev; delete table.rev;
        const tf = addBlock({ type: 'table_figure', attrs: { placement: 'here', pos: 'top', id: newId('tab'), track: tableRev ? { kind: tableRev.kind, ...revAttrs(tableRev.r) } : null }, content: [{ type: 'caption', content: cap ? cap.content : [] }, table] });
        if (cap) { bind(cap.para, tf.attrs.id); pendingCaption = null; }
        lastTable = tf;
      }
    }
  };
  await walkBody(body);
  flushPendingMark();
  if (pendingCaption) blocks.push({ type: 'paragraph', content: pendingCaption.content.length ? pendingCaption.content : [{ type: 'text', text: ' ' }] });

  /* ---------- cross-references: Word bookmarks -> our ids ---------- */
  let unresolved = 0;
  const fix = (node) => {
    if (!node.content) return node;
    const out = [];
    let dropParen = false;
    for (let i = 0; i < node.content.length; i++) {
      let c = node.content[i];
      if (dropParen) { dropParen = false; if (c.type === 'text') { if (c.text.length === 1) continue; c = { ...c, text: c.text.slice(1) }; } }
      if (c.type === 'xref' && String(c.attrs.target).startsWith('bm:')) {
        const id = ctx.bookmarks.get(c.attrs.target.slice(3));
        if (id) {
          /* A reference here writes its own label ("Fig. 3", "Eq. (2)"). Where the Word text has exactly that label
             typed around a number-only field, the typed part goes, so the label is not there twice. Other wordings
             ("Figures 1 and 2", "Equation") stay as typed: the reference then shows the number alone. */
          const prev = out[out.length - 1], next = node.content[i + 1];
          const cut = (n) => { if (prev.text.length > n) out[out.length - 1] = { ...prev, text: prev.text.slice(0, -n) }; else out.pop(); };
          if (prev && prev.type === 'text' && !/[()]/.test(c.fallback || '')) {
            if (/^eq-/.test(id) && prev.text.endsWith('(') && next && next.type === 'text' && next.text.startsWith(')')) {
              const m = /Eq\.[  ]\($/.exec(prev.text);
              cut(m ? m[0].length : 1);
              dropParen = true;
            } else {
              const m = /(?:^|[\s(])((?:Fig\.|Figure|Table|Section|Appendix)[  ])$/.exec(prev.text);
              if (m && !/^eq-/.test(id)) cut(m[1].length);
            }
          }
          out.push({ type: 'xref', attrs: { target: id }, ...(c.marks ? { marks: c.marks } : {}) });
        }
        else { unresolved++; if (c.fallback) out.push({ type: 'text', text: c.fallback, ...(c.marks ? { marks: c.marks } : {}) }); }
      } else { const { fallback, display, mathtype, rev, ...rest } = c; out.push(fix(rest)); }
    }
    return { ...node, content: out };
  };
  let content = blocks.map(fix);
  if (unresolved) report.notes.push(unresolved + ' cross-reference' + (unresolved > 1 ? 's' : '') + ' pointed to something that could not be identified (kept as text).');
  report.counts.xrefs = Math.max(0, (report.counts.xrefs || 0) - unresolved);

  /* ---------- title block ---------- */
  /* "A. Author¹, B. Author¹,²,*" with the affiliations below, each starting with its superscript mark: names, who
     belongs where, and the corresponding author's e-mail are read back from the marks. */
  const authors = { list: [], affils: [] };
  let ownAuthors = null;
  try {
    const raw = findAll(customXml, 'property').filter(p => /^DTUSW_AUTHORS_/.test(p.attrs.name || '')).sort((a, b) => a.attrs.name.localeCompare(b.attrs.name, undefined, { numeric: true })).map(textOf).join('');
    if (raw) { const v = JSON.parse(raw); if (v && Array.isArray(v.list) && Array.isArray(v.affils)) ownAuthors = v; }
  } catch (_) { ownAuthors = null; }
  if (ctx.guessedTitle) report.notes.push('The first line was read as the title (the document has no Title style).');
  if (ctx.plainHeadingCount) report.notes.push(ctx.plainHeadingCount + ' line' + (ctx.plainHeadingCount > 1 ? 's' : '') + ' in capitals, bold or with a usual section name (“Methods”) became heading' + (ctx.plainHeadingCount > 1 ? 's' : '') + ' (the document has no heading styles): check them in the outline.');
  if (guessedAuthors) report.notes.push('The line under the title (“' + guessedAuthors.slice(0, 80) + '”) was read as the author list: check it in Format → Authors and affiliations.');
  if (authorsRaw.length) {
    const isSup = (n) => (n.marks || []).some(m => m.type === 'sup');
    const line = authorsRaw.map(nodes => nodes.filter(n => n.type === 'text').map(n => (isSup(n) ? '⟦' + n.text + '⟧' : n.text)).join('')).join(', ');
    const people = line.split(/\s*(?:,|;|\band\b)\s*(?![^⟦]*⟧)/).map(x => x.trim()).filter(Boolean).map((x) => {
      const marks = [...x.matchAll(/⟦([^⟧]*)⟧/g)].flatMap(m => m[1].match(/\d+|[a-z]+|[*†‡§#¶]/gi) || []);
      // a mark typed in the line itself ("Author*", "Other†") counts like a superscript one
      let name = x.replace(/⟦[^⟧]*⟧/g, '').trim();
      const typed = /[*†‡§#¶]+$/.exec(name);
      if (typed) { marks.push(...typed[0]); name = name.slice(0, -typed[0].length).trim(); }
      return { name, marks };
    }).filter(x => x.name);
    const byMark = new Map();
    const emails = [];
    for (const nodes of affilRaw) {
      const first = nodes.find(n => n.type === 'text');
      const mark = first && isSup(first) ? first.text.trim() : null;
      const body = nodes.filter(n => n.type === 'text' && n !== (mark ? first : null)).map(n => n.text).join('').trim();
      if (/corresponding author|e-?mail|to whom correspondence/i.test(body) || (mark === '*' && /@/.test(body)) || /^\s*[*†‡]/.test(body)) {
        for (const m of body.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) if (!emails.includes(m[0])) emails.push(m[0]);
        continue;
      }
      if (!body) continue;
      const af = { id: 'af-w' + (authors.affils.length + 1), dept: '', inst: body, street: '', postcode: '', city: '', country: '' };
      authors.affils.push(af);
      if (mark) byMark.set(mark, af.id);
    }
    authors.list = people.map((x) => {
      const corresponding = x.marks.includes('*');
      const affils = x.marks.map(m => byMark.get(m)).filter(Boolean);
      return { name: x.name, affils: affils.length ? affils : (authors.affils.length === 1 ? [authors.affils[0].id] : []), corresponding, email: '' };
    });
    // only one marked, or none marked but one address: that is the corresponding author
    if (emails.length === 1 && !authors.list.some(a => a.corresponding) && authors.list.length) authors.list[authors.list.length - 1].corresponding = true;
    const ascii = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a').toLowerCase().replace(/[^a-z\s-]/g, '');
    const fits = (a, e) => {
      const local = e.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
      const parts = ascii(a.name).split(/[\s-]+/).filter(Boolean);
      const fam = parts[parts.length - 1] || '';
      if (fam.length >= 3 && local.includes(fam)) return 3;
      if (parts.length && fam && local.startsWith(parts[0][0] + fam.slice(0, 3))) return 2;
      if (parts.length && local.startsWith(parts[0]) && parts[0].length >= 3) return 2;
      return 0;
    };
    const left = emails.slice();
    const corr = authors.list.filter(a => a.corresponding);
    for (const a of corr) { let best = null, score = 0; for (const e of left) { const f = fits(a, e); if (f > score) { score = f; best = e; } } if (best) { a.email = best; left.splice(left.indexOf(best), 1); } }
    for (const a of corr) if (!a.email && left.length) a.email = left.shift();
    // the same people in the same order as the stored block: a co-author did not touch the author line in Word
    const sameNames = ownAuthors && ownAuthors.list.length === authors.list.length && ownAuthors.list.every((a, i) => String(a.name || '').trim() === authors.list[i].name);
    if (sameNames && ownAuthors.affils.length === authors.affils.length) { authors.list = ownAuthors.list; authors.affils = ownAuthors.affils; ownAuthors.used = true; }
    if (!(ownAuthors && ownAuthors.used) && authors.affils.length > 1 && authors.list.some(x => !x.affils.length)) report.notes.push('Check which author belongs to which affiliation (Format → Authors and affiliations): the document did not say for all of them.');
    if (authors.affils.length && !(ownAuthors && ownAuthors.used)) report.notes.push('Affiliations were read as one line each: split them into department, institution, city and country in Format → Authors and affiliations if you want other address formats.');
  }

  /* ---------- document style ---------- */
  const style = {};
  const dd = find(stylesXml, 'w:rPrDefault');
  const fontEl = dd ? find(dd, 'w:rFonts') : null;
  const fontName = (fontEl && (fontEl.attrs['w:ascii'] || fontEl.attrs['w:hAnsi'])) || '';
  style.font = /arial|helvetica|calibri|verdana|segoe|aptos/i.test(fontName) ? 'arial' : 'times';
  const szEl = dd ? find(dd, 'w:sz') : null;
  if (szEl) { const pt = +szEl.attrs['w:val'] / 2; style.size = SIZES.reduce((a, b) => (Math.abs(b - pt) < Math.abs(a - pt) ? b : a), 11); }
  const langEl = dd ? find(dd, 'w:lang') : null;
  if (langEl && LANGS.some(l => l[0] === langEl.attrs['w:val'])) style.lang = langEl.attrs['w:val'];
  // the citation style Zotero recorded in the document
  const pref = findAll(customXml, 'property').filter(p => /^ZOTERO_PREF_/.test(p.attrs.name || '')).sort((a, b) => a.attrs.name.localeCompare(b.attrs.name, undefined, { numeric: true })).map(textOf).join('');
  const sid = (/<style id="([^"]+)"/.exec(pref) || [])[1];
  if (sid) { const hit = STYLES.find(s => styleId(s[0]) === sid); if (hit) style.cite = hit[0]; }

  /* ---------- comments that found their text ---------- */
  const usedThreads = {};
  for (const id of ctx.usedThreads) if (threads[id]) usedThreads[id] = threads[id];
  const lost = Object.keys(threads).length - Object.keys(usedThreads).length;
  if (lost > 0) report.notes.push(lost + ' comment' + (lost > 1 ? 's' : '') + ' had no text to attach to and ' + (lost > 1 ? 'were' : 'was') + ' left out.');
  report.counts.comments = Object.keys(usedThreads).length;

  /* ---------- report ---------- */
  const n = (k) => (noteCounts[k] || []).length;
  if (ctx.tracked && !keepRevisions) report.notes.push(ctx.tracked + ' tracked change' + (ctx.tracked > 1 ? 's were' : ' was') + ' accepted (insertions kept, deletions dropped).');
  if (ctx.tracked && keepRevisions) {
    const unmark = (n, t) => {
      let out = n;
      if (n.marks) { const left = n.marks.filter(m => !(m.type === 'del' && m.attrs.author === t.author && m.attrs.time === t.time)); out = left.length ? { ...n, marks: left } : (({ marks, ...r }) => r)(n); }
      return out.content ? { ...out, content: out.content.map(c => unmark(c, t)) } : out;
    };
    const clean = (n) => {
      if ((n.type === 'figure' || n.type === 'table_figure') && n.attrs && n.attrs.track && n.attrs.track.kind === 'del') return { ...n, content: n.content.map(c => unmark(c, n.attrs.track)) };
      return n.content ? { ...n, content: n.content.map(clean) } : n;
    };
    content = content.map(clean);
    const ids = new Set();
    const scan = (n) => { if (n.attrs && n.attrs.track) ids.add(n.attrs.track.id); for (const m of n.marks || []) if (m.type === 'ins' || m.type === 'del') ids.add(m.attrs.id); (n.content || []).forEach(scan); };
    content.forEach(scan);
    report.counts.changes = ids.size;
    if (ids.size) report.notes.push(ids.size + ' tracked change' + (ids.size > 1 ? 's' : '') + ' from Word ' + (ids.size > 1 ? 'were' : 'was') + ' imported as suggestion' + (ids.size > 1 ? 's' : '') + ': accept or reject ' + (ids.size > 1 ? 'them' : 'it') + ' beside the page, or with Review → Accept all / Reject all.');
  }
  if (ctx.mathtype) report.notes.push(ctx.mathtype + ' MathType equation' + (ctx.mathtype > 1 ? 's' : '') + ' could not be converted: each is marked “[MathType equation n — retype]”. (In Word, MathType → Convert Equations → “Word equation” before importing converts them.)');
  if (n('image')) report.notes.push(n('image') + ' picture' + (n('image') > 1 ? 's are' : ' is') + ' in a format the app cannot show (' + [...new Set(noteCounts.image.map(s => s.split('.').pop().toUpperCase()))].join(', ') + '): an empty figure marks each place — save them as PNG and drop them in.');
  if (n('textbox')) report.notes.push(n('textbox') + ' text box' + (n('textbox') > 1 ? 'es were' : ' was') + ' turned into ordinary paragraphs.');
  if (n('object')) report.notes.push(n('object') + ' embedded object' + (n('object') > 1 ? 's' : '') + ' (' + [...new Set(noteCounts.object)].join(', ') + ') could not be imported.');
  if (n('cellimage')) report.notes.push(n('cellimage') + ' picture' + (n('cellimage') > 1 ? 's' : '') + ' inside table cells were left out.');
  if (n('tableimage')) report.notes.push(n('tableimage') + ' table' + (n('tableimage') > 1 ? 's were' : ' was') + ' a picture in Word: imported as a figure with the table caption (“Table: …”). Retype it as a table (Table button) to get a numbered table.');
  if (n('lonecaption')) report.notes.push(n('lonecaption') + ' caption' + (n('lonecaption') > 1 ? 's' : '') + ' had no picture or table next to ' + (n('lonecaption') > 1 ? 'them' : 'it') + ' and stayed as text where ' + (n('lonecaption') > 1 ? 'they were' : 'it was') + '.');
  if (n('nested')) report.notes.push(n('nested') + ' table' + (n('nested') > 1 ? 's' : '') + ' inside a table cell became plain text.');
  if (n('endnote')) report.notes.push('EndNote citations were kept as the text Word showed. Format → Convert typed references turns them into real citations.');
  if (n('citetyped')) report.notes.push(n('citetyped') + ' citation' + (n('citetyped') > 1 ? 's' : '') + ' had text typed into ' + (n('citetyped') > 1 ? 'them' : 'it') + ' in Word (“' + noteCounts.citetyped.slice(0, 3).join('”, “') + '”): the text was kept beside the citation — check it, and use Insert → Citation for a reference that was added by typing.');
  if (n('citechanged')) report.notes.push(n('citechanged') + ' citation' + (n('citechanged') > 1 ? 's were' : ' was') + ' changed by hand in Word (' + noteCounts.citechanged.slice(0, 3).map(x => { const [a, b] = x.split('|'); return '“' + a + '” where the citation reads “' + b + '”'; }).join('; ') + '): the citation was kept as it was in the reference data — check ' + (n('citechanged') > 1 ? 'them' : 'it') + '.');
  if (n('citation')) report.notes.push(n('citation') + ' citation field' + (n('citation') > 1 ? 's' : '') + ' could not be read and stayed as text.');
  report.counts.references = Object.keys(library).length;

  if (!content.length) content = [{ type: 'paragraph' }];
  if (content[content.length - 1].type !== 'paragraph') content.push({ type: 'paragraph' });
  const json = {
    // Track Changes was on in Word (settings.xml), or the file carries revisions: tracking stays on here
    type: 'doc', attrs: { style, comments: usedThreads, references: library, tracking: keepRevisions && (/<w:trackRevisions(?![^>]*w:val="(?:0|false|off)")/.test(settingsXml || '') || (report.counts.changes || 0) > 0) },
    content: [
      { type: 'title', ...(title && title.length ? { content: title.map(({ marks, ...t }) => t) } : {}) },
      { type: 'authors', attrs: authors },
      ...(abstract.length ? [{ type: 'abstract', content: abstract.map(fix) }] : []),
      ...content,
    ],
  };
  return { json, media, report };
}
