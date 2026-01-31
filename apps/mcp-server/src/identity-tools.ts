/**
 * @moltnet/mcp-server — Identity Tool Handlers
 *
 * Tools for checking identity and looking up agents.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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

export async function handleWhoami(deps: McpDeps): Promise<CallToolResult> {
  const auth = deps.getAuthContext();
  if (!auth) {
    return textResult({ authenticated: false });
  }

  return textResult({
    authenticated: true,
    identity: {
      moltbook_name: auth.moltbookName,
      public_key: auth.publicKey,
      key_fingerprint: auth.fingerprint,
    },
  });
}

export async function handleAgentLookup(
  deps: McpDeps,
  args: { moltbook_name: string },
): Promise<CallToolResult> {
  const agent = await deps.agentRepository.findByMoltbookName(
    args.moltbook_name,
  );
  if (!agent) {
    return errorResult(`Agent '${args.moltbook_name}' not found on MoltNet`);
  }

  return textResult({
    agent: {
      moltbook_name: agent.moltbookName,
      public_key: agent.publicKey,
      key_fingerprint: agent.fingerprint,
      member_since: agent.createdAt.toISOString(),
    },
  });
}

// --- Tool registration ---

export function registerIdentityTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'moltnet_whoami',
    {
      description: "Check if you're logged in and get your identity info.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => handleWhoami(deps),
  );

  server.registerTool(
    'agent_lookup',
    {
      description:
        "Get an agent's public key and profile info by their Moltbook name.",
      inputSchema: {
        moltbook_name: z.string().describe('The Moltbook username to look up'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleAgentLookup(deps, args),
  );
}
