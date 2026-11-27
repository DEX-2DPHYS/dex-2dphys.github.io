/* Journal and funder templates ("venues"): what a journal or a funding call asks of a manuscript — the section
   skeleton in its order, the abstract and its limit, and the length limits (words, display items, references, pages).
   The data (venues.json) was read from each venue's current author guide / call text, with the source and the date it
   was checked; null means the guide does not say. Pure: no DOM.

   - venueDoc(venueId, typeId) builds the new document (core/templates.js shape) with the journal's style;
   - checkLimits(doc, info) measures the document against the limits of the venue stored in its style (style.venue =
     "<venue id>/<type id>"), for the status bar (ui/limits.js). */
import DATA from './venues.json';
import { DEFAULT_STYLE } from './style.js';
import { applyJournal, journalById } from './journalstyles.js';
import { citationsOf } from './references.js';

export const VENUES = DATA.map(v => ({ ...v, kind: v.kind || (journalById(v.id) ? 'journal' : 'funder') }));
export const JOURNAL_VENUES = VENUES.filter(v => v.kind === 'journal');
export const FUNDER_VENUES = VENUES.filter(v => v.kind === 'funder');
export const venueById = (id) => VENUES.find(v => v.id === id) || null;

/** "nature-communications/article" -> { venue, type }, or null. */
export function venueOf(key) {
  if (typeof key !== 'string') return null;
  const [vid, tid] = key.split('/');
  const venue = venueById(vid);
  if (!venue) return null;
  const type = venue.types.find(t => t.id === tid) || venue.types[0];
  return type ? { venue, type } : null;
}
export const VENUE_KEY = /^[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}$/;

/* ---------- the new document ---------- */
const txt = (s) => (s ? [{ type: 'text', text: s }] : undefined);
const para = () => ({ type: 'paragraph' });
const heading = (level, title, numbered) => ({ type: 'heading', attrs: { level, numbered }, content: txt(title) });
const sameTitle = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The style a venue's document starts with: the journal style, or for a funder the format it requires. */
export function venueStyle(venue, type) {
  let st = JSON.parse(JSON.stringify(DEFAULT_STYLE));
  if (journalById(venue.id)) st = applyJournal(st, venue.id);
  else {
    const f = venue.format || {};
    if (/arial|helvetica|calibri|sans/i.test(String(f.font || ''))) st.font = 'arial';
    const min = Number(f.fontSizeMin) || 0;
    st.size = min >= 12 ? 12 : min > 11 ? 12 : 11;
    st.figLabel = 'Figure';
    for (const k of ['h1', 'h2', 'h3', 'h4']) st[k].num = '1';
  }
  if (venue.format && venue.format.spacing && [1, 1.5, 2].includes(Number(venue.format.spacing))) st.spacing = Number(venue.format.spacing);
  if (venue.format && venue.format.lineNumbers === true) st.lineNumbers = true;
  st.venue = venue.id + '/' + type.id;
  return st;
}

export function venueDoc(venueId, typeId) {
  const v = venueOf(venueId + '/' + (typeId || ''));
  if (!v) return null;
  const { venue, type } = v;
  const content = [{ type: 'title' }, { type: 'authors', attrs: { list: [], affils: [] } }];
  const abs = type.abstract;
  if (abs && sameTitle(abs.label || 'Abstract', 'Abstract')) content.push({ type: 'abstract', content: [para()] });
  else if (abs) content.push(heading(1, abs.label, false), para());
  for (const s of type.sections || []) {
    if (s.refs) { content.push({ type: 'bibliography', attrs: { title: s.title || 'References' } }); continue; }
    if (!s.title) { content.push(para()); continue; }
    const h = heading(1, s.title, !s.back && s.numbered !== false);
    if (s.appendix) h.attrs.appendix = true;             // "Appendix": top-level sections from here on are A, B, …
    content.push(h, para());
    for (const sub of s.sub || []) content.push(heading(2, sub, !s.back && s.numbered !== false), para());
  }
  return { type: 'doc', attrs: { style: venueStyle(venue, type) }, content };
}

/* ---------- measuring ---------- */
const wordsIn = (s) => (String(s).match(/\S+/g) || []).length;
/** Characters with spaces, as funders count them (runs of white space as one). */
const chars = (s) => String(s).replace(/\s+/g, ' ').trim().length;

/** Text of a node without tracked deletions, footnotes and captions (captions are counted on their own). */
function plainText(node, { captions = false } = {}) {
  let out = '';
  node.descendants((n) => {
    if (n.type.name === 'footnote') return false;
    if (!captions && n.type.name === 'caption') return false;
    if (n.isText) { if (!n.marks.some(m => m.type.name === 'del')) out += n.text; }
    else if (n.isBlock) out += ' ';
    return true;
  });
  return out;
}

/** The main part split into sections: [{ title, nodes, pos, index }] — the first (title null) is what stands before
    the first level-1 heading after the abstract. */
function sectionsOf(doc) {
  const out = [{ title: null, nodes: [], index: 0, pos: 0 }];
  doc.forEach((n, pos, i) => {
    if (n.type.name === 'supplement' || n.type.name === 'title' || n.type.name === 'authors' || n.type.name === 'abstract') return;
    if (n.type.name === 'heading' && n.attrs.level === 1) out.push({ title: n.textContent.trim(), nodes: [], index: i, pos, heading: n });
    else out[out.length - 1].nodes.push(n);
  });
  return out;
}

/** Each section of the document matched to the venue's skeleton; headings the venue does not name count as main
    text until the first section that does not count (Methods, back matter), and not after it. */
