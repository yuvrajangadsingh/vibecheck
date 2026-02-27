import type { Rule, MultilineRule, MultilineFinding } from '../types.js';

// Matches both catch(e) { and catch { (parameterless, ES2019+)
const CATCH_OPEN = /catch\s*(?:\([^)]*\))?\s*\{/;

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

export const errorHandlingRules: Rule[] = [
  {
    id: 'no-swallowed-promise',
    name: 'No Swallowed Promises',
    description: 'Promise chains without .catch() silently swallow errors.',
    category: 'error-handling',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /\.then\s*\(.*\)\s*;?\s*$/,
    antiPattern: /\.catch|\.finally|eslint-disable/,
    lineExclusions: /pattern:|new RegExp/,
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

        // Single-line empty catch: catch (e) { } or catch { }
        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) {
          findings.push({
            line: i + 1,
            column: line.search(/catch/) + 1,
            message: 'Empty catch block swallows errors silently.',
            snippet: line,
          });
          continue;
        }

        if (!CATCH_OPEN.test(line)) continue;

        // Check if catch block closes on the same line (single-line with content)
        const catchIdx = line.search(/catch/);
        const braceIdx = line.indexOf('{', catchIdx);
        if (braceIdx === -1) continue;
        const afterBrace = line.substring(braceIdx);
        const sameLineDepth = trackBraceDepth(afterBrace, 0);
        if (sameLineDepth === 0) continue; // Block opened and closed on same line

        // Scan the catch block body using brace tracking
        let depth = sameLineDepth;
        let hasRealContent = false;
        let hasTodoComment = false;

        for (let j = i + 1; j < lines.length && depth > 0; j++) {
          const prevDepth = depth;
          depth = trackBraceDepth(lines[j], depth);

          if (prevDepth > 0) {
            const trimmed = lines[j].trim();
            if (trimmed === '' || trimmed === '}') continue;
            if (/^\/\/\s*(todo|fixme|ignore|suppress)/i.test(trimmed)) {
              hasTodoComment = true;
            } else {
              hasRealContent = true;
            }
          }
        }

        if (!hasRealContent && !hasTodoComment) {
          findings.push({
            line: i + 1,
            column: line.search(/catch/) + 1,
            message: 'Empty catch block swallows errors silently.',
            snippet: line,
          });
        } else if (!hasRealContent && hasTodoComment) {
          findings.push({
            line: i + 1,
            column: line.search(/catch/) + 1,
            message: 'Catch block only contains a TODO comment, errors are still swallowed.',
            snippet: line,
          });
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
        if (!CATCH_OPEN.test(line)) continue;

        // Find the catch block's opening brace
        const catchIdx = line.search(/catch/);
        const braceIdx = line.indexOf('{', catchIdx);
        if (braceIdx === -1) continue;

        // Check if block closes on same line
        const afterBrace = line.substring(braceIdx);
        const sameLineDepth = trackBraceDepth(afterBrace, 0);

        let onlyConsole = true;
        let hasConsole = false;

        if (sameLineDepth === 0) {
          // Single-line catch block: extract body between { and last }
          const body = afterBrace.substring(1, afterBrace.lastIndexOf('}')).trim();
          if (body === '') continue; // Empty, handled by no-empty-catch
          if (/^console\.(log|error|warn|info)\s*\(/.test(body)) {
            hasConsole = true;
          } else {
            onlyConsole = false;
          }
        } else {
          // Multi-line: scan body
          let depth = sameLineDepth;
          for (let j = i + 1; j < lines.length && depth > 0; j++) {
            const l = lines[j];
            const prevDepth = depth;
            depth = trackBraceDepth(l, depth);

            if (prevDepth > 0) {
              const trimmed = l.trim();
              if (trimmed === '' || trimmed === '{' || trimmed === '}') continue;
              if (/^\s*console\.(log|error|warn|info)\s*\(/.test(l)) {
                hasConsole = true;
              } else if (!/^\s*\/\//.test(l)) {
                onlyConsole = false;
              }
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
