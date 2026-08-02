import { describe, it, expect } from 'vitest';
import { lexJs, maskLines } from '../src/lexer.js';

describe('lexJs mask', () => {
  it('preserves length, offsets, and newlines', () => {
    const src = `const a = 'x{y}';\nconst b = 2;\n`;
    const { mask } = lexJs(src);
    expect(mask.length).toBe(src.length);
    expect(mask.split('\n').length).toBe(src.split('\n').length);
  });

  it('blanks string contents including braces and quotes', () => {
    const [m] = maskLines([`const a = "{"; const b = '}';`]);
    expect(m).not.toContain('{');
    expect(m).not.toContain('}');
    expect(m).toContain('const a =');
  });

  it('blanks regex literals, including quotes and braces inside them', () => {
    const [m] = maskLines([`s.replace(/'/g, '&#39;').replace(/{/g, 'x');`]);
    expect(m).not.toContain("'");
    expect(m).not.toContain('{');
    expect(m).toContain('s.replace(');
  });

  it('keeps division intact', () => {
    const [m] = maskLines(['const r = a / b / c;']);
    expect(m).toBe('const r = a / b / c;');
  });

  it('blanks comments but keeps code around them', () => {
    const [m] = maskLines(['go(); // brace } in comment']);
    expect(m).not.toContain('}');
    expect(m).toContain('go();');
  });

  it('blanks block comments spanning lines', () => {
    const masked = maskLines(['a(); /* {', 'still } comment', '*/ b();']);
    expect(masked[0]).not.toContain('{');
    expect(masked[1]).not.toContain('}');
    expect(masked[2]).toContain('b();');
  });

  it('keeps interpolation code but masks template text and the ${} punctuation', () => {
    const [m] = maskLines(['const t = `x ${ fn({ a: 1 }) } y {`;']);
    expect(m).toContain('fn({ a: 1 })');
    // template text braces are gone; interpolation's own ${ } is punctuation
    const braces = (m.match(/[{}]/g) || []).length;
    expect(braces).toBe(2); // only fn's object literal braces survive
  });

  it('brace balance of real code survives masking', () => {
    const src = [
      'function f() {',
      "  const s = 'not a } brace';",
      '  return s.replace(/}/g, `x${1 + 1}y`);',
      '}',
    ];
    const masked = maskLines(src);
    let depth = 0;
    for (const line of masked) for (const ch of line) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    expect(depth).toBe(0);
  });

  it('still extracts comments like the old suppression lexer', () => {
    const { comments } = lexJs('a(); // one\n/* two */ b();\n');
    expect(comments.length).toBe(2);
    expect(comments[0].body.trim()).toBe('one');
    expect(comments[1].body.trim()).toBe('two');
  });
});

describe('lexJs regex/division heuristic (mask drives brace counting)', () => {
  const braceBalance = (src) => {
    let d = 0;
    for (const line of maskLines(src.split('\n'))) for (const ch of line) {
      if (ch === '{') d++; if (ch === '}') d--;
    }
    return d;
  };

  it('division after ++ keeps the closing brace (i++ / 2)', () => {
    // finding 1 repro: /  after ++ must be division, not a phantom regex
    expect(braceBalance('function f() { i++ / 2; }')).toBe(0);
  });

  it('JSX close tag slash does not open a phantom regex', () => {
    // </div> — the slash follows <, must not eat the closing brace
    expect(braceBalance('function T() { return <div></div>; }')).toBe(0);
  });

  it('self-closing JSX keeps braces balanced', () => {
    expect(braceBalance('const C = () => { return <br/>; }')).toBe(0);
  });

  it('regex containing a brace after ( is still masked', () => {
    // the original bug direction: regex after ( must blank its contents
    const [m] = maskLines([`s.replace(/{/g, 'x').replace(/'/g, 'y');`]);
    expect(m).not.toContain('{');
    expect(m).not.toContain("'");
  });

  it('blanks regex flags too (finding 6 mask contract)', () => {
    expect(lexJs('/x/gi').mask).toBe(' '.repeat(5));
    const src = 'const r = /ab/gimsuy;';
    expect(lexJs(src).mask).toBe('const r = ' + ' '.repeat('/ab/gimsuy'.length) + ';');
  });

  it('a real regex after return still masks its contents', () => {
    const [m] = maskLines(['return /a{2}/.test(x);']);
    expect(m).not.toContain('{');
    expect(m).toContain('return');
    expect(m).toContain('.test(x);');
  });

  it('suppression directive after postfix-division is still seen', () => {
    // finding 1: division misread as regex used to swallow the trailing comment
    const { comments } = lexJs('i++ / 2; // vibecheck-disable-next-line no-eval\n');
    expect(comments.length).toBe(1);
    expect(comments[0].body).toContain('vibecheck-disable-next-line');
  });
});
