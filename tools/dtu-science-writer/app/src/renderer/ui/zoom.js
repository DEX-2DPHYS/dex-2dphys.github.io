/* Page zoom: Ctrl + mouse wheel over the page (around the mouse pointer), the zoom field in the toolbar
   (− 100 % +, or type a value), View → Zoom in / Zoom out / Actual size (Ctrl+0). Only the page zooms — not the
   toolbar or the preview — and the level is remembered (settings). */
import { app, api, $, registerCommands } from '../context.js';

export const ZOOM_MIN = 50, ZOOM_MAX = 300;
const STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
let zoom = 100, saveTimer = null;

export const getZoom = () => zoom;

/** Set the zoom (percent). anchorY: keep the page point at this client y in place (mouse wheel). */
export function setZoom(z, { remember = true, anchorY = null } = {}) {
  z = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)));
  const sc = $('#editor-scroll'), page = $('#page');
  if (!page) return;
  const old = zoom;
  let docY = null, offY = 0;
  if (sc) {
    offY = anchorY != null ? anchorY - sc.getBoundingClientRect().top : sc.clientHeight / 2;
    docY = (sc.scrollTop + offY) / (old / 100);
  }
  zoom = z;
  page.style.zoom = z === 100 ? '' : String(z / 100);
  if (sc && docY != null) sc.scrollTop = docY * (z / 100) - offY;
  const f = $('#tb-zoom');
  if (f && document.activeElement !== f) f.value = z + ' %';
  window.dispatchEvent(new Event('resize'));        // comment cards, figure bar etc. follow the new layout
  if (remember) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { app.settings = { ...app.settings, zoom }; api.settings('set', { zoom }); }, 400);
  }
}

const stepZoom = (dir) => setZoom(dir > 0 ? (STEPS.find(s => s > zoom) || ZOOM_MAX) : ([...STEPS].reverse().find(s => s < zoom) || ZOOM_MIN));

export function wireZoom() {
  setZoom(app.settings.zoom || 100, { remember: false });
  // Ctrl + wheel: zoom the page (anywhere in the window: never Chromium's whole-window zoom)
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const sc = $('#editor-scroll');
    if (!sc || !sc.contains(e.target)) return;
    setZoom(zoom * Math.pow(1.1, -e.deltaY / 100), { anchorY: e.clientY });   // one wheel notch = 10 %
  }, { passive: false });
  const f = $('#tb-zoom');
  if (f) {
    const apply = () => { const n = parseFloat(f.value); if (n > 0) setZoom(n); else f.value = zoom + ' %'; };
    f.addEventListener('change', apply);
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { apply(); f.blur(); if (app.view) app.view.focus(); }
      if (e.key === 'Escape') { f.value = zoom + ' %'; f.blur(); if (app.view) app.view.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); stepZoom(1); f.value = zoom + ' %'; }
      if (e.key === 'ArrowDown') { e.preventDefault(); stepZoom(-1); f.value = zoom + ' %'; }
    });
    f.addEventListener('focus', () => f.select());
    f.addEventListener('blur', () => { f.value = zoom + ' %'; });
  }
}

registerCommands({
  zoomIn: () => stepZoom(1),
  zoomOut: () => stepZoom(-1),
  zoom100: () => setZoom(100),
});
