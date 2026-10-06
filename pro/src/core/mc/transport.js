// Monte Carlo electron transport through a layer stack, tallying the energy deposited in one
// layer (the resist) as a function of the distance r from the beam axis.
//
// Single-scattering model: free flights between elastic events drawn from the total
// screened-Rutherford cross-section, CSDA energy loss along each flight (exact, through the
// range table), layer boundaries hit exactly (the flight is resampled in the new material —
// exact, since the exponential distribution is memoryless).
//
// Speed without bias:
//   range rejection    an electron below the resist whose CSDA range in the *least stopping*
//                      material below cannot cover the distance back up can never deposit in
//                      the resist again: its remaining energy is booked locally and it stops.
//   step cap           a flight is cut at 8 % of the current range (energy drop ≤ ~5 %) so the
//                      cross-section used for the flight stays accurate; the cut is not an
//                      event (memoryless), so it adds no bias.
//   tables             every per-step quantity is a table lookup on one log-energy grid.
//
// Fast secondaries (physics.secondaries, default): collisions with an energy transfer above
// wcut are discrete Møller events; the knock-on electron is pushed on a stack and tracked like
// the primary (same tallies, same range rejection — its range is below its parent's), and the
// continuous loss uses the restricted stopping power. See physics.js.
//
// Geometry: z is depth below the top surface (positive down), the beam enters at z = 0 along +z.

import { buildTables, sampleSin2Half, scatterDirection, rotateDir, sampleMoller, cosKnockOn } from './physics.js';
import { makeRng } from './rng.js';

const TWO_PI = 2 * Math.PI;

