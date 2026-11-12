// Real table (see-through mode): from a table the headset knows (WebXR plane detection: Space Setup on a Quest) or from two
// points touched on its front edge, to where the lab's table frame ("bench") goes. Plain math, no three.js, so it is testable in node.
//
// The bench frame: the user sits near its origin looking along -z; the virtual table centre is at (0, tableH, -1.0) and the experiment
// floats above it. fitTable() returns the bench's turn (yaw about +y, three.js convention) and position so that the work centre lands on
// the real table, plus the real table's extent in bench coordinates (for the solid worktop, the panels and the thermometer).

export const DESK_Z = -1.0;          // the table centre in bench coordinates (as SIM_HOME)

// smallest-area rectangle round a polygon given as [[x, z], ...] (a Quest table plane is already a rectangle; scanned shapes may not be)
export function rectFromPolygon(pts) {
  let best = null;
  for (let deg = 0; deg < 90; deg += 0.5) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of pts) { const u = c * x + s * z, v = -s * x + c * z; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, c, s, u0, u1, v0, v1 };
  }
  const { c, s, u0, u1, v0, v1 } = best, back = (u, v) => [c * u - s * v, s * u + c * v];
  return [back(u0, v0), back(u1, v0), back(u1, v1), back(u0, v1)];
}

// the rectangle's four corners in world coordinates; m = the plane pose as a column-major 4x4 (XRRigidTransform.matrix); plane space y = 0
export function planeCorners(poly, m) {
  return rectFromPolygon(poly).map(([x, z]) => [m[0] * x + m[8] * z + m[12], m[1] * x + m[9] * z + m[13], m[2] * x + m[10] * z + m[14]]);
}

// two points touched on the edge nearest the user -> a rectangle reaching `depth` metres away from the user
export function cornersFromEdge(a, b, head, depth = 0.8) {
  const y = (a[1] + b[1]) / 2, ux = b[0] - a[0], uz = b[2] - a[2], L = Math.hypot(ux, uz) || 1;
  let nx = -uz / L, nz = ux / L;
  const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
  if ((mx - head[0]) * nx + (mz - head[2]) * nz < 0) { nx = -nx; nz = -nz; }           // away from the user, into the table
  return [[a[0], y, a[2]], [b[0], y, b[2]], [b[0] + nx * depth, y, b[2] + nz * depth], [a[0] + nx * depth, y, a[2] + nz * depth]];
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
export function headDistance(corners, head) {          // horizontal distance from the head to the table's outline (0 when above it)
  let d = 1e9; for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; d = Math.min(d, segDist(head[0], head[2], a[0], a[2], b[0], b[2])); }
  return d;
}

// corners: 4 world points of the table top, in order round it; head: the user's eyes. Opts: the largest table that is used whole (centred).
export function fitTable(corners, head, { wholeW = 2.0, wholeD = 1.2 } = {}) {
  const top = corners.reduce((s, c) => s + c[1], 0) / 4;
  let fi = 0, fd = 1e9;                                    // the front edge: the one nearest the user
  for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4], d = segDist(head[0], head[2], a[0], a[2], b[0], b[2]); if (d < fd - 1e-9) { fd = d; fi = i; } }
  const A = corners[fi], B = corners[(fi + 1) % 4], W = Math.hypot(B[0] - A[0], B[2] - A[2]) || 1e-6;
  const ux = (B[0] - A[0]) / W, uz = (B[2] - A[2]) / W;
  const cx = corners.reduce((s, c) => s + c[0], 0) / 4, cz = corners.reduce((s, c) => s + c[2], 0) / 4;
  let nx = -uz, nz = ux; if ((cx - A[0]) * nx + (cz - A[2]) * nz < 0) { nx = -nx; nz = -nz; }
  const D = 2 * ((cx - A[0]) * nx + (cz - A[2]) * nz);
  // the work centre: the table's middle - on a very long or deep table, the part in front of the user
  const sHead = (head[0] - A[0]) * ux + (head[2] - A[2]) * uz;
  const s = W <= wholeW ? W / 2 : Math.max(0.6, Math.min(W - 0.6, sHead)), t = D <= wholeD ? D / 2 : 0.5;
  const C = [A[0] + ux * s + nx * t, top, A[2] + uz * s + nz * t];
  const yaw = Math.atan2(-nx, -nz);                        // bench -z (forward) = into the table
  const bx = C[0] + nx * DESK_Z, bz = C[2] + nz * DESK_Z;   // bench origin: 1 m in front of the work centre, towards the user
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const local = (p) => { const dx = p[0] - bx, dz = p[2] - bz; return [dx * c - dz * sn, dx * sn + dz * c]; };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of corners) { const [lx, lz] = local(p); x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); }
  return { yaw, top, centre: C, benchPos: [bx, bz], ext: { x0, x1, z0, z1 }, W, D, local };
}

