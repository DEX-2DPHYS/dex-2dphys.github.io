/* References: the document's library (CSL-JSON in doc attr `references`, key -> item; an item cited from Zotero keeps
   `zotero: { id, key }`, the link for refreshing it from Zotero or editing it there), citations (`citation` nodes)
   and their formatting with citeproc-js — one engine for the editor, the PDF and Word, so numbering and formatting
   always agree. Styles are bundled CSL files (csl/). */
import CSL from 'citeproc';
import aps from './csl/american-physics-society.csl';
import nature from './csl/nature.csl';
import acs from './csl/american-chemical-society.csl';
import ieee from './csl/ieee.csl';
import apa from './csl/apa.csl';
import vancouver from './csl/elsevier-vancouver.csl';
import harvard from './csl/harvard-cite-them-right.csl';
import aip from './csl/american-institute-of-physics.csl';
import science from './csl/science.csl';
import advmat from './csl/advanced-materials.csl';
import afm from './csl/advanced-functional-materials.csl';
import small from './csl/small.csl';
import iop from './csl/institute-of-physics-numeric.csl';
import elsevier from './csl/elsevier-with-titles.csl';
import rsc from './csl/royal-society-of-chemistry.csl';
import pnas from './csl/pnas.csl';
import localeUS from './csl/locales-en-US.xml';
import { journalAbbreviation } from './journals.js';
import { sentenceCase } from './titles.js';

export const STYLES = [
  ['aps', 'Physical Review (APS)', aps],
  ['nature', 'Nature', nature],
  ['acs', 'ACS', acs],
  ['ieee', 'IEEE', ieee],
  ['vancouver', 'Vancouver (numbered)', vancouver],
  ['apa', 'APA (author–year)', apa],
  ['harvard', 'Harvard (author–year)', harvard],
  ['aip', 'AIP (Applied Physics Letters, …)', aip],
  ['science', 'Science', science],
  ['advmat', 'Advanced Materials', advmat],
  ['afm', 'Advanced Functional Materials', afm],
  ['small', 'Small', small],
  ['iop', 'IOP (2D Materials, Nanotechnology, …)', iop],
  ['elsevier', 'Elsevier, numbered with titles (Carbon, …)', elsevier],
  ['rsc', 'Royal Society of Chemistry (Nanoscale, …)', rsc],
  ['pnas', 'PNAS', pnas],
];
export const DEFAULT_STYLE = 'aps';
/** Author–year styles: the citation can also be given as "Smith et al. (2019)" (suppress-author gives the year part). */
const AUTHOR_YEAR = new Set(['apa', 'harvard']);

/* A reference style that is not bundled (any of the ~10 000 in the CSL repository, or a .csl file) is stored in the
   document itself: style.csl = { name, title, xml }, chosen with style.cite = 'csl:<name>'. The document then formats
   the same on every computer, without a network. */
