// Single-crystal silicon for Fab Studio: the wafer's orientation, and the orientation-dependent
// etch rate of silicon in KOH.
//
// Rates. K. Sato, M. Shikida, Y. Matsushima, T. Yamashiro, K. Asaumi, Y. Iriye, M. Yamamoto,
// "Characterization of orientation-dependent etching properties of single-crystal silicon:
// effects of KOH concentration", Sensors and Actuators A 64 (1998) 87–93, Table 1: etch rates of
// twelve orientation families in µm/min at 70 °C, measured on a hemispherical specimen. Between
// the measured families the rate is interpolated linearly over a triangulation of the standard
// stereographic triangle [100]–[110]–[111] (in gnomonic coordinates), so the minimum at {111} is a
// cusp — the property that makes {111} facets stable instead of rounded. Temperature follows an
// Arrhenius law with one activation energy, 0.595 eV (Seidel et al., J. Electrochem. Soc. 137
// (1990) 3612, for (100) in KOH); the anisotropy is taken as independent of temperature, which is
// the main approximation here.
//
// Wafer. Fab Studio's sample axes: x along the sample (a layout direction), y down into the wafer,
// z the slice direction. The wafer is described as its surface orientation, the crystal direction
// of the primary flat, and the rotation of the flat from the layout's x axis (counter-clockwise,
// seen from above). The layout frame is right-handed with the surface normal up: X × Y = up.

export const SATO_KOH = {
  ref: 'Sato et al., Sens. Actuators A 64 (1998) 87, Table 1 (70 °C)',
  tempC: 70,
  concs: [30, 40, 50],                    // wt% KOH
  // family: [h, k, l] (h ≥ k ≥ l ≥ 0) and µm/min at 30, 40, 50 %
  rates: {
    '100': [[1, 0, 0], [0.797, 0.599, 0.539]],
    '110': [[1, 1, 0], [1.455, 1.294, 0.870]],
    '210': [[2, 1, 0], [1.561, 1.233, 0.959]],
    '211': [[2, 1, 1], [1.319, 0.950, 0.621]],
    '221': [[2, 2, 1], [0.714, 0.544, 0.322]],
    '310': [[3, 1, 0], [1.456, 1.088, 0.757]],
    '311': [[3, 1, 1], [1.436, 1.067, 0.746]],
    '320': [[3, 2, 0], [1.543, 1.287, 1.013]],
    '331': [[3, 3, 1], [1.160, 0.800, 0.489]],
    '530': [[5, 3, 0], [1.556, 1.280, 1.033]],
    '540': [[5, 4, 0], [1.512, 1.287, 0.914]],
    '111': [[1, 1, 1], [0.005, 0.009, 0.009]],
  },
  Ea: 0.595,                               // eV
};

// Triangulation of the standard triangle in gnomonic coordinates (u, v) = (k/h, l/h), h ≥ k ≥ l:
// 100 at (0,0), 110 at (1,0), 111 at (1,1). Every measured family is a vertex.
const TRIS = [
  ['100', '310', '311'], ['310', '210', '311'], ['210', '211', '311'], ['210', '530', '211'], ['530', '320', '211'],
  ['320', '540', '211'], ['540', '331', '211'], ['540', '110', '331'], ['211', '331', '221'], ['211', '221', '111'],
];
const uvOf = ([h, k, l]) => [k / h, l / h];

const KB = 8.617333e-5;   // eV/K
export const KOH_CUSP_DEG = 8;    // the {111} cusp is softened within this angle (see koh.js)

