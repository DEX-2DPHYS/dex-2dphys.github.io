/* The open document's safety on shared drives (DESIGN.md §9):
   - lock file "~$<name>.lock" next to the document: who has it open; others get it read-only;
     refreshed every minute; stale after 5 minutes, or at once when its process on this machine is gone;
   - checksum of the file as opened/last saved: a save never overwrites a file that changed on disk since
     (it writes a conflict copy instead);
   - Dropbox "conflicted copy" files next to the document are reported on open;
   - backups: the previous version is kept on every save (last 20 + one per day for 30 days);
   - recovery: autosaved copies of unsaved work, offered again after a crash;
   - shared comments: whoever has the document read-only can still reply, resolve and comment; those actions go
     to "~$<name>.comments-<session>.ndjson" next to the document (one JSON line each) and are merged by the
     editor, who deletes the file once a save holds all of it.
   One window = one document, so the state lives here. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app } = require('electron');
const ctx = require('./context.js');
const { atomicWrite, writeError } = require('./storage.js');

const HEARTBEAT_MS = 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const KEEP_RECENT = 20, KEEP_DAYS = 30;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const userDir = (...p) => path.join(app.getPath('userData'), ...p);
const stamp = (d = new Date()) => d.toISOString().replace(/[:T]/g, '-').replace(/\..*/, '');

const cur = { path: null, hash: null, lockMine: false, heartbeat: null };

/* ---------- identity ---------- */
function me() {
  const u = ctx.config.user || {};
  return { user: u.name || os.userInfo().username, initials: u.initials || '', machine: os.hostname(), pid: process.pid, app: app.getVersion() };
}

/* ---------- lock file ---------- */
const lockPath = (file) => path.join(path.dirname(file), '~$' + path.basename(file) + '.lock');

function readLock(file) {
  try { return JSON.parse(fs.readFileSync(lockPath(file), 'utf8')); } catch (_) { return null; }
}
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
/** Is this lock still held by someone else? (ours, stale or orphaned → false) */
function heldByOther(lock) {
  if (!lock) return false;
  const m = me();
  if (lock.machine === m.machine && lock.pid === m.pid) return false;                  // ours
  if (lock.machine === m.machine && !processAlive(lock.pid)) return false;              // crashed app on this PC
  return Date.now() - Date.parse(lock.heartbeat || lock.opened || 0) < STALE_MS;          // fresh enough
}

function writeLock(file, opened) {
  const lock = { ...me(), opened: opened || new Date().toISOString(), heartbeat: new Date().toISOString() };
  const p = lockPath(file);
  atomicWrite(p, Buffer.from(JSON.stringify(lock, null, 1)));
  if (process.platform === 'win32') execFile('attrib', ['+h', p], { windowsHide: true }, () => {});   // hidden, like Word's ~$ files
  return lock;
}

/** Take the lock if free (or stale). Returns { mine: true } or { mine: false, owner }. */
function acquire(file) {
  const existing = readLock(file);
  if (heldByOther(existing)) return { mine: false, owner: existing };
  let tookOver = null;
  if (existing && !(existing.machine === me().machine && existing.pid === process.pid)) tookOver = existing;
  try {
    if (!existing) {
      // exclusive create: two machines opening at the same moment cannot both succeed on a real share
      const fd = fs.openSync(lockPath(file), 'wx');
      fs.closeSync(fd);
    }
    writeLock(file);
  } catch (e) {
    const again = readLock(file);
    if (heldByOther(again)) return { mine: false, owner: again };
    return { mine: false, owner: null, error: writeError(e) };
  }
  return { mine: true, tookOver };
}

function release(file) {
  if (!file) return;
  const lock = readLock(file);
  if (lock && lock.machine === me().machine && lock.pid === process.pid) { try { fs.unlinkSync(lockPath(file)); } catch (_) {} }
}

function startHeartbeat() {
  stopHeartbeat();
  cur.heartbeat = setInterval(() => {
    if (!cur.path || !cur.lockMine) return;
    const lock = readLock(cur.path);
    if (lock && heldByOther(lock)) {               // someone took it over while we were asleep: become read-only
      cur.lockMine = false;
      notify('lock-lost', { owner: lock });
      return;
    }
    try { writeLock(cur.path, lock && lock.opened); } catch (_) { /* network share away for a moment */ }
  }, HEARTBEAT_MS);
}
function stopHeartbeat() { if (cur.heartbeat) clearInterval(cur.heartbeat); cur.heartbeat = null; }

const notify = (kind, data) => { if (ctx.win && !ctx.win.isDestroyed()) ctx.win.webContents.send('doc:event', { kind, ...data }); };

