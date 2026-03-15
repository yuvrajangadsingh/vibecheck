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
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'py'],
    pattern: /(?:\/\/|\/\*|\*|#)\s*(?:TODO|FIXME|HACK|XXX)\s*:?\s*(?:implement|add|fix|handle|replace|update|complete|finish|create|write|build|setup|configure|refactor)\b/i,
    messageTemplate: 'AI-generated placeholder TODO found. Implement or remove it.',
  },
];

const CONTROL_FLOW_KEYWORDS = /^(if|else|for|while|do|switch|catch|finally|with|return|throw|new|delete|typeof|void|yield|await|class|try|import|export|from|as)$/;

// Counts braces while skipping string/template literal contents
function trackBraceDepth(line: string, depth: number): number {
  let inStr: string | null = null;
  let escaped = false;
  for (const ch of line) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  return depth;
}

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

        // Skip control-flow keywords matched by the 3rd capture group
        if (CONTROL_FLOW_KEYWORDS.test(funcName)) continue;

        const openBraceIdx = line.indexOf('{', match.index);
        if (openBraceIdx === -1) continue;

        let braceDepth = 0;
        let funcEnd = i;

        for (let j = i; j < lines.length; j++) {
          braceDepth = trackBraceDepth(lines[j], braceDepth);
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
