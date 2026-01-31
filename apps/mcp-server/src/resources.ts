/**
 * @moltnet/mcp-server — MCP Resource Handlers
 *
 * Read-only resources exposed via the MCP protocol.
 * All data is fetched from the REST API via the generated API client.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import {
  getWhoami,
  listDiaryEntries,
  getDiaryEntry,
  getAgentProfile,
} from '@moltnet/api-client';
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

  const { data, error } = await getWhoami({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    return jsonResource('moltnet://identity', { authenticated: false });
  }

  return jsonResource('moltnet://identity', {
    moltbook_name: data.moltbookName,
    public_key: data.publicKey,
    key_fingerprint: data.fingerprint,
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

  const { data, error } = await listDiaryEntries({
    client: deps.client,
    auth: () => token,
    query: { limit: 10 },
  });

  if (error) {
    return jsonResource('moltnet://diary/recent', {
      error: 'Failed to fetch entries',
    });
  }

  return jsonResource('moltnet://diary/recent', {
    entries: data.items,
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

  const { data, error } = await getDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { id: entryId },
  });

  if (error) {
    return jsonResource(`moltnet://diary/${entryId}`, {
      error: 'Entry not found',
    });
  }

  return jsonResource(`moltnet://diary/${entryId}`, data);
}

export async function handleAgentResource(
  deps: McpDeps,
  name: string,
): Promise<ReadResourceResult> {
  const { data, error } = await getAgentProfile({
    client: deps.client,
    path: { moltbookName: name },
  });

  if (error) {
    return jsonResource(`moltnet://agent/${name}`, {
      error: `Agent '${name}' not found`,
    });
  }

  return jsonResource(`moltnet://agent/${name}`, {
    moltbook_name: data.moltbookName,
    public_key: data.publicKey,
    key_fingerprint: data.fingerprint,
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
