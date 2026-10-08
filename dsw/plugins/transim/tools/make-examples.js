// Writes the example projects into ui/examples/ (one .transim.json each, plus index.json).
// Every geometry here is the one the gates verify (test/dfm.cpp, test/veselago.cpp,
// test/hydro.cpp), so what loads in the panel is what was measured.
//   node tools/make-examples.js
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'ui', 'examples');
fs.mkdirSync(OUT, { recursive: true });

// the panel's own defaults (ui/index.html value= attributes and select defaults)
const DEF = {
  W_um: 4, H_um: 2, n_cm2: 1e12, mu_cm: 50000, mfp_um: 0.5, Vsource: 0.001, Vdrain: 0, B: 0,
  res: 100, nTraj: 2000, seed: 7, femIter: 3000, femTol: 1e-9, maxSteps: 8000, maxPath_um: 240, threads: 0,
  fwdSigmaDeg: 10, phMfp300_um: 0, tempK: 300, eeMfp_um: 0, eeSigmaDeg: 15, specularity: 1, pnWidth_nm: 0,
  hydroLee_um: 0, hydroCee: 1, fieldModel: 'ohmic', hydroSlip_um: 0, hydroHallVisc: 1, mfpFromMobility: 1,
  scattering: 'isotropic', edge: 'specular', mobScope: 'cond', tracer: 'step', refract: 0, pnMode: 'klein',
};
const SWEEP = { sweepType: 'vg', measure: '2t', quantity: 'G', balMode: 'crossover', quality: 'accurate', wantFem: true, wantBal: false, snapshots: false,
  vgFrom: -40, vgTo: 40, vgN: 41, bFrom: -1, bTo: 1, bN: 41, lFrom: 1, lTo: 10000, lN: 41, tFrom: 4, tTo: 300, tN: 41, tox: 300, epsr: 3.9, vdirac: 0,
  mapXParam: 'vg', mxFrom: -40, mxTo: 40, mxN: 21, mapYParam: 'b', myFrom: -1, myTo: 1, myN: 21, mapMeasure: '2t', mapQuantity: 'G', mapSource: 'fem', mapScale: 'robust', mapLog: false };
const DISPLAY = { dSeq: 'viridis', dDiv: 'rdbu', dScale: 'linear', dClip: '99', dSmooth: '0', dPaths: true, dInterp: true, dInvert: false, dBar: true };

const PRESET = {
  hall_bar: [['source', 'source', 0, .1, .04, .9], ['drain', 'drain', .96, .1, 1, .9], ['probe_top', 'probe', .4, .94, .6, 1], ['probe_bottom', 'probe', .4, 0, .6, .06]],
  two_terminal: [['source', 'source', 0, .05, .04, .95], ['drain', 'drain', .96, .05, 1, .95]],
};
const C = (a) => a.map(([id, role, x0, y0, x1, y1]) => ({ id, role, x0: +x0.toFixed(6), y0: +y0.toFixed(6), x1: +x1.toFixed(6), y1: +y1.toFixed(6) }));
const sig = (v) => (v === 0 ? 0 : +v.toPrecision(5));
// a map from f(x_um, y_um); row 0 is the TOP edge, as in the core
function map(w, h, W, H, f) {
  const data = new Array(w * h); let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = sig(f(i / (w - 1) * W, (1 - j / (h - 1)) * H)); data[j * w + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return { w, h, data, min: lo, max: hi };
}

const EX = [];
function add(e) {
  const pr = { format: 'transim-project', version: 1, run: e.run || (e.view === 'trajectories' ? 'ballistic' : 'fem'), name: e.name, description: e.physics, tryThis: e.tryThis, refs: e.refs, saved: '2026-10-08',
    params: { ...DEF, ...(e.params || {}) }, contacts: C(e.contacts), maps: { density: e.density || null, mobility: e.mobility || null },
    sweep: { ...SWEEP, ...(e.sweep || {}) }, display: { ...DISPLAY, ...(e.display || {}) }, view: e.view || 'device' };
  const file = e.slug + '.transim.json';
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(pr));
  EX.push({ file, name: e.name, group: e.group, summary: e.summary });
}

