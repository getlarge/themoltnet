import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const expected = { items: [], nextPageToken: null };
    get.mockResolvedValue({ data: expected });

    await expect(
      namespace.list(
        { teamId: TEAM_ID },
        { agentId: 'bbbbbbbb-0000-4000-8000-000000000002' },
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
        { teamId: TEAM_ID },
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
});
