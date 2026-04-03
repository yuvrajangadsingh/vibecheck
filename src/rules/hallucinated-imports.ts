import type { Rule } from '../types.js';

// Confirmed nonexistent packages that AI models frequently hallucinate.
// Every entry verified as 404 on npm/PyPI as of April 2026.
// Real package noted in comments so users know the correct import.

const jsPackages = [
  '@anthropic/sdk',                  // real: @anthropic-ai/sdk
  '@openai/api',                     // real: openai
  '@langchain/agents',               // real: langchain or @langchain/core
  '@types/react-router-v5',          // real: @types/react-router
  'next-auth-prisma',                // real: @auth/prisma-adapter
  'node-cron-scheduler',             // real: node-cron
  'jwt-decode-utils',                // real: jwt-decode
  'prettier-plugin-tailwindcss-v2',  // real: prettier-plugin-tailwindcss
  'webpack-bundle-analyzer-plugin',  // real: webpack-bundle-analyzer
  'vite-plugin-react-swc-refresh',   // real: @vitejs/plugin-react-swc
];

const pyPackages = [
  'pandas-profiler',                 // real: ydata-profiling (was pandas-profiling)
  'langchain-agents',                // real: langchain
  'langchain-memory',                // real: langchain
  'langchain-vectorstores',          // real: langchain-community or langchain
  'openai-embeddings',               // real: openai
  'chromadb-utils',                  // real: chromadb
  'pinecone-utils',                  // real: pinecone
  'flask-cors-headers',              // real: flask-cors
  'django-rest-framework-jwt',       // real: djangorestframework-simplejwt
  'anthropic-sdk',                   // real: anthropic
  'requests-toolbelt-session',       // real: requests-toolbelt
  'tensorflow-datasets-nightly',     // real: tfds-nightly
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const jsAlt = jsPackages.map(escapeRegExp).join('|');

// Python uses underscores for imports, so match both - and _
const pyAlt = pyPackages.map(p => escapeRegExp(p).replace(/-/g, '[_-]')).join('|');

export const hallucinatedImportRules: Rule[] = [
  {
    id: 'no-hallucinated-import-js',
    name: 'No Hallucinated JS/TS Imports',
    description: 'Detects imports of packages that are known AI hallucinations and don\'t exist on npm.',
    category: 'ai-tell',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: new RegExp(
      `(?:^|\\s)(?:import\\s+.*?from\\s+|import\\s*\\(\\s*|export\\s+.*?from\\s+|require\\s*\\(\\s*)['"\`](${jsAlt})['"\`]`
    ),
    antiPattern: /\/\/|\/\*|\*\//,
    messageTemplate: 'Suspicious import: this package name looks hallucinated. Verify it exists on npm.',
  },
  {
    id: 'no-hallucinated-import-py',
    name: 'No Hallucinated Python Imports',
    description: 'Detects imports of packages that are known AI hallucinations and don\'t exist on PyPI.',
    category: 'ai-tell',
    severity: 'warn',
    languages: ['py'],
    pattern: new RegExp(
      `(?:^|\\s)(?:import|from)\\s+(${pyAlt})(?:\\s|\\.|,|$)`
    ),
    antiPattern: /^\s*#/,
    messageTemplate: 'Suspicious import: this package name looks hallucinated. Verify it exists on PyPI.',
  },
];
