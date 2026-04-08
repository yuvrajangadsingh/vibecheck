# vibecheck Scan Results: Cursor vs Lovable vs Bolt

Scanned 15 repos (5 per tool) using vibecheck v1.5.0 with `--severity warn`.

---

## Per-Repo Results

### Cursor-Built Repos

| Repo | Issues | Errors | Files Hit | Files Scanned | Issues/File |
|------|--------|--------|-----------|---------------|-------------|
| ai-monorepo-scaffold | 31 | 4 | 7/68 | 68 | 0.46 |
| airpsx-frontend | 279 | 0 | 22/31 | 31 | 9.00 |
| memory-chess | 454 | 2 | 55/139 | 139 | 3.27 |
| lm_studio_big_rag_plugin | 179 | 0 | 15/24 | 24 | 7.46 |
| cursor-rules-todoapp | 60 | 0 | 20/153 | 153 | 0.39 |
| **Cursor Total** | **1,003** | **6** | **119/415** | **415** | **2.42** |

**Top rules fired:**
- no-deep-nesting: 441
- no-console-pollution: 310
- no-ts-any: 126
- no-god-function: 63
- no-console-error-only: 37
- no-sql-concat: 6
- no-innerhtml: 5
- no-swallowed-promise: 3

**Largest god functions:**
- `FileManager` (859 lines) in airpsx-frontend
- `Desktop` (838 lines) in airpsx-frontend
- `Scheduler` (663 lines) in airpsx-frontend
- `LearnArticleRich` (594 lines) in memory-chess
- `GameResult` (432 lines) in memory-chess

**Security findings:**
- 4x SQL injection via string concatenation (ai-monorepo-scaffold)
- 2x SQL injection (memory-chess)
- 5x innerHTML/XSS (airpsx-frontend, memory-chess)
- 2x swallowed promises (memory-chess)

**Notable:** airpsx-frontend is the worst offender. 279 issues in 31 files. 71% of files have issues. Three components over 600 lines. This is what "built with Cursor with almost no coding" looks like when nobody reviews the output. The ai-monorepo-scaffold (298 stars, most popular Cursor repo in the set) has SQL injection in its optimistic update utilities, a library-level concern.

---

### Lovable-Built Repos

| Repo | Issues | Errors | Files Hit | Files Scanned | Issues/File |
|------|--------|--------|-----------|---------------|-------------|
| gptme-webui | 379 | 1 | 56/153 | 153 | 2.48 |
| My-30-Apps | 21 | 0 | 3/62 | 62 | 0.34 |
| eleve_ecommerce | 45 | 0 | 16/84 | 84 | 0.54 |
| act-solo-ai | 487 | 2 | 53/123 | 123 | 3.96 |
| vigil-mvp | 130 | 0 | 24/96 | 96 | 1.35 |
| **Lovable Total** | **1,062** | **3** | **152/518** | **518** | **2.05** |

**Top rules fired:**
- no-deep-nesting: 509
- no-console-pollution: 337
- no-ts-any: 64
- no-god-function: 61
- no-console-error-only: 29
- no-innerhtml: 10
- no-empty-catch: 2
- no-eval: 1

**Largest god functions:**
- `parser_write` (1,104 lines) in gptme-webui
- `useSpeechRecognition` (528 lines) in act-solo-ai
- `DoseTimeline` (498 lines) in vigil-mvp
- `PracticeWithRehearsal` (474 lines) in act-solo-ai
- `useConversation` (429 lines) in gptme-webui

**Security findings:**
- 1x eval() usage (gptme-webui)
- 10x innerHTML/XSS (across gptme-webui, act-solo-ai, eleve_ecommerce, My-30-Apps, vigil-mvp)
- 2x empty catch blocks (act-solo-ai, one with only a TODO comment)

**Notable:** Lovable has the single largest function across all 15 repos: `parser_write` at 1,104 lines in gptme-webui. Every single Lovable repo has at least one innerHTML usage, making it the tool most prone to XSS vectors. The gptme-webui (47 stars, the most "real" Lovable app) has an eval() call, which is the most severe security finding across the entire scan. act-solo-ai (8MB of code) has 487 issues, the highest raw count. My-30-Apps is the cleanest repo in the entire study at 21 issues across 62 files (0.34/file).

---

### Bolt.new-Built Repos

