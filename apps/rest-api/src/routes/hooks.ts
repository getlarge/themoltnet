/**
 * Ory webhook handler routes (internal — hidden from public OpenAPI spec)
 *
 * POST /hooks/kratos/after-registration — Kratos after-registration webhook
 * POST /hooks/kratos/after-settings — Kratos after-settings webhook
 * POST /hooks/hydra/token-exchange — Hydra token exchange webhook
 */

import crypto from 'node:crypto';

import type { OryClients } from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createProblem } from '../problems/index.js';

// Webhook dependencies are accessed via decorators
declare module 'fastify' {
  interface FastifyInstance {
    webhookApiKey: string;
    oauth2Client: OryClients['oauth2'];
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

  const webhookAuth = validateWebhookApiKey(fastify.webhookApiKey);
  // ── Kratos After Registration ──────────────────────────────
  // NOTE: This webhook is no longer used for the main registration flow.
  // The /auth/register endpoint uses Admin API + DBOS workflow instead.
  // This webhook is kept for backward compatibility with any direct Kratos usage.
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
              public_key: Type.String(),
              voucher_code: Type.String(),
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
            public_key: string;
            voucher_code: string;
          };
        };
      };

      const { public_key } = identity.traits;

      // ── Validate public_key format ──────────────────────────────────
      let publicKeyBytes: Uint8Array;
      try {
        publicKeyBytes = cryptoService.parsePublicKey(public_key);
      } catch {
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/traits/public_key',
              4000001,
              'public_key must use format "ed25519:<base64>" where <base64> is ' +
                'your raw 32-byte Ed25519 public key encoded in base64.',
            ),
          );
      }

      if (publicKeyBytes.length !== 32) {
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/traits/public_key',
              4000001,
              `public_key must be exactly 32 bytes (got ${publicKeyBytes.length}). ` +
                'Provide the raw Ed25519 public key, not an SPKI/X.509 wrapper.',
            ),
          );
      }

      const fingerprint = cryptoService.generateFingerprint(publicKeyBytes);

      // Return success with fingerprint metadata
      // The actual registration logic happens in /auth/register via DBOS workflow
      return reply.status(200).send({
        identity: {
          metadata_public: {
            fingerprint,
            public_key: public_key,
          },
        },
      });
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
              public_key: Type.String(),
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
            public_key: string;
          };
        };
      };

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
          fastify.log.error(
            { client_id: tokenRequest.client_id },
            'OAuth2 client has no valid MoltNet metadata',
          );
          return await reply.status(500).send({
            error: 'token_enrichment_failed',
            error_description:
              'OAuth2 client missing required MoltNet metadata',
          });
        }

        const identityId = clientData.metadata.identity_id;

        // Look up agent from database
        const agent =
          await fastify.agentRepository.findByIdentityId(identityId);

        if (!agent) {
          fastify.log.error(
            { identity_id: identityId, client_id: tokenRequest.client_id },
            'No agent found for identity_id',
          );
          return await reply.status(500).send({
            error: 'token_enrichment_failed',
            error_description: 'Agent record not found for identity',
          });
        }

        // Return enriched claims - all required fields are present
        return await reply.status(200).send({
          session: {
            access_token: {
              'moltnet:identity_id': agent.identityId,
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
        // Return error so Hydra rejects the token grant
        return reply.status(500).send({
          error: 'token_enrichment_failed',
          error_description: 'Failed to enrich token with agent claims',
        });
      }
    },
  );
}
