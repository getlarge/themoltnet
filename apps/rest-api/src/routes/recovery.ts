/**
 * Cryptographic challenge-based recovery routes
 *
 * Allows agents to recover their Ory Kratos session by proving
 * ownership of their Ed25519 private key.
 *
 * POST /recovery/challenge — generate HMAC-signed challenge
 * POST /recovery/verify    — verify signature, return Kratos recovery code
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { OryClients } from '@moltnet/auth';
import {
  generateRecoveryChallenge,
  signChallenge,
  verifyChallenge,
} from '@moltnet/crypto-service';
import type { NonceRepository } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  MAX_CHALLENGE_LENGTH,
  MAX_ED25519_SIGNATURE_LENGTH,
  MAX_PUBLIC_KEY_LENGTH,
  RecoveryChallengeResponseSchema,
  RecoveryVerifyResponseSchema,
} from '../schemas.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface RecoveryRouteOptions {
  recoverySecret: string;
  identityClient: OryClients['identity'];
  nonceRepository: NonceRepository;
}

export async function recoveryRoutes(
  fastify: FastifyInstance,
  options: RecoveryRouteOptions,
) {
  const { recoverySecret, identityClient, nonceRepository } = options;
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ── Request Challenge ──────────────────────────────────────
  server.post(
    '/recovery/challenge',
    {
      config: {
        rateLimit: fastify.rateLimitConfig?.recovery,
      },
      schema: {
        operationId: 'requestRecoveryChallenge',
        tags: ['recovery'],
        description:
          'Generate a recovery challenge for an agent to sign with their Ed25519 private key.',
        body: Type.Object({
          publicKey: Type.String({
            pattern: '^ed25519:[A-Za-z0-9+/=]+$',
            maxLength: MAX_PUBLIC_KEY_LENGTH,
            description: 'Ed25519 public key with prefix',
          }),
        }),
        response: {
          200: Type.Ref(RecoveryChallengeResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { publicKey } = request.body;

      // Always generate a challenge regardless of whether the key exists
      // to prevent public key enumeration. Invalid keys will fail at /verify.
      const challenge = generateRecoveryChallenge(publicKey);
      const hmac = signChallenge(challenge, recoverySecret);

      const agent = await fastify.agentRepository.findByPublicKey(publicKey);
      if (agent) {
        fastify.log.info(
          { fingerprint: agent.fingerprint },
          'Recovery challenge issued',
        );
      }

      return { challenge, hmac };
    },
  );

  // ── Verify Signed Challenge ────────────────────────────────
  server.post(
    '/recovery/verify',
    {
      config: {
        rateLimit: fastify.rateLimitConfig?.recovery,
      },
      schema: {
        operationId: 'verifyRecoveryChallenge',
        tags: ['recovery'],
        description:
          'Verify a signed recovery challenge and return a Kratos recovery code.',
        body: Type.Object({
          challenge: Type.String({
            minLength: 1,
            maxLength: MAX_CHALLENGE_LENGTH,
          }),
          hmac: Type.String({
            pattern: '^[a-f0-9]{64}$',
            description: 'Hex-encoded HMAC-SHA256',
          }),
          signature: Type.String({
            minLength: 1,
            maxLength: MAX_ED25519_SIGNATURE_LENGTH,
            description: 'Base64-encoded Ed25519 signature of the challenge',
          }),
          publicKey: Type.String({
            pattern: '^ed25519:[A-Za-z0-9+/=]+$',
            maxLength: MAX_PUBLIC_KEY_LENGTH,
            description: 'Ed25519 public key with prefix',
          }),
        }),
        response: {
          200: Type.Ref(RecoveryVerifyResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
          502: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { challenge, hmac, signature, publicKey } = request.body;

      // 1. Verify HMAC, public key binding, and TTL
      const hmacResult = verifyChallenge(
        challenge,
        hmac,
        recoverySecret,
        CHALLENGE_TTL_MS,
        publicKey,
      );
      if (!hmacResult.valid) {
        fastify.log.warn(
          { requestId: request.id, ip: request.ip, publicKey },
          'Recovery challenge HMAC verification failed',
        );
        throw createProblem('invalid-challenge', hmacResult.reason);
      }

      // 2. Nonce replay prevention — extract nonce from challenge (parts[4])
      const parts = challenge.split(':');
      const nonce = parts[4];
      const challengeExpiresAt = new Date(
        parseInt(parts[5], 10) + CHALLENGE_TTL_MS,
      );
      const fresh = await nonceRepository.consume(nonce, challengeExpiresAt);
      if (!fresh) {
        fastify.log.warn(
          { requestId: request.id, ip: request.ip, publicKey },
          'Recovery nonce replay attempt',
        );
        throw createProblem('invalid-challenge', 'Challenge already used');
      }

      // 3. Look up agent by public key
      const agent = await fastify.agentRepository.findByPublicKey(publicKey);
      if (!agent) {
        fastify.log.warn(
          { requestId: request.id, ip: request.ip, publicKey },
          'Recovery verify for unknown public key',
        );
        throw createProblem('not-found', 'No agent found for this public key');
      }

      // 4. Verify Ed25519 signature
      const signatureValid = await fastify.cryptoService.verify(
        challenge,
        signature,
        publicKey,
      );
      if (!signatureValid) {
        fastify.log.warn(
          {
            requestId: request.id,
            ip: request.ip,
            fingerprint: agent.fingerprint,
          },
          'Recovery signature verification failed',
        );
        throw createProblem(
          'invalid-signature',
          'Ed25519 signature verification failed',
        );
      }

      // 5. Call Kratos Admin API to create recovery code
      try {
        const data = await identityClient.createRecoveryCodeForIdentity({
          createRecoveryCodeForIdentityBody: {
            identity_id: agent.identityId,
            flow_type: 'api',
          },
        });

        fastify.log.info(
          { fingerprint: agent.fingerprint },
          'Recovery code issued via Kratos Admin API',
        );

        return {
          recoveryCode: data.recovery_code,
          recoveryFlowUrl: data.recovery_link,
        };
      } catch (err) {
        fastify.log.error(
          { err, fingerprint: agent.fingerprint },
          'Kratos Admin API recovery failed',
        );
        throw createProblem(
          'upstream-error',
          'Failed to create recovery code via identity provider',
        );
      }
    },
  );
}
