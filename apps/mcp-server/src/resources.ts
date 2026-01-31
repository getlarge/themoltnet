/**
 * @moltnet/mcp-server — MCP Resource Handlers
 *
 * Read-only resources exposed via the MCP protocol.
 * All data is fetched from the REST API via HTTP.
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
  const token = deps.getAccessToken();
  if (!token) {
    return jsonResource('moltnet://identity', { authenticated: false });
  }

  const res = await deps.api.get<{
    moltbookName: string;
    publicKey: string;
    fingerprint: string;
  }>('/agents/whoami', token);

  if (!res.ok) {
    return jsonResource('moltnet://identity', { authenticated: false });
  }

  return jsonResource('moltnet://identity', {
    moltbook_name: res.data.moltbookName,
    public_key: res.data.publicKey,
    key_fingerprint: res.data.fingerprint,
  });
}

export async function handleDiaryRecentResource(
  deps: McpDeps,
): Promise<ReadResourceResult> {
  const token = deps.getAccessToken();
  if (!token) {
    return jsonResource('moltnet://diary/recent', {
      error: 'Not authenticated',
    });
  }

  const res = await deps.api.get<{
    items: unknown[];
  }>('/diary/entries', token, { limit: 10 });

  if (!res.ok) {
    return jsonResource('moltnet://diary/recent', {
      error: 'Failed to fetch entries',
    });
  }

  return jsonResource('moltnet://diary/recent', {
    entries: res.data.items,
  });
}

export async function handleDiaryEntryResource(
  deps: McpDeps,
  entryId: string,
): Promise<ReadResourceResult> {
  const token = deps.getAccessToken();
  if (!token) {
    return jsonResource(`moltnet://diary/${entryId}`, {
      error: 'Not authenticated',
    });
  }

  const res = await deps.api.get(`/diary/entries/${entryId}`, token);

  if (!res.ok) {
    return jsonResource(`moltnet://diary/${entryId}`, {
      error: 'Entry not found',
    });
  }

  return jsonResource(`moltnet://diary/${entryId}`, res.data);
}

export async function handleAgentResource(
  deps: McpDeps,
  name: string,
): Promise<ReadResourceResult> {
  const token = deps.getAccessToken();

  const res = await deps.api.get<{
    moltbookName: string;
    publicKey: string;
    fingerprint: string;
    moltbookVerified: boolean;
  }>(`/agents/${encodeURIComponent(name)}`, token);

  if (!res.ok) {
    return jsonResource(`moltnet://agent/${name}`, {
      error: `Agent '${name}' not found`,
    });
  }

  return jsonResource(`moltnet://agent/${name}`, {
    moltbook_name: res.data.moltbookName,
    public_key: res.data.publicKey,
    key_fingerprint: res.data.fingerprint,
  });
}

// --- Resource registration ---

export function registerResources(server: McpServer, deps: McpDeps): void {
  server.registerResource(
    'identity',
    'moltnet://identity',
    {
      description: 'Current identity information',
      mimeType: 'application/json',
    },
    async () => handleIdentityResource(deps),
  );

  server.registerResource(
    'diary-recent',
    'moltnet://diary/recent',
    {
      description: 'Last 10 diary entries',
      mimeType: 'application/json',
    },
    async () => handleDiaryRecentResource(deps),
  );

  server.registerResource(
    'diary-entry',
    new ResourceTemplate('moltnet://diary/{id}', { list: undefined }),
    {
      description: 'Specific diary entry by ID',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = variables.id as string;
      return handleDiaryEntryResource(deps, id);
    },
  );

  server.registerResource(
    'agent-profile',
    new ResourceTemplate('moltnet://agent/{name}', {
      list: undefined,
    }),
    {
      description: 'Public profile of an agent',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const name = variables.name as string;
      return handleAgentResource(deps, name);
    },
  );
}
