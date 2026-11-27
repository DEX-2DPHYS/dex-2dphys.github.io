/* Format → Convert typed references: a document that came from Word (or was typed that way) gets live items.
   1. Citations typed as "[1]", "[2]–[4]", superscript numbers or "(refs. 3, 4)" with a typed reference list become
      real citations and the automatic reference list. Each typed entry is looked up (Crossref, verified against the
      text: main/refs.js matchText); an entry that cannot be verified is kept word for word as a reference of its own,
      so nothing is lost. The manuscript and the Supplementary Information are done one after the other: each has its own
      list and numbers.
   2. Cross-references typed as "Fig. 2a", "Figs. 1 and 3", "Table S1", "Eq. (4)" become live references to the
      figure, table, equation or section with that number (core/typedxrefs.js).
   Each step is one undo step. */
import { findTypedReferences, convertTypedReferences } from '../../core/typedrefs.js';
import { findTypedXrefs, convertTypedXrefs } from '../../core/typedxrefs.js';
import { libraryOf, addToLibrary } from '../../core/references.js';
import { hasSupplement } from '../../core/parts.js';
import { api, toast } from '../context.js';

/** One part ('main' | 'si'): look the typed entries up and convert. Returns { entries, verified, kept, markers } or null. */
async function convertPart(view, part, quiet) {
  const found = findTypedReferences(view.state.doc, part);
  if (!found.list) return null;
  const entries = found.list.entries;
  let lib = libraryOf(view.state.doc);
  const keyOf = new Map();
  let verified = 0;
  const kept = [];
  const where = part === 'si' ? ' (Supplementary Information)' : '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!quiet) toast('Looking up reference ' + (i + 1) + ' of ' + entries.length + where + ' …');
    if (i) await new Promise(r => setTimeout(r, 300));                 // gentle on Crossref
    let item = null;
    try { const r = await api.refs('matchText', e.text); item = r && r.item; } catch (_) { item = null; }
    // not verified: the typed text itself is the reference (printed as it was typed)
    if (item) verified++; else { kept.push(e.n); item = { type: 'document', title: e.text.replace(/\.\s*$/, ''), typed: true }; }
    const r = addToLibrary(lib, [item]);
    lib = r.library;
    keyOf.set(e.n, r.keys[0]);
  }
  // the document may have changed while we were looking things up: locate again
  const now = findTypedReferences(view.state.doc, part);
  if (!now.list) return null;
  // the library may have grown meanwhile (the other part, the user): keep what is there
  const merged = { ...libraryOf(view.state.doc), ...lib };
  view.dispatch(convertTypedReferences(view.state, now, keyOf, merged).setMeta('untracked', true).scrollIntoView());
  return { entries: entries.length, verified, kept, markers: now.markers.length };
}

/** Typed cross-references -> live ones; returns how many. */
export function convertXrefs(view) {
  const found = findTypedXrefs(view.state.doc);
  if (found.length) view.dispatch(convertTypedXrefs(view.state, found).setMeta('untracked', true));
  return found.length;
}

/** Returns { entries, verified, kept, markers, xrefs } (sums over both parts) or null when there was nothing to convert. */
export async function convertTyped(view, { quiet = false } = {}) {
  const parts = hasSupplement(view.state.doc) ? ['main', 'si'] : ['main'];
  const res = { entries: 0, verified: 0, kept: [], markers: 0, xrefs: 0, lists: 0 };
  for (const part of parts) {
    const r = await convertPart(view, part, quiet);
    if (!r) continue;
    res.lists++;
    res.entries += r.entries; res.verified += r.verified; res.markers += r.markers;
    res.kept.push(...r.kept.map(n => (part === 'si' ? 'S' : '') + n));
  }
  res.xrefs = convertXrefs(view);
  if (!res.lists && !res.xrefs) {
    if (!quiet) toast('Nothing to convert: no typed reference list (a heading “References” followed by a numbered list) and no typed “Fig. 1” / “Table 2” / “Eq. (3)” that matches a figure, table or equation.');
    return null;
  }
  if (!quiet) {
    const bits = [];
    if (res.lists) bits.push(res.markers + ' citations and ' + res.entries + ' references: ' + res.verified + ' verified at Crossref'
      + (res.kept.length ? ', ' + res.kept.length + ' kept as typed (no. ' + res.kept.join(', ') + ') — check them in Format → Reference library' : ''));
    if (res.xrefs) bits.push(res.xrefs + ' typed cross-reference' + (res.xrefs > 1 ? 's' : '') + ' (“Fig. 2”, “Table 1”, …) made live');
    toast('Converted ' + bits.join('; ') + '. Ctrl+Z undoes it.'
      + (res.verified ? ' Format → Add references to Zotero library puts the verified ones in Zotero.' : ''), res.kept.length ? 'error' : undefined);
  }
  return res;
}
