import { describe, it, expect } from 'vitest';
import { allRules, allMultilineRules } from '../src/rules/index.js';

describe('rule definitions', () => {
  it('should have unique rule IDs', () => {
    const ids = [
      ...allRules.map(r => r.id),
      ...allMultilineRules.map(r => r.id),
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('should have 14 rules total', () => {
    const total = allRules.length + allMultilineRules.length;
    expect(total).toBe(14);
  });

  it('all rules should have required fields', () => {
    for (const rule of allRules) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(rule.category).toBeTruthy();
      expect(rule.severity).toBeTruthy();
      expect(rule.languages.length).toBeGreaterThan(0);
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(rule.messageTemplate).toBeTruthy();
    }
    for (const rule of allMultilineRules) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.detect).toBeTypeOf('function');
    }
  });
});

describe('security rules', () => {
  const secretRule = allRules.find(r => r.id === 'no-hardcoded-secrets')!;
  const evalRule = allRules.find(r => r.id === 'no-eval')!;
  const htmlRule = allRules.find(r => r.id === 'no-innerhtml')!;
  const sqlRule = allRules.find(r => r.id === 'no-sql-concat')!;

  it('detects hardcoded API keys', () => {
    expect(secretRule.pattern.test('const API_KEY = "sk_live_abcdef1234567890"')).toBe(true);
    expect(secretRule.pattern.test('const token = "ghp_ABCDEFabcdef1234567890"')).toBe(true);
  });

  it('skips env variable references', () => {
    const line = 'const key = process.env.API_KEY';
    expect(secretRule.antiPattern!.test(line)).toBe(true);
  });

  it('detects eval()', () => {
    expect(evalRule.pattern.test('eval(userInput)')).toBe(true);
    expect(evalRule.pattern.test('new Function("return " + code)')).toBe(true);
  });

  it('detects innerHTML', () => {
    expect(htmlRule.pattern.test('el.innerHTML = userInput')).toBe(true);
    expect(htmlRule.pattern.test('dangerouslySetInnerHTML={{ __html: data }}')).toBe(true);
  });

  it('detects SQL concatenation', () => {
    expect(sqlRule.pattern.test('`SELECT * FROM users WHERE id = ${userId}`')).toBe(true);
  });
});

describe('error handling rules', () => {
  const emptyCatch = allMultilineRules.find(r => r.id === 'no-empty-catch')!;
  const consoleOnly = allMultilineRules.find(r => r.id === 'no-console-error-only')!;
  const swallowed = allRules.find(r => r.id === 'no-swallowed-promise')!;

  it('detects empty catch blocks (single line)', () => {
    const lines = ['try {', '  doSomething();', '} catch (e) { }'];
    const findings = emptyCatch.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('detects empty catch blocks (multi-line)', () => {
    const lines = ['try {', '  doSomething();', '} catch (e) {', '}'];
    const findings = emptyCatch.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('skips non-empty catch blocks', () => {
    const lines = ['try {', '  doSomething();', '} catch (e) {', '  throw e;', '}'];
    const findings = emptyCatch.detect(lines, 'test.ts');
    expect(findings.length).toBe(0);
  });

  it('detects console-only catch blocks', () => {
    const lines = ['try {', '  doSomething();', '} catch (e) {', '  console.error(e);', '}'];
    const findings = consoleOnly.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('detects swallowed promises', () => {
    expect(swallowed.pattern.test('fetch("/api").then(r => r.json());')).toBe(true);
  });

  it('skips promises with catch', () => {
    const line = 'fetch("/api").then(r => r.json()).catch(handleError);';
    // Pattern matches .then without .catch on same match, but antiPattern catches it
    expect(swallowed.antiPattern!.test(line)).toBe(true);
  });
});

describe('ai tell rules', () => {
  const obvious = allRules.find(r => r.id === 'no-obvious-comments')!;
  const tsAny = allRules.find(r => r.id === 'no-ts-any')!;

  it('detects obvious comments', () => {
    expect(obvious.pattern.test('// Initialize the counter')).toBe(true);
    expect(obvious.pattern.test('// Return the result')).toBe(true);
    expect(obvious.pattern.test('// Increment the value')).toBe(true);
    expect(obvious.pattern.test('// Get the user')).toBe(true);
  });

  it('skips meaningful comments', () => {
    expect(obvious.pattern.test('// We use 30s timeout due to p99 latency')).toBe(false);
    expect(obvious.pattern.test('// Workaround for Chrome bug #12345')).toBe(false);
  });

  it('detects as any', () => {
    expect(tsAny.pattern.test('const x = data as any')).toBe(true);
    expect(tsAny.pattern.test('function foo(x: any) {}')).toBe(true);
  });
});

describe('code quality rules', () => {
  const consolePollution = allRules.find(r => r.id === 'no-console-pollution')!;
  const aiTodo = allRules.find(r => r.id === 'no-ai-todo')!;
  const godFunc = allMultilineRules.find(r => r.id === 'no-god-function')!;

  it('detects console.log', () => {
    expect(consolePollution.pattern.test('console.log("debug")')).toBe(true);
    expect(consolePollution.pattern.test('console.debug("test")')).toBe(true);
  });

  it('skips console.error and console.warn', () => {
    expect(consolePollution.pattern.test('console.error("fail")')).toBe(false);
    expect(consolePollution.pattern.test('console.warn("warning")')).toBe(false);
  });

  it('detects AI placeholder TODOs', () => {
    expect(aiTodo.pattern.test('// TODO: implement validation')).toBe(true);
    expect(aiTodo.pattern.test('// FIXME: add error handling')).toBe(true);
    expect(aiTodo.pattern.test('// TODO: replace with proper implementation')).toBe(true);
  });

  it('skips regular TODOs', () => {
    expect(aiTodo.pattern.test('// TODO: @yuvraj review this before merge')).toBe(false);
    expect(aiTodo.pattern.test('// TODO: blocked by upstream PR #123')).toBe(false);
  });

  it('detects god functions (>80 lines)', () => {
    const lines = ['function bigFunc() {'];
    for (let i = 0; i < 85; i++) lines.push('  const x = ' + i + ';');
    lines.push('}');
    const findings = godFunc.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('87 lines');
  });

  it('skips small functions', () => {
    const lines = ['function small() {', '  return 1;', '}'];
    const findings = godFunc.detect(lines, 'test.ts');
    expect(findings.length).toBe(0);
  });
});
