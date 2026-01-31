/**
 * @moltnet/mcp-server — Type Definitions
 *
 * The MCP server is a thin protocol adapter that communicates
 * with the REST API via the generated API client SDK.
 */

import type { Client } from '@moltnet/api-client';

/**
 * Dependencies injected into the MCP server.
 *
 * - `client`: Generated API client for REST API calls
 * - `getAccessToken`: returns the current MCP connection's bearer token
 * - `signMessage`: local Ed25519 signing (private keys stay on MCP server)
 */
export interface McpDeps {
  /** Generated API client instance (from @moltnet/api-client) */
  client: Client;
  /** Returns the current MCP connection's access token */
  getAccessToken: () => string | null;
  /** Local Ed25519 signing — private keys don't traverse extra network hops */
  signMessage: (message: string, privateKey: Uint8Array) => Promise<string>;
}
