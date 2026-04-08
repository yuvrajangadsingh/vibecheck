# vibecheck Scan Results: Lovable Batch 2

Scanned 5 additional Lovable-built repos using vibecheck v1.5.0 with `--severity warn`.

All repos confirmed Lovable-built via GPT_ENGINEER_TRIGGER markers, lovable-tagger in package.json, or explicit "built with Lovable" in description/README.

---

## Per-Repo Results

| Repo | Stars | Description | Issues | Errors | Files Hit | Files Scanned | Issues/File |
|------|-------|-------------|--------|--------|-----------|---------------|-------------|
| PitchPerfect-AI | 0 | AI-powered pitch practice app (Capacitor mobile + web) | 1,150 | 8 | 165/404 | 404 | 2.85 |
| zakah | 4 | Zakat calculator with MCP server, ChatGPT widget, web app | 963 | 12 | 184/418 | 418 | 2.30 |
| smarttext-connect | 0 | SMS/text automation for businesses | 423 | 0 | 55/160 | 160 | 2.64 |
| brand-zen | 0 | Real-time brand monitoring MVP | 1,093 | 0 | 134/241 | 241 | 4.53 |
| promptzy | 75 | PWA prompt manager with Supabase + Electron | 110 | 4 | 13/80 | 80 | 1.38 |
| humanise-ai | 3 | AI text humanizer/detector | 31 | 0 | 6/65 | 65 | 0.48 |
| **Batch 2 Total** | | | **3,770** | **24** | **557/1,368** | **1,368** | **2.76** |

Note: humanise-ai (31 issues in 65 files) is the cleanest Lovable repo scanned. promptzy (75 stars, highest in this batch) is second cleanest. brand-zen is the dirtiest at 4.53 issues/file.

---

## Rule Distribution

| Rule | PitchPerfect-AI | zakah | smarttext-connect | brand-zen | promptzy | humanise-ai | Total |
|------|-----------------|-------|-------------------|-----------|----------|-------------|-------|
| no-deep-nesting | 497 | 533 | 117 | 529 | 32 | 27 | 1,735 |
| no-console-pollution | 397 | 210 | 224 | 184 | 54 | 2 | 1,071 |
| no-ts-any | 133 | 62 | 31 | 233 | 6 | 0 | 465 |
| no-god-function | 44 | 118 | 36 | 118 | 10 | 1 | 327 |
| no-console-error-only | 64 | 23 | 13 | 23 | 0 | 0 | 123 |
| no-empty-catch | 6 | 7 | 0 | 0 | 0 | 0 | 13 |
| no-swallowed-promise | 4 | 0 | 0 | 4 | 3 | 0 | 11 |
| no-innerhtml | 3 | 4 | 2 | 2 | 1 | 1 | 13 |
| no-sql-concat | 0 | 3 | 0 | 0 | 4 | 0 | 7 |
| no-hardcoded-secrets | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| no-eval | 0 | 2 | 0 | 0 | 0 | 0 | 2 |
| no-express-unhandled | 0 | 1 | 0 | 0 | 0 | 0 | 1 |

Top 3 rules account for 87% of all issues (3,271 of 3,770).

---

## Largest God Functions

| Function | Lines | Repo | What it is |
|----------|-------|------|------------|
| SettingsPage | 1,810 | brand-zen | Single page component with all settings UI |
| FetchLogsModal | 1,060 | brand-zen | Modal for viewing fetch logs |
| SentimentWorkerMonitoring | 904 | brand-zen | Sentiment analysis monitoring dashboard |
| ModeratorPanelSimple | 900 | brand-zen | Moderation panel UI |
| QueueErrorMonitoring | 852 | brand-zen | Error queue monitoring dashboard |
| Methodology | 662 | zakah | Zakat methodology configuration page |
| useDonationPersistence | 599 | zakah | Hook for persisting donations |
| InteractiveDemo | 542 | zakah | Interactive demo component |
| Demo | 527 | PitchPerfect-AI | Demo/onboarding page |
| useSavedCalculations | 478 | zakah | Hook for saved calculation state |

brand-zen has the single largest function in the entire study (both batches): SettingsPage at 1,810 lines. It also has 5 of the top 10 largest functions.

---

## Security Findings (Errors)

### PitchPerfect-AI (8 errors)
- **6x empty catch blocks** (errors swallowed silently, some with only TODO comments)
- **2x hardcoded secrets** in `tests/auth/session-management.spec.ts` (test file, but still committed to repo)

### zakah (12 errors)
- **7x empty catch blocks** (mix of empty and TODO-only catches)
- **3x SQL injection** via string concatenation in `supabase/functions/mcp-gateway/index.ts`
- **2x eval()** in e2e test files (`calculation-smoke.spec.ts`, `deep-link-rendering.spec.ts`)

### promptzy (4 errors)
- **4x SQL injection** via string concatenation in `src/components/AIAssistant.tsx` (AI-generated SQL queries built with template literals)

### smarttext-connect (0 errors)
No error-severity findings.

### brand-zen (0 errors)
No error-severity findings. But 1,093 warnings in 241 files.

### humanise-ai (0 errors)
Cleanest repo. 31 warnings total.

---

## innerHTML/XSS Pattern

Every single repo in this batch has at least one innerHTML/dangerouslySetInnerHTML usage:
- PitchPerfect-AI: 3
- zakah: 4
- smarttext-connect: 2
- brand-zen: 2
- promptzy: 1
- humanise-ai: 1

This confirms the batch 1 finding: 100% of Lovable repos use innerHTML. Across both batches, 10 out of 10 Lovable repos have innerHTML. This is Lovable's signature code smell.

---

## Comparison with Batch 1

