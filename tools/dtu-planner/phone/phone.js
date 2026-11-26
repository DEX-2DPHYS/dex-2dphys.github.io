/* DTU Planner — phone app.
   Reads the copy of the tree that DTU Planner on the PC keeps in Dropbox › Apps › DTU Planner › tree, and draws it here.
   It never writes the tree: every change (progress, ticked step, suggested task) and every note, photo or voice
   memo goes to requests/ as one file, and appears on the PC for approval. Unsent items wait on the phone. */
(function () {
  'use strict';
  const M = window.OTTModel;
  // Dropbox app key (public — the login uses PKCE, so there is no secret). Can also be set under Settings › Advanced.
  const DROPBOX_APP_KEY = '3glond2jy4nknsk';
  const VERSION = '1.2';

  // ---------- small helpers ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('dtup.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('dtup.' + k, JSON.stringify(v)); } catch (_) { /* full or blocked: the app still works this session */ } },
    del(k) { try { localStorage.removeItem('dtup.' + k); } catch (_) {} },
  };
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const E = M.escapeHtml;
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const asciiJson = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const device = () => /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone';
  class NotFound extends Error {}

  const P = {   // icon paths (24×24, stroke)
    due: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2.5h6"/>',
    tree: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.5 12h7M8 10.8c3-1 4-5.3 7.5-5.3M8 13.2c3 1 4 5.3 7.5 5.3"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 010 6.4M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>',
    sent: '<path d="M4 12.5l15.5-8-4 16-4-6.5z"/><path d="M11.5 14l8-9.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
    sync: '<path d="M19.5 9A8 8 0 006 6.5L4 9M4.5 15A8 8 0 0018 17.5l2-2.5"/><path d="M4 4.5V9h4.5M20 19.5V15h-4.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.6 2.3 2.7-.6.6 2.7 2.4 1.4-1 2.5 1 2.5-2.4 1.4-.6 2.7-2.7-.6L12 21.2l-1.6-2.3-2.7.6-.6-2.7-2.4-1.4 1-2.5-1-2.5 2.4-1.4.6-2.7 2.7.6z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    note: '<path d="M6 3.5h8.5l4 4V20a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"/><path d="M14 3.5V8h4.5M8.5 12h7M8.5 15.5h7"/>',
    camera: '<path d="M3.5 8.5a2 2 0 012-2h2l1.5-2h6l1.5 2h2a2 2 0 012 2v9a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    clip: '<path d="M20 11.5l-8.2 8.2a5 5 0 01-7-7L13 4.5a3.4 3.4 0 014.8 4.8l-8.2 8.2a1.7 1.7 0 01-2.4-2.4l7.5-7.5"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3.5-3.5a4 4 0 00-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 00-5.7 0l-3.5 3.5a4 4 0 005.7 5.7l1.5-1.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    folder: '<path d="M3.5 6.5a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2v8.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    steps: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><path d="M19 7v10M7 12h3M14 12h5"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  };
  const I = (n, c) => `<svg class="ic ${c || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

  // ---------- storage backends: Dropbox (app folder), or a local test server (?dev=1 on localhost) ----------
  const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const DEV = isLocal && (new URLSearchParams(location.search).has('dev') || sessionStorage.getItem('dtup.dev') === '1');
  if (DEV) sessionStorage.setItem('dtup.dev', '1');

  const Dev = {
    name: 'test folder',
    ready: () => true,
    async list(p) { const r = await fetch('/dev/list?path=' + encodeURIComponent(p)); if (r.status === 409) return []; if (!r.ok) throw new Error('list ' + r.status); return (await r.json()).entries; },
    async download(p, as) { const r = await fetch('/dev/file?path=' + encodeURIComponent(p), { cache: 'no-store' }); if (r.status === 409) throw new NotFound(p); if (!r.ok) throw new Error('download ' + r.status); return as === 'blob' ? r.blob() : r.text(); },
    async upload(p, body) { const r = await fetch('/dev/file?path=' + encodeURIComponent(p), { method: 'PUT', body }); if (!r.ok) throw new Error('upload ' + r.status); },
    async remove(p) { const r = await fetch('/dev/file?path=' + encodeURIComponent(p), { method: 'DELETE' }); if (r.status === 409) throw new NotFound(p); if (!r.ok) throw new Error('delete ' + r.status); },
  };

  const Dbx = {
    name: 'Dropbox',
    key() { return LS.get('appkey', '') || DROPBOX_APP_KEY; },
    redirect() { return location.origin + location.pathname.replace(/index\.html$/, ''); },   // must match the Redirect URI registered at Dropbox
    ready() { return !!LS.get('auth', null); },
    async login(codeMode) {
      const key = this.key();
      if (!key) throw new Error('No Dropbox app key yet — see Settings › Advanced.');
      const v = b64url(crypto.getRandomValues(new Uint8Array(48)));
      const ch = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
      const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
      LS.set('pkce', { v, state, codeMode: !!codeMode });
      const q = new URLSearchParams({ client_id: key, response_type: 'code', code_challenge: ch, code_challenge_method: 'S256', token_access_type: 'offline' });
      if (!codeMode) { q.set('redirect_uri', this.redirect()); q.set('state', state); }
      const url = 'https://www.dropbox.com/oauth2/authorize?' + q;
      if (codeMode) window.open(url, '_blank'); else location.href = url;
    },
    async finishLogin(code) {
      const p = LS.get('pkce', null);
      if (!p) throw new Error('Start the login again.');
      const body = new URLSearchParams({ code: String(code).trim(), grant_type: 'authorization_code', client_id: this.key(), code_verifier: p.v });
      if (!p.codeMode) body.set('redirect_uri', this.redirect());
      const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
      if (!r.ok) throw new Error('Dropbox did not accept the login (' + r.status + '). Try again.');
      const j = await r.json();
      LS.set('auth', { access: j.access_token, exp: Date.now() + (j.expires_in || 14400) * 1000, refresh: j.refresh_token, account: j.account_id });
      LS.del('pkce');
    },
    logout() { LS.del('auth'); },
    async token() {
      const a = LS.get('auth', null);
      if (!a) throw new Error('Not connected to Dropbox');
      if (Date.now() < a.exp - 60000) return a.access;
      const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: this.key() }) });
      if (!r.ok) { if (r.status === 400 || r.status === 401) { LS.del('auth'); render(); } throw new Error('The Dropbox login has expired — connect again.'); }
      const j = await r.json();
      a.access = j.access_token; a.exp = Date.now() + (j.expires_in || 14400) * 1000;
      LS.set('auth', a);
      return a.access;
    },
    async fail(r, what) {
      let t = ''; try { t = await r.text(); } catch (_) {}
      if (/missing_scope|required_scope/i.test(t)) throw new Error('Dropbox has not given this app all its permissions yet — Settings (⚙) › Log out, then connect again.');
      if (/invalid_access_token|expired_access_token/i.test(t)) throw new Error('The Dropbox login has expired — connect again.');
      throw new Error(what + ' failed (' + r.status + (t ? ': ' + t.slice(0, 120) : '') + ')');
    },
    async call(url, opts, retried) {
      const t = await this.token();
      const o = Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) });
      const r = await fetch(url, o);
      if (r.status === 401 && !retried) { const a = LS.get('auth', null); if (a) { a.exp = 0; LS.set('auth', a); } return this.call(url, opts, true); }
      return r;
    },
    async rpc(ep, arg) {
      const r = await this.call('https://api.dropboxapi.com/2/' + ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg) });
      if (r.status === 409) { const j = await r.json().catch(() => ({})); if (/not_found/.test(j.error_summary || '')) throw new NotFound(arg.path); throw new Error(j.error_summary || 'Dropbox error'); }
      if (!r.ok) await this.fail(r, 'Dropbox ' + ep);
      return r.json();
    },
    async list(p) {
      try {
        let j = await this.rpc('files/list_folder', { path: p });
        const out = j.entries.slice();
        while (j.has_more) { j = await this.rpc('files/list_folder/continue', { cursor: j.cursor }); out.push(...j.entries); }
        return out;
      } catch (e) { if (e instanceof NotFound) return []; throw e; }
    },
    async download(p, as) {
      const r = await this.call('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': asciiJson({ path: p }) } });
      if (r.status === 409) throw new NotFound(p);
      if (!r.ok) await this.fail(r, 'Dropbox download');
      return as === 'blob' ? r.blob() : r.text();
    },
    async upload(p, body) {
      const r = await this.call('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { 'Dropbox-API-Arg': asciiJson({ path: p, mode: 'overwrite', autorename: false, mute: true }), 'Content-Type': 'application/octet-stream' }, body });
      if (!r.ok) await this.fail(r, 'Dropbox upload');
    },
    async remove(p) { await this.rpc('files/delete_v2', { path: p }); },
  };
  const B = DEV ? Dev : Dbx;

  // ---------- unsent items (IndexedDB, so photos and recordings survive closing the app) ----------
  const idb = {
    db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((res, rej) => { const r = indexedDB.open('dtuplanner', 1); r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      return this.db;
    },
    async run(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('outbox', mode); const q = fn(t.objectStore('outbox')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); },
    all() { return this.run('readonly', s => s.getAll()); },
    put(x) { return this.run('readwrite', s => s.put(x)); },
    del(id) { return this.run('readwrite', s => s.delete(id)); },
  };

  // ---------- state ----------
  const st = {
    tree: LS.get('tree', null),          // { ed, settings, people, info, revs }
    der: null,
    pending: new Map(LS.get('pending', [])),   // "<id>.json" -> request, uploaded and waiting on the PC
    done: LS.get('done', []),             // recently handled on the PC
    outbox: [],                           // not uploaded yet: { id, req, blob }
    tab: LS.get('tab', 'due'),
    stack: [],                            // open task pages: node id or 'req:<id>'
    open: new Set(LS.get('open', [])),    // expanded nodes in the tree
    showDone: LS.get('showDone', false),
    dueMode: LS.get('dueMode', 'now'),     // Due tab: 'now' (what needs attention) or 'ahead' (everything dated, by week)
    aheadDays: LS.get('aheadDays', 30),
    syncing: false, flushing: false, error: null, noTree: false,
    lastSync: LS.get('lastSync', null),
    q: '',
    capAbout: null,
  };
  const ed = () => st.tree && st.tree.ed;
  function der() {
    if (!st.der && st.tree) st.der = M.derive(st.tree.ed, st.tree.settings);
    return st.der || new Map();
  }
  const D = (id) => der().get(id) || {};
  const cat = (key) => (st.tree && st.tree.settings.categories.find(c => c.key === key)) || { name: key || '', color: '#8a94a3' };
  const title = (n) => (n && n.title) || (n && n.kind === 'person' ? '(person)' : '(untitled)');
  const pathOf = (id, withSelf) => { const p = M.pathTitles(ed(), id); return (withSelf ? p : p.slice(0, -1)).join(' › '); };
  const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return dt.toLocaleDateString('en-GB', new Date().getFullYear() === y ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' }); };
  const fmtWhen = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  function dueLabel(d) {
    if (!d.deadline) return '';
    if (d.end) { if (d.done) return fmtDate(d.deadline) + '–' + fmtDate(d.end); if (d.now) return 'now'; if (d.ended) return 'ended'; if (d.days === 1) return 'tomorrow'; if (d.days < 7) return 'in ' + d.days + 'd'; return fmtDate(d.deadline) + '–' + fmtDate(d.end); }
    if (d.done) return fmtDate(d.deadline);
    if (d.days < 0) return (-d.days) + 'd late';
    if (d.days === 0) return 'today';
    if (d.days === 1) return 'tomorrow';
    if (d.days < 7) return 'in ' + d.days + 'd';
    return fmtDate(d.deadline);
  }
  const dueCls = (d) => d.overdue ? 'o' : (d.urg || 0) >= 3 ? 'u3' : (d.urg || 0) >= 2 ? 'u2' : '';
  const chip = (d, own) => (own === false || !d.deadline || (own !== true && !d.deadlineOwn)) ? '' : `<span class="due ${dueCls(d)}">${E(dueLabel(d))}</span>`;

  // ---------- requests waiting (sent or unsent) laid over the tree ----------
  function allPending() { return st.outbox.map(x => Object.assign({ _local: true }, x.req)).concat([...st.pending.values()]); }
  function overlay() {
    const O = { stage: new Map(), step: new Map(), kids: new Map(), caps: new Map(), byId: new Map() };
    const doneNode = new Map(st.done.filter(d => d.nodeId).map(d => [d.id, d.nodeId]));
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    const list = allPending();
    for (const r of list) O.byId.set(r.id, r);
    for (const r of list) {
      if (r.kind === 'stage') O.stage.set(r.node, r);
      else if (r.kind === 'step') O.step.set(r.node + ':' + r.step, r);
      else if (r.kind === 'node') {
        let key = r.parent;
        if (r.parentReq) key = O.byId.has(r.parentReq) ? 'req:' + r.parentReq : doneNode.get(r.parentReq) || null;
        if (key) push(O.kids, key, r);
      } else if (r.kind === 'capture' && r.about) push(O.caps, r.about, r);
    }
    return O;
  }

  function describe(r) {
    const e = ed(), n = e && r.node ? e.nodes[r.node] : null;
    if (r.kind === 'stage') return 'Progress: ' + (n ? title(n) : (r.base && r.base.title) || 'a task') + ' → ' + M.STAGES[r.stage];
    if (r.kind === 'step') return 'Step “' + ((r.base && r.base.title) || 'step') + '” → ' + (r.done ? 'done' : 'not done');
    if (r.kind === 'node') return 'New: ' + r.title + (r.deadline ? ' (due ' + fmtDate(r.deadline) + ')' : '');
    if (r.kind === 'capture') return (r.capture === 'photo' ? 'Photo' : r.capture === 'voice' ? 'Voice memo' : 'Note') + (r.text ? ': ' + String(r.text).split('\n')[0].slice(0, 80) : '');
    return r.kind;
  }

  // ---------- sync with Dropbox ----------
  const TREE_FILES = ['edition.json', 'settings.json', 'people.json', 'info.json'];
  async function sync(manual) {
    if (!B.ready()) return;
    if (st.syncing) return;
    st.syncing = true; renderTop();
    try {
      await flush();
      const entries = (await B.list('/tree')).filter(e => e['.tag'] === 'file');
      const revs = Object.fromEntries(entries.map(e => [e.name, e.rev]));
      st.noTree = !revs['edition.json'];
      // Dropbox creates the app folder (Apps › DTU Planner) only when the app first writes something; the PC
      // looks for that folder, so say hello once — this makes the folder appear on the PC.
      if (st.noTree) {
        // what the app can see in its folder — shown on the waiting screen, so a problem can be seen from the phone
        let root = (await B.list('')).map(e => e.name + (e['.tag'] === 'folder' ? '/' : ''));
        if (!root.includes('phone.json')) {
          await B.upload('/phone.json', new Blob([JSON.stringify({ type: 'dtuplanner-phone', device: device(), connected: new Date().toISOString(), version: VERSION }, null, 1)], { type: 'application/json' }));
          root = (await B.list('')).map(e => e.name + (e['.tag'] === 'folder' ? '/' : ''));
        }
        st.rootSeen = root;
        LS.set('hello', true);
      }
      const cur = (st.tree && st.tree.revs) || {};
      if (!st.noTree && TREE_FILES.some(n => revs[n] !== cur[n])) {
        const got = await Promise.all(TREE_FILES.map(n => revs[n] ? B.download('/tree/' + n).then(t => JSON.parse(t)) : Promise.resolve(null)));
        const [e, settings, people, info] = got;
        M.validate(e);
        st.tree = { ed: e, settings: Object.assign(M.defaultSettings(), settings || {}), people: people || { people: {} }, info: info || {}, revs };
        st.der = null;
        LS.set('tree', st.tree);
      }
      const reqs = (await B.list('/requests')).filter(e => e['.tag'] === 'file' && e.name.endsWith('.json'));
      const names = new Set(reqs.map(e => e.name));
      for (const k of [...st.pending.keys()]) if (!names.has(k)) st.pending.delete(k);
      for (const e of reqs) if (!st.pending.has(e.name)) { try { st.pending.set(e.name, JSON.parse(await B.download('/requests/' + e.name))); } catch (_) {} }
      LS.set('pending', [...st.pending]);
      const done = (await B.list('/requests/done')).filter(e => e['.tag'] === 'file' && e.name.endsWith('.json'))
        .sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified))).slice(0, 25);
      const known = new Map(st.done.map(d => [d.name, d]));
      const next = [];
      for (const e of done) {
        if (known.has(e.name)) { next.push(known.get(e.name)); continue; }
        try { const r = JSON.parse(await B.download('/requests/done/' + e.name)); next.push({ name: e.name, id: r.id, kind: r.kind, text: describe(r), status: (r.result && r.result.status) || 'handled', at: (r.result && r.result.at) || e.server_modified, nodeId: r.result && r.result.nodeId }); } catch (_) {}
      }
      st.done = next.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      LS.set('done', st.done);
      st.lastSync = new Date().toISOString(); LS.set('lastSync', st.lastSync);
      st.error = null;
      if (manual) toast('Up to date');
    } catch (e) {
      st.error = navigator.onLine === false ? 'offline' : e.message;
      if (manual) toast(st.error === 'offline' ? 'No network — showing the last copy' : 'Could not update: ' + e.message);
    } finally {
      st.syncing = false;
      render();
    }
  }

  /** Queue a request (and its photo / recording) and upload when there is network. */
  async function send(req, blob, ext) {
    req.type = 'dtuplanner-request'; req.v = 1;
    req.id = req.id || newId();
    req.created = new Date().toISOString();
    req.device = device();
    req.edition = (st.tree && (st.tree.info.edition || st.tree.ed.id)) || '';
    if (blob) { req.file = req.id + (ext || ''); req.mime = blob.type || ''; }
    const item = { id: req.id, req, blob: blob || null };
    st.outbox.push(item);
    try { await idb.put(item); } catch (_) { /* no IndexedDB: kept in memory until uploaded */ }
    render();
    flush().then(render);
    return req;
  }
  async function flush() {
    if (st.flushing || !B.ready() || !st.outbox.length) return;
    st.flushing = true;
    try {
      for (const it of st.outbox.slice()) {
        try {
          if (it.blob) await B.upload('/requests/' + it.req.file, it.blob);
          await B.upload('/requests/' + it.id + '.json', new Blob([JSON.stringify(it.req, null, 1)], { type: 'application/json' }));
          st.outbox = st.outbox.filter(x => x !== it);
          try { await idb.del(it.id); } catch (_) {}
          st.pending.set(it.id + '.json', it.req);
          LS.set('pending', [...st.pending]);
        } catch (e) { it.err = e.message; if (navigator.onLine === false) break; }
      }
    } finally { st.flushing = false; }
  }
  /** Take back a request before the PC has handled it. */
  async function withdraw(id, quiet) {
    const ob = st.outbox.find(x => x.id === id);
    if (ob) { st.outbox = st.outbox.filter(x => x !== ob); try { await idb.del(id); } catch (_) {} render(); return true; }
    const name = id + '.json', r = st.pending.get(name);
    if (!r) return false;
    try {
      await B.remove('/requests/' + name);
      if (r.file) await B.remove('/requests/' + r.file).catch(() => {});
    } catch (e) {
      if (e instanceof NotFound) { if (!quiet) toast('Already handled on the PC'); st.pending.delete(name); sync(); return false; }
      toast('Could not take it back: ' + e.message); return false;
    }
    st.pending.delete(name); LS.set('pending', [...st.pending]);
    if (!quiet) toast('Taken back');
    render();
    return true;
  }

  // ---------- rendering ----------
  function render() { renderTop(); renderTabs(); renderView(); if (st.stack.length) renderSheet(); }

  function renderTop() {
    $('#bsearch').innerHTML = I('search'); $('#bsync').innerHTML = I('sync', st.syncing ? 'spin' : ''); $('#bmenu').innerHTML = I('gear');
    const t = st.tree;
    let sub = '';
    if (!B.ready()) sub = 'Not connected';
    else if (t) sub = E(t.info.title || t.ed.title || '') + (t.info.editionModified ? ' · saved ' + E(fmtWhen(t.info.editionModified)) : '');
    if (st.error === 'offline') sub += ' · offline';
    else if (st.error) sub += ' · <span class="bad">not updated</span>';
    if (DEV) sub += ' · test folder';
    $('#sub').innerHTML = sub;
  }

  function renderTabs() {
    const n = st.outbox.length + st.pending.size;
    const names = { due: ['due', 'Due'], tree: ['tree', 'Tree'], people: ['people', 'People'], sent: ['sent', 'Sent'] };
    for (const b of $$('#tabs button')) {
      const k = b.dataset.tab;
      if (k === 'add') { b.innerHTML = I('plus'); continue; }
      b.innerHTML = I(names[k][0]) + '<span>' + names[k][1] + '</span>' + (k === 'sent' && n ? `<i class="badge">${n}</i>` : '');
      b.classList.toggle('on', st.tab === k);
    }
  }

  function keepScroll(fn) { const v = $('#view'); const y = v.scrollTop; fn(); v.scrollTop = y; }

  function renderView() {
    const v = $('#view');
    if (!B.ready()) { v.innerHTML = loginHtml(); return; }
    if (st.tab === 'add') { v.innerHTML = captureHtml(); return; }
    if (st.tab === 'sent') { keepScroll(() => { v.innerHTML = sentHtml(); }); return; }
    if (!st.tree) {
      v.innerHTML = `<div class="empty">${st.noTree
        ? `${I('tree', 'big')}<h2>Connected — waiting for the PC</h2>${st.error && st.error !== 'offline' ? `<p class="bad">${E(st.error)}</p>` : ''}<p>Open DTU Planner on your PC (restart it if it was open). Within a minute or two it finds the folder Dropbox › Apps › DTU Planner and puts a copy of your tree there; then tap ↻ here.</p><p class="hint">You can already send notes, photos and voice memos with the + button.</p><p class="diag">Version ${VERSION} · checked ${E(fmtWhen(st.lastSync) || 'not yet')}<br>In your Dropbox folder Apps › DTU Planner: ${E((st.rootSeen || []).join(', ') || '(nothing yet)')}</p>`
        : `<span class="spinner"></span><p>Loading your tree…</p>`}</div>`;
      return;
    }
    if (st.q) { keepScroll(() => { v.innerHTML = searchHtml(st.q); }); return; }
    keepScroll(() => { v.innerHTML = st.tab === 'tree' ? treeHtml() : st.tab === 'people' ? peopleHtml() : dueHtml(); });
  }

  // a task row: progress ring, title, path, due chip, pending marks
  function ring(p, pending) {
    const r = 8, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, p || 0));
    return `<svg class="ring${pending ? ' pend' : ''}" viewBox="0 0 22 22"><circle cx="11" cy="11" r="${r}" class="rb"/>${f > 0 ? `<circle cx="11" cy="11" r="${r}" class="rf" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 11 11)"/>` : ''}${f >= 0.999 ? '<path d="M7 11.3l2.7 2.7L15 8.6" class="rk"/>' : ''}</svg>`;
  }
  function rowHtml(id, o) {
    o = o || {};
    const e = ed(), n = e.nodes[id], d = D(id), O = o.O || overlay();
    const pst = O.stage.get(id);
    const prog = pst ? pst.stage / M.STAGE_MAX : d.progress;
    const lead = n.kind === 'info' ? `<span class="kicon">${I('info')}</span>` : n.kind === 'person' ? `<span class="kicon av">${E(initials(title(n)))}</span>` : (n.kind === 'group' || n.kind === 'category') ? `<span class="kicon">${I('folder')}</span>` : ring(prog, !!pst);
    const extra = [];
    if (n.attachments && n.attachments.length) extra.push(I('clip', 'mini'));
    if (d.tl) extra.push(`<span class="tlc">${I('steps', 'mini')}${d.tl.done}/${d.tl.n}</span>`);
    const kidsPend = (O.kids.get(id) || []).length, capsPend = (O.caps.get(id) || []).length;
    if (pst || kidsPend || capsPend) extra.push(`<span class="pend">${I('clock', 'mini')}${(pst ? 1 : 0) + kidsPend + capsPend}</span>`);
    const tw = o.fold != null ? `<button class="fold${o.fold ? ' open' : ''}" data-fold="${E(id)}" aria-label="Fold">${I('chev')}</button>` : (o.indent != null ? '<span class="fold sp"></span>' : '');
    return `<div class="row${d.done && !n.kind ? ' done' : ''}${n.kind ? ' k-' + n.kind : ''}" data-open="${E(id)}" style="${o.indent != null ? '--ind:' + o.indent : ''}">${tw}<span class="cbar" style="background:${cat(d.cat).color}"></span>${lead}<span class="tt"><b>${E(title(n))}</b>${o.path ? `<small>${E(o.path === true ? pathOf(id) : o.path)}</small>` : ''}</span>${extra.join('')}${o.noDue ? '' : chip(d, o.own)}</div>`;
  }
  const initials = (s) => String(s || '?').split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  function pendRowHtml(r, indent) {
    const kids = overlay().kids.get('req:' + r.id) || [];
    return `<div class="row ghost" data-open="req:${E(r.id)}" style="${indent != null ? '--ind:' + indent : ''}"><span class="fold sp"></span><span class="kicon">${I('plus')}</span><span class="tt"><b>${E(r.title)}</b><small>suggested · ${r._local ? 'not sent yet' : 'waiting for approval'}${kids.length ? ' · ' + kids.length + ' below' : ''}</small></span>${r.deadline ? `<span class="due">${E(fmtDate(r.deadline))}</span>` : ''}</div>`;
  }

  function dueSwitch() {
    return `<div class="seg seg2"><button data-due="now" class="${st.dueMode !== 'ahead' ? 'on' : ''}">Now</button><button data-due="ahead" class="${st.dueMode === 'ahead' ? 'on' : ''}">Ahead</button></div>`;
  }
  const mondayOf = (ds) => { const [y, m, d] = ds.split('-').map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return M.todayStr(t); };
  const wd = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' }); };
  /** Everything with a date in the coming days (deadlines, periods, timeline steps), by week, coloured by urgency. */
  function aheadHtml() {
    const e = ed(), days = st.aheadDays, O = overlay();
    const items = [];
    for (const [id, d] of der()) {
      const n = e.nodes[id];
      if (!n || n.kind === 'root' || n.kind === 'info' || d.done) continue;
      if (n.deadline && !(d.end && d.ended)) {
        const dd = M.daysUntil(n.deadline);
        if (dd <= days) items.push({ id, date: n.deadline, days: dd, cls: dueCls(d), d, kind: d.end ? 'period' : 'deadline' });
      }
      for (const sp of n.timeline || []) {
        if (sp.done || !sp.date) continue;
        const pr = O.step.get(id + ':' + sp.id);
        if (pr && pr.done) continue;
        const dd = M.daysUntil(sp.date);
        if (dd <= days) items.push({ id, step: sp, date: sp.date, days: dd, cls: dd < 0 ? 'o' : dd <= M.FINAL_DAYS ? 'u3' : dd <= 7 ? 'u2' : '', d, kind: 'step' });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'step') - (b.kind === 'step'));
    const thisMon = mondayOf(M.todayStr()), nextMon = M.addDays(thisMon, 7);
    const groups = new Map();
    for (const it of items) {
      let key;
      if (it.days < 0 && it.kind !== 'period') key = '0|Overdue';
      else { const mon = it.days < 0 ? thisMon : mondayOf(it.date); const sun = M.addDays(mon, 6); key = '1' + mon + '|' + (mon === thisMon ? 'This week' : mon === nextMon ? 'Next week' : 'Week ' + M.isoWeek(mon) + ' · ' + fmtDate(mon) + ' – ' + fmtDate(sun)); }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const chipTxt = (it) => it.kind === 'period' && it.d.now ? 'now' : it.days < 0 ? (-it.days) + 'd late' : it.days === 0 ? 'today' : it.days === 1 ? 'tomorrow' : wd(it.date) + ' ' + fmtDate(it.date);
    const row = (it) => {
      const n = e.nodes[it.id];
      const icon = it.kind === 'step' ? I('steps') : it.kind === 'period' ? I('due') : ring(it.d.progress, !!O.stage.get(it.id));
      const t = it.kind === 'step' ? M.stepTitle(it.step) : title(n);
      const sub = it.kind === 'step' ? 'step towards ' + title(n) : it.kind === 'period' ? fmtDate(n.deadline) + ' – ' + fmtDate(it.d.end) + (pathOf(it.id) ? ' · ' + pathOf(it.id) : '') : pathOf(it.id);
      const flag = (it.d.crit || 0) >= 3 ? '<span class="crit" title="critical">!</span>' : '';
      return `<div class="row" data-open="${E(it.id)}"><span class="cbar" style="background:${cat(it.d.cat).color}"></span><span class="kicon">${icon}</span><span class="tt"><b>${flag}${E(t)}</b><small>${E(sub)}</small></span><span class="due ${it.cls}">${E(chipTxt(it))}</span></div>`;
    };
    let h = `<div class="chips">${[[14, '2 weeks'], [30, 'Month'], [90, '3 months']].map(([v, l]) => `<button data-range="${v}" class="${st.aheadDays === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    h += `<p class="legend"><span class="due u2">urgent</span><span class="due u3">very urgent</span><span class="due o">overdue</span><span class="crit">!</span> critical</p>`;
    for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) h += `<h3>${E(key.split('|')[1])}<span>${list.length}</span></h3><div class="card">${list.map(row).join('')}</div>`;
    if (!items.length) h += `<div class="empty">${I('check', 'big')}<p>Nothing dated in the next ${days} days.</p></div>`;
    // urgent by hand, but no date anywhere
    const undated = [];
    for (const [id, d] of der()) { const n = e.nodes[id]; if (n && !n.kind && !d.done && !d.deadline && (n.urg || 0) >= 2) undated.push(id); }
    if (undated.length) h += `<h3>Marked urgent, no date<span>${undated.length}</span></h3><div class="card">${undated.map(id => rowHtml(id, { path: true, O })).join('')}</div>`;
    return h;
  }

  function dueHtml() {
    if (st.dueMode === 'ahead') return dueSwitch() + aheadHtml();
    const e = ed(), s = st.tree.settings;
    const items = M.dueItems(e, s);
    const over = items.filter(i => i.overdue), week = items.filter(i => !i.overdue && i.days <= 7), later = items.filter(i => !i.overdue && i.days > 7);
    const hot = [];
    for (const [id, d] of der()) { const n = e.nodes[id]; if (d.leaf && !d.done && (d.crit || 0) >= 3 && (d.urg || 0) >= 2 && !items.some(i => i.id === id && !i.step)) hot.push(id); }
    const O = overlay();
    const itemRow = (it) => {
      if (!it.step) return rowHtml(it.id, { path: true, O, own: true });
      const d = D(it.id), n = e.nodes[it.id];
      return `<div class="row step" data-open="${E(it.id)}"><span class="cbar" style="background:${cat(d.cat).color}"></span><span class="kicon">${I('steps')}</span><span class="tt"><b>${E(it.title.split(' — ')[0])}</b><small>step towards ${E(title(n))}</small></span><span class="due ${it.overdue ? 'o' : it.urg >= 3 ? 'u3' : 'u2'}">${E(it.days < 0 ? (-it.days) + 'd late' : it.days === 0 ? 'today' : it.days === 1 ? 'tomorrow' : fmtDate(it.deadline))}</span></div>`;
    };
    const sec = (t, arr, f) => arr.length ? `<h3>${t}<span>${arr.length}</span></h3><div class="card">${arr.map(f).join('')}</div>` : '';
    let open = 0, tasks = 0;
    for (const d of der().values()) if (d.leaf) { tasks++; if (!d.done) open++; }
    const h = sec('Overdue', over, itemRow) + sec('Due within 7 days', week, itemRow) + sec('Urgent &amp; critical', hot, id => rowHtml(id, { path: true, O })) + sec('Coming up', later, itemRow);
    return dueSwitch() + `<div class="sum"><div><b>${over.length}</b><span>overdue</span></div><div><b>${week.length}</b><span>this week</span></div><div><b>${open}</b><span>open of ${tasks}</span></div></div>` + (h || `<div class="empty">${I('check', 'big')}<p>Nothing overdue or coming up soon.</p></div>`);
  }

  function treeHtml() {
    const e = ed(), O = overlay();
    let h = `<div class="tbar"><label class="sw"><input type="checkbox" id="showdone" ${st.showDone ? 'checked' : ''}><span></span> Show finished</label><button class="lnk" data-act="foldall">Fold all</button></div>`;
    const walk = (id, depth) => {
      const n = e.nodes[id], d = D(id);
      if (!st.showDone && d.done && !n.kind) return '';
      const kids = n.children.filter(c => st.showDone || !(D(c).done && !e.nodes[c].kind));
      const pend = O.kids.get(id) || [];
      const isOpen = st.open.has(id);
      let s = rowHtml(id, { indent: depth, fold: kids.length || pend.length ? isOpen : null, O });
      if (isOpen) {
        for (const c of kids) s += walk(c, depth + 1);
        for (const r of pend) s += pendTree(r, depth + 1, O);
      }
      return s;
    };
    const pendTree = (r, depth, O) => pendRowHtml(r, depth) + (O.kids.get('req:' + r.id) || []).map(k => pendTree(k, depth + 1, O)).join('');
    for (const cid of e.nodes.root.children) {
      const c = e.nodes[cid], d = D(cid);
      if (!c) continue;
      const isOpen = st.open.has(cid) || !st.open.has('_init');
      const kids = c.children.filter(k => st.showDone || !(D(k).done && !e.nodes[k].kind));
      const pend = O.kids.get(cid) || [];
      h += `<div class="cat" style="--c:${cat(c.cat).color}"><div class="chead" data-fold="${E(cid)}"><span class="cdot"></span><b>${E(c.title)}</b><span class="cpct">${d.progress != null ? Math.round(d.progress * 100) + '%' : ''}</span><button class="lnk" data-open="${E(cid)}">Open</button>${I('chev', 'cchev' + (isOpen ? ' open' : ''))}</div>`;
      if (isOpen) h += `<div class="card">${kids.map(k => walk(k, 0)).join('') + pend.map(r => pendTree(r, 0, O)).join('') || '<div class="none">Nothing open here</div>'}</div>`;
      h += '</div>';
    }
    return h;
  }

  function peopleHtml() {
    const e = ed(), O = overlay();
    const pc = e.nodes[M.PEOPLE_CAT];
    if (!pc) return '<div class="empty"><p>No People category.</p></div>';
    const ownedBy = new Map();
    for (const n of Object.values(e.nodes)) if (n.owner && !n.kind && !D(n.id).done) { if (!ownedBy.has(n.owner)) ownedBy.set(n.owner, []); ownedBy.get(n.owner).push(n.id); }
    let h = '';
    for (const gid of pc.children) {
      const g = e.nodes[gid];
      if (!g) continue;
      const persons = g.children.map(id => e.nodes[id]).filter(Boolean);
      h += `<h3>${E(title(g))}<span>${persons.length}</span></h3><div class="card">`;
      h += persons.map(p => {
        const open = p.children.filter(c => !D(c).done).length + ((p.person && ownedBy.get(p.person)) || []).length;
        return `<div class="row k-person" data-open="${E(p.id)}"><span class="kicon av">${E(initials(title(p)))}</span><span class="tt"><b>${E(title(p))}</b>${open ? `<small>${open} open</small>` : ''}</span>${(O.kids.get(p.id) || []).length ? `<span class="pend">${I('clock', 'mini')}</span>` : ''}${I('chev', 'go')}</div>`;
      }).join('') || '<div class="none">Nobody yet</div>';
      h += '</div>';
    }
    return h;
  }

  function searchHtml(q) {
    const e = ed(), k = q.trim().toLowerCase(), out = [];
    for (const n of Object.values(e.nodes)) {
      if (n.kind === 'root') continue;
      const hay = (n.title + '\n' + (n.notes || '')).toLowerCase();
      if (hay.includes(k)) out.push(n.id);
      if (out.length > 80) break;
    }
    const O = overlay();
    out.sort((a, b) => (D(a).done - D(b).done) || title(e.nodes[a]).localeCompare(title(e.nodes[b])));
    return `<h3>Search “${E(q)}”<span>${out.length}</span></h3><div class="card">${out.map(id => rowHtml(id, { path: true, O })).join('') || '<div class="none">No match</div>'}</div>`;
  }

  function sentHtml() {
    const loc = st.outbox, up = [...st.pending.values()];
    const line = (r, state) => `<div class="row sentrow"><span class="kicon">${I(r.kind === 'capture' ? (r.capture === 'photo' ? 'camera' : r.capture === 'voice' ? 'mic' : 'note') : r.kind === 'node' ? 'plus' : 'check')}</span><span class="tt"><b>${E(describe(r))}</b><small>${state} · ${E(fmtWhen(r.created))}</small></span><button class="lnk" data-withdraw="${E(r.id)}">Take back</button></div>`;
    let h = `<p class="intro">What you change or send here goes to the PC as a suggestion. It is in the tree only after you approve it there (the bar “From your phone” in DTU Planner).</p>`;
    if (loc.length) h += `<h3>Not sent yet<span>${loc.length}</span></h3><div class="card">${loc.map(x => line(x.req, x.err ? 'waiting for network' : 'sending…')).join('')}</div><button class="wide" data-act="flush">${I('sync')} Send now</button>`;
    h += `<h3>Waiting for approval on the PC<span>${up.length}</span></h3><div class="card">${up.map(r => line(r, 'sent')).join('') || '<div class="none">Nothing waiting</div>'}</div>`;
    if (st.done.length) h += `<h3>Handled on the PC</h3><div class="card">${st.done.map(d => `<div class="row sentrow"><span class="kicon st-${E(d.status)}">${I(d.status === 'approved' ? 'check' : 'x')}</span><span class="tt"><b>${E(d.text)}</b><small>${E(d.status)} · ${E(fmtWhen(d.at))}</small></span></div>`).join('')}</div>`;
    return h;
  }

  function captureHtml() {
    const e = ed(), about = st.capAbout && e && e.nodes[st.capAbout] ? st.capAbout : null;
    return `<div class="capwrap">
      <h2>Capture</h2><p class="intro">Goes to your PC as a note to review — attach it to a task, make it a task, or dismiss it there.</p>
      <div class="capbtns">
        <button data-cap="note">${I('note')}<b>Note</b><span>text to yourself</span></button>
        <button data-cap="photo">${I('camera')}<b>Photo</b><span>whiteboard, paper, slide</span></button>
        <button data-cap="voice">${I('mic')}<b>Voice memo</b><span>record a message</span></button>
      </div>
      <button class="about" data-act="about">${I('tree')}<span>${about ? 'About: <b>' + E(title(e.nodes[about])) + '</b>' : 'About a task? <i>(optional)</i>'}</span>${about ? `<i data-act="noabout" class="clr">${I('x')}</i>` : I('chev')}</button>
      <button class="lib" data-cap="library">${I('folder')} Choose a photo from the library</button>
    </div>`;
  }

  // ---------- task page ----------
  function openNode(id) { st.stack.push(id); renderSheet(); const s = $('#sheet'); s.hidden = false; requestAnimationFrame(() => s.classList.add('in')); }
  function back() {
    st.stack.pop();
    if (!st.stack.length) { const s = $('#sheet'); s.classList.remove('in'); setTimeout(() => { if (!st.stack.length) { s.hidden = true; s.innerHTML = ''; } }, 220); return; }
    renderSheet();
  }

  function renderSheet() {
    const s = $('#sheet');
    const key = st.stack[st.stack.length - 1];
    if (!key) return;
    const y = s.querySelector('.sbody') ? s.querySelector('.sbody').scrollTop : 0;
    s.innerHTML = key.startsWith('req:') ? reqPage(key.slice(4)) : nodePage(key);
    const b = s.querySelector('.sbody'); if (b && s.dataset.key === key) b.scrollTop = y;
    s.dataset.key = key;
  }

  function nodePage(id) {
    const e = ed();
    if (!e || !e.nodes[id]) return `<header class="sh"><button class="hb" data-act="back">${I('back')}</button><div class="crumbs"></div></header><div class="sbody"><div class="empty"><p>This item is no longer in the tree.</p></div></div>`;
    const n = e.nodes[id], d = D(id), O = overlay();
    const crumbs = [];
    let p = e.nodes[n.parent];
    while (p && p.kind !== 'root') { crumbs.unshift(`<button data-open="${E(p.id)}">${E(title(p))}</button>`); p = e.nodes[p.parent]; }
    const kindName = { category: 'Category', group: M.inPeople(e, id) ? 'Group' : 'Subcategory', person: 'Person', info: 'Information note' }[n.kind] || (d.leaf ? 'Task' : 'Task with subtasks');
    let h = `<header class="sh"><button class="hb" data-act="back">${I('back')}</button><div class="crumbs">${crumbs.join('<span>›</span>')}</div></header><div class="sbody">`;
    h += `<div class="head" style="--c:${cat(d.cat).color}"><small>${E(kindName)}</small><h1>${E(title(n))}</h1><div class="meta">${chip(d, true)}${d.deadline && d.deadlineOwn ? `<span>${E(d.end ? fmtDate(n.deadline) + ' – ' + fmtDate(d.end) : 'Deadline ' + fmtDate(n.deadline))}</span>` : d.deadline ? `<span class="hint">inherits ${E(fmtDate(d.deadline))}</span>` : ''}${d.crit ? `<span class="tag">critical ${d.crit}</span>` : ''}${d.urg ? `<span class="tag u">urgent ${d.urg}</span>` : ''}</div></div>`;
    // progress (tasks without subtasks)
    if (!n.kind && d.leaf) {
      const pst = O.stage.get(id);
      const curS = pst ? pst.stage : n.stage;
      h += `<section><h4>Progress</h4><div class="seg">${M.STAGES.map((t, i) => `<button data-stage="${i}" class="${i === curS ? 'on' : ''}${pst && i === n.stage ? ' was' : ''}">${E(t)}</button>`).join('')}</div>${pst ? `<p class="pendnote">${I('clock', 'mini')} ${E(M.STAGES[n.stage])} → ${E(M.STAGES[pst.stage])}: ${pst._local ? 'not sent yet' : 'waiting for approval on the PC'} <button class="lnk" data-withdraw="${E(pst.id)}">Take back</button></p>` : ''}</section>`;
    } else if (!n.kind && d.progress != null) {
      h += `<section><h4>Progress</h4><div class="bar"><i style="width:${Math.round(d.progress * 100)}%"></i></div><p class="hint">${Math.round(d.progress * 100)}% — from its subtasks</p></section>`;
    }
    // timeline
    if (n.timeline && n.timeline.length && n.kind !== 'info') {
      h += `<section><h4>Timeline</h4><div class="card">${M.sortSteps(n.timeline).map(s => {
        const pr = O.step.get(id + ':' + s.id);
        const done = pr ? pr.done : s.done;
        const days = M.daysUntil(s.date);
        const todos = (s.todos || []).map(t => `<div class="todo${t.done ? ' done' : ''}">${E(t.text)}</div>`).join('');
        return `<div class="step${done ? ' done' : ''}${pr ? ' pend' : ''}"><button class="tick" data-step="${E(s.id)}" aria-label="Done">${done ? I('check') : ''}</button><div class="tt"><b>${E(M.stepTitle(s))}</b><small>${E(fmtDate(s.date))}${!done && days < 0 ? ' · <span class="bad">' + (-days) + 'd late</span>' : !done && days <= 7 ? ' · ' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + 'd') : ''}${pr ? ' · ' + (pr._local ? 'not sent yet' : 'waiting for approval') + ` <button class="lnk" data-withdraw="${E(pr.id)}">Take back</button>` : ''}</small>${todos}</div></div>`;
      }).join('')}</div></section>`;
    }
    if (n.notes && n.notes.trim()) h += `<section><h4>Notes</h4><div class="notes">${linkify(n.notes)}</div></section>`;
    if (n.attachments && n.attachments.length) h += `<section><h4>Files &amp; links</h4><div class="card">${n.attachments.map(a => a.kind === 'url' ? `<a class="row att" href="${E(a.url)}" target="_blank" rel="noopener">${I('link')}<span class="tt"><b>${E(a.name)}</b></span></a>` : `<div class="row att">${I(a.kind === 'folder' ? 'folder' : 'clip')}<span class="tt"><b>${E(a.name)}</b><small>on the PC</small></span></div>`).join('')}</div></section>`;
    if (n.kind === 'person' && n.person && st.tree.people.people[n.person]) {
      const pp = st.tree.people.people[n.person];
      const owned = Object.values(e.nodes).filter(x => x.owner === n.person && !x.kind && !D(x.id).done).map(x => x.id);
      if (pp.email || pp.org) h += `<section><h4>Contact</h4><div class="notes">${pp.org ? E(pp.org) + '<br>' : ''}${pp.email ? `<a href="mailto:${E(pp.email)}">${E(pp.email)}</a>` : ''}</div></section>`;
      if (owned.length) h += `<section><h4>Responsible for</h4><div class="card">${owned.map(x => rowHtml(x, { path: true, O })).join('')}</div></section>`;
    }
    // children + suggestions waiting
    const kids = n.children.filter(c => e.nodes[c]);
    const pend = O.kids.get(id) || [];
    if (kids.length || pend.length) {
      const open = kids.filter(c => !(D(c).done && !e.nodes[c].kind)), fin = kids.length - open.length;
      h += `<section><h4>${n.kind === 'category' || n.kind === 'group' ? 'Inside' : 'Subtasks'}</h4><div class="card">${open.map(c => rowHtml(c, { O })).join('')}${pend.map(r => pendRowHtml(r)).join('')}${fin ? `<details class="fin"><summary>${fin} finished</summary>${kids.filter(c => !open.includes(c)).map(c => rowHtml(c, { O })).join('')}</details>` : ''}</div></section>`;
    }
    const caps = O.caps.get(id) || [];
    if (caps.length) h += `<section><h4>Sent about this</h4><div class="card">${caps.map(r => `<div class="row sentrow"><span class="kicon">${I(r.capture === 'photo' ? 'camera' : r.capture === 'voice' ? 'mic' : 'note')}</span><span class="tt"><b>${E(describe(r))}</b><small>${r._local ? 'not sent yet' : 'waiting for approval'}</small></span><button class="lnk" data-withdraw="${E(r.id)}">Take back</button></div>`).join('')}</div></section>`;
    const kind = M.childKind(e, id);
    const canAdd = n.kind !== 'info' && n.kind !== 'root';
    h += `<div class="acts">${canAdd ? `<button class="primary" data-act="suggest" data-under="${E(id)}">${I('plus')} Suggest ${kind === 'group' ? 'a group' : kind === 'person' ? 'a person' : n.kind === 'category' || n.kind === 'group' ? 'a task here' : 'a subtask'}</button>` : ''}<button data-act="capabout" data-about="${E(id)}">${I('note')} Note, photo or voice about this</button></div>`;
    return h + '</div>';
  }

  function reqPage(rid) {
    const O = overlay(), r = O.byId.get(rid);
    if (!r) return `<header class="sh"><button class="hb" data-act="back">${I('back')}</button><div class="crumbs"></div></header><div class="sbody"><div class="empty"><p>This suggestion has been handled on the PC.</p></div></div>`;
    const e = ed(), under = r.parent && e && e.nodes[r.parent] ? pathOf(r.parent, true) : (r.basePath || []).join(' › ');
    const kids = O.kids.get('req:' + rid) || [];
    return `<header class="sh"><button class="hb" data-act="back">${I('back')}</button><div class="crumbs"><span>${E(under || 'suggested')}</span></div></header><div class="sbody">
      <div class="head ghost"><small>Suggested · ${r._local ? 'not sent yet' : 'waiting for approval on the PC'}</small><h1>${E(r.title)}</h1><div class="meta">${r.deadline ? `<span class="due">${E(fmtDate(r.deadline))}</span><span>Deadline ${E(fmtDate(r.deadline))}</span>` : '<span class="hint">no deadline</span>'}</div></div>
      ${r.notes ? `<section><h4>Notes</h4><div class="notes">${linkify(r.notes)}</div></section>` : ''}
      ${kids.length ? `<section><h4>Suggested below it</h4><div class="card">${kids.map(k => pendRowHtml(k)).join('')}</div></section>` : ''}
      <p class="intro">You can suggest subtasks under it now. On the PC they are approved together with it, or each on its own.</p>
      <div class="acts"><button class="primary" data-act="suggest" data-underreq="${E(rid)}">${I('plus')} Suggest a subtask</button><button class="danger" data-withdraw="${E(rid)}" data-andback="1">${I('x')} Take back</button></div></div>`;
  }

  const linkify = (t) => E(t).replace(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');

  // ---------- forms (bottom sheets) ----------
  function modal(html, onReady) {
    const m = $('#modal');
    m.innerHTML = `<div class="mbg" data-act="mclose"></div><div class="mdl">${html}</div>`;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('in'));
    if (onReady) onReady(m.querySelector('.mdl'));
    return m.querySelector('.mdl');
  }
  function closeModal() {
    const m = $('#modal');
    if (voice.rec && voice.rec.state === 'recording') { voice.cancelled = true; voice.rec.stop(); }
    m.classList.remove('in');
    setTimeout(() => { if (!m.classList.contains('in')) { m.hidden = true; m.innerHTML = ''; } }, 200);
  }

  function suggestForm(under, underReq) {
    const e = ed();
    const O = overlay();
    const parentTitle = under ? title(e.nodes[under]) : (O.byId.get(underReq) || {}).title;
    const kind = under ? M.childKind(e, under) : null;
    const what = kind === 'group' ? 'group' : kind === 'person' ? 'person' : 'task';
    const m = modal(`<div class="mh"><button class="lnk" data-act="mclose">Cancel</button><b>Suggest a ${what}</b><button class="lnk strong" data-act="sendnode">Send</button></div>
      <div class="mb"><p class="hint">Under <b>${E(parentTitle || '')}</b>${under ? ' · ' + E(pathOf(under)) : ''}</p>
      <input id="ftitle" placeholder="${what === 'person' ? 'Name' : 'What needs doing?'}" autocomplete="off">
      <label class="fl"><span>Deadline <i>(optional)</i></span><input id="fdate" type="date"></label>
      <textarea id="fnotes" rows="3" placeholder="Notes (optional)"></textarea>
      <p class="hint">It goes to your PC as a suggestion and is added to the tree when you approve it there.</p></div>`);
    m.dataset.under = under || ''; m.dataset.underreq = underReq || '';
    setTimeout(() => $('#ftitle', m).focus(), 250);
  }
  async function sendNode(m) {
    const t = $('#ftitle', m).value.trim();
    if (!t) { $('#ftitle', m).focus(); return toast('Give it a title'); }
    const under = m.dataset.under || null, underReq = m.dataset.underreq || null;
    const req = { kind: 'node', title: t, deadline: $('#fdate', m).value || null, notes: $('#fnotes', m).value.trim() };
    if (under) { req.parent = under; req.basePath = M.pathTitles(ed(), under); }
    else { req.parentReq = underReq; const pr = overlay().byId.get(underReq); req.parent = null; req.basePath = pr ? (pr.basePath || []).concat(pr.title) : []; }
    const sent = await send(req);
    // offer to go on: another one here, or one under the one just suggested
    m.innerHTML = `<div class="mh"><span></span><b>Sent</b><button class="lnk strong" data-act="mclose">Done</button></div><div class="mb"><p class="okmsg">${I('check')} “${E(t)}” is on its way to the PC for approval.</p>
      <div class="acts col"><button data-act="again" data-under="${E(under || '')}" data-underreq="${E(underReq || '')}">${I('plus')} Another one here</button><button data-act="again" data-underreq="${E(sent.id)}">${I('plus')} A subtask under “${E(t)}”</button></div></div>`;
  }

  // note
  function noteForm() {
    const m = modal(`<div class="mh"><button class="lnk" data-act="mclose">Cancel</button><b>Note to self</b><button class="lnk strong" data-act="sendnote">Send</button></div>
      <div class="mb">${aboutLine()}<textarea id="ntext" rows="7" placeholder="The first line becomes the title if you make it a task on the PC"></textarea></div>`);
    setTimeout(() => $('#ntext', m).focus(), 250);
  }
  const aboutLine = () => { const e = ed(), a = st.capAbout && e && e.nodes[st.capAbout]; return `<button class="about small" data-act="about">${I('tree')}<span>${a ? 'About: <b>' + E(title(a)) + '</b>' : 'About a task? <i>(optional)</i>'}</span>${I('chev')}</button>`; };
  async function sendNote(m) {
    const t = $('#ntext', m).value.trim();
    if (!t) return toast('Write something first');
    await send({ kind: 'capture', capture: 'note', text: t, about: st.capAbout || null, aboutTitle: st.capAbout && ed() && ed().nodes[st.capAbout] ? title(ed().nodes[st.capAbout]) : '' });
    closeModal(); toast('Note sent to the PC');
  }

  // photo
  let photoBlob = null;
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read the photo')); i.src = url; });
      const max = 2200, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.82));
    } finally { URL.revokeObjectURL(url); }
  }
  async function onPhoto(file) {
    if (!file) return;
    try { photoBlob = await shrink(file); } catch (e) { return toast(e.message); }
    const url = URL.createObjectURL(photoBlob);
    modal(`<div class="mh"><button class="lnk" data-act="mclose">Cancel</button><b>Photo</b><button class="lnk strong" data-act="sendphoto">Send</button></div>
      <div class="mb"><img class="prev" src="${url}" alt=""><p class="hint">${Math.round(photoBlob.size / 1024)} kB</p>${aboutLine()}<textarea id="ptext" rows="3" placeholder="Caption (optional)"></textarea></div>`);
  }
  async function sendPhoto(m) {
    if (!photoBlob) return;
    await send({ kind: 'capture', capture: 'photo', text: $('#ptext', m).value.trim(), about: st.capAbout || null, aboutTitle: st.capAbout && ed() && ed().nodes[st.capAbout] ? title(ed().nodes[st.capAbout]) : '' }, photoBlob, '.jpg');
    photoBlob = null; closeModal(); toast('Photo sent to the PC');
  }

  // voice
  const voice = { rec: null, chunks: [], blob: null, t0: 0, timer: null, stream: null, cancelled: false, type: '' };
  function voiceForm() {
    voice.blob = null;
    modal(`<div class="mh"><button class="lnk" data-act="mclose">Cancel</button><b>Voice memo</b><button class="lnk strong" data-act="sendvoice" disabled>Send</button></div>
      <div class="mb"><div class="recbox"><button class="recbtn" data-act="rec" aria-label="Record">${I('mic')}</button><div id="rtime">Tap to record</div></div><div id="rprev"></div>${aboutLine()}<textarea id="vtext" rows="2" placeholder="What is it about? (optional)"></textarea></div>`);
  }
  async function toggleRec(m) {
    if (voice.rec && voice.rec.state === 'recording') { voice.rec.stop(); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices) return toast('Recording is not available in this browser');
    try { voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return toast('No access to the microphone — allow it in Settings › Safari (or for this app)'); }
    voice.type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    voice.rec = new MediaRecorder(voice.stream, voice.type ? { mimeType: voice.type } : undefined);
    voice.chunks = []; voice.cancelled = false;
    voice.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) voice.chunks.push(ev.data); };
    voice.rec.onstop = () => {
      clearInterval(voice.timer);
      voice.stream.getTracks().forEach(t => t.stop());
      if (voice.cancelled) return;
      voice.dur = (Date.now() - voice.t0) / 1000;
      voice.blob = new Blob(voice.chunks, { type: (voice.rec.mimeType || voice.type || 'audio/mp4').split(';')[0] });
      const mm = $('#modal .mdl'); if (!mm) return;
      $('.recbtn', mm).classList.remove('on'); $('.recbtn', mm).innerHTML = I('mic');
      $('#rtime', mm).textContent = Math.round(voice.dur) + ' s recorded · tap to record again';
      $('#rprev', mm).innerHTML = `<audio controls src="${URL.createObjectURL(voice.blob)}"></audio>`;
      $('[data-act="sendvoice"]', mm).disabled = false;
    };
    voice.rec.start(1000);
    voice.t0 = Date.now();
    $('.recbtn', m).classList.add('on'); $('.recbtn', m).innerHTML = I('stop');
    $('[data-act="sendvoice"]', m).disabled = true;
    const tick = () => { const s = Math.floor((Date.now() - voice.t0) / 1000); const el = $('#rtime'); if (el) el.textContent = 'Recording ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' · tap to stop'; if (s >= 600 && voice.rec.state === 'recording') voice.rec.stop(); };
    tick(); voice.timer = setInterval(tick, 500);
  }
  async function sendVoice(m) {
    if (!voice.blob) return;
    const ext = /mp4|aac|m4a/.test(voice.blob.type) ? '.m4a' : /webm/.test(voice.blob.type) ? '.webm' : /ogg/.test(voice.blob.type) ? '.ogg' : '.m4a';
    await send({ kind: 'capture', capture: 'voice', duration: Math.round(voice.dur || 0), text: $('#vtext', m).value.trim(), about: st.capAbout || null, aboutTitle: st.capAbout && ed() && ed().nodes[st.capAbout] ? title(ed().nodes[st.capAbout]) : '' }, voice.blob, ext);
    voice.blob = null; closeModal(); toast('Voice memo sent to the PC');
  }

  // choose the task a capture is about
  function aboutPicker(returnTo) {
    const m = modal(`<div class="mh"><button class="lnk" data-act="pickback">Back</button><b>About which task?</b><button class="lnk" data-act="pickto" data-node="">None</button></div>
      <div class="mb"><input id="pq" type="search" placeholder="Search" autocomplete="off"><div class="card" id="pres"></div></div>`);
    m.dataset.returnto = returnTo || '';
    const fill = (q) => {
      const e = ed(), k = q.trim().toLowerCase(), out = [];
      if (e) for (const n of Object.values(e.nodes)) { if (n.kind === 'root' || n.kind === 'category') continue; if (!k && D(n.id).done && !n.kind) continue; const p = M.pathTitles(e, n.id).join(' › '); if (k && !p.toLowerCase().includes(k)) continue; out.push([n.id, p, D(n.id)]); }
      out.sort((a, b) => (k ? 0 : (a[2].days == null ? 999 : a[2].days) - (b[2].days == null ? 999 : b[2].days)) || a[1].localeCompare(b[1]));
      $('#pres', m).innerHTML = out.slice(0, 60).map(([id, p]) => `<button class="row" data-act="pickto" data-node="${E(id)}"><span class="cbar" style="background:${cat(D(id).cat).color}"></span><span class="tt"><b>${E(title(ed().nodes[id]))}</b><small>${E(p.split(' › ').slice(0, -1).join(' › '))}</small></span></button>`).join('') || '<div class="none">No match</div>';
    };
    fill('');
    $('#pq', m).addEventListener('input', (ev) => fill(ev.target.value));
  }
  function reopen(returnTo) { if (returnTo === 'note') noteForm(); else if (returnTo === 'photo' && photoBlob) onPhotoReopen(); else if (returnTo === 'voice') voiceForm(); else { closeModal(); renderView(); } }
  function onPhotoReopen() { const url = URL.createObjectURL(photoBlob); modal(`<div class="mh"><button class="lnk" data-act="mclose">Cancel</button><b>Photo</b><button class="lnk strong" data-act="sendphoto">Send</button></div><div class="mb"><img class="prev" src="${url}" alt="">${aboutLine()}<textarea id="ptext" rows="3" placeholder="Caption (optional)"></textarea></div>`); }

  // ---------- settings ----------
  function settingsForm() {
    const a = LS.get('auth', null);
    modal(`<div class="mh"><span></span><b>Settings</b><button class="lnk strong" data-act="mclose">Done</button></div><div class="mb">
      <div class="card"><div class="row"><span class="tt"><b>${DEV ? 'Test folder on this computer' : a ? 'Connected to Dropbox' : 'Not connected'}</b><small>${DEV ? 'developer mode' : 'Folder: Dropbox › Apps › DTU Planner'}</small></span>${!DEV && a ? '<button class="lnk danger" data-act="logout">Log out</button>' : ''}</div>
      <label class="row"><span class="tt"><b>Show finished tasks</b><small>in the tree</small></span><span class="sw"><input type="checkbox" id="sdone" ${st.showDone ? 'checked' : ''}><span></span></span></label></div>
      ${st.tree ? `<p class="hint">Showing <b>${E(st.tree.info.title || st.tree.ed.title)}</b> — the edition open in DTU Planner on ${E(st.tree.info.machine || 'the PC')}, saved ${E(fmtWhen(st.tree.info.editionModified))}.</p>` : ''}
      <h4>How it works</h4><p class="hint">The PC keeps a copy of your tree in your Dropbox for this app; the app only reads it. What you change here — progress, ticked steps, new tasks, notes, photos, voice memos — goes back to the PC as a suggestion, and DTU Planner there asks you to approve it. Unsent items wait on the phone until there is network.</p>
      <details><summary>Advanced</summary><label class="fl">Dropbox app key<input id="skey" value="${E(LS.get('appkey', '') || DROPBOX_APP_KEY)}" autocomplete="off" spellcheck="false"></label><p class="hint">Only needed if you run your own copy of this page. Version ${VERSION}.</p></details>
    </div>`);
  }

  // ---------- login ----------
  function loginHtml() {
    const key = Dbx.key();
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    return `<div class="login"><img src="icon-192.png" alt="" class="logo"><h2>DTU Planner on your phone</h2>
      <p>Read your planning tree, tick things off and send notes, photos and voice memos to your PC — where you approve them before anything changes.</p>
      ${!standalone && /iPhone|iPad/.test(navigator.userAgent) ? `<div class="tip">${I('plus')} <span>First add it to the Home Screen: tap <b>Share</b> › <b>Add to Home Screen</b>, then open it from the new icon and connect there (the icon keeps its own login).</span></div>` : ''}
      ${key ? `<button class="primary big" data-act="login">Connect to Dropbox</button>
      <p class="hint">DTU Planner gets its own folder in your Dropbox (Apps › DTU Planner) and cannot see anything else.</p>
      <details class="code"><summary>Trouble connecting? Use a code instead</summary><p class="hint">Tap “Get a code”, allow access, copy the code Dropbox shows, come back here and paste it.</p><button data-act="logincode">Get a code</button><input id="lcode" placeholder="Paste the code" autocomplete="off"><button class="primary" data-act="codeok">Connect</button></details>`
      : `<p class="bad">This page is not linked to a Dropbox app yet. Add the app key under Settings (⚙) › Advanced.</p>`}
    </div>`;
  }

  // ---------- toast ----------
  let toastT = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.add('in'); clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('in'); setTimeout(() => { t.hidden = true; }, 250); }, 2600); }

  // ---------- events ----------
  document.addEventListener('click', async (ev) => {
    const t = ev.target;
    const tab = t.closest('#tabs button');
    if (tab) {
      const k = tab.dataset.tab;
      if (k === 'add' && st.tab === 'add') return;
      st.tab = k; LS.set('tab', k); st.q = ''; $('#searchbar').hidden = true; $('#q').value = '';
      while (st.stack.length) back();
      render(); $('#view').scrollTop = 0; return;
    }
    const fold = t.closest('[data-fold]');
    if (fold && !t.closest('[data-open].lnk')) {
      ev.stopPropagation();
      const id = fold.dataset.fold;
      if (!st.open.has('_init')) { for (const c of ed().nodes.root.children) st.open.add(c); st.open.add('_init'); }
      if (st.open.has(id)) st.open.delete(id); else st.open.add(id);
      LS.set('open', [...st.open]); renderView(); return;
    }
    const wd = t.closest('[data-withdraw]');
    if (wd) { ev.stopPropagation(); const ok = await withdraw(wd.dataset.withdraw); if (ok && wd.dataset.andback) back(); render(); return; }
    const st8 = t.closest('[data-stage]');
    if (st8) {
      const id = st.stack[st.stack.length - 1], n = ed().nodes[id], want = +st8.dataset.stage;
      const O = overlay(), cur = O.stage.get(id);
      if (cur) await withdraw(cur.id, true);
      if (want !== n.stage) await send({ kind: 'stage', node: id, stage: want, base: { stage: n.stage, title: n.title } });
      renderSheet(); return;
    }
    const stp = t.closest('[data-step]');
    if (stp) {
      const id = st.stack[st.stack.length - 1], n = ed().nodes[id], s = (n.timeline || []).find(x => x.id === stp.dataset.step);
      if (!s) return;
      const O = overlay(), cur = O.step.get(id + ':' + s.id);
      const want = !(cur ? cur.done : s.done);
      if (cur) await withdraw(cur.id, true);
      if (want !== !!s.done) await send({ kind: 'step', node: id, step: s.id, done: want, base: { done: !!s.done, title: M.stepTitle(s), task: n.title } });
      renderSheet(); return;
    }
    const dm = t.closest('[data-due]');
    if (dm) { st.dueMode = dm.dataset.due; LS.set('dueMode', st.dueMode); renderView(); $('#view').scrollTop = 0; return; }
    const rg = t.closest('[data-range]');
    if (rg) { st.aheadDays = +rg.dataset.range; LS.set('aheadDays', st.aheadDays); renderView(); return; }
    const op = t.closest('[data-open]');
    if (op && !t.closest('.fold')) { openNode(op.dataset.open); return; }
    const cap = t.closest('[data-cap]');
    if (cap) {
      const k = cap.dataset.cap;
      if (k === 'note') noteForm();
      else if (k === 'photo') { const i = $('#photoin'); i.value = ''; i.click(); }
      else if (k === 'library') { const i = $('#photolib'); i.value = ''; i.click(); }
      else if (k === 'voice') voiceForm();
      return;
    }
    const a = t.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act, m = a.closest('.mdl');
    switch (act) {
      case 'back': back(); break;
      case 'mclose': closeModal(); break;
      case 'suggest': suggestForm(a.dataset.under || null, a.dataset.underreq || null); break;
      case 'again': suggestForm(a.dataset.under || null, a.dataset.underreq || null); break;
      case 'sendnode': await sendNode(m); render(); break;
      case 'capabout': st.capAbout = a.dataset.about; st.tab = 'add'; LS.set('tab', 'add'); while (st.stack.length) back(); render(); break;
      case 'about': { const returnTo = m ? ($('#ntext', m) ? 'note' : $('#ptext', m) ? 'photo' : $('#vtext', m) ? 'voice' : '') : ''; aboutPicker(returnTo); break; }
      case 'noabout': ev.stopPropagation(); st.capAbout = null; renderView(); break;
      case 'pickto': { st.capAbout = a.dataset.node || null; const r = m && m.dataset.returnto; reopen(r); if (!r) renderView(); break; }
      case 'pickback': reopen(m && m.dataset.returnto); break;
      case 'sendnote': await sendNote(m); break;
      case 'sendphoto': await sendPhoto(m); break;
      case 'rec': await toggleRec(m); break;
      case 'sendvoice': await sendVoice(m); break;
      case 'flush': await flush(); render(); toast(st.outbox.length ? 'Still waiting for network' : 'Sent'); break;
      case 'foldall': st.open = new Set(['_init']); LS.set('open', [...st.open]); renderView(); break;
      case 'login': try { await Dbx.login(false); } catch (e) { toast(e.message); } break;
      case 'logincode': try { await Dbx.login(true); } catch (e) { toast(e.message); } break;
      case 'codeok': try { await Dbx.finishLogin($('#lcode').value); toast('Connected'); render(); sync(); } catch (e) { toast(e.message); } break;
      case 'logout': Dbx.logout(); LS.del('hello'); LS.del('tree'); LS.del('pending'); LS.del('done'); st.tree = null; st.pending = new Map(); st.done = []; closeModal(); render(); break;
    }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'showdone' || ev.target.id === 'sdone') { st.showDone = ev.target.checked; LS.set('showDone', st.showDone); renderView(); }
    if (ev.target.id === 'skey') { LS.set('appkey', ev.target.value.trim()); render(); }
    if (ev.target.id === 'photoin' || ev.target.id === 'photolib') onPhoto(ev.target.files && ev.target.files[0]);
  });
  $('#bsync').addEventListener('click', () => sync(true));
  $('#bmenu').addEventListener('click', settingsForm);
  $('#bsearch').addEventListener('click', () => { const sb = $('#searchbar'); sb.hidden = !sb.hidden; if (!sb.hidden) { $('#q').focus(); } else { st.q = ''; $('#q').value = ''; renderView(); } });
  $('#q').addEventListener('input', (ev) => { st.q = ev.target.value; if (st.tab === 'add' || st.tab === 'sent') { st.tab = 'tree'; renderTabs(); } renderView(); });
  $('#qx').addEventListener('click', () => { st.q = ''; $('#q').value = ''; $('#searchbar').hidden = true; renderView(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', () => sync());

  // ---------- start ----------
  (async function start() {
    const q = new URLSearchParams(location.search);
    if (q.get('code') && !DEV) {
      const p = LS.get('pkce', null);
      history.replaceState(null, '', location.pathname);
      if (p && q.get('state') === p.state) { try { await Dbx.finishLogin(q.get('code')); toast('Connected to Dropbox'); } catch (e) { toast(e.message); } }
    } else if (q.get('error')) { history.replaceState(null, '', location.pathname); toast('Dropbox login was cancelled'); }
    try { st.outbox = (await idb.all()) || []; } catch (_) { st.outbox = []; }
    render();
    if (B.ready()) sync();
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 2 * 60 * 1000);
    if ('serviceWorker' in navigator && !DEV) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.DTUP = { st, sync, send, withdraw, overlay, B };   // for tests
  })();
})();
