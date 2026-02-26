import type { Rule, MultilineRule, MultilineFinding } from '../types.js';

export const codeQualityRules: Rule[] = [
  {
    id: 'no-console-pollution',
    name: 'No Console Pollution',
    description: 'console.log/debug/info left in production code pollutes output and leaks info.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /console\.(log|debug|info)\s*\(/,
    antiPattern: /eslint-disable|\/\/\s*keep|logger|debug\.(js|ts)|\.test\.|\.spec\.|__tests__/,
    messageTemplate: 'console.log left in production code.',
  },
  {
    id: 'no-ai-todo',
    name: 'No AI Placeholder TODOs',
    description: 'AI assistants leave placeholder TODOs that never get implemented.',
    category: 'code-quality',
    severity: 'info',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME|HACK|XXX)\s*:?\s*(?:implement|add|fix|handle|replace|update|complete|finish|create|write|build|setup|configure|refactor)\b/i,
    messageTemplate: 'AI-generated placeholder TODO found. Implement or remove it.',
  },
];

export const codeQualityMultilineRules: MultilineRule[] = [
  {
    id: 'no-god-function',
    name: 'No God Functions',
    description: 'Functions over 80 lines are hard to test, debug, and maintain. AI generates these frequently.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    messageTemplate: 'Function exceeds 80 lines. Break it into smaller functions.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];
      const funcPattern = /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(\w+)\s*(?::\s*\w[^=]*)?\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\s*\{)/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = funcPattern.exec(line);
        if (!match) continue;

        const funcName = match[1] || match[2] || match[3] || 'anonymous';
        const openBraceIdx = line.indexOf('{', match.index);
        if (openBraceIdx === -1) continue;

        let braceDepth = 0;
        let funcEnd = i;

        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
          }
          if (braceDepth === 0) {
            funcEnd = j;
            break;
          }
        }

        const lineCount = funcEnd - i + 1;
        if (lineCount > 80) {
          findings.push({
            line: i + 1,
            column: 1,
            message: `Function '${funcName}' is ${lineCount} lines long (max 80). Break it into smaller functions.`,
            snippet: line,
          });
        }
      }
      return findings;
    },
  },
];
