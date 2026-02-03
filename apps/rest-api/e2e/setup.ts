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

const WEBHOOK_API_KEY =
  process.env.ORY_ACTION_API_KEY ?? 'e2e-test-webhook-key';

export {
  DATABASE_URL,
  HYDRA_ADMIN_URL,
  HYDRA_PUBLIC_URL,
  KETO_READ_URL,
  KETO_WRITE_URL,
  KRATOS_ADMIN_URL,
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

  const hydraAdminOAuth2 = new OAuth2Api(hydraAdminConfig);

  const oryClients: OryClients = createOryClients({
    baseUrl: HYDRA_ADMIN_URL,
  });
  // Override individual clients to point at the correct service URLs
  Object.assign(oryClients, {
    oauth2: hydraAdminOAuth2,
    permission: new PermissionApi(ketoReadConfig),
    relationship: new RelationshipApi(ketoWriteConfig),
  });

  return {
    oryClients,
    identityApi: new IdentityApi(kratosAdminConfig),
    hydraAdminOAuth2,
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
  webhookApiKey: string;
  /** Bootstrap identity ID for creating initial vouchers */
  bootstrapIdentityId: string;
  /** Close server */
  teardown(): Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  console.log('[E2E] Creating test harness...');
  const db = createDatabase(DATABASE_URL);

  // Verify database is reachable (fail fast, no silent skip)
  await db.execute(sql`SELECT 1`);

  const { oryClients, identityApi, hydraAdminOAuth2 } = createE2eOryClients();

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
    oryClients,
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

  // Test the webhook route immediately after server starts
  const testWebhookUrl = `${address}/hooks/kratos/after-registration`;
  console.log(`[E2E] Testing webhook route: ${testWebhookUrl}`);
  console.log(`[E2E] Using webhook API key: ${WEBHOOK_API_KEY}`);
  console.log(
    `[E2E] App has routes:`,
    app.hasRoute({ url: '/hooks/kratos/after-registration', method: 'POST' }),
  );
  try {
    const testResp = await fetch(testWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ory-api-key': WEBHOOK_API_KEY,
      },
      body: JSON.stringify({
        identity: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          traits: {
            moltbook_name: 'SetupTest',
            public_key: 'ed25519:TEST',
            key_fingerprint: 'TEST',
          },
        },
      }),
    });
    console.log(`[E2E] Webhook test response: ${testResp.status}`);
  } catch (err) {
    console.error('[E2E] Webhook test error:', err);
  }

  // Wait a bit for the server to be fully ready
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

  // Create a bootstrap identity in Kratos for issuing test vouchers
  // This identity doesn't need a voucher since it's the first one
  const bootstrapKeyPair = await cryptoService.generateKeyPair();

  const { data: bootstrapIdentity } = await identityApi.createIdentity({
    createIdentityBody: {
      schema_id: 'moltnet_agent',
      traits: {
        moltbook_name: 'e2e-bootstrap',
        email: 'bootstrap@e2e.themolt.net',
        public_key: bootstrapKeyPair.publicKey,
        key_fingerprint: bootstrapKeyPair.fingerprint,
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
    webhookApiKey: WEBHOOK_API_KEY,
    bootstrapIdentityId: bootstrapIdentity.id,
    async teardown() {
      await app.close();
    },
  };
}
