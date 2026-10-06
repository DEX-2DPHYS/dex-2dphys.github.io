// Workbench library → GDSII. UNITS 1e-3 user (µm) / 1e-9 m database (1 nm),
// as CleWin and BEAMER write them.
//
// Modes:
//   'design'   the layout as drawn: every exposed layer keeps its "L/D" number. Fused objects are
//              merged into one outline (they are exposed once where members overlap, and a writer
//              would otherwise expose overlaps twice). Device-area shapes are left out by default.
//   'classes'  fractured writing data: each fragment on layer = datatype = its dose class
//              (a common writer convention), plus a "Dose Layer" table of relative doses.
//
// Shapes are polygons in their cell's coordinates (circles at ≤ tol nm chord error, rounded to the
// 1 nm grid); hierarchy is kept (SREF/AREF with STRANS/MAG/ANGLE). Per-ref dose scaling (dose-ramp
// arrays) has no GDS form and is reported. Holes (only a union can make one) are joined to their
// outline with a zero-width cut, the usual GDS idiom, because a BOUNDARY cannot have holes.

import { RecordWriter, RT } from './records.js';
import { outlineWorld, groupKeyOf } from '../geom/shapes.js';
import { unionPolygons, signedArea } from '../geom/clip.js';

const MAX_PTS = 8191;          // XY record limit: (65535 − 4) / 8 points, closing point included

// GDS structure names: A–Z a–z 0–9 _ ? $, at most 32 characters (most tools accept longer; we keep 32)
function sanitizeNames(names) {
  const map = new Map(), used = new Set();
  for (const n of names) {
    let s = String(n).replace(/[^A-Za-z0-9_?$]/g, '_').slice(0, 32) || 'CELL';
    let k = 1, t = s;
    while (used.has(t)) { const suf = `_${k++}`; t = s.slice(0, 32 - suf.length) + suf; }
    used.add(t); map.set(n, t);
  }
  return map;
}

// join each hole (CW) to the outer (CCW) that contains it with a zero-width cut
function keyhole(outers, holes) {
  const res = outers.map((o) => o.slice());
  const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  for (const h of holes) {
    const oi = res.findIndex((o) => inside(h[0], o));
    if (oi < 0) continue;
    const o = res[oi];
    let best = [0, 0, Infinity];
    for (let i = 0; i < h.length; i++) for (let j = 0; j < o.length; j++) {
      const d = (h[i][0] - o[j][0]) ** 2 + (h[i][1] - o[j][1]) ** 2;
      if (d < best[2]) best = [i, j, d];
    }
    const [hi, oj] = best, hr = [...h.slice(hi), ...h.slice(0, hi), h[hi]];
    res[oi] = [...o.slice(0, oj + 1), ...hr, ...o.slice(oj)];
  }
  return res;
}