// ================================================================ basics
add({ slug: 'hall-bar', group: 'Basic devices', name: 'Hall bar',
  summary: 'Four-terminal Hall bar: Hall resistance B/ne from the field model and from ballistic trajectories, swept in field.',
  physics: 'A 4 x 2 um graphene bar at n = 1e12 cm^-2 with source and drain at the ends and a pair of Hall probes across the middle. The FEM solves the local Ohm law with the Drude conductivity tensor (sigma_xy from mu B), which gives the classical Hall resistance R_xy = B/(n e) independent of geometry. The trajectory tracer launches carriers from every contact (Landauer-Buttiker, multi-terminal) and builds the same resistance from transmission probabilities, so it also captures what the Drude picture misses when the mean free path (here about 0.58 um from mu = 50 000 cm^2/Vs at 1e12 cm^-2) approaches the width: quenched and anomalous Hall signals at low field, where the cyclotron radius is comparable to the width. (Magnetic focusing needs two contacts on the SAME edge; these probes face each other.) Press Run sweep to trace R_xy from -1 to 1 T with both models; the trajectory curve carries error bars. Note on the FEM number: it reads about 4 % below B/ne here (0.959 at 0.5 T), and that is physics, not grid error: the end contacts are equipotentials and partly short the Hall voltage when the bar is only twice as long as it is wide (the effect grows with mu B). A bar eight times longer than wide gives 1.0000 of B/ne. Each edge probe reads the potential AT the sample edge, extrapolated from the two cells next to it.',
  tryThis: 'Mobility (mfp vs. width: 5 000 = diffusive, 500 000 = ballistic); B between -0.2 and 0.2 T where the ballistic Hall curve departs from B/ne; carrier density (R_xy scales as 1/n); edge = diffuse or partial to see how rough boundaries change the ballistic result; W_um 16 and res 300 with thin Hall probes to watch the FEM approach B/ne; Measure = Longitudinal Rxx is not meaningful here (no probes along the flow) - use the four-point example for that.',
  refs: ['K. S. Novoselov et al., Two-dimensional gas of massless Dirac fermions in graphene, Nature 438, 197 (2005).',
    'C. W. J. Beenakker, H. van Houten, Quantum transport in semiconductor nanostructures, Solid State Phys. 44, 1 (1991) - the semiclassical billiard picture of ballistic Hall and bend resistances.',
    'T. Taychatanapat, K. Watanabe, T. Taniguchi, P. Jarillo-Herrero, Electrically tunable transverse magnetic focusing in graphene, Nat. Phys. 9, 225 (2013).',
    'Y. Zhang, Y.-W. Tan, H. L. Stormer, P. Kim, Experimental observation of the quantum Hall effect and Berry\'s phase in graphene, Nature 438, 201 (2005).',
    'M. L. Roukes et al., Quenching of the Hall effect in a one-dimensional wire, Phys. Rev. Lett. 59, 3011 (1987).',
    'M. Buttiker, Four-terminal phase-coherent conductance, Phys. Rev. Lett. 57, 1761 (1986).',
    'A. S. Mayorov et al., Micrometer-scale ballistic transport in encapsulated graphene at room temperature, Nano Lett. 11, 2396 (2011).'],
  contacts: PRESET.hall_bar, sweep: { sweepType: 'b', measure: 'hall', quantity: 'R', wantFem: true, wantBal: true, bFrom: -1, bTo: 1, bN: 21 }, view: 'potential' });

add({ slug: 'two-terminal', group: 'Basic devices', name: 'Two-terminal device (diffusive to ballistic)',
  summary: 'A plain two-terminal strip: conductance against mean free path, from Ohm (G grows with l) to the Sharvin/Landauer ceiling.',
  physics: 'A 4 x 2 um strip with source and drain covering 90 % of the end edges (0.05-0.95 of the width). The FEM gives the Drude result G = sigma W/L, which grows without limit as the mean free path grows. The trajectory tracer counts how many carriers launched at the source reach the drain and multiplies by the number of transverse modes (Landauer, G = 4e^2/h N T), so it saturates at the ballistic (Sharvin) conductance once l exceeds the length. Press Run sweep to trace the mean free path from 1 nm to 10 um with both models and see the crossover where they part.',
  tryThis: 'The sweep range (l from 1 nm to 10 um); the length L (the crossover moves with it); scattering law (isotropic vs. forward: same transport mfp, same Drude limit); edge = diffuse, which costs conductance only in the ballistic regime; the gate sweep (Sweep = Vg) to see G(n) with the Dirac point.',
  refs: ['R. Landauer, Spatial variation of currents and fields due to localized scatterers in metallic conduction, IBM J. Res. Dev. 1, 223 (1957).',
    'Yu. V. Sharvin, A possible method for studying Fermi surfaces, Sov. Phys. JETP 21, 655 (1965).',
    'S. Datta, Electronic Transport in Mesoscopic Systems, Cambridge University Press (1995).',
    'X. Du, I. Skachko, A. Barker, E. Y. Andrei, Approaching ballistic transport in suspended graphene, Nat. Nanotechnol. 3, 491 (2008).'],
  contacts: PRESET.two_terminal, sweep: { sweepType: 'mfp', measure: '2t', quantity: 'G', wantFem: true, wantBal: true, lFrom: 1, lTo: 10000, lN: 25 }, view: 'current' });

