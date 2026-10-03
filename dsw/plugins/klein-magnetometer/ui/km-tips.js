// km-tips.js — physics + use tooltips for every control of the Klein
// Magnetometer Workbench panel, with the equations as native MathML.
//
// Text is written with \( … \) (inline) and \[ … \] (display) maths in a small
// TeX-like syntax that tex2mml() below turns into MathML Core (rendered by the
// browser itself, no library): _ ^ {} \frac{}{} \sqrt{} \text{} \left( \right)
// \bar{} \langle \rangle \, and plain Unicode for Greek and symbols. A run of
// ASCII letters is ONE identifier (multi-letter identifiers render upright, so
// exp, ln, tr, F, cos come out right); separate factors with a space.
//
// Keys: a CONTROLS key (row of the left column), an element id (toolbar, top
// bar, exports), 'tab:<name>' for the tabs, 'heldRemove'. KMTip.audit() lists
// every visible interactive element without a tip (used by the panel probe).
'use strict';
(function () {

// ---------------------------------------------------------------- TeX -> MathML
const ESC = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const OPCH = '+-−=<>≤≥≈≃∼∝±∓×·/()[]|,;:!→←↔⇒∞∑∫∂′…%⟨⟩≪≫∈∉⊥∥';
function tex2mml(src, display) {
  let i = 0, bad = false;
  const err = s => { bad = true; return `<merror><mtext>${ESC(s)}</mtext></merror>`; };
  const skip = () => { while (src[i] === ' ') i++; };
  function readBrace() { // raw text of {...}
    skip(); if (src[i] !== '{') return null;
    let depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    const s = src.slice(i + 1, j); i = j + 1; return s;
  }
  function arg() { skip(); if (src[i] === '{') { i++; return '<mrow>' + seq('}') + '</mrow>'; } const a = atom(); return a === null ? err('missing argument') : a; }
  function command() {
    i++; // backslash
    if (src[i] === ',') { i++; return '<mspace width="0.17em"></mspace>'; }
    if (src[i] === ' ') { i++; return '<mspace width="0.3em"></mspace>'; }
    if (src[i] === '{' || src[i] === '}') { return `<mo>${src[i++]}</mo>`; }
    let name = ''; while (/[A-Za-z]/.test(src[i] || '')) name += src[i++];
    switch (name) {
      case 'frac': { const a = arg(), b = arg(); return `<mfrac>${a}${b}</mfrac>`; }
      case 'sqrt': return `<msqrt>${arg()}</msqrt>`;
      case 'text': { const t = readBrace(); return t === null ? err('\\text') : `<mtext>${ESC(t)}</mtext>`; }
      case 'op': { const t = readBrace(); return t === null ? err('\\op') : `<mi>${ESC(t)}</mi>`; }
      case 'bar': return `<mover accent="true">${arg()}<mo>¯</mo></mover>`;
      case 'langle': return '<mo>⟨</mo>';
      case 'rangle': return '<mo>⟩</mo>';
      case 'left': case 'right': { skip(); const c = src[i++]; return c === '.' ? '' : `<mo stretchy="true">${ESC(c)}</mo>`; }
      case 'quad': return '<mspace width="1em"></mspace>';
      case 'int': return '<mo>∫</mo>';
      case 'sin': case 'cos': case 'tan': case 'tanh': case 'exp': case 'ln': case 'log': case 'erf': case 'arctan':
        return `<mi>${name}</mi><mo>&#x2061;</mo>`;   // function name + invisible function application
      default: return err('\\' + name);
    }
  }
  function atom() {
    skip(); if (i >= src.length) return null;
    const c = src[i];
    if (c === '{') { i++; return '<mrow>' + seq('}') + '</mrow>'; }
    if (c === '}') return null;
    if (c === '\\') return command();
    if (/[0-9.]/.test(c)) { let s = ''; while (/[0-9.]/.test(src[i] || '')) s += src[i++]; return `<mn>${s}</mn>`; }
    if (/[A-Za-z]/.test(c)) { let s = ''; while (/[A-Za-z]/.test(src[i] || '')) s += src[i++]; return `<mi>${s}</mi>`; }
    i++;
    if (c === '-') return '<mo>−</mo>';
    if (OPCH.includes(c)) return `<mo>${ESC(c)}</mo>`;
    return `<mi>${ESC(c)}</mi>`;
  }
  function seq(stop) {
    let out = '';
    for (;;) {
      skip();
      if (i >= src.length) { if (stop) out += err('unclosed {'); break; }
      if (stop && src[i] === stop) { i++; break; }
      let base = atom(); if (base === null) { out += err('unexpected ' + src[i]); i++; continue; }
      let sub = null, sup = null;
      for (;;) { skip(); if (src[i] === '_' && sub === null) { i++; sub = arg(); } else if (src[i] === '^' && sup === null) { i++; sup = arg(); } else break; }
      if (sub && sup) base = `<msubsup>${base}${sub}${sup}</msubsup>`;
      else if (sub) base = `<msub>${base}${sub}</msub>`;
      else if (sup) base = `<msup>${base}${sup}</msup>`;
      out += base;
    }
    return out;
  }
  const body = seq(null);
  const m = `<math${display ? ' display="block"' : ''}><mrow>${body}</mrow></math>`;
  return bad ? m.replace('<math', '<math data-bad="1"') : m;
}
// text with \( \) and \[ \] -> HTML with MathML
function md(s) {
  return s.replace(/\\\[([\s\S]*?)\\\]/g, (_, t) => tex2mml(t.trim(), true))
          .replace(/\\\(([\s\S]*?)\\\)/g, (_, t) => tex2mml(t.trim(), false));
}

// ---------------------------------------------------------------- the tips
// p = physics, u = use, h = heading (controls take their label from CONTROLS).
const R = String.raw;
const TIPS = {
// ---- Geometry
nCells: {p: R`N alternating n and p regions make \(N − 1\) p–n junctions. Each junction transmits carriers near normal incidence (Klein tunnelling: chirality forbids back-scattering at \(θ = 0\)) and reflects oblique ones, so the train is a stack of angular filters. A field rotates the momentum between junctions, carrying carriers out of the acceptance cone, so \(R\) rises with \(|B|\).`,
  u: R`More cells sharpen the field response but lower \(T(0)\) and lengthen the device; keep \(L_{tot} ≪ ℓ_{tr}\). Cell 0 is n-type. Typical 8–40.`},
Ln_um: {p: R`Between two junctions a carrier moves on a cyclotron arc, so its direction turns by\[Δφ = \frac{L}{R_{c}} = \frac{e B L}{ħ k_{F}}\]per cell: about 2.5° at 10 mT for \(L = 0.5\) µm and \(n = 10^{12}\) cm⁻².`,
  u: R`Longer cells give more rotation per cell (more sensitivity per junction) but add to \(L_{tot}\), which must stay well below the mean free path.`},
Lp_um: {p: R`Same as the n cells, at the hole density: \(Δφ = L_{p}/R_{c,p}\) with \(R_{c,p} = ħ k_{F,p}/(e B)\). Holes circulate in the opposite sense to electrons.`,
  u: R`Usually equal to the n length. Unequal lengths break the n/p symmetry of the deflection.`},
W_um: {p: R`The width sets the number of transverse modes that carry current,\[M = \left⌊ \frac{k_{F} W}{π} \right⌋, \quad G = \frac{4 e^{2}}{h} M \langle T \rangle\](factor 4: spin × valley). \(R_{0} ∝ 1/W\); the edges matter less as \(W\) grows past \(R_{c}\) and the cell length.`,
  u: R`Wider strips lower \(R_{0}\) (and so the Johnson noise) and dilute edge effects. About 560 modes at 10 µm and \(10^{12}\) cm⁻².`},
skewDeg: {p: R`Rotates every junction line by \(α\). The field-induced rotation then adds to the tilt on one field sign and subtracts on the other, so \(R(B) ≠ R(−B)\): an odd part appears and \(dR/dB ≠ 0\) at \(B = 0\).`,
  u: R`5–15° gives a linear zero-field operating point (no flank bias needed). Keep 0 for the symmetric, even-in-\(B\) device.`},
// ---- Carriers & junction profile
nN_cm2: {p: R`Sets the Fermi wavevector, energy and wavelength of the n cells,\[k_{F} = \sqrt{π n}, \quad E_{F} = ħ v_{F} k_{F}, \quad λ_{F} = \frac{2π}{k_{F}}\]and through \(k_{F}\) the cyclotron radius \(R_{c} = ħ k_{F}/(e B)\) and the smoothness \(k_{F} d\).`,
  u: R`Typical \(10^{11}\)–\(5·10^{12}\) cm⁻². Higher density stiffens the trajectories (larger \(R_{c}\)) and narrows the junction acceptance cone.`},
nP_cm2: {p: R`Hole density magnitude in the p cells. \(k_{y}\) is conserved at a junction, \(k_{n} \sin θ_{n} = k_{p} \sin θ_{p}\), with the band sign reversing the direction: negative (Veselago) refraction. Unequal densities change the refraction index \(−k_{p}/k_{n}\) and allow total internal reflection on the dense side.`,
  u: R`Equal to the n density for a symmetric n–p–n train; detune it to study asymmetric junctions.`},
unipolar: {p: R`Makes the "p" cells electron-like at the \(|p|\) density, turning every junction into an n–n′ step. There is no pseudospin mismatch, so no Klein filtering: smooth n–n′ junctions transmit almost every angle that is not totally internally reflected. With equal densities the junctions disappear altogether.`,
  u: R`The decisive control: same geometry and refraction, no collimation. A real Klein magnetometer must beat this device.`},
profile: {p: R`Shape of \(k(x)\) across a junction. All profiles share the same maximum gradient \(|dk/dx|_{max} = Δk/d\) with \(Δk = k_{n} + k_{p}\):<br>gate: \(k = k_{0} + \frac{Δk}{π} \arctan(x/h)\), \(h = d/π\) (field under a top-gate edge at height \(h\));<br>tanh: \(k = k_{0} + \frac{Δk}{2} \tanh(2x/d)\); erf: \(k = k_{0} + \frac{Δk}{2} \erf(\sqrt{π} x/d)\); linear: a ramp of width \(d\). Here \(k\) is signed (negative for holes) and \(k_{0}\) is the mean of the two sides.<br>\(T(k_{y})\) is found by integrating the Dirac equation exactly; "asymptotic" uses the Cheianov–Fal'ko form\[T = \exp\left(− \frac{π k_{y}^{2}}{|dk/dx|}\right)\]`,
  u: R`gate is the realistic default. The asymptotic formula is 1 % accurate only for \(k_{F} d ≳ 20\); at \(k_{F} d ≈ 2\) the profiles differ strongly (compare them on the Junction T(θ) tab).`},
d_nm: {p: R`Junction width, defined by the maximum gradient. For a symmetric junction the asymptotic transmission is\[T(θ) ≈ \exp\left(− \frac{π}{2} k_{F} d \sin^{2}θ\right)\]so the acceptance cone narrows as \((k_{F} d)^{-1/2}\). A sharp step (\(d → 0\)) gives \(T = \cos^{2}θ\); \(T(0) = 1\) always.`,
  u: R`Larger \(d\) collimates harder (more field sensitivity) but lowers the angle-averaged \(T(0)\). Gate profile: gate height \(h = d/π\).`},
vF: {p: R`Dirac velocity: \(E = ħ v_{F} |k|\). It sets energy scales (\(E_{F}\), the thermal shift of \(k\) at each energy node, the Fabry–Pérot spacing) but not the orbits: \(R_{c} = ħ k_{F}/(e B)\) does not contain \(v_{F}\).`,
  u: R`\(1.0·10^{6}\) m/s is standard; hBN-encapsulated graphene measures about \(1.1·10^{6}\).`},
// ---- Junction disorder
sigmaPos_nm: {p: R`Each junction is displaced along \(x\) by \(σ ξ\) with \(ξ\) a standard normal, frozen per disorder seed. Cell lengths, and so the rotation per cell \(L/R_{c}\), then vary along the train.`,
  u: R`Lithographic placement error of the gates. Compare with the cell length; tens of nm is realistic.`},
sigmaWidth: {p: R`Each junction width becomes \(d_{j} = d (1 + σ ξ)\) (floored at \(0.05 d\)), so every junction has its own acceptance cone.`,
  u: R`Relative spread, e.g. 0.2 for ±20 % variation of the gate–graphene distance.`},
sigmaDensity: {p: R`Each cell density becomes \(n_{j} = n (1 + σ ξ)\) (floored at \(0.05 n\)), shifting \(k_{F}\) cell by cell: refraction and the acceptance cone then vary between junctions.`,
  u: R`Charge puddles and gate-voltage inhomogeneity; a few per cent is realistic.`},
sigmaTiltDeg: {p: R`Junction-line roughness: at EVERY crossing the local junction normal is rotated by a fresh random angle of rms \(σ\), broadening the effective acceptance cone.`,
  u: R`A few degrees mimics a rough gate edge.`},
disorderSeed: {p: R`Selects which frozen realisation of the four disorder draws is used. The same seed gives the same device.`,
  u: R`Sweep it (Sweep tab) for ensemble statistics of a disordered device.`},
// ---- Edges & injection
edge: {p: R`Boundary condition at \(y = 0\) and \(y = W\). specular: mirror reflection (\(k_{x}\) kept, \(k_{y} → −k_{y}\)); diffuse: specular with probability \(p\), otherwise re-emitted with a Lambertian \(\cos θ\) distribution (rough edge); absorbing: the carrier is lost (grounded side contacts) and counts as not transmitted.`,
  u: R`Etched graphene edges are rough: diffuse with \(p ≈ 0\)–0.5 is a realistic pessimistic case.`},
specularity: {p: R`Probability \(p\) that an edge reflection is specular; with \(1 − p\) the direction is redrawn from \(P(θ) ∝ \cos θ\) about the edge normal.`,
  u: R`Only active with diffuse edges.`},
injection: {p: R`How carriers enter at \(x = 0\). cosine: the Landauer flux distribution \(P(θ) = \frac{1}{2} \cos θ\) over the full width, equivalent to equal occupation of every transverse mode; aperture: the same through a centred opening; collimated: a Gaussian beam of angular width \(σ\).`,
  u: R`cosine for a normal two-terminal device. The other two are for probing the angular filter directly.`},
apertureFrac: {p: R`Opening width \(w\) as a fraction of \(W\); the mode count of the source becomes \(M = ⌊k_{F} w/π⌋\).`,
  u: R`Only with aperture injection.`},
collimSigmaDeg: {p: R`Angular standard deviation of a collimated source, \(P(θ) ∝ \exp(−θ^{2}/2σ^{2})\).`,
  u: R`Only with collimated injection. Small \(σ\) isolates near-normal transmission.`},
leftContactFrac: {p: R`Length of the source contact on the left end wall, centred. Outside it the wall reflects specularly and carriers are injected (\(\cos θ\)) only through the contact. A narrow source behaves as a point source: an n–p interface focuses it (Veselago lens) at \(b = a k_{p}/k_{n}\).`,
  u: R`1 = full-width contact (the normal device). Small values with the Density map visualise lensing.`},
rightContactFrac: {p: R`Length of the drain contact on the right end wall, centred. Carriers hitting the wall outside it are specularly reflected back into the device.`,
  u: R`1 = full-width drain. A narrow drain at the focus is a magnetic-focusing / lensing detector.`},
// ---- Scattering & temperature
mfp_um: {p: R`Mean distance between scattering EVENTS, \(ℓ_{e}\); free paths are drawn from \(P(l) ∝ e^{−l/ℓ_{e}}\). Momentum is relaxed only by \(1 − \langle\cos φ\rangle\) per event, so the transport length is\[ℓ_{tr} = \frac{ℓ_{e}}{1 − \langle\cos φ\rangle}\]equal to \(ℓ_{e}\) for isotropic scattering and \(≈ 66 ℓ_{e}\) for forward kicks with \(σ = 10°\).`,
  u: R`0 = ballistic. Easiest: type a measured mobility in the box below. The device should satisfy \(L_{tot} ≪ ℓ_{tr}\).`},
_mu: {p: R`Mobility measures the transport length:\[ℓ_{tr} = \frac{μ ħ k_{F}}{e}\]about 1.2 µm per \(10^{5}\) cm²/Vs at \(10^{12}\) cm⁻². The panel converts it to the event length for the chosen scattering model.`,
  u: R`Local helper, not sent to the core. While > 0 it keeps the event length consistent when the density or scattering model changes; typing an event length releases it.`},
scatter: {p: R`Angular character of each scattering event. drude: isotropic, a new direction uniform in \([0, 2π)\); forward: a small Gaussian kick \(φ → φ + σ ξ\) (long-range charged impurities, ripples); none: no impurity scattering.`,
  u: R`forward is typical for clean encapsulated graphene. For a fixed mobility, forward scattering keeps the beam collimated over much longer distances.`},
forwardSigmaDeg: {p: R`RMS kick angle per forward event. Momentum relaxation per event is \(1 − e^{−σ^{2}/2}\).`,
  u: R`Only with forward scattering. 5–15° is typical.`},
mfpPh300_um: {p: R`Acoustic-phonon mean free path at 300 K, scaled as \(ℓ_{ph}(T) = ℓ_{ph,300} · 300\,\text{K}/T\) (resistivity \(∝ T\) above the Bloch–Grüneisen temperature) and combined by Matthiessen's rule,\[\frac{1}{ℓ} = \frac{1}{ℓ_{imp}} + \frac{1}{ℓ_{ph}(T)}\]Phonon events use the selected scattering model.`,
  u: R`0 = off. A few µm at 300 K is a realistic graphene value.`},
tempK: {p: R`Device temperature. It scales phonon scattering and, with more than one energy node, sets the Fermi window \(−∂f/∂E\) (FWHM \(≈ 3.5 k_{B}T\); \(k_{B}T = 1.7\) meV at 20 K). It is also the Johnson-noise temperature unless that is set separately.`,
  u: R`With one energy node only the phonon and noise terms feel \(T\). Raise the energy nodes above about 20 K.`},
eeMfp_um: {p: R`Electron–electron scattering conserves total momentum, so it does not add resistance, but it spreads the angular distribution of an injected beam. Modelled as small speed-conserving angular kicks with mean spacing \(ℓ_{ee}\), not counted in the mean free path.`,
  u: R`0 = off. Important at elevated temperature (\(ℓ_{ee}\) falls roughly as \(T^{-2}\)); sweep it to see collimation wash out.`},
eeSigmaDeg: {p: R`RMS angular kick per e–e event.`,
  u: R`Only when the e–e length is set.`},
// ---- Field grid
bMin_mT: {p: R`Lower end of the field grid. The orbit radius at the window edge, \(R_{c} = ħ k_{F}/(e |B|)\), is shown in Derived quantities.`,
  u: R`Make the window wide enough that the steepest slope lies inside it (the curve flags warn otherwise).`},
bMax_mT: {p: R`Upper end of the field grid. For a symmetric device \(R(B)\) is even, so a symmetric window is natural.`,
  u: R`See B min.`},
bN: {p: R`Number of field values, spacing \(δB = (B_{max} − B_{min})/(N_{B} − 1)\). The slope \(dR/dB\) is taken from local fits over these points.`,
  u: R`Use an odd number so \(B = 0\) is on the grid. Cost is linear in the number of points.`},
// ---- Statistics & engine
engine: {p: R`Monte Carlo: each trajectory is accepted or reflected at a junction with probability \(T(k_{y})\); \(T\) is the transmitted fraction. Flux: rays split into weights \(T\) and \(1 − T\) at every junction, light branches play Russian roulette; unbiased, but an independent cross-check rather than a faster method.`,
  u: R`Use Monte Carlo for production; run flux occasionally to confirm a result.`},
nTraj: {p: R`Trajectories per field point (and per energy node). The binomial error is\[σ_{T} = \sqrt{\frac{T (1 − T)}{N}}\]Trajectory \(i\) reuses the same random stream at every field (common random numbers), so the field DEPENDENCE is much smoother than \(σ_{T}\) suggests.`,
  u: R`10⁴ for a quick look, 10⁵–10⁶ for derivative metrics (slope, \(B_{min}\)). Cost is linear.`},
seed: {p: R`Seed of the random streams. A different seed gives an independent statistical sample of the same physics.`,
  u: R`Change it to check that a feature is not Monte-Carlo noise.`},
nEnergy: {p: R`Quadrature nodes for the thermal average\[G(T) = \int G(E) \left(− \frac{∂f}{∂E}\right) dE\]At each node \(k\) shifts up in n cells and down in p cells by \(ε/(ħ v_{F})\), and the mode count changes with it.`,
  u: R`1 = zero-temperature limit, fine below about 20 K. Use 5–9 at 77–300 K. Cost is linear.`},
fluxNY: {p: R`Injection-position nodes across the source for the flux quadrature.`, u: R`Flux engine only.`},
fluxNS: {p: R`Injection-angle nodes, uniform in \(\sin θ\), which makes the \(\cos θ\) weighting of the Landauer distribution exact.`, u: R`Flux engine only. Odd numbers include normal incidence.`},
fluxJitter: {p: R`Places each quadrature node randomly within its cell (stratified sampling), which removes grid aliasing with the periodic junction train.`, u: R`Flux engine only. Keep on.`},
fluxThreshold: {p: R`A branch of weight \(w\) below the threshold \(w_{th}\) survives with probability \(w/w_{th}\) and carries weight \(w_{th}\) if it does, so the expected weight is unchanged (Russian roulette): nothing is discarded and the estimate stays unbiased.`,
  u: R`Flux engine only. Smaller = less noise, more traced rays.`},
maxPathFactor: {p: R`Trajectories longer than this multiple of \(L_{tot}\) are stopped and counted as NOT transmitted. Grazing carriers can bounce between junctions for a very long time, so a short cap biases \(T\) low and the magnetoresistance high (cap 6 overstates MR(20 mT) 3.6× on the first-simulation device).`,
  u: R`≥ 100 is converged for typical devices. The curve flags warn when capped carriers are not negligible next to \(T\).`},
threads: {p: R`OpenMP threads used by the native core. Results do not depend on it.`, u: R`0 = all cores.`},
// ---- Readout & noise
biasA_uA: {p: R`Readout current \(I\). The field signal is \(I\,dR/dB\) and the noise is\[S_{V} = 4 k_{B} T R + 2 e I R^{2} + \frac{α_{H} (I R)^{2}}{N_{c} f}\](shot noise taken with Fano factor 1, an upper bound). The flank resolution \(B_{min} = \sqrt{S_{V}}/(I |dR/dB|)\) improves with \(I\) until shot noise dominates, above \(I^{*} = 2 k_{B} T/(e R)\).`,
  u: R`Joule heating is NOT modelled; keep the power \(I^{2}R\) realistic (shown in the noise budget).`},
noiseTempK: {p: R`Electron temperature in the Johnson term \(4 k_{B} T R\).`,
  u: R`0 = use the device temperature, so a temperature sweep also moves the noise.`},
hooge: {p: R`1/f noise by Hooge's law,\[\frac{S_{V}}{V^{2}} = \frac{α_{H}}{N_{c} f}\]with \(N_{c}\) the number of carriers in the channel (sum of density × area over the cells).`,
  u: R`0 = off. Reported graphene values range from about \(10^{-4}\) to \(10^{-2}\) depending on quality.`},
freqHz: {p: R`Frequency \(f\) at which the 1/f term is evaluated; Johnson and shot noise are white.`,
  u: R`Lock-in or readout frequency. Only matters when the Hooge parameter is > 0.`},
mrField_mT: {p: R`Field \(B^{*}\) at which the magnetoresistance is reported, symmetrised and interpolated:\[\op{MR}(B^{*}) = \frac{\langle R(±B^{*}) \rangle}{R(0)} − 1\]`,
  u: R`A fixed-field MR compares devices fairly; the window-depth MR is dominated by the tails.`},
fitWindow_mT: {p: R`Weighted least-squares fit of the even parabola \(R = R_{0} + a B^{2}\) over \(|B| ≤ w\); gives \(R_{0}\), the curvature \(a/R_{0}\) and the vertex resolution \(B_{min} = \sqrt{δR/a}\) with \(δR = \sqrt{S_{V}}/I\) in 1 Hz.`,
  u: R`0 = a third of the field window. Keep it inside the region where \(R(B)\) really is parabolic.`},
sgHalf: {p: R`\(dR/dB\) at each point comes from a local quadratic least-squares fit over \(2n + 1\) points (Savitzky–Golay derivative).`,
  u: R`Larger \(n\) averages Monte-Carlo noise but smooths sharp features; 2–3 for dense grids.`},
// ---- Coherent sidebar
eRange_meV: {p: R`The coherent calculation keeps the phase: a transfer matrix through the whole junction stack at each \(k_{y}\), versus energy. Each cell is a Fabry–Pérot cavity with resonance spacing\[ΔE = \frac{π ħ v_{F}}{L} ≈ \frac{2.07\,\text{meV}}{L/\text{µm}}\]The thermal smoothing kernel must fit inside \(E_{F} ±\) this range.`,
  u: R`Widen it if the visibility table shows "—" at the higher temperatures.`},
eN: {p: R`Number of energies across the range. The spacing must be well below the Fabry–Pérot period \(ΔE\).`, u: R`251 resolves a 0.5 µm cell over ±25 meV comfortably.`},
kyN: {p: R`Quadrature points over the transverse momentum for the mode average. The phase across a cell varies as \(k_{x} L\), so sampling must resolve it: the core uses at least about \(1.5 k_{F} L_{max}\) points.`,
  u: R`Raise it for long cells or high density.`},

// ---- top bar, presets, files
runCurve: {h: 'Run R(B)', p: R`Computes the transmission per mode at every field of the grid and the two-terminal resistance\[R(B) = \left(\frac{4 e^{2}}{h} M \langle T(B) \rangle\right)^{-1}\]plus the figures of merit (MR, slope, noise-limited \(B_{min}\)).`, u: R`Results appear on the R(B), Transmission and Sensitivity tabs.`},
stopBtn: {h: 'Stop', u: R`Stops the running job (curve, sweep, grid, coherent or density). Points already finished are kept.`},
themeBtn: {h: 'Light / dark', u: R`Switches the colour theme of the panel and the device view.`},
preset: {h: 'Presets', p: R`Ready-made devices: the default gate-profile train; the June-report optimum (asymptotic T, short path cap, as published then); the first simulation; the unipolar control (no Klein filtering); skewed junctions (odd response); disordered junctions; a short mean free path (should fail); rough diffuse edges; 77 K with phonons and thermal smearing.`,
  u: R`A preset resets every control to the default and then applies its own values.`},
saveCfg: {h: 'Save settings', u: R`Downloads all control values and the tab settings as JSON.`},
loadCfg: {h: 'Load settings', u: R`Loads a settings JSON (also accepts a result JSON: its parameters are used).`},
expJson: {h: 'Result JSON', u: R`The last result message exactly as the core sent it, including every parameter, for reproducibility.`},
expCsv: {h: 'Curve CSV', u: R`The last R(B) curve point by point: \(T\), \(σ_{T}\), \(R\), \(σ_{R}\), \(G\), \(dR/dB\), carrier fates, mean path. The header carries the parameters.`},
expSweepCsv: {h: 'Sweep / grid CSV', u: R`All figures of merit of the last sweep (or 2-D grid) as CSV.`},
expPng: {h: 'Chart PNG', u: R`The chart on the visible tab as a PNG image.`},
copyMethods: {h: 'Copy methods text', u: R`Copies the generated methods paragraph, written from the parameters of the last run.`},
methods: {h: 'Methods text', u: R`A methods paragraph generated from the last run's parameters (profile, engine, statistics, noise model). Edit after pasting.`},
heldRemove: {h: 'Remove held curve', u: R`Removes this curve from the R(B) overlay.`},

// ---- tabs
'tab:device': {h: 'Device tab', p: R`The strip with its true aspect ratio: n cells blue, p cells orange, junction lines, and sample trajectories on exact cyclotron arcs coloured by their fate.`, u: R`Shows WHY the resistance changes: watch carriers reflect as the field grows.`},
'tab:rb': {h: 'R(B) tab', p: R`Resistance versus field with ±1σ Monte-Carlo errors and the even-parabola fits.`, u: R`Hold curves to compare devices; use R/R0 to compare shapes.`},
'tab:fates': {h: 'Transmission & fates tab', p: R`\(T(B)\) per mode, and where the rest went: reflected to the source, absorbed at edges, or stopped by the path cap.`, u: R`Check the path-cap fraction is negligible before trusting a curve.`},
'tab:sens': {h: 'Sensitivity & noise tab', p: R`Normalised slope \((dR/dB)/R_{0}\) and the noise budget at the steepest point, giving the field resolution in nT/√Hz.`, u: R`Noise inputs are in "Readout & noise".`},
'tab:sweep': {h: 'Sweep tab', p: R`Runs a full R(B) curve at each value of one parameter.`, u: R`Family view for shapes, metric view for trends, table for numbers.`},
'tab:grid': {h: 'Optimise (2-D grid) tab', p: R`Full R(B) curves over a grid of two parameters, coloured by a figure of merit, with constraints masking impractical devices.`, u: R`Find the best device, then confirm it with a high-statistics R(B) run.`},
'tab:angular': {h: 'Junction T(θ) tab', p: R`Single-junction transmission versus incidence angle at the n density for all five profiles at the current \(d\): the angular filter itself.`, u: R`Recomputed automatically while the tab is open.`},
'tab:coherent': {h: 'Coherent (Fabry–Pérot) tab', p: R`Fully phase-coherent transmission of the junction train at \(B = 0\) versus energy, compared with the incoherent ray model, and the Fabry–Pérot visibility after thermal smoothing.`, u: R`Justifies the incoherent ray model: at the operating temperature the oscillations should average out.`},

// ---- Device toolbar
tbPB: {h: 'Sample paths at B', p: R`Field for the drawn trajectories. Orbit radius \(R_{c} = ħ k_{F}/(e |B|)\); the field and cell length set the rotation per cell.`, u: R`Positive and negative fields bend in opposite senses; the skew makes them differ.`},
tbPN: {h: 'Number of sample trajectories', u: R`Trajectories drawn on the device view. Drawing only: no effect on the computed curves.`},
tbTrace: {h: 'Trace', u: R`Traces the sample trajectories now with the current settings.`},
tbDensity: {h: 'Density map', p: R`Traces 200 000 trajectories at this field and accumulates the path length per pixel: a map of where the current flows. Reports the source-to-drain \(T\).`, u: R`Combine with narrow contacts to see Veselago focusing.`},
tbFirst: {h: 'First flight', p: R`Deposits path only until the first reflection at an edge or end wall: the classic ray-optics picture of the beam, without the multiply reflected background.`, u: R`For the Density map.`},
tbClearPaths: {h: 'Clear', u: R`Removes the drawn trajectories / density map.`},
tbAuto: {h: 'Retrace on change', u: R`Redraws sample trajectories automatically whenever a control changes.`},
// ---- R(B) toolbar
tbRBMode: {h: 'Show', p: R`\(R\) in Ω; \(R/R_{0}\) (shape, comparable across devices); \(G = \frac{4 e^{2}}{h} M \langle T \rangle\) in mS; or \(T\) per mode, independent of the mode count.`, u: R`Use R/R0 with held curves.`},
tbFit: {h: 'Parabola fits', p: R`Overlays the global even parabola over the whole window and the local fit \(R_{0} + a B^{2}\) over the fit window.`, u: R`A local fit that bends away from the data means the fit window is too wide.`},
tbErr: {h: 'Error bars', p: R`±1σ statistical errors from the binomial Monte-Carlo variance, propagated to \(R\) and \(G\).`, u: R`Neighbouring points are correlated (common random numbers), so the curve is smoother than the bars suggest.`},
tbHold: {h: 'Hold curve', u: R`Keeps the current curve on the chart for comparison (up to 7).`},
tbClearHeld: {h: 'Clear held', u: R`Removes all held curves.`},
// ---- fates toolbar
tbFates: {h: 'Lower panel', p: R`Carrier fates (transmitted, reflected, absorbed, path cap); mean path length; fraction that touched an edge; junction crossings per carrier (more than \(N − 1\) means multiple reflections).`, u: R`Diagnoses where the field-dependence comes from.`},
// ---- sweep toolbar
tbSP: {h: 'Sweep parameter', u: R`The parameter varied. "both cell lengths" and "both densities" move the n and p values together. Choosing it proposes half to twice the current value.`},
tbSF: {h: 'From', u: R`First value of the sweep.`},
tbST: {h: 'To', u: R`Last value of the sweep.`},
tbSN: {h: 'Points', u: R`Number of sweep values; each is a full R(B) curve, so cost is linear.`},
tbSL: {h: 'Log spacing', u: R`Geometric instead of linear spacing; needs positive limits. Natural for mean free path, density and trajectories.`},
tbSRun: {h: 'Run sweep', u: R`Runs the sweep with the current settings for everything else.`},
tbSV: {h: 'Sweep view', u: R`R/R0 family (light → dark = increasing parameter), one metric versus the parameter, or the full table of metrics.`},
tbSM: {h: 'Metric', p: R`The figure of merit plotted versus the parameter: MR at a fixed field, peak slope \(|dR/dB|/R_{0}\), the noise-limited resolutions, \(T(0)\), \(R_{0}\), FWHM, curvature.`, u: R`Hover the table header for each definition.`},
tbSLy: {h: 'Log y', u: R`Logarithmic metric axis.`},
// ---- grid toolbar
tbGP: {h: 'Grid x parameter', u: R`First optimisation parameter (columns).`},
tbGF: {h: 'x from', u: R`First x value.`}, tbGT: {h: 'x to', u: R`Last x value.`}, tbGN: {h: 'x points', u: R`Number of x values.`}, tbGL: {h: 'x log', u: R`Geometric spacing in x.`},
tbGP2: {h: 'Grid y parameter', u: R`Second optimisation parameter (rows).`},
tbGF2: {h: 'y from', u: R`First y value.`}, tbGT2: {h: 'y to', u: R`Last y value.`}, tbGN2: {h: 'y points', u: R`Number of y values. The grid costs x points × y points full curves.`}, tbGL2: {h: 'y log', u: R`Geometric spacing in y.`},
tbGRun: {h: 'Run grid', u: R`Computes a full R(B) curve for every grid cell.`},
tbGM: {h: 'Figure of merit', p: R`The quantity optimised (↑ higher is better, ↓ lower is better). The flank resolution \(B_{min} = \sqrt{S_{V}}/(I |dR/dB|)\) is the physically complete one: it combines slope, resistance and noise.`, u: R`Changing it re-evaluates the existing grid; no rerun needed.`},
tbGLZ: {h: 'Log colour', u: R`Logarithmic colour scale, for metrics spanning decades.`},
tbC1: {h: 'Constraint T(0) ≥', p: R`A device with tiny zero-field transmission has a huge \(R_{0}\) and is impractical (and noisy).`, u: R`Cells failing it are hatched and cannot be the best device.`},
tbC2: {h: 'Constraint L_tot ≤', u: R`Maximum total device length in µm (0 = no limit), e.g. the size of the clean hBN area.`},
tbC3: {h: 'Constraint L_tot/ℓ ≤', p: R`Ballisticity: the semiclassical collimation picture needs \(L_{tot} ≪ ℓ\).`, u: R`0 = no limit.`},
tbApply: {h: 'Apply best', u: R`Sets the controls to the best admissible device of the grid.`},
tbRefine: {h: 'Refine around best', u: R`Re-runs a finer grid spanning the neighbours of the best cell.`},
// ---- angular toolbar
tbAS: {h: 'Series product', p: R`Plots \(T(θ)^{N−1}\): the transmission of the whole train if every junction saw the same angle. A crude upper picture: it ignores refraction, field and multiple reflections.`, u: R`Shows how the filters compound.`},
tbALog: {h: 'Log y', u: R`Logarithmic transmission axis, to see the exponential tails.`},
tbARun: {h: 'Recompute', u: R`Recomputes the angular transmission for all profiles.`},
// ---- coherent toolbar
tbCRun: {h: 'Run coherent calculation', p: R`Transfer matrix through the full stack at each \(k_{y}\) and energy, mode-averaged, at \(B = 0\), compared with the incoherent ray model for the same problem.`, u: R`Energy range and grids are in "Coherent sidebar".`},
tbCV: {h: 'Coherent view', p: R`\(T(E)\) coherent versus incoherent, or the coherent curve convolved with \(−∂f/∂E\) at several temperatures.`, u: R`Visibility per temperature is in the table below.`},
};

// ---------------------------------------------------------------- resolution
function controlsTable() { return (window.__KM && window.__KM.CONTROLS) || []; }
function keyFor(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.dataset && n.dataset.kt) return n.dataset.kt;
    if (n.classList && n.classList.contains('tab') && n.dataset.tab) return 'tab:' + n.dataset.tab;
    if (n.closest && n.closest('#heldList') && n.tagName === 'BUTTON') return 'heldRemove';
    if (n.id) {
      if (n.id.startsWith('row_')) return n.id.slice(4);
      if (n.id.startsWith('c_')) return n.id.slice(2);
      if (TIPS[n.id]) return n.id;
    }
    if (n.tagName === 'LABEL') {
      const f = n.getAttribute('for'); if (f && f.startsWith('c_')) return f.slice(2);
      const inner = n.querySelector('input[id],select[id]'); if (inner && TIPS[inner.id]) return inner.id;
    }
    if (n.classList && (n.classList.contains('toolbar') || n.classList.contains('left') || n.classList.contains('right'))) break;
  }
  return null;
}
function anchorFor(el, key) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.id === 'row_' + key) return n;
    if (n.tagName === 'LABEL' || n.tagName === 'BUTTON' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA' || (n.classList && n.classList.contains('tab'))) return n;
  }
  return el;
}
function html(key) {
  const t = TIPS[key]; if (!t) return null;
  let head = t.h, unit = '', code = '';
  if (!head) { const c = controlsTable().find(c => c.k === key); if (c) { head = c.l; unit = c.u; code = c.local ? 'panel only' : 'configure: ' + key; } else head = key; }
  return `<div class="kt-h">${head}${unit ? ` <span class="kt-u">${unit}</span>` : ''}${code ? `<span class="kt-k">${code}</span>` : ''}</div>` +
    (t.p ? `<div class="kt-s"><span class="kt-l">Physics</span>${md(t.p)}</div>` : '') +
    (t.u ? `<div class="kt-s"><span class="kt-l">Use</span>${md(t.u)}</div>` : '');
}

