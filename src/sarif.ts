import { allRules, allMultilineRules } from './rules/index.js';
import { findingFingerprint } from './fingerprint.js';
import { filterBySeverity } from './formatter.js';
import type { Category, ScanResult, Severity } from './types.js';

const REPO_URL = 'https://github.com/yuvrajangadsingh/vibecheck';

// README section anchors, so helpUri lands on the rule's category table.
const CATEGORY_ANCHOR: Record<Category, string> = {
  security: 'security',
  'error-handling': 'error-handling',
  'code-quality': 'code-quality',
  'ai-tell': 'ai-specific-tells',
  framework: 'framework',
};

const SARIF_LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  error: 'error',
  warn: 'warning',
  info: 'note',
};

/** Relative path -> URI: forward slashes, each segment percent-encoded. */
function toUri(path: string): string {
  return path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

/**
 * SARIF 2.1.0 log. Rules metadata comes from the rule registry;
 * partialFingerprints reuse the baseline fingerprint so GitHub code scanning
 * tracks findings across line moves.
 */
export function formatSarif(result: ScanResult, minSeverity: Severity, version: string): string {
  const registry = [...allRules, ...allMultilineRules];
  const indexById = new Map(registry.map((r, i) => [r.id, i]));

  const rules = registry.map((r) => ({
    id: r.id,
    name: r.name,
    shortDescription: { text: r.description },
    helpUri: `${REPO_URL}#${CATEGORY_ANCHOR[r.category]}`,
    defaultConfiguration: { level: SARIF_LEVEL[r.severity] },
    properties: { category: r.category },
  }));

  const results = filterBySeverity(result.findings, minSeverity).map((f) => {
    const ruleIndex = indexById.get(f.rule);
    return {
      ruleId: f.rule,
      ...(ruleIndex !== undefined ? { ruleIndex } : {}),
      level: SARIF_LEVEL[f.severity],
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: toUri(f.file), uriBaseId: '%SRCROOT%' },
            region: {
              startLine: Math.max(1, f.line),
              startColumn: Math.max(1, f.column),
              ...(f.snippet ? { snippet: { text: f.snippet } } : {}),
            },
          },
        },
      ],
      partialFingerprints: { 'vibecheckFingerprint/v1': findingFingerprint(f) },
    };
  });

  const log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'vibecheck',
            informationUri: REPO_URL,
            version,
            rules,
          },
        },
        columnKind: 'utf16CodeUnits',
        results,
      },
    ],
  };

  return JSON.stringify(log, null, 2);
}
