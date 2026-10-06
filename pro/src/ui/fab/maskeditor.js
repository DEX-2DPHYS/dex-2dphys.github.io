// A small mask editor for Fab Studio's exposure step (2026-10-02, Peter: "a small pattern editor
// in the Nano Fab module, with click to grid, grid size up/down, rectangles, circles and polygon
// drawing ... to try out quick concepts fast in the Free mode").
//
// Ported from the Micro and Nanofabrication Studio v2 "Mask Design" editor (reference/): same
// coordinates (WRITE-FIELD nm, origin at the field corner, the sample centred in the field and
// drawn dashed), same shape records {type:'rect'|'circle', xNm, yNm, wNm, hNm, dose}, same dose
// colours, same snapping (anything within half a step of the field edge lands on it). Added here:
// polygons {type:'poly', pts:[[x,y]...], xNm, yNm, wNm, hNm (bounding box), dose}, grid ▲▼,
// a snap switch, right-click delete, Shift = square / circle, and a cursor readout.
//
// The fab engine's customDoseMap() consumes these records (polygons included).

const NICE = [1, 2, 5];
const niceSteps = () => { const a = []; for (let e = 0; e <= 4; e++) for (const m of NICE) a.push(m * 10 ** e); return a; };   // 1 nm … 50 µm
const STEPS = niceSteps();

function doseToColor(dose, alpha) {             // the studio's: low = blue, mid = green, high = red
  const t = Math.min(1, Math.max(0, dose / 2000));
  let r, g, b;
  if (t < 0.5) { r = 0; g = Math.round(255 * t * 2); b = Math.round(255 * (1 - t * 2)); }
  else { r = Math.round(255 * (t - 0.5) * 2); g = Math.round(255 * (1 - (t - 0.5) * 2)); b = 0; }
  return `rgba(${r},${g},${b},${alpha})`;
}

