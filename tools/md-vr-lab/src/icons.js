// Small pictograms drawn on a 2D canvas: tools, systems, levels. Every icon is icon(c, x, y, s, col): centre (x, y),
// half-size s, main colour col. They are drawn, not loaded, so they stay sharp at any panel resolution.
const TAU = Math.PI * 2;
function atom(c, x, y, r, fill, line) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); if (line) { c.lineWidth = Math.max(1.5, r * 0.18); c.strokeStyle = line; c.stroke(); } }
function stick(c, x1, y1, x2, y2, w, col) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = w; c.strokeStyle = col; c.lineCap = 'round'; c.stroke(); }
function hexPts(x, y, r, rot = 0) { const p = []; for (let k = 0; k < 6; k++) { const a = rot + k * Math.PI / 3; p.push([x + r * Math.cos(a), y + r * Math.sin(a)]); } return p; }
function poly(c, pts, close = true) { c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); if (close) c.closePath(); }

export const ICONS = {
  tweezers(c, x, y, s, col) {         // two prongs closing on an atom
    c.save(); c.lineCap = 'round'; c.lineWidth = s * 0.13; c.strokeStyle = col;
    c.beginPath(); c.moveTo(x - s * 0.55, y - s * 0.9); c.quadraticCurveTo(x - s * 0.5, y - s * 0.05, x - s * 0.18, y + s * 0.35); c.stroke();
    c.beginPath(); c.moveTo(x + s * 0.55, y - s * 0.9); c.quadraticCurveTo(x + s * 0.5, y - s * 0.05, x + s * 0.18, y + s * 0.35); c.stroke();
    atom(c, x, y + s * 0.62, s * 0.26, col); c.restore();
  },
  add(c, x, y, s, col) { atom(c, x - s * 0.15, y + s * 0.12, s * 0.5, col); stick(c, x + s * 0.55, y - s * 0.9, x + s * 0.55, y - s * 0.2, s * 0.14, col); stick(c, x + s * 0.2, y - s * 0.55, x + s * 0.9, y - s * 0.55, s * 0.14, col); },
  attach(c, x, y, s, col) { atom(c, x - s * 0.5, y + s * 0.35, s * 0.36, col); stick(c, x - s * 0.2, y + s * 0.1, x + s * 0.25, y - s * 0.3, s * 0.14, col); atom(c, x + s * 0.5, y - s * 0.5, s * 0.3, 'rgba(0,0,0,0)', col); stick(c, x + s * 0.5, y + s * 0.35, x + s * 0.5, y + s * 0.95, s * 0.12, col); stick(c, x + s * 0.2, y + s * 0.65, x + s * 0.8, y + s * 0.65, s * 0.12, col); },
  bond(c, x, y, s, col) { stick(c, x - s * 0.5, y + s * 0.4, x + s * 0.5, y - s * 0.4, s * 0.22, col); atom(c, x - s * 0.55, y + s * 0.45, s * 0.33, col); atom(c, x + s * 0.55, y - s * 0.45, s * 0.33, col); },
  delete(c, x, y, s, col) { atom(c, x, y, s * 0.55, 'rgba(0,0,0,0)', col); stick(c, x - s * 0.75, y - s * 0.75, x + s * 0.75, y + s * 0.75, s * 0.16, col); stick(c, x + s * 0.75, y - s * 0.75, x - s * 0.75, y + s * 0.75, s * 0.16, col); },
  zap(c, x, y, s, col) {              // a cone with sparks
    c.save(); poly(c, [[x - s * 0.9, y - s * 0.25], [x + s * 0.6, y - s * 0.75], [x + s * 0.6, y + s * 0.25]]); c.fillStyle = col; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    for (const [dx, dy] of [[0.85, -0.85], [0.95, -0.25], [0.85, 0.4]]) stick(c, x + s * dx, y + s * dy, x + s * (dx + 0.12), y + s * (dy + 0.04), s * 0.1, col);
    atom(c, x - s * 0.35, y + s * 0.65, s * 0.16, col); c.restore();
  },
  hand(c, x, y, s, col) {             // an open hand: palm and four fingers and a thumb
    c.save(); c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round';
    c.beginPath(); c.ellipse(x, y + s * 0.3, s * 0.42, s * 0.45, 0, 0, TAU); c.fill();
    c.lineWidth = s * 0.17; for (const [dx, h] of [[-0.3, 0.75], [-0.1, 0.92], [0.1, 0.92], [0.3, 0.78]]) { c.beginPath(); c.moveTo(x + dx * s, y + s * 0.1); c.lineTo(x + dx * s * 1.15, y - h * s); c.stroke(); }
    c.beginPath(); c.moveTo(x - s * 0.3, y + s * 0.35); c.lineTo(x - s * 0.82, y - s * 0.05); c.stroke(); c.restore();
  },
  hfill(c, x, y, s, col) { atom(c, x, y, s * 0.4, col); for (const a of [-0.5, 0.5, Math.PI]) { const ex = x + s * 0.85 * Math.cos(a - Math.PI / 2), ey = y + s * 0.85 * Math.sin(a - Math.PI / 2); stick(c, x, y, ex, ey, s * 0.1, col); atom(c, ex, ey, s * 0.17, '#f2f2f2', col); } },
  cminus(c, x, y, s, col) { c.fillStyle = col; c.fillRect(x - s * 0.9, y - s * 0.7, s * 0.55, s * 1.4); stick(c, x - s * 0.35, y, x + s * 0.2, y, s * 0.1, col); atom(c, x + s * 0.4, y, s * 0.22, col); stick(c, x + s * 0.55, y - s * 0.75, x + s * 0.95, y - s * 0.75, s * 0.13, col); },
  cplus(c, x, y, s, col) { c.fillStyle = col; c.fillRect(x + s * 0.35, y - s * 0.7, s * 0.55, s * 1.4); stick(c, x - s * 0.2, y, x + s * 0.35, y, s * 0.1, col); atom(c, x - s * 0.4, y, s * 0.22, col); stick(c, x - s * 0.95, y - s * 0.75, x - s * 0.55, y - s * 0.75, s * 0.13, col); stick(c, x - s * 0.75, y - s * 0.95, x - s * 0.75, y - s * 0.55, s * 0.13, col); },
  run(c, x, y, s, col) { poly(c, [[x - s * 0.45, y - s * 0.65], [x + s * 0.65, y], [x - s * 0.45, y + s * 0.65]]); c.fillStyle = col; c.fill(); },
  pause(c, x, y, s, col) { c.fillStyle = col; c.fillRect(x - s * 0.5, y - s * 0.6, s * 0.32, s * 1.2); c.fillRect(x + s * 0.18, y - s * 0.6, s * 0.32, s * 1.2); },
  thermo(c, x, y, s, col, fill = 0.6, liquid = '#ff5a4f') {
    c.save(); c.lineWidth = s * 0.1; c.strokeStyle = col; c.beginPath(); c.arc(x, y + s * 0.6, s * 0.28, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(x - s * 0.14, y + s * 0.38); c.lineTo(x - s * 0.14, y - s * 0.75); c.arc(x, y - s * 0.75, s * 0.14, Math.PI, 0); c.lineTo(x + s * 0.14, y + s * 0.38); c.stroke();
    atom(c, x, y + s * 0.6, s * 0.2, liquid); c.fillStyle = liquid; const top = y + s * 0.4 - fill * s * 1.15; c.fillRect(x - s * 0.06, top, s * 0.12, y + s * 0.45 - top); c.restore();
  },
  cold(c, x, y, s, col) { ICONS.thermo(c, x - s * 0.35, y, s * 0.9, col, 0.15, '#5fb6ff'); for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; stick(c, x + s * 0.55 - s * 0.35 * Math.cos(a), y - s * 0.35 - s * 0.35 * Math.sin(a), x + s * 0.55 + s * 0.35 * Math.cos(a), y - s * 0.35 + s * 0.35 * Math.sin(a), s * 0.09, '#5fb6ff'); } },
  warm(c, x, y, s, col) {
    ICONS.thermo(c, x - s * 0.35, y, s * 0.9, col, 0.9, '#ff5a4f');
    c.save(); c.beginPath(); c.moveTo(x + s * 0.55, y + s * 0.3); c.bezierCurveTo(x + s * 0.15, y + s * 0.1, x + s * 0.35, y - s * 0.4, x + s * 0.55, y - s * 0.75); c.bezierCurveTo(x + s * 0.75, y - s * 0.4, x + s * 0.95, y + s * 0.1, x + s * 0.55, y + s * 0.3); c.fillStyle = '#ff8a3d'; c.fill(); c.restore();
  },
  rebuild(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.15; c.strokeStyle = col; c.lineCap = 'round'; c.beginPath(); c.arc(x, y, s * 0.6, -0.4, Math.PI * 1.55); c.stroke(); poly(c, [[x + s * 0.62, y - s * 0.75], [x + s * 0.95, y - s * 0.15], [x + s * 0.3, y - s * 0.2]]); c.fillStyle = col; c.fill(); c.restore(); },
  element(c, x, y, s, col, sym = 'C') { atom(c, x, y, s * 0.78, col); c.fillStyle = '#15202f'; c.font = `700 ${Math.round(s * (sym.length > 1 ? 0.75 : 0.95))}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sym, x, y + s * 0.05); },
  // ---- systems ----
  graphene(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.07; c.strokeStyle = col; for (const [dx, dy] of [[0, 0], [1.5, 0.866], [1.5, -0.866], [-1.5, 0.866], [-1.5, -0.866], [0, 1.732], [0, -1.732]]) { poly(c, hexPts(x + dx * s * 0.3, y + dy * s * 0.3, s * 0.3)); c.stroke(); } c.restore(); },
  graphite(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.07; c.strokeStyle = col; for (const k of [-1, 0, 1]) { const yy = y + k * s * 0.5; poly(c, [[x - s * 0.9, yy + s * 0.12], [x - s * 0.45, yy - s * 0.18], [x + s * 0.9, yy - s * 0.18], [x + s * 0.45, yy + s * 0.12]]); c.stroke(); } c.restore(); },
  nanotube(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.08; c.strokeStyle = col; c.beginPath(); c.ellipse(x - s * 0.7, y, s * 0.2, s * 0.5, 0, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(x - s * 0.7, y - s * 0.5); c.lineTo(x + s * 0.7, y - s * 0.5); c.moveTo(x - s * 0.7, y + s * 0.5); c.lineTo(x + s * 0.7, y + s * 0.5); c.stroke(); c.beginPath(); c.ellipse(x + s * 0.7, y, s * 0.2, s * 0.5, 0, -Math.PI / 2, Math.PI / 2); c.stroke(); c.lineWidth = s * 0.05; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(x + k * s * 0.3 - s * 0.1, y - s * 0.5); c.lineTo(x + k * s * 0.3 + s * 0.1, y + s * 0.5); c.stroke(); } c.restore(); },
  c60(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.07; c.strokeStyle = col; c.beginPath(); c.arc(x, y, s * 0.8, 0, TAU); c.stroke(); poly(c, hexPts(x, y, s * 0.3, -Math.PI / 2).filter((_, k) => k < 5).map((_, k) => [x + s * 0.3 * Math.cos(-Math.PI / 2 + k * TAU / 5), y + s * 0.3 * Math.sin(-Math.PI / 2 + k * TAU / 5)])); c.stroke(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * TAU / 5; stick(c, x + s * 0.3 * Math.cos(a), y + s * 0.3 * Math.sin(a), x + s * 0.8 * Math.cos(a), y + s * 0.8 * Math.sin(a), s * 0.07, col); } c.restore(); },
  benzene(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.09; c.strokeStyle = col; poly(c, hexPts(x, y, s * 0.6, Math.PI / 6)); c.stroke(); c.beginPath(); c.arc(x, y, s * 0.33, 0, TAU); c.stroke(); c.restore(); },
  nanodiamond(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.08; c.strokeStyle = col; poly(c, [[x, y - s * 0.85], [x + s * 0.8, y - s * 0.2], [x, y + s * 0.85], [x - s * 0.8, y - s * 0.2]]); c.stroke(); c.beginPath(); c.moveTo(x - s * 0.8, y - s * 0.2); c.lineTo(x + s * 0.8, y - s * 0.2); c.moveTo(x, y - s * 0.85); c.lineTo(x - s * 0.3, y - s * 0.2); c.lineTo(x, y + s * 0.85); c.lineTo(x + s * 0.3, y - s * 0.2); c.lineTo(x, y - s * 0.85); c.stroke(); c.restore(); },
  // ---- levels ----
  kid(c, x, y, s, col) { atom(c, x, y - s * 0.45, s * 0.3, col); c.save(); c.lineWidth = s * 0.14; c.strokeStyle = col; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y - s * 0.1); c.lineTo(x, y + s * 0.4); c.moveTo(x - s * 0.4, y - s * 0.05); c.lineTo(x + s * 0.4, y - s * 0.05); c.moveTo(x, y + s * 0.4); c.lineTo(x - s * 0.25, y + s * 0.8); c.moveTo(x, y + s * 0.4); c.lineTo(x + s * 0.25, y + s * 0.8); c.stroke(); c.restore(); },
  adult(c, x, y, s, col) { atom(c, x, y - s * 0.55, s * 0.3, col); c.save(); c.lineWidth = s * 0.16; c.strokeStyle = col; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y - s * 0.2); c.lineTo(x, y + s * 0.4); c.moveTo(x - s * 0.45, y - s * 0.05); c.lineTo(x + s * 0.45, y - s * 0.05); c.moveTo(x, y + s * 0.4); c.lineTo(x - s * 0.3, y + s * 0.95); c.moveTo(x, y + s * 0.4); c.lineTo(x + s * 0.3, y + s * 0.95); c.stroke(); c.restore(); },
  researcher(c, x, y, s, col) { c.save(); c.lineWidth = s * 0.1; c.strokeStyle = col; c.lineJoin = 'round'; poly(c, [[x - s * 0.22, y - s * 0.85], [x + s * 0.22, y - s * 0.85], [x + s * 0.22, y - s * 0.2], [x + s * 0.7, y + s * 0.75], [x - s * 0.7, y + s * 0.75], [x - s * 0.22, y - s * 0.2]]); c.stroke(); c.beginPath(); c.moveTo(x - s * 0.45, y + s * 0.3); c.lineTo(x + s * 0.45, y + s * 0.3); c.lineTo(x + s * 0.7, y + s * 0.75); c.lineTo(x - s * 0.7, y + s * 0.75); c.closePath(); c.fillStyle = col; c.fill(); c.restore(); },
};
