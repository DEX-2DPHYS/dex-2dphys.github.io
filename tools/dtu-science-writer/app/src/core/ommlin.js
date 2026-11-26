/* OMML (Word's equation format) -> LaTeX. The reverse of omml.js, for Word import (step 6).
   Element by element, as Word builds equations: m:f fraction, m:sSup/m:sSub/m:sSubSup/m:sPre scripts, m:rad root,
   m:nary big operator, m:d delimiters, m:func function, m:acc accent, m:bar, m:limLow/m:limUpp, m:groupChr, m:m matrix,
   m:eqArr equation array, m:box/m:borderBox/m:phant, m:r runs (m:sty/m:scr styles, m:nor normal text).
   Characters: Unicode operators, Greek and the mathematical alphanumerics (𝐅, 𝒜, ℝ …) become LaTeX commands. */
import { kids, kid, find, textOf } from './xml.js';

/* ---------- characters ---------- */
const CH = {
  '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '−': '-', '∗': '\\ast', '∘': '\\circ', '∙': '\\bullet',
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '≃': '\\simeq', '≅': '\\cong', '≡': '\\equiv', '∼': '\\sim', '∝': '\\propto',
  '≪': '\\ll', '≫': '\\gg', '≲': '\\lesssim', '≳': '\\gtrsim', '≐': '\\doteq', '≔': ':=',
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '↦': '\\mapsto',
  '↑': '\\uparrow', '↓': '\\downarrow', '⟶': '\\longrightarrow', '⟵': '\\longleftarrow', '⇌': '\\rightleftharpoons', '⟹': '\\Longrightarrow',
  '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', 'ℏ': '\\hbar', 'ℓ': '\\ell', '℘': '\\wp', 'ℜ': '\\Re', 'ℑ': '\\Im', '∅': '\\emptyset', '∠': '\\angle',
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∖': '\\setminus',
  '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee', '⊕': '\\oplus', '⊗': '\\otimes', '⊙': '\\odot', '⊥': '\\perp', '∥': '\\parallel',
  '†': '\\dagger', '‡': '\\ddagger', '⋆': '\\star', '√': '\\surd', '′': "'", '″': "''", '‴': "'''", '°': '^{\\circ}', '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '‖': '\\|', '∣': '|', '∤': '\\nmid',
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⨁': '\\bigoplus', '⨂': '\\bigotimes',
  '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '&', '$': '\\$', '_': '\\_', '~': '\\sim', '\\': '\\backslash',
  ' ': '\\quad ', ' ': '\\;', ' ': '\\:', ' ': '\\,', ' ': '\\,', ' ': '~', '⁡': '', '⁢': '', '⁣': '', '⁤': '', '​': '',
};
const GREEK = 'αalpha βbeta γgamma δdelta εvarepsilon ϵepsilon ζzeta ηeta θtheta ϑvartheta ιiota κkappa ϰvarkappa λlambda μmu νnu ξxi πpi ϖvarpi ρrho ϱvarrho σsigma ςvarsigma τtau υupsilon φvarphi ϕphi χchi ψpsi ωomega ΓGamma ΔDelta ΘTheta ΛLambda ΞXi ΠPi ΣSigma ΥUpsilon ΦPhi ΨPsi ΩOmega';
for (const g of GREEK.split(' ')) CH[g[0]] = '\\' + g.slice(1);
// Greek capitals that look like Latin letters have no LaTeX command
Object.assign(CH, { 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X', 'ο': 'o' });

/* Mathematical alphanumerics (U+1D400…): [first code point, command, kind] — letters A–Z a–z (52) or digits (10). */
const ALPHA = [
  [0x1D400, 'mathbf', 'L'], [0x1D434, null, 'L'], [0x1D468, 'boldsymbol', 'L'], [0x1D49C, 'mathcal', 'L'], [0x1D4D0, 'mathcal', 'L'],
  [0x1D504, 'mathfrak', 'L'], [0x1D538, 'mathbb', 'L'], [0x1D56C, 'mathfrak', 'L'], [0x1D5A0, 'mathsf', 'L'], [0x1D5D4, 'mathsf', 'L'],
  [0x1D608, 'mathsf', 'L'], [0x1D63C, 'mathsf', 'L'], [0x1D670, 'mathtt', 'L'], [0x1D7CE, 'mathbf', 'D'], [0x1D7D8, 'mathbb', 'D'], [0x1D7E2, 'mathsf', 'D'], [0x1D7EC, 'mathsf', 'D'], [0x1D7F6, 'mathtt', 'D'],
];
const BOLD_GREEK = [[0x1D6A8, 'Α'], [0x1D6C2, 'α'], [0x1D71C, 'Α'], [0x1D736, 'α']];     // bold upright, bold italic (capitals 25, small 25)
const SPECIAL_ALPHA = { 'ℝ': ['mathbb', 'R'], 'ℂ': ['mathbb', 'C'], 'ℕ': ['mathbb', 'N'], 'ℤ': ['mathbb', 'Z'], 'ℚ': ['mathbb', 'Q'], 'ℍ': ['mathbb', 'H'], 'ℙ': ['mathbb', 'P'],
  'ℋ': ['mathcal', 'H'], 'ℒ': ['mathcal', 'L'], 'ℛ': ['mathcal', 'R'], 'ℬ': ['mathcal', 'B'], 'ℰ': ['mathcal', 'E'], 'ℱ': ['mathcal', 'F'], 'ℳ': ['mathcal', 'M'], 'ℐ': ['mathcal', 'I'], 'ℎ': [null, 'h'] };
function alphanumeric(cp) {
  for (const [start, cmd, kind] of ALPHA) {
    const n = kind === 'L' ? 52 : 10;
    if (cp >= start && cp < start + n) {
      const i = cp - start;
      const ch = kind === 'L' ? String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26) : String(i);
      return cmd ? '\\' + cmd + '{' + ch + '}' : ch;
    }
  }
  for (const [start, base] of BOLD_GREEK) {
    if (cp >= start && cp < start + 25) { const g = String.fromCodePoint(base.codePointAt(0) + (cp - start)); return '\\boldsymbol{' + (CH[g] || g) + '}'; }
  }
  return null;
}

const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'coth', 'arcsin', 'arccos', 'arctan', 'exp', 'ln', 'log', 'lg', 'det', 'dim', 'ker', 'deg', 'gcd', 'hom', 'arg', 'max', 'min', 'sup', 'inf', 'lim', 'limsup', 'liminf', 'Pr']);

