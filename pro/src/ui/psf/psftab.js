// PSF tab: choose the point spread function — from beam energy and substrate
// (published Si data and an empirical forward broadening), manual α β η (γ ν), or an imported two-column table — and compare
// PSFs on log–log axes.

import { $, esc, toast, pickFile } from '../dom.js';
import { psfFromSettings, psfLabel } from '../../core/psf/settings.js';
import { makeAnalyticFor, MODELS, modelOf } from '../../core/psf/analytic.js';
import { SUGGESTED, SUGGESTED_ENERGIES, suggestionFor } from '../../core/psf/suggested.js';
import { psfAt, cumulative, gaussAt, makePSF } from '../../core/psf/psf.js';
import { importTableText } from '../../core/psf/table.js';
import { importBeamerPsf, looksLikeBeamerPsf, beamerPsfLabel } from '../../core/psf/beamer.js';
import { fitGaussians, fitAllModels } from '../../core/psf/fit.js';
import { splitPSF } from '../../core/psf/split.js';
import { SUBSTRATES, psfParamsFor } from '../../core/physics/scaling.js';
import { MATERIALS } from '../../core/mc/materials.js';
import { PHYSICS_LEGACY, PHYSICS_CSDA } from '../../core/mc/physics.js';
import { toPSF, summary, tailError } from '../../core/mc/result.js';
import { runMonteCarlo, defaultThreads, traceMonteCarlo } from './mcrun.js';
import { createTrajView } from './trajview.js';
import { setupCanvas, onResize, drawPow10, FONT, FONT_SMALL } from '../plotkit.js';

const COMPARE_COLORS = ['#2f6fd6', '#e08a00', '#9b4fd6'];
const RESISTS = Object.keys(MATERIALS).filter((k) => MATERIALS[k].resist && !MATERIALS[k].hidden);
const BULK = Object.keys(MATERIALS).filter((k) => !MATERIALS[k].resist && !MATERIALS[k].hidden);
export const MC_DEFAULTS = { energyKeV: 100, beamA: 8, resist: 'PMMA', resistNm: 100, film: '', filmNm: 20, substrate: 'Si', model: 'gauss-exp',
  maxElectrons: 200000, targetErrPct: 1, Ecut: 0.5, physics: 'default', threads: null, seed: 1,
  trajOn: true, trajN: 100, trajDep: false, trajDepN: 2000 };

// The MC configuration for a settings object (the tally layer is the resist, layer 0).
export function mcConfig(m) {
  const layers = [{ mat: m.resist, thickness: m.resistNm }];
  if (m.film) layers.push({ mat: m.film, thickness: m.filmNm });
  layers.push({ mat: m.substrate, thickness: Infinity });
  return { E0: m.energyKeV, layers, tallyLayer: 0, beamA: m.beamA, Ecut: m.Ecut, mott: true,
    rMax: 2e5 * Math.max(1, (m.energyKeV / 100) ** 1.7), physics: m.physics === 'legacy' ? PHYSICS_LEGACY : m.physics === 'csda' ? PHYSICS_CSDA : undefined };
}

