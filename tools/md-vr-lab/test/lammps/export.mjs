import { Mat } from '../../src/materials.js';
import fs from 'fs';
let s = 99; const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const out = {};
const dump = (name, m) => {
  for (let i = 0; i < m.N; i++) { m.x[i] += (rng() - .5) * 0.2; m.y[i] += (rng() - .5) * 0.2; m.z[i] += (rng() - .5) * 0.2; }
  m.listDirty = true; m.computeForces();
  out[name] = { N: m.N, box: [m.Lx, m.Ly, m.Lz], per: m.per, sp: Array.from(m.sp.slice(0, m.N)), x: Array.from(m.x.slice(0, m.N)), y: Array.from(m.y.slice(0, m.N)), z: Array.from(m.z.slice(0, m.N)), PE: m.PE, fx: Array.from(m.fx.slice(0, m.N)), fy: Array.from(m.fy.slice(0, m.N)), fz: Array.from(m.fz.slice(0, m.N)) };
};
let m = new Mat(); m.buildGraphene(4, 3, 1); dump('graphene', m);
m = new Mat(); m.buildNanodiamond(5.5, 1); dump('nanodiamond', m);
m = new Mat(); m.buildMoS2(4, 2, 1, 1); dump('mos2', m);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
