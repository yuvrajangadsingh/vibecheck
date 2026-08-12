import { readFileSync, statSync } from 'node:fs';
import { relative, extname } from 'node:path';
import fg from 'fast-glob';
import { allRules, allMultilineRules } from './rules/index.js';
import { maskLines } from './lexer.js';
import { parseSuppressions, isSuppressed } from './suppressions.js';
import type { Config, Finding, ScanResult, Severity, SkippedFile} from './types.js';
import { mapOldLine, hunkIndexForNewLine } from './diff.js';
import type { DiffMap, Hunk } from './diff.js';
import { findingFingerprint } from './fingerprint.js';

const MAX_FILE_SIZE = 1_000_000; // 1MB
const VALID_SEVERITIES: Severity[] = ['error', 'warn', 'info'];

function getLanguage(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase();
  // .mts/.cts are TypeScript; map them so the ts rules actually run on them.
  if (ext === 'mts' || ext === 'cts') return 'ts';
  return ext;
}

// JavaScript MIME type essences per the WHATWG MIME Sniffing Standard, which
// HTML uses for the script[type] essence match. `module` is a special value,
// and an absent/empty type is a classic script.
const JS_SCRIPT_TYPES = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript',
  'application/x-javascript', 'text/ecmascript', 'text/javascript',
  'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5',
  'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);

const isNameDelim = (ch: string | undefined) => ch === undefined || /[\s/>]/.test(ch);

function scriptIsJs(tagInner: string): boolean {
  // src= makes it external; attribute names are tokenized (start-or-space
  // anchored) so data-src / data-type never match the bare attributes.
  if (/(?:^|\s)src\s*=/i.test(tagInner)) return false;
  const typeMatch = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagInner);
  if (!typeMatch) return true; // no type → classic script
  const essence = (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3]).split(';')[0].trim().toLowerCase();
  return essence === '' || essence === 'module' || JS_SCRIPT_TYPES.has(essence);
}

/**
 * Reduce an HTML document to its inline JavaScript: every char outside an
 * inline JS `<script>` body is blanked to a space, newlines preserved, so
 * finding line/column numbers and suppression comments map 1:1 onto the
 * original file. A small tag-aware pass (not a regex) handles the traps:
 * `<!-- ... -->` comments are skipped (a `<script>` inside a comment is not a
 * script); the opening tag is parsed with quote awareness so `>` inside an
 * attribute value does not end it early; `<script` must be followed by a name
 * delimiter (so `<script-foo>` is not a script); and the body ends only at a
 * real `</script` + delimiter (not `</scripture>`). External (`src=`) and
 * non-JS (`application/json`, importmap, …) scripts are skipped.
 */
