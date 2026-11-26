/* Signs dist/latest.json for a release (called by the release workflow).   node tools/sign-latest.js <latest.json>
   The private key comes from the environment (DTUSW_UPDATE_KEY, the repository secret) and is never printed.
   It may be the whole .pem file or only its base64 body. The result is checked with the public key built into the
   program (main/update.js): a release signed with any other key would be refused by installed copies, so it fails here.
   Exit code 0: signed. 2: no key given (the caller decides). 1: the key cannot be used — the reason is printed. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const update = require(path.join(__dirname, '..', 'main', 'update.js'));

const file = process.argv[2];
const raw = String(process.env.DTUSW_UPDATE_KEY || '').replace(/\r/g, '').trim();
if (!raw) { console.log('no signing key given'); process.exit(2); }

/* what was pasted, without showing it */
const describe = () => 'the secret has ' + raw.length + ' characters on ' + raw.split('\n').length + ' line(s)'
  + (/BEGIN PRIVATE KEY/.test(raw) ? ', with a BEGIN PRIVATE KEY line' : ', without a BEGIN PRIVATE KEY line')
  + (/END PRIVATE KEY/.test(raw) ? ' and an END PRIVATE KEY line' : ' and without an END PRIVATE KEY line');

let key = null;
try {
  // the key itself is the base64 between the BEGIN / END lines: taken out whatever became of the line breaks when it
  // was pasted (whole file, on one line, or the body alone)
  const body = raw.replace(/-----[^-]*-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(body, 'base64');
  if (body === update.UPDATE_PUBLIC_KEY || der.length === 44) throw new Error('this is the PUBLIC key (update-public-key.txt); the secret must be the file update-signing-key.pem');
  key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
} catch (e) {
  console.error('The signing key could not be read: ' + e.message + ' (' + describe() + ').');
  console.error('Put the whole content of update-signing-key.pem into the repository secret DTUSW_UPDATE_KEY, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----.');
  process.exit(1);
}

const info = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
info.sig = crypto.sign(null, Buffer.from(update.signedText(info)), key).toString('base64');
const why = update.refuseUpdate(info);
if (why) {
  console.error('Signed, but the program would refuse it: ' + why + '.');
  if (why === 'signature does not match') console.error('The secret is a valid key, but not the one whose public half is built into the program (main/update.js).');
  process.exit(1);
}
fs.writeFileSync(file, JSON.stringify(info, null, 2));
console.log('latest.json signed for version ' + info.version + '; the program accepts the signature');
