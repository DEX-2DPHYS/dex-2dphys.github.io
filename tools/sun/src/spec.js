// Where things sit on the Sun. Shared by the scene and the textbook (annotation pins, captions),
// so the two can never disagree about where a sunspot or the prominence is.
//
// Sun-local frame: 1 unit = 1 R☉, +y is the rotation axis (north), longitude runs from +x
// towards -z, which is the sense the Sun turns in (counter-clockwise seen from the north).
export const DEG = Math.PI / 180;
export const R_SUN_KM = 695700;

export function dirLL(latDeg, lonDeg) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

// Active regions. The northern one is the hero of the Sunspots view; the southern one is
// there so that Hale's law (opposite leader polarity in the two hemispheres) can be shown.
// r is the penumbral radius in degrees of heliographic arc (1° = 12 100 km).
export const AR_N = { lat: 16, lon: 0, plage: 8.5 };
export const AR_S = { lat: -11, lon: 150, plage: 6 };
export const SPOTS = [
  { id: 'leadN',   lat: 14.6, lon: 5.0,   r: 1.35, pol: +1, role: 'leading spot' },
  { id: 'followN', lat: 17.6, lon: -5.2,  r: 1.0,  pol: -1, role: 'following spot' },
  { id: 'poreA',   lat: 15.6, lon: 1.6,   r: 0.34, pol: +1, role: 'pore' },
  { id: 'poreB',   lat: 16.9, lon: -2.4,  r: 0.38, pol: -1, role: 'pore' },
  { id: 'poreC',   lat: 13.9, lon: 7.6,   r: 0.42, pol: +1, role: 'pore' },
  { id: 'leadS',   lat: -10.2, lon: 154,  r: 0.9,  pol: -1, role: 'leading spot' },
  { id: 'followS', lat: -12.4, lon: 146.5, r: 0.75, pol: +1, role: 'following spot' },
];

// A quiescent prominence: an arch of cool plasma standing above the southern limb.
export const PROM = { lat: -19, lon: 95, span: 15, h: 0.12 };

// Wind view: Earth sits at 21.5 R☉ instead of 215 R☉ (distances beyond 3 R☉ are compressed)
// and is drawn about 30 times too large, or it would be a speck 1/109 of the Sun across.
export const EARTH_X = 21.5;
export const EARTH_R = 0.3;
export const AU_RSUN = 215.03;
// screen distance -> true distance in R☉: true scale up to 3 R☉, linear compression beyond
export const trueR = (r) => (r <= 3 ? r : 3 + (r - 3) * (AU_RSUN - 3) / (EARTH_X - 3));
