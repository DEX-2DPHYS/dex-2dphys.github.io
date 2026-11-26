/* The .dtusw file: a zip (DESIGN.md §9.1).
     manifest.json   format id + version, app version, dates
     document.json   ProseMirror document JSON
     media/…         images, original bytes, content-hashed names */
import JSZip from 'jszip';
import { getMedia, putMedia, clearMedia } from './media.js';

export const FORMAT = 'dtu-science-writer';
export const FORMAT_VERSION = 1;
export const EXT = 'dtusw';

/** Media names referenced by the document. */
export function usedMedia(doc) {
  const names = new Set();
  doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.src) names.add(n.attrs.src); });
  return [...names];
}

export async function packDocument(doc, info = {}) {
  const zip = new JSZip();
  const now = new Date().toISOString();
  zip.file('manifest.json', JSON.stringify({
    format: FORMAT, version: FORMAT_VERSION, app: info.appVersion || '', created: info.created || now, modified: now,
  }, null, 1));
  zip.file('document.json', JSON.stringify(doc.toJSON()));
  const missing = [];
  for (const name of usedMedia(doc)) {
    const m = getMedia(name);
    if (m) zip.file(name, m.bytes, { binary: true, compression: 'STORE' });
    else missing.push(name);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, missing };
}

/** Returns { json, manifest }; media are loaded into the media store. Throws a readable error for foreign files. */
export async function unpackDocument(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch (_) { throw new Error('This is not a DTU Science Writer file (not a zip).'); }
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('This is not a DTU Science Writer file (no manifest).');
  const manifest = JSON.parse(await mf.async('string'));
  if (manifest.format !== FORMAT) throw new Error('Unknown file format: ' + manifest.format);
  if (manifest.version > FORMAT_VERSION) throw new Error('This file was written by a newer version of DTU Science Writer (format ' + manifest.version + '). Please update the app.');
  const json = JSON.parse(await zip.file('document.json').async('string'));
  clearMedia();
  const files = zip.file(/^media\//);
  for (const f of files) putMedia(f.name, await f.async('uint8array'));
  return { json, manifest };
}
