// Sound Wizard offline support (installed to the home screen, it works without a connection).
// The published copy has a version stamp instead of 20261009.1812 (tools/publish.cjs), and its pages ask
// for the files with that same stamp, so a new version is a new set of cache entries. The page itself
// is fetched from the network first (so an update shows at once when online), from the cache when offline.
const VERSION = '20261009.1812';
const CACHE = `sound-wizard-${VERSION}`;
const STAMPED = ['style.css', 'js/app.js', 'js/engine.js', 'js/dsp.js', 'js/poly.js', 'js/notation.js', 'js/worker.js', 'js/capture.worklet.js', 'icons/icon.svg', 'icons/icon-180.png', 'manifest.webmanifest'];
const PLAIN = ['./', 'index.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([...PLAIN, ...STAMPED.map(f => `${f}?v=${VERSION}`)])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sound-wizard-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
