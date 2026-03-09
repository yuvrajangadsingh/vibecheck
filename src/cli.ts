import { Command } from 'commander';
import { resolve, relative, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { scan } from './scanner.js';
import { formatPretty, formatJSON, formatQuiet } from './formatter.js';
import { getGitDiff, getGitRoot, resolveDiffPaths } from './diff.js';
import type { Severity } from './types.js';
import type { DiffMap } from './diff.js';

const VALID_SEVERITIES: Severity[] = ['error', 'warn', 'info'];

const VERSION = '1.1.0';

const program = new Command()
  .name('vibecheck')
  .description('ESLint for AI slop. Detect AI-generated code smells.')
  .version(VERSION)
  .argument('[path]', 'File or directory to scan', '.')
  .option('-c, --config <file>', 'Path to config file')
  .option('--json', 'Output as JSON')
  .option('--ignore <patterns...>', 'Additional ignore patterns')
  .option('--severity <level>', 'Minimum severity to report: error, warn, info', 'warn')
  .option('-q, --quiet', 'Only show summary')
  .option('-d, --diff', 'Only scan lines changed in git diff (unstaged)')
  .option('--staged', 'Only scan lines changed in git diff --cached (staged)')
  .action(async (targetPath: string, options: {
    config?: string;
    json?: boolean;
    ignore?: string[];
    severity?: string;
    quiet?: boolean;
    diff?: boolean;
    staged?: boolean;
  }) => {
    const resolvedPath = resolve(targetPath);

    if (!existsSync(resolvedPath)) {
      console.error(`Error: path "${targetPath}" does not exist.`);
      process.exit(2);
    }

    const config = loadConfig(options.config);

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

    // Diff mode: get changed lines from git
    let diffMap: DiffMap | undefined;
    if (options.diff || options.staged) {
      try {
        const repoRoot = getGitRoot(scanRoot);
        const rawDiff = getGitDiff(repoRoot, !!options.staged);
        diffMap = resolveDiffPaths(rawDiff, repoRoot, scanRoot);
        if (diffMap.size === 0) {
          if (options.json) {
            console.log(JSON.stringify({ findings: [], filesScanned: 0, duration: 0, summary: { error: 0, warn: 0, info: 0 } }));
          } else {
            console.log('\n  No changed files to scan.\n');
          }
          process.exit(0);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : 'git diff failed'}`);
        process.exit(2);
      }
    }

    let result;
    try {
      result = await scan(scanRoot, config, diffMap);
    } catch (err) {
      console.error(`Error: scan failed for "${targetPath}".`, err instanceof Error ? err.message : '');
      process.exit(2);
    }

    // Output
    const severityInput = options.severity || 'warn';
    const minSeverity: Severity = VALID_SEVERITIES.includes(severityInput as Severity)
      ? (severityInput as Severity)
      : 'warn';

    if (options.json) {
      console.log(formatJSON(result, minSeverity));
    } else if (options.quiet) {
      console.log(formatQuiet(result, minSeverity));
    } else {
      const modeLabel = options.staged ? ' (staged)' : options.diff ? ' (diff)' : '';
      console.log(`\n  vibecheck v${VERSION}${modeLabel}\n`);
      console.log(formatPretty(result, minSeverity));
    }

    // Exit code: 1 if errors found
    if (result.summary.error > 0) {
      process.exit(1);
    }
  });

program.parse();