export function createPsfTab(app) {
  const root = $('tab-psf');
  root.innerHTML = `
  <div class="grid">
    <div class="col">
      <div class="panel">
        <div class="section-title">Point spread function <span class="q" data-tip="<b>PSF</b> — the energy one electron deposits in the resist as a function of the distance r from where it landed. The simplest model is a double Gaussian:<br><br>f(r) = 1/(π(1+η)) [ e<sup>−r²/α²</sup>/α² + η e<sup>−r²/β²</sup>/β² ]<br><br>α = forward scattering (nm), β = backscattering (µm), η = backscattered / forward energy. Everything in the Exposure tab is the layout convolved with this.">?</span></div>
        <div class="label">Source</div>
        <select class="field" id="psfMode">
          <option value="scaling">From beam energy &amp; substrate (analytic)</option>
          <option value="manual">Manual α, β, η</option>
          <option value="table">Imported table</option>
          <option value="mc">Monte Carlo (built in)</option>
        </select>
        <div id="psfScaling" style="margin-top:8px;">
          <div class="two">
            <div><div class="label">Energy (keV)</div><input class="field" id="psfKeV" type="number" min="1" max="300" step="1"></div>
            <div><div class="label">Substrate</div><select class="field" id="psfSub">${Object.keys(SUBSTRATES).map((k) => `<option>${k}</option>`).join('')}</select></div>
            <div><div class="label">Resist thickness (nm) <span class="q" data-tip="Sets the forward broadening d = 0.9 (h/E)<sup>1.5</sup> (an empirical fit), added in quadrature to the α floor.">?</span></div><input class="field" id="psfResist" type="number" min="1" step="10"></div>
            <div><div class="label">α floor (nm) <span class="q" data-tip="Beam size and secondary-electron range, typically 5–10 nm. α = √(floor² + d²).">?</span></div><input class="field" id="psfAlphaMin" type="number" min="0.5" step="0.5"></div>
            <div><div class="label">η (blank = table) <span class="q" data-tip="Leave blank to use the substrate's value (Si: 0.7, a common textbook value). Published measurements give 0.51–0.75 for Si (Owen 1990; Boere et al. 1990; Rishton and Kern 1987); the built-in Monte Carlo gives ≈ 0.53–0.64 (thin PMMA, 30–120 keV).">?</span></div><input class="field" id="psfEtaOv" type="number" min="0" step="0.01" placeholder="default"></div>
          </div>
          <div class="hint" id="psfScalingNote" style="margin-top:6px;"></div>
        </div>
        <div id="psfManual" style="margin-top:8px; display:none;">
          <div class="label">Model <span class="q" data-tip="<b>Double Gaussian</b> — forward term α, backscatter term β with weight η. The workhorse: fast, supported everywhere; good for features ≳ 100 nm on plain substrates.<br><b>Triple Gaussian</b> — adds a mid-range Gaussian (γ, ν) between forward and backscatter: multilayer or heavy substrates (GaAs, Au, Pt), dense patterns.<br><b>Double Gaussian + exponential</b> — the mid-range term is ν e<sup>−r/γ</sup>/(2πγ²): a heavier tail, the fast secondaries in Monte Carlo fits.<br><b>Power-Gaussian</b> — a power-law core (p−1)/(πα²)·(1+r²/α²)<sup>−p</sup> with a Gaussian backscatter term: a sharp core with the long tail Gaussians miss — sub-20 nm work at high voltage.<br><b>Spline-based</b> — no formula: log f(r) through knots taken from a Monte Carlo (or a table), joined by a smooth monotone curve; for cases the formulas fit poorly.<br><br><b>Suggested values</b> come from the Workbench's own Monte Carlo (100 nm PMMA on Si) at 30, 50, 100 and 120 keV, fitted with each model: physics only. All models integrate to 1.">?</span></div>
          <select class="field" id="psfModel">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select>
          <div class="two" style="margin-top:6px;">
            <div><div class="label">α (nm)</div><input class="field" id="psfA" type="number" min="0.1" step="0.5"></div>
            <div><div class="label">β (µm)</div><input class="field" id="psfB" type="number" min="0.01" step="0.5"></div>
            <div><div class="label">η</div><input class="field" id="psfE" type="number" min="0" step="0.01"></div>
            <div id="psfPBox"><div class="label">p (power, &gt; 1)</div><input class="field" id="psfP" type="number" min="1.01" step="0.05"></div>
          </div>
          <div class="hint" id="psfSplineInfo" style="margin-top:6px;display:none;"></div>
          <div class="two" id="psfMidRow" style="margin-top:6px;">
            <div><div class="label" id="psfGLabel">γ (nm)</div><input class="field" id="psfG" type="number" min="1" step="10"></div>
            <div><div class="label">ν (weight) </div><input class="field" id="psfN" type="number" min="0" step="0.01"></div>
          </div>
          <div class="row" style="margin-top:8px;gap:6px;align-items:center;flex-wrap:wrap;"><span class="label" style="margin:0;">Suggested values</span>
            <select class="field" id="psfSugE" style="width:auto;">${SUGGESTED_ENERGIES.map((e) => `<option value="${e}">${e} keV</option>`).join('')}</select>
            <button class="btn small" id="psfSugUse" title="Fill in this model's values from the Workbench's own Monte Carlo (100 nm PMMA on Si) at this energy">Use</button>
            <span class="hint" id="psfSugNote"></span></div>
        </div>
        <div id="psfTable" style="margin-top:8px; display:none;">
          <div class="row"><button class="btn small" id="psfImport" title="A two-column table (radius, value) from any program, or a BEAMER / TRACER PSF file (.lpsf)">Import table / BEAMER PSF…</button><span class="hint" id="psfFile">no file</span></div>
          <div class="three" style="margin-top:6px;">
            <div><div class="label">Radius in</div><select class="field" id="psfRUnit">${['nm', 'um', 'A', 'mm'].map((u) => `<option value="${u}">${u === 'um' ? 'µm' : u === 'A' ? 'Å' : u}</option>`).join('')}</select></div>
            <div><div class="label">Values are <span class="q" data-tip="<b>per area</b>: energy per unit area f(r) — use as is.<br><b>per radius</b>: dE/dr = 2πr f(r).<br><b>per annulus</b>: energy in each radial bin (histogram counts), as most Monte Carlo codes write them.<br><br>Getting this wrong is the commonest PSF import mistake — compare the plot with the analytic curve.">?</span></div><select class="field" id="psfVMode"><option value="per-area">per area</option><option value="per-radius">per radius</option><option value="per-annulus">per annulus</option></select></div>
            <div><div class="label">Bins</div><select class="field" id="psfBins"><option value="geometric">log-spaced</option><option value="arithmetic">linear</option></select></div>
          </div>
          <div class="label" style="margin-top:8px;">Fit model <span class="q" data-tip="The analytic model fitted to the table (least squares on log f, so every decade counts). The table below compares all three; the rms is of ln f, so 0.05 ≈ 5 % typical misfit.<br><br><b>Use the fit instead of the table</b> swaps the table for its fitted model: every term is then in closed form, which makes the exposure engine faster and exact instead of interpolating the table. Keep the table when the fit's rms is poor.">?</span></div>
          <select class="field" id="psfFitModel">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select>
          <label class="row" style="gap:6px; margin-top:6px; font-size:12px;"><input type="checkbox" id="psfUseFit"> Use the fit instead of the table (closed form, fast)</label>
          <div id="psfFitTable" class="hint" style="margin-top:6px;"></div>
        </div>
        <div id="psfMC" style="margin-top:8px; display:none;">
          <div class="two">
            <div><div class="label">Energy (keV)</div><input class="field" id="mcKeV" type="number" min="1" max="200" step="1"></div>
            <div><div class="label">Beam + SE blur a (nm) <span class="q" data-tip="Each electron lands at a random point of a Gaussian spot e<sup>−r²/a²</sup> (the convention used throughout: widths in exp(−r²/α²), not σ). It stands in for the beam size and the secondary electrons the simulation does not follow, so it sets the α floor. 5–10 nm is typical.">?</span></div><input class="field" id="mcBeamA" type="number" min="0" step="1"></div>
            <div><div class="label">Resist</div><select class="field" id="mcResist">${RESISTS.map((k) => `<option value="${k}">${esc(MATERIALS[k].name)}</option>`).join('')}</select></div>
            <div><div class="label">Resist thickness (nm)</div><input class="field" id="mcResistNm" type="number" min="1" step="10"></div>
            <div><div class="label">Film under the resist <span class="q" data-tip="An optional layer between resist and substrate, e.g. a Cr or Au film, or thermal oxide. Heavy films raise the backscatter (η) a lot.">?</span></div><select class="field" id="mcFilm"><option value="">none</option>${BULK.map((k) => `<option value="${k}">${esc(MATERIALS[k].name)}</option>`).join('')}</select></div>
            <div><div class="label">Film thickness (nm)</div><input class="field" id="mcFilmNm" type="number" min="1" step="5"></div>
            <div><div class="label">Substrate</div><select class="field" id="mcSub">${BULK.map((k) => `<option value="${k}">${esc(MATERIALS[k].name)}</option>`).join('')}</select></div>
            <div><div class="label">Fit model</div><select class="field" id="mcFitModel">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}">${m.short}</option>`).join('')}</select></div>
          </div>
          <details style="margin-top:6px;"><summary class="hint" style="cursor:pointer;">Run settings and physics</summary>
            <div class="two" style="margin-top:6px;">
              <div><div class="label">Max electrons</div><input class="field" id="mcMaxN" type="number" min="1000" step="10000"></div>
              <div><div class="label">Stop at tail error (%) <span class="q" data-tip="The run stops when the relative statistical error of the energy deposited beyond 100 nm (what β and η are fitted from) falls below this. 1 % is plenty for proximity correction.">?</span></div><input class="field" id="mcErr" type="number" min="0" step="0.5"></div>
              <div><div class="label">Cut-off energy (keV) <span class="q" data-tip="Electrons below this energy deposit what is left on the spot. 0.5 keV ≈ a 10 nm range in PMMA, well under the α floor.">?</span></div><input class="field" id="mcEcut" type="number" min="0.1" step="0.1"></div>
              <div><div class="label">Physics <span class="q" data-tip="<b>Corrected, fast secondaries</b> (default): relativistic screened Rutherford per element with the McKinley–Feshbach Mott factor, ICRU 37 stopping (Joy–Luo below 10 keV); collisions above 1 keV are Møller events whose knock-on electrons are tracked — they carry energy 0.05–1 µm sideways, the PSF's mid-range term.<br><b>Corrected, CSDA only</b>: the same, but all energy loss deposited on the track (no mid-range; the forward core too strong).<br><b>Old simulator</b>: the physics of sim-scattering.html (non-relativistic elastic, its stopping formula, a mean atom for compounds) — β comes out about 20 % too wide at 100 keV. Kept to show the difference.">?</span></div><select class="field" id="mcPhysics"><option value="default">corrected, fast secondaries</option><option value="csda">corrected, CSDA only</option><option value="legacy">old simulator</option></select></div>
              <div><div class="label">Threads</div><input class="field" id="mcThreads" type="number" min="1" max="32" step="1"></div>
              <div><div class="label">Seed</div><input class="field" id="mcSeed" type="number" min="1" step="1"></div>
            </div>
          </details>
          <div class="row" style="margin-top:8px;"><button class="btn small primary" id="mcRun">Run Monte Carlo</button><button class="btn small" id="mcStop" disabled>Stop</button></div>
          <div class="hint" id="mcProgress" style="margin-top:6px; min-height:16px;"></div>
          <label class="row" style="gap:6px; margin-top:6px; font-size:12px;"><input type="checkbox" id="mcUseFit"> Use the fit instead of the table (closed form, fast)</label>
          <div id="mcInfo" class="hint" style="margin-top:6px;"></div>
          <div id="mcFitTable" class="hint" style="margin-top:6px;"></div>
        </div>
      </div>
      <div class="panel">
        <div class="section-title">In use</div>
        <div id="psfSummary" class="hint"></div>
        <div class="row" style="margin-top:8px;">
          <button class="btn small" id="psfKeep">Keep for comparison</button>
          <button class="btn small" id="psfClearCmp">Clear comparisons</button>
        </div>
      </div>
    </div>
    <div class="col">
      <div class="psfcols" id="psfCols">
        <div class="panel" style="padding:8px; min-width:0;">
          <canvas id="psfPlot" style="width:100%; height:440px; display:block;"></canvas>
          <canvas id="psfCum" style="width:100%; height:230px; display:block; margin-top:6px;"></canvas>
          <div class="hint" id="psfHover" style="min-height:18px; margin-top:4px;"></div>
        </div>
        <div class="panel" id="trajPanel" style="padding:8px; min-width:0; display:none;">
          <div class="section-title">Trajectories <span class="q" data-tip="The first electrons of the Monte Carlo (the same seed, so the same electrons the run starts with), seen from the side: x across, depth z down, both to the same scale. <b>Orange</b>: the electron left through the top surface (backscattered). <b>Blue</b>: it stayed in the sample until it stopped. Thin lines are the fast secondary (knock-on) electrons.<br><br><b>Energy deposition</b>: where the energy goes, summed across y, on a log scale over four decades below the most exposed pixel; from its own (larger) number of electrons, recomputed for the part you are looking at.<br><br>Wheel = zoom about the cursor, drag = pan, double click = fit. The settings are the Monte Carlo panel's; no run is needed.">?</span></div>
          <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center; font-size:13px;">
            <label class="row" style="gap:5px;"><input type="checkbox" id="trajOn"> Tracks: first</label><input class="field" id="trajN" type="number" min="1" max="2000" step="10" style="width:76px;"><span>electrons</span>
            <label class="row" style="gap:5px; margin-left:6px;"><input type="checkbox" id="trajDep"> Energy deposition:</label><input class="field" id="trajDepN" type="number" min="100" max="100000" step="500" style="width:86px;"><span>electrons</span>
          </div>
          <div class="row" style="gap:6px; margin-top:6px;"><button class="btn small" id="trajFit">Fit all</button><button class="btn small" id="trajResist">Resist</button><span class="hint" id="trajStatus"></span></div>
          <canvas id="trajPlot" style="width:100%; height:560px; display:block; margin-top:6px; cursor:grab; touch-action:none;"></canvas>
          <div class="hint" id="trajHover" style="min-height:18px; margin-top:4px;"></div>
        </div>
      </div>
    </div>
  </div>`;

  const compare = [];
  let current = null;

  const st = () => app.project.psf;
  function syncFields() {
    const s = st();
    $('psfMode').value = s.mode;
    $('psfKeV').value = s.energyKeV ?? 100; $('psfSub').value = s.substrate ?? 'Si';
    $('psfResist').value = s.resistNm ?? 100; $('psfAlphaMin').value = s.alphaMinNm ?? 8;
    $('psfEtaOv').value = s.mode === 'scaling' && s.eta != null ? s.eta : '';
    const q = psfParamsFor({ energyKeV: s.energyKeV ?? 100, substrate: s.substrate ?? 'Si', resistNm: s.resistNm ?? 100, alphaMinNm: s.alphaMinNm ?? 8 });
    $('psfA').value = +(s.alpha ?? q.alpha).toFixed(3); $('psfB').value = +((s.beta ?? q.beta) / 1000).toFixed(4);
    $('psfE').value = s.eta ?? q.eta; $('psfG').value = s.gamma ?? ''; $('psfN').value = s.nu ?? ''; $('psfP').value = s.p ?? '';
    const model = MODELS[s.model]?.table ? s.model : modelOf(s);
    $('psfModel').value = model;
    const spl = model === 'spline';
    for (const id of ['psfA', 'psfB', 'psfE']) $(id).closest('div').parentElement.style.display = spl ? 'none' : '';
    $('psfPBox').style.display = model === 'plg' ? '' : 'none';
    $('psfSplineInfo').style.display = spl ? '' : 'none';
    if (spl) $('psfSplineInfo').innerHTML = s.knots?.length ? `${s.knots.length} knots${s.knotsFrom ? ` from ${esc(s.knotsFrom)}` : ''}, log f(r) from ${fmtLenNm(s.knots[0][0])} to ${fmtLenNm(s.knots[s.knots.length - 1][0])}. Choose an energy and press <b>Use</b> for the Monte Carlo knots.` : 'No knots yet: choose an energy and press <b>Use</b>.';
    $('psfSugE').value = String(s.sugKeV ?? nearestSugE(s.energyKeV ?? mcSt().energyKeV ?? 100));
    $('psfSugNote').textContent = `Monte Carlo, ${SUGGESTED.stack}`;
    $('psfMidRow').style.display = MODELS[model].mid ? '' : 'none';
    $('psfGLabel').textContent = MODELS[model].mid === 'exp' ? 'γ (nm, decay length of the exponential)' : 'γ (nm, width of the mid-range Gaussian)';
    for (const id of ['psfRUnit', 'psfVMode', 'psfBins']) $(id).disabled = false;
    if (s.table?.source) {
      const bm = s.table.source.kind === 'beamer';
      $('psfFile').textContent = bm ? `${s.table.source.name} — ${beamerPsfLabel(s.table.meta || {})}` : s.table.source.name;
      $('psfRUnit').value = s.table.source.rUnit; $('psfVMode').value = s.table.source.valueMode; $('psfBins').value = s.table.source.binEdges;
      for (const id of ['psfRUnit', 'psfVMode', 'psfBins']) $(id).disabled = bm;     // fixed by the BEAMER format
      $('psfFitModel').value = MODELS[s.table.model] ? s.table.model : s.table.triple ? 'triple' : 'double';
      $('psfUseFit').checked = !!s.table.useFit;
    }
    const m = mcSt();
    $('mcKeV').value = m.energyKeV; $('mcBeamA').value = m.beamA; $('mcResist').value = m.resist; $('mcResistNm').value = m.resistNm;
    $('mcFilm').value = m.film; $('mcFilmNm').value = m.filmNm; $('mcFilmNm').disabled = !m.film; $('mcSub').value = m.substrate;
    $('mcFitModel').value = s.mc?.model || m.model; $('mcMaxN').value = m.maxElectrons; $('mcErr').value = m.targetErrPct;
    $('mcEcut').value = m.Ecut; $('mcPhysics').value = m.physics; $('mcThreads').value = m.threads ?? defaultThreads(); $('mcSeed').value = m.seed;
    $('mcUseFit').checked = !!s.mc?.useFit; $('mcUseFit').disabled = !s.mc;
    $('trajOn').checked = !!m.trajOn; $('trajN').value = m.trajN; $('trajDep').checked = !!m.trajDep; $('trajDepN').value = m.trajDepN;
    $('trajPanel').style.display = s.mode === 'mc' ? '' : 'none'; $('psfCols').classList.toggle('two', s.mode === 'mc');
    $('psfScaling').style.display = s.mode === 'scaling' ? '' : 'none';
    $('psfManual').style.display = s.mode === 'manual' ? '' : 'none';
    $('psfTable').style.display = s.mode === 'table' ? '' : 'none';
    $('psfMC').style.display = s.mode === 'mc' ? '' : 'none';
  }
  const mcSt = () => { const s = st(); s.mcSettings = { ...MC_DEFAULTS, ...(s.mcSettings || {}) }; return s.mcSettings; };
  const fmtLenNm = (nm) => (nm >= 1000 ? `${+(nm / 1000).toPrecision(3)} µm` : `${+nm.toPrecision(3)} nm`);
  const nearestSugE = (keV) => SUGGESTED_ENERGIES.reduce((a, b) => (Math.abs(Math.log(b / keV)) < Math.abs(Math.log(a / keV)) ? b : a));
  // fill the manual fields of a model from the Monte Carlo suggestion at an energy
  function applySuggestion(model, keV) {
    const s = st(), g = suggestionFor(model, keV);
    s.model = model; s.sugKeV = g.energyKeV;
    if (model === 'spline') { s.knots = g.knots.map((k) => [...k]); s.knotsFrom = `the Monte Carlo at ${g.energyKeV} keV`; }
    else { s.alpha = g.alpha; s.beta = g.beta; s.eta = g.eta; s.gamma = g.gamma ?? null; s.nu = g.nu ?? 0; if (model === 'plg') s.p = g.p; }
    return g.energyKeV;
  }

  function commit(reason) { app.psfChanged(reason); render(); }

  $('psfMode').onchange = (e) => {
    const s = st();
    if (e.target.value === 'manual' && !(s.alpha > 0) && !s.knots) applySuggestion(MODELS[s.model] ? s.model : 'double', s.energyKeV ?? mcSt().energyKeV ?? 100);   // start from the Monte Carlo suggestion
    if (e.target.value === 'table' && !s.table) toast('Import a two-column table (radius, value). Until then the previous PSF stays in use.');
    if (e.target.value === 'mc' && !s.mc) toast('Set up the stack and press <b>Run Monte Carlo</b>. Until a run finishes, the PSF from beam energy &amp; substrate stays in use.', 5000);
    s.mode = e.target.value;
    if (s.mode === 'scaling') { s.eta = null; }
    syncFields(); commit('PSF source');
  };
  const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  for (const id of ['psfKeV', 'psfResist', 'psfAlphaMin', 'psfEtaOv']) $(id).oninput = () => {
    const s = st();
    s.energyKeV = Math.max(1, num('psfKeV') ?? 100); s.resistNm = Math.max(1, num('psfResist') ?? 100);
    s.alphaMinNm = Math.max(0.1, num('psfAlphaMin') ?? 8); s.eta = num('psfEtaOv');
    commit('PSF energy/substrate');
  };
  $('psfSub').onchange = () => { st().substrate = $('psfSub').value; commit('substrate'); };
  for (const id of ['psfA', 'psfB', 'psfE', 'psfG', 'psfN', 'psfP']) $(id).oninput = () => {
    const s = st();
    s.alpha = Math.max(0.1, num('psfA') ?? 8); s.beta = Math.max(10, (num('psfB') ?? 30) * 1000); s.eta = Math.max(0, num('psfE') ?? 0.7);
    s.gamma = num('psfG'); s.nu = num('psfN') ?? 0; s.p = Math.max(1.01, num('psfP') ?? 2);
    commit('manual PSF');
  };
  // a new model starts from its Monte Carlo suggestion at the chosen energy
  $('psfModel').onchange = (e) => { const E = applySuggestion(e.target.value, +$('psfSugE').value); syncFields(); commit('PSF model'); toast(`${MODELS[e.target.value].label}: suggested values from the Monte Carlo at ${E} keV (${SUGGESTED.stack}).`, 3500); };
  $('psfSugE').onchange = () => { st().sugKeV = +$('psfSugE').value; };
  $('psfSugUse').onclick = () => { const E = applySuggestion($('psfModel').value, +$('psfSugE').value); syncFields(); commit('PSF suggestion'); toast(`Suggested values from the Monte Carlo at ${E} keV.`); };

  function storeTable(psf, name, model, source) {
    psf.fit = fitGaussians(psf, { model });
    const prev = st().table;
    st().table = { r: Array.from(psf.r), f: Array.from(psf.f), meta: { ...psf.meta, file: name }, fit: psf.fit, warnings: psf.warnings,
      model, useFit: prev?.source?.name === name ? !!prev.useFit : false, source };
    st().mode = 'table';
  }
  function importWith(text, name, opts) {
    const { psf, guess } = importTableText(text, opts);
    storeTable(psf, name, opts.model, { name, text, rUnit: opts.rUnit, valueMode: psf.meta.valueMode, binEdges: opts.binEdges, model: opts.model });
    return guess;
  }
  // a BEAMER .lpsf: its units and value mode are fixed by the format, so only the fit model is a choice
  function importBeamer(psf, name, model) {
    storeTable(psf, name, model, { name, kind: 'beamer', rUnit: 'nm', valueMode: 'per-area', binEdges: 'geometric', model });
  }
  const tableOpts = () => ({ rUnit: $('psfRUnit').value, valueMode: $('psfVMode').value, binEdges: $('psfBins').value, model: $('psfFitModel').value });
  const isBeamerName = (n) => /\.l?psf$/i.test(n);
  $('psfImport').onclick = () => pickFile('.csv,.txt,.dat,.tsv,.lpsf,.psf,text/plain', async (data, name) => {
    try {
      if (isBeamerName(name) || (data instanceof Uint8Array && looksLikeBeamerPsf(data))) {
        const { psf } = await importBeamerPsf(data, { name });
        importBeamer(psf, name, $('psfFitModel').value);
        syncFields(); commit('PSF imported');
        toast(`Imported <b>${esc(name)}</b> — ${esc(beamerPsfLabel(psf.meta))}. Used as a table; the fits are listed below.`, 7000);
        return;
      }
      const text = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
      const o = tableOpts(); delete o.valueMode;          // a fresh file: let the importer guess the value mode
      const guess = importWith(text, name, o);
      syncFields(); commit('PSF imported');
      toast(`Imported <b>${esc(name)}</b> — values read as <b>${guess.mode}</b>${guess.confident ? '' : ' (a guess: check the plot against the analytic curve)'}.`, 5000);
    } catch (e) { alert(`Could not import ${name}:\n${e.message}`); }
  }, { binary: isBeamerName });
  for (const id of ['psfRUnit', 'psfVMode', 'psfBins', 'psfFitModel']) $(id).onchange = () => {
    const t = st().table, src = t?.source;
    if (!src) return;
    try {
      if (src.kind === 'beamer') {                         // the table stays; refit with the chosen model
        const psf = makePSF({ r: t.r, f: t.f, meta: t.meta, warnings: t.warnings || [] });
        importBeamer(psf, src.name, $('psfFitModel').value);
      } else importWith(src.text, src.name, tableOpts());
      syncFields(); commit('PSF re-read');
    } catch (e) { alert(e.message); }
  };
  $('psfUseFit').onchange = (e) => { if (st().table) { st().table.useFit = e.target.checked; commit('PSF fit/table'); } };
  $('psfKeep').onclick = () => {
    if (!current) return;
    if (compare.length >= 3) compare.shift();
    compare.push({ psf: current, label: psfLabel(current) });
    render();
  };
  $('psfClearCmp').onclick = () => { compare.length = 0; render(); };

  // ---------------------------------------------------------------- Monte Carlo
  let mcRun = null, live = null;
  const readMC = () => {
    const m = mcSt();
    m.energyKeV = Math.min(200, Math.max(1, num('mcKeV') ?? 100)); m.beamA = Math.max(0, num('mcBeamA') ?? 8);
    m.resist = $('mcResist').value; m.resistNm = Math.max(1, num('mcResistNm') ?? 100);
    m.film = $('mcFilm').value; m.filmNm = Math.max(1, num('mcFilmNm') ?? 20); m.substrate = $('mcSub').value;
    m.maxElectrons = Math.max(1000, Math.round(num('mcMaxN') ?? 2e5)); m.targetErrPct = Math.max(0, num('mcErr') ?? 1);
    m.Ecut = Math.min(m.energyKeV / 4, Math.max(0.1, num('mcEcut') ?? 0.5)); m.physics = $('mcPhysics').value;
    const th = Math.round(num('mcThreads') ?? 0); m.threads = th >= 1 && th !== defaultThreads() ? Math.min(32, th) : null;
    m.seed = Math.max(1, Math.round(num('mcSeed') ?? 1));
    $('mcFilmNm').disabled = !m.film;
    // the fields show the values actually used (E16: 0 keV silently became 1 keV)
    for (const [id, v] of [['mcKeV', m.energyKeV], ['mcBeamA', m.beamA], ['mcResistNm', m.resistNm], ['mcFilmNm', m.filmNm], ['mcMaxN', m.maxElectrons], ['mcErr', m.targetErrPct], ['mcEcut', m.Ecut], ['mcSeed', m.seed]]) {
      if (num(id) !== v) { $(id).value = v; if (id === 'mcKeV') toast(`Energy set to ${v} keV (the Monte Carlo runs from 1 to 200 keV).`); }
    }
    return m;
  };
  for (const id of ['mcKeV', 'mcBeamA', 'mcResist', 'mcResistNm', 'mcFilm', 'mcFilmNm', 'mcSub', 'mcMaxN', 'mcErr', 'mcEcut', 'mcPhysics', 'mcThreads', 'mcSeed']) {
    $(id).addEventListener('change', () => { readMC(); app.markDirty?.('MC settings'); mcStale(); updateTraj(); });
  }
  // the stored result no longer matches the inputs: say so (the result stays in use until a new run)
  function mcStale() {
    const s = st(); if (!s.mc) return;
    const cur = JSON.stringify(mcConfig(mcSt())), was = JSON.stringify(s.mc.meta?.config || null);
    $('mcProgress').innerHTML = cur === was ? '' : '<span style="color:#a60">The settings differ from the result in use — run again to update it.</span>';
  }
  $('mcFitModel').onchange = () => {
    const s = st(); mcSt().model = $('mcFitModel').value;
    if (s.mc) { s.mc.model = $('mcFitModel').value; commit('MC fit model'); }
  };
  $('mcUseFit').onchange = (e) => { if (st().mc) { st().mc.useFit = e.target.checked; commit('MC fit/table'); } };
  const fmtN = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e4 ? (n / 1e3).toFixed(0) + ' k' : String(n);
  $('mcRun').onclick = () => {
    if (mcRun) return;
    const m = readMC(), cfg = mcConfig(m);
    $('mcRun').disabled = true; $('mcStop').disabled = false;
    $('mcProgress').textContent = 'starting workers…';
    let lastLive = 0;
    try {
      mcRun = runMonteCarlo(cfg, {
        maxElectrons: m.maxElectrons, targetErr: m.targetErrPct / 100, minElectrons: Math.min(m.maxElectrons, 10000),
        seed: m.seed, threads: m.threads ?? defaultThreads(),
        onProgress: (p) => {
          const te = Number.isFinite(p.tailErr) ? (100 * p.tailErr).toFixed(2) + ' %' : '—';
          $('mcProgress').innerHTML = `${fmtN(p.acc.n)} electrons · ${fmtN(Math.round(p.rate))} e⁻/s · ${p.elapsed.toFixed(1)} s · tail error <b>${te}</b> · η<sub>BSE</sub> ${p.summary.eta_BSE.toFixed(3)}`;
          const now = performance.now();
          if (now - lastLive > 800 && p.acc.n >= 2000) {   // live curve (no fit: cheap)
            lastLive = now;
            try { live = toPSF(p.acc, { model: 'double', objective: 'energy', fit: false }); } catch { live = null; }
            if (app.isTabActive('psf') && current) drawPlots();
          }
        },
      });
    } catch (e) { mcDone(); $('mcProgress').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; return; }
    mcRun.promise.then(({ acc, stopped }) => {
      const s = st(), model = mcSt().model;
      const psf = toPSF(acc, { model, objective: 'energy', meta: { config: cfg, physics: m.physics, ms: Math.round(acc.ms) } });
      const sm = summary(acc);
      s.mc = { r: Array.from(psf.r), f: Array.from(psf.f), relErr: psf.relErr.map((v) => (Number.isFinite(v) ? +v.toPrecision(3) : null)),
        meta: { ...psf.meta, summary: { ...sm, tailErr: tailError(acc), stopped } }, fit: psf.fit, model, objective: 'energy', useFit: !!s.mc?.useFit };
      s.mode = 'mc';
      mcDone();
      syncFields(); commit('Monte Carlo PSF');
      toast(`Monte Carlo done: ${fmtN(acc.n)} electrons in ${(acc.ms / 1000).toFixed(1)} s${stopped ? ' (stopped)' : ''}. β = ${(psf.fit.beta / 1000).toFixed(2)} µm, η = ${psf.fit.eta.toFixed(2)}.`, 5000);
    }).catch((e) => { mcDone(); $('mcProgress').innerHTML = `<span style="color:#c00">Monte Carlo failed: ${esc(e.message)}</span>`; });
  };
  $('mcStop').onclick = () => { mcRun?.stop(); $('mcStop').disabled = true; };
  function mcDone() { mcRun = null; live = null; $('mcRun').disabled = false; $('mcStop').disabled = true; }

  // ---------------------------------------------------------------- trajectories (MC mode)
  const traj = createTrajView({ canvas: $('trajPlot'), hover: $('trajHover'), onView: () => requestDep() });
  let trajCfg = '', trajKey = '', depTimer = null, depSeq = 0;
  const layersOf = (m) => {
    const L = [{ z0: 0, z1: m.resistNm, name: `${MATERIALS[m.resist]?.name || m.resist} ${m.resistNm} nm` }];
    let z = m.resistNm;
    if (m.film) { L.push({ z0: z, z1: z + m.filmNm, name: `${MATERIALS[m.film]?.name || m.film} ${m.filmNm} nm` }); z += m.filmNm; }
    L.push({ z0: z, z1: Infinity, name: MATERIALS[m.substrate]?.name || m.substrate });
    return L;
  };
  // the tracks for the current settings (when shown and changed)
  function updateTraj(force = false) {
    const s = st();
    if (s.mode !== 'mc' || !app.isTabActive('psf')) return;
    const m = mcSt(), cfg = mcConfig(m), cfgKey = JSON.stringify(cfg);
    traj.setLayers(layersOf(m));
    traj.setShow({ tracks: !!m.trajOn, dep: !!m.trajDep });
    const key = JSON.stringify([cfgKey, m.seed, m.trajOn ? m.trajN : 0]);
    if (!force && key === trajKey) { traj.draw(); return; }
    const refit = cfgKey !== trajCfg;
    trajKey = key; trajCfg = cfgKey;
    if (refit) traj.setDep(null);
    if (!m.trajOn) { traj.setTracks(null, refit); $('trajStatus').textContent = ''; requestDep(0); return; }
    $('trajStatus').textContent = 'tracing…';
    const t0 = performance.now();
    traceMonteCarlo(cfg, { nShow: m.trajN, nDep: 0, seed: m.seed }).then((r) => {
      if (!r) return;
      $('trajStatus').textContent = `${m.trajN} electrons, ${(performance.now() - t0).toFixed(0)} ms${r.truncated ? ' · the tracks were cut at 3 M points' : ''}`;
      traj.setTracks(r, refit || !traj.hasView());
      requestDep(0);
    }).catch((e) => { $('trajStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; });
  }
  // the deposition map for the part in view, a moment after the view settles
  function requestDep(delay = 300) {
    clearTimeout(depTimer);
    const m = mcSt();
    if (!m.trajDep || st().mode !== 'mc' || !app.isTabActive('psf')) return;
    depTimer = setTimeout(() => {
      if (!traj.hasView()) traj.fit();
      const view = traj.depView(); if (!view) return;
      const seq = ++depSeq, t0 = performance.now();
      $('trajStatus').textContent = 'energy deposition…';
      traceMonteCarlo(mcConfig(m), { nShow: 0, nDep: m.trajDepN, seed: m.seed, view }).then((r) => {
        if (!r || seq !== depSeq) return;
        $('trajStatus').textContent = `energy deposition: ${m.trajDepN.toLocaleString()} electrons, ${(performance.now() - t0).toFixed(0)} ms`;
        traj.setDep(r);
      }).catch((e) => { $('trajStatus').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; });
    }, delay);
  }
  const readTraj = () => {
    const m = mcSt();
    m.trajOn = $('trajOn').checked; m.trajDep = $('trajDep').checked;
    m.trajN = Math.min(2000, Math.max(1, Math.round(num('trajN') ?? 100))); m.trajDepN = Math.min(100000, Math.max(100, Math.round(num('trajDepN') ?? 2000)));
    $('trajN').value = m.trajN; $('trajDepN').value = m.trajDepN;
  };
  for (const id of ['trajOn', 'trajN']) $(id).addEventListener('change', () => { readTraj(); updateTraj(); });
  for (const id of ['trajDep', 'trajDepN']) $(id).addEventListener('change', () => { readTraj(); traj.setDep(null); traj.setShow({ dep: mcSt().trajDep }); requestDep(0); });
  $('trajFit').onclick = () => traj.fit();
  $('trajResist').onclick = () => traj.fitResist();

  // ---------------------------------------------------------------- plots
  const plot = $('psfPlot'), cum = $('psfCum');
  let axes = null;
  const setup = (c) => setupCanvas(c);
  // redraw when a plot changes size or the page is zoomed (the labels would otherwise be stretched)
  onResize([plot, cum, $('trajPlot')], () => { if (!app.isTabActive('psf') || !current) return; drawPlots(); traj.draw(); requestDep(); });
  const R0 = 0.1, R1 = 3e5;
  function curves() {
    const out = [{ psf: current, color: '#111', width: 2, label: 'in use' }];
    const s = st();
    if (!current.gauss && current.fit && current.fit.amplitude != null) out.push({ fn: (r) => current.fit.amplitude * gaussAt(current.fit.terms, r), color: '#d13', dash: [6, 4], width: 1.5, label: `fit: ${MODELS[current.fit.model]?.short || 'DG'}` });
    else if (s.mode === 'table' && s.table?.useFit && s.table.r?.length) out.push({ psf: makePSF({ r: s.table.r, f: s.table.f }), color: '#d13', dash: [6, 4], width: 1.5, label: 'the table itself' });
    else if (s.mode === 'mc' && s.mc?.useFit && s.mc.r?.length) out.push({ psf: makePSF({ r: s.mc.r, f: s.mc.f }), color: '#d13', dash: [6, 4], width: 1.5, label: 'the simulated table' });
    if (live) out.push({ psf: live, color: '#e08a00', width: 2, label: `Monte Carlo running (${live.meta.electrons} e⁻)` });
    // reference: the analytic PSF for the same energy and substrate (the MC's when in MC mode)
    const mcs = s.mode === 'mc' ? mcSt() : null;
    const refE = mcs ? mcs.energyKeV : s.energyKeV ?? 100, refS = mcs ? mcs.substrate : s.substrate ?? 'Si';
    if (s.mode !== 'scaling' && SUBSTRATES[refS]) {
      const ref = makeAnalyticFor({ energyKeV: refE, substrate: refS, resistNm: mcs ? mcs.resistNm : s.resistNm ?? 100 });
      out.push({ psf: ref, color: '#2a9d5b', width: 1.5, dash: [2, 3], label: `analytic, ${refE} keV ${refS}` });
    }
    compare.forEach((c, i) => out.push({ psf: c.psf, color: COMPARE_COLORS[i], width: 1.5, label: c.label }));
    return out;
  }
  const rLabel = (r) => (r >= 1e6 ? `${r / 1e6} mm` : r >= 1000 ? `${r / 1000} µm` : `${r} nm`);
  // label every n-th decade so the labels never run into each other
  function decadeStep(ctx, width) {
    const n = Math.log10(R1 / R0), each = width / n, wMax = Math.max(...Array.from({ length: Math.floor(n) + 1 }, (_, k) => ctx.measureText(rLabel(10 ** (Math.ceil(Math.log10(R0)) + k))).width));
    return Math.max(1, Math.ceil((wMax + 12) / each));
  }
  // a plot title on a white box, so a curve passing behind it does not cross the letters
  function titleBox(ctx, txt, x, y) { const w = ctx.measureText(txt).width; ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(x - 3, y - 14, w + 6, 19); ctx.fillStyle = '#222'; ctx.fillText(txt, x, y); }
  function drawPlots() {
    const { ctx, w, h } = setup(plot);
    const L = 70, Rm = 14, T = 30, B = 42, pw = w - L - Rm, ph = h - T - B;
    const cs = curves();
    let fmax = 0;
    for (const c of cs) { const v = c.psf ? psfAt(c.psf, R0) : c.fn(R0); if (v > fmax) fmax = v; }
    const y1 = Math.ceil(Math.log10(fmax)) , y0 = y1 - 14;
    const X = (r) => L + (pw * Math.log10(r / R0)) / Math.log10(R1 / R0);
    const Y = (v) => T + (ph * (y1 - Math.log10(Math.max(v, 1e-300)))) / (y1 - y0);
    axes = { X, L, pw, R0, R1 };
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1; ctx.font = FONT; ctx.fillStyle = '#555';
    ctx.textAlign = 'center';
    const lStep = decadeStep(ctx, pw);
    for (let e = Math.ceil(Math.log10(R0)); e <= Math.log10(R1); e++) {
      const x = X(10 ** e); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      if ((e - Math.ceil(Math.log10(R0))) % lStep === 0) ctx.fillText(rLabel(10 ** e), x, T + ph + 18);
    }
    ctx.textAlign = 'left';
    for (let e = y0; e <= y1; e += 2) { const y = Y(10 ** e); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); drawPow10(ctx, e, L - 8, y + 5, 'right'); }

    ctx.textAlign = 'right'; ctx.fillText('radius r', L + pw, T + ph + 36); ctx.textAlign = 'left';
    ctx.strokeStyle = '#aaa'; ctx.strokeRect(L, T, pw, ph);
    // α, β and the short/long split marks
    const f = current.fit, sp = splitPSF(current);
    const mark = (r, txt, col) => { const x = X(r); ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.fillText(txt, x + 4, T + ph - 8); };
    mark(f.alpha, 'α', '#888'); mark(f.beta, 'β', '#888'); if (f.gamma) mark(f.gamma, MODELS[f.model]?.mid === 'exp' ? 'γ (exp)' : 'γ', '#888');
    mark(sp.rMaxSR, 'short | long', '#c9a400');
    // curves
    cs.forEach((c) => {
      ctx.strokeStyle = c.color; ctx.lineWidth = c.width; ctx.setLineDash(c.dash || []);
      ctx.beginPath();
      for (let k = 0; k <= 600; k++) {
        const r = R0 * (R1 / R0) ** (k / 600);
        const v = c.psf ? (r > c.psf.r[c.psf.r.length - 1] ? 0 : psfAt(c.psf, r)) : c.fn(r);
        if (!(v > 0)) continue;
        const y = Y(v); if (y > T + ph) continue;
        k ? ctx.lineTo(X(r), y) : ctx.moveTo(X(r), y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    });
    // legend
    ctx.font = FONT; titleBox(ctx, pw > 430 ? 'f(r): energy per nm² per electron, normalised' : 'f(r) per nm² per electron', L, T - 11);
    ctx.font = FONT_SMALL;
    const lab = (c) => (c.label.length > 44 ? c.label.slice(0, 44) + '…' : c.label);
    const lw = Math.min(pw - 20, Math.max(...cs.map((c) => ctx.measureText(lab(c)).width)) + 44), lx = L + pw - lw - 6;
    let ly = T + 22;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(lx - 6, ly - 15, lw + 8, cs.length * 19 + 6);
    cs.forEach((c) => { ctx.strokeStyle = c.color; ctx.lineWidth = c.width; ctx.setLineDash(c.dash || []); ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 28, ly - 4); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#222'; ctx.fillText(lab(c), lx + 36, ly); ly += 19; });

    // cumulative energy fraction
    const g = setup(cum), cw = g.w - L - Rm, chh = g.h - T - 30, c2 = g.ctx;
    const Xc = (r) => L + (cw * Math.log10(r / R0)) / Math.log10(R1 / R0), Yc = (v) => T + chh * (1 - v);
    c2.font = FONT; c2.strokeStyle = '#eee';
    for (const v of [0, 0.25, 0.5, 0.75, 1]) { c2.beginPath(); c2.moveTo(L, Yc(v)); c2.lineTo(L + cw, Yc(v)); c2.stroke(); c2.fillStyle = '#555'; c2.textAlign = 'right'; c2.fillText(v.toFixed(2), L - 8, Yc(v) + 5); c2.textAlign = 'left'; }
    c2.textAlign = 'center'; c2.fillStyle = '#555';
    const lStep2 = decadeStep(c2, cw);
    for (let e = Math.ceil(Math.log10(R0)); e <= Math.log10(R1); e++) if ((e - Math.ceil(Math.log10(R0))) % lStep2 === 0) c2.fillText(rLabel(10 ** e), Xc(10 ** e), T + chh + 18);
    c2.textAlign = 'left';
    c2.strokeStyle = '#aaa'; c2.strokeRect(L, T, cw, chh);

    const eta = f.eta, fw = 1 / (1 + eta + (f.gamma ? f.nu : 0));
    c2.strokeStyle = '#888'; c2.setLineDash([3, 3]); c2.beginPath(); c2.moveTo(L, Yc(fw)); c2.lineTo(L + cw, Yc(fw)); c2.stroke(); c2.setLineDash([]);
    c2.fillStyle = '#666'; c2.fillText(`1/(1+η${f.gamma ? '+ν' : ''}) = ${fw.toFixed(3)} — forward share`, L + 8, Yc(fw) - 6);
    cs.filter((c) => c.psf).forEach((c) => {
      const C = cumulative(c.psf.r, c.psf.f), tot = C[C.length - 1];
      c2.strokeStyle = c.color; c2.lineWidth = c.width; c2.setLineDash(c.dash || []); c2.beginPath();
      let first = true;
      for (let i = 0; i < c.psf.r.length; i += 2) { const r = c.psf.r[i]; if (r < R0 || r > R1) continue; const x = Xc(r), y = Yc(C[i] / tot); first ? c2.moveTo(x, y) : c2.lineTo(x, y); first = false; }
      c2.stroke(); c2.setLineDash([]);
    });
    c2.font = FONT; titleBox(c2, 'fraction of the energy within r', L, T - 11);
  }
  plot.addEventListener('mousemove', (e) => {
    if (!axes || !current) return;
    const rect = plot.getBoundingClientRect(), x = e.clientX - rect.left;
    if (x < axes.L || x > axes.L + axes.pw) { $('psfHover').textContent = ''; return; }
    const r = axes.R0 * (axes.R1 / axes.R0) ** ((x - axes.L) / axes.pw);
    const C = cumulative(current.r, current.f);
    let k = 0; while (k < current.r.length - 1 && current.r[k + 1] < r) k++;
    $('psfHover').innerHTML = `r = <b>${r >= 1000 ? (r / 1000).toPrecision(3) + ' µm' : r.toPrecision(3) + ' nm'}</b> · f = ${psfAt(current, r).toExponential(3)} nm⁻² · ${(100 * C[k] / C[C.length - 1]).toFixed(1)} % of the energy within r`;
  });

  function render() {
    try { current = psfFromSettings(st()); } catch (e) { $('psfSummary').innerHTML = `<span style="color:#c00">${esc(e.message)}</span>`; return; }
    const s = st(), f = current.fit, sp = splitPSF(current);
    const q = psfParamsFor({ energyKeV: s.energyKeV ?? 100, substrate: s.substrate ?? 'Si', resistNm: s.resistNm ?? 100, alphaMinNm: s.alphaMinNm ?? 8 });
    $('psfScalingNote').innerHTML = `β from published data (Owen 1990 et al.: ${esc(SUBSTRATES[s.substrate ?? 'Si'].points.filter((p) => p.use).map((p) => `${p.E} kV: ${p.betaUm} µm`).join(', '))}, β ∝ E<sup>1.7</sup> between/outside); forward broadening d = ${(0.9 * ((s.resistNm ?? 100) / (s.energyKeV ?? 100)) ** 1.5).toFixed(2)} nm → α = ${q.alpha.toFixed(2)} nm.`;
    const warn = s.mode === 'table' && s.table?.warnings?.length ? `<br><span style="color:#a60">${s.table.warnings.map(esc).join('<br>')}</span>` : '';
    const model = MODELS[f.model] || MODELS[f.gamma ? 'triple' : 'double'];
    const spl = f.model === 'spline', manualTable = current.meta.source === 'manual' && model.table;
    const how = current.meta.source === 'fit' ? ` <span class="pill">fit of the table, rms ${(100 * f.rms).toFixed(1)} %</span>`
      : manualTable ? ` <span class="pill">${spl && current.meta.knotsFrom ? `knots from ${esc(current.meta.knotsFrom)}` : 'manual'}</span>`
      : current.gauss ? '' : ` <span class="pill">table; fit rms ${(100 * f.rms).toFixed(1)} %</span>`;
    const gTxt = f.gamma ? `, γ = ${f.gamma >= 1000 ? (f.gamma / 1000).toFixed(2) + ' µm' : f.gamma.toFixed(1) + ' nm'}, ν = ${f.nu.toFixed(3)}` : '';
    const params = spl ? `<b>${f.knots?.length ?? '?'} knots</b>; as a double Gaussian ≈ α ${f.alpha.toFixed(2)} nm, β ${(f.beta / 1000).toFixed(3)} µm, η ${f.eta.toFixed(3)}`
      : `<b>α = ${f.alpha.toFixed(2)} nm</b>${f.model === 'plg' ? `, <b>p = ${f.p.toFixed(2)}</b>` : ''}, <b>β = ${(f.beta / 1000).toFixed(3)} µm</b>, <b>η = ${f.eta.toFixed(3)}</b>${gTxt}`;
    $('psfSummary').innerHTML = `<span class="pill">${esc(model.label)}</span>${how}<br>${params}<br>`
      + `forward share 1/(1+η${f.gamma ? '+ν' : ''}) ${spl ? '≈' : '='} ${(1 / (1 + f.eta + (f.gamma ? f.nu : 0))).toFixed(3)} · short range up to ${(sp.rMaxSR / 1000).toFixed(2)} µm, long range on a β/8 grid`
      + (model.table ? '' : `<br><span style="color:#888">The old Pattern Studio used σ = α/√2, β/√2: σ<sub>α</sub> = ${(f.alpha / Math.SQRT2).toFixed(2)} nm, σ<sub>β</sub> = ${(f.beta / Math.SQRT2 / 1000).toFixed(2)} µm.</span>`) + warn;
    // table and MC modes: all three models side by side, so the choice is informed
    const tab = s.mode === 'table' ? s.table : s.mode === 'mc' ? s.mc : null;
    const tabBox = s.mode === 'mc' ? 'mcFitTable' : 'psfFitTable';
    if (tab?.r?.length) {
      const key = s.mode + '|' + (tab.source?.name || tab.meta?.electrons) + '|' + tab.r.length + '|' + tab.f[0];
      if (fitTableKey !== key) {
        fitTableKey = key;
        const all = fitAllModels(makePSF({ r: tab.r, f: tab.f }), { objective: tab.objective || 'logf' });
        $('psfFitTable').innerHTML = $('mcFitTable').innerHTML = '';
        $(tabBox).innerHTML = `<table class="keytab fits" style="font-size:11px;"><tr><td><b>model</b></td><td><b>rms</b></td><td><b>α</b></td><td><b>β</b></td><td><b>η</b></td><td><b>γ / ν</b></td></tr>`
          + Object.entries(all).map(([k, r]) => r.error ? `<tr><td>${esc(MODELS[k].short)}</td><td colspan="5">${esc(r.error)}</td></tr>`
            : `<tr><td>${esc(MODELS[k].short)}</td><td>${(100 * r.rms).toFixed(1)} %</td><td>${r.alpha.toFixed(1)}</td><td>${(r.beta / 1000).toFixed(2)} µm</td><td>${r.eta.toFixed(2)}</td><td>${r.gamma ? `${r.gamma >= 1000 ? (r.gamma / 1000).toFixed(2) + ' µm' : r.gamma.toFixed(0) + ' nm'} / ${r.nu.toFixed(3)}` : '—'}</td></tr>`).join('') + '</table>';
      }
    } else { $('psfFitTable').innerHTML = $('mcFitTable').innerHTML = ''; fitTableKey = null; }
    mcInfo();
    if (app.isTabActive('psf')) { drawPlots(); updateTraj(); }
  }
  let fitTableKey = null;

  // what the stored Monte Carlo result is: stack, statistics, physics
  function mcInfo() {
    const s = st(), mc = s.mc;
    if (s.mode !== 'mc' || !mc) { $('mcInfo').innerHTML = s.mode === 'mc' ? 'No result yet — the PSF from beam energy &amp; substrate is in use until a run finishes.' : ''; return; }
    const m = mc.meta, sm = m.summary || {};
    const stack = (m.stack || []).map((l) => `${esc(MATERIALS[l.material]?.name || l.material)}${l.thicknessNm ? ' ' + l.thicknessNm + ' nm' : ''}`).join(' / ');
    $('mcInfo').innerHTML = `<b>Result in use:</b> ${m.energyKeV} keV on ${stack}, a = ${m.beamA} nm${m.physics === 'legacy' ? ', <span style="color:#a60">old-simulator physics</span>' : m.physics === 'csda' ? ', <span style="color:#a60">CSDA only (no fast secondaries)</span>' : ''}<br>`
      + `${fmtN(sm.electrons ?? m.electrons)} electrons${m.ms ? ` in ${(m.ms / 1000).toFixed(1)} s` : ''}${sm.stopped ? ' (stopped early)' : ''} · tail error ${Number.isFinite(sm.tailErr) ? (100 * sm.tailErr).toFixed(2) + ' %' : '—'}`
      + ` · η<sub>BSE</sub> = ${(sm.eta_BSE ?? m.eta_BSE ?? 0).toFixed(3)} · ${(sm.resistEnergyPerElectron ?? m.absoluteKeVPerElectron ?? 0).toFixed(2)} keV per electron in the resist`
      + (sm.etaHistory ? `<br><b>η by history = ${sm.etaHistory.toFixed(3)}</b> (resist energy from electrons that came back from the substrate ÷ from those that never left — no fit) = η<sub>BSE</sub> × ${(sm.etaHistory / sm.eta_BSE).toFixed(2)}: each backscattered electron deposits ${(sm.etaHistory / sm.eta_BSE).toFixed(1)}× a primary's energy (slower → higher stopping power; oblique → longer path).` : '')
      + `<br><span style="color:#888">η<sub>BSE</sub> is the fraction of <i>electrons</i> that leave the sample backwards; the PSF's η is the ratio of <i>energy</i> deposited in the resist by the halo to the forward part — different quantities (η > η<sub>BSE</sub>: backscattered electrons are slower, so they lose more energy per nm, and they cross the resist at oblique angles). Fits are least squares on the cumulative energy, so β and η carry the right share of the halo energy.</span>`;
  }

  // session: the curves kept for comparison
  const getSession = () => ({ compare: compare.map((c) => ({ r: Array.from(c.psf.r), f: Array.from(c.psf.f), label: c.label })) });
  function setSession(o) {
    compare.length = 0;
    for (const c of (o && o.compare) || []) if (c.r?.length) compare.push({ psf: makePSF({ r: c.r, f: c.f }), label: c.label || 'kept' });
  }
  return { show: () => { syncFields(); render(); traj.draw(); }, render, current: () => current, getSession, setSession };
}
