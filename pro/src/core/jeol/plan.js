// JEOL write planning: what the machine will be asked to write, how long it takes, and the job files.
//
//   patternStats(lib, …)    exposed area per dose, figure count and writing fields of a layout (design
//                           shapes or the fractured writing data), hierarchy walked once per cell
//   doseRanks(stats, base)  the MODULAT table: one shot-time rank per dose (or per dose class),
//                           percent of the base dose (RESIST)
//   writeTime(plan)         JEOL write time: beam-on time + figure settling + stage moves +
//                           calibrations, with the constants of the machine profile (fitted to wrtest)
//   jdfText / sdfText       the jobdeck and schedule files, in the syntax of DTU's LabAdviser examples
//   checkPlan               the file-name rules and the 10 ns shot limit
//   parseWrtestCSV          JEOL's own estimate, to compare after SCHD
//
// The time model is the one of the EBL Writing Time & Pattern Estimator v2 (computeJob), which was
// checked against JEOL wrtest CSVs. Here the doses are known exactly — every shape or fragment
// carries its own — so the exposure part needs no reconstruction from BEAMER logs.
//
// Units: nm and nm² for geometry, µC/cm² for dose, nA for current, seconds for time.

import { area as shapeArea, bboxLocal, bboxWorld, outlineWorld } from '../geom/shapes.js';
import { isExposedPurpose } from '../geom/library.js';
import { isPackedCell, shapeAt } from '../geom/pack.js';
import { compose, gdsLinear, applyBBox } from '../geom/transform.js';

// ---------------------------------------------------------------- shapes of a cell, packed or not
function* shapesOf(c) {
  if (isPackedCell(c)) { const P = c.__shapes; for (let i = 0; i < P.n; i++) yield shapeAt(P, i); }
  else yield* c.shapes;
}
const shapeCount = (c) => (isPackedCell(c) ? c.__shapes.n : c.shapes.length);

// dose of a shape as it will be written: a fragment's class dose, or a shape's corrected dose, or its design dose
const writeDoseOf = (s) => (s.writeDose != null ? s.writeDose : s.dose ?? 0);
const doseKey = (d) => Number(d.toPrecision(9));

// Subfield pieces ("figures") the pattern generator writes for one shape: a rectangle is cut on
// the subfield grid; anything else ≈ area / sf² + perimeter / sf (the estimator's rule, checked
// against JEOL's figure counts).
function figuresOf(s, sf, mag) {
  const bb = bboxLocal(s), w = (bb.x2 - bb.x1) * mag, h = (bb.y2 - bb.y1) * mag;
  const A = shapeArea(s) * mag * mag;
  const rectLike = s.kind === 'rect' || (s.kind === 'poly' && s.pts.length === 4 && Math.abs(A - w * h) <= 1e-6 * w * h);
  if (rectLike) return Math.max(1, Math.ceil(w / sf - 1e-9)) * Math.max(1, Math.ceil(h / sf - 1e-9));
  let per = 0;
  if (s.kind === 'circle') per = 2 * Math.PI * s.r * mag;
  else if (s.kind === 'poly') for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) per += Math.hypot(s.pts[i][0] - s.pts[j][0], s.pts[i][1] - s.pts[j][1]) * mag;
  else per = 2 * (w + h);
  return Math.max(1, A / (sf * sf) + per / sf);
}

