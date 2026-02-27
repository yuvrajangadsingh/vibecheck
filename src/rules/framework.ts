import type { Rule } from '../types.js';

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
