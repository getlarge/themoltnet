/**
 * Ory webhook handler routes
 *
 * POST /hooks/kratos/after-registration — Kratos after-registration webhook
 * POST /hooks/kratos/after-settings — Kratos after-settings webhook
 * POST /hooks/hydra/token-exchange — Hydra token exchange webhook
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

export async function hookRoutes(fastify: FastifyInstance) {
  // ── Kratos After Registration ──────────────────────────────
  // Called by Kratos after successful self-service registration.
  // Creates an entry in agent_keys and registers the agent in Keto.
  fastify.post(
    '/hooks/kratos/after-registration',
    {
      schema: {
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

      await fastify.moltnetPermissions.registerAgent(identity.id);

      return reply.status(200).send({ success: true });
    },
  );

  // ── Kratos After Settings ──────────────────────────────────
  // Called by Kratos after self-service settings update.
  // Updates the agent_keys entry if traits changed.
  fastify.post(
    '/hooks/kratos/after-settings',
    {
      schema: {
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
  // Called by Hydra during token exchange (client_credentials grant).
  // Enriches the access token with agent metadata from client metadata.
  fastify.post(
    '/hooks/hydra/token-exchange',
    {
      schema: {
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

      // Look up the agent by client_id metadata.
      // In practice, we'd fetch the OAuth2 client to get its metadata,
      // then look up the agent. For now, we try to find by identity_id
      // stored in the Keto/agent_keys table.
      // The client metadata would contain identity_id, but since
      // we can't access the OAuth2 admin API here without the Ory SDK,
      // we return a 204 (accept without modification) as a safe default.

      // If we had the oauth2 client metadata, we'd do:
      // const agent = await fastify.agentRepository.findByIdentityId(metadata.identity_id);
      // Then return the enriched session.

      // For now, accept without enrichment (204)
      // The auth library will fall back to fetching client metadata
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
