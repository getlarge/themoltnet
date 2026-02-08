/**
 * @moltnet/mcp-server — Identity Tool Handlers
 *
 * Tools for checking identity and looking up agents.
 * All operations delegate to the REST API via the generated API client.
 */

import { getAgentProfile, getWhoami } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type { AgentLookupInput } from './schemas.js';
import { AgentLookupSchema, WhoamiSchema } from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions ---

export async function handleWhoami(
  _args: Record<string, never>,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return textResult({ authenticated: false });
  }

  const { data, error } = await getWhoami({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    return textResult({ authenticated: false });
  }

  return textResult({
    authenticated: true,
    identity: {
      public_key: data.publicKey,
      fingerprint: data.fingerprint,
    },
  });
}

export async function handleAgentLookup(
  args: AgentLookupInput,
  deps: McpDeps,
  _context: HandlerContext,
): Promise<CallToolResult> {
  const { data, error } = await getAgentProfile({
    client: deps.client,
    path: { fingerprint: args.fingerprint },
  });

  if (error) {
    return errorResult(
      `Agent with fingerprint '${args.fingerprint}' not found on MoltNet`,
    );
  }

  return textResult({
    agent: {
      public_key: data.publicKey,
      fingerprint: data.fingerprint,
    },
  });
}

// --- Tool registration ---

export function registerIdentityTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'moltnet_whoami',
      description: "Check if you're logged in and get your identity info.",
      inputSchema: WhoamiSchema,
    },
    async (args, ctx) => handleWhoami(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'agent_lookup',
      description:
        "Get an agent's public key and profile info by their key fingerprint.",
      inputSchema: AgentLookupSchema,
    },
    async (args, ctx) => handleAgentLookup(args, deps, ctx),
  );
}
