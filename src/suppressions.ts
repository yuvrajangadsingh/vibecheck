/**
 * Inline suppression directives, parsed as a scanner pre-pass so every
 * consumer (CLI, MCP server, editor integrations) honors them for free.
 *
 *   // vibecheck-disable-next-line            suppress everything on the next line
 *   // vibecheck-disable-next-line a, b       suppress rules a and b on the next line
 *   code(); // vibecheck-disable-line         suppress everything on this line
 *   // vibecheck-disable [a, b]               suppress the whole file
 *   # ...                                     hash variants for Python
 *   // vibecheck-ignore                       legacy alias for vibecheck-disable-line
 *
 * Directives are only honored inside real comments. A small string-aware
 * lexer walks each file and tracks string literals, template literals
 * (including nested `${}` interpolations), and regex literals, so directive
 * text inside a string, a template, or a regex can never suppress anything.
 * A directive must also be the first token of its comment, so prose that
 * merely mentions one is ignored. Both properties fail safe: when the lexer
 * is unsure it sees code, not a comment, and the finding stays reported.
 *
 * JSX files (.tsx/.jsx) get one extra containment rule: the lexer has no
 * JSX-text state, so rendered element text (`<div>// vibecheck-disable...`)
 * would forge a comment. In those files, line-scoped directives are honored
 * only in the JSX expression-comment form (a block comment whose last
 * significant code char is `{`) because a source-level `{` can never be JSX
 * text, and file-level `vibecheck-disable` additionally works in comments
 * before the first `<` in the file. Bare `//` directives and non-brace block
 * comments are ignored there entirely, so they can never be forged either.
 */

import { lexJs, type Comment } from './lexer.js';

type RuleFilter = 'all' | Set<string>;

export type Suppressions = {
  /** File-level directive (vibecheck-disable), or null. */
  file: RuleFilter | null;
  /** Line-targeted directives, keyed by 1-based line number. */
  lines: Map<number, RuleFilter>;
};

const JS_LANGS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);
const HASH_LANGS = new Set(['py']);

// Longest alternative first so `disable-next-line` is not read as `disable`.
const DIRECTIVE = /^vibecheck-(disable-next-line|disable-line|disable|ignore)(?=$|[\s:])([\s\S]*)$/;

/** Extract `#` comments from Python source, skipping string literals. */
function hashComments(content: string): Comment[] {
  const comments: Comment[] = [];
  const n = content.length;
  let line = 1;
  let i = 0;
  let state: 'code' | 'string' | 'comment' = 'code';
  let quote = ''; // "'", '"', "'''", or '"""'
  let bodyStart = 0;
  let commentLine = 0;
  let commentStart = 0;

  while (i < n) {
    const c = content[i];

    if (state === 'code') {
      if (c === '#') { state = 'comment'; bodyStart = i + 1; commentLine = line; commentStart = i; }
      else if (c === "'" || c === '"') {
        quote = content.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
        state = 'string';
        i += quote.length - 1;
      }
    } else if (state === 'string') {
      // Backslash keeps the string open even in raw strings (r'\' is unterminated).
      if (c === '\\') { i++; } // skipped char is line-counted at the loop bottom
      else if (content.startsWith(quote, i)) { state = 'code'; i += quote.length - 1; }
      else if (c === '\n' && quote.length === 1) { state = 'code'; } // unterminated single-quoted string
    } else if (c === '\n') {
      comments.push({
        body: content.slice(bodyStart, i), startLine: commentLine, endLine: commentLine,
        start: commentStart, braceAdjacent: false,
      });
      state = 'code';
    }

    if (content[i] === '\n') line++;
    i++;
  }

  if (state === 'comment') {
    comments.push({
      body: content.slice(bodyStart, n), startLine: commentLine, endLine: commentLine,
      start: commentStart, braceAdjacent: false,
    });
  }
  return comments;
}

/** Parse "no-eval, no-ts-any -- reason" into a rule filter. Empty list = all rules. */
function parseRuleList(raw: string): RuleFilter {
  let text = raw.trim();
  if (text.startsWith(':')) text = text.slice(1);
  const descIdx = text.search(/(?:^|\s)--(?:\s|$)/);
  if (descIdx !== -1) text = text.slice(0, descIdx);
  const ids = text.split(/[\s,]+/).filter(Boolean);
  return ids.length === 0 ? 'all' : new Set(ids);
}

function mergeFilter(existing: RuleFilter | undefined, incoming: RuleFilter): RuleFilter {
  if (!existing) return incoming;
  if (existing === 'all' || incoming === 'all') return 'all';
  for (const id of incoming) existing.add(id);
  return existing;
}

/**
 * Pre-pass: collect suppression directives for a file. Returns null when the
 * file has none (the common case, gated by a cheap substring check) or the
 * language has no known comment syntax.
 */
export function parseSuppressions(content: string, lang: string): Suppressions | null {
  if (!content.includes('vibecheck-')) return null;

  let comments: Comment[];
  let decor: RegExp;
  if (JS_LANGS.has(lang)) {
    comments = lexJs(content).comments;
    decor = /^[\s/*]+/; // strip `*` JSDoc gutters and stray slashes
  } else if (HASH_LANGS.has(lang)) {
    comments = hashComments(content);
    decor = /^[\s#]+/; // strip `##` banner-style hashes
  } else {
    return null;
  }

  // JSX containment: rendered element text could forge bare `//` and block
  // comments (the lexer has no JSX-text state), so in .tsx/.jsx only the
  // brace-adjacent expression-comment form is trusted; file-level disable is
  // also trusted in the pre-JSX header region (before the first `<`).
  const jsx = lang === 'tsx' || lang === 'jsx';
  const firstAngle = content.indexOf('<');
  const headerEnd = !jsx || firstAngle === -1 ? Infinity : firstAngle;

  const sup: Suppressions = { file: null, lines: new Map() };
  for (const comment of comments) {
    const body = comment.body.replace(decor, '');
    const m = DIRECTIVE.exec(body);
    if (!m) continue;
    if (jsx && !comment.braceAdjacent && !(m[1] === 'disable' && comment.start < headerEnd)) continue;
    const filter = parseRuleList(m[2]);
    if (m[1] === 'disable') {
      sup.file = mergeFilter(sup.file ?? undefined, filter);
    } else if (m[1] === 'disable-next-line') {
      const target = comment.endLine + 1;
      sup.lines.set(target, mergeFilter(sup.lines.get(target), filter));
    } else {
      // disable-line and the legacy vibecheck-ignore alias: current line
      const target = comment.startLine;
      sup.lines.set(target, mergeFilter(sup.lines.get(target), filter));
    }
  }

  return sup.file || sup.lines.size > 0 ? sup : null;
}

/** True when a finding for ruleId on the given 1-based line is suppressed. */
export function isSuppressed(sup: Suppressions, ruleId: string, line: number): boolean {
  const matches = (f: RuleFilter) => f === 'all' || f.has(ruleId);
  if (sup.file && matches(sup.file)) return true;
  const lineFilter = sup.lines.get(line);
  return lineFilter !== undefined && matches(lineFilter);
}
