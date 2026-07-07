/* Web Worker: computes two-terminal conductance for one sweep point.
 * Reuses the same solver code as the main thread (loaded via importScripts),
 * so parallel results match the inline path. Receives {base, idx, pt} and
 * posts back {idx, gFem, gBal}. */
importScripts("./physics.js", "./fem_solver.js", "./trajectory_solver.js");
const { PHYS, U, FEMSolver, fem, TrajectorySolver } = self.GT;

function densityCm2FromVg(base, Vg) {
  const eps0 = 8.8541878128e-12;
  const Cox = base.epsr * eps0 / (base.tox_nm * 1e-9);
  return (Cox * (Vg - base.vdirac) / PHYS.e) / 1e4;
}
function inRect(xf, yf, c) { return xf >= c.x0 && xf <= c.x1 && yf >= c.y0 && yf <= c.y1; }
function mfpFromMobility(base, n_cm2) {
  const n = U.cm2ToM2(n_cm2);
  return PHYS.hbar * U.mobCmToSI(base.mu_cm) * Math.sqrt(Math.PI * Math.abs(n)) / PHYS.e;
}
// contact edge geometry (inward-normal angle, transverse width, centre) — mirrors app.js
function edgeInfo(base, c) {
  const { W, H } = base;
  const gap = { left: c.x0, right: 1 - c.x1, bottom: c.y0, top: 1 - c.y1 };
  const e = Object.keys(gap).reduce((a, b) => (gap[b] < gap[a] ? b : a));
  const ang = { left: 0, right: Math.PI, bottom: Math.PI / 2, top: -Math.PI / 2 }[e];
  const wid = (e === "left" || e === "right") ? (c.y1 - c.y0) * H : (c.x1 - c.x0) * W;
  return { ang, wid, cx: (c.x0 + c.x1) / 2 * W, cy: (c.y0 + c.y1) / 2 * H };
}
function makeLaunch(base, c) {
  const { W, H } = base, e = edgeInfo(base, c);
  return (rng) => {
    const xf = c.x0 + rng() * (c.x1 - c.x0), yf = c.y0 + rng() * (c.y1 - c.y0);
    return [xf * W, yf * H, e.ang + Math.asin(2 * rng() - 1)];
  };
}
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat(b[i]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) continue;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

function femG(base, n_cm2, B) {
  const { W, H, nx, ny } = base, dx = W / nx, dy = H / ny;
  const n = U.cm2ToM2(n_cm2), mu = U.mobCmToSI(base.mu_cm);
  const nArr = new Float64Array(nx * ny).fill(n), muArr = new Float64Array(nx * ny).fill(mu);
  const K = fem.magnetotransportTensor(nArr, muArr, B, PHYS.e);
  const mask = new Uint8Array(nx * ny), val = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const yf = (j + 0.5) / ny;
    for (let i = 0; i < nx; i++) {
      const xf = (i + 0.5) / nx;
      let c = null; for (const k of base.contacts) if (inRect(xf, yf, k)) { c = k; break; }
      if (c && (c.role === "source" || c.role === "drain")) {
        const kk = j * nx + i; mask[kk] = 1; val[kk] = c.role === "source" ? base.Vsource : base.Vdrain;
      }
    }
  }
  const solver = new FEMSolver({ nx, ny, dx, dy });
  const res = solver.solve(K, null, mask, val, { tol: base.femTol, maxIter: base.femIter });
  const flux = solver.flux(res.u, K);
  const col = Math.floor(nx / 2); let I = 0; for (let j = 0; j < ny; j++) I += flux.qx[j * nx + col] * dy;
  const R = I !== 0 ? (base.Vsource - base.Vdrain) / I : Infinity;
  return (isFinite(R) && R !== 0) ? 1 / R : 0;
}