/** Join LaTeX pieces: a command word is separated from a following letter ("\alpha x", not "\alphax"). */
function join(parts) {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z0-9]/.test(p)) out += ' ';
    out += p;
  }
  return out;
}

/** Characters of a run -> LaTeX. */
function chars(s) {
  const parts = [];
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (CH[ch] !== undefined) parts.push(CH[ch]);
    else if (SPECIAL_ALPHA[ch]) parts.push(SPECIAL_ALPHA[ch][0] ? '\\' + SPECIAL_ALPHA[ch][0] + '{' + SPECIAL_ALPHA[ch][1] + '}' : SPECIAL_ALPHA[ch][1]);
    else if (cp >= 0x1D400) parts.push(alphanumeric(cp) || ch);
    else if (cp >= 0x300 && cp <= 0x36F) continue;        // a stray combining mark
    else parts.push(ch);
  }
  return join(parts);
}
const textEsc = (s) => String(s).replace(/([\\{}$&%#_^~])/g, (m) => (m === '\\' ? '\\textbackslash{}' : m === '~' ? '\\textasciitilde{}' : m === '^' ? '\\textasciicircum{}' : '\\' + m));

/** {…} unless it is a single character or one command. */
const grp = (s) => (/^(.|\\[A-Za-z]+)$/.test(s) ? s : '{' + s + '}');
const arg = (s) => '{' + s + '}';

/* ---------- elements ---------- */
const mval = (el, name) => { const c = kid(el, name); return c ? c.attrs['m:val'] : undefined; };
const prOf = (el, name) => kid(el, name);
const E = (el, name) => conv(kid(el, name || 'm:e'));

function run(r) {
  const pr = kid(r, 'm:rPr');
  let text = '';
  for (const c of r.children) {
    if (c.name === 'm:t') text += textOf(c);
    else if (c.name === 'w:br') text += '\u0000';         // a line break inside an equation
  }
  if (!text) return '';
  const nl = text.includes('\u0000');
  text = text.replace(/\u0000/g, '');
  let out;
  const sty = pr ? mval(pr, 'm:sty') : undefined, scr = pr ? mval(pr, 'm:scr') : undefined;
  if (pr && kid(pr, 'm:nor')) {
    // normal text: words in an equation
    out = /^[\s ]*$/.test(text) ? '\\ ' : '\\text{' + textEsc(text) + '}';
  } else {
    const t = text.trim();
    if (sty === 'p' && FUNCS.has(t)) out = '\\' + t;
    else {
      out = chars(text);
      const lettersOnly = /^[A-Za-z]+$/.test(text);
      if (scr === 'script') out = '\\mathcal{' + out + '}';
      else if (scr === 'fraktur') out = '\\mathfrak{' + out + '}';
      else if (scr === 'double-struck') out = '\\mathbb{' + out + '}';
      else if (scr === 'sans-serif') out = '\\mathsf{' + out + '}';
      else if (scr === 'monospace') out = '\\mathtt{' + out + '}';
      else if (sty === 'b') out = '\\mathbf{' + out + '}';
      else if (sty === 'bi') out = '\\boldsymbol{' + out + '}';
      else if (sty === 'p' && lettersOnly) out = '\\mathrm{' + out + '}';          // upright letters: units, d, labels
      else if (sty === 'p' && /[A-Za-z]/.test(text) && /^[A-Za-z0-9 .,Ͱ-Ͽ]+$/.test(text)) out = '\\mathrm{' + out.replace(/ /g, '\\ ') + '}';   // units: kΩ, eV
    }
  }
  return nl ? out + ' \\\\ ' : out;
}

const DELIM = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '/': '/', '': '.' };
const NARY = { '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '∯': '\\oiint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge', '⨁': '\\bigoplus', '⨂': '\\bigotimes', '⨀': '\\bigodot' };
const ACCENT = { '̂': 'hat', '^': 'hat', 'ˆ': 'hat', '̃': 'tilde', '~': 'tilde', '˜': 'tilde', '̄': 'bar', '¯': 'bar', '̅': 'bar', '⃗': 'vec', '→': 'vec', '̇': 'dot', '˙': 'dot',
  '̈': 'ddot', '¨': 'ddot', '⃛': 'dddot', '̆': 'breve', '˘': 'breve', '̌': 'check', 'ˇ': 'check', '́': 'acute', '´': 'acute', '̀': 'grave', '`': 'grave', '̊': 'mathring', '˚': 'mathring', '⃖': 'overleftarrow', '←': 'overleftarrow', '⃡': 'overleftrightarrow' };
const MATRIX_ENV = { '()': 'pmatrix', '[]': 'bmatrix', '{}': 'Bmatrix', '||': 'vmatrix', '‖‖': 'Vmatrix' };

function matrix(m, env) {
  const rows = kids(m, 'm:mr').map(r => kids(r, 'm:e').map(conv).join(' & '));
  return '\\begin{' + env + '}' + rows.join(' \\\\ ') + '\\end{' + env + '}';
}
function eqArr(a, env) {
  return '\\begin{' + env + '}' + kids(a, 'm:e').map(conv).join(' \\\\ ') + '\\end{' + env + '}';
}
/** The only structural child of an m:e, if it is exactly one (for matrix / binomial / cases detection). */
function only(e, name) {
  const cs = kids(e).filter(c => !/Pr$/.test(c.name));
  return cs.length === 1 && cs[0].name === name ? cs[0] : null;
}

function delim(d) {
  const pr = prOf(d, 'm:dPr');
  const beg = pr && kid(pr, 'm:begChr') ? mval(pr, 'm:begChr') || '' : '(';
  const end = pr && kid(pr, 'm:endChr') ? mval(pr, 'm:endChr') || '' : ')';
  const sep = pr && kid(pr, 'm:sepChr') ? mval(pr, 'm:sepChr') || '' : '|';
  const es = kids(d, 'm:e');
  if (es.length === 1) {
    const m = only(es[0], 'm:m');
    if (m && MATRIX_ENV[beg + end]) return matrix(m, MATRIX_ENV[beg + end]);
    const arr = only(es[0], 'm:eqArr');
    if (arr && beg === '{' && end === '') return eqArr(arr, 'cases');
    if (m && beg === '{' && end === '') return matrix(m, 'cases');
    const f = only(es[0], 'm:f');
    if (f && beg === '(' && end === ')' && mval(prOf(f, 'm:fPr'), 'm:type') === 'noBar') return '\\binom' + arg(E(f, 'm:num')) + arg(E(f, 'm:den'));
  }
  const L = DELIM[beg] !== undefined ? DELIM[beg] : chars(beg), R = DELIM[end] !== undefined ? DELIM[end] : chars(end);
  const S = DELIM[sep] !== undefined && sep ? ' \\middle' + DELIM[sep] + ' ' : sep ? chars(sep) : '';
  const inner = es.map(conv).join(S);
  // Word wraps every bracket pair in a stretchy delimiter; content that is not tall needs only plain brackets
  const tall = /\\(frac|sum|int|iint|oint|prod|begin|sqrt|binom|genfrac|over|under|left|dfrac|bigcup|bigcap|substack)|[_^]\{[^{}]*[_^\\]/.test(inner);
  if (!tall && es.length === 1 && ((beg === '(' && end === ')') || (beg === '[' && end === ']'))) return beg + inner + end;
  return join(['\\left' + L, inner, '\\right' + R]);
}

function conv(el) {
  if (!el) return '';
  if (el.text !== undefined) return '';
  switch (el.name) {
    case 'm:r': return run(el);
    case 'm:f': {
      const type = mval(prOf(el, 'm:fPr'), 'm:type');
      const n = E(el, 'm:num'), d = E(el, 'm:den');
      if (type === 'lin') return grp(n) + '/' + grp(d);
      if (type === 'skw') return '{}^{' + n + '}\\!/\\!{}_{' + d + '}';
      if (type === 'noBar') return '\\genfrac{}{}{0pt}{}' + arg(n) + arg(d);
      return '\\frac' + arg(n) + arg(d);
    }
    case 'm:sSup': { const sup = E(el, 'm:sup'); return /^'+$/.test(sup) ? grp(E(el)) + sup : grp(E(el)) + '^' + arg(sup); }      // f' not f^{'}
    case 'm:sSub': return grp(E(el)) + '_' + arg(E(el, 'm:sub'));
    case 'm:sSubSup': return grp(E(el)) + '_' + arg(E(el, 'm:sub')) + '^' + arg(E(el, 'm:sup'));
    case 'm:sPre': return '{}_' + arg(E(el, 'm:sub')) + '^' + arg(E(el, 'm:sup')) + grp(E(el));
    case 'm:rad': {
      const hide = prOf(el, 'm:radPr') && kid(prOf(el, 'm:radPr'), 'm:degHide') && mval(prOf(el, 'm:radPr'), 'm:degHide') !== '0';
      const deg = E(el, 'm:deg');
      return '\\sqrt' + (!hide && deg ? '[' + deg + ']' : '') + arg(E(el));
    }
    case 'm:nary': {
      const pr = prOf(el, 'm:naryPr');
      const chr = pr && kid(pr, 'm:chr') ? mval(pr, 'm:chr') : '∫';
      const sub = pr && kid(pr, 'm:subHide') && mval(pr, 'm:subHide') !== '0' ? '' : E(el, 'm:sub');
      const sup = pr && kid(pr, 'm:supHide') && mval(pr, 'm:supHide') !== '0' ? '' : E(el, 'm:sup');
      return join([(NARY[chr] || chars(chr)) + (sub ? '_' + arg(sub) : '') + (sup ? '^' + arg(sup) : ''), E(el)]);
    }
    case 'm:d': return delim(el);
    case 'm:func': {
      const name = kid(el, 'm:fName');
      return join([conv(name), E(el)]);
    }
    case 'm:acc': {
      const pr = prOf(el, 'm:accPr');
      const chr = pr && kid(pr, 'm:chr') ? mval(pr, 'm:chr') : '̂';
      const cmd = ACCENT[chr];
      return cmd ? '\\' + cmd + arg(E(el)) : '\\overset{' + chars(chr || '') + '}' + arg(E(el));
    }
    case 'm:bar': return (mval(prOf(el, 'm:barPr'), 'm:pos') === 'bot' ? '\\underline' : '\\overline') + arg(E(el));
    case 'm:limLow': {
      const base = E(el), lim = E(el, 'm:lim');
      return /^\\[A-Za-z]+$/.test(base) || /^\\underbrace\b/.test(base) ? base + '_' + arg(lim) : '\\underset' + arg(lim) + arg(base);
    }
    case 'm:limUpp': { const base = E(el); return /^\\overbrace\b/.test(base) ? base + '^' + arg(E(el, 'm:lim')) : '\\overset' + arg(E(el, 'm:lim')) + arg(base); }
    case 'm:groupChr': {
      const pr = prOf(el, 'm:groupChrPr');
      const chr = pr && kid(pr, 'm:chr') ? mval(pr, 'm:chr') : '⏟', pos = pr ? mval(pr, 'm:pos') : 'bot';
      const map = { '⏟': 'underbrace', '⏞': 'overbrace', '→': pos === 'top' ? 'overrightarrow' : 'underrightarrow', '←': pos === 'top' ? 'overleftarrow' : 'underleftarrow', '⎵': 'underbracket', '⎴': 'overbracket' };
      return '\\' + (map[chr] || (pos === 'top' ? 'overline' : 'underline')) + arg(E(el));
    }
    case 'm:m': return matrix(el, 'matrix');
    case 'm:eqArr': return eqArr(el, 'aligned');
    case 'm:borderBox': return '\\boxed' + arg(E(el));
    case 'm:phant': return '\\phantom' + arg(E(el));
    case 'm:oMathPara': {
      const ms = kids(el, 'm:oMath').map(conv).filter(Boolean);
      return ms.length > 1 ? '\\begin{aligned}' + ms.join(' \\\\ ') + '\\end{aligned}' : ms[0] || '';
    }
    default:
      // m:oMath, m:e, m:num, m:den, m:sub, m:sup, m:deg, m:lim, m:fName, m:box, and containers we do not know
      return join(el.children.filter(c => c.name && !/Pr$/.test(c.name)).map(conv));
  }
}

/** An m:oMath or m:oMathPara element (parsed with xml.js) -> LaTeX. */
export function ommlToLatex(el) {
  const FN = [...FUNCS].join('|');
  return conv(el)
    .replace(new RegExp('(\\\\(?:' + FN + ')(?![A-Za-z])(?:_\\{(?:[^{}]|\\{[^{}]*\\})*\\})?(?:\\^\\{(?:[^{}]|\\{[^{}]*\\})*\\})?)\\s*\\\\,', 'g'), '$1 ')
    .replace(new RegExp('\\\\,\\s*(\\\\(?:' + FN + ')(?![A-Za-z]))', 'g'), '$1')          // … and before one
    .replace(/\s+\\\\\s*$/, '').replace(/ {2,}/g, ' ').trim();
}
export { find as findXml };
