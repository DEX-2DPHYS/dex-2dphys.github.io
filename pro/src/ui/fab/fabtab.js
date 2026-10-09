// Fab Studio tab: the Micro and Nanofabrication Studio's process flow on a
// device area of the layout. The sample is a device area (3D, or a 2D cut along its long side),
// the Exposure tab's cut-line, or a free-standing sample; the exposure step takes the delivered
// dose from the Workbench exposure engine (whole layout, PSF included) or a built-in pattern.
// The recipe is replayed from the substrate whenever the flow is edited, and travels with the
// project file.

import { $, esc, toast, download, pickFile, openModal, readNum, numField, modalOpen } from '../dom.js';
import { createFabEngine, autoVoxelNm, MAX_SLICES } from '../../core/fab/engine.js';
import { sampleFor, sampleForLine, doseMapsFromRaster, BUDGETS } from '../../core/fab/device.js';
import { M, MAT_NAMES, MAT_COLOR, RESIST_PRESETS, RESIST_LABELS, DEVELOPERS, DEPOSIT_MATERIALS, ETCH_MATERIALS, TRANSFER_MATERIALS, MAT_MAP, isResist, LIBRARY_PRESETS, LEARNING_RESISTS, STUDIO_DEVELOPERS, FAB_LEVELS, presetOf } from '../../core/fab/materials.js';
import { deviceAreas, isExposedPurpose } from '../../core/geom/library.js';
import { makeResist, remainingFraction } from '../../core/physics/resist.js';
import { calibrationOf, devDeviation, describeCal } from '../../core/physics/devcal.js';
import { drawCrossSection, sliceThumbData, thumbURL } from './render2d.js';
import { createIso } from './iso3d.js';
import { staleOverlay } from '../stale.js';
import { createMaskEditor, MASK_EDITOR_CSS } from './maskeditor.js';
import { WAFER_SURFACES, WAFER_FLAT_LIST, flatLabelOf, normalizeWafer, waferBasis, dirLabel, kohRateModel } from '../../core/fab/crystal.js';
import { kohPayload, kohPayloadRaw } from '../../core/fab/koh.js';
import { KOH_METHODS } from '../../core/fab/kohrun.js';
import { nativeCore } from '../native.js';
import { describeMove, developConditions, trimCalText } from '../../core/resists/move.js';
import { psfKeV } from '../resists/resiststab.js';

const STEP_LABELS = { deposit: 'Deposit material', transfer_2d: 'Transfer 2D material', spinresist: 'Spin resist', expose: 'Expose (EBL)', uv_expose: 'Expose (UV)', develop: 'Develop', descum: 'O₂ plasma (descum / graphene)', etch_rie: 'Etch — RIE (anisotropic)', etch_sf6: 'Etch — SF6 (MoS₂ / hBN)', etch_wet: 'Etch — wet / isotropic', etch_koh: 'Etch — KOH (anisotropic Si)', liftoff: 'Lift-off / strip resist', strip: 'Strip resist' };
const STEP_ICONS = { deposit: '⬇', transfer_2d: '◫', spinresist: '◎', expose: '✦', uv_expose: '☀', develop: '⚗', descum: '♨', etch_rie: '⚡', etch_sf6: '⚗', etch_wet: '💧', etch_koh: '◇', liftoff: '⬆', strip: '⬆' };
const opt = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const um = (nm, d = 2) => (nm >= 1000 ? `${(nm / 1000).toFixed(d)} µm` : `${Math.round(nm)} nm`);

