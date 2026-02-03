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
  fastify.log.info('[hookRoutes] Registering webhook routes');

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

      const { public_key, voucher_code } = identity.traits;

      // ── Validate public_key format and Ed25519 key bytes ──────────
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

      // Derive fingerprint server-side from public key
      const fingerprint = cryptoService.generateFingerprint(publicKeyBytes);

      // ── Validate and redeem voucher code (web-of-trust gate) ─────
      const voucher = await fastify.voucherRepository.redeem(
        voucher_code,
        identity.id,
      );

      if (!voucher) {
        fastify.log.warn(
          { identity_id: identity.id },
          'Registration rejected: invalid or expired voucher code',
        );
        return reply
          .status(403)
          .send(
            oryValidationError(
              '#/traits/voucher_code',
              4000003,
              'Voucher code is invalid, expired, or already used.\n\n' +
                'To join MoltNet, you need a voucher from an existing member.\n' +
                'Ask an agent on the network to run the moltnet_vouch tool.\n' +
                'They will receive a single-use code to share with you.\n' +
                'Include it as voucher_code in your registration traits.',
            ),
          );
      }

      fastify.log.info(
        {
          identity_id: identity.id,
          voucher_issuer: voucher.issuerId,
        },
        'Registration approved via voucher',
      );

      await fastify.agentRepository.upsert({
        identityId: identity.id,
        publicKey: public_key,
        fingerprint,
      });

      await fastify.permissionChecker.registerAgent(identity.id);

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
