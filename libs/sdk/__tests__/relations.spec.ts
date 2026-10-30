import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '../src/agent.js';
import { MoltNetError } from '../src/errors.js';
import { connectHuman } from '../src/human.js';

const ENTRY_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const TARGET_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const RELATION_ID = 'cccccccc-0000-4000-8000-000000000003';

describe('RelationsNamespace', () => {
  const get = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  const client = { get, post, patch, delete: del } as unknown as Client;
  const auth = vi.fn().mockResolvedValue('agent-token');
  const relations = createAgent({ client, auth }).relations;

  beforeEach(() => vi.clearAllMocks());

  it('creates a relation and returns the existing or newly created relation', async () => {
    const relation = {
      id: RELATION_ID,
      sourceId: ENTRY_ID,
      targetId: TARGET_ID,
    };
    post.mockResolvedValue({ data: relation });

    await expect(
      relations.create(ENTRY_ID, {
        targetId: TARGET_ID,
        relation: 'supersedes',
        status: 'accepted',
      }),
    ).resolves.toEqual(relation);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/entries/{entryId}/relations',
        path: { entryId: ENTRY_ID },
        body: {
          targetId: TARGET_ID,
          relation: 'supersedes',
          status: 'accepted',
        },
        auth: expect.any(Function),
      }),
    );
  });

  it('lists relations with the generated query filters', async () => {
    const page = { items: [], total: 0, limit: 20, offset: 20 };
    get.mockResolvedValue({ data: page });

    await expect(
      relations.list(ENTRY_ID, {
        direction: 'as_source',
        relation: 'supersedes',
        depth: 2,
        limit: 20,
        offset: 20,
      }),
    ).resolves.toEqual(page);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/entries/{entryId}/relations',
        path: { entryId: ENTRY_ID },
        query: {
          direction: 'as_source',
          relation: 'supersedes',
          depth: 2,
          limit: 20,
          offset: 20,
        },
      }),
    );
  });

  it('updates status by relation ID', async () => {
    const relation = { id: RELATION_ID, status: 'rejected' };
    patch.mockResolvedValue({ data: relation });

    await expect(
      relations.update(RELATION_ID, { status: 'rejected' }),
    ).resolves.toEqual(relation);
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/relations/{id}',
        path: { id: RELATION_ID },
        body: { status: 'rejected' },
      }),
    );
  });

  it('accepts a successful 204 delete with no response body', async () => {
    del.mockResolvedValue({ data: undefined, error: undefined });

    await expect(relations.delete(RELATION_ID)).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/relations/{id}',
        path: { id: RELATION_ID },
      }),
    );
  });

  it('propagates a typed error from a failed delete', async () => {
    del.mockResolvedValue({
      error: { status: 404, title: 'Not Found' },
      response: { status: 404, statusText: 'Not Found' },
    });

    await expect(relations.delete(RELATION_ID)).rejects.toBeInstanceOf(
      MoltNetError,
    );
  });

  it('is also available to a human client', async () => {
    const page = { items: [], total: 0, limit: 10, offset: 0 };
    get.mockResolvedValue({ data: page });
    const human = connectHuman({ client, bearerToken: 'human-token' });

    await expect(human.relations.list(ENTRY_ID)).resolves.toEqual(page);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/entries/{entryId}/relations',
        path: { entryId: ENTRY_ID },
        auth: expect.any(Function),
      }),
    );
  });
});