// pick the table among detected planes: [{ corners, label, horizontal }]. Labelled tables and desks first, then any horizontal surface
// at table height (a scan without labels); the nearest to the user wins. Returns the index or -1.
export function pickTable(planes, head, floorY = 0) {
  let best = -1, bestScore = 1e9;
  planes.forEach((p, i) => {
    if (!p.horizontal) return;
    const label = (p.label || '').toLowerCase(), h = p.corners.reduce((s, c) => s + c[1], 0) / 4 - floorY;
    if (/floor|ceiling|wall|door|window|couch|sofa|bed|screen|lamp|plant|storage|shelf/.test(label)) return;
    const tableish = /table|desk/.test(label);
    if (!tableish && (h < 0.35 || h > 1.3)) return;
    const [a, b, c] = p.corners, area = Math.hypot(b[0] - a[0], b[2] - a[2]) * Math.hypot(c[0] - b[0], c[2] - b[2]);
    if (area < 0.12) return;
    const score = headDistance(p.corners, head) + (tableish ? 0 : 5);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

export const TABLE_DA = {
  'Real table': 'Rigtigt bord',
  'Real table (see-through)': 'Rigtigt bord (gennemsigtig)',
  'Starting see-through…': 'Starter gennemsigtig…',
  'Could not start see-through: {1}': 'Kunne ikke starte gennemsigtig visning: {1}',
  'Lab set on your table ({1} x {2} cm)': 'Laboratoriet står på dit bord ({1} x {2} cm)',
  'Lab set on the table edge you touched': 'Laboratoriet står ved den bordkant, du rørte',
  'No table found in the room scan. Touch the table edge nearest you with the fingertip (where the laser starts): first at the left, then at the right.': 'Intet bord fundet i rumscanningen. Rør bordkanten nærmest dig med fingerspidsen (hvor laseren starter): først til venstre, så til højre.',
  'Touch the table edge nearest you with the fingertip (where the laser starts): first at the left, then at the right.': 'Rør bordkanten nærmest dig med fingerspidsen (hvor laseren starter): først til venstre, så til højre.',
  'Now touch the same edge further to the right': 'Rør nu den samme kant længere til højre',
  'Touch points further apart (at least 25 cm)': 'Rør punkter længere fra hinanden (mindst 25 cm)',
  'See-through: the lab stands on a real table': 'Gennemsigtig: laboratoriet står på et rigtigt bord',
  'Find my table again': 'Find mit bord igen',
  'Touch the table edge': 'Rør bordkanten',
  'Scan the room': 'Scan rummet',
  'Leave see-through': 'Forlad gennemsigtig',
  'Table from the room scan: {1} x {2} cm, top at {3} cm': 'Bord fra rumscanningen: {1} x {2} cm, bordplade i {3} cm',
  'Table from the touched edge, top at {1} cm': 'Bord fra den berørte kant, bordplade i {1} cm',
  'No table yet': 'Intet bord endnu',
  'RECENTER - find the real table again (also: click the right thumbstick)': 'CENTRER - find det rigtige bord igen (også: klik på højre thumbstick)',
  'Room scan opened: draw or confirm your table, then come back': 'Rumscanning åbnet: tegn eller bekræft dit bord, og kom så tilbage',
};