add({ slug: 'van-der-pauw-square', group: 'Basic devices', name: 'Quadratic device, four-point (van der Pauw)',
  summary: 'A square with a contact in each corner: four-point resistance R = (ln2/pi) rho_s, independent of contact resistance.',
  physics: 'A 3 x 3 um square, current driven between the two TOP corners and voltage read between the two BOTTOM corners. For a uniform sheet of any shape with small contacts on the perimeter, van der Pauw showed that two such four-point resistances satisfy exp(-pi R1/rho_s) + exp(-pi R2/rho_s) = 1; for a symmetric square both are equal and R = rho_s ln2/pi. With n = 1e12 and mu = 50 000 cm^2/Vs, rho_s = 1/(n e mu) = 125 Ohm, so the FEM should read R_xx close to 27.6 Ohm at Vg = 0 offset (the sweep starts from the panel density). The trajectories depart from it when l (about 0.58 um here) becomes comparable to the square.',
  tryThis: 'Contact size (drag the corner contacts larger - the van der Pauw formula assumes point contacts, so the error grows); mobility (diffusive vs. ballistic, where the four-point value can even turn negative); B (move one probe to the opposite corner and the same geometry measures the Hall resistance); the FEM resolution (Numerical settings).',
  refs: ['L. J. van der Pauw, A method of measuring specific resistivity and Hall effect of discs of arbitrary shape, Philips Res. Rep. 13, 1 (1958).',
    'L. J. van der Pauw, A method of measuring the resistivity and Hall coefficient on lamellae of arbitrary shape, Philips Tech. Rev. 20, 220 (1958).'],
  params: { W_um: 3, H_um: 3, res: 120 },
  contacts: [['source', 'source', 0, .92, .08, 1], ['drain', 'drain', .92, .92, 1, 1], ['probe_1', 'probe', .92, 0, 1, .08], ['probe_2', 'probe', 0, 0, .08, .08]],
  sweep: { sweepType: 'vg', measure: 'rxx', quantity: 'R', wantFem: true, wantBal: true, vgFrom: 5, vgTo: 60, vgN: 23 }, view: 'potential' });

