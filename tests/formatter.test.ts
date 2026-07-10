import { describe, it, expect } from 'vitest';
import { formatPretty, formatJSON, formatCompact, formatGh, filterBySeverity, computeStatistics } from '../src/formatter.js';
import type { Finding, ScanResult } from '../src/types.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    rule: 'no-empty-catch',
    severity: 'error',
    category: 'error-handling',
    file: 'src/a.ts',
    line: 12,
    column: 5,
    message: 'Empty catch block swallows errors silently.',
    snippet: 'catch (e) {}',
    ...overrides,
  };
}

function scanResult(findings: Finding[]): ScanResult {
  const summary: ScanResult['summary'] = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;
  return { findings, filesScanned: 3, duration: 42, summary };
}

describe('filterBySeverity', () => {
  const findings = [
    finding({ severity: 'error' }),
    finding({ severity: 'warn' }),
    finding({ severity: 'info' }),
  ];

  it('keeps findings at or above the floor', () => {
    expect(filterBySeverity(findings, 'error').map((f) => f.severity)).toEqual(['error']);
    expect(filterBySeverity(findings, 'warn').map((f) => f.severity)).toEqual(['error', 'warn']);
    expect(filterBySeverity(findings, 'info').length).toBe(3);
  });
});

describe('formatCompact', () => {
  it('emits one path:line:col line per finding', () => {
    const out = formatCompact(scanResult([finding()]), 'warn');
    expect(out).toBe('src/a.ts:12:5  error  no-empty-catch  Empty catch block swallows errors silently.');
  });

  it('filters below the severity floor and returns empty string when nothing remains', () => {
    const out = formatCompact(scanResult([finding({ severity: 'info' })]), 'warn');
    expect(out).toBe('');
  });
});

describe('formatGh', () => {
  it('maps severities to workflow commands', () => {
    const out = formatGh(scanResult([
      finding({ severity: 'error' }),
      finding({ severity: 'warn' }),
      finding({ severity: 'info' }),
    ]), 'info');
    const lines = out.split('\n');
    expect(lines[0]).toBe('::error file=src/a.ts,line=12,col=5,title=vibecheck no-empty-catch::Empty catch block swallows errors silently.');
    expect(lines[1].startsWith('::warning ')).toBe(true);
    expect(lines[2].startsWith('::notice ')).toBe(true);
  });

  it('escapes %, CR, and LF in messages', () => {
    const out = formatGh(scanResult([finding({ message: '50% done\r\nnext' })]), 'warn');
    expect(out.endsWith('::50%25 done%0D%0Anext')).toBe(true);
  });

  it('escapes % before the other sequences (no double escaping)', () => {
    const out = formatGh(scanResult([finding({ message: 'literal %0A here' })]), 'warn');
    expect(out.endsWith('::literal %250A here')).toBe(true);
  });

  it('additionally escapes : and , in properties', () => {
    const out = formatGh(scanResult([finding({ file: 'we,ird:name.ts' })]), 'warn');
    expect(out).toContain('file=we%2Cird%3Aname.ts,');
  });
});

describe('computeStatistics', () => {
  it('counts per rule, sorted by count descending then rule id', () => {
    const stats = computeStatistics([
      finding({ rule: 'no-ts-any' }),
      finding({ rule: 'no-empty-catch' }),
      finding({ rule: 'no-ts-any' }),
      finding({ rule: 'no-console-pollution' }),
    ]);
    expect(Object.entries(stats)).toEqual([
      ['no-ts-any', 2],
      ['no-console-pollution', 1],
      ['no-empty-catch', 1],
    ]);
  });
});

describe('formatJSON', () => {
  it('includes a statistics object only when requested', () => {
    const result = scanResult([finding(), finding({ line: 20 })]);
    const withStats = JSON.parse(formatJSON(result, 'warn', { statistics: true }));
    expect(withStats.statistics).toEqual({ 'no-empty-catch': 2 });

    const without = JSON.parse(formatJSON(result, 'warn'));
    expect('statistics' in without).toBe(false);
  });

  it('recomputes summary from filtered findings', () => {
    const result = scanResult([finding(), finding({ severity: 'info' })]);
    const parsed = JSON.parse(formatJSON(result, 'warn'));
    expect(parsed.findings.length).toBe(1);
    expect(parsed.summary).toEqual({ error: 1, warn: 0, info: 0 });
  });
});

describe('formatPretty', () => {
  it('prints the offending snippet under each finding', () => {
    const out = formatPretty(scanResult([finding()]), 'warn');
    expect(out).toContain('catch (e) {}');
  });

  it('notes hidden info findings under the default floor', () => {
    const result = scanResult([finding(), finding({ severity: 'info' }), finding({ severity: 'info' })]);
    const out = formatPretty(result, 'warn');
    expect(out).toContain('2 info findings hidden (run with --severity info)');
  });

  it('notes hidden info findings even when nothing is reported', () => {
    const result = scanResult([finding({ severity: 'info' })]);
    const out = formatPretty(result, 'warn');
    expect(out).toContain('No issues found.');
    expect(out).toContain('1 info finding hidden (run with --severity info)');
  });

  it('omits the hidden note at --severity info', () => {
    const result = scanResult([finding({ severity: 'info' })]);
    expect(formatPretty(result, 'info')).not.toContain('hidden');
  });

  it('shows the --fix hint only for fixable findings when enabled', () => {
    const fixable = scanResult([finding({ rule: 'no-ai-attribution', severity: 'warn', category: 'code-quality' })]);
    expect(formatPretty(fixable, 'warn', { fixHint: true })).toContain('1 finding fixable with --fix');
    expect(formatPretty(fixable, 'warn', { fixHint: false })).not.toContain('fixable with --fix');
    expect(formatPretty(scanResult([finding()]), 'warn', { fixHint: true })).not.toContain('fixable with --fix');
  });

  it('appends per-rule statistics when requested', () => {
    const result = scanResult([finding(), finding({ line: 20 })]);
    const out = formatPretty(result, 'warn', { statistics: true });
    expect(out).toContain('2  no-empty-catch');
    expect(formatPretty(result, 'warn')).not.toContain('2  no-empty-catch');
  });
});
