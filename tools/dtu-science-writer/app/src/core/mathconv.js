/* Math conversion. Equations are stored as LaTeX (MathLive's dialect).
   LaTeX -> Typst math (preview/PDF) via tex2typst + a fix-up table for the pinned Typst version;
   LaTeX -> MathML (Temml) -> OMML (Word) via omml.js. */
import { tex2typst } from 'tex2typst';
import temml from 'temml';
import { mathmlToOmml } from './omml.js';
import SYMFIX from './typst-symfix.json';

/** Rewrite MathLive-specific commands into plain LaTeX that every converter understands. */
/* amsmath commands that MathLive (editor) or tex2typst (PDF) do not know, as the plain commands they stand for.
   Used by normalizeLatex (exports) and as MathLive macros (editor display and editing), so \dots etc. work everywhere. */
export const LATEX_ALIASES = { dots: '\\ldots', dotsc: '\\ldots', dotso: '\\ldots', dotsb: '\\cdots', dotsm: '\\cdots', dotsi: '\\cdots' };
const ALIAS_RE = new RegExp('\\\\(' + Object.keys(LATEX_ALIASES).sort((a, b) => b.length - a.length).join('|') + ')(?![a-zA-Z])', 'g');
export const expandAliases = (tex) => String(tex || '').replace(ALIAS_RE, (_, k) => LATEX_ALIASES[k]);

export function normalizeLatex(tex) {
  return expandAliases(tex)
    .replace(/\\differentialD\b/g, '\\mathrm{d}')
    .replace(/\\exponentialE\b/g, '\\mathrm{e}')
    .replace(/\\imaginaryI\b/g, '\\mathrm{i}')
    .replace(/\\imaginaryJ\b/g, '\\mathrm{j}')
    .replace(/\\placeholder(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\mleft\b/g, '\\left').replace(/\\mright\b/g, '\\right')
    .replace(/\\dfrac\b/g, '\\frac').replace(/\\tfrac\b/g, '\\frac')
    .replace(/\\char"([0-9A-Fa-f]+)/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .trim();
}

const T2T = { nonStrict: true, preferShorthands: true, fracToSlash: false, inftyToOo: false };

/** LaTeX -> Typst math source (without $). Throws on failure. */
export function latexToTypst(tex, opts = {}) {
  const src = normalizeLatex(tex)
    // |x| as a pair of bars -> \left|x\right| so Typst sets it as delimiters, not as relations
    .replace(/(?<!\\[a-zA-Z]*)\|([^|]+?)(?<!\\[a-zA-Z]*)\|/g, '\\left|$1\\right|')
    // cases: LaTeX puts a gap between value and condition; Typst's & only aligns
    .replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => '\\begin{cases}' + body.replace(/(?<!\\)&/g, '&\\quad ') + '\\end{cases}');
  if (!src) return '';
  const out = tex2typst(src, T2T);
  // symbol names the pinned Typst version rejects -> their Unicode character (table from tools/check-symbols.js)
  let res = out.replace(/"(?:[^"\\]|\\.)*"|[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+|[A-Za-z]{2,}/g, (w) => (w[0] === '"' ? w : SYMFIX[w] || w)).replace(/\s+/g, ' ').trim();
  // \text{…}: plain text in the body font (opts.textFn, defined by the document preamble), not the math font.
  // tex2typst writes it as a bare string; strings inside op("…") etc. follow "(" and are left alone.
  if (opts.textFn) {
    res = res.replace(/(^|[^(A-Za-z0-9])(\s*)("(?:[^"\\]|\\.)*")/g, (m, pre, sp, s) => {
      const call = '#' + opts.textFn + '(' + s + ')';
      return pre + sp + (pre === '_' || pre === '^' ? '(' + call + ')' : call + ' ');
    }).replace(/\s+/g, ' ').trim();
  }
  return res;
}

/** LaTeX -> MathML string (<math> element). Throws on LaTeX errors. */
export function latexToMathML(tex, display) {
  return temml.renderToString(normalizeLatex(tex), { displayMode: !!display, xml: true, annotate: false, throwOnError: true });
}

/** LaTeX -> OMML <m:oMath> element (namespaces are declared by document.xml). */
export function latexToOmml(tex, display) {
  // Word drops the spacing Temml gives \bmod / \pmod: spell it out
  const t = String(tex || '').replace(/\\bmod\b/g, '\\;\\mathrm{mod}\\;').replace(/\\pmod\{([^}]*)\}/g, '\\;(\\mathrm{mod}\\;$1)');
  return mathmlToOmml(latexToMathML(t, display));
}
