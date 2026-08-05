import { describe, it, expect } from 'vitest';
import { computeScore, gradeFor, SEVERITY_WEIGHT, PER_RULE_CAP } from '../src/score.js';
import calibration from '../src/calibration.json' with { type: 'json' };
import type { Finding, Severity } from '../src/types.js';

const f = (rule: string, severity: Severity, category = 'code-quality'): Finding => ({
  rule,
  severity,
  category: category as Finding['category'],
  file: 'src/a.ts',
  line: 1,
  column: 1,
  message: 'x',
  snippet: 'x',
});

const many = (n: number, rule: string, sev: Severity, cat?: string) =>
  Array.from({ length: n }, () => f(rule, sev, cat));

describe('slop score', () => {
  it('clean code scores 100', () => {
    const r = computeScore([], 10_000);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
  });

  it('is per-KLOC, so a bigger clean repo is not penalised', () => {
    const small = computeScore(many(10, 'r', 'warn'), 5_000);
    const large = computeScore(many(20, 'r', 'warn'), 10_000);
    expect(small.score).toBe(large.score);
  });

  it('weights an error above an info', () => {
    const errors = computeScore(many(5, 'r', 'error'), 10_000);
    const infos = computeScore(many(5, 'r', 'info'), 10_000);
    expect(errors.score).toBeLessThan(infos.score);
  });

  /**
   * The anti-vanity rule. In the 31-repo scan no-deep-nesting produced 46% of
   * all findings; uncapped, the score would mostly measure nesting depth.
   */
  it('caps any single rule so it cannot own the score', () => {
    const oneNoisyRule = computeScore(many(500, 'no-deep-nesting', 'warn'), 10_000);
    const spread = computeScore(
      [
        ...many(100, 'rule-a', 'warn'),
        ...many(100, 'rule-b', 'warn'),
        ...many(100, 'rule-c', 'warn'),
      ],
      10_000
    );
    expect(oneNoisyRule.score).toBeGreaterThan(spread.score);
    expect(oneNoisyRule.cappedRules[0].rule).toBe('no-deep-nesting');
  });

  it('reports what the cap discarded instead of hiding it', () => {
    const r = computeScore(many(500, 'noisy', 'warn'), 10_000);
    expect(r.cappedRules).toHaveLength(1);
    expect(r.cappedRules[0].raw).toBeGreaterThan(PER_RULE_CAP);
    expect(r.cappedRules[0].capped).toBe(PER_RULE_CAP);
  });

  it('a tiny file cannot produce a catastrophic density', () => {
    // Unfloored, 1 warning in 40 lines is 75/KLOC and scores 1. With a 200
    // line floor it still scored 42, an F for a single warning. The metric
    // describes codebases, so small inputs dilute toward fine.
    const r = computeScore([f('r', 'warn')], 40);
    expect(r.score).toBeGreaterThan(80);
    expect(r.grade).not.toBe('F');
  });

  it('never goes negative or above 100', () => {
    const awful = computeScore(many(5000, 'a', 'error'), 1_000);
    expect(awful.score).toBeGreaterThanOrEqual(0);
    expect(computeScore([], 50_000).score).toBeLessThanOrEqual(100);
  });

  it('halves the score at exactly D50 density', () => {
    // d50=10 means 10 weighted points per KLOC should land on 50.
    const findings = many(10, 'r', 'info'); // weight 1 each = 10 points
    const r = computeScore(findings, 1_000, 10);
    expect(r.score).toBe(50);
  });

  it('breaks the score down by category, worst first', () => {
    const r = computeScore(
      [...many(3, 'sec', 'error', 'security'), ...many(20, 'cq', 'info', 'code-quality')],
      10_000
    );
    expect(r.categories[0].category).toBe('security');
    expect(r.categories.map(c => c.category)).toContain('code-quality');
  });

  it('grades on the documented bands', () => {
    expect(gradeFor(100)).toBe('A');
    expect(gradeFor(70)).toBe('A');
    expect(gradeFor(69)).toBe('B');
    expect(gradeFor(55)).toBe('B');
    expect(gradeFor(54)).toBe('C');
    expect(gradeFor(40)).toBe('C');
    expect(gradeFor(39)).toBe('D');
    expect(gradeFor(24)).toBe('F');
    expect(gradeFor(0)).toBe('F');
  });

  // The bands only mean anything relative to the corpus they were derived from.
  // If a recalibration moves D50 without moving the bands, this catches it: the
  // first version graded the median repo an F, which is what the bands exist to
  // prevent.
  it('spreads the calibration corpus across grades instead of failing it', () => {
    const grades = calibration.repos.map(r => {
      // Reconstruct each repo's score from its recorded density.
      const score = Math.round(100 * Math.exp((-r.density * Math.LN2) / calibration.d50));
      return gradeFor(score);
    });
    // A median repo scores 50 by construction, so it must land mid-scale.
    const medianGrade = gradeFor(50);
    expect(medianGrade).toBe('C');
    expect(grades.filter(g => g === 'F').length).toBeLessThanOrEqual(1);
    expect(new Set(grades).size).toBeGreaterThanOrEqual(3);
  });

  it('severity weights are ordered and explicit', () => {
    expect(SEVERITY_WEIGHT.error).toBeGreaterThan(SEVERITY_WEIGHT.warn);
    expect(SEVERITY_WEIGHT.warn).toBeGreaterThan(SEVERITY_WEIGHT.info);
  });
});

describe('calibration', () => {
  it('ships the corpus that produced D50, not a bare constant', async () => {
    const { CALIBRATION, D50 } = await import('../src/score.js');
    expect(D50).toBe(CALIBRATION.d50);
    expect(CALIBRATION.corpusSize).toBeGreaterThanOrEqual(5);
    expect(CALIBRATION.repos.length).toBe(CALIBRATION.corpusSize);
    expect(CALIBRATION.rulesetVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('D50 is the median of the corpus, so 50 means typical', async () => {
    const { CALIBRATION } = await import('../src/score.js');
    const ds = CALIBRATION.repos.map(r => r.density).sort((a, b) => a - b);
    const m = ds.length % 2
      ? ds[(ds.length - 1) / 2]
      : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2;
    expect(Math.abs(m - CALIBRATION.d50)).toBeLessThanOrEqual(0.1);
  });

  it('a repo at corpus-median density scores about 50', async () => {
    const { computeScore, CALIBRATION } = await import('../src/score.js');
    // 1 error = 10 weighted points, so d50 errors per KLOC lands on the median.
    const perKloc = CALIBRATION.d50;
    const findings = Array.from({ length: Math.round(perKloc / 10) }, (_, i) =>
      f(`rule-${i}`, 'error')
    );
    const r = computeScore(findings, 1_000);
    expect(r.score).toBeGreaterThan(40);
    expect(r.score).toBeLessThan(60);
  });
});
