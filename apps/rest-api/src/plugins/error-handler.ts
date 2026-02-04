import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import {
  findProblemTypeByCode,
  findProblemTypeByStatus,
  getTypeUri,
} from '../problems/registry.js';

interface ProblemError extends FastifyError {
  detail?: string;
  validationErrors?: { field: string; message: string }[];
}

async function errorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler(
    (error: ProblemError, request: FastifyRequest, reply: FastifyReply) => {
      const status = error.statusCode ?? 500;
      const isServerError = status >= 500;

      // 1. Log full error before sanitizing
      const logContext = {
        err: error,
        requestId: request.id,
        method: request.method,
        url: request.url,
        userId:
          (request as unknown as { authContext?: { identityId?: string } })
            .authContext?.identityId ?? null,
      };

      if (isServerError) {
        request.log.error(logContext, error.message);
      } else {
        request.log.warn(logContext, error.message);
      }

      // 2. Map to problem type
      const problemType =
        findProblemTypeByCode(error.code) ?? findProblemTypeByStatus(status);

      // 3. Handle Fastify schema validation errors
      const validationErrors =
        error.validationErrors ??
        (error.validation
          ? error.validation.map((v) => ({
              field: v.instancePath || v.params?.missingProperty || 'unknown',
              message: v.message ?? 'Validation failed',
            }))
          : undefined);

      const isValidationError = validationErrors !== undefined;
      const resolvedProblem = isValidationError
        ? {
            slug: 'validation-failed',
            code: 'VALIDATION_FAILED',
            title: 'Validation Failed',
            status: 400,
          }
        : problemType;

      // 4. Build response
      const detail = isServerError
        ? 'An unexpected error occurred'
        : (error.detail ?? error.message);

      const body: Record<string, unknown> = {
        type: getTypeUri(
          isValidationError ? 'validation-failed' : problemType.slug,
        ),
        title: resolvedProblem.title,
        status: isValidationError ? 400 : status,
        code: resolvedProblem.code,
        detail,
        instance: request.url,
      };

      if (validationErrors) {
        body.errors = validationErrors;
      }

      return reply
        .status(isValidationError ? 400 : status)
        .header('content-type', 'application/problem+json')
        .send(body);
    },
  );
}

export const errorHandlerPlugin = fp(errorHandler, {
  name: 'problem-details-error-handler',
});
