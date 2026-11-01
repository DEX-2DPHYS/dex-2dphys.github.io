// Languages: every text the panels draw passes through tr() at draw time, so the code itself stays in English.
// A dictionary maps English text to the translation; entries with {1}, {2} ... are templates for text with numbers
// or names in it (the inserted parts are translated too, so "Graphene flake · 238 atoms" works).
let LANG = 'en';
const DICTS = {};                      // lang -> { exact: Map, pats: [{ re, out }] }
const cache = new Map();

const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
export function addLanguage(lang, table) {
  const exact = new Map(), pats = [];
  for (const [en, tx] of Object.entries(table)) {
    if (typeof tx !== 'string' || !tx) continue;
    if (/\{\d+\}/.test(en)) {
      const lit = en.replace(/\{\d+\}/g, '').replace(/[^A-Za-z]/g, '');
      if (lit.length < 2) continue;                              // a template that is (almost) only placeholders would match anything
      const order = []; const re = new RegExp('^' + en.split(/(\{\d+\})/).map((p) => { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(+m[1]); return '([\\s\\S]+?)'; } return esc(p).replace(/\{/g, '\\{').replace(/\}/g, '\\}'); }).join('') + '$');
      pats.push({ re, order, out: tx, weight: lit.length });
    } else exact.set(en, tx);
  }
  pats.sort((a, b) => b.weight - a.weight);                       // the most specific template first
  DICTS[lang] = { exact, pats };
}
export function setLang(l) { LANG = DICTS[l] || l === 'en' ? l : 'en'; cache.clear(); }
export function getLang() { return LANG; }
export function tr(s) {
  if (LANG === 'en' || typeof s !== 'string' || s.length < 2) return s;
  const hit = cache.get(s); if (hit !== undefined) return hit;
  const D = DICTS[LANG]; let r = D.exact.get(s);
  if (r === undefined) {
    r = s;
    if (/[A-Za-z]{2}/.test(s)) for (const p of D.pats) {
      const m = p.re.exec(s); if (!m) continue;
      const val = {}; p.order.forEach((k, i) => { val[k] = m[i + 1]; });
      r = p.out.replace(/\{(\d+)\}/g, (_, k) => tr(val[k] ?? '')); break;
    }
  }
  if (cache.size > 4000) cache.clear();
  cache.set(s, r); return r;
}
