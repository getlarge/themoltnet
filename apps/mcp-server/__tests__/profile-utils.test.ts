import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findProfileEntries, findSystemEntry } from '../src/profile-utils.js';

vi.mock('@moltnet/api-client', () => ({
  searchDiary: vi.fn(),
}));

import type { Client } from '@moltnet/api-client';
import { searchDiary } from '@moltnet/api-client';

import { sdkErr, sdkOk } from './helpers.js';

const DIARY_ID = '550e8400-e29b-41d4-a716-446655440001';

const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
};

describe('profile-utils', () => {
  const client = {} as Client;
  const token = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
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

      const result = await findSystemEntry(client, token, DIARY_ID, 'identity');

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

      const result = await findSystemEntry(client, token, DIARY_ID, 'identity');

      expect(result).toBeNull();
    });

    it('returns null on API error and logs a warning', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findSystemEntry(
        client,
        token,
        DIARY_ID,
        'identity',
        mockLogger,
      );

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID }),
        expect.any(String),
      );
    });

    it('searches only the provided diary id', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findSystemEntry(client, token, DIARY_ID, 'identity');

      expect(searchDiary).toHaveBeenCalledTimes(1);
      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ diaryId: DIARY_ID }),
        }),
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

      const result = await findProfileEntries(client, token, DIARY_ID);

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

      const result = await findProfileEntries(client, token, DIARY_ID);

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

      const result = await findProfileEntries(client, token, DIARY_ID);

      expect(result.whoami).not.toBeNull();
      expect(result.soul).toBeNull();
    });

    it('returns nulls and logs on API error', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findProfileEntries(
        client,
        token,
        DIARY_ID,
        mockLogger,
      );

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('searches only the provided diary id', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await findProfileEntries(client, token, DIARY_ID);

      expect(searchDiary).toHaveBeenCalledTimes(1);
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
  });
});
