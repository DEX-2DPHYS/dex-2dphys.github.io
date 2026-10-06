// EBL Workbench — app shell: tabs, project files, autosave.
// Tabs not built yet say what they will hold.

import { $, esc, initTips, toast, download, pickFile, store, openModal, readFile, busyStep, busyDone, BIG_FILE } from './dom.js';
import { createLayoutEditor } from './layout/editor.js';
import { demoProject, makeProject, projectFromJSON, projectToJSON } from '../core/project.js';
import { createPsfTab } from './psf/psftab.js';
import { createExposureTab } from './exposure/exposuretab.js';
import { createFabTab } from './fab/fabtab.js';
import { applyCorrection, clearCorrection } from '../core/pec/pershape.js';
import { installShortcutCard } from './shortcuts.js';
import { installGdsIO } from './gdsio.js';
import { installTutorials } from './tutorials.js';
import { BACKEND, nativeCore } from './native.js';
import { localBackend } from './local.js';

/* global __BUILD_DATE__ */
const BUILD = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';
const AUTOSAVE_KEY = 'ebl-workbench-autosave-v1';

const app = {
  project: demoProject(),
  fileName: null,
  tab: 'layout',
  version: 0,                                   // bumped on every change to layout or PSF
  isTabActive: (t) => app.tab === t,
  // a layout or PSF change makes applied writing data (fractured correction) stale: it is kept for
  // inspection but no longer used for exposure until it is run again
  onChange: () => { staleWriting('layout'); app.version++; scheduleAutosave(); },
  psfChanged: () => { staleWriting('PSF'); app.version++; scheduleAutosave(); },
  writingChanged: () => { app.version++; scheduleAutosave(); },
  markDirty: () => scheduleAutosave(),          // saved state changed, results did not
  nominalDose: () => editor?.state?.nominalDose ?? 100,   // µC/cm², Pattern Studio's nominal dose
  editorView: () => { const v = editor.getView(); return v; },
  exposureCutLine: () => { const l = exposureTab.state.line; return l ? { a: [...l.a], b: [...l.b] } : { a: [0, 0], b: [20000, 0] }; },
  applyCorrection: (doses) => editor.mutate('proximity correction applied', (lib) => applyCorrection(lib, doses)),
  clearCorrection: () => editor.mutate('proximity correction cleared', (lib) => clearCorrection(lib)),
};

// ---------------------------------------------------------------- tabs
function showTab(t) {
  app.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + t));
  if (t === 'layout') { editor.resize(); editor.render(); }
  if (t === 'psf') psfTab.show();
  if (t === 'exposure') exposureTab.show();
  if (t === 'fab') fabTab.show();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

// ---------------------------------------------------------------- placeholders for tabs not built yet
const SOON = {
  analysis: ['Analysis', [
    'Cut-line dose and developed profile (the EBL Development simulator lives on here)',
    'Line width versus dose sweeps; comparison of two PSFs on the same pattern; the four correction levels side by side',
  ]],
};
for (const [k, [title, items]] of Object.entries(SOON)) {
  $('soon-' + k).innerHTML = `<h2>${esc(title)}</h2>`
    + `<p class="hint">Not built yet. This tab will hold:</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function staleWriting(why) { const w = app.project.writing; if (w && w.active) { w.active = false; w.stale = why; } }

// ---------------------------------------------------------------- project files
// The whole working state, for Save and autosave (full = false: large rasters only if small).
function collectSession(full = true) {
  return { tab: app.tab, editor: editor.getSession(), psf: psfTab.getSession(), exposure: exposureTab.getSession(full), fab: fabTab.getSession() };
}
function snapshot(full) {
  app.project.view = editor.getView();
  let writing = app.project.writing;
  // the browser autosave keeps large writing data out (it is in every saved file)
  if (!full && writing && JSON.stringify(writing.library).length > 1.5e6) writing = null;
  return projectToJSON({ ...app.project, writing, session: collectSession(full) });
}
function applySession(s) {
  if (!s) return;
  try {
    editor.setSession(s.editor); psfTab.setSession(s.psf); exposureTab.setSession(s.exposure); fabTab.setSession(s.fab);
    if (s.tab && s.tab !== 'analysis') showTab(s.tab);
  } catch (e) { console.warn('session restore:', e); toast('Part of the saved session could not be restored (the layout and PSF are fine).'); }
}

function setProject(p, name, { fit = true } = {}) {
  app.project = { library: p.library, psf: p.psf, view: p.view ?? null, settings: p.settings ?? {}, fab: p.fab ?? null, writing: p.writing ?? null };
  fabTab?.reset();
  exposureTab?.reset();
  app.fileName = name;
  app.version++;
  $('fileName').textContent = name || '';
  // a saved view wins when restoring a session; a freshly opened file is fitted to the window
  const useView = p.view && !fit;
  editor.loadProject(!useView && !p.session);
  if (useView || (p.session && p.view)) editor.setView(p.view);
  applySession(p.session);
  scheduleAutosave();
}

$('btnNew').onclick = () => {
  if (!confirm('Start a new, empty project? (Save first if you want to keep this one.)')) return;
  setProject(makeProject(), null);
  editor.render();
};
$('btnDemo').onclick = () => {
  if (!confirm('Replace the current layout with the demo pattern?')) return;
  setProject(demoProject(), 'demo');
};
// Save: one .ebw.json with everything (layout, PSF and Monte Carlo result, correction, raster
// correction, Fab recipe, every tab's settings and views). The first Save asks for a name.
function saveAs(name) {
  const base = name.replace(/(\.ebw)?\.json$/i, '').trim() || 'project';
  const text = snapshot(true);
  download(`${base}.ebw.json`, text);
  app.fileName = `${base}.ebw.json`; $('fileName').textContent = app.fileName;
  toast(`Saved <b>${esc(base)}.ebw.json</b> (${(text.length / 1024).toFixed(0)} kB) to your downloads — everything: layout, PSF and Monte Carlo result, corrections, Fab recipe, and every tab's settings.`, 6000);
  scheduleAutosave();
}
function askName(title) {
  const cur = app.fileName && app.fileName !== 'demo' ? app.fileName.replace(/(\.ebw)?\.json$/i, '') : '';
  openModal({
    title, html: `<div class="label">Project name</div><input class="field" id="saveName" value="${esc(cur || 'project')}"><div class="hint" style="margin-top:6px;">Saved as <i>name</i>.ebw.json in your downloads folder.</div>`,
    onOpen: (box) => { const e = box.querySelector('#saveName'); e.focus(); e.select(); e.onkeydown = (ev) => { if (ev.key === 'Enter') box.querySelector('[data-primary]').click(); }; },
    buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, fn: (box) => saveAs(box.querySelector('#saveName').value) }],
  });
}
$('btnSave').onclick = () => { if (app.fileName && app.fileName !== 'demo') saveAs(app.fileName); else askName('Save project'); };
$('btnSaveAs').onclick = () => askName('Save project as');
installGdsIO(app, { setProject });
$('btnOpen').onclick = () => pickFile('.json,application/json', (text, name) => {
  try {
    const p = projectFromJSON(text);
    setProject(p, name, { fit: true });
    toast(p.source === 'pps' ? `Imported a Pattern Studio export. ${esc((p.notes || []).join(' '))}` : `Opened <b>${esc(name)}</b>.`, 5000);
  } catch (e) { alert(`Could not open ${name}:\n${e.message}`); }
});

