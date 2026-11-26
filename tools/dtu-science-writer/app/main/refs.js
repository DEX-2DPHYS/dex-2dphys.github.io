/* Reference lookup for the citation dialog: DOI and arXiv metadata (doi.org content negotiation, CSL-JSON),
   search in the local Zotero library (Zotero 7 local API) and BibTeX files. Everything comes back as CSL-JSON items;
   formatting is done in the renderer (src/core/references.js).
   Test overrides: DTUSW_DOI_URL (stand-in for https://doi.org), DTUSW_ZOTERO_URL (stand-in for Zotero). */
'use strict';
const { net, dialog } = require('electron');
const fs = require('fs');
const ctx = require('./context.js');
const zweb = require('./zotero.js');

const DOI_URL = () => (ctx.devEnv('DTUSW_DOI_URL') || 'https://doi.org').replace(/\/$/, '');
const ZOTERO_URL = () => (ctx.devEnv('DTUSW_ZOTERO_URL') || 'http://127.0.0.1:23119').replace(/\/$/, '');
const TIMEOUT = 12000;

/** "10.1103/…", "https://doi.org/10.…", "arXiv:2101.01234", "2101.01234v2", "cond-mat/0410550" -> DOI, or null. */
function doiOf(text) {
  const s = String(text || '').trim();
  const d = /(10\.\d{4,9}\/[^\s"<>]+)/.exec(s);
  if (d) return d[1].replace(/[.,;]$/, '');
  const a = /^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?(?:\.pdf)?$/i.exec(s);
  if (a) return '10.48550/arXiv.' + a[1];
  return null;
}

async function getJson(url, headers, retry = true) {
  const r = await net.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  // Crossref and doi.org limit request rates: wait once and try again
  if (r.status === 429 && retry) { await new Promise(res => setTimeout(res, 2500)); return getJson(url, headers, false); }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

/** Metadata for a DOI or arXiv id: { items: [csl] } or { error }. */
async function lookup(text) {
  const doi = doiOf(text);
  if (!doi) return { error: 'Not a DOI or arXiv number.' };
  try {
    const item = await getJson(DOI_URL() + '/' + encodeURI(doi), { Accept: 'application/vnd.citationstyles.csl+json' });
    return { items: [item] };
  } catch (e) {
    if (e.status === 404) return { error: 'No record found for ' + doi + '.' };
    ctx.log('refs: lookup ' + doi + ' failed: ' + e.message);
    return { error: 'Could not reach doi.org (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ').' };
  }
}

/** Search the local Zotero library: { items } or { error } (Zotero not running / local API off). */
async function zotero(q) {
  const url = ZOTERO_URL() + '/api/users/0/items/top?format=csljson&limit=30&q=' + encodeURIComponent(q || '');
  try {
    const j = await getJson(url, { 'Zotero-API-Version': '3' });
    const items = Array.isArray(j) ? j : (j && j.items) || [];
    // keep the link to the Zotero item (its key is the last part of the CSL id: "1/ABCD1234", ".../items/ABCD1234"),
    // so a document's copy can later be refreshed from Zotero or edited there
    return { items: items.map(it => (it && it.id ? { ...it, zotero: { id: String(it.id), key: String(it.id).split('/').pop() } } : it)) };
  } catch (e) {
    // desktop Zotero not running: the online library, when a key is set (Settings)
    if (zweb.status().configured) {
      try { return { items: await zweb.search(q), source: 'web' }; } catch (e2) { return { error: e2.message }; }
    }
    return { error: 'Zotero not found. Start Zotero 7 and tick Settings → Advanced → “Allow other applications on this computer to communicate with Zotero”, or add a Zotero API key in Settings.' };
  }
}

/* ---------- update a library item from its authoritative source ---------- */
const CROSSREF_URL = () => (ctx.devEnv('DTUSW_CROSSREF_URL') || 'https://api.crossref.org').replace(/\/$/, '');
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').toLowerCase();
const titleKey = (s) => fold(Array.isArray(s) ? s[0] : s).replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '');
const yearOf = (it) => { const d = it && it.issued && (it.issued['date-parts'] || [])[0]; return d && d[0] ? +d[0] : null; };
const firstFamily = (it) => fold(((it && it.author) || [])[0] && (it.author[0].family || it.author[0].literal || '')).replace(/[^a-z]/g, '');

/** Is the found record the same work? Title (allowing small differences), year (±1: online vs print) and first author. */
function sameWork(a, b) {
  const ta = titleKey(a.title), tb = titleKey(b.title);
  if (!ta || !tb) return false;
  const titleOk = ta === tb || ((ta.includes(tb) || tb.includes(ta)) && Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length) > 0.85);
  const ya = yearOf(a), yb = yearOf(b);
  const yearOk = !ya || !yb || Math.abs(ya - yb) <= 1;
  const fa = firstFamily(a), fb = firstFamily(b);
  const authorOk = !fa || !fb || fa === fb || fa.includes(fb) || fb.includes(fa);
  return titleOk && yearOk && authorOk;
}

/**
 * The full, current record for a library item: from Zotero when it is linked (and Zotero runs), else from doi.org by its
 * DOI, else the best Crossref match — accepted only when title, year and first author agree.
 * Returns { item, source: 'zotero' | 'doi' | 'crossref' } or { error }.
 */
async function match(it) {
  if (!it) return { error: 'nothing to match' };
  if (it.zotero && it.zotero.key) {
    try {
      const j = await getJson(ZOTERO_URL() + '/api/users/0/items/' + encodeURIComponent(it.zotero.key) + '?format=csljson', { 'Zotero-API-Version': '3' });
      const z = Array.isArray(j) ? j[0] : (j && j.items ? j.items[0] : j);
      if (z && z.title) return { item: { ...z, zotero: it.zotero }, source: 'zotero' };
    } catch (_) { /* Zotero not running: the online library, else the DOI */ }
    if (zweb.status().configured) {
      try { const z = await zweb.item(it.zotero.key); if (z && z.title) return { item: { ...z, zotero: it.zotero }, source: 'zotero' }; } catch (_) { /* not online / not in this library */ }
    }
  }
  let doi = it.DOI;
  if (!doi) {
    const q = [it.title, ((it.author || [])[0] || {}).family, yearOf(it), it['container-title']].filter(Boolean).join(' ');
    try {
      const j = await getJson(CROSSREF_URL() + '/works?rows=5&select=DOI,title,author,issued,container-title&query.bibliographic=' + encodeURIComponent(q), { 'User-Agent': 'DTU Science Writer (reference update)' });
      const hit = ((j && j.message && j.message.items) || []).find(c => sameWork(it, { ...c, title: (c.title || [])[0] }));
      if (!hit) return { error: 'no matching record found' };
      doi = hit.DOI;
    } catch (e) { return { error: 'Crossref not reachable (' + e.message + ')' }; }
  }
  const r = await lookup(doi);
  if (r.error) return r;
  const found = r.items[0];
  if (!it.DOI && !sameWork(it, found)) return { error: 'the record found does not match' };
  return { item: found, source: it.DOI ? 'doi' : 'crossref' };
}

/**
 * A typed reference ("A. Author, Title, Journal 12, 345 (2019).") -> its verified record: the best Crossref matches for
 * the whole text; one is accepted only when its title and first author occur in the text and the year agrees.
 * Returns { item } or { error }.
 */
async function matchText(text) {
  const t = String(text || '').trim();
  if (t.length < 15) return { error: 'too short to identify' };
  const doi = doiOf(t);
  if (doi && /10\.\d{4,9}\//.test(t)) { const r = await lookup(doi); if (!r.error) return { item: r.items[0] }; }
  const norm = (s) => fold(s).replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const nt = norm(t);
  const years = (t.match(/\b(1[6-9]|20)\d{2}\b/g) || []).map(Number);
  try {
    const j = await getJson(CROSSREF_URL() + '/works?rows=4&select=DOI,title,author,issued&query.bibliographic=' + encodeURIComponent(t.slice(0, 600)), { 'User-Agent': 'DTU Science Writer (reference conversion)' });
    for (const c of (j && j.message && j.message.items) || []) {
      const title = norm((c.title || [])[0]);
      const cy = c.issued && c.issued['date-parts'] && c.issued['date-parts'][0] && c.issued['date-parts'][0][0];
      const fam = norm(((c.author || [])[0] || {}).family || '');
      const titleOk = title.length > 8 && nt.includes(title.slice(0, Math.min(50, title.length)));
      if (titleOk && (!fam || nt.includes(fam)) && (!years.length || !cy || years.some(y => Math.abs(y - cy) <= 1))) {
        const r = await lookup(c.DOI);
        if (!r.error) return { item: r.items[0] };
      }
    }
    return { error: 'no matching record found' };
  } catch (e) { return { error: 'Crossref not reachable (' + e.message + ')' }; }
}

async function pickBibtex() {
  const r = await dialog.showOpenDialog(ctx.win, { filters: [{ name: 'BibTeX', extensions: ['bib', 'bibtex', 'txt'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
}

module.exports = { lookup, zotero, match, matchText, pickBibtex, doiOf, sameWork };
