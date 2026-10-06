// Radix-2 complex FFT (in place, Float64Array re/im) and 2D convolution helpers.
// Twiddles and bit reversal are tabulated per length (as in the EBL Development simulator).

const tables = new Map();
function tablesFor(n) {
  let t = tables.get(n);
  if (t) return t;
  if (n & (n - 1)) throw new Error(`FFT length ${n} is not a power of two`);
  const rev = new Uint32Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    rev[i] = j;
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos((-2 * Math.PI * k) / n); sin[k] = Math.sin((-2 * Math.PI * k) / n); }
  t = { rev, cos, sin };
  if (tables.size > 8) tables.clear();
  tables.set(n, t);
  return t;
}

export const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

// Forward transform (sign −1) of one line; stride/offset address a row or a column of a 2D array.
function fftLine(re, im, n, offset, stride, inverse) {
  const { rev, cos, sin } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = offset + i * stride, b = offset + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  const sg = inverse ? -1 : 1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sg * sin[k * step];
        const a = offset + (i + k) * stride, b = a + half * stride;
        const tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { const a = offset + i * stride; re[a] /= n; im[a] /= n; }
}

export function fft1(re, im, inverse = false) { fftLine(re, im, re.length, 0, 1, inverse); }

// Column transforms through a contiguous scratch copy (a strided column misses the cache).
let scratch = null;
function fftColumns(re, im, nx, ny, inverse) {
  if (!scratch || scratch.re.length < ny) scratch = { re: new Float64Array(ny), im: new Float64Array(ny) };
  const cr = scratch.re, ci = scratch.im;
  for (let i = 0; i < nx; i++) {
    for (let j = 0, a = i; j < ny; j++, a += nx) { cr[j] = re[a]; ci[j] = im[a]; }
    fftLine(cr, ci, ny, 0, 1, inverse);
    for (let j = 0, a = i; j < ny; j++, a += nx) { re[a] = cr[j]; im[a] = ci[j]; }
  }
}

// 2D transform of an nx × ny array (row-major, index = j*nx + i). rows: only rows < rows are
// transformed along x (forward: the others are zero; inverse: the others are not needed).
export function fft2(re, im, nx, ny, inverse = false, rows = ny) {
  if (!inverse) {
    for (let j = 0; j < rows; j++) fftLine(re, im, nx, j * nx, 1, false);
    fftColumns(re, im, nx, ny, false);
  } else {
    fftColumns(re, im, nx, ny, true);
    for (let j = 0; j < rows; j++) fftLine(re, im, nx, j * nx, 1, true);
  }
}

// Spectrum of a kernel given as a function k(di, dj) of cell offsets, |di| ≤ rx, |dj| ≤ ry,
// wrapped into an NX × NY periodic array (so convolution is centred).
export function kernelSpectrum(kfun, rx, ry, NX, NY) {
  const re = new Float64Array(NX * NY), im = new Float64Array(NX * NY);
  for (let dj = -ry; dj <= ry; dj++) {
    const jj = (dj + NY) % NY;
    for (let di = -rx; di <= rx; di++) re[jj * NX + ((di + NX) % NX)] += kfun(di, dj);
  }
  fft2(re, im, NX, NY);
  return { re, im, NX, NY };
}

// Linear convolution of an nx × ny field with a kernel spectrum built for NX × NY
// (NX ≥ nx + 2rx, NY ≥ ny + 2ry so nothing wraps into the result).
export function convolve(field, nx, ny, spec) {
  const { NX, NY } = spec;
  const re = new Float64Array(NX * NY), im = new Float64Array(NX * NY);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) re[j * NX + i] = field[j * nx + i];
  fft2(re, im, NX, NY, false, ny);              // rows ≥ ny are zero
  for (let k = 0; k < re.length; k++) {
    const a = re[k], b = im[k], c = spec.re[k], d = spec.im[k];
    re[k] = a * c - b * d; im[k] = a * d + b * c;
  }
  fft2(re, im, NX, NY, true, ny);               // only rows < ny are read back
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = re[j * NX + i];
  return out;
}