const storedCsl = (doc, key) => {
  const st = doc && doc.attrs && doc.attrs.style;
  return st && st.csl && typeof st.csl.xml === 'string' && 'csl:' + st.csl.name === key ? st.csl : null;
};
const xmlFor = (doc, key) => { const c = storedCsl(doc, key); return c ? c.xml : styleXml(key); };
/** Author–year style ("Smith et al. (2019)" possible)? */
export function isAuthorYear(doc, key) {
  const c = storedCsl(doc, key);
  return c ? /citation-format="author-date"/.test(c.xml) : AUTHOR_YEAR.has(key);
}
/** The name of the document's reference style, for menus and messages. */
export function citeStyleLabel(doc, key) {
  const c = storedCsl(doc, key);
  return c ? c.title || c.name : (STYLES.find(s => s[0] === key) || STYLES[0])[1];
}
/** The bundled style a CSL repository name stands for, if any ("american-physics-society" -> "aps"). */
export function bundledKeyFor(cslName) {
  const hit = STYLES.find(s => styleId(s[0]).split('/').pop() === cslName);
  return hit ? hit[0] : null;
}
/** Read what we need from a CSL file: { name, title, parent (for a dependent style), authorYear } or null if it is not CSL. */
export function cslInfo(xml) {
  if (typeof xml !== 'string' || !/<style[\s>]/.test(xml) || !/purl\.org\/net\/xbiblio\/csl/.test(xml)) return null;
  const head = xml.slice(0, xml.indexOf('</info>') + 1 || 4000);
  const tag = (t) => { const m = new RegExp('<' + t + '[^>]*>([^<]*)</' + t + '>').exec(head); return m ? m[1].trim().replace(/&amp;/g, '&') : ''; };
  const id = tag('id');
  const parent = (/<link[^>]*href="([^"]+)"[^>]*rel="independent-parent"/.exec(head) || /<link[^>]*rel="independent-parent"[^>]*href="([^"]+)"/.exec(head) || [])[1] || '';
  const name = (id.split('/').pop() || tag('title')).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  if (!name) return null;
  return { name, title: tag('title') || name, parent: parent ? parent.split('/').pop() : '', authorYear: /citation-format="author-date"/.test(xml) };
}
const styleXml = (key) => (STYLES.find(s => s[0] === key) || STYLES[0])[2];
/** The style's official CSL id (e.g. http://www.zotero.org/styles/american-physics-society): Zotero knows it by this. */
export const styleId = (key, doc) => storedCsl(doc, key) ? ((/<id>([^<]+)<\/id>/.exec(storedCsl(doc, key).xml) || [])[1] || '').trim() : ((/<id>([^<]+)<\/id>/.exec(styleXml(key)) || [])[1] || '').trim();

export const libraryOf = (doc) => (doc.attrs && doc.attrs.references) || {};

/** Why a reference is not a complete record for a shared library (Zotero), or '' when it is. A reference kept as
    typed text (typedrefs.js), or one without authors, year or where it appeared, would fill Zotero with stubs. */
export function incompleteReason(it) {
  if (!it || it.typed) return 'kept as typed text (not verified)';
  if (!it.title) return 'no title';
  if (!(it.author && it.author.length) && !(it.editor && it.editor.length)) return 'no authors';
  const y = it.issued && ((it.issued['date-parts'] || [])[0] || [])[0];
  if (!y && !(it.issued && it.issued.literal)) return 'no year';
  if (!it.DOI && !it['container-title'] && !it.publisher && !it.URL) return 'no journal, publisher, DOI or URL';
  return '';
}

/* ---------- keys and items ---------- */
const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]/g, '');
const yearOf = (it) => { const d = it.issued && (it.issued['date-parts'] || [])[0]; return d && d[0] ? String(d[0]) : (it.issued && it.issued.literal) || ''; };

/** A readable key: first author's family name + year (+ a, b, … when taken). */
export function makeKey(item, taken) {
  // a reference kept as typed text (typedrefs.js) has no author field to name it by
  if (item.typed) { for (let i = 1; ; i++) if (!taken.has('typed' + i)) return 'typed' + i; }
  const fam = item.author && item.author[0] ? (item.author[0].family || item.author[0].literal || '') : (item.title || 'ref').split(/\s+/)[0];
  const base = (ascii(fam).toLowerCase() || 'ref') + yearOf(item);
  if (!taken.has(base)) return base;
  for (let i = 0; i < 26; i++) { const k = base + String.fromCharCode(97 + i); if (!taken.has(k)) return k; }
  return base + '-' + Math.random().toString(36).slice(2, 6);
}

/* Crossref's own type names, which doi.org also delivers in CSL-JSON ("journal-article"), mapped to
   the CSL names the styles know: with an unknown type a style formats the paper as a generic item ("Scientific Reports
   vol. 14 3163"), and the article number is not printed where the page goes. */
const CSL_TYPE = { 'journal-article': 'article-journal', 'proceedings-article': 'paper-conference', 'book-chapter': 'chapter', 'book-section': 'chapter', 'book-part': 'chapter', 'posted-content': 'article', 'dissertation': 'thesis', 'monograph': 'book', 'edited-book': 'book', 'reference-book': 'book', 'book-set': 'book', 'reference-entry': 'entry-encyclopedia', 'report-component': 'report' };
export const cslType = (t) => CSL_TYPE[t] || t;

