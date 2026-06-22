import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleAgentResource,
  handleDiariesResource,
  handleDiaryEntryResource,
  handleEntriesRecentResource,
  handleIdentityResource,
} from '../src/resources.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  DIARY_ID,
  ENTRY_ID,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  getDiary: vi.fn(),
  searchDiary: vi.fn(),
  getDiaryEntryById: vi.fn(),
  getAgentProfile: vi.fn(),
}));

import {
  getAgentProfile,
  getDiary,
  getDiaryEntryById,
  getWhoami,
  searchDiary,
} from '@moltnet/api-client';

describe('MCP Resources', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('moltnet://identity', () => {
    it('returns identity info when authenticated', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'uuid-1234',
          clientId: 'client-abc',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleIdentityResource(deps, context);

      expect(getWhoami).toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('moltnet://identity');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('identity_id', 'uuid-1234');
      expect(data).toHaveProperty('client_id', 'client-abc');
      expect(data).toHaveProperty('public_key', 'pk-abc');
      expect(data).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const result = await handleIdentityResource(
        deps,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('authenticated', false);
    });
  });

  describe('moltnet://diaries/{diaryId}', () => {
    it('returns diary metadata', async () => {
      vi.mocked(getDiary).mockResolvedValue(
        sdkOk({
          id: DIARY_ID,
          name: 'Private',
          visibility: 'private',
        }) as never,
      );

      const result = await handleDiariesResource(deps, DIARY_ID, context);

      expect(getDiary).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: DIARY_ID } }),
      );
      expect(result.contents[0].uri).toBe(`moltnet://diaries/${DIARY_ID}`);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', DIARY_ID);
    });

    it('returns error when not authenticated', async () => {
      const result = await handleDiariesResource(
        deps,
        DIARY_ID,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });

    it('returns error when diary not found', async () => {
      vi.mocked(getDiary).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Diary not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiariesResource(deps, 'nonexistent', context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://entries/{entryId}', () => {
    it('returns entry using direct path', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(getDiaryEntryById).mockResolvedValue(sdkOk(entry) as never);

      const result = await handleDiaryEntryResource(deps, ENTRY_ID, context);

      expect(getDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { entryId: ENTRY_ID } }),
      );
      expect(result.contents[0].uri).toBe(`moltnet://entries/${ENTRY_ID}`);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', ENTRY_ID);
    });

    it('returns not found for missing entry', async () => {
      vi.mocked(getDiaryEntryById).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiaryEntryResource(
        deps,
        'nonexistent',
        context,
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });

    it('returns error when not authenticated', async () => {
      const result = await handleDiaryEntryResource(
        deps,
        ENTRY_ID,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://entries/recent', () => {
    it('fetches with wRecency=1.0', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [{ id: ENTRY_ID }], total: 1 }) as never,
      );

      const result = await handleEntriesRecentResource(deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { limit: 10, wRecency: 1.0 },
        }),
      );
      expect(result.contents[0].uri).toBe('moltnet://entries/recent');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.entries).toHaveLength(1);
    });

    it('returns error when not authenticated', async () => {
      const result = await handleEntriesRecentResource(
        deps,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://agent/{fingerprint}', () => {
    it('returns agent public profile', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({ publicKey: 'pk-abc', fingerprint: 'fp:abc123' }) as never,
      );

      const result = await handleAgentResource(
        deps,
        'A1B2-C3D4-E5F6-07A8',
        context,
      );

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'A1B2-C3D4-E5F6-07A8' },
        }),
      );
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('public_key', 'pk-abc');
    });

    it('returns not found for unknown agent', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleAgentResource(
        deps,
        'AAAA-BBBB-CCCC-DDDD',
        context,
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });
});
