// Exposure tab: delivered dose of the layout with the PSF in use — heat map,
// cut-line profile, readout, per-shape proximity correction, the ideal (Wiener) teaching view,
// and the GPU surface plot. All dose work runs in the exposure worker.

import { $, esc, toast } from '../dom.js';
import { createExposureClient } from './client.js';
import { createOutlineRenderer, drawDeviceAreas } from '../common/outline.js';
import { createSurface } from './surface3d.js';
import { cmapFn, cmapOptions } from '../colormaps.js';
import { staleOverlay } from '../stale.js';
import { f32ToB64, b64ToF32 } from '../../core/codec.js';
import { cellBBox, hresZones, highLayers } from '../../core/geom/library.js';
import { forEachCellInstance } from '../../core/exposure/scene.js';
import { apply } from '../../core/geom/transform.js';
import { unpackCells } from '../../core/geom/pack.js';
import { download } from '../dom.js';
import { RESIST_PRESETS, RESIST_LABELS } from '../../core/fab/materials.js';
import { makeResist, remainingFraction } from '../../core/physics/resist.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const FIELD_LABEL = {
  delivered: 'Delivered dose', designed: 'Designed (target) dose', write: 'Writing dose', longrange: 'Long-range (backscatter) part',
  factor: 'Correction factor (writing ÷ target)', uncorrected: 'Delivered without correction', wiener_write: 'Ideal writing dose (Wiener)', wiener_delivered: 'Ideal delivered (Wiener)',
};

const CMAPS = new Proxy({}, { get: (_, name) => cmapFn(name) });   // colormaps.js, any of the ten