| Metric | Batch 1 (5 repos) | Batch 2 (6 repos) | Combined (11 repos) |
|--------|-------------------|-------------------|---------------------|
| Total issues | 1,062 | 3,770 | 4,832 |
| Total errors | 3 | 24 | 27 |
| Files scanned | 518 | 1,368 | 1,886 |
| Files with issues | 152 | 557 | 709 |
| % files with issues | 29.3% | 40.7% | 37.6% |
| Issues/file (all) | 2.05 | 2.76 | 2.56 |
| innerHTML hit rate | 5/5 (100%) | 6/6 (100%) | 11/11 (100%) |

Batch 2 is dirtier than batch 1 on average. The larger apps (brand-zen, PitchPerfect-AI, zakah) push the numbers up. Smaller apps (humanise-ai, promptzy) are significantly cleaner.

---

## Updated Rule Distribution (All 11 Lovable Repos)

| Rule | Batch 1 | Batch 2 | Total | % |
|------|---------|---------|-------|---|
| no-deep-nesting | 509 | 1,735 | 2,244 | 46.4% |
| no-console-pollution | 337 | 1,071 | 1,408 | 29.1% |
| no-ts-any | 64 | 465 | 529 | 10.9% |
| no-god-function | 61 | 327 | 388 | 8.0% |
| no-console-error-only | 29 | 123 | 152 | 3.1% |
| no-innerhtml | 10 | 13 | 23 | 0.5% |
| no-empty-catch | 2 | 13 | 15 | 0.3% |
| no-swallowed-promise | 0 | 11 | 11 | 0.2% |
| no-ts-any | - | - | - | - |
| no-sql-concat | 0 | 7 | 7 | 0.1% |
| no-eval | 1 | 2 | 3 | 0.06% |
| no-hardcoded-secrets | 0 | 2 | 2 | 0.04% |
| no-express-unhandled | 0 | 1 | 1 | 0.02% |

---

## Key Findings for the Article

1. **Lovable's innerHTML habit is confirmed at scale.** 11/11 repos, 100% hit rate. No other tool in the study comes close. Lovable generates markup-heavy code that defaults to innerHTML for dynamic content rendering.

2. **The "god function" problem scales with app size.** brand-zen's SettingsPage (1,810 lines) is the new record-holder, beating batch 1's parser_write (1,104 lines). As Lovable apps grow, components don't get split, they just keep growing.

3. **console.log cleanup is nonexistent.** 1,408 console.log instances across 11 repos. Lovable uses console.log during generation for debugging and never cleans up.

4. **Small Lovable apps are surprisingly clean.** humanise-ai (0.48 issues/file) is cleaner than anything in the Cursor or Bolt batches. promptzy (1.38/file) is also respectable. The pattern: small scope = fewer problems.

5. **zakah is the most "complete" Lovable app scanned** (MCP server + ChatGPT widget + web app + e2e tests). It has SQL injection in its Supabase functions and eval() in its e2e tests. Real app, real security issues.

6. **PitchPerfect-AI committed a full duplicate of its own repo inside itself.** The original clone had 2,248 issues in 793 files, which was exactly double the real count. Nobody noticed because nobody reviews AI-generated repo structure.

7. **promptzy has SQL injection in its AI-generated code.** The AIAssistant.tsx component builds SQL queries with template literals. This is Lovable generating code that talks to Supabase, building queries unsafely.

---

## All God Functions > 300 Lines (Both Batches)

| Function | Lines | Repo | Batch |
|----------|-------|------|-------|
| SettingsPage | 1,810 | brand-zen | 2 |
| parser_write | 1,104 | gptme-webui | 1 |
| FetchLogsModal | 1,060 | brand-zen | 2 |
| SentimentWorkerMonitoring | 904 | brand-zen | 2 |
| ModeratorPanelSimple | 900 | brand-zen | 2 |
| QueueErrorMonitoring | 852 | brand-zen | 2 |
| Methodology | 662 | zakah | 2 |
| useDonationPersistence | 599 | zakah | 2 |
| InteractiveDemo | 542 | zakah | 2 |
| useSpeechRecognition | 528 | act-solo-ai | 1 |
| Demo | 527 | PitchPerfect-AI | 2 |
| DoseTimeline | 498 | vigil-mvp | 1 |
| useSavedCalculations | 478 | zakah | 2 |
| PracticeWithRehearsal | 474 | act-solo-ai | 1 |
| DocumentUpload | 463 | zakah | 2 |
| runTests | 454 | smarttext-connect | 2 |
| useConversation | 429 | gptme-webui | 1 |
| Index | 421 | PitchPerfect-AI | 2 |
| Index | 419 | promptzy | 2 |
| Signup | 388 | PitchPerfect-AI | 2 |
| Settings | 381 | smarttext-connect | 2 |
| Login | 354 | PitchPerfect-AI | 2 |
| AIAssistant | 351 | promptzy | 2 |
| TrialActivationForm | 317 | smarttext-connect | 2 |
| Dashboard | 311 | PitchPerfect-AI | 2 |

25 functions over 300 lines across 11 Lovable repos. brand-zen alone accounts for 5 of the top 6.

---

## Discarded Candidate: LovaBolt

Initially scanned LovaBolt (Nether403/LovaBolt). It reported 9,706 issues in 2,091 files, but 92% came from `react-bits/dist/` (a third-party animation library committed to the repo with full dist output). Only 110 source files had issues. Replaced with smarttext-connect for cleaner data.

The fact that a Lovable repo committed an entire third-party library's dist/ folder is itself a finding: AI-generated repos don't have sensible .gitignore patterns, and nobody reviews what goes into the repo.

---

## Raw Scan Files

All scan outputs saved to `/tmp/article-scans/{repo-name}.scan.txt`.