// ================================================================ EMR
// a metal shunt = a high-density, low-mobility region (conductivity ~200x graphene's,
// Hall angle ~0.1 at 1 T); graphene n = 1e12, mu = 50 000 (mu B = 5 at 1 T)
const N_G = 1e12, N_M = 1e16, MU_G = 50000, MU_M = 1000, RAMP = 0.03;
const step = (inside) => 0.5 * (1 + Math.tanh(inside / RAMP));
const EMR_REFS = ['S. A. Solin, T. Thio, D. R. Hines, J. J. Heremans, Enhanced room-temperature geometric magnetoresistance in inhomogeneous narrow-gap semiconductors, Science 289, 1530 (2000).',
  'S. A. Solin et al., Nonmagnetic semiconductors as read-head sensors for ultra-high-density magnetic recording, Appl. Phys. Lett. 80, 4012 (2002).',
  'S. Pisana, P. M. Braganca, E. E. Marinero, B. A. Gurney, Tunable nanoscale graphene magnetometers, Nano Lett. 10, 341 (2010).',
  'J. Sun, J. Kosel, Extraordinary magnetoresistance in semiconductor/metal hybrids: a review, Materials 6, 500 (2013).'];
{
  const W = 4, H = 4, R = 1.3;
  const inside = (x, y) => R - Math.hypot(x - W / 2, y - H / 2);
  add({ slug: 'emr-central-shunt', group: 'Extraordinary magnetoresistance', name: 'EMR, four-terminal with central shunt',
    summary: 'Graphene square with a concentric metal disc: at B = 0 the current runs through the metal, in a field it is pushed around it - a huge geometric magnetoresistance.',
    physics: 'Solin\'s van der Pauw EMR disc in a square: a 4 x 4 um graphene sheet (n = 1e12 cm^-2, mu = 50 000 cm^2/Vs) with a metal inclusion of radius 1.3 um in the middle. The metal is modelled with the density and mobility maps: n = 1e16 cm^-2, mu = 1 000 cm^2/Vs, i.e. about 200x the graphene conductivity and a negligible Hall angle. At B = 0 the shunt short-circuits the sample and the four-point resistance is small. As mu B grows the Hall angle in the graphene approaches 90 degrees, the current flows tangentially to the metal interface instead of into it (the interface is an equipotential), and the resistance rises by orders of magnitude - a purely geometric effect, which is why the sweep is run in the FEM (Ohmic, diffusive) model. Current enters on the left, leaves on the right, and the voltage is read between two contacts on the top edge.',
    tryThis: 'B range (the effect is set by mu B, so try 0.2 T with mu = 500 000); the metal/graphene contrast (the density-map and mobility-map ranges under Spatial image maps, or reload the maps); the shunt radius relative to the square (Solin\'s optimum is a filling factor near 12/16); contact positions (move the probes onto the bottom edge); res for a finer grid near the interface; switching on trajectories is not meaningful here - the maps define a metal only for the field model.',
    refs: EMR_REFS,
    params: { W_um: W, H_um: H, res: 140, femIter: 20000, mobScope: 'cond' },
    density: map(128, 128, W, H, (x, y) => N_G + (N_M - N_G) * step(inside(x, y))),
    mobility: map(128, 128, W, H, (x, y) => MU_G + (MU_M - MU_G) * step(inside(x, y))),
    contacts: [['source', 'source', 0, .42, .03, .58], ['drain', 'drain', .97, .42, 1, .58], ['probe_1', 'probe', .2, .97, .3, 1], ['probe_2', 'probe', .7, .97, .8, 1]],
    sweep: { sweepType: 'b', measure: 'rxx', quantity: 'R', wantFem: true, wantBal: false, bFrom: -1, bTo: 1, bN: 41 }, view: 'current' });
}
{
  const W = 4, H = 4, R = 1.0, XC = 2.6, YC = 2.0;     // the disc moved 0.6 um towards the drain, 0.28 um clear of it
  const inside = (x, y) => R - Math.hypot(x - XC, y - YC);
  add({ slug: 'emr-offcentre-shunt', group: 'Extraordinary magnetoresistance', name: 'EMR, four-terminal with off-centre shunt',
    summary: 'The central-shunt square with the metal disc moved off centre: the left-right mirror symmetry is broken, so R(B) is no longer even in B.',
    physics: 'The same 4 x 4 um graphene square and contacts as the central-shunt example (current in on the left, out on the right, voltage between two contacts on the top edge), but the metal inclusion (radius 1.0 um, n = 1e16 cm^-2, mu = 1 000 cm^2/Vs via the density and mobility maps) sits 0.6 um off centre towards the drain (0.28 um clear of the drain contact). With a centred disc the device is mirror-symmetric left to right; a mirror reverses B and swaps both contact pairs, so Onsager reciprocity forces R(B) = R(-B). Moving the disc breaks that symmetry: R(B) acquires an odd part and the device responds to the SIGN of the field, which is what a sensor biased at zero field needs. Displacing or reshaping the inclusion is also the main lever for enhancing EMR (Hewett and Kusmartsev). Run the B sweep (FEM): compare the two halves of the curve, and compare with the central-shunt example.',
    tryThis: 'The displacement (regenerate the maps with another centre, or load your own map image): along x it breaks the symmetry, along y it does not; B range and sign; the disc radius; the metal contrast (the map ranges under Spatial image maps); probe positions - moving one probe also breaks the symmetry, even with a centred disc.',
    refs: ['T. H. Hewett, F. V. Kusmartsev, Geometrically enhanced extraordinary magnetoresistance in semiconductor-metal hybrids, Phys. Rev. B 82, 212404 (2010).', ...EMR_REFS],
    params: { W_um: W, H_um: H, res: 140, femIter: 20000, mobScope: 'cond' },
    density: map(128, 128, W, H, (x, y) => N_G + (N_M - N_G) * step(inside(x, y))),
    mobility: map(128, 128, W, H, (x, y) => MU_G + (MU_M - MU_G) * step(inside(x, y))),
    contacts: [['source', 'source', 0, .42, .03, .58], ['drain', 'drain', .97, .42, 1, .58], ['probe_1', 'probe', .2, .97, .3, 1], ['probe_2', 'probe', .7, .97, .8, 1]],
    sweep: { sweepType: 'b', measure: 'rxx', quantity: 'R', wantFem: true, wantBal: false, bFrom: -1, bTo: 1, bN: 41 }, view: 'current' });
}
{
  const W = 6, H = 2, Y = 0.7;
  const inside = (x, y) => Y - y;          // the bottom 0.7 um is metal
  add({ slug: 'emr-side-shunt-bar', group: 'Extraordinary magnetoresistance', name: 'EMR bar with side shunt (read-head geometry)',
    summary: 'Solin\'s read-head bar: a metal shunt along one long edge, all four contacts on the opposite edge. Several hundred per cent MR at 1 T.',
    physics: 'The geometry of Solin\'s EMR read head: a 6 x 2 um graphene bar (n = 1e12 cm^-2, mu = 50 000 cm^2/Vs) with a metal shunt (density/mobility maps, n = 1e16, mu = 1 000) along the bottom 0.7 um and all four contacts - current, voltage, voltage, current - on the top edge. At B = 0 the current dives straight into the metal and the voltage probes see almost nothing. In a field the Hall angle in the graphene approaches 90 degrees, the current can no longer enter the equipotential metal head-on and has to run along the graphene, so the four-point resistance rises several-fold (the FEM gives about 110 Ohm at 1 T against 19 Ohm at 0; at these Hall angles the iterative solver gives up and a direct sparse solve takes over). With the contacts placed symmetrically, R(B) = R(-B) (mirror symmetry plus Onsager); shift one probe to get an odd part.',
    tryThis: 'B range (the effect is set by mu B); shunt thickness and contrast (regenerate or edit the maps); move one voltage probe to break the symmetry and see R(B) become odd; the metal mobility (a Hall angle in the metal reduces the effect); the FEM resolution near the interface.',
    refs: EMR_REFS,
    params: { W_um: W, H_um: H, res: 180, femIter: 20000, mobScope: 'cond' },
    density: map(192, 64, W, H, (x, y) => N_G + (N_M - N_G) * step(inside(x, y))),
    mobility: map(192, 64, W, H, (x, y) => MU_G + (MU_M - MU_G) * step(inside(x, y))),
    contacts: [['source', 'source', .05, .95, .13, 1], ['probe_1', 'probe', .33, .95, .41, 1], ['probe_2', 'probe', .59, .95, .67, 1], ['drain', 'drain', .87, .95, .95, 1]],
    sweep: { sweepType: 'b', measure: 'rxx', quantity: 'R', wantFem: true, wantBal: false, bFrom: -1, bTo: 1, bN: 41 }, view: 'current' });
}

