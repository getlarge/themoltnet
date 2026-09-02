import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  assertNavigationRequest,
  isLoopbackViolation,
  registerLoopbackSecurity,
  rejectExplicitCrossSite,
  requireOriginHeader,
} from '@moltnet/loopback-companion';
import type { SignerCeremonyRequest } from '@moltnet/models';
import {
  SignerCeremonyParamsSchema,
  SignerCeremonyRequestSchema,
  SignerCeremonyResultSchema,
  SignerCeremonySchema,
  SignerOperationSchema,
  SignerProblemSchema,
  signerProtocolSchemaContext,
  SignerSessionSchema,
} from '@moltnet/models';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { type TSchema, Type } from 'typebox';

import { renderApprovalPage, renderResultPage } from './approval-page.js';
import {
  SignerCeremonyError,
  type SignerCeremonyService,
} from './ceremony-service.js';

const BODY_LIMIT = 16 * 1024;
export const SESSION_HEADER = 'x-moltnet-signer-session';

export function signerSchemaId(schema: TSchema): string {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Signer protocol schemas must have an identifier');
  }
  return id;
}

function schemaRef(schema: TSchema) {
  return Type.Ref(signerSchemaId(schema));
}

export interface CreateSignerServerOptions {
  logger?: FastifyBaseLogger;
  registerOpenApi?: (app: FastifyInstance) => void;
}

export function createSignerServer(
  service: SignerCeremonyService,
  options: CreateSignerServerOptions = {},
): FastifyInstance {
  const serverOptions = {
    ajv: {
      customOptions: {
        coerceTypes: false as const,
        removeAdditional: false as const,
      },
    },
    bodyLimit: BODY_LIMIT,
    connectionTimeout: 10_000,
    keepAliveTimeout: 5_000,
    requestTimeout: 10_000,
  };
  const app = options.logger
    ? Fastify({ ...serverOptions, loggerInstance: options.logger })
    : Fastify(serverOptions);
  app.server.headersTimeout = 12_000;
  options.registerOpenApi?.(app);

  for (const schema of Object.values(signerProtocolSchemaContext)) {
    app.addSchema(schema);
  }

  // Loopback Host enforcement, no-store responses, strict UTF-8 JSON
  // parsing, exact-origin CORS (with the Safari `null`-origin carve-out —
  // the route's one-time confirmation token remains mandatory), and the
  // hardened helmet profile. The ceremony service stays the origin
  // authority via the injected decision.
  registerLoopbackSecurity(app, {
    allowedHeaders: [SESSION_HEADER],
    isOriginAllowed: (origin) => service.isCorsOriginAllowed(origin),
    selfOrigins: [service.approvalOrigin],
  });

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      try {
        const form = new TextDecoder('utf-8', { fatal: true }).decode(
          typeof body === 'string' ? Buffer.from(body) : body,
        );
        done(null, new URLSearchParams(form));
      } catch {
        done(
          new SignerCeremonyError(
            'confirmation_invalid',
            'Confirmation form is invalid',
          ),
          undefined,
        );
      }
    },
  );

  app.after(() => {
    const server = app.withTypeProvider<TypeBoxTypeProvider>();

    server.get('/health', { schema: { hide: true } }, () => ({
      status: 'ok',
    }));

    server.post(
      '/v1/sessions',
      {
        schema: {
          operationId: 'createSignerSession',
          tags: ['signer'],
          description:
            'Create a short-lived signer capability bound to the browser Origin header.',
          response: {
            201: schemaRef(SignerSessionSchema),
            400: schemaRef(SignerProblemSchema),
            403: schemaRef(SignerProblemSchema),
          },
        },
      },
      async (request, reply) => {
        const origin = requireOrigin(request);
        return reply.code(201).send(service.createSession({ origin }));
      },
    );

    server.post(
      '/v1/ceremonies',
      {
        schema: {
          operationId: 'createSignerCeremony',
          tags: ['signer'],
          description:
            'Create an enrollment or previewSign ceremony for explicit local approval.',
          security: [{ signerSession: [] }],
          body: Type.Unsafe<SignerCeremonyRequest>(
            Type.Object(
              {
                version: Type.Literal(1),
                operation: schemaRef(SignerOperationSchema),
              },
              {
                allOf: [schemaRef(SignerCeremonyRequestSchema)],
              },
            ),
          ),
          response: {
            201: schemaRef(SignerCeremonySchema),
            400: schemaRef(SignerProblemSchema),
            401: schemaRef(SignerProblemSchema),
            403: schemaRef(SignerProblemSchema),
            409: schemaRef(SignerProblemSchema),
            502: schemaRef(SignerProblemSchema),
            503: schemaRef(SignerProblemSchema),
            504: schemaRef(SignerProblemSchema),
          },
        },
      },
      async (request, reply) => {
        const ceremony = await service.createCeremony({
          origin: requireOrigin(request),
          sessionToken: requireSessionHeader(request),
          request: request.body,
        });
        return reply.code(201).send(ceremony);
      },
    );

    server.get(
      '/v1/ceremonies/:ceremonyId/result',
      {
        schema: {
          operationId: 'getSignerCeremonyResult',
          tags: ['signer'],
          description: 'Read the current result of a signer ceremony.',
          security: [{ signerSession: [] }],
          params: SignerCeremonyParamsSchema,
          response: {
            200: schemaRef(SignerCeremonyResultSchema),
            400: schemaRef(SignerProblemSchema),
            401: schemaRef(SignerProblemSchema),
            403: schemaRef(SignerProblemSchema),
            409: schemaRef(SignerProblemSchema),
          },
        },
      },
      (request) =>
        service.getResult({
          ceremonyId: request.params.ceremonyId,
          origin: requireOrigin(request),
          sessionToken: requireSessionHeader(request),
        }),
    );

    server.get(
      '/ceremonies/:ceremonyId',
      {
        schema: {
          hide: true,
          params: SignerCeremonyParamsSchema,
        },
      },
      async (request, reply) => {
        requireApprovalNavigation(request);
        const approval = service.getApproval(request.params.ceremonyId);
        return reply.type('text/html; charset=utf-8').send(
          renderApprovalPage({
            ceremonyId: request.params.ceremonyId,
            ...approval,
          }),
        );
      },
    );

    server.post(
      '/ceremonies/:ceremonyId/confirm',
      {
        schema: {
          hide: true,
          params: SignerCeremonyParamsSchema,
        },
      },
      async (request, reply) => {
        rejectCrossSiteConfirmation(request);
        if (!(request.body instanceof URLSearchParams)) {
          throw new SignerCeremonyError(
            'confirmation_invalid',
            'Confirmation form is invalid',
          );
        }
        await service.confirmCeremony({
          ceremonyId: request.params.ceremonyId,
          confirmationToken: request.body.get('confirmationToken') ?? '',
        });
        return reply.type('text/html; charset=utf-8').send(
          renderResultPage({
            title: 'Action signed',
            message: 'The signed receipt is ready for the Console.',
            success: true,
          }),
        );
      },
    );
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({
      code: 'not_found',
      message: 'Route is not available',
    }),
  );
  app.setErrorHandler(async (error, request, reply) => {
    const signerError = normalizeError(error, request);
    const status = statusFor(signerError);
    if (request.headers.accept?.includes('text/html') === true) {
      return reply
        .code(status)
        .type('text/html; charset=utf-8')
        .send(
          renderResultPage({
            title: 'Signing stopped',
            message: signerError.message,
            success: false,
          }),
        );
    }
    return reply.code(status).send({
      code: signerError.code,
      message: signerError.message,
    });
  });

  return app;
}

