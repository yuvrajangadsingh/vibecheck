import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// These tests drive the built CLI: run `npm run build` after changing src/.
const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist', 'cli.js');

function run(args: string[], opts: { input?: string; cwd?: string } = {}) {
  const res = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    input: opts.input ?? '',
    cwd: opts.cwd ?? ROOT,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

let warnDir: string;
let errorDir: string;
let infoDir: string;
let cleanDir: string;

beforeAll(() => {
  if (!existsSync(CLI)) {
    execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
  }

  warnDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-warn-'));
  writeFileSync(join(warnDir, 'warn.ts'), "console.log('starting up');\nexport const y = window as any;\n");

  errorDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-error-'));
  writeFileSync(join(errorDir, 'error.ts'), 'export const out = eval(payload);\n');

  infoDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-info-'));
  writeFileSync(join(infoDir, 'info.ts'), '// TODO: implement caching here\nexport const cache = {};\n');

  cleanDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-clean-'));
  writeFileSync(join(cleanDir, 'ok.ts'), 'export const x = 1;\n');
});

afterAll(() => {
  for (const dir of [warnDir, errorDir, infoDir, cleanDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('usage errors exit 2', () => {
  it('rejects an invalid --severity value', () => {
    const res = run(['--severity', 'high', '.'], { cwd: cleanDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Allowed choices are error, warn, info');
  });

  it('rejects an invalid --format value', () => {
    const res = run(['--format', 'yaml', '.'], { cwd: cleanDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Allowed choices are pretty, compact, json, quiet, gh, sarif');
  });

  it('rejects an invalid --fail-on value', () => {
    const res = run(['--fail-on', 'always', '.'], { cwd: cleanDir });
    expect(res.status).toBe(2);
  });

  it('rejects unknown options', () => {
    const res = run(['--bogus', '.'], { cwd: cleanDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('unknown option');
  });

  it('rejects a non-numeric --max-warnings', () => {
    const res = run(['--max-warnings=abc', '.'], { cwd: cleanDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('non-negative integer');
  });

  it('rejects a negative --max-warnings', () => {
    const res = run(['--max-warnings=-1', '.'], { cwd: cleanDir });
    expect(res.status).toBe(2);
  });

  it('rejects --diff-stdin combined with --diff or --staged', () => {
    const staged = run(['--diff-stdin', '--staged', '.'], { cwd: cleanDir });
    expect(staged.status).toBe(2);
    expect(staged.stderr).toContain('cannot be used with');
    expect(run(['--diff-stdin', '--diff', '.'], { cwd: cleanDir }).status).toBe(2);
  });

  // The score is per-KLOC over a whole codebase. In diff mode only changed
  // lines are scanned and the MIN_LINES floor divides by 1000, which produced a
  // number that was both meaningless and optimistic: a commit adding eval()
  // scored 69 (B) in diff mode vs 46 (C) for the same repo scanned whole. A
  // --diff --min-score gate would have waved through what it exists to catch.
  it('refuses the score flags in diff mode instead of reporting a flattering number', () => {
    for (const mode of ['--diff', '--staged', '--diff-stdin']) {
      for (const scoreFlag of [['--score'], ['--min-score', '60'], ['--badge', 'x.svg']]) {
        const res = run([mode, ...scoreFlag, '.'], { cwd: cleanDir });
        expect(res.status, `${mode} ${scoreFlag[0]}`).toBe(2);
        expect(res.stderr, `${mode} ${scoreFlag[0]}`).toContain('cannot be used with');
      }
    }
  });

  it('exits 2 for a nonexistent path', () => {
    const res = run(['/nonexistent-vibecheck-path']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('does not exist');
  });
});

describe('version aliases', () => {
  it('-v, -V, and --version all print the version and exit 0', () => {
    for (const flag of ['-v', '-V', '--version']) {
      const res = run([flag]);
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe('--fail-on', () => {
  it('defaults to error: warnings alone exit 0', () => {
    expect(run(['-q', '.'], { cwd: warnDir }).status).toBe(0);
    expect(run(['-q', '.'], { cwd: errorDir }).status).toBe(1);
  });

  it('fails on warnings with --fail-on warn', () => {
    expect(run(['-q', '--fail-on', 'warn', '.'], { cwd: warnDir }).status).toBe(1);
  });

  it('never fails with --fail-on never', () => {
    expect(run(['-q', '--fail-on', 'never', '.'], { cwd: errorDir }).status).toBe(0);
  });

  it('counts reported findings only: info hidden by the severity floor does not fail', () => {
    expect(run(['-q', '--fail-on', 'info', '.'], { cwd: infoDir }).status).toBe(0);
    expect(run(['-q', '--fail-on', 'info', '--severity', 'info', '.'], { cwd: infoDir }).status).toBe(1);
  });
});

describe('--max-warnings', () => {
  it('fixture has exactly two warnings', () => {
    const res = run(['--json', '.'], { cwd: warnDir });
    expect(JSON.parse(res.stdout).summary.warn).toBe(2);
  });

  it('passes at the boundary and fails above it', () => {
    expect(run(['-q', '--max-warnings', '2', '.'], { cwd: warnDir }).status).toBe(0);
    const over = run(['-q', '--max-warnings', '1', '.'], { cwd: warnDir });
    expect(over.status).toBe(1);
    expect(over.stderr).toContain('2 warnings exceed --max-warnings 1');
  });

  it('does not count warnings hidden by the severity floor', () => {
    expect(run(['-q', '--max-warnings', '0', '--severity', 'error', '.'], { cwd: warnDir }).status).toBe(0);
  });
});

describe('--format', () => {
  it('compact emits path:line:col lines', () => {
    const res = run(['--format', 'compact', '.'], { cwd: errorDir });
    expect(res.stdout).toMatch(/^error\.ts:1:\d+  error  no-eval  /m);
    expect(res.status).toBe(1);
  });

  it('gh emits workflow commands', () => {
    const res = run(['--format', 'gh', '.'], { cwd: errorDir });
    expect(res.stdout).toMatch(/^::error file=error\.ts,line=1,col=\d+,title=vibecheck no-eval::/m);
    const warn = run(['--format', 'gh', '.'], { cwd: warnDir });
    expect(warn.stdout).toMatch(/^::warning file=warn\.ts,/m);
  });

  it('gh and compact print nothing on a clean scan', () => {
    for (const format of ['gh', 'compact']) {
      const res = run(['--format', format, '.'], { cwd: cleanDir });
      expect(res.stdout).toBe('');
      expect(res.status).toBe(0);
    }
  });

  it('keeps --json and -q working as aliases', () => {
    const json = run(['--json', '.'], { cwd: errorDir });
    expect(JSON.parse(json.stdout).summary.error).toBe(1);
    const quiet = run(['-q', '.'], { cwd: errorDir });
    expect(quiet.stdout).toContain('1 problems: 1 errors');
  });

  it('--format json matches the --json alias', () => {
    const res = run(['--format', 'json', '.'], { cwd: errorDir });
    expect(JSON.parse(res.stdout).findings.length).toBe(1);
  });
});

describe('--statistics', () => {
  it('appends per-rule counts to pretty output', () => {
    const res = run(['--statistics', '.'], { cwd: warnDir });
    expect(res.stdout).toContain('1  no-console-pollution');
    expect(res.stdout).toContain('1  no-ts-any');
  });

  it('adds a statistics object to JSON output only when set', () => {
    const withStats = JSON.parse(run(['--json', '--statistics', '.'], { cwd: warnDir }).stdout);
    expect(withStats.statistics).toEqual({ 'no-console-pollution': 1, 'no-ts-any': 1 });
    const without = JSON.parse(run(['--json', '.'], { cwd: warnDir }).stdout);
    expect('statistics' in without).toBe(false);
  });
});

describe('--diff-stdin', () => {
  const DIFF = `diff --git a/d.ts b/d.ts
--- a/d.ts
+++ b/d.ts
@@ -5 +5 @@
+export const API_KEY = "sk_live_abcdef1234567890";
`;

  let diffDir: string;

  beforeAll(() => {
    diffDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-diff-'));
    writeFileSync(join(diffDir, 'd.ts'), [
      'export const a = eval(one);',
      'export const b = 2;',
      'export const c = 3;',
      'export const d = 4;',
      'export const API_KEY = "sk_live_abcdef1234567890";',
      '',
    ].join('\n'));
  });

  afterAll(() => {
    rmSync(diffDir, { recursive: true, force: true });
  });

  it('scans only lines changed in the piped diff', () => {
    const full = JSON.parse(run(['--json', '.'], { cwd: diffDir }).stdout);
    expect(full.findings.length).toBe(2);

    const res = run(['--diff-stdin', '--json', '.'], { cwd: diffDir, input: DIFF });
    const parsed = JSON.parse(res.stdout);
    expect(parsed.findings.length).toBe(1);
    expect(parsed.findings[0].rule).toBe('no-hardcoded-secrets');
    expect(parsed.findings[0].line).toBe(5);
    expect(res.status).toBe(1);
  });

  it('exits 0 with a note when the piped diff is empty', () => {
    const res = run(['--diff-stdin', '.'], { cwd: diffDir, input: '' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('No changed files to scan.');
  });

  it('handles CRLF diffs end-to-end (regression: silent false-clean)', () => {
    const res = run(['--diff-stdin', '--json', '.'], { cwd: diffDir, input: DIFF.replace(/\n/g, '\r\n') });
    const parsed = JSON.parse(res.stdout);
    expect(parsed.findings.length).toBe(1);
    expect(parsed.findings[0].rule).toBe('no-hardcoded-secrets');
    expect(res.status).toBe(1);
  });

  it('resolves repo-root diff paths when scanning a subdirectory', () => {
    const repo = mkdtempSync(join(tmpdir(), 'vibecheck-cli-subdir-'));
    try {
      execSync('git init -q', { cwd: repo });
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src', 'leak.ts'), 'export const API_KEY = "sk_live_abcdef1234567890";\n');
      const diff = `diff --git a/src/leak.ts b/src/leak.ts
--- a/src/leak.ts
+++ b/src/leak.ts
@@ -1 +1 @@
+export const API_KEY = "sk_live_abcdef1234567890";
`;
      const res = run(['--diff-stdin', '--json', 'src'], { cwd: repo, input: diff });
      const parsed = JSON.parse(res.stdout);
      expect(parsed.findings.length).toBe(1);
      expect(parsed.findings[0].rule).toBe('no-hardcoded-secrets');
      expect(res.status).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('rules subcommand', () => {
  it('lists every rule with severity, category, languages, and fixability', () => {
    const res = run(['rules']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^no-eval\s+error\s+security\s+js,ts/m);
    expect(res.stdout).toContain('39 rules');
  });

  it('--json emits one structured row per rule', () => {
    const res = run(['rules', '--json']);
    expect(res.status).toBe(0);
    const rows = JSON.parse(res.stdout);
    expect(rows.length).toBe(39);
    for (const row of rows) {
      expect(row.id).toBeTruthy();
      expect(['error', 'warn', 'info']).toContain(row.severity);
      expect(row.category).toBeTruthy();
      expect(Array.isArray(row.languages)).toBe(true);
      expect(typeof row.fixable).toBe('boolean');
    }
    expect(rows.find((r: { id: string }) => r.id === 'no-ai-attribution').fixable).toBe(true);
    expect(rows.find((r: { id: string }) => r.id === 'no-eval').fixable).toBe(false);
  });
});

describe('pretty output', () => {
  it('prints snippets, the fix hint, and the hidden-info note', () => {
    const mixedDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-mixed-'));
    writeFileSync(join(mixedDir, 'mixed.ts'), [
      '// Generated by ChatGPT',
      'export const out = eval(payload);',
      '// TODO: implement caching here',
      '',
    ].join('\n'));

    const res = run(['.'], { cwd: mixedDir });
    expect(res.stdout).toContain('export const out = eval(payload);');
    expect(res.stdout).toContain('1 finding fixable with --fix');
    expect(res.stdout).toContain('1 info finding hidden (run with --severity info)');
    rmSync(mixedDir, { recursive: true, force: true });
  });

  it('does not print the star footer when stderr is not a TTY', () => {
    const res = run(['.'], { cwd: cleanDir });
    expect(res.stdout).toContain('No issues found.');
    expect(res.stderr).toBe('');
  });
});

describe('inline suppressions via the CLI', () => {
  let supDir: string;

  beforeAll(() => {
    supDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-sup-'));
    writeFileSync(join(supDir, 's.ts'), '// vibecheck-disable-next-line no-eval\nexport const out = eval(payload);\n');
  });

  afterAll(() => {
    rmSync(supDir, { recursive: true, force: true });
  });

  it('suppressed findings do not fail the run and stay counted', () => {
    const res = run(['.'], { cwd: supDir });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('1 finding suppressed by inline directives (--show-suppressed to list)');
  });

  it('--show-suppressed lists them in pretty output', () => {
    const res = run(['--show-suppressed', '.'], { cwd: supDir });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Suppressed:');
    expect(res.stdout).toContain('s.ts:2:');
    expect(res.stdout).toContain('no-eval');
  });

  it('adds suppressedCount to JSON, and the full list only with --show-suppressed', () => {
    const parsed = JSON.parse(run(['--json', '.'], { cwd: supDir }).stdout);
    expect(parsed.suppressedCount).toBe(1);
    expect('suppressed' in parsed).toBe(false);
    const withList = JSON.parse(run(['--json', '--show-suppressed', '.'], { cwd: supDir }).stdout);
    expect(withList.suppressed).toHaveLength(1);
    expect(withList.suppressed[0].rule).toBe('no-eval');
  });

  it('keeps default JSON free of the new fields when the features are unused', () => {
    const parsed = JSON.parse(run(['--json', '.'], { cwd: warnDir }).stdout);
    expect('suppressed' in parsed).toBe(false);
    expect('suppressedCount' in parsed).toBe(false);
    expect('baselinedCount' in parsed).toBe(false);
  });
});

describe('--rule and --no-defaults (issue #8)', () => {
  let mixDir: string;

  beforeAll(() => {
    // eval (error, no-eval) + console.log (warn, no-console-pollution) in one file
    mixDir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-rule-'));
    writeFileSync(join(mixDir, 'mix.ts'), "console.log('boot');\nexport const out = eval(payload);\n");
  });

  afterAll(() => {
    rmSync(mixDir, { recursive: true, force: true });
  });

  it('--rule "x: off" disables exactly that rule for the run', () => {
    const parsed = JSON.parse(run(['--json', '--rule', 'no-eval: off', '.'], { cwd: mixDir }).stdout);
    const rules = parsed.findings.map((f: { rule: string }) => f.rule);
    expect(rules).not.toContain('no-eval');
    expect(rules).toContain('no-console-pollution');
  });

  it('--rule remaps severity for the run', () => {
    const parsed = JSON.parse(run(['--json', '--severity', 'info', '--rule', 'no-eval: info', '.'], { cwd: mixDir }).stdout);
    const evalFinding = parsed.findings.find((f: { rule: string }) => f.rule === 'no-eval');
    expect(evalFinding.severity).toBe('info');
  });

  it('--no-defaults alone runs no rules and exits 0', () => {
    const res = run(['--json', '--no-defaults', '.'], { cwd: mixDir });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).findings).toHaveLength(0);
  });

  it('--no-defaults --rule runs exactly the chosen rule', () => {
    const parsed = JSON.parse(run(['--json', '--no-defaults', '--rule', 'no-eval: error', '.'], { cwd: mixDir }).stdout);
    const rules = parsed.findings.map((f: { rule: string }) => f.rule);
    expect(rules).toEqual(['no-eval']);
  });

  it('--rule is repeatable', () => {
    const parsed = JSON.parse(run(['--json', '--no-defaults', '--rule', 'no-eval: error', '--rule', 'no-console-pollution: warn', '.'], { cwd: mixDir }).stdout);
    const rules = parsed.findings.map((f: { rule: string }) => f.rule).sort();
    expect(rules).toEqual(['no-console-pollution', 'no-eval']);
  });

  it('--no-defaults also silences rules enabled by the config file', () => {
    writeFileSync(join(mixDir, '.vibecheckrc'), JSON.stringify({ rules: { 'no-eval': 'error' } }));
    try {
      const parsed = JSON.parse(run(['--json', '--no-defaults', '.'], { cwd: mixDir }).stdout);
      expect(parsed.findings).toHaveLength(0);
    } finally {
      rmSync(join(mixDir, '.vibecheckrc'), { force: true });
    }
  });

  it('rejects an unknown rule id with a hint, exit 2', () => {
    const res = run(['--rule', 'no-evall: off', '.'], { cwd: mixDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Unknown rule');
    expect(res.stderr).toContain('no-eval');
  });

  it('rejects an invalid level, exit 2', () => {
    const res = run(['--rule', 'no-eval: loud', '.'], { cwd: mixDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Invalid level');
  });

  it('rejects a malformed spec, exit 2', () => {
    const res = run(['--rule', 'no-eval', '.'], { cwd: mixDir });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Expected 'rule-id:");
  });

  it('whitespace-free spec form works too', () => {
    const parsed = JSON.parse(run(['--json', '--no-defaults', '--rule', 'no-eval:error', '.'], { cwd: mixDir }).stdout);
    expect(parsed.findings.map((f: { rule: string }) => f.rule)).toEqual(['no-eval']);
  });
});

// Both of these shipped as SILENT false cleans: the CLI printed "No issues
// found" and exited 0 while an eval() sat in the file. That is the one failure
// mode a linter cannot have, so each keeps a test.
describe('diff mode false cleans', () => {
  let repo: string;

  function gitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-diff-'));
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
    git('init -q .');
    git('config user.email t@t');
    git('config user.name t');
    writeFileSync(join(dir, 'f.ts'), 'export const x = 1;\n');
    git('add f.ts');
    git('commit -qm init');
    // Line 1 is fixable (attribution comment), line 3 is not (eval). Fixing
    // line 1 shifts the eval from line 3 to line 2.
    writeFileSync(
      join(dir, 'f.ts'),
      '// Generated by ChatGPT\nexport const x = 1;\nexport const out = eval(payload);\n'
    );
    return dir;
  }

  beforeAll(() => {
    repo = gitRepo();
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('still reports a finding that --fix shifted to a different line', () => {
    const res = run(['--diff', '--fix', '--format', 'compact', '--fail-on', 'error', repo]);
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('resolves a symlinked scan path instead of reporting nothing', () => {
    // macOS tmpdir sits under a symlink, so the canonical git root and the
    // path handed to the CLI disagree. Every changed file then looked like it
    // was outside the scan root and was dropped without a word.
    const real = realpathSync(repo);
    const viaAlias = run(['--diff', '--format', 'compact', '--fail-on', 'error', repo]);
    const viaReal = run(['--diff', '--format', 'compact', '--fail-on', 'error', real]);
    expect(viaAlias.stdout).toContain('no-eval');
    expect(viaAlias.stdout).toBe(viaReal.stdout);
  });
});

describe('slop score integrity', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-score-'));
    writeFileSync(join(dir, 'p.ts'), 'export const out = eval(payload);\nconst y: any = 1;\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Baselining is a decision to defer slop, not to remove it. Scoring the
  // post-baseline view sent the score to 100 with no code changed, which made
  // --min-score bypassable by writing a baseline.
  it('counts baselined findings, so a baseline cannot zero the score', () => {
    // cwd must be the fixture: the baseline path resolves against cwd, not the
    // scan target, so running from ROOT drops a .vibecheck-baseline.json in the
    // repo and quietly suppresses findings in every other test.
    const at = { cwd: dir };
    const before = run(['--score', '--fail-on', 'never', '.'], at).stderr;
    expect(before).toMatch(/slop score\s+74\/100/);

    run(['--update-baseline', '.'], at);
    expect(existsSync(join(dir, '.vibecheck-baseline.json'))).toBe(true);

    const after = run(['--score', '--fail-on', 'never', '.'], at).stderr;
    expect(after).toMatch(/slop score\s+74\/100/);

    const gated = run(['--min-score', '100', '--fail-on', 'never', '--format', 'quiet', '.'], at);
    expect(gated.status).toBe(1);
  });

  it('prints the score alongside sarif without polluting the document', () => {
    const res = run(['--score', '--format', 'sarif', '--fail-on', 'never', dir]);
    expect(res.stderr).toContain('slop score');
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    expect(JSON.parse(res.stdout).version).toBe('2.1.0');
  });
});

// The scanner used to treat "could not read it" and "read it and it is fine"
// as the same outcome, so every case here exited 0 on a file containing eval().
describe('files the scanner cannot read are never reported clean', () => {
  let dir: string;
  const EVAL = 'export const a = eval(x);\n';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-skip-'));
    writeFileSync(join(dir, 'real.ts'), EVAL);
    symlinkSync('real.ts', join(dir, 'link.ts'));
    writeFileSync(join(dir, 'locked.ts'), EVAL);
    writeFileSync(join(dir, 'over.ts'), EVAL + '// pad\n'.repeat(143_000));
    writeFileSync(join(dir, '!bang.ts'), EVAL);
    writeFileSync(join(dir, 'back\\slash.ts'), EVAL);
  });

  afterAll(() => {
    chmodSync(join(dir, 'locked.ts'), 0o644);
    rmSync(dir, { recursive: true, force: true });
  });

  it('follows an explicitly named symlinked file', () => {
    const res = run(['--format', 'compact', '--fail-on', 'error', join(dir, 'link.ts')]);
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('does not glob-interpret a filename with a leading bang', () => {
    const res = run(['--format', 'compact', '--fail-on', 'error', join(dir, '!bang.ts')]);
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('does not glob-interpret a backslash in a filename', () => {
    const res = run(['--format', 'compact', '--fail-on', 'error', join(dir, 'back\\slash.ts')]);
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('exits 2 and says why when an explicitly named file is unreadable', () => {
    chmodSync(join(dir, 'locked.ts'), 0o000);
    const res = run(['--format', 'compact', '--fail-on', 'error', join(dir, 'locked.ts')]);
    chmodSync(join(dir, 'locked.ts'), 0o644);
    expect(res.stderr).toContain('skipped locked.ts');
    expect(res.stderr).toContain('unreadable');
    expect(res.status).toBe(2);
  });

  it('exits 2 and says why when an explicitly named file is over the size cap', () => {
    const res = run(['--format', 'compact', '--fail-on', 'error', join(dir, 'over.ts')]);
    expect(res.stderr).toContain('skipped over.ts');
    expect(res.stderr).toContain('too large');
    expect(res.status).toBe(2);
  });

  // A directory scan used to print "No issues found" and exit 0 after skipping
  // a file, which is the same false clean as never looking. Deliberate skips
  // belong in `ignore`, which stays silent.
  it('fails a directory scan that skipped a file rather than claiming clean', () => {
    const res = run(['--format', 'compact', '--fail-on', 'never', dir]);
    expect(res.stderr).toContain('skipped over.ts');
    expect(res.stderr).toContain('cannot vouch');
    expect(res.status).toBe(2);
  });

  it('stays silent for a file excluded through ignore', () => {
    const cfg = join(dir, '.vibecheckrc');
    // back\\slash.ts is included because file DISCOVERY mangles it: fast-glob
    // reports it as back/slash.ts, which does not exist, so a directory scan
    // legitimately cannot read it. Naming it directly still works.
    writeFileSync(cfg, JSON.stringify({ ignore: ['over.ts', 'locked.ts', 'back*'] }));
    const res = run(['--format', 'compact', '--fail-on', 'never', '.'], { cwd: dir });
    rmSync(cfg);
    expect(res.stderr).not.toContain('skipped');
    expect(res.status).toBe(0);
  });
});

// --staged used to build its line map from the index and then scan the WORKING
// TREE, so a commit containing eval() passed as long as the working copy was
// clean. That is the pre-commit hook case, which is the whole point of --staged.
describe('--staged scans the index, not the working tree', () => {
  function repo(): { dir: string; git: (cmd: string) => void } {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-staged-'));
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
    git('init -q .');
    git('config user.email t@t');
    git('config user.name t');
    return { dir, git };
  }
  const EVAL = 'export const a = eval(x);\n';
  const dirs: string[] = [];
  const fresh = () => {
    const r = repo();
    dirs.push(r.dir);
    return r;
  };

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('reports a finding staged in the index when the working tree is clean', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 's.ts'), 'export const ok = 1;\n');
    git('add s.ts');
    git('commit -qm init');
    writeFileSync(join(dir, 's.ts'), EVAL);
    git('add s.ts');
    writeFileSync(join(dir, 's.ts'), 'export const clean = 1;\n'); // working tree no longer has it

    const res = run(['--staged', '--format', 'compact', '--fail-on', 'error', dir]);
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('ignores a working-tree finding that was never staged', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 's.ts'), 'export const ok = 1;\n');
    git('add s.ts');
    git('commit -qm init');
    writeFileSync(join(dir, 's.ts'), 'export const clean = 2;\n');
    git('add s.ts');
    writeFileSync(join(dir, 's.ts'), EVAL); // unstaged only

    const res = run(['--staged', '--format', 'compact', '--fail-on', 'error', dir]);
    expect(res.stdout).not.toContain('no-eval');
    expect(res.status).toBe(0);
  });

  it('scans a staged file that no longer exists in the working tree', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 'base.ts'), 'export const x = 1;\n');
    git('add base.ts');
    git('commit -qm init');
    writeFileSync(join(dir, 'only.ts'), EVAL);
    git('add only.ts');
    rmSync(join(dir, 'only.ts'));

    const res = run(['--staged', '--format', 'compact', '--fail-on', 'error', dir]);
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('handles an unborn HEAD without leaking a git fatal', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 'f.ts'), EVAL);
    git('add f.ts');

    const res = run(['--staged', '--format', 'compact', '--fail-on', 'error', dir]);
    expect(res.stdout).toContain('no-eval');
    expect(res.stderr).not.toContain('fatal');
    expect(res.status).toBe(1);
  });

  it('reports the new path for a staged rename with edits', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 'old.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    git('add old.ts');
    git('commit -qm init');
    git('mv old.ts new.ts');
    writeFileSync(join(dir, 'new.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = eval(q);\n');
    git('add new.ts');

    const res = run(['--staged', '--format', 'compact', '--fail-on', 'error', dir]);
    expect(res.stdout).toContain('new.ts');
    expect(res.stdout).not.toContain('old.ts');
    expect(res.status).toBe(1);
  });

  it('exits 2 rather than passing when an in-scope staged blob cannot be linted', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 'base.ts'), 'export const x = 1;\n');
    git('add base.ts');
    git('commit -qm init');
    writeFileSync(join(dir, 'bin.ts'), Buffer.from('export const a = 1;\0\u0001binary', 'binary'));
    git('add bin.ts');

    const res = run(['--staged', '--fail-on', 'error', dir]);
    expect(res.stderr).toContain('bin.ts');
    expect(res.status).toBe(2);
  });

  it('leaves an out-of-scope staged binary alone', () => {
    const { dir, git } = fresh();
    writeFileSync(join(dir, 'base.ts'), 'export const x = 1;\n');
    git('add base.ts');
    git('commit -qm init');
    writeFileSync(join(dir, 'img.png'), Buffer.from('\u0089PNG\0\u0001', 'binary'));
    git('add img.png');

    expect(run(['--staged', '--fail-on', 'error', dir]).status).toBe(0);
  });

  it('refuses --staged --fix', () => {
    const { dir } = fresh();
    const res = run(['--staged', '--fix', dir]);
    expect(res.stderr).toContain('cannot be used with');
    expect(res.status).toBe(2);
  });
});

// --diff-stdin took line numbers from the piped diff and bytes from the
// checkout, without ever checking the two described the same content. For the
// documented `gh pr diff 42 | vibecheck --diff-stdin .` case they usually do
// not, and findings then get looked for at meaningless line numbers.
describe('--diff-stdin verifies the checkout matches the diff', () => {
  let dir: string;
  let diff: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-stdin-'));
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
    git('init -q .');
    git('config user.email t@t');
    git('config user.name t');
    writeFileSync(join(dir, 'f.ts'), 'export const a = 1;\n');
    git('add f.ts');
    git('commit -qm init');
    writeFileSync(join(dir, 'f.ts'), 'export const a = 1;\nexport const b = eval(x);\n');
    diff = execSync('git diff', { cwd: dir, encoding: 'utf-8' });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans normally when the checkout matches', () => {
    const res = run(['--diff-stdin', '--format', 'compact', '--fail-on', 'error', dir], { input: diff });
    expect(res.stdout).toContain('no-eval');
    expect(res.status).toBe(1);
  });

  it('exits 2 rather than reporting against a checkout the diff does not describe', () => {
    writeFileSync(join(dir, 'f.ts'), 'export const totally = "different";\nexport const c = 2;\n');
    const res = run(['--diff-stdin', '--format', 'compact', '--fail-on', 'error', dir], { input: diff });
    expect(res.stderr).toContain('does not match the diff');
    expect(res.stderr).toContain('f.ts');
    expect(res.status).toBe(2);
  });

  it('warns instead of pretending to verify when the diff has no index lines', () => {
    const bare = '--- a/f.ts\n+++ b/f.ts\n@@ -1,0 +2 @@\n+export const b = eval(x);\n';
    const res = run(['--diff-stdin', '--fail-on', 'never', dir], { input: bare });
    expect(res.stderr).toContain('cannot confirm');
    expect(res.status).toBe(0);
  });
});

// Diff mode kept only findings whose ANCHOR line changed. Multiline rules
// report where a construct starts, so an edit could create a finding and have
// it dropped. Scanning the pre-change file too lets us ask the question that
// matters — did this change introduce it — instead of guessing from line
// numbers.
describe('diff mode reports findings the change introduced', () => {
  const dirs: string[] = [];
  function repo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-intro-'));
    dirs.push(dir);
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
    git('init -q .');
    git('config user.email t@t');
    git('config user.name t');
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    git('add .');
    git('commit -qm init');
    return dir;
  }
  const bigFn = (n: number) =>
    `export function grow() {\n${Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`).join('\n')}\n  return 1;\n}\n`;

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('reports a multiline finding created by an edit below its anchor', () => {
    const dir = repo({
      'f.ts': 'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    return fallback();\n  }\n}\n',
    });
    // Only line 5 changes; the finding is anchored on line 4.
    writeFileSync(
      join(dir, 'f.ts'),
      'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n'
    );
    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).toContain('no-console-error-only');
    expect(res.stdout).toContain('f.ts:4');
  });

  it('reports a function that crossed the length threshold, anchored on an untouched line', () => {
    const dir = repo({ 'h.ts': bigFn(77) });
    const lines = bigFn(77).split('\n');
    lines.splice(78, 0, '  const a = 1;', '  const b = 2;', '  const c = 3;');
    writeFileSync(join(dir, 'h.ts'), lines.join('\n'));

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    // The declaration on line 1 never changed; the finding is new all the same.
    expect(res.stdout).toContain('no-god-function');
    expect(res.stdout).toContain('h.ts:1');
  });

  // The reason this is not simply "match the whole span": a long function would
  // otherwise warn on every PR that touched one line of it, forever, for code
  // the author did not write.
  it('stays quiet when an edit lands inside an already-too-long function', () => {
    const dir = repo({ 'g.ts': bigFn(120) });
    writeFileSync(join(dir, 'g.ts'), bigFn(120).replace('const v5 = 5;', 'const v5 = 500;'));

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).not.toContain('no-god-function');
    expect(res.status).toBe(0);
  });

  // The base copy of a renamed file lives under its OLD name. Looking it up
  // under the new one found nothing, so every pre-existing finding in a renamed
  // file read as newly introduced — false blame, which is worse than the bug
  // this feature fixes.
  it('does not blame a renamed file for findings it already had', () => {
    const dir = repo({
      'old.ts': 'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n',
    });
    execSync('git mv old.ts new.ts', { cwd: dir, stdio: 'ignore' });
    writeFileSync(
      join(dir, 'new.ts'),
      'export function load() {\n  try {\n    return readTwice();\n  } catch (err) {\n    console.error(err);\n  }\n}\n'
    );
    execSync('git add new.ts', { cwd: dir, stdio: 'ignore' });

    const res = run(['--staged', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).not.toContain('no-console-error-only');
  });

  it('still reports a finding a rename introduced', () => {
    const dir = repo({
      'old.ts': 'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    return fallback();\n  }\n}\n',
    });
    execSync('git mv old.ts new.ts', { cwd: dir, stdio: 'ignore' });
    writeFileSync(
      join(dir, 'new.ts'),
      'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n'
    );
    execSync('git add new.ts', { cwd: dir, stdio: 'ignore' });

    const res = run(['--staged', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).toContain('no-console-error-only');
  });

  // Identical findings carry nothing that tells the copies apart. Encounter
  // order picked wrong, and so did proximity to the change once a multiline
  // finding's edited body sat far below its anchor — both reported the OLD
  // occurrence, which is false blame on code the author never touched.
  //
  // So an ambiguous group falls back to anchor matching. That can still miss
  // the new one, exactly as the previous release did, but it never points at
  // the wrong line. Missing a finding is recoverable; blaming the wrong author
  // is what gets a linter deleted.
  it('never blames an older identical occurrence when the copies are ambiguous', () => {
    const two = (firstBody: string) =>
      `export function first() {\n  try {\n    return read();\n  } catch (err) {\n    ${firstBody}\n  }\n}\n` +
      `export function second() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n`;
    const dir = repo({ 'f.ts': two('return fallback();') });
    writeFileSync(join(dir, 'f.ts'), two('console.error(err);'));

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).not.toContain('f.ts:12');
  });

  it('still reports a duplicate when the base had none of them', () => {
    // Unambiguous: nothing equivalent existed before, so both are new.
    const dir = repo({ 'f.ts': 'export const ok = 1;\n' });
    const block = (name: string) =>
      `export function ${name}() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n`;
    writeFileSync(join(dir, 'f.ts'), block('first') + block('second'));

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout.match(/no-console-error-only/g)?.length).toBe(2);
  });

  it('keeps the base through the --fix rescan', () => {
    const dir = repo({
      'f.ts': 'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    return fallback();\n  }\n}\n',
    });
    // A fixable attribution line plus a finding introduced below an unchanged
    // anchor. The rescan used to lose the base and drop the second one.
    writeFileSync(
      join(dir, 'f.ts'),
      '// Generated by ChatGPT\nexport function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n'
    );

    const res = run(['--diff', '--fix', '--format', 'compact', '--severity', 'warn', '--fail-on', 'warn', dir]);
    expect(res.stdout).toContain('no-console-error-only');
    expect(res.status).toBe(1);
  });

  it('does not resurface an old suppressed finding after an unrelated edit', () => {
    const dir = repo({
      'f.ts': '// vibecheck-disable-next-line no-eval\nconst bad = eval(payload);\nconst safe = 1;\n',
    });
    writeFileSync(
      join(dir, 'f.ts'),
      '// vibecheck-disable-next-line no-eval\nconst bad = eval(payload);\nconst safe = 2;\n'
    );

    const res = run(['--diff', '--show-suppressed', '--severity', 'warn', dir]);
    expect(res.stdout).not.toContain('no-eval');
  });

  // Deletions produce no added lines, so the file never entered the diff map
  // and a deletion that CREATED a finding was invisible in every diff mode.
  it('reports a finding created by a deletion-only change', () => {
    const dir = repo({
      'f.ts': 'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n    return fallback();\n  }\n}\n',
    });
    writeFileSync(
      join(dir, 'f.ts'),
      'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n'
    );

    const unstaged = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    expect(unstaged.stdout).toContain('no-console-error-only');

    execSync('git add f.ts', { cwd: dir, stdio: 'ignore' });
    const staged = run(['--staged', '--format', 'compact', '--severity', 'warn', dir]);
    expect(staged.stdout).toContain('no-console-error-only');
  });

  it('does not blame a pre-existing finding when an unrelated line is deleted', () => {
    const dir = repo({
      'g.ts': 'export function a() {\n  try {\n    return r();\n  } catch (e) {\n    console.error(e);\n  }\n}\nconst unused = 1;\n',
    });
    writeFileSync(
      join(dir, 'g.ts'),
      'export function a() {\n  try {\n    return r();\n  } catch (e) {\n    console.error(e);\n  }\n}\n'
    );

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).not.toContain('no-console-error-only');
  });

  // With hunks, selection can ask WHERE each base finding went instead of only
  // how many existed. Identical duplicates stop being ambiguous: the old copy
  // maps to its shifted position, so the fresh copy is the one reported.
  it('reports the introduced identical duplicate, not the old copy', () => {
    // The two lines must be BYTE-IDENTICAL or the fingerprints differ (it is
    // rule + path + trimmed snippet) and this is not a duplicate at all.
    const DUP = 'const v = eval(x);';
    const pad = Array.from({ length: 30 }, (_, i) => `const p${i} = ${i};`).join('\n');
    const dir = repo({ 'f.ts': pad + `\n${DUP}\n` });
    writeFileSync(join(dir, 'f.ts'), `${DUP}\n` + pad + `\n${DUP}\n`);

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    // The old copy maps to its shifted position (31 -> 32) and stays quiet;
    // only the fresh copy at line 1 is reported. The count-budget algorithm
    // reported BOTH, blaming code the author never touched.
    expect(res.stdout).toContain('f.ts:1:');
    expect(res.stdout).not.toContain('f.ts:32:');

    execSync('git add f.ts', { cwd: dir, stdio: 'ignore' });
    const staged = run(['--staged', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    expect(staged.stdout).toContain('f.ts:1:');
    expect(staged.stdout).not.toContain('f.ts:32:');
  });

  it('reports the introduced duplicate when it lands BELOW the old copy', () => {
    const DUP = 'const v = eval(x);';
    const pad = Array.from({ length: 10 }, (_, i) => `const q${i} = ${i};`).join('\n');
    const dir = repo({ 'f.ts': `${DUP}\n` + pad + '\n' });
    writeFileSync(join(dir, 'f.ts'), `${DUP}\n` + pad + `\n${DUP}\n`);

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    // The untouched copy at line 1 maps to itself exactly; the new one is last.
    expect(res.stdout).toContain('f.ts:12:');
    expect(res.stdout).not.toContain('f.ts:1:');
  });

  // An indentation-only edit keeps the trimmed snippet, so the finding provably
  // pre-existed. Reporting it blamed authors for running a formatter.
  it('stays quiet when a finding anchor is only reindented', () => {
    const dir = repo({
      'g.ts': 'export function a() {\n  try {\n    return r();\n  } catch (e) {\n    console.error(e);\n  }\n}\n',
    });
    writeFileSync(
      join(dir, 'g.ts'),
      'const added = 0;\nexport function a() {\n  try {\n    return r();\n    } catch (e) {\n    console.error(e);\n  }\n}\n'
    );

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    expect(res.stdout).not.toContain('no-console-error-only');

    execSync('git add g.ts', { cwd: dir, stdio: 'ignore' });
    const staged = run(['--staged', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    expect(staged.stdout).not.toContain('no-console-error-only');
  });

  it('a whole reindented block of distinct findings stays quiet', () => {
    const mk = (indent: string) =>
      `export function a() {\n${indent}try {\n${indent}  return r();\n${indent}} catch (e) {\n${indent}  console.error(e);\n${indent}}\n}\nconst tail = eval(z);\n`;
    const dir = repo({ 'h.ts': mk('  ') });
    writeFileSync(join(dir, 'h.ts'), mk('    '));

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    expect(res.stdout.trim()).toBe('');
  });

  // A baseline holding the OLD copy's fingerprint used to absorb the newly
  // introduced duplicate: selection dropped the old copy, the baseline spent
  // its slot on the new one, and the run came back green.
  it('the baseline cannot absorb an introduced duplicate with the old copy\u2019s slot', () => {
    const DUP = 'const v = eval(x);';
    const pad = Array.from({ length: 20 }, (_, i) => `const r${i} = ${i};`).join('\n');
    const dir = repo({ 'f.ts': pad + `\n${DUP}\n` });
    // cwd must be the fixture throughout: the baseline path resolves against
    // cwd, not the scan target, so scanning from elsewhere silently loads no
    // baseline and the test passes with or without the code under test.
    const at = { cwd: dir };
    run(['--update-baseline', '.'], at);
    writeFileSync(join(dir, 'f.ts'), `${DUP}\n` + pad + `\n${DUP}\n`);

    const res = run(['--diff', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', '.'], at);
    expect(res.stdout).toContain('no-eval');
    expect(res.stdout).toContain('f.ts:1');
    // baselinedCount is 0, and that is the mechanism working: selection already
    // dropped the old copy, so it never reaches the baseline. The credit spends
    // the slot instead, leaving nothing for the introduced copy to be absorbed
    // by. Without credits the slot would still be open and this run would be
    // green with an empty findings list.
    const json = run(['--diff', '--format', 'json', '--severity', 'warn', '--fail-on', 'never', '.'], at);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.baselinedCount ?? 0).toBe(0);
    expect(parsed.findings.map((f: { rule: string }) => f.rule)).toContain('no-eval');
  });

  // The --fix rescan regenerates the diff against the same frozen tree. With
  // shifted line sets and stale hunks, the fix landing ABOVE a reindented
  // finding would resurrect the reformat false blame.
  it('a fix above a reindented finding does not resurrect it', () => {
    const dir = repo({
      'k.ts': '// keep\nexport function a() {\n  try {\n    return r();\n  } catch (e) {\n    console.error(e);\n  }\n}\n',
    });
    writeFileSync(
      join(dir, 'k.ts'),
      '// Generated by ChatGPT\n// keep\nexport function a() {\n  try {\n    return r();\n    } catch (e) {\n    console.error(e);\n  }\n}\n'
    );

    const res = run(['--diff', '--fix', '--format', 'compact', '--severity', 'warn', '--fail-on', 'never', dir]);
    expect(res.stdout).not.toContain('no-console-error-only');
  });

  it('applies the same rule to --staged', () => {
    const dir = repo({
      'f.ts': 'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    return fallback();\n  }\n}\n',
    });
    writeFileSync(
      join(dir, 'f.ts'),
      'export function load() {\n  try {\n    return read();\n  } catch (err) {\n    console.error(err);\n  }\n}\n'
    );
    execSync('git add f.ts', { cwd: dir, stdio: 'ignore' });

    const res = run(['--staged', '--format', 'compact', '--severity', 'warn', dir]);
    expect(res.stdout).toContain('no-console-error-only');
  });
});

// stdout to a PIPE is asynchronous in node, so process.exit() throws away
// whatever has not drained. The skip path exited that way AFTER printing the
// report, so `vibecheck --format json . | jq` on a large repo returned
// truncated invalid JSON, silently. Every test here runs through spawnSync,
// which is a pipe, so the output has to be big enough to outrun the buffer.
describe('output is never truncated by an exit', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-cli-flush-'));
    // Enough findings that the JSON report comfortably exceeds the 64KB pipe
    // buffer, plus one unreadable file so the run takes the exit-2 skip path.
    for (let i = 0; i < 60; i++) {
      writeFileSync(
        join(dir, `f${i}.ts`),
        Array.from({ length: 30 }, (_, j) => `export const v${j} = eval(input${j});`).join('\n') + '\n'
      );
    }
    writeFileSync(join(dir, 'huge.ts'), 'const a = 1;\n'.repeat(90_000)); // over the 1MB cap
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('emits complete JSON even when the run exits 2 for a skipped file', () => {
    const res = run(['--format', 'json', '--fail-on', 'never', dir]);

    expect(res.stderr).toContain('skipped huge.ts');
    expect(res.status).toBe(2);
    expect(res.stdout.length).toBeGreaterThan(100_000); // past the pipe buffer
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    expect(JSON.parse(res.stdout).findings.length).toBe(60 * 30);
  });
});
