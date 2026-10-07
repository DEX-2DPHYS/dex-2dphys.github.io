// Fab Studio materials (ported unchanged from the Micro and Nanofabrication Studio v2, l.727–793
// and l.1602–1609). The numeric ids are part of saved recipes and of the voxel grid, so they
// must not change. Ids 28–35: the resist library's resists not in the studio (2026-10-07).

import { BUILTIN_RESISTS, DEV_NAMES } from '../resists/builtin.js';

export const M = {
  AIR: 0, RESIST: 1, RESIST_EXP: 2, METAL: 3, POLYSI: 4, SIO2: 5, SI3N4: 6, SI: 7,
  PMMA: 8, PMMA_EXP: 9, CSAR: 10, CSAR_EXP: 11, MEDUSA: 12, MEDUSA_EXP: 13,
  S1813: 14, S1813_EXP: 15, AZ5214E: 16, AZ5214E_EXP: 17, SU8: 18, SU8_EXP: 19, MAN2400: 20, MAN2400_EXP: 21,
  GRAPHENE: 22, MOS2: 23, HBN: 24, AU: 25, CR: 26, AL: 27,
  ZEP: 28, ZEP_EXP: 29, HSQ: 30, HSQ_EXP: 31, MREBL: 32, MREBL_EXP: 33, ARN7520: 34, ARN7520_EXP: 35,
  PMMA50K: 36, PMMA50K_EXP: 37,
};

export const MAT_NAMES = ['Air', 'Resist', 'Resist (exposed)', 'Metal', 'Poly-Si', 'SiO₂', 'Si₃N₄', 'Si',
  'PMMA', 'PMMA (exposed)', 'CSAR', 'CSAR (exposed)', 'MEDUSA', 'MEDUSA (exposed)',
  'S1813', 'S1813 (exposed)', 'AZ5214E', 'AZ5214E (exposed)', 'SU-8', 'SU-8 (exposed)', 'ma-N 2400', 'ma-N 2400 (exposed)',
  'Graphene', 'MoS₂', 'hBN', 'Au', 'Cr', 'Al',
  'ZEP 520A', 'ZEP 520A (exposed)', 'HSQ', 'HSQ (exposed)', 'mr-EBL 6000', 'mr-EBL 6000 (exposed)', 'AR-N 7520', 'AR-N 7520 (exposed)', 'PMMA 50K', 'PMMA 50K (exposed)'];

export const MAT_COLOR = [
  [255, 255, 255], [255, 170, 195], [255, 120, 160], [180, 190, 210], [160, 140, 120], [140, 210, 245], [180, 230, 180], [168, 176, 188],
  [255, 190, 160], [235, 130, 100], [200, 175, 240], [155, 120, 210], [150, 225, 210], [95, 185, 170],
  [255, 236, 153], [234, 196, 72], [255, 214, 170], [239, 161, 95], [198, 255, 184], [119, 209, 100], [174, 235, 214], [103, 197, 173],
  [128, 128, 128], [245, 220, 80], [110, 165, 255], [222, 178, 74], [205, 209, 215], [130, 136, 150],
  [225, 195, 250], [175, 135, 228], [208, 228, 252], [145, 185, 238], [255, 205, 218], [226, 140, 165], [242, 226, 188], [206, 176, 112],
  [255, 222, 200], [242, 168, 140],
];

// step-param material names → M (METAL kept for legacy recipes)
export const MAT_MAP = { METAL: M.AU, AU: M.AU, CR: M.CR, AL: M.AL, POLYSI: M.POLYSI, SIO2: M.SIO2, SI3N4: M.SI3N4, SI: M.SI, GRAPHENE: M.GRAPHENE, MOS2: M.MOS2, HBN: M.HBN };
export const RESIST_MAT_MAP = { PMMA: M.PMMA, CSAR: M.CSAR, MEDUSA: M.MEDUSA, S1813: M.S1813, AZ5214E: M.AZ5214E, SU8: M.SU8, MAN2400: M.MAN2400, ZEP: M.ZEP, HSQ: M.HSQ, MREBL: M.MREBL, ARN7520: M.ARN7520, PMMA50K: M.PMMA50K, custom: M.RESIST };

export const isMetal = (m) => m === M.AU || m === M.CR || m === M.AL || m === M.METAL;
export const is2DFlakeMaterial = (m) => m === M.GRAPHENE || m === M.MOS2 || m === M.HBN;
export const isSF6Etchable = (m) => m === M.MOS2 || m === M.HBN;

