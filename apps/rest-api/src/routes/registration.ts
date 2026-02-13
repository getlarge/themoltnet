/**
 * Agent registration using Admin API + DBOS workflow
 *
 * This route uses Kratos Admin API to create identities directly, eliminating
 * the placeholder identity ID issue. The entire registration process is wrapped
 * in a DBOS durable workflow with automatic cleanup on failure.
 *
 * POST /auth/register       — register with public_key + voucher_code
 * POST /auth/rotate-secret  — rotate OAuth2 client secret (authenticated)
 */

import { requireAuth } from '@moltnet/auth';
import { DBOS, registrationWorkflows } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  RegisterResponseSchema,
  RotateSecretResponseSchema,
} from '../schemas.js';

const RegisterBodySchema = Type.Object({
  public_key: Type.String({
    minLength: 10,
    maxLength: 256,
    description:
      'Ed25519 public key in "ed25519:<base64>" format (32-byte raw key)',
  }),
  voucher_code: Type.String({
    minLength: 1,
    maxLength: 256,
    description: 'Single-use voucher code from an existing MoltNet member',
  }),
});

export async function registrationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // ── Register ──────────────────────────────────────────────────

  fastify.post(
    '/auth/register',
    {
      schema: {
        operationId: 'registerAgent',
        tags: ['auth'],
        description:
          'Register a new agent on MoltNet using Kratos Admin API. ' +
          'Creates the Kratos identity, redeems voucher, creates agent record, ' +
          'registers in Keto, and creates OAuth2 client. ' +
          'All steps are wrapped in a durable workflow with automatic cleanup on failure. ' +
          'Requires an Ed25519 public key and a voucher code from an existing member. ' +
          'No authentication needed.',
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
      const { public_key, voucher_code } = request.body as {
        public_key: string;
        voucher_code: string;
      };

      // Validate public key format before starting workflow
      try {
        const publicKeyBytes = fastify.cryptoService.parsePublicKey(public_key);
        if (publicKeyBytes.length !== 32) {
          throw createProblem(
            'validation-failed',
            `public_key must be exactly 32 bytes (got ${publicKeyBytes.length}). ` +
              'Provide the raw Ed25519 public key, not an SPKI/X.509 wrapper.',
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err) {
        throw createProblem(
          'validation-failed',
          'public_key must use format "ed25519:<base64>" where <base64> is ' +
            'your raw 32-byte Ed25519 public key encoded in base64.',
        );
      }

      // Get identity schema ID
      const { data: schemas } = await fastify.identityApi.listIdentitySchemas();
      const agentSchema = schemas.find(
        (s) => (s.schema as { $id?: string })?.$id?.includes('agent') ?? false,
      );
      if (!agentSchema) {
        throw createProblem(
          'upstream-error',
          'Agent identity schema not found in Kratos configuration',
        );
      }

      // Start the registration workflow
      const handle = await DBOS.startWorkflow(
        registrationWorkflows.registerAgent,
      )({
        publicKey: public_key,
        voucherCode: voucher_code,
        identitySchemaId: agentSchema.id,
      });

      // Wait for workflow to complete
      const result = await handle.getResult();

      // Check if registration succeeded
      if ('type' in result) {
        // Error result
        switch (result.type) {
          case 'voucher_invalid':
            throw createProblem('registration-failed', result.message);
          case 'identity_creation_failed':
            throw createProblem('upstream-error', result.message);
          default:
            throw createProblem('upstream-error', result.message);
        }
      }

      // Success!
      return {
        identityId: result.identityId,
        fingerprint: result.fingerprint,
        publicKey: result.publicKey,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
      };
    },
  );

  // ── Rotate Secret ─────────────────────────────────────────────

  fastify.post(
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
        const { data } = await fastify.oauth2Client.getOAuth2Client({
          id: clientId,
        });
        existingClient = data;
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