// drag & drop a project onto the window
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  let text;
  try { text = await readFile(f, false); } catch (err) { alert(`Could not read ${f.name}:\n${err.message}`); return; }
  try { await busyStep(f.size >= BIG_FILE, `Opening <b>${esc(f.name)}</b> — building the layout…`, () => { setProject(projectFromJSON(text), f.name); toast(`Opened <b>${esc(f.name)}</b>.`); }); }
  catch (err) { alert(`Could not open ${f.name}:\n${err.message}`); }
  finally { busyDone(); }
});

// ---------------------------------------------------------------- autosave (per browser, convenience only)
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    let ok = false;
    try { ok = store.set(AUTOSAVE_KEY, JSON.stringify({ name: app.fileName, json: snapshot(false) })); } catch { ok = false; }
    $('stSave').textContent = ok ? `autosaved ${new Date().toLocaleTimeString()}` : 'autosave unavailable — use Save';
  }, 700);
}

// ---------------------------------------------------------------- start
initTips();
const editor = createLayoutEditor(app);
const psfTab = createPsfTab(app);
const exposureTab = createExposureTab(app);
app.exposure = exposureTab.client;
const fabTab = createFabTab(app);
installShortcutCard(app);                       // hold K: shortcuts of the tab in use
const tutorials = installTutorials();            // green T beside each tab: that module's video tutorials
// served by the Pro backend: say so in the title bar (and how many threads its native core has)
localBackend().then((h) => {
  if (!h) return;
  const brand = document.querySelector('.brand');
  if (brand && !brand.querySelector('.pro')) {
    brand.insertAdjacentHTML('beforeend', ` <span class="pro" title="${h.core ? `Native core ${esc(String(h.core.version))}: Monte Carlo, short range, solve and KOH in C++ on ${h.core.threads} threads.` : 'The Pro backend runs the fractured correction; no native core was found, so it runs in JavaScript.'} The computer's memory (${h.memGB} GB) is available to the correction." style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;background:#c0122b;color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;vertical-align:middle;">PRO${h.core ? ` · ${h.core.threads} threads` : ''}</span>`);
  }
  document.title = 'EBL Workbench Pro';
}).catch(() => {});
window.__workbench = { app, editor, psfTab, exposureTab, fabTab, tutorials, BUILD, backend: BACKEND, native: nativeCore,     // inspection hook
  saveText: () => snapshot(true), openText: (text, name) => setProject(projectFromJSON(text), name) };
// session-only changes (views, cut-line, 3D settings) do not trigger an autosave: save on leaving
const saveNow = () => { try { store.set(AUTOSAVE_KEY, JSON.stringify({ name: app.fileName, json: snapshot(false) })); } catch { /* storage full or blocked */ } };
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
setInterval(() => { if (document.visibilityState === 'visible') saveNow(); }, 30000);

let restored = false;
const params = new URLSearchParams(location.search);
if (!params.has('fresh')) {
  const saved = store.get(AUTOSAVE_KEY);
  if (saved) {
    try {
      const o = JSON.parse(saved);
      const p = projectFromJSON(o.json);
      setProject(p, o.name, { fit: false });
      restored = true;
      toast('Restored your last session from this browser. <b>Demo</b> or <b>New</b> start over.', 4000);
    } catch { store.del(AUTOSAVE_KEY); }
  }
}
if (!restored) setProject(demoProject(), 'demo');
document.title = `EBL Workbench (${BUILD})`;
