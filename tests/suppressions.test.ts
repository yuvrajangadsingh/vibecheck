import { describe, it, expect } from 'vitest';
import { scanContent, scanContentDetailed } from '../src/scanner.js';
import { parseSuppressions, isSuppressed } from '../src/suppressions.js';
import type { Config } from '../src/types.js';

const config: Config = { rules: {}, ignore: [], include: [] };

const rulesOf = (code: string, file = 'x.ts') => scanContent(code, file, config).map((f) => f.rule);

describe('vibecheck-disable-next-line', () => {
  it('suppresses every rule on the next line when bare', () => {
    const code = '// vibecheck-disable-next-line\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual([]);
  });

  it('scopes to the listed rule id', () => {
    const code = '// vibecheck-disable-next-line no-eval\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual([]);
  });

  it('leaves other rules alone when scoped', () => {
    // console.log(eval(x)) trips both no-eval and no-console-pollution
    const code = '// vibecheck-disable-next-line no-eval\nconsole.log(eval(x));\n';
    expect(rulesOf(code)).toEqual(['no-console-pollution']);
  });

  it('suppresses multiple comma-separated rules on one line', () => {
    const code = '// vibecheck-disable-next-line no-eval, no-console-pollution\nconsole.log(eval(x));\n';
    expect(rulesOf(code)).toEqual([]);
  });

  it('only covers the next line, not the one after', () => {
    const code = '// vibecheck-disable-next-line\nconst ok = 1;\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual(['no-eval']);
  });

  it('works as a block comment', () => {
    const code = '/* vibecheck-disable-next-line no-eval */\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual([]);
  });

  it('accepts an eslint-style "-- reason" suffix', () => {
    const code = '// vibecheck-disable-next-line no-eval -- sandboxed input\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual([]);
  });

  it('suppresses nothing for unknown rule ids', () => {
    const code = '// vibecheck-disable-next-line no-such-rule\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual(['no-eval']);
  });

  it('suppresses multiline-rule findings by their reported line', () => {
    const code = 'try {\n  risky();\n  // vibecheck-disable-next-line no-empty-catch\n} catch (e) {}\n';
    expect(rulesOf(code)).toEqual([]);
  });
});

describe('vibecheck-disable-line and the legacy vibecheck-ignore alias', () => {
  it('suppresses the current line from a trailing comment', () => {
    expect(rulesOf('const a = eval(one); // vibecheck-disable-line\n')).toEqual([]);
  });

  it('treats vibecheck-ignore exactly like vibecheck-disable-line', () => {
    expect(rulesOf('const a = eval(one); // vibecheck-ignore\n')).toEqual([]);
    expect(rulesOf('const a = eval(one); // vibecheck-ignore no-ts-any\n')).toEqual(['no-eval']);
  });
});

describe('vibecheck-disable (file level)', () => {
  it('suppresses the whole file when bare', () => {
    const code = '// vibecheck-disable\nconst a = eval(one);\nconsole.log(x);\n';
    expect(rulesOf(code)).toEqual([]);
  });

  it('suppresses only the listed rules when scoped', () => {
    const code = '// vibecheck-disable no-eval\nconst a = eval(one);\nconsole.log(x);\n';
    expect(rulesOf(code)).toEqual(['no-console-pollution']);
  });
});

describe('hash-comment variant (Python)', () => {
  it('supports disable-next-line', () => {
    const code = '# vibecheck-disable-next-line no-py-print\nprint("debug")\n';
    expect(rulesOf(code, 'x.py')).toEqual([]);
  });

  it('supports file-level disable', () => {
    const code = '# vibecheck-disable\nprint("a")\nprint("b")\n';
    expect(rulesOf(code, 'x.py')).toEqual([]);
  });

  it('tolerates banner-style leading hashes', () => {
    const code = '## vibecheck-disable-next-line no-py-print\nprint("debug")\n';
    expect(rulesOf(code, 'x.py')).toEqual([]);
  });

  it('ignores directives inside Python strings', () => {
    const code = 's = "# vibecheck-disable"\nprint("c")\n';
    expect(rulesOf(code, 'x.py')).toEqual(['no-py-print']);
  });

  it('ignores directives inside triple-quoted strings', () => {
    const code = 'doc = """\n# vibecheck-disable\n"""\nprint("c")\n';
    expect(rulesOf(code, 'x.py')).toEqual(['no-py-print']);
  });
});

describe('directive forgery is rejected (string-aware lexing)', () => {
  it('ignores directives inside string literals', () => {
    const code = 'const s = "// vibecheck-disable-next-line";\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual(['no-eval']);
  });

  it('ignores directives inside multiline template literals', () => {
    const code = 'const s = `\n// vibecheck-disable\n`;\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual(['no-eval']);
  });

  it('ignores hash directives inside JS regex literals', () => {
    const code = 'const re = /# vibecheck-disable/;\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual(['no-eval']);
  });

  it('ignores directives that are not the first token of a comment', () => {
    const code = '// see the vibecheck-disable directive docs\nconst a = eval(one);\n';
    expect(rulesOf(code)).toEqual(['no-eval']);
  });

  it('still parses comments after division and regex literals', () => {
    const divide = 'const half = total / 2; // vibecheck-disable-next-line\nconst a = eval(one);\n';
    expect(rulesOf(divide)).toEqual([]);
    const regex = 'const re = /x/; // vibecheck-disable-next-line\nconst a = eval(one);\n';
    expect(rulesOf(regex)).toEqual([]);
    const keyword = 'function f() { return /x/.test(s); } // vibecheck-disable-next-line\nconst a = eval(one);\n';
    expect(rulesOf(keyword)).toEqual([]);
  });

  it('still parses comments after template interpolation on the same line', () => {
    const code = 'const s = `${a}/${b}`; // vibecheck-disable-next-line\nconst c = eval(one);\n';
    expect(rulesOf(code)).toEqual([]);
  });
});

