// Fab Studio materials (ported unchanged from the Micro and Nanofabrication Studio v2, l.727–793
// and l.1602–1609). The numeric ids are part of saved recipes and of the voxel grid, so they
// must not change.

export const M = {
  AIR: 0, RESIST: 1, RESIST_EXP: 2, METAL: 3, POLYSI: 4, SIO2: 5, SI3N4: 6, SI: 7,
  PMMA: 8, PMMA_EXP: 9, CSAR: 10, CSAR_EXP: 11, MEDUSA: 12, MEDUSA_EXP: 13,
  S1813: 14, S1813_EXP: 15, AZ5214E: 16, AZ5214E_EXP: 17, SU8: 18, SU8_EXP: 19, MAN2400: 20, MAN2400_EXP: 21,
  GRAPHENE: 22, MOS2: 23, HBN: 24, AU: 25, CR: 26, AL: 27,
};

export const MAT_NAMES = ['Air', 'Resist', 'Resist (exposed)', 'Metal', 'Poly-Si', 'SiO₂', 'Si₃N₄', 'Si',
  'PMMA', 'PMMA (exposed)', 'CSAR', 'CSAR (exposed)', 'MEDUSA', 'MEDUSA (exposed)',
  'S1813', 'S1813 (exposed)', 'AZ5214E', 'AZ5214E (exposed)', 'SU-8', 'SU-8 (exposed)', 'ma-N 2400', 'ma-N 2400 (exposed)',
  'Graphene', 'MoS₂', 'hBN', 'Au', 'Cr', 'Al'];

export const MAT_COLOR = [
  [255, 255, 255], [255, 170, 195], [255, 120, 160], [180, 190, 210], [160, 140, 120], [140, 210, 245], [180, 230, 180], [70, 80, 95],
  [255, 190, 160], [235, 130, 100], [200, 175, 240], [155, 120, 210], [150, 225, 210], [95, 185, 170],
  [255, 236, 153], [234, 196, 72], [255, 214, 170], [239, 161, 95], [198, 255, 184], [119, 209, 100], [174, 235, 214], [103, 197, 173],
  [128, 128, 128], [245, 220, 80], [110, 165, 255], [222, 178, 74], [205, 209, 215], [130, 136, 150],
];

// step-param material names → M (METAL kept for legacy recipes)
export const MAT_MAP = { METAL: M.AU, AU: M.AU, CR: M.CR, AL: M.AL, POLYSI: M.POLYSI, SIO2: M.SIO2, SI3N4: M.SI3N4, SI: M.SI, GRAPHENE: M.GRAPHENE, MOS2: M.MOS2, HBN: M.HBN };
export const RESIST_MAT_MAP = { PMMA: M.PMMA, CSAR: M.CSAR, MEDUSA: M.MEDUSA, S1813: M.S1813, AZ5214E: M.AZ5214E, SU8: M.SU8, MAN2400: M.MAN2400, custom: M.RESIST };

export const isMetal = (m) => m === M.AU || m === M.CR || m === M.AL || m === M.METAL;
export const is2DFlakeMaterial = (m) => m === M.GRAPHENE || m === M.MOS2 || m === M.HBN;
export const isSF6Etchable = (m) => m === M.MOS2 || m === M.HBN;

const UNEXP = new Set([M.RESIST, M.PMMA, M.CSAR, M.MEDUSA, M.S1813, M.AZ5214E, M.SU8, M.MAN2400]);
const EXP = new Set([M.RESIST_EXP, M.PMMA_EXP, M.CSAR_EXP, M.MEDUSA_EXP, M.S1813_EXP, M.AZ5214E_EXP, M.SU8_EXP, M.MAN2400_EXP]);
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

// {type, dose (suggested exposure), contrast γ, D100, darkErosion nm/min, sidewall °, scum nm, developers}
export const RESIST_PRESETS = {
  PMMA:    { type: 'positive', dose: 500, contrast: 7,   D100: 450, darkErosion: 2,   sidewall: 90, scum: 2,   developers: ['MIBK_IPA', 'IPA'] },
  CSAR:    { type: 'positive', dose: 300, contrast: 5,   D100: 250, darkErosion: 1.5, sidewall: 90, scum: 1,   developers: ['MIBK_IPA', 'IPA'] },
  MEDUSA:  { type: 'negative', dose: 350, contrast: 10,  D100: 300, darkErosion: 0.5, sidewall: 90, scum: 0.5, developers: ['MIBK_IPA', 'IPA'] },
  S1813:   { type: 'positive', dose: 90,  contrast: 2.5, D100: 95,  darkErosion: 4,   sidewall: 90, scum: 2,   developers: ['MF319', 'AZ400K'] },
  AZ5214E: { type: 'negative', dose: 70,  contrast: 2.2, D100: 85,  darkErosion: 3.5, sidewall: 90, scum: 2,   developers: ['AZ400K', 'MF319'] },
  SU8:     { type: 'negative', dose: 180, contrast: 1.8, D100: 220, darkErosion: 0.8, sidewall: 90, scum: 0.5, developers: ['SU8_DEV'] },
  MAN2400: { type: 'negative', dose: 120, contrast: 2.1, D100: 140, darkErosion: 1.2, sidewall: 90, scum: 1,   developers: ['MAD525'] },
};
export const RESIST_LABELS = { PMMA: 'PMMA (positive)', CSAR: 'CSAR 62 (positive)', MEDUSA: 'MEDUSA 82 (negative)', S1813: 'S1813 (UV, positive)', AZ5214E: 'AZ5214E (UV, image reversal)', SU8: 'SU-8 (UV, negative)', MAN2400: 'ma-N 2400 (UV, negative)', custom: 'Custom…' };
export const DEVELOPERS = { MIBK_IPA: 'MIBK:IPA 1:3', IPA: 'IPA stop / rinse', MF319: 'MF-319 / AZ MIF', AZ400K: 'AZ 400K (diluted)', SU8_DEV: 'PGMEA (SU-8 developer)', MAD525: 'ma-D 525' };

export const DEPOSIT_MATERIALS = { AU: 'Au — gold', CR: 'Cr — chromium', AL: 'Al — aluminium', SIO2: 'SiO₂', POLYSI: 'Poly-Si', SI3N4: 'Si₃N₄' };
export const ETCH_MATERIALS = { SIO2: 'SiO₂', SI: 'Si', POLYSI: 'Poly-Si', SI3N4: 'Si₃N₄', AU: 'Au', CR: 'Cr', AL: 'Al' };
export const TRANSFER_MATERIALS = { GRAPHENE: 'Graphene', MOS2: 'MoS₂', HBN_GRAPHENE_HBN: 'hBN / graphene / hBN stack' };
