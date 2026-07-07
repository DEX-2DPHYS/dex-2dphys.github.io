/* maps.js — optional spatial maps from uploaded images, plus samplers.
 *
 * An uploaded JPG/PNG is drawn to an offscreen canvas; its pixels are converted
 * to a scalar field on a coarse grid (density or mobility), or classified into
 * contact regions (contact map). Bilinear samplers expose the fields to the
 * solvers as n(x,y) / mu(x,y). All conversions are deliberately simple.
 */
(function (global) {
  "use strict";

  // Read an uploaded File into an ImageData via an offscreen canvas.
  function fileToImageData(file, maxDim, cb) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function () {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cb(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  function pixelIntensity(data, p, channel) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    switch (channel) {
      case "r": return r / 255;
      case "g": return g / 255;
      case "b": return b / 255;
      default: return (0.299 * r + 0.587 * g + 0.114 * b) / 255; // luminance
    }
  }

  // Convert an ImageData to a scalar field grid (row 0 = TOP of image = top of
  // device). opts: {channel, invert, smooth, vmin, vmax}. Returns {values,gx,gy}.
  function imageToField(imageData, opts) {
    opts = opts || {};
    const { width: gx, height: gy, data } = imageData;
    let v = new Float64Array(gx * gy);
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const p = (j * gx + i) * 4;
        let t = pixelIntensity(data, p, opts.channel || "lum");
        if (opts.invert) t = 1 - t;
        v[j * gx + i] = t;
      }
    }
    if (opts.smooth) v = boxBlur(v, gx, gy, opts.smooth | 0 || 1);
    const vmin = opts.vmin ?? 0, vmax = opts.vmax ?? 1;
    for (let k = 0; k < v.length; k++) v[k] = vmin + (vmax - vmin) * v[k];
    return { values: v, gx, gy };
  }

  function boxBlur(v, gx, gy, radius) {
    const out = new Float64Array(v.length);
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        let s = 0, n = 0;
        for (let dj = -radius; dj <= radius; dj++) {
          for (let di = -radius; di <= radius; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && ii < gx && jj >= 0 && jj < gy) { s += v[jj * gx + ii]; n++; }
          }
        }
        out[j * gx + i] = s / n;
      }
    }
    return out;
  }

  // Bilinear sampler over a field; device coords x in [0,W], y in [0,H] with
  // y measured from the BOTTOM, while field row 0 is the TOP -> flip in y.
  function makeSampler(field, W, H) {
    const { values, gx, gy } = field;
    return function (x, y) {
      const fx = Math.min(0.999999, Math.max(0, x / W)) * (gx - 1);
      const fyTop = (1 - Math.min(0.999999, Math.max(0, y / H))) * (gy - 1);
      const i0 = Math.floor(fx), j0 = Math.floor(fyTop);
      const i1 = Math.min(gx - 1, i0 + 1), j1 = Math.min(gy - 1, j0 + 1);
      const tx = fx - i0, ty = fyTop - j0;
      const v00 = values[j0 * gx + i0], v10 = values[j0 * gx + i1];
      const v01 = values[j1 * gx + i0], v11 = values[j1 * gx + i1];
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    };
  }

  // Resample a field onto a target solver grid (nx,ny), returning Float64Array
  // in solver order (row 0 = BOTTOM).
  function resampleToGrid(field, W, H, nx, ny) {
    const s = makeSampler(field, W, H);
    const out = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = ((j + 0.5) / ny) * H;
      for (let i = 0; i < nx; i++) {
        const x = ((i + 0.5) / nx) * W;
        out[j * nx + i] = s(x, y);
      }
    }
    return out;
  }

  // Contact map -> contact regions with fractional bounding boxes (image space,
  // row 0 = top). Convention: near-black = active graphene, near-white = etched,
  // saturated colour OR distinct grey level = a contact. Auto-detects whether
  // the image is colour or greyscale. Returns {regions:[{id,color,x0,y0,x1,y1,
  // count}], gx, gy, mode}. (Browser canvas is 8-bit/channel; for true 16-bit
  // greyscale use the Python app.)
  function contactsFromImage(imageData, opts) {
    opts = opts || {};
    const { width: gx, height: gy, data } = imageData;
    const satThresh = opts.satThreshold ?? 0.35;

    // measure overall saturation to pick colour vs greyscale interpretation
    let satPix = 0;
    for (let p = 0; p < data.length; p += 4) {
      const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 0 && (mx - mn) / mx >= satThresh) satPix++;
    }
    const greyscale = satPix < 0.02 * gx * gy;

    const buckets = new Map();
    const acc = (key, i, j, col) => {
      let bk = buckets.get(key);
      if (!bk) { bk = { n: 0, i0: gx, j0: gy, i1: 0, j1: 0, col }; buckets.set(key, bk); }
      bk.n++; bk.i0 = Math.min(bk.i0, i); bk.j0 = Math.min(bk.j0, j);
      bk.i1 = Math.max(bk.i1, i); bk.j1 = Math.max(bk.j1, j);
    };

    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const p = (j * gx + i) * 4;
        const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
        if (greyscale) {
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          if (l < 0.12 || l > 0.88) continue; // active (dark) / etched (bright)
          const key = "g" + Math.round(l * 8); // distinct grey levels -> contacts
          acc(key, i, j, "#cccccc");
        } else {
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx <= 0 || (mx - mn) / mx < satThresh) continue;
          const key = Math.round(rgbToHue(r, g, b) / 30) * 30;
          acc(key, i, j, `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`);
        }
      }
    }

    const regions = [];
    let id = 0;
    for (const [, bk] of [...buckets.entries()].sort((a, c) => c[1].n - a[1].n)) {
      if (bk.n < gx * gy * 0.002) continue;
      regions.push({
        id: "C" + id++, color: bk.col, count: bk.n,
        x0: bk.i0 / gx, y0: bk.j0 / gy, x1: (bk.i1 + 1) / gx, y1: (bk.j1 + 1) / gy,
      });
    }
    return { regions, gx, gy, mode: greyscale ? "greyscale" : "colour" };
  }

  function rgbToHue(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return h;
  }

  global.GT = global.GT || {};
  global.GT.maps = {
    fileToImageData, imageToField, makeSampler, resampleToGrid, contactsFromImage,
  };
})(typeof window !== "undefined" ? window : globalThis);
