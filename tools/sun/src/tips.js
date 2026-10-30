// Hover read-outs for the scene. Each takes a physical location and returns a small HTML card;
// the numbers come from the same solar-model table and formulas the textbook quotes.
import { ssmAt, zoneOf, coronaNe, omegaDeg } from './model.js';
import { SPOTS, AR_N, AR_S, DEG, R_SUN_KM, dirLL, trueR, AU_RSUN } from './spec.js';

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function sci(x, digits = 2) {
  if (!isFinite(x)) return '–';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e <= 4) return (+x.toPrecision(digits)).toLocaleString('en-US');
  const m = x / Math.pow(10, e);
  return `${m.toFixed(digits - 1)} × 10${String(e).split('').map((c) => SUP[c]).join('')}`;
}
const km = (r) => Math.round(r * R_SUN_KM).toLocaleString('en-US').replace(/,/g, ' ');
const MK = (T) => (T >= 1e5 ? `${(T / 1e6).toFixed(T >= 1e7 ? 1 : 2)} MK` : `${Math.round(T).toLocaleString('en-US').replace(/,/g, ' ')} K`);
const row = (k, v) => `<div class="tip-r"><span>${k}</span><b>${v}</b></div>`;
const card = (title, sub, rows, note) =>
  `<div class="tip-h">${title}</div>${sub ? `<div class="tip-s">${sub}</div>` : ''}${rows.join('')}${note ? `<div class="tip-n">${note}</div>` : ''}`;

const ZONE = {
  core: ['Core', 'Hydrogen fuses to helium here: 99 % of the Sun’s power comes from inside 0.25 R☉.'],
  radiative: ['Radiative zone', 'Energy crawls outwards as photons, absorbed and re-emitted countless times.'],
  tachocline: ['Tachocline', 'Shear layer between the rigidly rotating interior and the differentially rotating convection zone - a likely seat of the dynamo.'],
  convection: ['Convection zone', 'Too opaque for radiation to cope: hot plasma rises, cools at the top and sinks.'],
  photosphere: ['Photosphere', 'The layer where the Sun becomes transparent and its light escapes.'],
};

export function interiorTip(r) {
  const s = ssmAt(r), z = zoneOf(r);
  return card(ZONE[z][0], `r = ${r.toFixed(3)} R☉ · ${km(r)} km from the centre`, [
    row('Temperature', MK(s.T)),
    row('Density', `${sci(s.rho)} g cm⁻³`),
    row('Pressure', `${sci(s.P)} Pa`),
    row('Mass inside, m(r)', `${(s.m * 100).toFixed(s.m > 0.99 ? 2 : 1)} % M☉`),
    row('Luminosity inside, L(r)', `${(s.l * 100).toFixed(0)} % L☉`),
  ], ZONE[z][1]);
}

