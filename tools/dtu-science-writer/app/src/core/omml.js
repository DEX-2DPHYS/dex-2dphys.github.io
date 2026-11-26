/* MathML (from Temml) -> OMML (Word equations). Follows the mapping of Microsoft's MML2OMML:
   fences -> m:d, large operators -> m:nary with their operand, accents -> m:acc, over/under bars -> m:bar,
   multi-letter identifiers upright, text as normal text. No DOM needed (own tiny XML parser). */

/* ---------- tiny XML parser (well-formed MathML only) ---------- */
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));

export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1]) { if (stack.length > 1) stack.pop(); }
    else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el = { name: m[2].replace(/^\w+:/, ''), attrs, children: [] };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5] !== undefined) {
      if (m[5].trim() || top.name === 'mtext') top.children.push({ text: decode(m[5]) });
    }
  }
  return root;
}

/* ---------- OMML building blocks ---------- */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (s) => esc(s);
const textOf = (el) => (el.text !== undefined ? el.text : el.children.map(textOf).join(''));
const elems = (el) => el.children.filter(c => c.name);

function r(text, sty, nor) {
  text = String(text || '').replace(/[︎️]/g, '');   // variation selectors: Word draws them as boxes
  if (!text) return '';
  const rp = (nor ? '<m:nor/>' : '') + (sty ? '<m:sty m:val="' + sty + '"/>' : '');
  return '<m:r>' + (rp ? '<m:rPr>' + rp + '</m:rPr>' : '') + '<m:t xml:space="preserve">' + esc(text) + '</m:t></m:r>';
}
const wrap = (tag, inner) => '<m:' + tag + '>' + inner + '</m:' + tag + '>';
const ctrl = '<m:ctrlPr/>';

const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '⨌', '∮', '∯', '∰', '⋃', '⋂', '⋁', '⋀', '⨁', '⨂', '⨀', '⨄', '⨆']);
const ACCENTS = new Set(['ˆ', '^', '˜', '~', '¨', '˙', '´', '`', 'ˇ', '˘', '→', '⃗', '¯', '‾', '_', '˚', '⏜', '⏝']);
const BARS = new Set(['¯', '‾', '_', '̅', '―', '─']);
const GROUP = new Set(['⏞', '⏟', '⎴', '⎵', '⏠', '⏡', '→', '←', '↔', '⟶', '⟵']);
const BREAKERS = new Set(['=', '<', '>', '≤', '≥', '≈', '≠', '≡', '∼', '≃', '∝', '+', '−', '-', '±', '∓', ',', ';', '→', '⟶', '⇒', '⇔', '∈', '⊂', '⊆']);
const INVISIBLE = new Set(['⁡', '⁢', '⁣', '⁤']);
const SPACE_CH = (w) => (w >= 0.9 ? ' ' : w >= 0.4 ? ' ' : w >= 0.2 ? ' ' : w > 0 ? ' ' : '');

function emWidth(s) {
  const m = /^(-?[\d.]+)\s*(em|ex|pt|mu)?$/.exec(String(s || '').trim());
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2] === 'ex' ? v * 0.43 : m[2] === 'pt' ? v / 10 : m[2] === 'mu' ? v / 18 : v;
}

const isFenceMo = (el, form) => el && el.name === 'mo' && (el.attrs.fence === 'true' || el.attrs.stretchy === 'true') && (!form || el.attrs.form === form);
const moText = (el) => (el && el.name === 'mo' ? textOf(el) : null);

/** Base of a script element, ignoring transparent wrappers. */
function core(el) {
  let e = el;
  while (e && (e.name === 'mrow' || e.name === 'mstyle' || e.name === 'mpadded') && elems(e).length === 1) e = elems(e)[0];
  return e;
}

/* ---------- converter ---------- */
function seq(list) {
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    // large operator: m:nary takes the following items as its operand
    const n = naryParts(el);
    if (n) {
      let j = i + 1;
      const operand = [];
      while (j < list.length && !BREAKERS.has(moText(list[j]) || '')) operand.push(list[j++]);
      out += nary(n, operand);
      i = j - 1;
      continue;
    }
    out += conv(el);
  }
  return out;
}

