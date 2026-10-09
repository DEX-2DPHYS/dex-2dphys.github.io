// Resist library: contrast curves with their conditions, a model to move between conditions, and an
// honest answer to "how sure is this?".
//
// A resist entry:
//   { id, name, product, supplier, tone, family, atDTU,
//     advice: [{ topic, text, sources: [sourceId] }],
//     sources: { id: { cite, url, kind: 'labadviser'|'datasheet'|'paper'|'measured'|'estimate' } },
//     window: { kV: [lo, hi], thicknessNm: [lo, hi], developers: [devId], timeS: [lo, hi], tempC: [lo, hi], source },
//     model: {                      the analytical model, anchored at a reference curve
//       ref: { kV, thicknessNm, developer, timeS, tempC, D100, gamma, round },
//       refBasis, refUncertainty (σ of ln D100), refSources,
//       nE:     { value, sd }   D100 ∝ E^nE                 acceleration voltage (Bethe/ESTAR ≈ 0.7–0.8,
//                                                           measured 0.9–1.0 for E ≥ 10 kV)
//       p:      { value, sd }   D100 ∝ t^(−p)               development time (negative resists: p ≤ 0)
//       q:      { value, sd }   D100 ∝ h^q                  film thickness
//       EDeV:   { value, sd }   D100 ∝ exp[(E_D/k)(1/T* − 1/Tref)]   developer temperature (signed:
//                                                           negative for HSQ, which needs more dose hot)
//       TsatC:  number          below it development no longer slows: T* = max(T, Tsat)
//       cGamma: { value, sd }   γ = γref·exp[cγ·(Tref − T*)]   (cold sharpens organic positive resists)
//       developers: { devId: { factor, sd, gammaFactor, p?, EDeV?, note, sources } }   relative to ref
//       density (g/cm³, for the electron range), sources, notes }
//   Following the review of the literature (see the resist entries' sources): every variable is close to
//   separable in log dose, so ln D100 is a sum of power laws, and its uncertainty grows with the
//   log-distance travelled; γ has no reliable law and carries its own wide error.
//     datasets: [{ id, conditions: { kV, thicknessNm, developer, timeS, tempC, prebake, peb, substrate },
//                  points: [[dose, remaining fraction]] | null, fit: { D0, D100, gamma, round },
//                  quality: 'measured'|'datasheet'|'literature'|'estimate',
//                  provenance: { who, lab, date, tool, method, source }, version, supersedes }] }
//
// predict(entry, conditions) → the curve to use and its regime:
//   'measured'      a dataset matches the conditions (same kV and developer, time ±5 %, temperature ±1 °C,
//                   thickness ±15 %): its own fit, its own uncertainty
//   'window'        no dataset, but every condition inside the process window: the model, moved from the
//                   nearest dataset (or the reference) — interpolation
//   'extrapolated'  some condition outside the window: the model, with each excursion named and the
//                   uncertainty widened by how far it goes
//   'unsupported'   a developer the entry knows nothing about: the reference curve, flagged, very wide
// Nothing here ever pretends: the regime, the basis and the uncertainty travel with every number.

import { makeResist, remainingFraction } from '../physics/resist.js';

const K = (c) => c + 273.15;

export const TOL = { timeRel: 0.05, tempC: 1, thicknessRel: 0.15, kVRel: 0.02 };

const inRange = (v, r) => !r || (v >= r[0] - 1e-9 && v <= r[1] + 1e-9);
const outBy = (v, r) => (!r ? 0 : v < r[0] ? r[0] - v : v > r[1] ? v - r[1] : 0);
const sd = (p) => (p && Number.isFinite(p.sd) ? p.sd : 0);
const val = (p, d) => (p && Number.isFinite(p.value) ? p.value : d);

