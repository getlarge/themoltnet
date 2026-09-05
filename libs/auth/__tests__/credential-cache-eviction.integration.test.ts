import { describe, expect, it, vi } from 'vitest';

import { RemoteAuthCache } from '../src/remote-auth-cache.js';
import { createSessionResolver } from '../src/session-resolver.js';
import { createTokenValidator } from '../src/token-validator.js';

const CLIENT_ID = 'hydra-client-uuid';
const IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGENT_ID = '550e8400-e29b-41d4-a716-4466554400aa';
const FIRST_HUMAN_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const SECOND_HUMAN_ID = '7ca7b810-9dad-11d1-80b4-00c04fd430c9';
const OAUTH_ACCESS_TOKEN = 'ory_at_positive_cache_integration';
const KRATOS_SESSION_TOKEN = 'ory_st_positive_cache_integration';

describe('credential lifecycle cache eviction', () => {
  it('refetches an OAuth context after client eviction', async () => {
    const introspectOAuth2Token = vi
      .fn()
      .mockResolvedValueOnce({
        active: true,
        client_id: CLIENT_ID,
        scope: 'diary:read',
        sub: CLIENT_ID,
        ext: {
          'moltnet:agent_id': AGENT_ID,
          'moltnet:identity_id': IDENTITY_ID,
          'moltnet:public_key': 'ed25519:first',
          'moltnet:fingerprint': 'FIRST',
        },
      })
      .mockResolvedValueOnce({
        active: true,
        client_id: CLIENT_ID,
        scope: 'diary:read',
        sub: CLIENT_ID,
        ext: {
          'moltnet:agent_id': AGENT_ID,
          'moltnet:identity_id': IDENTITY_ID,
          'moltnet:public_key': 'ed25519:second',
          'moltnet:fingerprint': 'SECOND',
        },
      });
    const validator = createTokenValidator(
      {
        introspectOAuth2Token,
        getOAuth2Client: vi.fn(),
      } as never,
      { remoteAuthCache: new RemoteAuthCache({ ttlMs: 60_000 }) },
    );

    const first = await validator.resolveAuthContext(OAUTH_ACCESS_TOKEN);
    const cached = await validator.resolveAuthContext(OAUTH_ACCESS_TOKEN);

    expect(first).toMatchObject({ fingerprint: 'FIRST' });
    expect(cached).toMatchObject({ fingerprint: 'FIRST' });
    expect(introspectOAuth2Token).toHaveBeenCalledOnce();

    validator.evictOAuthClient(CLIENT_ID);
    const refreshed = await validator.resolveAuthContext(OAUTH_ACCESS_TOKEN);

    expect(refreshed).toMatchObject({ fingerprint: 'SECOND' });
    expect(introspectOAuth2Token).toHaveBeenCalledTimes(2);
  });

  it('refetches a Kratos session after identity eviction', async () => {
    const toSession = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'session-uuid',
        active: true,
        identity: {
          id: IDENTITY_ID,
          schema_id: 'moltnet_human',
          traits: { email: 'human@example.com' },
          metadata_public: { human_id: FIRST_HUMAN_ID },
        },
      })
      .mockResolvedValueOnce({
        id: 'session-uuid',
        active: true,
        identity: {
          id: IDENTITY_ID,
          schema_id: 'moltnet_human',
          traits: { email: 'human@example.com' },
          metadata_public: { human_id: SECOND_HUMAN_ID },
        },
      });
    const resolver = createSessionResolver({ toSession } as never, {
      remoteAuthCache: new RemoteAuthCache({ ttlMs: 60_000 }),
    });

    const first = await resolver.resolveSession({
      sessionToken: KRATOS_SESSION_TOKEN,
    });
    const cached = await resolver.resolveSession({
      sessionToken: KRATOS_SESSION_TOKEN,
    });

    expect(first).toMatchObject({ humanId: FIRST_HUMAN_ID });
    expect(cached).toMatchObject({ humanId: FIRST_HUMAN_ID });
    expect(toSession).toHaveBeenCalledOnce();

    resolver.evictIdentity(IDENTITY_ID);
    const refreshed = await resolver.resolveSession({
      sessionToken: KRATOS_SESSION_TOKEN,
    });

    expect(refreshed).toMatchObject({ humanId: SECOND_HUMAN_ID });
    expect(toSession).toHaveBeenCalledTimes(2);
  });
});
