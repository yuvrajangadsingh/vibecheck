import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { scan, scanContent, loadConfig, allRules, allMultilineRules, parseDiff } from './index.js';
import type { Finding } from './types.js';

const VERSION = '1.7.0';

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'No issues found.';
  return findings.map((f) =>
    `${f.file}:${f.line}:${f.column} [${f.severity}] ${f.rule}: ${f.message}\n  > ${f.snippet}`
  ).join('\n\n');
}

function resultText(filesScanned: number, findings: Finding[]): string {
  if (findings.length === 0) return `Scanned ${filesScanned} file(s). No issues found.`;
  return `Scanned ${filesScanned} file(s). ${findings.length} issue(s) found:\n\n${formatFindings(findings)}`;
}

async function handleScanFiles({ paths, config_path }: { paths: string[]; config_path?: string }) {
  const findings: Finding[] = [];
  let totalFiles = 0;
  const config = loadConfig(config_path);

  for (const p of paths) {
    const resolved = resolve(p);
    if (!existsSync(resolved)) {
      findings.push({
        rule: 'mcp-error', severity: 'error', category: 'code-quality',
        file: p, line: 0, column: 0,
        message: `Path does not exist: ${p}`, snippet: '',
      });
      continue;
    }

    const stat = statSync(resolved);
    if (stat.isFile()) {
      const content = readFileSync(resolved, 'utf-8');
      findings.push(...scanContent(content, resolved, config));
      totalFiles++;
    } else {
      const result = await scan(resolved, config);
      findings.push(...result.findings);
      totalFiles += result.filesScanned;
    }
  }

  return { content: [{ type: 'text' as const, text: resultText(totalFiles, findings) }] };
}

async function handleScanDiff({ diff, repo_root, config_path }: { diff: string; repo_root: string; config_path?: string }) {
  const diffMap = parseDiff(diff);
  if (diffMap.size === 0) {
    return { content: [{ type: 'text' as const, text: 'No changed files found in diff.' }] };
  }

  const config = loadConfig(config_path);
  const result = await scan(resolve(repo_root), config, diffMap);
  return { content: [{ type: 'text' as const, text: resultText(result.filesScanned, result.findings) }] };
}

async function handleGetRules() {
  const rules = [
    ...allRules.map((r) => ({ id: r.id, description: r.description, category: r.category, severity: r.severity, languages: r.languages })),
    ...allMultilineRules.map((r) => ({ id: r.id, description: r.description, category: r.category, severity: r.severity, languages: r.languages })),
  ];

  const text = rules.map((r) =>
    `${r.id} [${r.severity}] (${r.category}) - ${r.description} [${r.languages.join(', ')}]`
  ).join('\n');

  return { content: [{ type: 'text' as const, text: `${rules.length} rules available:\n\n${text}` }] };
}

export async function startMcpServer() {
  const server = new McpServer({ name: 'vibecheck', version: VERSION });

  server.tool(
    'scan-files',
    'Scan files or directories for AI-generated code smells (34 rules: security, error handling, code quality, AI tells, framework). Returns findings with file, line, severity, and message.',
    {
      paths: z.array(z.string()).describe('Absolute file or directory paths to scan'),
      config_path: z.string().optional().describe('Path to vibecheck config file'),
    },
    handleScanFiles,
  );

  server.tool(
    'scan-diff',
    'Scan a unified git diff for AI-generated code smells on changed lines only. Pass raw diff output from git diff, gh pr diff, etc. Catches AI slop in exactly the lines just written.',
    {
      diff: z.string().describe('Raw unified diff output'),
      repo_root: z.string().describe('Absolute path to the repository root'),
      config_path: z.string().optional().describe('Path to vibecheck config file'),
    },
    handleScanDiff,
  );

  server.tool('get-rules', 'List all vibecheck rules with ID, description, severity, category, and supported languages.', {}, handleGetRules);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-start when run directly (node dist/mcp.js)
startMcpServer().catch((err) => {
  console.error('MCP server error:', err.message);
  process.exit(1);
});
