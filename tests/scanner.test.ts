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

  it('security findings have error severity', async () => {
    const config = loadConfig();
    const result = await scan(FIXTURES_DIR, config);

    const securityErrors = result.findings.filter(
      f => f.category === 'security' && f.rule !== 'no-innerhtml'
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
