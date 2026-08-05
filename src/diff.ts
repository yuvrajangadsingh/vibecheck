import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';

export type DiffMap = Map<string, Set<number>>;

/**
 * Unescape a git C-style quoted path body: \t \n \r \" \\ and octal byte
 * escapes like \303\251, which git uses for non-ASCII filenames (the bytes
 * are collected and decoded as UTF-8 at the end).
 */
function unquoteGitPath(quoted: string): string {
  const bytes: number[] = [];
  const push = (s: string) => {
    for (const b of Buffer.from(s, 'utf-8')) bytes.push(b);
  };
  for (let i = 0; i < quoted.length; i++) {
    const ch = quoted[i];
    if (ch !== '\\') {
      push(ch);
      continue;
    }
    const next = quoted[i + 1];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let oct = '';
      let j = i + 1;
      while (j < quoted.length && oct.length < 3 && quoted[j] >= '0' && quoted[j] <= '7') {
        oct += quoted[j];
        j++;
      }
      bytes.push(parseInt(oct, 8));
      i = j - 1;
    } else {
      const map: Record<string, string> = { t: '\t', n: '\n', r: '\r', '"': '"', '\\': '\\' };
      push(map[next] ?? next);
      i++;
    }
  }
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * Extract file path from a +++ or --- header line.
 * Handles: +++ b/path, +++ "b/path with spaces", +++ "b/caf\303\251.ts",
 * +++ "b/quo\"te.ts", +++ b/path\twith\ttabs
 */
function parseHeaderPath(line: string): string | null {
  // Strip the +++ or --- prefix
  const rest = line.slice(4);

  if (rest.startsWith('"')) {
    // Git C-style quoted path: "b/space name.ts", "b/caf\303\251.ts"
    const closing = rest.lastIndexOf('"');
    if (closing <= 0) return null;
    return unquoteGitPath(rest.slice(1, closing)).replace(/^[ab]\//, '');
  }

  if (rest.startsWith('b/') || rest.startsWith('a/')) {
    // Unquoted path: b/src/foo.ts (may have trailing tab from git)
    const path = rest.slice(2);
    const tabIdx = path.indexOf('\t');
    return tabIdx >= 0 ? path.slice(0, tabIdx) : path;
  }

  return null;
}

/**
 * Parse unified diff output into a map of file -> changed line numbers.
 * Only tracks added/modified lines (lines starting with +).
 */
export function parseDiff(diffOutput: string): DiffMap {
  const result: DiffMap = new Map();
  let currentFile: string | null = null;
  let lineNumber = 0;

  for (const rawLine of diffOutput.split('\n')) {
    // CRLF diffs would otherwise leave a trailing \r on header paths, making
    // every diffMap key miss at scan time (silent false-clean).
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    // Reset currentFile on new diff block
    if (line.startsWith('diff ')) {
      currentFile = null;
      continue;
    }

    // New file header: +++ b/src/foo.ts
    if (line.startsWith('+++ ')) {
      currentFile = parseHeaderPath(line);
      continue;
    }

    // Skip --- headers and index lines
    if (line.startsWith('--- ') || line.startsWith('index ')) {
      continue;
    }

    // Skip "\ No newline at end of file" marker
    if (line.startsWith('\\ ')) {
      continue;
    }

    // Hunk header: @@ -10,5 +12,8 @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      lineNumber = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+')) {
      // Added/modified line
      if (!result.has(currentFile)) {
        result.set(currentFile, new Set());
      }
      result.get(currentFile)!.add(lineNumber);
      lineNumber++;
    } else if (line.startsWith('-')) {
      // Deleted line, don't increment line number
    } else {
      // Context line
      lineNumber++;
    }
  }

  return result;
}

/**
 * Get changed lines from git diff.
 * @param cwd - directory to run git in
 * @param staged - if true, use --cached (staged changes only)
 */
export function getGitDiff(cwd: string, staged: boolean): DiffMap {
  // Same reasoning as staged mode: user git config and .gitattributes must not
  // be able to change the bytes we parse or hide a file from the line map.
  const stable = [
    '-c', 'core.quotePath=false',
    '-c', 'diff.noprefix=false',
    '-c', 'color.diff=never',
  ];
  const args = [
    ...stable,
    'diff',
    ...(staged ? ['--cached'] : []),
    '-U0',
    '--text',
    '--no-textconv',
    // --no-ext-diff, not `-c diff.external=`: an empty value is a command git
    // tries to execute, which fails with "cannot run : No such file".
    '--no-ext-diff',
  ];

  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseDiff(output);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not a git repository')) {
      throw new Error('--diff requires a git repository');
    }
    throw err;
  }
}

/**
 * Resolve diff map paths to be relative to the scan root.
 * Git diff paths are relative to repo root, but scan paths are relative to targetPath.
 */
export function resolveDiffPaths(diffMap: DiffMap, repoRoot: string, scanRoot: string): DiffMap {
  const resolved: DiffMap = new Map();
  // `git rev-parse` hands back a canonical path, but the scan root is whatever
  // the user typed. On macOS /tmp is a symlink to /private/tmp, so comparing
  // the two made every changed file look like it sat outside the scan root and
  // diff mode reported a silent clean. Canonicalize both before comparing.
  const realRepoRoot = realpathOrSelf(repoRoot);
  const realScanRoot = realpathOrSelf(scanRoot);
  for (const [filePath, lines] of diffMap) {
    const absPath = resolve(realRepoRoot, filePath);
    const relPath = relative(realScanRoot, absPath);
    // Skip files outside the scan root
    if (relPath === '..' || relPath.startsWith('..' + sep)) continue;
    resolved.set(relPath, lines);
  }
  return resolved;
}

