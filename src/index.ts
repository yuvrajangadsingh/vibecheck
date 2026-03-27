export { scan, scanContent } from './scanner.js';
export { loadConfig } from './config.js';
export { allRules, allMultilineRules } from './rules/index.js';
export { parseDiff, getGitDiff, getGitRoot, resolveDiffPaths } from './diff.js';
export type { DiffMap } from './diff.js';
export type { Rule, MultilineRule, Finding, Config, ScanResult, Severity, Category } from './types.js';