export function extractInlineScripts(content: string): string {
  const n = content.length;
  const out: string[] = new Array(n);
  for (let k = 0; k < n; k++) out[k] = content[k] === '\n' ? '\n' : ' ';
  const lower = content.toLowerCase();

  let i = 0;
  while (i < n) {
    if (lower.startsWith('<!--', i)) {                 // HTML comment: skip it entirely
      const end = content.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (!(lower.startsWith('<script', i) && isNameDelim(content[i + 7]))) { i++; continue; }

    // Parse the opening tag, honoring quotes, up to the terminating '>'.
    let j = i + 7;
    let quote = '';
    while (j < n) {
      const ch = content[j];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    if (j >= n) { i = n; break; }                      // unterminated opening tag
    const tagInner = content.slice(i + 7, j);
    const bodyStart = j + 1;
    const selfClosing = content[j - 1] === '/';

    // Find the matching </script + name delimiter.
    let bodyEnd = n, closeEnd = n;
    let k = bodyStart;
    while (k < n) {
      const idx = lower.indexOf('</script', k);
      if (idx === -1) break;
      if (isNameDelim(content[idx + 8])) {
        let m = idx + 8;
        while (m < n && content[m] !== '>') m++;
        bodyEnd = idx;
        closeEnd = m < n ? m + 1 : n;
        break;
      }
      k = idx + 8;
    }

    if (!selfClosing && scriptIsJs(tagInner)) {
      for (let p = bodyStart; p < bodyEnd; p++) out[p] = content[p];
    }
    i = closeEnd;
  }
  return out.join('');
}

function resolveSeverity(configValue: string | undefined, fallback: Severity): Severity {
  if (configValue && VALID_SEVERITIES.includes(configValue as Severity)) {
    return configValue as Severity;
  }
  return fallback;
}

export type ContentScanResult = {
  findings: Finding[];
  /** Findings silenced by inline vibecheck-disable directives. */
  suppressed: Finding[];
};

/**
 * Scan a single file's content and report suppressed findings separately.
 * Inline suppression directives are collected in a comment-aware pre-pass
 * (see suppressions.ts), so every consumer of the scanner honors them.
 */
export function scanContentDetailed(content: string, filePath: string, config: Config): ContentScanResult {
  let lang = getLanguage(filePath);
  // HTML: lint the inline <script> bodies as JS. Everything else is blanked
  // in-place, so finding positions and suppression comments line up 1:1.
  if (lang === 'html' || lang === 'htm') {
    content = extractInlineScripts(content);
    lang = 'js';
  }
  const lines = content.split('\n');
  const suppressions = parseSuppressions(content, lang);
  const findings: Finding[] = [];
  const suppressed: Finding[] = [];

  const push = (f: Finding) => {
    if (suppressions && isSuppressed(suppressions, f.rule, f.line)) suppressed.push(f);
    else findings.push(f);
  };

  const enabled = (id: string) => config.rules[id] !== 'off';
  const forThisFile = (r: { fileExclusions?: RegExp }) =>
    !(r.fileExclusions && r.fileExclusions.test(filePath));

  const activeRules = allRules.filter(
    (r) => enabled(r.id) && r.languages.includes(lang) && forThisFile(r),
  );
  const activeMultilineRules = allMultilineRules.filter(
    (r) => enabled(r.id) && r.languages.includes(lang),
  );

  // Lexer-masked copy: strings, template literals, regexes and comments
  // blanked. Computed lazily because most files have no codeOnly findings and
  // lexing every file up front would cost more than it saves.
  let maskedLines: string[] | null = null;
  const masked = () => (maskedLines ??= maskLines(lines));

  for (const rule of activeRules) {
    const severity = resolveSeverity(config.rules[rule.id], rule.severity);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // codeOnly rules match a code construct, so a mention of it in prose is
      // not a finding. Reporting still quotes the real line.
      const subject = rule.codeOnly ? masked()[i] : line;
      const match = rule.pattern.exec(subject);
      if (!match) continue;
      if (rule.antiPattern && rule.antiPattern.test(line)) continue;
      if (rule.lineExclusions && rule.lineExclusions.test(line)) continue;
      push({
        rule: rule.id, severity, category: rule.category,
        file: filePath, line: i + 1, column: match.index + 1,
        message: rule.messageTemplate, snippet: line.trim(),
      });
    }
  }

  for (const rule of activeMultilineRules) {
    const severity = resolveSeverity(config.rules[rule.id], rule.severity);
    for (const mf of rule.detect(lines, filePath)) {
      push({
        rule: rule.id, severity, category: rule.category,
        file: filePath, line: mf.line, column: mf.column,
        message: mf.message, snippet: mf.snippet.trim(),
      });
    }
  }

  findings.sort((a, b) => a.line - b.line);
  suppressed.sort((a, b) => a.line - b.line);
  return { findings, suppressed };
}

/**
 * Scan a single file's content directly (used by the CLI, the MCP server, and
 * editor integrations). The directory scanner delegates to this per file.
 * Findings suppressed by inline directives are excluded.
 */
export function scanContent(content: string, filePath: string, config: Config): Finding[] {
  return scanContentDetailed(content, filePath, config).findings;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type ScanOptions = {
  /**
   * Scan exactly these files (absolute paths) instead of globbing.
   *
   * An explicitly named file must not go through glob matching: fast-glob
   * treats a backslash in the name as a separator and rewrites `back\slash.ts`
   * into `back/slash.ts`, which then does not exist, and a leading `!` reads as
   * a negation. Either way the file was silently skipped.
   */
  files?: string[];
  /**
   * Scan this content directly instead of reading anything from disk. Used by
   * --staged, where the bytes that matter live in the index and the working
   * tree may hold something entirely different.
   */
  contents?: {
    path: string;
    content: string;
    changedLines?: Set<number>;
    /** Hunks for this file, enabling positional matching against the base. */
    hunks?: Hunk[];
  }[];
  /**
   * The content of each changed file BEFORE the change, keyed by the same path
   * used for reporting.
   *
   * Diff mode used to keep only findings whose anchor line changed. Multiline
   * rules report at the line a construct STARTS on, so an edit could create a
   * finding and have it dropped: changing a catch body from returning to
   * logging creates no-console-error-only, anchored on the unchanged `catch`
   * line, and diff mode called that clean.
   *
   * With the previous content we can ask the question that actually matters —
   * did this change INTRODUCE the finding — instead of guessing from line
   * numbers. Anchored-line matching stays as-is, so nothing that used to be
   * reported stops being reported.
   */
  baseContents?: Map<string, string>;
  /**
   * Hunks per report path for filesystem scans. With these, selection can ask
   * WHERE a base finding went instead of only how many existed, which is what
   * tells two identical findings apart.
   */
  hunks?: Map<string, Hunk[]>;
};

/**
 * Decide which findings survive diff filtering.
 *
 * Keeps a finding when its anchor is on a changed line (the old behaviour), or
 * when the file did not already contain an equivalent finding before the
 * change. Identity is the existing fingerprint (rule + path + snippet), which
 * carries no line number and no message, so a function crossing the length
 * threshold counts as introduced while one that was already too long does not
 * resurface every time somebody edits its body.
 */
/** Scan the pre-change content of a file, when we have it. */
function baseFindingsFor(
  path: string,
  config: Config,
  baseContents: Map<string, string> | undefined
): { findings: Finding[]; suppressed: Finding[] } | null {
  const before = baseContents?.get(path);
  if (before === undefined) return null;
  // The same size cap the filesystem path applies. Base content came straight
  // from git and skipped it, so a huge blob at HEAD made every scan of a small
  // working copy pay to lint megabytes it would never have read from disk.
  // Bytes, not UTF-16 code units: multibyte content is up to 3x larger on
  // disk than `.length` suggests, so a 1.2MB blob was slipping through.
  if (Buffer.byteLength(before, 'utf-8') > MAX_FILE_SIZE) return null;
  const r = scanContentDetailed(before, path, config);
  // Suppressed findings are budgeted separately. Measuring them against the
  // findings budget made old suppressed entries resurface on an unrelated edit.
  return { findings: r.findings, suppressed: r.suppressed };
}

export type DiffSelection = {
  kept: Finding[];
  /**
   * Per fingerprint: occurrences that existed in the base and were therefore
   * NOT reported. The baseline must spend its budget on these before it may
   * absorb a reported finding, or the old copy's baseline slot hides the
   * introduced duplicate — the false clean a review found in v1.20.0.
   */
  baselineCredits: Map<string, number>;
};

/**
 * True when a hunk changed nothing but whitespace.
 *
 * Reindenting a block leaves every line equal once leading/trailing space is
 * stripped, which is the same normalization the fingerprint snippet uses.
 * Rewriting a block does not. Position cannot tell those apart; content can.
 */
function whitespaceOnly(h: Hunk, lines: { base: string[]; next: string[] }): boolean {
  // Blank lines are whitespace too: a formatter that inserts one between two
  // functions changes the hunk's line COUNT while changing no code, so
  // comparing slices positionally would reject it. Compare the sequence of
  // non-blank trimmed lines, which is exactly "same code, laid out differently".
  const norm = (src: string[], start: number, count: number) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const l = src[start - 1 + i];
      if (l === undefined) return null;
      // Runs of internal whitespace collapse too: `function a(){` becoming
      // `function a() {` is a formatter, not an edit. The cost is that a
      // whitespace change INSIDE a string literal reads as reformatting — but
      // to be wrongly silenced by that, the finding must already carry an
      // identical fingerprint on both sides, meaning it pre-existed anyway.
      const t = l.trim().replace(/\s+/g, ' ');
      if (t) out.push(t);
    }
    return out;
  };
  const a = norm(lines.base, h.oldStart, h.oldCount);
  const b = norm(lines.next, h.newStart, h.newCount);
  if (!a || !b || a.length !== b.length) return false;
  return a.every((l, i) => l === b[i]);
}

