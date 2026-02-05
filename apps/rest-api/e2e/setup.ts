/**
 * E2E Test Setup
 *
 * Bootstraps the REST API with real services — real database,
 * real Ory Hydra (token validation), real Ory Keto (permissions).
 * No mocks. Tests fail if Docker infrastructure isn't running.
 *
 * Requires: `docker compose --profile dev up -d --wait`
 */

import {
  createOryClients,
  createPermissionChecker,
  createTokenValidator,
  type OryClients,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createDatabase,
  createDiaryRepository,
  createVoucherRepository,
  type Database,
} from '@moltnet/database';
import {
  createDiaryService,
  createNoopEmbeddingService,
} from '@moltnet/diary-service';
import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
  PermissionApi,
  RelationshipApi,
} from '@ory/client';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';

// ── Infrastructure URLs (Docker Compose dev profile) ─────────

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';

const HYDRA_ADMIN_URL =
  process.env.ORY_HYDRA_ADMIN_URL ?? 'http://localhost:4445';
const HYDRA_PUBLIC_URL =
  process.env.ORY_HYDRA_PUBLIC_URL ?? 'http://localhost:4444';
const KETO_READ_URL =
  process.env.ORY_KETO_PUBLIC_URL ?? 'http://localhost:4466';
const KETO_WRITE_URL =
  process.env.ORY_KETO_ADMIN_URL ?? 'http://localhost:4467';
const KRATOS_ADMIN_URL =
  process.env.ORY_KRATOS_ADMIN_URL ?? 'http://localhost:4434';
const KRATOS_PUBLIC_URL =
  process.env.ORY_KRATOS_PUBLIC_URL ?? 'http://localhost:4433';

const WEBHOOK_API_KEY =
  process.env.ORY_ACTION_API_KEY ?? 'e2e-test-webhook-key';

const RECOVERY_SECRET =
  process.env.RECOVERY_SECRET ?? 'e2e-recovery-secret-for-hmac-signing';

export {
  DATABASE_URL,
  HYDRA_ADMIN_URL,
  HYDRA_PUBLIC_URL,
  KETO_READ_URL,
  KETO_WRITE_URL,
  KRATOS_ADMIN_URL,
  KRATOS_PUBLIC_URL,
  RECOVERY_SECRET,
  WEBHOOK_API_KEY,
};

// ── Ory API Clients ──────────────────────────────────────────

export function createE2eOryClients(): {
  oryClients: OryClients;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
} {
  // Each Ory service is on a different port in Docker Compose
  const hydraAdminConfig = new Configuration({ basePath: HYDRA_ADMIN_URL });
  const ketoReadConfig = new Configuration({ basePath: KETO_READ_URL });
  const ketoWriteConfig = new Configuration({ basePath: KETO_WRITE_URL });
  const kratosAdminConfig = new Configuration({ basePath: KRATOS_ADMIN_URL });
  const kratosPublicConfig = new Configuration({
    basePath: KRATOS_PUBLIC_URL,
  });

  const hydraAdminOAuth2 = new OAuth2Api(hydraAdminConfig);
  const kratosPublicFrontend = new FrontendApi(kratosPublicConfig);

  const oryClients: OryClients = createOryClients({
    baseUrl: HYDRA_ADMIN_URL,
  });
  // Override individual clients to point at the correct service URLs
  // (createOryClients uses a single basePath, but Docker Compose
  //  puts each Ory service on a different port)
  Object.assign(oryClients, {
    frontend: kratosPublicFrontend,
    identity: new IdentityApi(kratosAdminConfig),
    oauth2: hydraAdminOAuth2,
    permission: new PermissionApi(ketoReadConfig),
    relationship: new RelationshipApi(ketoWriteConfig),
  });

  return {
    oryClients,
    identityApi: new IdentityApi(kratosAdminConfig),
    hydraAdminOAuth2,
    kratosPublicFrontend,
  };
}

// ── Test Harness ─────────────────────────────────────────────

