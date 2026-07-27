import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
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
const SESSION_HEADER = 'x-moltnet-signer-session';

function schemaId(schema: TSchema): string {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Signer protocol schemas must have an identifier');
  }
  return id;
}

function schemaRef(schema: TSchema) {
  return Type.Ref(schemaId(schema));
}

export interface CreateSignerServerOptions {
  logger?: FastifyBaseLogger;
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

  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MoltNet signer companion API',
        description:
          'Private loopback protocol between MoltNet Console and the local signer companion.',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://127.0.0.1:{port}',
          description: 'Local signer companion',
          variables: {
            port: {
              default: '17373',
              description: 'Ephemeral or explicitly configured loopback port',
            },
          },
        },
      ],
      components: {
        securitySchemes: {
          signerSession: {
            type: 'apiKey',
            in: 'header',
            name: SESSION_HEADER,
            description:
              'Short-lived, origin-bound signer companion capability.',
          },
        },
      },
    },
    refResolver: {
      buildLocalReference(json) {
        return schemaId(json);
      },
    },
  });

  for (const schema of Object.values(signerProtocolSchemaContext)) {
    app.addSchema(schema);
  }

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(
          typeof body === 'string' ? Buffer.from(body) : body,
        );
        done(null, JSON.parse(json));
      } catch {
        done(
          new SignerCeremonyError(
            'ceremony_invalid',
            'Request body must be valid UTF-8 JSON',
          ),
          undefined,
        );
      }
    },
  );
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

  app.addHook('onRequest', (request, _reply, done) => {
    requireLoopbackHost(request);
    done();
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  void app.register(cors, {
    allowedHeaders: ['content-type', SESSION_HEADER],
    maxAge: 600,
    methods: ['GET', 'POST', 'OPTIONS'],
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, false);
        return;
      }
      try {
        service.assertOrigin(origin);
        callback(null, true);
      } catch (error) {
        callback(error as Error, false);
      }
    },
  });
  void app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        baseUri: ["'none'"],
        defaultSrc: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        styleSrc: ["'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: false,
    referrerPolicy: { policy: 'no-referrer' },
  });

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
        requireSameOriginConfirmation(request);
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
  const site = request.headers['sec-fetch-site'];
  const mode = request.headers['sec-fetch-mode'];
  const destination = request.headers['sec-fetch-dest'];
  if (
    (site !== 'cross-site' && site !== 'same-origin' && site !== 'none') ||
    mode !== 'navigate' ||
    destination !== 'document'
  ) {
    throw new SignerCeremonyError(
      'origin_not_allowed',
      'Approval must be opened as a browser navigation',
    );
  }
}

function requireSameOriginConfirmation(request: FastifyRequest): void {
  if (request.headers['sec-fetch-site'] !== 'same-origin') {
    throw new SignerCeremonyError(
      'origin_not_allowed',
      'Confirmation must come from the approval page',
    );
  }
}

function requireLoopbackHost(request: FastifyRequest): void {
  const host = request.headers.host;
  if (!host) {
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Host header is required',
    );
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Host header must identify loopback',
    );
  }
  if (
    hostname !== '127.0.0.1' &&
    hostname !== 'localhost' &&
    hostname !== '[::1]'
  ) {
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Host header must identify loopback',
    );
  }
}

function requireOrigin(request: FastifyRequest): string {
  const origin = request.headers.origin;
  if (!origin) {
    throw new SignerCeremonyError('origin_not_allowed', 'Origin is required');
  }
  return origin;
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
