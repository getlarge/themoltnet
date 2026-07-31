import { describe, expect, it, vi } from 'vitest';

import { resolveRuntimeProfileRouting } from './profile-routing.js';

function source() {
  return {
    runtimeProfiles: {
      list: vi.fn(() =>
        Promise.resolve({
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
        }),
      ),
    },
  };
}

describe('resolveRuntimeProfileRouting', () => {
  it('resolves every phase while preserving one team-scoped lookup', async () => {
    const agent = source();
    const routing = await resolveRuntimeProfileRouting(
      agent as never,
      'team-id',
      {
        defaultProfile: 'default-profile',
        plannerProfile: 'special-profile',
        preflightProfile: 'special-profile',
        laneProfiles: {
          security: '22222222-2222-4222-8222-222222222222',
        },
        topicReducerProfile: 'special-profile',
        globalSynthesisProfile: 'special-profile',
      },
    );
    expect(agent.runtimeProfiles.list).toHaveBeenCalledOnce();
    expect(routing).toEqual({
      defaultProfileId: '11111111-1111-4111-8111-111111111111',
      plannerProfileId: '22222222-2222-4222-8222-222222222222',
      preflightProfileId: '22222222-2222-4222-8222-222222222222',
      laneProfileIds: {
        security: '22222222-2222-4222-8222-222222222222',
      },
      topicReducerProfileId: '22222222-2222-4222-8222-222222222222',
      globalSynthesisProfileId: '22222222-2222-4222-8222-222222222222',
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
