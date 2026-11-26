/* Reference styles from the CSL style repository (the one Zotero uses; about 10 000 journals).
   search(q): journals whose name matches, from the repository's index (kept in userData, refreshed monthly).
   fetch(name): the style's CSL file; a journal that follows another style ("dependent") gives that parent's file.
   pick(): a .csl file from disk, resolved the same way.
   The renderer stores the result in the document (src/core/references.js), so no network is needed afterwards.
   Test override: DTUSW_CSL_URL (stand-in for https://www.zotero.org). */
'use strict';
const { net, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context.js');

const BASE = () => (ctx.devEnv('DTUSW_CSL_URL') || 'https://www.zotero.org').replace(/\/$/, '');
const TIMEOUT = 20000;
const MAX_AGE = 30 * 24 * 3600 * 1000;
const indexFile = () => path.join(app.getPath('userData'), 'csl-index.json');
let index = null;

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

async function getText(url) {
  const r = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.text();
}

/** The index as [{ t: title, n: name, d: dependent, f: format, k: folded title }]. */
async function loadIndex() {
  if (index) return index;
  let raw = null, stale = true;
  try { const st = fs.statSync(indexFile()); raw = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); stale = Date.now() - st.mtimeMs > MAX_AGE; } catch (_) { raw = null; }
  if (!raw || stale) {
    try {
      const all = JSON.parse(await getText(BASE() + '/styles-files/styles.json'));
      const slim = all.filter(x => x && x.name && x.title).map(x => ({ t: x.title, n: x.name, d: x.dependent ? 1 : 0, f: (x.categories && x.categories.format) || '' }));
      if (slim.length) { raw = slim; try { fs.writeFileSync(indexFile(), JSON.stringify(slim)); } catch (_) {} }
    } catch (e) { if (!raw) throw e; }       // an old index is better than none
  }
  index = raw.map(x => ({ ...x, k: ' ' + fold(x.t) }));
  return index;
}

/** { items: [{ title, name, dependent, format }] } (best 40) or { error }. */
async function search(q) {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return { items: [] };
  let idx;
  try { idx = await loadIndex(); } catch (e) { return { error: 'The style repository could not be reached (' + e.message + ').' }; }
  const whole = ' ' + words.join(' ');
  const hits = [];
  for (const x of idx) {
    if (!words.every(w => x.k.includes(' ' + w))) continue;
    // exact title first, then titles starting with the query, then shorter titles
    const rank = x.k === whole ? 0 : x.k.startsWith(whole) ? 1 : 2;
    hits.push([rank, x.t.length, x]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { items: hits.slice(0, 40).map(h => ({ title: h[2].t, name: h[2].n, dependent: !!h[2].d, format: h[2].f })), total: hits.length };
}

const parentOf = (xml) => { const m = /<link[^>]*href="([^"]+)"[^>]*rel="independent-parent"/.exec(xml) || /<link[^>]*rel="independent-parent"[^>]*href="([^"]+)"/.exec(xml); return m ? m[1].split('/').pop() : ''; };
const titleOf = (xml) => { const m = /<title>([^<]*)<\/title>/.exec(xml); return m ? m[1].trim().replace(/&amp;/g, '&') : ''; };
const isCsl = (xml) => typeof xml === 'string' && /<style[\s>]/.test(xml) && /purl\.org\/net\/xbiblio\/csl/.test(xml);
const safeName = (n) => /^[a-z0-9][a-z0-9._-]{0,119}$/.test(n);

/**
 * A style by its repository name: { name, title, parent, xml } — xml is a complete (independent) style, or '' when the
 * parent is one the app has itself (q.bundled: the repository names of the bundled styles).
 * q: the name, or { name, bundled }.
 */
async function fetchStyle(q) {
  const name = typeof q === 'string' ? q : q && q.name;
  const bundled = new Set((q && q.bundled) || []);
  if (!safeName(name)) return { error: 'Not a style name.' };
  try {
    const own = await getText(BASE() + '/styles/' + name);
    if (!isCsl(own)) return { error: 'The repository did not return a style for “' + name + '”.' };
    return await resolve(name, own, bundled);
  } catch (e) { return { error: e.status === 404 ? 'There is no style called “' + name + '”.' : 'The style could not be downloaded (' + e.message + ').' }; }
}
async function resolve(name, own, bundled = new Set()) {
  const parent = parentOf(own);
  if (!parent) return { name, title: titleOf(own) || name, parent: '', xml: own };
  if (bundled.has(parent)) return { name, title: titleOf(own) || name, parent, xml: '' };
  if (!safeName(parent)) return { error: 'The style refers to a parent style that cannot be read.' };
  const xml = await getText(BASE() + '/styles/' + parent);
  if (!isCsl(xml) || parentOf(xml)) return { error: 'The parent style “' + parent + '” could not be read.' };
  return { name, title: titleOf(own) || name, parent, xml };
}

/** A .csl file from disk: the same result as fetchStyle, or null when cancelled. */
async function pick(q) {
  const file = typeof q === 'string' ? q : null;
  const bundled = new Set((q && q.bundled) || []);
  let p = file;
  if (!p) {
    const r = await dialog.showOpenDialog(ctx.win, { filters: [{ name: 'Citation style (CSL)', extensions: ['csl', 'xml'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    p = r.filePaths[0];
  }
  let own;
  try { own = fs.readFileSync(p, 'utf8'); } catch (e) { return { error: 'The file could not be read.' }; }
  if (!isCsl(own)) return { error: path.basename(p) + ' is not a CSL style file.' };
  const id = (/<id>([^<]+)<\/id>/.exec(own) || [])[1] || path.basename(p).replace(/\.[^.]+$/, '');
  const name = id.trim().split('/').pop().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'style';
  try { return await resolve(name, own, bundled); } catch (e) { return { error: 'This style follows another style, which could not be downloaded (' + e.message + ').' }; }
}

module.exports = { search, fetchStyle, pick };
