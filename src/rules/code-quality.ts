import type { Rule, MultilineRule, MultilineFinding } from '../types.js';
import { maskLines } from '../lexer.js';

export const codeQualityRules: Rule[] = [
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
  {
    id: 'no-double-assertion',
    name: 'No Double Type Assertion',
    description: 'Chained type assertions like `as unknown as T` bypass TypeScript safety. AI chains these to silence type errors it does not understand.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['ts', 'tsx'],
    pattern: /\bas\s+(?:unknown|any|never|const|[A-Za-z_$][\w$]*(?:\s*<[^;\n]*?>)?(?:\s*\[\])?)\s*\)?\s+as\s+(?:unknown|any|never|const|[A-Za-z_$][\w$]*(?:\s*<[^;\n]*?>)?(?:\s*\[\])?)/,
    // vibecheck-ignore handling moved to the scanner-level suppression pre-pass (suppressions.ts)
    antiPattern: /^\s*(?:\/\/|\/\*|\*)|eslint-disable|@ts-expect-error|@ts-ignore|\/\/\s*(?:safe|intentional)|\/\*\s*(?:safe|intentional)/i,
    messageTemplate: 'Double type assertion bypasses TypeScript safety. Isolate and justify, or refactor to a safer cast.',
  },
  {
    id: 'no-ai-attribution',
    name: 'No AI Attribution Comments',
    description: 'AI attribution comments leak model provenance into repos and often violate internal policies.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'py'],
    pattern: /^\s*(?:\/\/|\/\*+|\*|#)\s*(?:(?:generated|created|written|authored|co-?authored|made|produced)\s+(?:by|with|using)\s+(?:chatgpt|gpt-?\d(?:[.\w-]*)?|claude(?:\s+code)?|anthropic(?:\s+claude)?|openai|github\s+copilot|copilot|gemini)|(?:ai|llm)[-\s]*generated|(?:chatgpt|gpt-?\d(?:[.\w-]*)?|claude(?:\s+code)?|anthropic\s+claude|github\s+copilot|copilot|gemini)\s+(?:generated|wrote|created|authored|made|produced)\b|co-?authored-by:\s*(?:claude|chatgpt|openai|anthropic|copilot|gemini)|(?:anthropic\s+claude|claude\s+code|chatgpt|gpt-?\d(?:[.\w-]*)?)\s*(?:\*\/)?\s*$)/i,
    antiPattern: /(?:anti-?pattern|example|fixture|snapshot|golden|test\s+case|do\s+not|don't|dont|avoid|\bdocs?\b|readme|changelog|prompt|expected|should\s+(?:flag|match|skip|not\s+match)|eslint-disable)/i,
    messageTemplate: 'AI attribution comment found. Remove model provenance leakage from production code.',
    fix: 'remove-line',
  },
];

const CONTROL_FLOW_KEYWORDS = /^(if|else|for|while|do|switch|catch|finally|with|return|throw|new|delete|typeof|void|yield|await|class|try|import|export|from|as)$/;

// Counts braces on a lexer-masked line (strings/templates/regexes/comments
// already blanked, so every remaining brace is structural).
function countBraces(maskedLine: string, depth: number): number {
  for (const ch of maskedLine) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  return depth;
}

// Same walk, but also reports the lowest depth reached mid-line. That
// low-water mark is what catches `} else {`: the guarded block ends partway
// through the line even though depth ends up back where it started.
function scanBraces(maskedLine: string, depth: number): { end: number; min: number } {
  let min = depth;
  for (const ch of maskedLine) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < min) min = depth;
    }
  }
  return { end: depth, min };
}

