import { readFileSync } from 'node:fs';
import { relative, extname } from 'node:path';
import fg from 'fast-glob';
import { allRules, allMultilineRules } from './rules/index.js';
import type { Config, Finding, ScanResult, Severity } from './types.js';

function getLanguage(filePath: string): string {
  const ext = extname(filePath).slice(1);
  return ext;
}

export async function scan(targetPath: string, config: Config): Promise<ScanResult> {
  const start = performance.now();
  const findings: Finding[] = [];

  const ignorePatterns = config.ignore.map((p) =>
    p.startsWith('!') ? p : `!${p.includes('/') ? p : `**/${p}`}`
  );

  const files = await fg(config.include, {
    cwd: targetPath,
    ignore: config.ignore,
    absolute: true,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const activeRules = allRules.filter((rule) => {
    const configSeverity = config.rules[rule.id];
    return configSeverity !== 'off';
  });

  const activeMultilineRules = allMultilineRules.filter((rule) => {
    const configSeverity = config.rules[rule.id];
    return configSeverity !== 'off';
  });

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lang = getLanguage(filePath);
    const lines = content.split('\n');
    const relPath = relative(targetPath, filePath);

    // Line-by-line rules
    for (const rule of activeRules) {
      if (!rule.languages.includes(lang)) continue;
      const severity: Severity = (config.rules[rule.id] as Severity) || rule.severity;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = rule.pattern.exec(line);
        if (!match) continue;

        // Check anti-pattern (false positive reduction)
        if (rule.antiPattern && rule.antiPattern.test(line)) continue;

        // Check line exclusions
        if (rule.lineExclusions && rule.lineExclusions.test(line)) continue;

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
    for (const rule of activeMultilineRules) {
      if (!rule.languages.includes(lang)) continue;
      const severity: Severity = (config.rules[rule.id] as Severity) || rule.severity;

      const multiFindings = rule.detect(lines, filePath);
      for (const mf of multiFindings) {
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

  // Sort findings by file, then line
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
    filesScanned: files.length,
    duration: performance.now() - start,
    summary,
  };
}
