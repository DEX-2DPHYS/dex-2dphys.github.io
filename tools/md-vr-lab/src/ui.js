import { tr } from './i18n.js';
// Tiny immediate-mode UI drawn on a 2D canvas. The canvas is shown as a DOM element on the desktop
// (mouse / touch) and as a texture on a floating panel in VR (controller rays) - one code path for both.

// two palettes; COL is switched in place (setPalette), so every widget picks up the change on its next draw
export const PALETTES = {
  dark: {
    bg: '#0d1422', card: '#162036', card2: '#1d2a45', line: '#2a3a5c', text: '#e8eef8', muted: '#9fb2cf',
    accent: '#4ae3e1', accentDim: '#17696a', warn: '#ffb454', bad: '#ff7b7b', good: '#7be495', hover: '#26395f',
    track: '#26324f', off: '#3a4663', disabled: '#6b7a95', dangerBg: '#4a1d27', onText: '#04202a', primaryHover: '#1f8c8d',
    grid: '#223152', ghost: '#5a6a8c', blue: '#6aa8ff', minus: '#5b8cff', plus: '#ff6a5c',
  },
  light: {
    bg: '#f6f8fb', card: '#e8edf4', card2: '#dfe6f0', line: '#b9c5d6', text: '#15202f', muted: '#4f5f79',
    accent: '#0b827f', accentDim: '#a8dedb', warn: '#a95f00', bad: '#c0352a', good: '#1d7f45', hover: '#d2deef',
    track: '#cfd8e5', off: '#aab6c8', disabled: '#97a3b6', dangerBg: '#f6d8d5', onText: '#ffffff', primaryHover: '#8fd3cf',
    grid: '#d5dde8', ghost: '#9aa7bb', blue: '#2f6fd6', minus: '#2357d6', plus: '#d23a2c',
  },
};
export const COL = Object.assign({}, PALETTES.dark);
export function setPalette(name) { Object.assign(COL, PALETTES[name] || PALETTES.dark); }

