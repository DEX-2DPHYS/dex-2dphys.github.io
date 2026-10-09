// GDSII → Workbench library.
//
// - Coordinates are rescaled to 1 nm (the library's DBU). CleWin writes its database unit as a
//   real8 that decodes to 0.9999999999999999 nm, so a scale within 1e-6 of an integer is snapped.
// - BOUNDARY → rect when it is an axis-aligned rectangle (so it stays editable as one), else poly.
// - PATH (types 0, 1, 2, 4) → polygon outline: mitred joins as GDS defines them, flush / round /
//   half-width / custom end extensions; self-overlaps are cleaned with a union.
// - SREF / AREF → refs (GDS order: reflect about x, magnify, rotate, translate — gdsLinear).
// - BOX, TEXT, NODE are skipped and counted. PROPATTR/PROPVALUE pairs are kept on the element as
//   `props` and written back by write.js.
// - Each layer/datatype seen becomes an exposure layer "L/D". With a dose table (the
//   relative dose per layer, see parseDoseTable) a shape's writeDose = relative dose of its layer ×
//   nominal, and its target dose stays nominal: the Exposure tab then shows what that corrected
//   file delivers (BEAMER import, §6.2).

import { readRecords, RT, RT_NAME } from './records.js';
import { makeRect, makePoly, bboxWorld, outlineWorld } from '../geom/shapes.js';
import { makeCell, makeRef, DEVICE_LAYER, HRES_LAYER, references } from '../geom/library.js';
import { unionPolygons, signedArea, intersectPolygons, isSimplePolygon, resolvePolygon, holeFreePieces } from '../geom/clip.js';
import { areaOf } from '../pec/fracture.js';

const PALETTE = ['#2f6fd6', '#d6532f', '#2a9d5c', '#9b4dca', '#d1a000', '#0f9fb5', '#c2185b', '#5d6d7e', '#7cb342', '#ef6c00', '#3949ab', '#8d6e63'];

// Dose table: "<relative dose> <layer>" per line; any other line (a header, a comment) is skipped.
// Returns Map(layer → relative dose). Also accepts comma or semicolon separators.
export function parseDoseTable(text) {
  const m = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const f = line.trim().split(/[\s,;]+/);
    if (f.length < 2) continue;
    const dose = parseFloat(f[0]), layer = parseInt(f[1], 10);
    if (Number.isFinite(dose) && Number.isInteger(layer)) m.set(layer, dose);
  }
  if (!m.size) throw new Error('no "<relative dose> <layer>" lines found in the dose table');
  return m;
}

// ---------------------------------------------------------------- path → polygon
function pathOutline(pts, width, type, ext0, ext1, tolNm) {
  const hw = Math.abs(width) / 2;
  if (hw <= 0 || pts.length < 2) return [];
  // drop repeated points
  const P = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (P.length < 2) return [];
  const dir = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
  const e0 = type === 2 ? hw : type === 4 ? ext0 : 0, e1 = type === 2 ? hw : type === 4 ? ext1 : 0;
  const d0 = dir(P[0], P[1]), dn = dir(P[P.length - 2], P[P.length - 1]);
  const Q = P.map((p) => p.slice());
  Q[0] = [P[0][0] - d0[0] * e0, P[0][1] - d0[1] * e0];
  Q[Q.length - 1] = [P[P.length - 1][0] + dn[0] * e1, P[P.length - 1][1] + dn[1] * e1];
  const left = [], right = [];
  for (let i = 0; i < Q.length; i++) {
    const a = i > 0 ? dir(Q[i - 1], Q[i]) : null, b = i < Q.length - 1 ? dir(Q[i], Q[i + 1]) : null;
    const na = a && [-a[1], a[0]], nb = b && [-b[1], b[0]];
    let n, s = hw;
    if (na && nb) {
      const sum = [na[0] + nb[0], na[1] + nb[1]], l = Math.hypot(sum[0], sum[1]);
      if (l < 1e-9) { n = na; } else { n = [sum[0] / l, sum[1] / l]; s = hw / Math.max(0.05, (na[0] * n[0] + na[1] * n[1])); }
    } else n = na || nb;
    left.push([Q[i][0] + n[0] * s, Q[i][1] + n[1] * s]);
    right.push([Q[i][0] - n[0] * s, Q[i][1] - n[1] * s]);
  }
  const polys = [[...left, ...right.reverse()]];
  if (type === 1) {                                   // round ends: discs at both ends
    const seg = Math.max(16, Math.min(4096, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolNm / hw)))));
    for (const c of [P[0], P[P.length - 1]]) {
      const disc = [];
      for (let k = 0; k < seg; k++) { const t = (2 * Math.PI * k) / seg; disc.push([c[0] + hw * Math.cos(t), c[1] + hw * Math.sin(t)]); }
      polys.push(disc);
    }
  }
  // a union removes self-overlap at sharp turns and where the ends of a ring meet; it keeps holes (a
  // closed path loop) as CW paths. A single outline is resolved too: unionPolygons hands one polygon
  // back as it is, which left a ring whose ends overlap counted twice there (ChipV11's markers).
  const oriented = polys.map((p) => (signedArea(p) < 0 ? p.slice().reverse() : p));
  return oriented.length === 1 ? resolvePolygon(oriented[0]) : unionPolygons(oriented);
}

