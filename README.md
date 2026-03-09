# vibecheck

**ESLint for AI slop.** Catch AI-generated code smells before they hit production.

```bash
npx @yuvrajangadsingh/vibecheck .
```

```
  src/api/routes.ts
    12:5    error  no-hardcoded-secrets   Hardcoded secret detected. Use environment variables instead.
    45:3    error  no-empty-catch         Empty catch block swallows errors silently.
    89:1    warn   no-console-pollution   console.log left in production code.

  src/utils/db.ts
    34:5    error  no-sql-concat          SQL query built with string concatenation.

  4 problems (3 errors, 1 warning)
  2 files with issues out of 47 scanned (0.8s)
```

## Why

AI coding tools generate code that *works* but cuts corners. Empty catch blocks, hardcoded secrets, `as any` everywhere, comments that restate the obvious. [CodeRabbit found](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) AI-generated PRs have 1.7x more issues than human PRs. [Veracode reports](https://www.helpnetsecurity.com/2025/08/07/create-ai-code-security-risks/) 45% of AI code samples contain security vulnerabilities.

vibecheck catches these patterns with zero config, zero API keys, zero cost. Runs locally, stays fast.

## Install

```bash
# Run directly (no install)
npx @yuvrajangadsingh/vibecheck .

# Install globally
npm install -g @yuvrajangadsingh/vibecheck

# Scan a specific directory
npx @yuvrajangadsingh/vibecheck src/

# Scan a single file
npx @yuvrajangadsingh/vibecheck src/api.ts
```

## What it catches

### Security
| Rule | Severity | What it detects |
|------|----------|----------------|
| `no-hardcoded-secrets` | error | API keys, tokens, passwords in source code |
| `no-eval` | error | `eval()` and `new Function()` calls |
| `no-sql-concat` | error | SQL queries built with string concatenation |
| `no-innerhtml` | warn | `innerHTML` and `dangerouslySetInnerHTML` usage |

### Error Handling
| Rule | Severity | What it detects |
|------|----------|----------------|
| `no-empty-catch` | error | Empty catch blocks that silently swallow errors |
| `no-console-error-only` | warn | Catch blocks that only `console.error` without rethrowing |
| `no-swallowed-promise` | warn | `.then()` chains without `.catch()` |

### Code Quality
| Rule | Severity | What it detects |
|------|----------|----------------|
| `no-console-pollution` | warn | `console.log`/`debug`/`info` left in production code |
| `no-ai-todo` | info | AI-generated placeholder TODOs (`TODO: implement`, `FIXME: add`) |
| `no-god-function` | warn | Functions over 80 lines |

### AI-Specific Tells
| Rule | Severity | What it detects |
|------|----------|----------------|
| `no-obvious-comments` | info | Comments that restate code (`// initialize the counter`) |
| `no-ts-any` | warn | TypeScript `any` types and `as any` casts |

### Framework
| Rule | Severity | What it detects |
|------|----------|----------------|
| `no-express-unhandled` | warn | Async Express routes without error handling |
| `no-error-info-leak` | error | Error internals (`err.message`, `err.stack`) leaked to HTTP responses |

## Options

```
vibecheck [path] [options]

Options:
  -c, --config <file>     Path to config file
  -d, --diff              Only scan lines changed in git diff (unstaged)
  --staged                Only scan lines changed in git diff --cached (staged)
  --json                  Output as JSON (for CI pipelines)
  --ignore <patterns...>  Additional ignore patterns
  --severity <level>      Minimum severity: error, warn, info (default: warn)
  -q, --quiet             Only show summary
  -v, --version           Show version
  -h, --help              Show help
```

## Diff mode

Scan only the lines you changed, not the entire codebase. Useful for pre-commit hooks and incremental CI.

```bash
# Scan unstaged changes
vibecheck --diff .

# Scan staged changes (pre-commit hook)
vibecheck --staged .

# CI-friendly output
vibecheck --staged --json .
```

### Pre-commit hook

Add to `.git/hooks/pre-commit` or use with [husky](https://github.com/typicode/husky):

```bash
#!/bin/sh
npx @yuvrajangadsingh/vibecheck --staged .
```

## Config

Create `.vibecheckrc` in your project root:

```json
{
  "rules": {
    "no-console-pollution": "off",
    "no-obvious-comments": "warn",
    "no-ts-any": "error"
  },
  "ignore": [
    "node_modules",
    "dist",
    "*.test.ts"
  ]
}
```

All rules are on by default at their recommended severity. Set any rule to `"off"` to disable it.

## GitHub Action

Add vibecheck to your CI with inline PR annotations:

```yaml
- uses: yuvrajangadsingh/vibecheck@v1.1.0
  with:
    severity: warn       # minimum severity to report (default: warn)
    fail-on: error       # fail the check at this severity (default: error)
    ignore: "tests/**"   # comma-separated ignore patterns
```

The action automatically scans only files changed in the PR. On push events, it scans the full repo.

Available on the [GitHub Marketplace](https://github.com/marketplace/actions/vibecheck-ai-slop).

### Manual CI

```bash
npx @yuvrajangadsingh/vibecheck . --json > vibecheck.json
```

## How it works

vibecheck uses regex pattern matching to scan your JS/TS files. No AST parsing, no external APIs, no AI. Each rule has a detection pattern and an anti-pattern to reduce false positives.

It skips `node_modules`, `dist`, `build`, lockfiles, and minified code by default.

## License

MIT
