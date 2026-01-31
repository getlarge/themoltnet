import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockApi,
  createMockDeps,
  okResponse,
  errorResponse,
  TOKEN,
  ENTRY_ID,
  type MockApi,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import {
  handleIdentityResource,
  handleDiaryRecentResource,
  handleDiaryEntryResource,
  handleAgentResource,
} from '../src/resources.js';

describe('MCP Resources', () => {
  let api: MockApi;
  let deps: McpDeps;

  beforeEach(() => {
    api = createMockApi();
    deps = createMockDeps(api);
  });

  describe('moltnet://identity', () => {
    it('returns identity info when authenticated', async () => {
      api.get.mockResolvedValue(
        okResponse({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }),
      );

      const result = await handleIdentityResource(deps);

      expect(api.get).toHaveBeenCalledWith('/agents/whoami', TOKEN);
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('moltnet://identity');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('moltbook_name', 'Claude');
      expect(data).toHaveProperty('public_key', 'pk-abc');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(api, null);

      const result = await handleIdentityResource(unauthDeps);

      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('authenticated', false);
    });
  });

  describe('moltnet://diary/recent', () => {
    it('returns recent diary entries', async () => {
      api.get.mockResolvedValue(
        okResponse({
          items: [{ id: ENTRY_ID }, { id: 'entry-2' }],
          total: 2,
          limit: 10,
          offset: 0,
        }),
      );

      const result = await handleDiaryRecentResource(deps);

      expect(api.get).toHaveBeenCalledWith('/diary/entries', TOKEN, {
        limit: 10,
      });
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.entries).toHaveLength(2);
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(api, null);

      const result = await handleDiaryRecentResource(unauthDeps);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://diary/{id}', () => {
    it('returns a specific entry', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      api.get.mockResolvedValue(okResponse(entry));

      const result = await handleDiaryEntryResource(deps, ENTRY_ID);

      expect(api.get).toHaveBeenCalledWith(`/diary/entries/${ENTRY_ID}`, TOKEN);
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', ENTRY_ID);
    });

    it('returns not found for missing entry', async () => {
      api.get.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }),
      );

      const result = await handleDiaryEntryResource(deps, 'nonexistent');

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://agent/{name}', () => {
    it('returns agent public profile', async () => {
      api.get.mockResolvedValue(
        okResponse({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }),
      );

      const result = await handleAgentResource(deps, 'Claude');

      expect(api.get).toHaveBeenCalledWith('/agents/Claude', TOKEN);
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('moltbook_name', 'Claude');
      expect(data).toHaveProperty('public_key', 'pk-abc');
    });

    it('returns not found for unknown agent', async () => {
      api.get.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }),
      );

      const result = await handleAgentResource(deps, 'Unknown');

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });
});
