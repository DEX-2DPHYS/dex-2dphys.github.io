// Chapter diagrams, drawn as SVG at build time from the same model table and formulas the
// scene uses (model.js), so a chart cannot disagree with the hover read-outs.
// viewBox is 320 wide; label sizes are chosen to land near the caption size once scaled.
import { ssmAt, parkerV, omegaDeg } from '../model.js';
import { svgOpen } from './kit.js';

const f = (x) => (+x).toFixed(1);
const SUPS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const pow10 = (e) => '10' + String(e).split('').map((c) => SUPS[c]).join('');
const path = (pts) => 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L');

// plot frame: maps data to the box [x0,x1]×[y0,y1] (y1 at the bottom)
function frame(x0, x1, y0, y1, X, Y, logX = false) {
  const tx = logX ? (v) => x0 + (Math.log10(v) - Math.log10(X[0])) / (Math.log10(X[1]) - Math.log10(X[0])) * (x1 - x0)
    : (v) => x0 + (v - X[0]) / (X[1] - X[0]) * (x1 - x0);
  const ty = (v) => y1 - (v - Y[0]) / (Y[1] - Y[0]) * (y1 - y0);
  return { tx, ty, box: `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="currentColor" class="axl"/>` };
}

// ---------------------------------------------------------------- T(r) and ρ(r)
export function profileChart() {
  const x0 = 36, x1 = 286, y0 = 12, y1 = 150;
  const F = frame(x0, x1, y0, y1, [0, 1], [3.5, 7.5]);
  const tr = (lr) => y1 - (lr + 7) / 10 * (y1 - y0);         // right axis: log ρ from -7 to 3
  const T = [], R = [];
  for (let i = 0; i <= 200; i++) { const r = i / 200, s = ssmAt(r); T.push([F.tx(r), F.ty(Math.log10(s.T))]); R.push([F.tx(r), tr(Math.log10(s.rho))]); }
  let g = '';
  g += `<rect x="${F.tx(0)}" y="${y0}" width="${F.tx(0.25) - F.tx(0)}" height="${y1 - y0}" fill="#f6c768" opacity=".22"/>`;
  g += `<rect x="${F.tx(0.25)}" y="${y0}" width="${F.tx(0.713) - F.tx(0.25)}" height="${y1 - y0}" fill="#f19a4a" opacity=".12"/>`;
  g += `<rect x="${F.tx(0.713)}" y="${y0}" width="${F.tx(1) - F.tx(0.713)}" height="${y1 - y0}" fill="#d0542a" opacity=".12"/>`;
  g += `<text x="${F.tx(0.125)}" y="${y0 + 9}" class="dls" text-anchor="middle">core</text>`;
  g += `<text x="${F.tx(0.48)}" y="${y0 + 9}" class="dls" text-anchor="middle">radiative zone</text>`;
  g += `<text x="${F.tx(0.856)}" y="${y0 + 9}" class="dls" text-anchor="middle">convection</text>`;
  for (let e = 4; e <= 7; e++) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(e)}" y2="${F.ty(e)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(e) + 2}" class="ax" text-anchor="end" fill="#d06a1e">${pow10(e)}</text>`;
  for (let e = -6; e <= 2; e += 2) g += `<text x="${x1 + 3}" y="${tr(e) + 2}" class="ax" fill="#2f78bd">${pow10(e)}</text>`;
  for (let r = 0; r <= 1.001; r += 0.2) g += `<text x="${F.tx(r)}" y="${y1 + 9}" class="ax" text-anchor="middle">${r.toFixed(1)}</text>`;
  g += `<path d="${path(T)}" fill="none" stroke="#e8742a" stroke-width="1.8"/>`;
  g += `<path d="${path(R)}" fill="none" stroke="#3b82c4" stroke-width="1.8"/>`;
  g += `<text x="${F.tx(0.32)}" y="${F.ty(7.05)}" class="dl" fill="#d06a1e">T  [K]</text>`;
  g += `<text x="${F.tx(0.55)}" y="${tr(1.1)}" class="dl" fill="#2f78bd">ρ  [g cm⁻³]</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">radius  r / R☉</text>`;
  return svgOpen(176) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- m(r) and L(r)