function classify(doc, type) {
  const spec = type.sections || [];
  let afterMain = false;
  return sectionsOf(doc).map((sec) => {
    const s = sec.title === null ? (spec.find(x => !x.title && !x.refs) || { counts: true }) : spec.find(x => sameTitle(x.title, sec.title));
    let counts;
    if (s) { counts = s.counts !== false && !s.back && !s.refs; if (s.title && !counts) afterMain = true; }
    else counts = !afterMain;
    return { ...sec, spec: s || null, counts };
  });
}

function abstractText(doc, type) {
  const abs = type.abstract;
  if (!abs) return null;
  let a = null;
  doc.forEach((n) => { if (n.type.name === 'abstract') a = n; });
  if (a) return plainText(a);
  const sec = sectionsOf(doc).find(s => sameTitle(s.title, abs.label));
  return sec ? sec.nodes.map(n => plainText(n)).join(' ') : '';
}

/**
 * Measure doc against the venue stored in its style. info: { pages, sectionPages: { [section title]: pages } }.
 * Returns null without a venue, else { venue, type, rows: [{ key, label, value, max, unit, state }] }
 * (state: 'ok' | 'near' | 'over'; near = within 5 % of the limit).
 */
export function checkLimits(doc, info = {}) {
  const st = doc.attrs && doc.attrs.style;
  const v = venueOf(st && st.venue);
  if (!v) return null;
  const { venue, type } = v;
  const L = type.limits || {};
  const rows = [];
  const add = (key, label, value, max, unit) => {
    if (max == null || !(max > 0) || value == null) return;
    rows.push({ key, label, value, max, unit, state: value > max ? 'over' : value > 0.95 * max ? 'near' : 'ok' });
  };
  const title = doc.firstChild && doc.firstChild.type.name === 'title' ? plainText(doc.firstChild) : '';
  add('titleChars', 'Title', title.trim().length, L.titleChars, 'characters');
  add('titleWords', 'Title', wordsIn(title), L.titleWords, 'words');
  const abs = abstractText(doc, type);
  if (abs !== null) {
    add('abstract', type.abstract.label || 'Abstract', wordsIn(abs), type.abstract.words, 'words');
    add('abstractChars', type.abstract.label || 'Abstract', chars(abs), type.abstract.chars, 'characters');
  }

  const secs = classify(doc, type);
  let main = 0, mainChars = 0, display = 0;
  for (const sec of secs) {
    for (const n of sec.nodes) {
      const isDisplay = n.type.name === 'figure' || n.type.name === 'table_figure';
      if (sec.counts) {
        main += wordsIn(plainText(n, { captions: !!L.captionsCount }));
        mainChars += chars(plainText(n, { captions: true }));
        if (isDisplay && L.figureWords) main += L.figureWords;
      }
      if (isDisplay && !(sec.spec && (sec.spec.back || sec.spec.refs))) display++;
    }
    if (sec.counts && sec.heading) { main += wordsIn(plainText(sec.heading)); mainChars += chars(plainText(sec.heading)); }
    // per-section limits (funders)
    const lim = sec.spec && sec.spec.limit;
    if (lim) {
      const text = sec.nodes.map(n => plainText(n, { captions: true })).join(' ');
      add('sec:' + sec.title + ':words', sec.title, wordsIn(text), lim.words, 'words');
      add('sec:' + sec.title + ':chars', sec.title, chars(text), lim.chars, 'characters');
      const sp = info.sectionPages && info.sectionPages[sec.title];
      if (sp != null) add('sec:' + sec.title + ':pages', sec.title, Math.round(sp * 10) / 10, lim.pages, 'pages');
    }
  }
  add('main', 'Main text', main, L.mainWords, 'words');
  add('mainChars', 'Text', mainChars, L.mainChars, 'characters');
  add('display', 'Figures and tables', display, L.display, '');
  const refs = new Set();
  for (const c of citationsOf(doc, 'main')) for (const it of c.items) refs.add(it.id);
  add('refs', 'References', refs.size, L.refs, '');
  if (info.pages != null) add('pages', 'Length', info.pages, L.pages, 'pages');
  return { venue, type, rows };
}

/** The section titles that carry a page limit (the preview then asks Typst where they start). */
export function pageLimitedSections(doc) {
  const st = doc.attrs && doc.attrs.style;
  const v = venueOf(st && st.venue);
  return v ? (v.type.sections || []).filter(s => s.title && s.limit && s.limit.pages).map(s => s.title) : [];
}

/** Page spans of the level-1 sections from Typst block positions ([[blockIndex, page, y], …] and blockOf, as in
    editor/pageview.js), in pages (fractions of the text height). */
export function sectionPageSpans(doc, positions, blockOf, geom) {
  const byIndex = new Map(positions.map(([i, page, y]) => [i, page + (y - geom.top) / (geom.bottom - geom.top)]));
  const starts = [];
  let endAt = null;
  doc.forEach((n, _o, k) => {
    const at = blockOf[k] === undefined ? undefined : byIndex.get(blockOf[k]);
    if (n.type.name === 'heading' && n.attrs.level === 1 && at !== undefined) starts.push({ title: n.textContent.trim(), at });
    if (at !== undefined) endAt = at;
  });
  const lastPage = positions.reduce((m, p) => Math.max(m, p[1]), 1);
  const out = {};
  starts.forEach((s, i) => { const end = i + 1 < starts.length ? starts[i + 1].at : Math.max(endAt || s.at, lastPage + 1); out[s.title] = Math.max(0, end - s.at); });
  return out;
}
