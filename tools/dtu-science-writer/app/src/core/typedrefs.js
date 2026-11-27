/* Typed references -> real citations. Documents that come from Word (or were typed that way) carry citations as plain
   text — "[1]", "[2,5]", "[2]–[4]", "[3–6]" — and a typed, numbered reference list. findTypedReferences locates both;
   convertTypedReferences replaces every marker by a citation node and the typed list by the automatic reference list,
   in one transaction. Looking the entries up (Crossref, main/refs.js matchText) is the caller's job. */
import { Fragment } from 'prosemirror-model';
import { supplementOf } from './numbering.js';

const SUPERSCRIPT_STYLES = new Set(['nature', 'acs', 'aip', 'advmat', 'afm', 'small', 'rsc']);
const UNITS = new Set(['cm', 'mm', 'nm', 'pm', 'km', 'um', 'µm', 'ms', 'ns', 'ps', 'fs', 'eV', 'meV', 'keV', 'MeV', 'mK', 'Hz', 'kHz', 'MHz', 'GHz', 'THz', 'Pa', 'kPa', 'Torr', 'mTorr', 'mbar', 'mol', 'mL', 'sr', 'rad', 'cd', 'lm', 'lx']);
/* "(refs. 21, 43, 45)", "[Ref. 12]": a citation written out in the text, brackets included */
const PROSE = /[([]\s*refs?\.?\s*(\d+(?:\s*[–—-]\s*\d+)?(?:\s*(?:,|;|and)\s*\d+(?:\s*[–—-]\s*\d+)?)*)\s*[)\]]/gi;
const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu'.split(' '));
/** "MoS", "WSe", "α-RuCl", "SiO", "hBN" -> true: two or more element symbols in a row. */
function isFormula(w) {
  const t = w.replace(/^.*[-/]/, '').replace(/^[a-zα-ω]+(?=[A-Z])/, '');
  const parts = t.match(/[A-Z][a-z]?|\d+/g);
  return !!parts && parts.join('') === t && parts.filter(x => /\D/.test(x)).length >= 2 && parts.every(x => /\d/.test(x) || ELEMENTS.has(x));
}
const HEADING = /^(references?|bibliography|literature|literature cited|works cited|reference list)\.?$/i;
const NUMBERED = /^\s*(?:\[(\d+)\]|\((\d+)\)|(\d+)[.)])\s+(\S[\s\S]*)$/;
const MARKER = /\[(\d+(?:\s*[–—-]\s*\d+)?(?:\s*[,;]\s*\d+(?:\s*[–—-]\s*\d+)?)*)\](?:\s*[–—-]\s*\[(\d+)\])?/g;

