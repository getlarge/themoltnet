import { describe, expect, it, vi } from 'vitest';

import { readCatalogueProjects } from './catalogue-project-reader.js';

describe('project catalogue pagination', () => {
  it('reads every page with the exact verified team', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'first' }], nextOffset: 100 })
      .mockResolvedValueOnce({ items: [{ id: 'second' }], nextOffset: null });

    const projects = await readCatalogueProjects({ list }, 'team-a');

    expect(projects).toEqual([{ id: 'first' }, { id: 'second' }]);
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
});
