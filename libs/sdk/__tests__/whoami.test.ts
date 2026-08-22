import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MoltNetError } from '../src/errors.js';
import { createWhoami } from '../src/namespaces/whoami.js';

describe('whoami', () => {
  const get = vi.fn();
  const whoami = createWhoami({ client: { get } as unknown as Client });

  beforeEach(() => vi.clearAllMocks());

  it('returns the unwrapped whoami payload including credentialBinding', async () => {
    const expected = {
      identityId: 'id-1',
      subjectType: 'agent',
      currentTeamId: 'team-1',
      credentialBinding: {
        bindingScope: 'team',
        keyId: 'k1',
        boundTeamId: 'team-1',
      },
    };
    get.mockResolvedValue({ data: expected });

    await expect(whoami()).resolves.toEqual(expected);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/agents/whoami' }),
    );
  });

  it('passes through an agent identity with no credentialBinding', async () => {
    get.mockResolvedValue({
      data: { identityId: 'id-1', subjectType: 'agent', currentTeamId: null },
    });

    const result = await whoami();
    expect(result.credentialBinding).toBeUndefined();
  });

  it('propagates a typed API error with its status code', async () => {
    get.mockResolvedValue({
      error: { status: 401, title: 'Unauthorized' },
      response: { status: 401, statusText: 'Unauthorized' },
    });

    await expect(whoami()).rejects.toBeInstanceOf(MoltNetError);
    await expect(whoami()).rejects.toMatchObject({ statusCode: 401 });
  });
});
