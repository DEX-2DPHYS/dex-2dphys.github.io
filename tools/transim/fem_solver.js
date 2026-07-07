/* fem_solver.js — unified 2D elliptic solver on a finite-difference grid.
 *
 * Solves   -div( K grad u ) = f   with a 2x2 tensor coefficient field K(x,y),
 * Dirichlet conditions where a mask is set, and natural zero-flux (Neumann)
 * elsewhere. ONE core serves two physics modes:
 *
 *   electrostatics  : K = eps * I (isotropic),  f = charge/gate term  -> u = phi
 *   magnetotransport: K = sigma Hall tensor,     f = 0                 -> u = V
 *
 * The Hall (off-diagonal) terms make the operator non-symmetric, so we assemble
 * a sparse matrix (CSR) and solve with BiCGSTAB (Jacobi-preconditioned). The
 * symmetric part is the 5-point flux form; the antisymmetric Hall part adds a
 * 9-point (diagonal-neighbour) cross-derivative stencil. For uniform K the Hall
 * terms cancel in the bulk and only act at boundaries/contacts — the physically
 * expected behaviour.
 */
(function (global) {
  "use strict";

  // Build the Hall conductivity tensor field for magnetotransport.
  //   sigma0(x,y) = e |n| mu ;  sigma_s = sigma0 / (1 + (mu B)^2)
  //   Kxx = Kyy = sigma_s ;  Kxy = sign(n) sigma_s mu B ;  Kyx = -Kxy
  function magnetotransportTensor(n_m2, mu_SI, B, e) {
    const nx = n_m2.length;
    const Kxx = new Float64Array(nx);
    const Kxy = new Float64Array(nx);
    const Kyx = new Float64Array(nx);
    const Kyy = new Float64Array(nx);
    for (let k = 0; k < nx; k++) {
      const muB = mu_SI[k] * B;
      const sigma0 = e * Math.abs(n_m2[k]) * mu_SI[k];
      const sigma_s = sigma0 / (1 + muB * muB);
      const sgn = n_m2[k] >= 0 ? 1 : -1;
      Kxx[k] = sigma_s;
      Kyy[k] = sigma_s;
      // Hall (off-diagonal) sign fixed so R_xy = (V_top−V_bottom)/I = +B/(n_s e)
      // for electrons at B>0 (matches the trajectory Lorentz force / Büttiker).
      Kxy[k] = -sgn * sigma_s * muB;
      Kyx[k] = sgn * sigma_s * muB;
    }
    return { Kxx, Kxy, Kyx, Kyy };
  }

  // Isotropic tensor field for electrostatics: K = eps * I.
  function isotropicTensor(eps) {
    const z = new Float64Array(eps.length);
    return { Kxx: eps, Kxy: z, Kyx: z, Kyy: eps.slice() };
  }

  class FEMSolver {
    /* grid: {nx, ny, dx, dy}  (dx, dy in metres) */
    constructor(grid) {
      this.nx = grid.nx;
      this.ny = grid.ny;
      this.dx = grid.dx;
      this.dy = grid.dy;
      this.N = grid.nx * grid.ny;
    }

    idx(i, j) {
      return j * this.nx + i;
    }

    /* Assemble the reduced system (free nodes only) using a finite-VOLUME
     * current-conservation scheme:  sum of outward face fluxes = 0, with
     * j = -K grad u evaluated per face INCLUDING the Hall (off-diagonal) term.
     *
     * Because the outer faces of insulating boundaries are simply omitted
     * (zero flux) while their Hall contribution still enters the tangential
     * face fluxes, a transverse Hall voltage develops on its own — so reading
     * different probe pairs gives the longitudinal or Hall signal naturally.
     * Known (Dirichlet) contact values are folded into the RHS. */
    _assembleReduced(K, f, dirichletMask, dirichletVal) {
      const { nx, ny, dx, dy, N } = this;
      const idx = (i, j) => j * nx + i;
      const clamp = (i, j) =>
        Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i));

      const freeId = new Int32Array(N).fill(-1);
      let nFree = 0;
      for (let k = 0; k < N; k++) if (!dirichletMask[k]) freeId[k] = nFree++;

      const rows = [], cols = [], vals = [];
      const b = new Float64Array(nFree);
      const push = (r, c, v) => { rows.push(r); cols.push(c); vals.push(v); };
      const couple = (r, m, c) => {
        if (c === 0) return;
        if (freeId[m] >= 0) push(r, freeId[m], c);
        else b[r] -= c * dirichletVal[m];
      };

      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = idx(i, j);
          if (dirichletMask[k]) continue;
          const r = freeId[k];
          const acc = new Map();
          const add = (m, c) => acc.set(m, (acc.get(m) || 0) + c);

          // EAST face
          if (i + 1 < nx) {
            const E = idx(i + 1, j);
            const sxx = 0.5 * (K.Kxx[k] + K.Kxx[E]);
            const sxy = 0.5 * (K.Kxy[k] + K.Kxy[E]);
            const gl = (sxx * dy) / dx; add(k, gl); add(E, -gl);
            const h = sxy / 4; // Hall: -sxy * d u/dy at the east face
            add(clamp(i, j + 1), -h); add(clamp(i + 1, j + 1), -h);
            add(clamp(i, j - 1), h); add(clamp(i + 1, j - 1), h);
          }
          // WEST face
          if (i - 1 >= 0) {
            const Wn = idx(i - 1, j);
            const sxx = 0.5 * (K.Kxx[k] + K.Kxx[Wn]);
            const sxy = 0.5 * (K.Kxy[k] + K.Kxy[Wn]);
            const gl = (sxx * dy) / dx; add(k, gl); add(Wn, -gl);
            const h = sxy / 4;
            add(clamp(i, j + 1), h); add(clamp(i - 1, j + 1), h);
            add(clamp(i, j - 1), -h); add(clamp(i - 1, j - 1), -h);
          }
          // NORTH face
          if (j + 1 < ny) {
            const Nn = idx(i, j + 1);
            const syy = 0.5 * (K.Kyy[k] + K.Kyy[Nn]);
            const syx = 0.5 * (K.Kyx[k] + K.Kyx[Nn]);
            const gl = (syy * dx) / dy; add(k, gl); add(Nn, -gl);
            const h = syx / 4; // Hall: -syx * d u/dx at the north face
            add(clamp(i + 1, j), -h); add(clamp(i + 1, j + 1), -h);
            add(clamp(i - 1, j), h); add(clamp(i - 1, j + 1), h);
          }
          // SOUTH face
          if (j - 1 >= 0) {
            const Sn = idx(i, j - 1);
            const syy = 0.5 * (K.Kyy[k] + K.Kyy[Sn]);
            const syx = 0.5 * (K.Kyx[k] + K.Kyx[Sn]);
            const gl = (syy * dx) / dy; add(k, gl); add(Sn, -gl);
            const h = syx / 4;
            add(clamp(i + 1, j), h); add(clamp(i + 1, j - 1), h);
            add(clamp(i - 1, j), -h); add(clamp(i - 1, j - 1), -h);
          }

          for (const [m, c] of acc) couple(r, m, c);
          if (f) b[r] += -f[k] * dx * dy; // volumetric source (electrostatics)
        }
      }
      const A = this._toCSR(rows, cols, vals, nFree, b);
      A.freeId = freeId;
      return A;
    }

    _toCSR(rows, cols, vals, N, b) {
      // Accumulate duplicate (r,c) entries, then build CSR.
      const rowMap = Array.from({ length: N }, () => new Map());
      for (let e = 0; e < rows.length; e++) {
        const m = rowMap[rows[e]];
        m.set(cols[e], (m.get(cols[e]) || 0) + vals[e]);
      }
      const rowPtr = new Int32Array(N + 1);
      let nnz = 0;
      for (let r = 0; r < N; r++) nnz += rowMap[r].size;
      const colIdx = new Int32Array(nnz);
      const data = new Float64Array(nnz);
      let p = 0;
      for (let r = 0; r < N; r++) {
        rowPtr[r] = p;
        // Row-normalise by the diagonal magnitude so interior rows (~1/dx^2)
        // and Dirichlet rows (~1) share a comparable scale — essential for a
        // well-conditioned Krylov solve.
        const m = rowMap[r];
        let s = Math.abs(m.get(r) || 0);
        if (!(s > 0)) s = 1;
        const entries = [...m.entries()].sort((a, c) => a[0] - c[0]);
        for (const [c, v] of entries) { colIdx[p] = c; data[p] = v / s; p++; }
        b[r] /= s;
      }
      rowPtr[N] = p;
      return { rowPtr, colIdx, data, N, b };
    }

    static _spmv(A, x, out) {
      const { rowPtr, colIdx, data, N } = A;
      for (let r = 0; r < N; r++) {
        let s = 0;
        for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) s += data[p] * x[colIdx[p]];
        out[r] = s;
      }
      return out;
    }

    static _diag(A) {
      const { rowPtr, colIdx, data, N } = A;
      const d = new Float64Array(N);
      for (let r = 0; r < N; r++)
        for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++)
          if (colIdx[p] === r) d[r] = data[p] || 1;
      for (let r = 0; r < N; r++) if (!d[r]) d[r] = 1;
      return d;
    }

    /* Jacobi-preconditioned BiCGSTAB. Returns {x, iters, residual}. */
    static _bicgstab(A, b, tol, maxIter) {
      const N = A.N;
      const x = new Float64Array(N);
      const r = new Float64Array(N);
      const tmp = new Float64Array(N);
      FEMSolver._spmv(A, x, tmp);
      for (let i = 0; i < N; i++) r[i] = b[i] - tmp[i];
      const r0 = r.slice();
      const M = FEMSolver._diag(A);
      let rho = 1, alpha = 1, omega = 1;
      const v = new Float64Array(N), p = new Float64Array(N);
      const s = new Float64Array(N), t = new Float64Array(N);
      const ph = new Float64Array(N), sh = new Float64Array(N);
      let bnorm = 0;
      for (let i = 0; i < N; i++) bnorm += b[i] * b[i];
      bnorm = Math.sqrt(bnorm) || 1;
      let iters = 0, residual = 0;
      for (let it = 0; it < maxIter; it++) {
        iters = it + 1;
        let rhoNew = 0;
        for (let i = 0; i < N; i++) rhoNew += r0[i] * r[i];
        if (Math.abs(rhoNew) < 1e-30) {
          // Breakdown: restart with the current residual as the new shadow.
          for (let i = 0; i < N; i++) { r0[i] = r[i]; p[i] = 0; v[i] = 0; }
          rho = 1; alpha = 1; omega = 1;
          rhoNew = 0;
          for (let i = 0; i < N; i++) rhoNew += r0[i] * r[i];
          if (Math.abs(rhoNew) < 1e-300) break;
        }
        const beta = (rhoNew / rho) * (alpha / omega);
        for (let i = 0; i < N; i++) p[i] = r[i] + beta * (p[i] - omega * v[i]);
        for (let i = 0; i < N; i++) ph[i] = p[i] / M[i]; // precondition
        FEMSolver._spmv(A, ph, v);
        let r0v = 0;
        for (let i = 0; i < N; i++) r0v += r0[i] * v[i];
        alpha = rhoNew / (r0v || 1e-300);
        for (let i = 0; i < N; i++) s[i] = r[i] - alpha * v[i];
        let snorm = 0;
        for (let i = 0; i < N; i++) snorm += s[i] * s[i];
        if (Math.sqrt(snorm) / bnorm < tol) {
          for (let i = 0; i < N; i++) x[i] += alpha * ph[i];
          residual = Math.sqrt(snorm) / bnorm;
          break;
        }
        for (let i = 0; i < N; i++) sh[i] = s[i] / M[i];
        FEMSolver._spmv(A, sh, t);
        let tt = 0, ts = 0;
        for (let i = 0; i < N; i++) { tt += t[i] * t[i]; ts += t[i] * s[i]; }
        omega = ts / (tt || 1e-300);
        for (let i = 0; i < N; i++) x[i] += alpha * ph[i] + omega * sh[i];
        for (let i = 0; i < N; i++) r[i] = s[i] - omega * t[i];
        let rnorm = 0;
        for (let i = 0; i < N; i++) rnorm += r[i] * r[i];
        residual = Math.sqrt(rnorm) / bnorm;
        if (residual < tol) break;
        rho = rhoNew;
        if (!isFinite(residual)) break;
      }
      return { x, iters, residual };
    }

    /* Solve and return the full-grid field plus diagnostics. */
    solve(K, f, dirichletMask, dirichletVal, opts) {
      opts = opts || {};
      const tol = opts.tol || 1e-7;
      const maxIter = opts.maxIter || 3000;
      const A = this._assembleReduced(K, f, dirichletMask, dirichletVal);
      const { x, iters, residual } = FEMSolver._bicgstab(A, A.b, tol, maxIter);
      // Scatter the reduced solution back onto the full grid.
      const u = new Float64Array(this.N);
      for (let k = 0; k < this.N; k++) {
        u[k] = A.freeId[k] >= 0 ? x[A.freeId[k]] : dirichletVal[k];
      }
      return { u, iters, residual, converged: residual < tol * 50 };
    }

    /* Flux density vector field q = -K grad u (current density for transport,
     * or -eps grad phi = D field for electrostatics). Returns {qx, qy}. */
    flux(u, K) {
      const { nx, ny, dx, dy } = this;
      const qx = new Float64Array(this.N);
      const qy = new Float64Array(this.N);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = this.idx(i, j);
          const ip = Math.min(i + 1, nx - 1), im = Math.max(i - 1, 0);
          const jp = Math.min(j + 1, ny - 1), jm = Math.max(j - 1, 0);
          const dudx = (u[this.idx(ip, j)] - u[this.idx(im, j)]) / ((ip - im) * dx || dx);
          const dudy = (u[this.idx(i, jp)] - u[this.idx(i, jm)]) / ((jp - jm) * dy || dy);
          qx[k] = -(K.Kxx[k] * dudx + K.Kxy[k] * dudy);
          qy[k] = -(K.Kyx[k] * dudx + K.Kyy[k] * dudy);
        }
      }
      return { qx, qy };
    }
  }

  global.GT = global.GT || {};
  global.GT.FEMSolver = FEMSolver;
  global.GT.fem = { magnetotransportTensor, isotropicTensor };
})(typeof window !== "undefined" ? window : globalThis);