| Repo | Issues | Errors | Files Hit | Files Scanned | Issues/File |
|------|--------|--------|-----------|---------------|-------------|
| bolt-newsletter-supabase | 4 | 2 | 2/10 | 10 | 0.40 |
| EcoTrack | 30 | 0 | 12/21 | 21 | 1.43 |
| SkillSync | 75 | 0 | 11/23 | 23 | 3.26 |
| deslink | 64 | 0 | 16/26 | 26 | 2.46 |
| tracklance | 22 | 0 | 9/36 | 36 | 0.61 |
| **Bolt Total** | **195** | **2** | **50/116** | **116** | **1.68** |

**Top rules fired:**
- no-deep-nesting: 96
- no-ts-any: 41
- no-god-function: 28
- no-console-pollution: 19
- no-console-error-only: 6
- no-hardcoded-secrets: 1
- no-express-unhandled: 1
- no-error-info-leak: 1

**Largest god functions:**
- `Dashboard` (496 lines) in deslink
- `Web3ProviderV2` (452 lines) in deslink
- `Dashboard` (311 lines) in EcoTrack
- `NodeBrowser` (284 lines) in deslink
- `Profile` (243 lines) in EcoTrack

**Security findings:**
- 1x hardcoded secret (bolt-newsletter-supabase, a Supabase key in source)
- 1x error info leak to HTTP response (bolt-newsletter-supabase)
- 1x unhandled async Express route (bolt-newsletter-supabase)

**Notable:** Bolt repos are significantly smaller than Cursor and Lovable repos (116 files scanned vs 415 and 518). This pulls down their total issue count, but their issues-per-file ratio (1.68) is actually competitive. bolt-newsletter-supabase is only 10 files but has a hardcoded Supabase key and leaks error internals to HTTP responses. It's the smallest repo but has the most dangerous issues. Bolt's "one prompt" repos (tracklance) are surprisingly clean. deslink is the worst Bolt offender with a 496-line Dashboard component.

---

## Tool Comparison

### Aggregate Numbers

| Metric | Cursor | Lovable | Bolt |
|--------|--------|---------|------|
| Total issues | 1,003 | 1,062 | 195 |
| Total errors | 6 | 3 | 2 |
| Files scanned | 415 | 518 | 116 |
| Files with issues | 119 | 152 | 50 |
| % files with issues | 28.7% | 29.3% | 43.1% |
| Issues per file (all files) | 2.42 | 2.05 | 1.68 |
| Issues per affected file | 8.43 | 6.99 | 3.90 |

### Normalized: Issues Per File (all files scanned)

| Rank | Tool | Issues/File |
|------|------|-------------|
| 1 (worst) | Cursor | 2.42 |
| 2 | Lovable | 2.05 |
| 3 (best) | Bolt | 1.68 |

### But: % of Files Affected

| Rank | Tool | % Files Hit |
|------|------|-------------|
| 1 (worst) | Bolt | 43.1% |
| 2 | Lovable | 29.3% |
| 3 (best) | Cursor | 28.7% |

Bolt has fewer issues overall, but its issues are spread across a higher percentage of files. Cursor and Lovable concentrate their issues in fewer files (the ones that get big get really big).

### Rule Distribution by Tool

| Rule | Cursor | Lovable | Bolt | Total |
|------|--------|---------|------|-------|
| no-deep-nesting | 441 (44%) | 509 (48%) | 96 (49%) | 1,046 |
| no-console-pollution | 310 (31%) | 337 (32%) | 19 (10%) | 666 |
| no-ts-any | 126 (13%) | 64 (6%) | 41 (21%) | 231 |
| no-god-function | 63 (6%) | 61 (6%) | 28 (14%) | 152 |
| no-console-error-only | 37 (4%) | 29 (3%) | 6 (3%) | 72 |
| no-innerhtml | 5 (0.5%) | 10 (1%) | 0 (0%) | 15 |
| no-sql-concat | 6 (0.6%) | 0 (0%) | 0 (0%) | 6 |
| no-swallowed-promise | 3 (0.3%) | 0 (0%) | 0 (0%) | 3 |
| no-empty-catch | 0 (0%) | 2 (0.2%) | 0 (0%) | 2 |
| no-eval | 0 (0%) | 1 (0.1%) | 0 (0%) | 1 |
| no-hardcoded-secrets | 0 (0%) | 0 (0%) | 1 (0.5%) | 1 |
| no-error-info-leak | 0 (0%) | 0 (0%) | 1 (0.5%) | 1 |
| no-express-unhandled | 0 (0%) | 0 (0%) | 1 (0.5%) | 1 |

