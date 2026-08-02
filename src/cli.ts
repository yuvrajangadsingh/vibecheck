import { Command, InvalidArgumentError, Option } from 'commander';
import { resolve, relative, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { scan } from './scanner.js';
import { applyFixes } from './fixer.js';
import { formatPretty, formatJSON, formatQuiet, formatCompact, formatGh, filterBySeverity, padRight } from './formatter.js';
import { formatSarif } from './sarif.js';
import { BASELINE_FILENAME, loadBaseline, writeBaseline, partitionBaseline } from './baseline.js';
import { getGitDiff, getGitRoot, resolveDiffPaths, parseDiff } from './diff.js';
import { allRules, allMultilineRules } from './rules/index.js';
import type { Severity } from './types.js';
import type { DiffMap } from './diff.js';

// Injected from package.json at build time by tsup `define` (single source of truth).
// The typeof guard keeps it working under vitest, where the define is not applied.
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

type OutputFormat = 'pretty' | 'compact' | 'json' | 'quiet' | 'gh' | 'sarif';

function parseMaxWarnings(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError('Expected a non-negative integer.');
  }
  return n;
}

const RULE_LEVELS = new Set(['error', 'warn', 'info', 'off']);
const KNOWN_RULE_IDS = new Set([...allRules, ...allMultilineRules].map((r) => r.id));