// ---------------------------------------------------------------- moving a curve between conditions
const K_EV = 8.617e-5;                                    // Boltzmann, eV/K
// the laws, with a developer's own time and temperature constants where it has them
function lawsFor(model, developer) {
  const d = model.developers?.[developer] || {};
  return { nE: model.nE, p: d.p ?? model.p, q: model.q, ED: d.EDeV ?? model.EDeV, cG: d.cGamma ?? model.cGamma, Tsat: model.TsatC ?? -273 };
}
// ln D100 at `to` relative to `from`, and its variance
function shift(model, from, to) {
  const L = lawsFor(model, to.developer);
  const Tf = Math.max(from.tempC, L.Tsat), Tt = Math.max(to.tempC, L.Tsat);
  const lE = Math.log(to.kV / from.kV), lt = Math.log(to.timeS / from.timeS), lh = Math.log(to.thicknessNm / from.thicknessNm);
  const dInvT = 1 / K(Tt) - 1 / K(Tf);
  const terms = [
    { key: 'kV', law: 'D₁₀₀ ∝ E^nE', param: 'nE', value: val(L.nE, 0.85), sd: sd(L.nE), from: from.kV, to: to.kV, unit: 'kV', ln: val(L.nE, 0.85) * lE, v: (lE * sd(L.nE)) ** 2 },
    { key: 'time', law: 'D₁₀₀ ∝ t^(−p)', param: 'p', value: val(L.p, 0.15), sd: sd(L.p), from: from.timeS, to: to.timeS, unit: 's', ln: -val(L.p, 0.15) * lt, v: (lt * sd(L.p)) ** 2 },
    { key: 'thickness', law: 'D₁₀₀ ∝ h^q', param: 'q', value: val(L.q, 0.25), sd: sd(L.q), from: from.thicknessNm, to: to.thicknessNm, unit: 'nm', ln: val(L.q, 0.25) * lh, v: (lh * sd(L.q)) ** 2 },
    { key: 'temperature', law: 'D₁₀₀ ∝ exp[(E_D/k)(1/T* − 1/T_ref)], T* = max(T, T_sat)', param: 'E_D (eV)', value: val(L.ED, 0), sd: sd(L.ED), from: from.tempC, to: to.tempC, unit: '°C', ln: (val(L.ED, 0) / K_EV) * dInvT, v: ((dInvT / K_EV) * sd(L.ED)) ** 2, clamped: Tf !== from.tempC || Tt !== to.tempC },
  ];
  // a resist's own extra conditions (Medusa: the PEB), each with its exponential law
  for (const x of model.extra || []) {
    const f = from[x.key] ?? model.ref[x.key], t = to[x.key] ?? model.ref[x.key];
    if (!Number.isFinite(f) || !Number.isFinite(t)) continue;
    terms.push({ key: x.key, law: x.law, param: x.param, value: x.value, sd: x.sd, from: f, to: t, unit: x.unit, ln: x.value * (t - f), v: ((t - f) * x.sd) ** 2 });
  }
  const ln = terms.reduce((a, t) => a + t.ln, 0), v = terms.reduce((a, t) => a + t.v, 0);
  return { ln, v, terms };
}
function gammaAt(model, from, to, gamma0) {
  const L = lawsFor(model, to.developer);
  const colder = Math.max(from.tempC, L.Tsat) - Math.max(to.tempC, L.Tsat);
  const f = Math.exp(val(L.cG, 0) * colder);
  return { gamma: gamma0 * f, v: (gamma0 * f * colder * sd(L.cG)) ** 2 };
}
// Everhart–Hoff electron range (µm): the kV law assumes a film thin against it
export const grunRangeUm = (kV, density = 1.2) => 0.0398 * kV ** 1.75 / density;