// ================================================================ hydrodynamics
const HYDRO_REFS = ['R. N. Gurzhi, Hydrodynamic effects in solids at low temperature, Sov. Phys. Usp. 11, 255 (1968).',
  'I. Torre, A. Tomadin, A. K. Geim, M. Polini, Nonlocal transport and the hydrodynamic shear viscosity in graphene, Phys. Rev. B 92, 165433 (2015).',
  'L. Levitov, G. Falkovich, Electron viscosity, current vortices and negative nonlocal resistance in graphene, Nat. Phys. 12, 672 (2016).',
  'D. A. Bandurin et al., Negative local resistance caused by viscous electron backflow in graphene, Science 351, 1055 (2016).',
  'P. S. Alekseev, Negative magnetoresistance in viscous flow of two-dimensional electrons, Phys. Rev. Lett. 117, 166601 (2016).'];
add({ slug: 'hydro-vicinity', group: 'Hydrodynamic flow', name: 'Hydrodynamic device: negative vicinity resistance',
  summary: 'Current injected from a side contact; the probe right next to it reads a NEGATIVE voltage in the viscous regime (Bandurin 2016).',
  physics: 'A 10 x 2 um strip. Current enters through a narrow contact on the bottom edge at x = 3 um and leaves through the left end; a probe sits 0.4 um to the right of the injector on the same edge and the reference probe is the far right end, where no current flows. In the Ohmic model the near probe is at a positive potential. With Field model = Hydrodynamic the solver adds the electron viscosity (Stokes-Ohm equations, no-slip walls): the injected jet drags the fluid beside it, a whirlpool forms and the flow next to the injector runs backwards, so the near probe goes NEGATIVE - Bandurin\'s vicinity geometry. The momentum-relaxing mean free path is 20 um (mobility 1.7e6 cm^2/Vs, so the Ohmic and viscous models see the same resistivity). The electron-electron length is set directly (0.1 um) so the Gurzhi length D = sqrt(l_ee l_mr)/2 is about 0.7 um, comparable to the probe spacing. Run the field solve, then open the Transmission tab: the probe potentials of the field model are listed there (in the viscous model the near probe sits BELOW the far reference end: a negative vicinity resistance). The Vorticity tab shows the whirlpool.',
  tryThis: 'Field model Ohmic vs. Hydrodynamic (sign of the near-probe voltage); l_ee (0 = from temperature: raise T and watch D shrink); the momentum-relaxing mean free path (lower mobility kills the effect when l_mr < D); slip (no-slip / partial / free); B (Hall viscosity); move the near probe away from the injector - the negative signal decays over a few D.',
  refs: HYDRO_REFS,
  params: { W_um: 10, H_um: 2, res: 250, fieldModel: 'hydro', hydroLee_um: 0.1, mfpFromMobility: 1, mu_cm: 1715000, tempK: 200 },
  contacts: [['source', 'source', .30, 0, .32, .06], ['drain', 'drain', 0, 0, .02, 1], ['near', 'probe', .34, 0, .36, .06], ['far', 'probe', .97, 0, 1, 1]],
  sweep: { sweepType: 'b', measure: '2t', quantity: 'R', wantFem: true, wantBal: false, bFrom: -0.1, bTo: 0.1, bN: 21 }, view: 'vorticity' });

