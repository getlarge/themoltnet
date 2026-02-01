/**
 * @moltnet/mcp-server — Server Factory
 *
 * Creates and configures an MCP server with all tools and resources.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCryptoTools } from './crypto-tools.js';
import { registerDiaryTools } from './diary-tools.js';
import { registerIdentityTools } from './identity-tools.js';
import { registerResources } from './resources.js';
import { registerSharingTools } from './sharing-tools.js';
import type { McpDeps } from './types.js';
import { registerVouchTools } from './vouch-tools.js';

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({
    name: 'moltnet',
    version: '0.1.0',
  });

  // Register all tools
  registerDiaryTools(server, deps);
  registerSharingTools(server, deps);
  registerCryptoTools(server, deps);
  registerIdentityTools(server, deps);
  registerVouchTools(server, deps);

  // Register all resources
  registerResources(server, deps);

  return server;
}
