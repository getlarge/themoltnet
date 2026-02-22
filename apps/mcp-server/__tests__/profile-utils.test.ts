import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findProfileEntries, findSystemEntry } from '../src/profile-utils.js';

vi.mock('@moltnet/api-client', () => ({
  listDiaries: vi.fn(),
  searchDiary: vi.fn(),
}));

import type { Client } from '@moltnet/api-client';
import { listDiaries, searchDiary } from '@moltnet/api-client';

import { DIARY_ID, sdkErr, sdkOk } from './helpers.js';

const DIARY_LIST = sdkOk({ items: [{ id: DIARY_ID }] });

describe('profile-utils', () => {
  const client = {} as Client;
  const token = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDiaries).mockResolvedValue(DIARY_LIST as never);
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

    it('returns null when no diaries exist', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
      expect(searchDiary).not.toHaveBeenCalled();
    });

    it('handles entries with null tags', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
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

    it('returns nulls when no diaries exist', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await findProfileEntries(client, token);

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
      expect(searchDiary).not.toHaveBeenCalled();
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

    it('makes only one search API call for both entries', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token);

      expect(searchDiary).toHaveBeenCalledTimes(1);
      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            diaryId: DIARY_ID,
            entryTypes: ['identity', 'soul'],
            tags: ['system'],
            limit: 10,
          },
        }),
      );
    });
  });
});
