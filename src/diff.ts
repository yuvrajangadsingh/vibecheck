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
  // Prefixes are configurable: diff.mnemonicPrefix emits i/ w/ c/ o/ instead of
  // a/ b/, and diff.noprefix emits none at all. Accepting only a/ and b/ made
  // both configurations parse as "no files changed", a silent clean.

  // Strip the +++ or --- prefix
  const rest = line.slice(4);

  if (rest.startsWith('"')) {
    // Git C-style quoted path: "b/space name.ts", "b/caf\303\251.ts"
    const closing = rest.lastIndexOf('"');
    if (closing <= 0) return null;
    return stripPrefix(unquoteGitPath(rest.slice(1, closing)));
  }

  if (rest === '/dev/null') return null;

  // Unquoted path, possibly with a trailing tab from git
  const tabIdx = rest.indexOf('\t');
  const path = tabIdx >= 0 ? rest.slice(0, tabIdx) : rest;
  if (!path) return null;
  return stripPrefix(path);
}

/**
 * Remove git's source/destination prefix.
 *
 * a/ and b/ are the defaults; diff.mnemonicPrefix substitutes i/ (index),
 * w/ (working tree), c/ (commit) and o/ (object); diff.noprefix removes it
 * entirely. Only the first two were handled, so either setting made every diff
 * parse as no changed files.
 */
function stripPrefix(path: string): string {
  return /^[abciwo]\//.test(path) ? path.slice(2) : path;
}

/**
 * Parse unified diff output into a map of file -> changed line numbers.
 * Only tracks added/modified lines (lines starting with +).
 */
/**
 * One hunk of a unified diff, half-open on both sides.
 *
 * `oldCount === 0` means an insertion AFTER oldStart (git prints the line
 * before the insertion point), and `newCount === 0` a deletion after newStart.
 */
export type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

export type ParsedDiff = {
  changedLines: DiffMap;
  /** Per file, in patch order. Coordinates only; line text lives in the file contents. */
  hunks: Map<string, Hunk[]>;
};

export function parseDiff(diffOutput: string): DiffMap {
  return parseDiffDetailed(diffOutput).changedLines;
}

export function parseDiffDetailed(diffOutput: string): ParsedDiff {
  const result: DiffMap = new Map();
  const hunks = new Map<string, Hunk[]>();
  let currentFile: string | null = null;
  let lineNumber = 0;
  // Headers (---, +++, index) only appear BETWEEN hunks. Checking for them
  // positionally matters: a deleted source line `-- retries;` renders as
  // `--- retries;` and an added `++ x;` as `+++ x;`, and matching those as
  // headers ate the deletion (file missing from the map, false clean) or
  // clobbered currentFile with garbage. Each new file's `diff` line ends the
  // hunk; a headerless concatenation of raw hunks is not supported.
  let inHunk = false;

  const touch = (file: string) => {
    if (!result.has(file)) result.set(file, new Set());
  };

  for (const rawLine of diffOutput.split('\n')) {
    // CRLF diffs would otherwise leave a trailing \r on header paths, making
    // every diffMap key miss at scan time (silent false-clean).
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    // Reset currentFile on new diff block
    if (line.startsWith('diff ')) {
      currentFile = null;
      inHunk = false;
      continue;
    }

    // New file header: +++ b/src/foo.ts
    if (!inHunk && line.startsWith('+++ ')) {
      currentFile = parseHeaderPath(line);
      continue;
    }

    // Skip --- headers and index lines
    if (!inHunk && (line.startsWith('--- ') || line.startsWith('index '))) {
      continue;
    }

    // Skip "\ No newline at end of file" marker
    if (line.startsWith('\\ ')) {
      continue;
    }

    // Hunk header: @@ -10,5 +12,8 @@ (counts default to 1 when omitted)
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] === undefined ? 1 : parseInt(hunkMatch[2], 10);
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] === undefined ? 1 : parseInt(hunkMatch[4], 10);
      lineNumber = newStart;
      inHunk = true;
      if (currentFile) {
        const list = hunks.get(currentFile) ?? [];
        list.push({ oldStart, oldCount, newStart, newCount });
        hunks.set(currentFile, list);
      }
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+')) {
      // Added/modified line
      touch(currentFile);
      result.get(currentFile)!.add(lineNumber);
      lineNumber++;
    } else if (line.startsWith('-')) {
      // Deleted line: no destination line number to record, but the FILE must
      // still enter the map. A deletion-only change never got scanned at all,
      // so deleting the `return` from a catch block — which CREATES
      // no-console-error-only — reported nothing. With an (empty) entry the
      // file is scanned, and introduced-finding detection judges it against
      // the base; without a base, anchor matching keeps nothing, exactly as
      // before. A pure rename emits no hunks and still produces no entry.
      touch(currentFile);
    } else {
      // Context line
      lineNumber++;
    }
  }

  return { changedLines: result, hunks };
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

  const runDiff = (withText: boolean) =>
    execFileSync('git', withText ? args : args.filter((a) => a !== '--text'), {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
    });

  try {
    let output: string;
    try {
      output = runDiff(true);
    } catch (bufErr) {
      // --text expands binaries inline, so a large changed asset can outgrow
      // the buffer. Falling back loses gitattributes-binary coverage for this
      // run, which is worth saying out loud, but it beats crashing.
      if (!(bufErr instanceof Error) || !/ENOBUFS|maxBuffer/.test(bufErr.message)) throw bufErr;
      process.stderr.write(
        'vibecheck: diff too large to expand as text; a file marked binary by .gitattributes may go unscanned.\n'
      );
      output = runDiff(false);
    }
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
 * Map an old-side line to its new-side position.
 *
 * Exact for lines OUTSIDE every hunk: shift by the cumulative delta of the
 * hunks above. Lines inside a hunk's old range return the hunk index instead —
 * there is no per-line truth inside a replacement, and pretending otherwise is
 * how the wrong copy of a duplicate finding gets blamed.
 */
export function mapOldLine(hunks: Hunk[], oldLine: number): { line: number } | { hunk: number } {
  let delta = 0;
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    if (h.oldCount > 0 && oldLine >= h.oldStart && oldLine < h.oldStart + h.oldCount) {
      return { hunk: i };
    }
    // A zero-count hunk is an insertion AFTER oldStart, so oldStart itself is
    // not shifted by it; every later line is.
    const hunkIsAbove = h.oldCount === 0 ? h.oldStart < oldLine : h.oldStart + h.oldCount <= oldLine;
    if (hunkIsAbove) delta += h.newCount - h.oldCount;
  }
  return { line: oldLine + delta };
}

