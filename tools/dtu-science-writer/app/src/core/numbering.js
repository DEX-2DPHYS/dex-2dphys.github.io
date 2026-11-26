/* Numbering: section, figure and equation numbers and cross-reference texts.
   One function used by the editor (decorations), the Typst writer (checks) and the Word writer
   (precomputed field results), so all three always agree. */
import { LABELLED } from './schema.js';
import { styleOf, headingLabel, toAlpha } from './style.js';

// non-breaking spaces: "Fig. 3" never splits over two lines and is not stretched by justification
export const NBSP = ' ';
export const FORMS = {
  figure: (n, label) => (label || 'Fig.') + NBSP + n,
  equation: (n) => 'Eq.' + NBSP + '(' + n + ')',
  heading: (n) => 'Section' + NBSP + n,
  appendix: (n) => 'Appendix' + NBSP + n,
  captionLabel: (n, label) => (label || 'Fig.') + NBSP + n + '.',
  table: (n) => 'Table' + NBSP + n,
  tableCaptionLabel: (n) => 'Table' + NBSP + n + '.',
};

/* "…shown in Fig. " + reference: when the text right before a reference already names its type, the reference
   shows only the number ("Fig. 3", not "Fig. Fig. 3"). Used by the editor, Typst and Word alike. */
// REF_MARK stands for an earlier reference in the context text, so "Figs. 2 and " + reference is a list: number only
export const REF_MARK = '';
const LIST = '(?:' + REF_MARK + '[a-z]?(?:\\s*[–-]\\s*[a-z])?\\)?\\s*(?:,|;|and|&|or|to|–|-)\\s*\\(?)*';
const words = (w) => new RegExp('(?:^|[\\s(])(?:' + w + ')\\.?\\s*\\(?' + LIST + '$', 'i');
const REF_WORDS = {
  figure: words('fig|figs|figure|figures|supplementary figure|supplementary figures'),
  table_figure: words('table|tables|tab|tabs|supplementary table|supplementary tables'),
  heading: words('section|sections|sec|secs|chapter|appendix|appendices|app|note|notes|supplementary note|supplementary notes'),
  equation: words('eq|eqs|equation|equations'),
};
/** The context text for the next reference after the inline node child (writers keep it while walking a paragraph). */
export function nextContext(prev, child) {
  if (child.isText) return (prev + child.text).slice(-80);
  if (child.type.name === 'xref') return (prev + REF_MARK).slice(-80);
  return '';
}
/** The context text before the child at index of parent (the editor). */
export function contextBefore(parent, index) {
  let t = '';
  for (let i = 0; i < index; i++) t = nextContext(t, parent.child(i));
  return t;
}
export function numberOnly(info, prevText) {
  const re = info && info.num && REF_WORDS[info.type];
  return !!(re && prevText && re.test(prevText));
}
/** The reference text as shown, given the text just before it. */
export function refText(info, prevText) {
  if (!numberOnly(info, prevText)) return info.ref;
  // "Eq. (" typed: the number alone, the brackets are there
  if (info.type === 'equation') return /\(\s*$/.test(prevText) ? info.num : '(' + info.num + ')';
  return info.num;
}

const PREFIX = { heading: 'sec', figure: 'fig', equation: 'eq', table_figure: 'tab' };

export function newId(type, taken) {
  for (;;) {
    const id = PREFIX[type] + '-' + Math.random().toString(36).slice(2, 6);
    if (!taken || !taken.has(id)) return id;
  }
}

/** Label of a heading in the appendix: A, B, … at the top level, A.1, A.1.1 below (a level set to 'none' shows none). */
function appendixLabel(st, sec, lv) {
  if (st['h' + lv].num === 'none') return null;
  return [toAlpha(sec[0] || 1).toUpperCase(), ...sec.slice(1, lv).map(c => c || 1)].join('.');
}

/** Walk the document: numbers for every labelled node, and the footnotes.
    Returns { byId: Map(id -> {type, num, ref, pos, snippet, level, appendix}), byPos: Map(pos -> info), footnotes: Map(pos -> n) }.
    A level-1 heading marked `appendix` starts the appendix: top-level sections from there on are A, B, …, referred to as
    "Appendix A"; figures, tables and equations keep counting on. */
export function computeNumbers(doc) {
  const byId = new Map(), byPos = new Map(), footnotes = new Map();
  const st = styleOf(doc);
  let sec = [0, 0, 0, 0];
  let fig = 0, eq = 0, tab = 0, inAppendix = false;
  // the SI (a 'supplement' node, or a document exported as the SI): S1, S2, … counted from 1
  let si = doc.attrs && doc.attrs.part === 'si';
  const P = () => (si ? 'S' : '');
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === 'supplement') { si = true; inAppendix = false; sec = [0, 0, 0, 0]; fig = 0; eq = 0; tab = 0; return true; }
    // deleted with track changes on (still in the document until accepted): not counted
    if (node.attrs && node.attrs.track && node.attrs.track.kind === 'del' && (t === 'figure' || t === 'table_figure' || t === 'equation')) {
      const info = { type: t, num: null, ref: '(deleted)', pos, snippet: '', si, deleted: true };
      byPos.set(pos, info);
      if (node.attrs.id && !byId.has(node.attrs.id)) byId.set(node.attrs.id, info);
      return false;
    }
    if (t === 'heading') {
      let num = null;
      const lv = Math.min(Math.max(node.attrs.level, 1), 4);
      if (lv === 1 && node.attrs.appendix && !inAppendix && !si) { inAppendix = true; sec = [0, 0, 0, 0]; }
      if (node.attrs.numbered) {        // a level set to 'none' still counts (restarts the levels below) but shows no label
        const l = lv - 1;
        sec[l]++;
        for (let i = l + 1; i < 4; i++) sec[i] = 0;
        for (let i = 0; i < l; i++) if (!sec[i]) sec[i] = 1;   // a 1.1 without a preceding 1 still counts as 1.1
        // SI sections: S1, S1.1 whatever the main numbering style (none stays none)
        num = si ? (st['h' + lv].num === 'none' ? null : 'S' + sec.slice(0, lv).map(c => c || 1).join('.'))
          : inAppendix ? appendixLabel(st, sec, lv) : headingLabel(st, sec, lv);
      }
      const snippet = node.textContent.slice(0, 60);
      const info = { type: t, num, ref: num ? (inAppendix ? FORMS.appendix(num) : FORMS.heading(num)) : '“' + snippet + '”', pos, snippet, level: node.attrs.level, appendix: inAppendix, si };
      byPos.set(pos, info);
      if (node.attrs.id) byId.set(node.attrs.id, info);
      return false;
    }
    if (t === 'figure') {
      fig++;
      const cap = node.lastChild ? node.lastChild.textContent : '';
      const info = { type: t, num: P() + fig, ref: FORMS.figure(P() + fig, st.figLabel), label: st.figLabel, pos, snippet: cap.slice(0, 60), si };
      byPos.set(pos, info);
      if (node.attrs.id) byId.set(node.attrs.id, info);
      return false;
    }
    if (t === 'table_figure') {
      tab++;
      const cap = node.firstChild ? node.firstChild.textContent : '';
      const info = { type: t, num: P() + tab, ref: FORMS.table(P() + tab), pos, snippet: cap.slice(0, 60), si };
      byPos.set(pos, info);
      if (node.attrs.id) byId.set(node.attrs.id, info);
      return false;
    }
    if (t === 'equation') {
      let num = null;
      if (node.attrs.numbered) { eq++; num = P() + eq; }
      const info = { type: t, num, ref: num ? FORMS.equation(num) : 'Eq. (–)', pos, snippet: node.attrs.latex.slice(0, 60), si };
      byPos.set(pos, info);
      if (node.attrs.id) byId.set(node.attrs.id, info);
      return false;
    }
    return true;
  });
  // footnotes, in reading order everywhere (also in captions and tables)
  let fn = 0;
  doc.descendants((node, pos) => { if (node.type.name === 'supplement') fn = 0; if (node.type.name === 'footnote') { footnotes.set(pos, ++fn); return false; } return true; });
  return { byId, byPos, footnotes };
}

