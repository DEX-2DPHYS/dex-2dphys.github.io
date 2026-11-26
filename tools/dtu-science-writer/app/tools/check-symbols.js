/* Finds tex2typst symbol names that the pinned Typst version rejects and writes a fix-up table
   (Typst name -> Unicode character) to src/core/typst-symfix.json. Run after updating Typst or tex2typst:
   node tools/check-symbols.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const BUILD = path.join(process.env.LOCALAPPDATA, 'dtu-science-writer-build');
const typstExe = path.join(BUILD, 'bin', 'typst.exe');

(async () => {
  const t2t = await import(pathToFileURL(path.join(BUILD, 'node_modules', 'tex2typst', 'dist', 'index.js')).href);
  const ml = await import(pathToFileURL(path.join(BUILD, 'node_modules', 'mathlive', 'mathlive-ssr.min.mjs')).href);
  const entries = [...t2t.symbolMap.entries()];            // tex command (no backslash) -> typst name
  const names = [...new Set(entries.map(([, v]) => v).filter(v => /^[a-zA-Z][\w.]*$/.test(v)))];
  const dir = path.join(__dirname, '.build');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'symbols.typ');
  // Typst stops at the first evaluation error: blank out each rejected line and compile again until clean
  const lines = names.map(n => '$' + n + '$');
  const badLines = new Set();
  for (let round = 0; round < 400; round++) {
    fs.writeFileSync(file, lines.join('\n') + '\n');
    let stderr = '';
    try { execFileSync(typstExe, ['compile', '--ignore-system-fonts', '--diagnostic-format', 'short', file, path.join(dir, 'symbols.pdf')], { stdio: 'pipe' }); }
    catch (e) { stderr = String(e.stderr); }
    const m = stderr.match(/symbols\.typ:(\d+):\d+: error/);
    if (!m) break;
    badLines.add(+m[1]);
    lines[+m[1] - 1] = '';
  }
  const fix = {};
  for (const ln of badLines) {
    const name = names[ln - 1];
    const tex = entries.find(([, v]) => v === name)[0];
    const mml = ml.convertLatexToMathMl('\\' + tex);
    const m = mml.match(/<m[oi][^>]*>([^<]+)<\/m[oi]>/);
    let ch = m ? m[1] : null;
    if (ch && /^&#x?[0-9a-f]+;$/i.test(ch)) ch = String.fromCodePoint(ch[2] === 'x' ? parseInt(ch.slice(3, -1), 16) : parseInt(ch.slice(2, -1), 10));
    if (ch && [...ch].length === 1) fix[name] = ch;
    else console.log('no Unicode fallback for', name, '(\\' + tex + ')', mml.slice(0, 80));
  }
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'core', 'typst-symfix.json'), JSON.stringify(fix, null, 1) + '\n');
  console.log(names.length + ' symbol names checked, ' + badLines.size + ' rejected by Typst, ' + Object.keys(fix).length + ' fixed');
  console.log(Object.entries(fix).map(([k, v]) => k + ' -> ' + v).join(', '));
})();
