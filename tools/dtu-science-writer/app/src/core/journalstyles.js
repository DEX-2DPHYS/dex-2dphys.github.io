/* Journal styles: one choice sets what a journal asks of a submitted manuscript — heading numbering, "Fig." or
   "Figure", line spacing, line numbers and the reference style. Fonts, sizes and colours stay as the author chose.

   The values are starting points taken from the publishers' author guidelines as generally known; guidelines change,
   so the dialog tells the user to check the journal's current guide. Only what the app can set is listed here.
   A journal that is not in this list still gets its reference style from the CSL repository (ui/journaldialog.js).

   Add a journal: one line in JOURNALS. Add a publisher: one entry in FAMILIES. */

const NONE = ['none', 'none', 'none', 'none'];
const DECIMAL = ['1', '1', '1', '1'];
const ROMAN = ['I', 'A', '1', 'a'];          // I. INTRODUCTION / A. Methods / 1. Samples / a. Details

export const FAMILIES = {
  aps: { label: 'American Physical Society', nums: ROMAN, figLabel: 'Fig.', spacing: 1, lineNumbers: false, cite: 'aps' },
  aip: { label: 'AIP Publishing', nums: ROMAN, figLabel: 'Fig.', spacing: 2, lineNumbers: false, cite: 'aip' },
  nature: { label: 'Nature Portfolio', nums: NONE, figLabel: 'Fig.', spacing: 2, lineNumbers: false, cite: 'nature' },
  science: { label: 'Science (AAAS)', nums: NONE, figLabel: 'Fig.', spacing: 2, lineNumbers: true, cite: 'science' },
  acs: { label: 'American Chemical Society', nums: NONE, figLabel: 'Figure', spacing: 2, lineNumbers: false, cite: 'acs' },
  iop: { label: 'IOP Publishing', nums: DECIMAL, figLabel: 'Figure', spacing: 1, lineNumbers: false, cite: 'iop' },
  wiley: { label: 'Wiley', nums: DECIMAL, figLabel: 'Figure', spacing: 2, lineNumbers: false, cite: 'advmat' },
  elsevier: { label: 'Elsevier', nums: DECIMAL, figLabel: 'Fig.', spacing: 2, lineNumbers: true, cite: 'elsevier' },
  rsc: { label: 'Royal Society of Chemistry', nums: DECIMAL, figLabel: 'Fig.', spacing: 1, lineNumbers: false, cite: 'rsc' },
  pnas: { label: 'PNAS', nums: NONE, figLabel: 'Fig.', spacing: 1, lineNumbers: true, cite: 'pnas' },
  ieee: { label: 'IEEE', nums: ROMAN, figLabel: 'Fig.', spacing: 1, lineNumbers: false, cite: 'ieee' },
  plain: { label: 'General', nums: DECIMAL, figLabel: 'Fig.', spacing: 1, lineNumbers: false, cite: 'aps' },
};

/* [id, name, family, reference style if not the family's] */
const LIST = [
  ['plain-article', 'Plain article (preprint, arXiv)', 'plain'],
  ['physical-review-letters', 'Physical Review Letters', 'aps'],
  ['physical-review-b', 'Physical Review B', 'aps'],
  ['physical-review-x', 'Physical Review X', 'aps'],
  ['physical-review-applied', 'Physical Review Applied', 'aps'],
  ['physical-review-materials', 'Physical Review Materials', 'aps'],
  ['physical-review-research', 'Physical Review Research', 'aps'],
  ['nature', 'Nature', 'nature'],
  ['nature-nanotechnology', 'Nature Nanotechnology', 'nature'],
  ['nature-materials', 'Nature Materials', 'nature'],
  ['nature-physics', 'Nature Physics', 'nature'],
  ['nature-electronics', 'Nature Electronics', 'nature'],
  ['nature-communications', 'Nature Communications', 'nature'],
  ['npj-2d-materials-and-applications', 'npj 2D Materials and Applications', 'nature'],
  ['communications-physics', 'Communications Physics', 'nature'],
  ['science', 'Science', 'science'],
  ['science-advances', 'Science Advances', 'science'],
  ['nano-letters', 'Nano Letters', 'acs'],
  ['acs-nano', 'ACS Nano', 'acs'],
  ['acs-applied-materials-and-interfaces', 'ACS Applied Materials & Interfaces', 'acs'],
  ['acs-photonics', 'ACS Photonics', 'acs'],
  ['chemistry-of-materials', 'Chemistry of Materials', 'acs'],
  ['the-journal-of-physical-chemistry-c', 'The Journal of Physical Chemistry C', 'acs'],
  ['applied-physics-letters', 'Applied Physics Letters', 'aip'],
  ['journal-of-applied-physics', 'Journal of Applied Physics', 'aip'],
  ['apl-materials', 'APL Materials', 'aip'],
  ['review-of-scientific-instruments', 'Review of Scientific Instruments', 'aip'],
  ['2d-materials', '2D Materials', 'iop'],
  ['nanotechnology', 'Nanotechnology', 'iop'],
  ['journal-of-physics-condensed-matter', 'Journal of Physics: Condensed Matter', 'iop'],
  ['new-journal-of-physics', 'New Journal of Physics', 'iop'],
  ['advanced-materials', 'Advanced Materials', 'wiley', 'advmat'],
  ['advanced-functional-materials', 'Advanced Functional Materials', 'wiley', 'afm'],
  ['small', 'Small', 'wiley', 'small'],
  ['carbon', 'Carbon', 'elsevier'],
  ['applied-surface-science', 'Applied Surface Science', 'elsevier'],
  ['microelectronic-engineering', 'Microelectronic Engineering', 'elsevier'],
  ['nanoscale', 'Nanoscale', 'rsc'],
  ['pnas', 'PNAS', 'pnas'],
  ['ieee-electron-device-letters', 'IEEE Electron Device Letters', 'ieee'],
];

export const JOURNALS = LIST.map(([id, name, family, cite]) => ({ id, name, family, publisher: FAMILIES[family].label, ...FAMILIES[family], cite: cite || FAMILIES[family].cite }));
export const journalById = (id) => JOURNALS.find(j => j.id === id) || null;

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
/** Journals whose name (or publisher) has every word of the query; all of them for an empty query. */
export function searchJournals(query) {
  const words = fold(query).split(' ').filter(Boolean);
  return JOURNALS.filter(j => { const hay = ' ' + fold(j.name + ' ' + j.publisher); return words.every(w => hay.includes(' ' + w)); });
}

/** What the journal style sets, as readable text: "sections I, A, 1 · Fig. · double-spaced · line numbers". */
export function describeJournal(j) {
  const nums = j.nums[0] === 'none' ? 'unnumbered sections' : j.nums[0] === 'I' ? 'sections I, A, 1' : 'sections 1, 1.1';
  return [nums, '“' + j.figLabel + ' 1”', j.spacing === 2 ? 'double-spaced' : j.spacing === 1.5 ? '1.5 line spacing' : 'single-spaced', ...(j.lineNumbers ? ['line numbers'] : [])].join(' · ');
}

/** A document style with the journal's settings put in (fonts, sizes, colours and the title block stay). */
export function applyJournal(style, id) {
  const j = journalById(id);
  if (!j) return style;
  const out = JSON.parse(JSON.stringify(style));
  ['h1', 'h2', 'h3', 'h4'].forEach((k, i) => { out[k].num = j.nums[i]; });
  out.figLabel = j.figLabel;
  out.spacing = j.spacing;
  out.lineNumbers = j.lineNumbers;
  out.cite = j.cite;
  out.journal = j.id;
  return out;
}
