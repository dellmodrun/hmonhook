import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

await build({
  entryPoints: ['launch-client.ts'],
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'JoltworkLaunch',
  inject: ['buffer-shim.js'],
  outfile: 'launch-client.js',
});

await build({
  entryPoints: ['options-browser-client.ts'], bundle: true, minify: true, platform: 'browser',
  format: 'iife', globalName: 'HmonhookOptions', inject: ['buffer-shim.js'], outfile: 'options-browser-client.js',
});
const optionsOutput = await readFile('options-browser-client.js', 'utf8');
await writeFile('options-browser-client.js', optionsOutput.replace(/[ \t]+$/gm, ''), 'utf8');

await build({
  entryPoints: ['intent-client.ts'], bundle: true, minify: true, platform: 'browser',
  format: 'iife', globalName: 'JoltworkIntent', inject: ['buffer-shim.js'], outfile: 'intent-client.js',
});

const intentOutput = await readFile('intent-client.js', 'utf8');
await writeFile('intent-client.js', intentOutput.replace(/[ \t]+$/gm, ''), 'utf8');

const output = await readFile('launch-client.js', 'utf8');
await writeFile('launch-client.js', output.replace(/[ \t]+$/gm, ''), 'utf8');
