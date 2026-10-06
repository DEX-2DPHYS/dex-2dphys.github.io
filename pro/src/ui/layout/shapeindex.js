// Spatial index of one cell's shapes, for Pattern Studio's drawing and hit tests.
//
// A flat GDS of 300 000 shapes and 5 million vertices made every frame recompute every shape's
// bounding box from its vertices, three times, before drawing anything: half a second per frame
// even zoomed in on a handful of shapes. Here each bounding box is computed once (when the cell
// changes) and the shapes are binned in a uniform grid, so a frame touches only what is on screen.
//
// Results come back in the cell's own order (ascending index): draw order and pick order are
// the same as without the index.

export function buildShapeIndex(shapes, bboxOf) {
  const n = shapes.length;
  const bb = new Float64Array(4 * n);
  let X1 = Infinity, Y1 = Infinity, X2 = -Infinity, Y2 = -Infinity;
  for (let i = 0; i < n; i++) {
    const b = bboxOf(shapes[i]), o = 4 * i;
    bb[o] = b.x1; bb[o + 1] = b.y1; bb[o + 2] = b.x2; bb[o + 3] = b.y2;
    if (b.x1 < X1) X1 = b.x1; if (b.y1 < Y1) Y1 = b.y1; if (b.x2 > X2) X2 = b.x2; if (b.y2 > Y2) Y2 = b.y2;
  }
  const ix = { n, bb, shapes, bounds: n ? { x1: X1, y1: Y1, x2: X2, y2: Y2 } : null, stamp: new Uint32Array(n), tick: 0 };
  if (!n) return ix;
  // about two shapes per grid cell, at most 1024 × 1024 cells, square-ish in world units
  const w = Math.max(X2 - X1, 1e-9), h = Math.max(Y2 - Y1, 1e-9);
  const cells = Math.min(1 << 20, Math.max(1, Math.ceil(n / 2)));
  let gx = Math.max(1, Math.min(1024, Math.round(Math.sqrt(cells * w / h))));
  let gy = Math.max(1, Math.min(1024, Math.round(cells / gx)));
  const cw = w / gx, ch = h / gy;
  // a shape spanning many grid cells is kept on its own list and tested every query
  const BIG = 64;
  const cnt = new Int32Array(gx * gy + 1), big = [];
  const range = (i) => {
    const o = 4 * i;
    const i0 = Math.min(gx - 1, Math.max(0, Math.floor((bb[o] - X1) / cw))), i1 = Math.min(gx - 1, Math.max(0, Math.floor((bb[o + 2] - X1) / cw)));
    const j0 = Math.min(gy - 1, Math.max(0, Math.floor((bb[o + 1] - Y1) / ch))), j1 = Math.min(gy - 1, Math.max(0, Math.floor((bb[o + 3] - Y1) / ch)));
    return [i0, i1, j0, j1];
  };
  const isBig = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [i0, i1, j0, j1] = range(i);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > BIG) { isBig[i] = 1; big.push(i); continue; }
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) cnt[j * gx + k + 1]++;
  }
  for (let c = 1; c <= gx * gy; c++) cnt[c] += cnt[c - 1];
  const start = cnt.slice();
  const items = new Int32Array(cnt[gx * gy]);
  const fill = cnt.slice(0, gx * gy);
  for (let i = 0; i < n; i++) {
    if (isBig[i]) continue;
    const [i0, i1, j0, j1] = range(i);
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) items[fill[j * gx + k]++] = i;
  }
  Object.assign(ix, { gx, gy, cw, ch, start, items, big: Int32Array.from(big) });
  return ix;
}

// Indices of the shapes whose bounding box meets the rectangle, ascending. `all` when the
// rectangle holds the whole cell skips the grid entirely.
export function queryShapeIndex(ix, x1, y1, x2, y2) {
  const { n, bb, bounds } = ix;
  if (!n || x2 < bounds.x1 || x1 > bounds.x2 || y2 < bounds.y1 || y1 > bounds.y2) return new Int32Array(0);
  if (x1 <= bounds.x1 && y1 <= bounds.y1 && x2 >= bounds.x2 && y2 >= bounds.y2) {
    const all = new Int32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }
  if (++ix.tick === 0xffffffff) { ix.stamp.fill(0); ix.tick = 1; }
  const t = ix.tick, st = ix.stamp, out = [];
  const take = (i) => {
    if (st[i] === t) return;
    st[i] = t;
    const o = 4 * i;
    if (bb[o + 2] >= x1 && bb[o] <= x2 && bb[o + 3] >= y1 && bb[o + 1] <= y2) out.push(i);
  };
  const { gx, gy, cw, ch, start, items, big } = ix;
  const i0 = Math.max(0, Math.floor((x1 - bounds.x1) / cw)), i1 = Math.min(gx - 1, Math.floor((x2 - bounds.x1) / cw));
  const j0 = Math.max(0, Math.floor((y1 - bounds.y1) / ch)), j1 = Math.min(gy - 1, Math.floor((y2 - bounds.y1) / ch));
  for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
    const c = j * gx + k;
    for (let q = start[c]; q < start[c + 1]; q++) take(items[q]);
  }
  for (let q = 0; q < big.length; q++) take(big[q]);
  const r = Int32Array.from(out);
  r.sort();
  return r;
}
