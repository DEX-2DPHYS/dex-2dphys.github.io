// Monte Carlo batches → merged statistics → PSF object.
//
// A run is a sequence of batches; each batch is seeded by (seed, batch index), so the merged
// result does not depend on how batches were spread over workers. Per-bin standard errors come
// from the spread between batches (each batch is an independent estimate).

import { makePSF, normalize } from '../psf/psf.js';
import { fitGaussians } from '../psf/fit.js';

export function makeAccumulator(transport) {
  const { nR, nz } = transport;
  return {
    n: 0, batches: 0,
    sum: new Float64Array(nR * nz), sum2: new Float64Array(nR),   // sum2 of per-batch, per-electron radial values
    depLayer: new Float64Array(transport.zTop.length),
    bsCount: 0, bsEnergy: 0, trCount: 0, trEnergy: 0, killed: 0, steps: 0, depFwd: 0, depBack: 0,
    nR, nz, edges: transport.rEdges, cfg: transport.cfg,
  };
}

export function addBatch(acc, b) {
  acc.n += b.n; acc.batches++;
  for (let k = 0; k < b.tally.length; k++) acc.sum[k] += b.tally[k];
  for (let i = 0; i < acc.nR; i++) {
    let t = 0;
    for (let z = 0; z < acc.nz; z++) t += b.tally[z * acc.nR + i];
    const perE = t / b.n;
    acc.sum2[i] += perE * perE * b.n;          // weighted by batch size
  }
  for (let k = 0; k < b.depLayer.length; k++) acc.depLayer[k] += b.depLayer[k];
  acc.bsCount += b.bsCount; acc.bsEnergy += b.bsEnergy; acc.trCount += b.trCount; acc.trEnergy += b.trEnergy;
  acc.killed += b.killed; acc.steps += b.steps; acc.depFwd += b.depFwd || 0; acc.depBack += b.depBack || 0;
  return acc;
}

// A chunk of batches already merged elsewhere (the DSW plugin's native core): the same sums
// addBatch would have made one batch at a time, including Σ (per-electron radial value)²·n.
export function addAggregate(acc, a) {
  acc.n += a.n; acc.batches += a.batches;
  for (let k = 0; k < acc.sum.length; k++) acc.sum[k] += a.sum[k];
  for (let i = 0; i < acc.nR; i++) acc.sum2[i] += a.sum2[i];
  for (let k = 0; k < acc.depLayer.length; k++) acc.depLayer[k] += a.depLayer[k];
  acc.bsCount += a.bsCount; acc.bsEnergy += a.bsEnergy; acc.trCount += a.trCount; acc.trEnergy += a.trEnergy;
  acc.killed += a.killed; acc.steps += a.steps; acc.depFwd += a.depFwd || 0; acc.depBack += a.depBack || 0;
  return acc;
}

// What the native core needs to run createTransport(cfg)'s batches: the merged config and the
// physics tables, as plain JSON (typed arrays → arrays; Infinity thicknesses → null, read back as ∞).
export function transportPayload(t) {
  const A = (v) => Array.from(v);
  const T = t.tables;
  return {
    cfg: t.cfg,
    tables: {
      lnLo: T.lnLo, dln: T.dln, NE: T.NE,
      mats: T.mats.map((m) => ({
        nEl: m.nEl, Z: A(m.Z), kappa0: A(m.kappa0), mottOn: A(m.mottOn), relScreen: m.relScreen,
        invLam: A(m.invLam), elCum: A(m.elCum), S: A(m.S), lnR: A(m.lnR), invLnE: A(m.invLnE), invE: A(m.invE),
        invLamM: A(m.invLamM), r0: m.r0, dr: m.dr, NI: m.NI, hybrid: m.hybrid, wcut: m.wcut,
      })),
    },
  };
}

// Radial profile per electron: energy per bin, per area (keV/nm² per electron), relative error.
export function radialProfile(acc) {
  const { nR, nz, edges } = acc;
  const rows = [];
  const nb = Math.max(1, acc.batches);
  for (let i = 0; i < nR - 1; i++) {                                  // last bin = overflow
    let e = 0;
    for (let z = 0; z < nz; z++) e += acc.sum[z * nR + i];
    const mean = e / acc.n;
    // between-batch variance of the per-electron mean (batches of equal size assumed)
    const ex2 = acc.sum2[i] / acc.n;
    const varMean = nb > 1 ? Math.max(0, ex2 - mean * mean) / (nb - 1) : NaN;
    const r1 = edges[i], r2 = edges[i + 1], area = Math.PI * (r2 * r2 - r1 * r1);
    const rc = i === 0 ? r2 / Math.SQRT2 : Math.sqrt(r1 * r2);       // rms radius of the disc, geometric centre of a ring
    rows.push({ r: rc, r1, r2, energy: mean, f: mean / area, rel: mean > 0 ? Math.sqrt(varMean) / mean : Infinity });
  }
  return rows;
}

// Summary numbers for the UI.
export function summary(acc) {
  const E0 = acc.cfg.E0, n = acc.n;
  const resist = acc.sum.reduce((a, b) => a + b, 0) / n;
  return {
    electrons: n, eta_BSE: acc.bsCount / n, bsEnergyFraction: acc.bsEnergy / (n * E0),
    transmitted: acc.trCount / n, resistEnergyPerElectron: resist, stepsPerElectron: acc.steps / n,
    killedFraction: acc.killed / n,
    // η by history, no model: resist energy from electrons that came back from below ÷ from those that never left
    etaHistory: acc.depFwd > 0 ? acc.depBack / acc.depFwd : null,
  };
}

// Statistical quality of the long-range part: relative error of the energy deposited beyond
// rSplit (default 100 nm), which is what β and η are fitted from.
export function tailError(acc, rFrom = 100) {
  const rows = radialProfile(acc);
  let e = 0, v = 0;
  for (const row of rows) if (row.r1 >= rFrom && row.energy > 0 && Number.isFinite(row.rel)) { e += row.energy; v += (row.rel * row.energy) ** 2; }
  return e > 0 ? Math.sqrt(v) / e : Infinity;
}

// The PSF object: per-area values at bin centres, cut after the last bin with energy,
// normalised, with a fit of the chosen model attached.
export function toPSF(acc, { model = 'gauss-exp', objective = 'energy', meta = {}, fit = true } = {}) {
  const rows = radialProfile(acc).filter((row) => row.energy > 0);
  if (rows.length < 8) throw new Error('not enough statistics yet');
  const s = summary(acc);
  let psf = makePSF({
    r: rows.map((row) => row.r), f: rows.map((row) => row.f),
    meta: {
      source: 'mc', energyKeV: acc.cfg.E0, stack: acc.cfg.layers.map((l) => ({ material: l.mat, thicknessNm: Number.isFinite(l.thickness) ? l.thickness : null })),
      electrons: s.electrons, beamA: acc.cfg.beamA, mott: acc.cfg.mott, Ecut: acc.cfg.Ecut, eta_BSE: s.eta_BSE,
      absoluteKeVPerElectron: s.resistEnergyPerElectron, ...meta,
    },
  });
  psf = normalize(psf);
  psf.relErr = rows.map((row) => row.rel);
  if (fit) psf.fit = fitGaussians(psf, { model, objective });
  return psf;
}