/** realpath, falling back to the input when the path does not exist yet. */
export function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Get the git repo root for a given directory.
 */
export function getGitRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf-8',
  }).trim();
}

/**
 * Shift a diff map to account for lines that `--fix` deleted.
 *
 * The map is built against the pre-fix file. Once the fixer removes a line
 * every line below it moves up by one, so reusing the map makes the rescan
 * look at the wrong lines and silently drop findings that moved out of it.
 * That let `--diff --fix --fail-on error` print "No issues found" and exit 0
 * with an eval() still in the file.
 */
export function shiftDiffMap(map: DiffMap, removed: { file: string; line: number }[]): DiffMap {
  if (removed.length === 0) return map;

  const cutsByFile = new Map<string, number[]>();
  for (const r of removed) {
    const list = cutsByFile.get(r.file) ?? [];
    list.push(r.line);
    cutsByFile.set(r.file, list);
  }

  const shifted: DiffMap = new Map();
  for (const [file, lines] of map) {
    const cuts = cutsByFile.get(file);
    if (!cuts) {
      shifted.set(file, lines);
      continue;
    }
    const cutSet = new Set(cuts);
    const next = new Set<number>();
    for (const line of lines) {
      if (cutSet.has(line)) continue; // the line itself is gone
      let above = 0;
      for (const c of cuts) if (c < line) above++;
      next.add(line - above);
    }
    shifted.set(file, next);
  }
  return shifted;
}

/**
 * Map each file in a unified diff to the blob hash of its DESTINATION side,
 * taken from the `index <src>..<dst> <mode>` header.
 *
 * --diff-stdin only ever parsed line numbers and then scanned whatever was
 * checked out, trusting without checking that the two describe the same
 * content. For the documented `gh pr diff 42 | vibecheck --diff-stdin .` case
 * they routinely do not: the diff describes the PR head, the checkout is
 * whatever is on disk, and every finding then gets looked for at a line number
 * that means nothing in the file being scanned.
 *
 * Hashes are abbreviated in the header, so callers compare by prefix.
 */
export function parseDiffBlobs(diff: string): {
  blobs: Map<string, string>;
  /** Paths described by more than one patch in the stream. */
  multiPatch: Set<string>;
} {
  const blobs = new Map<string, string>();
  const multiPatch = new Set<string>();
  let pending: string | undefined;

  // \r is stripped the same way parseDiff strips it. Without this a CRLF diff
  // yielded the path "f.ts\r", which hashes to nothing and was quietly dropped,
  // skipping verification entirely.
  for (const line of diff.split('\n').map((l) => l.replace(/\r$/, ''))) {
    if (line.startsWith('index ')) {
      const m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line);
      pending = m?.[2];
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = parseHeaderPath(line);
      if (path && pending) {
        // A multi-commit stream (git format-patch of several commits) touches
        // the same file more than once. The changed lines get unioned across
        // patches while only one blob can be checked, so the intermediate line
        // numbers describe content that never exists on disk. Record it and let
        // the caller refuse rather than verify the last hash and call it done.
        if (blobs.has(path) && blobs.get(path) !== pending) multiPatch.add(path);
        blobs.set(path, pending);
      }
      pending = undefined;
    }
  }

  return { blobs, multiPatch };
}

/**
 * Compare the destination blobs named by a diff against what is on disk.
 *
 * Returns the paths whose checked-out content does not match the diff. Files
 * absent from the checkout are not reported: a diff that deletes a file has no
 * added lines to scan anyway.
 */
export function findDiffContentMismatches(
  blobs: Map<string, string>,
  repoRoot: string,
  scanRoot: string
): string[] {
  const mismatched: string[] = [];
  const realRepoRoot = realpathOrSelf(repoRoot);
  const realScanRoot = realpathOrSelf(scanRoot);

  for (const [filePath, expected] of blobs) {
    const absPath = resolve(realRepoRoot, filePath);
    const relPath = relative(realScanRoot, absPath);
    if (relPath === '..' || relPath.startsWith('..' + sep)) continue;

    let actual: string;
    try {
      actual = execFileSync('git', ['hash-object', absPath], {
        cwd: realRepoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      continue; // not in the checkout; nothing to scan
    }

    // Expand the abbreviated hash through git rather than comparing prefixes.
    // core.abbrev can legitimately be as short as 4, and a 4-character prefix
    // is easy to collide, which let mismatched content pass verification.
    let expectedFull = expected;
    try {
      expectedFull = execFileSync('git', ['rev-parse', `${expected}^{object}`], {
        cwd: realRepoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Object not present locally (a diff from elsewhere). Prefix-compare, but
      // only when the prefix is long enough to mean something.
      if (expected.length < 7) continue;
      if (!actual.startsWith(expected)) mismatched.push(relPath);
      continue;
    }

    if (actual !== expectedFull) mismatched.push(relPath);
  }

  return mismatched;
}
