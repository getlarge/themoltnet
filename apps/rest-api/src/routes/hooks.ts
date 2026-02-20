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
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const webhookAuth = validateWebhookApiKey(fastify.webhookApiKey);
  // ── Kratos After Registration ──────────────────────────────
  server.post(
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
      const { identity } = request.body;

      const { public_key, voucher_code } = identity.traits;

      // ── Validate public_key format and Ed25519 key bytes ──────────
      // Pure validation — no side effects, safe outside the transaction.
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

      // ── Transactional registration ────────────────────────────────
      // Wrap all side effects so that if any step fails, the voucher
      // remains valid and the agent record is not persisted.
      // The Keto registration is inside the transaction: if it fails,
      // the DB changes roll back and the voucher remains redeemable.
      // If Keto succeeds, the transaction commits atomically with the
      // voucher redemption and agent upsert.
      const result = await fastify.transactionRunner.runInTransaction(
        async () => {
          const voucher = await fastify.voucherRepository.redeem(
            voucher_code,
            identity.id,
          );

          if (!voucher) {
            return { rejected: true as const };
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

          await fastify.relationshipWriter.registerAgent(identity.id);
          const privateDiary =
            await fastify.diaryCatalogRepository.getOrCreateDefaultDiary(
              identity.id,
              'private',
            );
          await fastify.relationshipWriter.grantDiaryOwner(
            privateDiary.id,
            identity.id,
          );

          return { rejected: false as const };
        },
        { name: 'hooks.after-registration' },
      );

      if (result.rejected) {
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

      // Return identity update for Kratos (requires response.parse: true).
      // Sets metadata_public so the fingerprint is available on the identity
      // without an extra DB lookup.
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
      const { request: tokenRequest } = request.body;

      try {
        // Fetch OAuth2 client metadata from Hydra to get identity_id
        const clientData = await fastify.oauth2Client.getOAuth2Client({
          id: tokenRequest.client_id,
        });

        if (!isMoltNetMetadata(clientData.metadata)) {
          fastify.log.warn(
            { client_id: tokenRequest.client_id },
            'Token exchange rejected: OAuth2 client has no MoltNet metadata',
          );
          return await reply.status(403).send({
            error: 'invalid_client_metadata',
            error_description: 'OAuth2 client is not a MoltNet agent',
          });
        }

        const identityId = clientData.metadata.identity_id;

        // Look up agent from database
        const agent =
          await fastify.agentRepository.findByIdentityId(identityId);

        if (!agent) {
          fastify.log.warn(
            {
              identity_id: identityId,
              client_id: tokenRequest.client_id,
              missing_claims: ['public_key', 'fingerprint'],
            },
            'Token exchange rejected: no agent record for identity_id',
          );
          return await reply.status(403).send({
            error: 'agent_not_found',
            error_description: 'No agent record found for identity',
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
          'Token exchange failed: error enriching token',
        );
        return reply.status(500).send({
          error: 'enrichment_failed',
          error_description: 'Failed to enrich token with agent claims',
        });
      }
    },
  );
}
