// Seedable random numbers for the Monte Carlo: xoshiro128** seeded through
// splitmix32. A batch of electrons is identified by (run seed, batch index), so a run gives the
// same tallies whatever the number of workers that shared it.

function splitmix32(a) {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function makeRng(seed, stream = 0) {
  const sm = splitmix32((seed >>> 0) ^ Math.imul(stream + 1, 0x85ebca6b));
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
  if (!(s0 | s1 | s2 | s3)) s0 = 1;
  // uniform in (0, 1): never exactly 0 or 1, so −ln(u) and ln(1 − u) are always finite
  return function next() {
    const r = Math.imul(((Math.imul(s1, 5) << 7) | (Math.imul(s1, 5) >>> 25)), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return (r + 0.5) * 2.3283064365386963e-10;
  };
}
