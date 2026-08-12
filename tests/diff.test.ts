import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseDiff, resolveDiffPaths, shiftDiffMap, getIndexContents } from '../src/diff.js';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('parseDiff', () => {
  it('parses a simple unified diff', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@
 const a = 1;
 const b = 2;
+const secret = "sk_live_abc123";
 const c = 3;`;

    const result = parseDiff(diff);
    expect(result.size).toBe(1);
    expect(result.has('src/app.ts')).toBe(true);
    expect(result.get('src/app.ts')!.has(12)).toBe(true);
    expect(result.get('src/app.ts')!.size).toBe(1);
  });

  it('parses multiple files', () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,2 +5,3 @@
 existing
+new line here
 more`;

    const result = parseDiff(diff);
    expect(result.size).toBe(2);
    expect(result.get('src/a.ts')!.has(2)).toBe(true);
    expect(result.get('src/b.ts')!.has(6)).toBe(true);
  });

  it('handles multiple hunks in one file', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -3,2 +3,3 @@
 context
+added at line 4
 context
@@ -20,2 +21,3 @@
 context
+added at line 22
 context`;

    const result = parseDiff(diff);
    expect(result.get('src/app.ts')!.has(4)).toBe(true);
    expect(result.get('src/app.ts')!.has(22)).toBe(true);
    expect(result.get('src/app.ts')!.size).toBe(2);
  });

  it('skips deleted lines', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -5,4 +5,3 @@
 context
-removed line
+replacement line
 context`;

    const result = parseDiff(diff);
    expect(result.get('src/app.ts')!.has(6)).toBe(true);
    expect(result.get('src/app.ts')!.size).toBe(1);
  });

  it('returns empty map for empty diff', () => {
    const result = parseDiff('');
    expect(result.size).toBe(0);
  });

  it('handles zero-context diff (-U0)', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,0 +11,2 @@
+const eval_result = eval("code");
+const secret = "sk_live_test123";`;

    const result = parseDiff(diff);
    expect(result.get('src/app.ts')!.has(11)).toBe(true);
    expect(result.get('src/app.ts')!.has(12)).toBe(true);
  });

  it('handles "no newline at end of file" marker', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
-a
\\ No newline at end of file
+a
+b
\\ No newline at end of file`;

    const result = parseDiff(diff);
    expect(result.get('src/app.ts')!.has(1)).toBe(true);
    expect(result.get('src/app.ts')!.has(2)).toBe(true);
    expect(result.get('src/app.ts')!.size).toBe(2);
  });

  it('handles filenames with spaces (tab-terminated)', () => {
    const diff = `diff --git a/src/my file.ts b/src/my file.ts
--- a/src/my file.ts
+++ b/src/my file.ts
@@ -1,0 +2 @@
+const x = 1;`;

    const result = parseDiff(diff);
    expect(result.has('src/my file.ts')).toBe(true);
    expect(result.get('src/my file.ts')!.has(2)).toBe(true);
  });

  it('handles quoted filenames', () => {
    const diff = `diff --git "a/src/tab\\tname.ts" "b/src/tab\\tname.ts"
--- "a/src/tab\\tname.ts"
+++ "b/src/tab\\tname.ts"
@@ -1,0 +2 @@
+const y = 2;`;

    const result = parseDiff(diff);
    expect(result.has('src/tab\tname.ts')).toBe(true);
  });

  it('handles CRLF diffs (trailing \\r stripped from paths and hunks)', () => {
    const lf = `diff --git a/leak.ts b/leak.ts
--- a/leak.ts
+++ b/leak.ts
@@ -1 +1 @@
+const key = "x";
`;
    const result = parseDiff(lf.replace(/\n/g, '\r\n'));
    expect(result.has('leak.ts')).toBe(true);
    expect(result.get('leak.ts')!.has(1)).toBe(true);
  });

  it('handles quoted filenames with escaped double quotes', () => {
    const diff = `diff --git "a/quo\\"te.ts" "b/quo\\"te.ts"
--- "a/quo\\"te.ts"
+++ "b/quo\\"te.ts"
@@ -1 +1 @@
+const z = 3;`;

    const result = parseDiff(diff);
    expect(result.has('quo"te.ts')).toBe(true);
  });

  it('handles git octal-escaped non-ASCII filenames', () => {
    const diff = `diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"
--- "a/caf\\303\\251.ts"
+++ "b/caf\\303\\251.ts"
@@ -1 +1 @@
+const q = 4;`;

    const result = parseDiff(diff);
    expect(result.has('café.ts')).toBe(true);
  });

  it('resets currentFile on new diff block', () => {
    // If second file header is unparseable, lines should not leak to first file
    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,0 +2 @@
+line in a
diff --git a/bad b/bad
--- a/bad
+++ /dev/null
@@ -1 +0,0 @@
-deleted`;

    const result = parseDiff(diff);
    expect(result.get('src/a.ts')!.has(2)).toBe(true);
    expect(result.get('src/a.ts')!.size).toBe(1);
  });

  it('handles binary diff (no hunks)', () => {
    const diff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;

    const result = parseDiff(diff);
    expect(result.size).toBe(0);
  });
});

describe('resolveDiffPaths', () => {
  it('resolves paths relative to scan root', () => {
    const diffMap = new Map([
      ['src/app.ts', new Set([5, 10])],
      ['README.md', new Set([1])],
    ]);

    const resolved = resolveDiffPaths(diffMap, '/repo', '/repo');
    expect(resolved.get('src/app.ts')!.has(5)).toBe(true);
    expect(resolved.has('README.md')).toBe(true);
  });

  it('skips files outside scan root', () => {
    const diffMap = new Map([
      ['src/app.ts', new Set([5])],
      ['other/file.ts', new Set([1])],
    ]);

    const resolved = resolveDiffPaths(diffMap, '/repo', '/repo/src');
    expect(resolved.has('app.ts')).toBe(true);
    expect(resolved.size).toBe(1);
  });
});

describe('parseDiff deletion-only hunks', () => {
  const DIFF = `diff --git a/f.ts b/f.ts
index 1111111..2222222 100644
--- a/f.ts
+++ b/f.ts
@@ -6 +5,0 @@ export function load() {
-    return fallback();
`;

  it('records the file with an empty line set', () => {
    // The file must enter the map or it is never scanned, and a deletion that
    // CREATES a finding reports nothing. No destination lines exist to record.
    const m = parseDiff(DIFF);
    expect(m.has('f.ts')).toBe(true);
    expect(m.get('f.ts')!.size).toBe(0);
  });

  // Headers only appear between hunks. A deleted source line `-- retries;`
  // renders as `--- retries;` and matched the header check, eating the
  // deletion — the file vanished from the map and the run reported clean.
  it('does not mistake a deleted line starting with -- for a header', () => {
    const d = [
      'diff --git a/f.ts b/f.ts',
      'index 1111111..2222222 100644',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -7 +6,0 @@ export function load() {',
      '--- retries;',
      '',
    ].join('\n');
    const m = parseDiff(d);
    expect(m.has('f.ts')).toBe(true);
  });

  it('does not mistake an added line starting with ++ for a file header', () => {
    // `+++ x;` inside a hunk used to clobber currentFile with garbage, so the
    // following added lines were attributed to a file that does not exist.
    const d = [
      'diff --git a/g.ts b/g.ts',
      'index 1111111..2222222 100644',
      '--- a/g.ts',
      '+++ b/g.ts',
      '@@ -0,0 +1,2 @@',
      '+++ x;',
      '+const after = 1;',
      '',
    ].join('\n');
    const m = parseDiff(d);
    expect([...(m.get('g.ts') ?? [])].sort()).toEqual([1, 2]);
    expect(m.size).toBe(1);
  });

  it('still produces no entry for a hunkless file', () => {
    // A pure rename emits headers but no hunks; it must stay skipped.
    const m = parseDiff('diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n');
    expect(m.size).toBe(0);
  });
});

describe('shiftDiffMap', () => {
  const map = (o: Record<string, number[]>) =>
    new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
  const lines = (m: Map<string, Set<number>>, file: string) =>
    [...(m.get(file) ?? [])].sort((a, b) => a - b);
  const cut = (file: string, ...ls: number[]) => ls.map(line => ({ file, line }));

  it('moves lines below a removal up by one', () => {
    expect(lines(shiftDiffMap(map({ a: [1, 3] }), cut('a', 1)), 'a')).toEqual([2]);
  });

  it('accounts for every removal above a line, not just one', () => {
    expect(lines(shiftDiffMap(map({ a: [1, 2, 5] }), cut('a', 1, 2)), 'a')).toEqual([3]);
  });

  it('handles non-contiguous removals', () => {
    expect(lines(shiftDiffMap(map({ a: [1, 3, 5, 7] }), cut('a', 1, 5)), 'a')).toEqual([2, 5]);
  });

  it('leaves lines above a removal alone', () => {
    expect(lines(shiftDiffMap(map({ a: [2] }), cut('a', 5)), 'a')).toEqual([2]);
  });

  it('drops a mapped line that was itself removed', () => {
    expect(lines(shiftDiffMap(map({ a: [1] }), cut('a', 1)), 'a')).toEqual([]);
  });

  it('only shifts the file that was fixed', () => {
    const out = shiftDiffMap(map({ a: [1, 3], b: [2] }), cut('a', 1));
    expect(lines(out, 'a')).toEqual([2]);
    expect(lines(out, 'b')).toEqual([2]);
  });

  it('ignores removals in a file the map does not track', () => {
    expect(lines(shiftDiffMap(map({ a: [1] }), cut('zz', 1)), 'a')).toEqual([1]);
  });

  it('returns the map untouched when nothing was removed', () => {
    expect(lines(shiftDiffMap(map({ a: [1, 2] }), []), 'a')).toEqual([1, 2]);
  });
});

// Base content is read with one `git cat-file --batch` process, because a
// `git show` per file cost 13x on a 250-file diff. The response framing is
// parsed by hand, so the cursor arithmetic gets its own tests.
describe('getIndexContents batch parsing', () => {
  const FILES: Record<string, string> = {
    'plain.ts': 'export const a = 1;\n',
    'crlf.ts': 'export const a = 1;\r\nexport const b = 2;\r\n',
    'nonl.ts': 'export const a = 1;', // no trailing newline
    'fakehdr.ts': 'const s = "abc123 blob 999";\nexport const x = 1;\n', // mimics a batch header
    'unicode.ts': 'export const s = "café 日本語 🔥";\n',
    'big.ts': 'export const a = 1;\n'.repeat(20_000),
    'empty.ts': '',
  };
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-batch-'));
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
    git('init -q .');
    git('config user.email t@t');
    git('config user.name t');
    for (const [name, body] of Object.entries(FILES)) writeFileSync(join(dir, name), body);
    git('add .');
    git('commit -qm init');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads every blob back byte for byte, with a missing path mid-stream', () => {
    const paths = ['plain.ts', 'crlf.ts', 'MISSING.ts', 'nonl.ts', 'fakehdr.ts', 'unicode.ts', 'big.ts'];
    const got = getIndexContents(dir, dir, paths);

    for (const name of paths) {
      // A path absent from the index is a new file: empty base, all of it new.
      expect(got.get(name), name).toBe(name === 'MISSING.ts' ? '' : FILES[name]);
    }
  });

  it('treats a genuinely empty blob as no base rather than empty content', () => {
    // `git add -N` writes an empty blob, which is how an unstaged rename shows
    // up. Reading it as the real "before" blamed the author for moved code.
    expect(getIndexContents(dir, dir, ['empty.ts']).get('empty.ts')).toBeUndefined();
  });

  it('returns an empty map rather than throwing outside a git repo', () => {
    const bare = mkdtempSync(join(tmpdir(), 'vibecheck-nogit-'));
    expect(() => getIndexContents(bare, bare, ['x.ts'])).not.toThrow();
    rmSync(bare, { recursive: true, force: true });
  });
});
