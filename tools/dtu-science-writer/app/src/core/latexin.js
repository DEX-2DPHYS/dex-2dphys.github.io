/* LaTeX source -> document content (step 5): what a paste from Overleaf, a .tex file or an e-mail becomes.
   A practical subset, robust rather than complete: sections, paragraphs, inline and display math (equation, align,
   \[ \], $$ $$), lists, footnotes, \emph/\textbf/…, accents and typography, figure and table environments (caption,
   label, tabular; the image itself must be added), \cite (keys found in the library) and \ref/\eqref (labels in the
   pasted text or the document) as live citations and cross-references. Unknown commands keep their text.
   Returns { blocks: [JSON nodes], report: { citations, unknownKeys: [...], refs, unknownRefs: [...] } }. */

const ACCENT = { '\'': '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋', r: '̊' };
const SYMBOL = { o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', ss: 'ß', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł', i: 'ı', ldots: '…', dots: '…', textendash: '–', textemdash: '—', textdegree: '°', LaTeX: 'LaTeX', TeX: 'TeX', today: '', textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textbar: '|', textless: '<', textgreater: '>', copyright: '©', textregistered: '®', S: '§', P: '¶', dag: '†', ddag: '‡', textbullet: '•', textmu: 'µ' };
const MARK = { textbf: 'bold', bf: 'bold', textit: 'italic', emph: 'italic', it: 'italic', textsl: 'italic', underline: 'underline', textsuperscript: 'sup', textsubscript: 'sub' };
const SECTION = { section: 1, subsection: 2, subsubsection: 3, paragraph: 4, chapter: 1 };
const IGNORE_BLOCK = /^\\(documentclass|usepackage|maketitle|tableofcontents|listoffigures|listoftables|bibliographystyle|bibliography|newpage|clearpage|pagebreak|noindent|centering|vspace|hspace|smallskip|medskip|bigskip|title|author|affil|date|appendix|label)\b/;
const MATH_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath'];

/** Remove comments (an unescaped %) and normalise line ends. */
function stripComments(s) {
  return s.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    for (let i = 0; i < line.length; i++) { if (line[i] === '\\') { i++; continue; } if (line[i] === '%') return line.slice(0, i); }
    return line;
  }).join('\n');
}

/** The group starting at s[i] === '{' -> { body, end } (end: index after the closing brace). */
function group(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return { body: s.slice(i + 1, j), end: j + 1 }; }
  }
  return { body: s.slice(i + 1), end: s.length };
}
/** Optional [ ... ] at s[i] -> { body, end } or null. */
function optArg(s, i) {
  if (s[i] !== '[') return null;
  let d = 0;
  for (let j = i; j < s.length; j++) { if (s[j] === '[') d++; else if (s[j] === ']') { d--; if (!d) return { body: s.slice(i + 1, j), end: j + 1 }; } }
  return null;
}
const skipWs = (s, i) => { while (i < s.length && /[ \t]/.test(s[i])) i++; return i; };

const safeLabel = (l) => String(l).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || null;

/**
 * Convert LaTeX source to document blocks.
 * opts.library: the document's references (key -> item); opts.existingIds: ids already in the document.
 */
