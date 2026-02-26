import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node18',
    clean: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    splitting: false,
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    dts: true,
    sourcemap: true,
    splitting: false,
  },
]);