export function massLumChart() {
  const x0 = 30, x1 = 306, y0 = 10, y1 = 118;
  const F = frame(x0, x1, y0, y1, [0, 1], [0, 1]);
  const M = [], L = [];
  for (let i = 0; i <= 200; i++) { const r = i / 200, s = ssmAt(r); M.push([F.tx(r), F.ty(s.m)]); L.push([F.tx(r), F.ty(s.l)]); }
  let g = '';
  for (let v = 0; v <= 1.001; v += 0.5) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(v)}" y2="${F.ty(v)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(v) + 2}" class="ax" text-anchor="end">${v.toFixed(1)}</text>`;
  for (let r = 0; r <= 1.001; r += 0.2) g += `<text x="${F.tx(r)}" y="${y1 + 9}" class="ax" text-anchor="middle">${r.toFixed(1)}</text>`;
  g += `<line x1="${F.tx(0.25)}" x2="${F.tx(0.25)}" y1="${y0}" y2="${y1}" class="grid" stroke-dasharray="2 2"/>`;
  g += `<path d="${path(L)}" fill="none" stroke="#d4a017" stroke-width="1.8"/>`;
  g += `<path d="${path(M)}" fill="none" stroke="#7a5bd6" stroke-width="1.8"/>`;
  g += `<text x="${F.tx(0.29)}" y="${F.ty(0.9)}" class="dl" fill="#b88a0c">L(r) / L☉</text>`;
  g += `<text x="${F.tx(0.33)}" y="${F.ty(0.5)}" class="dl" fill="#6a4bc6">M(r) / M☉</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">radius  r / R☉</text>`;
  return svgOpen(142) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- Gamow peak
export function gamowChart() {
  const x0 = 34, x1 = 306, y0 = 10, y1 = 128;
  const kT = 1.353, EG = 493;                       // keV, at T = 15.7 MK, for p + p
  const F = frame(x0, x1, y0, y1, [0, 30], [-14, 0]);
  const mb = [], tun = [], prod = [];
  for (let i = 1; i <= 300; i++) {
    const E = i * 0.1;
    const a = -E / kT / Math.LN10, b = -Math.sqrt(EG / E) / Math.LN10;
    if (a > -14) mb.push([F.tx(E), F.ty(a)]);
    if (b > -14) tun.push([F.tx(E), F.ty(b)]);
    if (a + b > -14) prod.push([F.tx(E), F.ty(a + b)]);
  }
  const E0 = Math.cbrt(EG * kT * kT / 4);
  let g = '';
  for (let e = -12; e <= 0; e += 4) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(e)}" y2="${F.ty(e)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(e) + 2}" class="ax" text-anchor="end">${pow10(e)}</text>`;
  for (let E = 0; E <= 30; E += 5) g += `<text x="${F.tx(E)}" y="${y1 + 9}" class="ax" text-anchor="middle">${E}</text>`;
  g += `<path d="${path(mb)}" fill="none" stroke="#3b82c4" stroke-width="1.6"/>`;
  g += `<path d="${path(tun)}" fill="none" stroke="#7a5bd6" stroke-width="1.6"/>`;
  g += `<path d="${path(prod)}" fill="none" stroke="#e8742a" stroke-width="2.2"/>`;
  g += `<line x1="${F.tx(E0)}" x2="${F.tx(E0)}" y1="${y0}" y2="${y1}" stroke="#e8742a" stroke-dasharray="2 2" stroke-width=".8"/>`;
  g += `<text x="${F.tx(E0) + 3}" y="${y0 + 8}" class="dl" fill="#d06a1e">Gamow peak E₀ ≈ ${E0.toFixed(1)} keV</text>`;
  g += `<text x="${F.tx(4.2)}" y="${F.ty(-12.8)}" class="dls" fill="#2f78bd">Maxwell–Boltzmann e^(−E/kT)</text>`;
  g += `<text x="${F.tx(13)}" y="${F.ty(-1.6)}" class="dls" fill="#6a4bc6">tunnelling e^(−√(E_G/E))</text>`;
  g += `<text x="${F.tx(14)}" y="${F.ty(-9.4)}" class="dls" fill="#d06a1e">product: reaction window</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">relative energy E  [keV]   (kT = ${kT.toFixed(2)} keV)</text>`;
  return svgOpen(152) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- Planck spectrum
