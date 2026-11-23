import { build } from 'esbuild';
import { resolve } from 'node:path';

const output = process.argv[2] ? resolve(process.argv[2]) : resolve('services/launch-api/dist/index.js');
await build({ entryPoints: [resolve('services/launch-api/worker.mjs')], bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', outfile: output });
console.log(`Built launch API: ${output}`);
