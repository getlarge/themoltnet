/**
 * Credential-ladder public surface
 *
 * - GET /credentials/jwks.json — verification keys for MoltNet-issued
 *   task credentials
 *
 * Unauthenticated by design: a JWKS document is public verification material,
 * and a relying party must be able to fetch it before it can trust anything.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { TASK_CREDENTIAL_JWKS_PATH } from '../config.js';
import { CredentialJwksSchema } from '../schemas.js';

/**
 * How long a relying party may cache the document. Matches the verifier's own
 * cache window (`JWKS_CACHE_MAX_AGE_MS` in `@themoltnet/credentials`); a
 * rotation stays safe regardless because both keys are published while
 * credentials signed by either can still be valid, and a verifier refreshes on
 * an unknown `kid`.
 */
const JWKS_CACHE_SECONDS = 300;

export function credentialRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  server.get(
    TASK_CREDENTIAL_JWKS_PATH,
    {
      schema: {
        operationId: 'getCredentialJwks',
        tags: ['credentials'],
        description:
          'Public JWKS for MoltNet-issued credential-ladder tokens. Relying ' +
          'parties verify a task credential offline against these keys: ' +
          'resolve by `kid`, pin EdDSA, and refresh on an unknown `kid`.',
        response: {
          200: Type.Ref(CredentialJwksSchema.$id),
        },
      },
    },
    async (_request, reply) => {
      return reply
        .header('cache-control', `public, max-age=${JWKS_CACHE_SECONDS}`)
        .send(fastify.taskCredentials.jwks);
    },
  );
}
