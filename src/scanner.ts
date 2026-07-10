import { readFileSync, statSync } from 'node:fs';
import { relative, extname } from 'node:path';
import fg from 'fast-glob';
import { allRules, allMultilineRules } from './rules/index.js';
import type { Config, Finding, ScanResult, Severity } from './types.js';
import type { DiffMap } from './diff.js';

const MAX_FILE_SIZE = 1_000_000; // 1MB
const VALID_SEVERITIES: Severity[] = ['error', 'warn', 'info'];

function getLanguage(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase();
  // .mts/.cts are TypeScript; map them so the ts rules actually run on them.
  if (ext === 'mts' || ext === 'cts') return 'ts';
  return ext;
}

function resolveSeverity(configValue: string | undefined, fallback: Severity): Severity {
  if (configValue && VALID_SEVERITIES.includes(configValue as Severity)) {
    return configValue as Severity;
  }
  return fallback;
}

/**
 * Scan a single file's content directly (used by the CLI, the MCP server, and
 * editor integrations). The directory scanner delegates to this per file.
 */
export function scanContent(content: string, filePath: string, config: Config): Finding[] {
  const lang = getLanguage(filePath);
  const lines = content.split('\n');
  const findings: Finding[] = [];

  const enabled = (id: string) => config.rules[id] !== 'off';
  const forThisFile = (r: { fileExclusions?: RegExp }) =>
    !(r.fileExclusions && r.fileExclusions.test(filePath));

  const activeRules = allRules.filter(
    (r) => enabled(r.id) && r.languages.includes(lang) && forThisFile(r),
  );
  const activeMultilineRules = allMultilineRules.filter(
    (r) => enabled(r.id) && r.languages.includes(lang),
  );

  for (const rule of activeRules) {
    const severity = resolveSeverity(config.rules[rule.id], rule.severity);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = rule.pattern.exec(line);
      if (!match) continue;
      if (rule.antiPattern && rule.antiPattern.test(line)) continue;
      if (rule.lineExclusions && rule.lineExclusions.test(line)) continue;
      findings.push({
        rule: rule.id, severity, category: rule.category,
        file: filePath, line: i + 1, column: match.index + 1,
        message: rule.messageTemplate, snippet: line.trim(),
      });
    }
  }

  for (const rule of activeMultilineRules) {
    const severity = resolveSeverity(config.rules[rule.id], rule.severity);
    for (const mf of rule.detect(lines, filePath)) {
      findings.push({
        rule: rule.id, severity, category: rule.category,
        file: filePath, line: mf.line, column: mf.column,
        message: mf.message, snippet: mf.snippet.trim(),
      });
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return findings;
}

export async function scan(targetPath: string, config: Config, diffMap?: DiffMap): Promise<ScanResult> {
  const start = performance.now();
  const findings: Finding[] = [];

  const files = await fg(config.include, {
    cwd: targetPath,
    ignore: config.ignore,
    absolute: true,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  let scannedCount = 0;

  for (const filePath of files) {
    const relPath = relative(targetPath, filePath);

    // In diff mode, skip files not in the diff before any I/O
    const changedLines = diffMap?.get(relPath);
    if (diffMap && !changedLines) continue;

    // Skip large files
    try {
      const stat = statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) continue;
    } catch {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Skip binary files
    if (content.includes('\0')) continue;

    scannedCount++;

    for (const f of scanContent(content, relPath, config)) {
      // In diff mode, keep only findings on changed lines
      if (changedLines && !changedLines.has(f.line)) continue;
      findings.push(f);
    }
  }

  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    summary[f.severity]++;
  }

  return {
    findings,
    filesScanned: scannedCount,
    duration: performance.now() - start,
    summary,
  };
}
