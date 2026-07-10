import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

const versionDefine = { __VERSION__: JSON.stringify(version) };

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node18',
    clean: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    splitting: false,
    define: versionDefine,
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    dts: true,
    sourcemap: true,
    splitting: false,
    define: versionDefine,
  },
  {
    entry: { mcp: 'src/mcp.ts', 'mcp-bin': 'src/mcp-bin.ts' },
    format: ['esm'],
    target: 'node18',
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    splitting: false,
    define: versionDefine,
  },
]);