// ---------------------------------------------------------------- pattern statistics
// lib: a Workbench library (the design, or writing.library). Layers that are not exposed (markers,
// device areas, high-resolution zones) are left out. Arrays count cols × rows; a dose-ramp array's
// doseScale multiplies its elements' doses.
export function patternStats(lib, { fieldUm = 1000, subfieldUm = 4.095, maxInstances = 2e6 } = {}) {
  const purpose = new Map((lib.layers || []).map((l) => [l.key, l.purpose]));
  const exposed = (layer) => isExposedPurpose(purpose.get(layer));
  const sf = subfieldUm * 1000, F = fieldUm * 1000;
  const skipped = new Set();

  // ---- area per dose and figures, per cell (memoised; a magnified ref changes figure counts)
  const memo = new Map();
  function agg(name, mag) {
    const key = `${name}|${mag}`;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, null);                                       // cycle guard
    const c = lib.cells[name];
    const out = { dose: new Map(), layers: new Map(), figures: 0, shapes: 0 };
    const addL = (d, L) => { let set = out.layers.get(d); if (!set) out.layers.set(d, (set = new Set())); set.add(L); };
    if (c) {
      for (const s of shapesOf(c)) {
        if (!exposed(s.layer)) { skipped.add(s.layer); continue; }
        const d = doseKey(writeDoseOf(s));
        out.dose.set(d, (out.dose.get(d) || 0) + shapeArea(s) * mag * mag); addL(d, s.layer);
        out.figures += figuresOf(s, sf, mag); out.shapes++;
      }
      for (const r of c.refs) {
        const sub = agg(r.cell, mag * (r.mag || 1));
        if (!sub) throw new Error(`cell ${r.cell} references itself`);
        const n = (r.cols || 1) * (r.rows || 1), k = r.doseScale ?? 1;
        for (const [d, a] of sub.dose) { const dd = doseKey(d * k); out.dose.set(dd, (out.dose.get(dd) || 0) + n * a); for (const L of sub.layers.get(d) || []) addL(dd, L); }
        out.figures += n * sub.figures; out.shapes += n * sub.shapes;
      }
    }
    memo.set(key, out);
    return out;
  }
  const top = agg(lib.top, 1);

  // ---- writing fields touched: each shape instance's box marks the fields it overlaps. Arrays too
  // large for the budget mark their whole bounding box instead (flagged as approximate).
  const fields = new Set();
  let budget = maxInstances, approx = false, bbAll = null;
  const flatN = new Map();
  const countFlat = (name) => {
    if (flatN.has(name)) return flatN.get(name);
    flatN.set(name, 0);
    const c = lib.cells[name]; let n = c ? shapeCount(c) : 0;
    if (c) for (const r of c.refs) n += (r.cols || 1) * (r.rows || 1) * countFlat(r.cell);
    flatN.set(name, n); return n;
  };
  const markBox = (b) => {
    if (!b || !(b.x2 >= b.x1)) return;
    bbAll = bbAll ? { x1: Math.min(bbAll.x1, b.x1), y1: Math.min(bbAll.y1, b.y1), x2: Math.max(bbAll.x2, b.x2), y2: Math.max(bbAll.y2, b.y2) } : { ...b };
    const i0 = Math.floor(b.x1 / F), i1 = Math.floor((b.x2 - 1e-6) / F), j0 = Math.floor(b.y1 / F), j1 = Math.floor((b.y2 - 1e-6) / F);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fields.add(`${i},${j}`);
  };
  const boxCache = new Map();
  const cellBox = (name) => {
    if (boxCache.has(name)) return boxCache.get(name);
    boxCache.set(name, null);
    const c = lib.cells[name]; let bb = null;
    const u = (b) => { if (b) bb = bb ? { x1: Math.min(bb.x1, b.x1), y1: Math.min(bb.y1, b.y1), x2: Math.max(bb.x2, b.x2), y2: Math.max(bb.y2, b.y2) } : b; };
    if (c) { for (const s of shapesOf(c)) if (exposed(s.layer)) u(bboxWorld(s)); for (const r of c.refs) u(refBox(r)); }
    boxCache.set(name, bb); return bb;
  };
  const elemT = (r, i, j) => ({ ...gdsLinear(r), e: r.x + i * r.colStep[0] + j * r.rowStep[0], f: r.y + i * r.colStep[1] + j * r.rowStep[1] });
  function refBox(r) {
    const b = cellBox(r.cell); if (!b) return null;
    let out = null;
    for (const i of [0, (r.cols || 1) - 1]) for (const j of [0, (r.rows || 1) - 1]) {
      const t = applyBBox(elemT(r, i, j), b);
      out = out ? { x1: Math.min(out.x1, t.x1), y1: Math.min(out.y1, t.y1), x2: Math.max(out.x2, t.x2), y2: Math.max(out.y2, t.y2) } : t;
    }
    return out;
  }
  // A shape larger than a field: its outline, not its box (a frame's box covers the whole chip). The
  // inside is sampled on an eighth of a field and the edges walked, as the estimator's raster did.
  const markOutline = (s, T) => {
    const pts = outlineWorld(s, Math.max(1, F / 64)).map(([x, y]) => [T.a * x + T.c * y + T.e, T.b * x + T.d * y + T.f]);
    const b = applyBBox(T, bboxWorld(s)), g = F / 8;
    bbAll = bbAll ? { x1: Math.min(bbAll.x1, b.x1), y1: Math.min(bbAll.y1, b.y1), x2: Math.max(bbAll.x2, b.x2), y2: Math.max(bbAll.y2, b.y2) } : { ...b };
    const mark = (x, y) => fields.add(`${Math.floor(x / F)},${Math.floor(y / F)}`);
    // edge samples are nudged 1 nm to the inside, so an edge lying on a field boundary (a chip frame
    // at ±4 mm) does not claim the empty field beyond it
    let A2 = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) A2 += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    const side = A2 >= 0 ? 1 : -1;                                     // counter-clockwise: inside is on the left
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x0, y0] = pts[j], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0);
      if (!(L > 0)) continue;
      const nx = (-(y1 - y0) / L) * side, ny = ((x1 - x0) / L) * side, n = Math.max(1, Math.ceil(L / (g / 2)));
      for (let k = 0; k <= n; k++) mark(x0 + (x1 - x0) * k / n + nx, y0 + (y1 - y0) * k / n + ny);
    }
    for (let x = Math.floor(b.x1 / g) * g + g / 2; x < b.x2; x += g) for (let y = Math.floor(b.y1 / g) * g + g / 2; y < b.y2; y += g) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], c = pts[j]; if ((a[1] > y) !== (c[1] > y) && x < ((c[0] - a[0]) * (y - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside; }
      if (inside) mark(x, y);
    }
  };
  const rectExact = (s, T) => (s.kind === 'rect' && !s.rot && T.b === 0 && T.c === 0);
  function walk(name, T, depth) {
    if (depth > 32) throw new Error('hierarchy deeper than 32 levels');
    const c = lib.cells[name]; if (!c) return;
    for (const s of shapesOf(c)) {
      if (!exposed(s.layer)) continue;
      budget--;
      const b = applyBBox(T, bboxWorld(s));
      if (!rectExact(s, T) && (b.x2 - b.x1 > F || b.y2 - b.y1 > F)) markOutline(s, T); else markBox(b);
    }
    for (const r of c.refs) {
      const n = (r.cols || 1) * (r.rows || 1), need = n * countFlat(r.cell);
      if (need > budget) { approx = true; markBox(applyBBox(T, refBox(r))); continue; }
      for (let i = 0; i < (r.cols || 1); i++) for (let j = 0; j < (r.rows || 1); j++) walk(r.cell, compose(T, elemT(r, i, j)), depth + 1);
    }
  }
  walk(lib.top, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 0);

  const doses = [...top.dose].filter(([, a]) => a > 0).map(([dose, areaNm2]) => ({ dose, areaNm2, layers: [...(top.layers.get(dose) || [])].sort() })).sort((a, b) => a.dose - b.dose);
  const areaNm2 = doses.reduce((s, d) => s + d.areaNm2, 0);
  return {
    doses, areaNm2, figures: top.figures, shapes: top.shapes, fields: fields.size, fieldsApprox: approx,
    bbox: bbAll, fieldUm, subfieldUm, skippedLayers: [...skipped],
    charge: doses.reduce((s, d) => s + d.dose * d.areaNm2, 0) * 1e-6 * 1e-14,      // C: µC/cm² · nm²
  };
}

