// Lennard-Jones molecular dynamics in reduced units (sigma = epsilon = m = k_B = 1).
// Velocity-Verlet, truncated + shifted potential, cell lists, periodic box or reflecting walls,
// Berendsen thermostat, an optional external spring force on one atom (the "tweezers").
// Pure JS, no DOM: imported by the app and by test/physics.test.mjs.

export const ELEMENTS = {
  Ne: { name: 'Neon',    sigma: 0.2749, epsK: 35.6,  mass: 20.18,  color: 0xff6a4d },
  Ar: { name: 'Argon',   sigma: 0.3405, epsK: 119.8, mass: 39.948, color: 0x4aa8ff },
  Kr: { name: 'Krypton', sigma: 0.3650, epsK: 164.0, mass: 83.80,  color: 0x6be39a },
  Xe: { name: 'Xenon',   sigma: 0.3961, epsK: 224.0, mass: 131.29, color: 0xc08bff },
};

const KB = 1.380649e-23, AMU = 1.66053907e-27;

// reduced -> SI helpers for a given element
export function units(el) {
  const e = ELEMENTS[el];
  const sigma = e.sigma * 1e-9, eps = e.epsK * KB, m = e.mass * AMU;
  const tau = sigma * Math.sqrt(m / eps);             // s
  return {
    K: (Tstar) => Tstar * e.epsK,
    Tstar: (K) => K / e.epsK,
    nm: (r) => r * e.sigma,
    ps: (t) => t * tau * 1e12,
    fs: (t) => t * tau * 1e15,
    bar: (P) => P * eps / (sigma ** 3) * 1e-5,
    eV: (u) => u * eps / 1.602176634e-19,
    D_m2s: (D) => D * sigma * sigma / tau,            // reduced D -> m^2/s
    tau, sigma, eps,
  };
}

export const MAXN = 1600;

export class MD {
  constructor(maxN = MAXN) {
    this.maxN = maxN;
    const f = () => new Float64Array(maxN);
    this.x = f(); this.y = f(); this.z = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.fx = f(); this.fy = f(); this.fz = f();
    this.cx = f(); this.cy = f(); this.cz = f();      // displacement accumulated since the last mark (unwrapped)
    this.z_ = new Float32Array(maxN);                 // smoothed coordination number
    this.coord = new Int16Array(maxN);
    this.next = new Int32Array(maxN);
    this.head = new Int32Array(48 * 48 * 48);
    this.skin = 0.35; this.pi = new Int32Array(1 << 16); this.pj = new Int32Array(1 << 16); this.np = -1; this.listDirty = true; this.rcUsed = 2.5;
    this.xr = f(); this.yr = f(); this.zr = f();
    this.N = 0; this.L = 6; this.dt = 0.004; this.rc = 2.5;
    this.periodic = true;
    this.thermostat = true; this.Ttarget = 0.7; this.tauT = 0.4;
    this.time = 0; this.step = 0;
    // observables from the latest force evaluation
    this.PE = 0; this.virial = 0; this.KE = 0;
    this.wallImpulse = 0; this.wallTime = 0; this.Pwall = 0;
    // external spring: atom index (-1 = none), target in box coordinates, stiffness
    this.ext = { i: -1, x: 0, y: 0, z: 0, k: 40 };
    // g(r)
    this.rdfBins = 100; this.rdfMax = 2.5;
    this.rdfHist = new Float64Array(this.rdfBins); this.rdfSamples = 0; this.rdfWant = false;
    this.rdfNsum = 0; this.rdfRhoSum = 0;
    this.markTime = 0;
    this.exploded = false;
  }

  /* ---------- building ---------- */
  clear() { this.listDirty = true; this.N = 0; this.time = 0; this.step = 0; this.exploded = false; this.resetRDF(); this.mark(); this.ext.i = -1; }