// ---------------------------------------------------------------- the test structure of a curve
// A clearing dose is the large-area value only when it was read at the centre of a pad much larger than
// the backscatter range β, which then receives its full share of backscatter. On lines, small pads or
// sparse arrays the centre misses part of it, so the dose that clears there is higher than a large
// area's — by up to (1 + η) ≈ 1.5 at 100 kV on Si. The Workbench adds the backscatter itself through the
// PSF, so it wants the large-area curve. Most sources do not say how large their test areas were: the
// library records what the source states, and says so when it does not — it does not guess.
// structure: { kind: 'pads' | 'lines' | 'unknown', sizeUm?, text }
export const betaUm = (kV) => 31.2 * (kV / 100) ** 1.7;     // Owen's Si data (β ∝ E^1.7), ≈; the PSF tab has the real one
export const STRUCTURE_SIGMA = 0.2;                           // ≈ ln(1.5)/2: up to ×1.5 too high, unknown how much
export function structureVerdict(st, kV) {
  const b3 = Math.round(3 * betaUm(kV));
  if (st?.kind === 'pads' && st.sizeUm >= 3 * betaUm(kV)) return { ok: true, sigma: 0, text: `measured on ${st.sizeUm} µm pads, ≥ 3β (≈ ${b3} µm at ${kV} kV): the large-area clearing dose` };
  if (st?.kind === 'pads' || st?.kind === 'lines') return { ok: false, sigma: STRUCTURE_SIGMA, text: `measured on ${st.kind === 'pads' ? `${st.sizeUm} µm pads, smaller than 3β ≈ ${b3} µm at ${kV} kV` : st.text || 'lines'} — not on pads ≫ β: the centre missed part of the backscatter, so this D₁₀₀ is higher than a large area's, by up to ×1.5 (how much depends on the pattern); the Workbench adds the backscatter itself through the PSF` };
  return { ok: null, sigma: 0, text: `test structure not stated${st?.text ? ` (${st.text})` : ''}: if the areas were smaller than about 3β (≈ ${b3} µm at ${kV} kV), this D₁₀₀ is too high, by up to ×1.5` };
}

// does a dataset match these conditions (calibrated)?
export function matches(ds, c, model = null) {
  const d = ds.conditions;
  return d.developer === c.developer && Math.abs(d.kV / c.kV - 1) <= TOL.kVRel && Math.abs(d.timeS / c.timeS - 1) <= TOL.timeRel
    && Math.abs(d.tempC - c.tempC) <= TOL.tempC && Math.abs(d.thicknessNm / c.thicknessNm - 1) <= TOL.thicknessRel
    && (model?.extra || []).every((x) => Math.abs((d[x.key] ?? model.ref[x.key]) - (c[x.key] ?? model.ref[x.key])) <= (x.tol ?? 0));
}

// distance between conditions in "decades of extrapolation" (for picking the nearest anchor)
function distance(a, b, model = null) {
  if (a.developer !== b.developer) return Infinity;
  return Math.abs(Math.log10(a.kV / b.kV)) + Math.abs(Math.log10(a.timeS / b.timeS)) + Math.abs(Math.log10(a.thicknessNm / b.thicknessNm)) + Math.abs(a.tempC - b.tempC) / 20
    + (model?.extra || []).reduce((s, x) => s + Math.abs((a[x.key] ?? model.ref[x.key]) - (b[x.key] ?? model.ref[x.key])) / 20, 0);
}
// Labs differ by up to 2× for the "same" process (tool calibration, developer handling, substrate), so a
// curve measured here outranks a nearby one from elsewhere: quality counts as extra distance (decades).
const QUALITY_PENALTY = { measured: 0, datasheet: 0.3, literature: 0.3, estimate: 0.5 };
const rank = (d, c, model) => distance(d.conditions, c, model) + (QUALITY_PENALTY[d.quality] ?? 0.5);