function selectForDiff(
  found: Finding[],
  changedLines: Set<number> | undefined,
  baseFindings: Finding[] | null,
  hunks?: Hunk[],
  lines?: { base: string[]; next: string[] },
  /**
   * Occurrences present in the NEW file but suppressed, so absent from `found`.
   * They take part in matching exactly like active ones — an occurrence that is
   * still there and merely silenced has not moved anywhere — but are never
   * reported. Counting them instead of matching them let a FRESH suppressed
   * occurrence spend a base slot it had no correspondence to, which then made a
   * genuine move look introduced.
   */
  nowSuppressed?: Finding[]
): DiffSelection {
  const credits = new Map<string, number>();
  const credit = (key: string) => credits.set(key, (credits.get(key) ?? 0) + 1);

  if (!changedLines) return { kept: found, baselineCredits: credits };
  if (!baseFindings) {
    return { kept: found.filter((f) => changedLines.has(f.line)), baselineCredits: credits };
  }
  if (!hunks || !lines) return selectByCountBudget(found, changedLines, baseFindings, credits);

  // With hunks we can ask WHERE each base finding went, instead of only how
  // many of each fingerprint existed. Exact mapping outside hunks is ground
  // truth; inside a hunk only an unambiguous pairing counts; everything else
  // stays unknown and keeps the miss-over-blame fallback. A hunk is NOT an
  // equivalence class — treating it as one recreates the wrong-copy problem at
  // hunk granularity the moment a large replacement holds two identical
  // findings.
  const baseByFp = new Map<string, { line: number; mapped: { line: number } | { hunk: number } }[]>();
  for (const b of baseFindings) {
    const key = findingFingerprint(b);
    const list = baseByFp.get(key) ?? [];
    list.push({ line: b.line, mapped: mapOldLine(hunks, b.line) });
    baseByFp.set(key, list);
  }
  // One candidate pool, one consumption ledger. Suppressed occurrences compete
  // for base occurrences on equal terms and are filtered out at the end.
  const reportable = new Set(found);
  const newByFp = new Map<string, Finding[]>();
  // Active occurrences are listed first so they win matches when several
  // candidates compete for the same base occurrence. What is left over counts
  // as introduced, and a suppressed occurrence carries an explicit "I know
  // about this" marker, so it is the less surprising thing to be the new one.
  for (const f of [...found, ...(nowSuppressed ?? [])]) {
    const key = findingFingerprint(f);
    const list = newByFp.get(key) ?? [];
    list.push(f);
    newByFp.set(key, list);
  }

  const kept = new Set<Finding>();
  for (const [key, news] of newByFp) {
    const bases = baseByFp.get(key) ?? [];
    const matchedNew = new Set<Finding>();
    const matchedBase = new Set<(typeof bases)[number]>();

    // (a) Exact: a base finding outside every hunk maps to one specific line.
    for (const b of bases) {
      if (!('line' in b.mapped)) continue;
      const target = b.mapped.line;
      const hit = news.find((n) => !matchedNew.has(n) && n.line === target);
      if (hit) {
        matchedNew.add(hit);
        matchedBase.add(b);
      }
    }

    // (b) Inside each hunk, pair by CONTENT, not by position. Offsets are not
    // identity: two unrelated functions whose eval() lines happen to sit at the
    // same offsets within a replaced block would match, and a genuinely new
    // finding would be swallowed. Whitespace-normalized equality of the whole
    // hunk is what actually distinguishes "this block was reindented" from
    // "this block was rewritten".
    const unknownNew = new Set<Finding>();
    const hunkIndexes = new Set<number>();
    for (const b of bases) if (!matchedBase.has(b) && 'hunk' in b.mapped) hunkIndexes.add(b.mapped.hunk);
    for (const n of news) {
      if (matchedNew.has(n)) continue;
      const h = hunkIndexForNewLine(hunks, n.line);
      if (h >= 0) hunkIndexes.add(h);
    }
    for (const h of hunkIndexes) {
      const bIn = bases.filter((b) => !matchedBase.has(b) && 'hunk' in b.mapped && b.mapped.hunk === h);
      const nIn = news.filter((n) => !matchedNew.has(n) && hunkIndexForNewLine(hunks, n.line) === h);
      if (bIn.length === 0 || nIn.length === 0) continue; // fresh or removed; nothing to pair
      // Being alone in the hunk is NOT identity either. Rewriting a function
      // while keeping one eval() gives 1 base and 1 new occurrence, and pairing
      // them silenced a finding the released behaviour reported. Only a hunk
      // that changed nothing but whitespace proves the code is the same code.
      //
      // Counts must balance as well. Normalizing whitespace can MOVE lines
      // between fingerprints — `eval("a  b")` and `eval("a b")` normalize alike
      // but fingerprint differently — so a cosmetic-looking hunk can still take
      // one fingerprint from 1 to 2. Matching every occurrence then swallows a
      // genuinely introduced finding. Unequal counts fall back to unknown.
      if (bIn.length === nIn.length && whitespaceOnly(hunks[h], lines)) {
        for (const n of nIn) matchedNew.add(n);
        for (const b of bIn) matchedBase.add(b);
      } else {
        for (const n of nIn) unknownNew.add(n);
      }
    }

    // (c) A move. The base occurrence is gone from where it should have been
    // and an identical one turned up somewhere else, with nothing else
    // competing for either. Relocating code does not introduce the finding
    // that rode along with it, and blaming the destination is the same false
    // blame as blaming a reformat. Deliberately narrow: exactly one unmatched
    // occurrence on each side, or the ambiguity is real and stays unknown.
    {
      const bLeft = bases.filter((b) => !matchedBase.has(b));
      const nLeft = news.filter((n) => !matchedNew.has(n) && !unknownNew.has(n));
      // One base occurrence unaccounted for and one ACTIVE candidate for it:
      // that is the move. Extra suppressed candidates do not create ambiguity,
      // because they are the ones that end up counted as introduced and never
      // reported anyway.
      const nActive = nLeft.filter((n) => reportable.has(n));
      if (bLeft.length === 1 && nActive.length === 1) {
        matchedBase.add(bLeft[0]);
        matchedNew.add(nActive[0]);
      }
    }

    for (const n of news) {
      if (matchedNew.has(n)) {
        // Proven pre-existing: quiet even when its anchor line changed, which
        // is exactly the reformat case — an indent-only edit must not read as
        // the author introducing the finding. A suppressed occurrence that
        // matched still earns the credit: its base counterpart is spoken for,
        // and the baseline must not hand that slot to something else.
        credit(key);
      } else if (unknownNew.has(n)) {
        // Identical occurrences coexist in an ambiguous changed region. Keep
        // the old contract for these: report on a changed anchor, never guess.
        if (changedLines.has(n.line)) kept.add(n);
        else credit(key);
      } else {
        kept.add(n); // introduced: no corresponding base occurrence anywhere
      }
    }
  }

  return { kept: found.filter((f) => kept.has(f) && reportable.has(f)), baselineCredits: credits };
}

