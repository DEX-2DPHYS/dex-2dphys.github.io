/* Zotero web API (zotero.org): the user's library online, with their API key — search, read, add and edit items.
   The key is stored encrypted (Electron safeStorage: Windows DPAPI) in config.json and never leaves the main process.
   The desktop app's local API (main/refs.js) is tried first where it can serve; the web API needs no running Zotero and
   can write. Test override: DTUSW_ZOTERO_WEB (stand-in for https://api.zotero.org). */
'use strict';
const { net, safeStorage } = require('electron');
const crypto = require('crypto');
const ctx = require('./context.js');

const BASE = () => (ctx.devEnv('DTUSW_ZOTERO_WEB') || 'https://api.zotero.org').replace(/\/$/, '');
const TIMEOUT = 15000;

/* ---------- the key ---------- */
async function storedKey() {
  const z = ctx.config.zotero;
  if (!z || !z.key) return null;
  try { return (await safeStorage.isAsyncEncryptionAvailable()) ? await safeStorage.decryptStringAsync(Buffer.from(z.key, 'base64')).then(r => (typeof r === 'string' ? r : r.result)) : null; } catch (_) { return null; }
}
const userID = () => (ctx.config.zotero && ctx.config.zotero.userID) || null;

async function call(path, { method = 'GET', body, headers = {}, key } = {}) {
  if (!key) key = await storedKey();
  if (!key) { const e = new Error('No Zotero API key — add one in Settings.'); e.code = 'nokey'; throw e; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await net.fetch(BASE() + path, {
      method, signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'Zotero-API-Version': '3', 'Zotero-API-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    // rate limits: wait as asked (Backoff / Retry-After), then try again
    if (r.status === 429 || r.status === 503) { const s = +(r.headers.get('Retry-After') || r.headers.get('Backoff') || 2); await new Promise(res => setTimeout(res, Math.min(s, 10) * 1000)); continue; }
    if (r.status === 204) return { status: 204 };
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!r.ok) { const e = new Error('Zotero: HTTP ' + r.status + (text ? ' — ' + text.slice(0, 160) : '')); e.status = r.status; throw e; }
    return { status: r.status, json, version: r.headers.get('Last-Modified-Version') };
  }
  throw new Error('Zotero is busy (rate limit) — try again in a minute.');
}

/** Check a key and store it (encrypted). Returns { ok, username, canWrite } or { error }. */
async function setKey(key) {
  key = String(key || '').trim();
  if (!/^[A-Za-z0-9]{24}$/.test(key)) return { error: 'That is not a Zotero API key (24 letters and digits, from zotero.org/settings/keys).' };
  try {
    const r = await call('/keys/' + key, { key });
    const k = r.json || {};
    const canWrite = !!(k.access && k.access.user && k.access.user.write);
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return { error: 'Windows cannot encrypt the key on this PC, so it is not stored.' };
    const enc = await safeStorage.encryptStringAsync(key);
    ctx.config.zotero = { key: Buffer.from(enc).toString('base64'), userID: k.userID, username: k.username, canWrite };
    ctx.saveConfig();
    return { ok: true, username: k.username, canWrite };
  } catch (e) { return { error: e.status === 403 || e.status === 404 ? 'Zotero does not know this key.' : e.message }; }
}
function clearKey() { delete ctx.config.zotero; ctx.saveConfig(); return { ok: true }; }
function status() {
  const z = ctx.config.zotero;
  return z && z.key ? { configured: true, username: z.username, canWrite: !!z.canWrite } : { configured: false };
}

/* ---------- reading ---------- */
const itemUri = (key) => 'http://zotero.org/users/' + userID() + '/items/' + key;
const link = (key) => ({ id: itemUri(key), key, web: true });

/** Search the online library (top-level items) -> CSL items with their Zotero link. */
async function search(q) {
  const r = await call('/users/' + userID() + '/items/top?format=csljson&limit=30&q=' + encodeURIComponent(q || ''));
  const items = Array.isArray(r.json) ? r.json : (r.json && r.json.items) || [];
  return items.map(it => ({ ...it, zotero: link(String(it.id).split('/').pop()) }));
}
/** One item as CSL. */
async function item(key) {
  const r = await call('/users/' + userID() + '/items/' + encodeURIComponent(key) + '?format=csljson');
  const it = Array.isArray(r.json) ? r.json[0] : (r.json && r.json.items ? r.json.items[0] : r.json);
  return it ? { ...it, zotero: link(key) } : null;
}

/* ---------- writing ---------- */
const TYPE = { 'article-journal': 'journalArticle', book: 'book', chapter: 'bookSection', 'paper-conference': 'conferencePaper', report: 'report', thesis: 'thesis', article: 'preprint', webpage: 'webpage', manuscript: 'manuscript' };
const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

/** CSL item -> Zotero item fields (journal abbreviation: the official one, given by the renderer). */
function zoteroFields(it, opts = {}) {
  const itemType = TYPE[it.type] || 'journalArticle';
  const d = it.issued && it.issued['date-parts'] && it.issued['date-parts'][0];
  const z = {
    itemType,
    title: first(it.title),
    creators: (it.author || []).map(a => (a.literal ? { creatorType: 'author', name: a.literal } : { creatorType: 'author', firstName: a.given || '', lastName: a.family || '' }))
      .concat((it.editor || []).map(a => (a.literal ? { creatorType: 'editor', name: a.literal } : { creatorType: 'editor', firstName: a.given || '', lastName: a.family || '' }))),
    date: d ? d.join('-') : (it.issued && it.issued.literal) || '',
    url: it.URL || '',
  };
  const pages = it.page || it['article-number'] || '';
  // only these Zotero item types have a DOI field (an unknown field makes Zotero refuse the whole item)
  if (['journalArticle', 'conferencePaper', 'preprint'].includes(itemType)) z.DOI = it.DOI || '';
  if (itemType === 'journalArticle') Object.assign(z, { publicationTitle: first(it['container-title']), journalAbbreviation: opts.abbreviation || first(it['container-title-short']), volume: it.volume || '', issue: it.issue || '', pages });
  else if (itemType === 'book') Object.assign(z, { publisher: it.publisher || '', place: it['publisher-place'] || '' });
  else if (itemType === 'bookSection') Object.assign(z, { bookTitle: first(it['container-title']), publisher: it.publisher || '', pages });
  else if (itemType === 'conferencePaper') Object.assign(z, { proceedingsTitle: first(it['container-title']), pages });
  else if (itemType === 'report') Object.assign(z, { institution: it.publisher || '', reportNumber: it.number || '' });
  if (itemType === 'preprint') Object.assign(z, { repository: it.publisher || '', archiveID: it.number || '' });
  return z;
}

/** The collection of that name (created when missing) -> its key. */
async function collectionKey(name) {
  const r = await call('/users/' + userID() + '/collections?limit=100&format=json');
  const hit = (r.json || []).find(c => c.data && c.data.name === name);
  if (hit) return hit.key;
  const c = await call('/users/' + userID() + '/collections', { method: 'POST', body: [{ name }] });
  const ok = c.json && c.json.successful && c.json.successful['0'];
  if (!ok) throw new Error('Zotero did not create the collection');
  return ok.key;
}

/**
 * Add items to the online library, in the collection `collection` (created when missing). An item whose DOI is already
 * in the library is not added again — that item is linked instead.
 * items: [{ ref, csl, abbreviation }] -> { links: { ref: { id, key, web } }, created, existing }
 */
async function add(items, collection) {
  if (!status().canWrite) throw new Error('This Zotero key may not write: allow write access at zotero.org/settings/keys.');
  const coll = collection ? await collectionKey(collection) : null;
  const links = {}, toCreate = [];
  let existing = 0;
  for (const x of items) {
    const doi = String(x.csl.DOI || '').toLowerCase();
    if (doi) {
      const r = await call('/users/' + userID() + '/items?limit=5&qmode=everything&format=json&q=' + encodeURIComponent(doi));
      const hit = (r.json || []).find(i => i.data && String(i.data.DOI || '').toLowerCase() === doi);
      if (hit) { links[x.ref] = link(hit.key); existing++; continue; }
    } else if (x.csl.title) {
      const norm = (t) => String(t || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const year = String(((x.csl.issued && x.csl.issued['date-parts'] || [])[0] || [])[0] || '');
      const r = await call('/users/' + userID() + '/items?limit=10&format=json&q=' + encodeURIComponent(String(x.csl.title).slice(0, 120)));
      const hit = (r.json || []).find(i => i.data && norm(i.data.title) === norm(x.csl.title) && (!year || String(i.data.date || '').includes(year)));
      if (hit) { links[x.ref] = link(hit.key); existing++; continue; }
    }
    toCreate.push(x);
  }
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 50) {
    const batch = toCreate.slice(i, i + 50);
    const r = await call('/users/' + userID() + '/items', {
      method: 'POST', headers: { 'Zotero-Write-Token': crypto.randomBytes(16).toString('hex') },
      body: batch.map(x => ({ ...zoteroFields(x.csl, x), collections: coll ? [coll] : [], tags: [{ tag: 'DTU Science Writer' }] })),
    });
    const ok = (r.json && r.json.successful) || {};
    for (const [idx, v] of Object.entries(ok)) { links[batch[+idx].ref] = link(v.key); created++; }
  }
  return { links, created, existing };
}

/** Update an online item from a CSL item (only the bibliographic fields; tags, notes, collections stay). */
async function update(key, csl, abbreviation) {
  if (!status().canWrite) throw new Error('This Zotero key may not write: allow write access at zotero.org/settings/keys.');
  const cur = await call('/users/' + userID() + '/items/' + encodeURIComponent(key) + '?format=json');
  const version = cur.json && cur.json.version;
  const fields = zoteroFields(csl, { abbreviation });
  delete fields.itemType;                                // the type is kept as it is in Zotero
  // fields the item type does not have would be refused: keep only those the item has
  const data = (cur.json && cur.json.data) || {};
  const patch = {};
  for (const [k, v] of Object.entries(fields)) if (k in data) patch[k] = v;
  await call('/users/' + userID() + '/items/' + encodeURIComponent(key), { method: 'PATCH', body: patch, headers: { 'If-Unmodified-Since-Version': String(version) } });
  return { ok: true };
}

module.exports = { setKey, clearKey, status, search, item, add, update, zoteroFields, userID };
