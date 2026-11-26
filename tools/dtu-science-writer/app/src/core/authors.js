/* Authors and affiliations: formatting shared by the editor, Typst and Word.
   Affiliations are numbered in order of first use by the authors; markers and address fields come from the
   document style (style.affil). The corresponding author gets a * and a line with the e-mail address. */

export const AFFIL_KEYS = ['dept', 'inst', 'street', 'postcode', 'city', 'country'];
export const AFFIL_LABELS = { dept: 'Department / group', inst: 'Institution', street: 'Street', postcode: 'Postcode', city: 'City', country: 'Country' };

const SYMBOLS = ['†', '‡', '§', '¶', '‖', '††', '‡‡', '§§'];

export function marker(i, kind) {
  if (kind === 'letters') { let s = '', n = i + 1; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
  if (kind === 'symbols') return SYMBOLS[i % SYMBOLS.length];
  return String(i + 1);
}

/** One affiliation as text in the chosen field format. */
export function affilText(a, fields) {
  const cityLine = [a.postcode, a.city].filter(Boolean).join(' ');
  let parts;
  if (fields === 'short') parts = [a.inst, a.country];
  else if (fields === 'full') parts = [a.dept, a.inst, a.street, cityLine, a.country];
  else parts = [a.dept, a.inst, a.city, a.country];
  return parts.map(p => (p || '').trim()).filter(Boolean).join(', ');
}

/**
 * Format the author block.
 * Returns { authors: [{ name, marks: 'a,b' or '', corresponding }], affils: [{ mark, text }], corresponding: [{ name, email }] }
 */
export function formatAuthors(attrs, affilStyle = { marker: 'numbers', fields: 'medium' }) {
  const list = Array.isArray(attrs.list) ? attrs.list : [];
  const all = Array.isArray(attrs.affils) ? attrs.affils : [];
  const byId = new Map(all.map(a => [a.id, a]));
  const order = [];
  for (const au of list) for (const id of au.affils || []) if (byId.has(id) && !order.includes(id)) order.push(id);
  const markOf = new Map(order.map((id, i) => [id, marker(i, affilStyle.marker)]));
  const authors = list.filter(au => (au.name || '').trim()).map(au => ({
    name: au.name.trim(),
    marks: (au.affils || []).filter(id => markOf.has(id)).map(id => markOf.get(id)).join(','),
    corresponding: !!au.corresponding,
  }));
  const affils = order.map(id => ({ mark: markOf.get(id), text: affilText(byId.get(id), affilStyle.fields) }));
  const corresponding = list.filter(au => au.corresponding && (au.name || '').trim()).map(au => ({ name: au.name.trim(), email: (au.email || '').trim() }));
  return { authors, affils, corresponding };
}

export const newAffilId = () => 'af-' + Math.random().toString(36).slice(2, 7);

/** Old documents stored the author line as plain text: turn "A. Author1, B. Author1,2" into a list. */
export function migrateAuthorsJson(node) {
  if (!node || node.type !== 'authors' || !Array.isArray(node.content)) return node;
  const text = node.content.filter(c => c.type === 'text' && !(c.marks || []).some(m => m.type === 'sup')).map(c => c.text).join('');
  const list = text.split(/,| and /).map(s => s.trim()).filter(Boolean).map(name => ({ name, affils: [], corresponding: false, email: '' }));
  return { type: 'authors', attrs: { list, affils: [] } };
}
