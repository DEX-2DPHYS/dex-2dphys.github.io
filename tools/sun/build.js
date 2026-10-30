// Bundles src/main.js with esbuild and inlines it into template.html -> one self-contained HTML
// file that runs offline from file:// (same scheme as the salmonella model).
//
// node_modules are kept OUTSIDE Dropbox: the shared folder %LOCALAPPDATA%\ulam-build carries
// three@0.170.0 and esbuild@0.24.0. A local sun-src/node_modules, if you make one, wins.
//
//   node build.js "../SunTextbook.html"
const fs = require('fs');
const path = require('path');

const here = __dirname;
const MODULES = [
  path.join(here, 'node_modules'),
  path.join(process.env.LOCALAPPDATA || '', 'ulam-build', 'node_modules'),
].filter((p) => fs.existsSync(p));
if (!MODULES.length) {
  console.error('no node_modules found; run:  mkdir %LOCALAPPDATA%\\ulam-build && cd /d %LOCALAPPDATA%\\ulam-build && npm install three@0.170.0 esbuild@0.24.0');
  process.exit(1);
}
const esbuild = require(path.join(MODULES[0], 'esbuild'));

const lang = 'en';
esbuild.buildSync({
  entryPoints: [path.join(here, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, target: ['es2020'], legalComments: 'none',
  nodePaths: MODULES,
  alias: { 'sun-content': path.join(here, 'src', 'content', `${lang}.js`) },
  outfile: path.join(here, 'dist/bundle.js'), logLevel: 'warning',
});
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const js = fs.readFileSync(path.join(here, 'dist/bundle.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
// replacer function: the bundle contains $` sequences that String.replace would expand
const html = tpl.replace('<!--BUNDLE-->', () => '<script>\n' + js + '\n</script>');
const outs = process.argv.slice(2);
if (!outs.length) outs.push(path.join(here, 'dist/sun.html'));
for (const o of outs) { fs.mkdirSync(path.dirname(path.resolve(o)), { recursive: true }); fs.writeFileSync(o, html); console.log('wrote', o, (html.length / 1024).toFixed(0) + ' KB'); }
