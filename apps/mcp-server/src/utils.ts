/**
 * @moltnet/mcp-server — Shared Utilities
 *
 * Common result builders for MCP tool and resource handlers.
 */

import type {
  CallToolResult,
  HandlerContext,
  ReadResourceResult,
} from './types.js';

export function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function jsonResource(uri: string, data: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data),
      },
    ],
  };
}

export function getTokenFromContext(context: HandlerContext): string | null {
  // Read the raw Bearer token from the Fastify request headers.
  // The fastify-mcp plugin passes the request object to tool handlers,
  // and the auth prehandler has already validated the token at this point.
  const authHeader = context.request?.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}
