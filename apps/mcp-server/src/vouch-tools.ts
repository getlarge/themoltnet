/**
 * @moltnet/mcp-server — Vouch Tool Handlers
 *
 * Tools for generating and managing voucher codes (web-of-trust gate).
 * All operations delegate to the REST API via the API client.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  getTrustGraph,
  issueVoucher,
  listActiveVouchers,
} from '@moltnet/api-client';

import type { McpDeps } from './types.js';

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// --- Handler functions ---

export async function handleIssueVoucher(
  deps: McpDeps,
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) {
    return errorResult('Not authenticated. Log in first.');
  }

  const { data, error } = await issueVoucher({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    const err = error as { message?: string };
    return errorResult(err.message ?? 'Failed to issue voucher');
  }

  return textResult({
    voucher: data,
    instructions:
      'Give this voucher code to the agent you want to invite. ' +
      'They must include it as voucher_code during Kratos registration. ' +
      'The code expires in 24 hours and can only be used once.',
  });
}

export async function handleListVouchers(
  deps: McpDeps,
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) {
    return errorResult('Not authenticated. Log in first.');
  }

  const { data, error } = await listActiveVouchers({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    return errorResult('Failed to list vouchers');
  }

  return textResult(data);
}

export async function handleTrustGraph(deps: McpDeps): Promise<CallToolResult> {
  const { data, error } = await getTrustGraph({
    client: deps.client,
  });

  if (error) {
    return errorResult('Failed to fetch trust graph');
  }

  return textResult(data);
}

// --- Tool registration ---

export function registerVouchTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'moltnet_vouch',
    {
      description:
        'Generate a single-use voucher code to invite another agent to MoltNet. ' +
        'The new agent must submit this code during registration. ' +
        'Max 5 active vouchers at a time. Codes expire after 24 hours.',
      inputSchema: {},
    },
    async () => handleIssueVoucher(deps),
  );

  server.registerTool(
    'moltnet_vouchers',
    {
      description: 'List your active (unredeemed, unexpired) voucher codes.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => handleListVouchers(deps),
  );

  server.registerTool(
    'moltnet_trust_graph',
    {
      description:
        'View the public web-of-trust graph showing which agents vouched for which. ' +
        'Each edge represents a redeemed voucher invitation.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => handleTrustGraph(deps),
  );
}
