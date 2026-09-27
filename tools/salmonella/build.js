// Bundles src/main.js with esbuild and inlines it into template.html -> self-contained HTML.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const here = __dirname;
esbuild.buildSync({
  entryPoints: [path.join(here, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, target: ['es2020'], legalComments: 'none',
  outfile: path.join(here, 'dist/bundle.js'), logLevel: 'warning',
});
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const js = fs.readFileSync(path.join(here, 'dist/bundle.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = tpl.replace('<!--BUNDLE-->', () => '<script>\n' + js + '\n</script>');
const outs = process.argv.slice(2);
if (!outs.length) outs.push(path.join(here, 'dist/salmonella.html'));
for (const o of outs) { fs.writeFileSync(o, html); console.log('wrote', o, (html.length / 1024).toFixed(0) + ' KB'); }