/** "2, 4–6" -> [2, 4, 5, 6] (null when a range is absurd). */
function expand(spec, through) {
  const out = [];
  for (const part of spec.split(/[,;]/)) {
    const m = /^\s*(\d+)(?:\s*[–—-]\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (b < a || b - a > 60) return null;
    for (let n = a; n <= b; n++) out.push(n);
  }
  if (through) { const last = out[out.length - 1], t = +through; if (t <= last || t - last > 60) return null; for (let n = last + 1; n <= t; n++) out.push(n); }
  return [...new Set(out)];
}

/**
 * The typed reference list and the typed citation markers of a document.
 * Returns { list: { from, to, entries: [{ n, text }] } | null, markers: [{ from, to, nums }] }.
 * The list: a heading "References" (or Bibliography …) followed by a numbered list or numbered paragraphs — or, without
 * such a heading, numbered paragraphs "[1] …" at the end of the document.
 */
export function findTypedReferences(doc, part) {
  // the manuscript and the Supplementary Information each have their own typed list and numbers: one part at a time
  const sup = supplementOf(doc);
  const tops = [];
  if (part === 'si' && sup) sup.node.forEach((n, off) => tops.push({ n, off: sup.pos + 1 + off }));
  else doc.forEach((n, off) => { if (n.type.name !== 'supplement') tops.push({ n, off }); });
  const range = part === 'si' && sup ? [sup.pos + 1, sup.pos + sup.node.nodeSize - 1] : [0, sup ? sup.pos : doc.content.size];
  if (part === 'si' && !sup) return { list: null, markers: [], styleGuess: null, range };
  let list = null;
  const collect = (start) => {
    // entries from block index `start` on: ordered lists and numbered paragraphs
    const entries = [];
    let i = start, next = 1;
    for (; i < tops.length; i++) {
      const { n } = tops[i];
      if (n.type.name === 'ordered_list') {
        let k = n.attrs.order || next;
        n.forEach((item) => { const t = item.textContent.trim(); if (t) entries.push({ n: k, text: t }); k++; });
        next = k;
      } else if (n.type.name === 'paragraph' && NUMBERED.test(n.textContent)) {
        const m = NUMBERED.exec(n.textContent);
        entries.push({ n: +(m[1] || m[2] || m[3]), text: m[4].trim() });
        next = entries[entries.length - 1].n + 1;
      } else if (n.type.name === 'paragraph' && !n.textContent.trim()) continue;
      else break;
    }
    return { entries, end: i };
  };
  for (let i = 0; i < tops.length; i++) {
    const { n, off } = tops[i];
    if (n.type.name === 'heading' && HEADING.test(n.textContent.trim())) {
      const { entries, end } = collect(i + 1);
      if (entries.length) { const lastTop = tops[end - 1]; list = { from: off, to: lastTop.off + lastTop.n.nodeSize, entries }; }
    }
  }
  if (!list) {
    // no heading: numbered paragraphs "[1] …" closing the document
    let i = tops.length;
    while (i > 0 && tops[i - 1].n.type.name === 'paragraph' && (!tops[i - 1].n.textContent.trim() || /^\s*\[\d+\]\s+\S/.test(tops[i - 1].n.textContent))) i--;
    const { entries } = collect(i);
    if (entries.length >= 2 && tops[i]) list = { from: tops[i].off, to: range[1], entries };
  }
  const known = new Set(list ? list.entries.map(e => e.n) : []);
  const markers = [];
  doc.nodesBetween(range[0], range[1], (node, pos, parent, index) => {
    if (list && pos >= list.from && pos < list.to) return false;
    if (!node.isText) return true;
    /* Superscript numbers ("heterostructures¹⁻³", "nitride.²¹"): a citation when every number is in the list and it
       does not read as an exponent — an exponent follows a unit, a symbol or a number ("cm²", "10⁶"), a citation a
       word or punctuation; ranges and lists ("4–6", "36,37") are always citations. */
    if (list && node.marks.some(m => m.type.name === 'sup')) {
      const sm = /^(\s*)(\d+(?:\s*[–—-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–—-]\s*\d+)?)*)(\s*)$/.exec(node.text);
      const nums = sm ? expand(sm[2]) : null;
      if (nums && nums.length && nums.every(n => known.has(n))) {
        const before = index > 0 && parent.child(index - 1).isText && !parent.child(index - 1).marks.some(m => m.type.name === 'sup' || m.type.name === 'sub') ? parent.child(index - 1).text : '';
        const word = (/([\p{L}]+)$/u.exec(before) || [])[1] || '';
        // after a word or an acronym ("VASP⁵⁸"), not after a unit ("cm²", "eV²") or a one-letter variable ("x²")
        // a single digit right after a formula ("MoS²" typed for MoS₂) is part of the formula
        const formula = /^\d$/.test(sm[2]) && !/\s$/.test(before) && isFormula((/(\S+)$/.exec(before) || [])[1] || '');
        const afterWord = word.length >= 2 && !UNITS.has(word) && !formula;
        const afterPunct = /[.,;:)\]”"’'!?]\s*$/.test(before);
        const many = /[,–—-]/.test(sm[2]);
        if (before && (many || afterWord || afterPunct) && !/[\d×·]\s*$/.test(before)) { markers.push({ from: pos + sm[1].length, to: pos + node.text.length - sm[3].length, nums, sup: true }); return true; }
      }
      return true;
    }
    PROSE.lastIndex = 0;
    let pm;
    while (list && (pm = PROSE.exec(node.text))) {
      const nums = expand(pm[1].replace(/\band\b/g, ','));
      if (nums && nums.length && nums.every(n => known.has(n))) markers.push({ from: pos + pm.index, to: pos + pm.index + pm[0].length, nums, prose: true });
    }
    MARKER.lastIndex = 0;
    let m;
    while ((m = MARKER.exec(node.text))) {
      const nums = expand(m[1], m[2]);
      // only numbers that are in the list: "[0, 1]" in prose or an interval is left alone
      if (markers.some(k => k.prose && k.from <= pos + m.index && k.to >= pos + m.index + m[0].length)) continue;
      if (nums && nums.length && (!list || nums.every(n => known.has(n))) && list) markers.push({ from: pos + m.index, to: pos + m.index + m[0].length, nums });
    }
    return true;
  });
  // superscript numbers with an ACS-like list ("(1) Geim, A. K.; Grigorieva, I. V. …") or a Nature-like one
  const supStyle = markers.length > 0 && markers.filter(m => m.sup).length > markers.length / 2;
  const styleGuess = supStyle ? (list && list.entries.filter(e => /^[\p{Lu}][\p{L}'’ -]+, (?:\p{Lu}[.-]\s?)+;/u.test(e.text)).length > list.entries.length / 2 ? 'acs' : 'nature') : null;
  return { list, markers, styleGuess, range };
}

/**
 * The transaction that converts them. keyOf: Map(n -> library key); library: the new library object.
 * Markers become citation nodes; the typed list (with its heading) becomes the reference-list node, unless the document
 * already has one.
 */
export function convertTypedReferences(state, found, keyOf, library) {
  const { schema } = state;
  let tr = state.tr.setDocAttribute('references', library);
  // the document cited with superscript numbers: keep that look (unless the style already is a superscript one)
  const st = state.doc.attrs.style || {};
  if (found.styleGuess && !SUPERSCRIPT_STYLES.has(st.cite || 'aps') && !/^csl:/.test(st.cite || '')) tr = tr.setDocAttribute('style', { ...st, cite: found.styleGuess });
  // from the end of the document backwards, so earlier positions stay valid
  const steps = found.markers.map(m => ({ ...m, kind: 'marker' }));
  if (found.list) steps.push({ from: found.list.from, to: found.list.to, kind: 'list' });
  steps.sort((a, b) => b.from - a.from);
  // a reference list already placed in this part (outside the typed one)?
  let hasList = false;
  const range = found.range || [0, state.doc.content.size];
  state.doc.nodesBetween(range[0], range[1], (n, pos) => { if (n.type.name === 'bibliography' && !(found.list && pos >= found.list.from && pos < found.list.to)) hasList = true; return !n.isTextblock; });
  for (const s of steps) {
    if (s.kind === 'list') {
      tr = hasList ? tr.delete(s.from, s.to) : tr.replaceWith(s.from, s.to, schema.nodes.bibliography.create());
    } else {
      const items = s.nums.map(n => keyOf.get(n)).filter(Boolean).map(id => ({ id }));
      if (items.length) tr = tr.replaceWith(s.from, s.to, Fragment.from(schema.nodes.citation.create({ items, mode: 'normal' })));
    }
  }
  return tr;
}
