import { DBOSErrors } from '@moltnet/database';
import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  DCR_MAX_SCOPES,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockOnboardHuman, mockOnboardingResult, mockStartWorkflow } =
  vi.hoisted(() => ({
    mockOnboardHuman: vi.fn(),
    mockOnboardingResult: vi.fn(),
    mockStartWorkflow: vi.fn(),
  }));

vi.mock('@moltnet/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DBOS: { startWorkflow: mockStartWorkflow },
}));

vi.mock('../src/workflows/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  humanOnboardingWorkflow: { onboardHuman: mockOnboardHuman },
}));

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  OWNER_IDENTITY_ID,
  resetMockServices,
  TEST_WEBHOOK_API_KEY,
} from './helpers.js';

const HUMAN_ID = '110e8400-e29b-41d4-a716-446655440099';
const HUMAN_IDENTITY_ID = '220e8400-e29b-41d4-a716-446655440088';

describe('Hook routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    // Hooks don't require auth (they're called by Ory services)
    app = await createTestApp(mocks, null);
    app.sessionResolver = {
      evictIdentity: vi.fn(),
      resolveSession: vi.fn(),
    };
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    // Schema rejection can leave a one-shot Ory response unconsumed. Tests
    // are shuffled, so reset this app-owned mock as well as the repositories.
    vi.mocked(app.oauth2Client.getOAuth2Client)
      .mockReset()
      .mockResolvedValue({
        client_id: 'test-client-id',
        metadata: { identity_id: OWNER_ID },
      });
    mockStartWorkflow
      .mockReset()
      .mockReturnValue(
        vi.fn().mockResolvedValue({ getResult: mockOnboardingResult }),
      );
    mockOnboardingResult.mockReset().mockResolvedValue({
      humanId: HUMAN_ID,
      identityId: HUMAN_IDENTITY_ID,
      personalTeamId: '330e8400-e29b-41d4-a716-446655440077',
    });
    vi.mocked(app.sessionResolver!.evictIdentity).mockClear();
    mocks.cryptoService.parsePublicKey.mockReturnValue(new Uint8Array(32));
    mocks.cryptoService.generateFingerprint.mockReturnValue(
      'C212-DAFA-27C5-6C57',
    );
  });

  describe('POST /hooks/kratos/after-login', () => {
    const updatedAt = new Date('2026-09-12T10:00:00.000Z');
    const payload = {
      identity: {
        id: HUMAN_IDENTITY_ID,
        schema_id: 'moltnet_human',
        traits: { email: 'human@test.local', username: 'human' },
        metadata_public: { human_id: HUMAN_ID },
      },
    };

    beforeEach(() => {
      mocks.humanRepository.findById.mockResolvedValue({
        id: HUMAN_ID,
        identityId: null,
        createdAt: updatedAt,
        updatedAt,
      });
    });

    it('queues onboarding with transient human-level deduplication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-login',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockStartWorkflow).toHaveBeenCalledWith(mockOnboardHuman, {
        workflowID: `human-onboarding:${HUMAN_ID}:${HUMAN_IDENTITY_ID}:${updatedAt.getTime()}`,
        queueName: 'human-onboarding',
        enqueueOptions: { deduplicationID: HUMAN_ID },
        duplicationPolicy: 'reject',
        timeoutMS: 60_000,
      });
      expect(mockOnboardingResult).toHaveBeenCalledOnce();
    });

    it('treats concurrent onboarding for the same human as already in progress', async () => {
      mockStartWorkflow.mockImplementationOnce(() => async () => {
        throw new DBOSErrors.DBOSQueueDuplicatedError(
          'existing-workflow',
          'human-onboarding',
          HUMAN_ID,
        );
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-login',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(mockOnboardingResult).not.toHaveBeenCalled();
    });
  });

  describe('POST /hooks/kratos/after-registration', () => {
    const validHumanPayload = {
      identity: {
        id: '00000000-0000-0000-0000-000000000000', // empty UUID from Kratos
        schema_id: 'moltnet_human',
        traits: {
          email: 'human@test.local',
          username: 'testuser',
        },
      },
    };

    it('creates human placeholder when schema is human', async () => {
      mocks.humanRepository.create.mockResolvedValue({
        id: HUMAN_ID,
        identityId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identity.metadata_public).toEqual({
        human_id: HUMAN_ID,
      });
      expect(mocks.humanRepository.create).toHaveBeenCalled();
    });

    it('rejects non-human schema registration', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            schema_id: 'moltnet_agent',
            traits: { email: 'a@b.c', username: 'x' },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].messages[0].id).toBe(4000010);
      expect(mocks.humanRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /hooks/kratos/validate-settings', () => {
    const CURRENT_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
    const OTHER_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0yLWZvci11bml0LXRlc3Q=';

    // Decode real key bytes so the stored and submitted keys compare by value.
    const decodeKeys = () =>
      mocks.cryptoService.parsePublicKey.mockImplementation((key: string) =>
        Uint8Array.from(Buffer.from(key.replace(/^ed25519:/, ''), 'base64')),
      );

    const submit = (publicKey: string, identityId = OWNER_IDENTITY_ID) =>
      app.inject({
        method: 'POST',
        url: '/hooks/kratos/validate-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: { id: identityId, traits: { public_key: publicKey } },
        },
      });

    const expectKeyChangeRejected = (
      response: Awaited<ReturnType<typeof submit>>,
    ) => {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              instance_ptr: '#/traits/public_key',
            }),
          ],
        }),
      );
    };

    it('accepts the unchanged public key a password change resubmits', async () => {
      decodeKeys();
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent({ publicKey: CURRENT_KEY }),
      );

      const response = await submit(CURRENT_KEY);

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mocks.agentRepository.findByIdentityId).toHaveBeenCalledWith(
        OWNER_IDENTITY_ID,
      );
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
      expect(app.sessionResolver?.evictIdentity).not.toHaveBeenCalled();
    });

    it('rejects a different public key', async () => {
      decodeKeys();
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent({ publicKey: CURRENT_KEY }),
      );

      expectKeyChangeRejected(await submit(OTHER_KEY));
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
    });

    it('rejects a public key for an identity without an agent', async () => {
      decodeKeys();
      mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

      expectKeyChangeRejected(await submit(CURRENT_KEY));
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
    });

    it('returns an Ory validation error for an invalid public key', async () => {
      mocks.cryptoService.parsePublicKey.mockImplementation(() => {
        throw new Error('invalid key');
      });

      const response = await submit('invalid', OWNER_ID);

      expectKeyChangeRejected(response);
      expect(mocks.agentRepository.findByIdentityId).not.toHaveBeenCalled();
      expect(app.sessionResolver?.evictIdentity).not.toHaveBeenCalled();
    });
  });

  describe('POST /hooks/kratos/after-settings', () => {
    it('evicts the identity without projecting an agent key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0yLWZvci11bml0LXRlc3Q=',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(app.sessionResolver?.evictIdentity).toHaveBeenCalledWith(OWNER_ID);
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
    });

    it('evicts human sessions after password settings without an agent key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: HUMAN_IDENTITY_ID,
            traits: { email: 'human@test.local', username: 'human' },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
      expect(app.sessionResolver?.evictIdentity).toHaveBeenCalledWith(
        HUMAN_IDENTITY_ID,
      );
    });
  });

  describe('POST /hooks/hydra/token-exchange', () => {
    it('enriches token with agent claims', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent(),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token).toEqual({
        // Two separate claims for two separate things: agent_id is the Keto
        // subject and FK target, identity_id is only the Ory binding.
        'moltnet:agent_id': OWNER_ID,
        'moltnet:identity_id': OWNER_IDENTITY_ID,
        'moltnet:public_key':
          'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
        'moltnet:fingerprint': 'C212-DAFA-27C5-6C57',
        'moltnet:subject_type': 'agent',
      });
    });

    it('enriches token with human claims from session', async () => {
      // Client has no MoltNet agent metadata (DCR client)
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });

      mocks.humanRepository.findByIdentityId.mockResolvedValue({
        id: HUMAN_ID,
        identityId: HUMAN_IDENTITY_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {
            id_token: {
              subject: HUMAN_IDENTITY_ID,
            },
          },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
            // A real grant always carries these; the cap now refuses a
            // request that presents none rather than reading it as "no
            // scopes granted".
            granted_scopes: ['openid', 'diary:read'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token).toEqual({
        'moltnet:identity_id': HUMAN_IDENTITY_ID,
        'moltnet:human_id': HUMAN_ID,
        'moltnet:subject_type': 'human',
      });
    });

    it.each([
      ['exact scopes', ['openid', 'profile', 'email']],
      ['empty scopes', []],
      ['omitted scopes', undefined],
    ])('preserves identity-only OIDC claims with %s', async (_name, scopes) => {
      vi.mocked(app.oauth2Client.getOAuth2Client).mockResolvedValueOnce({
        client_id: 'tailscale-login',
        metadata: {},
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: ['https://login.tailscale.com/a/oauth_response'],
        scope: 'openid profile email',
        audience: [],
      });
      mocks.humanRepository.findByIdentityId.mockResolvedValue({
        id: HUMAN_ID,
        identityId: HUMAN_IDENTITY_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {
            id_token: { subject: HUMAN_IDENTITY_ID },
            extra: { 'moltnet:identity_only_consent': true },
          },
          request: {
            client_id: 'tailscale-login',
            grant_types: ['authorization_code'],
            granted_scopes: scopes,
            granted_audience: [],
          },
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
    });

    it('rejects an API scope on the identity-only OIDC client', async () => {
      vi.mocked(app.oauth2Client.getOAuth2Client).mockResolvedValueOnce({
        client_id: 'tailscale-login',
        metadata: {},
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: ['https://login.tailscale.com/a/oauth_response'],
        scope: 'openid profile email',
        audience: [],
      });
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {
            id_token: { subject: HUMAN_IDENTITY_ID },
            extra: { 'moltnet:identity_only_consent': true },
          },
          request: {
            client_id: 'tailscale-login',
            grant_types: ['authorization_code'],
            granted_scopes: ['openid', 'profile', 'email', 'diary:read'],
            granted_audience: [],
          },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(mocks.humanRepository.findByIdentityId).not.toHaveBeenCalled();
    });

    it('rejects an API audience on the identity-only OIDC client', async () => {
      const warn = vi.spyOn(app.log, 'warn');
      vi.mocked(app.oauth2Client.getOAuth2Client).mockResolvedValueOnce({
        client_id: 'tailscale-login',
        metadata: {},
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: ['https://login.tailscale.com/a/oauth_response'],
        scope: 'openid profile email',
        audience: [],
      });
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {
            id_token: { subject: HUMAN_IDENTITY_ID },
            extra: { 'moltnet:identity_only_consent': true },
          },
          request: {
            client_id: 'tailscale-login',
            grant_types: ['authorization_code'],
            granted_scopes: ['openid', 'profile', 'email'],
            granted_audience: ['moltnet:agent-server'],
          },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(warn).toHaveBeenCalledWith(
        {
          clientKind: 'tailscale-login',
          rejectionReasons: expect.arrayContaining(['audience']),
        },
        'Identity-only token grant rejected',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'person@example.com',
      );
      warn.mockRestore();
    });

    it('rejects an identity-only token without consent binding', async () => {
      vi.mocked(app.oauth2Client.getOAuth2Client).mockResolvedValueOnce({
        client_id: 'tailscale-login',
        metadata: {},
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: ['https://login.tailscale.com/a/oauth_response'],
        scope: 'openid profile email',
        audience: [],
      });
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: { id_token: { subject: HUMAN_IDENTITY_ID } },
          request: {
            client_id: 'tailscale-login',
            grant_types: ['authorization_code'],
            granted_scopes: ['openid', 'profile', 'email'],
            granted_audience: [],
          },
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it.each(
      ['moltnet:local-control', 'moltnet:provision'].flatMap((scope) => [
        { scope, granted: [scope] },
        { scope, granted: [] },
        { scope, granted: undefined },
      ]),
    )(
      'preserves validated $scope consent with hook scopes $granted',
      async ({ scope, granted }) => {
        vi.stubEnv('MOLTNET_NATIVE_OAUTH_CLIENT_ID', 'native-client');
        try {
          vi.mocked(app.oauth2Client.getOAuth2Client).mockResolvedValueOnce({
            client_id: 'native-client',
            metadata: {},
          });
          mocks.humanRepository.findByIdentityId.mockResolvedValue({
            id: HUMAN_ID,
            identityId: HUMAN_IDENTITY_ID,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const provisioning = {
            agentId: OWNER_ID,
            teamId: HUMAN_ID,
            operation: 'enroll',
            scopes: [...AGENT_CREDENTIAL_SCOPES, 'diary:write'],
            idempotencyKey: 'approved-request',
          };
          const response = await app.inject({
            method: 'POST',
            url: '/hooks/hydra/token-exchange',
            headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
            payload: {
              session: {
                id_token: { subject: HUMAN_IDENTITY_ID },
                extra: {
                  'moltnet:identity_id': HUMAN_IDENTITY_ID,
                  'moltnet:subject_type': 'human',
                  'moltnet:instance': OWNER_ID,
                  'moltnet:approved_scope': scope,
                  unapproved: 'must-not-survive',
                  ...(scope === 'moltnet:provision'
                    ? {
                        'moltnet:provisioning': provisioning,
                        'moltnet:delegable_scopes': [
                          'key:manage',
                          ...AGENT_CREDENTIAL_SCOPES,
                          'diary:write',
                        ],
                      }
                    : {}),
                },
              },
              request: {
                client_id: 'native-client',
                grant_types: ['authorization_code'],
                granted_scopes: granted,
              },
            },
          });
          expect(response.statusCode).toBe(200);
          expect(response.json().session.access_token).toEqual({
            'moltnet:identity_id': HUMAN_IDENTITY_ID,
            'moltnet:human_id': HUMAN_ID,
            'moltnet:subject_type': 'human',
            'moltnet:instance': OWNER_ID,
            ...(scope === 'moltnet:provision'
              ? {
                  'moltnet:provisioning': provisioning,
                  'moltnet:delegable_scopes': [
                    'key:manage',
                    ...AGENT_CREDENTIAL_SCOPES,
                    'diary:write',
                  ],
                }
              : {}),
          });
        } finally {
          vi.unstubAllEnvs();
        }
      },
    );

    it.each([
      { approved: undefined, granted: [] },
      { approved: undefined, granted: ['moltnet:local-control'] },
      { approved: ['moltnet:local-control'], granted: [] },
      { approved: 'diary:manage', granted: [] },
      {
        approved: 'moltnet:local-control',
        granted: { scope: 'moltnet:local-control' },
      },
      { approved: 'moltnet:local-control', granted: ['moltnet:provision'] },
      {
        approved: 'moltnet:local-control',
        granted: ['moltnet:local-control', 'diary:manage'],
      },
    ])(
      'rejects invalid administrative scope binding $approved / $granted',
      async ({ approved, granted, clientId = 'native-client' }) => {
        vi.stubEnv('MOLTNET_NATIVE_OAUTH_CLIENT_ID', 'native-client');
        try {
          vi.mocked(app.oauth2Client.getOAuth2Client).mockResolvedValueOnce({
            client_id: clientId,
            metadata: {},
          });
          const response = await app.inject({
            method: 'POST',
            url: '/hooks/hydra/token-exchange',
            headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
            payload: {
              session: {
                id_token: { subject: HUMAN_IDENTITY_ID },
                extra: {
                  'moltnet:identity_id': HUMAN_IDENTITY_ID,
                  'moltnet:subject_type': 'human',
                  'moltnet:instance': OWNER_ID,
                  'moltnet:approved_scope': approved,
                  ...(approved === 'moltnet:provision'
                    ? {
                        'moltnet:provisioning': {
                          agentId: OWNER_ID,
                          teamId: HUMAN_ID,
                          operation: 'enroll',
                          scopes: ['task:execute'],
                          idempotencyKey: 'approved-request',
                        },
                      }
                    : {}),
                },
              },
              request: {
                client_id: clientId,
                grant_types: ['authorization_code'],
                granted_scopes: granted,
              },
            },
          });
          expect([400, 403]).toContain(response.statusCode);
          expect(mocks.humanRepository.findByIdentityId).not.toHaveBeenCalled();
        } finally {
          vi.unstubAllEnvs();
        }
      },
    );

    it('denies a self-registered client granted a scope above the DCR cap', async () => {
      // Arrange: a DCR client (no MoltNet metadata) whose grant carries
      // key:manage — the scope that would let it mint agent keys.
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });
      mocks.humanRepository.findByIdentityId.mockResolvedValue({
        id: HUMAN_ID,
        identityId: HUMAN_IDENTITY_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: { id_token: { subject: HUMAN_IDENTITY_ID } },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
            granted_scopes: ['openid', 'diary:read', 'key:manage'],
          },
        },
      });

      // Assert: refused, not trimmed — the hook cannot narrow granted_scopes,
      // and the refusal happens before the human is even resolved.
      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('scope_not_allowed');
      expect(body.error_description).toContain('key:manage');
      expect(mocks.humanRepository.findByIdentityId).not.toHaveBeenCalled();
    });

    it('refuses a self-registered client that presents no granted scopes', async () => {
      // Arrange: `granted_scopes` is optional in the schema because the agent
      // path does not need it. On this path it is the only evidence of what
      // the token carries, so absent must fail closed — otherwise a malformed
      // payload mints a human-subject token past the cap.
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });
      mocks.humanRepository.findByIdentityId.mockResolvedValue({
        id: HUMAN_ID,
        identityId: HUMAN_IDENTITY_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: { id_token: { subject: HUMAN_IDENTITY_ID } },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
          },
        },
      });

      // Assert
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('scope_not_allowed');
      expect(mocks.humanRepository.findByIdentityId).not.toHaveBeenCalled();
    });

    it('bounds an oversized over-grant instead of echoing it', async () => {
      // The list is attacker-controlled in length and content and reaches both
      // a log sink and a response body.
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: { id_token: { subject: HUMAN_IDENTITY_ID } },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
            granted_scopes: Array.from({ length: 40 }, (_, i) => `bogus:${i}`),
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const description = response.json().error_description as string;
      expect(description).toContain('and 35 more');
      expect(description).not.toContain('bogus:39');
      expect(description.length).toBeLessThan(400);
    });

    it('names every over-granted scope so the registrant can re-register', async () => {
      // Arrange
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: { id_token: { subject: HUMAN_IDENTITY_ID } },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
            granted_scopes: [
              'diary:read',
              'connector:invoke',
              'runtime:manage',
              'task:claim',
            ],
          },
        },
      });

      // Assert
      expect(response.statusCode).toBe(403);
      const description = response.json().error_description as string;
      for (const scope of [
        'connector:invoke',
        'runtime:manage',
        'task:claim',
      ]) {
        expect(description).toContain(scope);
      }
      expect(description).not.toContain('diary:read');
    });

    it('admits a self-registered client granted exactly the MCP tool surface', async () => {
      // Arrange
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });
      mocks.humanRepository.findByIdentityId.mockResolvedValue({
        id: HUMAN_ID,
        identityId: HUMAN_IDENTITY_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: { id_token: { subject: HUMAN_IDENTITY_ID } },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
            granted_scopes: [...DCR_MAX_SCOPES],
          },
        },
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(response.json().session.access_token).toEqual({
        'moltnet:identity_id': HUMAN_IDENTITY_ID,
        'moltnet:human_id': HUMAN_ID,
        'moltnet:subject_type': 'human',
      });
    });

    it('leaves first-party agent clients above the DCR cap untouched', async () => {
      // Arrange: agents legitimately hold key:manage. They are distinguished by
      // metadata.identity_id, which the DCR cap must never intercept.
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent(),
      );

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
            granted_scopes: [...AGENT_OAUTH_SCOPES],
          },
        },
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(response.json().session.access_token).toEqual(
        expect.objectContaining({ 'moltnet:subject_type': 'agent' }),
      );
    });

    it('rejects with 403 when agent not found', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('agent_not_found');
    });

    it('rejects with 403 when no identity found', async () => {
      // Client has no MoltNet metadata, no session claims
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'unknown-client',
        metadata: {},
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'unknown-client',
            grant_types: ['client_credentials'],
            // In-cap scopes, so this test stays about the missing identity
            // rather than tripping the scope cap first.
            granted_scopes: ['diary:read'],
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('identity_not_found');
    });

    it('returns 500 when OAuth2 client fetch fails', async () => {
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockRejectedValueOnce(
        new Error('Hydra connection error'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('enrichment_failed');
    });
  });

  describe('webhook API key validation', () => {
    const validHumanPayload = {
      identity: {
        id: '00000000-0000-0000-0000-000000000000',
        schema_id: 'moltnet_human',
        traits: { email: 'a@b.c', username: 'test' },
      },
    };

    it('rejects request without API key header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].messages[0].id).toBe(4030001);
      expect(body.messages[0].messages[0].text).toBe(
        'Webhook authentication failed.',
      );
    });

    it('rejects request with wrong API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': 'wrong-key' },
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].messages[0].id).toBe(4030001);
      expect(body.messages[0].messages[0].text).toBe(
        'Webhook authentication failed.',
      );
    });

    it('accepts request with valid API key', async () => {
      mocks.humanRepository.create.mockResolvedValue({
        id: HUMAN_ID,
        identityId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
