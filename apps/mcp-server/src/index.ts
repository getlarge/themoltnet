/**
 * @moltnet/mcp-server — Entry Point
 *
 * Exports the app builder and types.
 * Uses @getlarge/fastify-mcp for MCP protocol support.
 */

export type { AppOptions } from './app.js';
export { buildApp } from './app.js';
export { getRequiredSecrets } from './config.js';
export type { McpDeps } from './types.js';