export function latexToBlocks(source, opts = {}) {
  const lib = opts.library || {};
  const taken = new Set(opts.existingIds || []);
  const report = { citations: 0, unknownKeys: new Set(), refs: 0, unknownRefs: new Set() };
  let s = stripComments(String(source || ''));
  const docBody = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(s);
  if (docBody) s = docBody[1];
  s = s.replace(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g, '');

  /* labels: the pasted text's own labels become our ids (so \ref works at once); a label that names an item already
     in the document (an exported paper pasted back) refers to that item */
  const labelId = new Map();
  for (const m of s.matchAll(/\\label\{([^}]*)\}/g)) {
    const l = m[1];
    if (labelId.has(l)) continue;
    if (taken.has(l)) { labelId.set(l, { id: l, existing: true }); continue; }
    let id = safeLabel(l) || 'lbl', k = 2;
    while (taken.has(id)) id = safeLabel(l) + '-' + (k++);
    taken.add(id);
    labelId.set(l, { id, existing: false });
  }
  const takeLabel = (text) => {          // text -> { text without \label{…}, id }
    let id = null;
    const t = text.replace(/\\label\{([^}]*)\}/g, (_, l) => { if (!id && labelId.has(l)) id = labelId.get(l).id; return ''; });
    return { text: t, id };
  };

  /* ---------- inline ---------- */
  const T = (text, marks) => (text ? (marks && marks.length ? { type: 'text', text, marks: marks.map(m => ({ type: m })) } : { type: 'text', text }) : null);
  function inline(src, marks = []) {
    const out = [];
    let buf = '';
    // collapse ordinary white space only: the no-break space (~) and thin space (\,) must survive
    const flush = () => { if (buf) { out.push(T(buf.replace(/[ \t\r\n]+/g, ' '), marks)); buf = ''; } };
    for (let i = 0; i < src.length;) {
      const ch = src[i];
      if (ch === '$' || (ch === '\\' && src[i + 1] === '(')) {                         // inline math
        const close = ch === '$' ? '$' : '\\)';
        const start = i + (ch === '$' ? 1 : 2);
        let j = start;
        while (j < src.length && !(src.startsWith(close, j) && src[j - 1] !== '\\')) j++;
        flush();
        const tex = src.slice(start, j).trim();
        if (tex) out.push({ type: 'math_inline', attrs: { latex: tex }, ...(marks.length ? { marks: marks.map(m => ({ type: m })) } : {}) });
        i = j + close.length;
        continue;
      }
      if (ch === '{' ) { const g = group(src, i); buf += ''; flush(); out.push(...inline(g.body, marks)); i = g.end; continue; }
      if (ch === '}') { i++; continue; }
      if (ch === '~') { buf += ' '; i++; continue; }
      if (ch === '`' && src[i + 1] === '`') { buf += '“'; i += 2; continue; }
      if (ch === '\'' && src[i + 1] === '\'') { buf += '”'; i += 2; continue; }
      if (ch === '`') { buf += '‘'; i++; continue; }
      if (ch === '-' && src.startsWith('---', i)) { buf += '—'; i += 3; continue; }
      if (ch === '-' && src[i + 1] === '-') { buf += '–'; i += 2; continue; }
      if (ch !== '\\') { buf += ch; i++; continue; }
      // a command
      const m = /^\\([A-Za-z]+\*?|.)/.exec(src.slice(i));
      const name = m[1];
      let j = i + m[0].length;
      if (name === '\\') { flush(); out.push({ type: 'hard_break' }); i = j; continue; }
      if (/^[%&$#_{}]$/.test(name)) { buf += name; i = j; continue; }
      if (name === ',' || name === ';' || name === ':' || name === ' ' || name === '@') { buf += name === ',' ? ' ' : name === ' ' ? ' ' : ''; i = j; continue; }
      if (name === '/' || name === '-') { i = j; continue; }
      if (ACCENT[name] && !/^[A-Za-z]{2,}$/.test(name)) {                          // \'e, \"{o}, \c{c}
        j = skipWs(src, j);
        let letter;
        if (src[j] === '{') { const g = group(src, j); letter = g.body.replace(/^\\/, ''); j = g.end; } else { letter = src[j]; j++; }
        buf += (letter === 'i' || letter === 'ı' ? 'i' : letter) + ACCENT[name];
        buf = buf.normalize('NFC');
        i = j; continue;
      }
      if (SYMBOL[name] !== undefined) {
        buf += SYMBOL[name];
        if (src[j] === '{' && src[j + 1] === '}') j += 2;
        else if (/^[A-Za-z]+$/.test(name)) j = skipWs(src, j);       // a space after a command word belongs to it: Bj\o rn = Bjørn
        i = j; continue;
      }
      const args = () => { j = skipWs(src, j); const o = optArg(src, j); if (o) j = skipWs(src, o.end); if (src[j] !== '{') return { opt: o && o.body, arg: '' }; const g = group(src, j); j = g.end; return { opt: o && o.body, arg: g.body }; };
      if (MARK[name]) { const { arg } = args(); flush(); out.push(...inline(arg, [...new Set([...marks, MARK[name]])])); i = j; continue; }
      if (/^(cite|citep|citet|citealp|citeauthor|citeyear|autocite|parencite|textcite|supercite|nocite)\*?$/.test(name)) {
        const { opt, arg } = args();
        const keys = arg.split(',').map(k => k.trim()).filter(Boolean);
        const known = keys.filter(k => lib[k]);
        keys.filter(k => !lib[k]).forEach(k => report.unknownKeys.add(k));
        flush();
        if (name === 'nocite') { i = j; continue; }
        if (known.length) {
          const loc = opt && known.length === 1 ? String(opt).replace(/^(p|pp)\.\s*~?/i, '').trim() : '';
          out.push({ type: 'citation', attrs: { items: known.map(k => (loc ? { id: k, locator: loc } : { id: k })), mode: name === 'citeyear' ? 'suppress-author' : 'normal' } });
          report.citations++;
        }
        if (known.length < keys.length) out.push(T('[' + keys.filter(k => !lib[k]).join(', ') + ']', marks));
        i = j; continue;
      }
      if (/^(ref|eqref|autoref|cref|Cref|pageref|vref)$/.test(name)) {
        const { arg } = args();
        const l = arg.split(',')[0].trim();
        const hit = labelId.get(l) || (taken.has(l) ? { id: l } : null);
        flush();
        if (hit) { out.push({ type: 'xref', attrs: { target: hit.id } }); report.refs++; } else { report.unknownRefs.add(l); out.push(T('??', marks)); }
        i = j; continue;
      }
      if (name === 'footnote') { const { arg } = args(); flush(); out.push({ type: 'footnote', content: inline(arg, []).filter(n => n && n.type !== 'footnote') }); i = j; continue; }
      if (name === 'label') { args(); i = j; continue; }
      if (/^(url|href)$/.test(name)) { const a1 = args(); if (name === 'href') { const a2 = args(); flush(); out.push(...inline(a2.arg, marks)); } else buf += a1.arg; i = j; continue; }
      if (/^(text|textrm|textnormal|mbox|textsf|texttt|textsc|textup|textmd|small|footnotesize|large|Large|normalsize)$/.test(name)) { const { arg } = args(); if (arg) { flush(); out.push(...inline(arg, marks)); } i = j; continue; }
      // unknown command: keep the text of its argument
      const { arg } = args();
      if (arg) { flush(); out.push(...inline(arg, marks)); }
      i = j;
    }
    flush();
    // merge neighbouring text with the same marks
    const merged = [];
    for (const n of out.filter(Boolean)) {
      const p = merged[merged.length - 1];
      if (p && p.type === 'text' && n.type === 'text' && JSON.stringify(p.marks || []) === JSON.stringify(n.marks || [])) p.text += n.text;
      else merged.push({ ...n });
    }
    // trim the ends of a block
    if (merged.length && merged[0].type === 'text') merged[0].text = merged[0].text.replace(/^\s+/, '');
    const last = merged[merged.length - 1];
    if (last && last.type === 'text') last.text = last.text.replace(/\s+$/, '');
    return merged.filter(n => n.type !== 'text' || n.text);
  }
  const para = (src) => { const c = inline(src); return c.length ? { type: 'paragraph', content: c } : null; };

  /* ---------- blocks ---------- */
  const blocks = [];
  let text = '';
  const flushPara = () => {
    for (const chunk of text.split(/\n\s*\n/)) { const p = para(chunk.trim()); if (p) blocks.push(p); }
    text = '';
  };
  const envEnd = (name, from) => {
    // the matching \end{name}, allowing nested environments of the same name
    let d = 1, re = new RegExp('\\\\(begin|end)\\{' + name.replace('*', '\\*') + '\\}', 'g');
    re.lastIndex = from;
    let m;
    while ((m = re.exec(s))) { if (m[1] === 'begin') d++; else if (!--d) return { inner: s.slice(from, m.index), end: m.index + m[0].length }; }
    return { inner: s.slice(from), end: s.length };
  };
  const equationBlock = (tex, numbered) => {
    const { text: t, id } = takeLabel(tex);
    const latex = t.replace(/\\nonumber|\\notag/g, '').trim();
    return latex ? { type: 'equation', attrs: { latex, numbered: numbered, ...(id ? { id } : {}) } } : null;
  };

  for (let i = 0; i < s.length;) {
    if (s.startsWith('\\[', i) || s.startsWith('$$', i)) {
      const close = s.startsWith('\\[', i) ? '\\]' : '$$';
      const j = s.indexOf(close, i + 2);
      const end = j < 0 ? s.length : j;
      // an equation inside a sentence: the text before it is one paragraph, the text after it another
      flushPara();
      const eq = equationBlock(s.slice(i + 2, end), false);
      if (eq) blocks.push(eq);
      i = end + close.length;
      continue;
    }
    const sec = /^\\(section|subsection|subsubsection|paragraph|chapter)(\*?)\s*/.exec(s.slice(i));
    if (sec) {
      flushPara();
      let j = i + sec[0].length;
      const o = optArg(s, j); if (o) j = o.end;
      j = skipWs(s, j);
      const g = s[j] === '{' ? group(s, j) : { body: '', end: j };
      j = g.end;
      let id = null;
      const lab = /^\s*\\label\{([^}]*)\}/.exec(s.slice(j));
      if (lab) { id = (labelId.get(lab[1]) || {}).id || null; j += lab[0].length; }
      const content = inline(g.body);
      blocks.push({ type: 'heading', attrs: { level: SECTION[sec[1]], numbered: !sec[2], ...(id ? { id } : {}) }, content });
      i = j;
      continue;
    }
    const env = /^\\begin\{([A-Za-z*]+)\}/.exec(s.slice(i));
    if (env) {
      const name = env[1];
      const { inner, end } = envEnd(name, i + env[0].length);
      if (MATH_ENVS.includes(name)) {
        flushPara();
        const star = name.endsWith('*') || name === 'displaymath';
        let tex = inner;
        if (/^(align|gather|multline|eqnarray)/.test(name)) tex = '\\begin{aligned}' + inner.replace(/\\label\{[^}]*\}/g, (m) => m) + '\\end{aligned}';
        const eq = equationBlock(tex, !star);
        if (eq) blocks.push(eq);
      } else if (name === 'itemize' || name === 'enumerate') {
        flushPara();
        blocks.push(listBlock(name, inner));
      } else if (name === 'figure' || name === 'figure*' || name === 'wrapfigure') {
        flushPara();
        const fig = figureBlock(inner);
        if (fig) blocks.push(fig);
      } else if (name === 'table' || name === 'table*') {
        flushPara();
        const tab = tableBlock(inner);
        if (tab) blocks.push(tab);
      } else if (name === 'abstract' || name === 'center' || name === 'quote' || name === 'quotation' || name === 'flushleft' || name === 'flushright' || name === 'minipage') {
        flushPara();
        text = inner; flushPara();
      } else {
        text += inner;                // unknown environment: its text
      }
      i = end;
      continue;
    }
    const ign = IGNORE_BLOCK.exec(s.slice(i));
    if (ign) {
      let j = i + ign[0].length;
      j = skipWs(s, j); const o = optArg(s, j); if (o) j = o.end; j = skipWs(s, j);
      if (s[j] === '{' && !/^\\(noindent|centering|maketitle|appendix|newpage|clearpage|tableofcontents|listoffigures|listoftables)/.test(ign[0])) j = group(s, j).end;
      if (/^\\(newpage|clearpage|pagebreak)/.test(ign[0])) { flushPara(); blocks.push({ type: 'page_break' }); }
      i = j;
      continue;
    }
    text += s[i];
    i++;
  }
  flushPara();

  function listBlock(name, inner) {
    const items = [];
    const parts = inner.split(/\\item\b(?:\s*\[[^\]]*\])?/).slice(1);
    for (const p of parts) {
      const nested = [];
      let rest = p.replace(/\\begin\{(itemize|enumerate)\}([\s\S]*?)\\end\{\1\}/g, (_, n2, in2) => { nested.push(listBlock(n2, in2)); return ''; });
      const c = para(rest.trim());
      items.push({ type: 'list_item', content: [c || { type: 'paragraph' }, ...nested] });
    }
    return name === 'enumerate' ? { type: 'ordered_list', attrs: { order: 1 }, content: items.length ? items : [{ type: 'list_item', content: [{ type: 'paragraph' }] }] }
      : { type: 'bullet_list', content: items.length ? items : [{ type: 'list_item', content: [{ type: 'paragraph' }] }] };
  }
  function captionOf(inner) {
    const m = /\\caption\s*(\[[^\]]*\])?\s*\{/.exec(inner);
    if (!m) return { content: [], rest: inner };
    const g = group(inner, m.index + m[0].length - 1);
    return { content: inline(takeLabel(g.body).text), rest: inner.slice(0, m.index) + inner.slice(g.end) };
  }
  function figureBlock(inner) {
    const { id } = takeLabel(inner);
    const cap = captionOf(inner);
    const w = /\\includegraphics\s*\[[^\]]*width\s*=\s*([0-9.]+)\s*\\(linewidth|textwidth|columnwidth)/.exec(inner);
    const file = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(inner);
    // the image file is not in the paste: an empty image placeholder, with the file name in the caption's report
    return { type: 'figure', attrs: { placement: 'float', pos: 'top', width: w ? Math.min(1, Math.max(0.15, +w[1])) : 0.8, ...(id ? { id } : {}) },
      content: [{ type: 'image', attrs: { src: '' } }, { type: 'caption', content: cap.content }], missingFile: file ? file[1] : null };
  }
  function tableBlock(inner) {
    const { id } = takeLabel(inner);
    const cap = captionOf(inner);
    const tab = /\\begin\{tabular\*?\}(\{[^}]*\})?(\{[^}]*\})?([\s\S]*?)\\end\{tabular\*?\}/.exec(cap.rest);
    if (!tab) return cap.content.length ? { type: 'paragraph', content: cap.content } : null;
    const body = tab[3].replace(/\\(toprule|midrule|bottomrule|hline|cline\{[^}]*\}|cmidrule(\([^)]*\))?\{[^}]*\})/g, '');
    const rowsSrc = body.split(/\\\\(?:\s*\[[^\]]*\])?/).map(r => r.trim()).filter(r => r.replace(/\s/g, ''));
    const rows = rowsSrc.map((r, ri) => {
      const cells = [];
      let depth = 0, cur = '';
      for (let k = 0; k < r.length; k++) {
        const c = r[k];
        if (c === '\\') { cur += c + (r[k + 1] || ''); k++; continue; }
        if (c === '{') depth++; else if (c === '}') depth--;
        if (c === '&' && !depth) { cells.push(cur); cur = ''; } else cur += c;
      }
      cells.push(cur);
      return { type: 'table_row', content: cells.map((cell) => {
        let colspan = 1, t = cell.trim();
        const mc = /^\\multicolumn\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/.exec(t);
        if (mc) { colspan = +mc[1]; t = mc[2]; }
        t = t.replace(/^\\multirow\{\d+\}\{[^}]*\}\{([\s\S]*)\}$/, '$1');
        const c = inline(t);
        return { type: ri === 0 ? 'table_header' : 'table_cell', attrs: { colspan, rowspan: 1, colwidth: null, align: null }, content: [c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' }] };
      }) };
    });
    // equal width rows (pad short rows) so the table is valid
    const width = Math.max(...rows.map(r => r.content.reduce((a, c) => a + c.attrs.colspan, 0)));
    for (const r of rows) { let w = r.content.reduce((a, c) => a + c.attrs.colspan, 0); while (w++ < width) r.content.push({ type: 'table_cell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [{ type: 'paragraph' }] }); }
    return { type: 'table_figure', attrs: { placement: 'here', ...(id ? { id } : {}) }, content: [{ type: 'caption', content: cap.content }, { type: 'table', content: rows }] };
  }

  return { blocks, report: { citations: report.citations, unknownKeys: [...report.unknownKeys], refs: report.refs, unknownRefs: [...report.unknownRefs] } };
}

/** Does pasted plain text look like LaTeX source (rather than prose that happens to contain a backslash)? */
export function looksLikeLatex(text) {
  const t = String(text || '');
  const cmds = (t.match(/\\(section|subsection|begin|end|cite|ref|eqref|label|emph|textbf|textit|frac|footnote|item|alpha|beta|mathrm|left|right|sum|int)\b/g) || []).length;
  const math = (t.match(/\$[^$\n]+\$/g) || []).length;
  return cmds >= 2 || (cmds >= 1 && math >= 1) || math >= 2;
}
