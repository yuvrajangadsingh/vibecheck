import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { findingFingerprint } from './fingerprint.js';
import type { Finding } from './types.js';

/**
 * Baseline file: fingerprint -> occurrence count. Recorded findings are
 * accepted; only findings beyond the baseline count as new. Loaded from the
 * working directory like .vibecheckrc.
 */
export const BASELINE_FILENAME = '.vibecheck-baseline.json';

export type Baseline = Map<string, number>;

/**
 * Load a baseline file. Returns null when the file does not exist. A corrupt
 * file warns and returns null, so every finding is treated as new (the noisy,
 * safe direction).
 */
export function loadBaseline(path: string): Baseline | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const fingerprints = parsed?.fingerprints;
    if (typeof fingerprints !== 'object' || fingerprints === null || Array.isArray(fingerprints)) {
      throw new Error('missing fingerprints object');
    }
    const baseline: Baseline = new Map();
    for (const [fingerprint, count] of Object.entries(fingerprints)) {
      if (typeof count === 'number' && Number.isInteger(count) && count > 0) {
        baseline.set(fingerprint, count);
      }
    }
    return baseline;
  } catch {
    console.warn(`Warning: could not parse baseline at ${path}; treating all findings as new.`);
    return null;
  }
}

/** Write (or rewrite) the baseline from the given findings. Returns the count recorded. */
export function writeBaseline(path: string, findings: Finding[]): number {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const fingerprint = findingFingerprint(f);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  // Sorted keys so regenerating the file produces stable, reviewable diffs.
  const fingerprints = Object.fromEntries(
    [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  );
  writeFileSync(path, JSON.stringify({ version: 1, fingerprints }, null, 2) + '\n');
  return findings.length;
}

/**
 * Split findings into baselined and new. Count-aware: when the baseline
 * recorded a fingerprint N times, the first N occurrences are baselined and
 * any extra occurrence is new.
 */
export function partitionBaseline(
  findings: Finding[],
  baseline: Baseline,
): { newFindings: Finding[]; baselinedCount: number } {
  const remaining = new Map(baseline);
  const newFindings: Finding[] = [];
  let baselinedCount = 0;
  for (const f of findings) {
    const fingerprint = findingFingerprint(f);
    const left = remaining.get(fingerprint) ?? 0;
    if (left > 0) {
      remaining.set(fingerprint, left - 1);
      baselinedCount++;
    } else {
      newFindings.push(f);
    }
  }
  return { newFindings, baselinedCount };
}
