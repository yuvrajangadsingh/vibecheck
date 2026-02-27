import pc from 'picocolors';
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

function padRight(str: string, len: number): string {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

export function formatPretty(result: ScanResult, minSeverity: Severity): string {
  const out: string[] = [];
  const severityOrder: Severity[] = ['error', 'warn', 'info'];
  const minIdx = severityOrder.indexOf(minSeverity);

  const filtered = result.findings.filter(
    (f) => severityOrder.indexOf(f.severity) <= minIdx
  );

  if (filtered.length === 0) {
    out.push('');
    out.push(pc.green('  No issues found.'));
    out.push(
      pc.dim(`  ${result.filesScanned} files scanned (${formatDuration(result.duration)})`)
    );
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
  out.push('');

  return out.join('\n');
}

export function formatJSON(result: ScanResult, minSeverity: Severity): string {
  const severityOrder: Severity[] = ['error', 'warn', 'info'];
  const minIdx = severityOrder.indexOf(minSeverity);
  const filtered = result.findings.filter(
    (f) => severityOrder.indexOf(f.severity) <= minIdx
  );
  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of filtered) summary[f.severity]++;
  return JSON.stringify({ ...result, findings: filtered, summary }, null, 2);
}

export function formatQuiet(result: ScanResult, minSeverity: Severity): string {
  const severityOrder: Severity[] = ['error', 'warn', 'info'];
  const minIdx = severityOrder.indexOf(minSeverity);
  const filtered = result.findings.filter(
    (f) => severityOrder.indexOf(f.severity) <= minIdx
  );

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