// Build-time flags whose blocks bundlers eliminate from production output.
// `NODE_ENV === 'production'` is deliberately absent: that guards a block that
// DOES ship, so console inside it is still pollution.
const DEV_GUARD =
  /\b(?:import\.meta\.env\.DEV\b|__DEV__\b|(?:import\.meta\.env\.MODE|process\.env\.NODE_ENV)\s*!==?\s*['"]production['"]|process\.env\.NODE_ENV\s*===?\s*['"](?:development|dev|test)['"])/;

// Only treat the flag as a guard when it actually gates something.
// `const isDev = import.meta.env.DEV;` is a read, not a gate.
const GUARD_CONTEXT = /\bif\s*\(|&&|\|\||\?/;

// stdout is the product in a CLI entrypoint, not leakage.
const CLI_DIRS = /(?:^|[/\\])(?:scripts|bin|tools|tasks)[/\\]/;

const CONSOLE_CALL = /console\.(?:log|debug|info)\s*\(/;
const CONSOLE_ANTI = /eslint-disable|\/\/\s*keep|logger/;
const CONSOLE_FILE_EXCLUSIONS =
  /(?:^|[/\\])debug\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|[/\\])__tests__[/\\]/;

export const codeQualityMultilineRules: MultilineRule[] = [
  {
    // Multiline because what makes a console call harmless usually sits on a
    // DIFFERENT line: a build-time guard whose body never reaches production.
    // A line-scoped antiPattern cannot see it — the scanner tests antiPattern
    // against the current line only.
    id: 'no-console-pollution',
    name: 'No Console Pollution',
    description:
      'console.log/debug/info left in production code pollutes output and leaks info. Calls inside build-stripped dev guards, and in CLI entrypoints, are ignored.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    messageTemplate: 'console.log left in production code.',
    detect(lines: string[], filePath: string): MultilineFinding[] {
      if (CONSOLE_FILE_EXCLUSIONS.test(filePath) || CLI_DIRS.test(filePath)) return [];

      const findings: MultilineFinding[] = [];
      const masked = maskLines(lines);
      // Depths at which currently-open dev-guarded blocks live.
      const devDepths: number[] = [];
      let depth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const { end, min } = scanBraces(masked[i], depth);

        // Close any guarded block whose depth we dipped out of on this line.
        // Runs before the console check so `} else {` un-guards its own line.
        while (devDepths.length && min < devDepths[devDepths.length - 1]) devDepths.pop();

        const guardsHere = DEV_GUARD.test(line) && GUARD_CONTEXT.test(line);

        // Match on the masked line so a console call inside a string or a
        // commented-out one is inert.
        const hit = CONSOLE_CALL.exec(masked[i]);
        // `guardsHere` covers the braceless single-line form:
        // `if (import.meta.env.DEV) console.log(x)`.
        if (hit && !devDepths.length && !guardsHere && !CONSOLE_ANTI.test(line)) {
          findings.push({
            line: i + 1,
            column: hit.index + 1,
            message: 'console.log left in production code.',
            snippet: line,
          });
        }

        // A guard that opened a block: its body sits at the deeper level.
        if (guardsHere && end > depth) devDepths.push(end);
        depth = end;
      }

      return findings;
    },
  },
  {
    id: 'no-deep-nesting',
    name: 'No Deep Nesting',
    description: 'Code nested 4+ levels deep. AI loves nesting instead of using early returns.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    messageTemplate: 'Code nested too deeply. Use early returns or extract functions.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];
      const masked = maskLines(lines);
      const reported = new Set<number>();
      let depth = 0;
      for (let i = 0; i < lines.length; i++) {
        depth = countBraces(masked[i], depth);
        if (depth >= 5 && !reported.has(depth)) {
          reported.add(depth);
          findings.push({
            line: i + 1,
            column: 1,
            message: `Nesting depth is ${depth}. Use early returns or extract helper functions.`,
            snippet: lines[i],
          });
        }
        if (depth < 5) reported.clear();
      }
      return findings;
    },
  },
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
      const masked = maskLines(lines);
      const funcPattern = /(?:(?:export\s+)?(?:async\s+)?function\s+(\w{1,64})|(?:const|let|var)\s+(\w{1,64})\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(\w{1,64})\s*(?::\s*\w[^=]*)?\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\s*\{)/;

      for (let i = 0; i < lines.length; i++) {
        // Matching and brace tracking both run on the masked line, so a
        // `function` keyword or brace inside a string/regex/comment is inert.
        const line = masked[i];
        // Skip pathological long lines (minified/generated); funcPattern is quadratic on them.
        if (line.length > 2000) continue;
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
          braceDepth = countBraces(masked[j], braceDepth);
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
            snippet: lines[i],
          });
        }
      }
      return findings;
    },
  },
];
