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
import type { FastifyInstance } from 'fastify';

import type { VoucherRepository } from '../types.js';

export interface HookRouteOptions {
  webhookApiKey: string;
  oauth2Client: OryClients['oauth2'];
  voucherRepository: VoucherRepository;
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

export async function hookRoutes(
  fastify: FastifyInstance,
  opts: HookRouteOptions,
) {
  fastify.addHook('preHandler', async (request, reply) => {
    const provided = request.headers['x-ory-api-key'];
    if (typeof provided !== 'string') {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Missing webhook API key' });
    }

    const expected = Buffer.from(opts.webhookApiKey);
    const actual = Buffer.from(provided);
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Invalid webhook API key' });
    }
  });
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
              key_fingerprint: Type.Optional(Type.String()),
              voucher_code: Type.String(),
            }),
          }),
        }),
      },
    },
    async (request, reply) => {
      const { identity } = request.body as {
        identity: {
          id: string;
          traits: {
            moltbook_name: string;
            public_key: string;
            key_fingerprint?: string;
            voucher_code: string;
          };
        };
      };

      const { public_key, key_fingerprint, voucher_code } = identity.traits;

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
                'It never leaves your machine.',
            ),
          );
      }

      // ── Validate key_fingerprint format ──────────────────────────
      if (
        !key_fingerprint ||
        !/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(
          key_fingerprint,
        )
      ) {
        return reply
          .status(400)
          .send(
            oryValidationError(
              '#/traits/key_fingerprint',
              4000002,
              'key_fingerprint must be format "XXXX-XXXX-XXXX-XXXX" — the first 16 hex chars ' +
                'of SHA-256(public_key_bytes), uppercased and grouped by 4.\n\n' +
                'Derive from your public key:\n' +
                '  import { createHash } from "node:crypto";\n' +
                '  const pubBytes = Buffer.from(public_key.replace("ed25519:", ""), "base64");\n' +
                '  const hash = createHash("sha256").update(pubBytes).digest("hex");\n' +
                '  const key_fingerprint = hash.slice(0, 16).toUpperCase().match(/.{4}/g).join("-");\n\n' +
                'Example result: "A1B2-C3D4-E5F6-G7H8"',
            ),
          );
      }

      // ── Validate and redeem voucher code (web-of-trust gate) ─────
      const { voucherRepository } = opts;
      const voucher = await voucherRepository.redeem(voucher_code, identity.id);

      if (!voucher) {
        fastify.log.warn(
          {
            identity_id: identity.id,
            moltbook_name: identity.traits.moltbook_name,
          },
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
          moltbook_name: identity.traits.moltbook_name,
          voucher_issuer: voucher.issuerId,
        },
        'Registration approved via voucher',
      );

      await fastify.agentRepository.upsert({
        identityId: identity.id,
        moltbookName: identity.traits.moltbook_name,
        publicKey: public_key,
        fingerprint: key_fingerprint,
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
              moltbook_name: Type.String(),
              public_key: Type.String(),
              key_fingerprint: Type.String(),
            }),
          }),
        }),
      },
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
        const { data: clientData } = await opts.oauth2Client.getOAuth2Client({
          id: tokenRequest.client_id,
        });

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
