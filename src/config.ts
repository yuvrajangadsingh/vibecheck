import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './types.js';

const DEFAULT_IGNORE = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  '*.min.js',
  '*.min.mjs',
  '*.bundle.js',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

const DEFAULT_INCLUDE = ['**/*.{js,ts,jsx,tsx,mjs,cjs}'];

const DEFAULT_CONFIG: Config = {
  rules: {},
  ignore: DEFAULT_IGNORE,
  include: DEFAULT_INCLUDE,
};

export function loadConfig(configPath?: string): Config {
  const searchPaths = configPath
    ? [resolve(configPath)]
    : [
        resolve('.vibecheckrc'),
        resolve('.vibecheckrc.json'),
        resolve('vibecheck.config.json'),
      ];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<Config>;
        return {
          rules: { ...DEFAULT_CONFIG.rules, ...parsed.rules },
          ignore: parsed.ignore ?? DEFAULT_CONFIG.ignore,
          include: parsed.include ?? DEFAULT_CONFIG.include,
        };
      } catch {
        // invalid config, use defaults
      }
    }
  }

  return DEFAULT_CONFIG;
}
