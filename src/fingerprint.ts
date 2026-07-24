import { createHash } from 'node:crypto';
import type { Finding } from './types.js';

/**
 * Stable identity for a finding: sha1(ruleId|path|trimmed snippet). No line
 * number, so the fingerprint survives code moving up or down a file. Paths
 * are normalized to forward slashes so baselines travel across platforms.
 * Shared by the baseline file and SARIF partialFingerprints.
 */
export function findingFingerprint(f: Pick<Finding, 'rule' | 'file' | 'snippet'>): string {
  return createHash('sha1')
    .update(`${f.rule}|${f.file.replace(/\\/g, '/')}|${f.snippet.trim()}`)
    .digest('hex');
}
