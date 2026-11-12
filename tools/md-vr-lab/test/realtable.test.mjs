// node test/realtable.test.mjs - the see-through table fit (src/realtable.js): plane polygon -> rectangle -> bench placement
import { rectFromPolygon, planeCorners, cornersFromEdge, fitTable, pickTable, DESK_Z } from '../src/realtable.js';
let fail = 0; const ok = (n, c, i = '') => { console.log((c ? 'ok   ' : 'FAIL ') + n + (i ? '  ' + i : '')); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const deg = Math.PI / 180;
// a table W x D, centre (cx, top, cz), turned by a about +y; corners in order round it
function table(W, D, cx, top, cz, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map(([x, z]) => [cx + c * x + s * z, top, cz - s * x + c * z]);
}
// bench placement -> world position of a bench-local point (three.js: rotation.y = yaw)
const toWorld = (f, lx, lz) => { const c = Math.cos(f.yaw), s = Math.sin(f.yaw); return [f.benchPos[0] + c * lx + s * lz, f.benchPos[1] - s * lx + c * lz]; };

{ // 1.6 x 0.8 table turned 30 degrees, the user 0.5 m in front of its long edge
  const T = table(1.6, 0.8, 2, 0.74, -1, 30 * deg), n = [Math.sin(30 * deg), Math.cos(30 * deg)];            // +z side of the table, turned
  const head = [2 + n[0] * 0.9, 1.2, -1 + n[1] * 0.9], f = fitTable(T, head);
  const C = toWorld(f, 0, DESK_Z);
  ok('table centre lands on the bench desk centre', near(C[0], 2, 1e-9) && near(C[1], -1, 1e-9), `(${C[0].toFixed(3)}, ${C[1].toFixed(3)})`);
  ok('top height, width and depth', near(f.top, 0.74) && near(f.W, 1.6) && near(f.D, 0.8), `W ${f.W.toFixed(3)} D ${f.D.toFixed(3)}`);
  ok('bench faces into the table (the user looks along -z)', near(f.ext.z1, DESK_Z + 0.4, 1e-9) && near(f.ext.z0, DESK_Z - 0.4, 1e-9) && near(f.ext.x0, -0.8, 1e-9) && near(f.ext.x1, 0.8, 1e-9), JSON.stringify(Object.fromEntries(Object.entries(f.ext).map(([k, v]) => [k, +v.toFixed(3)]))));
  const lh = f.local(head); ok('the user is on the bench\'s +z side, in front of the front edge', lh[1] > f.ext.z1 && Math.abs(lh[0]) < 1e-9, `user at (${lh[0].toFixed(2)}, ${lh[1].toFixed(2)})`);
  // the other person, across the table: the same centre, the bench turned half a circle
  const head2 = [2 - n[0] * 0.9, 1.2, -1 - n[1] * 0.9], g = fitTable(T, head2), C2 = toWorld(g, 0, DESK_Z);
  let dy = g.yaw - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  ok('across the table: same centre, turned 180 degrees (Together)', near(C2[0], 2, 1e-9) && near(C2[1], -1, 1e-9) && near(Math.abs(dy), Math.PI, 1e-9));
  // at the short end
  const head3 = [2 + Math.cos(30 * deg) * 1.3, 1.2, -1 - Math.sin(30 * deg) * 1.3], h = fitTable(T, head3);
  ok('at the short end: the short edge is the front', near(h.W, 0.8) && near(h.D, 1.6) && near(h.ext.x1 - h.ext.x0, 0.8, 1e-9));
}
{ // a big 3 x 1.6 table: the work area is the part in front of the user, not the far middle
  const T = table(3, 1.6, 0, 0.9, 0, 0), head = [0.5, 1.3, 1.3], f = fitTable(T, head), C = toWorld(f, 0, DESK_Z);
  ok('big table: work centre 0.5 m in from the edge, in front of the user', near(C[0], 0.5, 1e-9) && near(C[1], 0.3, 1e-9), `(${C[0].toFixed(2)}, ${C[1].toFixed(2)})`);
  const head2 = [1.45, 1.3, 1.3], g = fitTable(T, head2), C2 = toWorld(g, 0, DESK_Z);
  ok('big table: never closer than 0.6 m to its end', near(C2[0], 0.9, 1e-9), `x ${C2[0].toFixed(2)}`);
}
{ // two touched points on the front edge
  const a = [0.4, 0.76, -0.5], b = [-0.4, 0.74, -0.5], head = [0, 1.2, 0], E = cornersFromEdge(a, b, head, 0.8), f = fitTable(E, head), C = toWorld(f, 0, DESK_Z);
  ok('touched edge: depth goes away from the user, top = mean height', E.every((p) => p[2] <= -0.5 + 1e-9) && near(f.top, 0.75), `z ${E.map((p) => p[2].toFixed(2)).join(' ')}`);
  ok('touched edge: front edge at the touched line, centre 0.4 m behind it', near(C[0], 0, 1e-9) && near(C[1], -0.9, 1e-9) && near(f.ext.z1, DESK_Z + 0.4, 1e-9));
}
{ // polygons: a scanned table (jagged), a plane pose with the plane's own turn
  const pts = []; for (let k = 0; k < 40; k++) { const t = k / 40 * 4, side = Math.floor(t), u = t - side, jit = 0.004 * Math.sin(k * 7.1);
    const P = [[-0.6 + 1.2 * u, -0.35 + jit], [0.6 + jit, -0.35 + 0.7 * u], [0.6 - 1.2 * u, 0.35 + jit], [-0.6 + jit, 0.35 - 0.7 * u]][side]; pts.push(P); }
  const r = rectFromPolygon(pts), w = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]), d = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
  ok('jagged scan outline -> its rectangle', near(Math.max(w, d), 1.2, 0.02) && near(Math.min(w, d), 0.7, 0.02), `${Math.max(w, d).toFixed(3)} x ${Math.min(w, d).toFixed(3)}`);
  const a = 40 * deg, m = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 1.5, 0.72, 2.0, 1];   // turned plane at (1.5, 0.72, 2)
  const W = planeCorners([[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [-0.5, 0.3]], m);
  const cx = W.reduce((s, p) => s + p[0], 0) / 4, cz = W.reduce((s, p) => s + p[2], 0) / 4;
  ok('plane pose: corners at the plane\'s place and height', near(cx, 1.5, 1e-9) && near(cz, 2.0, 1e-9) && W.every((p) => near(p[1], 0.72)));
}
{ // picking the table
  const head = [0, 1.2, 0];
  const planes = [
    { corners: table(4, 4, 0, 0, 0, 0), label: 'floor', horizontal: true },
    { corners: table(1.2, 0.6, 0, 0.72, -3, 0), label: 'table', horizontal: true },
    { corners: table(1.0, 0.5, 0.2, 0.75, -0.9, 0), label: 'table', horizontal: true },
    { corners: table(0.8, 0.4, 0, 0.45, -0.6, 0), label: 'couch', horizontal: true },
    { corners: table(0.6, 0.4, 0.1, 0.8, -0.5, 0), label: 'other', horizontal: true },
  ];
  ok('nearest labelled table wins over floor, couch, a far table and an unlabelled shelf', pickTable(planes, head) === 2);
  ok('no labels: a horizontal surface at table height', pickTable([planes[0], { corners: planes[2].corners, label: '', horizontal: true }], head) === 1);
  ok('nothing table-like: none', pickTable([planes[0], planes[3]], head) === -1);
}
if (fail) { console.log(fail + ' FAILED'); process.exit(1); } else console.log('all real-table checks passed');