function ballisticG(base, n_cm2, B, scattering, mfp) {
  const { W, H } = base, n = U.cm2ToM2(n_cm2);
  const contactAt = (x, y) => {
    const xf = x / W, yf = y / H;
    // voltage probes draw no net current -> non-absorbing (see app.js regionConfig)
    for (const c of base.contacts) { if (c.role === "probe") continue; if (inRect(xf, yf, c)) return { id: c.id, role: c.role }; }
    return null;
  };
  const sources = base.contacts.filter((c) => c.role === "source").map((c) => ({
    id: c.id, role: "source", width: (c.y1 - c.y0) * H, cx: (c.x0 + c.x1) / 2 * W, cy: (c.y0 + c.y1) / 2 * H,
    launch: (rng) => {
      const xf = c.x0 + rng() * (c.x1 - c.x0), yf = c.y0 + rng() * (c.y1 - c.y0);
      // cosine (flux-correct) injection about the inward normal
      const toward = (c.x0 + c.x1) / 2 < 0.5 ? 0 : Math.PI;
      return [xf * W, yf * H, toward + Math.asin(2 * rng() - 1)];
    },
  }));
  const terminals = base.contacts.map((c) => ({ id: c.id }));
  const cfg = {
    W, H, vF: base.vF, n0: n, mfp, B, contactAt, sources, terminals,
    scattering, edge: base.edge, nTraj: base.nTraj, seed: base.seed,
    ds: Math.min(W, H) / 400, maxSteps: base.maxSteps, maxPath: base.maxPath,
    gx: 140, gy: Math.max(20, Math.round(140 * H / W)),
  };
  const r = new TrajectorySolver(cfg).run({ keepPaths: 0 });
  const drains = base.contacts.filter((c) => c.role === "drain").map((c) => c.id);
  const row = r.transmission && r.transmission[0];
  if (!row) return 0;
  return drains.reduce((a, id) => a + (row.G[id] || 0), 0);
}

function computePoint(base0, pt) {
  // per-point mobility override (used by the G-vs-ℓ sweep)
  const base = pt.mu_cm != null ? Object.assign({}, base0, { mu_cm: pt.mu_cm }) : base0;
  const n_cm2 = pt.vg != null ? densityCm2FromVg(base, pt.vg) : base.n_cm2;
  if (base.measure && base.measure !== "2t") {     // four-probe Hall / R_xx
    return {
      gFem: base.wantFem ? femProbeR(base, n_cm2, pt.b, base.measure) : null,
      gBal: base.wantBal ? trajButtikerR(base, n_cm2, pt.b, base.measure) : null,
    };
  }
  const mc = base.balMode === "mc";
  // crossover needs the diffusive (FEM/Drude) value; pure-MC mode does not
  const gD = (base.wantFem || (base.wantBal && !mc)) ? femG(base, n_cm2, pt.b) : null;
  let gBal = null;
  if (base.wantBal) {
    if (mc) {
      gBal = ballisticG(base, n_cm2, pt.b, base.scattering, mfpFromMobility(base, n_cm2));
    } else {
      const gB = ballisticG(base, n_cm2, pt.b, "none", 1e9); // Sharvin (mfp=∞)
      gBal = (gB > 0 && gD > 0) ? 1 / (1 / gB + 1 / gD) : (gB > 0 ? gB : gD);
    }
  }
  return { gFem: base.wantFem ? gD : null, gBal };
}

// FEM four-probe resistance R = (V₁−V₂)/I (mirrors app.js femProbeR).
function femProbeR(base, n_cm2, B, kind) {
  const { W, H, nx, ny } = base, dx = W / nx, dy = H / ny;
  const n = U.cm2ToM2(n_cm2), mu = U.mobCmToSI(base.mu_cm);
  const nArr = new Float64Array(nx * ny).fill(n), muArr = new Float64Array(nx * ny).fill(mu);
  const K = fem.magnetotransportTensor(nArr, muArr, B, PHYS.e);
  const mask = new Uint8Array(nx * ny), val = new Float64Array(nx * ny), pc = {};
  for (let j = 0; j < ny; j++) {
    const yf = (j + 0.5) / ny;
    for (let i = 0; i < nx; i++) {
      const xf = (i + 0.5) / nx;
      for (const c of base.contacts) if (inRect(xf, yf, c)) {
        const kk = j * nx + i;
        if (c.role === "source" || c.role === "drain") { mask[kk] = 1; val[kk] = c.role === "source" ? base.Vsource : base.Vdrain; }
        else (pc[c.id] = pc[c.id] || []).push(kk);
      }
    }
  }
  const solver = new FEMSolver({ nx, ny, dx, dy });
  const res = solver.solve(K, null, mask, val, { tol: base.femTol, maxIter: base.femIter });
  const flux = solver.flux(res.u, K);
  const col = Math.floor(nx / 2); let I = 0; for (let j = 0; j < ny; j++) I += flux.qx[j * nx + col] * dy;
  if (!I) return NaN;
  const ps = base.contacts.filter((c) => c.role === "probe" && pc[c.id])
    .map((c) => ({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, V: pc[c.id].reduce((a, k) => a + res.u[k], 0) / pc[c.id].length }));
  if (ps.length < 2) return NaN;
  let a, b;
  if (kind === "hall") { ps.sort((p, q) => q.y - p.y); a = ps[0]; b = ps[ps.length - 1]; }
  else { ps.sort((p, q) => p.x - q.x); a = ps[ps.length - 1]; b = ps[0]; }
  return (a.V - b.V) / I;
}

