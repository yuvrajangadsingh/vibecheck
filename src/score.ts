import type { Finding, Severity } from './types.js';

/**
 * Slop score: one number for how much AI residue a codebase carries.
 *
 * Design constraints, each of which exists because the obvious version is
 * gameable or misleading:
 *
 *   Per-KLOC, not per-file and not absolute. A 200k-line repo is not worse
 *   than a 2k-line one for having more findings.
 *
 *   Severity-weighted. An eval() call and a chatty comment should not count
 *   the same, and averaging them hides the eval().
 *
 *   Capped per rule. In the 31-repo scan, no-deep-nesting alone produced 46%
 *   of all findings. Uncapped, the score would mostly measure nesting depth
 *   while claiming to measure slop. The cap is what stops one opinionated
 *   rule from owning the metric.
 *
 *   Exponential decay, not linear. Linear scoring either bottoms out at zero
 *   for bad code (no signal left to improve against) or compresses everything
 *   good into 95-100. Decay keeps resolution across the whole range.
 */

/** Weight per severity. An error is worth ten infos, not three. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 10,
  warn: 3,
  info: 1,
};

/**
 * No single rule may contribute more than this many weighted points per KLOC.
 * Without it the score tracks whichever rule fires most, not overall quality.
 */
export const PER_RULE_CAP = 20;

/**
 * Density that scores exactly 50, imported rather than hardcoded so the number
 * always travels with the corpus that produced it.
 *
 * It is the MEDIAN density of the calibration corpus, which makes the score
 * readable in a sentence: 50 is typical for the codebases measured, above is
 * cleaner than typical, below is worse. Re-derive with:
 *
 *     npx tsx scripts/calibrate.ts <dir-of-repos> --write
 *
 * My first guess for this constant was 12. The measured value is 29.6, which
 * would have scored every real repo in the corpus at or near zero — a metric
 * with no resolution in the range where actual code lives. Guessing it would
 * have shipped a broken score that looked authoritative.
 */
import calibration from './calibration.json' with { type: 'json' };

export const D50: number = calibration.d50;
export const CALIBRATION = calibration;

export type CategoryBreakdown = {
  category: string;
  weighted: number;
  perKloc: number;
  findings: number;
};

export type ScoreResult = {
  score: number;
  grade: string;
  density: number;
  kloc: number;
  /** Weighted points discarded by the per-rule cap, with which rules hit it. */
  cappedRules: { rule: string; raw: number; capped: number }[];
  categories: CategoryBreakdown[];
  d50: number;
};

const GRADES: [number, string][] = [
  [90, 'A'],
  [80, 'B'],
  [70, 'C'],
  [60, 'D'],
  [0, 'F'],
];

export function gradeFor(score: number): string {
  for (const [floor, letter] of GRADES) {
    if (score >= floor) return letter;
  }
  return 'F';
}

/**
 * @param findings  scan findings (suppressed ones already excluded)
 * @param lines     non-empty lines scanned; the denominator
 */
export function computeScore(
  findings: Finding[],
  lines: number,
  d50: number = D50
): ScoreResult {
  // A tiny sample cannot support a density claim. Scanning a 40-line file and
  // finding one warning is not evidence of a slop-ridden codebase, but an
  // unfloored denominator would score it 42 (grade F). Floor at 1 KLOC so
  // small inputs get diluted toward "fine" rather than exaggerated toward
  // "catastrophic" — the metric is about codebases, not snippets.
  const MIN_LINES = 1000;
  const kloc = Math.max(lines, MIN_LINES) / 1000;

  const byRule = new Map<string, number>();
  const byCategory = new Map<string, { weighted: number; count: number }>();

  for (const f of findings) {
    const w = SEVERITY_WEIGHT[f.severity] ?? 1;
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + w);
    const c = byCategory.get(f.category) ?? { weighted: 0, count: 0 };
    c.weighted += w;
    c.count += 1;
    byCategory.set(f.category, c);
  }

  let density = 0;
  const cappedRules: ScoreResult['cappedRules'] = [];
  for (const [rule, weighted] of byRule) {
    const raw = weighted / kloc;
    const capped = Math.min(raw, PER_RULE_CAP);
    if (raw > PER_RULE_CAP) {
      cappedRules.push({
        rule,
        raw: Math.round(raw * 10) / 10,
        capped: PER_RULE_CAP,
      });
    }
    density += capped;
  }

  // Half-life curve: every d50 points of density halves the score.
  const score = Math.round(100 * Math.exp((-density * Math.LN2) / d50));

  const categories = [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      weighted: v.weighted,
      perKloc: Math.round((v.weighted / kloc) * 10) / 10,
      findings: v.count,
    }))
    .sort((a, b) => b.weighted - a.weighted);

  return {
    score,
    grade: gradeFor(score),
    density: Math.round(density * 10) / 10,
    kloc: Math.round(kloc * 10) / 10,
    cappedRules: cappedRules.sort((a, b) => b.raw - a.raw),
    categories,
    d50,
  };
}

/**
 * Never print a bare number. A score with no breakdown is a vanity metric, and
 * the first question anyone asks is "which part is bad".
 */
export function formatScore(r: ScoreResult): string {
  const out: string[] = [];
  out.push(`  slop score  ${r.score}/100  (${r.grade})`);
  out.push(`  ${r.density} weighted findings per 1k lines, over ${r.kloc}k lines`);
  out.push('');
  for (const c of r.categories) {
    out.push(`    ${c.category.padEnd(16)} ${String(c.perKloc).padStart(6)}/KLOC   ${c.findings} findings`);
  }
  if (r.cappedRules.length) {
    out.push('');
    out.push('  capped (one rule cannot dominate the score):');
    for (const c of r.cappedRules) {
      out.push(`    ${c.rule.padEnd(28)} ${c.raw}/KLOC counted as ${c.capped}`);
    }
  }
  return out.join('\n');
}
