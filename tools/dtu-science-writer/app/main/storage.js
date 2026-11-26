/* File storage helpers (locks, checksums, backups and recovery are in docs.js). */
'use strict';
const fs = require('fs');
const path = require('path');

/** Write next to the target, flush, then rename over it: a crash never leaves a half-written file. */
function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp-' + process.pid);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  let err;
  for (let i = 0; i < 8; i++) {            // Dropbox/antivirus can hold the target for a moment
    try { fs.renameSync(tmp, file); return; } catch (e) { err = e; const t = Date.now() + 120; while (Date.now() < t) { /* wait */ } }
  }
  try { fs.unlinkSync(tmp); } catch (_) {}
  throw err;
}

/** A readable message for a failed write. */
function writeError(e) {
  return e.code === 'EBUSY' || e.code === 'EPERM' ? 'the file is open in another program (' + e.code + ')' : e.message;
}

module.exports = { atomicWrite, writeError };
