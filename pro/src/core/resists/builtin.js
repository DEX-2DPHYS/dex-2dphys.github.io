// The built-in resist library: the e-beam resists in DTU Nanolab's cleanroom (LabAdviser, October
// 2026), with what DTU and the literature know about them. Curated: each number carries its source.
//
// How to read it
// - Where DTU has measured a curve (CSAR at 100 kV, AR-N 7520 New at 100 kV), that curve anchors the
//   model; elsewhere the anchor is an ANALYTICAL BEST GUESS assembled from the literature and marked
//   'estimate', with a wide uncertainty.
// - Sources disagree on what "D0" and "contrast" mean (Allresist's "D0" is the clearing dose; contrast
//   is a tangent slope, a 75 %- or 90/10-point ratio, or 1/log(D100/Donset) — 5–14 against 2–4 for the
//   same curve). The library stores what each source gives (onset, D50, clearing / full-thickness dose)
//   and fits the Workbench's curve (D100, γ, rounding) to those points: γ here is the Workbench's,
//   comparable across resists, not the source's headline number. Values read off a figure are marked.
// - The model's laws (see model.js) follow the literature review of 2026-10-07: D100 ∝ E^nE · t^(−p) ·
//   h^q · exp[(E_D/k)(1/T* − 1/Tref)], γ = γref·exp[cγ(Tref − T*)], each parameter with its spread.
//   Negative resists reverse the time and temperature signs. A developer is a lookup, never an
//   interpolation. Treat everything outside a resist's window as extrapolation — the tab says so.
//
// Process windows are the ranges the data and the manufacturer cover, not guarantees.

import { fitCurve } from './model.js';

export const DEV_NAMES = {
  AR600_546: 'AR 600-546 (amyl acetate)', AR600_548: 'AR 600-548 (strong)', AR600_549: 'AR 600-549 (moderate)',
  ZEDN50: 'ZED-N50 (n-amyl acetate)', XYLENE: 'xylene (ZEP-RD)', OXYLENE: 'o-xylene', ZEPSD: 'ZEP-SD (MEK/MIBK)', MIBK: 'MIBK',
  MIBK_IPA: 'MIBK:IPA 1:3', MIBK_IPA_11: 'MIBK:IPA 1:1', IPA_H2O: 'IPA:H₂O 7:3', IPA: 'IPA (AR 600-60)', HEXYLAC: 'hexyl acetate',
  TMAH238: 'TMAH 2.38 % (AZ 726 MIF / MF-319)', TMAH25: 'TMAH 25 %', NAOH1: 'NaOH 1 %', SALTY: 'NaOH 1 % + NaCl 4 % (salty)', TMAH238_NACL: 'AZ 726 MIF + 4 % NaCl', AZ400K: 'AZ 400K',
  MRDEV600: 'mr-Dev 600', PC: 'propylene carbonate',
  AR300_46: 'AR 300-46', AR300_47: 'AR 300-47 (0.20 N)', AR300_47_41: 'AR 300-47 : DIW 4:1', AR300_47_11: 'AR 300-47 : DIW 1:1 (≈ 0.10 N)', AR600_50: 'AR 600-50 (copolymer developer)', AR300_44: 'AR 300-44 (0.26 N TMAH)',
};

// A curve given as onset / D50 / clearing (positive) or gel / D50 / full thickness (negative) doses →
// points for the fit. Points the source does not give are left out; the fit uses γ0 to fill the shape.
function summaryPoints({ onset = null, d50 = null, done }, tone, gamma0 = 3) {
  const P = [], pos = tone !== 'negative';
  // no onset: mirror it from D50 in log dose, else from an assumed γ
  const o = onset ?? (d50 ? Math.min(d50 * 0.8, d50 * d50 / done) : done * 10 ** (-1 / gamma0));
  const remaining = (f) => (pos ? f : 1 - f);                    // fraction of the film left
  P.push([o * 0.7, remaining(1)], [o, remaining(0.97)]);
  if (d50) P.push([d50, 0.5]);
  else P.push([Math.sqrt(o * done), 0.5]);
  P.push([done, remaining(0.03)], [done * 1.3, remaining(0)]);
  return P;
}
// a dataset from a summary: points rebuilt, then fitted like a measured curve
function ds(id, tone, summary, conditions, quality, provenance, extra = {}) {
  const points = extra.points || summaryPoints(summary, tone, extra.gamma0);
  const f = fitCurve(points, tone);
  return { id, conditions, summary: extra.points ? null : summary, points, rebuilt: !extra.points, fit: { D0: f.D0, D100: f.D100, gamma: f.gamma, round: f.round }, quality, provenance, ...(extra.gammaReported ? { gammaReported: extra.gammaReported } : {}) };
}
const ref = (dataset) => ({ ...dataset.conditions, D100: dataset.fit.D100, gamma: +dataset.fit.gamma.toFixed(2), round: +dataset.fit.round.toFixed(2) });
const C = (kV, thicknessNm, developer, timeS, tempC, more = {}) => ({ kV, thicknessNm, developer, timeS, tempC, ...more });

// ===================================================================== AR-P 6200 (CSAR 62)
const csarDTU = ds('dtu-100kV-188nm', 'positive', { onset: 135, done: 270 }, C(100, 188, 'AR600_546', 60, 21, { prebake: '205 °C 60 s', substrate: 'Si' }), 'measured',
  { lab: 'DTU Nanolab', tool: 'JEOL JBX-9500 (2 nA, ap 5)', method: 'AFM, 100 nm lines / 300 nm spaces', sources: ['LA-CSAR'], note: 'DTU contrast curve March 2016, read from the LabAdviser plot (Dc ≈ 270 µC/cm²); onset ≈ 120–150. Development time not stated on the page: the DTU standard 60 s is assumed.' });