export function createExposureTab(app) {
  const root = $('tab-exposure');
  root.innerHTML = `
  <div class="toolbar">
    <span style="font-size:12px;color:#666;">Map shows</span>
    <select class="field" id="exField" style="width:auto;">
      <option value="delivered">Delivered dose</option>
      <option value="designed">Designed (target) dose</option>
      <option value="write">Writing dose</option>
      <option value="factor">Correction factor</option>
      <option value="longrange">Long-range part only</option>
      <option value="uncorrected">Delivered without correction</option>
      <option value="wiener_write" disabled>Ideal writing dose (Wiener)</option>
      <option value="wiener_delivered" disabled>Ideal delivered (Wiener)</option>
    </select>
    <span class="q" data-tip="<b>Map shows</b><br><b>Delivered</b> — what the resist receives: every shape's writing dose convolved with the PSF (short range exact at the edges, long range on a β/8 grid).<br><b>Designed</b> — the target doses, no scattering.<br><b>Writing dose</b> — what the beam writes (after <i>Apply</i>, the corrected doses).<br><b>Correction factor</b> — writing ÷ target.<br><b>Long-range part</b> — only the backscatter contribution: the proximity halo.<br><b>Without correction</b> — delivered dose as if every shape were written at its target.">?</span>
    <span class="sep"></span>
    <span style="font-size:12px;color:#666;">Colours</span>
    <select class="field" id="exCmap" style="width:auto;">${cmapOptions('wred')}</select>
    <span style="font-size:12px;color:#666;">max</span><input class="field" id="exMax" type="number" value="200" step="10" style="width:80px;">
    <label class="row" style="gap:4px;font-size:12px;"><input type="checkbox" id="exAuto">auto</label>
    <span id="exCutLamp" title="Part of the map is above max and drawn in the top colour, so different doses look the same there. Click to switch auto on." style="display:none;align-items:center;gap:4px;font-size:12px;color:#b91c1c;cursor:pointer;white-space:nowrap;"><span style="width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 6px 1px rgba(239,68,68,.8);flex:none;"></span><span class="lamptxt"></span></span>
    <span style="font-size:12px;color:#666;">Detail</span>
    <select class="field" id="exStep" style="width:auto;"><option value="4">fast</option><option value="2" selected>normal</option><option value="1">fine</option></select>
    <span class="sep"></span>
    <button class="btn" id="exDrawLine" title="Draw a new cut-line: drag on the map (or hold L and drag at any time; Shift snaps to 0/45/90°)">✎ Cut-line <kbd style="font-size:10px;">L</kbd></button>
    <button class="btn" id="exFit">Fit view</button>
    <button class="btn" id="exSync">Same view as Pattern Studio</button>
  </div>
  <div class="grid">
    <div class="col">
      <div class="panel">
        <div class="section-title">PSF in use <span class="q" data-tip="Change it in the <b>PSF</b> tab.">?</span></div>
        <div class="hint" id="exPsf">—</div>
      </div>
      <div class="panel">
        <div class="section-title">Readout <span class="q" data-tip="Dose under the pointer: designed, delivered with the PSF, and their ratio. At the edge of a large pad the delivered dose is half the target — that is where the resist edge should land.">?</span></div>
        <div class="hint" id="exReadout">Move the pointer over the map.</div>
      </div>
      <div class="panel">
        <div class="section-title">Proximity correction <span class="q" data-tip="<b>Per-shape correction</b> (level a of the design): every shape — or fused object — gets one writing dose, chosen so that the delivered dose at the middle of its longest edge is <b>half its target</b>, exactly as at the edge of a large isolated pad. The PSF is used in full: the short range exactly, the long range on its grid.<br><br>Narrow isolated lines lose forward-scattered energy and need more dose; shapes in dense surroundings receive backscatter from their neighbours and need less.<br><br><b>Apply</b> writes the doses into the shapes (undoable in Pattern Studio); the targets stay.">?</span></div>
        <div class="label">Method <span class="q" data-tip="<b>Per-shape</b>: one writing dose per object, set at the middle of its longest free edge. Fast and writable as it is, but flat over each shape: corners, tips and line ends stay under-exposed and big pads still flood their neighbours.<br><br><b>Fractured</b>: every object is cut into edge strips, corner/tip and line-end pieces and interior tiles, and each fragment gets its own dose, solved over the whole layout with the full PSF — forward scattering, the fast-secondary mid-range and backscatter. Edges, corners and tips get ½ of the target where the outline should be; interiors the full target. The result is <b>writing data</b> (fragments with dose classes): what a writer's pattern generator fills with shots. The design is not changed.<br><br><b>Fractured — long range correction only</b>: the same fragments, but only the backscatter is corrected. Each fragment gets the dose that brings it to the level of a large uniformly exposed area; forward scattering is left as it is, so edges and corners are not boosted (and nothing overshoots inside narrow lines), but small features stay as under-exposed at their edges as forward scattering makes them. The Corners, Interiors and Corner piece settings do not apply.<br><br><b>Quick — long range on a coarse grid</b>: no fragments. Each object is written at its dose × one factor, taken at its centre from a factor map on a grid of about β/3 that cancels the backscatter (srSelf · f · t + LR ⊗ (f · t · c) = t, solved by FFT). Seconds for a whole chip, whatever the number of objects, and large areas come out right; edges, corners and narrow features are not corrected, and an object larger than a grid cell gets one factor throughout. A first look before a fractured run, or for layouts where backscatter is the whole story. The fragment settings do not apply.">?</span></div>
        <select class="field" id="exPcMethod"><option value="shape">Per-shape (one dose per object)</option><option value="frac">Fractured — edges, corners, interior</option><option value="fracLR" selected>Fractured — long range correction only</option><option value="fracQuick">Quick — long range on a coarse grid (seconds)</option></select>
        <div id="exPcShapeBox" style="margin-top:8px; display:none;">
        <div class="row"><button class="btn primary" id="exRun">Run correction</button><button class="btn" id="exApply" disabled>Apply to shapes</button><button class="btn" id="exClear">Clear correction</button></div>
        <div class="hint" id="exPcStatus" style="margin-top:6px;">Not run.</div>
        <div id="exPcTable" style="margin-top:6px; max-height:260px; overflow:auto;"></div>
        </div>
        <div id="exPcFracBox" style="margin-top:8px;">
          <div class="three">
            <div><div class="label">Edge strip (nm) <span class="q" data-tip="Width of the edge fragments. About the fast-secondary range (50 nm) works well; small features get narrower strips automatically.">?</span></div><input class="field" id="exFrW" type="number" value="50" min="2" step="5"></div>
            <div><div class="label">Segment (nm)</div><input class="field" id="exFrSeg" type="number" value="500" min="20" step="50"></div>
            <div><div class="label">Corner (nm)</div><input class="field" id="exFrCorner" type="number" value="100" min="5" step="10"></div>
            <div><div class="label">Interior tile (µm) <span class="q" data-tip="Interior fragments, on the backscatter scale. Blank: β/8.">?</span></div><input class="field" id="exFrTile" type="number" min="0.2" step="0.5" placeholder="β/8"></div>
            <div><div class="label">Max factor</div><input class="field" id="exFrMax" type="number" value="8" min="1.5" step="0.5"></div>
            <div><div class="label">Dose classes <span class="q" data-tip="The fragment doses are rounded to this many levels (logarithmic) — writers take a limited number of dose classes. The error after rounding is reported.">?</span></div><input class="field" id="exFrClasses" type="number" value="64" min="2" step="1"></div>
            <div><div class="label">Fit <span class="q" data-tip="<b>Contour</b>: every outline is sampled (every few nm, and at its vertices) and the fragment doses are fitted, in the least-squares sense, to the dose the design would get with the backscatter removed — the design convolved with the short-range PSF. That is ½ of the target on a straight edge, the right share at a corner, and less than the full target inside a feature narrower than the forward and secondary-electron range, so the expectation follows each feature's size. No point is forced at the cost of the others, so narrow features do not overshoot.<br><br><b>Control points</b>: one point per fragment, each met exactly (½ at edges and corners, the target inside). Good for large, regular structures cut finely; with corner pieces as long as the feature is wide, parts of the outline are not controlled and edges can overshoot.">?</span></div><select class="field" id="exFrFit"><option value="contour">Contour (least squares)</option><option value="control" selected>Control points</option></select></div>
            <div><div class="label">Precision <span class="q" data-tip="How closely the Contour fit samples each outline. <b>Standard</b>: a point every 25 nm (and at every vertex). <b>Fine</b>: every 12.5 nm, about 1.5× the time. <b>Draft</b>: every 50 nm, about 0.8× the time. Measured on 100 nm L-shaped lines: Standard is within 0.8 % of Fine, Draft within 1.5 %; coarser than Draft the error grows quickly (8 % at 100 nm). Does not apply to the Control points fit.">?</span></div><select class="field" id="exFrAcc"><option value="12.5" selected>Fine</option><option value="25">Standard</option><option value="50">Draft</option></select></div>
            <div><div class="label">Corner piece ≤ <span class="q" data-tip="The largest share of an edge a corner piece may take. ½ (the original rule): on a short edge the two corner pieces meet in the middle and nothing controls the edge's midpoint. ¼: every edge keeps a middle piece controlled at its midpoint, where a small feature's developed edge has to land.">?</span></div><select class="field" id="exFrCornerFrac"><option value="0.5">½ of the edge</option><option value="0.25" selected>¼ of the edge</option></select></div>
            <div><div class="label">Corners <span class="q" data-tip="Square: a sharp corner's tip is pulled to the 50 % level, so the developed outline passes through the corner (the original rule; small corners get extra dose). Natural: the tip gets the share a perfectly exposed shape has there (¼ for a right angle), so corners round as the PSF dictates. Applies to the Control points fit; the Contour fit always takes the corner targets from the PSF.">?</span></div><select class="field" id="exFrCorners"><option value="square">square</option><option value="natural">natural</option></select></div>
            <div><div class="label">Interiors <span class="q" data-tip="Full: interior pieces are solved to the full target (the original rule). Band: edge equalization — interiors only have to stay between 0.75 and 1.5 × the target, and are left alone inside that band.">?</span></div><select class="field" id="exFrInterior"><option value="full">full target</option><option value="band">band 0.75–1.5</option></select></div>
            <div><div class="label">Dose floor (×) <span class="q" data-tip="The lowest writing dose, as a fraction of the shape's dose. Blank: 1 / max factor (the original rule).">?</span></div><input class="field" id="exFrMin" type="number" min="0.01" step="0.05" placeholder="1/max"></div>
          </div>
          <div class="row" style="margin-top:8px;gap:6px;align-items:center;flex-wrap:nowrap;"><span class="label" style="margin:0;flex:none;">Correct <span class="q" data-tip="<b>Whole layout</b>: every object is fractured and solved. <b>Selected region only</b>: drag a rectangle on the map (Pick region). The objects that meet it, plus a margin of twice the short-range reach (at least 1 µm), are fractured and solved in full; everything else is exposed at its design dose × a quick long-range factor computed on a coarse backscatter grid (seconds for a whole chip), and enters the solve as a fixed source — its backscatter and its short-range dose on the fragments beside it. The fidelity figures count the region alone. Use it to check the result on a critical area before the long run; on a test layout the region's doses agreed with a full run within 0.3 %.<br><br><b>High-resolution parts</b>: the whole layout gets the base correction (the quick long-range factor, one dose per object); the objects on layers set to <i>high resolution</i> in Pattern Studio, and the parts of objects inside the rectangles on the <i>High-resolution PEC zones</i> layer, are fractured and corrected in full against it — its backscatter and short-range dose. Then one feedback pass: the base doses are solved again with the high parts at their corrected doses, and the high parts once more against that. One writing file, the dose classes of both merged into the class limit.">?</span></span><select class="field" id="exFrScope" style="width:auto;flex:1;min-width:0;"><option value="all" selected>whole layout</option><option value="region">selected region only</option><option value="high">high-resolution parts</option></select><button class="btn" id="exFrPick" style="flex:none;">Pick region</button></div>
          <div class="hint" id="exFrRegion" style="margin-top:4px;"></div>
          <div class="row" style="margin-top:8px;"><button class="btn primary" id="exFrRun">Fracture &amp; correct</button><button class="btn" id="exFrCancel" hidden>Cancel</button><button class="btn" id="exFrApply" disabled>Use as writing data</button><button class="btn" id="exFrClear">Clear</button></div>
          <div id="exFrProg" hidden style="margin-top:8px;">
            <div style="height:10px;border:1px solid var(--border,#ddd);border-radius:5px;background:var(--bg,#f6f7f9);overflow:hidden;"><div id="exFrProgFill" style="height:100%;width:0;background:var(--accent,#06f);transition:width .15s linear;"></div></div>
            <div class="hint" id="exFrProgText" style="margin-top:4px;display:flex;justify-content:space-between;gap:8px;"><span id="exFrProgStage"></span><span id="exFrProgTime" style="flex:none;font-variant-numeric:tabular-nums;"></span></div>
          </div>
          <div class="hint" id="exFrStatus" style="margin-top:6px;">Not run.</div>
          <div id="exFrTable" style="margin-top:6px;"></div>
          <div class="label" style="margin-top:8px;">Fragment outlines on the map <span class="q" data-tip="Draws every fragment's outline over the map, coloured by its dose class (same colours as the table). The slider is the opacity: 0 hides them. Switched on when a fracture finishes.">?</span></div>
          <div class="row" style="gap:8px;flex-wrap:nowrap;"><input type="range" id="exFrShow" min="0" max="100" step="5" value="0" style="flex:1;min-width:0;"><span class="hint" id="exFrShowV" style="flex:none;width:36px;text-align:right;">off</span></div>
          <div class="section-title" style="margin-top:10px;font-size:13px;">Shots <span class="q" data-tip="What the pattern generator does next: each fragment is filled with shots on the beam-step grid, each shot's dwell = dose × step² / current. An estimate, before writer-specific fracturing into the field/subfield structure.">?</span></div>
          <div class="three">
            <div style="align-self:end;"><button class="btn small" id="exFrExport">Export writing data…</button></div>
          </div>
          <div class="hint" id="exShInfo" style="margin-top:4px;"></div>
        </div>
      </div>
    </div>
    <div class="col">
      <div class="canvas-wrap" id="exWrap"><canvas id="exCanvas" style="display:block;width:100%;touch-action:none;"></canvas></div>
      <div class="statusbar"><span id="exStatus">—</span><span id="exCursor" style="margin-left:auto;"></span></div>
      <div class="panel" style="margin-top:10px;">
        <div class="row" style="justify-content:space-between;margin-bottom:4px;">
          <div class="section-title" style="margin:0;">Profile along the cut-line <span class="q" data-tip="<b>Draw a new cut-line:</b> hold <kbd>L</kbd> and drag on the map (or press ✎ Cut-line, then drag); <kbd>Shift</kbd> snaps to 0/45/90°. Adjust it with the round end handles or the square middle handle. <b>Green</b> designed · <b>black</b> delivered · <b>grey dashed</b> delivered without correction (when one is applied) · <b>red</b> ideal Wiener result · dotted: half the target, the development edge criterion.">?</span></div>
          <div class="hint" id="exProfInfo"></div>
        </div>
        <div class="row" style="align-items:flex-start;gap:14px;">
          <div id="exWienerBox" style="flex:0 0 230px;min-width:200px;">
            <div class="section-title" style="margin:0 0 6px;font-size:13px;">Raster correction (Wiener) <span class="q" data-tip="<b>Wiener deconvolution</b> of the target on a raster over the current view — the old Pattern Studio's correction: the continuous writing-dose map that reproduces the design, with the extra dose at edges and corners. Exact inversion needs <i>negative</i> doses and spikes (clipped here); the regularisation λ trades exactness for realism. Shown as two map fields, as <b>Correction / Corrected → Raster</b> in the 3D view, and as a red curve in the profile.">?</span></div>
            <div class="three">
              <div><div class="label">λ</div><input class="field" id="exLambda" type="number" value="0.01" step="0.005" min="0"></div>
              <div><div class="label">Raster</div><select class="field" id="exWN"><option>128</option><option selected>256</option><option>512</option><option>1024</option></select></div>
              <div><div class="label">Max dose</div><input class="field" id="exWMax" type="number" value="1000" step="50"></div>
            </div>
            <div class="row" style="margin-top:8px;"><button class="btn" id="exWiener">Compute for this view</button></div>
            <div class="hint" id="exWStatus" style="margin-top:6px;"></div>
          </div>
          <div style="flex:1 1 360px;min-width:0;">
            <svg id="exChart" viewBox="0 0 1000 230" preserveAspectRatio="none" style="width:100%;height:230px;display:block;"></svg>
          </div>
        </div>
      </div>
      <div class="panel" id="ex3DPanel" style="margin-top:10px;">
        <div class="row" style="gap:12px;align-items:flex-end;margin-bottom:8px;">
          <div><div class="label">Shows</div><select class="field" id="ex3Field" style="width:auto;"><option value="map">As map above</option><option value="designed">Designed</option><option value="delivered" selected>Delivered</option><option value="corrected">Corrected</option><option value="correction">Correction</option><option value="developed">Developed</option></select></div>
          <div id="ex3SrcBox" style="display:none;"><div class="label">Correction <span class="q" data-tip="<b>Per-shape</b> — Run correction → Apply: one writing dose per shape. Writable as it is (dose classes), but flat over each shape: no extra dose at corners and edges.<br><b>Fractured</b> — Fracture &amp; correct → Use as writing data: edge strips, corners, line ends and interior tiles each with their own dose, solved over the whole layout. Writable, and with the corner and edge enhancement.<br><b>Raster (Wiener)</b> — the deconvolution of the old Pattern Studio, computed in the panel on the left for the current view: a writing-dose map that raises edges and corners. The ideal, needing clipped negative doses — it shows what the corner and edge enhancement must look like.">?</span></div><select class="field" id="ex3Src" style="width:auto;"><option value="shape">Per-shape (applied)</option><option value="frac">Fractured (writing data)</option><option value="raster">Raster (Wiener)</option></select></div>
          <div><div class="label">Resolution <span class="q" data-tip="Grid points per side of the surface. It is drawn on the GPU in one call, so even 2048 × 2048 rotates smoothly; computing the field takes a few seconds at the highest settings.">?</span></div><select class="field" id="ex3Res" style="width:auto;"><option>256</option><option selected>512</option><option>1024</option><option>2048</option></select></div>
          <div style="width:140px;"><div class="label">Height</div><input type="range" id="ex3H" min="0.2" max="2.5" step="0.05" value="0.9" style="width:100%;"></div>
          <label class="row" style="gap:4px;font-size:12px;"><input type="checkbox" id="ex3Contour" checked>contours</label>
          <label class="row" style="gap:4px;font-size:12px;"><input type="checkbox" id="ex3Target" checked>target overlay</label>
          <div style="width:110px;"><div class="label">Clearing level <span class="q" data-tip="A red plane at this dose, and a red line where the dose surface crosses it: inside the line the resist clears. In % of the nominal dose; 50 % is the threshold the correction aims every edge at (½ of the target). In Fab Studio the suggested dose scale puts this level at the resist's D₁₀₀. 0 = off.">?</span></div><input class="field" id="ex3Clear" type="number" min="0" max="200" step="5" value="50"></div>
          <div><div class="label">Ceiling <span class="q" data-tip="The highest dose the surface draws; anything above is cut flat at this height. Its own setting, separate from the map's Max. Auto: the highest value in the computed field, so nothing is cut. With a fixed ceiling below the pattern dose, the pattern and the hottest part of the backscatter halo are flattened to the same height and look alike.">?</span></div><div class="row" style="gap:4px;flex-wrap:nowrap;"><input class="field" id="ex3Max" type="number" value="200" min="1" step="10" style="width:70px;" disabled><label class="row" style="gap:4px;font-size:12px;"><input type="checkbox" id="ex3Auto" checked>auto</label><span id="ex3CutLamp" title="Part of the surface is above the ceiling and cut flat at it, so different doses look the same height there. Click to switch auto on." style="display:none;align-items:center;gap:4px;font-size:12px;color:#b91c1c;cursor:pointer;white-space:nowrap;"><span style="width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 6px 1px rgba(239,68,68,.8);flex:none;"></span><span class="lamptxt"></span></span></div></div>
          <div><div class="label">Colours</div><select class="field" id="ex3Cmap" style="width:auto;">${cmapOptions('viridis')}</select></div>
          <button class="btn small" id="ex3Reset">Reset camera</button>
          <label class="row" style="gap:4px;font-size:12px;" title="Recompute the surface whenever the map above is panned, zoomed or changes field"><input type="checkbox" id="ex3Follow">follow the map</label>
          <button class="btn small" id="ex3Update">Update now</button>
        </div>
        <div class="row" style="margin:-2px 0 6px;">
          <span class="hint" id="ex3Status"></span>
        </div>
        <div class="canvas-wrap"><canvas id="ex3Canvas" style="display:block;width:100%;height:560px;cursor:grab;"></canvas></div>
        <div id="ex3DevBox" class="row" style="display:none;gap:10px;align-items:flex-end;margin-top:8px;flex-wrap:wrap;">
          <div><div class="label">Resist</div><select class="field" id="ex3Resist" style="width:auto;">${Object.keys(RESIST_PRESETS).map((k) => `<option value="${k}">${esc(RESIST_LABELS[k] || k)}</option>`).join('')}</select></div>
          <div style="width:90px;"><div class="label">Thickness (nm)</div><input class="field" id="ex3Thick" type="number" value="100" min="5" step="10"></div>
          <div style="width:90px;"><div class="label">Dev. time (s) <span class="q" data-tip="As in Fab Studio: the contrast curve is the preset's for its standard development; the time adds dark erosion (rate × time) of the unexposed resist.">?</span></div><input class="field" id="ex3DevT" type="number" value="60" min="1" step="5"></div>
          <div style="width:70px;"><div class="label">γ</div><input class="field" id="ex3Gamma" type="number" step="0.5" min="0.5"></div>
          <div style="width:90px;"><div class="label">Rounding (%) <span class="q" data-tip="Kink rounding of the contrast curve, as in Fab Studio: softens the corners at D₀ and D₁₀₀ without changing γ.">?</span></div><input class="field" id="ex3Soft" type="number" value="100" min="0" max="100" step="10"></div>
          <div style="width:90px;"><div class="label">D₁₀₀ (µC/cm²)</div><input class="field" id="ex3D100" type="number" step="10" min="1"></div>
          <div style="width:90px;"><div class="label">Dose scale × <span class="q" data-tip="The Exposure tab works in relative doses (nominal 100). The scale turns them into the absolute dose the resist sees; the suggested value puts corrected edges (½ of the nominal) at D₁₀₀ — the same rule as Fab Studio.">?</span></div><input class="field" id="ex3Scale" type="number" step="0.5" min="0.01"></div>
          <div><div class="label">Dose from</div><select class="field" id="ex3DevFrom" style="width:auto;"><option value="delivered">Delivered</option><option value="corrected">Corrected</option></select></div>
          <span class="hint" id="ex3DevHint"></span>
        </div>
        <div class="hint" style="margin-top:4px;">Left-drag rotates · right- or Shift-drag pans · wheel zooms. Green skin: the target dose. <b>Developed</b>: the resist that is left (height = remaining thickness), read off the contrast curve point by point — 1D development, as in Fab Studio.</div>
      </div>
    </div>
  </div>`;

  const client = createExposureClient();
  const drawOutlines = createOutlineRenderer();
  const canvas = $('exCanvas'), ctx = canvas.getContext('2d');
  const st = {
    view: null, W: 800, H: 480, dpr: 1, field: 'delivered', cmap: 'wred', max: 200, auto: false, step: 2,
    heat: null, heatImg: null, pendingHeat: 0, line: null, prof: null, wiener: null, wienerStale: false,
    pc: null, version: -1, drag: null, hover: null, show3D: false, surface: null,
  };

  // ---------------------------------------------------------------- project sync
  function ensureProject() { client.setProject(app.project, app.version); }
  const lib = () => app.project.library;

  // ---------------------------------------------------------------- view
  const s2w = (sx, sy) => ({ x: st.view.ox + sx * st.view.s, y: st.view.oy - sy * st.view.s });
  const w2s = (x, y) => ({ x: (x - st.view.ox) / st.view.s, y: (st.view.oy - y) / st.view.s });
  function resize() {
    const wrap = $('exWrap');
    const w = Math.max(320, wrap.clientWidth - 2), h = clamp(Math.floor(window.innerHeight * 0.55), 340, 900);
    st.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === st.W && h === st.H && canvas.width === Math.round(w * st.dpr)) return false;
    st.W = w; st.H = h; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * st.dpr); canvas.height = Math.round(h * st.dpr);
    return true;
  }
  function fitView() {
    const bb = cellBBox(lib(), lib().top);
    if (!bb) { st.view = { s: 200, ox: 0, oy: 0 }; return; }
    const w = Math.max(bb.x2 - bb.x1, 100), h = Math.max(bb.y2 - bb.y1, 100);
    const s = Math.max((w * 1.24) / st.W, (h * 1.24) / st.H);
    st.view = { s, ox: (bb.x1 + bb.x2) / 2 - (st.W * s) / 2, oy: (bb.y1 + bb.y2) / 2 + (st.H * s) / 2 };
  }
  function defaultLine() {
    const a = s2w(st.W * 0.08, st.H * 0.5), b = s2w(st.W * 0.92, st.H * 0.5);
    st.line = { a: [a.x, a.y], b: [b.x, b.y] };
  }

  // ---------------------------------------------------------------- heat map
  let heatTimer = null;
  function requestHeat(delay = 60) {
    clearTimeout(heatTimer);
    heatTimer = setTimeout(computeHeat, delay);
    viewChanged3D();
  }
  async function computeHeat() {
    ensureProject();
    const step = st.step, s = st.view.s * step;
    const nx = Math.ceil(st.W / step), ny = Math.ceil(st.H / step);
    const grid = { x0: st.view.ox, y0: st.view.oy - ny * s, dx: s, nx, ny };
    const field = st.field;
    const ticket = ++st.pendingHeat;
    $('exStatus').textContent = 'computing…';
    try {
      const t0 = performance.now();
      const data = await fieldOnGrid(field, grid);
      if (ticket !== st.pendingHeat) return;
      st.heat = { data, grid, field };
      paintHeat();
      $('exStatus').innerHTML = `${esc(FIELD_LABEL[field])} · ${nx} × ${ny} cells of ${(s / 1000).toPrecision(3)} µm · ${(performance.now() - t0).toFixed(0)} ms`;
      render();
    } catch (e) { if (ticket === st.pendingHeat) { $('exStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; } }
  }
  // any of the map's fields on a grid (the map and the 3D surface use the same)
  async function fieldOnGrid(field, grid) {
    if (field === 'factor') {
      const [w, d] = await Promise.all([client.request('raster', { grid, field: 'write' }), client.request('raster', { grid, field: 'designed' })]);
      const data = new Float32Array(grid.nx * grid.ny);
      for (let k = 0; k < data.length; k++) data[k] = d.data[k] > 1e-9 ? w.data[k] / d.data[k] : 0;
      return data;
    }
    if (field.startsWith('wiener_')) {
      if (!st.wiener) throw new Error('compute the ideal correction (Wiener) first');
      return resample(st.wiener.grid, field === 'wiener_write' ? st.wiener.write : st.wiener.delivered, grid);
    }
    return (await client.request('raster', { grid, field })).data;
  }
  function resample(src, data, grid) {
    const out = new Float32Array(grid.nx * grid.ny);
    for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
      const x = grid.x0 + (i + 0.5) * grid.dx, y = grid.y0 + (j + 0.5) * grid.dx;
      out[j * grid.nx + i] = bilinear(src, data, x, y);
    }
    return out;
  }
  function bilinear(g, data, x, y) {
    const u = (x - g.x0) / g.dx - 0.5, v = (y - g.y0) / g.dx - 0.5;
    if (u < -0.5 || v < -0.5 || u > g.nx - 0.5 || v > g.ny - 0.5) return 0;
    const i0 = clamp(Math.floor(u), 0, g.nx - 2), j0 = clamp(Math.floor(v), 0, g.ny - 2), fu = clamp(u - i0, 0, 1), fv = clamp(v - j0, 0, 1);
    return (1 - fu) * (1 - fv) * data[j0 * g.nx + i0] + fu * (1 - fv) * data[j0 * g.nx + i0 + 1] + (1 - fu) * fv * data[(j0 + 1) * g.nx + i0] + fu * fv * data[(j0 + 1) * g.nx + i0 + 1];
  }
  function scaleMax() {
    if (st.field === 'factor') return 2;
    if (st.auto && st.heat) { let m = 0; for (const v of st.heat.data) if (v > m) m = v; return m > 0 ? m * 1.02 : 1; }
    return st.max;
  }
  // the red lamp: how much of a field lies above the ceiling it is drawn with
  function cutLamp(id, data, M) {
    const el = $(id); if (!el) return 0;
    let n = 0, tot = 0;
    if (data && M > 0) { const lim = M * (1 + 1e-6); for (let i = 0; i < data.length; i++) { const v = data[i]; if (v === v) { tot++; if (v > lim) n++; } } }
    const f = tot ? n / tot : 0;
    el.style.display = n ? 'inline-flex' : 'none';
    if (n) el.querySelector('.lamptxt').textContent = `${f < 0.001 ? '< 0.1' : (100 * f).toFixed(f < 0.1 ? 1 : 0)} % cut`;
    return f;
  }
  function paintHeat() {
    const { data, grid } = st.heat, { nx, ny } = grid;
    const img = new ImageData(nx, ny), cm = CMAPS[st.cmap], M = scaleMax();
    st.mapCut = cutLamp('exCutLamp', data, M);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const t = clamp(data[j * nx + i] / M, 0, 1), c = cm(t), o = ((ny - 1 - j) * nx + i) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    const off = document.createElement('canvas'); off.width = nx; off.height = ny;
    off.getContext('2d').putImageData(img, 0, 0);
    st.heatImg = off;
  }

  // ---------------------------------------------------------------- drawing
  let rp = false;
  function render() { if (rp) return; rp = true; requestAnimationFrame(() => { rp = false; draw(); }); }
  function draw() {
    const { dpr } = st;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st.heatImg && st.heat) {
      const g = st.heat.grid;
      const a = w2s(g.x0, g.y0 + g.ny * g.dx), b = w2s(g.x0 + g.nx * g.dx, g.y0);
      ctx.imageSmoothingEnabled = st.step > 1;
      ctx.drawImage(st.heatImg, a.x, a.y, b.x - a.x, b.y - a.y);
    }
    drawOutlines(ctx, lib(), app.version, { ...st.view, W: st.W, H: st.H, dpr });
    drawDeviceAreas(ctx, lib(), { ...st.view, dpr });
    drawFragments(ctx);
    drawRegion(ctx);
    // cut-line and handles
    if (st.line) {
      const a = w2s(...st.line.a), b = w2s(...st.line.b), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      for (const p of [a, b]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, TAU); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.fillRect(m.x - 5, m.y - 5, 10, 10); ctx.lineWidth = 2; ctx.strokeRect(m.x - 5, m.y - 5, 10, 10);
    }
    drawColorbar();
  }
  function drawColorbar() {
    const x = st.W - 30, y = 14, h = 200, cm = CMAPS[st.cmap], M = scaleMax();
    for (let i = 0; i < h; i++) { const c = cm(1 - i / h); ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; ctx.fillRect(x, y + i, 14, 1); }
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 14, h);
    ctx.font = '11px system-ui';
    for (const t of [0, 0.5, 1]) {
      const txt = st.field === 'factor' ? (t * M).toFixed(1) + '×' : (t * M).toFixed(0);
      const w = ctx.measureText(txt).width + 6, yy = y + (1 - t) * h;
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x - w - 4, yy - 8, w, 14); ctx.fillStyle = '#111'; ctx.fillText(txt, x - w - 1, yy + 3);
    }
    ctx.fillStyle = '#111'; ctx.fillText(st.field === 'factor' ? '' : 'µC/cm²', x - 22, y + h + 14);
    // scale bar
    const target = 110 * st.view.s, p = 10 ** Math.floor(Math.log10(target));
    const L = [1, 2, 5, 10].map((m) => m * p).filter((v) => v <= target).pop() || p, px = L / st.view.s, bx = 14, by = st.H - 16;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(bx - 6, by - 18, px + 12, 26);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px, by); ctx.stroke();
    const t2 = L >= 1e6 ? `${L / 1e6} mm` : L >= 1000 ? `${L / 1000} µm` : `${L} nm`;
    ctx.fillStyle = '#111'; ctx.font = '12px system-ui'; ctx.fillText(t2, bx + px / 2 - ctx.measureText(t2).width / 2, by - 6);
  }

  // ---------------------------------------------------------------- profile
  let profTimer = null, profTicket = 0;
  function requestProfile(delay = 80) { clearTimeout(profTimer); profTimer = setTimeout(computeProfile, delay); }
  async function computeProfile() {
    if (!st.line) return;
    ensureProject();
    const N = 400, pts = [];
    for (let k = 0; k <= N; k++) { const t = k / N; pts.push([st.line.a[0] + (st.line.b[0] - st.line.a[0]) * t, st.line.a[1] + (st.line.b[1] - st.line.a[1]) * t]); }
    // per-shape doses applied, or fractured writing data in use: show the uncorrected dose beside it
    const corrected = !!app.project.writing?.active || Object.values(lib().cells).some((c) => c.shapes.some((s) => s.writeDose != null));
    const fields = ['designed', 'delivered', ...(corrected ? ['uncorrected'] : [])];
    const ticket = ++profTicket;
    try {
      const r = await client.request('points', { points: pts, fields });
      if (ticket !== profTicket) return;
      st.prof = { pts, ...r.values, ms: r.ms };
      if (st.wiener) st.prof.wiener = pts.map(([x, y]) => bilinear(st.wiener.grid, st.wiener.delivered, x, y));
      drawProfile();
    } catch (e) { $('exProfInfo').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
  }
  function drawProfile() {
    const svg = $('exChart'), P = st.prof;
    if (!P) return;
    const W = 1000, H = 230, L = 52, R = 10, T = 12, B = 28, vw = W - L - R, vh = H - T - B;
    const len = Math.hypot(st.line.b[0] - st.line.a[0], st.line.b[1] - st.line.a[1]);
    let max = 1;
    for (const k of ['designed', 'delivered', 'uncorrected', 'wiener']) if (P[k]) for (const v of P[k]) if (v > max) max = v;
    max *= 1.08;
    const X = (i, n) => L + (i / (n - 1)) * vw, Y = (v) => T + vh * (1 - v / max);
    // Array.from: the worker returns Float64Arrays, whose .map cannot hold strings
    const path = (vals) => Array.from(vals, (v, i) => `${i ? 'L' : 'M'}${X(i, vals.length).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    let g = '';
    for (let k = 0; k <= 4; k++) { const y = T + vh * (1 - k / 4); g += `<line x1="${L}" y1="${y}" x2="${L + vw}" y2="${y}" stroke="#f0f0f0"/><text x="${L - 6}" y="${y + 3}" font-size="10" fill="#666" text-anchor="end">${(max * k / 4).toFixed(0)}</text>`; }
    for (let k = 0; k <= 5; k++) { const x = L + (vw * k) / 5; g += `<text x="${x}" y="${T + vh + 15}" font-size="10" fill="#666" text-anchor="middle">${(len * k / 5 / 1000).toPrecision(3)}</text>`; }
    g += `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + vh}" stroke="#aaa"/><line x1="${L}" y1="${T + vh}" x2="${L + vw}" y2="${T + vh}" stroke="#aaa"/>`;
    const tmax = Math.max(...P.designed);
    if (tmax > 0) g += `<line x1="${L}" y1="${Y(tmax / 2)}" x2="${L + vw}" y2="${Y(tmax / 2)}" stroke="#2a7" stroke-dasharray="2 4"/>`;
    g += `<path d="${path(P.designed)}" fill="none" stroke="#2a7" stroke-width="1.6"/>`;
    if (P.uncorrected) g += `<path d="${path(P.uncorrected)}" fill="none" stroke="#999" stroke-width="1.4" stroke-dasharray="5 4"/>`;
    if (P.wiener) g += `<path d="${path(P.wiener)}" fill="none" stroke="#d13" stroke-width="1.4"/>`;
    g += `<path d="${path(P.delivered)}" fill="none" stroke="#000" stroke-width="1.6"/>`;
    g += `<text x="${L + vw}" y="${H - 4}" font-size="10" fill="#444" text-anchor="end">distance along the line (µm)</text><text x="4" y="${T - 2}" font-size="10" fill="#444">µC/cm²</text>`;
    svg.innerHTML = g;
    $('exProfInfo').textContent = `${(len / 1000).toPrecision(4)} µm, 401 exact points, ${P.ms.toFixed(0)} ms`;
  }

  // ---------------------------------------------------------------- readout
  let hoverTicket = 0, hoverBusy = false, hoverNext = null;
  async function readout(w) {
    if (hoverBusy) { hoverNext = w; return; }
    hoverBusy = true;
    const ticket = ++hoverTicket;
    try {
      const r = await client.request('points', { points: [[w.x, w.y]], fields: ['designed', 'delivered', 'longrange'] });
      if (ticket === hoverTicket) {
        const des = r.values.designed[0], del = r.values.delivered[0], lr = r.values.longrange[0];
        $('exReadout').innerHTML = `(${(w.x / 1000).toFixed(3)}, ${(w.y / 1000).toFixed(3)}) µm<br>Designed: <b>${des.toFixed(2)}</b> µC/cm²<br>Delivered: <b>${del.toFixed(2)}</b> µC/cm²${des > 1e-9 ? ` (${(100 * del / des).toFixed(1)} % of target)` : ''}<br><span class="hint">of which long range (backscatter): ${lr.toFixed(2)}</span>`;
      }
    } catch { /* ignore */ }
    hoverBusy = false;
    if (hoverNext) { const n = hoverNext; hoverNext = null; readout(n); }
  }

  // ---------------------------------------------------------------- mouse
  const evPt = (e) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  function hitHandle(sx, sy) {
    if (!st.line) return null;
    const a = w2s(...st.line.a), b = w2s(...st.line.b), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const [k, p] of [['a', a], ['b', b], ['m', m]]) if (Math.hypot(sx - p.x, sy - p.y) < 9) return k;
    return null;
  }
  // draw a new cut-line: hold L and drag, or the ✎ button (one drag)
  let lHeld = false, drawOnce = false;
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  const drawArmed = () => lHeld || drawOnce;
  const setDrawCursor = () => { canvas.style.cursor = drawArmed() ? 'crosshair' : 'grab'; $('exDrawLine').classList.toggle('active', drawArmed()); };
  window.addEventListener('keydown', (e) => { if (!app.isTabActive('exposure') || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'l' || e.key === 'L') { if (!lHeld) { lHeld = true; setDrawCursor(); } e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (e.key === 'l' || e.key === 'L') { lHeld = false; setDrawCursor(); } });
  window.addEventListener('blur', () => { lHeld = false; setDrawCursor(); });
  $('exDrawLine').onclick = () => { drawOnce = !drawOnce; setDrawCursor(); };
  const snapAngle = (a, b) => {                       // Shift: 0 / 45 / 90° about the start point
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: a.x + L * Math.cos(ang), y: a.y + L * Math.sin(ang) };
  };
  canvas.addEventListener('mousedown', (e) => {
    const { sx, sy } = evPt(e), h = hitHandle(sx, sy);
    if (st.pickRegion && e.button === 0) {
      const w = s2w(sx, sy);
      st.drag = { kind: 'region', start: w, old: st.region, sx, sy };
      st.region = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
      render(); e.preventDefault(); return;
    }
    if (drawArmed() && e.button === 0) {
      const w = s2w(sx, sy);
      st.drag = { kind: 'draw', start: w, old: st.line ? { a: [...st.line.a], b: [...st.line.b] } : null, sx, sy };
      st.line = { a: [w.x, w.y], b: [w.x, w.y] };
      render(); e.preventDefault(); return;
    }
    if (h && e.button === 0) st.drag = { kind: 'line', h, sx, sy, a: [...st.line.a], b: [...st.line.b] };
    else st.drag = { kind: 'pan', sx, sy, ox: st.view.ox, oy: st.view.oy };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!app.isTabActive('exposure')) return;
    const { sx, sy } = evPt(e);
    const d = st.drag;
    if (!d) {
      if (sx >= 0 && sy >= 0 && sx <= st.W && sy <= st.H && e.target === canvas) {
        const w = s2w(sx, sy);
        $('exCursor').innerHTML = `x <b>${(w.x / 1000).toFixed(3)}</b> µm, y <b>${(w.y / 1000).toFixed(3)}</b> µm`;
        canvas.style.cursor = drawArmed() || st.pickRegion ? 'crosshair' : hitHandle(sx, sy) ? 'move' : 'grab';
        readout(w);
      }
      return;
    }
    if (d.kind === 'pan') {
      st.view.ox = d.ox - (sx - d.sx) * st.view.s; st.view.oy = d.oy + (sy - d.sy) * st.view.s;
      render(); requestHeat(120);
    } else if (d.kind === 'region') {
      const w = s2w(sx, sy);
      st.region = { x1: d.start.x, y1: d.start.y, x2: w.x, y2: w.y };
      regionLabel(); render();
    } else if (d.kind === 'draw') {
      let w = s2w(sx, sy);
      if (e.shiftKey) w = snapAngle(d.start, w);
      st.line.b = [w.x, w.y];
      const L = Math.hypot(st.line.b[0] - st.line.a[0], st.line.b[1] - st.line.a[1]);
      $('exCursor').innerHTML = `cut-line <b>${L >= 1000 ? (L / 1000).toFixed(3) + ' µm' : L.toFixed(1) + ' nm'}</b>${e.shiftKey ? ' (snapped)' : ' · Shift snaps to 0/45/90°'}`;
      render(); requestProfile(80);
    } else {
      const dx = (sx - d.sx) * st.view.s, dy = -(sy - d.sy) * st.view.s;
      if (d.h === 'a' || d.h === 'm') st.line.a = [d.a[0] + dx, d.a[1] + dy];
      if (d.h === 'b' || d.h === 'm') st.line.b = [d.b[0] + dx, d.b[1] + dy];
      render(); requestProfile(60);
    }
  });
  window.addEventListener('mouseup', (e) => {
    const d = st.drag;
    if (d && d.kind === 'draw') {
      const { sx, sy } = evPt(e);
      if (Math.hypot(sx - d.sx, sy - d.sy) < 4) { if (d.old) st.line = d.old; render(); }   // a click, not a drag: keep the old line
      else requestProfile(0);
      drawOnce = false; setDrawCursor();
    }
    if (d && d.kind === 'region') {
      const { sx, sy } = evPt(e);
      if (Math.hypot(sx - d.sx, sy - d.sy) < 4) st.region = d.old;          // a click, not a drag
      else $('exFrScope').value = 'region';
      st.pickRegion = false; $('exFrPick').classList.remove('active'); canvas.style.cursor = 'grab';
      regionLabel(); render();
    }
    if (st.drag) { st.drag = null; }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { sx, sy } = evPt(e), before = s2w(sx, sy);
    st.view.s = clamp(st.view.s * (e.deltaY < 0 ? 0.9 : 1.1), 0.005, 2e5);
    const after = s2w(sx, sy);
    st.view.ox += before.x - after.x; st.view.oy += before.y - after.y;
    render(); requestHeat(140);
  }, { passive: false });

  // ---------------------------------------------------------------- controls
  $('exField').onchange = (e) => { st.field = e.target.value; requestHeat(0); };
  $('exCmap').onchange = (e) => { st.cmap = e.target.value; if (st.heat) paintHeat(); render();  };
  $('exMax').oninput = (e) => { st.max = Math.max(1, parseFloat(e.target.value) || 200); if (st.heat) paintHeat(); render(); };
  $('exAuto').onchange = (e) => { st.auto = e.target.checked; if (st.heat) paintHeat(); render(); };
  $('exStep').onchange = (e) => { st.step = +e.target.value; requestHeat(0); };
  $('exFit').onclick = () => { fitView(); if (!st.line) defaultLine(); render(); requestHeat(0); requestProfile(0); };   // keeps the user's cut-line
  $('exSync').onclick = () => { const v = app.editorView(); st.view = { s: v.s, ox: v.ox, oy: v.oy }; render(); requestHeat(0); };

  $('exRun').onclick = async () => {
    ensureProject();
    $('exRun').disabled = true; $('exPcStatus').textContent = 'running…'; $('exPcTable').innerHTML = '';
    try {
      const r = await client.request('correct', {}, (p) => { $('exPcStatus').textContent = `iteration ${p.iteration}: worst edge error ${(100 * p.maxError).toFixed(2)} %`; });
      showPc(r);
    } catch (e) { $('exPcStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
    $('exRun').disabled = false;
  };
  // ---------------------------------------------------------------- fractured correction
  // the 3D view's Correction source follows the method, so a fractured correction is what the 3D
  // view shows (a Raster default there was easy to miss)
  const follow3DSource = () => {
    const want = $('exPcMethod').value.startsWith('frac') ? 'frac' : 'shape', r = $('ex3Src');
    const opt = [...r.options].find((o) => o.value === want);
    if (opt && !opt.disabled && r.value !== want) { r.value = want; sync3DControls(); viewChanged3D(); }
  };
  const syncMethod = () => {
    const f = $('exPcMethod').value.startsWith('frac'), q = $('exPcMethod').value === 'fracQuick';
    $('exPcShapeBox').style.display = f ? 'none' : ''; $('exPcFracBox').style.display = f ? '' : 'none';
    $('exFrScope').disabled = q; $('exFrPick').disabled = q;      // the quick method covers the whole layout in seconds
    if (q && $('exFrScope').value === 'region') { $('exFrScope').value = 'all'; regionLabel(); render(); }
    fracStatus(); follow3DSource();
  };
  $('exPcMethod').onchange = syncMethod;
  const fracOpts = () => {
    const n = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
    return { maxPoints: 2e6, edgeW: Math.max(2, n('exFrW') ?? 50), segLen: Math.max(20, n('exFrSeg') ?? 500), cornerLen: Math.max(5, n('exFrCorner') ?? 100), tile: n('exFrTile') ? n('exFrTile') * 1000 : null, maxFactor: Math.max(1.5, n('exFrMax') ?? 8), classes: Math.max(2, Math.round(n('exFrClasses') ?? 64)),
      cornerFrac: +$('exFrCornerFrac').value || 0.5, corners: $('exFrCorners').value, interior: $('exFrInterior').value, minFactor: n('exFrMin') > 0 ? n('exFrMin') : null, range: { fracLR: 'long', fracQuick: 'quick' }[$('exPcMethod').value] || 'full', fit: $('exFrFit').value, sampleNm: +$('exFrAcc').value || 25,
      region: $('exFrScope').value === 'region' && $('exPcMethod').value !== 'fracQuick' ? normRegion() : null,
      high: $('exFrScope').value === 'high' && $('exPcMethod').value !== 'fracQuick' ? highParts() : null };
  };
  // ---- correct a region only: a rectangle dragged on the map (world nm)
  // the high-resolution parts: layers marked high in Pattern Studio, zones drawn on the zone layer
  const highParts = () => { const L = app.project.library; return { layers: highLayers(L), zones: hresZones(L) }; };
  const normRegion = () => { const r = st.region; return r ? { x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2), x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2) } : null; };
  const fmtL = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 1e5 ? 0 : 1)} µm` : `${v.toFixed(0)} nm`);
  // the region lies outside the layout's bounding box (left over from another layout)
  const regionOffLayout = (r) => { const b = cellBBox(lib(), lib().top); return !b || r.x2 < b.x1 || r.x1 > b.x2 || r.y2 < b.y1 || r.y1 > b.y2; };
  function regionLabel() {
    const r = normRegion(), scope = $('exFrScope').value;
    const hp = scope === 'high' ? highParts() : null;
    $('exFrRegion').innerHTML = st.pickRegion ? 'Drag a rectangle on the map.'
      : scope === 'high' ? (hp.layers.length || hp.zones.length ? `High resolution: ${hp.layers.length ? `layer${hp.layers.length > 1 ? 's' : ''} ${hp.layers.map(esc).join(', ')}` : ''}${hp.layers.length && hp.zones.length ? ' and ' : ''}${hp.zones.length ? `${hp.zones.length} zone${hp.zones.length > 1 ? 's' : ''}` : ''}; everything else the base correction.`
        : '<span style="color:#b45309">Nothing marked: in Pattern Studio set a layer\'s Proximity correction to <i>high resolution</i>, or draw rectangles on the <i>High-resolution PEC zones</i> layer.</span>')
      : scope !== 'region' ? ''
      : r ? `Region ${fmtL(r.x2 - r.x1)} × ${fmtL(r.y2 - r.y1)}, centred at (${(((r.x1 + r.x2) / 2) / 1000).toFixed(1)}, ${(((r.y1 + r.y2) / 2) / 1000).toFixed(1)}) µm.${regionOffLayout(r) ? ' <span style="color:#b45309">It does not meet the layout: press Pick region and drag a new one.</span>' : ''}`
      : '<span style="color:#b45309">No region yet: press Pick region and drag a rectangle on the map.</span>';
  }
  $('exFrPick').onclick = () => {
    st.pickRegion = !st.pickRegion;
    $('exFrPick').classList.toggle('active', st.pickRegion);
    canvas.style.cursor = st.pickRegion ? 'crosshair' : 'grab';
    regionLabel();
  };
  $('exFrScope').onchange = () => { regionLabel(); render(); };
  function drawRegion(ctx) {
    if ($('exFrScope').value === 'high') {
      // the zones, in the zone layer's magenta, with the solved margin once a run has said how wide
      const w = st.frac || app.project.writing, H = w && w.stats && w.stats.high;
      ctx.save();
      for (const z of highParts().zones) {
        const a = w2s(z.x1, z.y2), b = w2s(z.x2, z.y1);
        if (H) { const h = H.halo, A = w2s(z.x1 - h, z.y2 + h), B = w2s(z.x2 + h, z.y1 - h); ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y); }
        ctx.setLineDash([7, 4]); ctx.lineWidth = 2; ctx.lineDashOffset = 0;
        ctx.strokeStyle = '#fff'; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.lineDashOffset = 5.5; ctx.strokeStyle = '#d0368a'; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      ctx.restore();
      return;
    }
    const r = normRegion();
    if (!r || ($('exFrScope').value !== 'region' && !(st.drag && st.drag.kind === 'region'))) return;
    const a = w2s(r.x1, r.y2), b = w2s(r.x2, r.y1);
    ctx.save();
    // the margin solved with it, once a run has said how wide it is
    const w = st.frac || app.project.writing, R = w && w.stats && w.stats.region;
    if (R && Math.abs(R.x1 - r.x1) < 1e-6 && Math.abs(R.y2 - r.y2) < 1e-6) {
      const h = R.halo, A = w2s(r.x1 - h, r.y2 + h), B = w2s(r.x2 + h, r.y1 - h);
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y);
    }
    ctx.setLineDash([7, 4]); ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff'; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.lineDashOffset = 5.5; ctx.strokeStyle = '#d97706'; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  }
  function fracStatus() {
    sync3DControls();
    const w = app.project.writing;
    if (st.frac && st.frac !== w) return;                    // a fresh run waits for "Use as writing data"
    if (!w) { $('exFrStatus').textContent = 'Not run.'; $('exFrTable').innerHTML = ''; $('exShInfo').textContent = ''; $('exFrApply').disabled = true; return; }
    showFrac(w);
    $('exFrStatus').innerHTML = w.active ? '<span style="color:#15803d">✓ In use as writing data</span> — the maps, the 3D view and Fab Studio expose with it.'
      : `<span style="color:#b45309">Not in use: the ${esc(w.stale || 'layout')} changed since it was computed.</span> Run it again.`;
  }
  function showFrac(r) {
    const s = r.stats, pct = (v) => (100 * v).toFixed(2) + ' %';
    const kinds = Object.entries(s.kinds).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(', ');
    const row = (k, v) => `<div style="margin:3px 0;"><span style="color:var(--muted,#666);">${k}</span><br>${v}</div>`;
    if (s.fit === 'quick') {
      const Q = s.quick;
      $('exFrTable').innerHTML = `<div style="font-size:12px;line-height:1.35;">
      ${row('Method', `quick long range: each object at its dose × the factor at its centre, from a ${Q.grid.nx} × ${Q.grid.ny} grid of ${(Q.grid.dx / 1000).toFixed(2)} µm. Edges, corners and narrow features are not corrected.`)}
      ${row('Objects', `<b>${Q.objects.toLocaleString()}</b>, factor ${Q.factor[0].toFixed(3)} – ${Q.factor[1].toFixed(3)}`)}
      ${row('Solve', `${s.converged ? 'converged' : '<b style="color:#b45309">not converged</b>'} in ${s.iterations} iterations, ${(s.ms / 1000).toFixed(1)} s in all`)}
      ${row('Writing doses', `${s.doseRange[0].toFixed(1)} – ${s.doseRange[1].toFixed(1)} µC/cm² in ${r.classes.length} dose classes`)}</div>`;
      shotInfo(r);
      return;
    }
    $('exFrTable').innerHTML = `<div style="font-size:12px;line-height:1.35;">
      ${row('Method', r.params?.range === 'long' ? 'long range correction only (forward scattering left as it is)' : s.fit === 'contour' ? `full PSF, contour fit over ${(s.samples || 0).toLocaleString()} outline points` : 'full PSF, control points: edges at ½, interiors at the target')}
      ${s.high ? row('High-resolution parts', `${s.high.layers.length ? `layer${s.high.layers.length > 1 ? 's' : ''} ${s.high.layers.map(esc).join(', ')}` : ''}${s.high.layers.length && s.high.zones ? ' + ' : ''}${s.high.zones ? `${s.high.zones} zone${s.high.zones > 1 ? 's' : ''} (margin ${fmtL(s.high.halo)})` : ''}: <b>${s.high.fragments.toLocaleString()}</b> fragments corrected in full; ${s.high.contextObjects.toLocaleString()} objects at the base (quick long-range) dose.${s.high.feedback ? ` Feedback pass: base doses moved by up to ${(100 * s.high.feedback.factorShift).toFixed(2)} %, the high parts' doses by up to ${(100 * s.high.feedback.doseShift).toFixed(2)} %.` : ''} The error figures below are the high parts'.`) : ''}
      ${s.classMerge > 0.0005 ? row('Dose classes', `base and corrected classes merged into ${r.classes.length}; a dose moved by at most ${(100 * s.classMerge).toFixed(2)} %`) : ''}
      ${s.region ? row('Region only (preview)', `${fmtL(s.region.x2 - s.region.x1)} × ${fmtL(s.region.y2 - s.region.y1)}: <b>${s.region.regionFragments.toLocaleString()}</b> fragments in it, solved together with a ${fmtL(s.region.halo)} margin. Outside, ${s.region.contextObjects.toLocaleString()} objects at the quick long-range dose (${s.region.quickMs < 1000 ? s.region.quickMs + ' ms' : (s.region.quickMs / 1000).toFixed(1) + ' s'}). The error figures below are the region's.`) : ''}
      ${row('Fragments', `<b>${s.fragments.toLocaleString()}</b> — ${esc(kinds)}${s.arrayClasses ? `; arrays split into ${s.arrayClasses} context classes` : ''}`)}
      ${row('Solve', `${s.converged ? 'converged' : '<b style="color:#b45309">not converged</b>'} in ${s.iterations} iterations, ${(s.ms / 1000).toFixed(1)} s`
        + (s.backend === 'desktop' ? (s.core && (s.core.sr || s.core.solve || s.core.targets) ? ` · <b>Pro</b>: native core, ${s.core.threads} threads` : ' · <b>Pro</b> backend (JavaScript)') : s.helpers ? ` · in the page, ${s.helpers} helper workers` : ''))}
      ${!s.converged && s.held && s.held.count ? row('Held at the dose limit', `<b>${s.held.count.toLocaleString()}</b> control point${s.held.count > 1 ? 's' : ''} at the dose floor or cap still miss${s.held.count > 1 ? '' : 'es'} the target (worst ${pct(s.held.worst)}, at (${(s.held.at[0] / 1000).toFixed(3)}, ${(s.held.at[1] / 1000).toFixed(3)}) µm): the objects around ${s.held.count > 1 ? 'them' : 'it'} deliver more (or less) than the target whatever ${s.held.count > 1 ? 'their' : 'its'} own dose — overlapping objects or shapes stacked on several layers. The other control points are within <b>${pct(s.held.othersWorst)}</b>.`) : ''}
      ${s.fit === 'contour' && r.params?.range !== 'long'
        ? row(`Outline after rounding to ${r.classes.length} dose classes`, `within ${pct(s.outlineRms || 0)} rms of its target, worst ${pct(s.outlineWorst || 0)}`)
        : row(`Worst error after rounding to ${r.classes.length} dose classes`, Object.entries(s.worst).map(([k, v]) => `${esc(k)} ${pct(v)}`).join(' · '))}
      ${row('Writing doses', `${s.doseRange[0].toFixed(1)} – ${s.doseRange[1].toFixed(1)} µC/cm²${s.capped ? ` · <span style="color:#b45309">${s.capped} at the max factor</span>` : ''}`)}</div>`;
    shotInfo(r);
  }
  // shots and writing time per written layer: Σ area / step² and Σ dose · area / current, with each layer's
  // own beam step and current (Pattern Studio, layers panel; defaults 5 nm, 2 nA); arrays count cols × rows
  function shotInfo(r) {
    if (!r) { $('exShInfo').textContent = ''; return; }
    const lib = r.library, layers = app.project.library.layers || lib.layers || [];
    const cellSum = new Map();
    const add = (m, key, a, q) => { const e = m.get(key) || [0, 0]; e[0] += a; e[1] += q; m.set(key, e); };
    const sumCell = (name) => { if (cellSum.has(name)) return cellSum.get(name); const m = new Map(); const c = lib.cells[name];
      for (const sh of c.shapes) { const A = Math.abs(sh.pts.reduce((acc, p, i) => { const n = sh.pts[(i + 1) % sh.pts.length]; return acc + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2; add(m, sh.layer, A, A * (sh.writeDose ?? sh.dose ?? 0)); }
      for (const rf of c.refs) { const k = (rf.cols || 1) * (rf.rows || 1) * (rf.mag || 1) ** 2, d = rf.doseScale ?? 1; for (const [key, [a, q]] of sumCell(rf.cell)) add(m, key, k * a, k * d * q); }
      cellSum.set(name, m); return m; };
    const fmtT = (s) => (s < 120 ? `${s.toFixed(1)} s` : s < 7200 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(2)} h`);
    let shotsAll = 0, secAll = 0;
    const lines = [];
    for (const [key, [area, charge]] of sumCell(lib.top)) {
      const l = layers.find((o) => o.key === key) || {};
      if (l.purpose === 'marker' || l.purpose === 'device' || !(area > 0)) continue;
      const step = l.step ?? 5, I = (l.current ?? 2) * 1e-9;
      const shots = area / (step * step), seconds = (charge * 1e-6 * 1e-14) / I;   // µC/cm² × nm² → C
      shotsAll += shots; secAll += seconds;
      lines.push(`${esc(l.name || key)} (${esc(key)}): ${shots.toExponential(2)} shots on a ${step} nm step at ${(I * 1e9).toFixed(2)} nA, ≈ ${fmtT(seconds)}, mean dwell ${((seconds / Math.max(1, shots)) * 1e9).toFixed(0)} ns`);
    }
    $('exShInfo').innerHTML = `Exposure time ≈ <b>${fmtT(secAll)}</b>, ${shotsAll.toExponential(2)} shots (beam on; no settling or stage moves)<br>${lines.join('<br>')}<br><span style="color:var(--muted,#666)">Beam step and current are set per layer in Pattern Studio (layers panel).</span>`;
  }
  $('exFrRun').onclick = async () => {
    ensureProject();
    if ($('exFrScope').value === 'high' && $('exPcMethod').value !== 'fracQuick') { const hp = highParts(); if (!hp.layers.length && !hp.zones.length) { regionLabel(); toast('Nothing is marked high resolution: set a layer to high resolution in Pattern Studio, or draw a zone on the High-resolution PEC zones layer.'); return; } }
    if ($('exFrScope').value === 'region' && !normRegion()) { regionLabel(); toast('Pick a region first: press Pick region and drag a rectangle on the map.'); return; }
    $('exFrRun').disabled = true; $('exFrApply').disabled = true; $('exFrTable').innerHTML = '';
    $('exFrStatus').textContent = '';
    // the bar: the core sends an overall fraction; the clock ticks here so a long silent stretch
    // (one big raster, one big tile) never looks like a hang
    const prog = { frac: 0, t0: performance.now(), label: 'Fracturing…' };
    const fmtT = (s) => (s < 60 ? `${s.toFixed(0)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
    const paint = () => {
      const el = (performance.now() - prog.t0) / 1000;
      $('exFrProgFill').style.width = `${(100 * prog.frac).toFixed(1)}%`;
      $('exFrProgStage').textContent = prog.label;
      const left = prog.frac > 0.08 && el > 2 ? Math.max(0, el * (1 - prog.frac) / prog.frac) : null;
      $('exFrProgTime').textContent = `${Math.round(100 * prog.frac)} % · ${fmtT(el)}${left != null ? ` · about ${fmtT(left)} left` : ''}`;
    };
    $('exFrProg').hidden = false; $('exFrCancel').hidden = false; paint();
    const clock = setInterval(paint, 250);
    const pct2 = (v) => `${(100 * v).toFixed(v < 0.01 ? 2 : 1)} %`;
    try {
      const r = await client.request('fracture', { opts: fracOpts() }, (p) => {
        if (p.frac == null) return;
        prog.frac = p.frac;
        prog.label = p.quick ? 'Quick long-range doses for the rest of the layout' : p.stage === 'fracture' ? (p.objectsTotal ? `Fracturing: ${p.objects.toLocaleString()} of ${p.objectsTotal.toLocaleString()} objects` : p.fragments ? `${p.fragments.toLocaleString()} fragments` : 'Fracturing…')
          : p.stage === 'sr' ? `Short range: ${Math.round(100 * p.stageFrac)} % of ${p.points.toLocaleString()} fragments integrated`
          : p.stage === 'lr' ? 'Long range: gathering the backscatter grid'
          : p.stage === 'solve' ? `Solving: iteration ${p.iteration} of at most ${p.maxIter}, worst error ${pct2(p.maxError)} (stops at ${pct2(p.tol)})`
          : 'Rounding to dose classes';
        paint();
      });
      clearInterval(clock); prog.frac = 1; prog.label = 'Done'; paint();
      setTimeout(() => { $('exFrProg').hidden = true; }, 1500);
      r.library = unpackCells(r.library);              // the worker sends large cells packed
      st.frac = r;
      showFrac(r);
      $('exFrApply').disabled = false;
      if (!+$('exFrShow').value) { $('exFrShow').value = 70; $('exFrShowV').textContent = '70 %'; }
      if (r.stats.region) $('exFrScope').value = 'region';
      if (r.stats.high) $('exFrScope').value = 'high';
      render();
      $('exFrStatus').innerHTML = `Done. The fragment outlines are on the map (slider below). Press <b>Use as writing data</b> to expose with it (maps, 3D, Fab Studio).`;
    } catch (e) { clearInterval(clock); $('exFrProg').hidden = true; $('exFrStatus').innerHTML = e.message === 'Cancelled' ? 'Cancelled. Nothing was changed.' : `<span style="color:#c00">${esc(e.message)}</span>`; }
    $('exFrRun').disabled = false; $('exFrCancel').hidden = true;
  };
  $('exFrCancel').onclick = () => client.cancel?.();
  $('exFrApply').onclick = () => {
    if (!st.frac) return;
    app.project.writing = { ...st.frac, active: true, stale: null, controls: undefined };
    st.frac = null; $('exFrApply').disabled = true;
    app.writingChanged(); show(); fracStatus();
    sync3DControls(); follow3DSource();
    toast('Fractured writing data in use: the maps, the 3D view (Correction / Corrected → Fractured) and Fab Studio expose with it.', 5000);
  };
  $('exFrClear').onclick = () => { st.frac = null; if (app.project.writing) { app.project.writing = null; app.writingChanged(); show(); } fracStatus(); };
  $('exFrShow').oninput = () => { $('exFrShowV').textContent = +$('exFrShow').value ? $('exFrShow').value + ' %' : 'off'; render(); };
  $('exFrExport').onclick = () => {
    const w = st.frac || app.project.writing;
    if (!w) { toast('Run the fractured correction first.'); return; }
    const L = w.library, cells = {};
    for (const [name, c] of Object.entries(L.cells)) cells[name] = { shapes: c.shapes.map((s) => ({ class: s.doseClass, dose: +(s.writeDose ?? s.dose).toFixed(3), layer: s.layer, pts: s.pts.map(([x, y]) => [+(x + s.cx).toFixed(2), +(y + s.cy).toFixed(2)]) })), refs: c.refs.map((r) => ({ cell: r.cell, x: r.x, y: r.y, rot: r.rot, mag: r.mag, mirrorX: r.mirrorX, cols: r.cols, rows: r.rows, colStep: r.colStep, rowStep: r.rowStep, doseScale: r.doseScale ?? 1 })) };
    download('writing-data.ebw-writing.json', JSON.stringify({ format: 'ebl-workbench-writing', version: 1, units: { length: 'nm', dose: 'µC/cm²' }, top: L.top, doseClasses: w.classes, params: w.params, stats: w.stats, cells }));
    toast('Writing data exported: fragments (nm) with dose classes, hierarchy kept (cells + arrays). Export GDS… writes each dose class as a GDS datatype.', 6000);
  };
  // fragment outlines over the map, coloured by dose class
  function drawFragments(ctx) {
    const w = st.frac || app.project.writing;
    const alpha = +$('exFrShow').value / 100;
    if (!alpha || !w) return;
    const lib = w.library, roi = { x1: st.view.ox, y1: st.view.oy - st.H * st.view.s, x2: st.view.ox + st.W * st.view.s, y2: st.view.oy };
    const cm = cmapFn('turbo'), N = Math.max(1, w.classes.length - 1);
    let count = 0;
    ctx.save(); ctx.lineWidth = 1 + alpha;
    forEachCellInstance(lib, lib.top, roi, (name, T) => {
      if (count > 40000) return;
      for (const s of lib.cells[name].shapes) {
        if (++count > 40000) break;
        const c = cm((s.doseClass ?? 0) / N);
        ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
        ctx.beginPath();
        s.pts.forEach(([x, y], k) => { const [wx, wy] = apply(T, x + s.cx, y + s.cy), p = w2s(wx, wy); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.closePath(); ctx.stroke();
      }
    });
    ctx.restore();
    if (count > 40000) {
      const t = 'more than 40 000 fragments in view — zoom in to see them all';
      ctx.font = '12px system-ui'; const w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(8, 8, w + 12, 20);
      ctx.fillStyle = '#b45309'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, 14, 18);
    }
  }

  function showPc(r) {
    st.pc = r;
    $('exApply').disabled = false;
    const touching = r.controls.filter((c) => c.touching).length;
    $('exPcStatus').innerHTML = `${r.converged ? 'Converged' : '<b>Not converged</b>'} in ${r.iterations} iterations (${(r.ms / 1000).toFixed(1)} s). Every edge now gets ${r.converged ? '½ of its target' : 'close to ½ of its target'} — press <b>Apply</b> to write these doses.`
      + (touching ? `<br><span style="color:#b45309"><b>${touching} object${touching > 1 ? 's touch' : ' touches'} or overlap${touching > 1 ? '' : 's'} another</b> (e.g. a lead joining an electrode): their dose is set at a free edge. Better: select the touching shapes and <b>Fuse</b> them in Pattern Studio — one object, one dose, one outline.</span>` : '');
    const rows = [...r.controls].sort((a, b) => b.write / b.target - a.write / a.target);
    $('exPcTable').innerHTML = `<table class="keytab" style="font-size:12px;"><tr><td><b>object</b></td><td><b>target</b></td><td><b>write</b></td><td><b>×</b></td></tr>`
      + rows.slice(0, 60).map((c) => `<tr><td>${esc(c.cell)}${c.members > 1 ? ' (fused)' : ''}${c.touching ? ' <span style="color:#b45309">(touches)</span>' : ''} @ ${(c.x / 1000).toFixed(1)}, ${(c.y / 1000).toFixed(1)}</td><td>${c.target.toFixed(0)}</td><td>${c.write.toFixed(1)}</td><td>${(c.write / c.target).toFixed(2)}</td></tr>`).join('')
      + `</table>${rows.length > 60 ? `<div class="hint">… and ${rows.length - 60} more</div>` : ''}`;
  }
  $('exApply').onclick = () => {
    if (!st.pc) return;
    const n = app.applyCorrection(new Map(st.pc.doses));
    toast(`Correction applied to ${n} shapes (undo in Pattern Studio). The map now shows the corrected delivered dose; the grey dashed profile is without correction.`, 5000);
    $('exApply').disabled = true;
    $('exPcStatus').innerHTML = `Applied to ${n} shapes. Run the correction again after changing the layout or the PSF.`;
    show();                                   // the layout changed: map and profile now
  };
  $('exClear').onclick = () => {
    const n = app.clearCorrection(); toast(n ? `Cleared the writing doses of ${n} shapes.` : 'No shape carries a correction.');
    if (n) { st.pc = null; $('exApply').disabled = true; $('exPcStatus').textContent = ''; $('exPcTable').innerHTML = ''; show(); }
  };

  function showWiener(r) {
    st.wiener = r; st.wienerStale = false;
    for (const o of $('exField').options) if (o.value.startsWith('wiener')) o.disabled = false;
    $('exWStatus').innerHTML = `Done (${r.ms.toFixed(0)} ms). The exact solution needs <b>negative dose on ${(100 * r.negativeFraction).toFixed(1)} %</b> of the raster (set to 0) and hits the maximum on ${(100 * r.clippedFraction).toFixed(1)} % — pick <i>Ideal …</i> under Map shows.`;
  }
  $('exWiener').onclick = async () => {
    ensureProject();
    const n = +$('exWN').value, s = (st.W * st.view.s) / n, ny = Math.max(8, Math.round((st.H * st.view.s) / s));
    const grid = { x0: st.view.ox, y0: st.view.oy - ny * s, dx: s, nx: n, ny };
    $('exWStatus').textContent = 'computing…';
    try {
      const r = await client.request('wiener', { grid, opts: { lambda: Math.max(0, parseFloat($('exLambda').value) || 0), edge: 'pad2', maxDose: parseFloat($('exWMax').value) || 1000 } });
      showWiener(r);
      $('ex3Src').value = 'raster'; sync3DControls(); viewChanged3D();
      requestProfile(0);
    } catch (e) { $('exWStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; }
  };

  // ---------------------------------------------------------------- 3D
  // The 3D ceiling is the 3D panel's own (Ceiling + auto), separate from the map's Max: a fixed
  // value when auto is off (dose fields only; the developed and factor fields keep their own
  // scales), the data maximum when auto is on.
  const auto3D = () => $('ex3Auto').checked;
  const max3D = () => Math.max(1e-6, parseFloat($('ex3Max').value) || 200);
  const ceiling3D = (field, dataMax) => (field === 'developed' || field === 'factor' || auto3D() ? dataMax || 1 : max3D());
  function maxTo3D() {
    $('ex3Max').disabled = auto3D();
    if (!st.surface || !st.surface3Field) return;
    st.surface.setOptions({ max: ceiling3D(st.surface3Field, st.surface3Max) }); st.surface.draw();
    const note = document.getElementById('ex3ScaleNote');
    if (note) note.innerHTML = scaleNote3D(st.surface3Field, st.surface3Max);
    st.surfaceCut = cutLamp('ex3CutLamp', st.surface3Data, ceiling3D(st.surface3Field, st.surface3Max));
  }
  $('ex3CutLamp').onclick = () => { $('ex3Auto').checked = true; maxTo3D(); };
  $('exCutLamp').onclick = () => { $('exAuto').checked = true; $('exAuto').dispatchEvent(new Event('change')); };
  $('ex3Max').oninput = maxTo3D;
  $('ex3Auto').onchange = maxTo3D;
  function set3D(on, compute) {
    st.show3D = on;
    $('ex3DPanel').style.display = st.show3D ? '' : 'none';
    if (st.show3D) {
      if (!st.surface) {
        try { st.surface = createSurface($('ex3Canvas')); } catch (e) { st.surface = null; $('ex3Status').textContent = 'WebGL error: ' + e.message; }
        if (!st.surface) { $('ex3Status').textContent = 'This browser has no WebGL2 — the 3D view is unavailable.'; return; }
        st.ov3 = staleOverlay($('ex3Canvas').parentElement, () => request3D());
        const opts = [...$('ex3Res').options];
        opts.forEach((o) => { if (+o.value > st.surface.maxTex) o.disabled = true; });
      }
      if (compute) request3D(); else { sync3DControls(); st.ov3?.show('Press ↻ or Update now to compute the surface for the map view'); }
    }
  }
  for (const id of ['ex3Field', 'ex3Res', 'ex3Src', 'ex3DevFrom']) $(id).onchange = () => { sync3DControls(); viewChanged3D(); };
  $('ex3Resist').onchange = () => { fillResist(); viewChanged3D(); };
  for (const id of ['ex3Thick', 'ex3DevT', 'ex3Gamma', 'ex3Soft', 'ex3D100', 'ex3Scale']) $(id).oninput = () => viewChanged3D();
  $('ex3H').oninput = (e) => { st.surface?.setOptions({ scale: +e.target.value }); st.surface?.draw(); };
  $('ex3Contour').onchange = (e) => { st.surface?.setOptions({ contour: e.target.checked ? 0.1 : 0 }); st.surface?.draw(); };
  $('ex3Target').onchange = (e) => { st.surface?.setOptions({ target: e.target.checked }); st.surface?.draw(); };
  $('ex3Reset').onclick = () => { st.surface?.resetCamera(); st.surface?.draw(); };
  $('ex3Cmap').onchange = (e) => { st.surface?.setOptions({ cmap: e.target.value }); st.surface?.draw(); };
  $('ex3Update').onclick = () => request3D();
  $('ex3Follow').onchange = (e) => { if (e.target.checked && st.surface && st.view3Key !== viewKey()) request3D(); else mark3D(); };
  // ---- what the surface shows (Peter: As map above / Designed / Delivered / Corrected / Correction / Developed)
  const hasApplied = () => Object.values(app.project.library.cells).some((c) => c.shapes.some((s) => s.writeDose != null));
  function corrSource() {
    const v = $('ex3Src').value;
    const frac = !!app.project.writing?.active;
    if (v === 'raster' && st.wiener) return 'raster';
    if (v === 'frac' && frac) return 'frac';
    if (v === 'shape' && hasApplied()) return 'shape';
    return frac ? 'frac' : hasApplied() ? 'shape' : st.wiener ? 'raster' : null;
  }
  // → { field: a map field for fieldOnGrid, label, developed?: true }
  function resolve3D() {
    const f = $('ex3Field').value, src = corrSource();
    const need = () => { throw new Error('No correction yet: Run correction → Apply (per-shape), or Compute the raster correction (left).'); };
    const delivered = () => ({ field: 'uncorrected', label: 'Delivered (no correction)' });
    const corrected = () => (src === 'shape' ? { field: 'delivered@design', label: 'Corrected — delivered with the per-shape doses' } : src === 'frac' ? { field: 'delivered', label: 'Corrected — delivered with the fractured writing data' } : src === 'raster' ? { field: 'wiener_delivered', label: 'Corrected — delivered with the raster (Wiener) doses' } : need());
    switch (f) {
      case 'map': return { field: st.field, label: FIELD_LABEL[st.field] };
      case 'designed': return { field: 'designed', label: 'Designed' };
      case 'delivered': return delivered();
      case 'corrected': return corrected();
      case 'correction': return src === 'shape' ? { field: 'write@design', label: 'Correction — per-shape writing dose' } : src === 'frac' ? { field: 'write', label: 'Correction — fractured writing dose (fragments, dose classes)' } : src === 'raster' ? { field: 'wiener_write', label: 'Correction — raster (Wiener) writing dose' } : need();
      case 'developed': { const b = $('ex3DevFrom').value === 'corrected' ? corrected() : delivered(); return { ...b, developed: true, label: `Developed ${$('ex3Resist').value}, from ${b.label.split(' —')[0].toLowerCase()}` }; }
      default: return { field: f, label: FIELD_LABEL[f] || f };
    }
  }
  function sync3DControls() {
    const f = $('ex3Field').value, dev = f === 'developed';
    $('ex3SrcBox').style.display = f === 'corrected' || f === 'correction' || (dev && $('ex3DevFrom').value === 'corrected') ? '' : 'none';
    $('ex3DevBox').style.display = dev ? 'flex' : 'none';
    const r = $('ex3Src'); r.options[2].disabled = !st.wiener; r.options[1].disabled = !app.project.writing?.active; r.options[0].disabled = !hasApplied();
  }
  function fillResist() {
    const p = RESIST_PRESETS[$('ex3Resist').value]; if (!p) return;
    $('ex3Gamma').value = p.contrast; $('ex3Soft').value = Math.round(100 * (p.soft ?? 1)); $('ex3D100').value = p.D100;
    $('ex3Scale').value = +(p.D100 / (0.5 * (app.nominalDose?.() ?? 100))).toPrecision(2);
  }
  // remaining resist (nm) for a field of relative doses
  function developField(doses) {
    const p = RESIST_PRESETS[$('ex3Resist').value] || {}, T = Math.max(1, parseFloat($('ex3Thick').value) || 100);
    const r = makeResist({ D100: Math.max(1, parseFloat($('ex3D100').value) || p.D100 || 120), gamma: Math.max(0.5, parseFloat($('ex3Gamma').value) || p.contrast || 3), round: Math.max(0, parseFloat($('ex3Soft').value) || 0) / 100, tone: p.type || 'positive', scumNm: p.scum || 0, thicknessNm: T });
    const k = Math.max(0, parseFloat($('ex3Scale').value) || 1), dark = Math.max(0, (p.darkErosion || 0) * (Math.max(1, parseFloat($('ex3DevT').value) || 60) / 60));
    const out = new Float32Array(doses.length);
    let cleared = 0;
    for (let i = 0; i < doses.length; i++) {
      const t = remainingFraction(r, Math.max(1e-9, doses[i] * k));
      const left = t < 1 ? T * t : Math.max(0, T - dark);          // dark erosion only where nothing developed (as Fab Studio)
      out[i] = left; if (left < 0.05 * T) cleared++;
    }
    return { data: out, T, cleared: cleared / doses.length, r, k };
  }
  fillResist(); sync3DControls();
  // what the surface shows vs what the map shows: the surface covers the map's view
  const viewKey = () => [st.view.ox.toFixed(3), st.view.oy.toFixed(3), st.view.s.toPrecision(6), st.W, st.H, $('ex3Field').value === 'map' ? st.field : $('ex3Field').value, $('ex3Src').value, $('ex3Res').value,
    ...($('ex3Field').value === 'developed' ? ['ex3Resist', 'ex3Thick', 'ex3DevT', 'ex3Gamma', 'ex3Soft', 'ex3D100', 'ex3Scale', 'ex3DevFrom'].map((id) => $(id).value) : []), !!st.wiener, app.version].join('|');
  let t3timer = null;
  function viewChanged3D() {
    if (!st.show3D || !st.surface) return;
    const k = viewKey(); if (k === st.view3Key || k === st.view3Pending) return;
    if ($('ex3Follow').checked) { clearTimeout(t3timer); $('ex3Status').innerHTML = '<b>Updating</b> to the map view…'; t3timer = setTimeout(request3D, 450); }
    else mark3D();
  }
  function mark3D() {
    if (!st.show3D || !st.surface || !st.view3Key) return;
    const stale = st.view3Key !== viewKey();
    $('ex3Update').classList.toggle('primary', stale);
    // the old surface stays, greyed, with ↻ in the middle: nothing is recomputed until asked (Peter)
    if (stale && !$('ex3Follow').checked) {
      const why = st.view3Key.split('|').at(-1) !== String(app.version) ? 'The layout or PSF changed' : 'The map view or the settings changed';
      $('ex3Status').innerHTML = `<span style="color:#b45309"><b>Out of date</b> — still showing ${st.view3Desc}.</span>`;
      st.ov3?.show(`${why} — ↻ to recalculate`);
    } else if (!stale) st.ov3?.hide();
  }
  // what the 3D status line says about the scale, and when the clearing plane cannot show
  function scaleNote3D(field, dataMax) {
    const m = ceiling3D(field, dataMax), c = DELIVERED_LIKE.has(field) ? clearOpts().clear : 0;
    let t = field === 'developed' || field === 'factor' || auto3D() ? '' : ` · <span style="color:#b45309">cut flat at the ceiling ${+m.toPrecision(3)}</span> (tick auto for the data maximum)`;
    if (c > 0 && !(c < m)) t += ` · <span style="color:#b45309">the clearing level ${+c.toPrecision(3)} is above the ceiling ${+m.toPrecision(3)}, so the red plane is not drawn</span>`;
    return t;
  }
  function clearOpts() {
    const pct = Math.max(0, parseFloat($('ex3Clear').value) || 0), nom = app.nominalDose?.() ?? 100, d = (pct / 100) * nom;
    return { clear: d, clearLabel: pct ? `clearing ${+d.toPrecision(3)} (${pct} % of nominal)` : '' };
  }
  // the clearing level compares with what the resist receives, not with writing doses or factors
  const DELIVERED_LIKE = new Set(['delivered', 'delivered@design', 'uncorrected', 'wiener_delivered', 'longrange']);
  $('ex3Clear').oninput = () => { st.surface?.setOptions(DELIVERED_LIKE.has(st.surface3Field) ? clearOpts() : { clear: 0 }); st.surface?.draw(); };
  let t3 = 0;
  async function request3D() {
    if (!st.surface) return;
    ensureProject();
    sync3DControls();
    let what;
    try { what = resolve3D(); } catch (e) { $('ex3Status').innerHTML = `<span style="color:#b45309">${esc(e.message)}</span>`; st.ov3?.show(e.message); return; }
    const field = what.field;
    const n = Math.min(+$('ex3Res').value, st.surface.maxTex);
    const s = (st.W * st.view.s) / n, ny = Math.max(8, Math.min(st.surface.maxTex, Math.round((st.H * st.view.s) / s)));
    const grid = { x0: st.view.ox, y0: st.view.oy - ny * s, dx: s, nx: n, ny };
    const ticket = ++t3, key = viewKey(); st.view3Pending = key; clearTimeout(t3timer);
    $('ex3Status').innerHTML = `<b>Computing</b> ${n} × ${ny} points for the map view…`;
    st.ov3?.busy(`Computing ${n} × ${ny}…`);
    const t0 = performance.now();
    try {
      const isFactor = field === 'factor', dev = !!what.developed;
      const [raw, target] = await Promise.all([fieldOnGrid(field, grid), isFactor || dev ? null : client.request('raster', { grid, field: 'designed' })]);
      if (ticket !== t3) return;
      let mainData = raw, devInfo = null;
      if (dev) { devInfo = developField(raw); mainData = devInfo.data; }
      let M = 0; for (const v of mainData) if (v > M) M = v; if (target) for (const v of target.data) if (v > M) M = v;
      if (dev) M = devInfo.T;
      st.surface.setField(mainData, n, ny); st.surface3Data = mainData;
      st.surface.setTarget(target ? target.data : null, n, ny);
      $('ex3DevHint').innerHTML = dev ? `${(100 * devInfo.cleared).toFixed(1)} % of the view cleared to the substrate · D₀ ${devInfo.r.D0.toFixed(0)}, D₁₀₀ ${devInfo.r.D100.toFixed(0)} µC/cm² · relative dose × ${devInfo.k}` : '';
      st.surface3Max = M || 1;
      st.surface.setOptions({ max: ceiling3D(dev ? 'developed' : field, M), cmap: $('ex3Cmap').value, scale: +$('ex3H').value, contour: $('ex3Contour').checked ? 0.1 : 0, target: $('ex3Target').checked, extent: [n * s, ny * s], ...clearOpts(), unit: dev ? 'nm of resist left' : isFactor ? '× target' : 'µC/cm²', ...(DELIVERED_LIKE.has(field) && !dev ? {} : { clear: 0 }), ...(dev ? { target: false } : {}) });
      st.surface3Field = dev ? 'developed' : field;
      st.surfaceCut = cutLamp('ex3CutLamp', mainData, ceiling3D(st.surface3Field, M));
      st.surface.draw();
      const um3 = (nm) => (Math.abs(nm) >= 1000 ? `${(nm / 1000).toFixed(2)} µm` : `${nm.toFixed(0)} nm`);
      st.view3Key = key; st.view3Pending = null;
      st.view3Desc = `${um3(n * s)} × ${um3(ny * s)} from (${um3(grid.x0)}, ${um3(grid.y0)})`;
      $('ex3Update').classList.remove('primary'); st.ov3?.hide();
      $('ex3Status').innerHTML = `<span style="color:#15803d">✓</span> ${esc(what.label)} over the map view, ${st.view3Desc} · ${n} × ${ny} points · ${((performance.now() - t0) / 1000).toFixed(1)} s · updated ${new Date().toLocaleTimeString()}${$('ex3Follow').checked ? ' · follows the map' : ''}<span id="ex3ScaleNote">${scaleNote3D(dev ? 'developed' : field, M)}</span>`;
    } catch (e) { st.view3Pending = null; $('ex3Status').textContent = e.message; st.ov3?.show(e.message); }
  }

  // ---------------------------------------------------------------- lifecycle
  async function refreshInfo() {
    try {
      const vr = { x1: st.view.ox, y1: st.view.oy - st.H * st.view.s, x2: st.view.ox + st.W * st.view.s, y2: st.view.oy };
      const r = await client.request('info', { roi: vr });
      $('exPsf').innerHTML = `${esc(r.label)}<br>short range exact up to ${(r.rMaxSR / 1000).toFixed(2)} µm (weight ${r.srWeight.toFixed(3)}); long range on ${r.gridN[0]} × ${r.gridN[1]} cells of ${(r.h / 1000).toFixed(2)} µm`;
    } catch (e) { $('exPsf').textContent = e.message; }
  }
  function show() {
    resize();
    if (!st.view) { const v = app.editorView(); st.view = { s: v.s, ox: v.ox, oy: v.oy }; }
    if (!st.show3D) set3D(true, false);       // always present; computes only on Update / ↻
    if (!st.line) defaultLine();
    fracStatus();
    if (st.version !== app.version) {
      st.version = app.version;
      if (st.wiener && !st.wienerStale) { st.wienerStale = true; $('exWStatus').innerHTML += ' <span class="pill">stale — recompute</span>'; }
      if (st.pc && !st.pcFromFile) {          // a correction for an older layout/PSF must not be applied
        st.pc = null; $('exApply').disabled = true; $('exPcTable').innerHTML = '';
        if (!/^Applied/.test($('exPcStatus').textContent)) $('exPcStatus').innerHTML = 'The layout or PSF changed — run the correction again.';
      }
      st.pcFromFile = false;                  // a correction loaded with its own layout is valid once
      ensureProject(); requestHeat(0); requestProfile(0); refreshInfo();
      if (st.show3D) viewChanged3D();
    }
    render();
  }
  window.addEventListener('resize', () => { if (app.isTabActive('exposure') && resize()) { render(); requestHeat(100); } });

  // ---------------------------------------------------------------- session (saved with the project)
  const S3 = ['ex3Field', 'ex3Src', 'ex3Res', 'ex3H', 'ex3Contour', 'ex3Target', 'ex3Clear', 'ex3Max', 'ex3Auto', 'ex3Cmap', 'ex3Follow', 'ex3Resist', 'ex3Thick', 'ex3DevT', 'ex3Gamma', 'ex3D100', 'ex3Scale', 'ex3DevFrom', 'ex3Soft', 'exLambda', 'exWN', 'exWMax', 'exFrW', 'exFrSeg', 'exFrCorner', 'exFrTile', 'exFrMax', 'exFrClasses', 'exFrCornerFrac', 'exFrCorners', 'exFrInterior', 'exFrMin', 'exPcMethod', 'exFrFit', 'exFrAcc', 'exFrScope'];
  const val = (id) => { const e = $(id); return e.type === 'checkbox' ? e.checked : e.value; };
  // full = false (autosave): large rasters only while they stay small
  function getSession(full = true) {
    const w = st.wiener;
    const wBytes = w ? w.write.length * 8 : 0;
    return {
      view: st.view ? { ...st.view } : null, field: st.field, cmap: st.cmap, max: st.max, auto: st.auto, step: st.step,
      line: st.line ? { a: [...st.line.a], b: [...st.line.b] } : null,
      pc: st.pc ? { doses: st.pc.doses, controls: st.pc.controls, iterations: st.pc.iterations, converged: st.pc.converged, ms: st.pc.ms } : null,
      wiener: w && (full || wBytes < 1.2e6) ? { grid: w.grid, write: f32ToB64(w.write), delivered: f32ToB64(w.delivered), negativeFraction: w.negativeFraction, clippedFraction: w.clippedFraction, ms: w.ms } : null,
      show3D: st.show3D, controls: Object.fromEntries(S3.map((id) => [id, val(id)])),
      region: st.region ? { ...st.region } : null,
    };
  }
  function setSession(o) {
    if (!o) return;
    if (o.view) st.view = { ...o.view };
    if (o.line) st.line = { a: [...o.line.a], b: [...o.line.b] };
    for (const [k, id] of [['field', 'exField'], ['cmap', 'exCmap'], ['max', 'exMax'], ['step', 'exStep']]) if (o[k] != null) { st[k] = k === 'max' || k === 'step' ? +o[k] : o[k]; $(id).value = o[k]; }
    if (o.auto != null) { st.auto = !!o.auto; $('exAuto').checked = st.auto; }
    for (const [id, v] of Object.entries(o.controls || {})) { const e = $(id); if (!e) continue; if (e.type === 'checkbox') e.checked = !!v; else e.value = v; }
    $('ex3Max').disabled = $('ex3Auto').checked;
    if (o.region) st.region = { ...o.region };
    syncMethod(); regionLabel();
    if (o.wiener && o.wiener.write) showWiener({ ...o.wiener, write: b64ToF32(o.wiener.write), delivered: b64ToF32(o.wiener.delivered) });
    if (st.field.startsWith('wiener_') && !st.wiener) { st.field = 'delivered'; $('exField').value = 'delivered'; }
    if (o.pc && o.pc.controls) { showPc(o.pc); st.pcFromFile = true; }
    st.version = -1;                                 // recompute map and profile when shown
    if (o.show3D) set3D(true, false);
  }

  // a new layout (new project, demo, an import): the region belonged to the old one
  function reset() { st.region = null; st.pickRegion = false; $('exFrPick').classList.remove('active'); canvas.style.cursor = 'grab'; regionLabel(); }
  return { show, reset, client, state: st, getSession, setSession, _test: { computeHeat, computeProfile, request3D, s2w, w2s, draw } };
}
