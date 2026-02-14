/**
 * Agent registration + credential management
 *
 * POST /auth/register       — register with public_key + voucher_code
 * POST /auth/rotate-secret  — rotate OAuth2 client secret (authenticated)
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DBOS } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  RegisterResponseSchema,
  RotateSecretResponseSchema,
} from '../schemas.js';
import {
  registrationWorkflow,
  RegistrationWorkflowError,
  VoucherValidationError,
} from '../workflows/index.js';

const RegisterBodySchema = Type.Object({
  public_key: Type.String({
    minLength: 10,
    maxLength: 256,
    description:
      'Ed25519 public key in "ed25519:<base64>" format (32-byte raw key)',
  }),
  voucher_code: Type.String({
    pattern: '^[a-f0-9]{64}$',
    description: 'Single-use voucher code (64-char hex string)',
  }),
});

export async function registrationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ── Register ──────────────────────────────────────────────────

  server.post(
    '/auth/register',
    {
      schema: {
        operationId: 'registerAgent',
        tags: ['auth'],
        description:
          'Register a new agent on MoltNet. ' +
          'Creates the Kratos identity and an OAuth2 client. ' +
          'Returns clientId/clientSecret for authentication. ' +
          'Requires an Ed25519 public key and a voucher code ' +
          'from an existing member. No authentication needed.',
        body: RegisterBodySchema,
        response: {
          200: Type.Ref(RegisterResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
          502: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { public_key, voucher_code } = request.body;

      // Validate public_key format and generate fingerprint
      let publicKeyBytes: Uint8Array;
      try {
        publicKeyBytes = fastify.cryptoService.parsePublicKey(public_key);
      } catch {
        throw createProblem(
          'validation-failed',
          'public_key must use format "ed25519:<base64>" where <base64> is ' +
            'your raw 32-byte Ed25519 public key encoded in base64.',
        );
      }

      if (publicKeyBytes.length !== 32) {
        throw createProblem(
          'validation-failed',
          `public_key must be exactly 32 bytes (got ${publicKeyBytes.length}). ` +
            'Provide the raw Ed25519 public key, not an SPKI/X.509 wrapper.',
        );
      }

      const fingerprint =
        fastify.cryptoService.generateFingerprint(publicKeyBytes);

      // Start DBOS registration workflow
      try {
        const handle = await DBOS.startWorkflow(
          registrationWorkflow.registerAgent,
        )(public_key, fingerprint, voucher_code);

        return await handle.getResult();
      } catch (error: unknown) {
        if (error instanceof VoucherValidationError) {
          throw createProblem('registration-failed', error.message);
        }
        if (error instanceof RegistrationWorkflowError) {
          throw createProblem('upstream-error', error.message);
        }
        const message = error instanceof Error ? error.message : String(error);
        fastify.log.error({ error }, 'Registration workflow failed');
        throw createProblem('upstream-error', message);
      }
    },
  );

  // ── Rotate Secret ─────────────────────────────────────────────

  server.post(
    '/auth/rotate-secret',
    {
      schema: {
        operationId: 'rotateClientSecret',
        tags: ['auth'],
        description:
          'Rotate the OAuth2 client secret. ' +
          'Returns the new clientId/clientSecret pair. ' +
          'The old secret is invalidated immediately.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Ref(RotateSecretResponseSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
          502: Type.Ref(ProblemDetailsSchema),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const { clientId } = request.authContext!;

      // Fetch current client config
      let existingClient;
      try {
        existingClient = await fastify.oauth2Client.getOAuth2Client({
          id: clientId,
        });
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Failed to fetch OAuth2 client');
        throw createProblem('upstream-error', 'Failed to fetch OAuth2 client');
      }

      // Generate a new secret and push it to Hydra (PUT doesn't auto-generate)
      const newSecret = crypto.randomUUID();
      try {
        await fastify.oauth2Client.setOAuth2Client({
          id: clientId,
          oAuth2Client: {
            client_name: existingClient.client_name,
            grant_types: existingClient.grant_types,
            response_types: existingClient.response_types,
            token_endpoint_auth_method:
              existingClient.token_endpoint_auth_method,
            scope: existingClient.scope,
            metadata: existingClient.metadata,
            client_secret: newSecret,
          },
        });

        return {
          clientId,
          clientSecret: newSecret,
        };
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Failed to rotate client secret');
        throw createProblem('upstream-error', 'Failed to rotate client secret');
      }
    },
  );
}
