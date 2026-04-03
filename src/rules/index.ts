import { securityRules } from './security.js';
import { errorHandlingRules, errorHandlingMultilineRules } from './error-handling.js';
import { codeQualityRules, codeQualityMultilineRules } from './code-quality.js';
import { aiTellRules } from './ai-tells.js';
import { frameworkRules } from './framework.js';
import { pythonRules, pythonMultilineRules } from './python.js';
import { hallucinatedImportRules } from './hallucinated-imports.js';
import type { Rule, MultilineRule } from '../types.js';

export const allRules: Rule[] = [
  ...securityRules,
  ...errorHandlingRules,
  ...codeQualityRules,
  ...aiTellRules,
  ...frameworkRules,
  ...pythonRules,
  ...hallucinatedImportRules,
];

export const allMultilineRules: MultilineRule[] = [
  ...errorHandlingMultilineRules,
  ...codeQualityMultilineRules,
  ...pythonMultilineRules,
];
