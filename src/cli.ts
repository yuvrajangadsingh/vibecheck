import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { scan } from './scanner.js';
import { formatPretty, formatJSON, formatQuiet } from './formatter.js';
import type { Severity } from './types.js';

const VERSION = '1.0.0';

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
  .action(async (targetPath: string, options: {
    config?: string;
    json?: boolean;
    ignore?: string[];
    severity?: string;
    quiet?: boolean;
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
      // For single file, scan its parent and filter to just that file
      scanRoot = resolve(resolvedPath, '..');
      config.include = [resolvedPath];
    }

    const result = await scan(scanRoot, config);

    // Output
    const minSeverity = (options.severity || 'warn') as Severity;

    if (options.json) {
      console.log(formatJSON(result));
    } else if (options.quiet) {
      console.log(formatQuiet(result));
    } else {
      console.log(`\n  vibecheck v${VERSION}\n`);
      console.log(formatPretty(result, minSeverity));
    }

    // Exit code: 1 if errors found
    if (result.summary.error > 0) {
      process.exit(1);
    }
  });

program.parse();