/** Index of the hunk whose NEW range contains this line, or -1. */
export function hunkIndexForNewLine(hunks: Hunk[], newLine: number): number {
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    if (h.newCount > 0 && newLine >= h.newStart && newLine < h.newStart + h.newCount) return i;
  }
  return -1;
}

/**
 * Resolve a ParsedDiff's repo-relative paths against the scan root, keeping
 * changed lines and hunks on the same keys. Resolving one and not the other is
 * a correspondence that silently stops corresponding.
 */
export function resolveParsedDiff(parsed: ParsedDiff, repoRoot: string, scanRoot: string): ParsedDiff {
  const changedLines = resolveDiffPaths(parsed.changedLines, repoRoot, scanRoot);
  const hunks = new Map<string, Hunk[]>();
  const realRepoRoot = realpathOrSelf(repoRoot);
  const realScanRoot = realpathOrSelf(scanRoot);
  for (const [filePath, list] of parsed.hunks) {
    const absPath = resolve(realRepoRoot, filePath);
    const relPath = relative(realScanRoot, absPath);
    if (relPath === '..' || relPath.startsWith('..' + sep)) continue;
    hunks.set(relPath, list);
  }
  return { changedLines, hunks };
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
  // `diff --git` opens a block. Without tracking that, a commit message that
  // quotes diff syntax (format-patch puts the message above the patch) was read
  // as a second patch and a perfectly good single-commit stream was refused.
  let inDiff = false;

  for (const line of diff.split('\n').map((l) => l.replace(/\r$/, ''))) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      inDiff = true;
      pending = undefined;
      continue;
    }
    if (!inDiff) continue;
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
    // An all-zero destination is a deletion: no content to check, no lines to
    // scan.
    if (/^0+$/.test(expected)) continue;
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
      // A recorded `+++ b/path` means the diff expects this file to EXIST on
      // the destination side. Absent from the checkout is a mismatch, not a
      // free pass — treating it as "nothing to scan" let a whole added file go
      // unverified and unscanned.
      mismatched.push(relPath);
      continue;
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

/**
 * Content of each changed file as it was BEFORE the working-tree edits.
 *
 * For unstaged `--diff` that is the index copy, which is what `git diff`
 * compares against. Files with no index entry are new, and map to empty
 * content so every finding in them counts as introduced.
 *
 * Used to tell "your change created this finding" from "this was already
 * here", which line numbers alone cannot express for a multiline rule whose
 * anchor sits above the line you touched.
 */
