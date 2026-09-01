import type { Rule, MultilineRule, MultilineFinding } from '../types.js';

// Python strings and comments, stripped before counting brackets. One line at
// a time; pyTripleState tracks the strings that span lines.
const PY_STRING_OR_COMMENT = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#.*$/g;

function pyBare(line: string): string {
  return line.replace(PY_STRING_OR_COMMENT, '');
}

function pyBracketDelta(bare: string): number {
  let delta = 0;
  for (const ch of bare) {
    if (ch === '(' || ch === '[' || ch === '{') delta++;
    else if (ch === ')' || ch === ']' || ch === '}') delta--;
  }
  return delta;
}

// Whether the NEXT line starts inside a triple-quoted string. Every """ or
// ''' on the line flips the state; a delimiter inside a comment fools it.
function pyTripleState(line: string, state: string | null): string | null {
  let current = state;
  const re = /"""|'''/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (current === null) current = m[0];
    else if (current === m[0]) current = null;
  }
  return current;
}

// Index of the colon that opens the except suite: the first `:` after `from`
// that is outside brackets and strings. -1 when the header does not end on
// this line.
function pySuiteColon(line: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let k = from; k < line.length; k++) {
    const ch = line[k];
    if (quote !== null) {
      if (ch === '\\') k++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return -1;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ':' && depth === 0) {
      return k;
    }
  }
  return -1;
}

const PY_LOG_CALL = /^([\w.]*)\.(?:error|exception|warning|warn|critical|fatal|debug|info|log)\s*\(/i;
// The receiver has to be named like a logger: `logger`, `LOG`, `logging`,
// `self._logger`, `audit_log`. `catalog.error(...)` and `dialog.warning(...)`
// are not logging.
const PY_LOGGER_NAME = /(?:^|[._])log(?:ger|ging)?$/i;

// True when `stmt` (strings and comments already stripped) is exactly one
// logging call with nothing after its closing bracket. `logger.error(e); raise`
// and `logger.error(e).notify()` are not.
function pyIsLoneLogCall(stmt: string): boolean {
  const m = PY_LOG_CALL.exec(stmt);
  if (m === null || !PY_LOGGER_NAME.test(m[1])) return false;
  let depth = 0;
  for (let k = stmt.indexOf('('); k < stmt.length; k++) {
    const ch = stmt[k];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return stmt.slice(k + 1).trim() === '';
    }
  }
  return false;
}

interface HandlerBody {
  logCalls: number;
  otherStatements: number;
  handled: boolean;
  // Bracket counting lost track; report nothing for this handler.
  broken: boolean;
}

// Walks an except body that starts at `start` and is indented deeper than
// `exceptIndent`, counting statements. A wrapped `logger.error(\n ...\n)` is
// one statement, not three: lines inside an open bracket are joined onto the
// statement that opened it.
function scanHandlerBody(lines: string[], start: number, exceptIndent: number): HandlerBody {
  const body: HandlerBody = { logCalls: 0, otherStatements: 0, handled: false, broken: false };
  let depth = 0;
  let stmt = '';
  for (let j = start; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    // Blank and comment-only lines carry no indentation in Python
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (depth === 0) {
      // Dedent ends the handler
      if (line.search(/\S/) <= exceptIndent) break;
      if (/#\s*(?:noqa|nosec)/.test(line)) {
        body.handled = true;
        return body;
      }
      stmt = '';
    }
    const bare = pyBare(line);
    stmt += bare;
    depth += pyBracketDelta(bare);
    if (depth < 0) break;
    if (depth === 0) {
      if (pyIsLoneLogCall(stmt.trim())) body.logCalls++;
      else body.otherStatements++;
    }
  }
  body.broken = depth !== 0;
  return body;
}

const PY_EXIT_EXCEPTIONS = new Set(['KeyboardInterrupt', 'SystemExit', 'GeneratorExit']);

export const pythonRules: Rule[] = [
  {
    id: 'no-py-eval',
    name: 'No Python eval/exec',
    description: 'eval(), exec(), os.system(), and subprocess with shell=True execute arbitrary code.',
    category: 'security',
    severity: 'error',
    languages: ['py'],
    pattern: /(?<![\w.])(?:eval|exec)\s*\(|(?:builtins|__builtins__)\.(?:eval|exec)\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True/,
    antiPattern: /#\s*(?:safe|nosec|noqa)|ast\.literal_eval/,
    messageTemplate: 'eval/exec/os.system/shell=True allows arbitrary code execution.',
  },
  {
    id: 'no-py-sql-concat',
    name: 'No Python SQL String Concatenation',
    description: 'Building SQL queries with f-strings or format() enables SQL injection.',
    category: 'security',
    // warn, not error: regex heuristic, see the no-sql-concat note in security.ts.
    severity: 'warn',
    languages: ['py'],
    pattern: /f['"](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b.*?\b(?:FROM|INTO|SET|WHERE|VALUES|JOIN|TABLE|DATABASE|INDEX|COLUMN)\b.*?\{|['"](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b.*?\b(?:FROM|INTO|SET|WHERE|VALUES|JOIN|TABLE|DATABASE|INDEX|COLUMN)\b.*?['"]\s*\.format\s*\(/i,
    antiPattern: /#\s*(?:safe|nosec|noqa)|parameterized|placeholder/i,
    messageTemplate: 'SQL query built with f-string/format(). Use parameterized queries.',
  },
  {
    id: 'no-bare-except',
    name: 'No Bare Except',
    description: 'except: without an exception type catches SystemExit and KeyboardInterrupt.',
    category: 'error-handling',
    severity: 'error',
    languages: ['py'],
    pattern: /^\s*except\s*:/,
    antiPattern: /#\s*(?:noqa|nosec)/,
    messageTemplate: 'Bare except catches SystemExit and KeyboardInterrupt. Use except Exception: instead.',
  },
  {
    id: 'no-star-import',
    name: 'No Star Imports',
    description: 'from module import * pollutes the namespace and makes code harder to understand.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['py'],
    pattern: /^\s*from\s+\S+\s+import\s+\*/,
    antiPattern: /#\s*noqa/,
    fileExclusions: /(?:^|[/\\])__init__\.py$/,
    messageTemplate: 'Star import pollutes namespace. Import specific names instead.',
  },
  {
    id: 'no-mutable-default',
    name: 'No Mutable Default Arguments',
    description: 'Mutable default arguments (list, dict, set) are shared across calls. Classic Python gotcha AI generates.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['py'],
    pattern: /def\s+\w+\s*\([^)]*(?:=\s*\[\s*\]|=\s*\{\s*\}|=\s*set\s*\(\s*\))/,
    antiPattern: /#\s*noqa|field\s*\(|Field\s*\(/,
    messageTemplate: 'Mutable default argument. Use None and assign inside the function body.',
  },
  {
    id: 'no-py-print',
    name: 'No Print in Production',
    description: 'print() left in production code. Use logging module instead.',
    category: 'code-quality',
    severity: 'warn',
    languages: ['py'],
    pattern: /\bprint\s*\(/,
    antiPattern: /#\s*(?:noqa|keep)|if\s+__name__|__main__/,
    fileExclusions: /(?:^|[/\\])(?:test_[^/\\]*|conftest|cli)\.py$|_test\.py$/,
    messageTemplate: 'print() in production code. Use the logging module instead.',
  },
  {
    id: 'no-flask-debug',
    name: 'No Flask Debug Mode',
    description: 'app.run(debug=True) exposes the Werkzeug debugger in production.',
    category: 'framework',
    severity: 'warn',
    languages: ['py'],
    pattern: /app\.run\s*\([^)]*debug\s*=\s*True/,
    antiPattern: /if\s+__name__\s*==\s*['"]__main__['"]/,
    messageTemplate: 'Flask debug mode exposes the interactive debugger. Disable in production.',
  },
  {
    id: 'no-py-obvious-comments',
    name: 'No Obvious Python Comments',
    description: 'Comments that restate what the code does. AI generates these constantly.',
    category: 'ai-tell',
    severity: 'info',
    languages: ['py'],
    pattern: /#\s*(?:increment|decrement|initialize|declare|define|create|set|get|return|check|loop|iterate|import|assign|call|invoke|update|fetch|retrieve|store|save|log|print|handle|process)\s+(?:the\s+)?(?:a\s+)?\w+\s*$/i,
    antiPattern: /#\s*(?:noqa|type:|TODO|FIXME|NOTE|HACK|BUG|WARN|pragma)/i,
    messageTemplate: 'Comment restates what the code does. Remove it or explain WHY instead.',
  },
  {
    id: 'no-py-stub-function',
    name: 'No Python Stub Functions',
    description: 'AI scaffolding: functions with only pass, ellipsis, or raise NotImplementedError.',
    category: 'ai-tell',
    severity: 'warn',
    languages: ['py'],
    pattern: /^\s*raise\s+NotImplementedError\b/,
    antiPattern: /#\s*(?:noqa|abstract|ABC|interface)|@abstractmethod/,
    messageTemplate: 'Stub function raises NotImplementedError. Implement it or remove it.',
  },
  {
    id: 'no-py-hedging-comments',
    name: 'No Python Hedging Comments',
    description: 'AI writes uncertain comments like "should work" or "might not be ideal".',
    category: 'ai-tell',
    severity: 'info',
    languages: ['py'],
    pattern: /#\s*.*(?:should\s+work|might\s+not|hopefully|not\s+sure\s+if|probably\s+(?:not\s+)?(?:the\s+)?(?:best|right|correct)|replace\s+this\s+with\s+your\s+actual|this\s+(?:may|might|could)\s+(?:need|require))\b/i,
    antiPattern: /#\s*noqa/,
    messageTemplate: 'Hedging comment detected. Either fix the uncertainty or remove the comment.',
  },
  {
    id: 'no-type-ignore-blanket',
    name: 'No Blanket type: ignore',
    description: 'Blanket # type: ignore suppresses all type errors. AI uses this to silence mypy.',
    category: 'ai-tell',
    severity: 'warn',
    languages: ['py'],
    pattern: /#\s*type:\s*ignore\s*$/,
    antiPattern: /#\s*type:\s*ignore\s*\[/,
    messageTemplate: 'Blanket type: ignore suppresses all type errors. Use # type: ignore[specific-error] instead.',
  },
];

export const pythonMultilineRules: MultilineRule[] = [
  {
    id: 'no-unused-protocol',
    name: 'No Unused Protocol',
    description: 'Protocol class defined but never referenced in the file. AI scaffold from a previous iteration that the model abandoned.',
    category: 'ai-tell',
    severity: 'info',
    languages: ['py'],
    messageTemplate: 'Protocol class is defined but never used in this file. Likely AI ghost scaffold from a previous iteration.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];

      // Parse __all__ to get exported names. Only those names are exempt (cross-file usage assumed).
      const exportedNames = new Set<string>();
      const allMatch = lines.join('\n').match(/__all__\s*[:=]\s*[\[\(]([^\])]*)[\]\)]/);
      if (allMatch) {
        for (const m of allMatch[1].matchAll(/['"]([^'"]+)['"]/g)) {
          exportedNames.add(m[1]);
        }
      }

      // Match Protocol anywhere in the base list (handles class Foo(Generic[T], Protocol): and class Foo(typing.Protocol):)
      const protocolDef = /^\s*class\s+(\w+)\s*\((?:[^)]*,\s*)?(?:[\w.]+\.)?Protocol(?:\s*,\s*[^)]*)?\)\s*:/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(protocolDef);
        if (!m) continue;
        const name = m[1];

        // Exempt only this Protocol if it's exported via __all__
        if (exportedNames.has(name)) continue;

        // Build search body by excluding the exact def line by index (not string replace, which can hit duplicates)
        const body = lines.slice(0, i).concat(lines.slice(i + 1)).join('\n');
        const refRegex = new RegExp(`\\b${name}\\b`, 'g');
        const refCount = (body.match(refRegex) || []).length;

        if (refCount === 0) {
          findings.push({
            line: i + 1,
            column: line.search(/class/) + 1,
            message: `Protocol class "${name}" is defined but never used in this file. Likely AI ghost scaffold from a previous iteration.`,
            snippet: line,
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'no-pass-except',
    name: 'No Pass in Except',
    description: 'except: pass silently swallows all errors, hiding bugs.',
    category: 'error-handling',
    severity: 'error',
    languages: ['py'],
    messageTemplate: 'Except block with only pass swallows errors silently.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match except lines (bare or with exception type)
        if (!/^\s*except\s*(?:\w|:)/.test(line)) continue;

        // Single-line: except Exception: pass
        if (/^\s*except\s*(?:\([^)]*\)\s*)?(?:\w[\w.,\s]*)?(?:\s+as\s+\w+)?\s*:\s*pass\s*(?:#.*)?$/.test(line)) {
          findings.push({
            line: i + 1,
            column: line.search(/except/) + 1,
            message: 'Except block with only pass swallows errors silently.',
            snippet: line,
          });
          continue;
        }

        // Multi-line: except block where body is only pass/comments
        if (!/:\s*(?:#.*)?$/.test(line)) continue;

        let hasPass = false;
        let hasRealContent = false;

        for (let j = i + 1; j < lines.length; j++) {
          const bodyLine = lines[j];
          const trimmed = bodyLine.trim();

          // Empty line
          if (trimmed === '') continue;

          // Dedented or new block = end of except body
          const exceptIndent = line.search(/\S/);
          const bodyIndent = bodyLine.search(/\S/);
          if (bodyIndent <= exceptIndent && trimmed !== '') break;

          if (trimmed === 'pass') {
            hasPass = true;
          } else if (trimmed.startsWith('#')) {
            // comment, ignore
          } else {
            hasRealContent = true;
            break;
          }
        }

        if (hasPass && !hasRealContent) {
          findings.push({
            line: i + 1,
            column: line.search(/except/) + 1,
            message: 'Except block with only pass swallows errors silently.',
            snippet: line,
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'no-py-log-swallow',
    name: 'No Logged-and-Swallowed Exceptions',
    description: 'An except handler whose whole body is a logging call absorbs the failure silently.',
    category: 'error-handling',
    // info, not warn like the js twin no-console-error-only: on adk-python
    // 13 of 109 hits were real swallows and the other 95 were cleanup,
    // per-item loops, telemetry or optional features. The pattern is a tell
    // (0.26/kloc there, none in hand-written code), not a bug on its own.
    severity: 'info',
    languages: ['py'],
    messageTemplate: 'Except block only logs the error and moves on. Check nothing after it assumes the try body succeeded.',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];
      let triple: string | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Code samples inside docstrings are not handlers
        const inString = triple !== null;
        triple = pyTripleState(line, triple);
        if (inString) continue;

        // Bare `except:` belongs to no-bare-except
        const header = /^\s*except\b\*?\s*(?=[\w(])/.exec(line);
        if (!header) continue;
        if (/#\s*(?:noqa|nosec)/.test(line)) continue;
        const colon = pySuiteColon(line, header[0].length);
        if (colon < 0) continue;

        // KeyboardInterrupt and SystemExit are not errors: logging one on the
        // way out is correct, and adk-python has exactly that shape under
        // `if __name__ == "__main__"`. A tuple mixing in a real error still counts.
        const expr = line.slice(header[0].length, colon).replace(/\bas\s+\w+\s*$/, '');
        const names = expr.match(/\w+/g) ?? [];
        if (names.length > 0 && names.every(n => PY_EXIT_EXCEPTIONS.has(n))) continue;

        // Single line: `except ValueError as e: logger.error(e)`. Whatever is
        // left after the colon once comments are stripped is the whole body.
        const rest = pyBare(line.slice(colon + 1)).trim();
        let logOnly: boolean;
        if (rest !== '') {
          logOnly = pyIsLoneLogCall(rest);
        } else {
          // Exactly one logging call and nothing else. A handler that logs AND
          // sets a fallback is doing something; this is the one that is not.
          const body = scanHandlerBody(lines, i + 1, line.search(/\S/));
          logOnly = !body.broken && !body.handled && body.logCalls === 1 && body.otherStatements === 0;
        }
        if (!logOnly) continue;

        findings.push({
          line: i + 1,
          column: line.search(/except/) + 1,
          message: 'Except block only logs the error and moves on. Check nothing after it assumes the try body succeeded.',
          snippet: line,
        });
      }
      return findings;
    },
  },
];
