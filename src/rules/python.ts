import type { Rule, MultilineRule, MultilineFinding } from '../types.js';

export const pythonRules: Rule[] = [
  {
    id: 'no-py-eval',
    name: 'No Python eval/exec',
    description: 'eval(), exec(), os.system(), and subprocess with shell=True execute arbitrary code.',
    category: 'security',
    severity: 'error',
    languages: ['py'],
    pattern: /\b(?:eval|exec)\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True/,
    antiPattern: /#\s*(?:safe|nosec|noqa)|ast\.literal_eval/,
    messageTemplate: 'eval/exec/os.system/shell=True allows arbitrary code execution.',
  },
  {
    id: 'no-py-sql-concat',
    name: 'No Python SQL String Concatenation',
    description: 'Building SQL queries with f-strings or format() enables SQL injection.',
    category: 'security',
    severity: 'error',
    languages: ['py'],
    pattern: /f['"](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b|['"](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b.*\.format\s*\(/i,
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
    pattern: /^from\s+\S+\s+import\s+\*/,
    antiPattern: /#\s*noqa|__init__\.py/,
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
    antiPattern: /#\s*(?:noqa|keep)|if\s+__name__|\.test|_test\.py|test_|conftest|debug|cli\.py|__main__/,
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
    pattern: /raise\s+NotImplementedError\s*\(\s*(?:['"]\s*['"]|)\s*\)/,
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
];
