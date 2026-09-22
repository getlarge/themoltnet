import { MoltNetError } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PROJECT_PAGES,
  readCatalogueProject,
  readCatalogueProjects,
} from './catalogue-project-reader.js';

describe('project catalogue pagination', () => {
  it('reads every page with the exact verified team', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'first' }], nextOffset: 100 })
      .mockResolvedValueOnce({ items: [{ id: 'second' }], nextOffset: null });

    const projects = await readCatalogueProjects({ list }, 'team-a');

    expect(projects).toEqual({
      items: [{ id: 'first' }, { id: 'second' }],
      truncated: false,
    });
    expect(list.mock.calls).toEqual([
      [{ includeArchived: false, limit: 100, offset: 0 }, { teamId: 'team-a' }],
      [
        { includeArchived: false, limit: 100, offset: 100 },
        { teamId: 'team-a' },
      ],
    ]);
  });

  it('rejects a repeated pagination offset instead of looping', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextOffset: 0 });

    await expect(readCatalogueProjects({ list }, 'team-a')).rejects.toThrow(
      'pagination',
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('stops at the page cap and marks the list truncated', async () => {
    let offset = 0;
    const list = vi.fn().mockImplementation(async () => ({
      items: [{ id: `p${offset}` }],
      nextOffset: (offset += 100),
    }));

    const result = await readCatalogueProjects({ list }, 'team-a');

    expect(list).toHaveBeenCalledTimes(MAX_PROJECT_PAGES);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(MAX_PROJECT_PAGES);
  });
});

describe('single project lookup', () => {
  it('returns null when the credential cannot see the project', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(
        new MoltNetError('Not found', { code: 'NOT_FOUND', statusCode: 404 }),
      );

    expect(await readCatalogueProject({ get }, 'team-a', 'p')).toBeNull();
    expect(get).toHaveBeenCalledWith('p', { teamId: 'team-a' });
  });

  it('propagates transport failures for the caller to retry', async () => {
    const get = vi.fn().mockRejectedValue(new Error('socket hang up'));

    await expect(readCatalogueProject({ get }, 'team-a', 'p')).rejects.toThrow(
      'socket hang up',
    );
  });
});
