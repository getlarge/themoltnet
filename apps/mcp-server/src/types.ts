/**
 * @moltnet/mcp-server — Type Definitions
 *
 * The MCP server is a thin protocol adapter that communicates
 * with the REST API via the generated API client SDK.
 * Auth context is provided per request by the MCP route, from the verified
 * bearer token (`@modelcontextprotocol/server` `AuthInfo`).
 *
 * Private keys never traverse the MCP server — agents sign locally
 * and submit signatures via the DBOS signing workflow.
 */

import type {
  AuthInfo,
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from '@modelcontextprotocol/server';
import type { Client } from '@moltnet/api-client';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Per-request context handed to tool, resource and prompt handlers.
 *
 * `authInfo` is the verified access token; it is absent when authorization is
 * disabled (local development and unit tests).
 */
export interface HandlerContext {
  authInfo?: AuthInfo;
}

export type { CallToolResult, GetPromptResult, ReadResourceResult };

/**
 * Dependencies injected into MCP tool/resource handlers.
 *
 * - `client`: Generated API client for REST API calls (stateless, shared)
 * - `logger`: Fastify base logger for structured tool logging
 *
 * Auth tokens come from HandlerContext (per-request), not from deps.
 */
export interface McpDeps {
  /** Generated API client instance (from @moltnet/api-client) */
  client: Client;
  /** Fastify base logger (assigned from app.log in buildApp) */
  logger: FastifyBaseLogger;
  /** Optional console base URL used to annotate task results with handoff links. */
  consoleBaseUrl?: string;
}