// an axis-aligned rectangle given as 4 (or 5, closed) integer points?
function asRect(pts) {
  const q = pts.length === 5 && pts[0][0] === pts[4][0] && pts[0][1] === pts[4][1] ? pts.slice(0, 4) : pts;
  if (q.length !== 4) return null;
  const xs = new Set(q.map((p) => p[0])), ys = new Set(q.map((p) => p[1]));
  if (xs.size !== 2 || ys.size !== 2) return null;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; if (a[0] !== b[0] && a[1] !== b[1]) return null; }
  const [x1, x2] = [...xs].sort((a, b) => a - b), [y1, y2] = [...ys].sort((a, b) => a - b);
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, hw: (x2 - x1) / 2, hh: (y2 - y1) / 2 };
}

// ---------------------------------------------------------------- reader

// ---------------------------------------------------------------- overlaps (exposed once)
// In GDS, overlapping boundaries on one layer mean "this area is exposed", once: writers and PEC
// tools (BEAMER and others) merge them. The Workbench adds the doses of separate shapes, and merges
// only fused objects, so overlapping or touching shapes on the same layer are put into one fused
// group (groupId "gdsm…"). Touching counts too, so an L made of two rectangles is one object with no
// internal edge. write.js writes such members back as they came in.
export const MERGE_PREFIX = 'gdsm';
function mergeOverlaps(cells, report) {
  let groups = 0, members = 0;
  for (const cell of Object.values(cells)) {
    const sh = cell.shapes;
    if (sh.length < 2) continue;
    const bb = sh.map((s) => bboxWorld(s));
    const parent = sh.map((_, i) => i), find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    // Bucket grid sized to the SHAPES (twice the median shape size), not to the layout's area per
    // shape: a layout is mostly empty, and dense blocks of small features would otherwise share a
    // few huge buckets and be compared pair by pair. A large shape sits in many buckets; each pair
    // is compared only in the bucket that holds the low corner of their bboxes' overlap.
    let X1 = Infinity, Y1 = Infinity;
    for (const b of bb) { X1 = Math.min(X1, b.x1); Y1 = Math.min(Y1, b.y1); }
    const dims = bb.map((b) => Math.max(b.x2 - b.x1, b.y2 - b.y1)).sort((p, q) => p - q);
    const size = Math.max(1, 2 * dims[Math.floor(dims.length / 2)]);
    const cellOf = (v, o) => Math.floor((v - o) / size);
    const buckets = new Map();
    // A shape far larger than the median (a chip frame among 50 nm dots) would sit in millions of
    // buckets (ShapeMatrix_v2.gds overflowed the Map): such shapes stay out of the grid and are
    // compared with every shape directly below.
    const MAX_BUCKETS = 256, big = [];
    bb.forEach((b, i) => {
      const nx = cellOf(b.x2, X1) - cellOf(b.x1, X1) + 1, ny = cellOf(b.y2, Y1) - cellOf(b.y1, Y1) + 1;
      if (nx * ny > MAX_BUCKETS) { big.push(i); return; }
      for (let x = cellOf(b.x1, X1); x <= cellOf(b.x2, X1); x++) for (let y = cellOf(b.y1, Y1); y <= cellOf(b.y2, Y1); y++) {
        const k = x * 1048576 + y; let a = buckets.get(k); if (!a) buckets.set(k, (a = [])); a.push(i);
      }
    });
    const isBig = new Uint8Array(sh.length); for (const i of big) isBig[i] = 1;
    const owner = (i, j) => cellOf(Math.max(bb[i].x1, bb[j].x1), X1) * 1048576 + cellOf(Math.max(bb[i].y1, bb[j].y1), Y1);
    const connected = (i, j) => {
      const a = bb[i], b = bb[j];
      const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
      if (ox < 0 || oy < 0 || (ox === 0 && oy === 0)) return false;          // apart, or meeting at one corner
      const p = sh[i], q = sh[j];
      if (p.kind === 'rect' && q.kind === 'rect' && !p.rot && !q.rot) return true;   // overlap, or a shared edge
      const pa = outlineWorld(p, 1), qa = outlineWorld(q, 1);
      if (Math.abs(areaOf(intersectPolygons([pa], [qa]))) > 0.5) return true;
      return unionPolygons([pa, qa]).filter((u) => signedArea(u) > 0).length === 1;  // touching along an edge
    };
    for (const [key, list] of buckets) for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const i = list[u], j = list[v];
      if (sh[i].layer !== sh[j].layer || sh[i].groupId || sh[j].groupId) continue;
      if (owner(i, j) !== key) continue;                                   // compared in one bucket only
      if (find(i) !== find(j) && connected(i, j)) parent[find(i)] = find(j);
    }
    for (const i of big) for (let j = 0; j < sh.length; j++) {
      if (j === i || (isBig[j] && j < i)) continue;                         // each big pair once
      if (sh[i].layer !== sh[j].layer || sh[i].groupId || sh[j].groupId) continue;
      const a = bb[i], b = bb[j];
      if (a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1) continue;
      if (find(i) !== find(j) && connected(i, j)) parent[find(i)] = find(j);
    }
    const byRoot = new Map();
    sh.forEach((s, i) => { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(s); });
    for (const g of byRoot.values()) if (g.length > 1) { const id = MERGE_PREFIX + (++groups); for (const s of g) s.groupId = id; members += g.length; }
  }
  report.merged = { groups, shapes: members };
  if (groups) report.warnings.push(`${members.toLocaleString()} overlapping or touching shapes on the same layer merged into ${groups.toLocaleString()} objects (exposed once, as a writer does)`);
}

