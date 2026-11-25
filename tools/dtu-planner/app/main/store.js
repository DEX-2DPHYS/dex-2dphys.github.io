/* One Todo Tree — durable storage. Every write: tmp + fsync + rename, conflict check against what
   we last saw on disk, rolling journal, daily snapshots, and a local mirror outside Dropbox. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const M = require('../shared/model.js');

const JOURNAL_EVERY_MS = 2 * 60 * 1000;
const JOURNAL_KEEP = 300;
const LOCK_STALE_MS = 3 * 60 * 1000;
const BACKUP_TYPE = 'onetodotree-backup';

class Store {
  constructor(dataDir, mirrorDir, log) {
    this.dir = dataDir;
    this.mirrorDir = mirrorDir;
    this.log = log || (() => {});
    this.known = new Map();        // abs path -> sha1 of content we last read or wrote
    this.lastJournal = new Map();  // edition id -> ms
    this.machine = os.hostname();
    this.dropboxRoot = detectDropboxRoot(dataDir);
  }

  p(...parts) { return path.join(this.dir, ...parts); }

  init() {
    for (const d of ['editions', 'journal', 'snapshots', 'files', 'phone', 'locks']) fs.mkdirSync(this.p(d), { recursive: true });
    fs.mkdirSync(this.mirrorDir, { recursive: true });
    if (!fs.existsSync(this.p('settings.json'))) this.writeJson(this.p('settings.json'), M.defaultSettings(), { force: true });
    if (!fs.existsSync(this.p('people.json'))) this.writeJson(this.p('people.json'), { format: M.FORMAT, people: {} }, { force: true });
    if (this.listEditions().length === 0) {
      const id = M.todayStr().slice(0, 7);
      const ed = M.newEdition(id, monthTitle(id), this.readSettings());
      this.saveEdition(ed, { force: true, journal: true });
    }
  }

  // ---------- generic json ----------
  readJson(file) {
    const text = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(text);
    this.known.set(file, sha1(text));
    return data;
  }

  /** Returns {ok:true} or {conflict:true, theirs} when the file changed on disk behind our back. */
  writeJson(file, data, opts = {}) {
    const text = JSON.stringify(data, null, 1);
    if (!opts.force && fs.existsSync(file)) {
      const disk = fs.readFileSync(file, 'utf8');
      const h = sha1(disk);
      const k = this.known.get(file);
      if (k && h !== k && h !== sha1(text)) {
        let theirs = null;
        try { theirs = JSON.parse(disk); } catch (_) {}
        return { conflict: true, theirs };
      }
    }
    atomicWrite(file, text);
    this.known.set(file, sha1(text));
    return { ok: true, text };
  }

  readSettings() {
    try {
      const s = this.readJson(this.p('settings.json'));
      const def = M.defaultSettings();
      return Object.assign(def, s, { categories: Array.isArray(s.categories) && s.categories.length ? s.categories : def.categories });
    } catch (e) {
      this.log('settings unreadable, using defaults', e.message);
      return M.defaultSettings();
    }
  }
  saveSettings(s) { return this.writeJson(this.p('settings.json'), s, { force: true }); }

  readPeople() {
    try {
      const d = this.readJson(this.p('people.json'));
      if (!d.people) d.people = {};
      return d;
    } catch (e) {
      const m = path.join(this.mirrorDir, 'people.json');
      if (fs.existsSync(m)) { this.log('people.json unreadable, using mirror'); return JSON.parse(fs.readFileSync(m, 'utf8')); }
      return { format: M.FORMAT, people: {} };
    }
  }
  savePeople(d, opts = {}) {
    const r = this.writeJson(this.p('people.json'), d, opts);
    if (r.ok) try { atomicWrite(path.join(this.mirrorDir, 'people.json'), r.text); } catch (_) {}
    return r;
  }

  // ---------- editions ----------
  edFile(id) { return this.p('editions', safeName(id) + '.json'); }

  listEditions() {
    const dir = this.p('editions');
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const conflicts = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      if (/conflicted copy/i.test(f)) { conflicts.push(f); continue; }
      const id = f.slice(0, -5);
      let title = id, modified = null, count = 0;
      try {
        const st = fs.statSync(path.join(dir, f));
        modified = st.mtime.toISOString();
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        title = d.title || id; count = Object.keys(d.nodes || {}).length;
      } catch (_) { title = id + ' (unreadable)'; }
      out.push({ id, title, modified, count });
    }
    out.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
    if (conflicts.length) out.conflicts = conflicts;
    return out;
  }

  loadEdition(id) {
    const file = this.edFile(id);
    let ed = null, recovered = null;
    try {
      ed = this.readJson(file);
    } catch (e) {
      this.log('edition unreadable', id, e.message);
      const best = this.newestValidBackup(id);
      if (!best) throw new Error('Edition ' + id + ' is unreadable and no backup was found: ' + e.message);
      ed = best.edition; recovered = best.source;
      // keep the damaged file aside, never delete it
      try { fs.copyFileSync(file, file + '.damaged-' + stamp()); } catch (_) {}
      this.known.delete(file);
    }
    const fixes = M.validate(ed);
    M.syncCategories(ed, this.readSettings());
    if (recovered) {
      // put the recovered version back in place right away (the damaged file was kept aside)
      try { this.saveEdition(ed, { force: true, journal: true, reason: 'recovered' }); } catch (e) { this.log('could not write recovered edition', e.message); }
    }
    return { edition: ed, recovered, fixes, lock: this.checkLock(id) };
  }

  saveEdition(ed, opts = {}) {
    const file = this.edFile(ed.id);
    ed.modified = M.nowIso();
    const r = this.writeJson(file, ed, opts);
    if (!r.ok) return r;
    try { atomicWrite(path.join(this.mirrorDir, safeName(ed.id) + '.json'), r.text); } catch (e) { this.log('mirror failed', e.message); }
    const now = Date.now();
    if (opts.journal || now - (this.lastJournal.get(ed.id) || 0) > JOURNAL_EVERY_MS) {
      this.journal(ed.id, r.text, opts.reason);
      this.lastJournal.set(ed.id, now);
    }
    return { ok: true, modified: ed.modified };
  }

  /** True when the edition file on disk differs from what this app last read or wrote. */
  changedOnDisk(id) {
    const file = this.edFile(id);
    const k = this.known.get(file);
    if (!k || !fs.existsSync(file)) return false;
    return sha1(fs.readFileSync(file, 'utf8')) !== k;
  }

  /** Save someone else's version (from a conflict) into the journal so it is never lost. */
  journalObject(id, obj, reason) { this.journal(id, JSON.stringify(obj, null, 1), reason); }

  journal(id, text, reason) {
    try {
      const jd = this.p('journal', safeName(id));
      fs.mkdirSync(jd, { recursive: true });
      const gz = zlib.gzipSync(Buffer.from(text, 'utf8'));
      atomicWrite(path.join(jd, stamp() + (reason ? '_' + safeName(reason) : '') + '.json.gz'), gz);
      const sd = this.p('snapshots', safeName(id));
      fs.mkdirSync(sd, { recursive: true });
      atomicWrite(path.join(sd, M.todayStr() + '.json.gz'), gz);   // last state of the day
      const files = fs.readdirSync(jd).filter(f => f.endsWith('.json.gz')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - JOURNAL_KEEP))) {
        try { fs.unlinkSync(path.join(jd, f)); } catch (_) {}
      }
    } catch (e) { this.log('journal failed', e.message); }
  }

  listBackups(id) {
    const out = [];
    for (const [kind, sub] of [['journal', 'journal'], ['daily', 'snapshots']]) {
      const d = this.p(sub, safeName(id));
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith('.json.gz')) continue;
        const st = fs.statSync(path.join(d, f));
        out.push({ kind, file: path.join(d, f), name: f.replace('.json.gz', ''), time: st.mtime.toISOString(), size: st.size });
      }
    }
    const m = path.join(this.mirrorDir, safeName(id) + '.json');
    if (fs.existsSync(m)) { const st = fs.statSync(m); out.push({ kind: 'mirror', file: m, name: 'Local mirror (this PC)', time: st.mtime.toISOString(), size: st.size }); }
    out.sort((a, b) => b.time.localeCompare(a.time));
    return out;
  }

  readBackup(file) {
    const allowed = [this.p('journal'), this.p('snapshots'), this.mirrorDir].some(d => path.resolve(file).startsWith(path.resolve(d)));
    if (!allowed) throw new Error('Not a backup file');
    let buf = fs.readFileSync(file);
    if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
    const ed = JSON.parse(buf.toString('utf8'));
    M.validate(ed);
    return ed;
  }

  newestValidBackup(id) {
    for (const b of this.listBackups(id)) {
      try { return { edition: this.readBackup(b.file), source: b.name + ' (' + b.kind + ')' }; } catch (_) {}
    }
    return null;
  }

  // ---------- whole-data backup: one plain JSON file (export / import) ----------
  /** Everything except attachment files: settings, people, every edition, structure templates. */
  buildBackup(meta = {}) {
    const out = {
      type: BACKUP_TYPE, format: M.FORMAT, created: M.nowIso(), machine: this.machine,
      app: meta.app || '', version: meta.version || '', dataDir: this.dir,
      settings: this.readSettings(), people: this.readPeople(), editions: {},
      templates: this.listTemplates().map(t => { const x = Object.assign({}, t); delete x.file; return x; }),
      notes: [],
    };
    for (const e of this.listEditions()) {
      try { out.editions[e.id] = JSON.parse(fs.readFileSync(this.edFile(e.id), 'utf8')); }
      catch (err) {
        const b = this.newestValidBackup(e.id);
        if (b) { out.editions[e.id] = b.edition; out.notes.push(e.id + ': the file was unreadable, its newest backup (' + b.source + ') was used'); }
        else out.notes.push(e.id + ': unreadable and no backup found, left out');
      }
    }
    return out;
  }

  /** Read a backup file, or a single edition file (.json or a journal/snapshot .json.gz). */
  readImport(file) {
    if (fs.statSync(file).size > 300 * 1024 * 1024) throw new Error('The file is larger than 300 MB — not a backup of this app.');
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    let d;
    try { d = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); }
    catch (e) { throw new Error('The file is not readable JSON (' + e.message + ').'); }
    let pkg;
    if (d && d.type === BACKUP_TYPE && d.editions && typeof d.editions === 'object') pkg = d;
    else if (d && d.nodes && d.nodes.root) pkg = { type: 'edition', editions: { [d.id || path.basename(file).replace(/\.json(\.gz)?$/i, '')]: d } };
    else throw new Error('This file is neither a backup nor an edition of this app.');
    const eds = {};
    for (const [id0, ed] of Object.entries(pkg.editions)) {
      if (!ed || typeof ed !== 'object' || !ed.nodes || !ed.nodes.root) continue;
      const id = safeName(ed.id || id0);
      ed.id = id;
      M.validate(ed);
      eds[id] = ed;
    }
    if (!Object.keys(eds).length && !pkg.people && !pkg.settings) throw new Error('The file contains no readable editions.');
    pkg.editions = eds;
    if (pkg.people && typeof pkg.people.people !== 'object') pkg.people = null;
    if (pkg.settings && !Array.isArray(pkg.settings.categories)) pkg.settings = null;
    return pkg;
  }

  /** Replace the chosen parts with the package's. The current state is first written to backups/before-import-*.json. */
  applyImport(pkg, choice, meta) {
    const safety = this.p('backups', 'before-import-' + stamp() + '.json');
    fs.mkdirSync(path.dirname(safety), { recursive: true });
    atomicWrite(safety, JSON.stringify(this.buildBackup(meta), null, 1));
    const done = [];
    for (const id of (choice.editions || [])) {
      const ed = pkg.editions[id];
      if (!ed) continue;
      this.saveEdition(JSON.parse(JSON.stringify(ed)), { force: true, journal: true, reason: 'imported' });
      done.push(id);
    }
    if (choice.people && pkg.people) this.savePeople(pkg.people, { force: true });
    if (choice.settings && pkg.settings) this.saveSettings(pkg.settings);
    if (choice.templates && Array.isArray(pkg.templates)) for (const t of pkg.templates) { if (t && t.name) this.saveTemplate(t); }
    this.log('import', JSON.stringify({ editions: done, people: !!choice.people, settings: !!choice.settings, safety }));
    return { ok: true, safety, editions: done };
  }

  // ---------- structure templates (categories' subcategory trees) ----------
  listTemplates() {
    const dir = this.p('templates');
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); out.push(Object.assign({ file: f }, d)); } catch (e) { this.log('template unreadable', f, e.message); }
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return out;
  }
  saveTemplate(tpl) {
    const dir = this.p('templates');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, safeName(tpl.name) + '.json');
    if (fs.existsSync(file)) {   // keep the version being replaced
      const bak = path.join(dir, '.replaced');
      fs.mkdirSync(bak, { recursive: true });
      fs.copyFileSync(file, path.join(bak, safeName(tpl.name) + '-' + stamp() + '.json'));
    }
    atomicWrite(file, JSON.stringify(tpl, null, 1));
    return { ok: true };
  }
  deleteTemplate(fileName) {
    const dir = this.p('templates');
    const file = path.join(dir, path.basename(fileName));
    if (!fs.existsSync(file)) return { ok: true };
    const bak = path.join(dir, '.deleted');
    fs.mkdirSync(bak, { recursive: true });
    fs.copyFileSync(file, path.join(bak, path.basename(fileName, '.json') + '-' + stamp() + '.json'));
    fs.unlinkSync(file);
    return { ok: true };
  }

  // ---------- locks ----------
  lockFile(id) { return this.p('locks', safeName(id) + '.lock'); }
  checkLock(id) {
    try {
      const l = JSON.parse(fs.readFileSync(this.lockFile(id), 'utf8'));
      if (l.machine !== this.machine && Date.now() - Date.parse(l.ts) < LOCK_STALE_MS) return l;
    } catch (_) {}
    return null;
  }
  touchLock(id) {
    try { atomicWrite(this.lockFile(id), JSON.stringify({ machine: this.machine, pid: process.pid, ts: new Date().toISOString() })); } catch (_) {}
  }
  releaseLock(id) {
    try {
      const l = JSON.parse(fs.readFileSync(this.lockFile(id), 'utf8'));
      if (l.machine === this.machine) fs.unlinkSync(this.lockFile(id));
    } catch (_) {}
  }

  // ---------- attachments ----------
  /** Build attachment records for dropped/picked paths. copy=true forces copying into files/. */
  attach(paths, copy, ctx) {
    const out = [];
    for (let src of paths) {
      src = String(src).trim().replace(/^"(.*)"$/, '$1');
      if (!src) continue;
      if (!fs.existsSync(src)) { out.push({ error: 'Not found: ' + src }); continue; }
      const isDir = fs.statSync(src).isDirectory();
      const inDropbox = this.dropboxRoot && isInside(this.dropboxRoot, src);
      const rec = { id: M.uid(), kind: isDir ? 'folder' : 'file', name: path.basename(src), added: M.nowIso() };
      if ((copy || !inDropbox) && !isDir) {
        const rel = path.join('files', safeName(ctx.category || 'General'), safeName((ctx.title || 'item').slice(0, 40)) + '-' + String(ctx.id).slice(-5));
        const destDir = this.p(rel);
        fs.mkdirSync(destDir, { recursive: true });
        let dest = path.join(destDir, rec.name);
        const ext = path.extname(rec.name), base = path.basename(rec.name, ext);
        for (let i = 2; fs.existsSync(dest); i++) dest = path.join(destDir, base + ' (' + i + ')' + ext);
        fs.copyFileSync(src, dest);
        rec.name = path.basename(dest);
        rec.copied = toSlash(path.relative(this.dir, dest));
      } else if (inDropbox) {
        rec.dbx = toSlash(path.relative(this.dropboxRoot, src));
      } else {
        rec.abs = src;
      }
      out.push(rec);
    }
    return out;
  }

  resolve(rec) {
    if (rec.copied) return path.join(this.dir, rec.copied);
    if (rec.dbx && this.dropboxRoot) return path.join(this.dropboxRoot, rec.dbx);
    return rec.abs || null;
  }
}

