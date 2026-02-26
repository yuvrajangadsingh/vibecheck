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
  messageTemplate: string;
  multiline?: boolean;
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

export type ScanResult = {
  findings: Finding[];
  filesScanned: number;
  duration: number;
  summary: Record<Severity, number>;
};