const CSAR = {
  id: 'CSAR', name: 'AR-P 6200 (CSAR 62)', product: 'AR-P 6200.04 / .09 / .13 / .18 (DTU default positive resist: 6200.09)', supplier: 'Allresist', tone: 'positive', family: 'α-methylstyrene / α-chloroacrylate copolymer (ZEP-like)', atDTU: true,
  summary: 'DTU Nanolab\'s default positive e-beam resist. Chemically the same family as ZEP 520A, with a slightly different dose to clear. High resolution (6 nm reported), good dry-etch resistance (about twice PMMA\'s), clean lift-off with a dose-controlled undercut.',
  sources: {
    'LA-CSAR': { cite: 'DTU Nanolab LabAdviser: CSAR (spin curves, contrast curves 2016, development-time series, etch data)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/CSAR', kind: 'labadviser' },
    'LA-ELINE': { cite: 'DTU Nanolab LabAdviser: Raith eLINE — dose to clear vs kV (guideline)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/eLINE', kind: 'labadviser' },
    'LA-FLOW': { cite: 'DTU Nanolab process flow CSAR (dose 250–350 µC/cm² at 100 kV, AR 600-546 60 s)', url: 'https://labadviser.nanolab.dtu.dk//images/e/e6/Process_Flow_CSAR.docx', kind: 'labadviser' },
    'AR-DS': { cite: 'Allresist, Product information AR-P 6200 (CSAR 62), 2023', url: 'https://www.allresist.com/wp-content/uploads/sites/2/2023/07/Allresist_Product-information-E-Beamresist-AR-P-6200-English-web.pdf', kind: 'datasheet' },
    'AR-WIKI': { cite: 'Allresist Resist-Wiki: various developers for CSAR 62 at 100 kV', url: 'https://www.allresist.com/resist-wiki-evaluation-of-various-developers-for-e-beam-exposed-csar-62-layers-100-kv-2/', kind: 'datasheet' },
    'THOMS': { cite: 'S. Thoms, D. S. Macintyre, J. Vac. Sci. Technol. B 32, 06FJ01 (2014)', url: 'https://doi.org/10.1116/1.4899239', kind: 'paper' },
    'KTH': { cite: 'J. Rahomäki, CSAR 62 preliminary test, KTH (2015)', url: 'https://www.nanophys.kth.se/nanolab/resists/allresist/CSAR-prel-test-JR.pdf', kind: 'paper' },
  },
  window: { kV: [10, 100], thicknessNm: [70, 900], developers: ['AR600_546', 'AR600_548', 'AR600_549'], timeS: [30, 180], tempC: [15, 23], sources: ['LA-CSAR', 'LA-ELINE', 'AR-DS', 'AR-WIKI'] },
  model: {
    ref: ref(csarDTU), refBasis: 'measured at DTU (100 kV, 188 nm, AR 600-546)', refUncertainty: 0.1, refSources: ['LA-CSAR'], density: 1.2,
    nE: { value: 0.9, sd: 0.15, sources: ['LA-ELINE', 'LA-CSAR', 'AR-DS', 'THOMS'] },
    p: { value: 0.3, sd: 0.1, sources: ['LA-CSAR', 'AR-WIKI'] },
    q: { value: 0.3, sd: 0.1, sources: ['LA-CSAR'] },
    EDeV: { value: 0.23, sd: 0.1, sources: ['AR-DS'] }, TsatC: -20,
    cGamma: { value: 0.02, sd: 0.02, sources: ['AR-DS'] },
    developers: {
      AR600_548: { factor: 0.22, sd: 0.3, gammaFactor: 0.8, note: 'strong: ≈ 50 µC/cm² at 100 kV 60 s, but dissolves unexposed resist (≈ 15 % at 21.5 °C, 5 % at 15 °C)', sources: ['AR-WIKI'] },
      AR600_549: { factor: 0.55, sd: 0.25, gammaFactor: 0.5, note: 'moderate: ≈ 125 µC/cm² at 100 kV 60 s, gradual (low-contrast) curves', sources: ['AR-WIKI', 'AR-DS'] },
      ZEDN50: { factor: 1.0, sd: 0.2, note: 'n-amyl acetate, chemically like AR 600-546; DTU users report residues — DTU recommends AR 600-546/548', sources: ['LA-CSAR', 'THOMS'] },
      OXYLENE: { factor: 1.1, sd: 0.2, note: 'o-xylene ≈ AR 600-546', sources: ['AR-WIKI'] },
      MIBK: { factor: 0.67, sd: 0.25, note: 'MIBK: ≈ 150 µC/cm² at 100 kV 60 s', sources: ['AR-WIKI'] },
      MIBK_IPA: { factor: 2.5, sd: 0.5, gammaFactor: 0.7, note: 'MIBK-based PMMA developers are weak for CSAR (Allresist: AR 600-55 "unsuitable")', sources: ['AR-WIKI'] },
    },
    notes: 'The voltage exponent rests on DTU\'s own pair (eLINE 30 kV: ≈ 100 µC/cm² to clear 180 nm; JEOL 100 kV: ≈ 270 at 188 nm → n ≈ 0.82) and on the inter-lab spread (25–30 kV ≈ 50–65, 100 kV 138–270): about 0.9 ± 0.15. Lab-to-lab, the same 100 kV process differs by up to 1.6×.',
  },
  datasets: [
    csarDTU,
    ds('dtu-100kV-70nm', 'positive', { onset: 100, done: 200 }, C(100, 70, 'AR600_546', 60, 21, { prebake: '205 °C 60 s' }), 'measured', { lab: 'DTU Nanolab', tool: 'JEOL JBX-9500', method: 'AFM', sources: ['LA-CSAR'], note: '6200.09 diluted 1:1, Dc ≈ 200 µC/cm² (plot); onset estimated' }),
    ds('dtu-100kV-900nm-30s', 'positive', { done: 450 }, C(100, 900, 'AR600_546', 30, 21, { prebake: '205 °C 60 s' }), 'measured', { lab: 'DTU Nanolab', method: 'SEM cross-sections, 100 nm lines', sources: ['LA-CSAR'], note: '6200.18; trenches reach the substrate at ≈ 450 µC/cm² (read from SEM images, approximate)' }, { gamma0: 3 }),
    ds('dtu-100kV-900nm-60s', 'positive', { done: 383 }, C(100, 900, 'AR600_546', 60, 21), 'measured', { lab: 'DTU Nanolab', method: 'SEM cross-sections', sources: ['LA-CSAR'], note: '≈ 375–390 µC/cm² (approximate)' }),
    ds('dtu-100kV-900nm-90s', 'positive', { done: 345 }, C(100, 900, 'AR600_546', 90, 21), 'measured', { lab: 'DTU Nanolab', method: 'SEM cross-sections', sources: ['LA-CSAR'], note: '≈ 345 µC/cm² (approximate)' }),
    ds('dtu-eline-30kV', 'positive', { done: 100 }, C(30, 180, 'AR600_546', 60, 21), 'measured', { lab: 'DTU Nanolab', tool: 'Raith eLINE', sources: ['LA-ELINE'], note: 'dose to clear area elements on Si, "merely a guideline"; developer and time not stated (DTU standard assumed)' }),
    ds('dtu-eline-20kV', 'positive', { done: 70 }, C(20, 180, 'AR600_546', 60, 21), 'measured', { lab: 'DTU Nanolab', tool: 'Raith eLINE', sources: ['LA-ELINE'], note: 'guideline' }),
    ds('dtu-eline-10kV', 'positive', { done: 30 }, C(10, 180, 'AR600_546', 60, 21), 'measured', { lab: 'DTU Nanolab', tool: 'Raith eLINE', sources: ['LA-ELINE'], note: 'guideline; 180 nm is a sizeable part of the electron range at 10 kV' }),
    ds('allresist-100kV-60s', 'positive', { onset: 100, d50: 175, done: 225 }, C(100, 240, 'AR600_546', 60, 21.5, { prebake: '180 °C' }), 'datasheet', { sources: ['AR-WIKI'], note: 'read from plot' }),
    ds('allresist-100kV-180s', 'positive', { onset: 75, d50: 135, done: 150 }, C(100, 240, 'AR600_546', 180, 21.5), 'datasheet', { sources: ['AR-WIKI'], note: 'read from plot; ≈ 5 % tail to 225' }),
    ds('allresist-100kV-549', 'positive', { onset: 25, d50: 85, done: 125 }, C(100, 240, 'AR600_549', 60, 21.5), 'datasheet', { sources: ['AR-WIKI'] }),
    ds('allresist-100kV-548', 'positive', { d50: 26, done: 50 }, C(100, 240, 'AR600_548', 60, 21.5), 'datasheet', { sources: ['AR-WIKI'], note: '≈ 15 % dark erosion' }),
    ds('allresist-100kV-548-15C', 'positive', { d50: 50, done: 75 }, C(100, 240, 'AR600_548', 60, 15), 'datasheet', { sources: ['AR-WIKI'], note: 'dark erosion ≈ 5 %' }),
    ds('allresist-100kV-mibk', 'positive', { onset: 50, d50: 125, done: 150 }, C(100, 240, 'MIBK', 60, 21.5), 'datasheet', { sources: ['AR-WIKI'] }),
    ds('allresist-30kV', 'positive', { onset: 22, d50: 42, done: 55 }, C(30, 170, 'AR600_546', 60, 22, { prebake: '150 °C 60 s' }), 'datasheet', { sources: ['AR-DS'], note: 'headline contrast 14.2 (tangent)' }, { gammaReported: '14.2 (Allresist, tangent)' }),
    ds('kth-25kV', 'positive', { onset: 34, done: 50 }, C(25, 180, 'AR600_546', 60, 21, { prebake: '180 °C 180 s' }), 'literature', { sources: ['KTH'] }, { gammaReported: '6.1 (10–90 % fit)' }),
    ds('thoms-100kV', 'positive', { onset: 67, d50: 120, done: 138 }, C(100, 200, 'AR600_546', 60, 21), 'literature', { sources: ['THOMS'], note: 'amyl acetate, time not in the abstract (60 s assumed); ≈ 3 % residue to 230' }, { gammaReported: '5.2' }),
  ],
  advice: [
    { topic: 'Coating', text: 'AR-P 6200.09: 7252·rpm^−0.454 nm on LabSpin (≈ 170 nm at 4000 rpm); Gamma recipes 4318 (180 nm), 4325 (250 nm), 4351 (500 nm), soft bake 180 °C. DTU contrast-curve samples used 205 °C 60 s; Allresist says the soft bake is not critical. No pretreatment generally recommended.', sources: ['LA-CSAR', 'LA-FLOW'] },
    { topic: 'Dose', text: 'At 100 kV on the JEOL: 250–350 µC/cm² for typical patterns (200–350 with an Al discharge layer); a dose test is always required — the dose depends on substrate, thickness, critical dimension, pattern load and developer. Small features need more dose than large ones.', sources: ['LA-FLOW', 'LA-CSAR'] },
    { topic: 'Development', text: 'AR 600-546, 60 s, room temperature, IPA rinse 60 s. DTU recommends AR 600-546 or 600-548 (3× stronger) rather than ZED-N50 (residues reported). If residues remain: a 3–5 s dip in pure MIBK. Development time matters: on 900 nm CSAR the clearing dose fell from ≈ 450 to ≈ 345 µC/cm² between 30 and 90 s. Dark erosion in AR 600-546 is negligible (≈ 0.1 nm/min).', sources: ['LA-CSAR'] },
    { topic: 'Cold development', text: 'Colder developer raises the dose and the resolution: Allresist reports 6 nm at 6 °C in AR 600-546 for a 1.6× dose; AR 600-548 loses its dark erosion near 0 °C.', sources: ['AR-DS'] },
    { topic: 'Lift-off and etch', text: 'Lift-off in AR 600-71 at room temperature 1–2 h (ultrasound 10–20 s if needed); overdose 1.5–2× gives an undercut. Etch: about twice the resistance of PMMA (O₂ 180, CF₄ 45 nm/min); DRIE nano1.42 ≈ 56 nm/min. Chlorine etch leaves chlorinated CSAR particles AR 600-71 cannot remove.', sources: ['LA-FLOW', 'LA-CSAR', 'AR-DS'] },
  ],
};

// ===================================================================== ZEP 520A
const zepRef = ds('gt-100kV-160nm', 'positive', { done: 160 }, C(100, 160, 'ZEDN50', 120, 21, { prebake: '180 °C' }), 'literature',
  { sources: ['GT-THICK'], note: 'Georgia Tech thickness series, amyl acetate 2 min, RT; onset from γ ≈ 4.3 (their RT value)' }, { gamma0: 4.3 });
