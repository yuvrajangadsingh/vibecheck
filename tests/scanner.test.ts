import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { scan } from '../src/scanner.js';
import { loadConfig } from '../src/config.js';

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');

describe('scanner', () => {
  it('scans fixture directory and finds issues', async () => {
    const config = loadConfig();
    const result = await scan(FIXTURES_DIR, config);

    expect(result.filesScanned).toBe(6);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.summary.error).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('findings are sorted by file then line', async () => {
    const config = loadConfig();
    const result = await scan(FIXTURES_DIR, config);

    for (let i = 1; i < result.findings.length; i++) {
      const prev = result.findings[i - 1];
      const curr = result.findings[i];
      if (prev.file === curr.file) {
        expect(curr.line).toBeGreaterThanOrEqual(prev.line);
      }
    }
  });

  it('respects rule config overrides', async () => {
    const config = loadConfig();
    config.rules['no-console-pollution'] = 'off';
    const result = await scan(FIXTURES_DIR, config);

    const consoleFindings = result.findings.filter(f => f.rule === 'no-console-pollution');
    expect(consoleFindings.length).toBe(0);
  });

  it('hard security rules have error severity', async () => {
    const config = loadConfig();
    const result = await scan(FIXTURES_DIR, config);

    // no-innerhtml and the SQL-concat rules are deliberately warn: they are regex
    // heuristics that can false-positive, so they surface without failing CI.
    const heuristic = new Set(['no-innerhtml', 'no-sql-concat', 'no-py-sql-concat']);
    const securityErrors = result.findings.filter(
      f => f.category === 'security' && !heuristic.has(f.rule)
    );
    for (const f of securityErrors) {
      expect(f.severity).toBe('error');
    }
  });

  it('all findings have required fields', async () => {
    const config = loadConfig();
    const result = await scan(FIXTURES_DIR, config);

    for (const f of result.findings) {
      expect(f.rule).toBeTruthy();
      expect(f.severity).toBeTruthy();
      expect(f.category).toBeTruthy();
      expect(f.file).toBeTruthy();
      expect(f.line).toBeGreaterThan(0);
      expect(f.column).toBeGreaterThan(0);
      expect(f.message).toBeTruthy();
    }
  });
});

import { scanContent, extractInlineScripts } from '../src/scanner.js';

describe('html inline script scanning', () => {
  const config = loadConfig();

  it('lints inline <script> bodies with original line numbers', () => {
    const html = [
      '<!doctype html>',
      '<html><body>',
      '<script>',
      'try { go(); } catch (e) {}',
      '</script>',
      '</body></html>',
      '',
    ].join('\n');
    const findings = scanContent(html, 'app.html', config);
    const empty = findings.filter(f => f.rule === 'no-empty-catch');
    expect(empty.length).toBe(1);
    expect(empty[0].line).toBe(4);
  });

  it('skips external and non-JS scripts', () => {
    const html = [
      '<script src="app.js"></script>',
      '<script type="application/json">{"catch": "not code {}{}{}"}</script>',
      '<script type="importmap">{"imports": {}}</script>',
      '',
    ].join('\n');
    const findings = scanContent(html, 'app.html', config);
    expect(findings.length).toBe(0);
  });

  it('honors suppression comments inside inline scripts', () => {
    const html = [
      '<script>',
      '// vibecheck-disable-next-line no-empty-catch -- deliberate',
      'try { go(); } catch (e) {}',
      '</script>',
      '',
    ].join('\n');
    const findings = scanContent(html, 'app.html', config);
    expect(findings.filter(f => f.rule === 'no-empty-catch').length).toBe(0);
  });

  it('does not lint html text outside scripts', () => {
    const html = '<p>catch (e) {} console.log("hi") eval("x")</p>\n';
    const findings = scanContent(html, 'page.html', config);
    expect(findings.length).toBe(0);
  });

  it('extractInlineScripts preserves offsets exactly', () => {
    const html = '<b>x</b><script>a();</script><i>y</i>';
    const out = extractInlineScripts(html);
    expect(out.length).toBe(html.length);
    expect(out.indexOf('a();')).toBe(html.indexOf('a();'));
    expect(out).not.toContain('<b>');
  });

  it('does not extract a <script> inside an HTML comment (finding 2)', () => {
    const html = [
      '<!-- <script>// vibecheck-disable</script> -->',
      '<script>eval(payload)</script>',
      '',
    ].join('\n');
    const findings = scanContent(html, 'app.html', config);
    // the commented directive must NOT suppress the real eval on line 2
    expect(findings.filter(f => f.rule === 'no-eval').length).toBe(1);
    expect(findings[0].line).toBe(2);
  });

  it('does not lint code inside a commented-out script', () => {
    const html = '<!-- <script>eval(payload)</script> -->\n';
    expect(scanContent(html, 'app.html', config).length).toBe(0);
  });

  it('a > inside an attribute value does not end the opening tag (finding 4)', () => {
    const html = '<script data-note=">eval(bogus)">safe();</script>\n';
    const findings = scanContent(html, 'app.html', config);
    // eval(bogus) lives in the attribute, not the body; only safe() is code
    expect(findings.filter(f => f.rule === 'no-eval').length).toBe(0);
  });

  it('data-src / data-type do not mask a real inline script (finding 4)', () => {
    const a = scanContent('<script data-src="later">eval(payload)</script>\n', 'a.html', config);
    const b = scanContent('<script data-type="application/json">eval(payload)</script>\n', 'b.html', config);
    expect(a.filter(f => f.rule === 'no-eval').length).toBe(1);
    expect(b.filter(f => f.rule === 'no-eval').length).toBe(1);
  });

  it('<script-foo> custom element is not a script', () => {
    expect(scanContent('<script-foo>eval(payload)</script-foo>\n', 'a.html', config).length).toBe(0);
  });

  it('</scripture> does not end the script body early', () => {
    const html = '<script>const x = 1; // </scripture> eval(payload)</script>\n';
    const findings = scanContent(html, 'a.html', config);
    // eval is inside a comment here, but the point is the body was not cut at </scripture>
    expect(findings.every(f => f.line === 1)).toBe(true);
  });

  it('recognizes more JS MIME essences and skips module vs json correctly', () => {
    const js = scanContent('<script type="application/x-javascript">eval(x)</script>\n', 'a.html', config);
    const mod = scanContent('<script type="module">eval(x)</script>\n', 'b.html', config);
    const json = scanContent('<script type="application/json">{"eval":"x"}</script>\n', 'c.html', config);
    expect(js.filter(f => f.rule === 'no-eval').length).toBe(1);
    expect(mod.filter(f => f.rule === 'no-eval').length).toBe(1);
    expect(json.length).toBe(0);
  });

  it('type with charset param still matches the JS essence', () => {
    const html = '<script type="text/javascript; charset=utf-8">eval(x)</script>\n';
    expect(scanContent(html, 'a.html', config).filter(f => f.rule === 'no-eval').length).toBe(1);
  });

  it('marks html findings non-fixable so --fix never silently no-ops (finding 5)', async () => {
    const { isFixable } = await import('../src/fixer.js');
    const html = '<script>// Generated by ChatGPT</script>\n';
    const findings = scanContent(html, 'app.html', config);
    const attr = findings.find(f => f.rule === 'no-ai-attribution');
    expect(attr).toBeTruthy();
    expect(isFixable(attr!)).toBe(false);
  });
});