export function getIndexContents(
  repoRoot: string,
  scanRoot: string,
  paths: string[],
  /**
   * Read blobs from this tree instead of the live index, so the base matches
   * a diff generated against the same tree. Paths MISSING from the tree are
   * re-read from the index: an intent-to-add file exists there as an empty
   * blob, and that empty blob is the signal that keeps an unstaged rename
   * from being blamed for everything it contains.
   */
  baseTree?: string | null
): Map<string, string> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const realRepoRoot = realpathOrSelf(repoRoot);
  const realScanRoot = realpathOrSelf(scanRoot);

  const repoPathFor = new Map<string, string>();
  for (const reportPath of paths) {
    const abs = resolve(realScanRoot, reportPath);
    repoPathFor.set(reportPath, relative(realRepoRoot, abs).split(sep).join('/'));
  }

  // One `cat-file --batch` process for the whole change set. Spawning `git
  // show` per file cost 13x on a 250-file diff (0.9s -> 11.8s), which is not a
  // price worth paying for a linter that runs on every commit.
  let batch: string;
  try {
    batch = execFileSync(
      'git',
      ['cat-file', '-z', '--batch=%(objectname) %(objecttype) %(objectsize)'],
      {
        cwd: realRepoRoot,
        // NUL-delimited: a filename may legally contain a newline, and
        // newline-delimited requests let such a name corrupt the framing of
        // every response after it.
        input: [...repoPathFor.values()].map((p) => `${baseTree ? baseTree + ':' : ':'}${p}`).join('\0') + '\0',
        encoding: 'latin1',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );
  } catch {
    return out; // no usable base; callers fall back to anchor matching
  }

  // Responses come back in request order: a header line, then the payload, or
  // "<spec> missing" for anything the index does not have.
  const reportPaths = [...repoPathFor.keys()];
  let cursor = 0;
  for (const reportPath of reportPaths) {
    const nl = batch.indexOf('\n', cursor);
    if (nl === -1) break;
    const header = batch.slice(cursor, nl);
    cursor = nl + 1;

    if (/\bmissing$/.test(header)) {
      if (baseTree) {
        // Missing from the frozen tree is NOT evidence the file is new, and it
        // must not be answered by reading the live index: that reopens the very
        // race the frozen tree closes, and a path staged after the freeze came
        // back with content the diff never described. Leave it unset — unknown
        // base, so this file falls back to anchor matching.
        continue;
      } else {
        // Absent from the index means the file is new, so everything in it is
        // introduced.
        out.set(reportPath, '');
      }
      continue;
    }
    if (/ (ambiguous|dangling)$/.test(header)) {
      // We could not resolve it. That is not evidence the file is new, and
      // treating it as new would blame the author for everything in it. Leave
      // it unset so this file falls back to anchor matching.
      continue;
    }

    const size = Number(header.slice(header.lastIndexOf(' ') + 1));
    if (!Number.isFinite(size)) break;
    const body = batch.slice(cursor, cursor + size);
    cursor += size + 1; // payload plus its trailing newline

    // An empty index blob is what `git add -N` writes, which is how an unstaged
    // rename shows up. Treating that as the real "before" made every finding in
    // a moved file look introduced — false blame on code the author only moved.
    // Leaving the entry unset falls back to anchor matching, which is what the
    // previous release did for these files anyway.
    if (size === 0) continue;

    out.set(reportPath, Buffer.from(body, 'latin1').toString('utf-8'));
  }

  return out;
}

/**
 * Diff the worktree against a FROZEN copy of the index.
 *
 * Plain `git diff` and a later index read can observe two different index
 * states — stage something in between and the line map describes one base
 * while the contents come from another, which correspondence turns from a
 * subtle miscount into concrete wrong lines. `git write-tree` pins the index
 * once; the diff and every base blob read come from that immutable tree, the
 * same guarantee staged mode gets.
 *
 * Falls back to a live `git diff` (no tree; callers should not trust hunks
 * for correspondence then) when the index cannot be written, e.g. unmerged
 * paths mid-conflict.
 */
export function getWorktreeDiff(
  repoRoot: string,
  reuseTree?: string | null
): { parsed: ParsedDiff; baseTree: string | null } {
  let tree: string | null = reuseTree ?? null;
  if (!tree) {
    try {
      tree = execFileSync('git', ['write-tree'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      tree = null;
    }
  }

  const stable = [
    '-c', 'core.quotePath=false',
    '-c', 'diff.noprefix=false',
    // Nearby zero-context hunks can be merged by user config, which folds
    // unchanged lines INTO a hunk and breaks positional matching against it.
    '-c', 'diff.interHunkContext=0',
    '-c', 'color.diff=never',
  ];
  const args = [
    ...stable,
    'diff',
    '-U0',
    '--text',
    '--no-textconv',
    '--no-ext-diff',
    ...(tree ? [tree] : []),
  ];

  try {
    const output = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
    });
    return { parsed: parseDiffDetailed(output), baseTree: tree };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not a git repository')) {
      throw new Error('--diff requires a git repository');
    }
    throw new Error(`git diff failed: ${msg.slice(0, 200)}`);
  }
}
