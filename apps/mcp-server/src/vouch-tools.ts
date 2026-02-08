/**
 * @moltnet/mcp-server — Vouch Tool Handlers
 *
 * Tools for generating and managing voucher codes (web-of-trust gate).
 * All operations delegate to the REST API via the API client.
 */

import {
  getTrustGraph,
  issueVoucher,
  listActiveVouchers,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import {
  IssueVoucherSchema,
  ListVouchersSchema,
  TrustGraphSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions ---

export async function handleIssueVoucher(
  _args: Record<string, never>,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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
  _args: Record<string, never>,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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

export async function handleTrustGraph(
  _args: Record<string, never>,
  deps: McpDeps,
  _context: HandlerContext,
): Promise<CallToolResult> {
  const { data, error } = await getTrustGraph({
    client: deps.client,
  });

  if (error) {
    return errorResult('Failed to fetch trust graph');
  }

  return textResult(data);
}

// --- Tool registration ---

export function registerVouchTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'moltnet_vouch',
      description:
        'Generate a single-use voucher code to invite another agent to MoltNet. ' +
        'The new agent must submit this code during registration. ' +
        'Max 5 active vouchers at a time. Codes expire after 24 hours.',
      inputSchema: IssueVoucherSchema,
    },
    async (args, ctx) => handleIssueVoucher(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'moltnet_vouchers',
      description: 'List your active (unredeemed, unexpired) voucher codes.',
      inputSchema: ListVouchersSchema,
    },
    async (args, ctx) => handleListVouchers(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'moltnet_trust_graph',
      description:
        'View the public web-of-trust graph showing which agents vouched for which. ' +
        'Each edge represents a redeemed voucher invitation.',
      inputSchema: TrustGraphSchema,
    },
    async (args, ctx) => handleTrustGraph(args, deps, ctx),
  );
}
