/**
 * E2E Global Setup — Health Check + Sponsor Agent Bootstrap
 *
 * Assumes Docker Compose is already running (started by CI or the developer).
 * Verifies all services are healthy, then bootstraps a sponsor genesis agent
 * and restarts the rest-api container with SPONSOR_AGENT_ID set so that
 * LeGreffier onboarding e2e tests can exercise the full happy path.
 *
 * To start the stack locally:
 *   docker compose -f docker-compose.e2e.yaml up -d --build
 *
 * To start in CI (pre-built images):
 *   docker compose -f docker-compose.e2e.yaml -f docker-compose.e2e.ci.yaml up -d
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  type BootstrapConfig,
  bootstrapGenesisAgents,
} from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';

// ── Infrastructure URLs (Docker Compose e2e — localhost mappings) ──

const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';

const HYDRA_ADMIN_URL =
  process.env['ORY_HYDRA_ADMIN_URL'] ?? 'http://localhost:4445';
const KETO_READ_URL =
  process.env['ORY_KETO_PUBLIC_URL'] ?? 'http://localhost:4466';
const KETO_WRITE_URL =
  process.env['ORY_KETO_ADMIN_URL'] ?? 'http://localhost:4467';
const KRATOS_ADMIN_URL =
  process.env['ORY_KRATOS_ADMIN_URL'] ?? 'http://localhost:4434';

// Resolve repo root for docker compose -f path
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.e2e.yaml');
const COMPOSE_CI_FILE = resolve(REPO_ROOT, 'docker-compose.e2e.ci.yaml');
const IS_CI = !!process.env['CI'];

// ── Helpers ───────────────────────────────────────────────────────

async function waitForHealthy(url: string, maxAttempts = 60): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service not ready yet
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
  }
  throw new Error(
    `Service at ${url} did not become healthy after ${maxAttempts} attempts`,
  );
}

async function bootstrapSponsorAgent(): Promise<string> {
  const bootstrapConfig: BootstrapConfig = {
    databaseUrl: DATABASE_URL,
    ory: {
      mode: 'split',
      kratosAdminUrl: KRATOS_ADMIN_URL,
      hydraAdminUrl: HYDRA_ADMIN_URL,
      hydraPublicUrl: 'http://localhost:4444',
      ketoReadUrl: KETO_READ_URL,
      ketoWriteUrl: KETO_WRITE_URL,
    },
  };

  const { db, pool } = createDatabase(DATABASE_URL);
  try {
    const result = await bootstrapGenesisAgents({
      config: bootstrapConfig,
      db,
      names: ['E2E-Sponsor'],
      scopes: 'diary:read diary:write crypto:sign agent:profile',
      log: (msg) => console.log(`[E2E Setup] ${msg}`),
    });

    if (result.agents.length === 0) {
      const errorMsg = result.errors.map((e) => e.error).join('; ');
      throw new Error(`Sponsor bootstrap failed: ${errorMsg}`);
    }

    return result.agents[0].identityId;
  } finally {
    await pool.end();
  }
}

function restartRestApi(sponsorAgentId: string): void {
  console.log(
    `[E2E Setup] Restarting rest-api with SPONSOR_AGENT_ID=${sponsorAgentId}...`,
  );

  // docker compose up --no-deps --force-recreate inherits the current process
  // env, so setting process.env before the call is enough.
  process.env['SPONSOR_AGENT_ID'] = sponsorAgentId;

  const composeFiles = IS_CI
    ? `-f ${COMPOSE_FILE} -f ${COMPOSE_CI_FILE}`
    : `-f ${COMPOSE_FILE}`;

  execSync(
    `docker compose --env-file /dev/null ${composeFiles} up -d --no-deps --force-recreate rest-api`,
    { stdio: 'inherit', env: process.env },
  );
}

// ── Main ──────────────────────────────────────────────────────────

export default async function setup() {
  console.log('[E2E Setup] Waiting for services to be healthy...');

  await Promise.all([
    waitForHealthy('http://localhost:4433/health/alive'), // Kratos
    waitForHealthy('http://localhost:4444/health/alive'), // Hydra
    waitForHealthy('http://localhost:4466/health/alive'), // Keto
    waitForHealthy('http://localhost:8080/health'), // REST API
  ]);

  console.log('[E2E Setup] All services ready');

  // Bootstrap the sponsor agent and restart rest-api so that the
  // LeGreffier onboarding happy path is available to e2e tests.
  // Skip if SPONSOR_AGENT_ID is already provided (e.g. CI override).
  if (!process.env['SPONSOR_AGENT_ID']) {
    console.log('[E2E Setup] Bootstrapping sponsor agent...');
    const sponsorAgentId = await bootstrapSponsorAgent();
    console.log(`[E2E Setup] Sponsor created: ${sponsorAgentId}`);

    restartRestApi(sponsorAgentId);

    // Wait for rest-api to become healthy again after restart
    console.log('[E2E Setup] Waiting for rest-api to recover...');
    await waitForHealthy('http://localhost:8080/health');
    console.log('[E2E Setup] rest-api healthy with SPONSOR_AGENT_ID');
  } else {
    console.log(
      `[E2E Setup] Using existing SPONSOR_AGENT_ID=${process.env['SPONSOR_AGENT_ID']}`,
    );
  }
}
