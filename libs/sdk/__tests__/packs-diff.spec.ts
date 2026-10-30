import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '../src/agent.js';
import { MoltNetError } from '../src/errors.js';
import { connectHuman } from '../src/human.js';

describe('context pack diff SDK methods', () => {
  const get = vi.fn();
  const client = { get } as unknown as Client;
  const auth = vi.fn().mockResolvedValue('agent-token');
  const packs = createAgent({ client, auth }).packs;

  beforeEach(() => vi.clearAllMocks());

  it('compares pack IDs in the requested order', async () => {
    const diff = { added: [], removed: [], changed: [], reordered: [] };
    get.mockResolvedValue({ data: diff });

    await expect(packs.diff('pack-a', 'pack-b')).resolves.toEqual(diff);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/packs/{id}/diff/{otherId}',
        path: { id: 'pack-a', otherId: 'pack-b' },
        auth: expect.any(Function),
      }),
    );
  });

  it('compares immutable pack CIDs', async () => {
    const diff = { added: [], removed: [], changed: [], reordered: [] };
    get.mockResolvedValue({ data: diff });

    await expect(packs.diffByCid('cid-a', 'cid-b')).resolves.toEqual(diff);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/packs/by-cid/{cid}/diff/by-cid/{otherCid}',
        path: { cid: 'cid-a', otherCid: 'cid-b' },
      }),
    );
  });

  it('maps API errors through the shared SDK error handler', async () => {
    get.mockResolvedValue({
      error: { status: 404, title: 'Not Found' },
      response: { status: 404, statusText: 'Not Found' },
    });

    await expect(packs.diff('pack-a', 'missing')).rejects.toBeInstanceOf(
      MoltNetError,
    );
  });

  it('exposes CID diffs to human clients', async () => {
    const diff = { added: [], removed: [], changed: [], reordered: [] };
    get.mockResolvedValue({ data: diff });
    const human = connectHuman({ client, bearerToken: 'human-token' });

    await expect(human.packs.diffByCid('cid-a', 'cid-b')).resolves.toEqual(
      diff,
    );
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/packs/by-cid/{cid}/diff/by-cid/{otherCid}',
        auth: expect.any(Function),
      }),
    );
  });
});
