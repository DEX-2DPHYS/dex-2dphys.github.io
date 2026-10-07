// Fab Studio voxel engine: the Micro and Nanofabrication Studio v2 process
// engine (l.1736–2467, 2846–2898, 4194–4272), ported without the DOM. Every step is a function
// of the grid and explicit parameters; the UI, the recipe files and the replay machinery call
// the same functions, so a recipe replays identically to the standalone studio.
//
// Grid: s.grid[z] is a Uint8Array(W·H) of material ids (materials.js); x lateral, y down the
// column (y = 0 is the top of the air head-room, y = H−1 the bottom of the Si), z the depth
// slice. Voxels are nmLat × nmVert × nmLat nm.
//
// Exposure dose comes from one of three sources (params.source):
//   'pattern'  the studio's built-in patterns (grating, single line, trench, dots, blanket)
//   'custom'   the studio's mask shapes in write-field nm (recipes imported from the standalone)
//   'layout'   dose maps supplied by the caller: ctx.doseMaps[z] = Float32Array(W) in µC/cm²,
//              i.e. the Workbench exposure engine evaluated on a device area

import {
  M, MAT_MAP, RESIST_MAT_MAP, RESIST_PRESETS, GRAPHENE_ML_NM, presetOf,
  isResist, isResistUnexp, toExposed, isSF6Etchable,
} from './materials.js';
import { roundedRamp } from '../physics/resist.js';
import { calibrationOf, devDeviation } from '../physics/devcal.js';
import { isotropicEtch } from './fmm.js';
import { kohSetup, kohApply } from './koh.js';
import { kohResult, kohPrepareResult } from './kohrun.js';
import { normalizeWafer } from './crystal.js';
import { developConditions, describeMove, trimCalText } from '../resists/move.js';

export const MAX_SLICES = 150;        // the standalone's cap on D

