/**
 * Recovery route tests
 *
 * TODO: Add E2E recovery flow tests once PR #56 is merged.
 * See: https://github.com/getlarge/themoltnet/pull/56
 */

import {
  generateRecoveryChallenge,
  signChallenge,
} from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_RECOVERY_SECRET,
} from './helpers.js';

describe('Recovery routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  describe('POST /recovery/challenge', () => {
    it('returns a challenge for a valid public key', async () => {
      const agent = createMockAgent();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: { publicKey: agent.publicKey },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.challenge).toMatch(
        /^moltnet:recovery:ed25519:[A-Za-z0-9+/=]+:[a-f0-9]{64}:\d+$/,
      );
      expect(body.hmac).toMatch(/^[a-f0-9]{64}$/);
      expect(body).not.toHaveProperty('identityId');
      expect(mocks.agentRepository.findByPublicKey).toHaveBeenCalledWith(
        agent.publicKey,
      );
    });

    it('returns 404 when no agent found for public key', async () => {
      mocks.agentRepository.findByPublicKey.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: { publicKey: 'ed25519:unknownKeyBase64==' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed public key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery/challenge',
        payload: { publicKey: 'not-a-valid-key' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /recovery/verify', () => {
    const VERIFY_PUBLIC_KEY = 'ed25519:AAAA+/bbbb==';

    function createValidPayload() {
      const challenge = generateRecoveryChallenge(VERIFY_PUBLIC_KEY);
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
          data: {
            recovery_code: '76453943',
            recovery_link:
              'https://ory.example.com/self-service/recovery?flow=abc123',
          },
        }),
      };
      // Re-build app with mocked identity client
      const { buildApp } = await import('../src/app.js');
      const testApp = await buildApp({
        diaryService: mocks.diaryService as any,
        agentRepository: mocks.agentRepository as any,
        cryptoService: mocks.cryptoService as any,
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
              data: { client_id: 'test', metadata: { identity_id: OWNER_ID } },
            }),
          } as any,
          permission: {} as any,
          relationship: {} as any,
        },
      });

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
      expect(response.json().error).toBe('INVALID_CHALLENGE');
    });

    it('returns 400 for expired challenge', async () => {
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
      const challenge = `moltnet:recovery:ed25519:AAAA+/bbbb==:${'a'.repeat(64)}:${sixMinutesAgo}`;
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
      expect(response.json().error).toBe('INVALID_CHALLENGE');
      expect(response.json().message).toBe('Challenge expired');
    });

    it('returns 404 when no agent found for public key', async () => {
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('NOT_FOUND');
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
      expect(response.json().error).toBe('INVALID_SIGNATURE');
    });

    it('returns 502 when Kratos Admin API fails', async () => {
      const agent = createMockAgent();
      const payload = createValidPayload();
      mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);

      // Build app with a failing identity client
      const { buildApp } = await import('../src/app.js');
      const testApp = await buildApp({
        diaryService: mocks.diaryService as any,
        agentRepository: mocks.agentRepository as any,
        cryptoService: mocks.cryptoService as any,
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
              data: { client_id: 'test', metadata: { identity_id: OWNER_ID } },
            }),
          } as any,
          permission: {} as any,
          relationship: {} as any,
        },
      });

      const response = await testApp.inject({
        method: 'POST',
        url: '/recovery/verify',
        payload,
      });

      expect(response.statusCode).toBe(502);
      expect(response.json().error).toBe('UPSTREAM_ERROR');
    });
  });
});
