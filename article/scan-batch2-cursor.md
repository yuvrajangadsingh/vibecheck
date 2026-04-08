# vibecheck Scan Batch 2: Cursor-Built Repos

Scanned 5 more Cursor-built repos using vibecheck v1.5.0 with `--severity warn`.

These repos were selected specifically because their descriptions or READMEs explicitly state they were built with Cursor AI. Range from 3 to 1,130 stars, covering a web OS, tower defense game, pixel art app, kanban board, and medical imaging tool.

---

## Per-Repo Results

### 1. ryokun6/ryos (1,130 stars)

"ryOS, made with Cursor" - a macOS-like web operating system with apps (music, chat, karaoke, finder, etc.)

| Metric | Value |
|--------|-------|
| Issues | 4,523 |
| Errors | 52 |
| Files with issues | 378/764 |
| Issues/file | 5.92 |

**Rule breakdown:**
| Rule | Count |
|------|-------|
| no-deep-nesting | 3,343 |
| no-console-pollution | 671 |
| no-god-function | 269 |
| no-console-error-only | 151 |
| no-empty-catch | 35 |
| no-swallowed-promise | 19 |
| no-innerhtml | 12 |
| no-error-info-leak | 11 |
| no-sql-concat | 6 |
| no-ts-any | 5 |
| no-stub-function | 1 |

**Largest god functions:**
| Function | Lines | File |
|----------|-------|------|
| MacDock | 2,003 | src/apps/dock |
| useIpodLogic | 1,891 | src/apps/ipod |
| useKaraokeLogic | 1,798 | src/apps/karaoke |
| WindowFrame | 1,606 | src/components |
| useFinderLogic | 1,507 | src/apps/finder |
| WordTimingHighlight | 351 | src/apps/karaoke |
| WinampAppComponent | 285 | src/apps/winamp |

**Security findings (52 errors):**
- 35x empty catch blocks (errors swallowed silently or with TODO comments)
- 11x error internals leaked to HTTP responses (listen session API endpoints)
- 6x SQL queries built with string concatenation
- 19x swallowed promises (.then() without .catch())
- 12x innerHTML/dangerouslySetInnerHTML

**Deepest nesting:** 13 levels deep in `src/apps/chats/components/ChatMessages.tsx`

**Notes:** The single dirtiest repo in the entire study (batch 1 + batch 2 combined). 4,523 issues in 764 files. Five functions over 1,500 lines. MacDock at 2,003 lines is the largest function vibecheck has ever flagged across all scans. The error info leaks are all in the `/api/listen/sessions/` endpoints, meaning real user-facing API routes are returning raw error objects. The SQL concat issues mean potential injection in a production web app with 1,130 stars.

---

### 2. maciej-trebacz/tower-of-time-game (368 stars)

"Vibe coded Tower Defense type of game made for a game jam"

| Metric | Value |
|--------|-------|
| Issues | 572 |
| Errors | 0 |
| Files with issues | 40/43 |
| Issues/file | 13.30 |

**Rule breakdown:**
| Rule | Count |
|------|-------|
| no-console-pollution | 359 |
| no-deep-nesting | 128 |
| no-ts-any | 63 |
| no-god-function | 13 |
| no-console-error-only | 9 |

**Largest god functions:**
| Function | Lines |
|----------|-------|
| updatePathfinding | 116 |
| setupTutorialEventHandlers | 111 |
| update (EnemyManager) | 101 |
| update (scene) | 89 |
| makeEnemyPathfindToPlayer | 86 |

**Security findings:** None.

**Notes:** Zero errors, but 93% of files have issues (40/43), the highest hit rate in the batch. The dominant smell is console.log (359 instances, 63% of all issues). This is a game jam project, so the console pollution makes sense: rapid debug logging during a time-limited build, never cleaned up. The `any` count (63) is also notable for a 43-file project. Structurally cleaner than ryos (no security issues, smaller functions), but every file is touched.

---

### 3. ofershap/cursor-office (37 stars)

"A living pixel art office for your Cursor AI agent"

| Metric | Value |
|--------|-------|
| Issues | 52 |
| Errors | 4 |
| Files with issues | 8/17 |
| Issues/file | 3.06 |

**Rule breakdown:**
| Rule | Count |
|------|-------|
| no-deep-nesting | 28 |
| no-console-pollution | 9 |
| no-py-print | 7 |
| no-god-function | 4 |
| no-empty-catch | 4 |

