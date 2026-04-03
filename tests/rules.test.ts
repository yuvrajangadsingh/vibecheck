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

  it('should have 34 rules total', () => {
    const total = allRules.length + allMultilineRules.length;
    expect(total).toBe(34);
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

  it('detects SQL string concat after closing quote', () => {
    expect(sqlRule.pattern.test("const q = 'SELECT * FROM users WHERE id = ' + userId;")).toBe(true);
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

  it('detects parameterless empty catch (ES2019+)', () => {
    const lines = ['try {', '  doSomething();', '} catch {', '}'];
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

  it('detects swallowed promises without semicolon', () => {
    expect(swallowed.pattern.test('fetch("/api").then(r => r.json())')).toBe(true);
  });

  it('detects empty catch with multiple blank lines', () => {
    const lines = ['try {', '  doSomething();', '} catch (e) {', '', '', '}'];
    const findings = emptyCatch.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('detects single-line console-only catch', () => {
    const lines = ['try { foo(); } catch (e) { console.error(e); }'];
    const findings = consoleOnly.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
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

  it('does not flag if/for/while blocks as functions', () => {
    const lines = ['if (condition) {'];
    for (let i = 0; i < 85; i++) lines.push('  doSomething();');
    lines.push('}');
    const findings = godFunc.detect(lines, 'test.ts');
    expect(findings.length).toBe(0);
  });

  it('handles braces inside strings correctly', () => {
    const lines = ['function withStrings() {'];
    lines.push('  const x = "}";');
    for (let i = 0; i < 83; i++) lines.push('  doSomething();');
    lines.push('}');
    const findings = godFunc.detect(lines, 'test.ts');
    expect(findings.length).toBe(1);
  });
});

describe('framework rules', () => {
  const expressRule = allRules.find(r => r.id === 'no-express-unhandled')!;
  const infoLeak = allRules.find(r => r.id === 'no-error-info-leak')!;

  it('detects async Express routes without error handling', () => {
    expect(expressRule.pattern.test('app.get("/users", async (req, res) => {')).toBe(true);
    expect(expressRule.pattern.test('router.post("/data", async (req, res) => {')).toBe(true);
  });

  it('skips sync Express routes', () => {
    expect(expressRule.pattern.test('app.get("/users", (req, res) => {')).toBe(false);
  });

  it('skips routes with async error wrappers', () => {
    const line = 'app.get("/safe", asyncHandler(async (req, res) => {';
    expect(expressRule.antiPattern!.test(line)).toBe(true);
  });

  it('detects error info leaks in responses', () => {
    expect(infoLeak.pattern.test('res.json({ error: err.message })')).toBe(true);
    expect(infoLeak.pattern.test('res.send({ stack: error.stack })')).toBe(true);
  });

  it('skips generic error responses', () => {
    expect(infoLeak.pattern.test('res.json({ error: "Something went wrong" })')).toBe(false);
  });
});

describe('python rules', () => {
  const pyEval = allRules.find(r => r.id === 'no-py-eval')!;
  const pySql = allRules.find(r => r.id === 'no-py-sql-concat')!;
  const bareExcept = allRules.find(r => r.id === 'no-bare-except')!;
  const starImport = allRules.find(r => r.id === 'no-star-import')!;
  const mutableDefault = allRules.find(r => r.id === 'no-mutable-default')!;
  const pyPrint = allRules.find(r => r.id === 'no-py-print')!;
  const flaskDebug = allRules.find(r => r.id === 'no-flask-debug')!;
  const pyObvious = allRules.find(r => r.id === 'no-py-obvious-comments')!;
  const typeIgnore = allRules.find(r => r.id === 'no-type-ignore-blanket')!;
  const passExcept = allMultilineRules.find(r => r.id === 'no-pass-except')!;

  it('detects eval/exec/os.system', () => {
    expect(pyEval.pattern.test('result = eval(user_input)')).toBe(true);
    expect(pyEval.pattern.test('exec("import os")')).toBe(true);
    expect(pyEval.pattern.test('os.system("rm -rf /")')).toBe(true);
    expect(pyEval.pattern.test('subprocess.run(cmd, shell=True)')).toBe(true);
  });

  it('skips ast.literal_eval', () => {
    expect(pyEval.antiPattern!.test('ast.literal_eval(data)')).toBe(true);
  });

  it('detects f-string SQL', () => {
    expect(pySql.pattern.test('f"SELECT * FROM users WHERE id = {user_id}"')).toBe(true);
    expect(pySql.pattern.test('"DELETE FROM logs WHERE date = \'{}\'".format(date_str)')).toBe(true);
  });

  it('detects bare except', () => {
    expect(bareExcept.pattern.test('except:')).toBe(true);
    expect(bareExcept.pattern.test('    except:')).toBe(true);
  });

  it('skips typed except', () => {
    expect(bareExcept.pattern.test('except ValueError:')).toBe(false);
    expect(bareExcept.pattern.test('except Exception as e:')).toBe(false);
  });

  it('detects star imports', () => {
    expect(starImport.pattern.test('from os import *')).toBe(true);
    expect(starImport.pattern.test('from django.db.models import *')).toBe(true);
  });

  it('skips specific imports', () => {
    expect(starImport.pattern.test('from os import path, getcwd')).toBe(false);
  });

  it('detects mutable default arguments', () => {
    expect(mutableDefault.pattern.test('def process_items(items=[], cache={}):')).toBe(true);
    expect(mutableDefault.pattern.test('def foo(data=set()):')).toBe(true);
  });

  it('skips immutable defaults', () => {
    expect(mutableDefault.pattern.test('def func(name="default", count=0):')).toBe(false);
  });

  it('detects print statements', () => {
    expect(pyPrint.pattern.test('print("debug value:", result)')).toBe(true);
  });

  it('detects Flask debug mode', () => {
    expect(flaskDebug.pattern.test('app.run(debug=True, port=5000)')).toBe(true);
  });

  it('detects obvious Python comments', () => {
    expect(pyObvious.pattern.test('# initialize the counter')).toBe(true);
    expect(pyObvious.pattern.test('# return the result')).toBe(true);
  });

  it('skips meaningful Python comments', () => {
    expect(pyObvious.pattern.test('# Workaround for Django ORM bug #456')).toBe(false);
  });

  it('detects blanket type: ignore', () => {
    expect(typeIgnore.pattern.test('x: int = "hello"  # type: ignore')).toBe(true);
  });

  it('skips specific type: ignore', () => {
    expect(typeIgnore.antiPattern!.test('x: int = foo()  # type: ignore[no-untyped-call]')).toBe(true);
  });

  it('detects except: pass (single line)', () => {
    const lines = ['try:', '    risky()', 'except: pass'];
    const findings = passExcept.detect(lines, 'test.py');
    expect(findings.length).toBe(1);
  });

  it('detects except Exception: pass (multi-line)', () => {
    const lines = ['try:', '    risky()', 'except Exception:', '    pass'];
    const findings = passExcept.detect(lines, 'test.py');
    expect(findings.length).toBe(1);
  });

  it('skips except with real handling', () => {
    const lines = ['try:', '    risky()', 'except Exception as e:', '    logger.error(e)', '    raise'];
    const findings = passExcept.detect(lines, 'test.py');
    expect(findings.length).toBe(0);
  });

  it('detects AI TODOs in Python comments', () => {
    const aiTodo = allRules.find(r => r.id === 'no-ai-todo')!;
    expect(aiTodo.pattern.test('# TODO: implement error handling')).toBe(true);
    expect(aiTodo.pattern.test('# FIXME: add validation here')).toBe(true);
  });

  it('detects hardcoded secrets in Python', () => {
    const secrets = allRules.find(r => r.id === 'no-hardcoded-secrets')!;
    expect(secrets.pattern.test('api_key = "xk_test_abcdef1234567890abcdef"')).toBe(true);
  });
});

describe('hallucinated import rules', () => {
  const jsRule = allRules.find(r => r.id === 'no-hallucinated-import-js')!;
  const pyRule = allRules.find(r => r.id === 'no-hallucinated-import-py')!;

  it('detects hallucinated ES import', () => {
    expect(jsRule.pattern.test("import Anthropic from '@anthropic/sdk'")).toBe(true);
    expect(jsRule.pattern.test("import { decode } from 'jwt-decode-utils'")).toBe(true);
  });

  it('detects hallucinated require()', () => {
    expect(jsRule.pattern.test("const cron = require('node-cron-scheduler')")).toBe(true);
    expect(jsRule.pattern.test('const plugin = require("webpack-bundle-analyzer-plugin")')).toBe(true);
  });

  it('detects hallucinated dynamic import()', () => {
    expect(jsRule.pattern.test("const mod = import('@anthropic/sdk')")).toBe(true);
    expect(jsRule.pattern.test("await import('jwt-decode-utils')")).toBe(true);
  });

  it('detects hallucinated export from', () => {
    expect(jsRule.pattern.test("export { default } from '@openai/api'")).toBe(true);
    expect(jsRule.pattern.test("export * from '@langchain/agents'")).toBe(true);
  });

  it('detects hallucinated scoped packages', () => {
    expect(jsRule.pattern.test("import { OpenAI } from '@openai/api'")).toBe(true);
    expect(jsRule.pattern.test("import { Agent } from '@langchain/agents'")).toBe(true);
    expect(jsRule.pattern.test("import type { Router } from '@types/react-router-v5'")).toBe(true);
  });

  it('skips real JS packages', () => {
    expect(jsRule.pattern.test("import Anthropic from '@anthropic-ai/sdk'")).toBe(false);
    expect(jsRule.pattern.test("import OpenAI from 'openai'")).toBe(false);
    expect(jsRule.pattern.test("import { decode } from 'jwt-decode'")).toBe(false);
    expect(jsRule.pattern.test("import cron from 'node-cron'")).toBe(false);
  });

  it('skips JS comments and strings', () => {
    expect(jsRule.antiPattern!.test("// import from '@anthropic/sdk'")).toBe(true);
    expect(jsRule.antiPattern!.test("/* require('@openai/api') */")).toBe(true);
  });

  it('detects hallucinated Python imports', () => {
    expect(pyRule.pattern.test('import pandas_profiler')).toBe(true);
    expect(pyRule.pattern.test('from langchain_agents import Agent')).toBe(true);
    expect(pyRule.pattern.test('import anthropic_sdk')).toBe(true);
    expect(pyRule.pattern.test('from chromadb_utils import something')).toBe(true);
  });

  it('detects indented Python imports', () => {
    expect(pyRule.pattern.test('    import pandas_profiler')).toBe(true);
    expect(pyRule.pattern.test('        from langchain_agents import Agent')).toBe(true);
  });

  it('detects comma-separated Python imports', () => {
    expect(pyRule.pattern.test('import anthropic_sdk, os')).toBe(true);
  });

  it('skips Python comments', () => {
    expect(pyRule.antiPattern!.test('# import anthropic_sdk')).toBe(true);
    expect(pyRule.antiPattern!.test('  # from langchain_agents import x')).toBe(true);
  });

  it('skips real Python packages', () => {
    expect(pyRule.pattern.test('import anthropic')).toBe(false);
    expect(pyRule.pattern.test('from openai import OpenAI')).toBe(false);
    expect(pyRule.pattern.test('import langchain')).toBe(false);
    expect(pyRule.pattern.test('from flask_cors import CORS')).toBe(false);
    expect(pyRule.pattern.test('import chromadb')).toBe(false);
  });
});
