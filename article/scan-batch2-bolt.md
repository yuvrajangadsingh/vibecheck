# vibecheck Scan Results: Bolt.new Batch 2

Scanned 5 additional Bolt.new-built repos using vibecheck v1.5.0 with `--severity warn`.
These are in addition to the 5 Bolt repos from batch 1 (bolt-newsletter-supabase, EcoTrack, SkillSync, deslink, tracklance).

---

## Per-Repo Results

### 1. empowHR (californias66/empowHR)

- **Description:** HR AI agentic system. Built with Bolt.new, Cline, Cursor, StackBlitz.
- **Stars:** 6
- **Language:** TypeScript

| Metric | Value |
|--------|-------|
| Total issues | 12 |
| Errors | 0 |
| Files with issues | 6/26 (23%) |
| Issues/file | 0.46 |

**Rule breakdown:**
- no-ts-any: 6
- no-deep-nesting: 3
- no-console-pollution: 3

**Notes:** Cleanest repo in this batch. No god functions, no security issues. The 6 `any` types are concentrated in NodeGraph.tsx (graph visualization component). 3 console.logs scattered across page components. Hybrid build (Bolt + Cursor + Cline) may explain the relative cleanliness, as multiple tools were used to iterate.

---

### 2. JavaBOLT (hardik44ss/JavaBOLT)

- **Description:** AI-powered Java learning platform with interactive mentor, coding challenges, lessons.
- **Stars:** 1
- **Language:** TypeScript (React)

| Metric | Value |
|--------|-------|
| Total issues | 42 |
| Errors | 0 |
| Files with issues | 3/12 (25%) |
| Issues/file | 3.50 |

**Rule breakdown:**
- no-deep-nesting: 42

**Notes:** Every single issue is deep nesting. Zero type safety issues, zero console pollution. But LessonViewer.tsx is 1,076 lines, the largest single file in both Bolt batches combined. It hits nesting depth 8 in three places. The entire component is one massive render function with deeply nested conditional JSX. This is a textbook case of AI generating a monolithic component that renders all lesson types (video, code, quiz, reading) in one file with nested ternaries and conditionals. vibecheck doesn't flag it as a god function because the nesting rule fires first, but the real problem is structural: this should be 5-6 separate components.

**Largest files:**
- LessonViewer.tsx: 1,076 lines
- Dashboard.tsx: 329 lines
- Mentor.tsx: 308 lines
- CodingChallenge.tsx: 279 lines

---

### 3. MindMate (GPSNawamina/MindMate)

- **Description:** AI wellness app with voice emotion detection, AI coach, video responses. Built with Bolt.new, Hume AI, ElevenLabs, Tavus, Supabase.
- **Stars:** 1
- **Language:** TypeScript (React)

| Metric | Value |
|--------|-------|
| Total issues | 24 |
| Errors | 0 |
| Files with issues | 7/18 (39%) |
| Issues/file | 1.33 |

**Rule breakdown:**
- no-deep-nesting: 12
- no-ts-any: 5
- no-god-function: 1 (App: 112 lines)
- no-console-pollution: 1
- no-console-error-only: 1

**Notes:** Issues spread across 39% of files, the highest affected-file percentage in this batch. The supabase.ts config file has 4 `any` types, all on function return types for database queries. The App.tsx god function (112 lines) stuffs routing, auth state, and layout into one component. ChatInterface.tsx has a catch block that only console.errors without rethrowing, meaning AI chat failures silently disappear. 8 of the 12 deep nesting hits come from tailwind.config.js (nested theme extensions), which is more of a config pattern than a code smell.

---

### 4. github-actions-analyzer (ajndkr/github-actions-analyzer)

- **Description:** CSV analyzer for GitHub Actions usage optimization and cost insights.
- **Stars:** 1
- **Language:** TypeScript (React + Recharts)

| Metric | Value |
|--------|-------|
| Total issues | 23 |
| Errors | 0 |
| Files with issues | 5/15 (33%) |
| Issues/file | 1.53 |

**Rule breakdown:**
- no-deep-nesting: 16
- no-ts-any: 6
- no-god-function: 1 (App: 118 lines)

**Notes:** The 6 `any` types are split between WorkflowChart.tsx (5, used for Recharts data types) and dataProcessing.ts (1, CSV row typing). Bolt generated the chart component with `any`-typed data accessors instead of creating proper interfaces for the workflow data. App.tsx at 118 lines is another monolithic component that handles file upload state, data processing, and rendering all in one place. No console pollution at all, which is unusual for Bolt.

---

### 5. commitrank (waynesutton/commitrank)

- **Description:** Rank any GitHub profile. Built with Convex.dev, TanStack on Bolt.new.
- **Stars:** 2
- **Language:** TypeScript (React + Convex)

| Metric | Value |
|--------|-------|
| Total issues | 33 |
| Errors | 0 |
| Files with issues | 7/25 (28%) |
| Issues/file | 1.32 |

**Rule breakdown:**
- no-console-pollution: 10
- no-deep-nesting: 8
- no-ts-any: 9
- no-god-function: 2 (App: 820 lines, ProfileCard: 171 lines)
- no-console-error-only: 1

