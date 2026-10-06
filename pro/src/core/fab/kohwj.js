// KOH in a 2D cut by the Wulff–Jaccodine construction (2026-10-06, prototype).
//
// In a cross-section the etched silicon surface is a chain of straight facets, each moving along its
// own normal at the rate of its crystal orientation (Jaccodine, J. Appl. Phys. 33 (1962) 2643;
// Shaw, J. Cryst. Growth 47 (1979) 509). Between events every vertex — the meeting point of two
// facet lines — moves at a constant velocity, so the front is advanced from event to event, exactly:
//   · a facet shrinks to nothing: it is removed and its neighbours meet;
//   · the fronts of two openings meet under a mask: they join;
//   · a front reaches the sample edge: it turns down the edge.
// Where two facets meet, which crystal planes appear between them follows from the rate diagram
// alone (the Hopf formula for a corner): at a concave corner of the silicon the region etched is
// ∩ {p : n·(p − v) ≤ t R(n)} over the normals n between the two facets — bounded by the slowest planes
// ({111} pits, self-limiting V-grooves); at a convex corner the silicon left is ∩ {n·(p − v) ≥ t R(n)}
// — cut back by the fastest planes (mask-corner undercut). The construction is scale-free, so it is
// done once per new vertex on a fine sampling of the normals (0.05°).
//
// A mask is a mirror, as in the level set: where the front meets the silicon–mask interface it is
// continued by its mirror image, so the silicon under a mask edge is undercut along its own planes
// (none along <110> on (100), the depth along <100>). The sample edge is a mirror too.
//
// Scope of the prototype: one 2D cut (D = 1) whose silicon is a height field (the first silicon from
// the top in every column, covered by an etchant cell or a mask), single-crystal silicon only (poly-Si
// and Al refuse: the level set is used; oxide counts as a mask). The result is the etched voxels and
// the facets themselves (sharp walls at any voxel size).

import { KC } from './koh.js';
import { kohRateModel, SATO_KOH } from './crystal.js';

const DEG = Math.PI / 180;

// rate of a sample-frame normal (x along the cut, y down) in nm/s. The {111} cusp is the measured,
// sharp one: the level set softens it within 8° to hold a facet numerically, which a construction
// that tracks the facets themselves does not need (a softened minimum would bend the {111} walls).
// rate.specials: the in-plane angles of every measured family's planes that lie in the cut — the
// planes that can appear exactly (the rate table is interpolated on a grid, so its minima sit a
// fraction of a degree off them).
const sharpModels = new Map();                 // building a rate table takes ~30 ms: one per condition
function rate2D(S) {
  const key = `${S.model.concPct}|${S.model.tempC}`;
  if (!sharpModels.has(key)) sharpModels.set(key, kohRateModel(S.model.concPct, S.model.tempC, SATO_KOH, 0));
  const R = sharpModels.get(key).R, bx = S.basis.x, bu = S.basis.up, bz = S.basis.z;
  const rate = (nx, ny) => R(nx * bx[0] - ny * bu[0], nx * bx[1] - ny * bu[1], nx * bx[2] - ny * bu[2]);
  const specials = [], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const [[h, k, l]] of Object.values(SATO_KOH.rates)) {
    const perms = [[h, k, l], [h, l, k], [k, h, l], [k, l, h], [l, h, k], [l, k, h]];
    for (const p of perms) for (let sg = 0; sg < 8; sg++) {
      const m = [p[0] * (sg & 1 ? -1 : 1), p[1] * (sg & 2 ? -1 : 1), p[2] * (sg & 4 ? -1 : 1)], L = Math.hypot(...m);
      if (Math.abs(dot(m, bz)) / L < 1e-9) specials.push(Math.atan2(-dot(m, bu) / L, dot(m, bx) / L));
    }
  }
  rate.specials = specials;
  return rate;
}

