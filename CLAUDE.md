# vibecheck

CLI that detects AI-generated code smells in JS/TS. "ESLint for AI slop."

## Quick Reference
- npm: `@yuvrajangadsingh/vibecheck` (v1.1.0)
- Build: `npm run build` (tsup)
- Test: `npm test` (vitest, 40 tests)
- Self-scan: `node dist/cli.js .`
- Publish: `npm publish --access=public`

## Architecture
- Regex-based pattern matching (no AST in v1)
- Two rule types: single-line (`Rule`) and multiline (`MultilineRule`)
- String-aware brace counting via `trackBraceDepth()` helper
- Config: `.vibecheckrc` JSON, all rules on by default
- Scanner skips binary files (null byte check) and files >1MB

## Key Files
- `src/cli.ts` - entry point, commander setup
- `src/scanner.ts` - file walker + rule runner
- `src/config.ts` - .vibecheckrc loader
- `src/formatter.ts` - pretty/JSON/quiet output
- `src/rules/` - all 14 rules across 5 categories
- `tests/fixtures/` - sample files with known smells

## Rules (14)
Security: no-hardcoded-secrets, no-eval, no-innerhtml, no-sql-concat
Error Handling: no-empty-catch, no-console-error-only, no-swallowed-promise
Code Quality: no-console-pollution, no-ai-todo, no-god-function
AI Tells: no-obvious-comments, no-ts-any
Framework: no-express-unhandled, no-error-info-leak

## Release Flow
1. Branch off main (branch protection enabled)
2. Bump version in package.json + src/cli.ts
3. PR, merge
4. `npm publish --access=public`

## Notes
- GitHub secret scanning blocks `sk_live_` prefix in test fixtures. Use `xk_test_` instead.
- npm auto-corrects bin name (warns about "bin[vibecheck] script name was cleaned")
- npm token in ~/.npmrc expires ~May 28 2026
- PLAN.md is gitignored (local tracking only)
