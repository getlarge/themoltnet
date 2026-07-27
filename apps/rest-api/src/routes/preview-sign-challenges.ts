import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ProblemDetailsSchema } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  PreviewSignChallengeValidationSchema,
  ValidatePreviewSignChallengeSchema,
} from '../schemas.js';
import { throwSigningServiceProblem } from '../utils/signing-service-error.js';

const CHALLENGE_VALIDATION_BODY_LIMIT = 16 * 1024;

function exactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function rejectUnsupportedValidationPayload(request: {
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
    !exactKeys(request.body, [
      'challenge',
      'operation',
      'resourceId',
      'version',
    ])
  ) {
    throw createProblem(
      'validation-failed',
      'Signing companion validation contains unsupported or missing fields',
    );
  }
  const challenge = request.body['challenge'];
  if (!exactKeys(challenge, ['value', 'verificationMethod'])) {
    throw createProblem(
      'validation-failed',
      'Signing companion challenge contains unsupported or missing fields',
    );
  }
  const value = challenge['value'];
  if (
    !exactKeys(value, [
      'additionalArguments',
      'digest',
      'envelope',
      'outerCredentialId',
      'outerPublicKey',
      'previewKeyHandle',
      'verificationMethod',
      'version',
    ]) ||
    !exactKeys(value['outerPublicKey'], ['algorithm', 'curve', 'kty', 'x', 'y'])
  ) {
    throw createProblem(
      'validation-failed',
      'Signing companion challenge contains unsupported or missing fields',
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
      config: {
        rateLimit: fastify.rateLimitConfig.publicVerify,
      },
      preValidation: (request, _reply, done) => {
        rejectUnsupportedValidationPayload(request);
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
