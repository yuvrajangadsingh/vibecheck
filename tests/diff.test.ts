import { describe, it, expect } from 'vitest';
import { parseDiff, resolveDiffPaths } from '../src/diff.js';

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