describe('suppressed findings stay visible', () => {
  it('reports them separately from findings', () => {
    const code = '// vibecheck-disable-next-line no-eval\nconst a = eval(one);\nconst b = eval(two);\n';
    const result = scanContentDetailed(code, 'x.ts', config);
    expect(result.findings.map((f) => f.rule)).toEqual(['no-eval']);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]).toMatchObject({ rule: 'no-eval', line: 2 });
  });
});

describe('parseSuppressions', () => {
  it('returns null when the file has no directives', () => {
    expect(parseSuppressions('const a = 1;\n', 'ts')).toBeNull();
  });

  it('returns null for languages without a known comment syntax', () => {
    expect(parseSuppressions('// vibecheck-disable\n', 'md')).toBeNull();
  });

  it('merges scoped filters targeting the same line', () => {
    const code = '/* vibecheck-disable-next-line no-eval */ // vibecheck-disable-next-line no-console-pollution\nconsole.log(eval(x));\n';
    const sup = parseSuppressions(code, 'ts')!;
    expect(isSuppressed(sup, 'no-eval', 2)).toBe(true);
    expect(isSuppressed(sup, 'no-console-pollution', 2)).toBe(true);
    expect(isSuppressed(sup, 'no-ts-any', 2)).toBe(false);
  });

  it('targets the line after a multiline block comment ends', () => {
    const code = '/* vibecheck-disable-next-line no-eval\n   spanning */\nconst a = eval(one);\n';
    const sup = parseSuppressions(code, 'ts')!;
    expect(isSuppressed(sup, 'no-eval', 3)).toBe(true);
  });
});

describe('JSX containment (.tsx/.jsx)', () => {
  // Rendered JSX text is tokenized as JS by the lexer, so bare directives are
  // forgeable there and must never be honored (Codex probe, both variants).
  it('regression: JSX text cannot forge a line-comment directive', () => {
    const code = 'const el = <div>// vibecheck-disable-next-line no-eval\n  {eval(payload)}\n</div>;\n';
    expect(rulesOf(code, 'x.tsx')).toEqual(['no-eval']);
    expect(rulesOf(code, 'x.jsx')).toEqual(['no-eval']);
  });

  it('regression: JSX text cannot forge a block-comment directive', () => {
    const code = 'const el = <div>/* vibecheck-disable-next-line */\n  {eval(payload)}\n</div>;\n';
    expect(rulesOf(code, 'x.tsx')).toEqual(['no-eval']);
  });

  it('bare directives are ignored in tsx even in plain code', () => {
    const code = '// vibecheck-disable-next-line no-eval\nconst a = eval(one);\n';
    expect(rulesOf(code, 'x.tsx')).toEqual(['no-eval']);
    expect(rulesOf('const a = eval(one); // vibecheck-disable-line\n', 'x.tsx')).toEqual(['no-eval']);
  });

  it('honors the {/* */} expression-comment form in JSX position', () => {
    const code = 'const el = <div>\n  {/* vibecheck-disable-next-line no-eval */}\n  {eval(payload)}\n</div>;\n';
    expect(rulesOf(code, 'x.tsx')).toEqual([]);
  });

  it('honors the brace-adjacent form in plain expression position', () => {
    const code = 'const cfg = { /* vibecheck-disable-next-line no-eval */\n  run: eval(payload),\n};\n';
    expect(rulesOf(code, 'x.tsx')).toEqual([]);
  });

  it('honors file-level disable in the pre-JSX header region', () => {
    const code = '// vibecheck-disable no-eval\nconst a = eval(one);\nconst el = <div>text</div>;\n';
    expect(rulesOf(code, 'x.tsx')).toEqual([]);
  });

  it('ignores bare file-level disable after the first <', () => {
    const code = 'const el = <div>x</div>;\n// vibecheck-disable\nconst a = eval(one);\n';
    expect(rulesOf(code, 'x.tsx')).toEqual(['no-eval']);
  });

  it('honors file-level disable in the {/* */} form inside JSX', () => {
    const code = 'const el = <div>\n  {/* vibecheck-disable no-eval */}\n</div>;\nconst a = eval(one);\n';
    expect(rulesOf(code, 'x.tsx')).toEqual([]);
  });

  it('leaves .ts files unaffected by the JSX rules', () => {
    expect(rulesOf('// vibecheck-disable-next-line no-eval\nconst a = eval(one);\n', 'x.ts')).toEqual([]);
  });
});
