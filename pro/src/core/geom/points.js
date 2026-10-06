// Point sets for the exposure engine: either an array of [x, y] (small sets: cut lines, probes) or a
// flat set {xy: Float64Array [x0, y0, x1, y1, ...], length} (the control points of a correction —
// ChipV11's contour fit has 22.7 M of them, 64 bytes each as small arrays, 16 bytes flat). Both carry
// `length`; consumers read coordinates through toXY(), which hands a flat set's own array back.
// A flat set survives postMessage as a plain object with the same two fields.

export const isFlatPoints = (p) => !!p && !Array.isArray(p) && ArrayBuffer.isView(p.xy);
export const flatPoints = (xy) => ({ xy, length: xy.length >> 1 });

export function toXY(p) {
  if (isFlatPoints(p)) return p.xy;
  const xy = new Float64Array(2 * p.length);
  for (let k = 0; k < p.length; k++) { xy[2 * k] = p[k][0]; xy[2 * k + 1] = p[k][1]; }
  return xy;
}

// bounding box of points k in `ks` (or of all of them)
export function boundsXY(xy, ks = null) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const n = ks ? ks.length : xy.length >> 1;
  for (let q = 0; q < n; q++) {
    const k = ks ? ks[q] : q, x = xy[2 * k], y = xy[2 * k + 1];
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return { x1, y1, x2, y2 };
}

// the points with indices idx, as a flat set
export function pickPoints(p, idx) {
  const src = toXY(p), xy = new Float64Array(2 * idx.length);
  for (let q = 0; q < idx.length; q++) { xy[2 * q] = src[2 * idx[q]]; xy[2 * q + 1] = src[2 * idx[q] + 1]; }
  return flatPoints(xy);
}

// Growable typed buffers (a JS number array costs 8 bytes an entry plus its doubling slack, and the
// final Int32Array.from() copy doubles the peak).
export function growI32(cap = 1024) {
  let a = new Int32Array(cap), n = 0;
  return {
    push(v) { if (n === a.length) { const b = new Int32Array(a.length * 2); b.set(a); a = b; } a[n++] = v; },
    get length() { return n; },
    finish() { return a.slice(0, n); },
  };
}
export function growF64(cap = 1024) {
  let a = new Float64Array(cap), n = 0;
  return {
    push(v) { if (n === a.length) { const b = new Float64Array(a.length * 2); b.set(a); a = b; } a[n++] = v; },
    get length() { return n; },
    finish() { return a.slice(0, n); },
  };
}
export function growU8(cap = 1024) {
  let a = new Uint8Array(cap), n = 0;
  return {
    push(v) { if (n === a.length) { const b = new Uint8Array(a.length * 2); b.set(a); a = b; } a[n++] = v; },
    get length() { return n; },
    finish() { return a.slice(0, n); },
  };
}
