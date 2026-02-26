import type { Rule } from '../types.js';

export const aiTellRules: Rule[] = [
  {
    id: 'no-obvious-comments',
    name: 'No Obvious Comments',
    description: 'Comments that restate what the code does are noise. AI generates these constantly.',
    category: 'ai-tell',
    severity: 'info',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /\/\/\s*(?:increment|decrement|initialize|declare|define|create|set|get|return|check|loop|iterate|import|require|export|assign|call|invoke|update|fetch|retrieve|store|save|log|print|handle|process)\s+(?:the\s+)?(?:a\s+)?\w+/i,
    antiPattern: /eslint-disable|@ts-|@type|@param|@returns|jsdoc|TODO|FIXME|NOTE|HACK|BUG|WARN/i,
    messageTemplate: 'Comment restates what the code does. Remove it or explain WHY instead.',
  },
  {
    id: 'no-ts-any',
    name: 'No TypeScript any',
    description: '`as any` and `: any` bypass the type system. AI uses these to silence type errors.',
    category: 'ai-tell',
    severity: 'warn',
    languages: ['ts', 'tsx'],
    pattern: /:\s*any\b|as\s+any\b|<any\s*>/,
    antiPattern: /eslint-disable|@ts-expect-error|@ts-ignore|\/\/\s*safe/,
    messageTemplate: 'TypeScript `any` type bypasses type safety. Use a specific type.',
  },
];