// What the current instrument measures at this point: one extra, highlighted row.
// kind: 'umbra' | 'pen' | 'pore' | 'plage' | 'quiet'; sgn: polarity of the spot/region
function instrumentRow(o, kind, sgn, mu, lat) {
  const f = o.filter;
  const tag = (k, v) => `<div class="tip-r tip-i"><span>${k}</span><b>${v}</b></div>`;
  if (f === 1) return tag('Hα (≈ 10⁴ K)', kind === 'umbra' ? 'dark: the spot shows through' : kind === 'plage' ? 'bright plage' : 'mottles, fibrils, network');
  if (f === 2) return tag('He II 304 (≈ 5 × 10⁴ K)', kind === 'plage' || kind === 'pen' ? 'bright: transition region over plage' : 'network of the transition region');
  if (f === 3 || f === 4) {
    const hl = 55 + 37 * (o.act ?? 0.6);
    return tag(f === 3 ? 'Fe IX 171 (0.7 MK)' : 'Fe XII 193 (1.5 MK)', Math.abs(lat) > hl ? 'coronal hole: open field, dark' : kind === 'quiet' ? 'quiet corona over the network' : 'active-region corona, loops');
  }
  if (f === 5) {
    const B = { umbra: 2600, pen: 1300, pore: 1500, plage: 220 }[kind];
    if (B) return tag('B∥ = B μ', `≈ ${sgn > 0 ? '+' : '−'}${Math.round(B * mu / 10) * 10} G (${sgn > 0 ? 'white, towards us' : 'black, away'})`);
    if (Math.abs(lat) > 60) { const s = Math.sign(lat) * (o.polarN ?? 1); return tag('B∥ = B μ', `polar field ≈ ${s > 0 ? '+' : '−'}${Math.round(Math.abs(o.polarN ?? 1) * 10 * mu)}–${Math.round(Math.abs(o.polarN ?? 1) * 120 * mu)} G`); }
    return tag('B∥ = B μ', 'mixed network, ≈ ±10–100 G');
  }
  if (f === 6) {
    const v = o.vlos ?? 0;
    return tag('v∥ from rotation', `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} km/s (${v >= 0 ? 'red, away' : 'blue, towards us'}) ± 0.4 supergranules ± 0.3 p modes`);
  }
  return '';
}

// local: unit vector in the Sun's own frame; mu: cosine of the viewing angle;
// o: { filter, spotVis, vlos, polarN, act } from the scene
export function surfaceTip(local, mu, o = {}) {
  const lat = Math.asin(local.y) / DEG;
  let lon = Math.atan2(-local.z, local.x) / DEG;
  if (o.filter === 7) return card('The Moon', 'total solar eclipse', [row('Covers', 'the photosphere, exactly - by chance, 400× smaller and 400× closer')],
    'With the disc hidden, the faint corona (a millionth as bright) and the pink chromosphere become visible.');
  const vis = o.spotVis ?? 1;
  const ang = (s) => Math.acos(Math.min(1, dirLL(s.lat, s.lon).reduce((a, c, i) => a + c * [local.x, local.y, local.z][i], 0)));
  for (const s of SPOTS) {
    const a = ang(s) / DEG, r = s.r * vis;
    if (vis > 0.05 && a < r * 1.03) {
      const umbra = a < r * (s.r < 0.5 ? 0.75 : 0.42);
      const pol = s.pol > 0 ? '+ (field out of the Sun)' : '− (field into the Sun)';
      if (s.role === 'pore') {
        return card('Pore', 'a small spot with no penumbra', [row('Temperature', '≈ 4 800–5 500 K'), row('Field', '≈ 0.1–0.2 T'), row('Diameter', `≈ ${Math.round(2 * r * DEG * R_SUN_KM / 100) * 100} km`), instrumentRow(o, 'pore', s.pol, mu, lat)],
          'Pores are flux tubes too thin to form a penumbra; many grow into, or decay from, sunspots.');
      }
      return card(umbra ? 'Sunspot umbra' : 'Sunspot penumbra', `${s.role} · polarity ${pol}`, umbra
        ? [row('Temperature', '≈ 3 900–4 200 K'), row('Brightness', '≈ 20 % of the quiet Sun'), row('Magnetic field', '≈ 0.25–0.35 T (vertical)'), row('Spot diameter', `≈ ${Math.round(2 * r * DEG * R_SUN_KM / 1000) * 1000} km`), instrumentRow(o, 'umbra', s.pol, mu, lat)]
        : [row('Temperature', '≈ 5 400 K'), row('Brightness', '≈ 75 % of the quiet Sun'), row('Magnetic field', '≈ 0.1–0.2 T, inclined'), row('Evershed outflow', '≈ 1–2 km/s'), instrumentRow(o, 'pen', s.pol, mu, lat)],
        umbra ? 'Strong magnetic field chokes off convection, so less heat reaches the surface and the spot is cooler and darker.'
          : 'Bright and dark filaments of nearly horizontal field; gas streams outwards along the dark ones (Evershed flow).');
    }
  }
  const near = (a) => Math.acos(Math.min(1, dirLL(a.lat, a.lon).reduce((s, c, i) => s + c * [local.x, local.y, local.z][i], 0))) / DEG;
  const ar = vis > 0.05 ? [AR_N, AR_S].find((a) => near(a) < a.plage * 0.8) : null;
  // plage polarity: that of the nearest spot (bipolar regions)
  let sgn = 1;
  if (ar) { let best = 1e9; for (const s of SPOTS) { const a = ang(s); if (a < best) { best = a; sgn = s.pol; } } }
  const Tloc = 5772 * Math.pow(0.75 * (mu + 2 / 3), 0.25);
  const period = 360 / omegaDeg(lat);
  if (lon < 0) lon += 360;
  return card(ar ? 'Active region (plage)' : 'Photosphere', `heliographic latitude ${lat.toFixed(1)}°, longitude ${lon.toFixed(0)}°`, [
    row('Effective temperature', '5 772 K'),
    row(`Seen layer, T(τ = μ)`, `≈ ${Math.round(Tloc / 10) * 10} K (μ = ${mu.toFixed(2)})`),
    row('Limb darkening I/I₀', `${(0.4 + 0.6 * mu).toFixed(2)}`),
    row('Rotation period here', `${period.toFixed(1)} days (sidereal)`),
    row('Granules', '≈ 1 000–1 500 km, live ≈ 5–10 min'),
    instrumentRow(o, ar ? 'plage' : 'quiet', sgn, mu, lat),
  ], ar ? 'Concentrated magnetic field outside the spots: the faculae, bright near the limb, outshine the spots and make the Sun slightly brighter at solar maximum.'
    : 'Each bright cell is a granule - the top of a convection plume, about the size of a large country.');
}