export function planckChart() {
  const x0 = 26, x1 = 310, y0 = 22, y1 = 128;
  const F = frame(x0, x1, y0, y1, [200, 2000], [0, 1.08]);
  const B = (lnm, T) => { const l = lnm * 1e-9; return 1 / (l ** 5 * (Math.exp(0.0143877 / (l * T)) - 1)); };
  const peak = B(2.8978e6 / 5772, 5772);
  const sun = [], spot = [];
  for (let l = 200; l <= 2000; l += 5) { sun.push([F.tx(l), F.ty(B(l, 5772) / peak)]); spot.push([F.tx(l), F.ty(B(l, 3950) / peak)]); }
  let g = `<defs><linearGradient id="vis" x1="0" x2="1">
    <stop offset="0" stop-color="#7b3fe0"/><stop offset=".18" stop-color="#3b5bff"/><stop offset=".33" stop-color="#22b5ff"/>
    <stop offset=".45" stop-color="#2fd36b"/><stop offset=".58" stop-color="#e8e23a"/><stop offset=".72" stop-color="#ff9a2a"/><stop offset="1" stop-color="#e3242b"/></linearGradient></defs>`;
  g += `<rect x="${F.tx(380)}" y="${y0}" width="${F.tx(750) - F.tx(380)}" height="${y1 - y0}" fill="url(#vis)" opacity=".22"/>`;
  for (let l = 250; l <= 2000; l += 250) g += `<text x="${F.tx(l)}" y="${y1 + 9}" class="ax" text-anchor="middle">${l}</text>`;
  g += `<path d="${path(spot)}" fill="none" stroke="#9a5a2a" stroke-width="1.3" stroke-dasharray="3 2"/>`;
  g += `<path d="${path(sun)}" fill="none" stroke="#e8742a" stroke-width="1.9"/>`;
  const lines = [[393.4, 'K'], [396.8, 'H'], [486.1, 'F'], [517.3, 'b'], [589.3, 'D'], [656.3, 'C (Hα)']];
  lines.forEach(([l, n], i) => {
    g += `<line x1="${F.tx(l)}" x2="${F.tx(l)}" y1="${y0}" y2="${y1}" stroke="#222" stroke-width=".55" opacity=".55"/>`;
    g += `<text x="${F.tx(l)}" y="${y0 - 3 - (i % 2) * 7}" class="ax" text-anchor="middle">${n}</text>`;
  });
  g += `<text x="${F.tx(1050)}" y="${F.ty(0.72)}" class="dl" fill="#d06a1e">5 772 K (photosphere)</text>`;
  g += `<text x="${F.tx(1150)}" y="${F.ty(0.22)}" class="dls" fill="#8a4a1a">3 950 K (umbra), same scale</text>`;
  g += `<text x="${F.tx(502) + 3}" y="${F.ty(1.04)}" class="dls">peak 502 nm</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">wavelength  [nm]   (black-body B_λ, normalised)</text>`;
  return svgOpen(152) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- limb darkening
export function limbChart() {
  const x0 = 30, x1 = 200, y0 = 10, y1 = 110;
  const F = frame(x0, x1, y0, y1, [0, 1], [0, 1.05]);
  const ed = [];
  for (let i = 0; i <= 100; i++) { const x = i / 100, mu = Math.sqrt(1 - x * x); ed.push([F.tx(x), F.ty(0.4 + 0.6 * mu)]); }
  let g = '';
  for (let v = 0; v <= 1.001; v += 0.5) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(v)}" y2="${F.ty(v)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(v) + 2}" class="ax" text-anchor="end">${v.toFixed(1)}</text>`;
  for (let r = 0; r <= 1.001; r += 0.5) g += `<text x="${F.tx(r)}" y="${y1 + 9}" class="ax" text-anchor="middle">${r.toFixed(1)}</text>`;
  g += `<path d="${path(ed)}" fill="none" stroke="#e8742a" stroke-width="1.9"/>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">distance from disc centre / R☉</text>`;
  g += `<text x="${F.tx(0.06)}" y="${F.ty(0.62)}" class="dls">I(μ)/I(1) = 0.4 + 0.6 μ</text>`;
  // the disc itself, rendered with the same law
  g += `<defs><radialGradient id="ld"><stop offset="0" stop-color="#fff6dc"/><stop offset=".6" stop-color="#ffe2a0"/><stop offset=".85" stop-color="#f6b25a"/><stop offset="1" stop-color="#c8742c"/></radialGradient></defs>`;
  g += `<circle cx="262" cy="60" r="46" fill="url(#ld)"/><text x="262" y="122" class="dls" text-anchor="middle">brighter centre, redder limb</text>`;
  return svgOpen(134) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- Parker wind
export function parkerChart() {
  const x0 = 34, x1 = 306, y0 = 10, y1 = 128;
  const F = frame(x0, x1, y0, y1, [1, 300], [0, 900], true);
  let g = '';
  g += `<rect x="${x0}" y="${F.ty(500)}" width="${x1 - x0}" height="${F.ty(300) - F.ty(500)}" fill="#3b82c4" opacity=".08"/>`;
  g += `<rect x="${x0}" y="${F.ty(800)}" width="${x1 - x0}" height="${F.ty(700) - F.ty(800)}" fill="#e8742a" opacity=".08"/>`;
  g += `<text x="${x0 + 3}" y="${F.ty(310)}" class="ax" fill="#2f78bd">observed slow wind</text>`;
  g += `<text x="${x0 + 3}" y="${F.ty(710)}" class="ax" fill="#d06a1e">observed fast wind</text>`;
  for (const v of [0, 300, 600, 900]) g += `<text x="${x0 - 3}" y="${F.ty(v) + 2}" class="ax" text-anchor="end">${v}</text>`;
  for (const r of [1, 3, 10, 30, 100, 300]) g += `<line x1="${F.tx(r)}" x2="${F.tx(r)}" y1="${y0}" y2="${y1}" class="grid"/><text x="${F.tx(r)}" y="${y1 + 9}" class="ax" text-anchor="middle">${r}</text>`;
  g += `<line x1="${F.tx(215)}" x2="${F.tx(215)}" y1="${y0}" y2="${y1}" stroke="#2a8a4a" stroke-dasharray="3 2" stroke-width=".9"/><text x="${F.tx(215) - 2}" y="${y0 + 8}" class="dls" text-anchor="end" fill="#2a8a4a">1 AU</text>`;
  const cols = { 1e6: '#7a5bd6', 1.5e6: '#3b82c4', 2e6: '#e8742a' };
  for (const T of [1e6, 1.5e6, 2e6]) {
    const pts = [];
    for (let i = 0; i <= 160; i++) { const r = Math.pow(10, Math.log10(1.02) + i / 160 * (Math.log10(300) - Math.log10(1.02))); pts.push([F.tx(r), F.ty(Math.min(900, parkerV(r, T).v))]); }
    const pv = parkerV(215, T);
    g += `<path d="${path(pts)}" fill="none" stroke="${cols[T]}" stroke-width="1.7"/>`;
    g += `<circle cx="${F.tx(pv.rc)}" cy="${F.ty(pv.cs)}" r="2" fill="${cols[T]}"/>`;
    g += `<text x="${F.tx(240)}" y="${F.ty(pv.v) + 2}" class="ax" fill="${cols[T]}">${T / 1e6} MK: ${Math.round(pv.v)}</text>`;
  }
  g += `<text x="${F.tx(1.2)}" y="${F.ty(860)}" class="dls">dots: sonic point r_c, where v = c_s</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">distance r / R☉ (log)   —   speed v [km/s]</text>`;
  return svgOpen(152) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- internal rotation
export function rotationChart() {
  const x0 = 34, x1 = 250, y0 = 10, y1 = 128;
  const F = frame(x0, x1, y0, y1, [0.4, 1.0], [330, 490]);
  const nHz = (dd) => dd / 360 / 86400 * 1e9;
  const Orad = 435;
  const sig = (x) => 1 / (1 + Math.exp(-x));
  let g = '';
  for (const v of [350, 400, 450]) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(v)}" y2="${F.ty(v)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(v) + 2}" class="ax" text-anchor="end">${v}</text>`;
  for (let r = 0.4; r <= 1.001; r += 0.1) g += `<text x="${F.tx(r)}" y="${y1 + 9}" class="ax" text-anchor="middle">${r.toFixed(1)}</text>`;
  g += `<rect x="${F.tx(0.69)}" y="${y0}" width="${F.tx(0.725) - F.tx(0.69)}" height="${y1 - y0}" fill="#e8742a" opacity=".14"/>`;
  g += `<text x="${F.tx(0.707)}" y="${y1 - 4}" class="ax" text-anchor="middle" fill="#d06a1e">tachocline</text>`;
  const cols = { 0: '#e8742a', 30: '#3b82c4', 60: '#7a5bd6' };
  for (const lat of [0, 30, 60]) {
    const Os = nHz(omegaDeg(lat));
    const pts = [];
    for (let i = 0; i <= 150; i++) {
      const r = 0.4 + 0.6 * i / 150;
      const Ocz = Os * (1 + 0.03 * (1 - sig((r - 0.965) / 0.008)));   // near-surface shear layer
      pts.push([F.tx(r), F.ty(Orad + (Ocz - Orad) * sig((r - 0.707) / 0.006))]);
    }
    g += `<path d="${path(pts)}" fill="none" stroke="${cols[lat]}" stroke-width="1.8"/>`;
    g += `<text x="${x1 + 4}" y="${F.ty(Os) + 2}" class="dls" fill="${cols[lat]}">${lat}° (${(1e9 / Os / 86400).toFixed(1)} d)</text>`;
  }
  g += `<text x="${F.tx(0.42)}" y="${F.ty(Orad) - 4}" class="dls">radiative interior turns rigidly</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">radius r / R☉  —  rotation rate Ω/2π [nHz]</text>`;
  return svgOpen(152) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- T versus height
export function heightChart() {
  const x0 = 34, x1 = 306, y0 = 10, y1 = 128;
  const F = frame(x0, x1, y0, y1, [0, 3000], [3.5, 6.4]);
  // rounded, after semi-empirical models of the quiet Sun (Vernazza, Avrett & Loeser 1981, "VAL C")
  const P = [[0, 6400], [100, 5600], [300, 4800], [515, 4170], [800, 5000], [1200, 6200], [1600, 6800], [1900, 7400], [2050, 9000],
    [2110, 2e4], [2140, 5e4], [2180, 1.5e5], [2250, 4e5], [2400, 7e5], [2700, 1e6], [3000, 1.2e6]];
  const pts = P.map(([h, T]) => [F.tx(h), F.ty(Math.log10(T))]);
  let g = '';
  g += `<rect x="${F.tx(0)}" y="${y0}" width="${F.tx(500) - F.tx(0)}" height="${y1 - y0}" fill="#f6c768" opacity=".18"/>`;
  g += `<rect x="${F.tx(500)}" y="${y0}" width="${F.tx(2100) - F.tx(500)}" height="${y1 - y0}" fill="#e3424b" opacity=".10"/>`;
  g += `<rect x="${F.tx(2300)}" y="${y0}" width="${F.tx(3000) - F.tx(2300)}" height="${y1 - y0}" fill="#d4a017" opacity=".12"/>`;
  g += `<text x="${F.tx(250)}" y="${y0 + 9}" class="ax" text-anchor="middle">photosphere</text>`;
  g += `<text x="${F.tx(1300)}" y="${y0 + 9}" class="ax" text-anchor="middle">chromosphere</text>`;
  g += `<text x="${F.tx(2180)}" y="${y0 + 18}" class="ax" text-anchor="middle">TR</text>`;
  g += `<text x="${F.tx(2650)}" y="${y0 + 9}" class="ax" text-anchor="middle">corona</text>`;
  for (let e = 4; e <= 6; e++) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(e)}" y2="${F.ty(e)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(e) + 2}" class="ax" text-anchor="end">${pow10(e)}</text>`;
  for (let h = 0; h <= 3000; h += 500) g += `<text x="${F.tx(h)}" y="${y1 + 9}" class="ax" text-anchor="middle">${h}</text>`;
  g += `<path d="${path(pts)}" fill="none" stroke="#e8742a" stroke-width="1.9"/>`;
  g += `<text x="${F.tx(515)}" y="${F.ty(Math.log10(4170)) + 9}" class="ax" text-anchor="middle">T-minimum ≈ 4 200 K</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">height above τ₅₀₀ = 1  [km]   —   T [K], log scale</text>`;
  return svgOpen(152) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- butterfly (schematic)
export function butterflyChart() {
  const x0 = 30, x1 = 306, y0 = 10, y1 = 118;
  const F = frame(x0, x1, y0, y1, [0, 24], [-42, 42]);
  let s = 12345;
  const R = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let g = '';
  for (const v of [-30, 0, 30]) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(v)}" y2="${F.ty(v)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(v) + 2}" class="ax" text-anchor="end">${v}°</text>`;
  for (let y = 0; y <= 24; y += 4) g += `<text x="${F.tx(y)}" y="${y1 + 9}" class="ax" text-anchor="middle">${y}</text>`;
  for (const t0 of [-9, 2, 13]) {
    for (let i = 0; i < 700; i++) {
      const u = R();                                   // phase through the cycle
      const act = Math.sin(Math.PI * Math.pow(u, 0.75)) ** 2;
      if (R() > act) continue;
      const lat = (28 - 21 * Math.pow(u, 0.8)) + (R() - 0.5) * 12 * (1 - 0.4 * u);
      const yr = t0 + u * 12.5;
      if (yr < 0 || yr > 24) continue;
      const sg = R() < 0.5 ? 1 : -1;
      g += `<rect x="${f(F.tx(yr))}" y="${f(F.ty(sg * lat))}" width="1.1" height="1.1" fill="#c0502a" opacity=".7"/>`;
    }
  }
  g += `<text x="${x1 - 3}" y="${y0 + 8}" class="ax" text-anchor="end">schematic (synthetic points), not observed data</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">time [years]  —  latitude of sunspots</text>`;
  return svgOpen(142) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- HR diagram (schematic)
export function hrChart() {
  const x0 = 34, x1 = 306, y0 = 10, y1 = 128;
  const F = frame(x0, x1, y0, y1, [4.6, 3.4], [-4.5, 6.2]);
  let g = '';
  for (const e of [-4, -2, 0, 2, 4, 6]) g += `<line x1="${x0}" x2="${x1}" y1="${F.ty(e)}" y2="${F.ty(e)}" class="grid"/><text x="${x0 - 3}" y="${F.ty(e) + 2}" class="ax" text-anchor="end">${pow10(e)}</text>`;
  for (const T of [30000, 10000, 6000, 3000]) g += `<text x="${F.tx(Math.log10(T))}" y="${y1 + 9}" class="ax" text-anchor="middle">${T.toLocaleString('en-US').replace(/,/g, ' ')}</text>`;
  const ms = [[4.55, 5.6], [4.3, 3.8], [4.0, 1.6], [3.85, 0.6], [3.76, 0.0], [3.65, -0.8], [3.55, -1.6], [3.48, -2.6], [3.45, -3.4]];
  g += `<path d="${path(ms.map(([t, l]) => [F.tx(t), F.ty(l)]))}" fill="none" stroke="#c9a14a" stroke-width="7" stroke-linecap="round" opacity=".35"/>`;
  g += `<text x="${F.tx(4.15)}" y="${F.ty(3.6)}" class="dls">main sequence</text>`;
  g += `<ellipse cx="${F.tx(3.62)}" cy="${F.ty(2.4)}" rx="26" ry="11" fill="#e3424b" opacity=".18"/><text x="${F.tx(3.62)}" y="${F.ty(2.4) + 2}" class="ax" text-anchor="middle">giants</text>`;
  g += `<ellipse cx="${F.tx(4.15)}" cy="${F.ty(-2.9)}" rx="22" ry="8" fill="#3b82c4" opacity=".2"/><text x="${F.tx(4.15)}" y="${F.ty(-2.9) + 2}" class="ax" text-anchor="middle">white dwarfs</text>`;
  g += `<circle cx="${F.tx(3.7613)}" cy="${F.ty(0)}" r="3.4" fill="#ffd34d" stroke="#b5651d" stroke-width="1"/>`;
  g += `<text x="${F.tx(3.7613) + 6}" y="${F.ty(0) - 4}" class="dl">the Sun</text>`;
  g += `<path d="M${F.tx(3.75)} ${F.ty(0.3)} C ${F.tx(3.66)} ${F.ty(1.4)}, ${F.tx(3.6)} ${F.ty(2.6)}, ${F.tx(3.56)} ${F.ty(3.3)}" fill="none" stroke="#b5651d" stroke-dasharray="2 2" stroke-width=".9" marker-end="url(#arr)"/>`;
  g += `<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6z" fill="#b5651d"/></marker></defs>`;
  g += `<text x="${F.tx(3.53)}" y="${F.ty(3.9)}" class="ax">in ~5 Gyr</text>`;
  g += `<text x="${(x0 + x1) / 2}" y="${y1 + 19}" class="dls" text-anchor="middle">surface temperature [K] (falls to the right)  —  L / L☉</text>`;
  return svgOpen(152) + F.box + g + '</svg>';
}

// ---------------------------------------------------------------- pp chain
export function ppChainDiagram() {
  const box = (x, y, w, t, s, c = '#fff3dc') => `<rect x="${x}" y="${y}" width="${w}" height="24" rx="5" fill="${c}" stroke="#d9a35a" stroke-width=".8"/>
    <text x="${x + w / 2}" y="${y + 10}" class="dl" text-anchor="middle">${t}</text><text x="${x + w / 2}" y="${y + 19.5}" class="ax" text-anchor="middle">${s}</text>`;
  const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#b5651d" stroke-width=".9" marker-end="url(#pa)"/>`;
  let g = `<defs><marker id="pa" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6z" fill="#b5651d"/></marker></defs>`;
  g += box(70, 6, 180, 'p + p → ²H + e⁺ + νₑ', 'weak interaction: ~10¹⁰ yr per proton', '#ffe6c2');
  g += arrow(160, 30, 160, 40);
  g += box(90, 40, 140, '²H + p → ³He + γ', 'about a second');
  g += arrow(140, 64, 60, 78); g += arrow(180, 64, 230, 78);
  g += box(4, 78, 112, '³He + ³He → ⁴He + 2p', 'ppI · ≈ 83 %');
  g += box(176, 78, 140, '³He + ⁴He → ⁷Be + γ', 'ppII + ppIII · ≈ 17 %');
  g += arrow(220, 102, 190, 114); g += arrow(276, 102, 290, 114);
  g += box(120, 114, 128, '⁷Be + e⁻ → ⁷Li + νₑ', '⁷Li + p → 2 ⁴He   (ppII)');
  g += box(252, 114, 66, '⁷Be + p → ⁸B', '⁸B → 2 ⁴He + e⁺ + νₑ');
  g += `<text x="250" y="148" class="ax" text-anchor="middle">ppIII ≈ 0.02 % — but its ⁸B neutrinos</text><text x="250" y="156" class="ax" text-anchor="middle">are the energetic ones detectors see</text>`;
  g += `<rect x="4" y="166" width="312" height="22" rx="6" fill="#fde7c9" stroke="#e8742a" stroke-width=".8"/>`;
  g += `<text x="160" y="180.5" class="dl" text-anchor="middle">net: 4 p → ⁴He + 2 e⁺ + 2 νₑ + 26.73 MeV</text>`;
  return svgOpen(194) + g + '</svg>';
}