/** Clean a CSL item for the library; returns null when it has nothing to cite. */
export function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const out = { ...it };
  delete out._graph; delete out.reference; delete out['reference-count'];   // bulky fields from Crossref
  if (Array.isArray(out.title)) out.title = out.title[0];
  if (Array.isArray(out['container-title'])) out['container-title'] = out['container-title'][0];
  out.type = out.type ? cslType(out.type) : 'article-journal';
  if (!out.title && !out.author) return null;
  return out;
}

const titleKey = (it) => String(it.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** The library item that is the same work as `it` (same Zotero item, same DOI, or same title and year), or undefined. */
export function findSame(library, it) {
  const doi = (it.DOI || '').toLowerCase(), tk = titleKey(it), yr = yearOf(it), zk = it.zotero && it.zotero.key;
  return Object.values(library).find(x => (zk && x.zotero && x.zotero.key === zk) || (doi && (x.DOI || '').toLowerCase() === doi) || (tk && titleKey(x) === tk && yearOf(x) === yr));
}

/** Add items to a library copy; returns { library, keys } (a work already in the library is not added twice). */
export function addToLibrary(library, items) {
  const lib = { ...library }, keys = [];
  const taken = new Set(Object.keys(lib));
  for (const raw of items) {
    const it = normalizeItem(raw);
    if (!it) continue;
    const same = findSame(lib, it);
    if (same) {
      // the same work found again through Zotero: remember the link (the document's copy is not otherwise changed)
      if (it.zotero && !same.zotero) lib[same.id] = { ...same, zotero: it.zotero };
      keys.push(same.id);
      continue;
    }
    const key = makeKey(it, taken);
    taken.add(key);
    lib[key] = { ...it, id: key };
    keys.push(key);
  }
  return { library: lib, keys };
}

/** A library item replaced by a fetched record (Zotero, doi.org, Crossref): the record's data, the item's key, and the
    Zotero link of either. Returns null when the record has nothing to cite. */
export function updatedItem(old, fresh) {
  const it = normalizeItem(fresh);
  if (!it) return null;
  const zotero = (fresh && fresh.zotero) || old.zotero;
  // a record without page or article number (often Zotero's) keeps the article number the item already had
  const keep = !it.page && !it['article-number'] && old['article-number'] ? { 'article-number': old['article-number'] } : {};
  return { ...it, ...keep, id: old.id, ...(zotero ? { zotero } : {}) };
}

/** One-line summary of an item (picker lists). */
export function summary(it) {
  const a = (it.author || []).map(x => x.family || x.literal).filter(Boolean);
  const who = a.length > 2 ? a[0] + ' et al.' : a.join(' & ');
  return [who, yearOf(it), it.title].filter(Boolean).join(' · ');
}

/* ---------- BibTeX -> CSL ---------- */
const BIB_TYPES = { article: 'article-journal', book: 'book', inproceedings: 'paper-conference', conference: 'paper-conference', incollection: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', misc: 'article', online: 'webpage', unpublished: 'manuscript' };
const TEX_ACCENTS = { '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋', r: '̊' };
function detex(s) {
  return String(s)
    .replace(/\\([a-zA-Z]|["'`^~=.])\s*\{?\s*([A-Za-z])\}?/g, (m, a, ch) => (TEX_ACCENTS[a] ? (ch + TEX_ACCENTS[a]).normalize('NFC') : m))
    .replace(/\\o\b\s*/g, 'ø').replace(/\\O\b\s*/g, 'Ø').replace(/\\aa\b\s*/g, 'å').replace(/\\AA\b\s*/g, 'Å').replace(/\\ae\b\s*/g, 'æ').replace(/\\ss\b\s*/g, 'ß')
    .replace(/\\([&$_%#])/g, '$1').replace(/~/g, ' ').replace(/--/g, '–').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}
function bibNames(s) {
  return String(s).split(/\s+and\s+/i).map((n) => {
    n = detex(n);
    if (n.includes(',')) { const [family, given] = n.split(',').map(x => x.trim()); return { family, given }; }
    const parts = n.split(' ');
    return parts.length > 1 ? { family: parts.pop(), given: parts.join(' ') } : { literal: n };
  });
}
/** Parse BibTeX text into CSL items (the common fields; enough for citing). */
export function parseBibtex(text) {
  const items = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // body up to the matching closing brace
    let depth = 1, i = re.lastIndex;
    for (; i < text.length && depth; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; }
    const body = text.slice(re.lastIndex, i - 1);
    re.lastIndex = i;
    const f = {};
    const fre = /(\w+)\s*=\s*/g;
    let fm;
    while ((fm = fre.exec(body))) {
      let j = fre.lastIndex, val = '';
      if (body[j] === '{') { let d = 1; j++; const s = j; for (; j < body.length && d; j++) { if (body[j] === '{') d++; else if (body[j] === '}') d--; } val = body.slice(s, j - 1); }
      else if (body[j] === '"') { const s = ++j; while (j < body.length && body[j] !== '"') j++; val = body.slice(s, j); j++; }
      else { const s = j; while (j < body.length && body[j] !== ',') j++; val = body.slice(s, j).trim(); }
      f[fm[1].toLowerCase()] = val;
      fre.lastIndex = j;
    }
    const it = { type: BIB_TYPES[type] || 'article', 'citation-key': m[2] };
    if (f.title) it.title = detex(f.title);
    if (f.author) it.author = bibNames(f.author);
    if (f.editor) it.editor = bibNames(f.editor);
    if (f.journal || f.journaltitle || f.booktitle) it['container-title'] = detex(f.journal || f.journaltitle || f.booktitle);
    if (f.volume) it.volume = detex(f.volume);
    if (f.number || f.issue) it.issue = detex(f.number || f.issue);
    if (f.pages) it.page = detex(f.pages).replace(/–/g, '-');
    if (f.year || f.date) it.issued = { 'date-parts': [[parseInt(f.year || f.date, 10)]] };
    if (f.doi) it.DOI = f.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    if (f.url) it.URL = f.url;
    if (f.publisher) it.publisher = detex(f.publisher);
    if (f.eprint) it.number = 'arXiv:' + f.eprint;
    // article number (journals without page numbers): BibTeX eid / articleno / article-number
    const an = f.eid || f.articleno || f['article-number'] || f.articlenumber;
    if (an) it['article-number'] = detex(an);
    items.push(it);
  }
  return items;
}

/* ---------- CSL -> BibTeX (library export) ---------- */
const BIB_OUT = { 'article-journal': 'article', book: 'book', 'paper-conference': 'inproceedings', chapter: 'incollection', thesis: 'phdthesis', report: 'techreport', manuscript: 'unpublished' };
const bibEsc = (s) => String(s).replace(/([&%$#_])/g, '\\$1');
const bibName = (a) => (a.literal ? '{' + a.literal + '}' : [a.family, a.given].filter(Boolean).join(', '));
/** The library as BibTeX text (keys are the library keys, so a LaTeX export can cite them). */
export function toBibtex(library) {
  return Object.values(library).map((it) => {
    const f = [];
    const add = (k, v) => { if (v) f.push('  ' + k + ' = {' + v + '}'); };
    add('author', (it.author || []).map(bibName).join(' and '));
    add('editor', (it.editor || []).map(bibName).join(' and '));
    add('title', it.title && '{' + bibEsc(it.title) + '}');
    add(it.type === 'paper-conference' || it.type === 'chapter' ? 'booktitle' : 'journal', it['container-title'] && bibEsc(it['container-title']));
    add('volume', it.volume); add('number', it.issue); add('pages', it.page && String(it.page).replace(/-/g, '--'));
    add('year', yearOf(it)); add('publisher', it.publisher && bibEsc(it.publisher)); add('doi', it.DOI); add('url', it.URL);
    return '@' + (BIB_OUT[it.type] || 'misc') + '{' + it.id + ',\n' + f.join(',\n') + '\n}';
  }).join('\n\n') + '\n';
}

/* ---------- formatting with citeproc ---------- */

/**
 * The item as the citation style should see it. Journals that number articles instead of pages (Phys. Rev., Nat.
 * Commun., Sci. Rep., …) deliver an article number and no page range — Crossref as `article-number`, BibTeX as `eid` —
 * and styles print only `page`, so the reference would show nothing there. Without a page range, the article number
 * goes in its place (also for `number` on a journal article, where an import put it). Also: the official journal
 * abbreviation (core/journals.js). The stored item is unchanged.
 */
export function forFormatting(it) {
  if (!it) return it;
  let out = it;
  if (CSL_TYPE[it.type]) out = { ...out, type: CSL_TYPE[it.type] };          // stored before the mapping above existed
  // the official journal abbreviation (core/journals.js) wins over a delivered one, which is often wrong
  const abbr = it['container-title'] && journalAbbreviation(it['container-title']);
  if (abbr && abbr !== it['container-title-short']) out = { ...out, 'container-title-short': abbr, journalAbbreviation: abbr };
  // one capitalisation for all titles (core/titles.js): publishers' Title Case becomes sentence case
  if (typeof it.title === 'string' && !/^(de|fr|es|it|da|sv|no|nl)/i.test(it.language || '')) {
    const t = sentenceCase(it.title);
    if (t !== it.title) out = { ...out, title: t };
  }
  if (!it.page) {
    const an = it['article-number'] || (out.type === 'article-journal' && it.number && !/^arxiv:/i.test(String(it.number)) ? it.number : null);
    if (an) out = { ...out, page: String(an) };
  }
  return out;
}
// a few results kept: the manuscript and its Supplementary Information are formatted separately, on every keystroke
let cache = [];

/** Citations of a document in order: [{ pos, items: [{id, locator}], mode }].
    part 'main' / 'si': only those outside / inside the Supplementary Information (each part has its own numbering and
    list, as in the two exported files); no part: all of them. */
export function citationsOf(doc, part) {
  const out = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'supplement') return part !== 'main';
    if (n.type.name === 'citation') out.push({ pos, items: n.attrs.items || [], mode: n.attrs.mode || 'normal' });
    return true;
  });
  if (part !== 'si') return out;
  const last = doc.lastChild, from = last && last.type.name === 'supplement' ? doc.content.size - last.nodeSize : Infinity;
  return out.filter(c => c.pos > from);
}

/**
 * Format all citations and the reference list.
 * Returns { cites: [html per citation, in document order], bib: { entries: [{ id, label, html }], flush }, missing: [keys] }.
 */
export function formatReferences(doc, styleKey, part) {
  const lib = libraryOf(doc);
  const cites = citationsOf(doc, part);
  // the library object is replaced (never changed in place) when references are added or edited,
  // so identity + the citation list is a cheap and exact cache key (this runs on every keystroke)
  const stored = storedCsl(doc, styleKey);
  const sig = JSON.stringify([styleKey, part || '', stored ? stored.xml.length : 0, cites.map(c => [c.items, c.mode])]);
  const hit = cache.find(c => c.lib === lib && c.sig === sig);
  if (hit) return hit.value;
  const missing = new Set();
  const clusters = cites.map((c, i) => ({
    citationID: 'c' + i,
    citationItems: c.items.filter(x => { if (!lib[x.id]) { missing.add(x.id); return false; } return true; })
      .map(x => ({ id: x.id, ...(x.locator ? { locator: x.locator, label: 'page' } : {}), ...(c.mode === 'suppress-author' ? { 'suppress-author': true } : {}) })),
    properties: { noteIndex: 0 },
  }));
  let value;
  try {
    const engine = new CSL.Engine({ retrieveLocale: () => localeUS, retrieveItem: (id) => forFormatting(lib[id]) }, xmlFor(doc, styleKey));
    engine.opt.development_extensions.wrap_url_and_doi = false;
    const used = [...new Set(clusters.flatMap(c => c.citationItems.map(x => x.id)))];
    engine.updateItems(used);
    const html = new Array(clusters.length).fill('');
    const nonEmpty = clusters.filter(c => c.citationItems.length);
    if (nonEmpty.length) {
      const res = engine.rebuildProcessorState(nonEmpty, 'html');
      for (const [cid, , str] of res) html[+cid.slice(1)] = str.trim();
    }
    clusters.forEach((c, i) => { if (!c.citationItems.length) html[i] = '[?]'; });
    let entries = [], flush = false;
    if (used.length) {
      const [params, list] = engine.makeBibliography();
      flush = !!params['second-field-align'];
      entries = list.map((h, i) => {
        const id = params.entry_ids[i][0];
        const lm = /<div class="csl-left-margin">([\s\S]*?)<\/div>/.exec(h);
        const body = /<div class="csl-right-inline">([\s\S]*?)<\/div>/.exec(h);
        return { id, label: lm ? lm[1].trim() : '', html: (body ? body[1] : h.replace(/<\/?div[^>]*>/g, '')).trim() };
      });
    }
    value = { cites: html, bib: { entries, flush }, missing: [...missing] };
  } catch (e) {
    value = { cites: cites.map(() => '[citation error]'), bib: { entries: [], flush: false }, missing: [...missing], error: String(e.message || e) };
  }
  cache = [{ lib, sig, value }, ...cache].slice(0, 4);
  return value;
}

/**
 * Formatted references for an exporter: { refs, citeHtml(node), needsList }.
 * citeHtml looks a citation node up by identity (queue per instance), so it does not depend on the order
 * in which an exporter walks the document. needsList: there are citations but no reference-list node.
 */
export function referencesFor(doc, styleKey) {
  const refs = formatReferences(doc, styleKey);
  const queues = new Map();
  citationNodes(doc).forEach((n, i) => { if (!queues.has(n)) queues.set(n, []); queues.get(n).push(refs.cites[i]); });
  let hasList = false;
  doc.descendants((n) => { if (n.type.name === 'bibliography') hasList = true; return !hasList; });
  return {
    refs,
    citeHtml: (node) => { const q = queues.get(node); return q && q.length ? (q.length > 1 ? q.shift() : q[0]) : '[?]'; },
    needsList: !hasList && refs.bib.entries.length > 0,
  };
}
function citationNodes(doc) {
  const out = [];
  doc.descendants((n) => { if (n.type.name === 'citation') out.push(n); return true; });
  return out;
}

/* ---------- citeproc HTML -> text segments (for Typst and Word) ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#38': '&' };
const decodeEnt = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));

/** [{ text, marks: ['italic', 'bold', 'sup', 'sub', 'smallcaps'] }] */
export function htmlSegments(html) {
  const out = [], stack = [];
  const re = /<(\/?)(\w+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html || ''))) {
    if (m[4] !== undefined) { const t = decodeEnt(m[4]); if (t) out.push({ text: t, marks: [...new Set(stack.map(x => x.mark).filter(Boolean))] }); continue; }
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
    let mark = null;
    if (tag === 'i' || tag === 'em') mark = 'italic';
    else if (tag === 'b' || tag === 'strong') mark = 'bold';
    else if (tag === 'sup') mark = 'sup';
    else if (tag === 'sub') mark = 'sub';
    else if (tag === 'span' && /small-caps/.test(attrs)) mark = 'smallcaps';
    else if (tag === 'span' && /font-style:\s*normal/.test(attrs)) mark = 'normal';
    if (tag === 'br') continue;
    if (close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.splice(i, 1); break; } }
    else stack.push({ tag, mark });
  }
  // "normal" inside italic cancels it (citeproc's flip-flop)
  return out.map(s => (s.marks.includes('normal') ? { text: s.text, marks: s.marks.filter(x => x !== 'normal' && x !== 'italic') } : s));
}
