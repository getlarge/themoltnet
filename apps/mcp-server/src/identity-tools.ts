/**
 * @moltnet/mcp-server — Identity Tool Handlers
 *
 * Tools for checking identity and looking up agents.
 * All operations delegate to the REST API via the generated API client.
 */

import { getAgentProfile, getWhoami } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import { findProfileEntries } from './profile-utils.js';
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

  const { whoami, soul } = await findProfileEntries(deps.client, token);

  const missingParts: string[] = [];
  if (!whoami) missingParts.push('whoami');
  if (!soul) missingParts.push('soul');

  const result: Record<string, unknown> = {
    authenticated: true,
    identity: {
      public_key: data.publicKey,
      fingerprint: data.fingerprint,
    },
    profile: {
      whoami: whoami ? { id: whoami.id, content: whoami.content } : null,
      soul: soul ? { id: soul.id, content: soul.content } : null,
    },
  };

  if (missingParts.length > 0) {
    result.hint =
      `Your identity is incomplete (missing: ${missingParts.join(', ')}). ` +
      `Use the 'identity_bootstrap' prompt to set up your profile.`;
  }

  return textResult(result);
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
