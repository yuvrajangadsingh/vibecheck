import { readFileSync, statSync } from 'node:fs';
import { relative, extname } from 'node:path';
import fg from 'fast-glob';
import { allRules, allMultilineRules } from './rules/index.js';
import type { Config, Finding, ScanResult, Severity } from './types.js';
import type { DiffMap } from './diff.js';

const MAX_FILE_SIZE = 1_000_000; // 1MB
const VALID_SEVERITIES: Severity[] = ['error', 'warn', 'info'];

function getLanguage(filePath: string): string {
  return extname(filePath).slice(1);
}

function resolveSeverity(configValue: string | undefined, fallback: Severity): Severity {
  if (configValue && VALID_SEVERITIES.includes(configValue as Severity)) {
    return configValue as Severity;
  }
  return fallback;
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

  const activeRules = allRules.filter((rule) => config.rules[rule.id] !== 'off');
  const activeMultilineRules = allMultilineRules.filter((rule) => config.rules[rule.id] !== 'off');

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

    const lang = getLanguage(filePath);
    const lines = content.split('\n');

    // Filter rules by language once per file
    const rulesForFile = activeRules.filter((r) => r.languages.includes(lang));
    const multilineRulesForFile = activeMultilineRules.filter((r) => r.languages.includes(lang));

    // Line-by-line rules
    for (const rule of rulesForFile) {
      const severity = resolveSeverity(config.rules[rule.id], rule.severity);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = rule.pattern.exec(line);
        if (!match) continue;

        // Check anti-pattern (false positive reduction)
        if (rule.antiPattern && rule.antiPattern.test(line)) continue;

        // Check line exclusions
        if (rule.lineExclusions && rule.lineExclusions.test(line)) continue;

        // In diff mode, skip findings not on changed lines
        if (changedLines && !changedLines.has(i + 1)) continue;

        findings.push({
          rule: rule.id,
          severity,
          category: rule.category,
          file: relPath,
          line: i + 1,
          column: match.index + 1,
          message: rule.messageTemplate,
          snippet: line.trim(),
        });
      }
    }

    // Multiline rules
    for (const rule of multilineRulesForFile) {
      const severity = resolveSeverity(config.rules[rule.id], rule.severity);

      const multiFindings = rule.detect(lines, filePath);
      for (const mf of multiFindings) {
        // In diff mode, skip findings not on changed lines
        if (changedLines && !changedLines.has(mf.line)) continue;

        findings.push({
          rule: rule.id,
          severity,
          category: rule.category,
          file: relPath,
          line: mf.line,
          column: mf.column,
          message: mf.message,
          snippet: mf.snippet.trim(),
        });
      }
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