// p: distance from the Sun's centre (R☉) of the point where the line of sight passes closest
export function offDiscTip(p, filter, windView) {
  const h = (p - 1) * R_SUN_KM;
  if (p < 1.006) {
    return card('Chromosphere', `${Math.round(h)} km above the photosphere`, [
      row('Temperature', '≈ 4 000 K (minimum) → 20 000 K'), row('Thickness', '≈ 2 000 km (drawn ≈ 2× thicker)'), row('Density', '≈ 10⁻¹⁰–10⁻¹³ g cm⁻³'),
      row('Seen best in', 'H-α 656.3 nm, Ca II H & K')],
      'A forest of spicules: jets of chromospheric gas shot up at 20-100 km/s, lasting a few minutes.');
  }
  if (p < 1.012) {
    return card('Transition region / low corona', `${Math.round(h).toLocaleString('en-US').replace(/,/g, ' ')} km up`, [
      row('Temperature', '2 × 10⁴ → 10⁶ K within a few hundred km'), row('Seen in', 'UV and EUV emission lines (C IV, O VI, Fe IX)')],
      'The temperature jumps by a factor of fifty over a layer thinner than the chromosphere.');
  }
  const pt = windView ? trueR(p) : p;
  if (pt < 8) {
    const ne = coronaNe(pt);
    return card('Corona', `${pt.toFixed(2)} R☉ from Sun centre`, [
      row('Temperature', '≈ 1–2 MK'),
      row('Electron density', `${sci(ne)} cm⁻³ (Baumbach–Allen)`),
      row('Brightness vs disc', `≈ ${sci(1e-6 * (0.0532 * Math.pow(pt, -2.5) + 1.425 * Math.pow(pt, -7) + 2.565 * Math.pow(pt, -17)), 1)}`),
      row('Plasma β', '≪ 1 - the field shapes the gas'),
    ], {
      2: 'He II 304 Å forms at ≈ 5 × 10⁴ K: only a thin bright rim and the prominences reach above the limb.',
      3: 'Fe IX 171 Å forms at ≈ 0.7 MK: the corona falls off with a scale height of ≈ 35 000 km; polar plumes trace the open field.',
      4: 'Fe XII 193 Å forms at ≈ 1.5 MK: hotter, with a larger scale height (≈ 60 000 km) - streamers over active regions stand out.',
      7: 'At totality the K-corona is seen directly: photospheric light scattered by free electrons. Its shape follows the cycle - round at maximum, flattened along the equator at minimum.',
    }[filter] || 'Electrons scatter photospheric light (K-corona); the streamers trace closed magnetic field, the dark gaps open field.');
  }
  const r = pt;
  return card('Solar wind', windView ? `≈ ${r.toFixed(0)} R☉ (${(r / AU_RSUN).toFixed(2)} AU) - picture compressed beyond 3 R☉` : `${r.toFixed(1)} R☉ from Sun centre`, [
    row('Speed', 'slow ≈ 400 km/s · fast ≈ 750 km/s'),
    row('Proton density', `≈ ${sci(7 * Math.pow(AU_RSUN / r, 2))} cm⁻³ (∝ r⁻²)`),
    row('Mass loss', '≈ 1.5 × 10⁹ kg/s'),
  ], 'The corona is too hot to be held by gravity; it expands supersonically into space, dragging the magnetic field with it.');
}

