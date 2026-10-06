// Bundles src/main.js with esbuild and inlines it into template.html -> self-contained HTML.
//
// node_modules are kept OUTSIDE Dropbox so the sync never sees thousands of files; the
// shared folder below already carries the two dependencies this needs (three@0.170.0,
// esbuild@0.24.0). A local salmonella-src/node_modules, if you make one, wins.
//
//   node build.js "../salmonella.html"
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

esbuild.buildSync({
  entryPoints: [path.join(here, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, target: ['es2020'], legalComments: 'none',
  nodePaths: MODULES,
  outfile: path.join(here, 'dist/bundle.js'), logLevel: 'warning',
});
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const js = fs.readFileSync(path.join(here, 'dist/bundle.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = tpl.replace('<!--BUNDLE-->', () => '<script>\n' + js + '\n</script>');
const outs = process.argv.slice(2);
if (!outs.length) outs.push(path.join(here, 'dist/salmonella.html'));
for (const o of outs) { fs.mkdirSync(path.dirname(path.resolve(o)), { recursive: true }); fs.writeFileSync(o, html); console.log('wrote', o, (html.length / 1024).toFixed(0) + ' KB'); }
