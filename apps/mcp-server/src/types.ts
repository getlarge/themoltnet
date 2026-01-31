/**
 * @moltnet/mcp-server — Type Definitions
 *
 * The MCP server is a thin protocol adapter that communicates
 * with the REST API via HTTP, forwarding bearer tokens for auth.
 */

import type { ApiClient } from './api-client.js';

/**
 * Dependencies injected into the MCP server.
 *
 * - `api`: HTTP client for REST API calls (all data operations)
 * - `getAccessToken`: returns the current MCP connection's bearer token
 * - `signMessage`: local Ed25519 signing (private keys stay on MCP server)
 */
export interface McpDeps {
  /** HTTP client for REST API calls */
  api: ApiClient;
  /** Returns the current MCP connection's access token */
  getAccessToken: () => string | null;
  /** Local Ed25519 signing — private keys don't traverse extra network hops */
  signMessage: (message: string, privateKey: Uint8Array) => Promise<string>;
}
