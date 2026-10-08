// Layout tab: the Pattern Studio editor, ported onto the hierarchical model
//. Interaction rules are PPS's: the tool only decides what a drag on empty
// space does; selecting is decided on release; Shift adds; right-drag is a marquee.
//
// World units are nm with y up. The view maps world → screen as
//   sx = (x − ox)/s,  sy = (oy − y)/s        (s = nm per CSS pixel, (ox, oy) = world at top-left)

import {
  makeRect, makeCircle, makePoly, cloneShape, groupKeyOf, isCorrected, toLocal, toWorld,
  signedDistance, inside, outlineWorld, handlesLocal, bboxLocal, bboxWorld, describe, roundToDbu, rdp, uid,
} from '../../core/geom/shapes.js';
import {
  cellBBox, refBBox, visibleRange, elementTransform, hitRef, flatStats, makeArrayCell, explodeRef,
  placeCell, renameCell, deleteCell, makeCell, uniqueCellName, parentsOf, cloneLibrary, refLinear,
  DEVICE_LAYER, isExposedPurpose, deviceAreas, references,
} from '../../core/geom/library.js';
import { compose, invert, apply, applyBBox, scaleOf, unionBBox, IDENTITY } from '../../core/geom/transform.js';
import { $, esc, openMenu, closeMenu, openModal, numField, readNum, toast, modalOpen } from '../dom.js';
import { makeRampArray, updateRampArray, rampGroupRefs, rampLabel, describeRamp } from '../../core/geom/ramp.js';

// Dose-ramp block of the array dialogs (one per axis).
function rampBlock(p, axisLabel, r, baseDose) {
  const on = !!r, v = r || { from: baseDose, to: baseDose * 4, unit: 'abs', mode: 'lin' };
  return `<div class="ramp-box"><label class="check"><input type="checkbox" id="${p}On" ${on ? 'checked' : ''}> <b>Dose ramp ${axisLabel}</b></label>
    <div class="ramp-fields" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:4px;">
      ${numField(p + 'From', 'From', v.from, 1, 'min="0"')}${numField(p + 'To', 'To', v.to, 1, 'min="0"')}
      <div><div class="label">Unit</div><select class="field" id="${p}Unit"><option value="abs"${v.unit === 'abs' ? ' selected' : ''}>µC/cm²</option><option value="factor"${v.unit === 'factor' ? ' selected' : ''}>× shape dose</option></select></div>
      <div><div class="label">Steps</div><select class="field" id="${p}Mode"><option value="lin"${v.mode === 'lin' ? ' selected' : ''}>linear</option><option value="log"${v.mode === 'log' ? ' selected' : ''}>logarithmic</option></select></div>
    </div></div>`;
}
function readRamp(box, p) {
  if (!box.querySelector('#' + p + 'On').checked) return null;
  return { from: readNum(box, p + 'From'), to: readNum(box, p + 'To'), unit: box.querySelector('#' + p + 'Unit').value, mode: box.querySelector('#' + p + 'Mode').value };
}
const RAMP_HINT = `<div class="hint" style="margin-top:6px;">A ramp gives each column (x, left → right) or row (y, top → bottom) its own dose: linear steps, or logarithmic (each step the same factor). Stored as one array per dose step — one dose class each, as the writer needs. With ramps along both axes, give one as a factor (×).</div>`;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const umTxt = (nm, d = 3) => (nm / 1000).toFixed(d);
const S_MIN = 0.005, S_MAX = 2e5;              // nm per pixel
import { buildShapeIndex, queryShapeIndex } from './shapeindex.js';
const ELEMENT_BUDGET = 25000;                  // cell instances drawn per frame before arrays turn into swatches

