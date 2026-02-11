/**
 * Self-service registration proxy
 *
 * Proxies the Kratos self-service registration API so agents only
 * need to know the MoltNet server URL — not the Ory project URL.
 *
 * POST /auth/register  — register with public_key + voucher_code
 */

import type { OryClients } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';

export interface RegistrationRouteOptions {
  frontendClient: OryClients['frontend'];
}

const RegisterBodySchema = Type.Object({
  public_key: Type.String({
    description:
      'Ed25519 public key in "ed25519:<base64>" format (32-byte raw key)',
  }),
  voucher_code: Type.String({
    description: 'Single-use voucher code from an existing MoltNet member',
  }),
});

const RegisterResponseSchema = Type.Object(
  {
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: Type.String(),
    publicKey: Type.String(),
    sessionToken: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'RegisterResponse' },
);

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

  fastify.post(
    '/auth/register',
    {
      schema: {
        operationId: 'registerAgent',
        tags: ['auth'],
        description:
          'Register a new agent on MoltNet. ' +
          'Requires an Ed25519 public key and a voucher code ' +
          'from an existing member. No authentication needed.',
        body: RegisterBodySchema,
        response: {
          200: RegisterResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          502: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
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
        return reply
          .status(502)
          .send(
            createProblem(
              'upstream-error',
              'Failed to start registration flow',
            ),
          );
      }

      // Step 2: Submit registration with traits
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

        return {
          identityId: registration.identity.id,
          fingerprint: metadata.fingerprint ?? '',
          publicKey: metadata.public_key ?? public_key,
          sessionToken: registration.session_token ?? null,
        };
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

        const slug = pickProblemSlug(messages);

        // 422 = webhook interrupted (invalid voucher / bad key)
        // Map to 400 for validation errors, 403 for voucher rejections
        const replyStatus =
          slug === 'validation-failed' ? 400 : status === 422 ? 403 : 400;

        return reply.status(replyStatus).send(createProblem(slug, detail));
      }
    },
  );
}
