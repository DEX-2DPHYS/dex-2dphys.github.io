// Device areas → Fab Studio sample geometry and dose grids.
//
// A device area is a rectangle on the device layer of the top cell. Fab Studio simulates it
//   in 3D       W = width / nmLat columns, D = height / nmLat slices (z = world +y)
//   as a 2D cut  a one-slice sample along the area's long side through its centre
// or, without a layout, a free-standing sample of the recipe's own size.
// The lateral voxel size follows a fixed column budget (autoVoxelNm), so a 2 µm gate and a
// 200 µm pad are both simulated with the same number of columns.

import { autoVoxelNm, MAX_SLICES } from './engine.js';

export const BUDGETS = {
  '3d': [{ label: 'fast (100 × 100)', columns: 10000 }, { label: 'normal (200 × 200)', columns: 40000 }, { label: 'fine (300 × 300)', columns: 90000 }],
  '2d': [{ label: 'fast (1000 columns)', columns: 1000 }, { label: 'normal (2000 columns)', columns: 2000 }, { label: 'fine (5000 columns)', columns: 5000 }],
};

// Sample geometry for an area in a mode. Returns {w, d, nmLat, W, D, grid, axis, origin}.
//   grid: the exposure-engine raster that fills doseMaps (dx = nmLat, cell centres = columns)
//   axis: 'x' or 'y' — which world axis the Fab Studio x axis runs along (2D cuts only)
export function sampleFor(area, mode, columns, nmLatOverride = null) {
  const bb = area.bb, w = bb.x2 - bb.x1, h = bb.y2 - bb.y1;
  if (mode === '3d') {
    const nmLat = nmLatOverride || autoVoxelNm(Math.sqrt(w * h), Math.sqrt(columns));
    let W = Math.max(20, Math.round(w / nmLat)), D = Math.max(1, Math.round(h / nmLat));
    // the engine's slice cap: the block is then cropped in y, centred on the area
    const cropped = D > MAX_SLICES;
    if (cropped) D = MAX_SLICES;
    const y0 = cropped ? (bb.y1 + bb.y2) / 2 - (D * nmLat) / 2 : bb.y1;
    return { w, d: h, nmLat, W, D, axis: 'x', origin: [bb.x1, y0], cropped,
      grid: { x0: bb.x1, y0, dx: nmLat, nx: W, ny: D }, depthNm: D * nmLat };
  }
  // 2D cut along the long side through the centre
  const alongX = w >= h, L = alongX ? w : h;
  const nmLat = nmLatOverride || autoVoxelNm(L, columns);
  const W = Math.max(20, Math.round(L / nmLat));
  const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
  const grid = alongX ? { x0: bb.x1, y0: cy - nmLat / 2, dx: nmLat, nx: W, ny: 1 } : { x0: cx - nmLat / 2, y0: bb.y1, dx: nmLat, nx: 1, ny: W };
  return { w: L, d: nmLat, nmLat, W, D: 1, axis: alongX ? 'x' : 'y', origin: alongX ? [bb.x1, cy] : [cx, bb.y1], grid, depthNm: nmLat, cut: alongX ? { a: [bb.x1, cy], b: [bb.x2, cy] } : { a: [cx, bb.y1], b: [cx, bb.y2] } };
}

// The Exposure tab's cut-line as a 2D sample: points along the line at nmLat spacing.
export function sampleForLine(a, b, columns, nmLatOverride = null) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nmLat = nmLatOverride || autoVoxelNm(L, columns);
  const W = Math.max(20, Math.round(L / nmLat));
  const pts = [];
  for (let i = 0; i < W; i++) { const t = (i + 0.5) / W; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  return { w: L, d: nmLat, nmLat, W, D: 1, axis: 'line', origin: a, points: pts, depthNm: nmLat, cut: { a, b } };
}

// Dose maps from an exposure raster (Float32Array nx·ny, row-major, j along y) for a sample.
export function doseMapsFromRaster(sample, data) {
  const { W, D, grid } = sample;
  const maps = [];
  if (grid.ny === 1 && grid.nx === W) {           // 3D (D rows) or a cut along x
    for (let z = 0; z < D; z++) maps.push(Float32Array.from(data.subarray(z * W, (z + 1) * W)));
    return maps;
  }
  if (grid.nx === 1) {                              // a cut along y: the column index is j
    maps.push(Float32Array.from(data.subarray(0, W)));
    return maps;
  }
  for (let z = 0; z < D; z++) maps.push(Float32Array.from(data.subarray(z * W, (z + 1) * W)));
  return maps;
}