function requireApprovalNavigation(request: FastifyRequest): void {
  try {
    assertNavigationRequest(request.headers);
  } catch {
    throw new SignerCeremonyError(
      'origin_not_allowed',
      'Approval must be opened as a browser navigation',
    );
  }
}

function rejectCrossSiteConfirmation(request: FastifyRequest): void {
  // The one-time confirmation token is the primary CSRF control. Safari may
  // omit Fetch Metadata on same-origin form submissions, so only reject an
  // explicit cross-site signal here instead of requiring the header.
  try {
    rejectExplicitCrossSite(request.headers);
  } catch {
    throw new SignerCeremonyError(
      'origin_not_allowed',
      'Confirmation must come from the approval page',
    );
  }
}

function requireOrigin(request: FastifyRequest): string {
  try {
    return requireOriginHeader(request.headers);
  } catch (cause) {
    throw new SignerCeremonyError('origin_not_allowed', 'Origin is required', {
      cause,
    });
  }
}

function requireSessionHeader(request: FastifyRequest): string {
  const token = request.headers[SESSION_HEADER];
  if (typeof token !== 'string' || token.length === 0) {
    throw new SignerCeremonyError(
      'session_invalid',
      'Signer session is required',
    );
  }
  return token;
}

function normalizeError(
  error: unknown,
  request: FastifyRequest,
): SignerCeremonyError {
  if (error instanceof SignerCeremonyError) return error;
  if (isLoopbackViolation(error)) {
    // Transport violations raised by @moltnet/loopback-companion. Origin
    // violations keep the signer's historical code and message; host and
    // body violations keep the lib's message (identical to the pre-lib
    // signer wording) under `ceremony_invalid`.
    switch (error.kind) {
      case 'origin_required':
      case 'origin_invalid':
      case 'origin_not_allowed':
      case 'navigation_required':
      case 'cross_site_rejected':
        return new SignerCeremonyError(
          'origin_not_allowed',
          'Origin is not allowed',
          { cause: error },
        );
      default:
        return new SignerCeremonyError('ceremony_invalid', error.message, {
          cause: error,
        });
    }
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.validation) {
    return new SignerCeremonyError(
      'ceremony_invalid',
      'Ceremony request is invalid',
      { cause: error },
    );
  }
  if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new SignerCeremonyError(
      'ceremony_invalid',
      'Request body is too large',
      { cause: error },
    );
  }
  if (
    fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' &&
    request.url.endsWith('/confirm')
  ) {
    return new SignerCeremonyError(
      'confirmation_invalid',
      'Confirmation form is invalid',
      { cause: error },
    );
  }
  if (fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new SignerCeremonyError(
      'ceremony_invalid',
      'Content-Type must be application/json',
      { cause: error },
    );
  }
  return new SignerCeremonyError('ceremony_invalid', 'Request is not valid', {
    cause: error,
  });
}

function statusFor(error: SignerCeremonyError): number {
  if (error.code === 'origin_not_allowed') return 403;
  if (
    error.code === 'session_invalid' ||
    error.code === 'confirmation_invalid'
  ) {
    return 401;
  }
  if (error.code === 'ceremony_invalid' || error.code === 'challenge_invalid') {
    return 400;
  }
  if (error.code === 'device_failed') return 502;
  if (error.code === 'device_timeout') return 504;
  if (error.code === 'server_unavailable') return 503;
  return 409;
}