/* ---------- Dropbox conflicted copies ---------- */
function conflictedCopies(file) {
  const dir = path.dirname(file), base = path.basename(file, path.extname(file)), ext = path.extname(file);
  try {
    return fs.readdirSync(dir).filter(n => n !== path.basename(file) && n.endsWith(ext) && n.startsWith(base + ' (') && /conflict/i.test(n));
  } catch (_) { return []; }
}

/* ---------- backups ---------- */
const backupDir = (file) => userDir('backups', path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, '_') + '-' + sha(Buffer.from(path.resolve(file).toLowerCase())).slice(0, 8));

function backup(file, bytes) {
  const dir = backupDir(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, stamp() + '.dtusw'), bytes);
  fs.writeFileSync(path.join(dir, 'source.txt'), path.resolve(file));
  prune(dir);
}
/** Keep the newest KEEP_RECENT versions, plus the newest version of each day of the last KEEP_DAYS days. */
function prune(dir) {
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.dtusw')).sort().reverse();   // names are timestamps: newest first
  const keep = new Set(files.slice(0, KEEP_RECENT));
  const days = new Set();
  for (const n of files) {
    const day = n.slice(0, 10);
    if (!days.has(day) && (Date.now() - Date.parse(day)) / 864e5 <= KEEP_DAYS) { keep.add(n); days.add(day); }
  }
  for (const n of files) if (!keep.has(n)) { try { fs.unlinkSync(path.join(dir, n)); } catch (_) {} }
}
function listBackups(file) {
  const dir = backupDir(file);
  try {
    return fs.readdirSync(dir).filter(n => n.endsWith('.dtusw')).sort().reverse()
      .map(n => ({ file: path.join(dir, n), time: n.replace('.dtusw', '').replace(/^(\d{4}-\d\d-\d\d)-(\d\d)-(\d\d)-(\d\d)$/, '$1T$2:$3:$4Z'), size: fs.statSync(path.join(dir, n)).size }));
  } catch (_) { return []; }
}

/* ---------- recovery (autosave of unsaved work) ---------- */
const recoveryDir = () => userDir('recovery');
const sessionId = 'session-' + process.pid + '-' + Date.now();

function recoveryWrite(bytes, meta) {
  const dir = recoveryDir();
  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(path.join(dir, sessionId + '.dtusw'), Buffer.from(bytes));
  atomicWrite(path.join(dir, sessionId + '.json'), Buffer.from(JSON.stringify({ ...meta, savedAt: new Date().toISOString(), pid: process.pid })));
}
function recoveryClear() {
  for (const ext of ['.dtusw', '.json']) { try { fs.unlinkSync(path.join(recoveryDir(), sessionId + ext)); } catch (_) {} }
}
/** Recovery files left by sessions that are no longer running. */
function recoveryList() {
  try {
    return fs.readdirSync(recoveryDir()).filter(n => n.endsWith('.json') && !n.startsWith(sessionId)).map((n) => {
      const meta = JSON.parse(fs.readFileSync(path.join(recoveryDir(), n), 'utf8'));
      return { id: n.replace(/\.json$/, ''), ...meta };
    }).filter(r => !processAlive(r.pid) || r.pid === undefined).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  } catch (_) { return []; }
}
function recoveryRead(id) { return new Uint8Array(fs.readFileSync(path.join(recoveryDir(), id + '.dtusw'))); }
function recoveryDiscard(id) {
  for (const ext of ['.dtusw', '.json']) { try { fs.unlinkSync(path.join(recoveryDir(), id + ext)); } catch (_) {} }
}

/* ---------- the open document ---------- */
function close() {
  stopHeartbeat();
  if (cur.lockMine) release(cur.path);
  cur.path = null; cur.hash = null; cur.lockMine = false;
}

/** Open: read the file, take the lock, remember its checksum. */
function open(file) {
  close();
  const bytes = fs.readFileSync(file);
  const lock = acquire(file);
  cur.path = file; cur.hash = sha(bytes); cur.lockMine = lock.mine;
  if (lock.mine) startHeartbeat();
  return { bytes: new Uint8Array(bytes), readOnly: !lock.mine, owner: lock.owner || null, tookOver: lock.tookOver || null, conflicts: conflictedCopies(file) };
}

/** Check the lock again (read-only documents: has it become free?). Takes it when free.
    While still read-only, `changed` says the editor has saved a newer version (the reader reloads it). */
