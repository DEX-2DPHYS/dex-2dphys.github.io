// node tools/extract-strings.cjs > strings.json
// Lists every string literal in the display code that looks like text a user reads (for the translation table src/i18n-da.js).
// Template literals become templates with {1}, {2} ... in place of the ${...} parts.
const fs = require('fs'), path = require('path');
const files = ['src/main.js', 'src/content.js', 'src/plots.js', 'src/materials.js', 'src/tb.js', 'src/chem.js'].map((f) => path.join(__dirname, '..', f));
const out = new Map();
const looksLikeText = (s) => /[A-Za-z]{2}/.test(s) && (/\s/.test(s) || /^[A-Z][a-z]/.test(s)) && !/^(?:\d+ )?\d*px |system-ui|monospace|^#|^rgba?\(|=>|^\w+\(|^text\/|^mdlab\.|^https?:|^\.\.?\//.test(s) && s.length < 900;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1; while (j < src.length && src[j] !== ch) { if (src[j] === '\\') j++; j++; }
      const lit = src.slice(i, j + 1); i = j + 1;
      let s; try { s = new Function('return ' + lit)(); } catch (e) { continue; }
      if (looksLikeText(s)) out.set(s, { en: s, file: path.basename(f) });
      continue;
    }
    if (ch === '`') {
      let j = i + 1; const parts = []; let cur = '', depth = 0, n = 0;
      while (j < src.length) {
        if (src[j] === '\\') { cur += src[j] + src[j + 1]; j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { parts.push(cur); cur = ''; depth = 1; j += 2; while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; } n++; parts.push({ ph: n }); continue; }
        cur += src[j]; j++;
      }
      parts.push(cur); i = j + 1;
      let text = '';
      try { for (const p of parts) text += typeof p === 'string' ? new Function('return `' + p + '`')() : `{${p.ph}}`; } catch (e) { continue; }
      if (looksLikeText(text.replace(/\{\d+\}/g, ' '))) out.set(text, { en: text, file: path.basename(f), template: n > 0 });
      continue;
    }
    i++;
  }
}
console.log(JSON.stringify([...out.values()], null, 1));
