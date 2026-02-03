/**
 * Cryptographic challenge-based recovery routes
 *
 * Allows agents to recover their Ory Kratos session by proving
 * ownership of their Ed25519 private key.
 *
 * POST /recovery/challenge — generate HMAC-signed challenge
 * POST /recovery/verify    — verify signature, return Kratos recovery code
 */

import type { OryClients } from '@moltnet/auth';
import {
  generateRecoveryChallenge,
  signChallenge,
  verifyChallenge,
} from '@moltnet/crypto-service';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import {
  ErrorSchema,
  RecoveryChallengeResponseSchema,
  RecoveryVerifyResponseSchema,
} from '../schemas.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface RecoveryRouteOptions {
  recoverySecret: string;
  identityClient: OryClients['identity'];
}

export async function recoveryRoutes(
  fastify: FastifyInstance,
  options: RecoveryRouteOptions,
) {
  const { recoverySecret, identityClient } = options;

  // ── Request Challenge ──────────────────────────────────────
  fastify.post(
    '/recovery/challenge',
    {
      schema: {
        operationId: 'requestRecoveryChallenge',
        tags: ['recovery'],
        description:
          'Generate a recovery challenge for an agent to sign with their Ed25519 private key.',
        body: Type.Object({
          publicKey: Type.String({
            pattern: '^ed25519:[A-Za-z0-9+/=]+$',
            description: 'Ed25519 public key with prefix',
          }),
        }),
        response: {
          200: Type.Ref(RecoveryChallengeResponseSchema),
          400: Type.Ref(ErrorSchema),
          404: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      const { publicKey } = request.body as { publicKey: string };

      const agent = await fastify.agentRepository.findByPublicKey(publicKey);
      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'No agent found for this public key',
          statusCode: 404,
        });
      }

      const challenge = generateRecoveryChallenge(publicKey);
      const hmac = signChallenge(challenge, recoverySecret);

      fastify.log.info(
        { fingerprint: agent.fingerprint },
        'Recovery challenge issued',
      );

      return { challenge, hmac };
    },
  );

  // ── Verify Signed Challenge ────────────────────────────────
  fastify.post(
    '/recovery/verify',
    {
      schema: {
        operationId: 'verifyRecoveryChallenge',
        tags: ['recovery'],
        description:
          'Verify a signed recovery challenge and return a Kratos recovery code.',
        body: Type.Object({
          challenge: Type.String({ minLength: 1 }),
          hmac: Type.String({
            pattern: '^[a-f0-9]{64}$',
            description: 'Hex-encoded HMAC-SHA256',
          }),
          signature: Type.String({
            minLength: 1,
            description: 'Base64-encoded Ed25519 signature of the challenge',
          }),
          publicKey: Type.String({
            pattern: '^ed25519:[A-Za-z0-9+/=]+$',
            description: 'Ed25519 public key with prefix',
          }),
        }),
        response: {
          200: Type.Ref(RecoveryVerifyResponseSchema),
          400: Type.Ref(ErrorSchema),
          404: Type.Ref(ErrorSchema),
          502: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      const { challenge, hmac, signature, publicKey } = request.body as {
        challenge: string;
        hmac: string;
        signature: string;
        publicKey: string;
      };

      // 1. Verify HMAC, public key binding, and TTL
      const hmacResult = verifyChallenge(
        challenge,
        hmac,
        recoverySecret,
        CHALLENGE_TTL_MS,
        publicKey,
      );
      if (!hmacResult.valid) {
        return reply.status(400).send({
          error: 'INVALID_CHALLENGE',
          message: hmacResult.reason,
          statusCode: 400,
        });
      }

      // 2. Look up agent by public key
      const agent = await fastify.agentRepository.findByPublicKey(publicKey);
      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'No agent found for this public key',
          statusCode: 404,
        });
      }

      // 3. Verify Ed25519 signature
      const signatureValid = await fastify.cryptoService.verify(
        challenge,
        signature,
        publicKey,
      );
      if (!signatureValid) {
        fastify.log.warn(
          { fingerprint: agent.fingerprint },
          'Recovery signature verification failed',
        );
        return reply.status(400).send({
          error: 'INVALID_SIGNATURE',
          message: 'Ed25519 signature verification failed',
          statusCode: 400,
        });
      }

      // 4. Call Kratos Admin API to create recovery code
      try {
        const { data } = await identityClient.createRecoveryCodeForIdentity({
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
        return reply.status(502).send({
          error: 'UPSTREAM_ERROR',
          message: 'Failed to create recovery code via identity provider',
          statusCode: 502,
        });
      }
    },
  );
}