**Notes:** App.tsx is 820 lines, making it the largest god function across all 10 Bolt repos scanned. The entire app (search, results, leaderboard, animations) lives in one component. This is the most extreme case of Bolt's "single file" tendency. The 9 `any` types are concentrated in the Convex backend (github.ts), all on API response handling where Bolt didn't generate proper types for GitHub's API data. 10 console.logs in the Convex functions (profiles.ts, scores.ts), all debug logging that was never cleaned up. ProfileCard at 171 lines is the second god function.

**Largest files:**
- App.tsx: 855 lines
- dis.ts: 358 lines (utility)
- ProfileCard.tsx: 350 lines

---

## Batch 2 Aggregate

| Repo | Issues | Errors | Files Hit | Files Scanned | Issues/File |
|------|--------|--------|-----------|---------------|-------------|
| empowHR | 12 | 0 | 6/26 | 26 | 0.46 |
| JavaBOLT | 42 | 0 | 3/12 | 12 | 3.50 |
| MindMate | 24 | 0 | 7/18 | 18 | 1.33 |
| github-actions-analyzer | 23 | 0 | 5/15 | 15 | 1.53 |
| commitrank | 33 | 0 | 7/25 | 25 | 1.32 |
| **Batch 2 Total** | **134** | **0** | **28/96** | **96** | **1.40** |

### Rule Distribution (Batch 2)

| Rule | Count | % |
|------|-------|---|
| no-deep-nesting | 81 | 60.4% |
| no-ts-any | 26 | 19.4% |
| no-console-pollution | 14 | 10.4% |
| no-god-function | 4 | 3.0% |
| no-console-error-only | 2 | 1.5% |

### Security findings: None

Zero security issues in batch 2. No hardcoded secrets, no innerHTML/XSS, no eval, no SQL injection. This is a notable contrast to batch 1, which had a hardcoded Supabase key, error info leaks, and an unhandled Express route.

---

## Combined Bolt Results (Batch 1 + Batch 2)

| Metric | Batch 1 (5 repos) | Batch 2 (5 repos) | Combined (10 repos) |
|--------|-------------------|-------------------|---------------------|
| Total issues | 195 | 134 | 329 |
| Total errors | 2 | 0 | 2 |
| Files scanned | 116 | 96 | 212 |
| Files with issues | 50 | 28 | 78 |
| % files with issues | 43.1% | 29.2% | 36.8% |
| Issues per file | 1.68 | 1.40 | 1.55 |

### Combined Rule Distribution (all 10 Bolt repos)

| Rule | Count | % |
|------|-------|---|
| no-deep-nesting | 177 | 53.8% |
| no-ts-any | 67 | 20.4% |
| no-console-pollution | 33 | 10.0% |
| no-god-function | 32 | 9.7% |
| no-console-error-only | 8 | 2.4% |
| no-hardcoded-secrets | 1 | 0.3% |
| no-express-unhandled | 1 | 0.3% |
| no-error-info-leak | 1 | 0.3% |

### God Functions (all 10 Bolt repos, sorted by size)

| Function | Lines | Repo | Batch |
|----------|-------|------|-------|
| App | 820 | commitrank | 2 |
| Dashboard | 496 | deslink | 1 |
| Web3ProviderV2 | 452 | deslink | 1 |
| Dashboard | 311 | EcoTrack | 1 |
| NodeBrowser | 284 | deslink | 1 |
| Profile | 243 | EcoTrack | 1 |
| ProfileCard | 171 | commitrank | 2 |
| App | 118 | github-actions-analyzer | 2 |
| App | 112 | MindMate | 2 |

Note: JavaBOLT's LessonViewer.tsx (1,076 lines) is not in this list because vibecheck fired no-deep-nesting on it instead of no-god-function (the rules don't double-count). But it's the single largest file across all 10 Bolt repos.

### Key Patterns from 10 Repos

1. **Deep nesting is dominant (54% of all issues).** Consistent with batch 1. Bolt generates nested JSX with conditionals and never flattens.

2. **`any` type usage is the #2 smell (20%).** Bolt doesn't generate TypeScript interfaces for external API responses (GitHub API, Supabase, Recharts). It uses `any` as a shortcut wherever the data shape isn't immediately obvious from the prompt.

3. **Console pollution runs at ~10%.** Lower than Cursor (31%) and Lovable (32%) from the main study. Bolt generates less debug logging, possibly because its one-shot generation doesn't iterate as much.

4. **God functions are structural.** 820-line App.tsx (commitrank), 1,076-line LessonViewer (JavaBOLT). Bolt puts everything in one file. The "one prompt" workflow doesn't naturally produce component decomposition.

5. **No security issues in batch 2.** The hardcoded secret and info leak from batch 1 (bolt-newsletter-supabase) may have been a Supabase-specific pattern rather than a Bolt-wide one.

6. **Hybrid builds are cleaner.** empowHR (Bolt + Cursor + Cline) had the fewest issues (12). Multiple tool iterations likely caught issues that single-tool builds missed.

---

## Raw Scan Files

All scan outputs saved to `/tmp/article-scans/{repo-name}.scan.txt`.

Repos cloned to `/tmp/article-scans/{repo-name}/`.
