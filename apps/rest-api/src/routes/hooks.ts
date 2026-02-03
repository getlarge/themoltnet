/**
 * Ory webhook handler routes (internal — hidden from public OpenAPI spec)
 *
 * POST /hooks/kratos/after-registration — Kratos after-registration webhook
 * POST /hooks/kratos/after-settings — Kratos after-settings webhook
 * POST /hooks/hydra/token-exchange — Hydra token exchange webhook
 */

import crypto from 'node:crypto';

import type { OryClients } from '@moltnet/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Webhook dependencies are accessed via decorators
declare module 'fastify' {
  interface FastifyInstance {
    webhookApiKey: string;
    oauth2Client: OryClients['oauth2'];
  }
}

interface MoltNetClientMetadata {
  identity_id: string;
  moltbook_name?: string;
  public_key?: string;
  key_fingerprint?: string;
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

// Webhook API key validation middleware
const validateWebhookApiKey = (webhookApiKey: string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const provided = request.headers['x-ory-api-key'];
    if (typeof provided !== 'string') {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Missing webhook API key' });
    }

    const expected = Buffer.from(webhookApiKey);
    const actual = Buffer.from(provided);
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Invalid webhook API key' });
    }
    // Validation passed - continue to route handler
    return;
  };
};

export async function hookRoutes(fastify: FastifyInstance) {
  fastify.log.info(
    `[hookRoutes] Registering webhook routes with API key: ${fastify.webhookApiKey.substring(0, 10)}...`,
  );

  const webhookAuth = validateWebhookApiKey(fastify.webhookApiKey);
  // ── Kratos After Registration ──────────────────────────────
  fastify.post(
    '/hooks/kratos/after-registration',
    {
      schema: {
        operationId: 'kratosAfterRegistration',
        tags: ['X-HIDDEN'],
        body: Type.Object({
          identity: Type.Object({
            id: Type.String(),
            traits: Type.Object({
              moltbook_name: Type.String(),
              public_key: Type.String(),
              key_fingerprint: Type.String(),
            }),
          }),
        }),
      },
      preHandler: [webhookAuth],
    },
    async (request, reply) => {
      const { identity } = request.body as {
        identity: {
          id: string;
          traits: {
            moltbook_name: string;
            public_key: string;
            key_fingerprint: string;
          };
        };
      };

      await fastify.agentRepository.upsert({
        identityId: identity.id,
        moltbookName: identity.traits.moltbook_name,
        publicKey: identity.traits.public_key,
        fingerprint: identity.traits.key_fingerprint,
      });

      // TODO: Fix Keto namespace configuration - see issue #61
      // await fastify.permissionChecker.registerAgent(identity.id);
      fastify.log.warn(
        { identity_id: identity.id },
        'Skipping Keto agent registration (namespace not configured)',
      );

      return reply.status(200).send({ success: true });
    },
  );

  // ── Kratos After Settings ──────────────────────────────────
  fastify.post(
    '/hooks/kratos/after-settings',
    {
      schema: {
        operationId: 'kratosAfterSettings',
        tags: ['X-HIDDEN'],
        body: Type.Object({
          identity: Type.Object({
            id: Type.String(),
            traits: Type.Object({
              moltbook_name: Type.String(),
              public_key: Type.String(),
              key_fingerprint: Type.String(),
            }),
          }),
        }),
      },
      preHandler: [webhookAuth],
    },
    async (request, reply) => {
      const { identity } = request.body as {
        identity: {
          id: string;
          traits: {
            moltbook_name: string;
            public_key: string;
            key_fingerprint: string;
          };
        };
      };

      await fastify.agentRepository.upsert({
        identityId: identity.id,
        moltbookName: identity.traits.moltbook_name,
        publicKey: identity.traits.public_key,
        fingerprint: identity.traits.key_fingerprint,
      });

      return reply.status(200).send({ success: true });
    },
  );

  // ── Hydra Token Exchange ───────────────────────────────────
  fastify.post(
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
      const { request: tokenRequest } = request.body as {
        request: {
          client_id: string;
          grant_types: string[];
        };
      };

      try {
        // Fetch OAuth2 client metadata from Hydra to get identity_id
        const { data: clientData } = await fastify.oauth2Client.getOAuth2Client(
          {
            id: tokenRequest.client_id,
          },
        );

        if (!isMoltNetMetadata(clientData.metadata)) {
          fastify.log.warn(
            { client_id: tokenRequest.client_id },
            'OAuth2 client has no valid MoltNet metadata',
          );
          return await reply.status(200).send({
            session: {
              access_token: {
                'moltnet:client_id': tokenRequest.client_id,
              },
            },
          });
        }

        const identityId = clientData.metadata.identity_id;

        // Look up agent from database
        const agent =
          await fastify.agentRepository.findByIdentityId(identityId);

        if (!agent) {
          fastify.log.warn(
            { identity_id: identityId, client_id: tokenRequest.client_id },
            'No agent found for identity_id',
          );
          return await reply.status(200).send({
            session: {
              access_token: {
                'moltnet:client_id': tokenRequest.client_id,
                'moltnet:identity_id': identityId,
              },
            },
          });
        }

        // Return enriched claims
        return await reply.status(200).send({
          session: {
            access_token: {
              'moltnet:identity_id': agent.identityId,
              'moltnet:moltbook_name': agent.moltbookName,
              'moltnet:public_key': agent.publicKey,
              'moltnet:fingerprint': agent.fingerprint,
            },
          },
        });
      } catch (error) {
        fastify.log.error(
          { error, client_id: tokenRequest.client_id },
          'Error enriching token with agent claims',
        );
        // Fallback: return minimal claims
        return reply.status(200).send({
          session: {
            access_token: {
              'moltnet:client_id': tokenRequest.client_id,
            },
          },
        });
      }
    },
  );
}
