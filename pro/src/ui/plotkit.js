// Small helpers for the canvas plots (PSF tab).
//
// Text that stays the right size and shape when the browser zooms: the bitmap is sized from the
// element's CSS size × devicePixelRatio at every draw, and the plot is redrawn whenever either changes
// (browser zoom changes both; a plot drawn once and then stretched by CSS is what made the labels
// squeeze sideways). Fonts are in CSS pixels, so they scale with the page like the rest of the text.

export const FONT = '13px system-ui, sans-serif';
export const FONT_SMALL = '12px system-ui, sans-serif';
export const FONT_BOLD = '600 13px system-ui, sans-serif';

// size the canvas bitmap for its CSS box and the current pixel ratio; returns a context in CSS pixels
export function setupCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 4), w = c.clientWidth, h = c.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  return { ctx, w, h, dpr };
}

// call fn when any of the elements changes size, or the pixel ratio changes (browser zoom), once per frame
export function onResize(els, fn) {
  let queued = false;
  const run = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); };
  const ro = new ResizeObserver(run);
  for (const el of els) ro.observe(el);
  let mq = null;
  const watchDpr = () => {
    mq?.removeEventListener('change', onDpr);
    mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', onDpr);
  };
  function onDpr() { watchDpr(); run(); }
  watchDpr();
  return run;
}

// "10" with a raised exponent (no "1e-5"); align: 'left' | 'right' | 'center' at x
export function drawPow10(ctx, e, x, y, align = 'right', font = FONT) {
  ctx.save();
  ctx.font = font; const wb = ctx.measureText('10').width;
  const sup = font.replace(/(\d+)px/, (_, n) => `${Math.round(n * 0.78)}px`);
  ctx.font = sup; const we = ctx.measureText(String(e).replace('-', '−')).width;
  const W = wb + we + 1, x0 = align === 'right' ? x - W : align === 'center' ? x - W / 2 : x;
  ctx.textAlign = 'left';
  ctx.font = font; ctx.fillText('10', x0, y);
  ctx.font = sup; ctx.fillText(String(e).replace('-', '−'), x0 + wb + 1, y - 6);
  ctx.restore();
  return W;
}

// a length in nm as text with a sensible unit
export function fmtLen(nm, digits = null) {
  const a = Math.abs(nm);
  const t = (v) => (digits != null ? v.toFixed(digits) : String(+v.toPrecision(4)));
  if (a >= 1e6) return t(nm / 1e6) + ' mm';
  if (a >= 1000) return t(nm / 1000) + ' µm';
  return t(nm) + ' nm';
}

// "nice" tick step for a span covering about n intervals
export function niceStep(span, n = 6) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