// The curve for conditions c. → { D100, D0, gamma, round, tone, regime, basis, sigmaLn, range: [lo, hi] (≈1σ on D100),
//                                 excursions: [text], notes: [text], anchor }
export function predict(entry, c) {
  const M = entry.model, W = entry.window || {};
  const notes = [], excursions = [];
  // 1. a dataset at these conditions
  // a best guess is never a calibration: only measured, datasheet or literature curves calibrate their conditions
  const hits = (entry.datasets || []).filter((d) => d.fit && !d.superseded && d.quality !== 'estimate' && matches(d, c, M)).sort((x, y) => rank(x, c, M) - rank(y, c, M));
  const hit = hits[0];
  // 2. the anchor to move from: the nearest dataset with the same developer, else the model's reference
  const same = (entry.datasets || []).filter((d) => d.fit && !d.superseded && d.conditions.developer === c.developer).sort((x, y) => rank(x, c, M) - rank(y, c, M));
  let anchor, a0, s0;
  if (hit) { anchor = { kind: 'dataset', ds: hit, cond: hit.conditions, fit: hit.fit }; }
  else if (same.length) { anchor = { kind: 'dataset', ds: same[0], cond: same[0].conditions, fit: same[0].fit }; }
  else { anchor = { kind: 'model', cond: M.ref, fit: { D100: M.ref.D100, gamma: M.ref.gamma, round: M.ref.round ?? 0.5 } }; }
  const baseSigma = anchor.kind === 'dataset' ? (anchor.ds.quality === 'measured' ? 0.05 : anchor.ds.quality === 'datasheet' ? 0.15 : anchor.ds.quality === 'literature' ? 0.2 : 0.35) : (M.refUncertainty ?? 0.35);
  // 3. the developer: the anchor's own, or the reference's with a developer factor
  let devLn = 0, devV = 0, gFactor = 1;
  let from = anchor.cond;
  if (from.developer !== c.developer) {
    const df = M.developers?.[c.developer];
    if (df) { devLn = Math.log(df.factor); devV = (df.sd ?? 0.3) ** 2; gFactor = df.gammaFactor ?? 1; notes.push(`developer ${c.developer}: ${df.note || 'relative to the reference developer'}`); }
    else { notes.push(`no data or model for developer ${c.developer} with this resist: the curve is the reference developer's`); }
  }
  const sh = shift(M, from, c);
  const g = gammaAt(M, from, c, anchor.fit.gamma * gFactor);
  const D100 = anchor.fit.D100 * Math.exp(sh.ln + devLn);
  // the anchor's test structure: small structures make D₁₀₀ too high (unknown by how much) — said, and in σ
  const sv = structureVerdict(anchor.kind === 'dataset' ? anchor.ds.structure : M.refStructure, anchor.cond.kV);
  if (sv.ok !== true) notes.push(`the anchor curve: ${sv.text}`);
  const sigmaLn = Math.sqrt(baseSigma ** 2 + sh.v + devV + sv.sigma ** 2);
  // 4. the regime
  if (W.kV && !inRange(c.kV, W.kV)) excursions.push(`${c.kV} kV is outside ${W.kV[0]}–${W.kV[1]} kV`);
  if (W.thicknessNm && !inRange(c.thicknessNm, W.thicknessNm)) excursions.push(`${c.thicknessNm} nm is outside ${W.thicknessNm[0]}–${W.thicknessNm[1]} nm`);
  if (W.timeS && !inRange(c.timeS, W.timeS)) excursions.push(`${c.timeS} s development is outside ${W.timeS[0]}–${W.timeS[1]} s`);
  if (W.tempC && !inRange(c.tempC, W.tempC)) excursions.push(`${c.tempC} °C is outside ${W.tempC[0]}–${W.tempC[1]} °C`);
  for (const x of M.extra || []) {
    const v = c[x.key];
    if (v == null) notes.push(`${x.name} not given: taken as the reference's ${M.ref[x.key]} ${x.unit}`);
    else if (W[x.key] && !inRange(v, W[x.key])) excursions.push(`${x.short || x.name} ${v} ${x.unit} is outside ${W[x.key][0]}–${W[x.key][1]} ${x.unit}`);
  }
  if (M.TsatC != null && c.tempC < M.TsatC) notes.push(`below ${M.TsatC} °C development no longer slows (saturation): the curve is taken at ${M.TsatC} °C`);
  const RG = grunRangeUm(c.kV, M.density ?? 1.2) * 1000;
  if (c.thicknessNm > 0.1 * RG) excursions.push(`the film (${c.thicknessNm} nm) is more than a tenth of the electron range at ${c.kV} kV (${RG.toFixed(0)} nm): the dose is not uniform through it and the voltage law does not hold`);
  if (hits.length > 1) {
    const D = hits.map((d) => d.fit.D100), lo = Math.min(...D), hi = Math.max(...D);
    notes.push(`${hits.length} curves match these conditions (D100 ${lo.toFixed(0)}–${hi.toFixed(0)} µC/cm²${hi / lo > 1.3 ? ' — they disagree: lab-to-lab differences are real, trust your own dose test' : ''}); using ${hit.id} (${hit.quality})`);
  }
  const knownDev = (W.developers || []).includes(c.developer) || anchor.cond.developer === c.developer || !!M.developers?.[c.developer];
  let regime;
  if (hit) regime = 'measured';
  else if (!knownDev) regime = 'unsupported';
  else if (excursions.length) regime = 'extrapolated';
  else regime = 'window';
  const round = anchor.fit.round ?? M.ref.round ?? 0.5;
  const gamma = Math.max(0.5, g.gamma);
  // how this number was made: the anchor, then every factor with the uncertainty it adds
  const steps = [{ what: 'anchor', text: anchor.kind === 'dataset' ? `${anchor.ds.quality} curve ${anchor.ds.id}` : 'the model\'s reference curve (analytical best guess)', cond: anchor.cond, D100: anchor.fit.D100, gamma: anchor.fit.gamma, sigma: baseSigma }];
  if (sv.sigma) steps.push({ what: 'test structure', text: sv.text, factor: 1, sigma: sv.sigma });
  if (from.developer !== c.developer) { const df = M.developers?.[c.developer]; steps.push({ what: 'developer', text: df ? `${from.developer} → ${c.developer}: × ${df.factor}${df.gammaFactor && df.gammaFactor !== 1 ? `, γ × ${df.gammaFactor}` : ''}` : `${from.developer} → ${c.developer}: no factor known — unchanged`, factor: df ? df.factor : 1, sigma: Math.sqrt(devV) }); }
  for (const t of sh.terms) if (Math.abs(t.to - t.from) > 1e-9 || t.ln !== 0) steps.push({ what: t.key, text: `${t.from} → ${t.to} ${t.unit}: ${t.law}, ${t.param} = ${t.value}${t.sd ? ` ± ${t.sd}` : ''}${t.clamped ? ' (below T_sat: taken at T_sat)' : ''}`, factor: Math.exp(t.ln), sigma: Math.sqrt(t.v) });
  if (Math.abs(g.gamma - anchor.fit.gamma * gFactor) > 1e-9) steps.push({ what: 'contrast', text: `γ × exp[cγ·(T_ref − T*)], cγ = ${val(lawsFor(M, c.developer).cG, 0)}: γ ${(anchor.fit.gamma * gFactor).toFixed(2)} → ${g.gamma.toFixed(2)}`, factor: null, sigma: null });
  const out = {
    D100, gamma, round, D0: D100 * Math.pow(10, -1 / gamma), tone: entry.tone, regime, sigmaLn: regime === 'unsupported' ? Math.max(sigmaLn, 0.7) : sigmaLn, steps,
    basis: anchor.kind === 'dataset' ? `${anchor.ds.quality === 'estimate' ? 'analytical best guess' : `${anchor.ds.quality} curve`} ${anchor.ds.id} (${describeConditions(anchor.cond)})` : `analytical best guess (${describeConditions(M.ref)})`,
    anchor, excursions, notes,
  };
  out.range = [out.D100 * Math.exp(-out.sigmaLn), out.D100 * Math.exp(out.sigmaLn)];
  return out;
}

