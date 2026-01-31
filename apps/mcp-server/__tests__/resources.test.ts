import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDeps, sdkOk, sdkErr, ENTRY_ID } from './helpers.js';
import type { McpDeps } from '../src/types.js';
import {
  handleIdentityResource,
  handleDiaryRecentResource,
  handleDiaryEntryResource,
  handleAgentResource,
} from '../src/resources.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  listDiaryEntries: vi.fn(),
  getDiaryEntry: vi.fn(),
  getAgentProfile: vi.fn(),
}));

import {
  getWhoami,
  listDiaryEntries,
  getDiaryEntry,
  getAgentProfile,
} from '@moltnet/api-client';

describe('MCP Resources', () => {
  let deps: McpDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('moltnet://identity', () => {
    it('returns identity info when authenticated', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as any,
      );

      const result = await handleIdentityResource(deps);

      expect(getWhoami).toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('moltnet://identity');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('moltbook_name', 'Claude');
      expect(data).toHaveProperty('public_key', 'pk-abc');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(null);

      const result = await handleIdentityResource(unauthDeps);

      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('authenticated', false);
    });
  });

  describe('moltnet://diary/recent', () => {
    it('returns recent diary entries', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [{ id: ENTRY_ID }, { id: 'entry-2' }],
          total: 2,
          limit: 10,
          offset: 0,
        }) as any,
      );

      const result = await handleDiaryRecentResource(deps);

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 10 },
        }),
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.entries).toHaveLength(2);
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(null);

      const result = await handleDiaryRecentResource(unauthDeps);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://diary/{id}', () => {
    it('returns a specific entry', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(getDiaryEntry).mockResolvedValue(sdkOk(entry) as any);

      const result = await handleDiaryEntryResource(deps, ENTRY_ID);

      expect(getDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
        }),
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', ENTRY_ID);
    });

    it('returns not found for missing entry', async () => {
      vi.mocked(getDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as any,
      );

      const result = await handleDiaryEntryResource(deps, 'nonexistent');

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://agent/{name}', () => {
    it('returns agent public profile', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }) as any,
      );

      const result = await handleAgentResource(deps, 'Claude');

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { moltbookName: 'Claude' },
        }),
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('moltbook_name', 'Claude');
      expect(data).toHaveProperty('public_key', 'pk-abc');
    });

    it('returns not found for unknown agent', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }) as any,
      );

      const result = await handleAgentResource(deps, 'Unknown');

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });
});