const ZEP = {
  id: 'ZEP', name: 'ZEP 520A', product: 'ZEP 520A (anisole; diluted 1:1 / 1:2 for thin films)', supplier: 'Zeon', tone: 'positive', family: 'α-chloromethacrylate / α-methylstyrene copolymer', atDTU: true,
  summary: 'The original high-resolution chain-scission resist that CSAR copies. DTU Nanolab has stopped buying it ("use CSAR instead"); the Gamma coater still lists ZEP 520A 1:2 pay-per-use. Comparison note on LabAdviser\'s list ("ZEP 502A") is a typo for ZEP 520A.',
  sources: {
    'LA-ZEP': { cite: 'DTU Nanolab LabAdviser: ZEP520A (spin curves, process flow)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/ZEP520A', kind: 'labadviser' },
    'ZEON': { cite: 'Zeon, ZEP520A Technical Report v2 (2010)', url: 'https://labadviser.nanolab.dtu.dk/images/2/21/ZEP520A.pdf', kind: 'datasheet' },
    'ZEON01': { cite: 'Zeon, ZEP520 Technical Report v1.02 (2001)', url: 'https://apps.mnc.umn.edu/archive/ebpgwiki/rsrc/EBPG/Datasheets/ZEP520A_Datasheet.PDF', kind: 'datasheet' },
    'GT-THICK': { cite: 'Georgia Tech IEN, ZEP520A thickness vs sensitivity (2010)', url: 'https://www.nanolithography.gatech.edu/monitor/thickness_to_sensitivity.pdf', kind: 'paper' },
    'GT-OPT': { cite: 'C. Chapin, D. Brown, N. Devlin, Optimization studies of ZEP520, Georgia Tech (2010)', url: 'https://www.nanolithography.gatech.edu/resists/ZEP520A/zep520_presentation.pdf', kind: 'paper' },
    'MOHAMMAD': { cite: 'M. A. Mohammad et al., Jpn. J. Appl. Phys. 51, 06FC05 (2012)', url: 'https://doi.org/10.1143/JJAP.51.06FC05', kind: 'paper' },
    'THOMS': { cite: 'S. Thoms, D. S. Macintyre, J. Vac. Sci. Technol. B 32, 06FJ01 (2014)', url: 'https://doi.org/10.1116/1.4899239', kind: 'paper' },
    'FALLICA': { cite: 'R. Fallica et al., arXiv:1710.08733 (ZEP520A and mr-PosEBR, EBL and EUV)', url: 'https://arxiv.org/pdf/1710.08733', kind: 'paper' },
  },
  window: { kV: [10, 100], thicknessNm: [40, 910], developers: ['ZEDN50', 'XYLENE', 'OXYLENE', 'ZEPSD', 'MIBK_IPA'], timeS: [20, 540], tempC: [0, 30], sources: ['ZEON', 'GT-OPT', 'MOHAMMAD'] },
  model: {
    ref: ref(zepRef), refBasis: 'literature (Georgia Tech, 100 kV) — no DTU curve exists', refUncertainty: 0.25, refSources: ['GT-THICK', 'GT-OPT'], density: 1.2,
    nE: { value: 0.9, sd: 0.15, sources: ['MOHAMMAD', 'GT-THICK', 'ZEON'] },
    p: { value: 0.2, sd: 0.08, sources: ['ZEON', 'GT-OPT'] },
    q: { value: 0.33, sd: 0.1, sources: ['GT-THICK'] },
    EDeV: { value: 0.22, sd: 0.08, sources: ['GT-OPT', 'ZEON', 'MOHAMMAD'] }, TsatC: -20,
    cGamma: { value: 0.025, sd: 0.01, sources: ['GT-OPT'] },
    developers: {
      XYLENE: { factor: 0.91, sd: 0.15, p: 0.27, note: 'xylene (ZEP-RD): ≈ ZED-N50, more time-sensitive', sources: ['ZEON01'] },
      OXYLENE: { factor: 1.03, sd: 0.15, note: 'o-xylene (ZED-WN, end of sale)', sources: ['ZEON01'] },
      ZEPSD: { factor: 0.41, sd: 0.2, note: 'MEK/MIBK: ≈ 2.5× more sensitive, with dark loss', sources: ['ZEON01'] },
      MIBK_IPA: { factor: 3.9, sd: 0.3, gammaFactor: 1.4, EDeV: 0.08, note: 'MIBK:IPA 1:3: ≈ 4× less sensitive, highest contrast at RT, weak temperature dependence', sources: ['MOHAMMAD'] },
      IPA_H2O: { factor: 10, sd: 0.6, note: 'IPA:H₂O 7:3 does not fully clear ZEP (minimum ≈ 22 % left at RT)', sources: ['MOHAMMAD'] },
      HEXYLAC: { factor: 0.8, sd: 0.4, note: 'hexyl acetate: "for speed" — qualitative only, no primary data', sources: [] },
    },
    notes: 'The 100 kV anchor is Georgia Tech\'s (2 min amyl acetate). Development time: ZED-N50 at 20 kV 1→9 min lowers the clearing dose 34 → 23 µC/cm² (p ≈ 0.18); amyl acetate at 100 kV 30 s → 2 min 160 → 110 (p ≈ 0.27). Temperature: 30/21/10/0 °C → 100/160/240/275 µC/cm² and γ 2.8/4.3/4.8/6.0 (100 kV); saturation near −20 °C.',
  },
  datasets: [
    zepRef,
    ds('gt-100kV-60nm-2min', 'positive', { done: 110 }, C(100, 60, 'ZEDN50', 120, 21), 'literature', { sources: ['GT-THICK'] }, { gamma0: 4.3 }),
    ds('gt-100kV-330nm-2min', 'positive', { done: 210 }, C(100, 330, 'ZEDN50', 120, 21), 'literature', { sources: ['GT-THICK'] }, { gamma0: 4.3 }),
    ds('gt-100kV-910nm-2min', 'positive', { done: 240 }, C(100, 910, 'ZEDN50', 120, 21), 'literature', { sources: ['GT-THICK'] }, { gamma0: 4.3 }),
    ds('gt-100kV-30s-30C', 'positive', { done: 100 }, C(100, 60, 'ZEDN50', 30, 30), 'literature', { sources: ['GT-OPT'] }, { gamma0: 2.79, gammaReported: '2.79 (1/log(D100/D0))' }),
    ds('gt-100kV-30s-RT', 'positive', { done: 160 }, C(100, 60, 'ZEDN50', 30, 21), 'literature', { sources: ['GT-OPT'] }, { gamma0: 4.28, gammaReported: '4.28' }),
    ds('gt-100kV-30s-10C', 'positive', { done: 240 }, C(100, 60, 'ZEDN50', 30, 10), 'literature', { sources: ['GT-OPT'] }, { gamma0: 4.79, gammaReported: '4.79' }),
    ds('gt-100kV-30s-0C', 'positive', { done: 275 }, C(100, 60, 'ZEDN50', 30, 0), 'literature', { sources: ['GT-OPT'] }, { gamma0: 6.03, gammaReported: '6.03' }),
    ds('zeon-20kV-1min', 'positive', { done: 34 }, C(20, 500, 'ZEDN50', 60, 23, { prebake: '180 °C 3 min' }), 'datasheet', { sources: ['ZEON'], note: 'read from plot' }),
    ds('zeon-20kV-9min', 'positive', { done: 23 }, C(20, 500, 'ZEDN50', 540, 23), 'datasheet', { sources: ['ZEON'] }),
    ds('zeon-20kV-18C', 'positive', { done: 41 }, C(20, 500, 'ZEDN50', 60, 18), 'datasheet', { sources: ['ZEON'] }),
    ds('mohammad-10kV', 'positive', { onset: 15, d50: 23, done: 28 }, C(10, 160, 'ZEDN50', 20, 22), 'literature', { sources: ['MOHAMMAD'], note: 'read from figure' }),
    ds('mohammad-10kV-mibk-ipa', 'positive', { onset: 60, d50: 98, done: 110 }, C(10, 160, 'MIBK_IPA', 20, 22), 'literature', { sources: ['MOHAMMAD'] }),
    ds('thoms-100kV-xylene', 'positive', { onset: 87, d50: 145, done: 185 }, C(100, 200, 'XYLENE', 60, 21), 'literature', { sources: ['THOMS'], note: 'time not in the abstract' }, { gammaReported: '4.8' }),
  ],
  advice: [
    { topic: 'Availability', text: 'DTU Nanolab no longer buys ZEP 520A ("very expensive … use CSAR instead"); the Gamma coater still offers ZEP 520A diluted 1:2 (55–120 nm), pay-per-use.', sources: ['LA-ZEP'] },
    { topic: 'Coating', text: '1:1 in anisole ≈ 100 nm at 4000 rpm (LabSpin); undiluted ≈ 340 nm. Soft bake 2 min at 180 °C (5 min on Pyrex). Prebake 90–210 °C barely changes the dose.', sources: ['LA-ZEP', 'ZEON'] },
    { topic: 'Dose and development', text: 'At 100 kV 200–350 µC/cm²; ZED-N50 60 s with agitation, IPA rinse. "Make sure you develop in the same manner as after the dose test." Cold development (0 to −15 °C) sharpens the contrast at 2–3× the dose.', sources: ['LA-ZEP', 'GT-OPT', 'MOHAMMAD'] },
    { topic: 'Pitfalls', text: 'Never use plasma ashing as descum (BHF dip instead). Very high doses (≈ 10×) turn ZEP negative. ZED-N50 gives rougher edges than MIBK:IPA.', sources: ['LA-ZEP', 'MOHAMMAD'] },
  ],
};

// ===================================================================== PMMA
const pmmaRef = ds('estimate-100kV-100nm', 'positive', { onset: 140, d50: 200, done: 300 }, C(100, 100, 'MIBK_IPA', 60, 21, { prebake: '180 °C' }), 'estimate',
  { sources: ['FALLICA16', 'THOMS', 'ROOKS', 'AR-PMMA'], note: 'analytical best guess for 950K at 100 kV in MIBK:IPA 1:3 60 s: D50 ≈ 186–205 (Fallica, Thoms), clearing ≈ 290–300; no DTU data' });
