// The project's PSF settings → a PSF object.
//
// settings = { mode: 'scaling' | 'manual' | 'table' | 'mc',
//   (manual also: model 'plg' with alpha, p, beta, eta; model 'spline' with knots [[r nm, f]])
//              energyKeV, substrate, resistNm, alphaMinNm, eta (null = substrate default),   // scaling
//              model ('double' | 'triple' | 'gauss-exp'), alpha, beta, eta, gamma, nu,        // manual
//              table: { r, f, meta, fit, model, useFit },                                     // table
//              mcSettings: {...}, mc: { r, f, relErr, meta, fit, model, useFit, objective } } // mc
//
// With table.useFit the fitted model is used instead of the table: every term is then in
// closed form, which makes the exposure engine faster and exact (no table interpolation).

import { makeAnalyticFor, makeAnalyticPSF, MODELS, modelOf } from './analytic.js';
import { makePSF } from './psf.js';
import { fitGaussians } from './fit.js';
import { plgTable, splineTable } from './models2.js';

// A power-Gaussian or spline PSF as a table, with a double-Gaussian fit for the grid scale.
export function tableModelPSF(params, meta = {}) {
  const model = params.model;
  const T = model === 'plg' ? plgTable(params) : splineTable(params.knots);
  const psf = makePSF({ r: T.r, f: T.f, meta: { ...meta, model } });
  const g = fitGaussians(psf, { model: 'double', objective: 'energy' });
  psf.fit = { ...(model === 'plg' ? { alpha: params.alpha, p: params.p, beta: params.beta, eta: params.eta } : { alpha: g.alpha, beta: g.beta, eta: g.eta, knots: params.knots }),
    gamma: null, nu: 0, model, terms: g.terms, amplitude: null, rms: params.rms ?? 0, objective: 'energy' };
  return psf;
}

// A tabulated PSF (imported, or a Monte Carlo result) with its fit; t.fit is reused when it was
// made with the same model and objective, otherwise the table is refitted.
export function tablePSF(t) {
  const model = MODELS[t.model] ? t.model : t.triple ? 'triple' : 'double';
  const psf = makePSF({ r: t.r, f: t.f, meta: { ...(t.meta || {}), source: t.meta?.source || 'table' } });
  const objective = t.objective || (t.meta?.source === 'mc' ? 'energy' : 'logf');
  psf.fit = t.fit && t.fit.model === model && (t.fit.objective || 'logf') === objective ? t.fit : fitGaussians(psf, { model, objective });
  if (t.useFit && MODELS[model].table) return tableModelPSF(psf.fit, { source: 'fit', file: t.meta?.file || (t.meta?.source === 'mc' ? 'Monte Carlo' : undefined), rms: psf.fit.rms });
  if (t.useFit) {
    return makeAnalyticPSF(psf.fit, { meta: { source: 'fit', model, file: t.meta?.file || (t.meta?.source === 'mc' ? 'Monte Carlo' : undefined), rms: psf.fit.rms } });
  }
  return psf;
}

export function psfFromSettings(st) {
  if (st.mode === 'table' && st.table && st.table.r?.length) return tablePSF(st.table);
  if (st.mode === 'mc' && st.mc && st.mc.r?.length) return tablePSF(st.mc);
  if (st.mode === 'manual' && st.model === 'plg' && st.alpha > 0 && st.beta > 0 && st.p > 1) return tableModelPSF({ model: 'plg', alpha: st.alpha, p: st.p, beta: st.beta, eta: st.eta ?? 0.7 }, { source: 'manual' });
  if (st.mode === 'manual' && st.model === 'spline' && st.knots?.length >= 4) return tableModelPSF({ model: 'spline', knots: st.knots }, { source: 'manual', knotsFrom: st.knotsFrom });
  if (st.mode === 'manual' && st.alpha > 0 && st.beta > 0 && !MODELS[st.model]?.table) {
    const model = modelOf(st);
    const mid = !!MODELS[model].mid;
    return makeAnalyticPSF({ alpha: st.alpha, beta: st.beta, eta: st.eta ?? 0.7, gamma: mid ? st.gamma || null : null, nu: mid ? st.nu || 0 : 0, model }, { meta: { source: 'manual', model } });
  }
  return makeAnalyticFor({ energyKeV: st.energyKeV ?? 100, substrate: st.substrate ?? 'Si', resistNm: st.resistNm ?? 100, alphaMinNm: st.alphaMinNm ?? 8, eta: st.eta ?? undefined });
}

// A short label for the PSF in use (status lines, chart legends).
export function psfLabel(psf) {
  const f = psf.fit;
  const model = MODELS[f.model]?.short || (f.gamma ? 'TG' : 'DG');
  const base = f.model === 'spline' ? `Spline (${f.knots?.length ?? '?'} knots; ≈ β ${(f.beta / 1000).toFixed(2)} µm, η ${f.eta.toFixed(2)})`
    : `${model}: α ${f.alpha.toFixed(1)} nm${f.model === 'plg' ? `, p ${f.p.toFixed(2)}` : ''}, β ${(f.beta / 1000).toFixed(2)} µm, η ${f.eta.toFixed(2)}${f.gamma ? `, γ ${f.gamma < 1000 ? f.gamma.toFixed(0) + ' nm' : (f.gamma / 1000).toFixed(2) + ' µm'}, ν ${f.nu.toFixed(2)}` : ''}`;
  const m = psf.meta;
  const src = m.source === 'analytic' ? (m.energyKeV ? `${m.energyKeV} keV ${m.substrate}` : 'analytic')
    : m.source === 'fit' ? `fit of ${m.file || 'table'}`
    : m.source === 'mc' ? `Monte Carlo ${m.energyKeV} keV ${(m.stack || []).map((l) => l.material).join('/')}` : m.source;
  return `${base} (${src}${psf.gauss ? '' : ', table'})`;
}
