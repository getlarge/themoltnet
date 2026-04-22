import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findProfileEntries, findSystemEntry } from '../src/profile-utils.js';

vi.mock('@moltnet/api-client', () => ({
  listDiaries: vi.fn(),
  searchDiary: vi.fn(),
}));

import type { Client } from '@moltnet/api-client';
import { listDiaries, searchDiary } from '@moltnet/api-client';

import { sdkErr, sdkOk } from './helpers.js';

const DIARY_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('profile-utils', () => {
  const client = {} as Client;
  const token = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDiaries).mockResolvedValue(
      sdkOk({ items: [{ id: DIARY_ID }] }) as never,
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

      const result = await findSystemEntry(client, token, 'identity');

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

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
    });

    it('returns null on API error', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
    });

    it('returns null when listDiaries returns empty', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await findSystemEntry(client, token, 'identity');

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null when listDiaries errors', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findSystemEntry(client, token, 'identity');

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('searches across multiple own diaries and returns first match', async () => {
      const DIARY_ID_2 = '550e8400-e29b-41d4-a716-446655440002';
      vi.mocked(listDiaries).mockResolvedValue(
        sdkOk({ items: [{ id: DIARY_ID }, { id: DIARY_ID_2 }] }) as never,
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

      const result = await findSystemEntry(client, token, 'identity');

      expect(searchDiary).toHaveBeenCalledTimes(2);
      expect(searchDiary).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          body: expect.objectContaining({ diaryId: DIARY_ID }),
        }),
      );
      expect(searchDiary).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          body: expect.objectContaining({ diaryId: DIARY_ID_2 }),
        }),
      );
      expect(result?.id).toBe('entry-in-second-diary');
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

      const result = await findProfileEntries(client, token);

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

      const result = await findProfileEntries(client, token);

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

      const result = await findProfileEntries(client, token);

      expect(result.whoami).not.toBeNull();
      expect(result.soul).toBeNull();
    });

    it('handles API errors gracefully', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findProfileEntries(client, token);

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
    });

    it('returns nulls when listDiaries returns empty', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await findProfileEntries(client, token);

      expect(searchDiary).not.toHaveBeenCalled();
      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
    });

    it('scopes each search call to the own diary id', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token);

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

      await findProfileEntries(client, token);

      const calls = vi.mocked(searchDiary).mock.calls;
      for (const [opts] of calls) {
        expect(
          (opts as { body?: { diaryId?: string } }).body?.diaryId,
        ).toBeDefined();
      }
    });
  });
});
