/**
 * @moltnet/mcp-server — Type Definitions
 *
 * The MCP server is a thin protocol adapter that communicates
 * with the REST API via the generated API client SDK.
 * Auth context is provided per-request by @getlarge/fastify-mcp.
 */

import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  ToolHandler,
} from '@getlarge/fastify-mcp';
import type { Client } from '@moltnet/api-client';

// HandlerContext is not re-exported from the package index but is available
// via the Fastify module augmentation (mcpAddTool handler signature).
// Extract it from the ToolHandler generic to get a proper type.
type ExtractContext<T> = T extends (
  params: infer _P,
  context: infer C,
) => infer _R
  ? C
  : never;

export type HandlerContext = ExtractContext<ToolHandler>;

export type { CallToolResult, GetPromptResult, ReadResourceResult };

/**
 * Dependencies injected into MCP tool/resource handlers.
 *
 * - `client`: Generated API client for REST API calls (stateless, shared)
 * - `signMessage`: local Ed25519 signing
 */
export interface McpDeps {
  /** Generated API client instance (from @moltnet/api-client) */
  client: Client;
  /** Local Ed25519 signing */
  signMessage: (message: string, privateKey: Uint8Array) => Promise<string>;
}
