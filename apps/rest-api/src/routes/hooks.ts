/**
 * Ory webhook handler routes (internal — hidden from public OpenAPI spec)
 *
 * POST /hooks/kratos/after-registration — Kratos after-registration webhook
 * POST /hooks/kratos/after-settings — Kratos after-settings webhook
 * POST /hooks/hydra/token-exchange — Hydra token exchange webhook
 */

import crypto from 'node:crypto';

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

export interface HookRouteOptions {
  webhookApiKey: string;
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

      return reply.status(200).send({
        session: {
          access_token: {
            'moltnet:client_id': tokenRequest.client_id,
          },
        },
      });
    },
  );
}
