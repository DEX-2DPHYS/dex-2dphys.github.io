// The glovebox: a nearly invisible hemisphere standing on the worktop that keeps the atoms in. The hands go through it (it is drawn,
// never hit by the pointer, and the atoms held in a hand are free to leave); every other atom that reaches it is reflected with a
// little damping, so a hot or chaotic experiment calms down instead of scattering over the room.
//
// Everything here is in box coordinates (Angstrom): the centre C lies on the worktop plane, R is the radius. main.js finds C and the
// plane each frame (src/main.js, gloveFrame) and calls gloveStep after every MD step.

export const GLOVE = {
  e: 0.9,          // restitution of the normal velocity: a bounce keeps 81 % of the normal kinetic energy and all of the tangential
  push: 0.05,      // at most this far (A) back towards the inside per step: a bouncing atom is never this deep, a piece left outside
                   // (carried out by hand, or the box made smaller) slides home at ~30 A/s instead of jumping
  margin: 4,       // A of free space round the structure when the box is sized to it
  baseM: 0.405,    // default radius in metres on the bench (the structure is fitted to ~0.45 m): it fits on the worktop
};

// One MD step's worth of wall: atoms beyond R - rad are moved back (at most GLOVE.push) and an outward velocity is reflected.
// g = { cx, cy, cz, R, rad }; held (Uint8Array or null) marks atoms in a hand. Returns the number of bounces (for the glow).
export function gloveStep(m, g, held) {
  const N = m.N, X = m.x, Y = m.y, Z = m.z, VX = m.vx, VY = m.vy, VZ = m.vz, fixed = m.fixed;
  const Ri = g.R - g.rad, Ri2 = Ri * Ri, e1 = 1 + GLOVE.e, P = GLOVE.push; let hits = 0;
  if (!(Ri > 0)) return 0;
  for (let i = 0; i < N; i++) {
    const dx = X[i] - g.cx, dy = Y[i] - g.cy, dz = Z[i] - g.cz, r2 = dx * dx + dy * dy + dz * dz;
    if (r2 <= Ri2) continue;
    if ((fixed && fixed[i]) || (held && held[i])) continue;
    const r = Math.sqrt(r2), ux = dx / r, uy = dy / r, uz = dz / r, k = Math.min(r - Ri, P);
    X[i] -= ux * k; Y[i] -= uy * k; Z[i] -= uz * k;
    const vn = ux * VX[i] + uy * VY[i] + uz * VZ[i];
    if (vn > 0) { VX[i] -= e1 * vn * ux; VY[i] -= e1 * vn * uy; VZ[i] -= e1 * vn * uz; hits++; }
  }
  return hits;
}

// The radius (A) that fits the structure: the default size on the bench, or larger when the atoms reach further from C.
export function gloveFit(m, cx, cy, cz, wps) {
  let r2 = 0;
  for (let i = 0; i < m.N; i++) { const dx = m.x[i] - cx, dy = m.y[i] - cy, dz = m.z[i] - cz; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
  return Math.max(GLOVE.baseM / wps, Math.sqrt(r2) + GLOVE.margin);
}

// Pause and run: pausing stops every atom (all velocities zero); running again warms them from 0 K back to the set temperature over
// RAMP_S seconds, with a tighter thermostat while it ramps so the temperature follows the ramp instead of jumping.
export const RAMP_S = 5;
export function rampFactor(tSec) { const f = Math.min(1, Math.max(0, tSec / RAMP_S)); return Math.max(0.002, f); }

export const GLOVE_DA = {
  'Glovebox (keeps the atoms in)': 'Handskeboks (holder atomerne inde)',
  'Glovebox': 'Handskeboks',
  'Glovebox size': 'Handskeboksens størrelse',
  'Glovebox on': 'Handskeboks til',
  'Glovebox off': 'Handskeboks fra',
  'A see-through dome on the table: atoms bounce off it and lose a little speed, your hands go straight through.': 'En gennemsigtig kuppel på bordet: atomerne preller af og mister lidt fart, dine hænder går lige igennem.',
  'Paused: every atom stopped': 'Pause: alle atomer står stille',
  'Warming up to {1} K over 5 s': 'Varmer op til {1} K over 5 s',
  'RUN / PAUSE - pause stops every atom; run warms them back up to the set temperature over 5 s (space bar)': 'KØR / PAUSE - pause stopper alle atomer; kør varmer dem op til den valgte temperatur igen over 5 s (mellemrumstasten)',
};
