/* Build: bundle the renderer (src/ -> renderer/bundle.js), copy MathLive's CSS and fonts,
   and bundle the pure core for Node tests (tools/.build/core.cjs).
   Dependencies live outside Dropbox in %LOCALAPPDATA%\dtu-science-writer-build (see README). */
'use strict';
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(process.env.LOCALAPPDATA, 'dtu-science-writer-build');
const NM = path.join(BUILD, 'node_modules');
const req = createRequire(path.join(BUILD, 'package.json'));
const esbuild = req('esbuild');

const watch = process.argv.includes('--watch');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(s).size) fs.copyFileSync(s, d);
  }
}

/** Syntax-check the main-process files (they are not bundled, so esbuild would not notice an error there). */
function checkMain() {
  const { execFileSync } = require('child_process');
  for (const f of fs.readdirSync(path.join(ROOT, 'main')).filter(n => n.endsWith('.js'))) {
    try { execFileSync(process.execPath, ['--check', path.join(ROOT, 'main', f)], { stdio: 'pipe' }); }
    catch (e) { throw new Error('syntax error in main/' + f + ':\n' + String(e.stderr)); }
  }
}

async function main() {
  checkMain();
  // MathLive static assets (fonts + CSS for typeset equations)
  const ml = path.join(NM, 'mathlive');
  const mlOut = path.join(ROOT, 'renderer', 'mathlive');
  copyDir(path.join(ml, 'fonts'), path.join(mlOut, 'fonts'));
  fs.copyFileSync(path.join(ml, 'mathlive-static.css'), path.join(mlOut, 'mathlive-static.css'));
  fs.copyFileSync(path.join(ml, 'mathlive-fonts.css'), path.join(mlOut, 'mathlive-fonts.css'));

  // citation styles and locales are bundled as text
  const common = { bundle: true, nodePaths: [NM], logLevel: 'warning', legalComments: 'none', target: 'es2022', loader: { '.csl': 'text', '.xml': 'text' } };
  const rendererOpts = {
    ...common,
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'app.js')],
    outfile: path.join(ROOT, 'renderer', 'bundle.js'),
    format: 'iife', platform: 'browser', sourcemap: 'linked', minify: false,
    conditions: ['production'],
  };
  const coreOpts = {
    ...common,
    entryPoints: [path.join(ROOT, 'tools', 'core-entry.js')],
    outfile: path.join(ROOT, 'tools', '.build', 'core.cjs'),
    format: 'cjs', platform: 'node',
  };
  if (watch) {
    const ctx = await esbuild.context(rendererOpts);
    await ctx.watch();
    console.log('watching src/ …');
    return;
  }
  const t0 = Date.now();
  await esbuild.build(rendererOpts);
  await esbuild.build(coreOpts);
  console.log('built renderer/bundle.js and tools/.build/core.cjs in ' + (Date.now() - t0) + ' ms');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
