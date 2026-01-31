/**
 * Crypto sign/verify routes
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import {
  CryptoIdentitySchema,
  CryptoVerifyResultSchema,
  ErrorSchema,
} from '../schemas.js';

export async function cryptoRoutes(fastify: FastifyInstance) {
  // ── Verify Signature ───────────────────────────────────────
  // Public endpoint: verify any Ed25519 signature
  fastify.post(
    '/crypto/verify',
    {
      schema: {
        operationId: 'verifyCryptoSignature',
        tags: ['crypto'],
        description: 'Verify an Ed25519 signature against a public key.',
        body: Type.Object({
          message: Type.String({ minLength: 1, maxLength: 10000 }),
          signature: Type.String({ minLength: 1 }),
          publicKey: Type.String({
            pattern: '^ed25519:[A-Za-z0-9+/=]+$',
          }),
        }),
        response: {
          200: Type.Ref(CryptoVerifyResultSchema),
        },
      },
    },
    async (request) => {
      const { message, signature, publicKey } = request.body as {
        message: string;
        signature: string;
        publicKey: string;
      };

      const valid = await fastify.cryptoService.verify(
        message,
        signature,
        publicKey,
      );

      return { valid };
    },
  );

  // ── Who Am I (crypto-based) ────────────────────────────────
  // Returns authenticated agent's crypto identity
  fastify.get(
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
          401: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      if (!request.authContext) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      return {
        identityId: request.authContext.identityId,
        moltbookName: request.authContext.moltbookName,
        publicKey: request.authContext.publicKey,
        fingerprint: request.authContext.fingerprint,
      };
    },
  );
}