// ---------------------------------------------------------------- dose ranks (MODULAT)
// One rank per dose, in rising order, as percent of the base dose, rounded to 0.1 % (the JDF
// examples' precision). More doses than maxRanks: log-spaced levels between the extremes and each
// dose to the nearest (its rounding error is reported).
// levels: the dose classes of fractured writing data. Then rank k is class k (the GDS datatype the
// dose-class export gives it), every class is listed, and no class is renumbered.
export function doseRanks(doses, baseDose, { maxRanks = 256, decimals = 1, levels: fixed = null } = {}) {
  if (!(baseDose > 0)) throw new Error('the base dose (RESIST) must be > 0');
  let levels = fixed ? [...fixed] : doses.map((d) => d.dose);
  let quantized = false;
  if (!fixed && levels.length > maxRanks) {
    const lo = Math.log(levels[0]), hi = Math.log(levels[levels.length - 1]);
    levels = Array.from({ length: maxRanks }, (_, k) => Math.exp(lo + (hi - lo) * k / (maxRanks - 1)));
    quantized = true;
  }
  const q = 10 ** decimals;
  const ranks = levels.map((dose, rank) => {
    const pct = Math.round((dose / baseDose - 1) * 100 * q) / q;
    return { rank, pct, factor: 1 + pct / 100, dose: baseDose * (1 + pct / 100), areaNm2: 0, wanted: [] };
  });
  let worst = 0;
  for (const d of doses) {
    let best = 0;
    for (let k = 1; k < ranks.length; k++) if (Math.abs(Math.log(ranks[k].dose / d.dose)) < Math.abs(Math.log(ranks[best].dose / d.dose))) best = k;
    ranks[best].areaNm2 += d.areaNm2; ranks[best].wanted.push(d.dose);
    worst = Math.max(worst, Math.abs(ranks[best].dose / d.dose - 1));
  }
  const used = fixed ? ranks : ranks.filter((r) => r.areaNm2 > 0);
  if (!fixed) used.forEach((r, k) => { r.rank = k; });
  const single = used.length === 1 && Math.abs(used[0].pct) < 1e-9;
  for (const r of used) r.layers = [...new Set(doses.filter((d) => r.wanted.includes(d.dose)).flatMap((d) => d.layers || []))].sort();
  return { ranks: used, baseDose, worstRounding: worst, quantized, single, fixed: !!fixed };
}