// The rate diagram for a concentration and temperature: a function R(nx, ny, nz) in nm/s of the
// crystal-frame unit normal (any sign), tabulated on a 257 × 257 grid over the triangle for speed.
export function kohRateModel(concPct = 30, tempC = 80, table = SATO_KOH, cuspDeg = KOH_CUSP_DEG) {
  const c = Math.min(50, Math.max(30, +concPct || 30));
  const j = c <= 40 ? 0 : 1, f = (c - table.concs[j]) / 10;
  const arr = Math.exp(-(table.Ea / KB) * (1 / (tempC + 273.15) - 1 / (table.tempC + 273.15)));
  const nmPerS = {};
  for (const [k, [, r]] of Object.entries(table.rates)) nmPerS[k] = ((r[j] * (1 - f) + r[j + 1] * f) * arr * 1000) / 60;
  const pts = {};
  for (const [k, [m]] of Object.entries(table.rates)) pts[k] = uvOf(m);
  const N = 256, lut = new Float32Array((N + 1) * (N + 1));
  const bary = (p, a, b, cc) => {
    const d = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1]);
    const l1 = ((b[1] - cc[1]) * (p[0] - cc[0]) + (cc[0] - b[0]) * (p[1] - cc[1])) / d;
    const l2 = ((cc[1] - a[1]) * (p[0] - cc[0]) + (a[0] - cc[0]) * (p[1] - cc[1])) / d;
    return [l1, l2, 1 - l1 - l2];
  };
  const at = (u, v) => {
    let best = null, bestMin = -Infinity;
    for (const t of TRIS) {
      const w = bary([u, v], pts[t[0]], pts[t[1]], pts[t[2]]), mn = Math.min(...w);
      if (mn > bestMin) { bestMin = mn; best = [t, w]; }
      if (mn >= -1e-9) break;
    }
    const [t, w] = best, wc = w.map((x) => Math.max(0, x)), s = wc[0] + wc[1] + wc[2];
    return (wc[0] * nmPerS[t[0]] + wc[1] * nmPerS[t[1]] + wc[2] * nmPerS[t[2]]) / s;
  };
  // within cuspDeg of {111} the linear rise is replaced by a quadratic one (same value and the same
  // R(111)): the measured cusp has no data closer than (221) at 15.8°, and a finite slope at the
  // minimum is what lets the level set hold a {111} facet without numerical drift
  const thc = (cuspDeg * Math.PI) / 180, r111 = nmPerS['111'];
  for (let a = 0; a <= N; a++) for (let b = 0; b <= a; b++) {
    const u = a / N, v = b / N, th = Math.acos(Math.min(1, (1 + u + v) / (Math.sqrt(3) * Math.hypot(1, u, v))));
    let val = at(u, v);
    if (th < thc) val = r111 + (val - r111) * (th / thc);
    lut[a * (N + 1) + b] = val;
  }
  let rMax = 0;
  for (const v of Object.values(nmPerS)) rMax = Math.max(rMax, v);
  // largest angular slope |dR/dθ| (nm/s per rad), for the scheme's dissipation bound: sampled on
  // the table at a ~0.5° step, which resolves the cusp at {111}
  let sMax = 0;
  const R = (nx, ny, nz) => {
    let h = Math.abs(nx), k = Math.abs(ny), l = Math.abs(nz), t;
    if (k > h) { t = h; h = k; k = t; }
    if (l > h) { t = h; h = l; l = t; }
    if (l > k) { t = k; k = l; l = t; }
    if (!(h > 0)) return nmPerS['100'];
    const u = (k / h) * N, v = (l / h) * N;
    let a = Math.floor(u), b = Math.floor(v);
    if (a >= N) a = N - 1;
    if (b > a) b = a;
    const fu = u - a, fv = v - b;
    // bilinear on the lower-triangular table (the (a, b+1) corner may lie off the triangle at b = a)
    const L = (p, q) => lut[p * (N + 1) + Math.min(q, p)];
    return (L(a, b) * (1 - fu) + L(a + 1, b) * fu) * (1 - fv) + (L(a, b + 1) * (1 - fu) + L(a + 1, b + 1) * fu) * fv;
  };
  const dth = 0.5 * Math.PI / 180;
  for (let a = 0; a < 90; a++) for (let b = 0; b <= 90; b++) {
    const th = (a * Math.PI) / 180, ph = (b * Math.PI) / 180;
    const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const n2 = [Math.sin(th + dth) * Math.cos(ph), Math.sin(th + dth) * Math.sin(ph), Math.cos(th + dth)];
    const n3 = [Math.sin(th) * Math.cos(ph + dth), Math.sin(th) * Math.sin(ph + dth), Math.cos(th)];
    const r0 = R(...n);
    sMax = Math.max(sMax, Math.abs(R(...n2) - r0) / dth, Math.sin(th) > 0.05 ? Math.abs(R(...n3) - r0) / (dth * Math.sin(th)) : 0);
  }
  // |∇_s R| tabulated on the same grid (central differences on the sphere, 0.02 rad), so the
  // level set reads the slope with one lookup instead of four rate evaluations
  const slut = new Float32Array((N + 1) * (N + 1)), e = 0.02;
  for (let a = 0; a <= N; a++) for (let b = 0; b <= a; b++) {
    const n = [1, a / N, b / N], l = Math.hypot(...n), nx = n[0] / l, ny = n[1] / l, nz = n[2] / l;
    let t1 = [ny, -nx, 0], l1 = Math.hypot(...t1);
    if (l1 < 0.1) { t1 = [0, nz, -ny]; l1 = Math.hypot(...t1); }
    t1 = t1.map((q) => q / l1);
    const t2 = [ny * t1[2] - nz * t1[1], nz * t1[0] - nx * t1[2], nx * t1[1] - ny * t1[0]];
    const d = (t) => (R(nx + e * t[0], ny + e * t[1], nz + e * t[2]) - R(nx - e * t[0], ny - e * t[1], nz - e * t[2])) / (2 * e);
    slut[a * (N + 1) + b] = Math.hypot(d(t1), d(t2));
  }
  const Sl = (nx, ny, nz) => {
    let h = Math.abs(nx), k = Math.abs(ny), l = Math.abs(nz), t;
    if (k > h) { t = h; h = k; k = t; }
    if (l > h) { t = h; h = l; l = t; }
    if (l > k) { t = k; k = l; l = t; }
    if (!(h > 0)) return 0;
    const a = Math.min(N, Math.round((k / h) * N)), b = Math.min(a, Math.round((l / h) * N));
    return slut[a * (N + 1) + b];
  };
  return { R, S: Sl, rMax, sMax, nmPerS, concPct: c, tempC, N, lut, slut };
}

