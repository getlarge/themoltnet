import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MoltNetError } from '../src/errors.js';
import { createAgentKeysNamespace } from '../src/namespaces/agent-keys.js';

const TEAM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const KEY_ID = '01JKEY00000000000000000001';

describe('AgentKeysNamespace', () => {
  const get = vi.fn();
  const post = vi.fn();
  const namespace = createAgentKeysNamespace({
    client: { get, post } as unknown as Client,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists keys in the requested team context', async () => {
    const expected = { items: [], nextCursor: null };
    get.mockResolvedValue({ data: expected });

    await expect(
      namespace.list(
        { agentId: 'bbbbbbbb-0000-4000-8000-000000000002' },
        { teamId: TEAM_ID },
      ),
    ).resolves.toEqual(expected);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/agent-keys',
        headers: { 'x-moltnet-team-id': TEAM_ID },
        query: {
          agentId: 'bbbbbbbb-0000-4000-8000-000000000002',
        },
      }),
    );
  });

  it('issues, rotates, and revokes through typed operations', async () => {
    const issued = {
      key: {
        id: KEY_ID,
        agentId: 'bbbbbbbb-0000-4000-8000-000000000002',
        teamId: TEAM_ID,
        name: 'daemon',
        status: 'active',
        createdAt: null,
        expiresAt: null,
        revokedAt: null,
        revocationReason: null,
        revocationDescription: null,
      },
      secret: 'ory_ak_secret',
    };
    post.mockResolvedValue({ data: issued });

    await expect(
      namespace.create(
        {
          agentId: 'bbbbbbbb-0000-4000-8000-000000000002',
          name: 'daemon',
        },
        { teamId: TEAM_ID, idempotencyKey: 'sdk-test-request' },
      ),
    ).resolves.toEqual(issued);
    await expect(
      namespace.rotate(KEY_ID, { teamId: TEAM_ID }),
    ).resolves.toEqual(issued);
    await expect(
      namespace.revoke(
        KEY_ID,
        { reason: 'key_compromise' },
        { teamId: TEAM_ID },
      ),
    ).resolves.toBeUndefined();

    expect(post).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: '/agent-keys',
        headers: expect.objectContaining({
          'idempotency-key': 'sdk-test-request',
          'x-moltnet-team-id': TEAM_ID,
        }),
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: '/agent-keys/{keyId}/rotate',
        path: { keyId: KEY_ID },
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: '/agent-keys/{keyId}/revoke',
        path: { keyId: KEY_ID },
        body: { reason: 'key_compromise' },
      }),
    );
  });

  it('uses explicit identity binding without a team header', async () => {
    const issued = {
      key: {
        id: KEY_ID,
        agentId: 'bbbbbbbb-0000-4000-8000-000000000002',
        bindingScope: 'identity',
      },
      secret: 'ory_ak_identity',
    };
    get.mockResolvedValue({ data: { items: [issued.key], nextCursor: null } });
    post.mockResolvedValue({ data: issued });
    const binding = { bindingScope: 'identity' as const };

    await namespace.list(undefined, binding);
    await namespace.create(
      {
        agentId: 'bbbbbbbb-0000-4000-8000-000000000002',
        name: 'portable',
      },
      { ...binding, idempotencyKey: 'identity-sdk-request' },
    );
    await namespace.rotate(KEY_ID, binding);
    await namespace.revoke(KEY_ID, { reason: 'superseded' }, binding);

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { bindingScope: 'identity' },
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        headers: expect.objectContaining({
          'idempotency-key': 'identity-sdk-request',
        }),
        body: expect.objectContaining({ bindingScope: 'identity' }),
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: { bindingScope: 'identity' },
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        query: { bindingScope: 'identity' },
      }),
    );
    for (const options of [
      get.mock.calls[0]?.[0],
      post.mock.calls[0]?.[0],
      post.mock.calls[1]?.[0],
      post.mock.calls[2]?.[0],
    ]) {
      expect(options?.headers).not.toHaveProperty('x-moltnet-team-id');
    }
  });

  it('strips undefined query filters before sending', async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });

    await namespace.list(
      { agentId: 'bbbbbbbb-0000-4000-8000-000000000002', status: undefined },
      { teamId: TEAM_ID },
    );

    // status was undefined, so it must not appear in the serialized query.
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { agentId: 'bbbbbbbb-0000-4000-8000-000000000002' },
      }),
    );
  });

  it('lists with no filters when query is undefined', async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });

    await namespace.list(undefined, { teamId: TEAM_ID });

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/agent-keys',
        headers: { 'x-moltnet-team-id': TEAM_ID },
        query: undefined,
      }),
    );
  });

  it('omits the query when every filter is undefined', async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });

    // An all-undefined query must serialize identically to an omitted one
    // (query: undefined), not collapse to an empty object.
    await namespace.list(
      {
        agentId: undefined,
        status: undefined,
        limit: undefined,
        cursor: undefined,
      },
      { teamId: TEAM_ID },
    );

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/agent-keys', query: undefined }),
    );
  });

  it('round-trips the continuation cursor', async () => {
    get.mockResolvedValue({
      data: { items: [], nextCursor: null },
    });

    await namespace.list({ cursor: 'page-2-cursor' }, { teamId: TEAM_ID });

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { cursor: 'page-2-cursor' },
      }),
    );
  });

  it('propagates a typed API error with its status code', async () => {
    get.mockResolvedValue({
      error: {
        status: 403,
        title: 'Forbidden',
        detail: 'not a member of this team',
      },
      response: { status: 403, statusText: 'Forbidden' },
    });

    await expect(
      namespace.list(undefined, { teamId: TEAM_ID }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      namespace.list(undefined, { teamId: TEAM_ID }),
    ).rejects.toBeInstanceOf(MoltNetError);
  });

  it('throws when revoke returns an error response', async () => {
    post.mockResolvedValue({
      error: { status: 404, title: 'Not Found' },
      response: { status: 404, statusText: 'Not Found' },
    });

    await expect(
      namespace.revoke(
        KEY_ID,
        { reason: 'key_compromise' },
        { teamId: TEAM_ID },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