export const REGIME_TEXT = {
  measured: 'calibrated — a curve exists for these conditions',
  window: 'inside the process window — from the model',
  extrapolated: 'EXTRAPOLATED — outside the process window',
  unsupported: 'UNSUPPORTED — no data or model for this developer',
};

export function describeConditions(c) {
  return `${c.kV} kV, ${c.thicknessNm} nm, ${c.developer}, ${c.timeS} s, ${c.tempC} °C${c.pebC != null ? `, PEB ${c.pebC} °C` : ''}${c.bakeC != null ? `, bake ${c.bakeC} °C` : ''}`;
}

// ---------------------------------------------------------------- fitting a measured curve
// points: [[dose, remaining fraction 0..1]] (thickness ÷ initial). Least squares on the fraction,
// Nelder–Mead in (ln D100, ln γ, round). Positive or negative tone.
export function fitCurve(points, tone = 'positive') {
  const P = points.filter(([d, f]) => d > 0 && Number.isFinite(f));
  if (P.length < 3) throw new Error('a contrast curve needs at least three (dose, thickness) points');
  const cost = ([lD, lG, r]) => {
    const R = makeResist({ D100: Math.exp(lD), gamma: Math.exp(lG), round: Math.min(1, Math.max(0, r)), tone, thicknessNm: 100 });
    let c = 0; for (const [d, f] of P) { const e = remainingFraction(R, d) - f; c += e * e; }
    return c / P.length + (r < 0 ? r * r : r > 1 ? (r - 1) ** 2 : 0);
  };
  // start: D100 at the first dose that clears (positive) / saturates (negative)
  const sorted = [...P].sort((a, b) => a[0] - b[0]);
  const done = sorted.find(([, f]) => (tone === 'negative' ? f > 0.9 : f < 0.1)) || sorted[sorted.length - 1];
  let simplex = [[Math.log(done[0]), Math.log(4), 0.3]];
  simplex.push([simplex[0][0] + 0.3, simplex[0][1], 0.3], [simplex[0][0], simplex[0][1] + 0.5, 0.3], [simplex[0][0], simplex[0][1], 0.7]);
  let vals = simplex.map(cost);
  for (let it = 0; it < 600; it++) {
    const o = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]); simplex = o.map((i) => simplex[i]); vals = o.map((i) => vals[i]);
    if (vals[3] - vals[0] < 1e-12 && it > 40) break;
    const c = [0, 1, 2].map((j) => (simplex[0][j] + simplex[1][j] + simplex[2][j]) / 3);
    const w = simplex[3], rf = c.map((x, j) => 2 * x - w[j]), fr = cost(rf);
    if (fr < vals[0]) { const ex = c.map((x, j) => 3 * x - 2 * w[j]), fe = cost(ex); [simplex[3], vals[3]] = fe < fr ? [ex, fe] : [rf, fr]; }
    else if (fr < vals[2]) { simplex[3] = rf; vals[3] = fr; }
    else { const cn = c.map((x, j) => (x + w[j]) / 2), fc = cost(cn); if (fc < vals[3]) { simplex[3] = cn; vals[3] = fc; } else for (let i = 1; i < 4; i++) { simplex[i] = simplex[i].map((x, j) => (x + simplex[0][j]) / 2); vals[i] = cost(simplex[i]); } }
  }
  const [lD, lG, r] = simplex[0];
  const D100 = Math.exp(lD), gamma = Math.exp(lG);
  return { D100, gamma, round: Math.min(1, Math.max(0, r)), D0: D100 * Math.pow(10, -1 / gamma), rms: Math.sqrt(vals[0]), n: P.length };
}

