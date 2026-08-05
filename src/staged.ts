import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import picomatch from 'picomatch';
import { parseDiff, realpathOrSelf, type DiffMap } from './diff.js';

/**
 * Read the STAGED content of changed files, not the working tree.
 *
 * `--staged` used to build its line map from `git diff --cached` and then scan
 * whatever was on disk. Stage a file containing eval(), overwrite the working
 * copy with something clean, and the commit sailed through green. The index and
 * the working tree are different things, and the pre-commit case cares about
 * the index.
 *
 * Two rules govern everything below:
 *
 *   1. The line map and the file contents must come from the SAME index state.
 *      Running `git diff --cached` and then `git show :path` separately can
 *      observe different states if something touches the index in between, so
 *      the index is snapshotted once with `git write-tree` and everything is
 *      read from that immutable tree.
 *
 *   2. Anything in scope that cannot be read fails closed. A staged blob that
 *      is binary, oversized, or unreadable is reported as an error, never as a
 *      clean pass — that confusion is the whole bug.
 */

const MAX_BLOB_SIZE = 1_000_000;

/** Git's empty tree, used as the base when HEAD does not exist yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export type StagedFile = {
  /** Repository-root-relative, as git reports it. */
  repoPath: string;
  /** Relative to the scan root — what findings and baselines print. */
  reportPath: string;
  content: string;
  changedLines: Set<number>;
};

export type StagedProblem = {
  repoPath: string;
  reason: 'binary' | 'too-large' | 'unreadable' | 'unsupported';
  detail?: string;
};

export type StagedSnapshot = {
  files: StagedFile[];
  /** In-scope entries that could not be scanned. A non-empty list must fail the run. */
  problems: StagedProblem[];
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Diff output must not depend on the user's git config. Colour, textconv and
 * external diff drivers all change the bytes we parse.
 */
const STABLE_DIFF = [
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.external=',
  '-c',
  'color.diff=never',
];

/**
 * Snapshot the index and return the staged content of every changed file that
 * falls inside the scan root.
 *
 * @param repoRoot  git repository root
 * @param scanRoot  directory (or file's directory) the user asked to scan
 */
export function readStagedSnapshot(
  repoRoot: string,
  scanRoot: string,
  scope: { include: string[]; ignore: string[] }
): StagedSnapshot {
  // Scope has to be decided from the PATH, before any content is read. A
  // staged binary produces no changed lines, so a "no changed lines, skip"
  // check would drop it before the binary check ever ran, and "the only staged
  // change is an in-scope binary" would look exactly like "nothing changed".
  const inScope = picomatch(scope.include, { ignore: scope.ignore, dot: false });

  // Canonicalize both roots before comparing them. git reports a real path
  // while the scan root is whatever the user typed, and on macOS /tmp and
  // /var/folders are symlinks — comparing the two makes every staged file look
  // like it sits outside the scan root, which is a silent clean all over again.
  const realRepoRoot = realpathOrSelf(repoRoot);
  const realScanRoot = realpathOrSelf(scanRoot);
  // 1. Freeze the index. An unmerged index cannot be written and must not be
  //    silently half-scanned.
  let indexTree: string;
  try {
    indexTree = git(repoRoot, ['write-tree']).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unmerged|conflict/i.test(msg)) {
      throw new Error('--staged cannot run with unmerged paths in the index. Resolve conflicts first.');
    }
    throw new Error(`--staged could not read the index: ${msg.trim()}`);
  }

  // 2. Resolve the base. An unborn HEAD (no commits yet) diffs against the
  //    empty tree so the first commit is still checked.
  let baseTree = EMPTY_TREE;
  try {
    // stderr silenced: an unborn HEAD is an ordinary first-commit case, not
    // something to spray git's "ambiguous argument" fatal at the user over.
    baseTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    baseTree = EMPTY_TREE;
  }

  // 3. Line map and file metadata come from the SAME pair of immutable trees.
  const patch = git(repoRoot, [...STABLE_DIFF, 'diff-tree', '-U0', '-r', '-M', baseTree, indexTree]);
  const lineMap = parseDiff(patch);

  const raw = git(repoRoot, [...STABLE_DIFF, 'diff-tree', '-r', '-M', '--raw', '-z', baseTree, indexTree]);

  const files: StagedFile[] = [];
  const problems: StagedProblem[] = [];

  for (const entry of parseRawZ(raw)) {
    // A staged deletion has no new-side content, and a pure rename has no
    // changed lines. Neither is something to lint.
    if (entry.status === 'D') continue;

    // Outside the scan root: not this run's business.
    const reportPath = relative(realScanRoot, `${realRepoRoot}/${entry.path}`);
    if (reportPath === '..' || reportPath.startsWith('../')) continue;

    // Out of scope by config: a staged .png is not a scan failure.
    if (!inScope(reportPath.split('\\').join('/'))) continue;

    // A staged symlink or gitlink is not source text. Linting the target path
    // as if it were code would be nonsense, and skipping it quietly is the bug.
    if (entry.mode === '120000' || entry.mode === '160000') {
      problems.push({
        repoPath: entry.path,
        reason: 'unsupported',
        detail: entry.mode === '120000' ? 'staged symlink' : 'staged submodule',
      });
      continue;
    }

    let raw_content: Buffer;
    try {
      raw_content = execFileSync('git', ['cat-file', 'blob', entry.oid], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      problems.push({
        repoPath: entry.path,
        reason: 'unreadable',
        detail: err instanceof Error ? err.message.trim() : String(err),
      });
      continue;
    }

    if (raw_content.length > MAX_BLOB_SIZE) {
      problems.push({
        repoPath: entry.path,
        reason: 'too-large',
        detail: `${Math.round(raw_content.length / 1024)}KB exceeds the ${Math.round(MAX_BLOB_SIZE / 1024)}KB limit`,
      });
      continue;
    }

    if (raw_content.includes(0)) {
      problems.push({ repoPath: entry.path, reason: 'binary' });
      continue;
    }

    // Readable text with no added lines: a pure rename or mode change. Nothing
    // to lint, and nothing wrong.
    const changedLines = lineMap.get(entry.path);
    if (!changedLines || changedLines.size === 0) continue;

    files.push({
      repoPath: entry.path,
      reportPath,
      content: raw_content.toString('utf-8'),
      changedLines,
    });
  }

  return { files, problems };
}

type RawEntry = { mode: string; oid: string; status: string; path: string };

/**
 * Parse `git diff-tree --raw -z` records.
 *
 * NUL-delimited so paths carrying spaces, quotes, backslashes or newlines
 * survive intact — the same class of filename that made glob-based discovery
 * skip files silently.
 *
 * Format per record: `:<srcmode> <dstmode> <srcoid> <dstoid> <status>\0<path>\0`
 * Rename and copy statuses carry a second path field.
 */
function parseRawZ(raw: string): RawEntry[] {
  const parts = raw.split('\0');
  const out: RawEntry[] = [];

  for (let i = 0; i < parts.length; i++) {
    const meta = parts[i];
    if (!meta.startsWith(':')) continue;

    const fields = meta.slice(1).split(' ');
    if (fields.length < 5) continue;
    const [, dstMode, , dstOid, statusField] = fields;
    const status = statusField[0];

    // R and C carry <source>\0<destination>; the destination is what got staged.
    const pathIndex = status === 'R' || status === 'C' ? i + 2 : i + 1;
    const path = parts[pathIndex];
    i = pathIndex;
    if (!path) continue;

    out.push({ mode: dstMode, oid: dstOid, status, path });
  }

  return out;
}