add({ slug: 'hydro-aperture', group: 'Hydrodynamic flow', name: 'Hydrodynamic device: superballistic aperture',
  summary: 'A slit in a wall: viscous flow through it can conduct MORE than the ballistic (Sharvin) limit, and more as temperature rises.',
  physics: 'A 6 x 3 um strip divided by a thin wall (two "wall" obstacles) with a 0.5 um slit in the middle; source and drain are the two ends. Ballistic carriers pass the slit independently, so its conductance is capped by the Sharvin value, proportional to the width w. In a viscous electron fluid carriers collide with each other faster than with the slit edges, the flow organises into a Poiseuille-like profile through the slit, and the conductance scales as G_vis = pi n^2 e^2 w^2/(32 eta) - it grows as w^2 and as the viscosity eta falls with temperature, exceeding the ballistic limit: superballistic flow (Guo et al., Krishna Kumar et al.). Here the Field model is Hydrodynamic with l_ee taken from temperature (300 K; at 200 K this slit is still just below its Sharvin value, it overtakes it near 250-300 K), the walls are solid in the fluid, insulating in the Ohmic model and specular for the trajectories, so the three models can be compared directly: run Field, then Trajectories (two-terminal G).',
  tryThis: 'Temperature (with l_ee = 0 the viscosity follows T: raise T from 100 to 300 K and the slit conductance should RISE); slit width (drag the two wall obstacles); Field model Ohmic vs. Hydrodynamic; slip at the walls; trajectories with scattering off (Run trajectories, ballistic) for the Sharvin reference; mobility (the momentum-relaxing length must stay longer than the slit).',
  refs: ['H. Guo, E. Ilani, L. S. Levitov, G. Falkovich, Higher-than-ballistic conduction of viscous electron flows, PNAS 114, 3068 (2017).',
    'R. Krishna Kumar et al., Superballistic flow of viscous electron fluid through graphene constrictions, Nat. Phys. 13, 1182 (2017).',
    ...HYDRO_REFS.slice(0, 3)],
  params: { W_um: 6, H_um: 3, res: 150, fieldModel: 'hydro', hydroLee_um: 0, tempK: 300, mfpFromMobility: 1, mu_cm: 857000 },
  contacts: [['source', 'source', 0, 0, .03, 1], ['drain', 'drain', .97, 0, 1, 1], ['wall_bottom', 'wall', .49, 0, .51, .4167], ['wall_top', 'wall', .49, .5833, .51, 1]],
  sweep: { sweepType: 'b', measure: '2t', quantity: 'R', wantFem: true, wantBal: false, bFrom: -0.1, bTo: 0.1, bN: 21 }, view: 'current' });