**Largest god functions:**
| Function | Lines |
|----------|-------|
| createRoomba | 149 |
| renderOffice | 107 |
| createWindow | 100 |
| createCat | 95 |

**Security findings (4 errors):**
- 4x empty catch blocks in cursorWatcher.ts and objects.ts

**Notes:** Smallest repo in the batch. The 4 god functions (createRoomba, renderOffice, createWindow, createCat) map directly to the pixel art entities, each generated as a single monolithic function. The empty catches in cursorWatcher.ts are concerning since that's the module that watches the Cursor AI agent's activity. The Python test file (test-visual.py) has 7 print() statements.

---

### 4. drenlia/easy-kanban (26 stars)

"Simple and easy Kanban web application built with React TS (with Cursor AI)"

| Metric | Value |
|--------|-------|
| Issues | 3,300 |
| Errors | 15 |
| Files with issues | 173/235 |
| Issues/file | 14.04 |

**Rule breakdown:**
| Rule | Count |
|------|-------|
| no-deep-nesting | 1,476 |
| no-console-pollution | 977 |
| no-ts-any | 490 |
| no-console-error-only | 215 |
| no-god-function | 89 |
| no-express-unhandled | 19 |
| no-innerhtml | 15 |
| no-sql-concat | 6 |
| no-error-info-leak | 7 |
| no-swallowed-promise | 4 |
| no-empty-catch | 2 |

**Largest god functions:**
| Function | Lines | File |
|----------|-------|------|
| AppContent | 3,579 | src/components |
| TaskCard | 2,174 | src/components |
| ListView | 1,753 | src/components/ListView.tsx |
| TaskPage | 1,744 | src/components |
| TaskDetails | 1,044 | src/components |
| useVirtualViewport | 726 | src/hooks |
| useTaskDetails | 638 | src/hooks |
| createDailyTaskSnapshots | 363 | server/jobs |
| wrapQuery | 265 | server |

**Security findings (15 errors):**
- 7x error internals leaked to HTTP responses
- 6x SQL queries built with string concatenation
- 2x empty catch blocks
- 19x unhandled async Express routes (no error middleware)
- 15x innerHTML/dangerouslySetInnerHTML
- 4x swallowed promises

**Deepest nesting:** 13 levels deep in `src/components/ListView.tsx`

**Notes:** The highest issues-per-file ratio in the entire study at 14.04. A "simple kanban" app has AppContent at 3,579 lines, the largest function ever scanned. 490 uses of TypeScript `any`, the most across all batches. The server-side is particularly bad: 19 unhandled async Express routes (any thrown error crashes the server), 6 SQL injection vectors, and 7 error info leaks. This is the most comprehensive example of what happens when you vibe-code a full-stack app with no review.

---

### 5. sadimanna/MedicalImageViewer (3 stars)

"A Simple Medical Image Viewer App made with Cursor using Vite + React + TS"

| Metric | Value |
|--------|-------|
| Issues | 84 |
| Errors | 0 |
| Files with issues | 16/25 |
| Issues/file | 3.36 |

**Rule breakdown:**
| Rule | Count |
|------|-------|
| no-deep-nesting | 40 |
| no-console-pollution | 29 |
| no-ts-any | 8 |
| no-god-function | 7 |

**Largest god functions:**
| Function | Lines |
|----------|-------|
| VTKVolumeRenderer3D | 314 |
| MedicalVolumeViewer | 159 |
| VolumeDebugger | 118 |
| VTKTest | 117 |
| useVolumeRenderer | 105 |
| loadNumPyFile | 95 |
| App | 102 |

**Security findings:** None.

**Notes:** Cleanest in the batch. Zero errors, 84 warnings across 25 files. The god functions make sense in context (VTK/medical rendering components are inherently complex), but 7 components over 80 lines in a 25-file app means every major component exceeds the threshold. The 29 console.logs are debug output from a rendering pipeline. Relatively well-structured for a Cursor-built app.

---

## Batch 2 Aggregate

