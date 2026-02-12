/**
 * Self-service registration proxy + credential management
 *
 * Proxies the Kratos self-service registration API so agents only
 * need to know the MoltNet server URL — not the Ory project URL.
 *
 * POST /auth/register       — register with public_key + voucher_code
 * POST /auth/rotate-secret  — rotate OAuth2 client secret (authenticated)
 */

import { type OryClients, requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  RegisterResponseSchema,
  RotateSecretResponseSchema,
} from '../schemas.js';

export interface RegistrationRouteOptions {
  frontendClient: OryClients['frontend'];
}

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

/**
 * Error IDs from the after-registration webhook (hooks.ts).
 * Kratos propagates these through the flow UI messages.
 */
const WEBHOOK_ERROR_IDS = {
  INVALID_PUBLIC_KEY: 4000001,
  INVALID_VOUCHER: 4000003,
} as const;

interface KratosMessage {
  id?: number;
  text: string;
  type: string;
}

function extractErrorMessages(data: unknown): KratosMessage[] {
  const d = data as {
    ui?: {
      messages?: KratosMessage[];
      nodes?: { messages?: KratosMessage[] }[];
    };
  };
  const msgs: KratosMessage[] = [];
  for (const m of d?.ui?.messages || []) {
    if (m.type === 'error') msgs.push(m);
  }
  for (const node of d?.ui?.nodes || []) {
    for (const m of node.messages || []) {
      if (m.type === 'error') msgs.push(m);
    }
  }
  return msgs;
}

function pickProblemSlug(
  messages: KratosMessage[],
): 'validation-failed' | 'registration-failed' {
  const hasPublicKeyError = messages.some(
    (m) => m.id === WEBHOOK_ERROR_IDS.INVALID_PUBLIC_KEY,
  );
  if (hasPublicKeyError) return 'validation-failed';
  return 'registration-failed';
}

export async function registrationRoutes(
  fastify: FastifyInstance,
  options: RegistrationRouteOptions,
) {
  const { frontendClient } = options;

  // ── Register ──────────────────────────────────────────────────

  fastify.post(
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
      const { public_key, voucher_code } = request.body as {
        public_key: string;
        voucher_code: string;
      };

      // Step 1: Create a native registration flow
      let flow;
      try {
        const result = await frontendClient.createNativeRegistrationFlow();
        flow = result.data;
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Failed to create registration flow');
        throw createProblem(
          'upstream-error',
          'Failed to start registration flow',
        );
      }

      // Step 2: Submit registration with traits
      let identityId: string;
      let fingerprint: string;
      let publicKey: string;
      try {
        const { data: registration } =
          await frontendClient.updateRegistrationFlow({
            flow: flow.id,
            updateRegistrationFlowBody: {
              method: 'password',
              password: `moltnet-${crypto.randomUUID()}`,
              traits: {
                public_key,
                voucher_code,
              },
            },
          });

        const metadata =
          (registration.identity.metadata_public as {
            fingerprint?: string;
            public_key?: string;
          }) || {};

        identityId = registration.identity.id;
        fingerprint = metadata.fingerprint ?? '';
        publicKey = metadata.public_key ?? public_key;
      } catch (err: unknown) {
        const axiosError = err as {
          response?: { status: number; data: unknown };
        };
        const status = axiosError.response?.status;
        const data = axiosError.response?.data;

        const messages = extractErrorMessages(data);
        const detail =
          messages.length > 0
            ? messages.map((m) => m.text).join('; ')
            : 'Registration failed';

        // No status or 5xx → upstream infrastructure error
        // 4xx → check error messages to distinguish validation vs registration failure
        // (native flows return 400, browser flows return 422)
        if (status === undefined || status >= 500) {
          throw createProblem('upstream-error', detail);
        }
        throw createProblem(pickProblemSlug(messages), detail);
      }

      // Step 2.5: Complete registration with real identity ID
      // The Kratos webhook created an agent record with a placeholder ID
      // (00000000-0000-0000-0000-000000000000). Now that we have the real
      // identity ID, we:
      // 1. Delete the placeholder agent record (if it exists)
      // 2. Update the voucher's redeemedBy to the real identity ID
      // 3. Create/update the agent record with the real identity ID
      // 4. Register the agent in Keto for permission checks
      try {
        // Check for placeholder agent record and delete it
        const placeholderId = '00000000-0000-0000-0000-000000000000';
        const placeholderAgent =
          await fastify.agentRepository.findByIdentityId(placeholderId);
        if (placeholderAgent && placeholderAgent.fingerprint === fingerprint) {
          await fastify.agentRepository.delete(placeholderId);
          fastify.log.info(
            { fingerprint, placeholder_id: placeholderId },
            'Deleted placeholder agent record',
          );
        }

        // Update voucher with real identity ID
        await fastify.voucherRepository.updateRedeemedBy(
          voucher_code,
          identityId,
        );

        // Create agent record with real identity ID
        await fastify.agentRepository.upsert({
          identityId,
          publicKey,
          fingerprint,
        });

        // Register agent in Keto
        await fastify.permissionChecker.registerAgent(identityId);

        fastify.log.info(
          { identity_id: identityId, fingerprint },
          'Registration completed with real identity ID',
        );
      } catch (err: unknown) {
        fastify.log.error(
          { err, identity_id: identityId },
          'Failed to complete registration',
        );
        throw createProblem(
          'upstream-error',
          'Registration succeeded but post-processing failed',
        );
      }

      // Step 3: Create OAuth2 client in Hydra
      try {
        const { data: oauthClient } =
          await fastify.oauth2Client.createOAuth2Client({
            oAuth2Client: {
              client_name: `Agent: ${fingerprint}`,
              grant_types: ['client_credentials'],
              response_types: [],
              token_endpoint_auth_method: 'client_secret_post',
              scope: '',
              metadata: {
                type: 'moltnet_agent',
                identity_id: identityId,
                public_key: publicKey,
                fingerprint,
              },
            },
          });

        if (!oauthClient.client_id || !oauthClient.client_secret) {
          throw new Error('Hydra did not return client_id/client_secret');
        }

        return {
          identityId,
          fingerprint,
          publicKey,
          clientId: oauthClient.client_id,
          clientSecret: oauthClient.client_secret,
        };
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Failed to create OAuth2 client');
        throw createProblem(
          'upstream-error',
          'Registration succeeded but OAuth2 client creation failed',
        );
      }
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
