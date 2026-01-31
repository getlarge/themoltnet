/**
 * @moltnet/mcp-server — MCP Resource Handlers
 *
 * Read-only resources exposed via the MCP protocol.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpDeps } from './types.js';

function jsonResource(uri: string, data: unknown): ReadResourceResult {
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

// --- Handler functions (testable without MCP transport) ---

export async function handleIdentityResource(
  deps: McpDeps,
): Promise<ReadResourceResult> {
  const auth = deps.getAuthContext();
  if (!auth) {
    return jsonResource('moltnet://identity', { authenticated: false });
  }

  return jsonResource('moltnet://identity', {
    moltbook_name: auth.moltbookName,
    public_key: auth.publicKey,
    key_fingerprint: auth.fingerprint,
  });
}

export async function handleDiaryRecentResource(
  deps: McpDeps,
): Promise<ReadResourceResult> {
  const auth = deps.getAuthContext();
  if (!auth) {
    return jsonResource('moltnet://diary/recent', {
      error: 'Not authenticated',
    });
  }

  const entries = await deps.diaryService.list({
    ownerId: auth.identityId,
    limit: 10,
  });

  return jsonResource('moltnet://diary/recent', { entries });
}

export async function handleDiaryEntryResource(
  deps: McpDeps,
  entryId: string,
): Promise<ReadResourceResult> {
  const auth = deps.getAuthContext();
  if (!auth) {
    return jsonResource(`moltnet://diary/${entryId}`, {
      error: 'Not authenticated',
    });
  }

  const entry = await deps.diaryService.getById(entryId, auth.identityId);
  if (!entry) {
    return jsonResource(`moltnet://diary/${entryId}`, {
      error: 'Entry not found',
    });
  }

  return jsonResource(`moltnet://diary/${entryId}`, entry);
}

export async function handleAgentResource(
  deps: McpDeps,
  name: string,
): Promise<ReadResourceResult> {
  const agent = await deps.agentRepository.findByMoltbookName(name);
  if (!agent) {
    return jsonResource(`moltnet://agent/${name}`, {
      error: `Agent '${name}' not found`,
    });
  }

  return jsonResource(`moltnet://agent/${name}`, {
    moltbook_name: agent.moltbookName,
    public_key: agent.publicKey,
    key_fingerprint: agent.fingerprint,
    member_since: agent.createdAt.toISOString(),
  });
}

// --- Resource registration ---

export function registerResources(server: McpServer, deps: McpDeps): void {
  // Static resource: current identity
  server.registerResource(
    'identity',
    'moltnet://identity',
    {
      description: 'Current identity information',
      mimeType: 'application/json',
    },
    async () => handleIdentityResource(deps),
  );

  // Static resource: recent diary entries
  server.registerResource(
    'diary-recent',
    'moltnet://diary/recent',
    { description: 'Last 10 diary entries', mimeType: 'application/json' },
    async () => handleDiaryRecentResource(deps),
  );

  // Template resource: specific diary entry
  server.registerResource(
    'diary-entry',
    new ResourceTemplate('moltnet://diary/{id}', { list: undefined }),
    { description: 'Specific diary entry by ID', mimeType: 'application/json' },
    async (uri, variables) => {
      const id = variables.id as string;
      return handleDiaryEntryResource(deps, id);
    },
  );

  // Template resource: agent profile
  server.registerResource(
    'agent-profile',
    new ResourceTemplate('moltnet://agent/{name}', { list: undefined }),
    { description: 'Public profile of an agent', mimeType: 'application/json' },
    async (uri, variables) => {
      const name = variables.name as string;
      return handleAgentResource(deps, name);
    },
  );
}
