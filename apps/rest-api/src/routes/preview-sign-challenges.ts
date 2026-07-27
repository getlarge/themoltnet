import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  previewSignSchemaContext,
  ProblemDetailsSchema,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import { createProblem } from '../problems/index.js';
import {
  PreviewSignChallengeValidationSchema,
  ValidatePreviewSignChallengeSchema,
} from '../schemas.js';
import { throwSigningServiceProblem } from '../utils/signing-service-error.js';

const CHALLENGE_VALIDATION_BODY_LIMIT = 16 * 1024;

function rejectAuthenticationMaterial(request: {
  body: unknown;
  headers: Record<string, unknown>;
}): void {
  if (
    request.headers['authorization'] !== undefined ||
    request.headers['cookie'] !== undefined ||
    request.headers['x-moltnet-session-token'] !== undefined
  ) {
    throw createProblem(
      'validation-failed',
      'Signing companion validation accepts no authentication material',
    );
  }
  if (
    !Value.Check(
      {
        ...previewSignSchemaContext,
        ValidatePreviewSignChallenge: ValidatePreviewSignChallengeSchema,
      },
      ValidatePreviewSignChallengeSchema,
      request.body,
    )
  ) {
    throw createProblem(
      'validation-failed',
      'Signing companion validation contains unsupported or missing fields',
    );
  }
}

/**
 * Tokenless challenge introspection for the loopback signer.
 *
 * The route returns no resource metadata and uses the same not-found response
 * for missing, stale, mismatched, revoked, and already-completed state.
 */
export async function previewSignChallengeRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  server.post(
    '/crypto/preview-sign/challenges/validate',
    {
      bodyLimit: CHALLENGE_VALIDATION_BODY_LIMIT,
      config: { rateLimitBucket: 'public-verify' },
      onRequest: fastify.rateLimitHooks.publicVerify,
      preValidation: (request, _reply, done) => {
        rejectAuthenticationMaterial(request);
        done();
      },
      schema: {
        operationId: 'validatePreviewSignChallenge',
        tags: ['crypto'],
        description:
          'Validate an exact short-lived previewSign challenge against active persisted state without accepting human authentication material.',
        security: [],
        body: Type.Unsafe<Static<typeof ValidatePreviewSignChallengeSchema>>(
          Type.Ref(ValidatePreviewSignChallengeSchema.$id),
        ),
        response: {
          200: Type.Ref(PreviewSignChallengeValidationSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          429: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      try {
        return await fastify.signingService.challengeValidation.validateChallenge(
          {
            operation: request.body.operation,
            resourceId: request.body.resourceId,
            challenge: request.body.challenge,
          },
        );
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );
}
