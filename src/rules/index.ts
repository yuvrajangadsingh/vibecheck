import { securityRules } from './security.js';
import { errorHandlingRules, errorHandlingMultilineRules } from './error-handling.js';
import { codeQualityRules, codeQualityMultilineRules } from './code-quality.js';
import { aiTellRules } from './ai-tells.js';
import { frameworkRules } from './framework.js';
import type { Rule, MultilineRule } from '../types.js';

export const allRules: Rule[] = [
  ...securityRules,
  ...errorHandlingRules,
  ...codeQualityRules,
  ...aiTellRules,
  ...frameworkRules,
];

export const allMultilineRules: MultilineRule[] = [
  ...errorHandlingMultilineRules,
  ...codeQualityMultilineRules,
];