// ================================================================ Dirac electron optics
const KLEIN_REFS = ['M. I. Katsnelson, K. S. Novoselov, A. K. Geim, Chiral tunnelling and the Klein paradox in graphene, Nat. Phys. 2, 620 (2006).',
  'V. V. Cheianov, V. I. Fal\'ko, Selective transmission of Dirac electrons and ballistic magnetoresistance of n-p junctions in graphene, Phys. Rev. B 74, 041403 (2006).',
  'J. Cayssol, B. Huard, D. Goldhaber-Gordon, Contact resistance and shot noise in graphene transistors, Phys. Rev. B 79, 075428 (2009).'];
{
  const W = 6, H = 4, xJ = 1.5, N1 = 1e12, N2 = -1e12;
  add({ slug: 'veselago-lens', group: 'Dirac electron optics', name: 'Veselago lens (flat p-n junction)',
    summary: 'A point source in front of a straight n-p junction: negative refraction refocuses the rays at the mirror point behind it.',
    physics: 'NOTE: regular beads or arcs in the trajectory density are sampling patterns of the stepped tracer on the picture grid, not interference - the model is phase-incoherent. A 6 x 4 um sample with a straight p-n junction 1.5 um from a 40 nm point source on the left edge (n = +1e12 cm^-2 before the junction, -1e12 after it). At a p-n junction graphene carriers tunnel (Klein) with transmission T = cos th1 cos th2 / cos^2((th1+th2)/2) and refract with a NEGATIVE angle, th2 = -asin(k1/k2 sin th1). With equal densities the junction is a Veselago lens: every ray crosses to the mirror point 1.5 um behind it and the beam refocuses. The trajectory tracer handles the junction with p-n mode = Klein (bisection to the n = 0 line, local normal from the map gradient); edges absorb and there is no scattering. Run trajectories (ballistic) and look at the trajectory density: the focus sits at x = 3 um. The gate test reproduces it to 0.2 %.',
    tryThis: 'p-n mode Klein vs. pass (the focus vanishes); the density ratio (edit the map: n2 = -4e12 gives k2/k1 = 2 and a caustic instead of a point focus); the p-n junction width (a smooth junction filters out oblique rays - Cayssol); B of a few mT (the focus moves and blurs); scattering on with a finite mean free path; the source position.',
    refs: ['V. V. Cheianov, V. Fal\'ko, B. L. Altshuler, The focusing of electron flow and a Veselago lens in graphene p-n junctions, Science 315, 1252 (2007).',
      'G.-H. Lee, G.-H. Park, H.-J. Lee, Observation of negative refraction of Dirac fermions in graphene, Nat. Phys. 11, 925 (2015).',
      'S. Chen et al., Electron optics with p-n junctions in ballistic graphene, Science 353, 1522 (2016).', ...KLEIN_REFS],
    params: { W_um: W, H_um: H, n_cm2: 1e12, edge: 'absorbing', tracer: 'step', refract: 0, pnMode: 'klein', pnWidth_nm: 0, maxPath_um: 1000, seed: 11, nTraj: 20000, scattering: 'none', mfpFromMobility: 0, mfp_um: 1000 },
    density: map(256, 16, W, H, (x) => (x <= xJ ? N1 : N2)),
    contacts: [['source', 'source', 0, .495, .002, .505], ['drain', 'drain', .998, 0, 1, 1]],
    sweep: { sweepType: 'b', measure: '2t', quantity: 'G', wantFem: false, wantBal: true, bFrom: -0.02, bTo: 0.02, bN: 21 }, view: 'trajectories' });
}
// the Dirac fermion microscope (Boggild et al. 2017): pinhole + parabolic p-n lens
const DW = 4, DH = 2, YC = 1, XF = 0.01, FPAR = 0.5, N0 = 1e12, DRAMP = 0.02;
const dfmDensity = (dotX, dotR) => map(256, 256, DW, DH, (x, y) => {
  const dy = y - YC, xp = XF + FPAR - dy * dy / (4 * FPAR);
  const gPar = (xp - x) / Math.sqrt(1 + (dy / (2 * FPAR)) ** 2);
  let n = -N0 * Math.tanh(gPar / DRAMP);
  if (dotR > 0) n = Math.min(n, -N0 * Math.tanh((dotR - Math.hypot(x - dotX, dy)) / DRAMP));
  return n;
});
const dfmContacts = (disc) => {
  const a = 0.04, t = 0.03, L = 0.25;
  const c = [['source', 'source', 0, (YC - .01) / DH, .005, (YC + .01) / DH], ['back', 'drain', .995, 0, 1, 1], ['top', 'drain', .45, .99, .99, 1], ['bottom', 'drain', .45, 0, .99, .01],
    ['jawTop', 'absorber', 0, (YC + a) / DH, L / DW, (YC + a + t) / DH], ['jawBottom', 'absorber', 0, (YC - a - t) / DH, L / DW, (YC - a) / DH]];
  if (disc) c.push(['disc', 'reflector', (3.3 - .1) / DW, (YC - .1) / DH, (3.3 + .1) / DW, (YC + .1) / DH]);
  return c;
};
const DFM_PARAMS = { W_um: DW, H_um: DH, n_cm2: N0, edge: 'absorbing', tracer: 'step', refract: 0, pnMode: 'klein', maxPath_um: 200, seed: 3, scattering: 'none', mfpFromMobility: 0, mfp_um: 1000, nTraj: 20000, fwdSigmaDeg: 2 };
const DFM_REF = 'P. Boggild et al., A two-dimensional Dirac fermion microscope, Nat. Commun. 8, 15783 (2017).';
add({ slug: 'dfm-circular-pn', group: 'Dirac electron optics', name: 'Dirac fermion microscope: beam onto a circular p-n junction',
  summary: 'A collimated Dirac-electron beam aimed at a Veselago dot (a circular p-n junction): transparent at B = 0, a trap for whispering-gallery orbits at a few mT.',
  physics: 'NOTE: regular beads or arcs in the trajectory density are sampling patterns of the stepped tracer, not interference (the model is phase-incoherent). The gun of the Dirac fermion microscope (Fig. 4 of the paper): a 20 nm emitter at the focus of a parabolic p-n junction (focal length 0.5 um) inside a grounded aperture (two absorbing jaws 80 nm apart). The parabola collimates the emitted carriers into a beam (gate-verified: 150 nm FWHM at 1.5 and 3 um). The beam hits a circular p-n junction of radius 0.25 um at x = 3 um, |n| = 1e12 cm^-2 everywhere. A sharp circular junction (pnWidth 2.5 nm) is nearly transparent at normal incidence (Klein tunnelling) but refracts rays negatively; in a few mT the incoming rays strike it at glancing angles and are trapped in bound whispering-gallery orbits inside the dot, whereas a smooth junction (40 nm) reflects them. Electrodes: back edge, top edge and bottom edge (both from x = 1.8 um); all other edges absorb. Run trajectories and look at the density.',
  tryThis: 'B: 0, 2, 8 mT (the beam bends with radius R_c = hbar k_F/(eB) - about 117 um at 1 mT and 15 um at 8 mT at 1e12 cm^-2 - and the dot changes from transparent to trap); p-n junction width 2.5 vs. 40 nm (sharp vs. smooth junction); the dot radius and position (regenerate the map); scattering (forward, small-angle) with a finite mean free path to see the contrast wash out; the transmissions to the three electrodes in the detail table.',
  refs: [DFM_REF, ...KLEIN_REFS, 'A. V. Shytov, M. S. Rudner, L. S. Levitov, Klein backscattering and Fabry-Perot interference in graphene heterojunctions, Phys. Rev. Lett. 101, 156804 (2008).'],
  params: { ...DFM_PARAMS, pnWidth_nm: 2.5, B: 0.002 },
  density: dfmDensity(3.0, 0.25), contacts: dfmContacts(false),
  sweep: { sweepType: 'b', measure: '2t', quantity: 'G', wantFem: false, wantBal: true, bFrom: -0.01, bTo: 0.01, bN: 21 }, view: 'trajectories' });
