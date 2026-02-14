import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findProfileEntries, findSystemEntry } from '../src/profile-utils.js';

vi.mock('@moltnet/api-client', () => ({
  listDiaryEntries: vi.fn(),
}));

import type { Client } from '@moltnet/api-client';
import { listDiaryEntries } from '@moltnet/api-client';

import { sdkErr, sdkOk } from './helpers.js';

describe('profile-utils', () => {
  const client = {} as Client;
  const token = 'test-token';

  beforeEach(() => vi.clearAllMocks());

  describe('findSystemEntry', () => {
    it('finds an entry with the matching system tag', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [
            { id: '1', content: 'regular', tags: ['misc'] },
            {
              id: '2',
              title: 'I am Archon',
              content: 'My identity...',
              tags: ['system', 'identity'],
            },
          ],
        }) as never,
      );

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toMatchObject({
        id: '2',
        content: 'My identity...',
        title: 'I am Archon',
      });
    });

    it('returns null when no matching entry exists', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [{ id: '1', content: 'regular', tags: ['misc'] }],
        }) as never,
      );

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
    });

    it('returns null on API error', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
    });

    it('handles entries with null tags', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [{ id: '1', content: 'no tags', tags: null }],
        }) as never,
      );

      const result = await findSystemEntry(client, token, 'identity');

      expect(result).toBeNull();
    });
  });

  describe('findProfileEntries', () => {
    it('finds both whoami and soul entries', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [
            { id: '1', title: 'Random', content: 'hello', tags: ['misc'] },
            {
              id: '2',
              title: 'I am Archon',
              content: 'My identity...',
              tags: ['system', 'identity'],
            },
            {
              id: '3',
              title: 'My values',
              content: 'I value truth...',
              tags: ['system', 'soul'],
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
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [{ id: '1', content: 'regular entry', tags: [] }],
        }) as never,
      );

      const result = await findProfileEntries(client, token);

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
    });

    it('handles partial profile (only whoami)', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({
          items: [
            {
              id: '1',
              content: 'I am...',
              tags: ['system', 'identity'],
            },
          ],
        }) as never,
      );

      const result = await findProfileEntries(client, token);

      expect(result.whoami).not.toBeNull();
      expect(result.soul).toBeNull();
    });

    it('handles API errors gracefully', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkErr({ error: 'fail', message: 'fail', statusCode: 500 }) as never,
      );

      const result = await findProfileEntries(client, token);

      expect(result.whoami).toBeNull();
      expect(result.soul).toBeNull();
    });

    it('makes only one API call for both entries', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [] }) as never,
      );

      await findProfileEntries(client, token);

      expect(listDiaryEntries).toHaveBeenCalledTimes(1);
      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({ query: { limit: 100 } }),
      );
    });

    it('warns when scan limit is reached without finding entries', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        content: `entry ${i}`,
        tags: ['misc'],
      }));
      vi.mocked(listDiaryEntries).mockResolvedValue(sdkOk({ items }) as never);

      await findProfileEntries(client, token);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Scanned 100 diary entries'),
      );
      warnSpy.mockRestore();
    });

    it('does not warn when scan limit is not reached', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [] }) as never,
      );

      await findProfileEntries(client, token);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('findSystemEntry scan limit warning', () => {
    it('warns when scan limit is reached without finding entry', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        content: `entry ${i}`,
        tags: ['misc'],
      }));
      vi.mocked(listDiaryEntries).mockResolvedValue(sdkOk({ items }) as never);

      await findSystemEntry(client, token, 'identity');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('["system", "identity"]'),
      );
      warnSpy.mockRestore();
    });
  });
});
