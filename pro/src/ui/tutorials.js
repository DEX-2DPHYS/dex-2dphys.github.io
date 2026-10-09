// Video tutorials (2026-10-02). One catalogue, read by the in-app menus AND by the recorder
// (tutorial/record.mjs), so a title can never differ between the menu and the video.
//
// In the app: a small green "T" beside each module's tab opens that module's list. A tutorial
// whose video file is missing is shown greyed out (probed with a <video> element, which works on
// file://, where fetch does not). Choosing one plays it in a closable window over the main field.
// The videos live in tutorial/videos/ beside the built page and play on their own as well
// (tutorial/videos/index.html lists them).

export const TUTORIAL_DIR = 'tutorial/videos/';

// module: the data-tab it belongs to; '*' = listed under every module. warn: the module's
// "Warnings, common mistakes and pitfalls" video — listed first, with a warning sign.
export const TUTORIALS = [
  { id: 'ps-warnings', module: 'layout', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Relative doses, units, what is never written, saving your work.' },
  { id: 'ps-first-pattern', module: 'layout', title: 'Draw your first pattern', blurb: 'Rectangles, circles and polygons, dose and layer, snapping, fused objects.' },
  { id: 'ps-arrays', module: 'layout', title: 'Arrays the fast way', blurb: 'Duplicate, move once, Ctrl+D repeats the step; lasso and align / distribute.' },
  { id: 'ps-import-gds', module: 'layout', title: 'Bring in a real layout (GDS)', blurb: 'Import a CleWin GDS, dose tables, device areas for Fab Studio.' },
  { id: 'ps-layers', module: 'layout', title: 'Layers, beams and PEC zones', blurb: 'Show / hide all, move shapes between layers, beam step and current, high-resolution layers and zones.' },
  { id: 'psf-warnings', module: 'psf', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Conventions, energy and substrate, the default PSF, Monte Carlo statistics.' },
  { id: 'psf-basics', module: 'psf', title: 'What the PSF is, and where it comes from', blurb: 'Energy and substrate, α, β, η, reading the plots.' },
  { id: 'psf-own', module: 'psf', title: 'Your own PSF', blurb: 'Manual models started from Monte Carlo suggestions (double, triple, power-Gaussian, spline), or a table; compare with the default.' },
  { id: 'psf-mc', module: 'psf', title: 'Monte Carlo PSF', blurb: 'The default PSF source: run it, see the trajectories and the energy deposition, use the fit.' },
  { id: 'rs-warnings', module: 'resists', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Conditions belong to the curve, regimes, best guesses, lab-to-lab differences.' },
  { id: 'rs-library', module: 'resists', title: 'The resist library: curves, conditions, regimes', blurb: 'The resists in the cleanroom, their curves and sources, and what calibrated, window and extrapolated mean.' },
  { id: 'rs-model', module: 'resists', title: 'How the model extrapolates — and how far to trust it', blurb: 'The laws, the step-by-step calculation, the uncertainty, and the process window.' },
  { id: 'rs-add', module: 'resists', title: 'Add your own curve, and share it', blurb: 'Type in a measured contrast curve with its conditions, fit it, export a pack for the shared library.' },
  { id: 'rs-use', module: 'resists', title: 'From the library to Analysis and Fab Studio', blurb: 'Use a resist at your conditions in the Analysis and in a Fab Studio process flow.' },
  { id: 'ex-warnings', module: 'exposure', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Stale results, correction limits, writing data, what the maps do and do not tell you.' },
  { id: 'ex-proximity', module: 'exposure', title: 'See the proximity effect', blurb: 'The delivered dose map, the cut-line profile, why small things come out thin.' },
  { id: 'ex-correct', module: 'exposure', title: 'Correct it — and check the correction', blurb: 'The correction methods, contour or control-point fit, use as writing data, check against the raster correction.' },
  { id: 'ex-large', module: 'exposure', title: 'Large chips: quick, region, high resolution', blurb: 'The Quick method, correcting a selected region, high-resolution parts, the desktop backend.' },
  { id: 'ex-3d', module: 'exposure', title: 'Read the 3D view', blurb: 'Clearing level, ceiling and the red cut lamp, the developed view.' },
  { id: 'ex-writer', module: 'exposure', title: 'Hand it to the writer', blurb: 'Shots and writing time, GDS export with dose classes.' },
  { id: 'fab-warnings', module: 'fab', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Illustrative presets, calibration of the development, voxel size, scum, what the model leaves out.' },
  { id: 'fab-layout', module: 'fab', title: 'From layout to resist profile', blurb: 'Device area, spin, expose with the layout dose, develop, read the cross-section.' },
  { id: 'fab-mask', module: 'fab', title: 'Quick concepts with the mask editor', blurb: 'A free sample, shapes drawn on the grid, each with its own dose.' },
  { id: 'fab-advanced', module: 'fab', title: 'Advanced: real resists and their curves', blurb: 'Learning and Advanced; the library’s resists, a curve and its conditions, the model moving it when the film or development differ.' },
  { id: 'fab-contrast', module: 'fab', title: 'Contrast curve and development', blurb: 'γ, D₀, D₁₀₀ and the rounding; why the edge lands at ½ of nominal.' },
  { id: 'fab-flow', module: 'fab', title: 'A full process flow', blurb: 'Lift-off or etch, undo / redo, saving the recipe.' },
  { id: 'fab-etch', module: 'fab', title: 'Etching: wet and KOH', blurb: 'An oxide hard mask opened by a wet etch, KOH V-grooves on (100) silicon, the wafer orientation.' },
  { id: 'an-warnings', module: 'analysis', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Only as good as its inputs: PSF, curve, development; reading widths; what calibration can tell.' },
  { id: 'an-print', module: 'analysis', title: 'Will it print? Probes, widths and dose to size', blurb: 'Probe the features, read the width against dose, the dose to size, the developed resist and the verdict.' },
  { id: 'an-window', module: 'analysis', title: 'One dose for everything: the process window', blurb: 'Dose windows, tolerance, the common window — before and after proximity correction.' },
  { id: 'an-calibrate', module: 'analysis', title: 'Calibrate from your dose test', blurb: 'Measured widths fix the clearing dose and the backscatter ratio; hand the dose to the JEOL tab.' },
  { id: 'jl-warnings', module: 'jeol', title: 'Warnings, common mistakes and pitfalls', warn: true, blurb: 'Machine-specific numbers, the 10 ns limit, RESIST and ranks, BEAMER, what you still do by hand.' },
  { id: 'jl-plan', module: 'jeol', title: 'Plan a write: current and write time', blurb: 'The pattern, the beam condition, where the time goes, and choosing a current.' },
  { id: 'jl-files', module: 'jeol', title: 'Dose ranks and the job files', blurb: 'RESIST and the ranks, the jobdeck and schedule, BEAMER, and comparing with JEOL\'s estimate.' },
  { id: 'settings', module: '*', title: 'Important settings (all modules)', blurb: 'The settings you change most often, module by module.' },
];
export const tutorialFile = (t) => `${TUTORIAL_DIR}${t.id}.mp4`;
export const tutorialsFor = (module) => TUTORIALS.filter((t) => t.module === module || t.module === '*').sort((a, b) => (b.warn ? 1 : 0) - (a.warn ? 1 : 0));

// Is the video there? Cached per id; true / false / a pending promise.
const probed = new Map();
function probe(t) {
  if (probed.has(t.id)) return probed.get(t.id);
  const p = new Promise((resolve) => {
    const v = document.createElement('video');
    let done = false;
    const end = (ok) => { if (done) return; done = true; probed.set(t.id, ok); v.removeAttribute('src'); try { v.load(); } catch (_) {} resolve(ok); };
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => end(true);
    v.onerror = () => end(false);
    setTimeout(() => end(false), 4000);
    v.src = tutorialFile(t);
  });
  probed.set(t.id, p);
  return p;
}

const CSS = `
.tut-t{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin:0 6px 0 -2px;border-radius:50%;background:#16a34a;color:#fff;font:700 11px/1 system-ui;cursor:pointer;align-self:center;flex:none;box-shadow:0 0 0 2px rgba(22,163,74,.25);user-select:none}
.tut-t:hover{background:#15803d;box-shadow:0 0 0 3px rgba(22,163,74,.4)}
.tut-menu{position:fixed;z-index:9000;min-width:300px;max-width:420px;background:#fff;color:#111;border:1px solid #ddd;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:6px;font-size:13px}
.tut-menu .tm-h{padding:6px 10px 4px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.04em}
.tut-menu .tm-i{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;border-radius:7px;cursor:pointer;color:#111;font:inherit}
.tut-menu .tm-i:hover:not([disabled]){background:#f0fdf4}
.tut-menu .tm-i small{display:block;color:#666;font-size:11px;margin-top:2px}
.tut-menu .tm-i[disabled]{color:#aaa;cursor:default}
.tut-menu .tm-i[disabled] small{color:#bbb}
.tut-menu .tm-i .tm-play{color:#16a34a;margin-right:6px}
.tut-menu .tm-i[disabled] .tm-play{color:#ccc}
.tut-menu .tm-i .tm-play.tm-warn{color:#d97706;font-size:15px}
.tut-menu .tm-i[data-warn]{border-bottom:1px solid #f1f1f1;margin-bottom:2px}
.tut-player{position:fixed;z-index:8900;left:0;right:0;top:50px;bottom:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:24px}
.tut-player .tp-win{background:#111;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.45);overflow:hidden;width:min(1280px,100%);max-height:100%;display:flex;flex-direction:column}
.tut-player .tp-bar{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;color:#fff;font:600 14px system-ui}
.tut-player .tp-bar .tp-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tut-player .tp-bar button{border:0;background:#333;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
.tut-player .tp-bar button:hover{background:#555}
.tut-player video{display:block;width:100%;max-height:calc(100vh - 160px);background:#000}
`;

export function installTutorials() {
  if (!document.getElementById('tutCss')) { const s = document.createElement('style'); s.id = 'tutCss'; s.textContent = CSS; document.head.appendChild(s); }
  const tabs = document.getElementById('tabs');
  let menu = null, player = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  function play(t) {
    closeMenu(); closePlayer();
    player = document.createElement('div'); player.className = 'tut-player'; player.id = 'tutPlayer';
    player.innerHTML = `<div class="tp-win" role="dialog" aria-label="Tutorial"><div class="tp-bar"><span class="tp-t"></span><button type="button" class="tp-x" title="Close (Esc)">✕ Close</button></div><video controls autoplay playsinline></video></div>`;
    player.querySelector('.tp-t').textContent = `Tutorial · ${t.title}`;
    player.querySelector('video').src = tutorialFile(t);
    player.querySelector('.tp-x').onclick = closePlayer;
    player.addEventListener('mousedown', (e) => { if (e.target === player) closePlayer(); });
    document.body.appendChild(player);
  }
  function closePlayer() { if (!player) return; const v = player.querySelector('video'); v.pause(); v.removeAttribute('src'); v.load(); player.remove(); player = null; }
  function openMenu(module, anchor) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'tut-menu'; menu.id = 'tutMenu';
    const list = tutorialsFor(module), name = anchor.previousElementSibling?.textContent?.replace(/\d+$/, '').trim() || '';
    menu.innerHTML = `<div class="tm-h">Tutorials${name ? ' · ' + name : ''}</div>` + list.map((t) => `<button type="button" class="tm-i" data-id="${t.id}"${t.warn ? ' data-warn="1"' : ''} disabled><span class="tm-play${t.warn ? ' tm-warn' : ''}">${t.warn ? '⚠' : '▶'}</span>${t.title}<small>${t.blurb}</small></button>`).join('');
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 430, r.left - 10)) + 'px'; menu.style.top = r.bottom + 8 + 'px';
    document.body.appendChild(menu);
    for (const b of menu.querySelectorAll('.tm-i')) {
      const t = TUTORIALS.find((q) => q.id === b.dataset.id);
      b.title = 'Checking for the video…';
      Promise.resolve(probe(t)).then((ok) => { b.disabled = !ok; b.title = ok ? 'Play' : `Not recorded yet (${tutorialFile(t)})`; b.dataset.ok = ok ? '1' : '0'; });
      b.onclick = () => { if (!b.disabled) play(t); };
    }
  }
  for (const b of tabs.querySelectorAll('button[data-tab]')) {
    const module = b.dataset.tab;
    if (!TUTORIALS.some((t) => t.module === module)) continue;
    const t = document.createElement('span');
    t.className = 'tut-t'; t.textContent = 'T'; t.dataset.module = module; t.title = `Tutorials for ${b.textContent.trim()}`;
    t.setAttribute('role', 'button'); t.tabIndex = 0;
    t.onclick = (e) => { e.stopPropagation(); if (menu && menu.dataset.module === module) closeMenu(); else { openMenu(module, t); menu.dataset.module = module; } };
    b.after(t);
  }
  document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.tut-t')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (player) { closePlayer(); e.stopPropagation(); } else closeMenu(); } }, true);
  return { open: openMenu, play: (id) => { const t = TUTORIALS.find((q) => q.id === id); if (t) play(t); }, close: () => { closeMenu(); closePlayer(); }, probe: (id) => probe(TUTORIALS.find((q) => q.id === id)) };
}
