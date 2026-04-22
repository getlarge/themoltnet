import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findProfileEntries, findSystemEntry } from '../src/profile-utils.js';

vi.mock('@moltnet/api-client', () => ({
  listDiaries: vi.fn(),
  searchDiary: vi.fn(),
}));

import type { Client } from '@moltnet/api-client';
import { listDiaries, searchDiary } from '@moltnet/api-client';

import { sdkErr, sdkOk } from './helpers.js';

const AGENT_IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440099';
const DIARY_ID = '550e8400-e29b-41d4-a716-446655440001';
const DIARY_ID_2 = '550e8400-e29b-41d4-a716-446655440002';
const TEAM_DIARY_ID = '550e8400-e29b-41d4-a716-446655440003';

const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
};

describe('profile-utils', () => {
  const client = {} as Client;
  const token = 'test-token';
  const identityId = AGENT_IDENTITY_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDiaries).mockResolvedValue(
      sdkOk({
        items: [{ id: DIARY_ID, createdBy: AGENT_IDENTITY_ID }],
      }) as never,
    );
  });

  describe('findSystemEntry', () => {
    it('finds an entry with the matching system tag', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '2',
              title: 'I am Archon',
              content: 'My identity...',
              tags: ['system', 'identity'],
              entryType: 'identity',
            },
          ],
        }) as never,
      );

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
      );

      expect(listDiaries).toHaveBeenCalledWith(
        expect.objectContaining({ client, auth: expect.any(Function) }),
      );
      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            diaryId: DIARY_ID,
            entryTypes: ['identity'],
            tags: ['system'],
            limit: 1,
          },
        }),
      );
      expect(result).toMatchObject({
        id: '2',
        content: 'My identity...',
        title: 'I am Archon',
      });
    });

    it('returns null when no matching entry exists', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
      );

      expect(result).toBeNull();
    });

    it('returns null on searchDiary API error and logs a warning', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
        mockLogger,
      );

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID }),
        expect.any(String),
      );
    });

    it('returns null when listDiaries returns empty (agent owns no diaries)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
      );

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null and logs when listDiaries errors (does not call searchDiary)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
        mockLogger,
      );

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('excludes team diaries owned by a different agent (cross-tenant isolation)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: TEAM_DIARY_ID, createdBy: OTHER_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findSystemEntry(client, token, identityId, 'identity');

      expect(searchDiary).toHaveBeenCalledTimes(1);
      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ diaryId: DIARY_ID }),
        }),
      );
      expect(searchDiary).not.toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ diaryId: TEAM_DIARY_ID }),
        }),
      );
    });

    it('searches all own diaries in parallel and returns first match', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: DIARY_ID_2, createdBy: AGENT_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary)
        .mockResolvedValueOnce(sdkOk({ results: [] }) as never)
        .mockResolvedValueOnce(
          sdkOk({
            results: [
              {
                id: 'entry-in-second-diary',
                content: 'Found in second diary',
                tags: ['system', 'identity'],
                entryType: 'identity',
              },
            ],
          }) as never,
        );

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
      );

      expect(searchDiary).toHaveBeenCalledTimes(2);
      expect(result?.id).toBe('entry-in-second-diary');
    });

    it('skips errored diary and returns result from next diary', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: DIARY_ID_2, createdBy: AGENT_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary)
        .mockResolvedValueOnce(
          sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
        )
        .mockResolvedValueOnce(
          sdkOk({
            results: [
              {
                id: 'fallback-entry',
                content: 'Recovered from second diary',
                tags: ['system', 'identity'],
                entryType: 'identity',
              },
            ],
          }) as never,
        );

      const result = await findSystemEntry(
        client,
        token,
        identityId,
        'identity',
        mockLogger,
      );

      expect(result?.id).toBe('fallback-entry');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID }),
        expect.any(String),
      );
    });
  });

  describe('findProfileEntries', () => {
    it('finds both whoami and soul entries', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '2',
              title: 'I am Archon',
              content: 'My identity...',
              tags: ['system', 'identity'],
              entryType: 'identity',
            },
            {
              id: '3',
              title: 'My values',
              content: 'I value truth...',
              tags: ['system', 'soul'],
              entryType: 'soul',
            },
          ],
        }) as never,
      );

      const result = await findProfileEntries(client, token, identityId);

      expect(result.whoami).toMatchObject({
        id: '2',
        content: 'My identity...',
      });
      expect(result.soul).toMatchObject({
        id: '3',
        content: 'I value truth...',
      });
    });

    it('returns nulls when no system entries exist', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await findProfileEntries(client, token, identityId);

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
    });

    it('handles partial profile (only whoami)', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '1',
              content: 'I am...',
              tags: ['system', 'identity'],
              entryType: 'identity',
            },
          ],
        }) as never,
      );

      const result = await findProfileEntries(client, token, identityId);

      expect(result.whoami).not.toBeNull();
      expect(result.soul).toBeNull();
    });

    it('handles searchDiary API error gracefully, returns nulls and logs', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findProfileEntries(
        client,
        token,
        identityId,
        mockLogger,
      );

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('returns nulls when listDiaries returns empty (agent owns no diaries)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await findProfileEntries(client, token, identityId);

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
    });

    it('returns nulls and logs when listDiaries errors (does not call searchDiary)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findProfileEntries(
        client,
        token,
        identityId,
        mockLogger,
      );

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('excludes team diaries owned by a different agent (cross-tenant isolation)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: TEAM_DIARY_ID, createdBy: OTHER_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token, identityId);

      const calls = vi.mocked(searchDiary).mock.calls;
      expect(calls).toHaveLength(1);
      expect(
        (calls[0][0] as { body?: { diaryId?: string } }).body?.diaryId,
      ).toBe(DIARY_ID);
    });

    it('scopes each search call to the own diary id', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token, identityId);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            diaryId: DIARY_ID,
            entryTypes: ['identity', 'soul'],
            tags: ['system'],
            limit: 10,
          }),
        }),
      );
    });

    it('never searches without a diary id (prevents cross-tenant leak)', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token, identityId);

      const calls = vi.mocked(searchDiary).mock.calls;
      for (const [opts] of calls) {
        expect(
          (opts as { body?: { diaryId?: string } }).body?.diaryId,
        ).toBeDefined();
      }
    });

    it('accumulates whoami from one diary and soul from another', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: DIARY_ID_2, createdBy: AGENT_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary)
        .mockResolvedValueOnce(
          sdkOk({
            results: [
              {
                id: 'whoami-in-diary-1',
                content: 'I am Agent',
                tags: ['system', 'identity'],
                entryType: 'identity',
              },
            ],
          }) as never,
        )
        .mockResolvedValueOnce(
          sdkOk({
            results: [
              {
                id: 'soul-in-diary-2',
                content: 'I value truth',
                tags: ['system', 'soul'],
                entryType: 'soul',
              },
            ],
          }) as never,
        );

      const result = await findProfileEntries(client, token, identityId);

      expect(result.whoami?.id).toBe('whoami-in-diary-1');
      expect(result.soul?.id).toBe('soul-in-diary-2');
    });

    it('skips errored diary and accumulates results from remaining diaries', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: DIARY_ID_2, createdBy: AGENT_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary)
        .mockResolvedValueOnce(
          sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
        )
        .mockResolvedValueOnce(
          sdkOk({
            results: [
              {
                id: 'whoami-from-fallback',
                content: 'I am Agent (from diary 2)',
                tags: ['system', 'identity'],
                entryType: 'identity',
              },
            ],
          }) as never,
        );

      const result = await findProfileEntries(
        client,
        token,
        identityId,
        mockLogger,
      );

      expect(result.whoami?.id).toBe('whoami-from-fallback');
      expect(result.soul).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID }),
        expect.any(String),
      );
    });

    it('issues parallel searchDiary calls (one per owned diary)', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({
          items: [
            { id: DIARY_ID, createdBy: AGENT_IDENTITY_ID },
            { id: DIARY_ID_2, createdBy: AGENT_IDENTITY_ID },
          ],
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token, identityId);

      expect(searchDiary).toHaveBeenCalledTimes(2);
    });
  });
});