// ---------- helpers ----------
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function stamp() { const d = new Date(); return M.todayStr(d).replace(/-/g, '') + '-' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(''); }
function safeName(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+$/,'').replace(/\.+$/, '') || '_'; }
function toSlash(p) { return p.split(path.sep).join('/'); }
function isInside(dir, p) { const r = path.relative(path.resolve(dir), path.resolve(p)); return r && !r.startsWith('..') && !path.isAbsolute(r); }
function monthTitle(id) {
  const m = /^(\d{4})-(\d{2})/.exec(id);
  if (!m) return id;
  return new Date(+m[1], +m[2] - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** tmp + fsync + rename, retrying while Dropbox (or a viewer) holds the target. */
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  let lastErr;
  for (let i = 0; i < 25; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) { lastErr = e; if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break; sleepSync(40 + i * 20); }
  }
  // last resort: copy over the target (non-atomic, but the tmp copy stays until it succeeded)
  try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); return; } catch (e) { lastErr = e; }
  throw lastErr;
}

function detectDropboxRoot(dataDir) {
  try {
    const info = path.join(process.env.LOCALAPPDATA || '', 'Dropbox', 'info.json');
    if (fs.existsSync(info)) {
      const j = JSON.parse(fs.readFileSync(info, 'utf8'));
      for (const k of Object.keys(j)) if (j[k] && j[k].path && isInside(j[k].path, dataDir)) return j[k].path;
      for (const k of Object.keys(j)) if (j[k] && j[k].path) return j[k].path;
    }
  } catch (_) {}
  let d = path.resolve(dataDir);
  while (path.dirname(d) !== d) { if (/^Dropbox/i.test(path.basename(d))) return d; d = path.dirname(d); }
  const home = path.join(os.homedir(), 'Dropbox');
  return fs.existsSync(home) ? home : null;
}

module.exports = { Store, atomicWrite, monthTitle, safeName, detectDropboxRoot };