/**
 * The pre-correspondence algorithm, kept for callers that supply base content
 * without hunks. Counts cannot say WHICH copy is new, so ambiguous groups fall
 * back to anchor matching.
 */
function selectByCountBudget(
  found: Finding[],
  changedLines: Set<number>,
  baseFindings: Finding[],
  credits: Map<string, number>
): DiffSelection {
  const baseCount = new Map<string, number>();
  for (const f of baseFindings) {
    const key = findingFingerprint(f);
    baseCount.set(key, (baseCount.get(key) ?? 0) + 1);
  }

  const groups = new Map<string, Finding[]>();
  for (const f of found) {
    const key = findingFingerprint(f);
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }

  const kept = new Set<Finding>();
  for (const [key, list] of groups) {
    const already = baseCount.get(key) ?? 0;
    const introduced = list.length - already;

    for (const f of list) if (changedLines.has(f.line)) kept.add(f);
    if (introduced <= 0) continue;

    const candidates = list.filter((f) => !changedLines.has(f.line));
    if (already === 0) {
      for (const f of candidates) kept.add(f);
      continue;
    }
    if (candidates.length > 1) continue;
    for (const f of candidates) kept.add(f);
  }

  return { kept: found.filter((f) => kept.has(f)), baselineCredits: credits };
}