// field() -> { wfW, wfD, sampleW, sampleD } in nm; onChange(shapes) after every edit
export function createMaskEditor({ field, onChange, unit = 'µC/cm²' }) {
  const el = document.createElement('div');
  el.className = 'mask-ed';
  el.innerHTML = `
    <div class="me-tools">
      <div class="me-seg" role="group" aria-label="Tool">
        <button type="button" data-tool="rect" class="on" title="Rectangle: drag (Shift = square)">▭ Rect</button>
        <button type="button" data-tool="circle" title="Circle / ellipse: drag its bounding box (Shift = circle)">◯ Circle</button>
        <button type="button" data-tool="poly" title="Polygon: click the corners; click the first corner, double-click or Enter to close; Backspace removes the last corner, Esc cancels">⬠ Polygon</button>
      </div>
      <label class="me-num" title="Dose of the next shape">Dose <input type="number" class="me-dose" value="300" min="1" step="10"> <span class="me-unit">${unit}</span></label>
    </div>
    <div class="me-wrap"><canvas class="me-canvas"></canvas></div>
    <div class="me-tools">
      <label class="me-num" title="Every click and corner lands on this grid">Grid <button type="button" class="me-gdn" title="Finer grid">▼</button><input type="number" class="me-grid" value="50" min="1" step="1"><button type="button" class="me-gup" title="Coarser grid">▲</button> nm</label>
      <label class="me-chk"><input type="checkbox" class="me-snap" checked> snap to grid</label>
      <span style="flex:1"></span>
      <button type="button" class="btn small me-undo" title="Undo the last shape (Ctrl+Z while the pointer is over the editor)">↩ Undo</button>
      <button type="button" class="btn small me-clear">✕ Clear</button>
    </div>
    <div class="hint me-info">0 shapes</div>`;
  const cv = el.querySelector('.me-canvas'), ctx = cv.getContext('2d');
  const q = (s) => el.querySelector(s);
  let shapes = [], undo = [], tool = 'rect', drag = null, poly = null, hover = null, over = false;

  const F = () => { const f = field(); return { wfW: Math.max(1, f.wfW), wfD: Math.max(1, f.wfD), sampleW: f.sampleW, sampleD: f.sampleD }; };
  const grid = () => Math.max(0, parseFloat(q('.me-grid').value) || 0);
  const snapOn = () => q('.me-snap').checked && grid() > 0;
  const dose = () => Math.max(1, parseFloat(q('.me-dose').value) || 300);
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  // write-field nm <-> canvas px (device pixels)
  const toC = (x, y) => { const f = F(); return { x: (x / f.wfW) * cv.width, y: (y / f.wfD) * cv.height }; };
  const toNm = (cx, cy) => { const f = F(); return { x: ((cx * dpr()) / cv.width) * f.wfW, y: ((cy * dpr()) / cv.height) * f.wfD }; };
  // the studio's snap: clamp to the field; within half a step of an edge -> onto the edge
  const snap1 = (v, max) => {
    if (!(v > 0)) return 0; if (v >= max) return max;
    if (!snapOn()) return v;
    const g = grid();
    if (v <= g * 0.5) return 0; if (v >= max - g * 0.5) return max;
    return Math.min(max, Math.max(0, Math.round(v / g) * g));
  };
  const snap = (p) => { const f = F(); return { x: snap1(p.x, f.wfW), y: snap1(p.y, f.wfD) }; };
  const ptOf = (e) => { const r = cv.getBoundingClientRect(); return toNm(e.clientX - r.left, e.clientY - r.top); };

  function fit() {
    const wrap = q('.me-wrap');
    if (!wrap.clientWidth) return;
    const f = F();
    wrap.style.height = Math.round(Math.max(140, Math.min(360, wrap.clientWidth / (f.wfW / f.wfD)))) + 'px';
    cv.width = Math.floor(wrap.clientWidth * dpr()); cv.height = Math.floor(wrap.clientHeight * dpr());
    draw();
  }
  function bboxShape(type, a, b, square) {
    let bx = b.x, by = b.y;
    if (square) { const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); bx = a.x + (b.x < a.x ? -s : s); by = a.y + (b.y < a.y ? -s : s); }
    const x0 = Math.min(a.x, bx), y0 = Math.min(a.y, by);
    return { type, xNm: x0, yNm: y0, wNm: Math.abs(bx - a.x), hNm: Math.abs(by - a.y), dose: dose() };
  }
  function polyShape(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { type: 'poly', pts: pts.map(([x, y]) => [x, y]), xNm: x0, yNm: y0, wNm: x1 - x0, hNm: y1 - y0, dose: dose() };
  }
  const inside = (s, p) => {
    if (s.type === 'rect') return p.x >= s.xNm && p.x <= s.xNm + s.wNm && p.y >= s.yNm && p.y <= s.yNm + s.hNm;
    if (s.type === 'circle') { const dx = (p.x - s.xNm - s.wNm / 2) / (s.wNm / 2 || 1), dy = (p.y - s.yNm - s.hNm / 2) / (s.hNm / 2 || 1); return dx * dx + dy * dy <= 1; }
    let c = false; const P = s.pts;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, ay] = P[j], [bx, by] = P[i]; if ((ay > p.y) !== (by > p.y) && p.x < ax + ((p.y - ay) / (by - ay)) * (bx - ax)) c = !c; }
    return c;
  };
  const commit = (s) => { if (s.type !== 'poly' && (s.wNm <= 0 || s.hNm <= 0)) return; shapes.push(s); undo = []; changed(); };
  function changed() { info(); draw(); onChange?.(shapes.map((s) => ({ ...s, ...(s.pts ? { pts: s.pts.map((p) => [...p]) } : {}) }))); }
  function info(extra) {
    const n = shapes.length, kinds = {};
    for (const s of shapes) kinds[s.type] = (kinds[s.type] || 0) + 1;
    const parts = Object.entries(kinds).map(([k, v]) => `${v} ${k === 'poly' ? 'polygon' : k === 'rect' ? 'rectangle' : 'circle'}${v > 1 ? 's' : ''}`);
    q('.me-info').textContent = `${n ? parts.join(', ') : 'No shapes yet — draw on the field'}${hover ? ` · ${Math.round(hover.x)}, ${Math.round(hover.y)} nm` : ''}${extra ? ' · ' + extra : ''}`;
  }

  function draw() {
    const W = cv.width, H = cv.height, f = F();
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // grid: the snap grid; thinned to at most ~120 lines per axis
    let g = grid() || 10 ** Math.floor(Math.log10(Math.max(f.wfW, f.wfD) / 5));
    while (f.wfW / g > 120 || f.wfD / g > 120) g *= 2;
    ctx.strokeStyle = snapOn() ? '#dfe6ee' : '#eef1f4'; ctx.lineWidth = 1;
    for (let x = 0; x <= f.wfW + 1e-6; x += g) { const p = toC(x, 0); ctx.beginPath(); ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, H); ctx.stroke(); }
    for (let y = 0; y <= f.wfD + 1e-6; y += g) { const p = toC(0, y); ctx.beginPath(); ctx.moveTo(0, Math.round(p.y) + 0.5); ctx.lineTo(W, Math.round(p.y) + 0.5); ctx.stroke(); }
    // sample outline: only what lies inside reaches the wafer
    const oX = (f.wfW - f.sampleW) / 2, oZ = (f.wfD - f.sampleD) / 2;
    const s0 = toC(oX, oZ), s1 = toC(oX + f.sampleW, oZ + f.sampleD);
    ctx.save(); ctx.fillStyle = 'rgba(37,99,235,0.05)'; ctx.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
    ctx.setLineDash([5, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(37,99,235,0.75)'; ctx.strokeRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y); ctx.restore();
    // shapes (+ the one being drawn)
    const preview = drag ? bboxShape(tool, drag.a, drag.b, drag.square) : null;
    for (const s of preview ? [...shapes, preview] : shapes) {
      ctx.fillStyle = doseToColor(s.dose, 0.45); ctx.strokeStyle = doseToColor(s.dose, 0.9); ctx.lineWidth = 2;
      const p0 = toC(s.xNm, s.yNm), p1 = toC(s.xNm + s.wNm, s.yNm + s.hNm);
      ctx.beginPath();
      if (s.type === 'rect') ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      else if (s.type === 'circle') ctx.ellipse((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, Math.abs(p1.x - p0.x) / 2, Math.abs(p1.y - p0.y) / 2, 0, 0, Math.PI * 2);
      else s.pts.forEach(([x, y], k) => { const p = toC(x, y); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      const sh = Math.abs(p1.y - p0.y);
      if (sh > 14 && Math.abs(p1.x - p0.x) > 24) { ctx.fillStyle = '#000'; ctx.font = `bold ${Math.max(9, Math.min(14, sh * 0.3)) * dpr()}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(s.dose), (p0.x + p1.x) / 2, (p0.y + p1.y) / 2); }
    }
    // polygon in progress
    if (poly) {
      ctx.save(); ctx.strokeStyle = doseToColor(dose(), 0.95); ctx.fillStyle = doseToColor(dose(), 0.2); ctx.lineWidth = 2;
      ctx.beginPath(); poly.forEach(([x, y], k) => { const p = toC(x, y); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      if (hover) { const h = snap(hover), p = toC(h.x, h.y); ctx.lineTo(p.x, p.y); }
      ctx.fill(); ctx.stroke();
      for (const [x, y] of poly) { const p = toC(x, y); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * dpr(), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    // snap cursor
    if (hover && over) { const h = snap(hover), p = toC(h.x, h.y); ctx.strokeStyle = 'rgba(15,23,42,0.6)'; ctx.lineWidth = 1; const r = 5 * dpr(); ctx.beginPath(); ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r); ctx.stroke(); }
    // labels
    ctx.fillStyle = '#94a3b8'; ctx.font = `${9 * dpr()}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('write field 0', 3, 3); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(f.wfW)} nm`, W - 3, 3);
    ctx.textBaseline = 'bottom'; ctx.fillText(`${Math.round(f.wfD)} nm`, W - 3, H - 3);
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(37,99,235,0.85)'; const sl = toC(oX, oZ + f.sampleD);
    ctx.fillText(`sample ${Math.round(f.sampleW)} × ${Math.round(f.sampleD)} nm`, sl.x + 3, sl.y - 2);
  }

  // ---- input
  const closePoly = () => { if (poly && poly.length >= 3) commit(polyShape(poly)); poly = null; info(); draw(); };
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (poly) { poly = null; draw(); return; }
    const p = ptOf(e);
    for (let i = shapes.length - 1; i >= 0; i--) if (inside(shapes[i], p)) { undo = []; shapes.splice(i, 1); changed(); return; }
  });
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = snap(ptOf(e));
    if (tool === 'poly') {
      if (!poly) poly = [];
      if (poly.length >= 3) { const a = toC(...poly[0]), b = toC(p.x, p.y); if (Math.hypot(a.x - b.x, a.y - b.y) < 8 * dpr()) { closePoly(); return; } }
      const last = poly[poly.length - 1];
      if (!last || last[0] !== p.x || last[1] !== p.y) poly.push([p.x, p.y]);
      draw(); return;
    }
    drag = { a: p, b: p, square: e.shiftKey };
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  });
  cv.addEventListener('dblclick', () => { if (tool === 'poly') closePoly(); });
  cv.addEventListener('pointermove', (e) => {
    hover = ptOf(e); over = true;
    if (drag) { drag.b = snap(hover); drag.square = e.shiftKey; }
    info(); draw();
  });
  cv.addEventListener('pointerleave', () => { over = false; hover = null; info(); draw(); });
  const endDrag = () => { if (!drag) return; const s = bboxShape(tool, drag.a, drag.b, drag.square); drag = null; commit(s); draw(); };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', () => { drag = null; draw(); });
  // keys only while the pointer is over the editor (the page has its own shortcuts)
  window.addEventListener('keydown', (e) => {
    if (!over || !el.isConnected) return;
    if (e.key === 'Enter' && poly) { e.preventDefault(); closePoly(); }
    else if (e.key === 'Escape' && poly) { e.preventDefault(); poly = null; draw(); }
    else if (e.key === 'Backspace' && poly) { e.preventDefault(); poly.pop(); if (!poly.length) poly = null; draw(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); doUndo(); }
  }, true);

  el.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { tool = b.dataset.tool; poly = null; el.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  const stepGrid = (dir) => {
    const g = grid() || 50;                         // 1-2-5 steps: 50 -> 100 -> 200 ... and back
    const v = dir > 0 ? (STEPS.find((s) => s > g + 1e-9) ?? STEPS.at(-1)) : ([...STEPS].reverse().find((s) => s < g - 1e-9) ?? STEPS[0]);
    q('.me-grid').value = v; draw();
  };
  q('.me-gup').onclick = () => stepGrid(1);
  q('.me-gdn').onclick = () => stepGrid(-1);
  q('.me-grid').oninput = draw;
  q('.me-snap').onchange = draw;
  q('.me-dose').oninput = draw;
  function doUndo() { if (poly) { poly.pop(); if (!poly.length) poly = null; draw(); return; } if (shapes.length) { undo.push(shapes.pop()); changed(); } }
  q('.me-undo').onclick = doUndo;
  q('.me-clear').onclick = () => { if (!shapes.length) return; shapes = []; poly = null; undo = []; changed(); };
  new ResizeObserver(() => fit()).observe(q('.me-wrap'));
  info();

  return {
    el, fit, draw,
    getShapes: () => shapes.map((s) => ({ ...s, ...(s.pts ? { pts: s.pts.map((p) => [...p]) } : {}) })),
    setShapes(list) { shapes = (list || []).map((s) => ({ ...s, ...(s.pts ? { pts: s.pts.map((p) => [...p]) } : {}) })); poly = null; undo = []; info(); draw(); },
    setUnit(u) { q('.me-unit').textContent = u; },
    get grid() { return grid(); },
  };
}

export const MASK_EDITOR_CSS = `
.mask-ed .me-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;font-size:12px}
.mask-ed .me-seg{display:inline-flex;border:1px solid var(--border,#ddd);border-radius:6px;overflow:hidden}
.mask-ed .me-seg button{border:0;background:#fff;padding:3px 8px;font-size:12px;cursor:pointer;border-right:1px solid var(--border,#ddd)}
.mask-ed .me-seg button:last-child{border-right:0}
.mask-ed .me-seg button.on{background:var(--accent,#06f);color:#fff}
.mask-ed .me-num{display:inline-flex;align-items:center;gap:3px}
.mask-ed .me-num input{width:58px;padding:2px 4px;border:1px solid var(--border,#ddd);border-radius:4px;font-size:12px}
.mask-ed .me-num button{border:1px solid var(--border,#ddd);background:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;line-height:1.4}
.mask-ed .me-chk{display:inline-flex;align-items:center;gap:3px}
.mask-ed .me-wrap{position:relative;width:100%;height:180px;border:1px solid var(--border,#ddd);border-radius:6px;background:#fff;cursor:crosshair;overflow:hidden;touch-action:none}
.mask-ed .me-canvas{display:block;width:100%;height:100%}
`;
