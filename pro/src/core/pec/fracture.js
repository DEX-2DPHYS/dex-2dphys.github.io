// Fracturing for proximity correction.
//
// An exposed object (a shape or a fused group: polygons, outer boundaries CCW, holes CW) is cut
// into fragments that each get their own dose in the global solve:
//   corner  a sharp convex vertex (interior angle < cornerMaxDeg, e.g. pad corners, bowtie tips):
//           the part of the edge strip within cornerLen of the vertex.  Control: the vertex itself,
//           target ½ — the developed outline should pass through the corner.
//   edge    the strip of width edgeW along an edge, cut into segments of at most segLen.
//           Control: the middle of its outer edge, target ½ (like the edge of a large pad).
//   joint   an edge piece whose outer side touches another exposed object (a lead joining a pad):
//           not a developed edge. Control inside, target 1.
//   interior the object inset by edgeW, cut into tiles of `tile` (backscatter scale).
//           Control: a point inside, target 1 — so big pads stop flooding their surroundings.
//   small   objects too narrow for an inset of 1.25·edgeW stay whole: control on their longest
//           free edge, target ½ (the per-shape rule).
// The pieces partition the object: edge pieces are the ring (object − inset) cut by the bisector
// quadrilaterals of its edges, so neighbouring pieces meet on the angle bisectors.

import { intersectPolygons, differencePolygons, offsetPolygons, signedArea, unionPolygons } from '../geom/clip.js';

// cornerFrac: a corner piece takes at most this fraction of each adjacent edge (½ = as before: on a
// short edge the two corner pieces meet in the middle; ¼ leaves every edge a middle piece controlled
// at the edge's midpoint, which is where a small feature's developed edge has to land).
export const FRACTURE_DEFAULTS = { edgeW: 50, segLen: 500, cornerLen: 100, cornerMaxDeg: 135, tile: 4000, cornerFrac: 0.5 };

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const inside = (pts, x, y) => {
  let w = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    if (ay <= y) { if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++; } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
  }
  return w !== 0;
};
const insideAll = (polys, x, y) => { let k = 0; for (const p of polys) if (inside(p, x, y)) k += signedArea(p) > 0 ? 1 : -1; return k > 0; };
export const areaOf = (polys) => polys.reduce((a, p) => a + signedArea(p), 0);

