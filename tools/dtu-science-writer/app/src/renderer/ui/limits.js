/* Journal / funder limits in the status bar (core/venues.js): "Nature Communications · Abstract 162/150 · Main text
   4 870/5 000 …", amber near a limit and red over it. A click opens the details: every limit, the article type (to
   change), the journal's notes, where the numbers come from and when they were checked, and "Stop checking".
   Pages come from the preview (doc/preview.js calls setPageInfo). */
import { checkLimits, venueOf } from '../../core/venues.js';
import { styleOf, resolveStyle } from '../../core/style.js';
import { app, $, onChange, onLoad } from '../context.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A long section name ("Popularised description: What / Why / How (max 400 …)") shortened for the status bar. */
const short = (s) => { const t = String(s).replace(/\s*\(.*$/, '').split(/[:–—]/)[0].trim(); return t.length > 28 ? t.slice(0, 26) + '…' : t; };
const num = (n) => Number(n).toLocaleString('en-GB');
const info = { pages: null, sectionPages: null };
let timer = null, last = null;

/** From the preview: total pages and the page span of each level-1 section (or null when not asked). */
export function setPageInfo(pages, sectionPages) {
  info.pages = pages;
  if (sectionPages !== undefined) info.sectionPages = sectionPages;
  refreshLimits();
}

export function refreshLimits() {
  const el = $('#st-limits');
  if (!el || !app.view) return;
  last = checkLimits(app.view.state.doc, info);
  if (!last) { el.hidden = true; el.innerHTML = ''; closePanel(); return; }
  el.hidden = false;
  const worst = last.rows.some(r => r.state === 'over') ? 'over' : last.rows.some(r => r.state === 'near') ? 'near' : 'ok';
  el.className = 'lim-' + worst;
  el.title = 'Limits of ' + last.venue.name + ' · ' + last.type.name + ' — click for details';
  el.innerHTML = '<b>' + esc(last.venue.short || last.venue.name) + '</b>' + last.rows.map(r => ' · <span class="lim-' + r.state + '">' + esc(short(r.label)) + ' ' + num(r.value) + '/' + num(r.max) + '</span>').join('');
  const p = $('#limpanel');
  if (p && !p.hidden) renderPanel(p);
}

function closePanel() { const p = $('#limpanel'); if (p) p.hidden = true; }

function renderPanel(p) {
  const { venue, type, rows } = last;
  const types = venue.types.length > 1
    ? '<select class="lim-type">' + venue.types.map(t => '<option value="' + esc(t.id) + '"' + (t.id === type.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select>'
    : esc(type.name);
  p.innerHTML = '<div class="lim-head"><b>' + esc(venue.name) + '</b> · ' + types + '<span class="grow"></span><button class="lim-x" title="Close">×</button></div>'
    + (rows.length ? '<table>' + rows.map(r => '<tr class="lim-' + r.state + '"><td>' + esc(r.label) + '</td><td class="n">' + num(r.value) + '</td><td>of ' + num(r.max) + (r.unit ? ' ' + esc(r.unit) : '') + '</td></tr>').join('') + '</table>'
      : '<p class="muted">The guide states no limits this program can count for this type.</p>')
    + (type.limits && type.limits.mainScope ? '<p class="small">Main text: ' + esc(type.limits.mainScope) + '</p>' : '')
    + (type.notes ? '<p class="small">' + esc(type.notes) + '</p>' : '')
    + (rows.some(r => r.unit === 'pages') ? '' : (type.limits && type.limits.pages) || (type.sections || []).some(s => s.limit && s.limit.pages) ? '<p class="small muted">Page counts appear once the page preview has run.</p>' : '')
    + '<p class="small muted">From the ' + (venue.kind === 'funder' ? 'call text' : 'author guide') + ', checked ' + esc(venue.checked || '?') + (venue.sources && venue.sources[0] ? ': <span class="lim-src">' + esc(venue.sources[0]) + '</span>' : '') + '. Guides change — check the current one before you submit.</p>'
    + '<div class="lim-foot"><button class="lim-stop">Stop checking</button></div>';
}

function setVenue(key) {
  const st = JSON.parse(JSON.stringify(styleOf(app.view.state.doc)));
  st.venue = key;
  app.view.dispatch(app.view.state.tr.setDocAttribute('style', resolveStyle(st)));
}

function togglePanel() {
  let p = $('#limpanel');
  if (!p) {
    p = document.createElement('div'); p.id = 'limpanel'; p.hidden = true; document.body.appendChild(p);
    p.addEventListener('click', (e) => {
      if (e.target.closest('.lim-x')) closePanel();
      else if (e.target.closest('.lim-stop')) { closePanel(); setVenue(''); app.view.focus(); }
    });
    p.addEventListener('change', (e) => {
      if (e.target.classList.contains('lim-type') && last) setVenue(last.venue.id + '/' + e.target.value);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !p.hidden) closePanel(); });
  }
  if (!p.hidden) return closePanel();
  if (!last) return;
  renderPanel(p);
  p.hidden = false;
}

onLoad(() => { info.pages = null; info.sectionPages = null; refreshLimits(); });
onChange((tr) => { if (!tr.docChanged) return; clearTimeout(timer); timer = setTimeout(refreshLimits, 250); });
function wire() { const el = $('#st-limits'); if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('click', togglePanel); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

/** For tests: the last measurement. */
export const lastLimits = () => last;
export { venueOf };