const toInt = (pts) => {
  const out = [];
  for (const [x, y] of pts) {
    const p = [Math.round(x), Math.round(y)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
};

function gdsDate(d) { return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]; }

export function writeGds(lib, { mode = 'design', libName = null, tol = 1, date = new Date(), includeDevice = false, classes = null, nominalDose = 100 } = {}) {
  const report = { cells: 0, boundaries: 0, srefs: 0, arefs: 0, fusedMerged: 0, holesCut: 0, layers: {}, warnings: [] };
  const layerPurpose = new Map((lib.layers || []).map((l) => [l.key, l.purpose]));
  const keep = (key) => { const p = layerPurpose.get(key); return p === 'device' || p === 'hres' ? includeDevice : true; };

  // cells reachable from top, children first; then any unreachable ones
  const order = [], seen = new Set();
  const visit = (n) => { if (seen.has(n) || !lib.cells[n]) return; seen.add(n); for (const r of lib.cells[n].refs) visit(r.cell); order.push(n); };
  visit(lib.top);
  for (const n of Object.keys(lib.cells)) visit(n);
  const names = sanitizeNames(order);
  if ([...names].some(([a, b]) => a !== b)) report.warnings.push('some cell names were changed to GDS-legal names (letters, digits, _ ? $, ≤ 32 characters)');

  const w = new RecordWriter(), dt = gdsDate(date);
  w.int16(RT.HEADER, [600]);
  w.int16(RT.BGNLIB, [...dt, ...dt]);
  w.ascii(RT.LIBNAME, (libName || lib.name || 'LIB').slice(0, 32));
  w.real8(RT.UNITS, [1e-3, 1e-9]);

  const layerOf = (s) => {
    if (mode === 'classes') { const c = s.doseClass ?? 0; return [c, c]; }
    const [L, D] = String(s.layer || '1/0').split('/').map((v) => parseInt(v, 10) || 0);
    return [L, D];
  };
  const boundary = (L, D, pts, props) => {
    const p = toInt(pts);
    if (p.length < 3 || Math.abs(signedArea(p)) < 0.5) return;
    if (p.length + 1 > MAX_PTS) throw new Error(`a polygon has ${p.length} points; GDS allows ${MAX_PTS - 1}`);
    w.none(RT.BOUNDARY); w.int16(RT.LAYER, [L]); w.int16(RT.DATATYPE, [D]);
    const xy = []; for (const [x, y] of p) xy.push(x, y); xy.push(p[0][0], p[0][1]);
    w.int32(RT.XY, xy);
    writeProps(props);
    w.none(RT.ENDEL);
    report.boundaries++; const k = `${L}/${D}`; report.layers[k] = (report.layers[k] || 0) + 1;
  };
  const writeProps = (props) => {
    if (!props) return;
    for (const [attr, val] of Object.entries(props)) { w.int16(RT.PROPATTR, [parseInt(attr, 10) || 0]); w.ascii(RT.PROPVALUE, String(val)); }
  };

  let rampRefs = 0;
  for (const n of order) {
    const cell = lib.cells[n];
    w.int16(RT.BGNSTR, [...dt, ...dt]);
    w.ascii(RT.STRNAME, names.get(n));
    report.cells++;
    // shapes: single ones directly, fused groups as one union per layer
    const groups = new Map();
    for (const s of cell.shapes) {
      if (!keep(s.layer)) continue;
      // fused groups are written as one outline; gdsm… groups (merged on import) as they came in
      if (mode === 'design' && s.groupId && !String(s.groupId).startsWith('gdsm')) { const k = `${groupKeyOf(s)}|${s.layer}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); continue; }
      const [L, D] = layerOf(s);
      boundary(L, D, outlineWorld(s, tol), s.props);
    }
    for (const members of groups.values()) {
      const [L, D] = layerOf(members[0]);
      const u = unionPolygons(members.map((s) => outlineWorld(s, tol)));
      const outers = u.filter((p) => signedArea(p) > 0), holes = u.filter((p) => signedArea(p) < 0);
      report.fusedMerged++; report.holesCut += holes.length;
      for (const p of keyhole(outers, holes)) boundary(L, D, p, null);
    }
    for (const r of cell.refs) {
      if (r.doseScale != null && r.doseScale !== 1) rampRefs++;
      const arr = r.cols * r.rows > 1;
      w.none(arr ? RT.AREF : RT.SREF);
      w.ascii(RT.SNAME, names.get(r.cell));
      const rot = (((r.rot || 0) % 360) + 360) % 360, mag = r.mag ?? 1;
      if (r.mirrorX || mag !== 1 || rot !== 0) {
        w.bits(RT.STRANS, r.mirrorX ? 0x8000 : 0);
        if (mag !== 1) w.real8(RT.MAG, [mag]);
        if (rot !== 0) w.real8(RT.ANGLE, [rot]);
      }
      const x = Math.round(r.x), y = Math.round(r.y);
      if (arr) {
        if (r.cols > 32767 || r.rows > 32767) throw new Error(`array ${r.cols} × ${r.rows} exceeds the GDS limit of 32767 per side`);
        w.int16(RT.COLROW, [r.cols, r.rows]);
        w.int32(RT.XY, [x, y, Math.round(x + r.cols * r.colStep[0]), Math.round(y + r.cols * r.colStep[1]), Math.round(x + r.rows * r.rowStep[0]), Math.round(y + r.rows * r.rowStep[1])]);
        report.arefs++;
      } else { w.int32(RT.XY, [x, y]); report.srefs++; }
      writeProps(r.props);
      w.none(RT.ENDEL);
    }
    w.none(RT.ENDSTR);
  }
  w.none(RT.ENDLIB);
  if (rampRefs) report.warnings.push(`${rampRefs} array element${rampRefs > 1 ? 's carry' : ' carries'} a dose scale (dose ramp); GDS has no dose, so ${mode === 'classes' ? 'it is in the class' : 'only the geometry is written'}`);

  let doseTable = null;
  if (mode === 'classes') {
    if (!classes) throw new Error('dose-class export needs the class doses');
    doseTable = 'Dose Layer\n' + classes.map((d, c) => `${(d / nominalDose).toFixed(6)} ${c}`).join('\n') + '\n';
  }
  return { bytes: w.bytes(), report, doseTable };
}