add({ slug: 'dfm-reflector-scan', group: 'Dirac electron optics', name: 'Dirac fermion microscope: imaging a reflecting disc',
  summary: 'Fig. 3c: the collimated beam is steered across a small reflecting disc with the magnetic field, and the target shows up as a dip in transmission.',
  physics: 'The same gun as the circular p-n example, with a hard reflecting disc (radius 0.1 um, the "reflector" contact role) placed in the beam at x = 3.3 um instead of a p-n dot. A perpendicular field bends the beam, moving its landing point by about 50 nm per mT at the disc, so sweeping B scans the beam across the target - the microscope\'s imaging mode. Transmission into the top and bottom electrodes against B shows a sharp dip where the beam hits the disc (gate: 96 % deep, 176 nm wide for a 200 nm disc), and T13(B) = T14(-B) by symmetry. Scattering blurs the image: the gate measures the dip depth falling to 0.80 and 0.44 for l = 5 and 1 mm (small-angle).',
  tryThis: 'The sweep (B from -10 to 10 mT); scattering = smallangle with mfp_um 5000, 1000, 200 (the image fades); the disc size and position (drag the reflector); edge absorbing vs. specular; nTraj for smoother curves.',
  refs: [DFM_REF, ...KLEIN_REFS.slice(0, 2)],
  params: { ...DFM_PARAMS, pnWidth_nm: 2.5 },
  density: dfmDensity(0, 0), contacts: dfmContacts(true),
  sweep: { sweepType: 'b', measure: '2t', quantity: 'G', wantFem: false, wantBal: true, bFrom: -0.01, bTo: 0.01, bN: 41 }, view: 'trajectories' });

// ================================================================ Klein-tunnelling magnetometer
{
  const W = 8, H = 4, CELL = 1, N1 = 2e12, R2 = 0.02;   // 1 um stripes, alternating sign
  add({ slug: 'klein-magnetometer', group: 'Dirac electron optics', name: 'KT magnetometer (Klein-tunnelling p-n superlattice)',
    summary: 'Alternating p and n stripes across a clean channel: Klein transmission is angle-selective, so a few mT of field changes the resistance strongly.',
    physics: 'An 8 x 4 um channel crossed by eight 1 um stripes of alternating sign (|n| = 2e12 cm^-2, seven p-n junctions of width 40 nm). At a smooth junction only carriers near normal incidence tunnel through (transmission ~ exp(-pi k_F d sin^2 th)), so the superlattice acts as a stack of angular filters. A perpendicular field curves the trajectories between junctions and moves carriers out of the transmitted cone, so the two-terminal resistance rises steeply with |B| at the mT scale - the principle of the Klein-tunnelling magnetometer. The channel is nearly ballistic (mu = 1e6 cm^2/Vs, l about 16 um), edges specular. Run the B sweep (two-terminal R from trajectories; the FEM is off because n = 0 lines are insulating in the field model).',
  tryThis: 'B range (+-30 mT, then +-5 mT around the steep part - the slope sets the sensitivity); pnWidth_nm (10, 40, 100: wider junctions = narrower angular filter, larger MR but lower transmission); number and length of the cells (regenerate the map); disorder: mobility 1e5 or scattering = forward; edge = diffuse; temperature with phonon scattering (phMfp300_um).',
    refs: [...KLEIN_REFS, 'A. F. Young, P. Kim, Quantum interference and Klein tunnelling in graphene heterojunctions, Nat. Phys. 5, 222 (2009).',
      'A. V. Shytov, M. S. Rudner, L. S. Levitov, Klein backscattering and Fabry-Perot interference in graphene heterojunctions, Phys. Rev. Lett. 101, 156804 (2008).',
      'Klein magnetometer design study (this project): Klein magnetometer/Klein Magnetometer report 2026-10-06.pdf.'],
    params: { W_um: W, H_um: H, n_cm2: N1, mu_cm: 1e6, edge: 'specular', tracer: 'step', pnMode: 'klein', pnWidth_nm: 40, maxPath_um: 400, nTraj: 8000, scattering: 'isotropic' },
    density: map(256, 8, W, H, (x) => {
      // tanh steps at every cell boundary, so the bilinear n = 0 line sits on it
      const k = Math.floor(x / CELL), f = x - k * CELL, sgn = k % 2 ? -1 : 1;
      const last = Math.round(W / CELL) - 1, d = Math.min(k === 0 ? 9 : f, k >= last ? 9 : CELL - f);   // no n = 0 under the end contacts
      return sgn * N1 * Math.tanh(d / R2);
    }),
    contacts: PRESET.two_terminal,
    sweep: { sweepType: 'b', measure: '2t', quantity: 'R', wantFem: false, wantBal: true, bFrom: -0.03, bTo: 0.03, bN: 31 }, view: 'trajectories' });
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ examples: EX }, null, 1));
for (const e of EX) console.log(e.group.padEnd(34), e.name.padEnd(62), (fs.statSync(path.join(OUT, e.file)).size / 1024).toFixed(0) + ' kB');
