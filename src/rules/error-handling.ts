import type { Rule, MultilineRule, MultilineFinding } from '../types.js';

export const errorHandlingRules: Rule[] = [
  {
    id: 'no-swallowed-promise',
    name: 'No Swallowed Promises',
    description: 'Promise chains without .catch() silently swallow errors.',
    category: 'error-handling',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /\.then\s*\(.*\)\s*;/,
    antiPattern: /\.catch|\.finally|eslint-disable/,
    messageTemplate: 'Promise .then() without .catch() swallows errors.',
  },
];

export const errorHandlingMultilineRules: MultilineRule[] = [
  {
    id: 'no-empty-catch',
    name: 'No Empty Catch Blocks',
    description: 'Empty catch blocks silently swallow errors, hiding bugs.',
    category: 'error-handling',
    severity: 'error',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    messageTemplate: 'Empty catch block swallows errors silently.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Single-line empty catch: catch (e) { }
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
          findings.push({
            line: i + 1,
            column: line.search(/catch/) + 1,
            message: 'Empty catch block swallows errors silently.',
            snippet: line,
          });
          continue;
        }
        // Multi-line empty catch
        if (/catch\s*\([^)]*\)\s*\{/.test(line)) {
          const next = lines[i + 1]?.trim();
          const nextNext = lines[i + 2]?.trim();
          if (next === '}' || (next === '' && nextNext === '}')) {
            findings.push({
              line: i + 1,
              column: line.search(/catch/) + 1,
              message: 'Empty catch block swallows errors silently.',
              snippet: line,
            });
          }
          // Catch with only a comment (TODO/FIXME)
          if (next && /^\/\/\s*(todo|fixme|ignore|suppress)/i.test(next) && lines[i + 2]?.trim() === '}') {
            findings.push({
              line: i + 1,
              column: line.search(/catch/) + 1,
              message: 'Catch block only contains a TODO comment, errors are still swallowed.',
              snippet: line,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'no-console-error-only',
    name: 'No Console-Only Error Handling',
    description: 'Catch blocks that only console.log/error without rethrowing or returning are incomplete error handling.',
    category: 'error-handling',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    messageTemplate: 'Catch block only logs the error without rethrowing or handling it.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/catch\s*\([^)]*\)\s*\{/.test(line)) continue;

        // Count only braces from the catch block's opening {
        let braceDepth = 1;
        let onlyConsole = true;
        let hasConsole = false;
        let j = i + 1;

        for (; j < lines.length && braceDepth > 0; j++) {
          const l = lines[j];
          for (const ch of l) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
            if (braceDepth === 0) break;
          }

          if (braceDepth > 0) {
            const trimmed = l.trim();
            if (trimmed === '' || trimmed === '{') continue;
            if (/^\s*console\.(log|error|warn|info)\s*\(/.test(l)) {
              hasConsole = true;
            } else if (!/^\s*\/\//.test(l)) {
              onlyConsole = false;
            }
          }
        }

        if (hasConsole && onlyConsole) {
          findings.push({
            line: i + 1,
            column: line.search(/catch/) + 1,
            message: 'Catch block only logs the error. Consider rethrowing or returning an error.',
            snippet: line,
          });
        }
      }
      return findings;
    },
  },
];
