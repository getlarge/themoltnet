/**
 * Recovery route tests
 *
 * TODO: Add E2E recovery flow tests once PR #56 is merged.
 * See: https://github.com/getlarge/themoltnet/pull/56
 */

import {
  cryptoService,
  generateRecoveryChallenge,
  openSealedEnvelope,
  signChallenge,
} from '@moltnet/crypto-service';
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

import { buildApp } from '../src/app.js';
import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  resetMockServices,
  TEST_RECOVERY_SECRET,
  TEST_SECURITY_OPTIONS,
} from './helpers.js';

describe('Recovery routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
  });

  describe('POST /recovery/challenge', () => {
    it('returns a challenge for a valid public key', async () => {
      const agent = createMockAgent();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: { publicKey: agent.publicKey, purpose: 'identity' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.challenge).toMatch(
        /^moltnet:recovery:identity:ed25519:[A-Za-z0-9+/=]+:[a-f0-9]{64}:\d+$/,
      );
      expect(body.hmac).toMatch(/^[a-f0-9]{64}$/);
      expect(body).not.toHaveProperty('identityId');
      expect(mocks.agentRepository.findByPublicKey).toHaveBeenCalledWith(
        agent.publicKey,
      );
    });

    it('returns a valid challenge even for unknown public key (anti-enumeration)', async () => {
      mocks.agentRepository.findByPublicKey.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: {
          publicKey: 'ed25519:unknownKeyBase64==',
          purpose: 'credentials',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.challenge).toMatch(
        /^moltnet:recovery:credentials:ed25519:[A-Za-z0-9+/=]+:[a-f0-9]{64}:\d+$/,
      );
      expect(body.hmac).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns 400 for publicKey exceeding maxLength', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: {
          publicKey: 'ed25519:' + 'A'.repeat(60),
          purpose: 'identity',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for malformed public key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: { publicKey: 'not-a-valid-key', purpose: 'identity' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('requires an explicit recovery purpose', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: { publicKey: 'ed25519:AAAA+/bbbb==' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /recovery/verify', () => {
    const VERIFY_PUBLIC_KEY = 'ed25519:AAAA+/bbbb==';

    function createValidPayload() {
      const challenge = generateRecoveryChallenge(
        VERIFY_PUBLIC_KEY,
        'identity',
      );
      const hmac = signChallenge(challenge, TEST_RECOVERY_SECRET);
      return {
        challenge,
        hmac,
        signature: 'valid-base64-signature',
        publicKey: VERIFY_PUBLIC_KEY,
      };
    }

    it('returns recovery code for valid challenge and signature', async () => {
      const agent = createMockAgent();
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);

      // Mock Ory IdentityApi
      const mockIdentityClient = {
        createRecoveryCodeForIdentity: vi.fn().mockResolvedValue({
          recovery_code: '76453943',
          recovery_link:
            'https://ory.example.com/self-service/recovery?flow=abc123',
        }),
      };
      // Re-build app with mocked identity client
      const testApp = await buildApp({
        diaryService: mocks.diaryService as any,
        diaryRepository: mocks.diaryRepository as any,
        agentRepository: mocks.agentRepository as any,
        cryptoService: mocks.cryptoService as any,
        agentEnrollmentRepository: mocks.agentEnrollmentRepository as any,
        signingRequestRepository: mocks.signingRequestRepository as any,
        nonceRepository: mocks.nonceRepository as any,
        dataSource: mocks.dataSource as any,
        transactionRunner: mocks.transactionRunner as any,
        embeddingService: mocks.embeddingService as any,
        permissionChecker: mocks.permissionChecker as any,
        tokenValidator: {
          introspect: vi.fn().mockResolvedValue({ active: false }),
          resolveAuthContext: vi.fn().mockResolvedValue(null),
        },
        webhookApiKey: 'test-key',
        recoverySecret: TEST_RECOVERY_SECRET,
        oryClients: {
          frontend: {} as any,
          identity: mockIdentityClient as any,
          oauth2: {
            getOAuth2Client: vi.fn().mockResolvedValue({
              client_id: 'test',
              metadata: { identity_id: OWNER_ID },
            }),
          } as any,
          permission: {} as any,
          relationship: {} as any,
        },
        security: TEST_SECURITY_OPTIONS,
      });

      try {
        const response = await testApp.inject({
          method: 'POST',
          url: '/recovery/verify',
          payload: payload,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.recoveryCode).toBe('76453943');
        expect(body.recoveryFlowUrl).toBe(
          'https://ory.example.com/self-service/recovery?flow=abc123',
        );
        expect(
          mockIdentityClient.createRecoveryCodeForIdentity,
        ).toHaveBeenCalledWith({
          createRecoveryCodeForIdentityBody: {
            identity_id: OWNER_ID,
            flow_type: 'api',
          },
        });
      } finally {
        await testApp.close();
      }
    });

    it('returns 400 for tampered HMAC', async () => {
      const payload = createValidPayload();
      payload.hmac = 'a'.repeat(64); // wrong HMAC

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('INVALID_CHALLENGE');
    });

    it('returns 400 for expired challenge', async () => {
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
      const challenge = `moltnet:recovery:identity:ed25519:AAAA+/bbbb==:${'a'.repeat(64)}:${sixMinutesAgo}`;
      const hmac = signChallenge(challenge, TEST_RECOVERY_SECRET);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload: {
          challenge,
          hmac,
          signature: 'some-sig',
          publicKey: VERIFY_PUBLIC_KEY,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('INVALID_CHALLENGE');
      expect(response.json().detail).toBe('Challenge expired');
    });

    it('returns same error for unknown key as for bad signature (anti-enumeration)', async () => {
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('INVALID_SIGNATURE');
    });

    it('returns 400 for invalid Ed25519 signature', async () => {
      const agent = createMockAgent();
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('INVALID_SIGNATURE');
    });

    it('returns 502 when Kratos Admin API fails', async () => {
      const agent = createMockAgent();
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);

      // Build app with a failing identity client
      const testApp = await buildApp({
        diaryService: mocks.diaryService as any,
        diaryRepository: mocks.diaryRepository as any,
        agentRepository: mocks.agentRepository as any,
        cryptoService: mocks.cryptoService as any,
        agentEnrollmentRepository: mocks.agentEnrollmentRepository as any,
        signingRequestRepository: mocks.signingRequestRepository as any,
        nonceRepository: mocks.nonceRepository as any,
        dataSource: mocks.dataSource as any,
        transactionRunner: mocks.transactionRunner as any,
        embeddingService: mocks.embeddingService as any,
        permissionChecker: mocks.permissionChecker as any,
        tokenValidator: {
          introspect: vi.fn().mockResolvedValue({ active: false }),
          resolveAuthContext: vi.fn().mockResolvedValue(null),
        },
        webhookApiKey: 'test-key',
        recoverySecret: TEST_RECOVERY_SECRET,
        oryClients: {
          frontend: {} as any,
          identity: {
            createRecoveryCodeForIdentity: vi
              .fn()
              .mockRejectedValue(new Error('Kratos unavailable')),
          } as any,
          oauth2: {
            getOAuth2Client: vi.fn().mockResolvedValue({
              client_id: 'test',
              metadata: { identity_id: OWNER_ID },
            }),
          } as any,
          permission: {} as any,
          relationship: {} as any,
        },
        security: TEST_SECURITY_OPTIONS,
      });

      try {
        const response = await testApp.inject({
          method: 'POST',
          url: '/recovery/verify',
          payload,
        });

        expect(response.statusCode).toBe(502);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.json().code).toBe('UPSTREAM_ERROR');
      } finally {
        await testApp.close();
      }
    });

    it('returns 400 when replaying a consumed nonce', async () => {
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(
        createMockAgent(),
      );
      mocks.nonceRepository.consume.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('INVALID_CHALLENGE');
      expect(response.json().detail).toBe('Challenge already used');
    });

    it('returns 400 for publicKey exceeding maxLength in verify', async () => {
      const longKey = 'ed25519:' + 'A'.repeat(60);
      const challenge = generateRecoveryChallenge(
        VERIFY_PUBLIC_KEY,
        'identity',
      );
      const hmac = signChallenge(challenge, TEST_RECOVERY_SECRET);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload: {
          challenge,
          hmac,
          signature: 'some-sig',
          publicKey: longKey,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /recovery/credentials', () => {
    const CREDENTIALS_PUBLIC_KEY = 'ed25519:AAAA+/bbbb==';

    function createCredentialsPayload(
      purpose: 'credentials' | 'identity' = 'credentials',
    ) {
      const challenge = generateRecoveryChallenge(
        CREDENTIALS_PUBLIC_KEY,
        purpose,
      );
      return {
        challenge,
        hmac: signChallenge(challenge, TEST_RECOVERY_SECRET),
        signature: 'some-sig',
        publicKey: CREDENTIALS_PUBLIC_KEY,
      };
    }

    const createCredentialsApp = (
      oauth2: Record<string, unknown>,
      evictOAuthClient = vi.fn(),
    ) =>
      buildApp({
        diaryService: mocks.diaryService as any,
        diaryRepository: mocks.diaryRepository as any,
        agentRepository: mocks.agentRepository as any,
        cryptoService: mocks.cryptoService as any,
        agentEnrollmentRepository: mocks.agentEnrollmentRepository as any,
        signingRequestRepository: mocks.signingRequestRepository as any,
        nonceRepository: mocks.nonceRepository as any,
        dataSource: mocks.dataSource as any,
        transactionRunner: mocks.transactionRunner as any,
        embeddingService: mocks.embeddingService as any,
        permissionChecker: mocks.permissionChecker as any,
        tokenValidator: {
          introspect: vi.fn().mockResolvedValue({ active: false }),
          resolveAuthContext: vi.fn().mockResolvedValue(null),
          evictOAuthClient,
        } as any,
        webhookApiKey: 'test-key',
        recoverySecret: TEST_RECOVERY_SECRET,
        oryClients: {
          frontend: {} as any,
          identity: {} as any,
          oauth2: oauth2 as any,
          permission: {} as any,
          relationship: {} as any,
        },
        security: TEST_SECURITY_OPTIONS,
      });

    const notFound = () =>
      Object.assign(new Error('not found'), { response: { status: 404 } });

    const page = (clients: unknown, link?: string) => ({
      raw: { headers: new Headers(link ? { link } : undefined) },
      value: vi.fn().mockResolvedValue(clients),
    });

    it('delivers the sealed replacement when post-commit eviction fails', async () => {
      const keyPair = await cryptoService.generateKeyPair();
      const agent = createMockAgent({
        publicKey: keyPair.publicKey,
        fingerprint: keyPair.fingerprint,
      });
      const challenge = generateRecoveryChallenge(
        agent.publicKey,
        'credentials',
      );
      const hmac = signChallenge(challenge, TEST_RECOVERY_SECRET);
      const signature = await cryptoService.sign(challenge, keyPair.privateKey);
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockImplementation((...args) =>
        cryptoService.verify(...args),
      );

      const getOAuth2Client = vi.fn().mockResolvedValue({
        client_id: `moltnet-agent-${OWNER_ID}`,
        client_name: `Agent: ${agent.fingerprint}`,
        grant_types: ['client_credentials'],
        response_types: [],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'openid',
        metadata: { identity_id: OWNER_ID },
      });
      const setOAuth2Client = vi.fn().mockResolvedValue(undefined);
      const listOAuth2ClientsRaw = vi.fn();
      const evictOAuthClient = vi.fn(() => {
        throw new Error('validator cache unavailable');
      });
      const testApp = await createCredentialsApp(
        { getOAuth2Client, listOAuth2ClientsRaw, setOAuth2Client },
        evictOAuthClient,
      );

      try {
        const response = await testApp.inject({
          method: 'POST',
          url: '/recovery/credentials',
          payload: { challenge, hmac, signature, publicKey: agent.publicKey },
        });

        expect(response.statusCode).toBe(200);
        const recovered = response.json();
        const clientSecret = openSealedEnvelope(
          recovered.sealedClientSecret,
          keyPair.privateKey,
        );
        expect(recovered.clientId).toBe(`moltnet-agent-${OWNER_ID}`);
        expect(clientSecret).toEqual(expect.any(String));
        expect(clientSecret).not.toHaveLength(0);
        expect(setOAuth2Client).toHaveBeenCalledWith({
          id: recovered.clientId,
          oAuth2Client: expect.objectContaining({
            client_secret: clientSecret,
            metadata: { identity_id: OWNER_ID },
          }),
        });
        expect(evictOAuthClient).toHaveBeenCalledWith(recovered.clientId);
        expect(listOAuth2ClientsRaw).not.toHaveBeenCalled();
      } finally {
        await testApp.close();
      }
    });

    it('finds the exact legacy client across every filtered page', async () => {
      const keyPair = await cryptoService.generateKeyPair();
      const agent = createMockAgent({
        publicKey: keyPair.publicKey,
        fingerprint: keyPair.fingerprint,
      });
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);
      const exact = {
        client_id: 'legacy-uuid',
        client_name: `Agent: ${agent.fingerprint}`,
        audience: ['preserved-audience'],
        metadata: {
          identity_id: agent.identityId,
          public_key: agent.publicKey,
          fingerprint: agent.fingerprint,
        },
      };
      const listOAuth2ClientsRaw = vi
        .fn()
        .mockResolvedValueOnce(
          page(
            [
              {
                ...exact,
                client_id: 'wrong-identity',
                metadata: { ...exact.metadata, identity_id: 'other' },
              },
              {
                ...exact,
                client_id: 'wrong-key',
                metadata: { ...exact.metadata, public_key: 'other' },
              },
            ],
            '</admin/clients?page_size=250&page_token=next>; rel="next"',
          ),
        )
        .mockResolvedValueOnce(
          page([
            {
              ...exact,
              client_id: 'wrong-fingerprint',
              metadata: { ...exact.metadata, fingerprint: 'other' },
            },
            { ...exact, client_id: 'wrong-name', client_name: 'Agent: other' },
            exact,
          ]),
        );
      const setOAuth2Client = vi.fn();
      const testApp = await createCredentialsApp({
        getOAuth2Client: vi.fn().mockRejectedValue(notFound()),
        listOAuth2ClientsRaw,
        setOAuth2Client,
      });

      try {
        const challenge = generateRecoveryChallenge(
          agent.publicKey,
          'credentials',
        );
        const response = await testApp.inject({
          method: 'POST',
          url: '/recovery/credentials',
          payload: {
            challenge,
            hmac: signChallenge(challenge, TEST_RECOVERY_SECRET),
            signature: 'some-sig',
            publicKey: agent.publicKey,
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().clientId).toBe('legacy-uuid');
        expect(listOAuth2ClientsRaw).toHaveBeenNthCalledWith(2, {
          clientName: `Agent: ${agent.fingerprint}`,
          pageSize: 250,
          pageToken: 'next',
        });
        expect(setOAuth2Client).toHaveBeenCalledWith({
          id: 'legacy-uuid',
          oAuth2Client: expect.objectContaining({
            audience: ['preserved-audience'],
            client_secret: expect.any(String),
          }),
        });
      } finally {
        await testApp.close();
      }
    });

    it.each([
      ['no match', [page([])], 404],
      [
        'multiple matches',
        [page([{ client_id: 'one' }, { client_id: 'two' }])],
        409,
      ],
      ['matching client without an ID', [page([{}])], 502],
      [
        'malformed pagination',
        [page([], '</admin/clients?page_size=250>; rel="next"')],
        502,
      ],
      ['malformed Hydra data', [page({})], 502],
    ])('does not mutate on %s', async (_name, pages, statusCode) => {
      const agent = createMockAgent({ publicKey: CREDENTIALS_PUBLIC_KEY });
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);
      const metadata = {
        identity_id: agent.identityId,
        public_key: agent.publicKey,
        fingerprint: agent.fingerprint,
      };
      const hydratedPages = pages.map((result) => ({
        ...result,
        value: vi.fn(async () => {
          const clients = await result.value();
          return Array.isArray(clients)
            ? clients.map((client) => ({
                client_name: `Agent: ${agent.fingerprint}`,
                metadata,
                ...client,
              }))
            : clients;
        }),
      }));
      const setOAuth2Client = vi.fn();
      const testApp = await createCredentialsApp({
        getOAuth2Client: vi.fn().mockRejectedValue(notFound()),
        listOAuth2ClientsRaw: vi
          .fn()
          .mockImplementation(() => hydratedPages.shift()),
        setOAuth2Client,
      });

      try {
        const response = await testApp.inject({
          method: 'POST',
          url: '/recovery/credentials',
          payload: createCredentialsPayload(),
        });
        expect(response.statusCode).toBe(statusCode);
        expect(setOAuth2Client).not.toHaveBeenCalled();
      } finally {
        await testApp.close();
      }
    });

    it.each([404, 503])(
      'maps Hydra list/get failure after status %i without mutation',
      async (status) => {
        const agent = createMockAgent({ publicKey: CREDENTIALS_PUBLIC_KEY });
        mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
        mocks.cryptoService.verify.mockResolvedValue(true);
        const listOAuth2ClientsRaw = vi
          .fn()
          .mockRejectedValue(new Error('Hydra unavailable'));
        const setOAuth2Client = vi.fn();
        const testApp = await createCredentialsApp({
          getOAuth2Client: vi.fn().mockRejectedValue(
            Object.assign(new Error('lookup failed'), {
              response: { status },
            }),
          ),
          listOAuth2ClientsRaw,
          setOAuth2Client,
        });

        try {
          const response = await testApp.inject({
            method: 'POST',
            url: '/recovery/credentials',
            payload: createCredentialsPayload(),
          });
          expect(response.statusCode).toBe(502);
          expect(setOAuth2Client).not.toHaveBeenCalled();
          expect(listOAuth2ClientsRaw).toHaveBeenCalledTimes(
            status === 404 ? 1 : 0,
          );
        } finally {
          await testApp.close();
        }
      },
    );

    it('rejects a replay before attempting another credential rotation', async () => {
      const payload = {
        challenge: generateRecoveryChallenge(
          'ed25519:AAAA+/bbbb==',
          'credentials',
        ),
        hmac: '',
        signature: 'some-sig',
        publicKey: 'ed25519:AAAA+/bbbb==',
      };
      payload.hmac = signChallenge(payload.challenge, TEST_RECOVERY_SECRET);
      mocks.nonceRepository.consume.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/credentials',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_CHALLENGE');
      expect(mocks.agentRepository.findByPublicKey).not.toHaveBeenCalled();
    });

    it('rejects a proof issued for identity recovery', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery/credentials',
        payload: createCredentialsPayload('identity'),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_CHALLENGE');
      expect(response.json().detail).toBe(
        'Challenge was issued for a different recovery purpose',
      );
    });

    it('rejects a tampered HMAC', async () => {
      const payload = createCredentialsPayload();
      payload.hmac = 'a'.repeat(64);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/credentials',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_CHALLENGE');
    });

    it('rejects an expired challenge', async () => {
      const timestamp = Date.now() - 6 * 60 * 1000;
      const challenge = `moltnet:recovery:credentials:ed25519:AAAA+/bbbb==:${'a'.repeat(64)}:${timestamp}`;

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/credentials',
        payload: {
          challenge,
          hmac: signChallenge(challenge, TEST_RECOVERY_SECRET),
          signature: 'some-sig',
          publicKey: CREDENTIALS_PUBLIC_KEY,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().detail).toBe('Challenge expired');
    });

    it('returns the same error for an unknown key and a bad signature', async () => {
      mocks.agentRepository.findByPublicKey.mockResolvedValue(null);
      mocks.cryptoService.verify.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/credentials',
        payload: createCredentialsPayload(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_SIGNATURE');
      expect(mocks.cryptoService.verify).toHaveBeenCalled();
    });

    it('rejects an invalid Ed25519 signature', async () => {
      mocks.agentRepository.findByPublicKey.mockResolvedValue(
        createMockAgent(),
      );
      mocks.cryptoService.verify.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/credentials',
        payload: createCredentialsPayload(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_SIGNATURE');
    });
  });
});
