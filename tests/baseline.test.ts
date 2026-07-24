import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findingFingerprint } from '../src/fingerprint.js';
import { loadBaseline, writeBaseline, partitionBaseline } from '../src/baseline.js';
import type { Finding } from '../src/types.js';

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

describe('findingFingerprint', () => {
  it('is stable across line and column moves', () => {
    const a = findingFingerprint(finding({ line: 12, column: 5 }));
    const b = findingFingerprint(finding({ line: 400, column: 1 }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it('changes when rule, path, or snippet changes', () => {
    const base = findingFingerprint(finding());
    expect(findingFingerprint(finding({ rule: 'no-ts-any' }))).not.toBe(base);
    expect(findingFingerprint(finding({ file: 'src/b.ts' }))).not.toBe(base);
    expect(findingFingerprint(finding({ snippet: 'const out = eval(other);' }))).not.toBe(base);
  });

  it('normalizes Windows path separators', () => {
    expect(findingFingerprint(finding({ file: 'src\\a.ts' }))).toBe(findingFingerprint(finding({ file: 'src/a.ts' })));
  });

  it('trims the snippet so surrounding whitespace does not matter', () => {
    expect(findingFingerprint(finding({ snippet: '  const out = eval(payload);  ' }))).toBe(findingFingerprint(finding()));
  });
});

describe('baseline read/write/partition', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-baseline-unit-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips findings through the file with sorted fingerprints', () => {
    const path = join(dir, '.vibecheck-baseline.json');
    const findings = [finding(), finding(), finding({ rule: 'no-ts-any' })];
    expect(writeBaseline(path, findings)).toBe(3);

    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    expect(raw.version).toBe(1);
    const keys = Object.keys(raw.fingerprints);
    expect(keys).toEqual([...keys].sort());
    expect(raw.fingerprints[findingFingerprint(finding())]).toBe(2);

    const loaded = loadBaseline(path)!;
    expect(loaded.get(findingFingerprint(finding()))).toBe(2);
    expect(loaded.size).toBe(2);
  });

  it('partition is count-aware: extra duplicates beyond the baseline are new', () => {
    const baseline = new Map([[findingFingerprint(finding()), 2]]);
    const { newFindings, baselinedCount } = partitionBaseline(
      [finding({ line: 1 }), finding({ line: 2 }), finding({ line: 3 }), finding({ rule: 'no-ts-any' })],
      baseline,
    );
    expect(baselinedCount).toBe(2);
    expect(newFindings).toHaveLength(2);
    expect(newFindings.map((f) => f.line)).toContain(3);
  });

  it('returns null for a missing file', () => {
    expect(loadBaseline(join(dir, 'nope.json'))).toBeNull();
  });

  it('warns and returns null for a corrupt file', () => {
    const path = join(dir, 'corrupt.json');
    writeFileSync(path, 'garbage{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadBaseline(path)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('rejects a fingerprints value that is not an object of counts', () => {
    const path = join(dir, 'bad-shape.json');
    writeFileSync(path, JSON.stringify({ version: 1, fingerprints: ['abc'] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadBaseline(path)).toBeNull();
    warn.mockRestore();
  });
});

// These tests drive the built CLI: run `npm run build` after changing src/.
const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist', 'cli.js');

function run(args: string[], cwd: string) {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', cwd });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('baseline end to end', () => {
  let dir: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
    }
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-baseline-e2e-'));
    writeFileSync(join(dir, 'a.ts'), 'export const out = eval(payload);\nconsole.log("hi");\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('--update-baseline records findings and exits 0', () => {
    const res = run(['--update-baseline', '.'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Baseline written: 2 findings recorded in .vibecheck-baseline.json');
    expect(existsSync(join(dir, '.vibecheck-baseline.json'))).toBe(true);
  });

  it('a scan against the baseline reports 0 new and exits 0', () => {
    const res = run(['.'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('No new issues.');
    expect(res.stdout).toContain('2 findings (2 baselined, 0 new)');
  });

  it('baselined findings survive line shifts (no line number in the fingerprint)', () => {
    writeFileSync(join(dir, 'a.ts'), '\n\n\nexport const out = eval(payload);\nconsole.log("hi");\n');
    const res = run(['-q', '.'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('2 findings (2 baselined, 0 new)');
  });

  it('new findings fail the run and are the only ones reported', () => {
    writeFileSync(
      join(dir, 'a.ts'),
      'export const out = eval(payload);\nconsole.log("hi");\nexport const API_KEY = "sk_live_abcdef1234567890";\n',
    );
    const res = run(['--json', '.'], dir);
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.baselinedCount).toBe(2);
    expect(parsed.findings.map((f: Finding) => f.rule)).toEqual(['no-hardcoded-secrets']);
  });

  it('--update-baseline re-records and the run is clean again', () => {
    expect(run(['--update-baseline', '.'], dir).status).toBe(0);
    const res = run(['-q', '.'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('3 findings (3 baselined, 0 new)');
  });

  it('exit-code gates count new findings only, including --max-warnings', () => {
    // Baseline holds 1 warning (console.log). --max-warnings 0 must still pass.
    expect(run(['-q', '--max-warnings', '0', '.'], dir).status).toBe(0);
    // A new error must still fail even when everything else is baselined.
    writeFileSync(
      join(dir, 'b.ts'),
      'export const other = eval(fresh);\n',
    );
    expect(run(['-q', '.'], dir).status).toBe(1);
    rmSync(join(dir, 'b.ts'));
  });

  it('a corrupt baseline warns and treats every finding as new', () => {
    writeFileSync(join(dir, '.vibecheck-baseline.json'), '{not json');
    const res = run(['-q', '.'], dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('could not parse baseline');
  });

  it('--update-baseline conflicts with diff modes', () => {
    const res = run(['--update-baseline', '--diff', '.'], dir);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('cannot be used with');
  });
});
