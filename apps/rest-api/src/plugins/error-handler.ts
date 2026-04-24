import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import { acceptsProblemJson } from '../problems/helpers.js';
import {
  findProblemTypeByCode,
  findProblemTypeByStatus,
  getTypeUri,
} from '../problems/registry.js';

interface ProblemError extends FastifyError {
  detail?: string;
  validationErrors?: { field: string; message: string }[];
  retryAfter?: number;
}

/**
 * Walk an error chain (error.cause, error.originalError) looking for a
 * Postgres driver error and return its structured fields. Errors thrown by
 * `pg` expose `code` (SQLSTATE), `constraint`, `table`, `column`, `schema`,
 * and `detail`. DrizzleQueryError wraps the pg error under `.cause`, so the
 * top-level `err.code` is undefined — without unwrapping, failures like
 * `23505 unique_violation` are only visible in the stack trace span event
 * in Axiom and can't be filtered or alerted on.
 */
export function extractPgErrorFields(
  err: unknown,
): Record<string, string | undefined> | null {
  const visited = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      table?: unknown;
      column?: unknown;
      schema?: unknown;
      routine?: unknown;
      cause?: unknown;
    };
    // SQLSTATE codes are 5-char strings. Guarding on shape also avoids
    // confusing FastifyError.code (string tag like 'FST_ERR_VALIDATION')
    // with a pg SQLSTATE.
    if (
      typeof candidate.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(candidate.code)
    ) {
      return {
        pg_code: candidate.code,
        pg_constraint:
          typeof candidate.constraint === 'string'
            ? candidate.constraint
            : undefined,
        pg_table:
          typeof candidate.table === 'string' ? candidate.table : undefined,
        pg_column:
          typeof candidate.column === 'string' ? candidate.column : undefined,
        pg_schema:
          typeof candidate.schema === 'string' ? candidate.schema : undefined,
        pg_routine:
          typeof candidate.routine === 'string' ? candidate.routine : undefined,
      };
    }
    current = candidate.cause;
  }
  return null;
}

async function errorHandler(fastify: FastifyInstance) {
  // Tag errors without a statusCode as unexpected — these become 500s and
  // should be visible in observability dashboards as "unintentional".
  fastify.addHook('onError', (request, _reply, error, done) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (!status || status >= 500) {
      const pgFields = extractPgErrorFields(error);
      request.log.error(
        {
          err: error,
          unexpected: !status,
          requestId: request.id,
          method: request.method,
          url: request.url,
          ...(pgFields ?? {}),
        },
        status
          ? 'Intentional server error'
          : 'UNEXPECTED ERROR — no statusCode set, this should be investigated',
      );
    }
    done();
  });

  fastify.setErrorHandler(
    (error: ProblemError, request: FastifyRequest, reply: FastifyReply) => {
      const status = error.statusCode ?? 500;
      const isServerError = status >= 500;
      const validationContext = (
        error as ProblemError & { validationContext?: string }
      ).validationContext;

      // 1. Log full error before sanitizing. For 5xx, also surface pg
      // error fields (SQLSTATE, constraint, table) so failures are
      // filterable in Axiom — the wire response still masks the detail.
      const pgFields = isServerError ? extractPgErrorFields(error) : null;
      const logContext = {
        err: error,
        requestId: request.id,
        method: request.method,
        url: request.url,
        validationContext: validationContext ?? null,
        userId:
          (request as unknown as { authContext?: { identityId?: string } })
            .authContext?.identityId ?? null,
        ...(pgFields ?? {}),
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

      if (error.retryAfter !== undefined) {
        body.retryAfter = error.retryAfter;
      }

      // RFC 9457 recommends application/problem+json, but many HTTP clients
      // (including ogen-generated Go clients) only accept application/json.
      // Content-negotiate: use problem+json only if the client explicitly accepts it.
      const contentType = acceptsProblemJson(request.headers.accept)
        ? 'application/problem+json'
        : 'application/json';

      return reply
        .status(isValidationError ? 400 : status)
        .header('content-type', contentType)
        .send(body);
    },
  );
}

export const errorHandlerPlugin = fp(errorHandler, {
  name: 'problem-details-error-handler',
});