// ---------------------------------------------------------------- write time
// plan: { stats, ranks, pitchNm, stdcurNA, ffocus, path, calprm, prevCalprm, instances, transport }
export function writeTime(plan, profile) {
  const M = profile.time;
  const { stats, ranks, pitchNm, stdcurNA } = plan;
  const n = Math.max(1, plan.instances || 1);
  const tShotNs = (ranks.baseDose * pitchNm * pitchNm) / (stdcurNA * 100);  // µC/cm² · nm² / nA → ns
  const warnings = [];
  let exposure = 0;
  for (const r of ranks.ranks) exposure += (r.areaNm2 / (pitchNm * pitchNm)) * tShotNs * r.factor * 1e-9;
  exposure *= n;
  const shots = (stats.areaNm2 / (pitchNm * pitchNm)) * n;
  const figures = stats.figures * M.figureOverheadS * n;
  const moves = stats.fields * n;
  const stage = moves > 0 ? moves * M.stageMoveS + M.stageLayerS : 0;
  // DRF5M's INITIAL calibration is CURRNT,HEIMAP whatever FFOCUS says: FFOCUS only decides whether each
  // field is refocused from the height map (the DTU .sdf: "if not there will use only the HEIMAP points")
  const initial = M.initialCurrntS + (plan.path && plan.path !== 'DRF5M' && !plan.ffocus ? 0 : M.initialHeimapS);
  const work = exposure + figures + stage;
  const nCyc = Math.floor(work / M.cyclicPeriodS) + 1;
  const cyclic = nCyc * M.cyclicCycleS;
  const pre = M.cassettePreS + (plan.prevCalprm && plan.prevCalprm !== plan.calprm ? M.currentChangeS : 0);
  const other = pre + M.dataTransferS + M.layerEndS;
  const total = exposure + figures + stage + initial + cyclic + other;
  const transport = plan.transport === false ? 0 : M.transportS;
  const written = ranks.ranks.filter((r) => r.areaNm2 > 0);        // an unused class never fires a shot
  const minFactor = Math.min(...written.map((r) => r.factor));
  const maxFactor = Math.max(...written.map((r) => r.factor));
  const shortest = tShotNs * minFactor;
  if (shortest < profile.minShotNs) warnings.push({ level: 'error', text: `The shortest shot is ${shortest.toFixed(2)} ns (lowest rank ×${minFactor.toFixed(3)}), below the ${profile.minShotNs} ns limit of the 100 MHz scanner: the exposure will fail. Use a lower current or a larger beam pitch.` });
  else if (shortest < 1.15 * profile.minShotNs) warnings.push({ level: 'warn', text: `The shortest shot is ${shortest.toFixed(2)} ns, within 15 % of the ${profile.minShotNs} ns limit: a beam current a little above STDCUR would break it.` });
  return {
    tShotNs, shortestShotNs: shortest, longestShotNs: tShotNs * maxFactor, shots, moves, cycles: nCyc,
    parts: { exposure, figures, stage, initial, cyclic, other }, total, transport, withTransport: total + transport,
    warnings,
  };
}