// Which normals appear between nA and nB at a vertex. convex: of the silicon. Normals are sampled
// from nA towards nB the short way (or through `via` when given, for a mirrored junction, which may
// span 180°); returns the angles of the active intermediate normals in that order.
function emerging(rate, thA, thB, convex, viaTh = null) {
  let d = thB - thA;
  if (viaTh == null) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; }
  else {
    // the arc from A to B that passes through via
    let dv = viaTh - thA; while (dv < 0) dv += 2 * Math.PI;
    let db = thB - thA; while (db < 0) db += 2 * Math.PI;
    d = dv <= db ? db : db - 2 * Math.PI;
  }
  if (Math.abs(d) < 1e-9) return [];
  const n0 = Math.max(2, Math.ceil(Math.abs(d) / (0.05 * DEG)));
  const R = (th) => rate(Math.cos(th), Math.sin(th));
  let ss = [];
  for (let k = 0; k <= n0; k++) ss.push(k / n0);
  // every local minimum and maximum of the rate along the arc, refined to its exact angle: a plane
  // that appears is one of them (or a cone end), and with the sharp {111} cusp a sample 0.05° off
  // the minimum etches several times faster than the plane itself
  const r0 = ss.map((s) => R(thA + d * s)), extra = [];
  for (let k = 1; k < n0; k++) {
    const isMin = r0[k] <= r0[k - 1] && r0[k] <= r0[k + 1], isMax = r0[k] >= r0[k - 1] && r0[k] >= r0[k + 1];
    if (!isMin && !isMax) continue;
    let a = ss[k - 1], b = ss[k + 1];
    const f = (s) => (isMin ? 1 : -1) * R(thA + d * s), g = 0.6180339887;
    let c1 = b - g * (b - a), c2 = a + g * (b - a), f1 = f(c1), f2 = f(c2);
    for (let it = 0; it < 60; it++) { if (f1 < f2) { b = c2; c2 = c1; f2 = f1; c1 = b - g * (b - a); f1 = f(c1); } else { a = c1; c1 = c2; f1 = f2; c2 = a + g * (b - a); f2 = f(c2); } }
    extra.push((a + b) / 2);
  }
  // the exact planes of the measured families that lie on this arc
  for (const th of rate.specials || []) {
    let s = (th - thA) / d;
    for (const w of [-2, -1, 0, 1, 2]) { const t = s + (w * 2 * Math.PI) / d; if (t > 1e-9 && t < 1 - 1e-9) extra.push(t); }
  }
  ss = ss.concat(extra).sort((x, y) => x - y);
  const n = ss.length - 1, ths = [], Rs = [];
  for (const s of ss) { const th = thA + d * s; ths.push(th); Rs.push(R(th)); }
  // convex polygon clipped by every half-plane: concave → n·p ≤ R, convex → n·p ≥ R; edges labelled
  const Rm = Math.max(...Rs), B = 1e4 * Rm;
  let poly = [[-B, -B, -1], [B, -B, -1], [B, B, -1], [-B, B, -1]];   // [x, y, label of the edge starting here]
  for (let k = 0; k <= n; k++) {
    const sgn = convex ? -1 : 1, ax = sgn * Math.cos(ths[k]), ay = sgn * Math.sin(ths[k]), b = sgn * Rs[k];
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      const fp = ax * P[0] + ay * P[1] - b, fq = ax * Q[0] + ay * Q[1] - b;
      if (fp <= 0) out.push(P);
      if ((fp <= 0) !== (fq <= 0)) {
        const t = fp / (fp - fq), X = [P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])];
        // the new point starts an edge along the clipping line when we are leaving, else P's edge continues
        out.push(fp <= 0 ? [X[0], X[1], k] : [X[0], X[1], P[2]]);
      }
    }
    poly = out;
    if (!poly.length) return [];
  }
  // edges along a sampled normal, longer than a tiny fraction of the scale. Planes within 1° of each
  // other are one plane resolved twice (kinks of the interpolated table): the slowest of them is kept
  // at a concave corner, the fastest at a convex one
  const tol = 1e-7 * Rm, act = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], lab = P[2];
    if (lab < 0) continue;
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (len > tol) act.push({ k: lab, len });
  }
  act.sort((a, b) => a.k - b.k);
  const merged = [], better = (a, b) => (convex ? Rs[a.k] > Rs[b.k] : Rs[a.k] < Rs[b.k]);
  for (const a of act) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(ths[a.k] - ths[last.k0]) < 1 * DEG) { if (better(a, last)) last.k = a.k; }
    else merged.push({ k: a.k, k0: a.k });
  }
  const end = 0.2 * DEG;
  return merged.filter((a) => Math.abs(ths[a.k] - thA) > end && Math.abs(ths[a.k] - (thA + d)) > end).map((a) => ths[a.k]);
}

