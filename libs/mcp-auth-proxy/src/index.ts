export { mcpAuthProxyPlugin } from './plugin.js';
export type { McpAuthProxyOptions } from './types.js';

// Re-exported for existing consumers. The implementations moved to
// @moltnet/oauth-token-cache so apps/rest-api can share them without
// depending on an MCP-specific package (issue #1860).
export {
  type CachedToken,
  MemoryTokenCache,
  type TokenCache,
} from '@moltnet/oauth-token-cache';