const UNEXP = new Set([M.RESIST, M.PMMA, M.CSAR, M.MEDUSA, M.S1813, M.AZ5214E, M.SU8, M.MAN2400, M.ZEP, M.HSQ, M.MREBL, M.ARN7520, M.PMMA50K]);
const EXP = new Set([M.RESIST_EXP, M.PMMA_EXP, M.CSAR_EXP, M.MEDUSA_EXP, M.S1813_EXP, M.AZ5214E_EXP, M.SU8_EXP, M.MAN2400_EXP, M.ZEP_EXP, M.HSQ_EXP, M.MREBL_EXP, M.ARN7520_EXP, M.PMMA50K_EXP]);
export const isResistUnexp = (m) => UNEXP.has(m);
export const isResistExp = (m) => EXP.has(m);
export const isResist = (m) => UNEXP.has(m) || EXP.has(m);
export const toExposed = (m) => (UNEXP.has(m) ? m + 1 : m);
export const toUnexposed = (m) => (EXP.has(m) ? m - 1 : m);

export function resistPresetOf(m) {
  for (const [name, id] of Object.entries(RESIST_MAT_MAP)) if (name !== 'custom' && (m === id || m === id + 1)) return name;
  return 'custom';
}
export function isResistOfType(m, name) {
  const base = RESIST_MAT_MAP[name];
  if (!base) return isResist(m);
  return m === base || m === toExposed(base);
}

export const GRAPHENE_ML_NM = 0.34;