function recheck() {
  if (!cur.path || cur.lockMine) return { readOnly: !cur.lockMine };
  const lock = acquire(cur.path);
  if (!lock.mine) {
    let changed = false;
    try { changed = sha(fs.readFileSync(cur.path)) !== cur.hash; } catch (_) {}
    return { readOnly: true, owner: lock.owner, changed };
  }
  // the file may have been changed by the previous editor: the renderer reloads when the checksum differs
  cur.lockMine = true;
  startHeartbeat();
  let changed = false;
  try { changed = sha(fs.readFileSync(cur.path)) !== cur.hash; } catch (_) {}
  return { readOnly: false, changed };
}

function conflictName(file) {
  const ext = path.extname(file), base = file.slice(0, -ext.length);
  const who = me().initials || me().user;
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  return base + ' (conflict, ' + who + ' ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes()) + ')' + ext;
}

/**
 * Save. For the open document: refuses to overwrite a file that changed on disk since it was opened/saved
 * (writes a conflict copy instead) and keeps the previous version as a backup. "Save as" to a new path takes
 * the lock there and releases the old one.
 */
function save(file, bytes) {
  const buf = Buffer.from(bytes);
  const same = cur.path && path.resolve(cur.path).toLowerCase() === path.resolve(file).toLowerCase();
  if (same && !cur.lockMine) return { error: 'the document is open read-only (someone else is editing it)' };
  let onDisk = null;
  try { onDisk = fs.readFileSync(file); } catch (_) { /* new file */ }
  if (same && onDisk && cur.hash && sha(onDisk) !== cur.hash) {
    const copy = conflictName(file);
    try { atomicWrite(copy, buf); } catch (e) { return { error: writeError(e) }; }
    return { conflict: true, savedAs: copy };
  }
  if (!same) {
    const lock = acquire(file);
    if (!lock.mine) return { error: 'that file is open in ' + (lock.owner ? lock.owner.user + ' on ' + lock.owner.machine : 'another program') };
  }
  try {
    if (onDisk) backup(file, onDisk);
    atomicWrite(file, buf);
  } catch (e) { return { error: writeError(e) }; }
  if (!same) { close(); cur.path = file; cur.lockMine = true; startHeartbeat(); }
  cur.hash = sha(buf);
  recoveryClear();
  return { ok: true };
}

/* ---------- shared comments (actions of readers while someone else edits) ---------- */
const sidePrefix = (file) => '~$' + path.basename(file) + '.comments-';
const sidePath = (file) => path.join(path.dirname(file), sidePrefix(file) + sessionId + '.ndjson');

/** Append one comment action of this (read-only) session. */
function sideAppend(file, op) {
  const p = sidePath(file), fresh = !fs.existsSync(p);
  try { fs.appendFileSync(p, JSON.stringify(op) + '\n'); } catch (e) { return { error: writeError(e) }; }
  if (fresh && process.platform === 'win32') execFile('attrib', ['+h', p], { windowsHide: true }, () => {});
  return { ok: true };
}
/** Every reader's actions for this document: [{ file, size, ops }]. A half-written last line is left for next time. */
function sideList(file) {
  const dir = path.dirname(file), pre = sidePrefix(file);
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.startsWith(pre) && n.endsWith('.ndjson')); } catch (_) { return []; }
  return names.map((n) => {
    const p = path.join(dir, n);
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
    const ops = [];
    let size = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) { size += Buffer.byteLength(line) + 1; continue; }
      try { ops.push(JSON.parse(line)); size += Buffer.byteLength(line) + 1; } catch (_) { break; }
    }
    return { file: p, size: Math.min(size, Buffer.byteLength(text)), ops };
  }).filter(Boolean);
}
/** After a save that holds them: delete the files that have not grown since they were merged. */
function sideClear(file, merged) {
  const pre = sidePrefix(file);
  for (const m of merged || []) {
    if (path.dirname(m.file) !== path.dirname(file) || !path.basename(m.file).startsWith(pre)) continue;    // only this document's files
    try { if (fs.statSync(m.file).size <= m.size) fs.unlinkSync(m.file); } catch (_) {}
  }
  return { ok: true };
}

module.exports = {
  currentPath: () => cur.path,
  isBackupFile: (f) => { try { const root = path.resolve(userDir('backups')).toLowerCase() + path.sep; return typeof f === 'string' && /\.dtusw$/i.test(f) && path.resolve(f).toLowerCase().startsWith(root); } catch (_) { return false; } },
  open, save, close, recheck, readLock, lockPath,
  sideAppend, sideList, sideClear,
  listBackups, readBackup: (f) => new Uint8Array(fs.readFileSync(f)),
  recoveryWrite, recoveryClear, recoveryList, recoveryRead, recoveryDiscard,
  current: () => ({ ...cur, heartbeat: undefined }),
  STALE_MS,
};
