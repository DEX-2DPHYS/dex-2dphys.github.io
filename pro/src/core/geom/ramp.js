// Dose-ramp arrays (Peter, 2026-10-01): an array whose dose steps along x (left → right) and/or
// y (top → bottom), linearly or logarithmically — the classic dose test.
//
// Stored as ordinary references with a dose multiplier `doseScale` (the exposure engine multiplies
// it in along the hierarchy): one AREF per column for an x ramp, one per row for a y ramp, one
// per element when both ramp. Memory stays cheap along the other axis, and every ref is one dose
// class — what GDS → BEAMER / Raith / JEOL needs. The refs of one ramp share `ramp.group`, carry
// the whole specification (for editing) and their own indices.
//
// A ramp: { from, to, mode: 'lin' | 'log', unit: 'abs' (µC/cm²) | 'factor' (×) }.

import { makeArrayCell, makeRef } from './library.js';
import { uid } from './shapes.js';

export function rampValues(r, n) {
  if (n <= 1) return [r.from];
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    out.push(r.mode === 'log' ? r.from * Math.pow(r.to / r.from, t) : r.from + (r.to - r.from) * t);
  }
  return out;
}

export function checkRamp(r, label) {
  if (!r) return;
  if (!(r.from > 0) || !(r.to > 0)) throw new Error(`${label} ramp: from and to must be positive`);
  if (r.unit !== 'abs' && r.unit !== 'factor') throw new Error(`${label} ramp: unit must be µC/cm² or ×`);
}

// Multipliers per column (x, left → right) and per row counted from the top (y).
function factors(spec) {
  const { cols, rows, base, rampX, rampY } = spec;
  if (rampX && rampY && rampX.unit === 'abs' && rampY.unit === 'abs') throw new Error('with ramps along both x and y, give one of them as a factor (×): two absolute doses cannot both hold');
  const f = (r, n) => (r ? rampValues(r, n).map((v) => (r.unit === 'abs' ? v / base : v)) : new Array(n).fill(1));
  return { fx: f(rampX, cols), fy: f(rampY, rows) };
}

// The refs of a ramp, for a cell placed with its first (bottom-left) element at origin.
function rampRefs(cell, origin, spec) {
  const { cols, rows, pitchX, pitchY, rampX, rampY } = spec;
  const { fx, fy } = factors(spec);
  const group = spec.group || uid('rg');
  const meta = { group, cols, rows, pitchX, pitchY, base: spec.base, origin: [...origin], rampX: rampX || null, rampY: rampY || null };
  const refs = [];
  const mk = (x, y, c, r, i, k, scale) => {
    const ref = makeRef(cell, { x, y, cols: c, rows: r, colStep: [pitchX, 0], rowStep: [0, pitchY] });
    ref.doseScale = scale; ref.ramp = { ...meta, i, k };          // k: row counted from the top
    refs.push(ref);
  };
  if (rampX && rampY) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const k = rows - 1 - j; mk(origin[0] + i * pitchX, origin[1] + j * pitchY, 1, 1, i, k, fx[i] * fy[k]); }
  } else if (rampX) {
    for (let i = 0; i < cols; i++) mk(origin[0] + i * pitchX, origin[1], 1, rows, i, null, fx[i]);
  } else {
    for (let j = 0; j < rows; j++) { const k = rows - 1 - j; mk(origin[0], origin[1] + j * pitchY, cols, 1, null, k, fy[k]); }
  }
  return refs;
}

// Make a dose-ramp array from shapes of `parent` (like makeArrayCell, which it uses).
// opts: { cols, rows, pitchX, pitchY, name, rampX?, rampY? } — without ramps it is a plain array.
export function makeRampArray(lib, parent, shapeIds, opts) {
  const { rampX, rampY } = opts;
  checkRamp(rampX, 'x'); checkRamp(rampY, 'y');
  const pc = lib.cells[parent];
  const moved = pc.shapes.filter((s) => shapeIds.has(s.id));
  const base = moved.find((s) => s.dose > 0)?.dose || 100;
  if (rampX && rampY) factors({ cols: 1, rows: 1, base, rampX, rampY });   // throws early on two absolute ramps
  const out = makeArrayCell(lib, parent, shapeIds, opts);
  if (!rampX && !rampY) return { ...out, refs: [out.ref] };
  const ref0 = out.ref;
  pc.refs = pc.refs.filter((r) => r !== ref0);
  const refs = rampRefs(out.cell, [ref0.x, ref0.y], { cols: opts.cols, rows: opts.rows, pitchX: opts.pitchX, pitchY: opts.pitchY, base, rampX, rampY });
  pc.refs.push(...refs);
  return { cell: out.cell, refs, group: refs[0].ramp.group };
}

export const rampGroupRefs = (cell, group) => cell.refs.filter((r) => r.ramp && r.ramp.group === group);

// Rebuild a ramp group with new settings (same cell, same origin). Ramps may be removed: the
// group then becomes one plain array.
export function updateRampArray(lib, parent, group, { cols, rows, pitchX, pitchY, rampX, rampY }) {
  checkRamp(rampX, 'x'); checkRamp(rampY, 'y');
  const pc = lib.cells[parent];
  const old = rampGroupRefs(pc, group);
  if (!old.length) throw new Error('ramp group not found');
  const m = old[0].ramp, cell = old[0].cell;
  // origin from where the group is now (it may have been moved): its bottom-left element
  const origin = [Math.min(...old.map((r) => r.x)), Math.min(...old.map((r) => r.y))];
  if (rampX && rampY) factors({ cols: 1, rows: 1, base: m.base, rampX, rampY });
  pc.refs = pc.refs.filter((r) => !(r.ramp && r.ramp.group === group));
  let refs;
  if (!rampX && !rampY) refs = [makeRef(cell, { x: origin[0], y: origin[1], cols, rows, colStep: [pitchX, 0], rowStep: [0, pitchY] })];
  else refs = rampRefs(cell, origin, { group, cols, rows, pitchX, pitchY, base: m.base, rampX, rampY });
  pc.refs.push(...refs);
  return refs;
}

// The dose label of a ramp ref: absolute when its ramp is absolute, else the factor.
export function rampLabel(ref) {
  const m = ref.ramp; if (!m) return '';
  const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(3));
  const abs = (m.rampX && m.rampX.unit === 'abs') || (m.rampY && m.rampY.unit === 'abs');
  return abs ? `${fmt(m.base * ref.doseScale)} µC/cm²` : `×${fmt(ref.doseScale)}`;
}

export function describeRamp(m) {
  const one = (r, ax) => (r ? `${ax}: ${r.from} → ${r.to}${r.unit === 'abs' ? ' µC/cm²' : ' ×'} (${r.mode === 'log' ? 'logarithmic' : 'linear'})` : '');
  return [one(m.rampX, 'x, left → right'), one(m.rampY, 'y, top → bottom')].filter(Boolean).join(' · ');
}
