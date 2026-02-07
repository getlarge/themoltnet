/**
 * E2E Test Setup — Docker Mode
 *
 * Points at the containerized combined server (localhost:8080) instead of
 * bootstrapping in-process. Database and Ory admin clients connect via
 * localhost port mappings for test scaffolding (bootstrap identity, vouchers).
 *
 * Requires: `docker compose -f docker-compose.e2e.yaml up -d --build`
 */

import {
  createOryClients,
  createPermissionChecker,
  type OryClients,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createDatabase,
  type Database,
} from '@moltnet/database';
import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
} from '@ory/client';
import { sql } from 'drizzle-orm';

// ── Infrastructure URLs (Docker Compose e2e — localhost mappings) ──

const SERVER_BASE_URL = process.env.SERVER_BASE_URL ?? 'http://localhost:8080';

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

export {
  DATABASE_URL,
  HYDRA_ADMIN_URL,
  HYDRA_PUBLIC_URL,
  KETO_READ_URL,
  KETO_WRITE_URL,
  KRATOS_ADMIN_URL,
  KRATOS_PUBLIC_URL,
  WEBHOOK_API_KEY,
};

// ── Ory API Clients (test scaffolding — direct to Ory containers) ──

function createE2eOryClients(): {
  oryClients: OryClients;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
  kratosPublicFrontend: FrontendApi;
} {
  const oryClients = createOryClients({
    baseUrl: HYDRA_ADMIN_URL,
    kratosPublicUrl: KRATOS_PUBLIC_URL,
    kratosAdminUrl: KRATOS_ADMIN_URL,
    hydraAdminUrl: HYDRA_ADMIN_URL,
    ketoReadUrl: KETO_READ_URL,
    ketoWriteUrl: KETO_WRITE_URL,
  });

  const kratosAdminConfig = new Configuration({ basePath: KRATOS_ADMIN_URL });
  const kratosPublicConfig = new Configuration({ basePath: KRATOS_PUBLIC_URL });
  const hydraAdminConfig = new Configuration({ basePath: HYDRA_ADMIN_URL });

  return {
    oryClients,
    identityApi: new IdentityApi(kratosAdminConfig),
    hydraAdminOAuth2: new OAuth2Api(hydraAdminConfig),
    kratosPublicFrontend: new FrontendApi(kratosPublicConfig),
  };
}

// ── Test Harness ─────────────────────────────────────────────

export interface TestHarness {
  db: Database;
  baseUrl: string;
  oryClients: OryClients;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
  kratosPublicFrontend: FrontendApi;
  webhookApiKey: string;
  bootstrapIdentityId: string;
  teardown(): Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  console.log('[E2E] Creating test harness (Docker mode)...');

  // Direct DB connection for test scaffolding (voucher creation)
  const { db, pool } = createDatabase(DATABASE_URL);

  // Verify database is reachable
  await db.execute(sql`SELECT 1`);

  const { oryClients, identityApi, hydraAdminOAuth2, kratosPublicFrontend } =
    createE2eOryClients();

  const agentRepository = createAgentRepository(db);

  const permissionChecker = createPermissionChecker(
    oryClients.permission,
    oryClients.relationship,
  );

  // Create a bootstrap identity in Kratos for issuing test vouchers
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
    db,
    baseUrl: SERVER_BASE_URL,
    oryClients,
    identityApi,
    hydraAdminOAuth2,
    kratosPublicFrontend,
    webhookApiKey: WEBHOOK_API_KEY,
    bootstrapIdentityId: bootstrapIdentity.id,
    async teardown() {
      await pool.end();
    },
  };
}