export const OBJ = {
  loop: () => card('Coronal loop', 'closed magnetic field filled with hot plasma', [
    row('Temperature', '≈ 1–3 MK'), row('Length', '≈ 10⁴–10⁵ km'), row('Electron density', '≈ 10⁹–10¹⁰ cm⁻³'), row('Plasma β', '≈ 0.01')],
    'Hot plasma cannot cross field lines, so it outlines them - the loops are the magnetic field made visible.'),
  prom: () => card('Prominence', 'cool plasma suspended in the hot corona', [
    row('Temperature', '≈ 7 000–10 000 K'), row('Density', '≈ 100× the surrounding corona'), row('Height', `≈ ${Math.round(0.12 * R_SUN_KM / 1000) * 1000} km here`), row('Lifetime', 'days to months (quiescent)')],
    'Seen against the disc it is a dark filament; at the limb it glows red in H-α. Magnetic dips hold it up against gravity.'),
  earth: () => card('Earth', 'drawn ≈ 30× too large, ≈ 10× too close', [
    row('Distance', '1 AU = 1.496 × 10⁸ km = 215 R☉'), row('Light travel time', '8 min 19 s'), row('Solar constant', '1 361 W m⁻²'), row('Wind travel time', '≈ 4 days at 400 km/s')],
    'Earth’s magnetic field holds off the wind at the magnetopause, ~10 Earth radii upstream; the bow shock stands in front of it.'),
  bow: () => card('Bow shock', 'where the supersonic wind is slowed by Earth’s field', [
    row('Stand-off distance', '≈ 13–15 Earth radii (real)'), row('Wind Mach number', '≈ 8')],
    'Behind it the shocked wind (magnetosheath) flows around the magnetosphere.'),
  cme: () => card('Coronal mass ejection', 'a magnetised plasma cloud leaving the Sun', [
    row('Mass', '≈ 10¹¹–10¹³ kg'), row('Speed', '≈ 300–3 000 km/s'), row('Kinetic energy', 'up to ≈ 10²⁵ J'), row('Travel to Earth', '≈ 1–4 days')],
    'An Earth-directed CME with southward magnetic field drives geomagnetic storms and aurorae.'),
  walk: () => card('A photon’s random walk', 'one path, steps magnified ≈ 10¹⁰×', [
    row('Mean free path', '< 0.1 mm (core) … a few mm'), row('Steps to escape', '≈ (R/ℓ)² ~ 10²²–10²⁴'), row('Diffusion time', '~10⁴–10⁵ years')],
    'In open space light crosses 0.7 R☉ in 1.6 s. Here it takes tens of thousands of years.'),
};
