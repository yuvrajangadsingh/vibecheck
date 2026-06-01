import type { Rule, MultilineRule, MultilineFinding } from '../types.js';

export const frameworkRules: Rule[] = [
  {
    id: 'no-express-unhandled',
    name: 'No Unhandled Express Routes',
    description: 'Async Express route handlers without try/catch crash the server on errors.',
    category: 'framework',
    severity: 'warn',
    languages: ['js', 'ts', 'mjs', 'cjs'],
    pattern: /(?:app|router)\.\s*(?:get|post|put|delete|patch)\s*\([^,]+,\s*async\s/,
    antiPattern: /express-async-errors|asyncHandler|catchAsync|tryCatch|wrapAsync|eslint-disable/,
    messageTemplate: 'Async Express route may lack error handling. Wrap in try/catch or use an async error handler.',
  },
  {
    id: 'no-error-info-leak',
    name: 'No Error Info Leak',
    description: 'Sending error.message or error.stack to clients leaks internal details.',
    category: 'framework',
    severity: 'error',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    pattern: /res\.(?:json|send|status\s*\([^)]*\)\s*\.(?:json|send))\s*\([^)]*(?:err|error)\.(?:message|stack|toString\(\))/,
    messageTemplate: 'Error internals leaked to HTTP response. Return a safe public error message or stable error code; log internals server-side.',
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Single-line forms (kept for fast path / clarity)
const importPattern = /^\s*import\s*\{([^}]*)\}\s*from\s*['"]react-router(?:-dom)?['"]\s*;?/;
const requirePattern = /^\s*(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]react-router(?:-dom)?['"]\s*\)\s*;?/;

// Multi-line starters: opening `import {` or `const/let/var {` with no closing `}` on the same line
const importOpenPattern = /^\s*import\s*\{([^}]*)$/;
const requireOpenPattern = /^\s*(?:const|let|var)\s*\{([^}]*)$/;

// After accumulating bindings up to the closing `}`, the remainder must match one of these
const importTailPattern = /^\s*from\s*['"]react-router(?:-dom)?['"]\s*;?/;
const requireTailPattern = /^\s*=\s*require\s*\(\s*['"]react-router(?:-dom)?['"]\s*\)\s*;?/;

const bindingPattern = /\bwithRouter\b(?:\s*(?:as|:)\s*([A-Za-z_$][\w$]*))?/;
const withRouterAntiPattern = /eslint-disable|vibecheck-ignore|\/\/\s*(?:legacy|intentional|react-router-v5|safe)/i;

type ImportHit = {
  bindingsStr: string;
  // every line index this import physically spans, so usage scan can skip all of them
  lineSpan: number[];
  // every line that should be checked for the antiPattern marker
  rawLines: string[];
};

function collectImports(lines: string[]): ImportHit[] {
  const hits: ImportHit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-line ES import
    const singleImport = importPattern.exec(line);
    if (singleImport) {
      hits.push({ bindingsStr: singleImport[1], lineSpan: [i], rawLines: [line] });
      continue;
    }

    // Single-line CJS require
    const singleRequire = requirePattern.exec(line);
    if (singleRequire) {
      hits.push({ bindingsStr: singleRequire[1], lineSpan: [i], rawLines: [line] });
      continue;
    }

    // Multi-line ES import: `import {` on this line, `}` and `from '...'` later
    const openImport = importOpenPattern.exec(line);
    if (openImport) {
      const hit = accumulateMultiline(lines, i, openImport[1], importTailPattern);
      if (hit) {
        hits.push(hit);
        i = hit.lineSpan[hit.lineSpan.length - 1];
      }
      continue;
    }

    // Multi-line CJS require: `const {` on this line, `} = require('...')` later
    const openRequire = requireOpenPattern.exec(line);
    if (openRequire) {
      const hit = accumulateMultiline(lines, i, openRequire[1], requireTailPattern);
      if (hit) {
        hits.push(hit);
        i = hit.lineSpan[hit.lineSpan.length - 1];
      }
      continue;
    }
  }

  return hits;
}

function accumulateMultiline(
  lines: string[],
  startIdx: number,
  firstChunk: string,
  tailPattern: RegExp,
): ImportHit | null {
  let bindings = firstChunk;
  const span = [startIdx];
  const raw = [lines[startIdx]];

  for (let j = startIdx + 1; j < lines.length; j++) {
    const inner = lines[j];
    span.push(j);
    raw.push(inner);

    const closeIdx = inner.indexOf('}');
    if (closeIdx === -1) {
      bindings += '\n' + inner;
      continue;
    }

    bindings += '\n' + inner.slice(0, closeIdx);
    const tail = inner.slice(closeIdx + 1);
    if (!tailPattern.test(tail)) return null;
    return { bindingsStr: bindings, lineSpan: span, rawLines: raw };
  }

  return null;
}

export const frameworkMultilineRules: MultilineRule[] = [
  {
    id: 'no-with-router',
    name: 'No withRouter HOC',
    description: 'withRouter is deprecated since react-router v6. Use useNavigate/useParams/useLocation hooks.',
    category: 'framework',
    severity: 'warn',
    languages: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
    messageTemplate: 'withRouter is deprecated since react-router v6 (2021). Use useNavigate(), useParams(), or useLocation() hooks instead. See https://reactrouter.com/v6/start/faq',
    detect(lines: string[]): MultilineFinding[] {
      const findings: MultilineFinding[] = [];

      const localNames = new Set<string>();
      const importLines = new Set<number>();

      const imports = collectImports(lines);
      for (const hit of imports) {
        // Skip if any line in the import span carries an antiPattern marker
        if (hit.rawLines.some(l => withRouterAntiPattern.test(l))) continue;

        const bindingMatch = bindingPattern.exec(hit.bindingsStr);
        if (!bindingMatch) continue;

        const localName = bindingMatch[1] || 'withRouter';
        localNames.add(localName);
        for (const idx of hit.lineSpan) importLines.add(idx);
      }

      if (localNames.size === 0) return findings;

      // Scan for usage of any local binding. Left-context guard `(?<![\w$.])`
      // prevents matching property accesses like `MyModule.withRouter(X)`.
      for (let i = 0; i < lines.length; i++) {
        if (importLines.has(i)) continue;
        const line = lines[i];
        if (withRouterAntiPattern.test(line)) continue;
        // Skip pure comment lines
        if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;

        for (const localName of localNames) {
          const usagePattern = new RegExp(`(?<![\\w$.])${escapeRegExp(localName)}\\s*(?:<[^;\\n]*?>\\s*)?\\(`);
          const match = usagePattern.exec(line);
          if (match) {
            findings.push({
              line: i + 1,
              column: match.index + 1,
              message: 'withRouter is deprecated since react-router v6 (2021). Use useNavigate(), useParams(), or useLocation() hooks instead. See https://reactrouter.com/v6/start/faq',
              snippet: line,
            });
            break;
          }
        }
      }

      return findings;
    },
  },
];
