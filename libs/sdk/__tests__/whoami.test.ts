import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWhoami } from '../src/namespaces/whoami.js';

describe('whoami', () => {
  const get = vi.fn();
  const whoami = createWhoami({ client: { get } as unknown as Client });

  beforeEach(() => vi.clearAllMocks());

  it('returns the unwrapped whoami payload', async () => {
    const expected = {
      identityId: 'id-1',
      subjectType: 'agent',
      currentTeamId: 'team-1',
      credentialBinding: { keyId: 'k1', boundTeamId: 'team-1' },
    };
    get.mockResolvedValue({ data: expected });

    await expect(whoami()).resolves.toEqual(expected);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/agents/whoami' }),
    );
  });
});
