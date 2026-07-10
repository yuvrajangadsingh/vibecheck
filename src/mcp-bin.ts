// Executable entry for the `vibecheck-mcp` bin. Kept separate from mcp.ts so that
// importing the server module (e.g. from cli.ts `--mcp`) does not start a server as
// a side effect. Only this file starts one, and only when run directly.
import { startMcpServer } from './mcp.js';

startMcpServer().catch((err) => {
  console.error('MCP server error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