const facet = (th, c, rate) => { const nx = Math.cos(th), ny = Math.sin(th); return { th, nx, ny, c, r: rate(nx, ny) }; };
// the facet along a segment p→q with the silicon on its right (n = (−t_y, t_x), y down)
function facetOf(p, q, rate) {
  const tx = q[0] - p[0], ty = q[1] - p[1], l = Math.hypot(tx, ty), nx = -ty / l, ny = tx / l;
  return { th: Math.atan2(ny, nx), nx, ny, c: nx * p[0] + ny * p[1], r: rate(nx, ny) };
}
const meet = (a, b) => {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-12) return null;
  return {
    p: [(a.c * b.ny - a.ny * b.c) / det, (a.nx * b.c - a.c * b.nx) / det],
    w: [((a.r || 0) * b.ny - a.ny * (b.r || 0)) / det, (a.nx * (b.r || 0) - (a.r || 0) * b.nx) / det],
  };
};
const mirrorN = (f, an) => { const d = f.nx * an.nx + f.ny * an.ny; return [f.nx - 2 * d * an.nx, f.ny - 2 * d * an.ny]; };

// S: kohSetup(...) with D = 1. → {mask, steps (events), facets, fronts: [[x, y]…] per front} or null
export function kohWulff2D(S) {
  const t0 = Date.now();
  const { W, H, D, hx, hy, codes, timeS } = S;
  if (D !== 1) return null;
  const mask = new Uint8Array(W * H);
  if (!(timeS > 0)) return { mask, steps: 0, facets: 0, fronts: [], ms: 0 };
  for (let i = 0; i < codes.length; i++) if (codes[i] === KC.POLY || codes[i] === KC.AL) return null;
  const rate = rate2D(S);
  // the silicon surface: first silicon from the top in every column; exposed if the cell above is etchant
  const top = new Int32Array(W), open = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H && codes[y * W + x] !== KC.SI) y++;
    if (y >= H) return null;                                   // a column without silicon
    top[x] = y; open[x] = y === 0 || codes[(y - 1) * W + x] === KC.ETCHANT ? 1 : 0;
  }
  const Lx = W * hx, Ly = H * hy;
  // fronts: one per run of exposed columns
  const fronts = [];
  for (let a = 0; a < W; a++) {
    if (!open[a]) continue;
    let b = a; while (b + 1 < W && open[b + 1]) b++;
    // the surface as a staircase, left to right, with the silicon below; an exposed step at either end
    const pts = [];
    const yl = a > 0 ? Math.min(top[a - 1], top[a]) : top[a];
    pts.push([a * hx, yl * hy]);
    if (yl !== top[a]) pts.push([a * hx, top[a] * hy]);
    for (let x = a; x <= b; x++) {
      pts.push([(x + 1) * hx, top[x] * hy]);
      if (x < b && top[x + 1] !== top[x]) pts.push([(x + 1) * hx, top[x + 1] * hy]);
    }
    const yr = b < W - 1 ? Math.min(top[b + 1], top[b]) : top[b];
    if (yr !== top[b]) pts.push([(b + 1) * hx, yr * hy]);
    // straight runs joined
    const P = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i], p = P[P.length - 1];
      if (P.length >= 2) { const o = P[P.length - 2]; if (Math.abs((p[0] - o[0]) * (q[1] - p[1]) - (p[1] - o[1]) * (q[0] - p[0])) < 1e-9) { P[P.length - 1] = q; continue; } }
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9) P.push(q);
    }
    const fs = [];
    for (let i = 0; i + 1 < P.length; i++) fs.push(facetOf(P[i], P[i + 1], rate));
    // anchors: the silicon–mask interface beside the run (horizontal), or the sample edge (vertical)
    const anchorAt = (x0, side) => (x0 <= 0 || x0 >= Lx
      ? { nx: side < 0 ? 1 : -1, ny: 0, c: side < 0 ? 0 : -Lx, r: 0, ax: [0, 1], edge: true }
      : { nx: 0, ny: 1, c: (side < 0 ? yl : yr) * hy, r: 0, ax: [side, 0], edge: false });
    // Lp / Rp: where the front ends while its end facet still lies along the interface (parallel lines)
    fronts.push({ f: fs, L: anchorAt(a * hx, -1), R: anchorAt((b + 1) * hx, 1), base: P.map((p) => p.slice()), Lp: P[0].slice(), Rp: P[P.length - 1].slice() });
    a = b;
  }
  if (!fronts.length) return { mask, steps: 0, facets: 0, fronts: [], ms: Date.now() - t0 };

  // ---- the corner rule at one vertex of a front: insert the planes that appear there
  const lineAt = (fr, j) => (j < 0 ? fr.L : j >= fr.f.length ? fr.R : fr.f[j]);
  // between line j−1 and line j; an end facet still along its anchor ends where the opening ended
  function vertexOf(fr, j) {
    const m = meet(lineAt(fr, j - 1), lineAt(fr, j));
    if (m) return m;
    if (j === 0) return { p: fr.Lp.slice(), w: [0, 0] };
    if (j === fr.f.length) return { p: fr.Rp.slice(), w: [0, 0] };
    return null;
  }
  function cornerRule(fr, j) {
    // vertex between line j−1 and line j (anchors at −1 and f.length)
    const A = lineAt(fr, j - 1), B = lineAt(fr, j);
    const m = vertexOf(fr, j);
    if (!m) return 0;
    let thA, thB, convex, via = null, insertAt = j, keep;
    if (j === 0 || j === fr.f.length) {
      // a junction with the interface or the sample edge: the facet and its mirror image
      const an = j === 0 ? fr.L : fr.R, E = j === 0 ? B : A, mn = mirrorN(E, an);
      const tE = [E.ny, -E.nx];                                  // along the front (silicon on the right)
      const refl = (v) => { const d = v[0] * an.nx + v[1] * an.ny; return [v[0] - 2 * d * an.nx, v[1] - 2 * d * an.ny]; };
      const rt = refl(tE);
      // silicon convex at the doubled vertex? (n_A · t_B > 0, A before B along the front)
      convex = j === 0 ? mn[0] * tE[0] + mn[1] * tE[1] > 1e-9 : E.nx * -rt[0] + E.ny * -rt[1] > 1e-9;
      const axTh = Math.atan2(an.ax[1], an.ax[0]);
      thA = E.th; thB = Math.atan2(mn[1], mn[0]); via = axTh;
      const all = emerging(rate, thA, thB, convex, via);
      // the half from E up to the mirror axis (inclusive), ordered along the front
      const half = all.filter((th) => { let d1 = th - thA, d2 = axTh - thA; while (d1 > Math.PI) d1 -= 2 * Math.PI; while (d1 < -Math.PI) d1 += 2 * Math.PI; while (d2 > Math.PI) d2 -= 2 * Math.PI; while (d2 < -Math.PI) d2 += 2 * Math.PI; return Math.sign(d1) === Math.sign(d2) && Math.abs(d1) <= Math.abs(d2) + 1e-6; });
      keep = j === 0 ? half.reverse() : half;
    } else {
      const tB = [B.ny, -B.nx];
      convex = A.nx * tB[0] + A.ny * tB[1] > 1e-9;
      thA = A.th; thB = B.th;
      keep = emerging(rate, thA, thB, convex);
    }
    if (!keep.length) return 0;
    const add = keep.map((th) => facet(th, Math.cos(th) * m.p[0] + Math.sin(th) * m.p[1], rate));
    fr.f.splice(insertAt, 0, ...add);
    return add.length;
  }

  for (const fr of fronts) {
    for (let j = fr.f.length; j >= 0; j--) cornerRule(fr, j);
  }

  // A new vertex between facet j−1 and facet j: parallel neighbours (a step that closed) become one
  // facet; anti-parallel ones on the same line (a wall of zero thickness, e.g. two undercuts meeting
  // under a mask stripe) both go, and their neighbours meet; anything else gets the corner rule.
  function settle(fr, j) {
    for (let guard = 0; guard < 100; guard++) {
      const A = fr.f[j - 1], B = fr.f[j];
      if (!A || !B) { cornerRule(fr, j); return; }
      const cr = A.nx * B.ny - A.ny * B.nx, dt = A.nx * B.nx + A.ny * B.ny;
      if (Math.abs(cr) < 1e-9 && dt > 0) { fr.f.splice(j, 1); continue; }
      if (Math.abs(cr) < 1e-9 && dt < 0 && Math.abs(A.c + B.c) < 1e-6 * (1 + Math.abs(A.c))) { fr.f.splice(j - 1, 2); j -= 1; continue; }
      cornerRule(fr, j);
      return;
    }
  }

  // ---- events
  let t = 0, steps = 0, zeroRun = 0, stuck = false;
  const advance = (dt) => { for (const fr of fronts) for (const f of fr.f) f.c += f.r * dt; };
  while (t < timeS - 1e-12 && steps < 20000) {
    let best = timeS - t, ev = null;
    for (let fi = 0; fi < fronts.length; fi++) {
      const fr = fronts[fi], n = fr.f.length;
      const vs = []; for (let j = 0; j <= n; j++) vs.push(vertexOf(fr, j));
      for (let j = 0; j < n; j++) {
        const a = vs[j], b = vs[j + 1], F = fr.f[j];
        if (!a || !b) continue;
        const tx = F.ny, ty = -F.nx;
        const len = (b.p[0] - a.p[0]) * tx + (b.p[1] - a.p[1]) * ty, dl = (b.w[0] - a.w[0]) * tx + (b.w[1] - a.w[1]) * ty;
        if (dl < -1e-15 && n > 1) { const te = Math.max(0, len / -dl); if (te < best) { best = te; ev = { kind: 'vanish', fi, j }; } }
      }
      // junctions: reaching the sample edge along the interface, or the next front's junction
      const vr = vs[n];
      if (vr && !fr.R.edge) {
        const nb = fronts[fi + 1];
        if (nb && !nb.L.edge && Math.abs(nb.L.c - fr.R.c) < 1e-9) {
          const vl = vertexOf(nb, 0);
          if (vl) { const gap = vl.p[0] - vr.p[0], dg = vl.w[0] - vr.w[0]; if (dg < -1e-15) { const te = Math.max(0, gap / -dg); if (te < best) { best = te; ev = { kind: 'join', fi }; } } }
        } else if (vr.w[0] > 1e-15) { const te = Math.max(0, (Lx - vr.p[0]) / vr.w[0]); if (te < best) { best = te; ev = { kind: 'edgeR', fi }; } }
      }
      const vl0 = vs[0];
      if (vl0 && !fr.L.edge && !(fronts[fi - 1] && !fronts[fi - 1].R.edge && Math.abs(fronts[fi - 1].R.c - fr.L.c) < 1e-9) && vl0.w[0] < -1e-15) {
        const te = Math.max(0, vl0.p[0] / -vl0.w[0]); if (te < best) { best = te; ev = { kind: 'edgeL', fi }; }
      }
    }
    advance(best); t += best; steps++;
    if (!ev) break;
    const fr = fronts[ev.fi];
    if (ev.kind === 'vanish') {
      fr.f.splice(ev.j, 1);
      settle(fr, ev.j);
    } else if (ev.kind === 'join') {
      const nb = fronts[ev.fi + 1], at = fr.f.length;
      fr.f.push(...nb.f); fr.R = nb.R; fr.base = fr.base.concat(nb.base);
      fronts.splice(ev.fi + 1, 1);
      settle(fr, at);
    } else if (ev.kind === 'edgeR') {
      const y = fr.R.c; fr.base.push([Lx, y]);
      fr.R = { nx: -1, ny: 0, c: -Lx, r: 0, ax: [0, 1], edge: true };
      // a wall that arrives parallel to the edge lies on it: the silicon beyond it is gone
      while (fr.f.length > 1 && Math.abs(fr.f[fr.f.length - 1].nx * fr.R.ny - fr.f[fr.f.length - 1].ny * fr.R.nx) < 1e-9) fr.f.pop();
      cornerRule(fr, fr.f.length);
    } else if (ev.kind === 'edgeL') {
      const y = fr.L.c; fr.base.unshift([0, y]);
      fr.L = { nx: 1, ny: 0, c: 0, r: 0, ax: [0, 1], edge: true };
      while (fr.f.length > 1 && Math.abs(fr.f[0].nx * fr.L.ny - fr.f[0].ny * fr.L.nx) < 1e-9) fr.f.shift();
      cornerRule(fr, 0);
    }
    // events that take no time cannot go on for ever (a degenerate corner): stop and say so
    zeroRun = best < 1e-12 ? zeroRun + 1 : 0;
    if (zeroRun > 200) { stuck = true; break; }
  }

  if (stuck || steps >= 20000) return null;          // not trusted: the level set is used instead

  // ---- the etched region of each front: the front, then back along the original surface
  const polys = [];
  let nFacets = 0;
  for (const fr of fronts) {
    const n = fr.f.length, pts = [];
    nFacets += n;
    for (let j = 0; j <= n; j++) { const v = vertexOf(fr, j); if (v) pts.push(v.p); }
    polys.push({ front: pts, ring: pts.concat(fr.base.slice().reverse()) });
  }
  for (let y = 0; y < H; y++) {
    const yc = (y + 0.5) * hy, xs = [];
    for (const { ring } of polys) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if ((p[1] <= yc) !== (q[1] <= yc)) xs.push(p[0] + ((yc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] / hx - 0.5)), x1 = Math.min(W - 1, Math.floor(xs[k + 1] / hx - 0.5));
      for (let x = x0; x <= x1; x++) if (codes[y * W + x] === KC.SI) mask[y * W + x] = 1;
    }
  }
  return { mask, steps, facets: nFacets, fronts: polys.map((p) => p.front), ms: Date.now() - t0, Ly };
}
