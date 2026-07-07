/* trajectory_solver.js — semiclassical ballistic / quasi-ballistic transport.
 *
 * Electrons are launched from source contacts and propagated as classical
 * particles at the graphene Fermi velocity. A magnetic field bends them along
 * cyclotron arcs; a finite mean free path randomises their momentum; device
 * edges reflect or absorb them; contacts terminate them. Counting which
 * terminal each trajectory reaches gives Landauer-Buttiker-style transmission.
 *
 * Geometry is a rectangle [0,W] x [0,H] (metres). Contacts are segments on the
 * four edges. Local carrier density n(x,y) and mean free path l(x,y) may be
 * supplied as sampler functions (e.g. from image maps); otherwise globals are
 * used. Deterministic for a fixed seed.
 */
(function (global) {
  "use strict";

  // Seeded PRNG (mulberry32): small, fast, reproducible.
  function makeRNG(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STATUS = {
    TRANSMITTED: "transmitted", // reached a non-source contact
    REFLECTED: "reflected", // returned to a source contact
    ABSORBED: "absorbed", // reached an absorber contact
    LOST: "lost", // left the active region without a contact
    MAXSTEPS: "max_steps", // ran out of steps / path budget
  };

  class TrajectorySolver {
    /* cfg: {
     *   W, H            device size (m)
     *   B               magnetic field (T)
     *   vF              Fermi velocity (m/s)
     *   contacts        [{id, edge:'left|right|top|bottom', center, width, role}]
     *   nSampler(x,y)   -> carrier density (m^-2), signed
     *   mfpSampler(x,y) -> mean free path (m)
     *   scattering      'isotropic'|'smallangle'|'forward'|'none'
     *   edge            'specular'|'diffuse'|'absorbing'|'mixed'
     *   specularFrac    fraction specular for 'mixed' (0..1)
     *   ds              step length (m)
     *   maxSteps        per-trajectory step cap
     *   maxPath         per-trajectory path-length cap (m)
     *   seed            PRNG seed
     * } */
    constructor(cfg) {
      this.cfg = cfg;
      this.PHYS = (global.GT && global.GT.PHYS) || { e: 1.602176634e-19, hbar: 1.054571817e-34 };
    }

    _n(x, y) {
      const c = this.cfg;
      return c.nSampler ? c.nSampler(x, y) : c.n0;
    }
    _mfp(x, y) {
      const c = this.cfg;
      return c.mfpSampler ? c.mfpSampler(x, y) : c.mfp;
    }

    // Local cyclotron radius (m); Infinity at B=0. Sign of rotation set later.
    _cyclotronRadius(x, y) {
      const B = this.cfg.B;
      if (!B) return Infinity;
      const n = Math.abs(this._n(x, y));
      const kF = Math.sqrt(Math.PI * n);
      return (this.PHYS.hbar * kF) / (this.PHYS.e * Math.abs(B));
    }

    // Which contact (if any) covers a boundary crossing point on a given edge.
    _contactAt(edge, x, y) {
      const { W, H } = this.cfg;
      for (const c of this.cfg.contacts) {
        if (c.edge !== edge) continue;
        const pos = edge === "left" || edge === "right" ? y : x;
        if (Math.abs(pos - c.center) <= c.width / 2) return c;
      }
      return null;
    }

    _scatterAngle(theta, rng) {
      switch (this.cfg.scattering) {
        case "none":
          return theta;
        case "smallangle":
          return theta + (rng() - 0.5) * 0.6; // ~+-0.3 rad
        case "forward": {
          // biased forward: small deflection most of the time
          const d = (rng() - 0.5) * Math.PI * 0.5;
          return theta + d;
        }
        case "isotropic":
        default:
          return rng() * 2 * Math.PI;
      }
    }

    // Reflect direction at an edge with the given outward normal (nx, ny).
    _reflect(theta, nx, ny, rng) {
      const edge = this.cfg.edge;
      let useSpecular = edge === "specular";
      if (edge === "mixed") useSpecular = rng() < (this.cfg.specularFrac ?? 0.5);
      if (edge === "diffuse" || (edge === "mixed" && !useSpecular)) {
        // Lambertian-ish: random angle into the domain (opposite the normal).
        const inward = Math.atan2(-ny, -nx);
        return inward + (rng() - 0.5) * Math.PI; // +-90 deg about inward
      }
      // specular: reflect velocity about the surface (flip normal component)
      const vx = Math.cos(theta), vy = Math.sin(theta);
      const dot = vx * nx + vy * ny;
      return Math.atan2(vy - 2 * dot * ny, vx - 2 * dot * nx);
    }

    /* Run the simulation. Returns trajectories, transmission stats and a
     * density heatmap (gx x gy). keepPaths caps stored polylines for drawing. */
    run(opts) {
      opts = opts || {};
      const c = this.cfg;
      const rng = makeRNG(c.seed || 1);
      // Region mode: contacts are arbitrary areas, detected by c.contactAt(x,y),
      // launched via c.sources[*].launch(rng). Otherwise legacy edge segments.
      const region = typeof c.contactAt === "function";
      const sources = region ? (c.sources || []) : c.contacts.filter((k) => k.role === "source");
      const N = c.nTraj || 2000;
      let ds = c.ds || Math.min(c.W, c.H) / 400;
      // Resolve scattering: the integration step must be well below the mean free
      // path, otherwise a fixed step can scatter at most once per ds and silently
      // floors the effective mfp (over-estimating G at small ℓ). Refine ds when a
      // finite uniform mfp is set and scattering is active.
      if (c.scattering && c.scattering !== "none" && isFinite(c.mfp) && c.mfp > 0) {
        ds = Math.min(ds, c.mfp / 5);
      }
      const maxPath = c.maxPath || 50 * Math.max(c.W, c.H);
      // Honor maxPath as the physical limit: a trajectory needs ~maxPath/ds steps
      // to travel that far, so raise the step cap to reach it (the user-set
      // maxSteps acts as a floor). A hard ceiling guards against runaway loops.
      const maxSteps = Math.min(5e6, Math.max(c.maxSteps || 6000, Math.ceil(maxPath / ds) + 100));
      const keepPaths = opts.keepPaths ?? 60;

      // density heatmap grid
      const gx = c.gx || 120, gy = c.gy || Math.max(20, Math.round((120 * c.H) / c.W));
      const density = new Float64Array(gx * gy);

      // transmission counts: launched per source, reached per (source->terminal)
      const launched = {}, reached = {};
      for (const s of sources) { launched[s.id] = 0; reached[s.id] = {}; }

      const paths = [];
      const pathLengths = [];
      const scatterCounts = [];
      const statuses = {};
      const scatterPoints = [];

      const eB = this.PHYS.e * c.B;

      for (let t = 0; t < N; t++) {
        const src = sources[t % Math.max(1, sources.length)];
        if (!src) break;
        launched[src.id]++;

        // launch position + angle into the device
        let x, y, theta;
        if (region) {
          const L = src.launch(rng); x = L[0]; y = L[1]; theta = L[2];
        } else {
          const off = (rng() - 0.5) * src.width;
          if (src.edge === "left") { x = 1e-12; y = src.center + off; theta = (rng() - 0.5) * Math.PI; }
          else if (src.edge === "right") { x = c.W - 1e-12; y = src.center + off; theta = Math.PI + (rng() - 0.5) * Math.PI; }
          else if (src.edge === "bottom") { x = src.center + off; y = 1e-12; theta = (rng() - 0.5) * Math.PI + Math.PI / 2; }
          else { x = src.center + off; y = c.H - 1e-12; theta = (rng() - 0.5) * Math.PI - Math.PI / 2; }
        }
        y = Math.max(0, Math.min(c.H, y)); x = Math.max(0, Math.min(c.W, x));
        let leftSource = false; // becomes true once the trajectory exits its source region

        const recordPath = t < keepPaths;
        const poly = recordPath ? [[x, y]] : null;
        let pathLen = 0, nScatter = 0;
        let nextScatter = -this._mfp(x, y) * Math.log(rng() || 1e-12);
        let sinceScatter = 0;
        let status = STATUS.MAXSTEPS, terminal = null;

        for (let step = 0; step < maxSteps; step++) {
          // turn rate from local cyclotron radius (sign: charge & B & carrier sign)
          if (eB) {
            const rc = this._cyclotronRadius(x, y);
            if (isFinite(rc) && rc > 0) {
              const sign = (c.B >= 0 ? 1 : -1) * (this._n(x, y) >= 0 ? 1 : -1);
              theta += sign * (ds / rc);
            }
          }
          const nx = x + ds * Math.cos(theta);
          const ny = y + ds * Math.sin(theta);

          // boundary handling
          let hitEdge = null, normal = null;
          if (nx <= 0) { hitEdge = "left"; normal = [-1, 0]; }
          else if (nx >= c.W) { hitEdge = "right"; normal = [1, 0]; }
          else if (ny <= 0) { hitEdge = "bottom"; normal = [0, -1]; }
          else if (ny >= c.H) { hitEdge = "top"; normal = [0, 1]; }

          if (hitEdge) {
            const crossPos = hitEdge === "left" || hitEdge === "right"
              ? Math.max(0, Math.min(c.H, ny)) : Math.max(0, Math.min(c.W, nx));
            const cx = hitEdge === "left" ? 0 : hitEdge === "right" ? c.W : Math.max(0, Math.min(c.W, nx));
            const cyc = hitEdge === "bottom" ? 0 : hitEdge === "top" ? c.H : Math.max(0, Math.min(c.H, ny));
            const contact = region
              ? c.contactAt(Math.max(1e-12, Math.min(c.W - 1e-12, cx)), Math.max(1e-12, Math.min(c.H - 1e-12, cyc)))
              : this._contactAt(hitEdge, cx, cyc);
            if (contact && (contact.id !== src.id || leftSource)) {
              terminal = contact.id;
              if (contact.role === "source" && contact.id === src.id) status = STATUS.REFLECTED;
              else if (contact.role === "absorber" || contact.role === "floating") status = STATUS.ABSORBED;
              else status = STATUS.TRANSMITTED;
              if (poly) poly.push([cx, cyc]);
              break;
            }
            // insulating edge: reflect or absorb
            if (c.edge === "absorbing") { status = STATUS.LOST; if (poly) poly.push([cx, cyc]); break; }
            theta = this._reflect(theta, normal[0], normal[1], rng);
            x = Math.max(1e-12, Math.min(c.W - 1e-12, cx));
            y = Math.max(1e-12, Math.min(c.H - 1e-12, cyc));
            if (poly) poly.push([x, y]);
            continue;
          }

          x = nx; y = ny; pathLen += ds; sinceScatter += ds;

          // accumulate density heatmap
          const ix = Math.min(gx - 1, Math.max(0, Math.floor((x / c.W) * gx)));
          const iy = Math.min(gy - 1, Math.max(0, Math.floor((y / c.H) * gy)));
          density[iy * gx + ix] += 1;

          // region-mode contact detection anywhere in the domain
          if (region) {
            const hc = c.contactAt(x, y);
            if (!hc || hc.id !== src.id) leftSource = true;
            if (hc && (hc.id !== src.id || leftSource)) {
              terminal = hc.id;
              status = hc.role === "source" ? STATUS.REFLECTED
                : (hc.role === "absorber" || hc.role === "floating") ? STATUS.ABSORBED
                : STATUS.TRANSMITTED;
              if (poly) poly.push([x, y]);
              break;
            }
          }

          // scattering
          if (c.scattering !== "none" && sinceScatter >= nextScatter) {
            theta = this._scatterAngle(theta, rng);
            nScatter++;
            sinceScatter = 0;
            nextScatter = -this._mfp(x, y) * Math.log(rng() || 1e-12);
            if (scatterPoints.length < 4000 && recordPath) scatterPoints.push([x, y]);
          }
          if (poly && step % 2 === 0) poly.push([x, y]);
          if (pathLen > maxPath) { status = STATUS.MAXSTEPS; break; }
        }

        if (terminal) {
          reached[src.id][terminal] = (reached[src.id][terminal] || 0) + 1;
        }
        statuses[status] = (statuses[status] || 0) + 1;
        pathLengths.push(pathLen);
        scatterCounts.push(nScatter);
        if (poly) paths.push({ points: poly, status, source: src.id, terminal });
      }

      // transmission matrix T_ij and conductance estimate
      const transmission = this._transmission(launched, reached);

      return {
        paths,
        density,
        gx, gy,
        pathLengths,
        scatterCounts,
        statuses,
        launched,
        reached,
        transmission,
        nLaunched: N,
      };
    }

    _transmission(launched, reached) {
      const c = this.cfg;
      const region = typeof c.contactAt === "function";
      const sources = region ? (c.sources || []) : c.contacts.filter((k) => k.role === "source");
      const terminals = region ? (c.terminals || c.sources || []) : c.contacts;
      const rows = [];
      const Gq = (global.GT && global.GT.phys && global.GT.phys.conductanceQuantum)
        ? global.GT.phys.conductanceQuantum() : (4 * 1.602176634e-19 ** 2) / 6.62607015e-34;
      for (const s of sources) {
        const Ni = launched[s.id] || 1;
        const row = { source: s.id, T: {}, G: {} };
        // modes at the source: M ~ W kF / pi
        const mid = region ? [s.cx, s.cy] : this._edgeMid(s);
        const nAtS = Math.abs(c.nSampler ? c.nSampler(mid[0], mid[1]) : c.n0);
        const kF = Math.sqrt(Math.PI * nAtS);
        const M = Math.max(1, ((s.width || (c.H)) * kF) / Math.PI);
        for (const term of terminals) {
          if (term.id === s.id) continue;
          const Nij = (reached[s.id] && reached[s.id][term.id]) || 0;
          const T = Nij / Ni;
          row.T[term.id] = T;
          row.G[term.id] = Gq * M * T; // semiclassical Landauer-Buttiker estimate
        }
        rows.push(row);
      }
      return rows;
    }

    _edgeMid(contact) {
      const { W, H } = this.cfg;
      if (contact.edge === "left") return [0, contact.center];
      if (contact.edge === "right") return [W, contact.center];
      if (contact.edge === "bottom") return [contact.center, 0];
      return [contact.center, H];
    }
  }

  global.GT = global.GT || {};
  global.GT.TrajectorySolver = TrajectorySolver;
  global.GT.STATUS = STATUS;
  global.GT.makeRNG = makeRNG;
})(typeof window !== "undefined" ? window : globalThis);