const PMMA = {
  id: 'PMMA', name: 'PMMA 950K', product: 'Allresist AR-P 672.03 (950K in anisole) at DTU; also MicroChem/Kayaku A-series', supplier: 'Allresist (DTU), MicroChem/Kayaku', tone: 'positive', family: 'poly(methyl methacrylate), chain scission', atDTU: true,
  summary: 'The classic high-resolution positive resist: sub-10 nm with cold development, easy lift-off (also in bilayers), poor dry-etch resistance. LabAdviser has no DTU exposure or contrast data for PMMA: every number here is from the literature.',
  sources: {
    'LA-PMMA': { cite: 'DTU Nanolab LabAdviser: PMMA (AR-P 672.03 spin data)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/PMMA', kind: 'labadviser' },
    'AR-PMMA': { cite: 'Allresist, Positive PMMA E-beam resists AR-P 630–670 (2014)', url: 'https://litho.nano.cnr.it/wp-content/datasheets/allresist_produktinfos_ar-p630-670_englisch.pdf', kind: 'datasheet' },
    'ROOKS': { cite: 'M. J. Rooks et al., J. Vac. Sci. Technol. B 20, 2937 (2002)', url: 'https://doi.org/10.1116/1.1524971', kind: 'paper' },
    'CORD': { cite: 'B. Cord, J. Lutkenhaus, K. K. Berggren, J. Vac. Sci. Technol. B 25, 2013 (2007)', url: 'https://doi.org/10.1116/1.2799978', kind: 'paper' },
    'FALLICA16': { cite: 'R. Fallica et al., J. Vac. Sci. Technol. B 34, 06K702 (2016) / arXiv:1710.08733', url: 'https://arxiv.org/pdf/1710.08733', kind: 'paper' },
    'THOMS': { cite: 'S. Thoms, D. S. Macintyre, J. Vac. Sci. Technol. B 32, 06FJ01 (2014)', url: 'https://doi.org/10.1116/1.4899239', kind: 'paper' },
    'MOHAMMAD10': { cite: 'M. A. Mohammad et al., in Lithography (InTech 2010), doi:10.5772/8182', url: 'https://www.intechopen.com/chapters/8673', kind: 'paper' },
    'MCCORD': { cite: 'M. A. McCord, M. J. Rooks, Handbook of Microlithography Vol. 1, ch. 2 (SPIE 1997)', url: '', kind: 'paper' },
  },
  window: { kV: [10, 100], thicknessNm: [30, 500], developers: ['MIBK_IPA', 'MIBK_IPA_11', 'IPA_H2O'], timeS: [20, 180], tempC: [-15, 23], sources: ['AR-PMMA', 'CORD', 'ROOKS'] },
  model: {
    ref: ref(pmmaRef), refBasis: 'analytical best guess (literature, no DTU data)', refUncertainty: 0.35, refSources: ['FALLICA16', 'THOMS', 'ROOKS'], density: 1.19,
    nE: { value: 0.95, sd: 0.1, sources: ['AR-PMMA', 'MOHAMMAD10', 'MCCORD'] },
    p: { value: 0.15, sd: 0.08, sources: ['MOHAMMAD10'] },
    q: { value: 0.25, sd: 0.15, sources: [] },
    EDeV: { value: 0.26, sd: 0.08, sources: ['CORD', 'MOHAMMAD10'] }, TsatC: -20,
    cGamma: { value: 0.015, sd: 0.01, sources: ['CORD', 'ROOKS'] },
    developers: {
      MIBK_IPA_11: { factor: 0.6, sd: 0.25, gammaFactor: 0.85, note: 'MIBK:IPA 1:1: more sensitive, a little less contrast', sources: ['MCCORD'] },
      MIBK: { factor: 0.55, sd: 0.25, gammaFactor: 0.7, note: 'pure MIBK: ≈ 1.7× more sensitive than 1:3, low resolution, dark loss', sources: ['MOHAMMAD10'] },
      IPA_H2O: { factor: 0.55, sd: 0.25, gammaFactor: 0.9, EDeV: 0.45, note: 'IPA:H₂O 7:3: about twice as sensitive as MIBK:IPA 1:3, strongly temperature dependent (γ 3.7 → 6.1 from 20 to 0 °C)', sources: ['ROOKS'] },
      IPA: { factor: 1.6, sd: 0.4, gammaFactor: 1.5, note: 'IPA alone: higher contrast, lower sensitivity; cannot develop thick films', sources: ['AR-PMMA', 'ROOKS'] },
    },
    notes: 'Voltage: Allresist\'s own 30 → 100 kV ratio ×3.1 (n ≈ 0.94); gratings 10 → 30 kV n ≈ 0.94. Cold development: γ peaks near −15 °C (Cord), dose ×1.9 from 15 to 0 °C and ×3.4 at −15 °C; below −20 °C contrast falls. Time: p ≈ 0.11–0.21 at RT, ≈ 0 when cold.',
  },
  datasets: [
    pmmaRef,
    ds('rooks-100kV-mibkipa', 'positive', { onset: 180, d50: 280, done: 390 }, C(100, 1700, 'MIBK_IPA', 600, 20), 'literature', { sources: ['ROOKS'], note: '1.7 µm film; read from figure' }, { gammaReported: '4.2' }),
    ds('rooks-100kV-ipah2o-20C', 'positive', { onset: 125, d50: 160, done: 200 }, C(100, 1700, 'IPA_H2O', 240, 20), 'literature', { sources: ['ROOKS'] }, { gammaReported: '3.7' }),
    ds('rooks-100kV-ipah2o-10C', 'positive', { d50: 350, done: 420 }, C(100, 1700, 'IPA_H2O', 240, 10), 'literature', { sources: ['ROOKS'] }, { gammaReported: '5.0' }),
    ds('rooks-100kV-ipah2o-0C', 'positive', { d50: 560, done: 650 }, C(100, 1700, 'IPA_H2O', 240, 0), 'literature', { sources: ['ROOKS'] }, { gammaReported: '6.1' }),
    ds('thoms-100kV', 'positive', { onset: 140, d50: 205, done: 290 }, C(100, 200, 'MIBK_IPA', 60, 21), 'literature', { sources: ['THOMS'], note: 'IPA:MIBK 2.5:1; residual hump to ≈ 400–480' }, { gammaReported: '2.7' }),
    ds('allresist-30kV-ar600-56', 'positive', { onset: 57, d50: 125, done: 165 }, C(30, 165, 'MIBK_IPA_11', 60, 22), 'datasheet', { sources: ['AR-PMMA'], note: 'AR-P 679.03, AR 600-56 (MIBK-based, mapped to MIBK:IPA 1:1)' }, { gammaReported: '6.6' }),
    ds('allresist-30kV-ipa', 'positive', { onset: 110, d50: 195, done: 311 }, C(30, 165, 'IPA', 60, 22), 'datasheet', { sources: ['AR-PMMA'] }, { gammaReported: '10.5' }),
    ds('cord-30kV-15C', 'positive', { done: 220 }, C(30, 160, 'MIBK_IPA', 60, 15), 'literature', { sources: ['CORD'], note: 'IPA:MIBK 3:1' }, { gamma0: 5 }),
    ds('cord-30kV-0C', 'positive', { done: 420 }, C(30, 160, 'MIBK_IPA', 60, 0), 'literature', { sources: ['CORD'] }, { gamma0: 6 }),
    ds('cord-30kV-m15C', 'positive', { done: 750 }, C(30, 160, 'MIBK_IPA', 60, -15), 'literature', { sources: ['CORD'] }, { gamma0: 7 }),
  ],
  advice: [
    { topic: 'At DTU', text: 'AR-P 672.03 (950K in anisole): ≈ 96 nm at 4000 rpm, 36 nm diluted 1:1; soft bake 3 min 150 °C. Developers MIBK:IPA 1:3 or IPA:H₂O 7:3, IPA rinse; remove with acetone or 1165. Contact Lithography for the PMMA types in stock. No DTU dose data exists yet.', sources: ['LA-PMMA'] },
    { topic: 'Uses', text: 'Highest resolution (sub-10 nm, cold developed), single- or bilayer lift-off (50K under 950K for a large undercut), thick high-aspect-ratio stencils in IPA:H₂O. Poor dry-etch resistance (O₂ 344, CF₄ 59 nm/min — about twice CSAR).', sources: ['AR-PMMA', 'ROOKS', 'CORD'] },
    { topic: 'Pitfalls', text: 'High doses turn PMMA negative (≈ 1.5–7 mC/cm² at 30 kV, lower when cold developed). Patterns flow above ≈ 125 °C.', sources: ['AR-PMMA'] },
  ],
};

// ===================================================================== PMMA 50K (low molecular weight)
// The bottom layer of PMMA double-layer stacks: more sensitive than 950K, so under a 950K (or 200K) top it
// develops wider — the undercut lift-off needs. No DTU data: an analytical best guess, anchored as a ratio
// to the 950K entry (the literature puts low-MW PMMA at ≈ 0.7–0.85 of 950K's dose at room temperature).
const p50Ref = ds('estimate-100kV-100nm', 'positive', { onset: 105, d50: 150, done: 225 }, C(100, 100, 'MIBK_IPA', 60, 21, { prebake: '150–180 °C' }), 'estimate',
  { sources: ['YAN08', 'AR-PMMA50', 'JIN21'], note: 'analytical best guess: the 950K best guess (onset 140 / D50 200 / clearing 300) × 0.75 — Yan 2008: D50(50K)/D50(950K) ≈ 0.7 at 20 °C; Allresist: 50K "about 20 % more sensitive"; Jin 2021: 100k ≈ 0.74 of 950k. No DTU data' });