/** Entries of a table of contents ('contents': headings of levels 1–3) or a list of figures / tables:
    [{ id, level, num, text, pos }] in document order. */
export function outlineEntries(doc, kind, nums, part) {
  nums = nums || computeNumbers(doc);
  const out = [];
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === 'supplement') return part === 'si';
    if (part === 'si' && !inSupplement(doc, pos)) return t === 'doc';
    if (t === 'heading') {
      if (kind === 'contents' && node.attrs.level <= 3 && node.textContent.trim()) { const i = nums.byPos.get(pos) || {}; out.push({ id: node.attrs.id, level: node.attrs.level, num: i.num || null, text: node.textContent, pos }); }
      return false;
    }
    if (t === 'figure' || t === 'table_figure') {
      if ((kind === 'figures' && t === 'figure') || (kind === 'tables' && t === 'table_figure')) {
        const i = nums.byPos.get(pos) || {};
        const cap = (t === 'figure' ? node.lastChild : node.firstChild);
        out.push({ id: node.attrs.id, level: 1, num: i.num, text: firstSentence(cap ? cap.textContent : ''), pos });
      }
      return false;
    }
    return true;
  });
  return out;
}
/** The supplement node and its position, or null. */
export function supplementOf(doc) {
  const last = doc.lastChild;
  return last && last.type.name === 'supplement' ? { node: last, pos: doc.content.size - last.nodeSize } : null;
}
/** Is the document position pos inside the SI? */
export function inSupplement(doc, pos) {
  const s = supplementOf(doc);
  return !!s && pos > s.pos && pos < s.pos + s.node.nodeSize;
}

/** A caption's first sentence (what lists of figures show). */
export function firstSentence(s) {
  const m = /^(.{12,}?[.!?])(\s|$)/.exec(s.trim());
  const t = m ? m[1] : s.trim();
  return t.length > 160 ? t.slice(0, 157) + '…' : t;
}
export const OUTLINE_TITLE = { contents: 'Contents', figures: 'List of figures', tables: 'List of tables' };

/** Steps that give every labelled node a unique id (missing or duplicated after paste). Returns [{pos, id}]. */
export function missingIds(doc) {
  const seen = new Set(), fixes = [];
  doc.descendants((node, pos) => {
    if (LABELLED.has(node.type.name)) {
      const id = node.attrs.id;
      if (!id || seen.has(id)) {
        const nid = newId(node.type.name, seen);
        seen.add(nid);
        fixes.push({ pos, id: nid });
      } else seen.add(id);
    }
    return node.type.name !== 'equation' && node.type.name !== 'image';
  });
  return fixes;
}