// config = { E0, layers: [{mat, thickness}] (last may be Infinity), tallyLayer = 0, Ecut = 0.5,
//            beamA = 0 (nm, beam/SE blur in the notes' convention exp(-r²/a²)), mott = true,
//            rangeRejection = true, r0 = 0.25 nm, perDecade = 25, rMax (nm), nz = 1 }
export function createTransport(config) {
  const cfg = { tallyLayer: 0, Ecut: 0.5, beamA: 0, mott: true, rangeRejection: true, r0: 0.25, perDecade: 25, nz: 1, ...config };
  const E0 = cfg.E0;
  const keys = [...new Set(cfg.layers.map((l) => l.mat))];
  const T = buildTables(keys, { E0, Ecut: cfg.Ecut, mott: cfg.mott, physics: cfg.physics });
  const nL = cfg.layers.length;
  const zTop = new Float64Array(nL), zBot = new Float64Array(nL), matOf = new Int32Array(nL);
  let z = 0;
  cfg.layers.forEach((l, i) => { zTop[i] = z; z += l.thickness > 0 ? l.thickness : Infinity; zBot[i] = z; matOf[i] = keys.indexOf(l.mat); });
  const tallyL = cfg.tallyLayer, tz0 = zTop[tallyL], tz1 = zBot[tallyL], tThick = tz1 - tz0;
  const mats = T.mats;
  const lnLo = T.lnLo, dln = T.dln, NE = T.NE;
  const Ecut = cfg.Ecut;

  // range at the cut-off, per material
  const Rcut = mats.map((m) => { const u = (Math.log(Ecut) - lnLo) / dln, i = Math.floor(u), f = u - i; return Math.exp(m.lnR[i] + f * (m.lnR[i + 1] - m.lnR[i])); });
  const Zpow = mats.map((m) => Float64Array.from(m.Z, (Z) => 3.4e-3 * Math.pow(Z, 0.67)));
  // envelope range for rejection: stopping power minimum over the layers below the tally layer
  const below = [];
  for (let i = tallyL + 1; i < nL; i++) if (!below.includes(matOf[i])) below.push(matOf[i]);
  // (stored linearly; the test uses the upper grid neighbour, so it stays a strict bound)
  let envR = null;
  if (below.length && cfg.rangeRejection) {
    envR = new Float64Array(NE);
    const Smin = (i) => Math.min(...below.map((k) => mats[k].S[i]));
    let R = Math.exp(lnLo) / Smin(0);
    envR[0] = R;
    for (let i = 1; i < NE; i++) {
      const Ea = Math.exp(lnLo + (i - 1) * dln), Eb = Math.exp(lnLo + i * dln);
      R += 0.5 * (Ea / Smin(i - 1) + Eb / Smin(i)) * dln;
      envR[i] = R;
    }
  }

  // radial bins: bin 0 is the disc r < r0, then perDecade log bins up to rMax, last = overflow
  const r0 = cfg.r0, perLn = cfg.perDecade / Math.LN10;
  const rMax = cfg.rMax || 2e5;
  const nR = 2 + Math.ceil(Math.log(rMax / r0) * perLn);
  const lnr0 = Math.log(r0);
  const rEdges = new Float64Array(nR + 1);
  rEdges[0] = 0;
  for (let k = 1; k <= nR; k++) rEdges[k] = r0 * Math.exp((k - 1) / perLn);
  const nz = Math.max(1, cfg.nz | 0);

  // rec (optional, for the trajectory view; the random stream is untouched, so the run is the same):
  //   rec.nShow   electrons whose tracks are recorded (the first ones of the batch, knock-ons included)
  //   rec.add(t)  t = {pts: [x0, z0, x1, z1, ...] (nm), e: electron, primary, out: 1 when it left through the top surface}
  //   rec.dep(x1, z1, x2, z2, dE)  every energy deposit in any layer, along its segment (keV)
  function runBatch(n, seed, batch, rec = null) {
    const rng = makeRng(seed, batch);
    const tally = new Float64Array(nR * nz);         // keV deposited per (depth slice, radial bin)
    const depLayer = new Float64Array(nL);
    let bsCount = 0, bsEnergy = 0, trCount = 0, trEnergy = 0, killed = 0, killedEnergy = 0, steps = 0, tallyHits = 0, depFwd = 0, depBack = 0;
    let nSec = 0, bsSec = 0;                           // knock-on electrons made / leaving the top
    const stack = [];                                  // knock-on electrons waiting to be tracked

    const deposit = (x1, y1, z1, x2, y2, z2, dE) => {
      // spread along the segment so a long flight near the axis is resolved radially
      const dx = x2 - x1, dy = y2 - y1;
      const L = Math.sqrt(dx * dx + dy * dy);
      let k = 1;
      if (L > 0) {
        const rm = Math.min(Math.sqrt(x1 * x1 + y1 * y1), Math.sqrt(x2 * x2 + y2 * y2));
        k = Math.min(64, 1 + Math.floor(L / (0.25 * rm + 0.05)));
      }
      const q = dE / k;
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const x = x1 + dx * t, y = y1 + dy * t, zz = z1 + (z2 - z1) * t;
        const r = Math.sqrt(x * x + y * y);
        let b = r < r0 ? 0 : 1 + Math.floor((Math.log(r) - lnr0) * perLn);
        if (b >= nR) b = nR - 1;
        let iz = nz > 1 ? Math.floor(((zz - tz0) / tThick) * nz) : 0;
        if (iz < 0) iz = 0; else if (iz >= nz) iz = nz - 1;
        tally[iz * nR + b] += q;
      }
      tallyHits++;
    };

    const dir = new Float64Array(3), dirS = new Float64Array(3);
    let tr = null;                                     // the track being recorded (rec)
    const recDep = rec && rec.dep ? rec.dep : null;
    // one electron (a primary, or a knock-on from the stack) until it stops or leaves
    const track = (x, y, zz, u, v, w, E, L, back, primary) => {
      let mi = matOf[L], m = mats[mi];                          // back: has been below the tally layer
      let lnE = Math.log(E);
      let ui = (lnE - lnLo) / dln, ii = Math.floor(ui), fi = ui - ii;
      let lnR = m.lnR[ii] + fi * (m.lnR[ii + 1] - m.lnR[ii]), R = Math.exp(lnR);

      for (;;) {
        steps++;
        // flight length to the next event (elastic, or Møller above wcut), at the current energy
        const invLamE = m.invLam[ii] + fi * (m.invLam[ii + 1] - m.invLam[ii]);
        const invLamM = m.hybrid ? m.invLamM[ii] + fi * (m.invLamM[ii + 1] - m.invLamM[ii]) : 0;
        const invLam = invLamE + invLamM;
        const sEl = -Math.log(rng()) / invLam;
        const sB = w > 0 ? (zBot[L] - zz) / w : w < 0 ? (zTop[L] - zz) / w : Infinity;
        const sStop = R - Rcut[mi];
        let s = sEl, kind = 0;                      // 0 elastic, 1 boundary, 2 cap, 3 stop
        if (sB < s) { s = sB; kind = 1; }
        const cap = 0.08 * R;
        if (cap < s) { s = cap; kind = 2; }
        if (sStop <= s) { s = sStop > 0 ? sStop : 0; kind = 3; }

        const x1 = x, y1 = y, z1 = zz;
        x += u * s; y += v * s; zz += w * s;
        if (tr) tr.pts.push(x, zz);
        let Enew;
        if (kind === 3) Enew = Ecut;
        else {
          R -= s;
          lnR = Math.log(R);
          const uq = (lnR - m.r0) / m.dr;
          const iq = uq <= 0 ? 0 : uq >= m.NI - 1 ? m.NI - 2 : Math.floor(uq), fq = uq - iq;
          lnE = m.invLnE[iq] + fq * (m.invLnE[iq + 1] - m.invLnE[iq]);
          Enew = m.invE[iq] + fq * (m.invE[iq + 1] - m.invE[iq]);
        }
        const dE = E - Enew;
        depLayer[L] += dE;
        if (recDep && dE > 0) recDep(x1, z1, x, zz, dE);
        if (L === tallyL && dE > 0) { deposit(x1, y1, z1, x, y, zz, dE); if (back) depBack += dE; else depFwd += dE; }
        E = Enew;

        if (kind === 3) {                           // below the cut-off: the rest stays here
          depLayer[L] += E;
          if (recDep) recDep(x, zz, x, zz, E);
          if (L === tallyL) { deposit(x, y, zz, x, y, zz, E); if (back) depBack += E; else depFwd += E; }
          break;
        }
        if (kind === 1) {                           // cross into the neighbouring layer
          if (w > 0) { zz = zBot[L]; L++; } else { zz = zTop[L]; L--; }
          if (L < 0) { if (primary) bsCount++; else bsSec++; bsEnergy += E; if (tr) tr.out = 1; break; }
          if (L >= nL) { trCount++; trEnergy += E; break; }
          if (L > tallyL) back = true;
          mi = matOf[L]; m = mats[mi];
          ui = (lnE - lnLo) / dln; ii = Math.floor(ui); fi = ui - ii;
          lnR = m.lnR[ii] + fi * (m.lnR[ii + 1] - m.lnR[ii]); R = Math.exp(lnR);
          continue;
        }
        ui = (lnE - lnLo) / dln; ii = Math.floor(ui); fi = ui - ii;
        if (kind === 0 && invLamM > 0 && rng() * invLam < invLamM) {
          // Møller event: knock-on W, primary keeps E − W; both directions from free-electron
          // kinematics, opposite azimuths
          const W = sampleMoller(E, m.wcut, rng), E1 = E - W;
          const cs = cosKnockOn(E, W), cpr = cosKnockOn(E, E1);
          let pa, pb, ps;
          do { pa = 2 * rng() - 1; pb = 2 * rng() - 1; ps = pa * pa + pb * pb; } while (ps >= 1 || ps < 1e-12);
          const cph = (pa * pa - pb * pb) / ps, sph = (2 * pa * pb) / ps;
          dirS[0] = u; dirS[1] = v; dirS[2] = w;
          rotateDir(dirS, cs, Math.sqrt(1 - cs * cs), -cph, -sph);
          stack.push([x, y, zz, dirS[0], dirS[1], dirS[2], W, L, back]);
          nSec++;
          dir[0] = u; dir[1] = v; dir[2] = w;
          rotateDir(dir, cpr, Math.sqrt(1 - cpr * cpr), cph, sph);
          u = dir[0]; v = dir[1]; w = dir[2];
          E = E1; lnE = Math.log(E);
          ui = (lnE - lnLo) / dln; ii = Math.floor(ui); fi = ui - ii;
          lnR = m.lnR[ii] + fi * (m.lnR[ii + 1] - m.lnR[ii]); R = Math.exp(lnR);
          if (R <= Rcut[mi]) { depLayer[L] += E; if (recDep) recDep(x, zz, x, zz, E); if (L === tallyL) { deposit(x, y, zz, x, y, zz, E); if (back) depBack += E; else depFwd += E; } break; }
        } else if (kind === 0) {
          // elastic event: element, then sin²(θ/2) from the screened Rutherford distribution,
          // accepted with the McKinley–Feshbach factor where it applies
          const nEl = m.nEl;
          let j = 0;
          if (nEl > 1) { const ru = rng(), base = ii * nEl; while (j < nEl - 1 && ru > m.elCum[base + j]) j++; }
          const a = Zpow[mi][j] / (m.relScreen ? E * (1 + E / 1021.9979) : E);
          const s2 = sampleSin2Half(a, m.mottOn[j], m.kappa0[j], E, rng);
          dir[0] = u; dir[1] = v; dir[2] = w;
          scatterDirection(dir, 1 - 2 * s2, 2 * Math.sqrt(s2 * (1 - s2)), rng);
          u = dir[0]; v = dir[1]; w = dir[2];
        }
        // range rejection: can this electron still reach the bottom of the resist?
        if (envR !== null && L > tallyL && zz - tz1 > envR[ii + 1]) { if (primary) killed++; killedEnergy += E; depLayer[L] += E; if (recDep) recDep(x, zz, x, zz, E); break; }
      }
    };
    for (let e = 0; e < n; e++) {
      let x = 0, y = 0;
      if (cfg.beamA > 0) { const rb = cfg.beamA * Math.sqrt(-Math.log(rng())), ph = TWO_PI * rng(); x = rb * Math.cos(ph); y = rb * Math.sin(ph); }
      const show = rec && e < rec.nShow;
      tr = show ? { pts: [x, 0], e, primary: true, out: 0 } : null;
      track(x, y, 0, 0, 0, 1, E0, 0, false, true);
      if (tr) rec.add(tr);
      while (stack.length) {
        const s = stack.pop();
        tr = show ? { pts: [s[0], s[2]], e, primary: false, out: 0 } : null;
        track(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], false);
        if (tr) rec.add(tr);
      }
      tr = null;
    }
    // resist energy split by history: depFwd from electrons that never went below the resist,
    // depBack from those that came back up (the physical backscatter share; η_dep = depBack / depFwd)
    return { nSec, bsSec, n, tally, depLayer, bsCount, bsEnergy, trCount, trEnergy, killed, killedEnergy, steps, tallyHits, nR, nz, depFwd, depBack };
  }

  return { cfg, tables: T, runBatch, rEdges, nR, nz, keys, zTop, zBot };
}
