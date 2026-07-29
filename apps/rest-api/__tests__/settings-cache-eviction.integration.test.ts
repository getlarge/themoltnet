import { readFileSync } from 'node:fs';

import { createSessionResolver, RemoteAuthCache } from '@moltnet/auth';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  TEST_WEBHOOK_API_KEY,
} from './helpers.js';

const IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const FIRST_HUMAN_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const SECOND_HUMAN_ID = '7ca7b810-9dad-11d1-80b4-00c04fd430c9';
const KRATOS_SESSION_TOKEN = 'ory_st_settings_cache_integration';

describe('Kratos settings cache lifecycle', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps validation side-effect free and refetches after the committed hook', async () => {
    let committedHumanId = FIRST_HUMAN_ID;
    const toSession = vi.fn().mockImplementation(async () => ({
      id: 'session-uuid',
      active: true,
      identity: {
        id: IDENTITY_ID,
        schema_id: 'moltnet_human',
        traits: { email: 'human@example.com' },
        metadata_public: { human_id: committedHumanId },
      },
    }));
    const resolver = createSessionResolver({ toSession } as never, {
      remoteAuthCache: new RemoteAuthCache({ ttlMs: 60_000 }),
    });
    app.sessionResolver = resolver;

    const first = await resolver.resolveSession({
      sessionToken: KRATOS_SESSION_TOKEN,
    });
    expect(first).toMatchObject({ humanId: FIRST_HUMAN_ID });

    const validationResponse = await app.inject({
      method: 'POST',
      url: '/hooks/kratos/validate-settings',
      headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
      payload: {
        identity: {
          id: IDENTITY_ID,
          traits: { email: 'human@example.com' },
        },
      },
    });
    expect(validationResponse.statusCode).toBe(200);

    committedHumanId = SECOND_HUMAN_ID;
    const stillCached = await resolver.resolveSession({
      sessionToken: KRATOS_SESSION_TOKEN,
    });
    expect(stillCached).toMatchObject({ humanId: FIRST_HUMAN_ID });
    expect(toSession).toHaveBeenCalledOnce();

    const committedResponse = await app.inject({
      method: 'POST',
      url: '/hooks/kratos/after-settings',
      headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
      payload: {
        identity: {
          id: IDENTITY_ID,
          traits: { email: 'human@example.com' },
        },
      },
    });
    expect(committedResponse.statusCode).toBe(200);

    const refreshed = await resolver.resolveSession({
      sessionToken: KRATOS_SESSION_TOKEN,
    });
    expect(refreshed).toMatchObject({ humanId: SECOND_HUMAN_ID });
    expect(toSession).toHaveBeenCalledTimes(2);
  });

  it.each(['password', 'profile'] as const)(
    'configures %s settings validation before committed side effects',
    (method) => {
      const project = JSON.parse(
        readFileSync(
          new URL('../../../infra/ory/project.json', import.meta.url),
          'utf8',
        ),
      ) as {
        services: {
          identity: {
            config: {
              selfservice: {
                flows: {
                  settings: {
                    after: Record<
                      typeof method,
                      {
                        hooks: Array<{
                          config: {
                            can_interrupt: boolean;
                            response: { ignore: boolean; parse: boolean };
                            url: string;
                          };
                        }>;
                      }
                    >;
                  };
                };
              };
            };
          };
        };
      };

      const hooks =
        project.services.identity.config.selfservice.flows.settings.after[
          method
        ].hooks;

      expect(hooks).toHaveLength(2);
      expect(hooks[0]?.config).toMatchObject({
        can_interrupt: true,
        response: { ignore: false, parse: true },
        url: '${API_BASE_URL}/hooks/kratos/validate-settings',
      });
      expect(hooks[1]?.config).toMatchObject({
        can_interrupt: false,
        response: { ignore: false, parse: false },
        url: '${API_BASE_URL}/hooks/kratos/after-settings',
      });
    },
  );
});
