export type Severity = 'error' | 'warn' | 'info';
export type Category = 'security' | 'error-handling' | 'code-quality' | 'ai-tell' | 'framework';

export type Rule = {
  id: string;
  name: string;
  description: string;
  category: Category;
  severity: Severity;
  languages: string[];
  pattern: RegExp;
  antiPattern?: RegExp;
  lineExclusions?: RegExp;
  /** Matched against the file path; when it matches, the rule is skipped for that file. */
  fileExclusions?: RegExp;
  messageTemplate: string;
  multiline?: boolean;
  fix?: 'remove-line';
  /**
   * Match against code only, with strings and comments masked out.
   *
   * Set this on rules that target a code CONSTRUCT: writing "we removed the
   * eval() call" in a comment is not calling eval. Leave it off for rules that
   * target comment TEXT (no-ai-todo, no-ai-attribution), which must keep
   * seeing comments to work at all.
   */
  codeOnly?: boolean;
};

export type MultilineRule = {
  id: string;
  name: string;
  description: string;
  category: Category;
  severity: Severity;
  languages: string[];
  messageTemplate: string;
  detect: (lines: string[], filePath: string) => MultilineFinding[];
};

export type MultilineFinding = {
  line: number;
  column: number;
  message: string;
  snippet: string;
};

export type Finding = {
  rule: string;
  severity: Severity;
  category: Category;
  file: string;
  line: number;
  column: number;
  message: string;
  snippet: string;
};

export type Config = {
  rules: Record<string, Severity | 'off'>;
  ignore: string[];
  include: string[];
};

/** A file the scanner could not read, and why. Never silently dropped. */
export type SkippedFile = {
  file: string;
  reason: 'too-large' | 'unreadable' | 'binary';
  detail?: string;
};

export type ScanResult = {
  findings: Finding[];
  /** Findings silenced by inline vibecheck-disable directives. Optional for backward compat. */
  suppressed?: Finding[];
  filesScanned: number;
  /** Non-empty lines scanned. The denominator for the per-KLOC slop score. */
  linesScanned?: number;
  duration: number;
  summary: Record<Severity, number>;
  /**
   * Files that matched the scan but could not be read. Reporting these is the
   * difference between "looked and it is fine" and "never looked", which the
   * scanner used to collapse into the same silent pass.
   */
  skipped?: SkippedFile[];
  /**
   * Diff mode only: per fingerprint, occurrences proven pre-existing and
   * therefore not reported. The baseline spends its budget on these FIRST, or
   * the old copy's slot absorbs the introduced duplicate. Internal; stripped
   * from serialized output.
   */
  baselineCredits?: Record<string, number>;
};