// "--rule 'no-eval: off'" (whitespace optional, repeatable). Validated here so
// a typo dies as a usage error (exit 2) before anything scans.
function collectRuleSpec(value: string, previous: Array<[string, Severity | 'off']>): Array<[string, Severity | 'off']> {
  const m = value.match(/^\s*([A-Za-z0-9-]+)\s*:\s*(\S+)\s*$/);
  if (!m) {
    throw new InvalidArgumentError(`Expected 'rule-id: error|warn|info|off', got "${value}".`);
  }
  const [, id, level] = m;
  if (!KNOWN_RULE_IDS.has(id)) {
    const near = [...KNOWN_RULE_IDS].filter((k) => k.includes(id) || id.includes(k)).slice(0, 3);
    const hint = near.length ? ` Did you mean: ${near.join(', ')}?` : ' Run `vibecheck rules` to list rule ids.';
    throw new InvalidArgumentError(`Unknown rule "${id}".${hint}`);
  }
  if (!RULE_LEVELS.has(level)) {
    throw new InvalidArgumentError(`Invalid level "${level}" for rule "${id}". Use error, warn, info, or off.`);
  }
  return [...previous, [id, level as Severity | 'off']];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

const HELP_EXTRA = `
Examples:
  $ vibecheck .                              Scan the current directory
  $ vibecheck --staged .                     Pre-commit: scan only staged changes
  $ vibecheck --fix .                        Remove AI attribution comments
  $ vibecheck . --format gh --fail-on warn   CI: GitHub annotations, fail on warnings
  $ vibecheck --update-baseline .            Adopt: accept current findings, fail on new ones
  $ vibecheck . --format sarif > out.sarif   SARIF 2.1.0 for GitHub code scanning
  $ vibecheck --rule 'no-eval: off' .        This run only, turn one rule off
  $ vibecheck --no-defaults --rule 'no-obvious-comments: warn' .   Run exactly one rule

Exit codes:
  0  clean, or no findings at or above --fail-on
  1  findings at or above --fail-on, or --max-warnings exceeded
  2  usage or runtime error
`;

const program = new Command()
  .name('vibecheck')
  .description('ESLint for AI slop. Detect AI-generated code smells.')
  .version(VERSION, '-v, --version', 'Show version')
  .exitOverride((err) => {
    // Usage errors exit 2 so exit 1 stays reserved for findings; help/version exit 0.
    process.exit(err.exitCode === 0 ? 0 : 2);
  })
  .addHelpText('after', HELP_EXTRA)
  .argument('[path]', 'File or directory to scan', '.')
  .option('-c, --config <file>', 'Path to config file')
  .addOption(new Option('--format <format>', 'Output format').choices(['pretty', 'compact', 'json', 'quiet', 'gh', 'sarif']))
  .option('--json', 'Output as JSON (alias for --format json)')
  .option('--ignore <patterns...>', 'Additional ignore patterns')
  .addOption(new Option('--severity <level>', 'Minimum severity to report').choices(['error', 'warn', 'info']).default('warn'))
  .option('-q, --quiet', 'Only show summary (alias for --format quiet)')
  .addOption(new Option('--fail-on <level>', 'Exit 1 when findings at or above this severity exist').choices(['error', 'warn', 'info', 'never']).default('error'))
  .option('--max-warnings <n>', 'Exit 1 when more than <n> warnings are reported', parseMaxWarnings)
  .option('-d, --diff', 'Only scan lines changed in git diff (unstaged)')
  .option('--staged', 'Only scan lines changed in git diff --cached (staged)')
  .addOption(new Option('--diff-stdin', 'Only scan lines changed in a unified diff read from stdin').conflicts(['diff', 'staged']))
  .option('--statistics', 'Append per-rule finding counts to the report (pretty and json)')
  .addOption(new Option('--update-baseline', `Record current findings in ${BASELINE_FILENAME}, then exit 0`).conflicts(['diff', 'staged', 'diffStdin']))
  .option('--show-suppressed', 'List findings suppressed by inline directives (pretty and json)')
  .option('--rule <spec>', "Set one rule's severity for this run: 'rule-id: error|warn|info|off' (repeatable)", collectRuleSpec, [] as Array<[string, Severity | 'off']>)
  .option('--no-defaults', "Start with every rule off for this run, ignoring the config file's rules; enable a subset with --rule")
  .option('--fix', 'Automatically remove fixable findings (AI attribution comments)')
  .option('--mcp', 'Start MCP server (stdio transport) for AI agent integration')
  .addOption(new Option('-V').hideHelp())
  .action(async (targetPath: string, options: {
    config?: string;
    format?: OutputFormat;
    json?: boolean;
    ignore?: string[];
    severity: Severity;
    quiet?: boolean;
    failOn: Severity | 'never';
    maxWarnings?: number;
    diff?: boolean;
    staged?: boolean;
    diffStdin?: boolean;
    statistics?: boolean;
    updateBaseline?: boolean;
    showSuppressed?: boolean;
    rule: Array<[string, Severity | 'off']>;
    defaults: boolean;
    fix?: boolean;
    mcp?: boolean;
    V?: boolean;
  }) => {
    if (options.V) {
      console.log(VERSION);
      return;
    }

    if (options.mcp) {
      const { startMcpServer } = await import('./mcp.js');
      await startMcpServer();
      return;
    }

    const resolvedPath = resolve(targetPath);

    if (!existsSync(resolvedPath)) {
      console.error(`Error: path "${targetPath}" does not exist.`);
      process.exit(2);
    }

    const config = loadConfig(options.config);

    // Rule selection precedence: built-in defaults -> config file -> --rule
    // flags. --no-defaults zeroes the base (including the config file's rules
    // section) so `--no-defaults --rule 'x: warn'` runs exactly one rule.
    if (!options.defaults) {
      config.rules = {};
      for (const id of KNOWN_RULE_IDS) config.rules[id] = 'off';
    }
    for (const [id, level] of options.rule) {
      config.rules[id] = level;
    }

    // Merge CLI ignore patterns
    if (options.ignore) {
      config.ignore.push(...options.ignore);
    }

    // Determine scan root
    let scanRoot = resolvedPath;
    let stat;
    try {
      stat = statSync(resolvedPath);
    } catch {
      console.error(`Error: cannot read "${targetPath}".`);
      process.exit(2);
    }

    if (stat.isFile()) {
      // For single file, scan its parent dir and include only the filename
      scanRoot = dirname(resolvedPath);
      config.include = [relative(scanRoot, resolvedPath)];
    }

    const format: OutputFormat = options.format ?? (options.json ? 'json' : options.quiet ? 'quiet' : 'pretty');

    // Diff mode: changed lines from git, or from a unified diff piped to stdin
    let diffMap: DiffMap | undefined;
    if (options.diffStdin) {
      if (process.stdin.isTTY) {
        console.error('Error: --diff-stdin expects a unified diff on stdin (e.g. git diff | vibecheck --diff-stdin .).');
        process.exit(2);
      }
      // Diff paths are repo-root-relative (git diff, gh pr diff). Resolve them
      // against the scan root like --diff does, so scanning a subdirectory
      // still matches. Outside a git repo, treat them as scan-root-relative.
      const rawMap = parseDiff(await readStdin());
      try {
        diffMap = resolveDiffPaths(rawMap, getGitRoot(scanRoot), scanRoot);
      } catch {
        diffMap = rawMap;
      }
    } else if (options.diff || options.staged) {
      try {
        const repoRoot = getGitRoot(scanRoot);
        const rawDiff = getGitDiff(repoRoot, !!options.staged);
        diffMap = resolveDiffPaths(rawDiff, repoRoot, scanRoot);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : 'git diff failed'}`);
        process.exit(2);
      }
    }

    if (diffMap && diffMap.size === 0) {
      if (format === 'json') {
        console.log(JSON.stringify({ findings: [], filesScanned: 0, duration: 0, summary: { error: 0, warn: 0, info: 0 }, ...(options.statistics ? { statistics: {} } : {}) }));
      } else if (format === 'sarif') {
        console.log(formatSarif({ findings: [], suppressed: [], filesScanned: 0, duration: 0, summary: { error: 0, warn: 0, info: 0 } }, options.severity, VERSION));
      } else if (format === 'pretty' || format === 'quiet') {
        console.log('\n  No changed files to scan.\n');
      }
      return; // exitCode stays 0; returning lets stdout flush before exit
    }

    let result;
    try {
      result = await scan(scanRoot, config, diffMap);
    } catch (err) {
      console.error(`Error: scan failed for "${targetPath}".`, err instanceof Error ? err.message : '');
      process.exit(2);
    }

    // Apply fixes, then re-scan so remaining findings report accurate line numbers
    let fixNote = '';
    if (options.fix && result.findings.length > 0) {
      const fixResult = applyFixes(result.findings, scanRoot);
      if (fixResult.linesRemoved > 0) {
        fixNote = `  ✔ fixed ${fixResult.linesRemoved} finding${fixResult.linesRemoved === 1 ? '' : 's'} in ${fixResult.filesModified} file${fixResult.filesModified === 1 ? '' : 's'} (removed AI attribution comments)\n`;
        try {
          result = await scan(scanRoot, config, diffMap);
        } catch {
          // keep pre-rescan result if the second pass fails
        }
      }
    }

    // Baseline: --update-baseline records the current findings; normal scans
    // auto-load the file and report (and fail on) new findings only. All
    // severities are recorded so the baseline is independent of --severity.
    const baselinePath = resolve(BASELINE_FILENAME);
    let baselinedCount: number | undefined;
    if (options.updateBaseline) {
      const recorded = writeBaseline(baselinePath, result.findings);
      console.log(`Baseline written: ${recorded} finding${recorded === 1 ? '' : 's'} recorded in ${BASELINE_FILENAME}`);
      return;
    }
    const baseline = loadBaseline(baselinePath);
    if (baseline) {
      const partitioned = partitionBaseline(result.findings, baseline);
      baselinedCount = partitioned.baselinedCount;
      const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
      for (const f of partitioned.newFindings) summary[f.severity]++;
      result = { ...result, findings: partitioned.newFindings, summary };
    }

    // Output
    const minSeverity = options.severity;
    const reported = filterBySeverity(result.findings, minSeverity);
    const formatOpts = { showSuppressed: options.showSuppressed, baselinedCount };

    if (format === 'json') {
      console.log(formatJSON(result, minSeverity, { statistics: options.statistics, ...formatOpts }));
    } else if (format === 'sarif') {
      console.log(formatSarif(result, minSeverity, VERSION));
    } else if (format === 'compact') {
      const out = formatCompact(result, minSeverity);
      if (out) console.log(out);
    } else if (format === 'gh') {
      const out = formatGh(result, minSeverity);
      if (out) console.log(out);
    } else if (format === 'quiet') {
      if (fixNote) console.log(fixNote);
      console.log(formatQuiet(result, minSeverity, formatOpts));
    } else {
      const modeLabel = options.staged ? ' (staged)' : options.diff || options.diffStdin ? ' (diff)' : '';
      console.log(`\n  vibecheck v${VERSION}${modeLabel}\n`);
      if (fixNote) console.log(fixNote);
      console.log(formatPretty(result, minSeverity, { statistics: options.statistics, fixHint: !options.fix, ...formatOpts }));
      // Gate on the raw scan result: a run with findings hidden by the
      // --severity floor, suppressed inline, or absorbed by the baseline is
      // not a clean run.
      if (result.findings.length === 0 && (result.suppressed?.length ?? 0) === 0 && (baselinedCount ?? 0) === 0 && process.stderr.isTTY) {
        process.stderr.write('  ★ If this saved you a review cycle, star the repo: https://github.com/yuvrajangadsingh/vibecheck\n\n');
      }
    }

    // Exit code: 1 when findings at or above --fail-on exist, or --max-warnings is exceeded.
    // Both gates count reported findings only, so anything hidden by --severity never fails the run.
    let failed = options.failOn !== 'never' && filterBySeverity(reported, options.failOn).length > 0;
    if (options.maxWarnings !== undefined) {
      const warnCount = reported.filter((f) => f.severity === 'warn').length;
      if (warnCount > options.maxWarnings) {
        process.stderr.write(`vibecheck: ${warnCount} warning${warnCount === 1 ? '' : 's'} exceed --max-warnings ${options.maxWarnings}.\n`);
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  });

program
  .command('rules')
  .description('List all rules (id, severity, category, languages, fixable)')
  .option('--json', 'Output as JSON')
  .action((_options: { json?: boolean }, command: Command) => {
    // The program-level --json alias consumes the flag before this subcommand
    // sees it, so merge parent options in.
    const options = command.optsWithGlobals() as { json?: boolean };
    const rows = [
      ...allRules.map((r) => ({
        id: r.id, severity: r.severity, category: r.category,
        languages: r.languages, fixable: r.fix === 'remove-line', description: r.description,
      })),
      ...allMultilineRules.map((r) => ({
        id: r.id, severity: r.severity, category: r.category,
        languages: r.languages, fixable: false, description: r.description,
      })),
    ];

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    const idWidth = Math.max(...rows.map((r) => r.id.length));
    const categoryWidth = Math.max(...rows.map((r) => r.category.length));
    const languagesWidth = Math.max(...rows.map((r) => r.languages.join(',').length));
    for (const r of rows) {
      console.log(`${padRight(r.id, idWidth)}  ${padRight(r.severity, 5)}  ${padRight(r.category, categoryWidth)}  ${padRight(r.languages.join(','), languagesWidth)}  ${r.fixable ? 'yes' : 'no'}`);
    }
    console.log(`\n${rows.length} rules`);
  });

program.parseAsync().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
