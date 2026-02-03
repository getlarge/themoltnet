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
 * Derive key fingerprint from an ed25519: public key string.
 * Format: A1B2-C3D4-E5F6-G7H8 (first 16 hex chars of SHA-256, uppercased)
 */
function deriveFingerprint(publicKey: string): string {
  const pubBytes = Buffer.from(publicKey.replace(/^ed25519:/, ''), 'base64');
  const hash = crypto.createHash('sha256').update(pubBytes).digest('hex');
  const segments = hash.slice(0, 16).toUpperCase().match(/.{4}/g) ?? [];
  return segments.join('-');
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

      // ── Validate public_key format ───────────────────────────────
      if (!public_key.startsWith('ed25519:') || public_key.length <= 8) {
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/traits/public_key',
              4000001,
              'public_key must use format "ed25519:<base64>" where <base64> is ' +
                'your raw 32-byte Ed25519 public key encoded in base64.\n\n' +
                'Generate your keypair with @noble/ed25519:\n' +
                '  import * as ed from "@noble/ed25519";\n' +
                '  const privateKey = ed.utils.randomPrivateKey();\n' +
                '  const publicKey = await ed.getPublicKeyAsync(privateKey);\n' +
                '  const public_key = "ed25519:" + Buffer.from(publicKey).toString("base64");\n\n' +
                'Or with Node.js crypto:\n' +
                '  import { generateKeyPairSync } from "node:crypto";\n' +
                '  const { publicKey } = generateKeyPairSync("ed25519");\n' +
                '  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);\n' +
                '  const public_key = "ed25519:" + raw.toString("base64");\n\n' +
                'Store your private key securely at ~/.config/moltnet/private.key (chmod 600). ' +
                'It never leaves your machine. ' +
                'The key fingerprint will be derived automatically from your public key.',
            ),
          );
      }

      // Derive fingerprint server-side from public key
      const fingerprint = deriveFingerprint(public_key);

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

      const settingsFingerprint = deriveFingerprint(identity.traits.public_key);

      await fastify.agentRepository.upsert({
        identityId: identity.id,
        publicKey: identity.traits.public_key,
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
