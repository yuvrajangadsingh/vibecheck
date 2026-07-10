import type { Rule } from '../types.js';

export const securityRules: Rule[] = [
  {
    id: 'no-hardcoded-secrets',
    name: 'No Hardcoded Secrets',
    description: 'Detects API keys, passwords, and tokens hardcoded in source code.',
    category: 'security',
    severity: 'error',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'py'],
    pattern: /(api[_-]?key|secret|password|passwd|token|auth[_-]?token|access[_-]?key|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/=_\-.]{16,}['"]/i,
    antiPattern: /(process\.env|import\.meta\.env|ENV\[|getenv|os\.environ|xxx|your[_-]|<[A-Z_]+>|\b(?:example|placeholder|test|mock|fake|dummy|sample)\b)/i,
    messageTemplate: 'Hardcoded secret detected. Use environment variables instead.',
  },
  {
    id: 'no-eval',
    name: 'No eval()',
    description: 'eval() and new Function() execute arbitrary code, enabling injection attacks.',
    category: 'security',
    severity: 'error',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /(?<![$\w])eval\s*\(|new\s+Function\s*\(/,
    antiPattern: /eslint-disable|\/\/\s*safe|globalThis\.eval/,
    messageTemplate: 'eval() or new Function() allows arbitrary code execution.',
  },
  {
    id: 'no-innerhtml',
    name: 'No innerHTML',
    description: 'innerHTML and dangerouslySetInnerHTML can introduce XSS vulnerabilities.',
    category: 'security',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /\.innerHTML\s*(?:\+|\|\||&&|\?\?)?=(?!=)|dangerouslySetInnerHTML/,
    antiPattern: /DOMPurify|sanitize|xss|eslint-disable/i,
    messageTemplate: 'innerHTML/dangerouslySetInnerHTML is an XSS vector. Use textContent or a sanitizer.',
  },
  {
    id: 'no-sql-concat',
    name: 'No SQL String Concatenation',
    description: 'Building SQL queries with string concatenation enables SQL injection.',
    category: 'security',
    // warn, not error: this is a regex heuristic that cannot fully distinguish a
    // real query from UI copy shaped like SQL ("Delete from " + folder), so it
    // should surface for review without failing CI on a false positive.
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /['"`]\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[^'"`]*?\b(?:FROM|INTO|SET|WHERE|VALUES|JOIN|TABLE|DATABASE|INDEX|COLUMN)\b[^'"`]*?(?:\$\{|['"`]\s*\+\s*\w)/i,
    messageTemplate: 'SQL query built with string concatenation. Use parameterized queries.',
  },
];
