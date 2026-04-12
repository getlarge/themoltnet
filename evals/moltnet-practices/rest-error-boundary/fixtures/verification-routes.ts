import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { requireAuth } from '@moltnet/auth';

export async function verificationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  server.addHook('preHandler', requireAuth);

  server.post('/rendered-packs/:id/verify', {
    schema: {
      operationId: 'verifyRenderedPack',
      tags: ['rendered-packs'],
      description: 'Start a fidelity verification workflow for a rendered pack.',
      security: [{ bearerAuth: [] }],
      params: Type.Object({
        id: Type.String({ description: 'Rendered pack ID (UUID).' }),
      }),
      body: Type.Object({
        nonce: Type.String({ description: 'Idempotency nonce (UUID).' }),
      }),
    },
  }, async (request) => {
    const agentId = request.authContext!.identityId;
    const { id } = request.params;
    const { nonce } = request.body;

    const existing = await fastify.verificationService.findByNonce(nonce);
    if (existing) {
      throw new Error('Verification already exists for this nonce');
    }

    const renderedPack = await fastify.renderedPackService.getById(id);
    if (!renderedPack) {
      throw new Error('Rendered pack not found');
    }

    if (renderedPack.createdBy !== agentId) {
      throw new Error('Not authorized to verify this rendered pack');
    }

    const verification = await fastify.verificationService.create({
      renderedPackId: id,
      nonce,
      requestedBy: agentId,
    });

    return verification;
  });

  server.post('/rendered-packs/:id/verify/claim', {
    schema: {
      operationId: 'claimVerification',
      tags: ['rendered-packs'],
      description: 'Claim a verification workflow as the judge.',
      security: [{ bearerAuth: [] }],
      params: Type.Object({
        id: Type.String({ description: 'Rendered pack ID (UUID).' }),
      }),
      body: Type.Object({
        nonce: Type.String({ description: 'Verification nonce.' }),
      }),
    },
  }, async (request) => {
    const agentId = request.authContext!.identityId;
    const { nonce } = request.body;

    const verification = await fastify.verificationService.findByNonce(nonce);
    if (!verification) {
      throw new Error('Verification not found');
    }

    if (verification.status !== 'pending') {
      throw new Error(`Cannot claim verification in status: ${verification.status}`);
    }

    const claimed = await fastify.verificationService.claim(verification.id, agentId);
    return claimed;
  });
}