export function createFabTab(app) {
  const root = $('tab-fab');
  if (!document.getElementById('maskEdCss')) { const css = document.createElement('style'); css.id = 'maskEdCss'; css.textContent = MASK_EDITOR_CSS; document.head.appendChild(css); }
  root.innerHTML = `
  <div class="grid fab3">
    <div class="col">
      <div class="panel">
        <div class="section-title fab-fold-head"><button type="button" class="fab-tw" id="fabSampleToggle" title="Fold or unfold the sample settings">▾</button> Sample <span class="q" data-tip="<b>What Fab Studio simulates.</b><br><b>Device area</b> — a gold rectangle drawn in Pattern Studio (tool 5). In <b>3D</b> the whole area is a voxel block; as a <b>2D cut</b> only a cross-section along its long side, which is far cheaper and answers most questions (undercut, lift-off, sidewalls).<br><b>Exposure cut-line</b> — the line of the Exposure tab's profile, as a 2D cut.<br><b>Free sample</b> — no layout: the studio's own patterns, as before.<br><br>The lateral voxel size follows a fixed column budget, so a 2 µm gate and a 200 µm pad are simulated with the same number of columns and the voxel size tells you what the simulation can resolve.">?</span></div>
        <div class="row fab-exec"><button class="btn primary" id="fabBuild" title="Build a new sample from these settings — clears the process flow">Build sample</button><button class="btn" id="fabRebuild" title="Rebuild the sample from these settings (substrate, voxels, wafer) and run the process steps on it again — the recipe is kept">Rebuild &amp; replay</button><span class="hint" id="fabSampleSum"></span></div>
        <div id="fabSampleBody">
        <div class="label">Simulate</div>
        <select class="field" id="fabSource"></select>
        <div class="two" style="margin-top:6px;">
          <div><div class="label">Mode</div><select class="field" id="fabMode"><option value="2d">2D cut (fast)</option><option value="3d">3D block</option></select></div>
          <div><div class="label">Budget</div><select class="field" id="fabBudget"></select></div>
          <div><div class="label">Lateral voxel (nm) <span class="q" data-tip="Automatic from the budget; type a value to override (blank = automatic).">?</span></div><input class="field" id="fabNmLat" type="number" min="0.5" step="1" placeholder="auto"></div>
          <div><div class="label">Vertical voxel (nm)</div><input class="field" id="fabNmVert" type="number" min="0.2" step="0.5" value="2"></div>
        </div>
        <div id="fabFreeRow" class="two" style="margin-top:6px; display:none;">
          <div><div class="label">Width (nm)</div><input class="field" id="fabFreeW" type="number" value="1000" min="50" step="50"></div>
          <div><div class="label">Depth (nm)</div><input class="field" id="fabFreeD" type="number" value="500" min="20" step="50"></div>
        </div>
        <div class="hint" id="fabSampleInfo" style="margin-top:6px;"></div>
        <div class="section-title" style="margin-top:10px;">Substrate stack (nm)</div>
        <div class="three">
          <div><div class="label">Si</div><input class="field" id="fabSi" type="number" value="200" min="20" step="10"></div>
          <div><div class="label">SiO₂</div><input class="field" id="fabOx" type="number" value="0" min="0" step="5"></div>
          <div><div class="label">Poly-Si</div><input class="field" id="fabPoly" type="number" value="0" min="0" step="5"></div>
          <div><div class="label">Au</div><input class="field" id="fabMet" type="number" value="0" min="0" step="5"></div>
          <div><div class="label">Head-room <span class="q" data-tip="Air above the stack for resist and films. Make it larger than the thickest resist you will spin.">?</span></div><input class="field" id="fabHead" type="number" value="300" min="100" step="50"></div>
        </div>
        <div class="section-title" style="margin-top:10px;">Wafer orientation <span class="q" data-tip="The silicon wafer's crystal orientation, for the <b>whole project</b> (every flow is on the same wafer). It matters for <b>KOH</b>, whose rate depends on the crystal plane being etched: {111} planes etch about 150× slower than {100}.<br><br><b>Surface</b> — the wafer's surface plane.<br><b>Primary flat along</b> — the crystal direction of the wafer flat.<br><b>Flat ∠ layout x</b> — the angle from the layout's x axis to the flat, counter-clockwise seen from above. 0 means mask edges drawn along x are parallel to the flat, as in normal practice.<br><br>Each sample then has its own crystal directions: a 2D cut along the layout y axis, or the Exposure tab's cut-line, runs in a different direction from a 3D block. The line below names them.">?</span></div>
        <div class="three">
          <div><div class="label">Surface</div><select class="field" id="fabWSurf">${opt(Object.fromEntries(Object.entries(WAFER_SURFACES)))}</select></div>
          <div><div class="label">Primary flat along</div><select class="field" id="fabWFlat"></select></div>
          <div><div class="label">Flat ∠ layout x (°)</div><input class="field" id="fabWRot" type="number" step="1" value="0"></div>
        </div>
        <div class="hint" id="fabWInfo" style="margin-top:4px;"></div>
        <div class="hint" id="fabBuildInfo" style="margin-top:6px;">Press <b>Build sample</b> to start (this clears the process flow).</div>
        </div>
      </div>

      <div class="panel">
        <div class="section-title">Add a process step <span class="fab-level" id="fabLevel" data-tip="<b>Learning</b> — the studio's generic teaching resists and developers: simple, illustrative numbers.<br><b>Advanced</b> — the resists of the resist library (the DTU Nanolab cleanroom), each with its contrast curves and the conditions they were measured at (kV, film thickness, developer, time, temperature). A film, voltage or development away from a curve's conditions is moved by the library's model, and every step says whether that is inside the process window or extrapolated."><button type="button" data-level="learning">Learning</button><button type="button" data-level="advanced">Advanced</button></span></div>
        <div class="row fab-exec">
          <button class="btn primary" id="fabRun">Run step</button>
          <button class="btn" id="fabApplyEdit" style="display:none;">Apply edit</button>
          <button class="btn" id="fabCancelEdit" style="display:none;">Cancel</button>
          <button class="btn" id="fabUndo2" disabled title="Undo the last step of the flow (Ctrl+Z)">← Undo</button>
          <button class="btn" id="fabRedo2" disabled title="Redo the step just undone (Ctrl+Y or Ctrl+Shift+Z)">Redo →</button>
        </div>
        <div class="hint" id="fabRunHint" style="margin:0 0 4px;">Run step adds a new step at the end. To change a step already in the flow, click its card.</div>
        <div class="hint" id="fabStatus" style="margin:2px 0 8px;"></div>
        <select class="field" id="fabStep">${opt(STEP_LABELS)}</select>
        <div id="fabParams" style="margin-top:8px;"></div>
      </div>

    </div>

    <div class="col">
      <div class="toolbar" style="margin-bottom:8px;">
        <button class="btn active" id="fabViewCross">Cross-section</button>
        <button class="btn" id="fabView3D">3D</button>
        <span class="sep"></span>
        <span id="fabCrossCtl" class="row" style="gap:8px;"><span style="font-size:12px;color:#666;">slice</span><input type="range" id="fabZ" min="0" max="100" value="50" style="width:140px;"><span class="hint" id="fabZLabel"></span>
          <span style="font-size:12px;color:#666;margin-left:8px;">vertical ×</span><select class="field" id="fabExag" style="width:auto;"><option value="auto">auto</option><option value="1">1 (true)</option><option value="2">2</option><option value="5">5</option><option value="10">10</option><option value="20">20</option></select>
          <button class="btn small" id="fabXReset">Fit width</button><span class="hint">wheel zooms, drag pans</span>
          <label class="row" style="gap:4px;font-size:12px;" title="Draw resist and oxide semi-transparent"><input type="checkbox" id="fabTransp2">transparent</label></span>
        <span id="fab3DCtl" class="row" style="gap:8px; display:none;">
          <span style="font-size:12px;color:#666;">quality</span><select class="field" id="fabQ" style="width:auto;"><option value="1">full</option><option value="2">½</option><option value="4">¼</option></select>
          <label class="row" style="gap:4px;font-size:12px;"><input type="checkbox" id="fabLabels" checked>labels</label>
          <label class="row" style="gap:4px;font-size:12px;"><input type="checkbox" id="fabPersp" checked>perspective</label>
          <label class="row" style="gap:4px;font-size:12px;" title="Draw resist and oxide semi-transparent so buried layers show through"><input type="checkbox" id="fabTransp">transparent</label>
          <span style="font-size:12px;color:#666;">height ×</span><input type="range" id="fab3H" min="1" max="20" step="1" value="1" style="width:90px;"><span class="hint" id="fab3HLabel">1</span>
          <button class="btn small" id="fabCam">Reset view</button>
        </span>
        <span class="hint" id="fabViewInfo" style="margin-left:auto;"></span>
      </div>
      <div class="canvas-wrap" id="fabWrap">
        <canvas id="fabCanvas2d" style="display:block;width:100%;height:max(440px, calc(100vh - 250px));"></canvas>
        <canvas id="fabCanvas3d" style="display:none;width:100%;height:max(440px, calc(100vh - 250px));cursor:grab;"></canvas>
      </div>
      <div class="statusbar"><span id="fabHover">—</span></div>
      <div class="panel" style="margin-top:10px;">
        <div class="row" style="gap:16px;flex-wrap:wrap;font-size:12px;" id="fabLegend"></div>
      </div>
    </div>
    <div class="col flowcol">
      <div class="panel">
        <div class="section-title">Process flow <span class="q" data-tip="Every step is replayed from the substrate when you edit, move, insert or delete one, so the flow is always consistent.<br><br><b>Click a step</b> to load it into the form on the left; <b>Apply edit</b> replaces it and replays the rest. Hover a step for ▲ ▼ (move), ＋ (insert a new step after it) and ✕ (delete). Steps that can no longer run (e.g. develop after the resist was removed) are marked red.<br><br>The thumbnails are the middle slice after each step, cropped to the material and stretched in height so thin layers show.<br><br><b>Several flows</b> — a project can keep several flows, for different device areas or as variants on the same one. Pick one in the list; only the chosen flow is simulated, so switching replays it from its substrate and starts its undo history afresh. <b>New</b> starts an empty flow on the sample chosen on the left, <b>Duplicate</b> copies this one, and the name field renames it.">?</span></div>
        <div class="row" style="gap:4px;margin:-2px 0 6px;flex-wrap:nowrap;">
          <select class="field" id="fabFlowSel" style="flex:1;min-width:0;" title="The process flows of this project; only the chosen one is simulated"></select>
          <button class="btn small" id="fabFlowNew" title="Start a new, empty process flow on the sample chosen on the left">New</button>
          <button class="btn small" id="fabFlowDup" title="Copy this process flow">Duplicate</button>
          <button class="btn small" id="fabFlowDel" title="Delete this process flow">Delete</button>
        </div>
        <div class="row" style="gap:6px;margin:0 0 8px;flex-wrap:nowrap;"><span class="label" style="margin:0;white-space:nowrap;">Flow name</span><input class="field" id="fabFlowName" style="flex:1;min-width:0;"></div>
        <div class="row" style="gap:4px;margin:-2px 0 8px;">
          <button class="btn small active" id="fabFlowExp">Expanded</button><button class="btn small" id="fabFlowCmp">Compact</button>
          <button class="btn small" id="fabCopy" style="margin-left:auto;" title="Copy the flow as text (for a report or lab book)">Copy flow</button>
        </div>
        <div id="fabFlow" class="flow"></div>
        <div class="row" style="margin-top:8px;">
          <button class="btn small" id="fabUndo">Undo</button><button class="btn small" id="fabRedo">Redo</button>
          <button class="btn small" id="fabReplay">Rebuild &amp; replay</button><button class="btn small" id="fabClear">Clear flow</button>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="btn small" id="fabExport">Export recipe…</button><button class="btn small" id="fabImport">Import recipe…</button>
          <span class="q" data-tip="Recipe files are the standalone studio's <code>EBL_recipe.json</code> format (substrate + steps) plus the sample choice. Recipes exported there import here; a free sample is used when the recipe has no device area.">?</span>
        </div>
      </div>
    </div>
  </div>`;

  const eng = createFabEngine();
  const st = {
    source: 'free', mode: '2d', budgetIdx: 1, built: false, sample: null, flow: [], history: [], future: [], editIdx: -1,
    view: 'cross', zSlice: 50, doseCache: new Map(), pendingDose: null, pendingMax: 0, thumbs: [], thumb0: null, restored: false, xZoom: 1, xCenter: 0.5, exag: 'auto',
    insertIdx: -1, compact: false, transparent: false,
  };
  try { st.compact = localStorage.getItem('ebw-fab-flow-compact') === '1'; } catch { /* no storage */ }
  const lib = () => app.project.library;
  const staleFab = staleOverlay($('fabWrap'), () => { staleFab.busy('Rebuilding and replaying…'); $('fabReplay').click(); });
  const iso = createIso($('fabCanvas3d'), { onFrame: (f) => { if (st.view === '3d') $('fabViewInfo').textContent = `${f.quads.toLocaleString()} quads · ${f.ms.toFixed(0)} ms${f.q > 1 ? ' · ÷' + f.q : ''}`; } });
  iso.setState(eng.state);

  // the Sample panel folds away (remembered in this browser); folded, one line says what is set up
  const FOLD_KEY = 'ebw-fab-sample-folded';
  function sampleSummary() {
    const src = $('fabSource'), o = src?.options[src.selectedIndex];
    const stack = [['Si', 'fabSi'], ['SiO₂', 'fabOx'], ['Poly-Si', 'fabPoly'], ['Au', 'fabMet']].filter(([, id]) => +$(id).value > 0).map(([n, id]) => `${n} ${+$(id).value} nm`).join(', ');
    const built = eng.state.W > 0;
    $('fabSampleSum').textContent = $('fabSampleBody').hidden ? [o ? o.textContent.replace(/\s*\(.*$/, '') : '', $('fabMode').value === '3d' ? '3D' : '2D cut', stack, `(${$('fabWSurf').value}) flat [${$('fabWFlat').value}]`, built ? 'built' : 'not built yet'].filter(Boolean).join(' · ') : '';
  }
  function setFolded(f) {
    $('fabSampleBody').hidden = f; $('fabSampleToggle').textContent = f ? '▸' : '▾';
    try { localStorage.setItem(FOLD_KEY, f ? '1' : '0'); } catch { /* storage blocked */ }
    sampleSummary();
  }
  $('fabSampleToggle').onclick = () => setFolded(!$('fabSampleBody').hidden);
  for (const ev of ['input', 'change']) $('fabSampleBody').addEventListener(ev, () => sampleSummary());
  $('fabBuild').addEventListener('click', () => setTimeout(sampleSummary, 50));
  try { if (localStorage.getItem(FOLD_KEY) === '1') setFolded(true); } catch { /* storage blocked */ }

  // legend: the resists on the sample (unexposed and exposed), else the studio's usual ones, then the rest
  let legendKey = '';
  function legend() {
    const rs = eng.state.resistStates || [];
    const resists = rs.length ? rs.flatMap((r) => [r.matId, r.matExpId]) : [M.PMMA, M.PMMA_EXP, M.CSAR, M.MEDUSA, M.S1813, M.SU8];
    const list = [M.AIR, ...new Set(resists), M.GRAPHENE, M.MOS2, M.HBN, M.AU, M.CR, M.AL, M.POLYSI, M.SIO2, M.SI3N4, M.SI], key = list.join();
    if (key === legendKey) return; legendKey = key;
    $('fabLegend').innerHTML = list.map((m) => `<span class="row" style="gap:5px;"><span style="display:inline-block;width:12px;height:12px;border:1px solid #aaa;background:rgb(${MAT_COLOR[m].join(',')})"></span>${esc(MAT_NAMES[m])}</span>`).join('');
  }
  legend();

  // ---------------------------------------------------------------- sample
  function sourceOptions() {
    // st.source is the truth (the select is kept in step by its onchange handler); a source
    // that no longer exists falls back to the first device area, then to the free sample
    const areas = deviceAreas(lib());
    const cur = st.source;
    $('fabSource').innerHTML = areas.map((a) => `<option value="area:${esc(a.id)}">Device area: ${esc(a.name)} (${um(a.w, 1)} × ${um(a.h, 1)})</option>`).join('')
      + `<option value="line">Exposure tab cut-line (2D)</option><option value="free">Free sample (no layout)</option>`;
    const known = [...$('fabSource').options].some((o) => o.value === cur);
    $('fabSource').value = known && !(cur === 'free' && areas.length && !st.sourceChosen) ? cur : areas.length ? `area:${areas[0].id}` : 'free';
    st.source = $('fabSource').value;
  }
  function budgetOptions() {
    const mode = st.source === 'free' ? null : st.source === 'line' ? '2d' : st.mode;
    const list = BUDGETS[mode || '2d'];
    $('fabBudget').innerHTML = list.map((b, i) => `<option value="${i}"${i === st.budgetIdx ? ' selected' : ''}>${esc(b.label)}</option>`).join('');
    $('fabBudget').disabled = !mode;
    $('fabMode').disabled = st.source !== 'area' && !st.source.startsWith('area:');
    $('fabFreeRow').style.display = st.source === 'free' ? '' : 'none';
  }
  function describeSample() {
    const nmVert = Math.max(0.2, parseFloat($('fabNmVert').value) || 2);
    const over = parseFloat($('fabNmLat').value);
    const override = over > 0 ? over : null;
    if (st.source === 'free') {
      const w = Math.max(50, parseFloat($('fabFreeW').value) || 1000), d = Math.max(20, parseFloat($('fabFreeD').value) || 500);
      const nmLat = override || 20;
      return { source: 'free', mode: '3d', w, d, nmLat, nmVert, W: Math.max(20, Math.round(w / nmLat)), D: Math.min(MAX_SLICES, Math.max(1, Math.round(d / nmLat))), label: `free sample ${um(w)} × ${um(d)}` };
    }
    if (st.source === 'line') {
      const line = app.exposureCutLine();
      const b = BUDGETS['2d'][st.budgetIdx] || BUDGETS['2d'][1];
      const smp = sampleForLine(line.a, line.b, b.columns, override);
      return { ...smp, source: 'line', mode: '2d', nmVert, label: `Exposure cut-line, ${um(smp.w, 1)}` };
    }
    const id = st.source.slice(5), area = deviceAreas(lib()).find((a) => a.id === id);
    if (!area) return null;
    const b = BUDGETS[st.mode][st.budgetIdx] || BUDGETS[st.mode][1];
    const smp = sampleFor(area, st.mode, b.columns, override);
    return { ...smp, source: 'area', areaId: id, areaName: area.name, mode: st.mode, nmVert, label: `${area.name}, ${st.mode === '3d' ? '3D' : '2D cut'}` };
  }
  function updateSampleInfo() {
    const smp = describeSample();
    if (!smp) { $('fabSampleInfo').innerHTML = '<span style="color:#a60">No device area with that id — draw one in Pattern Studio (tool 5).</span>'; return; }
    const mem = (smp.W * smp.D * 400) / 1e6;
    $('fabSampleInfo').innerHTML = `<b>${esc(smp.label)}</b>: ${smp.W} × ${smp.D} columns of <b>${smp.nmLat} nm</b>, ${smp.nmVert} nm vertical`
      + (smp.cropped ? ` <span style="color:#a60">(capped at ${MAX_SLICES} slices: the central ${um(smp.depthNm, 2)} of the ${um(smp.d, 2)} area is simulated)</span>` : '')
      + ` · about ${mem.toFixed(0)} MB per 400 rows${smp.nmLat > 10 && smp.source !== 'free' ? ` · features narrower than ~${3 * smp.nmLat} nm are not resolved` : ''}`;
    const isBuilt = st.built && st.sample && st.sample.source === smp.source && (smp.source !== 'area' || st.sample.areaId === smp.areaId) && st.sample.mode === smp.mode;
    $('fabSampleInfo').innerHTML += isBuilt ? ` · <span class="pill">built</span>` : st.built ? ` · <span class="pill">not built — Build sample</span>` : '';
    if ($('fabWInfo')) waferInfo();
  }
  $('fabSource').onchange = () => { st.source = $('fabSource').value; st.sourceChosen = true; budgetOptions(); updateSampleInfo(); };
  $('fabMode').onchange = () => { st.mode = $('fabMode').value; budgetOptions(); updateSampleInfo(); };
  $('fabBudget').onchange = () => { st.budgetIdx = +$('fabBudget').value; updateSampleInfo(); };
  for (const id of ['fabNmLat', 'fabNmVert', 'fabFreeW', 'fabFreeD']) $(id).oninput = updateSampleInfo;

  // ---------------------------------------------------------------- wafer orientation (project-wide)
  function waferStore() { const f = fabStore(); f.wafer = normalizeWafer(f.wafer); return f.wafer; }
  // the sample's x axis in the layout, degrees counter-clockwise from layout x
  function sampleAzimuth(smp) {
    if (!smp || smp.source === 'free' || smp.mode === '3d') return 0;
    if (smp.axis === 'y') return 90;
    if (smp.axis === 'line' && smp.cut) return (Math.atan2(smp.cut.b[1] - smp.cut.a[1], smp.cut.b[0] - smp.cut.a[0]) * 180) / Math.PI;
    return 0;
  }
  const flatLabel = (t) => String(t).split(' — ')[0];
  function renderWafer() {
    const w = waferStore();
    $('fabWSurf').value = w.surface;
    $('fabWFlat').innerHTML = WAFER_FLAT_LIST[w.surface].map(([k, v]) => `<option value="${esc(k)}"${k === w.flat ? ' selected' : ''} title="${esc(v)}">${esc(flatLabel(v))}</option>`).join('');
    if (document.activeElement !== $('fabWRot')) $('fabWRot').value = w.rot;
    waferInfo();
  }
  function waferInfo() {
    const w = waferStore(), smp = describeSample();
    const az = sampleAzimuth(smp), b = waferBasis(w, az);
    const flatTip = flatLabelOf(w.surface, w.flat);
    const dirs = smp && smp.mode === '2d'
      ? `this cut runs along <b>${dirLabel(b.x)}</b> (into the page: ${dirLabel(b.z)})`
      : `this sample: x ∥ <b>${dirLabel(b.x)}</b>, depth axis ∥ <b>${dirLabel(b.z)}</b>`;
    $('fabWInfo').innerHTML = `(${w.surface}) wafer, flat ${esc(flatLabel(flatTip))}${w.rot ? ` at ${w.rot}° to layout x` : ' ∥ layout x'} · ${dirs} · surface normal ${dirLabel(b.up)}`;
  }
  async function waferChanged() {
    const f = fabStore();
    f.wafer = normalizeWafer({ surface: $('fabWSurf').value, flat: $('fabWFlat').value, rot: parseFloat($('fabWRot').value) || 0 });
    renderWafer(); app.markDirty?.('fab');
    // the wafer only acts through KOH steps; a flow with one is replayed on the new wafer
    if (st.built) {
      buildFromForm(true);
      if (st.flow.some((x) => x.type === 'etch_koh')) await replayAll(st.flow); else { persist(); render(); }
    }
    if ($('fabStep').value === 'etch_koh') kohHint();
  }
  $('fabWSurf').onchange = () => { const f = fabStore(); f.wafer = normalizeWafer({ ...f.wafer, surface: $('fabWSurf').value, flat: null }); renderWafer(); waferChanged(); };
  $('fabWFlat').onchange = waferChanged;
  $('fabWRot').onchange = waferChanged;

  function substrateForm() {
    // no negative thicknesses; the fields show what is used
    const v = (id, d, min) => { const x = parseFloat($(id).value); const r = Number.isFinite(x) ? Math.max(min, x) : d; if (String(r) !== $(id).value) $(id).value = r; return r; };
    return { si: v('fabSi', 200, 20), ox: v('fabOx', 0, 0), poly: v('fabPoly', 0, 0), met: v('fabMet', 0, 0), headroom: v('fabHead', 300, 100) };
  }
  // rows of the voxel grid a build would need (E3: Si = 1 000 000 nm ran the browser out of memory)
  const MAX_ROWS = 6000;
  function tooTall(sub, nmVert) {
    const rows = Math.round((sub.si + sub.ox + sub.poly + sub.met + sub.headroom) / nmVert);
    return rows > MAX_ROWS ? `The stack would be ${rows.toLocaleString()} voxel rows tall (limit ${MAX_ROWS.toLocaleString()}): use a thinner substrate (only the top few hundred nm matter) or a larger vertical voxel.` : null;
  }
  function buildFromForm(keepFlow = false) {
    const smp = describeSample();
    if (!smp) return false;
    st.sample = smp;
    const form = substrateForm(), tall = tooTall(form, smp.nmVert);
    if (tall) { $('fabBuildInfo').innerHTML = `<span style="color:#c00">${esc(tall)}</span>`; toast(esc(tall), 6000); return false; }
    const sub = { ...form, nmLat: smp.nmLat, nmVert: smp.nmVert, w: smp.w, d: smp.source === 'free' ? smp.d : smp.depthNm, wfW: Math.max(smp.w, 1500), wfD: Math.max(smp.source === 'free' ? smp.d : smp.depthNm, 1000) };
    // layout samples: exactly the slices the dose maps have (the engine's 10 nm minimum depth would
    // otherwise give a 2D cut with voxels under 10 nm two slices and one dose map)
    if (smp.source !== 'free') sub.maxSlices = smp.D;
    sub.wafer = waferStore(); sub.azimuth = sampleAzimuth(smp);
    eng.buildSubstrate(sub);
    st.thumb0 = sliceThumbData(eng.state);
    st.built = true;
    if (!keepFlow) { st.flow = []; st.thumbs = []; st.history = []; st.future = []; st.editIdx = -1; }
    st.pendingMaps = null;                    // the preview belongs to the old sample
    queueMicrotask(updatePendingDose);
    $('fabBuildInfo').innerHTML = `Sample built: <b>${eng.state.W} × ${eng.state.H} × ${eng.state.D}</b> voxels (${um(eng.state.W * eng.state.nmLat, 1)} wide, ${Math.round(eng.state.H * eng.state.nmVert)} nm tall${eng.state.D > 1 ? `, ${um(eng.state.D * eng.state.nmLat, 1)} deep` : ''}).`;
    return true;
  }
  $('fabBuild').onclick = () => {
    if (st.flow.length && !confirm('Rebuilding the sample clears the process flow. Continue?')) return;
    if (buildFromForm(false)) { staleFab.hide(); renderFlow(); render(); persist(); updateSampleInfo(); }
  };

  // ---------------------------------------------------------------- dose from the layout
  async function fetchDose(smp) {
    const key = `${app.version}|${smp.source}|${smp.areaId || ''}|${smp.mode}|${smp.nmLat}|${smp.W}|${smp.D}|${smp.source === 'line' ? JSON.stringify(smp.cut) : ''}`;
    if (st.doseCache.has(key)) return st.doseCache.get(key);
    const client = app.exposure;
    client.setProject(app.project, app.version);
    let maps;
    if (smp.source === 'line') {
      const r = await client.request('points', { points: smp.points, fields: ['delivered'] });
      maps = [Float32Array.from(r.values.delivered)];
    } else {
      const r = await client.request('raster', { grid: smp.grid, field: 'delivered' });
      maps = doseMapsFromRaster(smp, r.data);
    }
    if (st.doseCache.size > 6) st.doseCache.delete(st.doseCache.keys().next().value);
    st.doseCache.set(key, maps);
    return maps;
  }
  async function ctxFor(step) {
    if ((step.type === 'expose' || step.type === 'uv_expose') && step.params.source === 'layout') {
      if (!st.sample || st.sample.source === 'free') throw new Error('a layout exposure needs a device area or the cut-line as the sample');
      const maps = await fetchDose(st.sample);
      const k = +step.params.scale || 1;
      return { doseMaps: k === 1 ? maps : maps.map((m) => m.map((v) => v * k)) };
    }
    return undefined;
  }

  // ---------------------------------------------------------------- step form
  const resistOptions = () => Object.entries(RESIST_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  // ---- Learning / Advanced (project setting; Learning by default)
  const level = () => (app.project.settings?.fabLevel === 'advanced' ? 'advanced' : 'learning');
  let formLevel = 'learning';
  const learningOptions = () => [...LEARNING_RESISTS, 'custom'].map((k) => `<option value="${k}">${esc(RESIST_LABELS[k] || k)}</option>`).join('');
  const libraryOptions = () => { const lib = app.resists?.library() || []; return ['positive', 'negative'].map((t) => `<optgroup label="${t === 'positive' ? 'Positive' : 'Negative'} (resist library)">${lib.filter((r) => r.tone === t && LIBRARY_PRESETS[r.id]).map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</optgroup>`).join(''); };
  const condLabel = (c) => `${c.kV} kV, ${c.thicknessNm} nm, ${DEVELOPERS[c.developer] || c.developer} ${c.timeS} s, ${c.tempC} °C`;
  // a library resist's curves, by quality (the user's own and imported ones included)
  function curveOptions(libId) {
    const e = app.resists?.entryOf(libId); if (!e) return '';
    let h = `<option value="model">Library reference — ${esc(condLabel(e.model.ref))} (${esc(e.model.refBasis || '')})</option>`;
    for (const [q, name] of [['measured', 'Measured'], ['datasheet', 'Datasheet'], ['literature', 'Literature'], ['estimate', 'Best guesses']]) {
      const ds = (e.datasets || []).filter((d) => d.quality === q && d.fit && !d.superseded);
      if (ds.length) h += `<optgroup label="${name}">${ds.map((d) => `<option value="${esc(d.id)}">${esc(condLabel(d.conditions))} · ${esc(d.id)}${d.from ? ` · from ${esc(d.from)}` : ''}</option>`).join('')}</optgroup>`;
    }
    return h;
  }
  function curveOf(libId, id) {
    const e = app.resists?.entryOf(libId); if (!e) return null;
    if (id === 'model' || !id) { const R = e.model.ref; return { D100: R.D100, gamma: R.gamma, round: R.round ?? 0.5, cond: R, tone: e.tone, label: 'the library reference' }; }
    const d = (e.datasets || []).find((x) => x.id === id);
    return d ? { D100: d.fit.D100, gamma: d.fit.gamma, round: d.fit.round ?? 0.5, cond: d.conditions, tone: e.tone, label: `${d.quality} curve ${d.id}` } : null;
  }
  // a library resist's own extra conditions (Medusa: PEB): the process value and the curve's, side by side
  function extrasForm(lib, cur = {}, cal = {}) {
    const e = app.resists?.entryOf(lib), X = e?.model.extra || [], el = $('fpXtra'); if (!el) return;
    el.innerHTML = X.map((x) => `${numField('fpX_' + x.key, `${esc(x.short || x.name)} — this process (${esc(x.unit)})`, cur[x.key] ?? e.model.ref[x.key], 5)}${numField('fpXc_' + x.key, `${esc(x.short || x.name)} of the curve (${esc(x.unit)})`, cal[x.key] ?? e.model.ref[x.key], 5)}`).join('') + (X.length ? '<div></div>' : '');
    for (const x of X) { $('fpX_' + x.key).oninput = () => { curveNote(); drawCurve(); }; $('fpXc_' + x.key).oninput = () => { curveNote(); drawCurve(); }; }
  }
  const extrasOf = (lib, prefix) => Object.fromEntries((app.resists?.entryOf(lib)?.model.extra || []).map((x) => [x.key, num(prefix + x.key, null)]));
  // the developers a resist on the sample can be developed in: a library resist's own, else the studio's
  function developerOptionsFor(target) {
    const rs = sampleResist(target), lib = rs?.devParams?.lib || (rs ? null : RESIST_PRESETS[target]?.lib);
    const list = lib ? LIBRARY_PRESETS[lib].developers : Object.keys(STUDIO_DEVELOPERS);
    return list.map((k) => `<option value="${k}">${esc(DEVELOPERS[k] || k)}</option>`).join('');
  }
  function paramsHtml(type, lvl = level()) {
    switch (type) {
      case 'deposit': return `<div class="three">${sel('fpMat', 'Material', DEPOSIT_MATERIALS)}${numField('fpThick', 'Thickness (nm)', 30, 1)}${sel('fpMethod', 'Method', { directional: 'Directional (evaporation)', conformal: 'Conformal (sputtering / CVD)' })}</div>`;
      case 'transfer_2d': return `<div class="three">${sel('fpTMat', 'Material', TRANSFER_MATERIALS)}${numField('fpTSize', 'Flake size (nm)', 140, 10)}${numField('fpTThick', 'Layer (nm)', 1, 1)}</div>`;
      case 'spinresist': if (lvl === 'advanced') return `<div class="two"><div><div class="label">Resist (library)</div><select class="field" id="fpPreset">${libraryOptions()}</select></div><div><div class="label">Contrast curve <span class="q" data-tip="The curves the resist library holds for this resist — measured at DTU, datasheets, literature, best guesses, and your own — each for its own conditions. The film thickness, the development and the voltage it was measured at are filled in below.">?</span></div><select class="field" id="fpCurveSel"></select></div>${numField('fpRThick', 'Thickness (nm)', 100, 5)}
        <div><div class="label">Tone</div><select class="field" id="fpType" disabled><option value="positive">positive</option><option value="negative">negative</option></select></div>
        ${numField('fpGamma', 'Contrast γ', 3, 0.1)}${numField('fpSoft', 'Kink rounding (%)', 30, 10, 'min="0" max="100"')}${numField('fpD100', 'D₁₀₀ (µC/cm²)', 250, 10)}${numField('fpDark', 'Dark erosion (nm/min)', 0.1, 0.1)}${numField('fpSide', 'Sidewall (°)', 90, 1)}${numField('fpScum', 'Scum (nm)', 1, 0.5)}</div><div hidden>${numField('fpClear', 'Clearing dose frac.', 0.5, 0.05)}</div>
        <div class="label" style="margin-top:6px;">The curve was measured at <span class="q" data-tip="A contrast curve holds for one film thickness, one voltage and one development. When the film you spin, the PSF's voltage or the develop step differ, the develop step moves the curve with the resist library's model, and says whether that is inside the process window or extrapolated.">?</span></div>
        <div class="three">${sel('fpCalDev', 'Developer', DEVELOPERS)}${numField('fpDevT', 'Time (s)', 60, 5)}${numField('fpCalT', 'Temperature (°C)', 21, 0.5)}${numField('fpCalTh', 'Film (nm)', 100, 5)}${numField('fpCalKV', 'Voltage (kV)', 100, 5)}<div></div></div>
        <div class="three" id="fpXtra"></div>
        <div class="hint" id="fpCurveNote" style="margin-top:4px;"></div>
        <canvas id="fpCurve" style="width:100%;height:120px;display:block;margin-top:6px;"></canvas><div class="hint">The curve as measured (remaining thickness vs dose, log axis). Advanced: the resist library's resists and curves; Learning: the studio's teaching resists.</div>`;
        return `<div class="two"><div><div class="label">Resist</div><select class="field" id="fpPreset">${learningOptions()}</select></div>${numField('fpRThick', 'Thickness (nm)', 80, 5)}
        <div><div class="label">Tone</div><select class="field" id="fpType"><option value="positive">positive</option><option value="negative">negative</option></select></div><div></div>
        ${numField('fpGamma', 'Contrast γ', 7, 0.5)}${numField('fpSoft', 'Kink rounding (%) <span class="q" data-tip="Rounds the two corners of the contrast curve, at D₀ and D₁₀₀, without changing γ: the tangent at D₅₀ keeps its slope and still meets 1 and 0 at D₀ and D₁₀₀. 0 = the ideal piecewise curve; a real resist is more like 20–50.">?</span>', 100, 10, 'min="0" max="100"')}${numField('fpD100', 'D₁₀₀ (µC/cm²)', 450, 10)}${numField('fpDark', 'Dark erosion (nm/min)', 2, 0.5)}${numField('fpSide', 'Sidewall (°)', 90, 1)}${numField('fpScum', 'Scum (nm)', 2, 0.5)}</div><div hidden>${numField('fpClear', 'Clearing dose frac.', 0.5, 0.05)}</div>
        <div class="label" style="margin-top:6px;">Curve measured with <span class="q" data-tip="A contrast curve (D₀, D₁₀₀, γ) holds only for the development it was measured with: this developer, this time, this temperature (and this thickness). The develop step compares its own conditions with these and warns when they differ — the model does not know how the curve would change.<br><br>The presets' values are illustrative teaching values: put in the conditions of the curve you actually measured.">?</span></div>
        <div class="three">${sel('fpCalDev', 'Developer', STUDIO_DEVELOPERS)}${numField('fpDevT', 'Time (s)', 60, 5)}${numField('fpCalT', 'Temperature (°C)', 21, 0.5)}</div>
        <canvas id="fpCurve" style="width:100%;height:120px;display:block;margin-top:6px;"></canvas><div class="hint">Contrast curve of this resist (remaining thickness vs dose, log axis). Changing the preset fills the parameters from the studio's table — illustrative teaching values (Learning). Real resists and measured curves: <b>Advanced</b>.</div>`;
      case 'expose': case 'uv_expose': return `<div class="label">Dose from</div><select class="field" id="fpSource"><option value="layout">the layout — delivered dose of the Exposure tab (PSF, written doses)</option><option value="pattern">a built-in pattern (studio patterns)</option><option value="custom">shapes drawn here (mask editor)</option></select>
        <div id="fpLayoutRow" style="margin-top:6px;"><div class="two">${numField('fpScale', 'Dose scale ×', 1, 0.05)}<div class="hint" style="align-self:end;">Multiplies the layout dose: try over- and under-exposure without touching the layout.</div></div>
          <div class="hint" id="fpScaleHint" style="margin-top:4px;"></div></div>
        <div id="fpPatternRow" style="display:none;margin-top:6px;"><div class="three">${sel('fpPattern', 'Pattern', { grating: 'Grating', single: 'Single line', iso_trench: 'Isolated trench', dots: 'Dot array', blanket: 'Blanket' })}${numField('fpDose', type === 'uv_expose' ? 'Dose (mJ/cm²)' : 'Dose (µC/cm²)', type === 'uv_expose' ? 90 : 150, 10)}${numField('fpPitch', 'Pitch (nm)', 200, 10)}${numField('fpDuty', 'Duty (%)', 50, 5)}${numField('fpLineW', 'Line width (nm)', 100, 5)}${numField('fpDotPitch', 'Dot pitch (nm)', 100, 10)}${numField('fpDotDiam', 'Dot Ø (nm)', 50, 5)}${numField('fpDotSlice', 'Dot slice (%)', 0, 5)}</div></div>
        <div id="fpMaskRow" style="display:none;margin-top:6px;"><div id="fpMaskHost"></div><div class="hint">The field is the write field; only the part inside the dashed sample reaches the wafer. Each shape keeps its own dose. Right-click a shape to delete it.</div></div>
        <canvas id="fpCurve" style="width:100%;height:110px;display:block;margin-top:6px;"></canvas><div class="hint" id="fpCurveHint"></div>`;
      case 'develop': return `<div class="two"><div><div class="label">Resist</div><select class="field" id="fpTarget">${resistOptions()}</select></div><div><div class="label">Developer</div><select class="field" id="fpChem">${developerOptionsFor(null)}</select></div>${numField('fpTime', 'Time (s)', 60, 5)}${numField('fpTemp', 'Temperature (°C)', 21, 0.5)}</div><div class="hint" id="fpDevHint" style="margin-top:4px;"></div>
        <canvas id="fpCurve" style="width:100%;height:110px;display:block;margin-top:6px;"></canvas><div class="hint" id="fpCurveHint"></div>`;
      case 'descum': return `<div class="three">${numField('fpDTime', 'O₂ plasma (s)', 30, 1)}${numField('fpDRate', 'Resist rate (nm/s)', 0.5, 0.05)}${numField('fpDGr', 's per graphene ML', 30, 1)}</div><div class="hint" id="fpDSum" style="margin-top:4px;"></div>`;
      case 'etch_rie': return `<div class="three">${sel('fpETarget', 'Target', ETCH_MATERIALS)}${numField('fpEDepth', 'Depth (nm)', 80, 5)}${numField('fpESel', 'Selectivity to resist', 10, 1)}</div>`;
      case 'etch_sf6': return `<div class="two">${numField('fpSDepth', 'Depth (nm)', 15, 1)}</div>`;
      case 'etch_wet': return `<div class="two">${sel('fpWTarget', 'Target', ETCH_MATERIALS)}${numField('fpWDepth', 'Depth (nm)', 50, 5)}</div><div class="hint">Isotropic (e.g. BHF on SiO₂): every exposed face of the target recedes by the depth, so a pinhole in the mask etches a hemisphere and the undercut under a mask edge equals the depth. Other materials are not attacked; the etch goes round them.</div>`;
      case 'etch_koh': return `<div class="two">${sel('fpKConc', 'KOH (wt %)', { 30: '30 %', 40: '40 %', 50: '50 %' })}${numField('fpKTemp', 'Temperature (°C)', 80, 1)}${numField('fpKTime', 'Time (s)', 20, 1)}${numField('fpKOx', 'SiO₂ rate (nm/min) <span class="q" data-tip="How fast KOH thins a SiO₂ mask. Blank = (100) rate / 182 (Williams &amp; Muller: about 7.7 nm/min for thermal oxide in 30 % KOH at 80 °C). Si₃N₄ is not attacked.">?</span>', '', 0.5, 'placeholder="auto"')}</div>`
        + `<div style="margin-top:6px;">${sel('fpKMethod', 'Method <span class="q" data-tip="Auto: a 2D cut, or a 3D sample that is the same in every slice (a line, a trench), is etched by tracking the crystal facets themselves (Wulff–Jaccodine): exact planes, any etch time in milliseconds. Other 3D samples use the level set. Level set, fast: a coarser vertical cell, several times faster, edges a few nm off. A result for the same sample and settings is reused (undo, redo, replay).">?</span>', KOH_METHODS)}</div>`
        + `<div class="hint" id="fpKHint" style="margin-top:4px;"></div><div class="hint">Single-crystal Si is etched at a rate that depends on its crystal plane (Sato et al., Sens. Actuators A 64 (1998) 87): {111} planes are almost a stop, so mask edges along &lt;110&gt; on a (100) wafer give 54.7° walls and V-grooves that stop by themselves, while convex corners are undercut. The wafer orientation is set under <b>Wafer orientation</b>. Poly-Si is etched isotropically, SiO₂ slowly, Al quickly; Si₃N₄ and metals are masks (resist is kept as a mask, with a warning: hot KOH attacks most resists).</div>`;
      case 'liftoff': return `<div class="hint">Removes all resist, then everything no longer connected to the substrate.</div>`;
      case 'strip': return `<div class="hint">Removes all resist.</div>`;
      default: return '';
    }
  }
  const sel = (id, label, o, cur) => `<div><div class="label">${label}</div><select class="field" id="${id}">${opt(o, cur)}</select></div>`;
  const val = (id) => $(id)?.value;
  const num = (id, d) => { const v = parseFloat($(id)?.value); return Number.isFinite(v) ? v : d; };

  function readParams(type) {
    switch (type) {
      case 'deposit': return { material: val('fpMat'), thickness: num('fpThick', 30), method: val('fpMethod') };
      case 'transfer_2d': return { material: val('fpTMat'), flakeSize: num('fpTSize', 140), layerThick: num('fpTThick', 1) };
      case 'spinresist': return { thickness: num('fpRThick', 80), type: val('fpType'), resist: val('fpPreset'), dose: RESIST_PRESETS[val('fpPreset')]?.dose || 150, contrast: num('fpGamma', 3), soft: num('fpSoft', 0) / 100, D100: num('fpD100', 120), darkErosion: num('fpDark', 2), sidewall: num('fpSide', 90), scum: num('fpScum', 0), clearFrac: num('fpClear', 0.5), devTime: num('fpDevT', 60), calDeveloper: val('fpCalDev'), calTimeS: num('fpDevT', 60), calTempC: num('fpCalT', 21),
        ...($('fpCurveSel') ? { lib: val('fpPreset'), curveId: val('fpCurveSel'), calThicknessNm: num('fpCalTh', null), calKV: num('fpCalKV', null), type: LIBRARY_PRESETS[val('fpPreset')]?.type || val('fpType'),
          extras: extrasOf(val('fpPreset'), 'fpX_'), calExtras: extrasOf(val('fpPreset'), 'fpXc_') } : {}) };
      case 'expose': case 'uv_expose': {
        if (val('fpSource') === 'layout') return { source: 'layout', scale: num('fpScale', 1), pattern: 'layout' };
        if (val('fpSource') === 'custom') { const sh = maskEd().getShapes(); return { source: 'custom', pattern: 'custom', dose: sh.length ? Math.max(...sh.map((x) => x.dose)) : 0, maskShapes: sh, ...(type === 'uv_expose' ? { doseUnit: 'mJ/cm²' } : {}) }; }
        return { source: 'pattern', pattern: val('fpPattern'), dose: num('fpDose', 150), pitch: num('fpPitch', 200), duty: num('fpDuty', 50), lineW: num('fpLineW', 100), dotPitch: num('fpDotPitch', 100), dotDiam: num('fpDotDiam', 50), dotSlice: num('fpDotSlice', 0), ...(type === 'uv_expose' ? { doseUnit: 'mJ/cm²' } : {}) };
      }
      case 'develop': { const t = val('fpTarget'); const rs = eng.state.resistStates.find((r) => r.name === t); const dp = rs?.devParams || RESIST_PRESETS[t] || {}; return { targetResist: t, developer: val('fpChem'), devTime: num('fpTime', 60), tempC: num('fpTemp', 21), kV: psfKeV(app.project), sidewall: dp.sidewall || 90, contrast: dp.contrast || 3, darkErosion: dp.darkErosion || 2, clearFrac: dp.clearFrac || 0.5, D100: dp.D100 || 120, scum: dp.scum || 0 }; }
      case 'descum': return { time: num('fpDTime', 30), rate: num('fpDRate', 0.5), grSecPerML: num('fpDGr', 30) };
      case 'etch_rie': return { target: val('fpETarget'), depth: num('fpEDepth', 80), selectivity: num('fpESel', 10) };
      case 'etch_sf6': return { depth: num('fpSDepth', 15) };
      case 'etch_wet': return { target: val('fpWTarget'), depth: num('fpWDepth', 50) };
      case 'etch_koh': { const ox = parseFloat($('fpKOx')?.value), method = val('fpKMethod') || 'auto'; return { conc: +val('fpKConc') || 30, temp: num('fpKTemp', 80), time: num('fpKTime', 20), ...(Number.isFinite(ox) ? { oxRate: ox } : {}), ...(method !== 'auto' ? { method } : {}) }; }
      default: return {};
    }
  }
  function fillParams(type, p) {
    const set = (id, v) => { const e = $(id); if (e && v != null) e.value = v; };
    switch (type) {
      case 'deposit': set('fpMat', p.material); set('fpThick', p.thickness); set('fpMethod', p.method); break;
      case 'transfer_2d': set('fpTMat', p.material); set('fpTSize', p.flakeSize); set('fpTThick', p.layerThick); break;
      case 'spinresist': set('fpPreset', p.lib || p.resist); if (p.lib && $('fpCurveSel')) { $('fpCurveSel').innerHTML = curveOptions(p.lib); set('fpCurveSel', p.curveId || 'model'); set('fpCalTh', p.calThicknessNm); set('fpCalKV', p.calKV); extrasForm(p.lib, p.extras || {}, p.calExtras || {}); } set('fpRThick', p.thickness); set('fpType', p.type); set('fpGamma', p.contrast); set('fpSoft', Math.round(100 * (p.soft || 0))); set('fpD100', p.D100); set('fpDark', p.darkErosion); set('fpSide', p.sidewall); set('fpScum', p.scum); { const c = calibrationOf(p, RESIST_PRESETS[p.resist]); set('fpDevT', c.timeS); set('fpCalDev', c.developer); set('fpCalT', c.tempC); } set('fpClear', p.clearFrac ?? 0.5); curveNote(); drawCurve(); break;
      case 'expose': case 'uv_expose': set('fpSource', p.source === 'layout' ? 'layout' : p.source === 'custom' || p.pattern === 'custom' ? 'custom' : 'pattern'); if (p.source === 'custom' || p.pattern === 'custom') maskEd().setShapes(p.maskShapes); set('fpScale', p.scale ?? 1); set('fpPattern', p.pattern === 'custom' || p.pattern === 'layout' ? 'grating' : p.pattern); set('fpDose', p.dose); set('fpPitch', p.pitch); set('fpDuty', p.duty); set('fpLineW', p.lineW); set('fpDotPitch', p.dotPitch); set('fpDotDiam', p.dotDiam); set('fpDotSlice', p.dotSlice); syncExposeRows(); break;
      case 'develop': set('fpTarget', p.targetResist); $('fpChem').innerHTML = developerOptionsFor(p.targetResist); set('fpChem', p.developer); set('fpTime', p.devTime); set('fpTemp', p.tempC ?? calOfTarget(p.targetResist).tempC); devHint(); drawCurve(); break;
      case 'descum': set('fpDTime', p.time); set('fpDRate', p.rate); set('fpDGr', p.grSecPerML); descumSummary(); break;
      case 'etch_rie': set('fpETarget', p.target); set('fpEDepth', p.depth); set('fpESel', p.selectivity); break;
      case 'etch_sf6': set('fpSDepth', p.depth); break;
      case 'etch_wet': set('fpWTarget', p.target); set('fpWDepth', p.depth); break;
      case 'etch_koh': set('fpKConc', p.conc); set('fpKTemp', p.temp); set('fpKTime', p.time); set('fpKMethod', p.method || 'auto'); if ($('fpKOx')) $('fpKOx').value = p.oxRate ?? ''; kohHint(); break;
      default: break;
    }
  }
  // the mask editor: one instance, moved into each expose form, so the drawing survives step changes
  let maskEditor = null;
  function maskField() {
    const e = eng.state;
    if (st.built && e.W > 0) return { wfW: e.wfW, wfD: e.wfD, sampleW: e.sampleWnm, sampleD: e.sampleDepthNm };
    const w = Math.max(50, parseFloat($('fabFreeW').value) || 1000), d = Math.max(20, parseFloat($('fabFreeD').value) || 500);
    return { wfW: Math.max(w, 1500), wfD: Math.max(d, 1000), sampleW: w, sampleD: d };
  }
  function maskEd() {
    if (!maskEditor) maskEditor = createMaskEditor({ field: maskField, onChange: () => updatePendingDose() });
    return maskEditor;
  }
  function syncExposeRows() {
    const source = val('fpSource'), layout = source === 'layout', custom = source === 'custom';
    if ($('fpLayoutRow')) $('fpLayoutRow').style.display = layout ? '' : 'none';
    if ($('fpPatternRow')) $('fpPatternRow').style.display = layout || custom ? 'none' : '';
    if ($('fpMaskRow')) {
      $('fpMaskRow').style.display = custom ? '' : 'none';
      if (custom) { const ed = maskEd(); if (ed.el.parentElement !== $('fpMaskHost')) $('fpMaskHost').appendChild(ed.el); ed.setUnit($('fabStep').value === 'uv_expose' ? 'mJ/cm²' : 'µC/cm²'); requestAnimationFrame(ed.fit); }
    }
    if (layout && st.sample?.source === 'free') $('fabStatus').innerHTML = '<span style="color:#a60">The free sample has no layout: choose a device area or the cut-line as the sample, or use a built-in pattern.</span>';
    updatePendingDose();
  }
  function devHint() {
    const t = val('fpTarget'), chem = val('fpChem'), rs0 = sampleResist(t), p = presetOf(t, rs0?.devParams?.lib);
    const present = eng.state.resistStates.some((r) => r.name === t);
    const dc = developConditions(rs0?.devParams || { lib: p?.lib }, p, { developer: chem, timeS: num('fpTime', 60), tempC: num('fpTemp', 21) }, psfKeV(app.project));
    const calText = dc.calibration.outside ? (dc.move ? trimCalText(dc.calibration.text) : dc.calibration.text) : null;
    const dev = dc.outside ? { outside: true, text: [calText, ...dc.other.map((o) => `${o} — the curve's conditions differ`)].filter(Boolean).join('; ') } : dc.calibration;
    const nStack = eng.state.resistStates.length, inStack = eng.state.resistStates.some((r) => r.name === t);
    $('fpDevHint').innerHTML = (nStack >= 2 && inStack ? `<div class="hint" id="fpBilayer" style="margin-bottom:3px;">A ${nStack}-layer resist stack: develop each layer as its own step, in the same developer, top layer first — in the lab one development dissolves them together. A more sensitive bottom layer (e.g. PMMA 50K under 950K) opens wider: the undercut for lift-off.</div>` : '')
      + (present ? '' : `<span style="color:#a60">No ${esc(t)} on the sample yet. </span>`) + (p ? (p.developers.includes(chem) ? `${esc(DEVELOPERS[chem])} is a usual developer for ${esc(t)}. ` : `<span style="color:#a60">${esc(DEVELOPERS[chem] || chem)} is unusual for ${esc(t)} (advisory only). </span>`) : '')
      + (dev.outside ? `<div id="fpDevWarn" style="color:#b45309;margin-top:4px;">⚠ ${esc(dev.text)}</div>` : `<span style="color:#15803d">✓ ${esc(dev.text)}</span>`);
    // a library resist: the model moves the curve, and says whether that is inside the process window
    const mv = dc.move;
    if (mv) $('fpDevHint').innerHTML += `<div id="fpDevMove" class="${mv.regime === 'window' ? 'fab-mv-win' : 'fab-mv-ext'}" style="margin-top:3px;">${mv.regime === 'window' ? 'ℹ' : '⚠'} ${esc(describeMove(mv))}</div>`;
  }
  // the resist on the sample that a step acts on (the last one spun, or the one named)
  function sampleResist(name) {
    const rs = eng.state.resistStates;
    const r = name ? rs.find((x) => x.name === name) : rs[rs.length - 1];
    return r || null;
  }
  // the development the target resist's contrast curve was measured for (from its spin step, else its preset)
  const calOfTarget = (name) => { const rs = sampleResist(name); return calibrationOf(rs?.devParams || {}, presetOf(name, rs?.devParams?.lib)); };
  // Advanced spin step: the chosen curve against the film you spin and the PSF's voltage (the develop
  // step moves it the same way, with the development too)
  function curveNote() {
    const el = $('fpCurveNote'); if (!el) return;
    const lib = val('fpPreset'), cal = { developer: val('fpCalDev'), timeS: num('fpDevT', 60), tempC: num('fpCalT', 21) };
    const dp = { lib, D100: num('fpD100', 120), contrast: num('fpGamma', 3), resistThick: num('fpRThick', 100), calThicknessNm: num('fpCalTh', null), calKV: num('fpCalKV', null), calDeveloper: cal.developer, calTimeS: cal.timeS, calTempC: cal.tempC, extras: extrasOf(lib, 'fpX_'), calExtras: extrasOf(lib, 'fpXc_') };
    const dc = developConditions(dp, LIBRARY_PRESETS[lib], cal, psfKeV(app.project));
    const c = curveOf(lib, val('fpCurveSel'));
    el.innerHTML = `${c ? `Curve: ${esc(c.label)} — ${esc(condLabel({ kV: dp.calKV, thicknessNm: dp.calThicknessNm, ...cal }))}. ` : ''}`
      + (dc.other.length ? `<span class="fab-mv-${dc.move?.regime === 'window' ? 'win' : 'ext'}" id="fpCurveWarn">⚠ This sample: ${esc(dc.other.join('; '))}. The curve strictly holds for one film and voltage: the develop step will move it with the library's model — ${esc(describeMove(dc.move))}.</span>`
        : `<span style="color:#15803d">✓ This film and the PSF's ${psfKeV(app.project)} kV match the curve.</span> Develop as it was measured to use it as it is.`);
  }
  const resistModel = (rs) => { const p = rs.devParams || {}; return makeResist({ D100: p.D100 || 120, gamma: p.contrast || 3, round: p.soft || 0, tone: rs.type || 'positive', scumNm: p.scum || 0, thicknessNm: p.resistThick || 100 }); };
  function maxDoseOf(maps) { let mx = 0; if (maps) for (const m of maps) for (const v of m) if (v > mx) mx = v; return mx; }
  function drawCurve() {
    const c = $('fpCurve'); if (!c) return;
    const type = $('fabStep').value;
    let r, marks = [], hint = '';
    if (type === 'spinresist') r = makeResist({ D100: num('fpD100', 120), gamma: num('fpGamma', 3), round: num('fpSoft', 0) / 100, tone: val('fpType'), scumNm: num('fpScum', 0), thicknessNm: num('fpRThick', 80) });
    else {
      const rs = sampleResist(type === 'develop' ? val('fpTarget') : null);
      if (!rs) { c.style.display = 'none'; if ($('fpCurveHint')) $('fpCurveHint').textContent = 'No resist on the sample yet: spin one first.'; return; }
      c.style.display = 'block'; r = resistModel(rs);
      if (type === 'develop') {
        const mx = maxDoseOf(rs.doseMaps || (rs.doseMap ? [rs.doseMap] : null));
        if (mx > 0) { marks.push({ d: mx, label: 'max dose received', col: '#d13' }); hint = mx < r.D0 ? `<span style="color:#b45309">The highest dose this ${esc(rs.name)} received (${mx.toFixed(0)} µC/cm²) is below D₀ = ${r.D0.toFixed(0)}: nothing will develop.</span>` : `Highest dose received ${mx.toFixed(0)} µC/cm² (D₁₀₀ ${r.D100.toFixed(0)}).`; }
        else hint = `<span style="color:#b45309">This ${esc(rs.name)} has not been exposed.</span>`;
      } else if (val('fpSource') === 'layout') {
        const mx = maxDoseOf(st.pendingMaps), nom = layoutDose(), k = num('fpScale', 1);
        if (mx > 0) marks.push({ d: mx, label: 'max', col: '#d13' });
        marks.push({ d: (nom * k) / 2, label: '½ nominal', col: '#888' });
      } else if (val('fpSource') === 'custom') { const ds = [...new Set(maskEd().getShapes().map((x) => x.dose))].sort((p, q) => p - q); for (const d of ds.slice(0, 4)) marks.push({ d, label: ds.length > 1 ? String(d) : 'dose', col: '#d13' }); if (!ds.length) hint = 'Draw shapes on the field above: each keeps its own dose.'; }
      else marks.push({ d: num('fpDose', 150), label: 'dose', col: '#d13' });
      hint = hint || `Contrast curve of the ${esc(rs.name)} on the sample (remaining thickness vs dose).`;
    }
    if ($('fpCurveHint')) $('fpCurveHint').innerHTML = hint;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
    const L = 34, T = 8, B = 18, pw = w - L - 8, ph = h - T - B;
    const d0 = Math.min(r.D0 / 5, ...marks.map((m) => m.d / 2).filter((v) => v > 0)), d1 = Math.max(r.D100 * 5, ...marks.map((m) => m.d * 2));
    cx.strokeStyle = '#eee'; for (const t of [0, 0.5, 1]) { cx.beginPath(); cx.moveTo(L, T + ph * (1 - t)); cx.lineTo(L + pw, T + ph * (1 - t)); cx.stroke(); }
    cx.strokeStyle = '#aaa'; cx.strokeRect(L, T, pw, ph);
    cx.font = '10px system-ui'; cx.fillStyle = '#666'; cx.fillText('1', L - 10, T + 4); cx.fillText('0', L - 10, T + ph + 3);
    for (const [d, lab] of [[r.D0, 'D₀'], [r.D100, 'D₁₀₀']]) { const x = L + (pw * Math.log(d / d0)) / Math.log(d1 / d0); cx.strokeStyle = '#bbb'; cx.setLineDash([3, 3]); cx.beginPath(); cx.moveTo(x, T); cx.lineTo(x, T + ph); cx.stroke(); cx.setLineDash([]); cx.textAlign = lab === 'D₀' ? 'right' : 'left'; cx.fillText(`${lab} ${d.toFixed(0)}`, x + (lab === 'D₀' ? -3 : 3), T + ph + 13); cx.textAlign = 'left'; }
    cx.strokeStyle = '#2f6fd6'; cx.lineWidth = 1.8; cx.beginPath();
    for (let i = 0; i <= 200; i++) { const d = d0 * (d1 / d0) ** (i / 200), y = T + ph * (1 - remainingFraction(r, d)); i ? cx.lineTo(L + (pw * i) / 200, y) : cx.moveTo(L + (pw * i) / 200, y); }
    cx.stroke();
    cx.lineWidth = 1.5;
    marks.forEach((m, j) => { const x = L + (pw * Math.log(m.d / d0)) / Math.log(d1 / d0); cx.strokeStyle = m.col; cx.beginPath(); cx.moveTo(x, T); cx.lineTo(x, T + ph); cx.stroke(); cx.fillStyle = m.col; cx.fillText(`${m.label} ${m.d.toFixed(0)}`, Math.min(x + 3, w - 70), T + 10 + 11 * j); });
  }
  function descumSummary() {
    const e = $('fpDSum'); if (!e) return;
    const t = num('fpDTime', 30), r = num('fpDRate', 0.5), gs = num('fpDGr', 30), ml = t / gs;
    e.innerHTML = `Resist: <b>${(t * r).toFixed(1)} nm</b> removed · graphene: <b>${ml.toFixed(2)} monolayer${ml === 1 ? '' : 's'}</b>${ml < 1 ? ' — <span style="color:#b45309">under 1 ML: graphene survives</span>' : ''}`;
  }
  // The dose the layout's shapes actually carry: the most common one on exposed layers. It is not
  // Pattern Studio's nominal (the dose NEW shapes get): an imported GDS can carry every shape at 600
  // while the nominal is still 100, and a suggestion from the nominal then over-exposes six times.
  function layoutDose() {
    const lib = app.project.library, exposed = new Set(lib.layers.filter((l) => isExposedPurpose(l.purpose)).map((l) => l.key));
    const count = new Map();
    for (const c of Object.values(lib.cells)) for (const s of c.shapes) if (exposed.has(s.layer) && s.dose > 0) count.set(s.dose, (count.get(s.dose) || 0) + 1);
    let best = null, n = 0;
    for (const [d, k] of count) if (k > n) { best = d; n = k; }
    return best ?? (app.nominalDose?.() ?? 100);
  }
  // Layout exposures: the dose scale that brings the corrected pattern edges (½ of the layout's
  // dose) to the resist's D₁₀₀ (the layout's doses are relative, the resist presets absolute).
  function suggestedScale() {
    const rs = sampleResist(); if (!rs) return null;
    const nom = layoutDose(), D100 = rs.devParams?.D100 || 120;
    const k = D100 / (0.5 * nom);
    return { k: +k.toPrecision(2), nom, D100, name: rs.name };
  }
  function scaleHint() {
    const e = $('fpScaleHint'); if (!e) return;
    const s = suggestedScale();
    if (!s) { e.innerHTML = '<span style="color:#b45309">No resist on the sample yet: spin one first.</span>'; return; }
    const k = num('fpScale', 1), mx = maxDoseOf(st.pendingMaps), r = resistModel(sampleResist());
    let warn = '';
    if (st.pendingMaps && mx > 0 && mx < r.D0) warn = `<br><span style="color:#b45309"><b>Nothing will clear:</b> the highest dose is ${mx.toFixed(0)} µC/cm², below where ${esc(s.name)} starts to respond (D₀ ≈ ${r.D0.toFixed(0)}).</span>`;
    e.innerHTML = `Suggested <b>× ${s.k}</b>: the layout's dose ${s.nom} → ${+(s.nom * s.k).toFixed(0)} µC/cm², so pattern edges (½ of it after correction) get ${esc(s.name)}'s D₁₀₀ = ${s.D100}.${Math.abs(k - s.k) > 1e-9 ? ' <a href="#" id="fpUseSug">use it</a>' : ''}${warn}`;
    const u = $('fpUseSug'); if (u) u.onclick = (ev) => { ev.preventDefault(); $('fpScale').value = s.k; updatePendingDose(); };
  }
  function showParams(type, forceLevel = null) {
    formLevel = forceLevel || level();
    $('fabParams').innerHTML = paramsHtml(type, formLevel);
    if (type === 'spinresist' && formLevel === 'advanced') {
      const applyCurve = () => {
        const lib = val('fpPreset'), c = curveOf(lib, val('fpCurveSel')), pr = LIBRARY_PRESETS[lib];
        if (c) { $('fpType').value = c.tone; $('fpD100').value = +c.D100.toPrecision(3); $('fpGamma').value = +c.gamma.toFixed(2); $('fpSoft').value = Math.round(100 * c.round);
          $('fpRThick').value = c.cond.thicknessNm; $('fpCalDev').value = c.cond.developer; $('fpDevT').value = c.cond.timeS; $('fpCalT').value = c.cond.tempC; $('fpCalTh').value = c.cond.thicknessNm; $('fpCalKV').value = c.cond.kV; }
        if (pr) { $('fpDark').value = pr.darkErosion; $('fpSide').value = pr.sidewall; $('fpScum').value = pr.scum; }
        if (c) extrasForm(lib, c.cond, c.cond);
        curveNote(); drawCurve();
      };
      const pickResist = () => { $('fpCurveSel').innerHTML = curveOptions(val('fpPreset')); const e = app.resists?.entryOf(val('fpPreset')); const mine = e?.datasets?.find((d) => d.quality === 'measured' && d.fit && !d.superseded); $('fpCurveSel').value = mine ? mine.id : 'model'; applyCurve(); };
      $('fpPreset').onchange = pickResist; $('fpCurveSel').onchange = applyCurve;
      const fr = app.project.settings?.fabResist, P = fr && LIBRARY_PRESETS[fr.id] && app.resists?.predictFor(fr.id, fr.cond);
      if (P) {
        // handed over from the Resists tab: that resist, with the library's prediction for those conditions
        $('fpPreset').value = fr.id; pickResist(); $('fpCurveSel').value = 'model';
        const c = fr.cond; $('fpRThick').value = c.thicknessNm; $('fpD100').value = +P.D100.toPrecision(3); $('fpGamma').value = +P.gamma.toFixed(2); $('fpSoft').value = Math.round(100 * P.round);
        $('fpCalDev').value = c.developer; $('fpDevT').value = c.timeS; $('fpCalT').value = c.tempC; $('fpCalTh').value = c.thicknessNm; $('fpCalKV').value = c.kV;
        $('fabParams').insertAdjacentHTML('beforeend', `<div class="hint" id="fpFromLib" style="margin-top:4px;">From the Resists tab: the library's curve for ${esc(condLabel(c))} — ${esc(P.regime === 'measured' ? 'calibrated' : P.regime === 'window' ? 'inside the process window' : P.regime === 'extrapolated' ? 'EXTRAPOLATED' : 'UNSUPPORTED')}, D₁₀₀ ±${Math.round(100 * (Math.exp(P.sigmaLn) - 1))} %.</div>`);
        curveNote(); drawCurve();
      } else pickResist();
      for (const id of ['fpGamma', 'fpSoft', 'fpD100', 'fpScum', 'fpRThick', 'fpCalTh', 'fpCalKV', 'fpDevT', 'fpCalT']) $(id).oninput = () => { curveNote(); drawCurve(); };
      $('fpCalDev').onchange = curveNote;
    } else if (type === 'spinresist') {
      const apply = () => { const p = RESIST_PRESETS[val('fpPreset')]; if (p) { $('fpType').value = p.type; $('fpGamma').value = p.contrast; $('fpSoft').value = Math.round(100 * (p.soft ?? 1)); $('fpD100').value = p.D100; $('fpDark').value = p.darkErosion; $('fpSide').value = p.sidewall; $('fpScum').value = p.scum; $('fpClear').value = p.clearFrac ?? 0.5; const c = calibrationOf({}, p); $('fpCalDev').value = c.developer; $('fpDevT').value = c.timeS; $('fpCalT').value = c.tempC; } drawCurve(); };
      $('fpPreset').onchange = apply;
      // handed over from the Resists tab ("Use in Fab Studio"): that resist, film and development, with
      // the library's curve for them — once, for this spin step
      const fr = app.project.settings?.fabResist, P = fr && RESIST_PRESETS[fr.id] && app.resists?.predictFor(fr.id, fr.cond);
      if (P) {
        $('fpPreset').value = fr.id; apply();
        const c = fr.cond; $('fpRThick').value = c.thicknessNm; $('fpD100').value = +P.D100.toPrecision(3); $('fpGamma').value = +P.gamma.toFixed(2); $('fpSoft').value = Math.round(100 * P.round);
        $('fpCalDev').value = c.developer; $('fpDevT').value = c.timeS; $('fpCalT').value = c.tempC;
        $('fabParams').insertAdjacentHTML('beforeend', `<div class="hint" id="fpFromLib" style="margin-top:4px;">From the resist library: ${esc(c.kV + ' kV, ' + c.thicknessNm + ' nm, ' + (DEVELOPERS[c.developer] || c.developer) + ' ' + c.timeS + ' s at ' + c.tempC + ' °C')} — ${esc(P.regime === 'measured' ? 'calibrated' : P.regime === 'window' ? 'inside the process window' : P.regime === 'extrapolated' ? 'EXTRAPOLATED' : 'UNSUPPORTED')}, D₁₀₀ ±${Math.round(100 * (Math.exp(P.sigmaLn) - 1))} %.</div>`);
        drawCurve();
      } else apply();
      for (const id of ['fpGamma', 'fpSoft', 'fpD100', 'fpScum', 'fpRThick', 'fpType']) $(id).oninput = drawCurve;
      $('fpType').onchange = drawCurve;
    }
    if (type === 'expose' || type === 'uv_expose') {
      $('fpSource').onchange = syncExposeRows;
      for (const id of ['fpScale', 'fpPattern', 'fpDose', 'fpPitch', 'fpDuty', 'fpLineW', 'fpDotPitch', 'fpDotDiam', 'fpDotSlice']) $(id).oninput = updatePendingDose;
      if (st.sample?.source === 'free') $('fpSource').value = 'pattern';
      const sug = suggestedScale();                     // a new exposure starts at the suggested scale
      if (sug && type === 'expose' && st.editIdx < 0) $('fpScale').value = sug.k;
      syncExposeRows();
    } else { st.pendingMaps = null; render(); }
    if (type === 'develop') {
      // a new develop step starts at the conditions the resist's curve was measured for
      const toCal = () => { const c = calOfTarget(val('fpTarget')); $('fpChem').innerHTML = developerOptionsFor(val('fpTarget')); if (c.developer) $('fpChem').value = c.developer; $('fpTime').value = c.timeS; $('fpTemp').value = c.tempC; };
      $('fpTarget').onchange = () => { if (st.editIdx < 0) toCal(); else $('fpChem').innerHTML = developerOptionsFor(val('fpTarget')); devHint(); drawCurve(); };
      for (const id of ['fpChem', 'fpTime', 'fpTemp']) { $(id).oninput = devHint; $(id).onchange = devHint; }
      const rs = eng.state.resistStates; if (rs.length) { $('fpTarget').value = rs[rs.length - 1].name; toCal(); }
      devHint(); requestAnimationFrame(drawCurve);
    }
    if (type === 'descum') { for (const id of ['fpDTime', 'fpDRate', 'fpDGr']) $(id).oninput = descumSummary; descumSummary(); }
    if (type === 'etch_koh') { for (const id of ['fpKConc', 'fpKTemp', 'fpKTime', 'fpKOx']) { $(id).oninput = kohHint; $(id).onchange = kohHint; } kohHint(); }
  }
  // the rates this KOH step will use, the depth it reaches, and what the walls will be on this sample
  function kohHint() {
    if (!$('fpKHint')) return;
    const conc = +val('fpKConc') || 30, temp = num('fpKTemp', 80), time = num('fpKTime', 20), m = kohRateModel(conc, temp);
    const um = (v) => ((v * 60) / 1000).toFixed(2), w = waferStore(), b = waferBasis(w, sampleAzimuth(st.sample || describeSample()));
    const ox = parseFloat($('fpKOx').value), oxR = Number.isFinite(ox) ? ox : (m.nmPerS['100'] * 60) / 182;
    $('fpKHint').innerHTML = `Rates at ${conc} %, ${temp} °C: (100) <b>${um(m.nmPerS['100'])}</b>, (110) ${um(m.nmPerS['110'])}, (111) ${um(m.nmPerS['111'])} µm/min → ${time} s etches <b>${Math.round(m.nmPerS['100'] * time)} nm</b> of (100); SiO₂ mask loses ${((oxR * time) / 60).toFixed(1)} nm. On this (${w.surface}) sample the cross-section runs along ${dirLabel(b.x)}.`;
  }
  $('fabStep').onchange = () => showParams($('fabStep').value);
  // Learning / Advanced
  const syncLevel = () => { for (const b of $('fabLevel').querySelectorAll('button')) b.classList.toggle('on', b.dataset.level === level()); };
  $('fabLevel').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-level]'); if (!b || b.dataset.level === level()) return;
    (app.project.settings ??= {}).fabLevel = b.dataset.level; app.markDirty(); syncLevel();
    if (st.editIdx < 0) showParams($('fabStep').value);
    toast(b.dataset.level === 'advanced' ? 'Advanced: the resist library\'s resists and measured curves, with their conditions.' : 'Learning: the studio\'s generic teaching resists and developers.', 3500);
  });
  syncLevel();
  app.fabLevel = (l) => { (app.project.settings ??= {}).fabLevel = l; syncLevel(); if (st.editIdx < 0) showParams($('fabStep').value); };

  // dose strip preview for the pending exposure
  let pendingTicket = 0;
  async function updatePendingDose() {
    const type = $('fabStep').value;
    if (!(type === 'expose' || type === 'uv_expose') || !st.built) { st.pendingMaps = null; render(); return; }
    const p = readParams(type), ticket = ++pendingTicket;
    try {
      let maps;
      if (p.source === 'layout') { if (st.sample.source === 'free') { st.pendingMaps = null; render(); return; } maps = (await ctxFor({ type, params: p })).doseMaps; }
      else if (p.source === 'custom') { const D = eng.state.D; maps = []; for (let z = 0; z < D; z++) maps.push(eng.customDoseMap(p, D > 1 ? ((z + 0.5) * eng.state.sampleDepthNm) / D : undefined)); }
      else { maps = []; for (let z = 0; z < eng.state.D; z++) { const cols = eng.patternColumns(p, ((z + 0.5) * eng.state.sampleDepthNm) / eng.state.D); maps.push(Float32Array.from(cols, (c) => c * p.dose)); } }
      if (ticket !== pendingTicket) return;
      st.pendingMaps = maps; st.pendingLabel = p.source === 'layout' ? `layout dose × ${p.scale}` : p.source === 'custom' ? `${p.maskShapes.length} drawn shape${p.maskShapes.length === 1 ? '' : 's'}` : `${p.pattern} at ${p.dose}`;
      render(); scaleHint(); drawCurve();
    } catch (e) { $('fabStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
  }

  // ---------------------------------------------------------------- running and replaying
  function snapshotHistory() { st.history.push({ flow: st.flow.map((s) => ({ ...s, params: { ...s.params } })), thumbs: [...st.thumbs] }); if (st.history.length > 30) st.history.shift(); st.future = []; }
  function headline(step) {
    const p = step.params || {};
    switch (step.type) {
      case 'deposit': return `Deposit ${p.thickness} nm ${MAT_NAMES[MAT_MAP[p.material]] || p.material}, ${p.method}`;
      case 'transfer_2d': return `Transfer ${TRANSFER_MATERIALS[p.material] || p.material}, ${p.flakeSize} nm`;
      case 'spinresist': return `Spin ${p.thickness} nm ${p.resist} (${p.type}), γ ${p.contrast}${p.soft ? ' (rounding ' + Math.round(100 * p.soft) + ' %)' : ''}, D₁₀₀ ${p.D100}`;
      case 'expose': case 'uv_expose': return p.source === 'layout' ? `Expose with the layout dose${+p.scale !== 1 ? ` × ${p.scale}` : ''}` : p.pattern === 'custom' ? `Expose ${(p.maskShapes || []).length} drawn shape${(p.maskShapes || []).length === 1 ? '' : 's'}` : `Expose ${p.pattern} at ${p.dose} ${p.doseUnit || 'µC/cm²'}`;
      case 'develop': return `Develop ${p.targetResist} in ${DEVELOPERS[p.developer] || p.developer || '?'}, ${p.devTime} s${p.tempC != null ? `, ${p.tempC} °C` : ''}`;
      case 'descum': return `O₂ plasma ${p.time} s`;
      case 'etch_rie': return `RIE ${p.depth} nm ${ETCH_MATERIALS[p.target] || p.target}, selectivity ${p.selectivity}`;
      case 'etch_sf6': return `SF6 etch ${p.depth} nm`;
      case 'etch_wet': return `Wet etch ${p.depth} nm ${ETCH_MATERIALS[p.target] || p.target}`;
      case 'etch_koh': return `KOH ${p.conc} % ${p.temp} °C, ${p.time} s${p.method === 'levelset' ? ' (level set)' : p.method === 'fast' ? ' (fast)' : ''}`;
      case 'liftoff': return 'Lift-off / strip';
      case 'strip': return 'Strip resist';
      default: return step.type;
    }
  }
  // KOH on the DSW native core when there is one: the page builds the request from the state
  // as it is now and the engine applies the returned mask. Anything missing or failing falls
  // back to the JS level set, which gives the same voxels.
  async function kohNative(params) {
    const nat = nativeCore();
    if (!nat) return undefined;
    try {
      await nat.ready;
      if (!nat.connected || !nat.supports.has('kohEtch')) return undefined;
      // a remembered result or Wulff–Jaccodine (a cut, a line) needs no core
      const plan = eng.kohPlan(params);
      if (!plan.needLevelSet) return undefined;
      const S = plan.S;
      if (!(S.timeS > 0)) return undefined;
      // the Pro core takes the tables and the codes as raw bytes; the DSW one as base64 text
      const r = await nat.request('kohEtch', nat.binary ? kohPayloadRaw(S) : kohPayload(S));
      if (!r || !r.mask || r.mask.length !== S.W * S.H * S.D) return undefined;
      st.kohNative = (st.kohNative || 0) + 1;
      return { kohMask: r.mask, kohSteps: r.steps };
    } catch (e) { console.warn('KOH on the native core failed, using the page:', e.message); return undefined; }
  }
  const kohWhere = () => { const n = nativeCore(); return n && n.connected && n.supports.has('kohEtch') ? ' on the native core' : ''; };
  async function runStep() {
    if (!st.built) { toast('Build the sample first.'); return; }
    const type = $('fabStep').value, params = readParams(type);
    if (st.insertIdx >= 0) {                          // insert in the middle: replay the whole flow
      const f = st.flow.map((s) => ({ type: s.type, params: s.params }));
      f.splice(st.insertIdx, 0, { type, params });
      snapshotHistory(); exitInsert(false);
      await replayAll(f);
      return;
    }
    $('fabRun').disabled = true; $('fabStatus').textContent = 'running…';
    try {
      let ctx = await ctxFor({ type, params });
      if (type === 'etch_koh') {
        $('fabStatus').textContent = `Etching in KOH${kohWhere()}… (${eng.state.W * eng.state.H * eng.state.D > 1e6 ? 'a large sample takes several seconds' : 'a moment'})`; await nextPaint();
        const k = await kohNative(params);
        if (k) ctx = { ...(ctx || {}), ...k };
      }
      snapshotHistory();
      const r = eng.run(type, params, ctx);
      if (!r.ok) { st.history.pop(); $('fabStatus').innerHTML = `<span style="color:#c00">${esc(r.msg)}</span>`; }
      else {
        st.flow.push({ type, params: r.params, ok: true, uncertain: !!r.uncertain, modelled: r.modelled || null, regime: r.regime || null }); st.thumbs.push(sliceThumbData(eng.state));
        if (type === 'spinresist' && app.project.settings?.fabResist) { delete app.project.settings.fabResist; app.markDirty(); }   // the hand-over from the Resists tab is used
        $('fabStatus').textContent = r.msg || 'Done.';
        if (type === 'develop' && (params.scum || 0) > 0) {   // E6: lift-off would silently take all the metal
          $('fabStatus').innerHTML += `<br><span style="color:#b45309">${esc(params.targetResist)} leaves ≈ ${params.scum} nm of scum in the cleared openings: add an <b>O₂ plasma (descum)</b> step before depositing metal, or lift-off removes the metal with it.</span>`;
        }
        renderFlow(); render(); persist();
        if (type === 'spinresist') { $('fabStep').value = 'expose'; showParams('expose'); }
        else if (type === 'expose' || type === 'uv_expose') { $('fabStep').value = 'develop'; showParams('develop'); }
      }
    } catch (e) { $('fabStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
    $('fabRun').disabled = false;
  }
  // one frame for the status line to reach the screen before a step that blocks for seconds
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  async function replayAll(flow) {
    if (!st.sample) buildFromForm(true);
    if (flow.some((x) => x.type === 'etch_koh')) { $('fabStatus').textContent = `Replaying the flow (its KOH steps take a few seconds${kohWhere()})…`; await nextPaint(); }
    const sub = eng.state.substrate;
    const gen = (st.replayGen = (st.replayGen || 0) + 1);
    eng.buildSubstrate(sub);
    const thumb0 = sliceThumbData(eng.state), thumbs = [], out = [];
    for (const step of flow) {
      let ctx;
      try { ctx = await ctxFor(step); } catch (e) { ctx = { error: e.message }; }
      if (step.type === 'etch_koh' && !ctx?.error) { const k = await kohNative(step.params); if (k) ctx = { ...(ctx || {}), ...k }; }
      if (gen !== st.replayGen) return;     // a newer replay has started: it owns the engine now
      const params = ctx?.error ? { ...step.params, __blocked: ctx.error } : step.params;
      const r = eng.run(step.type, params, ctx);
      out.push({ type: step.type, params: step.params, ok: r.ok, uncertain: !!r.uncertain, modelled: r.modelled || null, regime: r.regime || null, error: ctx?.error || (r.ok ? null : r.msg) || null });
      thumbs.push(sliceThumbData(eng.state));
    }
    st.flow = out; st.thumb0 = thumb0; st.thumbs = thumbs;
    const failed = st.flow.filter((e) => !e.ok).length;
    $('fabStatus').innerHTML = failed ? `<span style="color:#a60">${failed} step${failed > 1 ? 's' : ''} could not run — see the flow.</span>` : `Replayed ${flow.length} step${flow.length === 1 ? "" : "s"}.`;
    staleFab.hide();
    renderFlow(); render(); persist();
  }
  $('fabRun').onclick = runStep;
  // the pair beside Run step drives the pair under the flow; Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) too
  $('fabUndo2').onclick = () => $('fabUndo').click();
  $('fabRedo2').onclick = () => $('fabRedo').click();
  document.addEventListener('keydown', (e) => {
    if (!app.isTabActive('fab') || modalOpen()) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;   // the field's own undo
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); (e.shiftKey ? $('fabRedo') : $('fabUndo')).click(); }
    else if (k === 'y') { e.preventDefault(); $('fabRedo').click(); }
  });
  $('fabUndo').onclick = async () => { if (!st.history.length) return; st.future.push({ flow: st.flow, thumbs: st.thumbs }); const h = st.history.pop(); await replayAll(h.flow); };
  $('fabRedo').onclick = async () => { if (!st.future.length) return; st.history.push({ flow: st.flow, thumbs: st.thumbs }); const f = st.future.pop(); await replayAll(f.flow); };
  // rebuild from the form as it is now (sample, voxel sizes, substrate), keeping the flow
  $('fabReplay').onclick = () => { buildFromForm(true); updateSampleInfo(); replayAll(st.flow); };
  $('fabRebuild').onclick = () => $('fabReplay').click();          // the same action, next to Build sample
  $('fabClear').onclick = () => { if (!st.flow.length || !confirm('Clear the process flow?')) return; snapshotHistory(); replayAll([]); };

  // flow list
  // The flow list (right column): step 0 = the substrate, then one card per step with its
  // parameters and a thumbnail of the middle slice. Expanded (the standalone's cards) or compact.
  function stepDetails(s) {
    const p = s.params || {}, nm = (v) => `${v} nm`;
    switch (s.type) {
      case 'deposit': return `${MAT_NAMES[MAT_MAP[p.material]] || p.material}, ${nm(p.thickness)}, ${p.method === 'conformal' ? 'conformal' : 'directional'}`;
      case 'transfer_2d': return `${TRANSFER_MATERIALS[p.material] || p.material}, flake ${nm(p.flakeSize)}, layer ${nm(p.layerThick)}`;
      case 'spinresist': return `${p.lib ? `${esc(app.resists?.entryOf(p.lib)?.name || p.lib)} <span class="fab-adv">library</span>` : RESIST_LABELS[p.resist] || p.resist}, ${nm(p.thickness)}${p.lib && p.curveId ? `<br>curve: ${esc(p.curveId === 'model' ? 'library reference' : p.curveId)}${p.calThicknessNm ? ` (${p.calThicknessNm} nm, ${p.calKV} kV)` : ''}` : ''}<br>γ ${p.contrast}${p.soft ? ', rounding ' + Math.round(100 * p.soft) + ' %' : ''}, D₁₀₀ ${p.D100} µC/cm²<br>dark ${p.darkErosion} nm/min, ${p.sidewall}°, scum ${nm(p.scum)}<br>curve for ${describeCal(calibrationOf(p, RESIST_PRESETS[p.resist]))}`;
      case 'expose': case 'uv_expose': {
        if (p.source === 'layout') { const nom = layoutDose(); return `layout dose × ${p.scale}<br>${nom} → ${+(nom * p.scale).toFixed(0)} µC/cm²`; }
        const unit = p.doseUnit || 'µC/cm²';
        if (p.pattern === 'custom') { const ms = p.maskShapes || [], ds = ms.map((x) => x.dose); return `${ms.length} drawn shape${ms.length === 1 ? '' : 's'}${ds.length ? `<br>${Math.min(...ds)}${Math.max(...ds) !== Math.min(...ds) ? '–' + Math.max(...ds) : ''} ${unit}` : ''}`; }
        const geo = p.pattern === 'dots' ? `Ø ${nm(p.dotDiam)}, pitch ${nm(p.dotPitch)}` : p.pattern === 'grating' ? `pitch ${nm(p.pitch)}, duty ${p.duty} %` : p.pattern === 'blanket' ? 'whole area' : `opening ${nm(p.lineW)}`;
        return `${p.pattern}, ${p.dose} ${unit}<br>${geo}`;
      }
      case 'develop': return `${p.targetResist} in ${DEVELOPERS[p.developer] || p.developer}, ${p.devTime} s${p.tempC != null ? `, ${p.tempC} °C` : ''}`;
      case 'descum': return `${p.time} s × ${p.rate} nm/s = ${+(p.time * p.rate).toFixed(1)} nm of resist`;
      case 'etch_rie': return `${ETCH_MATERIALS[p.target] || p.target}, ${nm(p.depth)}, selectivity ${p.selectivity}`;
      case 'etch_sf6': return `${nm(p.depth)}`;
      case 'etch_wet': return `${ETCH_MATERIALS[p.target] || p.target}, ${nm(p.depth)}, isotropic`;
      case 'etch_koh': { const m = kohRateModel(p.conc, p.temp); return `${p.conc} % KOH, ${p.temp} °C, ${p.time} s: (100) ${nm(Math.round(m.nmPerS['100'] * p.time))}, anisotropic`; }
      case 'liftoff': return 'all resist and what sits on it';
      case 'strip': return 'all resist';
      default: return '';
    }
  }
  function substrateText() {
    const s = eng.state.substrate || substrateForm(), parts = [];
    if (s.met > 0) parts.push(`Au ${s.met} nm`); if (s.poly > 0) parts.push(`poly-Si ${s.poly} nm`); if (s.ox > 0) parts.push(`SiO₂ ${s.ox} nm`);
    parts.push(`Si ${s.si} nm`);
    const smp = st.sample;
    return `${parts.join(' / ')}${smp ? `<br>${esc(smp.label || '')} · ${eng.state.nmLat} × ${eng.state.nmVert} nm voxels` : ''}`;
  }
  function renderFlow() {
    const all = [st.thumb0, ...st.thumbs].filter(Boolean);
    let y0 = 0;
    if (all.length) { const top = Math.min(...all.map((t) => t.top)), H = all[0].h; y0 = Math.max(0, top - Math.max(2, Math.round(0.12 * (H - top)))); }
    const img = (t) => (t ? `<img src="${thumbURL(t, y0, st.compact ? 96 : 240, st.compact ? 24 : 46)}" alt="">` : '');
    const acts = (i) => i < 0 ? `<span class="facts"><button data-act="ins" title="Insert a step before step 1">＋</button></span>`
      : `<span class="facts"><button data-act="up" title="Move up">▲</button><button data-act="down" title="Move down">▼</button><button data-act="ins" title="Insert a new step after this one">＋</button><button data-act="del" class="del" title="Delete step">✕</button></span>`;
    const card = (i, title, icon, details, thumb, cls = '', extra = '') => `<div class="fstep${cls}" data-i="${i}" title="${esc((title + ': ' + details).replace(/<br>/g, ' · ').replace(/<[^>]+>/g, ''))}">
      <div class="fhead"><span class="fnum">${i + 1}</span><span class="ficon">${icon}</span><b>${esc(title)}</b>${extra}</div>
      <div class="fparams">${details}</div>${img(thumb)}${acts(i)}</div>`;
    const placeholder = (n) => `<div class="fconn"></div><div class="fstep placeholder"><div class="fhead"><span class="fnum">${n}</span><b>New step</b><span class="fbadge">inserting</span></div><div class="fparams">Choose the step on the left, then <b>Insert step</b>.</div></div>`;
    let html = st.built || st.flow.length ? card(-1, 'Substrate', '▭', substrateText(), st.thumb0) : '';
    st.flow.forEach((s, i) => {
      if (st.insertIdx === i) html += placeholder(i + 1);
      const n = st.insertIdx >= 0 && i >= st.insertIdx ? i + 1 : i;
      const editing = i === st.editIdx, bad = s.ok === false;
      html += '<div class="fconn"></div>' + card(n, STEP_LABELS[s.type] || s.type, STEP_ICONS[s.type] || '•', stepDetails(s) + (bad ? `<div class="ferr">⚠ ${esc(s.error || 'could not run')}</div>` : '') + (!bad && s.uncertain ? `<div class="fwarn" title="This development differs from the one the resist&#39;s contrast curve was measured for: the result is less certain.">⚠ ${s.regime === 'extrapolated' ? 'EXTRAPOLATED outside the process window' : 'outside the contrast curve&#39;s calibration'}</div>` : '') + (!bad && !s.uncertain && s.modelled ? `<div class="finfo" title="${esc(s.modelled)}">ℹ curve moved by the resist library — inside the process window</div>` : ''), st.thumbs[i],
        `${editing ? ' editing' : ''}${bad ? ' bad' : ''}${st.editIdx >= 0 && i > st.editIdx ? ' downstream' : ''}`, editing ? '<span class="fbadge">editing</span>' : '').replace(`data-i="${n}"`, `data-i="${i}"`);
    });
    if (st.insertIdx >= st.flow.length) html += placeholder(st.flow.length + 1);
    $('fabFlow').innerHTML = html || '<div class="hint" style="padding:8px;">No steps yet. Build the sample, then add steps.</div>';
    $('fabFlow').classList.toggle('compact', st.compact);
    $('fabFlowExp').classList.toggle('active', !st.compact); $('fabFlowCmp').classList.toggle('active', st.compact);
    $('fabUndo').disabled = $('fabUndo2').disabled = !st.history.length; $('fabRedo').disabled = $('fabRedo2').disabled = !st.future.length;
  }
  const setCompact = (c) => { st.compact = c; try { localStorage.setItem('ebw-fab-flow-compact', c ? '1' : '0'); } catch { /* no storage */ } renderFlow(); };
  $('fabFlowExp').onclick = () => setCompact(false);
  $('fabFlowCmp').onclick = () => setCompact(true);
  $('fabCopy').onclick = async () => {
    const plain = (h) => h.replace(/<br>/g, '; ').replace(/<[^>]+>/g, '');
    const lines = [`0. Substrate: ${plain(substrateText())}`, ...st.flow.map((s, i) => `${i + 1}. ${STEP_LABELS[s.type] || s.type}: ${plain(stepDetails(s))}${s.ok === false ? ' (could not run)' : ''}`)];
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Process flow copied to the clipboard.'); } catch { download('process-flow.txt', lines.join('\n')); }
  };
  $('fabFlow').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'), it = e.target.closest('.fstep');
    if (!it || it.classList.contains('placeholder')) return;
    const i = +it.dataset.i;
    if (!b) {                                          // click on a step: edit it (again: cancel)
      if (i < 0) return;
      if (st.editIdx === i) { cancelEdit(); return; }
      exitInsert(false);
      st.editIdx = i; $('fabStep').value = st.flow[i].type; showParams(st.flow[i].type, st.flow[i].type === 'spinresist' ? (st.flow[i].params?.lib ? 'advanced' : 'learning') : null); fillParams(st.flow[i].type, st.flow[i].params);
      $('fabRun').style.display = 'none'; $('fabApplyEdit').style.display = ''; $('fabCancelEdit').style.display = '';
      $('fabRunHint').innerHTML = `Editing step ${i + 1}: change its settings and press <b>Apply edit</b> — the flow is replayed from there.`;
      $('fabStatus').innerHTML = `Editing step ${i + 1}: change the parameters, then <b>Apply edit</b> (the steps after it are replayed).`;
      renderFlow(); return;
    }
    const act = b.dataset.act;
    if (act === 'ins') { cancelEdit(false); st.insertIdx = i + 1; $('fabRun').textContent = `Insert as step ${i + 2}`; $('fabCancelEdit').style.display = ''; $('fabStatus').innerHTML = `Choose the step to insert after ${i < 0 ? 'the substrate' : 'step ' + (i + 1)}, then <b>Insert</b>.`; renderFlow(); return; }
    if (act === 'del') { cancelEdit(false); snapshotHistory(); const f = st.flow.filter((_, k) => k !== i); await replayAll(f); return; }
    if (act === 'up' || act === 'down') { cancelEdit(false); const j = act === 'up' ? i - 1 : i + 1; if (j < 0 || j >= st.flow.length) return; snapshotHistory(); const f = st.flow.slice(); [f[i], f[j]] = [f[j], f[i]]; await replayAll(f); }
  });
  $('fabApplyEdit').onclick = async () => {
    if (st.editIdx < 0) return;
    const type = $('fabStep').value, params = readParams(type);
    snapshotHistory();
    const f = st.flow.slice(); f[st.editIdx] = { type, params };
    cancelEdit(false); await replayAll(f);
  };
  function exitInsert(render = true) { if (st.insertIdx < 0) return; st.insertIdx = -1; $('fabRun').textContent = 'Run step'; $('fabCancelEdit').style.display = 'none'; if (render) renderFlow(); }
  function cancelEdit(render = true) { exitInsert(false); st.editIdx = -1; $('fabRunHint').textContent = 'Run step adds a new step at the end. To change a step already in the flow, click its card.'; $('fabRun').style.display = ''; $('fabApplyEdit').style.display = 'none'; $('fabCancelEdit').style.display = 'none'; if (render) renderFlow(); }
  $('fabCancelEdit').onclick = () => cancelEdit();

  // ---------------------------------------------------------------- recipes
  function recipeData() { return { substrate: eng.state.substrate || { ...substrateForm(), nmLat: 20, nmVert: 2, w: 1000, d: 500, wfW: 1500, wfD: 1000 }, sample: st.sample ? { source: st.sample.source, areaId: st.sample.areaId, areaName: st.sample.areaName, mode: st.sample.mode, budgetIdx: st.budgetIdx } : null, steps: st.flow.map((s) => ({ type: s.type, params: s.params })) }; }
  $('fabExport').onclick = () => { if (!st.flow.length) { toast('No steps to export.'); return; } download('EBL_recipe.json', JSON.stringify(recipeData(), null, 2)); toast('Recipe exported as EBL_recipe.json (the standalone studio reads it; layout-dose exposures become grating exposures there).'); };
  $('fabImport').onclick = () => pickFile('.json,application/json', async (text, name) => {
    try {
      const r = JSON.parse(text);
      if (!r.substrate || !r.steps) throw new Error('not a recipe file (needs substrate and steps)');
      const f = fabStore(), fl = { id: newFlowId(), name: String(name).replace(/\.json$/i, '').replace(/^EBL_recipe$/, 'Imported') || 'Imported', recipe: null };
      f.flows.push(fl); f.active = fl.id; clearActiveState();
      await loadRecipe(r);
      toast(`Imported <b>${esc(name)}</b> as a new flow, <b>${esc(fl.name)}</b>: ${r.steps.length} steps.`);
    } catch (e) { alert(`Could not import ${name}:\n${e.message}`); }
  });
  async function loadRecipe(r) {
    const s = r.substrate;
    $('fabSi').value = s.si ?? 200; $('fabOx').value = s.ox ?? 0; $('fabPoly').value = s.poly ?? 0; $('fabMet').value = s.met ?? 0; $('fabHead').value = s.headroom ?? 300;
    $('fabNmVert').value = s.nmVert || s.nmPx || 2;
    if (s.wafer && !app.project.fab?.wafer) { fabStore().wafer = normalizeWafer(s.wafer); }
    renderWafer();
    const smp = r.sample;
    const areaOk = smp && smp.source === 'area' && deviceAreas(lib()).some((a) => a.id === smp.areaId);
    st.sourceChosen = true;
    if (areaOk) { st.source = `area:${smp.areaId}`; st.mode = smp.mode || '2d'; st.budgetIdx = smp.budgetIdx ?? 1; $('fabNmLat').value = ''; }
    else if (smp && smp.source === 'line') { st.source = 'line'; st.budgetIdx = smp.budgetIdx ?? 1; $('fabNmLat').value = ''; }
    else { st.source = 'free'; $('fabFreeW').value = s.w || 1000; $('fabFreeD').value = s.d || 500; $('fabNmLat').value = s.nmLat || s.nmPx || 20; }
    sourceOptions(); $('fabSource').value = st.source; $('fabMode').value = st.mode; budgetOptions(); updateSampleInfo();
    buildFromForm(false);
    if (eng.state.substrate && s.wfW) { eng.state.substrate.wfW = s.wfW; eng.state.substrate.wfD = s.wfD; eng.state.wfW = s.wfW; eng.state.wfD = s.wfD; }
    await replayAll(r.steps.map((x) => ({ type: x.type, params: x.params })));
  }

  // project persistence (autosave / .ebw.json)
  // the recipe is saved state, not a layout or PSF change: no version bump
  function persist() { activeFlow().recipe = recipeData(); app.markDirty?.('fab'); renderFlowList(); }

  // ---------------------------------------------------------------- several flows per project
  // app.project.fab = { flows: [{ id, name, recipe }], active }: different device areas, or variants
  // on one. Only the active flow is simulated; switching replays it from its substrate and starts its
  // undo history afresh, so Ctrl+Z never reaches into a flow that is not on screen. A single recipe
  // (projects saved before flows existed) becomes Flow 1.
  // ids f1, f2, ... (deterministic, so two pages built from one project are identical)
  const newFlowId = () => { const fl = (app.project.fab && app.project.fab.flows) || []; let n = 0; for (const x of fl) { const m = /^f(\d+)$/.exec(x.id); if (m) n = Math.max(n, +m[1]); } return `f${n + 1}`; };
  function fabStore() {
    let f = app.project.fab;
    if (f && Array.isArray(f.flows) && f.flows.length) {
      if (!f.flows.some((x) => x.id === f.active)) f.active = f.flows[0].id;
      return f;
    }
    const first = { id: newFlowId(), name: 'Flow 1', recipe: f && f.steps ? f : null };
    f = { flows: [first], active: first.id };
    app.project.fab = f;
    return f;
  }
  function activeFlow() { const f = fabStore(); return f.flows.find((x) => x.id === f.active); }
  // a flow built on a device area that has since been deleted is shown, not silently re-homed
  function areaMissing(r) { const s = r && r.sample; return !!(s && s.source === 'area' && !deviceAreas(lib()).some((a) => a.id === s.areaId)); }
  function warnAreaMissing(r) {
    $('fabStatus').innerHTML = `<span style="color:#b45309">The device area <b>${esc(r.sample.areaName || '')}</b> this flow was built on no longer exists, so it is not replayed (its recipe is kept). Undo the deletion in Pattern Studio, or choose a sample and press <b>Build sample</b> to start this flow again.</span>`;
  }
  function flowSampleText(r) {
    const s = r && r.sample;
    if (!r) return 'empty';
    if (!s || s.source === 'free') return 'free sample';
    if (s.source === 'line') return 'cut-line';
    const a = deviceAreas(lib()).find((x) => x.id === s.areaId);
    return a ? `${a.name}${s.mode === '3d' ? ' (3D)' : ''}` : `${s.areaName || 'device area'}: area deleted`;
  }
  function renderFlowList() {
    const f = fabStore();
    $('fabFlowSel').innerHTML = f.flows.map((fl) => { const n = fl.recipe && fl.recipe.steps ? fl.recipe.steps.length : 0; return `<option value="${esc(fl.id)}"${fl.id === f.active ? ' selected' : ''}>${esc(fl.name)} · ${esc(flowSampleText(fl.recipe))} · ${n} step${n === 1 ? '' : 's'}</option>`; }).join('');
    if (document.activeElement !== $('fabFlowName')) $('fabFlowName').value = activeFlow().name;
    $('fabFlowDel').textContent = f.flows.length > 1 ? 'Delete' : 'Clear';
    $('fabFlowDel').title = f.flows.length > 1 ? 'Delete this process flow' : 'Clear this process flow (a project keeps at least one)';
  }
  function nextFlowName() { const fl = fabStore().flows, names = new Set(fl.map((x) => x.name)); let k = fl.length + 1; while (names.has(`Flow ${k}`)) k++; return `Flow ${k}`; }
  function clearActiveState() { cancelEdit(false); st.flow = []; st.thumbs = []; st.history = []; st.future = []; st.built = false; st.pendingMaps = null; }
  function setFlowBusy(on) { for (const id of ['fabFlowSel', 'fabFlowNew', 'fabFlowDup', 'fabFlowDel', 'fabFlowName']) $(id).disabled = on; }
  async function openFlow(id) {
    const f = fabStore();
    f.active = id; app.markDirty?.('fab');
    const fl = activeFlow();
    clearActiveState(); renderFlow();
    setFlowBusy(true);
    try {
      if (areaMissing(fl.recipe)) { warnAreaMissing(fl.recipe); render(); }
      else if (fl.recipe && fl.recipe.steps) { $('fabStatus').textContent = `Replaying ${fl.name}…`; await loadRecipe(fl.recipe); }
      else { $('fabStatus').textContent = ''; if (buildFromForm(false)) staleFab.hide(); renderFlow(); render(); persist(); updateSampleInfo(); }
    } catch (e) { $('fabStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
    finally { setFlowBusy(false); renderFlowList(); }
  }
  $('fabFlowSel').onchange = () => { const id = $('fabFlowSel').value; if (id !== fabStore().active) openFlow(id); };
  $('fabFlowNew').onclick = () => { const f = fabStore(), fl = { id: newFlowId(), name: nextFlowName(), recipe: null }; f.flows.push(fl); return openFlow(fl.id); };
  $('fabFlowDup').onclick = () => {
    const f = fabStore(), src = activeFlow();
    const fl = { id: newFlowId(), name: `${src.name} copy`, recipe: JSON.parse(JSON.stringify(src.recipe || recipeData())) };
    f.flows.splice(f.flows.indexOf(src) + 1, 0, fl); f.active = fl.id;
    cancelEdit(false); st.history = []; st.future = [];        // the same simulation, its own history
    renderFlow(); renderFlowList(); app.markDirty?.('fab');
    toast(`Copied to <b>${esc(fl.name)}</b>.`);
  };
  $('fabFlowDel').onclick = async () => {
    const f = fabStore(), cur = activeFlow();
    if (f.flows.length === 1) { if (!st.flow.length || !confirm('Clear the process flow?')) return; snapshotHistory(); await replayAll([]); return; }
    if (!confirm(`Delete the process flow "${cur.name}"?`)) return;
    const i = f.flows.indexOf(cur); f.flows.splice(i, 1);
    await openFlow(f.flows[Math.min(i, f.flows.length - 1)].id);
  };
  $('fabFlowName').onchange = () => { const fl = activeFlow(), v = $('fabFlowName').value.trim(); fl.name = v || fl.name; app.markDirty?.('fab'); renderFlowList(); };

  // ---------------------------------------------------------------- views
  $('fabViewCross').onclick = () => setView('cross');
  $('fabView3D').onclick = () => setView('3d');
  function setView(v) {
    st.view = v;
    $('fabViewCross').classList.toggle('active', v === 'cross'); $('fabView3D').classList.toggle('active', v === '3d');
    $('fabCanvas2d').style.display = v === 'cross' ? 'block' : 'none'; $('fabCanvas3d').style.display = v === '3d' ? 'block' : 'none';
    $('fabCrossCtl').style.display = v === 'cross' ? '' : 'none'; $('fab3DCtl').style.display = v === '3d' ? '' : 'none';
    render();
  }
  $('fabZ').oninput = () => { st.zSlice = +$('fabZ').value; render(); };
  $('fabQ').onchange = () => { iso.setOptions({ quality: +$('fabQ').value }); iso.invalidate(); render(); };
  $('fabLabels').onchange = () => { iso.setOptions({ labels: $('fabLabels').checked }); render(); };
  $('fabPersp').onchange = () => { iso.camera.perspective = $('fabPersp').checked; render(); };
  const alphaOf = (m) => (!st.transparent ? 1 : isResist(m) ? 0.64 : m === M.SIO2 ? 0.58 : 1);   // the standalone's values
  const setTransparent = (on) => { st.transparent = on; $('fabTransp').checked = on; $('fabTransp2').checked = on; iso.setOptions({ alphaOf }); iso.invalidate(); render(); };
  $('fabTransp').onchange = (e) => setTransparent(e.target.checked);
  $('fabTransp2').onchange = (e) => setTransparent(e.target.checked);
  $('fabCam').onclick = () => { iso.resetCamera(); render(); };
  $('fab3H').oninput = () => { $('fab3HLabel').textContent = $('fab3H').value; iso.setOptions({ exag: +$('fab3H').value }); render(); };
  $('fabExag').onchange = () => { st.exag = $('fabExag').value === 'auto' ? 'auto' : +$('fabExag').value; render(); };
  $('fabXReset').onclick = () => { st.xZoom = 1; st.xCenter = 0.5; render(); };
  // horizontal zoom (wheel, around the cursor) and pan (drag) on the cross-section
  $('fabCanvas2d').addEventListener('wheel', (e) => {
    if (!layout2d || !st.built) return;
    e.preventDefault();
    const r = $('fabCanvas2d').getBoundingClientRect(), x = (e.clientX - r.left) * layout2d.dpr;
    const frac = (x - layout2d.ox) / (eng.state.W * layout2d.sx);            // column fraction under the cursor
    const k = e.deltaY < 0 ? 1.25 : 0.8;
    st.xZoom = Math.max(1, Math.min(200, st.xZoom * k));
    // keep the column under the cursor where it is: centre fraction follows
    const cxFrac = (r.width * layout2d.dpr) / 2;
    st.xCenter = frac - (x - cxFrac) / (eng.state.W * layout2d.sx * (st.xZoom === 1 ? 1 : k));
    if (st.xZoom === 1) st.xCenter = 0.5;
    render();
  }, { passive: false });
  let panDrag = null;
  $('fabCanvas2d').addEventListener('mousedown', (e) => { if (st.xZoom > 1) { panDrag = { x: e.clientX, c: st.xCenter }; e.preventDefault(); } });
  window.addEventListener('mousemove', (e) => { if (!panDrag || !layout2d) return; st.xCenter = panDrag.c - ((e.clientX - panDrag.x) * layout2d.dpr) / (eng.state.W * layout2d.sx); render(); });
  window.addEventListener('mouseup', () => { panDrag = null; });
  let layout2d = null;
  function render() {
    legend(); sampleSummary();
    if (!st.built) { const c = $('fabCanvas2d'); c.getContext('2d').clearRect(0, 0, c.width, c.height); return; }
    const z = Math.min(eng.state.D - 1, Math.round((st.zSlice / 100) * (eng.state.D - 1)));
    const g0 = st.sample?.grid;
    $('fabZLabel').textContent = eng.state.D > 1 ? `${z + 1} / ${eng.state.D}${g0 && st.sample.mode === '3d' ? ` · y = ${um(g0.y0 + (z + 0.5) * g0.dx, 3)}` : ''}` : '2D';
    $('fabZ').disabled = eng.state.D <= 1;
    if (st.view === 'cross') {
      const pend = st.pendingMaps && ($('fabStep').value === 'expose' || $('fabStep').value === 'uv_expose') ? st.pendingMaps[Math.min(z, st.pendingMaps.length - 1)] : null;
      let max = 0; if (pend) for (const m of st.pendingMaps) for (const v of m) if (v > max) max = v;
      st.xCenter = Math.max(0, Math.min(1, st.xCenter));
      layout2d = drawCrossSection($('fabCanvas2d'), eng.state, { zSlice: z, alphaOf, pendingDose: pend, doseMax: max, doseLabel: pend ? `dose to deliver (${st.pendingLabel}), max ${max.toFixed(0)} µC/cm²` : '', exag: st.exag, xZoom: st.xZoom, xCenter: st.xCenter });
      $('fabViewInfo').textContent = `${eng.state.W} × ${eng.state.H} × ${eng.state.D} voxels · ${eng.state.nmLat} × ${eng.state.nmVert} nm${layout2d && layout2d.exag > 1.05 ? ` · vertical ×${layout2d.exag.toFixed(0)}` : ''}${st.xZoom > 1 ? ` · zoom ×${st.xZoom.toFixed(1)}` : ''}`;
    } else { iso.setState(eng.state); iso.draw(); }
  }
  $('fabCanvas2d').addEventListener('mousemove', (e) => {
    if (!layout2d || !st.built) return;
    const r = $('fabCanvas2d').getBoundingClientRect(), x = (e.clientX - r.left) * layout2d.dpr, y = (e.clientY - r.top) * layout2d.dpr;
    const col = Math.floor((x - layout2d.ox) / layout2d.sx), row = Math.floor((y - layout2d.oy) / layout2d.sy) + (layout2d.y0 || 0);
    if (col < 0 || col >= eng.state.W || row < 0 || row >= eng.state.H) { $('fabHover').textContent = '—'; return; }
    const stack = eng.columnMaterials(layout2d.z, col).filter((c) => c.m !== M.AIR).map((c) => `${MAT_NAMES[c.m]} ${Math.round((c.y1 - c.y0) * eng.state.nmVert)} nm`).join(' / ');
    let dose = '';
    for (const rs of eng.state.resistStates) { const dm = rs.doseMaps?.[layout2d.z] || rs.doseMap; if (dm) { dose = ` · ${rs.name} dose ${dm[col].toFixed(1)} µC/cm²`; break; } }
    $('fabHover').innerHTML = `x = <b>${um((col + 0.5) * eng.state.nmLat, 2)}</b>: ${esc(stack || 'air')}${dose}`;
  });
  new ResizeObserver(() => { if (app.isTabActive('fab')) render(); }).observe($('fabWrap'));

  // ---------------------------------------------------------------- lifecycle
  let seenVersion = -1;
  async function show() {
    sourceOptions(); budgetOptions(); renderWafer(); updateSampleInfo(); renderFlowList();
    if (!st.restored) {
      st.restored = true;
      showParams($('fabStep').value);
      const saved = activeFlow().recipe;
      if (areaMissing(saved)) warnAreaMissing(saved);
      else if (saved && saved.steps) { try { await loadRecipe(saved); } catch (e) { $('fabStatus').textContent = e.message; } }
    } else if (st.built && st.sample && st.sample.source === 'area' && !deviceAreas(lib()).some((a) => a.id === st.sample.areaId)) {
      // E7: the device area this sample came from was deleted
      $('fabStatus').innerHTML = `<span style="color:#b45309">The device area <b>${esc(st.sample.areaName || '')}</b> this sample was built from no longer exists. Choose a sample and press <b>Build sample</b>, or undo the deletion in Pattern Studio.</span>`;
      staleFab.show('Its device area was deleted');
    } else if (seenVersion !== app.version && st.built && st.sample && st.sample.source !== 'free') {
      $('fabStatus').innerHTML = 'The layout or PSF changed since the flow was run — <b>Rebuild &amp; replay</b> (↻) to refresh the dose.';
      staleFab.show('The layout or PSF changed — ↻ rebuilds and replays the flow');
    }
    seenVersion = app.version;
    render();
  }
  function reset() {
    st.restored = false; st.built = false; st.sample = null; st.flow = []; st.thumbs = []; st.thumb0 = null; st.history = []; st.future = []; st.doseCache.clear(); st.pendingMaps = null;
    st.editIdx = -1; st.insertIdx = -1;
    $('fabStatus').textContent = ''; $('fabBuildInfo').innerHTML = 'Press <b>Build sample</b> to start (this clears the process flow).';
    staleFab.hide(); renderFlow();
    if (app.isTabActive('fab')) show();                    // E7: a project opened while Fab Studio is showing
  }
  // session: views and display settings (the recipe itself is app.project.fab)
  function getSession() {
    const c = iso.camera;
    return { view: st.view, exag: st.exag, xZoom: st.xZoom, xCenter: st.xCenter, zSlice: st.zSlice, compact: st.compact, transparent: st.transparent,
      q: $('fabQ').value, labels: $('fabLabels').checked, persp: $('fabPersp').checked, h: $('fab3H').value, cam: { az: c.az, el: c.el, zoom: c.zoom }, step: $('fabStep').value };
  }
  function setSession(o) {
    if (!o) return;
    st.exag = o.exag ?? st.exag; $('fabExag').value = String(st.exag);
    st.xZoom = o.xZoom ?? 1; st.xCenter = o.xCenter ?? 0.5; st.zSlice = o.zSlice ?? 50; $('fabZ').value = st.zSlice;
    st.compact = !!o.compact;
    $('fabQ').value = o.q ?? '1'; $('fabLabels').checked = o.labels !== false; $('fabPersp').checked = o.persp !== false; $('fab3H').value = o.h ?? 1; $('fab3HLabel').textContent = $('fab3H').value;
    iso.setOptions({ quality: +$('fabQ').value, labels: $('fabLabels').checked, exag: +$('fab3H').value });
    iso.camera.perspective = $('fabPersp').checked;
    if (o.cam) Object.assign(iso.camera, o.cam);
    if (o.transparent) { st.transparent = true; $('fabTransp').checked = true; $('fabTransp2').checked = true; iso.setOptions({ alphaOf }); iso.invalidate(); }
    if (o.step && STEP_LABELS[o.step]) { $('fabStep').value = o.step; showParams(o.step); }
    if (o.view === '3d' || o.view === 'cross') setView(o.view);
    renderFlow();
  }
  return { show, reset, engine: eng, state: st, getSession, setSession, _test: { runStep, replayAll, loadRecipe, buildFromForm, readParams, describeSample, openFlow, fabStore } };
}