// Write time for every beam condition of the profile: the planner's "which current?" table.
export function currentSweep(plan, profile) {
  return profile.calprm.map((c) => {
    const stdcur = +(c.nA * profile.stdcurOverNominal).toFixed(2);
    const t = writeTime({ ...plan, stdcurNA: stdcur, calprm: c.name }, profile);
    return { ...c, stdcur, total: t.total, shortestShotNs: t.shortestShotNs, ok: t.shortestShotNs >= profile.minShotNs };
  });
}

// ---------------------------------------------------------------- the job files
const num = (v, d = 3) => String(+(+v).toFixed(d));

// MODULAT table in the JDF's own layout: three ranks per line, continuation lines begin with '-'
function modulatLines(name, ranks) {
  const items = ranks.map((r) => `( ${r.rank}, ${r.pct.toFixed(1).padStart(4)} )`);
  const lines = [];
  for (let i = 0; i < items.length; i += 3) {
    const chunk = items.slice(i, i + 3).join(' , ');
    lines.push(i === 0 ? `${name}: MODULAT (${chunk}` : `-     , ${chunk}`);
  }
  lines[lines.length - 1] += ')';
  return lines;
}

export function arrayPositions(a) {
  const out = [];
  for (let c = 1; c <= a.nx; c++) for (let w = 1; w <= a.ny; w++) out.push([a.x0 + (c - 1) * a.dx, a.y0 - (w - 1) * a.dy]);
  return out;
}

// job: { jdfName, jobName, waferIn, path, array: {x0, nx, dx, y0, ny, dy}, v30, stdcurNA, ranks,
//        magazine, shelf, slot, calprm, baseDose, shotN, ffocus, offset: [x, y], note }
export function jdfText(job) {
  const modName = 'MOD001', withMod = !job.ranks.single;
  const a = job.array;
  const L = [
    `;${job.jdfName}.jdf  ${job.note || ''}`.trimEnd(),
    `JOB/W  '${job.jobName}', ${job.waferIn}`,
    '',
    `PATH ${job.path}`,
    `  ARRAY (${num(a.x0)},${a.nx},${num(a.dx)})/(${num(a.y0)},${a.ny},${num(a.dy)})`,
    withMod ? `    ASSIGN P(1) -> ((*,*), ${modName})` : '    ASSIGN P(1) -> (*,*)',
    '  AEND',
    'PEND',
    '',
    'LAYER 1',
    `  P(1) '${job.v30}'`,
    `  STDCUR ${num(job.stdcurNA, 2)}`,
    '',
  ];
  if (withMod) L.push(...modulatLines(modName, job.ranks.ranks), '');
  L.push('END', '');
  return L.join('\r\n');
}

