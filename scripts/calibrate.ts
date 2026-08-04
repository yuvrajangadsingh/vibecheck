/**
 * Derive D50 — the finding density that scores exactly 50 — from a real corpus.
 *
 *   npx tsx scripts/calibrate.ts <dir-of-repos> [--write]
 *
 * Why this exists at all: without it, D50 is a number someone picked because it
 * made their own repo look good. Every published score would then be
 * unfalsifiable. The rule is that any number that goes out has to be
 * reproducible by a stranger, so the constant is derived from a corpus, pinned
 * to a ruleset version, and shipped with the manifest of what was measured.
 *
 * D50 is set to the MEDIAN density of the corpus, which makes the score
 * readable in one sentence: 50 means "typical for the codebases we measured",
 * above 50 is cleaner than typical, below is worse. Choosing the mean instead
 * would let a handful of disastrous repos drag the midpoint and quietly
 * flatter everyone else.
 */
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scan } from '../src/scanner.js';
import { loadConfig } from '../src/config.js';
import { SEVERITY_WEIGHT, PER_RULE_CAP } from '../src/score.js';
import type { Finding } from '../src/types.js';

const require_ = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

/** Density with the same capping the score uses, so calibration matches scoring. */
function densityOf(findings: Finding[], lines: number): number {
  const kloc = Math.max(lines, 1000) / 1000;
  const byRule = new Map<string, number>();
  for (const f of findings) {
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + (SEVERITY_WEIGHT[f.severity] ?? 1));
  }
  let d = 0;
  for (const weighted of byRule.values()) {
    d += Math.min(weighted / kloc, PER_RULE_CAP);
  }
  return d;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const dir = process.argv[2];
  const write = process.argv.includes('--write');
  if (!dir) {
    console.error('usage: npx tsx scripts/calibrate.ts <dir-of-repos> [--write]');
    process.exit(1);
  }
  const root = resolve(dir);
  const repos = readdirSync(root).filter(n => {
    try {
      return statSync(join(root, n)).isDirectory() && !n.startsWith('.');
    } catch {
      return false;
    }
  });
  if (!repos.length) {
    console.error(`no repos found in ${root}`);
    process.exit(1);
  }

  const rows: { repo: string; density: number; kloc: number; findings: number }[] = [];
  const originalCwd = process.cwd();

  for (const repo of repos) {
    const path = join(root, repo);
    try {
      // loadConfig() resolves .vibecheckrc from process.cwd(), so calibrating
      // from vibecheck's own directory silently applied ITS ignore list
      // (including tests/**) to every repo in the corpus. That produced a D50
      // derived from test-free codebases while real users scan with tests
      // included — the constant would not describe the thing being measured.
      // chdir per repo so each one is configured exactly as `vibecheck .`
      // would configure it.
      process.chdir(path);
      const res = await scan(path, loadConfig());
      const lines = res.linesScanned ?? 0;
      if (lines < 1000) {
        console.error(`  skip ${repo}: only ${lines} lines, too small to calibrate on`);
        continue;
      }
      const d = densityOf(res.findings, lines);
      rows.push({
        repo,
        density: Math.round(d * 100) / 100,
        kloc: Math.round((lines / 1000) * 10) / 10,
        findings: res.findings.length,
      });
      console.error(`  ${repo}: ${d.toFixed(2)}/KLOC over ${(lines / 1000).toFixed(1)}k lines`);
    } catch (err) {
      console.error(`  skip ${repo}: ${(err as Error).message}`);
    } finally {
      process.chdir(originalCwd);
    }
  }

  if (rows.length < 5) {
    console.error(`\nonly ${rows.length} repos measured. A median from fewer than 5 is not a calibration, it is an anecdote. Aborting.`);
    process.exit(1);
  }

  const densities = rows.map(r => r.density);
  const d50 = Math.round(median(densities) * 10) / 10;
  const pkg = require_(new URL('../package.json', import.meta.url).pathname);

  const manifest = {
    d50,
    rulesetVersion: pkg.version,
    corpusSize: rows.length,
    measured: new Date().toISOString().slice(0, 10),
    densities: {
      min: Math.min(...densities),
      p25: median(densities.filter(d => d <= median(densities))),
      median: d50,
      p75: median(densities.filter(d => d >= median(densities))),
      max: Math.max(...densities),
    },
    repos: rows.sort((a, b) => a.density - b.density),
  };

  console.error('');
  console.error(`  D50 = ${d50}  (median of ${rows.length} repos, ruleset ${pkg.version})`);
  console.error(`  range ${manifest.densities.min} to ${manifest.densities.max}`);

  const out = new URL('../src/calibration.json', import.meta.url).pathname;
  if (write) {
    writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
    console.error(`  wrote ${out}`);
    console.error('  now set D50 in src/score.ts to match, or import it from calibration.json');
  } else {
    console.log(JSON.stringify(manifest, null, 2));
    console.error('  (dry run — pass --write to save)');
  }
}

main();
