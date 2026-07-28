import { describe, expect, it, vi } from 'vitest';

import { resolveRuntimeProfileRouting } from './profile-routing.js';

function source() {
  return {
    runtimeProfiles: {
      list: vi.fn(async () => ({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'default-profile',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'special-profile',
          },
        ],
      })),
    },
  };
}

describe('resolveRuntimeProfileRouting', () => {
  it('resolves profile ids and team-scoped names', async () => {
    const agent = source();
    const routing = await resolveRuntimeProfileRouting(
      agent as never,
      'team-id',
      {
        defaultProfile: 'default-profile',
        lensProfiles: {
          security: '22222222-2222-4222-8222-222222222222',
        },
        synthesisProfile: 'special-profile',
      },
    );

    expect(agent.runtimeProfiles.list).toHaveBeenCalledWith({
      teamId: 'team-id',
    });
    expect(routing).toEqual({
      defaultProfileId: '11111111-1111-4111-8111-111111111111',
      lensProfileIds: {
        security: '22222222-2222-4222-8222-222222222222',
      },
      synthesisProfileId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('fails before task creation when a profile cannot be resolved', async () => {
    await expect(
      resolveRuntimeProfileRouting(source() as never, 'team-id', {
        defaultProfile: 'missing-profile',
      }),
    ).rejects.toThrow(/was not found/);
  });
});
