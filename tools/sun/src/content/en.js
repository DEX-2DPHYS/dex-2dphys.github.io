// English chapter content for the Sun textbook (portal.js renders it). build.js points the alias
// 'sun-content' at this file. Each chapter: crumb, title, lead, facts, sections, figures (sim
// captures + SVG diagrams), optional explore (annotated capture), question, related.
import { mi, frac, gl } from './kit.js';
import { dirLL, SPOTS } from '../spec.js';
import { SSM } from '../model.js';
import { profileChart, massLumChart, gamowChart, planckChart, limbChart, parkerChart, rotationChart, heightChart, butterflyChart, hrChart, ppChainDiagram } from './charts.js';

const eq = (s) => `<div class="eq">${s}</div>`;
const op = (s) => `<span class="op">${s}</span>`;
const sp = (id) => SPOTS.find((s) => s.id === id);
const mid = (a, b, k) => { const m = a.map((x, i) => x + b[i]); const l = Math.hypot(...m); return m.map((x) => x / l * k); };

export const ORDER = ['overview', 'interior', 'core', 'convection', 'photosphere', 'sunspots', 'corona', 'wind'];

export const UI = {
  book: 'The Sun',
  chapter: 'Chapter',
  close: 'Close',
  contents: 'Contents',
  rendering: 'rendering from the model…',
  keyNumbers: 'Key numbers',
  related: 'See also',
  openQuestion: 'Open question',
  bookTitle: (t) => `Read the chapter: ${t}`,
};

// ---------------------------------------------------------------- glossary
export const GLOSSARY = {
  plasma: ['Plasma', 'A gas so hot that electrons are torn from their atoms. It conducts electricity and is pushed around by magnetic fields; almost all of the Sun is plasma.'],
  hse: ['Hydrostatic equilibrium', 'The balance between the weight of overlying layers (gravity pulling in) and the pressure gradient pushing out. It holds at every depth in a stable star.'],
  opacity: ['Opacity κ', 'How strongly matter absorbs or scatters radiation, per unit mass (cm² g⁻¹). The mean free path of a photon is ℓ = 1/(κρ).'],
  mfp: ['Mean free path', 'The average distance a photon (or particle) travels between interactions. In the solar interior it is well under a centimetre.'],
  randomwalk: ['Random walk', 'Motion by steps in random directions. After N steps of length ℓ the typical distance travelled is only ℓ√N, which is why escape from the Sun takes so long.'],
  kh: ['Kelvin–Helmholtz time', 'How long a star could shine on gravitational contraction alone: t ≈ GM²/(RL) ≈ 30 million years for the Sun - far too short, which is how fusion was inferred.'],
  pp: ['pp chain', 'The sequence of reactions that turns four protons into one helium-4 nucleus. It produces about 99 % of the Sun’s energy.'],
  cno: ['CNO cycle', 'A fusion route in which carbon, nitrogen and oxygen act as catalysts for turning hydrogen into helium. About 1 % of the Sun’s power, dominant in stars above ~1.3 M☉.'],
  tunnel: ['Quantum tunnelling', 'A particle crossing an energy barrier it classically could not climb, thanks to its wave nature. Without it the Sun’s core would be far too cool for fusion.'],
  gamow: ['Gamow peak', 'The narrow energy window where most fusion reactions occur: the product of the falling Maxwell–Boltzmann tail and the rising tunnelling probability.'],
  neutrino: ['Neutrino', 'A nearly massless, uncharged particle that interacts only through the weak force. Solar neutrinos leave the core in 2 s and reach Earth 8 minutes later.'],
  oscillation: ['Neutrino oscillation', 'Neutrinos change flavour (e, μ, τ) as they travel. Detectors that saw only electron neutrinos therefore counted a third to a half of the expected flux - the “solar neutrino problem”.'],
  tachocline: ['Tachocline', 'The thin shear layer at the base of the convection zone (≈ 0.7 R☉), where the differentially rotating envelope meets the rigidly rotating interior.'],
  convection: ['Convection', 'Heat transport by bulk motion: hot, buoyant fluid rises, cools and sinks. It takes over where radiation cannot carry the flux with a stable temperature gradient.'],
  schwarzschild: ['Schwarzschild criterion', 'A layer convects if the temperature falls faster with height than an adiabatically rising parcel would cool: ∇_rad > ∇_ad.'],
  adiabatic: ['Adiabatic', 'Without exchange of heat. A rising parcel of gas expands and cools adiabatically.'],
  helioseismology: ['Helioseismology', 'Inferring the Sun’s interior from its millions of acoustic oscillation modes, measured as Doppler shifts and brightness changes at the surface.'],
  pmode: ['p mode', 'A standing sound wave trapped inside the Sun (pressure is the restoring force). They make the surface move up and down with periods around five minutes.'],
  diffrot: ['Differential rotation', 'Different parts rotating at different rates. The solar surface turns in ≈ 25 days at the equator and ≈ 34 days near the poles.'],
  granule: ['Granule', 'A convection cell at the surface, ≈ 1 000–1 500 km across, living 5–10 minutes: bright hot centre (upflow), dark cooler lane (downflow).'],
  supergranule: ['Supergranule', 'A larger flow cell, ≈ 30 000 km across, lasting about a day. Its edges collect magnetic field into the chromospheric network.'],
  tau: ['Optical depth τ', 'The number of photon mean free paths between a point and the observer. We see down to roughly τ ≈ 2/3.'],
  teff: ['Effective temperature', 'The temperature of a black body with the same surface flux: L = 4πR²σT_eff⁴. For the Sun T_eff = 5 772 K.'],
  limb: ['Limb darkening', 'The solar disc is darker at its edge, because there our line of sight reaches only higher, cooler layers.'],
  fraunhofer: ['Fraunhofer lines', 'Dark absorption lines in the solar spectrum, catalogued by Fraunhofer in 1814. They reveal which elements are present and their abundances.'],
  hminus: ['H⁻ ion', 'A hydrogen atom with an extra electron. Its bound–free absorption dominates the visible opacity of the photosphere.'],
  umbra: ['Umbra', 'The dark core of a sunspot: ≈ 4 000 K, with a nearly vertical magnetic field of ≈ 0.3 T.'],
  penumbra: ['Penumbra', 'The filamentary outer part of a sunspot, with weaker, inclined field and the outward Evershed flow.'],
  wilson: ['Wilson depression', 'Sunspot umbrae are seen ≈ 500–1 000 km deeper than the surrounding photosphere, because the low-density spot is more transparent.'],
  magpressure: ['Magnetic pressure', 'A magnetic field B exerts a pressure B²/2μ₀ perpendicular to itself. 0.3 T gives ≈ 36 kPa.'],
  beta: ['Plasma β', 'Gas pressure divided by magnetic pressure, β = 2μ₀p/B². Where β ≪ 1 (the corona) the field controls the plasma; where β ≫ 1 (the interior) the plasma drags the field.'],
  frozen: ['Frozen-in flux', 'In a highly conducting plasma, field lines move with the gas as if glued to it (Alfvén’s theorem).'],
  hale: ['Hale’s polarity law', 'In each hemisphere the leading spots of bipolar groups share one magnetic polarity, opposite to the other hemisphere; all signs swap at the next cycle.'],
  joy: ['Joy’s law', 'The leading spot of a group lies slightly closer to the equator than the following spot; the tilt increases with latitude.'],
  sporer: ['Spörer’s law', 'Spots of a new cycle appear at ±30–35° latitude and emerge ever closer to the equator as the cycle progresses - the butterfly diagram.'],
  dynamo: ['Dynamo', 'A process that maintains a magnetic field against decay by converting kinetic energy of flows into magnetic energy.'],
  faculae: ['Faculae', 'Bright patches of concentrated magnetic field, most visible near the limb. They outweigh sunspot darkening, so the Sun is ≈ 0.1 % brighter at maximum.'],
  chromosphere: ['Chromosphere', 'The ≈ 2 000 km thick layer above the photosphere, where temperature rises again from ≈ 4 000 K to ≈ 20 000 K. It gives the pink flash at the start and end of totality.'],
  spicule: ['Spicule', 'A thin jet of chromospheric plasma, a few hundred km wide, shooting up at 20–100 km/s for a few minutes.'],
  tr: ['Transition region', 'A thin layer where temperature leaps from ≈ 20 000 K to ≈ 1 MK. Seen in ultraviolet lines.'],
  corona: ['Corona', 'The Sun’s outer atmosphere: tenuous, 1–2 MK hot, extending millions of km and merging into the solar wind.'],
  loop: ['Coronal loop', 'An arch of closed magnetic field filled with hot plasma, anchored in regions of opposite polarity.'],
  prominence: ['Prominence', 'Cool, dense plasma suspended in the corona by magnetic fields. Seen against the disc as a dark filament.'],
  flare: ['Solar flare', 'A sudden release of magnetic energy (up to ~10²⁵ J) in minutes, heating plasma to tens of MK and accelerating particles.'],
  reconnection: ['Magnetic reconnection', 'Field lines of opposite direction break and rejoin in a new configuration, converting magnetic energy into heat, flows and fast particles.'],
  cme: ['Coronal mass ejection', 'A billion-tonne-scale cloud of magnetised plasma expelled from the corona at hundreds to thousands of km/s.'],
  hole: ['Coronal hole', 'A region of open magnetic field, dark in EUV and X-rays, where the fast solar wind escapes.'],
  wind: ['Solar wind', 'The continuous outflow of coronal plasma, ≈ 400–800 km/s, filling the heliosphere.'],
  parker: ['Parker spiral', 'The shape of the interplanetary magnetic field: radial outflow plus solar rotation wind the field into an Archimedean spiral, ≈ 45° to the radial at Earth.'],
  sonic: ['Sonic point', 'The distance where the accelerating wind first exceeds the local sound speed; a few solar radii out for a 1–2 MK corona.'],
  helio: ['Heliosphere', 'The bubble the solar wind blows in the interstellar medium; its edge, the heliopause, lies ≈ 120 AU away.'],
  magnetosphere: ['Magnetosphere', 'The cavity carved in the solar wind by Earth’s magnetic field, compressed on the day side and stretched into a long tail on the night side.'],
  au: ['Astronomical unit', '1 AU = 149 597 870.7 km, the mean Earth–Sun distance (215 R☉).'],
  euv: ['Fe IX 171 Å', 'Extreme-ultraviolet light from Fe IX ions, formed at ≈ 0.7 MK. Imaged from space, since the atmosphere absorbs it; it shows the corona’s loops.'],
  magnetogram: ['Magnetogram', 'A map of the line-of-sight magnetic field, measured from the Zeeman splitting and polarisation of a photospheric line (Fe I 617.3 nm for SDO/HMI). White = field towards us, black = away.'],
  zeeman: ['Zeeman effect', 'A magnetic field splits a spectral line into polarised components: Δλ = 4.67 × 10⁻¹³ g λ² B (λ in Å, B in gauss). For Fe I 617.3 nm (g = 2.5) and 1 000 G that is only 4.4 pm.'],
  dopplergram: ['Dopplergram', 'A map of line-of-sight velocity from the Doppler shift of a spectral line, Δλ/λ = v/c. Red = moving away, blue = towards us. 2 km/s shifts 617.3 nm by 4 pm.'],
  he304: ['He II 304 Å', 'Extreme-ultraviolet line of singly ionised helium at 30.4 nm, formed at ≈ 50 000–80 000 K in the upper chromosphere and transition region. Shows the network and prominences.'],
  fe193: ['Fe XII 193 Å', 'Extreme-ultraviolet line of iron that has lost 11 electrons, formed at ≈ 1.5 MK: the hotter corona, active regions and coronal holes. (In flares Fe XXIV at 20 MK contributes too.)'],
  kcorona: ['K-corona', 'White light from the photosphere scattered by free electrons in the corona (Thomson scattering). Its brightness traces the electron density.'],
  totality: ['Totality', 'The minutes of a total solar eclipse when the Moon - by chance 400× smaller and 400× closer than the Sun - covers the photosphere exactly, revealing chromosphere, prominences and corona.'],
  halpha: ['H-α', 'The red Balmer line of hydrogen at 656.3 nm (n = 3 → 2). A narrow filter at H-α shows the chromosphere, filaments and prominences.'],
};

