/**
 * @moltnet/mcp-server — Entry Point
 *
 * Exports the app builder and types.
 * Uses @modelcontextprotocol/server for MCP protocol support.
 */

export type { AppOptions } from './app.js';
export { buildApp } from './app.js';
export { getRequiredSecrets, parseDomainList } from './config.js';
export type { McpDeps } from './types.js';
