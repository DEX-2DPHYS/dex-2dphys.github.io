/* Media store: the document's images, keyed by their name inside the file ("media/<hash>.<ext>").
   Images are kept as the original bytes; names are content hashes, so equal images are stored once. */

const store = new Map();   // name -> { bytes: Uint8Array, mime, url }

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
export const mimeOf = (name) => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
export const isSupportedImage = (name) => /\.(png|jpe?g|gif|svg)$/i.test(name);

function objectUrl(bytes, mime) {
  if (typeof URL === 'undefined' || !URL.createObjectURL || typeof Blob === 'undefined') return '';
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export function clearMedia() {
  for (const m of store.values()) if (m.url && URL.revokeObjectURL) URL.revokeObjectURL(m.url);
  store.clear();
}

export function putMedia(name, bytes) {
  if (!store.has(name)) store.set(name, { bytes, mime: mimeOf(name), url: objectUrl(bytes, mimeOf(name)) });
  return name;
}

export const getMedia = (name) => store.get(name) || null;
export const mediaNames = () => [...store.keys()];
export const mediaUrl = (name) => (store.get(name) || {}).url || '';

/** Short content hash (FNV-1a 64-bit as hex) — stable name for identical bytes. */
export function hashBytes(bytes) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[i], 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Add an image file's bytes; returns its media name. */
export function addImage(fileName, bytes) {
  const ext = (fileName.split('.').pop() || 'png').toLowerCase().replace('jpeg', 'jpg');
  return putMedia('media/' + hashBytes(bytes) + '.' + ext, bytes);
}

/** Natural pixel size of an image (renderer only). */
export function imageSize(name) {
  return new Promise((resolve) => {
    const url = mediaUrl(name);
    if (!url || typeof Image === 'undefined') return resolve({ w: 0, h: 0 });
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}
