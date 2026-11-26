/* The bar between the page and the print view (page preview): drag to give either more room; double-click for the
   default width. The width is remembered (settings: previewWidth). */
import { app, api, $ } from '../context.js';

const MIN_PREVIEW = 260, MIN_EDITOR = 420;

export function wireSplitter() {
  const split = $('#pv-split'), pv = $('#preview');
  if (!split || !pv) return;
  const clamp = (px) => Math.round(Math.max(MIN_PREVIEW, Math.min(px, window.innerWidth - MIN_EDITOR)));
  const apply = (px) => { pv.style.flexBasis = px + 'px'; pv.style.maxWidth = 'none'; };
  const reset = () => { pv.style.flexBasis = ''; pv.style.maxWidth = ''; };
  const save = (w) => { app.settings = { ...app.settings, previewWidth: w }; api.settings('set', { previewWidth: w }); };
  if (app.settings.previewWidth) apply(clamp(app.settings.previewWidth));

  split.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { split.setPointerCapture(e.pointerId); } catch (_) {}
    const right = pv.getBoundingClientRect().right;
    document.body.classList.add('splitting');
    const move = (ev) => apply(clamp(right - ev.clientX));
    const up = () => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      split.removeEventListener('pointercancel', up);
      document.body.classList.remove('splitting');
      save(Math.round(pv.getBoundingClientRect().width));
      window.dispatchEvent(new Event('resize'));          // comment cards etc. follow
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
    split.addEventListener('pointercancel', up);
  });
  split.addEventListener('dblclick', () => { reset(); save(null); window.dispatchEvent(new Event('resize')); });
  // a smaller window: keep the editor usable
  window.addEventListener('resize', () => { if (app.settings.previewWidth) apply(clamp(app.settings.previewWidth)); });
}
