// Four live plots on one canvas: T(t), energies(t), g(r), MSD(t).
import { COL, roundRect } from './ui.js';

export const PW = 1024, PH = 860;

function frame(c, x, y, w, h, title, xl, yl) {
  c.fillStyle = COL.card; roundRect(c, x, y, w, h, 16); c.fill();
  c.fillStyle = COL.accent; c.font = '700 22px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(title, x + 18, y + 24);
  const L = 78, R = 18, T = 46, B = 52;
  const px = x + L, py = y + T, pw = w - L - R, ph = h - T - B;
  c.strokeStyle = COL.line; c.lineWidth = 1.5; c.strokeRect(px, py, pw, ph);
  c.fillStyle = COL.muted; c.font = '18px system-ui,Segoe UI,sans-serif'; c.textAlign = 'center';
  c.fillText(xl, px + pw / 2, y + h - 14);
  c.save(); c.translate(x + 20, py + ph / 2); c.rotate(-Math.PI / 2); c.fillText(yl, 0, 0); c.restore();
  return { px, py, pw, ph };
}

function niceRange(lo, hi, pad = 0.08) {
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  const d = hi - lo; return [lo - d * pad, hi + d * pad];
}

function ticks(c, a, lo, hi, nx, ny, fx, fy) {
  c.fillStyle = COL.muted; c.font = '16px system-ui,Segoe UI,sans-serif'; c.strokeStyle = COL.grid; c.lineWidth = 1;
  c.textAlign = 'center';
  for (let i = 0; i <= nx; i++) {
    const f = i / nx, X = a.px + a.pw * f;
    c.beginPath(); c.moveTo(X, a.py); c.lineTo(X, a.py + a.ph); c.stroke();
    c.fillText(fx(lo.x + (hi.x - lo.x) * f), X, a.py + a.ph + 16);
  }
  c.textAlign = 'right';
  for (let i = 0; i <= ny; i++) {
    const f = i / ny, Y = a.py + a.ph * (1 - f);
    c.beginPath(); c.moveTo(a.px, Y); c.lineTo(a.px + a.pw, Y); c.stroke();
    c.fillText(fy(lo.y + (hi.y - lo.y) * f), a.px - 8, Y);
  }
}

function line(c, a, lo, hi, xs, ys, color, width = 3) {
  if (xs.length < 2) return;
  c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const X = a.px + a.pw * (xs[i] - lo.x) / (hi.x - lo.x), Y = a.py + a.ph * (1 - (ys[i] - lo.y) / (hi.y - lo.y));
    if (i) c.lineTo(X, Y); else c.moveTo(X, Y);
  }
  c.stroke();
}

const f0 = (v) => v.toFixed(0), f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);

// d = { t[], T[], ke[], pe[], e[], P[], Ttarget, rdf{r[],g[]}, msd{t[],y[],tPrev[],yPrev[]}, units }
export function drawPlots(c, d) {
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, PW, PH);
  c.fillStyle = COL.bg; roundRect(c, 0, 0, PW, PH, 26); c.fill();
  c.strokeStyle = COL.line; c.lineWidth = 3; roundRect(c, 1.5, 1.5, PW - 3, PH - 3, 25); c.stroke();
  const m = 14, w = (PW - 3 * m) / 2, h = (PH - 3 * m) / 2;
  const n = d.t.length, t0 = n ? d.t[0] : 0, t1 = n ? d.t[n - 1] : 1;

  // 1. temperature
  {
    let a = frame(c, m, m, w, h, 'Temperature', 'time (ps)', 'T (K)');
    let [lo, hi] = niceRange(Math.min(...d.T, d.Ttarget), Math.max(...d.T, d.Ttarget));
    if (!n) { lo = 0; hi = 100; }
    const L = { x: t0, y: Math.max(0, lo) }, H = { x: Math.max(t1, t0 + 1e-6), y: hi };
    ticks(c, a, L, H, 4, 4, f1, f0);
    // target line
    c.setLineDash([10, 8]); line(c, a, L, H, [L.x, H.x], [d.Ttarget, d.Ttarget], COL.warn, 2); c.setLineDash([]);
    line(c, a, L, H, d.t, d.T, COL.accent);
  }
  // 2. energies
  {
    const x2 = 2 * m + w, y2 = m;
    const a = frame(c, x2, y2, w, h, 'Energy per atom', 'time (ps)', 'meV');
    const all = d.ke.concat(d.pe, d.e);
    let [lo, hi] = niceRange(Math.min(...all), Math.max(...all));
    if (!n) { lo = -50; hi = 50; }
    const L = { x: t0, y: lo }, H = { x: Math.max(t1, t0 + 1e-6), y: hi };
    ticks(c, a, L, H, 4, 4, f1, f0);
    line(c, a, L, H, d.t, d.ke, COL.bad, 2.5); line(c, a, L, H, d.t, d.pe, COL.blue, 2.5); line(c, a, L, H, d.t, d.e, COL.good, 3.5);
    c.font = '16px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left';
    [['kin.', COL.bad], ['pot.', COL.blue], ['total', COL.good]].forEach(([t, col], i) => { c.fillStyle = col; c.fillText('● ' + t, x2 + 210 + i * 108, y2 + 24); });
  }
  // 3. g(r)
  {
    const a = frame(c, m, 2 * m + h, w, h, d.rdfTitle || 'Radial distribution g(r)', d.rdfX || 'r (nm)', d.rdfY || 'g(r)');
    const { r, g } = d.rdf;
    let top = d.rdfMin || 3; for (const v of g) if (v > top) top = v * 1.05;
    const L = { x: 0, y: 0 }, H = { x: r.length ? r[r.length - 1] : 1, y: top };
    ticks(c, a, L, H, 5, 3, d.rdfRef === false ? f1 : f2, top < 2 ? f2 : f1);
    if (d.rdfRef !== false) { c.setLineDash([8, 8]); line(c, a, L, H, [0, H.x], [1, 1], COL.ghost, 1.5); c.setLineDash([]); }
    line(c, a, L, H, r, g, COL.accent, 3);
  }
  // 4. MSD
  {
    const a = frame(c, 2 * m + w, 2 * m + h, w, h, 'Mean-square displacement', 'time since mark (ps)', 'MSD (nm²)');
    const { t, y, tPrev, yPrev } = d.msd;
    let ymax = 0.01; for (const v of y) ymax = Math.max(ymax, v); for (const v of yPrev) ymax = Math.max(ymax, v);
    let xmax = 0.5; for (const v of t) xmax = Math.max(xmax, v); for (const v of tPrev) xmax = Math.max(xmax, v);
    const L = { x: 0, y: 0 }, H = { x: xmax, y: ymax * 1.1 };
    ticks(c, a, L, H, 4, 4, f1, (v) => v < 0.1 ? v.toFixed(3) : v.toFixed(2));
    line(c, a, L, H, tPrev, yPrev, COL.ghost, 2);
    line(c, a, L, H, t, y, COL.warn, 3.5);
    c.fillStyle = COL.text; c.font = '700 20px system-ui,Segoe UI,sans-serif'; c.textAlign = 'right';
    c.fillText(d.Dtext || '', a.px + a.pw - 10, a.py + 18);
  }
}

