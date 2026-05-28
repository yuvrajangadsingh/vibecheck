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
    messageTemplate: 'Error internals leaked to HTTP response. Return a generic error message instead.',
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const importPattern = /^\s*import\s*\{([^}]*)\}\s*from\s*['"]react-router(?:-dom)?['"]\s*;?/;
const requirePattern = /^\s*(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]react-router(?:-dom)?['"]\s*\)\s*;?/;
const bindingPattern = /\bwithRouter\b(?:\s*(?:as|:)\s*([A-Za-z_$][\w$]*))?/;
const withRouterAntiPattern = /eslint-disable|vibecheck-ignore|\/\/\s*(?:legacy|intentional|react-router-v5|safe)/i;

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

      // Collect local binding names (handles aliasing) plus the line they were imported on
      const localNames = new Set<string>();
      const importLines = new Set<number>();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const importMatch = importPattern.exec(line);
        const requireMatch = requirePattern.exec(line);
        const bindingsStr = importMatch ? importMatch[1] : (requireMatch ? requireMatch[1] : null);
        if (bindingsStr === null) continue;

        // Skip if this import line itself carries an antiPattern marker
        if (withRouterAntiPattern.test(line)) continue;

        const bindingMatch = bindingPattern.exec(bindingsStr);
        if (!bindingMatch) continue;

        const localName = bindingMatch[1] || 'withRouter';
        localNames.add(localName);
        importLines.add(i);
      }

      if (localNames.size === 0) return findings;

      // Scan for usage of any local binding
      for (let i = 0; i < lines.length; i++) {
        if (importLines.has(i)) continue;
        const line = lines[i];
        if (withRouterAntiPattern.test(line)) continue;
        // Skip pure comment lines
        if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;

        for (const localName of localNames) {
          const usagePattern = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`);
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
