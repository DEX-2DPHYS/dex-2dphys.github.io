// Ideal (raster) proximity correction by regularised Wiener deconvolution — the teaching view
// carried over from Pattern Studio. It shows the continuous writing-dose map that
// would reproduce the design, and why it is unphysical: negative or huge doses, ringing,
// clipping, and the role of the regularisation λ.
//
//   write = F⁻¹[ T̂ · H / (H² + λ) ],  clipped to [0, maxDose];   delivered = F⁻¹[ ŵrite · H ]
//
// H is the PSF's transfer function, H(0) = 1: Σ w·exp(−π² s² f²) for Gaussian terms and
// Σ w·(1 + (2π s f)²)^{−3/2} for exponential ones (the Hankel transform of e^{-r/s}/(2π s²)).

import { fft2, nextPow2 } from '../exposure/fft.js';

export function wienerCorrection(engine, grid, { lambda = 0.01, edge = 'pad2', maxDose = 1000 } = {}) {
  const { nx, ny, dx } = grid;
  const target = engine.raster(grid, 'designed');
  const terms = engine.psf.gauss ?? engine.psf.fit.terms;
  const f = edge === 'pad2' ? 2 : 1;
  const NX = nextPow2(nx * f), NY = nextPow2(ny * f);
  const H = new Float64Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    const fy = (j <= NY / 2 ? j : j - NY) / (NY * dx);
    for (let i = 0; i < NX; i++) {
      const fx = (i <= NX / 2 ? i : i - NX) / (NX * dx), f2 = fx * fx + fy * fy;
      let h = 0;
      for (const t of terms) h += t.kind === 'exp' ? t.w * Math.pow(1 + 4 * Math.PI * Math.PI * t.s * t.s * f2, -1.5) : t.w * Math.exp(-Math.PI * Math.PI * t.s * t.s * f2);
      H[j * NX + i] = h;
    }
  }
  const re = new Float64Array(NX * NY), im = new Float64Array(NX * NY);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) re[j * NX + i] = target[j * nx + i];
  fft2(re, im, NX, NY);
  for (let k = 0; k < re.length; k++) { const w = H[k] / (H[k] * H[k] + lambda); re[k] *= w; im[k] *= w; }
  fft2(re, im, NX, NY, true);
  const write = new Float32Array(nx * ny);
  let clipped = 0, negative = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let v = re[j * NX + i];
    if (v < 0) { negative++; v = 0; }
    if (v > maxDose) { clipped++; v = maxDose; }
    write[j * nx + i] = v;
  }
  const r2 = new Float64Array(NX * NY), i2 = new Float64Array(NX * NY);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) r2[j * NX + i] = write[j * nx + i];
  fft2(r2, i2, NX, NY);
  for (let k = 0; k < r2.length; k++) { r2[k] *= H[k]; i2[k] *= H[k]; }
  fft2(r2, i2, NX, NY, true);
  const delivered = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) delivered[j * nx + i] = r2[j * NX + i];
  return { target, write, delivered, clippedFraction: clipped / (nx * ny), negativeFraction: negative / (nx * ny), grid };
}
