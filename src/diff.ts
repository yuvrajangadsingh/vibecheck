import { execFileSync } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';

export type DiffMap = Map<string, Set<number>>;

/**
 * Extract file path from a +++ or --- header line.
 * Handles: +++ b/path, +++ "b/path with spaces", +++ b/path\twith\ttabs
 */
function parseHeaderPath(line: string): string | null {
  // Strip the +++ or --- prefix
  const rest = line.slice(4);

  if (rest.startsWith('"')) {
    // Quoted path: "b/src/space name.ts"
    const closing = rest.lastIndexOf('"');
    if (closing <= 0) return null;
    const quoted = rest.slice(1, closing);
    // Remove b/ prefix, unescape git's quoting
    const unescaped = quoted.replace(/^[ab]\//, '').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    return unescaped;
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

  for (const line of diffOutput.split('\n')) {
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
  const args = staged ? ['diff', '--cached', '-U0'] : ['diff', '-U0'];

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
  for (const [filePath, lines] of diffMap) {
    const absPath = resolve(repoRoot, filePath);
    const relPath = relative(scanRoot, absPath);
    // Skip files outside the scan root
    if (relPath === '..' || relPath.startsWith('..' + sep)) continue;
    resolved.set(relPath, lines);
  }
  return resolved;
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
