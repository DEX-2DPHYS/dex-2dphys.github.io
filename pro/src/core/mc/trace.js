// Trajectories and an energy-deposition map for the PSF tab's trajectory view.
// The electrons are the first ones of the run's batch 0 (same seed, same random stream), so the tracks
// shown are the first electrons the Monte Carlo itself simulates. Positions are projected on the x–z
// plane (z = depth, positive down).
//
// t: a transport (createTransport). opts:
//   nShow   electrons whose tracks are returned (knock-on electrons included, flagged)
//   nDep    electrons for the deposition map (0 = none); the map is over view = {x0, x1, z0, z1, W, H}
//           in nm and pixels, energy summed over y (keV per pixel)
//   seed, maxPts (cap on the points kept; the rest of the tracks is dropped and said so)
export function traceRun(t, { nShow = 100, nDep = 0, seed = 1, view = null, maxPts = 3e6 } = {}) {
  const tracks = [];
  let npts = 0, truncated = false;
  let grid = null, dep = null;
  if (view && nDep > 0) {
    const { x0, x1, z0, z1, W, H } = view;
    grid = new Float32Array(W * H);
    const sx = W / (x1 - x0), sz = H / (z1 - z0);
    dep = (ax, az, bx, bz, dE) => {
      const px = (ax - x0) * sx, pz = (az - z0) * sz, qx = (bx - x0) * sx, qz = (bz - z0) * sz;
      if ((px < 0 && qx < 0) || (px >= W && qx >= W) || (pz < 0 && qz < 0) || (pz >= H && qz >= H)) return;
      const L = Math.hypot(qx - px, qz - pz), k = Math.min(1024, 1 + Math.floor(L));
      const q = dE / k;
      for (let j = 0; j < k; j++) {
        const f = (j + 0.5) / k, ix = Math.floor(px + (qx - px) * f), iz = Math.floor(pz + (qz - pz) * f);
        if (ix >= 0 && ix < W && iz >= 0 && iz < H) grid[iz * W + ix] += q;
      }
    };
  }
  const n = Math.max(nShow, grid ? nDep : 0);
  if (n > 0) t.runBatch(n, seed, 0, {
    nShow,
    add: (tr) => { const m = tr.pts.length >> 1; if (npts + m > maxPts) { truncated = true; return; } tracks.push(tr); npts += m; },
    dep,
  });
  const xy = new Float32Array(2 * npts), off = new Int32Array(tracks.length + 1), flags = new Uint8Array(tracks.length), elec = new Int32Array(tracks.length);
  let p = 0, shown = 0, out = 0;
  tracks.forEach((tr, i) => {
    xy.set(tr.pts, 2 * p); p += tr.pts.length >> 1; off[i + 1] = p;
    flags[i] = (tr.out ? 1 : 0) | (tr.primary ? 2 : 0); elec[i] = tr.e;
    if (tr.primary) { shown++; if (tr.out) out++; }
  });
  return { xy, off, flags, elec, primaries: shown, backscattered: out, truncated, grid, view: grid ? view : null, nDep: grid ? nDep : 0 };
}