// ---------------------------------------------------------------- wafer orientation
export const WAFER_SURFACES = { '100': '(100)', '110': '(110)', '111': '(111)' };
// in-plane directions offered as the primary flat, per surface, the usual one first. An ordered
// list, not an object: keys such as '110' and '100' look like integers, and JavaScript enumerates
// those in numeric order, which would make [100] the default flat of a (100) wafer.
export const WAFER_FLAT_LIST = {
  '100': [['110', '[110] — the standard flat; mask edges along it give {111} walls at 54.7°'], ['100', '[100] — 45° to the standard flat; edges along it give vertical {100} walls']],
  '110': [['1-12', '[1̄12] — mask edges along it give vertical {111} walls'], ['1-10', '[1̄10]'], ['001', '[001]'], ['1-11', '[1̄11]']],
  '111': [['1-10', '[1̄10]'], ['11-2', '[112̄]']],
};
export const flatLabelOf = (surface, flat) => ((WAFER_FLAT_LIST[surface] || []).find((f) => f[0] === flat) || [])[1] || '';
const SURF = { '100': [0, 0, 1], '110': [1, 1, 0], '111': [1, 1, 1] };
const DIRS = { '110': [1, 1, 0], '100': [1, 0, 0], '1-12': [-1, 1, 2], '1-10': [-1, 1, 0], '001': [0, 0, 1], '1-11': [-1, 1, 1], '11-2': [1, 1, -2] };
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const DEFAULT_WAFER = { surface: '100', flat: '110', rot: 0 };

export function normalizeWafer(w) {
  const surface = WAFER_SURFACES[w && w.surface] ? w.surface : '100';
  const list = WAFER_FLAT_LIST[surface], flat = list.some((f) => f[0] === (w && w.flat)) ? w.flat : list[0][0];
  const rot = Number.isFinite(+(w && w.rot)) ? +w.rot : 0;
  return { surface, flat, rot };
}

// Crystal-frame unit vectors of the sample axes for a wafer and the sample's azimuth in the layout
// (degrees, counter-clockwise from layout x): {x, z, up} with up = the surface normal, z = up × x
// (the layout's +y for azimuth 0). Sample +y (down) is −up.
export function waferBasis(wafer, azimuthDeg = 0) {
  const w = normalizeWafer(wafer);
  const up = norm(SURF[w.surface]), d = norm(DIRS[w.flat]);
  // layout x is the flat rotated by −rot about up; the sample x is layout x rotated by +azimuth
  const ang = ((azimuthDeg - w.rot) * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang);
  const e2 = cross(up, d);                         // d rotated +90° about up
  const x = norm([c * d[0] + s * e2[0], c * d[1] + s * e2[1], c * d[2] + s * e2[2]]);
  return { x, z: cross(up, x), up, wafer: w };
}

// Miller-ish label of a crystal direction (the smallest integer triple within 2 %, else rounded).
export function dirLabel(v) {
  for (let m = 1; m <= 12; m++) {
    const big = Math.max(...v.map(Math.abs)), t = v.map((x) => (x / big) * m);
    if (t.every((x) => Math.abs(x - Math.round(x)) < 0.02 * m)) {
      const r = t.map(Math.round), g = (a, b) => (b ? g(b, a % b) : a), gg = r.reduce((a, b) => g(Math.abs(a), Math.abs(b)));
      return '[' + r.map((x) => x / (gg || 1)).map((x) => (x < 0 ? x + '' : x)).join(' ') + ']';
    }
  }
  return '[' + v.map((x) => x.toFixed(2)).join(' ') + ']';
}
