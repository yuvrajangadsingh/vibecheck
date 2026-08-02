import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allRules } from './rules/index.js';
import type { Finding } from './types.js';

export type FixResult = {
  filesModified: number;
  linesRemoved: number;
  fixedFindings: Finding[];
};

const fixableRuleIds = new Set(allRules.filter((r) => r.fix === 'remove-line').map((r) => r.id));

// HTML findings come from extracted inline <script> bodies; their snippet is
// the script line, but the raw file line still has the surrounding tags. A
// remove-line fix would either fail the snippet-equality guard (a silent no-op
// advertised as fixable) or delete the <script> tags. Until span-based fixes
// exist, HTML findings are non-fixable.
const isHtmlFile = (file: string) => /\.html?$/i.test(file);

export function isFixable(finding: Finding): boolean {
  return fixableRuleIds.has(finding.rule) && !isHtmlFile(finding.file);
}

/**
 * Apply remove-line fixes for fixable findings. Finding paths are relative
 * to targetPath (as produced by scan). A line is only removed when its
 * current content still matches the finding's snippet, so stale or shifted
 * findings are skipped rather than deleting the wrong line.
 */
export function applyFixes(findings: Finding[], targetPath: string): FixResult {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (!isFixable(finding)) continue;
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }

  const result: FixResult = { filesModified: 0, linesRemoved: 0, fixedFindings: [] };

  for (const [relFile, fileFindings] of byFile) {
    const absPath = resolve(targetPath, relFile);
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const targets = fileFindings
      .filter((f) => lines[f.line - 1] !== undefined && lines[f.line - 1].trim() === f.snippet)
      .sort((a, b) => b.line - a.line);
    if (targets.length === 0) continue;

    for (const finding of targets) {
      lines.splice(finding.line - 1, 1);
    }

    try {
      writeFileSync(absPath, lines.join('\n'));
    } catch {
      continue;
    }

    result.filesModified++;
    result.linesRemoved += targets.length;
    result.fixedFindings.push(...targets);
  }

  return result;
}
