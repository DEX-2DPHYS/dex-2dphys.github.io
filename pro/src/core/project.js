// Project files (*.ebw.json) and legacy imports.
//
// { format: 'ebl-workbench-project', version: 2, saved, library, psf, view, settings, fab, session }
//   version 2 adds `session`: every tab's state (drawing aids, nominal dose, kept PSF curves, map
//   view, cut-line, an unapplied correction, the raster (Wiener) correction as base64 Float32,
//   3D and Fab Studio views, the open tab). Version 1 files still open.

import { makeLibrary, makeCell, DEVICE_LAYER, HRES_LAYER } from './geom/library.js';
import { makeRect, makeCircle, uid } from './geom/shapes.js';
import { fromPPSParams } from './psf/analytic.js';

export const PROJECT_FORMAT = 'ebl-workbench-project';

export function defaultPsfSettings() {
  // Monte Carlo is the default source (Peter, 2026-10-06); until a run finishes, the PSF from beam
  // energy & substrate below is the one in use, as with any MC setting without a result
  return { mode: 'mc', energyKeV: 100, substrate: 'Si', resistNm: 100, alphaMinNm: 8, eta: null, alpha: null, beta: null };
}

export function makeProject() {
  return { library: makeLibrary(), psf: defaultPsfSettings(), view: null, settings: {} };
}

export function projectToJSON(p) {
  return JSON.stringify({ format: PROJECT_FORMAT, version: p.session ? 2 : 1, saved: new Date().toISOString(), ...p });
}

export function validateLibrary(lib) {
  if (!lib || typeof lib !== 'object' || !lib.cells || !lib.top) throw new Error('not a layout library');
  if (!lib.cells[lib.top]) throw new Error(`top cell ${lib.top} missing`);
  for (const [name, c] of Object.entries(lib.cells)) {
    if (c.name !== name) c.name = name;
    c.shapes ??= []; c.refs ??= [];
    for (const r of c.refs) if (!lib.cells[r.cell]) throw new Error(`cell ${name} references missing cell ${r.cell}`);
    for (const s of c.shapes) {
      if (!['rect', 'circle', 'poly'].includes(s.kind)) throw new Error(`unknown shape kind ${s.kind}`);
      s.layer ??= '1/0'; s.writeDose ??= null; s.groupId ??= null; s.rot ??= 0;
    }
  }
  lib.layers ??= [];
  // older projects have no device layer
  if (!lib.layers.some((l) => l.purpose === 'device')) lib.layers.push({ key: DEVICE_LAYER, name: 'Device areas (Fab Studio)', color: '#c9a400', visible: true, purpose: 'device' });
  if (!lib.layers.some((l) => l.purpose === 'hres') && !lib.layers.some((l) => l.key === HRES_LAYER)) lib.layers.push({ key: HRES_LAYER, name: 'High-resolution PEC zones', color: '#d0368a', visible: true, purpose: 'hres' });
  return lib;
}

// Recognise what a dropped/opened JSON file is and turn it into a project.
export function projectFromJSON(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o.format === PROJECT_FORMAT) {
    return { library: validateLibrary(o.library), psf: { ...defaultPsfSettings(), ...(o.psf || {}) }, view: o.view || null, settings: o.settings || {}, fab: o.fab || null, session: o.session || null, writing: o.writing && o.writing.library ? { ...o.writing, library: validateLibrary(o.writing.library) } : null, source: 'project' };
  }
  if (Array.isArray(o.shapes) && o.psf && ('alpha_nm' in o.psf || 'beta_nm' in o.psf)) return { ...importPPS(o), source: 'pps' };
  throw new Error('not an EBL Workbench project or a Pattern Studio export');
}

// Pattern Studio export ("proximity_correction.json"): µm, y down, radians in
// rot_deg already converted to degrees, σ-convention PSF widths.
export function importPPS(o) {
  const lib = makeLibrary('PPS_IMPORT');
  const top = lib.cells[lib.top];
  const um = (v) => v * 1000;
  for (const s of o.shapes) {
    const dose = s.targetDose ?? 100;
    let n;
    if (s.type === 'rect') n = makeRect(um(s.cx), -um(s.cy), um(s.hw), um(s.hh), dose);
    else if (s.type === 'circle') n = makeCircle(um(s.cx), -um(s.cy), um(s.r), dose);
    else if (s.type === 'poly') {
      n = { id: uid('p'), kind: 'poly', layer: '1/0', cx: um(s.cx), cy: -um(s.cy), rot: 0, pts: s.pts.map((p) => [um(p.x), -um(p.y)]), dose, writeDose: null, groupId: null };
    } else continue;
    n.rot = -(s.rot_deg || 0);                         // y flip reverses the sense of rotation
    n.writeDose = s.corrected ? s.writeDose : null;
    n.groupId = s.fusedWith || null;
    top.shapes.push(n);
  }
  const conv = fromPPSParams({ alpha: o.psf.alpha_nm, beta: o.psf.beta_nm, eta: o.psf.eta });
  return {
    library: lib,
    psf: { ...defaultPsfSettings(), mode: 'manual', energyKeV: o.psf.keV ?? 100, substrate: o.psf.substrate ?? 'Si', alpha: conv.alpha, beta: conv.beta, eta: conv.eta },
    view: null, settings: {},
    notes: [`PSF converted from PPS σ convention: α ${o.psf.alpha_nm.toFixed(2)} → ${conv.alpha.toFixed(2)} nm, β ${(o.psf.beta_nm / 1000).toFixed(2)} → ${(conv.beta / 1000).toFixed(2)} µm`],
  };
}

// The PPS start-up pattern (a pad, a dense grating, an isolated line, an isolated disc), mirrored
// into y-up, plus a dot array cell so the hierarchy is visible from the start.
export function demoProject() {
  const p = makeProject();
  const lib = p.library, top = lib.cells[lib.top];
  const R = (cx, cy, hw, hh) => makeRect(cx * 1000, -cy * 1000, hw * 1000, hh * 1000, 100);
  top.shapes.push(R(50, 60, 25, 25));
  for (let i = 0; i < 4; i++) top.shapes.push(R(128 + i * 9, 60, 1.5, 20));
  top.shapes.push(R(205, 60, 1.5, 20));
  top.shapes.push(makeCircle(165000, -105000, 8000, 100));
  const dot = makeCell('DOT');
  dot.shapes.push(makeCircle(0, 0, 250, 300));
  lib.cells.DOT = dot;
  top.refs.push({ id: uid('i'), cell: 'DOT', x: 30000, y: -150000, rot: 0, mag: 1, mirrorX: false, cols: 40, rows: 40, colStep: [1000, 0], rowStep: [0, 1000] });
  // device areas for Fab Studio: the end of the isolated line in 3D, a cut across the grating
  const d1 = makeRect(205000, -78000, 6000, 4000, 0, DEVICE_LAYER); d1.name = 'Line end (3D)';
  const d2 = makeRect(141500, -60000, 22000, 1500, 0, DEVICE_LAYER); d2.name = 'Grating cut (2D)';
  top.shapes.push(d1, d2);
  return p;
}
