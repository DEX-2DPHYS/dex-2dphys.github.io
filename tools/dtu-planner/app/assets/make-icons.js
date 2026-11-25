/* Render the app icon SVG to PNGs. Run: electron assets/make-icons.js */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const LOG = path.join(require('os').tmpdir(), 'ott-icons.log');
const log = (m) => fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n');

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a74f0"/><stop offset="1" stop-color="#7a4fd8"/></linearGradient></defs>
<rect x="8" y="8" width="240" height="240" rx="58" fill="url(#g)"/>
<g fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" opacity=".92">
<path d="M98 128 C140 128 132 70 170 70"/><path d="M98 128 L176 128"/><path d="M98 128 C140 128 132 186 170 186"/></g>
<circle cx="82" cy="128" r="36" fill="#fff"/>
<path d="M65 129 l12 12 l23 -26" fill="none" stroke="url(#g)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="186" cy="70" r="20" fill="#fff"/><circle cx="194" cy="128" r="20" fill="#fff" opacity=".85"/><circle cx="186" cy="186" r="20" fill="#fff" opacity=".7"/>
</svg>`;

log('start');
app.whenReady().then(async () => {
  log('ready');
  try {
    const out = __dirname;
    fs.writeFileSync(path.join(out, 'icon.svg'), svg(256));
    const w = new BrowserWindow({ width: 400, height: 400, show: false, webPreferences: { offscreen: false } });
    for (const [name, size] of [['icon.png', 256], ['tray.png', 32]]) {
      await w.loadURL('data:text/html,<html><body></body></html>');
      log('loaded ' + name);
      // rasterise inside the page via canvas -> PNG data URL (transparent background)
      const dataUrl = await w.webContents.executeJavaScript(`new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size}; c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); res(c.toDataURL('image/png')); };
        img.onerror = () => rej('img error');
        img.src = 'data:image/svg+xml;base64,${Buffer.from(svg(size)).toString('base64')}';
      })`);
      fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
      log('wrote ' + name);
    }
    w.destroy();
  } catch (e) { log('error ' + (e.stack || e)); }
  app.exit(0);
});
