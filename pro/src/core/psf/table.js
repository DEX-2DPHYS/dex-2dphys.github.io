// Generic two-column PSF import: radius and value from CSV/TXT, whatever
// program wrote it. A format-specific importer should reuse
// tableToPSF once it has extracted the two columns.
//
// Value modes:
//   'per-area'     energy per unit area, f(r)                         used as is
//   'per-radius'   energy per unit radius, dE/dr = 2πr f(r)           divided by 2πr
//   'per-annulus'  energy in each radial bin (histogram counts)       divided by 2πr·Δr
// Getting this wrong is the most common Monte Carlo pitfall, so guessValueMode only suggests;
// the caller (UI) must confirm.

import { makePSF, normalize } from './psf.js';

const COMMENT = /^\s*(#|%|\/\/|;|!)/;

export const R_UNITS = { nm: 1, um: 1000, 'µm': 1000, A: 0.1, 'Å': 0.1, m: 1e9, cm: 1e7, mm: 1e6 };

export function parseColumns(text) {
  const rows = [], header = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (COMMENT.test(line)) { header.push(line); continue; }
    let parts;
    if (line.includes(';')) parts = line.split(';').map((s) => s.trim().replace(',', '.'));  // European CSV
    else if (line.includes('\t')) parts = line.split('\t');
    else if (line.includes(',')) parts = line.split(',');
    else parts = line.split(/\s+/);
    const nums = parts.map((s) => s.trim()).filter((s) => s !== '').map(Number);
    if (nums.length >= 2 && nums.every(Number.isFinite)) rows.push(nums);
    else if (!rows.length) header.push(line);        // text before the data: column titles
    else skipped++;
  }
  const nCols = rows.length ? Math.min(...rows.map((r) => r.length)) : 0;
  const columns = Array.from({ length: nCols }, (_, c) => rows.map((r) => r[c]));
  return { columns, header, skipped, rows: rows.length };
}

// Slope of ln v against ln r over the first decade of r with positive values. A PSF per area is
// flat or falling at small r (slope ≤ 0); dE/dr rises ∝ r (slope ≈ 1); annulus counts on a
// linear grid also rise ∝ r, on a log grid ∝ r².
export function guessValueMode(r, v) {
  const pts = [];
  for (let i = 0; i < r.length; i++) if (r[i] > 0 && v[i] > 0 && r[i] <= r[0] * 10) pts.push([Math.log(r[i]), Math.log(v[i])]);
  if (pts.length < 3) return { mode: 'per-area', confident: false, reason: 'too few points in the first decade to judge' };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = pts.length, slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (slope < 0.4) return { mode: 'per-area', confident: slope < 0.2, slope, reason: `values flat or falling near r = 0 (slope ${slope.toFixed(2)})` };
  return { mode: 'per-annulus', confident: false, slope, reason: `values rise near r = 0 (slope ${slope.toFixed(2)}): looks like dE/dr or bin counts — choose per-radius or per-annulus` };
}

export function tableToPSF(rIn, vIn, { rUnit = 'nm', valueMode = 'per-area', binEdges = 'arithmetic', doNormalize = true, meta = {} } = {}) {
  const scale = R_UNITS[rUnit];
  if (!scale) throw new Error(`unknown radius unit "${rUnit}"`);
  const warnings = [];
  let pairs = rIn.map((r, i) => [r * scale, vIn[i]]);
  const nonPos = pairs.filter(([r]) => !(r > 0)).length;
  if (nonPos) warnings.push(`${nonPos} point(s) with r ≤ 0 dropped`);
  pairs = pairs.filter(([r]) => r > 0).sort((a, b) => a[0] - b[0]);
  const dedup = [];
  for (const p of pairs) if (!dedup.length || p[0] > dedup[dedup.length - 1][0]) dedup.push(p); else warnings.push(`duplicate radius ${p[0]} nm dropped`);
  const r = dedup.map((p) => p[0]);
  let f = dedup.map((p) => p[1]);
  const neg = f.filter((x) => x < 0).length;
  if (neg) { warnings.push(`${neg} negative value(s) set to 0`); f = f.map((x) => Math.max(0, x)); }

  if (valueMode === 'per-radius') {
    f = f.map((x, i) => x / (2 * Math.PI * r[i]));
  } else if (valueMode === 'per-annulus') {
    // Bin edges between centres: arithmetic midpoints for linear bins, geometric for log bins
    // (most Monte Carlo codes, including ours, bin logarithmically). First/last bins mirror
    // their neighbour.
    const geo = binEdges === 'geometric';
    const mid = (a, b) => (geo ? Math.sqrt(a * b) : (a + b) / 2);
    f = f.map((x, i) => {
      const lo = i === 0 ? (geo ? r[0] * Math.sqrt(r[0] / r[1]) : Math.max(0, r[0] - (r[1] - r[0]) / 2)) : mid(r[i - 1], r[i]);
      const n = r.length - 1;
      const hi = i === n ? (geo ? r[n] * Math.sqrt(r[n] / r[n - 1]) : r[n] + (r[n] - r[n - 1]) / 2) : mid(r[i], r[i + 1]);
      return x / (Math.PI * (hi * hi - lo * lo));
    });
  } else if (valueMode !== 'per-area') {
    throw new Error(`unknown value mode "${valueMode}"`);
  }
  let psf = makePSF({ r, f, meta: { source: 'table', rUnit, valueMode, binEdges, ...meta }, warnings });
  if (doNormalize) psf = normalize(psf);
  return psf;
}

export function importTableText(text, opts = {}) {
  const { columns, header, skipped } = parseColumns(text);
  if (columns.length < 2) throw new Error('need at least two numeric columns (radius, value)');
  const rCol = opts.rColumn ?? 0, vCol = opts.valueColumn ?? 1;
  const guess = guessValueMode(columns[rCol], columns[vCol]);
  const psf = tableToPSF(columns[rCol], columns[vCol], { valueMode: opts.valueMode ?? guess.mode, ...opts });
  if (skipped) psf.warnings.push(`${skipped} non-numeric line(s) inside the data skipped`);
  if (!opts.valueMode && !guess.confident) psf.warnings.push(`value mode guessed as ${guess.mode}: ${guess.reason}`);
  return { psf, guess, header };
}

export function psfToCSV(psf) {
  const lines = ['# EBL Workbench PSF table', '# r_nm, f_per_nm2 (energy per unit area per electron, normalised)'];
  for (let i = 0; i < psf.r.length; i++) lines.push(`${psf.r[i]},${psf.f[i]}`);
  return lines.join('\n') + '\n';
}
