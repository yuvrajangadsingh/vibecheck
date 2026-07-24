import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { formatSarif } from '../src/sarif.js';
import { findingFingerprint } from '../src/fingerprint.js';
import { allRules, allMultilineRules } from '../src/rules/index.js';
import type { Finding, ScanResult } from '../src/types.js';

const RULE_COUNT = allRules.length + allMultilineRules.length;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    rule: 'no-eval',
    severity: 'error',
    category: 'security',
    file: 'src/a.ts',
    line: 12,
    column: 5,
    message: 'eval() or new Function() allows arbitrary code execution.',
    snippet: 'const out = eval(payload);',
    ...overrides,
  };
}

function scanResult(findings: Finding[]): ScanResult {
  const summary: ScanResult['summary'] = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;
  return { findings, suppressed: [], filesScanned: 3, duration: 42, summary };
}

/**
 * Minimal structural check against the SARIF 2.1.0 spec: asserts every
 * property GitHub code scanning requires plus the shapes vibecheck promises,
 * without pulling in a JSON-schema validator dependency.
 */
function assertValidSarif(log: any): void {
  expect(log.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
  expect(log.version).toBe('2.1.0');
  expect(Array.isArray(log.runs)).toBe(true);
  expect(log.runs).toHaveLength(1);

  const run = log.runs[0];
  const driver = run.tool?.driver;
  expect(driver.name).toBe('vibecheck');
  expect(typeof driver.version).toBe('string');
  expect(driver.informationUri).toMatch(/^https:\/\//);

  expect(Array.isArray(driver.rules)).toBe(true);
  expect(driver.rules).toHaveLength(RULE_COUNT);
  for (const rule of driver.rules) {
    expect(typeof rule.id).toBe('string');
    expect(rule.id.length).toBeGreaterThan(0);
    expect(typeof rule.shortDescription?.text).toBe('string');
    expect(rule.helpUri).toMatch(/^https:\/\/github\.com\/yuvrajangadsingh\/vibecheck#/);
    expect(['error', 'warning', 'note']).toContain(rule.defaultConfiguration?.level);
  }

  expect(Array.isArray(run.results)).toBe(true);
  for (const result of run.results) {
    expect(typeof result.ruleId).toBe('string');
    expect(Number.isInteger(result.ruleIndex)).toBe(true);
    expect(result.ruleIndex).toBeGreaterThanOrEqual(0);
    expect(result.ruleIndex).toBeLessThan(driver.rules.length);
    expect(driver.rules[result.ruleIndex].id).toBe(result.ruleId);
    expect(['error', 'warning', 'note']).toContain(result.level);
    expect(typeof result.message?.text).toBe('string');
    expect(result.message.text.length).toBeGreaterThan(0);

    expect(result.locations).toHaveLength(1);
    const physical = result.locations[0].physicalLocation;
    expect(typeof physical.artifactLocation?.uri).toBe('string');
    // Relative URI: no backslashes, no unencoded spaces
    expect(physical.artifactLocation.uri).not.toMatch(/[\\ ]/);
    expect(physical.region.startLine).toBeGreaterThanOrEqual(1);
    expect(physical.region.startColumn).toBeGreaterThanOrEqual(1);

    expect(typeof result.partialFingerprints?.['vibecheckFingerprint/v1']).toBe('string');
  }
}

describe('formatSarif', () => {
  it('emits a valid SARIF 2.1.0 log with the full rule registry', () => {
    const log = JSON.parse(formatSarif(scanResult([finding()]), 'warn', '1.13.0'));
    assertValidSarif(log);
    expect(log.runs[0].tool.driver.version).toBe('1.13.0');
    expect(log.runs[0].columnKind).toBe('utf16CodeUnits');
  });

  it('maps severities to SARIF levels (error/warning/note)', () => {
    const findings = [
      finding({ severity: 'error' }),
      finding({ severity: 'warn', rule: 'no-ts-any', category: 'ai-tell' }),
      finding({ severity: 'info', rule: 'no-obvious-comments', category: 'ai-tell' }),
    ];
    const log = JSON.parse(formatSarif(scanResult(findings), 'info', '1.13.0'));
    expect(log.runs[0].results.map((r: any) => r.level)).toEqual(['error', 'warning', 'note']);
  });

  it('respects the --severity floor', () => {
    const findings = [finding({ severity: 'error' }), finding({ severity: 'info', rule: 'no-obvious-comments' })];
    const log = JSON.parse(formatSarif(scanResult(findings), 'warn', '1.13.0'));
    expect(log.runs[0].results).toHaveLength(1);
  });

  it('reuses the baseline fingerprint as partialFingerprints', () => {
    const f = finding();
    const log = JSON.parse(formatSarif(scanResult([f]), 'warn', '1.13.0'));
    expect(log.runs[0].results[0].partialFingerprints['vibecheckFingerprint/v1']).toBe(findingFingerprint(f));
  });

  it('escapes paths and snippets with special characters', () => {
    const f = finding({
      file: 'weird dir (v2)\\naïve file.ts',
      snippet: 'const q = eval(`has "quotes" \\ and ünïcode`);',
      message: 'Message with "quotes" & <angles>',
    });
    const raw = formatSarif(scanResult([f]), 'warn', '1.13.0');
    const log = JSON.parse(raw); // JSON must stay parseable
    assertValidSarif(log);
    const result = log.runs[0].results[0];
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      'weird%20dir%20(v2)/na%C3%AFve%20file.ts',
    );
    // Snippet and message round-trip exactly
    expect(result.locations[0].physicalLocation.region.snippet.text).toBe(f.snippet);
    expect(result.message.text).toBe(f.message);
  });

  it('emits an empty results array for a clean scan', () => {
    const log = JSON.parse(formatSarif(scanResult([]), 'warn', '1.13.0'));
    assertValidSarif(log);
    expect(log.runs[0].results).toEqual([]);
  });

  it('populates rule metadata from the registry', () => {
    const log = JSON.parse(formatSarif(scanResult([]), 'warn', '1.13.0'));
    const rules = log.runs[0].tool.driver.rules;
    const noEval = rules.find((r: any) => r.id === 'no-eval');
    expect(noEval.name).toBe(allRules.find((r) => r.id === 'no-eval')!.name);
    expect(noEval.defaultConfiguration.level).toBe('error');
    expect(noEval.helpUri).toBe('https://github.com/yuvrajangadsingh/vibecheck#security');
    expect(noEval.properties.category).toBe('security');
    // Multiline rules are in the registry too
    expect(rules.some((r: any) => r.id === 'no-empty-catch')).toBe(true);
  });
});

// These tests drive the built CLI: run `npm run build` after changing src/.
const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist', 'cli.js');

function run(args: string[], cwd: string) {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', cwd });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('--format sarif end to end', () => {
  let dir: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
    }
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-sarif-e2e-'));
    mkdirSync(join(dir, 'sub dir'));
    writeFileSync(join(dir, 'sub dir', 'bad.ts'), 'export const out = eval(payload);\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints a valid log with findings and exits with the normal fail-on code', () => {
    const res = run(['.', '--format', 'sarif'], dir);
    expect(res.status).toBe(1);
    const log = JSON.parse(res.stdout);
    assertValidSarif(log);
    const result = log.runs[0].results[0];
    expect(result.ruleId).toBe('no-eval');
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('sub%20dir/bad.ts');
    expect(result.locations[0].physicalLocation.region.startLine).toBe(1);
  });

  it('prints a valid empty log on a clean scan', () => {
    const clean = mkdtempSync(join(tmpdir(), 'vibecheck-sarif-clean-'));
    writeFileSync(join(clean, 'ok.ts'), 'export const x = 1;\n');
    try {
      const res = run(['.', '--format', 'sarif'], clean);
      expect(res.status).toBe(0);
      const log = JSON.parse(res.stdout);
      assertValidSarif(log);
      expect(log.runs[0].results).toEqual([]);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it('excludes baselined findings, matching the other formats', () => {
    expect(run(['--update-baseline', '.'], dir).status).toBe(0);
    try {
      const res = run(['.', '--format', 'sarif'], dir);
      expect(res.status).toBe(0);
      expect(JSON.parse(res.stdout).runs[0].results).toEqual([]);
    } finally {
      rmSync(join(dir, '.vibecheck-baseline.json'));
    }
  });
});
