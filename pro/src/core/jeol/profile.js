// Machine profile: JEOL JBX-9500FS at DTU Nanolab (100 kV).
//
// Data, not code: the time-model constants were fitted to JEOL's own write-time estimates (wrtest
// CSVs) of jobs written on this machine, by the EBL Writing Time & Pattern Estimator v2
// (EBL Workbench/JEOL analysis module, PLAN_v2.md §4). The beam conditions (CALPRM files) and the
// file rules are from DTU Nanolab's LabAdviser page "JEOL job preparation" (October 2026).
// When new wrtest CSVs come in, refit and change the numbers here — nothing else depends on them.

export const JBX9500_DTU = {
  id: 'jbx9500fs-dtu',
  name: 'JEOL JBX-9500FS',
  site: 'DTU Nanolab',
  kV: 100,
  source: 'Time model fitted to JEOL wrtest estimates of DTU jobs (EBL Estimator v2, Oct 2026); beam conditions and file rules from LabAdviser, JEOL job preparation.',
  labAdviser: 'https://labadviser.nanolab.dtu.dk/index.php?title=Specific_Process_Knowledge/Lithography/EBeamLithography/JEOLJobPreparation',

  // ---- writing
  pitchUnitNm: 0.25,            // SHOT A,n: the beam pitch in units of 0.25 nm
  minShotNs: 10,                // 100 MHz scanner: no shot shorter than 10 ns
  stdcurOverNominal: 1.1,       // STDCUR ≈ 10 % above the nominal current (LabAdviser); 12 nA → 13.2
  fieldUm: 1000,                // main (writing) field in 2-deflector mode
  subfieldUm: 4.095,            // subfield used to estimate the number of figures (BEAMER's default)
  maxRanks: 256,                // shot-time modulation ranks a MODULAT table may hold (assumed; check before relying on it)

  // ---- time model (seconds), fitted to wrtest CSVs
  time: {
    figureOverheadS: 1.2e-6,    // per subfield figure (settling)
    stageMoveS: 0.49,           // per writing-field stage move
    stageLayerS: 6,             // per layer
    initialCurrntS: 10,         // INITIAL calibration: CURRNT
    initialHeimapS: 240,        // INITIAL calibration: HEIMAP (height map; part of DRF5M's INITIAL, FFOCUS or not)
    cyclicPeriodS: 296,         // DRF5M: cyclic calibrations = floor(writing time / 296 s) + 1
    cyclicCycleS: 16,           // each: CURRNT 10 s + DRIFT 6 s
    cassettePreS: 10,           // cassette preprocessing
    currentChangeS: 96,         // extra when the CALPRM differs from the previous layer's
    layerEndS: 1,
    dataTransferS: 1,
    transportS: 930,            // material transport (autoloader → stage and back): 15:30 in the one
                                // CSV that has it; it depends on the shelf, so it is shown apart
  },

  // ---- beam conditions: CALPRM files (LabAdviser table, Oct 2026). '12na_ap6' is not in that
  // table but was used in a DTU job (frdr_ShapeMatrix_v2, Oct 2026); both are offered.
  calprm: [
    ['0.12na_ap4', 0.12], ['0.16na_ap4', 0.16], ['0.22na_ap4', 0.22], ['0.4na_ap4', 0.4], ['0.5na_ap4', 0.5],
    ['0.8na_ap4', 0.8], ['1.4na_ap4', 1.4], ['1.6na_ap4', 1.6], ['2na_ap4', 2], ['2.7na_ap4', 2.7],
    ['3.8na_ap5', 3.8], ['4na_ap4', 4], ['5na_ap5', 5], ['6na_ap5', 6], ['10na_ap6', 10],
    ['12na_ap5', 12], ['12na_ap6', 12], ['14na_ap8', 14], ['19na_ap7', 19], ['21na_ap7', 21],
    ['22na_ap7', 22], ['25na_ap7', 25], ['27na_ap7', 27], ['29na_ap7', 29], ['30na_ap8', 30],
    ['36na_ap8', 36], ['41na_ap8', 41], ['44na_ap8', 44], ['54na_ap7', 54], ['60na_ap8', 60],
  ].map(([name, nA]) => ({ name, nA, aperture: +/_ap(\d+)/.exec(name)[1] })),

  paths: ['DRF5M'],             // calibration routine (PATH); DRF5M: INITIAL CURRNT,HEIMAP; CYCLIC CURRNT,DRIFT every 5 min
  waferInches: [2, 3, 4, 6, 8], // JOB/W 'name', d (chip cassettes at DTU are converted 3" cassettes: 3)
  patternDir: '/home/eb0/jeoleb/pattern/danchipv30',

  // ---- file rules (LabAdviser)
  rules: {
    magazine: { re: /^[A-Z][A-Z0-9]{0,8}$/, text: 'MAGAZIN name: uppercase letters and digits, at most 9, starting with a letter' },
    jdf: { re: /^[a-z0-9_]{1,24}$/, text: 'JDF file name: at most 24 characters, no capitals, no spaces (letters, digits, _)' },
    job: { re: /^[A-Z0-9]{0,9}$/, text: 'JOB name: at most 9 uppercase letters and digits' },
    v30: { re: /^[A-Za-z0-9_]{1,40}\.v30$/i, text: 'pattern file: letters, digits and _, ending in .v30' },
  },
};

export const MACHINES = { [JBX9500_DTU.id]: JBX9500_DTU };