export function readGds(buf, { nominalDose = 100, doseTable = null, name = null, tolNm = 1, merge = true } = {}) {
  const report = { units: null, nmPerDbu: 1, structures: 0, elements: {}, skipped: {}, layers: {}, warnings: [], top: null, wrappedTops: 0 };
  let selfCross = 0;                               // boundaries that crossed or overlapped themselves
  let pathGroups = 0;                              // paths cut into pieces around a hole
  const count = (k, o = report.elements) => { o[k] = (o[k] || 0) + 1; };
  const cells = {}, order = [];
  let libName = name || 'GDS_IMPORT', cur = null, el = null, scale = 1, lastAttr = null;
  const layerSeen = new Map();       // key → layer number

  const toNm = (arr) => { const out = []; for (let i = 0; i < arr.length; i += 2) out.push([Math.round(arr[i] * scale), Math.round(arr[i + 1] * scale)]); return out; };

  for (const r of readRecords(buf)) {
    switch (r.type) {
      case RT.LIBNAME: if (!name) libName = r.data || libName; break;
      case RT.UNITS: {
        const [user, dbm] = r.data;
        report.units = { userPerDbu: user, dbuMeters: dbm };
        let s = dbm / 1e-9;
        if (Math.abs(s - Math.round(s)) < 1e-6 * Math.max(1, s)) s = Math.round(s);
        else report.warnings.push(`database unit ${dbm} m is not a whole number of nm: coordinates rounded to 1 nm`);
        scale = s; report.nmPerDbu = s;
        break;
      }
      case RT.BGNSTR: cur = null; break;
      case RT.STRNAME: {
        let n = r.data || `CELL${order.length}`;
        if (cells[n]) { report.warnings.push(`duplicate structure name ${n}: the later one is ignored`); n = null; }
        cur = n ? makeCell(n) : { name: '__dup', shapes: [], refs: [] };
        if (n) { cells[n] = cur; order.push(n); report.structures++; }
        break;
      }
      case RT.ENDSTR: cur = null; break;
      case RT.BOUNDARY: case RT.PATH: case RT.SREF: case RT.AREF: case RT.TEXT: case RT.NODE: case RT.BOX:
        el = { kind: r.type, layer: 0, dt: 0, xy: null, width: 0, ptype: 0, ext0: 0, ext1: 0, sname: null, strans: 0, mag: 1, angle: 0, colrow: null, props: null };
        break;
      case RT.LAYER: if (el) el.layer = r.data[0]; break;
      case RT.DATATYPE: if (el) el.dt = r.data[0]; break;
      case RT.XY: if (el) el.xy = r.data; break;
      case RT.WIDTH: if (el) el.width = r.data[0] * scale; break;
      case RT.PATHTYPE: if (el) el.ptype = r.data[0]; break;
      case RT.BGNEXTN: if (el) el.ext0 = r.data[0] * scale; break;
      case RT.ENDEXTN: if (el) el.ext1 = r.data[0] * scale; break;
      case RT.SNAME: if (el) el.sname = r.data; break;
      case RT.STRANS: if (el) el.strans = r.data; break;
      case RT.MAG: if (el) el.mag = r.data[0]; break;
      case RT.ANGLE: if (el) el.angle = r.data[0]; break;
      case RT.COLROW: if (el) el.colrow = r.data; break;
      case RT.PROPATTR: lastAttr = r.data[0]; break;
      case RT.PROPVALUE: if (el) { (el.props ||= {})[lastAttr] = r.data; } break;
      case RT.ENDEL: {
        if (el && cur) addElement(el);
        el = null;
        break;
      }
      default: break;
    }
  }

  function layerKey(e) {
    const key = `${e.layer}/${e.dt}`;
    if (!layerSeen.has(key)) layerSeen.set(key, e.layer);
    count(key, report.layers);
    return key;
  }
  function doses(e) {
    if (!doseTable) return { dose: nominalDose, writeDose: null };
    const rel = doseTable.get(e.layer);
    if (rel == null) { report.warnings.push(`layer ${e.layer} has no entry in the dose table: written at the nominal dose`); return { dose: nominalDose, writeDose: nominalDose }; }
    return { dose: nominalDose, writeDose: rel * nominalDose };
  }
  function pushShape(s, e) { if (e.props) s.props = e.props; const d = doses(e); s.dose = d.dose; s.writeDose = d.writeDose; cur.shapes.push(s); }
  function addElement(e) {
    const kind = RT_NAME[e.kind];
    if (e.kind === RT.TEXT || e.kind === RT.NODE || e.kind === RT.BOX) { count(kind, report.skipped); return; }
    count(kind);
    if (e.kind === RT.BOUNDARY) {
      // repeated vertices (some writers emit them) are dropped first, so a rectangle with a doubled
      // corner is still a rectangle, and what is written back reads back the same
      const raw = toNm(e.xy || []);
      let open = raw.filter((q, i) => i === 0 || q[0] !== raw[i - 1][0] || q[1] !== raw[i - 1][1]);
      while (open.length > 1 && open[0][0] === open[open.length - 1][0] && open[0][1] === open[open.length - 1][1]) open = open.slice(0, -1);
      const key = layerKey(e);
      const rc = asRect(open);
      if (rc) { pushShape(makeRect(rc.cx, rc.cy, rc.hw, rc.hh, nominalDose, key), e); return; }
      if (open.length < 3) { count('degenerate BOUNDARY', report.skipped); return; }
      // a boundary that crosses or overlaps itself (a ring whose ends overlap, a figure eight): the
      // area it encloses, counted once as a writer exposes it. Taken as drawn, the doubled part gets
      // twice the dose and no correction can bring it back down (ChipV11: 12 controls at 208 %).
      // An outline that only touches itself — the usual keyhole cut out to a hole, traversed out and
      // back — encloses nothing twice: its signed area is the area it encloses, and it stays as drawn.
      if (!isSimplePolygon(open)) {
        const resolved = resolvePolygon(open);
        const enclosed = resolved.reduce((t, p) => t + signedArea(p), 0), drawn = Math.abs(signedArea(open));
        const pieces = Math.abs(enclosed - drawn) <= 1e-9 * drawn + 1 ? [] : holeFreePieces(resolved);
        if (pieces.length) {
          selfCross++;
          const g = pieces.length > 1 ? 'gdsx' + selfCross : null;
          for (const p of pieces) { const s = makePoly(p, nominalDose, key); if (g) s.groupId = g; pushShape(s, e); }
          return;
        }
      }
      pushShape(makePoly(open, nominalDose, key), e);
      return;
    }
    if (e.kind === RT.PATH) {
      const key = layerKey(e);
      if (e.width < 0) report.warnings.push('a PATH with an absolute (negative) width: used as a plain width');
      if (e.ptype !== 0 && e.ptype !== 1 && e.ptype !== 2 && e.ptype !== 4) report.warnings.push(`PATHTYPE ${e.ptype} read as flush`);
      const outline = pathOutline(toNm(e.xy || []), e.width, e.ptype, e.ext0, e.ext1, tolNm);
      if (!outline.length) { count('zero-width PATH', report.skipped); return; }
      // a path that encloses a hole (a closed ring): cut into hole-free pieces, kept as one object
      const pieces = outline.some((p) => signedArea(p) < 0) ? holeFreePieces(outline) : outline.filter((p) => signedArea(p) > 0);
      const g = pieces.length > 1 ? 'gdsp' + (++pathGroups) : null;
      for (const p of pieces) { const s = makePoly(p.map(([x, y]) => [Math.round(x), Math.round(y)]), nominalDose, key); if (g) s.groupId = g; pushShape(s, e); }
      return;
    }
    // SREF / AREF
    if (e.strans & 0x0006) report.warnings.push('absolute magnification/angle flags are ignored (treated as relative)');
    const xy = toNm(e.xy || []);
    const base = { x: xy[0][0], y: xy[0][1], rot: e.angle || 0, mag: e.mag || 1, mirrorX: !!(e.strans & 0x8000) };
    if (e.kind === RT.SREF) { const ref = makeRef(e.sname, base); if (e.props) ref.props = e.props; cur.refs.push(ref); return; }
    const [cols, rows] = e.colrow || [1, 1];
    const colStep = [(xy[1][0] - xy[0][0]) / cols, (xy[1][1] - xy[0][1]) / cols];
    const rowStep = [(xy[2][0] - xy[0][0]) / rows, (xy[2][1] - xy[0][1]) / rows];
    const ref = makeRef(e.sname, { ...base, cols, rows, colStep, rowStep });
    if (e.props) ref.props = e.props;
    cur.refs.push(ref);
  }

  // ---- hierarchy: missing children, top cell(s), cycles
  if (!order.length) throw new Error('GDS: no structures in the file');
  for (const n of order) {
    for (const r of cells[n].refs) if (!cells[r.cell]) throw new Error(`GDS: structure ${n} references ${r.cell}, which is not in the file`);
  }
  const referenced = new Set(order.flatMap((n) => cells[n].refs.map((r) => r.cell)));
  const tops = order.filter((n) => !referenced.has(n));
  if (!tops.length) throw new Error('GDS: every structure is referenced by another (a cycle)');
  let top = tops[0];
  if (tops.length > 1) {
    top = 'TOP_IMPORT'; let k = 1; while (cells[top]) top = `TOP_IMPORT_${k++}`;
    cells[top] = makeCell(top);
    for (const t of tops) cells[top].refs.push(makeRef(t, {}));
    report.wrappedTops = tops.length;
    report.warnings.push(`${tops.length} top-level structures: placed side by side (at their own origins) in ${top}`);
  }
  report.top = top;
  if (selfCross) { report.selfCrossing = selfCross; report.warnings.push(`${selfCross.toLocaleString()} boundar${selfCross > 1 ? 'ies' : 'y'} crossed or overlapped ${selfCross > 1 ? 'themselves' : 'itself'}: imported as the area enclosed, counted once (as a writer exposes it)`); }
  if (merge) mergeOverlaps(cells, report);
  const lib = { name: libName, top, cells, layers: [] };
  for (const n of Object.keys(cells)) if (cells[n].refs.some((r) => references(lib, r.cell, n))) throw new Error(`GDS: structure ${n} references itself (a cycle)`);

  // ---- layers: every L/D seen, exposed, plus the Workbench's device-area layer
  const keys = [...layerSeen.keys()].sort((a, b) => { const [la, da] = a.split('/').map(Number), [lb, db] = b.split('/').map(Number); return la - lb || da - db; });
  lib.layers = keys.map((key, i) => {
    const L = layerSeen.get(key), rel = doseTable?.get(L);
    return { key, name: rel != null ? `Layer ${key} · dose ×${rel}` : `Layer ${key}`, color: PALETTE[i % PALETTE.length], visible: true, purpose: 'exposure' };
  });
  if (!lib.layers.some((l) => l.key === HRES_LAYER)) lib.layers.push({ key: HRES_LAYER, name: 'High-resolution PEC zones', color: '#d0368a', visible: true, purpose: 'hres' });
  if (!lib.layers.some((l) => l.key === DEVICE_LAYER)) lib.layers.push({ key: DEVICE_LAYER, name: 'Device areas (Fab Studio)', color: '#c9a400', visible: true, purpose: 'device' });
  else report.warnings.push(`the file uses layer ${DEVICE_LAYER}, which the Workbench reserves for Fab Studio device areas: those shapes are treated as device areas, not exposed`), lib.layers.find((l) => l.key === DEVICE_LAYER).purpose = 'device';
  return { library: lib, report };
}

