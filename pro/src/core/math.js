// Special functions shared by the core. erf/erfc are accurate to ~1e-14 (series for small |x|,
// Lentz continued fraction for the tail), so they never limit the accuracy.

const TWO_OVER_SQRTPI = 2 / Math.sqrt(Math.PI);

function erfSeries(x) {
  // erf(x) = 2/√π Σ (−1)^n x^{2n+1} / (n! (2n+1))
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n < 200; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
  }
  return TWO_OVER_SQRTPI * sum;
}

function erfcContinuedFraction(x) {
  // erfc(x) = e^{-x²}/√π · 1/(x + 1/2/(x + 1/(x + 3/2/(x + ...)))), x > 0 (modified Lentz)
  const tiny = 1e-300;
  let f = x, C = x, D = 0;
  for (let n = 1; n < 500; n++) {
    const a = n / 2;
    D = x + a * D; D = Math.abs(D) < tiny ? tiny : D; D = 1 / D;
    C = x + a / C; C = Math.abs(C) < tiny ? tiny : C;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) return 1 - erfSeries(x);
  if (x > 27) return 0;
  return erfcContinuedFraction(x);
}

export function erf(x) {
  if (Math.abs(x) < 2.5) return erfSeries(x);
  return x > 0 ? 1 - erfc(x) : erfc(-x) - 1;
}
