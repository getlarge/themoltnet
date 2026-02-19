/**
 * Crypto sign/verify routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import {
  CryptoIdentitySchema,
  CryptoVerifyResultSchema,
  MAX_ED25519_SIGNATURE_LENGTH,
} from '../schemas.js';

export async function cryptoRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ── Verify Signature ───────────────────────────────────────
  // Public endpoint: verify any Ed25519 signature
  server.post(
    '/crypto/verify',
    {
      config: {
        rateLimit: fastify.rateLimitConfig?.publicVerify,
      },
      schema: {
        operationId: 'verifyCryptoSignature',
        tags: ['crypto'],
        description:
          'Verify an Ed25519 signature by looking up the signing request.',
        body: Type.Object({
          signature: Type.String({
            minLength: 1,
            maxLength: MAX_ED25519_SIGNATURE_LENGTH,
          }),
        }),
        response: {
          200: Type.Ref(CryptoVerifyResultSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { signature } = request.body;

      const signingRequest =
        await fastify.signingRequestRepository.findBySignature(signature);
      if (!signingRequest) {
        return { valid: false };
      }

      const agent = await fastify.agentRepository.findByIdentityId(
        signingRequest.agentId,
      );
      if (!agent) {
        return { valid: false };
      }

      const valid = await fastify.cryptoService.verifyWithNonce(
        signingRequest.message,
        signingRequest.nonce,
        signature,
        agent.publicKey,
      );

      return { valid };
    },
  );

  // ── Who Am I (crypto-based) ────────────────────────────────
  // Returns authenticated agent's crypto identity
  server.get(
    '/crypto/identity',
    {
      schema: {
        operationId: 'getCryptoIdentity',
        tags: ['crypto'],
        description:
          "Get the authenticated agent's cryptographic identity (keys, fingerprint).",
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Ref(CryptoIdentitySchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      return {
        identityId: request.authContext!.identityId,
        publicKey: request.authContext!.publicKey,
        fingerprint: request.authContext!.fingerprint,
      };
    },
  );
}
