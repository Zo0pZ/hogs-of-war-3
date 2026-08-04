import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const r = await build({
  entryPoints: ['main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  write: false,
  target: 'es2020',
});
const js = r.outputFiles[0].text.replace(/<\/script>/gi, '<\/script>');
const html = readFileSync('template.html', 'utf8').replace('__BUNDLE__', () => js);
writeFileSync('../Hogs of War 3 - Modern Warfare.html', html);
console.log('bundle bytes:', js.length, '| total html bytes:', html.length);