// {type, dose (suggested exposure), contrast γ, D100, darkErosion nm/min, sidewall °, scum nm, developers,
//  cal: the development the contrast curve belongs to — {developer, timeS, tempC}}
// The numbers are illustrative (the studio's teaching values), not a calibration of any one lab's
// process: a contrast curve holds only for the developer, time and temperature it was measured with.
export const RESIST_PRESETS = {
  PMMA:    { type: 'positive', dose: 500, contrast: 7,   D100: 450, darkErosion: 2,   sidewall: 90, scum: 2,   developers: ['MIBK_IPA', 'IPA'], cal: { developer: 'MIBK_IPA', timeS: 60, tempC: 21 } },
  // low molecular weight PMMA, the bottom of a double layer: ≈ 0.75 × 950K's dose, a little softer, dissolves faster
  PMMA50K: { type: 'positive', dose: 380, contrast: 5.5, D100: 340, darkErosion: 3,   sidewall: 90, scum: 2,   developers: ['MIBK_IPA', 'IPA'], cal: { developer: 'MIBK_IPA', timeS: 60, tempC: 21 } },
  CSAR:    { type: 'positive', dose: 300, contrast: 5,   D100: 250, darkErosion: 1.5, sidewall: 90, scum: 1,   developers: ['MIBK_IPA', 'IPA'], cal: { developer: 'MIBK_IPA', timeS: 60, tempC: 21 } },
  MEDUSA:  { type: 'negative', dose: 350, contrast: 10,  D100: 300, darkErosion: 0.5, sidewall: 90, scum: 0.5, developers: ['MIBK_IPA', 'IPA'], cal: { developer: 'MIBK_IPA', timeS: 60, tempC: 21 } },
  S1813:   { type: 'positive', dose: 90,  contrast: 2.5, D100: 95,  darkErosion: 4,   sidewall: 90, scum: 2,   developers: ['MF319', 'AZ400K'], cal: { developer: 'MF319', timeS: 60, tempC: 21 } },
  AZ5214E: { type: 'negative', dose: 70,  contrast: 2.2, D100: 85,  darkErosion: 3.5, sidewall: 90, scum: 2,   developers: ['AZ400K', 'MF319'], cal: { developer: 'AZ400K', timeS: 60, tempC: 21 } },
  SU8:     { type: 'negative', dose: 180, contrast: 1.8, D100: 220, darkErosion: 0.8, sidewall: 90, scum: 0.5, developers: ['SU8_DEV'], cal: { developer: 'SU8_DEV', timeS: 60, tempC: 21 } },
  MAN2400: { type: 'negative', dose: 120, contrast: 2.1, D100: 140, darkErosion: 1.2, sidewall: 90, scum: 1,   developers: ['MAD525'], cal: { developer: 'MAD525', timeS: 60, tempC: 21 } },
};
// Fab Studio's two levels. LEARNING: the studio's generic teaching resists and developers (the presets
// above). ADVANCED: the resist library's resists and their curves (each with the conditions it was
// measured at); a development or film away from a curve's conditions is moved by the library's model.
// Film properties the library does not hold, per resist: dark erosion (nm/min) and scum (nm).
const LIB_FILM = { PMMA50K: { darkErosion: 1, scum: 2 }, CSAR: { darkErosion: 0.1, scum: 1 }, ZEP: { darkErosion: 0.3, scum: 1 }, PMMA: { darkErosion: 0.5, scum: 2 }, HSQ: { darkErosion: 0.1, scum: 0.5 }, MEDUSA: { darkErosion: 0.1, scum: 0.5 }, MREBL: { darkErosion: 0.3, scum: 0.5 }, ARN7520: { darkErosion: 0.5, scum: 0.5 } };
export const FAB_LEVELS = { learning: 'Learning', advanced: 'Advanced' };
// The e-beam resists of the resist library (core/resists/builtin.js): the library's reference curve
// and development, so Fab Studio, Analysis and the Resists tab agree. `lib` ties a preset to the
// library's model, which the develop step uses to move the curve to another development.
function fromLibrary(id, { darkErosion, scum } = LIB_FILM[id]) {
  const r = BUILTIN_RESISTS.find((x) => x.id === id), ref = r.model.ref, sig = (v) => +v.toPrecision(3);
  const clear = ref.D100 * (1 + 0.27 * (ref.round ?? 0.5));
  return { type: r.tone, dose: sig(1.15 * clear), contrast: +ref.gamma.toFixed(2), D100: sig(ref.D100), soft: +(ref.round ?? 0.5).toFixed(2), darkErosion, sidewall: 90, scum,
    developers: [...new Set([ref.developer, ...(r.window?.developers || []), ...Object.keys(r.model.developers || {})])], cal: { developer: ref.developer, timeS: ref.timeS, tempC: ref.tempC }, lib: id, thicknessNm: ref.thicknessNm, calKV: ref.kV };
}
// dark erosion (nm/min, unexposed film in the developer; > 0: the spin form reads 0 as its default)
// and scum (nm): DTU/Allresist for CSAR (≈ 0.1 nm/min in AR 600-546), small elsewhere
// the studio's own resists (Learning); then the library's (Advanced) — CSAR and PMMA exist in both, as
// different presets: the studio's teaching values, and the library's DTU-anchored curves
export const LEARNING_RESISTS = Object.keys(RESIST_PRESETS);
export const LIBRARY_PRESETS = Object.fromEntries(BUILTIN_RESISTS.map((r) => [r.id, fromLibrary(r.id)]));
for (const [k, p] of Object.entries(LIBRARY_PRESETS)) if (!RESIST_PRESETS[k]) RESIST_PRESETS[k] = p;   // ZEP, HSQ, MREBL, ARN7520
// the preset a resist on the sample answers to: its library entry when the spin step chose one
export const presetOf = (name, lib) => (lib && LIBRARY_PRESETS[lib]) || RESIST_PRESETS[name];
export const RESIST_LABELS = { PMMA: 'PMMA (positive)', PMMA50K: 'PMMA 50K, low MW (positive; bilayer bottom)', CSAR: 'CSAR 62 (positive)', ZEP: 'ZEP 520A (positive)', HSQ: 'HSQ (negative)', MREBL: 'mr-EBL 6000 (negative)', ARN7520: 'AR-N 7520 New (negative)', MEDUSA: 'MEDUSA 82 (negative)', S1813: 'S1813 (UV, positive)', AZ5214E: 'AZ5214E (UV, image reversal)', SU8: 'SU-8 (UV, negative)', MAN2400: 'ma-N 2400 (UV, negative)', custom: 'Custom…' };
export const DEVELOPERS = { MIBK_IPA: 'MIBK:IPA 1:3', IPA: 'IPA stop / rinse', MF319: 'MF-319 / AZ MIF', AZ400K: 'AZ 400K (diluted)', SU8_DEV: 'PGMEA (SU-8 developer)', MAD525: 'ma-D 525' };
export const STUDIO_DEVELOPERS = { ...DEVELOPERS };
// and the resist library's developers (the studio's own names win)
for (const [k, v] of Object.entries(DEV_NAMES)) if (!(k in DEVELOPERS)) DEVELOPERS[k] = v;

export const DEPOSIT_MATERIALS = { AU: 'Au — gold', CR: 'Cr — chromium', AL: 'Al — aluminium', SIO2: 'SiO₂', POLYSI: 'Poly-Si', SI3N4: 'Si₃N₄' };
export const ETCH_MATERIALS = { SIO2: 'SiO₂', SI: 'Si', POLYSI: 'Poly-Si', SI3N4: 'Si₃N₄', AU: 'Au', CR: 'Cr', AL: 'Al' };
export const TRANSFER_MATERIALS = { GRAPHENE: 'Graphene', MOS2: 'MoS₂', HBN_GRAPHENE_HBN: 'hBN / graphene / hBN stack' };
