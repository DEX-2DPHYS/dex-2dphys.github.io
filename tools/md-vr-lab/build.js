// Bundles src/main.js with esbuild and inlines it into template.html -> one self-contained index.html
// (Three.js 0.170 bundled inline, works offline). Edit src/, never the generated index.html.
//
//   npm install three@0.170.0 esbuild@0.24.0     (in this folder, or point MDLAB_NODE_MODULES at an existing node_modules)
//   node build.js            -> writes index.html next to this file
const fs = require('fs');
const path = require('path');
const here = __dirname;
const MODULES = [process.env.MDLAB_NODE_MODULES, path.join(here, 'node_modules')].filter((p) => p && fs.existsSync(p));
if (!MODULES.length) { console.error('no node_modules found: run  npm install three@0.170.0 esbuild@0.24.0'); process.exit(1); }
const esbuild = require(path.join(MODULES[0], 'esbuild'));
const built = esbuild.buildSync({
  entryPoints: [path.join(here, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, target: ['es2020'], legalComments: 'none',
  nodePaths: MODULES, write: false, outfile: 'bundle.js', logLevel: 'warning',
});
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const js = built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = tpl.replace('<!--BUNDLE-->', () => '<script>\n' + js + '\n</script>');
const out = process.argv[2] || path.join(here, 'index.html');
fs.writeFileSync(out, html); console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