export function sdfText(job) {
  const L = [
    `;${job.magazine.toLowerCase()}.sdf  ${job.note || ''}`.trimEnd(),
    `MAGAZIN '${job.magazine}'`,
    '',
    `#${job.shelf}`,
    `%${job.slot}`,
    `JDF '${job.jdfName}',1`,
    'ACC 100',
    `CALPRM '${job.calprm}'`,
    'DEFMODE 2',
  ];
  if (job.ffocus) L.push('FFOCUS');
  L.push(`RESIST ${num(job.baseDose, 1)}`, `SHOT A,${job.shotN}`, `OFFSET(${num(job.offset[0])},${num(job.offset[1])})`, '', `END ${job.shelf}`, '');
  return L.join('\r\n');
}

// Problems that would stop SCHD or the exposure: [{level: 'error'|'warn', text}]
export function checkPlan(job, time, profile) {
  const out = [];
  const R = profile.rules;
  if (!R.magazine.re.test(job.magazine)) out.push({ level: 'error', text: `${R.magazine.text}: '${job.magazine}'` });
  if (!R.jdf.re.test(job.jdfName)) out.push({ level: 'error', text: `${R.jdf.text}: '${job.jdfName}'` });
  if (!R.job.re.test(job.jobName)) out.push({ level: 'error', text: `${R.job.text}: '${job.jobName}'` });
  if (!R.v30.re.test(job.v30)) out.push({ level: 'error', text: `${R.v30.text}: '${job.v30}'` });
  if (!(job.shotN >= 1 && Number.isInteger(job.shotN))) out.push({ level: 'error', text: `SHOT A,n needs a whole number n ≥ 1 (the pitch in units of ${profile.pitchUnitNm} nm)` });
  if (!profile.calprm.some((c) => c.name === job.calprm)) out.push({ level: 'warn', text: `CALPRM '${job.calprm}' is not in the list of known beam conditions — check that the machine has it` });
  if (!/^\d+$/.test(String(job.shelf))) out.push({ level: 'error', text: 'The autoloader shelf (#) must be a number' });
  if (!/^[0-9A-Za-z]{1,3}$/.test(String(job.slot))) out.push({ level: 'error', text: 'The cassette slot (%) must be like 3C or 4A' });
  if (job.ranks.ranks.length > profile.maxRanks) out.push({ level: 'error', text: `${job.ranks.ranks.length} dose ranks: more than ${profile.maxRanks}` });
  if (job.ranks.worstRounding > 0.005) out.push({ level: 'warn', text: `Rounding the doses to the ranks moves a dose by up to ${(100 * job.ranks.worstRounding).toFixed(2)} %` });
  if (time) out.push(...time.warnings);
  return out;
}

// ---------------------------------------------------------------- JEOL's own estimate (wrtest CSV)
const hms = (s) => { const p = String(s).trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : NaN; };
export function parseWrtestCSV(text) {
  if (!/wrtest/i.test(text.slice(0, 300))) return null;
  const rows = text.split(/\r?\n/).map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim()));
  const res = { totals: {}, layers: [] };
  let sec = 'top', layer = null, pat = null, path = null;
  for (const r of rows) {
    const k = r[0]; if (!k) continue; const v = r[1];
    if (k === 'LAYER') { layer = { n: +v, patterns: [], paths: [] }; res.layers.push(layer); sec = 'layer'; continue; }
    if (k === 'PATTERN') { pat = { n: +v }; layer.patterns.push(pat); sec = 'pattern'; continue; }
    if (k === 'PATH') { path = { n: +v }; layer.paths.push(path); sec = 'path'; continue; }
    if (k === 'Magazine ending') { sec = 'end'; continue; }
    const tgt = sec === 'top' ? res.totals : sec === 'layer' ? layer : sec === 'pattern' ? pat : sec === 'path' ? path : null;
    if (!tgt || k.startsWith('#')) continue;
    if (/time/i.test(k) && /^\d+:\d\d:\d\d$/.test(v)) tgt[k] = hms(v);
    else if (/count|current|sens|step|psec|No\.|Shot count/i.test(k) && v !== '' && !isNaN(+v)) tgt[k] = +v;
    else tgt[k] = v;
  }
  return res;
}

export function fmtHMS(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
