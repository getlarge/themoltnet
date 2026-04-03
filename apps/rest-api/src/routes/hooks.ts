/**
 * Ory webhook handler routes (internal — hidden from public OpenAPI spec)
 *
 * POST /hooks/kratos/after-registration — Kratos after-registration webhook
 * POST /hooks/kratos/after-settings — Kratos after-settings webhook
 * POST /hooks/hydra/token-exchange — Hydra token exchange webhook
 */

import crypto from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { OryClients } from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import type { HumanRepository } from '@moltnet/database';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createProblem } from '../problems/index.js';

// Webhook dependencies are accessed via decorators
declare module 'fastify' {
  interface FastifyInstance {
    webhookApiKey: string;
    oauth2Client: OryClients['oauth2'];
    humanRepository: HumanRepository;
  }
}

interface MoltNetClientMetadata {
  identity_id: string;
  public_key?: string;
}

function isMoltNetMetadata(
  metadata: object | undefined,
): metadata is MoltNetClientMetadata {
  return (
    metadata !== undefined &&
    'identity_id' in metadata &&
    typeof metadata.identity_id === 'string'
  );
}

/**
 * Build an Ory-compatible webhook error response.
 * Ory Kratos expects this schema for flow-interrupting webhooks:
 * { messages: [{ instance_ptr, messages: [{ id, text, type, context }] }] }
 */
function oryValidationError(instancePtr: string, id: number, text: string) {
  return {
    messages: [
      {
        instance_ptr: instancePtr,
        messages: [{ id, text, type: 'error', context: {} }],
      },
    ],
  };
}

// Webhook API key validation middleware
const validateWebhookApiKey = (webhookApiKey: string) => {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const provided = request.headers['x-ory-api-key'];
    if (typeof provided !== 'string') {
      throw createProblem('unauthorized', 'Missing webhook API key');
    }

    const expected = Buffer.from(webhookApiKey);
    const actual = Buffer.from(provided);
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      throw createProblem('unauthorized', 'Invalid webhook API key');
    }
    // Validation passed - continue to route handler
    return;
  };
};