// Ballistic four-probe resistance via multi-terminal Büttiker (mirrors app.js).
function trajButtikerR(base, n_cm2, B, kind) {
  const { W, H } = base, n = U.cm2ToM2(n_cm2), kF = Math.sqrt(Math.PI * Math.abs(n));
  const ballistic = base.scattering === "none";
  const contactAt = (x, y) => { const xf = x / W, yf = y / H; for (const c of base.contacts) if (inRect(xf, yf, c)) return { id: c.id, role: c.role }; return null; };
  const sources = base.contacts.map((c) => { const e = edgeInfo(base, c); return { id: c.id, role: c.role, width: e.wid, cx: e.cx, cy: e.cy, launch: makeLaunch(base, c) }; });
  const cfg = {
    W, H, vF: base.vF, n0: n, mfp: ballistic ? 1e9 : mfpFromMobility(base, n_cm2), B,
    contactAt, sources, terminals: base.contacts.map((c) => ({ id: c.id })),
    scattering: base.scattering, edge: base.edge, nTraj: Math.max(base.nTraj, 4000), seed: base.seed,
    ds: Math.min(W, H) / 400, maxSteps: base.maxSteps, maxPath: base.maxPath, gx: 80, gy: Math.max(20, Math.round(80 * H / W)),
  };
  const res = new TrajectorySolver(cfg).run({ keepPaths: 0 });
  const Tb = {}; res.transmission.forEach((row) => (Tb[row.source] = row.T));
  const cs = base.contacts, ids = cs.map((c) => c.id), idx = {}; ids.forEach((id, i) => (idx[id] = i));
  const N = ids.length, M = {}; cs.forEach((c) => (M[c.id] = Math.max(1, edgeInfo(base, c).wid * kF / Math.PI)));
  const Gq = (4 * PHYS.e * PHYS.e) / PHYS.h;
  const Cm = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i === j) continue; const ii = ids[i], jj = ids[j];
    Cm[i][i] += Gq * M[ii] * ((Tb[ii] && Tb[ii][jj]) || 0);
    Cm[i][j] -= Gq * M[jj] * ((Tb[jj] && Tb[jj][ii]) || 0);
  }
  const src = cs.find((c) => c.role === "source"), drn = cs.find((c) => c.role === "drain");
  const ps = cs.filter((c) => c.role === "probe").map((c) => ({ id: c.id, x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }));
  if (!src || !drn || ps.length < 2) return NaN;
  let pa, pb;
  if (kind === "hall") { ps.sort((a, b) => b.y - a.y); pa = ps[0]; pb = ps[ps.length - 1]; }
  else { ps.sort((a, b) => a.x - b.x); pa = ps[ps.length - 1]; pb = ps[0]; }
  const fixed = { [src.id]: 1, [drn.id]: 0 }, unk = ids.filter((id) => !(id in fixed));
  const A = [], bb = [];
  unk.forEach((u) => { const ui = idx[u]; A.push(unk.map((v) => Cm[ui][idx[v]])); let rhs = 0; for (const f in fixed) rhs -= Cm[ui][idx[f]] * fixed[f]; bb.push(rhs); });
  const Vu = solveLinear(A, bb), V = Object.assign({}, fixed); unk.forEach((u, a) => (V[u] = Vu[a]));
  let Is = 0; const si = idx[src.id]; for (let j = 0; j < N; j++) Is += Cm[si][j] * V[ids[j]];
  return Is !== 0 ? (V[pa.id] - V[pb.id]) / Is : NaN;
}

// Receive a chunk of points, compute each and stream the result back so the main
// thread can update the plot/progress without gating the worker between points.
self.onmessage = (e) => {
  const { base, chunk } = e.data;
  for (const { idx, pt } of chunk) {
    const r = computePoint(base, pt);
    self.postMessage({ idx, gFem: r.gFem, gBal: r.gBal });
  }
};
