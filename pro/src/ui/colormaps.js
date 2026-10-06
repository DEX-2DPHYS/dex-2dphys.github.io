// Colour scales for dose maps and the 3D surface (Peter, 2026-10-01: "10 good color scales").
// Each scale is a list of evenly spaced stops (sRGB hex), interpolated linearly. The
// perceptually uniform ones (viridis … cividis) are matplotlib's, sampled at 10 points;
// turbo is Google's; coolwarm is Moreland's diverging map; YlGnBu is ColorBrewer's.

const STOPS = {
  viridis: ['440154', '482878', '3e4989', '31688e', '26828e', '1f9e89', '35b779', '6ece58', 'b5de2b', 'fde725'],
  magma: ['000004', '180f3d', '440f76', '721f81', '9e2f7f', 'cd4071', 'f1605d', 'fd9668', 'feca8d', 'fcfdbf'],
  inferno: ['000004', '1b0c41', '4a0c6b', '781c6d', 'a52c60', 'cf4446', 'ed6925', 'fb9b06', 'f7d13d', 'fcffa4'],
  plasma: ['0d0887', '47039f', '7301a8', '9c179e', 'bd3786', 'd8576b', 'ed7953', 'fb9f3a', 'fdca26', 'f0f921'],
  cividis: ['00224e', '123570', '3b496c', '575d6d', '707173', '8a8678', 'a59c74', 'c3b369', 'e1cc55', 'fee838'],
  turbo: ['30123b', '4145ab', '4675ed', '39a2fc', '1bcfd4', '24eca6', '61fc6c', 'a4fc3b', 'd1e834', 'f3c63a', 'fe9b2d', 'f36315', 'd93806', 'b11901', '7a0403'],
  coolwarm: ['3b4cc0', '6688ee', '88bbff', 'b8d0f9', 'dddddd', 'f5c4ad', 'f49a7b', 'de604d', 'b40426'],
  ylgnbu: ['ffffd9', 'edf8b1', 'c7e9b4', '7fcdbb', '41b6c4', '1d91c0', '225ea8', '253494', '081d58'],
  gray: ['ffffff', '000000'],
  wred: ['ffffff', 'ff0000'],
};
export const CMAP_LABELS = {
  viridis: 'Viridis', magma: 'Magma', inferno: 'Inferno', plasma: 'Plasma', cividis: 'Cividis (colour-blind safe)',
  turbo: 'Turbo (rainbow)', coolwarm: 'Cool ↔ warm', ylgnbu: 'Yellow → blue', gray: 'Grey', wred: 'White → red',
};
const ALIAS = { bwr: 'coolwarm' };

const rgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const cache = new Map();

// t ∈ [0, 1] → [r, g, b] (0–255)
export function cmapFn(name) {
  const key = ALIAS[name] || (STOPS[name] ? name : 'viridis');
  if (cache.has(key)) return cache.get(key);
  const s = STOPS[key].map(rgb), n = s.length - 1;
  const f = (t) => {
    const u = Math.max(0, Math.min(1, t)) * n, i = Math.min(n - 1, Math.floor(u)), a = u - i, p = s[i], q = s[i + 1];
    return [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a, p[2] + (q[2] - p[2]) * a];
  };
  cache.set(key, f);
  return f;
}

// 256 × 1 RGBA lookup table for a texture
export function cmapLUT(name, n = 256) {
  const f = cmapFn(name), out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const c = f(i / (n - 1)); out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; }
  return out;
}

export const cmapOptions = (sel) => Object.entries(CMAP_LABELS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