// ---------------------------------------------------------------- packs (sharing)
export const PACK_FORMAT = 'ebw-resist-pack';
const REQUIRED_COND = ['kV', 'thicknessNm', 'developer', 'timeS', 'tempC'];

// Problems that keep a dataset out of a library: [text]
export function validateDataset(ds) {
  const out = [], c = ds.conditions || {};
  for (const k of REQUIRED_COND) if (c[k] == null || c[k] === '' || (k !== 'developer' && !Number.isFinite(+c[k]))) out.push(`missing condition: ${k}`);
  if (!ds.points?.length && !ds.fit) out.push('neither measured points nor a fit');
  if (ds.points?.length && ds.points.length < 3) out.push('fewer than three points');
  if (ds.fit && !(ds.fit.D100 > 0 && ds.fit.gamma > 0)) out.push('fit without D100 > 0 and γ > 0');
  if (!['measured', 'datasheet', 'literature', 'estimate'].includes(ds.quality)) out.push('quality must be measured, datasheet, literature or estimate');
  if (!ds.provenance || !(ds.provenance.source || ds.provenance.who || ds.provenance.sources?.length)) out.push('provenance: who measured it, or the source');
  return out;
}
export function validatePack(pack) {
  const out = [];
  if (!pack || pack.format !== PACK_FORMAT) return ['not a resist pack (format "ebw-resist-pack")'];
  if (!Array.isArray(pack.resists)) return ['no resists'];
  for (const r of pack.resists) {
    if (!r.id) out.push('a resist without an id');
    for (const ds of r.datasets || []) for (const e of validateDataset(ds)) out.push(`${r.id} / ${ds.id || 'dataset'}: ${e}`);
  }
  return out;
}