### Per-Tool Signatures

**Cursor's signature smell:** `no-ts-any` (13% of issues). Cursor generates TypeScript code that bypasses the type system more than the other tools. This probably reflects its agentic workflow where `any` is the fast path when the model isn't sure of the type.

**Lovable's signature smell:** `no-innerHTML` (present in 5 of 5 repos, 100% hit rate). Every single Lovable repo uses innerHTML or dangerouslySetInnerHTML. Plus the only eval() in the entire study. Lovable generates the most XSS-prone code.

**Bolt's signature smell:** Hardcoded secrets + error info leaks. Bolt was the only tool to ship a hardcoded API key and leak error details in HTTP responses. Small projects, dangerous defaults. Also, Bolt has the highest % of `no-god-function` relative to its total (14% vs 6% for the others), meaning a higher proportion of its issues are structural/architectural.

### The "God Function" Problem

All three tools produce absurdly large functions. The top 5 across all repos:

| Function | Lines | Repo | Tool |
|----------|-------|------|------|
| parser_write | 1,104 | gptme-webui | Lovable |
| FileManager | 859 | airpsx-frontend | Cursor |
| Desktop | 838 | airpsx-frontend | Cursor |
| Scheduler | 663 | airpsx-frontend | Cursor |
| LearnArticleRich | 594 | memory-chess | Cursor |

AI-generated code has no instinct to split things up. A human dev hits 100 lines and starts thinking about extraction. AI just keeps going.

### The Console Pollution Problem

no-console-pollution fires 666 times across 15 repos. This is the #2 rule overall. AI tools use console.log for debugging during generation and never clean up. Lovable and Cursor are equally guilty (31-32% of their issues). Bolt is better (10%), possibly because its smaller repos just have less code surface.

---

## Cleanest and Dirtiest Repos

### Top 3 Cleanest (issues per file)

| Rank | Repo | Tool | Issues/File | Notes |
|------|------|------|-------------|-------|
| 1 | My-30-Apps | Lovable | 0.34 | 30 small apps, each very simple |
| 2 | cursor-rules-todoapp | Cursor | 0.39 | Built with explicit .cursorrules constraints |
| 3 | bolt-newsletter-supabase | Bolt | 0.40 | Tiny app, but has hardcoded secret |

### Top 3 Dirtiest (issues per file)

| Rank | Repo | Tool | Issues/File | Notes |
|------|------|------|-------------|-------|
| 1 | airpsx-frontend | Cursor | 9.00 | "Almost no coding" = almost no review |
| 2 | lm_studio_big_rag_plugin | Cursor | 7.46 | Real tool with 27 stars |
| 3 | act-solo-ai | Lovable | 3.96 | 487 issues, 8MB of code |

---

## Key Takeaways for the Article

1. **All three tools produce structurally similar code smells.** Deep nesting is the #1 issue everywhere (46% of all issues). This is an AI generation problem, not a tool-specific one.

2. **Cursor repos are bigger and dirtier.** Cursor users build larger apps (415 files avg) and generate more issues per file (2.42). The IDE context probably encourages "just keep building" without pausing to refactor.

3. **Lovable has the worst security posture.** 100% innerHTML hit rate, the only eval(), and the single largest function (1,104 lines). Lovable's visual builder generates markup-heavy code that defaults to innerHTML.

4. **Bolt repos are small but dangerous in different ways.** Fewer issues overall, but hardcoded secrets and error leaks show that Bolt's "one prompt" workflow skips the security basics that even manual coding would catch.

5. **The cleanest code came from constrained prompts.** cursor-rules-todoapp (built with explicit .cursorrules) and My-30-Apps (30 tiny apps) are the cleanest. Constraints and small scope = better output.

6. **Nobody cleans up console.logs.** 666 instances across 15 repos. Every tool leaves debug logging in production code. This alone justifies running a linter on AI output.

7. **God functions are universal.** 152 functions over 80 lines. The median large function is ~300 lines. AI does not know when to stop writing a function and extract.

8. **vibecheck caught real security bugs.** SQL injection (Cursor), eval (Lovable), hardcoded secrets (Bolt), XSS vectors (all three). These aren't style nits. These would fail a security review.

---

## Raw Scan Files

All scan outputs saved to `/tmp/article-scans/{repo-name}.scan.txt` for reference.
