/**
 * Bootstrap Genesis Agents — Core logic
 *
 * Reusable by both the CLI entrypoint and E2E tests.
 * Handles both Ory Network (managed, single URL) and split deployments
 * (Docker Compose with per-service URLs).
 */

import { createOryClients, createPermissionChecker } from '@moltnet/auth';
import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import type { AgentRepository } from '@moltnet/database';
import { createAgentRepository, type Database } from '@moltnet/database';
import { Configuration, IdentityApi, OAuth2Api } from '@ory/client';

// ── Configuration ────────────────────────────────────────────

interface OryManagedConfig {
  mode: 'managed';
  projectUrl: string;
  apiKey: string;
}

interface OrySplitConfig {
  mode: 'split';
  kratosAdminUrl: string;
  hydraAdminUrl: string;
  hydraPublicUrl: string;
  ketoReadUrl: string;
  ketoWriteUrl: string;
}

export interface BootstrapConfig {
  databaseUrl: string;
  ory: OryManagedConfig | OrySplitConfig;
}

export interface GenesisAgent {
  name: string;
  identityId: string;
  keyPair: KeyPair;
  clientId: string;
  clientSecret: string;
  accessToken: string;
}

export interface BootstrapResult {
  agents: GenesisAgent[];
  errors: { name: string; error: string }[];
}

export interface BootstrapOptions {
  config: BootstrapConfig;
  db: Database;
  names: string[];
  scopes: string;
  log?: (message: string) => void;
}

// ── Core Bootstrap Function ──────────────────────────────────

export async function bootstrapGenesisAgents(
  opts: BootstrapOptions,
): Promise<BootstrapResult> {
  const log = opts.log ?? (() => {});
  const agentRepository = createAgentRepository(opts.db);

  // Resolve Ory clients based on config mode
  const { identityApi, hydraAdminOAuth2, hydraPublicUrl, permissionChecker } =
    resolveOryClients(opts.config.ory);

  const agents: GenesisAgent[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const name of opts.names) {
    log(`Creating genesis agent: ${name}`);
    try {
      const agent = await createGenesisAgent({
        name,
        identityApi,
        hydraAdminOAuth2,
        hydraPublicUrl,
        agentRepository,
        permissionChecker,
        scopes: opts.scopes,
        log,
      });
      agents.push(agent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  ERROR: ${message}`);
      errors.push({ name, error: message });
    }
  }

  return { agents, errors };
}

// ── Ory Client Resolution ────────────────────────────────────

function resolveOryClients(oryConfig: OryManagedConfig | OrySplitConfig) {
  if (oryConfig.mode === 'managed') {
    const oryClients = createOryClients({
      baseUrl: oryConfig.projectUrl,
      apiKey: oryConfig.apiKey,
    });

    const adminConfig = new Configuration({
      basePath: oryConfig.projectUrl,
      accessToken: oryConfig.apiKey,
    });

    return {
      identityApi: new IdentityApi(adminConfig),
      hydraAdminOAuth2: new OAuth2Api(adminConfig),
      hydraPublicUrl: oryConfig.projectUrl,
      permissionChecker: createPermissionChecker(
        oryClients.permission,
        oryClients.relationship,
      ),
    };
  }

  // Split mode: separate URL per service
  const oryClients = createOryClients({
    baseUrl: oryConfig.hydraAdminUrl,
    kratosAdminUrl: oryConfig.kratosAdminUrl,
    hydraAdminUrl: oryConfig.hydraAdminUrl,
    ketoReadUrl: oryConfig.ketoReadUrl,
    ketoWriteUrl: oryConfig.ketoWriteUrl,
  });

  const kratosAdminConfig = new Configuration({
    basePath: oryConfig.kratosAdminUrl,
  });
  const hydraAdminConfig = new Configuration({
    basePath: oryConfig.hydraAdminUrl,
  });

  return {
    identityApi: new IdentityApi(kratosAdminConfig),
    hydraAdminOAuth2: new OAuth2Api(hydraAdminConfig),
    hydraPublicUrl: oryConfig.hydraPublicUrl,
    permissionChecker: createPermissionChecker(
      oryClients.permission,
      oryClients.relationship,
    ),
  };
}

// ── Single Agent Creation ────────────────────────────────────

async function createGenesisAgent(opts: {
  name: string;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
  hydraPublicUrl: string;
  agentRepository: AgentRepository;
  permissionChecker: ReturnType<typeof createPermissionChecker>;
  scopes: string;
  log: (message: string) => void;
}): Promise<GenesisAgent> {
  // 1. Generate Ed25519 keypair
  const keyPair = await cryptoService.generateKeyPair();
  opts.log(`  Keypair generated: ${keyPair.fingerprint}`);

  // 2. Create Kratos identity via admin API
  const { data: identity } = await opts.identityApi.createIdentity({
    createIdentityBody: {
      schema_id: 'moltnet_agent',
      traits: {
        public_key: keyPair.publicKey,
        voucher_code: 'genesis-bootstrap',
      },
      credentials: {
        password: {
          config: {
            password: `genesis-${crypto.randomUUID()}`,
          },
        },
      },
    },
  });

  const identityId = identity.id;
  opts.log(`  Kratos identity created: ${identityId}`);

  // 3. Insert into agent_keys table directly (bypasses voucher-gated webhook)
  await opts.agentRepository.upsert({
    identityId,
    publicKey: keyPair.publicKey,
    fingerprint: keyPair.fingerprint,
  });
  opts.log(`  Inserted into agent_keys`);

  // 4. Register self-relationship in Keto for permissions
  await opts.permissionChecker.registerAgent(identityId);
  opts.log(`  Registered in Keto`);

  // 5. Create OAuth2 client in Hydra via admin API
  const { data: oauthClient } = await opts.hydraAdminOAuth2.createOAuth2Client({
    oAuth2Client: {
      client_name: `Genesis: ${opts.name}`,
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: opts.scopes,
      metadata: {
        type: 'moltnet_agent',
        identity_id: identityId,
        public_key: keyPair.publicKey,
        fingerprint: keyPair.fingerprint,
      },
    },
  });

  if (!oauthClient.client_id || !oauthClient.client_secret) {
    throw new Error('Hydra did not return client_id/client_secret');
  }

  opts.log(`  OAuth2 client created: ${oauthClient.client_id}`);

  // 6. Acquire initial access token via client_credentials grant
  const tokenResponse = await fetch(`${opts.hydraPublicUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: oauthClient.client_id,
      client_secret: oauthClient.client_secret,
      scope: opts.scopes,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(
      `Token acquisition failed: ${tokenResponse.status} ${body}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as { access_token: string };
  opts.log(`  Access token acquired`);

  return {
    name: opts.name,
    identityId,
    keyPair,
    clientId: oauthClient.client_id,
    clientSecret: oauthClient.client_secret,
    accessToken: tokenData.access_token,
  };
}