// Merge packs onto a library: datasets, advice and sources are added (never replaced); a dataset id
// seen before is kept once (a correction carries a new id and `supersedes`).
export function mergeLibrary(base, packs) {
  const lib = new Map(base.map((r) => [r.id, structuredClone(r)]));
  for (const pack of packs) for (const r of pack.resists || []) {
    const cur = lib.get(r.id);
    if (!cur) { if (r.name && r.model) lib.set(r.id, structuredClone(r)); continue; }
    const seen = new Set((cur.datasets || []).map((d) => d.id));
    for (const d of r.datasets || []) if (!seen.has(d.id)) { (cur.datasets ??= []).push({ ...structuredClone(d), from: pack.author || pack.lab || 'pack' }); }
    for (const a of r.advice || []) (cur.advice ??= []).push({ ...a, from: pack.author || 'pack' });
    Object.assign(cur.sources ??= {}, r.sources || {});
  }
  // a superseded dataset steps back
  for (const r of lib.values()) { const sup = new Set((r.datasets || []).map((d) => d.supersedes).filter(Boolean)); for (const d of r.datasets || []) if (sup.has(d.id)) d.superseded = true; }
  return [...lib.values()];
}

export function makePack({ author, lab = 'DTU', resists, note = '' }) {
  return { format: PACK_FORMAT, version: 1, created: new Date().toISOString(), author, lab, licence: 'CC-BY-4.0', note, resists };
}

