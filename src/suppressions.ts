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

type RuleFilter = 'all' | Set<string>;

export type Suppressions = {
  /** File-level directive (vibecheck-disable), or null. */
  file: RuleFilter | null;
  /** Line-targeted directives, keyed by 1-based line number. */
  lines: Map<number, RuleFilter>;
};

type Comment = {
  body: string;
  startLine: number;
  endLine: number;
  /** Character offset of the comment opener. */
  start: number;
  /** Block comment whose last significant code char was `{` (JSX expression-comment form). */
  braceAdjacent: boolean;
};

const JS_LANGS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);
const HASH_LANGS = new Set(['py']);

// Longest alternative first so `disable-next-line` is not read as `disable`.
const DIRECTIVE = /^vibecheck-(disable-next-line|disable-line|disable|ignore)(?=$|[\s:])([\s\S]*)$/;

// After these keywords a `/` starts a regex literal, not division.
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

// Characters that end a value expression: after these, `/` means division.
const VALUE_END = /[\w$)\]'"`]/;

/** Extract comments from JS/TS source with a string/template/regex-aware pass. */
function jsComments(content: string): Comment[] {
  const comments: Comment[] = [];
  const n = content.length;
  let line = 1;
  let i = 0;
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' | 'regex' | 'regexClass' = 'code';
  // Template nesting: 'tpl' = inside template text, numbers = brace depth of a `${}` interpolation.
  const stack: Array<'tpl' | number> = [];
  let lastSig = ''; // last significant char seen in code state
  let lastWord = ''; // identifier/keyword the significant char terminates
  let bodyStart = 0;
  let commentLine = 0;
  let commentStart = 0; // offset of the `//` or `/*` opener
  let commentBrace = false; // opened while lastSig === '{'

  const closeLineComment = (end: number) => {
    comments.push({
      body: content.slice(bodyStart, end), startLine: commentLine, endLine: commentLine,
      start: commentStart, braceAdjacent: false,
    });
    state = 'code';
  };

  while (i < n) {
    const c = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    switch (state) {
      case 'code': {
        const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
        if (typeof top === 'number' && c === '{') {
          stack[stack.length - 1] = top + 1;
          lastSig = c; lastWord = '';
        } else if (typeof top === 'number' && c === '}') {
          if (top === 0) { stack.pop(); state = 'template'; } else { stack[stack.length - 1] = top - 1; lastSig = c; lastWord = ''; }
        } else if (c === "'") { state = 'single'; }
        else if (c === '"') { state = 'double'; }
        else if (c === '`') { stack.push('tpl'); state = 'template'; }
        else if (c === '/' && next === '/') { state = 'line'; bodyStart = i + 2; commentLine = line; commentStart = i; i++; }
        else if (c === '/' && next === '*') { state = 'block'; bodyStart = i + 2; commentLine = line; commentStart = i; commentBrace = lastSig === '{'; i++; }
        else if (c === '/') {
          // Regex vs division: `/` after a value token is division, except after
          // keywords like `return` where a regex can start.
          const regexAllowed = !VALUE_END.test(lastSig) || REGEX_PRECEDING_KEYWORDS.has(lastWord);
          if (regexAllowed) { state = 'regex'; } else { lastSig = c; lastWord = ''; }
        } else if (/[A-Za-z0-9_$]/.test(c)) {
          lastWord = /[A-Za-z0-9_$]/.test(lastSig) ? lastWord + c : c;
          lastSig = c;
        } else if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
        break;
      }
      case 'single':
      case 'double': {
        const quote = state === 'single' ? "'" : '"';
        if (c === '\\') { i++; } // skipped char is line-counted at the loop bottom
        else if (c === quote) { state = 'code'; lastSig = quote; lastWord = ''; }
        else if (c === '\n') { state = 'code'; } // unterminated string: bail to bound damage
        break;
      }
      case 'template': {
        if (c === '\\') { i++; }
        else if (c === '$' && next === '{') { stack.push(0); state = 'code'; lastSig = ''; lastWord = ''; i++; }
        else if (c === '`') {
          if (stack[stack.length - 1] === 'tpl') stack.pop();
          state = 'code'; lastSig = '`'; lastWord = '';
        }
        break;
      }
      case 'line': {
        if (c === '\n') closeLineComment(i);
        break;
      }
      case 'block': {
        if (c === '*' && next === '/') {
          comments.push({
            body: content.slice(bodyStart, i), startLine: commentLine, endLine: line,
            start: commentStart, braceAdjacent: commentBrace,
          });
          state = 'code';
          i++;
        }
        break;
      }
      case 'regex': {
        if (c === '\\') { i++; }
        else if (c === '[') { state = 'regexClass'; }
        else if (c === '/') { state = 'code'; lastSig = ')'; lastWord = ''; }
        else if (c === '\n') { state = 'code'; lastSig = ''; lastWord = ''; } // regex can't span lines: bail
        break;
      }
      case 'regexClass': {
        if (c === '\\') { i++; }
        else if (c === ']') { state = 'regex'; }
        else if (c === '\n') { state = 'code'; lastSig = ''; lastWord = ''; }
        break;
      }
    }

    if (content[i] === '\n') line++;
    i++;
  }

  if (state === 'line') closeLineComment(n);
  return comments;
}

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
    comments = jsComments(content);
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