// eslint-disable-next-line @typescript-eslint/require-await
export async function hookRoutes(fastify: FastifyInstance) {
  fastify.log.info('[hookRoutes] Registering webhook routes');
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const webhookAuth = validateWebhookApiKey(fastify.webhookApiKey);
  // ── Kratos After Registration (Human-Only) ────────────────
  server.post(
    '/hooks/kratos/after-registration',
    {
      schema: {
        operationId: 'kratosAfterRegistration',
        tags: ['X-HIDDEN'],
        body: Type.Object({
          identity: Type.Object({
            id: Type.String(),
            schema_id: Type.String(),
            traits: Type.Object(
              {
                email: Type.Optional(Type.String()),
                username: Type.Optional(Type.String()),
              },
              { additionalProperties: true },
            ),
          }),
        }),
      },
      preHandler: [webhookAuth],
    },
    async (request, reply) => {
      const { identity } = request.body;

      // Only accept human schema registrations
      if (!identity.schema_id.includes('human')) {
        fastify.log.warn(
          { schema_id: identity.schema_id },
          'After-registration webhook called with non-human schema — rejecting',
        );
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/',
              4000010,
              'Self-service registration is only available for humans. ' +
                'Agents must register via POST /auth/register.',
            ),
          );
      }

      // Create placeholder human record (identityId unknown at this point)
      const human = await fastify.humanRepository.create();

      fastify.log.info(
        { human_id: human.id, schema_id: identity.schema_id },
        'Human placeholder created via after-registration webhook',
      );

      // Return metadata_public so after-login hook can find this record
      return reply.status(200).send({
        identity: {
          metadata_public: {
            human_id: human.id,
          },
        },
      });
    },
  );

  // ── Kratos After Settings ──────────────────────────────────
  server.post(
    '/hooks/kratos/after-settings',
    {
      schema: {
        operationId: 'kratosAfterSettings',
        tags: ['X-HIDDEN'],
        body: Type.Object({
          identity: Type.Object({
            id: Type.String(),
            traits: Type.Object({
              public_key: Type.String(),
            }),
          }),
        }),
      },
      preHandler: [webhookAuth],
    },
    async (request, reply) => {
      const { identity } = request.body;

      const { public_key } = identity.traits;

      // ── Validate public_key format and Ed25519 key bytes ──────────
      let settingsKeyBytes: Uint8Array;
      try {
        settingsKeyBytes = cryptoService.parsePublicKey(public_key);
      } catch {
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/traits/public_key',
              4000001,
              'public_key must use format "ed25519:<base64>"',
            ),
          );
      }

      if (settingsKeyBytes.length !== 32) {
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/traits/public_key',
              4000001,
              `public_key must be exactly 32 bytes (got ${settingsKeyBytes.length}).`,
            ),
          );
      }

      const settingsFingerprint =
        cryptoService.generateFingerprint(settingsKeyBytes);

      await fastify.agentRepository.upsert({
        identityId: identity.id,
        publicKey: public_key,
        fingerprint: settingsFingerprint,
      });

      return reply.status(200).send({ success: true });
    },
  );

  // ── Hydra Token Exchange ───────────────────────────────────
  server.post(
    '/hooks/hydra/token-exchange',
    {
      schema: {
        operationId: 'hydraTokenExchange',
        tags: ['X-HIDDEN'],
        body: Type.Object({
          session: Type.Any(),
          request: Type.Object({
            client_id: Type.String(),
            grant_types: Type.Array(Type.String()),
          }),
        }),
      },
      preHandler: [webhookAuth],
    },
    async (request, reply) => {
      const tokenRequest = request.body.request;
      const session = request.body.session as
        | { access_token?: Record<string, unknown> }
        | undefined;

      try {
        // Fetch OAuth2 client metadata from Hydra to get identity_id
        const clientData = await fastify.oauth2Client.getOAuth2Client({
          id: tokenRequest.client_id,
        });

        // ── Agent path ───────────────────────────────────────────
        if (isMoltNetMetadata(clientData.metadata)) {
          const identityId = clientData.metadata.identity_id;

          const agent =
            await fastify.agentRepository.findByIdentityId(identityId);

          if (!agent) {
            fastify.log.warn(
              {
                identity_id: identityId,
                client_id: tokenRequest.client_id,
              },
              'Token exchange: no agent record for identity',
            );
            return await reply.status(403).send({
              error: 'agent_not_found',
              error_description: 'No agent record found for identity',
            });
          }

          return await reply.status(200).send({
            session: {
              access_token: {
                'moltnet:identity_id': agent.identityId,
                'moltnet:public_key': agent.publicKey,
                'moltnet:fingerprint': agent.fingerprint,
                'moltnet:subject_type': 'agent',
              },
            },
          });
        }

        // ── Human path ───────────────────────────────────────────
        // For authorization_code grants, the session contains claims
        // set during login/consent acceptance
        const subject = session?.access_token?.['moltnet:identity_id'] as
          | string
          | undefined;
        if (subject) {
          const human = await fastify.humanRepository.findByIdentityId(subject);

          if (human) {
            return await reply.status(200).send({
              session: {
                access_token: {
                  'moltnet:identity_id': human.identityId,
                  'moltnet:subject_type': 'human',
                },
              },
            });
          }
        }

        // ── Neither agent nor human ──────────────────────────────
        fastify.log.warn(
          { client_id: tokenRequest.client_id },
          'Token exchange: no MoltNet identity found',
        );
        return await reply.status(403).send({
          error: 'identity_not_found',
          error_description: 'No agent or human record found for this client',
        });
      } catch (error) {
        fastify.log.error(
          { error, client_id: tokenRequest.client_id },
          'Token exchange failed',
        );
        return reply.status(500).send({
          error: 'enrichment_failed',
          error_description: 'Failed to enrich token',
        });
      }
    },
  );
}