  // FCC crystal of n^3 unit cells (4n^3 atoms) at reduced density rho
  buildFCC(n, rho, Tstar, rand = Math.random) {
    this.clear();
    const N = 4 * n * n * n;
    if (N > this.maxN) throw new Error('too many atoms');
    this.L = Math.cbrt(N / rho);
    const a = this.L / n;
    const b = [[0, 0, 0], [.5, .5, 0], [.5, 0, .5], [0, .5, .5]];
    let k = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++)
      for (const q of b) {
        this.x[k] = (i + q[0] + .25) * a; this.y[k] = (j + q[1] + .25) * a; this.z[k] = (l + q[2] + .25) * a; k++;
      }
    this.N = N;
    this.thermalise(Tstar, rand);
    this.afterBuild();
  }

  // N atoms at random non-overlapping positions (a gas)
  buildGas(N, rho, Tstar, rand = Math.random) {
    this.clear();
    N = Math.min(N, this.maxN);
    this.L = Math.cbrt(N / rho);
    this.N = 0;
    const minD2 = Math.min(0.85, 0.5 * Math.pow(1 / rho, 2 / 3));
    for (let k = 0; k < N; k++) {
      let ok = false;
      for (let tries = 0; tries < 400 && !ok; tries++) {
        const px = rand() * this.L, py = rand() * this.L, pz = rand() * this.L;
        ok = this.free(px, py, pz, minD2);
        if (ok) { this.x[k] = px; this.y[k] = py; this.z[k] = pz; }
      }
      if (!ok) { this.x[k] = rand() * this.L; this.y[k] = rand() * this.L; this.z[k] = rand() * this.L; }
      this.N = k + 1;
    }
    this.thermalise(Tstar, rand);
    this.afterBuild();
  }

  free(px, py, pz, minD2) {
    for (let i = 0; i < this.N; i++) {
      let dx = this.x[i] - px, dy = this.y[i] - py, dz = this.z[i] - pz;
      if (this.periodic) { dx -= this.L * Math.round(dx / this.L); dy -= this.L * Math.round(dy / this.L); dz -= this.L * Math.round(dz / this.L); }
      if (dx * dx + dy * dy + dz * dz < minD2) return false;
    }
    return true;
  }

  gauss(rand) { let u = 0, v = 0; while (u === 0) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  thermalise(T, rand = Math.random) {
    const N = this.N; if (!N) return;
    let sx = 0, sy = 0, sz = 0;
    const s = Math.sqrt(T);
    for (let i = 0; i < N; i++) {
      this.vx[i] = s * this.gauss(rand); this.vy[i] = s * this.gauss(rand); this.vz[i] = s * this.gauss(rand);
      sx += this.vx[i]; sy += this.vy[i]; sz += this.vz[i];
    }
    for (let i = 0; i < N; i++) { this.vx[i] -= sx / N; this.vy[i] -= sy / N; this.vz[i] -= sz / N; }
    this.rescaleTo(T);
  }

  rescaleTo(T) {
    const cur = this.temperature();
    if (cur <= 0) return;
    const s = Math.sqrt(T / cur);
    for (let i = 0; i < this.N; i++) { this.vx[i] *= s; this.vy[i] *= s; this.vz[i] *= s; }
  }

  afterBuild() {
    this.Ttarget = this.temperature() || this.Ttarget;
    for (let i = 0; i < this.N; i++) this.z_[i] = 0;
    this.computeForces();
    this.mark();
    this.resetRDF();
  }

  // add one atom near (px,py,pz) at the current temperature; returns index or -1
  addAtom(px, py, pz, rand = Math.random) {
    if (this.N >= this.maxN) return -1;
    const L = this.L;
    let best = null;
    for (let t = 0; t < 400; t++) {
      const s = 0.05 + t * 0.012;
      const qx = clamp(px + (t ? (rand() - .5) * 2 * s : 0), 0.05, L - 0.05);
      const qy = clamp(py + (t ? (rand() - .5) * 2 * s : 0), 0.05, L - 0.05);
      const qz = clamp(pz + (t ? (rand() - .5) * 2 * s : 0), 0.05, L - 0.05);
      if (this.free(qx, qy, qz, 0.64)) { best = [qx, qy, qz]; break; }
    }
    if (!best) return -1;
    const i = this.N++; this.listDirty = true;
    const sT = Math.sqrt(Math.max(this.Ttarget, 0.02));
    this.x[i] = best[0]; this.y[i] = best[1]; this.z[i] = best[2];
    this.vx[i] = sT * this.gauss(rand); this.vy[i] = sT * this.gauss(rand); this.vz[i] = sT * this.gauss(rand);
    this.cx[i] = this.cy[i] = this.cz[i] = 0; this.z_[i] = 0;
    this.computeForces();
    return i;
  }

  removeAtom(i, noForces = false) {
    if (i < 0 || i >= this.N) return;
    const l = --this.N; this.listDirty = true;
    if (i !== l) {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'cx', 'cy', 'cz']) this[k][i] = this[k][l];
      this.z_[i] = this.z_[l];
    }
    if (this.ext.i === i) this.ext.i = -1; else if (this.ext.i === l) this.ext.i = i;
    if (!noForces) this.computeForces();
  }

  // Change the box edge, scaling positions affinely (a piston move). Positions only: velocities kept.
  setBox(Lnew) {
    Lnew = Math.max(2.2, Lnew);
    const s = Lnew / this.L;
    for (let i = 0; i < this.N; i++) { this.x[i] *= s; this.y[i] *= s; this.z[i] *= s; }
    this.L = Lnew;
    this.resetRDF();
  }

  get density() { return this.N / (this.L ** 3); }

  /* ---------- observables ---------- */
  kinetic() { let s = 0; for (let i = 0; i < this.N; i++) s += this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2; return 0.5 * s; }
  temperature() { const dof = Math.max(1, 3 * this.N - 3); return 2 * this.kinetic() / dof; }
  pressure() {
    if (!this.periodic) return this.Pwall;
    const V = this.L ** 3;
    return (2 * this.kinetic() / 3 + this.virial / 3) / V;
  }
  meanCoord() { let s = 0; for (let i = 0; i < this.N; i++) s += this.z_[i]; return this.N ? s / this.N : 0; }
  msd() { let s = 0; for (let i = 0; i < this.N; i++) s += this.cx[i] ** 2 + this.cy[i] ** 2 + this.cz[i] ** 2; return this.N ? s / this.N : 0; }
  mark() { for (let i = 0; i < this.N; i++) this.cx[i] = this.cy[i] = this.cz[i] = 0; this.markTime = this.time; }
  resetRDF() { this.rdfHist.fill(0); this.rdfSamples = 0; this.rdfNsum = 0; this.rdfRhoSum = 0; }

  rdf() {
    const out = new Float64Array(this.rdfBins);
    if (!this.rdfSamples || !this.N) return out;
    const dr = this.rdfMax / this.rdfBins;
    const N = this.rdfNsum / this.rdfSamples, rho = this.rdfRhoSum / this.rdfSamples;
    for (let b = 0; b < this.rdfBins; b++) {
      const r1 = b * dr, r2 = r1 + dr;
      const shell = 4 / 3 * Math.PI * (r2 ** 3 - r1 ** 3);
      out[b] = 2 * this.rdfHist[b] / (this.rdfSamples * N * rho * shell);
    }
    return out;
  }

  /* ---------- forces ---------- */
  // Verlet neighbour list (cutoff rc + skin), rebuilt through a cell list when any atom has moved > skin/2.
  buildList() {
    const N = this.N, L = this.L, per = this.periodic;
    const x = this.x, y = this.y, z = this.z;
    const rl = this.rcUsed + this.skin, rl2 = rl * rl;
    let np = 0, pi = this.pi, pj = this.pj;
    const push = (i, j) => {
      if (np >= pi.length) { const n2 = new Int32Array(pi.length * 2); n2.set(pi); this.pi = pi = n2; const m2 = new Int32Array(pj.length * 2); m2.set(pj); this.pj = pj = m2; }
      pi[np] = i; pj[np] = j; np++;
    };
    const m = Math.max(1, Math.min(40, Math.floor(L / rl)));
    if (per && m < 3) {
      for (let i = 0; i < N - 1; i++) for (let j = i + 1; j < N; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j];
        dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); dz -= L * Math.round(dz / L);
        if (dx * dx + dy * dy + dz * dz < rl2) push(i, j);
      }
    } else {
      const cs = L / m, head = this.head, next = this.next;
      head.fill(-1, 0, m * m * m);
      for (let i = 0; i < N; i++) {
        const a = Math.min(m - 1, Math.max(0, (x[i] / cs) | 0)), b = Math.min(m - 1, Math.max(0, (y[i] / cs) | 0)), c = Math.min(m - 1, Math.max(0, (z[i] / cs) | 0));
        const k = (a * m + b) * m + c; next[i] = head[k]; head[k] = i;
      }
      for (let ix = 0; ix < m; ix++) for (let iy = 0; iy < m; iy++) for (let iz = 0; iz < m; iz++) {
        const c = (ix * m + iy) * m + iz;
        for (let dxc = -1; dxc <= 1; dxc++) for (let dyc = -1; dyc <= 1; dyc++) for (let dzc = -1; dzc <= 1; dzc++) {
          let jx = ix + dxc, jy = iy + dyc, jz = iz + dzc;
          if (per) { jx = (jx + m) % m; jy = (jy + m) % m; jz = (jz + m) % m; }
          else if (jx < 0 || jy < 0 || jz < 0 || jx >= m || jy >= m || jz >= m) continue;
          const c2 = (jx * m + jy) * m + jz;
          for (let i = head[c]; i >= 0; i = next[i]) for (let j = head[c2]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            let dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j];
            if (per) { dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); dz -= L * Math.round(dz / L); }
            if (dx * dx + dy * dy + dz * dz < rl2) push(i, j);
          }
        }
      }
    }
    this.np = np; this.listN = N; this.listL = L; this.listPer = per; this.listRc = this.rcUsed;
    this.xr.set(x.subarray(0, N)); this.yr.set(y.subarray(0, N)); this.zr.set(z.subarray(0, N));
  }

  needList() {
    const N = this.N, L = this.L;
    if (this.listDirty || this.np < 0 || N !== this.listN || L !== this.listL || this.periodic !== this.listPer || this.rcUsed !== this.listRc) return true;
    const lim = 0.25 * this.skin * this.skin, per = this.periodic;
    const x = this.x, y = this.y, z = this.z, xr = this.xr, yr = this.yr, zr = this.zr;
    for (let i = 0; i < N; i++) {
      let dx = x[i] - xr[i], dy = y[i] - yr[i], dz = z[i] - zr[i];
      if (per) { dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); dz -= L * Math.round(dz / L); }
      if (dx * dx + dy * dy + dz * dz > lim) return true;
    }
    return false;
  }

  computeForces() {
    const N = this.N, L = this.L, per = this.periodic;
    const x = this.x, y = this.y, z = this.z, fx = this.fx, fy = this.fy, fz = this.fz, coord = this.coord;
    const rc = per ? Math.min(this.rc, L / 2 - this.skin * 0 - 1e-6) : this.rc;
    this.rcUsed = rc;
    if (this.needList()) { this.buildList(); this.listDirty = false; }
    const rc2 = rc * rc;
    const ir6c = 1 / (rc2 * rc2 * rc2), shift = 4 * (ir6c * ir6c - ir6c);
    const NB = 1.4 * 1.4;
    const want = this.rdfWant, rdfMax = this.rdfMax, rdfMax2 = rdfMax * rdfMax, rdfK = this.rdfBins / rdfMax;
    const hist = this.rdfHist, pi = this.pi, pj = this.pj, np = this.np, hL = 0.5 * L;
    let pe = 0, vir = 0;
    for (let i = 0; i < N; i++) { fx[i] = fy[i] = fz[i] = 0; coord[i] = 0; }
    for (let p = 0; p < np; p++) {
      const i = pi[p], j = pj[p];
      let dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j];
      if (per) {
        if (dx > hL) dx -= L; else if (dx < -hL) dx += L;
        if (dy > hL) dy -= L; else if (dy < -hL) dy += L;
        if (dz > hL) dz -= L; else if (dz < -hL) dz += L;
      }
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= rc2) continue;
      if (r2 < NB) { coord[i]++; coord[j]++; }
      if (want && r2 < rdfMax2) hist[(Math.sqrt(r2) * rdfK) | 0]++;
      const rr2 = r2 < 0.6 ? 0.6 : r2;                // numerical guard against overlapping atoms
      const ir2 = 1 / rr2, ir6 = ir2 * ir2 * ir2;
      const ff = 24 * ir2 * ir6 * (2 * ir6 - 1);
      fx[i] += ff * dx; fy[i] += ff * dy; fz[i] += ff * dz;
      fx[j] -= ff * dx; fy[j] -= ff * dy; fz[j] -= ff * dz;
      pe += 4 * ir6 * (ir6 - 1) - shift;
      vir += ff * rr2;
    }
    // external tweezers spring on one atom
    const e = this.ext;
    if (e.i >= 0 && e.i < N) {
      let dx = e.x - x[e.i], dy = e.y - y[e.i], dz = e.z - z[e.i];
      if (per) { dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); dz -= L * Math.round(dz / L); }
      let fxx = e.k * dx, fyy = e.k * dy, fzz = e.k * dz;
      const fm = Math.hypot(fxx, fyy, fzz), cap = 60;
      if (fm > cap) { const s = cap / fm; fxx *= s; fyy *= s; fzz *= s; }
      fx[e.i] += fxx - 1.5 * this.vx[e.i]; fy[e.i] += fyy - 1.5 * this.vy[e.i]; fz[e.i] += fzz - 1.5 * this.vz[e.i];
      this.extForce = Math.min(1, fm / cap);
    } else this.extForce = 0;
    this.PE = pe; this.virial = vir;
    const zs = this.z_;
    for (let i = 0; i < N; i++) zs[i] += 0.03 * (coord[i] - zs[i]);
  }

  /* ---------- time stepping ---------- */
  stepOnce() {
    const N = this.N; if (!N || this.exploded) return;
    const dt = this.dt, hdt = 0.5 * dt, L = this.L, per = this.periodic;
    const x = this.x, y = this.y, z = this.z, vx = this.vx, vy = this.vy, vz = this.vz, fx = this.fx, fy = this.fy, fz = this.fz;
    for (let i = 0; i < N; i++) {
      vx[i] += hdt * fx[i]; vy[i] += hdt * fy[i]; vz[i] += hdt * fz[i];
      const dx = dt * vx[i], dy = dt * vy[i], dz = dt * vz[i];
      x[i] += dx; y[i] += dy; z[i] += dz;
      this.cx[i] += dx; this.cy[i] += dy; this.cz[i] += dz;
      if (per) {
        if (x[i] < 0) x[i] += L; else if (x[i] >= L) x[i] -= L;
        if (y[i] < 0) y[i] += L; else if (y[i] >= L) y[i] -= L;
        if (z[i] < 0) z[i] += L; else if (z[i] >= L) z[i] -= L;
      } else {
        if (x[i] < 0) { x[i] = -x[i]; this.wallImpulse += 2 * Math.abs(vx[i]); vx[i] = -vx[i]; } else if (x[i] > L) { x[i] = 2 * L - x[i]; this.wallImpulse += 2 * Math.abs(vx[i]); vx[i] = -vx[i]; }
        if (y[i] < 0) { y[i] = -y[i]; this.wallImpulse += 2 * Math.abs(vy[i]); vy[i] = -vy[i]; } else if (y[i] > L) { y[i] = 2 * L - y[i]; this.wallImpulse += 2 * Math.abs(vy[i]); vy[i] = -vy[i]; }
        if (z[i] < 0) { z[i] = -z[i]; this.wallImpulse += 2 * Math.abs(vz[i]); vz[i] = -vz[i]; } else if (z[i] > L) { z[i] = 2 * L - z[i]; this.wallImpulse += 2 * Math.abs(vz[i]); vz[i] = -vz[i]; }
        x[i] = clamp(x[i], 0, L); y[i] = clamp(y[i], 0, L); z[i] = clamp(z[i], 0, L);
      }
    }
    this.rdfWant = (this.step % 10 === 0);
    this.computeForces();
    if (this.rdfWant) { this.rdfSamples++; this.rdfNsum += N; this.rdfRhoSum += this.density; }
    for (let i = 0; i < N; i++) { vx[i] += hdt * fx[i]; vy[i] += hdt * fy[i]; vz[i] += hdt * fz[i]; }
    let KE = this.kinetic();
    // Berendsen thermostat
    if (this.thermostat && KE > 0) {
      const T = 2 * KE / Math.max(1, 3 * N - 3);
      let lam = Math.sqrt(1 + (dt / this.tauT) * (this.Ttarget / T - 1));
      lam = clamp(lam, 0.95, 1.05);
      for (let i = 0; i < N; i++) { vx[i] *= lam; vy[i] *= lam; vz[i] *= lam; }
      KE *= lam * lam;
    }
    this.KE = KE;
    this.time += dt; this.step++; this.wallTime += dt;
    if (!isFinite(KE) || KE / N > 400 || !isFinite(this.PE)) this.exploded = true;
    if (!per && this.wallTime > 30 * dt * 10) {
      this.Pwall = this.wallImpulse / (6 * L * L * this.wallTime);
      this.wallImpulse = 0; this.wallTime = 0;
    }
  }

  run(n) { for (let k = 0; k < n && !this.exploded; k++) this.stepOnce(); }

  switchBoundary(periodic) {
    if (this.periodic === periodic) return;
    this.periodic = periodic; this.wallImpulse = 0; this.wallTime = 0; this.Pwall = 0;
    for (let i = 0; i < this.N; i++) {
      this.x[i] = clamp(this.x[i], 0, this.L); this.y[i] = clamp(this.y[i], 0, this.L); this.z[i] = clamp(this.z[i], 0, this.L);
    }
    this.resetRDF(); this.computeForces();
  }
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Fraction-of-the-way helper used for colours: 0..1
export function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