| Metric | ryos | tower-of-time | cursor-office | easy-kanban | MedicalImageViewer | Total |
|--------|------|---------------|---------------|-------------|---------------------|-------|
| Stars | 1,130 | 368 | 37 | 26 | 3 | 1,564 |
| Issues | 4,523 | 572 | 52 | 3,300 | 84 | 8,531 |
| Errors | 52 | 0 | 4 | 15 | 0 | 71 |
| Files scanned | 764 | 43 | 17 | 235 | 25 | 1,084 |
| Files with issues | 378 | 40 | 8 | 173 | 16 | 615 |
| % files hit | 49.5% | 93.0% | 47.1% | 73.6% | 64.0% | 56.7% |
| Issues/file | 5.92 | 13.30 | 3.06 | 14.04 | 3.36 | 7.87 |

### Rule totals (batch 2):

| Rule | Count | % of total |
|------|-------|-----------|
| no-deep-nesting | 5,015 | 58.8% |
| no-console-pollution | 2,045 | 24.0% |
| no-ts-any | 566 | 6.6% |
| no-console-error-only | 375 | 4.4% |
| no-god-function | 382 | 4.5% |
| no-empty-catch | 41 | 0.5% |
| no-innerhtml | 27 | 0.3% |
| no-swallowed-promise | 23 | 0.3% |
| no-express-unhandled | 19 | 0.2% |
| no-error-info-leak | 18 | 0.2% |
| no-sql-concat | 12 | 0.1% |
| no-py-print | 7 | 0.1% |
| no-stub-function | 1 | 0.0% |

---

## Combined Cursor Stats (Batch 1 + Batch 2)

Batch 1 Cursor repos: ai-monorepo-scaffold, airpsx-frontend, memory-chess, lm_studio_big_rag_plugin, cursor-rules-todoapp
Batch 2 Cursor repos: ryos, tower-of-time-game, cursor-office, easy-kanban, MedicalImageViewer

| Metric | Batch 1 (5 repos) | Batch 2 (5 repos) | Combined (10 repos) |
|--------|-------------------|-------------------|---------------------|
| Issues | 1,003 | 8,531 | 9,534 |
| Errors | 6 | 71 | 77 |
| Files scanned | 415 | 1,084 | 1,499 |
| Files with issues | 119 | 615 | 734 |
| % files hit | 28.7% | 56.7% | 49.0% |
| Issues/file (all) | 2.42 | 7.87 | 6.36 |

Batch 2 is significantly worse than batch 1. This is partly because batch 2 includes larger repos (ryos at 764 files, easy-kanban at 235), but the issues-per-file ratio (7.87 vs 2.42) shows that bigger Cursor projects accumulate more code smells per file, not fewer. The problems compound with scale.

---

## Key Findings (Batch 2)

1. **Scale makes it worse.** Batch 1's average was 2.42 issues/file. Batch 2 is 7.87. Larger Cursor projects don't just have more issues, they have proportionally more per file. AI-generated code doesn't self-organize at scale.

2. **The 3,000+ line function is real.** easy-kanban's AppContent is 3,579 lines. ryos has MacDock at 2,003 and useIpodLogic at 1,891. These make batch 1's 859-line FileManager look modest. Cursor (or the models behind it) will happily put an entire app's logic in a single function.

3. **Console.log is the default debugging strategy.** 2,045 console.log instances across 5 repos. tower-of-time-game has 359 in 43 files (8.3 per file). Nobody cleans up after the AI.

4. **SQL injection in production web apps.** Both ryos (1,130 stars) and easy-kanban (26 stars) have SQL concatenation. ryos is a functioning web app with API endpoints. These aren't toy projects anymore.

5. **Error info leaks are systemic.** ryos leaks error internals in 11 API endpoints (all in the listen session routes). easy-kanban leaks in 7. The pattern: `res.status(500).json({ error: err.message })` or worse, `res.status(500).json(error)`. This exposes stack traces, database errors, and internal paths to users.

6. **easy-kanban is the worst repo across both batches.** 14.04 issues/file, 3,579-line function, 490 `any` types, 19 unhandled Express routes, 6 SQL injections, 15 innerHTML usages. A "simple kanban" that is a security and maintenance disaster.

7. **MedicalImageViewer is the only clean one.** 84 issues, 0 errors, reasonable structure. It's also the smallest (25 files) and most domain-specific. Cursor does fine when the scope is narrow and technical.

---

## Raw Scan Files

All outputs saved to `/tmp/article-scans/{repo-name}.scan.txt`.