function naryParts(el) {
  el = core(el);                       // Temml wraps \sum_{…}^{…} in an extra mrow
  if (!el || !el.name) return null;
  const k = elems(el);
  if (el.name === 'mo' && NARY.has(textOf(el).trim())) return { chr: textOf(el).trim(), sub: null, sup: null, loc: 'subSup' };
  if (['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(el.name)) {
    const base = core(k[0]);
    if (base && base.name === 'mo' && NARY.has(textOf(base).trim())) {
      const under = el.name === 'munder' || el.name === 'munderover';
      const loc = under || el.name === 'mover' ? 'undOvr' : 'subSup';
      let sub = null, sup = null;
      if (el.name === 'msub' || el.name === 'munder') sub = k[1];
      else if (el.name === 'msup' || el.name === 'mover') sup = k[1];
      else { sub = k[1]; sup = k[2]; }
      return { chr: textOf(base).trim(), sub, sup, loc };
    }
  }
  return null;
}

function nary(n, operand) {
  const pr = '<m:naryPr>' + (n.chr === '∫' ? '' : '<m:chr m:val="' + attr(n.chr) + '"/>') + '<m:limLoc m:val="' + n.loc + '"/>'
    + (n.sub ? '' : '<m:subHide m:val="1"/>') + (n.sup ? '' : '<m:supHide m:val="1"/>') + ctrl + '</m:naryPr>';
  return '<m:nary>' + pr + wrap('sub', n.sub ? conv(n.sub) : '') + wrap('sup', n.sup ? conv(n.sup) : '') + wrap('e', seq(operand)) + '</m:nary>';
}

function delim(beg, end, inner) {
  return '<m:d><m:dPr><m:begChr m:val="' + attr(beg) + '"/><m:endChr m:val="' + attr(end) + '"/>' + ctrl + '</m:dPr>' + wrap('e', inner) + '</m:d>';
}

function rowContent(el) {
  const k = elems(el);
  // \left( … \right): fenced row -> m:d (also handles cases/pmatrix around a table)
  if (k.length >= 2 && isFenceMo(k[0]) && isFenceMo(k[k.length - 1]) && k[0].attrs.form !== 'postfix' && k[k.length - 1].attrs.form !== 'prefix') {
    return delim(textOf(k[0]).trim(), textOf(k[k.length - 1]).trim(), seq(k.slice(1, -1)));
  }
  if (k.length >= 2 && isFenceMo(k[0], 'prefix') && k[0].attrs.stretchy === 'true' && k.slice(1).every(c => !isFenceMo(c, 'postfix'))) {
    return delim(textOf(k[0]).trim(), '', seq(k.slice(1)));   // {cases with no closing fence
  }
  return seq(k);
}

function conv(el) {
  if (!el) return '';
  if (el.text !== undefined) return r(el.text);
  const k = elems(el);
  const variant = el.attrs.mathvariant;
  switch (el.name) {
    case 'math': case 'semantics': case 'mstyle': case 'mpadded': case 'mrow':
      return rowContent(el);
    case 'annotation': case 'annotation-xml': return '';
    case 'mi': {
      const t = textOf(el);
      const upright = variant === 'normal' || [...t].length > 1;
      return r(t, upright ? 'p' : variant === 'bold' ? 'b' : variant === 'bold-italic' ? 'bi' : null);
    }
    case 'mn': return r(textOf(el));
    case 'mo': {
      const t = [...textOf(el)].filter(c => !INVISIBLE.has(c)).join('');
      return r(t, /^[A-Za-z]{2,}$/.test(t) ? 'p' : null);
    }
    case 'mtext': case 'ms': return r(textOf(el), 'p', true);
    case 'mspace': return r(SPACE_CH(emWidth(el.attrs.width)));
    case 'msub': return '<m:sSub><m:sSubPr>' + ctrl + '</m:sSubPr>' + wrap('e', conv(k[0])) + wrap('sub', conv(k[1])) + '</m:sSub>';
    case 'msup': return '<m:sSup><m:sSupPr>' + ctrl + '</m:sSupPr>' + wrap('e', conv(k[0])) + wrap('sup', conv(k[1])) + '</m:sSup>';
    case 'msubsup': return '<m:sSubSup><m:sSubSupPr>' + ctrl + '</m:sSubSupPr>' + wrap('e', conv(k[0])) + wrap('sub', conv(k[1])) + wrap('sup', conv(k[2])) + '</m:sSubSup>';
    case 'mfrac': {
      const noBar = el.attrs.linethickness !== undefined && /^0(\.0*)?\D*$/.test(el.attrs.linethickness);
      return '<m:f><m:fPr>' + (noBar ? '<m:type m:val="noBar"/>' : '') + ctrl + '</m:fPr>' + wrap('num', conv(k[0])) + wrap('den', conv(k[1])) + '</m:f>';
    }
    case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/>' + ctrl + '</m:radPr><m:deg/>' + wrap('e', seq(k)) + '</m:rad>';
    case 'mroot': return '<m:rad><m:radPr>' + ctrl + '</m:radPr>' + wrap('deg', conv(k[1])) + wrap('e', conv(k[0])) + '</m:rad>';
    case 'mover': case 'munder': {
      const over = el.name === 'mover';
      const mark = core(k[1]);
      const ch = mark && mark.name === 'mo' ? textOf(mark).trim() : null;
      if (ch && BARS.has(ch) && mark.attrs.stretchy !== 'false') return '<m:bar><m:barPr><m:pos m:val="' + (over ? 'top' : 'bot') + '"/>' + ctrl + '</m:barPr>' + wrap('e', conv(k[0])) + '</m:bar>';
      if (ch && GROUP.has(ch) && (mark.attrs.stretchy === 'true' || ch === '⏞' || ch === '⏟')) {
        return '<m:groupChr><m:groupChrPr><m:chr m:val="' + attr(ch) + '"/><m:pos m:val="' + (over ? 'top' : 'bot') + '"/><m:vertJc m:val="' + (over ? 'bot' : 'top') + '"/>' + ctrl + '</m:groupChrPr>' + wrap('e', conv(k[0])) + '</m:groupChr>';
      }
      if (over && ch && ACCENTS.has(ch)) {
        const c = ch === '→' ? '⃗' : ch === '^' || ch === 'ˆ' ? '̂' : ch === '~' || ch === '˜' ? '̃' : ch === '¯' || ch === '‾' ? '̅' : ch === '¨' ? '̈' : ch === '˙' ? '̇' : ch === 'ˇ' ? '̌' : ch === '˘' ? '̆' : ch === '´' ? '́' : ch === '`' ? '̀' : ch === '˚' ? '̊' : ch;
        return '<m:acc><m:accPr><m:chr m:val="' + attr(c) + '"/>' + ctrl + '</m:accPr>' + wrap('e', conv(k[0])) + '</m:acc>';
      }
      const tag = over ? 'limUpp' : 'limLow';
      return '<m:' + tag + '><m:' + tag + 'Pr>' + ctrl + '</m:' + tag + 'Pr>' + wrap('e', conv(k[0])) + wrap('lim', conv(k[1])) + '</m:' + tag + '>';
    }
    case 'munderover': {
      const low = '<m:limLow><m:limLowPr>' + ctrl + '</m:limLowPr>' + wrap('e', conv(k[0])) + wrap('lim', conv(k[1])) + '</m:limLow>';
      return '<m:limUpp><m:limUppPr>' + ctrl + '</m:limUppPr>' + wrap('e', low) + wrap('lim', conv(k[2])) + '</m:limUpp>';
    }
    case 'mtable': {
      const rows = k.filter(x => x.name === 'mtr' || x.name === 'mlabeledtr');
      const cols = Math.max(1, ...rows.map(rw => elems(rw).filter(c => c.name === 'mtd').length));
      const mr = rows.map(rw => wrap('mr', elems(rw).filter(c => c.name === 'mtd').map(td => wrap('e', seq(elems(td)))).join(''))).join('');
      const jc = (rows[0] && elems(rows[0])[0] && /left/.test(elems(rows[0])[0].attrs.class || '')) ? 'left' : 'center';
      return '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="' + cols + '"/><m:mcJc m:val="' + jc + '"/></m:mcPr></m:mc></m:mcs>' + ctrl + '</m:mPr>' + mr + '</m:m>';
    }
    case 'menclose': {
      const n = el.attrs.notation || '';
      if (/^top$/.test(n)) return '<m:bar><m:barPr><m:pos m:val="top"/>' + ctrl + '</m:barPr>' + wrap('e', seq(k)) + '</m:bar>';
      if (/^bottom$/.test(n)) return '<m:bar><m:barPr><m:pos m:val="bot"/>' + ctrl + '</m:barPr>' + wrap('e', seq(k)) + '</m:bar>';
      return '<m:borderBox><m:borderBoxPr>' + ctrl + '</m:borderBoxPr>' + wrap('e', seq(k)) + '</m:borderBox>';
    }
    case 'mphantom': return '<m:phant><m:phantPr><m:show m:val="0"/>' + ctrl + '</m:phantPr>' + wrap('e', seq(k)) + '</m:phant>';
    case 'merror': return r(textOf(el), 'p', true);
    default: return seq(k);
  }
}

/** MathML string -> <m:oMath>…</m:oMath> (no namespace declarations). */
export function mathmlToOmml(mathml) {
  const root = parseXml(mathml);
  const math = root.children.find(c => c.name === 'math') || root;
  return '<m:oMath>' + conv(math) + '</m:oMath>';
}
