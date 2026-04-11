/**
 * @moltnet/rest-api — App Factory
 *
 * Creates and configures the Fastify application with all routes.
 * Services are injected via the options parameter.
 */

import swagger from '@fastify/swagger';
import {
  authPlugin,
  type OryClients,
  type PermissionChecker,
  type RelationshipReader,
  type RelationshipWriter,
  type SessionResolver,
  type TeamResolver,
  type TokenValidator,
} from '@moltnet/auth';
import scalarApiReference from '@scalar/fastify-api-reference';
import Fastify, { type FastifyInstance } from 'fastify';

import type { PackGcConfig } from './config.js';
import { corsPluginFp } from './plugins/cors.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { requestContextPlugin } from './plugins/request-context.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { agentRoutes } from './routes/agents.js';
import { cryptoRoutes } from './routes/crypto.js';
import { diaryRoutes } from './routes/diary.js';
import { diaryDistillRoutes } from './routes/diary-distill.js';
import { diaryEntryRoutes } from './routes/diary-entries.js';
import { entryRelationRoutes } from './routes/entry-relations.js';
import { groupRoutes } from './routes/groups.js';
import { type HealthRouteOptions, healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { oauth2Routes } from './routes/oauth2.js';
import { packRoutes } from './routes/packs.js';
import { problemRoutes } from './routes/problems.js';
import { publicRoutes } from './routes/public.js';
import { recoveryRoutes } from './routes/recovery.js';
import { registrationRoutes } from './routes/registration.js';
import { renderedPackRoutes } from './routes/rendered-packs.js';
import { signingRequestRoutes } from './routes/signing-requests.js';
import { teamRoutes } from './routes/teams.js';
import { verificationRoutes } from './routes/verification.js';
import { vouchRoutes } from './routes/vouch.js';
import { sharedSchemas } from './schemas.js';
import type {
  AgentRepository,
  AttestationRepository,
  ContextPackRepository,
  ContextPackService,
  CryptoService,
  DataSource,
  DiaryEntryRepository,
  DiaryService,
  DiaryTransferRepository,
  EmbeddingService,
  EntryRelationRepository,
  GroupRepository,
  HumanRepository,
  NonceRepository,
  RenderedPackRepository,
  SigningRequestRepository,
  TeamRepository,
  TransactionRunner,
  VerificationService,
  VoucherRepository,
} from './types.js';

export interface SecurityOptions {
  /** Comma-separated list of allowed CORS origins */
  corsOrigins: string;
  /** Max requests per minute for authenticated users */
  rateLimitGlobalAuth: number;
  /** Max requests per minute for anonymous users */
  rateLimitGlobalAnon: number;
  /** Max requests per minute for embedding endpoints */
  rateLimitEmbedding: number;
  /** Max requests per minute for vouch endpoints */
  rateLimitVouch: number;
  /** Max requests per minute for signing request creation */
  rateLimitSigning: number;
  /** Max requests per minute for recovery endpoints */
  rateLimitRecovery: number;
  /** Max requests per minute for public verify endpoints */
  rateLimitPublicVerify: number;
  /** Max requests per minute for public feed search */
  rateLimitPublicSearch: number;
  /** Max requests per day for LeGreffier onboarding start (default: 3) */
  rateLimitLegreffierStart: number;
  /** Max requests per minute for LeGreffier status polling (default: 120) */
  rateLimitLegreffierStatus: number;
  /** Max requests per minute for registration endpoint (default: 5) */
  rateLimitRegistration: number;
  /** Max requests per minute for readiness probes (default: 12) */
  rateLimitReadiness: number;
  /** Base URL for callback URLs in GitHub App manifests (e.g. http://localhost:8000 in dev) */
  apiBaseUrl: string;
  /** Sponsor agent identity ID for issuing vouchers */
  sponsorAgentId?: string;
}

export interface AppOptions {
  diaryService: DiaryService;
  /** Raw entry repository — used only by public feed routes (listPublic, searchPublic, findPublicById) */
  diaryEntryRepository: DiaryEntryRepository;
  contextPackRepository: ContextPackRepository;
  renderedPackRepository: RenderedPackRepository;
  attestationRepository: AttestationRepository;
  contextPackService: ContextPackService;
  verificationService: VerificationService;
  entryRelationRepository: EntryRelationRepository;
  embeddingService: EmbeddingService;
  agentRepository: AgentRepository;
  humanRepository: HumanRepository;
  cryptoService: CryptoService;
  voucherRepository: VoucherRepository;
  groupRepository: GroupRepository;
  teamRepository: TeamRepository;
  diaryTransferRepository: DiaryTransferRepository;
  /** Signing request repository + dataSource are required together (DBOS) */
  signingRequestRepository: SigningRequestRepository;
  nonceRepository: NonceRepository;
  dataSource: DataSource;
  transactionRunner: TransactionRunner;
  signingTimeoutSeconds?: number;
  permissionChecker: PermissionChecker;
  relationshipReader: RelationshipReader;
  relationshipWriter: RelationshipWriter;
  tokenValidator: TokenValidator;
  teamResolver: TeamResolver;
  sessionResolver?: SessionResolver;
  hydraPublicUrl: string;
  webhookApiKey: string;
  recoverySecret: string;
  oryClients: OryClients;
  security: SecurityOptions;
  packGcConfig: PackGcConfig;
  /** Database pool for readiness probe */
  pool?: HealthRouteOptions['pool'];
  /** Ory project URL for readiness probe */
  oryProjectUrl?: string;
  logger?: boolean;
}

/**
 * Register all REST API middleware and routes on a caller-provided Fastify instance.
 *
 * This is the composable entry point: the combined server calls this to mount
 * the full API on its own Fastify instance alongside static file serving.
 */
export async function registerApiRoutes(
  app: FastifyInstance,
  options: Omit<AppOptions, 'logger'>,
): Promise<void> {
  // Register security plugins first (order matters)
  // 1. Security headers (helmet)
  await app.register(securityHeadersPlugin);

  // 2. CORS
  await app.register(corsPluginFp, {
    origins: options.security.corsOrigins,
  });

  // Register OpenAPI spec generation
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MoltNet REST API',
        description:
          'Infrastructure for AI agent autonomy — identity, memory, and authentication.',
        version: '0.1.0',
      },
      servers: [
        { url: 'https://api.themolt.net', description: 'Production' },
        { url: 'http://localhost:8000', description: 'Local development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'OAuth2 access token from Ory Hydra (agent auth via client_credentials flow)',
          },
          sessionAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Moltnet-Session-Token',
            description:
              'Kratos session token for human users on native clients (console/dashboard CLI-style auth). Resolved via FrontendApi.toSession({ xSessionToken }).',
          },
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'ory_kratos_session',
            description:
              'Kratos session cookie set automatically by the browser after self-service login. Resolved via FrontendApi.toSession({ cookie }). The API forwards the raw Cookie header to Kratos unchanged, so any Kratos cookie name is accepted at runtime — the self-hosted default is `ory_kratos_session` and Ory Network uses `ory_session_<slug>`. **Note for SDK users:** the `name` field above is the self-hosted default for the benefit of generated clients; if you are on Ory Network, your cookie will be named `ory_session_<your-project-slug>` and you will need to override the cookie name in your SDK client (the server accepts either).',
          },
        },
      },
    },
    refResolver: {
      buildLocalReference(json) {
        return (json.$id as string) || `def-${Math.random()}`;
      },
    },
  });

  // Register Scalar API reference UI at /docs
  // Spec is sourced automatically from @fastify/swagger (no configuration.spec needed)
  // hideClientButton disables the Scalar agent feature which phones home to registry.scalar.com
  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      hideClientButton: true,
    },
  });

  // Register shared schemas for $ref resolution
  for (const schema of sharedSchemas) {
    app.addSchema(schema);
  }

  // Register global error handler (RFC 9457 Problem Details)
  await app.register(errorHandlerPlugin);

  // Register auth plugin (decorates tokenValidator, permissionChecker, request.authContext)
  await app.register(authPlugin, {
    tokenValidator: options.tokenValidator,
    permissionChecker: options.permissionChecker,
    relationshipWriter: options.relationshipWriter,
    teamResolver: options.teamResolver,
    sessionResolver: options.sessionResolver,
  });

  // Register request context plugin (AFTER auth so identityId/clientId are available)
  await app.register(requestContextPlugin);

  // 3. Rate limiting (AFTER auth so authContext is available)
  await app.register(rateLimitPlugin, {
    globalAuthLimit: options.security.rateLimitGlobalAuth,
    globalAnonLimit: options.security.rateLimitGlobalAnon,
    embeddingLimit: options.security.rateLimitEmbedding,
    vouchLimit: options.security.rateLimitVouch,
    signingLimit: options.security.rateLimitSigning,
    recoveryLimit: options.security.rateLimitRecovery,
    publicVerifyLimit: options.security.rateLimitPublicVerify,
    publicSearchLimit: options.security.rateLimitPublicSearch,
    legreffierStartLimit: options.security.rateLimitLegreffierStart,
    legreffierStatusLimit: options.security.rateLimitLegreffierStatus,
    registrationLimit: options.security.rateLimitRegistration,
    readinessLimit: options.security.rateLimitReadiness,
  });

  // Decorate with services (guard to allow pre-decoration by DBOS plugin)
  const decorateSafe = (name: string, value: unknown) => {
    if (!app.hasDecorator(name)) {
      app.decorate(name, value);
    }
  };
  decorateSafe('diaryService', options.diaryService);
  decorateSafe('diaryEntryRepository', options.diaryEntryRepository);
  decorateSafe('contextPackRepository', options.contextPackRepository);
  decorateSafe('renderedPackRepository', options.renderedPackRepository);
  decorateSafe('attestationRepository', options.attestationRepository);
  decorateSafe('contextPackService', options.contextPackService);
  decorateSafe('verificationService', options.verificationService);
  decorateSafe('entryRelationRepository', options.entryRelationRepository);
  decorateSafe('embeddingService', options.embeddingService);
  decorateSafe('agentRepository', options.agentRepository);
  decorateSafe('humanRepository', options.humanRepository);
  decorateSafe('cryptoService', options.cryptoService);
  decorateSafe('voucherRepository', options.voucherRepository);
  decorateSafe('groupRepository', options.groupRepository);
  decorateSafe('teamRepository', options.teamRepository);
  decorateSafe('diaryTransferRepository', options.diaryTransferRepository);
  decorateSafe('relationshipReader', options.relationshipReader);
  decorateSafe('signingTimeoutSeconds', options.signingTimeoutSeconds ?? 300);
  decorateSafe('packGcConfig', options.packGcConfig);
  decorateSafe('signingRequestRepository', options.signingRequestRepository);
  decorateSafe('dataSource', options.dataSource);
  decorateSafe('transactionRunner', options.transactionRunner);

  // Expose full security config to routes
  decorateSafe('security', options.security);

  // Decorate with webhook config for hook routes
  app.decorate('webhookApiKey', options.webhookApiKey);
  app.decorate('oauth2Client', options.oryClients.oauth2);
  app.decorate('identityApi', options.oryClients.identity);

  // Register routes
  await app.register(oauth2Routes, {
    hydraPublicUrl: options.hydraPublicUrl,
  });
  await app.register(hookRoutes);
  await app.register(healthRoutes, {
    pool: options.pool,
    oryProjectUrl: options.oryProjectUrl,
  });
  await app.register(diaryRoutes);
  await app.register(diaryEntryRoutes);
  await app.register(diaryDistillRoutes);
  await app.register(packRoutes);
  await app.register(renderedPackRoutes);
  await app.register(verificationRoutes);
  await app.register(entryRelationRoutes);
  await app.register(agentRoutes);
  await app.register(cryptoRoutes);
  await app.register(signingRequestRoutes);
  await app.register(recoveryRoutes, {
    recoverySecret: options.recoverySecret,
    identityClient: options.oryClients.identity,
    nonceRepository: options.nonceRepository,
  });
  await app.register(registrationRoutes);
  await app.register(teamRoutes);
  await app.register(groupRoutes);
  await app.register(vouchRoutes);
  await app.register(publicRoutes);
  await app.register(problemRoutes);
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: {
      customOptions: {
        removeAdditional: true,
      },
    },
  });
  await registerApiRoutes(app, options);
  return app;
}
