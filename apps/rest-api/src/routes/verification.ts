import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  ClaimVerificationResponseSchema,
  RenderedPackParamsSchema,
  SubmitVerificationBodySchema,
  SubmitVerificationResponseSchema,
  VerifyRenderedPackBodySchema,
  VerifyRenderedPackResponseSchema,
} from '../schemas.js';
import { VerificationServiceError } from '../services/verification.service.js';

function toVerificationProblem(error: VerificationServiceError) {
  switch (error.code) {
    case 'not_found':
      return createProblem('not-found', error.message);
    case 'expired':
    case 'conflict':
      return createProblem('conflict', error.message);
    case 'invalid':
    case 'timed_out':
      return createProblem('validation-failed', error.message);
  }
}

export async function verificationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/rendered-packs/:id/verify',
    {
      schema: {
        operationId: 'verifyRenderedPack',
        tags: ['diary'],
        description:
          'Trigger fidelity verification for an agent-rendered pack.',
        security: [{ bearerAuth: [] }],
        params: RenderedPackParamsSchema,
        body: VerifyRenderedPackBodySchema,
        response: {
          201: Type.Ref(VerifyRenderedPackResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const renderedPack = await fastify.renderedPackRepository.findById(
        request.params.id,
      );
      if (!renderedPack) {
        throw createProblem('not-found', 'Rendered pack not found');
      }

      if (renderedPack.renderMethod.startsWith('server:')) {
        throw createProblem(
          'validation-failed',
          'Server-rendered packs are auto-attested and do not need verification',
        );
      }

      if (renderedPack.renderMethod === 'agent-refined:verified') {
        throw createProblem(
          'validation-failed',
          'Rendered pack is already verified',
        );
      }

      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canRead = await fastify.permissionChecker.canReadPack(
        renderedPack.sourcePackId,
        identityId,
        subjectNs,
      );
      if (!canRead) {
        throw createProblem('forbidden', 'Not authorized to verify this pack');
      }

      try {
        const result = await fastify.verificationService.createVerification(
          renderedPack.id,
          request.body.nonce,
        );
        return await reply.status(201).send(result);
      } catch (error) {
        if (error instanceof VerificationServiceError) {
          throw toVerificationProblem(error);
        }
        throw error;
      }
    },
  );

  server.post(
    '/rendered-packs/:id/verify/claim',
    {
      schema: {
        operationId: 'claimVerification',
        tags: ['diary'],
        description:
          'Judge claims verification payload (source entries, rendered content, and rubric).',
        security: [{ bearerAuth: [] }],
        params: RenderedPackParamsSchema,
        response: {
          200: Type.Ref(ClaimVerificationResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      try {
        return await fastify.verificationService.claim(
          request.params.id,
          request.authContext!.identityId,
        );
      } catch (error) {
        if (error instanceof VerificationServiceError) {
          throw toVerificationProblem(error);
        }
        throw error;
      }
    },
  );

  server.post(
    '/rendered-packs/:id/verify/submit',
    {
      schema: {
        operationId: 'submitVerification',
        tags: ['diary'],
        description: 'Judge submits fidelity scores and transcript.',
        security: [{ bearerAuth: [] }],
        params: RenderedPackParamsSchema,
        body: SubmitVerificationBodySchema,
        response: {
          200: Type.Ref(SubmitVerificationResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      try {
        return await fastify.verificationService.submit(request.params.id, {
          ...request.body,
          createdBy: request.authContext!.identityId,
        });
      } catch (error) {
        if (error instanceof VerificationServiceError) {
          throw toVerificationProblem(error);
        }
        throw error;
      }
    },
  );
}
