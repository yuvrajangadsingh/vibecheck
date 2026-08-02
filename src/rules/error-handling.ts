import type { Rule, MultilineRule, MultilineFinding } from '../types.js';
import { maskLines } from '../lexer.js';

// Matches both catch(e) { and catch { (parameterless, ES2019+)
const CATCH_OPEN = /catch\s*(?:\([^)]*\))?\s*\{/;

// Counts braces on a lexer-masked line (strings/templates/regexes/comments
// already blanked, so every remaining brace is structural).
function countBraces(maskedLine: string, depth: number): number {
  for (const ch of maskedLine) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  return depth;
}

/**
 * Index of the `}` that closes the block opened by the first char of
 * `maskedAfterBrace` (which must be `{`), or -1 if it does not close on this
 * line. Keeps single-line body extraction from running past the catch block
 * when outer scopes also close on the same line (`} catch (e) { x(); } };`).
 */
function matchingBraceEnd(maskedAfterBrace: string): number {
  let depth = 0;
  for (let k = 0; k < maskedAfterBrace.length; k++) {
    const ch = maskedAfterBrace[k];
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return k; }
  }
  return -1;
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
  {
    id: 'no-vague-error',
    name: 'No Vague Error Messages',
    description: 'Vague error messages at creation/propagation surfaces make failures undebuggable.',
    category: 'error-handling',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /\b(?:throw\s+(?:new\s+)?(?:[A-Za-z_$][\w$]*)?Error|(?:return\s+)?Promise\.reject|(?<![\w$.])reject)\s*\(\s*(?:new\s+(?:[A-Za-z_$][\w$]*)?Error\s*\(\s*)?(['"`])\s*(?:something\s+went\s+wrong|an\s+error\s+occurred|unknown\s+error|internal\s+error|server\s+error|error|failed|failure|request\s+failed|oops|whoops)\s*[.!]?\s*\1/i,
    antiPattern: /^\s*(?:\/\/|\/\*|\*)|eslint-disable|\/\/\s*(?:safe|intentional|example|fixture|test)/i,
    messageTemplate: 'Vague error message. Add context (what failed, why, identifying data) so callers and logs are debuggable.',
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
      const masked = maskLines(lines);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Discovery runs on the masked line so a `catch (e) {}` written inside a
        // string, template, regex, or comment can never be mistaken for real
        // code. Raw `line` is used only for the snippet (offsets are identical).
        const structural = masked[i];

        // Single-line empty catch: catch (e) { } or catch { }
        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(structural)) {
          findings.push({
            line: i + 1,
            column: structural.search(/catch/) + 1,
            message: 'Empty catch block swallows errors silently.',
            snippet: line,
          });
          continue;
        }

        if (!CATCH_OPEN.test(structural)) continue;

        // Check if catch block closes on the same line (single-line with content).
        // Depth runs on the masked line: braces inside strings/regexes must not
        // count, and outer scopes closing after the catch can push the count
        // below zero — any <= 0 means the catch body ended on this line.
        const catchIdx = structural.search(/catch/);
        const braceIdx = structural.indexOf('{', catchIdx);
        if (braceIdx === -1) continue;
        const sameLineDepth = countBraces(structural.substring(braceIdx), 0);
        if (sameLineDepth <= 0) continue; // Block opened and closed on same line

        // Scan the catch block body using brace tracking
        let depth = sameLineDepth;
        let hasRealContent = false;
        let hasTodoComment = false;

        for (let j = i + 1; j < lines.length && depth > 0; j++) {
          const trimmed = lines[j].trim();
          // Break only when this line closes the catch itself (depth 1 -> 0). A
          // trailing `finally {` / `else {` on that line belongs to the
          // surrounding statement (fixes the empty-catch-before-finally FN),
          // while a `}` that closes a nested block opened on the catch line
          // (depth > 1) must not be mistaken for the catch's end (avoids a FP).
          if (depth === 1 && /^\}/.test(masked[j].trim())) break;

          const prevDepth = depth;
          depth = countBraces(masked[j], depth);

          if (prevDepth > 0) {
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
      const masked = maskLines(lines);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Discover the catch on the masked line: `catch (e) {` inside a string
        // or comment must not match (raw line is kept for snippet/body only).
        const structural = masked[i];
        if (!CATCH_OPEN.test(structural)) continue;

        const catchIdx = structural.search(/catch/);
        const braceIdx = structural.indexOf('{', catchIdx);
        if (braceIdx === -1) continue;

        // Check if block closes on same line
        const afterBrace = line.substring(braceIdx);
        const maskedAfterBrace = structural.substring(braceIdx);
        const closeIdx = matchingBraceEnd(maskedAfterBrace);

        let onlyConsole = true;
        let hasConsole = false;

        if (closeIdx !== -1) {
          // Single-line catch block: body runs to the brace that closes THIS
          // block, not to the line's last `}` (outer scopes may close after it).
          const body = afterBrace.substring(1, closeIdx).trim();
          if (body === '') continue; // Empty, handled by no-empty-catch
          if (/^console\.(log|error|warn|info)\s*\(/.test(body)) {
            hasConsole = true;
          } else {
            onlyConsole = false;
          }
        } else {
          // Multi-line: scan body
          let depth = countBraces(maskedAfterBrace, 0);
          for (let j = i + 1; j < lines.length && depth > 0; j++) {
            const l = lines[j];
            const prevDepth = depth;
            depth = countBraces(masked[j], depth);

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