const PMMA50K = {
  id: 'PMMA50K', name: 'PMMA 50K (low MW)', product: 'Allresist AR-P 632 / 639 (50K; anisole / ethyl lactate), e.g. 632.06 ≈ 110 nm at 4000 rpm; MicroChem 495K as a near alternative', supplier: 'Allresist (MicroChem/Kayaku: 495K)', tone: 'positive', family: 'poly(methyl methacrylate), low molecular weight — chain scission', atDTU: true,
  summary: 'Low-molecular-weight PMMA, used as the bottom layer of double-layer stacks under 950K (or 200K) PMMA: it is about 20–30 % more sensitive, so it develops wider than the top layer and leaves the undercut that lift-off needs. Its resolution is poorer than 950K\'s, and its dissolution faster. DTU has various PMMA types (ask Lithography) but no data on 50K: every number here is from the literature.',
  sources: {
    'LA-PMMA': { cite: 'DTU Nanolab LabAdviser: PMMA ("various types of PMMA in the cleanroom — contact Lithography")', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/PMMA', kind: 'labadviser' },
    'LA-617': { cite: 'DTU Nanolab LabAdviser: Copolymer AR-P 617 (contrast curves at 100 kV, bilayer under CSAR, 2024)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/AR-P_617', kind: 'labadviser' },
    'AR-PMMA50': { cite: 'Allresist, Product information PMMA AR-P 630–670 (50K–950K; two-layer systems), 2014/2021', url: 'https://www.allresist.com/wp-content/uploads/sites/2/2024/12/Allresist_Product-information-E-Beamresist-AR-P-630-670-English-web.pdf', kind: 'datasheet' },
    'YAN08': { cite: 'M. Yan, K. R. V. Subramanian, S. Choi, I. Adesida, EIPBN 2008 P-6B-09 / J. Vac. Sci. Technol. B 26, 2306 (2008) — PMMA 50K–2.2M, 50 kV, MIBK:IPA 1:3 at 20 / 0 / −10 °C', url: 'https://eipbn.org/abstracts/2008/papers/P-6B-09.pdf', kind: 'paper' },
    'JIN21': { cite: 'Y. Jin et al., arXiv:2102.06123 (2021) — copolymer, 100k, 495k, 950k at 100 kV (γ 4.5 / 5.9 / 6.4 / 7.3)', url: 'https://arxiv.org/abs/2102.06123', kind: 'paper' },
    'DOBISZ': { cite: 'E. A. Dobisz et al., Appl. Phys. Lett. 74, 4064 (1999) — 50K vs 950K linespread', url: 'https://hero.epa.gov/reference/1617733/', kind: 'paper' },
    'MCC': { cite: 'MicroChem, NANO PMMA and Copolymer datasheet (495K / 950K; "dissolution rate increases as molecular weight decreases")', url: 'https://aggiefab.tamu.edu/wp-content/uploads/2022/01/PMMA_Data_Sheet.pdf', kind: 'datasheet' },
  },
  window: { kV: [20, 100], thicknessNm: [50, 400], developers: ['MIBK_IPA', 'MIBK_IPA_11', 'IPA_H2O', 'IPA'], timeS: [20, 180], tempC: [-15, 23], sources: ['AR-PMMA50', 'YAN08'] },
  model: {
    ref: ref(p50Ref), refBasis: 'analytical best guess (950K × 0.75, literature; no DTU data)', refUncertainty: 0.35, refSources: ['YAN08', 'AR-PMMA50', 'JIN21'], density: 1.19,
    nE: { value: 0.95, sd: 0.12, sources: ['AR-PMMA50'] },
    p: { value: 0.18, sd: 0.1, sources: ['MCC'] },
    q: { value: 0.25, sd: 0.15, sources: [] },
    // colder development removes the molecular-weight advantage (Yan: at −10 °C all MW clear alike): a
    // steeper temperature law than 950K's 0.26 eV
    EDeV: { value: 0.34, sd: 0.1, sources: ['YAN08'] }, TsatC: -20,
    cGamma: { value: 0.015, sd: 0.01, sources: [] },
    developers: {
      MIBK_IPA_11: { factor: 0.6, sd: 0.3, gammaFactor: 0.85, note: 'MIBK:IPA 1:1: more sensitive (as for 950K)', sources: [] },
      IPA_H2O: { factor: 0.55, sd: 0.3, note: 'IPA:H₂O 7:3 (as for 950K)', sources: [] },
      IPA: { factor: 1.6, sd: 0.4, gammaFactor: 1.4, note: 'IPA (AR 600-60): less sensitive, higher contrast (as for 950K)', sources: ['AR-PMMA50'] },
    },
    notes: 'Anchored as 0.75 × the 950K best guess. Developer factors are taken over from 950K, untested for 50K. The time law reflects that low-MW PMMA dissolves faster (MicroChem), not a measured exponent. Contrast: Jin et al. find γ falling with molecular weight (7.3 → 5.9 from 950k to 100k).',
  },
  datasets: [
    p50Ref,
    ds('yan-50kV-50K-20C', 'positive', { d50: 225, done: 360 }, C(50, 100, 'MIBK_IPA', 60, 20), 'literature', { sources: ['YAN08'], note: 'read from the abstract\'s figure (≈); thickness and development time not stated — 100 nm and 60 s assumed; 950K in the same figure: D50 ≈ 315 with a tail to ≈ 500' }),
  ],
  advice: [
    { topic: 'Double layers for lift-off', text: 'Low molecular weight at the bottom, higher on top (50K under 200K / 600K / 950K: a large undercut; 600K under 950K: a smaller one). Coat the top layer from an ethyl-lactate PMMA (AR-P 6x9), which does not attack the layer below; bake each layer 150–180 °C. One development dissolves both — in Fab Studio, develop each layer in the same developer, top first.', sources: ['AR-PMMA50'] },
    { topic: 'Dose', text: 'About 20–30 % less dose than 950K at room temperature (Allresist: "about 20 % more sensitive"; Yan 2008: D50 ≈ 0.7×). Developed cold (−10 °C) the difference disappears. Process example: AR-P 632.06 (110 nm) at 20 kV ≈ 95 µC/cm² in AR 600-55, 1 min.', sources: ['AR-PMMA50', 'YAN08'] },
    { topic: 'Resolution', text: 'Poorer than 950K: line spread 28 nm against 11.7 nm (Dobisz 1999); it dissolves faster and loses more thickness in unexposed areas (no numbers found) — use it below, not on top.', sources: ['DOBISZ', 'MCC'] },
    { topic: 'At DTU', text: 'DTU has various PMMA types (contact Lithography); no 50K data. DTU\'s tested bilayer is the copolymer AR-P 617 (bake 200 °C) under CSAR: 400 µC/cm² at 100 kV, ZED-N50 90 s then AR 600-50 90 s; AR-P 617 is 3–4× more sensitive than PMMA (DTU contrast curves: clearing ≈ 50–75 µC/cm² at 100 kV).', sources: ['LA-PMMA', 'LA-617'] },
  ],
};

// ===================================================================== HSQ
const hsqRef = ds('estimate-100kV-100nm', 'negative', { onset: 400, done: 1300 }, C(100, 100, 'TMAH238', 60, 21, { prebake: 'none / ≤ 120 °C' }), 'estimate',
  { sources: ['ROOKS-HSQ', 'GT-HSQ', 'NAM', 'LA-HSQ'], note: 'analytical best guess for 100 kV in 2.38 % TMAH: onset ≈ 300–500, full thickness ≈ 1200–1500 µC/cm² (Rooks MF-312 at 100 kV: 350 / 1500; Georgia Tech 2.3 % TMAH: 190 / 660, kV not given)' });
const HSQ = {
  id: 'HSQ', name: 'HSQ', product: 'Dow XR-1541 (‑002/‑004/‑006), FOx-12/15; DisChem H-SiQ as a second source', supplier: 'Dow (Dow Corning) / DisChem', tone: 'negative', family: 'hydrogen silsesquioxane — inorganic, cross-links to SiOx', atDTU: true,
  summary: 'The highest-resolution negative resist (4.5 nm half-pitch reported), becoming SiOx when exposed — a hard etch mask. Slow (≈ mC/cm² at 100 kV) and delicate: its result depends on the time from fridge to coat, coat to exposure and exposure to development.',
  sources: {
    'LA-HSQ': { cite: 'DTU Nanolab LabAdviser: HSQ dose test, high-resolution HSQ, process flow', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/High_resolution_patterning_with_HSQ', kind: 'labadviser' },
    'LA-HSQDT': { cite: 'DTU Nanolab LabAdviser: HSQ dose test (10 % HSQ, TMAH 90 s, 12 nA)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/HSQ_Dose_Test', kind: 'labadviser' },
    'YANG07': { cite: 'J. K. W. Yang, K. K. Berggren, J. Vac. Sci. Technol. B 25, 2025 (2007) — salty development', url: 'https://doi.org/10.1116/1.2801881', kind: 'paper' },
    'NAM': { cite: 'S.-W. Nam et al., J. Vac. Sci. Technol. B 27, 2635 (2009)', url: 'https://doi.org/10.1116/1.3245991', kind: 'paper' },
    'ROOKS-HSQ': { cite: 'M. Rooks (Yale), A second source for HSQ e-beam resist', url: 'https://nano.yale.edu/sites/default/files/dow_vs_dischem_hsq.pdf', kind: 'paper' },
    'GT-HSQ': { cite: 'D. K. Brown, HSQ contrast, Georgia Tech (2006)', url: 'https://www.nanolithography.gatech.edu/contrast.pdf', kind: 'paper' },
    'HAFFNER': { cite: 'M. Häffner et al., J. Vac. Sci. Technol. B 25, 2045 (2007) — developer temperature', url: 'https://doi.org/10.1116/1.2794324', kind: 'paper' },
    'CHOI': { cite: 'S. Choi et al., EIPBN 2007 PN-7 — developer temperature (γ 2.1 → 4.3, 20 → 45 °C)', url: 'https://eipbn.org/abstracts/2007/papers/PN-7.pdf', kind: 'paper' },
    'DOW': { cite: 'Dow Corning XR-1541 product information (2008)', url: 'https://www.mri.psu.edu/sites/default/files/docs/LithoDataSheets/Dow_Corning_HSQ_XR_1541_DataSheet.pdf', kind: 'datasheet' },
    'DISCHEM': { cite: 'DisChem H-SiQ datasheet HSiQT2112', url: 'https://discheminc.com/wp-content/uploads/2024/12/HSiQT2112.pdf', kind: 'datasheet' },
  },
  window: { kV: [10, 100], thicknessNm: [20, 450], developers: ['TMAH238', 'TMAH25', 'NAOH1', 'SALTY', 'TMAH238_NACL', 'AZ400K'], timeS: [30, 240], tempC: [20, 25], sources: ['YANG07', 'NAM', 'LA-HSQ'] },
  model: {
    ref: ref(hsqRef), refBasis: 'analytical best guess (literature); DTU has dose tests but no contrast curve', refUncertainty: 0.5, refSources: ['ROOKS-HSQ', 'GT-HSQ', 'NAM'], density: 1.4,
    nE: { value: 0.85, sd: 0.2, sources: ['YANG07', 'NAM'] },
    p: { value: 0, sd: 0.05, sources: ['YANG07', 'NAM'] },
    q: { value: -0.2, sd: 0.2, sources: ['YANG07'] },
    EDeV: { value: -0.4, sd: 0.25, sources: ['HAFFNER', 'CHOI'] }, TsatC: null,
    cGamma: { value: -0.03, sd: 0.015, sources: ['CHOI'] },
    developers: {
      TMAH25: { factor: 1.7, sd: 0.35, gammaFactor: 2.7, note: '25 % TMAH: higher contrast, less sensitive (Georgia Tech: γ 1.9 → 5.1)', sources: ['GT-HSQ'] },
      NAOH1: { factor: 1.5, sd: 0.5, gammaFactor: 1.6, note: '1 % NaOH; development self-limits after ≈ 4 min', sources: ['YANG07', 'NAM'] },
      SALTY: { factor: 1.5, sd: 0.5, gammaFactor: 5, p: -0.08, note: '1 % NaOH + 4 % NaCl: γ up to ≈ 10–12, the onset rises with development time; aging-sensitive (γ 5–6 after two weeks)', sources: ['YANG07', 'NAM'] },
      TMAH238_NACL: { factor: 2, sd: 0.6, gammaFactor: 3, note: 'AZ 726 MIF + 4 % NaCl, 30 s — DTU\'s high-resolution recipe (sub-10 nm at 18–26 mC/cm² in 44 nm)', sources: ['LA-HSQ'] },
      AZ400K: { factor: 4, sd: 0.3, note: 'DTU process flow: 3–5× more dose than with TMAH', sources: ['LA-HSQ'] },
    },
    notes: 'Negative resist: more aggressive development (hotter, more concentrated) needs MORE dose and gives MORE contrast — the temperature signs are reversed. Development in hydroxide self-limits: time hardly matters beyond a few minutes (p ≈ 0). The film thickness acts on the removed depth, so thin films look less sensitive in normalised curves. No same-lab 30/100 kV pair exists.',
  },
  datasets: [
    hsqRef,
    ds('rooks-100kV-mf312', 'negative', { onset: 350, done: 1500 }, C(100, 115, 'TMAH238', 240, 21), 'literature', { sources: ['ROOKS-HSQ'], note: 'MF-312 (0.54 N TMAH, mapped to TMAH), Dow 6 %; read from figure' }),
    ds('nam-100kV-naoh', 'negative', { onset: 1690, done: 3300 }, C(100, 140, 'NAOH1', 240, 21), 'literature', { sources: ['NAM'], note: 'on Si₃N₄; onset 1.69 mC/cm², γ ≈ 4 (Yang definition) → full thickness ≈ 3.3 mC/cm² (derived)' }),
    ds('yang-30kV-salty', 'negative', { onset: 650, done: 1500 }, C(30, 115, 'SALTY', 240, 24), 'literature', { sources: ['YANG07'], note: 'γ ≈ 10 (Yang definition)' }, { gammaReported: '≈ 10 (0.75/log(D75/D0))' }),
    ds('haffner-30kV-25C', 'negative', { onset: 120, done: 400 }, C(30, 100, 'TMAH25', 60, 25), 'literature', { sources: ['HAFFNER'], note: 'thickness not given (100 nm assumed)' }),
    ds('haffner-30kV-40C', 'negative', { onset: 350, done: 430 }, C(30, 100, 'TMAH25', 60, 40), 'literature', { sources: ['HAFFNER'], note: 'hot development: much steeper, less sensitive' }),
    ds('dischem-30kV', 'negative', { onset: 50, d50: 95, done: 275 }, C(30, 80, 'TMAH238', 90, 21, { prebake: '120 °C 2 min' }), 'datasheet', { sources: ['DISCHEM'], note: 'DisChem H-SiQ (second source)' }),
  ],
  advice: [
    { topic: 'At DTU', text: 'XR-1541-006 and FOx are used (user-supplied). Store in the freezer, warm to ≥ 10 °C before coating. The DTU flow (untested): 3000 rpm, 40 min at 90 °C, 3–50 mC/cm², AZ 726 MIF (TMAH) or AZ 400K 60 s (AZ 400K needs 3–5× the dose), strip in BHF. "Not recommended as a training resist."', sources: ['LA-HSQ'] },
    { topic: 'Dose', text: 'DTU dose test (10 % HSQ, TMAH 90 s, 12 nA, 100 kV): lines to size at 1400–1600 µC/cm², undersized at 1000, oversized by 10–70 nm at 1800–3000. Sub-10 nm features in BHF-thinned 44 nm HSQ: 18–26 mC/cm² with AZ 726 MIF + 4 % NaCl, 30 s.', sources: ['LA-HSQDT', 'LA-HSQ'] },
    { topic: 'Timing', text: 'Delays matter: fridge → coat, coat → exposure (dose drifts ≈ 30 % over 12 h without a top coat) and exposure → development all change the result; expose soon after coating. Salty development is the most aging-sensitive.', sources: ['LA-HSQ', 'NAM'] },
    { topic: 'Uses', text: 'Etch mask (InP:HSQ up to 50:1, GaAs nano etch 1.5 nm/s), SiOx after annealing; BHF removes it in seconds. Hot or salty developers etch Si.', sources: ['LA-HSQ', 'YANG07'] },
  ],
};

// ===================================================================== mr-EBL 6000
const mrRef = ds('estimate-100kV-100nm', 'negative', { onset: 3, d50: 7, done: 20 }, C(100, 100, 'MRDEV600', 40, 21, { prebake: '110 °C 3 min', peb: '110 °C 5 min' }), 'estimate',
  { sources: ['MRT-WEB', 'DTU-MREBL', 'TAAL'], note: 'analytical best guess: the manufacturer gives 8–15 µC/cm² at 100 kV; DTU (100 nm lines) ≈ 6–7 at half thickness, ≈ 35–40 full; Taal ≈ 7.5–10 clearing' });
const MREBL = {
  id: 'MREBL', name: 'mr-EBL 6000', product: 'mr-EBL 6000.1 (≈ 100 nm), .3, .5', supplier: 'micro resist technology', tone: 'negative', family: 'chemically amplified epoxy (needs a post-exposure bake)', atDTU: true,
  summary: 'A very sensitive chemically amplified negative resist (µC/cm²-range doses): fast writing, but the post-exposure bake controls the outcome, and the contrast is low. Proximity correction is necessary.',
  sources: {
    'LA-MREBL': { cite: 'DTU Nanolab process flow mr-EBL 6000 (untested)', url: 'https://labadviser.nanolab.dtu.dk//images/f/f2/Process_Flow_mrEBL6000.docx', kind: 'labadviser' },
    'DTU-MREBL': { cite: 'W. Tiddi, Characterization of negative tone e-beam resist mr-EBL 6000.1, DTU Danchip (2015)', url: 'https://labadviser.nanolab.dtu.dk/images/6/67/Report_%282%29.pdf', kind: 'labadviser' },
    'MRT-PG': { cite: 'micro resist technology, Processing Guidelines mr-EBL 6000 (2012)', url: 'https://labadviser.nanolab.dtu.dk/images/f/fe/MrEBL6000_Processing_Guidelines.pdf', kind: 'datasheet' },
    'MRT-WEB': { cite: 'micro resist technology, mr-EBL 6000 product page (8–15 µC/cm² at 100 kV)', url: 'https://microresist.de/en/produkt/mr-ebl-6000-series/', kind: 'datasheet' },
    'TAAL': { cite: 'A. J. Taal, J. Rabinowitz, K. L. Shepard, Nanotechnology 32, 245302 (2021)', url: 'https://doi.org/10.1088/1361-6528/abeded', kind: 'paper' },
  },
  window: { kV: [10, 100], thicknessNm: [70, 500], developers: ['MRDEV600'], timeS: [30, 70], tempC: [20, 25], sources: ['MRT-PG', 'LA-MREBL'] },
  model: {
    ref: ref(mrRef), refBasis: 'analytical best guess (manufacturer and DTU report)', refUncertainty: 0.45, refSources: ['MRT-WEB', 'DTU-MREBL', 'TAAL'], density: 1.2,
    nE: { value: 1.1, sd: 0.3, sources: ['MRT-PG', 'MRT-WEB'] },
    p: { value: -0.05, sd: 0.15, sources: [] },
    q: { value: 0, sd: 0.3, sources: [] },
    EDeV: { value: 0, sd: 0.3, sources: [] }, TsatC: null,
    cGamma: { value: 0, sd: 0.03, sources: [] },
    developers: {
      PC: { factor: 1.2, sd: 0.3, gammaFactor: 1.1, note: 'propylene carbonate: slightly higher contrast, no residues (Taal)', sources: ['TAAL'] },
    },
    notes: 'The post-exposure bake is not in the model: the curves assume the manufacturer\'s 110 °C/5 min PEB; Taal found 80 °C/1 min gives better contrast and resolution. No data exist on development time or temperature: those laws are placeholders with wide errors — any change from the reference is effectively extrapolation.',
  },
  datasets: [
    mrRef,
    ds('mrt-10kV', 'negative', { onset: 0.5, d50: 0.74, done: 4.5 }, C(10, 100, 'MRDEV600', 40, 22), 'datasheet', { sources: ['MRT-PG'], note: 'read from figure' }),
    ds('mrt-20kV', 'negative', { onset: 1.0, d50: 2.0, done: 6.7 }, C(20, 100, 'MRDEV600', 40, 22), 'datasheet', { sources: ['MRT-PG'], note: 'read from figure' }),
    ds('mrt-25kV', 'negative', { onset: 1.7, d50: 2.75, done: 5.5 }, C(25, 100, 'MRDEV600', 40, 22), 'datasheet', { sources: ['MRT-PG'], note: 'read from figure' }),
    ds('dtu-100kV-lines', 'negative', { d50: 6.5, done: 37 }, C(100, 80, 'MRDEV600', 40, 21, { peb: '110 °C 5 min' }), 'measured', { lab: 'DTU Danchip', tool: 'JEOL JBX-9500', method: '100 nm lines, 4 µm pitch (not pads)', sources: ['DTU-MREBL'], note: 'line test, so it includes the line\'s own proximity loss' }, { gamma0: 1.2 }),
  ],
  advice: [
    { topic: 'Process (DTU flow, untested)', text: 'Pre-bake 200 °C 5 min; spin 3000 rpm (≈ 90 nm for 6000.1); soft bake 110 °C 3 min; keep in yellow light; PEB 110 °C 5 min IMMEDIATELY after exposure; mr-Dev 600 40 ± 10 s at 20–25 °C, IPA rinse; strip with mr-Rem 660/500 or O₂ plasma.', sources: ['LA-MREBL'] },
    { topic: 'Dose and resolution', text: 'Manufacturer: 8–15 µC/cm² at 100 kV (older sheets: 2–5 at 10 kV, 4–6 at 20 kV). DTU: 50–200 nm features, strong proximity effect below 600 nm spacing. PGMEA developers leave residues (aggressive IPA spray or descum).', sources: ['MRT-WEB', 'DTU-MREBL'] },
    { topic: 'PEB', text: 'Without PEB nothing cross-links. Taal et al.: 80 °C/1 min gives the best contrast; 110 °C/5 min over-cross-links and limits resolution.', sources: ['TAAL', 'DTU-MREBL'] },
  ],
};

// ===================================================================== AR-N 7520 (New)
const arnDTU = ds('dtu-100kV-7520.17new', 'negative', null, C(100, 400, 'AR300_46', 90, 21, { prebake: '85 °C 60 s', substrate: 'Si' }), 'measured',
  { lab: 'DTU Nanolab', tool: 'JEOL JBX-9500 (100 kV)', method: 'contrast curve', sources: ['LA-ARN'], note: 'AR-N 7520.17 New, 4000 rpm (≈ 400 nm per the datasheet; the page gives no thickness); points read from the LabAdviser plot; the onset lies below the lowest dose (20 µC/cm²)' },
  { points: [[8, 0.05], [20, 0.48], [40, 0.78], [60, 0.92], [100, 1.0], [200, 1.0], [400, 1.0]] });
const ARN7520 = {
  id: 'ARN7520', name: 'AR-N 7520 New', product: 'AR-N 7520.07 / .11 / .17 New (DTU-supplied); old AR-N 7520.18 user-supplied — "New" and old are different resists', supplier: 'Allresist', tone: 'negative', family: 'novolac + cross-linker (not chemically amplified), aqueous TMAH development', atDTU: true,
  summary: 'A negative resist for e-beam, DUV and i-line (mix-and-match), developed in aqueous TMAH. "New" is ≈ 8× more sensitive than the old 7520. Resolution ≈ 28–30 nm; good dry-etch resistance.',
  sources: {
    'LA-ARN': { cite: 'DTU Nanolab LabAdviser: AR-N 7520 New (contrast curve at 100 kV)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/AR-N_7520_New', kind: 'labadviser' },
    'AR-NEW': { cite: 'Allresist, Product information AR-N 7520 new (2018)', url: 'https://labadviser.nanolab.dtu.dk//images/3/30/AR-N-7520New.pdf', kind: 'datasheet' },
    'AR-300': { cite: 'Allresist, AR 300-40 metal-ion-free developers (AR 300-46 0.24 N, AR 300-47 0.20 N)', url: 'https://litho.nano.cnr.it/wp-content/datasheets/allresist_produktinfos_ar300-40_englisch.pdf', kind: 'datasheet' },
    'ANDOK': { cite: 'R. Andok et al., J. Phys.: Conf. Ser. 2443, 012006 (2023)', url: 'https://doi.org/10.1088/1742-6596/2443/1/012006', kind: 'paper' },
  },
  window: { kV: [30, 100], thicknessNm: [100, 400], developers: ['AR300_46', 'AR300_47', 'AR300_47_41'], timeS: [40, 120], tempC: [21, 23], sources: ['AR-NEW', 'AR-300', 'LA-ARN'] },
  model: {
    ref: ref(arnDTU), refBasis: 'measured at DTU (100 kV, AR 300-46 90 s)', refUncertainty: 0.15, refSources: ['LA-ARN'], density: 1.2,
    nE: { value: 0.9, sd: 0.2, sources: [] },
    p: { value: -0.1, sd: 0.15, sources: ['AR-NEW'] },
    q: { value: 0, sd: 0.25, sources: [] },
    EDeV: { value: -0.2, sd: 0.3, sources: [] }, TsatC: null,
    cGamma: { value: 0, sd: 0.03, sources: [] },
    developers: {
      AR300_47: { factor: 0.9, sd: 0.2, note: 'AR 300-47 (0.20 N): a little weaker than 300-46', sources: ['AR-300'] },
      AR300_47_41: { factor: 0.8, sd: 0.25, gammaFactor: 1.2, note: '4:1 with water: "a stronger dilution results in an increased contrast and a reduced development rate"', sources: ['AR-NEW'] },
      TMAH238: { factor: 1.1, sd: 0.25, note: 'AZ 726 MIF (2.38 % TMAH ≈ 0.26 N) — DTU lists MIF 726 as a developer', sources: ['AR-300'] },
    },
    notes: 'Anchored on DTU\'s 100 kV curve for 7520.17 New. Allresist gives no quantitative development-time or temperature curves (only "develop 40–60 s, max 120 s, at 21–23 ± 0.5 °C"): those laws are placeholders with wide errors.',
  },
  datasets: [
    arnDTU,
    ds('andok-40kV', 'negative', { onset: 35, d50: 65, done: 200 }, C(40, 400, 'AR300_47', 120, 21), 'literature', { sources: ['ANDOK'], note: 'variant (old or New) not stated — its dose (≈ 200 µC/cm² full at 40 kV, against DTU’s ≈ 100 at 100 kV for New) suggests the old, ≈ 8× slower resist; read from figure' }, { gammaReported: '2.79 (Andok definition)' }),
  ],
  advice: [
    { topic: 'At DTU', text: '"New" is DTU-supplied (7520.07 / .11 / .17), coated on LabSpin 02/03 with the PGME/PGMEA bowlset; developers AR 300-47 or AZ 726 MIF, water rinse. The old AR-N 7520.18 is a different resist (user-supplied).', sources: ['LA-ARN'] },
    { topic: 'Process', text: 'DTU contrast curve: 4000 rpm, bake 85 °C 60 s, 100 kV, AR 300-46 90 s, DI stopper 30 s. Allresist: 7520.17/.11/.07 give 0.4/0.2/0.1 µm at 4000 rpm; develop 40–60 s (max 120 s) at 21–23 ± 0.5 °C; store at 10–18 °C, 6 months.', sources: ['LA-ARN', 'AR-NEW'] },
    { topic: 'Etch', text: 'Bosch Si etch selectivity ≈ 1:6; Si RIE 8 ± 1.8 (SF₆/C₄F₈).', sources: ['AR-NEW'] },
  ],
};

// ===================================================================== Medusa 82 (AR-N 8200)
// A silsesquioxane (HSQ-like) negative resist, not chemically amplified; its dose is set above all by the
// post-exposure bake (PEB), which this entry models as a sixth condition (model.extra).
const PEB = (pebC) => ({ prebake: '150 °C 10 min', peb: `${pebC} °C 10 min`, pebC });
const medDTU = (pebC, pts) => ds(`dtu-100kV-peb${pebC}`, 'negative', null, C(100, 110, 'AR300_47_11', 60, 21, PEB(pebC)), 'measured',
  { lab: 'DTU Nanolab', tool: 'JEOL JBX-9500 (60 nA)', method: 'Dektak XTA, normalised height', sources: ['LA-8200'], note: `PEB ${pebC} °C 10 min; read from the LabAdviser plot (approximate); development temperature not stated (21 °C assumed). The curve rises steeply to ≈ 0.6 and then has a long tail to full height: one γ describes it poorly` },
  { points: pts });
const medRef = medDTU(170, [[100, 0], [175, 0.03], [198, 0.5], [290, 0.9], [500, 1.0], [1000, 1.0]]);
const MEDUSA = {
  id: 'MEDUSA', name: 'Medusa 82 (AR-N 8200)', product: 'SX AR-N 8200.03 / .06 / .18 (50 / 100 / 400 nm at 4000 rpm); DTU stock: .06 and .03', supplier: 'Allresist', tone: 'negative', family: 'silsesquioxane (HSQ-like), not chemically amplified; the PEB drives the cross-linking', atDTU: true,
  summary: 'A high-resolution negative resist from Allresist, an alternative to HSQ (10–20 nm), more stable in storage. Its dose and contrast are set above all by the post-exposure bake: DTU measured the dose to fall about 4.5× between a 130 °C and a 170 °C PEB. Without a PEB it needs mC/cm² doses.',
  sources: {
    'LA-8200': { cite: 'DTU Nanolab LabAdviser: AR-N 8200 (process, 100 kV PEB series on 150 × 300 µm rectangles, eLINE 30 kV)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/ARN8200', kind: 'labadviser' },
    'LA-ELINE': { cite: 'DTU Nanolab LabAdviser: Raith eLINE — dose to clear vs kV (guideline)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/eLINE', kind: 'labadviser' },
    'AR-8200': { cite: 'Allresist, Product information SX AR-N 8200 / 8250 (Medusa 82), Jan 2020', url: 'https://www.allresist.com/wp-content/uploads/sites/2/2020/03/SXAR-N8200-1_english_Allresist_product_information.pdf', kind: 'datasheet' },
    'AR-MNE': { cite: 'M. Schirmer (Allresist), Medusa 82, MNE 2019 (slides 2020)', url: 'https://www.allresist.com/wp-content/uploads/sites/2/2020/10/Medusa82_presentation-2020.pdf', kind: 'datasheet' },
    'AR-300': { cite: 'Allresist process chemicals: AR 300-44 / -46 / -47 = 0.26 / 0.24 / 0.20 N TMAH (2021)', url: 'https://www.allresist.com/wp-content/uploads/sites/2/2021/05/Allresist_Product-information_Process-chemicals-English_web.pdf', kind: 'datasheet' },
    'MPATZAKA': { cite: 'Th. Mpatzaka et al., Micro Nano Eng. 8, 100065 (2020) — PEB, development time and developer strength (full text not read)', url: 'https://doi.org/10.1016/j.mne.2020.100065', kind: 'paper' },
    'GRUBE': { cite: 'M. Grube et al., J. Vac. Sci. Technol. B 39, 012602 (2021) (abstract)', url: 'https://doi.org/10.1116/6.0000542', kind: 'paper' },
    'VIDENOV': { cite: 'N. Videnov, M. L. Day, M. Bajcsy, arXiv:2508.20245 (2025) — process with PEB 170 °C', url: 'https://arxiv.org/abs/2508.20245', kind: 'paper' },
  },
  window: { kV: [30, 100], thicknessNm: [50, 400], developers: ['AR300_47_11', 'AR300_47', 'AR300_44'], timeS: [60, 90], tempC: [21, 23], pebC: [130, 180], sources: ['LA-8200', 'AR-8200'] },
  model: {
    ref: { ...ref(medRef), pebC: 170 }, refBasis: 'measured at DTU (100 kV, 110 nm, PEB 170 °C, AR 300-47:DIW 1:1)', refUncertainty: 0.15, refSources: ['LA-8200'], density: 1.6,
    nE: { value: 0.95, sd: 0.2, sources: ['AR-8200', 'LA-8200'] },
    p: { value: 0, sd: 0.15, sources: [] },
    q: { value: 0, sd: 0.25, sources: [] },
    EDeV: { value: 0, sd: 0.3, sources: [] }, TsatC: null,
    cGamma: { value: 0, sd: 0.03, sources: [] },
    // the sixth condition: the post-exposure bake (10 min)
    extra: [{ key: 'pebC', name: 'post-exposure bake', short: 'PEB', unit: '°C', value: -0.037, sd: 0.008, tol: 2, law: 'D₁₀₀ ∝ exp[k·(T_PEB − T_ref)]', param: 'k (per °C)',
      note: 'from DTU\'s series at 130/150/160/170 °C (D50 880 → 198 µC/cm²); Allresist\'s 100 kV series gives 0.032', sources: ['LA-8200', 'AR-8200'] }],
    developers: {
      AR300_44: { factor: 2.2, sd: 0.25, note: 'AR 300-44 (0.26 N TMAH, 90 s, 23 °C): ≈ 2× DTU\'s diluted developer (Allresist\'s 100 kV PEB series against DTU\'s)', sources: ['AR-8200', 'LA-8200'] },
      AR300_47: { factor: 1.85, sd: 0.3, note: 'AR 300-47 undiluted (0.20 N): ≈ 0.85× AR 300-44 (Allresist, 100 kV)', sources: ['AR-MNE'] },
    },
    notes: 'The voltage exponent is the ratio 30/100 kV without PEB (1300 vs 4000 µC/cm², Allresist) and DTU\'s 30 kV eLINE against its 100 kV curve, both at about 0.95. No data were found on development time, development temperature or film thickness: those laws are placeholders with wide errors. Data without PEB are not modelled (see the advice).',
  },
  datasets: [
    medRef,
    medDTU(160, [[150, 0], [260, 0.03], [277, 0.5], [390, 0.9], [600, 1.0], [1200, 1.0]]),
    medDTU(150, [[250, 0], [350, 0.03], [390, 0.5], [600, 0.9], [1170, 1.0], [1600, 1.0]]),
    medDTU(130, [[500, 0], [770, 0.03], [880, 0.5], [1270, 0.9], [1600, 1.0]]),
    ds('dtu-eline-30kV-peb170', 'negative', { done: 165 }, C(30, 120, 'AR300_47_11', 60, 21, PEB(170)), 'measured', { lab: 'DTU Nanolab', tool: 'Raith eLINE Plus (168 pA)', sources: ['LA-8200', 'LA-ELINE'], note: 'area dose for fully insoluble ≈ 150–180 µC/cm² (the eLINE table gives 180); a guideline' }, { gamma0: 3 }),
    ds('allresist-100kV-peb160', 'negative', null, C(100, 100, 'AR300_44', 90, 23, PEB(160)), 'datasheet', { sources: ['AR-8200'], note: 'onset and D50 only, read from the figure (dose steps 250 µC/cm²)' }, { points: [[350, 0], [500, 0.03], [650, 0.5]] }),
    ds('allresist-100kV-peb150', 'negative', null, C(100, 100, 'AR300_44', 90, 23, PEB(150)), 'datasheet', { sources: ['AR-8200'], note: 'onset and D50 only, read from the figure' }, { points: [[440, 0], [620, 0.03], [900, 0.5]] }),
    ds('allresist-100kV-peb130', 'negative', null, C(100, 100, 'AR300_44', 90, 23, PEB(130)), 'datasheet', { sources: ['AR-8200'], note: 'onset and D50 only, read from the figure' }, { points: [[875, 0], [1250, 0.03], [1700, 0.5]] }),
  ],
  advice: [
    { topic: 'At DTU', text: 'Coat on LabSpin 2/3 (bowlset "HSQ/AR-N 8200"), 4000 rpm 60 s (8200.06 ≈ 110–120 nm); softbake 150 °C 10 min; PEB 10 min (LabSpin 2 hotplate — the temperatures are surface temperatures with the hotplate\'s 0.90 correction); develop 60 s in AR 300-47 : DIW 1:1, rinse 30 s in DIW; remove with BOE.', sources: ['LA-8200'] },
    { topic: 'The PEB decides the dose', text: '"Exposure dose for AR-N 8200 is very dependent on the PEB temperature… dose and contrast are very dependent on the PEB parameters" (DTU). At 100 kV DTU measured D50 ≈ 880 / 390 / 277 / 198 µC/cm² after 130 / 150 / 160 / 170 °C. Keep the PEB fixed between your dose test and your sample, and check the hotplate.', sources: ['LA-8200'] },
    { topic: 'Without PEB', text: 'Without a PEB Medusa 82 needs about 1300 µC/cm² at 30 kV and 4000 µC/cm² at 100 kV (Allresist). The library models PEB processes only.', sources: ['AR-8200'] },
    { topic: 'Disagreement', text: 'Allresist gives E0 = 60 µC/cm² at 30 kV after a 170 °C PEB (E0 not defined); DTU\'s eLINE needs ≈ 150–180 µC/cm² for full thickness. The difference (2.5–3×) is not explained by the sources: do a dose test.', sources: ['AR-8200', 'LA-8200'] },
    { topic: 'Resolution, etch, storage', text: 'Resolution 10 / 13 / 20 nm (.03 / .06 / .18). Etch: O₂ 6 nm/min, CF₄+O₂ 220 nm/min. Store at 8–12 °C (6 months); coated wafers keep for weeks, and exposed wafers can be developed even after 21 days without a significant loss of sensitivity. Medusa 82 UV (AR-N 8250, with a photoacid generator) is 5–20× more sensitive — not stocked at DTU.', sources: ['AR-8200', 'AR-MNE'] },
  ],
};

// ===================================================================== AR-P 617 (PMMA-co-MA copolymer)
// The copolymer bottom layer of lift-off double layers (DTU: under CSAR). DTU measured contrast curves at
// 100 kV after softbakes of 160 / 180 / 200 °C; the bake is this entry's extra condition (bakeC).
const BAKE = (bakeC) => ({ prebake: `${bakeC} °C 120 s`, bakeC });
const p617 = (bakeC, summary) => ds(`dtu-100kV-bake${bakeC}`, 'positive', summary, C(100, 295, 'AR600_50', 90, 21, BAKE(bakeC)), 'measured',
  { lab: 'DTU Nanolab', tool: 'JEOL JBX-9500', sources: ['LA-617'], note: `AR-P 617.06 at 4000 rpm (≈ 295 nm), softbake ${bakeC} °C; AR 600-50 90 s, IPA 30 s; D50 and clearing read from the LabAdviser plot (approximate); development temperature not stated (21 °C assumed); the normalised thickness is already ≈ 0.93–0.96 at 5 µC/cm²` });
const p617Ref = p617(200, { d50: 50, done: 75 });
const ARP617 = {
  id: 'ARP617', name: 'AR-P 617 (copolymer)', product: 'Allresist AR-P 617.03 / .06 / .08 (PMMA-co-methacrylic acid; 90 / 290 / 480 nm at 4000 rpm)', supplier: 'Allresist', tone: 'positive', family: 'PMMA-co-MA copolymer — more sensitive than PMMA, the bottom layer of lift-off double layers', atDTU: true,
  summary: 'A PMMA copolymer, 3–4× more sensitive than PMMA, used as the bottom layer of double-layer stacks: under CSAR (DTU\'s recipe) or PMMA it develops wider and leaves the undercut that lift-off needs. DTU measured its contrast curve at 100 kV after three softbake temperatures; its dose depends on that bake.',
  sources: {
    'LA-617': { cite: 'DTU Nanolab LabAdviser: AR-P 617 (spin curve, 100 kV contrast curves at 160 / 180 / 200 °C bake, bilayer under CSAR, 2024)', url: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/AR-P_617', kind: 'labadviser' },
    'AR-617': { cite: 'Allresist, Product information AR-P 610 series / AR-P 617', url: 'https://www.allresist.com/wp-content/uploads/sites/2/2020/03/AR-P610_english_Allresist_product-information.pdf', kind: 'datasheet' },
  },
  window: { kV: [20, 100], thicknessNm: [90, 480], developers: ['AR600_50'], timeS: [60, 120], tempC: [20, 23], bakeC: [160, 200], sources: ['LA-617', 'AR-617'] },
  model: {
    ref: { ...ref(p617Ref), bakeC: 200 }, refBasis: 'measured at DTU (100 kV, ≈ 295 nm, softbake 200 °C, AR 600-50 90 s)', refUncertainty: 0.15, refSources: ['LA-617'], density: 1.2,
    nE: { value: 0.9, sd: 0.2, sources: [] },
    p: { value: 0.2, sd: 0.15, sources: [] },
    q: { value: 0.25, sd: 0.15, sources: [] },
    EDeV: { value: 0.2, sd: 0.15, sources: [] }, TsatC: -20,
    cGamma: { value: 0, sd: 0.03, sources: [] },
    // the sixth condition: the softbake temperature. DTU's series: hotter bake, MORE dose (+1 %/°C);
    // Allresist states the opposite (80 → 58 µC/cm² from 180 → 210 °C for 617.08): the spread covers both
    extra: [{ key: 'bakeC', name: 'softbake', short: 'bake', unit: '°C', value: 0.011, sd: 0.012, tol: 3, law: 'D₁₀₀ ∝ exp[k·(T_bake − T_ref)]', param: 'k (per °C)',
      note: 'from DTU\'s 160 / 180 / 200 °C series (clearing ≈ 50 → 65 → 75 µC/cm²); Allresist reports the opposite trend — the spread covers both', sources: ['LA-617', 'AR-617'] }],
    developers: {},
    notes: 'Only the developer DTU used (AR 600-50) is known: others are unsupported. Voltage, time, thickness and temperature laws are generic placeholders with wide errors — no data. Allresist\'s 20 kV value (30 µC/cm², on 500 nm lines) is in the datasets for comparison.',
  },
  datasets: [
    p617Ref,
    p617(180, { d50: 45, done: 65 }),
    p617(160, { d50: 31, done: 50 }),
    ds('allresist-20kV-lines', 'positive', { done: 30 }, C(20, 290, 'AR600_50', 60, 21, BAKE(180)), 'datasheet', { sources: ['AR-617'], note: 'E0 = 30 µC/cm² for AR-P 617.06 at 20 kV on 500 nm lines; bake and development time not stated (180 °C and 60 s assumed)' }),
  ],
  advice: [
    { topic: 'At DTU: the bilayer under CSAR', text: 'AR-P 617 at 4000 rpm, bake 200 °C 120 s (≈ 295 nm); then CSAR (250 nm, Gamma recipe 2325-DCH). Expose 400 µC/cm² at 100 kV (29 nA). Develop ZED-N50 90 s for the CSAR, then AR 600-50 90 s and IPA 30 s for the copolymer; a longer AR 600-50 step gives more undercut (≈ 70–90 nm per side in DTU\'s SEM image).', sources: ['LA-617'] },
    { topic: 'The bake', text: 'DTU measured the copolymer less sensitive after a hotter bake (clearing ≈ 50 / 65 / 75 µC/cm² after 160 / 180 / 200 °C; contrast 4.3 / 4.2 / 3.7); Allresist states the opposite. Keep the bake of your dose test.', sources: ['LA-617', 'AR-617'] },
    { topic: 'Sensitivity', text: 'About 3–4× more sensitive than PMMA (Allresist); contrast ≈ 5–6 in Allresist\'s definition. Its curve starts dropping at very low doses (≈ 0.95 of the film left at 5 µC/cm²): the halo of the top layer\'s exposure develops it too — that is the undercut.', sources: ['AR-617', 'LA-617'] },
  ],
};

// ---- the test structures, as the sources state them (see model.js structureVerdict). A clearing dose is
// the large-area value only on pads ≫ β; most sources do not say — then 'unknown', never a guess.
const STATED = {
  CSAR: {
    'dtu-100kV-188nm': { kind: 'lines', text: '100 nm lines with 300 nm spaces (LabAdviser, CSAR contrast curves, Feb–Mar 2016)' },
    'dtu-100kV-70nm': { kind: 'lines', text: '100 nm lines with 300 nm spaces (LabAdviser, Feb–Mar 2016)' },
    'dtu-100kV-900nm-30s': { kind: 'lines', text: '100 nm lines with 300 nm spaces (LabAdviser, June 2016)' },
    'dtu-100kV-900nm-60s': { kind: 'lines', text: '100 nm lines with 300 nm spaces (LabAdviser, June 2016)' },
    'dtu-100kV-900nm-90s': { kind: 'lines', text: '100 nm lines with 300 nm spaces (LabAdviser, June 2016)' },
    'dtu-eline-30kV': { kind: 'unknown', text: 'area elements of the eLINE Demo.csf dose test; their size is not stated' },
    'dtu-eline-20kV': { kind: 'unknown', text: 'area elements of the eLINE Demo.csf dose test; their size is not stated' },
    'dtu-eline-10kV': { kind: 'unknown', text: 'area elements of the eLINE Demo.csf dose test; their size is not stated' },
  },
  MREBL: { 'dtu-100kV-lines': { kind: 'lines', text: '100 nm lines at 4 µm pitch (DTU report, Tiddi 2015)' } },
  ARN7520: { 'dtu-100kV-7520.17new': { kind: 'unknown', text: 'not stated on LabAdviser' } },
  MEDUSA: { 'dtu-eline-30kV-peb170': { kind: 'unknown', text: 'area elements of the eLINE dose test; their size is not stated' }, ...Object.fromEntries([170, 160, 150, 130].map((t) => [`dtu-100kV-peb${t}`, { kind: 'pads', sizeUm: 150, text: '150 µm × 300 µm rectangles (LabAdviser, AR-N 8200)' }])) },
};
for (const r of [CSAR, ZEP, PMMA, PMMA50K, ARP617, HSQ, MREBL, ARN7520, MEDUSA]) {
  for (const d of r.datasets) d.structure = STATED[r.id]?.[d.id] || { kind: 'unknown', text: d.quality === 'estimate' ? 'a best guess assembled from several sources' : 'not stated in the source' };
  // the reference curve carries the structure of the dataset it was taken from
  const from = r.datasets.find((d) => d.conditions.kV === r.model.ref.kV && d.conditions.thicknessNm === r.model.ref.thicknessNm && d.conditions.developer === r.model.ref.developer && d.conditions.timeS === r.model.ref.timeS);
  r.model.refStructure = from ? from.structure : { kind: 'unknown', text: 'a best guess' };
}

export const BUILTIN_RESISTS = [CSAR, ZEP, PMMA, PMMA50K, ARP617, HSQ, MREBL, ARN7520, MEDUSA];
