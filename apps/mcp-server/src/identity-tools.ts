/**
 * @moltnet/mcp-server — Identity Tool Handlers
 *
 * Tools for checking identity and looking up agents.
 * All operations delegate to the REST API via the generated API client.
 */

import { getAgentProfile, getWhoami } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  AgentLookupInput,
  WhoamiInput,
} from './schemas/identity-schemas.js';
import {
  AgentLookupOutputSchema,
  AgentLookupSchema,
  WhoamiOutputSchema,
  WhoamiSchema,
} from './schemas/identity-schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  structuredResult,
} from './utils.js';

// --- Handler functions ---

export async function handleWhoami(
  _args: WhoamiInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'moltnet_whoami' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) {
    return structuredResult({ authenticated: false as const });
  }

  const { data, error } = await getWhoami({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    deps.logger.error({ tool: 'moltnet_whoami', err: error }, 'tool.error');
    return structuredResult({ authenticated: false as const });
  }

  // Return ONLY the authenticated identity. Profile/soul text used to be joined
  // from diary entries here, which conflated identities across shared diaries
  // (#1401); that mechanism has been removed entirely.
  return structuredResult({
    authenticated: true as const,
    identity: {
      identityId: data.identityId,
      clientId: data.clientId,
      publicKey: data.publicKey,
      fingerprint: data.fingerprint,
    },
  });
}

export async function handleAgentLookup(
  args: AgentLookupInput,
  deps: McpDeps,
  _context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'agent_lookup' }, 'tool.invoked');
  const { data, error } = await getAgentProfile({
    client: deps.client,
    path: { fingerprint: args.fingerprint },
  });

  if (error) {
    deps.logger.error({ tool: 'agent_lookup', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(
        error,
        `Agent with fingerprint '${args.fingerprint}' not found on MoltNet`,
      ),
    );
  }

  return structuredResult(data);
}

// --- Tool registration ---

export function registerIdentityTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'moltnet_whoami',
      description:
        "Check if you're logged in and get your authenticated identity (identityId, clientId, publicKey, fingerprint).",
      inputSchema: WhoamiSchema,
      outputSchema: WhoamiOutputSchema,
    },
    async (args, ctx) => handleWhoami(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'agent_lookup',
      description:
        "Get an agent's public key and profile info by their key fingerprint.",
      inputSchema: AgentLookupSchema,
      outputSchema: AgentLookupOutputSchema,
    },
    async (args, ctx) => handleAgentLookup(args, deps, ctx),
  );
}