export async function scan(
  targetPath: string,
  config: Config,
  diffMap?: DiffMap,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  const suppressed: Finding[] = [];


  const skipped: SkippedFile[] = [];
  const baselineCredits = new Map<string, number>();
  let scannedCount = 0;
  let linesScanned = 0;

  // Shared by the filesystem and content paths so a staged scan and a disk scan
  // report identically.
  const finish = (): ScanResult => {
    const byFileThenLine = (a: Finding, b: Finding) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    };
    findings.sort(byFileThenLine);
    suppressed.sort(byFileThenLine);

    const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
    for (const f of findings) summary[f.severity]++;

    return {
      findings,
      suppressed,
      filesScanned: scannedCount,
      linesScanned,
      duration: performance.now() - start,
      summary,
      skipped,
      baselineCredits: baselineCredits.size ? Object.fromEntries(baselineCredits) : undefined,
    };
  };
  // Non-empty lines only: blank-line padding must not dilute a density score,
  // or a file could improve its grade by adding whitespace.

  // Content supplied directly (staged mode): lint it and skip the filesystem
  // entirely. Same aggregation as the disk path, different source of bytes.
  if (options.contents) {
    for (const item of options.contents) {
      scannedCount++;
      for (const line of item.content.split('\n')) {
        if (line.trim()) linesScanned++;
      }
      const fileResult = scanContentDetailed(item.content, item.path, config);
      const base = baseFindingsFor(item.path, config, options.baseContents);
      // Active and suppressed pools are matched independently: a suppressed
      // base occurrence must never consume a newly unsuppressed finding.
      const contentLines = base
        ? { base: (options.baseContents?.get(item.path) ?? '').split('\n'), next: item.content.split('\n') }
        : undefined;
      const active = selectForDiff(
        fileResult.findings,
        item.changedLines,
        base?.findings ?? null,
        item.hunks,
        contentLines,
        fileResult.suppressed
      );
      findings.push(...active.kept);
      for (const [k, v] of active.baselineCredits) baselineCredits.set(k, (baselineCredits.get(k) ?? 0) + v);
      suppressed.push(
        ...selectForDiff(
          fileResult.suppressed,
          item.changedLines,
          base?.suppressed ?? null,
          item.hunks,
          contentLines
        ).kept
      );
    }
    return finish();
  }

  const files =
    options.files ??
    (await fg(config.include, {
      cwd: targetPath,
      ignore: config.ignore,
      absolute: true,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    }));


  for (const filePath of files) {
    const relPath = relative(targetPath, filePath);

    // In diff mode, skip files not in the diff before any I/O
    const changedLines = diffMap?.get(relPath);
    if (diffMap && !changedLines) continue;

    // Every skip below is RECORDED, not swallowed. A file the scanner could
    // not read used to be indistinguishable from a file it read and liked, so
    // an unreadable or oversized file containing an eval() exited 0 silently.
    try {
      const stat = statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        skipped.push({
          file: relPath,
          reason: 'too-large',
          detail: `${Math.round(stat.size / 1024)}KB exceeds the ${Math.round(MAX_FILE_SIZE / 1024)}KB limit`,
        });
        continue;
      }
    } catch (err) {
      skipped.push({ file: relPath, reason: 'unreadable', detail: errText(err) });
      continue;
    }

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      skipped.push({ file: relPath, reason: 'unreadable', detail: errText(err) });
      continue;
    }

    if (content.includes('\0')) {
      skipped.push({ file: relPath, reason: 'binary' });
      continue;
    }

    scannedCount++;
    for (const line of content.split('\n')) {
      if (line.trim()) linesScanned++;
    }

    const fileResult = scanContentDetailed(content, relPath, config);
    const base = baseFindingsFor(relPath, config, options.baseContents);
    const fileHunks = options.hunks?.get(relPath);
    const contentLines = base
      ? { base: (options.baseContents?.get(relPath) ?? '').split('\n'), next: content.split('\n') }
      : undefined;
    const active = selectForDiff(
      fileResult.findings,
      changedLines,
      base?.findings ?? null,
      fileHunks,
      contentLines,
      fileResult.suppressed
    );
    findings.push(...active.kept);
    for (const [k, v] of active.baselineCredits) baselineCredits.set(k, (baselineCredits.get(k) ?? 0) + v);
    suppressed.push(
      ...selectForDiff(fileResult.suppressed, changedLines, base?.suppressed ?? null, fileHunks, contentLines).kept
    );
  }

  return finish();
}
