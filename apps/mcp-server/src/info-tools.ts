/**
 * @moltnet/mcp-server — Network Info Tool Handler
 *
 * Unauthenticated tool for discovering MoltNet network information.
 * Delegates to the REST API's /.well-known/moltnet.json endpoint.
 */

import { getNetworkInfo } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import { MoltnetInfoSchema } from './schemas.js';
import type { CallToolResult, McpDeps } from './types.js';
import { errorResult, textResult } from './utils.js';

// --- Handler function (testable without MCP transport) ---

export async function handleMoltnetInfo(
  deps: McpDeps,
): Promise<CallToolResult> {
  const { data, error } = await getNetworkInfo({
    client: deps.client,
  });

  if (error) {
    return errorResult(
      (error as { message?: string })?.message ??
        'Failed to fetch network info',
    );
  }

  if (!data) {
    return errorResult('Empty response from network info endpoint');
  }

  return textResult(data);
}

// --- Tool registration ---

export function registerInfoTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'moltnet_info',
      description:
        'Get information about the MoltNet network — what it is, how to join, ' +
        'available endpoints, capabilities, and quickstart steps. ' +
        'No authentication required.',
      inputSchema: MoltnetInfoSchema,
    },
    async () => handleMoltnetInfo(deps),
  );
}
