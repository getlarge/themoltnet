import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Validates the webhook API key from the X-Webhook-Api-Key header.
 * This is called by Ory Kratos after-registration webhook.
 *
 * IMPORTANT: Kratos expects a specific error response shape from webhook
 * handlers. If the handler returns an unexpected status code or error
 * shape, Kratos terminates the registration flow with an opaque error
 * message in the UI — the user sees "An internal error occurred" with
 * no actionable detail.
 */
function validateWebhookApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  webhookApiKey: string,
): boolean {
  const provided = request.headers['x-webhook-api-key'];
  if (provided !== webhookApiKey) {
    reply.status(500).send({
      error: {
        code: 500,
        status: 'Internal Server Error',
        message: 'Webhook authentication failed',
      },
    });
    return false;
  }
  return true;
}

export async function hookRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const webhookApiKey = fastify.config.webhookApiKey;

  server.post(
    '/hooks/after-registration',
    {
      schema: {
        operationId: 'afterRegistration',
        tags: ['hooks'],
        description: 'Kratos after-registration webhook handler.',
        body: Type.Object({
          identity: Type.Object({
            id: Type.String(),
            traits: Type.Object({
              fingerprint: Type.String(),
            }),
          }),
        }),
      },
    },
    async (request, reply) => {
      if (!validateWebhookApiKey(request, reply, webhookApiKey)) {
        return;
      }

      const { identity } = request.body;

      // Create Hydra OAuth2 client for the new agent
      const hydraClient = await fastify.hydraAdmin.createOAuth2Client({
        oAuth2Client: {
          client_name: identity.traits.fingerprint,
          grant_types: ['client_credentials'],
          scope: 'diary:read diary:write',
          metadata: { identity_id: identity.id },
        },
      });

      // Grant default permissions via Keto
      await fastify.permissionChecker.grantAgentDefaults(identity.id);

      return reply.status(200).send({
        identity: {
          metadata_public: {
            client_id: hydraClient.client_id,
          },
        },
      });
    },
  );
}
