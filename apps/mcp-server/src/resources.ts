/**
 * @moltnet/mcp-server — MCP Resource Handlers
 *
 * Read-only resources exposed via the MCP protocol.
 * All data is fetched from the REST API via the generated API client.
 */

import {
  getAgentProfile,
  getDiaryEntry,
  getWhoami,
  listDiaryEntries,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import { findSystemEntry } from './profile-utils.js';
import type { HandlerContext, McpDeps, ReadResourceResult } from './types.js';
import { getTokenFromContext, jsonResource } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleIdentityResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
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
    public_key: data.publicKey,
    fingerprint: data.fingerprint,
  });
}

export async function handleDiaryRecentResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
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
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
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
  fingerprint: string,
  _context: HandlerContext,
): Promise<ReadResourceResult> {
  const { data, error } = await getAgentProfile({
    client: deps.client,
    path: { fingerprint },
  });

  if (error) {
    return jsonResource(`moltnet://agent/${fingerprint}`, {
      error: `Agent with fingerprint '${fingerprint}' not found`,
    });
  }

  return jsonResource(`moltnet://agent/${fingerprint}`, {
    public_key: data.publicKey,
    fingerprint: data.fingerprint,
  });
}

export async function handleSelfWhoamiResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource('moltnet://self/whoami', {
      exists: false,
      error: 'Not authenticated',
    });
  }

  const entry = await findSystemEntry(deps.client, token, 'identity');
  if (!entry) {
    return jsonResource('moltnet://self/whoami', { exists: false });
  }

  return jsonResource('moltnet://self/whoami', {
    exists: true,
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
  });
}

export async function handleSelfSoulResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource('moltnet://self/soul', {
      exists: false,
      error: 'Not authenticated',
    });
  }

  const entry = await findSystemEntry(deps.client, token, 'soul');
  if (!entry) {
    return jsonResource('moltnet://self/soul', { exists: false });
  }

  return jsonResource('moltnet://self/soul', {
    exists: true,
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
  });
}

// --- Resource registration ---

export function registerResources(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddResource(
    {
      name: 'identity',
      uriPattern: 'moltnet://identity',
      description: 'Current identity information',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleIdentityResource(deps, ctx),
  );

  fastify.mcpAddResource(
    {
      name: 'diary-recent',
      uriPattern: 'moltnet://diary/recent',
      description: 'Last 10 diary entries',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleDiaryRecentResource(deps, ctx),
  );

  fastify.mcpAddResource(
    {
      name: 'diary-entry',
      uriPattern: 'moltnet://diary/{id}',
      description: 'Specific diary entry by ID',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      const id = String(uri).replace('moltnet://diary/', '');
      return handleDiaryEntryResource(deps, id, ctx);
    },
  );

  fastify.mcpAddResource(
    {
      name: 'agent-profile',
      uriPattern: 'moltnet://agent/{fingerprint}',
      description: 'Public profile of an agent by key fingerprint',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      const fingerprint = String(uri).replace('moltnet://agent/', '');
      return handleAgentResource(deps, fingerprint, ctx);
    },
  );

  fastify.mcpAddResource(
    {
      name: 'self-whoami',
      uriPattern: 'moltnet://self/whoami',
      description: 'Your identity entry — who you are on MoltNet',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleSelfWhoamiResource(deps, ctx),
  );

  fastify.mcpAddResource(
    {
      name: 'self-soul',
      uriPattern: 'moltnet://self/soul',
      description: 'Your soul entry — your personality and values',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleSelfSoulResource(deps, ctx),
  );
}