// ---------------------------------------------------------------- popover
const CSS = `
.kt{position:fixed;z-index:50;max-width:430px;min-width:240px;background:var(--panel);color:var(--fg);border:1px solid var(--accent);border-radius:9px;
  padding:9px 12px 10px;font-size:13px;line-height:1.45;box-shadow:0 10px 28px rgba(0,0,0,.22);pointer-events:none;display:none}
.kt.on{display:block}
.kt-h{font-weight:600;font-size:13.5px;margin-bottom:5px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.kt-u{color:var(--muted);font-weight:400}
.kt-k{margin-left:auto;font:11px Consolas,monospace;color:var(--muted);font-weight:400}
.kt-s{margin-top:5px}
.kt-l{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-right:6px}
.kt math{font-size:1.08em}
.kt math[display="block"]{margin:6px 0 4px;font-size:1.12em}
.kt-hint{font-size:12px;color:var(--muted);padding:6px 12px 0}
`;
let box = null, cur = null, cursorEl = null, timer = 0;
function ensure() {
  if (box) return box;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  box = document.createElement('div'); box.className = 'kt'; box.id = 'ktip'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box);
  return box;
}
function place(anchor) {
  const r = anchor.getBoundingClientRect(), b = box.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, g = 10;
  const inLeft = anchor.closest('.left'), inRight = anchor.closest('.right');
  let x, y;
  const fitsRight = r.right + g + b.width <= vw - 6, fitsLeft = r.left - g - b.width >= 6;
  if (inLeft) { const c = inLeft.getBoundingClientRect(); x = c.right + g; y = r.top + r.height / 2 - b.height / 2; }
  else if (inRight && fitsLeft) { x = r.left - g - b.width; y = r.top + r.height / 2 - b.height / 2; }
  else if (r.bottom + g + b.height <= vh - 6) { x = r.left; y = r.bottom + g; }
  else if (r.top - g - b.height >= 6) { x = r.left; y = r.top - g - b.height; }
  else if (fitsRight) { x = r.right + g; y = r.top; }
  else { x = r.left - g - b.width; y = r.top; }
  x = Math.max(6, Math.min(vw - b.width - 6, x)); y = Math.max(6, Math.min(vh - b.height - 6, y));
  box.style.left = x + 'px'; box.style.top = y + 'px';
}
function show(el) {
  const key = keyFor(el); const h = key && html(key); if (!h) { hide(); return false; }
  ensure(); const anchor = anchorFor(el, key);
  for (let n = el; n && n !== anchor.parentElement; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('title')) { n.dataset.ktTitle = n.getAttribute('title'); n.removeAttribute('title'); }
  box.innerHTML = h; box.classList.add('on'); place(anchor); cur = anchor; return true;
}
function hide() { clearTimeout(timer); if (box) box.classList.remove('on'); cur = null; }
function install() {
  ensure();
  document.addEventListener('mouseover', e => {
    const t = e.target; if (box && box.contains(t)) return;
    const key = keyFor(t); if (!key) { if (cur && !cur.contains(t)) hide(); return; }
    const anchor = anchorFor(t, key); if (anchor === cur) return;
    // strip native titles at once so the browser's own tooltip never doubles ours
    for (let n = t; n && n !== anchor.parentElement; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('title')) { n.dataset.ktTitle = n.getAttribute('title'); n.removeAttribute('title'); }
    clearTimeout(timer); cursorEl = t; timer = setTimeout(() => show(cursorEl), cur ? 60 : 280);
  });
  document.addEventListener('mouseleave', hide);
  document.addEventListener('focusin', e => { if (keyFor(e.target)) show(e.target); });
  document.addEventListener('focusout', () => hide());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  const ctl = document.getElementById('controls');
  if (ctl && !document.getElementById('ktHint')) { const d = document.createElement('div'); d.className = 'kt-hint'; d.id = 'ktHint'; d.textContent = 'Hover or focus any control for its physics and how to use it.'; ctl.parentElement.insertBefore(d, ctl); }
}
// every visible interactive element must resolve to a tip
function audit() {
  const out = [];
  document.querySelectorAll('input,select,button,textarea,.tab').forEach(el => {
    if (el.type === 'file' || el.closest('#ktip')) return;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
    const k = keyFor(el); if (!k || !TIPS[k]) out.push(el.id || el.textContent.trim().slice(0, 30) || el.outerHTML.slice(0, 60));
  });
  return out;
}
window.KMTip = {install, show, hide, html, keyFor, audit, tex2mml, TIPS};
})();