export interface TestHarness {
  app: FastifyInstance;
  db: Database;
  baseUrl: string;
  oryClients: OryClients;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
  /** Kratos public Frontend API (self-service flows: recovery, login, etc.) */
  kratosPublicFrontend: FrontendApi;
  webhookApiKey: string;
  /** Bootstrap identity ID for creating initial vouchers */
  bootstrapIdentityId: string;
  /** Close server */
  teardown(): Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  console.log('[E2E] Creating test harness...');
  const { db } = createDatabase(DATABASE_URL);

  // Verify database is reachable (fail fast, no silent skip)
  await db.execute(sql`SELECT 1`);

  const { oryClients, identityApi, hydraAdminOAuth2, kratosPublicFrontend } =
    createE2eOryClients();

  const diaryRepository = createDiaryRepository(db);
  const agentRepository = createAgentRepository(db);
  const voucherRepository = createVoucherRepository(db);
  const embeddingService = createNoopEmbeddingService();

  const permissionChecker = createPermissionChecker(
    oryClients.permission,
    oryClients.relationship,
  );

  const diaryService = createDiaryService({
    diaryRepository,
    permissionChecker,
    embeddingService,
  });

  const tokenValidator = createTokenValidator(hydraAdminOAuth2, {
    jwksUri: `${HYDRA_PUBLIC_URL}/.well-known/jwks.json`,
  });

  const app = await buildApp({
    diaryService,
    agentRepository,
    voucherRepository,
    cryptoService,
    permissionChecker,
    tokenValidator,
    webhookApiKey: WEBHOOK_API_KEY,
    recoverySecret: RECOVERY_SECRET,
    oryClients,
    security: {
      corsOrigins: 'http://localhost:3000,http://localhost:8000',
      rateLimitGlobalAuth: 1000, // Higher for E2E tests
      rateLimitGlobalAnon: 1000,
      rateLimitEmbedding: 1000,
      rateLimitVouch: 1000,
    },
    logger: true,
  });

  // Ensure all plugins are fully registered before listening
  await app.ready();

  // Listen on a random port
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  console.log(`[E2E] Server started at ${address}`);

  // Print all registered routes
  console.log('[E2E] Registered routes:');
  const routes = app.printRoutes({ commonPrefix: false });
  console.log(routes);

  // Test /health first to verify HTTP works
  const healthResp = await fetch(`${address}/health`);
  console.log(`[E2E] Health check: ${healthResp.status}`);

  // Verify webhook route is registered
  console.log(
    `[E2E] Webhook route registered:`,
    app.hasRoute({ url: '/hooks/kratos/after-registration', method: 'POST' }),
  );

  // Create a bootstrap identity in Kratos for issuing test vouchers
  // This identity doesn't need a voucher since it's the first one
  const bootstrapKeyPair = await cryptoService.generateKeyPair();

  const { data: bootstrapIdentity } = await identityApi.createIdentity({
    createIdentityBody: {
      schema_id: 'moltnet_agent',
      traits: {
        public_key: bootstrapKeyPair.publicKey,
        voucher_code: 'bootstrap-genesis',
      },
      credentials: {
        password: {
          config: {
            password: 'bootstrap-password',
          },
        },
      },
    },
  });

  // Create the agent entry in the database (bypass webhook voucher check)
  await agentRepository.upsert({
    identityId: bootstrapIdentity.id,
    publicKey: bootstrapKeyPair.publicKey,
    fingerprint: bootstrapKeyPair.fingerprint,
  });

  // Register in Keto for permissions
  await permissionChecker.registerAgent(bootstrapIdentity.id);

  console.log(`[E2E] Bootstrap identity created: ${bootstrapIdentity.id}`);

  return {
    app,
    db,
    baseUrl: address,
    oryClients,
    identityApi,
    hydraAdminOAuth2,
    kratosPublicFrontend,
    webhookApiKey: WEBHOOK_API_KEY,
    bootstrapIdentityId: bootstrapIdentity.id,
    async teardown() {
      await app.close();
    },
  };
}