// ---------------------------------------------------------------- the chapters
export const TOPICS = {

  contents: {
    crumb: 'Contents',
    title: 'The Sun - an interactive textbook',
    lead: 'Eight chapters, from the core outwards to the Earth, each tied to a view of the model. Open a chapter here or with the book symbol beside each view in the control panel; hover over the model at any time for a live read-out of the physics under the cursor.',
    sections: [
      { h: 'Chapters', html: `<div class="toc">${ORDER.map((id, i) => `<button class="toc-i" type="button" data-go="${id}"><span class="toc-n">${i + 1}</span><span class="toc-t">${({ overview: 'The Sun as a star', interior: 'Inside the Sun', core: 'The core: fusion', convection: 'The convection zone', photosphere: 'The photosphere', sunspots: 'Sunspots and the magnetic cycle', corona: 'Chromosphere, corona and prominences', wind: 'The solar wind and space weather' })[id]}</span></button>`).join('')}
        <button class="toc-i" type="button" data-go="datasheet"><span class="toc-n">∗</span><span class="toc-t">Solar data sheet</span></button></div>` },
      { h: 'How to use the model', html: `<p><strong>Hover</strong> over the Sun for a read-out: on the cutaway it gives the temperature, density, pressure and enclosed mass at that depth, from a standard solar model; on the surface it identifies umbra, penumbra, plage or granulation; off the limb it gives the coronal density or the state of the wind. Words with a dotted underline, like ${gl('plasma')}, open a definition.</p>
        <p>The control panel (hover over the right edge, or press <kbd>P</kbd>) switches between the eight instruments of chapter 1 - white light, ${gl('halpha', 'H-α')}, ${gl('he304', 'He II 304 Å')}, ${gl('euv', 'Fe IX 171 Å')}, ${gl('fe193', 'Fe XII 193 Å')}, ${gl('magnetogram')}, ${gl('dopplergram')} and a total eclipse - moves through the 11-year cycle, lets you <em>listen</em> to the Sun's oscillations, opens the interior, turns on a temperature map, and launches a flare with a ${gl('cme', 'coronal mass ejection')}.</p>
        <p><strong>What is not to scale.</strong> Rotation is speeded up about twenty-thousand-fold; granules evolve on their own clock; the chromosphere is drawn about twice too thick; the corona is brightened about a million-fold (the real one is only visible in an eclipse); in the wind view, distances beyond 3 R☉ are compressed tenfold and Earth is enlarged about thirty times.</p>` },
    ],
    figures: [{ kind: 'sim', view: 'overview', opts: {}, cap: 'The model in white light.' }],
    related: [],
  },

  overview: {
    crumb: 'The Sun as a star',
    title: 'The Sun as a star',
    lead: 'An ordinary star, seen from unusually close: a 4.6-billion-year-old ball of hydrogen and helium plasma, held together by its own gravity and kept from collapsing by the pressure of gas heated by nuclear fusion in its core.',
    facts: [
      ['Mass M☉', '1.989 × 10³⁰ kg (333 000 Earths)'],
      ['Radius R☉', '695 700 km (109 Earths)'],
      ['Luminosity L☉', '3.828 × 10²⁶ W'],
      ['Effective temperature', '5 772 K'],
      ['Mean density', '1.41 g cm⁻³'],
      ['Surface gravity', '274 m s⁻² (28 g)'],
      ['Age', '4.57 × 10⁹ years'],
      ['Spectral class', 'G2 V (yellow dwarf)'],
      ['Composition (mass)', 'H 74 %, He 25 %, heavier ≈ 1.4 %'],
    ],
    sections: [
      { h: 'A self-gravitating ball of plasma',
        html: `<p>Everything about the Sun follows from two numbers - its mass and its composition - and one condition: that it is in ${gl('hse', 'hydrostatic equilibrium')}. At every depth, the weight of the layers above is carried by the pressure below,</p>
        ${eq(`${frac('d' + mi('P'), 'd' + mi('r'))} ${op('=')} −${frac(mi('G') + '&#8201;' + mi('m') + '(' + mi('r') + ')&#8201;' + mi('ρ'), mi('r') + '²')}`)}
        <p>Integrating this crudely across the whole Sun - pressure about ${mi('GM')}²/${mi('R')}⁴, ideal gas ${mi('P')} = ${mi('ρkT')}/${mi('μm')}ᵤ - gives a central temperature of order</p>
        ${eq(`${mi('T')}<sub>c</sub> ${op('~')} ${frac(mi('G') + mi('M') + '&#8201;' + mi('μm') + '<sub>u</sub>', mi('k') + mi('R'))} ${op('≈')} 10⁷ K`)}
        <p>which is just what fusion of hydrogen needs. The detailed models in this book find 15.7 million kelvin.</p>` },
      { h: 'Why it must be nuclear',
        html: `<p>In the nineteenth century, Kelvin and Helmholtz supposed the Sun shone by slowly contracting, turning gravitational energy into heat. That reservoir lasts only the ${gl('kh', 'Kelvin–Helmholtz time')},</p>
        ${eq(`${mi('t')}<sub>KH</sub> ${op('≈')} ${frac(mi('G') + mi('M') + '²', mi('R') + mi('L'))} ${op('≈')} 3 × 10⁷ yr`)}
        <p>while rocks and fossils showed Earth to be hundreds of times older. The answer, found in the 1920s–30s by Eddington, Gamow and Bethe, is that the core converts mass into energy: 0.7 % of the mass of hydrogen disappears when it fuses to helium. The Sun loses 4.26 million tonnes per second to radiation alone - and has enough hydrogen in its core for about another five billion years.</p>` },
      { h: 'An ordinary star',
        html: `<p>On a Hertzsprung–Russell diagram the Sun sits in the middle of the main sequence: hotter and brighter than most stars in the Galaxy (three quarters are cooler red dwarfs), much fainter than the rare massive ones. Its ${gl('teff', 'effective temperature')} is defined by its luminosity and radius through the Stefan–Boltzmann law,</p>
        ${eq(`${mi('L')} ${op('=')} 4π${mi('R')}²&#8201;${mi('σ')}${mi('T')}<sub>eff</sub>⁴`)}
        <p>Its proximity is what makes it special: it is the only star whose surface we can resolve down to 100 km, whose interior we can sound with ${gl('helioseismology')}, whose core we can see directly in ${gl('neutrino', 'neutrinos')}, and whose wind we can sample with spacecraft.</p>` },
      { h: 'Eight instruments',
        html: `<p>No single picture shows the Sun. Each wavelength comes from a different height and temperature, because each spectral line is formed only where its ion exists and the gas is just opaque enough. The model offers the eight views solar observatories use most (buttons in the control panel, or <kbd>V</kbd>):</p>
        <table class="dt dt-l"><thead><tr><th>Instrument</th><th>λ</th><th>Source</th><th>T</th><th style="text-align:left">Shows</th></tr></thead><tbody><tr><td><b>White light</b></td><td>400–700 nm</td><td>continuum</td><td>5 772 K</td><td style="text-align:left">photosphere: limb darkening, spots, faculae, granulation</td></tr><tr><td><b>Hα</b></td><td>656.3 nm</td><td>H I Balmer-α</td><td>≈ 10⁴ K</td><td style="text-align:left">chromosphere: plage, network, filaments, prominences</td></tr><tr><td><b>304 Å</b></td><td>30.4 nm</td><td>He II</td><td>≈ 5 × 10⁴ K</td><td style="text-align:left">upper chromosphere, transition region, prominences</td></tr><tr><td><b>171 Å</b></td><td>17.1 nm</td><td>Fe IX</td><td>≈ 0.7 MK</td><td style="text-align:left">quiet corona, loops, polar plumes</td></tr><tr><td><b>193 Å</b></td><td>19.3 nm</td><td>Fe XII</td><td>≈ 1.5 MK</td><td style="text-align:left">hotter corona, active regions, coronal holes</td></tr><tr><td><b>Magnetogram</b></td><td>617.3 nm</td><td>Fe I, Zeeman</td><td>–</td><td style="text-align:left">B∥: spot polarities, network, polar fields</td></tr><tr><td><b>Dopplergram</b></td><td>617.3 nm</td><td>Fe I, Doppler</td><td>–</td><td style="text-align:left">v∥: rotation, supergranules, 5-minute oscillations</td></tr><tr><td><b>Eclipse</b></td><td>visible</td><td>K-corona</td><td>1–2 MK</td><td style="text-align:left">corona to several R☉, chromosphere, prominences</td></tr></tbody></table>
        <p>Going down the table is going up through the atmosphere, from the 5 800 K photosphere to the million-degree corona. The last three are different in kind: the ${gl('magnetogram')} and ${gl('dopplergram')} measure the field and the velocity of the photosphere through the ${gl('zeeman', 'Zeeman')} and Doppler shifts of one iron line, and an eclipse removes the disc so the faint ${gl('kcorona', 'K-corona')} can be seen. Hover over the Sun in any of them for what that instrument measures at the cursor.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'overview', opts: { zoom: 0.9 }, cap: 'The Sun in white light: limb darkening, two active regions, a prominence on the southern limb and the corona (brightened enormously).' },
      { kind: 'sim', view: 'overview', opts: { zoom: 0.9, filter: 3 }, cap: 'The same moment in Fe IX 171 Å: dark polar coronal holes, glowing active-region loops.' },
      { kind: 'sim', view: 'overview', opts: { zoom: 0.9, filter: 5 }, cap: 'Magnetogram: the two polarities of each sunspot pair (white towards us, black away), the salt-and-pepper network and the polar fields.' },
      { kind: 'svg', cap: 'Schematic Hertzsprung–Russell diagram. The Sun will swell into a red giant in about five billion years.', svg: hrChart() },
    ],
    question: { tag: 'The faint young Sun', html:
      `<p>Standard models say the young Sun was about 30 % fainter than today: the helium accumulating in the core raises its mean molecular weight, so the core contracts, heats and burns faster. With that little sunlight, Earth should have been frozen for its first two billion years - yet the geological record shows liquid water as far back as 4 billion years ago. Stronger greenhouse warming, a lower albedo, or a slightly more massive young Sun that lost mass through a strong early wind are all candidates; none has been settled.</p>` },
    related: ['interior', 'core', 'datasheet'],
  },

  interior: {
    crumb: 'Inside the Sun',
    title: 'Inside the Sun',
    lead: 'Three nested regions, distinguished not by what they are made of but by how they carry energy: fusion in the core, radiation through the radiative zone, and bulk motion in the convection zone.',
    explore: {
      view: 'interior', title: 'The layers', hint: 'Click a number. In the model itself, hover over the cut faces for temperature, density and pressure at any depth.',
      opts: { w: 1100, anchors: { obj: 'world', pts: [[0.1, 0.08, 0], [0.45, -0.2, 0], [0, 0.42, 0.575], [0, -0.45, 0.74], [-0.3, 0.9, 0.316], [-0.45, 1.25, -0.2]] } },
      pins: [
        { name: 'Core (0–0.25 R☉)', text: '15.7 MK and 150 g cm⁻³ at the centre - ten times denser than lead, yet still a gas. Half the Sun’s mass and 99 % of its power.' },
        { name: 'Radiative zone (0.25–0.71 R☉)', text: 'Energy diffuses outward as photons, each absorbed and re-emitted after a fraction of a millimetre. The blue trace in the model is one such walk, magnified.' },
        { name: 'Tachocline (≈ 0.71 R☉)', text: 'A thin shear layer. Below, the Sun turns like a solid body; above, the equator outruns the poles. Probably where the magnetic dynamo builds its field.' },
        { name: 'Convection zone (0.71–1 R☉)', text: 'Opacity is so high that radiation cannot carry the flux; the plasma boils instead. The cells shrink towards the surface.' },
        { name: 'Photosphere', text: 'The surface we see: the layer where the gas becomes transparent. 5 772 K, about 500 km thick.' },
        { name: 'Corona', text: 'Above the visible surface the temperature climbs again to millions of kelvin - one of the great unexplained facts of solar physics.' },
      ],
    },
    facts: [
      ['Central temperature', '1.57 × 10⁷ K'],
      ['Central density', '≈ 150 g cm⁻³'],
      ['Central pressure', '≈ 2.4 × 10¹⁶ Pa'],
      ['Base of convection zone', '0.713 R☉ (helioseismology)'],
      ['Photon mean free path', '< 0.1 mm (core) to mm'],
      ['Energy diffusion time', '~10⁴–10⁵ years'],
      ['Dynamical time', '√(R³/GM) ≈ 27 min'],
    ],
    sections: [
      { h: 'Four equations',
        html: `<p>A standard solar model solves four coupled equations along the radius: ${gl('hse', 'hydrostatic equilibrium')}; mass continuity, d${mi('m')}/d${mi('r')} = 4π${mi('r')}²${mi('ρ')}; energy generation, d${mi('L')}/d${mi('r')} = 4π${mi('r')}²${mi('ρε')}; and energy transport, which depends on how the heat moves. The model is evolved from a uniform young Sun for 4.57 billion years, adjusting the initial helium content and the mixing length until it reproduces today’s radius and luminosity.</p>
        <p>The result is in the charts beside this text. Temperature falls steadily, by a factor of 2 700 from the centre to the surface; density falls by more than eight orders of magnitude. Half of the mass lies inside a quarter of the radius.</p>` },
      { h: 'Radiative diffusion',
        html: `<p>In the radiative zone, energy moves as photons, but not in straight lines. The plasma is so dense that a photon travels one ${gl('mfp', 'mean free path')}, ℓ = 1/(${gl('opacity', 'κ')}${mi('ρ')}), before being absorbed or scattered - a fraction of a millimetre in the core. The energy performs a ${gl('randomwalk', 'random walk')}: after ${mi('N')} steps it has moved only ℓ√${mi('N')}, so crossing a distance ${mi('R')} takes ${mi('N')} ≈ (${mi('R')}/ℓ)² steps and a time</p>
        ${eq(`${mi('t')}<sub>diff</sub> ${op('≈')} ${frac(mi('R') + '²', 'ℓ&#8201;' + mi('c'))}`)}
        <p>With ℓ ≈ 1 mm and ${mi('R')} ≈ 5 × 10⁸ m that is about 30 000 years; careful calculations give 10⁴ to 10⁵ years, often quoted as 170 000. The flux carried this way is set by the temperature gradient:</p>
        ${eq(`${mi('L')}(${mi('r')}) ${op('=')} −${frac('64π' + mi('σ') + mi('r') + '²' + mi('T') + '³', '3' + mi('κρ'))}&#8201;${frac('d' + mi('T'), 'd' + mi('r'))}`)}
        <p>Where the ${gl('opacity')} becomes large, a steeper gradient is needed to push the same luminosity through - and beyond a certain steepness the gas starts to convect instead (next chapters).</p>` },
      { h: 'How we know',
        html: `<p>None of this is seen directly in light. Two probes reach the interior: ${gl('neutrino', 'neutrinos')}, which leave the core unhindered, and ${gl('helioseismology')}, which measures the speed of sound at every depth. The measured sound speed agrees with the standard model to a few parts in a thousand - one of the great quantitative successes of astrophysics.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'interior', opts: { tmap: true }, cap: 'Temperature map of the cut faces (log T, inferno colour scale), with isotherms every quarter decade and dashed lines at the core and the base of the convection zone.' },
      { kind: 'svg', cap: 'Temperature and density through the Sun, from the solar-model table used by the model’s hover read-out.', svg: profileChart() },
      { kind: 'svg', cap: 'Enclosed mass and luminosity. All the power is generated inside 0.25 R☉; beyond that L(r) is flat.', svg: massLumChart() },
    ],
    question: { tag: 'The solar abundance problem', html:
      `<p>In the 2000s, improved three-dimensional models of the photosphere lowered the measured abundance of carbon, nitrogen and oxygen by about 30 %. Fed into a standard solar model, the lower opacity moves the base of the convection zone and spoils the excellent agreement with helioseismology. Either the abundances, the opacities calculated for solar-interior conditions, or the physics of mixing is wrong. Newer abundance analyses (around 2022) point back towards higher values, and laboratory opacity measurements at Sandia suggest the calculated iron opacity is too low - but the problem is not closed.</p>` },
    related: ['core', 'convection', 'datasheet'],
  },

  core: {
    crumb: 'The core',
    title: 'The core: fusion',
    lead: 'Inside a quarter of the radius, 600 million tonnes of hydrogen become helium every second. The reaction should be impossible by classical physics, and it is extremely slow - which is why the Sun lasts ten billion years.',
    facts: [
      ['Energy per ⁴He', '26.73 MeV (0.7 % of the mass)'],
      ['Hydrogen burnt', '≈ 6 × 10¹¹ kg s⁻¹'],
      ['Mass converted to energy', '4.26 × 10⁹ kg s⁻¹'],
      ['Power density at centre', '≈ 280 W m⁻³'],
      ['Central hydrogen fraction', '≈ 34 % (was 71 %)'],
      ['pp chain / CNO', '≈ 99 % / ≈ 1 %'],
      ['Neutrino flux at Earth', '≈ 6.5 × 10¹⁰ cm⁻² s⁻¹'],
    ],
    sections: [
      { h: 'Four protons into helium',
        html: `<p>The Sun’s main reaction network is the ${gl('pp', 'proton–proton chain')}. Its first step is the bottleneck: two protons must not only touch, but one must turn into a neutron through the weak interaction while they do,</p>
        ${eq(`p + p ${op('→')} ²H + e⁺ + ν<sub>e</sub>`)}
        <p>so rarely that an individual proton in the core waits about ten billion years for it. Everything afterwards is fast. The net result is</p>
        ${eq(`4&#8201;¹H ${op('→')} ⁴He + 2e⁺ + 2ν<sub>e</sub> + 26.73 MeV`)}
        <p>of which about 2 % leaves with the neutrinos. The rest heats the core. Despite the enormous total power, the energy released per cubic metre at the centre is only about 280 W - less than a compost heap. The Sun is bright because it is big.</p>` },
      { h: 'Through the Coulomb barrier',
        html: `<p>Two protons repel. To touch, they must approach within about a femtometre, where the electrostatic barrier is of order 1 MeV - several hundred times the thermal energy ${mi('kT')} = 1.35 keV at 15.7 MK. Classically, essentially no proton in the core is fast enough. They get through by ${gl('tunnel', 'quantum tunnelling')}, with probability</p>
        ${eq(`${mi('P')}(${mi('E')}) ${op('∝')} exp(−√(${mi('E')}<sub>G</sub>/${mi('E')})),   ${mi('E')}<sub>G</sub> ${op('=')} 2${mi('m')}<sub>r</sub>${mi('c')}²(π${mi('α')}${mi('Z')}₁${mi('Z')}₂)² ${op('≈')} 493 keV`)}
        <p>The number of protons falls with energy as exp(−${mi('E')}/${mi('kT')}) while the tunnelling probability rises. Their product peaks at the ${gl('gamow', 'Gamow peak')},</p>
        ${eq(`${mi('E')}₀ ${op('=')} (${mi('E')}<sub>G</sub>(${mi('kT')})²/4)<sup>1/3</sup> ${op('≈')} 6 keV`)}
        <p>Because the window sits far out on the tail, the reaction rate is extremely sensitive to temperature - roughly as ${mi('T')}⁴ for the pp chain and ${mi('T')}²⁰ for the ${gl('cno', 'CNO cycle')}. This is the Sun’s thermostat: if the core heats, it expands and cools again.</p>` },
      { h: 'Seeing the core in neutrinos',
        html: `<p>Neutrinos leave the core in two seconds and reach us in eight minutes. Ray Davis’s chlorine detector in the Homestake mine (from 1968) caught only about a third of the predicted number, the “solar neutrino problem”. The solution came in 2001–2002 from the Sudbury Neutrino Observatory, which counted all neutrino flavours and found the full predicted flux: the electron neutrinos change flavour on the way (${gl('oscillation', 'neutrino oscillation')}). The solar model was right; the particle physics needed neutrino mass.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'core', opts: {}, cap: 'The core in the cutaway: the flickering sparks stand for fusion events (wildly exaggerated - the real rate per proton is one in ten billion years).' },
      { kind: 'svg', cap: 'The proton–proton chain and its three branches.', svg: ppChainDiagram() },
      { kind: 'svg', cap: 'The Gamow peak for p + p at the solar centre, computed from the two exponentials in the text (log scale).', svg: gamowChart() },
    ],
    question: { tag: 'The core’s metal content', html:
      `<p>In 2020 the Borexino experiment detected neutrinos from the CNO cycle for the first time. Their flux depends directly on the carbon, nitrogen and oxygen in the core, so it offers an independent way to settle the solar abundance problem of the previous chapter. The first results mildly favour the older, higher abundances; more precise measurements, for example from the SNO+ and JUNO detectors, are expected to decide it.</p>` },
    related: ['interior', 'overview', 'datasheet'],
  },

  convection: {
    crumb: 'The convection zone',
    title: 'The convection zone',
    lead: 'In the outer 29 % of the radius the Sun boils. Hot plasma rises, delivers its heat to the surface and sinks again, in cells that range from the size of the Earth to the depth of the whole zone.',
    facts: [
      ['Base', '0.713 R☉ (≈ 200 000 km deep)'],
      ['Mass', '≈ 2 % of M☉'],
      ['Temperature at base', '≈ 2.2 MK'],
      ['Flow speeds', '≈ 1–2 km/s at the top, ~m/s–10s m/s deep'],
      ['Equator rotation', '≈ 24.5 d (sidereal)'],
      ['Pole rotation', '≈ 34 d'],
      ['5-minute oscillations', '≈ 3 mHz, ~10⁷ modes'],
    ],
    sections: [
      { h: 'When radiation gives up',
        html: `<p>Towards the surface the temperature falls to a few hundred thousand kelvin and below, hydrogen and helium are no longer fully ionised, and the ${gl('opacity')} rises steeply. To carry the full luminosity by radiation would need a temperature gradient steeper than the gas can sustain. The ${gl('schwarzschild', 'Schwarzschild criterion')} says a layer becomes unstable to ${gl('convection')} when</p>
        ${eq(`∇<sub>rad</sub> ${op('>')} ∇<sub>ad</sub>,     ∇ ${op('≡')} ${frac('d ln ' + mi('T'), 'd ln ' + mi('P'))},   ∇<sub>ad</sub> ${op('=')} 0.4 for an ideal monatomic gas`)}
        <p>A displaced blob that cools ${gl('adiabatic', 'adiabatically')} as it rises then stays hotter - and so lighter - than its surroundings, and keeps rising. Mixing-length theory gives speeds of order ${mi('v')} ~ (${mi('F')}/${mi('ρ')})<sup>1/3</sup>: a few km/s near the surface, metres per second deep down where the density is high.</p>` },
      { h: 'Differential rotation and the tachocline',
        html: `<p>The surface does not rotate as a solid body. Sunspot tracking gives a sidereal rate in degrees per day</p>
        ${eq(`${mi('Ω')}(${mi('φ')}) ${op('=')} 14.71 − 2.40 sin²${mi('φ')} − 1.79 sin⁴${mi('φ')}`)}
        <p>so the equator laps the poles roughly every three to four months. ${gl('helioseismology', 'Helioseismology')} shows this ${gl('diffrot', 'differential rotation')} persists through the whole convection zone along roughly radial lines, and then stops: below the ${gl('tachocline')} the radiative interior turns rigidly at about 435 nHz (27 days). The shear concentrated in that thin layer stretches field lines into strong toroidal bands - a key ingredient of the solar dynamo.</p>` },
      { h: 'A ringing Sun',
        html: `<p>Convection is noisy. The turbulent flows near the top excite sound waves that bounce around the interior: millions of ${gl('pmode', 'acoustic modes')} with periods near five minutes, discovered by Leighton in 1962. Each mode probes a different range of depths, and from their frequencies we have mapped the sound speed, the base of the convection zone, the helium abundance and the rotation inside the Sun - the chart beside this text.</p>
        <p>The oscillations are measured in a ${gl('dopplergram')}: the Doppler shift of a photospheric line, pixel by pixel. Switch the model to <em>Doppler</em> and three signals overlap. The rotation makes the east limb blue and the west limb red, ±2 km/s at the equator. Supergranule outflows show as a cellular pattern of ±0.4 km/s, strongest towards the limb, where the horizontal flow points along the line of sight. And the 5-minute oscillations ripple across the disc at a few hundred m/s.</p>
        <p>Low-degree modes obey a simple asymptotic law,</p>
        ${eq(`${mi('ν')}<sub>${mi('n')},${mi('l')}</sub> ${op('≈')} Δ${mi('ν')}&#8201;(${mi('n')} + ${frac(mi('l'), '2')} + ${mi('ε')}) − ${mi('l')}(${mi('l')}+1)&#8201;${mi('D')}₀,    Δ${mi('ν')} ${op('≈')} 135 µHz`)}
        <p>an evenly spaced comb whose spacing Δ${mi('ν')} - the inverse of the sound-crossing time - scales as the square root of the mean density. <em>Listen</em> in the control panel plays these modes sped up 100 000×, so 3 mHz becomes about 310 Hz; the comb appears in the live spectrum, colour-coded by degree ${mi('l')}. Each mode is kicked at random by convection and dies away in about four days (three seconds of sound).</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'convection', opts: {}, cap: 'Convective rolls in the cut face: large cells deep down, smaller ones near the surface; the bright arc is the tachocline. (Real convection is turbulent and three-dimensional; the rolls are illustrative.)' },
      { kind: 'sim', view: 'overview', opts: { zoom: 0.9, filter: 6 }, cap: 'Dopplergram: the approaching east limb is blue, the receding west limb red; supergranules and 5-minute oscillations make the mottling.' },
      { kind: 'svg', cap: 'Rotation inside the Sun at three latitudes (schematic after helioseismic inversions; surface rates from Snodgrass & Ulrich 1990).', svg: rotationChart() },
    ],
    question: { tag: 'The convective conundrum', html:
      `<p>Simulations of the convection zone predict large-scale flows that helioseismic measurements do not find: some analyses put the real velocities at scales of ~100 000 km one or two orders of magnitude lower than the simulations. The same simulations struggle to reproduce the observed fast equator. Either the Sun transports its heat in a way the models miss - for example by narrow, fast downflowing plumes - or the measurements are missing something.</p>` },
    related: ['interior', 'photosphere', 'sunspots'],
  },

  photosphere: {
    crumb: 'The photosphere',
    title: 'The photosphere',
    lead: 'The “surface” of the Sun is the layer, a few hundred kilometres thick, where its gas turns from opaque to transparent. Its granulated pattern is the top of the convection zone; its spectrum is a fingerprint of the Sun’s chemistry.',
    facts: [
      ['Effective temperature', '5 772 K'],
      ['Thickness', '≈ 500 km'],
      ['Density', '≈ 2 × 10⁻⁷ g cm⁻³'],
      ['Pressure scale height', '≈ 150 km'],
      ['Granule size / life', '1 000–1 500 km / 5–10 min'],
      ['Supergranule size / life', '≈ 30 000 km / ≈ 1 day'],
      ['Peak of spectrum', '502 nm (in wavelength)'],
      ['Solar constant at 1 AU', '1 361 W m⁻²'],
    ],
    sections: [
      { h: 'Where the Sun becomes transparent',
        html: `<p>We see into the Sun down to an ${gl('tau', 'optical depth')} of about τ = 2/3 - roughly one photon mean free path. In the photosphere that path is tens to hundreds of kilometres, set mostly by the ${gl('hminus', 'H⁻ ion')}. Because the density falls with a scale height of only ~150 km, the transition from opaque to transparent is so abrupt that the Sun appears to have a sharp edge.</p>
        <p>In the simplest (grey, Eddington) model of this layer, the temperature depends on optical depth as</p>
        ${eq(`${mi('T')}⁴(${mi('τ')}) ${op('=')} ${frac('3', '4')}${mi('T')}<sub>eff</sub>⁴ (${mi('τ')} + ${frac('2', '3')})`)}
        <p>so ${mi('T')} = ${mi('T')}<sub>eff</sub> exactly at τ = 2/3.</p>` },
      { h: 'Limb darkening',
        html: `<p>Looking at the centre of the disc we see straight down; near the edge our line of sight is slanted and reaches τ = 2/3 higher up, in cooler gas. By the Eddington–Barbier relation the intensity at viewing angle θ, with ${mi('μ')} = cos θ, is the source function at τ = ${mi('μ')}, which with the profile above gives</p>
        ${eq(`${frac(mi('I') + '(' + mi('μ') + ')', mi('I') + '(1)')} ${op('=')} ${frac('2 + 3' + mi('μ'), '5')} ${op('=')} 0.4 + 0.6&#8201;${mi('μ')}`)}
        <p>The model uses exactly this law, and colours the limb by the temperature at τ = ${mi('μ')} - about 6 100 K at the centre, 4 900 K at the extreme edge. That is why the disc looks redder towards the ${gl('limb', 'limb')}. (The Sun is white, not yellow; the model warms it slightly so the granulation reads better.)</p>` },
      { h: 'Granulation',
        html: `<p>Seen at high resolution, the photosphere is a mosaic of ${gl('granule', 'granules')}: bright cells of rising hot gas ~1 000–1 500 km across, separated by narrow dark lanes where cooled gas sinks. The temperature contrast is a few hundred kelvin, the vertical speeds 1–2 km/s, and each granule lives only five to ten minutes. A larger pattern of horizontal flows, the ${gl('supergranule', 'supergranulation')}, sweeps magnetic field to the edges of ~30 000 km cells; in H-α these edges light up as the chromospheric network.</p>` },
      { h: 'The spectrum',
        html: `<p>The continuum is close to a black body at 5 772 K, peaking near 500 nm. Superimposed are thousands of dark ${gl('fraunhofer', 'Fraunhofer lines')}, where atoms in the cooler upper photosphere absorb the light from below. Their strengths give the Sun’s composition: by mass about 74 % hydrogen, 25 % helium (helium was first found in the Sun, in 1868), and about 1.4 % everything else.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'photosphere', opts: {}, cap: 'Granulation near the limb, at a height of ~40 000 km. Each bright cell is ~1 000 km across. The chromosphere glows faintly at the horizon.' },
      { kind: 'svg', cap: 'Black-body spectrum of the photosphere and of a sunspot umbra on the same scale, with the strongest Fraunhofer lines.', svg: planckChart() },
      { kind: 'svg', cap: 'Eddington limb darkening, the law the model’s surface shader uses.', svg: limbChart() },
    ],
    question: { tag: 'A small-scale dynamo?', html:
      `<p>Even the “quiet” photosphere, far from sunspots, is threaded with tangled magnetic fields on scales of a few hundred kilometres, detected through the Zeeman and Hanle effects. Do they come from the debris of decaying active regions, or are they generated locally by the turbulence of granulation itself - a small-scale dynamo, independent of the 11-year cycle? Simulations say such a dynamo can work; observations so far have found the quiet-Sun field almost unchanged through the cycle, which suggests it does.</p>` },
    related: ['convection', 'sunspots', 'corona'],
  },

  sunspots: {
    crumb: 'Sunspots and the magnetic cycle',
    title: 'Sunspots and the magnetic cycle',
    lead: 'Sunspots are where bundles of magnetic field, generated deep inside, break through the surface. Their number rises and falls every eleven years, and every eleven years the Sun’s magnetic field reverses.',
    explore: {
      view: 'sunspots', title: 'An active region', hint: 'Click a number. In the model, hover over the spots, the plage and the loops for their physical values.',
      opts: {
        w: 1100,
        anchors: { obj: 'sun', pts: [dirLL(sp('leadN').lat, sp('leadN').lon), dirLL(sp('leadN').lat - 1.15, sp('leadN').lon + 0.6), dirLL(sp('followN').lat, sp('followN').lon), dirLL(sp('poreC').lat, sp('poreC').lon), mid(dirLL(sp('leadN').lat, sp('leadN').lon), dirLL(sp('followN').lat, sp('followN').lon), 1.065), dirLL(18.5, 3.5), dirLL(13, -3)] },
      },
      pins: [
        { name: 'Umbra of the leading spot', text: '≈ 4 000 K and only a fifth as bright as its surroundings. The vertical field of ≈ 0.3 T suppresses convection beneath it.' },
        { name: 'Penumbra', text: 'Bright and dark filaments of strongly inclined field; gas flows outwards along them at 1–2 km/s (the Evershed effect).' },
        { name: 'Following spot', text: 'Opposite magnetic polarity to the leader. Field lines leave one spot and arch through the corona into the other.' },
        { name: 'Pore', text: 'A flux tube too small to form a penumbra.' },
        { name: 'Coronal loops', text: 'Plasma at 1–3 MK confined to the closed field connecting the two polarities.' },
        { name: 'Plage / faculae', text: 'Magnetic flux outside the spots, bright in H-α and EUV and, near the limb, in white light.' },
        { name: 'Quiet granulation', text: 'Ordinary convection, with weak field - compare the scale with the spots.' },
      ],
    },
    facts: [
      ['Umbra temperature', '≈ 3 900–4 200 K'],
      ['Penumbra temperature', '≈ 5 400 K'],
      ['Umbral field', '≈ 0.25–0.35 T (2 500–3 500 G)'],
      ['Wilson depression', '≈ 500–1 000 km'],
      ['Lifetime', 'hours (pores) to months'],
      ['Cycle length', '≈ 11 yr (9–14); magnetic 22 yr'],
      ['Irradiance change max–min', '≈ 0.1 % (≈ 1 W m⁻²)'],
      ['Current cycle', 'Cycle 25, began December 2019'],
    ],
    sections: [
      { h: 'Why spots are dark',
        html: `<p>A sunspot is the cross-section of a flux tube - a bundle of magnetic field ~10 000–50 000 km across - standing upright in the photosphere. Inside, the field exerts a ${gl('magpressure', 'magnetic pressure')}, so the gas pressure needed to balance the surroundings is lower:</p>
        ${eq(`${mi('p')}<sub>out</sub> ${op('=')} ${mi('p')}<sub>in</sub> + ${frac(mi('B') + '²', '2' + mi('μ') + '₀')}`)}
        <p>For ${mi('B')} = 0.3 T the magnetic term is ≈ 36 kPa, comparable to the photospheric gas pressure. The stiff field also blocks the overturning motions that bring heat up from below, so the ${gl('umbra')} cools to ~4 000 K and, by ${mi('T')}⁴, emits only about a fifth as much. Being less dense, it is also more transparent, and we see into it ~600 km deeper - the ${gl('wilson', 'Wilson depression')}.</p>` },
      { h: 'Bipolar groups and their rules',
        html: `<p>Spots come in pairs of opposite polarity, joined by loops through the corona. Three empirical rules organise them. ${gl('hale', 'Hale’s law')}: in one hemisphere the leading spots (in the direction of rotation) all have the same polarity, opposite to the other hemisphere - the model’s northern and southern groups show this. ${gl('joy', 'Joy’s law')}: the leader sits slightly nearer the equator. ${gl('sporer', 'Spörer’s law')}: as a cycle progresses, new spots emerge ever closer to the equator, drawing the butterfly diagram.</p>
        <p>Together they point to a large-scale toroidal field wound up by ${gl('diffrot', 'differential rotation')} and buoyantly rising through the convection zone in tilted loops.</p>` },
      { h: 'The dynamo and the cycle',
        html: `<p>In the ${gl('dynamo')} picture, the shear at the ${gl('tachocline')} stretches the weak north–south (poloidal) field into strong east–west (toroidal) bands - the Ω-effect. Twisted, tilted rising loops - the source of Joy’s law - and the decay and poleward drift of their flux rebuild a poloidal field of reversed sign (the Babcock–Leighton mechanism). One full magnetic cycle therefore takes two sunspot cycles, about 22 years. The cycle is irregular: between 1645 and 1715, during the Maunder minimum, almost no spots were seen.</p>
        <p>Drag the <em>Solar cycle</em> slider to move through cycle 25. Towards minimum the spots and active regions fade away, the corona flattens into a belt of streamers along the equator with plumes over the poles, and the polar coronal holes grow; at maximum the corona has streamers at all latitudes and the polar field reverses (watch the poles in the magnetogram).</p>` },
      { h: 'Seeing the field',
        html: `<p>The field itself is measured with the ${gl('zeeman', 'Zeeman effect')}: a field ${mi('B')} splits a line of Landé factor ${mi('g')} by</p>
        ${eq(`Δ${mi('λ')}<sub>B</sub> ${op('=')} 4.67 × 10⁻¹³&#8201;${mi('g')}&#8201;${mi('λ')}²&#8201;${mi('B')}     (${mi('λ')} in Å, ${mi('B')} in G)`)}
        <p>- 4.4 pm for 1 000 G on the Fe I line at 617.3 nm, far less than the line's width. Instruments therefore measure the circular polarisation of the split components, which gives the line-of-sight component ${mi('B')}<sub>∥</sub>. For the nearly vertical fields of the photosphere ${mi('B')}<sub>∥</sub> ≈ ${mi('B')}&#8201;${mi('μ')}, so the same spot fades towards the limb in a ${gl('magnetogram')}. In the model's magnetogram the leading and following spots have opposite colours, and the northern and southern groups have opposite orders: ${gl('hale', 'Hale’s law')} at a glance.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'sunspots', opts: { filter: 3 }, cap: 'The same active region in EUV 171 Å: the loops dominate, the spots are hardly visible.' },
      { kind: 'sim', view: 'sunspots', opts: { filter: 1 }, cap: 'And in H-α: bright plage around the spots and the chromospheric network.' },
      { kind: 'sim', view: 'sunspots', opts: { filter: 5 }, cap: 'Magnetogram of the region: leading spot white (field towards us), following spot black, plage keeping the polarity of its spot.' },
      { kind: 'svg', cap: 'The butterfly pattern (schematic): each cycle’s spots start at mid-latitudes and migrate equatorwards.', svg: butterflyChart() },
    ],
    question: { tag: 'Predicting the cycle', html:
      `<p>We cannot yet forecast a solar cycle from first principles. The best predictor is empirical: the strength of the Sun’s polar field at minimum, which seeds the next cycle’s toroidal field. Predictions for cycle 25 made in 2019 mostly expected a weak cycle, similar to cycle 24; it turned out clearly stronger. How much of the cycle is set deterministically by the dynamo, and how much by the random emergence of large, wrongly tilted active regions, is an open question.</p>` },
    related: ['convection', 'corona', 'photosphere'],
  },

  corona: {
    crumb: 'Chromosphere, corona and prominences',
    title: 'Chromosphere, corona and prominences',
    lead: 'Above the photosphere the temperature does something unexpected: after falling to about 4 000 K, it climbs to 20 000 K in the chromosphere and leaps to millions of kelvin in the corona. The magnetic field shapes everything here.',
    facts: [
      ['Chromosphere', '≈ 2 000 km, 4 000 → 20 000 K'],
      ['Transition region', 'a few hundred km, 2 × 10⁴ → 10⁶ K'],
      ['Corona', '1–2 MK (active regions 2–4 MK)'],
      ['Coronal density', '≈ 10⁸–10⁹ cm⁻³ at the base'],
      ['Coronal brightness', '≈ 10⁻⁶ of the disc'],
      ['Heating needed', '≈ 300 W m⁻² (quiet), 10⁴ W m⁻² (active)'],
      ['Prominence temperature', '≈ 7 000–10 000 K'],
      ['Largest flares', '~10²⁵ J'],
    ],
    sections: [
      { h: 'The chromosphere',
        html: `<p>The ${gl('chromosphere')} is named for the pink-red flash it gives at the start and end of a total eclipse - the light of ${gl('halpha', 'H-α')} and other hydrogen lines. Imaged through an H-α filter, it is a tangle of fibrils, bright network and dark filaments, and at the limb it bristles with ${gl('spicule', 'spicules')}, jets that carry a hundred times the mass of the solar wind upwards, most of it falling back.</p>` },
      { h: 'A million-degree corona',
        html: `<p>Above a thin ${gl('tr', 'transition region')} lies the ${gl('corona')}, at 1–2 MK. Its temperature was a shock when it was discovered around 1940, from emission lines of iron that has lost 9–13 electrons. Heat should not flow from the 5 800 K surface to a hotter corona; something must deposit energy there non-thermally, through the magnetic field.</p>
        <p>The corona is so tenuous that the field dominates it. The ratio of gas to magnetic pressure, the ${gl('beta', 'plasma β')},</p>
        ${eq(`${mi('β')} ${op('=')} ${frac('2' + mi('μ') + '₀' + mi('n') + mi('k') + mi('T'), mi('B') + '²')} ${op('~')} 10⁻²`)}
        <p>is far below one, and since the plasma is a near-perfect conductor its field lines are ${gl('frozen', 'frozen in')}. Hot plasma can flow along the field but not across it, so ${gl('loop', 'coronal loops')} trace the closed field above active regions, the streamers of the white-light corona outline the larger closed structures, and ${gl('hole', 'coronal holes')} mark where the field is open to space.</p>` },
      { h: 'Prominences and flares',
        html: `<p>${gl('prominence', 'Prominences')} are clouds of chromospheric-temperature plasma, a hundred times denser than their surroundings, cradled in dips of the magnetic field tens of thousands of kilometres up. Quiescent ones last weeks or months; on the disc they appear as dark filaments in H-α.</p>
        <p>When the field above an active region is stressed beyond stability, it can relax suddenly by ${gl('reconnection', 'magnetic reconnection')}. A ${gl('flare')} releases up to ~10²⁵ J within minutes, heats plasma to 10–20 MK and accelerates particles to near light speed; often the overlying field and a prominence are blown off together as a ${gl('cme', 'coronal mass ejection')}. Try it: the <em>Flare + CME</em> button in the control panel.</p>` },
      { h: 'Three EUV passbands',
        html: `<p>The corona is invisible against the disc in visible light but bright in the extreme ultraviolet, where the photosphere is dark. Space telescopes such as SDO/AIA image it in narrow bands, each dominated by one ion and hence one temperature. ${gl('he304', 'He II 304 Å')} (≈ 5 × 10⁴ K) shows the top of the chromosphere and the prominences. ${gl('euv', 'Fe IX 171 Å')} (≈ 0.7 MK) shows fine loops and polar plumes. ${gl('fe193', 'Fe XII 193 Å')} (≈ 1.5 MK) shows the hotter, broader corona over active regions and the dark ${gl('hole', 'coronal holes')} most clearly.</p>
        <p>Because the corona is optically thin, the disc brightens towards the limb in these bands, the opposite of white light: the line of sight through a layer of scale height ${mi('H')} lengthens as 1/${mi('μ')} until, at the limb, it reaches √(2π${mi('R')}${mi('H')}). The hotter the line, the larger ${mi('H')} = ${mi('kT')}/${mi('μ')}${mi('m')}<sub>p</sub>${mi('g')}, and the further above the limb it can be followed.</p>` },
      { h: 'Totality',
        html: `<p>The white-light corona is a millionth as bright as the disc - about as bright as the full Moon - and is seen naturally only during ${gl('totality')}. It is the ${gl('kcorona', 'K-corona')}: photospheric light scattered by free electrons, so its brightness at a projected distance ${mi('ρ')} follows the electron density integrated along the line of sight. Baumbach's fit to eclipse photometry,</p>
        ${eq(`${mi('n')}<sub>e</sub>(${mi('r')}) ${op('=')} 10⁸ (2.99&#8201;${mi('r')}⁻¹⁶ + 1.55&#8201;${mi('r')}⁻⁶ + 0.036&#8201;${mi('r')}<sup>−1.5</sup>) cm⁻³`)}
        <p>is what the model and its hover read-out use. Switch to <em>Eclipse</em> and move the cycle slider: at minimum the corona is flattened into long equatorial streamers with fine polar plumes, at maximum it is round and ragged, as eclipse photographs have shown since the 19th century.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'corona', opts: { filter: 1 }, cap: 'A quiescent prominence on the limb in H-α, with the chromosphere glowing along the edge.' },
      { kind: 'sim', view: 'corona', opts: { filter: 3, field: true }, cap: 'The same view in EUV 171 Å with the global magnetic field shown: closed loops (blue) and open field from the polar coronal hole (orange).' },
      { kind: 'sim', view: 'corona', opts: { filter: 2 }, cap: 'He II 304 Å: the prominence glows above a thin bright rim of the transition region.' },
      { kind: 'sim', view: 'overview', opts: { zoom: 0.9, filter: 7, cycle: 0.6 }, cap: 'Totality near solar minimum: equatorial streamers and polar plumes.' },
      { kind: 'sim', view: 'overview', opts: { zoom: 0.9, filter: 7, cycle: 4.5 }, cap: 'Totality near maximum: streamers at all latitudes.' },
      { kind: 'svg', cap: 'Temperature against height in the quiet-Sun atmosphere (rounded, after the VAL C model).', svg: heightChart() },
    ],
    question: { tag: 'Coronal heating', html:
      `<p>What heats the corona? Two families of ideas have competed for decades. In wave heating, convective motions shake the field lines and launch Alfvén waves that dissipate their energy high up. In nanoflare heating, braiding of field lines by the same motions builds up stresses released in countless tiny reconnection events. Both probably operate, but their shares, and how they depend on the region, are unknown. Parker Solar Probe, flying through the corona itself since 2021, and Solar Orbiter are collecting the data to decide.</p>` },
    related: ['sunspots', 'wind', 'photosphere'],
  },

  wind: {
    crumb: 'The solar wind and space weather',
    title: 'The solar wind and space weather',
    lead: 'The corona is too hot to stay bound. It streams away in all directions as the solar wind, dragging the Sun’s magnetic field out into a spiral that fills the heliosphere - and, when the Sun erupts, reaches out to disturb the Earth.',
    facts: [
      ['Slow wind', '≈ 300–500 km/s, from the streamer belt'],
      ['Fast wind', '≈ 700–800 km/s, from coronal holes'],
      ['Density at 1 AU', '≈ 5–10 protons cm⁻³'],
      ['Field at 1 AU', '≈ 5 nT'],
      ['Mass loss', '≈ 1.5 × 10⁹ kg/s'],
      ['Spiral angle at Earth', '≈ 45°'],
      ['Heliopause', '≈ 120 AU (Voyager 1, 2012)'],
      ['CME speeds', '≈ 300–3 000 km/s'],
    ],
    sections: [
      { h: 'Parker’s wind',
        html: `<p>In 1958 Eugene Parker showed that a corona at ~10⁶ K cannot be in hydrostatic equilibrium with the near-vacuum of interstellar space: it must expand. For an isothermal corona with sound speed ${mi('c')}<sub>s</sub> = √(2${mi('kT')}/${mi('m')}<sub>p</sub>), the steady flow obeys</p>
        ${eq(`(${frac(mi('v') + '²', mi('c') + '<sub>s</sub>²')} − 1)&#8201;${frac('1', mi('v'))}${frac('d' + mi('v'), 'd' + mi('r'))} ${op('=')} ${frac('2', mi('r'))} − ${frac(mi('G') + mi('M'), mi('c') + '<sub>s</sub>²' + mi('r') + '²')}`)}
        <p>whose only physical solution passes smoothly through the ${gl('sonic', 'sonic point')} ${mi('r')}<sub>c</sub> = ${mi('GM')}/2${mi('c')}<sub>s</sub>², a few solar radii out, and is supersonic beyond. The chart integrates it: a 1 MK corona gives about 480 km/s at Earth. Parker’s prediction was ridiculed until Mariner 2 measured the wind in 1962.</p>` },
      { h: 'The spiral',
        html: `<p>Each parcel of wind flows almost radially, but its source turns with the Sun. Since the field is ${gl('frozen', 'frozen in')}, the field lines connecting successive parcels to the same source wind up into an Archimedean ${gl('parker', 'Parker spiral')}, at an angle to the radial direction given by</p>
        ${eq(`tan ${mi('ψ')} ${op('=')} ${frac(mi('Ω') + mi('r'), mi('v'))} ${op('≈')} 1 at 1 AU`)}
        <p>In the model, the wind particles flow strictly radially - yet streams from a single source draw the spiral, because the source moves. The field lines (red and blue for the two polarities, separated by the heliospheric current sheet) are fixed in the rotating frame. Fast streams from the coronal holes overtake slow wind ahead of them and compress it into co-rotating interaction regions.</p>` },
      { h: 'Space weather',
        html: `<p>Earth’s ${gl('magnetosphere')} deflects the wind at the magnetopause, about ten Earth radii upstream, behind a standing bow shock. A fast ${gl('cme', 'CME')} whose magnetic field points southward, opposite to Earth’s, reconnects with it and pumps energy into the magnetosphere: a geomagnetic storm, with aurorae far from the poles. The Carrington event of 1859 set telegraph paper on fire; a storm in March 1989 blacked out Québec; in February 2022 a modest storm raised the upper atmosphere’s drag enough to bring down 38 newly launched Starlink satellites; and in May 2024 aurorae were seen far into the subtropics. With <em>Aim at Earth</em> ticked, the <em>Flare + CME</em> button shows the sequence.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'wind', opts: {}, cap: 'The wind from above the ecliptic: slow (blue) and fast (amber) streams, the spiral field and Earth with its bow shock (distances compressed beyond 3 R☉; Earth enlarged).' },
      { kind: 'svg', cap: 'Isothermal Parker wind for three coronal temperatures, solved numerically from the equation in the text.', svg: parkerChart() },
    ],
    question: { tag: 'The origin of the slow wind', html:
      `<p>The fast wind is understood to come from coronal holes. The slow wind is variable, richer in heavy elements with low first-ionisation potential, and has a composition like closed coronal loops - so it seems to be released from closed field, perhaps by reconnection at the edges of the streamers. How, and where exactly, is unresolved. Parker Solar Probe has added a new puzzle: “switchbacks”, sudden S-shaped reversals of the field in the young wind, whose origin is still debated.</p>` },
    related: ['corona', 'sunspots', 'overview'],
  },

  datasheet: {
    crumb: 'Data sheet',
    title: 'Solar data sheet',
    lead: 'Reference values used throughout the book and the model. Nominal values follow IAU 2015 Resolution B3; interior values are rounded from standard solar models.',
    facts: [
      ['GM☉', '1.327 124 × 10²⁰ m³ s⁻²'],
      ['M☉', '1.989 × 10³⁰ kg'],
      ['R☉ (nominal)', '6.957 × 10⁸ m'],
      ['L☉ (nominal)', '3.828 × 10²⁶ W'],
      ['T_eff', '5 772 K'],
      ['1 AU', '1.495 978 707 × 10¹¹ m'],
      ['Solar constant', '1 361 W m⁻²'],
      ['Angular diameter', '≈ 0.53° (32′)'],
      ['Escape velocity', '617.7 km s⁻¹'],
      ['Carrington rotation', '25.38 d sidereal, 27.28 d synodic'],
      ['Main-sequence lifetime', '≈ 10¹⁰ yr'],
    ],
    sections: [
      { h: 'Standard solar model (rounded)',
        html: `<p>The table the hover read-out and the temperature map interpolate (log-linearly in ${mi('T')} and ${mi('ρ')}). Pressure in the read-out is computed from the ideal-gas law with a mean molecular weight of 0.61 in the envelope, rising to 0.85 at the centre where hydrogen has been used up.</p>
        <table class="dt"><thead><tr><th>r / R☉</th><th>T [K]</th><th>ρ [g cm⁻³]</th><th>M(r)/M☉</th><th>L(r)/L☉</th></tr></thead><tbody>
        ${SSM.map((s) => `<tr><td>${s[0].toFixed(3)}</td><td>${s[1] >= 1e5 ? (s[1] / 1e6).toFixed(2) + ' × 10⁶' : s[1].toLocaleString('en-US').replace(/,/g, ' ')}</td><td>${s[2] >= 0.01 ? s[2] : s[2].toExponential(1).replace('e-', ' × 10⁻').replace(/⁻(\d)$/, (m, d) => '⁻' + '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}</td><td>${s[3].toFixed(3)}</td><td>${s[4].toFixed(2)}</td></tr>`).join('')}
        </tbody></table>` },
      { h: 'Sources',
        html: `<p>IAU 2015 Resolution B3 (nominal solar values); Christensen-Dalsgaard et al. 1996, <em>Science</em> 272, 1286 (Model S); Bahcall, Serenelli & Basu 2005, <em>ApJ</em> 621, L85; Snodgrass & Ulrich 1990, <em>ApJ</em> 351, 309 (surface rotation); Vernazza, Avrett & Loeser 1981, <em>ApJS</em> 45, 635 (chromosphere); Allen’s <em>Astrophysical Quantities</em> (Baumbach–Allen corona); Parker 1958, <em>ApJ</em> 128, 664 (solar wind).</p>` },
    ],
    figures: [
      { kind: 'svg', cap: 'Temperature and density profile.', svg: profileChart() },
      { kind: 'svg', cap: 'Enclosed mass and luminosity.', svg: massLumChart() },
    ],
    related: ['interior', 'core', 'overview'],
  },
};

