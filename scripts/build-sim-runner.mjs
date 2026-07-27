import { build } from 'esbuild';

await build({
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  entryPoints: ['src/sim-runner/cli.ts'],
  format: 'esm',
  outfile: 'dist/cache-sim.mjs',
  platform: 'node',
  target: 'node20',
});