export class UI {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.pad = 22; this.gap = 10;
    // pointer state, set by input code
    this.px = -1; this.py = -1; this.down = false; this.pressed = false; this.released = false; this.owner = null;
    this.active = null;       // id of the slider being dragged
    this.dirty = true;
    this.hits = [];
    this.t0 = 0;
  }

  /* ---- pointer plumbing ---- */
  move(x, y, owner) { if (this.down && this.owner !== owner) return; if (Math.abs(x - this.px) > 1.5 || Math.abs(y - this.py) > 1.5) this.dirty = true; this.px = x; this.py = y; this.owner = owner; }
  leave(owner) { if (this.owner === owner && !this.down && this.px >= 0) { this.px = this.py = -1; this.dirty = true; } }
  press(owner) { if (this.down) return; this.down = true; this.pressed = true; this.owner = owner; this.dirty = true; }
  release(owner) { if (this.owner !== owner || !this.down) return; this.down = false; this.released = true; this.dirty = true; }

  /* ---- frame ---- */
  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = COL.bg; roundRect(c, 0, 0, this.w, this.h, 26); c.fill();
    c.strokeStyle = COL.line; c.lineWidth = 3; roundRect(c, 1.5, 1.5, this.w - 3, this.h - 3, 25); c.stroke();
    this.y = this.pad; this.colN = 1; this.colI = 0; this.cursorOver = false; this.clicked = false;
    c.textBaseline = 'middle';
  }
  end() {
    this.pressed = false; this.released = false; this.dirty = false;
    if (this.released === false && !this.down) this.active = null;
  }

  _rect(h) {
    const cw = (this.w - 2 * this.pad - (this.colN - 1) * this.gap) / this.colN;
    const x = this.pad + this.colI * (cw + this.gap);
    return { x, y: this.y, w: cw, h };
  }
  _advance(h) {
    this.colI++;
    if (this.colI >= this.colN) { this.colI = 0; this.colN = 1; this.y += h + this.gap; }
  }
  row(n) { this.colN = n; this.colI = 0; }
  space(h = 10) { this.y += h; }
  skip(h = 54) { this._advance(h); }
  _hover(r) { return this.px >= r.x && this.px <= r.x + r.w && this.py >= r.y && this.py <= r.y + r.h; }

  /* ---- widgets ---- */
  header(text, sub) {
    text = tr(text); sub = tr(sub); const c = this.ctx;
    c.fillStyle = COL.accent; c.font = '700 30px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left';
    c.fillText(text, this.pad, this.y + 18);
    if (sub) { c.fillStyle = COL.muted; c.font = '20px system-ui,Segoe UI,sans-serif'; c.textAlign = 'right'; c.fillText(sub, this.w - this.pad, this.y + 18); }
    this.y += 42;
  }

  label(text, o = {}) {
    text = tr(text); const c = this.ctx, size = o.size || 22;
    c.font = (o.bold ? '700 ' : '') + size + 'px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.fillStyle = o.color || COL.muted;
    c.fillText(text, this.pad + (o.indent || 0), this.y + size * 0.6);
    this.y += size + 8;
  }

  section(text) {
    text = tr(text); const c = this.ctx;
    this.y += 4;
    c.font = '700 21px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.fillStyle = COL.accent;
    c.fillText(text.toUpperCase(), this.pad, this.y + 12);
    c.strokeStyle = COL.line; c.lineWidth = 2; c.beginPath(); c.moveTo(this.pad + c.measureText(text.toUpperCase()).width + 12, this.y + 12); c.lineTo(this.w - this.pad, this.y + 12); c.stroke();
    this.y += 32;
  }

  paragraph(text, o = {}) {
    text = tr(text); const c = this.ctx, size = o.size || 22, lh = Math.round(size * 1.32), maxW = this.w - 2 * this.pad - (o.indent || 0);
    c.font = (o.bold ? '700 ' : '') + size + 'px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.fillStyle = o.color || COL.text;
    let line = '';
    for (const para of String(text).split('\n')) {
      line = '';
      for (const word of para.split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (c.measureText(t).width > maxW && line) { c.fillText(line, this.pad + (o.indent || 0), this.y + lh / 2); this.y += lh; line = word; } else line = t;
      }
      c.fillText(line, this.pad + (o.indent || 0), this.y + lh / 2); this.y += lh;
    }
    this.y += 4;
  }

  readout(label, value, o = {}) {
    label = tr(label); value = tr(value); const r = this._rect(o.h || 34), c = this.ctx;
    c.font = '20px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.fillStyle = COL.muted; c.fillText(label, r.x, r.y + r.h / 2);
    c.font = '700 24px system-ui,Segoe UI,sans-serif'; c.textAlign = 'right'; c.fillStyle = o.color || COL.text; c.fillText(value, r.x + r.w, r.y + r.h / 2);
    this._advance(r.h);
  }

  button(label, o = {}) {
    label = tr(label); const r = this._rect(o.h || 58), c = this.ctx;
    const hov = this._hover(r) && !o.disabled;
    if (hov) this.cursorOver = true;
    let bg = COL.card2, fg = COL.text, bd = COL.line;
    if (o.primary) { bg = COL.accentDim; bd = COL.accent; }
    if (o.danger) { bg = COL.dangerBg; bd = COL.bad; }
    if (o.active) { bg = o.tint || COL.accent; fg = COL.onText; bd = bg; }
    if (hov) { if (!o.active) bg = o.primary ? COL.primaryHover : COL.hover; bd = COL.accent; }
    if (o.disabled) { fg = COL.disabled; }
    if (o.bg) { bg = o.bg; fg = o.fg || fg; if (!hov && !o.active) bd = o.bd || bg; }       // custom colours (periodic table)
    const ga = c.globalAlpha; if (o.alpha !== undefined) c.globalAlpha = o.alpha;
    c.fillStyle = bg; roundRect(c, r.x, r.y, r.w, r.h, 14); c.fill();
    c.strokeStyle = hov && this.down ? COL.text : bd; c.lineWidth = hov ? 3 : 2; roundRect(c, r.x, r.y, r.w, r.h, 14); c.stroke();
    if (o.icon) {                                       // pictogram (src/icons.js) above a small label, or alone; o.tint colours it
      if (o.tint && !o.active) { c.fillStyle = o.tint; roundRect(c, r.x + 10, r.y + r.h - 7, r.w - 20, 4, 2); c.fill(); }
      const s = label ? Math.min(r.h * 0.25, r.w * 0.3) : Math.min(r.h * 0.36, r.w * 0.36), cy = label ? r.y + r.h * 0.37 : r.y + r.h / 2;
      c.save(); o.icon(c, r.x + r.w / 2, cy, s, o.active ? fg : (o.disabled ? COL.disabled : (o.tint || fg)), o.iconArg); c.restore();
      if (label) { c.fillStyle = fg; c.font = '600 ' + (o.size || 17) + 'px system-ui,Segoe UI,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, r.x + r.w / 2, r.y + r.h - Math.max(15, r.h * 0.17)); }
    } else { c.fillStyle = fg; c.font = '600 ' + (o.size || 23) + 'px system-ui,Segoe UI,sans-serif'; c.textAlign = 'center'; c.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1); }
    c.globalAlpha = ga;
    this._advance(r.h);
    return hov && this.pressed && this.owner !== null;
  }

  // segmented choice; options = [[value,label],...]; returns new value
  choice(options, value, o = {}) {
    const n = options.length, saveGap = this.gap;
    this.row(n);
    let out = value;
    for (const [v, lab] of options) if (this.button(lab, { active: v === value, h: o.h || 54, size: o.size || 22 })) out = v;
    this.gap = saveGap;
    return out;
  }

  toggle(label, value, o = {}) {
    label = tr(label); const r = this._rect(o.h || 52), c = this.ctx;
    const hov = this._hover(r); if (hov) this.cursorOver = true;
    c.fillStyle = hov ? COL.hover : COL.card; roundRect(c, r.x, r.y, r.w, r.h, 14); c.fill();
    c.font = '22px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.fillStyle = COL.text; c.fillText(label, r.x + 16, r.y + r.h / 2 + 1);
    const sw = 64, sh = 30, sx = r.x + r.w - sw - 14, sy = r.y + (r.h - sh) / 2;
    c.fillStyle = value ? COL.accent : COL.off; roundRect(c, sx, sy, sw, sh, 15); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(value ? sx + sw - 15 : sx + 15, sy + 15, 11, 0, 6.2832); c.fill();
    this._advance(r.h);
    return hov && this.pressed ? !value : value;
  }

  // slider; returns the new value. fmt(value) -> string
  slider(id, label, value, min, max, fmt, o = {}) {
    const r = this._rect(o.h || 74), c = this.ctx;
    const trackX = r.x + 8, trackW = r.w - 16, ty = r.y + 52;
    const hov = this._hover(r); if (hov) this.cursorOver = true;
    if (hov && this.pressed) this.active = id;
    let v = value;
    if (this.active === id && this.down) {
      let f = (this.px - trackX) / trackW; f = Math.max(0, Math.min(1, f));
      if (o.log) v = min * Math.pow(max / min, f); else v = min + f * (max - min);
      if (o.step) v = Math.round(v / o.step) * o.step;
      v = Math.max(min, Math.min(max, v));
    }
    const f = o.log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    c.font = '21px system-ui,Segoe UI,sans-serif'; c.textAlign = 'left'; c.fillStyle = COL.muted; c.fillText(tr(label), r.x, r.y + 14);
    c.textAlign = 'right'; c.font = '700 23px system-ui,Segoe UI,sans-serif'; c.fillStyle = COL.text; c.fillText(tr(fmt(v)), r.x + r.w, r.y + 14);
    c.fillStyle = COL.track; roundRect(c, trackX, ty - 5, trackW, 10, 5); c.fill();
    c.fillStyle = COL.accentDim; roundRect(c, trackX, ty - 5, Math.max(10, trackW * f), 10, 5); c.fill();
    const kx = trackX + trackW * f, act = this.active === id || hov;
    c.fillStyle = act ? COL.text : COL.accent; c.beginPath(); c.arc(kx, ty, act ? 16 : 13, 0, 6.2832); c.fill();
    this._advance(r.h);
    return v;
  }

  // thin progress / status bar
  bar(frac, color = COL.accent, h = 10) {
    const r = this._rect(h), c = this.ctx;
    c.fillStyle = COL.track; roundRect(c, r.x, r.y, r.w, h, h / 2); c.fill();
    c.fillStyle = color; roundRect(c, r.x, r.y, Math.max(h, r.w * Math.max(0, Math.min(1, frac))), h, h / 2); c.fill();
    this._advance(h);
  }

  tabs(names, active, size = 21) {
    const n = names.length, saveY = this.y;
    this.row(n);
    let out = active;
    names.forEach((nm, i) => { if (this.button(nm, { active: i === active, h: 54, size })) out = i; });
    return out;
  }

  // pointer cursor drawn last (desktop shows it only for VR rays; harmless otherwise)
  finish() {
    this.end();
  }
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
