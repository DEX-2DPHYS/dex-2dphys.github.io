/* Document style: font pair, body size, title block, heading formatting and numbering, affiliation format.
   Stored in the document (doc attr `style`), applied to the editor (CSS variables), the PDF (Typst preamble)
   and Word (styles.xml, numbering.xml). Heading sizes are relative to the body size. */

/* Only fonts with a matching math font. Times New Roman and Arial come from the system (every Windows/Mac);
   the math fonts ship with the app (assets/fonts). Word uses Cambria Math: co-authors will not have STIX/Fira. */
export const FONTS = {
  times: { label: 'Times New Roman', body: 'Times New Roman', css: "'Times New Roman', Times, serif", math: 'STIX Two Math', mathLabel: 'STIX Two Math', word: 'Times New Roman' },
  arial: { label: 'Arial', body: 'Arial', css: 'Arial, Helvetica, sans-serif', math: 'Fira Math', mathLabel: 'Fira Math', word: 'Arial' },
};

export const LEVELS = ['title', 'h1', 'h2', 'h3', 'h4'];
export const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4'];
export const LEVEL_LABEL = { title: 'Title', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4' };

/* Heading numbering per level. '1' at a level whose parent levels are all '1' gives 1.2.3; any other
   format numbers the level on its own (ii, b, …). */
export const NUMBERINGS = [['1', '1, 1.1, 1.1.1'], ['i', 'i, ii, iii'], ['I', 'I, II, III'], ['a', 'a, b, c'], ['A', 'A, B, C'], ['none', 'none']];

/* Affiliation formats */
export const AFFIL_MARKERS = [['numbers', '¹ ² ³'], ['letters', 'ᵃ ᵇ ᶜ'], ['symbols', '† ‡ §']];
export const AFFIL_FIELDS = [['full', 'Department, institution, street, postcode city, country'], ['medium', 'Department, institution, city, country'], ['short', 'Institution, country']];

export const DEFAULT_STYLE = {
  font: 'times',
  size: 11,
  titleAlign: 'left',
  title: { delta: 6, bold: true, italic: false, color: '#000000' },
  h1: { delta: 2, bold: true, italic: false, color: '#000000', num: '1' },      // one step up: 12 -> 14, 10 -> 12
  h2: { delta: 0, bold: true, italic: false, color: '#000000', num: '1' },
  h3: { delta: 0, bold: false, italic: true, color: '#000000', num: '1' },
  h4: { delta: 0, bold: false, italic: true, color: '#000000', num: 'a' },
  affil: { marker: 'numbers', fields: 'medium' },
  cite: 'aps',          // citation style (references.js STYLES, or 'csl:<id>' for a style stored in the document)
  lang: 'en-GB',
  spacing: 1,           // line spacing: 1, 1.5 or 2 (journals ask for double-spaced submissions)
  lineNumbers: false,   // continuous line numbers in the margin (PDF, Word, LaTeX; not shown while editing)
  figLabel: 'Fig.',     // "Fig. 3" or "Figure 3", in captions and references
  journal: '',          // the journal style last applied (journalstyles.js), shown in the Style dialog
};
export const SPACINGS = [[1, 'single'], [1.5, '1.5 lines'], [2, 'double']];
export const FIG_LABELS = ['Fig.', 'Figure'];
export const isCslKey = (k) => typeof k === 'string' && /^csl:[A-Za-z0-9._-]{1,120}$/.test(k);
const CITE_KEYS = ['aps', 'nature', 'acs', 'ieee', 'vancouver', 'apa', 'harvard', 'aip', 'science', 'advmat', 'afm', 'small', 'iop', 'elsevier', 'rsc', 'pnas'];

/* Document language: spell-check in the editor, hyphenation in the PDF, proofing language in Word. */
export const LANGS = [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['da-DK', 'Danish'], ['de-DE', 'German']];

export const SIZES = [10, 10.5, 11, 12];
export const DELTAS = [0, 1, 2, 3, 4, 6, 8];
export const SWATCHES = [['#000000', 'Black'], ['#990000', 'DTU red'], ['#1f4e79', 'Dark blue'], ['#2f5d3a', 'Dark green'], ['#404040', 'Dark grey']];

const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
const oneOf = (v, list, d) => (list.some(x => (Array.isArray(x) ? x[0] : x) === v) ? v : d);

/** The document's style with defaults filled in and values checked (files can come from other versions). */
export function resolveStyle(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {
    font: FONTS[s.font] ? s.font : DEFAULT_STYLE.font,
    size: typeof s.size === 'number' && s.size >= 8 && s.size <= 14 ? s.size : DEFAULT_STYLE.size,
    titleAlign: s.titleAlign === 'center' ? 'center' : 'left',
  };
  for (const k of LEVELS) {
    const d = DEFAULT_STYLE[k], v = s[k] && typeof s[k] === 'object' ? s[k] : {};
    out[k] = {
      delta: typeof v.delta === 'number' && v.delta >= 0 && v.delta <= 12 ? v.delta : d.delta,
      bold: typeof v.bold === 'boolean' ? v.bold : d.bold,
      italic: typeof v.italic === 'boolean' ? v.italic : d.italic,
      color: isColor(v.color) ? v.color.toLowerCase() : d.color,
    };
    if (k !== 'title') out[k].num = oneOf(v.num, NUMBERINGS, d.num);
  }
  const a = s.affil && typeof s.affil === 'object' ? s.affil : {};
  out.cite = CITE_KEYS.includes(s.cite) || isCslKey(s.cite) ? s.cite : DEFAULT_STYLE.cite;
  out.spacing = oneOf(s.spacing, SPACINGS, DEFAULT_STYLE.spacing);
  out.lineNumbers = s.lineNumbers === true;
  out.figLabel = oneOf(s.figLabel, FIG_LABELS, DEFAULT_STYLE.figLabel);
  // a reference style stored in the document (references.js); kept as it is
  if (s.csl && typeof s.csl === 'object' && typeof s.csl.xml === 'string' && typeof s.csl.name === 'string' && isCslKey('csl:' + s.csl.name)) out.csl = { name: s.csl.name, title: String(s.csl.title || s.csl.name), xml: s.csl.xml };
  if (isCslKey(out.cite) && !(out.csl && 'csl:' + out.csl.name === out.cite)) out.cite = DEFAULT_STYLE.cite;
  out.journal = typeof s.journal === 'string' && /^[a-z0-9-]{1,60}$/.test(s.journal) ? s.journal : '';
  out.lang = oneOf(s.lang, LANGS, DEFAULT_STYLE.lang);
  out.affil = { marker: oneOf(a.marker, AFFIL_MARKERS, DEFAULT_STYLE.affil.marker), fields: oneOf(a.fields, AFFIL_FIELDS, DEFAULT_STYLE.affil.fields) };
  return out;
}

export const styleOf = (doc) => resolveStyle(doc && doc.attrs ? doc.attrs.style : null);
export const levelSize = (st, k) => st.size + st[k].delta;

/* ---------- counters ---------- */
export function toRoman(n) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}
export function toAlpha(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
export function formatCounter(n, fmt) {
  switch (fmt) {
    case 'i': return toRoman(n);
    case 'I': return toRoman(n).toUpperCase();
    case 'a': return toAlpha(n);
    case 'A': return toAlpha(n).toUpperCase();
    default: return String(n);
  }
}

/** Heading label for counters [c1, c2, …] of a heading at level l (1-based), or null when unnumbered. */
export function headingLabel(st, counters, l) {
  const fmt = st['h' + l].num;
  if (fmt === 'none') return null;
  const chainArabic = fmt === '1' && [...Array(l).keys()].every(i => st['h' + (i + 1)].num === '1');
  if (chainArabic) return counters.slice(0, l).map(c => c || 1).join('.');
  return formatCounter(counters[l - 1], fmt);
}
