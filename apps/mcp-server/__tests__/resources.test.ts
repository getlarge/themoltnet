import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleAgentResource,
  handleDiaryEntryResource,
  handleDiaryRecentResource,
  handleIdentityResource,
  handleSelfSoulResource,
  handleSelfWhoamiResource,
} from '../src/resources.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  ENTRY_ID,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  listDiaries: vi.fn(),
  searchDiary: vi.fn(),
  getDiaryEntry: vi.fn(),
  getAgentProfile: vi.fn(),
}));

import {
  getAgentProfile,
  getDiaryEntry,
  getWhoami,
  listDiaries,
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
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleIdentityResource(deps, context);

      expect(getWhoami).toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('moltnet://identity');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('public_key', 'pk-abc');
      expect(data).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleIdentityResource(deps, unauthContext);

      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('authenticated', false);
    });
  });

  describe('moltnet://diary/recent', () => {
    it('returns recent diary entries', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [{ id: ENTRY_ID }, { id: 'entry-2' }],
          total: 2,
        }) as never,
      );

      const result = await handleDiaryRecentResource(deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { limit: 10 },
        }),
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.entries).toHaveLength(2);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleDiaryRecentResource(deps, unauthContext);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://diary/{id}', () => {
    it('returns a specific entry', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [{ id: 'diary-uuid-1' }],
        }) as never,
      );
      vi.mocked(getDiaryEntry).mockResolvedValue(sdkOk(entry) as never);

      const result = await handleDiaryEntryResource(deps, ENTRY_ID, context);

      expect(listDiaries).toHaveBeenCalled();
      expect(getDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'diary-uuid-1', id: ENTRY_ID },
        }),
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', ENTRY_ID);
    });

    it('returns not found for missing entry', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [{ id: 'diary-uuid-1' }],
        }) as never,
      );
      vi.mocked(getDiaryEntry).mockResolvedValue(
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
  });

  describe('moltnet://agent/{fingerprint}', () => {
    it('returns agent public profile', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
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
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('public_key', 'pk-abc');
      expect(data).toHaveProperty('fingerprint', 'fp:abc123');
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

  describe('moltnet://self/whoami', () => {
    it('returns whoami entry when it exists', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '1',
              title: 'I am Archon',
              content: 'My identity...',
              tags: ['system', 'identity'],
              entryType: 'identity',
            },
          ],
        }) as never,
      );

      const result = await handleSelfWhoamiResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', true);
      expect(data).toHaveProperty('content', 'My identity...');
      expect(data).toHaveProperty('title', 'I am Archon');
      expect(result.contents[0].uri).toBe('moltnet://self/whoami');
    });

    it('returns exists:false when no whoami entry', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleSelfWhoamiResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', false);
    });

    it('returns exists:false when not authenticated', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleSelfWhoamiResource(deps, unauthContext);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', false);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://self/soul', () => {
    it('returns soul entry when it exists', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '2',
              title: 'My values',
              content: 'I value truth...',
              tags: ['system', 'soul'],
              entryType: 'soul',
            },
          ],
        }) as never,
      );

      const result = await handleSelfSoulResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', true);
      expect(data).toHaveProperty('content', 'I value truth...');
      expect(result.contents[0].uri).toBe('moltnet://self/soul');
    });

    it('returns exists:false when no soul entry', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleSelfSoulResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', false);
    });
  });
});