export function createFabEngine() {
  const s = {
    W: 0, H: 0, D: 1, nmLat: 20, nmVert: 2, sampleWnm: 1000, sampleDepthNm: 500, wfW: 1500, wfD: 1000, headroomNm: 300,
    grid: null, resistStates: [], substrate: null, version: 0,
  };
  const idx = (x, y) => y * s.W + x;
  const touch = () => { s.version++; };

  // ---------------------------------------------------------------- substrate
  // sub = {si, ox, poly, met (nm), nmLat, nmVert, w, d, wfW, wfD, headroom}
  function buildSubstrate(sub) {
    s.nmLat = Math.max(0.5, +sub.nmLat || 20);
    s.nmVert = Math.max(0.2, +sub.nmVert || 2);
    const vPerNm = 1 / s.nmVert, lPerNm = 1 / s.nmLat;
    const siPx = Math.max(4, Math.round((+sub.si || 200) * vPerNm));
    const oxPx = Math.max(0, Math.round((+sub.ox || 0) * vPerNm));
    const polyPx = Math.max(0, Math.round((+sub.poly || 0) * vPerNm));
    const metPx = Math.max(0, Math.round((+sub.met || 0) * vPerNm));
    s.headroomNm = +sub.headroom || 300;
    const airPx = Math.max(40, Math.round(s.headroomNm * vPerNm));   // head-room for resist + films
    s.H = siPx + oxPx + polyPx + metPx + airPx;
    s.sampleWnm = Math.max(10, +sub.w || 1000);
    s.W = Math.max(20, Math.round(s.sampleWnm * lPerNm));
    s.sampleDepthNm = Math.max(10, +sub.d || 500);
    s.D = Math.min(Math.max(1, Math.round(s.sampleDepthNm * lPerNm)), sub.maxSlices || MAX_SLICES);
    s.wfW = Math.max(s.sampleWnm, +sub.wfW || 1500);
    s.wfD = Math.max(s.sampleDepthNm, +sub.wfD || 1000);
    const siTop = s.H - siPx, oxTop = siTop - oxPx, polyTop = oxTop - polyPx, metTop = polyTop - metPx;
    const W = s.W, proto = new Uint8Array(W * s.H);
    for (let y = s.H - 1; y >= siTop; y--) for (let x = 0; x < W; x++) proto[idx(x, y)] = M.SI;
    for (let y = siTop - 1; y >= oxTop; y--) for (let x = 0; x < W; x++) proto[idx(x, y)] = M.SIO2;
    for (let y = oxTop - 1; y >= polyTop; y--) for (let x = 0; x < W; x++) proto[idx(x, y)] = M.POLYSI;
    for (let y = polyTop - 1; y >= metTop; y--) for (let x = 0; x < W; x++) proto[idx(x, y)] = M.AU;
    s.grid = [];
    for (let z = 0; z < s.D; z++) s.grid.push(new Uint8Array(proto));
    s.resistStates = [];
    s.substrate = { si: +sub.si || 200, ox: +sub.ox || 0, poly: +sub.poly || 0, met: +sub.met || 0, nmLat: s.nmLat, nmVert: s.nmVert, w: s.sampleWnm, d: s.sampleDepthNm, wfW: s.wfW, wfD: s.wfD, headroom: s.headroomNm, maxSlices: sub.maxSlices, wafer: normalizeWafer(sub.wafer), azimuth: +sub.azimuth || 0 };
    touch();
  }

  // ---------------------------------------------------------------- state copies (UI undo)
  function capture() {
    return {
      grid: s.grid.map((g) => new Uint8Array(g)), D: s.D,
      resistStates: s.resistStates.map((rs) => ({ ...rs, devParams: { ...rs.devParams }, doseMap: rs.doseMap ? new Float32Array(rs.doseMap) : null, doseMaps: rs.doseMaps ? rs.doseMaps.map((d) => new Float32Array(d)) : null })),
    };
  }
  function restore(st) { s.grid = st.grid.map((g) => new Uint8Array(g)); s.D = st.D; s.resistStates = st.resistStates.map((rs) => ({ ...rs, devParams: { ...rs.devParams }, doseMap: rs.doseMap ? new Float32Array(rs.doseMap) : null, doseMaps: rs.doseMaps ? rs.doseMaps.map((d) => new Float32Array(d)) : null })); touch(); }

  // ---------------------------------------------------------------- helpers
  function findSurface(z) {
    const g = s.grid[z !== undefined ? z : 0], surf = new Int32Array(s.W);
    for (let x = 0; x < s.W; x++) { let y = 0; while (y < s.H && g[idx(x, y)] === M.AIR) y++; surf[x] = y; }
    return surf;
  }
  function hasResist() {
    for (let z = 0; z < s.D; z++) { const g = s.grid[z]; for (let i = 0; i < s.W * s.H; i++) if (isResist(g[i])) return true; }
    return false;
  }
  // Isotropic etching is a geodesic-distance front (fmm.js): a voxel is removed when its distance
  // to the wetted surface, measured through the target, is at most the etch depth. A pinhole gives a
  // hemisphere and the undercut equals the depth. (The studio's shell peel advanced in the
  // city-block metric: a pinhole gave an octahedron, 30 % short along the diagonals.)
  const isotropic = (matchFn, depthNm) => isotropicEtch(s, matchFn, depthNm, M.AIR);

  function conformalGrow(matId, thickNm) {
    if (!(thickNm > 0)) return;
    const { W, H, D, grid } = s;
    const nV = Math.max(0, Math.round(thickNm / s.nmVert)), nL = Math.max(0, Math.round(thickNm / s.nmLat));
    const rounds = Math.max(nV, nL);
    if (!rounds) return;
    const addZ = [], addI = [];
    for (let k = 0; k < rounds; k++) {
      const doVert = Math.floor(((k + 1) * nV) / rounds) > Math.floor((k * nV) / rounds);
      const doLat = Math.floor(((k + 1) * nL) / rounds) > Math.floor((k * nL) / rounds);
      if (!doVert && !doLat) continue;
      addZ.length = 0; addI.length = 0;
      for (let z = 0; z < D; z++) {
        const g = grid[z], gB = z > 0 ? grid[z - 1] : null, gF = z < D - 1 ? grid[z + 1] : null;
        for (let y = 0; y < H; y++) {
          const row = y * W;
          for (let x = 0; x < W; x++) {
            const i = row + x;
            if (g[i] !== M.AIR) continue;
            let t = false;
            if (doVert) t = (y > 0 && g[i - W] !== M.AIR) || (y < H - 1 && g[i + W] !== M.AIR);
            if (!t && doLat) t = (x > 0 && g[i - 1] !== M.AIR) || (x < W - 1 && g[i + 1] !== M.AIR) || (gB !== null && gB[i] !== M.AIR) || (gF !== null && gF[i] !== M.AIR);
            if (t) { addZ.push(z); addI.push(i); }
          }
        }
      }
      if (!addZ.length) break;
      for (let n = 0; n < addZ.length; n++) grid[addZ[n]][addI[n]] = matId;
    }
  }

  // ---------------------------------------------------------------- steps
  function deposit(mat, thickNm, method) {
    const thickPx = Math.max(1, Math.round(thickNm / s.nmVert)), matId = MAT_MAP[mat] || M.METAL;
    if (method === 'directional') {
      for (let z = 0; z < s.D; z++) {
        const g = s.grid[z];
        for (let x = 0; x < s.W; x++) {
          let y = 0; while (y < s.H && g[idx(x, y)] === M.AIR) y++;
          for (let k = 0; k < thickPx; k++) { const dy = y - 1 - k; if (dy >= 0) g[idx(x, dy)] = matId; }
        }
      }
    } else conformalGrow(matId, thickNm);
  }

  function transfer2D(material, flakeSizeNm, layerThickNm) {
    const layerPx = Math.max(1, Math.round(layerThickNm / s.nmVert));
    const centerXNm = s.W * s.nmLat * 0.5, centerZNm = s.sampleDepthNm * 0.5;
    const depositSquare = (matId, sizeNm, thickPx, rotDeg) => {
      const half = sizeNm * 0.5, ang = ((rotDeg || 0) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
      for (let z = 0; z < s.D; z++) {
        const zNm = ((z + 0.5) * s.sampleDepthNm) / s.D, dz = zNm - centerZNm, surf = findSurface(z);
        for (let x = 0; x < s.W; x++) {
          const xNm = (x + 0.5) * s.nmLat, dx = xNm - centerXNm;
          const u = dx * ca + dz * sa, v = -dx * sa + dz * ca;
          if (Math.abs(u) > half || Math.abs(v) > half) continue;
          const y = surf[x];
          for (let k = 0; k < thickPx; k++) { const dy = y - 1 - k; if (dy >= 0 && s.grid[z][idx(x, dy)] === M.AIR) s.grid[z][idx(x, dy)] = matId; }
        }
      }
    };
    if (material === 'GRAPHENE') { depositSquare(M.GRAPHENE, flakeSizeNm, layerPx, 0); return; }
    if (material === 'MOS2') { depositSquare(M.MOS2, flakeSizeNm, layerPx, 0); return; }
    const hbnPx = Math.max(1, Math.round(layerPx * 1.2)), grPx = Math.max(1, Math.round(layerPx * 0.6));
    depositSquare(M.HBN, flakeSizeNm, hbnPx, 0);
    depositSquare(M.GRAPHENE, flakeSizeNm * 0.84, grPx, 0);
    depositSquare(M.HBN, flakeSizeNm * 0.98, hbnPx, 8);
  }

  // devParams = {contrast, D100, darkErosion, sidewall, scum, clearFrac, devTime}
  function spinResist(thickNm, type, preset, devParams) {
    const resPx = Math.max(1, Math.round(thickNm / s.nmVert)), matId = RESIST_MAT_MAP[preset] || M.RESIST;
    const surf = findSurface(0);
    let minSurf = s.H, maxSurf = 0;
    for (let x = 0; x < s.W; x++) { if (surf[x] < minSurf) minSurf = surf[x]; if (surf[x] > maxSurf) maxSurf = surf[x]; }
    const resistTop = Math.max(0, minSurf - resPx);
    for (let z = 0; z < s.D; z++) {
      const g = s.grid[z];
      for (let x = 0; x < s.W; x++) for (let y = resistTop; y < surf[x]; y++) if (g[idx(x, y)] === M.AIR) g[idx(x, y)] = matId;
    }
    const dp = devParams || {};
    s.resistStates.push({
      name: preset || 'custom', type, matId, matExpId: toExposed(matId), exposed: false, yTop: resistTop, yBot: maxSurf, doseMap: null, doseMaps: null,
      // `||` fallbacks exactly as the standalone reads its form (a dark erosion of 0 reads as 2 there too)
      devParams: { contrast: +dp.contrast || 3, soft: +dp.soft || 0, D100: +dp.D100 || 120, darkErosion: +dp.darkErosion || 2, sidewall: +dp.sidewall || 90, scum: +dp.scum || 0, clearFrac: +dp.clearFrac || 0.5, devTime: +dp.devTime || 60, resistThick: thickNm, legacyClearFrac: dp.clearFrac == null,
        // the development the contrast curve was measured for (devcal.js); older recipes: their dev. time, the preset's developer, room temperature
        ...(({ developer, timeS, tempC }) => ({ calDeveloper: developer, calTimeS: timeS, calTempC: tempC }))(calibrationOf(dp, presetOf(preset, dp.lib))),
        // Advanced (a resist-library curve): which resist, and the film and voltage the curve was measured at
        lib: dp.lib || null, curveId: dp.curveId || null, calThicknessNm: +dp.calThicknessNm || null, calKV: +dp.calKV || null,
        extras: dp.extras || null, calExtras: dp.calExtras || null },
    });
    return { top: resistTop, clipped: minSurf - resPx < 0 };
  }

  // Per-column exposure flags of the built-in patterns (standalone computeExposurePattern).
  function patternColumns(p, zNm) {
    const { W } = s, pxPerNm = 1 / s.nmLat, isExposed = new Uint8Array(W), pattern = p.pattern || 'grating';
    if (pattern === 'grating') {
      const pitchPx = Math.max(1, Math.round((+p.pitch || 200) * pxPerNm)), openPx = Math.max(1, Math.round((pitchPx * (+p.duty || 50)) / 100));
      for (let x = 0; x < W; x++) { const pos = ((x % pitchPx) + pitchPx) % pitchPx; isExposed[x] = pos < openPx ? 1 : 0; }
    } else if (pattern === 'single' || pattern === 'iso_trench') {
      const wPx = Math.max(1, Math.round((+p.lineW || 100) * pxPerNm)), x0 = Math.floor((W - wPx) / 2);
      for (let x = x0; x < x0 + wPx && x < W; x++) isExposed[x] = 1;
    } else if (pattern === 'dots') {
      const pitchNm = +p.dotPitch || 300, diamNm = +p.dotDiam || 80, pitchPx = Math.max(1, Math.round(pitchNm * pxPerNm)), rNm = diamNm / 2;
      let dzNm;
      if (zNm !== undefined) { const rem = ((zNm % pitchNm) + pitchNm) % pitchNm; dzNm = Math.min(rem, pitchNm - rem); }
      else { const yOff = ((+p.dotSlice || 0) / 100) * pitchNm; const rem = ((yOff % pitchNm) + pitchNm) % pitchNm; dzNm = Math.min(rem, pitchNm - rem); }
      const chordHalfPx = Math.round((dzNm < rNm ? Math.sqrt(rNm * rNm - dzNm * dzNm) : 0) * pxPerNm);
      if (chordHalfPx > 0) for (let x = 0; x < W; x++) { const dx = (((x % pitchPx) + pitchPx) % pitchPx) - pitchPx / 2; isExposed[x] = Math.abs(dx) < chordHalfPx ? 1 : 0; }
    } else if (pattern === 'blanket') isExposed.fill(1);
    return isExposed;
  }

  // Dose map of the standalone's custom mask shapes (write-field nm; sample centred in the field).
  function customDoseMap(p, zNm) {
    const { W } = s, doseMap = new Float32Array(W), pxPerNm = 1 / s.nmLat;
    const oX = (s.wfW - s.sampleWnm) / 2, oZ = (s.wfD - s.sampleDepthNm) / 2;
    for (const sh of p.maskShapes || []) {
      const sx0 = sh.xNm - oX, sz0 = sh.yNm - oZ;
      if (zNm !== undefined && (zNm < sz0 || zNm > sz0 + sh.hNm)) continue;
      const x0 = Math.max(0, Math.round(sx0 * pxPerNm)), x1 = Math.min(W, Math.round((sx0 + sh.wNm) * pxPerNm));
      if (sh.type === 'rect') { for (let x = x0; x < x1; x++) doseMap[x] += sh.dose; }
      else if (sh.type === 'poly') {
        // Workbench addition (2026-10-02): polygon, pts in write-field nm. A slice takes the
        // even-odd crossings of its scanline; a 2D cut (no z) takes the union over the polygon's
        // depth, the same "any z" rule the circle uses.
        const P = (sh.pts || []).map(([px, pz]) => [px - oX, pz - oZ]);
        if (P.length < 3) continue;
        const hit = new Uint8Array(W);
        const scan = (z) => {
          const xs = [];
          for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
            const [ax, az] = P[j], [bx, bz] = P[i];
            if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
          }
          xs.sort((a, b) => a - b);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const c0 = Math.max(0, Math.ceil(xs[k] * pxPerNm - 0.5)), c1 = Math.min(W - 1, Math.floor(xs[k + 1] * pxPerNm - 0.5));
            for (let x = c0; x <= c1; x++) hit[x] = 1;
          }
        };
        if (zNm !== undefined) scan(zNm);
        else { const n = 64; for (let k = 0; k < n; k++) scan(sz0 + ((k + 0.5) / n) * sh.hNm); }
        for (let x = 0; x < W; x++) if (hit[x]) doseMap[x] += sh.dose;
      }
      else {
        const cxNm = sx0 + sh.wNm / 2, cyNm = sz0 + sh.hNm / 2, rxNm = sh.wNm / 2, ryNm = sh.hNm / 2;
        for (let x = x0; x < x1; x++) {
          const xNm = (x + 0.5) * s.nmLat, dx = rxNm > 0 ? (xNm - cxNm) / rxNm : 2;
          if (zNm !== undefined) { const dy = ryNm > 0 ? (zNm - cyNm) / ryNm : 2; if (dx * dx + dy * dy <= 1) doseMap[x] += sh.dose; }
          else if (Math.abs(dx) <= 1) doseMap[x] += sh.dose;
        }
      }
    }
    return doseMap;
  }

  // Onset dose of the resists present: a column whose layout dose exceeds it is drawn "exposed".
  function onsetDose() {
    let d = Infinity;
    for (const rs of s.resistStates) { const p = rs.devParams; d = Math.min(d, (p.D100 || 120) * Math.pow(10, -1 / Math.max(0.5, p.contrast || 3))); }
    return Number.isFinite(d) ? d : 1;
  }

  // Exposure. p.source: 'pattern' (default) | 'custom' | 'layout' (ctx.doseMaps required).
  function expose(p, ctx) {
    if (!hasResist()) return { ok: false, msg: 'No resist to expose!' };
    const { W, H, D } = s;
    const source = p.source || (p.pattern === 'custom' ? 'custom' : 'pattern');
    const uniformDose = +p.dose || 150;
    if (source === 'layout' && !(ctx && ctx.doseMaps && ctx.doseMaps.length >= D)) return { ok: false, msg: 'No layout dose for this device area yet.' };
    const thr = source === 'layout' ? onsetDose() : 0;
    for (let z = 0; z < D; z++) {
      const g = s.grid[z], zNm = ((z + 0.5) * s.sampleDepthNm) / D;
      let newDose, isExposed;
      if (source === 'layout') {
        newDose = ctx.doseMaps[z];
        isExposed = new Uint8Array(W);
        for (let x = 0; x < W; x++) isExposed[x] = newDose[x] >= thr ? 1 : 0;
      } else if (source === 'custom') {
        newDose = customDoseMap(p, D > 1 ? zNm : undefined);
        isExposed = new Uint8Array(W);
        for (let x = 0; x < W; x++) isExposed[x] = newDose[x] > 0 ? 1 : 0;
      } else {
        newDose = new Float32Array(W);
        isExposed = p.pattern === 'dots' ? patternColumns(p, zNm) : patternColumns(p);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const m = g[idx(x, y)];
        if (isExposed[x] && isResistUnexp(m)) { g[idx(x, y)] = toExposed(m); if (source === 'pattern') newDose[x] = uniformDose; }
      }
      for (const rs of s.resistStates) {
        if (!rs.doseMaps) rs.doseMaps = [];
        while (rs.doseMaps.length <= z) rs.doseMaps.push(new Float32Array(W));
        const dm = rs.doseMaps[z];
        for (let x = 0; x < W; x++) {
          let has = false;
          for (let y = 0; y < H; y++) { const mv = g[idx(x, y)]; if (mv === rs.matExpId || mv === rs.matId) { has = true; break; } }
          if (!has) continue;
          if (source === 'layout') dm[x] += newDose[x];                 // the halo counts, below onset or not
          else if (isExposed[x]) dm[x] += newDose[x] || uniformDose;
        }
      }
    }
    for (const rs of s.resistStates) { rs.exposed = true; rs.doseMap = rs.doseMaps && rs.doseMaps[0] ? rs.doseMaps[0] : null; }
    return { ok: true };
  }

  function develop(targetResist, sidewallDeg, contrast, devTimeSec, darkErosionNmMin, clearFrac, D100val, scumNm, soft = 0) {
    const rs = s.resistStates.find((r) => r.name === targetResist);
    if (!rs) return { ok: false, msg: 'No ' + targetResist + ' resist to develop!' };
    if (!rs.exposed) return { ok: false, msg: targetResist + ' resist not exposed yet!' };
    const { W, H, D } = s;
    const matUnexp = rs.matId, matExp = rs.matExpId, isPositive = rs.type === 'positive';
    const gamma = Math.max(0.5, contrast || 3), tDev = Math.max(1, devTimeSec || 60), darkRate = Math.max(0, darkErosionNmMin || 2);
    const d100 = Math.max(1, D100val || 120), D0 = d100 * Math.pow(10, -1 / gamma);
    const resistThickNm = rs.devParams.resistThick || 120;
    const scumFrac = resistThickNm > 0 ? Math.min(0.9, Math.max(0, scumNm || 0) / resistThickNm) : 0;
    const darkLossPx = Math.round((darkRate * (tDev / 60)) / s.nmVert);
    for (let z = 0; z < D; z++) {
      const g = s.grid[z];
      const doseMap = rs.doseMaps && rs.doseMaps[z] ? rs.doseMaps[z] : rs.doseMap;
      for (let i = 0; i < W * H; i++) if (g[i] === matExp) g[i] = matUnexp;
      const hadRemoval = new Uint8Array(W);
      for (let x = 0; x < W; x++) {
        let topR = -1, botR = -1;
        for (let y = 0; y < H; y++) if (g[idx(x, y)] === matUnexp) { if (topR < 0) topR = y; botR = y; }
        if (topR < 0) continue;
        const resistH = botR - topR + 1, dose = doseMap ? doseMap[x] : 0;
        let t;
        if (dose <= 0 || (dose <= D0 && !(soft > 0))) t = 1;   // with kink rounding the curve starts below D0
        else {
          const logDose = Math.log10(dose);
          const tBase = soft > 0 ? roundedRamp(gamma * (logDose - Math.log10(D0)), soft) : Math.max(0, 1 - gamma * (logDose - Math.log10(D0)));
          const scumTail = scumFrac * Math.exp(-6 * Math.max(0, logDose - Math.log10(d100)));
          t = Math.max(tBase, scumTail);
        }
        if (!isPositive) t = 1 - t;
        const removePx = Math.round((1 - t) * resistH);
        if (removePx > 0) { hadRemoval[x] = 1; for (let k = 0; k < removePx; k++) g[idx(x, topR + k)] = M.AIR; }
      }
      if (darkLossPx > 0) for (let x = 0; x < W; x++) {
        if (hadRemoval[x]) continue;
        let topR = -1, botR = -1;
        for (let y = 0; y < H; y++) if (g[idx(x, y)] === matUnexp) { if (topR < 0) topR = y; botR = y; }
        if (topR < 0) continue;
        const remove = Math.min(darkLossPx, botR - topR + 1);
        for (let k = 0; k < remove; k++) g[idx(x, topR + k)] = M.AIR;
      }
      if (sidewallDeg !== 90) {
        const slopePerRow = Math.tan(((sidewallDeg - 90) * Math.PI) / 180);
        const edges = [], snap = new Uint8Array(g);
        for (let x = 0; x < W - 1; x++) {
          if (!hadRemoval[x] && !hadRemoval[x + 1]) continue;
          for (let y = 0; y < H; y++) {
            const a = snap[idx(x, y)], b = snap[idx(x + 1, y)];
            if (!((a === matUnexp && b === M.AIR) || (a === M.AIR && b === matUnexp))) continue;
            const resistX = a === matUnexp ? x : x + 1, airDir = a === matUnexp ? 1 : -1;
            let resistTop = y; while (resistTop > 0 && snap[idx(resistX, resistTop - 1)] === matUnexp) resistTop--;
            let resistBot = y; while (resistBot < H - 1 && snap[idx(resistX, resistBot + 1)] === matUnexp) resistBot++;
            edges.push({ resistX, airDir, resistTop, resistBot });
            y = resistBot;
          }
        }
        for (const e of edges) {
          const resistH = e.resistBot - e.resistTop + 1;
          if (sidewallDeg < 90) {
            for (let dy = 0; dy < resistH; dy++) {
              const rowY = e.resistBot - dy, shift = Math.round(Math.abs(slopePerRow) * dy);
              for (let q = 0; q < shift && q < 6; q++) { const ox2 = e.resistX - e.airDir * q; if (ox2 >= 0 && ox2 < W && rowY >= 0 && rowY < H && g[idx(ox2, rowY)] === matUnexp) g[idx(ox2, rowY)] = M.AIR; }
            }
          } else {
            for (let dy = 0; dy < resistH; dy++) {
              const rowY = e.resistTop + dy, shift = Math.round(Math.abs(slopePerRow) * dy);
              for (let q = 0; q < shift && q < 6; q++) { const ox2 = e.resistX + e.airDir * (q + 1); if (ox2 >= 0 && ox2 < W && rowY >= 0 && rowY < H && g[idx(ox2, rowY)] === M.AIR) g[idx(ox2, rowY)] = matUnexp; }
            }
          }
        }
      }
    }
    rs.exposed = false;
    return { ok: true };
  }

  function etchRIE(targetMat, depthNm, selectivity) {
    const depthPx = Math.max(1, Math.round(depthNm / s.nmVert)), resistRemovePx = Math.max(0, Math.round(depthPx / selectivity)), matId = MAT_MAP[targetMat] || M.SIO2;
    for (let z = 0; z < s.D; z++) {
      const g = s.grid[z];
      for (let x = 0; x < s.W; x++) {
        let y = 0; while (y < s.H && g[idx(x, y)] === M.AIR) y++;
        let resLeft = resistRemovePx, targetLeft = depthPx;
        while (y < s.H) {
          const m = g[idx(x, y)];
          if (isResist(m) && resLeft > 0) { g[idx(x, y)] = M.AIR; resLeft--; y++; }
          else if (m === matId && targetLeft > 0) { g[idx(x, y)] = M.AIR; targetLeft--; y++; }
          else break;
        }
      }
    }
  }
  const etchWet = (targetMat, depthNm) => { const matId = MAT_MAP[targetMat] || M.SIO2; return isotropic((m) => m === matId, depthNm); };
  // KOH on single-crystal Si: orientation-dependent, from the wafer orientation (koh.js)
  // the options the KOH level set takes (also what a native core is given, via kohSetup)
  function kohOpts(p) {
    return {
      conc: +p.conc || 30, tempC: p.temp != null ? +p.temp : 80, timeS: +p.time || 0, oxRateNmMin: p.oxRate,
      wafer: s.substrate && s.substrate.wafer, azimuth: (s.substrate && s.substrate.azimuth) || 0, AIR: M.AIR,
      isAir: (m) => m === M.AIR, isSi: (m) => m === M.SI, isPoly: (m) => m === M.POLYSI, isOx: (m) => m === M.SIO2, isAl: (m) => m === M.AL, isResist,
    };
  }
  // p.method (kohrun.js): 'auto' (default: Wulff–Jaccodine for cuts and lines, else the level set),
  // 'levelset', 'fast'. A result for the same state and settings is reused. ctx.kohMask: the level set
  // computed elsewhere (the DSW core) from kohPlan of this very state; a mask of the wrong size is ignored.
  function etchKOH(p, ctx) {
    const S = kohSetup(s, kohOpts(p));
    if (!(S.timeS > 0)) return S.out;
    const r = kohResult(S, p.method || 'auto', ctx && ctx.kohMask, ctx && ctx.kohSteps);
    S.out.removed = kohApply(s, r.mask, M.AIR);
    S.out.steps = r.steps; S.out.how = r.how; S.out.along = r.along; S.out.reused = r.reused; S.out.fronts = r.fronts || null;
    S.out.native = r.how === 'native' || r.how === 'fast-native';
    return S.out;
  }
  // before a KOH step: whether the level set is needed (and on which setup — the DSW core is then sent
  // kohPayload(S)), or a remembered / Wulff–Jaccodine result is ready
  function kohPlan(p) {
    const S = kohSetup(s, kohOpts(p));
    if (!(S.timeS > 0)) return { needLevelSet: false, S };
    const P = kohPrepareResult(S, p.method || 'auto');
    return { needLevelSet: !P.result, S: P.S, how: P.result && P.result.how };
  }
  function kohPrepare(p) { return kohPlan(p).S; }
  function etchSF6(depthNm) {
    const depthPx = Math.max(1, Math.round(depthNm / s.nmVert));
    for (let z = 0; z < s.D; z++) {
      const g = s.grid[z];
      for (let x = 0; x < s.W; x++) {
        let y = 0; while (y < s.H && g[idx(x, y)] === M.AIR) y++;
        if (y >= s.H || isResist(g[idx(x, y)])) continue;
        let left = depthPx;
        while (y < s.H && left > 0) { if (isSF6Etchable(g[idx(x, y)])) { g[idx(x, y)] = M.AIR; left--; y++; } else break; }
      }
    }
  }
  function liftoff() {
    const { W, H } = s;
    for (let z = 0; z < s.D; z++) {
      const g = s.grid[z];
      for (let i = 0; i < W * H; i++) if (isResist(g[i])) g[i] = M.AIR;
      const anchored = new Uint8Array(W * H), q = [];
      for (let x = 0; x < W; x++) { const i = idx(x, H - 1); if (g[i] !== M.AIR) { anchored[i] = 1; q.push(x, H - 1); } }
      let head = 0;   // queue index instead of shift(): same order, no O(n²)
      while (head < q.length) {
        const x = q[head++], y = q[head++];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const j = idx(nx, ny);
          if (!anchored[j] && g[j] !== M.AIR) { anchored[j] = 1; q.push(nx, ny); }
        }
      }
      for (let i = 0; i < W * H; i++) if (g[i] !== M.AIR && !anchored[i]) g[i] = M.AIR;
    }
    s.resistStates = [];
  }
  function strip() {
    for (let z = 0; z < s.D; z++) { const g = s.grid[z]; for (let i = 0; i < s.W * s.H; i++) if (isResist(g[i])) g[i] = M.AIR; }
    s.resistStates = [];
  }
  function etchExposedGraphene(nML) {
    if (nML <= 0) return;
    const budget = nML * Math.max(1, Math.round(GRAPHENE_ML_NM / s.nmVert));
    for (let z = 0; z < s.D; z++) {
      const g = s.grid[z];
      for (let x = 0; x < s.W; x++) {
        let y = 0; while (y < s.H && g[idx(x, y)] === M.AIR) y++;
        let left = budget;
        while (y < s.H && left > 0 && g[idx(x, y)] === M.GRAPHENE) { g[idx(x, y)] = M.AIR; left--; y++; }
      }
    }
  }
  function descum(timeSec, resistRateNmPerSec, grSecPerML) {
    isotropic(isResist, timeSec * resistRateNmPerSec);
    etchExposedGraphene(Math.floor(timeSec / Math.max(0.1, grSecPerML || 30)));
  }

  // ---------------------------------------------------------------- steps by type (recipe params)
  // Re-derive a develop step's resist-dependent parameters from the resist that is on the
  // sample now (standalone rederiveDevelopParams), so an edited spin step propagates.
  function rederiveDevelop(p) {
    const rs = s.resistStates.find((r) => r.name === (p.targetResist || 'PMMA'));
    if (!rs) return p;
    const dp = rs.devParams, preset = presetOf(p.targetResist, dp.lib);
    const dev = { developer: p.developer, timeS: +p.devTime || 60, tempC: p.tempC != null ? +p.tempC : null };
    // the curve's own conditions against this development, film and voltage; a library resist away from
    // them is moved by the library's model (move.js) — the studio's presets only get the warning
    const dc = developConditions(dp, preset, dev, +p.kV || null), move = dc.move;
    const calibration = dc.outside ? { outside: true, text: [dc.calibration.outside ? (move ? trimCalText(dc.calibration.text) : dc.calibration.text) : null, ...dc.other].filter(Boolean).join('; ') } : dc.calibration;
    return { ...p, sidewall: dp.sidewall || 90, contrast: move ? +move.gamma.toFixed(3) : dp.contrast || 3, soft: dp.soft || 0, darkErosion: dp.darkErosion || 2,
      clearFrac: dp.legacyClearFrac && p.clearFrac != null ? p.clearFrac : dp.clearFrac || 0.5,
      D100: move ? +move.D100.toPrecision(5) : dp.D100 || 120, scum: dp.scum || 0, developerCompatible: !!(preset && preset.developers && preset.developers.includes(p.developer)),
      calibration, move: move ? { regime: move.regime, text: describeMove(move), factor: move.factor, pm: move.pm } : null };
  }

  // Runs one step; returns {ok, msg, params} (params possibly re-derived). ctx carries layout
  // dose maps for 'layout' exposures.
  function run(type, params, ctx) {
    if (!s.grid) return { ok: false, msg: 'Build the substrate first.' };
    let p = params || {}, r = { ok: true };
    switch (type) {
      case 'deposit': deposit(p.material, +p.thickness || 30, p.method || 'directional'); r.msg = `Deposited ${+p.thickness || 30} nm (${p.method || 'directional'}).`; break;
      case 'transfer_2d': transfer2D(p.material, +p.flakeSize || 140, +p.layerThick || 1); r.msg = 'Transferred 2D material.'; break;
      case 'spinresist': {
        const info = spinResist(+p.thickness || 120, p.type || 'positive', p.resist || 'custom', p);
        r.msg = `Spun ${+p.thickness || 120} nm ${p.resist || 'custom'} (${p.type || 'positive'}).` + (info.clipped ? ' Resist thicker than the head-room: increase it in the substrate panel.' : '');
        break;
      }
      case 'expose': case 'uv_expose': r = expose(p, ctx); if (r.ok) r.msg = p.source === 'layout' ? 'Exposed with the layout dose.' : `Exposed ${p.pattern || 'grating'}.`; break;
      case 'develop': {
        p = rederiveDevelop(p);
        r = develop(p.targetResist || 'PMMA', +p.sidewall || 90, +p.contrast || 3, +p.devTime || 60, p.darkErosion != null ? +p.darkErosion : 2, p.clearFrac != null ? +p.clearFrac : 0.5, +p.D100 || 120, +p.scum || 0, +p.soft || 0);
        if (r.ok) r.msg = `Developed ${p.targetResist || 'PMMA'}: γ ${p.contrast}${p.soft ? ' (rounding ' + Math.round(100 * p.soft) + ' %)' : ''}, ${p.devTime} s${p.tempC != null ? `, ${p.tempC} °C` : ''}, dark erosion ${p.darkErosion} nm/min, ${p.sidewall}° walls.` + (p.developerCompatible === false ? ' Advisory: uncommon chemistry for this resist.' : '')
          + (p.calibration?.outside ? ` ⚠ ${p.calibration.text}` : '') + (p.move ? ` — ${p.move.text}.` : '');
        // moved by the model inside the process window: less certain, but said so; outside it: uncertain
        if (r.ok && p.calibration?.outside) { if (p.move && p.move.regime === 'window') r.modelled = p.move.text; else r.uncertain = true; r.regime = p.move?.regime || null; }
        break;
      }
      case 'etch_rie': etchRIE(p.target, +p.depth || 80, +p.selectivity || 10); r.msg = `RIE etched ${+p.depth || 80} nm of ${p.target}.`; break;
      case 'etch_wet': { const d = +p.depth || 50; etchWet(p.target, d); r.msg = `Wet etched ${d} nm of ${p.target}, isotropic: every exposed face recedes ${d} nm, so the undercut under a mask edge is ${d} nm${d < s.nmLat ? ' (below the ' + s.nmLat + ' nm lateral voxel)' : ''}.`; break; }
      case 'etch_koh': {
        const k = etchKOH(p, ctx), um = (v) => ((v * 60) / 1000).toFixed(2), w = (s.substrate && s.substrate.wafer) || normalizeWafer();
        r.msg = `KOH ${k.rates ? (+p.conc || 30) : ''} %, ${p.temp != null ? +p.temp : 80} °C, ${+p.time || 0} s on (${w.surface}) Si: (100) ${Math.round(k.depth100)} nm deep; rates (100) ${um(k.rates['100'])}, (110) ${um(k.rates['110'])}, (111) ${um(k.rates['111'])} µm/min; SiO₂ ${k.oxNmMin.toFixed(1)} nm/min.` + (k.warnings.length ? ' ' + k.warnings.join(' ') : '');
        const HOW = { wj: `exact crystal facets (Wulff–Jaccodine${k.along === 'z' || k.along === 'x' ? `, the sample is the same in every slice along ${k.along}` : ''})`, levelset: 'level set', native: 'level set on the native core', fast: 'level set, fast (edges a few nm off)', 'fast-native': 'level set, fast, on the native core' };
        if (k.how) r.msg += ` Computed by ${HOW[k.how] || k.how}${k.reused ? ' — the same state and settings as before, so the result was reused' : ''}.`;
        break;
      }
      case 'etch_sf6': etchSF6(+p.depth || 15); r.msg = `SF6 etched exposed 2D materials by ${+p.depth || 15} nm.`; break;
      case 'liftoff': liftoff(); r.msg = 'Lift-off / strip complete.'; break;
      case 'strip': strip(); r.msg = 'Resist stripped.'; break;
      case 'descum': descum(+p.time || 30, +p.rate || 0.5, +p.grSecPerML || 30); r.msg = `O₂ plasma ${+p.time || 30} s.`; break;
      default: return { ok: false, msg: 'Unknown step ' + type };
    }
    touch();
    return { ...r, params: p };
  }

  // Rebuilds the substrate and re-runs the steps. Returns the flow entries
  // [{type, params, ok, error}]; ctxFor(step, index) supplies the ctx of each step.
  function replay(substrate, steps, ctxFor) {
    buildSubstrate(substrate);
    return steps.map((st, i) => {
      const r = run(st.type, st.params, ctxFor ? ctxFor(st, i) : undefined);
      return { type: st.type, params: r.params || st.params, ok: r.ok, error: r.ok ? null : r.msg, msg: r.msg };
    });
  }

  // Column summaries for the UI.
  function surfaceProfile(z = 0) { return findSurface(z); }
  function columnMaterials(z, x) {
    const g = s.grid[z], out = [];
    for (let y = 0; y < s.H;) { const m = g[idx(x, y)]; let e = y + 1; while (e < s.H && g[idx(x, e)] === m) e++; out.push({ m, y0: y, y1: e }); y = e; }
    return out;
  }

  return { state: s, buildSubstrate, run, replay, capture, restore, surfaceProfile, columnMaterials, hasResist, patternColumns, customDoseMap, onsetDose, kohPrepare, kohPlan, _kohOpts: kohOpts };
}

// Lateral voxel size for a device area of the given extent and column budget, rounded up to a
// round number (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 × 10ⁿ nm), so the budget is an upper bound
// and the voxel size reads naturally.
export function autoVoxelNm(extentNm, columns) {
  const raw = Math.max(0.5, extentNm / Math.max(1, columns));
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= raw - 1e-9) return +(m * p).toPrecision(6);
  return 10 * p;
}