export function createLayoutEditor(app) {
  const canvas = $('layoutCanvas'), ctx = canvas.getContext('2d');
  const ed = {
    cell: app.project.library.top, cellStack: [], cellPick: null,
    s: 200, ox: 0, oy: 0, W: 800, H: 500, dpr: 1,
    tool: 'select', placeCell: null,
    selection: new Set(),
    draft: null, pendingPoly: null, marquee: null, drag: null, hover: null,
    nominalDose: 100, activeLayer: '1/0',
    gridUm: 1, gridMajor: 5, snap: false, fixed: false, fixedW: 1, fixedL: 1,
    undo: [], redo: [],
    version: 0, pathCache: new Map(), bboxCache: new Map(), statsCache: null,
    structVersion: 0, shapeIx: null, dirty: new Set(), dirtyIdx: null, labelCache: null, dirtyGen: 0, interactUntil: 0,
  };

  const lib = () => app.project.library;
  const cellObj = () => lib().cells[ed.cell];
  const shapes = () => cellObj().shapes;
  const refs = () => cellObj().refs;
  const layerOf = (key) => lib().layers.find((l) => l.key === key);
  const layerVisible = (key) => { const l = layerOf(key); return !l || l.visible; };
  const layerColor = (key) => (layerOf(key)?.color) || '#666';
  // device areas and high-resolution PEC zones: not exposed, drawn dashed, picked after the patterns
  const isDeviceLayer = (key) => { const p = layerOf(key)?.purpose; return p === 'device' || p === 'hres'; };
  const isZoneLayer = (key) => layerOf(key)?.purpose === 'hres';
  function layerVisibility() {
    const m = new Map(lib().layers.map((l) => [l.key, !!l.visible]));
    return (key) => { const v = m.get(key); return v === undefined ? true : v; };
  }
  function layerPurposeIs(p) {
    const m = new Map(lib().layers.map((l) => [l.key, l.purpose === p || (p === 'device' && l.purpose === 'hres')]));
    return (key) => !!m.get(key);
  }
  function ensureDeviceLayer() {
    if (!lib().layers.some((l) => l.purpose === 'device')) lib().layers.push({ key: DEVICE_LAYER, name: 'Device areas (Fab Studio)', color: '#c9a400', visible: true, purpose: 'device' });
    return lib().layers.find((l) => l.purpose === 'device').key;
  }

  // ---------------------------------------------------------------- change tracking
  function invalidateCaches(fast) {
    ed.version++; ed.pathCache.clear(); ed.bboxCache = new Map();
    if (fast) {
      // a drag moves the selection only: keep the index, test the moving shapes fresh, keep the
      // statistics (recomputed when the drag ends with a normal change)
      if (!ed.dirty.size && ed.selection.size) {
        const sh = shapes(), idx = [];
        for (let i = 0; i < sh.length; i++) if (ed.selection.has(sh[i].id)) { ed.dirty.add(sh[i].id); idx.push(i); }
        ed.dirtyIdx = Int32Array.from(idx);
        ed.dirtyGen++;
      }
      return;
    }
    ed.structVersion++; ed.dirty.clear(); ed.dirtyIdx = null; ed.statsCache = null; ed.labelCache = null;
  }
  function changed(reason, fast) {
    invalidateCaches(fast);
    updateSelectionUI();
    if (!fast) { updateCellList(); updateStatus(); }
    scheduleRender(fast);
    if (!fast) app.onChange(reason);
  }

  // ---------------------------------------------------------------- undo
  const snapshot = () => ({ lib: cloneLibrary(lib()), cell: ed.cell, sel: [...ed.selection] });
  function pushUndo() { ed.undo.push(snapshot()); if (ed.undo.length > 80) ed.undo.shift(); ed.redo.length = 0; updateUndoButtons(); }
  function restore(st) {
    app.project.library = cloneLibrary(st.lib);
    ed.cell = lib().cells[st.cell] ? st.cell : lib().top;
    const ids = new Set([...shapes().map((s) => s.id), ...refs().map((r) => r.id)]);
    ed.selection = new Set(st.sel.filter((id) => ids.has(id)));
    changed('undo/redo');
  }
  function doUndo() { if (!ed.undo.length) return; ed.redo.push(snapshot()); restore(ed.undo.pop()); updateUndoButtons(); }
  function doRedo() { if (!ed.redo.length) return; ed.undo.push(snapshot()); restore(ed.redo.pop()); updateUndoButtons(); }
  function dropLastUndo() { ed.undo.pop(); updateUndoButtons(); }
  function updateUndoButtons() { $('btnUndo').disabled = !ed.undo.length; $('btnRedo').disabled = !ed.redo.length; }

  // ---------------------------------------------------------------- view
  const s2w = (sx, sy) => ({ x: ed.ox + sx * ed.s, y: ed.oy - sy * ed.s });
  const w2s = (x, y) => ({ x: (x - ed.ox) / ed.s, y: (ed.oy - y) / ed.s });
  const viewRect = () => ({ x1: ed.ox, y1: ed.oy - ed.H * ed.s, x2: ed.ox + ed.W * ed.s, y2: ed.oy });
  const tolW = () => 7 * ed.s;
  const gridNm = () => ed.gridUm * 1000;
  const snapV = (v) => (ed.snap ? Math.round(v / gridNm()) * gridNm() : v);
  const snapPt = (p) => (ed.snap ? { x: snapV(p.x), y: snapV(p.y) } : p);

  // local→world transform T drawn with good float precision far from the origin
  function setWorldTransform(T) {
    const k = ed.dpr / ed.s;
    ctx.setTransform(k * T.a, -k * T.b, k * T.c, -k * T.d, k * (T.e - ed.ox), -k * (T.f - ed.oy));
  }
  const screenBBox = (bb) => {
    const a = w2s(bb.x1, bb.y2), b = w2s(bb.x2, bb.y1);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };

  function resize() {
    const wrap = $('canvasWrap');
    const w = Math.max(320, Math.floor(wrap.clientWidth - 2));
    const h = clamp(Math.floor(window.innerHeight - wrap.getBoundingClientRect().top - 60), 380, 1400);
    ed.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === ed.W && h === ed.H && canvas.width === Math.round(w * ed.dpr)) return;
    ed.W = w; ed.H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * ed.dpr); canvas.height = Math.round(h * ed.dpr);
    scheduleRender();
  }

  function setScale(s) { ed.s = clamp(s, S_MIN, S_MAX); $('mpp').value = +(ed.s / 1000).toPrecision(4); }
  function fitView() {
    const bb = cellBBox(lib(), ed.cell, ed.bboxCache);
    if (!bb) { resetView(); return; }
    const w = Math.max(bb.x2 - bb.x1, 100), h = Math.max(bb.y2 - bb.y1, 100), pad = 0.12;
    setScale(Math.max((w * (1 + 2 * pad)) / ed.W, (h * (1 + 2 * pad)) / ed.H));
    ed.ox = (bb.x1 + bb.x2) / 2 - (ed.W * ed.s) / 2;
    ed.oy = (bb.y1 + bb.y2) / 2 + (ed.H * ed.s) / 2;
    scheduleRender();
  }
  function resetView() { setScale(200); ed.ox = 0; ed.oy = 0; scheduleRender(); }

  // ---------------------------------------------------------------- selection helpers
  const selectedShapes = () => (ed.selection.size ? shapes().filter((s) => ed.selection.has(s.id)) : []);

  // ---------------------------------------------------------------- spatial index (shapeindex.js)
  function shapeIndex() {
    const sh = shapes(), ix = ed.shapeIx;
    if (ix && ix.shapes === sh && ix.n === sh.length && ix.version === ed.structVersion && ix.cell === ed.cell) return ix;
    ed.shapeIx = buildShapeIndex(sh, bboxWorld);
    ed.shapeIx.version = ed.structVersion; ed.shapeIx.cell = ed.cell;
    return ed.shapeIx;
  }
  // bounding box of shape i of the edited cell: cached unless it is being dragged
  function shapeBB(ix, i) {
    const s = ix.shapes[i];
    if (ed.dirty.size && ed.dirty.has(s.id)) return bboxWorld(s);
    const o = 4 * i, b = ix.bb;
    return { x1: b[o], y1: b[o + 1], x2: b[o + 2], y2: b[o + 3] };
  }
  // indices of the edited cell's shapes whose box meets the rectangle, in the cell's order
  function shapesIn(x1, y1, x2, y2) {
    const ix = shapeIndex();
    let idx = queryShapeIndex(ix, x1, y1, x2, y2);
    if (ed.dirty.size && ed.dirtyIdx) {
      const keep = [];
      for (const i of idx) if (!ed.dirty.has(ix.shapes[i].id)) keep.push(i);
      for (const i of ed.dirtyIdx) {
        if (i >= ix.n) continue;
        const b = bboxWorld(ix.shapes[i]);
        if (b.x2 >= x1 && b.x1 <= x2 && b.y2 >= y1 && b.y1 <= y2) keep.push(i);
      }
      idx = Int32Array.from(keep); idx.sort();
    }
    return idx;
  }
  // hit-test candidates near a world point, last drawn first (pick order)
  function shapesNear(w, tol) {
    const ix = shapeIndex(), idx = shapesIn(w.x - tol, w.y - tol, w.x + tol, w.y + tol), out = [];
    for (let q = idx.length - 1; q >= 0; q--) out.push(ix.shapes[idx[q]]);
    return out;
  }
  const selectedRefs = () => refs().filter((r) => ed.selection.has(r.id));
  const groupMembers = (s) => { const k = groupKeyOf(s); return shapes().filter((t) => groupKeyOf(t) === k); };
  function selectObj(hit, additive) {
    if (!hit) { if (!additive) ed.selection.clear(); updateSelectionUI(); return; }
    const ids = hit.type === 'shape' ? groupMembers(hit.s).map((t) => t.id) : hit.ref.ramp ? rampGroupRefs(cellObj(), hit.ref.ramp.group).map((r) => r.id) : [hit.ref.id];
    if (additive) {
      const on = ids.every((id) => ed.selection.has(id));
      ids.forEach((id) => (on ? ed.selection.delete(id) : ed.selection.add(id)));
    } else { ed.selection.clear(); ids.forEach((id) => ed.selection.add(id)); }
    updateSelectionUI();
  }

  // ---------------------------------------------------------------- hit testing
  function hitLineHandle() { return null; }   // cut-lines arrive with the Exposure tab
  function hitHandle(w) {
    const t = tolW(), sel = selectedShapes();
    if (sel.length > 60) return null;
    for (const s of sel) {
      const [rx, ry] = rotHandleWorld(s);
      if (Math.hypot(w.x - rx, w.y - ry) <= t) return { shape: s, kind: 'rot' };
      const hs = handlesLocal(s);
      for (let i = 0; i < hs.length; i++) {
        const [hx, hy] = toWorld(s, hs[i][0], hs[i][1]);
        if (Math.hypot(w.x - hx, w.y - hy) <= t) return { shape: s, kind: 'corner', index: i };
      }
    }
    return null;
  }
  function rotHandleWorld(s) { const bb = bboxLocal(s); return toWorld(s, (bb.x1 + bb.x2) / 2, bb.y2 + 22 * ed.s); }
  function hitEdge(w, device = null) {             // device: null = any, false = not device areas, true = only them
    const t = tolW(), sh = shapesNear(w, t);
    for (let i = 0; i < sh.length; i++) {
      if (!layerVisible(sh[i].layer)) continue;
      if (device !== null && isDeviceLayer(sh[i].layer) !== device) continue;
      if (Math.abs(signedDistance(sh[i], w.x, w.y)) <= t) return sh[i];
    }
    return null;
  }
  // every object under a point, in pick order (for clicking through overlapping objects)
  let lastPick = null;
  function hitAll(w) {
    const out = [], seen = new Set(), push = (h) => { const id = h.type === 'shape' ? h.s.id : h.ref.id; if (!seen.has(id)) { seen.add(id); out.push(h); } };
    const sh = shapesNear(w, 0);
    const e = hitEdge(w, false); if (e) push({ type: 'shape', s: e });
    for (let i = 0; i < sh.length; i++) if (layerVisible(sh[i].layer) && !isDeviceLayer(sh[i].layer) && inside(sh[i], w.x, w.y)) push({ type: 'shape', s: sh[i] });
    const h = hitRef(lib(), ed.cell, w.x, w.y, tolW(), ed.bboxCache); if (h) push({ type: 'ref', ref: h.ref });
    const de = hitEdge(w, true); if (de) push({ type: 'shape', s: de });
    for (let i = 0; i < sh.length; i++) if (layerVisible(sh[i].layer) && isDeviceLayer(sh[i].layer) && inside(sh[i], w.x, w.y)) push({ type: 'shape', s: sh[i] });
    return out;
  }
  // what a click picks; device areas come last, so a device area drawn over a pattern never
  // hides it (its outline still picks it where nothing else is)
  function hitAny(w) {
    const e = hitEdge(w, false);
    if (e) return { type: 'shape', s: e };
    // inside: exposed shapes, then instances/arrays, then device areas (which are drawn over the
    // pattern and would otherwise hide what lies under them; their outline still picks them)
    const sh = shapesNear(w, 0);
    for (let i = 0; i < sh.length; i++) if (layerVisible(sh[i].layer) && !isDeviceLayer(sh[i].layer) && inside(sh[i], w.x, w.y)) return { type: 'shape', s: sh[i] };
    const h = hitRef(lib(), ed.cell, w.x, w.y, tolW(), ed.bboxCache);
    if (h) return { type: 'ref', ref: h.ref };
    const de = hitEdge(w, true);
    if (de) return { type: 'shape', s: de };
    for (let i = 0; i < sh.length; i++) if (layerVisible(sh[i].layer) && isDeviceLayer(sh[i].layer) && inside(sh[i], w.x, w.y)) return { type: 'shape', s: sh[i] };
    return null;
  }

  // ---------------------------------------------------------------- rendering
  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; render(); });
  }

  // Path2D per layer for a cell's own shapes, in the cell's coordinates (cached per version).
  function cellPaths(name) {
    let c = ed.pathCache.get(name);
    if (c) return c;
    const byLayer = new Map();
    for (const s of lib().cells[name].shapes) {
      let p = byLayer.get(s.layer);
      if (!p) { p = new Path2D(); byLayer.set(s.layer, p); }
      addShapePath(p, s, 0, 0);
    }
    c = { layers: [...byLayer.entries()] };
    ed.pathCache.set(name, c);
    return c;
  }
  // many: the path collects many shapes (large-layout batches) — close with a lineTo, because
  // Chrome's closePath is quadratic in the subpaths of one Path2D (34.6 s for 100 000 shapes)
  function addShapePath(p, s, dx, dy, many = false, tol = 0) {
    if (s.kind === 'circle') { p.moveTo(s.cx - dx + s.r, s.cy - dy); p.arc(s.cx - dx, s.cy - dy, s.r, 0, TAU); if (!many) p.closePath(); return; }
    const pts = outlineWorld(s);
    p.moveTo(pts[0][0] - dx, pts[0][1] - dy);
    if (tol > 0 && pts.length > 8) {
      let lx = pts[0][0], ly = pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        const x = pts[i][0], y = pts[i][1];
        if (i < pts.length - 1 && Math.abs(x - lx) + Math.abs(y - ly) < tol) continue;
        p.lineTo(x - dx, y - dy); lx = x; ly = y;
      }
    } else for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0] - dx, pts[i][1] - dy);
    if (many) p.lineTo(pts[0][0] - dx, pts[0][1] - dy); else p.closePath();
  }

  function dominantLayer(name) {
    const st = flatStats(lib(), name, statsMemo());
    let best = null, a = -1;
    for (const [k, v] of Object.entries(st.area)) if (v > a && layerVisible(k)) { a = v; best = k; }
    return best;
  }
  function statsMemo() { if (!ed.statsCache) ed.statsCache = new Map(); return ed.statsCache; }

  let budget = 0;
  function drawCell(name, T, depth) {
    const bb = cellBBox(lib(), name, ed.bboxCache);
    if (!bb) return;
    const wb = applyBBox(T, bb), sb = screenBBox(wb);
    if (sb.x2 < 0 || sb.y2 < 0 || sb.x1 > ed.W || sb.y1 > ed.H) return;
    const k = ed.dpr / ed.s, sc = scaleOf(T);
    if (Math.max(sb.x2 - sb.x1, sb.y2 - sb.y1) < 1.5) {
      const lk = dominantLayer(name);
      if (!lk) return;
      ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
      ctx.fillStyle = layerColor(lk);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(sb.x1, sb.y1, Math.max(1, sb.x2 - sb.x1), Math.max(1, sb.y2 - sb.y1));
      ctx.globalAlpha = 1;
      return;
    }
    setWorldTransform(T);
    const lw = 1 / (k * sc) * ed.dpr;
    for (const [lk, path] of cellPaths(name).layers) {
      if (!layerVisible(lk)) continue;
      ctx.fillStyle = layerColor(lk); ctx.globalAlpha = 0.32; ctx.fill(path, 'nonzero');
      ctx.globalAlpha = 0.9; ctx.strokeStyle = layerColor(lk); ctx.lineWidth = lw; ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    if (depth > 24) return;
    for (const r of lib().cells[name].refs) drawRef(r, T, depth + 1);
  }

  function latticeQuad(ref, rg, T) {
    // region covered by elements rg, as a quadrilateral in world coordinates
    const b0 = applyBBox(refLinear(ref), cellBBox(lib(), ref.cell, ed.bboxCache));
    const cx = (b0.x1 + b0.x2) / 2, cy = (b0.y1 + b0.y2) / 2;
    const hx = (b0.x2 - b0.x1) / 2, hy = (b0.y2 - b0.y1) / 2;
    const P = (i, j) => [ref.x + i * ref.colStep[0] + j * ref.rowStep[0] + cx, ref.y + i * ref.colStep[1] + j * ref.rowStep[1] + cy];
    const corners = [P(rg.i0, rg.j0), P(rg.i1, rg.j0), P(rg.i1, rg.j1), P(rg.i0, rg.j1)];
    // expand by the element half-size so the swatch covers the outermost elements
    let gx = 0, gy = 0; corners.forEach(([x, y]) => { gx += x / 4; gy += y / 4; });
    return corners.map(([x, y]) => {
      const ex = x >= gx ? hx : -hx, ey = y >= gy ? hy : -hy;
      return apply(T, x + ex, y + ey);
    });
  }

  function drawRef(ref, T, depth) {
    const bb = refBBox(lib(), ref, ed.bboxCache);
    if (!bb) return;
    const sb = screenBBox(applyBBox(T, bb));
    if (sb.x2 < 0 || sb.y2 < 0 || sb.x1 > ed.W || sb.y1 > ed.H) return;
    const viewLocal = applyBBox(invert(T), viewRect());
    const rg = visibleRange(lib(), ref, viewLocal, ed.bboxCache);
    if (!rg) return;
    const n = (rg.i1 - rg.i0 + 1) * (rg.j1 - rg.j0 + 1);
    const cb = cellBBox(lib(), ref.cell, ed.bboxCache);
    const elemPx = (Math.max(cb.x2 - cb.x1, cb.y2 - cb.y1) * ref.mag * scaleOf(T)) / ed.s;
    if (n > 1 && (elemPx < 3 || n > budget)) {
      // swatch: fill the visible lattice region with the pattern's average coverage
      const lk = dominantLayer(ref.cell);
      if (!lk) return;
      const st = flatStats(lib(), ref.cell, statsMemo());
      const cellArea = Object.entries(st.area).filter(([k]) => layerVisible(k)).reduce((a, [, v]) => a + v, 0) * ref.mag * ref.mag;
      const cellA = Math.abs(ref.colStep[0] * ref.rowStep[1] - ref.colStep[1] * ref.rowStep[0]) || (Math.hypot(...ref.colStep) + Math.hypot(...ref.rowStep)) * Math.max(cb.x2 - cb.x1, cb.y2 - cb.y1);
      const ff = cellA > 0 ? Math.min(1, cellArea / cellA) : 0.5;
      const q = latticeQuad(ref, rg, T);
      setWorldTransform(IDENTITY);
      ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = layerColor(lk); ctx.globalAlpha = 0.12 + 0.55 * ff; ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = layerColor(lk); ctx.lineWidth = ed.s; ctx.setLineDash([4 * ed.s, 3 * ed.s]); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      budget -= Math.min(n, 50);
      return;
    }
    const child = lib().cells[ref.cell];
    if (!child.refs.length && n > 4) {
      // Leaf cell: gather every visible element into one path per layer and fill once. One
      // draw call per layer instead of one per element is what keeps 10⁴ elements interactive.
      const layers = cellPaths(ref.cell).layers.filter(([lk]) => layerVisible(lk));
      const batches = layers.map(() => new Path2D());
      for (let i = rg.i0; i <= rg.i1; i++) for (let j = rg.j0; j <= rg.j1; j++) {
        const M = compose(T, elementTransform(ref, i, j));
        const dm = new DOMMatrix([M.a, M.b, M.c, M.d, M.e - ed.ox, M.f - ed.oy]);
        for (let q = 0; q < layers.length; q++) batches[q].addPath(layers[q][1], dm);
      }
      budget -= n;
      const k = ed.dpr / ed.s;
      ctx.setTransform(k, 0, 0, -k, 0, 0);
      for (let q = 0; q < layers.length; q++) {
        const col = layerColor(layers[q][0]);
        ctx.fillStyle = col; ctx.globalAlpha = 0.32; ctx.fill(batches[q]);
        if (elemPx > 8) { ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = ed.s; ctx.stroke(batches[q]); }
      }
      ctx.globalAlpha = 1;
      return;
    }
    for (let i = rg.i0; i <= rg.i1; i++) for (let j = rg.j0; j <= rg.j1; j++) {
      budget--;
      drawCell(ref.cell, compose(T, elementTransform(ref, i, j)), depth);
    }
  }

  function drawGrid() {
    const g = gridNm();
    if (!(g > 0)) return;
    const v = viewRect();
    const minorPx = g / ed.s, majorPx = (g * ed.gridMajor) / ed.s;
    ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
    ctx.lineWidth = 1;
    for (const [step, color, ok] of [[g, '#efefef', minorPx >= 6], [g * ed.gridMajor, '#d4d4d4', majorPx >= 6]]) {
      if (!ok) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.floor(v.x1 / step) * step; x <= v.x2; x += step) {
        if (step === g && Math.round(x / g) % ed.gridMajor === 0 && majorPx >= 6) continue;
        const sx = Math.round(w2s(x, 0).x) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, ed.H);
      }
      for (let y = Math.floor(v.y1 / step) * step; y <= v.y2; y += step) {
        if (step === g && Math.round(y / g) % ed.gridMajor === 0 && majorPx >= 6) continue;
        const sy = Math.round(w2s(0, y).y) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(ed.W, sy);
      }
      ctx.stroke();
    }
    // origin cross
    const o = w2s(0, 0);
    if (o.x > -10 && o.x < ed.W + 10 && o.y > -10 && o.y < ed.H + 10) {
      ctx.strokeStyle = '#b0b0b0'; ctx.beginPath(); ctx.moveTo(o.x - 8, o.y + 0.5); ctx.lineTo(o.x + 8, o.y + 0.5); ctx.moveTo(o.x + 0.5, o.y - 8); ctx.lineTo(o.x + 0.5, o.y + 8); ctx.stroke();
    }
  }

  function drawScaleBar() {
    const target = 110 * ed.s;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const L = [1, 2, 5, 10].map((m) => m * p).filter((v) => v <= target).pop() || p;
    const px = L / ed.s, x = 14, y = ed.H - 16;
    ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - 6, y - 18, px + 12, 26);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
    const txt = L >= 1e6 ? `${L / 1e6} mm` : L >= 1000 ? `${L / 1000} µm` : `${L} nm`;
    ctx.fillStyle = '#111'; ctx.font = '12px system-ui'; ctx.fillText(txt, x + px / 2 - ctx.measureText(txt).width / 2, y - 6);
  }

  function drawHandle(x, y, kind) {
    ctx.beginPath();
    if (kind === 'rot') { ctx.arc(x, y, 5, 0, TAU); ctx.fillStyle = '#08f'; }
    else { ctx.rect(x - 4, y - 4, 8, 8); ctx.fillStyle = '#fff'; }
    ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = kind === 'rot' ? '#036' : '#000'; ctx.stroke();
  }

  // One path per layer style, sub-pixel shapes as dots (the large-layout drawing). c has the
  // transform world-minus-(dx,dy) → device already set; u = world units per CSS pixel.
  // withSel: selected shapes get the selection style; thin: drop vertices closer than half a pixel.
  function paintShapes(c, ix, idxList, dx, dy, u, withSel, thin) {
    const batches = new Map(), tiny = 1.5 * u, color = new Map(), dev = layerPurposeIs('device');
    for (const i of idxList) {
      const s = ix.shapes[i], sel = withSel && ed.selection.has(s.id);
      const key = sel ? '|sel' : s.layer + (s.groupId ? '|g' : '');
      let b = batches.get(key);
      if (!b) {
        if (!color.has(s.layer)) color.set(s.layer, layerColor(s.layer));
        batches.set(key, (b = { p: new Path2D(), dots: new Path2D(), col: color.get(s.layer), dev: !sel && dev(s.layer), grp: !sel && !!s.groupId, sel, nd: 0 }));
      }
      const bb = shapeBB(ix, i);
      if (bb.x2 - bb.x1 < tiny && bb.y2 - bb.y1 < tiny) { b.dots.rect(bb.x1 - dx, bb.y1 - dy, Math.max(bb.x2 - bb.x1, u), Math.max(bb.y2 - bb.y1, u)); b.nd++; }
      else addShapePath(b.p, s, dx, dy, true, thin ? 0.5 * u : 0);
    }
    const order = [...batches.values()].sort((a, d) => a.sel - d.sel);   // the selection on top
    for (const b of order) {
      c.fillStyle = b.sel ? 'rgba(0,110,255,0.22)' : b.col; c.globalAlpha = b.sel ? 1 : b.dev ? 0.07 : 0.32; c.fill(b.p); c.globalAlpha = 1;
      c.lineWidth = (b.sel ? 2 : b.dev ? 1.5 : 1) * u; c.strokeStyle = b.sel ? '#06f' : b.grp ? '#3a7a1f' : b.col;
      c.setLineDash(b.dev ? [8 * u, 4 * u] : b.grp ? [6 * u, 3 * u] : []); c.stroke(b.p); c.setLineDash([]);
      if (b.nd) { c.fillStyle = b.sel ? '#06f' : b.grp ? '#3a7a1f' : b.col; c.fill(b.dots); }      // sub-pixel shapes, as their outline would show
    }
  }

  // ---------------------------------------------------------------- tiles (large cells)
  // A cell of TILE_FROM shapes or more is drawn from cached tiles: TILE CSS pixels square, at the
  // power-of-two scale just finer than the view (so a tile is shown at 50–100 % of its size).
  // Missing tiles are rendered nearest the centre first, within FRAME_MS per frame; while the
  // wheel or a pan is active none are rendered and the previous frame, rescaled, stands in.
  const TILE = 256, TILE_FROM = 20000, FRAME_MS = 30, TILE_BYTES = 256e6;
  const tiles = { map: new Map(), gen: '', cur: null, prev: null, prevView: null, last: { rendered: 0, missing: 0, drawn: 0 } };
  const tiledCell = () => !window.__ebwNoTiles && shapes().length >= TILE_FROM;   // __ebwNoTiles: probes compare with the direct drawing
  function tileGen() {
    return [ed.structVersion, ed.cell, ed.dpr, ed.dirty.size ? ed.dirtyGen : 0,
      lib().layers.map((l) => l.key + (l.visible ? '+' : '-') + l.color + l.purpose).join(',')].join('|');
  }
  function renderTile(L, i, j) {
    const sL = Math.pow(2, L), span = TILE * sL, X0 = i * span, Y0 = j * span, X1 = X0 + span, Y1 = Y0 + span;
    const px = Math.round(TILE * ed.dpr);
    const c = document.createElement('canvas'); c.width = px; c.height = px;
    const g = c.getContext('2d');
    const ix = shapeIndex(), vis = layerVisibility(), pad = 3 * sL, list = [];
    for (const q of queryShapeIndex(ix, X0 - pad, Y0 - pad, X1 + pad, Y1 + pad)) {
      const sh = ix.shapes[q];
      if (vis(sh.layer) && !(ed.dirty.size && ed.dirty.has(sh.id))) list.push(q);
    }
    if (list.length) { const k = ed.dpr / sL; g.setTransform(k, 0, 0, -k, 0, 0); paintShapes(g, ix, list, X0, Y1, sL, false, true); }
    return c;
  }
  // a finished tile becomes an ImageBitmap, which the browser keeps on the GPU: drawing a plain
  // small canvas uploads it again every frame
  function toBitmap(key, c, gen) {
    if (typeof createImageBitmap !== 'function') return;
    createImageBitmap(c).then((bm) => { if (tiles.gen === gen && tiles.map.get(key) === c) tiles.map.set(key, bm); else bm.close?.(); }, () => {});
  }
  function drawTiles() {
    const Wd = canvas.width, Hd = canvas.height;
    for (const key of ['cur', 'prev']) if (!tiles[key] || tiles[key].width !== Wd || tiles[key].height !== Hd) { tiles[key] = document.createElement('canvas'); tiles[key].width = Wd; tiles[key].height = Hd; if (key === 'prev') tiles.prevView = null; }
    const gen = tileGen();
    if (gen !== tiles.gen) { tiles.map.clear(); tiles.gen = gen; }
    const L = clamp(Math.floor(Math.log2(ed.s)), -20, 60), span = TILE * Math.pow(2, L);
    const vr = viewRect(), d = ed.dpr;
    const i0 = Math.floor(vr.x1 / span), i1 = Math.floor(vr.x2 / span), j0 = Math.floor(vr.y1 / span), j1 = Math.floor(vr.y2 / span);
    const cx = (vr.x1 + vr.x2) / 2, cy = (vr.y1 + vr.y2) / 2, list = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) list.push({ i, j, r: Math.hypot((i + 0.5) * span - cx, (j + 0.5) * span - cy) });
    list.sort((a, b) => a.r - b.r);
    const g = tiles.cur.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, Wd, Hd);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    const now = performance.now(), budget = now < ed.interactUntil ? 0 : FRAME_MS;
    let rendered = 0, missing = 0;
    const pv = tiles.prevView, tileMs = [];
    for (const t of list) {
      const key = L + '|' + t.i + '|' + t.j;
      let c = tiles.map.get(key);
      if (!c && budget > 0 && (rendered === 0 || performance.now() - now < budget)) { const ta = performance.now(); c = renderTile(L, t.i, t.j); tileMs.push(Math.round(performance.now() - ta)); rendered++; toBitmap(key, c, gen); }
      if (c) { tiles.map.delete(key); tiles.map.set(key, c); }       // most recently used last
      const X0 = t.i * span, X1 = X0 + span, Y0 = t.j * span, Y1 = Y0 + span;
      const x0 = Math.round(((X0 - ed.ox) / ed.s) * d), x1 = Math.round(((X1 - ed.ox) / ed.s) * d);
      const y0 = Math.round(((ed.oy - Y1) / ed.s) * d), y1 = Math.round(((ed.oy - Y0) / ed.s) * d);
      if (c) { g.drawImage(c, x0, y0, x1 - x0, y1 - y0); continue; }
      missing++;
      if (pv) {
        // the previous frame, moved and scaled to the current view, inside this tile's square
        const f = pv.s / ed.s * (d / pv.dpr);
        g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
        g.drawImage(tiles.prev, ((pv.ox - ed.ox) / ed.s) * d, ((ed.oy - pv.oy) / ed.s) * d, Wd * f, Hd * f);
        g.restore();
      }
    }
    // keep the cache within TILE_BYTES
    const maxTiles = Math.max(list.length * 2, Math.floor(TILE_BYTES / (4 * Math.pow(Math.round(TILE * d), 2))));
    while (tiles.map.size > maxTiles) tiles.map.delete(tiles.map.keys().next().value);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tiles.cur, 0, 0);
    [tiles.cur, tiles.prev] = [tiles.prev, tiles.cur];
    tiles.prevView = { s: ed.s, ox: ed.ox, oy: ed.oy, dpr: d };
    tiles.last = { rendered, missing, drawn: list.length, tileMs, L };
    if (missing) {
      if (budget > 0) scheduleRender();
      else setTimeout(scheduleRender, Math.max(0, ed.interactUntil - performance.now()) + 5);
    }
  }
  // the wheel and pans mark the view as moving: frames then reuse tiles and the last frame only
  const interacting = () => { ed.interactUntil = performance.now() + 150; };

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    budget = ELEMENT_BUDGET;

    // instances first, so the cell's own shapes sit on top
    for (const r of refs()) drawRef(r, IDENTITY, 0);

    // the edited cell's shapes, drawn relative to the view origin
    const k = ed.dpr / ed.s;
    ctx.setTransform(k, 0, 0, -k, 0, 0);
    const dx = ed.ox, dy = ed.oy;
    const vr = viewRect();
    const ix = shapeIndex(), vis = layerVisibility();
    const tiled = tiledCell();
    const visible = [], visBB = [];
    if (tiled) {
      drawTiles();
      // on top of the tiles: shapes being dragged (not in the tiles) and the selection highlight
      const over = [];
      if (ed.selection.size || ed.dirty.size) for (const i of shapesIn(vr.x1, vr.y1, vr.x2, vr.y2)) { const sh = ix.shapes[i]; if (vis(sh.layer) && (ed.selection.has(sh.id) || ed.dirty.has(sh.id))) over.push(i); }
      if (over.length) {
        ctx.setTransform(k, 0, 0, -k, 0, 0);
        const moving = over.filter((i) => ed.dirty.has(ix.shapes[i].id));
        if (moving.length) paintShapes(ctx, ix, moving, dx, dy, ed.s, false, false);
        paintShapes(ctx, ix, over.filter((i) => ed.selection.has(ix.shapes[i].id)), dx, dy, ed.s, true, false);
      }
    } else for (const i of shapesIn(vr.x1, vr.y1, vr.x2, vr.y2)) { const s = ix.shapes[i]; if (vis(s.layer)) { visible.push(s); visBB.push(i); } }
    // Large layouts (imported GDS): one path per layer style instead of one per shape, and shapes
    // smaller than a pixel as dots. Up to BATCH_FROM visible shapes the per-shape drawing below is
    // used unchanged (overlaps darken, every outline stroked).
    const BATCH_FROM = 4000;
    if (visible.length > BATCH_FROM) paintShapes(ctx, ix, visBB, dx, dy, ed.s, true, false);
    for (const s of visible) {
      if (visible.length > BATCH_FROM) break;                // drawn in batches above
      const p = new Path2D(); addShapePath(p, s, dx, dy);
      const sel = ed.selection.has(s.id), col = layerColor(s.layer), dev = isDeviceLayer(s.layer);
      ctx.fillStyle = sel ? 'rgba(0,110,255,0.22)' : col; ctx.globalAlpha = sel ? 1 : dev ? 0.07 : 0.32; ctx.fill(p);
      ctx.globalAlpha = 1;
      ctx.lineWidth = (sel ? 2 : dev ? 1.5 : 1) * ed.s;
      ctx.strokeStyle = sel ? '#06f' : s.groupId ? '#3a7a1f' : col;
      ctx.setLineDash(dev ? [8 * ed.s, 4 * ed.s] : s.groupId ? [6 * ed.s, 3 * ed.s] : []);
      ctx.stroke(p);
      ctx.setLineDash([]);
    }

    // selected instances: dashed outline of the whole array
    for (const r of selectedRefs()) {
      const q = latticeQuad(r, { i0: 0, i1: r.cols - 1, j0: 0, j1: r.rows - 1 }, IDENTITY);
      ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
      ctx.beginPath(); q.forEach(([x, y], i) => { const p = w2s(x, y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.fillStyle = 'rgba(0,110,255,0.08)'; ctx.fill();
      ctx.strokeStyle = '#06f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
    drawLabels();

    // handles for the selection
    const sel = selectedShapes();
    if (sel.length <= 60) for (const s of sel) {
      for (const h of handlesLocal(s)) { const [x, y] = toWorld(s, h[0], h[1]); const p = w2s(x, y); drawHandle(p.x, p.y, 'corner'); }
      const bb = bboxLocal(s);
      const [tx, ty] = toWorld(s, (bb.x1 + bb.x2) / 2, bb.y2), [rx, ry] = rotHandleWorld(s);
      const tp = w2s(tx, ty), rp = w2s(rx, ry);
      ctx.strokeStyle = '#08f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
      drawHandle(rp.x, rp.y, 'rot');
    }

    // shape being drawn
    if (ed.draft) {
      const p = new Path2D(); addShapePath(p, ed.draft, ed.ox, ed.oy);
      ctx.setTransform(k, 0, 0, -k, 0, 0);
      ctx.fillStyle = 'rgba(0,120,255,0.12)'; ctx.fill(p); ctx.lineWidth = 1.5 * ed.s; ctx.strokeStyle = '#06f'; ctx.stroke(p);
      ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
    }
    if (ed.pendingPoly && ed.pendingPoly.pts.length) {
      ctx.strokeStyle = '#06f'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.beginPath();
      ed.pendingPoly.pts.forEach((pt, i) => { const q = w2s(pt.x, pt.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      if (ed.pendingPoly.cursor) { const q = w2s(ed.pendingPoly.cursor.x, ed.pendingPoly.cursor.y); ctx.lineTo(q.x, q.y); }
      ctx.stroke(); ctx.setLineDash([]);
      ed.pendingPoly.pts.forEach((pt) => { const q = w2s(pt.x, pt.y); ctx.fillStyle = '#06f'; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, TAU); ctx.fill(); });
    }
    // place-cell ghost
    if (ed.tool === 'place' && ed.placeCell && ed.hover && lib().cells[ed.placeCell]) {
      const p = snapPt(ed.hover);
      ctx.globalAlpha = 0.55;
      budget = Math.min(budget, 4000);
      drawCell(ed.placeCell, { a: 1, b: 0, c: 0, d: 1, e: p.x, f: p.y }, 1);
      ctx.globalAlpha = 1;
      ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
    }
    if (ed.marquee) {
      const a = w2s(ed.marquee.x1, ed.marquee.y1), b = w2s(ed.marquee.x2, ed.marquee.y2);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.fillStyle = 'rgba(0,110,255,0.08)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#06f'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
    }
    if (ed.selLasso && ed.selLasso.length > 1) {
      ctx.beginPath();
      ed.selLasso.forEach((q, i) => { const a = w2s(q.x, q.y); if (i) ctx.lineTo(a.x, a.y); else ctx.moveTo(a.x, a.y); });
      ctx.closePath(); ctx.fillStyle = 'rgba(0,110,255,0.08)'; ctx.fill();
      ctx.strokeStyle = '#06f'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    drawScaleBar();
    updateStatus();
  }

  function drawLabels() {
    ctx.font = '12px system-ui';
    // one dose label per group, at its top-left, when the group is big enough on screen
    const visKey = lib().layers.map((l) => l.key + (l.visible ? '+' : '-') + l.purpose).join(',');
    let groups;
    if (!ed.dirty.size && ed.labelCache && ed.labelCache.v === ed.structVersion && ed.labelCache.cell === ed.cell && ed.labelCache.vis === visKey) groups = ed.labelCache.groups;
    else {
      groups = new Map();
      const ix = shapeIndex(), vis = layerVisibility(), dev = layerPurposeIs('device');
      for (let i = 0; i < ix.n; i++) {
        const s = ix.shapes[i];
        if (!vis(s.layer) || dev(s.layer)) continue;
        const k = groupKeyOf(s);
        const bb = shapeBB(ix, i);
        let g = groups.get(k);
        if (!g) { g = { s, n: 0, bb: null }; groups.set(k, g); }
        g.n++; g.bb = unionBBox(g.bb, bb);
        if (groups.size > 400 && i > 2000) break;     // too many to label: nothing is drawn either way
      }
      if (!ed.dirty.size) ed.labelCache = { v: ed.structVersion, cell: ed.cell, vis: visKey, groups };
    }
    const placed = [];   // label boxes already drawn; a label that would overlap one is skipped
    const free = (x, y, w, h) => !placed.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h);
    if (groups.size <= 400) for (const g of groups.values()) {
      const sb = screenBBox(g.bb);
      if (sb.x2 - sb.x1 < 26 && sb.y2 - sb.y1 < 26) continue;
      if (sb.x2 < 0 || sb.y2 < 0 || sb.x1 > ed.W || sb.y1 > ed.H) continue;
      const s = g.s, corr = isCorrected(s) && Math.abs(s.writeDose - s.dose) > 1e-9;
      const txt = `${(s.dose ?? 0).toFixed(1)}${corr ? ' → ' + s.writeDose.toFixed(1) + ' written' : ''} µC/cm²${g.n > 1 ? ' · fused ×' + g.n : ''}`;
      const w = ctx.measureText(txt).width + 6;
      if (!free(sb.x1 + 2, sb.y1 + 2, w, 15)) continue;
      placed.push({ x: sb.x1 + 2, y: sb.y1 + 2, w, h: 15 });
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(sb.x1 + 2, sb.y1 + 2, w, 15);
      ctx.fillStyle = '#111'; ctx.fillText(txt, sb.x1 + 5, sb.y1 + 14);
    }
    // device areas: name and size, in gold
    if (ed.cell === lib().top) for (const a of deviceAreas(lib())) {
      if (!layerVisible(a.shape.layer)) continue;
      const sb = screenBBox(a.bb);
      if (sb.x2 < 0 || sb.y2 < 0 || sb.x1 > ed.W || sb.y1 > ed.H) continue;
      const txt = `${a.name} · ${umTxt(a.w, 1)} × ${umTxt(a.h, 1)} µm`;
      const w = ctx.measureText(txt).width + 6, y = Math.max(sb.y1 - 17, 2);
      ctx.fillStyle = 'rgba(255,250,220,0.9)'; ctx.fillRect(sb.x1, y, w, 15);
      ctx.fillStyle = '#7a6200'; ctx.fillText(txt, sb.x1 + 3, y + 12);
    }
    const rampNamed = new Set();
    for (const r of refs()) {
      const bb = refBBox(lib(), r, ed.bboxCache);
      if (!bb) continue;
      const sb = screenBBox(bb);
      if (r.ramp) {
        if (sb.x2 < 0 || sb.y2 < 0 || sb.x1 > ed.W || sb.y1 > ed.H) continue;
        const m = r.ramp, lab = rampLabel(r);
        ctx.save(); ctx.font = '10px system-ui';
        const tw = ctx.measureText(lab).width;
        if (m.rampX && !m.rampY && sb.x2 - sb.x1 >= tw + 4) {            // above each column
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(sb.x1, sb.y1 - 13, tw + 4, 12); ctx.fillStyle = '#9b2c2c'; ctx.fillText(lab, sb.x1 + 2, sb.y1 - 3);
        } else if (m.rampY && !m.rampX && sb.y2 - sb.y1 >= 10) {          // left of each row
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(sb.x1 - tw - 8, (sb.y1 + sb.y2) / 2 - 6, tw + 4, 12); ctx.fillStyle = '#9b2c2c'; ctx.fillText(lab, sb.x1 - tw - 6, (sb.y1 + sb.y2) / 2 + 4);
        } else if (sb.x2 - sb.x1 >= tw + 4 && sb.y2 - sb.y1 >= 12) {      // both: inside each element
          ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(sb.x1 + 1, sb.y1 + 1, tw + 4, 12); ctx.fillStyle = '#9b2c2c'; ctx.fillText(lab, sb.x1 + 3, sb.y1 + 11);
        }
        ctx.restore();
        if (rampNamed.has(m.group)) continue;
        rampNamed.add(m.group);
        const gbb = rampGroupRefs(cellObj(), m.group).reduce((a, x) => unionBBox(a, refBBox(lib(), x, ed.bboxCache)), null);
        const gsb = screenBBox(gbb);
        if (gsb.x2 - gsb.x1 < 50) continue;
        const txt = `${r.cell} ${m.cols}×${m.rows} · dose ramp`;
        const w = ctx.measureText(txt).width + 6, y = Math.max(gsb.y1 - (m.rampX && !m.rampY ? 31 : 17), 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(gsb.x1, y, w, 15);
        ctx.fillStyle = '#555'; ctx.fillText(txt, gsb.x1 + 3, y + 12);
        continue;
      }
      if (sb.x2 - sb.x1 < 50 || sb.x2 < 0 || sb.y2 < 0 || sb.x1 > ed.W || sb.y1 > ed.H) continue;
      const txt = `${r.cell}${r.cols * r.rows > 1 ? ` ${r.cols}×${r.rows}` : ''}`;
      const w = ctx.measureText(txt).width + 6, y = Math.max(sb.y1 - 17, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(sb.x1, y, w, 15);
      ctx.fillStyle = '#555'; ctx.fillText(txt, sb.x1 + 3, y + 12);
    }
  }

  // ---------------------------------------------------------------- status and panels
  function updateStatus() {
    const st = flatStats(lib(), ed.cell, statsMemo());
    const c = cellObj();
    const exposedArea = Object.entries(st.area).filter(([k]) => isExposedPurpose(layerOf(k)?.purpose ?? 'exposure')).reduce((a, [, v]) => a + v, 0);
    $('stZoom').innerHTML = `zoom <b>${(ed.s / 1000).toPrecision(3)}</b> µm/px`;
    $('stCell').innerHTML = `cell <b>${esc(ed.cell)}</b>`;
    $('stCounts').innerHTML = `${c.shapes.length} shapes, ${c.refs.length} instance${c.refs.length === 1 ? '' : 's'} · flattened <b>${st.shapes.toLocaleString()}</b> shapes, exposed area <b>${(exposedArea / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> µm²`;
    const crumb = $('crumb');
    if (ed.cell !== lib().top) {
      crumb.classList.add('show');
      const users = parentsOf(lib(), ed.cell);
      $('crumbText').innerHTML = `Editing cell <b>${esc(ed.cell)}</b>${users.length ? ` · placed in ${users.map(esc).join(', ')}` : ' · not placed anywhere'}`;
    } else crumb.classList.remove('show');
  }

  function updateSelectionUI() {
    const sel = selectedShapes(), rs = selectedRefs();
    const keys = new Set(sel.map(groupKeyOf));
    $('btnFuse').disabled = new Set(sel.filter((s) => !isDeviceLayer(s.layer)).map(groupKeyOf)).size < 2 || rs.length > 0;
    $('btnSplit').disabled = !sel.some((s) => s.groupId);
    $('btnDelete').disabled = !sel.length && !rs.length;
    $('btnDuplicate').disabled = !sel.length && !rs.length;
    const rampSel = selectedRampGroup();
    $('btnArray').disabled = !sel.length && rs.length !== 1 && !rampSel;
    if (!sel.length && !rs.length) { $('selInfo').style.display = 'block'; $('selEditor').style.display = 'none'; return; }
    $('selInfo').style.display = 'none'; $('selEditor').style.display = 'block';
    const allDevice = sel.length > 0 && sel.every((s) => isDeviceLayer(s.layer));
    $('selDoseBox').style.display = sel.length && !allDevice ? 'block' : 'none';
    $('selLayerBox').style.display = sel.length ? 'block' : 'none';
    const doseEl = $('selDose');
    if (sel.length && document.activeElement !== doseEl) {
      const ds = [...new Set(sel.map((s) => s.dose ?? 0))];
      doseEl.value = ds.length === 1 ? ds[0] : ''; doseEl.placeholder = ds.length === 1 ? '' : 'mixed';
    }
    if (sel.length) {
      const ls = [...new Set(sel.map((s) => s.layer))];
      const le = $('selLayer');
      le.innerHTML = (ls.length > 1 ? '<option value="">mixed</option>' : '') + lib().layers.map((l) => `<option value="${esc(l.key)}">${esc(l.name)} (${esc(l.key)})</option>`).join('');
      le.value = ls.length === 1 ? ls[0] : '';
    }
    let html;
    if (rampSel) {
      const m = rampSel.ramp, steps = rs.length, ds = rs.map((r) => r.doseScale ?? 1);
      html = `<span class="pill">dose ramp</span> cell <b>${esc(rampSel.cell)}</b>, ${m.cols} × ${m.rows}, pitch ${umTxt(m.pitchX)} × ${umTxt(m.pitchY)} µm<br>${steps} dose steps: ${esc(describeRamp(m))}<br>`
        + `dose ${(m.base * Math.min(...ds)).toFixed(1)} – ${(m.base * Math.max(...ds)).toFixed(1)} µC/cm² (base ${m.base})`;
    } else if (sel.length === 1 && !rs.length) {
      const s = sel[0];
      html = isZoneLayer(s.layer)
        ? `<span class="pill">high-resolution PEC zone</span> ${describe(s)}<br>centre (${umTxt(s.cx)}, ${umTxt(s.cy)}) µm<br><span class="hint">Objects inside are corrected in full when the Exposure tab corrects the high-resolution parts. Not exposed.</span>`
        : `${isDeviceLayer(s.layer) ? '<span class="pill">device area</span> ' : ''}${describe(s)}<br>centre (${umTxt(s.cx)}, ${umTxt(s.cy)}) µm${isDeviceLayer(s.layer) ? '<br><span class="hint">Simulated in Fab Studio: pick it there. Not exposed.</span>' : ''}`;
    } else if (rs.length === 1 && !sel.length) {
      const r = rs[0], st = flatStats(lib(), r.cell, statsMemo());
      html = `instance of <b>${esc(r.cell)}</b>${r.cols * r.rows > 1 ? `, array ${r.cols} × ${r.rows}, pitch ${umTxt(Math.hypot(...r.colStep))} × ${umTxt(Math.hypot(...r.rowStep))} µm` : ''}<br>`
        + `origin (${umTxt(r.x)}, ${umTxt(r.y)}) µm${r.rot ? `, ${r.rot.toFixed(1)}°` : ''}${r.mag !== 1 ? `, ×${r.mag}` : ''}${r.mirrorX ? ', mirrored' : ''}<br>`
        + `${(st.shapes * r.cols * r.rows).toLocaleString()} shapes when flattened`;
    } else {
      html = `${sel.length} shape${sel.length === 1 ? '' : 's'}${keys.size === 1 && sel.length > 1 ? ' <span class="pill">fused</span>' : ''}${rs.length ? `, ${rs.length} instance${rs.length === 1 ? '' : 's'}` : ''} selected`;
    }
    const corr = sel.filter(isCorrected);
    if (corr.length) html += `<br><span class="pill">corrected</span> writing ${corr.length === 1 ? corr[0].writeDose.toFixed(1) : corr.reduce((m, s) => Math.min(m, s.writeDose), Infinity).toFixed(1) + '–' + corr.reduce((m, s) => Math.max(m, s.writeDose), -Infinity).toFixed(1)} µC/cm²`;
    $('selGeom').innerHTML = html;
    $('btnEditGeom').textContent = (rs.length === 1 || rampSel) && !sel.length ? 'Properties…' : 'Size & rotation…';
    $('btnEditGeom').disabled = !((sel.length === 1 && !rs.length) || (rs.length === 1 && !sel.length) || rampSel);
  }

  function updateCellList() {
    const L = lib(), memo = statsMemo();
    const names = Object.keys(L.cells).sort((a, b) => (a === L.top ? -1 : b === L.top ? 1 : a.localeCompare(b)));
    if (!ed.cellPick || !L.cells[ed.cellPick]) ed.cellPick = ed.cell;
    $('cellList').innerHTML = names.map((n) => {
      const c = L.cells[n], st = flatStats(L, n, memo);
      return `<div class="item${n === ed.cellPick ? ' on' : ''}" data-cell="${esc(n)}">`
        + `<span class="grow">${n === ed.cell ? '✎ ' : ''}${esc(n)}${n === L.top ? ' <span class="pill">top</span>' : ''}</span>`
        + `<span class="meta">${c.shapes.length}s ${c.refs.length}i · ${st.shapes.toLocaleString()} flat</span></div>`;
    }).join('');
  }

  function updateLayerList() {
    const L = lib();
    if (!L.layers.some((l) => l.key === ed.activeLayer)) ed.activeLayer = L.layers[0]?.key ?? '1/0';
    $('layerList').innerHTML = L.layers.map((l, i) => `<div class="item" data-i="${i}">`
      + `<input type="radio" name="activeLayer" ${l.key === ed.activeLayer ? 'checked' : ''} title="active layer for new shapes">`
      + `<input type="checkbox" class="vis" ${l.visible ? 'checked' : ''} title="visible">`
      + `<input type="color" value="${esc(l.color)}">`
      + `<span class="grow"><input class="name" value="${esc(l.name)}"></span>`
      + `<input class="key" value="${esc(l.key)}" title="GDS layer/datatype">`
      + `<span class="meta">${l.purpose === 'marker' ? 'marker' : l.purpose === 'device' ? 'device' : l.purpose === 'hres' ? 'PEC zone' : l.pec === 'high' ? 'high PEC' : ''}</span></div>`).join('');
    updateLayerBeam();
  }
  // beam step and current of the active layer (only exposed layers are written; defaults 5 nm, 2 nA)
  function updateLayerBeam() {
    const l = lib().layers.find((o) => o.key === ed.activeLayer);
    const written = !!l && l.purpose !== 'marker' && l.purpose !== 'device' && l.purpose !== 'hres';
    $('layerStep').value = written ? (l.step ?? 5) : ''; $('layerCur').value = written ? (l.current ?? 2) : '';
    $('layerStep').disabled = $('layerCur').disabled = !written;
    $('layerPec').value = written && l.pec === 'high' ? 'high' : 'standard'; $('layerPec').disabled = !written;
  }

  // ---------------------------------------------------------------- edits
  function deleteSelection() {
    if (!ed.selection.size) return;
    pushUndo();
    const c = cellObj();
    c.shapes = c.shapes.filter((s) => !ed.selection.has(s.id));
    c.refs = c.refs.filter((r) => !ed.selection.has(r.id));
    ed.selection.clear();
    changed('deleted');
  }
  function deleteAll() {
    const c = cellObj();
    if (!c.shapes.length && !c.refs.length) return;
    if (!confirm(`Delete everything in cell ${ed.cell}?`)) return;
    pushUndo(); c.shapes = []; c.refs = []; ed.selection.clear(); changed('all deleted');
  }
  function duplicateSelection() {
    const sel = selectedShapes(), rs = selectedRefs();
    if (!sel.length && !rs.length) return;
    pushUndo();
    // PowerPoint / Illustrator behaviour: duplicate, move the copy, duplicate again -> the next copy
    // lands one more such step away. ed.dupMemo pairs the last original with its copy; if the copy
    // set is still exactly the selection, the step is wherever the user has put the copy since.
    let dx = gridNm() > 0 ? gridNm() : 1000, dy = -dx;
    const key = [...sel, ...rs].map((o) => o.id).sort().join(), pos = (o) => (o.cx != null ? [o.cx, o.cy] : [o.x, o.y]);
    const m = ed.dupMemo, srcObj = m && m.key === key ? [...shapes(), ...refs()].find((o) => o.id === m.src) : null;
    const cpyObj = srcObj ? [...sel, ...rs].find((o) => o.id === m.copy) : null, repeat = !!(srcObj && cpyObj);
    if (repeat) { const a = pos(srcObj), b = pos(cpyObj); dx = b[0] - a[0]; dy = b[1] - a[1]; }
    const remap = new Map(), copies = [], rcopies = [];
    for (const s of sel) {
      const c = cloneShape(s); c.id = uid('d'); c.cx += dx; c.cy += dy;
      if (s.groupId) { if (!remap.has(s.groupId)) remap.set(s.groupId, uid('g')); c.groupId = remap.get(s.groupId); }
      copies.push(c);
    }
    for (const r of rs) rcopies.push({ ...r, id: uid('i'), x: r.x + dx, y: r.y + dy, colStep: [...r.colStep], rowStep: [...r.rowStep] });
    cellObj().shapes.push(...copies); cellObj().refs.push(...rcopies);
    ed.selection = new Set([...copies.map((c) => c.id), ...rcopies.map((r) => r.id)]);
    ed.dupMemo = { src: (sel.length ? sel[0] : rs[0]).id, copy: (sel.length ? copies[0] : rcopies[0]).id, key: [...copies, ...rcopies].map((o) => o.id).sort().join() };
    changed(repeat ? 'duplicated, same step again' : 'duplicated');
  }
  // ---------------------------------------------------------------- clipboard (Ctrl+C / Ctrl+X / Ctrl+V)
  // Paste puts the copies where the originals were (in place), the shapes on the ACTIVE layer: select,
  // Ctrl+X, pick another layer, Ctrl+V moves a selection to that layer. Instances keep their cell; one
  // that would place a cell inside itself is left out. Fused groups stay fused (new group ids).
  function copySelection(cut = false) {
    const sel = selectedShapes(), rs = selectedRefs();
    if (!sel.length && !rs.length) { toast('Nothing selected to ' + (cut ? 'cut' : 'copy') + '.'); return; }
    ed.clip = { shapes: sel.map((s) => cloneShape(s)), refs: rs.map((r) => ({ ...r, colStep: [...r.colStep], rowStep: [...r.rowStep] })), from: ed.cell };
    const n = sel.length + rs.length;
    if (cut) { deleteSelection(); toast(`Cut ${n} object${n > 1 ? 's' : ''}. Pick a layer (the radio button) and press <b>Ctrl+V</b> to paste them there.`); }
    else toast(`Copied ${n} object${n > 1 ? 's' : ''}. <b>Ctrl+V</b> pastes them in place on the active layer.`);
  }
  function pasteClip() {
    const c = ed.clip;
    if (!c || (!c.shapes.length && !c.refs.length)) { toast('Nothing to paste: copy (Ctrl+C) or cut (Ctrl+X) a selection first.'); return; }
    pushUndo();
    const remap = new Map(), copies = [], rcopies = [];
    for (const s of c.shapes) {
      const k = cloneShape(s); k.id = uid('p'); k.layer = ed.activeLayer;
      if (s.groupId) { if (!remap.has(s.groupId)) remap.set(s.groupId, uid('g')); k.groupId = remap.get(s.groupId); }
      copies.push(k);
    }
    let skipped = 0;
    for (const r of c.refs) { if (references(lib(), r.cell, ed.cell)) { skipped++; continue; } rcopies.push({ ...r, id: uid('i'), colStep: [...r.colStep], rowStep: [...r.rowStep] }); }
    cellObj().shapes.push(...copies); cellObj().refs.push(...rcopies);
    ed.selection = new Set([...copies.map((s) => s.id), ...rcopies.map((r) => r.id)]);
    const lname = layerOf(ed.activeLayer)?.name || ed.activeLayer;
    changed(`pasted ${copies.length + rcopies.length}${copies.length ? ` on ${lname}` : ''}`);
    if (skipped) toast(`${skipped} instance${skipped > 1 ? 's' : ''} left out: placing them here would put a cell inside itself.`);
  }
  // ---------------------------------------------------------------- arrange (right-click a selection)
  // Units: each fused object moves as one, each array/instance is one. Align and distribute work on
  // the units' bounding boxes; flip and rotate act about the centre of the whole selection.
  function arrangeUnits() {
    const m = new Map(), out = [];
    for (const sh of selectedShapes()) {
      const k = groupKeyOf(sh);
      if (!m.has(k)) { m.set(k, { sh: [], ref: null, bb: null }); out.push(m.get(k)); }
      const g = m.get(k); g.sh.push(sh); g.bb = unionBBox(g.bb, bboxWorld(sh));
    }
    for (const r of selectedRefs()) out.push({ sh: [], ref: r, bb: refBBox(lib(), r, ed.bboxCache) });
    return out.filter((g) => g.bb);
  }
  const moveUnit = (g, dx, dy) => { for (const sh of g.sh) { sh.cx += dx; sh.cy += dy; } if (g.ref) { g.ref.x += dx; g.ref.y += dy; } };
  const boxOf = (U) => ({ x1: Math.min(...U.map((g) => g.bb.x1)), x2: Math.max(...U.map((g) => g.bb.x2)), y1: Math.min(...U.map((g) => g.bb.y1)), y2: Math.max(...U.map((g) => g.bb.y2)) });
  const normDeg = (a) => ((a % 360) + 540) % 360 - 180;
  function alignSelection(k) {                       // l r t b cx cy  (y is up: top = largest y)
    const U = arrangeUnits(); if (U.length < 2) return;
    pushUndo();
    const w = boxOf(U);
    for (const g of U) {
      const b = g.bb;
      moveUnit(g,
        k === 'l' ? w.x1 - b.x1 : k === 'r' ? w.x2 - b.x2 : k === 'cx' ? (w.x1 + w.x2 - b.x1 - b.x2) / 2 : 0,
        k === 'b' ? w.y1 - b.y1 : k === 't' ? w.y2 - b.y2 : k === 'cy' ? (w.y1 + w.y2 - b.y1 - b.y2) / 2 : 0);
    }
    roundSelection(); changed('aligned');
  }
  function distributeSelection(ax) {                  // equal gaps; the two outermost stay put
    const U = arrangeUnits(); if (U.length < 3) return;
    pushUndo();
    const k1 = ax === 'x' ? 'x1' : 'y1', k2 = ax === 'x' ? 'x2' : 'y2';
    U.sort((a, b) => a.bb[k1] + a.bb[k2] - b.bb[k1] - b.bb[k2]);
    const first = U[0].bb, last = U[U.length - 1].bb;
    const total = U.reduce((t, g) => t + g.bb[k2] - g.bb[k1], 0), gap = (last[k2] - first[k1] - total) / (U.length - 1);
    let at = first[k2] + gap;
    for (let i = 1; i < U.length - 1; i++) {
      const g = U[i], d = at - g.bb[k1];
      at += g.bb[k2] - g.bb[k1] + gap;
      if (ax === 'x') moveUnit(g, d, 0); else moveUnit(g, 0, d);
    }
    roundSelection(); changed('distributed');
  }
  // Mirror about the selection's centre line. A shape's rotation negates and a polygon mirrors its
  // points; an instance toggles mirrorX (GDS: mirror about x before rotation) with rot -> 180-rot
  // (horizontal) or -rot (vertical), and its array step vectors mirror too.
  function flipSelection(ax) {
    const U = arrangeUnits(); if (!U.length) return;
    pushUndo();
    const w = boxOf(U), cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2, h = ax === 'h';
    for (const sh of selectedShapes()) {
      if (h) sh.cx = 2 * cx - sh.cx; else sh.cy = 2 * cy - sh.cy;
      sh.rot = normDeg(-(sh.rot || 0));
      if (sh.kind === 'poly') sh.pts = sh.pts.map(([x, y]) => (h ? [-x, y] : [x, -y])).reverse();
    }
    for (const r of selectedRefs()) {
      if (h) { r.x = 2 * cx - r.x; r.rot = normDeg(180 - (r.rot || 0)); r.colStep = [-r.colStep[0], r.colStep[1]]; r.rowStep = [-r.rowStep[0], r.rowStep[1]]; }
      else { r.y = 2 * cy - r.y; r.rot = normDeg(-(r.rot || 0)); r.colStep = [r.colStep[0], -r.colStep[1]]; r.rowStep = [r.rowStep[0], -r.rowStep[1]]; }
      r.mirrorX = !r.mirrorX;
    }
    roundSelection(); changed('flipped');
  }
  function rotateSelection(dir) {                     // +1 anticlockwise, -1 clockwise, about the selection centre
    const U = arrangeUnits(); if (!U.length) return;
    pushUndo();
    const w = boxOf(U), cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
    const R = (x, y) => (dir > 0 ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)]);
    const V = ([a, b]) => (dir > 0 ? [-b, a] : [b, -a]);
    for (const sh of selectedShapes()) { [sh.cx, sh.cy] = R(sh.cx, sh.cy); sh.rot = normDeg((sh.rot || 0) + 90 * dir); }
    for (const r of selectedRefs()) { [r.x, r.y] = R(r.x, r.y); r.rot = normDeg((r.rot || 0) + 90 * dir); r.colStep = V(r.colStep); r.rowStep = V(r.rowStep); }
    roundSelection(); changed('rotated');
  }
  function arrangeMenuItems() {
    const n = arrangeUnits().length;
    if (!n) return [];
    return ['-',
      { label: 'Align left', fn: () => alignSelection('l'), disabled: n < 2 },
      { label: 'Align right', fn: () => alignSelection('r'), disabled: n < 2 },
      { label: 'Align top', fn: () => alignSelection('t'), disabled: n < 2 },
      { label: 'Align bottom', fn: () => alignSelection('b'), disabled: n < 2 },
      { label: 'Align centres horizontally', fn: () => alignSelection('cx'), disabled: n < 2 },
      { label: 'Align centres vertically', fn: () => alignSelection('cy'), disabled: n < 2 },
      '-',
      { label: 'Distribute horizontally', fn: () => distributeSelection('x'), disabled: n < 3 },
      { label: 'Distribute vertically', fn: () => distributeSelection('y'), disabled: n < 3 },
      '-',
      { label: 'Flip horizontally', fn: () => flipSelection('h') },
      { label: 'Flip vertically', fn: () => flipSelection('v') },
      { label: 'Rotate 90° anticlockwise', fn: () => rotateSelection(1) },
      { label: 'Rotate 90° clockwise', fn: () => rotateSelection(-1) },
    ];
  }
  // Ctrl-drag lasso: everything the loop touches (an outline vertex, or an instance's corner or
  // centre, inside it), like the rubber band, which selects what it touches.
  function applyLassoSelect(P, additive) {
    if (P.length < 3) return;
    if (!additive) ed.selection.clear();
    const inP = (x, y) => {
      let n = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i], b = P[j];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) n = !n;
      }
      return n;
    };
    for (const sh of shapes()) if (layerVisible(sh.layer) && outlineWorld(sh, 2 * ed.s).some(([x, y]) => inP(x, y))) groupMembers(sh).forEach((t) => ed.selection.add(t.id));
    for (const r of refs()) {
      const b = refBBox(lib(), r, ed.bboxCache);
      if (b && [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2], [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]].some(([x, y]) => inP(x, y))) ed.selection.add(r.id);
    }
    updateSelectionUI();
  }

  function fuseSelection() {
    const sel = selectedShapes().filter((s) => !isDeviceLayer(s.layer)), keys = new Set(sel.map(groupKeyOf));   // device areas are never fused (E-list)
    if (keys.size < 2) return;
    const doses = sel.map((s) => s.dose || 0), dose = doses.reduce((a, b) => a + b, 0) / sel.length;
    const dMin = doses.reduce((m, v) => Math.min(m, v), Infinity), dMax = doses.reduce((m, v) => Math.max(m, v), -Infinity);   // no spread: large selections
    const varied = dMax - dMin > 1e-9;
    if (!confirm(`Fuse ${sel.length} shapes into one object?\n\nThey will share a single uniform dose of ${dose.toFixed(1)} µC/cm²`
      + (varied ? ` (the mean of ${dMin.toFixed(1)}–${dMax.toFixed(1)})` : '')
      + ', and any area where they overlap will be exposed once instead of twice.\n\nYou can reverse this with Un-fuse, or with Undo.')) return;
    pushUndo();
    const gid = uid('g');
    shapes().forEach((s) => { if (keys.has(groupKeyOf(s))) { s.groupId = gid; s.dose = dose; s.writeDose = null; } });
    ed.selection = new Set(shapes().filter((s) => s.groupId === gid).map((s) => s.id));
    changed('fused');
  }
  function splitSelection() {
    const sel = selectedShapes();
    if (!sel.some((s) => s.groupId)) return;
    pushUndo();
    const keys = new Set(sel.map(groupKeyOf));
    shapes().forEach((s) => { if (keys.has(groupKeyOf(s))) s.groupId = null; });
    changed('un-fused');
  }
  function setDoseOf(s, d) {
    if (d < 0) { toast('A dose cannot be negative — set to 0.'); d = 0; }
    const key = groupKeyOf(s);
    shapes().forEach((t) => { if (groupKeyOf(t) === key) { t.dose = d; t.writeDose = null; } });
  }
  function promptDose(s) {
    const v = prompt('Dose for this object (µC/cm²):', (s.dose ?? ed.nominalDose).toFixed(2));
    if (v === null) return;
    const d = parseFloat(v);
    if (!Number.isFinite(d)) return;
    pushUndo(); setDoseOf(s, d); changed('dose');
  }

  // ---------------------------------------------------------------- dialogs
  function openGeomDialog(s) {
    if (!s) return;
    const b = bboxLocal(s);
    let html = `<div class="two">${numField('gX', 'Centre X (µm)', umTxt(s.cx, 4), 0.01)}${numField('gY', 'Centre Y (µm)', umTxt(s.cy, 4), 0.01)}</div>`;
    if (s.kind === 'rect') html += `<div class="two">${numField('gW', 'Width W (µm)', umTxt(2 * s.hw, 4), 0.01)}${numField('gH', 'Length L (µm)', umTxt(2 * s.hh, 4), 0.01)}</div>`;
    else if (s.kind === 'circle') html += `<div class="two">${numField('gR', 'Radius (µm)', umTxt(s.r, 4), 0.01)}${numField('gD', 'Diameter (µm)', umTxt(2 * s.r, 4), 0.01)}</div>`;
    else html += `<div class="two">${numField('gW', 'Bounding W (µm)', umTxt(b.x2 - b.x1, 4), 0.01)}${numField('gH', 'Bounding L (µm)', umTxt(b.y2 - b.y1, 4), 0.01)}</div>`;
    html += `<div class="two">${numField('gRot', 'Rotation (°, counter-clockwise)', s.rot.toFixed(2), 1)}${numField('gDose', 'Dose (µC/cm²)', (s.dose ?? 0).toFixed(2), 1)}</div>`;
    html += `<div class="hint">${describe(s)}${s.groupId ? ' — part of a fused object; the dose applies to all its members.' : ''} Stored on a 1 nm grid.</div>`;
    openModal({
      title: 'Size & rotation', html,
      onOpen: (box) => {
        const r = box.querySelector('#gR'), d = box.querySelector('#gD');
        if (r && d) { r.oninput = () => (d.value = (2 * (parseFloat(r.value) || 0)).toFixed(4)); d.oninput = () => (r.value = ((parseFloat(d.value) || 0) / 2).toFixed(4)); }
      },
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Apply', primary: true, fn: (box) => {
            pushUndo();
            const g = (id) => readNum(box, id);
            const nx = g('gX'), ny = g('gY');
            if (nx !== null) s.cx = nx * 1000; if (ny !== null) s.cy = ny * 1000;
            const rot = g('gRot'); if (rot !== null) s.rot = rot;
            if (s.kind === 'rect') { const w = g('gW'), h = g('gH'); if (w !== null) s.hw = Math.max(w * 1000, 1) / 2; if (h !== null) s.hh = Math.max(h * 1000, 1) / 2; }
            else if (s.kind === 'circle') { const r = g('gR'); if (r !== null) s.r = Math.max(r * 1000, 1); }
            else {
              const w = g('gW'), h = g('gH'), bb = bboxLocal(s);
              if (w !== null && bb.x2 - bb.x1 > 1e-9) { const k = Math.max(w * 1000, 1) / (bb.x2 - bb.x1); s.pts.forEach((p) => (p[0] *= k)); }
              if (h !== null && bb.y2 - bb.y1 > 1e-9) { const k = Math.max(h * 1000, 1) / (bb.y2 - bb.y1); s.pts.forEach((p) => (p[1] *= k)); }
            }
            roundToDbu(s);
            const dose = g('gDose'); if (dose !== null) setDoseOf(s, dose);
            changed('geometry edited');
          },
        },
      ],
    });
  }

  // the selected refs form exactly one dose-ramp group → its first ref
  function selectedRampGroup() {
    const rs = selectedRefs();
    if (!rs.length || selectedShapes().length || !rs[0].ramp) return null;
    const g = rs[0].ramp.group;
    return rs.every((r) => r.ramp && r.ramp.group === g) ? rs[0] : null;
  }
  function openRampDialog(r0) {
    const m = r0.ramp, group = m.group;
    const html = `<div class="hint" style="margin-bottom:8px;">Dose-ramp array of cell <b>${esc(r0.cell)}</b>: ${rampGroupRefs(cellObj(), group).length} dose steps, base dose ${m.base} µC/cm².</div>`
      + `<div class="two">${numField('aCols', 'Columns', m.cols, 1, 'min="1"')}${numField('aRows', 'Rows', m.rows, 1, 'min="1"')}</div>`
      + `<div class="two">${numField('aPx', 'Pitch X (µm)', umTxt(m.pitchX, 4), 0.01)}${numField('aPy', 'Pitch Y (µm)', umTxt(m.pitchY, 4), 0.01)}</div>`
      + `<div style="margin-top:10px;">${rampBlock('aRx', 'along x (left → right)', m.rampX, m.base)}${rampBlock('aRy', 'along y (top → bottom)', m.rampY, m.base)}</div>` + RAMP_HINT;
    openModal({
      title: 'Dose-ramp array', html,
      buttons: [
        { label: 'Edit cell', left: true, fn: () => { editCell(r0.cell); } },
        { label: 'Explode', left: true, fn: () => { try { pushUndo(); const ids = []; for (const r of rampGroupRefs(cellObj(), group)) { const o = explodeRef(lib(), ed.cell, r.id); ids.push(...o.shapes.map((s) => s.id), ...o.refs.map((x) => x.id)); } ed.selection = new Set(ids); changed('exploded'); } catch (e) { dropLastUndo(); alert(e.message); } } },
        { label: 'Cancel' },
        {
          label: 'Apply', primary: true, fn: (box) => {
            const cols = Math.max(1, Math.round(readNum(box, 'aCols') ?? m.cols)), rows = Math.max(1, Math.round(readNum(box, 'aRows') ?? m.rows));
            const px = Math.round((readNum(box, 'aPx') ?? m.pitchX / 1000) * 1000), py = Math.round((readNum(box, 'aPy') ?? m.pitchY / 1000) * 1000);
            pushUndo();
            let refs;
            try { refs = updateRampArray(lib(), ed.cell, group, { cols, rows, pitchX: px, pitchY: py, rampX: readRamp(box, 'aRx'), rampY: readRamp(box, 'aRy') }); }
            catch (err) { dropLastUndo(); alert(err.message); return false; }
            ed.selection = new Set(refs.map((r) => r.id));
            changed('dose ramp edited');
          },
        },
      ],
    });
  }
  function openRefDialog(r) {
    if (r.ramp) { openRampDialog(r); return; }
    const st = flatStats(lib(), r.cell, statsMemo());
    const html = `<div class="hint" style="margin-bottom:8px;">Instance of cell <b>${esc(r.cell)}</b> (${st.shapes.toLocaleString()} shapes per element)</div>`
      + `<div class="two">${numField('rX', 'Origin X (µm)', umTxt(r.x, 4), 0.01)}${numField('rY', 'Origin Y (µm)', umTxt(r.y, 4), 0.01)}</div>`
      + `<div class="two">${numField('rRot', 'Rotation (°)', r.rot, 1)}${numField('rMag', 'Magnification', r.mag, 0.1, 'min="0.0001"')}</div>`
      + `<label class="check"><input type="checkbox" id="rMir" ${r.mirrorX ? 'checked' : ''}> Mirror about the x axis (applied before rotation, as in GDS)</label>`
      + `<div class="two">${numField('rCols', 'Columns', r.cols, 1, 'min="1"')}${numField('rRows', 'Rows', r.rows, 1, 'min="1"')}</div>`
      + `<div class="two">${numField('rCx', 'Column step X (µm)', umTxt(r.colStep[0], 4), 0.01)}${numField('rCy', 'Column step Y (µm)', umTxt(r.colStep[1], 4), 0.01)}</div>`
      + `<div class="two">${numField('rRx', 'Row step X (µm)', umTxt(r.rowStep[0], 4), 0.01)}${numField('rRy', 'Row step Y (µm)', umTxt(r.rowStep[1], 4), 0.01)}</div>`
      + `<div class="hint">An array is stored once, however many elements it has. Column and row steps are in the parent's coordinates, as in a GDS AREF.</div>`;
    openModal({
      title: r.cols * r.rows > 1 ? 'Array properties' : 'Instance properties', html,
      buttons: [
        { label: 'Edit cell', left: true, fn: () => { editCell(r.cell); } },
        { label: 'Explode', left: true, fn: () => explode(r) },
        { label: 'Cancel' },
        {
          label: 'Apply', primary: true, fn: (box) => {
            const g = (id) => readNum(box, id);
            const cols = Math.max(1, Math.round(g('rCols') ?? r.cols)), rows = Math.max(1, Math.round(g('rRows') ?? r.rows));
            if (cols * rows > 1e8) { alert('More than 10⁸ elements in one array is not supported.'); return false; }
            pushUndo();
            r.x = Math.round((g('rX') ?? r.x / 1000) * 1000); r.y = Math.round((g('rY') ?? r.y / 1000) * 1000);
            r.rot = g('rRot') ?? r.rot; r.mag = Math.max(1e-4, g('rMag') ?? r.mag);
            r.mirrorX = box.querySelector('#rMir').checked;
            r.cols = cols; r.rows = rows;
            r.colStep = [Math.round((g('rCx') ?? 0) * 1000), Math.round((g('rCy') ?? 0) * 1000)];
            r.rowStep = [Math.round((g('rRx') ?? 0) * 1000), Math.round((g('rRy') ?? 0) * 1000)];
            changed('instance edited');
          },
        },
      ],
    });
  }

  function explode(r) {
    try {
      pushUndo();
      const out = explodeRef(lib(), ed.cell, r.id);
      ed.selection = new Set([...out.shapes.map((s) => s.id), ...out.refs.map((x) => x.id)]);
      changed('exploded');
    } catch (e) { dropLastUndo(); alert(e.message); }
  }

  function openArrayDialog() {
    const sel = selectedShapes(), rs = selectedRefs();
    const rg = selectedRampGroup();
    if (rg) { openRampDialog(rg); return; }
    if (rs.length === 1 && !sel.length) { openRefDialog(rs[0]); return; }
    if (!sel.length) return;
    let bb = null; for (const s of sel) bb = unionBBox(bb, bboxWorld(s));
    const w = bb.x2 - bb.x1, h = bb.y2 - bb.y1;
    const html = `<div class="hint" style="margin-bottom:8px;">The ${sel.length} selected shape${sel.length === 1 ? '' : 's'} move into a new cell, which is placed back as an array whose first element sits exactly where they were. Elements repeat to the right (columns) and upwards (rows).</div>`
      + `<div class="two">${numField('aCols', 'Columns', 10, 1, 'min="1"')}${numField('aRows', 'Rows', 10, 1, 'min="1"')}</div>`
      + `<div class="two">${numField('aPx', 'Pitch X (µm)', umTxt(Math.max(2 * w, 1), 3), 0.01)}${numField('aPy', 'Pitch Y (µm)', umTxt(Math.max(2 * h, 1), 3), 0.01)}</div>`
      + `<div><div class="label">Cell name</div><input class="field" id="aName" value="${esc(uniqueCellName(lib(), 'ARRAY'))}"></div>`
      + `<div style="margin-top:10px;">${rampBlock('aRx', 'along x (left → right)', null, sel[0].dose || ed.nominalDose)}${rampBlock('aRy', 'along y (top → bottom)', null, sel[0].dose || ed.nominalDose)}</div>` + RAMP_HINT;
    openModal({
      title: 'Make array', html,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Make array', primary: true, fn: (box) => {
            const cols = Math.max(1, Math.round(readNum(box, 'aCols') ?? 1)), rows = Math.max(1, Math.round(readNum(box, 'aRows') ?? 1));
            const px = Math.round((readNum(box, 'aPx') ?? 1) * 1000), py = Math.round((readNum(box, 'aPy') ?? 1) * 1000);
            if (cols * rows > 1e8) { alert('More than 10⁸ elements in one array is not supported.'); return false; }
            const name = box.querySelector('#aName').value.trim() || 'ARRAY';
            const rampX = readRamp(box, 'aRx'), rampY = readRamp(box, 'aRy');
            pushUndo();
            const ids = new Set();
            sel.forEach((s) => groupMembers(s).forEach((t) => ids.add(t.id)));
            let out;
            try { out = makeRampArray(lib(), ed.cell, ids, { cols, rows, pitchX: px, pitchY: py, name, rampX, rampY }); }
            catch (err) { dropLastUndo(); alert(err.message); return false; }
            ed.selection = new Set(out.refs.map((r) => r.id));
            changed('array made');
            toast(rampX || rampY
              ? `Cell <b>${esc(out.cell)}</b> placed as a ${cols} × ${rows} dose-ramp array: ${out.refs.length} dose steps (${esc(describeRamp(out.refs[0].ramp))}).`
              : `Cell <b>${esc(out.cell)}</b> placed as a ${cols} × ${rows} array (${(cols * rows).toLocaleString()} elements, stored once).`, 6000);
          },
        },
      ],
    });
  }

  function openHelp() {
    openModal({
      title: 'Controls & shortcuts', narrow: false, buttons: [{ label: 'Close', primary: true }],
      html: `<p class="hint" style="margin-top:0;">Pick a tool, then drag. The tool only changes what dragging on <i>empty space</i> does — selecting, moving and editing work identically in all of them. Coordinates are in µm with <b>y pointing up</b> (as in GDS, CleWin and L-Edit).</p>
      <h3>The tool decides what a drag does</h3><table class="keytab">
      <tr><td><b>Select</b> <kbd>1</kbd></td><td>Drag on empty space pulls a rubber-band box and selects every shape and instance it touches.</td></tr>
      <tr><td><b>Rectangle</b> <kbd>2</kbd></td><td>Drag draws a rectangle, corner to corner. With <i>Fixed size</i> on it stamps a W×L rectangle instead.</td></tr>
      <tr><td><b>Circle</b> <kbd>3</kbd></td><td>Drag draws a circle from its centre outwards.</td></tr>
      <tr><td><b>Polygon</b> <kbd>4</kbd></td><td>Drag traces a freehand outline (simplified on release), or click corner by corner and close with <kbd>Enter</kbd>, a double-click, or by clicking the first corner.</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Back to Select, and cancels whatever was being drawn or placed.</td></tr></table>
      <h3>Selecting and editing</h3><table class="keytab">
      <tr><td><b>Click</b> a shape or array</td><td>Selects it. Clicking empty space deselects.</td></tr>
      <tr><td><kbd>Shift</kbd> + click / drag</td><td>Adds to or removes from the selection; Shift-drag is a rubber band that adds.</td></tr>
      <tr><td><b>Right-drag</b></td><td>Rubber-band box in any tool. Releasing without moving opens the menu.</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>A</kbd></td><td>Selects everything in the cell being edited.</td></tr>
      <tr><td><b>Drag</b> a shape or array</td><td>Moves it with the rest of the selection. In a drawing tool, drag a shape's <b>edge</b> to move it. With snap on, the selection's <b>upper-left corner</b> lands on the grid (resizing snaps the corner you drag).</td></tr>
      <tr><td><b>Corner handles</b></td><td>Rectangle corners resize, circle handles set the radius, polygon handles move single corners.</td></tr>
      <tr><td><b>Handle above a shape</b></td><td>Rotates it; <kbd>Shift</kbd> snaps to 15°.</td></tr>
      <tr><td><b>Double-click</b></td><td>Exact size &amp; rotation (shape) or properties (array).</td></tr>
      <tr><td><kbd>Del</kbd> · <kbd>Ctrl</kbd>+<kbd>D</kbd> · arrows</td><td>Delete · duplicate · nudge by one grid step (<kbd>Shift</kbd> = ten). Move the first copy where you want it, and every further <kbd>Ctrl</kbd>+<kbd>D</kbd> repeats that step — a manual array.</td></tr>
      <tr><td><kbd>Ctrl</kbd>+drag</td><td>Lasso: selects everything the loop touches (<kbd>Ctrl</kbd>+<kbd>Shift</kbd> adds).</td></tr>
      <tr><td><b>Right-click</b> a selection</td><td>Align (left, right, top, bottom, centres), distribute, flip and rotate 90°. Fused objects move as one.</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td>Undo / redo.</td></tr></table>
      <h3>Fusing, arrays and cells</h3><table class="keytab">
      <tr><td><b>Fuse</b> / <b>Un-fuse</b></td><td>Fused shapes form one object with one uniform dose; overlaps are exposed once.</td></tr>
      <tr><td><b>Array…</b></td><td>Moves the selected shapes into a new <b>cell</b> and places it back as a columns × rows array. The array is stored once, so 10⁶ elements cost no more memory than one. Far away, arrays are drawn as a tinted area whose density shows the fill factor; zoom in to see the elements.</td></tr>
      <tr><td><b>Dose ramp</b> (Array…)</td><td>Optional dose steps along x (left → right) and/or y (top → bottom), linear or logarithmic, in µC/cm² or × the shape dose — a dose test. Clicking any step selects the whole ramp; <i>Properties…</i> changes it; each step is labelled with its dose.</td></tr>
      <tr><td><b>Cells panel</b></td><td><b>Edit</b> opens a cell (changes appear in every instance), <b>Place</b> drops instances with each click, <b>Explode</b> (array menu) turns an instance back into plain shapes.</td></tr>
      <tr><td><b>Layers panel</b></td><td>GDS layer/datatype pairs. New shapes go on the active layer; hidden layers can't be picked.</td></tr></table>
      <h3>Navigating</h3><table class="keytab">
      <tr><td><b>Wheel</b></td><td>Zoom around the pointer.</td></tr>
      <tr><td>hold <kbd>Space</kbd> + drag, <kbd>Alt</kbd>+drag, middle-drag</td><td>Pan.</td></tr>
      <tr><td><kbd>F</kbd> / <kbd>R</kbd> / <kbd>G</kbd></td><td>Fit view / reset view / toggle snap.</td></tr></table>`,
    });
  }

  // ---------------------------------------------------------------- cells
  function editCell(name) {
    if (!lib().cells[name] || name === ed.cell) return;
    ed.cellStack.push(ed.cell);
    ed.cell = name; ed.cellPick = name;
    ed.selection.clear(); ed.draft = null; ed.pendingPoly = null;
    invalidateCaches(); updateSelectionUI(); updateCellList();
    fitView();
  }
  function backToParent() {
    ed.cell = ed.cellStack.pop() || lib().top;
    if (!lib().cells[ed.cell]) ed.cell = lib().top;
    ed.cellPick = ed.cell; ed.selection.clear();
    invalidateCaches(); updateSelectionUI(); updateCellList(); fitView();
  }

  // ---------------------------------------------------------------- tools
  const TOOL_HINT = {
    select: 'drag on empty space → rubber-band select',
    rect: 'drag on empty space → new rectangle',
    circle: 'drag on empty space → new circle (centre outwards)',
    poly: 'drag → freehand outline, or click corner by corner',
    device: 'drag on empty space → new device area for Fab Studio (not exposed)',
    place: 'click to place the cell · Esc to stop',
  };
  function setTool(t, cell) {
    ed.tool = t;
    if (t !== 'poly') ed.pendingPoly = null;
    ed.placeCell = t === 'place' ? cell : null;
    for (const [id, k] of [['toolSelect', 'select'], ['toolRect', 'rect'], ['toolCircle', 'circle'], ['toolPoly', 'poly'], ['toolDevice', 'device']]) $(id).classList.toggle('active', k === t);
    $('toolHint').textContent = t === 'place' ? `click to place ${cell} · Esc to stop` : TOOL_HINT[t] || '';
    canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
    scheduleRender();
  }

  function startDraw(down, kind) {
    const dose = ed.nominalDose, L = ed.activeLayer;
    if (kind === 'device') {
      const p = snapPt(down);
      ed.draft = makeRect(p.x, p.y, 0.1, 0.1, 0, ensureDeviceLayer());
      ed.drag = { kind: 'drawRect', start: p };
    } else if (kind === 'circle') {
      ed.draft = makeCircle(snapV(down.x), snapV(down.y), 0.1, dose, L);
      ed.drag = { kind: 'drawCircle', centre: { x: ed.draft.cx, y: ed.draft.cy } };
    } else if (ed.fixed) {
      const W = ed.fixedW * 1000, H = ed.fixedL * 1000;
      ed.draft = makeRect(snapV(down.x) + W / 2, snapV(down.y) - H / 2, W / 2, H / 2, dose, L);
      ed.drag = { kind: 'stamp' };
    } else {
      const p = snapPt(down);
      ed.draft = makeRect(p.x, p.y, 0.1, 0.1, dose, L);
      ed.drag = { kind: 'drawRect', start: p };
    }
  }
  function updateDraw(w) {
    const d = ed.draft, g = ed.drag;
    if (!d || !g) return;
    if (g.kind === 'drawRect') {
      const p = snapPt(w);
      d.cx = (g.start.x + p.x) / 2; d.cy = (g.start.y + p.y) / 2;
      d.hw = Math.max(Math.abs(p.x - g.start.x) / 2, 0.1); d.hh = Math.max(Math.abs(p.y - g.start.y) / 2, 0.1);
    } else if (g.kind === 'drawCircle') {
      d.r = Math.max(Math.hypot(w.x - g.centre.x, w.y - g.centre.y), 0.1);
      if (ed.snap) d.r = Math.max(snapV(d.r), gridNm() / 2);
    } else if (g.kind === 'stamp') {
      const p = snapPt(w), W = ed.fixedW * 1000, H = ed.fixedL * 1000;
      d.cx = p.x + W / 2; d.cy = p.y - H / 2;
    }
  }

  function beginMarquee(w, additive) {
    ed.drag = { kind: 'marquee', start: w, shift: additive };
    ed.marquee = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    if (!additive) { ed.selection.clear(); updateSelectionUI(); }
  }
  function applyMarquee(additive) {
    const m = ed.marquee;
    if (!m) return;
    const box = { x1: Math.min(m.x1, m.x2), x2: Math.max(m.x1, m.x2), y1: Math.min(m.y1, m.y2), y2: Math.max(m.y1, m.y2) };
    if (box.x2 - box.x1 < 1e-9 && box.y2 - box.y1 < 1e-9) return;
    if (!additive) ed.selection.clear();
    const hit = (bb) => bb && bb.x2 >= box.x1 && bb.x1 <= box.x2 && bb.y2 >= box.y1 && bb.y1 <= box.y2;
    for (const s of shapes()) if (layerVisible(s.layer) && hit(bboxWorld(s))) groupMembers(s).forEach((t) => ed.selection.add(t.id));
    for (const r of refs()) if (hit(refBBox(lib(), r, ed.bboxCache))) ed.selection.add(r.id);
    updateSelectionUI();
  }

  function closePendingPoly() {
    if (ed.pendingPoly && ed.pendingPoly.pts.length >= 3) {
      pushUndo();
      const p = roundToDbu(makePoly(ed.pendingPoly.pts.map((q) => [q.x, q.y]), ed.nominalDose, ed.activeLayer));
      shapes().push(p); ed.selection = new Set([p.id]);
    }
    ed.pendingPoly = null;
    changed('polygon');
  }

  // The selection moves as one block. With snap on, the upper-left corner of its bounding box
  // lands on the grid (Peter: corners, not centres; upper left takes precedence) and every object
  // gets the same offset, so their arrangement is kept exactly.
  function moveOrig() {
    const items = [...selectedShapes().map((s) => ({ o: s, x: s.cx, y: s.cy })), ...selectedRefs().map((r) => ({ o: r, x: r.x, y: r.y, ref: true }))];
    let bb = null;
    for (const s of selectedShapes()) bb = unionBBox(bb, bboxWorld(s));
    for (const r of selectedRefs()) bb = unionBBox(bb, refBBox(lib(), r, ed.bboxCache));
    items.anchor = bb ? { x: bb.x1, y: bb.y2 } : null;               // upper left (y is up)
    return items;
  }
  function applyMove(orig, dx, dy) {
    if (ed.snap && orig.anchor) { dx = snapV(orig.anchor.x + dx) - orig.anchor.x; dy = snapV(orig.anchor.y + dy) - orig.anchor.y; }
    for (const m of orig) {
      const nx = m.x + dx, ny = m.y + dy;
      if (m.ref) { m.o.x = nx; m.o.y = ny; } else { m.o.cx = nx; m.o.cy = ny; }
    }
  }
  const s0IsAxisAligned = (s) => !s.rot || Math.abs(((s.rot % 90) + 90) % 90) < 1e-9;
  function roundSelection() {
    for (const s of selectedShapes()) roundToDbu(s);
    for (const r of selectedRefs()) { r.x = Math.round(r.x); r.y = Math.round(r.y); }
  }

  // ---------------------------------------------------------------- mouse
  const evPt = (e) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function openContextMenuAt(w, cx, cy) {
    const h = hitAny(w);
    if (h && !(h.type === 'shape' ? ed.selection.has(h.s.id) : ed.selection.has(h.ref.id))) selectObj(h, false);
    let items;
    if (h && h.type === 'shape') {
      const s = h.s;
      items = [
        { label: 'Size & rotation…', fn: () => openGeomDialog(s) },
        { label: 'Set dose…', fn: () => promptDose(s) },
        '-',
        { label: 'Duplicate', fn: duplicateSelection },
        { label: 'Fuse selected', fn: fuseSelection, disabled: new Set(selectedShapes().map(groupKeyOf)).size < 2 },
        { label: 'Un-fuse', fn: splitSelection, disabled: !s.groupId },
        { label: 'Make array…', fn: openArrayDialog },
        '-',
        { label: 'Delete', fn: deleteSelection },
      ];
    } else if (h) {
      const r = h.ref;
      items = [
        { label: r.cols * r.rows > 1 ? 'Array properties…' : 'Instance properties…', fn: () => openRefDialog(r) },
        { label: `Edit cell ${r.cell}`, fn: () => editCell(r.cell) },
        { label: 'Explode into shapes', fn: () => explode(r), disabled: r.cols * r.rows > 20000 },
        '-',
        { label: 'Duplicate', fn: duplicateSelection },
        { label: 'Delete', fn: deleteSelection },
      ];
    } else {
      items = [
        {
          label: 'Rectangle here…', fn: () => {
            pushUndo();
            const r = roundToDbu(makeRect(snapV(w.x), snapV(w.y), (ed.fixedW * 1000) / 2, (ed.fixedL * 1000) / 2, ed.nominalDose, ed.activeLayer));
            shapes().push(r); ed.selection = new Set([r.id]); changed('rectangle added'); openGeomDialog(r);
          },
        },
        '-',
        { label: 'Fit view', fn: fitView },
        { label: 'Reset view', fn: resetView },
        ...(ed.cell !== lib().top ? ['-', { label: 'Back to parent cell', fn: backToParent }] : []),
        '-',
        { label: 'Delete all in this cell', fn: deleteAll },
      ];
    }
    items.push(...arrangeMenuItems());
    openMenu(cx, cy, items);
    scheduleRender();
  }

  canvas.addEventListener('mousedown', (e) => {
    closeMenu();
    canvas.focus({ preventScroll: true });
    const { sx, sy } = evPt(e), w = s2w(sx, sy);
    if (e.button === 2) { ed.drag = { kind: 'rightPress', down: w, sx, sy, clientX: e.clientX, clientY: e.clientY, shift: e.shiftKey }; e.preventDefault(); return; }
    if (e.button === 1 || e.altKey || (e.button === 0 && ed.spaceHeld)) { ed.drag = { kind: 'pan', sx, sy, o0: { x: ed.ox, y: ed.oy } }; canvas.style.cursor = 'grabbing'; e.preventDefault(); return; }
    if (e.button !== 0) return;

    if (ed.tool === 'place') {
      const p = snapPt(w);
      try { pushUndo(); const r = placeCell(lib(), ed.cell, ed.placeCell, p.x, p.y); ed.selection = new Set([r.id]); changed('cell placed'); }
      catch (err) { dropLastUndo(); toast(esc(err.message)); }
      return;
    }
    if (ed.pendingPoly && ed.tool === 'poly' && !e.shiftKey) { ed.drag = { kind: 'lasso', pts: [w], moved: false, down: w }; return; }
    if (hitLineHandle(w)) return;

    const h = e.shiftKey ? null : hitHandle(w);
    if (h) {
      pushUndo();
      if (h.kind === 'rot') ed.drag = { kind: 'rot', shape: h.shape, rot0: h.shape.rot, ang0: Math.atan2(w.y - h.shape.cy, w.x - h.shape.cx) };
      else ed.drag = { kind: 'corner', shape: h.shape, index: h.index };
      return;
    }
    // with the Device-area tool, drawing over the pattern is the normal use: only device areas can
    // be grabbed, exposed shapes and arrays underneath are left alone
    if (ed.tool === 'select' && (e.ctrlKey || e.metaKey)) {   // lasso selection
      ed.drag = { kind: 'selLasso', pts: [w], shift: e.shiftKey }; ed.selLasso = ed.drag.pts;
      if (!e.shiftKey) { ed.selection.clear(); updateSelectionUI(); }
      scheduleRender();
      return;
    }
    const devTool = ed.tool === 'device';
    // an exposed shape's edge first; a device area's edge only if nothing else is under the pointer
    let edge = e.shiftKey ? null : hitEdge(w, false);
    if (!edge && !e.shiftKey) { const under = hitAny(w); if (under && under.type === 'shape' && isDeviceLayer(under.s.layer)) edge = hitEdge(w, true); }
    // the Device-area tool works on device areas: they are picked first, whatever lies under them (E5)
    if (devTool) edge = e.shiftKey ? null : hitEdge(w, true);
    if (edge) {
      if (!ed.selection.has(edge.id)) selectObj({ type: 'shape', s: edge }, false);
      pushUndo();
      ed.drag = { kind: 'move', start: w, moved: false, orig: moveOrig(), sx, sy };
      scheduleRender();
      return;
    }
    let on = devTool ? hitAll(w).find((h) => h.type === 'shape' && isDeviceLayer(h.s.layer)) || null : hitAny(w);
    if (on) { ed.drag = { kind: 'pick', hit: on, add: e.shiftKey, sx, sy, down: w }; return; }

    if (e.shiftKey || ed.tool === 'select') { beginMarquee(w, e.shiftKey); return; }
    if (ed.tool === 'poly') { ed.drag = { kind: 'lasso', pts: [w], moved: false, down: w }; return; }
    ed.selection.clear(); updateSelectionUI();
    pushUndo();
    startDraw(w, ed.tool);
    updateDraw(w);
    scheduleRender();
  });

  // Δx, Δy of the rectangle or circle being drawn or resized: beside the cursor and in the status bar
  const sizeTag = (() => { const t = document.createElement('div'); t.id = 'drawSize'; t.style.cssText = 'position:fixed;z-index:50;pointer-events:none;background:rgba(17,24,39,.88);color:#fff;font:600 12px system-ui;padding:3px 7px;border-radius:6px;white-space:nowrap;display:none;'; document.body.appendChild(t); return t; })();
  const lenTxt = (nm) => (nm >= 1000 ? `${umTxt(nm)} µm` : `${nm.toFixed(1)} nm`);
  function drawSizeText() {
    const d = ed.drag; if (!d) return null;
    const sh = d.kind === 'drawRect' || d.kind === 'drawCircle' || d.kind === 'stamp' ? ed.draft : d.kind === 'corner' ? d.shape : null;
    if (!sh) return null;
    if (sh.kind === 'rect') return `Δx ${lenTxt(2 * sh.hw)} · Δy ${lenTxt(2 * sh.hh)}${sh.rot ? ` (rotated ${(+sh.rot).toFixed(0)}°)` : ''}`;
    if (sh.kind === 'circle') return `Δx = Δy = Ø ${lenTxt(2 * sh.r)}`;
    return null;
  }
  function showDrawSize(e) {
    const t = drawSizeText();
    if (!t) { sizeTag.style.display = 'none'; return; }
    sizeTag.textContent = t; sizeTag.style.display = 'block';
    sizeTag.style.left = `${e.clientX + 16}px`; sizeTag.style.top = `${e.clientY + 18}px`;
    $('stCursor').innerHTML += ` · <b>${t}</b>`;
  }
  window.addEventListener('pointerup', () => { sizeTag.style.display = 'none'; });

  function onPointerMove(e) {
    const { sx, sy } = evPt(e), w = s2w(sx, sy);
    ed.hover = w;
    $('stCursor').innerHTML = `x <b>${umTxt(w.x)}</b> µm, y <b>${umTxt(w.y)}</b> µm`;
    queueMicrotask(() => showDrawSize(e));
    const d = ed.drag;
    if (!d) {
      if (ed.pendingPoly) { ed.pendingPoly.cursor = w; scheduleRender(); }
      if (ed.tool === 'place') { scheduleRender(); return; }
      let c = ed.tool === 'select' ? 'default' : 'crosshair';
      if (e.altKey || ed.spaceHeld) c = 'grab';
      else if (hitHandle(w)) c = 'pointer';
      else if (hitEdge(w) || (ed.tool === 'select' && hitAny(w))) c = 'move';
      canvas.style.cursor = c;
      return;
    }
    switch (d.kind) {
      case 'rightPress':
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) { d.kind = 'marquee'; d.start = d.down; ed.marquee = { x1: d.down.x, y1: d.down.y, x2: w.x, y2: w.y }; scheduleRender(); }
        break;
      case 'selLasso': { const last = d.pts[d.pts.length - 1]; if (Math.hypot(w.x - last.x, w.y - last.y) > 2 * ed.s) d.pts.push(w); scheduleRender(); break; }
      case 'marquee': ed.marquee.x2 = w.x; ed.marquee.y2 = w.y; scheduleRender(); break;
      case 'pick': {
        if (Math.hypot(sx - d.sx, sy - d.sy) <= 4) break;
        if (d.add) { beginMarquee(d.down, true); ed.marquee.x2 = w.x; ed.marquee.y2 = w.y; }
        else if (ed.tool === 'select') {
          const isSel = d.hit.type === 'shape' ? ed.selection.has(d.hit.s.id) : ed.selection.has(d.hit.ref.id);
          if (!isSel) selectObj(d.hit, false);
          pushUndo();
          ed.drag = { kind: 'move', start: d.down, moved: true, orig: moveOrig() };
          applyMove(ed.drag.orig, w.x - d.down.x, w.y - d.down.y);
          changed('moving', true);
          break;
        } else if (ed.tool === 'poly') { ed.selection.clear(); updateSelectionUI(); ed.drag = { kind: 'lasso', pts: [d.down, w], moved: true, down: d.down }; }
        else { ed.selection.clear(); updateSelectionUI(); pushUndo(); startDraw(d.down, ed.tool); updateDraw(w); }
        scheduleRender();
        break;
      }
      case 'pan': interacting(); ed.ox = d.o0.x - (sx - d.sx) * ed.s; ed.oy = d.o0.y + (sy - d.sy) * ed.s; scheduleRender(); break;
      case 'move': {
        // a click is not a move: start only after a real drag (with snap on, a zero move would
        // still snap the object somewhere else — E4)
        if (!d.moved && d.sx != null && Math.hypot(sx - d.sx, sy - d.sy) <= 3) break;
        const dx = w.x - d.start.x, dy = w.y - d.start.y;
        if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) d.moved = true;
        applyMove(d.orig, dx, dy);
        changed('moving', true);
        break;
      }
      case 'corner': {
        // snap the corner being dragged (not the centre): it lands on the grid, the opposite one stays
        const ws = ed.snap && s0IsAxisAligned(d.shape) ? snapPt(w) : w;
        const s = d.shape, [px, py] = toLocal(s, ws.x, ws.y);
        if (s.kind === 'rect') {
          const hs = handlesLocal(s), opp = hs[(d.index + 2) % 4];
          const [cx, cy] = toWorld(s, (px + opp[0]) / 2, (py + opp[1]) / 2);
          s.hw = Math.max(Math.abs(px - opp[0]) / 2, 0.5); s.hh = Math.max(Math.abs(py - opp[1]) / 2, 0.5);
          s.cx = cx; s.cy = cy;
        } else if (s.kind === 'circle') s.r = Math.max(Math.hypot(px, py), 0.5);
        else s.pts[d.index] = [px, py];
        changed('reshaping', true);
        break;
      }
      case 'rot': {
        const s = d.shape;
        let ang = d.rot0 + ((Math.atan2(w.y - s.cy, w.x - s.cx) - d.ang0) * 180) / Math.PI;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        s.rot = ((ang % 360) + 540) % 360 - 180;
        changed('rotating', true);
        break;
      }
      case 'drawRect': case 'drawCircle': case 'stamp': updateDraw(w); scheduleRender(); break;
      case 'lasso': {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) > 1.5 * ed.s) { d.pts.push(w); d.moved = true; }
        if (d.pts.length > 2) ed.draft = makePoly(d.pts.map((p) => [p.x, p.y]), ed.nominalDose, ed.activeLayer);
        scheduleRender();
        break;
      }
      default: break;
    }
  }
  // hover over the canvas; while dragging, follow the pointer anywhere in the window
  canvas.addEventListener('mousemove', (e) => { if (!ed.drag) onPointerMove(e); });
  window.addEventListener('mousemove', (e) => { if (ed.drag) onPointerMove(e); });

  window.addEventListener('mouseup', (e) => {
    if (!ed.drag) return;
    // Browsers coalesce mouse moves per frame, so the release position can be newer than the
    // last move we saw: apply it before finishing the drag.
    if (ed.drag.kind !== 'rightPress' && ed.drag.kind !== 'pick' && ed.drag.kind !== 'pan') onPointerMove(e);
    const d = ed.drag;
    if (!d) return;
    ed.drag = null;
    canvas.style.cursor = ed.spaceHeld ? 'grab' : ed.tool === 'select' ? 'default' : 'crosshair';
    if (d.kind === 'rightPress') { openContextMenuAt(d.down, d.clientX, d.clientY); return; }
    if (d.kind === 'selLasso') { applyLassoSelect(d.pts, d.shift); ed.selLasso = null; scheduleRender(); return; }
    if (d.kind === 'marquee') { applyMarquee(d.shift); ed.marquee = null; scheduleRender(); return; }
    if (d.kind === 'pick') {
      // clicking again at the same spot steps to the object underneath (shape → array → device area …)
      let hit = d.hit;
      if (!d.add) {
        const all = hitAll(d.down), idOf = (h) => (h.type === 'shape' ? h.s.id : h.ref.id);
        const again = lastPick && Math.hypot(d.sx - lastPick.sx, d.sy - lastPick.sy) < 5 && all.length > 1 && ed.selection.has(lastPick.id);
        const k = again ? (all.findIndex((h) => idOf(h) === lastPick.id) + 1) % all.length : Math.max(0, all.findIndex((h) => idOf(h) === idOf(hit)));
        if (again) hit = all[k];
        lastPick = { sx: d.sx, sy: d.sy, id: idOf(hit) };
        if (again) toast(`Picked ${k + 1} of ${all.length} objects here — click again for the next.`, 1500);
      }
      selectObj(hit, d.add); scheduleRender(); return;
    }
    if (d.kind === 'drawRect' || d.kind === 'drawCircle' || d.kind === 'stamp') {
      const dr = ed.draft;
      const tiny = !dr || (dr.kind === 'rect' && (dr.hw < 0.75 * ed.s || dr.hh < 0.75 * ed.s) && d.kind !== 'stamp') || (dr.kind === 'circle' && dr.r < 1.5 * ed.s);
      if (!tiny) { roundToDbu(dr); shapes().push(dr); ed.selection = new Set([dr.id]); ed.draft = null; changed('shape added'); }
      else { ed.draft = null; dropLastUndo(); updateSelectionUI(); scheduleRender(); }
      return;
    }
    if (d.kind === 'lasso') {
      if (d.moved && d.pts.length >= 3) {
        const simp = rdp(d.pts.map((p) => [p.x, p.y]), Math.max(3 * ed.s, gridNm() * 0.2));
        if (simp.length >= 3) { pushUndo(); const p = roundToDbu(makePoly(simp, ed.nominalDose, ed.activeLayer)); shapes().push(p); ed.selection = new Set([p.id]); }
        ed.draft = null;
        changed('polygon');
      } else {
        if (!ed.pendingPoly) ed.pendingPoly = { pts: [] };
        const p = snapPt(d.down);
        const pp = ed.pendingPoly.pts;
        if (pp.length >= 3 && Math.hypot(p.x - pp[0].x, p.y - pp[0].y) < tolW()) closePendingPoly();
        else { pp.push(p); ed.draft = null; scheduleRender(); }
      }
      return;
    }
    if (d.kind === 'move' && !d.moved) { dropLastUndo(); updateSelectionUI(); scheduleRender(); return; }
    if (d.kind === 'move' || d.kind === 'corner' || d.kind === 'rot') { roundSelection(); if (d.shape) roundToDbu(d.shape); changed('edited'); return; }
    scheduleRender();
  });

  canvas.addEventListener('dblclick', (e) => {
    const { sx, sy } = evPt(e), w = s2w(sx, sy);
    if (ed.pendingPoly) { closePendingPoly(); return; }
    const h = hitAny(w);
    if (!h) return;
    selectObj(h, false);
    if (h.type === 'shape') openGeomDialog(h.s); else openRefDialog(h.ref);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { sx, sy } = evPt(e);
    const before = s2w(sx, sy);
    interacting();
    setScale(ed.s * (e.deltaY < 0 ? 0.9 : 1.1));
    const after = s2w(sx, sy);
    ed.ox += before.x - after.x; ed.oy += before.y - after.y;
    scheduleRender();
  }, { passive: false });
  canvas.addEventListener('mouseleave', () => { ed.hover = null; if (ed.tool === 'place') scheduleRender(); });

  // ---------------------------------------------------------------- keyboard
  // Space released (or the window left while it was held): the hand goes away
  const dropSpace = () => { if (!ed.spaceHeld) return; ed.spaceHeld = false; if (!ed.drag || ed.drag.kind !== 'pan') canvas.style.cursor = ed.tool === 'select' ? 'default' : 'crosshair'; };
  document.addEventListener('keyup', (ev) => { if (ev.code === 'Space') { if (ed.spaceHeld && app.isTabActive('layout')) ev.preventDefault(); dropSpace(); } });
  window.addEventListener('blur', dropSpace);
  document.addEventListener('keydown', (ev) => {
    if (!app.isTabActive('layout') || modalOpen()) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (ev.key === 'Escape') {
      closeMenu();
      if (ed.pendingPoly) { ed.pendingPoly = null; scheduleRender(); return; }
      if (ed.draft) { ed.draft = null; ed.drag = null; scheduleRender(); return; }
      if (ed.tool !== 'select') { setTool('select'); return; }
      ed.selection.clear(); updateSelectionUI(); scheduleRender(); return;
    }
    if (typing) return;
    // Space held: the hand. Taken from the page so it neither scrolls nor presses a focused button.
    if (ev.code === 'Space' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      if (!ed.spaceHeld) { ed.spaceHeld = true; if (!ed.drag) canvas.style.cursor = 'grab'; }
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
    if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k === 'y') { ev.preventDefault(); doRedo(); return; }
    if (mod && k === 'a') { ev.preventDefault(); ed.selection = new Set([...shapes().filter((s) => layerVisible(s.layer)).map((s) => s.id), ...refs().map((r) => r.id)]); updateSelectionUI(); scheduleRender(); return; }
    if (mod && k === 'd') { ev.preventDefault(); duplicateSelection(); return; }
    if (mod && k === 'c') { ev.preventDefault(); copySelection(false); return; }
    if (mod && k === 'x') { ev.preventDefault(); copySelection(true); return; }
    if (mod && k === 'v') { ev.preventDefault(); pasteClip(); return; }
    if (mod) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (ev.key === 'Enter') { if (ed.pendingPoly) closePendingPoly(); return; }
    if (ev.key === '1') return setTool('select');
    if (ev.key === '2') return setTool('rect');
    if (ev.key === '3') return setTool('circle');
    if (ev.key === '4') return setTool('poly');
    if (ev.key === '5') return setTool('device');
    if (k === 'f') return fitView();
    if (k === 'r') return resetView();
    if (k === 'g') { ed.snap = !ed.snap; $('snapEnable').checked = ed.snap; return; }
    if (ev.key.startsWith('Arrow')) {
      if (!ed.selection.size) return;
      ev.preventDefault();
      const st = gridNm() * (ev.shiftKey ? 10 : 1);
      const dx = ev.key === 'ArrowRight' ? st : ev.key === 'ArrowLeft' ? -st : 0;
      const dy = ev.key === 'ArrowUp' ? st : ev.key === 'ArrowDown' ? -st : 0;
      pushUndo();
      selectedShapes().forEach((s) => { s.cx = Math.round(s.cx + dx); s.cy = Math.round(s.cy + dy); });
      selectedRefs().forEach((r) => { r.x = Math.round(r.x + dx); r.y = Math.round(r.y + dy); });
      changed('nudged');
    }
  });

  // ---------------------------------------------------------------- control wiring
  $('toolSelect').onclick = () => setTool('select');
  $('toolRect').onclick = () => setTool('rect');
  $('toolCircle').onclick = () => setTool('circle');
  $('toolPoly').onclick = () => setTool('poly');
  $('toolDevice').onclick = () => setTool('device');
  $('btnHelp').onclick = openHelp;
  $('btnFuse').onclick = fuseSelection;
  $('btnSplit').onclick = splitSelection;
  $('btnArray').onclick = openArrayDialog;
  $('btnDuplicate').onclick = duplicateSelection;
  $('btnDelete').onclick = deleteSelection;
  $('btnDeleteAll').onclick = deleteAll;
  $('btnUndo').onclick = doUndo;
  $('btnRedo').onclick = doRedo;
  $('btnFit').onclick = fitView;
  $('btnResetView').onclick = resetView;
  $('crumbBack').onclick = backToParent;
  $('snapEnable').onchange = (e) => { ed.snap = !!e.target.checked; };
  $('btnUnselect').onclick = () => { ed.selection.clear(); updateSelectionUI(); scheduleRender(); };
  $('btnEditGeom').onclick = () => {
    const sel = selectedShapes(), rs = selectedRefs();
    const rg = selectedRampGroup();
    if (rg) openRampDialog(rg); else if (sel.length === 1 && !rs.length) openGeomDialog(sel[0]); else if (rs.length === 1 && !sel.length) openRefDialog(rs[0]);
  };
  const doseEl = $('selDose');
  doseEl.onfocus = () => pushUndo();
  doseEl.oninput = (e) => {
    let v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    if (v < 0) { v = 0; e.target.value = 0; toast('A dose cannot be negative — set to 0.'); }   // E2
    const keys = new Set(selectedShapes().map(groupKeyOf));
    shapes().forEach((s) => { if (keys.has(groupKeyOf(s))) { s.dose = v; s.writeDose = null; } });
    changed('dose');
  };
  $('selLayer').onchange = (e) => {
    if (!e.target.value) return;
    pushUndo();
    selectedShapes().forEach((s) => { s.layer = e.target.value; });
    changed('layer');
  };
  const bindNum = (id, fn) => { $(id).oninput = (e) => fn(parseFloat(e.target.value)); };
  bindNum('nominalDose', (v) => { ed.nominalDose = Number.isFinite(v) ? v : 0; });
  bindNum('mpp', (v) => {
    if (!(v > 0)) return;
    const cx = ed.ox + (ed.W * ed.s) / 2, cy = ed.oy - (ed.H * ed.s) / 2;
    ed.s = clamp(v * 1000, S_MIN, S_MAX);
    ed.ox = cx - (ed.W * ed.s) / 2; ed.oy = cy + (ed.H * ed.s) / 2;
    scheduleRender();
  });
  bindNum('gridUm', (v) => { ed.gridUm = Math.max(0.001, v || 1); scheduleRender(); });
  bindNum('gridMajor', (v) => { ed.gridMajor = Math.max(2, Math.round(v) || 5); scheduleRender(); });
  bindNum('fixedW', (v) => { ed.fixedW = Math.max(0.001, v || 1); });
  bindNum('fixedL', (v) => { ed.fixedL = Math.max(0.001, v || 1); });
  $('fixedEnable').onchange = (e) => { ed.fixed = !!e.target.checked; };

  // cells panel
  $('cellList').addEventListener('click', (e) => { const it = e.target.closest('.item'); if (!it) return; ed.cellPick = it.dataset.cell; updateCellList(); });
  $('cellList').addEventListener('dblclick', (e) => { const it = e.target.closest('.item'); if (it) editCell(it.dataset.cell); });
  $('cellEdit').onclick = () => { if (ed.cellPick === ed.cell && ed.cell !== lib().top) return; editCell(ed.cellPick); };
  $('cellPlace').onclick = () => {
    const n = ed.cellPick;
    if (!n || n === ed.cell) { toast('Pick another cell in the list to place it inside the one you are editing.'); return; }
    setTool('place', n);
  };
  $('cellRename').onclick = () => {
    const n = ed.cellPick;
    const to = prompt(`Rename cell ${n} to:`, n);
    if (!to || to === n) return;
    try { pushUndo(); renameCell(lib(), n, to.trim()); if (ed.cell === n) ed.cell = to.trim(); ed.cellStack = ed.cellStack.map((c) => (c === n ? to.trim() : c)); ed.cellPick = to.trim(); changed('cell renamed'); }
    catch (err) { dropLastUndo(); toast(esc(err.message)); }
  };
  $('cellDelete').onclick = () => {
    const n = ed.cellPick;
    if (!confirm(`Delete cell ${n}?`)) return;
    try { pushUndo(); deleteCell(lib(), n); if (ed.cell === n) backToParent(); ed.cellPick = ed.cell; changed('cell deleted'); }
    catch (err) { dropLastUndo(); toast(esc(err.message)); }
  };
  $('cellNew').onclick = () => {
    const name = prompt('Name of the new (empty) cell:', uniqueCellName(lib(), 'CELL'));
    if (!name) return;
    const n = uniqueCellName(lib(), name.trim());
    pushUndo(); lib().cells[n] = makeCell(n); changed('cell added');
    editCell(n);
    toast(`Editing the new cell <b>${esc(n)}</b>. Draw in it, then go back and <b>Place</b> it.`);
  };

  // layers panel
  const layerList = $('layerList');
  layerList.addEventListener('change', (e) => {
    const it = e.target.closest('.item'); if (!it) return;
    const l = lib().layers[+it.dataset.i];
    if (e.target.type === 'radio') ed.activeLayer = l.key;
    else if (e.target.classList.contains('vis')) l.visible = e.target.checked;
    else if (e.target.type === 'color') l.color = e.target.value;
    else if (e.target.classList.contains('name')) l.name = e.target.value;
    else if (e.target.classList.contains('key')) {
      const key = e.target.value.trim();
      if (!/^\d{1,5}\/\d{1,5}$/.test(key) || lib().layers.some((o) => o !== l && o.key === key)) { toast('Layer keys are unique "layer/datatype" pairs such as 3/0.'); e.target.value = l.key; return; }
      pushUndo();
      for (const c of Object.values(lib().cells)) for (const s of c.shapes) if (s.layer === l.key) s.layer = key;
      if (ed.activeLayer === l.key) ed.activeLayer = key;
      l.key = key;
    }
    updateLayerList(); changed('layers');
  });
  // beam settings change the shot estimate only: saved with the project, no effect on exposure or a correction
  for (const [id, prop, min, def] of [['layerStep', 'step', 0.5, 5], ['layerCur', 'current', 0.01, 2]]) {
    $(id).addEventListener('change', () => {
      const l = lib().layers.find((o) => o.key === ed.activeLayer); if (!l) return;
      const v = parseFloat($(id).value);
      l[prop] = Number.isFinite(v) && v >= min ? v : (l[prop] ?? def);
      $(id).value = l[prop];
      app.markDirty();
    });
  }
  // which layers the Exposure tab's high-resolution correction takes whole; saved with the project
  $('layerPec').addEventListener('change', () => {
    const l = lib().layers.find((o) => o.key === ed.activeLayer); if (!l) return;
    if ($('layerPec').value === 'high') l.pec = 'high'; else delete l.pec;
    updateLayerList(); changed('layers');
  });
  const setAllVisible = (v) => { for (const l of lib().layers) l.visible = v; if (!v) ed.selection.clear(); updateLayerList(); updateSelectionUI(); changed(v ? 'all layers shown' : 'all layers hidden'); };
  $('layerShowAll').onclick = () => setAllVisible(true);
  $('layerHideAll').onclick = () => setAllVisible(false);
  $('layerAdd').onclick = () => {
    const used = new Set(lib().layers.map((l) => +l.key.split('/')[0]));
    let n = 1; while (used.has(n)) n++;
    const palette = ['#2f6fd6', '#d6532f', '#2a9d5b', '#9b4fd6', '#d6a72f', '#2fb8d6', '#d62f8f'];
    lib().layers.push({ key: `${n}/0`, name: `Layer ${n}`, color: palette[n % palette.length], visible: true, purpose: 'exposure' });
    updateLayerList(); changed('layer added');
  };

  new ResizeObserver(resize).observe($('canvasWrap'));
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- public
  function loadProject(fit = true) {
    ed.cell = lib().top; ed.cellStack = []; ed.cellPick = ed.cell;
    ed.selection.clear(); ed.undo = []; ed.redo = []; ed.draft = null; ed.pendingPoly = null;
    invalidateCaches();
    setTool('select');
    updateUndoButtons(); updateLayerList(); updateCellList(); updateSelectionUI(); updateStatus();
    resize();
    if (fit) fitView(); else scheduleRender();
  }

  // An undoable change made from another tab (e.g. applying a proximity correction).
  function mutate(reason, fn) {
    pushUndo();
    const out = fn(lib());
    changed(reason);
    return out;
  }

  // session state saved with the project (drawing aids, nominal dose, active layer, edited cell)
  function getSession() {
    return { nominalDose: ed.nominalDose, activeLayer: ed.activeLayer, gridUm: ed.gridUm, gridMajor: ed.gridMajor, snap: ed.snap, fixed: ed.fixed, fixedW: ed.fixedW, fixedL: ed.fixedL, cell: ed.cell !== lib().top ? ed.cell : null };
  }
  function setSession(o) {
    if (!o) return;
    const num = (v, d) => (Number.isFinite(+v) ? +v : d);
    ed.nominalDose = num(o.nominalDose, ed.nominalDose); ed.gridUm = Math.max(0.001, num(o.gridUm, ed.gridUm)); ed.gridMajor = Math.max(2, Math.round(num(o.gridMajor, ed.gridMajor)));
    ed.snap = !!o.snap; ed.fixed = !!o.fixed; ed.fixedW = Math.max(0.001, num(o.fixedW, ed.fixedW)); ed.fixedL = Math.max(0.001, num(o.fixedL, ed.fixedL));
    if (o.activeLayer && lib().layers.some((l) => l.key === o.activeLayer)) ed.activeLayer = o.activeLayer;
    const set = (id, v) => { const e = $(id); if (e) { if (e.type === 'checkbox') e.checked = !!v; else e.value = v; } };
    set('nominalDose', ed.nominalDose); set('gridUm', ed.gridUm); set('gridMajor', ed.gridMajor); set('snapEnable', ed.snap); set('fixedEnable', ed.fixed); set('fixedW', ed.fixedW); set('fixedL', ed.fixedL);
    if (o.cell && lib().cells[o.cell] && o.cell !== lib().top) editCell(o.cell);
    updateLayerList(); scheduleRender();
  }

  return {
    loadProject, render: scheduleRender, resize, fitView, mutate, getSession, setSession,
    getView: () => ({ s: ed.s, ox: ed.ox, oy: ed.oy }),
    setView: (v) => { if (v && v.s > 0) { setScale(v.s); ed.ox = v.ox; ed.oy = v.oy; scheduleRender(); } },
    state: ed,
    // inspection hook
    _test: { s2w, w2s, hitAny, selectedShapes, selectedRefs, shapes, refs, editCell, backToParent, setTool, doUndo, doRedo, renderNow: render, changed, tiles: () => ({ ...tiles.last, cached: tiles.map.size, tiled: tiledCell() }) },
  };
}
