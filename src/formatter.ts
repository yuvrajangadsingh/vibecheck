import pc from 'picocolors';
import { isFixable } from './fixer.js';
import type { Finding, ScanResult, Severity } from './types.js';

const severityColor: Record<Severity, (s: string) => string> = {
  error: pc.red,
  warn: pc.yellow,
  info: pc.dim,
};

const severityLabel: Record<Severity, string> = {
  error: 'error',
  warn: 'warn ',
  info: 'info ',
};

const severityOrder: Severity[] = ['error', 'warn', 'info'];

export type FormatOptions = {
  statistics?: boolean;
  fixHint?: boolean;
};

/** Findings at or above the given severity (error is highest). */
export function filterBySeverity(findings: Finding[], minSeverity: Severity): Finding[] {
  const minIdx = severityOrder.indexOf(minSeverity);
  return findings.filter((f) => severityOrder.indexOf(f.severity) <= minIdx);
}

export function padRight(str: string, len: number): string {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function hiddenInfoNote(result: ScanResult, minSeverity: Severity): string | null {
  if (minSeverity === 'info') return null;
  const hidden = result.findings.filter((f) => f.severity === 'info').length;
  if (hidden === 0) return null;
  return pc.dim(`  ${hidden} info finding${hidden !== 1 ? 's' : ''} hidden (run with --severity info)`);
}

/** Per-rule finding counts, sorted by count descending then rule id. */
export function computeStatistics(findings: Finding[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return Object.fromEntries(sorted);
}

export function formatPretty(result: ScanResult, minSeverity: Severity, opts: FormatOptions = {}): string {
  const out: string[] = [];
  const filtered = filterBySeverity(result.findings, minSeverity);
  const infoNote = hiddenInfoNote(result, minSeverity);

  if (filtered.length === 0) {
    out.push('');
    out.push(pc.green('  No issues found.'));
    out.push(
      pc.dim(`  ${result.filesScanned} files scanned (${formatDuration(result.duration)})`)
    );
    if (infoNote) out.push(infoNote);
    out.push('');
    return out.join('\n');
  }

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of filtered) {
    const arr = byFile.get(f.file) || [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  out.push('');
  for (const [file, findings] of byFile) {
    out.push(`  ${pc.bold(pc.underline(file))}`);
    for (const f of findings) {
      const sev = severityColor[f.severity](severityLabel[f.severity]);
      out.push(`    ${padRight(`${f.line}:${f.column}`, 8)} ${sev}  ${padRight(f.rule, 28)} ${f.message}`);
      if (f.snippet) out.push(pc.dim(`             ${truncate(f.snippet, 120)}`));
    }
    out.push('');
  }

  // Summary (only count visible findings)
  const filteredSummary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of filtered) filteredSummary[f.severity]++;

  const parts: string[] = [];
  if (filteredSummary.error > 0)
    parts.push(pc.red(`${filteredSummary.error} error${filteredSummary.error !== 1 ? 's' : ''}`));
  if (filteredSummary.warn > 0)
    parts.push(pc.yellow(`${filteredSummary.warn} warning${filteredSummary.warn !== 1 ? 's' : ''}`));
  if (filteredSummary.info > 0)
    parts.push(pc.dim(`${filteredSummary.info} info`));

  const total = filtered.length;
  const filesWithIssues = byFile.size;
  out.push(
    `  ${pc.bold(`${total} problem${total !== 1 ? 's' : ''}`)} (${parts.join(', ')})`
  );
  out.push(
    pc.dim(
      `  ${filesWithIssues} file${filesWithIssues !== 1 ? 's' : ''} with issues out of ${result.filesScanned} scanned (${formatDuration(result.duration)})`
    )
  );

  const fixable = filtered.filter(isFixable).length;
  if (opts.fixHint && fixable > 0) {
    out.push(pc.dim(`  ${fixable} finding${fixable !== 1 ? 's' : ''} fixable with --fix`));
  }
  if (infoNote) out.push(infoNote);

  if (opts.statistics) {
    const stats = Object.entries(computeStatistics(filtered));
    const width = Math.max(...stats.map(([, count]) => String(count).length));
    out.push('');
    for (const [rule, count] of stats) {
      out.push(`  ${String(count).padStart(width)}  ${rule}`);
    }
  }
  out.push('');

  return out.join('\n');
}

export function formatJSON(result: ScanResult, minSeverity: Severity, opts: FormatOptions = {}): string {
  const filtered = filterBySeverity(result.findings, minSeverity);
  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of filtered) summary[f.severity]++;
  const payload: Record<string, unknown> = { ...result, findings: filtered, summary };
  if (opts.statistics) payload.statistics = computeStatistics(filtered);
  return JSON.stringify(payload, null, 2);
}

export function formatCompact(result: ScanResult, minSeverity: Severity): string {
  return filterBySeverity(result.findings, minSeverity)
    .map((f) => `${f.file}:${f.line}:${f.column}  ${f.severity}  ${f.rule}  ${f.message}`)
    .join('\n');
}

// GitHub Actions workflow-command escaping: % first, then CR/LF; properties
// additionally escape : and , (https://docs.github.com/actions/reference/workflow-commands-for-github-actions)
function escapeGhData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeGhProperty(value: string): string {
  return escapeGhData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

const ghCommand: Record<Severity, string> = { error: 'error', warn: 'warning', info: 'notice' };

export function formatGh(result: ScanResult, minSeverity: Severity): string {
  return filterBySeverity(result.findings, minSeverity)
    .map((f) =>
      `::${ghCommand[f.severity]} file=${escapeGhProperty(f.file)},line=${f.line},col=${f.column},title=${escapeGhProperty(`vibecheck ${f.rule}`)}::${escapeGhData(f.message)}`
    )
    .join('\n');
}

export function formatQuiet(result: ScanResult, minSeverity: Severity): string {
  const filtered = filterBySeverity(result.findings, minSeverity);

  if (filtered.length === 0) {
    return pc.green('No issues found.');
  }

  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of filtered) summary[f.severity]++;

  const parts: string[] = [];
  if (summary.error > 0) parts.push(`${summary.error} errors`);
  if (summary.warn > 0) parts.push(`${summary.warn} warnings`);
  if (summary.info > 0) parts.push(`${summary.info} info`);
  return `${filtered.length} problems: ${parts.join(', ')}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
