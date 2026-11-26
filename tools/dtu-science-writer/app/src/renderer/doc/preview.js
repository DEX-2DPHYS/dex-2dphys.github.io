/* Live page preview: Typst renders the document to SVG pages in the main process, shortly after each change. */
import { docToTypst } from '../../core/typst.js';
import { partDoc } from '../../core/parts.js';
import { setPagePositions, pageBreaksOn } from '../editor/pageview.js';
import { usedMedia } from '../../core/fileformat.js';
import { getMedia } from '../../core/media.js';
import { app, api, $, onChange, onLoad } from '../context.js';

export const preview = { timer: null, running: false, again: false, sent: new Set(), urls: [], visible: true, lastProblems: [] };

/** New images for the Typst work folder (each image is sent once per session). */
export function mediaPayload() {
  const out = [];
  for (const name of usedMedia(app.view.state.doc)) {
    if (preview.sent.has(name)) continue;
    const m = getMedia(name);
    if (m) { out.push({ name, bytes: m.bytes }); preview.sent.add(name); }
  }
  return out;
}

export function schedulePreview(now) {
  if (!preview.visible) return;
  clearTimeout(preview.timer);
  preview.pending = true;                    // a run is on its way (waitPreview waits for it)
  preview.timer = setTimeout(runPreview, now ? 0 : 450);
}

async function runPreview() {
  if (preview.running) { preview.again = true; return; }
  preview.running = true;
  preview.pending = false;
  $('#pv-status').textContent = 'Updating…';
  try {
    const { source, problems } = docToTypst(partDoc(app.view.state.doc, app.part));
    preview.lastProblems = problems;
    const t0 = performance.now();
    const res = await api.compile({ source, media: mediaPayload(), format: 'svg' });
    if (res.error) {
      $('#pv-error').textContent = res.error;
      $('#pv-error').hidden = false;
      $('#pv-status').textContent = 'Layout error';
    } else {
      $('#pv-error').hidden = true;
      showPages(res.pages);
      updatePageBreaks(res.pages.length);                          // page-boundary view (editor/pageview.js), not awaited
      const pages = res.pages.length + (res.pages.length === 1 ? ' page' : ' pages');
      $('#pv-status').textContent = pages + ' · ' + Math.round(performance.now() - t0) + ' ms';
      $('#st-pages').textContent = pages;
    }
    if (problems.length) showProblems(problems);
  } catch (e) {
    $('#pv-status').textContent = 'Preview failed';
    console.error(e);
  } finally {
    preview.running = false;
    if (preview.again) { preview.again = false; schedulePreview(true); }
  }
}

/** Ask Typst where every block starts and hand it to the editor (only while View → Page breaks in the text is on). */
async function updatePageBreaks(pages) {
  if (!pageBreaksOn()) return;
  try {
    const doc = app.view.state.doc, part = app.part || 'main';
    const { source, blockOf } = docToTypst(partDoc(doc, part), { positions: true });
    const res = await api.compile({ source, media: [], format: 'query' });
    if (res && res.positions && app.view.state.doc === doc) setPagePositions(app.view, { part, blockOf, positions: res.positions, pages });
  } catch (e) { console.error(e); }
}

function showProblems(problems) {
  const p = problems[0];
  $('#pv-status').textContent += ' · ' + problems.length + ' problem' + (problems.length > 1 ? 's' : '');
  $('#pv-status').title = p.kind === 'math' ? 'An equation could not be converted: ' + p.latex : 'A cross-reference points to a deleted item';
}

function showPages(svgs) {
  const host = $('#pv-pages');
  const old = preview.urls;
  preview.urls = svgs.map(s => URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' })));
  const imgs = host.querySelectorAll('img');
  preview.urls.forEach((u, i) => {
    let im = imgs[i];
    if (!im) { im = document.createElement('img'); im.className = 'pv-page'; im.alt = 'Page ' + (i + 1); host.appendChild(im); }
    im.src = u;
  });
  for (let i = svgs.length; i < imgs.length; i++) imgs[i].remove();
  setTimeout(() => old.forEach(u => URL.revokeObjectURL(u)), 2000);
}

/** Show or hide the page preview (toolbar "Pages", F8, View → Page preview, "Hide" in its header).
    The choice is remembered (settings) unless `remember` is false (start-up). */
export function togglePreview(force, remember = true) {
  preview.visible = force !== undefined ? force : !preview.visible;
  document.body.classList.toggle('no-preview', !preview.visible);
  $('[data-cmd="preview"]').classList.toggle('on', preview.visible);
  api.viewState({ preview: preview.visible });                 // tick in the View menu
  if (remember) { app.settings = { ...app.settings, preview: preview.visible }; api.settings('set', { preview: preview.visible }); }
  if (preview.visible) schedulePreview(true);
}

/** Resolves when no compile is running or pending (tests). */
export async function waitPreview() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 400 && preview.visible && (preview.running || preview.pending || preview.again); i++) await sleep(50);
  await sleep(100);
  for (let i = 0; i < 400 && preview.visible && (preview.running || preview.pending || preview.again); i++) await sleep(50);
}

onChange((tr) => { if (tr.docChanged) schedulePreview(); });
onLoad(() => { preview.sent.clear(); schedulePreview(true); });