// A point inside a polygon set: the centroid if it is inside, else the middle of the longest
// horizontal chord through the centroid's height.
export function interiorPoint(polys) {
  let A = 0, cx = 0, cy = 0;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    A += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(A) > 1e-12) { cx /= 3 * A; cy /= 3 * A; if (insideAll(polys, cx, cy)) return [cx, cy]; }
  const all = polys.flat(), ys = all.map((q) => q[1]), y = (Math.min(...ys) + Math.max(...ys)) / 2 + 1e-3;
  const xs = [];
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, ay] = p[j], [bx, by] = p[i];
    if ((ay <= y) !== (by <= y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  return best ? [(best[0] + best[1]) / 2, y] : all[0];
}

// slab along an edge direction u from s = t0 to t1 (a big quadrilateral)
function slab(a, u, t0, t1, big) {
  const n = [-u[1], u[0]];
  const p = (t, s) => [a[0] + u[0] * t + n[0] * s, a[1] + u[1] * t + n[1] * s];
  return [p(t0, -big), p(t1, -big), p(t1, big), p(t0, big)];
}

// covered(x, y): is (x, y) inside another exposed object? (for joints). Returns fragments
// { polys, kind, control: [x, y], target: 0.5 | 1 }.
export function fractureObject(polys, opts = {}, covered = () => false) {
  const o0 = { ...FRACTURE_DEFAULTS, ...opts };
  const area = areaOf(polys);
  if (!(area > 0)) return [];
  // ---- the edge width adapts to the object: small features get narrow strips (a 120 nm bowtie
  // triangle still gets its tips), only features thinner than a few nm stay whole
  let w = o0.edgeW;
  const fits = (d) => { const q = offsetPolygons(polys, -d); return q.length && areaOf(q) > 0.05 * area; };
  if (!fits(1.25 * w)) {
    let lo = 0, hi = 1.25 * w;
    for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    w = (0.8 * lo) / 1.25;
  }
  const o = { ...o0, edgeW: w, cornerLen: o0.cornerLen * (w / o0.edgeW) };
  const frags = [];
  if (w < (o0.minEdgeW ?? 3)) {                     // too thin for strips: whole, per-shape rule
    let best = null;
    for (const p of polys) {
      if (signedArea(p) < 0) continue;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!L) continue;
        const nn = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
        for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
          const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
          if (!covered(x + 2 * nn[0], y + 2 * nn[1])) { if (!best || L > best.L) best = { L, x, y }; break; }
        }
      }
    }
    frags.push({ polys, kind: 'small', control: best ? [best.x, best.y] : interiorPoint(polys), target: best ? 0.5 : 1 });
    return frags;
  }
  const inner = offsetPolygons(polys, -o.edgeW);
  // ---- edge strips: ring cut by the bisector quadrilateral of every edge
  const ring = differencePolygons(polys, inner);
  const big = 10 * (o.edgeW + o.cornerLen + o.segLen);
  const cornerParts = new Map();                 // vertex key → { parts, vertex }
  for (const p of polys) {
    const n = p.length;            // outer loops CCW, holes CW: either way the object lies to the left
    const M = [], sharp = [], ang = [];
    for (let i = 0; i < n; i++) {
      const prev = p[(i - 1 + n) % n], cur = p[i], next = p[(i + 1) % n];
      const e1 = norm(cur[0] - prev[0], cur[1] - prev[1]), e2 = norm(next[0] - cur[0], next[1] - cur[1]);
      const n1 = [-e1[1], e1[0]], n2 = [-e2[1], e2[0]];                                  // inward (left) normals
      const bis = norm(n1[0] + n2[0], n1[1] + n2[1]);
      const cosHalf = Math.max(0.05, bis[0] * n1[0] + bis[1] * n1[1]);
      M.push([bis[0] / cosHalf, bis[1] / cosHalf]);                                     // reaches depth 1 on both edges
      const convex = e1[0] * e2[1] - e1[1] * e2[0] > 1e-9;                             // left turn = convex for the object
      const interior = 180 - Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1]))) * 180 / Math.PI;
      sharp.push(convex && interior < o.cornerMaxDeg); ang.push(convex ? interior : 360 - interior);
    }
    // line ends: a short edge between two near-right-angle corners, with longer edges on both sides.
    // Its two corners become ONE fragment controlled at the middle of the end — pulling both
    // corner vertices to threshold would over-expose the end and lengthen the line.
    const lenOf = (i) => Math.hypot(p[(i + 1) % n][0] - p[i][0], p[(i + 1) % n][1] - p[i][1]);
    const endEdge = new Map();                    // vertex index → edge index of its line end
    for (let i = 0; i < n; i++) {
      const L = lenOf(i), j = (i + 1) % n;
      const right = (v) => sharp[v] && ang[v] > 70 && ang[v] < 110;
      if (right(i) && right(j) && L <= 2 * o0.cornerLen && lenOf((i - 1 + n) % n) > 1.5 * L && lenOf(j) > 1.5 * L) { endEdge.set(i, i); endEdge.set(j, i); }
    }
    const vKey = (v) => endEdge.has(v) ? `end:${p[endEdge.get(v)][0].toFixed(3)},${p[endEdge.get(v)][1].toFixed(3)}` : `${p[v][0].toFixed(3)},${p[v][1].toFixed(3)}`;
    const endMid = (v) => { const e = endEdge.get(v), a = p[e], b = p[(e + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    // walk the loop from a sharp corner (if any), so runs along smooth stretches do not wrap
    const first = Math.max(0, sharp.indexOf(true));
    const depth = 1.02 * o.edgeW;               // the bisector quads end at the inset outline (exact miter)
    let bucket = null;
    const flush = () => {
      if (!bucket || !bucket.parts.length) { bucket = null; return; }
      const merged = bucket.parts.length > 1 ? unionPolygons(bucket.parts) : bucket.parts;
      if (bucket.joint) frags.push({ polys: merged, kind: 'joint', control: interiorPoint(merged), target: 1 });
      else {
        let acc = 0, c = bucket.mids[0];                // the boundary point half-way along the run
        for (const m of bucket.mids) { if (acc + m.len >= bucket.len / 2) { c = m; break; } acc += m.len; }
        frags.push({ polys: merged, kind: 'edge', control: [c.x, c.y], target: 0.5 });
      }
      bucket = null;
    };
    const add = (part, len, mx, my, joint) => {
      if (bucket && (bucket.joint !== joint || bucket.len + len > o.segLen * 1.001)) flush();
      if (!bucket) bucket = { parts: [], len: 0, mids: [], joint };
      bucket.parts.push(...part); bucket.len += len; bucket.mids.push({ x: mx, y: my, len });
    };
    for (let s = 0; s < n; s++) {
      const i = (first + s) % n;
      const a = p[i], b = p[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nOut = [u[1], -u[0]];
      const quad = [a, b, [b[0] + M[(i + 1) % n][0] * depth, b[1] + M[(i + 1) % n][1] * depth], [a[0] + M[i][0] * depth, a[1] + M[i][1] * depth]];
      const piece = intersectPolygons(ring, [signedArea(quad) > 0 ? quad : quad.slice().reverse()]);
      if (!piece.length) continue;
      const sA = sharp[i], sB = sharp[(i + 1) % n];
      const cf = o.cornerFrac ?? 0.5, cA = sA ? Math.min(o.cornerLen, L * cf) : 0, cB = sB ? Math.min(o.cornerLen, L * cf) : 0;
      const put = (v, part) => { const k = vKey(v); if (!cornerParts.has(k)) cornerParts.set(k, { parts: [], vertex: endEdge.has(v) ? endMid(v) : p[v], end: endEdge.has(v), angle: ang[v] }); cornerParts.get(k).parts.push(...part); };
      if (endEdge.has(i) && endEdge.get(i) === i) { flush(); put(i, piece); continue; }          // the end edge itself
      if (sA) { flush(); put(i, intersectPolygons(piece, [slab(a, u, -big, cA, big)])); }
      if (sB) put((i + 1) % n, intersectPolygons(piece, [slab(a, u, L - cB, L + big, big)]));
      // the middle of the edge: long edges cut into ≤ segLen, short ones accumulate into runs
      const t0 = cA, t1 = L - cB, len = t1 - t0;
      if (len > 1e-6) {
        const nseg = Math.max(1, Math.ceil(len / o.segLen));
        for (let k = 0; k < nseg; k++) {
          const s0 = k === 0 && cA === 0 ? -big : t0 + (len * k) / nseg, s1 = k === nseg - 1 && cB === 0 ? L + big : t0 + (len * (k + 1)) / nseg;
          const seg = nseg === 1 && !sA && !sB ? piece : intersectPolygons(piece, [slab(a, u, s0, s1, big)]);
          if (!seg.length) continue;
          const tm = t0 + (len * (k + 0.5)) / nseg, mx = a[0] + u[0] * tm, my = a[1] + u[1] * tm;
          add(seg, len / nseg, mx, my, covered(mx + 2 * nOut[0], my + 2 * nOut[1]));
        }
      }
      if (sB) flush();
    }
    flush();
  }
  // tip: the share of the target a perfectly exposed shape gets at this vertex (interior angle / 360°,
  // ¼ for a right angle); used instead of ½ when corners are left to round (edge equalization)
  for (const { parts, vertex, end, angle } of cornerParts.values()) {
    const merged = parts.length > 1 ? unionPolygons(parts) : parts;
    if (!merged.length) continue;
    const c = interiorPoint(merged);
    const joint = covered(vertex[0] + (vertex[0] - c[0]) * 0.1, vertex[1] + (vertex[1] - c[1]) * 0.1);
    frags.push(joint ? { polys: merged, kind: 'joint', control: c, target: 1 } : { polys: merged, kind: end ? 'end' : 'corner', control: [vertex[0], vertex[1]], target: 0.5, tip: end ? 0.5 : angle / 360 });
  }
  // ---- interior tiles (on a world grid, so neighbouring objects tile alike)
  if (inner.length) {
    const xs = inner.flat().map((q) => q[0]), ys = inner.flat().map((q) => q[1]);
    const T = o.tile, i0 = Math.floor(Math.min(...xs) / T), i1 = Math.floor(Math.max(...xs) / T), j0 = Math.floor(Math.min(...ys) / T), j1 = Math.floor(Math.max(...ys) / T);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cell = [[i * T, j * T], [(i + 1) * T, j * T], [(i + 1) * T, (j + 1) * T], [i * T, (j + 1) * T]];
      const small = Math.max(...xs) - Math.min(...xs) <= T && Math.max(...ys) - Math.min(...ys) <= T;
      if (small && !(i === i0 && j === j0)) continue;             // smaller than a tile: one interior piece
      const t = small || (i0 === i1 && j0 === j1) ? inner : intersectPolygons(inner, [cell]);
      if (!t.length || areaOf(t) <= 1e-6) continue;
      frags.push({ polys: t, kind: 'interior', control: interiorPoint(t), target: 1 });
    }
  }
  return frags;
}