// ---------------------------------------------------------------- the model, documented
// Shown in the Resists tab ("The model, explained"); keep it in step with the code above.
export const MODEL_DOC = {
  title: 'How the resist library moves a contrast curve',
  sections: [
    { h: 'What is predicted', p: [
      'A contrast curve: the film left after development against the dose. It is described by D₁₀₀ (cleared, positive resist; full height, negative resist), the contrast γ (the slope on a log-dose axis, D₀ = D₁₀₀·10^(−1/γ)) and a rounding of the two kinks. A curve only holds for the conditions it was measured at: acceleration voltage, film thickness, developer, development time and temperature (and prebake, substrate — recorded, not modelled).'] },
    { h: '1. Start from the nearest curve (the anchor)', p: [
      'If a curve in the library matches your conditions — same developer, kV within ±2 %, time within ±5 %, temperature within ±1 °C, thickness within ±15 % — it is used as it is: the result is CALIBRATED.',
      'Otherwise the nearest curve with the same developer is moved, or, if there is none, the resist\'s reference curve. "Nearest" counts decades of voltage, time and thickness plus 1/20 of the temperature difference; curves from elsewhere count 0.3 decade further than curves measured here (labs differ by up to 2× for the "same" process), estimates 0.5.'] },
    { h: '2. Move it, one variable at a time', p: [
      'Each variable acts as a power law (or, for temperature, an activation law) on D₁₀₀. In log dose they add:',
      'ln D₁₀₀ = ln D₁₀₀(anchor) + nE·ln(E/E₀) − p·ln(t/t₀) + q·ln(h/h₀) + (E_D/k)·(1/T* − 1/T₀) + ln(developer factor)',
      'Voltage, nE: the energy a fast electron leaves in a thin film falls as it gets faster (Bethe: about E^−0.75; measured clearing doses scale as E^0.9–1.0 between 10 and 100 kV). Time, p: a longer development needs less dose (p > 0); in negative resists p ≤ 0, and HSQ in plain hydroxide self-limits (p ≈ 0). Thickness, q: a thicker film needs more dose to clear. Temperature, E_D: dissolution is thermally activated; colder development needs more dose (E_D > 0) — except negative HSQ, where hot development needs more (E_D < 0). Below T_sat development stops slowing: T* = max(T, T_sat). The developer is a factor from the data, never interpolated between developers.',
      'Contrast: γ = γ(anchor) · (developer γ factor) · exp[cγ·(T₀ − T*)] — cold development sharpens organic positive resists (cγ > 0), hot development sharpens HSQ (cγ < 0). γ has no reliable law for time or voltage and is kept.'] },
    { h: 'Extra conditions of a resist', p: [
      'Some resists depend strongly on a condition the five above do not cover. Medusa 82 (AR-N 8200) is set above all by its post-exposure bake: DTU measured the dose to fall about 4.5× from 130 to 170 °C. Such a resist declares the extra condition with its own law (Medusa: ln D₁₀₀ falls by 0.037 ± 0.008 per °C of PEB), its window and its matching tolerance (±2 °C); the Resists tab, Analysis and Fab Studio then ask for it, and a curve only matches at its own value.'] },
    { h: '3. The uncertainty', p: [
      'σ(ln D₁₀₀) = √( σ_anchor² + Σ (Δln x · σ_param)² + σ_developer² ). σ_anchor: 0.05 for a curve measured here, 0.15 datasheet, 0.2 literature, 0.35 estimate (or the reference curve\'s own). Each parameter carries its literature spread, so the error grows with the distance travelled. The range shown is D₁₀₀·e^(±σ) (about ±1σ).'] },
    { h: '4. The regime — always shown', p: [
      'CALIBRATED: a curve exists for these conditions. INSIDE THE PROCESS WINDOW: moved by the model, every condition inside the window where the resist is normally used (manufacturer, DTU). EXTRAPOLATED: some condition outside the window — each excursion is named; also when the film is thicker than a tenth of the electron range at that voltage (Everhart–Hoff: R = 0.0398·E^1.75/ρ µm), where the dose is not uniform through the film. UNSUPPORTED: a developer the model knows nothing about; the curve is the reference developer\'s, σ at least 0.7.'] },
    { h: 'How a contrast curve should be measured — and the test structure of each curve', p: [
      'A proper contrast curve is measured on pads much larger than the backscatter range β — at least about 3β: ≈ 100 µm at 100 kV, ≈ 12 µm at 30 kV on Si — and the remaining thickness is read at their centre, which then receives its full share of backscatter from all around. On lines, small pads or sparse arrays the centre misses part of it, so the dose that clears there is higher than a large area\'s, by up to (1 + η), about 1.5× at 100 kV on Si. The Workbench applies the PSF itself, so it needs the large-area curve; a curve from lines counts the proximity effect twice.',
      'Each curve in the library records its test structure as the source states it: pads ≫ β (✓), lines or small pads (⚠ — a note, and an extra σ of 0.2 in ln D₁₀₀), or not stated (?, a note only). Most sources do not state it; the library says so rather than guess. DTU\'s own CSAR curves (2016) were measured on 100 nm lines with 300 nm spaces.'] },
    { h: '5. Where the other tabs use it', p: [
      'Analysis: a library resist\'s curve is the prediction for the PSF\'s voltage, your film thickness and your planned development; the regime and σ are shown in the banner and under "This development". Typed-in values (D₁₀₀, γ) override the prediction and are marked as yours.',
      'Fab Studio: the spin step holds a curve (the library\'s reference, or your own) and the development it belongs to. When the develop step differs from it, the curve is multiplied by the model\'s ratio between the two developments — D₁₀₀ × m(develop)/m(calibration), γ likewise — so your own curve is kept and only the change is modelled. The step says so: ℹ inside the process window, ⚠ EXTRAPOLATED or UNSUPPORTED otherwise.'] },
    { h: 'Where the numbers come from, and the limits', p: [
      'The parameters were taken from the literature and DTU data (each with its sources in the table). The laws are separable approximations: cross-effects (time × temperature, thickness × voltage) are ignored; prebake, substrate, developer age and agitation are not modelled; γ definitions in the sources differ (tangent, 10–90 %, 1/log(D₁₀₀/D₀)) — the library refits every curve to the Workbench\'s own. Use the model to plan; a dose test calibrates.'] },
  ],
};
