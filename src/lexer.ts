/**
 * Shared JS/TS lexical pass.
 *
 * One state machine walks the source and produces two views used by
 * different consumers:
 *
 *   - `comments`: every real comment with its span and body, used by the
 *     suppression pre-pass (suppressions.ts). Directive text inside a
 *     string, template, or regex can never suppress anything because those
 *     states never emit comments.
 *   - `mask`: the source with every non-code character blanked to a space
 *     (newlines preserved, offsets identical). Rules that count braces or
 *     match structural patterns use the mask so that braces, quotes, and
 *     `catch (` inside strings, templates, regex literals, or comments
 *     cannot confuse them. A regex literal like /'/g is the canonical trap:
 *     a quote-aware-but-regex-blind tracker treats its quote as an opened
 *     string and swallows the rest of the line.
 *
 * The machine is intentionally line-tolerant: unterminated strings and
 * regexes bail back to code at the newline to bound the damage of syntax
 * the lexer does not understand. When unsure, prefer classifying a char as
 * code — for suppressions that fails safe (finding stays reported), and for
 * masking it keeps structural chars visible to the rules.
 */

export type Comment = {
  body: string;
  startLine: number;
  endLine: number;
  /** Character offset of the comment opener. */
  start: number;
  /** Block comment whose last significant code char was `{` (JSX expression-comment form). */
  braceAdjacent: boolean;
};

export type LexResult = {
  comments: Comment[];
  /** Same length as the input; non-code chars are spaces, newlines kept. */
  mask: string;
};

// After these keywords a `/` starts a regex literal, not division.
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

// Characters that end a value context: after one of these, `/` is division, not
// a regex opener. The mask is used for brace counting, so this heuristic is
// deliberately biased toward division — misreading a real regex as division
// only leaves its (rarely-braced) contents visible, whereas the reverse can
// swallow a real closing brace to end-of-line. Beyond the classic value-enders
// this also covers:
//   `>`  JSX close/self tags: `</div>` `<br/>` (the slash of `</` follows `<`)
//   `<`  the `/` in a `</tag>` close directly follows `<`
//   `}`  block/object end: `{...} / x`
//   `+ -` postfix `i++ / 2`, `n-- / k` (bare `+ /regex/` is not real code)
const VALUE_END = /[\w$)\]'"`><}+-]/;

/** Lex JS/TS source in one pass: real comments plus a code-only mask. */
export function lexJs(content: string): LexResult {
  const comments: Comment[] = [];
  const n = content.length;
  // Pre-fill with spaces, keep newlines so line/column offsets survive.
  const mask: string[] = new Array(n);
  for (let k = 0; k < n; k++) mask[k] = content[k] === '\n' ? '\n' : ' ';

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
          mask[i] = c;
        } else if (typeof top === 'number' && c === '}') {
          // top === 0 closes the `${}` interpolation itself — that brace is
          // template punctuation, not code, so it stays masked.
          if (top === 0) { stack.pop(); state = 'template'; } else { stack[stack.length - 1] = top - 1; lastSig = c; lastWord = ''; mask[i] = c; }
        } else if (c === "'") { state = 'single'; }
        else if (c === '"') { state = 'double'; }
        else if (c === '`') { stack.push('tpl'); state = 'template'; }
        else if (c === '/' && next === '/') { state = 'line'; bodyStart = i + 2; commentLine = line; commentStart = i; i++; }
        else if (c === '/' && next === '*') { state = 'block'; bodyStart = i + 2; commentLine = line; commentStart = i; commentBrace = lastSig === '{'; i++; }
        else if (c === '/') {
          // Regex vs division: `/` after a value token is division, except after
          // keywords like `return` where a regex can start.
          const regexAllowed = !VALUE_END.test(lastSig) || REGEX_PRECEDING_KEYWORDS.has(lastWord);
          if (regexAllowed) { state = 'regex'; } else { lastSig = c; lastWord = ''; mask[i] = c; }
        } else if (/[A-Za-z0-9_$]/.test(c)) {
          lastWord = /[A-Za-z0-9_$]/.test(lastSig) ? lastWord + c : c;
          lastSig = c;
          mask[i] = c;
        } else {
          if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
          mask[i] = c; // whitespace and punctuation are code
        }
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
        else if (c === '/') {
          // closing slash: blank the trailing flags (gimsuyd) so the whole
          // literal is masked, per the mask contract, then resume code
          let j = i + 1;
          while (j < n && /[a-z]/i.test(content[j])) { mask[j] = ' '; j++; }
          i = j - 1; // loop's i++ steps past the last flag
          state = 'code'; lastSig = ')'; lastWord = '';
        }
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
  return { comments, mask: mask.join('') };
}

// The scanner hands the SAME `lines` array to every multiline rule in a file,
// so cache the mask on the array identity: one lexer pass per file instead of
// one per rule (four rules × a full re-lex was a real slowdown on big files).
const maskCache = new WeakMap<string[], string[]>();

/**
 * Mask a file already split into lines: same shape back, with non-code
 * characters blanked. Offsets are preserved, so columns computed against
 * masked lines are valid against the raw lines. Memoized per lines-array.
 */
export function maskLines(lines: string[]): string[] {
  const cached = maskCache.get(lines);
  if (cached) return cached;
  const masked = lexJs(lines.join('\n')).mask.split('\n');
  maskCache.set(lines, masked);
  return masked;
}
