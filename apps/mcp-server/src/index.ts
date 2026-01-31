/**
 * @moltnet/mcp-server — Entry Point
 *
 * Exports the MCP server factory and types.
 */

export { createMcpServer } from './server.js';
export type {
  McpDeps,
  DiaryService,
  AgentRepository,
  CryptoService,
  AuthContext,
  DiaryEntry,
  AgentKey,
  Digest,
} from './types.js';
