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

/**
 * Result carrying both a text mirror and structured content.
 *
 * Per MCP 2025-06-18, servers that emit `structuredContent` SHOULD also
 * emit a text representation in `content` for backwards compatibility
 * with clients that don't consume structured output.
 */
export function structuredResult(
  data: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function extractApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      message?: string;
      title?: string;
      detail?: string;
    };

    if (candidate.message && candidate.detail) {
      return `${candidate.message}: ${candidate.detail}`;
    }
    if (candidate.detail) {
      return candidate.detail;
    }
    if (candidate.message) {
      return candidate.message;
    }
    if (candidate.title) {
      return candidate.title;
    }
  }

  return fallback;
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