// Transport plots (ELEC tab): T(E) with the bias window, and I(V) with dI/dV.
// d = { E[], T[], EF, V[], I[], dIdV[], Vbias, gap, status, log }
export function drawElec(c, d) {
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, PW, PH);
  c.fillStyle = COL.bg; roundRect(c, 0, 0, PW, PH, 26); c.fill();
  c.strokeStyle = COL.line; c.lineWidth = 3; roundRect(c, 1.5, 1.5, PW - 3, PH - 3, 25); c.stroke();
  const m = 14, w = PW - 2 * m, h = (PH - 3 * m) / 2;
  const has = d.E && d.E.length > 1;
  // 1. transmission
  {
    const a = frame(c, m, m, w, h, 'Transmission T(E)', 'E \u2212 E_F (eV)', d.log ? 'log\u2081\u2080 T' : 'T');
    const xs = has ? Array.from(d.E, (e) => e - d.EF) : [-3, 3];
    const ys = has ? Array.from(d.T, (t) => d.log ? Math.log10(Math.max(t, 1e-8)) : t) : [0, 0];
    let top = d.log ? 1 : 1; for (const v of ys) top = Math.max(top, v * 1.05);
    const L = { x: xs[0], y: d.log ? -8 : 0 }, H = { x: xs[xs.length - 1], y: d.log ? Math.max(1, Math.ceil(top)) : top };
    // bias window
    if (has && d.Vbias > 0) {
      const X0 = a.px + a.pw * (-d.Vbias / 2 - L.x) / (H.x - L.x), X1 = a.px + a.pw * (d.Vbias / 2 - L.x) / (H.x - L.x);
      c.fillStyle = COL.warn; c.globalAlpha = 0.16; c.fillRect(X0, a.py, X1 - X0, a.ph); c.globalAlpha = 1;
    }
    ticks(c, a, L, H, 6, 4, f1, d.log ? f0 : (top < 2 ? f2 : f1));
    c.setLineDash([8, 8]); line(c, a, L, H, [0, 0], [L.y, H.y], COL.ghost, 1.5); c.setLineDash([]);
    if (has) line(c, a, L, H, xs, ys, COL.accent, 3);
    c.font = '18px system-ui,Segoe UI,sans-serif'; c.textAlign = 'right'; c.fillStyle = COL.muted;
    c.fillText(has ? (d.gap > 0 ? `transport gap \u2248 ${d.gap.toFixed(2)} eV` : 'no gap at the Fermi level') + '   \u25A0 bias window' : (d.status || 'no data yet'), m + w - 20, m + 24);
  }
  // 2. current and differential conductance
  {
    const y2 = 2 * m + h, a = frame(c, m, y2, w, h, 'Current I(V)  and  dI/dV', 'bias V (V)', 'I (\u00B5A)');
    const V = has ? Array.from(d.V) : [0, 2], I = has ? Array.from(d.I, (v) => v * 1e6) : [0, 0], G = has ? Array.from(d.dIdV) : [0, 0];
    let imax = 0.01; for (const v of I) imax = Math.max(imax, v);
    let gmax = 0.01; for (const v of G) gmax = Math.max(gmax, v);
    const L = { x: V[0], y: 0 }, H = { x: V[V.length - 1], y: imax * 1.1 };
    ticks(c, a, L, H, 5, 4, f1, (v) => v < 1 ? v.toFixed(2) : v.toFixed(1));
    if (has) {
      line(c, a, L, H, V, G.map((g) => g / gmax * imax * 1.0), COL.ghost, 2);
      line(c, a, L, H, V, I, COL.warn, 3.5);
      const X = a.px + a.pw * (d.Vbias - L.x) / (H.x - L.x); c.setLineDash([6, 6]); c.strokeStyle = COL.muted; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X, a.py); c.lineTo(X, a.py + a.ph); c.stroke(); c.setLineDash([]);
    }
    c.font = '16px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left';
    [['I', COL.warn], [`dI/dV (max ${gmax.toFixed(2)} G\u2080)`, COL.ghost]].forEach(([t, col], i) => { c.fillStyle = col; c.fillText('\u25CF ' + t, m + 400 + i * 80, y2 + 24); });
  }
}
